// replaces: none
/**
 * C125 대행발송 스팸 검사 — 늦은 보고가 검사를 통과로 바꾸면 15분 대기 없이 이어 간다(실 PostgreSQL 판 · ★ 2026-11-11)
 *   운영 실측(1111): 09:51:41 KT 미수신으로 검사 장애 1/3 → 09:51:48 늦은 보고로 세 통신사 통과 → 10:09:38 에야 다시 집힘(17분 50초 헛대기).
 *   새 SQL = 회복 사건 넣기(recoverAgencySpamErrors) · 회복 안 된 장애만 보는 조각(unrecoveredSpamErrorSql) · 그 조각을 쓰는 집기 대기(spamErrorBackoffSql).
 *   새 칸 · 새 표 0(DDL 0 · agency_send_events.kind 에 CHECK 없음).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { recoverAgencySpamErrors, spamErrorBackoffSql, countUnrecoveredSpamErrors, spamErrorRecovered, recoveredSpamTestIdFor, SPAM_RECOVER_LOCK_NS } from '../agency-send-worker';
import { spamCheckFor } from '../spam-test-queue';
import { SPAM_CHECK_ERROR_BACKOFF_MINUTES } from '../agency-send-state';

const CO = randomUUID();
const OWNER = randomUUID();

const request = async () => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'agency_send_requests', { id, company_id: CO, current_content: '겨울 세일 안내', original_content: '겨울 세일 안내' });
  return id;
};
const spamTest = async (batchId: string | null, status: string, results: Array<string | null>, extra: Record<string, unknown> = {}) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: CO, user_id: OWNER, callback_number: '0212345678', status, source: 'auto_ai', batch_id: batchId, ...extra });
  for (const [i, r] of results.entries()) {
    await insertMinimalRow(pool, 'spam_filter_test_results', { test_id: id, carrier: ['SKT', 'LGU', 'KT'][i] ?? 'SKT', message_type: 'LMS', result: r });
  }
  return id;
};
const errorEvent = async (requestId: string, batchId: string | null, version = 1) => {
  await pool.query(
    `INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, 'spam_check_error', $2::jsonb)`,
    [requestId, JSON.stringify({ phase: 'first', version, batchId })],
  );
};
/** 워커의 집기 조건 가운데 「검사 장애 대기」 조각만 — 이 접수를 지금 집을 수 있는가 */
const pickable = async (requestId: string) => {
  const r = await pool.query(`SELECT 1 FROM agency_send_requests WHERE id = $2::uuid AND ${spamErrorBackoffSql(1)}`, [SPAM_CHECK_ERROR_BACKOFF_MINUTES, requestId]);
  return r.rows.length === 1;
};
const recoveredCount = async (requestId: string) =>
  Number((await pool.query(`SELECT COUNT(*)::int AS n FROM agency_send_events WHERE request_id = $1::uuid AND kind = 'spam_check_recovered'`, [requestId])).rows[0].n);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1111', login_id: `t-1111-late-${OWNER.slice(0, 8)}` });
});

describe('C125 늦은 보고 회복(실 PG)', () => {
  it('1111 운영 꼴 = KT 시간 초과로 장애 → 대기 중 · 늦은 보고로 전부 통과가 되면 회복 사건 1 · 바로 집힌다 · 검사 단계를 한 번 깨운다', async () => {
    const req = await request();
    const batch = randomUUID();
    const test = await spamTest(batch, 'completed', ['pass', 'pass', 'timeout']);
    await errorEvent(req, batch);
    expect(await pickable(req)).toBe(false); // 15분 대기 중

    // 아직 통과가 아니다(KT 시간 초과) → 회복 0 · 깨우지 않는다 · 대기 그대로
    let kicks = 0;
    expect(await recoverAgencySpamErrors(test, () => { kicks += 1; })).toEqual([]);
    expect(kicks).toBe(0);
    expect(await pickable(req)).toBe(false);

    // 늦은 보고가 KT 행을 통과로 고쳤다
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE test_id = $1::uuid AND carrier = 'KT'`, [test]);
    expect(await recoverAgencySpamErrors(test, () => { kicks += 1; })).toEqual([req]);
    expect(kicks).toBe(1);
    expect(await recoveredCount(req)).toBe(1);
    expect(await pickable(req)).toBe(true);
    // 회복 여부는 「있는가」로 읽는다(누가 넣었는지 무관) · 다른 묶음 · 다른 접수는 거짓
    expect(await spamErrorRecovered(req, batch)).toBe(true);
    expect(await spamErrorRecovered(req, randomUUID())).toBe(false);
    expect(await spamErrorRecovered(randomUUID(), batch)).toBe(false);
    // 다시 집힌 접수가 이어 볼 검사 = 회복한 그 검사(같은 문안 버전) · 문안 버전이 다르면 없다
    expect(await recoveredSpamTestIdFor(req, 1)).toBe(test);
    expect(await recoveredSpamTestIdFor(req, 2)).toBeNull();

    // 같은 보고가 다시 와도(앱 재전송) 회복 사건은 하나 · 다시 깨우지 않는다
    expect(await recoverAgencySpamErrors(test, () => { kicks += 1; })).toEqual([]);
    expect(kicks).toBe(1);
    expect(await recoveredCount(req)).toBe(1);
  });

  it('회복된 장애는 「같은 문안 3번째 = 사람 판단」 셈에서 빠진다 · 회복 안 된 장애는 그대로 센다 · 다시 대기에 걸린다', async () => {
    const req = await request();
    const b1 = randomUUID();
    const t1 = await spamTest(b1, 'completed', ['pass', 'pass', 'pass']);
    await errorEvent(req, b1);
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(1);
    await recoverAgencySpamErrors(t1, () => undefined);
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(0);
    expect(await pickable(req)).toBe(true);

    // 다음 검사가 진짜 장애(보고가 끝내 안 옴) → 1번으로 센다 · 대기
    const b2 = randomUUID();
    await spamTest(b2, 'completed', ['pass', 'timeout', 'pass']);
    await errorEvent(req, b2);
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(1);
    expect(await pickable(req)).toBe(false);
    // 문안 버전이 다르면 따로 센다(옛 동작 그대로)
    expect(await countUnrecoveredSpamErrors(req, 2)).toBe(0);
  });

  it('통과가 아니면 회복하지 않는다 — 차단 · 진행 중 · 결과 없음 · 발송 실패', async () => {
    for (const [status, results] of [
      ['completed', ['pass', 'blocked', 'pass']],
      ['active', ['pass', 'pass', null]],
      ['completed', []],
      ['completed', ['pass', 'failed', 'pass']],
    ] as Array<[string, Array<string | null>]>) {
      const req = await request();
      const batch = randomUUID();
      const test = await spamTest(batch, status, results);
      await errorEvent(req, batch);
      expect(await recoverAgencySpamErrors(test, () => { throw new Error('깨우면 안 된다'); }), `${status} ${JSON.stringify(results)}`).toEqual([]);
      expect(await pickable(req)).toBe(false);
    }
  });

  it('같은 묶음에 통과 아닌 검사가 하나라도 있으면 회복하지 않는다 · 묶음 없는 검사 · 없는 검사 id 는 아무 일도 없다', async () => {
    const req = await request();
    const batch = randomUUID();
    const a = await spamTest(batch, 'completed', ['pass', 'pass', 'pass']);
    await spamTest(batch, 'completed', ['pass', 'timeout', 'pass']);
    await errorEvent(req, batch);
    expect(await recoverAgencySpamErrors(a, () => undefined)).toEqual([]);

    const lone = await spamTest(null, 'completed', ['pass', 'pass', 'pass']);
    expect(await recoverAgencySpamErrors(lone, () => undefined)).toEqual([]);
    expect(await recoverAgencySpamErrors(randomUUID(), () => undefined)).toEqual([]);
  });

  it('다른 접수 · 다른 묶음의 장애는 건드리지 않는다 · 묶음 없는 장애(큐 등록 실패)는 회복 대상이 아니다', async () => {
    const mine = await request();
    const other = await request();
    const noBatch = await request();
    const b = randomUUID();
    const t = await spamTest(b, 'completed', ['pass', 'pass', 'pass']);
    await errorEvent(mine, b);
    await errorEvent(other, randomUUID());
    await errorEvent(noBatch, null);
    expect(await recoverAgencySpamErrors(t, () => undefined)).toEqual([mine]);
    expect(await pickable(mine)).toBe(true);
    expect(await pickable(other)).toBe(false);
    expect(await pickable(noBatch)).toBe(false);
    expect(await recoveredCount(other)).toBe(0);
    expect(await recoveredCount(noBatch)).toBe(0);
  });

  it('Codex 1R 순서 = 같은 키의 더 최신 검사가 장애여도, 회복한 그 검사를 지정하면 그것을 이어 본다 · 키가 다른 검사는 지정해도 안 쓴다', async () => {
    const key = { companyId: CO, callback: '0212345678', hash: randomUUID().replace(/-/g, ''), msgType: 'LMS' as const, subject: null as any };
    const older = await spamTest(randomUUID(), 'completed', ['pass', 'pass', 'pass'], { message_hash: key.hash });
    await pool.query(`UPDATE spam_filter_tests SET created_at = NOW() - INTERVAL '2 minutes' WHERE id = $1::uuid`, [older]);
    const newer = await spamTest(randomUUID(), 'completed', ['pass', 'timeout', 'pass'], { message_hash: key.hash });
    // 옛 규칙 = 가장 최근 검사(장애) → 등록 함수는 이것을 버리고 새 검사를 건다
    const latest = await spamCheckFor(key);
    expect(latest?.testId).toBe(newer);
    expect(latest?.outcome).toBe('error');
    // 지정 = 회복한 검사(통과)
    const preferred = await spamCheckFor(key, undefined, undefined, older);
    expect(preferred?.testId).toBe(older);
    expect(preferred?.outcome).toBe('pass');
    // 키가 다른 검사(문안이 달라졌다)는 지정해도 돌려주지 않는다
    const otherKey = await spamTest(randomUUID(), 'completed', ['pass', 'pass', 'pass'], { message_hash: randomUUID().replace(/-/g, '') });
    expect(await spamCheckFor(key, undefined, undefined, otherKey)).toBeNull();
  });

  it('Codex 2R 순서 = 장애 마감이 묶음 잠금을 쥔 동안(셈 → 상태 전환 사이) 늦은 보고 쪽 회복은 끼어들지 못하고, 풀린 뒤에야 들어간다', async () => {
    const req = await request();
    const batch = randomUUID();
    const test = await spamTest(batch, 'completed', ['pass', 'pass', 'pass']);
    await errorEvent(req, batch);
    const c = await pool.connect();
    const run = (text: string, params?: any[]) => c.query(text, params);
    let doneAt = 0;
    try {
      await c.query('BEGIN');
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2::text))`, [SPAM_RECOVER_LOCK_NS, batch]); // = 장애 마감이 쥐는 것과 같은 잠금
      const late = recoverAgencySpamErrors(test, () => undefined).then((r) => { doneAt = Date.now(); return r; });
      await new Promise((ok) => setTimeout(ok, 500));
      expect(doneAt).toBe(0); // 늦은 보고 쪽은 아직 기다린다
      // 잠금 구역이 읽는 값 = 회복 전 그대로(이 값으로 셈 · 상태 전환을 정한다)
      expect(await countUnrecoveredSpamErrors(req, 1, run)).toBe(1);
      expect(await spamErrorRecovered(req, batch, run)).toBe(false);
      await c.query('COMMIT');
      expect(await late).toEqual([req]); // 잠금이 풀린 뒤에 회복
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
    expect(await spamErrorRecovered(req, batch)).toBe(true);
    expect(await pickable(req)).toBe(true);
  });

  it('대기 시간이 지난 옛 장애는 회복 여부와 무관하게 집힌다(옛 동작 그대로)', async () => {
    const req = await request();
    await errorEvent(req, randomUUID());
    await pool.query(`UPDATE agency_send_events SET created_at = NOW() - ($2::int * INTERVAL '1 minute') - INTERVAL '5 seconds' WHERE request_id = $1::uuid`, [req, SPAM_CHECK_ERROR_BACKOFF_MINUTES]);
    expect(await pickable(req)).toBe(true);
  });
});
