/**
 * 여정 목록 행 동작 계약 (★ 2026-09-30 AI 존 대개편 D5 · 설계서 §4-1)
 *
 * 옛 행 = 색 아이콘 버튼 최대 10개(라벨 없음) → 새 행 = 대표 1 + 보조 1 + ⋯.
 * 약속: **어떤 상태에서 어떤 동작이 보이는가는 한 글자도 바뀌지 않는다.** 바뀐 것은 자리뿐이다.
 * 기준(ORACLE) = 개편 직전 JourneysPage 행 JSX 의 조건식을 그대로 옮겨 적은 것(구현 함수와 독립).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { journeyVisibleActions, journeyRowActionPlan, type JourneyRowActionId } from '../../../../frontend/src/utils/journey-row-actions';

/** 개편 직전 JSX 조건식(순서 = 옛 버튼 순서) */
function ORACLE(status: string, archivedAt: string | null): JourneyRowActionId[] {
  const out: JourneyRowActionId[] = [];
  out.push('entrants');                                                                           // 무조건
  out.push('stats');                                                                              // 무조건
  if (!archivedAt && status !== 'ended') out.push('target');
  if (!archivedAt && (status === 'draft' || status === 'paused' || status === 'active')) out.push('edit_message');
  out.push('pause_logs');                                                                         // 무조건
  if (!archivedAt && (status === 'draft' || status === 'paused')) out.push('activate');
  if (!archivedAt && status === 'active') out.push('pause');
  if (!archivedAt && status !== 'ended') out.push('end');
  if (!archivedAt && status !== 'active') out.push('archive');
  if (archivedAt) out.push('unarchive');
  if (status !== 'active') out.push('delete');
  return out;
}

const STATUSES = ['draft', 'active', 'paused', 'ended'];
const CASES = STATUSES.flatMap((s) => [[s, false], [s, true]] as const);

describe('여정 행 동작 — 노출 조건은 옛 조건식 그대로', () => {
  it.each(CASES)('%s · 보관=%s: 보이는 동작 집합이 옛 JSX 와 같다', (status, archived) => {
    const got = [...journeyVisibleActions(status, archived)].sort();
    const want = ORACLE(status, archived ? '2026-09-01' : null).slice().sort();
    expect(got).toEqual(want);
  });

  it.each(CASES)('%s · 보관=%s: 대표·보조·⋯ 에 모든 동작이 정확히 한 번씩 놓인다', (status, archived) => {
    const plan = journeyRowActionPlan(status, archived);
    const placed = [plan.primary, plan.secondary, ...plan.menu].filter(Boolean) as JourneyRowActionId[];
    expect(new Set(placed).size, '같은 동작이 두 자리에').toBe(placed.length);
    expect(placed.slice().sort()).toEqual(ORACLE(status, archived ? 'x' : null).slice().sort());
  });

  it('대표 자리 = 상태를 바꾸는 한 수(초안·멈춤 → 켜기 · 켜짐 → 멈추기 · 보관 → 복원 · 끝남 → 성과)', () => {
    expect(journeyRowActionPlan('draft', false).primary).toBe('activate');
    expect(journeyRowActionPlan('paused', false).primary).toBe('activate');
    expect(journeyRowActionPlan('active', false).primary).toBe('pause');
    expect(journeyRowActionPlan('ended', false).primary).toBe('stats');
    expect(journeyRowActionPlan('active', true).primary).toBe('unarchive');
  });

  it('화면의 동작 배선이 옛 버튼과 같은 처리를 부른다', () => {
    const src = readFileSync(resolve(__dirname, '../../../../frontend/src/pages/JourneysPage.tsx'), 'utf8');
    const k = src.indexOf('const run: Record<JourneyRowActionId, () => void> = {');
    expect(k, '행 동작 배선 자리를 못 찾으면 이 계약이 죽은 것이다').toBeGreaterThan(-1);
    const run = src.slice(k, src.indexOf('};', k));
    const expected: Record<JourneyRowActionId, string> = {
      entrants: 'entrants: () => navigate(`/ai-journeys/${j.id}`)',
      stats: 'stats: () => navigate(`/ai-journeys/${j.id}/stats`)',
      target: 'target: () => { setTargetInfo(null); setTargetModal({ journeyId: j.id, journeyName: j.name }); }',
      edit_message: 'edit_message: () => setEditMessageModal({ journeyId: j.id, journeyName: j.name, journeyStatus: j.status })',
      pause_logs: 'pause_logs: () => setPauseLogsModal({ journeyId: j.id, journeyName: j.name })',
      activate: "activate: () => handleAction(j.id, 'activate')",
      pause: "pause: () => handleAction(j.id, 'pause')",
      end: "end: () => handleAction(j.id, 'end')",
      archive: "archive: () => handleAction(j.id, 'archive')",
      unarchive: "unarchive: () => handleAction(j.id, 'unarchive')",
      delete: "delete: () => handleAction(j.id, 'delete')",
    };
    for (const [id, line] of Object.entries(expected)) expect(run, id).toContain(line);
  });
});
