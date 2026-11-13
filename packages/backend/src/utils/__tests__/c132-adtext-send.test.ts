/**
 * C132 ④ 이메일 대행 = 고객 문안 그대로 — 동작 시험(★ 2026-11-13 · 설계서 docs/2026-11-13-c132-four-tickets-design.md §2 · T4-3 · T4-4)
 *   조립기(processSendChunk) = adText false 면 광고여도 (광고) · 무료거부를 붙이지 않는다 · 비우면 종전(finalIsAd 대로).
 *   대행 표본(buildRenderedSample) = 행 정책 ad_text false 면 문안 그대로 · NULL 이면 종전 표기.
 * DB · 큐 = 가짜(qtmsg-type-subject.test.ts 와 같은 꼴).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string) => (String(sql).includes('agency_send_recipients')
    ? { rows: [{ phone: '01000000001', vars: null }] }
    : { rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock('../sms-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sms-queue')>();
  return { ...actual, bulkInsertSmsQueue: vi.fn(async (_tables: string[], rows: any[][]) => rows.length) };
});

import { bulkInsertSmsQueue } from '../sms-queue';
import { processSendChunk, type SendChunkParams } from '../direct-send-processor';
import { buildRenderedSample } from '../agency-send-preview';

const ins = bulkInsertSmsQueue as unknown as ReturnType<typeof vi.fn>;

function params(over: Partial<SendChunkParams>): SendChunkParams {
  return {
    companyId: 'c-1', campaignId: 'camp-1', companyTables: ['SMSQ_SEND_1'],
    recipients: [{ phone: '01000000001', sendTime: '' }], directFieldMappings: {},
    sendChannel: 'sms', msgType: 'SMS', message: '가을 세일 안내\n※ 수신거부 : 080-000-0000', subject: '', callback: '0200000000',
    useIndividualCallback: false, finalIsAd: false, opt080: '', mmsImagePaths: [], useNow: true, scheduled: false,
    ...over,
  };
}
const sentText = () => JSON.stringify(ins.mock.calls[0][1][0]);

describe('T4-4 조립기 — 표기 끔 표식', () => {
  beforeEach(() => { ins.mockClear(); });

  it('광고 + adText false = 고객 문안 그대로((광고) · 무료거부 없음)', async () => {
    await processSendChunk(params({ finalIsAd: true, adText: false, opt080: '' }));
    const row = sentText();
    expect(row).toContain('가을 세일 안내');
    expect(row).not.toContain('(광고)');
    expect(row).not.toContain('무료거부');
  });

  it('광고 + 표식 없음 = 종전((광고) · 무료거부 080)', async () => {
    await processSendChunk(params({ finalIsAd: true, opt080: '0800000000' }));
    const row = sentText();
    expect(row).toContain('(광고)');
    expect(row).toContain('무료거부0800000000');
  });

  it('광고 아님 = 표식과 무관하게 표기 없음(종전)', async () => {
    await processSendChunk(params({ finalIsAd: false, adText: true }));
    expect(sentText()).not.toContain('(광고)');
  });
});

describe('T4-3 대행 표본 — 행에 고정한 정책', () => {
  const row = (adText: boolean | null) => ({
    id: '00000000-0000-0000-0000-0000000c1320', company_id: '00000000-0000-0000-0000-0000000c1321', created_by: null,
    is_ad: true, ad_text: adText, current_content: '가을 세일 안내', message_type: 'SMS', subject: '',
  });
  it('이메일 접수(ad_text false) = 문안 그대로', async () => {
    const s = await buildRenderedSample(row(false));
    expect(s.text).toBe('가을 세일 안내');
  });
  it('배포 전 접수(ad_text NULL) · 화면(true) = 종전 표기', async () => {
    for (const v of [null, true]) {
      const s = await buildRenderedSample(row(v));
      expect(s.text.startsWith('(광고)')).toBe(true);
      expect(s.text).toContain('무료거부');
    }
  });
});
