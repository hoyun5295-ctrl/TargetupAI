/**
 * 시스템 멈춤 담당자 안내(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-5 ①) — 결정 표 · 멈춤 쓰기 사유 전수.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const q = vi.fn();
const enqueue = vi.fn();
const alert = vi.fn(async () => undefined);
vi.mock('../../config/database', () => ({ query: (...a: any[]) => q(...a) }));
vi.mock('../journey-pretest-notifier', () => ({ enqueueManagerNotice: (...a: any[]) => enqueue(...a) }));
vi.mock('../owner-contact', () => ({ pickOwnerContact: vi.fn(async () => ({ userId: 'u1', phone: '01000000000' })) }));
vi.mock('../manager-board', () => ({ generateManagerBoardToken: () => 't', buildManagerBoardShortUrl: async () => 'https://hanjul.ai/b/x' }));
vi.mock('../demo-company', () => ({ isDemoCompany: vi.fn(async () => false) }));
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (alert as any)(...a) }));
import { notifyPausedJourneys, pauseNeedsNotice, buildPauseNoticeBody } from '../journey-pause-notice';
import { MANUAL_PAUSE_REASON, ANCHOR_COMPLETED_PAUSE_REASON, pauseReasonView } from '../journey-pause-reason';

const row = (over: Record<string, any> = {}) => ({ id: 'j1', company_id: 'c1', created_by: 'u1', name: '가입 환영', pause_reason: '잔액 부족', paused_raw: '2026-11-02 10:00:00.123456+00', pause_notice_attempts: 0, ...over });

describe('멈춤 안내 결정 표', () => {
  beforeEach(() => { q.mockReset(); enqueue.mockReset(); alert.mockClear(); });
  it('사람 멈춤 · 날짜 기준 마침 = 안내 0(마감만)', async () => {
    expect(pauseNeedsNotice(MANUAL_PAUSE_REASON)).toBe(false);
    expect(pauseNeedsNotice(ANCHOR_COMPLETED_PAUSE_REASON)).toBe(false);
    expect(pauseNeedsNotice('잔액 부족')).toBe(true);
    q.mockResolvedValueOnce({ rows: [row({ pause_reason: MANUAL_PAUSE_REASON })] }).mockResolvedValue({ rows: [{ id: 'j1' }] });
    expect(await notifyPausedJourneys()).toEqual({ sent: 0, skipped: 1 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(q.mock.calls[1][0]).toContain('SET pause_notice_for = paused_at, pause_notice_attempts = 0');
  });
  it('시스템 멈춤 = 잡기(그 멈춤 · 시도 < 3) → 적재 → 성공 기록(그 멈춤)', async () => {
    q.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValue({ rows: [{ id: 'j1' }] });
    enqueue.mockResolvedValue(true);
    expect(await notifyPausedJourneys()).toEqual({ sent: 1, skipped: 0 });
    const claim = q.mock.calls[1];
    // ★ Codex 구현 1R — 시도 수 = 지금 멈춤의 것(새 멈춤 = 1부터 · 그 멈춤 시도 중 = 하나 더)
    expect(claim[0]).toContain('pause_notice_attempts = CASE WHEN pause_notice_for IS DISTINCT FROM paused_at THEN 1 ELSE pause_notice_attempts + 1 END');
    expect(claim[0]).toContain('(pause_notice_for IS DISTINCT FROM paused_at OR (pause_notice_attempts > 0 AND pause_notice_attempts < $3))');
    expect(claim[0]).toContain('paused_at = $2::timestamptz');
    expect(claim[1]).toEqual(['j1', '2026-11-02 10:00:00.123456+00', 3]);
    const body = enqueue.mock.calls[0][0].body as string;
    expect(body).toContain(pauseReasonView('잔액 부족').text);
    expect(body).toContain('할 일: 충전하기');
    expect(body).not.toContain('잔액 부족');   // 원문 사유 노출 0
    expect(q.mock.calls[2][0]).toContain('SET pause_notice_for = paused_at');
  });
  it('적재 실패 = 성공 기록 없음(다음 회차가 시도 하나 더) · 3번 쓴 멈춤 = 운영 경보 + 마감', async () => {
    q.mockResolvedValueOnce({ rows: [row()] }).mockResolvedValue({ rows: [{ id: 'j1' }] });
    enqueue.mockResolvedValue(false);
    expect((await notifyPausedJourneys()).sent).toBe(0);
    expect(q).toHaveBeenCalledTimes(2);
    q.mockReset();
    q.mockResolvedValueOnce({ rows: [row({ pause_notice_attempts: 3 })] }).mockResolvedValue({ rows: [{ id: 'j1' }] });
    await notifyPausedJourneys();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[1][0]).toContain('SET pause_notice_for = paused_at');
  });
  it('칸 없음(DDL-1 전 · 42703) = 패스만 쉼 · 운영 경보 한 번', async () => {
    q.mockRejectedValue(Object.assign(new Error('column does not exist'), { code: '42703' }));
    expect(await notifyPausedJourneys()).toEqual({ sent: 0, skipped: 0 });
    expect(await notifyPausedJourneys()).toEqual({ sent: 0, skipped: 0 });
    expect(alert).toHaveBeenCalledTimes(1);
  });
  it('본문 = 여정 이름 · 사람 말 이유 · 할 일 · 상황판', () => {
    const b = buildPauseNoticeBody({ journeyName: '가입 환영', reasonText: 'X', fixLabel: '충전하기', boardUrl: 'https://hanjul.ai/b/x' });
    expect(b).toContain("'가입 환영' 여정이 멈췄어요.");
    expect(b).toContain('상황판: https://hanjul.ai/b/x');
  });
});

describe('여정 멈춤 쓰기 사유 전수 — 글자 사유 = 아는 종류 · 사람 멈춤(manual) = 상수 쓰는 자리만', () => {
  const ROOT = join(__dirname, '..', '..');
  const out: Array<{ rel: string; reason: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p); continue; }
      if (!/\.ts$/.test(name) || /\.(test|pg|verify)\.ts$/.test(name)) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/pausedSetSql\(\w+, (['`])((?:(?!\1).)+)\1\)/g)) out.push({ rel: relative(ROOT, p).split('\\').join('/'), reason: m[2].replace(/\$\{[^}]+\}/g, 'X') });
    }
  };
  walk(ROOT);
  it('글자로 넘기는 멈춤 사유를 뽑았다', () => { expect(out.length).toBeGreaterThanOrEqual(2); });
  it('이름 붙은 멈춤 사유 상수 = 아는 종류 · 사람 멈춤 아님', async () => {
    const { ONE_SHOT_DISPATCH_FAILED_REASON } = await import('../journey-activation');
    const { REENTRY_CAP_PAUSE_REASON } = await import('../journey-reentry-worker');
    for (const r of [ONE_SHOT_DISPATCH_FAILED_REASON, REENTRY_CAP_PAUSE_REASON(3, 1)]) expect(['unknown', 'manual'], r).not.toContain(pauseReasonView(r).kind);
  });
  it('모두 아는 종류 · 사람 멈춤으로 읽히지 않는다(안내가 빠지지 않게)', () => {
    const bad = out.filter((o) => ['unknown', 'manual'].includes(pauseReasonView(o.reason).kind)).map((o) => `${o.rel}: ${o.reason}`);
    expect(bad).toEqual([]);
  });
  it('사람 멈춤 경로 = 상수(화면이 보낸 사유를 쓰지 않는다)', () => {
    const ai = readFileSync(join(ROOT, 'routes', 'ai.ts'), 'utf8');
    expect(ai).not.toMatch(/pauseJourney\w*\([^)]*req\.body\.reason/);
  });
});
