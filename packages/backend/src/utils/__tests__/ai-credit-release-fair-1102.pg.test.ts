// replaces: none
/**
 * 발송 크레딧 되돌림 후보 SQL — 실 PostgreSQL 판(★ 2026-11-02 Codex 구현 1R-1 · 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1 F5)
 *
 * 운영 문장(unsentReleaseCandidatesSql · unsentReleaseAgingSql)을 글자 그대로 돌린다. 기다리는 키($3)는 LIMIT 앞에서 빠지고,
 * 커서($4 · $5) 뒤부터 오래된 순으로 뽑아 한 바퀴 안에 전부 본다(3R) · 바퀴 상한($6 · 시작 때 DB NOW())까지만(4R). 기간 끝 = 6일보다 오래되고 기간 안인 줄의 회사별 수(LIMIT 없음).
 * 줄 시각 = DB NOW() 기준 상대값.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { unsentReleaseCandidatesSql, unsentReleaseAgingSql, type UnsentReleaseSpec } from '../ai-credit-release';

const SOURCE = `t-rel-${randomUUID().slice(0, 8)}`;
let CO = '';
const spec = (limit: number): UnsentReleaseSpec => ({ source: SOURCE, pass: 'pg', keyLike: `${SOURCE}:%`, minAgeMinutes: 30, lookbackDays: 7, notSentSql: 'TRUE', limit, reason: 'r' });

async function deduct(key: string, age: string): Promise<void> {
  await query(
    `INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, created_at)
     VALUES ($1::uuid, 'deduct', -5, 'base', $2, $3, 0, 0, NOW() - $4::interval)`,
    [CO, SOURCE, key, age],
  );
}
type Cur = { at: string; key: string; bound?: string } | null;
const page = async (limit: number, skip: string[], cur: Cur = null) =>
  (await query(unsentReleaseCandidatesSql(spec(limit)), [SOURCE, `${SOURCE}:%`, skip, cur?.at ?? null, cur?.key ?? null, cur?.bound ?? null])).rows as Array<{ idempotency_key: string; at_text: string; bound_text: string }>;
const keys = async (limit: number, skip: string[], cur: Cur = null) => (await page(limit, skip, cur)).map((r) => r.idempotency_key);

beforeAll(async () => {
  CO = randomUUID();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await deduct(`${SOURCE}:old`, '3 hours');
  await deduct(`${SOURCE}:mid`, '2 hours');
  await deduct(`${SOURCE}:new`, '1 hour');
  await deduct(`${SOURCE}:fresh`, '10 minutes');      // 30분 전 = 아직 후보 아님
  await deduct(`${SOURCE}:aging`, '6 days 12 hours');  // 기간(7일) 끝 하루 안
  await deduct(`${SOURCE}:gone`, '7 days 12 hours');   // 기간 밖
});

describe('되돌림 후보 SQL(실 PG)', () => {
  it('기다리는 키는 LIMIT 앞에서 빠진다 — 오래된 키가 기다리면 그 뒤 후보가 자리를 받는다', async () => {
    expect(await keys(2, [])).toEqual([`${SOURCE}:aging`, `${SOURCE}:old`]);
    expect(await keys(2, [`${SOURCE}:aging`, `${SOURCE}:old`])).toEqual([`${SOURCE}:mid`, `${SOURCE}:new`]);
  });

  it('이미 돌려준 키(release: 줄)는 후보가 아니다 · 30분 안 줄 · 기간 밖 줄도 아니다', async () => {
    await query(
      `INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after)
       VALUES ($1::uuid, 'refund', 5, 'base', $2, $3, 0, 0)`,
      [CO, SOURCE, `release:${SOURCE}:mid`],
    );
    expect(await keys(20, [])).toEqual([`${SOURCE}:aging`, `${SOURCE}:old`, `${SOURCE}:new`]);
  });

  it('커서 순환 — 한 회차 2건씩: 커서 뒤부터 · 끝까지 보면 처음부터 = 막힌 줄이 있어도 한 바퀴 안에 전부 본다(3R)', async () => {
    const p1 = await page(2, []);
    expect(p1.map((r) => r.idempotency_key)).toEqual([`${SOURCE}:aging`, `${SOURCE}:old`]);
    const last = p1[1];
    expect(await keys(2, [], { at: last.at_text, key: last.idempotency_key })).toEqual([`${SOURCE}:new`]);   // 덜 참 = 끝 → 다음은 처음부터
    expect(await keys(2, [], null)).toEqual([`${SOURCE}:aging`, `${SOURCE}:old`]);
  });

  it('Codex 4R 반례 — 바퀴 상한 뒤에 들어온 줄은 그 바퀴에 안 들어온다(새 유입이 계속돼도 바퀴는 상한에서 끝남)', async () => {
    const p1 = await page(1, []);
    expect(p1.map((r) => r.idempotency_key)).toEqual([`${SOURCE}:aging`]);
    const bound = p1[0].bound_text;   // 바퀴 시작 때 DB 시각
    // 바퀴 도중 새 후보가 들어온다(30분 전 줄 = 지금 후보 · 상한보다는 뒤 시각이 될 수 없으니 상한을 과거로 잡아 본다)
    const before = (await query(`SELECT (created_at + INTERVAL '1 microsecond')::text AS b FROM ai_credit_transactions WHERE idempotency_key = $1`, [`${SOURCE}:old`])).rows[0].b;
    expect(await keys(5, [], { at: p1[0].at_text, key: p1[0].idempotency_key, bound: before })).toEqual([`${SOURCE}:old`]);   // 상한 뒤(new) 빠짐
    expect(await keys(5, [], { at: p1[0].at_text, key: p1[0].idempotency_key, bound })).toEqual([`${SOURCE}:old`, `${SOURCE}:new`]);
  });

  it('기간 끝 = 6일보다 오래되고 기간(7일) 안인 줄의 회사별 수 · 끝난 일로 뺀 키는 세지 않는다', async () => {
    const aging = unsentReleaseAgingSql(spec(100));
    const rows = (await query(aging, [SOURCE, `${SOURCE}:%`, []])).rows;
    expect(rows).toEqual([{ company_id: CO, n: 1, credits: 5 }]);
    expect((await query(aging, [SOURCE, `${SOURCE}:%`, [`${SOURCE}:aging`]])).rows).toEqual([]);
  });

  it('Codex 3R 반례 — 같은 때 기간 끝에 든 미해결 601건 = 한 회차에 601건 전부 센다(뽑는 수 상한 없음)', async () => {
    const SRC = `${SOURCE}-601`;
    await query(
      `INSERT INTO ai_credit_transactions (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, created_at)
       SELECT $1::uuid, 'deduct', -5, 'base', $2::text, $2::text || ':' || g, 0, 0, NOW() - INTERVAL '6 days 6 hours'
         FROM generate_series(1, 601) g`,
      [CO, SRC],
    );
    const rows = (await query(unsentReleaseAgingSql({ ...spec(100), source: SRC, keyLike: `${SRC}:%` }), [SRC, `${SRC}:%`, []])).rows;
    expect(rows).toEqual([{ company_id: CO, n: 601, credits: 3005 }]);
  });
});
