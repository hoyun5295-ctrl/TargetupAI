// replaces: none
/**
 * C152 스냅 대조 버전업 2차 — 실 PostgreSQL 판(★ 2026-11-21 · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §5 · 대기 DDL C133-DDL-2 를 시험 안에서 얹는다)
 *   운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   1. 묶음별 평균 구매액 = 수신 가능 · 0원 제외 · 담당자 범위 · 5명 미만 없음
 *   2. 같이 산 상품 = 키 하나가 상품 하나(keymap) · 두 문 합침 · 취소 · 환불 제외 · 사람 = 번호 · 겹침 하한 · 가짜 쌍 0(설계 Codex 1R ~ 5R 반례)
 *   3. 사고 안 산 명단 = 세는 쪽(창 안 a) · 빼는 쪽(전 기간 · 구매 당시 이름 또는 같은 키) · 수신 가능 · 세기 = 명단 수 · 추천 상품과 같은 읽기
 *   4. 유입 경로 = 여섯 갈래 · 같은 세션 · 고객 기준 7일 · 창 전날 방문 · 방문 기록 없음 · 구매 건수 합 보존 · 꼬리표 값 정리
 *   5. 답 = 한 번만 걷는다(시도 표 + 질문) · 기억이 사라져도 잔액 0 으로 답 · 회사 전체 값 판정 · 답의 퍼널 구매 = 매출 반영 주문만
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';

const ai = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../citations', async (orig) => ({
  ...(await orig() as any),
  callAIWithCitations: async () => { ai.calls += 1; return { text: `답 ${ai.calls}`, citations: [], documents: [] }; },
}));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn(async () => 0) }));

import { countAskCells, askSpendAvg } from '../ask-segments';
import { rebuildCompanySignals, companyWideViewer } from '../product-signal';
import { pickRecoIndex } from '../product-reco';
import { listBoughtTogether, countBoughtNotBought, listBoughtNotBought, PAIR_WINDOW_DAYS } from '../product-pairs';
import { listInflowChannels, INFLOW_NO_VISIT } from '../inflow-channel';
import { buildCdpFunnel } from '../cdp-diagnostics';
import { channelStats30d } from '../next-action-advisor';
import { answerAsk, runCompanyExplain, askAnswerKey, buildAskTables } from '../../services/ask-answer';
import { forgetPaidResultsForTest } from '../../services/ai-line';
import { UserFacingError } from '../http-error';

const id = (n: number) => `00000000-0000-0000-0000-00000c152${String(n).padStart(3, '0')}`;
const SPEND = id(1), PAIR = id(2), OTHER = id(3), INF = id(4), CREDIT = id(5);
const PLAN = id(9);
const ADMIN = id(11), STAFF = id(12), INF_ADMIN = id(13), CREDIT_ADMIN = id(14), CREDIT_STAFF = id(15), SPEND_ADMIN = id(16), SPEND_STAFF = id(17), INF_STAFF = id(18);
const cust = (n: number) => id(100 + n);
const sp = (n: number) => id(300 + n);
const phone = (n: number) => `010000152${String(n).padStart(2, '0')}`;

const kstDay = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
const at = (n: number, hh = 12) => `${kstDay(n)}T${String(hh).padStart(2, '0')}:00:00+09:00`;
const ev = (company: string, customer: string | null, name: string, properties: any, occurredAt: string, sessionId: string | null = null) =>
  insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: company, customer_id: customer, event_name: name, source: 'test', properties, occurred_at: occurredAt, session_id: sessionId });
const PAID = { revenue_applied: true, status: 'paid' };
const buy = (company: string, customer: string | null, items: any[], when: string, extra: any = {}, sessionId: string | null = null) =>
  ev(company, customer, 'purchase', { ...PAID, total_amount: 10000, items, ...extra }, when, sessionId);
const ledger = (company: string, customer: string, ph: string, name: string | null, day: number, code: string | null, amount = 10000) =>
  insertMinimalRow(pool, 'purchases', { company_id: company, customer_id: customer, customer_phone: ph, purchase_date: `${kstDay(day)} 00:00:00`, product_code: code, product_name: name, total_amount: amount });

const CREAM = { productId: 'K-CR', productName: '크림' };
const SERUM = { productId: 'K-SE', productName: '세럼' };
const names = (l: { recipients: Array<{ name: string }> }) => l.recipients.map((r) => r.name).sort();

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-2'));
  await pool.query(ledgerBlockSql('C90-DDL-1'));   // 크레딧 원장(차감 한 줄을 실제로 쓴다)
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'C152P', plan_name: '유료', monthly_price: 10000, ai_credits_per_month: 100, is_active: true });

  // ── 1. 평균 구매액 ──
  await insertMinimalRow(pool, 'companies', { id: SPEND });
  await insertMinimalRow(pool, 'users', { id: SPEND_ADMIN, company_id: SPEND, login_id: 'c152spadmin', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: SPEND_STAFF, company_id: SPEND, login_id: 'c152spstaff', name: '담당자', user_type: 'user', store_codes: ['S152'] });
  const spc = (n: number, days: number, count: number, amount: number | null, extra: Record<string, unknown> = {}) =>
    insertMinimalRow(pool, 'customers', {
      id: sp(n), company_id: SPEND, phone: `010000153${String(n).padStart(2, '0')}`, name: `구매${n}`, is_active: true, sms_opt_in: true,
      recent_purchase_date: kstDay(days), purchase_count: count, total_purchase_amount: amount, ...extra,
    });
  // 떠나는 단골 칸(r4c2): 수신 가능 다섯(1 ~ 5만 원) + 0원 하나 + 금액 없음 하나 + 수신거부(큰 금액) 하나
  for (let i = 1; i <= 5; i++) await spc(i, 400, 5, i * 10000);
  await spc(6, 400, 5, 0);
  await spc(7, 400, 5, null);
  await spc(8, 400, 5, 9_999_999, { is_opt_out: true });
  // 첫 구매 직후 칸(r0c0): 네 명뿐(하한 5 미만)
  for (let i = 11; i <= 14; i++) await spc(i, 3, 1, 20000);
  // 담당자 범위 = 1 · 2 만
  for (const n of [1, 2]) await insertMinimalRow(pool, 'customer_stores', { company_id: SPEND, customer_id: sp(n), store_code: 'S152' });

  // ── 2 · 3. 같이 산 상품 ──
  await insertMinimalRow(pool, 'companies', { id: PAIR });
  await insertMinimalRow(pool, 'companies', { id: OTHER });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: PAIR, login_id: 'c152admin', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: STAFF, company_id: PAIR, login_id: 'c152staff', name: '담당자', user_type: 'user', store_codes: ['S152P'] });
  const mk = (n: number, extra: Record<string, unknown> = {}, company = PAIR) =>
    insertMinimalRow(pool, 'customers', { id: cust(n), company_id: company, phone: phone(n), name: `고객${n}`, is_active: true, sms_opt_in: true, ...extra });
  for (let n = 1; n <= 8; n++) await mk(n);
  await mk(9, { is_opt_out: true });
  await mk(10, { sms_opt_in: false });
  await mk(11);
  await mk(12, { phone: ` ${phone(11)} ` });   // 11 과 같은 번호(공백만 다르다) = 한 사람
  for (let n = 13; n <= 24; n++) await mk(n);
  await mk(40, {}, OTHER);
  await insertMinimalRow(pool, 'customer_stores', { company_id: PAIR, customer_id: cust(5), store_code: 'S152P' });

  // 1 ~ 4: 크림 + 세럼(자사몰)
  for (let n = 1; n <= 4; n++) await buy(PAIR, cust(n), [CREAM, SERUM], at(5));
  // 5: 크림만
  await buy(PAIR, cust(5), [CREAM], at(5));
  // 6: 크림 = 매장 원장(다른 문 · 같은 이름) · 세럼 주문은 취소(산 것 아님)
  await ledger(PAIR, cust(6), phone(6), '크림', 6, 'L-CR');
  await buy(PAIR, cust(6), [SERUM], at(4), { revenue_reversed: true });
  // 7: 크림 + 세럼을 옛 이름으로(같은 키 K-SE) → 세는 쪽에서도 세럼
  await buy(PAIR, cust(7), [CREAM], at(7));
  await buy(PAIR, cust(7), [{ productId: 'K-SE', productName: '수분 세럼(옛 이름)' }], at(10));
  // 8: 크림 + 세럼을 100일 전 매장에서(창 밖 · 신호 표 밖) → 세는 쪽에는 없고 빼는 쪽에서는 산 사람
  await buy(PAIR, cust(8), [CREAM], at(5));
  await ledger(PAIR, cust(8), phone(8), '세럼', 100, 'L-OLD');
  // 9(수신거부) · 10(미동의): 크림만
  await buy(PAIR, cust(9), [CREAM], at(5));
  await buy(PAIR, cust(10), [CREAM], at(5));
  // 11 · 12(같은 번호): 11 이 크림 · 12 가 세럼 → 한 사람이 둘 다 샀다
  await buy(PAIR, cust(11), [CREAM], at(5));
  await buy(PAIR, cust(12), [SERUM], at(5));
  // 13: 크림 + 키 K-REN 을 옛 이름 「마스크」로 삼(K-REN 의 지금 이름 = 팩 · 다른 키 K-MSK 의 이름 = 마스크) — 2R 반례
  await buy(PAIR, cust(13), [CREAM], at(6));
  await buy(PAIR, cust(13), [{ productId: 'K-REN', productName: '마스크' }], at(20));
  // 14 ~ 16: K-REN 을 옛 이름 「마스크」로만 삼 — 3R 반례(가짜 쌍 0)
  for (let n = 14; n <= 16; n++) await buy(PAIR, cust(n), [{ productId: 'K-REN', productName: '마스크' }], at(20));
  // 17: K-MSK 「마스크」 + K-REN 을 새 이름 「팩」으로(가장 최근 이름)
  await buy(PAIR, cust(17), [{ productId: 'K-MSK', productName: '마스크' }], at(3));
  await buy(PAIR, cust(17), [{ productId: 'K-REN', productName: '팩' }], at(2));
  // K8 = 신호 표에 키만(이름 없이) 있는 상품(이름 없는 조회) — 5R 반례의 앞 절반
  await ev(PAIR, cust(22), 'product_view', { items: [{ productId: 'K8' }] }, at(3));
  // 다른 회사의 같은 이름 구매(읽지 않는다)
  await buy(OTHER, cust(40), [CREAM, SERUM], at(5));

  await rebuildCompanySignals(PAIR);
  await rebuildCompanySignals(OTHER);

  // ── 신호 표를 센 뒤에 들어온 구매(오늘 구매 = 신호 표에 아직 없다) ──
  // 18 ~ 20: K9 를 「D상품」으로 사고 같은 날 「E상품」으로 다시 삼 · 21: 「E상품」으로만(+ 크림) — 4R 반례
  for (let n = 18; n <= 20; n++) {
    await buy(PAIR, cust(n), [{ productId: 'K9', productName: 'D상품' }], at(1, 10));
    await buy(PAIR, cust(n), [{ productId: 'K9', productName: 'E상품' }], at(1, 15));
  }
  await buy(PAIR, cust(21), [{ productId: 'K9', productName: 'E상품' }], at(1, 16));
  await buy(PAIR, cust(21), [CREAM], at(1, 16));
  // 22 ~ 24: 크림 + K8 을 「F상품」으로(신호 표에는 K8 이 이름 없이 있다) — 5R 반례
  for (let n = 22; n <= 24; n++) await buy(PAIR, cust(n), [CREAM, { productId: 'K8', productName: 'F상품' }], at(1, 11));

  // ── 4. 유입 경로 ──
  await insertMinimalRow(pool, 'companies', { id: INF });
  await insertMinimalRow(pool, 'users', { id: INF_ADMIN, company_id: INF, login_id: 'c152inf', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: INF_STAFF, company_id: INF, login_id: 'c152infs', name: '담당자', user_type: 'user' });   // 분류 체계가 없는 회사의 담당자
  const U1 = id(201), U2 = id(202), U3 = id(203);
  for (const [i, u] of [U1, U2, U3].entries()) await insertMinimalRow(pool, 'customers', { id: u, company_id: INF, phone: `010000154${String(i + 1).padStart(2, '0')}`, name: `방문${i + 1}`, is_active: true, sms_opt_in: true });
  const pv = (session: string, customer: string | null, url: string, referrer: string, when: string) => ev(INF, customer, 'page_view', { url, referrer, title: 't' }, when, session);
  // s1 꼬리표(검색 referrer 보다 먼저) + 같은 세션 구매 + 같은 세션의 취소 주문(세지 않는다)
  await pv('s1', null, 'https://shop.test/?utm_source=Naver_Ad&x=1', 'https://search.naver.com/q', at(3, 10));
  await buy(INF, null, [], at(3, 11), { total_amount: 10000 }, 's1');
  await buy(INF, null, [], at(3, 11), { total_amount: 77777, revenue_reversed: true }, 's1');
  // s2 referrer 없음 · s3 같은 사이트 → 직접 방문
  await pv('s2', null, 'https://shop.test/', '', at(4));
  await pv('s3', null, 'https://shop.test/p/1', 'https://shop.test/list', at(4));
  // s4 검색 · 세션 안에서 U1 로 식별 → 이틀 뒤 세션 없는 주문(웹훅)은 검색으로
  await pv('s4', null, 'https://shop.test/', 'https://m.search.naver.com/x', at(9, 10));
  await pv('s4', U1, 'https://shop.test/my', 'https://shop.test/', at(9, 11));
  await buy(INF, U1, [], at(7), { total_amount: 20000 });
  // s5 SNS · 창 전날(30일 전) 방문 → 창 첫날(29일 전) 주문 = 「SNS · 방문 0 · 구매 1」
  await pv('s5', U2, 'https://shop.test/', 'https://l.instagram.com/', at(30, 23));
  await buy(INF, U2, [], at(29, 9), { total_amount: 30000 });
  // s6 다른 사이트 · U3 · 9일 뒤 주문(7일 밖) → 방문 기록 없음
  await pv('s6', U3, 'https://shop.test/', 'https://blog.example.com/a', at(20));
  await buy(INF, U3, [], at(11), { total_amount: 40000 });
  // 세션도 고객도 없는 주문 → 방문 기록 없음
  await buy(INF, null, [], at(2), { total_amount: 50000 });
  // s7 꼬리표 값에 화면에 실으면 안 되는 글자
  await pv('s7', null, 'https://shop.test/?utm_source=%EC%B9%B4<b>Tok', '', at(2));
  // 다른 회사의 방문 · 주문(읽지 않는다)
  await ev(OTHER, null, 'page_view', { url: 'https://o.test/', referrer: 'https://google.com/' }, at(2), 's1');
  await buy(OTHER, null, [], at(2), { total_amount: 999 }, 's1');

  // ── 5. 답 ──
  await insertMinimalRow(pool, 'companies', {
    id: CREDIT, plan_id: PLAN, billing_type: 'prepaid', ai_credits_base_remaining: 10, ai_credits_purchased: 0,
    ai_credits_reset_at: new Date(Date.now() + 20 * 86400000).toISOString(),
  });
  await insertMinimalRow(pool, 'users', { id: CREDIT_ADMIN, company_id: CREDIT, login_id: 'c152cr', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: CREDIT_STAFF, company_id: CREDIT, login_id: 'c152crs', name: '담당자', user_type: 'user', store_codes: ['S152C'] });
  const cc = id(250);
  await insertMinimalRow(pool, 'customers', { id: cc, company_id: CREDIT, phone: '01000015501', name: '답고객', is_active: true, sms_opt_in: true });
  await insertMinimalRow(pool, 'customer_stores', { company_id: CREDIT, customer_id: cc, store_code: 'S152C' });
});

describe('C152 C 묶음별 평균 구매액', () => {
  it('수신 가능하고 누적 구매액이 있는 고객만 · 0원 · 금액 없음 · 수신거부는 뺀다 · 5명 미만 = 없음', async () => {
    const { cells, nobuy } = await countAskCells(SPEND, SPEND_ADMIN);
    const leave = cells.find((c) => c.key === 'r4c2')!;
    expect([leave.spendN, leave.spendSum]).toEqual([5, 150000]);
    expect(askSpendAvg(cells.filter((c) => c.group === 'leave'))).toBe(30000);
    const fresh = cells.find((c) => c.key === 'r0c0')!;
    expect(fresh.spendN).toBe(4);
    expect(askSpendAvg(cells.filter((c) => c.group === 'new'))).toBeNull();
    expect([nobuy.spendN, nobuy.spendSum]).toEqual([0, 0]);
    // 있는 칸은 그대로(수 칸 무변경)
    expect([leave.total, leave.sendable]).toEqual([8, 7]);
  });
  it('담당자 = 자기 범위 고객만', async () => {
    const { cells } = await countAskCells(SPEND, SPEND_STAFF);
    const leave = cells.find((c) => c.key === 'r4c2')!;
    expect([leave.spendN, leave.spendSum, leave.sendable]).toEqual([2, 30000, 2]);
  });
});

describe('C152 D 같이 산 상품(세는 쪽)', () => {
  it('두 문을 합치고 · 취소 · 환불 · 창 밖 · 다른 회사를 빼고 · 사람 = 번호 · 겹침 3명 이상만', async () => {
    const pairs = await listBoughtTogether(PAIR);
    const cream = pairs.filter((p) => p.a === '크림');
    // 크림을 산 사람 = 1 ~ 8 · 9 · 10 · (11 · 12 한 사람) · 13 · 21 · 22 ~ 24 = 16 · 세럼과 겹침 = 1 ~ 4 · 7(옛 이름 같은 키) · (11 · 12) = 6 · F상품과 겹침 = 22 ~ 24 = 3
    expect(cream).toEqual([
      { a: '크림', aBuyers: 16, b: '세럼', both: 6 },
      { a: '크림', aBuyers: 16, b: 'F상품', both: 3 },
    ]);
    expect(pairs.find((p) => p.a === '세럼' && p.b === '크림')).toMatchObject({ aBuyers: 6, both: 6 });
    expect(PAIR_WINDOW_DAYS).toBe(60);
  });
  it('이름이 바뀐 한 상품은 두 이름의 쌍이 되지 않는다(3R) · 신호 표에 없는 키는 가장 최근 줄의 이름 하나(4R) · 신호 표에 키만 있으면 구매 줄 이름으로 센다(5R)', async () => {
    const pairs = await listBoughtTogether(PAIR);
    const has = (x: string, y: string) => pairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
    expect(has('마스크', '팩')).toBe(false);
    expect(pairs.some((p) => p.a === 'D상품' || p.b === 'D상품')).toBe(false);
    expect(has('D상품', 'E상품')).toBe(false);
    expect(has('크림', 'F상품')).toBe(true);
    // 팩을 산 사람 = 13 ~ 17(K-REN 의 줄은 이름이 무엇이든 팩) · 마스크 = 17 한 명(K-MSK)
    const counts = await countBoughtNotBought(PAIR, ADMIN, [{ a: '팩', b: '없는 상품' }, { a: '마스크', b: '없는 상품' }, { a: 'E상품', b: '없는 상품' }]);
    expect(counts).toEqual([5, 1, 4]);
  });
});

describe('C152 D 사고 안 산 고객(빼는 쪽 · 명단)', () => {
  it('크림을 사고 세럼을 산 적 없는 수신 가능 고객 · 세기 = 명단 수', async () => {
    const list = await listBoughtNotBought(PAIR, ADMIN, '크림', '세럼');
    // 5(크림만) · 6(세럼 주문 취소) · 13 · 21 · 22 ~ 24 — 7(옛 이름 같은 키) · 8(100일 전 구매) · 9(수신거부) · 10(미동의) · 11/12(한 사람이 둘 다)는 없다
    expect(names(list)).toEqual(['고객13', '고객21', '고객22', '고객23', '고객24', '고객5', '고객6']);
    expect(list).toMatchObject({ total: 7, truncated: false });
    expect(await countBoughtNotBought(PAIR, ADMIN, [{ a: '크림', b: '세럼' }])).toEqual([7]);
    // 입력 차례 그대로 · 읽을 수 없는 짝 = 0 · 이름은 정리해 맞춘다(공백 · 대소문자)
    expect(await countBoughtNotBought(PAIR, ADMIN, [{ a: '', b: '세럼' }, { a: ' 크림 ', b: '세럼' }, { a: '크림', b: '크림' }])).toEqual([0, 7, 0]);
  });
  it('구매 당시 이름이 같으면 산 것(2R) · 신호 표에 없는 키의 옛 이름 줄도 같은 상품(4R) · 추천 상품과 같은 읽기', async () => {
    // 13 = K-REN 을 옛 이름 「마스크」로 삼 → 「크림 사고 마스크 안 산」 명단에 없다 · 5 는 있다
    const mask = names(await listBoughtNotBought(PAIR, ADMIN, '크림', '마스크'));
    expect(mask).not.toContain('고객13');
    expect(mask).toContain('고객5');
    // 추천 상품의 고르기도 13 에게 마스크를 권하지 않는다(산 것) · 5 에게는 권한다
    expect(await pickRecoIndex(PAIR, cust(13), ['마스크'])).toBeNull();
    expect(await pickRecoIndex(PAIR, cust(5), ['마스크'])).toBe(0);
    // 21 = K9 를 「E상품」으로만 삼 · 18 ~ 20 은 D상품 · E상품 두 이름으로 삼 → 누구도 「E상품을 안 산」 명단에 없다
    const e = names(await listBoughtNotBought(PAIR, ADMIN, '크림', 'E상품'));
    expect(e).not.toContain('고객21');
    expect(await listBoughtNotBought(PAIR, ADMIN, 'D상품', 'E상품')).toMatchObject({ total: 0 });
  });
  it('담당자 = 자기 범위 고객만 · 번호가 빈 고객은 명단에 없다', async () => {
    expect(names(await listBoughtNotBought(PAIR, STAFF, '크림', '세럼'))).toEqual(['고객5']);
    await query(`UPDATE customers SET phone = '' WHERE id = $1::uuid`, [cust(6)]);
    expect(names(await listBoughtNotBought(PAIR, ADMIN, '크림', '세럼'))).not.toContain('고객6');
    await query(`UPDATE customers SET phone = $2 WHERE id = $1::uuid`, [cust(6), phone(6)]);
  });
});

describe('C152 E 유입 경로', () => {
  it('여섯 갈래 · 같은 세션 · 고객 기준 7일 · 창 전날 방문 · 방문 기록 없음 · 취소 주문 제외 · 다른 회사 제외', async () => {
    const rows = await listInflowChannels(INF);
    const by = new Map(rows.map((r) => [r.channel, r]));
    expect(by.get('링크 꼬리표 · naver_ad')).toMatchObject({ visits: 1, purchases: 1, revenue: 10000 });
    expect(by.get('직접 방문')).toMatchObject({ visits: 2, purchases: 0, revenue: 0 });
    expect(by.get('검색')).toMatchObject({ visits: 1, purchases: 1, revenue: 20000 });
    expect(by.get('SNS')).toMatchObject({ visits: 0, purchases: 1, revenue: 30000 });
    expect(by.get('다른 사이트')).toMatchObject({ visits: 1, purchases: 0, revenue: 0 });
    expect(by.get(INFLOW_NO_VISIT)).toMatchObject({ visits: 0, purchases: 2, revenue: 90000 });
    // 구매 하나는 한 경로에만(합 = 창 안 매출 반영 주문 수)
    expect(rows.reduce((a, r) => a + r.purchases, 0)).toBe(5);
    expect(rows.reduce((a, r) => a + r.revenue, 0)).toBe(150000);
    // 매출 큰 순
    expect(rows[0].channel).toBe(INFLOW_NO_VISIT);
  });
  it('꼬리표 값은 영숫자와 세 기호만 남긴다 · 방문도 구매도 없는 회사 = 빈 배열', async () => {
    const rows = await listInflowChannels(INF);
    const tag = rows.find((r) => r.channel.startsWith('링크 꼬리표 · ') && r.channel !== '링크 꼬리표 · naver_ad')!;
    expect(tag.channel).toBe('링크 꼬리표 · ecb9b4btok');
    expect(rows.every((r) => !/[<>%]/.test(r.channel))).toBe(true);
    expect(await listInflowChannels(SPEND)).toEqual([]);
  });
  it('답의 퍼널 구매 = 매출 반영된 결제 주문만(셋째 인자) · 인자가 없으면 옛 값', async () => {
    expect((await buildCdpFunnel(INF, 40, { netPurchase: true })).purchaseCount).toBe(5);
    expect((await buildCdpFunnel(INF, 40)).purchaseCount).toBe(6);   // 취소 주문 포함(옛 값 그대로)
  });
});

describe('C152 B 답 — 한 번만 걷는다 · 회사 전체 값 판정', () => {
  // userType = 로그인 토큰의 값(company_admin · company_user · super_admin) — 라우트가 req.user 를 그대로 넘긴다
  const admin = { companyId: CREDIT, userId: CREDIT_ADMIN, userType: 'company_admin' };
  const staff = { companyId: CREDIT, userId: CREDIT_STAFF, userType: 'company_user' };
  const ledgerRows = async () => (await query(
    `SELECT idempotency_key, amount FROM ai_credit_transactions WHERE company_id = $1::uuid AND type = 'deduct' AND source = 'ai-operator-explain' ORDER BY created_at`, [CREDIT])).rows;

  it('회사 전체 값 판정 = 관리자 통과 · 분류코드로 나뉜 담당자 막힘(상품 숫자 관문과 같은 조각)', async () => {
    expect(await companyWideViewer(admin)).toBe(true);
    expect(await companyWideViewer(staff)).toBe(false);
    expect(await companyWideViewer({ companyId: CREDIT, userId: CREDIT_ADMIN, userType: 'super_admin' })).toBe(false);
    // 분류 체계가 없는 회사의 담당자 = 회사 전체를 보는 사람(옛 주소가 닫히지 않는다)
    expect(await companyWideViewer({ companyId: INF, userId: INF_STAFF, userType: 'company_user' })).toBe(true);
  });
  it('같은 시도 표 + 같은 질문 두 번 = 원장 한 줄 · AI 한 번 · 같은 답', async () => {
    const a = await answerAsk({ user: admin, question: '요즘 어떤 고객이 많아?', attemptToken: 'tok-c152-0001' });
    const b = await answerAsk({ user: admin, question: '요즘 어떤 고객이 많아?', attemptToken: 'tok-c152-0001' });
    expect(ai.calls).toBe(1);
    expect(b).toEqual(a);
    expect(a.text).toBe('답 1');
    expect(a.documentTitles).toContain('회사 정보');
    const rows = await ledgerRows();
    expect(rows.map((r: any) => r.idempotency_key)).toEqual([askAnswerKey(CREDIT, 'tok-c152-0001', '요즘 어떤 고객이 많아?')]);
  });
  it('기억이 사라진 뒤(재시작) 잔액 0 이어도 같은 시도는 답을 받고 다시 걷지 않는다', async () => {
    forgetPaidResultsForTest();
    await query(`UPDATE companies SET ai_credits_base_remaining = 0, ai_credits_purchased = 0 WHERE id = $1::uuid`, [CREDIT]);
    const again = await answerAsk({ user: admin, question: '요즘 어떤 고객이 많아?', attemptToken: 'tok-c152-0001' });
    expect(again.text).toBe('답 2');
    expect(ai.calls).toBe(2);
    expect(await ledgerRows()).toHaveLength(1);
    // 잔액 0 에서 새 질문 = 402(걷지 못하면 답을 주지 않는다)
    await expect(answerAsk({ user: admin, question: '다른 질문은 어때?', attemptToken: 'tok-c152-0001' })).rejects.toThrow();
    expect(ai.calls).toBe(2);
    expect(await ledgerRows()).toHaveLength(1);
  });
  it('같은 시도 표 + 다른 질문 = 새 키(새로 걷는다)', async () => {
    await query(`UPDATE companies SET ai_credits_base_remaining = 10 WHERE id = $1::uuid`, [CREDIT]);
    await answerAsk({ user: admin, question: '다른 질문은 어때?', attemptToken: 'tok-c152-0001' });
    const rows = await ledgerRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r: any) => r.idempotency_key)).size).toBe(2);
  });
  it('분류코드로 나뉜 담당자 = 403 · 원장 0 · AI 0(새 주소 · 옛 주소의 몸통 둘 다)', async () => {
    const before = [ai.calls, (await ledgerRows()).length];
    const isScoped = (e: unknown) => e instanceof UserFacingError && e.status === 403 && e.code === 'ASK_ANSWER_SCOPED';
    await expect(answerAsk({ user: staff, question: '요즘 어떤 고객이 많아?', attemptToken: 'tok-c152-0002' })).rejects.toSatisfy(isScoped);
    await expect(runCompanyExplain({ user: staff, question: '요즘 어떤 고객이 많아?', idempotencyKey: 'ai-explain:test' })).rejects.toSatisfy(isScoped);
    expect([ai.calls, (await ledgerRows()).length]).toEqual(before);
    // 옛 주소의 몸통 = 관리자는 그대로 통과(차감 한 줄)
    const out = await runCompanyExplain({ user: admin, question: '요즘 어떤 고객이 많아?', idempotencyKey: 'ai-explain:c152-old' });
    expect(out.document_titles).toContain('회사 정보');
    expect((await ledgerRows()).some((r: any) => r.idempotency_key === 'ai-explain:c152-old')).toBe(true);
  });
  it('답에 붙는 표 = 데이터 있는 것만 · 고객 묶음 표의 줄마다 묶음 키', async () => {
    const tables = await buildAskTables(SPEND, { companyId: SPEND, userId: SPEND_ADMIN, userType: 'company_admin' });
    const groups = tables.find((t) => t.key === 'groups')!;
    expect(groups.columns).toEqual(['묶음', '받을 수 있는 분', '1인 평균 구매']);
    expect(groups.rows).toEqual([['떠나는 단골', '7명', '30,000원'], ['첫 구매 직후', '4명', '—']]);
    expect(groups.groupKeys).toEqual(['leave', 'new']);
    expect(tables.map((t) => t.key)).toEqual(['groups']);   // 발송 · 상품 · 자사몰 방문이 없는 회사
  });
  it('채널별 발송 = 끝난 캠페인의 채널별 합(성과 스냅숏이 부르는 같은 함수 = 계약 K9)', async () => {
    await insertMinimalRow(pool, 'campaigns', { company_id: INF, campaign_name: 'c152 a', status: 'completed', sent_at: at(2), message_type: 'LMS', send_channel: 'sms', success_count: 9, fail_count: 1 });
    await insertMinimalRow(pool, 'campaigns', { company_id: INF, campaign_name: 'c152 b', status: 'completed', sent_at: at(3), message_type: 'SMS', send_channel: 'sms', success_count: 5, fail_count: 0 });
    const stats = await channelStats30d(INF);
    expect(stats.reduce((a, c) => a + c.sent, 0)).toBe(15);
    expect(stats.reduce((a, c) => a + c.success, 0)).toBe(14);
    expect(stats.every((c) => c.successRate > 0 && c.successRate <= 1)).toBe(true);
  });
});
