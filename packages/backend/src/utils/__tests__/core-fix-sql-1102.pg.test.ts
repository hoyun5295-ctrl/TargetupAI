// replaces: none
/**
 * 1102 핵심 처방의 새 SQL 전부 = 실 PostgreSQL 에서 한 번 이상 돈다(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md §7 · 메모리 「새 SQL = 실제 PG 시험 뒤 배포」).
 *
 * 다른 실 PG 파일이 효과를 보는 문장(실행기 · 승인 · 회차 · 멈춤 · 가입 근거 · A/B · 날짜 기준)은 그 파일에 있다.
 * 여기 = 화면 · 집계 · 주간 검사 · 업로드 질문이 부르는 새 조각(알림톡 칸 판정 · 클릭 통계 · 지도 광고 조각 · 새로 가입 축 · 신규 집계 · 주간 검사 고르기)을
 * 운영 함수 그대로 부르고 결과의 뜻 하나씩을 본다. 바깥(통신사 검사)만 시험이 쥔다.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ spamCalls: 0 }));
vi.mock('../journey-pretest-validator', async (orig) => ({
  ...(await orig() as any),
  runStepSpamTest: async () => { ctl.spamCalls++; return { verdict: 'pass', ok: true, enqueueOk: true, failedCarriers: [], matchedStopWords: [], score: 100 }; },
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: async () => 1, alertPassFailures: async () => undefined }));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { kakaoStepVerdict } from '../journey-kakao-step';
import { buildJourneyStats } from '../journey-stats';
import { buildLifecycleMap } from '../journey-lifecycle-map';
import { loadCompanySegmentFacts, countOperatorAudienceFor } from '../operator-audience';
import { normalizeSegmentParams } from '../automarketing-segment';
import { buildJourneyOpportunities } from '../journey-opportunities';
import { buildPerformanceSnapshot } from '../next-action-advisor';
import { getCompanyIdentityCapability } from '../company-data-profile';
import { runWeeklyStepCheckTick } from '../journey-weekly-check';
import { readPassedCandidateForStep } from '../journey-pretest-candidate';
import { uploadSignupQuestion } from '../customer-joined-at';

const CO = randomUUID();
const OWNER = randomUUID();
const J = randomUUID();
const S1 = randomUUID();
const SNAP = randomUUID();
const OLD = randomUUID();   // 가입 근거 없는 옛 고객
const NEW = randomUUID();   // 오늘 가입

beforeAll(async () => {
  for (const id of ['C93-DDL-3', 'C89-DDL-5', 'C98-DDL-2']) await pool.query(ledgerBlockSql(id));
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '새 SQL 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1102', login_id: 't-1102-sql' });
  await insertMinimalRow(pool, 'customers', { id: OLD, company_id: CO, phone: '01000007401', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'customers', { id: NEW, company_id: CO, phone: '01000007402', is_active: true, sms_opt_in: true });
  await pool.query(`UPDATE customers SET joined_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [NEW]);
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: '새 SQL 여정', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: S1, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', message_template: '환영해요', subject: '환영', delay_hours: 0, is_ad: true });
  await insertMinimalRow(pool, 'journey_step_snapshots', { id: SNAP, company_id: CO, journey_id: J, step_id: S1, message_body: '환영해요', confidence_score: 100 });
}, 120_000);

describe('새 SQL 실 PG(1102 핵심 처방)', () => {
  it('CT-J5 알림톡 칸 판정 = 없는 템플릿 코드 = 막음(템플릿 조회 문장)', async () => {
    const v = await kakaoStepVerdict(CO, { step_order: 2, alimtalk_template_code: 'NO_SUCH_TEMPLATE_1102', alimtalk_variable_map: {} });
    expect(v.block).not.toBeNull();
  });

  it('CT-J9 클릭 통계 = 이 여정 링크 클릭만(칸 · 전체 · 시간대 · 요일 문장)', async () => {
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: J, customer_id: OLD, current_step_order: 1, status: 'active' });
    await pool.query(`INSERT INTO journey_step_logs (execution_id, step_id, sent_at, status) VALUES ($1, $2, NOW() - INTERVAL '2 hours', 'sent')`, [ex, S1]);
    for (const jid of [J, randomUUID()]) {
      await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: CO, customer_id: OLD, event_name: 'message_click', source: 'short_url', properties: { journey_id: jid, step_id: S1 } });
    }
    const st: any = await buildJourneyStats(J, CO);
    expect(st).toBeTruthy();
    expect(JSON.stringify(st)).toBeTruthy();
  });

  it('CT-J8 지도 광고 조각 = 생애 지도가 돈다', async () => {
    const m = await buildLifecycleMap(CO, OWNER);
    expect(m).toBeTruthy();
  });

  it('CT-J6 · D20 새로 가입 축 = 가입 근거 있는 회사에서 열림 · 셈 = 가입 근거 고객만(오늘 엑셀로 올린 옛 고객 0)', async () => {
    const f = await loadCompanySegmentFacts(CO);
    expect(f.hasJoinedAt).toBe(true);
    const r = await countOperatorAudienceFor({ companyId: CO, segmentKey: 'new_customers', segmentParams: normalizeSegmentParams('new_customers', null), ownerUserId: OWNER });
    expect(r.count).toBe(1);
    expect((await getCompanyIdentityCapability(CO)).signupDateColumn).toBe('joined_at');
    await buildJourneyOpportunities(CO, OWNER);
    await buildPerformanceSnapshot(CO);
  });

  it('CT-J12 주간 검사 고르기 · 칸 검사 = 켜진 문자 칸 한 칸 검사 · 이번 주 다시 = 0 · 수정안 읽기', async () => {
    const r = await runWeeklyStepCheckTick(new Date());
    expect(r.checked).toBe(1);
    expect(ctl.spamCalls).toBe(1);
    expect((await runWeeklyStepCheckTick(new Date())).checked).toBe(0);
    expect(await readPassedCandidateForStep(CO, J, S1)).toBeNull();
  });

  it('업로드 한 번 묻기 = 켜진 신규 가입 여정 + 그 회사에 없는 번호 수', async () => {
    const q = await uploadSignupQuestion(CO, ['01000007401', '01000007499']);
    expect(q).toMatchObject({ newPhones: 1, journeys: ['새 SQL 여정'] });
  });
});

describe('CT-J12 주간 검사 고르기 = 남은 칸만(실 PG · R12)', () => {
  it('채울 자리 보류 칸(수정안 0)이 앞에 있어도 = 마침 기록 → 다음 분에 다른 칸 · 그다음 = 0', async () => {
    const j = randomUUID(); const copy = randomUUID(); const ok = randomUUID();
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: CO, created_by: OWNER, name: '주간 고르기', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
    await insertMinimalRow(pool, 'journey_steps', { id: copy, journey_id: j, step_order: 1, step_type: 'message', channel: 'lms', message_template: '[혜택 안내: 직접 수정해주세요] 첫 칸', subject: '첫', delay_hours: 0 });
    await insertMinimalRow(pool, 'journey_steps', { id: ok, journey_id: j, step_order: 2, step_type: 'message', channel: 'lms', message_template: '둘째 칸 안내', subject: '둘', delay_hours: 24 });
    for (const st of [copy, ok]) {
      await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), company_id: CO, journey_id: j, step_id: st, message_body: st === copy ? '[혜택 안내: 직접 수정해주세요] 첫 칸' : '둘째 칸 안내', confidence_score: 100 });
    }
    const calls = ctl.spamCalls;
    expect((await runWeeklyStepCheckTick(new Date())).checked).toBe(1);   // 첫 칸 = 보낼 글 판정 보류(유료 검사 0) · 마침 기록
    expect(ctl.spamCalls).toBe(calls);
    expect((await runWeeklyStepCheckTick(new Date())).checked).toBe(1);   // 옛: 같은 첫 칸을 매분 다시 골라 둘째 칸이 영영 밀렸다
    expect(ctl.spamCalls).toBe(calls + 1);
    expect((await runWeeklyStepCheckTick(new Date())).checked).toBe(0);
    const st = (await pool.query(`SELECT step_id, status FROM journey_pretest_schedules WHERE journey_id = $1 ORDER BY notify_at, status`, [j])).rows.map((r) => `${r.step_id === copy ? 'copy' : 'ok'}:${r.status}`);
    expect(st.sort()).toEqual(['copy:held', 'copy:week_done', 'ok:notified']);
  });
});
