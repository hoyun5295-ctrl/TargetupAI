/**
 * dm-brand-kit — 브랜드 학습 통합(2026-07-21) 데이터 모델 테스트.
 * 서체 한/영 신키가 구키(font_family/font_display)를 무손실 폴백하는지 검증(회귀 0).
 */
import { describe, it, expect } from 'vitest';
import { normalizeBrandKit } from './dm-brand-kit';

describe('normalizeBrandKit — 서체 한/영 폴백', () => {
  it('font_ko 미설정 → font_family(본문 서체)로 폴백', () => {
    const k = normalizeBrandKit({ font_family: 'noto-sans-kr' });
    expect(k.font_ko).toBe('noto-sans-kr');
  });
  it('font_en은 신규 축 — font_display(헤드라인)로 폴백하지 않음(미설정 유지)', () => {
    const k = normalizeBrandKit({ font_family: 'pretendard', font_display: 'black-han' });
    expect(k.font_ko).toBe('pretendard');
    expect(k.font_en).toBeUndefined();
    // 헤드라인 서체는 렌더에서 그대로 유지되도록 원본 보존
    expect(k.font_display).toBe('black-han');
  });
  it('신키(font_ko/font_en) 명시 시 우선', () => {
    const k = normalizeBrandKit({ font_family: 'old', font_ko: 'gothic-a1', font_en: 'ibm-plex-sans' });
    expect(k.font_ko).toBe('gothic-a1');
    expect(k.font_en).toBe('ibm-plex-sans');
  });
  it('신규 필드(official sns·contact 확장) 보존', () => {
    const k = normalizeBrandKit({
      sns: { instagram: 'https://ig', facebook: 'https://fb' },
      contact: { phone: '02-1', cs_phone: '1544-0000', address: '서울시' },
    });
    expect(k.sns?.instagram).toBe('https://ig');
    expect(k.sns?.facebook).toBe('https://fb');
    expect(k.contact?.cs_phone).toBe('1544-0000');
    expect(k.contact?.address).toBe('서울시');
  });
  it('빈 입력 안전', () => {
    const k = normalizeBrandKit({});
    expect(k.font_ko).toBeUndefined();
    expect(k.font_en).toBeUndefined();
  });
});
