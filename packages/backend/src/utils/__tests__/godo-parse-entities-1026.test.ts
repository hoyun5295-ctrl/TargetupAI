/**
 * ★2026-10-26 의존성 보안판 — 고도몰 응답 XML 해석(fast-xml-parser) 회귀 · 엔티티 부풀림 상한
 *
 * fast-xml-parser 4.5.0 = DOCTYPE 엔티티 확장에 상한이 없다(GHSA 경보 · critical/high). 응답을 만든 쪽(고도몰 서버 · 중간자)이
 * 작은 XML 로 큰 문자열을 만들어 API 프로세스를 멈출 수 있다. 판을 올린 뒤에도 평소 응답은 같은 값으로 읽혀야 한다.
 * 평소 응답 회귀 전체(21건) = godo-parse.verify.ts. 이 파일은 판 교체가 바꿀 수 있는 자리만 본다.
 */
import { describe, it, expect } from 'vitest';
import { parseGodoOrderResponse, mapGodoOrderToCdp } from '../godo-parse';

const ORDER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <header><code>000</code><msg>성공</msg><lastOrder>false</lastOrder></header>
  <return>
    <order_data>
      <orderNo>2610261234567890123</orderNo>
      <orderStatus>d1</orderStatus>
      <orderDate>2026-10-26 09:30:00</orderDate>
      <settlePrice>15000</settlePrice>
      <orderInfoData><orderInfoCd>2</orderInfoCd><orderName>받는분</orderName></orderInfoData>
      <orderInfoData><orderInfoCd>1</orderInfoCd><orderName>주문자</orderName><orderCellPhone>010-0000-0001</orderCellPhone></orderInfoData>
      <orderGoodsData><goodsNo>0077</goodsNo><goodsNm>A&amp;B 세트 &lt;한정&gt;</goodsNm><goodsPrice>15000</goodsPrice><goodsCnt>1</goodsCnt></orderGoodsData>
    </order_data>
  </return>
</data>`;

describe('고도몰 응답 해석 — 판 교체 회귀', () => {
  it('큰 주문번호 · 앞자리 0 상품번호는 글자 그대로 · 표준 엔티티는 풀어서 읽는다', () => {
    const r = parseGodoOrderResponse(ORDER_XML);
    expect(r.code).toBe('000');
    expect(r.hasNext).toBe(false);
    expect(r.lastOrderNo).toBe('2610261234567890123');
    const m = mapGodoOrderToCdp(r.orders[0]);
    expect(m?.order.orderId).toBe('2610261234567890123');
    expect(m?.order.items?.[0]).toEqual({ productId: '0077', productName: 'A&B 세트 <한정>', price: 15000, quantity: 1 });
    expect(m?.order.name).toBe('주문자');
    expect(m?.order.phone).toBe('010-0000-0001');
    expect(m?.order.status).toBe('shipping');
    expect(m?.order.totalAmount).toBe(15000);
  });

  it('숫자 문자 참조(10진 · 16진)도 풀어서 읽는다 — 5.x 기본값은 풀지 않아 「A&#38;B」가 상품명에 남았다(Codex 1R)', () => {
    const xml = ORDER_XML.replace('A&amp;B 세트 &lt;한정&gt;', 'A&#38;B &#x26; &#39;한정&#39; &#44608;밥');
    const m = mapGodoOrderToCdp(parseGodoOrderResponse(xml).orders[0]);
    expect(m?.order.items?.[0]?.productName).toBe("A&B & '한정' 김밥");
  });
});

describe('고도몰 응답 해석 — DOCTYPE 엔티티 부풀림', () => {
  it('큰 엔티티를 수천 번 부르는 응답이 들어와도 결과가 입력보다 크게 부풀지 않는다(못 읽으면 예외도 허용)', () => {
    // 4.5.0 실측(1026) = 입력 11KB → 결과 10MB(약 900배). 같은 꼴을 시험으로 고정한다.
    const xml = `<?xml version="1.0"?>
<!DOCTYPE data [<!ENTITY a "${'A'.repeat(5000)}">]>
<data><header><code>000</code><msg>${'&a;'.repeat(2000)}</msg></header><return></return></data>`;
    let out = '';
    try {
      out = JSON.stringify(parseGodoOrderResponse(xml));
    } catch {
      out = '';
    }
    expect(out.length).toBeLessThan(xml.length * 4);
  });
});
