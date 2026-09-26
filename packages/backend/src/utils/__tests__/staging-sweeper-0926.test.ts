/**
 * 발송 스테이징 정리 워커 계약 (★2026-09-26 한줄로 전수점검 S1-H08 · M-12 실측)
 *
 * 직접발송·알림톡 창은 발송 버튼마다 확인 창 **전에** 수신자 전체를 새 stagingId로 적재한다.
 * 확인 창 취소·재클릭·청크 도중 실패분이 캠페인 없이 남아 240만 행(863MB)이 쌓였다(0926 운영 실측 · 전량 연결 캠페인 없음).
 * 기간계(발송·차감)에 닿지 않는 것이 조건이다:
 *   - 캠페인이 가리키는 적재분은 지우지 않는다.
 *   - 적재분은 **통째로만** 지운다(모든 행이 24시간 지난 것) — 일부만 지운 적재분이 발송되면 나머지가 조용히 빠진다(Codex 1R high).
 *   - commit은 23시간 넘은 적재분을 만료로 거절한다 — 정리가 손대는 적재분(24시간+)은 결코 commit되지 않는다(1시간 여유).
 *   - 운영 DB가 디스크 하나를 나눠 쓰므로 야간(KST 01~03시 · 03시 백업 전)에만 쉬어 가며 지운다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isStagingSweepWindow,
  runStagingSweepOnce,
  resolveStagingCommitState,
  STAGING_PICK_SQL,
  STAGING_DELETE_SQL,
  STAGING_ORPHAN_AGE_HOURS,
  STAGING_COMMIT_MAX_AGE_HOURS,
} from '../staging-sweeper';

const kst = (s: string) => new Date(s + '+09:00');

describe('야간 창(KST 01:00 ~ 02:59 · 03시 백업과 겹치지 않는다)', () => {
  it('창 안', () => {
    expect(isStagingSweepWindow(kst('2026-09-27T01:00:00'))).toBe(true);
    expect(isStagingSweepWindow(kst('2026-09-27T02:59:59'))).toBe(true);
  });
  it('창 밖', () => {
    expect(isStagingSweepWindow(kst('2026-09-27T00:59:59'))).toBe(false);
    expect(isStagingSweepWindow(kst('2026-09-27T03:00:00'))).toBe(false);
    expect(isStagingSweepWindow(kst('2026-09-27T14:00:00'))).toBe(false);
  });
});

describe('만료 계약 — 정리와 commit이 같은 기준을 본다', () => {
  it('commit 만료(23시간)는 정리 기준(24시간)보다 짧다 = 정리가 고르는 적재분은 commit될 수 없다', () => {
    expect(STAGING_ORPHAN_AGE_HOURS).toBe(24);
    expect(STAGING_COMMIT_MAX_AGE_HOURS).toBe(23);
    expect(STAGING_COMMIT_MAX_AGE_HOURS).toBeLessThan(STAGING_ORPHAN_AGE_HOURS);
  });

  it('고르기: 캠페인이 가리키지 않고 24시간 지난 행 중 제외 목록에 없는 적재분 하나(커서 없음 · id가 섞인 적재분도 빠뜨리지 않는다 · Codex 2R)', () => {
    expect(STAGING_PICK_SQL).toContain('NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = s.staging_id)');
    expect(STAGING_PICK_SQL).toContain("s.created_at < NOW() - ($1::int * INTERVAL '1 hour')");
    expect(STAGING_PICK_SQL).toContain('NOT (s.staging_id = ANY($2::uuid[]))');
    expect(STAGING_PICK_SQL).toContain('ORDER BY s.id');
    expect(STAGING_PICK_SQL).toContain('LIMIT 1');
    expect(STAGING_PICK_SQL).not.toContain('s.id >');
    expect(STAGING_PICK_SQL).not.toContain('MAX(');
  });

  it('지우기: 적재분 통째 · 한 문장 안에서 캠페인 부재와 "24시간 안 된 행 없음"을 다시 건다', () => {
    expect(STAGING_DELETE_SQL).toContain('WHERE d.staging_id = $1');
    expect(STAGING_DELETE_SQL).toContain('NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.staging_id = $1)');
    expect(STAGING_DELETE_SQL).toContain("y.created_at >= NOW() - ($2::int * INTERVAL '1 hour')");
    expect(STAGING_DELETE_SQL).not.toContain('LIMIT');
  });
});

describe('resolveStagingCommitState', () => {
  it('적재 행이 0이면 만료', async () => {
    const q = vi.fn(async () => ({ rows: [{ n: 0, stale: null }] }));
    expect(await resolveStagingCommitState('s', 'c', q)).toBe('expired');
  });
  it('가장 오래된 행이 23시간을 넘으면 만료', async () => {
    const q = vi.fn(async () => ({ rows: [{ n: 10, stale: true }] }));
    expect(await resolveStagingCommitState('s', 'c', q)).toBe('expired');
  });
  it('그 밖에는 통과 · 회사와 23시간 기준으로 묻는다', async () => {
    const q = vi.fn(async () => ({ rows: [{ n: 10, stale: false }] }));
    expect(await resolveStagingCommitState('stg', 'co', q)).toBe('ok');
    const [sql, params] = (q.mock.calls[0] as any[]);
    expect(sql).toContain('WHERE staging_id = $1 AND company_id = $2');
    expect(sql).toContain("MIN(created_at) < NOW() - ($3::int * INTERVAL '1 hour')");
    expect(params).toEqual(['stg', 'co', STAGING_COMMIT_MAX_AGE_HOURS]);
  });
});

describe('runStagingSweepOnce', () => {
  const inWindow = () => kst('2026-09-27T01:30:00');
  const pick = (stagingId: string) => ({ rows: [{ staging_id: stagingId }] });
  const none = { rows: [] };

  it('창 밖이면 DB를 부르지 않는다', async () => {
    const q = vi.fn();
    const r = await runStagingSweepOnce({ query: q, now: () => kst('2026-09-27T10:00:00'), sleep: async () => {} });
    expect(q).not.toHaveBeenCalled();
    expect(r).toEqual({ deleted: 0, stagings: 0, stopped: 'window' });
  });

  it('적재분을 하나씩 골라 통째로 지우고, 고를 것이 없으면 멈춘다', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce(pick('a'))
      .mockResolvedValueOnce({ rows: [], rowCount: 3000 })
      .mockResolvedValueOnce(pick('b'))
      .mockResolvedValueOnce({ rows: [], rowCount: 50 })
      .mockResolvedValueOnce(none);
    const r = await runStagingSweepOnce({ query: q, now: inWindow, sleep: async () => {} });
    expect(r).toEqual({ deleted: 3050, stagings: 2, stopped: 'drained' });
    expect(q.mock.calls[0]).toEqual([STAGING_PICK_SQL, [STAGING_ORPHAN_AGE_HOURS, []]]);
    expect(q.mock.calls[1]).toEqual([STAGING_DELETE_SQL, ['a', STAGING_ORPHAN_AGE_HOURS]]);
    expect(q.mock.calls[2]).toEqual([STAGING_PICK_SQL, [STAGING_ORPHAN_AGE_HOURS, []]]);
  });

  it('id가 섞인 적재분(A={1,6} · B={2,5} · C={3,4})도 한 회차에 전부 지운다(Codex 2R)', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce(pick('A')).mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce(pick('B')).mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce(pick('C')).mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce(none);
    const r = await runStagingSweepOnce({ query: q, now: inWindow, sleep: async () => {} });
    expect(r).toEqual({ deleted: 6, stagings: 3, stopped: 'drained' });
  });

  it('지우지 못한 적재분(24시간 안 된 행이 섞임)은 그 회차의 제외 목록에 넣어 다시 고르지 않는다', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce(pick('young'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce(none);
    const r = await runStagingSweepOnce({ query: q, now: inWindow, sleep: async () => {} });
    expect(r).toEqual({ deleted: 0, stagings: 0, stopped: 'drained' });
    expect(q.mock.calls[2][1]).toEqual([STAGING_ORPHAN_AGE_HOURS, ['young']]);
  });

  it('적재분 사이에 쉰다', async () => {
    const sleep = vi.fn(async () => {});
    const q = vi.fn()
      .mockResolvedValueOnce(pick('a'))
      .mockResolvedValueOnce({ rows: [], rowCount: 5 })
      .mockResolvedValueOnce(none);
    await runStagingSweepOnce({ query: q, now: inWindow, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('1회 상한(행 수)에 닿으면 멈춘다(나머지는 다음 회차)', async () => {
    let n = 0;
    const q = vi.fn(async (sql: string) => (sql === STAGING_PICK_SQL
      ? pick(`s${++n}`)
      : { rows: [], rowCount: 4000 }));
    const r = await runStagingSweepOnce({ query: q as any, now: inWindow, sleep: async () => {}, maxPerRun: 10000 });
    expect(r).toEqual({ deleted: 12000, stagings: 3, stopped: 'cap' });
  });

  it('도는 중 창이 닫히면 다음 적재분을 고르지 않는다', async () => {
    const times = [kst('2026-09-27T02:59:00'), kst('2026-09-27T03:00:01')];
    const q = vi.fn()
      .mockResolvedValueOnce(pick('a'))
      .mockResolvedValueOnce({ rows: [], rowCount: 7 });
    const r = await runStagingSweepOnce({ query: q, now: () => times.shift() || kst('2026-09-27T03:10:00'), sleep: async () => {} });
    expect(q).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ deleted: 7, stagings: 1, stopped: 'window' });
  });

  it('DB 오류는 던지지 않고 멈춘다(지운 만큼은 돌려준다)', async () => {
    const q = vi.fn()
      .mockResolvedValueOnce(pick('a'))
      .mockResolvedValueOnce({ rows: [], rowCount: 9 })
      .mockRejectedValueOnce(new Error('boom'));
    const r = await runStagingSweepOnce({ query: q, now: inWindow, sleep: async () => {} });
    expect(r).toEqual({ deleted: 9, stagings: 1, stopped: 'error' });
  });
});

describe('기동 배선', () => {
  it('app.ts가 정리 워커를 기동한다', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'app.ts'), 'utf8');
    expect(app).toContain("import { startStagingSweeper } from './utils/staging-sweeper'");
    expect(app).toMatch(/\n\s+startStagingSweeper\(\);/);
  });
});
