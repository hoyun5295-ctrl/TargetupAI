/**
 * line-steps-context.ts — 한 줄 단계 판정에 넣을 회사 사실 · 한 줄 완성 금액 CT (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-1 · §3-11)
 *
 * 판정 CT(`one-line-steps.ts`)는 순수다 — DB 사실은 여기서 모아 넣는다.
 * ⛔ 사실마다 따로 시도한다. 하나가 실패해도 판정 전체를 멈추지 않고 그 칸만 안전한 기본값(몰 = 모름이면 묻는 쪽 · 홈페이지 없음 · 업로드 불가 · 금액 모름 = null).
 * ⛔ 금액은 원장이 진실이다 — 「오늘 이 한 줄로 한 줄 완성을 냈는가」는 원장 접두 조회(조회 실패 = 모름 = 금액 null · 생성 라우트는 503).
 */
import { listMallProviders } from './mall-providers';
import { getCreditCost } from './ai-credit-calc';
import { hasChargeWithKeyPrefix, chargedKeysAmong, type DeductOutcome } from './ai-credit';
import {
  lineStepsKeyPrefix, lineStepsLegacyKeyPrefix, kstDayOf, lineStepsCharge, sanitizeLineUrl, LINE_COMPLETE_SOURCE, LINE_PRICE, sanitizeLineStepsBody, lineStepsFp, lineUrls, lineFpLockKey, LINE_STEPS_CHANNELS,
  buildLineStepsIdempotencyKey, type LineStepsChannel, type LineStepsBody,
} from './one-line-steps';
import { aiLineBaseKeysOfFp } from './ai-line';
import { isValidAttemptToken } from './one-line-facts';
import { splitLineManualProducts, sanitizeLineCompanyImage, resolveLineLink } from './line-materials';
import { isCompanyImageUrl } from './ai-auto-build-materials';
import type { LineMallCard } from './line-mall-cards';
import type { IntegrationActor } from './integration-scope';

/**
 * 금액 셋(화면 금액 줄 · 설계서 docs/2026-10-22-oneline-ct-design.md §11-3).
 *   generate = 다시 만들기 값(3) · complete = 이번 첫 결과물에서 다시 만들기 값을 뺀 몫 · total = 이번에 낼 값 · judged = 판단 2 를 이미 냈는가.
 */
export interface LineStepsCost { generate: number; complete: number; total: number; judged?: boolean }

/** 한 줄 완성 전체 금액(버튼 라벨 · 한 줄 없이도 · 판단 전) — 입구 무관 15 */
export function lineStepsFullCost(_channel: LineStepsChannel): LineStepsCost {
  return { generate: LINE_PRICE.again, complete: LINE_PRICE.total - LINE_PRICE.again, total: LINE_PRICE.total, judged: false };
}

/**
 * 이 한 줄로 오늘 · 어제 완성을 냈는가 — 새 접두(채널 없음) 오늘 · 어제 + 옛 접두(채널 포함) 세 채널 전부 오늘 · 어제(Codex CT R1 · 전환일에 DM 으로 낸 완성을
 *   이메일 추가가 못 찾아 13 · 15 를 다시 걷던 구멍) · 조회 실패 = 던짐.
 */
async function completionPaidFor(companyId: string, _channel: LineStepsChannel, lineFp: string, nowMs: number): Promise<boolean> {
  const days = [kstDayOf(nowMs), kstDayOf(nowMs - 86_400_000)];
  const prefixes = [
    ...days.map((d) => lineStepsKeyPrefix(companyId, 'dm', d, lineFp)),
    ...days.flatMap((d) => LINE_STEPS_CHANNELS.map((ch) => lineStepsLegacyKeyPrefix(companyId, ch, d, lineFp))),
  ];
  for (const p of prefixes) if (await hasChargeWithKeyPrefix(companyId, LINE_COMPLETE_SOURCE, p)) return true;
  return false;
}

/** 이 한 줄로 오늘 · 어제 판단(2)을 냈는가 — 키 = 문자 입구와 같은 aio-base(원천 무관 · 조회 실패 = 던짐) */
export async function lineJudgePaid(companyId: string, lineFp: string, nowMs: number): Promise<boolean> {
  return (await chargedKeysAmong(companyId, aiLineBaseKeysOfFp(companyId, lineFp, new Date(nowMs)))).size > 0;
}

/**
 * ★ 2026-10-22 판단 몫을 이미 냈는가 — 판단(2)을 냈거나 · 그 한 줄로 오늘 · 어제 완성(첫 결과물 = 판단 몫 포함)을 냈으면 참(Codex CT R2 ·
 *   판단 없이 15 를 먼저 낸 한 줄에 문자 입구 · 판단이 2 를 다시 걷어 17 이 되던 구멍). 판단 정산(콘텐츠 · 문자)은 반드시 이 함수로 본다 · 조회 실패 = 던짐.
 */
export async function lineJudgeCovered(companyId: string, lineFp: string, nowMs: number): Promise<boolean> {
  return (await lineJudgePaid(companyId, lineFp, nowMs)) || (await lineCompletionPaid(companyId, lineFp, nowMs));
}

/** 이 한 줄로 오늘 · 어제 완성(판단 몫 포함)을 냈는가 — 채널 무관 · 옛 접두 포함 · 조회 실패 = 던짐(문자 입구 기본 납부 판정이 이것을 함께 본다) */
export async function lineCompletionPaid(companyId: string, lineFp: string, nowMs: number): Promise<boolean> {
  return completionPaidFor(companyId, 'dm', lineFp, nowMs);
}

/**
 * 이번 생성의 금액 · 원천 · 원장 접두. **조회 실패는 던진다**(호출부 503 · 확인 못 한 금액을 청구도 표시도 하지 않는다).
 */
export async function resolveLineStepsCharge(companyId: string, channel: LineStepsChannel, lineFp: string, nowMs: number): Promise<{ cost: number; source: string; completionDue: boolean; day: string; prefix: string; breakdown: LineStepsCost }> {
  const day = kstDayOf(nowMs);
  const prefix = lineStepsKeyPrefix(companyId, channel, day, lineFp);
  const paid = await completionPaidFor(companyId, channel, lineFp, nowMs);
  const judged = paid ? false : await lineJudgePaid(companyId, lineFp, nowMs);
  const c = lineStepsCharge(paid, judged);
  return { ...c, day, prefix, breakdown: { generate: LINE_PRICE.again, complete: c.completionDue ? c.cost - LINE_PRICE.again : 0, total: c.cost, judged } };
}

export interface LineStepsCompanyFacts {
  mall: boolean;
  mallHome: string | null;
  inappBlocked: boolean;
  upload: boolean;
  website: string | null;
  cost: LineStepsCost | null;
}

/** 판정에 넣을 회사 사실 모으기(칸마다 따로 · 실패 = 그 칸만 기본값) */
export async function loadLineStepsCompanyFacts(companyId: string, actor: IntegrationActor, channel: LineStepsChannel, lineFp: string | null, nowMs: number): Promise<LineStepsCompanyFacts> {
  const out: LineStepsCompanyFacts = { mall: false, mallHome: null, inappBlocked: false, upload: false, website: null, cost: null };
  try {
    const { list, failed } = await listMallProviders(companyId, actor, { relookupOnly: true });
    const relookup = list.filter((p) => p.relookup);
    // 모름(조회 실패)은 「있음」 쪽으로 — 상품 단계가 열리고 후보 조회가 다시 「확인하지 못함」을 알린다(묻는 쪽으로 틀린다)
    out.mall = relookup.length > 0 || failed;
    out.mallHome = relookup.find((p) => p.home)?.home ?? null;
  } catch { out.mall = true; }
  if (channel === 'inapp') {
    try {
      const { getInAppDisplayEligibility } = await import('./inapp-display-eligibility');
      const elig = await getInAppDisplayEligibility(companyId);
      out.inappBlocked = !elig.canCreateWeb;   // 생성 관문(routes/cdp.ts /inapp/ai-generate)과 같은 판정
    } catch { out.inappBlocked = false; }   // 모름 = 막지 않는다(생성 관문이 다시 본다)
  }
  try {
    if (channel === 'email') {
      // 이메일 편집기 사진 업로드 = DM 업로드 창구(모바일 DM 요금제 문) — 문을 못 지나는 회사에 사진 단계를 띄우지 않는다
      const { loadPlanContext, canUseFeature } = await import('./plan-guard');
      const ctx = await loadPlanContext(companyId);
      out.upload = !!ctx && canUseFeature(ctx, 'mobile_dm').allowed;
    } else {
      out.upload = true;   // DM 메뉴 = 모바일 DM 요금제 문 안 · 인앱 = 인앱 업로드 창구
    }
  } catch { out.upload = false; }
  try {
    const { getCompanyBrandKitRaw } = await import('./dm/dm-brand-kit');
    const kit = await getCompanyBrandKitRaw(companyId);
    out.website = sanitizeLineUrl((kit as any)?.contact?.website ?? null);
  } catch { out.website = null; }
  try {
    out.cost = lineFp ? (await resolveLineStepsCharge(companyId, channel, lineFp, nowMs)).breakdown : lineStepsFullCost(channel);
  } catch { out.cost = null; }
  return out;
}

// ─────────────── 생성 라우트 공용(DM · 이메일 · 인앱 · 같은 규칙 한 벌) ───────────────

export interface LineStepsReqError { status: number; code: string; error: string; cost?: number; breakdown?: LineStepsCost }

export interface LineStepsPrepared {
  body: LineStepsBody;
  /** 사진 + 가격이 있는 직접 상품(카드) */
  manualCards: LineMallCard[];
  /** 글로만 소개할 직접 상품(원문 `[상품]` 줄) */
  textProducts: Array<{ name: string; price?: number }>;
  /** 사람이 올린 대표 사진(이 회사 경로 · 없으면 null) */
  hero: string | null;
  /** ★ 2026-10-21 대표 사진 = 스튜디오 헤드라인 포스터(글자 박힘 · 덮지 않는다) */
  heroAsIs: boolean;
  /** 모든 직접 상품의 사진 · 주소(카드가 되지 못한 것 포함 · 넣은 순서) — 대표 사진 · 버튼 주소 재료 */
  manualImages: string[];
  manualUrls: string[];
  /** 원장 지문 · KST 날짜(오늘 · 어제) · 시도 토큰 · 화면이 보인 금액 */
  fp: string;
  day: string;
  prevDay: string;
  token: string;
  expectedCost: number;
}

export function isLineStepsReqError(v: unknown): v is LineStepsReqError {
  return !!v && typeof v === 'object' && typeof (v as LineStepsReqError).status === 'number' && typeof (v as LineStepsReqError).code === 'string';
}

/**
 * 생성 요청의 단계 답 준비. `steps` 칸이 없으면 undefined(지금 그대로) · 틀리면 오류(400 · 조용히 버리지 않는다).
 * ⛔ 단계 요청은 시도 토큰 · 화면 금액(expected_cost)이 반드시 있어야 한다(돈 경로 · 멱등 · 표시 = 차감).
 * ⛔ 사진은 이 회사 업로드 경로만(Harold 결정 H3 · 다른 주소 = 400).
 */
export function prepareLineStepsRequest(
  reqBody: Record<string, unknown> | null | undefined,
  companyId: string,
  rawLine: string,
  reads: readonly string[] | undefined,
  nowMs: number,
  stepsOn: boolean,
): LineStepsPrepared | LineStepsReqError | undefined {
  const body = sanitizeLineStepsBody(reqBody, nowMs);
  if (body === undefined) return undefined;
  if (body === 'invalid') return { status: 400, code: 'LINE_STEPS_INVALID', error: '단계에서 받은 답을 다시 확인해 주세요.' };
  if (!stepsOn) return { status: 400, code: 'FEATURE_DISABLED', error: '이 기능은 아직 열리지 않았습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' };
  const token = (reqBody || {}).attempt_token;
  if (!isValidAttemptToken(token) || body.expectedCost === null) return { status: 400, code: 'LINE_STEPS_INVALID', error: '단계에서 받은 답을 다시 확인해 주세요.' };
  const isCo = (u: string) => isCompanyImageUrl(u, companyId);
  const split = splitLineManualProducts(body.manual, isCo);
  const hero = sanitizeLineCompanyImage(body.heroImage, isCo);
  // ★ 2026-10-22 구성 재료 사진(특징 · 사용 단계 · 분위기)도 이 회사 업로드 경로만(같은 규칙 · H3)
  const richImgs = [...body.rich.points, ...body.rich.usage].map((p) => p.image).filter((u): u is string => !!u).concat(body.rich.mood);
  const richBad = richImgs.some((u) => sanitizeLineCompanyImage(u, isCo) === 'invalid');
  if (split === 'invalid' || hero === 'invalid' || richBad) return { status: 400, code: 'LINE_STEPS_IMAGE_INVALID', error: '사진은 이 화면에서 올린 사진만 쓸 수 있어요. 사진을 다시 올려 주세요.' };
  return {
    body, manualCards: split.cards, textProducts: split.textProducts, hero, heroAsIs: !!hero && body.heroPoster, manualImages: split.images, manualUrls: split.urls,
    // KST 는 일광 절약 시간이 없다 → 24시간 전의 KST 날짜 = 어제
    fp: lineStepsFp(rawLine, reads), day: kstDayOf(nowMs), prevDay: kstDayOf(nowMs - 86_400_000), token, expectedCost: body.expectedCost,
  };
}

/** 원장 멱등키(같은 시도 = 같은 키 · 생성 입력 하나만 바꿔도 새 키 · `steps_meta` 는 넣지 않는다) */
export function lineStepsKeyFor(p: LineStepsPrepared, companyId: string, channel: LineStepsChannel, payload: unknown): string {
  return buildLineStepsIdempotencyKey(companyId, channel, p.day, p.fp, p.token, payload);
}

/**
 * 같은 시도가 이미 냈는가 — **오늘 키와 어제(KST) 키를 함께** 본다(Codex 1017 1R).
 *   키에 날짜가 들어가 23:59 에 낸 시도가 응답을 잃고 00:00 에 같은 토큰 · 같은 입력으로 다시 오면 오늘 키로는 못 찾아 다시 차감했다.
 *   시도 토큰은 [만들기]마다 새것이라 어제 키와 맞는 것은 같은 시도의 재전송뿐이다. 조회 실패 = 던진다(호출부 503).
 */
export async function lineStepsAttemptCharged(p: LineStepsPrepared, companyId: string, channel: LineStepsChannel, payload: unknown): Promise<boolean> {
  return (await chargedKeysAmong(companyId, lineStepsAttemptKeys(p, companyId, channel, payload))).size > 0;
}

/**
 * 같은 시도의 키 목록(오늘 키 → 어제 키) — 같은 시도를 알아보는 모든 자리(원장 판정 · DM 착지 초안 기억)가 이 목록 하나를 쓴다
 *   (Codex 1017 2R: 원장만 두 키로 보고 초안 기억은 오늘 키만 봐서, 자정 전 거두지 못한 미과금 초안을 자정 뒤 재전송이 건너뛰었다).
 */
export function lineStepsAttemptKeys(p: LineStepsPrepared, companyId: string, channel: LineStepsChannel, payload: unknown): string[] {
  return [p.day, p.prevDay].map((day) => buildLineStepsIdempotencyKey(companyId, channel, day, p.fp, p.token, payload));
}

/**
 * 한 줄 단위 잠금 키(회사 · 채널 · KST 날짜 · 한 줄 지문) — 금액 확정부터 차감까지 같은 한 줄의 요청을 하나씩만(Codex 1017 1R).
 *   다른 시도 토큰 두 개가 동시에 「아직 안 냈다」로 읽어 한 줄 완성이 두 번 붙던 경합을 막는다. 뒤 요청 = 409 IN_FLIGHT →
 *   다시 보내면 원장에 한 줄 완성이 있어 금액이 생성비로 바뀌고(PRICE_CHANGED) 사람이 확인한 뒤 만든다.
 *   메모리 잠금이라 프로세스 1개(pm2 fork · `inflight-lock.ts` 전제)에서만 유효하다.
 */
export function lineStepsLineLockKey(p: LineStepsPrepared, companyId: string, _channel: LineStepsChannel): string {
  // ★ 2026-10-22 날짜 · 채널 없는 한 줄 키(판단 정산과 같은 키 · Codex CT R1)
  return lineFpLockKey(companyId, p.fp);
}

/**
 * 결과를 건넬 수 있는 차감 결말(냄 · 같은 키로 이미 냄 · 크레딧제 미적용 면제) — 그 밖(`failed`)은 결과를 건네지 않는다(Codex 1017 1R ·
 *   세 채널 한 규칙 · DM 착지와 같은 집합). 잔액 부족은 `throwOnInsufficient` 로 따로 던진다.
 */
export function lineStepsCollected(outcome: DeductOutcome | ''): boolean {
  return outcome === 'deducted' || outcome === 'duplicate' || outcome === 'not_applicable';
}

/**
 * 금액 확정 — 원장 조회 실패 = 503(모르는 금액을 청구하지 않는다) · 화면이 보인 금액과 다르면 409 PRICE_CHANGED(AI · 차감 전 · 새 금액 동봉).
 * 같은 시도 재요청 판정(isChargedByKey)은 이 함수 **앞에서** 끝내야 한다(이 시도가 이미 냈으면 금액이 생성비로 내려가 오판한다).
 */
export async function settleLineStepsPrice(p: LineStepsPrepared, companyId: string, channel: LineStepsChannel, nowMs: number): Promise<{ cost: number; source: string; completionDue: boolean; breakdown: LineStepsCost } | LineStepsReqError> {
  let charge: Awaited<ReturnType<typeof resolveLineStepsCharge>>;
  try {
    charge = await resolveLineStepsCharge(companyId, channel, p.fp, nowMs);
  } catch {
    return { status: 503, code: 'CREDIT_STATE_UNKNOWN', error: '잠시 후 다시 시도해 주세요.' };
  }
  if (charge.cost !== p.expectedCost) {
    return { status: 409, code: 'PRICE_CHANGED', error: `금액이 ${charge.cost}크레딧으로 바뀌었어요. 확인한 뒤 다시 만들어 주세요.`, cost: charge.cost, breakdown: charge.breakdown };
  }
  return { cost: charge.cost, source: charge.source, completionDue: charge.completionDue, breakdown: charge.breakdown };
}

/**
 * 버튼 주소 · 대표 사진 확정(서버가 정한다 · 설계서 §3-8 · §3-9).
 *   주소 = 답 → 한 줄 주소 → 첫 확정 상품 링크 → 회사 홈페이지 → 몰 첫 화면.
 *   사진 = 사람이 올린 사진 → (DM · 인앱) 담은 상품 사진 · (이메일) 직접 올린 상품 사진만(몰 사진은 외부 주소 · 메일 첫 화면에 쓰지 않는다).
 */
export async function resolveLineStepsDelivery(
  companyId: string,
  actor: IntegrationActor,
  p: LineStepsPrepared,
  input: { channel: LineStepsChannel; line: string; cards: readonly LineMallCard[]; companyKitRaw?: Record<string, unknown> | null },
): Promise<{ link: string | null; hero: string | null }> {
  const answer = p.body.facts.link ?? null;
  const lineUrl = lineUrls(input.line)[0] ?? null;
  let website: string | null = null;
  try {
    const kit = input.companyKitRaw !== undefined ? input.companyKitRaw : await (await import('./dm/dm-brand-kit')).getCompanyBrandKitRaw(companyId);
    website = sanitizeLineUrl((kit as any)?.contact?.website ?? null);
  } catch { website = null; }
  let mallHome: string | null = null;
  if (!answer && !lineUrl && !input.cards.some((c) => c.link_url) && p.manualUrls.length === 0 && !website) {
    try { mallHome = (await listMallProviders(companyId, actor, { relookupOnly: true })).list.find((x) => x.home)?.home ?? null; } catch { mallHome = null; }
  }
  const link = resolveLineLink({ answer, lineUrl, cards: input.cards, manualUrls: p.manualUrls, website, mallHome });
  // 화면의 건너뜀 조건과 같은 재료: DM · 인앱 = 담은 상품(사진 있는 첫 카드) → 직접 넣은 상품 사진 · 이메일 = 직접 넣은 상품 사진만
  const hero = p.hero
    || (input.channel === 'email' ? (p.manualImages[0] ?? null) : (input.cards.find((c) => c.image_url)?.image_url ?? p.manualImages[0] ?? null));
  return { link, hero };
}
