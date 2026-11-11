/**
 * C123 여정 재진입 대기 최솟값(뿌리 R87) — 단위 · 소스 계약
 * (★ 2026-11-10 설계서 docs/2026-11-10-journey-reentry-floor-design.md §4 · §6 T3 · Codex 설계 2R approve)
 *
 * 옛: 최솟값이 계약의 선택 칸이라 휴면 전환 · 포인트 소멸 · 생일 여정과 자동 재진입 워커에서 대기 0일이 통과했다
 *   → 상태가 유지되는 동안 같은 고객이 끝나는 대로 다시 들어왔다(반복 발송 · 과금).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, mysqlQuery: vi.fn(), mysqlPool: {} }));

import {
  TRIGGER_CONTRACTS, DORMANT_ENTRY_WINDOW_DAYS, AFTER_JOURNEY_EVENT, reentryFloorDays, autoReentryFloorDays, contractReentryPolicy,
} from '../journey-trigger-capability';
import { resolveCdpCursorEventName } from '../journey-cdp-cursor';
import { buildJourneyTargetQuery } from '../journey-target-extractor';
import { reentryHoldSql, buildReentryAntiJoin } from '../journey-safety-filter';
import { validateJourneyEntryConfig } from '../journey-builder';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const base = { trigger_filters: {}, threshold_recipients_per_step: null as number | null };

describe('계약 = 재진입 대기 최솟값을 읽는 함수 둘', () => {
  it('휴면 전환 = 휴면 창 길이(7일) · 생일 · 포인트 소멸 · 신규 가입 = 1 · 사건형 · 고른 고객에게 = 0', () => {
    expect(DORMANT_ENTRY_WINDOW_DAYS).toBe(7);
    expect(reentryFloorDays('customer.dormant')).toBe(7);
    for (const ev of ['customer.birthday_approaching', 'customer.points_expiring', 'customer.created', 'customer.cycle_lapsed', 'customer.grade_changed', 'cdp.cart_abandon', 'cdp.browse_no_purchase']) {
      expect(reentryFloorDays(ev), ev).toBe(1);
    }
    for (const ev of ['cdp.purchase', 'purchase.first', 'purchase.product', 'customer.dormant_return', 'cdp.reservation_created', 'custom_order_shipped', 'journey.after', 'custom']) {
      expect(reentryFloorDays(ev), ev).toBe(0);
    }
  });
  it('모르는 시작 사건 = 1(덜 보내는 쪽) · 자동으로 다시 받기 = 사건형이어도 최소 1일', () => {
    expect(reentryFloorDays('no.such.event')).toBe(1);
    expect(reentryFloorDays(null)).toBe(1);
    expect(autoReentryFloorDays('cdp.purchase')).toBe(1);
    expect(autoReentryFloorDays('customer.dormant')).toBe(7);
    expect(autoReentryFloorDays('custom')).toBe(1);   // 고른 고객에게 = 자동 재진입만 반복의 길 → 최소 1일
  });
  it('사건형 초안의 재진입 값(계약이 정한다) = 그대로 0', () => {
    expect(contractReentryPolicy('cdp.purchase')).toEqual({ allowReentry: true, cooldownDays: 0 });
  });
  it('모든 계약이 최솟값을 수로 선언한다', () => {
    for (const c of TRIGGER_CONTRACTS) expect(typeof c.cooldownMinDays, c.event).toBe('number');
  });
});

describe('실행 시점 조각 reentryHoldSql · 뽑기 안티조인', () => {
  // ★ 2026-11-11 C126 — 미완료 = 진행 중 + 멈춤(D1) · 저장 대기일도 끝난 뒤 기준 한 갈래(D4) · 자세한 사례 = journey-recheck-1111.test.ts
  it('최솟값 0 = 미완료만(진행 중 · 멈춤) · 1 이상 = 미완료 또는 끝난 지 최솟값 안', () => {
    expect(reentryHoldSql('je', 0)).toBe("je.status IN ('active', 'paused')");
    expect(reentryHoldSql('je', 7)).toBe("(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '7 days')");
  });
  it('안티조인: 최솟값 0 · 대기 0 = 미완료만 · 대기 30 = 끝난 뒤 30일(옛: 들어온 뒤 30일 · 바인드 둘)', () => {
    const p0: any[] = [];
    expect(buildReentryAntiJoin('c', p0, 'J', true, 0, 0))
      .toBe("AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id AND je.status IN ('active', 'paused'))");
    const p1: any[] = [];
    expect(buildReentryAntiJoin('c', p1, 'J', true, 30, 0))
      .toBe("AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id AND (je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '30 days'))");
    expect(p1).toEqual(['J']);
  });
  it('안티조인: 대기일 = max(최솟값, 저장 대기일) 하나(대기 0 · 최솟값 7 = 7일 · 대기 90 · 최솟값 7 = 90일)', () => {
    const hold = (n: number) => `(je.status IN ('active', 'paused') OR COALESCE(je.completed_at, je.entered_at) > NOW() - INTERVAL '${n} days')`;
    expect(buildReentryAntiJoin('c', [], 'J', true, 0, 7)).toContain(`AND ${hold(7)})`);
    expect(buildReentryAntiJoin('c', [], 'J', true, 90, 7)).toContain(`AND ${hold(90)})`);
    expect(buildReentryAntiJoin('c', [], 'J', true, 90, 7)).not.toMatch(/je\.entered_at > NOW\(\)/);
  });
  it('재진입 불가 = 그대로(실행이 하나라도 있으면 제외 · 최솟값 무관)', () => {
    expect(buildReentryAntiJoin('c', [], 'J', false, 0, 7))
      .toBe('AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id)');
  });
});

describe('저장 · 켜기 검증(validateJourneyEntryConfig)', () => {
  it('휴면 전환 + 재진입 0일 = 거절(최소 7일) · 7일 = 통과', () => {
    const r = validateJourneyEntryConfig({ ...base, trigger_event: 'customer.dormant', allow_reentry: true, reentry_cooldown_days: 0 });
    expect(r).toContain('최소 7일');
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.dormant', allow_reentry: true, reentry_cooldown_days: 7 })).toBeNull();
  });
  it('생일 + 재진입 0일 = 거절(최소 1일) · 재진입 꺼짐 = 통과', () => {
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.birthday_approaching', allow_reentry: true, reentry_cooldown_days: null })).toContain('최소 1일');
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.birthday_approaching', allow_reentry: false, reentry_cooldown_days: 0 })).toBeNull();
  });
  it('주문 완료 + 재진입 0일 = 통과(사건마다 한 번) · 자동으로 다시 받기를 켜면 최소 1일', () => {
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'cdp.purchase', allow_reentry: true, reentry_cooldown_days: 0 })).toBeNull();
    const r = validateJourneyEntryConfig({ ...base, trigger_event: 'cdp.purchase', allow_reentry: true, reentry_cooldown_days: 0, auto_reentry_enabled: true });
    expect(r).toContain('자동으로 다시 받기');
    expect(r).toContain('최소 1일');
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'cdp.purchase', allow_reentry: true, reentry_cooldown_days: 1, auto_reentry_enabled: true })).toBeNull();
  });
  it('재진입 값을 정하지 않는 저장(reentry_touched 거짓) = 미달 저장값으로 거절하지 않는다(끄기 · 무관 옵션 · Codex 설계 1R #3)', () => {
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.dormant', allow_reentry: true, reentry_cooldown_days: 0, auto_reentry_enabled: true, reentry_touched: false })).toBeNull();
    // 켜기(값 없음 = 늘 검사)
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.dormant', allow_reentry: true, reentry_cooldown_days: 0 })).not.toBeNull();
  });
});

describe('R87 방어값이 손 등재(선택 칸)라 등재 안 된 자리에서 빈다 — 재진입 대기 최솟값', () => {
  it('계약 전수: 최솟값 0 = 한 번만 들어오는 시작(사건 커서 · 앞 여정을 마치면 · 고른 고객에게)뿐 · 그 밖 = 1 이상 · 휴면 전환 = 휴면 창 상수', () => {
    for (const c of TRIGGER_CONTRACTS) {
      const keyed = resolveCdpCursorEventName(c.event) !== null || c.event === AFTER_JOURNEY_EVENT || c.event === 'custom';
      if (keyed) expect(c.cooldownMinDays, c.event).toBeGreaterThanOrEqual(0);
      else expect(c.cooldownMinDays, `${c.event} = 상태가 유지되는 시작 사건 · 최솟값 0 이면 끝나는 대로 다시 들어온다`).toBeGreaterThanOrEqual(1);
    }
    expect(TRIGGER_CONTRACTS.find((c) => c.event === 'customer.dormant')?.cooldownMinDays).toBe(DORMANT_ENTRY_WINDOW_DAYS);
  });
  // ★ Codex 구현 2R — 소스 글자가 아니라 실제 뽑기 함수의 SQL 로 본다(조건 하나로 감싸도 글자는 남는다): 재진입 허용 여부 · 대기 0 / 양수 · 최솟값 · 단일 / 계보 조합 전수
  it('고른 고객에게 = 최솟값 0 의 근거: 대상 뽑기가 재진입 설정과 무관하게 실행이 하나라도 있으면 뺀다(상태 조건 없음 · 계보면 계보 전체)', async () => {
    const one = 'AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $2::uuid AND je.customer_id = c.id)';
    const many = 'AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = ANY($2::uuid[]) AND je.customer_id = c.id)';
    for (const allowReentry of [true, false]) for (const cooldownDays of [0, 30]) for (const floorDays of [0, 1]) for (const lineageIds of [undefined, ['J'], ['J', 'OLD']]) {
      const q = await buildJourneyTargetQuery('CO', 'custom', { all_customers: true }, 100, 'J', { allowReentry, cooldownDays, floorDays, lineageIds }, '', undefined);
      const lineage = !!lineageIds && lineageIds.length > 1;
      const tag = JSON.stringify({ allowReentry, cooldownDays, floorDays, lineageIds });
      expect(q!.sql, tag).toContain(lineage ? many : one);
      expect(q!.sql, tag).not.toMatch(/je\.status|je\.entered_at|je\.completed_at/);   // 진행 중 · 대기일로 좁히지 않는다 = 끝난 실행도 뺀다
      expect(q!.params[1], tag).toEqual(lineage ? lineageIds : 'J');
    }
    const q0 = await buildJourneyTargetQuery('CO', 'custom', { all_customers: true }, 100, 'J');   // 재진입 인자 없이도 같다
    expect(q0!.sql).toContain(one);
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'custom', trigger_filters: { all_customers: true }, allow_reentry: true, reentry_cooldown_days: 0 })).toBeNull();   // 템플릿 기본(재진입 켬 · 0일) = 켜진다
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'custom', trigger_filters: { all_customers: true }, allow_reentry: true, reentry_cooldown_days: 0, auto_reentry_enabled: true })).toContain('최소 1일');
  });

  // 실행을 넣는 자리 = 소스에서 기계로 뽑는다(시험 파일 제외) · 자리마다 분류 하나 · 분류 없는 새 자리 = 실패
  const SRC = join(__dirname, '..', '..');
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('__tests__/'));
  const sites = files.flatMap((f) => {
    const n = (src(f).match(/INSERT INTO journey_executions\b/g) || []).length;
    return n > 0 ? [`${f}:${n}`] : [];
  }).sort();
  it('실행을 넣는 자리 전수 = 분류된 다섯(파일 셋)', () => {
    expect(sites).toEqual(['utils/journey-anchor-scheduler.ts:2', 'utils/journey-reentry-worker.ts:1', 'utils/journey-trigger-watcher.ts:2']);
  });
  it('진입 감시 묶음 넣기 = 공용 조각(reentryHoldSql · 계약 최솟값) · 사건 커서 넣기 = finishCursorBatch 한 곳(사건 키로 한 번)', () => {
    const w = src('utils/journey-trigger-watcher.ts');
    expect(w).toContain('const reentryGuard = j.allow_reentry && !entersOncePerCustomer(j.trigger_event)');
    expect(w).toContain("? `AND ${reentryHoldSql('je', reentryWaitDays(reentryFloorDays(j.trigger_event), j.reentry_cooldown_days))}` : ``;");
    const enqueue = w.slice(w.indexOf('async function enqueueCandidates('), w.indexOf('async function checkCooldown('));
    expect(enqueue).toContain('WHERE ${journeyMatch} AND je.customer_id = t.cid ${reentryGuard}');
    expect(enqueue).not.toMatch(/je\.status = 'active'/);   // 재진입 판정을 조각 밖에서 따로 쓰지 않는다
    expect((w.match(/INSERT_EXECUTION_SQL/g) || []).length).toBe(2);   // 선언 1 + 쓰는 곳 1
    const cursor = w.slice(w.indexOf('async function finishCursorBatch('), w.indexOf('async function processPurchaseLedgerJourney('));
    expect(cursor).toContain('await client.query(INSERT_EXECUTION_SQL,');
    expect(cursor).toContain('triggerEntryUsedSql(');
  });
  it('자동 재진입 워커 = 재진입 허용 여정만 · 최솟값 = 공용 조각 한 곳(계보 전체 실행) · 저장값 바인드($2)는 옛 그대로(시간 비교 · 목표 달성 자격)', () => {
    const k = src('utils/journey-reentry-worker.ts');
    expect(k).toContain('AND allow_reentry = true');
    expect(k).toContain("AND ${reentryHoldSql('je2', holdDays)}");
    expect(k).toContain("const holdDays = reentryWaitDays(autoReentryFloorDays(String(j.trigger_event || '')), j.reentry_cooldown_days);");
    expect(k).toContain("AND (je.status = 'completed' OR (je.status = 'goal_met' AND $2 > 0))");
    expect(k).toContain("AND je.completed_at <= NOW() - ($2 * INTERVAL '1 day')");
    expect(k).toContain('[companyId, cooldownDays, pickLimit, lineage]');
    expect(k).not.toMatch(/je2\.status = 'active'/);
  });
  it('날짜 기준 = 표식 표 멱등 · 한 번 보내기 = 넣기 전 「이미 넣음」 확인(재진입 값과 무관한 면제의 근거)', () => {
    const a = src('utils/journey-anchor-scheduler.ts');
    const anchor = a.slice(a.indexOf('export async function dispatchAnchorStep('), a.indexOf('export async function dispatchOneShotJourney('));
    expect(anchor).toContain('INSERT INTO journey_anchor_dispatch (journey_id, step_id, customer_id, send_date)');
    expect(anchor).toContain('ON CONFLICT (journey_id, step_id, customer_id, send_date) DO NOTHING');
    expect(anchor).toContain('FROM claimed cl');
    const oneShot = a.slice(a.indexOf('export async function dispatchOneShotJourney('), a.indexOf('async function markOneShotDispatched('));
    expect(oneShot).toContain('const again = await client.query(`SELECT 1 FROM journey_executions WHERE journey_id = $1::uuid LIMIT 1`, [journeyId]);');
  });
  it('계약 칸을 직접 읽는 파일 = 계약 CT 하나(다른 파일은 reentryFloorDays · autoReentryFloorDays 만)', () => {
    const readers = files.filter((f) => /\.cooldownMinDays\b/.test(src(f)));
    expect(readers).toEqual(['utils/journey-trigger-capability.ts']);
  });
});

describe('소스 계약 — 최솟값을 거는 자리', () => {
  const route = src('routes/ai.ts');
  const patch = route.slice(route.indexOf("router.patch('/operator/journeys/:id/options'"), route.indexOf("router.get('/operator/journeys-data-capability'"));
  it('옵션 저장: 재진입 값을 정하는 요청만 최솟값 검사(reentry_touched) · 재진입을 끄면 자동도 같이 끈다', () => {
    expect(patch).toContain("const reentryTouched = ('allowReentry' in body && norm.options.allowReentry === true) || 'reentryCooldownDays' in body\n      || ('autoReentryEnabled' in body && norm.options.autoReentryEnabled === true);");
    expect(patch).toContain('reentry_touched: reentryTouched,');
    expect(patch).toContain("const reentryOff = 'allowReentry' in body && norm.options.allowReentry === false;");
    expect(patch).toContain("if (reentryOff) add('auto_reentry_enabled', false);\n    else if ('autoReentryEnabled' in body) add('auto_reentry_enabled', norm.options.autoReentryEnabled);");
  });
  it('켜기: 여정 행의 자동 재진입 칸을 검증에 넘긴다(reentry_touched 없음 = 늘 검사)', () => {
    const b = src('utils/journey-builder.ts');
    const call = b.slice(b.indexOf('const entryIssue = validateJourneyEntryConfig({'), b.indexOf('if (entryIssue) return entryIssue;'));
    expect(call).toContain('auto_reentry_enabled: row.auto_reentry_enabled === true,');
    expect(call).not.toContain('reentry_touched');
  });
  it('만들기: 재진입 허용이면 대기일을 계약 최솟값으로 올린다(AI · 템플릿 초안)', () => {
    const b = src('utils/journey-builder.ts');
    const create = b.slice(b.indexOf('export async function createJourneyFromTemplate('), b.indexOf('INSERT INTO journeys ('));
    expect(create).toContain('if (allowReentry) reentryCooldownDays = Math.max(Number(reentryCooldownDays || 0), reentryFloorDays(resolvedTriggerEvent));');
  });
  it('진입 입력 CT 가 시작 사건을 읽어 최솟값을 싣는다 · 뽑기 갈래는 그 값을 안티조인에 넘긴다', () => {
    const ext = src('utils/journey-target-extractor.ts');
    const ct = ext.slice(ext.indexOf('export async function journeyEntryInputs('), ext.indexOf('export async function countJourneyTargetsWithGrace('));
    expect(ct).toContain('floorDays: reentryFloorDays(');
    const calls = ext.match(/buildReentryAntiJoin\([^)]*\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const c of calls) expect(c, c).toContain('reentry.cooldownDays, reentry.floorDays, reentry.lineageIds');
  });
  it('휴면 창 길이 = 계약 상수 한 곳(대상 뽑기의 위 끝과 최솟값이 같은 상수)', () => {
    const ext = src('utils/journey-target-extractor.ts');
    expect(ext).toContain('params.push(String(d + DORMANT_ENTRY_WINDOW_DAYS));');
    expect(ext).not.toContain('params.push(String(d + 7));');
  });
  it('화면: 대기 칸 최솟값 = 서버가 준 값 · 자동 설명 = 1시간마다', () => {
    const card = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'journey', 'workspace', 'JourneyStartCard.tsx'), 'utf8');
    expect(card).toContain('1시간마다');
    expect(card).not.toContain('6시간마다');
    expect(card).toContain('reentryMinOf(journey, form)');
  });
});
