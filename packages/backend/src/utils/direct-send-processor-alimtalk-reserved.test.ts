/**
 * 직접발송 청크 처리 — 알림톡 행에 예약·분할 시각을 싣는다 (2026-09-14 박성용 접수 · 알림톡 예약·분할)
 *
 * 워커(direct-send-worker)는 채널과 무관하게 수신자마다 sendTime을 계산해 넘긴다.
 * 문자·브랜드는 그 값을 큐에 실었는데 알림톡만 버려서, 예약 접수가 즉시 발송이 됐다.
 *
 * 못 박는 것:
 *   1. 즉시 발송이 아니면(useNow=false: 예약 또는 분할) 알림톡 행의 reservedDate = 그 수신자의 sendTime.
 *   2. 즉시 발송(useNow=true)이면 reservedDate를 싣지 않는다(큐가 NOW()).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('./sms-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sms-queue')>();
  return { ...actual, insertAlimtalkQueue: vi.fn(async (_tables: string[], rows: any[]) => rows.length) };
});

import { insertAlimtalkQueue } from './sms-queue';
import { processSendChunk, type SendChunkParams } from './direct-send-processor';

const ins = insertAlimtalkQueue as unknown as ReturnType<typeof vi.fn>;

function params(over: Partial<SendChunkParams>): SendChunkParams {
  return {
    companyId: 'c-1',
    campaignId: 'camp-1',
    companyTables: ['SMSQ_SEND_1'],
    recipients: [],
    directFieldMappings: {},
    sendChannel: 'alimtalk',
    msgType: 'LMS',
    message: '안내입니다',
    subject: '',
    callback: '0200000000',
    useIndividualCallback: false,
    finalIsAd: false,
    opt080: '',
    mmsImagePaths: [],
    useNow: false,
    scheduled: true,
    alimtalkTemplateCode: 'T1',
    alimtalkVariableMap: {},
    alimtalkNextType: 'N',
    alimtalkNextContents: '',
    alimtalkNextSubject: '',
    ...over,
  };
}

describe('processSendChunk 알림톡 — 발송 시각 전달', () => {
  beforeEach(() => { ins.mockClear(); });

  it('예약·분할이면 수신자마다 계산된 sendTime을 reservedDate로 싣는다', async () => {
    const result = await processSendChunk(params({
      useNow: false,
      recipients: [
        { phone: '01000000001', sendTime: '2026-12-01 10:00:00' },
        { phone: '01000000002', sendTime: '2026-12-01 10:01:00' },
      ],
    }));
    expect(result.sentCount).toBe(2);
    const rows = ins.mock.calls[0][1];
    expect(rows.map((r: any) => r.reservedDate)).toEqual(['2026-12-01 10:00:00', '2026-12-01 10:01:00']);
  });

  it('즉시 발송이면 reservedDate를 싣지 않는다', async () => {
    await processSendChunk(params({
      useNow: true,
      scheduled: false,
      recipients: [{ phone: '01000000003', sendTime: '' }],
    }));
    const rows = ins.mock.calls[0][1];
    expect(rows[0].reservedDate).toBeUndefined();
  });
});
