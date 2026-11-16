// replaces: none
/**
 * C134(B-1114-1 · 뿌리 R96) — 여정의 단계 캠페인은 여정만 닫는다 · 실 PostgreSQL 판(★ 2026-11-14)
 *   (설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §3 · §4 · §5)
 *   그릇 = 운영 덤프 + 원장 DDL(트리거 campaigns_protect_completed_target_count 포함) + C134-DDL-1(판정 기록 표).
 *   1. 여정이 닫는다 — 값 범위 표 전부(어제 · 오늘 · 미확정 표식 · 단위 기록 · 유예 · 여정 아닌 행 · 빈 캠페인은 굳힌다)
 *   2. 확정 앞 다시 열기 — 닫힌 캠페인의 미확정 표식이 트리거를 지나 확정된다(B-1114-1 로 걸린 행이 스스로 풀리는 길)
 *   3. 목록 자동 완료 문장 — 여정 행은 안 바뀌고 그 밖은 종전대로 바뀐다
 *   4. 고르기 — 닫힌 행을 이어 쓰지 않는다
 *   5. 굳힘 · 재대조 문장 — 읽은 뒤 다시 열린 행을 덮지 않는다 · 여정 행의 상태 · 발송 수를 쓰지 않는다 · 큐 행 수는 따로 남긴다
 *   6. 밤 판정 · 기록 · 목록 흉내
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  closeFinishedStepCampaigns, reopenStepCampaignForConfirm, pickStepCampaignForUnits, resetStepCampaignSeqCache,
  kstDateString, LOAD_PROTOCOL_UNIT, JOURNEY_LEDGER_CONFIG, type StepCampaignSpec,
} from '../journey-step-campaign';
import { confirmLoadUnit } from '../journey-send-claim';
import { LIST_AUTO_COMPLETE_SQL } from '../campaign-list-autocomplete';
import { MARK_FINAL_SQL, RECONCILE_WRITE_SQL, RECONCILE_BENCHMARK_SQL } from '../campaign-sync-worker';
import {
  judgeJourneyDay, runJourneySelfcheck, neverFiredCombos, runListOpenMimic, persistVerdict, storedViolations, zeroStreak,
  addKstDays, kstYmd, SELFCHECK_WINDOW_DAYS,
} from '../journey-selfcheck';

const CO = randomUUID();
const OWNER = randomUUID();
const JO = randomUUID();
const STEP = randomUUID();
const CUST = randomUUID();
const CB = '0212341114';
const UNIT_CFG = { ...JOURNEY_LEDGER_CONFIG, loadProtocol: LOAD_PROTOCOL_UNIT };

const statusOf = async (id: string) => {
  const r = (await query('SELECT status, result_final, target_count, sent_count FROM campaigns WHERE id = $1::uuid', [id])).rows[0];
  return { status: String(r.status), final: r.result_final === true, target: Number(r.target_count), sent: Number(r.sent_count) };
};
const mkCampaign = async (o: { sendType?: string | null; status?: string; base: string; cfg?: Record<string, unknown>; target?: number; sent?: number; final?: boolean; companyId?: string; success?: number; fail?: number }) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'campaigns', {
    id, company_id: o.companyId ?? CO, created_by: OWNER, campaign_name: `[여정] step 1 ${id.slice(0, 4)}`, message_type: 'LMS',
    status: o.status ?? 'sending', send_type: o.sendType === undefined ? 'journey' : o.sendType,
    scheduled_at: o.base, sent_at: o.base, created_at: o.base,
    target_count: o.target ?? 0, sent_count: o.sent ?? 0, success_count: o.success ?? 0, fail_count: o.fail ?? 0,
    result_final: o.final ?? false, send_config: o.cfg ?? UNIT_CFG,
  });
  return id;
};
const mkExecution = async (extra: Record<string, unknown> = {}, journeyId: string = JO, customerId: string = CUST) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journey_executions', { id, journey_id: journeyId, customer_id: customerId, status: 'active', ...extra });
  return id;
};
const mkClaim = async (campaignId: string, o: { status?: string; sentAt?: string; reason?: string | null; stepId?: string; executionId?: string } = {}) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'journey_step_logs', {
    id, execution_id: o.executionId ?? await mkExecution(), step_id: o.stepId ?? STEP, campaign_id: campaignId,
    status: o.status ?? 'sending', sent_at: o.sentAt ?? new Date().toISOString(), cost: 0, error_reason: o.reason ?? null,
  });
  return id;
};

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C134-DDL-1'));
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C134 여정 단계 캠페인은 여정만 닫는다' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, login_id: `t-c134-${CO.slice(0, 6)}` });
  await insertMinimalRow(pool, 'customers', { id: CUST, company_id: CO, phone: '01000001114', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'journeys', { id: JO, company_id: CO, created_by: OWNER, name: 'C134 여정', status: 'active', start_kind: 'event', trigger_event: 'custom', callback_number: CB });
  await insertMinimalRow(pool, 'journey_steps', { id: STEP, journey_id: JO, step_order: 1, step_type: 'message', channel: 'lms', message_template: '안내드립니다.', delay_hours: 0 });
});

describe('트리거가 이 그릇에 있다(아래 시험이 뜻을 가지려면)', () => {
  it('완료된 캠페인의 대상 수를 바꾸는 문장은 막힌다', async () => {
    const id = await mkCampaign({ status: 'completed', base: '2026-11-10T15:00:00+09:00', target: 9, sent: 9 });
    await expect(query('UPDATE campaigns SET target_count = target_count + 1 WHERE id = $1::uuid', [id])).rejects.toThrow();
    expect((await statusOf(id)).target).toBe(9);
  });
});

describe('여정이 닫는다 — closeFinishedStepCampaigns(값 범위 표)', () => {
  const NOW = new Date('2026-11-11T03:00:00+09:00');
  const YESTERDAY = '2026-11-10T15:00:00+09:00';
  const TODAY = '2026-11-11T01:00:00+09:00';

  it('어제 행 · 미확정 단위 0 = 닫힌다(수는 그대로 · 보낸 것이 있으면 굳히지 않는다) · 오늘 행 = 그대로', async () => {
    const y = await mkCampaign({ base: YESTERDAY, target: 3, sent: 3 });
    const t = await mkCampaign({ base: TODAY });
    expect(await closeFinishedStepCampaigns(NOW)).toBeGreaterThanOrEqual(1);
    expect(await statusOf(y)).toEqual({ status: 'completed', final: false, target: 3, sent: 3 });
    expect((await statusOf(t)).status).toBe('sending');
  });

  it('빈 캠페인(발송 수 0 · 확정 표식 0 · 증명 못 해 닫은 표식 0)은 닫으면서 굳힌다 = 재대조가 매일 다시 훑지 않는다', async () => {
    const empty = await mkCampaign({ base: YESTERDAY, cfg: { ...UNIT_CFG, sentTables: ['SMSQ_SEND_13'] } });
    const unprovable = await mkCampaign({ base: YESTERDAY });
    await mkClaim(unprovable, { status: 'failed', reason: 'load_unprovable', sentAt: YESTERDAY });
    await closeFinishedStepCampaigns(NOW);
    expect(await statusOf(empty)).toEqual({ status: 'completed', final: true, target: 0, sent: 0 });
    expect(await statusOf(unprovable)).toEqual({ status: 'completed', final: false, target: 0, sent: 0 });   // 들어갔을 수도 있다 = 굳히지 않는다
  });

  it('어제 행이라도 미확정 표식이 있으면 닫지 않는다 · 표식이 풀리면 다음 주기에 닫힌다', async () => {
    const y = await mkCampaign({ base: YESTERDAY });
    const claim = await mkClaim(y, { sentAt: '2026-11-10T23:59:30+09:00' });
    await closeFinishedStepCampaigns(NOW);
    expect((await statusOf(y)).status).toBe('sending');
    await query(`UPDATE journey_step_logs SET status = 'sent' WHERE id = $1::uuid`, [claim]);
    await closeFinishedStepCampaigns(NOW);
    expect((await statusOf(y)).status).toBe('completed');
  });

  it('단위 기록(loadUnit)이 남은 행은 닫지 않는다', async () => {
    const y = await mkCampaign({ base: YESTERDAY, cfg: { ...UNIT_CFG, loadUnit: { threadId: 1, table: 'SMSQ_SEND_1', count: 1, at: YESTERDAY } } });
    await closeFinishedStepCampaigns(NOW);
    expect((await statusOf(y)).status).toBe('sending');
  });

  it('여정이 아닌 행(직접 · 발송 종류 없음)은 어제 것이어도 건드리지 않는다', async () => {
    const d = await mkCampaign({ sendType: 'direct', base: YESTERDAY });
    const n = await mkCampaign({ sendType: null, base: YESTERDAY });
    await closeFinishedStepCampaigns(NOW);
    expect(await statusOf(d)).toEqual({ status: 'sending', final: false, target: 0, sent: 0 });
    expect(await statusOf(n)).toEqual({ status: 'sending', final: false, target: 0, sent: 0 });
  });

  it('자정 직후 10분은 닫지 않는다(유예) · 10분이 지나면 닫는다', async () => {
    const y = await mkCampaign({ base: '2026-11-12T23:58:00+09:00', target: 1, sent: 1 });
    await closeFinishedStepCampaigns(new Date('2026-11-13T00:05:00+09:00'));
    expect((await statusOf(y)).status).toBe('sending');
    await closeFinishedStepCampaigns(new Date('2026-11-13T00:11:00+09:00'));
    expect((await statusOf(y)).status).toBe('completed');
  });

  it('매핑 행이 없는 옛 여정 캠페인(표식 없는 설정)도 날이 지나면 닫힌다 = sending 으로 영원히 남지 않는다', async () => {
    const old = await mkCampaign({ base: '2026-11-01T10:00:00+09:00', cfg: {}, target: 1, sent: 1 });
    await closeFinishedStepCampaigns(NOW);
    expect((await statusOf(old)).status).toBe('completed');
  });
});

describe('확정 앞 다시 열기 — 닫힌 캠페인의 미확정 표식이 확정된다(B-1114-1 로 걸린 행)', () => {
  it('완료 + 굳음 + 미확정 표식 1 = 다시 열리고 · 대상 수 · 발송 수가 같이 오르고 · 표식은 sent', async () => {
    const c = await mkCampaign({ status: 'completed', final: true, base: '2026-11-14T10:00:00+09:00', target: 9, sent: 9 });
    const claim = await mkClaim(c);
    const confirmed = await confirmLoadUnit(c, [claim]);
    expect(confirmed.map((x) => x.id)).toEqual([claim]);
    expect(await statusOf(c)).toEqual({ status: 'sending', final: false, target: 10, sent: 10 });
    expect(String((await query('SELECT status FROM journey_step_logs WHERE id = $1::uuid', [claim])).rows[0].status)).toBe('sent');
  });

  it('열린 캠페인의 확정은 종전 그대로(다시 열기 0행)', async () => {
    const c = await mkCampaign({ base: new Date().toISOString(), target: 2, sent: 2 });
    const claim = await mkClaim(c);
    expect((await confirmLoadUnit(c, [claim])).length).toBe(1);
    expect(await statusOf(c)).toEqual({ status: 'sending', final: false, target: 3, sent: 3 });
  });

  it('미확정 표식이 없는 완료 캠페인 · 여정이 아닌 완료 캠페인은 열지 않는다', async () => {
    const done = await mkCampaign({ status: 'completed', final: true, base: '2026-11-13T10:00:00+09:00', target: 4, sent: 4 });
    const sentClaim = await mkClaim(done, { status: 'sent' });
    expect(await reopenStepCampaignForConfirm(done, [sentClaim])).toBe(false);
    expect(await statusOf(done)).toEqual({ status: 'completed', final: true, target: 4, sent: 4 });
    const direct = await mkCampaign({ sendType: 'direct', status: 'completed', base: '2026-11-13T10:00:00+09:00', target: 4, sent: 4 });
    const dClaim = await mkClaim(direct);
    expect(await reopenStepCampaignForConfirm(direct, [dClaim])).toBe(false);
    expect((await statusOf(direct)).status).toBe('completed');
    expect(await reopenStepCampaignForConfirm(done, [])).toBe(false);
  });

  it('다시 열린 어제 캠페인은 표식이 풀린 뒤 여정이 닫는다(걸린 행의 끝)', async () => {
    const c = await mkCampaign({ status: 'completed', base: '2026-11-08T16:00:00+09:00', target: 9, sent: 9 });
    const claim = await mkClaim(c, { sentAt: '2026-11-08T16:06:00+09:00' });
    await confirmLoadUnit(c, [claim]);
    expect((await statusOf(c)).status).toBe('sending');
    await closeFinishedStepCampaigns(new Date('2026-11-09T03:00:00+09:00'));
    expect(await statusOf(c)).toEqual({ status: 'completed', final: false, target: 10, sent: 10 });
  });
});

describe('목록 자동 완료 문장 — 여정 행은 대상이 아니다', () => {
  it('같은 id 목록에 섞여 들어와도 여정 행은 그대로 · 직접 · 발송 종류 없는 행은 완료로', async () => {
    const base = new Date().toISOString();
    const j = await mkCampaign({ base });
    const d = await mkCampaign({ sendType: 'direct', base });
    const n = await mkCampaign({ sendType: null, base });
    const scheduled = await mkCampaign({ sendType: 'direct', status: 'scheduled', base });
    await query(LIST_AUTO_COMPLETE_SQL, [[j, d, n, scheduled]]);
    expect((await statusOf(j)).status).toBe('sending');
    expect((await statusOf(d)).status).toBe('completed');
    expect((await statusOf(n)).status).toBe('completed');
    expect((await statusOf(scheduled)).status).toBe('scheduled');   // 보내는 중이 아닌 행은 종전대로 안 바뀐다
  });
});

describe('고르기 — 닫힌 행을 이어 쓰지 않는다', () => {
  const spec = (journeyId: string, stepId: string): StepCampaignSpec => ({
    companyId: CO, journeyId, stepId, stepOrder: 1, msgType: 'LMS', representativeMessage: '안내드립니다.', subject: null, isAd: false,
    createdBy: OWNER, sendChannel: 'sms', callbackNumber: CB, kakaoTemplateId: null, mmsImagePaths: null,
  });
  const mkStep = async () => {
    const j = randomUUID(); const s = randomUUID();
    await insertMinimalRow(pool, 'journeys', { id: j, company_id: CO, created_by: OWNER, name: 'C134 고르기', status: 'active', start_kind: 'event', trigger_event: 'custom', callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: s, journey_id: j, step_order: 1, step_type: 'message', channel: 'lms', message_template: '안내드립니다.', delay_hours: 0 });
    return { j, s };
  };
  const map = async (j: string, s: string, campaignId: string) =>
    query(`INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`, [j, s, kstDateString(), campaignId]);

  it('오늘 행이 열려 있으면 그 행을 그대로 쓴다(종전)', async () => {
    resetStepCampaignSeqCache();
    const { j, s } = await mkStep();
    const cur = await mkCampaign({ base: new Date().toISOString() });
    await map(j, s, cur);
    expect(await pickStepCampaignForUnits(spec(j, s))).toEqual({ campaignId: cur, sendDate: kstDateString() });
  });

  it('오늘 행이 completed 면 그 행을 쓰지 않는다(순번 + 1 새 행 또는 이어 붙임 닫힘)', async () => {
    resetStepCampaignSeqCache();
    const { j, s } = await mkStep();
    const closed = await mkCampaign({ status: 'completed', base: new Date().toISOString(), target: 9, sent: 9 });
    await map(j, s, closed);
    const pick = await pickStepCampaignForUnits(spec(j, s));
    if ('campaignId' in pick) {
      expect(pick.campaignId).not.toBe(closed);
      expect((await statusOf(pick.campaignId)).status).toBe('sending');
    } else {
      expect(pick.blocked).toBe('continuation_unavailable');
    }
    expect(await statusOf(closed)).toEqual({ status: 'completed', final: false, target: 9, sent: 9 });
  });
});

describe('굳힘 · 재대조 문장 — 읽은 뒤 바뀐 행을 덮지 않는다 · 여정 행의 상태 · 발송 수는 여정 것', () => {
  const BASE = '2026-11-03T10:00:00+09:00';
  const cfgOf = async (id: string) => (await query('SELECT send_config, success_count, fail_count FROM campaigns WHERE id = $1::uuid', [id])).rows[0];

  it('굳힘: 후보로 읽힌 뒤 다시 열린(sending) 행은 굳히지 않는다 · 완료 행은 굳힌다', async () => {
    const reopened = await mkCampaign({ base: BASE, target: 5, sent: 5, success: 5 });               // 읽을 때는 completed 였다가 지금 sending
    const done = await mkCampaign({ status: 'completed', base: BASE, target: 5, sent: 5, success: 5 });
    await query(MARK_FINAL_SQL, [[reopened, done]]);
    expect((await statusOf(reopened)).final).toBe(false);
    expect((await statusOf(done)).final).toBe(true);
  });

  it('재대조: 읽은 상태(completed)와 지금 상태(sending)가 다르면 0행 = 다시 연 것을 completed 로 되돌리지 않는다', async () => {
    const c = await mkCampaign({ base: BASE, target: 9, sent: 9 });   // 지금 sending(여정이 다시 열었다)
    const w = await query(RECONCILE_WRITE_SQL, [c, 'completed', 12, 9, 0, true, 'completed']);
    expect(w.rowCount).toBe(0);
    expect(await statusOf(c)).toEqual({ status: 'sending', final: false, target: 9, sent: 9 });
  });

  it('재대조: 여정 행 = 상태 · 발송 수 그대로 · 성공 · 실패 수는 쓰고 · 큐 행 수는 reconRows 로(올리기만)', async () => {
    const c = await mkCampaign({ status: 'completed', base: BASE, target: 100, sent: 100 });
    expect((await query(RECONCILE_WRITE_SQL, [c, 'completed', 110, 100, 9, false, 'completed'])).rowCount).toBe(1);
    expect(await statusOf(c)).toEqual({ status: 'completed', final: false, target: 100, sent: 100 });   // 발송 수 100 그대로(큐 행 110 으로 안 오른다)
    let row = await cfgOf(c);
    expect(Number(row.send_config.reconRows)).toBe(110);
    expect(row.send_config.loadProtocol).toBe(LOAD_PROTOCOL_UNIT);   // 다른 설정 키는 그대로
    expect([Number(row.success_count), Number(row.fail_count)]).toEqual([100, 9]);
    // 다시 고르는 기준 = 성공 + 실패(109) < max(발송 수 100, 큐 행 110) → 늦은 대체 결과를 종전처럼 다시 본다
    const pick = await query(`SELECT (COALESCE(success_count, 0) + COALESCE(fail_count, 0)) < ${RECONCILE_BENCHMARK_SQL} AS again FROM campaigns WHERE id = $1::uuid`, [c]);
    expect(pick.rows[0].again).toBe(true);
    // 읽기가 줄어도(105) 큐 행 수는 내려가지 않는다
    await query(RECONCILE_WRITE_SQL, [c, 'completed', 105, 100, 10, true, 'completed']);
    row = await cfgOf(c);
    expect(Number(row.send_config.reconRows)).toBe(110);
    expect((await statusOf(c)).final).toBe(true);
    const done = await query(`SELECT (COALESCE(success_count, 0) + COALESCE(fail_count, 0)) < ${RECONCILE_BENCHMARK_SQL} AS again FROM campaigns WHERE id = $1::uuid`, [c]);
    expect(done.rows[0].again).toBe(false);   // 110 건이 다 차면 졸업
    // 여정 행의 상태는 재대조가 쓰지 않는다 — 새 상태 값을 실어도(failed 로 읽힌 행의 completed 복원 갈래) 저장된 상태 그대로
    const f = await mkCampaign({ status: 'failed', base: BASE, target: 3, sent: 3 });
    expect((await query(RECONCILE_WRITE_SQL, [f, 'completed', 3, 3, 0, false, 'failed'])).rowCount).toBe(1);
    expect((await statusOf(f)).status).toBe('failed');
  });

  it('재대조: 여정이 아닌 행은 종전 그대로(failed → completed 복원 · 발송 수는 올리기만 · 설정 그대로)', async () => {
    const d = await mkCampaign({ sendType: 'direct', status: 'failed', base: BASE, target: 10, sent: 3, cfg: { sentTables: ['SMSQ_SEND_1'] } });
    expect((await query(RECONCILE_WRITE_SQL, [d, 'completed', 10, 8, 2, false, 'failed'])).rowCount).toBe(1);
    expect(await statusOf(d)).toEqual({ status: 'completed', final: false, target: 10, sent: 10 });
    await query(RECONCILE_WRITE_SQL, [d, 'completed', 4, 8, 2, false, 'completed']);
    expect((await statusOf(d)).sent).toBe(10);   // 읽기로 내리지 않는다(R37)
    expect((await cfgOf(d)).send_config).toEqual({ sentTables: ['SMSQ_SEND_1'] });
    const n = await mkCampaign({ sendType: null, status: 'completed', base: BASE, target: 2, sent: 1 });
    await query(RECONCILE_WRITE_SQL, [n, 'completed', 2, 2, 0, false, 'completed']);
    expect((await statusOf(n)).sent).toBe(2);    // 발송 종류 없는 옛 행 = 여정 아님 = 종전
  });
});

describe('밤 판정 · 기록 · 목록 흉내 — DB 값만으로 잰다', () => {
  const C2 = randomUUID(); const O2 = randomUUID(); const J2 = randomUUID(); const S2 = randomUUID(); const K2 = randomUUID();
  const CLEAN = randomUUID();
  const DAY = '2026-11-05';
  const NOW = new Date('2026-11-06T03:00:00+09:00');
  const at = (hm: string) => `${DAY}T${hm}:00+09:00`;
  let stuckClaim = '';

  beforeAll(async () => {
    await insertMinimalRow(pool, 'companies', { id: C2, company_name: 'C134 판정 회사' });
    await insertMinimalRow(pool, 'companies', { id: CLEAN, company_name: 'C134 깨끗한 회사' });
    await insertMinimalRow(pool, 'users', { id: O2, company_id: C2, user_type: 'admin', is_active: true, login_id: `t-c134b-${C2.slice(0, 6)}` });
    await insertMinimalRow(pool, 'customers', { id: K2, company_id: C2, phone: '01000001115', is_active: true, sms_opt_in: true });
    await insertMinimalRow(pool, 'journeys', { id: J2, company_id: C2, created_by: O2, name: 'C134 판정 여정', status: 'active', start_kind: 'event', trigger_event: 'custom', callback_number: CB });
    await insertMinimalRow(pool, 'journey_steps', { id: S2, journey_id: J2, step_order: 1, step_type: 'message', channel: 'lms', message_template: '안내드립니다.', delay_hours: 0 });
    // 실패로 끝난 실행 1 · 그날 오류가 난 실행 1
    await mkExecution({ status: 'failed', completed_at: at('10:00') }, J2, K2);
    const errored = await mkExecution({ status: 'active', last_error_at: at('11:00'), error_count: 2 }, J2, K2);
    // 안 풀린 표식 1(상한 넘김) + 증명 못 해 닫은 표식 1 · 시스템 탓 못 보냄 1 · 고객 탓(잔액 부족 · 조건 불충족)은 세지 않는다
    const open = await mkCampaign({ companyId: C2, base: at('09:00') });                                   // 닫힌 날인데 보내는 중 1
    stuckClaim = await mkClaim(open, { sentAt: at('12:00'), stepId: S2, executionId: errored });
    await mkClaim(open, { status: 'failed', reason: 'load_unprovable', sentAt: at('12:30'), stepId: S2, executionId: errored });
    await mkClaim(open, { status: 'failed', reason: 'queue_insert_failed', sentAt: at('12:40'), stepId: S2, executionId: errored });
    await mkClaim(open, { status: 'failed', reason: 'insufficient_balance', sentAt: at('12:45'), stepId: S2, executionId: errored });
    await mkClaim(open, { status: 'skipped', reason: 'not_met', sentAt: at('12:50'), stepId: S2, executionId: errored });
    // 대상 수 ≠ 발송 수 1
    await mkCampaign({ companyId: C2, status: 'completed', base: at('13:00'), target: 5, sent: 7 });
    // 다른 날 · 여정 아닌 행은 세지 않는다
    await mkCampaign({ companyId: C2, sendType: 'direct', base: at('14:00'), target: 1, sent: 9 });
    await mkCampaign({ companyId: C2, base: '2026-11-04T09:00:00+09:00', status: 'completed', target: 2, sent: 2 });
    // 자정을 걸친 오류 — 같은 실행이 11-02 23:58 과 11-03 00:03 에 처리 오류(마지막 오류 시각은 11-03 으로 덮인다 · 기록에는 둘 다 남는다)
    await mkExecution({
      status: 'active', last_error_at: '2026-11-03T00:03:00+09:00', error_count: 2,
      error_log: JSON.stringify([
        { at: '2026-11-02T14:58:00.000Z', stage: 'process_execution', reason: 'x' },
        { at: '2026-11-02T15:03:00.000Z', stage: 'process_execution', reason: 'x' },
        { reason: '시각 없는 옛 항목' }, 'not-an-object', { at: 'not-a-time' },
      ]),
    }, J2, K2);
    // 지난 오류(10-28) 뒤 다른 날(10-30) 마지막 칸을 정상 발송하고 끝난 실행 — 적재 시도 기록(load_attempt)은 오류가 아니다 · 실행기가 쓰는 꼴 그대로
    const done = await mkExecution({ status: 'completed', completed_at: '2026-10-30T10:00:05+09:00', last_error_at: '2026-10-28T09:00:00+09:00', error_count: 1 }, J2, K2);
    await query(
      `UPDATE journey_executions SET error_log = jsonb_build_array(
           jsonb_build_object('at', '2026-10-28T00:00:00.000Z', 'reason', 'queue_insert_failed', 'step_id', $2::text),
           jsonb_build_object('reason', 'load_attempt', 'step_id', $2::text, 'campaign_id', $3::text, 'at', '2026-10-30T10:00:00+09:00'::timestamptz))
        WHERE id = $1::uuid`, [done, S2, randomUUID()]);
    // 오류 기록이 배열이 아닌 옛 행 = 마지막 오류 시각으로만 센다(판정이 죽지 않는다)
    await mkExecution({ status: 'active', last_error_at: '2026-11-01T10:00:00+09:00', error_count: 1, error_log: JSON.stringify({ legacy: true }) }, J2, K2);
  });

  it('여섯 가지를 각각 센다', async () => {
    const v = await judgeJourneyDay(C2, DAY, NOW);
    expect(v).toEqual({ day: DAY, failedExecutions: 1, erroredExecutions: 1, stuckClaims: 2, faultLogs: 1, unclosedCampaigns: 1, countMismatch: 1, violations: 7 });
  });

  it('상한 안의 표식 · 유예 안의 날은 위반이 아니다', async () => {
    const early = new Date(`${DAY}T12:35:00+09:00`);   // 표식을 쓴 지 35분 · 그날은 아직 열린 날
    const v = await judgeJourneyDay(C2, DAY, early);
    expect(v.stuckClaims).toBe(1);          // 증명 못 해 닫은 것만(남는 흔적) · 35분 된 표식은 아직 증명 대기
    expect(v.unclosedCampaigns).toBe(0);    // 열린 날은 닫을 차례가 아니다
  });

  it('오류가 난 날 = 오류 기록의 날짜로 센다 — 자정을 걸쳐 마지막 오류 시각이 덮여도 앞 날이 0 이 되지 않는다', async () => {
    const late = new Date('2026-11-04T03:00:00+09:00');
    expect((await judgeJourneyDay(C2, '2026-11-02', late)).erroredExecutions).toBe(1);   // 23:58 의 오류(마지막 오류 시각은 11-03)
    expect((await judgeJourneyDay(C2, '2026-11-03', late)).erroredExecutions).toBe(1);   // 00:03 의 오류
    expect((await judgeJourneyDay(C2, '2026-11-01', late)).erroredExecutions).toBe(1);   // 기록이 배열이 아닌 옛 행 = 마지막 오류 시각
    expect((await judgeJourneyDay(C2, '2026-10-31', late)).erroredExecutions).toBe(0);
    // 적재 시도 기록은 오류가 아니다 — 정상 발송일(10-30)은 0 · 실제 오류가 난 날(10-28)만 1
    expect((await judgeJourneyDay(C2, '2026-10-30', late)).erroredExecutions).toBe(0);
    expect((await judgeJourneyDay(C2, '2026-10-28', late)).erroredExecutions).toBe(1);
  });

  it('기록은 나빠지는 쪽으로만 남는다 — 표식이 뒤에 풀려 0 으로 읽혀도 처음 본 위반이 지워지지 않는다', async () => {
    const r1 = await runJourneySelfcheck(C2, NOW);
    expect(r1.yesterday.day).toBe(addKstDays(kstYmd(NOW), -1));
    expect(r1.yesterday.violations).toBe(7);
    expect(r1.streak).toBe(0);
    // 관측 = 어제 하루만 행을 만든다 — 그보다 앞선 날(11-02 · 11-03 에 오류가 있었어도)은 본 적이 없으므로 행이 없다
    expect([...(await storedViolations(C2, kstYmd(NOW)))!.keys()]).toEqual([DAY]);
    await query(`UPDATE journey_step_logs SET status = 'sent' WHERE id = $1::uuid`, [stuckClaim]);   // 뒤늦게 풀렸다
    const later = new Date('2026-11-07T03:00:00+09:00');
    expect((await judgeJourneyDay(C2, DAY, later)).stuckClaims).toBe(1);                               // 지금 다시 재면 1
    const r2 = await runJourneySelfcheck(C2, later);
    const kept = (await storedViolations(C2, kstYmd(later)))!;
    expect(kept.get(DAY)).toBe(7);                                                                       // 기록은 7 그대로
    expect(r2.streak).toBe(1);                                                                           // 11-06 은 0 · 11-05 에서 끊김
    // 더 나쁜 값이 뒤에 드러나면 더해진다(재계산 = 이미 있는 행)
    const zero = { failedExecutions: 0, erroredExecutions: 0, stuckClaims: 0, faultLogs: 0, unclosedCampaigns: 0, countMismatch: 0, violations: 0 };
    const worse = await persistVerdict(C2, { ...zero, day: DAY, failedExecutions: 3, violations: 3 }, false);
    expect(worse).toEqual({ state: 'kept', verdict: { day: DAY, failedExecutions: 3, erroredExecutions: 1, stuckClaims: 2, faultLogs: 1, unclosedCampaigns: 1, countMismatch: 1, violations: 9 } });
    // 재계산은 행을 만들지 않는다 — 본 적 없는 날에 위반이 읽혀도(11-02 의 오류) 기록 없음 그대로
    expect(await persistVerdict(C2, { ...zero, day: '2026-11-02', erroredExecutions: 1, violations: 1 }, false)).toEqual({ state: 'unobserved' });
    expect((await storedViolations(C2, kstYmd(later)))!.has('2026-11-02')).toBe(false);
  });

  it('연속 0 일수는 실제로 본 밤만 센다 — 처음 켠 날 1 · 일곱 밤 뒤 7 · 하루 못 보면 그날에서 끊긴다', async () => {
    const night = (d: number) => new Date(`2026-11-${String(d).padStart(2, '0')}T03:00:00+09:00`);
    const first = await runJourneySelfcheck(CLEAN, night(6));
    expect(first.yesterday.violations).toBe(0);
    expect(first.streak).toBe(1);                      // 지난 7일에 흔적이 없어도 본 것은 어제 하루뿐
    expect(first.neverFired).toEqual([]);
    for (let d = 7; d <= 11; d++) expect((await runJourneySelfcheck(CLEAN, night(d))).streak).toBe(d - 5);
    expect((await runJourneySelfcheck(CLEAN, night(12))).streak).toBe(SELFCHECK_WINDOW_DAYS);   // 일곱 밤(11-06 ~ 11-12)을 본 뒤에야 7
    // 11-13 밤을 못 봤다(워커 멈춤) → 11-12 의 행이 없다 · 다음 밤에 과거를 다시 계산해도 채워지지 않는다
    const resumed = await runJourneySelfcheck(CLEAN, night(14));
    expect(resumed.streak).toBe(1);
    const stored = (await storedViolations(CLEAN, kstYmd(night(14))))!;
    expect(stored.has('2026-11-13')).toBe(true);
    expect(stored.has('2026-11-12')).toBe(false);
    expect(zeroStreak(kstYmd(night(14)), stored)).toBe(1);
  });

  it('켜진 여정의 (시작 종류 · 채널) 가운데 7일 동안 안 나간 것을 적는다', async () => {
    expect(await neverFiredCombos(C2)).toEqual(['custom/lms']);
  });

  it('목록 흉내 = 결과가 다 온 직접 캠페인은 완료로 · 여정 단계 캠페인은 그대로', async () => {
    const M = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: M, company_name: 'C134 목록 흉내 회사' });
    const base = new Date().toISOString();
    const d = await mkCampaign({ companyId: M, sendType: 'direct', base, final: true, target: 3, sent: 3, success: 3 });
    const j = await mkCampaign({ companyId: M, base, final: true, target: 3, sent: 3, success: 3 });
    expect(await runListOpenMimic(M)).toBe(1);
    for (let i = 0; i < 40 && (await statusOf(d)).status !== 'completed'; i++) await new Promise((res) => setTimeout(res, 50));
    expect((await statusOf(d)).status).toBe('completed');
    expect((await statusOf(j)).status).toBe('sending');
  });
});
