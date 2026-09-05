/**
 * sales-outreach-exemplar-mask.test.ts — 실물 → 마스킹 예시 변환 CT 행동 테스트 (2026-09-05 · 설계서 §20 · 적대 리뷰 8건 정정 고정)
 * 고정하는 것: 별칭 자동 추출(브랜드 필드 전량 · 자유 제목은 첫 토큰·라틴만 · 직원 표기 제외) · 법정 영역(footer.notes·legal_text) 미탑재 ·
 * 상품명은 name·caption 전량 〔상품〕 + 본문 어디서든(띄어쓰기 무시 · 토큰) · 표식 보호(안쪽 재치환 0) · 구분자 없는 전화·유니코드 이메일·무스킴 도메인 ·
 * 사업자·신고번호·주소·대표자 · 한글 짧은 별칭 앞 경계 · 위생 검사는 마스킹보다 넓다(fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveBrandAliases, extractLegalEntityNames, collectProductNames, maskExemplarText, buildExemplarBody, withExemplarHeader, checkExemplarHygiene, EXEMPLAR_MASK,
} from '../sales-outreach-exemplar-mask';

const sections = [
  { type: 'header', props: { brand_name: 'BEAUTY OF JOSEON', variant: 'logo' } },
  { type: 'hero', props: { headline: '조선미녀 붉은팥 PDRN 모공탄력 세럼 출시', sub_copy: '%고객명%님을 위한 초대', image_url: 'https://cdn.x/a.jpg' } },
  { type: 'product_carousel', props: { title: '지금 인기', products: [
    { name: '붉은팥 PDRN 모공탄력 세럼 30mL', price: 32000, link_url: 'https://x' },
    { name: '맑은쌀 선크림 50mL', price: 18000 },
    { name: 'A', price: 1 }, { name: 'B', price: 1 }, { name: 'C', price: 1 }, { name: 'D', price: 1 },
  ] } },
  { type: 'gallery', props: { images: [{ url: 'https://x/1.jpg', caption: '꺼먹살이 인형키링 13cm' }] } },
  { type: 'text_card', props: { tag: '혜택', headline: '전 품목 30% 할인', body: '붉은팥 PDRN 모공탄력 세럼 붓기는 쏙. 9월 30일까지 무료배송. 문의 1588-1234 또는 help@joseon.co.kr' } },
  { type: 'footer', props: { notes: '대표 이선정 | 사업자등록번호 809-81-01574 주소 (04323) 서울특별시 용산구 한강대로 372, 24층 (동자동, KDB타워) 통신판매업신고번호 2019-서울용산-1428', legal_text: '(주)조선미녀 대표 홍길동 사업자등록번호 123-45-67890', cs_phone: '1588-1234' } },
];

describe('deriveBrandAliases · extractLegalEntityNames', () => {
  it('브랜드 필드는 전량, 자유 제목은 첫 토큰·라틴만, 직원 표기는 버린다 · 긴 것부터', () => {
    const a = deriveBrandAliases({ title: '조선미녀(임은지1)', storeName: '조선미녀 공식몰', companyName: '주식회사 인비토', sections });
    expect(a).toContain('조선미녀');
    expect(a).toContain('BEAUTY OF JOSEON');
    expect(a).toContain('인비토');
    expect(a.some((x) => x.includes('임은지'))).toBe(false);
    expect(a).not.toContain('공식몰');
    expect(a[0].length).toBeGreaterThanOrEqual(a[a.length - 1].length);
  });
  it('자유 제목의 일반 명사(코트·고객님)는 별칭이 되지 않는다 · 괄호 안 브랜드 표기(3CE)는 남는다', () => {
    const a = deriveBrandAliases({ title: '가을 신상 코트 특가 고객님을 위한 선물' });
    expect(a).not.toContain('코트');
    expect(a).not.toContain('고객님을');
    expect(a).not.toContain('선물');
    const b = deriveBrandAliases({ title: '난다(3CE)(임은지3)' });
    expect(b).toEqual(expect.arrayContaining(['3CE', '난다']));
    expect(deriveBrandAliases({ title: '덴프스(에이치피오)' })).toEqual(expect.arrayContaining(['덴프스', '에이치피오']));
    expect(deriveBrandAliases({ title: '폴라초이스 좋은 피부를 위한 선택' })).toContain('폴라초이스');
  });
  it('법인명 패턴', () => {
    expect(extractLegalEntityNames('(주)이랜드월드 패션사업부 | 대표 홍길동')).toEqual(['이랜드월드']);
    expect(extractLegalEntityNames('쿠팡(주) 사업자등록번호 120-88-00767')).toEqual(['쿠팡']);
    expect(extractLegalEntityNames('상호 주식회사이폴리움 통신판매업신고')).toEqual(expect.arrayContaining(['이폴리움']));
  });
});

describe('maskExemplarText', () => {
  const aliases = deriveBrandAliases({ title: '조선미녀(임은지1)', sections });
  const productNames = collectProductNames(sections);
  it('상품명은 name·caption에서 모이고, 본문 어디서든(띄어쓰기 무시 · 토큰) 가린다 · 일반어(세럼)는 남긴다', () => {
    expect(productNames).toContain('꺼먹살이 인형키링 13cm');
    expect(productNames[0]).toBe('붉은팥 PDRN 모공탄력 세럼 30mL');
    const t = maskExemplarText('붉은팥 PDRN 모공탄력 세럼 붓기는 쏙 · 붉은팥PDRN세럼 재입고 · 꺼먹살이 키링', { aliases, productNames });
    expect(t).not.toMatch(/붉은팥|PDRN|모공탄력|꺼먹살이/);
    expect(t).toContain('세럼');
    expect(t).toContain(EXEMPLAR_MASK.product);
  });
  it('구조 토큰: 별칭(대소문자) · 링크(무스킴 도메인 포함) · 유니코드 이메일 · 구분자 없는 전화 · 변수 토큰 · 혜택 · 날짜(9/30까지)', () => {
    const t = maskExemplarText('beauty of joseon 조선미녀 https://a.b/c joseon.co.kr/event 01012345678 010 1234 5678 1588-1234 %고객명%님 #{이름} 9/30까지 30% 할인 고객@joseon.co.kr 2026-09-30 24/7 상담', { aliases, productNames });
    expect(t).not.toMatch(/joseon|조선미녀|https|co\.kr|1588|0101234|1234 5678|%고객명%|#\{|30%|2026-09-30/i);
    expect(t).not.toContain('9/30');
    expect(t).toContain('24/7 상담'); // 날짜가 아닌 숫자쌍은 남긴다
    for (const m of [EXEMPLAR_MASK.brand, EXEMPLAR_MASK.link, EXEMPLAR_MASK.phone, EXEMPLAR_MASK.customer, EXEMPLAR_MASK.benefit, EXEMPLAR_MASK.date, EXEMPLAR_MASK.email]) expect(t).toContain(m);
    expect(t).not.toMatch(/〔브랜드〕\s*〔브랜드〕/);
  });
  it('표식 보호 — 별칭·상품 토큰이 이미 넣은 표식 안쪽을 뚫지 않는다', () => {
    const t = maskExemplarText('%고객명%님 안녕하세요, 여름 상품 안내', { aliases: ['고객', '여름 상품'], productNames: ['상품'] });
    expect(t).toContain('〔고객명〕님');
    expect(t).not.toMatch(/〔〔|〕〕/);
  });
  it('한글 짧은 별칭은 앞 글자 경계(다른 단어 안 관통 금지) · 라틴 별칭은 단어 경계', () => {
    const t = maskExemplarText('하나인 것처럼 나인 매장 · 나인은 · MUSINSA musinsa2 AMUSINSA', { aliases: ['나인', 'MUSINSA'], productNames: [] });
    expect(t).toContain('하나인 것처럼');
    expect(t).toContain('〔브랜드〕 매장');
    expect(t).toContain('〔브랜드〕은');
    expect(t).toContain('AMUSINSA');
    expect(t).toContain('musinsa2');
    expect(t.match(/〔브랜드〕/g)!.length).toBe(3);
  });
  it('사업자·신고번호·주소·대표자 실명', () => {
    const t = maskExemplarText('대표 이선정 | 사업자등록번호 809-81-01574 주소 (04323) 서울특별시 용산구 한강대로 372, 24층 (동자동, KDB타워) 통신판매업신고번호 2019-서울용산-1428', { aliases: [], productNames: [] });
    expect(t).not.toMatch(/이선정|809-81|서울특별시|한강대로|24층|2019-서울용산|04323/);
    expect(t).toContain(EXEMPLAR_MASK.number);
    expect(t).toContain(EXEMPLAR_MASK.address);
    expect(t).toContain(`대표 ${EXEMPLAR_MASK.name}`);
  });
});

describe('buildExemplarBody · withExemplarHeader', () => {
  const aliases = deriveBrandAliases({ title: '조선미녀', sections });
  const productNames = collectProductNames(sections);
  it('형식: 번호+type · name·caption=〔상품〕 · 배열 4개 + 외 N · 법정 영역(footer.notes·legal_text·cs_phone·brand_name) 미탑재 · 제목은 첫 줄', () => {
    const body = buildExemplarBody(sections, { aliases, productNames }, '조선미녀 모공탄력 초대장');
    expect(body.startsWith('제목: ')).toBe(true);
    expect(body).toContain('  1. header');
    expect(body).toContain('  2. hero');
    expect(body.match(/name: 〔상품〕/g)).toHaveLength(4);
    expect(body).toContain('caption: 〔상품〕');
    expect(body).toContain('(… 외 2)');
    expect(body).not.toMatch(/legal_text|cs_phone|brand_name|notes:/);
    expect(body).not.toMatch(/BEAUTY|조선미녀|붉은팥|이선정|809-81|https:\/\//);
    const headed = withExemplarHeader(body, 'EMAIL', 'beauty');
    expect(headed.startsWith('[예시 · EMAIL · beauty] 제목: ')).toBe(true);
    expect(withExemplarHeader('  1. header', 'DM', 'fashion').startsWith('[예시 · DM · fashion]\n  1. header')).toBe(true);
  });
});

describe('checkExemplarHygiene (마스킹보다 넓은 탐지기 · fail-closed)', () => {
  it('마스킹 본문은 통과', () => {
    const aliases = deriveBrandAliases({ title: '조선미녀', sections });
    const body = buildExemplarBody(sections, { aliases, productNames: collectProductNames(sections) });
    expect(checkExemplarHygiene(body, aliases)).toEqual({ ok: true, violations: [] });
  });
  it('마스킹이 놓친 형태도 잡는다 — 무스킴 도메인 · 아이디 · 긴 숫자열 · 신고번호 · 주소 · 대표자 · 변수 · 할인율 · 금액 · 별칭(띄어쓰기 무시) · 모델명 · 짧은 본문', () => {
    const r = checkExemplarHygiene('  1. hero\n    headline: joseon.co.kr 문의 help@x 01012345678 809-81-01574 2019-서울용산-1428 서울특별시 용산구 한강대로 대표 이선정 {{이름}} 30% 12,000원 BEAUTYOFJOSEON claude 안내', ['BEAUTY OF JOSEON']);
    expect(r.ok).toBe(false);
    expect(r.violations).toEqual(expect.arrayContaining([
      '링크·도메인 잔존', '이메일·아이디 잔존', '긴 숫자열(연락처·사업자번호 가능) 잔존', '통신판매업 신고번호 잔존', '주소 잔존',
      '대표자 실명 잔존', '변수 토큰 잔존', '할인율 잔존', '금액 잔존', '브랜드 별칭 잔존: BEAUTY OF JOSEON', '모델명 잔존',
    ]));
    expect(checkExemplarHygiene('짧음', []).ok).toBe(false);
  });
  it('표식 자체는 위반이 아니다', () => {
    const ok = checkExemplarHygiene(`  1. hero\n    headline: 〔브랜드〕 〔상품〕 〔혜택〕 〔링크〕 〔연락처〕 〔날짜〕 〔고객명〕 〔번호〕 〔주소〕 대표 〔이름〕 안내 문구가 이어집니다`, ['조선미녀']);
    expect(ok).toEqual({ ok: true, violations: [] });
  });
});
