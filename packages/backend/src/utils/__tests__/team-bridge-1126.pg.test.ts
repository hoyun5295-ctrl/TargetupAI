// replaces: none
/**
 * Team 한줄로 다리(한줄로AI 쪽) — 실 PostgreSQL 판(★ 2026-11-26)
 * 표 = 운영 schema-only 덤프 사본 · 대기 DDL = 원장 블록 C166-DDL-1 을 글자 그대로 얹는다(배포 때 Harold 님이 실행하는 문장).
 *   1. 표가 없으면 42P01(라우트가 503 DB_MIGRATION_PENDING 으로 바꾼다)
 *   2. 켜기 → 목록에 이름 · 사용구분 · 상태 · 끄기 → 빠짐 · 없는 회사 = null · 다시 켜기 = 같은 행(ON CONFLICT) · 돌려준 값 = 저장된 결과
 *   3. 해지 회사 = 켜져 있어도 다리 목록 · 표에서 빠짐 · 새로 켜기 = null · 끄기는 받음(Codex C166 1R #1)
 *   4. 해지(커밋 전)와 켜기가 겹치면 켜기가 해지 커밋을 기다렸다가 null · 스위치 값은 그대로(두 연결 · Codex C166 2R #1)
 */
import { describe, it, expect } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { listTeamEnabledCompanies, listTeamEnabledIds, setTeamBridge } from '../team-bridge';

const A = 'b1000000-0000-4000-8000-000000000001';
const B = 'b1000000-0000-4000-8000-000000000002';
const NONE = 'b1000000-0000-4000-8000-0000000000ff';
const T = 'b1000000-0000-4000-8000-000000000003';

/** 해지(커밋 전)를 걸어 둔 채 켜기를 부르고, 켜기 세션이 그 잠금을 실제로 기다리는지 본 뒤 해지를 커밋한다 → 켜기 = null */
async function racingTerminate(R: string): Promise<void> {
  const c1 = await pool.connect();
  let committed = false;
  let broken: Error | undefined;
  let racing: Promise<boolean | null> | null = null;
  try {
    await c1.query('BEGIN');
    const blocker = (await c1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await c1.query(`UPDATE companies SET status = 'terminated' WHERE id = $1`, [R]);
    racing = setTeamBridge(R, true, null);
    let settled = false;
    racing.then(() => { settled = true; }, () => { settled = true; });
    // 켜기 세션이 해지 세션의 잠금을 실제로 기다리는가(pg_blocking_pids) — 늦게 시작한 탓에 통과하는 일을 막는다(Codex C166 3R)
    let waiting = 0;
    for (let i = 0; i < 50 && waiting === 0 && !settled; i++) {
      waiting = (await query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [blocker])).rows[0].n;
      if (waiting === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(settled).toBe(false);
    expect(waiting).toBeGreaterThan(0);
    await c1.query('COMMIT');
    committed = true;
    expect(await racing).toBeNull();
  } finally {
    // 커밋하지 못한 모든 길(단언 실패 · 관측 쿼리 오류) = ROLLBACK 뒤 반환 · ROLLBACK 도 실패하면 연결을 버린다(Codex C166 4R)
    if (!committed) await c1.query('ROLLBACK').catch((e: Error) => { broken = e; });
    c1.release(broken);
    // 이미 시작한 켜기는 끝까지 기다린다(시험 밖으로 새지 않게 · 그 오류가 원래 실패를 덮지 않게 · Codex C166 5R)
    if (racing) await racing.catch(() => null);
  }
}

describe('Team 다리 — 실 PG', () => {
  it('표가 없으면 42P01 → DDL 뒤 켜기 · 끄기 · 다시 켜기', async () => {
    await expect(listTeamEnabledIds()).rejects.toMatchObject({ code: '42P01' });
    await query(ledgerBlockSql('C166-DDL-1'));
    await insertMinimalRow(pool, 'companies', { id: A, company_name: '가나 상사', usage_type: 'both', status: 'active' });
    await insertMinimalRow(pool, 'companies', { id: B, company_name: '다라 상사', usage_type: 'web', status: 'active' });

    expect(await listTeamEnabledCompanies()).toEqual([]);
    expect(await setTeamBridge(A, true, null)).toBe(true);
    expect(await setTeamBridge(NONE, true, null)).toBeNull();
    expect(await listTeamEnabledCompanies()).toEqual([{ id: A, name: '가나 상사', usageType: 'both', status: 'active' }]);

    expect(await setTeamBridge(B, true, null)).toBe(true);
    expect((await listTeamEnabledIds()).sort()).toEqual([A, B]);
    expect(await setTeamBridge(A, false, null)).toBe(false);
    expect(await listTeamEnabledIds()).toEqual([B]);
    expect(await setTeamBridge(A, true, null)).toBe(true);
    const rows = (await query(`SELECT count(*)::int AS n FROM team_bridge_companies WHERE company_id IN ($1, $2)`, [A, B])).rows;
    expect(rows[0].n).toBe(2);
    // 해지 회사 — 켜 둔 뒤 해지되면 다리 목록 · 표에서 빠지고, 해지된 뒤 새로 켜기는 막히고, 끄기는 받는다
    await insertMinimalRow(pool, 'companies', { id: T, company_name: '마바 상사', usage_type: 'web', status: 'active' });
    expect(await setTeamBridge(T, true, null)).toBe(true);
    expect((await listTeamEnabledIds()).sort()).toEqual([A, B, T].sort());
    await query(`UPDATE companies SET status = 'terminated' WHERE id = $1`, [T]);
    expect((await listTeamEnabledCompanies()).map((c) => c.id)).not.toContain(T);
    expect(await listTeamEnabledIds()).not.toContain(T);
    expect(await setTeamBridge(T, false, null)).toBe(false);
    expect(await setTeamBridge(T, true, null)).toBeNull();
    // 해지와 겹친 켜기 — 연결 1 이 해지를 걸어 둔 채(커밋 전) 연결 2 의 켜기가 기다리고, 해지 커밋 뒤 null
    const R = 'b1000000-0000-4000-8000-000000000004';
    await insertMinimalRow(pool, 'companies', { id: R, company_name: '사아 상사', usage_type: 'web', status: 'active' });
    expect(await setTeamBridge(R, false, null)).toBe(false);
    await racingTerminate(R);
    expect((await query(`SELECT enabled FROM team_bridge_companies WHERE company_id = $1`, [R])).rows[0].enabled).toBe(false);
    // 사용구분 칸은 그대로(다리는 읽기만)
    const usage = (await query(`SELECT usage_type FROM companies WHERE id = $1`, [A])).rows[0].usage_type;
    expect(usage).toBe('both');
  });
});
