// replaces: none
/**
 * C158 대행발송 — 사람이 다시 진행 · 문안을 고치면 검사 장애 셈 · 집기 대기를 새로 시작한다(실 PostgreSQL 판 · ★ 2026-11-22)
 *   운영 실측(1122): 세 번째 장애로 멈춘 뒤 11:29:56 다시 진행 → 직전 장애(11:29:10)의 15분 대기가 남아 11:49:10 에야 검사 ·
 *   셈도 남아(4 · 5 · 6번째) 장애 하나에 곧바로 다시 멈췄다. 안내 문자는 「다시 진행하시면 검사를 다시 시작합니다」였다.
 *   새 SQL = 회복 안 된 장애 조각(unrecoveredSpamErrorSql)에 붙은 「그 장애 뒤의 사람 사건」 조건 · 새 칸 · 새 표 0.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { spamErrorBackoffSql, countUnrecoveredSpamErrors, heldSpamBatch, SPAM_HOLD_EVENT } from '../agency-send-worker';
import { SPAM_CHECK_ERROR_BACKOFF_MINUTES } from '../agency-send-state';

const CO = randomUUID();
const OWNER = randomUUID();

const request = async () => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'agency_send_requests', { id, company_id: CO, current_content: '겨울 세일 안내', original_content: '겨울 세일 안내' });
  return id;
};
const event = async (requestId: string, kind: string, payload: Record<string, unknown> = {}) => {
  await pool.query(`INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, $2, $3::jsonb)`, [requestId, kind, JSON.stringify(payload)]);
};
const errorEvent = (requestId: string, version = 1) => event(requestId, 'spam_check_error', { phase: 'first', version, batchId: randomUUID() });
/** 워커의 집기 조건 가운데 「검사 장애 대기」 조각만 — 이 접수를 지금 집을 수 있는가 */
const pickable = async (requestId: string) => {
  const r = await pool.query(`SELECT 1 FROM agency_send_requests WHERE id = $2::uuid AND ${spamErrorBackoffSql(1)}`, [SPAM_CHECK_ERROR_BACKOFF_MINUTES, requestId]);
  return r.rows.length === 1;
};

const spamTest = async (results: Array<string | null>) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: CO, user_id: OWNER, callback_number: '0212345678', status: 'completed', source: 'auto_ai', batch_id: randomUUID() });
  for (const [i, r] of results.entries()) {
    await insertMinimalRow(pool, 'spam_filter_test_results', { test_id: id, carrier: ['SKT', 'LGU', 'KT'][i] ?? 'SKT', message_type: 'LMS', result: r });
  }
  return id;
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1111', login_id: `t-c158-${OWNER.slice(0, 8)}` });
});

describe('C158 보류로 남긴 검사가 실패로 굳은 뒤(실 PG)', () => {
  it('보류 판정 = 장애 + 그 판정이 읽은 검사 번호(접수 거절 사유를 그 검사에서 읽는다 · Codex 1R #1)', async () => {
    const req = await request();
    const test = await spamTest(['failed', 'failed', 'failed']);   // 줄 대기로 보류됐다가 세 통신사 행이 모두 발송 실패로 닫힌 검사
    await event(req, SPAM_HOLD_EVENT, { phase: 'first', verdict: 'pending', version: 1, batchId: null, held: false, testIds: [test] });
    const held = await heldSpamBatch(req, 1);
    expect(held?.verdict).toBe('error');
    expect(held?.testIds).toEqual([test]);
  });
});

describe('C158 다시 진행 뒤 셈 · 대기(실 PG)', () => {
  it('1122 운영 꼴 = 장애 셋으로 멈춘 접수를 사람이 다시 진행하면 셈 0 · 바로 집힌다 · 그 뒤 장애는 1부터 다시 센다', async () => {
    const req = await request();
    await errorEvent(req);
    await errorEvent(req);
    await errorEvent(req);
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(3);
    expect(await pickable(req)).toBe(false);   // 방금 장애 = 15분 대기 중

    await event(req, 'rescheduled', { status: 'received', via: 'screen' });
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(0);
    expect(await pickable(req)).toBe(true);    // 문자에 쓴 대로 바로 다시 검사

    await errorEvent(req);                      // 다시 진행 뒤의 새 장애
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(1);
    expect(await pickable(req)).toBe(false);
  });

  it('문안을 고친 것도 사람의 판단이다 = 앞 장애의 대기가 풀린다(셈은 원래 문안 판마다)', async () => {
    const req = await request();
    await errorEvent(req, 1);
    expect(await pickable(req)).toBe(false);
    await event(req, 'content_edited', { version: 2 });
    expect(await pickable(req)).toBe(true);
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(0);
  });

  it('사람 사건이 장애보다 앞이면 그대로 센다 · 다른 접수의 다시 진행은 영향 0 · 다른 종류 사건은 풀지 않는다', async () => {
    const req = await request();
    const other = await request();
    await event(req, 'rescheduled', { status: 'received', via: 'screen' });   // 장애보다 앞
    await errorEvent(req);
    await event(other, 'rescheduled', { status: 'received', via: 'screen' }); // 다른 접수
    await event(req, 'awaiting_approval', {});                                  // 사람 사건 아님
    expect(await countUnrecoveredSpamErrors(req, 1)).toBe(1);
    expect(await pickable(req)).toBe(false);
  });
});
