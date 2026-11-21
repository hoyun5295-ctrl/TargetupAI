/**
 * product-insight.ts — 성과리포트 「상품 · 검색어」 구역의 서버 호출 · 계산 · 직접발송 넘기기
 *   (★ 2026-11-13 C133 F2 ③ · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-2 · 서버 = backend routes/product-insight.ts · utils/product-signal.ts)
 *
 * 숫자는 서버가 준 값만 쓴다(지어내지 않는다). 모르면 그리지 않는다 — 실패 · 시간 제한 · 닫힌 회사 = null.
 */
import { fetchJson, sendJson } from './dashboard-live';
import type { AskPlan } from './ai-ask';

export interface ProductSignal {
  door: 'mall' | 'ledger';
  key: string;
  name: string;
  views: number;
  carts: number;
  orders: number;
  prevViews: number;
  prevOrders: number;
}
export interface SearchTerm { term: string; searches: number; customers: number }
export interface ProductInsight { windowDays: number; hasSignals: boolean; products: ProductSignal[]; terms: SearchTerm[] }
export interface AudienceCounts { products: Record<string, number>; terms: Record<string, number> }
/** ★ 2026-11-21 C152 D 같이 산 상품 — a 를 산 사람이 같이 산 b(보이는 이름 · 산 사람 수 · 겹친 사람 수) */
export interface BoughtTogether { a: string; aBuyers: number; b: string; both: number }
export interface BoughtTogetherView { windowDays: number; pairs: BoughtTogether[] }

/** 이 사람에게 구역이 열렸는가(닫힘 · 실패 = false) */
export async function fetchProductInsightLive(): Promise<boolean> {
  const r = await fetchJson('/api/product-insight/summary');
  return r.ok && r.body?.success === true && r.body.live === true;
}

/** 상품 표 + 검색어 순위 — 둘 중 하나라도 못 읽으면 null(반쪽 화면을 그리지 않는다) */
export async function fetchProductInsight(): Promise<ProductInsight | null> {
  const [p, t] = await Promise.all([fetchJson('/api/product-insight/products', 20_000), fetchJson('/api/product-insight/search-terms', 20_000)]);
  if (!p.ok || !p.body?.success || !Array.isArray(p.body.products)) return null;
  if (!t.ok || !t.body?.success || !Array.isArray(t.body.terms)) return null;
  return { windowDays: Number(p.body.windowDays) || 30, hasSignals: p.body.hasSignals === true, products: p.body.products, terms: t.body.terms };
}

/** 같이 산 상품 줄 — 못 읽으면 null(그 보기를 그리지 않는다) */
export async function fetchBoughtTogether(): Promise<BoughtTogetherView | null> {
  const r = await fetchJson('/api/product-insight/pairs', 30_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.pairs)) return null;
  return {
    windowDays: Number(r.body.windowDays) || 60,
    pairs: r.body.pairs.filter((p: any) => p && typeof p.a === 'string' && typeof p.b === 'string')
      .map((p: any) => ({ a: p.a, aBuyers: Number(p.aBuyers) || 0, b: p.b, both: Number(p.both) || 0 })),
  };
}

/** 짝마다 「a 사고 b 안 산」 고객 수(입력 차례 그대로) — 못 읽으면 null(단추를 그리지 않는다) */
export async function fetchPairCounts(pairs: Array<{ a: string; b: string }>): Promise<number[] | null> {
  if (pairs.length === 0) return [];
  const r = await sendJson('/api/product-insight/audience-counts', { method: 'POST', body: { keys: [], terms: [], pairs } }, 30_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.pairs)) return null;
  return pairs.map((_, i) => Number(r.body.pairs[i]) || 0);
}

export interface InappTopMessage { messageId: string; title: string; template: string; impressions: number; clicks: number; ctr: number }

/**
 * 인앱 메시지별 최근 30일 노출 · 클릭 — 이미 있는 통계 주소의 응답 그대로(새 집계 0 · 노출 10회 이상 · 클릭률 높은 순).
 *   그 주소는 회사 관리자에게만 열린다(담당자 · 인앱을 안 쓰는 회사 · 실패 = 빈 목록 = 보기 없음).
 */
export async function fetchInappTopMessages(): Promise<InappTopMessage[]> {
  const r = await fetchJson('/api/cdp/inapp/top-messages?limit=20', 20_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.messages)) return [];
  return r.body.messages
    .filter((m: any) => m && typeof m.messageId === 'string')
    .map((m: any) => ({
      messageId: m.messageId, title: String(m.title || ''), template: String(m.template || ''),
      impressions: Number(m.impressions) || 0, clicks: Number(m.clicks) || 0, ctr: Number(m.ctr) || 0,
    }));
}

/** 줄 끝 버튼의 인원(자사몰 상품 키 · 검색어) — 못 읽으면 null(버튼을 그리지 않는다) */
export async function fetchAudienceCounts(keys: string[], terms: string[]): Promise<AudienceCounts | null> {
  const r = await sendJson('/api/product-insight/audience-counts', { method: 'POST', body: { keys, terms } }, 30_000);
  if (!r.ok || !r.body?.success) return null;
  return { products: r.body.products || {}, terms: r.body.terms || {} };
}

export interface AudienceList { recipients: Array<{ phone: string; name: string }>; total: number; truncated: boolean }

/** 직접발송 창에 채울 명단(서버가 지금 다시 센다) */
export async function fetchAudience(kind: 'product' | 'search' | 'pair', value: string, other?: string): Promise<AudienceList | null> {
  const r = await sendJson('/api/product-insight/audience', { method: 'POST', body: kind === 'pair' ? { kind, value, other } : { kind, value } }, 30_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.recipients)) return null;
  return { recipients: r.body.recipients, total: Number(r.body.total) || 0, truncated: r.body.truncated === true };
}

/** ★ 2026-11-21 C151 한 줄로 묻기 명단(서버가 §2-1 같은 문장으로 지금 다시 센다) */
export async function fetchAskAudience(plan: AskPlan): Promise<AudienceList | null> {
  const r = await sendJson('/api/ai-line/ask/audience', { method: 'POST', body: { plan } }, 30_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.recipients)) return null;
  return { recipients: r.body.recipients, total: Number(r.body.total) || 0, truncated: r.body.truncated === true };
}

// ── 직접발송으로 넘기기(주소에 싣지 않는다 · 한 번 쓰면 비운다) ──

/** ★ C151 넘긴 계정 · 시각 · 고른 묶음 · 문안(C136 takeProposalPick 과 같은 꼴 · 지금 계정과 같고 10분 안일 때만 꺼낸다) */
export const ASK_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
export interface AskHandoff { plan: AskPlan; message: { body: string; subject: string; msgType: 'LMS' }; owner: { companyId: string; userId: string }; at: number }
export type PendingAudience =
  | { kind: 'product' | 'search'; value: string; label: string; seen: number }
  // ★ C152 D — value = 산 상품 · other = 안 산 상품(보이는 이름)
  | { kind: 'pair'; value: string; other: string; label: string; seen: number }
  | { kind: 'ask'; label: string; seen: number; ask: AskHandoff };
export interface AudienceViewer { userId?: string | null; companyId?: string | null }

/** (순수) 넘긴 계정 = 지금 계정(회사 · 사용자 둘 다) */
export const askOwnerMatches = (ask: AskHandoff, me: AudienceViewer | null | undefined): boolean =>
  !!me?.userId && !!me.companyId && ask.owner.userId === me.userId && ask.owner.companyId === me.companyId;

let pending: PendingAudience | null = null;
/** 분석 화면이 「…에게 보내기」를 누를 때 맡긴다 → 대시보드가 직접발송 창을 열며 꺼내 간다 */
export const stashAudience = (a: PendingAudience): void => { pending = a; };
/** 한 번 꺼내고 비운다 · ask = 지금 계정과 같고 10분 안일 때만(그 밖 = null) · 옛 kind 둘 = 종전 그대로 */
export const takeAudience = (me?: AudienceViewer | null, now: number = Date.now()): PendingAudience | null => {
  const a = pending;
  pending = null;
  if (a?.kind === 'ask' && (!askOwnerMatches(a.ask, me) || now - a.ask.at < 0 || now - a.ask.at > ASK_HANDOFF_MAX_AGE_MS)) return null;
  return a;
};

/** (순수) 불러온 뒤 안내 글 — 분석 화면에서 본 수와 다르면 둘 다 적는다 */
export function audienceLoadedText(a: PendingAudience, now: AudienceList): string {
  const shown = now.recipients.length.toLocaleString();
  const cut = now.truncated ? ` · 앞에서부터 ${shown}명만 담았어요` : '';
  if (a.kind === 'ask') {
    const drift = a.seen !== now.recipients.length ? ` (고를 때 ${a.seen.toLocaleString()}명 → 지금 ${shown}명)` : '';
    return `고른 고객 ${shown}명과 문안을 불러왔어요${drift}${cut}`;
  }
  const what = a.kind === 'product' ? `「${a.label}」을 보고 안 산 고객`
    : a.kind === 'pair' ? `「${a.value}」을 사고 「${a.other}」은 안 산 고객`
      : `「${a.label}」을 찾은 고객`;
  const drift = a.seen !== now.total ? ` (분석 화면 ${a.seen.toLocaleString()}명 → 지금 ${now.total.toLocaleString()}명)` : '';
  return `${what} ${shown}명을 불러왔어요${drift}${cut}`;
}

// ── 표 계산(순수) ──

export type ProductSortKey = 'views' | 'carts' | 'orders' | 'rate' | 'diff';

/** 조회 대비 구매 비율(조회가 없으면 null = 「—」) */
export const buyRate = (p: ProductSignal): number | null => (p.views > 0 ? p.orders / p.views : null);
/** 지난 30일 대비 조회 차이 */
export const viewDiff = (p: ProductSignal): number => p.views - p.prevViews;

const sortValue = (p: ProductSignal, key: ProductSortKey): number =>
  key === 'rate' ? (buyRate(p) ?? -1) : key === 'diff' ? viewDiff(p) : p[key];

/** 정렬(원본을 바꾸지 않는다) — 같은 값이면 서버 순서(조회 많은 순) 그대로 */
export function sortProducts(list: readonly ProductSignal[], key: ProductSortKey, desc: boolean): ProductSignal[] {
  return list.map((p, i) => ({ p, i })).sort((a, b) => {
    const d = sortValue(a.p, key) - sortValue(b.p, key);
    return d !== 0 ? (desc ? -d : d) : a.i - b.i;
  }).map((x) => x.p);
}

/** 표에 문(자사몰 · 매장) 표시가 필요한가 — 두 문이 다 있을 때만 */
export const hasBothDoors = (list: readonly ProductSignal[]): boolean =>
  list.some((p) => p.door === 'mall') && list.some((p) => p.door === 'ledger');

export const DOOR_LABEL: Record<ProductSignal['door'], string> = { mall: '자사몰', ledger: '매장' };
