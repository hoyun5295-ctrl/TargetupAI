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
