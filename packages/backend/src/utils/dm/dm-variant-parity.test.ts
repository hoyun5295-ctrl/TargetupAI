import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderDmVariantCss } from './dm-tokens';

/**
 * ★ 2026-07-16 남지현 재오픈("편집 화면 ≠ 출력 화면") 재발 방지 게이트.
 *
 * [근본] 스타일 변형(style_variant) CSS가 편집 캔버스(frontend dm-builder.css "Style Variants" 절)에만
 *   있고 발행 뷰어(backend dm-tokens.ts)엔 없어, 변형 걸린 DM이 편집≠발행이었다.
 * [게이트] 편집 CSS의 변형 셀렉터(data-variant) 전량이 발행 뷰어 CSS(renderDmVariantCss)에 존재하는지
 *   기계 검증. 앞으로 한쪽만 변형을 추가/수정하면 이 테스트가 pre-push 훅에서 push를 막는다.
 */
describe('dm variant parity — 편집 캔버스 ↔ 발행 뷰어 스타일 변형 동기', () => {
  const candidates = [
    path.resolve(process.cwd(), '../frontend/src/styles/dm-builder.css'),
    path.resolve(process.cwd(), 'packages/frontend/src/styles/dm-builder.css'),
  ];
  const cssPath = candidates.find((p) => fs.existsSync(p));
  const builderCss = cssPath ? fs.readFileSync(cssPath, 'utf8') : '';
  const viewerCss = renderDmVariantCss();

  // 편집 CSS에서 실제 스타일이 걸린 변형명 추출 ([data-variant="X"]).
  //   default 제외 + kebab-case 실변형명만(주석 안 예시 "..." 등 오추출 방지).
  const variantNames = Array.from(
    new Set(Array.from(builderCss.matchAll(/\[data-variant="([^"]+)"\]/g)).map((m) => m[1])),
  ).filter((v) => v !== 'default' && /^[a-z][a-z-]*$/.test(v));

  it('편집 CSS(dm-builder.css)를 찾고 변형을 추출한다', () => {
    expect(cssPath, '편집 CSS 경로를 못 찾음 — process.cwd()=' + process.cwd()).toBeTruthy();
    expect(variantNames.length).toBeGreaterThan(0);
  });

  for (const v of ['beauty-elegant', 'fashion-editorial', 'luxury-dark', 'vibrant-playful']) {
    it(`핵심 변형이 편집 CSS에 존재: ${v}`, () => {
      expect(variantNames).toContain(v);
    });
  }

  it('편집 변형 전량이 발행 뷰어 CSS에 이식돼 있다 (드리프트 0)', () => {
    const missing = variantNames.filter((v) => !viewerCss.includes(`[data-variant="${v}"]`));
    expect(
      missing,
      `발행 뷰어(renderDmVariantCss)에 누락된 변형: ${missing.join(', ')} — dm-tokens.ts에 이식 필요`,
    ).toEqual([]);
  });

  it('이번 신고 지점(fashion-editorial 쿠폰 버튼) 규칙이 발행에 존재한다', () => {
    expect(viewerCss).toContain('.dm-section-wrap[data-variant="fashion-editorial"] .dm-cta-primary');
  });
});
