/**
 * 구매는 문이 둘이다 — 원장 문 판정·창·중복 차단 (2026-08-01 §11-4)
 *
 * 설계서 §2-2: 어느 문으로 들어오든 같은 트리거가 물린다.
 * 원장(purchases)을 이벤트로 복사하지 않고 그대로 읽는다 — 진실이 하나여야 중복 진입이 구조로 막힌다.
 *
 * 못 박는 것:
 *   1. 자사몰 문이 현역이면 원장 문을 닫는다(같은 구매 두 번 진입 = 중복 발송·과금).
 *   2. 창 길이는 회사 적재 주기가 정한다(정답표 금지).
 *   3. 원장 조회는 발생 시각으로 자른다 — 도착 시각으로는 이관 전량을 못 막는다.
 *   4. 커서는 (도착시각, 행 id)로 돌고 실제로 본 마지막 행까지만 전진한다.
 *   5. 지표·인앱은 원장을 읽지 않는다(이 조각이 매출 숫자를 바꾸지 않는다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../config/database', () => ({
  query: vi.fn(),
  pool: { connect: vi.fn() },
}));

import { query } from '../config/database';
import {
  resolvePurchaseLedgerGate,
  isMallPurchaseDoorActive,
  isLedgerRunWindowHour,
  resetPurchaseLedgerCaches,
  PURCHASE_TRIGGER_MAX_AGE_HOURS,
  MALL_DOOR_ACTIVE_DAYS,
  LEDGER_RUN_START_HOUR_KST,
  LEDGER_RUN_END_HOUR_KST,
} from './journey-purchase-ledger';
import { usesPurchaseLedger, resolveCdpCursorEventName, planCdpCursorBatch } from './journey-cdp-cursor';
import { selectPurchaseLedgerRowsForCursor, selectCdpEventRowsForCursor } from './journey-target-extractor';

const q = query as unknown as ReturnType<typeof vi.fn>;
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

beforeEach(() => {
  q.mockReset();
  q.mockResolvedValue({ rows: [], rowCount: 0 });
  resetPurchaseLedgerCaches();
});

describe('원장 문을 쓰는 트리거', () => {
  it('구매만 원장을 함께 읽는다', () => {
    expect(usesPurchaseLedger('cdp.purchase')).toBe(true);
    expect(usesPurchaseLedger('cdp.reservation_created')).toBe(false);
    expect(usesPurchaseLedger('custom_order_shipped')).toBe(false);
    expect(usesPurchaseLedger('customer.dormant')).toBe(false);
  });

  it('이벤트 커서 계약은 그대로다 (카탈로그 parity 가드가 이 형태를 읽는다)', () => {
    expect(resolveCdpCursorEventName('cdp.purchase')).toBe('purchase');
    expect(resolveCdpCursorEventName('customer.created')).toBeNull();
  });
});

/** KST 기준 시각을 만든다(UTC = KST − 9). */
const kstAt = (hour: number) => new Date(Date.UTC(2026, 7, 1, hour - 9, 30, 0));
const RUN_TIME = kstAt(10);

describe('실행 시간대 — 하루 모아 다음 날 오전', () => {
  it('오전 실행 창 안에서만 연다', () => {
    expect(isLedgerRunWindowHour(LEDGER_RUN_START_HOUR_KST)).toBe(true);
    expect(isLedgerRunWindowHour(LEDGER_RUN_END_HOUR_KST - 1)).toBe(true);
  });

  it('창 밖에서는 돌지 않는다 (도착분은 커서 뒤에 쌓여 다음 아침에 잡힌다)', () => {
    expect(isLedgerRunWindowHour(LEDGER_RUN_START_HOUR_KST - 1)).toBe(false);
    expect(isLedgerRunWindowHour(LEDGER_RUN_END_HOUR_KST)).toBe(false);
    expect(isLedgerRunWindowHour(3)).toBe(false);
    expect(isLedgerRunWindowHour(22)).toBe(false);
  });

  it('시각 판정은 DB 시계로만 한다 (앱 시계와 갈리면 축이 둘이 된다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(watcher).toMatch(/EXTRACT\(HOUR FROM \(NOW\(\) AT TIME ZONE 'Asia\/Seoul'\)\)::int AS kst_hour/);
    expect(watcher, '앱 시계로 시간대를 재면 안 된다').not.toMatch(/isLedgerRunWindowHour\(new Date/);
  });
});

describe('문 판정 — 두 문을 동시에 열지 않는다', () => {
  it('자사몰 구매 이벤트가 최근에 있으면 원장 문을 닫는다', async () => {
    q.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const gate = await resolvePurchaseLedgerGate(COMPANY_ID);
    expect(gate.enabled, '두 문을 다 열면 같은 구매가 두 번 진입한다(쿨다운 0)').toBe(false);
  });

  it('자사몰 이벤트가 없으면 원장 문을 연다', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const gate = await resolvePurchaseLedgerGate(COMPANY_ID);
    expect(gate.enabled).toBe(true);
    expect(q, '문 판정 말고 다른 조회를 하지 않는다').toHaveBeenCalledTimes(1);
  });

  it('자사몰 없음은 캐시하지 않는다 (캐시된 false가 두 문을 동시에 연다)', async () => {
    q.mockResolvedValue({ rows: [] });
    await resolvePurchaseLedgerGate(COMPANY_ID);
    await resolvePurchaseLedgerGate(COMPANY_ID);
    expect(q, '두 번째 호출도 실제로 조회해야 한다').toHaveBeenCalledTimes(2);
  });

  it('원장 잠금(자사몰 현역)은 캐시한다 — 안전한 방향이다', async () => {
    q.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    await resolvePurchaseLedgerGate(COMPANY_ID);
    await resolvePurchaseLedgerGate(COMPANY_ID);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('현역 판정은 존재가 아니라 최근이다 (옛 테스트 이벤트 한 건이 문을 영영 닫지 않게)', async () => {
    await isMallPurchaseDoorActive(COMPANY_ID);
    const sql = String(q.mock.calls[0][0]);
    expect(sql).toMatch(/occurred_at >= NOW\(\) - \(\$2 \|\| ' days'\)::interval/);
    expect((q.mock.calls[0][1] as any[])[1]).toBe(String(MALL_DOOR_ACTIVE_DAYS));
  });
});

describe('창 길이 — 고객사가 정하는 값에 걸지 않는다', () => {
  it('동기화 주기를 읽지 않는다 (고객사 설정이라 우리 권한이 아니고 어긋나면 조용히 안 잡힌다)', () => {
    const ledger = src('src/utils/journey-purchase-ledger.ts');
    expect(ledger).not.toMatch(/FROM sync_agents/);
    expect(ledger).not.toMatch(/sync_interval_purchases/);
  });

  it('창은 정책에서 나온다 — 동기화 1일 + 실행 대기 1일 + 여유 1일', () => {
    expect(PURCHASE_TRIGGER_MAX_AGE_HOURS).toBe(3 * 24);
  });

  it('워커가 그 상수를 그대로 넘긴다 (중간에 다른 값이 끼지 않는다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(watcher).toMatch(/PURCHASE_TRIGGER_MAX_AGE_HOURS,/);
  });
});

describe('원장 커서 조회 — 무엇을 자르는가', () => {
  const CURSOR = { at: new Date('2026-08-01T00:00:00Z'), rowId: '33333333-3333-3333-3333-333333333333' };
  const WINDOW_END = new Date('2026-08-01T01:00:00Z');

  it('과거분 소급은 발생 시각으로 막는다 — 도착 시각으로는 못 막는다', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    const sql = String(q.mock.calls[0][0]);
    expect(sql, '이관은 오늘 도착한다 — 도착 축으로 자르면 3년 치가 통째로 통과한다')
      .toMatch(/p\.purchase_date >= \(\(NOW\(\) - \(\$4 \|\| ' hours'\)::interval\) AT TIME ZONE 'Asia\/Seoul'\)/);
    expect(sql).toMatch(/p\.purchase_date IS NOT NULL/);
    expect(sql, '미래 구매(ERP 시계 오류)는 트리거가 아니다')
      .toMatch(/p\.purchase_date <= \(NOW\(\) AT TIME ZONE 'Asia\/Seoul'\)/);
  });

  it('커서는 (도착시각, 행 id) 행 비교다', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    expect(String(q.mock.calls[0][0])).toMatch(/\(p\.created_at, p\.id\) > \(/);
  });

  it('커서 id가 없으면 시각만 비교한다', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, { at: CURSOR.at, rowId: null }, WINDOW_END, 24, 1000);
    const sql = String(q.mock.calls[0][0]);
    expect(sql).not.toMatch(/\(p\.created_at, p\.id\) >/);
    expect(sql).toMatch(/p\.created_at > \(/);
  });

  it('변환은 컬럼이 아니라 파라미터 쪽에 건다 (컬럼에 걸면 인덱스를 못 탄다)', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    const sql = String(q.mock.calls[0][0]);
    expect(sql).toMatch(/\$2::timestamptz AT TIME ZONE current_setting\('TimeZone'\)/);
    expect(sql).toMatch(/ORDER BY p\.created_at ASC, p\.id ASC/);
  });

  it('고객이 없는 원장 행은 후보가 아니다 (여정은 고객 단위로 발송한다)', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    expect(String(q.mock.calls[0][0])).toMatch(/p\.customer_id IS NOT NULL/);
  });

  it('회사 격리 + 안전필터가 붙는다', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    const sql = String(q.mock.calls[0][0]);
    expect(sql.match(/company_id = \$1::uuid/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toMatch(/is_active/);
  });

  it('금액은 소수점 없이 싣는다 (문안 변수로 그대로 나간다)', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, CURSOR, WINDOW_END, 24, 1000);
    expect(String(q.mock.calls[0][0])).toMatch(/ROUND\(COALESCE\(p\.total_amount, 0\)\)::bigint/);
  });
});

describe('하루 컷오프 — 동기화 시각과 무관해야 한다', () => {
  it('원장 창 끝은 오늘 KST 자정이다 (지금 시각으로 두면 주기 의존이 되살아난다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(
      watcher,
      "창 끝이 지금 시각이면 실행 시간대에 도착한 건이 당일 나가고, 그건 고객사 동기화 시각에 따라 달라진다",
    ).toMatch(/date_trunc\('day', NOW\(\) AT TIME ZONE 'Asia\/Seoul'\) AT TIME ZONE 'Asia\/Seoul'/);
  });

  it('활성화 시점에 원장 커서를 잡는다 (안 잡으면 첫날 수집분이 통째로 날아간다)', () => {
    const builder = src('src/utils/journey-builder.ts');
    expect(
      builder,
      'NOW()를 쓰면 활성화 커밋 이후 커서 심기까지의 구매가 영구히 빠진다 — 활성화가 찍은 시각을 써야 창이 0이다',
    ).toMatch(/UPDATE journeys SET last_purchase_cursor = \$2::timestamptz/);
    expect(builder).toMatch(/RETURNING id, approved_at/);
    expect(builder).toMatch(/42703/);
  });

  it('커서 초기화 실패가 활성화를 실패로 만들지 않는다 (활성화는 이미 커밋됐다)', () => {
    const builder = src('src/utils/journey-builder.ts');
    const block = builder.slice(builder.indexOf('last_purchase_cursor = $2::timestamptz'));
    const tail = block.slice(0, block.indexOf('return { ok:'));
    expect(
      tail,
      '여기서 throw하면 여정은 켜졌는데 호출자는 실패를 받고, 재시도해도 status가 active라 영원히 못 켠다',
    ).not.toMatch(/throw e/);
    expect(tail, '조용히 넘기면 그 여정만 영원히 원장 진입 0이 된다').toMatch(/console\.error/);
  });

  it('커서가 없으면 원장 문을 열지 않는다 (기준 없이 열면 활성화 이전 구매가 소급 발송된다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(watcher).toMatch(/if \(!cursorAt\)/);
  });

  it('DDL 미실행과 절단을 조용히 넘기지 않는다 (유일한 관측점이다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(watcher).toMatch(/구매 원장 커서 컬럼 미마이그레이션/);
    expect(watcher).toMatch(/구매 원장 절단/);
  });
});

describe('커서 정밀도 — DB 밖을 다녀오면 안 된다 (2026-08-02 F1)', () => {
  it('커서는 DB가 준 원문 문자열로 전진한다 (JS Date 왕복 = 마이크로초 절사 = 마지막 밀리초 묶음 매 회차 재발송)', () => {
    const rows = [{
      customerId: 'c1',
      eventId: 'e1',
      createdAt: new Date('2026-08-01T00:00:00.123Z'),          // 드라이버가 절사한 값
      occurredAt: new Date('2026-08-01T00:00:00.123Z'),
      createdAtRaw: '2026-08-01 00:00:00.123456+00',             // DB 원문(마이크로초)
      properties: null,
    }];
    const batch = planCdpCursorBatch(rows, 1000, new Date('2026-08-01T01:00:00Z'), 'created_at');
    expect(
      batch.newCursor.at,
      'Date로 전진하면 커서가 실제 행보다 999µs 이르다 — 재진입 허용·쿨다운 0·UNIQUE 없음이라 그대로 중복 발송·과금',
    ).toBe('2026-08-01 00:00:00.123456+00');
  });

  it('원장 조회가 원문 컬럼을 함께 싣는다', async () => {
    await selectPurchaseLedgerRowsForCursor(COMPANY_ID, {}, { at: new Date(), rowId: null }, new Date(), 24, 1000);
    expect(String(q.mock.calls[0][0])).toMatch(/::text AS arrived_at_raw/);
  });

  it('이벤트 조회도 원문 컬럼을 함께 싣는다 (같은 뿌리 — §11-3 배포분에 잠복해 있었다)', async () => {
    await selectCdpEventRowsForCursor(COMPANY_ID, 'purchase', {}, { at: new Date(), eventId: null, axis: 'created_at' }, new Date(), 1000);
    expect(String(q.mock.calls[0][0])).toMatch(/e\.created_at::text AS created_at_raw/);
  });

  it('커서 읽기도 원문으로 한다 (쓸 때만 원문이면 읽기에서 다시 절사된다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    expect(watcher).toMatch(/last_purchase_cursor::text AS last_purchase_cursor_raw/);
    expect(watcher).toMatch(/last_event_cursor::text AS last_event_cursor_raw/);
  });

  it('커서 쓰기에 후진 금지 가드가 있다 (절사된 windowEnd가 커서를 뒤로 물리면 처리분을 다시 잡는다)', () => {
    const watcher = src('src/utils/journey-trigger-watcher.ts');
    const guards = watcher.match(/>= \(last_(purchase|event)_cursor, COALESCE/g) || [];
    expect(guards.length, '이벤트 문·원장 문 두 곳 모두').toBeGreaterThanOrEqual(2);
  });
});

describe('커서 전진 — 이벤트 문과 같은 규약', () => {
  const row = (id: string, arrived: string) => ({
    customerId: `cust-${id}`,
    eventId: id,
    createdAt: new Date(arrived),
    occurredAt: new Date(arrived),
    properties: null,
  });

  it('실제로 본 마지막 행까지만 전진한다 (못 본 구간을 건너뛰지 않는다)', () => {
    const rows = [row('a', '2026-08-01T00:00:01Z'), row('b', '2026-08-01T00:00:02Z'), row('c', '2026-08-01T00:00:03Z')];
    const batch = planCdpCursorBatch(rows, 2, new Date('2026-08-01T01:00:00Z'), 'created_at');
    expect(batch.truncated).toBe(true);
    expect(batch.newCursor.eventId).toBe('b');
    expect(batch.ids).toHaveLength(2);
  });

  it('행이 없으면 창 끝까지 전진한다', () => {
    const windowEnd = new Date('2026-08-01T01:00:00Z');
    const batch = planCdpCursorBatch([], 1000, windowEnd, 'created_at');
    expect(batch.newCursor.at).toBe(windowEnd);
    expect(batch.newCursor.eventId).toBeNull();
  });
});

describe('지표 축은 그대로다 — 이 조각이 매출 숫자를 바꾸지 않는다', () => {
  const METRIC_CONSUMERS = [
    'src/utils/automarketing-roi.ts',
    'src/utils/campaign-response-attribution.ts',
    'src/utils/cdp-active-customers.ts',
    'src/utils/cdp-diagnostics.ts',
    'src/utils/marketing-calendar-store.ts',
    'src/utils/inapp-segment-matcher.ts',
    'src/utils/operator-performance-estimator.ts',
  ];

  it.each(METRIC_CONSUMERS)('%s 는 구매 원장을 읽지 않는다', (file) => {
    expect(
      src(file),
      '원장을 지표가 읽기 시작하면 매출·귀속 숫자가 조용히 바뀐다 — 그건 별건 판단이다',
    ).not.toMatch(/FROM purchases/);
  });

  it('cdp_events에 새 이벤트를 만들지 않는다 (테이블을 세는 소비처가 여럿이다)', () => {
    const ledger = src('src/utils/journey-purchase-ledger.ts');
    const extractor = src('src/utils/journey-target-extractor.ts');
    expect(ledger).not.toMatch(/INSERT INTO cdp_events/);
    expect(extractor).not.toMatch(/INSERT INTO cdp_events/);
  });
});
