/**
 * 080 청구 CT — 순수 함수 계약 테스트 (2026-07-30)
 *
 * 수치는 KT 명세서 실측(Harold 제공 2026-07 청구분)을 그대로 쓴다:
 *   우림FMG 080-284-1300 = 통화료 672 + 부가서비스 4,000 + VAT 467 = 소계 5,139
 *   피케이 080-377-7070 = 27,790 + 4,000 + 3,179 = 34,969
 *   080 소계 = 147,462 (서비스번호수 18대)
 * 검산은 AI가 아니라 코드가 한다 — 명세서 자체 합계와 어긋나면 반영 불가(fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  normalize080Number, format080Number,
  parseKtStatementJson, validateKtStatement,
  signKtStatement, verifyKtStatementSignature,
} from './billing-080';

describe('080 번호 정규화·표기', () => {
  it('숫자만 저장 — 하이픈·공백 제거', () => {
    expect(normalize080Number('080-284-1300')).toBe('0802841300');
    expect(normalize080Number(' 080 284 1300 ')).toBe('0802841300');
  });
  it('표시 = 080-XXX-XXXX (10자리)', () => {
    expect(format080Number('0802841300')).toBe('080-284-1300');
  });
});

describe('KT 명세서 판독 파싱 (방어)', () => {
  const good = JSON.stringify({
    usage_period: '6.1 ~ 6.30', count_080: 2, total_080: 40108,
    entries: [
      { number: '080-284-1300', call_fee: 672, svc_fee: 4000, vat: 467, subtotal: 5139 },
      { number: '080-377-7070', call_fee: 27790, svc_fee: 4000, vat: 3179, subtotal: 34969 },
    ],
  });
  it('정상 JSON — 번호는 숫자만으로 정규화', () => {
    const p = parseKtStatementJson(good)!;
    expect(p.entries).toHaveLength(2);
    expect(p.entries[0].number).toBe('0802841300');
    expect(p.total_080).toBe(40108);
  });
  it('코드펜스로 감싼 응답도 파싱', () => {
    expect(parseKtStatementJson('```json\n' + good + '\n```')).not.toBeNull();
  });
  it('JSON 아님·빈 entries = null (fail-closed)', () => {
    expect(parseKtStatementJson('읽을 수 없습니다')).toBeNull();
    expect(parseKtStatementJson('{"entries":[]}')).toBeNull();
  });
  it('쉼표 붙은 금액 문자열도 정수로', () => {
    const p = parseKtStatementJson(JSON.stringify({
      total_080: '5,139', count_080: 1,
      entries: [{ number: '080-284-1300', call_fee: '672', svc_fee: '4,000', vat: '467', subtotal: '5,139' }],
    }))!;
    expect(p.entries[0].svc_fee).toBe(4000);
    expect(p.total_080).toBe(5139);
  });
});

describe('KT 명세서 검산 (명세서 자체 합계 대조 — 실측 수치)', () => {
  // 실측 3행: 우림FMG·피케이·엔터식스(265+4,000+426=4,691). 3행 = 최빈값 검사 성립 최소 표본.
  const base = () => ({
    usage_period: '6.1 ~ 6.30', count_080: 3, total_080: 44799,
    entries: [
      { number: '0802841300', call_fee: 672, svc_fee: 4000, vat: 467, subtotal: 5139 },
      { number: '0803777070', call_fee: 27790, svc_fee: 4000, vat: 3179, subtotal: 34969 },
      { number: '0805206000', call_fee: 265, svc_fee: 4000, vat: 426, subtotal: 4691 },
    ],
  });
  it('실측 수치 — 검산 통과', () => {
    expect(validateKtStatement(base()).ok).toBe(true);
  });
  it('행 내부 합 불일치(통화료+부가서비스+VAT ≠ 소계) = 오독 검출', () => {
    const p = base();
    p.entries[0].call_fee = 673; // 1원 오독
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('080-284-1300');
  });
  it('소계 합 ≠ 명세서 080 소계 = 행 누락 검출', () => {
    const p = base();
    p.entries.pop(); // 한 행 누락
    p.count_080 = 1; // 행 수는 맞춘 상태여도
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('080 소계');
  });
  it('번호 중복 판독 검출', () => {
    const p = base();
    p.entries[1] = { ...p.entries[0] };
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('중복');
  });
  it('서비스번호수 불일치 검출', () => {
    const p = base();
    p.count_080 = 4;
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('서비스번호수');
  });
  it('★3행 미만 = 자동 반영 불가 (Codex 2R — 스왑 검출의 통계 축이 성립하지 않는 표본)', () => {
    const p = base();
    p.entries = p.entries.slice(0, 2);
    p.count_080 = 2;
    p.total_080 = 5139 + 34969;
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('표본');
  });
  it('★total_080·count_080 미판독(0) = 불합격 — "안 보이면 0" 폴백이 검산을 여는 fail-open이었다 (Codex 1R)', () => {
    const p1 = base(); p1.total_080 = 0;
    expect(validateKtStatement(p1).ok).toBe(false);
    const p2 = base(); p2.count_080 = 0;
    expect(validateKtStatement(p2).ok).toBe(false);
  });
  it('★call↔svc 오분류 검출 — call=4672·svc=0은 행 내부합·Σ을 그대로 통과하지만 반영이 매핑 부가서비스료를 따로 더해 4,000원 과다청구가 된다 (Codex 1R)', () => {
    const p = base();
    p.entries[0] = { number: '0802841300', call_fee: 4672, svc_fee: 0, vat: 467, subtotal: 5139 };
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('부가서비스이용료가 0');
  });
  it('★VAT 비율 이탈 검출 — KT는 (통화료+부가서비스)의 10% 원 미만 내림(±1 여유)', () => {
    const p = base();
    // 내부합은 유지한 채 vat에 금액이 섞인 오분류: 672→172, vat 467→967
    p.entries[0] = { number: '0802841300', call_fee: 172, svc_fee: 4000, vat: 967, subtotal: 5139 };
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('10%');
  });
  it('★서명 — 판독 전문 결속 (Codex 2R F2): 라운드트립 통과·변조/형식 오류/미서명 거부·정렬 무관', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-vitest';
    const p = base();
    const sig = signKtStatement(p);
    expect(verifyKtStatementSignature(p, sig)).toBe(true);
    // 항목 순서를 바꿔도(정렬 정규형) 유효 — 클라이언트 직렬화 순서에 안 깨진다
    const shuffled = { ...p, entries: [...p.entries].reverse() };
    expect(verifyKtStatementSignature(shuffled, sig)).toBe(true);
    // 금액 1원 변조 = 거부
    const tampered = { ...p, entries: p.entries.map((e, i) => (i === 0 ? { ...e, call_fee: e.call_fee + 1 } : e)) };
    expect(verifyKtStatementSignature(tampered, sig)).toBe(false);
    // 서명 없음·형식 오류 = 거부
    expect(verifyKtStatementSignature(p, '')).toBe(false);
    expect(verifyKtStatementSignature(p, '123.deadbeef')).toBe(false);
  });

  it('★NaN→null 왕복 전문은 서명 검증 자체가 거부된다 (Codex 3R — "판독 불가"가 0원으로 살아나는 구멍)', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-vitest';
    const p = base();
    const sig = signKtStatement(p);
    // 판독 불가(NaN)가 JSON 응답에서 null이 된 전문 — 옛 canonical은 0으로 뭉개 서명이 유지됐다
    const withNull = JSON.parse(JSON.stringify({
      ...p,
      entries: p.entries.map((e, i) => (i === 0 ? { ...e, call_fee: NaN } : e)),
    }));
    expect(withNull.entries[0].call_fee).toBeNull(); // JSON 왕복 실증
    expect(verifyKtStatementSignature(withNull, sig)).toBe(false);
    // 문자열 금액도 정규형 불가 = 거부
    const withStr = { ...p, entries: p.entries.map((e, i) => (i === 0 ? { ...e, call_fee: '672' as any } : e)) };
    expect(verifyKtStatementSignature(withStr, sig)).toBe(false);
    // ★소수 금액도 거부 (Codex 4R) — 671.6을 672로 반올림해 살리면 손상 전문이 서명을 유지한다
    const withFraction = { ...p, entries: p.entries.map((e, i) => (i === 0 ? { ...e, call_fee: 671.6 } : e)) };
    expect(verifyKtStatementSignature(withFraction, sig)).toBe(false);
  });

  it('★부가서비스 최빈값 이탈 검출 (3행 이상) — 한 행만 svc가 다르면 오분류 의심', () => {
    const p = base();
    // 3행: 두 행은 4,000, 한 행은 3,000(call로 1,000 이동 — 내부합·vat 비율 유지가 안 되므로 vat도 조정된 정교한 오독 가정)
    p.entries = [
      { number: '0802841300', call_fee: 672, svc_fee: 4000, vat: 467, subtotal: 5139 },
      { number: '0803777070', call_fee: 27790, svc_fee: 4000, vat: 3179, subtotal: 34969 },
      { number: '0805206000', call_fee: 1265, svc_fee: 3000, vat: 426, subtotal: 4691 },
    ];
    p.count_080 = 3;
    p.total_080 = 5139 + 34969 + 4691;
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('다른 번호');
  });
});
