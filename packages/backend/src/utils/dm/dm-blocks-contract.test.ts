/**
 * 블록 조립 계약 (★ 2026-09-16 설계서 §1 불변 원칙) — 프론트에 테스트 러너가 없어 소스 계약으로 고정한다.
 * (선례: dm-flow-invariants.test.ts 가 같은 방식으로 스토어 가드 상주를 강제)
 *
 * 지키는 것:
 *  1. 블록은 실존 섹션 타입이다(새 섹션 0).
 *  2. 블록 창은 기존 섹션 편집기를 쓴다(폼 두 벌 금지).
 *  3. 이미지 스튜디오 삽입은 기존 생성·저장 경로를 쓴다(새 생성 엔진 0).
 *  4. 조립 캔버스는 편집기와 같은 DmCanvas 다(조립 화면 = 발행물 미러).
 *  5. 쪽 합성은 서버 공용 경로 하나를 쓴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SECTION_TYPES } from './dm-section-registry';

const front = (p: string) => readFileSync(resolve(process.cwd(), '../frontend/src', p), 'utf8');

describe('블록 조립 계약', () => {
  it('1. 팔레트의 블록은 모두 실존 섹션 타입이다', () => {
    const src = front('utils/dm-blocks.ts');
    const used = Array.from(src.matchAll(/section: '([a-z_]+)'/g)).map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(12);
    for (const t of used) {
      expect(SECTION_TYPES, `블록이 없는 섹션 타입(${t})을 가리킨다`).toContain(t as any);
    }
  });

  it('1-2. 한 섹션을 두 블록이 쓰면 되돌리기(섹션 → 블록)가 갈린다', () => {
    const src = front('utils/dm-blocks.ts');
    expect(src).toContain('export function blockOfSection');
    // cta = 링크 칩·버튼 둘이 쓰므로 style 로 가른다
    expect(src).toContain("b?.style === 'outline'");
  });

  it('2. 블록 창은 기존 섹션 편집기를 쓴다 (폼을 다시 만들지 않는다)', () => {
    const src = front('components/dm/build/BlockEditModal.tsx');
    expect(src).toContain("import SectionPropsEditor from '../panels/SectionPropsEditor'");
    expect(src).toContain('<SectionPropsEditor');
    expect(src).toContain('ModalBase');
  });

  it('3. 이미지 스튜디오 삽입 = 기존 생성·저장 경로', () => {
    const src = front('components/dm/build/StudioInsertModal.tsx');
    expect(src).toContain('/api/image-studio/templates');
    expect(src).toContain('/api/image-studio/generate');
    expect(src).toContain('/api/image-studio/save');
    // 새 생성 엔진·새 크레딧 키를 만들지 않는다
    expect(src).not.toMatch(/deductCredit|creditKey|new-credit/i);
  });

  it('4. 조립 캔버스 = 편집기와 같은 DmCanvas · 저장도 스토어 한 곳', () => {
    const src = front('components/dm/build/DmBlockBuilder.tsx');
    expect(src).toContain("import DmCanvas from '../DmCanvas'");
    expect(src).toContain('<DmCanvas');
    expect(src).toContain('useDmBuilderStore');
    expect(src).not.toContain('fetch(\'/api/dm\'');
  });

  it('5. 쪽 합성은 서버 공용 경로 하나 · 가격은 이미지에 새기지 않는다', () => {
    const src = front('components/dm/build/CatalogPageModal.tsx');
    expect(src).toContain('/api/dm/catalog/render-pages');
    expect(src).toContain('가격·할인율은 쪽 이미지에 새기지 않아요');
    // 합성 결과는 갤러리 1장짜리 장(카탈로그 책 자격)
    const builder = front('components/dm/build/DmBlockBuilder.tsx');
    expect(builder).toContain("layout: 'list_1xN'");
    expect(builder).toContain('full_bleed: true');
  });

  it('6. 넘김 효과는 스토어 한 축(settings.effect) — 기본은 저장에 싣지 않는다', () => {
    const store = front('stores/dmBuilderStore.ts');
    expect(store).toContain('pageEffect');
    expect(store).toContain("s.pageEffect !== 'slide' ? { effect: s.pageEffect } : {}");
  });
});
