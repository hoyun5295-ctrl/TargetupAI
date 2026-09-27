/**
 * 발송 결과 집계·표시 (★ 2026-09-27 한줄로 V2 차수 1 RES 묶음)
 *
 * m004 ★Harold 결정 「7305(카카오 성공불확실 · 30일 대기) 즉시 환불 유지 + 7305 캠페인 회수 창 30일」
 *      → 정산 스위퍼 후보 창을 카카오 결과가 나올 수 있는 캠페인(브랜드 계열 + 알림톡)만 30일로(그 밖은 14일 그대로).
 * m112·m113 결과 목록 limit 상한 없음 · 숫자 아니면 LIMIT NaN(SQL 오류) → 페이지·건수 보정 CT(화면 값 2000·페이지 크기는 그대로 통과).
 * m114 요약 기본 월이 UTC → KST 매월 1일 00~09시에 전월이 보였다 → KST 월 CT.
 * m135 캠페인 테이블 CT가 기준일 하나(적재 시각) ±1개월만 봐 두 달 넘게 앞선 예약 직접발송은 결과·엑셀이 0행 → 기준일 여럿(적재·예약·생성).
 * m140 예약 수신자 페이지 정렬 키 seqno가 테이블마다 독립 → (seqno, 테이블)로 · 음수 offset은 0.
 * R131 발송통계 테스트 탭이 테스트 라인 LIVE만 봐 LOG로 옮겨진 완료 테스트가 빠졌다 → 기간 LOG 합류(정산과 같은 CT).
 * (m077 · A-05 = 결과가 수렴하는 이력 문제라 설계 과제 · m121 = 결과 화면 표시 위치 결정 → Harold 확인 필요 · 장부)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('m004 카카오 결과 캠페인 회수 창 30일', () => {
  it('채널 CT = 브랜드 계열 + 알림톡', async () => {
    const { KAKAO_RESULT_CHANNELS } = await import('../billing-types');
    expect([...KAKAO_RESULT_CHANNELS].sort()).toEqual(['alimtalk', 'both', 'kakao', 'kakao_brand']);
  });
  it('스위퍼 후보 창: 카카오 계열 30일 · 그 밖 14일', () => {
    const s = src('mysql-refund-sweeper.ts');
    expect(s).toContain("WHEN c.send_channel IN (${KAKAO_RESULT_CHANNEL_SQL_IN}) OR c.message_type IN ('KAKAO', 'BRAND') THEN INTERVAL '30 days'");
    expect(s).toContain("ELSE INTERVAL '14 days' END)");
    // 두 달 경계를 넘는 30일 후보는 3개월 이력(Codex RES 1R)
    expect(s).toContain('mergeLineTables(await getCompanySmsTablesWithLogs(cid, uid || undefined), await getCompanySmsTablesWithLogsRange(cid, 3))');
  });
});

describe('페이지·건수 보정 CT', () => {
  it('숫자 아님·음수·상한 초과', async () => {
    const { parsePageParams, parseOffsetParam } = await import('../normalize');
    expect(parsePageParams('abc', 'x', { defaultLimit: 20, maxLimit: 2000 })).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parsePageParams('3', '2000', { defaultLimit: 20, maxLimit: 2000 })).toEqual({ page: 3, limit: 2000, offset: 4000 });
    expect(parsePageParams('2', '999999', { defaultLimit: 20, maxLimit: 2000 }).limit).toBe(2000);
    expect(parsePageParams('-1', '0', { defaultLimit: 50, maxLimit: 100 })).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(parseOffsetParam('-5')).toBe(0);
    expect(parseOffsetParam('abc')).toBe(0);
    expect(parseOffsetParam('40')).toBe(40);
  });
  it('결과 목록 두 곳·예약 수신자가 CT를 쓴다', () => {
    const r = src('..', 'routes', 'results.ts');
    expect(r).toContain('parsePageParams(page, limit, { defaultLimit: 20, maxLimit: 2000 })');
    expect(r).toContain('parsePageParams(page, limit, { defaultLimit: 100, maxLimit: 1000 })');
    expect(r).toContain('totalPages: Math.ceil(total / pageParams.limit),');
    const c = src('..', 'routes', 'campaigns.ts');
    const at = c.indexOf("router.get('/:id/recipients'");
    const body = c.slice(at, at + 4000);
    expect(body).toContain('const offset = parseOffsetParam(req.query.offset);');
    expect(body).toContain("'seqno ASC, _sms_table ASC', limit, offset");
  });
});

describe('m114 요약 기본 월 = KST', () => {
  it('UTC toISOString 대신 KST 월 CT', () => {
    const r = src('..', 'routes', 'results.ts');
    expect(r).toContain('const yearMonth = String(from || kstMonthTag(new Date()));');
  });
});

describe('m135 캠페인 테이블 = 기준일 여럿', () => {
  it('적재·예약·생성 날짜 각각의 전후 달', async () => {
    vi.resetModules();
    vi.doMock('../../config/database', () => ({
      query: vi.fn(async () => ({ rows: [{ sms_tables: ['SMSQ_SEND_1'] }] })),
      mysqlQuery: vi.fn(async () => [
        { TABLE_NAME: 'SMSQ_SEND_1' }, { TABLE_NAME: 'SMSQ_SEND_1_202607' }, { TABLE_NAME: 'SMSQ_SEND_1_202609' },
      ]),
    }));
    const sq = await import('../sms-queue');
    const tables = await sq.getCampaignSmsTablesFor('co-1', {
      created_by: null, send_config: { sentTables: ['SMSQ_SEND_1'] },
      sent_at: '2026-07-10T00:00:00Z', scheduled_at: '2026-09-20T00:00:00Z', created_at: '2026-07-10T00:00:00Z',
    });
    expect(tables).toContain('SMSQ_SEND_1_202607');   // 적재 달
    expect(tables).toContain('SMSQ_SEND_1_202609');   // 예약(발송) 달 — 옛 판정은 이 달을 놓쳤다
    vi.doUnmock('../../config/database');
  });
});

describe('R131 테스트 통계 = LIVE + 기간 LOG', () => {
  it('정산과 같은 기간 테이블 CT', () => {
    const m = src('..', 'routes', 'manage-stats.ts');
    expect(m).toContain('const testTables = await getTablesForBillingPeriod(await getTestSmsTables(), testStartDate || TEST_STATS_EPOCH, testEndDate || kstDateString(new Date()));');
  });
});
