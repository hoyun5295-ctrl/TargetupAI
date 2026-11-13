/**
 * product-insight.ts — 성과리포트 「상품 · 검색어」 구역의 서버 호출 · 계산 · 직접발송 넘기기
 *   (★ 2026-11-13 C133 F2 ③ · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-2 · 서버 = backend routes/product-insight.ts · utils/product-signal.ts)
 *
 * 숫자는 서버가 준 값만 쓴다(지어내지 않는다). 모르면 그리지 않는다 — 실패 · 시간 제한 · 닫힌 회사 = null.
 */
import { fetchJson, sendJson } from './dashboard-live';

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
export async function fetchAudience(kind: 'product' | 'search', value: string): Promise<AudienceList | null> {
  const r = await sendJson('/api/product-insight/audience', { method: 'POST', body: { kind, value } }, 30_000);
  if (!r.ok || !r.body?.success || !Array.isArray(r.body.recipients)) return null;
  return { recipients: r.body.recipients, total: Number(r.body.total) || 0, truncated: r.body.truncated === true };
}

// ── 직접발송으로 넘기기(주소에 싣지 않는다 · 한 번 쓰면 비운다) ──

export interface PendingAudience { kind: 'product' | 'search'; value: string; label: string; seen: number }
let pending: PendingAudience | null = null;
/** 분석 화면이 「…에게 보내기」를 누를 때 맡긴다 → 대시보드가 직접발송 창을 열며 꺼내 간다 */
export const stashAudience = (a: PendingAudience): void => { pending = a; };
export const takeAudience = (): PendingAudience | null => { const a = pending; pending = null; return a; };

/** (순수) 불러온 뒤 안내 글 — 분석 화면에서 본 수와 다르면 둘 다 적는다 */
export function audienceLoadedText(a: PendingAudience, now: AudienceList): string {
  const what = a.kind === 'product' ? `「${a.label}」을 보고 안 산 고객` : `「${a.label}」을 찾은 고객`;
  const shown = now.recipients.length.toLocaleString();
  const drift = a.seen !== now.total ? ` (분석 화면 ${a.seen.toLocaleString()}명 → 지금 ${now.total.toLocaleString()}명)` : '';
  const cut = now.truncated ? ` · 앞에서부터 ${shown}명만 담았어요` : '';
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
