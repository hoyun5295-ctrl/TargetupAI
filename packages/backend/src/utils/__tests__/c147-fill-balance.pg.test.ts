// replaces: none
/**
 * C147 충전 내역 반영 뒤 잔액 — 실 PostgreSQL(★ 2026-11-20 설계서 docs/2026-11-20-c147-agent-charge-balance-after-design.md §4 실 PG)
 *   표 = 원장 블록 C147-DDL-1 글자 그대로 · 62 읽기(pay-stats) = 모의 · 회차 = fillBalanceTick(시계 주입) 30초 간격
 *   DDL 전 = 조용히 건너뜀 · 조회 빈 Map / 연속 관측 30분 뒤 반영 → captured · 조회 Map / 조건부 쓰기(겹친 회차)가 앞 상태를 덮지 않음 /
 *   62 읽기 실패 뒤 = S 는 다음 커밋 시각 · 그 전 앞 잔액 = 빈 값(10R)
 *   발송ID = 시험용 형식값(C147P) · 실제 계정 아님.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';

const st = vi.hoisted(() => ({
  rows: [] as Array<{ seqNo: number; agentSendId: string; amount: number; applied: boolean }>,
  bal: {} as Record<string, number | null>,
  fail: false,
  killPg: false,
  opened: 0,
  destroyed: 0,
}));
vi.mock('../pay-stats', async () => {
  const { pool } = await import('../../config/database');
  return {
    isPayStatsConfigured: () => true,
    openPayStatsConnection: async () => {
      st.opened++;
      return { destroy: () => { st.destroyed++; }, on: () => undefined };
    },
    closePayStatsConnection: (c: any) => c.destroy(),
    readFillLedgerAll: async () => {
      if (st.fail) throw new Error('62 읽기 실패(모의)');
      if (st.killPg) {
        // 회차의 PG 연결(트랜잭션 안 · 대기)을 서버에서 끊는다 = 62 읽기 동안 PG 연결이 끊긴 꼴(구현 3R #1)
        st.killPg = false;
        await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND datname = current_database() AND state = 'idle in transaction'`);
        await new Promise((r) => setTimeout(r, 300));
      }
      return st.rows.map((r) => ({ ...r }));
    },
    queryLedgerBalancesByIds: async (ids: string[]) => ids.map((id) => ({ agent_send_id: id, rem_amt: st.bal[id] ?? null, unknown_reason: null })),
  };
});

import { fillBalanceTick, loadFillBalances, writeFillPlan, resetFillBalanceWorkerState, fillMarkKey, FILL_BALANCE_TICK_MS } from '../agent-fill-balance';

const ID = 'C147P';
const T0 = Date.UTC(2026, 10, 20, 1, 0, 0);
let clock = T0;
const now = () => clock;
/** n 회차를 30초 간격으로 돌린다 */
async function ticks(n: number) {
  for (let i = 0; i < n; i++) {
    clock += FILL_BALANCE_TICK_MS;
    await fillBalanceTick(now);
  }
}
async function mark(seq: number) {
  const r = await pool.query(`SELECT state, skip_reason, balance_before, balance_after, captured_at FROM agent_fill_balance_marks WHERE seq_no = $1 AND agent_send_id = $2`, [seq, ID]);
  return r.rows[0];
}

describe('DDL 전', () => {
  it('표 없음 = 회차가 조용히 끝남 · 조회 = 빈 Map', async () => {
    resetFillBalanceWorkerState();
    st.rows = [{ seqNo: 1, agentSendId: ID, amount: 10_000, applied: false }];
    await expect(fillBalanceTick(now)).resolves.toBeUndefined();
    expect((await loadFillBalances([{ seqNo: 1, agentSendId: ID }])).size).toBe(0);
  });
});

describe('DDL 뒤', () => {
  beforeAll(async () => {
    await pool.query(ledgerBlockSql('C147-DDL-1'));
    resetFillBalanceWorkerState();
    clock = T0;
  });

  it('연속 관측 30분 뒤 반영 = captured · 조회 Map(발송ID 앞뒤 공백 무관)', async () => {
    st.rows = [{ seqNo: 1, agentSendId: ID, amount: 5_000, applied: true }]; // 옛 줄 = 첫 회차 missed
    st.bal = { [ID]: 1_000 };
    await ticks(62);                                                          // 31분
    expect(await mark(1)).toMatchObject({ state: 'skipped', skip_reason: 'missed' });

    st.rows.push({ seqNo: 2, agentSendId: ID, amount: 10_000, applied: false });
    await ticks(1);
    expect(await mark(2)).toMatchObject({ state: 'pending', balance_before: '1000.000' });

    st.rows[1].applied = true;
    st.bal = { [ID]: 10_950 };
    await ticks(1);
    const m = await mark(2);
    expect(m).toMatchObject({ state: 'captured', balance_after: '10950.000' });
    expect(m.captured_at).not.toBeNull();

    const got = await loadFillBalances([{ seqNo: 2, agentSendId: `${ID} ` }, { seqNo: 1, agentSendId: ID }]);
    expect(got.get(fillMarkKey(2, ID))).toBe(10_950);
    expect(got.has(fillMarkKey(1, ID))).toBe(false); // missed = 빈 칸
  });

  it('겹친 회차의 조건부 쓰기 = 판정이 본 상태와 다르면 덮지 않음', async () => {
    await writeFillPlan((t, v) => pool.query(t, v), {
      inserts: [],
      updates: [{
        seqNo: 2, agentSendId: ID,
        expect: { state: 'pending', lastPendingAt: null, appliedSeenAt: null },
        next: { state: 'skipped', lastPendingAt: null, balanceBefore: null, appliedSeenAt: null, balanceAfter: null, skipReason: 'gap' },
      }],
    });
    expect(await mark(2)).toMatchObject({ state: 'captured', balance_after: '10950.000' });
  });

  it('다른 프로세스가 회차 잠금을 쥐고 있으면 = 읽기 · 쓰기 0 · S 비움 · 회차 뒤 잠금을 놓는다(구현 1R #2)', async () => {
    await ticks(62);                           // 2 의 반영 처음 본 시각에서 30분 넘김(이웃 ③ 끝 · 아래 판정을 S 하나로 가르게)
    const other = await pool.connect();
    try {
      expect((await other.query(`SELECT pg_try_advisory_lock(hashtext('agent-fill-balance')) AS ok`)).rows[0].ok).toBe(true);
      st.rows.push({ seqNo: 5, agentSendId: ID, amount: 1_000, applied: false });
      await ticks(1);
      expect(await mark(5)).toBeUndefined();   // 잠금 못 잡음 = 관측 쓰기 0
      expect((await other.query(`SELECT pg_advisory_unlock(hashtext('agent-fill-balance')) AS ok`)).rows[0].ok).toBe(true);
    } finally {
      other.release();
    }
    await ticks(1);
    expect(await mark(5)).toMatchObject({ state: 'pending' });
    // 회차가 끝나면 잠금이 풀려 있다
    const probe = await pool.connect();
    try {
      expect((await probe.query(`SELECT pg_try_advisory_lock(hashtext('agent-fill-balance')) AS ok`)).rows[0].ok).toBe(true);
      await probe.query(`SELECT pg_advisory_unlock(hashtext('agent-fill-balance'))`);
    } finally {
      probe.release();
    }
    // 잠금을 못 잡은 회차 = 끊김 → 바로 반영된 5 는 증거가 있어도 빈 값
    st.rows[st.rows.length - 1].applied = true;
    st.bal = { [ID]: 11_950 };
    await ticks(1);
    expect(await mark(5)).toMatchObject({ state: 'skipped', skip_reason: 'no_evidence' });
    st.rows.pop();
    st.bal = { [ID]: 10_950 };
  });

  it('62 읽기 실패 뒤 = 그 전 · 그 직후 앞 잔액은 빈 값(10R) · 30분 뒤 앞 잔액부터 captured', async () => {
    st.rows.push({ seqNo: 3, agentSendId: ID, amount: 3_000, applied: false });
    st.bal = { [ID]: 10_000 };
    await ticks(70);                     // 35분 · 2 의 반영 처음 본 시각에서 30분 넘김(이웃 ③ 끝)
    st.fail = true;
    await ticks(1);
    st.fail = false;
    await ticks(1);                      // 이 커밋이 새 S
    st.rows[2].applied = true;
    st.bal = { [ID]: 13_000 };
    await ticks(1);
    expect(await mark(3)).toMatchObject({ state: 'skipped', skip_reason: 'no_evidence' });

    st.rows.push({ seqNo: 4, agentSendId: ID, amount: 2_000, applied: false });
    await ticks(62);                     // 새 S + 31분 · 3 의 반영 처음 본 시각에서 30분 넘김
    st.rows[3].applied = true;
    st.bal = { [ID]: 15_000 };
    await ticks(1);
    expect(await mark(4)).toMatchObject({ state: 'captured', balance_after: '15000.000' });
  });
  it('PG 질의가 응답하지 않으면 = 시간 제한(10초) 뒤 회차가 끝나 연결을 버리고 · 다음 회차가 돈다(구현 2R)', async () => {
    const other = await pool.connect();
    let waited = 0;
    try {
      await other.query('BEGIN');
      await other.query('LOCK TABLE agent_fill_balance_marks IN ACCESS EXCLUSIVE MODE'); // 회차의 기록 읽기가 막힌다
      st.rows.push({ seqNo: 6, agentSendId: ID, amount: 1_000, applied: false });
      const t0 = Date.now();
      await ticks(1);
      waited = Date.now() - t0;
      await other.query('ROLLBACK');
    } finally {
      other.release();
    }
    expect(waited).toBeGreaterThanOrEqual(9_000);
    expect(waited).toBeLessThan(20_000);
    // 버린 연결의 서버 세션이 끝나 잠금이 풀리면 다음 회차가 기록한다(회차가 붙잡혀 있으면 영영 0)
    for (let i = 0; i < 30 && !(await mark(6)); i++) {
      await new Promise((r) => setTimeout(r, 100));
      await ticks(1);
    }
    expect(await mark(6)).toMatchObject({ state: 'pending' });
  }, 60_000);
  it('62 읽기 동안 PG 연결이 끊기면 = 프로세스는 살고 그 회차 쓰기 0 · 다음 회차가 돈다 · 62 연결은 회차마다 열고 늘 버린다(구현 3R)', async () => {
    st.rows.push({ seqNo: 7, agentSendId: ID, amount: 1_000, applied: false });
    st.killPg = true;
    await ticks(1);
    expect(await mark(7)).toBeUndefined();
    await ticks(1);
    expect(await mark(7)).toMatchObject({ state: 'pending' });
    expect(st.opened).toBeGreaterThan(0);
    expect(st.destroyed).toBe(st.opened);
  });
});
