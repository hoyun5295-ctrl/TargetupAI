/**
 * 단문 제목 (2026-09-22 접수 · 비토 콘솔 SMS 에 제목 말풍선 · hanjul02 SMS 142,457건 중 7,974건에 title_str)
 *
 * 직접발송 화면은 제목 칸을 LMS·MMS 에만 그리는데 SMS 로 바꿔도 제목 값이 남아 서버로 왔고,
 * 적재 경로가 유형을 보지 않고 그 값을 title_str 에 실었다.
 *
 * 못 박는 것:
 *   1. subjectForMsgType — 단문('SMS'·'S' · 대소문자 무관)이면 빈 값. LMS·MMS·모르는 유형은 제목 그대로
 *      (모르는 유형은 toQtmsgType 이 'L' 로 보낸다 — 지우면 제목 없는 LMS 가 된다).
 *   2. 직접발송 청크(processSendChunk) — SMS 행 title_str 은 빈 값 · LMS 행은 제목 그대로(광고 표기 규칙도 그대로).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('./sms-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sms-queue')>();
  return { ...actual, bulkInsertSmsQueue: vi.fn(async (_tables: string[], rows: any[][]) => rows.length) };
});

import { bulkInsertSmsQueue } from './sms-queue';
import { subjectForMsgType } from './qtmsg-type';
import { processSendChunk, type SendChunkParams } from './direct-send-processor';

const ins = bulkInsertSmsQueue as unknown as ReturnType<typeof vi.fn>;

function params(over: Partial<SendChunkParams>): SendChunkParams {
  return {
    companyId: 'c-1',
    campaignId: 'camp-1',
    companyTables: ['SMSQ_SEND_1'],
    recipients: [{ phone: '01000000001', sendTime: '' }],
    directFieldMappings: {},
    sendChannel: 'sms',
    msgType: 'SMS',
    message: '안내입니다',
    subject: '남은 제목',
    callback: '0200000000',
    useIndividualCallback: false,
    finalIsAd: false,
    opt080: '',
    mmsImagePaths: [],
    useNow: true,
    scheduled: false,
    ...over,
  };
}

describe('subjectForMsgType — 제목은 LMS·MMS 에만', () => {
  it('단문이면 빈 값이다(풀네임·단축코드·소문자)', () => {
    expect(subjectForMsgType('SMS', '제목')).toBe('');
    expect(subjectForMsgType('S', '제목')).toBe('');
    expect(subjectForMsgType('sms', '제목')).toBe('');
  });
  it('LMS·MMS 는 제목 그대로다', () => {
    expect(subjectForMsgType('LMS', '제목')).toBe('제목');
    expect(subjectForMsgType('MMS', '제목')).toBe('제목');
    expect(subjectForMsgType('L', '제목')).toBe('제목');
  });
  it('모르는 유형은 지우지 않는다 · 제목이 없으면 빈 값', () => {
    expect(subjectForMsgType('KAKAO', '제목')).toBe('제목');
    expect(subjectForMsgType('LMS', null)).toBe('');
    expect(subjectForMsgType('LMS', undefined)).toBe('');
  });
});

describe('processSendChunk 문자 — 단문 행에 제목을 싣지 않는다', () => {
  beforeEach(() => { ins.mockClear(); });

  it('SMS 행의 title_str 은 빈 값이다(화면에서 남은 제목이 와도)', async () => {
    await processSendChunk(params({ msgType: 'SMS', subject: '남은 제목' }));
    const [row] = ins.mock.calls[0][1];
    expect(row[3]).toBe('S');
    expect(row[4]).toBe('');
  });

  it('LMS 행은 제목 그대로다', async () => {
    await processSendChunk(params({ msgType: 'LMS', subject: '가을 안내' }));
    const [row] = ins.mock.calls[0][1];
    expect(row[3]).toBe('L');
    expect(row[4]).toBe('가을 안내');
  });

  it('광고 LMS 의 제목 규칙은 그대로다(제목이 비면 (광고))', async () => {
    await processSendChunk(params({ msgType: 'LMS', subject: '', finalIsAd: true, opt080: '0800000000' }));
    const [row] = ins.mock.calls[0][1];
    expect(row[4]).toBe('(광고)');
  });
});
