/**
 * sync-key-issue.ts — 싱크에이전트 키 발급 CT (★ 2026-10-29 · 설계서 docs/2026-10-29-sync-key-origin-required-design.md · 뿌리 R29)
 *
 * 쓸 수 있는 싱크 자격(api_key · 시크릿)이 생기는 유일한 곳이다. 설치 서버 공인 IP 를 필수로 받아 **같은 트랜잭션에서**
 * 출발지(company_agent)를 등록하고 이전 발급 출발지를 회수한다.
 *
 * ⛔ 왜 한 곳인가 — 운영은 기계 출발지 통제 시행 중이라 등록 안 된 IP 의 에이전트는 싱크 API 가 전부 403 이고,
 *   마법사는 AI 매핑 403 을 로컬 매핑으로 말없이 넘긴다. 키 발급(재발급 라우트)과 출발지 등록(국외 접근 통제 화면)이
 *   따로였던 동안 등록을 빠뜨리면 발급한 키가 조용히 막혔다(1029 엠티 VM 재검증 · 테스트계정).
 * ⛔ 등급 판정도 이 안에 둔다(LESSONS_BACKEND 0819 「게이트는 효과를 만드는 함수 안」) — 출발지 승인은 등급표상
 *   국외 접근 통제 쓰기 등급(super · lead)의 일이라 발급도 같은 등급이다. 화면용 표시(listAgentOrigins)도 같은 함수.
 */
import crypto from 'crypto';
import { query, withTransaction } from '../config/database';
import { hashSecret } from './secret-hash';
import { fetchAdminRole, canRead, canWrite, canDelete } from './admin-role';
import { parseAgentOriginIp, insertOriginException, isOriginAllowlistEnforced } from './geo-access';
import { recordAuditLog } from './audit-log';

/** 발급 행 표시 = 사유 글자(DDL 0 · 재발급 회수 대상을 가른다 · 손으로 같은 사유를 적은 행도 발급 행으로 본다) */
export const SYNC_KEY_ORIGIN_REASON = '싱크에이전트 키 발급 출발지';

const ISSUE_FORBIDDEN = '키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.';

/** 이 직원이 싱크에이전트 출발지를 볼 · 발급할 · 회수할 수 있는가(등급 조회 실패 · 미등록 = support = 셋 다 거짓) */
export async function agentOriginRights(actorUserId: string | null | undefined): Promise<{ canList: boolean; canIssue: boolean; canRevoke: boolean }> {
  const role = await fetchAdminRole(actorUserId);
  return { canList: canRead(role, 'geoAccess'), canIssue: canWrite(role, 'geoAccess'), canRevoke: canDelete(role, 'geoAccess') };
}

export type IssueSyncKeysResult =
  | { ok: true; apiKey: string; apiSecret: string; useDbSync: boolean; originIp: string; originCidr: string; originAdded: boolean; revokedOrigins: string[] }
  | { ok: false; status: 400 | 403 | 404; code: 'ORIGIN_GRANT_FORBIDDEN' | 'ORIGIN_IP_INVALID' | 'COMPANY_NOT_FOUND'; error: string };

/**
 * 키 · 시크릿 새로 발급 + 출발지 등록 + 이전 발급 출발지 회수(한 트랜잭션 · 등록이 실패하면 키도 그대로).
 * 같은 회사 동시 발급은 키 UPDATE 의 행 잠금으로 줄을 선다 → 뒤 거래의 회수 · 덮음 확인이 앞 거래의 등록 행을 본다.
 * 시크릿 원문은 돌려주는 값에만 있다(서버에 남지 않는다 · 감사에도 안 싣는다).
 */
export async function issueSyncAgentKeys(p: {
  companyId: string;
  originIp: unknown;
  actorUserId: string | null | undefined;
  req?: any;
}): Promise<IssueSyncKeysResult> {
  if (!(await agentOriginRights(p.actorUserId)).canIssue) {
    return { ok: false, status: 403, code: 'ORIGIN_GRANT_FORBIDDEN', error: ISSUE_FORBIDDEN };
  }
  const origin = parseAgentOriginIp(p.originIp);
  if (!origin.ok) return { ok: false, status: 400, code: 'ORIGIN_IP_INVALID', error: origin.reason };

  const apiKey = `tk_${crypto.randomBytes(24).toString('hex')}`;
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const out = await withTransaction(async (run) => {
    const upd = await run(
      `UPDATE companies SET api_key = $1, api_secret_hash = $2, api_secret = NULL, updated_at = NOW() WHERE id = $3 RETURNING use_db_sync`,
      [apiKey, hashSecret(apiSecret), p.companyId]
    );
    if (upd.rows.length === 0) return null;
    // 재발급은 옛 키를 즉시 끊는다 → 옛 키의 설치 서버 출발지(발급 행)도 같이 닫는다 · 지우지 않는다(이력) · 손으로 등록한 다른 사유 행은 그대로
    const revoked = await run(
      `UPDATE access_origin_allowlist SET is_active = false
        WHERE company_id = $1::uuid AND scope = 'company_agent' AND is_active = true AND reason = $2 AND cidr <> $3::cidr
        RETURNING id, host(cidr) || '/' || masklen(cidr) AS cidr`,
      [p.companyId, SYNC_KEY_ORIGIN_REASON, origin.cidr]
    );
    // 만료 없는 그 회사 행이 이미 덮으면 생략(만료 있는 행 · global 행만 덮으면 등록 = 그 행이 끝나는 날 다시 막히지 않게)
    const covered = await run(
      `SELECT 1 FROM access_origin_allowlist
        WHERE company_id = $1::uuid AND scope = 'company_agent' AND is_active = true AND expires_at IS NULL AND $2::cidr <<= cidr
        LIMIT 1`,
      [p.companyId, origin.cidr]
    );
    const grantId = covered.rows.length > 0 ? null : await insertOriginException(run, {
      scope: 'company_agent', companyId: p.companyId, userId: null, cidr: origin.cidr,
      reason: SYNC_KEY_ORIGIN_REASON, approvedBy: p.actorUserId || null, expiresAt: null,
    });
    return { useDbSync: upd.rows[0].use_db_sync, grantId, revoked: revoked.rows as Array<{ id: string; cidr: string }> };
  });
  if (!out) return { ok: false, status: 404, code: 'COMPANY_NOT_FOUND', error: '회사를 찾을 수 없습니다.' };

  // 감사(커밋 뒤 · 기록 실패는 CT 가 흡수) — 키 · 시크릿 원문은 싣지 않는다(키 끝 4자리만 · 에이전트 설정과 대조용)
  await recordAuditLog({
    actorUserId: p.actorUserId,
    action: 'sync_key_regenerate',
    targetType: 'company',
    targetId: p.companyId,
    details: { apiKeyTail: apiKey.slice(-4), originCidr: origin.cidr, revokedOrigins: out.revoked.map((x) => x.cidr) },
    req: p.req,
  });
  if (out.grantId) {
    await recordAuditLog({
      actorUserId: p.actorUserId,
      action: 'access_origin_exception_granted',
      targetType: 'access_origin_allowlist',
      targetId: out.grantId,
      details: { scope: 'company_agent', companyId: p.companyId, userId: null, cidr: origin.cidr, reason: SYNC_KEY_ORIGIN_REASON, expiresAt: null },
      req: p.req,
    });
  }
  for (const r of out.revoked) {
    await recordAuditLog({
      actorUserId: p.actorUserId,
      action: 'access_origin_exception_revoked',
      targetType: 'access_origin_allowlist',
      targetId: r.id,
      details: { reason: `키 재발급 · 새 출발지 ${origin.ip}` },
      req: p.req,
    });
  }

  return {
    ok: true, apiKey, apiSecret, useDbSync: out.useDbSync,
    originIp: origin.ip, originCidr: origin.cidr, originAdded: out.grantId !== null, revokedOrigins: out.revoked.map((x) => x.cidr),
  };
}

export interface AgentOrigin {
  id: string;
  /** 한 주소면 IP 만 · 대역이면 `IP/접두` */
  ip: string;
  reason: string;
  approved_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
}

/**
 * 싱크 탭 접속 허용 IP 칸 — **그 회사**의 company_agent 활성 행 전부(회사 조건으로 거른 뒤 · 국외 접근 통제 전체 목록 300건과 무관 · Codex 설계 2R)
 * + 이 직원의 발급 · 회수 등급 + 출발지 통제 시행 여부. 조회 등급이 없으면 행을 내보내지 않는다.
 */
export async function listAgentOrigins(
  companyId: string,
  actorUserId: string | null | undefined,
): Promise<{ canIssue: boolean; canRevoke: boolean; enforced: boolean; origins: AgentOrigin[] }> {
  const rights = await agentOriginRights(actorUserId);
  const enforced = isOriginAllowlistEnforced();
  if (!rights.canList) return { canIssue: false, canRevoke: false, enforced, origins: [] };
  const r = await query(
    `SELECT id,
            CASE WHEN masklen(cidr) = (CASE WHEN family(cidr) = 4 THEN 32 ELSE 128 END) THEN host(cidr)
                 ELSE host(cidr) || '/' || masklen(cidr) END AS ip,
            reason, approved_at, expires_at,
            (expires_at IS NOT NULL AND expires_at <= NOW()) AS is_expired
       FROM access_origin_allowlist
      WHERE company_id = $1::uuid AND scope = 'company_agent' AND is_active = true
      ORDER BY approved_at DESC NULLS LAST`,
    [companyId]
  );
  return { canIssue: rights.canIssue, canRevoke: rights.canRevoke, enforced, origins: r.rows };
}
