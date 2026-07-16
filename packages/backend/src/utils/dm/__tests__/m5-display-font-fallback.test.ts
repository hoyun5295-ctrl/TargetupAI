/**
 * ★ 2026-07-16 M5 — 히어로 궁서체 영구 종결 재발 게이트
 *
 * 근본: display 서체 스택이 generic `serif`로 끝나면 서체 로딩 실패 시 브라우저 기본
 * 세리프(바탕 — 사용자 체감 "궁서체")로 떨어진다. 1겹 = 자가 호스팅(로딩 보장, e1e3c61b),
 * 2겹 = 이 게이트: 뷰어에 주입되는 --dm-font-display가 어떤 경로로도 generic serif로
 * 끝나지 않음을 기계로 고정한다.
 */

import { describe, it, expect } from 'vitest';
import { sansSafeDisplayStack, CORE_FONTS } from '../../design-core/fonts';
import { renderDmTokensCss } from '../dm-tokens';
import { artDirectionToCssVars, normalizeArtDirection } from '../dm-art-direction';

/** CSS 문자열에서 --dm-font-display 값 추출 */
function displayVar(css: string): string {
  const m = css.match(/--dm-font-display:\s*([^;]+);/);
  return m ? m[1].trim() : '';
}

function lastToken(stack: string): string {
  const parts = stack.split(',').map((p) => p.trim().replace(/["']/g, '').toLowerCase());
  return parts[parts.length - 1] || '';
}

describe('sansSafeDisplayStack — 꼬리 generic serif 교체 (순수)', () => {
  it('generic serif 꼬리 = sans 폴백으로 교체, 선택 패밀리는 보존', () => {
    expect(sansSafeDisplayStack('"Nanum Myeongjo", serif', 'Pretendard, sans-serif'))
      .toBe('"Nanum Myeongjo", Pretendard, sans-serif');
    expect(sansSafeDisplayStack('"Noto Serif KR", serif', 'var(--dm-font-primary)'))
      .toBe('"Noto Serif KR", var(--dm-font-primary)');
  });

  it('이미 sans로 끝나는 스택 = 무변 (기존 발행물 출력 보존)', () => {
    const sans = '"Pretendard Variable", Pretendard, sans-serif';
    expect(sansSafeDisplayStack(sans, 'x')).toBe(sans);
    expect(sansSafeDisplayStack('"Gowun Dodum", sans-serif', 'x')).toBe('"Gowun Dodum", sans-serif');
  });

  it('빈 값 = 폴백', () => {
    expect(sansSafeDisplayStack('', 'fallback')).toBe('fallback');
    expect(sansSafeDisplayStack('  ', 'fallback')).toBe('fallback');
  });

  it('cursive/fantasy 꼬리(궁서 계열 위험군)도 교체', () => {
    expect(lastToken(sansSafeDisplayStack('"어떤서체", cursive', 'Pretendard, sans-serif'))).toBe('sans-serif');
  });
});

describe('뷰어 토큰 주입 — 어떤 브랜드킷 서체 선택에도 display 스택 꼬리 ≠ generic serif', () => {
  it('카탈로그 전 서체(명조 포함)를 font_display로 선택해도 꼬리는 sans 계열', () => {
    for (const font of CORE_FONTS) {
      const css = renderDmTokensCss({ font_display: font.css } as any);
      const v = displayVar(css);
      expect(v, `font=${font.id}`).not.toBe('');
      expect(lastToken(v), `font=${font.id} → ${v}`).not.toBe('serif');
      // 선택 패밀리(첫 토큰)는 보존 — 룩 무변
      const firstFamily = font.css.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      expect(v.toLowerCase()).toContain(firstFamily.toLowerCase());
    }
  });

  it('font_display 미설정 = 본문 스택 그대로 (기존 출력 무변)', () => {
    const css = renderDmTokensCss(undefined);
    const v = displayVar(css);
    expect(lastToken(v)).toBe('sans-serif');
  });

  it('아트디렉션 override — 브랜드 display 스택도 꼬리 generic serif 불가', () => {
    const ad = normalizeArtDirection({ headlineFont: 'serif' });
    const withBrand = artDirectionToCssVars(ad, '"Nanum Myeongjo", serif');
    const v = displayVar(withBrand);
    expect(v).toContain('Nanum Myeongjo');
    expect(v).toContain('var(--dm-font-primary)');
    expect(lastToken(v)).not.toBe('serif');
    // 브랜드 서체 미지정 + serif 헤드라인 = 기존 안전 스택(var(--dm-font-primary) 종료) 유지
    const noBrand = artDirectionToCssVars(ad);
    expect(displayVar(noBrand)).toContain('var(--dm-font-primary)');
  });
});
