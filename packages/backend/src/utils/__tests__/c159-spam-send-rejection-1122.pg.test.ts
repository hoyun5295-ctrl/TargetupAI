// replaces: none
/**
 * C159 접수 거절 사유 — 칩 보기 · 판정 함수가 큐 행을 못 읽는 환경에서 종전 값 그대로인지(실 PostgreSQL 판 · ★ 2026-11-22)
 *   판정(spamGatewayRejectionOf)은 검사 문자의 큐 행(MySQL)에서 결과 코드를 읽는다. 이 시험 환경에는 그 행이 없다 =
 *   「큐 행을 못 읽으면 null = 종전 판정」 갈래를 실제 문장으로 잰다(새 SQL = 결과 행 전부를 읽는 한 문장 · 새 칸 0).
 *   사유가 실리는 쪽(행 전부 접수 거절)은 단위 시험(순수 판정 · 고리 · 문장)이 잰다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { spamGatewayRejectionOf, readSpamTestOutcome } from '../spam-test-queue';
import { spamCheckView } from '../spam-test-view';

const CO = randomUUID();
const OWNER = randomUUID();

const spamTest = async (results: Array<string | null>) => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: CO, user_id: OWNER, callback_number: '0212345678', status: 'completed', source: 'auto_ai', batch_id: randomUUID(), completed_at: new Date() });
  for (const [i, r] of results.entries()) {
    await insertMinimalRow(pool, 'spam_filter_test_results', { test_id: id, carrier: ['SKT', 'LGU', 'KT'][i] ?? 'SKT', message_type: 'LMS', result: r, phone: `0100000000${i}` });
  }
  return id;
};

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1111', login_id: `t-c159-${OWNER.slice(0, 8)}` });
});

describe('C159 판정 · 칩 보기(실 PG)', () => {
  it('세 통신사 행이 모두 발송 실패인데 큐 행을 못 읽는다 = 사유 없음(종전 판정) · 칩 보기 = 결과 없음 + 늦은 보고 창은 종전 값', async () => {
    const test = await spamTest(['failed', 'failed', 'failed']);
    expect(await spamGatewayRejectionOf(test)).toBeNull();
    const view = await spamCheckView(test, 'completed', new Date(), 'LMS');
    expect(view.state).toBe('warn');
    expect(view.rejection).toBeUndefined();
    expect(view.lateOpen).toBe((await readSpamTestOutcome(test)).lateOpen);
  });

  it('통과 · 시간 초과 행이 섞인 검사 = 사유 없음(행 전부가 실패가 아니다) · 값 범위는 그대로 장애', async () => {
    const mixed = await spamTest(['failed', 'pass', 'timeout']);
    expect(await spamGatewayRejectionOf(mixed)).toBeNull();
    expect((await readSpamTestOutcome(mixed)).outcome).toBe('error');
    const passed = await spamTest(['pass', 'pass', 'pass']);
    expect(await spamGatewayRejectionOf(passed)).toBeNull();
    expect((await spamCheckView(passed, 'completed', new Date(), 'LMS')).state).toBe('pass');
  });

  it('결과 행이 없는 검사 · 없는 검사 번호 = 사유 없음(던지지 않는다)', async () => {
    const empty = await spamTest([]);
    expect(await spamGatewayRejectionOf(empty)).toBeNull();
    expect(await spamGatewayRejectionOf(randomUUID())).toBeNull();
  });
});
