/**
 * journey-product-create.ts — 상품 재구매 여정 초안 만들기 (★ 2026-09-30 여정 V2 3차 · 설계서 §6)
 *
 * 상품 고르기 창 → (서버) ①고른 상품이 지금 문의 관측 목록 안인가(직접 입력 · 지어낸 상품 거부)
 *   ②DB 가 이 시작 사건을 받는가(3차 CHECK 교체 DDL 전이면 AI 를 부르기 전에 멈춘다 · 차감 0)
 *   ③AI 설계 1회(묶음 안 · 규약 밖 결과면 1회 재요청) → 첫 문자 = 담당자가 확정한 사용 기간 뒤
 *   ④서버 초안 저장(재진입 · 진입 교체 서버 고정) → ⑤1회 차감(여정 AI 생성 단가 · 멱등키).
 */
import { query } from '../config/database';
import { runInCreditBundle } from './ai-credit-context';
import { checkCredit } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { generateJourneyPackage } from './journey-ai-generator';
import { JourneyInputError } from './journey-step-limits';
import { listJourneyCallbackNumbers, defaultCallbackOf, saveJourneyPackageAsDraft, nextDraftChargeKey, chargeThenSaveDraft } from './journey-draft-save';
import { PRODUCT_TRIGGER_EVENT, currentPurchaseDoor, listObservedProducts, MAX_PRODUCT_KEYS } from './journey-product';
import { isMallConsentEnforced } from './mall-consent';

/**
 * 상품 재구매 여정을 열 수 없는 회사 사유 — 몰별 수신동의를 강제하는 회사(설계서 §6 잠금).
 * 여정 발송은 아직 몰별 동의를 따르지 않는다(journey-* 에서 mall-consent 사용 0 · 0930 확인). 몰 상품을 고르는 여정이라 먼저 잠근다.
 */
export async function productJourneyLockReason(companyId: string): Promise<string | null> {
  if (await isMallConsentEnforced(companyId)) {
    return '이 회사는 몰별 수신동의로 보내고 있어요. 여정은 아직 몰별 동의를 따르지 않아 상품 재구매 여정을 열지 않았어요.';
  }
  return null;
}

/** DB 가 아직 이 시작 사건을 받지 않는다(CHECK 교체 전) — 라우트가 503 DB_MIGRATION_PENDING 으로 돌려준다. */
export class JourneyMigrationPendingError extends Error {
  readonly code = 'DB_MIGRATION_PENDING';
  constructor(message: string) { super(message); this.name = 'JourneyMigrationPendingError'; }
}

let dbAcceptsProductAt = 0;
/**
 * journeys.trigger_event CHECK 가 상품 구매를 받는가. 제약이 없으면 받는다. 한 번 참이면 1시간 기억(거짓은 기억하지 않는다 · DDL 직후 바로 열린다).
 */
export async function dbAcceptsProductTrigger(): Promise<boolean> {
  if (Date.now() - dbAcceptsProductAt < 60 * 60 * 1000) return true;
  const r = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      WHERE c.conrelid = 'journeys'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%trigger_event%'`,
  );
  const ok = r.rows.length === 0 || r.rows.every((x: any) => String(x.def || '').includes(`'${PRODUCT_TRIGGER_EVENT}'`));
  if (ok) dbAcceptsProductAt = Date.now();
  return ok;
}

export interface ProductDraftResult { journeyId: string; name: string; charged: number }

const TTL_MS = 30 * 60 * 1000;
const done = new Map<string, { at: number; result: ProductDraftResult }>();
const inflight = new Map<string, Promise<ProductDraftResult>>();

export async function createProductJourneyDraft(input: {
  companyId: string;
  userId: string;
  requestId: string;
  keys: string[];
  periodDays: number;
  benefitText?: string | null;
  callbackNumber?: string | null;
}): Promise<ProductDraftResult> {
  const memo = `${input.companyId}:${input.requestId}`;
  const now = Date.now();
  for (const [k, v] of done) if (now - v.at > TTL_MS) done.delete(k);
  const hit = done.get(memo);
  if (hit) return hit.result;
  const running = inflight.get(memo);
  if (running) return running;

  const job = (async () => {
    const wanted = [...new Set((input.keys || []).map((k) => String(k).trim()).filter(Boolean))];
    if (wanted.length === 0) throw new JourneyInputError('상품을 하나 이상 골라 주세요.');
    if (wanted.length > MAX_PRODUCT_KEYS) throw new JourneyInputError(`상품은 ${MAX_PRODUCT_KEYS}개까지 고를 수 있어요.`);
    const periodDays = Math.floor(Number(input.periodDays));
    if (!Number.isFinite(periodDays) || periodDays < 1 || periodDays > 365) throw new JourneyInputError('사용 기간은 1일에서 365일 사이로 정해 주세요.');

    const locked = await productJourneyLockReason(input.companyId);
    if (locked) throw new JourneyInputError(locked);
    const door = await currentPurchaseDoor(input.companyId);
    const observed = await listObservedProducts(input.companyId, door);
    const byKey = new Map(observed.products.map((p) => [p.key, p]));
    const picked = wanted.filter((k) => byKey.has(k));
    if (picked.length !== wanted.length) throw new JourneyInputError('목록에 없는 상품이 있어요. 상품 목록을 다시 열어 골라 주세요.');
    const names = picked.map((k) => byKey.get(k)!.name);

    if (!(await dbAcceptsProductTrigger())) {
      throw new JourneyMigrationPendingError('상품 재구매 여정을 받을 준비가 아직 안 됐어요. 운영자에게 여정 시작 사건 목록 갱신(DB 마이그레이션)을 요청해 주세요.');
    }

    const numbers = await listJourneyCallbackNumbers(input.companyId);
    const want = String(input.callbackNumber || '').replace(/-/g, '').trim();
    const callbackNumber = want && numbers.some((n) => n.phone === want) ? want : defaultCallbackOf(numbers);
    if (!callbackNumber) throw new JourneyInputError(numbers.length === 0 ? '회신번호를 먼저 등록해 주세요.' : '보낼 회신번호를 골라 주세요.');

    const cost = getCreditCost('journey-ai-generate');
    // ★ 0930 Codex 1R · 6R — 요청 키에 회사 id(원장 중복 판정은 키 하나로 본다) · 이미 초안을 만든 요청이면 AI 를 부르지 않는다(재시작 · 만료 뒤 재전송).
    const chargeKey = await nextDraftChargeKey(input.companyId, `journey-product:${input.companyId}:${input.requestId}`);
    await checkCredit(input.companyId, cost);
    const head = names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}개` : '');
    const objective = `${head}을(를) 산 고객이 ${periodDays}일쯤 지나 다 써 갈 때 같은 상품을 다시 사도록 권한다. 첫 문자는 다 써 갈 때쯤 보낸다.`;
    const gen = () => generateJourneyPackage({
      companyId: input.companyId,
      createdBy: input.userId,
      objective,
      preferTriggerEvent: PRODUCT_TRIGGER_EVENT,
      benefitText: input.benefitText ? String(input.benefitText).slice(0, 200) : undefined,
      product: { keys: picked, names, door, periodDays },
    });
    const pkg = await runInCreditBundle(async () => {
      try {
        return await gen();
      } catch (e) {
        if (e instanceof JourneyInputError) throw e;
        return gen();
      }
    });
    // ★ 0930 Codex 6R — 차감 확정 뒤 저장(무과금 초안 0) · 저장 실패 = 환불.
    const { journeyId, charged } = await chargeThenSaveDraft({
      companyId: input.companyId,
      userId: input.userId,
      cost,
      chargeKey,
      save: () => saveJourneyPackageAsDraft(input.companyId, input.userId, pkg, { callbackNumber, objective }),
    });
    const result: ProductDraftResult = { journeyId, name: pkg.name, charged };
    done.set(memo, { at: Date.now(), result });
    return result;
  })();
  inflight.set(memo, job);
  try {
    return await job;
  } finally {
    inflight.delete(memo);
  }
}
