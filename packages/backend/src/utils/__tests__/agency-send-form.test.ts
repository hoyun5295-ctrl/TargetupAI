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
import path from 'path';
import fs from 'fs';
import {
  parseAgencyRecipientList, parseAgencyRequestForm, pickPhoneColumn, pickPhoneColumnStrict,
  scorePhoneColumns, resolveCallbackPlan, parseWhenText, matchHeader,
  looksLikeRequestForm, hasRecipientSheet,
} from '../agency-send-form';
import { restoreMobileLeadingZero, normalizeAgencyPhone } from '../normalize-phone';

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

// ★2026-08-26 §18-4 파서 보강 (Harold 실물 명단 · 무헤더 + 엑셀 0 유실)
describe('대행발송 §18-4 — 휴대폰 앞자리 0 복원', () => {
  it('엑셀 숫자 셀이 떨어뜨린 0을 복원한다(10자리 1[016789] 패턴만)', () => {
    expect(restoreMobileLeadingZero('1000005555')).toBe('01000005555');
    expect(restoreMobileLeadingZero('1112345678')).toBe('01112345678');
    expect(normalizeAgencyPhone(1000005555)).toBe('01000005555');
    expect(normalizeAgencyPhone('010-0000-5555')).toBe('01000005555');
  });

  it('복원 대상이 아닌 값은 건드리지 않는다(완성형·유선·9자리 구형·짧은 값)', () => {
    expect(restoreMobileLeadingZero('01000005555')).toBe('01000005555');
    expect(restoreMobileLeadingZero('0212345678')).toBe('0212345678');
    expect(restoreMobileLeadingZero('112345678')).toBe('112345678');
    expect(restoreMobileLeadingZero('1234567890')).toBe('1234567890');
    expect(restoreMobileLeadingZero('')).toBe('');
  });

  it('0 유실 값만 있는 열도 자동 선정에 잡힌다(종전엔 looksMobile이 01 시작을 요구해 탈락)', () => {
    const headers = ['이름', '전화'];
    const rows = [
      { 이름: '유호윤', 전화: 1000005555 },
      { 이름: '김하나', 전화: 1000001111 },
      { 이름: '이두리', 전화: 1000002222 },
    ];
    expect(pickPhoneColumn(headers, rows)).toBe('전화');
  });
});

describe('대행발송 §18-4 — 무헤더 명단(첫 줄이 데이터)', () => {
  const headerlessBuf = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['유호윤', '010-0000-5555', '서울', '남성', 98887, 'VVIP'],
      ['김하나', '010-0000-1111', '부산', '여성', 12345, '일반'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('첫 줄에 휴대폰 모양 값이 있으면 무헤더로 판정하고 열 이름을 합성한다 — 첫 고객이 유실되지 않는다', () => {
    const list = parseAgencyRecipientList(headerlessBuf());
    expect(list.headerless).toBe(true);
    expect(list.headers[0]).toBe('열1');
    expect(list.rows.length).toBe(2);
    expect(list.rows[0]['열1']).toBe('유호윤');
    expect(list.rows[0]['열2']).toBe('010-0000-5555');
    expect(pickPhoneColumn(list.headers, list.rows)).toBe('열2');
  });

  it('0 유실 숫자 셀 무헤더도 감지된다(복원 후 판정)', () => {
    const ws = XLSX.utils.aoa_to_sheet([[
      '유호윤', 1000005555, '서울',
    ], ['김하나', 1000001111, '부산']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    const list = parseAgencyRecipientList(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(list.headerless).toBe(true);
    expect(list.rows.length).toBe(2);
  });

  it('열 이름이 있는 명단은 종전과 완전히 같다(headerless=false)', () => {
    const ws = XLSX.utils.aoa_to_sheet([['이름', '연락처'], ['김하나', '01000001111']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    const list = parseAgencyRecipientList(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(list.headerless).toBe(false);
    expect(list.headers).toEqual(['이름', '연락처']);
    expect(list.rows.length).toBe(1);
  });
});

describe('대행발송 §18-4 — 이메일용 strict 열 선정(사람 눈이 없는 경로)', () => {
  it('비율 0.9 이상 + 2등과 0.3 이상 격차일 때만 채택한다', () => {
    const headers = ['이름', '전화'];
    const rows = Array.from({ length: 10 }, (_, i) => ({ 이름: `사람${i}`, 전화: `0100000${String(1000 + i)}` }));
    expect(pickPhoneColumnStrict(headers, rows)).toBe('전화');
  });

  it('번호 모양 열이 둘이어서 격차가 없으면 null(반려)이다 — 화면(0.5)은 최고 열을 골라 사람이 본다', () => {
    const headers = ['전화1', '전화2'];
    const rows = Array.from({ length: 10 }, (_, i) => ({
      전화1: `0100000${String(1000 + i)}`, 전화2: `0109999${String(1000 + i)}`,
    }));
    expect(pickPhoneColumnStrict(headers, rows)).toBeNull();
    expect(pickPhoneColumn(headers, rows)).not.toBeNull();
    const scores = scorePhoneColumns(headers, rows);
    expect(scores[0].ratio).toBe(1);
    expect(scores[1].ratio).toBe(1);
  });

  it('비율이 낮으면(0.9 미만) null이다', () => {
    const headers = ['비고'];
    const rows = [
      { 비고: '01000001111' }, { 비고: '메모' }, { 비고: '01000002222' }, { 비고: '메모' },
    ];
    expect(pickPhoneColumnStrict(headers, rows)).toBeNull();
  });
});

describe('대행발송 §18-4 — 요청서 "수신자 열 이름" 칸(선택)', () => {
  it('칸 값을 읽고, 없으면 빈 문자열이다(기존 요청서 무영향)', () => {
    expect(parseAgencyRequestForm(formBuffer(FULL)).phoneColumnName).toBe('');
    const withCol = [...FULL, ['수신자 열 이름', '휴대폰번호'] as [string, any]];
    const f = parseAgencyRequestForm(formBuffer(withCol));
    expect(f.errors).toEqual([]);
    expect(f.phoneColumnName).toBe('휴대폰번호');
  });

  it('matchHeader는 공백을 무시하고 명단 열을 찾는다(회신번호 열 방식과 같은 판정 한 벌)', () => {
    expect(matchHeader('휴대폰 번호', ['휴대폰번호', '이름'])).toBe('휴대폰번호');
    expect(matchHeader('없는열', ['휴대폰번호'])).toBeNull();
    expect(matchHeader('', ['휴대폰번호'])).toBeNull();
  });
});

describe('대행발송 §17-5 계약 — 배포 양식 파서 왕복(재생성본이 파서를 통과해야 한다)', () => {
  it('frontend/public/agency-request-form.xlsx: 통일 양식(내용+고객리스트 한 파일)이고, 값 칸은 비워 배포한다', () => {
    // ★2026-08-26(2) 배포본의 값 칸은 전부 빈칸이다(값 칸의 예시·안내문이 값으로 접수되는 것을 원천 차단).
    //   그래서 왕복 계약 = 필수 4필드가 정확히 "빈칸" 사유로 반려된다(라벨이 미인식이면 같은 결과가
    //   나올 수 없다 — 미인식 라벨 검증은 아래 통일 양식 픽스처 테스트가 값을 채워 증명한다).
    const formPath = path.resolve(__dirname, '../../../../frontend/public/agency-request-form.xlsx');
    expect(fs.existsSync(formPath)).toBe(true);
    const buf = fs.readFileSync(formPath);
    expect(looksLikeRequestForm(buf)).toBe(true);
    expect(hasRecipientSheet(buf)).toBe(true);
    const f = parseAgencyRequestForm(buf);
    expect(f.errors.map((e) => e.field).sort()).toEqual(['담당자 번호', '문안', '보낼 시각', '회신번호']);
    expect(f.isAd).toBe(true);
    expect(f.phoneColumnName).toBe('');
    const list = parseAgencyRecipientList(buf);
    expect(list.headers).toEqual(['고객명', '고객연락처 (수신번호)', '매장이름', '매장전화번호 (회신번호)', '기타', '기타2']);
    expect(list.rows.length).toBe(0);
  });
});

/**
 * ★2026-08-26(2) 통일 양식 계약 — 업계 실물 레이아웃(카카오톡 수신 파일 실측)을 그대로 본뜬 픽스처.
 *   A열 비움 · B열 라벨(줄바꿈·괄호 부연 포함) · C열 값 · 시트1 "내용" + 시트2 "고객리스트".
 */
function industryBuffer(opts: {
  when?: string; content?: string; callback?: string; managers?: string; type?: string; image?: string;
  listRows?: any[][];
} = {}): Buffer {
  const aoa: any[][] = [
    [null, '구 분', '내 용'],
    [null, '문자타입', opts.type ?? null],
    [null, '알림톡 실패 시 전환 발송 사용 여부', null],
    [null, '※ 전환 발송 사용시 알림톡과 동일한 문안 발송을 기본으로 합니다.', null],
    [null, '발송날짜 및 시간', opts.when ?? '월 일 시 분'],
    [null, '메시지 제목\r\n(LMS,MMS만 해당)', '가을 행사 안내'],
    [null, '템플릿코드\r\n(알림톡만 해당)', null],
    [null, '테스트 문자\r\n받을 번호\r\n(여러 개 가능)', opts.managers ?? null],
    [null, '메시지 내용', opts.content ?? null],
    [null, '발신번호\r\n(=회신번호)', opts.callback ?? "(고객 별로 발신번호가 상이할 경우, '고객리스트'시트에 고객 별로 발신번호 기재 부탁드립니다.)"],
    [null, '이미지 파일명\r\n(MMS/\r\n친구톡 이미지 발송)', opts.image ?? '① '],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '내용');
  const listAoa = opts.listRows ?? [
    ['고객명', '고객연락처 (수신번호)', '매장이름', '매장전화번호 (회신번호)', '기타', '기타2'],
    ['김하나', '01000001111', '강남점', '0200000000', 'VIP', ''],
    ['이두리', '01000002222', '서초점', '0310000000', '일반', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(listAoa), '고객리스트');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('대행발송 통일 양식(★2026-08-26(2)) — 업계 레이아웃 파싱', () => {
  it('B열 라벨(줄바꿈·괄호 부연)을 해석해 전 필드를 읽는다', () => {
    const f = parseAgencyRequestForm(industryBuffer({
      when: '2026년 9월 1일 오후 2시',
      content: '[한줄상회] %고객명%님, 행사 안내드립니다.',
      callback: '0507-0000-0000',
      managers: '010-0000-1111, 010-0000-2222',
      image: '',
    }));
    expect(f.errors).toEqual([]);
    expect(f.subject).toBe('가을 행사 안내');
    expect(f.content).toContain('%고객명%');
    expect(f.requestedAt).not.toBeNull();
    expect(f.requestedAt!.getHours()).toBe(14);
    expect(f.callbackRaw).toBe('0507-0000-0000');
    expect(f.managerPhones).toEqual(['01000001111', '01000002222']);
  });

  it('템플릿 안내문("월 일 시 분"·발신번호 안내·①)은 값이 아니라 빈칸이다', () => {
    const f = parseAgencyRequestForm(industryBuffer({ content: '문안', managers: '01000001111' }));
    expect(f.requestedAtText).toBe('');
    expect(f.callbackRaw).toBe('');
    expect(f.imageFileName).toBe('');
    expect(f.errors.some((e) => e.field === '보낼 시각')).toBe(true);
    expect(f.errors.some((e) => e.field === '회신번호')).toBe(true);
  });

  it('문자타입이 알림톡·친구톡이면 반려하고, SMS·LMS·MMS·빈칸은 통과한다', () => {
    const base = { when: '2026-09-01 14:00', content: '문안', callback: '0507-0000-0000', managers: '01000001111', image: '' };
    expect(parseAgencyRequestForm(industryBuffer({ ...base, type: '알림톡' })).errors.some((e) => e.field === '문자타입')).toBe(true);
    expect(parseAgencyRequestForm(industryBuffer({ ...base, type: '친구톡' })).errors.some((e) => e.field === '문자타입')).toBe(true);
    expect(parseAgencyRequestForm(industryBuffer({ ...base, type: 'LMS' })).errors).toEqual([]);
    expect(parseAgencyRequestForm(industryBuffer(base)).errors).toEqual([]);
  });

  it('이미지 파일명 칸의 실제 값은 imageFileName으로 노출된다(이메일 경로 반려 재료)', () => {
    const f = parseAgencyRequestForm(industryBuffer({
      when: '2026-09-01 14:00', content: '문안', callback: '0507-0000-0000', managers: '01000001111', image: 'banner.jpg',
    }));
    expect(f.imageFileName).toBe('banner.jpg');
  });

  it('명단은 같은 파일의 "고객리스트" 시트에서 읽는다(첫 시트 "내용"이 명단으로 오독되지 않는다)', () => {
    const buf = industryBuffer({ content: '문안', callback: '0507', managers: '01000001111' });
    const list = parseAgencyRecipientList(buf);
    expect(list.headers[0]).toBe('고객명');
    expect(list.rows.length).toBe(2);
    expect(hasRecipientSheet(buf)).toBe(true);
    expect(looksLikeRequestForm(buf)).toBe(true);
  });

  it('"내용" 시트 단독은 요청서로 보지 않고, 예시 시트 이름은 명단이 아니다', () => {
    const solo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(solo, XLSX.utils.aoa_to_sheet([['내용만']]), '내용');
    const soloBuf = XLSX.write(solo, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(looksLikeRequestForm(soloBuf)).toBe(false);
    const sample = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(sample, XLSX.utils.aoa_to_sheet([['휴대폰번호'], ['01000001111']]), '고객 명단 예시');
    const sampleBuf = XLSX.write(sample, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(hasRecipientSheet(sampleBuf)).toBe(false);
  });

  it('한국어 시각 표기: 연도 필수, 오전·오후·요일 괄호 허용, 달력 왕복 대조 유지', () => {
    expect(parseWhenText('2026년 9월 1일 14시 30분')!.getMinutes()).toBe(30);
    expect(parseWhenText('2026년 9월 1일(월) 오후 2시')!.getHours()).toBe(14);
    expect(parseWhenText('2026년 9월 1일 오전 12시')!.getHours()).toBe(0);
    expect(parseWhenText('9월 1일 14시')).toBeNull();
    expect(parseWhenText('2026년 2월 30일 14시')).toBeNull();
    expect(parseWhenText('월 일 시 분')).toBeNull();
  });
});
