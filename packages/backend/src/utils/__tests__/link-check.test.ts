/**
 * 링크 검사 계약 (★2026-09-22 신설 · 0922 접수 = 버튼·쿠폰 링크 `invitocorp.cpm` 오타로 발송 3건 사망)
 *
 * 못 박는 것
 *   1. 실존하지 않는 최상위 도메인은 사유와 함께 막는다(`.cpm` → `.com` 제안까지).
 *   2. **판정하지 않는 것은 통과시킨다** — 오탐이 멀쩡한 발송을 세우는 쪽이 더 나쁘다.
 *      변수·빈 값·IP·점 없는 호스트·파싱 불가·한글 도메인이 여기 든다.
 *   3. 스킴 검사와 TLD 검사가 한 함수에서 같은 순서로 나온다(화면과 서버가 같은 문구를 쓴다).
 */
import { describe, it, expect } from 'vitest';
import { webLinkReason, unknownTldOf, suggestTld, findLinkDefectInText, findLinkDefectDeep } from '../normalize';
import { KNOWN_TLDS, TLD_LIST_VERSION } from '../tld-list';

describe('TLD 원장', () => {
  it('IANA 목록을 담고 있다', () => {
    expect(TLD_LIST_VERSION).toMatch(/^\d{10}$/);
    expect(KNOWN_TLDS.size).toBeGreaterThan(1000);
    for (const t of ['com', 'net', 'org', 'kr', 'io', 'co', 'shop', 'store']) {
      expect(KNOWN_TLDS.has(t), `${t}는 실존 TLD다`).toBe(true);
    }
  });

  it('오타 TLD는 들어 있지 않다', () => {
    for (const t of ['cpm', 'cmo', 'con', 'vom', 'nte', 'ogr']) {
      expect(KNOWN_TLDS.has(t), `${t}는 실존하지 않는다`).toBe(false);
    }
  });

  it('한글·퓨니코드 TLD도 담는다 (한글 도메인을 오탐하지 않으려면 필요하다)', () => {
    expect(KNOWN_TLDS.has('xn--3e0b707e'), '.한국').toBe(true);
    expect(KNOWN_TLDS.has('xn--mk1bu44c'), '.닷컴').toBe(true);
  });
});

describe('unknownTldOf — 모르는 TLD만 집어낸다', () => {
  it('오타를 잡는다', () => {
    expect(unknownTldOf('https://invitocorp.cpm')).toBe('cpm');
    expect(unknownTldOf('https://www.naver.cmo/path?a=1')).toBe('cmo');
    expect(unknownTldOf('HTTPS://SHOP.EXAMPLE.CON')).toBe('con');
  });

  it('정상 주소는 통과한다', () => {
    for (const u of [
      'https://invitocorp.com',
      'http://www.naver.co.kr/event?x=1#top',
      'https://shop.example.com:8443/p/1',
      'https://a.io',
      'https://xn--hq1bm8jm9l.xn--3e0b707e',   // 한글 도메인(퓨니코드)
    ]) {
      expect(unknownTldOf(u), u).toBe('');
    }
  });

  it('한글 주소를 그대로 넣어도 통과한다 (URL이 퓨니코드로 바꿔 준다)', () => {
    expect(unknownTldOf('https://한국닷컴.한국')).toBe('');
  });

  it('판정 대상이 아닌 값은 전부 통과한다', () => {
    for (const u of [
      '', '   ', null, undefined,
      '#{상품링크}',                    // 개인화 변수
      'www.naver.com',                 // 스킴 없음 = 형식 검사가 소유
      'https://localhost:3000/x',      // 점 없는 호스트
      'https://192.168.0.1/admin',     // IPv4
      'https://[::1]:8080/x',          // IPv6
      'https://',                      // 파싱은 되지만 호스트가 없다
    ]) {
      expect(unknownTldOf(u as any), String(u)).toBe('');
    }
  });
});

describe('suggestTld — 가장 가까운 실존 TLD', () => {
  it('흔한 오타를 되돌린다', () => {
    expect(suggestTld('cpm')).toBe('com');
    expect(suggestTld('cmo')).toBe('com');
    expect(suggestTld('con')).toBe('com');
    expect(suggestTld('ogr')).toBe('org');
    expect(suggestTld('nte')).toBe('net');
  });

  it('가까운 것이 없으면 비워 둔다 (엉뚱한 안내를 하지 않는다)', () => {
    expect(suggestTld('zzzzzzzzzz')).toBe('');
    expect(suggestTld('')).toBe('');
  });
});

describe('webLinkReason — 화면·서버가 함께 쓰는 사유 문구', () => {
  it('0922 접수 그대로 재현한다', () => {
    const r = webLinkReason('https://invitocorp.cpm', '버튼 링크는');
    expect(r).toBe("버튼 링크는 주소 끝이 '.cpm'인데 그런 도메인은 없습니다. 혹시 '.com'인가요?");
  });

  it('정상 주소·변수·빈 값은 통과한다', () => {
    expect(webLinkReason('https://invitocorp.com', '버튼 링크는')).toBe('');
    expect(webLinkReason('#{상품링크}')).toBe('');
    expect(webLinkReason('{{ customer.link }}')).toBe('');
    expect(webLinkReason('')).toBe('');
  });

  it('스킴이 없으면 그 사유가 먼저 나온다', () => {
    expect(webLinkReason('www.naver.com', '버튼 링크는')).toContain('http:// 또는 https://');
  });

  it('자리 이름을 앞에 붙인다', () => {
    expect(webLinkReason('naver.com', '쿠폰 주소는').startsWith('쿠폰 주소는')).toBe(true);
  });
});

describe('findLinkDefectInText — 본문 글 속의 링크', () => {
  it('본문에 섞인 오타 주소를 잡는다', () => {
    const r = findLinkDefectInText('오늘만 특가! https://shop.example.cpm 에서 확인하세요');
    expect(r).toContain('.cpm');
    expect(r).toContain("혹시 '.com'인가요?");
  });

  it('★한글이 바로 붙어도 주소를 정확히 끊는다 (여기서 삼키면 멀쩡한 주소가 오타가 된다)', () => {
    expect(findLinkDefectInText('자세히는 https://invitocorp.com입니다. 감사합니다')).toBe('');
    expect(findLinkDefectInText('https://invitocorp.com에서 확인')).toBe('');
    expect(findLinkDefectInText('링크: https://invitocorp.com, 문의는 전화로')).toBe('');
  });

  it('링크가 없거나 정상이면 통과한다', () => {
    expect(findLinkDefectInText('안녕하세요 오늘 행사 안내입니다')).toBe('');
    expect(findLinkDefectInText('https://naver.com 과 https://daum.net 둘 다')).toBe('');
    expect(findLinkDefectInText('')).toBe('');
    expect(findLinkDefectInText(null)).toBe('');
  });

  it('여러 개 중 첫 결함을 돌려준다', () => {
    const r = findLinkDefectInText('https://a.com 정상 뒤에 https://b.cpm 오타');
    expect(r).toContain('.cpm');
  });
});

describe('findLinkDefectDeep — 객체 트리 안의 링크', () => {
  it('키 이름을 몰라도 값으로 찾는다', () => {
    expect(findLinkDefectDeep({ sections: [{ props: { cta_url: 'https://a.cpm' } }] })).toContain('.cpm');
    expect(findLinkDefectDeep({ buttonList: [{ urlMobile: 'https://a.com' }] })).toBe('');
  });

  it('주소가 아닌 문자열은 건드리지 않는다', () => {
    expect(findLinkDefectDeep({ name: '가을 세일', memo: 'a.cpm 이라고 적어둠' })).toBe('');
  });

  it('깊이가 지나치면 멈춘다 (순환·과도한 중첩 방어)', () => {
    let deep: any = 'https://a.cpm';
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(findLinkDefectDeep(deep)).toBe('');
  });
});
