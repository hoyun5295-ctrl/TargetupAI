/**
 * 탭 카드 = 편집 캔버스 · 발행 렌더 · 발행 뷰어 클릭, 세 곳이 같은 알약 규칙 (★2026-09-10 임은지 접수 cmtth8w0x0c7pjnotfj7ho1pp)
 *
 * 기원
 *   07-02에 발행 렌더를 밑줄 탭 → 알약 탭으로, 07-23에 활성 탭 배경·글씨색 지정으로 바꿨는데
 *   발행 뷰어의 클릭 처리만 옛 밑줄 방식(밑줄 + 브랜드 기본색 글씨 · 배경은 손대지 않음)으로 남았다.
 *   단말에서 3번째 탭을 누르면 검정 배경은 1번째 탭에 남고, 누른 탭은 회색 바탕에 흰 글씨가 됐다.
 *   07-22 미러 검사는 "편집 캔버스 = 발행 렌더"만 봤고 "뷰어 클릭 = 발행 렌더"는 아무도 안 봤다.
 *
 * 못 박는 것 (재발 방지)
 *   1. 실제로 내보내는 뷰어 스크립트를 가짜 버튼으로 클릭 실행한 결과 = 그 탭을 기본으로 둔 발행 렌더.
 *   2. 활성·비활성 색은 상수 한 벌(DM_TAB_PILL)이고 발행 렌더·뷰어가 같은 값을 쓴다. 편집 캔버스도 같은 값.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSection, DM_TAB_PILL } from './dm-section-renderer';
import { renderDmViewerHtml } from './dm-viewer';
import type { Section } from './dm-section-registry';

function mk(type: string, props: any): Section {
  return { id: 's1', type, order: 0, visible: true, props } as Section;
}

const TABS = [{ label: 'FOUNDATION', content: 'a' }, { label: 'LIP', content: 'b' }, { label: 'EYE', content: 'c' }];
const CUSTOM = { tabs: TABS, tab_active_bg: '#000000', tab_active_text_color: '#ffffff' };

/** 발행 탭 버튼의 인라인 배경·글씨색(순서대로) */
function ssrButtonColors(html: string): Array<{ bg: string; fg: string }> {
  return [...html.matchAll(/<span data-dm-tab="\d+" style="([^"]*)"/g)].map((m) => ({
    bg: (m[1].match(/background:([^;]+);/) || [])[1] || '',
    fg: (m[1].match(/(?:^|;)color:([^;]+);/) || [])[1] || '',
  }));
}

/** 탭 묶음 요소의 data 속성(뷰어가 읽는 값) */
function boxAttrs(html: string): Record<string, string> {
  const open = (html.match(/<div class="dm-section dm-tab-cards"[^>]*>/) || [''])[0];
  const out: Record<string, string> = {};
  for (const m of open.matchAll(/(data-dm-tab-[a-z-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/**
 * 뷰어 HTML 속 탭 전환 블록만 떼어 가짜 버튼으로 실행한다(내보내는 문자열 그대로 · DOM 라이브러리 0).
 * 초기 스타일은 발행 렌더가 그린 값으로 채운다 = 단말에서 처음 보는 상태.
 */
function clickTab(viewerHtml: string, index: number) {
  const a = viewerHtml.indexOf('/* dm-tab-switch:begin */');
  const b = viewerHtml.indexOf('/* dm-tab-switch:end */');
  expect(a, '뷰어에 탭 전환 블록 표식이 없다').toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const code = viewerHtml.slice(a, b);
  const initial = ssrButtonColors(viewerHtml);
  const attrs = boxAttrs(viewerHtml);
  const mkEl = (key: string, i: number, style: Record<string, string>) => {
    const listeners: Array<() => void> = [];
    return {
      style: { ...style } as Record<string, string>,
      listeners,
      getAttribute: (k: string) => (k === key ? String(i) : null),
      addEventListener: (_t: string, f: () => void) => { listeners.push(f); },
    };
  };
  const btns = initial.map((c, i) => mkEl('data-dm-tab', i, { background: c.bg, color: c.fg }));
  const panels = initial.map((_, i) => mkEl('data-dm-tab-panel', i, { display: i === 0 ? 'block' : 'none' }));
  const box = {
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    querySelectorAll: (sel: string) => (sel === '[data-dm-tab]' ? btns : sel === '[data-dm-tab-panel]' ? panels : []),
  };
  const fakeDocument = { querySelectorAll: (sel: string) => (sel === '[data-dm-tabs]' ? [box] : []) };
  new Function('document', code)(fakeDocument);
  btns[index].listeners.forEach((f) => f());
  return { btns, panels };
}

const viewer = (props: any) => renderDmViewerHtml({ short_code: 'tabtest', title: 'T', sections: [mk('tab_cards', props)] }, '/api/dm/v');

describe('탭 카드 — 뷰어 클릭 결과 = 그 탭을 기본으로 둔 발행 렌더', () => {
  it('지정 색(검정 배경·흰 글씨): 3번째를 누르면 검정이 3번째로 옮겨 가고 1번째는 비활성으로 돌아온다', () => {
    const { btns, panels } = clickTab(viewer(CUSTOM), 2);
    const expected = ssrButtonColors(renderSection(mk('tab_cards', { ...CUSTOM, default_tab_index: 2 }), {} as any));
    expect(btns.map((b) => ({ bg: b.style.background, fg: b.style.color }))).toEqual(expected);
    expect(btns[2].style.background).toBe('#000000');
    expect(btns[0].style.background, '1번째 탭에 검정 배경이 남는다(접수 증상)').toBe(DM_TAB_PILL.offBg);
    expect(panels.map((p) => p.style.display)).toEqual(['none', 'none', 'block']);
    for (const b of btns) expect(b.style.borderBottom, '옛 밑줄 방식이 되살아났다').toBeUndefined();
  });

  it('색 미지정(기본 검정 계열): 누른 탭이 기본 활성색을 받는다', () => {
    const { btns } = clickTab(viewer({ tabs: TABS }), 1);
    const expected = ssrButtonColors(renderSection(mk('tab_cards', { tabs: TABS, default_tab_index: 1 }), {} as any));
    expect(btns.map((b) => ({ bg: b.style.background, fg: b.style.color }))).toEqual(expected);
    expect(btns[1].style.background).toBe(DM_TAB_PILL.onBg);
  });

  it('처음 탭을 다시 눌러도 발행 초기 모습 그대로다', () => {
    const html = viewer(CUSTOM);
    const { btns } = clickTab(html, 0);
    expect(btns.map((b) => ({ bg: b.style.background, fg: b.style.color }))).toEqual(ssrButtonColors(html));
  });
});

describe('탭 카드 — 활성·비활성 색은 한 벌이다(발행 렌더 · 뷰어 · 편집 캔버스)', () => {
  it('발행 렌더가 탭 묶음에 그 섹션의 활성 색을 싣는다(뷰어가 읽는 값)', () => {
    const attrs = boxAttrs(renderSection(mk('tab_cards', CUSTOM), {} as any));
    expect(attrs['data-dm-tab-on-bg']).toBe('#000000');
    expect(attrs['data-dm-tab-on-fg']).toBe('#ffffff');
    const plain = boxAttrs(renderSection(mk('tab_cards', { tabs: TABS }), {} as any));
    expect(plain['data-dm-tab-on-bg']).toBe(DM_TAB_PILL.onBg);
    expect(plain['data-dm-tab-on-fg']).toBe(DM_TAB_PILL.onFg);
  });

  it('편집 캔버스도 같은 값을 쓴다(편집 = 단말)', () => {
    const src = readFileSync(resolve(process.cwd(), '../frontend/src/components/dm/canvas/NewSections.tsx'), 'utf8');
    const a = src.indexOf('export function TabCardsSection');
    const tab = src.slice(a, src.indexOf('export function', a + 10));
    for (const v of [DM_TAB_PILL.onBg, DM_TAB_PILL.onFg, DM_TAB_PILL.offBg, DM_TAB_PILL.offFg]) {
      expect(tab, `캔버스 탭에 ${v}가 없다 = 편집과 단말 색이 갈린다`).toContain(`'${v}'`);
    }
  });
});
