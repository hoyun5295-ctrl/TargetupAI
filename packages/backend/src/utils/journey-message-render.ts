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
import { prepareSendMessage, prepareFieldMappings, getOpt080Number } from './messageUtils';
import { sanitizeUnsendableForSms } from './message-sanitizer';
import { resolveJourneyAdFlag } from './journey-ad-policy';

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
  const fieldMappings = await prepareFieldMappings(input.companyId);
  const opt080Number = await getOpt080Number(input.createdBy, input.companyId);
  // Liquid 회사 정보({{ company.name }} · {{ company.brand_name }})
  const companyRes = await query(`SELECT company_name, brand_name FROM companies WHERE id = $1::uuid`, [input.companyId]);
  const company = { name: companyRes.rows[0]?.company_name || '', brand_name: companyRes.rows[0]?.brand_name || '' };

  const template = String(input.template || '');
  let customer: Record<string, any> | null = input.customer;
  let externalContext: Record<string, any> = {};
  if (customer) {
    // 예측 점수(click_score · churn_risk · purchase_likelihood) — 실패해도 원본 고객 그대로(발송 차단 X)
    const { enrichCustomerWithPredictions } = await import('./predictive-suite');
    customer = await enrichCustomerWithPredictions(customer, input.companyId);
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
  return { message: prep.message, subject: prep.subject, msgType, isAd };
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
