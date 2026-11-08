import { describe, it, expect, beforeEach } from 'vitest';
import { buildPosterFrame, POSTER_FRAME_RULES as R } from '../poster-frame';

/**
 * ★ 2026-11-08 C118 T8 · T10 SDK 틀(설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md §4)
 *   T8 = 정지 full(스튜디오 인앱용 그림 굽기) = 모서리 0 · 그림자 0 · 쪽 번호 0 · 정지 아님 = 그대로
 *   T10 = 쪽 번호 = 사진 위 글 있으면 위 · 없으면 아래 · 여러 장 칸 비율 = 첫 그림 비율 3:4 ~ 4:3 묶음 · 높이 상한(화면 72%)이 늘 이긴다
 */
const IMG = (n: string) => `/api/cdp/inapp/image/00000000-0000-0000-0000-000000000000/${n}.jpg`;
const withText = [
  { image_url: IMG('a'), title: '첫 장 제목', body: '아래쪽 글', cta: { label: '보러 가기', action_url: '/e/1' } },
  { image_url: IMG('b'), title: '둘째 장', cta: { label: '둘째', action_url: '/e/2' } },
];
const noText = [{ image_url: IMG('a') }, { image_url: IMG('b') }];
const base = (slides: any[], design: Record<string, any>, vh = 844) => ({ slides, design, now: Date.parse('2026-11-08T00:00:00Z'), endAt: null, mount: 'frame' as const, viewportHeight: vh });
const sheetOf = (root: ParentNode, card = false) => root.querySelector(`[data-hjl-part="${card ? 'card' : 'sheet'}"]`) as HTMLElement;
/** jsdom 은 그림을 받지 않는다 → 원본 크기를 정하고 load 를 쏜다(실제 브라우저의 들어옴과 같은 길) */
const loadAs = (img: HTMLImageElement, w: number, h: number) => {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, get: () => h });
  img.dispatchEvent(new Event('load'));
};

describe('C118 T8 정지 full = 모서리 · 그림자 · 쪽 번호 0', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  for (const card of [false, true]) {
    it(`${card ? '카드' : '시트'}: still.full = 모서리 0 · 그림자 0 · 쪽 번호 0 · still(full 아님) = 모서리 그대로 · 정지 아님 = 모서리 · 그림자 그대로`, () => {
      const design = card ? { poster_frame: 'card' } : {};
      const full = buildPosterFrame({ ...base(withText, design), still: { deadlineText: null, full: true } });
      expect(sheetOf(full.root, card).style.borderRadius).toBe('0');
      expect(sheetOf(full.root, card).style.boxShadow).toBe('none');
      expect(full.parts.pager).toBeNull();
      const stillOnly = buildPosterFrame({ ...base(withText, design), still: { deadlineText: null } });
      expect(sheetOf(stillOnly.root, card).style.borderRadius).not.toBe('0');
      const live = buildPosterFrame(base(withText, design));
      expect(sheetOf(live.root, card).style.borderRadius).not.toBe('0');
      expect(sheetOf(live.root, card).style.boxShadow).not.toBe('none');
    });
  }
});

describe('C118 (Codex 구현 1R ①) 정지 full 글 · 배지 = 안전 칸 안', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const scrimOf = (root: ParentNode) => (root.querySelector('[data-hjl-slide="0"]') as HTMLElement).lastElementChild as HTMLElement;
  it('still.full = 글 상자 좌우 · 아래 여백 = 폭 12%(≥ 가장자리 10%) · full 아님 · 정지 아님 = 22px · 18px 그대로', () => {
    const one = [withText[0]];
    const full = buildPosterFrame({ ...base(one, {}), still: { deadlineText: null, full: true } });
    const s = scrimOf(full.root).style;
    expect([s.paddingLeft, s.paddingRight, s.paddingBottom]).toEqual(['12%', '12%', '12%']);
    expect(R.fullTextPad).toBe(0.12);
    // (Codex 구현 2R) 위 경계 = 높이 상한 88%(상자 위 끝 ≥ 12%) · 넘침 = 스크롤 칸(굽기 쪽 글 넘침 판정이 잡는 꼴)
    expect(s.maxHeight).toBe('88%');
    expect(s.overflowY).toBe('auto');
    for (const r of [buildPosterFrame({ ...base(one, {}), still: { deadlineText: null } }), buildPosterFrame(base(one, {}))]) {
      const t = scrimOf(r.root).style;
      expect([t.paddingLeft, t.paddingRight, t.paddingBottom]).toEqual(['22px', '22px', '18px']);
      expect(t.maxHeight).toBe('100%');
    }
  });
});

describe('C118 T10 쪽 번호 자리', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('사진 위 글(장 제목 · 본문) 있음 = 오른쪽 위 · 아래 비움', () => {
    const p = buildPosterFrame(base(withText, {})).parts.pager!;
    expect(p.style.top).toBe(`${R.pagerInset}px`);
    expect(p.style.bottom).toBe('');
  });
  it('글 없음 · 통짜(글이 그림에 구워짐) = 아래 그대로', () => {
    for (const [slides, design] of [[noText, {}], [withText, { poster_text: 'baked' }]] as const) {
      const p = buildPosterFrame(base(slides as any, design)).parts.pager!;
      expect(p.style.bottom).toBe(`${R.pagerInset}px`);
      expect(p.style.top).toBe('');
    }
  });
});

describe('C118 T10 여러 장 칸 비율 · 높이 상한', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const cases: Array<[string, number, number, string, number]> = [
    ['세로로 아주 긴 400 × 2000 = 3:4 로 묶음', 400, 2000, '750 / 1000', 3 / 4],
    ['가로로 아주 긴 2000 × 400 = 4:3 으로 묶음', 2000, 400, '1333 / 1000', 4 / 3],
    ['정사각 1000 × 1000 = 1:1', 1000, 1000, '1000 / 1000', 1],
  ];
  for (const [name, w, h, ratio, aspect] of cases) {
    for (const vh of [844, 560]) {
      it(`${name} · 화면 높이 ${vh}: 칸 = ${ratio} · 그림 + 그림 밖 높이 ≤ 화면 72%`, () => {
        const f = buildPosterFrame(base(withText, {}, vh));
        loadAs(f.parts.images[0] as HTMLImageElement, w, h);
        for (const c of f.parts.cells) expect((c as HTMLElement).style.aspectRatio).toBe(ratio);
        const width = parseInt(f.root.style.maxWidth, 10);
        // 그림 밖 높이 = 버튼 칸 + 시트 바닥 줄(정지 아님 · 시트 · 버튼 있음)
        const chrome = R.ctaHeight + 24 + R.sheet.footHeight;
        expect(width / aspect + chrome).toBeLessThanOrEqual(Math.round(vh * 0.72) + 1);
        expect(width).toBeLessThanOrEqual(R.sheet.maxWidth);
      });
    }
  }
  it('그림이 들어오기 전 = 3:4 칸(지금 그대로)', () => {
    const f = buildPosterFrame(base(withText, {}));
    for (const c of f.parts.cells) expect((c as HTMLElement).style.aspectRatio).toBe('3 / 4');
  });
});
