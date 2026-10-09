/**
 * ★ 2026-10-09 시연 회사 합성 데이터(설계서 docs/2026-10-09-demo-company-design.md §8)
 *
 * 고객·구매를 **싱크 에이전트와 같은 수집 경로**(POST /api/sync/customers · /purchases · 루프백)로 넣는다 — 적재·파생·여정 진입이 전부 진짜 코드를 탄다.
 * 생성은 결정적(날짜·번호 시드) · 같은 날 다시 돌려도 같은 행(번호 upsert · source_row_key 고정)이라 중복이 쌓이지 않는다.
 * 번호 = 0100 으로 시작하는 11자리(010-0xxx 미할당 국번 · 도달 불가) · 이름은 고정 사전 · 실명·실번호 0.
 * 클릭은 만들지 않는다(목업 0) — 목표 달성은 "여정 진입 뒤 구매"가 구매 원장 판정을 타서 생긴다.
 */
import { query } from '../config/database';
import { isDemoCompany } from './demo-company';

// ───── 결정적 난수 ─────
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed: string): () => number {
  let a = hash32(seed) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const intIn = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

// ───── 사전(고정 · 실명 아님) ─────
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'] as const;
const GIVEN_F = ['서연', '지우', '하은', '수아', '지민', '예린', '다은', '유진', '소율', '채원', '민지', '윤서', '가은', '나연', '혜원', '은비', '지현', '보람', '수빈', '하린'] as const;
const GIVEN_M = ['민준', '도윤', '지호', '현우', '준서', '건우', '우진', '태윤', '시우', '재원'] as const;
export const DEMO_STORES = [
  { code: 'DM01', name: '가로수길점', region: '서울' },
  { code: 'DM02', name: '성수점', region: '서울' },
  { code: 'DM03', name: '판교점', region: '경기' },
] as const;
const GRADES = ['일반', '일반', '일반', '실버', '실버', '골드', 'VIP'] as const;
export const DEMO_PRODUCTS = [
  { code: 'SK-101', name: '수분 진정 토너', price: 24000 }, { code: 'SK-102', name: '히알루론 세럼', price: 38000 },
  { code: 'SK-103', name: '세라마이드 크림', price: 32000 }, { code: 'SK-104', name: '비타민 앰플', price: 42000 },
  { code: 'SK-105', name: '약산성 클렌징 폼', price: 16000 }, { code: 'SK-106', name: '시카 리페어 크림', price: 29000 },
  { code: 'SK-107', name: '콜라겐 아이크림', price: 45000 }, { code: 'SK-108', name: '수분 시트 마스크 10매', price: 19000 },
  { code: 'SN-201', name: '데일리 선크림', price: 22000 }, { code: 'SN-202', name: '톤업 선쿠션', price: 28000 },
  { code: 'MU-301', name: '글로우 쿠션', price: 34000 }, { code: 'MU-302', name: '매트 립스틱', price: 21000 },
  { code: 'MU-303', name: '틴트 립밤', price: 14000 }, { code: 'MU-304', name: '아이섀도 팔레트', price: 36000 },
  { code: 'MU-305', name: '롱래스팅 마스카라', price: 18000 }, { code: 'BD-401', name: '퍼퓸 바디로션', price: 26000 },
  { code: 'BD-402', name: '핸드크림 3종 세트', price: 15000 }, { code: 'HR-501', name: '두피 스케일링 샴푸', price: 23000 },
  { code: 'HR-502', name: '헤어 에센스', price: 19000 }, { code: 'GF-601', name: '스킨케어 기프트 세트', price: 59000 },
] as const;

/** 도달 불가 번호 — 0100 + 7자리(010-0xxx 미할당 국번) */
export function demoPhone(index: number): string {
  return `0100${String(Math.max(0, Math.floor(index)) % 10_000_000).padStart(7, '0')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** KST 날짜 문자열(YYYY-MM-DD) — d 의 KST 달력일 */
export function kstDate(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}
function addDays(ymd: string, days: number): string {
  const [y, m, dd] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd) + days * 86400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
/** 2026-01-01 부터 며칠째(KST) — 그날 새 고객 번호대의 시작점 */
export function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 86400_000);
}

export const DEMO_SEED_CUSTOMERS = 3000;
/** 그날 새 고객 번호대 = 시드 3,000 뒤에 하루 100칸씩(같은 날 다시 돌려도 같은 번호) */
export function dailyIndexBase(ymd: string): number { return DEMO_SEED_CUSTOMERS + Math.max(0, dayNumber(ymd)) * 100; }

export interface DemoCustomerRow {
  phone: string; name: string; gender: string; birth_date: string; grade: string; sms_opt_in: boolean;
  store_code: string; store_name: string; registered_store: string; region: string;
  recent_purchase_date?: string | null; recent_purchase_amount?: number | null; recent_purchase_store?: string | null;
  total_purchase_amount?: number; purchase_count?: number;
}
export interface DemoPurchaseRow {
  customer_phone: string; purchase_date: string; product_code: string; product_name: string;
  quantity: number; unit_price: number; total_amount: number; store_code: string; store_name: string; source_row_key: string;
}

/** 고객 한 명의 고정 속성(번호로 결정) */
export function demoIdentity(index: number): DemoCustomerRow {
  const r = rng(`demo-id-${index}`);
  const female = r() < 0.82;   // 뷰티 시연 회사 — 여성 비중이 높다
  const store = pick(r, DEMO_STORES);
  const year = intIn(r, 1975, 2004);
  const month = intIn(r, 1, 12);
  const day = intIn(r, 1, 28);
  return {
    phone: demoPhone(index),
    name: pick(r, SURNAMES) + pick(r, female ? GIVEN_F : GIVEN_M),
    gender: female ? 'F' : 'M',
    birth_date: `${year}-${pad2(month)}-${pad2(day)}`,
    grade: pick(r, GRADES),
    sms_opt_in: true,
    store_code: store.code, store_name: store.name, registered_store: store.name, region: store.region,
  };
}

function purchaseAt(r: () => number, ymd: string): string {
  return `${ymd} ${pad2(intIn(r, 10, 21))}:${pad2(intIn(r, 0, 59))}:${pad2(intIn(r, 0, 59))}`;
}
function onePurchase(r: () => number, phone: string, ymd: string, key: string): DemoPurchaseRow {
  const p = pick(r, DEMO_PRODUCTS);
  const qty = r() < 0.85 ? 1 : 2;
  const store = pick(r, DEMO_STORES);
  return {
    customer_phone: phone, purchase_date: purchaseAt(r, ymd), product_code: p.code, product_name: p.name,
    quantity: qty, unit_price: p.price, total_amount: p.price * qty, store_code: store.code, store_name: store.name,
    source_row_key: key,
  };
}
function applyAggregates(c: DemoCustomerRow, buys: DemoPurchaseRow[], prior: { total: number; count: number } = { total: 0, count: 0 }): DemoCustomerRow {
  if (!buys.length) return { ...c, total_purchase_amount: prior.total, purchase_count: prior.count };
  const last = buys.reduce((a, b) => (a.purchase_date > b.purchase_date ? a : b));
  return {
    ...c,
    recent_purchase_date: last.purchase_date.slice(0, 10),
    recent_purchase_amount: last.total_amount,
    recent_purchase_store: last.store_name,
    total_purchase_amount: prior.total + buys.reduce((s, b) => s + b.total_amount, 0),
    purchase_count: prior.count + buys.length,
  };
}

/**
 * 시드(1회) — 기존 고객 3,000명 + 지난 1년 구매 이력(입력 데이터만 · 발송 결과 소급 0).
 * 약 18%는 구매 0(신규 판정 근거의 대조군) · 나머지는 1~6건.
 */
export function buildSeedData(today: string): { customers: DemoCustomerRow[]; purchases: DemoPurchaseRow[] } {
  const customers: DemoCustomerRow[] = [];
  const purchases: DemoPurchaseRow[] = [];
  for (let i = 0; i < DEMO_SEED_CUSTOMERS; i++) {
    const r = rng(`demo-seed-${i}`);
    const base = demoIdentity(i);
    const n = r() < 0.18 ? 0 : intIn(r, 1, 6);
    const buys: DemoPurchaseRow[] = [];
    for (let k = 0; k < n; k++) buys.push(onePurchase(r, base.phone, addDays(today, -intIn(r, 2, 400)), `demo-seed-${i}-${k}`));
    purchases.push(...buys);
    customers.push(applyAggregates(base, buys));
  }
  return { customers, purchases };
}

/**
 * 하루치(결정적) — 어제 영업분을 아침에 올리는 에이전트처럼:
 *   새 고객 20~40(주말 1.3배 · 60% 는 첫 구매) · 기존 고객 재구매 30~80(진행 중 여정 고객의 진입 뒤 구매 = 목표 달성).
 * 재구매 고객의 누적값은 호출부가 DB 에서 읽은 직전 값(prior)에 더한다.
 */
export function buildDailyBatch(today: string): { newCustomers: DemoCustomerRow[]; newPurchases: DemoPurchaseRow[]; repeatIndexes: number[]; salesDay: string } {
  const salesDay = addDays(today, -1);
  const r = rng(`demo-day-${today}`);
  const dow = new Date(`${salesDay}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const scale = weekend ? 1.3 : 1;
  const nNew = Math.round(intIn(r, 20, 40) * scale);
  const nRepeat = Math.round(intIn(r, 30, 80) * scale);
  const base = dailyIndexBase(today);
  const newCustomers: DemoCustomerRow[] = [];
  const newPurchases: DemoPurchaseRow[] = [];
  for (let k = 0; k < nNew; k++) {
    const c = demoIdentity(base + k);
    const buys = r() < 0.6 ? [onePurchase(r, c.phone, salesDay, `demo-${today}-new-${k}`)] : [];
    newPurchases.push(...buys);
    newCustomers.push(applyAggregates(c, buys));
  }
  // 재구매 = 지금까지 생긴 번호대(시드 + 지난날들)에서 고른다
  const pool = Math.max(DEMO_SEED_CUSTOMERS, base);
  const repeat = new Set<number>();
  for (let guard = 0; repeat.size < nRepeat && guard < nRepeat * 5; guard++) repeat.add(Math.floor(r() * pool));
  return { newCustomers, newPurchases, repeatIndexes: Array.from(repeat), salesDay };
}

/** 재구매 구매 행(결정적 · source_row_key 고정 = 재전송은 원장 고유 인덱스가 흡수) */
export function buildRepeatPurchases(today: string, salesDay: string, indexes: readonly number[]): DemoPurchaseRow[] {
  return indexes.map((idx) => onePurchase(rng(`demo-repeat-${today}-${idx}`), demoPhone(idx), salesDay, `demo-${today}-rep-${idx}`));
}

/**
 * 재구매 고객 행 = 구매 원장에서 다시 계산한 누적값(Codex 1R medium) — 현재 누적값에 더하지 않는다.
 * 같은 날 다시 돌려도(부분 실패 · 재기동) 원장이 같으면 같은 값이 나간다.
 */
export function customersFromLedger(indexes: readonly number[], ledger: ReadonlyMap<string, { total: number; count: number; recent: string | null; recentAmount: number | null; recentStore: string | null }>): DemoCustomerRow[] {
  return indexes.map((idx) => {
    const c = demoIdentity(idx);
    const l = ledger.get(c.phone);
    if (!l) return c;
    return { ...c, total_purchase_amount: l.total, purchase_count: l.count, recent_purchase_date: l.recent, recent_purchase_amount: l.recentAmount, recent_purchase_store: l.recentStore };
  });
}

// ───── 수집 경로(루프백) ─────

export interface DemoSyncKey { apiKey: string; apiSecret: string }

async function postSync(path: 'customers' | 'purchases', rows: unknown[], key: DemoSyncKey): Promise<number> {
  const port = process.env.PORT || 3000;
  let accepted = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const res = await fetch(`http://127.0.0.1:${port}/api/sync/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-apikey': key.apiKey, 'x-sync-secret': key.apiSecret },
      body: JSON.stringify({ mode: 'incremental', [path]: chunk, batchIndex: Math.floor(i / 2000), totalBatches: Math.ceil(rows.length / 2000) }),
    });
    if (!res.ok) throw new Error(`sync ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    accepted += chunk.length;
  }
  return accepted;
}

/** 키가 가리키는 회사가 시연 회사인지 — 아니면 넣지 않는다(실회사에 합성 데이터 0) */
async function demoCompanyIdOfKey(apiKey: string): Promise<string> {
  const r = await query(`SELECT id FROM companies WHERE api_key = $1`, [apiKey]);
  const id = r.rows[0]?.id ? String(r.rows[0].id) : '';
  if (!id || !(await isDemoCompany(id))) throw new Error('합성 데이터 키가 시연 회사 것이 아닙니다. 넣지 않았습니다.');
  return id;
}

/** 시드 구매 건수(결정적 · 번호 시드만 쓴다 = 날짜와 무관) — 시드 스크립트가 적재 완료를 이 수로 판정한다(Codex 2R) */
export function expectedSeedPurchaseCount(): number {
  return buildSeedData('2026-01-01').purchases.length;
}

/** 시드 적재(시드 스크립트가 1회) */
export async function pushDemoSeed(key: DemoSyncKey, now: Date = new Date()): Promise<{ customers: number; purchases: number }> {
  await demoCompanyIdOfKey(key.apiKey);
  const seed = buildSeedData(kstDate(now));
  const customers = await postSync('customers', seed.customers, key);
  const purchases = await postSync('purchases', seed.purchases, key);
  return { customers, purchases };
}

/**
 * 하루치 적재(매일 워커) — 순서 = 새 고객(그날 묶음만으로 누적값이 정해진다) → 구매(원장 고유 키로 멱등) → 재구매 고객(원장에서 다시 계산).
 * 어느 단계에서 끊겨도 다음 tick 이 같은 값을 다시 보낸다(이중 가산 0).
 */
export async function pushDemoDaily(key: DemoSyncKey, now: Date = new Date()): Promise<{ newCustomers: number; repeat: number; purchases: number }> {
  const companyId = await demoCompanyIdOfKey(key.apiKey);
  const today = kstDate(now);
  const day = buildDailyBatch(today);
  const repeatPurchases = buildRepeatPurchases(today, day.salesDay, day.repeatIndexes);
  const phones = day.repeatIndexes.map(demoPhone);
  type Ledger = Map<string, { total: number; count: number; recent: string | null; recentAmount: number | null; recentStore: string | null }>;
  const readLedger = async (): Promise<Ledger> => {
    const ledger: Ledger = new Map();
    if (!phones.length) return ledger;
    const r = await query(
      `SELECT DISTINCT ON (customer_phone) customer_phone,
              SUM(total_amount) OVER w AS total, COUNT(*) OVER w AS cnt,
              to_char(purchase_date, 'YYYY-MM-DD') AS recent, total_amount AS recent_amount, store_name AS recent_store
         FROM purchases
        WHERE company_id = $1::uuid AND customer_phone = ANY($2::text[])
       WINDOW w AS (PARTITION BY customer_phone)
        ORDER BY customer_phone, purchase_date DESC`,
      [companyId, phones],
    );
    for (const row of r.rows) {
      ledger.set(String(row.customer_phone), {
        total: Number(row.total) || 0, count: Number(row.cnt) || 0, recent: row.recent ? String(row.recent) : null,
        recentAmount: row.recent_amount != null ? Number(row.recent_amount) : null, recentStore: row.recent_store ? String(row.recent_store) : null,
      });
    }
    return ledger;
  };
  // ★ Codex 2R medium — 재구매 대상 번호가 아직 고객이 아닐 수 있다(번호대에서 고른다). 구매보다 **먼저** 고객 행을 세워야 구매가 고객과 이어진다(customer_id).
  //   이때 싣는 누적값 = 그 시각 원장 값(이미 있으면 그대로 · 없으면 0) → 구매 → 원장에서 다시 계산한 값으로 한 번 더(어느 단계에서 끊겨도 다시 돌리면 같은 값).
  if (day.newCustomers.length) await postSync('customers', day.newCustomers, key);
  if (phones.length) await postSync('customers', customersFromLedger(day.repeatIndexes, await readLedger()), key);
  const purchases = [...day.newPurchases, ...repeatPurchases];
  if (purchases.length) await postSync('purchases', purchases, key);
  const repeatCustomers = customersFromLedger(day.repeatIndexes, await readLedger());
  if (repeatCustomers.length) await postSync('customers', repeatCustomers, key);
  return { newCustomers: day.newCustomers.length, repeat: repeatCustomers.length, purchases: purchases.length };
}

// ───── 매일 워커 ─────

let timer: NodeJS.Timeout | null = null;
let lastRunDay = '';
/** ENV DEMO_SYNC_API_KEY · DEMO_SYNC_SECRET 이 있을 때만 · 07:00 KST 이후 하루 1회(재기동해도 같은 날은 결정적이라 중복 0) */
export function startDemoDataWorker(): void {
  const apiKey = (process.env.DEMO_SYNC_API_KEY || '').trim();
  const apiSecret = (process.env.DEMO_SYNC_SECRET || '').trim();
  if (!apiKey || !apiSecret) return;
  if (timer) return;
  const tick = async () => {
    const now = new Date();
    const today = kstDate(now);
    const kstHour = new Date(now.getTime() + 9 * 3600_000).getUTCHours();
    if (kstHour < 7 || lastRunDay === today) return;
    lastRunDay = today;
    try {
      const r = await pushDemoDaily({ apiKey, apiSecret }, now);
      console.log(`[demo-data] ${today} 시연 합성 데이터 · 새 고객 ${r.newCustomers} · 재구매 ${r.repeat} · 구매 ${r.purchases}`);
    } catch (err: any) {
      lastRunDay = '';   // 다음 tick 에 다시
      console.error('[demo-data] 시연 합성 데이터 적재 실패:', err?.message);
    }
  };
  timer = setInterval(() => { void tick(); }, 10 * 60_000);
  setTimeout(() => { void tick(); }, 60_000);
  console.log('[demo-data] 시연 합성 데이터 워커 시작(매일 07:00 KST 이후 1회)');
}
