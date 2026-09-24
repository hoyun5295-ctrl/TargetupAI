/**
 * sns-token-worker.ts — SNS 토큰 갱신 워커 (2026-09-20 S1)
 * 설계 SoT = docs/2026-09-17-sns-publish-design.md §3-4.
 *
 * 6시간 주기 · 만료 14일 전 갱신 · 실패는 **status 를 바꾸지 않고** `meta.refresh_error` 만 남긴다
 * (한 번 실패했다고 계정을 끊으면, 플랫폼 일시 장애에 고객 연결이 통째로 풀린다).
 * 만료·권한 회수로 판정되면 `reauth_required`. 그 계정 예약은 닫지 않고 연결을 기다린다(★2026-09-24 Harold Q1 가).
 *
 * 공통 관례(app.ts) = 부팅 1분 뒤 첫 실행 · 시작 로그 1줄 · 테이블 없으면 조용히 · **ENV 비면 미시작**.
 *
 * ⛔ 인스타는 `token_refreshed_at` 이 24시간 지나야 갱신을 받는다(§1-1). 그 전에 부르면 거부가 쌓인다.
 *    §1-4 실측에서는 발급 직후 호출도 통과했지만, 문서 제약이 사라졌다는 증거는 아니므로 보수적으로 지킨다.
 */

import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { resolveSnsCredentials, saveRefreshedToken, setSnsAccountStatus, isMissingSnsTable, isSnsReauthError } from './sns-accounts';
import { isSnsPlatform } from './sns-constants';

const TICK_MS = 6 * 60 * 60 * 1000;      // 6시간
const FIRST_DELAY_MS = 60 * 1000;        // 부팅 1분 뒤
const RENEW_BEFORE_DAYS = 14;            // 만료 14일 전부터 갱신 시도
const MIN_REFRESH_INTERVAL_H = 24;       // 인스타 제약(§1-1)

async function tick(): Promise<void> {
  const rows = await query(
    `SELECT id, company_id, platform, access_token, refresh_token, token_expires_at, token_refreshed_at
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
    // ★ 1차-B — 이 워커가 갱신하는 것은 `scheduled` 채널(Meta 장기 토큰)뿐이다.
    //   X(`at_use`)는 게시·확인 직전에 행 잠금 안에서만 갱신한다 — 여기서 같이 돌리면 1회용 refresh token 을
    //   두 곳이 동시에 써서 계정이 끊긴다(불변 25). 페이스북 페이지(`none`)는 만료가 없다.
    if (adapter.capabilities.tokenRefresh !== 'scheduled') continue;

    try {
      const token = await adapter.refreshToken(creds.credentials, row.access_token, row.refresh_token ?? null);
      if (!token) continue;   // 갱신 수단이 없는 플랫폼 — 건너뛴다.
      await saveRefreshedToken(row.id, token);
    } catch (err: any) {
      if (isSnsReauthError(err)) {
        // 만료·회수 — 계정만 닫는다.
        // ★ 2026-09-24 Harold 결정 Q1 가(기다림) — 그 계정의 예약은 **미리 닫지 않는다.**
        //   시각 전에 다시 연결하면 같은 행이 되살아나 원래 시각에 나가고, 끝내 연결이 안 되면 발행 워커가
        //   게시 직전 계정 재확인에서 그 시각에 사유와 함께 닫는다(sns-publish-worker handleTarget).
        //   끊긴 동안은 화면 '확인할 것' 띠가 "예약 N건이 연결을 기다려요"로 알린다(조용히 실패 0).
        //   전에는 이 판정 한 번(HTTP 400 도 재연결로 본다)에 예약 전부가 되돌릴 수 없게 닫혔다.
        await setSnsAccountStatus(
          row.company_id, row.id, 'reauth_required',
          '채널 연결이 만료되었어요. 다시 연결해 주세요.',
        );
        console.warn(`[SNS token] ${row.platform} 계정 ${row.id} 재연결 필요(예약은 연결을 기다림) — ${err?.message || ''}`);
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
