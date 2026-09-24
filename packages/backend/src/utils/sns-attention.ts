/**
 * sns-attention.ts — SNS '확인할 것' 띠 판정 컨트롤타워 (2026-09-24)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §5 C1.
 *
 * 화면 맨 위 띠는 **할 일이 있을 때만** 나온다. 무엇을 띄울지는 여기 한 곳이 정하고 화면은 그리기만 한다
 * (화면이 받는 기록은 최근 50건뿐이라 화면에서 세면 틀린다 · 0924 교차 토론).
 *
 * 우선순위 = ① 다시 연결 ② 연장 실패 ③ 올리지 못한 글 ④ 올라갔는지 확인 필요.
 *   ① status ∉ {active, revoked}: 끊김(token_expired·reauth_required·error) · 연결 확인 멈춤(pending 10분+) · 게시 자격 없음(ineligible)
 *      + 그 계정으로 기다리는 예약 수(Q1 가 = 끊겨도 예약은 닫지 않고 기다린다 → 띠가 유일한 알림이다)
 *   ② active ∧ 연장 실패 ∧ 만료 7일 이내(toAccountCard.renewFailing 과 같은 판정)
 *   ③ 최근 7일 · 계정별 최신 행 · failed(끊김 사유는 ①이 이미 말하므로 뺀다)
 *   ④ 최근 7일 · 결과 모름(PUBLISH_OUTCOME_UNKNOWN) 또는 확인 포기(verify_gave_up_at)
 *   ③④ 공통: 그 실패 뒤 같은 계정에 **같은 본문이거나 사진이 겹치는 글**을 다시 올렸으면 뺀다
 *            (불러와서 쓰기·다시 붙여 넣기로 해결한 것이 7일 내내 남지 않게 · 0924 최종 검증 M2)
 */

import { query } from '../config/database';
import { SNS_ERROR_CODES } from './sns-constants';
import { snsLatestTargetSql } from './sns-retry';
import { toAccountCard, snsChannelUrl, type SnsAccountRow } from './sns-accounts';

export const SNS_ATTENTION_DAYS = 7;
export const SNS_ATTENTION_SHOW = 3;

export type SnsAttentionKind = 'reconnect' | 'stuck' | 'ineligible' | 'renew_failing' | 'failed' | 'unknown';

export interface SnsAttentionItem {
  kind: SnsAttentionKind;
  platform: string;
  accountId: string;
  accountUsername: string | null;
  accountDisplayName: string | null;
  /** 계정 사유(ineligible 등) 또는 글 실패 사유 */
  reason: string | null;
  /** ① 그 계정으로 기다리는 예약 수 */
  waitingScheduled?: number;
  /** ② 연결 만료 시각 */
  expiresAt?: string | null;
  /** ③④ 해당 글 */
  postId?: string;
  targetId?: string;
  /** ③④ 실패·게시 시각 */
  at?: string | null;
  /** ④ 채널에서 확인할 주소(permalink 우선 · 없으면 계정 프로필 · 둘 다 없으면 null) */
  checkUrl?: string | null;
}

export async function listSnsAttention(companyId: string, accounts: SnsAccountRow[], now: number = Date.now()): Promise<{
  items: SnsAttentionItem[];
  total: number;
}> {
  const all: SnsAttentionItem[] = [];

  // ① · ②
  for (const a of accounts) {
    if (a.status === 'revoked') continue;
    const card = toAccountCard(a, now);
    const base = {
      platform: a.platform,
      accountId: a.id,
      accountUsername: a.username,
      accountDisplayName: a.display_name,
    };
    if (a.status === 'pending') {
      if (card.stuck) all.push({ kind: 'stuck', ...base, reason: null, waitingScheduled: card.waitingScheduled });
      continue;
    }
    if (a.status === 'ineligible') {
      all.push({ kind: 'ineligible', ...base, reason: a.status_reason, waitingScheduled: card.waitingScheduled });
      continue;
    }
    if (a.status !== 'active') {
      all.push({ kind: 'reconnect', ...base, reason: a.status_reason, waitingScheduled: card.waitingScheduled });
      continue;
    }
    if (card.renewFailing) {
      all.push({ kind: 'renew_failing', ...base, reason: null, expiresAt: card.tokenExpiresAt });
    }
  }

  // ③ · ④
  const rows = await query(
    `SELECT t.id, t.post_id, t.platform, t.account_id, t.status, t.last_error, t.last_error_code,
            t.verify_gave_up_at, t.permalink, t.updated_at,
            a.status AS account_status, a.username, a.display_name, a.external_account_id
       FROM sns_post_targets t
       JOIN sns_posts p ON p.id = t.post_id AND p.company_id = t.company_id
       LEFT JOIN sns_accounts a ON a.id = t.account_id AND a.company_id = t.company_id
      WHERE t.company_id = $1::uuid
        AND t.updated_at > NOW() - ($2 || ' days')::interval
        AND ${snsLatestTargetSql('t')}
        AND ((t.status = 'failed' AND t.platform_post_id IS NULL)
             OR (t.status = 'submitted' AND t.verify_gave_up_at IS NOT NULL))
        AND NOT EXISTS (
          SELECT 1 FROM sns_posts p2
            JOIN sns_post_targets t2 ON t2.post_id = p2.id AND t2.company_id = p2.company_id
           WHERE p2.company_id = p.company_id AND p2.id <> p.id
             AND t2.account_id = t.account_id AND t2.created_at > t.created_at
             AND t2.status NOT IN ('draft', 'cancelled')
             AND (p2.body = p.body OR p2.media_ids && p.media_ids))
      ORDER BY t.updated_at DESC
      LIMIT 50`,
    [companyId, String(SNS_ATTENTION_DAYS)],
  );
  for (const t of rows.rows) {
    const base = {
      platform: t.platform,
      accountId: t.account_id,
      accountUsername: t.username ?? null,
      accountDisplayName: t.display_name ?? null,
      postId: t.post_id,
      targetId: t.id,
      at: t.updated_at ? new Date(t.updated_at).toISOString() : null,
    };
    const unknown = t.last_error_code === SNS_ERROR_CODES.PUBLISH_OUTCOME_UNKNOWN || (t.status === 'submitted' && t.verify_gave_up_at);
    if (unknown) {
      all.push({
        kind: 'unknown', ...base, reason: t.last_error ?? null,
        checkUrl: t.permalink || snsChannelUrl(t.platform, t.username ?? null, t.external_account_id ?? null),
      });
      continue;
    }
    // 끊김 때문에 못 올린 글은 ①(다시 연결) 줄이 이미 말한다.
    if (t.account_status !== 'active' && t.last_error_code === SNS_ERROR_CODES.REAUTH_REQUIRED) continue;
    all.push({ kind: 'failed', ...base, reason: t.last_error ?? null });
  }

  const order: Record<SnsAttentionKind, number> = { reconnect: 0, stuck: 0, ineligible: 0, renew_failing: 1, failed: 2, unknown: 3 };
  all.sort((a, b) => order[a.kind] - order[b.kind]);
  return { items: all.slice(0, SNS_ATTENTION_SHOW), total: all.length };
}
