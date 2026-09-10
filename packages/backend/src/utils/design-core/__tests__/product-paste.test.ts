/**
 * ★ 2026-07-14 — 상품 붙여넣기 파서(FE utils/product-paste — 이메일·DM 공용 편집기 소비) 교차 패키지 고정.
 * 결정적 파서: 붙여넣은 숫자·URL만 그대로(창작 불가). Harold 실사용 형식이 대표 케이스.
 */
import { describe, it, expect } from 'vitest';
import { parsePastedProducts } from '../../../../../frontend/src/utils/product-paste';

const HAROLD_FORMAT = `여름 스킨케어 특별전 — 전 품목 15%
글로우 파운데이션 30ml
85,000원 → 15% 72,250원
https://store.example.com/products/9090905782

[2+1 증정] 수분 선크림 세트
134,000원 → 15% 113,900원
https://store.example.com/products/6858932018

싱크로 글로우 쿠션 컴팩트 세트
64,000원 → 15% 54,400원
https://store.example.com/products/5558104855`;

describe('parsePastedProducts', () => {
  it('대표 형식 — 3상품 이름·정가·할인가·할인율·링크 전부', () => {
    const out = parsePastedProducts(HAROLD_FORMAT);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({
      name: '글로우 파운데이션 30ml', price: 85000, discount_price: 72250, discount_rate: 15,
      link_url: 'https://store.example.com/products/9090905782',
    });
    expect(out[1].name).toContain('[2+1 증정]');
    expect(out[2].discount_price).toBe(54400);
  });

  it('행사 제목 줄(가격·링크 없음)은 상품으로 세지 않음', () => {
    const out = parsePastedProducts('겨울 감사제\n상품 A\n10,000원\nhttps://a.example.com/1');
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('상품 A');
  });

  it('가격 없이 이름+링크만도 인정 / 링크 없는 상품도 인정', () => {
    const out = parsePastedProducts('상품 A\nhttps://a.example.com/1\n\n상품 B\n5,000원');
    expect(out.length).toBe(2);
    expect(out[0].link_url).toBe('https://a.example.com/1');
    expect(out[0].price).toBeUndefined();
    expect(out[1].price).toBe(5000);
    expect(out[1].link_url).toBeUndefined();
  });

  it('할인가가 정가보다 크면 무시 + 최대 8개 상한 + 빈 입력 = 0개 (기존 규칙 보존)', () => {
    expect(parsePastedProducts('상품 A\n10,000원 → 20,000원')[0].discount_price).toBeUndefined();
  });
});

/**
 * ★2026-09-10 가격은 줄 끝에서 찾는다 (임은지 접수 cmttecy030bzejnotrwhqhzeh · 탭 카드 상품 목록 "가격만 보인다").
 *   옛 규칙은 "원"이 붙은 숫자만 가격으로 봐서, "35,000"을 새 상품명으로 읽고 진짜 이름은 버렸다.
 *   한 줄에 "이름 35,000원"을 쓰면 상품이 통째로 사라졌다(가격줄로 읽혔는데 받을 상품이 없어서).
 */
describe('parsePastedProducts — 가격은 줄 끝에서 찾는다 (★0910)', () => {
  const U = 'https://www.hera.com/product/x';

  it('접수 그대로: 이름 / 35,000 / 주소 = 이름 + 가격 35,000 + 링크', () => {
    expect(parsePastedProducts(`리플렉션 스킨 글로우 쿠션 파운데이션 커스텀 매치\n35,000\n${U}`)).toEqual([
      { name: '리플렉션 스킨 글로우 쿠션 파운데이션 커스텀 매치', price: 35000, link_url: U },
    ]);
  });

  it('숫자만 있는 가격줄은 쉼표 · 원 · ₩ · 쉼표 없는 세 자리 이상 모두 가격이다', () => {
    for (const p of ['35,000', '35000', '35,000원', '35,000 원', '₩35,000', '₩ 35000']) {
      expect(parsePastedProducts(`쿠션\n${p}`), p).toEqual([{ name: '쿠션', price: 35000 }]);
    }
  });

  it('접수 그대로: 한 줄에 "이름 35,000" = 이름과 가격을 나눈다', () => {
    expect(parsePastedProducts(`헤라 파운데이션 35,000\n${U}`)).toEqual([{ name: '헤라 파운데이션', price: 35000, link_url: U }]);
  });

  it('한 줄에 "이름 35,000원"도 나눈다(옛 규칙은 상품이 통째로 사라졌다)', () => {
    expect(parsePastedProducts(`헤라 파운데이션 35,000원\n${U}`)).toEqual([{ name: '헤라 파운데이션', price: 35000, link_url: U }]);
    expect(parsePastedProducts('헤라 쿠션 45,000원 → 10% 40,500원')).toEqual([
      { name: '헤라 쿠션', price: 45000, discount_price: 40500, discount_rate: 10 },
    ]);
  });

  it('한 줄 형식 여러 개를 이어 적어도 상품마다 나뉜다', () => {
    const out = parsePastedProducts(`블랙 쿠션 45,000원\n${U}/1\n리플렉션 쿠션 38,500\n${U}/2`);
    expect(out.map((o) => [o.name, o.price, o.link_url])).toEqual([
      ['블랙 쿠션', 45000, `${U}/1`],
      ['리플렉션 쿠션', 38500, `${U}/2`],
    ]);
  });

  it('숫자가 든 상품명은 가르지 않는다(용량 · 호수 · 증정 · 연도 · 짧은 숫자)', () => {
    expect(parsePastedProducts('UV 미스트 쿠션 50ml\n38,000원')[0].name).toBe('UV 미스트 쿠션 50ml');
    expect(parsePastedProducts('블랙 쿠션 21호\n45,000')[0]).toEqual({ name: '블랙 쿠션 21호', price: 45000 });
    expect(parsePastedProducts('[2+1 증정] 수분 선크림 세트\n134,000원')[0].name).toBe('[2+1 증정] 수분 선크림 세트');
    expect(parsePastedProducts(`블랙 쿠션 2025\n${U}`)[0]).toEqual({ name: '블랙 쿠션 2025', link_url: U });
    expect(parsePastedProducts(`쿠션 21\n${U}`)[0]).toEqual({ name: '쿠션 21', link_url: U });
  });

  it('이름 다음 줄의 가격은 그 이름의 가격이다(한 줄 나누기보다 앞선다 · 옛 규칙 그대로)', () => {
    // 가격을 기다리는 이름이 있으면 "정가 85,000원" 같은 줄도 그 이름의 가격줄로 읽는다
    expect(parsePastedProducts('글로우 파운데이션\n정가 85,000원')).toEqual([{ name: '글로우 파운데이션', price: 85000 }]);
  });
});

describe('parsePastedProducts — 옛 경계 보존', () => {
  it('할인가가 정가보다 크면 무시 + 최대 8개 상한 + 빈 입력 = 0개', () => {
    const weird = parsePastedProducts('상품 A\n10,000원 → 20,000원');
    expect(weird[0].price).toBe(10000);
    expect(weird[0].discount_price).toBeUndefined();
    const many = parsePastedProducts(
      Array.from({ length: 12 }, (_, i) => `상품 ${i}\n1,000원`).join('\n\n'),
    );
    expect(many.length).toBe(8);
    expect(parsePastedProducts('')).toEqual([]);
  });
});
