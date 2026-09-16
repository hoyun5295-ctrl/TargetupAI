/**
 * 쪽 합성 계획·바탕색 계약 (★ 2026-09-16). 실제 합성(sharp·파이썬)은 서버 실측으로 확인한다.
 */
import { describe, it, expect } from 'vitest';
import { planCatalogPage, catalogTintRgb, readLocalImage, CATALOG_TINT_RATIO } from './dm-catalog-render';
import { CATALOG_PAGE } from './dm-catalog-templates';

const P = (n: number) => Array.from({ length: n }, (_, i) => `/api/dm/v/images/c1/p${i}.jpg`);

describe('쪽 합성 계획', () => {
  it('사진이 자리 수만큼 있으면 자리마다 하나씩 배치한다', () => {
    const plan = planCatalogPage('duo', P(2));
    expect(plan.placements).toHaveLength(2);
    expect(plan.missingPhotos).toBe(0);
    expect(plan.placements[0].px.top).toBeLessThan(plan.placements[1].px.top);
  });

  it('사진이 모자라면 있는 만큼만 얹고 모자란 수를 알린다', () => {
    const plan = planCatalogPage('duo', P(1));
    expect(plan.placements).toHaveLength(1);
    expect(plan.missingPhotos).toBe(1);
  });

  it('사진이 남으면 앞에서부터 자리 수만큼만 쓴다', () => {
    expect(planCatalogPage('one', P(5)).placements).toHaveLength(1);
  });

  it('빈 문자열·공백은 사진으로 세지 않는다', () => {
    const plan = planCatalogPage('one', ['  ', '']);
    expect(plan.placements).toHaveLength(0);
    expect(plan.missingPhotos).toBe(1);
  });

  it('마무리 안내는 사진 자리가 없다', () => {
    const plan = planCatalogPage('end', P(3));
    expect(plan.textOnly).toBe(true);
    expect(plan.placements).toHaveLength(0);
    expect(plan.missingPhotos).toBe(0);
  });

  it('배치는 캔버스를 벗어나지 않는다', () => {
    for (const k of ['cover', 'one', 'duo'] as const) {
      for (const p of planCatalogPage(k, P(2)).placements) {
        expect(p.px.left + p.px.width).toBeLessThanOrEqual(CATALOG_PAGE.width);
        expect(p.px.top + p.px.height).toBeLessThanOrEqual(CATALOG_PAGE.height);
      }
    }
  });
});

describe('바탕색', () => {
  it('브랜드색이 없으면 흰 바탕', () => {
    expect(catalogTintRgb(null)).toEqual({ r: 255, g: 255, b: 255 });
    expect(catalogTintRgb('보라색')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('브랜드색을 흰색에 옅게 섞는다 (8%)', () => {
    const t = catalogTintRgb('#000000');
    const expected = Math.round(255 - 255 * CATALOG_TINT_RATIO);
    expect(t).toEqual({ r: expected, g: expected, b: expected });
    expect(catalogTintRgb('#7c3aed').r).toBeGreaterThan(200);
  });
});

describe('사진 읽기', () => {
  it('우리 저장본이 아닌 주소는 읽지 않는다 (외부 주소로 합성하지 않는다)', () => {
    expect(readLocalImage('https://cdn.example.invalid/a.jpg')).toBeNull();
    expect(readLocalImage('data:image/png;base64,AAAA')).toBeNull();
    expect(readLocalImage('')).toBeNull();
  });
});
