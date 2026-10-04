/**
 * 브라우저 SDK 입구의 신뢰 (2026-10-04 싱크·자사몰 전수점검 C1 · C2 · SDK2)
 *
 * /api/cdp/ingest 는 공개키 + Origin 헤더 글자 비교뿐이다(Origin 은 브라우저 밖에서 바꿔 보낼 수 있다).
 * 못 박는 것:
 *   1. identify 는 몰 서버가 받은 회원 토큰이 **이 회사·이 회원**과 맞을 때만 identifyCustomer 를 부른다.
 *      없거나 · 다른 회원 것이거나 · 다른 회사 것이거나 · 만료면 익명 적재(고객 정보 쓰기 0 · 소급 연결 0).
 *      옛: 피해자 이메일만 알면 그 고객의 이름·이메일을 덮고 휴대폰을 공격자 번호로 바꿨다.
 *   2. 회원 토큰은 이벤트 properties 에 남지 않는다.
 *   3. 브라우저의 'purchase' 는 'checkout_complete' 로 적는다(주문의 진실 = 서버 쪽 · 몰 웹훅과 이중 계상 금지).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const clientQuery = vi.fn(async (..._a: any[]) => ({ rows: [], rowCount: 0 }));
// 옛 「익명 아이디로 예전 연결 고객 재사용」이 살아나면 이 조회가 고객을 돌려준다(아래 R1 high 시험의 미끼)
const dbQuery = vi.fn(async (sql: string, ..._a: any[]) =>
  (/FROM cdp_events[\s\S]*anonymous_id = \$2 AND customer_id IS NOT NULL/.test(sql)
    ? { rows: [{ customer_id: 'victim-cust' }], rowCount: 1 }
    : { rows: [], rowCount: 0 }));
vi.mock('../../config/database', () => ({
  query: (sql: string, ...a: any[]) => dbQuery(sql, ...a),
  pool: { connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })) },
}));
vi.mock('../cdp-identity', () => ({
  identifyCustomer: vi.fn(async () => ({ customerId: 'cust-1', linkId: 'link-1', wasCreated: false, wasMerged: true })),
  ensureAnonymousLink: vi.fn(async () => 'link-anon'),
  findLinkedCustomerId: vi.fn(async (_c: string, _s: string, ext: string) => (ext === 'm-77' ? 'cust-1' : null)),
}));
vi.mock('../cdp-auth', () => ({ isOverMonthlyCdpLimit: vi.fn(async () => false), recordCdpApiCall: vi.fn(async () => undefined) }));
vi.mock('../customer-cdp-fusion', () => ({ fuseEventToCustomer: vi.fn(async () => undefined) }));
vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));
vi.mock('../inapp-trigger-engine', () => ({ listInAppTriggerCandidates: vi.fn(async () => []) }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-1004';

import { identifyCustomer } from '../cdp-identity';
import { ingestBrowserEvents } from '../cdp-events';
import { issueCdpMemberToken } from '../cdp-member-token';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const identify = identifyCustomer as unknown as ReturnType<typeof vi.fn>;

const run = (identifyEvt: Record<string, any> | null, more: Array<Record<string, any>> = [], member: any = null) =>
  ingestBrowserEvents(COMPANY, {
    anonymousId: 'anon-1', sessionId: 's-1', schemaVersion: 'v1', sentAt: null,
    events: [...(identifyEvt ? [{ type: 'identify', ...identifyEvt }] : []), ...more],
    member,
  } as any);

const inserted = () =>
  clientQuery.mock.calls
    .filter((c) => /INSERT INTO cdp_events/.test(String(c[0])))
    .map((c) => ({ name: c[1][3], props: JSON.parse(c[1][4]), customerId: c[1][2] }));

beforeEach(() => { identify.mockClear(); clientQuery.mockClear(); dbQuery.mockClear(); });

describe('브라우저 식별 = 회원 토큰 필수 (C1)', () => {
  const victim = { external_id: 'attacker-made', email: 'victim@example.invalid', phone: '01000000009', name: '공격자' };

  it('토큰 없음 → identifyCustomer 를 부르지 않고 익명 적재', async () => {
    const r = await run(victim, [{ type: 'pageview', url: '/' }]);
    expect(identify).not.toHaveBeenCalled();
    expect(r.customerId).toBeNull();
    expect(inserted().every((e) => e.customerId === null)).toBe(true);
  });

  it('다른 회원의 토큰 · 다른 회사의 토큰 · 만료 토큰 · 위조 서명 = 거절', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const tokens = [
      issueCdpMemberToken(COMPANY, 'someone-else').token,
      issueCdpMemberToken(OTHER, 'attacker-made').token,
      issueCdpMemberToken(COMPANY, 'attacker-made', 60, past).token,
      // 서명 첫 글자를 바꾼다(끝 글자는 base64 남는 비트라 바꿔도 같은 바이트일 수 있다 = 위조가 아님)
      issueCdpMemberToken(COMPANY, 'attacker-made').token.replace(/\.([^.])([^.]*)$/, (_m, c, rest) => `.${c === 'A' ? 'B' : 'A'}${rest}`),
    ];
    for (const member_token of tokens) {
      await run({ ...victim, member_token });
    }
    expect(identify).not.toHaveBeenCalled();
  });

  it('이 회사·이 회원 토큰이면 식별한다(종전 동작)', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'm-77').token;
    const r = await run({ external_id: 'm-77', email: 'm77@example.invalid', member_token });
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify.mock.calls[0][1]).toMatchObject({ source: 'sdk', externalId: 'm-77' });
    expect(r.customerId).toBe('cust-1');
  });

  it('회원 토큰은 이벤트 properties 에 남지 않는다', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'm-77').token;
    await run({ external_id: 'm-77', member_token });
    const ev = inserted().find((e) => e.name === 'identify');
    expect(ev).toBeTruthy();
    expect(JSON.stringify(ev!.props)).not.toContain(member_token);
    expect('member_token' in ev!.props).toBe(false);
  });
});

describe("브라우저 'purchase' = checkout_complete (C2 · SDK2)", () => {
  it('track purchase 는 checkout_complete 로 적는다 · 다른 표준 이벤트는 그대로', async () => {
    await run(null, [
      { type: 'track', event: 'purchase', properties: { order_id: 'O-1', value: 1000 } },
      { type: 'track', event: 'cart_add', properties: { product_id: 'P-1' } },
    ]);
    const names = inserted().map((e) => e.name);
    expect(names).toEqual(['checkout_complete', 'cart_add']);
  });
});

describe('배치의 고객 연결 근거 = 검증된 토큰뿐 (Codex 1004 R1 high · medium)', () => {
  it('토큰이 틀린 identify 배치는 익명 아이디의 예전 연결 고객으로도 가지 않는다', async () => {
    const r = await run({ external_id: 'm-77', member_token: 'bad' }, [{ type: 'track', event: 'cart_add', properties: {} }]);
    expect(r.customerId).toBeNull();
    expect(inserted().every((e) => e.customerId === null)).toBe(true);
  });

  it('identify 도 회원 증명도 없는 배치(로그아웃 뒤 공용 PC)는 예전 연결이 있어도 익명', async () => {
    const r = await run(null, [{ type: 'track', event: 'cart_add', properties: {} }]);
    expect(r.customerId).toBeNull();
    expect(dbQuery.mock.calls.some(([sql]) => /anonymous_id = \$2 AND customer_id IS NOT NULL/.test(String(sql)))).toBe(false);
  });

  it('같은 배치에 토큰 없는 identify 뒤 토큰 있는 identify = 뒤의 것으로 식별(medium)', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'm-77').token;
    const r = await run({ external_id: 'm-77' }, [{ type: 'identify', external_id: 'm-77', member_token }]);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(r.customerId).toBe('cust-1');
  });

  it('정상 A identify 뒤 같은 배치에 토큰 틀린 다른 회원 identify = 익명(A 로 물러나지 않는다 · R2 high)', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'm-77').token;
    const r = await run({ external_id: 'm-77', member_token }, [
      { type: 'track', event: 'cart_add', properties: {} },
      { type: 'identify', external_id: 'someone-else', member_token: 'bad' },
      { type: 'track', event: 'cart_add', properties: {} },
    ]);
    expect(identify).not.toHaveBeenCalled();
    expect(r.customerId).toBeNull();
    expect(inserted().every((e) => e.customerId === null)).toBe(true);
  });

  it('정상 A identify 뒤 아이디가 빈·없는 identify = 익명(A 로 물러나지 않는다 · 회원 증명으로도 대체하지 않는다 · R3 high)', async () => {
    const member_token = issueCdpMemberToken(COMPANY, 'm-77').token;
    const member = { externalId: 'm-77', memberToken: member_token };
    for (const tail of [{ type: 'identify', external_id: '' }, { type: 'identify' }, { type: 'identify', external_id: null }]) {
      identify.mockClear();
      const r = await run({ external_id: 'm-77', member_token }, [tail, { type: 'track', event: 'cart_add', properties: {} }], member);
      expect(identify).not.toHaveBeenCalled();
      expect(r.customerId).toBeNull();
    }
  });

  it('identify 없는 배치 + 맞는 회원 증명 = 이미 연결된 고객으로(고객 정보는 고치지 않는다)', async () => {
    const member = { externalId: 'm-77', memberToken: issueCdpMemberToken(COMPANY, 'm-77').token };
    const r = await run(null, [{ type: 'track', event: 'cart_add', properties: {} }], member);
    expect(identify).not.toHaveBeenCalled();
    expect(r.customerId).toBe('cust-1');
    expect(inserted().every((e) => e.customerId === 'cust-1')).toBe(true);
  });

  it('회원 증명의 토큰이 다른 회원 것이면 익명', async () => {
    const member = { externalId: 'm-77', memberToken: issueCdpMemberToken(COMPANY, 'someone-else').token };
    const r = await run(null, [{ type: 'track', event: 'cart_add', properties: {} }], member);
    expect(r.customerId).toBeNull();
  });
});
