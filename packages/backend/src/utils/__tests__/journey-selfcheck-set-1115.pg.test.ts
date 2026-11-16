// replaces: none
/**
 * C134 S3 — 합성 회사 여정 세트(서버가 만들고 켠다) · 실 PostgreSQL 판(★ 2026-11-15)
 *   (설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §12-2 · §12-8 · 계약 판 = journey-selfcheck-set-1115.test.ts)
 *   그릇 = 운영 덤프 + 원장 DDL + C134-DDL-2(세트 원장 표). 스팸 결과만 검증기의 `spam` 자리로 넣는다(검사 발송 0) —
 *   만들기 · 칸 알림 끄기 · 보낼 글 판정 · 통과 표식 · 켜기 관문은 운영 함수 그대로 지난다.
 *
 *   0. 원장 표가 없으면 쉰다 · 스위치 밖 · 때 밖 = 아무것도 안 한다
 *   1. 한 흐름 — 만들기 → 알림 끔 → 잇기 → 검증 → 표식 → 켜기 · 다음 tick = 새 여정 0
 *   2. 신원 = 원장 — 이름을 바꿔도 · 멈춤 · 끝 · 보관 · 사람이 지움 = 다시 만들지 · 다시 켜지 않는다
 *   3. 안 이어진 초안은 켜지 않는다
 *   4. 검증 시도 상한 · 다음 시도 시각(검사 중 · 장애 · 차단) · 재기동해도 이어진다
 *   5. 검증하는 사이 사람이 글을 고침 = 표식 0
 *   6. 켜기 거절 = 검증을 다시 걸지 않는다 · 뒤 행을 굶기지 않는다 · 사유가 풀리면 켜진다
 *   7. 판 올림 — 초안이면 원장만 비우고 새 글로 새 여정(옛 초안은 그대로) · 켠 적 있는 여정 · 사람이 지운 여정이면 그대로
 *   8. 잇는 문장 · 원장 판 > 정의 판
 *   9. 진짜 세트 11개가 만들기 · 보낼 글 판정 · 켜기 관문을 전부 지난다
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

// 칸 수정 · 켜는 함수만 감싼다(본문은 운영 그대로) — 「칸 알림 끄기가 실패한 초안」 · 「켜는 함수가 불리기 직전에 끼어드는 사람」을 한 번 흉내 내는 자리
vi.mock('../journey-builder', async (importOriginal) => {
  const real = await importOriginal<typeof import('../journey-builder')>();
  return { ...real, updateJourneyStep: vi.fn(real.updateJourneyStep), activateJourney: vi.fn(real.activateJourney) };
});
// 겹침 쌍 조회만 감싼다(본문은 운영 그대로) — 워커가 원장 행을 잠근 뒤 · 켜는 함수를 부르기 전의 자리에 끼어드는 자리
vi.mock('../journey-activation', async (importOriginal) => {
  const real = await importOriginal<typeof import('../journey-activation')>();
  return { ...real, unresolvedOverlapPairs: vi.fn(real.unresolvedOverlapPairs) };
});
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  SELFCHECK_SET, SET_CAP, MAX_VALIDATIONS, LINK_SQL, RAISE_REV_SQL, runSetCompany, journeySetTick, summarizeSet, resetJourneySetState, setJourneyName, type SetDef,
} from '../journey-selfcheck-set';
import { updateJourneyStep, activateJourney } from '../journey-builder';
import { unresolvedOverlapPairs, activateJourneysInOrder, activateJourneyGuarded } from '../journey-activation';
import type { StepSpamTestResult } from '../journey-pretest-validator';

const NOON = new Date('2026-11-16T12:00:00+09:00');
const verdictOf = (verdict: StepSpamTestResult['verdict']): StepSpamTestResult =>
  ({ verdict, ok: verdict === 'pass', enqueueOk: true, failedCarriers: verdict === 'blocked' ? ['SKT(LMS)'] : [], matchedStopWords: [], score: verdict === 'pass' ? 95 : 0 });
/** 스팸 결과를 넣는 자리 + 불린 횟수 */
function spamOf(verdict: StepSpamTestResult['verdict']) {
  const f = Object.assign(async () => { f.calls++; return verdictOf(f.verdict); }, { calls: 0, verdict });
  return f;
}

let seq = 0;
/** 회사 하나(관리자 · 인증된 발신번호 하나 · 생일이 있는 고객 하나) — 번호는 형식만 맞는 도달 불가 값 */
async function mkCompany(): Promise<{ co: string; admin: string; customer: string; cb: string }> {
  const co = randomUUID(); const admin = randomUUID(); const customer = randomUUID();
  const n = String(++seq).padStart(3, '0');
  const cb = `021234${n}5`;
  await insertMinimalRow(pool, 'companies', { id: co, company_name: `C134 S3 여정 세트 ${n}` });
  await insertMinimalRow(pool, 'users', { id: admin, company_id: co, user_type: 'admin', is_active: true, login_id: `t-c134s3-${co.slice(0, 8)}`, phone: `0100000${n}5` });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: co, phone_number: cb, is_active: true, is_verified: true });
  await insertMinimalRow(pool, 'customers', { id: customer, company_id: co, phone: `0100001${n}5`, name: '김합성', is_active: true, sms_opt_in: true, birth_date: '1990-05-05' });
  return { co, admin, customer, cb };
}
/** 시험용 세트 행 — 생일(회사에 생일 있는 고객이 있으면 켜기 관문을 지난다) · 문자 칸 둘 */
const D = (key: string, over: Partial<SetDef> = {}): SetDef => ({
  key, rev: 1, label: `시험 ${key}`, triggerEvent: 'customer.birthday_approaching', triggerFilters: { days_before: 7 }, allowReentry: true, reentryCooldownDays: 365,
  steps: [
    { channel: 'lms', delayHours: 0, subject: '생일 축하 인사', body: '%고객명%님, 곧 다가오는 생일을 미리 축하드립니다.' },
    { channel: 'sms', delayHours: 24, body: '%고객명%님, 생일을 축하드립니다.' },
  ],
  ...over,
});
const ledger = async (co: string, key: string) => {
  const r = (await query(
    `SELECT journey_id, def_rev, validations, last_reason, next_validate_at IS NULL AS no_next, COALESCE(next_validate_at = 'infinity', false) AS never,
            CASE WHEN next_validate_at IS NULL OR next_validate_at = 'infinity' THEN NULL ELSE EXTRACT(EPOCH FROM (next_validate_at - NOW())) END AS wait_sec
       FROM journey_selfcheck_set WHERE company_id = $1::uuid AND set_key = $2`, [co, key])).rows[0];
  return r ? {
    journeyId: r.journey_id ? String(r.journey_id) : null, rev: Number(r.def_rev), validations: Number(r.validations), reason: r.last_reason as string | null,
    noNext: r.no_next === true, never: r.never === true, waitSec: r.wait_sec === null ? null : Number(r.wait_sec),
  } : null;
};
const journeysOf = async (co: string) => (await query(
  `SELECT id, name, status, created_by, trigger_event, threshold_recipients_per_step AS cap, last_pretest_passed_at IS NOT NULL AS marked, archived_at IS NOT NULL AS archived
     FROM journeys WHERE company_id = $1::uuid ORDER BY created_at, id`, [co])).rows.map((r: any) => ({
  id: String(r.id), name: String(r.name), status: String(r.status), createdBy: String(r.created_by), trigger: String(r.trigger_event),
  cap: r.cap === null ? null : Number(r.cap), marked: r.marked === true, archived: r.archived === true,
}));
const stepsOf = async (journeyId: string) => (await query(
  `SELECT id, step_order, channel, message_template, subject, delay_hours, notify_manager_on_pretest AS notify FROM journey_steps WHERE journey_id = $1::uuid ORDER BY step_order`,
  [journeyId])).rows;
/** 다음 시도 시각을 지나게 한다(시계를 돌리는 대신 원장의 시각을 과거로) */
const makeDue = (co: string, key: string) => query(
  `UPDATE journey_selfcheck_set SET next_validate_at = NOW() - INTERVAL '1 minute' WHERE company_id = $1::uuid AND set_key = $2`, [co, key]);
const setStatus = (id: string, sets: string) => query(`UPDATE journeys SET ${sets} WHERE id = $1::uuid`, [id]);

afterEach(() => { delete process.env.JOURNEY_SELFCHECK_SET_COMPANY_IDS; resetJourneySetState(); });

describe('0. 원장 표가 없으면 쉰다 · 스위치 밖 · 때 밖 = 아무것도 안 한다', () => {
  it('표 없음(C134-DDL-2 전) = 던지지 않고 여정 0 → 이 시험 끝에서 표를 얹는다', async () => {
    const { co } = await mkCompany();
    process.env.JOURNEY_SELFCHECK_SET_COMPANY_IDS = co;
    await expect(journeySetTick([co], NOON, { defs: [D('pre')], spam: spamOf('pass') })).resolves.toBeUndefined();
    expect(await journeysOf(co)).toEqual([]);
    await pool.query(ledgerBlockSql('C134-DDL-2'));
    const cols = await query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'journey_selfcheck_set' ORDER BY ordinal_position`);
    expect(cols.rows.map((c: any) => `${c.column_name} ${c.data_type} ${c.is_nullable}`)).toEqual([
      'company_id uuid NO', 'set_key text NO', 'journey_id uuid YES', 'def_rev integer NO', 'validations integer NO',
      'next_validate_at timestamp with time zone YES', 'last_reason text YES', 'created_at timestamp with time zone NO', 'updated_at timestamp with time zone NO',
    ]);
  });

  it('스위치 ENV 가 비었거나 다른 회사만 적혀 있으면 원장 행도 여정도 0 · 때 밖(18시 뒤 · 9시 전)도 0 · 스위치 + 낮 = 만든다', async () => {
    const { co } = await mkCompany();
    const opts = { defs: [D('sw')], spam: spamOf('pass') };
    const rows = async () => Number((await query(`SELECT COUNT(*)::int AS n FROM journey_selfcheck_set WHERE company_id = $1::uuid`, [co])).rows[0].n);

    await journeySetTick([co], NOON, opts);                                                  // ENV 없음
    process.env.JOURNEY_SELFCHECK_SET_COMPANY_IDS = randomUUID();
    await journeySetTick([co], NOON, opts);                                                  // 다른 회사만
    process.env.JOURNEY_SELFCHECK_SET_COMPANY_IDS = co;
    await journeySetTick([co], new Date('2026-11-16T18:00:00+09:00'), opts);                 // 때 밖
    await journeySetTick([co], new Date('2026-11-16T08:59:00+09:00'), opts);
    await journeySetTick([], NOON, opts);                                                    // 합성 회사 목록에 없다(부르는 쪽이 넘긴 목록 밖)
    expect(await rows()).toBe(0);
    expect(await journeysOf(co)).toEqual([]);
    expect(opts.spam.calls).toBe(0);

    await journeySetTick([co.toUpperCase()], NOON, opts);
    expect((await journeysOf(co)).map((j) => j.status)).toEqual(['active']);
  });
});

describe('1. 한 흐름 — 만들기 → 알림 끔 → 잇기 → 검증 → 표식 → 켜기', () => {
  it('한 tick 에 여정 하나가 켜진다(최대 인원 200 · 칸 알림 꺼짐 · 만든 계정 = 관리자) · 다음 tick = 새 여정 0 · 검사 0', async () => {
    const { co, admin } = await mkCompany();
    const spam = spamOf('pass');
    const def = D('flow');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    const js = await journeysOf(co);
    expect(js).toEqual([{ id: js[0].id, name: '자동 점검 · 시험 flow', status: 'active', createdBy: admin, trigger: 'customer.birthday_approaching', cap: SET_CAP, marked: true, archived: false }]);
    expect(SET_CAP).toBe(200);
    const steps = await stepsOf(js[0].id);
    expect(steps.map((s: any) => [Number(s.step_order), s.channel, s.message_template, s.subject || '', Number(s.delay_hours), s.notify])).toEqual([
      [1, 'lms', '%고객명%님, 곧 다가오는 생일을 미리 축하드립니다.', '생일 축하 인사', 0, false],
      [2, 'sms', '%고객명%님, 생일을 축하드립니다.', '', 24, false],
    ]);
    expect(spam.calls).toBe(2);   // 문자 칸 둘
    expect(await ledger(co, 'flow')).toMatchObject({ journeyId: js[0].id, rev: 1, validations: 1, reason: null });

    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');
    expect(await journeysOf(co)).toHaveLength(1);
    expect(spam.calls).toBe(2);
    expect(await summarizeSet(co, [def])).toMatchObject({ total: 1, active: 1, draft: 0, missing: 0, unlinkedDrafts: 0 });
    // 켜진 여정에 낡은 사유가 남아 있어도(켠 직후 죽음) 하루 줄에는 싣지 않는다
    await query(`UPDATE journey_selfcheck_set SET last_reason = '켜지 못했다: 낡은 사유' WHERE company_id = $1::uuid`, [co]);
    expect((await summarizeSet(co, [def])).reasons).toEqual([]);
    await setStatus(js[0].id, `status = 'paused', paused_at = NOW()`);
    expect((await summarizeSet(co, [def])).reasons).toEqual(['flow=켜지 못했다: 낡은 사유']);
  });

  it('관리자 계정이 없으면(또는 번호가 없으면) 만들지 않는다 · 보내는 번호를 정할 수 없으면 만들지 않고 사유를 남긴다', async () => {
    const { co, admin } = await mkCompany();
    await query(`UPDATE users SET phone = NULL WHERE id = $1::uuid`, [admin]);
    expect(await runSetCompany(co, NOON, { defs: [D('noactor')], spam: spamOf('pass') })).toBe('no_actor');
    expect(await journeysOf(co)).toEqual([]);

    const b = await mkCompany();
    await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: b.co, phone_number: '0212349995', is_active: true, is_verified: true });   // 번호 둘 · 기본 없음
    expect(await runSetCompany(b.co, NOON, { defs: [D('nocb')], spam: spamOf('pass') })).toBe('idle');
    expect(await journeysOf(b.co)).toEqual([]);
    expect((await ledger(b.co, 'nocb'))!.reason).toContain('보내는 번호');
  });
});

describe('2. 신원 = 원장(이름과 무관) · 켠 적 있는 여정 · 사람이 지운 여정은 그대로 둔다', () => {
  it('이름을 바꾼 초안 = 새로 만들지 않고 그 여정을 이어 간다', async () => {
    const { co } = await mkCompany();
    const def = D('rename');
    await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pending') });
    const [j] = await journeysOf(co);
    expect(j.status).toBe('draft');
    await setStatus(j.id, `name = '담당자가 바꾼 이름'`);
    await makeDue(co, 'rename');
    expect(await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pass') })).toBe('worked');
    expect((await journeysOf(co)).map((x) => [x.id, x.name, x.status])).toEqual([[j.id, '담당자가 바꾼 이름', 'active']]);
  });

  it.each([
    ['멈춤', `status = 'paused', paused_at = NOW(), pause_reason = '잔액이 부족해요'`, 'paused'],
    ['끝', `status = 'ended'`, 'ended'],
    ['보관(초안)', `status = 'draft', archived_at = NOW()`, 'draft'],
  ])('%s = 다시 켜지 않는다 · 다시 만들지 않는다 · 이름을 바꿔도 같다', async (_n, sets, status) => {
    const { co } = await mkCompany();
    const def = D('keep');
    const spam = spamOf('pass');
    await runSetCompany(co, NOON, { defs: [def], spam });
    const [j] = await journeysOf(co);
    await setStatus(j.id, `${sets}, name = '바꾼 이름'`);
    await makeDue(co, 'keep');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');
    expect((await journeysOf(co)).map((x) => [x.id, x.status])).toEqual([[j.id, status]]);
    expect(spam.calls).toBe(2);
  });

  it('검증 전에 보관한 초안 = 때가 와도 검사를 걸지 않는다 · 켜지 않는다', async () => {
    const { co } = await mkCompany();
    const def = D('shelved');
    const spam = spamOf('pending');
    await runSetCompany(co, NOON, { defs: [def], spam });
    const [j] = await journeysOf(co);
    await setStatus(j.id, `archived_at = NOW()`);
    await makeDue(co, 'shelved');
    spam.verdict = 'pass';
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');
    expect(spam.calls).toBe(2);                                                            // 처음 한 번(칸 둘)뿐
    expect((await journeysOf(co)).map((x) => [x.status, x.marked, x.archived])).toEqual([['draft', false, true]]);
    expect((await ledger(co, 'shelved'))!.validations).toBe(1);
  });

  it('사람이 지운 여정 = 다시 만들지 않는다(원장은 그 id 를 그대로 가리킨다)', async () => {
    const { co } = await mkCompany();
    const def = D('gone');
    await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pending') });
    const [j] = await journeysOf(co);
    await query(`DELETE FROM journeys WHERE id = $1::uuid`, [j.id]);
    await makeDue(co, 'gone');
    const spam = spamOf('pass');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');
    expect(await journeysOf(co)).toEqual([]);
    expect((await ledger(co, 'gone'))!.journeyId).toBe(j.id);
    expect(spam.calls).toBe(0);
    expect(await summarizeSet(co, [def])).toMatchObject({ deleted: 1, missing: 0 });
  });
});

describe('3. 안 이어진 초안(만들다 죽은 것)은 워커가 켜지 않는다', () => {
  it('세트 이름의 초안이 있어도(칸 하나 · 알림 기본값) 원장에 안 이어져 있으면 검증 · 켜기 0 · 워커는 새로 하나 만들어 그것만 켠다', async () => {
    const { co, admin } = await mkCompany();
    const def = D('orphan');
    const orphan = randomUUID();
    await insertMinimalRow(pool, 'journeys', { id: orphan, company_id: co, created_by: admin, name: setJourneyName(def), status: 'draft', start_kind: 'event',
      trigger_event: def.triggerEvent, trigger_filters: def.triggerFilters, callback_number: '0212340005', created_at: '2026-11-01T00:00:00Z' });
    await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: orphan, step_order: 1, step_type: 'message', channel: 'lms', message_template: def.steps[0].body, subject: '생일 축하 인사', delay_hours: 0 });

    expect(await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pass') })).toBe('worked');
    const js = await journeysOf(co);
    expect(js.map((x) => [x.id === orphan, x.status, x.marked])).toEqual([[true, 'draft', false], [false, 'active', true]]);
    expect((await stepsOf(orphan)).map((s: any) => s.notify)).toEqual([null]);            // 워커가 손대지 않았다
    expect((await ledger(co, 'orphan'))!.journeyId).toBe(js[1].id);
    expect(await summarizeSet(co, [def])).toMatchObject({ active: 1, unlinkedDrafts: 1 });
  });

  it('칸 알림 끄기가 실패한 초안 = 잇지 않는다 · 검증 · 켜기 0 · 같은 날 다시 만들지 않는다(하루 한 번) · 때가 되면 새로 만들어 그것만 켠다', async () => {
    const { co } = await mkCompany();
    const def = D('notify');
    const spam = spamOf('pass');
    vi.mocked(updateJourneyStep).mockResolvedValueOnce(true).mockResolvedValueOnce(false);   // 첫 칸은 껐고 둘째 칸에서 실패
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    let js = await journeysOf(co);
    expect(js.map((j) => [j.status, j.marked])).toEqual([['draft', false]]);
    const first = (await ledger(co, 'notify'))!;
    expect(first.journeyId).toBeNull();
    expect(first.reason).toContain('칸 알림을 끄지 못했다');
    expect(first.waitSec!).toBeGreaterThan(23 * 3600);
    expect(spam.calls).toBe(0);

    resetJourneySetState();
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');            // 같은 날 = 다시 만들지 않는다(안 이어진 초안이 tick 마다 쌓이지 않는다)
    expect(await journeysOf(co)).toHaveLength(1);

    await makeDue(co, 'notify');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    js = await journeysOf(co);
    expect(js.map((j) => j.status)).toEqual(['draft', 'active']);
    expect((await stepsOf(js[1].id)).map((s: any) => s.notify)).toEqual([false, false]);
    expect((await ledger(co, 'notify'))!.journeyId).toBe(js[1].id);
    expect(await summarizeSet(co, [def])).toMatchObject({ active: 1, unlinkedDrafts: 1 });
  });

  it('만들기가 거절되면(정의가 계약을 못 지남) 여정 0 · 사유를 남기고 같은 날 다시 시도하지 않는다', async () => {
    const { co } = await mkCompany();
    const bad = D('bad', { triggerEvent: 'purchase.product', triggerFilters: { product_keys: ['SK-101'] }, reentryCooldownDays: 0 });   // 문(door)이 없다
    expect(await runSetCompany(co, NOON, { defs: [bad], spam: spamOf('pass') })).toBe('worked');
    expect(await journeysOf(co)).toEqual([]);
    const l = (await ledger(co, 'bad'))!;
    expect(l.journeyId).toBeNull();
    expect(l.reason).toContain('만들지 못했다');
    expect(l.waitSec!).toBeGreaterThan(23 * 3600);
    expect(await runSetCompany(co, NOON, { defs: [bad], spam: spamOf('pass') })).toBe('idle');
    expect(await journeysOf(co)).toEqual([]);
  });
});

describe('4. 검증 시도 — 시도 시작이 횟수와 다음 시도 시각을 쓴다', () => {
  it('검사 장애 = 하루 뒤 · 그 전에는 검사를 걸지 않는다 · 다섯 번 뒤에는 때가 와도 걸지 않는다 · 재기동해도 횟수가 이어진다', async () => {
    const { co } = await mkCompany();
    const def = D('error');
    const spam = spamOf('error');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    const first = (await ledger(co, 'error'))!;
    expect(first.validations).toBe(1);
    expect(first.waitSec!).toBeGreaterThan(23 * 3600);
    expect(first.waitSec!).toBeLessThanOrEqual(24 * 3600);
    expect(first.reason).toContain('spam_check_unavailable');
    const callsPerTry = spam.calls;
    expect(callsPerTry).toBe(2);

    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');            // 아직 때가 아니다
    expect(spam.calls).toBe(callsPerTry);

    for (let i = 2; i <= MAX_VALIDATIONS; i++) {
      await makeDue(co, 'error');
      resetJourneySetState();                                                              // 재기동 흉내(프로세스 메모리 비움)
      expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
      expect((await ledger(co, 'error'))!.validations).toBe(i);
    }
    expect(MAX_VALIDATIONS).toBe(5);
    expect(spam.calls).toBe(callsPerTry * 5);

    await makeDue(co, 'error');
    resetJourneySetState();
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');            // 다 썼다
    expect(spam.calls).toBe(callsPerTry * 5);
    expect((await ledger(co, 'error'))!.validations).toBe(5);
    expect((await journeysOf(co)).map((j) => [j.status, j.marked])).toEqual([['draft', false]]);
    expect(await summarizeSet(co, [def])).toMatchObject({ draft: 1, exhausted: 1 });
  });

  it('검사 중 = 30분 뒤로 당긴다 · 그 뒤 통과하면 켜진다', async () => {
    const { co } = await mkCompany();
    const def = D('pending');
    const spam = spamOf('pending');
    await runSetCompany(co, NOON, { defs: [def], spam });
    const l = (await ledger(co, 'pending'))!;
    expect(l.validations).toBe(1);
    expect(l.waitSec!).toBeGreaterThan(29 * 60);
    expect(l.waitSec!).toBeLessThanOrEqual(30 * 60);
    expect(l.reason).toContain('spam_check_pending');

    spam.verdict = 'pass';
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');            // 30분 전
    await makeDue(co, 'pending');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    expect((await journeysOf(co)).map((j) => j.status)).toEqual(['active']);
    expect((await ledger(co, 'pending'))!.validations).toBe(2);
  });

  it('차단(글 문제) = 다음 시도 없음 · 그 뒤로 검사를 걸지 않는다', async () => {
    const { co } = await mkCompany();
    const def = D('blocked');
    const spam = spamOf('blocked');
    await runSetCompany(co, NOON, { defs: [def], spam });
    const l = (await ledger(co, 'blocked'))!;
    expect(l).toMatchObject({ validations: 1, never: true });
    expect(l.reason).toContain('spam_filter_failed');
    const calls = spam.calls;
    spam.verdict = 'pass';
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('idle');
    expect(spam.calls).toBe(calls);
    expect((await journeysOf(co)).map((j) => [j.status, j.marked])).toEqual([['draft', false]]);
  });
});

describe('5. 검증하는 사이 사람이 글을 고침 = 표식 0(옛 글의 검사 결과로 새 글을 켜지 않는다)', () => {
  it('검증 도중 칸 글이 바뀌면 표식을 못 찍고 안 켠다 · 다음 시도가 고친 글로 검증해 켠다', async () => {
    const { co } = await mkCompany();
    const def = D('edited');
    let edited = false;
    const editing = Object.assign(async () => {
      editing.calls++;
      if (!edited) {
        edited = true;
        const [j] = await journeysOf(co);
        const [s1] = await stepsOf(j.id);
        expect(await updateJourneyStep(co, j.id, String(s1.id), { messageTemplate: '%고객명%님, 생일을 미리 축하드립니다. 좋은 하루 보내세요.' })).toBe(true);
      }
      return verdictOf('pass');
    }, { calls: 0 });
    expect(await runSetCompany(co, NOON, { defs: [def], spam: editing })).toBe('worked');
    const [j] = await journeysOf(co);
    expect([j.status, j.marked]).toEqual(['draft', false]);
    const l = (await ledger(co, 'edited'))!;
    expect(l.validations).toBe(1);
    expect(l.waitSec!).toBeLessThanOrEqual(30 * 60);
    expect(l.reason).toContain('바뀌었다');

    await makeDue(co, 'edited');
    const spam = spamOf('pass');
    expect(await runSetCompany(co, NOON, { defs: [def], spam })).toBe('worked');
    expect((await journeysOf(co)).map((x) => x.status)).toEqual(['active']);
    expect((await stepsOf(j.id))[0].message_template).toBe('%고객명%님, 생일을 미리 축하드립니다. 좋은 하루 보내세요.');   // 사람이 고친 글 그대로
  });
});

describe('6. 켜기 거절 = 검증을 다시 걸지 않는다 · 뒤 행을 굶기지 않는다 · 사유가 풀리면 켜진다', () => {
  it('장바구니 사건이 없는 회사의 장바구니 여정 = 표식은 찍히고 켜기만 거절 → 다음 tick 은 뒤 행을 진행 → 사건이 들어오면 켜진다(검사 추가 0)', async () => {
    const { co } = await mkCompany();
    const cart = D('cart', { label: '시험 장바구니', triggerEvent: 'cdp.cart_abandon', triggerFilters: { abandon_hours: 24 }, reentryCooldownDays: 7 });
    const birthday = D('after');
    const spam = spamOf('pass');
    const defs = [cart, birthday];

    expect(await runSetCompany(co, NOON, { defs, spam })).toBe('worked');                 // 장바구니: 만들고 검증까지
    let js = await journeysOf(co);
    expect(js.map((j) => [j.trigger, j.status, j.marked])).toEqual([['cdp.cart_abandon', 'draft', true]]);
    expect((await ledger(co, 'cart'))!.reason).toContain('장바구니 정보');
    expect(spam.calls).toBe(2);

    expect(await runSetCompany(co, NOON, { defs, spam })).toBe('worked');                 // 장바구니 = 거절(일 아님) → 뒤 행이 진행된다
    js = await journeysOf(co);
    expect(js.map((j) => [j.trigger, j.status])).toEqual([['cdp.cart_abandon', 'draft'], ['customer.birthday_approaching', 'active']]);
    expect(spam.calls).toBe(4);
    expect((await ledger(co, 'cart'))!.validations).toBe(1);                              // 검증을 다시 걸지 않았다

    expect(await runSetCompany(co, NOON, { defs, spam })).toBe('idle');
    expect(spam.calls).toBe(4);

    await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: co, event_name: 'cart_add' });
    expect(await runSetCompany(co, NOON, { defs, spam })).toBe('worked');
    expect((await journeysOf(co)).map((j) => j.status)).toEqual(['active', 'active']);
    expect(spam.calls).toBe(4);
    expect(await ledger(co, 'cart')).toMatchObject({ validations: 1, reason: null });
  });
});

describe('7. 판 올림 — 워커는 여정을 지우지 않는다', () => {
  const REV2 = { rev: 2, steps: [{ channel: 'lms' as const, delayHours: 0, subject: '생일 축하 인사', body: '%고객명%님, 다가오는 생일을 진심으로 축하드립니다.' }] };

  it('차단된 초안 + 판 2 = 원장만 비우고 새 글 · 이름 끝 (판 2) 로 새 여정을 만들어 켠다 · 옛 초안의 행 · 칸은 그대로 남는다', async () => {
    const { co } = await mkCompany();
    await runSetCompany(co, NOON, { defs: [D('rev')], spam: spamOf('blocked') });
    const [old] = await journeysOf(co);
    const oldSteps = await stepsOf(old.id);
    expect((await ledger(co, 'rev'))!.never).toBe(true);

    expect(await runSetCompany(co, NOON, { defs: [D('rev', REV2)], spam: spamOf('pass') })).toBe('worked');
    const js = await journeysOf(co);
    expect(js.map((j) => [j.id === old.id, j.name, j.status])).toEqual([[true, '자동 점검 · 시험 rev', 'draft'], [false, '자동 점검 · 시험 rev (판 2)', 'active']]);
    expect(await stepsOf(old.id)).toEqual(oldSteps);                                       // 지워진 것 0 · 바뀐 것 0
    expect((await stepsOf(js[1].id)).map((s: any) => s.message_template)).toEqual([REV2.steps[0].body]);
    expect(await ledger(co, 'rev')).toMatchObject({ journeyId: js[1].id, rev: 2, validations: 1 });
    expect(await summarizeSet(co, [D('rev', REV2)])).toMatchObject({ active: 1, unlinkedDrafts: 1 });
  });

  it.each([
    ['켜짐', null],
    ['멈춤(켰다 멈춘 여정 · 실행 · 발송 기록이 있다)', `status = 'paused', paused_at = NOW()`],
    ['끝', `status = 'ended'`],
    ['보관한 초안', `status = 'draft', archived_at = NOW()`],
  ])('이어진 여정이 %s 이면 판을 올려도 원장 · 여정 · 기록이 그대로다(새 여정 0)', async (_n, sets) => {
    const { co, customer } = await mkCompany();
    await runSetCompany(co, NOON, { defs: [D('held')], spam: spamOf('pass') });
    const [j] = await journeysOf(co);
    const [s1] = await stepsOf(j.id);
    const exec = randomUUID();
    await insertMinimalRow(pool, 'journey_executions', { id: exec, journey_id: j.id, customer_id: customer, status: 'active' });
    await insertMinimalRow(pool, 'journey_step_logs', { id: randomUUID(), execution_id: exec, step_id: s1.id, status: 'sent', sent_at: new Date().toISOString(), cost: 0 });
    if (sets) await setStatus(j.id, sets);
    const raw = () => query(`SELECT journey_id, def_rev, validations, next_validate_at::text AS next_raw, last_reason, updated_at::text AS upd FROM journey_selfcheck_set WHERE company_id = $1::uuid AND set_key = 'held'`, [co]);
    const before = (await raw()).rows;

    const spam = spamOf('pass');
    expect(await runSetCompany(co, NOON, { defs: [D('held', REV2)], spam })).toBe('idle');
    expect((await raw()).rows).toEqual(before);                                            // 원장 행이 한 칸도 안 바뀌었다(판 1 · 그 여정 그대로)
    expect(before[0]).toMatchObject({ journey_id: j.id, def_rev: 1 });
    expect((await journeysOf(co)).map((x) => x.id)).toEqual([j.id]);
    expect(await stepsOf(j.id)).toHaveLength(2);
    expect(Number((await query(`SELECT COUNT(*)::int AS n FROM journey_step_logs WHERE execution_id = $1::uuid`, [exec])).rows[0].n)).toBe(1);
    expect(spam.calls).toBe(0);
  });

  it('사람이 지운 여정이 이어져 있으면 판을 올려도 다시 만들지 않는다', async () => {
    const { co } = await mkCompany();
    await runSetCompany(co, NOON, { defs: [D('wiped')], spam: spamOf('pending') });
    const [j] = await journeysOf(co);
    await query(`DELETE FROM journeys WHERE id = $1::uuid`, [j.id]);
    expect(await runSetCompany(co, NOON, { defs: [D('wiped', REV2)], spam: spamOf('pass') })).toBe('idle');
    expect(await journeysOf(co)).toEqual([]);
    expect(await ledger(co, 'wiped')).toMatchObject({ journeyId: j.id, rev: 1 });
  });
});

describe('8. 잇는 문장 · 원장 판 > 정의 판', () => {
  it('잇는 문장 = 여정이 없고 원장 판이 정의 판과 같을 때만(판이 다르거나 이미 이어져 있으면 0행)', async () => {
    const { co } = await mkCompany();
    await query(`INSERT INTO journey_selfcheck_set (company_id, set_key, def_rev) VALUES ($1::uuid, 'link', 2)`, [co]);
    const a = randomUUID(); const b = randomUUID();
    expect((await query(LINK_SQL, [co, 'link', a, 1])).rowCount).toBe(0);                  // 옛 판 정의로 만든 초안 = 안 이어진다
    expect((await ledger(co, 'link'))!.journeyId).toBeNull();
    expect((await query(LINK_SQL, [co, 'link', a, 2])).rowCount).toBe(1);
    expect((await query(LINK_SQL, [co, 'link', b, 2])).rowCount).toBe(0);                  // 이미 이어져 있다
    expect((await ledger(co, 'link'))!.journeyId).toBe(a);
  });

  it('원장 판 > 정의 판(새 판 워커가 지나간 뒤 옛 판 코드가 돈다) = 여정 0 · 원장 그대로', async () => {
    const { co } = await mkCompany();
    await query(`INSERT INTO journey_selfcheck_set (company_id, set_key, def_rev) VALUES ($1::uuid, 'old', 2)`, [co]);
    const spam = spamOf('pass');
    expect(await runSetCompany(co, NOON, { defs: [D('old')], spam })).toBe('idle');        // 정의 판 1
    expect(await journeysOf(co)).toEqual([]);
    expect(await ledger(co, 'old')).toMatchObject({ journeyId: null, rev: 2, validations: 0, noNext: true });
    expect(spam.calls).toBe(0);

    // 새 판 코드가 만든 초안이 이어져 있어도 옛 판 코드는 검증 · 켜기를 하지 않는다
    await runSetCompany(co, NOON, { defs: [D('old', { rev: 2 })], spam: spamOf('pending') });
    const [j] = await journeysOf(co);
    await makeDue(co, 'old');
    expect(await runSetCompany(co, NOON, { defs: [D('old')], spam })).toBe('idle');
    expect((await journeysOf(co)).map((x) => [x.id, x.status, x.marked])).toEqual([[j.id, 'draft', false]]);
    expect(spam.calls).toBe(0);
  });

  it('새 판 코드가 검증까지 마친 초안(표식 있음)도 옛 판 코드는 켜지 않는다', async () => {
    const { co } = await mkCompany();
    const cart = (rev: number) => D('oldcart', { rev, label: '시험 장바구니', triggerEvent: 'cdp.cart_abandon', triggerFilters: { abandon_hours: 24 }, reentryCooldownDays: 7 });
    await runSetCompany(co, NOON, { defs: [cart(2)], spam: spamOf('pass') });               // 판 2: 검증 통과 · 장바구니 사건이 없어 켜기만 거절
    const [j] = await journeysOf(co);
    expect([j.status, j.marked]).toEqual(['draft', true]);
    await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: co, event_name: 'cart_add' });   // 이제 켤 수 있다

    expect(await runSetCompany(co, NOON, { defs: [cart(1)], spam: spamOf('pass') })).toBe('idle');   // 옛 판 코드
    expect((await journeysOf(co)).map((x) => [x.id, x.status])).toEqual([[j.id, 'draft']]);
    expect(await runSetCompany(co, NOON, { defs: [cart(2)], spam: spamOf('pass') })).toBe('worked'); // 새 판 코드가 켠다
    expect((await journeysOf(co)).map((x) => x.status)).toEqual(['active']);
  });
});

describe('10. 켜는 마지막 순간 — 원장 행 잠금 + 다시 확인 · 초안일 때만(Codex 구현 1R)', () => {
  const REV2 = { rev: 2, steps: [{ channel: 'lms' as const, delayHours: 0, subject: '생일 축하 인사', body: '%고객명%님, 다가오는 생일을 진심으로 축하드립니다.' }] };

  it('초안일 때만 켜는 조건은 켜는 트랜잭션이 본다 — 멈춘 여정(표식 있음)은 켜지 않고 그대로 · 초안은 켠다 · 조건을 안 주면 종전대로 멈춘 여정도 켠다', async () => {
    const { co, admin, cb } = await mkCompany();
    const mk = async (status: string) => {
      const id = randomUUID();
      await insertMinimalRow(pool, 'journeys', { id, company_id: co, created_by: admin, name: `초안일 때만 ${status}`, status, start_kind: 'event', trigger_event: 'custom',
        trigger_filters: { all_customers: true }, callback_number: cb, last_pretest_passed_at: new Date().toISOString(),
        ...(status === 'paused' ? { paused_at: new Date().toISOString() } : {}) });
      await insertMinimalRow(pool, 'journey_steps', { id: randomUUID(), journey_id: id, step_order: 1, step_type: 'message', channel: 'sms', message_template: '반갑습니다. 매장에서 다시 뵙겠습니다.', delay_mode: 'relative', delay_hours: 0 });
      return id;
    };
    const statusOf = async (id: string) => String((await query(`SELECT status FROM journeys WHERE id = $1::uuid`, [id])).rows[0].status);

    const paused = await mk('paused');
    expect(await activateJourney(co, paused, admin, {}, true)).toMatchObject({ ok: false });
    expect(await statusOf(paused)).toBe('paused');
    const viaBatch = await activateJourneysInOrder(co, admin, [paused], { draftOnly: true });
    expect(viaBatch.ok && viaBatch.items[0].result).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    expect(await statusOf(paused)).toBe('paused');
    expect(await activateJourneyGuarded(co, paused, admin, { draftOnly: true })).toMatchObject({ ok: false, code: 'ACTIVATE_FAILED' });   // 관문 함수도 조건을 켜는 트랜잭션까지 넘긴다
    expect(await statusOf(paused)).toBe('paused');

    const draft = await mk('draft');
    expect((await activateJourney(co, draft, admin, {}, true)).ok).toBe(true);
    expect(await statusOf(draft)).toBe('active');

    expect((await activateJourney(co, paused, admin)).ok).toBe(true);                       // 조건 없음 = 종전(다시 켜기)
    expect(await statusOf(paused)).toBe('active');
  });

  it('워커가 초안이라고 읽은 뒤 사람이 켰다 멈춘 여정 = 워커가 다시 켜지 않는다', async () => {
    const { co } = await mkCompany();
    const cart = D('paused-race', { label: '시험 장바구니', triggerEvent: 'cdp.cart_abandon', triggerFilters: { abandon_hours: 24 }, reentryCooldownDays: 7 });
    await runSetCompany(co, NOON, { defs: [cart], spam: spamOf('pass') });                   // 표식은 찍히고 켜기만 거절(장바구니 사건 없음)
    const [j] = await journeysOf(co);
    expect([j.status, j.marked]).toEqual(['draft', true]);
    await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: co, event_name: 'cart_add' });

    // 워커가 여정 상태를 읽고 원장 행을 잠근 뒤 · 켜는 함수를 부르기 전에 사람이 켰다 멈춘다
    vi.mocked(unresolvedOverlapPairs).mockImplementationOnce(async (...args) => {
      await setStatus(j.id, `status = 'paused', paused_at = NOW(), pause_reason = '담당자가 멈춤'`);
      return (await vi.importActual<typeof import('../journey-activation')>('../journey-activation')).unresolvedOverlapPairs(...args);
    });
    expect(await runSetCompany(co, NOON, { defs: [cart], spam: spamOf('pass') })).toBe('idle');
    expect((await journeysOf(co)).map((x) => [x.id, x.status])).toEqual([[j.id, 'paused']]);
    expect((await ledger(co, 'paused-race'))!.reason).toContain('초안일 때만');
  });

  it('묶음 켜기 · 관문 함수가 초안이라고 읽은 뒤 · 켜는 함수가 여정 행을 잠그기 직전에 켰다 멈춘 여정 = 켜는 트랜잭션이 막는다', async () => {
    const { co } = await mkCompany();
    const cart = D('late-race', { label: '시험 장바구니', triggerEvent: 'cdp.cart_abandon', triggerFilters: { abandon_hours: 24 }, reentryCooldownDays: 7 });
    await runSetCompany(co, NOON, { defs: [cart], spam: spamOf('pass') });
    const [j] = await journeysOf(co);
    await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: co, event_name: 'cart_add' });

    // 켜는 함수가 불린 순간(묶음 켜기와 관문 함수의 상태 읽기는 이미 「초안」으로 끝났다)에 사람이 켰다 멈춘다
    const real = await vi.importActual<typeof import('../journey-builder')>('../journey-builder');
    let sawDraftOnly: unknown = null;
    vi.mocked(activateJourney).mockImplementationOnce(async (c, id, u, opts, draftOnly) => {
      sawDraftOnly = draftOnly;
      await setStatus(j.id, `status = 'paused', paused_at = NOW(), pause_reason = '담당자가 멈춤'`);
      return real.activateJourney(c, id, u, opts, draftOnly);
    });
    expect(await runSetCompany(co, NOON, { defs: [cart], spam: spamOf('pass') })).toBe('idle');
    expect(sawDraftOnly).toBe(true);
    expect((await journeysOf(co)).map((x) => [x.id, x.status])).toEqual([[j.id, 'paused']]);
    expect((await ledger(co, 'late-race'))!.reason).toContain('초안일 때만');
  });

  it('옛 판 검증을 기다리는 사이 새 판이 연결을 바꾸면 옛 여정을 켜지 않는다(켜지는 것은 새 판 여정 하나)', async () => {
    const { co } = await mkCompany();
    let swapped = false;
    const slow = Object.assign(async () => {
      slow.calls++;
      if (!swapped) {
        swapped = true;
        // 판 2 워커가 지나간다: 원장을 판 2 로 비우고 새 여정을 만들어 켠다
        expect(await runSetCompany(co, NOON, { defs: [D('swap', REV2)], spam: spamOf('pass') })).toBe('worked');
      }
      return verdictOf('pass');
    }, { calls: 0 });
    expect(await runSetCompany(co, NOON, { defs: [D('swap')], spam: slow })).toBe('worked'); // 판 1 워커(검증 통과 · 표식까지 찍는다)
    const js = await journeysOf(co);
    expect(js.map((x) => [x.name, x.status, x.marked])).toEqual([
      ['자동 점검 · 시험 swap', 'draft', true],                                              // 옛 여정: 검증은 통과했지만 켜지 않았다
      ['자동 점검 · 시험 swap (판 2)', 'active', true],
    ]);
    expect(await ledger(co, 'swap')).toMatchObject({ journeyId: js[1].id, rev: 2 });
  });

  it('켜는 동안 판 올림은 기다린다 — 켜기가 끝난 뒤에 풀리고 그때는 켜진 여정이라 0행(연결 그대로)', async () => {
    const { co } = await mkCompany();
    const def = D('lock');
    await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pending') });
    const [j] = await journeysOf(co);
    await makeDue(co, 'lock');

    let newer: Promise<string> | null = null;
    let waitedWhileLocked = false;
    let lockWaiters = 0;
    const newerSpam = spamOf('pass');
    vi.mocked(unresolvedOverlapPairs).mockImplementationOnce(async (...args) => {
      // 워커가 원장 행을 잠근 자리 — 판 2 워커의 판 올림은 여기서 끝나지 못한다
      newer = runSetCompany(co, NOON, { defs: [D('lock', REV2)], spam: newerSpam });
      waitedWhileLocked = (await Promise.race([newer!.then(() => 'done'), new Promise((r) => setTimeout(() => r('waiting'), 400))])) === 'waiting';
      // 기다리는 까닭 = 원장 행 잠금(이 DB 에서 그 표의 행 잠금 문장이 잠금을 기다리고 있다)
      lockWaiters = Number((await query(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM journey_selfcheck_set%FOR UPDATE%'`)).rows[0].n);
      return (await vi.importActual<typeof import('../journey-activation')>('../journey-activation')).unresolvedOverlapPairs(...args);
    });
    expect(await runSetCompany(co, NOON, { defs: [def], spam: spamOf('pass') })).toBe('worked');
    expect(waitedWhileLocked).toBe(true);
    expect(lockWaiters).toBe(1);
    expect(await newer!).toBe('idle');                                                       // 잠금이 풀린 뒤: 이어진 여정이 켜져 있다 = 판을 올리지 않는다
    expect((await journeysOf(co)).map((x) => [x.id, x.status])).toEqual([[j.id, 'active']]); // 새 판 여정이 생기지 않았다
    expect(await ledger(co, 'lock')).toMatchObject({ journeyId: j.id, rev: 1 });
    expect(newerSpam.calls).toBe(0);
    // 잠금 없이 판 올림 문장만 따로 내도(다른 주체) 켜진 여정이면 0행
    expect((await pool.query(RAISE_REV_SQL, [co, 'lock', 2])).rowCount).toBe(0);
  });
});

describe('9. 진짜 세트 11개 — 만들기 · 보낼 글 판정 · 켜기 관문을 전부 지난다', () => {
  it('데이터가 들어온 회사에서 tick 을 돌리면 11개가 차례로 켜진다(문자 칸 14 · 전부 알림 꺼짐 · 최대 인원 200)', async () => {
    await pool.query(ledgerBlockSql('C98-DDL-2'));   // 가입 근거 칸(customers.joined_at · 운영은 1103 실행 · 덤프는 그 전)
    const { co, customer } = await mkCompany();
    // 켜기 관문이 보는 회사 사실: 가입일 · 최근 구매일 · 포인트 · 생일(고객) · 매장 구매(상품 코드) · 몰 담기 · 조회 사건
    await query(`UPDATE customers SET joined_at = NOW() - INTERVAL '30 days', recent_purchase_date = CURRENT_DATE - 10, points = 5000, purchase_count = 1, total_purchase_amount = 24000 WHERE id = $1::uuid`, [customer]);
    await insertMinimalRow(pool, 'purchases', { id: randomUUID(), company_id: co, customer_id: customer, customer_phone: '01000019995', purchase_date: '2026-11-05',
      product_code: 'SK-101', product_name: '수분 진정 토너', quantity: 1, unit_price: 24000, total_amount: 24000, source_row_key: `t-c134s3-${co.slice(0, 8)}` });
    for (const ev of ['cart_add', 'product_view']) await insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: co, event_name: ev });

    const spam = spamOf('pass');
    let ticks = 0;
    while ((await runSetCompany(co, NOON, { spam })) === 'worked') { if (++ticks > 30) throw new Error('끝나지 않는다'); }
    const js = await journeysOf(co);
    const reasons = (await query(`SELECT set_key, last_reason FROM journey_selfcheck_set WHERE company_id = $1::uuid AND last_reason IS NOT NULL`, [co])).rows;
    expect(reasons).toEqual([]);
    expect(js.map((j) => [j.name, j.status, j.cap]).sort()).toEqual(SELFCHECK_SET.map((d) => [setJourneyName(d), 'active', 200]).sort());
    expect(ticks).toBe(11);                                                                 // 한 tick 에 행 하나
    expect(spam.calls).toBe(14);                                                            // 문자 칸 14 = 검사 14건
    const notify = await query(
      `SELECT s.notify_manager_on_pretest AS n FROM journey_steps s JOIN journeys j ON j.id = s.journey_id WHERE j.company_id = $1::uuid`, [co]);
    expect(notify.rows.map((r: any) => r.n)).toEqual(Array(14).fill(false));
    expect(await summarizeSet(co)).toMatchObject({ total: 11, active: 11, draft: 0, missing: 0, unlinkedDrafts: 0, reasons: [] });
  });
});
