/**
 * dm-custom-short-link-core.test.ts — 커스텀 단축 URL 검증(도메인 평판 보호) 순수 테스트 (2026-07-10)
 * 오픈 리다이렉터 차단이 hlj.kr 평판(기존 DM 링크 도달률)을 지키는 1차 방어선 — 화이트리스트 클래스 고정.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCustomShortLinkUrl,
  normalizeCustomLinkTitle,
  CUSTOM_LINK_URL_MAX,
  CUSTOM_LINK_TITLE_MAX,
} from '../dm-custom-short-link-core';

describe('validateCustomShortLinkUrl — 허용', () => {
  it('정상 https/http 공개 도메인', () => {
    expect(validateCustomShortLinkUrl('https://shop.example.com/event/july?utm=dm').ok).toBe(true);
    expect(validateCustomShortLinkUrl('http://example.co.kr/mdm/1').ok).toBe(true);
  });
  it('앞뒤 공백은 trim 후 통과 + 정규화 URL 반환', () => {
    const r = validateCustomShortLinkUrl('  https://example.com/page  ');
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://example.com/page');
  });
});

describe('validateCustomShortLinkUrl — 차단 (도메인 평판 보호)', () => {
  it('빈 값·비문자열·형식 오류', () => {
    expect(validateCustomShortLinkUrl('').ok).toBe(false);
    expect(validateCustomShortLinkUrl(undefined).ok).toBe(false);
    expect(validateCustomShortLinkUrl('example.com/page').ok).toBe(false); // 프로토콜 없음
    expect(validateCustomShortLinkUrl('not a url').ok).toBe(false);
  });
  it('http/https 외 스킴 (javascript·data·ftp)', () => {
    expect(validateCustomShortLinkUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateCustomShortLinkUrl('data:text/html,hi').ok).toBe(false);
    expect(validateCustomShortLinkUrl('ftp://example.com/f').ok).toBe(false);
  });
  it('자기 도메인 재단축(루프) 금지', () => {
    expect(validateCustomShortLinkUrl('https://hlj.kr/abcd1234').ok).toBe(false);
    expect(validateCustomShortLinkUrl('https://hanjul.ai/api/dm/v/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl('https://app.hanjul.ai/c/hash').ok).toBe(false);
  });
  it('내부망/IP 리터럴/localhost 세탁 금지', () => {
    expect(validateCustomShortLinkUrl('http://localhost:3000/admin').ok).toBe(false);
    expect(validateCustomShortLinkUrl('http://127.0.0.1/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl('http://192.168.0.10/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl('http://[::1]/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl('http://server.internal/x').ok).toBe(false);
  });
  it('인증 정보(@) 포함 URL 금지 (호스트 위장)', () => {
    expect(validateCustomShortLinkUrl('https://user:pw@example.com/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl('https://hanjul.ai@evil.com/x').ok).toBe(false);
  });
  it('점 없는 호스트·길이 상한', () => {
    expect(validateCustomShortLinkUrl('http://intranet/x').ok).toBe(false);
    expect(validateCustomShortLinkUrl(`https://example.com/${'a'.repeat(CUSTOM_LINK_URL_MAX)}`).ok).toBe(false);
  });
  it('차단 사유는 사용자 노출 문구 동봉', () => {
    const r = validateCustomShortLinkUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect((r.reason || '').length).toBeGreaterThan(0);
  });
});

describe('validateCustomShortLinkUrl — 우회 벡터 (Codex 적대 리뷰 공격면 고정, Node 파서 정규화 실측 2026-07-10)', () => {
  it('숫자형/8진/16진 IP 리터럴 = 파서가 127.0.0.1로 정규화 → 차단', () => {
    expect(validateCustomShortLinkUrl('http://2130706433/x').ok).toBe(false);     // decimal
    expect(validateCustomShortLinkUrl('http://127.1/x').ok).toBe(false);          // 축약
    expect(validateCustomShortLinkUrl('http://0x7f000001/x').ok).toBe(false);     // hex
    expect(validateCustomShortLinkUrl('http://0177.0.0.1/x').ok).toBe(false);     // octal
  });
  it('스킴 상대(//host) = 파서 거부(절대 URL 아님) → 차단', () => {
    expect(validateCustomShortLinkUrl('//evil.com/x').ok).toBe(false);
  });
  it('퍼센트 인코딩 자기 도메인(hlj%2Ekr) = 파서가 hlj.kr로 정규화 → 차단', () => {
    expect(validateCustomShortLinkUrl('http://hlj%2Ekr/abcd').ok).toBe(false);
    expect(validateCustomShortLinkUrl('https://HLJ.KR/abcd').ok).toBe(false); // 대소문자
  });
  it('백슬래시 스킴(https:\\\\host) = 파서가 일반 외부 도메인으로 정규화 → 허용(외부 URL 단축이 본 기능)', () => {
    expect(validateCustomShortLinkUrl('https:\\\\shop.example.com/x').ok).toBe(true);
  });
});

describe('normalizeCustomLinkTitle', () => {
  it('빈 값/비문자열 = null, 초과분 잘라냄', () => {
    expect(normalizeCustomLinkTitle('')).toBeNull();
    expect(normalizeCustomLinkTitle('   ')).toBeNull();
    expect(normalizeCustomLinkTitle(123)).toBeNull();
    expect(normalizeCustomLinkTitle(' 7월 MDM ')).toBe('7월 MDM');
    expect(normalizeCustomLinkTitle('x'.repeat(200))).toHaveLength(CUSTOM_LINK_TITLE_MAX);
  });
});

// ★ 2026-07-15 한글 주소(사용자 지정 slug) 검증 — Harold 확정 (이새 vo.la/반짝이새_07 사례)
import { validateCustomSlug, CUSTOM_SLUG_MIN, CUSTOM_SLUG_MAX } from '../dm-custom-short-link-core';

describe('validateCustomSlug — 허용', () => {
  it('한글·영문·숫자·하이픈·언더스코어 조합', () => {
    expect(validateCustomSlug('반짝이새_07').ok).toBe(true);
    expect(validateCustomSlug('여름세일-2026').ok).toBe(true);
    expect(validateCustomSlug('event01').ok).toBe(true);
    expect(validateCustomSlug('세일').ok).toBe(true); // 최소 2자
  });
  it('앞뒤 공백 trim + NFC 정규화된 slug 반환', () => {
    const r = validateCustomSlug('  반짝세일_07  ');
    expect(r.ok).toBe(true);
    expect(r.slug).toBe('반짝세일_07');
  });
  it('NFD(자소 분리) 입력도 NFC로 정규화 — iOS 대비', () => {
    const nfd = '반짝세일'.normalize('NFD');
    const r = validateCustomSlug(nfd);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe('반짝세일'.normalize('NFC'));
    expect(r.slug!.normalize('NFC')).toBe(r.slug); // 저장값 = NFC 고정
  });
  it('경계 길이 = MIN/MAX 통과', () => {
    expect(validateCustomSlug('가'.repeat(CUSTOM_SLUG_MIN)).ok).toBe(true);
    expect(validateCustomSlug('가'.repeat(CUSTOM_SLUG_MAX)).ok).toBe(true);
  });
});

describe('validateCustomSlug — 차단', () => {
  it('빈 값·비문자열·공백 포함', () => {
    expect(validateCustomSlug('').ok).toBe(false);
    expect(validateCustomSlug(undefined).ok).toBe(false);
    expect(validateCustomSlug('반짝 세일').ok).toBe(false);
  });
  it('길이 초과/미달', () => {
    expect(validateCustomSlug('가').ok).toBe(false);
    expect(validateCustomSlug('가'.repeat(CUSTOM_SLUG_MAX + 1)).ok).toBe(false);
  });
  it('허용 외 문자 (점·슬래시·이모지·괄호·퍼센트)', () => {
    expect(validateCustomSlug('세일.07').ok).toBe(false);
    expect(validateCustomSlug('세일/07').ok).toBe(false);
    expect(validateCustomSlug('세일(7월)').ok).toBe(false);
    expect(validateCustomSlug('세일%07').ok).toBe(false);
  });
  it('내부 경로 예약어 + dm- 프리픽스(뷰어 코드 충돌)', () => {
    expect(validateCustomSlug('api').ok).toBe(false);
    expect(validateCustomSlug('admin').ok).toBe(false);
    expect(validateCustomSlug('DM-abc').ok).toBe(false);
    expect(validateCustomSlug('dm-세일').ok).toBe(false);
  });
});
