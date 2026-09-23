import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { buildXlsxBuffer } from './xlsx-writer';
import {
  ALIMTALK_STATUS_LABELS,
  ALIMTALK_MSG_TYPE_LABELS,
  ALIMTALK_EMPH_TYPE_LABELS,
  BRAND_BUBBLE_LABELS,
  BRAND_STATUS_LABELS,
  RCS_STATUS_LABELS,
  buildAlimtalkTemplateSheet,
  buildBrandTemplateSheet,
  buildRcsTemplateSheet,
  formatKstDateTime,
  formatTemplateButtons,
  templateExportFilename,
} from './template-export';

/**
 * ★ 2026-09-23 템플릿 엑셀 다운로드(숭실원격평생교육원 요청 · 알림톡·브랜드·RCS 템플릿 관리 화면).
 *   행 빌더는 순수 함수라 DB 없이 검증한다. 마지막 묶음은 "화면 라벨 = 엑셀 라벨" 계약이다 —
 *   라벨이 화면(프론트)과 엑셀(백엔드) 두 곳에 있으니, 한쪽만 바뀌면 여기서 멈춘다.
 */

const NOW = new Date('2026-09-23T00:46:00Z'); // KST 2026-09-23 09:46

async function load(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb.worksheets[0];
}

describe('formatKstDateTime — 한국시간 「YYYY-MM-DD HH:mm」', () => {
  it('UTC 시각을 한국시간으로 적는다', () => {
    expect(formatKstDateTime(new Date('2026-09-22T15:05:00Z'))).toBe('2026-09-23 00:05');
  });
  it('문자열 시각도 받는다', () => {
    expect(formatKstDateTime('2026-09-23T00:46:00.000Z')).toBe('2026-09-23 09:46');
  });
  it('값이 없거나 날짜가 아니면 빈칸', () => {
    expect(formatKstDateTime(null)).toBe('');
    expect(formatKstDateTime(undefined)).toBe('');
    expect(formatKstDateTime('not-a-date')).toBe('');
  });
});

describe('formatTemplateButtons — 「버튼명: 링크」 한 줄씩', () => {
  it('알림톡 저장 형태(camelCase) — 모바일 링크를 먼저, 링크 없는 버튼은 이름만', () => {
    expect(formatTemplateButtons([
      { name: '자세히 보기', type: 'WL', urlMobile: 'https://m.example.invalid', urlPc: 'https://example.invalid' },
      { name: '채널 추가', type: 'AC' },
    ])).toBe('자세히 보기: https://m.example.invalid\n채널 추가');
  });
  it('브랜드 저장 형태(snake_case)', () => {
    expect(formatTemplateButtons([{ name: '구매하기', type: 'WL', url_mobile: 'https://m.example.invalid' }]))
      .toBe('구매하기: https://m.example.invalid');
  });
  it('앱링크는 모바일 링크가 없으면 스킴을 적는다', () => {
    expect(formatTemplateButtons([{ name: '앱 열기', type: 'AL', schemeAndroid: 'app://open' }]))
      .toBe('앱 열기: app://open');
  });
  it('RCS 저장 형태 — 전화번호·복사 문구', () => {
    expect(formatTemplateButtons([
      { buttonType: 'DIAL', name: '전화하기', phoneNumber: '0200000000' },
      { buttonType: 'COPY', name: '쿠폰 복사', copyText: 'ABC123' },
      { buttonType: 'URL', name: '홈페이지', url: 'https://example.invalid' },
    ])).toBe('전화하기: 0200000000\n쿠폰 복사: ABC123\n홈페이지: https://example.invalid');
  });
  it('버튼이 없거나 배열이 아니면 빈칸 · 문자열 JSON은 풀어서 읽는다', () => {
    expect(formatTemplateButtons(null)).toBe('');
    expect(formatTemplateButtons([])).toBe('');
    expect(formatTemplateButtons({})).toBe('');
    expect(formatTemplateButtons('[{"name":"보기","urlMobile":"https://m.example.invalid"}]'))
      .toBe('보기: https://m.example.invalid');
    expect(formatTemplateButtons('깨진 값')).toBe('');
  });
});

describe('templateExportFilename — 「종류_한국날짜.xlsx」', () => {
  it('종류별 이름 + KST 날짜', () => {
    expect(templateExportFilename('alimtalk', NOW)).toBe('알림톡템플릿_20260923.xlsx');
    expect(templateExportFilename('brand', NOW)).toBe('브랜드템플릿_20260923.xlsx');
    expect(templateExportFilename('rcs', NOW)).toBe('RCS템플릿_20260923.xlsx');
  });
  it('UTC로는 전날이어도 한국 날짜로 적는다', () => {
    expect(templateExportFilename('rcs', new Date('2026-09-22T16:00:00Z'))).toBe('RCS템플릿_20260923.xlsx');
  });
  // 화면에 한글로 도착하는지는 utils/__tests__/auth-download-filename.test.ts 계약이 본다
});

const ALIMTALK_ROW = {
  template_name: '수강신청 완료 안내',
  template_code: 'T0001',
  custom_template_code: 'EDU-01',
  profile_name: '숭실원격평생교육원',
  message_type: 'BA',
  emphasize_type: 'TEXT',
  emphasize_title: '신청 완료',
  emphasize_subtitle: '2학기',
  status: 'APR',
  content: '#{이름}님 수강신청이 완료되었습니다.\n감사합니다.',
  extra_content: '문의 0200000000',
  buttons: [{ name: '강의실 가기', type: 'WL', urlMobile: 'https://m.example.invalid' }],
  reject_reason: null,
  created_by_name: '홍길동',
  created_by_login_id: 'hong',
  created_at: new Date('2026-09-01T01:00:00Z'),
  updated_at: new Date('2026-09-02T02:30:00Z'),
};

describe('buildAlimtalkTemplateSheet — 알림톡 템플릿 목록', () => {
  it('열 순서가 고정이다', () => {
    const spec = buildAlimtalkTemplateSheet([], NOW);
    expect(spec.columns.map((c) => c.header)).toEqual([
      '템플릿명', '템플릿코드', '고객사 관리코드', '발신프로필', '유형', '상태',
      '강조 제목', '본문', '부가정보', '버튼', '반려사유', '등록자', '등록일시', '수정일시',
    ]);
  });
  it('한 행 = 화면과 같은 라벨 + 본문·버튼', () => {
    const spec = buildAlimtalkTemplateSheet([ALIMTALK_ROW], NOW);
    expect(spec.rows).toEqual([[
      '수강신청 완료 안내', 'T0001', 'EDU-01', '숭실원격평생교육원', '기본형·강조 표기형', '승인',
      '신청 완료\n2학기', '#{이름}님 수강신청이 완료되었습니다.\n감사합니다.', '문의 0200000000',
      '강의실 가기: https://m.example.invalid', '', '홍길동 (hong)', '2026-09-01 10:00', '2026-09-02 11:30',
    ]]);
  });
  it('강조 없는 유형은 메시지 유형만 · 모르는 상태는 저장값 그대로 · 빈 값은 빈칸', () => {
    const [row] = buildAlimtalkTemplateSheet([{
      template_name: 'X', message_type: 'EX', emphasize_type: 'NONE', status: 'ZZZ',
      created_by_name: null, created_by_login_id: null, created_at: null, updated_at: null,
    }], NOW).rows;
    expect(row[4]).toBe('부가 정보형');
    expect(row[5]).toBe('ZZZ');
    expect(row[1]).toBe('');
    expect(row[11]).toBe('');
    expect(row[12]).toBe('');
  });
  it('반려 행은 반려사유가 실린다', () => {
    const [row] = buildAlimtalkTemplateSheet([{ ...ALIMTALK_ROW, status: 'KREJ', reject_reason: '변수 과다' }], NOW).rows;
    expect(row[5]).toBe('카카오 반려');
    expect(row[10]).toBe('변수 과다');
  });
  it('제목·기준 시각·건수가 파일 위에 적힌다', () => {
    const spec = buildAlimtalkTemplateSheet([ALIMTALK_ROW, ALIMTALK_ROW], NOW);
    expect(spec.sheetName).toBe('알림톡 템플릿');
    expect(spec.title).toBe('알림톡 템플릿 목록');
    expect(spec.caption).toContain('2026-09-23 09:46 기준');
    expect(spec.caption).toContain('총 2건');
  });
  it('실제 엑셀로 열린다 — 머리행·첫 행 확인', async () => {
    const ws = await load(await buildXlsxBuffer(buildAlimtalkTemplateSheet([ALIMTALK_ROW], NOW)));
    // 제목(1) · 설명(2) · 빈 줄(3) → 머리행 4, 첫 데이터 5
    expect(ws.getCell(4, 1).value).toBe('템플릿명');
    expect(ws.getCell(5, 1).value).toBe('수강신청 완료 안내');
    expect(ws.getCell(5, 8).value).toBe('#{이름}님 수강신청이 완료되었습니다.\n감사합니다.');
  });
});

describe('buildBrandTemplateSheet — 브랜드 템플릿 목록', () => {
  const ROW = {
    manage_name: '가을 할인', template_key: 'BRT_1', custom_template_code: null, profile_name: '채널A',
    chat_bubble_type: 'WIDE', status: 'ACTIVE', header: null, content: '가을 할인 시작', additional_content: null,
    buttons: [{ name: '보러가기', type: 'WL', url_mobile: 'https://m.example.invalid' }],
    created_at: new Date('2026-09-10T00:00:00Z'), updated_at: new Date('2026-09-11T00:00:00Z'),
  };
  it('열 순서가 고정이다', () => {
    expect(buildBrandTemplateSheet([], NOW).columns.map((c) => c.header)).toEqual([
      '관리명', '템플릿키', '고객사 관리코드', '발신프로필', '유형', '상태',
      '헤더', '본문', '부가 내용', '버튼', '등록일시', '최종 수정',
    ]);
  });
  it('한 행 = 화면과 같은 유형·상태 라벨', () => {
    expect(buildBrandTemplateSheet([ROW], NOW).rows).toEqual([[
      '가을 할인', 'BRT_1', '', '채널A', '와이드', '정상',
      '', '가을 할인 시작', '', '보러가기: https://m.example.invalid', '2026-09-10 09:00', '2026-09-11 09:00',
    ]]);
  });
  it('시트 이름·제목', () => {
    const spec = buildBrandTemplateSheet([ROW], NOW);
    expect(spec.sheetName).toBe('브랜드 템플릿');
    expect(spec.title).toBe('브랜드메시지 템플릿 목록');
    expect(spec.caption).toContain('총 1건');
  });
});

describe('buildRcsTemplateSheet — RCS 템플릿 목록', () => {
  const ROW = {
    template_name: '예약 확인', message_type: 'rcs_lms', status: 'pending', brand_name: '브랜드B',
    content: '예약이 확인되었습니다', buttons: [{ buttonType: 'URL', name: '예약 보기', url: 'https://example.invalid' }],
    reject_reason: null, created_at: new Date('2026-09-05T03:00:00Z'),
  };
  it('열 순서가 고정이다', () => {
    expect(buildRcsTemplateSheet([], NOW).columns.map((c) => c.header)).toEqual([
      '템플릿명', '메시지 유형', '상태', '브랜드', '본문', '버튼', '반려사유', '등록일시',
    ]);
  });
  it('한 행 — 메시지 유형은 화면처럼 저장값 그대로', () => {
    expect(buildRcsTemplateSheet([ROW], NOW).rows).toEqual([[
      '예약 확인', 'rcs_lms', '승인대기', '브랜드B', '예약이 확인되었습니다',
      '예약 보기: https://example.invalid', '', '2026-09-05 12:00',
    ]]);
  });
  it('시트 이름·제목', () => {
    const spec = buildRcsTemplateSheet([ROW], NOW);
    expect(spec.sheetName).toBe('RCS 템플릿');
    expect(spec.title).toBe('RCS 템플릿 목록');
  });
});

// ── 계약: 엑셀 라벨 = 화면 라벨 ─────────────────────────────────────
const FRONT = path.resolve(__dirname, '../../../frontend/src');

function read(rel: string): string {
  return fs.readFileSync(path.join(FRONT, rel), 'utf8');
}

/** startMarker부터 첫 endMarker까지 잘라낸다 */
function block(src: string, startMarker: string, endMarker: string): string {
  const s = src.indexOf(startMarker);
  expect(s, `${startMarker} 선언을 찾지 못했습니다`).toBeGreaterThanOrEqual(0);
  const e = src.indexOf(endMarker, s);
  return src.slice(s, e);
}

/** `KEY: { label: '라벨'` 모양 */
function pillLabels(src: string): Record<string, string> {
  return Object.fromEntries([...src.matchAll(/(\w+):\s*\{\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

/** `KEY: '라벨'` 모양 */
function plainLabels(src: string): Record<string, string> {
  return Object.fromEntries([...src.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

/** `{ value: 'KEY', label: '라벨'` 모양 */
function optionLabels(src: string): Record<string, string> {
  return Object.fromEntries([...src.matchAll(/\{\s*value:\s*'(\w+)',\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}

describe('계약 — 엑셀 라벨은 화면 라벨과 같다(한쪽만 고치면 여기서 멈춘다)', () => {
  it('알림톡 상태', () => {
    const src = read('components/alimtalk/AlimtalkManagementSection.tsx');
    expect(ALIMTALK_STATUS_LABELS).toEqual(pillLabels(block(src, 'const STATUS_LABELS', '\n};')));
  });
  it('알림톡 메시지 유형·강조 유형', () => {
    const src = read('components/alimtalk/alimtalk-types.ts');
    expect(ALIMTALK_MSG_TYPE_LABELS).toEqual(optionLabels(block(src, 'export const MSG_TYPES', '\n];')));
    expect(ALIMTALK_EMPH_TYPE_LABELS).toEqual(optionLabels(block(src, 'export const EMPH_TYPES', '\n];')));
  });
  it('브랜드 유형·상태', () => {
    const src = read('components/alimtalk/BrandTemplateManagementSection.tsx');
    expect(BRAND_BUBBLE_LABELS).toEqual(plainLabels(block(src, 'const CHAT_BUBBLE_LABELS', '\n};')));
    expect(BRAND_STATUS_LABELS).toEqual(pillLabels(block(src, 'const STATUS_LABELS', '\n};')));
  });
  it('RCS 상태', () => {
    const src = read('pages/KakaoRcsPage.tsx');
    expect(RCS_STATUS_LABELS).toEqual(pillLabels(block(src, 'const STATUS_BADGE', '\n};')));
  });
});
