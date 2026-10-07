/**
 * ★ CT: 본인인증 현황 (★2026-10-07 Harold 지시 · 슈퍼관리자 ceo 전용 · 읽기 전용 화면)
 *
 * 담당자 본인인증(한국모바일인증)이 어디까지 왔는지 한 화면에서 본다 — 시행 상태 · 명단 계정별 인증 여부 ·
 * 인증 이력 · 실패 기록. 전송자격인증 3.4 · 3.5 증빙 캡처 화면이기도 하다.
 *
 * 원천(새 칸 · 새 테이블 0)
 *   - 인증 이력 = `identity_verifications`(쓰는 곳 = identity-verify.ts)
 *   - 실패 = 감사 기록 `identity_verify_fail`(쓰는 곳 = routes/auth.ts · details = loginId · purpose · result · reason · detail · verificationId)
 *   - 시행 상태 = `identityRolloutState()`(ENV 를 읽는 곳은 identity-verify.ts 하나)
 *
 * ⛔ 이름 · 번호는 가린 값만 내보낸다(Harold 1007 「가림 적용」 · 캡처를 그대로 제출본에 넣는다).
 *    가림 = 기존 CT(`maskPhone` · `maskPersonName`). 원문 비교가 필요한 판정(담당자 번호 = 인증 번호)은 서버에서 하고 결과만 보낸다.
 * 게이트(ceo 전용)는 라우트가 `isIdentityStatusViewer`(audit-log.ts)로 건다.
 */
import { query } from '../config/database';
import { maskPhone } from './mfa';
import { maskPersonName } from './pii-masking';
import { identityAuditId, identityRolloutState } from './identity-verify';
import { kmcCertNumOf } from './identity-provider-kmc';

/** 인증 이력 표에 싣는 최근 건수 — 전체 건수는 따로 세어 화면이 「최근 N건 / 전체 M건」으로 밝힌다 */
export const IDENTITY_HISTORY_LIMIT = 200;
/** 실패 기록 = 최근 30일 · 최근 건수 */
export const IDENTITY_FAIL_DAYS = 30;
export const IDENTITY_FAIL_LIMIT = 100;

export type IdentityRowStatus = 'verified' | 'pending' | 'lapsed' | 'superseded';

export interface IdentityStatusData {
  rollout: { enforceFrom: string | null; enforced: boolean; allAccounts: boolean; pilotCount: number; provider: string | null };
  summary: { targetAccounts: number; targetVerified: number; verifiedAccounts: number; changes: number; failures: number };
  /** 명단 계정별 상태(전 계정 시행 `*` 이면 비어 있다 · 숫자 칸이 대신 말한다) */
  pilot: Array<{
    loginId: string;
    found: boolean;
    companyName: string;
    accountName: string;
    active: boolean;
    verifiedAt: string | null;
    contactPhone: string | null;
    /** 담당자 번호(phone · mfa_phone) = 마지막 인증 번호인가 · 인증 전이면 null */
    phoneMatches: boolean | null;
  }>;
  history: Array<{
    id: string;
    at: string;
    companyName: string;
    loginId: string;
    accountName: string;
    purpose: string;
    status: IdentityRowStatus;
    provider: string;
    verifiedName: string;
    verifiedPhone: string;
    /** 인증기관에 보낸 요청번호 — 한국모바일인증 = 인증 건 번호 하이픈 제거(관리 화면 인증내역과 바로 대조) */
    requestNo: string;
    ip: string;
  }>;
  historyTotal: number;
  failures: Array<{
    at: string;
    companyName: string;
    loginId: string;
    purpose: string;
    result: string;
    reason: string;
    detail: string;
    requestNo: string;
    ip: string;
  }>;
}

const iso = (v: any): string => new Date(v).toISOString();
const str = (v: any): string => (v == null ? '' : String(v));
const plainIp = (v: any): string => str(v).replace(/^::ffff:/, '');
const digits = (v: any): string => str(v).replace(/\D/g, '');
/** 요청번호 = 인증 요청에 실은 값 그대로(`kmcCertNumOf`) — 인증 건 번호 모양이 아니면 빈 값 */
export function identityRequestNo(verificationId: any): string {
  const v = identityAuditId(verificationId);
  return v ? kmcCertNumOf(v) : '';
}

/** 이력 행 상태 — 대기 행이 시간을 넘겼으면 「중단」(DB 값은 pending 그대로) */
export function identityRowStatus(status: any, lapsed: any): IdentityRowStatus {
  if (status === 'verified') return 'verified';
  if (status === 'superseded') return 'superseded';
  return lapsed ? 'lapsed' : 'pending';
}

export async function loadIdentityStatus(): Promise<IdentityStatusData> {
  const rollout = identityRolloutState();

  const [counts, history, failures, pilotRows, allRows] = await Promise.all([
    query(
      `SELECT
         (SELECT COUNT(DISTINCT user_id)::int FROM identity_verifications WHERE status = 'verified') AS verified_accounts,
         (SELECT COUNT(*)::int FROM identity_verifications WHERE status = 'verified' AND purpose = 'change') AS changes,
         (SELECT COUNT(*)::int FROM identity_verifications) AS history_total,
         (SELECT COUNT(*)::int FROM audit_logs
           WHERE action = 'identity_verify_fail' AND created_at >= NOW() - INTERVAL '1 day' * $1) AS failures`,
      [IDENTITY_FAIL_DAYS],
    ),
    query(
      `SELECT iv.id, iv.purpose, iv.status, iv.provider, iv.verified_name, iv.verified_phone, iv.ip_address,
              COALESCE(iv.verified_at, iv.created_at) AS at,
              (iv.status = 'pending' AND iv.expires_at <= NOW()) AS lapsed,
              u.login_id, u.name AS account_name, c.company_name
         FROM identity_verifications iv
         LEFT JOIN users u ON u.id = iv.user_id
         LEFT JOIN companies c ON c.id = u.company_id
        ORDER BY iv.created_at DESC
        LIMIT $1`,
      [IDENTITY_HISTORY_LIMIT],
    ),
    query(
      `SELECT al.created_at, host(al.ip_address) AS ip, al.details,
              COALESCE(u.login_id, al.details->>'loginId') AS login_id, c.company_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE al.action = 'identity_verify_fail' AND al.created_at >= NOW() - INTERVAL '1 day' * $1
        ORDER BY al.created_at DESC
        LIMIT $2`,
      [IDENTITY_FAIL_DAYS, IDENTITY_FAIL_LIMIT],
    ),
    // 명단 계정 — 마지막 인증 한 건과 담당자 번호를 함께(번호 원문 비교는 여기서만 하고 화면에는 결과만)
    !rollout.allAccounts && rollout.pilot.length > 0
      ? query(
          `SELECT u.login_id, u.name, u.phone, u.mfa_phone,
                  (u.is_active = true AND u.status = 'active') AS active, c.company_name,
                  v.verified_at, v.verified_phone
             FROM users u
             LEFT JOIN companies c ON c.id = u.company_id
             LEFT JOIN LATERAL (
               SELECT verified_at, verified_phone FROM identity_verifications iv
                WHERE iv.user_id = u.id AND iv.status = 'verified'
                ORDER BY iv.verified_at DESC LIMIT 1
             ) v ON true
            WHERE LOWER(u.login_id) = ANY($1::text[])`,
          [rollout.pilot],
        )
      : Promise.resolve({ rows: [] as any[] }),
    // 전 계정 시행 — 사용 중 계정 수와 그중 인증 완료 수
    rollout.allAccounts
      ? query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM identity_verifications iv WHERE iv.user_id = u.id AND iv.status = 'verified'
                  ))::int AS verified
             FROM users u
            WHERE u.is_active = true AND u.status = 'active'`,
        )
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const byLogin = new Map<string, any>(pilotRows.rows.map((r: any) => [str(r.login_id).toLowerCase(), r]));
  const pilot: IdentityStatusData['pilot'] = rollout.allAccounts
    ? []
    : rollout.pilot.map((loginId) => {
        const r = byLogin.get(loginId);
        if (!r) {
          return { loginId, found: false, companyName: '', accountName: '', active: false, verifiedAt: null, contactPhone: null, phoneMatches: null };
        }
        const verified = digits(r.verified_phone);
        return {
          loginId: str(r.login_id),
          found: true,
          companyName: str(r.company_name),
          accountName: maskPersonName(r.name),
          active: r.active === true,
          verifiedAt: r.verified_at ? iso(r.verified_at) : null,
          contactPhone: r.mfa_phone ? maskPhone(r.mfa_phone) : null,
          phoneMatches: r.verified_at ? !!verified && digits(r.phone) === verified && digits(r.mfa_phone) === verified : null,
        };
      });

  const c = counts.rows[0] || {};
  const all = allRows.rows[0];
  return {
    rollout: {
      enforceFrom: rollout.enforceFrom,
      enforced: rollout.enforced,
      allAccounts: rollout.allAccounts,
      pilotCount: rollout.pilot.length,
      provider: rollout.provider,
    },
    summary: {
      targetAccounts: rollout.allAccounts ? Number(all?.total) || 0 : pilot.length,
      targetVerified: rollout.allAccounts ? Number(all?.verified) || 0 : pilot.filter((p) => p.verifiedAt).length,
      verifiedAccounts: Number(c.verified_accounts) || 0,
      changes: Number(c.changes) || 0,
      failures: Number(c.failures) || 0,
    },
    pilot,
    history: history.rows.map((r: any) => ({
      id: str(r.id),
      at: iso(r.at),
      companyName: str(r.company_name),
      loginId: str(r.login_id),
      accountName: maskPersonName(r.account_name),
      purpose: str(r.purpose),
      status: identityRowStatus(r.status, r.lapsed),
      provider: str(r.provider),
      verifiedName: r.verified_name ? maskPersonName(r.verified_name) : '',
      verifiedPhone: r.verified_phone ? maskPhone(r.verified_phone) : '',
      requestNo: r.provider === 'kmc' ? identityRequestNo(r.id) : '',
      ip: plainIp(r.ip_address),
    })),
    historyTotal: Number(c.history_total) || 0,
    failures: failures.rows.map((r: any) => {
      const d = r.details && typeof r.details === 'object' ? r.details : {};
      return {
        at: iso(r.created_at),
        companyName: str(r.company_name),
        loginId: str(r.login_id),
        purpose: str(d.purpose),
        result: str(d.result),
        reason: str(d.reason),
        detail: str(d.detail),
        requestNo: identityRequestNo(d.verificationId),
        ip: plainIp(r.ip),
      };
    }),
  };
}
