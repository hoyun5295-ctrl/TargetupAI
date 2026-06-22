import { describe, test, expect } from 'vitest';
import { fillAlimtalkVarMap } from './alimtalk-vars';

describe('fillAlimtalkVarMap 대체값(fallback)', () => {
  test('변수 값이 비면 대체값으로 채운다 (여정 경로)', () => {
    const out = fillAlimtalkVarMap(
      '주문 #{주문번호} · #{고객명}',
      { '#{주문번호}': '@@order_no@@', '#{고객명}': '@@name@@' },
      { name: '', order_no: 'A-001' },
      undefined,
      { '#{고객명}': '고객님' },
    );
    expect(out).toBe('주문 A-001 · 고객님');
  });

  test('대체값 미전달 시 빈 값은 빈 문자 — 직접발송 동작 불변', () => {
    const out = fillAlimtalkVarMap(
      '주문 #{주문번호} · #{고객명}',
      { '#{주문번호}': '@@order_no@@', '#{고객명}': '@@name@@' },
      { name: '', order_no: 'A-001' },
    );
    expect(out).toBe('주문 A-001 · ');
  });
});

describe('fillAlimtalkVarMap 이벤트 데이터 변수 (정보알림)', () => {
  test('이벤트 properties가 병합된 customer로 #{주문번호}를 채운다', () => {
    // journey-executor가 { ...eventProps, ...customer }로 병합해 전달하는 모습
    const customerWithEvent = { order_no: '20240622-001', name: '홍길동' };
    const out = fillAlimtalkVarMap(
      '#{고객명}님, 주문번호 #{주문번호}',
      { '#{고객명}': '@@name@@', '#{주문번호}': '@@order_no@@' },
      customerWithEvent,
    );
    expect(out).toBe('홍길동님, 주문번호 20240622-001');
  });
});
