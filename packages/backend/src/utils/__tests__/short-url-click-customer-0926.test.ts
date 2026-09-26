/**
 * 단축 URL 클릭 = 알고 있는 수신 고객으로 기록한다 (★2026-09-26 한줄로 V2 R1-15)
 *
 * 옛: 클릭 이벤트의 cdp_events.customer_id는 자사몰 회원 연결(identity link)로만 채워지고,
 *     단축 URL을 발급할 때 이미 아는 고객 id는 properties에만 들어갔다.
 *     여정 클릭 분기·클릭 목표·미반응자 제외·예측 점수는 cdp_events.customer_id로 찾으므로
 *     몰 회원이 아닌 수신자는 클릭해도 "클릭 안 함"으로 판정됐다.
 * 처방: trackEvent에 knownCustomerId(발급 원장이 아는 고객)를 받아 **회원 연결이 못 채운 경우에만** 쓴다.
 *   그 회사 고객일 때만(INSERT 안 하위 조회 · 지워진 고객 = NULL → FK 위반으로 이벤트를 잃지 않는다).
 *   회원 연결이 찾은 고객이 있으면 그대로(기존 동작 불변).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a), pool: {} }));
vi.mock('../cdp-identity', () => ({ ensureAnonymousLink: vi.fn(async () => 'anon-link-1'), identifyCustomer: vi.fn() }));
vi.mock('../cdp-auth', () => ({ isOverMonthlyCdpLimit: vi.fn(), recordCdpApiCall: vi.fn() }));
const fuseMock = vi.fn(async () => undefined);
vi.mock('../customer-cdp-fusion', () => ({ fuseEventToCustomer: (...a: any[]) => (fuseMock as any)(...a) }));
const recomputeMock = vi.fn(async () => null);
vi.mock('../unified-customer-profile', () => ({ recomputeProfile: (...a: any[]) => (recomputeMock as any)(...a) }));
vi.mock('../inapp-trigger-engine', () => ({ listInAppTriggerCandidates: vi.fn(async () => []) }));

import { trackEvent } from '../cdp-events';

const CO = '00000000-0000-4000-8000-000000000001';
const CUST = '00000000-0000-4000-8000-0000000000c1';

function insertCall() {
  return queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO cdp_events'));
}

describe('trackEvent knownCustomerId', () => {
  beforeEach(() => {
    queryMock.mockReset();
    fuseMock.mockClear();
    recomputeMock.mockClear();
  });

  it('회원 연결이 없으면 알고 있는 고객으로 기록하고(그 회사 고객 한정) 그 고객으로 융합한다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO cdp_events')) return { rows: [{ id: 'ev1', customer_id: CUST }] };
      return { rows: [] };
    });
    const r = await trackEvent(CO, { source: 'short_url_click', eventName: 'message_click', anonymousId: 'ua1', knownCustomerId: CUST });
    const call = insertCall()!;
    expect(String(call[0])).toContain('COALESCE($3::uuid, (SELECT c.id FROM customers c WHERE c.id = $8::uuid AND c.company_id = $1::uuid))');
    expect(call[1][2]).toBeNull();
    expect(call[1][7]).toBe(CUST);
    expect(r.customerId).toBe(CUST);
    expect(recomputeMock).toHaveBeenCalledWith(CO, CUST);
  });

  it('고객이 그 회사에 없으면(하위 조회 NULL) 고객 없이 기록한다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO cdp_events')) return { rows: [{ id: 'ev2', customer_id: null }] };
      return { rows: [] };
    });
    const r = await trackEvent(CO, { source: 'short_url_click', eventName: 'message_click', anonymousId: 'ua1', knownCustomerId: CUST });
    expect(r.customerId).toBeNull();
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it('knownCustomerId가 없으면 $8은 NULL(기존 동작과 같다)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO cdp_events')) return { rows: [{ id: 'ev3', customer_id: null }] };
      return { rows: [] };
    });
    await trackEvent(CO, { source: 'custom_sdk', eventName: 'page_view', anonymousId: 'ua2' });
    expect(insertCall()![1][7]).toBeNull();
  });

  it('UUID 형식이 아니면 쓰지 않는다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO cdp_events')) return { rows: [{ id: 'ev4', customer_id: null }] };
      return { rows: [] };
    });
    await trackEvent(CO, { source: 'short_url_click', eventName: 'message_click', anonymousId: 'ua1', knownCustomerId: 'not-a-uuid' });
    expect(insertCall()![1][7]).toBeNull();
  });
});

describe('단축 URL 클릭 배선', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'routes', 'short-url.ts'), 'utf8');
  it('발급 원장의 고객 id를 knownCustomerId로 넘긴다', () => {
    expect(src).toContain('knownCustomerId: resolved.customerId || undefined,');
  });
});
