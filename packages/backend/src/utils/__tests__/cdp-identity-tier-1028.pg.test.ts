// replaces: none
/**
 * 식별 신뢰 등급 · 브라우저는 잇기만 — 실 PostgreSQL 판(★ 2026-10-28 자사몰 대비 K4 · I5 · M5 · M6 · 계약 R23)
 *
 * 주장이 SQL 의미론에 기댄다: COALESCE 방향(빈 칸만) · 같은 번호 행 충돌 갈래(ON CONFLICT DO UPDATE) · 서버 연결 고객 수(DISTINCT · 둘 이상 = 익명).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';

vi.mock('../unified-customer-profile', () => ({ recomputeProfile: vi.fn(async () => undefined) }));

import { identifyCustomer, linkBrowserMember } from '../cdp-identity';

const CO = '00000000-0000-0000-0000-0000000000c2';
const cust = async (id: string): Promise<any> =>
  (await query(`SELECT name, email, phone, address FROM customers WHERE id = $1::uuid`, [id])).rows[0];

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
});

describe('K4 · 주문자 정보(tier order)는 빈 칸만 채운다', () => {
  it('회원 정보로 만든 고객의 이름 · 전화를 주문이 덮지 않는다 · 빈 이메일 · 주소는 채운다', async () => {
    const a = await identifyCustomer(CO, { source: 'woocommerce', externalId: 'm1:1', phone: '01000000101', name: '회원이름' });
    await identifyCustomer(CO, {
      tier: 'order', source: 'woocommerce', externalId: 'm1:1',
      phone: '01000000102', name: '받는사람', email: 'buyer-1@example.invalid', address: '주소1',
    });
    expect(await cust(a.customerId)).toMatchObject({ name: '회원이름', phone: '01000000101', email: 'buyer-1@example.invalid', address: '주소1' });
  });

  it('회원 정보(profile)는 지금처럼 들어온 값으로 고친다(대조)', async () => {
    const a = await identifyCustomer(CO, { source: 'woocommerce', externalId: 'm1:2', phone: '01000000201', name: '옛이름' });
    await identifyCustomer(CO, { source: 'woocommerce', externalId: 'm1:2', phone: '01000000202', name: '새이름' });
    expect(await cust(a.customerId)).toMatchObject({ name: '새이름', phone: '01000000202' });
  });

  it('같은 번호의 비활성 행과 부딪히는 갈래(ON CONFLICT)도 주문이면 빈 칸만', async () => {
    await query(
      `INSERT INTO customers (id, company_id, phone, name, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, '01000000301', '그전이름', false, NOW(), NOW())`,
      [CO],
    );
    const r = await identifyCustomer(CO, { tier: 'order', source: 'woocommerce', externalId: 'guest:o-3', phone: '01000000301', name: '주문자', email: 'buyer-3@example.invalid' });
    expect(await cust(r.customerId)).toMatchObject({ name: '그전이름', email: 'buyer-3@example.invalid' });
  });
});

describe('K4 · 브라우저 회원은 서버 연결이 가리키는 고객 하나에만 잇는다', () => {
  it('서버 연결이 하나면 그 고객 · 브라우저 연결(sdk)도 그 고객으로 맞춘다 · 고객 칸은 그대로', async () => {
    const a = await identifyCustomer(CO, { source: 'woocommerce', externalId: 'm1:4', phone: '01000000401', name: '회원4' });
    const before = await cust(a.customerId);
    const r = await linkBrowserMember(CO, 'm1:4');
    expect(r?.customerId).toBe(a.customerId);
    const sdk = (await query(`SELECT customer_id FROM cdp_identity_links WHERE company_id = $1::uuid AND source = 'sdk' AND external_id = 'm1:4'`, [CO])).rows;
    expect(sdk).toEqual([{ customer_id: a.customerId }]);
    expect(await cust(a.customerId)).toEqual(before);
  });

  it('같은 회원 번호의 서버 연결이 서로 다른 고객 둘을 가리키면 익명(null)', async () => {
    await identifyCustomer(CO, { source: 'cafe24', externalId: 'dup-5', phone: '01000000501' });
    await identifyCustomer(CO, { source: 'imweb', externalId: 'dup-5', phone: '01000000502' });
    expect(await linkBrowserMember(CO, 'dup-5')).toBeNull();
  });

  it('브라우저 연결(sdk)만 있고 서버 연결이 없으면 익명(null · 옛 브라우저 identify 가 만든 연결은 근거가 아니다)', async () => {
    const a = await identifyCustomer(CO, { source: 'sdk', externalId: 'only-sdk-6', phone: '01000000601' });
    expect(a.customerId).toBeTruthy();
    expect(await linkBrowserMember(CO, 'only-sdk-6')).toBeNull();
  });
});

describe('Codex R1 #5 · 몰 서버 비밀키 호출이 만든 sdk 연결 = 브라우저 잇기의 근거(서버 확인 표시)', () => {
  it('칸이 없을 때(DDL-4 전) = 지금 동작(서버 호출이어도 sdk 연결은 근거 아님 · 표시 건너뜀) · 칸이 생긴 뒤 = 서버 확인 연결만 잇는다 · 옛 브라우저 연결은 안 잇는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await identifyCustomer(CO, { source: 'sdk', externalId: 'srv-7', phone: '01000000701', serverVerified: true });
    expect(await linkBrowserMember(CO, 'srv-7')).toBeNull();

    await query(`ALTER TABLE cdp_identity_links ADD COLUMN server_verified_at timestamptz NULL`);   // 원장 C73-DDL-4(이 시험 DB 안에서만)
    const s = await identifyCustomer(CO, { source: 'sdk', externalId: 'srv-8', phone: '01000000801', serverVerified: true });
    const old = await identifyCustomer(CO, { source: 'sdk', externalId: 'old-9', phone: '01000000901' });   // 옛 브라우저 identify 꼴(표시 없음)
    expect((await linkBrowserMember(CO, 'srv-8'))?.customerId).toBe(s.customerId);
    expect(await linkBrowserMember(CO, 'old-9')).toBeNull();
    expect(old.customerId).toBeTruthy();
    // 옛 브라우저 연결이 다른 고객을 가리키면 서버 호출이 와도 근거(전화 · 이메일)가 안 맞아 승격하지 않는다(Codex R2 #2)
    await identifyCustomer(CO, { source: 'sdk', externalId: 'old-10', phone: '01000001001' });
    await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'old-10', phone: '01000001099', serverVerified: true });
    expect(await linkBrowserMember(CO, 'old-10')).toBeNull();
    await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'old-10', serverVerified: true });   // 근거 없음 = 미확인 그대로
    expect(await linkBrowserMember(CO, 'old-10')).toBeNull();
    // 이 요청이 채운 이메일을 근거로 쓰지 않는다(Codex R3 #1 · 기존 고객 A 의 빈 이메일을 서버가 보낸 B 이메일로 채운 뒤 일치로 읽던 길)
    await identifyCustomer(CO, { source: 'sdk', externalId: 'old-11', phone: '01000001101' });
    await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'old-11', phone: '01000001199', email: 'b-11@example.invalid', serverVerified: true });
    expect(await linkBrowserMember(CO, 'old-11')).toBeNull();
    // 같은 불일치 요청을 두 번 보내도(앞 호출이 채운 이메일) 승격 0(Codex R4 #1) · 연락처가 맞아도 있던 미확인 연결은 승격 0(구조 = 처음 만든 연결만)
    await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'old-11', phone: '01000001199', email: 'b-11@example.invalid', serverVerified: true });
    expect(await linkBrowserMember(CO, 'old-11')).toBeNull();
    await identifyCustomer(CO, { source: 'sdk', externalId: 'old-12', phone: '01000001201' });
    await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'old-12', phone: '010-0000-1201', serverVerified: true });
    expect(await linkBrowserMember(CO, 'old-12')).toBeNull();
    // 고객 없는 연결(익명 연결)에 서버 호출이 고객을 붙이면 = 처음 정한 것 = 확인
    await query(`INSERT INTO cdp_identity_links (id, company_id, customer_id, source, external_id, created_at, updated_at) VALUES (gen_random_uuid(), $1::uuid, NULL, 'sdk', 'anon-13', NOW(), NOW())`, [CO]);
    const anon = await identifyCustomer(CO, { source: 'sdk', externalId: 'anon-13', phone: '01000001301', serverVerified: true });
    expect((await linkBrowserMember(CO, 'anon-13'))?.customerId).toBe(anon.customerId);
    // 연결 · 표시 = 한 문장(Codex R5 #1) — 식별이 중간에 던져도(휴대폰 없음) 표시된 고객 없는 연결이 남고 다시 시도가 그 연결에 고객을 붙인다
    await expect(identifyCustomer(CO, { source: 'sdk', externalId: 'retry-15', serverVerified: true })).rejects.toThrow();
    expect((await query(`SELECT customer_id, server_verified_at IS NOT NULL AS v FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = 'retry-15'`, [CO])).rows[0]).toEqual({ customer_id: null, v: true });
    const re = await identifyCustomer(CO, { source: 'sdk', externalId: 'retry-15', phone: '01000001501', serverVerified: true });
    expect((await linkBrowserMember(CO, 'retry-15'))?.customerId).toBe(re.customerId);
    // 주문 경로(/order)가 처음 만든 연결도 같은 표시
    const o = await identifyCustomer(CO, { tier: 'order', source: 'sdk', externalId: 'srv-14', phone: '01000001401', serverVerified: true });
    expect((await linkBrowserMember(CO, 'srv-14'))?.customerId).toBe(o.customerId);
    expect(s.customerId).toBeTruthy();
  });
});
