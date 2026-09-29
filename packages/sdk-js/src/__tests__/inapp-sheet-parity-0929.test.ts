import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HanjulloInAppModule, POSTER_SHEET_DEFAULTS, POSTER_LAYOUTS } from '../inapp';

/**
 * ★ 2026-09-29 인앱 만들기 개편 — 편집 미리보기 ↔ SDK 실렌더 대조(설계서 §3 1차 · 회의론자 11).
 *   프론트 PosterSheetPreview(React)와 SDK renderPosterSheet(DOM)가 같은 기본값 표 · 같은 부품 이름 · 같은 바닥 문구 ·
 *   같은 쪽 번호 형식을 쓰는지 묶는다. SDK 는 실제로 그려서(넘긴 뒤 상태 포함) 확인하고, 프론트는 원본에서 읽는다.
 */

const FE = readFileSync(join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'inapp', 'PosterSheetPreview.tsx'), 'utf8');

function stubMatchMedia() {
  (window as any).matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
}
const mod = () => new HanjulloInAppModule('hjl_test', '', 'https://app.example.com/api/cdp') as any;
const msg = (over: Record<string, any>) => ({
  id: '55555555-5555-5555-5555-555555555555', title: 'T', body: 'B', template: 'full_image',
  backgroundColor: '#fff', textColor: '#111', triggerEvent: 'page_load', displayFrequency: 'always', ...over,
});
const partsIn = (root: ParentNode) => new Set(Array.from(root.querySelectorAll('[data-hjl-part]')).map((e) => e.getAttribute('data-hjl-part')));

/** 프론트 원본의 POSTER_SHEET_DEFAULTS 리터럴을 읽는다 */
function feDefaults(): Record<string, any> {
  const i = FE.indexOf('export const POSTER_SHEET_DEFAULTS');
  const body = FE.slice(FE.indexOf('= {', i) + 2, FE.indexOf('};', i) + 1);
  const json = body
    .replace(/(\w+):/g, '"$1":')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, '}');
  return JSON.parse(json);
}

describe('기본값 · 레이아웃 값', () => {
  it('POSTER_SHEET_DEFAULTS 표가 같다', () => {
    expect(feDefaults()).toEqual(POSTER_SHEET_DEFAULTS);
  });
  it('레이아웃 값 목록이 같다', () => {
    expect(FE).toContain(`export const POSTER_LAYOUTS: PosterLayout[] = [${POSTER_LAYOUTS.map((l) => `'${l}'`).join(', ')}];`);
  });
});

describe('부품 이름 · 바닥 문구 · 쪽 번호', () => {
  beforeEach(() => { stubMatchMedia(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); sessionStorage.clear(); });

  const REQUIRED: Record<'event_card' | 'banner_sheet', string[]> = {
    event_card: ['text', 'eyebrow', 'title', 'body', 'media', 'pager', 'foot', 'foot-snooze', 'foot-close'],
    banner_sheet: ['panel', 'eyebrow', 'subtitle', 'title', 'body', 'cta', 'media', 'pager', 'foot', 'foot-snooze', 'foot-close'],
  };

  for (const layout of ['event_card', 'banner_sheet'] as const) {
    it(`${layout}: SDK 가 그린 부품 = 프론트가 쓰는 부품 이름`, () => {
      mod().renderPoster(msg({
        design: { poster_layout: layout, dismiss_mode: 'snooze_day' },
        posterSlides: [
          { image_url: '/1.jpg', eyebrow: 'E', subtitle: 'S', title: '하나', body: 'B', cta: { label: 'C', action_url: '/x' } },
          { image_url: '/2.jpg', eyebrow: 'E', subtitle: 'S', title: '둘', body: 'B', cta: { label: 'C', action_url: '/y' } },
        ],
      }), 'T', 'B', '/1.jpg', '', [], 'fade', null, { customer: {} });
      const sdk = partsIn(document);
      for (const p of REQUIRED[layout]) {
        expect(sdk.has(p), `SDK ${p}`).toBe(true);
        expect(FE.includes(`'${p}'`) || FE.includes(`"${p}"`), `FE ${p}`).toBe(true);
      }
    });
  }

  it('바닥 문구 · 닫기 방식 판정이 같다', () => {
    for (const t of ['오늘 하루 보지 않기', '다시 보지 않기', '닫기']) expect(FE).toContain(t);
    expect(FE).toContain("String(design?.dismiss_mode || '') === 'snooze_day'");
  });

  it('쪽 번호 형식 = "N / M" · 넘긴 뒤 상태도 같은 형식', () => {
    expect(FE).toContain('{idx + 1} / {count}');
    mod().renderPoster(msg({
      design: { poster_layout: 'event_card' },
      posterSlides: [{ image_url: '/1.jpg' }, { image_url: '/2.jpg' }, { image_url: '/3.jpg' }],
    }), 'T', 'B', '/1.jpg', '', [], 'fade', null, { customer: {} });
    const pager = () => document.querySelector('[data-hjl-part="pager"]')!.textContent;
    expect(pager()).toBe('1 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(pager()).toBe('3 / 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(pager()).toBe('1 / 3');
  });

  it('1장 = 쪽 번호 없음(양쪽 모두 count > 1 일 때만)', () => {
    expect(FE).toContain('const pager = count > 1 ? (');
    mod().renderPoster(msg({ design: { poster_layout: 'banner_sheet' }, posterSlides: [{ image_url: '/1.jpg', title: 't' }] }), 'T', 'B', '/1.jpg', '', [], 'fade', null, { customer: {} });
    expect(document.querySelector('[data-hjl-part="pager"]')).toBeNull();
  });
});
