/**
 * woocommerce-sync-worker.test.ts — 우커머스 주기 수집 워커(W3 · 고도몰 워커 규약 복제 · 설계서 §2 불변 8)
 *  창 계산(순수) + 소스 계약(수집 로직 재작성 금지 · 실패로 status 안 내림 · 커서 전진은 성공 1곳 · 한 회차 상한 = 연결 백필 깊이 · REST 키 없는 몰은 건너뜀).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));

import { resolveWooSince, isGapBeyondWindow, MAX_WINDOW_DAYS, OVERLAP_MS } from '../woocommerce-sync-worker';
import { DEFAULT_BACKFILL_DAYS } from '../woocommerce-client';

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const NOW = new Date('2026-09-14T12:00:00Z');
const d = (iso: string) => new Date(iso);

describe('resolveWooSince — 기준점(마지막 성공 → 연결 시각) 에서 겹침(OVERLAP)만큼 물린 since · 바닥 = 90일', () => {
  it('마지막 성공 2시간 전 → since = 그 시각 - OVERLAP', () => {
    const last = d('2026-09-14T10:00:00Z');
    expect(resolveWooSince(last, d('2026-09-01T00:00:00Z'), NOW).getTime()).toBe(last.getTime() - OVERLAP_MS);
  });
  it('한 번도 안 돌았으면 연결 시각 기준', () => {
    const conn = d('2026-09-13T00:00:00Z');
    expect(resolveWooSince(null, conn, NOW).getTime()).toBe(conn.getTime() - OVERLAP_MS);
  });
  it('기준점이 없으면 2일 · 기준점이 90일보다 오래됐으면 90일 바닥으로 잘린다(더 과거는 이 연동으로 안 들어온다)', () => {
    expect(NOW.getTime() - resolveWooSince(null, null, NOW).getTime()).toBe(2 * 24 * 3600 * 1000);
    const old = d('2026-01-01T00:00:00Z');
    expect(NOW.getTime() - resolveWooSince(old, null, NOW).getTime()).toBe(MAX_WINDOW_DAYS * 24 * 3600 * 1000);
  });
  it('겹침은 몰 시간대 미상(naive 시각) 을 덮을 만큼 크다(12시간 이상) · 겹친 주문은 syncOrder 멱등이 흡수한다', () => {
    expect(OVERLAP_MS).toBeGreaterThanOrEqual(12 * 3600 * 1000);
  });
});

describe('isGapBeyondWindow', () => {
  it('기준점이 상한보다 오래되면 true · 없으면 false', () => {
    expect(isGapBeyondWindow(d('2026-01-01T00:00:00Z'), null, NOW)).toBe(true);
    expect(isGapBeyondWindow(d('2026-09-01T00:00:00Z'), null, NOW)).toBe(false);
    expect(isGapBeyondWindow(null, null, NOW)).toBe(false);
  });
});

describe('소스 계약 — 고도몰 워커와 같은 규약', () => {
  const worker = () => read('woocommerce-sync-worker.ts');
  it('수집 로직을 다시 쓰지 않는다 — syncWooOrdersSince 만 부른다', () => {
    const src = worker();
    expect(src).toContain('syncWooOrdersSince(');
    expect(src).not.toMatch(/fetchWooPage|syncOrder\(|identifyCustomer\(|axios/);
  });
  // ★0921 가져오기가 한 번 실패하면 다시 도는 경로가 없었다(워커는 최근 12시간 수정분만) → 안 끝난 몰은 워커가 줄 세운다
  it('가져오기가 안 끝난 몰(상태 없음 포함)은 enqueueWooBackfill 로 줄 세우고 그 회차 주기 수집은 건너뛴다(같은 몰에 두 흐름이 동시에 붙지 않게)', () => {
    const src = code('woocommerce-sync-worker.ts');
    const loop = src.slice(src.indexOf('for (const row of'));
    const enq = loop.indexOf('enqueueWooBackfill(');
    expect(enq).toBeGreaterThan(-1);
    expect(loop).toMatch(/woo_backfill\?\.stage !== 'done'/);
    expect(enq).toBeLessThan(loop.indexOf('syncWooOrdersSince('));
    expect(loop.slice(enq, loop.indexOf('syncWooOrdersSince('))).toContain('continue;');
    // 요금제 게이트·키 확인 뒤에만 줄 세운다
    expect(enq).toBeGreaterThan(loop.indexOf('isCdpEnabledForPlan('));
  });
  it('실패로 연동 상태를 끊지 않는다 · 실패 사유는 meta.woo_sync_error', () => {
    const src = code('woocommerce-sync-worker.ts');
    expect(src).not.toMatch(/status\s*=\s*'(error|revoked|token_expired|pending)'/);
    expect(src).toContain('woo_sync_error');
  });
  it('커서(last_synced_at) 전진은 성공 경로 1곳', () => {
    expect((code('woocommerce-sync-worker.ts').match(/last_synced_at = NOW\(\)/g) || []).length).toBe(1);
  });
  it('한 회차 상한 = 연결 백필 깊이(얕으면 공백이 조용히 잊힌다)', () => {
    expect(MAX_WINDOW_DAYS).toBe(DEFAULT_BACKFILL_DAYS);
  });
  it('대상 = 검증된 몰(active + connected_at) · 요금제 게이트 · REST 키 없는 몰(웹훅 전용)은 건너뛴다 · 회사·몰별 try 격리', () => {
    const src = code('woocommerce-sync-worker.ts');
    expect(src).toMatch(/provider = 'woocommerce'[\s\S]{0,200}status = 'active'[\s\S]{0,120}connected_at IS NOT NULL/);
    expect(src).toContain('isCdpEnabledForPlan(');
    expect(src).toContain('woo_consumer_key');
    expect(src).toMatch(/for \(const row of[\s\S]{0,200}try \{/);
  });
});
