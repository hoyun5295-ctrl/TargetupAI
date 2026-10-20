/**
 * ★ 2026-10-20 서수란 접수 cmvew70kh1 「(모바일DM) 보기 방식 옆으로 넘기기 · 장 칩을 눌러도 미리보기가 그 장으로 안 감」
 *
 * 구조: 「지금 보는 장」을 편집기 store(currentPageIndex)와 미리보기 뷰어(currentIdx)가 따로 들고, 다리는 「블록 선택」만 날랐다.
 *   장 칩 = selectPage(선택 해제) → 다리로 갈 메시지 0. 형제: 미리보기에서 넘겨도 칩이 안 따라옴 · 고칠 때마다 새 문서가 1장부터.
 * 처방 계약(★ Codex 2R 뒤 구조 = 멈췄을 때 맞추기):
 *   편집기 = 움직이는 중인 상태 0 · 장이 바뀌면 앞 칸 · 뒤 칸에 「이 장이어야 한다」(page{id}) · 다리가 알려 온 장으로 따라간다.
 *   다리 = 「있어야 할 장」 하나 + 「그 뒤 사람이 만졌는가」 하나. 넘김이 멈출 때마다 맞춰 본다:
 *     맞으면 아무것도 안 함 · 다르고 사람이 안 만졌으면 다시 민다(늦게 끝난 옛 스크롤 · 넘기는 중 버려진 누름) ·
 *     다르고 사람이 만졌으면(또는 끝내 못 가면) 지금 장을 새 기준으로 삼고 편집기에 알린다.
 *   ⛔ 번호가 아니라 장 id — 슬라이드 모드는 사진 2장 이상인 장을 뷰어에서 여러 장으로 펼친다(dm-slides-expand · `원래id-s번호`).
 * 옛 규약(요청 번호 · 가는 중 창 · 마지막 본 장 · 되돌려 보내기 막기)은 Codex 1R · 2R 에서 순서 경합이 연달아 나와 걷어냈다.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  guardPreviewHtml, readPreviewMessage, storePageIndexOf, viewerPageBelongsTo,
} from '../../../../frontend/src/utils/make-preview';
import { expandSlidePagesForSwipe } from '../dm/dm-slides-expand';

const FE = path.resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('① 뷰어 장 id ↔ 편집기 장', () => {
  it('같은 장 = 그 id 그대로 또는 펼친 장(id-s번호)', () => {
    expect(viewerPageBelongsTo('p1', 'p1')).toBe(true);
    expect(viewerPageBelongsTo('p1-s2', 'p1')).toBe(true);
    expect(viewerPageBelongsTo('p10', 'p1')).toBe(false);
    expect(viewerPageBelongsTo('p1-sx', 'p1')).toBe(false);
    expect(viewerPageBelongsTo('p1-s', 'p1')).toBe(false);
  });
  it('서버 펼침(dm-slides-expand)이 만든 장 id 가 모두 원래 장으로 돌아온다', () => {
    const gallery = { id: 'g1', type: 'gallery', props: { images: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] } };
    const expanded = expandSlidePagesForSwipe([
      { id: 'pa', sections: [gallery] },
      { id: 'pb', sections: [{ id: 't1', type: 'text_card', props: {} }] },
    ]);
    expect(expanded.map((p) => p.id)).toEqual(['pa-s0', 'pa-s1', 'pa-s2', 'pb']);
    expect(expanded.map((p) => storePageIndexOf(['pa', 'pb'], p.id))).toEqual([0, 0, 0, 1]);
    expect(storePageIndexOf(['pa', 'pb'], 'zz')).toBe(-1);
  });
});

describe('② 다리 스크립트를 실제로 돌린다(멈췄을 때 맞추기)', () => {
  const VIEWER = ['pa-s0', 'pa-s1', 'pa-s2', 'pb'];
  const setup = (opts: { active: number; dots?: boolean; stuck?: boolean }) => {
    const out = guardPreviewHtml('<!doctype html><html><head></head><body></body></html>', { tap: true });
    const src = out.slice(out.lastIndexOf('<script>') + '<script>'.length, out.lastIndexOf('</script>'));
    const clicks = VIEWER.map(() => 0);
    let active = opts.active;
    let observerCb: (() => void) | null = null;
    // 점을 누르면 뷰어가 그 장으로 간다(stuck = 책장 넘김 중이라 눌림을 버린다)
    const dots = (opts.dots === false ? [] : VIEWER).map((_, i) => ({
      click: () => { clicks[i]++; if (!opts.stuck) { active = i; observerCb?.(); } },
      classList: { contains: (c: string) => c === 'active' && i === active },
    }));
    const scrolled: number[] = [];
    const pages = VIEWER.map((id, i) => ({
      getAttribute: (k: string) => (k === 'data-page-id' ? id : k === 'data-page-idx' ? String(i) : null),
      scrollIntoView: () => { scrolled.push(i); },
    }));
    const fakeDoc = {
      body: { classList: { contains: () => false } },
      addEventListener: () => {},
      querySelector: (sel: string) => {
        if (sel === '.dm-page-dots') return opts.dots === false ? null : {};
        const m = sel.match(/^\.dm-page\[data-page-idx="(\d+)"\]$/);
        return m ? pages[Number(m[1])] || null : null;
      },
      querySelectorAll: (sel: string) => (sel === '.dm-page-dots .dot' ? dots : sel === '.dm-page[data-page-id]' ? pages : []),
    };
    const posted: any[] = [];
    const parent = { postMessage: (m: any) => { posted.push(m); } };
    const winListeners: Record<string, Array<(e: any) => void>> = {};
    class FakeMO { constructor(cb: () => void) { observerCb = cb; } observe() {} }
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const fakeWin = {
      parent, scrollY: 0, MutationObserver: FakeMO, scrollTo: () => {},
      addEventListener: (t: string, fn: (e: any) => void) => { (winListeners[t] ||= []).push(fn); },
    };
    new Function('window', 'document', 'setTimeout', src)(fakeWin, fakeDoc, (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; });
    // 부모 요청 = 기본 세대 1(편집기의 명시적 선택 세대 · 다리는 보고에 받은 세대를 싣는다)
    const msg = (data: any) => winListeners.message.forEach((fn) => fn({ source: parent, data: { src: 'mk-preview', gen: 1, ...data } }));
    /** 그 지연의 타이머만 한 바퀴(새로 생긴 같은 지연은 다음 바퀴) */
    const run = (ms: number) => { const due = timers.filter((t) => t.ms === ms); for (const t of due) timers.splice(timers.indexOf(t), 1); due.forEach((t) => t.fn()); };
    const pageMsgs = () => posted.filter((m) => m.type === 'page');
    return {
      clicks, scrolled, pageMsgs, msg, run,
      human: (t: string) => (winListeners[t] || []).forEach((fn) => fn({})),
      setActive: (i: number) => { active = i; observerCb?.(); },
    };
  };

  it('page{id} = 그 장의 첫 장 점을 누른다 · 도착은 알리지 않는다(편집기는 이미 그 장)', () => {
    const t = setup({ active: 0 });
    t.msg({ type: 'page', id: 'pb' });
    expect(t.clicks).toEqual([0, 0, 0, 1]);
    t.run(250);
    t.run(700);
    expect(t.pageMsgs()).toEqual([]);
    expect(t.clicks).toEqual([0, 0, 0, 1]);
  });
  it('이미 그 장(펼친 장 안)이면 = 움직이지 않는다', () => {
    const t = setup({ active: 1 });
    t.msg({ type: 'page', id: 'pa' });
    t.run(700);
    expect(t.clicks).toEqual([0, 0, 0, 0]);
    expect(t.pageMsgs()).toEqual([]);
  });
  it('Codex 2R ③ 늦게 끝난 옛 이동이 다른 장에 멈추면 = 사람이 안 만졌으니 지금 있어야 할 장으로 다시 민다', () => {
    const t = setup({ active: 0, stuck: true });
    t.msg({ type: 'page', id: 'pb' });      // 옛 요청(이동 시작)
    t.msg({ type: 'page', id: 'pa' });      // 새 요청 = 지금 장(그대로)
    t.setActive(3);                          // 옛 스크롤이 pb 에 도착
    t.run(250);
    expect(t.clicks[0]).toBe(1);             // pa 로 다시 민다
    expect(t.pageMsgs()).toEqual([]);        // 편집기 선택(pa)을 덮지 않는다
  });
  it('Codex 1R ③ 새 요청이 옛 요청의 다시 누르기를 대신한다(최신 하나만)', () => {
    const t = setup({ active: 0, stuck: true });
    t.msg({ type: 'page', id: 'pb' });
    t.msg({ type: 'page', id: 'pa-s2' });
    t.run(700);
    expect(t.clicks).toEqual([0, 0, 2, 1]);
  });
  it('Codex 2R ① 넘기는 중 버려진 누름 + 사람 입력(장은 그대로) = 지금 장을 새 기준으로 알린다', () => {
    const t = setup({ active: 0, stuck: true });
    t.msg({ type: 'page', id: 'pb' });
    t.human('wheel');
    t.run(700);
    expect(t.pageMsgs()).toEqual([{ type: 'page', id: 'pa-s0', gen: 1, src: 'mk-preview' }]);
    t.run(700);
    expect(t.clicks).toEqual([0, 0, 0, 1]);  // 더 밀지 않는다
  });
  it('사람이 다른 장으로 넘기면 = 그 장을 알리고 되돌리지 않는다 · 같은 편집기 장 안(펼친 장)은 알리지 않는다', () => {
    const t = setup({ active: 0 });
    t.msg({ type: 'page', id: 'pa' });
    t.human('touchstart');
    t.setActive(2);                           // 같은 편집기 장(pa) 안
    t.run(250);
    expect(t.pageMsgs()).toEqual([]);
    t.setActive(3);                           // 다른 장(pb)
    t.run(250);
    expect(t.pageMsgs()).toEqual([{ type: 'page', id: 'pb', gen: 1, src: 'mk-preview' }]);
    t.run(700);
    expect(t.clicks).toEqual([0, 0, 0, 0]);
  });
  it('Codex 3R ① 도착한 뒤에는 옛 다시 밀기 예약이 살아남지 않는다(다음 사람 스크롤 중간 장을 붙잡지 않는다)', () => {
    const t = setup({ active: 0 });
    t.msg({ type: 'page', id: 'pb' });       // 민다(0.7초 예약) → 바로 도착(점 바뀜 → 0.25초 예약이 옛 예약을 무효)
    t.run(250);                               // 도착 확인
    t.human('mousedown');                     // 사람이 먼 장을 눌러 스크롤 시작
    t.setActive(2);                           // 중간 장(pa-s2)이 잠깐 보임 · 아직 멈추지 않음
    t.run(700);                               // 옛 다시 밀기 예약 = 아무것도 안 한다
    expect(t.pageMsgs()).toEqual([]);
    expect(t.clicks).toEqual([0, 0, 0, 1]);
  });
  it('Codex 3R ② 보고에는 받은 마지막 세대를 싣는다(부모가 지난 세대 보고를 버린다)', () => {
    const t = setup({ active: 0 });
    t.msg({ type: 'page', id: 'pa', gen: 7 });
    t.human('touchstart');
    t.setActive(3);
    t.run(250);
    expect(t.pageMsgs()).toEqual([{ type: 'page', id: 'pb', gen: 7, src: 'mk-preview' }]);
  });
  it('끝내 못 가면(넘김이 계속 막힘) = 네 번 민 뒤 지금 장을 새 기준으로 알린다(어긋난 채 남지 않는다)', () => {
    const t = setup({ active: 0, stuck: true });
    t.msg({ type: 'page', id: 'pb' });
    for (let i = 0; i < 6; i++) t.run(700);
    expect(t.clicks).toEqual([0, 0, 0, 4]);
    expect(t.pageMsgs()).toEqual([{ type: 'page', id: 'pa-s0', gen: 1, src: 'mk-preview' }]);
  });
  it('이 문서에 없는 장 = 누르지도 알리지도 않는다(새 문서가 오면 다시 받는다)', () => {
    const t = setup({ active: 0 });
    t.msg({ type: 'page', id: 'zz' });
    t.run(700);
    expect(t.clicks).toEqual([0, 0, 0, 0]);
    expect(t.pageMsgs()).toEqual([]);
  });
  it('점이 없으면(옛 문서) 그 장 요소로 스크롤', () => {
    const t = setup({ active: 0, dots: false });
    t.msg({ type: 'page', id: 'pb' });
    expect(t.scrolled).toEqual([3]);
  });
});

describe('③ 부모 쪽 메시지 읽기 · 배선', () => {
  it('readPreviewMessage = page{id 글자 · gen 숫자}만 받는다', () => {
    const frame = { contentWindow: {} } as any;
    const ev = (data: any) => ({ source: frame.contentWindow, data: { src: 'mk-preview', ...data } }) as any;
    expect(readPreviewMessage(ev({ type: 'page', id: 'pa-s1', gen: 2 }), frame)).toEqual({ src: 'mk-preview', type: 'page', id: 'pa-s1', gen: 2 });
    expect(readPreviewMessage(ev({ type: 'page', id: 3, gen: 2 }), frame)).toBeNull();
    expect(readPreviewMessage(ev({ type: 'page', id: 'pa' }), frame)).toBeNull();
  });
  it('DM 편집 = store 장 id 를 내려보내고 · 보고를 store 장으로 되돌리며 · 바꿨는지를 돌려준다', () => {
    const src = read('components/make/DmEditScreen.tsx');
    expect(src).toMatch(/pageId=\{isSlides \? \(s\.pages\[s\.currentPageIndex\]\?\.id \?\? null\) : null\}/);
    expect(src).toContain('storePageIndexOf(');
    expect(src).toMatch(/finally \{ followingRef\.current = false; \}\s*return true;/);
  });
  it('Codex 4R 사람이 직접 고른 동작(장 칩 · 쪽 목록 · 블록 선택 · 미리보기 탭)마다 고름 번호 = 같은 장을 다시 골라도 새 선택', () => {
    const src = read('components/make/DmEditScreen.tsx');
    expect(src).toContain('pageRev={pageRev}');
    // ★ Codex 5R 고름 번호는 고른 그 순간 올린다(공유 값 · 렌더를 기다리지 않음) — 미리보기 틀의 세대 판정이 이 값을 바로 읽는다
    expect(src).toMatch(/const bumpPageRev = useCallback\(\(\) => \{ pickRef\.current \+= 1; setPageRev\(pickRef\.current\); \}, \[\]\);/);
    expect(src).toContain('pagePick={pickRef}');
    // ★ Codex 6R 편집기에서 시작한 장 바뀜은 어디서 왔든(장 빼기 · 되돌리기 포함) 그 순간 세대를 올린다 — 미리보기를 따라간 바뀜만 뺀다
    expect(src).toMatch(/useDmBuilderStore\.subscribe\(\(st, prev\) => \{/);
    expect(src).toMatch(/if \(cur !== was && !followingRef\.current\) pickRef\.current \+= 1;/);
    expect(src).toMatch(/followingRef\.current = true;\s*try \{ st\.selectPage\(idx\); \} finally \{ followingRef\.current = false; \}/);
    // 블록 선택(목록 · 미리보기 탭) = focus 가 번호를 올린다
    const focusAt = src.indexOf('const focus = useCallback(');
    expect(src.slice(focusAt, focusAt + 500)).toContain('bumpPageRev();');
    // 장 칩 · 쪽 목록 = 고르면 번호를 올린다
    expect(src).toMatch(/<PageChips onRemove=\{[^}]*\} onPicked=\{bumpPageRev\} \/>/);
    expect(src).toMatch(/<CatalogLeft onRemove=\{[^}]*\} onPicked=\{bumpPageRev\} \/>/);
    // 쪽 목록 고르기(select)도 번호를 올린다
    const selAt = src.indexOf('  const select = (id: string) => {');
    expect(src.slice(selAt, src.indexOf('};', selAt))).toContain('onPicked();');
    expect(src).toMatch(/onClick=\{\(\) => \{ selectPage\(i\); onPicked\(\); \}\}/);
    const frame = read('components/make/PreviewFrame.tsx');
    expect(frame).toMatch(/\}, \[pageId, pageRev\]\);/);
    expect(frame).toMatch(/const picked = pageRev !== lastRevRef\.current;/);
    expect(frame).toMatch(/if \(!picked && follow && viewerPageBelongsTo\(follow, pageId\)\)/);
  });
  it('미리보기 틀 = 편집기의 새 선택만 세대를 올려 앞 · 뒤 칸에 · 뷰어를 따라간 것은 뒤 칸만 · 지난 세대 보고는 버린다', () => {
    const pair = read('components/make/PreviewPair.tsx');
    expect(pair).toMatch(/pageId=\{pageId\}/);
    expect(pair).toMatch(/onPage=\{onPage\}/);
    const frame = read('components/make/PreviewFrame.tsx');
    const ready = frame.slice(frame.indexOf("if (m.type === 'ready')"), frame.indexOf("if (m.type === 'loaded')"));
    expect(ready).toContain('sendPage(frame);');
    expect(frame).toContain('if (m.gen !== curGen()) return;');
    expect(frame).toMatch(/if \(!picked && follow && viewerPageBelongsTo\(follow, pageId\)\) \{ sendPage\(backFrame\); return; \}/);
    expect(frame).toMatch(/sendPage\(frames\.current\[frontRef\.current\.key\] \?\? null, backFrame\);/);
    expect(frame).toMatch(/postToPreview\(t, \{ type: 'page', id, gen: curGen\(\) \}\)/);
    expect(frame).not.toMatch(/pageSeqRef|echoRef|acceptPageReport|wantRef|lastSeenRef|PAGE_SETTLE_MS|genRef/);
  });
});
