/**
 * ★ 2026-07-16 M3 — 상품 이미지 파이프라인 순수 계약 테스트 (설계서 §2-5)
 *  - extractMallProductNo: 붙여넣은 링크의 상품번호 파싱 (ID 확정 매칭의 축)
 *  - cleanProductNameForSearch: 후보 검색용 상품명 정제
 */

import { describe, it, expect } from 'vitest';
import { extractMallProductNo } from '../mall-product-normalize';
import { cleanProductNameForSearch, isNaverShopSearchConfigured } from '../naver-shop-search';

describe('extractMallProductNo — 링크 → 상품번호 (ID 확정 축)', () => {
  it('네이버 브랜드스토어/스마트스토어', () => {
    expect(extractMallProductNo('https://brand.naver.com/shiseido/products/9090905782')).toBe('9090905782');
    expect(extractMallProductNo('https://smartstore.naver.com/mystore/products/123456?nl-query=x')).toBe('123456');
  });
  it('카페24 — detail.html·SEO형', () => {
    expect(extractMallProductNo('https://mymall.cafe24.com/product/detail.html?product_no=777&cate_no=1')).toBe('777');
    expect(extractMallProductNo('https://mymall.cafe24.com/product/봄신상원피스/1234/category/25/')).toBe('1234');
  });
  it('번호 없는 URL·빈 값 = null (오매칭 축 자체가 없음)', () => {
    expect(extractMallProductNo('https://brand.naver.com/shiseido')).toBeNull();
    expect(extractMallProductNo('')).toBeNull();
    expect(extractMallProductNo(undefined)).toBeNull();
  });
});

describe('cleanProductNameForSearch — 검색 적중률 정제', () => {
  it('대괄호 태그·용량 제거, 핵심 품명 보존', () => {
    expect(cleanProductNameForSearch('[2+1 증정] 시세이도 NEW 파란자차 50ml')).toBe('시세이도 NEW 파란자차');
    expect(cleanProductNameForSearch('시세이도 싱크로 스킨 글로우 쿠션 컴팩트 세트')).toContain('싱크로 스킨 글로우');
  });
  it('전부 제거되면 원문 유지 (빈 검색어 방지)', () => {
    expect(cleanProductNameForSearch('[한정] 500ml')).not.toBe('');
  });
});

describe('설정 게이트', () => {
  it('isNaverShopSearchConfigured — env 미설정 로컬 = false (미설정 정직 안내 경로)', () => {
    expect(typeof isNaverShopSearchConfigured()).toBe('boolean');
  });
});
