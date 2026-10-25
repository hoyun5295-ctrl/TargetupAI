/**
 * 여정 V.3 묶음 7 — 기존 고객 받기 · 새 고객 받는 마지막 날(2026-10-20 · 설계서 §8-1 · §11)
 *
 * 못 박는 것:
 *   - 휴면 시작 「이미 쉬고 있는 고객도 받기」(include_existing) = 기준일 + 7일 창의 위쪽 끝을 없앤다(최근에 쉰 순)
 *   - 하루 몫(backfill_per_day) = 상한과 다른 값 · KST 하루 진입이 하루 몫을 넘지 않게 나눠 받고, 상한 초과로 여정 전체를 멈추지 않는다
 *   - 「새 고객 받는 마지막 날」(entry_ends_on) = 진입 판정 두 곳(목록 조각 · 잠금 뒤 판정)이 같이 본다 · 칸이 없으면 옛 동작
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');

describe('휴면 · 이미 쉬고 있는 고객도 받기', () => {
  it('include_existing 이면 기준일 + 7일 위쪽 끝이 빠진다 · 아니면 그대로 · 위쪽 끝 값은 쓸 때만 싣는다(★ Codex 적대 A5 · 안 쓰는 $3 = PG 형 오류)', () => {
    const src = SRC('journey-target-extractor.ts');
    const block = src.slice(src.indexOf("case 'customer.dormant': {"), src.indexOf("case 'customer.dormant': {") + 3000);
    expect(block).toContain('const includeExisting = filters.include_existing === true;');
    expect(block).toContain('const params: any[] = [companyId, String(d)];');
    expect(block).toMatch(/if \(!includeExisting\) \{\s*params\.push\(String\(d \+ 7\)\);\s*upperBound = `AND c\.recent_purchase_date > \(\$\{KST_TODAY_DATE_SQL\} - \(\$\$\{params\.length\} \|\| ' days'\)::interval\)`;/);
    expect(block).toContain('${upperBound}');
    expect(block).not.toContain("($3 || ' days')");
    expect(block).toContain('ORDER BY c.recent_purchase_date DESC');
  });
});

describe('하루 몫', () => {
  it('하루 몫 판정(순수) = 상시 · 휴면만 · 1 이상일 때', async () => {
    const { backfillPerDayOf } = await import('../journey-trigger-watcher');
    expect(backfillPerDayOf({ trigger_event: 'custom', trigger_filters: { backfill_per_day: 500 } } as any)).toBe(500);
    expect(backfillPerDayOf({ trigger_event: 'customer.dormant', trigger_filters: { backfill_per_day: 300 } } as any)).toBe(300);
    expect(backfillPerDayOf({ trigger_event: 'cdp.purchase', trigger_filters: { backfill_per_day: 300 } } as any)).toBeNull();
    expect(backfillPerDayOf({ trigger_event: 'custom', trigger_filters: { backfill_per_day: 0 } } as any)).toBeNull();
    expect(backfillPerDayOf({ trigger_event: 'custom', trigger_filters: {} } as any)).toBeNull();
  });
  it('감시 = 오늘 들어온 수를 세어 남은 몫만 · 하루 몫이 있으면 상한 초과 멈춤 대신 나눠 받는다', () => {
    const src = SRC('journey-trigger-watcher.ts');
    const at = src.indexOf('const backfill = backfillPerDayOf(j);');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 4200);   // 1020 V.3 18: after branch sits between
    expect(block).toContain('await countEnteredTodayKst(j.id)');
    expect(block).toMatch(/if \(room <= 0\) return \{ matched: 0, enqueued: 0, skipped: 0 \};/);
    expect(block).toContain('if (entryCapExceeded(cap, backfill, ids.length)) {');
  });
});

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

describe('새 고객 받는 마지막 날', () => {
  let q: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const db: any = await import('../../config/database');
    q = db.query;
    q.mockReset();
    const lin: any = await import('../journey-lineage');
    lin.resetLineageCache(true);
    lin.resetEntryEndsCache?.(undefined);
  });
  it('칸이 있으면 목록 조각에 마지막 날 조건이 붙는다', async () => {
    q.mockImplementation(async (sql: string) => (/column_name = 'entry_ends_on'/.test(sql) ? { rows: [{ n: 1 }] } : { rows: [] }));
    const { entryOpenClause } = await import('../journey-lineage');
    const c = await entryOpenClause('j');
    expect(c).toContain('j.entry_closed_at IS NULL');
    expect(c).toContain("(j.entry_ends_on IS NULL OR j.entry_ends_on >= (NOW() AT TIME ZONE 'Asia/Seoul')::date)");
  });
  it('칸이 없으면 옛 조각 그대로', async () => {
    q.mockImplementation(async (sql: string) => (/column_name = 'entry_ends_on'/.test(sql) ? { rows: [{ n: 0 }] } : { rows: [] }));
    const lin: any = await import('../journey-lineage');
    lin.resetEntryEndsCache(false);
    const c = await lin.entryOpenClause('j');
    expect(c).toBe(' AND j.entry_closed_at IS NULL');
  });
  it('잠금 뒤 판정도 같은 조건(지난 날이면 닫힘)', () => {
    const src = SRC('journey-lineage.ts');
    const fn = src.slice(src.indexOf('export async function lockLineageEntry'), src.indexOf('/** 여정 목록 WHERE 에 붙이는'));
    expect(fn).toContain("ENTRY_ENDS_OPEN_SQL('j')");
    expect(fn).toContain('ends_passed !== true');
  });
  it('옵션 입력 = YYYY-MM-DD 또는 비움(null)', async () => {
    const { normalizeJourneyOptions } = await import('../journey-options-validator');
    expect(normalizeJourneyOptions({ entryEndsOn: '2026-12-31' }).options.entryEndsOn).toBe('2026-12-31');
    expect(normalizeJourneyOptions({ entryEndsOn: '' }).options.entryEndsOn).toBeNull();
    expect(normalizeJourneyOptions({ entryEndsOn: '2026-13-01' }).options.entryEndsOn).toBeNull();
    expect(normalizeJourneyOptions({ entryEndsOn: 'abc' }).options.entryEndsOn).toBeNull();
  });
});
