/**
 * 카탈로그 쪽 템플릿 4종 계약 테스트 (★ 2026-09-16 Harold 승인 · 목업 탭1 그대로).
 *
 * 템플릿은 "자리"만 정하고 합성은 호출부가 한다. 여기서 고정하는 것:
 *  - 템플릿 4종(표지 · 상품 한 점 · 두 점 비교 · 마무리)의 이미지 자리 수와 좌표가 캔버스 안에 있다.
 *  - 글자는 파이썬 합성기가 한 항목에 한 줄만 찍으므로(줄바꿈 기능 없음) 줄 나눔·말줄임을 이 부품이 계산한다.
 *  - 값이 비면 그 글자 항목 자체를 만들지 않는다(빈 줄 자리 0).
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOG_PAGE,
  CATALOG_TEMPLATES,
  catalogTemplateOf,
  imageSlotPx,
  wrapCatalogText,
  catalogTypographyOf,
  type CatalogTemplateKey,
} from './dm-catalog-templates';

const KEYS: CatalogTemplateKey[] = ['cover', 'one', 'duo', 'end'];

describe('카탈로그 쪽 템플릿', () => {
  it('규격은 1200x1600(3:4) 이다', () => {
    expect(CATALOG_PAGE.width).toBe(1200);
    expect(CATALOG_PAGE.height).toBe(1600);
  });

  it('템플릿 4종이 있고 이미지 자리 수가 정해져 있다', () => {
    expect(CATALOG_TEMPLATES.map((t) => t.key)).toEqual(KEYS);
    expect(catalogTemplateOf('cover').images).toHaveLength(1);
    expect(catalogTemplateOf('one').images).toHaveLength(1);
    expect(catalogTemplateOf('duo').images).toHaveLength(2);
    expect(catalogTemplateOf('end').images).toHaveLength(0);
  });

  it('모르는 키는 상품 한 점으로 떨어진다', () => {
    expect(catalogTemplateOf('없는것' as CatalogTemplateKey).key).toBe('one');
  });

  it('이미지 자리는 캔버스 안이고 픽셀 변환은 정수다', () => {
    for (const t of CATALOG_TEMPLATES) {
      for (const s of t.images) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(1);
        expect(s.y + s.h).toBeLessThanOrEqual(1);
        const px = imageSlotPx(s);
        expect(Number.isInteger(px.left) && Number.isInteger(px.top) && Number.isInteger(px.width) && Number.isInteger(px.height)).toBe(true);
        expect(px.left + px.width).toBeLessThanOrEqual(CATALOG_PAGE.width);
        expect(px.top + px.height).toBeLessThanOrEqual(CATALOG_PAGE.height);
      }
    }
  });

  it('표지는 사진이 쪽 전체를 덮고 아래 글자는 흰색이다', () => {
    const cover = catalogTemplateOf('cover');
    expect(cover.images[0]).toMatchObject({ x: 0, y: 0, w: 1, h: 1, fit: 'cover' });
    expect(cover.texts.every((b) => b.color === '#ffffff')).toBe(true);
  });

  describe('줄 나눔', () => {
    const block = { maxWidth: 0.84, size: 0.045, maxLines: 2 };

    it('짧으면 한 줄', () => {
      expect(wrapCatalogText('캐시미어 코트', block)).toEqual(['캐시미어 코트']);
    });

    it('길면 띄어쓰기에서 나눈다', () => {
      const lines = wrapCatalogText('가볍고 따뜻한 겨울 아우터 색상 세 가지로 준비했어요', block);
      expect(lines.length).toBe(2);
      expect(lines.every((l) => !l.startsWith(' ') && !l.endsWith(' '))).toBe(true);
      expect(lines.join(' ')).toContain('가볍고 따뜻한');
    });

    it('줄 수 상한을 넘으면 마지막 줄을 말줄임으로 끝낸다', () => {
      const lines = wrapCatalogText('겨울 신상 아우터를 아주 길게 소개하는 문장 하나 둘 셋 넷 다섯 여섯 일곱 여덟', block);
      expect(lines).toHaveLength(2);
      expect(lines[1].endsWith('…')).toBe(true);
    });

    it('띄어쓰기가 없는 긴 글자도 잘라서 나눈다', () => {
      const lines = wrapCatalogText('가'.repeat(60), block);
      expect(lines).toHaveLength(2);
      expect(lines[0].length).toBeGreaterThan(5);
    });

    it('줄바꿈 문자는 그 자리에서 나눈다', () => {
      expect(wrapCatalogText('첫 줄\n둘째 줄', block)).toEqual(['첫 줄', '둘째 줄']);
    });

    it('빈 값이면 줄이 없다', () => {
      expect(wrapCatalogText('   ', block)).toEqual([]);
      expect(wrapCatalogText(null, block)).toEqual([]);
    });
  });

  describe('합성기 글자 항목', () => {
    it('줄마다 항목 하나이고 y 가 줄 간격만큼 내려간다', () => {
      const typo = catalogTypographyOf('one', { title: '캐시미어 코트', desc: '가볍고 따뜻한 겨울 아우터 색상 세 가지' }, null);
      expect(typo.length).toBeGreaterThanOrEqual(2);
      const descs = typo.filter((t) => t.color !== '#111111' || true).slice(1);
      for (let i = 1; i < descs.length; i++) {
        expect(descs[i].y).toBeGreaterThan(descs[i - 1].y);
      }
      expect(typo.every((t) => t.y > 0 && t.y < 1 && t.x > 0 && t.x <= 1)).toBe(true);
      expect(typo.every((t) => t.size > 0 && t.size < 0.2)).toBe(true);
    });

    it('빈 값은 항목을 만들지 않는다', () => {
      expect(catalogTypographyOf('one', { title: '', desc: '' }, null)).toEqual([]);
      const only = catalogTypographyOf('one', { title: '제목만', desc: '' }, null);
      expect(only).toHaveLength(1);
      expect(only[0].text).toBe('제목만');
    });

    it('표지 글자는 흰색 + 그림자(밝은 사진 위에서도 읽히게)', () => {
      const typo = catalogTypographyOf('cover', { title: '2026 가을 카탈로그', desc: '이번 시즌 신상' }, null);
      expect(typo.length).toBe(2);
      expect(typo.every((t) => t.color === '#ffffff')).toBe(true);
      expect(typo.every((t) => (t as any).effect === 'shadow')).toBe(true);
    });

    it('두 점 비교는 사진마다 설명 한 줄씩 받는다', () => {
      const typo = catalogTypographyOf('duo', { label1: '데일리 머플러', label2: '겨울 니트' }, null);
      expect(typo.map((t) => t.text)).toEqual(['데일리 머플러', '겨울 니트']);
      expect(typo[0].y).toBeLessThan(typo[1].y);
    });

    it('글꼴 경로를 그대로 싣는다(한글 폰트 보증은 호출부 몫)', () => {
      const typo = catalogTypographyOf('end', { title: '매장에서 만나보세요', desc: '가까운 매장에서 착용해 보세요' }, '/fonts/malgunbd.ttf');
      expect(typo.every((t) => t.fontPath === '/fonts/malgunbd.ttf')).toBe(true);
    });
  });
});
