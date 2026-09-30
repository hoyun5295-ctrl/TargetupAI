/**
 * ★ 2026-10-01 오류 접수 계약 — 알림톡 템플릿 버튼명 칸 · 모바일 DM(카탈로그 미리보기 · 블록으로 만들기 · 머리 블록)
 *
 *   ① 공용 입력 스타일(CUI_INPUT·CUI_SELECT = w-full) 위에 `!` 없는 폭을 덧붙이지 않는다 — 빌드 CSS 순서상 w-full 이 이겨
 *      옆 칸이 0 폭으로 눌렸다(버튼명 칸 26px → 한글이 거꾸로 쌓이고 띄어쓰기·지우기 안 됨 · 박성용 cmunc1yb5)
 *   ② 장 넘김 효과(책장 넘김·페이드) DM 은 쪽 가시성 추적을 걸지 않는다 — 겹친 장이라 책장 넘김이 2쪽에서 멈췄다(cmunux3e4).
 *      효과 없는 DM 은 그대로 건다(발행 HTML 무변경)
 *   ③ 미리보기 다리: 효과 DM 에서 목록으로 고른 장 = 그 장의 점을 눌러 뷰어 장 이동을 탄다(scrollIntoView 는 겹친 장에서 무효)
 *   ④ 미리보기 틀 바깥 칸 = clip(스크롤 칸 아님) — hidden 이면 코드로 59px 밀려 쪽이 왼쪽으로 치우쳤다(cmunux3e4)
 *   ⑤ 새 DM 입구는 모두 제목을 준다 · 조립 화면도 저장 알림을 그린다(제목 없으면 POST /dm 400 → 저장·미리보기 멈춤 · 임은지 cmunneeeb·cmunern60)
 *   ⑥ DM 블록 추가에 머리(로고 · 브랜드 이름)가 있다 — 이메일과 같다(남지현 cmungizf9)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { guardPreviewHtml } from '../../../../frontend/src/utils/make-preview';
import { dmPaletteItems, emailPaletteItems } from '../../../../frontend/src/utils/make-flow';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(resolve(FRONT, rel), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('① 공용 입력 스타일 위 폭 덧붙임', () => {
  it('CUI_INPUT·CUI_SELECT 뒤에 `!` 없는 폭(w-숫자 · w-auto · w-[..] 등) 0건', () => {
    const bad: string[] = [];
    const re = /\$\{(CUI_INPUT|CUI_SELECT)\}[^`]*?(?<![!:\w-])(w-auto|w-fit|w-min|w-max|w-\d+|w-\[[^\]]+\])/g;
    for (const f of walk(FRONT)) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) bad.push(`${f.slice(FRONT.length + 1)} :: ${m[0].slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });
  it('접수 자리 = 선택 칸 폭 고정(버튼 · 아이템 제목 · RCS 버튼)', () => {
    expect(read('components/alimtalk/ButtonEditor.tsx')).toContain('${CUI_INPUT} h-8 text-[13px] !w-24 shrink-0');
    expect(read('components/alimtalk/ItemListEditor.tsx')).toContain('${CUI_INPUT} h-8 text-[13px] !w-28 shrink-0');
    expect(read('components/RcsTemplateFormModal.tsx')).toContain('${CUI_SELECT} h-8 !w-auto min-w-[120px] shrink-0');
  });
});

const page = (i: number) => ({
  id: 'p' + i,
  sections: [{ id: 's' + i, type: 'gallery', order: 0, visible: true, props: { images: [{ url: '/api/dm/v/images/c1/p' + i + '.jpg' }], layout: 'list_1xN', full_bleed: true } }],
});
const dmWith = (layout_mode: string, settings: any) => ({
  id: 'd1', title: '카탈로그', short_code: 'abc123', layout_mode, pages: [page(1), page(2), page(3)], sections: [], brand_kit: null, settings,
});

describe('② 효과 DM 쪽 추적', () => {
  it('책장 넘김·페이드 = 쪽 가시성 추적을 걸지 않는다(현재 장은 fxGo 가 소유)', () => {
    for (const effect of ['flip', 'fade']) {
      const html = renderDmViewerHtml(dmWith('slides', { catalog: true, effect }), '/api/dm/v');
      expect(html, effect).toContain('function fxGo');
      expect(html, effect).not.toContain('pageObserver');
      // 섹션 뷰 집계는 그대로
      expect(html, effect).toContain('sectionObserver');
    }
  });
  it('효과 없는 DM(밀어내기 · 세로 스크롤) = 종전대로 건다', () => {
    for (const [mode, settings] of [['slides', { catalog: true }], ['slides', { effect: 'slide' }], ['scroll', {}]] as const) {
      const html = renderDmViewerHtml(dmWith(mode, settings), '/api/dm/v');
      expect(html, mode).toContain('var pageObserver = new IntersectionObserver');
      expect(html, mode).toContain('pageEls.forEach(function(el){ pageObserver.observe(el); });');
    }
  });
});

describe('③ 미리보기 다리 — 효과 DM 에서 고른 장으로', () => {
  const DOC = '<!doctype html><html><head></head><body><div data-section-id="s2">a</div></body></html>';
  const run = (fx: boolean) => {
    const out = guardPreviewHtml(DOC, { tap: true });
    const src = out.slice(out.lastIndexOf('<script>') + '<script>'.length, out.lastIndexOf('</script>'));
    let scrolled = 0;
    const clicks = [0, 0, 0];
    const pageEl = { getAttribute: (k: string) => (k === 'data-page-idx' ? '1' : null) };
    const section = {
      style: {} as Record<string, string>, getAttribute: () => 's2', getBoundingClientRect: () => ({ top: 0, height: 10 }),
      closest: (s: string) => (s === '.dm-page' ? pageEl : null), scrollIntoView: () => { scrolled++; },
    };
    const dots = clicks.map((_, i) => ({ click: () => { clicks[i]++; } }));
    const fakeDoc = {
      body: { classList: { contains: (c: string) => fx && c === 'dm-fx' } },
      addEventListener: () => {},
      querySelector: (sel: string) => (sel === '[data-section-id="s2"]' ? section : null),
      querySelectorAll: (sel: string) => (sel === '.dm-page-dots .dot' ? dots : [section]),
    };
    const winListeners: Record<string, (e: any) => void> = {};
    const parent = { postMessage: () => {} };
    const fakeWin = { parent, scrollY: 0, addEventListener: (t: string, fn: (e: any) => void) => { winListeners[t] = fn; }, scrollTo: () => {} };
    new Function('window', 'document', 'setTimeout', src)(fakeWin, fakeDoc, () => 0);
    winListeners.message({ source: parent, data: { src: 'mk-preview', type: 'select', id: 's2', reveal: true } });
    return { scrolled, clicks };
  };
  it('효과 DM = 그 장(data-page-idx)의 점을 누른다 · 스크롤 0', () => {
    expect(run(true)).toEqual({ scrolled: 0, clicks: [0, 1, 0] });
  });
  it('효과 없는 DM = 종전대로 scrollIntoView · 점 0', () => {
    expect(run(false)).toEqual({ scrolled: 1, clicks: [0, 0, 0] });
  });
});

describe('④ 미리보기 틀 바깥 칸', () => {
  it('바깥 칸 = mk-preview-box(hidden 다음 clip) · 인라인 overflow hidden 0', () => {
    const frame = read('components/make/PreviewFrame.tsx');
    expect(frame).toContain('className="mk-preview-box"');
    expect(frame).not.toMatch(/overflow:\s*'hidden'/);
    expect(frame).toContain("import '../../styles/make.css';");
    expect(read('styles/make.css')).toMatch(/\.mk-preview-box\s*\{\s*overflow:\s*hidden;\s*overflow:\s*clip;\s*\}/);
  });
});

describe('⑤ 새 DM 입구 제목 · 조립 화면 알림', () => {
  const page = read('pages/DmBuilderPage.tsx');
  it('DM 화면의 createNew 는 모두 제목을 준다(제목 없으면 POST /dm 400)', () => {
    const calls = [...page.matchAll(/createNew\(\{[^}]*\}\)/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(9);
    expect(calls.filter((c) => !/title:/.test(c))).toEqual([]);
  });
  it('조립 화면(mode === build)도 저장 알림을 그린다', () => {
    const at = page.indexOf("if (mode === 'build') {");
    const block = page.slice(at, page.indexOf("if (mode === 'edit') {", at));
    expect(block).toContain('<DmBlockBuilder');
    expect(block).toContain('{toast && <Toast toast={toast} />}');
  });
});

describe('⑥ DM 블록 추가 = 머리 포함(이메일과 같다)', () => {
  it('DM 팔레트에 머리(header) · 이메일 팔레트와 같은 이름', () => {
    const dmHead = dmPaletteItems().main.find((i) => i.section === 'header');
    const emHead = emailPaletteItems().find((i) => i.section === 'header');
    expect(dmHead).toBeTruthy();
    expect(dmHead!.label).toBe(emHead!.label);
    expect(dmHead!.label).toBe('머리');
  });
  it('[참여 이벤트] 칸이 끝줄에 혼자 남으면 남는 폭을 채운다(3칸·4칸 격자 · 칸 수로 계산)', () => {
    const shell = read('components/make/EditShell.tsx');
    expect(shell).toContain('const span3 = 3 - (items.length % 3);');
    expect(shell).toContain('const span4 = 4 - (items.length % 4);');
    expect(shell).toContain('className={`${interactionSpan} relative h-[66px]');
  });
});
