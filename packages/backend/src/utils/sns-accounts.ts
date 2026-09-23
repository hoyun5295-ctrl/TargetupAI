/**
 * sns-accounts.ts — SNS 계정 원장 접근 컨트롤타워 (2026-09-20 S1)
 *
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-1 · §3-10 · §3-11.
 *
 * ⛔ 불변(§2)
 *   3. **저장 ≠ 연결.** 토큰 저장 = `pending`. 계정 재조회 성공 시에만 `active`. `pending`·`ineligible` 에 초록 0.
 *   4. **`company_integrations` 를 import 하지 않는다**(정적 계약). 이 파일이 그 계약의 경계다.
 *   5. **전 조회에 `company_id` 조건을 직접 부여한다.** `(platform, external_account_id)` 만으로 회사를 정하는
 *      함수를 만들지 않는다. 계정 id 를 받는 경로는 `company_id` 조건으로 재조회해 소유를 확인한 뒤에만 쓴다.
 *
 * ⛔ 토큰은 이 파일 밖으로 원문이 나가지 않는다. 화면 직렬화(`toAccountCard`)에 토큰 필드가 없다.
 */

import { query, pool } from '../config/database';
import { resolveProviderOAuthCredentials } from './provider-credentials';
import type { SnsAccountStatus, SnsPlatform } from './sns-constants';
import { SnsAdapterError, getSnsAdapter, type ISnsAdapter, type SnsAccountProfile, type SnsOAuthCreds, type SnsTokenResult } from './sns/adapter';

/** 테이블 미생성(42P01) 판별 — 마이그레이션 전 배포에서 500 대신 안내를 내기 위한 축(`db_alter_safety_net`). */
export function isMissingSnsTable(err: any): boolean {
  const code = String(err?.code || '');
  if (code === '42P01') return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('does not exist') && msg.includes('sns_');
}

export interface SnsAccountRow {
  id: string;
  company_id: string;
  platform: SnsPlatform;
  external_account_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  token_refreshed_at: Date | null;
  scope: string | null;
  meta: Record<string, unknown>;
  status: SnsAccountStatus;
  status_reason: string | null;
  is_default: boolean;
  connected_by: string | null;
  connected_at: Date | null;
  last_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** 화면에 나가는 계정 카드 — **토큰 없음**. 사유는 사람이 읽는 문장 그대로. */
export interface SnsAccountCard {
  id: string;
  platform: SnsPlatform;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: SnsAccountStatus;
  statusReason: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  /** 토큰 만료 시각 — 화면이 "N일 뒤 다시 연결" 안내를 쓸 수 있게. 값 자체는 비밀이 아니다. */
  tokenExpiresAt: string | null;
}

export function toAccountCard(row: SnsAccountRow): SnsAccountCard {
  // ★ 1차-B — 게시 직전에 갱신하는 채널(X · 액세스 2시간)은 토큰 만료가 곧 연결 만료가 아니다.
  //   그대로 내보내면 화면이 "1일 남음"이라고 말한다 — 만료 시각을 싣지 않는다.
  const shortLived = getSnsAdapter(row.platform)?.capabilities.tokenRefresh === 'at_use';
  return {
    id: row.id,
    platform: row.platform,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    statusReason: row.status_reason,
    connectedAt: row.connected_at ? row.connected_at.toISOString() : null,
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    tokenExpiresAt: !shortLived && row.token_expires_at ? row.token_expires_at.toISOString() : null,
  };
}

/**
 * 한줄로 자체 앱 자격(ENV). 회사 자체 앱 자격은 2차(Advanced Access 우회 경로)에서 붙는다 —
 * 그때 첫 인자에 회사 자격을 넘기면 이 함수가 그대로 우선 적용한다(§3-10).
 */
export function resolveSnsCredentials(
  platform: SnsPlatform,
  env: Record<string, string | undefined> = process.env,
): { ok: true; credentials: SnsOAuthCreds } | { ok: false; reason: string } {
  const prefix = platform === 'facebook_page' ? 'FACEBOOK_PAGE' : platform.toUpperCase();
  const resolved = resolveProviderOAuthCredentials(null, {
    clientId: env[`${prefix}_CLIENT_ID`],
    clientSecret: env[`${prefix}_CLIENT_SECRET`],
    redirectUri: env[`${prefix}_REDIRECT_URI`],
  });
  if (!resolved.ok) {
    return { ok: false, reason: '이 채널은 아직 연결 준비가 끝나지 않았어요. 잠시 뒤 다시 시도해 주세요.' };
  }
  return { ok: true, credentials: resolved.credentials };
}

/** 회사의 계정 전부(해제분 포함 — 화면이 `해제됨` 카드를 그린다). */
export async function listSnsAccounts(companyId: string): Promise<SnsAccountRow[]> {
  const r = await query(
    `SELECT * FROM sns_accounts
      WHERE company_id = $1::uuid
      ORDER BY platform, created_at`,
    [companyId],
  );
  return r.rows as SnsAccountRow[];
}

/** 계정 1행 — **company_id 조건 필수**(불변 5). 남의 회사 행은 애초에 안 나온다. */
export async function getSnsAccount(companyId: string, accountId: string): Promise<SnsAccountRow | null> {
  const r = await query(
    `SELECT * FROM sns_accounts WHERE id = $1::uuid AND company_id = $2::uuid`,
    [accountId, companyId],
  );
  return (r.rows[0] as SnsAccountRow) ?? null;
}

/**
 * 토큰 저장 = `pending`(불변 3). 같은 계정을 다시 연결하면 토큰만 갈아끼우고 상태를 `pending` 으로 되돌린다 —
 * 재조회가 끝나기 전에 옛 `active` 가 남아 있으면 화면이 초록인 채로 실제로는 끊긴 상태가 된다.
 */
export async function upsertPendingAccount(input: {
  companyId: string;
  platform: SnsPlatform;
  externalAccountId: string;
  token: SnsTokenResult;
  connectedBy: string | null;
}): Promise<SnsAccountRow> {
  const r = await query(
    `INSERT INTO sns_accounts
       (company_id, platform, external_account_id, access_token, refresh_token, token_expires_at,
        token_refreshed_at, scope, status, status_reason, connected_by, connected_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW(), $7, 'pending', NULL, $8::uuid, NOW())
     ON CONFLICT (company_id, platform, external_account_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           token_refreshed_at = NOW(),
           scope = EXCLUDED.scope,
           status = 'pending',
           status_reason = NULL,
           connected_by = EXCLUDED.connected_by,
           connected_at = NOW(),
           updated_at = NOW()
     RETURNING *`,
    [
      input.companyId,
      input.platform,
      input.externalAccountId,
      input.token.accessToken,
      input.token.refreshToken ?? null,
      input.token.expiresAt ?? null,
      input.token.scope ?? null,
      input.connectedBy,
    ],
  );
  return r.rows[0] as SnsAccountRow;
}

/**
 * 계정 재조회 결과를 반영한다 — **여기서만 `active` 가 된다**(불변 3).
 * 프로필 조회가 성공해도 자격이 없으면 `ineligible` + 사유. 사유는 화면에 그대로 나간다.
 */
export async function applyAccountProfile(
  companyId: string,
  accountId: string,
  profile: SnsAccountProfile,
): Promise<SnsAccountRow | null> {
  const status: SnsAccountStatus = profile.eligible ? 'active' : 'ineligible';
  const r = await query(
    `UPDATE sns_accounts
        SET username = $3,
            display_name = $4,
            avatar_url = $5,
            status = $6,
            status_reason = $7,
            meta = COALESCE(meta, '{}'::jsonb) || $8::jsonb,
            last_verified_at = NOW(),
            updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid
      RETURNING *`,
    [
      accountId,
      companyId,
      profile.username,
      profile.displayName,
      profile.avatarUrl,
      status,
      profile.ineligibleReason ?? null,
      // jsonb 파라미터는 문자열로 넘긴다(memory feedback_no_guess_sql_death · B-0824-1).
      JSON.stringify({ profile: profile.raw ?? {} }),
    ],
  );
  return (r.rows[0] as SnsAccountRow) ?? null;
}

/** 상태만 바꾼다(재조회 실패·토큰 만료·권한 회수). 사유가 없으면 기존 사유를 지운다. */
export async function setSnsAccountStatus(
  companyId: string,
  accountId: string,
  status: SnsAccountStatus,
  reason: string | null,
  extraMeta: Record<string, unknown> | null = null,
): Promise<void> {
  await query(
    `UPDATE sns_accounts
        SET status = $3,
            status_reason = $4,
            meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb,
            updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [accountId, companyId, status, reason, JSON.stringify(extraMeta ?? {})],
  );
}

/**
 * 해제 — **행 DELETE 0**(§3-1). 게시 이력이 이 행을 참조하므로 토큰만 지우고 `revoked` 로 남긴다.
 * 지워 버리면 "어느 계정에 올렸는지"가 이력에서 사라진다.
 */
export async function revokeSnsAccount(companyId: string, accountId: string): Promise<SnsAccountRow | null> {
  const r = await query(
    `UPDATE sns_accounts
        SET status = 'revoked',
            status_reason = NULL,
            access_token = NULL,
            refresh_token = NULL,
            token_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid
      RETURNING *`,
    [accountId, companyId],
  );
  return (r.rows[0] as SnsAccountRow) ?? null;
}

/** 갱신된 토큰 저장 — 토큰 워커 전용. 상태는 건드리지 않는다(§3-4 "실패는 status 미변경"). */
export async function saveRefreshedToken(accountId: string, token: SnsTokenResult): Promise<void> {
  await query(
    `UPDATE sns_accounts
        SET access_token = $2,
            refresh_token = COALESCE($3, refresh_token),
            token_expires_at = $4,
            token_refreshed_at = NOW(),
            scope = COALESCE($5, scope),
            meta = COALESCE(meta, '{}'::jsonb) - 'refresh_error',
            updated_at = NOW()
      WHERE id = $1::uuid`,
    [accountId, token.accessToken, token.refreshToken ?? null, token.expiresAt ?? null, token.scope ?? null],
  );
}

// ───────────────────────── ★ 2026-09-23 1차-B — 재연결 판정 · 사용 직전 갱신 ─────────────────────────

/** 이 오류가 "사람이 다시 연결해야 하는 상태"인가 — 일시 장애와 가른다(토큰 워커에서 옮겨 와 발행·대조 워커와 같이 쓴다). */
export function isSnsReauthError(err: unknown): boolean {
  if (!(err instanceof SnsAdapterError)) return false;
  if (err.httpStatus === 400 || err.httpStatus === 401 || err.httpStatus === 403) return true;
  return /expired|invalid|revoked|permission/i.test(err.message || '');
}

/** 만료 이만큼 전이면 게시 전에 갱신한다. */
const AT_USE_MARGIN_MS = 10 * 60 * 1000;

/**
 * 게시·확인 직전에 쓸 액세스 토큰. `tokenRefresh='at_use'` 채널(X · 액세스 2시간)만 여기서 갱신한다.
 *
 * ⛔ 불변 25 — refresh token 은 1회용일 수 있다. 두 워커가 같은 계정을 동시에 갱신하면 늦은 쪽이 쓴 값이
 *   무효가 되어 계정이 통째로 끊긴다. 그래서 **계정 행을 `FOR UPDATE` 로 잡은 트랜잭션 안에서만** 갱신하고,
 *   잠금을 얻은 뒤 만료 시각을 다시 본다(먼저 들어온 쪽이 이미 갱신했으면 그 값을 쓴다).
 */
export async function ensureFreshSnsToken(
  account: { id: string; company_id: string; platform: SnsPlatform; access_token: string | null; token_expires_at: Date | string | null },
  adapter: ISnsAdapter,
): Promise<string> {
  const current = String(account.access_token || '');
  if (adapter.capabilities.tokenRefresh !== 'at_use') return current;
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (current && exp > Date.now() + AT_USE_MARGIN_MS) return current;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT access_token, refresh_token, token_expires_at FROM sns_accounts
        WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [account.id, account.company_id],
    );
    const row = r.rows[0];
    if (!row?.access_token) {
      await client.query('ROLLBACK');
      throw new SnsAdapterError(adapter.platform, 'token:missing', '채널 연결이 끊어졌어요. 다시 연결해 주세요.', 401);
    }
    const lockedExp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
    if (lockedExp > Date.now() + AT_USE_MARGIN_MS) {
      await client.query('COMMIT');
      return String(row.access_token);
    }
    const creds = resolveSnsCredentials(adapter.platform);
    if (!creds.ok) {
      await client.query('ROLLBACK');
      throw new SnsAdapterError(adapter.platform, 'creds:missing', creds.reason, null);
    }
    const t = await adapter.refreshToken(creds.credentials, String(row.access_token), row.refresh_token ?? null);
    if (!t) {
      await client.query('COMMIT');
      return String(row.access_token);
    }
    await client.query(
      `UPDATE sns_accounts
          SET access_token = $2, refresh_token = COALESCE($3, refresh_token), token_expires_at = $4,
              token_refreshed_at = NOW(), meta = COALESCE(meta, '{}'::jsonb) - 'refresh_error', updated_at = NOW()
        WHERE id = $1::uuid`,
      [account.id, t.accessToken, t.refreshToken ?? null, t.expiresAt ?? null],
    );
    await client.query('COMMIT');
    return t.accessToken;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
