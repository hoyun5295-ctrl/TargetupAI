/**
 * one-line-facts.ts — 한줄로 시그니처: 한 줄 판정 · 스위치 · 원문 조립 · 멱등키 CT (순수 · ★ 2026-10-05)
 *
 * 설계서 = docs/2026-10-05-hanjul-signature-design.md §3 · §4
 * "한 줄이면 보낼 수 있는 완성본이 나옵니다. 저희가 지어낼 수 없는 사실만 한 번 여쭙니다."
 *
 * ⛔ 불변
 *   - **AI 0 · DB 0.** 묻기는 무과금이다(묻는 판정에 돈이 들면 시그니처가 아니라 요금이 된다).
 *   - **판정은 입력(사용자가 친 한 줄)으로 한다.** 생성물의 자리표시 · 반영 검산으로 결측을 찾으면
 *     원문이 부실할수록 아무것도 못 찾는다(원스텝 설계서 §0-3 함정 · 문자 생성기는 혜택이 없으면 시즌감으로 채운다).
 *   - **원문 자리에는 사용자가 친 글자만.** 한 줄 + 사용자가 칸에 적은 답만 라벨 줄로 붙인다(원스텝 §0-6).
 *   - 1차 판정 항목 = **혜택 하나.** 마감은 묻지 않는다(상대 날짜를 못 읽어 다시 입력을 요구하게 된다).
 */
import { createHash } from 'crypto';
import { companyListAllows } from './sns-constants';
import { validateAnswer } from './content-interview';
import { normalizeWooMallId } from './woocommerce-core';

// ─────────────── 스위치 (비면 꺼짐 · `*` = 전 회사) ───────────────

/** 한 줄 보강(판정 칸 · 원문 자리 · 완성도 줄 · 생성 멱등) 전부를 여는 회사 명단. */
export function oneLineFactsEnabled(
  companyId: string | null | undefined,
  env: string | undefined = process.env.ONE_LINE_FACTS_COMPANY_IDS,
): boolean {
  return companyListAllows(companyId, String(env || ''));
}

/** 허브 문자 3안의 C안 반반 시험을 여는 회사 명단(설계서 §6). */
export function copyCTestEnabled(
  companyId: string | null | undefined,
  env: string | undefined = process.env.COPY_C_TEST_COMPANY_IDS,
): boolean {
  return companyListAllows(companyId, String(env || ''));
}

export type CopyCVariant = 'mz' | 'punchy';

/** 시험 회사면 제안마다 반반(현행 MZ · 짧고 강한형), 아니면 undefined(= 현행 그대로). */
export function pickCopyCVariant(companyId: string | null | undefined, rnd: () => number = Math.random): CopyCVariant | undefined {
  if (!copyCTestEnabled(companyId)) return undefined;
  return rnd() < 0.5 ? 'mz' : 'punchy';
}

// ─────────────── 판정 ───────────────

/** 행사 의도 낱말. 이 낱말이 있는데 구체 값이 없으면 혜택을 묻는다. */
const INTENT_RE = /세일|할인|특가|프로모션|이벤트|쿠폰|적립|기획전|블프|블랙\s*프라이데이|감사제|얼리버드|시즌\s*오프|(?<![A-Za-z])off(?![A-Za-z])/i;
/** 상시 안내는 행사가 아니다(「아울렛 상시 할인 매장 안내」). */
const STANDING_RE = /상시/;

/** 비율 — 숫자 + % · 퍼센트 · 프로(프로모션 · 프로젝트 · 프로그램 제외) */
const PCT_RE = /(?<![\d.,])\d+(?:[.,]\d+)*\s*(?:%|퍼센트|프로(?!모션|젝트|그램|필))/g;
/**
 * 비율이 혜택 값으로 읽히는 문맥(★ Codex 1R medium) — 소재 함량(「면 100%」) · 성분 농도(「비타민C 20%」)는 혜택이 아니다.
 *   뒤 = 혜택 낱말이 **바로** 붙는다(「30% 세일」 · 「10%OFF」 · 「20% 쿠폰」). 앞 = 혜택 문맥(「첫 구매 10%」 · 「최대 50%」 · 「전 상품 20%」).
 */
const PCT_BENEFIT_AFTER_RE = /^[\s·,]{0,2}(?:할인|세일|off|dc|적립|페이백|캐시백|쿠폰|혜택|특가|sale)/i;
const PCT_BENEFIT_BEFORE_RE = /(?:최대|구매|가입|주문|결제|전\s*상품|전\s*품목|추가|즉시|할인|쿠폰|적립|포인트|세일|특가)[^\n]{0,4}$/;
/** 숫자 금액(1만5천원 · 5,000원 · 1.5만원) */
const NUM_WON_RE = /(?<![\d.,제])\d+(?:[.,]\d+)*\s*(?:만\s*(?:\d+\s*천)?\s*원|천\s*원|원)(?!칙)/g;
/** 한글 금액(천원 · 만원 · 오천원 · 삼만원) */
const KOR_WON_RE = /(?<![가-힣])(?:[일이삼사오육칠팔구십백]+\s*)?(?:천|만)\s*원/g;
/** 금액이 혜택 값으로 읽히는 이웃 낱말(뒤 10자 · 앞 6자 안) */
const MONEY_BENEFIT_AFTER_RE = /^[\s·,]{0,2}[^\n]{0,8}?(?:할인|쿠폰|적립|페이백|캐시백|off|dc|증정|상품권|혜택|포인트|즉시)/i;
const MONEY_BENEFIT_BEFORE_RE = /(?:할인|쿠폰|적립|포인트|상품권|페이백|캐시백)[^\n]{0,6}$/;
/** 문턱 금액(「5만원 이상 구매 시」) — 혜택 값이 아니다. 금액 바로 뒤 4자 안 */
const MONEY_THRESHOLD_RE = /^\s{0,2}(?:이상|부터|구매\s*시|주문\s*시|결제\s*시)/;
/** N+N 증정 */
const NPLUSN_RE = /(?<!\d)\d\s*\+\s*\d(?!\d)/;
/** N배 · 더블 · 두 배 — 적립 · 포인트 같은 혜택 낱말이 앞뒤 8자 안에 있을 때만 값이다(「더블 코트」는 상품명 · ★ Codex 1R medium) */
const MULTIPLY_RE = /\d+\s*배(?!송)|더블|두\s*배/g;
const MULTIPLY_CONTEXT_RE = /적립|포인트|마일리지|쿠폰|혜택|캐시백|페이백|증정/;
/** 그 자체로 구체 혜택인 낱말(값이 없어도 무엇을 주는지 이미 말했다) */
const CONCRETE_WORD_RE = /증정|사은품|무료\s*배송|반값|무료(?!\s*수\s*신\s*거\s*부|\s*거부|[하한함해])/;

function pctIsBenefit(line: string, start: number, end: number): boolean {
  if (PCT_BENEFIT_AFTER_RE.test(line.slice(end, end + 8))) return true;
  return PCT_BENEFIT_BEFORE_RE.test(line.slice(Math.max(0, start - 8), start));
}

function multiplyIsBenefit(line: string, start: number, end: number): boolean {
  return MULTIPLY_CONTEXT_RE.test(line.slice(Math.max(0, start - 8), end + 8));
}

/** 정규식이 잡은 자리마다 문맥 판정 — 하나라도 혜택이면 참 */
function anyInContext(line: string, re: RegExp, ok: (line: string, start: number, end: number) => boolean): boolean {
  re.lastIndex = 0;
  for (const m of line.matchAll(re)) {
    const s = m.index ?? 0;
    if (ok(line, s, s + m[0].length)) return true;
  }
  return false;
}

function moneyIsBenefit(line: string, start: number, end: number): boolean {
  const after = line.slice(end, end + 12);
  if (MONEY_THRESHOLD_RE.test(after)) return false;
  if (MONEY_BENEFIT_AFTER_RE.test(after)) return true;
  return MONEY_BENEFIT_BEFORE_RE.test(line.slice(Math.max(0, start - 8), start));
}

/** 한 줄에 구체 혜택 값이 하나라도 있는가(문턱 금액 · 가격은 값이 아니다). */
export function hasConcreteBenefit(line: string): boolean {
  const t = String(line || '');
  if (NPLUSN_RE.test(t) || CONCRETE_WORD_RE.test(t)) return true;
  return anyInContext(t, PCT_RE, pctIsBenefit)
    || anyInContext(t, MULTIPLY_RE, multiplyIsBenefit)
    || anyInContext(t, NUM_WON_RE, moneyIsBenefit)
    || anyInContext(t, KOR_WON_RE, moneyIsBenefit);
}

/** 한 줄이 행사(혜택이 있을 법한 알림)를 말하는가. */
export function hasPromotionIntent(line: string): boolean {
  const t = String(line || '');
  return INTENT_RE.test(t) && !STANDING_RE.test(t);
}

export interface OneLineGaps {
  /** 행사인데 혜택 값이 없다 → 혜택을 묻는다 */
  benefit: boolean;
}

/** (순수) 한 줄 → 물을 항목. 행사 의도가 없는 한 줄(입고 소식 · 매장 안내)은 묻지 않는다. */
export function oneLineGaps(line: string): OneLineGaps {
  const t = String(line || '').trim();
  if (!t) return { benefit: false };
  return { benefit: hasPromotionIntent(t) && !hasConcreteBenefit(t) };
}

// ─────────────── 한 줄 속 상품 · 값 (★ 2026-10-10 한 줄 DM 강화 · 설계서 docs/2026-10-10-oneline-dm-email-design.md §3-1) ───────────────

/** 숫자로 시작하는 낱말(3종 · 20% · 2만원 · 1+1 · 50ml)은 상품 이름이 아니다 */
const TERM_NUMERIC_RE = /^\d/;
/** 행사 · 혜택 낱말이 들어 있으면 검색어가 아니다(「할인가」 · 「세일중」 · 「특가로」) */
const TERM_INTENT_RE = /세일|할인|특가|프로모션|이벤트|쿠폰|적립|기획전|블프|블랙\s*프라이데이|프라이데이|감사제|얼리버드|시즌\s*오프|증정|사은품|무료|반값|혜택|페이백|캐시백|^(?:off|sale|dc)$/i;
/** 그 자체로 상품이 아닌 낱말(기간 · 대상 · 범위 · 채널 · 요청 말투) */
const TERM_STOP = new Set([
  '오늘', '내일', '모레', '이번', '다음', '지난', '금주', '주말', '주중', '평일', '주간', '한정', '마감', '까지', '부터', '동안', '기간', '단', '하루', '당일', '오늘만', '단하루',
  '오픈', '신상', '신제품', '신상품', '출시', '입고', '재입고', '런칭', '론칭', '봄', '여름', '가을', '겨울', '시즌', '연말', '연초', '설날', '추석', '크리스마스', '블랙',
  '전', '전체', '모든', '상품', '제품', '품목', '라인', '라인업', '세트', '구성', '고객', '회원', '님', '대상', '분들', '여러분', 'vip', '신규', '첫', '구매', '주문', '결제', '배송',
  '진행', '안내', '알림', '소식', '행사', '공지', 'dm', '디엠', '문자', '메일', '이메일', '메시지', '카톡', '알림톡', '발송', '보내', '보내줘', '보내기', '만들어', '만들어줘', '만들기',
  '작성', '써줘', '해줘', '부탁', '같이', '함께', '그리고', '또', '및', '최대', '최소', '추가', '즉시', '단독', '특별', '감사', '매장', '오프라인', '온라인', '스토어', '쇼핑몰', '몰',
  '홈페이지', '사이트', '앱', '링크', '우리', '저희', '브랜드', '인기', '베스트', '추천', '대박', '역대급', '파격', '초특가', '한정판',
]);
/** 요청 말투로 끝나는 낱말(「진행해줘」 · 「보내주세요」) */
const TERM_VERB_END_RE = /(?:해줘|해주세요|해 주세요|주세요|줘요|줘|하기|합니다|해요|드려요|드립니다|합시다|하자|할게요|됩니다)$/;
/** 낱말 끝 조사 — 떼고 본다(남는 글자가 2자 이상일 때만 · 「사과」 「오이」를 지키려고) */
const TERM_PARTICLE_RE = /(?:이랑|랑|하고|와|과|및|까지|부터|에서|으로|로|을|를|이|가|은|는|의|도|만|에)$/;
/** 이 조사가 붙으면 다음 낱말은 다른 상품이다(「선크림이랑 토너」) */
const TERM_BREAK_PARTICLE_RE = /(?:이랑|랑|하고|와|과|및)$/;
/** 검색어 상한(후보 검색 · 확인 창 칸 수가 함께 묶인다) */
export const LINE_PRODUCT_TERMS_MAX = 3;

/**
 * (순수) 한 줄 → 몰 후보 검색어(최대 3개). 혜택 · 의도 · 기간 · 대상 낱말과 숫자 · 주소를 걷은 나머지 명사구.
 * ⛔ 판정 · 확정이 아니라 **찾기 입력**이다 — 확정은 사람이 후보를 눌러서만 된다(이름 매칭 자동 첨부 금지 · 불변 4).
 */
export function lineProductTerms(line: string): string[] {
  const text = String(line || '').replace(/https?:\/\/\S+/gi, ' , ');
  const out: string[] = [];
  const push = (words: string[]) => {
    const term = words.join(' ').trim();
    if (term.replace(/\s+/g, '').length < 2 || term.length > 30) return;
    if (!out.includes(term)) out.push(term);
  };
  for (const segment of text.split(/[,·/|+&()[\]!?~\n]+/)) {
    let cur: string[] = [];
    for (const raw of segment.split(/\s+/).filter(Boolean)) {
      let token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!token) continue;
      const breaks = TERM_BREAK_PARTICLE_RE.test(token) && token.replace(TERM_BREAK_PARTICLE_RE, '').length >= 2;
      // 조사를 떼기 전 · 뗀 뒤 둘 다 본다(「블랙프라이데이」의 끝 「이」를 조사로 떼면 의도 낱말이 안 걸린다)
      const isStop = (w: string) => TERM_NUMERIC_RE.test(w) || TERM_INTENT_RE.test(w) || TERM_STOP.has(w.toLowerCase()) || TERM_VERB_END_RE.test(w);
      const stripped = token.replace(TERM_PARTICLE_RE, '');
      const stop = isStop(token) || (stripped.length >= 2 && isStop(stripped));
      if (stripped.length >= 2) token = stripped;
      if (stop) { push(cur); cur = []; continue; }
      cur.push(token);
      if (breaks) { push(cur); cur = []; }
    }
    push(cur);
  }
  return out.slice(0, LINE_PRODUCT_TERMS_MAX);
}

/** (순수) 혜택 문맥의 비율 값(「20% 할인」 → 20). 소재 함량 · 성분 농도는 빼고 같은 값은 한 번만. */
export function lineBenefitPercents(line: string): number[] {
  const t = String(line || '');
  const out: number[] = [];
  PCT_RE.lastIndex = 0;
  for (const m of t.matchAll(PCT_RE)) {
    const s = m.index ?? 0;
    if (!pctIsBenefit(t, s, s + m[0].length)) continue;
    const v = Math.round(parseFloat(m[0].replace(/,/g, '.')));
    if (Number.isFinite(v) && v > 0 && v < 100 && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 숫자 금액 → 원(「39,000원」 39000 · 「1만5천원」 15000 · 「1.5만원」 15000 · 「3천원」 3000). 못 읽으면 null. */
function wonValueOf(raw: string): number | null {
  const m = /^(\d+(?:[.,]\d+)*)\s*(?:(만)\s*(?:(\d+)\s*천)?\s*원|(천)\s*원|원)$/.exec(raw.trim());
  if (!m) return null;
  if (m[2]) return Math.round(parseFloat(m[1].replace(/,/g, '.')) * 10000 + (m[3] ? Number(m[3]) * 1000 : 0));
  if (m[4]) return Math.round(parseFloat(m[1].replace(/,/g, '.')) * 1000);
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** (순수) 한 줄에 적은 **가격**(혜택 금액 · 문턱 금액은 빼고). 몰 가격과 다를 때 안내 한 줄의 근거. */
export function lineMoneyAmounts(line: string): number[] {
  const t = String(line || '');
  const out: number[] = [];
  NUM_WON_RE.lastIndex = 0;
  for (const m of t.matchAll(NUM_WON_RE)) {
    const s = m.index ?? 0;
    if (moneyIsBenefit(t, s, s + m[0].length) || MONEY_THRESHOLD_RE.test(t.slice(s + m[0].length, s + m[0].length + 12))) continue;
    const v = wonValueOf(m[0]);
    if (v && v > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 확정 상품 1개(사람이 후보를 눌러 고른 것) — 서버는 이름 · 가격을 받지 않는다(재조회로만 값을 정한다). */
export interface LineProductRef {
  provider: 'cafe24' | `woocommerce:${string}`;
  /** 몰 상품번호(카페24 product_no · 우커머스 id · 숫자) */
  no: string;
}
/** 한 요청에 고를 수 있는 상품 상한(AI 자동제작 상품 상한과 같은 12) */
export const LINE_PRODUCTS_MAX = 12;

/** 재조회가 되는 몰만(네이버는 상품번호로 다시 읽는 길이 없다 · 설계서 §3-3) */
function isLineMallProvider(p: string): p is LineProductRef['provider'] {
  if (p === 'cafe24') return true;
  if (!p.startsWith('woocommerce:')) return false;
  const host = p.slice('woocommerce:'.length);
  return !!host && normalizeWooMallId(host) === host;
}

/**
 * (순수) 요청 본문의 `products` 검증. 없으면 undefined(= 후보를 보여 주지 않은 요청) · 빈 배열 = 후보를 보여 줬는데 고르지 않음 ·
 * 형식이 틀리면 'invalid'(조용히 버리지 않는다). 같은 상품은 한 번만.
 */
export function sanitizeLineProducts(raw: unknown): LineProductRef[] | undefined | 'invalid' {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > LINE_PRODUCTS_MAX) return 'invalid';
  const out: LineProductRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'invalid';
    const provider = String((item as Record<string, unknown>).provider ?? '').trim();
    const no = String((item as Record<string, unknown>).no ?? '').trim();
    if (!isLineMallProvider(provider) || !/^\d{1,20}$/.test(no)) return 'invalid';
    const key = `${provider}:${no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider, no });
  }
  return out;
}

// ─────────────── 사진에서 읽은 글(★ 2026-10-10 Harold 결정 H3 · 설계서 §3-6) ───────────────

/** 한 요청에 실을 수 있는 「사진에서 읽은 글」 조각 상한 · 조각 길이 상한 */
export const LINE_READS_MAX = 5;
const LINE_READ_MAX_CHARS = 2000;

/**
 * (순수) 요청 본문의 `read_texts` 검증 — 화면이 「이미지로 불러오기」로 한 줄 칸에 붙인 글 조각(그대로의 글자).
 * 없으면 undefined · 형식이 틀리면 'invalid'. 빈 조각은 버린다.
 */
export function sanitizeLineReads(raw: unknown): string[] | undefined | 'invalid' {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > LINE_READS_MAX) return 'invalid';
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string' || r.length > LINE_READ_MAX_CHARS) return 'invalid';
    const t = r.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * 혜택 판정기(`hasConcreteBenefit`)가 구체 값으로 세는 표현 **전부**(★ Codex 3R high · 지우기와 판정이 같은 규칙 한 벌을 쓴다).
 * 판정기는 이 정규식들로만 값을 찾는다(문맥 판정은 그 위에 얹힌 거름) → 이 목록의 자리를 모두 지우면 판정기가 값을 찾을 수 없다(계약 테스트).
 */
const CONCRETE_VALUE_RES: readonly RegExp[] = [
  new RegExp(NPLUSN_RE.source, 'g'),
  new RegExp(CONCRETE_WORD_RE.source, 'g'),
  MULTIPLY_RE,
  PCT_RE,
  NUM_WON_RE,
  KOR_WON_RE,
];

/**
 * (순수) 사진에서 읽은 글에서 혜택 판정기가 구체 값으로 세는 표현(비율 · 금액 · N+N · N배 · 더블 · 증정 · 무료배송 · 반값 …)을 지운다
 * — 판독 오독(30%→80%)이 근거가 되지 않게. 그 밖의 낱말(상품명 · 기간 · 「할인」 같은 의도 낱말)은 남긴다(재료 · 혜택 묻기 판정).
 * 지운 뒤 붙어서 새로 생기는 자리까지 **더 바뀌지 않을 때까지** 반복한다(★ Codex 4R · 지울 때마다 글이 줄어 입력 길이만큼이면 반드시 멈춘다).
 */
export function maskReadNumbers(read: string): string {
  let out = String(read || '');
  for (let pass = 0; pass <= out.length; pass++) {
    const before = out;
    for (const re of CONCRETE_VALUE_RES) { re.lastIndex = 0; out = out.replace(re, ''); }
    if (out === before) break;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** 한 줄 칸에 사진 글이 붙는 구분자(화면 appendToOneLine 과 같은 글자) */
const LINE_READ_SEPARATOR = ' · ';

/**
 * (순수) 한 줄 → 생성 · 판정에 쓸 글. 사진에서 읽은 조각이 한 줄 안에 **칸에 붙은 모양 그대로**(줄 처음 또는 「 · 」 뒤에서 시작해 줄 끝 또는 「 · 」 앞에서 끝남)
 * 남아 있으면 그 구간의 혜택 값을 지운다(면허 아님 · H3). 담당자가 「사진에서 읽은 숫자도 그대로 쓰기」를 켰거나 조각을 고쳐 더는 그 모양이 아니면 손대지 않는다.
 * ★ Codex 3R medium — 위치는 바꾸기 전 원문에서 모두 정하고, 겹치는 구간은 합쳐 한 번에 바꾼다(조각 순서에 따라 숫자가 남거나 「15%」 안의 「5%」를 지우는 일 0).
 */
export function applyLineReads(line: string, reads: readonly string[] | undefined, licensed: boolean): string {
  // ★ Codex 4R — 앞뒤 공백은 떼고 본다(판정 · 생성 호출부가 같은 글로 판단 · 끝 공백 하나로 경계가 어긋나지 않게)
  const src = String(line || '').trim();
  if (licensed || !reads || reads.length === 0) return src;
  const sep = LINE_READ_SEPARATOR;
  const spans: Array<[number, number]> = [];
  for (const r of reads) {
    if (!r) continue;
    for (let i = src.indexOf(r); i >= 0; i = src.indexOf(r, i + 1)) {
      const end = i + r.length;
      const startsAtBoundary = i === 0 || src.slice(i - sep.length, i) === sep;
      const endsAtBoundary = end === src.length || src.slice(end, end + sep.length) === sep;
      if (startsAtBoundary && endsAtBoundary) spans.push([i, end]);
    }
  }
  if (spans.length === 0) return src;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let out = '';
  let at = 0;
  for (const [a, b] of merged) {
    out += src.slice(at, a) + maskReadNumbers(src.slice(a, b));
    at = b;
  }
  return out + src.slice(at);
}

/** (순수) 멱등 지문 조각 — 고른 상품(순서 무관). 상품을 바꿔 보내면 새 차감이 된다. */
export function lineProductsKey(products: readonly LineProductRef[]): string[] {
  return products.map((p) => `${p.provider}:${p.no}`).sort();
}

// ─────────────── 사용자 답 · 원문 조립 ───────────────

export interface LineFacts {
  /** 사용자가 칸에 적은 혜택 원문 · null = [없음](다시 묻지 않는다) */
  benefit: string | null;
}

/**
 * (순수) 요청 본문의 `facts` 검증. 없으면 undefined(= 묻지 않은 요청) · 형식이 틀리면 'invalid'.
 * 혜택 규칙은 원스텝 인터뷰와 같은 함수(`validateAnswer('benefit')` · 300자 · 빈 글 금지 · null = 없음).
 */
export function sanitizeLineFacts(raw: unknown): LineFacts | undefined | 'invalid' {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const b = (raw as Record<string, unknown>).benefit;
  if (b === undefined) return 'invalid';
  if (!validateAnswer('benefit', b).ok) return 'invalid';
  return { benefit: b === null ? null : String(b).trim() };
}

/**
 * (순수) 한 줄 + 사용자 답 → 생성기 원문(사용자가 직접 입력한 사실).
 * 라벨은 원스텝 원문 직렬화(`buildInterviewEventText`)와 같은 `[혜택]` — 브리프 필드와 1:1이라 반영 검산이 잡는다.
 * ⛔ 몰 상품 · 브랜드 정보 · 메모리는 넣지 않는다(파라미터로만 간다).
 */
export function buildLineEventText(line: string, facts?: LineFacts): string {
  const parts = [String(line || '').trim()].filter(Boolean);
  const benefit = facts?.benefit ? facts.benefit.trim() : '';
  if (benefit) parts.push(`[혜택] ${benefit}`);
  return parts.join('\n');
}

// ─────────────── 생성 멱등 (DM · 이메일 한 줄 생성) ───────────────

/** 시도 토큰 — 화면이 [만들기]를 누를 때마다 새로 만든다. 영숫자 · 하이픈 8~64자. */
export function isValidAttemptToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(t);
}

/**
 * 원장 멱등키 = 시도 토큰 + 입력 지문 16자(만들기 `quick:` 키와 같은 원리).
 * 토큰만 키로 쓰면 결제한 토큰으로 내용을 바꿔 보내는 요청이 중복(무료)으로 통과한다 → 생성 입력 전체의 지문을 결박한다.
 * 길이 = 최대 132자(ai_credit_transactions.idempotency_key varchar(150) 안).
 */
export function buildOneLineIdempotencyKey(companyId: string, channel: 'dm' | 'email', attemptToken: string, payload: unknown): string {
  const h = createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 16);
  return `oneline:${companyId}:${channel}:${attemptToken}:${h}`;
}

/** 같은 시도 토큰의 동시 요청 잠금 키(다른 담당자 · 다른 시도는 막지 않는다). */
export function oneLineInflightKey(companyId: string, channel: 'dm' | 'email', attemptToken: string): string {
  return `oneline:${companyId}:${channel}:${attemptToken}`;
}
