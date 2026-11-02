/**
 * 여정 '적재 중' 표식 판정 CT (★ 2026-09-26 한줄로 V2 m105 · Codex 2R ③④⑤ · 3R ②③④⑤ · 4R ①②)
 *
 * ③ 적재 오류(응답만 유실 · 행은 들어감)에 표식을 지우면 재시도가 같은 고객에게 다시 보내고 다시 차감했다
 *    → 적재 오류에 표식을 지우지 않는다. 판정은 이 CT 하나가 한다(가드 · 재시도 소진 분기).
 * 판정 방식은 세 라운드 동안 추정(시각 창 → 장부 건수 + 번호)을 바꿔 가며 샜다 — 뿌리 = MySQL 행에 시도 식별자가 없다.
 * 4R 구조 정정 = **추정하지 않고 증명될 때만 판정한다.**
 *   상한(라이브 + 이력 그대로 합 · 옮기는 순간 중복은 있어도 누락은 없다) − 확정 발송 ≤ 0 → 안 들어갔다(다시 보낸다)
 *   하한(안전 집계 − 대체 행 · 중복 없음 · 발송 중 행은 빠질 수 있다) − 확정 발송 ≥ 미확정 표식 수 → 들어갔다(확정)
 *   그 밖 = 증명 안 됨 → 표식을 두고 다시 보지 않는다(보류). 1시간 넘게 증명 안 되면 다시 보내지 않고 닫는다
 *   (★ 0926 Harold 결정 — 두 번 보내는 일은 없게 · 그 1건 요금은 정산이 미적재로 돌려준다).
 *   번호 비교는 없앴다(발송 뒤 번호가 바뀌면 틀린다 · 4R ②).
 * 테이블 = 그 캠페인의 발송 기록 테이블 ∪ 회사 전 라인, 각각 캠페인 날짜 기준월 전후 이력(범위가 좁으면 있는 행을 못 봐 "없다"를 증명해 버린다).
 * ★ 2026-11-02 묶음 발송 — 판정 단위 = 적재 단위(judgeLoadUnit · 설계서 3-8). 증명 식(attributeClaimLoad)은 그대로 · 옛 한 건 판정 CT 시험은 단위 판정 시험으로 바꿨다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  claim: null as any,
  camp: { created_by: 'u1', send_config: { sentTables: ['SMSQ_SEND_1'] }, sent_at: null, scheduled_at: null, created_at: '2026-09-26T00:00:00Z' } as any,
  confirmRowCount: 1, closeRowCount: 1,
  upper: 0, safeTotal: 0,
  confirmed: 0, unresolved: 1, closed: 0,
  tables: ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609'] as string[],
  mysqlDown: false,
  protocol: null as string | null, unit: null as any, claims: [] as any[], alive: false, aliveThrows: false, confirmedRows: [] as any[],
};
const order: string[] = [];
const sqlLog: Array<{ sql: string; params: any[] }> = [];
const queryMock = vi.fn(async (sql: string, params: any[] = []) => {
  const s = String(sql);
  sqlLog.push({ sql: s, params });
  if (s.includes("send_config->>'loadProtocol' AS protocol")) return { rows: state.camp ? [{ protocol: state.protocol, unit: state.unit }] : [] };
  if (s.includes("WHERE campaign_id = $1::uuid AND status = 'sending' ORDER BY sent_at ASC")) return { rows: state.claims };
  if (s.includes('FROM campaigns WHERE id = $1::uuid')) return { rows: state.camp ? [state.camp] : [] };
  if (s.includes('WITH confirmed AS')) return { rows: state.confirmedRows, rowCount: state.confirmedRows.length };
  if (s.includes('WITH gone AS')) return { rows: [{ n: state.claims.length }] };
  if (s.includes("SET status = 'failed'")) return { rows: [], rowCount: state.closeRowCount };
  if (s.includes("FILTER (WHERE status = 'sent')")) { order.push('pg-ledger'); return { rows: [{ confirmed: state.confirmed, unresolved: state.unresolved, closed: state.closed }] }; }
  return { rows: [], rowCount: 1 };
});
vi.mock('../../config/database', () => ({
  default: { query: (...a: any[]) => (queryMock as any)(...a) },
  query: (...a: any[]) => (queryMock as any)(...a),
}));
const tablesMock = vi.fn(async (..._a: any[]) => state.tables);
const countAllMock = vi.fn(async (..._a: any[]) => { order.push('mysql-upper'); if (state.mysqlDown) throw new Error('mysql down'); return state.upper; });
const safeMock = vi.fn(async (_t: any, ids: any[], ..._rest: any[]) => { order.push('mysql-lower'); return new Map([[String(ids[0]), { total: state.safeTotal, success: 0, fail: 0, pending: 0 }]]); });
const subMock = vi.fn(async () => new Map());
const aliveMock = vi.fn(async (_id: number) => { if (state.aliveThrows) throw new Error('processlist 조회 실패'); return state.alive; });
vi.mock('../sms-queue', async () => ({
  // 원 행 조건은 실물(대체 행 판정과 같은 조건인지가 계약이다)
  smsMsgTypeScopeSql: ((await vi.importActual('../sms-queue')) as any).smsMsgTypeScopeSql,
  getCampaignSmsTablesWide: (...a: any[]) => (tablesMock as any)(...a),
  smsCountAll: (...a: any[]) => (countAllMock as any)(...a),
  smsCampaignCountsSafe: (...a: any[]) => (safeMock as any)(...a),
  smsCampaignSubRowCounts: (...a: any[]) => (subMock as any)(...a),
  isMysqlThreadAlive: (...a: any[]) => (aliveMock as any)(...a),
}));
vi.mock('../journey-step-campaign', () => ({ LOAD_PROTOCOL_UNIT: 'unit' }));

import { attributeClaimLoad, confirmLoadUnit, clearLoadUnit, judgeLoadUnit, CLAIM_PROOF_LIMIT_SEC } from '../journey-send-claim';

const owner = { company_id: 'c1', created_by: 'u1', customer_id: 'cust-1' };
const PRIMARY = 'NOT (k_oriseq IS NOT NULL AND k_oriseq > 0)';

beforeEach(() => {
  state.claim = { campaign_id: 'camp-1', cost: 27.5, sent_at: new Date('2026-09-26T03:00:00Z'), age_sec: 300 };
  state.camp = { created_by: 'u1', send_config: { sentTables: ['SMSQ_SEND_1'] }, sent_at: null, scheduled_at: null, created_at: '2026-09-26T00:00:00Z' };
  state.confirmRowCount = 1; state.closeRowCount = 1;
  state.upper = 0; state.safeTotal = 0; state.confirmed = 0; state.unresolved = 1; state.closed = 0;
  state.tables = ['SMSQ_SEND_1', 'SMSQ_SEND_1_202609']; state.mysqlDown = false;
  state.protocol = null; state.unit = null; state.claims = []; state.alive = false; state.aliveThrows = false; state.confirmedRows = [];
  order.length = 0; sqlLog.length = 0;
  queryMock.mockClear(); tablesMock.mockClear(); countAllMock.mockClear(); safeMock.mockClear(); subMock.mockClear(); aliveMock.mockClear();
});

describe('증명 (4R ①② — 추정하지 않는다)', () => {
  it('상한 − 확정 ≤ 0 이면 안 들어갔다(하한을 볼 필요 없다)', async () => {  // 상한 = 라이브 + 이력 그대로 합(원 행)
    state.upper = 2; state.confirmed = 2;
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('not_loaded');
    expect(order).not.toContain('mysql-lower');
    const [, where, params] = countAllMock.mock.calls[0] as any[];
    expect(where).toBe(`app_etc1 = ? AND ${PRIMARY}`);
    expect(params).toEqual(['camp-1']);
  });

  it('하한(원 행 안전 집계 한 번) − 확정 − 닫힌 표식 ≥ 미확정 표식 수 이면 들어갔다', async () => {
    state.upper = 3; state.safeTotal = 3; state.confirmed = 2; state.unresolved = 1;   // 하한 3 − 2 − 0 = 1 ≥ 1
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('loaded');
    // 하한은 원 행 범위의 안전 집계 한 번(전체 − 대체 행 두 번 조회를 빼는 방식이 아니다 · 5R ③)
    const [, ids, group, scope] = safeMock.mock.calls[0] as any[];
    expect(ids).toEqual(['camp-1']);
    expect(group).toBe('app_etc1');
    expect(scope).toBe('primary');
    expect(subMock).not.toHaveBeenCalled();
  });

  it('닫힌 표식(증명 못 해 닫음)도 원 행을 가졌을 수 있다 — 하한 증명에서 그 수만큼 뺀다 (5R ②)', async () => {
    // A는 들어갔지만 증명 못 해 닫혔다(closed 1) · B는 안 들어감(미확정 1) · 원 행 1
    state.upper = 1; state.safeTotal = 1; state.confirmed = 0; state.unresolved = 1; state.closed = 1;
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('unprovable');
    const ledger = sqlLog.find((q) => q.sql.includes("FILTER (WHERE status = 'sent')"))!;
    expect(ledger.sql).toContain("COUNT(*) FILTER (WHERE status = 'failed' AND error_reason = 'load_unprovable')");
  });

  it('닫힌 표식이 있어도 상한 − 확정 ≤ 0 이면 안 들어갔다(닫힌 표식도 원 행이 없다는 뜻)', async () => {
    state.upper = 0; state.confirmed = 0; state.closed = 1;
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('not_loaded');
  });

  it('원 행 조건은 대체 행 판정의 부정 하나(sms-queue smsMsgTypeScopeSql primary)', async () => {
    const { smsMsgTypeScopeSql } = (await vi.importActual('../sms-queue')) as any;
    expect(smsMsgTypeScopeSql('primary')).toBe(PRIMARY);
  });

  it('옮기는 순간 라이브·이력 중복으로 상한만 부풀면 증명 안 됨(들어갔다고 하지 않는다 · 4R ①)', async () => {  // 하한 1 − 확정 1 = 0 < 1
    state.upper = 2; state.safeTotal = 1; state.confirmed = 1; state.unresolved = 1;   // 확정 1건의 행이 양쪽에 보임 · 이 시도는 안 들어감
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('unprovable');
  });

  it('미확정 표식이 여럿이고 일부만 들어갔으면 증명 안 됨(번호로 가리지 않는다 · 4R ②)', async () => {
    state.upper = 3; state.safeTotal = 3; state.confirmed = 2; state.unresolved = 2;
    expect(await attributeClaimLoad(owner, 'camp-1')).toBe('unprovable');
    expect(sqlLog.some((q) => q.sql.includes('FROM customers'))).toBe(false);
  });

  it('PG 장부를 MySQL보다 먼저 읽는다', async () => {
    state.upper = 3; state.safeTotal = 3; state.confirmed = 2; state.unresolved = 1;
    await attributeClaimLoad(owner, 'camp-1');
    expect(order.indexOf('pg-ledger')).toBeLessThan(order.indexOf('mysql-upper'));
  });

  it('테이블은 그 캠페인 행으로 넓게 고른다(발송 기록 ∪ 회사 전 라인 · 캠페인 날짜 기준월)', async () => {
    state.upper = 0;
    await attributeClaimLoad(owner, 'camp-1');
    expect(tablesMock).toHaveBeenCalledWith('c1', state.camp);
    const camp = sqlLog.find((q) => q.sql.includes('FROM campaigns WHERE id = $1::uuid'))!;
    expect(camp.sql).toContain('SELECT created_by, send_config, sent_at, scheduled_at, created_at');
  });

  it('캠페인 id가 없으면 안 들어갔다 · 캠페인 행이나 테이블이 없으면 던진다', async () => {
    expect(await attributeClaimLoad(owner, null)).toBe('not_loaded');
    state.tables = [];
    await expect(attributeClaimLoad(owner, 'camp-1')).rejects.toThrow();
    state.tables = ['SMSQ_SEND_1']; state.camp = null;
    await expect(attributeClaimLoad(owner, 'camp-1')).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-11-02 묶음 발송 — 판정 단위 = 적재 단위(설계서 docs/2026-11-02-journey-batch-send-design.md 3-8 I2 ~ I5 · 옛 한 건 판정 CT 는 없앴다)
// ════════════════════════════════════════════════════════════════════

describe('단위 확정 · 지움 = 한 문장', () => {
  it('확정 = 표식 sent + 캠페인 발송 수 + n + 단위 기록 지움 + 변이 보상(변이별 합)이 한 문장 · 이번 문장이 확정한 표식만 돌려준다', async () => {
    state.confirmedRows = [{ id: 'l1', execution_id: 'e1', cost: 27.5 }, { id: 'l2', execution_id: 'e2', cost: 27.5 }];
    const r = await confirmLoadUnit('camp-1', ['l1', 'l2'], { variantCounts: [{ variantId: 'v1', sent: 2 }, { variantId: 'v0', sent: 0 }] });
    expect(r).toEqual([{ id: 'l1', executionId: 'e1', cost: 27.5 }, { id: 'l2', executionId: 'e2', cost: 27.5 }]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const { sql, params } = sqlLog[0];
    expect(sql).toMatch(/WITH confirmed AS \(\s*UPDATE journey_step_logs SET status = 'sent'\s*WHERE id = ANY\(\$2::uuid\[\]\) AND status = 'sending' AND campaign_id = \$1::uuid/);
    expect(sql).toContain('sent_count = sent_count + (SELECT COUNT(*) FROM confirmed)');
    expect(sql).toContain("send_config = COALESCE(send_config, '{}'::jsonb) - 'loadUnit'");
    expect(sql).toContain('UPDATE journey_step_variants v SET sent_count = v.sent_count + x.n');
    expect(params).toEqual(['camp-1', ['l1', 'l2'], ['v1'], [2], false]);   // 0건 변이는 싣지 않는다
  });
  it('withStats = 실행 · 여정 비용 통계도 같은 문장(전진 없이 확정하는 자리)', async () => {
    await confirmLoadUnit('camp-1', ['l1'], { withStats: true });
    expect(sqlLog[0].sql).toContain('UPDATE journey_executions e SET total_cost = e.total_cost + c.cost');
    expect(sqlLog[0].sql).toContain('UPDATE journeys j SET stats_total_cost = j.stats_total_cost + s.cost');
    expect(sqlLog[0].params[4]).toBe(true);
  });
  it("지움 = 'sending' 표식만 + 단위 기록 지움(한 문장)", async () => {
    await clearLoadUnit('camp-1', ['l1']);
    expect(sqlLog[0].sql).toMatch(/WITH gone AS \(DELETE FROM journey_step_logs WHERE id = ANY\(\$2::uuid\[\]\) AND status = 'sending'/);
    expect(sqlLog[0].sql).toContain("- 'loadUnit'");
  });
});

describe('단위 판정 (새 규약 · loadProtocol = unit)', () => {
  beforeEach(() => {
    state.protocol = 'unit';
    state.unit = { threadId: 77, table: 'SMSQ_SEND_1', count: 2 };
    state.claims = [{ id: 'l1', execution_id: 'e1', cost: 27.5, sent_at: '2026-11-02T01:00:00Z', age_sec: 600 }, { id: 'l2', execution_id: 'e2', cost: 27.5, sent_at: '2026-11-02T01:00:00Z', age_sec: 600 }];
    state.unresolved = 2;
  });
  it('단위 기록 없음 = 적재 문장을 보내지 않았다 = 안 들어감 → 지움(장부 조회 0 · I5)', async () => {
    state.unit = null;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('cleared');
    expect(sqlLog.some((q) => q.sql.includes('WITH gone AS'))).toBe(true);
    expect(countAllMock).not.toHaveBeenCalled();
  });
  it('그 연결이 처리 목록에 남아 있으면 판정 0 · 보류(늦은 커밋과 재시도가 겹치는 길 0 · I4)', async () => {
    state.alive = true; state.upper = 0;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('held');
    expect(aliveMock).toHaveBeenCalledWith(77);
    expect(countAllMock).not.toHaveBeenCalled();
  });
  it('처리 목록 조회 실패 = 보류(모르면 판정하지 않는다)', async () => {
    state.aliveThrows = true; state.upper = 0;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('held');
    expect(countAllMock).not.toHaveBeenCalled();
  });
  it('연결 끝남 + 장부 하한이 단위 n 을 채움 = 들어감 → 크레딧(beforeConfirm) 먼저 · 확정', async () => {
    state.upper = 2; state.safeTotal = 2; state.confirmedRows = [{ id: 'l1', execution_id: 'e1', cost: 27.5 }, { id: 'l2', execution_id: 'e2', cost: 27.5 }];
    const seen: string[] = [];
    const before = vi.fn(async (at: Date) => { seen.push(`credit:${at.toISOString()}`); });
    const r: any = await judgeLoadUnit(owner, 'camp-1', { beforeConfirm: before });
    expect(r.result).toBe('sent');
    expect(r.confirmed).toHaveLength(2);
    expect(seen).toEqual(['credit:2026-11-02T01:00:00.000Z']);
    const creditAt = queryMock.mock.invocationCallOrder[sqlLog.findIndex((q) => q.sql.includes('WITH confirmed AS'))];
    expect(before.mock.invocationCallOrder[0]).toBeLessThan(creditAt);
  });
  it('연결 끝남 + 상한 − 확정 ≤ 0 = 안 들어감 → 지움(다시 보내도 두 번이 아니다)', async () => {
    state.upper = 0;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('cleared');
  });
  it('증명 안 됨 + 1시간 전 = 보류 · 1시간 넘음 = 닫음(실패 · 비용 0) + 캠페인 봉인(I3)', async () => {
    state.upper = 3; state.safeTotal = 1;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('held');
    expect(sqlLog.some((q) => q.sql.includes('loadSealed'))).toBe(false);
    state.claims[0].age_sec = CLAIM_PROOF_LIMIT_SEC;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('closed');
    // 닫음 + 단위 기록 지움 + 봉인 = 한 문장(사이에 끊겨 봉인 안 된 캠페인에 새 단위가 들어가는 길 0 · Codex 구현 1R)
    const close = sqlLog.find((q) => q.sql.includes('WITH closed AS'))!;
    expect(close.sql).toContain("SET status = 'failed', error_reason = 'load_unprovable', cost = 0");
    expect(close.sql).toContain("WHERE id = ANY($2::uuid[]) AND status = 'sending'");
    expect(close.sql).toContain("jsonb_set(COALESCE(send_config, '{}'::jsonb) - 'loadUnit', '{loadSealed}', 'true'::jsonb)");
    expect(sqlLog.filter((q) => q.sql.includes('loadSealed'))).toHaveLength(1);
  });
  it('연결이 1시간 넘게 살아 있어도 닫는다(보류 상한 = 1시간)', async () => {
    state.alive = true; state.claims[1].age_sec = CLAIM_PROOF_LIMIT_SEC + 5;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('closed');
    expect(sqlLog.find((q) => q.sql.includes('WITH closed AS'))!.sql).toContain("'{loadSealed}', 'true'::jsonb");
  });
  it('표식이 없으면 아무것도 하지 않는다(남은 단위 기록만 지움)', async () => {
    state.claims = [];
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('none');
    expect(sqlLog.some((q) => q.sql.includes("- 'loadUnit'"))).toBe(true);
    expect(countAllMock).not.toHaveBeenCalled();
  });
});

describe('단위 판정 (옛 표식 · loadProtocol 없음 = 다시 보내는 갈래 0 · Codex 설계 4R)', () => {
  beforeEach(() => {
    state.protocol = null; state.unit = null;
    state.claims = [{ id: 'l1', execution_id: 'e1', cost: 27.5, sent_at: '2026-11-02T01:00:00Z', age_sec: 600 }];
    state.unresolved = 1;
  });
  it('들어감이 증명되면 확정', async () => {
    state.upper = 1; state.safeTotal = 1; state.confirmedRows = [{ id: 'l1', execution_id: 'e1', cost: 27.5 }];
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('sent');
  });
  it('장부 0건(안 들어감 상한)이어도 지우지 않는다 = 1시간 전 보류 · 넘으면 닫음(옛 INSERT 종료를 증명할 수 없다)', async () => {
    state.upper = 0;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('held');
    expect(sqlLog.some((q) => q.sql.includes('WITH gone AS') || q.sql.includes('DELETE FROM journey_step_logs'))).toBe(false);
    state.claims[0].age_sec = CLAIM_PROOF_LIMIT_SEC;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('closed');
    expect(sqlLog.some((q) => q.sql.includes('DELETE FROM journey_step_logs'))).toBe(false);
  });
  it('장부 조회 실패 = 증명 안 됨(보류 · 1시간 뒤 닫음)', async () => {
    state.mysqlDown = true;
    expect((await judgeLoadUnit(owner, 'camp-1')).result).toBe('held');
  });
});
