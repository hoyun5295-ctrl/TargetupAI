// replaces: none
/**
 * 세대(싱크 에이전트 1.7.6) 실 PG 시험 — 설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 · §6 G 시나리오.
 * 기대값 = 설계서 문장(거부 우선 · 낮추기 바로 · 올리기는 R* · 폐기 = 그 에이전트 빼고 재접기)을 손으로 따라간 값.
 * 번호 = 도달 불가 합성(0100007…).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  startConsentPass, stageConsentVotes, finishConsentStage, recordLoadEvidence, completeConsentPass, foldConsentRows,
  companyHasConsentPass, beginRetireAgentConsent, retireAgentConsentChunk, finishRetireAgent, retireSyncAgent, ConsentPassError,
} from '../same-phone-consent';

let seq = 0;
const phone = () => `0100007${String(1000 + seq++).padStart(4, '0')}`;
type Row = { phone: string; sms_opt_in?: string | boolean | null; sms_opt_in_unknown?: string };

async function company(agentCount: number) {
  const co = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: co, company_name: '세대 시험' });
  await insertMinimalRow(pool, 'users', { id: randomUUID(), company_id: co, user_type: 'admin', login_id: `gen-${co.slice(0, 8)}` });
  const agents: string[] = [];
  for (let i = 0; i < agentCount; i++) {
    const id = randomUUID();
    await insertMinimalRow(pool, 'sync_agents', { id, company_id: co });
    agents.push(id);
  }
  return { co, agents };
}
const customer = (co: string, p: string, v: boolean | null) =>
  pool.query(`INSERT INTO customers (id, company_id, phone, name, sms_opt_in, is_active, created_at, updated_at)
              VALUES (gen_random_uuid(), $1, $2, '세대', $3, true, NOW(), NOW())`, [co, p, v]);
const consentOf = async (co: string, p: string) =>
  (await pool.query(`SELECT sms_opt_in FROM customers WHERE company_id = $1 AND phone = $2`, [co, p])).rows[0]?.sms_opt_in;
const syncUnsubs = async (co: string, p: string) =>
  Number((await pool.query(`SELECT count(*) FROM unsubscribes WHERE company_id = $1 AND phone = $2 AND source = 'sync'`, [co, p])).rows[0].count);
const errCode = async (work: Promise<unknown>) => { try { await work; return 'OK'; } catch (e) { return e instanceof ConsentPassError ? e.code : String(e); } };

/** 에이전트 한 차례 = start → stage → stage-done → 적재 근거(묶음마다) → complete(done 까지) */
async function runPass(co: string, agent: string, ledger: Row[], loads: Row[][] = [ledger]) {
  const { passId } = await withTransaction((run) => startConsentPass(run, co, agent));
  await withTransaction((run) => stageConsentVotes(run, co, agent, passId, ledger));
  await withTransaction((run) => finishConsentStage(run, co, agent, passId));
  for (let i = 0; i < loads.length; i++) await withTransaction((run) => recordLoadEvidence(run, co, agent, passId, i, foldConsentRows(loads[i])));
  for (let n = 0; n < 20; n++) {
    const r = await withTransaction((run) => completeConsentPass(run, co, agent, passId, loads.length, null));
    if (r.state === 'done') return passId;
  }
  throw new Error('done 에 이르지 않음');
}

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C101-DDL-1'));
}, 120_000);

describe('에이전트 하나 · 한 차례(실 PG)', () => {
  it('같은 번호 동의 + 거부 = 거부 · 수신만 = 동의로 올림 + sync 수신거부 해제 · 대기 + 빈칸 = 기본 동의 · 원본에 없는 번호 = 그대로', async () => {
    const { co, agents: [a] } = await company(1);
    const [both, yesOnly, pending, absent] = [phone(), phone(), phone(), phone()];
    await customer(co, both, true); await customer(co, yesOnly, false); await customer(co, pending, null); await customer(co, absent, false);
    await pool.query(`INSERT INTO unsubscribes (company_id, user_id, phone, source)
                      SELECT $1, id, $2, 'sync' FROM users WHERE company_id = $1`, [co, yesOnly]);
    await runPass(co, a, [
      { phone: both, sms_opt_in: 'Y' }, { phone: both, sms_opt_in: 'N' },
      { phone: yesOnly, sms_opt_in: 'Y' }, { phone: pending, sms_opt_in: null },
    ]);
    expect(await consentOf(co, both)).toBe(false);
    expect(await syncUnsubs(co, both)).toBe(1);
    expect(await consentOf(co, yesOnly)).toBe(true);
    expect(await syncUnsubs(co, yesOnly)).toBe(0);
    expect(await consentOf(co, pending)).toBe(true);
    expect(await consentOf(co, absent)).toBe(false);
    expect(await withTransaction((run) => companyHasConsentPass(run, co))).toBe(true);
  });

  it('G12 원장 패스 뒤 원본이 거부로 바뀜 = 고객 적재 근거의 거부가 이긴다', async () => {
    const { co, agents: [a] } = await company(1);
    const p = phone();
    await customer(co, p, true);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'Y' }], [[{ phone: p, sms_opt_in: 'N' }]]);
    expect(await consentOf(co, p)).toBe(false);
  });

  it('보낸 묶음 수와 받은 근거 수가 다르면 그 패스 버림 · 고객 행 그대로 · 버린 패스 complete = 409', async () => {
    const { co, agents: [a] } = await company(1);
    const p = phone();
    await customer(co, p, false);
    const { passId } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, passId, [{ phone: p, sms_opt_in: 'Y' }]));
    await withTransaction((run) => finishConsentStage(run, co, a, passId));
    await withTransaction((run) => recordLoadEvidence(run, co, a, passId, 0, foldConsentRows([{ phone: p, sms_opt_in: 'Y' }])));
    await withTransaction((run) => recordLoadEvidence(run, co, a, passId, 0, foldConsentRows([{ phone: p, sms_opt_in: 'Y' }])));
    expect((await withTransaction((run) => completeConsentPass(run, co, a, passId, 2, null))).state).toBe('abandoned');
    expect(await errCode(withTransaction((run) => completeConsentPass(run, co, a, passId, 1, null)))).toBe('BAD_STATE');
    expect(await consentOf(co, p)).toBe(false);
  });

  it('새 start = 모으던 패스 버림(G2) · 버린 패스로 이어 보내면 409', async () => {
    const { co, agents: [a] } = await company(1);
    const { passId: p1 } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, p1, [{ phone: phone(), sms_opt_in: 'Y' }]));
    await withTransaction((run) => startConsentPass(run, co, a));
    expect(await errCode(withTransaction((run) => finishConsentStage(run, co, a, p1)))).toBe('BAD_STATE');
  });

  it('G23 공개 중 다음 차례가 확정되면 앞 차례 complete = SUPERSEDED · 새 차례가 끝낸다', async () => {
    const { co, agents: [a] } = await company(1);
    const p = phone();
    await customer(co, p, true);
    const { passId: p1 } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, p1, [{ phone: p, sms_opt_in: 'Y' }]));
    await withTransaction((run) => finishConsentStage(run, co, a, p1));
    expect((await withTransaction((run) => completeConsentPass(run, co, a, p1, 0, null))).state).toBe('applying');
    const { passId: p2 } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, p2, [{ phone: p, sms_opt_in: 'N' }]));
    await withTransaction((run) => finishConsentStage(run, co, a, p2));
    await withTransaction((run) => completeConsentPass(run, co, a, p2, 0, null));
    expect(await errCode(withTransaction((run) => completeConsentPass(run, co, a, p1, 0, null)))).toBe('SUPERSEDED');
    for (let n = 0; n < 5; n++) await withTransaction((run) => completeConsentPass(run, co, a, p2, 0, null));
    expect(await consentOf(co, p)).toBe(false);
  });
});

describe('에이전트 둘(실 PG)', () => {
  it('G24 거부를 낸 에이전트가 수신으로 바뀌어도 다른 에이전트 새 차례가 지나기 전엔 올리지 않는다', async () => {
    const { co, agents: [a, b] } = await company(2);
    const p = phone();
    await customer(co, p, true);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'N' }]);
    expect(await consentOf(co, p)).toBe(false);
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(true);
  });

  it('Codex 구현 1R #1 · 첫 패스를 확정 못 한 에이전트의 거부 = 다른 에이전트 공개가 올리지 못한다 · 그 에이전트가 수신으로 확정하면 올라감', async () => {
    const { co, agents: [a, b] } = await company(2);
    const p = phone();
    await customer(co, p, true);
    const { passId: a1 } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, a1, [{ phone: p, sms_opt_in: 'N' }]));
    await withTransaction((run) => finishConsentStage(run, co, a, a1));
    await withTransaction((run) => recordLoadEvidence(run, co, a, a1, 0, foldConsentRows([{ phone: p, sms_opt_in: 'N' }])));
    await pool.query(`UPDATE customers SET sms_opt_in = false WHERE company_id = $1 AND phone = $2`, [co, p]);   // 적재가 거부를 바로 썼다 · 그 뒤 A 는 공개 못 함
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(true);
  });

  it('Codex 구현 2R · 확정 못 한 에이전트를 폐기하면 그 에이전트가 막아 미룬 번호를 다시 판정 = 남은 에이전트 새 차례 없이 동의 · 수신거부 해제', async () => {
    const { co, agents: [a, b] } = await company(2);
    const p = phone();
    await customer(co, p, true);
    const { passId: a1 } = await withTransaction((run) => startConsentPass(run, co, a));
    await withTransaction((run) => stageConsentVotes(run, co, a, a1, [{ phone: p, sms_opt_in: 'N' }]));
    await withTransaction((run) => finishConsentStage(run, co, a, a1));
    await withTransaction((run) => recordLoadEvidence(run, co, a, a1, 0, foldConsentRows([{ phone: p, sms_opt_in: 'N' }])));
    await pool.query(`UPDATE customers SET sms_opt_in = false WHERE company_id = $1 AND phone = $2`, [co, p]);
    await pool.query(`INSERT INTO unsubscribes (company_id, user_id, phone, source) SELECT $1, id, $2, 'sync' FROM users WHERE company_id = $1`, [co, p]);
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    expect(await retireSyncAgent(co, a)).toMatchObject({ id: a });
    expect(await consentOf(co, p)).toBe(true);
    expect(await syncUnsubs(co, p)).toBe(0);
  });

  it('어긋남 대조 = 다른 문이 동의로 올린 번호를 다른 에이전트 차례가 회사 요약(거부)으로 되돌리고 sync 수신거부도 다시 건다', async () => {
    const { co, agents: [a, b] } = await company(2);
    const [p, q] = [phone(), phone()];
    await customer(co, p, true); await customer(co, q, true);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'N' }]);
    expect(await consentOf(co, p)).toBe(false);
    await pool.query(`UPDATE customers SET sms_opt_in = true WHERE company_id = $1 AND phone = $2`, [co, p]);
    await pool.query(`DELETE FROM unsubscribes WHERE company_id = $1 AND phone = $2`, [co, p]);
    await runPass(co, b, [{ phone: q, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    expect(await syncUnsubs(co, p)).toBe(1);
  });

  it('G15 거부를 낸 에이전트 폐기 = 그 에이전트 빼고 재접기 · 끝에 에이전트 행 삭제 · 폐기 중 start = 409', async () => {
    const { co, agents: [a, b] } = await company(2);
    const p = phone();
    await customer(co, p, true);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'N' }]);
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await consentOf(co, p)).toBe(false);
    await withTransaction((run) => beginRetireAgentConsent(run, co, a));
    expect(await errCode(withTransaction((run) => startConsentPass(run, co, a)))).toBe('RETIRING');
    expect(await errCode(withTransaction((run) => finishRetireAgent(run, co, a)))).toBe('BAD_STATE');
    for (let n = 0; n < 5; n++) {
      const r = await withTransaction((run) => retireAgentConsentChunk(run, co, a, null));
      if (r.done) break;
    }
    expect(await consentOf(co, p)).toBe(true);
    expect(await withTransaction((run) => finishRetireAgent(run, co, a))).not.toBeNull();
    expect((await pool.query(`SELECT count(*) FROM sync_agents WHERE id = $1`, [a])).rows[0].count).toBe('0');
  });

  it('슈퍼관리자 삭제 길(retireSyncAgent) 한 번 = 재접기 끝까지 + 행 삭제 · 차례가 없던 옛 에이전트도 지운다', async () => {
    const { co, agents: [a, b, old] } = await company(3);
    const p = phone();
    await customer(co, p, true);
    await runPass(co, a, [{ phone: p, sms_opt_in: 'N' }]);
    await runPass(co, b, [{ phone: p, sms_opt_in: 'Y' }]);
    expect(await retireSyncAgent(co, a)).toMatchObject({ id: a });
    expect(await consentOf(co, p)).toBe(true);
    expect(await retireSyncAgent(co, old)).toMatchObject({ id: old });
    expect((await pool.query(`SELECT count(*) FROM sync_agents WHERE company_id = $1`, [co])).rows[0].count).toBe('1');
  });
});
