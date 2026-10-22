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
  /** ★ 2026-10-17 템플릿 캠페인 — 이 회사에 열려 있는가 · 한 줄 추천(걸린 낱말 = 이유) · 템플릿마다 재료 단계(서버 판정) */
  templatesEnabled: boolean;
  templates: LineTemplateRank[] | null;
  templatePlans: Record<string, LineStepsPlan> | null;
  /** ★ 2026-10-22 한줄 CT 구성 5종 — 구성 정보 · 규칙 추천 · 구성마다 재료 판(AI 0) · 판단(AI · 2)은 `requestLineJudge` */
  compositions: LineCompositionOffer | null;
}

// ─────────────── 한 줄 단계 모달 (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3 · §4) ───────────────

export type LineStepsChannel = 'dm' | 'email' | 'inapp';
export type LineStepKey = 'benefit' | 'product' | 'hero_photo' | 'link' | 'period' | 'event_page' | 'products' | 'proof' | 'points' | 'usage' | 'mood' | 'coupon_code' | 'store';
/** ★ 2026-10-22 구성 칸 단계(막는 칸 · 권하는 칸 · 빠지는 칸) · 채우는 방법 */
export type LineSlotLevel = 'block' | 'suggest' | 'drop';
export type LineSlotFill = 'mall' | 'upload' | 'paste' | 'url' | 'studio' | 'text' | 'date' | 'draft';
type LineSkipIf = 'product_photo' | 'manual_photo' | 'product_link' | 'page_banner';
/** 서버 단계 하나(키 닫힌 목록 · 문구는 화면이 소유 · skip_if 는 서버가 정한 조건 이름) */
export interface LineStep {
  key: LineStepKey;
  item?: string;
  manual_ok?: boolean;
  price?: number;
  url?: string;
  skip_if?: LineSkipIf;
  /** ★ 템플릿 단계 — 필수(건너뛰기 없음) · products = 낱말 탭 · 담을 개수 · suggest = 한 줄에서 찾은 값의 제안 칩(기본값 아님 · 눌러야 채워짐) */
  required?: boolean;
  suggest?: string;
  terms?: Array<{ item: string; price?: number; url?: string }>;
  min?: number;
  max?: number;
  level?: LineSlotLevel;
  ask?: string;
  why?: string;
  fill?: LineSlotFill[];
}
/** generate = 다시 만들기 값 · total = 이번에 낼 값 · judged = 판단 2 를 이미 냈는가 */
export interface LineStepsCost { generate: number; complete: number; total: number; judged?: boolean }
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

const STEP_KEYS: readonly string[] = ['benefit', 'product', 'hero_photo', 'link', 'period', 'event_page', 'products', 'proof', 'points', 'usage', 'mood', 'coupon_code', 'store'];
const SLOT_FILLS: readonly string[] = ['mall', 'upload', 'paste', 'url', 'studio', 'text', 'date', 'draft'];
/** 서버 plan 을 그대로 믿지 않고 모양만 걸러 받는다(모르는 키 = 버린다 · 화면은 닫힌 목록만 그린다) */
function parseLinePlan(raw: any): LineStepsPlan | null {
  if (!raw || raw.v !== 1 || !['dm', 'email', 'inapp'].includes(raw.channel) || typeof raw.line_fp !== 'string') return null;
  const step = (s: any): LineStep | null => (s && STEP_KEYS.includes(s.key) ? {
    key: s.key,
    ...(typeof s.item === 'string' ? { item: s.item } : {}),
    ...(s.manual_ok === true ? { manual_ok: true } : {}),
    ...(Number.isFinite(s.price) ? { price: Number(s.price) } : {}),
    ...(typeof s.url === 'string' ? { url: s.url } : {}),
    ...(['product_photo', 'manual_photo', 'product_link', 'page_banner'].includes(s.skip_if) ? { skip_if: s.skip_if } : {}),
    ...(s.required === true ? { required: true } : {}),
    ...(typeof s.suggest === 'string' && s.suggest.trim() ? { suggest: s.suggest.slice(0, 300) } : {}),
    ...(Array.isArray(s.terms) ? { terms: s.terms.filter((t: any) => typeof t?.item === 'string').slice(0, 3).map((t: any) => ({ item: t.item, ...(Number.isFinite(t.price) ? { price: Number(t.price) } : {}), ...(typeof t.url === 'string' ? { url: t.url } : {}) })) } : {}),
    ...(Number.isInteger(s.min) && s.min >= 0 ? { min: s.min } : {}),
    ...(Number.isInteger(s.max) && s.max > 0 ? { max: Math.min(12, s.max) } : {}),
    ...(['block', 'suggest', 'drop'].includes(s.level) ? { level: s.level } : {}),
    ...(typeof s.ask === 'string' ? { ask: s.ask.slice(0, 80) } : {}),
    ...(typeof s.why === 'string' ? { why: s.why.slice(0, 80) } : {}),
    ...(Array.isArray(s.fill) ? { fill: s.fill.filter((f: unknown) => typeof f === 'string' && SLOT_FILLS.includes(f)) } : {}),
  } : null);
  const cost = parseLineCost(raw.cost);
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

/** 금액 셋 모양 거르기(판정 · 판단 응답 공용) */
function parseLineCost(c: any): LineStepsCost | null {
  return c && [c.generate, c.complete, c.total].every(Number.isFinite)
    ? { generate: Number(c.generate), complete: Number(c.complete), total: Number(c.total), ...(c.judged === true ? { judged: true } : {}) } : null;
}

// ─────────────── 한줄 CT 구성 5종 (★ 2026-10-22 · 설계서 docs/2026-10-22-oneline-ct-design.md §11) ───────────────

export type LineCompositionId = 'spotlight' | 'showcase' | 'lookbook' | 'menu' | 'event';
export const LINE_COMPOSITION_IDS: readonly LineCompositionId[] = ['spotlight', 'showcase', 'lookbook', 'menu', 'event'];
export const isLineCompositionId = (v: unknown): v is LineCompositionId => typeof v === 'string' && (LINE_COMPOSITION_IDS as readonly string[]).includes(v);
export interface LineCompositionInfo { id: LineCompositionId; label: string; desc: string; primary: string }
export interface LineCompositionOffer {
  infos: LineCompositionInfo[];
  ranks: Array<{ id: LineCompositionId; recommended: boolean }>;
  plans: Partial<Record<LineCompositionId, LineStepsPlan>>;
}
function parseLineCompositionOffer(d: any): LineCompositionOffer | null {
  const c = d?.compositions;
  if (!c || typeof c !== 'object') return null;
  const infos = (Array.isArray(c.infos) ? c.infos : []).filter((x: any) => isLineCompositionId(x?.id))
    .map((x: any) => ({ id: x.id, label: String(x.label || ''), desc: String(x.desc || ''), primary: /^#[0-9a-f]{6}$/i.test(String(x.primary)) ? String(x.primary) : '#4338ca' }));
  const ranks = (Array.isArray(c.ranks) ? c.ranks : []).filter((x: any) => isLineCompositionId(x?.id)).map((x: any) => ({ id: x.id, recommended: x.recommended === true }));
  const plans: LineCompositionOffer['plans'] = {};
  for (const id of LINE_COMPOSITION_IDS) { const p = parseLinePlan(c.plans?.[id]); if (p) plans[id] = p; }
  return infos.length > 0 && Object.keys(plans).length > 0 ? { infos, ranks, plans } : null;
}

/** 판단 초안 한 칸 */
export interface LineRichPointAnswer { title: string; body: string; image: string | null }
export interface LineJudgeResponse {
  pick: LineCompositionId;
  reason: string;
  source: 'ai' | 'rule';
  drafts: Partial<Record<LineCompositionId, { points?: LineRichPointAnswer[]; steps?: LineRichPointAnswer[] }>>;
  charged: boolean;
  note: 'NO_CREDIT' | 'DAILY_LIMIT' | 'AI_FAILED' | null;
  cost: LineStepsCost | null;
}

/**
 * 판단(AI 1회 · 2크레딧 · 한 줄당 오늘 · 어제 한 번 · 실패 = 규칙 판단 0원). 같은 한 줄을 지금 판단 중이면(409) 한 번 더 기다렸다 묻는다.
 * 실패 = null(화면은 규칙 추천으로 그대로 간다).
 */
export async function requestLineJudge(line: string, menu: LineStepsChannel, reads: readonly string[], productNames: string[]): Promise<LineJudgeResponse | null> {
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    try {
      const res = await fetch('/api/ai/one-line/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ line: String(line || '').slice(0, 2000), menu, ...(reads.length > 0 ? { read_texts: reads.slice(0, 5) } : {}), product_names: productNames.slice(0, 8) }),
      });
      const d = await res.json().catch(() => null);
      if (res.status === 409) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok || !d?.success || !isLineCompositionId(d.pick)) return null;
      const pts = (v: any): LineRichPointAnswer[] => (Array.isArray(v) ? v : []).filter((p: any) => typeof p?.title === 'string' && p.title.trim()).slice(0, 3)
        .map((p: any) => ({ title: String(p.title).slice(0, 20), body: String(p.body || '').slice(0, 80), image: null }));
      const drafts: LineJudgeResponse['drafts'] = {};
      for (const id of LINE_COMPOSITION_IDS) {
        const x = d.drafts?.[id];
        if (x) drafts[id] = { points: pts(x.points), steps: pts(x.steps) };
      }
      return {
        pick: d.pick, reason: String(d.reason || '').slice(0, 60), source: d.source === 'ai' ? 'ai' : 'rule', drafts,
        charged: d.charged === true, note: ['NO_CREDIT', 'DAILY_LIMIT', 'AI_FAILED'].includes(d.note) ? d.note : null, cost: parseLineCost(d.cost),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** 재료 판 미리보기(AI 0 · 0원 · 같은 조립 · 렌더러 · 빈 칸 = 점선 자리) — 실패 = null */
export async function fetchCompositionPreview(composition: LineCompositionId, channel: LineStepsChannel, materials: Record<string, unknown>, signal?: AbortSignal): Promise<{ html?: string; message?: Record<string, any>; missing: number } | null> {
  try {
    const res = await fetch('/api/line-templates/composition-preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      body: JSON.stringify({ composition, channel, materials }), signal,
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    return { ...(typeof d.html === 'string' ? { html: d.html } : {}), ...(d.message && typeof d.message === 'object' ? { message: d.message } : {}), missing: Number(d.missing) || 0 };
  } catch {
    return null;
  }
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
      ...parseLineTemplateOffer(d),
      compositions: d.templates_enabled === true ? parseLineCompositionOffer(d) : null,
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
export async function fetchLineMallCandidates(terms: readonly string[], signal?: AbortSignal, perTermMax: number = LINE_MALL_PER_TERM): Promise<{ mallReady: boolean; candidates: LineMallCandidate[] }> {
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
        if (perTerm >= perTermMax || out.length >= LINE_MALL_CANDIDATES_MAX) break;
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(`/api/mall-products/search?provider=${encodeURIComponent(provider)}&limit=${perTermMax}&q=${encodeURIComponent(term)}`, { headers: auth, signal: ctrl.signal });
        // eslint-disable-next-line no-await-in-loop
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.success === false || !Array.isArray(d?.products)) continue;
        for (const p of d.products) {
          const no = typeof p?.no === 'string' && /^\d+$/.test(p.no) ? p.no : '';
          const key = `${provider}:${no}`;
          if (!no || seen.has(key) || perTerm >= perTermMax || out.length >= LINE_MALL_CANDIDATES_MAX) continue;
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
export interface LineManualAnswer { name: string; price: string; image: string | null; url?: string; /** ★1022 구성 종류(진열 묶음 · 선택) */ category?: string }
/** ★ 2026-10-21 고객 후기 한 건 */
export interface LineProofAnswer { body: string; author: string; rating: number }
/** 보낼 후기(본문 2자 이상 · 3건) */
export const lineProofRows = (a: LineStepsAnswers): LineProofAnswer[] => (a.proof || []).map((r) => ({ body: r.body.replace(/\s+/g, ' ').trim().slice(0, 300), author: r.author.trim().slice(0, 20), rating: Math.max(1, Math.min(5, Math.round(r.rating) || 5)) })).filter((r) => r.body.length >= 2).slice(0, 3);
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
  /** ★ 2026-10-21 대표 사진 = 이미지 스튜디오 헤드라인(글자 박힌 포스터 · 표지가 덮지 않는다) */
  heroPoster?: boolean;
  /** ★ 2026-10-21 고객 후기(붙여 넣은 원문 · 별점은 사람이 고른 값) · null = 건너뜀 */
  proof?: LineProofAnswer[] | null;
  link?: string | null;
  /** 'YYYY-MM-DD' */
  period?: string | null;
  /** 만들기 단계에서 [넣기]를 누른 낱말(단계가 하나 생긴다) */
  offersAdded: string[];
  /** 사진에서 읽은 숫자도 그대로 쓰기(H3 · 기본 꺼짐) */
  readLicensed?: boolean;
  /** ★ 템플릿 상품 단계 — 담은 몰 상품(여러 개 · 넣은 순서) · 직접 넣은 상품(여러 개) */
  picks?: LineMallCandidate[];
  manualList?: LineManualAnswer[];
  /** ★ 템플릿 이벤트 페이지 단계 — 읽은 결과(주소 · 표지 사진 · 카드) · 그대로 쓰기 켠 카드 지문 · null = 건너뜀 */
  page?: LinePageAnswer | null;
  /** ★ 고른 템플릿 · 배치(바꿔도 다른 답은 그대로) · ★1022 구성 5종 id 도 이 칸 */
  template?: { id: LineTemplateId | LineCompositionId; layout: LineLayout };
  /** ★ 2026-10-22 구성 재료 — 특징 · 코디 · 꼬리표 · 참여 방법(points) · 사용 단계(usage) · 분위기 사진 · 할인 코드 · 매장 · 혜택 조건 */
  points?: LineRichPointAnswer[];
  usage?: LineRichPointAnswer[];
  mood?: string[];
  couponCode?: string | null;
  store?: { address: string; business_hours: string; phone: string } | null;
  benefitNote?: string | null;
  /** 판단 결과(구성 · 이유 · 초안 · 원천) — 같은 한 줄로 다시 열면 다시 묻지 않는다 */
  judge?: { pick: LineCompositionId; reason: string; source: 'ai' | 'rule'; drafts: LineJudgeResponse['drafts'] } | null;
}
export interface LinePageCard { hash: string; title: string; text: string }
export interface LinePageAnswer {
  url: string; host: string; banner: string | null; cards: LinePageCard[]; licensed: string[];
  /** ★ 2026-10-22 페이지에서 읽은 상품(이름 · 이 회사 사본 사진 · 링크 · 가격은 읽지 않는다) · 사진(이 회사 사본) */
  products?: Array<{ name: string; image: string; url: string }>;
  images?: string[];
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
  // ★ 템플릿 — 이벤트 페이지에서 표지 사진을 읽었으면 대표 사진을 묻지 않는다 · 읽은 페이지 · 담은 상품 링크가 있으면 버튼 주소를 묻지 않는다
  if (step.skip_if === 'page_banner') return !!a.page?.banner;
  return picked || manual.some((m) => !!m.url) || (a.picks || []).length > 0 || (a.manualList || []).some((m) => !!m.url) || !!a.page?.url;
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
    // ★ 2026-10-17 템플릿 캠페인 — 다른 날 남긴 답은 버린다(어제 고른 마감일 · 다 지난 페이지 읽기를 오늘 다시 싣지 않게)
    if (typeof d.at !== 'string' || new Date(d.at).toDateString() !== new Date().toDateString()) return null;
    return { answers: d.answers as LineStepsAnswers, at: d.at };
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

// ─────────────── 템플릿 캠페인 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md) ───────────────

export type LineTemplateId = 'big-sale' | 'new-launch' | 'special-event' | 'season';
export type LineLayout = 'slides' | 'page';
const LINE_TEMPLATE_IDS: readonly string[] = ['big-sale', 'new-launch', 'special-event', 'season'];
/** 한 줄 추천(서버 규칙 · 걸린 낱말 = 이유 · 안 걸리면 recommended 없음) */
export interface LineTemplateRank { id: LineTemplateId; reasons: string[]; recommended: boolean }
/** 템플릿 목록 한 줄(서버 원장 · 화면은 문구만 그린다) */
export interface LineTemplateInfo {
  /** ★1022 구성 5종 목록(set=compositions)이면 구성 id */
  id: LineTemplateId | LineCompositionId;
  label: string;
  desc: string;
  story: Array<{ role: string; text: string }>;
  needs: { benefit: 'required' | 'optional' | 'none'; period: 'required' | 'none'; products: { min: number; max: Record<LineStepsChannel, number> }; hero: 'ask' | 'none' };
  example: { company: string; industry: string; line: string };
  design: { primary: string; accent: string };
}

/** 판정 응답의 템플릿 칸(모양만 걸러 받는다 · 모르는 템플릿 = 버린다) */
function parseLineTemplateOffer(d: any): Pick<OneLineGapsResult, 'templatesEnabled' | 'templates' | 'templatePlans'> {
  const on = d?.templates_enabled === true;
  const templates = on && Array.isArray(d.templates)
    ? d.templates.filter((t: any) => LINE_TEMPLATE_IDS.includes(t?.id)).map((t: any) => ({ id: t.id, reasons: Array.isArray(t.reasons) ? t.reasons.map(String).slice(0, 3) : [], recommended: t.recommended === true }))
    : null;
  let plans: Record<string, LineStepsPlan> | null = null;
  if (on && d.template_plans && typeof d.template_plans === 'object') {
    plans = {};
    for (const id of LINE_TEMPLATE_IDS) { const p = parseLinePlan(d.template_plans[id]); if (p) plans[id] = p; }
  }
  return { templatesEnabled: on, templates: templates && templates.length > 0 ? templates : null, templatePlans: plans && Object.keys(plans).length > 0 ? plans : null };
}

const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

/**
 * 템플릿 목록(로그인 · 묶음 단위 메모리 캐시 · 실패 = null).
 * ★ 2026-10-22 set='compositions' = 한줄 CT 구성 5종(마케팅플래너 · 같은 모양 · 같은 예시 경로).
 */
const templatesCache = new Map<string, LineTemplateInfo[]>();
export async function fetchLineTemplates(set: 'templates' | 'compositions' = 'templates'): Promise<LineTemplateInfo[] | null> {
  const token = localStorage.getItem('token') || '';
  const key = `${token}:${set}`;
  const hit = templatesCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(set === 'compositions' ? '/api/line-templates?set=compositions' : '/api/line-templates', { headers: authHeader() });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success || !Array.isArray(d.templates)) return null;
    const ok = (id: unknown) => (set === 'compositions' ? isLineCompositionId(id) : LINE_TEMPLATE_IDS.includes(String(id)));
    const list = d.templates.filter((t: any) => ok(t?.id)) as LineTemplateInfo[];
    templatesCache.set(key, list);
    return list;
  } catch {
    return null;
  }
}

/** 예시(가상 업체 · 진짜 조립 + 렌더러) — DM · 이메일 = html · 인앱 = 메시지 · 키별 메모리 캐시(같은 화면에서 다시 부르지 않게) */
export type LineTemplateExample = { html: string } | { message: Record<string, any> };
const exampleCache = new Map<string, LineTemplateExample>();
export async function fetchLineTemplateExample(id: LineTemplateId | LineCompositionId, channel: LineStepsChannel, layout: LineLayout, signal?: AbortSignal): Promise<LineTemplateExample | null> {
  const key = `${new Date().toDateString()}:${id}:${channel}:${channel === 'dm' ? layout : 'page'}`;
  const hit = exampleCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/line-templates/${encodeURIComponent(id)}/example?channel=${channel}&layout=${layout}`, { headers: authHeader(), signal });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.success) return null;
    const out: LineTemplateExample | null = typeof d.html === 'string' ? { html: d.html } : d.message && typeof d.message === 'object' ? { message: d.message } : null;
    if (out) exampleCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/** 이벤트 페이지 읽기(AI 0 · 0원 · 같은 주소 10분 캐시는 서버) — 실패 = 서버 문장 그대로 던진다 */
export async function readLinePage(rawUrl: string): Promise<LinePageAnswer> {
  const url = normalizeLineLink(rawUrl);
  if (!url) throw new Error('http로 시작하는 주소를 넣어 주세요');
  const res = await fetch('/api/event-campaigns/materials/read-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ url }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d?.success === false) throw new Error(d?.error || '페이지를 읽지 못했어요');
  const cards: LinePageCard[] = (Array.isArray(d.cards) ? d.cards : [])
    .filter((c: any) => typeof c?.hash === 'string' && /^[0-9a-f]{16}$/.test(c.hash))
    .slice(0, 3)
    .map((c: any) => ({ hash: c.hash, title: String(c.title || ''), text: String(c.text || '') }));
  const products = (Array.isArray(d.products) ? d.products : [])
    .filter((p: any) => typeof p?.name === 'string' && p.name.trim() && typeof p?.imageUrl === 'string' && p.imageUrl.startsWith('/'))
    .slice(0, 8).map((p: any) => ({ name: String(p.name).slice(0, 60), image: String(p.imageUrl), url: typeof p.url === 'string' ? String(p.url) : '' }));
  const banner = typeof d.line_banner === 'string' && d.line_banner ? d.line_banner : null;
  // ★ 2026-10-22 상품 사진(서버 표시 product)은 분위기 사진에서 뺀다(같은 사진이 상품 칸 · 사진 묶음에 두 번)
  const images = (Array.isArray(d.images) ? d.images : []).filter((im: any) => im?.product !== true).map((im: any) => String(im?.url || '')).filter((u: string) => u.startsWith('/') && u !== banner).slice(0, 6);
  return { url, host: String(d.host || ''), banner, cards, licensed: [], products, images };
}

/** 몰 상품 찾기(상품 단계 「찾기」 칸 · 재조회 가능한 몰만 · 최대 6 · 5초) */
export async function searchLineMall(q: string, signal?: AbortSignal): Promise<{ mallReady: boolean; candidates: LineMallCandidate[] }> {
  const term = String(q || '').trim().slice(0, 40);
  if (!term) return { mallReady: true, candidates: [] };
  return fetchLineMallCandidates([term], signal, LINE_MALL_CANDIDATES_MAX);
}

/** 템플릿 DM 표식(서버 `lineTemplateDmMarker` = 'line:<템플릿>') — 편집 화면이 카탈로그 보기 · 장 추가를 숨기고 배치 전환을 장 키로 다시 묶는다 */
export const isLineTemplateDm = (templateId: string | null | undefined): boolean => typeof templateId === 'string' && templateId.startsWith('line:');

/**
 * (순수) 템플릿 DM 장 다시 묶기 — 섹션 `tpl_slot`('p{장}.{부분}')의 장 번호로 묶는다(서버 호출 0 · 0원).
 * 키 없는 섹션(편집에서 더한 블록)은 바로 앞 섹션의 장에 붙는다 · 키가 하나도 없으면 null(호출부 = 범용 나누기).
 */
export function regroupLineTemplatePages<T extends { tpl_slot?: string }>(sections: readonly T[]): T[][] | null {
  const pageOf = (s: T): number | null => { const m = /^p(\d+)\./.exec(String(s.tpl_slot || '')); return m ? Number(m[1]) : null; };
  if (!sections.some((s) => pageOf(s) !== null)) return null;
  const groups = new Map<number, T[]>();
  let last = sections.map(pageOf).find((n) => n !== null) ?? 0;
  for (const s of sections) {
    const n = pageOf(s);
    if (n !== null) last = n;
    const g = groups.get(last) ?? [];
    g.push(s);
    groups.set(last, g);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

/** (순수) 구성 상품 = 사진 있는 몰 상품 먼저 · 사진 있는 직접 상품 · 합쳐 상한(재료 판 판정 · 요청 본문이 같은 목록 · 서버 조립도 사진 없는 상품은 뺀다) */
export function lineCompositionGoods(a: LineStepsAnswers, max: number): { picks: LineMallCandidate[]; manual: LineManualAnswer[] } {
  const picks = (a.picks || []).filter((p) => p.imageUrl).slice(0, max);
  const manual = (a.manualList || []).filter((m) => m.name.trim() && m.image).slice(0, Math.max(0, max - picks.length));
  return { picks, manual };
}

/** 보낼 구성 칸 글(제목이 있는 것만 · 3개 · 상한) */
export const lineRichRows = (rows: LineRichPointAnswer[] | undefined): Array<{ title: string; body: string; image?: string }> => (rows || [])
  .map((r) => ({ title: r.title.replace(/\s+/g, ' ').trim().slice(0, 20), body: r.body.replace(/\s+/g, ' ').trim().slice(0, 80), ...(r.image ? { image: r.image } : {}) }))
  .filter((r) => r.title).slice(0, 3);
/** 보낼 매장 칸(비면 null) */
export const lineStoreOf = (a: LineStepsAnswers): { address?: string; business_hours?: string; phone?: string } | null => {
  const s = a.store;
  if (!s) return null;
  const out = { ...(s.address.trim() ? { address: s.address.trim().slice(0, 80) } : {}), ...(s.business_hours.trim() ? { business_hours: s.business_hours.trim().slice(0, 80) } : {}), ...(s.phone.trim() ? { phone: s.phone.trim().slice(0, 80) } : {}) };
  return Object.keys(out).length > 0 ? out : null;
};
/** 할인 코드 모양(서버와 같은 규칙 · 영숫자 · 하이픈 · 밑줄 2~24) */
export const LINE_COUPON_CODE_RE = /^[A-Za-z0-9_-]{2,24}$/;

/** 템플릿 상품 단계 — 지금 담은 상품 수(몰 + 직접) */
export const lineTemplateCount = (a: LineStepsAnswers): number => (a.picks || []).length + (a.manualList || []).filter((m) => m.name.trim()).length;

/**
 * 템플릿 생성 요청 몸통(세 채널 공통) — 1017 몸통 칸 그대로 + template · page.
 * 상품 = 담은 몰 상품(상품번호만) · 직접 넣은 상품(이름 · 가격 · 사진 · 링크) · 합쳐 템플릿 상한까지.
 */
export function buildLineTemplateBody(plan: LineStepsPlan, a: LineStepsAnswers, shown: readonly LineStep[], expectedCost: number, tpl: { id: LineTemplateId | LineCompositionId; layout: LineLayout }): Record<string, unknown> {
  const has = (key: LineStepKey) => shown.some((s) => s.key === key);
  const max = plan.steps.find((s) => s.key === 'products')?.max ?? 0;
  const facts: Record<string, unknown> = {};
  if (plan.steps.some((s) => s.key === 'benefit')) facts.benefit = typeof a.benefit === 'string' && a.benefit.trim() ? a.benefit.trim() : null;
  if (has('period') && a.period) facts.period_end = a.period;
  if (a.link) facts.link = a.link;
  const comp = isLineCompositionId(tpl.id);
  // ★ 2026-10-22 구성 = 조립되는 상품만(사진 있는 직접 상품 · 몰 상품) 먼저 걸러 상한 · 재료 판 판정과 같은 목록(lineCompositionGoods · Codex CT R2)
  const goods = comp ? lineCompositionGoods(a, max) : null;
  const picks = goods ? goods.picks : (a.picks || []).slice(0, max);
  const manual = (goods ? goods.manual : (a.manualList || []).filter((m) => m.name.trim()).slice(0, Math.max(0, max - picks.length))).map((m) => {
    const price = lineManualPrice(m.price);
    return { name: m.name.trim().slice(0, 60), ...(price ? { price } : {}), ...(m.image ? { image: m.image } : {}), ...(m.url ? { url: m.url } : {}), ...(comp && m.category?.trim() ? { category: m.category.trim().slice(0, 20) } : {}) };
  });
  const answered: string[] = [];
  const skipped: string[] = [];
  for (const s of shown) {
    const v = s.key === 'benefit' ? (typeof a.benefit === 'string' && a.benefit.trim() ? 1 : 0)
      : s.key === 'products' ? (picks.length + manual.length > 0 ? 1 : 0)
        : s.key === 'event_page' ? (a.page ? 1 : 0)
          : s.key === 'hero_photo' ? (a.hero ? 1 : 0)
            : s.key === 'link' ? (a.link ? 1 : 0)
              : s.key === 'proof' ? (lineProofRows(a).length > 0 ? 1 : 0)
                : s.key === 'points' ? (lineRichRows(a.points).length > 0 ? 1 : 0)
                  : s.key === 'usage' ? (lineRichRows(a.usage).length > 0 ? 1 : 0)
                    : s.key === 'mood' ? ((a.mood || []).length > 0 ? 1 : 0)
                      : s.key === 'coupon_code' ? (a.couponCode ? 1 : 0)
                        : s.key === 'store' ? (lineStoreOf(a) ? 1 : 0)
                          : (a.period ? 1 : 0);
    (v ? answered : skipped).push(s.key);
  }
  const proof = has('proof') ? lineProofRows(a) : [];
  // ★ 2026-10-22 구성 재료 칸(보인 칸만 · 빈 값은 보내지 않는다)
  const rich = comp ? {
    ...(has('points') ? { points: lineRichRows(a.points) } : {}),
    ...(has('usage') ? { usage: lineRichRows(a.usage) } : {}),
    ...(has('mood') ? { mood: (a.mood || []).filter(Boolean).slice(0, 3) } : {}),
    ...(has('coupon_code') && a.couponCode ? { coupon_code: a.couponCode } : {}),
    ...(has('store') && lineStoreOf(a) ? { store: lineStoreOf(a) } : {}),
    ...(has('benefit') && a.benefitNote?.trim() ? { benefit_note: a.benefitNote.trim().slice(0, 120) } : {}),
  } : null;
  return {
    steps: { v: 1 },
    template: { id: tpl.id, layout: tpl.layout },
    ...(rich ? { rich } : {}),
    ...(proof.length > 0 ? { proof } : {}),
    facts,
    products: picks.map((p) => ({ provider: p.provider, no: p.no })),
    manual_products: manual,
    ...(has('hero_photo') && a.hero ? { hero_image: a.hero, ...(a.heroPoster ? { hero_poster: true } : {}) } : {}),
    ...(has('event_page') && a.page ? { page: { url: a.page.url, licensed_hashes: a.page.licensed.filter((h) => a.page!.cards.some((c) => c.hash === h)).slice(0, 3) } } : {}),
    expected_cost: expectedCost,
    steps_meta: { shown: shown.map((s) => s.key), answered, skipped },
  };
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
