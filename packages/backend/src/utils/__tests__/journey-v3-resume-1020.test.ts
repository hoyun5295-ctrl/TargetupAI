/**
 * 여정 V.3 묶음 3 — 다시 켜기 보정(2026-10-20 · 설계서 §6-1 ~ §6-3)
 *
 * 손으로 정한 기대(독립 출처 = 설계서 문장):
 *   - 옛 상태가 멈춤일 때만 · 첫 켜기(초안)는 손대지 않는다
 *   - 굳은 고객 되살리기 = 자동 멈춤 사유 3가지(잔액 · 통신사 · 재시도 소진)만 · 멈출 때 active 였던 실행만
 *   - 밀기 = 멈춘 기간 일 단위 올림 · 멈춘 시각 뒤 실행만 · 날짜 기준 · 한 번 보내기는 밀지 않음
 *   - 커서 = 쓰고 있던 것만 다시 켠 시각으로 · id 비움
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { applyResumeAdjustments, RESUME_REVIVE_SQL, RESUME_SHIFT_SQL, RESUME_CURSOR_SQL, RESUME_REVIVE_REASONS } from '../journey-resume';

function recorder() {
  const calls: Array<{ text: string; params: any[] }> = [];
  return { calls, run: { query: async (text: string, params: any[] = []) => { calls.push({ text, params }); return { rows: [{ id: 'x' }] }; } } };
}

describe('applyResumeAdjustments', () => {
  it('멈춤 → 다시 켜기 = 되살리기 → 밀기 → 커서', async () => {
    const { calls, run } = recorder();
    const r = await applyResumeAdjustments(run, 'J', { status: 'paused', pausedRaw: '2026-10-18 09:00:00.123456+09', startKind: 'event' }, '2026-10-20T03:00:00Z');
    expect(calls.map((c) => c.text)).toEqual([RESUME_REVIVE_SQL, RESUME_SHIFT_SQL, RESUME_CURSOR_SQL]);
    expect(calls[0].params).toEqual(['J', ['balance_insufficient', 'carrier_temp_fail', 'auto_retry_exhausted']]);
    expect(calls[1].params).toEqual(['J', '2026-10-18 09:00:00.123456+09']);
    expect(calls[2].params).toEqual(['J', '2026-10-20T03:00:00Z']);
    expect(r).toEqual({ revived: 1, shifted: 1, cursorReset: true });
  });
  it('첫 켜기(초안)는 아무것도 안 한다', async () => {
    const { calls, run } = recorder();
    expect(await applyResumeAdjustments(run, 'J', { status: 'draft', pausedRaw: null, startKind: 'event' }, 'x')).toEqual({ revived: 0, shifted: 0, cursorReset: false });
    expect(calls).toEqual([]);
  });
  it('날짜 기준 · 한 번 보내기는 밀지 않는다(되살리기 · 커서는 한다)', async () => {
    for (const k of ['date_anchor', 'one_shot']) {
      const { calls, run } = recorder();
      await applyResumeAdjustments(run, 'J', { status: 'paused', pausedRaw: '2026-10-18 09:00:00+09', startKind: k }, 'x');
      expect(calls.map((c) => c.text)).toEqual([RESUME_REVIVE_SQL, RESUME_CURSOR_SQL]);
    }
  });
  it('멈춘 시각이 없으면 밀지 않는다', async () => {
    const { calls, run } = recorder();
    await applyResumeAdjustments(run, 'J', { status: 'paused', pausedRaw: null, startKind: 'event' }, 'x');
    expect(calls.map((c) => c.text)).toEqual([RESUME_REVIVE_SQL, RESUME_CURSOR_SQL]);
  });
});

describe('보정 문장의 뜻', () => {
  it('되살리기 = 그 여정 · 멈춘 실행 · 자동 멈춤 기록(멈출 때 active) · 그날 정지 · 번호 오류 제외', () => {
    expect(RESUME_REVIVE_SQL).toContain("e.status = 'paused'");
    expect(RESUME_REVIVE_SQL).toContain("l.execution_status_at_pause = 'active'");
    expect(RESUME_REVIVE_SQL).toContain('l.pause_reason = ANY($2::text[])');
    expect(RESUME_REVIVE_REASONS).not.toContain('manager_manual');
    expect(RESUME_REVIVE_REASONS).not.toContain('phone_invalid');
  });
  it('밀기 = 일 단위 올림(최소 1일) · 멈춘 시각 뒤 실행만 · 켜진 실행만', () => {
    expect(RESUME_SHIFT_SQL).toContain('CEIL(EXTRACT(EPOCH FROM (NOW() - $2::timestamptz)) / 86400.0)');
    expect(RESUME_SHIFT_SQL).toContain('GREATEST(1,');
    expect(RESUME_SHIFT_SQL).toContain('next_run_at > $2::timestamptz');
    expect(RESUME_SHIFT_SQL).toContain("status = 'active'");
  });
  it('커서 = 쓰고 있던 것만 · id 비움', () => {
    expect(RESUME_CURSOR_SQL).toContain('CASE WHEN last_event_cursor IS NOT NULL THEN $2::timestamptz ELSE NULL END');
    expect(RESUME_CURSOR_SQL).toContain('CASE WHEN last_purchase_cursor IS NOT NULL THEN $2::timestamptz ELSE NULL END');
    expect(RESUME_CURSOR_SQL).toContain('last_event_cursor_id = NULL');
    expect(RESUME_CURSOR_SQL).toContain('last_purchase_cursor_id = NULL');
  });
});

describe('켜기 함수 배선', () => {
  const b = fs.readFileSync(path.join(__dirname, '..', 'journey-builder.ts'), 'utf-8');
  const fn = b.slice(b.indexOf('export async function activateJourney('), b.indexOf('async function createJourneyStepSnapshots'));
  it('옛 상태를 잠금 안에서 읽고(UPDATE 앞) · UPDATE 뒤 · 닫기 · 커밋 앞에서 보정한다', () => {
    const prev = fn.indexOf('paused_at::text AS paused_raw');
    const upd = fn.indexOf("status = 'active',");
    const adj = fn.indexOf('await applyResumeAdjustments(');
    const close = fn.indexOf('CLOSE_OTHER_VERSIONS_ENTRY_SQL');
    const commit = fn.indexOf("inheritConflict ? 'ROLLBACK' : 'COMMIT'");
    expect(prev).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(prev);
    expect(adj).toBeGreaterThan(upd);
    expect(close).toBeGreaterThan(adj);
    expect(commit).toBeGreaterThan(close);
    expect(fn).toContain('FOR UPDATE');
  });
});
