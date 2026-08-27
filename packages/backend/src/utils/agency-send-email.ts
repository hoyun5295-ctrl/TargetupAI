/**
 * utils/agency-send-email.ts — 대행발송 이메일 접수 · 허용 발신자 CT (★2026-08-26 §18)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §18-2. 허용 발신자 원장(agency_send_email_senders)의
 * 정규화·판정이 여기 산다. 관리 라우트(routes/admin.ts)와 메일 워커가 같은 함수를 쓴다(판정 두 벌 금지).
 *
 * ⛔ 신원 게이트 = allowlist_only(★0826 실측: 하이웍스는 수신 인증 헤더를 붙이지 않는다).
 *   허용 목록 **정확 일치**가 전부다 — plus-tag·점을 벗기는 정규화는 서로 다른 사람을 같은 주소로
 *   접어 위조 방향으로만 넓어지므로 하지 않는다.
 *
 * ★2026-08-27 §18-13 (서수란 접수 cmtb5y3pv02qwjnotttqxen6a): 같은 주소를 여러 귀속(청구 계정)에
 *   등록할 수 있다 — 대행 실무는 담당자 1명이 청구 계정 여러 개를 대신 요청한다(금강제화·시세이도 등).
 *   후보가 여럿이면 요청서의 "청구 계정" 칸으로 하나를 고른다(matchBillingTarget). 돈 귀속이므로
 *   자동 선택은 없다 — 못 고르면 반려다. 옛 'ambiguous'(같은 주소 2행 = fail-closed)는 폐기됐다.
 */
import { query } from '../config/database';

/**
 * 발신 주소 정규화: `"홍길동" <a@b.com>` 에서 주소만 추출 → lower → trim. plus-tag 보존.
 * 주소 형태가 아니면 ''(판정 불가 = 미등록과 같게 취급).
 */
export function normalizeSenderEmail(raw: any): string {
  const s = String(raw ?? '').trim();
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? addr : '';
}

/** 허용 행 1건 = 청구 계정 후보 1개. label(표시명)·loginId가 요청서 "청구 계정" 지정의 대조 대상이다 */
export interface SenderCandidate {
  senderId: string;
  companyId: string;
  userId: string;
  label: string | null;
  loginId: string;
  userName: string | null;
}

export type SenderResolution =
  /** 사용 가능한 귀속이 정확히 1개 — 기존과 같은 접수 흐름(지정 없이 진행 가능) */
  | { outcome: 'ok'; candidate: SenderCandidate }
  /** 허용 목록에 없다(회신 0 · 격리 카운터만) */
  | { outcome: 'unregistered' }
  /** ★0827 §18-13 — 사용 가능한 귀속이 2개 이상: 요청서의 "청구 계정" 지정으로 하나를 골라야 한다 */
  | { outcome: 'choose'; candidates: SenderCandidate[] }
  /**
   * 주소는 등록됐는데 사용 가능한 귀속이 0 — 접수하면 발송 직전에 죽는다(worker dispatch_no_owner).
   * companyId = 등록 행들의 회사가 하나일 때만 그 값(★0827 Codex 1R medium: 여러 회사가 걸려 있으면
   * 첫 행 회사로 적는 것이 오귀속 · 원장·일일 상한 오염). 여러 회사면 null = 미확정 그대로 기록.
   */
  | { outcome: 'owner_inactive'; senderId: string; companyId: string | null };

/**
 * 발신 주소 → 청구 계정 후보 판정. **한 쿼리**로 허용 행과 사용자 활성 상태를 함께 읽는다(§18-2).
 * ⛔ 호출 자리는 이메일 워커의 `createRequestCore` 직전 단일 지점이다(네 번째 우회 입구 방지).
 * ⛔ 후보 순서는 등록순으로 고정한다 — 판정에 순서 의존은 없지만 회신의 목록 표기가 흔들리면 안 된다.
 * ⛔ JOIN은 **같은 회사의 사용자만** 붙인다(★0827 Codex 1R high: 데이터 드리프트로 s.company_id와
 *   u.company_id가 어긋난 행이 통과하면 교차 테넌트 귀속·청구가 된다 — 불일치 = 사용자 없음 = fail-closed).
 */
export async function resolveEmailSender(fromRaw: any): Promise<SenderResolution> {
  const email = normalizeSenderEmail(fromRaw);
  if (!email) return { outcome: 'unregistered' };
  const r = await query(
    `SELECT s.id, s.company_id, s.user_id, s.label, u.login_id, u.name AS user_name,
            u.status AS user_status, u.is_active AS user_is_active
       FROM agency_send_email_senders s
       LEFT JOIN users u ON u.id = s.user_id AND u.company_id = s.company_id
      WHERE s.email_norm = $1 AND s.is_active
      ORDER BY s.created_at ASC`,
    [email],
  );
  if (r.rows.length === 0) return { outcome: 'unregistered' };
  // 활성 판정 = 로그인 게이트와 같은 두 축(is_active AND status='active' · auth.ts:291).
  // 차단할 값 열거가 아니라 허용 값만 통과(긍정 비교 · LESSONS_BACKEND 33행). 사용자 행이 없어도 막는다.
  const usable: SenderCandidate[] = r.rows
    .filter((row) => row.user_is_active === true && row.user_status === 'active')
    .map((row) => ({
      senderId: row.id, companyId: row.company_id, userId: row.user_id,
      label: row.label ?? null, loginId: String(row.login_id || ''), userName: row.user_name ?? null,
    }));
  if (usable.length === 0) {
    const companies = [...new Set(r.rows.map((row) => String(row.company_id)))];
    return { outcome: 'owner_inactive', senderId: r.rows[0].id, companyId: companies.length === 1 ? companies[0] : null };
  }
  if (usable.length === 1) return { outcome: 'ok', candidate: usable[0] };
  return { outcome: 'choose', candidates: usable };
}

/**
 * 활성 집합에 들어가려는 행의 지정 키(표시명·로그인 ID)가 기존 활성 행의 키와 겹치는가.
 * ★0827 Codex 1R high — 등록 POST와 **재활성 PATCH**가 같은 판정을 지나야 한다(판정 두 벌 금지).
 * 재활성 무검사면 "등록 → 비활성 → 교차 키 등록 → 재활성"으로 전 지정값 ambiguous 집합이 만들어져
 * 그 주소의 접수가 전부 반려된다. 호출부는 이메일 단위 잠금 안에서 활성 행을 다시 읽어 넘긴다.
 */
export function senderKeyClash(
  existing: Array<{ label: string | null; loginId: string | null }>,
  next: { label: string | null; loginId: string | null },
): boolean {
  const taken = new Set<string>();
  for (const row of existing) {
    if (row.label) taken.add(normalizeBillingTargetKey(row.label));
    if (row.loginId) taken.add(normalizeBillingTargetKey(row.loginId));
  }
  return [next.label, next.loginId]
    .map((v) => normalizeBillingTargetKey(v))
    .some((k) => !!k && taken.has(k));
}

// ────────────── 청구 계정 지정 대조 (★2026-08-27 §18-13) ──────────────

/**
 * 지정값·대조 대상(표시명·로그인 ID) 공통 정규화 — 공백 제거 + lower.
 * 요청서 값은 사람이 타이핑하므로 "금강 제화"와 "금강제화"를 같게 본다. 괄호는 내용이라 보존.
 */
export function normalizeBillingTargetKey(raw: any): string {
  return String(raw ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

export type BillingTargetMatch =
  | { outcome: 'matched'; candidate: SenderCandidate }
  /** 지정값이 어느 후보의 표시명·로그인 ID와도 일치하지 않는다 */
  | { outcome: 'not_found' }
  /** 지정값이 후보 2개 이상과 일치 — 등록(표시명) 정리가 필요한 상태(등록 라우트가 예방하지만 데이터는 불량 가능) */
  | { outcome: 'ambiguous' };

/**
 * 요청서 "청구 계정" 값으로 후보 1개를 고른다. 대조 = 표시명(label) 또는 로그인 ID 정확 일치(정규화 후).
 * ⛔ 부분 일치·유사 일치는 하지 않는다 — 돈 귀속에서 "비슷해서 골랐다"는 오귀속 사고다.
 */
export function matchBillingTarget(candidates: SenderCandidate[], designation: string): BillingTargetMatch {
  const key = normalizeBillingTargetKey(designation);
  if (!key) return { outcome: 'not_found' };
  const hits = candidates.filter((c) =>
    (c.label && normalizeBillingTargetKey(c.label) === key) || normalizeBillingTargetKey(c.loginId) === key);
  if (hits.length === 1) return { outcome: 'matched', candidate: hits[0] };
  if (hits.length === 0) return { outcome: 'not_found' };
  return { outcome: 'ambiguous' };
}

/**
 * 회신 안내용 후보 표기: 표시명이 있으면 "표시명 (로그인ID)", 없으면 로그인 ID.
 * 사용자 노출 문구지만 자기 주소로 등록된 자기 계정 목록이라 노출 무해(§18-13).
 */
export function describeBillingTargets(candidates: SenderCandidate[]): string {
  return candidates
    .map((c) => (c.label ? `${c.label} (${c.loginId})` : c.loginId))
    .join(', ');
}
