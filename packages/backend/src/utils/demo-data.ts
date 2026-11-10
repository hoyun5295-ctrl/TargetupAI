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
import { LEDGER_PURCHASES_SQL } from './two-door-purchase';   // ★ 1110 v3 원장 읽기 = 구매 행 CT-D6(환불 · 미래 날짜 행 제외)

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

/**
 * ★ 2026-10-20 가짜(도달 불가) 번호 판정 — 010-0xxx · 010-1xxx 미할당 국번 11자리(설계서 §8 의 0100·0101).
 *   시연이 아닌 테스트 회사의 고객을 지우기 전에 "전원 가짜 번호"인지 이것으로 본다. SQL 은 이 패턴 문자열을 그대로 쓴다(한 벌).
 */
export const SYNTHETIC_PHONE_PATTERN = '^010[01][0-9]{7}$';
const SYNTHETIC_PHONE_RE = new RegExp(SYNTHETIC_PHONE_PATTERN);
export function isSyntheticPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && SYNTHETIC_PHONE_RE.test(phone);
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
  points?: number;   // ★ 1110 v3 만 싣는다(v2 행에는 없다)
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

// ───── ★ 2026-10-09 v2 — 고객마다 결정적 구매 타임라인(설계서 docs/2026-10-09-journey-crm-map-design.md §6) ─────
//   목적: 가입 → 첫 구매 → 재구매 → 상품별 다시 채우기 → 휴면 · 복귀 리듬이 **데이터에 실제로** 있게 한다(무작위 400일 산포 = 리듬 0).
//   ⛔ 여정 소속을 읽고 구매자를 고르지 않는다(타임라인은 번호만으로 정해진다 · 결과 테이블 직접 쓰기 0 · 목업 0).
//   ⛔ 같은 날 가입 · 구매 25% 는 그대로 둔다 — 싱크 회사의 실제 모양(지도 안내문이 그 사실을 말한다).
//   시드와 매일 워커가 **같은 함수 · 같은 원장 키**(demo-v2-번호-날-순번)를 쓴다 = 다시 보내도 이중 적재 0.

/** v2 기준일(시드를 돌린 날) — 매일 묶음 번호대를 이 날부터 센다. */
export const DEMO_V2_FIRST_DAY = '2026-10-09';
const SEED_ANCHOR_DAY = dayNumber(DEMO_V2_FIRST_DAY);
const TIMELINE_HORIZON_DAYS = 800;
/** 다시 채우는 상품(주력 후보 · 가중치 = 고를 확률) — 주기 = 다 써 갈 때. */
const STAPLES: Array<{ code: string; weight: number }> = [
  { code: 'SK-101', weight: 26 }, { code: 'SN-201', weight: 20 }, { code: 'SK-105', weight: 16 },
  { code: 'SK-108', weight: 14 }, { code: 'SK-102', weight: 10 }, { code: 'HR-501', weight: 8 }, { code: 'SK-103', weight: 6 },
];
export const DEMO_CYCLE_DAYS: Record<string, number> = {
  'SK-101': 45, 'SN-201': 40, 'SK-105': 30, 'SK-108': 21, 'SK-102': 55, 'HR-501': 35, 'SK-103': 60,
};
const productByCode = new Map<string, (typeof DEMO_PRODUCTS)[number]>(DEMO_PRODUCTS.map((p) => [p.code, p]));
const weighted = (r: () => number) => {
  const total = STAPLES.reduce((s, x) => s + x.weight, 0);
  let t = r() * total;
  for (const x of STAPLES) { t -= x.weight; if (t < 0) return x.code; }
  return STAPLES[0].code;
};

export interface TimelineBuy { day: number; seq: number; code: string }
export interface DemoTimeline { signupDay: number; buys: TimelineBuy[] }

const timelineCache = new Map<number, DemoTimeline>();

/** 가입한 날(일련 일수) — 시드 고객 = 기준일 420~30일 전 · 매일 고객 = 그 묶음의 영업일. */
export function demoSignupDay(index: number): number {
  if (index < DEMO_SEED_CUSTOMERS) return SEED_ANCHOR_DAY - intIn(rng(`demo-v2-signup-${index}`), 30, 420);
  return Math.floor((index - DEMO_SEED_CUSTOMERS) / 100) - 1;
}

/** 고객 한 명의 구매 타임라인(결정적 · 번호만으로 정해진다). */
export function demoTimeline(index: number): DemoTimeline {
  const hit = timelineCache.get(index);
  if (hit) return hit;
  const r = rng(`demo-v2-tl-${index}`);
  const signupDay = demoSignupDay(index);
  const buys: TimelineBuy[] = [];
  const u = r();
  let first: number | null;
  if (u < 0.25) first = 0;
  else if (u < 0.5) first = intIn(r, 1, 6);
  else if (u < 0.65) first = intIn(r, 7, 20);
  else first = r() < 0.3 ? intIn(r, 60, 200) : null;
  if (first != null) {
    const fav = weighted(r);
    const second = r() < 0.4 ? weighted(r) : null;
    let day = signupDay + first;
    let seq = 0;
    const end = signupDay + TIMELINE_HORIZON_DAYS;
    while (day <= end) {
      const pick = second && r() < 0.35 ? second : r() < 0.85 ? fav : pick0(r);
      buys.push({ day, seq: seq++, code: pick });
      if (r() < 0.22) buys.push({ day, seq: seq++, code: pick0(r) });   // 함께 산 상품
      const base = DEMO_CYCLE_DAYS[pick] ?? DEMO_CYCLE_DAYS[fav];
      let gap = Math.max(7, Math.round(base * (0.85 + r() * 0.3)));
      if (r() < 0.15) {                     // 이탈 — 일부만 오래 쉬었다 돌아온다
        if (r() < 0.3) gap = intIn(r, 120, 300);
        else break;
      }
      day += gap;
    }
  }
  const tl = { signupDay, buys };
  timelineCache.set(index, tl);
  return tl;
}
function pick0(r: () => number): string { return pick(r, DEMO_PRODUCTS).code; }

/** 타임라인 한 줄 → 원장 행(원장 고유 키 = 번호 · 날 · 순번). */
export function timelinePurchaseRow(index: number, b: TimelineBuy): DemoPurchaseRow {
  const r = rng(`demo-v2-row-${index}-${b.day}-${b.seq}`);
  const p = productByCode.get(b.code) || DEMO_PRODUCTS[0];
  const qty = r() < 0.88 ? 1 : 2;
  const store = pick(r, DEMO_STORES);
  return {
    customer_phone: demoPhone(index), purchase_date: purchaseAt(r, dayToYmd(b.day)), product_code: p.code, product_name: p.name,
    quantity: qty, unit_price: p.price, total_amount: p.price * qty, store_code: store.code, store_name: store.name,
    source_row_key: `demo-v2-${index}-${b.day}-${b.seq}`,
  };
}
export function dayToYmd(day: number): string { return addDays('2026-01-01', day); }

/** 그 날(일련 일수)까지의 구매 행. */
export function purchasesThrough(index: number, lastDay: number): DemoPurchaseRow[] {
  return demoTimeline(index).buys.filter((b) => b.day <= lastDay).map((b) => timelinePurchaseRow(index, b));
}
/** 그 날 하루의 구매 행. */
export function purchasesOn(index: number, day: number): DemoPurchaseRow[] {
  return demoTimeline(index).buys.filter((b) => b.day === day).map((b) => timelinePurchaseRow(index, b));
}

/** 그날 새 고객 수(결정적 · 주말 1.3배). */
export function dailyNewCount(today: string): number {
  const r = rng(`demo-v2-day-${today}`);
  const salesDay = addDays(today, -1);
  const dow = new Date(`${salesDay}T00:00:00Z`).getUTCDay();
  return Math.round(intIn(r, 20, 40) * (dow === 0 || dow === 6 ? 1.3 : 1));
}

/** 지금까지 생긴 매일 고객 번호(v2 첫날 묶음부터 today 묶음 전까지). */
export function dailyIndexesBefore(today: string): number[] {
  const out: number[] = [];
  for (let t = DEMO_V2_FIRST_DAY; t < today; t = addDays(t, 1)) {
    const base = dailyIndexBase(t);
    const n = dailyNewCount(t);
    for (let k = 0; k < n; k++) out.push(base + k);
  }
  return out;
}

/**
 * 시드(1회) — 기존 고객 3,000명 + 어제까지의 구매 이력(입력 데이터만 · 발송 결과 소급 0).
 * 끝 = 어제: 매일 워커는 어제분만 넣으므로 끝을 더 당기면 그 사이 날이 빈다(회의론자 E6). 같은 키라 겹쳐도 이중 적재 0.
 */
export function buildSeedData(today: string): { customers: DemoCustomerRow[]; purchases: DemoPurchaseRow[] } {
  const lastDay = dayNumber(today) - 1;
  const customers: DemoCustomerRow[] = [];
  const purchases: DemoPurchaseRow[] = [];
  for (let i = 0; i < DEMO_SEED_CUSTOMERS; i++) {
    const buys = purchasesThrough(i, lastDay);
    purchases.push(...buys);
    customers.push(applyAggregates(demoIdentity(i), buys));
  }
  return { customers, purchases };
}

/**
 * 하루치(결정적) — 어제 영업분: 새 고객(어제 가입 · 같은 날 산 분은 누적값을 실어 온다) + 그날 타임라인에 구매가 있는 기존 고객.
 */
export function buildDailyBatch(today: string): { newCustomers: DemoCustomerRow[]; newPurchases: DemoPurchaseRow[]; buyerIndexes: number[]; buyerPurchases: DemoPurchaseRow[]; salesDay: string } {
  const salesDay = addDays(today, -1);
  const sd = dayNumber(salesDay);
  const base = dailyIndexBase(today);
  const nNew = dailyNewCount(today);
  const newCustomers: DemoCustomerRow[] = [];
  const newPurchases: DemoPurchaseRow[] = [];
  for (let k = 0; k < nNew; k++) {
    const idx = base + k;
    const buys = purchasesOn(idx, sd);
    newPurchases.push(...buys);
    newCustomers.push(applyAggregates(demoIdentity(idx), buys));
  }
  const buyerIndexes: number[] = [];
  const buyerPurchases: DemoPurchaseRow[] = [];
  const pool = [...Array.from({ length: DEMO_SEED_CUSTOMERS }, (_, i) => i), ...dailyIndexesBefore(today)];
  for (const idx of pool) {
    const buys = purchasesOn(idx, sd);
    if (buys.length === 0) continue;
    buyerIndexes.push(idx);
    buyerPurchases.push(...buys);
  }
  return { newCustomers, newPurchases, buyerIndexes, buyerPurchases, salesDay };
}

/**
 * 구매 고객 행 = 구매 원장에서 다시 계산한 누적값(Codex 1R medium) — 현재 누적값에 더하지 않는다.
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

/**
 * strict(★ 1110 v3 만) = HTTP 200 이어도 본문 data.failedCount > 0 이면 던진다 → 그날 회차를 끝낸 것으로 적지 않는다(설계서 §5 · Codex 설계 1R #5).
 *   v2(시연 회사)는 옛 동작 그대로(불변식 2 · 같은 틈은 설계서 §9 추가 과제).
 */
async function postSync(path: 'customers' | 'purchases', rows: unknown[], key: DemoSyncKey, opts: { strict?: boolean } = {}): Promise<number> {
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
    if (opts.strict) {
      const body: any = await res.json().catch(() => null);
      if (body?.data?.failedCount !== 0) throw new Error(`sync ${path} failedCount=${body?.data?.failedCount}`);
    }
    accepted += chunk.length;
  }
  return accepted;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type EnvLike = Record<string, string | undefined>;

/**
 * ★ 2026-10-20 시연이 아닌데 합성 데이터를 받아도 되는 회사(실발송을 시험하는 테스트 회사) — ENV SYNTHETIC_DATA_COMPANY_IDS(쉼표·공백).
 *   실제 고객사가 실수로 받지 않게 **id 를 손으로 적은 곳만** 받는다. uuid 모양이 아닌 글자는 버린다.
 */
export function syntheticDataCompanyIds(env: EnvLike = process.env): Set<string> {
  return new Set(String(env.SYNTHETIC_DATA_COMPANY_IDS || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => UUID_RE.test(s)));
}

/** 키가 가리키는 회사가 합성 데이터를 받아도 되는지 — 시연 회사이거나 허용 목록 회사. 아니면 넣지 않는다(실회사에 합성 데이터 0) */
export async function syntheticTargetCompanyIdOfKey(apiKey: string, allow: ReadonlySet<string> = syntheticDataCompanyIds()): Promise<string> {
  const r = await query(`SELECT id FROM companies WHERE api_key = $1`, [apiKey]);
  const id = r.rows[0]?.id ? String(r.rows[0].id).toLowerCase() : '';
  if (!id || !(allow.has(id) || (await isDemoCompany(id)))) throw new Error('합성 데이터 키가 시연 회사·허용 목록 회사 것이 아닙니다. 넣지 않았습니다.');
  return id;
}

/**
 * ★ 2026-10-20 매일 워커가 돌 키 목록 — 기존 시연 키 한 쌍(DEMO_SYNC_API_KEY · DEMO_SYNC_SECRET) + SYNTHETIC_SYNC_KEYS(「키:시크릿」 쉼표).
 *   같은 키는 처음 것만 · 키나 시크릿이 빈 것은 버린다(키 = tk_ + hex · 시크릿 = hex 라 콜론이 들어가지 않는다).
 */
export function parseSyntheticSyncKeys(env: EnvLike = process.env): DemoSyncKey[] {
  const out: DemoSyncKey[] = [];
  const seen = new Set<string>();
  const add = (apiKey: string, apiSecret: string) => {
    const k = apiKey.trim();
    const s = apiSecret.trim();
    if (!k || !s || seen.has(k)) return;
    seen.add(k);
    out.push({ apiKey: k, apiSecret: s });
  };
  add(String(env.DEMO_SYNC_API_KEY || ''), String(env.DEMO_SYNC_SECRET || ''));
  for (const part of String(env.SYNTHETIC_SYNC_KEYS || '').split(',')) {
    const i = part.indexOf(':');
    if (i > 0) add(part.slice(0, i), part.slice(i + 1));
  }
  return out;
}

/** 시드 구매 건수(결정적 · 그날 기준 어제까지) — 시드 스크립트가 적재 완료를 이 수로 판정한다(Codex 2R). 같은 today 로 부른다. */
export function expectedSeedPurchaseCount(today: string): number {
  return buildSeedData(today).purchases.length;
}

/**
 * ★ 2026-10-09 v2 — 옛(v1 무작위) 시연 회사에는 v2 를 넣지 않는다.
 *   배포 직후 .env 키가 아직 옛 회사를 가리키는 동안 워커가 돌면 v2 행이 옛 회사에 섞인다(재구성 판정도 흐려진다).
 */
export async function isV1DemoCompany(companyId: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM purchases WHERE company_id = $1::uuid AND source_row_key LIKE 'demo-seed-%' LIMIT 1`, [companyId]);
  return r.rows.length > 0;
}

/** 시드 적재(시드 스크립트가 1회) */
export async function pushDemoSeed(key: DemoSyncKey, now: Date = new Date()): Promise<{ customers: number; purchases: number }> {
  const companyId = await syntheticTargetCompanyIdOfKey(key.apiKey);
  if (await isV1DemoCompany(companyId)) throw new Error('옛 방식으로 만든 시연 회사입니다. 새 시연 회사(--rebuild)로 다시 만드세요.');
  const seed = buildSeedData(kstDate(now));
  const customers = await postSync('customers', seed.customers, key);
  const purchases = await postSync('purchases', seed.purchases, key);
  return { customers, purchases };
}

/**
 * 하루치 적재(매일 워커) — 순서 = 새 고객(그날 묶음만으로 누적값이 정해진다) → 구매(원장 고유 키로 멱등) → 재구매 고객(원장에서 다시 계산).
 * 어느 단계에서 끊겨도 다음 tick 이 같은 값을 다시 보낸다(이중 가산 0).
 */
export async function pushDemoDaily(key: DemoSyncKey, now: Date = new Date()): Promise<{ newCustomers: number; repeat: number; purchases: number; skipped?: string }> {
  const companyId = await syntheticTargetCompanyIdOfKey(key.apiKey);
  if (await isV1DemoCompany(companyId)) return { newCustomers: 0, repeat: 0, purchases: 0, skipped: '옛 방식 시연 회사라 넣지 않았어요(.env 키를 새 시연 회사로 바꾸면 이어집니다)' };
  if (await isRealismCompany(companyId)) return pushRealismDaily(companyId, key, now);   // ★ 1110 v3(허용 목록 ∧ 시연 아님) · 시연 회사는 아래 v2 그대로
  const today = kstDate(now);
  const day = buildDailyBatch(today);
  const repeatPurchases = day.buyerPurchases;
  const phones = day.buyerIndexes.map(demoPhone);
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
  if (phones.length) await postSync('customers', customersFromLedger(day.buyerIndexes, await readLedger()), key);
  const purchases = [...day.newPurchases, ...repeatPurchases];
  if (purchases.length) await postSync('purchases', purchases, key);
  const repeatCustomers = customersFromLedger(day.buyerIndexes, await readLedger());
  if (repeatCustomers.length) await postSync('customers', repeatCustomers, key);
  return { newCustomers: day.newCustomers.length, repeat: repeatCustomers.length, purchases: purchases.length };
}

// ───── 매일 워커 ─────

let timer: NodeJS.Timeout | null = null;
/** 키마다 마지막으로 끝낸 날(★1020 여러 회사 · 한 회사가 실패해도 다른 회사는 그날 끝난다) */
const lastRunDay = new Map<string, string>();
/**
 * 키(parseSyntheticSyncKeys)가 하나라도 있을 때만 · 07:00 KST 이후 키마다 하루 1회(재기동해도 같은 날은 결정적이라 중복 0).
 * 받는 회사 판정 = 시연 회사 또는 허용 목록(SYNTHETIC_DATA_COMPANY_IDS) — 적재 함수 안에서 매번 다시 본다.
 */
export function startDemoDataWorker(): void {
  const keys = parseSyntheticSyncKeys();
  const cdpKeys = parseSyntheticCdpKeys();   // ★ 1110 v3 온라인 갈래(없으면 매장 갈래만 · 시작 로그에 개수)
  if (!keys.length && !cdpKeys.length) return;
  if (timer) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const today = kstDate(now);
      const kstHour = new Date(now.getTime() + 9 * 3600_000).getUTCHours();
      for (const key of kstHour >= 7 ? keys : []) {
        if (lastRunDay.get(key.apiKey) === today) continue;
        const tag = key.apiKey.slice(0, 10);
        try {
          const r = await pushDemoDaily(key, now);
          lastRunDay.set(key.apiKey, today);
          console.log(r.skipped
            ? `[demo-data] ${today} ${tag} ${r.skipped}`
            : `[demo-data] ${today} ${tag} 합성 데이터 · 새 고객 ${r.newCustomers} · 재구매 ${r.repeat} · 구매 ${r.purchases}`);
        } catch (err: any) {
          console.error(`[demo-data] ${tag} 합성 데이터 적재 실패(다음 tick 에 다시):`, err?.message);
        }
      }
      // ★ 1110 v3 온라인 = 10분 tick 마다 그 시각까지 생긴 사건(07:00 문 밖 · 밤에는 빈 회차) · 오류 = 그 키의 이번 tick 멈춤
      for (const ck of cdpKeys) {
        const tag = ck.apiKey.slice(0, 10);
        try {
          const r = await pushRealismOnline(ck, now);
          if (r.skipped) {
            if (!onlineSkipLogged.has(ck.apiKey)) console.log(`[demo-data] ${tag} ${r.skipped}`);
            onlineSkipLogged.add(ck.apiKey);
          } else if (r.sent || r.deferred) {
            console.log(`[demo-data] ${today} ${tag} 자사몰 합성 · 보냄 ${r.sent} · 미룸 ${r.deferred}`);
          }
        } catch (err: any) {
          console.error(`[demo-data] ${tag} 자사몰 합성 전송 실패(다음 tick 에 이어서):`, err?.message);
        }
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, 10 * 60_000);
  setTimeout(() => { void tick(); }, 60_000);
  console.log(`[demo-data] 합성 데이터 워커 시작(매일 07:00 KST 이후 1회 · 키 ${keys.length}개 · 자사몰 키 ${cdpKeys.length}개)`);
}

// ───── ★ 2026-11-10 v3 — 실제 회사처럼(설계서 docs/2026-11-10-synthetic-company-realism-design.md) ─────
//   받는 회사 = 허용 목록 ∧ 시연 아님(isRealismCompany). 시연 회사는 위 v2 그대로(불변식 2).
//   매장 = 지금 v2 줄을 같은 원장 키로(수량 1 · 행사가) + 함께 산 상품 줄(새 키) · 등급 · 포인트 · 수신거부 = 매장 고객 싱크.
//   온라인 = 몰 회원 40% · 방문 · 조회 · 담기 · 결제 시작 · 주문을 진짜 자사몰 수집 API(루프백)로 · 그 시각까지 생긴 것만.
//   번호 = demoPhone 그대로(도달 불가) · 이메일 0 · 결과 · 파생 표 직접 쓰기 0.

/** v3 받는 회사인가 — 허용 목록에 있고 시연 회사가 아니다(실제 고객사 · 시연 회사 = 거짓). */
export async function isRealismCompany(companyId: string, allow: ReadonlySet<string> = syntheticDataCompanyIds()): Promise<boolean> {
  const id = String(companyId || '').toLowerCase();
  return allow.has(id) && !(await isDemoCompany(id));
}

type Product = { code: string; name: string; price: number };
/** v2 20종에 더하는 40종(정가 9천 ~ 8만 · 가정) — 덧붙인 줄 · 몰에서만 고른다(v2 줄 상품은 그대로). */
const EXTRA_PRODUCTS: readonly Product[] = [
  { code: 'SK-109', name: '판테놀 수분 크림', price: 31000 }, { code: 'SK-110', name: '어성초 진정 토너', price: 22000 },
  { code: 'SK-111', name: '레티놀 나이트 세럼', price: 48000 }, { code: 'SK-112', name: '나이아신아마이드 앰플', price: 36000 },
  { code: 'SK-113', name: '클렌징 오일', price: 25000 }, { code: 'SK-114', name: '클렌징 워터', price: 18000 },
  { code: 'SK-115', name: '각질 패드 70매', price: 21000 }, { code: 'SK-116', name: '수분 미스트', price: 15000 },
  { code: 'SK-117', name: '장벽 강화 로션', price: 27000 }, { code: 'SK-118', name: '탄력 아이패치 60매', price: 24000 },
  { code: 'SN-203', name: '무기자차 선크림', price: 26000 }, { code: 'SN-204', name: '선스틱', price: 19000 },
  { code: 'SN-205', name: '수분 선세럼', price: 24000 }, { code: 'SN-206', name: '톤업 선크림', price: 23000 },
  { code: 'MU-306', name: '커버 컨실러', price: 17000 }, { code: 'MU-307', name: '세미매트 쿠션', price: 36000 },
  { code: 'MU-308', name: '브로우 펜슬', price: 12000 }, { code: 'MU-309', name: '블러셔', price: 19000 },
  { code: 'MU-310', name: '하이라이터', price: 22000 }, { code: 'MU-311', name: '립 오일', price: 16000 },
  { code: 'MU-312', name: '벨벳 틴트', price: 15000 }, { code: 'MU-313', name: '픽서 미스트', price: 18000 },
  { code: 'MU-314', name: '아이라이너', price: 14000 }, { code: 'MU-315', name: '메이크업 베이스', price: 23000 },
  { code: 'BD-403', name: '바디 스크럽', price: 22000 }, { code: 'BD-404', name: '바디 워시', price: 18000 },
  { code: 'BD-405', name: '바디 오일', price: 29000 }, { code: 'BD-406', name: '데오드란트', price: 13000 },
  { code: 'BD-407', name: '풋 크림', price: 11000 }, { code: 'HR-503', name: '헤어 트리트먼트', price: 26000 },
  { code: 'HR-504', name: '헤어 미스트', price: 17000 }, { code: 'HR-505', name: '두피 토닉', price: 28000 },
  { code: 'HR-506', name: '컬링 에센스', price: 16000 }, { code: 'HR-507', name: '헤어 오일', price: 21000 },
  { code: 'GF-602', name: '선케어 기프트 세트', price: 45000 }, { code: 'GF-603', name: '립 컬렉션 세트', price: 38000 },
  { code: 'GF-604', name: '바디케어 기프트 세트', price: 52000 }, { code: 'GF-605', name: '트래블 키트', price: 29000 },
  { code: 'GF-606', name: '프리미엄 스킨케어 세트', price: 79000 }, { code: 'GF-607', name: '미니 핸드크림 세트', price: 9000 },
];
const NEW_PRODUCT_FIRST_MONTH = '2026-11';
const NEW_ITEM_TAGS = ['시즌 한정', '리뉴얼', '신상', '스페셜 에디션'] as const;
const NEW_ITEM_KINDS = ['세럼', '크림', '토너', '쿠션', '틴트', '선크림', '마스크팩', '앰플'] as const;
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`; };

/** 그 날 팔 수 있는 상품 = v2 20 + 40 + 2026-11 부터 달마다 신상품 2종(출시 달 전에는 없다 · 결정적). */
export function realismCatalogOn(ymd: string): Product[] {
  const out: Product[] = [...DEMO_PRODUCTS, ...EXTRA_PRODUCTS];
  for (let ym = NEW_PRODUCT_FIRST_MONTH; ym <= ymd.slice(0, 7); ym = nextMonth(ym)) {
    const r = rng(`v3-new-${ym}`);
    for (const n of [1, 2]) out.push({ code: `NW-${ym.slice(2, 4)}${ym.slice(5, 7)}-${n}`, name: `${pick(r, NEW_ITEM_TAGS)} ${pick(r, NEW_ITEM_KINDS)}`, price: intIn(r, 15, 60) * 1000 });
  }
  return out;
}

/** 행사 할인율 — 달마다 5일 · 10 ~ 30%(가정 · 결정적) · 행사 아닌 날 0. */
export function promoDiscountOn(ymd: string): number {
  const r = rng(`v3-promo-${ymd.slice(0, 7)}`);
  const start = intIn(r, 1, 24);
  const pct = intIn(r, 10, 30);
  const d = Number(ymd.slice(8, 10));
  return d >= start && d < start + 5 ? pct / 100 : 0;
}
const salePrice = (price: number, ymd: string) => Math.round((price * (1 - promoDiscountOn(ymd))) / 100) * 100;

/** 한 방문 목표 줄 수 1 ~ 6(실측 평균 2.88 · 중간 2 · 90% 5 에 맞춘 가중치 · 평균 2.89). */
const BASKET_WEIGHTS = [18, 32, 20, 12, 9, 9] as const;
function basketSize(index: number, day: number): number {
  let t = rng(`v3-basket-${index}-${day}`)() * 100;
  for (let k = 0; k < BASKET_WEIGHTS.length; k++) { t -= BASKET_WEIGHTS[k]; if (t < 0) return k + 1; }
  return BASKET_WEIGHTS.length;
}

/**
 * 그 날 한 고객의 매장 줄(v3) — v2 줄은 같은 원장 키로(수량 1 · 행사가 · 시각 · 매장 = 첫 줄) · 모자란 만큼 「함께 산 상품」 새 키 demo-v3x-번호-날-n.
 *   원장 업서트가 같은 키를 갱신하므로(sync-ingest ON CONFLICT DO UPDATE) 같은 날을 v2 · v3 로 한 번씩 보내도 두 번 쌓이지 않는다.
 */
export function realismPurchasesOn(index: number, day: number): DemoPurchaseRow[] {
  const base = purchasesOn(index, day);
  if (!base.length) return [];
  const ymd = dayToYmd(day);
  const head = base[0];
  const lines: DemoPurchaseRow[] = base.map((b) => ({
    ...b, purchase_date: head.purchase_date, store_code: head.store_code, store_name: head.store_name, quantity: 1, total_amount: salePrice(b.unit_price, ymd),
  }));
  const extra = basketSize(index, day) - lines.length;
  if (extra > 0) {
    const cat = realismCatalogOn(ymd);
    const r = rng(`v3-extra-${index}-${day}`);
    for (let n = 0; n < extra; n++) {
      const p = pick(r, cat);
      lines.push({
        customer_phone: head.customer_phone, purchase_date: head.purchase_date, product_code: p.code, product_name: p.name,
        quantity: 1, unit_price: p.price, total_amount: salePrice(p.price, ymd), store_code: head.store_code, store_name: head.store_name,
        source_row_key: `demo-v3x-${index}-${day}-${n}`,
      });
    }
  }
  return lines;
}

/** 수신거부 날(결정적 · 하루 0.05% 위험률 · 가정) — 이 날부터 보내는 고객 행은 sms_opt_in = false. */
const OPT_OUT_DAILY = 0.0005;
export function optOutDay(index: number): number {
  const u = rng(`v3-optout-${index}`)();
  return demoSignupDay(index) + Math.floor(Math.log(1 - u) / Math.log(1 - OPT_OUT_DAILY));
}

const GRADE_ORDER = ['일반', '실버', '골드', 'VIP'] as const;
const GRADE_BY_SPEND: Array<[number, number]> = [[2_000_000, 3], [800_000, 2], [300_000, 1]];   // 누적 구매 기준(가정)
const POINT_RATE = 0.03;
const POINT_USE_SHARE = 0.25;
const usesPoints = (index: number, day: number) => rng(`v3-pts-${index}-${day}`)() < POINT_USE_SHARE;

/**
 * 등급 · 포인트(순수) — visits = 날짜순 방문 합계(그 끝 날까지만 넘긴다).
 *   등급 = max(번호 고정 등급 · 누적 기준) · 포인트 = 방문마다 그날 합계 3% 적립 · 사용 방문은 그 전까지 쌓인 것을 다 쓰고 적립 · 소멸 없음(설계서 K6).
 */
export function loyaltyAt(index: number, baseGrade: string, visits: ReadonlyArray<{ day: number; amount: number }>, uses: (index: number, day: number) => boolean = usesPoints): { grade: string; points: number } {
  let total = 0;
  let points = 0;
  for (const v of visits) {
    total += v.amount;
    if (uses(index, v.day)) points = 0;
    points += Math.floor(v.amount * POINT_RATE);
  }
  const spendRank = GRADE_BY_SPEND.find(([min]) => total >= min)?.[1] ?? 0;
  const rank = Math.max(Math.max(0, GRADE_ORDER.indexOf(baseGrade as (typeof GRADE_ORDER)[number])), spendRank);
  return { grade: GRADE_ORDER[rank], points };
}

type LedgerRow = { day: number; ymd: string; at: string; amount: number; store: string | null };

/** 매장 원장 행(그 번호들) — 등급 · 포인트 · 누적값의 원천. */
async function readLedgerRows(companyId: string, phones: readonly string[]): Promise<Map<string, LedgerRow[]>> {
  const out = new Map<string, LedgerRow[]>();
  if (!phones.length) return out;
  const r = await query(
    `SELECT p.customer_phone, to_char(p.purchase_date, 'YYYY-MM-DD') AS d, to_char(p.purchase_date, 'YYYY-MM-DD HH24:MI:SS') AS at, p.total_amount, p.store_name
       FROM ${LEDGER_PURCHASES_SQL} p
      WHERE p.company_id = $1::uuid AND p.customer_phone = ANY($2::text[])`,
    [companyId, phones],
  );
  for (const row of r.rows) {
    const phone = String(row.customer_phone);
    const ymd = String(row.d);
    const list = out.get(phone) || [];
    list.push({ day: dayNumber(ymd), ymd, at: String(row.at), amount: Number(row.total_amount) || 0, store: row.store_name ? String(row.store_name) : null });
    out.set(phone, list);
  }
  return out;
}

/** 이미 고객 행이 있는 번호(is_active 무관). */
async function existingPhones(companyId: string, phones: readonly string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const r = await query(`SELECT phone FROM customers WHERE company_id = $1::uuid AND phone = ANY($2::text[])`, [companyId, phones]);
  return new Set(r.rows.map((x: any) => String(x.phone)));
}

/** 고객 행(v3) — 끝 날까지의 원장으로 누적 · 등급 · 포인트 · 판매일 기준 수신동의. */
export function realismCustomerRow(index: number, rows: readonly LedgerRow[], endDay: number, salesDay: number): DemoCustomerRow {
  const c = demoIdentity(index);
  const upto = rows.filter((x) => x.day <= endDay);
  const byDay = new Map<number, number>();
  for (const x of upto) byDay.set(x.day, (byDay.get(x.day) || 0) + x.amount);
  const visits = [...byDay].sort((a, b) => a[0] - b[0]).map(([day, amount]) => ({ day, amount }));
  const { grade, points } = loyaltyAt(index, c.grade, visits);
  const last = upto.reduce<LedgerRow | null>((a, b) => (!a || b.at > a.at ? b : a), null);
  return {
    ...c, grade, points, sms_opt_in: optOutDay(index) > salesDay,
    total_purchase_amount: upto.reduce((s, x) => s + x.amount, 0), purchase_count: upto.length,
    ...(last ? { recent_purchase_date: last.ymd, recent_purchase_amount: byDay.get(last.day) ?? last.amount, recent_purchase_store: last.store } : {}),
  };
}

/** 하루치(v3 · 결정적) — 대상 번호와 매장 줄. */
export function buildRealismBatch(today: string): { sd: number; newIndexes: number[]; buyerIndexes: number[]; optOutIndexes: number[]; purchases: DemoPurchaseRow[] } {
  const sd = dayNumber(addDays(today, -1));
  const base = dailyIndexBase(today);
  const newIndexes = Array.from({ length: dailyNewCount(today) }, (_, k) => base + k);
  const pool = [...Array.from({ length: DEMO_SEED_CUSTOMERS }, (_, i) => i), ...dailyIndexesBefore(today), ...newIndexes];
  const buyerIndexes: number[] = [];
  const optOutIndexes: number[] = [];
  const purchases: DemoPurchaseRow[] = [];
  for (const idx of pool) {
    const rows = realismPurchasesOn(idx, sd);
    if (rows.length) { buyerIndexes.push(idx); purchases.push(...rows); }
    const o = optOutDay(idx);
    if (o >= sd - 6 && o <= sd) optOutIndexes.push(idx);
  }
  return { sd, newIndexes, buyerIndexes, optOutIndexes, purchases };
}

/**
 * 하루치 적재(v3) — ①그 회차 대상 중 **고객 행이 없는 번호만** 만든다(값 = 판매일 전날까지 · 이미 있는 고객은 안 보낸다 = 재실행에서 등급을 낮추는 쓰기 0 · Codex 설계 2R)
 *   ②매장 줄 ③구매 뒤 고객 행(그날 구매 고객 ∪ 최근 7일 수신거부 · 판매일까지 원장 = 등급 · 포인트를 쓰는 유일한 단계) · 싱크 응답 실패 행 = 던짐(회차 미완).
 */
export async function pushRealismDaily(companyId: string, key: DemoSyncKey, now: Date = new Date()): Promise<{ newCustomers: number; repeat: number; purchases: number }> {
  const b = buildRealismBatch(kstDate(now));
  const targets = [...new Set([...b.newIndexes, ...b.buyerIndexes, ...b.optOutIndexes])];
  const have = await existingPhones(companyId, targets.map(demoPhone));
  const missing = targets.filter((i) => !have.has(demoPhone(i)));
  if (missing.length) {
    const led = await readLedgerRows(companyId, missing.map(demoPhone));
    await postSync('customers', missing.map((i) => realismCustomerRow(i, led.get(demoPhone(i)) || [], b.sd - 1, b.sd)), key, { strict: true });
  }
  if (b.purchases.length) await postSync('purchases', b.purchases, key, { strict: true });
  const post = [...new Set([...b.buyerIndexes, ...b.optOutIndexes])];
  if (post.length) {
    const led = await readLedgerRows(companyId, post.map(demoPhone));
    await postSync('customers', post.map((i) => realismCustomerRow(i, led.get(demoPhone(i)) || [], b.sd, b.sd)), key, { strict: true });
  }
  return { newCustomers: missing.length, repeat: post.length, purchases: b.purchases.length };
}

// ── 온라인(자사몰) ──

export interface CdpKey { apiKey: string; apiSecret: string }

/** ENV SYNTHETIC_CDP_KEYS = 「hjl_키:sk_비밀」 쉼표 · 같은 키는 처음 것 · 키나 비밀이 빈 것은 버린다. */
export function parseSyntheticCdpKeys(env: EnvLike = process.env): CdpKey[] {
  const out: CdpKey[] = [];
  const seen = new Set<string>();
  for (const part of String(env.SYNTHETIC_CDP_KEYS || '').split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const apiKey = part.slice(0, i).trim();
    const apiSecret = part.slice(i + 1).trim();
    if (!apiKey || !apiSecret || seen.has(apiKey)) continue;
    seen.add(apiKey);
    out.push({ apiKey, apiSecret });
  }
  return out;
}

const MALL_MEMBER_SHARE = 0.4;
const ONLINE_VISIT_SHARE = 0.05;
export const ONLINE_WINDOW_DAYS = 7;
const ONLINE_TICK_CAP = 600;
const ONLINE_PACE_MS = 250;   // 쓰기 한도 10초 50(cdpWriteBurst) 아래 · 초당 4
export const isMallMember = (index: number) => rng(`v3-mall-${index}`)() < MALL_MEMBER_SHARE;
export const mallExternalId = (index: number) => `M${String(index).padStart(7, '0')}`;
const isoKst = (ymd: string, sec: number) => `${ymd}T${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}+09:00`;

export interface OnlineSend { key: string; at: string; index: number; kind: 'event' | 'order'; body: Record<string, any> }

/**
 * 그 날 몰 일정(결정적) — 회원 = 그 날 전에 고객 행이 생긴 번호(시드 + 그 날 전 묶음) 중 40% · 하루 5% 방문 · 그 날 매장 구매가 있으면 몰 방문 0(두 문 CT-D1 · K5).
 *   방문 = 홈 → 상품 조회 1 ~ 5 → 15% 담기(1 ~ 3) → 담은 사람 55% 결제 시작 → 그중 80% 주문(가정) · 시각 09:00 ~ 22:30 시작.
 */
export function onlineScheduleOn(ymd: string): OnlineSend[] {
  const d = dayNumber(ymd);
  const cat = realismCatalogOn(ymd);
  const out: OnlineSend[] = [];
  const members = [...Array.from({ length: DEMO_SEED_CUSTOMERS }, (_, i) => i), ...dailyIndexesBefore(ymd)].filter(isMallMember);
  for (const idx of members) {
    const r = rng(`v3-visit-${ymd}-${idx}`);
    if (r() >= ONLINE_VISIT_SHARE) continue;
    if (demoTimeline(idx).buys.some((b) => b.day === d)) continue;
    const ext = mallExternalId(idx);
    let t = intIn(r, 9 * 3600, (22 * 60 + 30) * 60);
    let seq = 0;
    const ev = (event_name: string, properties: Record<string, unknown>) => {
      const key = `ev-${ymd}-${idx}-${seq++}`;
      const at = isoKst(ymd, t);
      out.push({ key, at, index: idx, kind: 'event', body: { event_name, external_id: ext, occurred_at: at, properties: { ...properties, event_key: key } } });
      t += intIn(r, 30, 180);
    };
    ev('page_view', { path: '/' });
    const viewed: Product[] = [];
    for (let n = intIn(r, 1, 5); n > 0; n--) {
      const p = pick(r, cat);
      viewed.push(p);
      ev('product_view', { product_code: p.code, product_name: p.name, price: salePrice(p.price, ymd) });
    }
    if (r() >= 0.15) continue;
    const distinct = [...new Map(viewed.map((p) => [p.code, p])).values()];
    const cart = distinct.slice(0, intIn(r, 1, Math.min(3, distinct.length)));
    for (const p of cart) ev('cart_add', { product_code: p.code, product_name: p.name, price: salePrice(p.price, ymd), quantity: 1 });
    if (r() >= 0.55) continue;
    const total = cart.reduce((s, p) => s + salePrice(p.price, ymd), 0);
    ev('checkout_start', { cart_value: total, item_count: cart.length });
    if (r() >= 0.8) continue;
    const orderId = `INV-${ymd.replace(/-/g, '')}-${idx}`;
    const at = isoKst(ymd, t);
    out.push({
      key: orderId, at, index: idx, kind: 'order',
      body: {
        order_id: orderId, external_id: ext, status: 'paid', total_amount: total, item_count: cart.length, ordered_at: at,
        items: cart.map((p) => ({ productId: p.code, productName: p.name, price: salePrice(p.price, ymd), quantity: 1 })),
      },
    });
  }
  return out;
}

/** 지금 보낼 차례인 것 = 최근 7일 일정 중 시각이 지금 이전 · 오래된 것부터. */
export function dueOnlineSends(now: Date): OnlineSend[] {
  const today = kstDate(now);
  const all: OnlineSend[] = [];
  for (let k = ONLINE_WINDOW_DAYS - 1; k >= 0; k--) all.push(...onlineScheduleOn(addDays(today, -k)));
  const nowMs = now.getTime();
  return all.filter((s) => Date.parse(s.at) <= nowMs).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** 이미 적힌 사건 키 · 주문 번호(그 시각부터 · 자사몰 키 source = sdk) — 사건 이름으로 거르지 않는다(주문 사건 이름 판정 = 주문 CT 한 곳 · R22). */
async function sentOnlineKeys(companyId: string, fromIso: string): Promise<Set<string>> {
  const r = await query(
    `SELECT properties->>'event_key' AS k, properties->>'order_id' AS o
       FROM cdp_events
      WHERE company_id = $1::uuid AND source = 'sdk' AND occurred_at >= $2::timestamptz
        AND (properties ? 'event_key' OR properties ? 'order_id')`,
    [companyId, fromIso],
  );
  const out = new Set<string>();
  for (const row of r.rows) { if (row.k) out.add(String(row.k)); if (row.o) out.add(String(row.o)); }
  return out;
}

/** 고객에 이어진 몰 회원 번호. */
async function linkedExternalIds(companyId: string, externalIds: readonly string[]): Promise<Set<string>> {
  if (!externalIds.length) return new Set();
  const r = await query(
    `SELECT external_id FROM cdp_identity_links WHERE company_id = $1::uuid AND source = 'sdk' AND external_id = ANY($2::text[]) AND customer_id IS NOT NULL`,
    [companyId, externalIds],
  );
  return new Set(r.rows.map((x: any) => String(x.external_id)));
}

async function postCdp(path: 'identify' | 'event' | 'order', body: unknown, key: CdpKey): Promise<void> {
  const port = process.env.PORT || 3000;
  const res = await fetch(`http://127.0.0.1:${port}/api/cdp/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hanjullo-Key': key.apiKey, 'X-Hanjullo-Secret': key.apiSecret },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`cdp ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const onlineSkipLogged = new Set<string>();
const droppedLoggedDay = new Map<string, string>();
/** 키 → 이 실제 시각(clock) 전에는 다시 보내지 않는다(실패 시각 + 10분 · tick 은 고정 주기라 실패 직후 tick 이 올 수 있다 · Codex 구현 1R · 2R) */
const onlineRetryNotBefore = new Map<string, number>();
const ONLINE_RETRY_WAIT_MS = 10 * 60_000;
/** 시험 전용 — 프로세스 메모리 상태 비우기. */
export function resetRealismOnlineState(): void {
  onlineSkipLogged.clear();
  droppedLoggedDay.clear();
  onlineRetryNotBefore.clear();
}

/**
 * 온라인 한 tick — 보낼 차례 − 이미 적힌 것 · 고객 행이 아직 없는 회원은 미룸 · 오래된 것부터 상한 600 · 회원 잇기는 그 회원 첫 사건 직전.
 *   오류 = 던져서 이번 tick 을 멈춘다(같은 tick 안에서 다시 보내지 않음 · 다음 tick 이 적힌 키를 다시 읽는다 · 설계서 §5 상한).
 *   7일 창에서 막 빠진 날의 미전송 = 보내지 않고 건수만 로그(하루 한 번).
 */
export async function pushRealismOnline(key: CdpKey, now: Date = new Date(), paceMs: number = ONLINE_PACE_MS, clock: () => number = Date.now): Promise<{ sent: number; deferred: number; skipped?: string }> {
  // 시각 축 둘 — now = 사건 일정의 기준 시각 · clock = 실패 뒤 대기를 재는 실제 시계(tick 시작과 실제 실패 사이가 몇 분 벌어질 수 있다 · Codex 구현 2R)
  if (clock() < (onlineRetryNotBefore.get(key.apiKey) ?? 0)) return { sent: 0, deferred: 0 };   // 실패 뒤 10분 = 늦게 끝나는 원 요청의 INSERT 를 기다린다
  const owner = await query(`SELECT id FROM companies WHERE cdp_api_key = $1`, [key.apiKey]);
  const companyId = owner.rows[0]?.id ? String(owner.rows[0].id).toLowerCase() : '';
  if (!companyId || !(await isRealismCompany(companyId))) return { sent: 0, deferred: 0, skipped: '자사몰 합성 키가 허용 목록 회사(시연 아님) 것이 아닙니다. 보내지 않았습니다.' };
  const today = kstDate(now);
  const dropDay = addDays(today, -ONLINE_WINDOW_DAYS);
  const sent = await sentOnlineKeys(companyId, `${dropDay}T00:00:00+09:00`);
  if (droppedLoggedDay.get(key.apiKey) !== today) {
    droppedLoggedDay.set(key.apiKey, today);
    const dropped = onlineScheduleOn(dropDay).filter((s) => !sent.has(s.key)).length;
    if (dropped) console.warn(`[demo-data] ${key.apiKey.slice(0, 10)} 자사몰 합성 ${dropDay} 미전송 ${dropped}건 = 7일 창 밖이라 보내지 않음`);
  }
  let pending = dueOnlineSends(now).filter((s) => !sent.has(s.key));
  if (!pending.length) return { sent: 0, deferred: 0 };
  const have = await existingPhones(companyId, [...new Set(pending.map((s) => demoPhone(s.index)))]);
  const deferred = pending.filter((s) => !have.has(demoPhone(s.index))).length;
  pending = pending.filter((s) => have.has(demoPhone(s.index))).slice(0, ONLINE_TICK_CAP);
  const linked = await linkedExternalIds(companyId, [...new Set(pending.map((s) => mallExternalId(s.index)))]);
  const pace = () => (paceMs > 0 ? new Promise((res) => setTimeout(res, paceMs)) : Promise.resolve());
  let count = 0;
  try {
    for (const s of pending) {
      const ext = mallExternalId(s.index);
      if (!linked.has(ext)) {
        await postCdp('identify', { external_id: ext, phone: demoPhone(s.index) }, key);
        linked.add(ext);
        await pace();
      }
      await postCdp(s.kind === 'order' ? 'order' : 'event', s.body, key);
      count++;
      await pace();
    }
  } catch (err) {
    onlineRetryNotBefore.set(key.apiKey, clock() + ONLINE_RETRY_WAIT_MS);   // 실제 실패 시각 + 10분 뒤에 적힌 키를 다시 읽는다
    throw err;
  }
  return { sent: count, deferred };
}
