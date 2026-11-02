/**
 * 여정 발송 두 갈래 · 묶음 발송 — 순수 · 계약 시험(★ 2026-11-02 설계서 docs/2026-11-02-journey-batch-send-design.md)
 *   3-1 트리거 계약 갈래(sendTiming) · 3-2 하루 묶음 첫 칸 시각(dailyFirstRunAt · firstRunAtFor).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TRIGGER_CONTRACTS, sendTimingForTrigger, sendTimingLine } from '../journey-trigger-capability';
import { dailyFirstRunAt, firstRunAtFor, calculateNextRunAt } from '../send-time-util';

const SRC = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
/** KST 벽시계 → UTC Date */
const kst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi, s));

describe('3-1 트리거 계약 = 발송 갈래 강제(설계서 표 그대로)', () => {
  const EXPECT: Record<string, 'immediate' | 'daily'> = {
    'purchase.first': 'immediate', 'cdp.purchase': 'immediate', 'purchase.product': 'immediate', 'customer.dormant_return': 'immediate',
    'custom_order_shipped': 'immediate', 'cdp.reservation_created': 'immediate', 'reservation.visit_dn': 'immediate', 'reservation.visit_done': 'immediate',
    'customer.created': 'daily', 'customer.dormant': 'daily', 'customer.cycle_lapsed': 'daily', 'customer.grade_changed': 'daily',
    'customer.birthday_approaching': 'daily', 'customer.points_expiring': 'daily', 'cdp.cart_abandon': 'daily', 'cdp.browse_no_purchase': 'daily',
    'custom': 'daily', 'journey.after': 'daily',
  };
  it('18종 전부 갈래가 있고 설계서 표와 같다', () => {
    expect(TRIGGER_CONTRACTS.map((c) => c.event).sort()).toEqual(Object.keys(EXPECT).sort());
    for (const c of TRIGGER_CONTRACTS) expect(c.sendTiming, c.event).toBe(EXPECT[c.event]);
  });
  it('모르는 시작 사건 = immediate(지금 규칙 그대로)', () => {
    expect(sendTimingForTrigger('nope')).toBe('immediate');
    expect(sendTimingForTrigger('customer.created')).toBe('daily');
  });
  it('진입 행을 만드는 세 자리 = 첫 칸 시각 한 함수(갈래 = 계약)', () => {
    const w = SRC('journey-trigger-watcher.ts');
    expect((w.match(/firstRunAtFor\(sendTimingForTrigger\(j\.trigger_event\)/g) || []).length).toBe(2);
    expect(w).not.toMatch(/calculateNextRunAt\(/);
    const r = SRC('journey-reentry-worker.ts');
    expect(r).toContain("firstRunAtFor(sendTimingForTrigger(String(j.trigger_event || ''))");
    expect(r).not.toMatch(/calculateNextRunAt\(/);
  });
});

describe('3-2 하루 묶음 첫 칸 시각', () => {
  const at9 = (y: number, mo: number, d: number) => kst(y, mo, d, 9);
  it('그날 = KST 00:00:00 ~ 23:59:59 · 다음날 아침 9시(칸 시각 없음)', () => {
    expect(dailyFirstRunAt('relative', 0, null, kst(2026, 11, 2, 0, 0, 0))).toEqual(at9(2026, 11, 3));
    expect(dailyFirstRunAt('relative', 0, null, kst(2026, 11, 2, 13, 5))).toEqual(at9(2026, 11, 3));
    expect(dailyFirstRunAt('relative', 0, null, kst(2026, 11, 2, 23, 59, 59))).toEqual(at9(2026, 11, 3));
    expect(dailyFirstRunAt('relative', 0, null, kst(2026, 11, 3, 0, 0, 0))).toEqual(at9(2026, 11, 4));
  });
  it('지연 = max(1, ceil(시간 / 24))일 · 칸 시각', () => {
    expect(dailyFirstRunAt('relative', 2, null, kst(2026, 11, 2, 20))).toEqual(at9(2026, 11, 3));
    expect(dailyFirstRunAt('relative', 24, null, kst(2026, 11, 2, 1))).toEqual(at9(2026, 11, 3));
    expect(dailyFirstRunAt('relative', 36, null, kst(2026, 11, 2, 1))).toEqual(at9(2026, 11, 4));
    expect(dailyFirstRunAt('relative_at_hour', 72, 10, kst(2026, 11, 2, 22))).toEqual(kst(2026, 11, 5, 10));
  });
  it('specific_hour = 다음날 그 시각 · next_business_day = 다음날 이후 첫 평일 9시', () => {
    expect(dailyFirstRunAt('specific_hour', 0, 14, kst(2026, 11, 2, 3))).toEqual(kst(2026, 11, 3, 14));
    expect(dailyFirstRunAt('next_business_day', 0, null, kst(2026, 11, 6, 15))).toEqual(at9(2026, 11, 9));   // 금 → 월
    expect(dailyFirstRunAt('next_business_day', 0, null, kst(2026, 11, 2, 15))).toEqual(at9(2026, 11, 3));   // 월 → 화
  });
  it('칸 시각이 발송 창 밖이면 창 안으로(22시 = 그다음 날 9시)', () => {
    expect(dailyFirstRunAt('specific_hour', 0, 22, kst(2026, 11, 2, 3))).toEqual(at9(2026, 11, 4));
  });
  it('firstRunAtFor: immediate = 지금 규칙 · daily = 하루 묶음', () => {
    const t = kst(2026, 11, 2, 14);
    expect(firstRunAtFor('immediate', 'relative', 0, null, t)).toEqual(calculateNextRunAt('relative', 0, null, t));
    expect(firstRunAtFor('daily', 'relative', 0, null, t)).toEqual(at9(2026, 11, 3));
  });
});

describe('화면 문구 = 계약 한 곳(설계서 3-6 · SC-40)', () => {
  it('하루 묶음 · 즉시 갈래 한 줄 · 한 번 보내기 · 날짜 기준 = 없음(갈래 규정 밖)', () => {
    expect(sendTimingLine('customer.created', 'event')).toContain('다음날 아침 9시');
    expect(sendTimingLine('cdp.purchase', 'event')).toContain('몇 분 안에');
    expect(sendTimingLine('custom_order_shipped', null)).toContain('몇 분 안에');
    expect(sendTimingLine('customer.created', 'one_shot')).toBeNull();
    expect(sendTimingLine('customer.birthday_approaching', 'date_anchor')).toBeNull();
  });
  it('화면은 서버 글자만 그린다(시작 칸 · 켜기 확인 창 · 갈래 표 0)', () => {
    const fe = (p: string) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', p), 'utf8');
    expect(fe('components/journey/workspace/JourneyStartCard.tsx')).toContain('{String(journey.send_timing_line)}');
    expect(fe('components/journey/JourneyActivationConfirmModal.tsx')).toContain('<span>{result.sendTimingLine}</span>');
    for (const p of ['components/journey/workspace/JourneyStartCard.tsx', 'components/journey/JourneyActivationConfirmModal.tsx']) expect(fe(p)).not.toMatch(/sendTiming\s*===|'daily'|'immediate'/);
    const b = readFileSync(join(__dirname, '..', 'journey-builder.ts'), 'utf8');
    expect(b).toContain('send_timing_line: sendTimingLine(row.trigger_event, row.start_kind)');
    const r = readFileSync(join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf8');
    expect(r).toContain('return res.json({ success: true, ...result, sendTimingLine: timingLine });');
  });
});
