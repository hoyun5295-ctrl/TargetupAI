/**
 * sns-token-worker.ts — SNS 토큰 갱신 워커 (2026-09-20 S1)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-4.
 *
 * 6시간 주기 · 만료 14일 전 갱신 · 실패는 **status 를 바꾸지 않고** `meta.refresh_error` 만 남긴다
 * (한 번 실패했다고 계정을 끊으면, 플랫폼 일시 장애에 고객 연결이 통째로 풀린다).
 * 만료·권한 회수로 판정되면 `token_expired`/`reauth_required` + 그 계정 예약 행을 사유와 함께 닫는다.
 *
 * 공통 관례(app.ts) = 부팅 1분 뒤 첫 실행 · 시작 로그 1줄 · 테이블 없으면 조용히 · **ENV 비면 미시작**.
 *
 * ⛔ 인스타는 `token_refreshed_at` 이 24시간 지나야 갱신을 받는다(§1-1). 그 전에 부르면 거부가 쌓인다.
 *    §1-4 실측에서는 발급 직후 호출도 통과했지만, 문서 제약이 사라졌다는 증거는 아니므로 보수적으로 지킨다.
 */

import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { SnsAdapterError } from './sns/adapter';
import { resolveSnsCredentials, saveRefreshedToken, setSnsAccountStatus, isMissingSnsTable } from './sns-accounts';
import { SNS_ERROR_CODES, isSnsPlatform } from './sns-constants';

const TICK_MS = 6 * 60 * 60 * 1000;      // 6시간
const FIRST_DELAY_MS = 60 * 1000;        // 부팅 1분 뒤
const RENEW_BEFORE_DAYS = 14;            // 만료 14일 전부터 갱신 시도
const MIN_REFRESH_INTERVAL_H = 24;       // 인스타 제약(§1-1)

/** 이 오류가 "사람이 다시 연결해야 하는 상태"인가 — 일시 장애와 가른다. */
function isReauthError(err: unknown): boolean {
  if (!(err instanceof SnsAdapterError)) return false;
  if (err.httpStatus === 400 || err.httpStatus === 401 || err.httpStatus === 403) return true;
  return /expired|invalid|revoked|permission/i.test(err.message || '');
}

async function tick(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, platform, access_token, token_expires_at, token_refreshed_at
       FROM sns_accounts
      WHERE status = 'active'
        AND access_token IS NOT NULL
        AND token_expires_at IS NOT NULL
        AND token_expires_at < NOW() + ($1 || ' days')::interval
        AND (token_refreshed_at IS NULL OR token_refreshed_at < NOW() - ($2 || ' hours')::interval)
      ORDER BY token_expires_at
      LIMIT 50`,
    [String(RENEW_BEFORE_DAYS), String(MIN_REFRESH_INTERVAL_H)],
  );

  for (const row of rows.rows) {
    if (!isSnsPlatform(row.platform)) continue;
    const adapter = getSnsAdapter(row.platform);
    const creds = resolveSnsCredentials(row.platform);
    if (!adapter || !creds.ok) continue;

    try {
      const token = await adapter.refreshToken(creds.credentials, row.access_token);
      if (!token) continue;   // 갱신 수단이 없는 플랫폼 — 건너뛴다.
      await saveRefreshedToken(row.id, token);
    } catch (err: any) {
      if (isReauthError(err)) {
        // 만료·회수 — 계정을 닫고, 그 계정으로 잡힌 예약을 조용히 실패시키지 않는다.
        await setSnsAccountStatus(
          row.company_id, row.id, 'reauth_required',
          '채널 연결이 만료되었어요. 다시 연결해 주세요.',
        );
        await query(
          `UPDATE sns_post_targets
              SET status = 'failed',
                  last_error_code = $3,
                  last_error = '채널 연결이 만료되어 예약이 중단되었습니다.',
                  updated_at = NOW()
            WHERE company_id = $1::uuid AND account_id = $2::uuid AND status = 'scheduled'`,
          [row.company_id, row.id, SNS_ERROR_CODES.REAUTH_REQUIRED],
        );
        console.warn(`[SNS token] ${row.platform} 계정 ${row.id} 재연결 필요 — ${err?.message || ''}`);
      } else {
        // 일시 장애로 본다 — 상태는 그대로 두고 사유만 남긴다.
        await query(
          `UPDATE sns_accounts
              SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
            WHERE id = $1::uuid`,
          [row.id, JSON.stringify({ refresh_error: String(err?.message || err).slice(0, 500), refresh_error_at: new Date().toISOString() })],
        );
        console.warn(`[SNS token] ${row.platform} 계정 ${row.id} 갱신 실패(상태 유지) — ${err?.message || ''}`);
      }
    }
  }
}

export function startSnsTokenWorker(): void {
  // ENV 가 비면 이 기능 자체가 닫혀 있다 — 워커도 시작하지 않는다.
  if (!String(process.env.SNS_COMPANY_IDS || '').trim()) return;

  console.log('[SNS token] 토큰 갱신 워커 시작 (6시간 주기)');
  const run = async () => {
    try {
      await tick();
    } catch (err: any) {
      if (isMissingSnsTable(err)) return;   // 마이그레이션 전 — 조용히
      console.error('[SNS token] tick 오류:', err);
    }
  };
  setTimeout(() => { void run(); }, FIRST_DELAY_MS);
  setInterval(() => { void run(); }, TICK_MS);
}
