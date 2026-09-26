/**
 * 여정 통계 — 클릭은 자기 회사 이벤트만 · 전환은 실제로 저장되는 구매 이벤트로 센다 (★2026-09-26 한줄로 V2 R1-43)
 *
 * ①단계별 클릭 수 하위 쿼리가 회사 조건 없이 모든 회사의 message_click을 훑었다(속도 · 격리).
 * ②전환 수가 event_name = 'order'를 셌는데, 이벤트 CT는 표준 이름만 저장하고 주문은 'purchase'로 남긴다(cdp-orders) → 전환 항상 0.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STANDARD_EVENT_NAMES } from '../cdp-events';

const src = readFileSync(join(__dirname, '..', 'journey-stats.ts'), 'utf8');

describe('여정 통계 이벤트', () => {
  it('전환은 저장되는 표준 이름 purchase로 센다', () => {
    expect((STANDARD_EVENT_NAMES as readonly string[])).toContain('purchase');
    expect((STANDARD_EVENT_NAMES as readonly string[])).not.toContain('order');
    expect(src).not.toContain("ce.event_name = 'order'");
    // 고친 두 곳 + 원래부터 purchase를 쓰던 여정 요약 쿼리 1곳
    expect((src.match(/ce\.event_name = 'purchase'/g) || []).length).toBe(3);
  });

  it('단계 클릭 수는 그 여정 회사의 이벤트만', () => {
    const i = src.indexOf("WHERE ce.event_name = 'message_click'\n           AND (ce.properties->>'step_id')::uuid = s.id");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toContain('AND ce.company_id = (SELECT company_id FROM journeys WHERE id = $1::uuid)');
  });
});
