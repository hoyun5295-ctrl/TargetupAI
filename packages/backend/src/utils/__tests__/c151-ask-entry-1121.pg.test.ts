// replaces: none
/**
 * C151 한 줄로 묻기 — 실 PostgreSQL 판(★ 2026-11-21 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §5)
 *   운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · 새 표 · 새 칸 0).
 *   1. 칸 판정 경계(한국 날짜 30 · 31 · 90 · 91 · 180 · 181 · 365 · 366 · 미래 · NULL · 횟수 NULL · 0 · 1 · 2 · 3 · 4)
 *   2. 수신거부 · 미동의 · 무효 · 수신거부 표 · 비활성 · 다른 회사 · 담당자 범위 밖이 빠진다
 *   3. 세기 = 명단 수 · 칸끼리 같은 번호 = 한 번 · 예산 인원을 같은 번호가 깎지 않는다 · 순서 두 갈래
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import {
  askCellSql, countAskCells, countAskPlan, listAskAudience, readAskPrice, type AskPlanInput, type AskPrice,
} from '../ask-segments';

const CO = '00000000-0000-0000-0000-00000c151001';
const OTHER = '00000000-0000-0000-0000-00000c151002';
const NOPRICE = '00000000-0000-0000-0000-00000c151003';
const ADMIN = '00000000-0000-0000-0000-00000c151011';
const STAFF = '00000000-0000-0000-0000-00000c151012';
const cust = (n: number) => `00000000-0000-0000-0000-00000c1512${String(n).padStart(2, '0')}`;
const phone = (n: number) => `010000015${String(n).padStart(2, '0')}`;

/** KST 오늘에서 n일 전 날짜(음수 = 미래) */
const kstDay = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);

/** [번호, 지난 일수(null = 구매 기록 없음), 구매 횟수, 기대 칸] */
const BOUNDARY: Array<[number, number | null, number | null, string]> = [
  [1, 0, 1, 'r0c0'], [2, 30, 0, 'r0c0'], [3, 31, null, 'r1c0'], [4, 90, 2, 'r1c1'], [5, 91, 3, 'r2c1'],
  [6, 180, 4, 'r2c2'], [7, 181, 1, 'r3c0'], [8, 365, 9, 'r3c2'], [9, 366, 4, 'r4c2'], [10, -3, 2, 'r0c1'],
  [11, null, 5, 'nobuy'], [12, 400, 3, 'r4c1'],
];

const ALL = (groups: AskPlanInput['groups'], order: AskPlanInput['order'] = 'recent'): AskPlanInput => ({ groups, mode: 'all', budget: null, order });
const BUDGET = (groups: AskPlanInput['groups'], budget: number, order: AskPlanInput['order'] = 'recent'): AskPlanInput => ({ groups, mode: 'budget', budget, order });

let price: AskPrice;

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, cost_per_lms: 30, unit_price_basis: 'vat_included' });
  await insertMinimalRow(pool, 'companies', { id: OTHER, cost_per_lms: 30, unit_price_basis: 'vat_included' });
  await insertMinimalRow(pool, 'companies', { id: NOPRICE });
  await query('UPDATE companies SET cost_per_lms = NULL WHERE id = $1', [NOPRICE]);
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, login_id: 'c151admin', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: STAFF, company_id: CO, login_id: 'c151staff', name: '담당자', user_type: 'user', store_codes: ['S151'] });
  const mk = (n: number, days: number | null, count: number | null, extra: Record<string, unknown> = {}, company = CO) =>
    insertMinimalRow(pool, 'customers', {
      id: cust(n), company_id: company, phone: phone(n), name: `고객${n}`, is_active: true, sms_opt_in: true,
      recent_purchase_date: days === null ? null : kstDay(days), purchase_count: count, ...extra,
    });
  for (const [n, d, c] of BOUNDARY) await mk(n, d, c);
  // 빠질 고객(모두 떠나는 단골 칸 = 400일 · 5번)
  await mk(21, 400, 5, { is_opt_out: true });
  await mk(22, 400, 5, { sms_opt_in: false });
  await mk(23, 400, 5, { is_invalid: true });
  await mk(24, 400, 5);
  await insertMinimalRow(pool, 'unsubscribes', { company_id: CO, user_id: ADMIN, phone: phone(24) });
  await mk(25, 400, 5, { is_active: false });
  await mk(26, 400, 5, {}, OTHER);
  await mk(27, 400, 5, { phone: '' });
  // 칸끼리 같은 번호(떠나는 단골 r4c2 ↔ 오래 쉰 고객 r4c0 · 공백만 다른 같은 번호) · 최근 순 대표 = 최근 구매가 더 최근인 31
  await mk(31, 368, 6);
  await mk(32, 370, 1, { phone: ` ${phone(31)} ` });
  // 예산 순서 확인용(오래 쉰 고객 · 최근 순 = 33 → 34 → 35)
  await mk(33, 367, 1);
  await mk(34, 380, 1);
  await mk(35, 390, 1);
  // 담당자 범위: 1 · 4 만 S151 소속(분류 체계가 있는 회사 = 소속 없는 고객은 그 담당자에게 0)
  for (const n of [1, 4]) await insertMinimalRow(pool, 'customer_stores', { company_id: CO, customer_id: cust(n), store_code: 'S151' });
  price = await readAskPrice(CO);
});

describe('C151 칸 판정 경계(한국 날짜)', () => {
  it('일수 · 횟수 경계가 설계서 표대로 한 칸에만 든다', async () => {
    const r = await query(`SELECT c.id, ${askCellSql('c')} AS cell FROM customers c WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[])`, [CO, BOUNDARY.map(([n]) => cust(n))]);
    const got = new Map(r.rows.map((x: any) => [x.id, x.cell]));
    for (const [n, , , cell] of BOUNDARY) expect([n, got.get(cust(n))]).toEqual([n, cell]);
  });

  it('칸마다 수 = 활성 고객 · 보낼 수 있는 번호(안내용) · 다른 회사 0', async () => {
    const { cells, nobuy } = await countAskCells(CO, ADMIN);
    const by = new Map(cells.map((c) => [c.key, c]));
    expect(cells).toHaveLength(15);
    expect(nobuy).toEqual({ total: 1, sendable: 1, spendSum: 0, spendN: 0 });   // ★ C152 C 구매액 칸(이 회사 고객은 누적 구매액이 없다)
    expect(by.get('r0c0')).toMatchObject({ total: 2, sendable: 2, group: 'new' });
    // r4c2 = 9 · 21 · 22 · 23 · 24 · 27 · 31(활성 7) 중 보낼 수 있는 번호 = 9 · 31
    expect(by.get('r4c2')).toMatchObject({ total: 7, sendable: 2, group: 'leave' });
  });
});

describe('C151 대상 한 문장(§2-1)', () => {
  it('떠나는 단골 = 수신거부 · 미동의 · 무효 · 수신거부 표 · 비활성 · 다른 회사 · 빈 번호가 빠진다 · 세기 = 명단', async () => {
    const plan = ALL(['leave']);
    const c = (await countAskPlan(CO, ADMIN, plan, price))!;
    const l = (await listAskAudience(CO, ADMIN, plan, price))!;
    expect(l.recipients.map((x) => x.phone).sort()).toEqual([phone(8), phone(9), phone(31)].sort());
    expect([c.sendable, c.planned, l.recipients.length, l.total]).toEqual([3, 3, 3, 3]);
    expect(c.inScope).toBe(8);   // 8 · 9 · 21 · 22 · 23 · 24 · 27 · 31(비활성 25 · 다른 회사 26 제외)
    expect(c.amount).toBe(90);
  });

  it('칸끼리 같은 번호 = 한 번(대표 = 요청 순서의 앞 행) · 칸별 수 합 = 세기', async () => {
    const plan = ALL(['leave', 'rest']);
    const c = (await countAskPlan(CO, ADMIN, plan, price))!;
    const l = (await listAskAudience(CO, ADMIN, plan, price))!;
    const phones = l.recipients.map((x) => x.phone);
    expect(new Set(phones).size).toBe(phones.length);
    expect(phones.filter((p) => p === phone(31))).toHaveLength(1);
    expect(c.sendable).toBe(l.recipients.length);
    expect(c.sendable).toBe(8);   // 8 · 9 · 31 / 7 · 12 · 33 · 34 · 35(32 = 31 과 같은 번호)
    expect(c.cells.reduce((s, x) => s + x.n, 0)).toBe(c.sendable);
    // 대표 = 최근 구매가 더 최근(368일)인 31 의 칸(r4c2) · 32(370일 · r4c0)는 세지 않는다
    expect(c.cells.find((x) => x.key === 'r4c2')?.n).toBe(2);
    expect(c.cells.find((x) => x.key === 'r4c0')?.n).toBe(3);
  });

  it('예산 = floor(예산 / 장문 단가) 명 · 최근 순', async () => {
    // 오래 쉰 고객(r3c0 · r3c1 · r4c0 · r4c1) = 7(181일) · 12(400일) · 32(370일 · 31 과 같은 번호) · 33(367) · 34(380) · 35(390)
    const plan = BUDGET(['rest'], 120);   // 30원 → 4명
    const c = (await countAskPlan(CO, ADMIN, plan, price))!;
    const l = (await listAskAudience(CO, ADMIN, plan, price))!;
    expect(l.recipients.map((x) => x.phone)).toEqual([phone(7), phone(33), phone(31), phone(34)]);
    expect([c.planned, c.amount, l.total, l.truncated]).toEqual([4, 120, 4, false]);
    expect(c.sendable).toBe(6);
    expect(c.cells.reduce((s, x) => s + x.taken, 0)).toBe(4);
  });

  it('같은 번호가 예산 인원을 깎지 않는다 · 같은 번호 뒤의 다른 번호로 채운다', async () => {
    // 떠나는 단골 + 오래 쉰 고객 · 최근 순 = 7(181) · 8(365) · 9(366) · 33(367) · 31(368 · 32 와 같은 번호) · [32(370) 빠짐] · 34(380)
    const five = (await listAskAudience(CO, ADMIN, BUDGET(['leave', 'rest'], 150), price))!;
    expect(five.recipients.map((x) => x.phone)).toEqual([phone(7), phone(8), phone(9), phone(33), phone(31)]);
    const six = (await listAskAudience(CO, ADMIN, BUDGET(['leave', 'rest'], 180), price))!;
    expect(six.recipients.map((x) => x.phone)).toEqual([phone(7), phone(8), phone(9), phone(33), phone(31), phone(34)]);
    expect((await countAskPlan(CO, ADMIN, BUDGET(['leave', 'rest'], 180), price))?.planned).toBe(6);
  });

  it('많이 산 분부터 = 구매 횟수 내림차순 · 같은 횟수는 최근 구매 순', async () => {
    const l = (await listAskAudience(CO, ADMIN, ALL(['leave', 'next', 'loyal', 'fade'], 'count'), price))!;
    // leave: 8(9번 · 365일) · 31(6번 · 368일) · 9(4번 · 366일) / fade: 6(4번 · 180일) · 5(3번) / next: 3(NULL) / loyal: 4(2번 · 90일) · 10(2번 · 미래)
    expect(l.recipients.map((x) => x.phone)).toEqual([phone(8), phone(31), phone(6), phone(9), phone(5), phone(10), phone(4), phone(3)]);
  });

  it('담당자 = 자기 범위(소속 표)만 · 범위 밖은 세지도 담지도 않는다', async () => {
    const c = (await countAskPlan(CO, STAFF, ALL(['new', 'next', 'loyal']), price))!;
    const l = (await listAskAudience(CO, STAFF, ALL(['new', 'next', 'loyal']), price))!;
    expect(l.recipients.map((x) => x.phone).sort()).toEqual([phone(1), phone(4)].sort());
    expect([c.sendable, c.inScope]).toEqual([2, 2]);
    const cells = await countAskCells(CO, STAFF);
    expect(cells.cells.reduce((s, x) => s + x.total, 0) + cells.nobuy.total).toBe(2);
  });

  it('단가 미설정 회사 = 예산 불가(null) · 모두는 센다', async () => {
    const p = await readAskPrice(NOPRICE);
    expect(p.unset).toBe(true);
    expect(await countAskPlan(NOPRICE, null, BUDGET(['leave'], 10_000), p)).toBeNull();
    expect(await listAskAudience(NOPRICE, null, BUDGET(['leave'], 10_000), p)).toBeNull();
    expect((await countAskPlan(NOPRICE, null, ALL(['leave']), p))?.sendable).toBe(0);
  });
});
