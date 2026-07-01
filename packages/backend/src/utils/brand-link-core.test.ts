/**
 * brand-link-core 순수 함수 테스트 — DB import 0 (config/database 미의존).
 */
import { describe, it, expect } from 'vitest';
import {
  LINK_PLACEHOLDER,
  applyBrandLinkTokens,
  hasUneditedLinkPlaceholder,
  scanLinkHabit,
  buildBrandLinkPromptSection,
  type BrandLink,
} from './brand-link-core';

const LINKS: BrandLink[] = [
  { label: '공식몰', url: 'https://shop.example.com' },
  { label: '쿠폰함', url: 'https://shop.example.com/coupon' },
];

describe('applyBrandLinkTokens', () => {
  it('등록 라벨 토큰을 실제 URL로 치환한다', () => {
    const r = applyBrandLinkTokens('쿠폰 사용하러 가기>\n{{LINK:공식몰}}', LINKS);
    expect(r.text).toBe('쿠폰 사용하러 가기>\nhttps://shop.example.com');
    expect(r.replacedCount).toBe(1);
    expect(r.unresolvedCount).toBe(0);
  });

  it('토큰 안 공백을 허용한다', () => {
    const r = applyBrandLinkTokens('{{ LINK : 쿠폰함 }}', LINKS);
    expect(r.text).toBe('https://shop.example.com/coupon');
  });

  it('미등록 라벨은 placeholder로 바꾸고 unresolved로 집계한다', () => {
    const r = applyBrandLinkTokens('{{LINK:이벤트관}}', LINKS);
    expect(r.text).toBe(LINK_PLACEHOLDER);
    expect(r.unresolvedCount).toBe(1);
  });

  it('링크 미등록 회사는 모든 토큰이 placeholder가 된다', () => {
    const r = applyBrandLinkTokens('가기>\n{{LINK:공식몰}}', []);
    expect(r.text).toBe(`가기>\n${LINK_PLACEHOLDER}`);
    expect(r.unresolvedCount).toBe(1);
  });

  it('토큰이 없으면 원문 그대로', () => {
    const r = applyBrandLinkTokens('일반 문안입니다.', LINKS);
    expect(r.text).toBe('일반 문안입니다.');
    expect(r.replacedCount).toBe(0);
    expect(r.unresolvedCount).toBe(0);
  });

  it('같은 문안 안 여러 토큰을 모두 치환한다', () => {
    const r = applyBrandLinkTokens('{{LINK:공식몰}} / {{LINK:쿠폰함}}', LINKS);
    expect(r.text).toBe('https://shop.example.com / https://shop.example.com/coupon');
    expect(r.replacedCount).toBe(2);
  });
});

describe('hasUneditedLinkPlaceholder', () => {
  it('placeholder 잔존을 감지한다', () => {
    expect(hasUneditedLinkPlaceholder(`본문\n${LINK_PLACEHOLDER}`)).toBe(true);
  });
  it('치환 안 된 토큰 잔존을 감지한다', () => {
    expect(hasUneditedLinkPlaceholder('본문 {{LINK:공식몰}}')).toBe(true);
  });
  it('정상 문안은 false', () => {
    expect(hasUneditedLinkPlaceholder('본문 https://shop.example.com')).toBe(false);
    expect(hasUneditedLinkPlaceholder('')).toBe(false);
  });
});

describe('scanLinkHabit', () => {
  it('과반 문안이 끝에 URL을 넣으면 body_end 습관', () => {
    const habit = scanLinkHabit([
      '(광고) 문안1\n혜택 안내\n지금 확인>\nhttps://a.com/x',
      '(광고) 문안2\n본문\nhttps://a.com/y',
      '(광고) 문안3 링크 없음',
    ]);
    expect(habit.uses_url).toBe(true);
    expect(habit.position).toBe('body_end');
    expect(habit.avg_urls_per_message).toBe(1);
  });

  it('URL 없는 회사는 uses_url=false, position=none', () => {
    const habit = scanLinkHabit(['문안1', '문안2']);
    expect(habit.uses_url).toBe(false);
    expect(habit.position).toBe('none');
  });

  it('소수 문안만 URL이면 습관 아님', () => {
    const habit = scanLinkHabit(['a', 'b', 'c', 'd https://a.com']);
    expect(habit.uses_url).toBe(false);
  });

  it('빈 입력은 none', () => {
    const habit = scanLinkHabit([]);
    expect(habit.uses_url).toBe(false);
    expect(habit.position).toBe('none');
  });
});

describe('buildBrandLinkPromptSection', () => {
  it('등록 링크가 있으면 토큰 규칙 + 라벨 목록을 담는다', () => {
    const s = buildBrandLinkPromptSection(LINKS, { uses_url: true, position: 'body_end', avg_urls_per_message: 1 });
    expect(s).toContain('{{LINK:공식몰}}');
    expect(s).toContain('{{LINK:쿠폰함}}');
    expect(s).toContain('URL을 직접 작성');
  });

  it('링크 0 + 습관 없음이면 빈 문자열', () => {
    expect(buildBrandLinkPromptSection([], null)).toBe('');
    expect(buildBrandLinkPromptSection([], { uses_url: false, position: 'none', avg_urls_per_message: 0 })).toBe('');
  });

  it('링크 0 + 링크 습관 있으면 placeholder 지시를 담는다', () => {
    const s = buildBrandLinkPromptSection([], { uses_url: true, position: 'body_end', avg_urls_per_message: 1 });
    expect(s).toContain(LINK_PLACEHOLDER);
  });
});
