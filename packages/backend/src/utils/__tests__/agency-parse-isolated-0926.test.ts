/**
 * 대행 요청서·명단 엑셀은 별도 프로세스에서 읽는다 (★2026-09-26 한줄로 V2 S1-H03 · Harold 결정 「별도 프로세스에서 읽기」)
 *
 * 옛: 원스텝 미리보기·확정과 이메일 워커가 업로드 엑셀을 API와 같은 프로세스에서 동기 파싱 → 큰 명단(0913 실측 20만 행 4초)이면
 *   그동안 발송 잠금·환불 sweeper·다른 고객 요청이 전부 멈췄다.
 * 처방: 파싱만 자식 프로세스로(결과 = 종전 파서가 돌려주는 값 그대로). 자식을 띄울 수 없는 환경이면 종전처럼 이 프로세스에서 읽는다.
 *   자식이 죽거나 시간을 넘기면 "읽지 못했습니다"로 반려한다(같은 파일을 이 프로세스에서 다시 읽어 멈추게 하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAgencyRequestForm, parseAgencyRecipientList } from '../agency-send-form';
import { parseAgencyFilesIsolated } from '../agency-send-parse-isolated';

function unifiedWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['제목', '가을 행사'],
    ['문안', '%이름%님 안녕하세요'],
    ['보낼 시각', '2099-01-02 10:00'],
    ['회신번호', '0212345678'],
    ['광고 여부', '예'],
    ['담당자 번호', '01000000000'],
  ]), '내용');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['이름', '휴대폰'],
    ['가', '01000000001'],
    ['나', '01000000002'],
  ]), '고객리스트');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseAgencyFilesIsolated', () => {
  it('자식 프로세스에서 읽은 값 = 종전 파서 값', async () => {
    const buf = unifiedWorkbook();
    const r = await parseAgencyFilesIsolated(buf, buf);
    expect(r.via).toBe('child');
    expect(r.form).toEqual(parseAgencyRequestForm(buf));
    expect(r.list).toEqual(parseAgencyRecipientList(buf));
  }, 30000);

  it('명단을 못 읽으면 list = null(종전 catch와 같은 판정)', async () => {
    const bad = Buffer.from('PK\u0003\u0004 broken zip');
    let inlineThrew = false;
    try { parseAgencyRecipientList(bad); } catch { inlineThrew = true; }
    expect(inlineThrew).toBe(true);
    const r = await parseAgencyFilesIsolated(null, bad);
    expect(r.form).toBeNull();
    expect(r.list).toBeNull();
  }, 30000);

  it('시간을 넘기면 읽지 못함으로 반려(이 프로세스에서 다시 읽지 않는다)', async () => {
    const buf = unifiedWorkbook();
    const r = await parseAgencyFilesIsolated(buf, buf, { timeoutMs: 1 });
    expect(r.via).toBe('child');
    expect(r.form?.errors.length).toBeGreaterThan(0);
    expect(r.list).toBeNull();
  }, 30000);
});

describe('배선', () => {
  const intake = readFileSync(join(__dirname, '..', 'agency-send-intake.ts'), 'utf8');
  const worker = readFileSync(join(__dirname, '..', 'agency-send-mail-worker.ts'), 'utf8');
  it('원스텝 분석은 넘겨받지 않은 파일을 별도 프로세스에서 읽는다', () => {
    expect(intake).toContain('await parseAgencyFilesIsolated(');
    expect(intake).not.toContain('parseAgencyRequestForm(formBuf)');
    expect(intake).not.toContain('parseAgencyRecipientList(effectiveListBuf)');
  });
  it('자식은 DB에 연결하지 않는다(DB 설정 모듈을 빈 모듈로 채운 뒤 파서를 불러온다)', () => {
    const child = readFileSync(join(__dirname, '..', '..', 'workers', 'agency-parse-child.ts'), 'utf8');
    expect(child).not.toMatch(/^import .*agency-send-form/m);
    const stub = child.indexOf('require.cache[dbPath] =');
    expect(stub).toBeGreaterThan(-1);
    expect(stub).toBeLessThan(child.indexOf("require('../utils/agency-send-form')"));
  });
  it('이메일 워커도 별도 프로세스에서 읽는다', () => {
    expect(worker).toContain('await parseAgencyFilesIsolated(u.formBuf, u.listBuf)');
    expect(worker).not.toContain('parseAgencyRequestForm(u.formBuf)');
    expect(worker).not.toContain('parseAgencyRecipientList(u.listBuf)');
  });
});
