import { describe, test, expect } from 'vitest';
import { normalizeOpt080Input, normalizeWebUrl, formatKoreanDateTimeDisplay } from './normalize';

describe('formatKoreanDateTimeDisplay — 쿠폰 마감 한국어 표시 (2026-07-02 ISO 원문 노출 신고)', () => {
  test('ISO Z = KST로 변환해 표시 (03:00Z → 12:00 KST)', () => {
    expect(formatKoreanDateTimeDisplay('2026-07-30T03:00:00.000Z')).toBe('2026. 7. 30 12:00');
  });

  test('KST 23:59 = 날짜만 (하루 종일 개념)', () => {
    expect(formatKoreanDateTimeDisplay('2026-07-29T14:59:00.000Z')).toBe('2026. 7. 29');
  });

  test('날짜만(YYYY-MM-DD) = 시간대 해석 없이 그대로', () => {
    expect(formatKoreanDateTimeDisplay('2026-07-30')).toBe('2026. 7. 30');
  });

  test('파싱 불가 손입력은 원문 보존', () => {
    expect(formatKoreanDateTimeDisplay('7월 말까지 매장 문의')).toBe('7월 말까지 매장 문의');
  });

  test('빈 값은 빈 문자열', () => {
    expect(formatKoreanDateTimeDisplay('')).toBe('');
    expect(formatKoreanDateTimeDisplay(null)).toBe('');
  });
});

describe('normalizeWebUrl — 스킴 없는 URL https:// 정규화 (2026-07-02 이메일 링크 이동 안 됨 신고)', () => {
  test('www. 도메인형에 https:// 부착', () => {
    expect(normalizeWebUrl('www.poppon.co.kr')).toBe('https://www.poppon.co.kr');
  });

  test('경로/쿼리 포함 도메인형도 부착', () => {
    expect(normalizeWebUrl('poppon.co.kr/event?x=1')).toBe('https://poppon.co.kr/event?x=1');
  });

  test('기존 http/https는 그대로', () => {
    expect(normalizeWebUrl('https://www.poppon.co.kr')).toBe('https://www.poppon.co.kr');
    expect(normalizeWebUrl('http://a.b')).toBe('http://a.b');
  });

  test('mailto:/tel:/#앵커/상대경로는 그대로', () => {
    expect(normalizeWebUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeWebUrl('tel:01012345678')).toBe('tel:01012345678');
    expect(normalizeWebUrl('#top')).toBe('#top');
    expect(normalizeWebUrl('/api/dm/v/dm-abc')).toBe('/api/dm/v/dm-abc');
  });

  test('개인화 변수 포함 URL은 손대지 않음', () => {
    expect(normalizeWebUrl('{{ customer.link }}')).toBe('{{ customer.link }}');
  });

  test('도메인형이 아닌 일반 문자열은 그대로 (하위 호환 — 소비처가 기존대로 걸러냄)', () => {
    expect(normalizeWebUrl('hello')).toBe('hello');
  });

  test('빈 값/공백은 빈 문자열', () => {
    expect(normalizeWebUrl('')).toBe('');
    expect(normalizeWebUrl('   ')).toBe('');
    expect(normalizeWebUrl(null)).toBe('');
    expect(normalizeWebUrl(undefined)).toBe('');
  });
});

describe('normalizeOpt080Input — 080 수신거부번호 입력 정규화 (빈값/공백=삭제)', () => {
  test('빈 문자열은 null(삭제 의도)', () => {
    expect(normalizeOpt080Input('')).toBe(null);
  });

  test('공백만 있어도 null(삭제)', () => {
    expect(normalizeOpt080Input('   ')).toBe(null);
  });

  test('null/undefined는 null', () => {
    expect(normalizeOpt080Input(null)).toBe(null);
    expect(normalizeOpt080Input(undefined)).toBe(null);
  });

  test('정상 번호는 그대로 유지', () => {
    expect(normalizeOpt080Input('0807196700')).toBe('0807196700');
  });

  test('앞뒤 공백은 제거', () => {
    expect(normalizeOpt080Input('  080-348-3600  ')).toBe('080-348-3600');
  });
});
