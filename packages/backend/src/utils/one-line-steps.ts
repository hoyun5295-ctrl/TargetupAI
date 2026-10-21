/**
 * one-line-steps.ts — 한 줄 → 단계별 모달(질문 · 재료) 판정 CT (순수 · ★ 2026-10-17)
 *
 * 설계서 = docs/2026-10-17-oneline-steps-modal-design.md §3 · §4
 * "한 줄을 치면 그 한 줄 · 그 회사 · 그 채널에 없는 사실과 재료만 한 단계에 하나씩 묻는다."
 *
 * ⛔ 불변
 *   - **AI 0 · DB 0.** 회사 사실(재조회 몰 · 인앱 표시 · 홈페이지 · 업로드 가능 · 금액)은 라우트가 넣는다.
 *   - 단계 키는 닫힌 목록 하나(`LINE_STEP_KEYS`) · 문구는 화면 원장이 소유한다(여기는 키 + 낱말만).
 *   - 판정 규칙은 `one-line-facts.ts` 함수를 그대로 쓴다(혜택 · 검색어 · 금액 · 의도). 같은 규칙 두 벌 금지.
 *   - 원문 자리에는 사용자가 친 글자 · 칸에 적은 답만(원스텝 §0-6). 몰 값은 넣지 않는다.
 */
import { createHash } from 'crypto';
import { validateAnswer } from './content-interview';
import { oneLineGaps, hasPromotionIntent, lineProductTerms, lineMoneyAmounts, lineWithoutReads, lineSegments } from './one-line-facts';
import { getLineTemplate, type LineTemplateId, type LineLayout } from './design-core/line-templates';

export type LineStepsChannel = 'dm' | 'email' | 'inapp';
export const LINE_STEPS_CHANNELS: readonly LineStepsChannel[] = ['dm', 'email', 'inapp'];

/** 단계 키 닫힌 목록(화면 부품표와 짝 테스트로 묶인다) · event_page · products = 템플릿 캠페인 단계(★ 2026-10-17 · line-template-plan.ts) */
// ★ 2026-10-21 proof = 고객 후기(④ 신뢰 · 어느 연동에도 없어 묻는다 · 설계서 docs/2026-10-21-oneline-content-design.md §3-2)
export const LINE_STEP_KEYS = ['benefit', 'product', 'hero_photo', 'link', 'period', 'event_page', 'products', 'proof'] as const;
export type LineStepKey = (typeof LINE_STEP_KEYS)[number];

/** 질문 단계 상한(만들기 단계 제외 · Harold 결정 · 설계서 §3-3) */
export const LINE_STEPS_MAX = 4;

// ─────────────── 스위치 ───────────────

// ★ 2026-10-21 단계 모달 회사 명단 스위치 삭제 — 전 회사 같은 흐름(설계서 docs/2026-10-21-oneline-content-design.md §3-1)

export function isLineStepsChannel(v: unknown): v is LineStepsChannel {
  return v === 'dm' || v === 'email' || v === 'inapp';
}

// ─────────────── 한 줄 읽기 ───────────────

/**
 * 기간을 말한 낱말 — **「있음」 쪽으로 넓게** 잡는다(설계서 §3-7 · 회의론자 판정).
 * 틀려도 「묻지 않는」 쪽으로 틀리면 오늘과 같다(다시 입력 0). 하나라도 걸리면 기간을 묻지 않는다.
 */
const PERIOD_WORD_RE = new RegExp([
  '\\d{4}\\s*년', '\\d{1,2}\\s*월', '\\d{1,2}\\s*일', '\\d{1,2}\\s*[./-]\\s*\\d{1,2}', '[월화수목금토일]\\s*요일', '\\(\\s*[월화수목금토일]\\s*\\)',
  '까지', '부터', '주말', '주중', '평일', '오늘', '내일', '모레', '이번\\s*주', '다음\\s*주', '금주', '이번\\s*달', '다음\\s*달',
  '월말', '월초', '연말', '연초', '마감', '선착순', '소진', '한정', '기간', '당일', '하루', '단\\s*하루', '[dD]\\s*-\\s*\\d', '디데이',
  '명절', '추석', '설날', '설\\s*연휴', '연휴', '크리스마스', '블프', '블랙\\s*프라이데이', '~\\s*\\d', '\\d\\s*시', '지금\\s*바로', '시즌\\s*오프',
].join('|'));

/** (순수) 한 줄이 기간을 말했는가(넓게) */
export function linePeriodMentioned(line: string): boolean {
  return PERIOD_WORD_RE.test(String(line || ''));
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** (순수) 한 줄 속 주소(앞에서부터 · 끝 문장부호 제거) */
export function lineUrls(line: string): string[] {
  const out: string[] = [];
  for (const m of String(line || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[).,·!?~]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * (순수) 한 줄에 적은 **마감 날짜** → 'YYYY-MM-DD'(KST · 단계 미리 채움 · 사람이 확인해야 결과에 실린다).
 *   **허용 꼴만**(Codex 2R~5R) — 연도가 있는 날짜(「2026.10.31」 · 「2026년 10월 31일」) 또는 「10월 31일」이 한 줄에 **딱 하나**이고,
 *   그 바로 뒤에 「까지」(사이에 「(토)」 같은 요일만 허용)가 붙어 **끝이라고 적힌 날짜**일 때만 채운다.
 *   「부터」 · 「~」가 붙은 시작일 · 끝을 생략한 기간 · 숫자만 있는 날짜 꼴(「10.31」 · 금액 「1.5만원」과 갈리지 않음)이 남은 줄 = 비운다.
 *   행사 끝이 아닌 기한(배송 · 도착 · 발송 · 출고 · 예약 · 접수)을 말하는 줄 · 연도를 말로 적은 줄(내년 · 「27년」) = 비운다(5R).
 *   제안 칩일 뿐 기본값이 아니다 — 사람이 눌러야 답이 된다.
 *   연도가 없으면 올해 · 이미 지난 날은 연말(10~12월)에 적은 1~3월만 내년(그 밖 = null) · 달력에 없거나 범위 밖 = null.
 */
export function lineEndDatePrefill(line: string, nowMs: number): string | null {
  const t = String(line || '');
  if (/배송|도착|발송|출고|예약|접수|수령/.test(t) || /내년|올해|작년|내후년|(?<!\d)\d{2}\s*년/.test(t)) return null;
  const today = kstDayOf(nowMs);
  const year = Number(today.slice(0, 4));
  const found: Array<{ at: number; end: number; y: number | null; m: number; d: number }> = [];
  const taken: Array<[number, number]> = [];
  for (const m of t.matchAll(/(?<!\d)(\d{4})\s*(?:[.\-/]|년)\s*(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})(?!\d)/g)) {
    const at = m.index ?? 0;
    taken.push([at, at + m[0].length]);
    found.push({ at, end: at + m[0].length, y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const at = m.index ?? 0;
    if (taken.some(([s, e]) => at < e && at + m[0].length > s)) continue;   // 연도 있는 날짜의 일부 = 이미 읽었다(연도 보존)
    found.push({ at, end: at + m[0].length, y: null, m: Number(m[1]), d: Number(m[2]) });
  }
  if (found.length !== 1) return null;
  // 읽은 날짜를 지운 나머지에 숫자 날짜 꼴이 남아 있으면(기간의 다른 끝 · 금액 소수) 모호 = 비운다
  let rest = t;
  for (const [s, e] of taken) rest = rest.slice(0, s) + ' '.repeat(e - s) + rest.slice(e);   // 길이를 지키며 먼저 지운다(위치가 원문 기준)
  rest = rest.replace(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, ' ');
  if (/\d{1,2}\s*[./]\s*\d{1,2}/.test(rest)) return null;
  const last = found[0];
  // 월 · 일만 읽었는데 연도 표기(「2027년도」 · 「2027」)가 남아 있으면 연도를 놓친 것 = 제안 없음(6R)
  if (last.y === null && /(?:19|20)\d{2}\s*(?:년|[./-])|년도/.test(rest)) return null;
  // 끝이라고 적힌 날짜만(바로 뒤 「일」 · 요일 괄호 · 「까지」) — 「부터」 · 「~」 · 아무 표지 없음 = 비운다
  if (!/^\s*일?\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?까지/.test(t.slice(last.end))) return null;
  const fmt = (y: number) => `${y}-${String(last.m).padStart(2, '0')}-${String(last.d).padStart(2, '0')}`;
  let ymd = fmt(last.y ?? year);
  const nowMonth = Number(today.slice(4, 6));
  if (last.y === null && ymd.replace(/-/g, '') < kstDayOf(nowMs - 86_400_000) && nowMonth >= 10 && last.m <= 3) ymd = fmt(year + 1);
  return isValidLinePeriodEnd(ymd, nowMs) ? ymd : null;
}

/**
 * (순수) 상품 낱말 하나에 붙은 가격 · 주소(그 낱말이 든 구획에서 · 낱말이 하나뿐이면 한 줄 전체에서 하나일 때만).
 * 가격 = 혜택 · 문턱 금액이 아닌 금액(`lineMoneyAmounts`) · 주소 = 구획 속 첫 주소.
 */
export function lineTermFacts(line: string, term: string, termCount: number): { price?: number; url?: string } {
  const seg = lineSegments(line).find((s) => s.includes(term));
  const out: { price?: number; url?: string } = {};
  if (seg) {
    const p = lineMoneyAmounts(seg);
    if (p.length > 0) out.price = p[0];
    const u = lineUrls(seg);
    if (u.length > 0) out.url = u[0];
  }
  if (termCount === 1) {
    if (out.price === undefined) { const all = lineMoneyAmounts(line); if (all.length === 1) out.price = all[0]; }
    if (out.url === undefined) { const all = lineUrls(line); if (all.length === 1) out.url = all[0]; }
  }
  return out;
}

/** (순수) 한 줄 지문 12자(같은 한 줄 = 같은 지문 · 공백 정리 후) */
export function lineFingerprint(line: string): string {
  const norm = String(line || '').trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

/**
 * (순수) 한 줄 완성 원장 지문 — **사용자가 친 부분**(사진 조각 제외)으로 정한다. 판정(/gaps)과 생성 라우트가 이 함수 하나를 쓴다
 * (두 곳이 다르게 계산하면 화면이 본 금액과 청구가 갈린다). 친 글이 없으면(사진 조각뿐) 한 줄 전체.
 */
export function lineStepsFp(line: string, reads: readonly string[] | undefined): string {
  const typed = lineWithoutReads(line, reads);
  return lineFingerprint(typed || String(line || ''));
}

// ─────────────── 단계 목록 ───────────────

/** page_banner = 이벤트 페이지에서 표지로 쓸 사진을 읽었으면 건너뜀(템플릿 대표 사진 단계) */
export type LineStepSkipIf = 'product_photo' | 'manual_photo' | 'product_link' | 'page_banner';

export interface LineStep {
  key: LineStepKey;
  /** 상품 단계 = 한 줄 낱말 */
  item?: string;
  /** 상품 단계 = 몰에서 못 찾아도 직접 넣기로 물을 수 있는가(한 줄에 그 상품의 가격 · 주소가 있음) */
  manual_ok?: boolean;
  /** 직접 넣기 칸에 미리 채울 한 줄 값(사용자가 친 글자) · event_page = 한 줄에 친 주소(열자마자 읽는다) */
  price?: number;
  url?: string;
  /** 화면이 해석하는 조건 하나(서버가 정한 규칙 · 화면은 사본을 두지 않는다) */
  skip_if?: LineStepSkipIf;
  /** 템플릿 단계 — 필수(건너뛰기 없음 · 미루지 않음) */
  required?: boolean;
  /**
   * 템플릿 단계 — 한 줄에서 찾은 값(혜택 문구 · 마감 날짜)의 **제안 칩**. 칸에 기본값으로 넣지 않는다 — 사람이 칩을 눌러야 채워지고
   * 필수 단계는 고르기 전까지 다음으로 못 간다(Codex 1017 템플릿 5R · 추출값이 기본값으로 확정되던 구조를 뺐다).
   */
  suggest?: string;
  /** products 단계 — 한 줄 낱말 탭 · 담을 개수(채널 상한) · 낱말에 붙은 가격 · 주소(직접 넣기 미리 채움) */
  terms?: Array<{ item: string; price?: number; url?: string }>;
  min?: number;
  max?: number;
}

export interface LineStepsPlanInput {
  /** 판정용 한 줄(사진 조각 숫자를 지운 글 · `applyLineReads`) */
  judged: string;
  /** 원래 한 줄(검색어 · 금액 · 주소 · 기간 낱말) */
  line: string;
  /** 사용자가 친 부분만(사진 조각 제외 · 기간 · 주소 판정) */
  typed: string;
  channel: LineStepsChannel;
  /** 재조회 몰 1개 이상 */
  mall: boolean;
  /** 인앱 웹 표시 불가(생성 관문과 같은 판정) */
  inappBlocked: boolean;
  /** 이 채널에서 사진을 올릴 수 있는가 */
  upload: boolean;
  website: string | null;
  mallHome: string | null;
  cost: { generate: number; complete: number; total: number } | null;
  /** 원장 지문(`lineStepsFp`) */
  lineFp: string;
}

export interface LineStepsPlan {
  v: 1;
  channel: LineStepsChannel;
  line_fp: string;
  mall: boolean;
  block: null | 'INAPP_DISPLAY_UNAVAILABLE';
  upload: boolean;
  steps: LineStep[];
  /** 상한에 걸려 만든 뒤 편집 화면에서 채울 것 */
  later: Array<{ key: LineStepKey; item?: string }>;
  /** 단계가 되지 못한 상품 낱말(만들기 단계 「넣을까요? [넣기]」 줄) */
  offers: Array<{ item: string; price?: number; url?: string }>;
  filled: { link?: string };
  link_default: null | { kind: 'website' | 'mall_home'; url: string };
  cost: { generate: number; complete: number; total: number } | null;
}

/** 채널별 상품 낱말 상한(인앱 = 1개) */
function termsCap(channel: LineStepsChannel): number {
  return channel === 'inapp' ? 1 : 3;
}

/** 넘칠 때 미루는 순서(먼저 미룬다) — 기간 → 3번째 상품 → 2번째 상품 */
function trimToCap(steps: LineStep[]): { steps: LineStep[]; cut: LineStep[] } {
  const out = [...steps];
  const cut: LineStep[] = [];
  const drop = (pick: (s: LineStep, i: number, all: LineStep[]) => boolean) => {
    if (out.length <= LINE_STEPS_MAX) return;
    const idx = out.findIndex((s, i, all) => pick(s, i, all));
    if (idx >= 0) cut.push(...out.splice(idx, 1));
  };
  drop((s) => s.key === 'period');
  const nthProduct = (n: number) => (s: LineStep, i: number, all: LineStep[]) => s.key === 'product' && all.filter((x, j) => x.key === 'product' && j <= i).length === n;
  drop(nthProduct(3));
  drop(nthProduct(2));
  return { steps: out.slice(0, LINE_STEPS_MAX), cut: [...cut, ...out.slice(LINE_STEPS_MAX)] };
}

/**
 * (순수) 한 줄 + 회사 사실 → 단계 목록. 순서 = 혜택 → 상품(낱말마다) → 대표 사진 → 버튼 주소 → 기간 · 상한 4.
 */
export function buildLineStepsPlan(input: LineStepsPlanInput): LineStepsPlan {
  const base: LineStepsPlan = {
    v: 1, channel: input.channel, line_fp: input.lineFp, mall: input.mall,
    block: null, upload: input.upload, steps: [], later: [], offers: [], filled: {}, link_default: null, cost: input.cost,
  };
  if (input.channel === 'inapp' && input.inappBlocked) return { ...base, block: 'INAPP_DISPLAY_UNAVAILABLE' };

  const steps: LineStep[] = [];
  const later: LineStepsPlan['later'] = [];
  const offers: LineStepsPlan['offers'] = [];

  // ① 혜택 — 행사 의도 + 구체 값 0(시그니처 판정 그대로)
  if (oneLineGaps(input.judged).benefit) steps.push({ key: 'benefit' });

  // ② 상품 — 몰이 있으면 낱말마다 고르기(못 찾으면 화면이 직접 넣기로 · manual_ok 일 때만) · 몰이 없으면 가격 · 주소가 붙은 낱말만 직접 넣기
  const terms = lineProductTerms(input.line).slice(0, termsCap(input.channel));
  for (const term of terms) {
    const tf = lineTermFacts(input.line, term, terms.length);
    const manualOk = tf.price !== undefined || tf.url !== undefined;
    if (input.mall || manualOk) steps.push({ key: 'product', item: term, manual_ok: manualOk, ...tf });
    else offers.push({ item: term, ...tf });
  }

  // ③ 대표 사진 — 올릴 수 있을 때만 · 상품 사진이 생기면 건너뜀(이메일은 직접 올린 상품 사진만 · 몰 사진은 외부 주소라 메일 첫 화면에 쓰지 않는다)
  if (input.upload) steps.push({ key: 'hero_photo', skip_if: input.channel === 'email' ? 'manual_photo' : 'product_photo' });
  else later.push({ key: 'hero_photo' });

  // ④ 버튼 주소 — 한 줄 주소 · 홈페이지 · 몰 첫 화면이 있으면 단계 없이 그 값(만들기 단계에서 바꾸기)
  const typedUrls = lineUrls(input.typed);
  if (typedUrls.length > 0) base.filled.link = typedUrls[0];
  else if (input.website) base.link_default = { kind: 'website', url: input.website };
  else if (input.mallHome) base.link_default = { kind: 'mall_home', url: input.mallHome };
  else steps.push({ key: 'link', skip_if: 'product_link' });

  // ⑤ 기간 — DM · 이메일만 · 행사 의도 + 기간 낱말이 전혀 없을 때만(다시 입력 0)
  if (input.channel !== 'inapp' && hasPromotionIntent(input.judged) && !linePeriodMentioned(input.typed)) steps.push({ key: 'period' });

  const trimmed = trimToCap(steps);
  for (const s of trimmed.cut) later.push(s.item ? { key: s.key, item: s.item } : { key: s.key });
  return { ...base, steps: trimmed.steps, later, offers };
}

// ─────────────── 생성 요청 검증 ───────────────

export interface LineStepsManualProduct { name: string; price?: number; image?: string; url?: string }
export interface LineProofReview { body: string; author: string; rating: number }
export const LINE_PROOF_MAX = 3;
export interface LineStepsBody {
  facts: { benefit?: string | null; periodEnd?: string | null; link?: string | null };
  manual: LineStepsManualProduct[];
  heroImage: string | null;
  /** ★ 2026-10-21 대표 사진이 이미지 스튜디오 헤드라인(글자 박힌 포스터)인가 — 표지가 덮어 쓰지 않는다(asIs · 설계서 docs/2026-10-21-oneline-content-design.md §3-4) */
  heroPoster: boolean;
  /** ★ 2026-10-21 고객 후기(사람이 붙여 넣은 원문 · 별점은 사람이 고른 값 · 비면 후기 구역 없음) */
  proof: LineProofReview[];
  expectedCost: number | null;
  meta: { shown: string[]; answered: string[]; skipped: string[] };
  /** ★ 템플릿 캠페인 — 고른 템플릿 · 배치(없으면 1017 단계 생성 그대로) */
  template: { id: LineTemplateId; layout: LineLayout } | null;
  /** ★ 템플릿 캠페인 — 읽은 이벤트 페이지 주소 + 「이 문구 그대로 쓰기」를 켠 카드 지문(서버가 다시 읽어 대조한다) */
  page: { url: string; licensedHashes: string[] } | null;
}

export const LINE_STEPS_MANUAL_MAX = 3;
/** 템플릿 캠페인 직접 상품 상한(템플릿 DM 상품 상한 8 · 몰 상품과 합쳐 템플릿 상한으로 자른다) */
export const LINE_TEMPLATE_MANUAL_MAX = 8;
const PAGE_HASH_RE = /^[0-9a-f]{16}$/;
const NAME_MAX = 60;
const URL_MAX = 500;
const IMAGE_MAX = 300;
const PRICE_MAX = 100_000_000;

/** (순수) http(s) 주소만 · 길이 상한 · 사용자 정보 · 공백 금지. 아니면 null */
export function sanitizeLineUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > URL_MAX || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return s;
  } catch {
    return null;
  }
}

/** (순수) 'YYYY-MM-DD' 가 달력에 있는 날이고 오늘(KST) 전날 ~ 400일 뒤 안인가 */
export function isValidLinePeriodEnd(raw: unknown, nowMs: number): boolean {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return false;
  const kstToday = Date.parse(`${kstDayOf(nowMs).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}T00:00:00Z`);
  const day = 86_400_000;
  return t >= kstToday - day && t <= kstToday + 400 * day;
}

const strList = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 20).map((x) => String(x).slice(0, 40)) : []);

/**
 * (순수) 생성 요청의 단계 답 검증. `steps` 칸이 없으면 undefined(단계 모달이 아닌 요청 · 지금 그대로) · 형식이 틀리면 'invalid'(조용히 버리지 않는다).
 * 이미지가 「이 회사 경로」인가는 회사 id 가 필요해 `line-materials.ts` 가 따로 본다.
 */
export function sanitizeLineStepsBody(body: Record<string, unknown> | null | undefined, nowMs: number): LineStepsBody | undefined | 'invalid' {
  const b = body || {};
  const steps = b.steps as Record<string, unknown> | undefined;
  if (steps === undefined || steps === null) return undefined;
  if (typeof steps !== 'object' || Array.isArray(steps) || steps.v !== 1) return 'invalid';

  const factsRaw = b.facts ?? {};
  if (typeof factsRaw !== 'object' || Array.isArray(factsRaw) || factsRaw === null) return 'invalid';
  const f = factsRaw as Record<string, unknown>;
  const facts: LineStepsBody['facts'] = {};
  if (f.benefit !== undefined) {
    if (!validateAnswer('benefit', f.benefit).ok) return 'invalid';
    facts.benefit = f.benefit === null ? null : String(f.benefit).trim();
  }
  if (f.period_end !== undefined && f.period_end !== null) {
    if (!isValidLinePeriodEnd(f.period_end, nowMs)) return 'invalid';
    facts.periodEnd = String(f.period_end);
  } else if (f.period_end === null) facts.periodEnd = null;
  if (f.link !== undefined && f.link !== null) {
    const u = sanitizeLineUrl(f.link);
    if (!u) return 'invalid';
    facts.link = u;
  } else if (f.link === null) facts.link = null;

  // ★ 템플릿 캠페인 — 템플릿 · 배치(닫힌 목록) · 이벤트 페이지(주소 + 카드 지문 ≤3)
  let template: LineStepsBody['template'] = null;
  if (b.template !== undefined && b.template !== null) {
    const tr = b.template as Record<string, unknown>;
    if (typeof tr !== 'object' || Array.isArray(tr) || !getLineTemplate(tr.id) || (tr.layout !== 'slides' && tr.layout !== 'page')) return 'invalid';
    template = { id: tr.id as LineTemplateId, layout: tr.layout };
  }
  let page: LineStepsBody['page'] = null;
  if (b.page !== undefined && b.page !== null) {
    if (!template) return 'invalid';
    const pr = b.page as Record<string, unknown>;
    if (typeof pr !== 'object' || Array.isArray(pr)) return 'invalid';
    const url = sanitizeLineUrl(pr.url);
    const hashes = pr.licensed_hashes ?? [];
    if (!url || !Array.isArray(hashes) || hashes.length > 3 || !hashes.every((h) => typeof h === 'string' && PAGE_HASH_RE.test(h))) return 'invalid';
    page = { url, licensedHashes: Array.from(new Set(hashes as string[])) };
  }

  const manualRaw = b.manual_products ?? [];
  if (!Array.isArray(manualRaw) || manualRaw.length > (template ? LINE_TEMPLATE_MANUAL_MAX : LINE_STEPS_MANUAL_MAX)) return 'invalid';
  const manual: LineStepsManualProduct[] = [];
  for (const item of manualRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'invalid';
    const r = item as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || name.length > NAME_MAX) return 'invalid';
    const row: LineStepsManualProduct = { name };
    if (r.price !== undefined && r.price !== null) {
      const p = Number(r.price);
      if (!Number.isInteger(p) || p <= 0 || p > PRICE_MAX) return 'invalid';
      row.price = p;
    }
    if (r.image !== undefined && r.image !== null && r.image !== '') {
      if (typeof r.image !== 'string' || r.image.length > IMAGE_MAX) return 'invalid';
      row.image = r.image.trim();
    }
    if (r.url !== undefined && r.url !== null && r.url !== '') {
      const u = sanitizeLineUrl(r.url);
      if (!u) return 'invalid';
      row.url = u;
    }
    manual.push(row);
  }

  let heroImage: string | null = null;
  if (b.hero_image !== undefined && b.hero_image !== null && b.hero_image !== '') {
    if (typeof b.hero_image !== 'string' || b.hero_image.length > IMAGE_MAX) return 'invalid';
    heroImage = b.hero_image.trim();
  }
  if (b.hero_poster !== undefined && typeof b.hero_poster !== 'boolean') return 'invalid';
  const heroPoster = b.hero_poster === true && !!heroImage;

  // ★ 2026-10-21 고객 후기 — 3건 · 본문 2~300자 · 작성자 20자(비면 「구매 고객」) · 별점 1~5 정수(사람이 고른 값)
  const proof: LineProofReview[] = [];
  if (b.proof !== undefined && b.proof !== null) {
    if (!Array.isArray(b.proof) || b.proof.length > LINE_PROOF_MAX) return 'invalid';
    for (const r of b.proof as unknown[]) {
      const o = r && typeof r === 'object' ? r as Record<string, unknown> : null;
      const body = typeof o?.body === 'string' ? o.body.replace(/\s+/g, ' ').trim() : '';
      if (body.length < 2 || body.length > 300) return 'invalid';
      if (o?.author !== undefined && typeof o.author !== 'string') return 'invalid';
      const author = String(o?.author || '').trim().slice(0, 20) || '구매 고객';
      const rating = Number(o?.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'invalid';
      proof.push({ body, author, rating });
    }
  }

  let expectedCost: number | null = null;
  if (b.expected_cost !== undefined && b.expected_cost !== null) {
    const c = Number(b.expected_cost);
    if (!Number.isInteger(c) || c < 0 || c > 10_000) return 'invalid';
    expectedCost = c;
  }

  const metaRaw = (b.steps_meta && typeof b.steps_meta === 'object' && !Array.isArray(b.steps_meta)) ? b.steps_meta as Record<string, unknown> : {};
  return {
    facts, manual, heroImage, heroPoster, proof, expectedCost,
    meta: { shown: strList(metaRaw.shown), answered: strList(metaRaw.answered), skipped: strList(metaRaw.skipped) },
    template, page,
  };
}

// ─────────────── 원문 조립 ───────────────

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** (순수) 'YYYY-MM-DD' → '2026년 10월 20일(화)' — 요일은 UTC 기준 계산(지역 시각 어긋남 0) */
export function formatLinePeriodEnd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}년 ${m}월 ${d}일(${WEEKDAYS[w]})`;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/**
 * (순수) 한 줄 + 단계 답 → 생성기 원문. 라벨 = 원스텝 직렬화와 같은 `[혜택]` · `[기간]` · `[상품]`(브리프 필드와 1:1).
 * 기간 답은 「한 줄에 날짜를 친 것과 같게」 동작한다(생성기가 원문 기간을 읽는다 · 설계서 §3-7).
 * 카드로 놓이는 상품(사진 + 가격)은 원문에 넣지 않는다(카드는 코드가 놓는다) — 글로만 소개할 상품만 `[상품]` 줄.
 */
export function buildLineStepsEventText(line: string, a: {
  benefit?: string | null;
  periodEnd?: string | null;
  textProducts?: ReadonlyArray<{ name: string; price?: number }>;
}): string {
  const parts = [String(line || '').trim()].filter(Boolean);
  const benefit = typeof a.benefit === 'string' ? a.benefit.trim() : '';
  if (benefit) parts.push(`[혜택] ${benefit}`);
  if (a.periodEnd) parts.push(`[기간] ${formatLinePeriodEnd(a.periodEnd)}까지`);
  const products = (a.textProducts || []).map((p) => (p.price ? `${p.name} ${won(p.price)}` : p.name)).filter(Boolean);
  if (products.length > 0) parts.push(`[상품] ${products.join(', ')}`);
  return parts.join('\n');
}

// ─────────────── 돈 (한 줄 완성 · Harold 2안) ───────────────

/** KST 날짜 'YYYYMMDD' */
export function kstDayOf(nowMs: number): string {
  const d = new Date(nowMs + 9 * 3_600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** 원장 접두 — 「오늘 이 한 줄로 한 줄 완성을 냈는가」를 원장에 묻는 열쇠(회사 · 채널 · 날짜 · 한 줄 지문) */
export function lineStepsKeyPrefix(companyId: string, channel: LineStepsChannel, day: string, lineFp: string): string {
  return `olc:${companyId}:${channel}:${day}:${lineFp}:`;
}

/**
 * 원장 멱등키 = 접두 + (시도 토큰 + 생성 입력 전체)의 지문 24자. 같은 시도 재요청 = 같은 키 · 답 하나만 바꿔도 새 키.
 * 길이 = 4 + 36 + 1 + 5 + 1 + 8 + 1 + 12 + 1 + 24 = 최대 93자(idempotency_key varchar(150) 안).
 */
export function buildLineStepsIdempotencyKey(companyId: string, channel: LineStepsChannel, day: string, lineFp: string, attemptToken: string, payload: unknown): string {
  const h = createHash('sha256').update(JSON.stringify({ t: attemptToken, p: payload ?? null })).digest('hex').slice(0, 24);
  return `${lineStepsKeyPrefix(companyId, channel, day, lineFp)}${h}`;
}

/** 한 줄 완성 원장 원천(credit source) */
export const LINE_COMPLETE_SOURCE = 'oneline-complete';

/**
 * (순수) 이번 생성의 금액 · 원천. 오늘 이 한 줄로 한 줄 완성을 이미 냈으면(다시 만들기) 생성비만 · 그 채널 생성 원천.
 */
export function lineStepsCharge(generate: number, complete: number, completionPaid: boolean, genSource: string): { cost: number; source: string; completionDue: boolean } {
  return completionPaid
    ? { cost: generate, source: genSource, completionDue: false }
    : { cost: generate + complete, source: LINE_COMPLETE_SOURCE, completionDue: true };
}
