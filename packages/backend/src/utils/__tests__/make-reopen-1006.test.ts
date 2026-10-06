/**
 * ★ 2026-10-06 재오픈 접수 2건(만들기)
 *   ① 남지현 「넣은 재료 다시 보기 = 링크·이미지 초기화」(이메일도 같음) — 초안이 주소 읽기 결과를 버리고 카드 요약만 남겼다
 *   ② 임은지 「옆으로 넘기기 · 책처럼에 장(쪽) 빼기가 없다」 — 수정 화면에 장 추가만 있고 빼기가 없었다(카탈로그는 사진 쪽 · 3쪽 이상만)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { saveBuildDraft, loadBuildDraft, readSummaryOf, AI_BUILD_DRAFT_KEY, type BuildReadResult } from '../../../../frontend/src/utils/ai-build';

const front = (rel: string) => readFileSync(resolve(__dirname, '../../../../frontend/src', rel), 'utf8').replace(/\r\n/g, '\n');

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const READ: BuildReadResult = {
  readId: 'a'.repeat(32),
  host: 'www.example.invalid',
  mallDomain: false,
  cards: [
    { id: 'c1', title: '에어 포스 1', text: '행사 내용', periodRaw: null, imageUrl: '/api/cdp/inapp/image/co/1.jpg', imageWidth: 800, imageHeight: 600, link: 'https://www.example.invalid/e/1', hash: 'h'.repeat(16) },
    { id: 'c2', title: '에어맥스', text: '행사 내용 2', periodRaw: '10.1~10.10', imageUrl: null, imageWidth: null, imageHeight: null, link: '', hash: 'k'.repeat(16) },
  ],
  images: [{ url: '/api/cdp/inapp/image/co/2.jpg', width: 900, height: 700 }],
  products: [{ name: '상품', url: 'https://www.example.invalid/p/1', imageUrl: '/api/cdp/inapp/image/co/3.jpg', width: 400, height: 400 }],
  logoUrl: '/api/cdp/inapp/image/co/logo.png',
  brandColor: '#112233',
};
const BASE = { channel: 'dm' as const, isAd: true, cards: [], products: [], features: null, catalogImages: [], catalogTitle: '' };

describe('① 넣은 재료 다시 보기 — 주소 읽기 결과와 고른 상태까지 초안에 남고 그대로 돌아온다', () => {
  beforeEach(() => store.clear());

  it('저장 → 복구: 주소 · 읽은 행사 · 사진 · 상품 · 고른 상태가 그대로', () => {
    saveBuildDraft({ ...BASE, pageRead: { address: 'https://www.example.invalid/e', result: READ, offCards: ['c2'], onCards: ['c1'], offImages: ['/api/cdp/inapp/image/co/2.jpg'], offSite: [] } });
    const d = loadBuildDraft();
    expect(d?.pageRead?.address).toBe('https://www.example.invalid/e');
    expect(d?.pageRead?.result).toEqual(READ);
    expect(d?.pageRead?.offCards).toEqual(['c2']);
    expect(d?.pageRead?.onCards).toEqual(['c1']);
    expect(d?.pageRead?.offImages).toEqual(['/api/cdp/inapp/image/co/2.jpg']);
  });

  it('1006 전 저장분(읽은 결과 없음)은 null — 옛 「지난번 읽은 행사」 줄로 그대로 싣는다', () => {
    store.set(AI_BUILD_DRAFT_KEY, JSON.stringify({ ...BASE, cards: [{ id: 'r1', title: 't', text: 'x', link: '', licensed: true, images: [], readId: 'a'.repeat(32), readHash: 'h'.repeat(16) }], savedAt: Date.now() }));
    const d = loadBuildDraft();
    expect(d?.pageRead).toBeNull();
    expect(d?.cards[0].readId).toBe('a'.repeat(32));
  });

  it('깨진 값은 받지 않는다: readId 없음 = null · 지문 없는 카드 · 주소 없는 사진은 걸러진다', () => {
    store.set(AI_BUILD_DRAFT_KEY, JSON.stringify({ ...BASE, pageRead: { address: 'x', result: { ...READ, readId: 5 } }, savedAt: Date.now() }));
    expect(loadBuildDraft()?.pageRead).toBeNull();
    store.set(AI_BUILD_DRAFT_KEY, JSON.stringify({ ...BASE, pageRead: { address: 'x', result: { ...READ, cards: [...READ.cards, { id: 'c3', title: 'no hash' }], images: [...READ.images, { width: 1 }] }, offCards: ['c1', 7] }, savedAt: Date.now() }));
    const d = loadBuildDraft();
    expect(d?.pageRead?.result.cards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(d?.pageRead?.result.images).toHaveLength(1);
    expect(d?.pageRead?.offCards).toEqual(['c1']);
  });

  it('「읽었어요」 요약은 읽은 직후와 다시 열 때 같은 문장', () => {
    expect(readSummaryOf(READ)).toBe('행사 2 · 사진 1 · 로고·색 · 상품 1');
    expect(readSummaryOf({ ...READ, cards: [], images: [], products: [], logoUrl: null, brandColor: null })).toBe('읽을 재료가 적어요. 사진·글을 더 넣어 주세요.');
  });

  it('만들기 화면: 읽은 결과로 주소 칸 · 읽은 재료 카드 · 고른 상태를 되살리고 저장할 때 함께 남긴다', () => {
    const page = front('pages/QuickCampaignPage.tsx');
    expect(page).toContain('const restoredRead = restored?.pageRead || null;');
    expect(page).toContain("useState(restoredRead?.address || '')");
    expect(page).toContain("restoredRead ? { kind: 'done', summary: readSummaryOf(restoredRead.result) } : { kind: 'idle' }");
    expect(page).toContain('useState<BuildReadResult | null>(restoredRead?.result || null)');
    for (const k of ['offCards', 'onCards', 'offImages', 'offSite']) expect(page).toContain(`new Set(restoredRead?.${k})`);
    expect(page).toContain('(restoredRead ? [] : (restored?.cards || []).filter((c) => !!c.readId))');
    expect(page).toContain('const pageRead = read ? { address, result: read, offCards: [...offCards], onCards: [...onCards], offImages: [...offImages], offSite: [...offSite] } : null;');
    expect(page).toContain('catalogImages, catalogTitle, pageRead }), 400);');
    expect(page).toContain("setReadState({ kind: 'done', summary: readSummaryOf(res) });");
    expect(page).not.toContain('interface ReadResult');
  });
});

describe('② 장·쪽 빼기 — 옆으로 넘기기 · 책처럼 두 보기 모두 · 한 곳에서', () => {
  const edit = front('components/make/DmEditScreen.tsx');
  const shell = front('components/make/EditShell.tsx');

  it('빼기는 removePageAt 한 곳: 되돌리기 남김 → 저장소 빼기 · 마지막 1장은 남긴다', () => {
    const fn = edit.slice(edit.indexOf('function removePageAt('), edit.indexOf('function pageRemoveConfirm('));
    expect(fn).toContain('if (idx < 0 || idx >= st.pages.length || st.pages.length <= 1) return;');
    expect(fn).toMatch(/st\.pushHistory\(\);\s*st\.removePage\(idx\);/);
    expect((edit.match(/st\.removePage\(/g) || []).length).toBe(1);
    expect((edit.match(/onConfirm: \(\) => removePageAt\(idx\)/g) || []).length).toBe(1);
  });

  it('옆으로 넘기기: 장이 2개 이상이면 지금 장 빼기', () => {
    const chips = edit.slice(edit.indexOf('function PageChips('), edit.indexOf('// ─────────────────────────────── 오른쪽: 블록 패널'));
    expect(chips).toContain('{pages.length > 1 && (');
    expect(chips).toContain('onClick={() => onRemove(cur)}');
    expect(chips).toContain('data-make="slides-remove-page"');
    expect(edit).toContain('<PageChips onRemove={(i) => setConfirm(pageRemoveConfirm(i, false, s.pages.length))} />');
  });

  it('책처럼: 쪽 목록 줄마다 빼기(사진 없는 쪽도) · 오른쪽 [이 쪽 빼기]도 같은 확인 창', () => {
    expect(edit).toContain('<CatalogLeft onRemove={(i) => setConfirm(pageRemoveConfirm(i, true, s.pages.length))} />');
    expect(edit).toContain('onRemove={pages.length > 1 ? (id) => { const idx = pageIndexOf(id); if (idx >= 0) onRemove(idx); } : undefined}');
    expect(edit).toContain('onClick={() => setConfirm(pageRemoveConfirm(pageNo - 1, true, pages.length))}');
    expect(edit).toContain('{pages.length > 1 && pageNo > 0 && (');
  });

  it('공용 목록은 onRemove 를 줄 때만 빼기 버튼을 그린다(이메일 · 인앱 목록은 그대로)', () => {
    expect(shell).toContain('onRemove={onRemove ? () => onRemove(it.id) : undefined}');
    expect(shell).toContain('{onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}');
    expect(front('components/make/EmailEditScreen.tsx')).not.toContain('onRemove={');
    expect(front('components/inapp/PosterEditor.tsx')).not.toMatch(/<BlockList[\s\S]{0,400}onRemove=/);
  });
});
