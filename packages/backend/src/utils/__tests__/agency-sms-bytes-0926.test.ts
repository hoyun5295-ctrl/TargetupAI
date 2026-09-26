/**
 * 대행 접수 SMS/LMS = 실제로 나가는 문장의 바이트로 가른다 (★2026-09-26 한줄로 V2 R1-08)
 *
 * 옛: 원스텝·메일 접수가 **글자 수 45**로 SMS/LMS를 갈랐다(바이트 아님 · 광고 표기·무료거부 줄 · 변수 값 제외).
 *     → 광고 문구가 붙어 90바이트를 넘는 SMS가 접수되고(통신 규격 초과 · 선불은 SMS 단가로 차감되는데 LMS로 나감),
 *       영문 위주 46자 이상은 90바이트 안인데도 LMS 과금. 화면 접수는 SMS 길이를 아예 보지 않았다.
 * 처방: 실제 발송·미리보기와 같은 조립 CT(`prepareSendMessage` · 슬롯 계획 · 080)로 **가장 긴 수신자 문장**의
 *   EUC-KR 바이트를 잰다(measureAgencyMaxSmsBytes). 원스텝·메일은 그 값으로 SMS/LMS를 고르고,
 *   모든 입구가 지나는 접수 코어는 SMS인데 90바이트를 넘으면 반려한다(SMS_TOO_LONG).
 *   후보 = 변수 값 바이트(등장 횟수 가중) 상위 5명만 실제 조립 — 10만 명 명단도 조립은 5번.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), default: {} }));
vi.mock('../messageUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  prepareFieldMappings: vi.fn(async () => ({})),
  getOpt080Number: vi.fn(async () => '0800000000'),
}));

import { measureAgencyMaxSmsBytes } from '../agency-send-preview';
import { eucKrByteLength } from '../message-byte';

const CO = '00000000-0000-4000-8000-000000000001';

describe('measureAgencyMaxSmsBytes', () => {
  it('광고가 아니면 본문 바이트 그대로', async () => {
    const n = await measureAgencyMaxSmsBytes({ companyId: CO, userId: null, content: 'hello', isAd: false, recipients: [] });
    expect(n).toBe(5);
  });

  it('광고면 (광고) 표기와 무료거부 줄까지 센다', async () => {
    const body = '가'.repeat(40); // 80바이트
    const n = await measureAgencyMaxSmsBytes({ companyId: CO, userId: null, content: body, isAd: true, recipients: [] });
    expect(n).toBeGreaterThan(90);
    expect(n).toBe(eucKrByteLength(`(광고)${body}\n무료거부0800000000`));
  });

  it('변수가 있으면 가장 긴 수신자 문장 기준', async () => {
    const n = await measureAgencyMaxSmsBytes({
      companyId: CO, userId: null, content: '%이름%님 안녕', isAd: false,
      recipients: [{ vars: { 이름: '가' } }, { vars: { 이름: '가나다라마바사아자차' } }, { vars: { 이름: 'ab' } }],
    });
    expect(n).toBe(eucKrByteLength('가나다라마바사아자차님 안녕'));
  });
});

describe('배선', () => {
  const src = readFileSync(join(__dirname, '..', 'agency-send-intake.ts'), 'utf8');
  it('원스텝 분석은 글자 45가 아니라 바이트로 가른다', () => {
    expect(src).not.toMatch(/content\.length > 45/);
    expect(src).toMatch(/maxSmsBytes !== null && maxSmsBytes > SMS_MAX_BYTES/);
  });
  it('접수 코어는 SMS가 90바이트를 넘으면 반려한다(트랜잭션 전 · 사전값 우선)', () => {
    const core = src.slice(src.indexOf('export async function createRequestCore('), src.indexOf('export function kickFirstTest('));
    const iCheck = core.indexOf("code: 'SMS_TOO_LONG'");
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(core.indexOf('const client = extClient || await pool.connect();'));
    expect(core).toContain('pre?.maxSmsBytes');
  });
  it('트랜잭션 안에서 코어를 부르는 두 입구는 사전값을 넘긴다', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes', 'agency-send.ts'), 'utf8');
    const mail = readFileSync(join(__dirname, '..', 'agency-send-mail-worker.ts'), 'utf8');
    expect(route).toContain('maxSmsBytes: analysis.maxSmsBytes');
    expect(mail).toContain('maxSmsBytes: p.analysis.maxSmsBytes');
  });
});

describe('화면 접수: 유형은 접수 코어가 정한다 (Codex 8차 1R·2R high 구조 정정)', () => {
  const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
  const composer = readFileSync(join(FE, 'components', 'agency', 'AgencySendComposer.tsx'), 'utf8');
  const api = readFileSync(join(FE, 'components', 'agency', 'agency-send-api.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '..', '..', 'routes', 'agency-send.ts'), 'utf8');
  const intake = readFileSync(join(__dirname, '..', 'agency-send-intake.ts'), 'utf8');
  it('글자 45 규칙이 없다', () => {
    expect(composer).not.toMatch(/content\.length > 45/);
  });
  it('화면은 유형을 확정하지 않고 AUTO로 보낸다(이미지면 MMS)', () => {
    expect(composer).toContain("messageType: mms.mmsUploadedImages.length > 0 ? 'MMS' : 'AUTO',");
    expect(api).toContain("messageType: 'SMS' | 'LMS' | 'MMS' | 'AUTO';");
  });
  it('접수 코어가 AUTO를 실제 넣을 수신자로 잰 바이트로 정한다(제목 → LMS · 초과인데 제목 없음 → 반려)', () => {
    const core = intake.slice(intake.indexOf('export async function createRequestCore('), intake.indexOf('export function kickFirstTest('));
    expect(core).toContain("['SMS', 'LMS', 'MMS', 'AUTO'].includes(type)");
    expect(core).toContain("code: 'SUBJECT_REQUIRED_LONG'");
  });
  it('제목 필수는 이미지 문자뿐 · 장문 판단은 접수 코어 반려(SUBJECT_REQUIRED_LONG)가 정한다(Codex 8차 3R)', () => {
    expect(composer).toContain('const subjectRequired = mms.mmsUploadedImages.length > 0;');
    expect(composer).not.toContain("smsJudge === 'pending'");
    expect(composer).toContain("e?.code === 'SUBJECT_REQUIRED_LONG'");
    expect(composer).toContain("fetch('/api/agency-send/sms-bytes'");
    expect(route).toContain("router.post('/sms-bytes'");
  });
  it('화면 번호 정규화 = 코어와 같다(앞자리 0 복원 뒤 중복 제거 · 안내값과 접수 행이 같다)', () => {
    const fmt = readFileSync(join(FE, 'utils', 'formatDate.ts'), 'utf8');
    expect(fmt).toContain('export function normalizeAgencyPhoneFront(');
    expect(fmt).toContain('/^1[016789]\\d{8}$/');
    expect((composer.match(/normalizeAgencyPhoneFront\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('측정 입력 = 접수 입력(앞뒤 공백 제거)', () => {
    expect(composer).toContain('content: content.trim(), isAd, candidates:');
    expect(route).toContain("const content = String(req.body?.content ?? '').trim();");
  });
});

describe('AUTO 반려(DB 전)', () => {
  it('SMS 한도를 넘는데 제목이 없으면 SUBJECT_REQUIRED_LONG', async () => {
    const { createRequestCore } = await import('../agency-send-intake');
    const r = await createRequestCore(
      { companyId: '00000000-0000-0000-0000-000000000001', userId: '00000000-0000-0000-0000-000000000002' },
      {
        messageType: 'AUTO', content: '긴 문안', callbackNumber: '0500000000',
        managerPhones: ['01000001111'], requestedAt: new Date(Date.now() + 200 * 60000).toISOString(),
        recipients: [{ phone: '01000002222', vars: {} }],
      } as any,
      undefined,
      { registeredSet: new Set(['0500000000']), window: { startHour: 0, endHour: 24 } as any, maxSmsBytes: 95 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as any).code).toBe('SUBJECT_REQUIRED_LONG');
  });
});
