/**
 * one-line.ts — 한줄로 시그니처 화면 CT (★ 2026-10-05 · 설계서 docs/2026-10-05-hanjul-signature-design.md §3 · §4)
 *
 * "한 줄이면 보낼 수 있는 완성본이 나옵니다. 저희가 지어낼 수 없는 사실만 한 번 여쭙니다."
 *
 * ⛔ 무엇을 물을지(판정)는 서버(`POST /api/ai/one-line/gaps`)가 소유한다 — 화면에 규칙 사본을 두지 않는다.
 * 여기는 ① 판정 조회 ② 시도 토큰 ③ 채울 자리 종류표 · 종류별 좁은 치환 ④ 이메일 발송 관문 판정 미러.
 * 백엔드 짝 테스트(`backend/src/utils/__tests__/hanjul-signature-ui-1005.test.ts`)가 실제 import 로 서버 값과 대조한다.
 */

export interface OneLineGapsResult {
  /** 이 회사에 한줄로 시그니처가 열려 있는가(서버 스위치) */
  enabled: boolean;
  gaps: { benefit: boolean };
  /** ★ 2026-10-10 몰 후보 검색어(서버 판정 · 판정이 아니라 찾기 입력) */
  productTerms: string[];
  /** ★ 2026-10-10 한 줄에 적은 혜택 % 값(담은 상품 아래 안내 한 줄용) */
  benefitPercents: number[];
}

/**
 * 한 줄 판정(AI 0 · 무과금). 조회 실패 = null → 호출부는 지금 화면 그대로 간다(모르면 묻지 않는다).
 * ★ 2026-10-10 reads = 한 줄 칸에 붙인 사진 글 조각(서버가 그 조각의 숫자를 지운 글로 혜택을 판정한다 · H3).
 */
export async function fetchOneLineGaps(line: string, reads?: readonly string[]): Promise<OneLineGapsResult | null> {
  try {
    const res = await fetch('/api/ai/one-line/gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ line: String(line || '').slice(0, 2000), ...(reads && reads.length > 0 ? { read_texts: reads.slice(0, 5) } : {}) }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    return {
      enabled: d.enabled === true,
      gaps: { benefit: d.gaps?.benefit === true },
      productTerms: Array.isArray(d.product_terms) ? d.product_terms.map(String).filter(Boolean).slice(0, 3) : [],
      benefitPercents: Array.isArray(d.benefit_percents) ? d.benefit_percents.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [],
    };
  } catch {
    return null;
  }
}

// ─────────────── 몰 후보 · 확정 상품 (★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-dm-email-design.md §3-3 · §3-4) ───────────────

/** 한 줄 확인 창에 보이는 몰 후보 1개 — no = 서버가 다시 읽을 상품번호(없으면 후보가 못 된다) */
export interface LineMallCandidate {
  provider: string;
  no: string;
  name: string;
  price: number;
  salePrice: number;
  imageUrl: string | null;
  /** 검색어와 정규화 후 같은 이름(서버 판정 · 화면은 표식만 · 미리 체크하지 않는다) */
  exact: boolean;
}
/** 서버로 보내는 확정 상품(이름 · 가격은 보내지 않는다 · 서버가 몰에서 다시 읽는다) */
export interface LineProductRef { provider: string; no: string }

/** 후보 검색 전체 시간 상한(넘으면 상품을 묻지 않는다 · 확인 창은 막지 않는다) */
export const LINE_MALL_SEARCH_TIMEOUT_MS = 5000;
/** 확인 창에 보이는 후보 상한(3칸 × 2줄) · 검색어 하나당 상한 */
export const LINE_MALL_CANDIDATES_MAX = 6;
const LINE_MALL_PER_TERM = 3;

/** 재조회가 되는 몰만(카페24 · 우커머스 · 네이버는 상품번호로 다시 읽는 길이 없다) */
export function isLineMallProvider(provider: string): boolean {
  return provider === 'cafe24' || provider.startsWith('woocommerce:');
}

/**
 * 한 줄 검색어 → 몰 후보. 재조회 가능한 몰마다 · 낱말마다 **순서대로** 부른다(카페24 토큰 동시 재발급을 피한다) · 시간 상한 안에서만.
 * mallReady = 재조회 가능한 몰이 하나라도 연동돼 있는가(없으면 상품 칸을 그리지 않는다). 실패 · 시간 초과 = 지금까지 모은 것(없으면 빈 목록).
 */
export async function fetchLineMallCandidates(terms: readonly string[], signal?: AbortSignal): Promise<{ mallReady: boolean; candidates: LineMallCandidate[] }> {
  const auth = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LINE_MALL_SEARCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const out: LineMallCandidate[] = [];
  let mallReady = false;
  try {
    const pr = await fetch('/api/mall-products/providers', { headers: auth, signal: ctrl.signal });
    const pd = await pr.json().catch(() => ({}));
    const providers: string[] = (Array.isArray(pd?.providers) ? pd.providers : []).map((p: any) => String(p?.provider || '')).filter(isLineMallProvider);
    mallReady = providers.length > 0;
    const seen = new Set<string>();
    for (const term of terms) {
      let perTerm = 0;
      for (const provider of providers) {
        if (perTerm >= LINE_MALL_PER_TERM || out.length >= LINE_MALL_CANDIDATES_MAX) break;
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(`/api/mall-products/search?provider=${encodeURIComponent(provider)}&limit=${LINE_MALL_PER_TERM}&q=${encodeURIComponent(term)}`, { headers: auth, signal: ctrl.signal });
        // eslint-disable-next-line no-await-in-loop
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.success === false || !Array.isArray(d?.products)) continue;
        for (const p of d.products) {
          const no = typeof p?.no === 'string' && /^\d+$/.test(p.no) ? p.no : '';
          const key = `${provider}:${no}`;
          if (!no || seen.has(key) || perTerm >= LINE_MALL_PER_TERM || out.length >= LINE_MALL_CANDIDATES_MAX) continue;
          seen.add(key);
          perTerm += 1;
          out.push({ provider, no, name: String(p.name || ''), price: Number(p.price) || 0, salePrice: Number(p.salePrice) || 0, imageUrl: p.imageUrl ? String(p.imageUrl) : null, exact: p.exact === true });
        }
      }
    }
  } catch { /* 시간 초과 · 실패 = 모은 것까지 */ } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  return { mallReady, candidates: out };
}

/** DM 한 줄 생성 요청(첫 화면 · 결과 화면 다시 만들기가 같은 함수를 쓴다) */
export interface LineDmRequest {
  line: string;
  facts?: { benefit: string | null };
  /** ★ 2026-10-10 H3 — 한 줄에 그대로 남은 사진 글 조각 · 「사진에서 읽은 숫자도 그대로 쓰기」 체크 */
  reads?: string[];
  readLicensed?: boolean;
  /** undefined = 후보를 보여 주지 않음(지금처럼 이름 첨부) · 배열 = 보여 줬다(빈 배열 = 안 고름) */
  products?: LineProductRef[];
}
export interface LineDmResponse {
  ok: boolean;
  status: number;
  code: string;
  error: string;
  data: any;
  excluded: Array<{ name: string | null; reason: string }>;
}

/** 한 줄 DM 생성 응답 → 결과 화면 안내 문장(서버 문장 그대로 · 화면이 문구를 만들지 않는다) */
export function lineResultNotes(data: any): string[] {
  const out: string[] = [];
  const ol = data?.one_line || {};
  for (const n of Array.isArray(ol.notes) ? ol.notes : []) if (n) out.push(String(n));
  for (const m of Array.isArray(data?.coverage?.missing) ? data.coverage.missing : []) {
    const label = String(m?.label || '').trim();
    if (label) out.push(`반영하지 못한 항목: ${label}`);
  }
  if (ol.gaps?.benefit === true && !ol.benefit) out.push('혜택을 적지 않아 혜택 수치는 싣지 않았어요');
  return out;
}

/** 한 줄 DM → 서버 초안(결과 화면 착지 · land:'result'). 시도 토큰은 부를 때마다 새로 만든다. */
export async function requestLineDm(req: LineDmRequest): Promise<LineDmResponse> {
  try {
    const res = await fetch('/api/dm/ai/one-shot-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({
        prompt: req.line, one_line: true, attempt_token: newAttemptToken(), land: 'result',
        ...(req.facts ? { facts: req.facts } : {}),
        ...(req.products ? { products: req.products.map((p) => ({ provider: p.provider, no: p.no })) } : {}),
        ...(req.reads && req.reads.length > 0 ? { read_texts: req.reads, read_licensed: req.readLicensed === true } : {}),
      }),
    });
    const d = await res.json().catch(() => ({}));
    return {
      ok: res.ok && d?.success !== false,
      status: res.status,
      code: String(d?.code || ''),
      error: String(d?.error || ''),
      data: d?.data || null,
      excluded: Array.isArray(d?.excluded) ? d.excluded : [],
    };
  } catch (e: any) {
    return { ok: false, status: 0, code: 'NETWORK', error: e?.message || '연결이 끊겼어요.', data: null, excluded: [] };
  }
}

/** 스위치만 알고 싶을 때(로그인 단위 캐시 · 켜짐만 기억) */
let enabledForToken: string | null = null;
export async function fetchOneLineEnabled(): Promise<boolean> {
  const token = localStorage.getItem('token') || '';
  if (token && enabledForToken === token) return true;
  const r = await fetchOneLineGaps('');
  if (r?.enabled) enabledForToken = token;
  return !!r?.enabled;
}

/**
 * 이미지에서 읽은 글을 한 줄 칸에 붙인다(설계서 §8). 한 줄 칸(`<input>`)은 줄바꿈을 지워
 * 「1+1」과 「3일간」이 「1+13일간」으로 붙는다(혜택 판정 · 문안 근거가 틀어진다) → 줄바꿈을 「 · 」로 바꿔 넣는다.
 */
export function appendToOneLine(prev: string, text: string): string {
  const t = readPartOf(text);
  const p = String(prev || '').trim();
  if (!t) return p;
  return p ? `${p} · ${t}` : t;
}

/** ★ 2026-10-10 H3 — 사진에서 읽은 글이 한 줄 칸에 실리는 모양(appendToOneLine 이 붙이는 글자 그대로) */
export function readPartOf(text: string): string {
  return String(text || '').split(/\s*\n+\s*/).map((s) => s.trim()).filter(Boolean).join(' · ');
}

/** ★ 2026-10-10 H3 — 기억한 사진 글 조각 중 지금 한 줄에 **그대로** 남은 것만(고친 조각 = 직접 친 글 · 최대 5) */
export function readsInLine(line: string, reads: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of reads) if (r && line.includes(r) && !out.includes(r)) out.push(r);
  return out.slice(-5);
}

/** 시도 토큰 — [만들기]를 누를 때마다 새로 만든다(서버 멱등키의 한 조각 · 영숫자 · 하이픈). */
export function newAttemptToken(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return String(c.randomUUID());
  return `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// ─────────────── 채울 자리 ───────────────

/**
 * 생성기가 **실제로 심는** 자리 표기(정확한 글자만). 넓히면 정상 문구를 지운다(`[기간 …]`이 혜택으로 덮이는 등).
 * 혜택 = 이메일 생성기 · 문자 출구 가드 · 인앱 출구 가드 · 자동 마케팅/비상 문안. 기간 = 이메일 생성기.
 */
export const SLOT_TEXTS = {
  benefit: ['[혜택을 직접 입력해주세요]', '[혜택 안내: 직접 수정해주세요]', '[혜택 안내: 직접 작성해주세요]', '[혜택 내용을 입력해주세요]'],
  period: ['[기간을 직접 입력해주세요]'],
} as const;
export type SlotKind = keyof typeof SLOT_TEXTS;

/** 객체 트리의 문자열 전부(깊이 12) */
export function stringsDeep(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const v of node) stringsDeep(v, out, depth + 1); return out; }
  if (typeof node === 'object') { for (const v of Object.values(node as Record<string, unknown>)) stringsDeep(v, out, depth + 1); }
  return out;
}

/** 이 종류의 자리가 몇 곳 남았는가 */
export function countSlots(texts: readonly string[], kind: SlotKind): number {
  let n = 0;
  for (const t of texts) for (const s of SLOT_TEXTS[kind]) n += t.split(s).length - 1;
  return n;
}

/** 이 종류의 자리만 값으로 바꾼다(정확한 표기만 · 값이 비면 그대로) */
export function fillSlots(text: string, kind: SlotKind, value: string): string {
  const v = String(value || '').trim();
  if (!v) return text;
  let out = text;
  for (const s of SLOT_TEXTS[kind]) out = out.split(s).join(v);
  return out;
}

/** 트리 전체에서 이 종류의 자리만 바꾼다(링크 · 이미지 값은 자리 표기가 아니라 건드리지 않는다) */
export function fillSlotsDeep<T>(node: T, kind: SlotKind, value: string, depth = 0): T {
  if (depth > 12 || node == null) return node;
  if (typeof node === 'string') return fillSlots(node, kind, value) as unknown as T;
  if (Array.isArray(node)) return node.map((v) => fillSlotsDeep(v, kind, value, depth + 1)) as unknown as T;
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = fillSlotsDeep(v, kind, value, depth + 1);
    return out as T;
  }
  return node;
}

/**
 * 이메일 발송 관문 판정 미러(`email-ai.ts PLACEHOLDER_PATTERN`) — 화면의 "보내기 전에 N곳"이 관문이 막는 것과 같은 기준이 되게.
 * 짝 테스트가 서버 정규식 원문과 글자 단위로 대조한다.
 */
export const EMAIL_GATE_PLACEHOLDER_SOURCE = '\\[[^\\[\\]\\n]{0,60}(직접|입력해|작성해)[^\\[\\]\\n]{0,60}\\]';

/** 관문이 막는 자리 수(같은 정규식 · 전부 센다) */
export function countEmailGatePlaceholders(texts: readonly string[]): number {
  const re = new RegExp(EMAIL_GATE_PLACEHOLDER_SOURCE, 'g');
  let n = 0;
  for (const t of texts) n += (String(t || '').match(re) || []).length;
  return n;
}
