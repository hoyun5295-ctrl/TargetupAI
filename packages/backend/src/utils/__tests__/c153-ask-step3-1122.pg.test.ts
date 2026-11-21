// replaces: none
/**
 * C153 한 줄로 묻기 3단계 재작성 — 실 PostgreSQL 판(★ 2026-11-22 · 설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md §5)
 *   운영 문장을 글자 그대로 돌린다(새 칸 · 새 표 0).
 *   PG1 검사 한 건 보기의 lateOpen(결과 없음일 때만 · DB 시계) · 같은 글 이어 보기(reusableLineSpamTest · 오늘 · 어제)
 *   PG2 그 준비분의 접수 상태(askStagingState · 적재 행이 없어도 · 회사 범위 · 접수됨 = queued · processing · sent · 처리 중 = preparing · 없음 = failed 뿐 · 없음)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { resetSpamStampCache } from '../spam-test-queue';
import { spamCheckView } from '../spam-test-view';
import { reusableLineSpamTest } from '../../services/ai-line-spam';
import { askStagingState } from '../ask-segments';

const CO = randomUUID();
const OTHER = randomUUID();
const US = randomUUID();
const CB = '0215440153';
const SUBJECT = '(광고) 겨울 소식';

/** 장문 검사 하나 — 만든 때 · 닫힌 때(분 전) · 줄마다 결과. dayAgo = 만든 날을 며칠 앞으로(같은 글 찾기의 날짜 창) */
async function lmsTest(o: {
  hash: string; source?: string; status?: string; closedMinutesAgo?: number; dayAgo?: number;
  rows: Array<{ carrier: string; phone: string; result: string | null; received?: boolean }>;
}): Promise<string> {
  const id = randomUUID();
  const status = o.status ?? 'completed';
  await pool.query(
    `INSERT INTO spam_filter_tests (id, company_id, user_id, callback_number, message_content_lms, message_hash, subject, status, source, created_at, completed_at)
     VALUES ($1, $2, $3, $4, '본문', $5, $6, $7::varchar, $8, NOW() - ($9::int * INTERVAL '1 day') - INTERVAL '2 minutes',
             CASE WHEN $7::varchar = 'completed' THEN NOW() - ($10::int * INTERVAL '1 minute') END)`,
    [id, CO, US, CB, o.hash, SUBJECT, status, o.source ?? 'auto_ai', o.dayAgo ?? 0, o.closedMinutesAgo ?? 1],
  );
  for (const r of o.rows) {
    await pool.query(
      `INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'LMS', $3, $4, $5)`,
      [id, r.carrier, r.phone, r.received === true, r.result],
    );
  }
  return id;
}
const key = (hash: string) => ({ companyId: CO, callback: CB, hash, msgType: 'LMS' as const, subject: SUBJECT });
const LATE_ROWS = [
  { carrier: 'SKT', phone: '01000001531', result: 'pass', received: true },
  { carrier: 'KT', phone: '01000001532', result: 'pass', received: true },
  { carrier: 'LGU', phone: '01000001533', result: 'timeout' },
];

beforeAll(async () => {
  for (const id of ['C89-DDL-1', 'C89-DDL-2', 'C89-DDL-3', 'C89-DDL-4', 'C89-DDL-5']) await pool.query(ledgerBlockSql(id));
  resetSpamStampCache();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'companies', { id: OTHER });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: `t-1122-c153-${US.slice(0, 8)}` });
  // 기대 단말(보기는 지금 쓰는 단말을 채워 판정한다) — 이 시험의 세 통신사 단말
  for (const [dev, carrier, phone] of [['dev-c153-sk', 'SKT', '01000001531'], ['dev-c153-kt', 'KT', '01000001532'], ['dev-c153-lg', 'LGU', '01000001533']]) {
    await pool.query(`INSERT INTO spam_filter_devices (device_id, carrier, phone, is_active) VALUES ($1, $2, $3, true)`, [dev, carrier, phone]);
  }
});

describe('PG1 늦은 보고를 받는 동안 — 보기의 lateOpen · 같은 글 이어 보기', () => {
  it('결과 없음으로 닫힌 지 1분(자동 · 시간 초과 줄) = 보기 warn + lateOpen · 같은 글 다시 걸기 = 그 검사 번호 그대로', async () => {
    const hash = `h-${randomUUID().slice(0, 12)}`;
    const id = await lmsTest({ hash, closedMinutesAgo: 1, rows: LATE_ROWS });
    const v = await spamCheckView(id, 'completed', new Date(), 'LMS');
    expect([v.state, v.lateOpen]).toEqual(['warn', true]);
    expect(v.carriers.find((c) => c.carrier === 'LGU')?.result).toBe('none');
    expect(await reusableLineSpamTest(key(hash))).toEqual({ state: 'warn', testId: id, reused: true, lateOpen: true });
  });

  it('닫힌 지 31분(늦은 보고를 받는 때가 지남) = lateOpen 거짓 · 이어 볼 것 없음(새로 건다)', async () => {
    const hash = `h-${randomUUID().slice(0, 12)}`;
    const id = await lmsTest({ hash, closedMinutesAgo: 31, rows: LATE_ROWS });
    const v = await spamCheckView(id, 'completed', new Date(), 'LMS');
    expect([v.state, v.lateOpen]).toEqual(['warn', false]);
    expect(await reusableLineSpamTest(key(hash))).toBeNull();
  });

  it('통과 · 막힘 = lateOpen 을 묻지 않는다(false) · 오늘 통과 검사는 이어 본다', async () => {
    const hash = `h-${randomUUID().slice(0, 12)}`;
    const pass = await lmsTest({ hash, closedMinutesAgo: 1, rows: LATE_ROWS.map((r) => ({ ...r, result: 'pass', received: true })) });
    const v = await spamCheckView(pass, 'completed', new Date(), 'LMS');
    expect([v.state, v.lateOpen]).toEqual(['pass', false]);
    expect(await reusableLineSpamTest(key(hash))).toEqual({ state: 'pass', testId: pass, reused: true });
  });

  it('자정을 넘김 — 어제 만든 결과 없음 검사가 아직 늦은 보고를 받으면 그 검사를 이어 본다 · 어제의 통과 검사 · 다 닫힌 결과 없음은 새로 건다', async () => {
    const late = `h-${randomUUID().slice(0, 12)}`;
    const id = await lmsTest({ hash: late, dayAgo: 1, closedMinutesAgo: 1, rows: LATE_ROWS });
    expect(await reusableLineSpamTest(key(late))).toEqual({ state: 'warn', testId: id, reused: true, lateOpen: true });
    const passed = `h-${randomUUID().slice(0, 12)}`;
    await lmsTest({ hash: passed, dayAgo: 1, closedMinutesAgo: 1, rows: LATE_ROWS.map((r) => ({ ...r, result: 'pass', received: true })) });
    expect(await reusableLineSpamTest(key(passed))).toBeNull();
    const closed = `h-${randomUUID().slice(0, 12)}`;
    await lmsTest({ hash: closed, dayAgo: 1, closedMinutesAgo: 40, rows: LATE_ROWS });
    expect(await reusableLineSpamTest(key(closed))).toBeNull();
  });

  it('다른 글 · 다른 제목 = 이어 보지 않는다', async () => {
    const hash = `h-${randomUUID().slice(0, 12)}`;
    await lmsTest({ hash, closedMinutesAgo: 1, rows: LATE_ROWS });
    expect(await reusableLineSpamTest(key(`${hash}-x`))).toBeNull();
    expect(await reusableLineSpamTest({ ...key(hash), subject: '(광고) 다른 제목' })).toBeNull();
  });
});

describe('PG2 그 준비분의 접수 상태', () => {
  it('발송 가능 상태로 넘어간 캠페인 = accepted(적재 행이 없어도 · 단계 셋 모두) · 차감 전(preparing) = pending · failed 뿐 · 없음 = none · 다른 회사 = none · 꼴이 틀리면 null', async () => {
    for (const phase of ['queued', 'processing', 'sent']) {
      const stg = randomUUID();
      await insertMinimalRow(pool, 'campaigns', { company_id: CO, staging_id: stg, send_phase: phase });
      const n = await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_send_staging WHERE staging_id = $1::uuid`, [stg]);
      expect(n.rows[0].n).toBe(0);
      expect([phase, await askStagingState(CO, stg)]).toEqual([phase, { state: 'accepted', stuck: false }]);
      expect([phase, await askStagingState(OTHER, stg)]).toEqual([phase, { state: 'none', stuck: false }]);
    }
    const preparing = randomUUID();
    await insertMinimalRow(pool, 'campaigns', { company_id: CO, staging_id: preparing, send_phase: 'preparing' });
    expect(await askStagingState(CO, preparing)).toEqual({ state: 'pending', stuck: false });
    // 5분 넘게 preparing 으로 남음(차감 뒤 전환 · 되돌리기가 모두 실패) = 처리 중 그대로 + stuck(없음으로 바꾸지 않는다)
    await pool.query(`UPDATE campaigns SET created_at = NOW() - INTERVAL '6 minutes' WHERE staging_id = $1::uuid`, [preparing]);
    expect(await askStagingState(CO, preparing)).toEqual({ state: 'pending', stuck: true });
    // 차감 실패로 그 행이 failed 가 되면(또는 지워지면) = 없음(같은 본문으로 다시 확정할 수 있다)
    await pool.query(`UPDATE campaigns SET send_phase = 'failed' WHERE staging_id = $1::uuid`, [preparing]);
    expect(await askStagingState(CO, preparing)).toEqual({ state: 'none', stuck: false });
    await pool.query(`DELETE FROM campaigns WHERE staging_id = $1::uuid`, [preparing]);
    expect(await askStagingState(CO, preparing)).toEqual({ state: 'none', stuck: false });
    expect(await askStagingState(CO, randomUUID())).toEqual({ state: 'none', stuck: false });
    expect(await askStagingState(CO, 'not-a-uuid')).toBeNull();
    expect(await askStagingState(CO, undefined)).toBeNull();
  });
});
