/**
 * json-shape.test.ts — 응답 구조 서술 CT 계약 (★2026-08-10)
 *
 * 이 함수의 존재 이유는 하나다 — **스키마는 보이고 값은 안 보인다.**
 * 그래서 "값이 안 새는가"를 먼저 단정하고, 그다음에 "매핑에 쓸 만큼 보이는가"를 단정한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describeJsonShape } from './json-shape';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

describe('값은 남기지 않는다', () => {
  it('구매자 성명·휴대폰·이메일 원문이 출력에 없다', () => {
    const out = describeJsonShape({
      ordererName: '홍길동',
      ordererTel: '010-1234-5678',
      email: 'hong@example.com',
      addr: '서울시 강남구 테헤란로 1',
    });
    for (const secret of ['홍길동', '1234', '5678', 'hong', 'example', '강남구', '테헤란로']) {
      expect(out, `원문 '${secret}'이 새어 나갔다`).not.toContain(secret);
    }
  });

  it('숫자 값 자체도 남기지 않는다 — 금액·주문번호가 그대로 찍히면 안 된다', () => {
    const out = describeJsonShape({ totalAmount: 128000, orderId: 20260810001 });
    expect(out).not.toContain('128000');
    expect(out).not.toContain('20260810001');
    expect(out).toContain('totalAmount: int');
  });

  it('중첩·배열 안쪽 값도 마스킹된다 (얕은 곳만 가리면 의미가 없다)', () => {
    const out = describeJsonShape({ data: { contents: [{ orderer: { name: '김영희' } }] } });
    expect(out).not.toContain('김영희');
  });
});

describe('스키마는 보인다', () => {
  it('키 이름과 중첩 구조가 그대로 보인다 — 매핑은 이것으로 확정한다', () => {
    const out = describeJsonShape({ data: { contents: [{ productOrderId: 'A1', orderer: { ordererTel: '01012345678' } }] } });
    expect(out).toContain('data');
    expect(out).toContain('contents');
    expect(out).toContain('productOrderId');
    expect(out).toContain('ordererTel');
  });

  it('날짜·전화 형식을 읽을 수 있다 — 자릿수와 구분자가 형식의 전부다', () => {
    expect(describeJsonShape('2026-08-10T09:30:00')).toBe('"9999-99-99T99:99:99"');
    expect(describeJsonShape('010-1234-5678')).toBe('"999-9999-9999"');
    expect(describeJsonShape('20260810')).toBe('"99999999"');
  });

  it('한글은 글자 수만 남는다', () => {
    expect(describeJsonShape('홍길동')).toBe('"***"');
  });

  it('배열은 길이와 첫 원소 구조로 접는다', () => {
    expect(describeJsonShape([{ a: 1 }, { a: 2 }, { a: 3 }])).toBe('[3×{a: int}]');
    expect(describeJsonShape([])).toBe('[]');
  });

  it('null과 빈 값을 구분한다 — 매핑에서 "없는 필드"와 "빈 필드"는 다르다', () => {
    const out = describeJsonShape({ grade: null, memo: '' });
    expect(out).toContain('grade: null');
    expect(out).toContain('memo: ""');
  });

  it('깊이 상한에서 끊는다 — 로그 한 줄이 수천 자가 되지 않게', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(describeJsonShape(deep, 3)).toContain('…');
  });
});

describe('preview 로그가 raw를 더 이상 찍지 않는다', () => {
  it('네이버·메이크샵 모두 구조 로그로 바뀌었다', () => {
    for (const f of ['routes/naver-commerce.ts', 'routes/makeshop.ts']) {
      const src = read(f);
      expect(src, `${f}가 아직 raw를 직렬화해 찍는다`).not.toMatch(/console\.log\([^)]*JSON\.stringify\(preview\./);
      expect(src).toContain('describeJsonShape');
    }
  });
});
