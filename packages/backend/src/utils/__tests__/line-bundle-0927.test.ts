/**
 * 라인 그룹 캐시 · 적재 테이블 기록 · 예약 정리 집계 (★ 2026-09-27 한줄로 V2 차수 1 LINE 묶음 — m065 · m118 · m136)
 *
 * m065 라인 캐시 무효화에 회사·사용자를 넘기면 그 두 키만 지워, 그 값에서 파생된 합집합 키(all-bulk · all-bito · companyUsers:)가
 *      수명(60초)까지 옛 테이블 목록으로 남았다 → 무효화는 늘 전부 지운다(캐시는 작고 수명도 짧다).
 * m136 공유 캠페인(여정 단계·일당 1건)의 적재 테이블 기록(sentTables)을 실행마다 지금 라인으로 덮어써, 그 사이 라인이 재배정되면
 *      앞 적재의 테이블이 기록에서 빠졌다(결과 조회·취소·안전망이 그 행을 못 본다) → 기록은 합친다(CT 하나 · 적재 기록 3곳 전부).
 * m118 예약 정리(0건이면 10분 뒤 failed · sent_count 0 → 후불 청구 제외)가 캠페인이 실제로 적재한 테이블(sentTables)을 보지 않았다
 *      → 캠페인 테이블 CT(getCampaignSmsTablesWide = 기록 ∪ 회사 전 라인)로 센다.
 *      라인 그룹을 끄거나 지운 경우(기록 없는 캠페인)는 BILL 묶음 m063(집계 라인 = 활성 그룹만)과 같은 축이라 거기서 전 소비처를 함께 닫는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('m065 라인 캐시 무효화 = 전부', () => {
  it('회사를 넘겨 무효화해도 파생 합집합(all-bulk)을 다시 읽는다', async () => {
    vi.resetModules();
    const q = vi.fn(async () => ({ rows: [{ sms_tables: ['SMSQ_SEND_1'] }] }));
    vi.doMock('../../config/database', () => ({ query: q, mysqlQuery: vi.fn(async () => []), default: { query: q } }));
    const sq = await import('../sms-queue');
    await sq.getAllBulkSmsTables();
    await sq.getAllBulkSmsTables();
    expect(q).toHaveBeenCalledTimes(1);   // 캐시
    sq.invalidateLineGroupCache('c1', 'u1');
    await sq.getAllBulkSmsTables();
    expect(q, '회사·사용자 무효화 뒤에도 전 라인 합집합이 옛 목록이면 집계·취소가 새 라인을 못 본다').toHaveBeenCalledTimes(2);
    vi.doUnmock('../../config/database');
  });
});

describe('m136 적재 테이블 기록 = 합치기', () => {
  it('CT: 한 문장으로 기존 기록 ∪ 이번 테이블(중복 제거 · 배열이 아니면 빈 배열로)', async () => {
    vi.resetModules();
    const q = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../../config/database', () => ({ query: q, mysqlQuery: vi.fn(async () => []), default: { query: q } }));
    const sq = await import('../sms-queue');
    await sq.recordCampaignSentTables('camp-1', ['SMSQ_SEND_4', 'SMSQ_SEND_5']);
    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = (q.mock.calls[0] as any);
    expect(sql).toContain("jsonb_array_elements_text(");
    expect(sql).toContain("jsonb_typeof(send_config->'sentTables') = 'array'");
    expect(sql).toContain('|| $1::jsonb');
    expect(sql).toContain('jsonb_agg(DISTINCT t ORDER BY t)');
    expect(sql).toMatch(/WHERE id = \$2/);
    expect(params).toEqual([JSON.stringify(['SMSQ_SEND_4', 'SMSQ_SEND_5']), 'camp-1']);
    vi.doUnmock('../../config/database');
  });
  it('기록하는 세 곳(여정 · 대량 워커 · 브랜드)이 전부 CT를 쓰고 덮어쓰기 SQL이 없다', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
    for (const f of ['journey-executor.ts', 'direct-send-worker.ts', 'brand-message.ts']) {
      const s = src(f);
      expect(s, f).toContain('recordCampaignSentTables(');
      expect(s, f).not.toMatch(/'\{sentTables\}', \$\d::jsonb\)/);
    }
  });
});

describe('m118 예약 정리 = 캠페인이 실제로 적재한 테이블로 센다', () => {
  const state: { updates: any[][] } = { updates: [] };
  beforeEach(() => { state.updates = []; });
  it('기록 테이블에만 있는 행도 세어 completed(0건 failed로 굳지 않는다)', async () => {
    vi.resetModules();
    const camp = {
      id: 'camp-1', company_id: 'co-1', created_by: 'u-1', scheduled_at: new Date(Date.now() - 60 * 60 * 1000),
      send_channel: 'sms', message_type: 'SMS', send_config: { sentTables: ['SMSQ_SEND_9'] },
      // ★ Codex LINE 1R — 대량 워커는 예약도 적재 시각을 sent_at에 적는다(7/31 적재 · 9/1 발송). 기준일이 sent_at이면 발송 월 이력을 놓친다.
      sent_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), created_at: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000),
    };
    vi.doMock('../../config/database', () => ({
      query: vi.fn(async (sql: string, p: any[]) => {
        if (/FROM campaigns/.test(sql) && /status = 'scheduled'/.test(sql)) return { rows: [camp] };
        if (/^\s*UPDATE campaigns/.test(sql)) state.updates.push(p);
        return { rows: [] };
      }),
      mysqlQuery: vi.fn(async () => []),
    }));
    const wide = vi.fn(async () => ['SMSQ_SEND_1', 'SMSQ_SEND_9']);
    const base = vi.fn(async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609']);
    vi.doMock('../sms-queue', () => ({
      getCompanySmsTablesWithLogs: base,
      mergeLineTables: (a: string[], b: string[]) => [...new Set([...a, ...b])],
      getCampaignSmsTablesWide: wide,
      getCampaignQueueTables: vi.fn(async () => []),
      smsCountAll: vi.fn(async () => 0), smsExecAll: vi.fn(async () => undefined),
      smsCampaignCountsSafe: vi.fn(async (tables: string[], ids: string[]) =>
        new Map(tables.includes('SMSQ_SEND_9') ? [[ids[0], { total: 5, success: 5, fail: 0, pending: 0 }]] : [])),
    }));
    vi.doMock('../prepaid', () => ({ prepaidRefund: vi.fn(async () => ({ refunded: 0 })), REFUND_KEYS: { FAIL: 'FAIL' } }));
    const { cleanupScheduledCampaigns } = await import('../campaign-lifecycle');
    await cleanupScheduledCampaigns();
    // 기준일 = 예약 시각(sent_at을 비워 넘긴다) · 기존 당월·전월 범위(회사 라인)도 함께
    expect(wide).toHaveBeenCalledWith('co-1', expect.objectContaining({ id: 'camp-1', send_config: camp.send_config, sent_at: null }));
    expect(base).toHaveBeenCalledWith('co-1');
    expect(state.updates[0]?.[0]).toBe('completed');
    expect(state.updates[0]?.[1]).toBe(5);
    vi.doUnmock('../../config/database'); vi.doUnmock('../sms-queue'); vi.doUnmock('../prepaid');
  });
  it('정리 대상 SELECT가 테이블 해석에 필요한 칸(작성자·send_config·기준 시각)을 읽는다', () => {
    const s = readFileSync(join(__dirname, '..', 'campaign-lifecycle.ts'), 'utf8');
    const fn = s.slice(s.indexOf('export async function cleanupScheduledCampaigns('), s.indexOf('export async function failCampaignRun('));
    expect(fn).toMatch(/SELECT id, company_id, created_by, scheduled_at, sent_at, created_at, send_config, send_channel, message_type FROM campaigns/);
    expect(fn).toContain('await getCampaignSmsTablesWide(camp.company_id, { ...camp, sent_at: null })');
    expect(fn).toContain('await getCompanySmsTablesWithLogs(camp.company_id)');
    expect(fn).toContain('mergeLineTables(');
  });
});
