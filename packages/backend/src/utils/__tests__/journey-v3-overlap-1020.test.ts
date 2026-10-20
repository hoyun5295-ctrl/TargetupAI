/**
 * 여정 V.3 묶음 2 · 3 — 겹침 판정 한 곳 · 「돌아온 고객은 환영만」 · 하나씩 켜기 겹침 확인(2026-10-20 · 설계서 §6-4 · §8-2)
 *
 * 같은 구매 한 건에 두 여정이 함께 시작되는 쌍(계약 overlapEvents):
 *   주문 완료 ↔ 첫 구매 · 주문 완료 ↔ 휴면 복귀 · 상품 ↔ 주문 완료 등.
 * 해소 옵션: 주문 완료 여정의 첫 구매 빼기(exclude_first_purchase) · 돌아온 고객은 환영만(exclude_dormant_return).
 */
import { describe, it, expect } from 'vitest';
import { computeOverlapPairs } from '../journey-lifecycle-map';
import { normalizeJourneyOptions } from '../journey-options-validator';
import { journeyOptionEditVerdict } from '../journey-step-edit-policy';

const J = (id: string, triggerEvent: string) => ({ id, triggerEvent });

describe('computeOverlapPairs (순수)', () => {
  it('주문 완료 · 휴면 복귀 · 첫 구매가 다 있으면 쌍 2개(주문 완료 기준)', () => {
    const pairs = computeOverlapPairs([J('order', 'cdp.purchase'), J('back', 'customer.dormant_return'), J('first', 'purchase.first')], new Map());
    const keys = pairs.map((p) => [p.a, p.b].sort().join('|')).sort();
    expect(keys).toContain(['back', 'order'].sort().join('|'));
    expect(keys).toContain(['first', 'order'].sort().join('|'));
  });
  it('첫 구매 빼기 = 첫 구매와의 쌍만 빠진다', () => {
    const pairs = computeOverlapPairs([J('order', 'cdp.purchase'), J('back', 'customer.dormant_return'), J('first', 'purchase.first')],
      new Map([['order', { exclude_first_purchase: true }]]));
    const keys = pairs.map((p) => [p.a, p.b].sort().join('|'));
    expect(keys).not.toContain(['first', 'order'].sort().join('|'));
    expect(keys).toContain(['back', 'order'].sort().join('|'));
  });
  it('돌아온 고객은 환영만 = 휴면 복귀와의 쌍이 빠진다', () => {
    const pairs = computeOverlapPairs([J('order', 'cdp.purchase'), J('back', 'customer.dormant_return')],
      new Map([['order', { exclude_dormant_return: true }]]));
    expect(pairs.map((p) => [p.a, p.b].sort().join('|'))).not.toContain(['back', 'order'].sort().join('|'));
  });
  it('같은 쌍은 한 번만', () => {
    const pairs = computeOverlapPairs([J('order', 'cdp.purchase'), J('back', 'customer.dormant_return')], new Map());
    expect(pairs.length).toBe(1);
  });
});

describe('옵션 입력 · 판정', () => {
  it('돌아온 고객은 환영만 · 기존 고객 받기 · 하루 몫 · 조건 · 전체 고객 신호를 받는다', () => {
    const n = normalizeJourneyOptions({
      exclude_dormant_return: true, include_existing: 'true', backfill_per_day: 500,
      customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'OR', all_customers: true,
    });
    expect(n.triggerFilters).toMatchObject({
      exclude_dormant_return: true, include_existing: true, backfill_per_day: 500,
      customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'OR', all_customers: true,
    });
  });
  it('하루 몫은 1~100,000 · 비우면 null', () => {
    expect(normalizeJourneyOptions({ backfill_per_day: 0 }).triggerFilters.backfill_per_day).toBe(1);
    expect(normalizeJourneyOptions({ backfill_per_day: 9999999 }).triggerFilters.backfill_per_day).toBe(100000);
    expect(normalizeJourneyOptions({ backfill_per_day: '' }).triggerFilters.backfill_per_day).toBeNull();
  });
  it('켜진 여정에서 겹침 해소를 끄면 겹침 확인을 요구 · 켜면 요구 안 함', () => {
    expect(journeyOptionEditVerdict('active', { exclude_dormant_return: false })).toEqual({ ok: true, keepMarker: true, overlapCheck: true });
    expect(journeyOptionEditVerdict('active', { exclude_first_purchase: false })).toEqual({ ok: true, keepMarker: true, overlapCheck: true });
    expect(journeyOptionEditVerdict('active', { exclude_dormant_return: true })).toEqual({ ok: true, keepMarker: true });
    expect(journeyOptionEditVerdict('paused', { exclude_dormant_return: false })).toEqual({ ok: true, keepMarker: true });
  });
});

describe('돌아온 고객은 환영만 — 감시 · 문구 · 계약', () => {
  it('대상 문구', async () => {
    const { describeJourneyTarget } = await import('../journey-step-format');
    expect(describeJourneyTarget('cdp.purchase', { exclude_dormant_return: true })).toBe('대상: 휴면에서 돌아온 고객 제외 · 이 사건이 생긴 고객');
    expect(describeJourneyTarget('cdp.purchase', { exclude_first_purchase: true, exclude_dormant_return: true })).toBe('대상: 첫 구매 고객 제외 · 휴면에서 돌아온 고객 제외 · 이 사건이 생긴 고객');
  });
  it('감시 = 주문 완료 여정만 · 켜진 휴면 복귀 여정의 가장 짧은 기준일로 · 직전 구매가 그 기준 이상 과거면 이번 구매에서 뺀다', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'journey-trigger-watcher.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('async function qualifyPurchaseTransition('), src.indexOf('async function finishCursorBatch('));
    expect(fn).toContain("j.trigger_event === 'cdp.purchase' && (j.trigger_filters || {}).exclude_dormant_return === true");
    expect(fn).toContain('loadDormantReturnDays(j.company_id)');
    expect(fn).toMatch(/excludeDormantDays != null[\s\S]*at - new Date\(last\)\.getTime\(\) >= excludeDormantDays \* 24 \* 3600 \* 1000/);
  });
  it('계약 = 휴면 복귀 다음 사건에 주문 완료(돌아온 고객 → 단골 재구매 선)', async () => {
    const { nextTriggerEvents } = await import('../journey-trigger-capability');
    expect(nextTriggerEvents('customer.dormant_return')).toContain('cdp.purchase');
  });
});
