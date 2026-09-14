/**
 * 알림톡 큐 적재의 발송 시각 (2026-09-14 박성용 접수 cmu0zpd0z02gyjnluuclvxk9r · 알림톡 예약·분할)
 *
 * 못 박는 것:
 *   1. 행에 예약 시각(reservedDate)이 있으면 sendreq_time에 그 시각을 넣는다(예약·분할).
 *   2. 없으면 지금처럼 NOW()다(자동캠페인·여정·옛 직접발송 호출부는 시각을 넘기지 않는다 = 동작 불변).
 *   전에는 reservedDate를 선언만 하고 NOW()로 고정해, 예약으로 접수된 알림톡이 즉시 나갔다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
}));
vi.mock('./training-logger', () => ({ logCampaignTraining: vi.fn(async () => undefined), getSourceRef: vi.fn(() => 'ref') }));

import { mysqlQuery } from '../config/database';
import { insertAlimtalkQueue } from './sms-queue';

const mq = mysqlQuery as unknown as ReturnType<typeof vi.fn>;

/** INSERT 문의 ? 자리에 파라미터를 채우고 행별 값 목록으로 쪼갠다(테스트 값에는 쉼표를 쓰지 않는다). */
function boundTuples(sql: string, params: any[]): string[][] {
  let i = 0;
  const bound = sql.replace(/\?/g, () => JSON.stringify(params[i++]));
  const valuesPart = bound.slice(bound.indexOf('VALUES') + 'VALUES'.length).trim();
  return valuesPart
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split('),(')
    .map((t) => t.split(', ').map((v) => v.trim()));
}

// 컬럼 순서: dest_no, call_back, msg_contents, msg_type, title_str, k_template_code, k_next_type,
//            k_next_contents, k_button_json, sendreq_time(10번째), msg_instm, rsv1, k_etc_json, app_etc1, app_etc2
const SENDREQ_TIME = 9;

const row = (phone: string, reservedDate?: string) => ({
  phone, callback: '0200000000', message: '안내', templateCode: 'T1', nextType: 'N', companyId: 'c-1',
  ...(reservedDate ? { reservedDate } : {}),
});

describe('insertAlimtalkQueue — 발송 시각', () => {
  beforeEach(() => { mq.mockClear(); });

  it('예약·분할 시각이 있으면 행마다 그 시각을 sendreq_time에 넣는다', async () => {
    await insertAlimtalkQueue(['SMSQ_SEND_1'], [
      row('01000000001', '2026-12-01 10:00:00'),
      row('01000000002', '2026-12-01 10:01:00'),
    ], 'camp-1');
    const [sql, params] = mq.mock.calls[0];
    const tuples = boundTuples(String(sql), params);
    expect(tuples.map((t) => t[SENDREQ_TIME])).toEqual(['"2026-12-01 10:00:00"', '"2026-12-01 10:01:00"']);
    expect(tuples.map((t) => t[0])).toEqual(['"01000000001"', '"01000000002"']);
  });

  it('시각이 없으면 NOW()로 즉시 발송한다(기존 호출부 동작 불변)', async () => {
    await insertAlimtalkQueue(['SMSQ_SEND_1'], [row('01000000003')], 'camp-2');
    const [sql, params] = mq.mock.calls[0];
    const tuples = boundTuples(String(sql), params);
    expect(tuples[0][SENDREQ_TIME]).toBe('NOW()');
    expect(tuples[0][13]).toBe('"camp-2"');
  });
});
