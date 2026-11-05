/**
 * utils/spam-test-view.ts — 스팸 검사 한 건의 안전 보기(★ 2026-11-05 C103 F1 · 원본 = services/ai-line-spam.ts verdictOf 를 옮김)
 *
 * 부르는 곳 = AI 한줄로 칩(services/ai-line-spam.ts) · 여정 칸 「지금 스팸 검사」 창(routes/ai.ts 여정 칸 검사 주소).
 * 내주는 것 = 상태 · 통신사별 결과 · 앞 대기 수 · 진행 초만(검사 행 원본 · 받는 사람 · 만든 사람 0 · Codex 설계 1R H2).
 */
import { query } from '../config/database';
import { spamTestStartedAtMs } from './spam-test-queue';
import { judgeSpamVerdict, withExpectedSpamDevices } from './spam-trial';

export type SpamCheckViewState = 'queued' | 'running' | 'pass' | 'blocked' | 'checking' | 'warn';

export interface SpamCheckView {
  state: SpamCheckViewState;
  carriers: Array<{ carrier: string; result: 'pass' | 'blocked' | 'checking' | 'none' }>;
  aheadCount: number;
  elapsedSec: number;
}

/** 검사 한 건 → 보기(기대 테스트폰을 채운 판정 · 수동 검사 창과 같은 함수) */
export async function spamCheckView(testId: string, status: string, createdAt: Date, msgType: string | null): Promise<SpamCheckView> {
  const results = await query(
    `SELECT carrier, phone, received, result FROM spam_filter_test_results WHERE test_id = $1${msgType ? ' AND message_type = $2' : ''} ORDER BY carrier`,
    msgType ? [testId, msgType] : [testId],
  );
  const devices = await query(`SELECT carrier, phone FROM spam_filter_devices WHERE is_active = true`);
  const rows = withExpectedSpamDevices(results.rows, devices.rows);
  const verdict = judgeSpamVerdict(status, rows);
  const startedAt = spamTestStartedAtMs(testId) ?? new Date(createdAt).getTime();
  let aheadCount = 0;
  if (status === 'queued') {
    const ahead = await query(
      `SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE status IN ('queued', 'active') AND created_at < $1`,
      [createdAt],
    );
    aheadCount = Number(ahead.rows[0]?.n) || 0;
  }
  const state: SpamCheckViewState = status === 'queued' ? 'queued'
    : verdict === 'running' ? 'running'
    : verdict === 'pass' ? 'pass'
    : verdict === 'blocked' ? 'blocked'
    : verdict === 'checking' ? 'checking'
    : 'warn';
  const byCarrier = new Map<string, 'pass' | 'blocked' | 'checking' | 'none'>();
  for (const r of rows) {
    const cur = byCarrier.get(r.carrier);
    const val: 'pass' | 'blocked' | 'checking' | 'none' = r.result === 'blocked' ? 'blocked' : (r.received || r.result === 'pass') ? 'pass'
      : r.result === 'unconfirmed' ? 'checking' : 'none';
    if (cur === 'blocked' || (cur === 'checking' && val !== 'blocked') || (cur === 'pass' && val === 'none')) continue;
    byCarrier.set(r.carrier, val);
  }
  return {
    state,
    carriers: [...byCarrier.entries()].map(([carrier, result]) => ({ carrier, result })),
    aheadCount,
    elapsedSec: status === 'active' ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0,
  };
}
