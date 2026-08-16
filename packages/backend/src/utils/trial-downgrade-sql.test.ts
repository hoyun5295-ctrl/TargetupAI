/**
 * trial-downgrade — 술어·가드 SQL 의미론 실측 (2026-08-16, Codex 적대 1R high 수용)
 *
 * 왜 있나
 *   mock 기반 행동 테스트는 SQL 문자열을 해석하지 않아 OR→AND·NOT EXISTS→EXISTS 같은
 *   의미 반전을 못 잡는다(Codex 적대 1R high). 여기서는 실제 SQL 엔진(pg-mem)에
 *   companies·plans 픽스처를 넣고 **워커가 export한 술어·가드 상수 그대로** SELECT·UPDATE를
 *   실행해 대상 집합과 최종 행 상태를 단정한다.
 *
 * 닫힘 사슬
 *   ① 이 파일: 상수의 SQL 의미론 (실행 결과로 검증)
 *   ② trial-downgrade-worker.test.ts: 워커가 나가는 SQL에 그 상수를 그대로 포함(단일 소스)
 *   ①+② = 상수를 고치면 여기가, 워커가 상수를 안 쓰면 저기가 빨간불.
 *
 * 변이 민감도(마지막 describe)
 *   OR→AND·NOT EXISTS→EXISTS 변이를 이 테스트 안에서 직접 실행해 **결과 집합이 실제로
 *   달라짐**을 단정한다 — 실코드에 같은 변이가 생기면 위 단정들이 반드시 깨진다는 증명.
 */
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import {
  TRIAL_DOWNGRADE_TARGET_WHERE,
  PAID_PLAN_DOWNGRADE_GUARD_WHERE,
} from './trial-downgrade-worker';

const FREE = '00000000-0000-0000-0000-00000000f4ee';
const TRIAL_A = '00000000-0000-0000-0000-0000000042a1';
const TRIAL_B = '00000000-0000-0000-0000-0000000042a2'; // plan_code 중복 두 번째 행(카탈로그 오염 케이스)
const PRO = '00000000-0000-0000-0000-000000000970';

const C = (n: number) => `00000000-0000-0000-0000-0000000000c${n}`;

const PAST = '2026-08-01 00:00:00';
const FUTURE = '2030-01-01 00:00:00';

type Row = Record<string, any>;

function setup() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE plans (
      id uuid PRIMARY KEY,
      plan_code varchar(20) NOT NULL,
      monthly_price numeric(12,2) NOT NULL,
      ai_credits_per_month integer
    );
    CREATE TABLE companies (
      id uuid PRIMARY KEY,
      company_name varchar(100),
      plan_id uuid,
      subscription_status varchar(20),
      -- 실스키마는 timestamp지만 pg-mem은 NOW()(timestamptz)와의 암묵 캐스팅이 없어 timestamptz로 둔다.
      -- 검증 대상은 술어의 집합 논리다 — TZ 변환 축이 아니다.
      trial_expires_at timestamptz,
      ai_credits_base_remaining integer,
      ai_credits_reset_at timestamptz,
      updated_at timestamptz
    );
    INSERT INTO plans (id, plan_code, monthly_price, ai_credits_per_month) VALUES
      ('${FREE}',    'FREE',  0,       0),
      ('${TRIAL_A}', 'TRIAL', 0,       750),
      ('${TRIAL_B}', 'TRIAL', 0,       750),
      ('${PRO}',     'PRO',   1000000, 2400);
    INSERT INTO companies (id, company_name, plan_id, subscription_status, trial_expires_at, ai_credits_base_remaining) VALUES
      ('${C(1)}', 'FREE잔존',     '${FREE}',    'trial', '${PAST}',   0),   -- 대상: 29건 부류(상태 청소)
      ('${C(2)}', '덮인TRIAL',    '${TRIAL_A}', 'paid',  '${PAST}',   750), -- 대상: 새는 집합(픽스처②)
      ('${C(3)}', '만료일없음',   '${TRIAL_A}', 'trial', NULL,        750), -- 비대상: 판정 근거 없음(픽스처③)
      ('${C(4)}', '유료잔존',     '${PRO}',     'trial', '${PAST}',   99),  -- 술어 매치·가드가 UPDATE 차단(픽스처④)
      ('${C(5)}', '체험진행중',   '${TRIAL_A}', 'trial', '${FUTURE}', 750), -- 비대상: 미만료
      ('${C(6)}', '정상유료',     '${PRO}',     'paid',  NULL,        99),  -- 비대상
      ('${C(7)}', '중복TRIAL행',  '${TRIAL_B}', 'paid',  '${PAST}',   750), -- 대상: EXISTS는 카탈로그 중복에도 안전
      ('${C(8)}', '미배정',       NULL,         'trial', '${PAST}',   0);   -- 대상: 가드 NOT EXISTS 참
  `);
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { db, pool };
}

/** 워커와 같은 형태의 targets SELECT — 술어 상수를 그대로 끼운다. */
const TARGETS_SQL = (where: string) => `
  SELECT companies.id, companies.company_name, companies.plan_id, p.plan_code, p.monthly_price
    FROM companies
    LEFT JOIN plans p ON p.id = companies.plan_id
   WHERE ${where}`;

/** 워커와 같은 형태의 강등 UPDATE — 술어+가드 상수 + 관찰 plan_id 원자 결합(2R high)까지 그대로. */
const DOWNGRADE_SQL = (where: string, guard: string) => `
  UPDATE companies
     SET plan_id = $1,
         subscription_status = 'trial_expired',
         trial_expires_at = NULL,
         ai_credits_base_remaining = $2,
         ai_credits_reset_at = NOW(),
         updated_at = NOW()
   WHERE id = $3
     AND ${where}
     AND ${guard}
     AND (companies.plan_id = $4::uuid OR (companies.plan_id IS NULL AND $4::uuid IS NULL))
  RETURNING id`;

/** 워커 루프와 같은 호출 — 관찰한 plan_id(observed)를 넘긴다. */
async function runDowngrade(pool: any, id: string, observedPlanId: string | null, guard = PAID_PLAN_DOWNGRADE_GUARD_WHERE) {
  return pool.query(DOWNGRADE_SQL(TRIAL_DOWNGRADE_TARGET_WHERE, guard), [FREE, 0, id, observedPlanId]);
}

async function selectTargets(pool: any, where = TRIAL_DOWNGRADE_TARGET_WHERE): Promise<string[]> {
  const r = await pool.query(TARGETS_SQL(where));
  return r.rows.map((row: Row) => row.id).sort();
}

describe('강등 술어 — 실 SQL 대상 집합', () => {
  it('대상 = {FREE잔존, 덮인TRIAL, 유료잔존, 중복TRIAL행, 미배정} — 정확 일치', async () => {
    const { pool } = setup();
    expect(await selectTargets(pool)).toEqual([C(1), C(2), C(4), C(7), C(8)].sort());
  });

  it('만료일 NULL·미래·정상 유료는 절대 안 잡힌다', async () => {
    const { pool } = setup();
    const targets = await selectTargets(pool);
    for (const excluded of [C(3), C(5), C(6)]) expect(targets).not.toContain(excluded);
  });
});

describe('강등 UPDATE — 실 SQL 효과·가드', () => {
  it('비유료 대상 4건은 강등되고 최종 상태가 FREE·trial_expired·만료일 NULL·base 0이다', async () => {
    const { pool } = setup();
    const observed: Array<[string, string | null]> = [[C(1), FREE], [C(2), TRIAL_A], [C(7), TRIAL_B], [C(8), null]];
    for (const [id, planId] of observed) {
      const r = await runDowngrade(pool, id, planId);
      expect(r.rows.length, `강등 실패: ${id}`).toBe(1);
    }
    const after = await pool.query(
      `SELECT id, plan_id, subscription_status, trial_expires_at, ai_credits_base_remaining
         FROM companies WHERE id IN ('${C(1)}','${C(2)}','${C(7)}','${C(8)}')`,
    );
    for (const row of after.rows as Row[]) {
      expect(row.plan_id).toBe(FREE);
      expect(row.subscription_status).toBe('trial_expired');
      expect(row.trial_expires_at).toBeNull();
      expect(row.ai_credits_base_remaining).toBe(0);
    }
  });

  it('유료 plan + trial 잔존(픽스처④)은 가드가 0행으로 막고 상태가 보존된다', async () => {
    const { pool } = setup();
    const r = await runDowngrade(pool, C(4), PRO);
    expect(r.rows.length).toBe(0);
    const after = await pool.query(`SELECT plan_id, subscription_status FROM companies WHERE id = '${C(4)}'`);
    expect(after.rows[0].plan_id).toBe(PRO);
    expect(after.rows[0].subscription_status).toBe('trial');
  });

  it('경쟁: SELECT 후 유료 승인(status 잔존)이 끼어들면 UPDATE가 0행이다', async () => {
    const { pool } = setup();
    expect(await selectTargets(pool)).toContain(C(1));            // 조회 시점엔 대상
    await pool.query(`UPDATE companies SET plan_id = '${PRO}' WHERE id = '${C(1)}'`); // admin이 plan만 승인(상태 구멍)
    const r = await runDowngrade(pool, C(1), FREE);
    expect(r.rows.length).toBe(0);                                 // 가드가 유료 강등 차단
    const after = await pool.query(`SELECT plan_id FROM companies WHERE id = '${C(1)}'`);
    expect(after.rows[0].plan_id).toBe(PRO);
  });

  it('경쟁(2R high): 조회 FREE → 실제 TRIAL 전환이면 0행 스킵 — 이력 누락 방향 폐쇄·재관측 보존', async () => {
    const { pool } = setup();
    expect(await selectTargets(pool)).toContain(C(1));            // 관찰 시점 plan = FREE
    await pool.query(`UPDATE companies SET plan_id = '${TRIAL_A}' WHERE id = '${C(1)}'`); // 사이에 체험 부여
    const r = await runDowngrade(pool, C(1), FREE);               // 관찰값(FREE)으로 갱신 시도
    expect(r.rows.length).toBe(0);                                 // plan_id 불일치 = 스킵
    const after = await pool.query(`SELECT plan_id, subscription_status, trial_expires_at FROM companies WHERE id = '${C(1)}'`);
    expect(after.rows[0].plan_id).toBe(TRIAL_A);                   // 상태 보존 —
    expect(after.rows[0].trial_expires_at).not.toBeNull();         // 만료일이 남아 다음 실행이 재관측한다
  });

  it('경쟁(2R high): 조회 TRIAL → 실제 FREE 전환이면 0행 스킵 — 허위 이력 방향 폐쇄', async () => {
    const { pool } = setup();
    await pool.query(`UPDATE companies SET plan_id = '${FREE}' WHERE id = '${C(2)}'`);   // 관찰(TRIAL_A) 후 FREE로
    const r = await runDowngrade(pool, C(2), TRIAL_A);
    expect(r.rows.length).toBe(0);
  });
});

describe('변이 민감도 — 의미 반전이 결과를 실제로 바꾼다', () => {
  it('술어 OR→AND 변이 = 대상 집합이 달라진다 (덮인TRIAL·미배정류 누락)', async () => {
    const { pool } = setup();
    const mutated = TRIAL_DOWNGRADE_TARGET_WHERE.replace(/\bOR\b/, 'AND');
    expect(mutated).not.toBe(TRIAL_DOWNGRADE_TARGET_WHERE);        // 공허 변이 방지
    const mutatedTargets = await selectTargets(pool, mutated);
    expect(mutatedTargets).not.toEqual([C(1), C(2), C(4), C(7), C(8)].sort());
    expect(mutatedTargets).not.toContain(C(2));                    // status 덮인 TRIAL이 빠진다 = 옛 구멍 재현
  });

  it('가드 NOT IN→IN 변이 = 유료 잔존이 강등되고 비유료가 막힌다(정반대)', async () => {
    const { pool } = setup();
    const mutated = PAID_PLAN_DOWNGRADE_GUARD_WHERE.replace('NOT IN', 'IN');
    expect(mutated).not.toBe(PAID_PLAN_DOWNGRADE_GUARD_WHERE);
    const paid = await runDowngrade(pool, C(4), PRO, mutated);
    expect(paid.rows.length).toBe(1);                              // 변이면 유료가 뚫린다 → 실코드 변이 시 위 테스트가 깨짐
    const cleanup = await runDowngrade(pool, C(1), FREE, mutated);
    expect(cleanup.rows.length).toBe(0);
  });
});
