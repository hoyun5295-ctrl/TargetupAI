/**
 * cdp-events-store-code.test.ts — 브라우저 SDK 적재의 분류코드 (설계서 docs/2026-09-18-mall-integration-user-scope-design.md §3-4)
 *  SDK 공개키는 회사당 하나라 몰은 Origin 만 안다. 라우트가 Origin 으로 찾은 분류코드를 배치에 실어 주면
 *  identify 이벤트의 고객이 그 분류에 기록된다. 없으면 지금과 같은 무분류 적재.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 0 }));
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })) },
}));
vi.mock('../cdp-identity', () => ({
  identifyCustomer: vi.fn(async () => ({ customerId: 'cust-1', linkId: 'link-1', wasCreated: true, wasMerged: false })),
  ensureAnonymousLink: vi.fn(async () => 'link-anon'),
}));
vi.mock('../cdp-auth', () => ({ isOverMonthlyCdpLimit: vi.fn(async () => false), recordCdpApiCall: vi.fn(async () => undefined) }));
vi.mock('../customer-cdp-fusion', () => ({ fuseEventToCustomer: vi.fn(async () => undefined) }));
vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));
vi.mock('../inapp-trigger-engine', () => ({ listInAppTriggerCandidates: vi.fn(async () => []) }));

import { identifyCustomer } from '../cdp-identity';
import { ingestBrowserEvents } from '../cdp-events';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const identify = identifyCustomer as unknown as ReturnType<typeof vi.fn>;
const batch = (extra: Record<string, any> = {}) => ({
  anonymousId: 'anon-1', sessionId: 's-1', schemaVersion: 'v1', sentAt: null,
  events: [{ type: 'identify', external_id: '9', phone: '01000000000' }, { type: 'page_view', url: 'https://www.iroirotokyo.net/' }],
  ...extra,
});

beforeEach(() => { identify.mockClear(); });

describe('ingestBrowserEvents · 분류코드', () => {
  it('배치에 storeCode 가 있으면 identify 입력에 그대로 싣는다', async () => {
    await ingestBrowserEvents(COMPANY, batch({ storeCode: 'IROIRO' }) as any);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify.mock.calls[0][1]).toMatchObject({ source: 'sdk', externalId: '9', storeCode: 'IROIRO' });
  });

  it('없으면 identify 입력에 storeCode 키가 없다(현재 동작 캡처)', async () => {
    await ingestBrowserEvents(COMPANY, batch() as any);
    expect('storeCode' in identify.mock.calls[0][1]).toBe(false);
  });
});
