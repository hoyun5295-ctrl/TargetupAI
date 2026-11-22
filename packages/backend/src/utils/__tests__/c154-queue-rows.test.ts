/**
 * C154 발송 원장 굴리기 — 큐 · 이력 표 낱행 읽기(★ 2026-11-22 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md S2)
 *   판정 자리 = 실제로 나가는 SQL 글(R94 지킴이 queueScanVerdict) · 만료 실패 조건 = 캠페인 합계 CT(smsCampaignCountsSafe)와 같은 글.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'mysql2/promise';

const calls: Array<{ ms: number; sql: string; params?: any[] }> = [];
let rowsToReturn: any[] = [];
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn() },
  mysqlPool: { getConnection: vi.fn() },
  mysqlQuery: vi.fn(async () => []),
  withBoundedMysql: vi.fn(async (ms: number, work: (run: (sql: string, params?: any[]) => Promise<any>) => Promise<any>) =>
    work(async (sql: string, params?: any[]) => { calls.push({ ms, sql, params }); return rowsToReturn; })),
}));

import { queueScanVerdict } from '../queue-scan-guard';
import { SUCCESS_CODES, PENDING_CODES } from '../sms-result-map';
import { smsCampaignRowsAfter, CAMPAIGN_ROWS_QUERY_MS } from '../sms-queue';

const CAMP = '7c1f0000-0000-4000-8000-000000000001';
const SUC = SUCCESS_CODES.join(',');
const PEN = PENDING_CODES.join(',');

beforeEach(() => { calls.length = 0; rowsToReturn = []; });

describe('낱행 읽기 SQL', () => {
  it('결과 표 = 그 캠페인의 전 행을 seqno 뒤에서부터 · 조건 맨 앞 = app_etc1 · 오프셋 없음 · 지킴이 통과', async () => {
    rowsToReturn = [{ seqno: 11, dest_no: '01000000001', status_code: 6, mob_company: '11' }];
    const rows = await smsCampaignRowsAfter('SMSQ_SEND_1_202611', CAMP, 10, 5000, false);
    expect(rows).toEqual(rowsToReturn);
    expect(calls).toHaveLength(1);
    expect(calls[0].ms).toBe(CAMPAIGN_ROWS_QUERY_MS);
    expect(calls[0].sql).toBe('SELECT /*+ MAX_EXECUTION_TIME(5000) */ seqno, dest_no, status_code, mob_company FROM SMSQ_SEND_1_202611 WHERE app_etc1 = ? AND seqno > ? ORDER BY seqno LIMIT 5000');
    expect(calls[0].params).toEqual([CAMP, 10]);
    expect(calls[0].sql).not.toMatch(/OFFSET/i);
    expect(queueScanVerdict(format(calls[0].sql, calls[0].params))).toBeNull();
  });
  it('대기 전용 라이브 = 만료 실패만(비성공 · 비대기이고 보낸 시각이 없다) · 지킴이 통과', async () => {
    await smsCampaignRowsAfter('SMSQ_SEND_1', CAMP, 0, 5000, true);
    expect(calls[0].sql).toBe(`SELECT /*+ MAX_EXECUTION_TIME(5000) */ seqno, dest_no, status_code, mob_company FROM SMSQ_SEND_1 WHERE app_etc1 = ? AND seqno > ? AND status_code NOT IN (${SUC}, ${PEN}) AND mobsend_time IS NULL ORDER BY seqno LIMIT 5000`);
    expect(queueScanVerdict(format(calls[0].sql, calls[0].params))).toBeNull();
  });
  it('표 이름이 큐 표가 아니면 읽지 않는다 · 줄 수는 1 ~ 10,000 으로 자른다', async () => {
    expect(await smsCampaignRowsAfter('customers; DROP TABLE x', CAMP, 0, 5000, false)).toEqual([]);
    expect(calls).toHaveLength(0);
    await smsCampaignRowsAfter('SMSQ_SEND_1', CAMP, 0, 999999, false);
    expect(calls[0].sql).toMatch(/LIMIT 10000$/);
  });
  it('만료 실패 조건의 글 = 캠페인 합계 CT(smsCampaignCountsSafe)의 조건과 같다', () => {
    const src = readFileSync(join(__dirname, '..', 'sms-queue.ts'), 'utf8');
    // 합계 CT 가 대기 전용 라이브에서 만료 실패를 세는 식
    expect(src).toContain('SUM(CASE WHEN status_code NOT IN (${SUC}, ${PEN}) AND mobsend_time IS NULL THEN 1 ELSE 0 END) as lf');
    // 낱행 읽기가 쓰는 조건 — 같은 두 낱말 묶음(성공 · 대기가 아님 + 보낸 시각 없음)
    //   (★ 구현 Codex 3R — 조건 글자는 상수 하나 · 낱행 읽기 문장과 켜기 전 확인 스크립트가 같이 쓴다)
    expect(src).toContain('export const CAMPAIGN_EXPIRED_ROWS_WHERE = `status_code NOT IN (${SUCCESS_CODES.join(\',\')}, ${PENDING_CODES.join(\',\')}) AND mobsend_time IS NULL`;');
    expect(src).toContain("const expired = expiredOnly ? ` AND ${CAMPAIGN_EXPIRED_ROWS_WHERE}` : '';");
    const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'c154-m1-queue-facts.ts'), 'utf8');
    expect(script).toContain('await heaviestIn(table, campIds, CAMPAIGN_EXPIRED_ROWS_WHERE)');
  });
});
