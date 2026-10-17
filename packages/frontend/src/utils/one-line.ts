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
  /** ★ 2026-10-10 한 줄 묻기 — 이 회사가 질문을 받는가(서버 스위치) · 질문인가 만들기인가 · 질문의 종류 */
  askEnabled: boolean;
  intent: 'ask' | 'make';
  askTopic: 'what' | 'how' | null;
  /** ★ 2026-10-17 한 줄 단계 모달 — 이 메뉴 · 회사에 단계 모달이 열려 있는가 · 한 줄 완성 전체 금액(버튼 라벨) · 단계 목록(서버 판정) */
  stepsEnabled: boolean;
  stepsCost: number | null;
  plan: LineStepsPlan | null;
}

// ─────────────── 한 줄 단계 모달 (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3 · §4) ───────────────

export type LineStepsChannel = 'dm' | 'email' | 'inapp';
export type LineStepKey = 'benefit' | 'product' | 'hero_photo' | 'link' | 'period';
/** 서버 단계 하나(키 닫힌 목록 · 문구는 화면이 소유 · skip_if 는 서버가 정한 조건 이름) */
export interface LineStep {
  key: LineStepKey;
  item?: string;
  manual_ok?: boolean;
  price?: number;
  url?: string;
  skip_if?: 'product_photo' | 'manual_photo' | 'product_link';
}
export interface LineStepsCost { generate: number; complete: number; total: number }
export interface LineStepsPlan {
  v: 1;
  channel: LineStepsChannel;
  line_fp: string;
  mall: boolean;
  block: null | 'INAPP_DISPLAY_UNAVAILABLE';
  upload: boolean;
  steps: LineStep[];
  later: Array<{ key: LineStepKey; item?: string }>;
  offers: Array<{ item: string; price?: number; url?: string }>;
  filled: { link?: string };
  link_default: null | { kind: 'website' | 'mall_home'; url: string };
  cost: LineStepsCost | null;
}

const STEP_KEYS: readonly string[] = ['benefit', 'product', 'hero_photo', 'link', 'period'];
/** 서버 plan 을 그대로 믿지 않고 모양만 걸러 받는다(모르는 키 = 버린다 · 화면은 닫힌 목록만 그린다) */
function parseLinePlan(raw: any): LineStepsPlan | null {
  if (!raw || raw.v !== 1 || !['dm', 'email', 'inapp'].includes(raw.channel) || typeof raw.line_fp !== 'string') return null;
  const step = (s: any): LineStep | null => (s && STEP_KEYS.includes(s.key) ? {
    key: s.key,
    ...(typeof s.item === 'string' ? { item: s.item } : {}),
    ...(s.manual_ok === true ? { manual_ok: true } : {}),
    ...(Number.isFinite(s.price) ? { price: Number(s.price) } : {}),
    ...(typeof s.url === 'string' ? { url: s.url } : {}),
    ...(['product_photo', 'manual_photo', 'product_link'].includes(s.skip_if) ? { skip_if: s.skip_if } : {}),
  } : null);
  const cost = raw.cost && [raw.cost.generate, raw.cost.complete, raw.cost.total].every(Number.isFinite)
    ? { generate: Number(raw.cost.generate), complete: Number(raw.cost.complete), total: Number(raw.cost.total) } : null;
  return {
    v: 1, channel: raw.channel, line_fp: raw.line_fp, mall: raw.mall === true,
    block: raw.block === 'INAPP_DISPLAY_UNAVAILABLE' ? 'INAPP_DISPLAY_UNAVAILABLE' : null,
    upload: raw.upload === true,
    steps: (Array.isArray(raw.steps) ? raw.steps : []).map(step).filter(Boolean) as LineStep[],
    later: (Array.isArray(raw.later) ? raw.later : []).map(step).filter(Boolean).map((s: LineStep) => ({ key: s.key, ...(s.item ? { item: s.item } : {}) })),
    offers: (Array.isArray(raw.offers) ? raw.offers : []).filter((o: any) => typeof o?.item === 'string').map((o: any) => ({ item: o.item, ...(Number.isFinite(o.price) ? { price: Number(o.price) } : {}), ...(typeof o.url === 'string' ? { url: o.url } : {}) })),
    filled: typeof raw.filled?.link === 'string' ? { link: raw.filled.link } : {},
    link_default: raw.link_default && ['website', 'mall_home'].includes(raw.link_default.kind) && typeof raw.link_default.url === 'string' ? { kind: raw.link_default.kind, url: raw.link_default.url } : null,
    cost,
  };
}

/** ★ 2026-10-10 한 줄 묻기 — 한 줄 입력이 있는 메뉴(서버 판정 · 답 경로가 메뉴로 갈린다) */
export type LineAskMenu = 'journeys' | 'auto-marketing' | 'inapp' | 'dm' | 'email' | 'sns';

/**
 * 한 줄 판정(AI 0 · 무과금). 조회 실패 = null → 호출부는 지금 화면 그대로 간다(모르면 묻지 않는다).
 * ★ 2026-10-10 reads = 한 줄 칸에 붙인 사진 글 조각(서버가 그 조각의 숫자를 지운 글로 혜택을 판정한다 · H3).
 */
export async function fetchOneLineGaps(line: string, reads?: readonly string[], menu?: LineAskMenu): Promise<OneLineGapsResult | null> {
  try {
    const res = await fetch('/api/ai/one-line/gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ line: String(line || '').slice(0, 2000), ...(reads && reads.length > 0 ? { read_texts: reads.slice(0, 5) } : {}), ...(menu ? { menu } : {}) }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    const askEnabled = d.ask_enabled === true;
    const intent: 'ask' | 'make' = askEnabled && d.intent === 'ask' ? 'ask' : 'make';
    return {
      enabled: d.enabled === true,
      gaps: { benefit: d.gaps?.benefit === true },
      productTerms: Array.isArray(d.product_terms) ? d.product_terms.map(String).filter(Boolean).slice(0, 3) : [],
      benefitPercents: Array.isArray(d.benefit_percents) ? d.benefit_percents.map(Number).filter((n: number) => Number.isFinite(n) && n > 0) : [],
      askEnabled,
      intent,
      askTopic: intent === 'ask' ? (d.ask_topic === 'how' ? 'how' : 'what') : null,
      stepsEnabled: d.steps_enabled === true,
      stepsCost: Number.isFinite(d.steps_cost) ? Number(d.steps_cost) : null,
      plan: d.steps_enabled === true ? parseLinePlan(d.plan) : null,
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
  /** ★ 2026-10-17 단계 모달 몸통(`buildLineStepsBody` · 상품 · 답 · 금액을 담는다 · 있으면 facts · products 대신 이것을 보낸다) */
  steps?: Record<string, unknown>;
}
export interface LineDmResponse {
  ok: boolean;
  status: number;
  code: string;
  error: string;
  data: any;
  excluded: Array<{ name: string | null; reason: string }>;
  /** ★ 2026-10-17 PRICE_CHANGED 일 때 서버가 정한 새 금액 */
  cost?: number;
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
        ...(req.steps ? req.steps : {
          ...(req.facts ? { facts: req.facts } : {}),
          ...(req.products ? { products: req.products.map((p) => ({ provider: p.provider, no: p.no })) } : {}),
        }),
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
      ...(Number.isFinite(d?.cost) ? { cost: Number(d.cost) } : {}),
    };
  } catch (e: any) {
    return { ok: false, status: 0, code: 'NETWORK', error: e?.message || '연결이 끊겼어요.', data: null, excluded: [] };
  }
}

// ─────────────── 한 줄 단계 모달 · 답 (★ 2026-10-17) ───────────────

/** 직접 넣은 상품(이름 = 한 줄 낱말을 미리 채움 · 가격 = 한 줄 금액을 미리 채움 · 사진 = 이 화면에서 올린 것만) */
export interface LineManualAnswer { name: string; price: string; image: string | null; url?: string }
/** 상품 단계 답 — pick = 몰 후보 하나 · manual = 직접 넣음 · skip = 건너뜀 */
export interface LineProductAnswer { mode: 'pick' | 'manual' | 'skip'; picked?: LineMallCandidate | null; manual?: LineManualAnswer }
export interface LineStepsAnswers {
  /** undefined = 아직 · null = 없음(건너뜀) */
  benefit?: string | null;
  /** 낱말별 상품 답 */
  products: Record<string, LineProductAnswer>;
  /** 한 줄 속 우리 몰 주소로 찾은 상품(H5 · 미리 담음 · 빼기 가능) · undefined = 아직 받지 않음 */
  urlPicks?: LineMallCandidate[];
  hero?: string | null;
  link?: string | null;
  /** 'YYYY-MM-DD' */
  period?: string | null;
  /** 만들기 단계에서 [넣기]를 누른 낱말(단계가 하나 생긴다) */
  offersAdded: string[];
  /** 사진에서 읽은 숫자도 그대로 쓰기(H3 · 기본 꺼짐) */
  readLicensed?: boolean;
}
export const emptyLineStepsAnswers = (): LineStepsAnswers => ({ products: {}, offersAdded: [] });

/** 단계 하나의 이름표(같은 키가 낱말마다 여럿) */
export const lineStepId = (s: Pick<LineStep, 'key' | 'item'>): string => `${s.key}:${s.item ?? ''}`;

const candKey = (c: Pick<LineMallCandidate, 'provider' | 'no'>) => `${c.provider}:${c.no}`;

/** 보낼 몰 상품(낱말 순서 → 주소로 찾은 상품 · 겹침 제거 · 인앱 = 1개) */
export function lineStepsProducts(a: LineStepsAnswers, channel: LineStepsChannel, termOrder: readonly string[]): LineMallCandidate[] {
  const out: LineMallCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: LineMallCandidate | null | undefined) => { if (c && !seen.has(candKey(c))) { seen.add(candKey(c)); out.push(c); } };
  for (const term of termOrder) { const p = a.products[term]; if (p?.mode === 'pick') push(p.picked); }
  for (const c of a.urlPicks || []) push(c);
  return channel === 'inapp' ? out.slice(0, 1) : out;
}

/** 직접 넣은 상품 가격(숫자만 · 1원 ~ 1억 원 · 그 밖 = null) */
export function lineManualPrice(raw: string): number | null {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isInteger(n) && n > 0 && n <= 100_000_000 ? n : null;
}

/** 직접 넣은 상품(이름이 있는 것만 · 서버 상한 3) */
export function lineStepsManual(a: LineStepsAnswers, termOrder: readonly string[]): LineManualAnswer[] {
  const out: LineManualAnswer[] = [];
  for (const term of termOrder) {
    const p = a.products[term];
    if (p?.mode === 'manual' && p.manual && p.manual.name.trim()) out.push(p.manual);
  }
  return out.slice(0, 3);
}

/** 서버가 단계에 실어 보낸 건너뜀 조건(화면은 이 조건 이름만 해석한다) */
export function lineStepSkipped(step: LineStep, a: LineStepsAnswers, channel: LineStepsChannel, termOrder: readonly string[]): boolean {
  if (!step.skip_if) return false;
  const picked = lineStepsProducts(a, channel, termOrder).length > 0;
  const manual = lineStepsManual(a, termOrder);
  if (step.skip_if === 'product_photo') return picked || manual.some((m) => !!m.image);
  if (step.skip_if === 'manual_photo') return manual.some((m) => !!m.image);
  return picked || manual.some((m) => !!m.url);
}

/** 사람이 친 주소를 http(s) 주소로(스킴이 없으면 https) · 아니면 null */
export function normalizeLineLink(raw: string): string | null {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  if (/\s/.test(s) || s.length > 500) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname.includes('.')) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * 생성 요청 몸통(세 채널 공통 칸 · 설계서 §4-3). shown = 실제로 보인 단계(건너뜀 조건으로 빠진 단계 제외).
 * 사진 · 주소 · 기간은 답한 것만 · 혜택은 단계가 있었으면 답 또는 null(없음) · 시도 토큰은 보내는 쪽이 붙인다.
 */
export function buildLineStepsBody(plan: LineStepsPlan, a: LineStepsAnswers, shown: readonly LineStep[], expectedCost: number): Record<string, unknown> {
  const termOrder = lineStepTerms(plan, a);
  const has = (key: LineStepKey) => shown.some((s) => s.key === key);
  const facts: Record<string, unknown> = {};
  if (plan.steps.some((s) => s.key === 'benefit')) facts.benefit = typeof a.benefit === 'string' && a.benefit.trim() ? a.benefit.trim() : null;
  if (has('period') && a.period) facts.period_end = a.period;
  if (a.link) facts.link = a.link;
  const manual = lineStepsManual(a, termOrder).map((m) => {
    const price = lineManualPrice(m.price);
    return { name: m.name.trim().slice(0, 60), ...(price ? { price } : {}), ...(m.image ? { image: m.image } : {}), ...(m.url ? { url: m.url } : {}) };
  });
  const answered: string[] = [];
  const skipped: string[] = [];
  for (const s of shown) {
    const v = s.key === 'benefit' ? (typeof a.benefit === 'string' && a.benefit.trim() ? 1 : 0)
      : s.key === 'product' ? (a.products[s.item || '']?.mode === 'pick' || a.products[s.item || '']?.mode === 'manual' ? 1 : 0)
        : s.key === 'hero_photo' ? (a.hero ? 1 : 0)
          : s.key === 'link' ? (a.link ? 1 : 0)
            : (a.period ? 1 : 0);
    (v ? answered : skipped).push(s.key);
  }
  return {
    steps: { v: 1 },
    facts,
    products: lineStepsProducts(a, plan.channel, termOrder).map((p) => ({ provider: p.provider, no: p.no })),
    manual_products: manual,
    ...(has('hero_photo') && a.hero ? { hero_image: a.hero } : {}),
    expected_cost: expectedCost,
    steps_meta: { shown: shown.map((s) => s.key), answered, skipped },
  };
}

/** 상품 낱말 순서(서버 단계 → [넣기]로 더한 낱말) */
export function lineStepTerms(plan: LineStepsPlan, a: LineStepsAnswers): string[] {
  const out: string[] = [];
  for (const s of plan.steps) if (s.key === 'product' && s.item && !out.includes(s.item)) out.push(s.item);
  for (const t of a.offersAdded) if (!out.includes(t)) out.push(t);
  return out;
}

/** 몰 후보(서버 판정과 같은 낱말 · 있음 / 없음 / 확인하지 못함 · 주소로 찾은 상품). 실패 = null(모든 낱말을 「확인하지 못함」으로) */
export interface LineCandidatesResult {
  byTerm: Record<string, { status: 'ok' | 'none' | 'unknown'; candidates: LineMallCandidate[] }>;
  byUrl: LineMallCandidate[];
}
export async function fetchLineCandidates(line: string, channel: LineStepsChannel, signal?: AbortSignal): Promise<LineCandidatesResult | null> {
  try {
    const res = await fetch('/api/mall-products/line-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ line: String(line || '').slice(0, 2000), channel }),
      signal,
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    const cand = (c: any): LineMallCandidate | null => (c && typeof c.no === 'string' && /^\d+$/.test(c.no) && typeof c.provider === 'string'
      ? { provider: c.provider, no: c.no, name: String(c.name || ''), price: Number(c.price) || 0, salePrice: Number(c.salePrice) || 0, imageUrl: c.imageUrl ? String(c.imageUrl) : null, exact: c.exact === true }
      : null);
    const byTerm: LineCandidatesResult['byTerm'] = {};
    for (const t of Array.isArray(d.by_term) ? d.by_term : []) {
      if (typeof t?.term !== 'string') continue;
      byTerm[t.term] = { status: t.status === 'ok' || t.status === 'none' ? t.status : 'unknown', candidates: (Array.isArray(t.candidates) ? t.candidates : []).map(cand).filter(Boolean).slice(0, 3) as LineMallCandidate[] };
    }
    return { byTerm, byUrl: (Array.isArray(d.by_url) ? d.by_url : []).map(cand).filter(Boolean) as LineMallCandidate[] };
  } catch {
    return null;
  }
}

/** 단계 모달 사진 올리기(DM · 이메일 = DM 창구 5MB · 인앱 = 인앱 창구 2MB). 성공 = 이 회사 경로 주소 · 실패 = 던진다(문장 그대로 보인다) */
export const LINE_UPLOAD_MAX_MB: Record<LineStepsChannel, number> = { dm: 5, email: 5, inapp: 2 };
export async function uploadLineImage(file: File, channel: LineStepsChannel): Promise<string> {
  // 창구 허용 형식 그대로(DM 창구 = GIF 거절)
  if (!(channel === 'inapp' ? /^image\/(png|jpe?g|gif|webp)$/i : /^image\/(png|jpe?g|webp)$/i).test(file.type)) throw new Error(channel === 'inapp' ? 'JPG · PNG · GIF · WEBP 사진만 올릴 수 있어요' : 'JPG · PNG · WEBP 사진만 올릴 수 있어요');
  if (file.size > LINE_UPLOAD_MAX_MB[channel] * 1024 * 1024) throw new Error(`사진은 ${LINE_UPLOAD_MAX_MB[channel]}MB까지 올릴 수 있어요`);
  const fd = new FormData();
  fd.append(channel === 'inapp' ? 'image' : 'images', file);
  const res = await fetch(channel === 'inapp' ? '/api/cdp/inapp/upload-image' : '/api/dm/upload-image', {
    method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: fd,
  });
  const d = await res.json().catch(() => ({}));
  const url = channel === 'inapp' ? d?.url : d?.images?.[0]?.url;
  if (!res.ok || d?.success === false || typeof url !== 'string' || !url) throw new Error(d?.error || '사진을 올리지 못했어요. 잠시 뒤 다시 올려 주세요');
  return url;
}

/** 답 보존(sessionStorage · 같은 한 줄로 다시 열면 이어서 · 성공 때만 지움) */
export function lineStepsStoreKey(companyId: string, userId: string, channel: LineStepsChannel, lineFp: string): string {
  return `oneline-steps:v1:${companyId}:${userId}:${channel}:${lineFp}`;
}
export function loadLineStepsAnswers(key: string): { answers: LineStepsAnswers; at: string } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.answers || typeof d.answers.products !== 'object' || !Array.isArray(d.answers.offersAdded)) return null;
    return { answers: d.answers as LineStepsAnswers, at: typeof d.at === 'string' ? d.at : '' };
  } catch {
    return null;
  }
}
export function saveLineStepsAnswers(key: string, answers: LineStepsAnswers, at: string): void {
  try { sessionStorage.setItem(key, JSON.stringify({ answers, at })); } catch { /* 보존만 못 한다 */ }
}
export function clearLineStepsAnswers(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* 없음 */ }
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

// ─────────────── 한 줄 묻기 답 (★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-ask-design.md §3-2) ───────────────

export type LineAskAction =
  | { kind: 'journey'; objective: string; preferTriggerEvent: string }
  | { kind: 'auto'; brief: any }
  | { kind: 'inapp'; objective: string }
  | { kind: 'fill'; line: string }
  | { kind: 'open'; path: string };

export interface LineAskCard {
  key: string;
  title: string;
  count: number | null;
  countNote?: string;
  why: string;
  notices?: string[];
  action: LineAskAction;
}

export interface LineAskAnswer {
  head: string;
  basis: { scope: 'mine' | 'company'; at: string; note?: string };
  cards: LineAskCard[];
  blocked: Array<{ title: string; reason: string }>;
  failed: string[];
}

/** 메뉴 → 답 경로(그 메뉴의 권한 문을 그대로 지난다) */
export const LINE_ASK_PATHS: Record<LineAskMenu, string> = {
  journeys: '/api/ai/operator/journeys-ask',
  'auto-marketing': '/api/ai/operator/continuous-ask',
  inapp: '/api/cdp/inapp/ask',
  dm: '/api/dm/one-line/ask',
  email: '/api/email/one-line/ask',
  sns: '/api/sns/one-line/ask',
};

/** 답 읽기(AI 0 · 0크레딧). 실패하면 던진다 — 호출부는 「읽지 못했어요」를 보이고 자동으로 만들지 않는다. */
export async function fetchLineAnswer(menu: LineAskMenu, line: string): Promise<LineAskAnswer> {
  const res = await fetch(LINE_ASK_PATHS[menu], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    body: JSON.stringify({ line: String(line || '').slice(0, 2000) }),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok || !d?.success || !d.answer) throw new Error(d?.error || '답을 읽지 못했어요.');
  const a = d.answer;
  return {
    head: String(a.head || ''),
    basis: { scope: a.basis?.scope === 'mine' ? 'mine' : 'company', at: String(a.basis?.at || ''), ...(a.basis?.note ? { note: String(a.basis.note) } : {}) },
    cards: Array.isArray(a.cards) ? a.cards.slice(0, 3) : [],
    blocked: Array.isArray(a.blocked) ? a.blocked : [],
    failed: Array.isArray(a.failed) ? a.failed.map(String) : [],
  };
}
