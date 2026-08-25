/**
 * 이메일 블록 순서 이동 계약 (★ 2026-08-25 · 접수 cmt8dbun201lrjnota46p7c5z 임은지)
 *
 * **결함**: "이메일 제작 시 왼쪽 블록 순서 이동이 드래그로도 화살표로도 안 된다."
 * 뿌리는 `normalizeOrder`였다. 이 함수는 **`order` 값을 진실로 삼아 다시 정렬**하는데,
 * 이동 코드가 배열 위치만 바꾸고 `order`는 그대로 둔 채 넘겨서 **이동이 그대로 취소**됐다.
 * 화면은 `order`로 그리므로 사용자에게는 아무 일도 안 일어난 것으로 보인다.
 *
 * DM 스토어(`reorderSections`)는 이미 이 함정을 알고 옮긴 뒤 번호를 다시 매기고 있었다.
 * 그 지식이 이메일 편집기로 안 옮겨진 것이 이번 접수다. 그래서 이름 있는 함수(`resequence`)로 못박고
 * 여기서 두 함수의 계약 차이를 고정한다.
 *
 * 프론트에 테스트 러너가 없어 backend 러너가 프론트 유틸과 소스를 읽는다(선례 = agency-send-vars.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeOrder, resequence, moveWithin } from '../../../../frontend/src/utils/dm-section-defaults';

/** 테스트용 최소 섹션 */
const S = (id: string, order: number) => ({ id, type: 'text_card', order } as any);

describe('순서 함수 두 벌의 계약이 다르다', () => {
  it('normalizeOrder는 배열 위치가 아니라 order 값을 따른다', () => {
    const swapped = [S('b', 1), S('a', 0)]; // 위치만 바꾼 상태
    expect(normalizeOrder(swapped).map((s) => s.id), 'order 값으로 되돌아간다').toEqual(['a', 'b']);
  });

  it('resequence는 지금 배열 순서를 그대로 굳힌다', () => {
    const swapped = [S('b', 1), S('a', 0)];
    const out = resequence(swapped);
    expect(out.map((s) => s.id)).toEqual(['b', 'a']);
    expect(out.map((s) => s.order), '번호는 0부터 다시 매겨진다').toEqual([0, 1]);
  });

  it('원본을 건드리지 않는다', () => {
    const src = [S('a', 0), S('b', 1)];
    resequence(src);
    expect(src[0].order).toBe(0);
  });
});

describe('블록 이동 회귀 — 접수 그대로 재현', () => {
  /** 편집기의 이동 로직(위치 스왑)을 그대로 흉내낸다 */
  const moveOnce = (list: any[], from: number, to: number) => {
    const arr = list.slice().sort((a, b) => a.order - b.order);
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    return arr;
  };
  /** 화면은 order로 그린다 */
  const asRendered = (list: any[]) => list.slice().sort((a, b) => a.order - b.order).map((s) => s.id);

  const START = [S('header', 0), S('hero', 1), S('slide', 2), S('cta', 3)];

  it('옛 방식(normalizeOrder)은 이동을 되돌린다 — 이것이 접수된 증상', () => {
    const moved = moveOnce(START, 2, 1); // 상품 슬라이드를 한 칸 위로
    expect(asRendered(normalizeOrder(moved))).toEqual(['header', 'hero', 'slide', 'cta']);
  });

  it('resequence면 옮긴 자리가 화면에 남는다', () => {
    const moved = moveOnce(START, 2, 1);
    expect(asRendered(resequence(moved))).toEqual(['header', 'slide', 'hero', 'cta']);
  });

  it('맨 위 블록을 더 위로 보내도 목록이 깨지지 않는다', () => {
    const moved = moveOnce(START, 0, 0);
    expect(asRendered(resequence(moved))).toEqual(['header', 'hero', 'slide', 'cta']);
  });
});

describe('moveWithin — 드래그와 화살표가 함께 쓰는 이동', () => {
  const START = [S('a', 0), S('b', 1), S('c', 2)];
  const ids = (l: any[]) => l.slice().sort((x, y) => x.order - y.order).map((s) => s.id);

  it('옮긴 자리를 order에 굳힌다', () => {
    expect(ids(moveWithin(START, 2, 0))).toEqual(['c', 'a', 'b']);
    expect(moveWithin(START, 2, 0).map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('경계를 벗어나거나 제자리면 원본을 그대로 돌려준다 — 호출부가 경계 검사를 또 하지 않는다', () => {
    expect(moveWithin(START, 0, -1)).toBe(START);
    expect(moveWithin(START, 2, 3)).toBe(START);
    expect(moveWithin(START, 1, 1)).toBe(START);
  });

  it('연속 이동이 누적된다 — 빠르게 두 번 눌러도 한 칸에서 멈추지 않는다', () => {
    const once = moveWithin(START, 2, 1);
    const twice = moveWithin(once, 1, 0);
    expect(ids(twice)).toEqual(['c', 'a', 'b']);
  });
});

describe('편집기 소스 계약 — 순서를 바꾼 뒤 normalizeOrder로 되돌리지 않는다', () => {
  const src = readFileSync(
    resolve(process.cwd(), '../frontend/src/components/email/EmailVisualEditor.tsx'),
    'utf8',
  );

  /** 함수 본문만 잘라 본다(다음 `const ` 선언 전까지) */
  const bodyOf = (name: string): string => {
    const at = src.indexOf(`const ${name} = `);
    expect(at, `${name} 이 편집기에서 사라졌다`).toBeGreaterThan(-1);
    const next = src.indexOf('\n  const ', at + 10);
    return src.slice(at, next > -1 ? next : at + 1200);
  };

  it('reorder(드래그)는 공용 이동 함수를 쓴다', () => {
    const body = bodyOf('reorder');
    expect(body).toContain('moveWithin(');
    expect(body, '옮긴 뒤 normalizeOrder를 태우면 이동이 취소된다').not.toContain('normalizeOrder(');
  });

  it('duplicateBlock(복제)도 끼워 넣은 자리를 굳힌다', () => {
    const body = bodyOf('duplicateBlock');
    expect(body).toContain('resequence(');
    expect(body).not.toContain('normalizeOrder(');
  });

  it('moveBlock(화살표)은 드래그와 같은 함수를 쓰고 최신 상태에서 인덱스를 구한다', () => {
    const body = bodyOf('moveBlock');
    expect(body, '화살표가 자기 이동 로직을 따로 가지면 다음에 또 한쪽만 고친다').toContain('moveWithin(');
    expect(body, '상태 밖에서 인덱스를 구하면 연속 클릭 때 두 번째가 옛 순서를 본다').toContain('setSections((prev)');
    expect(body).not.toContain('normalizeOrder(');
  });
});
