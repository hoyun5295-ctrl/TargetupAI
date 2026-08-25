/**
 * 대행발송 요청서 파서 계약 (★ 2026-08-25(3) · Harold "요청서 엑셀 규격화 + 원스텝")
 *
 *   ① 요청서는 A열 라벨로 읽는다(행 위치가 밀려도 라벨이 맞으면 읽힌다)
 *   ② 광고는 기본 "예"다 — "아니오"라고 적은 경우만 해제(Harold 지시)
 *   ③ 회신번호 칸은 번호(직접)와 명단 열 이름(열 방식) 둘 다 받는다
 *   ④ 전화번호 열은 이름이 아니라 **값이 실제 휴대폰 번호인 비율**로 고른다
 *   ⑤ 필수 누락·해석 불가는 접수를 막는 반려 사유로 모인다
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseAgencyRecipientList, parseAgencyRequestForm, pickPhoneColumn, resolveCallbackPlan, parseWhenText,
} from '../agency-send-form';

/** 시험용 요청서 버퍼. rows = [A열 라벨, B열 값] */
function formBuffer(rows: Array<[string, any]>): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([['대행발송 요청서'], [], ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '요청서');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const FULL: Array<[string, any]> = [
  ['제목', '가을 행사 안내'],
  ['문안', '[한줄상회] %이름%님, 행사 안내드립니다.'],
  ['보낼 시각', '2026-09-01 14:00'],
  ['회신번호', '0507-0000-0000'],
  ['광고 여부', ''],
  ['담당자 번호', '010-0000-1111, 01000002222'],
];

describe('대행발송 요청서 — 라벨 파싱', () => {
  it('여섯 항목을 라벨로 읽는다(행이 밀려도 라벨이 기준이다)', () => {
    const f = parseAgencyRequestForm(formBuffer(FULL));
    expect(f.errors).toEqual([]);
    expect(f.subject).toBe('가을 행사 안내');
    expect(f.content).toContain('%이름%');
    expect(f.requestedAtText).toBe('2026-09-01 14:00');
    expect(f.callbackRaw).toBe('0507-0000-0000');
    expect(f.managerPhones).toEqual(['01000001111', '01000002222']);
  });

  it('광고는 기본 예다. "아니오"라고 적은 경우만 꺼진다(Harold 지시)', () => {
    expect(parseAgencyRequestForm(formBuffer(FULL)).isAd).toBe(true);
    const off = FULL.map((r) => (r[0] === '광고 여부' ? ['광고 여부', '아니오'] as [string, any] : r));
    expect(parseAgencyRequestForm(formBuffer(off)).isAd).toBe(false);
    const on = FULL.map((r) => (r[0] === '광고 여부' ? ['광고 여부', '예'] as [string, any] : r));
    expect(parseAgencyRequestForm(formBuffer(on)).isAd).toBe(true);
  });

  it('필수(문안·보낼 시각·회신번호·담당자) 누락은 반려 사유로 모인다', () => {
    const f = parseAgencyRequestForm(formBuffer([['제목', '만'], ['광고 여부', '예']]));
    const fields = f.errors.map((e) => e.field);
    expect(fields).toContain('문안');
    expect(fields).toContain('보낼 시각');
    expect(fields).toContain('회신번호');
    expect(fields).toContain('담당자 번호');
  });
});

describe('대행발송 요청서 — 시각·회신번호 해석', () => {
  it('시각 문자열을 KST로 읽는다(구분자 - . / 허용)', () => {
    const d = parseWhenText('2026-09-01 14:00');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(1);
    expect(d!.getHours()).toBe(14);
    expect(parseWhenText('2026.9.1 09:30')!.getHours()).toBe(9);
    expect(parseWhenText('2026-09-01 14:00:30')).not.toBeNull();
    expect(parseWhenText('이상한 값')).toBeNull();
  });

  /** ★Codex 적대 1R 고정 — JS Date는 2월 30일을 3월 2일로 굴린다. 달력 왕복 대조로 거절한다 */
  it('달력에 없는 날짜·범위 밖 시각·잔여 접미사는 거절한다', () => {
    expect(parseWhenText('2026-02-30 10:00')).toBeNull();
    expect(parseWhenText('2026-04-31 10:00')).toBeNull();
    expect(parseWhenText('2026-09-01 24:00')).toBeNull();
    expect(parseWhenText('2026-09-01 14:60')).toBeNull();
    expect(parseWhenText('2026-09-01 14:00 KST')).toBeNull();
  });

  it('회신번호 칸: 숫자면 번호, 명단 열 이름이면 열, 어느 쪽도 아니면 오류', () => {
    const headers = ['휴대폰번호', '고객명', '매장전화'];
    expect(resolveCallbackPlan('0507-0000-0000', headers)).toEqual({ mode: 'fixed', number: '050700000000' });
    expect(resolveCallbackPlan('매장전화', headers)).toEqual({ mode: 'column', column: '매장전화' });
    expect(resolveCallbackPlan('열이름: 매장전화', headers)).toEqual({ mode: 'column', column: '매장전화' });
    expect(resolveCallbackPlan('없는열', headers)).toEqual({ mode: 'none' });
    expect(resolveCallbackPlan('', headers)).toEqual({ mode: 'none' });
  });
});

describe('대행발송 요청서 — 파서 강건성(★Codex 적대 1R 고정)', () => {
  it('같은 뜻의 항목이 값이 다르게 두 번 있으면 반려한다(별칭 "광고"까지 한 필드로 본다 · 첫 값이 조용히 이기지 않는다)', () => {
    const base = FULL.map((r) => (r[0] === '광고 여부' ? ['광고 여부', '예'] as [string, any] : r));
    const dup = [...base, ['광고', '아니오'] as [string, any]];
    const f = parseAgencyRequestForm(formBuffer(dup));
    expect(f.errors.some((e) => e.field === '광고 여부')).toBe(true);
    // 빈 칸 + 채운 칸은 충돌이 아니다(채운 값이 답이다)
    const half = [...base.filter((r) => r[0] !== '광고 여부'), ['광고 여부', ''] as [string, any], ['광고', '아니오'] as [string, any]];
    const f2 = parseAgencyRequestForm(formBuffer(half));
    expect(f2.errors.some((e) => e.field === '광고 여부')).toBe(false);
    expect(f2.isAd).toBe(false);
  });

  it('명단의 빈 헤더가 있어도 뒤 열이 밀리지 않는다(자리 보존)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['번호표', '', '연락처', '매장전화'],
      ['1', '무시', '01000001111', '0200000000'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const list = parseAgencyRecipientList(buf);
    expect(list.headers).toEqual(['번호표', '연락처', '매장전화']);
    expect(list.rows[0]['연락처']).toBe('01000001111');
    expect(list.rows[0]['매장전화']).toBe('0200000000');
  });

  it('같은 이름의 열이 두 개면 duplicates로 알린다', () => {
    const ws = XLSX.utils.aoa_to_sheet([['연락처', '연락처'], ['01000001111', '01000002222']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    const list = parseAgencyRecipientList(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(list.duplicates).toContain('연락처');
  });
});

describe('대행발송 요청서 — 전화번호 열 선정', () => {
  it('열 이름이 아니라 값이 휴대폰 번호인 비율로 고른다', () => {
    const headers = ['번호표', '연락처', '고객명'];
    const rows = [
      { 번호표: '1', 연락처: '010-0000-1111', 고객명: '김하나' },
      { 번호표: '2', 연락처: '01000002222', 고객명: '이두리' },
      { 번호표: '3', 연락처: '010-0000-3333', 고객명: '박세미' },
    ];
    expect(pickPhoneColumn(headers, rows)).toBe('연락처');
  });

  it('휴대폰 번호 열이 없으면 null이다(아무 열이나 집지 않는다)', () => {
    const headers = ['번호표', '고객명'];
    const rows = [{ 번호표: '1', 고객명: '김하나' }, { 번호표: '2', 고객명: '이두리' }];
    expect(pickPhoneColumn(headers, rows)).toBeNull();
  });
});
