/**
 * ★ 2026-07-16 M4 — 편집기 개발자 코드값 노출 0 게이트 (설계서 §1-5-3)
 *
 * beauty-elegant류 코드값이 사용자 select에 그대로 노출되던 문제(Harold 스크린샷)의 재발 차단:
 *  1. frontend SECTION_META의 모든 스타일 변형 값이 STYLE_VARIANT_LABELS에 한국어 라벨로 등재
 *  2. DmRightPanel은 styleVariantLabel()을 경유해서만 변형을 표시 (raw {v} 렌더 금지)
 * (frontend에 테스트 러너가 없어 backend vitest가 소스를 직접 스캔 — ai-call-invariants 패턴)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FE_ROOT = resolve(__dirname, '../../../../../frontend/src');
const defaultsSrc = readFileSync(resolve(FE_ROOT, 'utils/dm-section-defaults.ts'), 'utf-8');
const rightPanelSrc = readFileSync(resolve(FE_ROOT, 'components/dm/DmRightPanel.tsx'), 'utf-8');

describe('M4 — 스타일 변형 한국어 라벨 게이트', () => {
  it('SECTION_META 전 변형 값이 STYLE_VARIANT_LABELS에 등재 (신규 변형 추가 시 등재 의무)', () => {
    const variantArrays = [...defaultsSrc.matchAll(/supportsStyleVariants:\s*\[([^\]]*)\]/g)];
    expect(variantArrays.length).toBeGreaterThan(0);
    const variants = new Set<string>();
    for (const m of variantArrays) {
      for (const v of m[1].matchAll(/'([^']+)'/g)) variants.add(v[1]);
    }
    expect(variants.size).toBeGreaterThanOrEqual(5);

    const labelsBlock = defaultsSrc.match(/STYLE_VARIANT_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
    expect(labelsBlock, 'STYLE_VARIANT_LABELS 정의가 존재해야 한다').toBeTruthy();
    const labelKeys = new Set([...labelsBlock![1].matchAll(/'([^']+)':/g)].map((m) => m[1]));

    const missing = [...variants].filter((v) => !labelKeys.has(v));
    expect(missing, `라벨 미등재 변형: ${missing.join(', ')}`).toEqual([]);
  });

  it('라벨 값에 영문 코드 잔존 금지 — 전부 한국어 표기', () => {
    const labelsBlock = defaultsSrc.match(/STYLE_VARIANT_LABELS[^=]*=\s*\{([\s\S]*?)\};/)!;
    const labelValues = [...labelsBlock[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    for (const v of labelValues) {
      expect(/[가-힣]/.test(v), `한국어 라벨이어야 한다: "${v}"`).toBe(true);
      expect(/-[a-z]/.test(v), `하이픈 코드 표기 금지: "${v}"`).toBe(false);
    }
  });

  it('DmRightPanel — 변형 표시는 styleVariantLabel 경유만 (raw 코드값 option 렌더 금지)', () => {
    expect(rightPanelSrc).toContain('styleVariantLabel(v)');
    // supportsStyleVariants.map 안에서 라벨 함수 없이 {v}를 그대로 그리는 패턴 금지
    const rawRender = rightPanelSrc.match(/supportsStyleVariants\.map\([\s\S]{0,200}?>\{v\}</);
    expect(rawRender, '변형 코드값 raw 렌더 발견').toBeNull();
  });

  it('DmRightPanel — 공통 속성은 [고급 설정] 접힘 구조 유지 (폼 나열 회귀 차단)', () => {
    expect(rightPanelSrc).toContain('<details>');
    expect(rightPanelSrc).toContain('고급 설정');
    expect(rightPanelSrc).toContain('빠른 디자인');
  });
});
