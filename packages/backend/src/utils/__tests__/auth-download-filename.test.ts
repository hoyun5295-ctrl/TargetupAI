/**
 * 공용 인증 다운로드 헬퍼의 파일명 읽기 (2026-09-23 · frontend/src/lib/auth-download.ts)
 *
 * 못 박는 것:
 *   1. 헤더에 `filename*=UTF-8''…`(원래 이름)이 있으면 그것을 쓴다. `filename="…"` 은 구형 브라우저용
 *      ASCII 대체값이라 한글이 `_`·`?` 로 바뀌어 있다(수정 전에는 이쪽을 먼저 읽어 이름이 깨졌다).
 *   2. 이름에 `%` 가 있어도 다운로드가 실패하지 않는다(수정 전 = URIError → 다운로드 실패).
 *   3. 영문 이름·헤더 없음·`filename*` 만 있는 경우는 수정 전과 결과가 같다.
 *   4. 서버 엑셀 CT(xlsxContentDisposition)가 만든 헤더를 헬퍼가 읽으면 원래 한글 이름이 나온다.
 */
import { describe, it, expect } from 'vitest';
import contentDisposition from 'content-disposition';
import { filenameFromDisposition } from '../../../../frontend/src/lib/auth-download';
import { xlsxContentDisposition } from '../xlsx-writer';
import { templateExportFilename } from '../template-export';

const FB = 'FALLBACK.bin';

describe('filenameFromDisposition — 원래 이름(filename*)을 먼저 읽는다', () => {
  it('서버 엑셀 CT 헤더 · 한글 이름', () => {
    expect(filenameFromDisposition(xlsxContentDisposition('알림톡템플릿_20260923.xlsx'), FB)).toBe('알림톡템플릿_20260923.xlsx');
  });
  it('Express res.download 헤더 · 한글 이름(대행 제안서)', () => {
    expect(filenameFromDisposition(contentDisposition('한줄로_마케팅제안서_가을.pdf'), FB)).toBe('한줄로_마케팅제안서_가을.pdf');
  });
  it('한글과 % 가 함께 있는 이름', () => {
    expect(filenameFromDisposition(contentDisposition('할인30%.xlsx'), FB)).toBe('할인30%.xlsx');
  });
  it('charset 표기가 소문자여도 읽는다', () => {
    expect(filenameFromDisposition("attachment; filename*=utf-8''%ED%95%9C.pdf", FB)).toBe('한.pdf');
  });
  it('filename* 값이 깨져 있으면 filename= 으로 내려간다', () => {
    expect(filenameFromDisposition(`attachment; filename="a.pdf"; filename*=UTF-8''%E0%A4%A`, FB)).toBe('a.pdf');
  });
});

describe('filenameFromDisposition — 수정 전과 같은 결과', () => {
  it('영문 이름 · 엑셀 CT', () => {
    expect(filenameFromDisposition(xlsxContentDisposition('alimtalk_templates_20260923.xlsx'), FB)).toBe('alimtalk_templates_20260923.xlsx');
  });
  it('영문 이름 · res.download(filename= 만)', () => {
    expect(filenameFromDisposition(contentDisposition('request.xlsx'), FB)).toBe('request.xlsx');
  });
  it('따옴표 없는 filename=', () => {
    expect(filenameFromDisposition('attachment; filename=send_detail_1.csv', FB)).toBe('send_detail_1.csv');
  });
  it('filename* 만 있는 헤더', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%ED%95%9C.pdf", FB)).toBe('한.pdf');
  });
  it('헤더가 없으면 화면이 준 이름', () => {
    expect(filenameFromDisposition('', FB)).toBe(FB);
    expect(filenameFromDisposition('attachment', FB)).toBe(FB);
  });
});

describe('filenameFromDisposition — % 가 든 이름에서 다운로드가 죽지 않는다', () => {
  it('영문 이름에 %', () => {
    expect(filenameFromDisposition(contentDisposition('100%.xlsx'), FB)).toBe('100%.xlsx');
  });
});

describe('계약 — 템플릿 엑셀 파일명은 한글로 도착한다', () => {
  const NOW = new Date('2026-09-23T00:46:00Z');
  it.each([
    ['alimtalk', '알림톡템플릿_20260923.xlsx'],
    ['brand', '브랜드템플릿_20260923.xlsx'],
    ['rcs', 'RCS템플릿_20260923.xlsx'],
  ] as const)('%s → %s', (kind, name) => {
    const header = xlsxContentDisposition(templateExportFilename(kind, NOW));
    expect(filenameFromDisposition(header, FB)).toBe(name);
  });
});
