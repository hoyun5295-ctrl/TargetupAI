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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalize080Number, format080Number,
  parseKtStatementJson, validateKtStatement,
  signKtStatement, verifyKtStatementSignature,
  monthFullyCovered,
} from './billing-080';

/**
 * ★ 2026-08-20 재오픈 정정 Codex 지적(high) — 라벨 건너뜀 고착 차단.
 * 6/16~7/15를 "6월", 7/16~8/15를 "8월"로 발행하면 7월 전체가 발행 기간에 덮이는데 7월 라벨은 없다.
 * 그때 7월 반영을 받으면 실릴 정산을 영영 못 만든다(새 7월 라벨 정산은 기간 중복에 걸린다) —
 * 그 달이 전부 덮였으면 반영 자체를 거부한다(fail-closed·조용한 미청구 금지).
 */
describe('monthFullyCovered — 그 달이 발행 기간들로 전부 덮였는가', () => {
  it('빈 목록 = 안 덮임', () => {
    expect(monthFullyCovered('2026-07-01', [])).toBe(false);
  });
  it('역월 한 장이 그 달을 정확히 덮는다', () => {
    expect(monthFullyCovered('2026-07-01', [{ start: '2026-07-01', end: '2026-07-31' }])).toBe(true);
  });
  it('연속 중간정산 두 장(6/16~7/15 + 7/16~8/15)이 7월을 전부 덮는다 — 지적 시나리오', () => {
    expect(monthFullyCovered('2026-07-01', [
      { start: '2026-06-16', end: '2026-07-15' },
      { start: '2026-07-16', end: '2026-08-15' },
    ])).toBe(true);
  });
  it('한쪽만 있으면 안 덮임 — 남은 구간의 라벨 정산이 아직 가능하다', () => {
    expect(monthFullyCovered('2026-07-01', [{ start: '2026-07-16', end: '2026-08-15' }])).toBe(false);
    expect(monthFullyCovered('2026-07-01', [{ start: '2026-06-16', end: '2026-07-15' }])).toBe(false);
  });
  it('사이에 하루라도 틈이 있으면 안 덮임', () => {
    expect(monthFullyCovered('2026-07-01', [
      { start: '2026-06-16', end: '2026-07-15' },
      { start: '2026-07-17', end: '2026-08-15' }, // 7/16 하루 빈다
    ])).toBe(false);
  });
  it('겹치는 기간·순서 뒤섞임도 병합해서 판정한다', () => {
    expect(monthFullyCovered('2026-07-01', [
      { start: '2026-07-10', end: '2026-07-31' },
      { start: '2026-06-01', end: '2026-07-12' },
    ])).toBe(true);
  });
  it('2월(말일 28일)·12월(연 경계) 경계가 정확하다', () => {
    expect(monthFullyCovered('2026-02-01', [{ start: '2026-02-01', end: '2026-02-28' }])).toBe(true);
    expect(monthFullyCovered('2026-02-01', [{ start: '2026-02-01', end: '2026-02-27' }])).toBe(false);
    expect(monthFullyCovered('2026-12-01', [{ start: '2026-11-16', end: '2027-01-15' }])).toBe(true);
  });

  // ★ 2R 수용 — 수동 정산완료(달 전체)도 덮임이다. 커버리지 조회가 두 원장을 합치는 것을 소스 스캔으로 고정한다.
  it('수동 정산완료 한 건(달 전체)만으로 덮임', () => {
    expect(monthFullyCovered('2026-07-01', [{ start: '2026-07-01', end: '2026-07-31' }])).toBe(true);
  });
  it('[소스 스캔] 두 커버리지 게이트가 billing_manual_completions를 UNION으로 합쳐 판정한다', () => {
    const src = readFileSync(resolve(__dirname, 'billing-080.ts'), 'utf8');
    const unions = src.match(/UNION ALL\s+SELECT period_start::text, period_end::text FROM billing_manual_completions/g) || [];
    expect(unions.length).toBe(2);
  });
  it('[소스 스캔] KT 반영의 회사별 catch는 스키마 부재(테이블 42P01·컬럼 42703)를 skipped로 삼키지 않고 던진다 — "0개사 반영 완료" 위장 차단', () => {
    const src = readFileSync(resolve(__dirname, 'billing-080.ts'), 'utf8');
    expect(src).toMatch(/err\?\.code === '42P01' \|\| err\?\.code === '42703'\) throw err/);
  });
});

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

/**
 * ★ 2026-09-12 직원 접수 3번 — 번호 하나에 통화료 줄이 여럿인 명세서.
 *
 * 무슨 일이 있었나
 *   판독 규칙이 통화료를 **칸 하나**로 받고 예시를 "이동전화에 건 통화료" 하나만 들어서,
 *   시외통화료 줄이 함께 있는 번호에서 한 줄이 떨어졌다(080-377-7070 = 시외 45 + 이동전화 26,055).
 *   검산 ①(call+svc+vat = subtotal)이 이를 잡아 **반영이 막혔다** — 틀린 금액이 청구된 게 아니라
 *   매달 수작업으로 되돌아갔다. 고칠 곳은 판독 규칙이지 검산이 아니다.
 *
 * 못 박는 것:
 *   1. 통화료 줄을 전부 옮겨 적고 **합은 코드가** 낸다(AI에게 더하게 시키지 않는다).
 *   2. 옮겨 적은 줄의 합이 통화료와 다르면 반영 불가 — 전사 누락을 검산이 다시 잡는다.
 *   3. 줄 목록은 서명 대상이 아니다 — 금액의 진실은 서명된 `call_fee`뿐이다.
 */
describe('통화료 여러 줄 — 전사 + 코드 합산 (접수 3번)', () => {
  const withLines = (lines: Array<{ label: string; amount: number }>) => JSON.stringify({
    usage_period: '6.1 ~ 6.30', count_080: 3, total_080: 44799,
    entries: [
      { number: '080-284-1300', call_fee: 672, svc_fee: 4000, vat: 467, subtotal: 5139 },
      { number: '080-377-7070', call_lines: lines, svc_fee: 4000, vat: 3179, subtotal: 34969 },
      { number: '080-520-6000', call_fee: 265, svc_fee: 4000, vat: 426, subtotal: 4691 },
    ],
  });

  it('★통화료 줄이 여럿이면 합을 통화료로 삼는다', () => {
    const p = parseKtStatementJson(withLines([
      { label: '시외통화료', amount: 45 },
      { label: '이동전화에 건 통화료', amount: 27745 },
    ]))!;
    expect(p).not.toBeNull();
    const pk = p.entries.find((e) => e.number === '0803777070')!;
    expect(pk.call_fee).toBe(27790);
    expect(pk.call_lines).toHaveLength(2);
  });

  it('★한 줄만 있어도 합산 결과는 같다', () => {
    const p = parseKtStatementJson(withLines([{ label: '이동전화에 건 통화료', amount: 27790 }]))!;
    expect(p.entries.find((e) => e.number === '0803777070')!.call_fee).toBe(27790);
  });

  it('줄 목록이 없으면 기존 통화료 칸을 그대로 쓴다 (옛 판독 호환)', () => {
    const p = parseKtStatementJson(JSON.stringify({
      usage_period: '6.1 ~ 6.30', count_080: 1, total_080: 5139,
      entries: [{ number: '080-284-1300', call_fee: 672, svc_fee: 4000, vat: 467, subtotal: 5139 }],
    }))!;
    expect(p.entries[0].call_fee).toBe(672);
    expect(p.entries[0].call_lines).toBeUndefined();
  });

  it('★전사한 줄의 합이 통화료와 다르면 반영 불가 — 누락을 검산이 다시 잡는다', () => {
    const p = parseKtStatementJson(withLines([
      { label: '이동전화에 건 통화료', amount: 27745 },
    ]))!;
    // 판독은 합(27,745)을 통화료로 삼지만 소계는 27,790 기준이라 행 내부 합이 깨진다
    const v = validateKtStatement(p);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('080-377-7070');
  });

  it('★줄 목록을 손대도 서명은 통화료 합만 본다 — 금액의 진실은 서명된 값뿐', () => {
    const p = parseKtStatementJson(withLines([
      { label: '시외통화료', amount: 45 },
      { label: '이동전화에 건 통화료', amount: 27745 },
    ]))!;
    const sig = signKtStatement(p);
    const tampered = { ...p, entries: p.entries.map((e) => ({ ...e, call_lines: [{ label: '조작', amount: 1 }] })) };
    expect(verifyKtStatementSignature(tampered, sig)).toBe(true);
  });

  it('줄 금액이 정수가 아니면 그 줄은 버리지 않고 판독 실패로 본다', () => {
    const p = parseKtStatementJson(withLines([
      { label: '시외통화료', amount: 'abc' as any },
      { label: '이동전화에 건 통화료', amount: 27745 },
    ]));
    const pk = p?.entries.find((e) => e.number === '0803777070');
    expect(Number.isFinite(pk?.call_fee as number)).toBe(false);
  });

  it('[소스 스캔] 판독 규칙이 통화료 줄을 전부 적으라고 지시한다', () => {
    const src = readFileSync(resolve(__dirname, './billing-080.ts'), 'utf8');
    const prompt = src.slice(src.indexOf('const KT_SYSTEM_PROMPT'), src.indexOf('/** 방어 파싱'));
    expect(prompt, '통화료 줄 전수 전사 지시가 없다').toContain('통화료 줄을 빠짐없이');
    expect(prompt, '줄을 합치지 말라는 금지가 없다').toContain('줄을 합치거나 빼지 마십시오');
    expect(prompt, 'AI에게 합계를 계산시키고 있다').not.toMatch(/합계를 계산|더해서|합산해/);
  });
});

/**
 * 줄 내역은 **사람이 확인하는 자리**까지 올라가야 한다.
 * 판독이 줄을 빠뜨려도 합계 한 숫자만 보면 눈으로 잡을 수 없다 — 접수 3번이 그렇게 지나갔다.
 */
describe('[소스 스캔] 통화료 줄 내역 표시 배선', () => {
  const ct = readFileSync(resolve(__dirname, './billing-080.ts'), 'utf8');
  const fe = readFileSync(
    resolve(__dirname, '../../../frontend/src/components/Billing080Modal.tsx'), 'utf8');

  it('★귀속 행이 줄이 여럿일 때만 내역을 실어 보낸다', () => {
    const seg = ct.slice(ct.indexOf('export async function reconcileKtStatement'), ct.indexOf('export async function reconcileKtStatement') + 900);
    expect(seg).toMatch(/call_lines/);
    expect(seg, '한 줄뿐인 행까지 내역을 실으면 표가 시끄러워진다').toMatch(/length > 1/);
  });

  it('★확인 화면이 줄 내역을 보여준다', () => {
    expect(fe, '줄 내역 렌더가 꺼져 있다').toContain('{r.call_lines && r.call_lines.length > 1 && (');
    expect(fe).toMatch(/\{l\.label\}/);
  });

  it('★금액의 진실은 서명된 통화료다 — 정규형에 줄 목록이 들어가지 않는다', () => {
    const seg = ct.slice(ct.indexOf('export function canonicalKtStatement'), ct.indexOf('export function signKtStatement'));
    expect(seg, '줄 목록이 서명 대상에 들어갔다').not.toMatch(/call_lines/);
  });
});

/**
 * ★ Codex 적대검토 1R(medium 수용) — 미판독과 명시적 0을 구분한다.
 * `toInt(null)`은 `Number('')` 경유로 0을 돌려준다. 그대로 두면 판독 못 한 줄이 "0원 줄"이 되어
 * 검산·서명을 그대로 통과하고, 화면에는 0원으로 찍힌다. 불완전한 전사가 정상 결과로 확정된다.
 */
describe('통화료 줄 — 미판독과 0원의 구분 (Codex 1R)', () => {
  const one = (lines: any) => JSON.stringify({
    usage_period: '6.1 ~ 6.30', count_080: 1, total_080: 34969,
    entries: [{ number: '080-377-7070', call_lines: lines, svc_fee: 4000, vat: 3179, subtotal: 34969 }],
  });
  const callFee = (lines: any) => parseKtStatementJson(one(lines))!.entries[0].call_fee;

  it('★금액이 null이면 합을 확정하지 않는다', () => {
    expect(Number.isFinite(callFee([{ label: '시외통화료', amount: null }, { label: '이동전화', amount: 27790 }]))).toBe(false);
  });

  it('★금액 칸이 아예 없으면 합을 확정하지 않는다', () => {
    expect(Number.isFinite(callFee([{ label: '시외통화료' }, { label: '이동전화', amount: 27790 }]))).toBe(false);
  });

  it('★금액이 빈 문자열·공백이면 합을 확정하지 않는다', () => {
    expect(Number.isFinite(callFee([{ label: '시외통화료', amount: '' }, { label: '이동전화', amount: 27790 }]))).toBe(false);
    expect(Number.isFinite(callFee([{ label: '시외통화료', amount: '   ' }, { label: '이동전화', amount: 27790 }]))).toBe(false);
  });

  it('명시적 0원 줄은 정상이다 — 0으로 적힌 줄과 못 읽은 줄은 다르다', () => {
    expect(callFee([{ label: '시외통화료', amount: 0 }, { label: '이동전화', amount: 27790 }])).toBe(27790);
    expect(callFee([{ label: '시외통화료', amount: '0' }, { label: '이동전화', amount: 27790 }])).toBe(27790);
  });

  it('통화료 줄이 하나도 없으면 0원이다', () => {
    expect(callFee([])).toBe(0);
  });
});

/**
 * ★ Codex 적대검토 2R(medium 수용) — 타입과 "제거 후 빈 값"까지 막는다.
 * `'원'`·`','`은 trim을 통과한 뒤 toInt의 문자 제거로 빈 문자열이 되어 0이 된다.
 * 배열 `[1,2]`는 `'1,2'`를 거쳐 12가 된다. 둘 다 유한수라 앞선 NaN 차단을 그대로 통과했다.
 */
describe('통화료 줄 — 타입·제거 후 빈 값 (Codex 2R)', () => {
  const one = (amount: any) => JSON.stringify({
    usage_period: '6.1 ~ 6.30', count_080: 1, total_080: 34969,
    entries: [{ number: '080-377-7070', call_lines: [{ label: '시외통화료', amount }, { label: '이동전화', amount: 27790 }], svc_fee: 4000, vat: 3179, subtotal: 34969 }],
  });
  const callFee = (amount: any) => parseKtStatementJson(one(amount))!.entries[0].call_fee;

  it('★단위 문자만 있는 값은 금액이 아니다', () => {
    expect(Number.isFinite(callFee('원'))).toBe(false);
    expect(Number.isFinite(callFee(','))).toBe(false);
    expect(Number.isFinite(callFee(' , '))).toBe(false);
  });

  it('★숫자·문자열이 아닌 타입은 금액이 아니다', () => {
    expect(Number.isFinite(callFee([1, 2]))).toBe(false);
    expect(Number.isFinite(callFee([null, null]))).toBe(false);
    expect(Number.isFinite(callFee({}))).toBe(false);
    expect(Number.isFinite(callFee(true))).toBe(false);
  });

  it('쉼표 있는 문자열 금액은 그대로 읽는다 (명세서 표기 그대로)', () => {
    expect(callFee('45')).toBe(27835);
    expect(callFee('1,205')).toBe(28995);
  });
});

/**
 * ★ Codex 3R 범위 밖 지적 수용 — 줄 금액의 음수·과대값은 상쇄로 정상 합계를 만든다.
 * 예: [-100, 27890]의 합은 27,790이라 행 내부 합·소계 검산을 그대로 통과한다.
 * 통화료 줄에 음수는 없다. 합치기 전에 줄 단위로 막는다.
 */
describe('통화료 줄 — 음수·과대값 상쇄 차단 (Codex 3R)', () => {
  const two = (a: any, b: any) => JSON.stringify({
    usage_period: '6.1 ~ 6.30', count_080: 1, total_080: 34969,
    entries: [{ number: '080-377-7070', call_lines: [{ label: 'A', amount: a }, { label: 'B', amount: b }], svc_fee: 4000, vat: 3179, subtotal: 34969 }],
  });
  const callFee = (a: any, b: any) => parseKtStatementJson(two(a, b))!.entries[0].call_fee;

  it('★음수 줄은 금액이 아니다 — 상쇄로 정상 합계를 만들 수 없다', () => {
    expect(Number.isFinite(callFee(-100, 27890))).toBe(false);
    expect(Number.isFinite(callFee('-100', 27890))).toBe(false);
  });

  it('★안전 정수 범위를 넘는 줄은 금액이 아니다', () => {
    expect(Number.isFinite(callFee(1e20, -1e20 + 27790))).toBe(false);
  });

  it('정상 두 줄은 그대로 합산된다', () => {
    expect(callFee(45, 27745)).toBe(27790);
    expect(callFee(0, 27790)).toBe(27790);
  });
});
