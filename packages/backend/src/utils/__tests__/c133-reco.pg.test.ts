// replaces: none
/**
 * C133 F2 ① — 고객별 추천 상품 고르기 · 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-4 · 대기 DDL C133-DDL-2 를 시험 안에서 얹는다)
 *   운영 문장(RECO_PICK_SQL)을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   1. 고르기 세 갈래 = 본 뒤 안 산 후보 중 가장 최근에 본 것 → 후보 순서에서 안 산 첫 후보 → 없음(대체 문장)
 *   2. 「산 것」 = 두 문(자사몰 결제 주문 · 매장 원장) · 같은 이름 또는 같은 문의 같은 키 · 취소 주문 · 환불 행은 산 것이 아니다
 *   3. 끊긴 후보(최근 30일 관측 없음)는 건너뛴다 · 다른 회사의 관측 · 구매 · 조회를 읽지 않는다
 *   4. 후보 제안 = 판매 · 조회 위 순 · 이름이 같은 두 문의 상품은 한 줄 · 쓸 수 없는 이름은 뺀다
 *   6. 받는 사람용 반응 숫자 글자 = 이름마다 최근 30일 조회 수(같은 이름의 상품은 더한다 · 조회 없는 이름은 없다 · 회사 격리)
 *   5. 렌더 = 고른 후보가 자리에 들어간다 · 판 강제 · 자리 없는 글은 기존 길의 결과와 글자 그대로 같다 · 후보가 변수로 다시 읽히지 않는다
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { rebuildCompanySignals, normNameSql, normName } from '../product-signal';
import { pickRecoIndex, recoTextFor, suggestRecoCandidates, recoCandidatesFor, signalTextsFor } from '../product-reco';
import { readRecoSlot, RecoSlotLostError } from '../reco-slot';
import { renderJourneySmsMessage, loadJourneyRenderShared } from '../journey-message-render';
import { prepareSendMessage } from '../messageUtils';
import { sanitizeUnsendableForSms } from '../message-sanitizer';
import { resolveJourneyAdFlag } from '../journey-ad-policy';
import {
  resolveCustomerRecipients, resolveCustomerRecipientsByFilter, resolveCustomerRecipientsWhere, getCampaignResendRecipients, type EmailRecipient,
} from '../email-channel';
import { markRecoFront } from '../dm/dm-reco-order';

const CO = '00000000-0000-0000-0000-00000c133501';
const OTHER = '00000000-0000-0000-0000-00000c133502';
const PLAN = '00000000-0000-0000-0000-00000c133511';
const cust = (n: number) => `00000000-0000-0000-0000-00000c1335${String(20 + n)}`;
const [A, B, C, D, E, F, G, H, I, J, K, L] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(cust);
const OTHER_CUST = '00000000-0000-0000-0000-00000c133540';

const kstDay = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
const at = (n: number, hh = 12) => `${kstDay(n)}T${String(hh).padStart(2, '0')}:00:00+09:00`;
const ev = (company: string, customer: string | null, name: string, properties: any, occurredAt: string) =>
  insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: company, customer_id: customer, event_name: name, source: 'test', properties, occurred_at: occurredAt });
const PAID = { revenue_applied: true, status: 'paid' };
const view = (customer: string, item: any, when: string, company = CO) => ev(company, customer, 'product_view', { items: [item] }, when);
const buy = (customer: string, items: any[], when: string, extra: any = {}, company = CO) => ev(company, customer, 'purchase', { ...PAID, total_amount: 10000, items, ...extra }, when);
const ledger = (customer: string, phone: string, name: string, day: number, amount = 10000, code = 'L-01', company = CO) =>
  insertMinimalRow(pool, 'purchases', { company_id: company, customer_id: customer, customer_phone: phone, purchase_date: `${kstDay(day)} 00:00:00`, product_code: code, product_name: name, total_amount: amount });

const CREAM = { product_id: 'P1', product_name: '수분 크림' };
const SUN = { product_id: 'P2', product_name: '선크림' };
const SERUM = { product_name: '세럼' };   // 이름만 싣는 꼴
const NAMES = ['수분 크림', '선크림', '세럼'];

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C133-DDL-2'));
  await insertMinimalRow(pool, 'plans', { id: PLAN, plan_code: 'C133RECO', plan_name: '유료', is_active: true });
  await insertMinimalRow(pool, 'companies', { id: CO, plan_id: PLAN });
  await insertMinimalRow(pool, 'companies', { id: OTHER, plan_id: PLAN });
  let n = 0;
  for (const id of [A, B, C, D, E, F, G, H, I, J, K, L]) {
    n += 1;
    await insertMinimalRow(pool, 'customers', { id, company_id: CO, phone: `010000015${String(n).padStart(2, '0')}`, name: `고객${n}`, is_active: true, sms_opt_in: true });
  }
  await insertMinimalRow(pool, 'customers', { id: OTHER_CUST, company_id: OTHER, phone: '01000001599', name: '남의고객', is_active: true, sms_opt_in: true });

  // A — 수분 크림을 5일 전 · 선크림을 3일 전에 봤다 · 산 것 없음 → 가장 최근에 본 선크림
  await view(A, CREAM, at(5));
  await view(A, SUN, at(3));
  // B — 수분 크림을 4일 전에 보고 2일 전에 자사몰에서 샀다 → 본 뒤 산 후보는 빠지고, 후보 순서에서 안 산 첫 후보 = 선크림
  await view(B, CREAM, at(4));
  await buy(B, [{ productId: 'P1', productName: '수분 크림' }], at(2));
  // C — 수분 크림을 3일 전에 보고 다음 날 매장에서 샀다(원장 · 이름이 공백만 다르다) → 선크림
  await view(C, CREAM, at(3));
  await ledger(C, '01000001503', ' 수분  크림 ', 2);
  // D — 셋 다 40일 전에 샀고 본 적 없다 → 없음(대체 문장)
  await buy(D, [{ productId: 'P1', productName: '수분 크림' }, { productId: 'P2', productName: '선크림' }, { productName: '세럼' }], at(40));
  // E — 수분 크림을 40일 전에 샀는데 어제 다시 봤다(그 뒤 안 삼) → 다시 관심 = 수분 크림
  await buy(E, [{ productId: 'P1', productName: '수분 크림' }], at(40));
  await view(E, CREAM, at(1));
  // F — 아무 행동도 없다 → 후보 순서 첫 후보
  // G — 이름 없이 번호만 싣는 조회(P1) → 뿌리 표의 (문, 키)로 수분 크림과 잇는다
  await view(G, { productId: 'P1' }, at(2));
  await view(G, SUN, at(6));
  // H — 선크림 결제가 취소됐고(산 것 아님) · 세럼은 환불 행만 있다(산 것 아님) · 수분 크림은 매장에서 샀다(본 적 없음) → 선크림
  await buy(H, [{ productId: 'P2', productName: '선크림' }], at(3), { revenue_reversed: true });
  await ledger(H, '01000001508', '세럼', 3, -10000, 'L-09');
  await ledger(H, '01000001508', '수분 크림', 3);
  // I — 세럼(이름만)을 2일 전에 봤다 → 세럼
  await view(I, SERUM, at(2));
  // J — 세럼을 100일 전에 매장에서 샀다(상품 번호가 지금과 다르고 뿌리 표 보관 기간 밖 = 키로는 못 잇는다 · 이름만 같다) → 세럼은 산 것 → 선크림
  await ledger(J, '01000001510', '세럼', 100, 10000, 'L-OLD');
  // K — 같은 상품 번호(P1)를 이름이 바뀌기 전에 샀다(이름은 다르다 · 같은 문의 같은 키) → 수분 크림은 산 것 → 선크림
  await buy(K, [{ productId: 'P1', productName: '보습 크림(옛 이름)' }], at(10));
  // 「에센스」(P7) — 이름은 40일 전 조회에만 실렸고, 최근에는 번호만 실린 조회가 이어진다(끊긴 상품이 아니다 · Codex 구현 1R #5)
  await view(L, { product_id: 'P7', product_name: '에센스' }, at(40));
  await view(L, { productId: 'P7' }, at(2));
  // 「매장 인기 세트」 — 조회는 없고 매장에서만 많이 팔린다(조회 위 목록에는 없다 · Codex 구현 1R #6)
  for (const [i, c] of [A, B, C, D, E, F].entries()) await ledger(c, `010000015${String(i + 1).padStart(2, '0')}`, '매장 인기 세트', 5, 30000, 'L-SET');
  // 「단종 상품」(OLD2) — 45일 전에만 조회됐다(보관 기간 안 · 최근 30일 밖 = 끊긴 상품)
  await view(L, { product_id: 'OLD2', product_name: '단종 상품' }, at(45));
  // 이름이 바뀐 상품(REN1) — 45일 전 「옛 이름 상품」 · 3일 전 「새 이름 상품」(같은 번호 · 이름 = 가장 최근 것)
  await view(L, { product_id: 'REN1', product_name: '옛 이름 상품' }, at(45));
  await view(L, { product_id: 'REN1', product_name: '새 이름 상품' }, at(3));
  // 이름 앞뒤에 탭 · 줄바꿈이 붙은 상품(TAB1) — 제안에서 고른 이름이 고르기에서도 같은 상품이어야 한다(Codex 구현 2R #3)
  await view(L, { product_id: 'TAB1', product_name: '\t탭 붙은  상품\n' }, at(1));
  // 다른 회사 — 「끊긴상품」을 보고 산다(우리 회사 후보의 관측이 되면 안 된다) · 우리 고객 F 의 id 로 남의 회사 구매를 넣어도 읽지 않는다
  await view(OTHER_CUST, { product_id: 'X9', product_name: '끊긴상품' }, at(1), OTHER);
  await buy(F, [{ productId: 'P1', productName: '수분 크림' }], at(1), {}, OTHER);

  await rebuildCompanySignals(CO);
  await rebuildCompanySignals(OTHER);
});

describe('고객별 고르기 — 세 갈래(실 PG)', () => {
  const pick = (customer: string, names: string[] = NAMES) => pickRecoIndex(CO, customer, names);

  it('본 뒤 안 산 후보 중 가장 최근에 본 것', async () => {
    expect(await pick(A)).toBe(1);   // 선크림(3일 전) > 수분 크림(5일 전)
    expect(await pick(I)).toBe(2);   // 이름만 싣는 조회
    expect(await pick(G)).toBe(0);   // 번호만 싣는 조회 = (문, 키)로 이음 · 2일 전 > 선크림 6일 전
  });
  it('본 뒤 자사몰에서 산 후보는 빠진다 → 후보 순서에서 안 산 첫 후보', async () => {
    expect(await pick(B)).toBe(1);
  });
  it('본 뒤 매장에서 산 후보도 빠진다(이름의 공백 차이는 같은 상품)', async () => {
    expect(await pick(C)).toBe(1);
  });
  it('전에 샀어도 그 뒤 다시 본 후보는 권한다', async () => {
    expect(await pick(E)).toBe(0);
  });
  it('아무 행동도 없으면 후보 순서 첫 후보 · 순서를 바꾸면 답도 바뀐다', async () => {
    expect(await pick(F)).toBe(0);
    expect(await pick(F, ['세럼', '수분 크림'])).toBe(0);
    expect(await pick(B, ['세럼', '수분 크림', '선크림'])).toBe(0);   // 수분 크림만 샀다 → 순서 첫 후보 세럼
  });
  it('키가 달라도 이름이 같은 구매는 산 것이다(오래된 매장 구매 · 뿌리 표에 그 키가 없다)', async () => {
    expect(await pick(J, ['세럼', '선크림'])).toBe(1);
    expect(await pick(J, ['세럼'])).toBeNull();
  });
  it('이름이 달라도 같은 문의 같은 상품 번호로 산 구매는 산 것이다', async () => {
    expect(await pick(K, ['수분 크림', '선크림'])).toBe(1);
  });
  it('최근에는 번호만 실린 조회가 이어지는 상품 = 앞서 적힌 이름으로 읽는다(끊긴 후보가 아니다)', async () => {
    expect(await pick(L, ['에센스', '선크림'])).toBe(0);   // 2일 전 번호만 실린 조회 = 에센스를 봤다
    expect(await pick(F, ['에센스'])).toBe(0);              // 아무 행동 없는 고객에게도 살아 있는 후보
  });
  it('최근 30일 밖(보관 기간 안)에만 관측된 상품 = 끊긴 후보 · 이름이 바뀐 상품 = 가장 최근 이름으로만 읽는다', async () => {
    expect(await pick(F, ['단종 상품'])).toBeNull();
    expect(await pick(F, ['단종 상품', '선크림'])).toBe(1);
    expect(await pick(F, ['새 이름 상품'])).toBe(0);
    expect(await pick(F, ['옛 이름 상품'])).toBeNull();   // 지금은 그 이름의 상품이 없다
    expect(await pick(L, ['선크림', '새 이름 상품'])).toBe(1);   // 3일 전에 본 상품
  });
  it('후보를 전부 샀으면 없음(대체 문장)', async () => {
    expect(await pick(D)).toBeNull();
  });
  it('취소된 결제 · 환불 행은 산 것이 아니다 · 매장에서만 산 상품은 산 것이다', async () => {
    expect(await pick(H)).toBe(1);   // 수분 크림(매장에서 삼) 제외 → 선크림(결제 취소 = 안 삼)
    expect(await pick(H, ['수분 크림'])).toBeNull();
    expect(await pick(H, ['세럼'])).toBe(0);   // 환불 행만 = 안 삼
  });
});

describe('끊긴 후보 · 회사 격리 · 못 읽음(실 PG)', () => {
  it('최근 30일 관측이 없는 후보는 건너뛴다 · 전부 끊겼으면 없음', async () => {
    expect(await pickRecoIndex(CO, F, ['끊긴상품', '수분 크림'])).toBe(1);
    expect(await pickRecoIndex(CO, F, ['끊긴상품'])).toBeNull();
    expect(await pickRecoIndex(CO, F, ['없는 이름', '끊긴상품'])).toBeNull();
  });
  it('다른 회사의 관측 · 구매를 읽지 않는다', async () => {
    // 「끊긴상품」은 다른 회사에서만 관측됐다 → 우리 회사에서는 끊긴 후보
    expect(await pickRecoIndex(CO, A, ['끊긴상품'])).toBeNull();
    // F 의 id 로 다른 회사에 넣은 구매는 우리 회사의 「산 것」이 아니다
    expect(await pickRecoIndex(CO, F, ['수분 크림'])).toBe(0);
    // 다른 회사에서 그 회사 고객으로 고르면 그 회사 관측만 본다
    expect(await pickRecoIndex(OTHER, OTHER_CUST, ['끊긴상품', '수분 크림'])).toBe(0);
  });
  it('고객을 모르면 · 후보가 없으면 없음(조회 0)', async () => {
    expect(await pickRecoIndex(CO, null, NAMES)).toBeNull();
    expect(await pickRecoIndex(CO, A, [])).toBeNull();
  });
  it('읽지 못하면 없음(대체 문장) — 발송을 막지 않는다', async () => {
    expect(await pickRecoIndex(CO, 'uuid-가-아님', NAMES)).toBeNull();
  });
});

describe('자리에 넣을 글자(실 PG)', () => {
  const slot = (() => { const r = readRecoSlot('<추천상품: 수분 크림 | 선크림 | 세럼 || 요즘 많이 찾는 상품>'); if (r.kind !== 'ok') throw new Error('fixture'); return r.slot; })();

  it('고객으로 고른 후보 이름 · 없으면 대체 문장', async () => {
    expect(await recoTextFor(slot, { companyId: CO, customerId: A })).toBe('선크림');
    expect(await recoTextFor(slot, { companyId: CO, customerId: D })).toBe('요즘 많이 찾는 상품');
    expect(await recoTextFor(slot, { companyId: CO, customerId: null })).toBe('요즘 많이 찾는 상품');
  });
  it('판을 강제하면 고객을 읽지 않고 그 판 · 범위 밖 = 대체 문장', async () => {
    expect(await recoTextFor(slot, { companyId: CO, customerId: A, recoIndex: 0 })).toBe('수분 크림');
    expect(await recoTextFor(slot, { companyId: CO, customerId: A, recoIndex: 2 })).toBe('세럼');
    expect(await recoTextFor(slot, { companyId: CO, customerId: A, recoIndex: 3 })).toBe('요즘 많이 찾는 상품');
    expect(await recoTextFor(slot, { companyId: CO, customerId: A, recoIndex: 99 })).toBe('요즘 많이 찾는 상품');
  });
});

describe('후보 제안 관문 = 추천 상품이 열린 회사만(실 PG)', () => {
  const saved = process.env.V3_STAGE_RECO;
  afterAll(() => { if (saved === undefined) delete process.env.V3_STAGE_RECO; else process.env.V3_STAGE_RECO = saved; });

  it('스위치가 비어 있으면 어느 회사에도 닫힘(후보 0)', async () => {
    delete process.env.V3_STAGE_RECO;
    expect(await recoCandidatesFor(CO)).toEqual({ live: false, hasSignals: false, candidates: [], max: 3 });
    expect(await recoCandidatesFor(null)).toEqual({ live: false, hasSignals: false, candidates: [], max: 3 });
  });
  it('명단에 있는 회사만 열림 · 명단 밖 회사는 그대로 닫힘', async () => {
    process.env.V3_STAGE_RECO = CO;
    const open = await recoCandidatesFor(CO);
    expect(open.live).toBe(true);
    expect(open.hasSignals).toBe(true);
    expect(open.candidates).toContain('수분 크림');
    expect(await recoCandidatesFor(OTHER)).toEqual({ live: false, hasSignals: false, candidates: [], max: 3 });
  });
});

describe('이름 정리 = SQL 과 JS 가 같은 답(실 PG)', () => {
  it.each([
    '수분 크림', '  수분   크림  ', '\t수분크림\t', '\n수분\t\t크림\r\n', 'ABC Cream', '  ', '\t\n', '', '수분\u00A0크림', '\u3000수분크림\u3000', '수분\f크림\v',
  ])('%j', async (raw) => {
    const sql = (await pool.query(`SELECT ${normNameSql('$1::text')} AS n`, [raw])).rows[0].n;
    expect(sql).toBe(normName(raw));
  });
});

describe('후보 제안(실 PG)', () => {
  it('판매 위 순 · 같으면 조회 위 순 · 이름이 같은 두 문의 상품은 한 줄 · 다른 회사 상품 없음', async () => {
    const got = await suggestRecoCandidates(CO);
    // 최근 30일 구매 주문 수: 매장 인기 세트 = 매장 6 / 수분 크림 = 자사몰 B · K + 매장 C · H / 그 밖 = 0(D · E 의 구매는 40일 전)
    expect(got.slice(0, 2)).toEqual(['매장 인기 세트', '수분 크림']);
    expect(new Set(got)).toEqual(new Set(['매장 인기 세트', '수분 크림', '선크림', '세럼', '에센스', '새 이름 상품', '탭 붙은 상품']));   // 「단종 상품」 · 「옛 이름 상품」 없음
    // 제안된 이름 전부 = 고르기에서 살아 있는 후보(같은 이름 해석 · 같은 이름 정리) — 아무것도 사지 않은 고객 기준
    for (const name of got) expect(await pickRecoIndex(CO, L, [name]), name).toBe(0);
    expect(got).not.toContain('끊긴상품');
    expect(got.filter((n) => n.replace(/\s+/g, ' ').trim() === '수분 크림')).toHaveLength(1);
  });
  it('조회가 있는 상품이 아무리 많아도 조회 없는 판매 상위 상품이 맨 앞에 선다(합친 뒤에 줄 세운다)', async () => {
    for (let i = 0; i < 120; i++) await view(A, { product_id: `BULK${i}`, product_name: `많이 본 상품 ${i}` }, at(1));
    await rebuildCompanySignals(CO);
    const got = await suggestRecoCandidates(CO);
    expect(got).toHaveLength(30);
    expect(got[0]).toBe('매장 인기 세트');
    expect(got[1]).toBe('수분 크림');
    // 제안된 이름은 고르기에서도 살아 있는 후보다(같은 이름 해석)
    for (const name of got.slice(0, 5)) expect(await pickRecoIndex(CO, L, [name])).not.toBeNull();   // L = 아무것도 사지 않은 고객
    await pool.query(`DELETE FROM cdp_events WHERE company_id = $1::uuid AND properties->'items'->0->>'product_id' LIKE 'BULK%'`, [CO]);
    await rebuildCompanySignals(CO);
  });
  it('쓸 수 없는 이름(다른 문법의 글자 · 보낼 수 없는 글자)은 제안하지 않는다', async () => {
    await view(A, { product_id: 'BAD1', product_name: '세일 50% 크림' }, at(1));
    await view(A, { product_id: 'BAD2', product_name: '반짝 😊 세럼' }, at(1));
    await view(A, { product_id: 'OK1', product_name: '클렌징 폼' }, at(1));
    await rebuildCompanySignals(CO);
    const got = await suggestRecoCandidates(CO);
    expect(got).toContain('클렌징 폼');
    expect(got).not.toContain('세일 50% 크림');
    expect(got).not.toContain('반짝 😊 세럼');
  });
});

describe('렌더 = 미리보기 · 검사 · 실발송이 부르는 한 함수(실 PG)', () => {
  const TPL = '%이름%님, <추천상품: 수분 크림 | 선크림 | 세럼 || 요즘 많이 찾는 상품> 어떠세요?';
  let shared: Awaited<ReturnType<typeof loadJourneyRenderShared>>;
  const row = async (id: string) => (await pool.query('SELECT * FROM customers WHERE id = $1::uuid', [id])).rows[0];
  const renderOf = async (template: string, customerId: string | null, extra: Record<string, unknown> = {}) =>
    (await renderJourneySmsMessage({
      companyId: CO, createdBy: null, template, subject: '', channel: 'lms', isAd: false,
      customer: customerId ? await row(customerId) : null, shared, predictionsPreloaded: true, ...extra,
    })).message;

  beforeAll(async () => { shared = await loadJourneyRenderShared(CO, null); });

  it('그 고객으로 고른 후보가 자리에 들어간다 · 없으면 대체 문장 · 자리 글자는 남지 않는다', async () => {
    const a = await renderOf(TPL, A);
    expect(a).toContain('선크림 어떠세요?');
    expect(a).not.toContain('<추천상품');
    expect(a).not.toContain('수분 크림');
    expect(a).not.toMatch(/HJRECO/);
    expect(await renderOf(TPL, D)).toContain('요즘 많이 찾는 상품 어떠세요?');
    expect(await renderOf(TPL, null)).toContain('요즘 많이 찾는 상품 어떠세요?');   // 표본 고객 없음 = 대체 문장
  });
  it('판을 강제하면 고객과 무관하게 그 판(검사 · 미리보기)', async () => {
    expect(await renderOf(TPL, A, { recoIndex: 0 })).toContain('수분 크림 어떠세요?');
    expect(await renderOf(TPL, A, { recoIndex: 2 })).toContain('세럼 어떠세요?');
    expect(await renderOf(TPL, A, { recoIndex: 3 })).toContain('요즘 많이 찾는 상품 어떠세요?');
  });
  it('자리 없는 글 = 기존 길의 결과와 글자 그대로 같다 · 판 번호를 줘도 같다', async () => {
    const customer = await row(A);
    for (const t of ['%이름%님 안녕하세요. 이번 주 혜택을 확인해 보세요.', '3 < 5 || 2 > 1 | 그리고 <광고> 30%할인', '<추천상품: A | B>', '']) {
      const want = prepareSendMessage(sanitizeUnsendableForSms(t).sanitized, customer, shared.fieldMappings, {
        msgType: 'LMS', isAd: resolveJourneyAdFlag('lms', false), opt080Number: shared.opt080Number, subject: '', company: shared.company, externalContext: {},
      }).message;
      expect(await renderOf(t, A)).toBe(want);
      expect(await renderOf(t, A, { recoIndex: 0 })).toBe(want);
    }
  });
  it('고객 값이 표식처럼 생긴 글자열이어도 그 값은 후보로 바뀌지 않는다(표식 = 렌더마다 새 무작위 글자열)', async () => {
    const varName = Object.keys(shared.fieldMappings).find((k) => (shared.fieldMappings as any)[k]?.column === 'name') ?? Object.keys(shared.fieldMappings)[0];
    await pool.query(`UPDATE customers SET name = 'HJRECOSLOT' WHERE id = $1::uuid`, [F]);
    const got = await renderOf(`%${varName}%님, <추천상품: 수분 크림 || 인기 상품>`, F, { recoIndex: 0 });
    const plain = await renderOf(`%${varName}%님,`, F);
    expect(got).toContain('수분 크림');
    expect(got.startsWith(plain.split('님,')[0] + '님,')).toBe(true);   // 변수 자리의 글자는 자리 없는 글과 같다(후보로 바뀌지 않았다)
    expect((got.match(/수분 크림/g) || []).length).toBe(1);
  });
  it('고객 값 때문에 추천 자리가 받는 글에서 사라지면 던진다(자리 없는 글을 돌려주지 않는다) · 다른 고객에게는 후보가 들어간 글', async () => {
    // 출력 값이 여는 중괄호 둘이면 렌더 뒤 남은 태그 지우기가 표식까지 지운다(고객마다 다른 결과 · 미리 읽는 판정으로는 알 수 없다)
    const TPL2 = '안내 {{ customer.name }}<추천상품: 수분 크림 || 인기 상품>}}';
    await pool.query(`UPDATE customers SET name = '{{' WHERE id = $1::uuid`, [K]);
    await expect(renderOf(TPL2, K, { recoIndex: 0 })).rejects.toBeInstanceOf(RecoSlotLostError);
    await expect(renderOf(TPL2, K)).rejects.toBeInstanceOf(RecoSlotLostError);
    const other = await renderOf(TPL2, L, { recoIndex: 0 });
    expect(other).toContain('수분 크림');
    expect(other).not.toMatch(/HJRECO/);
    // 자리 없는 글은 같은 고객 값이어도 지금처럼 그린다(던지지 않는다)
    expect(typeof (await renderOf('안내 {{ customer.name }}님', K))).toBe('string');
  });
  it('후보 이름이 그 회사 변수 이름과 같아도 고객 값으로 바뀌지 않는다', async () => {
    const varName = Object.keys(shared.fieldMappings)[0];
    expect(varName).toBeTruthy();
    const plain = await renderOf(`[%${varName}%]`, A);
    const got = await renderOf(`[%${varName}%] 추천: <추천상품: ${varName} || 대체>`, A, { recoIndex: 0 });
    // 변수 자리는 종전처럼 고객 값으로 · 자리에 넣은 후보는 이름 글자 그대로
    expect(got.startsWith(plain.split(']')[0] + ']')).toBe(true);
    expect(got).toContain(`추천: ${varName}`);
  });
});

describe('받는 사람용 반응 숫자 글자(실 PG · C133 F2 ②)', () => {
  it('이름 → 글자(최근 30일 조회 수) · 조회 없는 이름 · 끊긴 상품 · 없는 이름은 결과에 없다', async () => {
    const viewsOf = async (key: string) => Number((await pool.query(
      `SELECT COALESCE(SUM(views), 0)::int AS v FROM product_signal_daily WHERE company_id = $1::uuid AND door = 'mall' AND product_key = $2 AND day > ((NOW() AT TIME ZONE 'Asia/Seoul')::date - 30)`, [CO, key])).rows[0].v);
    const cream = await viewsOf('P1');
    const sun = await viewsOf('P2');
    expect(cream).toBeGreaterThan(0);
    expect(sun).toBeGreaterThan(0);
    const got = await signalTextsFor(CO, ['수분 크림', '선크림', '매장 인기 세트', '단종 상품', '없는 상품', '끊긴상품']);
    expect(got).toEqual({ '수분 크림': `최근 30일 조회 ${cream.toLocaleString('ko-KR')}번`, '선크림': `최근 30일 조회 ${sun.toLocaleString('ko-KR')}번` });
  });
  it('요청한 이름 그대로를 열쇠로 돌려준다(공백 차이는 같은 상품) · 번호만 실린 조회가 이어지는 상품도 이름으로 읽는다', async () => {
    const got = await signalTextsFor(CO, ['  수분   크림 ', '\t탭 붙은  상품\n', '에센스']);
    expect(Object.keys(got).sort()).toEqual(['\t탭 붙은  상품\n', '  수분   크림 ', '에센스'].sort());
    expect(got['에센스']).toBe('최근 30일 조회 1번');   // 40일 전 조회는 세지 않는다(최근 30일 = 2일 전 번호만 실린 조회 하나)
    expect(got['\t탭 붙은  상품\n']).toBe('최근 30일 조회 1번');
  });
  it('다른 회사의 조회를 읽지 않는다 · 빈 요청 = 조회 0', async () => {
    expect(await signalTextsFor(CO, ['끊긴상품'])).toEqual({});
    expect(await signalTextsFor(OTHER, ['끊긴상품', '수분 크림'])).toEqual({ '끊긴상품': '최근 30일 조회 1번' });
    expect(await signalTextsFor(CO, [])).toEqual({});
    expect(await signalTextsFor(CO, ['', '   '])).toEqual({});
  });
  it('이름이 같은 상품(번호가 다르다)의 조회는 더한다', async () => {
    await view(A, { product_id: 'DUP1', product_name: '같은 이름 상품' }, at(1));
    await view(B, { product_id: 'DUP2', product_name: '같은 이름 상품' }, at(1));
    await view(C, { product_id: 'DUP2', product_name: '같은 이름 상품' }, at(2));
    await rebuildCompanySignals(CO);
    expect(await signalTextsFor(CO, ['같은 이름 상품'])).toEqual({ '같은 이름 상품': '최근 30일 조회 3번' });
  });
});

describe('이메일 받는 사람 = 고객 번호가 내부 칸으로 실린다 → 그 고객으로 고른다(실 PG · C133 F2 ① · Codex 구현 C-2 1R)', () => {
  // 옛: 발송 길이 개인화 값에서 번호를 읽었는데 받는 사람 조회가 번호를 싣지 않아, 켜도 이메일은 한 번도 고르지 않았다(부품은 다 있고 기능은 죽어 있었다).
  const CAMPAIGN = '00000000-0000-0000-0000-00000c133560';
  const MAIL_A = 'a@c133-reco.test';
  const MAIL_F = 'f@c133-reco.test';
  beforeAll(async () => {
    for (const [id, email] of [[A, MAIL_A], [F, MAIL_F], [OTHER_CUST, MAIL_A]]) {   // 다른 회사에도 같은 주소가 있다
      await pool.query('UPDATE customers SET email = $2, email_opt_in = true WHERE id = $1::uuid', [id, email]);
    }
    await insertMinimalRow(pool, 'email_campaigns', { id: CAMPAIGN, company_id: CO });
    for (const email of [MAIL_A, MAIL_F]) await insertMinimalRow(pool, 'email_events', { campaign_id: CAMPAIGN, email, event_type: 'delivered' });
  });
  it('받는 사람을 고르는 네 조회(등급 · 필터 · 조각 · 미오픈 재발송)가 모두 그 행의 고객 번호를 싣는다 · 개인화 값에는 번호가 없다', async () => {
    const lists: Record<string, EmailRecipient[]> = {
      grade: await resolveCustomerRecipients(CO),
      filter: await resolveCustomerRecipientsByFilter(CO, {}),
      where: await resolveCustomerRecipientsWhere([CO], '', ''),
      resend: await getCampaignResendRecipients(CO, CAMPAIGN),
    };
    for (const [label, rs] of Object.entries(lists)) {
      expect(Object.fromEntries(rs.map((r) => [r.email, r.customerId])), label).toEqual({ [MAIL_A]: A, [MAIL_F]: F });
      for (const r of rs) expect(Object.keys(r.customer || {}).filter((k) => k === 'id' || k === 'customer_id'), label).toEqual([]);
    }
  });
  it('그 번호로 고른 자리가 묶음에 실린다(조회 → 고르기 → 싣기) · 번호가 없는 받는 사람(직접 입력 주소)은 저장한 순서', async () => {
    const sections = [{ id: 's', type: 'product_carousel', props: { reco_order: true, products: NAMES.map((name) => ({ name })) } }];
    const a = (await resolveCustomerRecipients(CO)).find((r) => r.email === MAIL_A)!;
    expect(await pickRecoIndex(CO, a.customerId, NAMES)).toBe(1);   // A = 가장 최근에 본 선크림
    expect((await markRecoFront(sections, a.customerId ?? null, CO, true))[0].props).toEqual({ ...sections[0].props, reco_front: 1 });
    const direct: EmailRecipient = { email: 'x@c133-reco.test' };
    expect((await markRecoFront(sections, direct.customerId ?? null, CO, true))[0].props).toEqual(sections[0].props);
  });
});
