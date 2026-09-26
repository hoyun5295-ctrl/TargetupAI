/**
 * DM 원클릭 액션 — 요즘 DM(pages 구조)에도 읽고 반영한다 (★2026-09-26 한줄로 V2 R1-26)
 *
 * 원클릭 3액션(AI 다듬기 · 디자인 맞춤 · 변수 정합)이 옛 `sections` 칸만 읽고 썼다. D128 이후 DM은 `pages`가 우선이라
 * 섹션을 못 찾아 아무것도 안 바뀌거나(AI 호출만 소모), 옛 칸에만 써서 화면·발송에 반영되지 않았다.
 * 읽기 = extractFlatSectionsFromDm(pages 우선) · 쓰기 = 그 짝 mapDmSections(pages 구조면 pages 안 섹션 · 아니면 sections 칸).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mapDmSections, extractFlatSectionsFromDm } from '../dm/dm-builder';

describe('mapDmSections', () => {
  it('pages 구조면 pages 안 섹션을 바꾼다(sections 칸은 건드리지 않는다)', () => {
    const dm = { pages: [{ id: 'p1', sections: [{ id: 's1', props: { a: 1 } }] }, { id: 'p2', sections: [{ id: 's2', props: { a: 2 } }] }], sections: [{ id: 'old', props: {} }] };
    const r = mapDmSections(dm, (s) => (s.id === 's2' ? { ...s, props: { a: 9 } } : s));
    expect(r?.column).toBe('pages');
    expect(extractFlatSectionsFromDm({ pages: r!.value }).map((s: any) => s.props.a)).toEqual([1, 9]);
  });

  it('pages가 문자열 JSON이어도 같다', () => {
    const dm = { pages: JSON.stringify([{ id: 'p1', sections: [{ id: 's1', props: { a: 1 } }] }]) };
    expect(mapDmSections(dm, (s) => ({ ...s, props: { a: 5 } }))?.column).toBe('pages');
  });

  it('옛 구조면 sections 칸', () => {
    const r = mapDmSections({ pages: null, sections: [{ id: 's1', props: {} }] }, (s) => s);
    expect(r?.column).toBe('sections');
  });

  it('둘 다 없으면 null', () => {
    expect(mapDmSections({}, (s) => s)).toBeNull();
  });
});

describe('원클릭 액션 배선', () => {
  const src = readFileSync(join(__dirname, '..', 'dm', 'dm-quick-action.ts'), 'utf8');
  it('옛 sections 칸만 읽는 조회가 남아 있지 않다', () => {
    expect(src).not.toContain('SELECT sections FROM dm_pages');
    expect(src).not.toContain('SELECT sections, brand_kit FROM dm_pages');
    expect((src.match(/extractFlatSectionsFromDm\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('반영은 mapDmSections가 고른 칸에', () => {
    expect(src).toContain('const mapped = mapDmSections(');
    expect(src).toContain('UPDATE dm_pages SET ${mapped.column} = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3');
  });
});
