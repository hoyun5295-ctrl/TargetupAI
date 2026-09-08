/**
 * email-round-cell-contract.test.ts — 둥근 모서리 셀 계약 (2026-09-08)
 *
 * 경위: 남지현 접수 `cmtqtw3m00a07jnotpv8cfrcu` "CTA 버튼 가이드 라인 표시".
 *   문서 전역 `table{border-collapse:collapse}`(아웃룩 셀 간격 방지) 아래에서는
 *   셀(td)의 `border-radius`가 **테두리에 적용되지 않는다**. 배경만 둥글게 남고
 *   테두리는 직각으로 그려져 둥근 버튼 바깥에 사각 선이 하나 더 생긴다.
 *   접수는 CTA 하나로 왔지만 같은 마크업이 상품 카드·리뷰·매장 정보·쿠폰·framed 텍스트에도 있었다.
 *
 * 계약: `border`와 `border-radius`를 함께 쓰는 td의 부모 table은
 *   `border-collapse:separate`(+`border-spacing:0`)를 인라인으로 가져야 한다.
 *   섹션이 늘어도 이 테스트가 자동으로 새 자리를 잡는다(원장에 섹션을 골라 넣지 않는다).
 *
 * ⛔ 전역 규칙(`table{border-collapse:collapse}`)은 건드리지 않는다 — 이 문서 밖의 표
 *   (청구서·정산 메일 등)까지 셀 간격이 함께 바뀐다. 그래서 "덮는 쪽"도 함께 고정한다
 *   (속성 파리티는 싣는 쪽과 덮는 쪽을 같이 봐야 한다 = 2026-08-28 히어로 높이 교훈).
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { ALL_SECTIONS, BACKGROUNDS } from './email-all-sections.fixture';
import type { Section } from '../../dm/dm-section-registry';

/** 태그에서 style 속성 값만 꺼낸다. 태그 문자열째로 검사하면 선언 경계(`;`)를 못 봐서
 *  style 맨 앞에 오는 `border:`(framed 구도가 그렇다)를 통째로 놓친다. */
const styleOf = (tag: string): string => tag.match(/style\s*=\s*"([^"]*)"/i)?.[1] || '';

/** 실제 border 선언인지(테두리 선을 그리는지) — border-radius·border-spacing·border-collapse는 제외. */
const hasRealBorder = (tag: string): boolean => {
  const style = styleOf(tag);
  return /(^|;)\s*border(-top|-bottom|-left|-right)?\s*:/i.test(style) && !/(^|;)\s*border\s*:\s*(0|none)/i.test(style);
};

/** border-radius를 가진 td를 태그 스택으로 훑어 부모 table 여는 태그와 짝지어 돌려준다. */
function roundCells(html: string): Array<{ td: string; table: string }> {
  const found: Array<{ td: string; table: string }> = [];
  const stack: string[] = [];
  const re = /<(\/?)(table|td)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'table') {
      if (closing) stack.pop();
      else stack.push(m[0]);
    } else if (tag === 'td' && !closing && /border-radius/i.test(m[3])) {
      found.push({ td: m[0], table: stack[stack.length - 1] || '(부모 table 없음)' });
    }
  }
  return found;
}

describe('둥근 모서리 셀 — 사각 테두리 계약', () => {
  it('전 블록·전 구도: border + border-radius 셀의 부모 table은 border-collapse:separate', () => {
    const html = renderEmailSections(ALL_SECTIONS, {});
    const cells = roundCells(html);
    expect(cells.length).toBeGreaterThan(0);   // 표본 0이면 계약이 아무것도 안 지킨다
    const violations = cells
      .filter((c) => hasRealBorder(c.td))
      .filter((c) => !/border-collapse\s*:\s*separate/i.test(c.table))
      .map((c) => `td=${c.td.slice(0, 160)}\n  parent=${c.table.slice(0, 160)}`);
    expect(violations).toEqual([]);
  });

  it('배경면 5종에서도 같은 계약', () => {
    for (const bg of BACKGROUNDS) {
      const html = renderEmailSections(ALL_SECTIONS.map((s) => ({ ...s, background: bg }) as Section), {});
      const violations = roundCells(html)
        .filter((c) => hasRealBorder(c.td))
        .filter((c) => !/border-collapse\s*:\s*separate/i.test(c.table))
        .map((c) => `[bg=${bg}] td=${c.td.slice(0, 160)}`);
      expect(violations).toEqual([]);
    }
  });

  it('separate로 바꾼 표는 border-spacing:0을 함께 싣는다 (기본 2px 간격 방지)', () => {
    const html = renderEmailSections(ALL_SECTIONS, {});
    const bad = roundCells(html)
      .filter((c) => /border-collapse\s*:\s*separate/i.test(c.table))
      .filter((c) => !/border-spacing\s*:\s*0/i.test(c.table))
      .map((c) => c.table.slice(0, 160));
    expect(bad).toEqual([]);
  });

  it('덮는 쪽 고정 — 문서 전역 규칙은 여전히 border-collapse:collapse', () => {
    // 이 줄이 사라지면 위 계약의 전제(전역이 셀 radius를 죽인다)가 바뀐다.
    // 전역을 separate로 돌리는 처방은 이 문서 밖 표까지 건드리므로 택하지 않았다.
    const html = renderEmailSections(ALL_SECTIONS, {});
    expect(html).toContain('table{border-collapse:collapse}');
  });

  it('탐지기 자체 검증 — 계약을 어긴 마크업을 실제로 잡아낸다', () => {
    // 정규식이 죽으면(제어문자·오타) 위 테스트들이 조용히 전부 통과한다. 그 상태를 여기서 막는다.
    const broken = '<table role="presentation"><tr><td style="border:1px solid #000;border-radius:14px">x</td></tr></table>';
    const cells = roundCells(broken);
    expect(cells.length).toBe(1);
    expect(hasRealBorder(cells[0].td)).toBe(true);
    expect(/border-collapse\s*:\s*separate/i.test(cells[0].table)).toBe(false);
  });
});
