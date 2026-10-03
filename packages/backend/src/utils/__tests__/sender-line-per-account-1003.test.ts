/**
 * D-8 법인 무선 상한 = 활성 계정 수 × 4 (★2026-10-03 · 전송자격인증 2.1 3차 반려 대조 · 원장 §4-M)
 *
 * 고시의 「무선 법인 4」는 계정당이다. 종전 구현은 회사 단위 · 미설정이면 제한 없음이었다.
 * 고객사별 현황을 실측하기 전이라 **스위치 뒤에 두고 기본은 꺼짐**이다(Harold 1003 지시).
 *
 * 못 박는 것
 *   1. 스위치가 꺼져 있으면 판정 · 화면 값이 종전과 한 글자도 다르지 않다(활성 계정 조회도 하지 않는다).
 *   2. 켜지면 법인 무선 = 활성 계정(시스템 계정 제외) × 4. 회사 설정은 좁히기만 한다.
 *   3. 개인 · 외국인 · 유형 미설정 회사, 유선 축은 스위치와 무관하다.
 *   4. 스위치 값은 정확히 'true' 일 때만 켜진다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../../config/database';
import {
  resolveLineLimits, evaluateLineAddition, checkSenderLineLimit, getSenderLinePolicy,
  isPerAccountMobileLimitEnabled, CORPORATE_MOBILE_PER_ACCOUNT,
} from '../sender-line-limit';

const q = query as unknown as ReturnType<typeof vi.fn>;
const COMPANY = '22222222-2222-2222-2222-222222222222';

/** 회사 · 활성 계정 수 · 보유 번호를 돌려주는 가짜 DB */
function db(company: Record<string, any>, activeAccounts: number, phones: string[]) {
  q.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM companies')) return { rows: [company], rowCount: 1 };
    if (sql.includes('FROM users')) return { rows: [{ count: String(activeAccounts) }], rowCount: 1 };
    if (sql.includes('FROM callback_numbers')) return { rows: phones.map((phone) => ({ phone })), rowCount: phones.length };
    throw new Error(`예상 밖 SQL: ${sql}`);
  });
}
const usersQueried = () => q.mock.calls.some((c) => String(c[0]).includes('FROM users'));
const mobiles = (n: number) => Array.from({ length: n }, (_, i) => `0101234${String(1000 + i)}`);

describe('resolveLineLimits — 계정당 무선 상한(순수)', () => {
  it('법인 · 활성 계정 3 → 무선 12 · 유선은 회사 설정 그대로', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: null, landlineLimit: 200, perAccountActiveAccounts: 3 }))
      .toEqual({ mobile: 3 * CORPORATE_MOBILE_PER_ACCOUNT, landline: 200, source: 'per_account' });
  });

  it('회사 설정은 좁히기만 한다 — 5 는 5, 100 은 계정 × 4 로 깎인다', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 5, landlineLimit: null, perAccountActiveAccounts: 3 }).mobile).toBe(5);
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 100, landlineLimit: null, perAccountActiveAccounts: 3 }).mobile).toBe(12);
  });

  it('활성 계정 0 → 무선 0(새 무선 등록 불가)', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: null, landlineLimit: null, perAccountActiveAccounts: 0 }).mobile).toBe(0);
  });

  it('계정 수를 안 넣으면 종전 판정 그대로(스위치 꺼짐과 같다)', () => {
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: null, landlineLimit: null }))
      .toEqual({ mobile: null, landline: null, source: 'unset' });
    expect(resolveLineLimits({ subscriberType: 'corporate', mobileLimit: 10, landlineLimit: null, perAccountActiveAccounts: null }))
      .toEqual({ mobile: 10, landline: null, source: 'company_setting' });
  });

  it('개인 · 외국인 · 유형 미설정은 계정 수와 무관하다', () => {
    expect(resolveLineLimits({ subscriberType: 'individual', mobileLimit: null, landlineLimit: null, perAccountActiveAccounts: 9 }).mobile).toBe(3);
    expect(resolveLineLimits({ subscriberType: 'foreigner', mobileLimit: null, landlineLimit: null, perAccountActiveAccounts: 9 }).mobile).toBe(2);
    expect(resolveLineLimits({ subscriberType: null, mobileLimit: null, landlineLimit: null, perAccountActiveAccounts: 9 }).source).toBe('unset');
  });

  it('초과 안내에 근거(활성 계정 1개당 4회선)가 붙는다 — 무선 · 계정당 상한일 때만', () => {
    const limits = resolveLineLimits({ subscriberType: 'corporate', mobileLimit: null, landlineLimit: 1, perAccountActiveAccounts: 1 });
    const m = evaluateLineAddition({ phone: '01099998888', limits, currentMobile: 4, currentLandline: 0 });
    expect(m.status).toBe('exceeded');
    if (m.status !== 'exceeded') throw new Error('초과여야 한다');
    expect(m.message).toContain('활성 계정 1개당 4회선');
    const l = evaluateLineAddition({ phone: '0212345678', limits, currentMobile: 0, currentLandline: 1 });
    if (l.status !== 'exceeded') throw new Error('초과여야 한다');
    expect(l.message).not.toContain('계정');
  });
});

describe('스위치 — 정확히 true 일 때만 켜진다', () => {
  const prev = process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
    else process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = prev;
  });

  it.each([[undefined, false], ['', false], ['false', false], ['1', false], ['TRUE', false], ['true', true], [' true ', true]])(
    '%s → %s', (v, on) => {
      if (v === undefined) delete process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
      else process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = v as string;
      expect(isPerAccountMobileLimitEnabled()).toBe(on);
    },
  );
});

describe('checkSenderLineLimit · getSenderLinePolicy — 등록 판정과 화면이 같은 값', () => {
  const prev = process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
  beforeEach(() => { q.mockReset(); });
  afterEach(() => {
    if (prev === undefined) delete process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
    else process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = prev;
  });

  const corp = { subscriber_type: 'corporate', mobile_line_limit: null, landline_line_limit: null };

  it('★ 꺼짐(기본) — 미설정 법인은 종전처럼 제한 없음 · 활성 계정을 세지 않는다', async () => {
    delete process.env.SENDER_LINE_PER_ACCOUNT_ENABLED;
    db(corp, 1, mobiles(50));
    const v = await checkSenderLineLimit(COMPANY, '01055556666');
    expect(v.status).toBe('unlimited');
    expect(usersQueried()).toBe(false);
    const p = await getSenderLinePolicy(COMPANY);
    expect(p.effective).toEqual({ mobile: null, landline: null, source: 'unset' });
    expect(p.perAccount).toBeNull();
  });

  it('★ 켜짐 — 활성 계정 2 · 무선 보유 8 → 새 무선은 초과 · 유선은 제한 없음', async () => {
    process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = 'true';
    db(corp, 2, mobiles(8));
    const v = await checkSenderLineLimit(COMPANY, '01055556666');
    expect(v).toMatchObject({ status: 'exceeded', kind: 'mobile', current: 8, limit: 8 });
    expect((await checkSenderLineLimit(COMPANY, '0212345678')).status).toBe('unlimited');
    const p = await getSenderLinePolicy(COMPANY);
    expect(p.effective).toEqual({ mobile: 8, landline: null, source: 'per_account' });
    expect(p.perAccount).toEqual({ activeAccounts: 2, perAccount: 4 });
  });

  it('켜짐 · 보유가 상한 아래면 통과', async () => {
    process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = 'true';
    db(corp, 2, mobiles(7));
    expect(await checkSenderLineLimit(COMPANY, '01055556666')).toMatchObject({ status: 'ok', current: 7, limit: 8 });
  });

  it('켜짐이어도 개인 · 유형 미설정 회사는 활성 계정을 세지 않는다', async () => {
    process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = 'true';
    db({ subscriber_type: null, mobile_line_limit: null, landline_line_limit: null }, 5, []);
    expect((await checkSenderLineLimit(COMPANY, '01055556666')).status).toBe('unlimited');
    db({ subscriber_type: 'individual', mobile_line_limit: null, landline_line_limit: null }, 5, mobiles(3));
    expect((await checkSenderLineLimit(COMPANY, '01055556666')).status).toBe('exceeded');
    expect(usersQueried()).toBe(false);
  });

  it('활성 계정 집계는 시스템 계정 제외 관례 그대로', async () => {
    process.env.SENDER_LINE_PER_ACCOUNT_ENABLED = 'true';
    db(corp, 1, []);
    await checkSenderLineLimit(COMPANY, '01055556666');
    const sql = String(q.mock.calls.find((c) => String(c[0]).includes('FROM users'))?.[0]);
    expect(sql).toContain('is_active = true');
    expect(sql).toContain('COALESCE(is_system, false) = false');
  });
});
