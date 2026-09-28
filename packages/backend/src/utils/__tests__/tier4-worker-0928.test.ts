/**
 * 한줄로 V2 차수 4 — WORKER · SWP · ALERT · FAT 묶음 (★2026-09-28 Harold 「추천대로 차수 4 진행」)
 *
 * 판정표 = docs/2026-09-26-hanjul-source-audit-remaining-verdicts.md · 장부 = docs/2026-09-25-hanjul-source-audit.md §2-11.
 *   A-08 MySQL 기동 검사 재시도 · m056 쓰이지 않는 타임아웃 환불 회수 제거 · m057 같은 테이블 묶음 한 번 집계
 *   m083 적재 중 캠페인의 updated_at 을 환불 워커가 밀지 않음 · R175 동기화 끝 판정 = 적재 수
 *   m117 재대조 보류 건의 72h 졸업 · m115 여정 결과 안내 조회 창 > 보류 한도 · m132 적재 0건이면 완료·쿨다운을 찍지 않음
 *   R294 기동 때 끊긴 풀분석 작업 실패 처리 · R306 무통장 요청 담당자 문자 10분 1통 · R345·R357 같은 보고는 config 재기록 안 함
 *   R267 IMC 템플릿 목록 한 사이클 1회 · R156~R159 20시간 멱등 창 · R261 지정일 스텝 하루 1회 추출 · m076 피로도 = 적재·발송일 기준
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
const bulkMock = vi.fn();
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn() },
  query: (...a: any[]) => (queryMock as any)(...a),
}));
vi.mock('../sms-queue', async (orig) => ({
  ...(await orig<any>()),
  getAuthSmsTable: async () => 'SMSQ_AUTH',
  bulkInsertSmsQueue: (...a: any[]) => (bulkMock as any)(...a),
}));

import { isReportedWorthWriting, REPORTED_REFRESH_MS } from '../agent-protocol';
import { recordFatigueSends } from '../fatigue-guard';
import { sendSystemAlert } from '../system-alert';
import { failOrphanedJobsOnBoot } from '../full-analysis-job';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

beforeEach(() => { queryMock.mockReset(); bulkMock.mockReset(); });

describe('R345·R357 에이전트 보고 재기록', () => {
  const stored = { dbType: 'mssql', columns: ['a', 'b'], agentVersion: '1.7.0', reportedAt: '2026-09-28T01:00:00.000Z' };
  const t0 = Date.parse('2026-09-28T01:10:00.000Z');
  it('내용이 같고 1시간 안이면 다시 쓰지 않는다(키 순서가 달라도 같다)', () => {
    const next = { agentVersion: '1.7.0', columns: ['a', 'b'], dbType: 'mssql', reportedAt: '2026-09-28T01:10:00.000Z' };
    expect(isReportedWorthWriting(stored, next, t0)).toBe(false);
  });
  it('내용이 다르면 쓴다 · 같아도 1시간 지나면 보고 시각을 쓴다 · 저장된 게 없으면 쓴다', () => {
    expect(isReportedWorthWriting(stored, { ...stored, columns: ['a'] }, t0)).toBe(true);
    expect(isReportedWorthWriting(stored, { ...stored, agentVersion: '1.8.0' }, t0)).toBe(true);
    expect(isReportedWorthWriting(stored, { ...stored }, Date.parse(stored.reportedAt) + REPORTED_REFRESH_MS)).toBe(true);
    expect(isReportedWorthWriting(undefined, stored, t0)).toBe(true);
  });
  it('heartbeat 가 판정 CT를 쓴다', () => {
    expect(src('routes/sync.ts')).toContain('const reportedChanged = !!reported && isReportedWorthWriting(currentConfig.reported, reported, Date.parse(nowIso));');
  });
});

describe('m076 피로도 기록 = 나가는 날', () => {
  it('수신자마다 발송일(KST)을 싣고 · 없거나 틀리면 오늘', async () => {
    queryMock.mockResolvedValue({ rowCount: 2 });
    await recordFatigueSends('11111111-2222-4333-8444-555555555555', ['010-0000-0001', '01000000002', ''], ['2026-10-02', 'bad', '2026-10-03']);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM UNNEST($2::text[], $3::date[]) AS u(phone, day)');
    expect(sql).toContain("COALESCE(u.day, (NOW() AT TIME ZONE 'Asia/Seoul')::date)");
    expect(params[1]).toEqual(['01000000001', '01000000002']);
    expect(params[2]).toEqual(['2026-10-02', null]);
  });
  it('AI·동기 직접발송은 적재가 된 때만 · 처리기는 행의 sendTime 날짜', () => {
    const c = src('routes/campaigns.ts');
    expect(c).toContain('if (campaign.is_ad && aiSentCount > 0) {');
    expect(c).toContain('if (finalIsAd && directTotalSent > 0) {');
    expect(src('utils/direct-send-processor.ts')).toContain('recipients.map((r) => (r.sendTime ? String(r.sendTime).slice(0, 10) : null))');
  });
});

describe('m132 적재 0건 = 보낸 것이 아니다', () => {
  it('시스템 경보: 적재 0건이면 쿨다운을 찍지 않는다', async () => {
    const old = process.env.SYSTEM_ALERT_PHONES;
    process.env.SYSTEM_ALERT_PHONES = '01000000009';
    queryMock.mockResolvedValue({ rows: [] }); // 쿨다운 조회 = 기록 없음
    bulkMock.mockResolvedValueOnce(0);
    expect(await sendSystemAlert({ dedupKey: 'test-0928', message: '시험' } as any)).toBe(0);
    expect(queryMock.mock.calls.some(([s]) => String(s).includes('INSERT INTO system_alert_state'))).toBe(false);
    bulkMock.mockResolvedValueOnce(1);
    expect(await sendSystemAlert({ dedupKey: 'test-0928', message: '시험' } as any)).toBe(1);
    expect(queryMock.mock.calls.some(([s]) => String(s).includes('INSERT INTO system_alert_state'))).toBe(true);
    process.env.SYSTEM_ALERT_PHONES = old;
  });
  it('여정 결과 안내: 적재 0건이면 던져서 표시를 되돌린다 · 조회 창 3시간 > 보류 2시간(m115)', () => {
    const s = src('utils/campaign-sync-worker.ts');
    expect(s).toContain("if (loaded === 0) throw new Error('여정 결과 안내 적재 0건');");
    expect(s).toContain("AND e.completed_at >= NOW() - INTERVAL '3 hours'");
    expect(s).toContain('const AGED_LIMIT_SEC = 2 * 60 * 60;');
  });
});

describe('R294 끊긴 풀분석 작업', () => {
  it('기동 때 queued·running 을 실패로 닫는다 · 표가 없으면 조용히 0', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 3 });
    expect(await failOrphanedJobsOnBoot()).toBe(3);
    expect(queryMock.mock.calls[0][0]).toContain("WHERE status IN ('queued', 'running')");
    queryMock.mockRejectedValueOnce(Object.assign(new Error('relation "full_analysis_jobs" does not exist'), { code: '42P01' }));
    expect(await failOrphanedJobsOnBoot()).toBe(0);
    expect(src('app.ts')).toContain('void failOrphanedJobsOnBoot()');
  });
});

describe('환불 워커(SWP) · 발송 워커', () => {
  it('m056 타임아웃 환불 회수 조회 제거(만드는 코드 없음 · 07-06 타임아웃 폐지)', () => {
    const s = src('utils/mysql-refund-sweeper.ts');
    expect(s).not.toContain('reverseTimeoutRefundIfRecovered');
    expect(s).not.toContain("LIKE '%타임아웃 실패 환불%'");
  });
  it('m057 같은 테이블 묶음은 한 번 집계', () => {
    const s = src('utils/mysql-refund-sweeper.ts');
    expect(s).toContain("const sig = [...tables].sort().join('|');");
    expect(s).toContain('for (const { tables, camps } of byTables.values()) {');
  });
  it('m083 적재 중(processing)이면 환불 워커가 updated_at 을 밀지 않는다', () => {
    expect(src('utils/mysql-refund-sweeper.ts')).toContain("updated_at = CASE WHEN send_phase = 'processing' THEN updated_at ELSE NOW() END");
    expect(src('utils/direct-send-worker.ts')).toContain("WHERE send_phase = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'");
  });
  it('R175 동기화 끝 판정 = 적재 수(없으면 대상 수) · AI 실행·직접발송 둘 다', () => {
    const s = src('utils/campaign-lifecycle.ts');
    expect(s).toContain('OR COALESCE(NULLIF(cr.sent_count, 0), cr.target_count) > COALESCE(cr.success_count, 0) + COALESCE(cr.fail_count, 0))');
    expect(s).toContain('OR COALESCE(NULLIF(sent_count, 0), target_count) > COALESCE(success_count, 0) + COALESCE(fail_count, 0))');
    expect(s).not.toContain('OR target_count > COALESCE(success_count, 0)');
  });
});

describe('반복 부하·알림 남용', () => {
  it('R156~R159 20시간 멱등 창 · DM 후보는 최근 열람에서 출발', () => {
    const s = src('utils/ai-memory-accumulator-worker.ts');
    expect(s).toContain('const REPEAT_GATE_MS = 20 * 60 * 60 * 1000;');
    expect(s).toContain('if (nowMs - _journeyLearnedAt < REPEAT_GATE_MS) return 0;');
    expect(s).toContain('_insightIdleAt = companies.rows.length < INSIGHT_BATCH ? nowMs : 0;');
    expect(s).toContain("WHERE p.id IN (SELECT v.dm_id FROM dm_views v WHERE v.last_active_at >= NOW() - INTERVAL '7 days')");
    expect(s).not.toContain('SELECT DISTINCT t.company_id, t.dm_id');
    expect(s).toContain('if (doneRecently(_dmDoneAt, String(row.dm_id), dmNow)) continue;');
    expect(s).toContain('if (doneRecently(_emailDoneAt, String(row.id), emailNow)) continue;');
  });
  it('R261 지정일 스텝은 하루 한 번 추출(성공한 뒤에만 표시)', () => {
    const s = src('utils/journey-anchor-scheduler.ts');
    expect(s).toContain('if (_anchorStepDone.get(doneKey) === sendDate) continue;');
    expect(s.indexOf('_anchorStepDone.set(doneKey, sendDate);')).toBeGreaterThan(s.indexOf('const res = await dispatchAnchorStep('));
  });
  it('R306 무통장 요청: 10분 안 대기 요청이 있으면 담당자 문자 생략(요청은 받는다)', () => {
    const s = src('routes/balance.ts');
    expect(s).toContain("AND created_at > NOW() - INTERVAL '10 minutes'\n        LIMIT 1`,");
    expect(s).toContain('} else if (!heldReason) {\n      notifyChargeApprovers({');
  });
  it('A-08 MySQL 기동 검사 재시도(PostgreSQL 검사와 같은 5회)', () => {
    const s = src('config/database.ts');
    expect(s).toContain('const line = `[MySQL] 연결 재시도 ${attempt}/5: ${err?.message}`;');
    expect(s).toContain('❌ MySQL 연결 실패 (${attempt}회 재시도 후):');
  });
});
