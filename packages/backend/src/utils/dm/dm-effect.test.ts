/**
 * 장 넘김 효과(settings.effect) 계약 테스트 — ★ 2026-09-16 Harold 승인(밀어내기·책장·페이드 3종).
 *
 * 지키는 것:
 *  - 효과 미지정·'slide' = 지금 동작. CSS·스크립트 조각이 **빈 문자열**이라 발행 HTML이 한 글자도 바뀌지 않는다.
 *  - 'flip'·'fade' 는 slides 모드 · 2장 이상일 때만 켜진다(세로 스크롤 DM에는 넘길 장이 없다).
 *  - 조각 문자열은 dm-viewer.ts 의 template literal 안에 들어가므로 백틱과 "$"+"{" 를 쓰지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { DM_EFFECTS, effectOf, effectBodyClass, renderEffectCss, renderEffectScript } from './dm-effect';

describe('장 넘김 효과', () => {
  it('효과 3종만 있다', () => {
    expect(DM_EFFECTS).toEqual(['slide', 'flip', 'fade']);
  });

  describe('effectOf', () => {
    const slides = { mode: 'slides' as const, totalPages: 4 };

    it('미지정·slide·모르는 값 = null (현행 경로)', () => {
      expect(effectOf({}, slides.mode, slides.totalPages)).toBeNull();
      expect(effectOf({ settings: {} }, slides.mode, slides.totalPages)).toBeNull();
      expect(effectOf({ settings: { effect: 'slide' } }, slides.mode, slides.totalPages)).toBeNull();
      expect(effectOf({ settings: { effect: '3d-cube' } }, slides.mode, slides.totalPages)).toBeNull();
    });

    it('flip·fade 를 읽는다 (settings 가 JSON 문자열이어도)', () => {
      expect(effectOf({ settings: { effect: 'flip' } }, slides.mode, slides.totalPages)).toBe('flip');
      expect(effectOf({ settings: '{"effect":"fade"}' }, slides.mode, slides.totalPages)).toBe('fade');
    });

    it('세로 스크롤 DM·장 1개면 켜지 않는다', () => {
      expect(effectOf({ settings: { effect: 'flip' } }, 'scroll', 4)).toBeNull();
      expect(effectOf({ settings: { effect: 'flip' } }, 'slides', 1)).toBeNull();
    });
  });

  describe('조각', () => {
    it('효과가 없으면 CSS·스크립트·본문 클래스가 모두 빈 문자열', () => {
      expect(renderEffectCss(null)).toBe('');
      expect(renderEffectScript(null)).toBe('');
      expect(effectBodyClass(null)).toBe('');
    });

    it('flip = 3D 뒤집기 · fade = 투명도 (장을 겹쳐 놓는 공통 규칙 포함)', () => {
      const flip = renderEffectCss('flip');
      expect(flip).toContain('.dm-fx .dm-page');
      expect(flip).toContain('rotateY');
      expect(flip).toContain('perspective');
      const fade = renderEffectCss('fade');
      expect(fade).toContain('opacity');
      expect(fade).not.toContain('rotateY');
      expect(effectBodyClass('flip')).toBe(' dm-fx dm-fx-flip');
    });

    it('스크립트는 기존 추적·인디케이터 함수를 그대로 부른다', () => {
      const js = renderEffectScript('flip');
      expect(js).toContain('function fxGo');
      expect(js).toContain('updateCurrent(');  // 도달 장·점·카운터 갱신 = 기존 한 곳
      expect(js).toContain('pageEls');
    });

    it('조각에 백틱·치환 구문·정규식이 없다 (뷰어 template literal 안전)', () => {
      for (const fx of ['flip', 'fade'] as const) {
        const s = renderEffectCss(fx) + renderEffectScript(fx);
        expect(s.includes('`')).toBe(false);
        expect(s.includes('${')).toBe(false);
        expect(s.includes('\\')).toBe(false);
      }
    });

    it('움직임 최소화 설정을 존중한다', () => {
      expect(renderEffectCss('fade')).toContain('prefers-reduced-motion');
    });
  });
});
