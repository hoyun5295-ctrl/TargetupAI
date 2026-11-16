/**
 * journey-message-render.ts — 여정 문자 칸(SMS · LMS · MMS) 하나를 한 고객에게 보낼 글로 만든다 (★ 2026-10-23 여정 결함 0 · 문안 한 곳)
 *
 * 왜 있나
 *   같은 문안을 실행기(journey-executor) · 미리보기(preview-message) · 사전검사(runStepSpamTest · 켜기 검증과 발송 2시간 전 재검사)가
 *   따로 조립했다. 그래서 미리보기에만 빈 칸 대체값이 들어가고, 실발송에만 고객사 고유 칸 · Liquid 회사 이름 · 예측 점수 분기 ·
 *   날씨 · 장바구니 값이 들어갔다. 검사는 저장된 광고 표시를 그대로 써서 실발송이 강제로 붙이는 (광고) · 080 없이 검사했다.
 *   (같은 부류 전력: 0603 스팸검사 본문 ≠ 발송 · 0605 미리보기 통일 뒤 0622 대체값이 미리보기에만 붙음)
 *   → 세 자리가 이 함수 하나를 부른다. 미리보기 = 검사 = 실발송.
 *
 * 다른 것 하나: 링크 줄이기(short-url)는 실제 발송에서만 만든다(미리보기 · 검사가 추적 링크를 만들면 안 된다).
 */
import { query } from '../config/database';
import { prepareSendMessage, prepareFieldMappings, getOpt080Number, findVarTokens, buildAdMessage } from './messageUtils';
import { sanitizeUnsendableForSms } from './message-sanitizer';
import { resolveJourneyAdFlag } from './journey-ad-policy';
import { journeyCopyIssue, type JourneyCopyIssue } from './send-placeholder-gate';   // ★ 2026-11-02 보낼 글 판정 CT(설계서 3-0 CT-J10)
import { latestSnapshotSql, loadStepVariantRows, stepSendVersions } from './journey-step-versions';
import { hasRecoMark, maskRecoSlot, fillRecoSlot, RecoSlotLostError } from './reco-slot';   // ★ 2026-11-13 C133 F2 ① 추천 상품 자리
import { recoTextFor } from './product-reco';
import { v3LiveState } from './v3-stage';

export type JourneySmsType = 'SMS' | 'LMS' | 'MMS';

export function journeySmsType(channel: string | null | undefined): JourneySmsType {
  const c = String(channel || 'lms').toUpperCase();
  return c === 'LMS' || c === 'MMS' ? c : 'SMS';
}

export interface JourneySmsRenderInput {
  companyId: string;
  /** 여정 작성자 — 무료수신거부 080 번호를 이 사람 기준으로 고른다(발송과 같다). */
  createdBy: string | null;
  template: string;
  subject: string | null;
  channel: string;
  /** 저장된 광고 표시 그대로 넘긴다 — 문자 칸은 resolveJourneyAdFlag 가 늘 광고로 본다(정보통신망법 · 발송과 같은 판정). */
  isAd: boolean | null | undefined;
  /** 고객 행 전체(SELECT * · custom_fields 포함). 없으면 변수 자리는 비운다(발송 치환과 같은 규칙). */
  customer: Record<string, any> | null;
  /** ★ 2026-11-02 묶음 발송 — 회사 단위 값(묶음마다 한 번 · loadJourneyRenderShared) · 없으면 지금처럼 호출마다 읽는다 */
  shared?: JourneyRenderShared;
  /** ★ 2026-11-02 묶음 발송 — 이 고객 예측 값을 미리 읽었으면(enrichCustomersWithPredictions) 그대로 쓴다 */
  predictionsPreloaded?: boolean;
  /**
   * ★ 2026-11-13 C133 F2 ① — 추천 자리를 이 판으로 강제(검사 · 미리보기 · 0 ~ 후보 수 − 1 = 그 후보 · 후보 수 = 대체 문장).
   *   안 주면 그 고객으로 고른다(실발송 · product-reco pickRecoIndex). 자리가 없는 본문에는 아무 뜻이 없다.
   */
  recoIndex?: number;
}

/** ★ 2026-11-02 렌더 회사 단위 값(필드 매핑 · 080 · 회사 이름) — 같은 값이라 묶음마다 한 번 읽는다(결과 글자 같음) */
export interface JourneyRenderShared {
  fieldMappings: Awaited<ReturnType<typeof prepareFieldMappings>>;
  opt080Number: string;
  company: { name: string; brand_name: string };
}
export async function loadJourneyRenderShared(companyId: string, createdBy: string | null): Promise<JourneyRenderShared> {
  const fieldMappings = await prepareFieldMappings(companyId);
  const opt080Number = await getOpt080Number(createdBy, companyId);
  // Liquid 회사 정보({{ company.name }} · {{ company.brand_name }})
  const companyRes = await query(`SELECT company_name, brand_name FROM companies WHERE id = $1::uuid`, [companyId]);
  return { fieldMappings, opt080Number, company: { name: companyRes.rows[0]?.company_name || '', brand_name: companyRes.rows[0]?.brand_name || '' } };
}

/**
 * ★ 2026-11-02 보낼 글 판정(send-placeholder-gate journeyCopyIssue)의 회사 값 — 매핑 이름 = 렌더(loadJourneyRenderShared)와 같은 prepareFieldMappings ·
 *   장바구니 여정 = 시작 사건이 장바구니(설계서 3-13 · CT-J10).
 */
export async function journeyCopyContext(
  companyId: string, triggerEvent: string | null | undefined,
  /** 판정할 본문 — %변수% 가 하나도 없으면 매핑을 읽지 않는다(볼 이름이 없다) */
  bodies: Array<string | null | undefined>,
  /** ★ 2026-11-13 C133 F2 ① — 그 칸이 문안 A/B 를 쓰는가(켜기 관문 · 켜기 검증 · 칸 저장이 넘긴다 · 추천 자리 판정) */
  hasVariants: boolean = false,
): Promise<{ knownVarNames: ReadonlySet<string>; cartJourney: boolean; recoAllowed: boolean; hasVariants: boolean }> {
  const hasVar = bodies.some((t) => findVarTokens(String(t || '')).length > 0);
  return {
    knownVarNames: hasVar ? new Set(Object.keys(await prepareFieldMappings(companyId))) : new Set<string>(),
    cartJourney: String(triggerEvent || '') === CART_TRIGGER_EVENT,
    // ★ 2026-11-13 C133 F2 ① — 추천 자리가 든 본문이 있을 때만 단계 개방을 읽는다(없으면 조회 0). 닫힘이 확인된 회사만 막는다:
    //   요금제를 못 읽은 순간(모름)에 이미 검사를 지난 글을 멈추지 않는다 — 나가는 것은 어느 갈래든 담당자가 본 후보 · 대체 문장이다.
    recoAllowed: bodies.some((t) => hasRecoMark(t)) ? (await v3LiveState('reco', companyId)) !== 'closed' : false,
    hasVariants,
  };
}
/** 장바구니 시작 사건(대상 추출 journey-target-extractor 의 갈래 이름 · 장바구니 값 {{ cart.* }} 이 그 고객 장바구니) */
export const CART_TRIGGER_EVENT = 'cdp.cart_abandon';

/** ★ 2026-11-02 그 칸이 지금 보낼 판(최신 판 + 변이 = stepSendVersions)의 보낼 글 판정 — 보내기 전 검사 밖 소비처(담당자 안내 문구 · 상황판)가 부른다 */
export async function journeyStepCopyIssueNow(companyId: string, journeyId: string, stepId: string, triggerEvent: string | null | undefined): Promise<JourneyCopyIssue | null> {
  const snap = (await query(`SELECT snap.message_body, snap.message_subject FROM ${latestSnapshotSql('$2::uuid', '$1::uuid')} snap`, [stepId, journeyId])).rows[0] ?? null;
  const st = (await query(`SELECT message_template, subject FROM journey_steps WHERE id = $1::uuid`, [stepId])).rows[0] ?? {};
  const versions = stepSendVersions({ message_template: st.message_template ?? null, subject: st.subject ?? null }, snap, await loadStepVariantRows(stepId));
  const bodies = versions.map((v) => v.body);
  return journeyCopyIssue({ bodies, subjects: versions.map((v) => v.subject) }, await journeyCopyContext(companyId, triggerEvent, bodies));
}

export interface JourneySmsRendered {
  message: string;
  subject: string;
  msgType: JourneySmsType;
  isAd: boolean;
}

export async function renderJourneySmsMessage(input: JourneySmsRenderInput): Promise<JourneySmsRendered> {
  const msgType = journeySmsType(input.channel);
  const isAd = resolveJourneyAdFlag(input.channel, input.isAd ?? undefined);
  const { fieldMappings, opt080Number, company } = input.shared ?? await loadJourneyRenderShared(input.companyId, input.createdBy);

  // ★ 2026-11-13 C133 F2 ① — 추천 자리(맞는 꼴 하나)를 맨 앞에서 영문 · 숫자 표식으로 바꿔 둔다. 자리가 없으면 reco = null · template = 원문 그대로.
  const reco = maskRecoSlot(String(input.template || ''));
  const template = reco ? reco.template : String(input.template || '');
  let customer: Record<string, any> | null = input.customer;
  let externalContext: Record<string, any> = {};
  if (customer) {
    // 예측 점수(click_score · churn_risk · purchase_likelihood) — 실패해도 원본 고객 그대로(발송 차단 X)
    if (!input.predictionsPreloaded) {
      const { enrichCustomerWithPredictions } = await import('./predictive-suite');
      customer = await enrichCustomerWithPredictions(customer, input.companyId);
    }
    try {
      // 외부 실시간 값(날씨 · 재고 · 가격 · 신상품) — Liquid 변수가 있을 때만 부른다
      const { enrichLiquidContextWithExternal } = await import('./connected-content');
      externalContext = await enrichLiquidContextWithExternal(
        template,
        input.companyId,
        customer.region || null,
        customer.recent_purchase_store || customer.registered_store || null,
      );
    } catch (err: any) {
      console.warn('[journey-message-render] Connected Content skip:', err?.message);
    }
    try {
      // 장바구니 리커버리({{ cart.product_name }} 등) — 템플릿에 {{ cart.* }} 가 없으면 조회하지 않는다
      const { enrichLiquidContextWithCart } = await import('./cdp-events');
      const cartContext = await enrichLiquidContextWithCart(template, input.companyId, customer.id || null);
      if (cartContext && Object.keys(cartContext).length > 0) externalContext = { ...externalContext, ...cartContext };
    } catch (err: any) {
      console.warn('[journey-message-render] cart context skip:', err?.message);
    }
  }

  // 보낼 수 없는 글자만 정리(보낼 수 있는 글자는 바꾸지 않는다 · B-0910-5)
  const sanTemplate = sanitizeUnsendableForSms(template);
  const sanSubject = sanitizeUnsendableForSms(String(input.subject || ''));
  if (sanTemplate.hadChanges) console.log('[journey-message-render] 본문 sanitize:', sanTemplate.warnings.join(' / '));
  if (sanSubject.hadChanges) console.log('[journey-message-render] 제목 sanitize:', sanSubject.warnings.join(' / '));

  const prep = prepareSendMessage(sanTemplate.sanitized, customer, fieldMappings, {
    msgType,
    isAd,
    opt080Number,
    subject: sanSubject.sanitized,
    company,
    externalContext,
  });
  if (!reco) return { message: prep.message, subject: prep.subject, msgType, isAd };
  // 기존 길(글자 정리 · %변수% · Liquid · 광고 표기)이 끝난 뒤에 표식을 고른 글자로 — 고른 글자는 변수 · 조건 문법으로 다시 읽히지 않는다.
  //   넣는 글자도 본문과 같은 글자 정리를 거친다(후보는 저장 때 「그대로 나가는 글자」만 받으므로 바뀌는 글자가 없어야 정상).
  //   ★ Codex 구현 3R #1 — 채우는 이 자리가 마지막 판정: 표식이 정확히 한 번 있어야 한다. 아니면 던진다(RecoSlotLostError).
  //   Liquid 출력 값이 중괄호를 내거나(고객 값 포함) 남은 태그 지우기가 표식을 함께 지우는 꼴은 고객마다 달라 미리 읽는 판정으로 다 막을 수 없다.
  //   부르는 쪽: 검사 = 통과 아님(고칠 글) · 실행기 = 그 고객 미발송 · 미리보기 = 사유 문장. 표식을 먼저 확인한다(없으면 고르기 조회도 하지 않는다).
  if (fillRecoSlot(prep.message, reco.token, '') === null) throw new RecoSlotLostError();
  const chosen = await recoTextFor(reco.slot, { companyId: input.companyId, customerId: input.customer?.id ?? null, recoIndex: input.recoIndex });
  const filled = fillRecoSlot(prep.message, reco.token, sanitizeUnsendableForSms(chosen).sanitized);
  if (filled === null) throw new RecoSlotLostError();
  return { message: filled, subject: prep.subject, msgType, isAd };
}

/**
 * ★ 2026-11-16 C139(뿌리 R98 · 설계서 docs/2026-11-16-c139-results-display-design.md 2-1) — 여정 단계 캠페인 행의 대표 본문(문자 칸).
 *   = 위 렌더와 같은 차례(추천 자리 가림 → 보낼 수 없는 글자 정리 → (광고) 머리 · 080 꼬리 = buildAdMessage)에서 **고객 값만 넣지 않은 글**.
 *   변수(%…%) · Liquid · 외부 값 · 예측 값 · 추천 고르기는 하지 않는다(DB · 망 호출 0). 추천 자리는 표식 글 그대로 되돌린다.
 *   머리 · 꼬리를 붙이는가 = 원문(변수 · 추천 자리를 가린 채)의 고정 글자로 판정한다 — 변수 값이 판정을 바꾸는 고객(값이 「(광고)」로 시작 ·
 *   「무료수신거부」를 담음)은 받은 글과 이 글이 다르다(대표 본문은 한 고객의 글이 아니다 · 시험 c139-results-display R98-3 반례).
 *   ⛔ 발송 결과 화면 · 캘린더 · 통계 · AI 참고 글이 이 칸을 다시 그린다 — 고객에게 채운 글을 넣지 않는다(옛: 첫 고객의 렌더 결과).
 */
export function journeySmsDisplayCopy(input: { template: string | null | undefined; channel: string | null | undefined; isAd: boolean | null | undefined; opt080Number: string }): string {
  const src = String(input.template || '');
  if (!src.trim()) return '';
  const msgType = journeySmsType(input.channel);
  const isAd = resolveJourneyAdFlag(String(input.channel || 'lms'), input.isAd ?? undefined);
  const reco = maskRecoSlot(src);
  const sanitized = sanitizeUnsendableForSms(reco ? reco.template : src).sanitized;
  const wrapped = buildAdMessage(sanitized, msgType, isAd, input.opt080Number);
  if (!reco) return wrapped;
  // 표식은 본문에 한 번 있다(buildAdMessage 는 본문 글자를 지우거나 늘리지 않는다) · 그래도 못 되돌리면 표식 글이 새지 않게 가리지 않은 원문으로
  return fillRecoSlot(wrapped, reco.token, reco.slot.raw) ?? buildAdMessage(sanitizeUnsendableForSms(src).sanitized, msgType, isAd, input.opt080Number);
}

/**
 * 이 여정 대상 고객 중 한 명(행 전체) — 미리보기 · 검사가 실제 받는 사람 기준으로 글을 만든다.
 * 대상 추출 = 발송과 같은 함수 · 같은 범위 · 같은 동의(자동 완화 X). 대상이 없으면 null.
 */
export async function pickJourneySampleCustomer(companyId: string, journeyId: string | null | undefined): Promise<Record<string, any> | null> {
  if (!journeyId) return null;
  const jr = await query('SELECT trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid', [journeyId, companyId]);
  const j = jr.rows[0];
  if (!j?.trigger_event) return null;
  try {
    const { selectJourneyTargetCustomerIds } = await import('./journey-target-extractor');
    const { getJourneyOwnerScopeSql } = await import('./store-scope');
    const { journeyOwnerConsent } = await import('./mall-consent');
    const ids = await selectJourneyTargetCustomerIds(
      companyId, j.trigger_event, j.trigger_filters || {}, 50, undefined, undefined,
      await getJourneyOwnerScopeSql(companyId, journeyId), await journeyOwnerConsent(companyId, journeyId),
    );
    if (ids.length === 0) return null;
    const cr = await query(
      `SELECT * FROM customers
        WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
        ORDER BY recent_purchase_amount DESC NULLS LAST, total_purchase_amount DESC NULLS LAST LIMIT 1`,
      [companyId, ids],
    );
    return cr.rows[0] || null;
  } catch {
    return null;   // 대상 추출 실패 = 표본 없음(미리보기는 변수 자리를 비워 보인다)
  }
}
