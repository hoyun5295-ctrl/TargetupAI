/**
 * sender-line-limit.ts — 발신번호 회선 수 제한 컨트롤타워 (★2026-08-18 전송자격인증 2.1)
 *
 * 인증기준이 요구하는 것
 *   "계정당 등록 가능한 발신번호는 이용자 유형별로 회선 수를 제한하고, 초과 등록할 수 없도록
 *    **시스템적으로 통제**되어야 한다. 단순 수기 대장 관리는 부적합하다."
 *   기준값 — 무선: 개인 3 · 외국인 2 · 법인 4 / 유선: 개인 5 · 법인 n(= 종사자 수)
 *
 * ⛔ 기존 보유분은 건드리지 않는다 — 상한은 **신규 등록에만** 걸린다
 *   기준이 요구하는 것은 "초과하여 등록할 수 없도록"이지 보유 번호 회수가 아니다.
 *   이미 상한을 넘겨 보유 중이면 새 등록만 거부하고 기존 번호는 그대로 쓴다.
 *
 * ⛔ 법인 상한을 코드에 고정하지 않는다 (★0818 실측이 뒤집은 판단)
 *   실측 — 유선 보유 상위가 벤제프 182 · 제시뉴욕 175 · 금강제화 159 · 시세이도 117이다.
 *   전부 **매장별 대표번호**이고(`callback_numbers.store_code`), 종사자 수가 수백인 법인이라 기준 안이다.
 *   기준 자체가 "법인 n = 종사자 수"로 열어 뒀고, "법인 대표번호·공동 사용번호는 증빙 재사용"을 따로 규정한다.
 *   ⇒ 법인 상한은 **슈퍼관리자가 회사별로 설정**한다(종사자 수 확인 자료 기준). 미설정이면 제한 없음 = 현행 유지.
 *   초기값을 임의로 박으면 매장이 늘 때마다 정상 고객사가 막힌다.
 *
 * ⛔ 개인·외국인은 기준값 고정이다 — 여기는 우리가 정할 여지가 없다.
 */

import { query } from '../config/database';

/** 이용자 유형 — companies.subscriber_type */
export type SubscriberType = 'individual' | 'foreigner' | 'corporate';

export interface LineLimits {
  /** 무선 상한. null = 제한 없음 */
  mobile: number | null;
  /** 유선 상한. null = 제한 없음 */
  landline: number | null;
  /** 이 상한이 어디서 왔나 — 화면·심사 설명용 */
  source: 'standard' | 'company_setting' | 'unset';
}

/** 개인·외국인 기준값(가이드라인 2.1 원문) */
const PERSONAL_LIMITS: Record<'individual' | 'foreigner', { mobile: number; landline: number }> = {
  individual: { mobile: 3, landline: 5 },
  foreigner: { mobile: 2, landline: 5 },
};

/** 휴대폰(무선) 식별 — 국내 이동통신 식별번호 */
export function isMobileNumber(phone: any): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('82') ? `0${digits.slice(2)}` : digits;
  return /^01[016789]\d{7,8}$/.test(local);
}

export type LineKind = 'mobile' | 'landline';

export function lineKindOf(phone: any): LineKind {
  return isMobileNumber(phone) ? 'mobile' : 'landline';
}

/**
 * 회사의 상한을 정한다.
 * - 개인·외국인 → 기준값 고정(회사 설정을 무시한다. 기준이 정한 값이다)
 * - 법인 → 회사별 설정값. 없으면 제한 없음
 * - 유형 미설정 → 제한 없음(현행 유지). 심사 전 전량 설정이 운영 과제다
 */
export function resolveLineLimits(params: {
  subscriberType: any;
  mobileLimit: any;
  landlineLimit: any;
}): LineLimits {
  const type = String(params.subscriberType || '').trim();

  if (type === 'individual' || type === 'foreigner') {
    return { ...PERSONAL_LIMITS[type], source: 'standard' };
  }

  const toLimit = (v: any): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };
  const mobile = toLimit(params.mobileLimit);
  const landline = toLimit(params.landlineLimit);

  if (type === 'corporate') {
    return { mobile, landline, source: mobile === null && landline === null ? 'unset' : 'company_setting' };
  }

  // 유형 미설정 — 회사별 설정이 있으면 그것만 적용한다
  return { mobile, landline, source: mobile === null && landline === null ? 'unset' : 'company_setting' };
}

/** 판정 결과 — 불리언으로 접지 않는다(통과 / 초과 / 제한없음은 서로 다른 사실이다) */
export type LineLimitVerdict =
  | { status: 'ok'; kind: LineKind; current: number; limit: number }
  | { status: 'unlimited'; kind: LineKind; current: number }
  | { status: 'exceeded'; kind: LineKind; current: number; limit: number; message: string };

const KIND_LABEL: Record<LineKind, string> = { mobile: '무선', landline: '유선' };

/**
 * 번호 하나를 더 등록할 수 있는가.
 * `current`는 **같은 축(유선/무선)의 현재 보유 수**다 — 총합으로 세면 한쪽 축의 위반이 통과한다.
 */
export function evaluateLineAddition(params: {
  phone: any;
  limits: LineLimits;
  currentMobile: number;
  currentLandline: number;
}): LineLimitVerdict {
  const { phone, limits, currentMobile, currentLandline } = params;
  const kind = lineKindOf(phone);
  const current = kind === 'mobile' ? currentMobile : currentLandline;
  const limit = kind === 'mobile' ? limits.mobile : limits.landline;

  if (limit === null) return { status: 'unlimited', kind, current };

  if (current >= limit) {
    return {
      status: 'exceeded',
      kind,
      current,
      limit,
      message: `${KIND_LABEL[kind]} 발신번호는 최대 ${limit}회선까지 등록할 수 있습니다. (현재 ${current}회선)`,
    };
  }

  return { status: 'ok', kind, current, limit };
}

/** DDL 미적용 감지 — 호출부가 503 DB_MIGRATION_PENDING으로 돌려주기 위한 판정 */
export function isLineLimitSchemaMissing(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('column') && msg.includes('does not exist');
}

/**
 * 회사의 상한과 현재 보유 수를 읽어 신규 등록 가능 여부를 판정한다.
 * **발신번호가 실제로 만들어지는 길목 전부**가 이 함수를 지난다(슈퍼 직접 추가 · 고객사 추가 · 신청 승인).
 *
 * ⚠ 보유 수는 유선/무선을 나눠 센다. 번호 판별은 DB가 아니라 여기서 한다 —
 *   판별 규칙이 SQL과 코드 두 곳에 흩어지면 조용히 갈린다.
 */
export async function checkSenderLineLimit(companyId: string, phone: string): Promise<LineLimitVerdict> {
  const companyRes = await query(
    'SELECT subscriber_type, mobile_line_limit, landline_line_limit FROM companies WHERE id = $1',
    [companyId]
  );
  const company = companyRes.rows[0] || {};
  const limits = resolveLineLimits({
    subscriberType: company.subscriber_type,
    mobileLimit: company.mobile_line_limit,
    landlineLimit: company.landline_line_limit,
  });

  // 상한이 양쪽 다 없으면 세어볼 필요가 없다(현행 유지 = 제한 없음)
  if (limits.mobile === null && limits.landline === null) {
    return { status: 'unlimited', kind: lineKindOf(phone), current: 0 };
  }

  const { mobile: currentMobile, landline: currentLandline } = await countCompanyLines(companyId);

  return evaluateLineAddition({ phone, limits, currentMobile, currentLandline });
}

/**
 * 회사가 보유한 발신번호를 유선/무선으로 나눠 센다.
 * ⚠ 판별을 SQL 정규식으로 하지 않는다 — 규칙이 SQL과 코드 두 곳에 흩어지면 조용히 갈린다.
 *   화면 표시용 카운트도 이 함수를 써서 판정과 같은 수를 본다.
 */
export async function countCompanyLines(companyId: string): Promise<{ mobile: number; landline: number }> {
  const held = await query('SELECT phone FROM callback_numbers WHERE company_id = $1', [companyId]);
  let mobile = 0;
  let landline = 0;
  for (const row of held.rows) {
    if (isMobileNumber(row.phone)) mobile += 1;
    else landline += 1;
  }
  return { mobile, landline };
}

/** 화면용 — 현재 정책과 보유 수를 한 번에 */
export async function getSenderLinePolicy(companyId: string) {
  const companyRes = await query(
    'SELECT subscriber_type, mobile_line_limit, landline_line_limit FROM companies WHERE id = $1',
    [companyId]
  );
  const company = companyRes.rows[0] || {};
  const limits = resolveLineLimits({
    subscriberType: company.subscriber_type,
    mobileLimit: company.mobile_line_limit,
    landlineLimit: company.landline_line_limit,
  });
  const held = await countCompanyLines(companyId);
  return {
    subscriberType: company.subscriber_type || null,
    mobileLineLimit: company.mobile_line_limit ?? null,
    landlineLineLimit: company.landline_line_limit ?? null,
    effective: limits,
    held,
  };
}
