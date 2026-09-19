/**
 * ★ 2026-09-19 Harold 지시 — 한줄로 인증번호(로그인 다중인증 · 발신번호 추가인증)를 승인 알림톡 템플릿으로 보내고
 *   알림톡이 실패하면 같은 문구를 문자로 자동 전환한다.
 *
 * 0919 운영 실측(Harold): 두 템플릿 모두 APPROVED · 발신프로필 "한줄로" 활성.
 *   B_NG_013_02_84157 다중인증 인증번호 = "[한줄로]\n로그인 인증번호\n#{인증번호}를 5분안에 입력 해주세요."
 *   B_NG_013_02_84158 추가인증 인증번호 = "[한줄로]\n발신 인증번호\n#{인증번호}를 5분안에 입력 해주세요."
 *
 * 못 박는 것:
 *   1. 스위치(ENV)가 없으면 아무것도 바뀌지 않는다 — 배포만으로는 종전 문자 그대로.
 *   2. 알림톡을 못 싣는 이유가 하나라도 있으면 false = 호출부가 종전 문자를 보낸다(로그인·발신 인증이 막히지 않는다).
 *   3. 본문은 템플릿 원장(kakao_templates.content)을 채운 것 — 승인 문구와 글자까지 같아야 카카오가 받는다.
 *   4. 실패 전환 = 같은 문구 SMS('S') · 인증번호 짧은 문구라 SMS에 들어간다.
 *   5. 고객사 청구·발송결과·AI 학습에 안 잡힌다 — app_etc1 미기재(청구·학습 조건 불충족) ·
 *      회사 식별(app_etc2)은 비토 라인일 때만(발신프로필 키 도출에 필요).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../sms-queue', () => ({
  insertAlimtalkQueue: vi.fn(async () => 1),
  getBitoSmsTables: vi.fn(async () => [] as string[]),
  getPlatformNoticeCallback: vi.fn(() => '18008125'),
}));

import { query } from '../../config/database';
import { insertAlimtalkQueue, getBitoSmsTables } from '../sms-queue';
import { trySendAuthCodeAlimtalk, isAuthAlimtalkEnabled, AUTH_ALIMTALK_TEMPLATES } from '../system-alimtalk';

const q = query as unknown as ReturnType<typeof vi.fn>;
const ins = insertAlimtalkQueue as unknown as ReturnType<typeof vi.fn>;
const bito = getBitoSmsTables as unknown as ReturnType<typeof vi.fn>;

const COMPANY = 'c0000000-0000-0000-0000-000000000001';
const TPL: Record<string, string> = {
  B_NG_013_02_84157: '[한줄로]\n로그인 인증번호\n#{인증번호}를 5분안에 입력 해주세요.',
  B_NG_013_02_84158: '[한줄로]\n발신 인증번호\n#{인증번호}를 5분안에 입력 해주세요.',
};

function mockDb(opts: { status?: string; active?: boolean | null; content?: string; tables?: string[] | null } = {}) {
  q.mockImplementation(async (sql: string, params: any[]) => {
    if (/FROM kakao_templates/.test(sql)) {
      const code = params[0];
      return { rows: [{ company_id: COMPANY, content: opts.content ?? TPL[code], status: opts.status ?? 'APPROVED', is_active: opts.active ?? true }] };
    }
    if (/FROM sms_line_groups/.test(sql)) {
      return { rows: opts.tables === null ? [] : [{ sms_tables: opts.tables ?? ['SMSQ_SEND_3'] }] };
    }
    return { rows: [] };
  });
}

const ENV_KEYS = ['SYSTEM_ALIMTALK_KINDS', 'SYSTEM_ALIMTALK_LINE_GROUP'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  q.mockReset(); ins.mockReset(); bito.mockReset();
  ins.mockResolvedValue(1);
  bito.mockResolvedValue([]);
  process.env.SYSTEM_ALIMTALK_KINDS = 'mfa_login,sender_auth';
  process.env.SYSTEM_ALIMTALK_LINE_GROUP = '한줄로01';
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('스위치', () => {
  it('ENV가 없으면 꺼짐 — DB·큐 접근 0(배포만으로는 종전 문자)', async () => {
    delete process.env.SYSTEM_ALIMTALK_KINDS;
    delete process.env.SYSTEM_ALIMTALK_LINE_GROUP;
    expect(await trySendAuthCodeAlimtalk('mfa_login', '010-0000-0000', '123456')).toBe(false);
    expect(q).not.toHaveBeenCalled();
    expect(ins).not.toHaveBeenCalled();
  });

  it('종류만 켜고 라인그룹이 없으면 꺼짐', () => {
    delete process.env.SYSTEM_ALIMTALK_LINE_GROUP;
    expect(isAuthAlimtalkEnabled('mfa_login')).toBe(false);
  });

  it('종류별로 따로 켠다 — 로그인만 켜면 발신 인증은 종전 문자', async () => {
    process.env.SYSTEM_ALIMTALK_KINDS = 'mfa_login';
    mockDb();
    expect(await trySendAuthCodeAlimtalk('sender_auth', '01000000000', '123456')).toBe(false);
    expect(ins).not.toHaveBeenCalled();
  });
});

describe('적재', () => {
  it('로그인 = 승인 템플릿 본문 그대로 · 실패 시 같은 문구 SMS · 플랫폼 대표번호', async () => {
    mockDb();
    expect(await trySendAuthCodeAlimtalk('mfa_login', '010-0000-0000', '123456')).toBe(true);
    expect(ins).toHaveBeenCalledTimes(1);
    const [tables, rows, appEtc1] = ins.mock.calls[0];
    expect(tables).toEqual(['SMSQ_SEND_3']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      phone: '01000000000',
      callback: '18008125',
      message: '[한줄로]\n로그인 인증번호\n123456를 5분안에 입력 해주세요.',
      templateCode: 'B_NG_013_02_84157',
      nextType: 'S',
    });
    // 청구(app_etc1='test' AND app_etc2)·발송결과·AI 학습 코퍼스(appEtc1 필수) 어디에도 안 잡힌다
    expect(appEtc1).toBeUndefined();
    expect(rows[0].companyId).toBeUndefined();
  });

  it('발신 인증 = 추가인증 템플릿', async () => {
    mockDb();
    expect(await trySendAuthCodeAlimtalk('sender_auth', '01000000000', '654321')).toBe(true);
    expect(ins.mock.calls[0][1][0]).toMatchObject({
      templateCode: 'B_NG_013_02_84158',
      message: '[한줄로]\n발신 인증번호\n654321를 5분안에 입력 해주세요.',
    });
  });

  it('비토 라인이면 템플릿 소유 회사를 싣는다(발신프로필 키 도출에 필요)', async () => {
    mockDb();
    bito.mockResolvedValue(['SMSQ_SEND_3']);
    expect(await trySendAuthCodeAlimtalk('mfa_login', '01000000000', '123456')).toBe(true);
    expect(ins.mock.calls[0][1][0].companyId).toBe(COMPANY);
  });

  it('SMS 전환 문구가 SMS 한 통(90바이트)에 들어간다', () => {
    for (const content of Object.values(TPL)) {
      const filled = content.replace('#{인증번호}', '123456');
      const bytes = [...filled].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
      expect(bytes).toBeLessThanOrEqual(90);
    }
  });
});

describe('못 싣으면 false = 호출부가 종전 문자', () => {
  it.each([
    ['승인 아님', { status: 'REJECTED' }],
    ['발신프로필 비활성', { active: false }],
    ['라인그룹 없음', { tables: null }],
    ['라인그룹 테이블 이름 이상', { tables: ['DROP TABLE x'] }],
    ['템플릿에 채울 수 없는 변수', { content: '[한줄로]\n#{인증번호} #{이름}' }],
  ])('%s', async (_label, opts) => {
    mockDb(opts as any);
    expect(await trySendAuthCodeAlimtalk('mfa_login', '01000000000', '123456')).toBe(false);
    expect(ins).not.toHaveBeenCalled();
  });

  it('템플릿이 원장에 없음', async () => {
    q.mockImplementation(async () => ({ rows: [] }));
    expect(await trySendAuthCodeAlimtalk('mfa_login', '01000000000', '123456')).toBe(false);
    expect(ins).not.toHaveBeenCalled();
  });

  it('큐 적재 실패(throw)', async () => {
    mockDb();
    ins.mockRejectedValue(new Error('mysql down'));
    expect(await trySendAuthCodeAlimtalk('mfa_login', '01000000000', '123456')).toBe(false);
  });
});

describe('템플릿 코드 원장', () => {
  it('0919 운영 실측 코드와 같다', () => {
    expect(AUTH_ALIMTALK_TEMPLATES).toEqual({ mfa_login: 'B_NG_013_02_84157', sender_auth: 'B_NG_013_02_84158' });
  });
});
