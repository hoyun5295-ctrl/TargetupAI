/**
 * ★ CT: 연동 토큰 상태 — 웹훅 수신 자격 · 만료 표시 · 유지 대상(★ 2026-10-28 자사몰 대비 K6 · 불변 I6 · 결함 M3 · M31 · Codex R4 #2)
 *
 * 1. 수신 자격(카페24 · 아임웹) = 연결됨(connected_at) + 해제 아님 + (만료 아님 또는 유예 안). 유예가 끝나도 상태를 해제로 바꾸지 않는다
 *    (수신만 0 · 감시 표 · 경보가 알린다). 유예 시계 = 만료로 바꾼 같은 문장이 쓴 meta.token_expired_at(updated_at 아님 · R18).
 *    카페24 = 갱신 토큰 만료 시각(meta.refresh_token_expires_at · 있으면) 또는 만료 표시 + 14일 · 아임웹 = + 90일.
 * 2. 만료 표시 = markTokenRejected 하나 — 그 요청에 쓴 토큰판(token_expires_at 원문)이 그대로일 때만(옛 토큰 갱신의 늦은 거절이
 *    새 승인 · 다른 갱신이 저장한 토큰을 만료로 덮지 않게 · 0행 = 그 사이 새 토큰).
 * 3. 유지 대상 = 마지막 갱신에서 카페24 6일 · 아임웹 29일 지난 active 행(갱신 토큰이 끊기기 전에 살린다 · 워커 integration-token-worker).
 */
import { query } from '../config/database';
import { sealSecret } from './secret-box';
import { reconnectRequiredError } from './integration-token-error';

export type ReceiveProvider = 'cafe24' | 'imweb';

/** 만료 표시 뒤 수신을 이어 가는 날 수(유예) */
export const TOKEN_GRACE_DAYS: Record<ReceiveProvider, number> = { cafe24: 14, imweb: 90 };
/** 마지막 갱신에서 이만큼 지나면 유지 워커가 갱신한다(접근 토큰 2시간 · 갱신 토큰 카페24 14일 · 아임웹 90일보다 앞) */
export const TOKEN_KEEPALIVE_DAYS: Record<ReceiveProvider, number> = { cafe24: 6, imweb: 29 };

/** meta 시각 글자 꼴(꼴을 본 뒤에만 timestamptz 로 읽는다 · 가져오기 보류 판정도 같은 꼴) */
export const ISO_TS = `'^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'`;

/**
 * 웹훅 수신 자격 조각(그 연동 행 별칭 a · 빈 별칭 = 표 이름 없이) — 수신 라우팅 SQL 이 `status = 'active'` 대신 이 조각만 쓴다(R7).
 * 시각 글자는 꼴을 본 뒤에만 시각으로 읽는다(꼴 밖 글자 하나로 수신 조회 전체가 오류 나지 않게).
 */
export function receiveEligibleSql(provider: ReceiveProvider, alias = ''): string {
  const c = (col: string) => (alias ? `${alias}.${col}` : col);
  const at = (key: string) => `CASE WHEN ${c('meta')}->>'${key}' ~ ${ISO_TS} THEN (${c('meta')}->>'${key}')::timestamptz END`;
  const graceEnd = provider === 'cafe24'
    ? `COALESCE(${at('refresh_token_expires_at')}, ${at('token_expired_at')} + INTERVAL '${TOKEN_GRACE_DAYS.cafe24} days')`
    : `${at('token_expired_at')} + INTERVAL '${TOKEN_GRACE_DAYS.imweb} days'`;
  return `(${c('connected_at')} IS NOT NULL AND ${c('status')} <> 'revoked' AND (${c('status')} <> 'token_expired' OR ${graceEnd} > NOW()))`;
}

/**
 * 제공자가 토큰을 확정 거절했다 → 그 행을 만료로(유예 시계를 같은 문장에서). 그 요청에 쓴 토큰판이 그대로일 때만 바꾼다.
 * @returns 바꿨는가(false = 그 사이 새 토큰이 들어왔거나 해제된 행)
 */
export async function markTokenRejected(row: { id: string; tokenExpiresAtRaw: string | null }): Promise<boolean> {
  const r = await query(
    `UPDATE company_integrations
        SET status = 'token_expired',
            meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('token_expired_at', NOW()),
            updated_at = NOW()
      WHERE id = $1::uuid AND status <> 'revoked'
        AND token_expires_at IS NOT DISTINCT FROM $2::timestamptz`,
    [row.id, row.tokenExpiresAtRaw],
  );
  return (r.rowCount || 0) > 0;
}

/** 유지 대상 행 id(active · 마지막 갱신에서 N일 · 오래된 것부터 · 상한 = LIMIT 앞 거름 · R8 · R12) */
export async function listTokenKeepaliveTargets(provider: ReceiveProvider, limit = 50): Promise<Array<{ id: string; companyId: string; mallId: string }>> {
  const r = await query(
    `SELECT id, company_id, mall_id FROM company_integrations
      WHERE provider = $1 AND status = 'active' AND connected_at IS NOT NULL
        AND token_expires_at < NOW() - make_interval(days => $2::int)
      ORDER BY token_expires_at ASC, id ASC
      LIMIT $3`,
    [provider, TOKEN_KEEPALIVE_DAYS[provider], limit],
  );
  return r.rows.map((x: any) => ({ id: x.id, companyId: x.company_id, mallId: x.mall_id }));
}

/**
 * 토큰 갱신 · 재발급 저장 — 그 요청에 쓴 토큰판(token_expires_at 원문)일 때만 · 해제 행은 건드리지 않는다(★ 1028 Codex R1 #2).
 * 재연결 저장(createIntegrationRow upsert · status = active)과 분리 — 옛: 갱신이 그 upsert 를 써서, 갱신 요청이 도는 사이 사용자가 해제하면
 * 응답 뒤 저장이 active 로 덮어 해제가 취소됐다. 만료 표시였던 행은 갱신 성공으로 active · 그 밖 상태(연동완료 대기 등)는 그대로.
 * @returns false = 그 사이 다른 갱신 · 재승인 · 해제가 이 행을 바꿨다(호출부는 지금 행을 다시 읽는다)
 */
export async function saveRefreshedToken(input: {
  id: string;
  tokenExpiresAtRaw: string | null | undefined;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt: Date;
  meta?: Record<string, unknown>;
}): Promise<boolean> {
  const r = await query(
    `UPDATE company_integrations
        SET access_token = $3, refresh_token = COALESCE($4, refresh_token), token_expires_at = $5,
            meta = COALESCE(meta, '{}'::jsonb) || $6::jsonb,
            status = CASE WHEN status = 'token_expired' THEN 'active' ELSE status END,
            updated_at = NOW()
      WHERE id = $1::uuid AND status <> 'revoked' AND token_expires_at IS NOT DISTINCT FROM $2::timestamptz
      RETURNING id`,
    [
      input.id, input.tokenExpiresAtRaw ?? null, sealSecret(input.accessToken),
      input.refreshToken != null ? sealSecret(input.refreshToken) : null, input.tokenExpiresAt,
      JSON.stringify(input.meta ?? {}),
    ],
  );
  return r.rows.length > 0;
}

/**
 * 갱신 저장이 0행이었을 때 — 그 사이 다른 갱신 · 재승인이 새 토큰을 썼으면 그 행을 쓴다 · 해제됐으면 던진다(되살리지 않는다).
 */
export function reReadAfterLostRefresh<T extends { id: string; status: string }>(latest: T | null, id: string): T {
  if (latest && latest.id === id && latest.status !== 'revoked') return latest;
  throw reconnectRequiredError('연동이 해제되어 토큰을 갱신하지 않았습니다. 다시 연결해 주세요.');
}
