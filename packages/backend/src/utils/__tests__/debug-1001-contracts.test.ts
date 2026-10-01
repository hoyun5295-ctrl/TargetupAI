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
  it('재오픈: 머리는 블록 원장(DM_BLOCKS) 시작 묶음 맨 앞 — 블록으로 만들기 첫 화면과 편집기 블록 추가가 같은 출처', () => {
    const blocks = read('utils/dm-blocks.ts');
    const at = blocks.indexOf('export const DM_BLOCKS');
    const first = blocks.indexOf("key: '", at);
    expect(blocks.slice(first, first + 60)).toContain("key: 'header', label: '머리'");
    expect(blocks).toContain("section: 'header',");
    expect(blocks).toContain("ready: (p) => nonEmpty(p?.brand_name) || nonEmpty(p?.logo_url),");
    const flow = read('utils/make-flow.ts');
    expect(flow).toContain("blockItem('header'), blockItem('headline'),");
    expect(flow).not.toContain("{ key: 'header', label: LIST_LABEL.header");
    expect(dmPaletteItems().main[0].section).toBe('header');
  });
  it('[참여 이벤트] 칸이 끝줄에 혼자 남으면 남는 폭을 채운다(3칸·4칸 격자 · 칸 수로 계산)', () => {
    const shell = read('components/make/EditShell.tsx');
    expect(shell).toContain('const span3 = 3 - (items.length % 3);');
    expect(shell).toContain('const span4 = 4 - (items.length % 4);');
    expect(shell).toContain('className={`${interactionSpan} relative h-[66px]');
  });
});

describe('⑦ 재오픈 뒤로가기 — 메뉴 첫 화면 ← = 항상 허브(goUpTo · D177)', () => {
  it('goUpTo = 앞 칸이 부모면 navigate(-1) · 아니면 부모로 · 칸별 화면 기록(PUSH 면 뒤 칸 삭제)', () => {
    const lib = read('lib/scroll-restoration.tsx');
    expect(lib).toContain('export function goUpTo(navigate: NavigateFunction, parent: string): void {');
    expect(lib).toContain('if (prev !== undefined && prev === parentPath) navigate(-1);');
    expect(lib).toContain('else navigate(parent);');
    expect(lib).toContain("if (navType === 'PUSH') for (const k of Object.keys(histPaths)) if (Number(k) > idx) delete histPaths[k];");
    expect(lib).toContain('useEffect(() => { recordPath(currentIdx(), location.pathname, navType); }, [key, location.pathname, navType]);');
  });
  it('머리 부품: 부모가 허브면 goUpTo · 그 밖은 goBackOr', () => {
    expect(read('components/zone/ZoneHeader.tsx')).toContain("const back = onBack ?? (() => (backTo === '/ai-operator' ? goUpTo(navigate, backTo) : goBackOr(navigate, backTo)));");
  });
  it('프론트 어디에도 허브로 가는 goBackOr 가 남지 않는다(자동 마케팅 · 여정 · 푸시 = goUpTo)', () => {
    const left: string[] = [];
    for (const f of walk(FRONT)) {
      const src = readFileSync(f, 'utf8');
      if (/goBackOr\(navigate,\s*['"]\/ai-operator['"]\)/.test(src)) left.push(f.slice(FRONT.length + 1));
    }
    expect(left).toEqual([]);
    for (const rel of ['pages/ContinuousOperatorPage.tsx', 'pages/JourneysPage.tsx', 'pages/PushCampaignsPage.tsx']) {
      expect(read(rel), rel).toContain("goUpTo(navigate, '/ai-operator')");
    }
  });
  it('하위 화면 부모 지정 = AI Batch·질문 → AI 메모리 · 옛 만들기 → DM 목록(허브로 건너뛰지 않게)', () => {
    expect(read('pages/AiBatchesPage.tsx')).toContain('backTo="/ai-memory"');
    expect(read('pages/AiExplainPage.tsx')).toContain('backTo="/ai-memory"');
    expect(read('pages/QuickCampaignLegacyPage.tsx')).toContain('backTo="/dm-builder"');
  });
});

describe('⑧ 이메일 편집기 나가기 — 한 번만 · 보이게 · 실패 시 확인', () => {
  const src = read('components/make/EmailEditScreen.tsx');
  it('저장은 한 번에 하나(앞 저장을 기다림) · 새 메일은 앞 저장이 받은 id 로 수정', () => {
    expect(src).toContain('while (inflight.current) { try { await inflight.current; } catch {');
    expect(src).toContain("const r = await fetch(cid ? `/api/email/campaigns/${cid}` : '/api/email/campaigns'");
    expect(src).toContain('if (!cid && id) { campaignIdRef.current = id; setCampaignId(id); }');
  });
  it('나가기 = 다시 눌러도 한 번 · "저장하고 나가는 중" 표시 · 저장 실패면 닫지 않고 확인 창', () => {
    expect(src).toContain('if (leavingRef.current) return;');
    expect(src).toContain("leaving ? { tone: 'saving', text: '저장하고 나가는 중' }");
    expect(src).toContain('if (id) { onClose(); return; }');
    expect(src).toContain("title: '저장하지 못했어요'");
    expect(src).not.toContain('void persist().then(() => onClose());');
  });
});
