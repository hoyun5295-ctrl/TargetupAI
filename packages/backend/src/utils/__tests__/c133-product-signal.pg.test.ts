// replaces: none
/**
 * C133 F2 — 상품 신호 뿌리 · 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-1 ~ §5-2 · 대기 DDL C133-DDL-2 를 시험 안에서 얹는다)
 *   운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   1. 상품 식별 식 = SQL 과 JS 가 같은 답 · productId 가 있는 주문 줄은 주문 키 식과 같은 답
 *   2. 회사 하나를 통째로 다시 센다 = 세 꼴(items[] · 맨 위 칸 · 이름만) · 문 둘 · 취소 · 미래 · 60일 밖 · 긴 키 · 늦게 온 사건 · 지워진 사건
 *   3. 읽기 = 최근 30일과 앞 30일을 날짜로 가른다 · 다른 회사 행을 읽지 않는다
 *   4. 「보고 안 산 고객」 = 세는 길과 명단 길이 같은 답 · 산 사람(두 문) · 수신 불가 · 범위 밖을 뺀다
 *   5. 야간 한 바퀴 = 열린 회사만 세고 · 닫힌 회사의 남은 행은 지운다 · 미가입 회사는 명단에 있어도 세지 않는다
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { mallItemKeySql, mallItemKey } from '../journey-product';
import {
  PRODUCT_SIGNAL_KEEP_DAYS, SIGNAL_KEY_MAX,
  signalItemKeySql, signalItemNameSql, signalItemsSql, normNameSql,
  signalItemKey, signalItemName, signalLines, normName,
  rebuildCompanySignals, listProductSignals, productNumbersFor, hasProductSignals,
  listSearchTerms, countViewedNotBought, listViewedNotBought, countSearchedCustomers, listSearchedCustomers,
  runProductSignalPass, signalTargetCompanies, signalTargets,
} from '../product-signal';
import * as planGuard from '../plan-guard';

const CO = '00000000-0000-0000-0000-00000c133201';
const OTHER = '00000000-0000-0000-0000-00000c133202';
const FREE_CO = '00000000-0000-0000-0000-00000c133203';
const PLAN_PAID = '00000000-0000-0000-0000-00000c133211';
const PLAN_FREE = '00000000-0000-0000-0000-00000c133212';
const ADMIN = '00000000-0000-0000-0000-00000c133221';
const cust = (n: number) => `00000000-0000-0000-0000-00000c1333${String(n).padStart(2, '0')}`;
const [A, B, C, D, E, F, G, NOPHONE] = [1, 2, 3, 4, 5, 6, 7, 8].map(cust);

/** KST 오늘에서 n일 전 날짜 */
const kstDay = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
/** 그 KST 날의 hh시(timestamptz) */
const at = (n: number, hh = 12) => `${kstDay(n)}T${String(hh).padStart(2, '0')}:00:00+09:00`;

const ev = (company: string, customer: string | null, name: string, properties: any, occurredAt: string, id: string = randomUUID()) =>
  insertMinimalRow(pool, 'cdp_events', { id, company_id: company, customer_id: customer, event_name: name, source: 'test', properties, occurred_at: occurredAt });
const PAID = { revenue_applied: true, status: 'paid' };
const LONG = 'L'.repeat(300);
const LATE_ID = randomUUID();

const rowsOf = async (company: string) =>
  (await query('SELECT door, product_key, day::text AS day, product_name, views, carts, orders FROM product_signal_daily WHERE company_id = $1::uuid ORDER BY door, product_key, day', [company])).rows;
const sum = (rows: any[], door: string, key: string) => rows.filter((r) => r.door === door && r.product_key === key)
  .reduce((s, r) => ({ views: s.views + r.views, carts: s.carts + r.carts, orders: s.orders + r.orders }), { views: 0, carts: 0, orders: 0 });

const savedEnv: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ['V3_STAGE_PRODUCT_INSIGHT', 'V3_STAGE_RECO']) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  await pool.query(ledgerBlockSql('C133-DDL-2'));
  await insertMinimalRow(pool, 'plans', { id: PLAN_PAID, plan_code: 'C133PAID', plan_name: '유료', is_active: true });
  await insertMinimalRow(pool, 'plans', { id: PLAN_FREE, plan_code: 'FREE', plan_name: '미가입', is_active: true }).catch(async () => {
    // 덤프 사본에 FREE 가 이미 있으면 그 행을 쓴다
  });
  const freeId = (await query(`SELECT id FROM plans WHERE plan_code = 'FREE' LIMIT 1`)).rows[0].id;
  await insertMinimalRow(pool, 'companies', { id: CO, plan_id: PLAN_PAID });
  await insertMinimalRow(pool, 'companies', { id: OTHER, plan_id: PLAN_PAID });
  await insertMinimalRow(pool, 'companies', { id: FREE_CO, plan_id: freeId });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, login_id: 'c133admin', name: '관리자', user_type: 'admin' });
  const mk = (id: string, phone: string, extra: Record<string, unknown> = {}) =>
    insertMinimalRow(pool, 'customers', { id, company_id: CO, phone, name: `고객${phone.slice(-2)}`, is_active: true, sms_opt_in: true, ...extra });
  await mk(A, '01000001301');
  await mk(B, '01000001302');
  await mk(C, '01000001303');
  await mk(D, '01000001304');
  await mk(E, '01000001305', { sms_opt_in: false });          // 수신 동의 없음
  await mk(F, '01000001306');                                  // 수신거부
  await mk(G, '01000001307', { is_active: false });           // 비활성
  await mk(NOPHONE, '');                                       // 번호가 빈 고객(명단에 담을 수 없다)
  await insertMinimalRow(pool, 'unsubscribes', { company_id: CO, user_id: ADMIN, phone: '01000001306' });

  // ── 자사몰 조회 · 장바구니(세 꼴) ──
  const P1 = { items: [{ product_id: 'P1', product_name: '수분 크림' }] };            // SDK(GA4) 꼴
  await ev(CO, A, 'product_view', P1, at(5));
  await ev(CO, A, 'product_view', P1, at(3));
  await ev(CO, null, 'product_view', P1, at(3, 15));                                  // 비회원도 조회 수에는 든다
  await ev(CO, D, 'product_view', P1, at(2));
  await ev(CO, E, 'product_view', P1, at(2));
  await ev(CO, F, 'product_view', P1, at(2));
  await ev(CO, G, 'product_view', P1, at(2));
  await ev(CO, A, 'cart_add', { items: [{ product_id: 'P1', product_name: '수분 크림' }, { product_id: 'P9', product_name: '토너' }] }, at(3, 13));
  await ev(CO, B, 'product_view', { product_code: 'P2', product_name: '선크림' }, at(4));   // 직접 부르는 꼴(맨 위 칸)
  await ev(CO, C, 'product_view', { product_name: '세럼' }, at(4));                          // 이름만
  await ev(CO, C, 'product_view', { path: '/x' }, at(4));                                     // 상품을 모르는 조회 = 세지 않는다
  await ev(CO, D, 'product_view', { product_id: LONG, product_name: '긴 키' }, at(4));       // 표 칸보다 긴 키
  await ev(CO, NOPHONE, 'product_view', { product_id: 'P7', product_name: '번호 없는 고객이 본 상품' }, at(2));
  await ev(CO, NOPHONE, 'search', { search_term: '번호없음' }, at(2));
  await ev(CO, A, 'product_view', P1, at(45));                                               // 앞 30일(비교용)
  await ev(CO, A, 'product_view', P1, at(PRODUCT_SIGNAL_KEEP_DAYS + 5));                      // 보관 밖
  await ev(CO, A, 'product_view', P1, new Date(Date.now() + 3 * 86400000).toISOString());    // 미래 시각

  // ── 자사몰 주문 ──
  await ev(CO, A, 'purchase', { ...PAID, total_amount: 30000, items: [{ productId: 'P1', productName: '수분 크림' }, { productId: 'P1', productName: '수분 크림' }] }, at(1));   // 조회 뒤 구매 · 같은 상품 두 줄 = 주문 1
  await ev(CO, C, 'purchase', { ...PAID, revenue_reversed: true, items: [{ productId: 'P1', productName: '수분 크림' }] }, at(1));   // 취소 = 구매 아님
  await ev(CO, D, 'purchase', { status: 'pending', items: [{ productId: 'P1', productName: '수분 크림' }] }, at(1));                  // 결제 전 = 구매 아님

  // ── 매장 원장 ──
  await insertMinimalRow(pool, 'purchases', { company_id: CO, customer_id: B, customer_phone: '01000001302', purchase_date: `${kstDay(4)} 00:00:00`, product_code: 'L-77', product_name: '  선크림 ', total_amount: 12000 });   // 본 날 매장에서 삼
  await insertMinimalRow(pool, 'purchases', { company_id: CO, customer_id: D, customer_phone: '01000001304', purchase_date: `${kstDay(6)} 00:00:00`, product_code: 'L-01', product_name: '수분 크림', total_amount: 20000 });   // 보기 전에 삼
  await insertMinimalRow(pool, 'purchases', { company_id: CO, customer_id: C, customer_phone: '01000001303', purchase_date: `${kstDay(2)} 00:00:00`, product_code: 'L-77', product_name: '선크림', total_amount: -12000 });   // 환불 행

  // ── 검색 ──
  await ev(CO, A, 'search', { search_term: '  수분   크림 ' }, at(2));
  await ev(CO, D, 'search', { search_term: '수분 크림' }, at(2));
  await ev(CO, E, 'search', { search_term: '수분 크림' }, at(2));
  await ev(CO, null, 'search', { search_term: '수분 크림' }, at(2));
  await ev(CO, B, 'search', { search_term: 'SUN Cream' }, at(2));
  await ev(CO, B, 'search', {}, at(2));

  // ── 다른 회사 ──
  await ev(OTHER, null, 'product_view', P1, at(3));
  await ev(FREE_CO, null, 'product_view', P1, at(3));
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('상품 식별 — SQL 과 JS 한 벌(실 PG)', () => {
  const items = [
    { productId: 'A1', productName: '가' }, { product_id: 'B2', product_name: '나' }, { product_code: 'C3', product_name: '다' },
    { productName: '라' }, { product_name: ' 마 ' }, { productId: '  ', product_id: 'D4' }, { productId: 7 }, { price: 100 }, {},
    { productId: LONG }, { product_name: LONG },
  ];
  it('키 · 이름 식이 줄마다 JS 와 같은 답', async () => {
    for (const item of items) {
      const r = await query(`SELECT ${signalItemKeySql('x.it')} AS key, ${signalItemNameSql('x.it')} AS name FROM (SELECT $1::jsonb AS it) x`, [JSON.stringify(item)]);
      expect([r.rows[0].key, r.rows[0].name]).toEqual([signalItemKey(item), signalItemName(item)]);
    }
    expect(signalItemKey({ productId: LONG })).toHaveLength(SIGNAL_KEY_MAX);
  });

  it('productId 나 productName 으로 식별되는 주문 줄은 주문 키 식(mallItemKeySql)과 같은 답', async () => {
    for (const item of [{ productId: 'A1', productName: '가' }, { productName: '라' }, { productId: ' Z9 ' }]) {
      const r = await query(`SELECT ${signalItemKeySql('x.it')} AS s, ${mallItemKeySql('x.it')} AS m FROM (SELECT $1::jsonb AS it) x`, [JSON.stringify(item)]);
      expect(r.rows[0].s).toBe(r.rows[0].m);
      expect(signalItemKey(item)).toBe(mallItemKey(item));
    }
  });

  it('상품 줄 = items[] 가 있으면 그 줄들 · 없거나 비었으면 사건 맨 위 칸 한 줄(JS 와 같은 줄 수)', async () => {
    for (const props of [{ items: [{ product_id: 'a' }, { product_id: 'b' }] }, { items: [] }, { items: 'x', product_id: 'c' }, { product_id: 'd' }, {}]) {
      const r = await query(`SELECT COUNT(*)::int AS n FROM (SELECT $1::jsonb AS properties) e, ${signalItemsSql('e')} it`, [JSON.stringify(props)]);
      expect(r.rows[0].n).toBe(signalLines(props).length);
    }
  });

  it('이름 정리 = 앞뒤 공백 · 이어진 공백 · 대소문자 · 빈 값', async () => {
    for (const v of ['  수분   크림 ', 'SUN Cream', '   ', '']) {
      const r = await query(`SELECT ${normNameSql('$1::text')} AS n`, [v]);
      expect(r.rows[0].n).toBe(normName(v));
    }
    expect(normName('  수분   크림 ')).toBe('수분 크림');
    expect(normName(null)).toBeNull();
  });
});

describe('회사 하나를 통째로 다시 센다(실 PG)', () => {
  it('세 꼴 · 문 둘 · 취소 · 결제 전 · 미래 · 보관 밖 · 긴 키', async () => {
    await rebuildCompanySignals(CO);
    const rows = await rowsOf(CO);
    // P1: 조회 = A 2 + 비회원 1 + D · E · F · G 4 + 앞 30일 1 = 8(미래 · 보관 밖은 빠짐) · 장바구니 1 · 주문 1(취소 · 결제 전 빠짐 · 두 줄 = 1)
    expect(sum(rows, 'mall', 'P1')).toEqual({ views: 8, carts: 1, orders: 1 });
    expect(sum(rows, 'mall', 'P9')).toEqual({ views: 0, carts: 1, orders: 0 });
    expect(sum(rows, 'mall', 'P2')).toEqual({ views: 1, carts: 0, orders: 0 });     // 맨 위 칸 product_code
    expect(sum(rows, 'mall', '세럼')).toEqual({ views: 1, carts: 0, orders: 0 });   // 이름만
    expect(sum(rows, 'mall', LONG.slice(0, SIGNAL_KEY_MAX))).toEqual({ views: 1, carts: 0, orders: 0 });
    // 매장 = 다른 문 · 환불 행은 구매가 아니다
    expect(sum(rows, 'ledger', 'L-77')).toEqual({ views: 0, carts: 0, orders: 1 });
    expect(sum(rows, 'ledger', 'L-01')).toEqual({ views: 0, carts: 0, orders: 1 });
    // 날짜 = KST 날 · 이름 = 그날 마지막 이름
    const p1day3 = rows.find((r: any) => r.door === 'mall' && r.product_key === 'P1' && r.day === kstDay(3));
    expect(p1day3).toMatchObject({ views: 2, carts: 1, product_name: '수분 크림' });
    expect(rows.some((r: any) => r.day < kstDay(PRODUCT_SIGNAL_KEEP_DAYS - 1) || r.day > kstDay(0))).toBe(false);
    expect(rows.every((r: any) => r.product_key.length <= SIGNAL_KEY_MAX)).toBe(true);
  });

  it('다시 돌려도 같은 행 · 늦게 온 옛 사건이 든다 · 지워진 사건이 빠진다(커서 없음 = 통째로)', async () => {
    const before = await rowsOf(CO);
    await rebuildCompanySignals(CO);
    expect(await rowsOf(CO)).toEqual(before);
    await ev(CO, B, 'product_view', { product_id: 'P1', product_name: '수분 크림 (리뉴얼)' }, at(20), LATE_ID);   // 20일 전 사건이 오늘 들어옴
    await rebuildCompanySignals(CO);
    expect(sum(await rowsOf(CO), 'mall', 'P1').views).toBe(9);
    await query('DELETE FROM cdp_events WHERE id = $1::uuid', [LATE_ID]);
    await rebuildCompanySignals(CO);
    expect(await rowsOf(CO)).toEqual(before);
  });

  it('다른 회사의 행을 건드리지 않는다', async () => {
    await rebuildCompanySignals(OTHER);
    const other = await rowsOf(OTHER);
    await rebuildCompanySignals(CO);
    expect(await rowsOf(OTHER)).toEqual(other);
    expect(other).toHaveLength(1);
  });
});

describe('읽기(실 PG)', () => {
  it('상품 표 = 최근 30일 · 앞 30일은 비교 칸 · 조회 많은 순 · 다른 회사 0', async () => {
    const list = await listProductSignals(CO);
    const p1 = list.find((r) => r.door === 'mall' && r.key === 'P1')!;
    expect(p1).toMatchObject({ name: '수분 크림', views: 7, carts: 1, orders: 1, prevViews: 1, prevOrders: 0 });
    expect(list[0].key).toBe('P1');
    expect(list.map((r) => `${r.door}:${r.key}`)).toContain('ledger:L-77');
    expect((await listProductSignals(CO, 2)).length).toBe(2);
    expect((await listProductSignals(OTHER)).map((r) => r.views)).toEqual([1]);
    expect(await listProductSignals(FREE_CO)).toEqual([]);
  });

  it('고른 상품의 숫자 = 문 · 키로 · 관측 없는 키는 결과에 없다', async () => {
    const m = await productNumbersFor(CO, 'mall', ['P1', 'P2', '없는상품']);
    expect(m.get('P1')).toEqual({ views: 7, carts: 1, orders: 1 });
    expect(m.get('P2')).toEqual({ views: 1, carts: 0, orders: 0 });
    expect(m.has('없는상품')).toBe(false);
    expect((await productNumbersFor(CO, 'ledger', ['P1'])).size).toBe(0);   // 몰 123번 ≠ 매장 123번
    expect((await productNumbersFor(OTHER, 'mall', ['P1'])).get('P1')!.views).toBe(1);
    expect(await hasProductSignals(CO)).toBe(true);
    expect(await hasProductSignals(FREE_CO)).toBe(false);
  });

  it('검색어 = 공백 · 대소문자를 정리해 묶는다 · 검색 수와 식별 고객 수 · 빈 검색어 제외', async () => {
    const terms = await listSearchTerms(CO);
    expect(terms[0]).toEqual({ term: '수분 크림', searches: 4, customers: 3 });   // 검색 많은 순
    // 검색 수가 같은 줄의 차례는 DB 정렬 규칙(글자 순)을 따른다 — 여기서는 내용만 본다
    expect(terms.slice(1).sort((a, b) => (a.term < b.term ? -1 : 1))).toEqual([
      { term: 'sun cream', searches: 1, customers: 1 },
      { term: '번호없음', searches: 1, customers: 1 },
    ]);
    expect(await listSearchTerms(OTHER)).toEqual([]);
  });
});

describe('「보고 안 산 고객」 · 「이 말을 찾은 고객」 — 세는 길 = 명단 길(실 PG)', () => {
  it('P1: 본 사람 A · D · E · F · G 중 A(뒤에 삼) · E(동의 없음) · F(수신거부) · G(비활성)를 빼고 D 만', async () => {
    const counts = await countViewedNotBought(CO, ADMIN, ['P1', 'P2', '세럼']);
    const list = await listViewedNotBought(CO, ADMIN, 'P1');
    expect(list.recipients).toEqual([{ phone: '01000001304', name: '고객04' }]);   // D — 보기 전의 매장 구매는 「그 뒤 산 것」이 아니다
    expect(counts.get('P1')).toBe(list.total);
    expect(list.truncated).toBe(false);
  });

  it('P2: B 는 본 날 매장에서 같은 이름을 샀다 = 뺀다(문을 넘는 같은 상품 = 이름) · 세럼: C 는 안 샀다(환불 행은 구매가 아님)', async () => {
    const counts = await countViewedNotBought(CO, ADMIN, ['P1', 'P2', '세럼']);
    expect(counts.get('P2') ?? 0).toBe(0);
    expect((await listViewedNotBought(CO, ADMIN, 'P2')).recipients).toEqual([]);
    expect(counts.get('세럼')).toBe(1);
    expect((await listViewedNotBought(CO, ADMIN, '세럼')).recipients.map((r) => r.phone)).toEqual(['01000001303']);
  });

  it('번호가 빈 고객은 세지도 담지도 않는다(세는 길 = 명단 길)', async () => {
    expect((await countViewedNotBought(CO, ADMIN, ['P7'])).get('P7') ?? 0).toBe(0);
    expect((await listViewedNotBought(CO, ADMIN, 'P7')).total).toBe(0);
    expect((await countSearchedCustomers(CO, ADMIN, ['번호없음'])).get('번호없음')).toBe(0);
    expect((await listSearchedCustomers(CO, ADMIN, '번호없음')).total).toBe(0);
  });

  it('다른 회사 · 빈 키 = 0', async () => {
    expect((await listViewedNotBought(OTHER, null, 'P1')).total).toBe(0);
    expect((await listViewedNotBought(CO, ADMIN, '  ')).total).toBe(0);
    expect((await countViewedNotBought(CO, ADMIN, [])).size).toBe(0);
  });

  it('검색 고객: 「수분 크림」 = A · D(동의 없는 E · 비회원 제외) · 화면이 보낸 꼴이 달라도 같은 정리', async () => {
    const list = await listSearchedCustomers(CO, ADMIN, ' 수분  크림');
    expect(list.recipients.map((r) => r.phone)).toEqual(['01000001301', '01000001304']);
    const counts = await countSearchedCustomers(CO, ADMIN, ['수분 크림', 'SUN CREAM', '없는말']);
    expect(counts.get('수분 크림')).toBe(list.total);
    expect(counts.get('sun cream')).toBe(1);
    expect(counts.get('없는말')).toBe(0);
    expect((await listSearchedCustomers(OTHER, null, '수분 크림')).total).toBe(0);
  });
});

describe('야간 한 바퀴 — 열린 회사만(실 PG)', () => {
  it('ENV 명단이 비면 아무 회사도 세지 않고 남은 행은 지운다', async () => {
    expect(await signalTargetCompanies()).toEqual([]);
    const r = await runProductSignalPass();
    expect(r.rebuilt).toBe(0);
    expect(r.cleared).toBeGreaterThanOrEqual(2);   // 위 시험이 채운 CO · OTHER
    expect(await rowsOf(CO)).toEqual([]);
    expect(await rowsOf(OTHER)).toEqual([]);
  });

  it('명단에 든 유료 회사만 센다 · ⛔ 미가입 회사는 명단에 있어도 세지 않는다', async () => {
    process.env.V3_STAGE_PRODUCT_INSIGHT = `${CO}, ${FREE_CO}`;
    expect(await signalTargetCompanies()).toEqual([CO]);
    const r = await runProductSignalPass();
    expect(r).toMatchObject({ ran: true, rebuilt: 1, failed: 0 });
    expect((await rowsOf(CO)).length).toBeGreaterThan(0);
    expect(await rowsOf(OTHER)).toEqual([]);
    expect(await rowsOf(FREE_CO)).toEqual([]);
  });

  it('첫 채우기(onlyMissing) = 행이 없는 열린 회사만 · 이미 있는 회사는 건드리지 않는다', async () => {
    process.env.V3_STAGE_RECO = OTHER;   // 추천만 열린 회사도 뿌리는 센다
    await query(`UPDATE product_signal_daily SET views = 999 WHERE company_id = $1::uuid AND product_key = 'P1' AND day = $2::date`, [CO, kstDay(3)]);
    const r = await runProductSignalPass({ onlyMissing: true });
    expect(r.rebuilt).toBe(1);
    expect((await rowsOf(OTHER)).length).toBe(1);
    expect((await rowsOf(CO)).find((x: any) => x.product_key === 'P1' && x.day === kstDay(3)).views).toBe(999);
    await runProductSignalPass();   // 밤 계산은 통째로 다시 센다
    expect((await rowsOf(CO)).find((x: any) => x.product_key === 'P1' && x.day === kstDay(3)).views).toBe(2);
  });

  it('★ Codex 구현 1R — 요금제를 읽지 못한 회사는 세지도 지우지도 않는다(모르면 지우지 않는다)', async () => {
    process.env.V3_STAGE_PRODUCT_INSIGHT = CO;
    delete process.env.V3_STAGE_RECO;
    await runProductSignalPass();
    const before = await rowsOf(CO);
    expect(before.length).toBeGreaterThan(0);
    const spy = vi.spyOn(planGuard, 'loadPlanContext').mockRejectedValue(new Error('plan lookup down'));
    try {
      expect(await signalTargets()).toEqual({ open: [], unknown: [CO] });
      const r = await runProductSignalPass();
      expect(r).toMatchObject({ rebuilt: 0, cleared: 0 });
      expect(await rowsOf(CO)).toEqual(before);          // 옛 행 그대로
    } finally {
      spy.mockRestore();
    }
    // 닫힌 것이 확인되면(명단에서 뺌) 그때 지운다
    delete process.env.V3_STAGE_PRODUCT_INSIGHT;
    expect((await runProductSignalPass()).cleared).toBeGreaterThanOrEqual(1);
    expect(await rowsOf(CO)).toEqual([]);
  });

  it('전 회사(*) = 유료 회사 전부가 후보 · 미가입은 빠진다', async () => {
    process.env.V3_STAGE_PRODUCT_INSIGHT = '*';
    delete process.env.V3_STAGE_RECO;
    const ids = await signalTargetCompanies();
    expect(ids).toContain(CO);
    expect(ids).toContain(OTHER);
    expect(ids).not.toContain(FREE_CO);
  });
});
