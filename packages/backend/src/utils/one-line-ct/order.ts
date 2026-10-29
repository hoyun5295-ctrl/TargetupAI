/**
 * one-line-ct/order.ts — 한 줄 결과물 주문(돈 순서 한 곳 · ★ 2026-10-23 설계서 docs/2026-10-23-oneline-ct-complete-design.md A2)
 *
 * 한 줄 단계 요청(모바일DM · 이메일 · 인앱)의 돈 순서를 이 함수 하나가 소유한다. 라우트는 요청 읽기 · cook(만들기) · 응답 모양만.
 *   시도 잠금 → 한 줄 잠금 → (DM) 같은 시도의 착지 초안 → 같은 시도 냈는가(오늘 · 어제 키) 409 → 금액 확정(다르면 409 · 모름 503)
 *   → 몰 재조회(전부 빠지면 409) → 페이지 대조(409) → 잔액(402 · 던짐) → cook(크레딧 묶음 안 · 던지면 차감 0)
 *   → (DM) 초안 행 저장 → 차감(잔액 부족 = 던짐) → 결말(냄 · 이미 냄 · 미적용만 건넨다 · 그 밖 = 초안 회수 + 503).
 * ⛔ 멱등 payload 는 라우트가 넘긴 값 그대로 키에 쓴다(원장 키 바이트 불변 · 배포를 끼운 재전송이 새 키로 다시 걷지 않게).
 * ⛔ 잠금 · 착지 기억은 프로세스 메모리(pm2 fork 1개 전제 · inflight-lock · line-draft-memo 와 같은 전제).
 * 시험 = deps 를 가짜로 바꿔 끼운다(원장 · 몰 · 페이지 · 잔액 · 차감 · 잠금).
 */
import { voiceFormAsksFor } from '../brand-voice-prompt';
import { decideSentVoiceForm, runWithVoiceForm } from '../voice-form-slots';
import { chargedKeysAmong, checkCredit, deductCreditOutcome, type DeductOutcome } from '../ai-credit';
import { runInCreditBundle } from '../ai-credit-context';
import { tryAcquireInflight, releaseInflight } from '../inflight-lock';
import { resolveLineMallCards, type LineMallCard, type LineMallExcluded } from '../line-mall-cards';
import { resolveLinePage, isLinePageError, type LinePageMaterial, type LinePageError } from '../line-template-page';
import { recallLineDraft, rememberLineDraft, forgetLineDraft, deleteLineDraftWithRetry } from '../line-draft-memo';
import {
  lineStepsAttemptKeys, lineStepsLineLockKey, lineStepsCollected, settleLineStepsPrice, isLineStepsReqError,
  type LineStepsPrepared, type LineStepsReqError, type LineStepsCost,
} from '../line-steps-context';
import type { LineStepsChannel } from '../one-line-steps';
import type { LineProductRef } from '../one-line-facts';
import type { IntegrationActor } from '../integration-scope';

export interface LineOrderDeps {
  tryLock: (key: string) => boolean;
  unlock: (key: string) => void;
  chargedAmong: (companyId: string, keys: string[]) => Promise<Set<string>>;
  settlePrice: typeof settleLineStepsPrice;
  resolveMall: (companyId: string, actor: IntegrationActor, refs: readonly LineProductRef[]) => Promise<{ cards: LineMallCard[]; excluded: LineMallExcluded[] }>;
  resolvePage: (companyId: string, page: { url: string; licensedHashes: readonly string[] }) => Promise<LinePageMaterial | LinePageError>;
  checkCredit: (companyId: string, cost: number) => Promise<void>;
  deduct: typeof deductCreditOutcome;
  inBundle: <T>(fn: () => Promise<T>) => Promise<T>;
  draftMemo: { recall: typeof recallLineDraft; remember: typeof rememberLineDraft; forget: typeof forgetLineDraft };
  deleteWithRetry: typeof deleteLineDraftWithRetry;
}

export function defaultLineOrderDeps(): LineOrderDeps {
  return {
    tryLock: tryAcquireInflight, unlock: releaseInflight, chargedAmong: chargedKeysAmong, settlePrice: settleLineStepsPrice,
    resolveMall: (c, a, r) => resolveLineMallCards(c, a, r), resolvePage: (c, p) => resolveLinePage(c, p),
    checkCredit, deduct: deductCreditOutcome, inBundle: runInCreditBundle,
    draftMemo: { recall: recallLineDraft, remember: rememberLineDraft, forget: forgetLineDraft },
    deleteWithRetry: deleteLineDraftWithRetry,
  };
}

/** 결과를 저장하는 채널(DM 착지 초안) · 돌려주기만 하는 채널(이메일 · 인앱) */
export type LineOrderAdapter<R> =
  | { kind: 'draft'; persist: (r: R) => Promise<string>; discard: (draftId: string) => Promise<unknown>; label: string }
  | { kind: 'return' };

export interface LineOrderInput<R> {
  companyId: string;
  userId?: string;
  channel: LineStepsChannel;
  steps: LineStepsPrepared;
  /** 원장 멱등 지문(라우트의 생성 입력 · 바이트 그대로) */
  payload: unknown;
  /** 같은 시도 토큰 잠금 키(라우트가 지금 쓰는 키 그대로) */
  attemptLockKey: string;
  /** 사람이 고른 몰 상품(상품번호만 · 없으면 재조회 0) */
  products: readonly LineProductRef[] | undefined;
  actor: IntegrationActor;
  /** 읽은 페이지를 다시 얻어 대조할 요청인가(구성 요청 + 페이지 칸) */
  pageCheck: boolean;
  nowMs: number;
  /** 만들기 — 크레딧 묶음 안에서 불린다(안쪽 AI 차감 0) · 던지면 차감 0 · 초안 0 */
  cook: (ctx: { cards: LineMallCard[]; page: LinePageMaterial | null; cost: number }) => Promise<R>;
  adapter: LineOrderAdapter<R>;
  /** ★ 2026-10-29 목소리 꼴 칸 답(요청 본문 voice_form · { link · store · phone } 글 · 비움 = 이 줄 없이) */
  voiceFormRaw?: unknown;
}

export type LineOrderOutcome<R> =
  | { kind: 'made'; result: R; cost: number; completionDue: boolean; breakdown: LineStepsCost; cards: LineMallCard[]; excluded: LineMallExcluded[]; draftId: string | null; idemKey: string }
  | { kind: 'reused'; draftId: string }
  | { kind: 'refused'; status: number; code: string; error: string; extra?: Record<string, unknown> };

const refuse = (status: number, code: string, error: string, extra?: Record<string, unknown>) => ({ kind: 'refused' as const, status, code, error, ...(extra ? { extra } : {}) });
const fromReqError = (e: LineStepsReqError) => refuse(e.status, e.code, e.error, e.cost !== undefined ? { cost: e.cost, breakdown: e.breakdown } : undefined);

/**
 * 주문 한 번. 잔액 부족(사전 확인 · 차감 순간 동시 소진)과 cook 의 오류(LineTemplateError 등)는 던진다 — 라우트의 catch 가 지금처럼 402 · 정해 둔 상태로 바꾼다.
 */
export async function runLineCookOrder<R>(input: LineOrderInput<R>, deps: LineOrderDeps = defaultLineOrderDeps()): Promise<LineOrderOutcome<R>> {
  const { companyId, channel, steps } = input;
  if (!deps.tryLock(input.attemptLockKey)) return refuse(409, 'IN_FLIGHT', '지금 만드는 중이에요. 완성되면 이어서 진행해 주세요.');
  const lineLock = lineStepsLineLockKey(steps, companyId, channel);
  let lineLockHeld = false;
  try {
    // 같은 한 줄 = 금액 확정부터 차감까지 하나씩(다른 시도가 한 줄 완성을 두 번 내지 않게 · Codex 1017 1R)
    if (!deps.tryLock(lineLock)) return refuse(409, 'IN_FLIGHT', '같은 한 줄로 지금 만드는 중이에요. 완성되면 다시 시도해 주세요.');
    lineLockHeld = true;
    // ★ 2026-10-29 꼴 칸 답 → 결정(질문 = 서버가 다시 계산 · 화면이 보낸 질문을 믿지 않는다 · 비움 = 명시 생략) · 꼴 틀림 = 차감 0 거절
    const voiceAsks = (await voiceFormAsksFor(companyId, { kinds: ['marketing', 'notice'], scope: 'tone' })).asks;
    const rawVoice = input.voiceFormRaw && typeof input.voiceFormRaw === 'object' && !Array.isArray(input.voiceFormRaw) ? input.voiceFormRaw as Record<string, unknown> : {};
    // ★ Codex 구현 2R — 요청이 보낸 칸(서버 화이트리스트) = 사람의 결정 · 그 결정만으로 지문(회사 값이 바뀌어도 같은 요청 = 같은 지문)
    //   지금 물을 칸인데 요청에 없는 칸 = 생략(결정 · 지문 밖)
    const voiceDecided = decideSentVoiceForm(voiceAsks, rawVoice as any);
    if (!voiceDecided.ok) return refuse(400, 'VOICE_FORM_INVALID', voiceDecided.error);
    // ★ Codex 구현 1R — 꼴 칸 답만 고친 요청 = 다른 시도(결정이 없으면 옛 지문 그대로)
    const vfPrint = voiceDecided.print;
    const keys = lineStepsAttemptKeys(steps, companyId, channel, vfPrint ? { payload: input.payload, vf: vfPrint } : input.payload);
    const idemKey = keys[0];
    // (DM) 같은 시도의 착지 초안: 낸 것 = 그대로 돌려준다 · 거두지 못한 미과금 초안 = 다시 거둔다(못 거두면 503 · 새로 만들지 않는다 · Codex 1010 2R)
    if (input.adapter.kind === 'draft') {
      const priorKey = keys.find((k) => deps.draftMemo.recall(k) !== null);
      const prior = priorKey ? deps.draftMemo.recall(priorKey) : null;
      if (prior && priorKey) {
        if (prior.state === 'paid') return { kind: 'reused', draftId: prior.draftId };
        const discard = input.adapter.discard;
        if (!(await deps.deleteWithRetry(() => discard(prior.draftId), `${input.adapter.label}=${prior.draftId} company=${companyId}`, companyId))) {
          return refuse(503, 'LINE_DRAFT_PENDING', '잠시 후 다시 시도해 주세요.');
        }
        deps.draftMemo.forget(priorKey);
      }
    }
    // 같은 시도가 이미 냈는가 — 오늘 · 어제 키(자정을 넘긴 재전송) · 조회 실패 = 503(모르는 납부를 0 으로 접지 않는다)
    let charged: boolean;
    try { charged = (await deps.chargedAmong(companyId, keys)).size > 0; } catch {
      return refuse(503, 'CREDIT_STATE_UNKNOWN', '잠시 후 다시 시도해 주세요.');
    }
    if (charged) return refuse(409, 'ALREADY_DONE', '이 요청은 이미 처리됐어요. 다시 만들려면 [만들기]를 한 번 더 눌러 주세요.');
    // 금액 확정(같은 시도 판정 뒤 · 화면 금액과 다르면 409 · AI · 차감 · 몰 조회 전)
    const price = await deps.settlePrice(steps, companyId, channel, input.nowMs);
    if (isLineStepsReqError(price)) return fromReqError(price);
    // 고른 몰 상품은 AI · 차감 앞에서 다시 읽는다(재조회 ok 만 카드 · 전부 빠지면 409 · 0원)
    let cards: LineMallCard[] = [];
    let excluded: LineMallExcluded[] = [];
    if (input.products && input.products.length > 0) {
      const r = await deps.resolveMall(companyId, input.actor, input.products);
      cards = r.cards;
      excluded = r.excluded;
      if (cards.length === 0) return refuse(409, 'MALL_PRODUCTS_UNAVAILABLE', '고른 상품을 지금 쓸 수 없어요. 상품 없이 만들 수 있어요.', { excluded });
    }
    // 읽은 이벤트 페이지 = 서버가 다시 얻어 지문 대조(바뀌었으면 409 · AI · 차감 전 · 0원)
    let page: LinePageMaterial | null = null;
    if (input.pageCheck && steps.body.page) {
      const pg = await deps.resolvePage(companyId, steps.body.page);
      if (isLinePageError(pg)) return refuse(pg.status, pg.code, pg.error);
      page = pg;
    }
    await deps.checkCredit(companyId, price.cost);
    let draftId: string | null = null;
    const made = await deps.inBundle(async () => {
      const result = await runWithVoiceForm(voiceDecided.decision, () => input.cook({ cards, page, cost: price.cost }));
      // (DM) 초안 행을 먼저 만들고 차감한다(응답이 유실돼도 낸 돈의 결과가 남는다 · 1010 계약)
      if (input.adapter.kind === 'draft') draftId = await input.adapter.persist(result);
      let outcome: DeductOutcome | '' = '';
      let thrown: unknown = null;
      try {
        outcome = await deps.deduct({ companyId, cost: price.cost, source: price.source, createdBy: input.userId, idempotencyKey: idemKey, throwOnInsufficient: true });
      } catch (e) { thrown = e; }
      // 낸 것(냄 · 같은 키로 이미 냄 · 크레딧제 미적용)만 건넨다
      if (lineStepsCollected(outcome)) {
        if (draftId) deps.draftMemo.remember(idemKey, draftId, 'paid');
        return result;
      }
      // 원장 쓰기 실패 · 잔액 부족 = 초안을 거둔다(끝내 못 거두면 orphan · 같은 시도의 재요청이 다시 거둔다)
      if (input.adapter.kind === 'draft' && draftId) {
        const id = draftId;
        draftId = null;
        const discard = input.adapter.discard;
        const removed = await deps.deleteWithRetry(() => discard(id), `${input.adapter.label}=${id} company=${companyId}`, companyId);
        if (!removed) deps.draftMemo.remember(idemKey, id, 'orphan');
      }
      if (thrown) throw thrown;
      // 차감 실패 보고(로그 + 운영 경보)는 deductCreditOutcome 이 이미 했다(원장 Z1 · reportCreditMiss) — 여기는 결과를 안 건넨 사실만
      console.log(`[one-line order] 차감 못 함 · 결과 안 건넴 ${channel} company=${companyId} key=${idemKey} cost=${price.cost} outcome=${outcome}`);
      return null;
    });
    if (made === null) {
      return refuse(503, 'CREDIT_STATE_UNKNOWN', input.adapter.kind === 'draft'
        ? '크레딧 기록을 확인하지 못해 만든 초안을 거뒀어요. 잠시 후 다시 시도해 주세요.'
        : '크레딧 기록을 확인하지 못해 결과를 건네지 않았어요. 잠시 후 다시 시도해 주세요.');
    }
    return { kind: 'made', result: made, cost: price.cost, completionDue: price.completionDue, breakdown: price.breakdown, cards, excluded, draftId, idemKey };
  } finally {
    if (lineLockHeld) deps.unlock(lineLock);
    deps.unlock(input.attemptLockKey);
  }
}
