/**
 * 여정 V2 — Codex 1라운드 지적 닫기 (2026-09-30)
 *
 * 못 박는 것:
 *   - AI 초안 과금 확정(settleDraftCharge): 잔액 부족 · 같은 키 선점이면 방금 초안을 지운다 · 그 밖 실패는 결과를 막지 않는다(차감액 0)
 *   - 이미 과금된 요청은 AI 를 부르기 전에 거절 · 과금 키에 회사 id
 *   - 계보 컬럼 확인: 조회 중 호출은 같은 조회를 기다린다 · 조회 오류는 부재로 기억하지 않는다
 *   - 진입이 닫힌 옛 판을 다시 켜도 현재 판을 닫지 않는다 · 옛 판에서 새 판을 만들지 않는다
 *   - 진입 교체: 재진입 허용 + 시간 쿨다운이 지났을 때만 닫고 넣는다
 *   - 커서 자격 판정은 플래너가 소비한 행만 · 재진입 워커는 계보 전체 이력 · 끝 칸 발송비는 상태와 무관하게 한 번
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../ai-credit', () => {
  class InsufficientCreditError extends Error {}
  return { deductCreditOutcome: vi.fn(), refundCredit: vi.fn(), InsufficientCreditError };
});
vi.mock('../journey-builder', () => ({ createJourneyFromTemplate: vi.fn() }));

import { query, pool } from '../../config/database';
import { deductCreditOutcome, refundCredit, InsufficientCreditError } from '../ai-credit';
import { nextDraftChargeKey, chargeThenSaveDraft, DRAFT_ALREADY_MADE } from '../journey-draft-save';
import { lineageColumnsReady, resetLineageCache, createNewVersion, CLOSE_OTHER_VERSIONS_ENTRY_SQL, INHERIT_ENTRY_CURSORS_SQL, lockLineageEntry } from '../journey-lineage';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const outcome = deductCreditOutcome as unknown as ReturnType<typeof vi.fn>;
const refund = refundCredit as unknown as ReturnType<typeof vi.fn>;
const SRC = (f: string) => readFileSync(resolve(process.cwd(), 'src/utils', f), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  return i < 0 ? '' : s.slice(i, s.indexOf(b, i + a.length) < 0 ? undefined : s.indexOf(b, i + a.length));
};

beforeEach(() => {
  q.mockReset(); connect.mockReset(); outcome.mockReset(); refund.mockReset();
  refund.mockResolvedValue({ refunded: true, amount: 3 });
  resetLineageCache();
});

describe('AI 초안 과금 = 차감 확정 → 저장(무과금 초안 0) · 저장 실패 = 환불', () => {
  const base = { companyId: 'c', userId: 'u', cost: 3, chargeKey: 'journey-product:c:r#1' };
  it('차감되면 저장 · 차감액 · 차감은 확정 시점 잔액 판정을 던지게 부른다', async () => {
    outcome.mockResolvedValue('deducted');
    const save = vi.fn(async () => 'j-1');
    expect(await chargeThenSaveDraft({ ...base, save })).toEqual({ journeyId: 'j-1', charged: 3 });
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ source: 'journey-ai-generate', idempotencyKey: 'journey-product:c:r#1', throwOnInsufficient: true }));
    expect(outcome.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
    expect(refund).not.toHaveBeenCalled();
  });
  it('잔액 부족(동시 소진)이면 저장하지 않고 402 로 던진다', async () => {
    outcome.mockRejectedValue(new InsufficientCreditError('부족'));
    const save = vi.fn(async () => 'j-1');
    await expect(chargeThenSaveDraft({ ...base, save })).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(save).not.toHaveBeenCalled();
  });
  it('같은 시도 키가 먼저 과금됐으면 저장하지 않고 "이미 있음"', async () => {
    outcome.mockResolvedValue('duplicate');
    const save = vi.fn(async () => 'j-1');
    await expect(chargeThenSaveDraft({ ...base, save })).rejects.toThrow(DRAFT_ALREADY_MADE);
    expect(save).not.toHaveBeenCalled();
  });
  it('그 밖 실패 · 크레딧제 미적용 = 결과는 막지 않고 차감액 0', async () => {
    for (const o of ['failed', 'not_applicable', 'not_required']) {
      outcome.mockResolvedValueOnce(o);
      expect(await chargeThenSaveDraft({ ...base, save: async () => 'j' })).toEqual({ journeyId: 'j', charged: 0 });
    }
    expect(refund).not.toHaveBeenCalled();
  });
  it('저장이 실패하면 같은 시도 키로 환불하고 저장 오류를 그대로 던진다 · 차감 0 이면 환불 없음', async () => {
    outcome.mockResolvedValueOnce('deducted');
    await expect(chargeThenSaveDraft({ ...base, save: async () => { throw new Error('저장 실패'); } })).rejects.toThrow('저장 실패');
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'c', amount: 3, source: 'journey-ai-generate', idempotencyKey: 'journey-product:c:r#1:refund', originalIdempotencyKey: 'journey-product:c:r#1',
    }));
    refund.mockClear();
    outcome.mockResolvedValueOnce('not_applicable');
    await expect(chargeThenSaveDraft({ ...base, save: async () => { throw new Error('저장 실패'); } })).rejects.toThrow('저장 실패');
    expect(refund).not.toHaveBeenCalled();
  });
  it('환불이 실패해도 저장 오류를 던진다(환불 누락은 로그)', async () => {
    outcome.mockResolvedValueOnce('deducted');
    refund.mockRejectedValueOnce(new Error('db down'));
    await expect(chargeThenSaveDraft({ ...base, save: async () => { throw new Error('저장 실패'); } })).rejects.toThrow('저장 실패');
  });
  it('시도 키 = 원장이 진실: 처음 = #1 · 되돌리지 않은 차감이 있으면 거절 · 환불된 시도만 있으면 다음 번호', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    expect(await nextDraftChargeKey('c', 'journey-product:c:r')).toBe('journey-product:c:r#1');
    expect(q.mock.calls[0][1]).toEqual(['c', 'journey-product:c:r#%']);
    q.mockResolvedValueOnce({ rows: [{ idempotency_key: 'journey-product:c:r#1', type: 'deduct' }] });
    await expect(nextDraftChargeKey('c', 'journey-product:c:r')).rejects.toThrow(DRAFT_ALREADY_MADE);
    q.mockResolvedValueOnce({ rows: [
      { idempotency_key: 'journey-product:c:r#1', type: 'deduct' },
      { idempotency_key: 'journey-product:c:r#1:refund', type: 'refund' },
    ] });
    expect(await nextDraftChargeKey('c', 'journey-product:c:r')).toBe('journey-product:c:r#2');
    q.mockRejectedValueOnce(new Error('db down'));
    await expect(nextDraftChargeKey('c', 'journey-product:c:r')).rejects.toThrow('db down');
  });
  it('문장으로 만들기 · 상품 재구매 = 같은 CT · 요청 키에 회사 id · AI 전에 원장 확인 · 저장은 차감 CT 안에서', () => {
    for (const f of ['journey-interview-ai.ts', 'journey-product-create.ts']) {
      const s = SRC(f);
      expect(s).not.toContain('deductCreditSafe');
      expect(s).not.toMatch(/const journeyId = await saveJourneyPackageAsDraft/);
      expect(s).toContain('chargeThenSaveDraft({');
      expect(s).toMatch(/save: \(\) => saveJourneyPackageAsDraft\(/);
      expect(s.indexOf('await nextDraftChargeKey(input.companyId')).toBeLessThan(s.indexOf('runInCreditBundle(async'));
    }
    expect(SRC('journey-interview-ai.ts')).toContain('`journey-interview:${input.companyId}:${input.interviewId}:${plan.key}`');
    expect(SRC('journey-product-create.ts')).toContain('`journey-product:${input.companyId}:${input.requestId}`');
  });
});

describe('계보 컬럼 확인', () => {
  it('조회 중 들어온 호출은 같은 조회를 기다린다(먼저 거짓을 돌려주지 않는다)', async () => {
    let release!: (v: any) => void;
    q.mockImplementation(() => new Promise((r) => { release = r; }));
    const a = lineageColumnsReady();
    const b = lineageColumnsReady();
    release({ rows: [{ n: 2 }] });
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(q).toHaveBeenCalledTimes(1);
  });
  it('조회 오류는 던지고 기억하지 않는다(다음 호출이 다시 본다)', async () => {
    q.mockRejectedValueOnce(new Error('connection reset'));
    await expect(lineageColumnsReady()).rejects.toThrow('connection reset');
    q.mockResolvedValueOnce({ rows: [{ n: 2 }] });
    expect(await lineageColumnsReady()).toBe(true);
  });
  it('부재는 조회가 성공했을 때만 기억한다', async () => {
    q.mockResolvedValue({ rows: [{ n: 0 }] });
    expect(await lineageColumnsReady()).toBe(false);
    expect(await lineageColumnsReady()).toBe(false);
    expect(q).toHaveBeenCalledTimes(1);
  });
});

describe('옛 판 · 새 판', () => {
  it('닫기 문장은 켜는 판의 진입이 열려 있을 때만 다른 판을 닫는다', () => {
    expect(CLOSE_OTHER_VERSIONS_ENTRY_SQL).toContain('n.entry_closed_at IS NULL');
  });
  it('진입이 닫힌 옛 판에서는 새 판을 만들지 않는다', async () => {
    q.mockResolvedValue({ rows: [{ n: 2 }] });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 'OLD', name: '옛', status: 'active', archived_at: null, lineage_id: 'OLD', entry_closed_at: '2026-09-30T00:00:00Z' }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);
    await expect(createNewVersion('c', 'OLD')).rejects.toThrow('옛 판에서는 새 판을 만들 수 없어요');
    expect(client.query.mock.calls.some((c: any[]) => /INSERT INTO journeys/.test(String(c[0])))).toBe(false);
  });
});

describe('워커 배선(원문)', () => {
  const W = SRC('journey-trigger-watcher.ts');
  it('진입 교체 = 재진입 허용 + 시간 쿨다운이 지났을 때만 닫고 넣는다', () => {
    expect(W).toContain('usesEntryReplacement(j.trigger_filters) && j.allow_reentry === true');
    const block = between(W, 'if (replaceEntry) {', '} else {');
    expect(block.indexOf('cooldownElapsed(j, customerId, client)')).toBeGreaterThan(-1);
    expect(block.indexOf('cooldownElapsed(')).toBeLessThan(block.indexOf('CLOSE_ACTIVE_FOR_REPLACEMENT_SQL'));
  });
  it('구매 자격 판정은 플래너가 소비한 행만 본다', () => {
    const fn = between(W, 'async function qualifyPurchaseTransition', '\n}\n');
    expect(fn).toContain('fetched.slice(0, CDP_EVENT_CHUNK)');
    expect(W).toContain('planCdpCursorBatch(rows, CDP_EVENT_CHUNK, windowEnd, \'created_at\')');
  });
  it('재진입 워커 = 이력 · 진행 중 · 최신 판정을 계보 전체에서 · 넣는 곳은 이 판', () => {
    const R = SRC('journey-reentry-worker.ts');
    expect(R).toContain('const lineage = fresh.lineageIds;');   // ★ 3R — 계보는 진입 잠금 뒤 다시 읽은 목록
    expect((R.match(/journey_id = ANY\(\$5::uuid\[\]\)/g) || []).length).toBe(3);
    expect(R).toContain("gen_random_uuid(), $1::uuid, je.customer_id");
    expect(R).toContain('[journeyId, companyId, cooldownDays, PER_JOURNEY_BATCH_LIMIT, lineage]');
  });
  it('끝 칸 완료 = 발송비는 상태와 무관하게 · 완료 전환만 진행 중일 때', () => {
    const fn = between(SRC('journey-executor.ts'), 'async function completeAtEndStep', '\n}\n');
    expect(fn).toContain('total_cost = e.total_cost + $3');
    expect(fn).toContain("CASE WHEN prev.status = 'active' THEN 'completed' ELSE e.status END");
    expect(fn).not.toMatch(/WHERE id = \$1::uuid AND status = 'active'/);
    expect(fn).toContain('completed ? 1 : 0');
  });
});

describe('Codex 2라운드', () => {
  it('활성화는 계보 확인 오류를 삼키지 않는다(모르면 켜지 않는다)', () => {
    const b = SRC('journey-builder.ts');
    expect(b).not.toMatch(/lineageColumnsReady\(\)\.catch/);
    const act = between(b, 'let closeOthers: boolean;', 'const actClient');
    expect(act).toContain('closeOthers = await lineageColumnsReady();');
    expect(act).toContain("return { ok: false, reason: '여정 상태를 확인하지 못해 켜지 못했습니다.");
  });
  it('진입 잠금 = 트랜잭션 잠금 · 열쇠는 계보 뿌리(DDL 전 = 여정 id) · 잠금 뒤 같은 연결로 상태 · 계보를 다시 읽는다', async () => {
    const calls: string[] = [];
    const run = { query: vi.fn(async (sql: string) => { calls.push(sql); return /SELECT 1 FROM journeys/.test(sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] }; }) };
    q.mockResolvedValue({ rows: [{ n: 0 }] });
    expect(await lockLineageEntry(run, 'J')).toEqual({ open: true, lineageIds: ['J'] });
    expect(calls[0]).toContain("pg_advisory_xact_lock(hashtext('journey-entry'), hashtext((id)::text))");
    resetLineageCache(true);
    const run2 = { query: vi.fn(async (sql: string) => {
      calls.push(sql);
      return /ARRAY\(SELECT j2\.id/.test(sql) ? { rows: [{ entry_closed_at: null, lineage: ['OLD', 'J'] }] } : { rows: [] };
    }) };
    expect(await lockLineageEntry(run2, 'J')).toEqual({ open: true, lineageIds: ['J', 'OLD'] });
    expect(calls.some((c) => c.includes('hashtext((COALESCE(lineage_id, id))::text)'))).toBe(true);
    // 잠금이 먼저, 상태 읽기가 뒤(같은 연결)
    expect(run2.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    const closed = { query: vi.fn(async (sql: string) => (/ARRAY\(SELECT j2\.id/.test(sql) ? { rows: [{ entry_closed_at: '2026-09-30', lineage: ['J'] }] } : { rows: [] })) };
    expect((await lockLineageEntry(closed, 'J')).open).toBe(false);
    const gone = { query: vi.fn(async () => ({ rows: [] })) };
    expect((await lockLineageEntry(gone, 'J')).open).toBe(false);
  });
  it('진입 워커 두 문 · 재진입 워커 = BEGIN 바로 뒤 잠금 → 닫혔으면 넣지 않음 → 다시 읽은 계보 · 재진입은 넣기와 합계가 한 트랜잭션', () => {
    const W = SRC('journey-trigger-watcher.ts');
    const locks = W.match(/const fresh = await lockLineageEntry\(client, j\.id\);\r?\n\s+if \(!fresh\.open\) \{\r?\n\s+await client\.query\('ROLLBACK'\);/g) || [];
    expect(locks.length).toBe(2);
    expect((W.match(/j\.lineageIds = fresh\.lineageIds;/g) || []).length).toBe(2);
    const enq = between(W, 'async function enqueueCandidates', '\n}\n');
    expect(enq.indexOf('const fresh = await lockLineageEntry')).toBeLessThan(enq.indexOf('const journeyMatch'));
    const R = SRC('journey-reentry-worker.ts');
    expect(R).toMatch(/await client\.query\('BEGIN'\);[\s\S]{0,400}const fresh = await lockLineageEntry\(client, journeyId\);\r?\n\s+const lineage = fresh\.lineageIds;\r?\n\s+if \(!fresh\.open\) throw new EntryClosedSkip\(\);\r?\n\s+const r = await client\.query\(/);
    expect(R).toContain('if (!(txErr instanceof EntryClosedSkip)) throw txErr;');
    const tx = between(R, "await client.query('BEGIN');", "await client.query('COMMIT');");
    expect(tx).toContain('UPDATE journeys SET');
    expect(tx).not.toMatch(/\bawait query\(/);
  });
});

describe('Codex 3라운드', () => {
  it('새 판 활성화 = 잠금이 UPDATE 앞 · 커서 이어받기가 닫기 앞(같은 트랜잭션)', () => {
    const b = SRC('journey-builder.ts');
    const act = between(b, 'let closeOthers: boolean;', 'if (r.rows.length === 0) {');
    const lock = act.indexOf('await lockLineageEntry(actClient, journeyId);');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(act.indexOf('`UPDATE journeys SET'));
    expect(act.indexOf('INHERIT_ENTRY_CURSORS_SQL')).toBeGreaterThan(-1);
    expect(act.indexOf('INHERIT_ENTRY_CURSORS_SQL')).toBeLessThan(act.indexOf('CLOSE_OTHER_VERSIONS_ENTRY_SQL'));
    // ★ 4R — 이어받을 판이 둘 이상이면 닫지 않고 되돌린다(활성화 실패로 알린다).
    expect(act).toContain("if (Number(inh.rows[0]?.sources || 0) > 1) inheritConflict = true;");
    expect(act).toContain("await actClient.query(inheritConflict ? 'ROLLBACK' : 'COMMIT');");
    expect(between(b, 'if (inheritConflict) {', 'if (r.rows.length === 0) {')).toContain('return { ok: false');
  });
  it('커서 이어받기 = 처음 켜지는 새 판만 · 켜진 옛 판 · 같은 시작 사건 · 같은 회사 · 같은 계보 · 커서 네 칸', () => {
    for (const frag of [
      'n.last_event_cursor IS NULL AND n.last_purchase_cursor IS NULL',
      "o.status = 'active' AND o.entry_closed_at IS NULL AND o.trigger_event = n.trigger_event",
      'o.lineage_id = n.lineage_id AND o.company_id = n.company_id AND o.id <> n.id',
      'last_event_cursor = s.last_event_cursor', 'last_event_cursor_id = s.last_event_cursor_id',
      'last_purchase_cursor = s.last_purchase_cursor', 'last_purchase_cursor_id = s.last_purchase_cursor_id',
      // ★ 4R — 정확히 하나일 때만 옮기고, 원본 수를 돌려준다
      'WHERE t.id = $1::uuid AND (SELECT COUNT(*) FROM src) = 1',
      'SELECT (SELECT COUNT(*) FROM src)::int AS sources',
    ]) expect(INHERIT_ENTRY_CURSORS_SQL).toContain(frag);
  });
});
