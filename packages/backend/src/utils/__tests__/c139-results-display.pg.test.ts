// replaces: none
/**
 * C139 실 PG — 여정 단계 캠페인 행 대표 본문 = 보낸 꼴에서 고객 값만 넣지 않은 글(★ 2026-11-16 · 설계서 docs/2026-11-16-c139-results-display-design.md 2 · 4절 · 뿌리 R98)
 *
 * 실행기(runJourneyExecutor)를 운영 문장 그대로 끝까지 돌린다. 바깥만 시험이 쥔다(engine-throughput-1102 틀):
 *   MySQL 적재(loadQueueUnit) = 넣은 수만 · 운영 경보 = 기록만 · 발송 시간 창 = 하루 전체 · 알림톡 외부 활성 상태 조회 = 'A'(활성).
 * 본다: 문자 칸 · A/B 칸 · 알림톡 칸 셋의 캠페인 행 본문 = 손으로 쓴 기대값 · 고객 이름 0 · 알림톡 묶음이 적재까지 간다(실패 0) ·
 *   같은 회사의 여정 아닌 캠페인 행 무접촉 · 스팸 목록 SELECT(테스트발송내역)의 subject 칸.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const ctl = vi.hoisted(() => ({ inserted: 0, alimRows: 0, alerts: [] as string[] }));

vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return { ...real, withBoundedMysql: async (_ms: number, work: any) => work(async () => []) };
});
vi.mock('../../config/defaults', async (orig) => {
  const real: any = await orig();
  return { ...real, SEND_HOURS: { start: 0, end: 24 } };
});
vi.mock('../sms-queue', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    getCompanySmsTables: async () => ['SMSQ_TEST'],
    getCompanySmsTablesWithLogs: async () => ['SMSQ_TEST'],
    hasCompanyLineGroup: async () => true,
    loadQueueUnit: async (p: any) => {
      const rows = p.kind === 'sms' ? p.smsRows : p.alimRows;
      await p.record({ threadId: 1, table: 'SMSQ_TEST', count: rows.length });
      ctl.inserted += rows.length;
      if (p.kind !== 'sms') ctl.alimRows += rows.length;
      return { state: 'loaded', table: 'SMSQ_TEST', threadId: 1, finish: () => undefined };
    },
    isMysqlThreadAlive: async () => false,
    recordCampaignSentTables: async () => undefined,
  };
});
vi.mock('../kakao-template-guard', async (orig) => {
  const real: any = await orig();
  return { ...real, getImcTemplateStatusSafe: async () => 'A' };
});
vi.mock('../system-alert', () => ({
  sendSystemAlert: async (p: any) => { ctl.alerts.push(String(p?.dedupKey)); return 1; },
  alertPassFailures: async (p: any) => { if (p?.failures?.length) ctl.alerts.push(String(p.pass)); },
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { runJourneyExecutor } from '../journey-executor';

const CO = randomUUID();
const OWNER = randomUUID();
const PLAN = randomUUID();
const J_LMS = randomUUID();
const J_AB = randomUUID();
const J_KAKAO = randomUUID();
const DIRECT = randomUUID();
const NAMES = ['가나다라', '마바사아'];
const OPT = '080-1234-5678';
const TPL_CODE = `C139${Math.floor(Math.random() * 1e6)}`;

async function seedJourney(j: string, step: { channel: string; template?: string; subject?: string; kakaoCode?: string; varMap?: Record<string, string>; isAd?: boolean }, tag: string, customers: string[]): Promise<string> {
  const s = randomUUID();
  await insertMinimalRow(pool, 'journeys', { id: j, company_id: CO, created_by: OWNER, name: `C139 ${tag}`, status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', {
    id: s, journey_id: j, step_order: 1, step_type: 'message', channel: step.channel, message_template: step.template ?? '', subject: step.subject ?? null,
    delay_mode: 'relative', delay_hours: 0, is_ad: step.isAd ?? true,
    // 알림톡 칸 = 대체 안 함(N · 대체 장문이면 제목이 필수라 이 시험의 축이 아니다)
    ...(step.kakaoCode ? { alimtalk_template_code: step.kakaoCode, alimtalk_variable_map: JSON.stringify(step.varMap || {}), alimtalk_next_type: 'N' } : {}),
  });
  if (step.channel !== 'kakao') {
    await insertMinimalRow(pool, 'journey_step_snapshots', { id: randomUUID(), journey_id: j, step_id: s, message_body: step.template, message_subject: step.subject ?? null, confidence_score: 100 });
  }
  for (const c of customers) {
    const ex = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: ex, journey_id: j, customer_id: c, current_step_order: 0, status: 'active' });
    await pool.query(`UPDATE journey_executions SET next_run_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [ex]);
  }
  return s;
}

describe('C139 실 PG — 여정 단계 캠페인 행 대표 본문(실행기 끝까지)', () => {
  let abStep = '';
  beforeAll(async () => {
    for (const id of ['C90-DDL-1', 'C93-DDL-1', 'C93-DDL-2', 'C93-DDL-3', 'C96-DDL-1']) await pool.query(ledgerBlockSql(id));
    await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'PRO', plan_name: 'PRO', monthly_price: 1000000, ai_credits_per_month: 2400, is_active: true });
    await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C139 시험몰', ai_credits_purchased: 100000, plan_id: PLAN, subscription_status: 'active', opt_out_080_number: OPT });
    await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1139', login_id: 't-1116-c139' });
    // 고객 = 시험 DB 안에서만(도달 불가 · 실제 발송 0 = MySQL 적재가 시험 손)
    const cust: string[] = [];
    for (const [i, name] of NAMES.entries()) {
      const id = randomUUID();
      cust.push(id);
      await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0109999113${i}`, name, is_active: true, sms_opt_in: true });
    }
    // 여정 아닌 캠페인 행(무접촉 확인)
    await insertMinimalRow(pool, 'campaigns', { id: DIRECT, company_id: CO, campaign_name: 'C139 직접', message_type: 'LMS', message_content: '%고객명%님 직접발송 원문', send_type: 'direct', status: 'completed', created_by: OWNER });
    await seedJourney(J_LMS, { channel: 'lms', template: '[시험몰]\n%고객명%님, 반갑습니다.', subject: '반가워요' }, 'lms', cust);
    abStep = await seedJourney(J_AB, { channel: 'lms', template: '[시험몰]\n%고객명%님 기본 안내', subject: '안내' }, 'ab', cust);
    await insertMinimalRow(pool, 'journey_step_variants', { step_id: abStep, variant_id: 'A', message_template: 'A안 %고객명%님 안내', subject: null });
    await insertMinimalRow(pool, 'journey_step_variants', { step_id: abStep, variant_id: 'B', message_template: 'B안 %고객명%님 안내', subject: null });
    // 알림톡 = 승인된 발신 프로필 · 템플릿(시험 DB 안)
    const profile = randomUUID();
    await insertMinimalRow(pool, 'kakao_sender_profiles', { id: profile, company_id: CO, profile_key: `pk-c139-${TPL_CODE}`, approval_status: 'APPROVED', is_active: true });
    await insertMinimalRow(pool, 'kakao_templates', { id: randomUUID(), company_id: CO, profile_id: profile, template_code: TPL_CODE, template_name: 'C139 주문', content: '#{고객명}님 주문이 접수됐어요.', status: 'APPROVED' });
    await seedJourney(J_KAKAO, { channel: 'kakao', kakaoCode: TPL_CODE, varMap: { '#{고객명}': '@@name@@' }, isAd: false }, 'kakao', cust);
  }, 120_000);

  it('실행기 한 회차 = 세 칸 모두 적재 · 실패 0 · 행 본문 = 기대값 · 고객 이름 0 · 여정 아닌 행 무접촉', async () => {
    // A/B 판 고르기 = 누적 3회 미만이면 무작위(bandit-optimizer selectJourneyStepVariant) → 이 회차만 마지막 판(B)으로 고정해 대표 본문과 맞춘다(Codex 구현 1R 보강)
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    let s: Awaited<ReturnType<typeof runJourneyExecutor>>;
    try { s = await runJourneyExecutor(); } finally { rnd.mockRestore(); }
    expect(s.failed, `경보 ${ctl.alerts.join(',')}`).toBe(0);
    const rows = (await pool.query(
      `SELECT jsc.journey_id, c.message_content, c.message_template, c.subject, c.send_channel
         FROM campaigns c JOIN journey_step_campaigns jsc ON jsc.campaign_id = c.id
        WHERE c.company_id = $1::uuid AND c.send_type = 'journey'`,
      [CO],
    )).rows as any[];
    const byJ = new Map(rows.map((r) => [String(r.journey_id), r]));
    expect([...byJ.keys()].sort()).toEqual([J_LMS, J_AB, J_KAKAO].sort());

    const lms = byJ.get(J_LMS);
    expect(lms.message_content).toBe('(광고) [시험몰]\n%고객명%님, 반갑습니다.\n무료수신거부 080-1234-5678');
    expect(lms.message_template).toBe(lms.message_content);
    expect(lms.subject).toBe('(광고) 반가워요');   // 제목 = 옛 그대로(렌더 결과 · 고객마다 같다)

    const ab = byJ.get(J_AB);
    expect(ab.message_content).toBe('(광고) B안 %고객명%님 안내\n무료수신거부 080-1234-5678');   // 첫 보낼 줄이 받은 판(B) · 칸 기본 글(「기본 안내」)이 아니다

    const kakao = byJ.get(J_KAKAO);
    expect(kakao.send_channel).toBe('alimtalk');
    expect(kakao.message_content).toBe('#{고객명}님 주문이 접수됐어요.');
    expect(ctl.alimRows).toBe(NAMES.length);   // 알림톡 묶음이 sendUnits 를 지나 적재까지 갔다(Codex 설계 3R)

    for (const r of rows) for (const n of NAMES) expect(String(r.message_content), `${r.journey_id}`).not.toContain(n);
    const direct = (await pool.query(`SELECT message_content FROM campaigns WHERE id = $1`, [DIRECT])).rows[0];
    expect(direct.message_content).toBe('%고객명%님 직접발송 원문');
  }, 300_000);

  it('스팸 목록 SELECT(테스트발송내역) = 장문 검사의 저장된 subject 를 읽는다', async () => {
    const t = randomUUID();
    await insertMinimalRow(pool, 'spam_filter_tests', { id: t, company_id: CO, user_id: OWNER, callback_number: '0212345678', message_content_lms: '검사 본문', subject: '검사 제목', status: 'completed' });
    await insertMinimalRow(pool, 'spam_filter_test_results', { id: randomUUID(), test_id: t, phone: '01000000000', carrier: 'SKT', message_type: 'LMS', result: 'pass' });
    const r = await pool.query(
      `SELECT r.id, r.message_type, t.message_content_lms, t.subject
         FROM spam_filter_test_results r JOIN spam_filter_tests t ON r.test_id = t.id
        WHERE t.company_id = $1 ORDER BY t.created_at DESC LIMIT 100`,
      [CO],
    );
    expect(r.rows[0].subject).toBe('검사 제목');
  });
});
