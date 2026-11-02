/**
 * 발송 크레딧 되돌림 = 못 나아가는 후보가 앞자리를 차지하지 않는다(★ 2026-11-02 Codex 구현 1R-1 · 설계서 docs/2026-11-01-credit-control-tower-design.md §16-1 F5 · §16-5)
 *   보류 · 다른 길로 환불됨 · 되돌릴 수 없는 꼴 = 하루 · 예외 = 30분 동안 LIMIT 앞 SQL 에서 뺀다 · 자동 환불 기간 끝 하루 전 = 수동 환불 경보.
 *   ★ 3R 구조 처방 — 후보 = 커서 순환(한 바퀴 안에 전부) · 기간 끝 = 회사별 집계(LIMIT 없음).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ query: vi.fn(), refund: vi.fn(), alerts: [] as any[] }));
vi.mock('../../config/database', () => ({ query: (...a: any[]) => (m.query as any)(...a) }));
vi.mock('../ai-credit', () => ({ refundCredit: (...a: any[]) => (m.refund as any)(...a) }));
vi.mock('../system-alert', () => ({ alertPassFailures: vi.fn(async (o: any) => { m.alerts.push(o); return 0; }) }));

import { releaseUnsentSendCharges, unsentReleaseCandidatesSql, unsentReleaseAgingSql, type UnsentReleaseSpec } from '../ai-credit-release';

const spec = (pass: string): UnsentReleaseSpec => ({ source: 'planner-send', pass, keyLike: 'planner-send:%:%', minAgeMinutes: 30, lookbackDays: 7, notSentSql: 'TRUE', limit: 20, reason: 'r' });
const BOUND = '2026-11-02 09:00:00.5+00';
const row = (key: string, at = '2026-11-01 00:00:00+00') => ({ company_id: 'c1', idempotency_key: key, amount: -5, at_text: at, bound_text: BOUND });
/** 첫 부름 = 후보 · 둘째 = 기간 끝 후보(없음) */
const candidates = (...keys: string[]) => {
  m.query.mockResolvedValueOnce({ rows: keys.map(row) }).mockResolvedValueOnce({ rows: [] });
};

describe('되돌림 후보 SQL — 기다리는 키는 LIMIT 앞 · 커서 뒤부터 · 기간 끝 = 회사별 집계', () => {
  it('$3 = 기다리는 키 · $4 · $5 = 커서(시각 · 키) · 둘 다 LIMIT 앞 · 순서 = 시각 · 키', () => {
    const sql = unsentReleaseCandidatesSql(spec('p'));
    expect(sql).toContain('AND NOT (t.idempotency_key = ANY($3::text[]))');
    expect(sql).toContain('AND ($4::timestamptz IS NULL OR (t.created_at, t.idempotency_key) > ($4::timestamptz, $5::text))');
    expect(sql.indexOf('ANY($3::text[])')).toBeLessThan(sql.indexOf('LIMIT 20'));
    expect(sql.indexOf('($4::timestamptz, $5::text)')).toBeLessThan(sql.indexOf('LIMIT 20'));
    // 바퀴 상한 = $6(바퀴 시작 때 NULL → DB NOW()) · LIMIT 앞(4R)
    expect(sql).toContain('AND t.created_at <= COALESCE($6::timestamptz, NOW())');
    expect(sql.indexOf('COALESCE($6::timestamptz, NOW())\n')).toBeLessThan(sql.indexOf('LIMIT 20'));
    expect(sql).toContain('ORDER BY t.created_at ASC, t.idempotency_key ASC');
  });
  it('기간 끝 = 6일보다 오래된 줄(7일 기간) · 회사별 수 · 크레딧 · LIMIT 없음(하나도 빠지지 않는다 · 3R)', () => {
    const aging = unsentReleaseAgingSql(spec('p'));
    expect(aging).toContain("AND t.created_at <= NOW() - INTERVAL '6 days'");
    expect(aging).toContain('GROUP BY t.company_id');
    expect(aging).not.toContain('LIMIT');
    expect(aging).toContain('AND NOT (t.idempotency_key = ANY($3::text[]))');
  });
});

describe('releaseUnsentSendCharges — 못 나아가는 후보', () => {
  beforeEach(() => { m.query.mockReset(); m.refund.mockReset(); m.alerts.length = 0; });

  it('보류 = 다음 회차에 그 키를 빼고 뽑는다(보류 20건이 정상 후보를 굶기지 않는다) · 보류 수를 센다', async () => {
    candidates('planner-send:h1:s1');
    m.refund.mockResolvedValueOnce({ refunded: false, amount: 0, skipReason: 'held_after_lifetime_end' });
    expect(await releaseUnsentSendCharges(spec('hold'))).toEqual({ candidates: 1, released: 0, held: 1 });
    candidates('planner-send:n1:s1');
    m.refund.mockResolvedValueOnce({ refunded: true, amount: 5 });
    expect((await releaseUnsentSendCharges(spec('hold'))).released).toBe(1);
    expect(m.query.mock.calls[2][1][2]).toContain('planner-send:h1:s1');   // 둘째 회차 후보 SQL 의 $3
    // 보류는 사람 할 일 = 기간 끝 경보에서는 빼지 않는다
    expect(m.query.mock.calls[3][1][2]).not.toContain('planner-send:h1:s1');
  });

  it('다른 길로 이미 환불됨 = 끝난 일(후보 · 기간 끝 경보 둘 다에서 뺀다 · 실패로 세지 않는다)', async () => {
    candidates('planner-send:a1:s1');
    m.refund.mockResolvedValueOnce({ refunded: false, amount: 0, skipReason: 'already_refunded' });
    await releaseUnsentSendCharges(spec('done'));
    candidates();
    await releaseUnsentSendCharges(spec('done'));
    expect(m.query.mock.calls[2][1][2]).toContain('planner-send:a1:s1');
    expect(m.query.mock.calls[3][1][2]).toContain('planner-send:a1:s1');
    expect(m.alerts.filter((a) => a.pass === 'credit-release:done').every((a) => a.failures.length === 0)).toBe(true);
  });

  it('되돌릴 수 없는 꼴(원 차감 없음 등) = 사람이 볼 실패 · 키 = 원 차감 키', async () => {
    candidates('planner-send:x1:s1');
    m.refund.mockResolvedValueOnce({ refunded: false, amount: 0, skipReason: 'no_credit_row' });
    await releaseUnsentSendCharges(spec('stuck'));
    const a = m.alerts.find((x) => x.pass === 'credit-release:stuck');
    expect(a.failures).toEqual([{ companyId: 'c1', error: '되돌릴 수 없는 꼴: no_credit_row', key: 'planner-send:x1:s1' }]);
  });

  it('예외 = 실패로 세고 30분 뒤 다시(그동안 LIMIT 앞에서 뺀다)', async () => {
    candidates('planner-send:e1:s1');
    m.refund.mockRejectedValueOnce(new Error('db down'));
    await releaseUnsentSendCharges(spec('err'));
    expect(m.alerts.find((x) => x.pass === 'credit-release:err').failures).toEqual([{ companyId: 'c1', error: 'db down', key: 'planner-send:e1:s1' }]);
    candidates();
    await releaseUnsentSendCharges(spec('err'));
    expect(m.query.mock.calls[2][1][2]).toContain('planner-send:e1:s1');
  });

  it('Codex 3R 구조 — 커서 순환: 꽉 찬 회차 뒤에는 마지막 줄 뒤부터 · 덜 찬 회차(끝까지 봄) 뒤에는 처음부터', async () => {
    const lim = { ...spec('cursor'), limit: 2 };
    m.query.mockResolvedValueOnce({ rows: [row('planner-send:k1:s1', '2026-11-01 00:00:01+00'), row('planner-send:k2:s1', '2026-11-01 00:00:02.123456+00')] }).mockResolvedValueOnce({ rows: [] });
    m.refund.mockResolvedValue({ refunded: false, amount: 0, skipReason: 'held_after_lifetime_end' });
    await releaseUnsentSendCharges(lim);
    expect(m.query.mock.calls[0][1].slice(3)).toEqual([null, null, null]);
    m.query.mockResolvedValueOnce({ rows: [row('planner-send:k3:s1', '2026-11-01 00:00:03+00')] }).mockResolvedValueOnce({ rows: [] });
    await releaseUnsentSendCharges(lim);
    expect(m.query.mock.calls[2][1].slice(3)).toEqual(['2026-11-01 00:00:02.123456+00', 'planner-send:k2:s1', BOUND]);   // µs 그대로 · 바퀴 상한 그대로
    candidates();
    await releaseUnsentSendCharges(lim);
    expect(m.query.mock.calls[4][1].slice(3)).toEqual([null, null, null]);   // 한 바퀴 끝 = 새 바퀴(새 상한)
  });

  it('Codex 4R 반례 — 회차마다 새 후보가 LIMIT 만큼 들어와도 바퀴 상한은 그대로 = 그 바퀴가 끝나면 처음으로(앞의 실패 건 다시 시도)', async () => {
    const lim = { ...spec('inflow'), limit: 2 };
    m.refund.mockReset();
    // 1회차: A 일시 오류 · B 성공(꽉 참) → 커서 = B · 상한 = 바퀴 시작 시각
    m.query.mockResolvedValueOnce({ rows: [row('planner-send:A:s', '2026-11-01 01:00:00+00'), row('planner-send:B:s', '2026-11-01 02:00:00+00')] }).mockResolvedValueOnce({ rows: [] });
    m.refund.mockRejectedValueOnce(new Error('일시')).mockResolvedValueOnce({ refunded: true, amount: 5 });
    await releaseUnsentSendCharges(lim);
    // 2 · 3회차: 상한 안의 남은 줄이 꽉 차게 이어진다(새 유입은 상한 뒤라 이 바퀴에 안 들어온다) — 상한은 1회차 것 그대로
    for (const k of ['C', 'E']) {
      m.query.mockResolvedValueOnce({ rows: [row(`planner-send:${k}:s`, '2026-11-01 03:00:00+00'), row(`planner-send:${k}2:s`, '2026-11-01 04:00:00+00')] }).mockResolvedValueOnce({ rows: [] });
      m.refund.mockResolvedValue({ refunded: true, amount: 5 });
      await releaseUnsentSendCharges(lim);
    }
    expect(m.query.mock.calls[2][1][5]).toBe(BOUND);
    expect(m.query.mock.calls[4][1][5]).toBe(BOUND);
    // 4회차: 상한까지 다 봄(덜 참) → 5회차는 새 바퀴(커서 · 상한 NULL = 처음부터 → 기다림이 끝난 A 가 다시 후보)
    m.query.mockResolvedValueOnce({ rows: [row('planner-send:G:s', '2026-11-01 05:00:00+00')] }).mockResolvedValueOnce({ rows: [] });
    await releaseUnsentSendCharges(lim);
    candidates();
    await releaseUnsentSendCharges(lim);
    expect(m.query.mock.calls[8][1].slice(3)).toEqual([null, null, null]);
  });

  it('키 모양이 이 기능 것이 아님(acceptKey 거절) = 하루 동안 후보 · 기간 끝 조회 둘 다 LIMIT 앞에서 뺀다(자리 차지 0)', async () => {
    candidates('planner-send:bad');
    await releaseUnsentSendCharges({ ...spec('shape'), acceptKey: (k) => k.split(':').length === 3 });
    expect(m.refund).not.toHaveBeenCalled();
    candidates();
    await releaseUnsentSendCharges({ ...spec('shape'), acceptKey: (k) => k.split(':').length === 3 });
    expect(m.query.mock.calls[2][1][2]).toContain('planner-send:bad');
    expect(m.query.mock.calls[3][1][2]).toContain('planner-send:bad');
  });

  it('기간 끝 하루 전 미해결 = 회사별 수 · 크레딧 경보(창이 끝나 조용히 사라지지 않게 · 항목 = 회사)', async () => {
    m.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ company_id: 'c1', n: 601, credits: 3005 }] });
    await releaseUnsentSendCharges(spec('aging'));
    expect(m.query.mock.calls[1][0]).toContain('GROUP BY t.company_id');
    const a = m.alerts.find((x) => x.pass === 'credit-release-aging:aging');
    expect(a.failures).toEqual([{ companyId: 'c1', error: '미해결 601건 · 3005크레딧' }]);
  });
});
