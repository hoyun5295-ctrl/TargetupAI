/**
 * 칸 번역 응답 해석 (★ 2026-10-05 · 신뢰 설계 · Codex 1R)
 *   AI 가 낸 조건 중 칸 · 연산자가 빠진 것을 버리면 남은 조건만으로 대상이 넓어진다(「10월 생일 VIP」 → 모든 VIP).
 *   버리지 않고 「옮기지 못한 말」로 돌려 화면이 칸을 고르게 한다.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));

import { parseConditionTranslation } from '../../services/ai';

describe('parseConditionTranslation — 조건을 버리지 않는다', () => {
  it('칸이 빠진 조건 = 옮기지 못한 말(남은 조건만으로 확정하지 않는다)', () => {
    const r = parseConditionTranslation(JSON.stringify({
      conditions: [{ term: '등급', field: 'grade', operator: 'eq', value: 'VIP' }, { term: '생일', field: '', operator: 'birth_month', value: 10 }],
      unexpressed: [], everyone: false,
    }));
    expect(r?.conditions).toEqual([{ term: '등급', field: 'grade', operator: 'eq', value: 'VIP' }]);
    expect(r?.unexpressed).toEqual([{ term: '생일', operator: 'birth_month', value: 10 }]);
    expect(r?.everyone).toBe(false);
  });
  it('이름 없는 「옮기지 못한 말」 · 모양이 틀린 조건도 남긴다 · 그때 everyone 은 거짓', () => {
    const r = parseConditionTranslation('설명 {"conditions": ["VIP"], "unexpressed": [{"operator": "gte", "value": 1}], "everyone": true} 끝');
    expect(r?.conditions).toEqual([]);
    expect(r?.unexpressed.map((u) => u.term)).toEqual(['VIP', '대상 조건']);
    expect(r?.everyone).toBe(false);
  });
  it('배열이 아닌 unexpressed · conditions(객체 하나)도 남긴다(Codex 2R)', () => {
    const r = parseConditionTranslation(JSON.stringify({
      conditions: { term: '등급', field: 'grade', operator: 'eq', value: 'VIP' }, unexpressed: { term: '생일' }, everyone: false,
    }));
    expect(r?.conditions).toEqual([{ term: '등급', field: 'grade', operator: 'eq', value: 'VIP' }]);
    expect(r?.unexpressed).toEqual([{ term: '생일' }]);
  });
  it('조건 없음 = everyone · JSON 없음 = null(막힘)', () => {
    expect(parseConditionTranslation('{"conditions": [], "unexpressed": [], "everyone": true}')).toEqual({ conditions: [], unexpressed: [], everyone: true });
    expect(parseConditionTranslation('번역할 수 없습니다')).toBeNull();
  });
});
