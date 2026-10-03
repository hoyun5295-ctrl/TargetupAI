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
 *
 * ★2026-10-03 D-8 (3차 반려 대조) — 고시의 「무선 법인 4」는 **계정당**이다. 회사 단위 · 미설정 무제한은 그 단위와 다르다.
 *   스위치 `SENDER_LINE_PER_ACCOUNT_ENABLED=true` 일 때만 법인의 무선 상한 = 활성 계정 수 × 4.
 *   회사 설정이 있으면 둘 중 작은 값(설정은 좁히기만 한다 · 기준보다 넓힐 수 없다).
 *   ⛔ 기본은 꺼짐 = 종전 그대로. 고객사별 무선 보유 · 활성 계정 현황을 실측하기 전에는 켜지 않는다(Harold 1003 지시).
 *   ⛔ 가입자 유형 미설정 회사에는 걸지 않는다 — 유형을 모르면 기준(개인 3 · 법인 계정×4)을 고를 수 없다. 켜기 전에 유형 전량 설정이 선행이다.
 *   ⛔ 유선은 바꾸지 않는다(법인 유선 = 종사자 수 · 회사 설정).
 */

import { query } from '../config/database';

/** 이용자 유형 — companies.subscriber_type */
export type SubscriberType = 'individual' | 'foreigner' | 'corporate';

export interface LineLimits {
  /** 무선 상한. null = 제한 없음 */
  mobile: number | null;
  /** 유선 상한. null = 제한 없음 */
  landline: number | null;
  /** 이 상한이 어디서 왔나 — 화면·심사 설명용. per_account = 법인 무선 활성 계정 × 4(D-8 스위치 켜짐) */
  source: 'standard' | 'company_setting' | 'per_account' | 'unset';
}

/** ★1003 D-8 — 법인 무선 상한의 계정당 회선 수(가이드라인 2.1 「무선 법인 4」) */
export const CORPORATE_MOBILE_PER_ACCOUNT = 4;

/** D-8 스위치. 'true' 일 때만 켠다 — 기본 꺼짐 = 종전(회사 설정 · 미설정 제한 없음) */
export function isPerAccountMobileLimitEnabled(): boolean {
  return String(process.env.SENDER_LINE_PER_ACCOUNT_ENABLED || '').trim() === 'true';
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
  /**
   * ★1003 D-8 — 법인 계정당 무선 상한. 스위치가 켜졌을 때 호출부가 **활성 계정 수**를 넣는다.
   * 비우면(undefined · null) 종전 판정 그대로다(스위치 꺼짐과 같다). 순수 함수라 ENV 를 여기서 읽지 않는다.
   */
  perAccountActiveAccounts?: number | null;
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
    const accounts = params.perAccountActiveAccounts;
    if (accounts !== undefined && accounts !== null && Number.isFinite(Number(accounts))) {
      const perAccount = Math.max(0, Math.floor(Number(accounts))) * CORPORATE_MOBILE_PER_ACCOUNT;
      // 회사 설정은 좁히기만 한다 — 기준(계정 × 4)보다 넓은 설정은 기준으로 깎인다
      return { mobile: mobile === null ? perAccount : Math.min(mobile, perAccount), landline, source: 'per_account' };
    }
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
    // ★1003 D-8 계정당 상한이면 상한이 어디서 나왔는지(활성 계정 × 4)를 함께 알린다 — 계정을 늘려야 하는지 판단할 수 있게
    const basis = kind === 'mobile' && limits.source === 'per_account'
      ? ` 법인 무선은 활성 계정 1개당 ${CORPORATE_MOBILE_PER_ACCOUNT}회선입니다.`
      : '';
    return {
      status: 'exceeded',
      kind,
      current,
      limit,
      message: `${KIND_LABEL[kind]} 발신번호는 최대 ${limit}회선까지 등록할 수 있습니다. (현재 ${current}회선)${basis}`,
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
/**
 * ★ 2026-09-27 한줄로 V2 R279 — 관리자 입력 회선 수 상한 해석(순수). 비움 = 제한 없음(null) · 1 이상 = 그 값(정수) · 그 밖 = 거절.
 */
export function parseLineLimitInput(v: any): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined || String(v).trim() === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return { ok: false };
  return { ok: true, value: Math.floor(n) };
}

/**
 * ★1003 D-8 — 활성 계정 수. 시스템 가상 계정(싱크에이전트 등)은 빼는 관례 그대로(admin.ts · manage-users.ts 최대 사용자 수 검사와 같은 문장).
 */
export async function countActiveAccounts(companyId: string): Promise<number> {
  const r = await query(
    'SELECT COUNT(*) FROM users WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false',
    [companyId]
  );
  return Number(r.rows[0]?.count || 0);
}

/**
 * 회사 상한을 읽는다 — 등록 판정과 화면이 **같은 함수**로 같은 값을 본다.
 * D-8 스위치가 켜졌고 법인이면 활성 계정 수를 세어 계정당 상한을 적용한다. 꺼져 있으면 종전 그대로이고, 그 사실을 한 줄 남긴다.
 */
async function loadCompanyLineLimits(companyId: string): Promise<{ company: any; limits: LineLimits; activeAccounts: number | null }> {
  const companyRes = await query(
    'SELECT subscriber_type, mobile_line_limit, landline_line_limit FROM companies WHERE id = $1',
    [companyId]
  );
  const company = companyRes.rows[0] || {};
  const isCorporate = String(company.subscriber_type || '').trim() === 'corporate';
  let activeAccounts: number | null = null;
  if (isCorporate) {
    if (isPerAccountMobileLimitEnabled()) {
      activeAccounts = await countActiveAccounts(companyId);
    } else {
      console.log(`[sender-line-limit] 법인 계정당 무선 상한 스위치 꺼짐 — 종전 회사 설정으로 판정 (company=${companyId})`);
    }
  }
  const limits = resolveLineLimits({
    subscriberType: company.subscriber_type,
    mobileLimit: company.mobile_line_limit,
    landlineLimit: company.landline_line_limit,
    perAccountActiveAccounts: activeAccounts,
  });
  return { company, limits, activeAccounts };
}

export async function checkSenderLineLimit(companyId: string, phone: string): Promise<LineLimitVerdict> {
  const { limits } = await loadCompanyLineLimits(companyId);

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
  const { company, limits, activeAccounts } = await loadCompanyLineLimits(companyId);
  const held = await countCompanyLines(companyId);
  return {
    subscriberType: company.subscriber_type || null,
    mobileLineLimit: company.mobile_line_limit ?? null,
    landlineLineLimit: company.landline_line_limit ?? null,
    effective: limits,
    held,
    // ★1003 D-8 — 스위치가 켜진 법인만 값이 있다(화면이 「활성 계정 N × 4」로 근거를 보여 준다). 그 밖은 null
    perAccount: activeAccounts === null ? null : { activeAccounts, perAccount: CORPORATE_MOBILE_PER_ACCOUNT },
  };
}
