// replaces: none
/**
 * C105 · 1105 범위 밖 다섯 — 실 PostgreSQL(★ 2026-11-05 설계서 docs/2026-11-05-c105-out-of-scope-five-design.md §5 실 PG)
 *
 *   H2 켜기 확인 개별회신번호 미등록 수 = 새 규칙(회신번호 → 비면 매장 · 숫자 있는 값)
 *   H3 재진입 허용 · 쿨다운 0 = 지금 여정 진행 중 고객 제외 · 끝난 고객 포함
 *   H4 고객 필터 숫자 = 옛 값 그대로(2^53 넘는 글자 · 지수 · '1e 3' 대상 집합 보존) · NaN = 멈춤 · 나이 '30.0' = 30
 *   H5 판 id 로 스팸 검사 글 = 그 판 글
 * 고객 번호 = 010-0000-xxxx(도달 불가 대역) · 회신번호 = 02 시험 번호.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../spam-test-queue', async (orig) => ({ ...(await orig<any>()), peekSpamCheck: async () => null, enqueueSpamTest: async () => ({ ok: true, testId: randomUUID() }) }));
vi.mock('../journey-message-render', async (orig) => ({
  ...(await orig<any>()),
  renderJourneySmsMessage: async (p: any) => ({ message: String(p.template || ''), subject: p.subject || '', msgType: p.channel === 'sms' ? 'SMS' : 'LMS' }),
  pickJourneySampleCustomer: async () => ({}),
}));

import { storeCallbackExposure } from '../journey-target-extractor';
import { buildReentryAntiJoin } from '../journey-safety-filter';
import { buildCustomerFilter } from '../customer-filter';
import { journeyStepSpamParams } from '../journey-pretest-validator';

const CO = randomUUID();
const OWNER = randomUUID();
const REG = '0212341051';
const UNREG = '0299991051';
const UNREG2 = '0299991052';
const J = randomUUID();
const JR = randomUUID();
const S = randomUUID();
const VB = randomUUID();
const C = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID(), x: randomUUID(), y: randomUUID() };
const N = { n1: randomUUID(), n2: randomUUID(), n3: randomUUID(), n4: randomUUID() };

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: 'C105 범위 밖 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1051', login_id: 't-1105-c105' });
  await insertMinimalRow(pool, 'sender_numbers', { id: randomUUID(), company_id: CO, phone_number: REG, is_active: true });
  let n = 0;
  const cust = async (id: string, extra: Record<string, unknown>) => {
    n += 1;
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `0100000${String(1200 + n)}`, is_active: true, sms_opt_in: true, ...extra });
  };
  await cust(C.a, { callback: REG, store_phone: UNREG });     // 새 = 회신번호(등록) · 옛 = 매장(미등록 · 실패)
  await cust(C.b, { callback: UNREG, store_phone: REG });     // 새 = 회신번호(미등록 · 실패)
  await cust(C.c, { callback: '없음', store_phone: REG });    // 새 = 숫자 없음 → 여정 번호(미등록 수 아님)
  await cust(C.d, { store_phone: UNREG2 });                   // 새 = 매장(미등록 · 실패)
  await cust(C.x, {});
  await cust(C.y, {});
  for (const [id, v] of [[N.n1, '9007199254740992'], [N.n2, '1000'], [N.n3, '999'], [N.n4, '0']] as const) {
    await cust(id, {});
    await pool.query(`UPDATE customers SET custom_fields = jsonb_build_object('custom_1', $2::text), age = 30 WHERE id = $1`, [id, v]);
  }
  await pool.query(`UPDATE customers SET created_at = NOW() - INTERVAL '60 days' WHERE company_id = $1`, [CO]);

  // 재진입 허용 · 쿨다운 0 여정 · x = 진행 중 · y = 끝남
  await insertMinimalRow(pool, 'journeys', { id: JR, company_id: CO, created_by: OWNER, name: '재진입', status: 'active', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, allow_reentry: true, reentry_cooldown_days: 0 });
  await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: JR, customer_id: C.x, status: 'active' });
  await insertMinimalRow(pool, 'journey_executions', { id: randomUUID(), journey_id: JR, customer_id: C.y, status: 'completed' });

  // A/B 칸
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: OWNER, name: 'A/B 검사', status: 'draft', start_kind: 'event', trigger_event: 'custom', trigger_filters: { all_customers: true }, callback_number: REG });
  await insertMinimalRow(pool, 'journey_steps', { id: S, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', subject: '안내', message_template: '칸 글 안내 문안입니다 반가워요', delay_mode: 'relative', delay_hours: 0 });
  await insertMinimalRow(pool, 'journey_step_variants', { step_id: S, variant_id: 'A', message_template: 'A안 글 반가워요 매장에 들러 주세요', subject: null });
  await insertMinimalRow(pool, 'journey_step_variants', { id: VB, step_id: S, variant_id: 'B', message_template: 'B안 글 이번 주 할인 소식이에요', subject: 'B 제목' });
});

describe('H2 개별회신번호 = 직접발송과 같은 규칙', () => {
  it('켜기 확인 미등록 = 회신번호 미등록(b) + 매장만 미등록(d) = 2명 · 회신번호 등록(a) · 숫자 없는 회신번호(c) 제외', async () => {
    const r = await storeCallbackExposure(CO, 'custom', { all_customers: true }, OWNER);
    expect(r.callbackUnregisteredCount).toBe(2);
    expect(r.unregisteredDetails.map((d) => d.phone).sort()).toEqual([UNREG, UNREG2].sort());
  });
});

describe('H3 재진입 허용 · 쿨다운 0', () => {
  // 「고른 고객에게」(custom)는 재진입과 무관하게 한 번만 받는다(옛 dedup) → 재진입 조각을 쓰는 갈래 판정은 조각 자체를 실 PG 에 돌려 본다
  it('조각 = 지금 여정 진행 중 고객(x) 제외 · 끝난 고객(y) 포함(계보 없음 · 계보 있음 둘 다)', async () => {
    for (const lineage of [undefined, [JR, randomUUID()]]) {
      const params: any[] = [CO, [C.x, C.y]];
      const frag = buildReentryAntiJoin('c', params, JR, true, 0, 0, lineage);   // ★ 1110 C123 최솟값 인자(0 = 옛 조각 그대로)
      const r = await pool.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.id = ANY($2::uuid[]) ${frag}`, params);
      expect(r.rows.map((x) => String(x.id))).toEqual([C.y]);
    }
  });
});

describe('H4 고객 필터 숫자 = 옛 값 그대로 · 거절만', () => {
  const pick = async (filters: any, format: 'mixed' | 'structured' = 'mixed'): Promise<string[]> => {
    const f = buildCustomerFilter(filters, { tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: format });
    const ids = Object.values(N);
    const r = await pool.query(`SELECT c.id FROM customers c WHERE c.company_id = $1 AND c.id = ANY($${f.nextIndex}::uuid[]) ${f.sql} ORDER BY c.id`, [CO, ...f.params, ids]);
    return r.rows.map((x) => String(x.id)).sort();
  };
  it("mixed 사용자 칸 gte '9007199254740993' = 아무도 없음(9007199254740992 고객 제외 · 깎이지 않음)", async () => {
    expect(await pick({ 'custom_fields.custom_1': { operator: 'gte', value: '9007199254740993' } })).toEqual([]);
    expect(await pick({ 'custom_fields.custom_1': { operator: 'gte', value: '9007199254740993e0' } })).toEqual([]);
  });
  it("gte '1e-400' = 0 고객 제외 · gte '1e 3' = 1000 · 9007199254740992 포함 · 999 · 0 제외", async () => {
    expect(await pick({ 'custom_fields.custom_1': { operator: 'gte', value: '1e-400' } })).toEqual([N.n1, N.n2, N.n3].sort());
    expect(await pick({ 'custom_fields.custom_1': { operator: 'gte', value: '1e 3' } })).toEqual([N.n1, N.n2].sort());
  });
  it("lte 'NaN' = 멈춤(옛 = 전부 맞음) · between [0, 'abc'] = 멈춤", async () => {
    await expect(pick({ 'custom_fields.custom_1': { operator: 'lte', value: 'NaN' } })).rejects.toMatchObject({ code: 'INVALID_NUMBER_INPUT' });
    await expect(pick({ 'custom_fields.custom_1': { operator: 'between', value: [0, 'abc'] } })).rejects.toMatchObject({ code: 'INVALID_NUMBER_INPUT' });
  });
  it("나이 eq '30.0' · gte '30' · between ['30', 30] = 옛 Number 와 같은 집합(넷 다)", async () => {
    const all = Object.values(N).sort();
    expect(await pick({ age: { operator: 'eq', value: '30.0' } }, 'structured')).toEqual(all);
    expect(await pick({ age: { operator: 'gte', value: '30' } }, 'structured')).toEqual(all);
    expect(await pick({ age: { operator: 'between', value: ['30', 30] } }, 'structured')).toEqual(all);
  });
});

describe('H5 판마다 스팸 검사', () => {
  it('판 id 를 주면 그 판 글 · 안 주면 첫 판', async () => {
    const b = await journeyStepSpamParams(CO, OWNER, J, S, VB);
    expect(b.body).toBe('B안 글 이번 주 할인 소식이에요');
    expect(b.variantId).toBe(VB);
    const first = await journeyStepSpamParams(CO, OWNER, J, S, null);
    expect(first.body).toBe('A안 글 반가워요 매장에 들러 주세요');
  });
});
