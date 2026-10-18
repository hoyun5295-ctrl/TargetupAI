/**
 * planner-line-read.ts — 플래너 한 줄 읽기(★ 2026-10-18 v2 입력 축 · 설계서 docs/2026-10-18-planner-v2-design.md §3-6)
 *
 * 「10월10일~10월15일 기초 1+1 행사 진행할거야 타겟은 기초제품구매했던 모두야」 →
 *   행사명 「기초 1+1 행사」 · 기간 · 혜택 「1+1」 · 행사 상품 낱말 「기초」 · 받는 사람 = 「기초」를 산 고객(+ 「모두」 = 기록 전체 제안).
 *
 * ⛔ AI 0 · DB 0 · 순수. 읽은 값은 **제안**이다(화면이 줄마다 사람 확인을 받는다 · 기본값으로 쓰지 않는다).
 * ⛔ 받는 사람 구획을 먼저 잘라낸다 — 자르지 않으면 대상 말이 상품 낱말 · 행사명으로 샌다.
 * ⛔ 받는 사람은 셋 중 하나로만 읽는다: 전체(조건 없는 전체 요청 문장일 때만) · 상품 구매자(허용된 문형 하나에 구획 전체가 맞을 때만) · 그 밖(사람이 고른다).
 *    「모두」가 들었다는 이유로 전체로 넓히지 않는다 · 부정(「안 산」 · 「구매하지 못한」 · 「빼고」)은 문형이 깨져 늘 사람이 고른다
 *    (★ Codex B 1R · 2R — 부정 낱말 차단 목록은 새 꼴마다 샜다 → 맞는 꼴만 받는 허용 목록으로).
 *    ★ Codex B 4R — 상품 칸은 **낱말 하나**만 읽는다. 여러 낱말 칸(「테이블 외의」 · 「모든 피부 타입용 크림」 · 「크림이랑 토너」)은 제외어 · 수식어가
 *    끼어들 자리를 늘 남겨 낱말 거름으로는 닫히지 않았다(1R~4R) → 사람이 고른다. 실제 대상은 언제나 사람이 고른 상품 키다.
 * ⛔ 기간 = 범위가 딱 하나일 때만 · 숫자만 쓴 날짜(10.10 · 10/10)는 읽지 않는다 · 지난 기간 = 칩 0 + 사유(내년으로 올리지 않는다 ·
 *    연말에 적은 1~3월만 내년 = 마감일 읽기 `lineEndDatePrefill` 와 같은 규칙) · 범위 바로 뒤가 기한 낱말(배송 · 발송 …)이면 읽지 않는다.
 * 재사용 = 혜택 `lineBenefitPrefill` · 상품 낱말 `lineProductTerms` · 전체 요청 `isPlainAllCustomersRequest` · 날짜 검사 `isValidLinePeriodEnd` · `kstDayOf`.
 */
import { lineBenefitPrefill, lineProductTerms } from './one-line-facts';
import { isPlainAllCustomersRequest } from './all-customers-signal';
import { isValidLinePeriodEnd, kstDayOf } from './one-line-steps';

export type PlannerLineAudience =
  | { kind: 'all' }
  | { kind: 'product_buyers'; terms: string[]; allTime: boolean }
  | { kind: 'unread'; raw: string };

export interface PlannerLineRead {
  title: string | null;
  period: { startsOn: string; endsOn: string } | null;
  /** 기간을 못 읽은 까닭(사람에게 보이는 말 · 읽을 기간이 없으면 null) */
  periodNote: string | null;
  benefit: string | null;
  productTerms: string[];
  /** null = 받는 사람 말이 없다(화면이 묻는다) */
  audience: PlannerLineAudience | null;
  channels: Array<'sms' | 'dm' | 'email'>;
  /** 플래너가 아직 못 보내는 채널 말(알림톡 · 인앱 …) */
  unsupported: string[];
}

export const PLANNER_LINE_MAX = 300;

/** 받는 사람 구획 표지(허용 목록) — 「타겟은 · 타겟: · 대상은 · 대상: · 받는 사람은 · 보낼 사람은」 */
const TARGET_MARK_RE = /(?:타겟|타깃|대상|받는\s*사람|보낼\s*사람)\s*(?:은|는|:|：|=)\s*/;
/** 「…에게 · 한테 · 께」 — 바로 앞이 고객을 가리키는 말일 때만(「친구에게 선물」을 대상으로 오해하지 않게) */
const TARGET_TO_RE = /([^,.!?\n]{0,30}?(?:고객|회원|손님|구매자|분)들?님?)\s*(?:에게|한테|께)(?![가-힣])/;
/** 구매 꼴(끝까지) — 「구매한 · 구매했던 · 구입하신 · 주문한 적 있는 · 샀던 · 사신 · 산」 · 「구매자」 */
const BUY_FORM = '(?:(?:구매|구입|주문)(?:했었던|했던|하셨던|하신|한|하는|한\\s*적\\s*있는|했던\\s*적\\s*있는)?|샀던|사신|(?<![가-힣])산)';
/** 고객 말 — 앞의 「모든」은 이 자리에서만 잡는다(상품 설명 속 「모든 피부 타입용」을 기록 전체로 읽지 않게 · ★ Codex B 3R) */
const WHO = '(모든\\s*)?(?:고객|회원|손님|분|사람)(?:님)?(?:들)?';
/** ★ Codex B 5R — 상품 칸과 구매 꼴 사이 경계 = 띄어쓰기 · 「제품 · 상품」 · 「을 · 를」 중 하나(필수). 붙여 쓴 꼴(「크림미구매」)은 「미」가 상품 칸에 흡수돼 뜻이 뒤집힌다 → 사람이 고른다 */
const TERM_EDGE = '(?:\\s+|\\s*(?:제품|상품)\\s*(?:을|를)?\\s*|\\s*(?:을|를)\\s*)';
const BUYER_SHAPE_RE = new RegExp(
  `^(.+?)${TERM_EDGE}(?:${BUY_FORM}\\s*(?:${WHO})?|(?:구매|구입)자(?:님)?(?:들)?)` +
  `\\s*(모두|전부|전체|다)?\\s*(?:이에요|예요|입니다|이야|야|요|에게|한테|께)?$`,
);
/** 상품 칸 낱말이 될 수 없는 말 — 기간 · 수량 · 범위(제외 · 다른 · 말고 …) · 숫자 */
const TERM_REJECT_RE = /\d|최근|이내|이후|이전|동안|부터|까지|이상|이하|미만|초과|번|회|개월|주일|달|년|제외|빼고|말고|아닌|이외|없|않|다른/;
/** 상품 칸 낱말 끝의 이음말(「크림이랑 · 토너와 · 기초를」) · 홀로 선 이음 낱말(「및」 · 「제품」) */
const TERM_TAIL_RE = /(?:이랑|이나|랑|와|과|을|를|의)$/;
const TERM_FILLER = new Set(['및', '제품', '상품', '또는', '혹은']);

/** 받는 사람 구획 → 셋 중 하나 */
function readAudienceSegment(seg: string): PlannerLineAudience {
  const s = seg.trim();
  const unread: PlannerLineAudience = { kind: 'unread', raw: s.slice(0, 60) };
  const m = s.match(BUYER_SHAPE_RE);
  if (m) {
    const words = m[1].split(/[\s,·/]+/)
      .map((w) => w.trim())
      .map((w) => (w.length > 2 && TERM_TAIL_RE.test(w) ? w.replace(TERM_TAIL_RE, '') : w))
      .filter((w) => w && !TERM_FILLER.has(w));
    if (words.length !== 1) return unread;
    if (words.some((w) => w.length < 2 || TERM_REJECT_RE.test(w))) return unread;
    return { kind: 'product_buyers', terms: words, allTime: !!m[2] || !!m[3] };
  }
  if (isPlainAllCustomersRequest(s)) return { kind: 'all' };
  return unread;
}

/**
 * (순수) 구매자 제안을 그 회사의 관측 상품명으로 확정한다(★ Codex B 1R~3R 같은 부류 세 번 = 열린 낱말 칸을 차단 목록으로 거른 것이 뿌리 →
 *   진짜 허용 목록은 고객 데이터다). 상품 칸 낱말(하나)이 관측 상품 이름에 들지 않으면 사람이 고른다.
 * 맞춤 규칙 = 화면 대상 상품 고르기가 위로 올리는 규칙과 같다(이름에 낱말이 든다 · 대소문자 무시).
 * 목록을 못 읽었으면(null) 사람이 고른다(넓히지 않는다).
 */
export function confirmLineAudience(aud: PlannerLineAudience | null, productNames: readonly string[] | null): PlannerLineAudience | null {
  if (!aud || aud.kind !== 'product_buyers') return aud;
  const names = (productNames || []).map((n) => String(n || '').toLowerCase()).filter(Boolean);
  const ok = names.length > 0 && aud.terms.every((t) => names.some((n) => n.includes(t.toLowerCase())));
  return ok ? aud : { kind: 'unread', raw: aud.terms.join(' ').slice(0, 60) };
}

/** 한 줄에서 받는 사람 구획을 떼어 낸다 — { 나머지, 구획(없으면 null), 지울 표지 } */
function cutAudience(t: string): { rest: string; seg: string | null } {
  const mark = t.match(TARGET_MARK_RE);
  if (mark && mark.index !== undefined) {
    const from = mark.index + mark[0].length;
    const tail = t.slice(from);
    const stop = tail.search(/[.!?\n]/);
    const seg = stop >= 0 ? tail.slice(0, stop) : tail;
    return { rest: `${t.slice(0, mark.index)} ${stop >= 0 ? tail.slice(stop) : ''}`, seg };
  }
  const to = t.match(TARGET_TO_RE);
  if (to && to.index !== undefined) return { rest: `${t.slice(0, to.index)} ${t.slice(to.index + to[0].length)}`, seg: to[1] };
  return { rest: t, seg: null };
}

// ── 기간 ─────────────────────────────────────────────────────────────
const KOR_RANGE_RE = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?(?:~|∼|〜|-|부터)\s*(?:(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*)?(\d{1,2})\s*일?\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?(?:까지)?/g;
const NUM_RANGE_RE = /(?<!\d)(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*(?:~|∼|〜|-|부터)\s*(?:(\d{4})\s*[.\-/]\s*)?(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)\s*(?:까지)?/g;
const DEADLINE_WORD_RE = /^\s*(?:배송|도착|발송|출고|예약|접수|수령)/;

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** (순수) 행사 기간 범위 하나 — 못 읽으면 period null + 사유(읽을 꼴이 없으면 사유도 null) · span = 원문에서 지울 자리 */
export function linePeriodRange(text: string, nowMs: number): { period: { startsOn: string; endsOn: string } | null; note: string | null; span: [number, number] | null } {
  const t = String(text || '');
  const hits: Array<{ s: number; e: number; y1: number | null; m1: number; d1: number; y2: number | null; m2: number | null; d2: number }> = [];
  for (const m of t.matchAll(KOR_RANGE_RE)) {
    hits.push({ s: m.index ?? 0, e: (m.index ?? 0) + m[0].length, y1: m[1] ? Number(m[1]) : null, m1: Number(m[2]), d1: Number(m[3]), y2: m[4] ? Number(m[4]) : null, m2: m[5] ? Number(m[5]) : null, d2: Number(m[6]) });
  }
  for (const m of t.matchAll(NUM_RANGE_RE)) {
    const s = m.index ?? 0;
    if (hits.some((h) => s < h.e && s + m[0].length > h.s)) continue;
    hits.push({ s, e: s + m[0].length, y1: Number(m[1]), m1: Number(m[2]), d1: Number(m[3]), y2: m[4] ? Number(m[4]) : Number(m[1]), m2: Number(m[5]), d2: Number(m[6]) });
  }
  if (hits.length === 0) return { period: null, note: null, span: null };
  if (hits.length > 1) return { period: null, note: '기간이 여러 개라 읽지 않았어요. 달력에서 골라 주세요', span: null };
  const h = hits[0];
  const span: [number, number] = [h.s, h.e];
  if (DEADLINE_WORD_RE.test(t.slice(h.e))) return { period: null, note: null, span: null };
  // 범위를 지운 나머지에 숫자만 쓴 날짜 꼴이 남으면(다른 기간 · 금액 소수와 갈리지 않음) 읽지 않는다
  const rest = t.slice(0, h.s) + ' ' + t.slice(h.e);
  if (/(?<!\d)\d{1,2}\s*[./]\s*\d{1,2}(?!\d)/.test(rest) || /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(rest)) {
    return { period: null, note: '날짜가 여러 개라 읽지 않았어요. 달력에서 골라 주세요', span: null };
  }
  const today = kstDayOf(nowMs);
  const year = Number(today.slice(0, 4));
  const nowMonth = Number(today.slice(4, 6));
  const m2 = h.m2 ?? h.m1;
  let y1 = h.y1 ?? year;
  let y2 = h.y2 ?? (h.y1 ?? year);
  if (h.y2 === null && (m2 < h.m1)) y2 = y1 + 1;                      // 12월 → 1월(끝만 다음 해)
  if (h.y1 === null && h.y2 === null && nowMonth >= 10 && h.m1 <= 3) { y1 += 1; y2 += 1; } // 연말에 적은 1~3월 = 내년(마감일 읽기와 같은 규칙)
  if (!realDate(y1, h.m1, h.d1) || !realDate(y2, m2, h.d2)) return { period: null, note: '달력에 없는 날짜예요. 달력에서 골라 주세요', span };
  const startsOn = ymd(y1, h.m1, h.d1);
  const endsOn = ymd(y2, m2, h.d2);
  if (endsOn < startsOn) return { period: null, note: '마지막 날이 시작일보다 빨라요. 달력에서 골라 주세요', span };
  const todayIso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  if (endsOn < todayIso) return { period: null, note: '이미 지난 기간이에요. 날짜를 골라 주세요', span };
  if (!isValidLinePeriodEnd(endsOn, nowMs)) return { period: null, note: '너무 먼 날짜예요. 달력에서 골라 주세요', span };
  return { period: { startsOn, endsOn }, note: null, span };
}

// ── 채널 말 ──────────────────────────────────────────────────────────
function readChannels(t: string): { channels: Array<'sms' | 'dm' | 'email'>; unsupported: string[] } {
  const channels: Array<'sms' | 'dm' | 'email'> = [];
  if (/문자|(?<![a-z])(?:sms|lms|mms)(?![a-z])/i.test(t)) channels.push('sms');
  if (/(?<![a-z])dm(?![a-z])|디엠/i.test(t)) channels.push('dm');
  if (/메일|(?<![a-z])e-?mail(?![a-z])/i.test(t)) channels.push('email');
  const unsupported: string[] = [];
  for (const [re, label] of [[/알림톡|카카오톡|카톡/, '알림톡'], [/인앱|앱\s*푸시|푸시/, '인앱'], [/브랜드\s*메시지/, '브랜드 메시지']] as Array<[RegExp, string]>) {
    if (re.test(t)) unsupported.push(label);
  }
  return { channels, unsupported };
}

/** 행사명 = 기간 · 받는 사람을 지운 첫 구획에서 끝 말투를 뗀 것(30자 이하 · 못 만들면 null) */
function readTitle(t: string): string | null {
  const first = t.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) || '';
  let x = first.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i += 1) {
    x = x.replace(/\s*(?:을|를)?\s*(?:진행|시작|오픈|준비|하려|할|해|합|예정)[가-힣]*\s*$/, '').trim();
  }
  x = x.replace(/[,·~\-]+$/, '').trim();
  return x.length >= 2 && x.length <= 30 ? x : null;
}

/** (순수) 플래너 한 줄 → 제안 값 */
export function readPlannerLine(line: string, nowMs: number): PlannerLineRead {
  const t = String(line || '').replace(/\s+/g, ' ').trim().slice(0, PLANNER_LINE_MAX);
  const { rest, seg } = cutAudience(t);
  const audience = seg === null ? null : readAudienceSegment(seg);
  const pr = linePeriodRange(rest, nowMs);
  const noPeriod = pr.span ? `${rest.slice(0, pr.span[0])} ${rest.slice(pr.span[1])}` : rest;
  // 혜택 = 기간 · 대상 표지를 지운 한 줄 전체로 판정(대상 구획 속 조건 「회원만」도 혜택을 좁히는 말로 본다 · 넓히지 않게)
  const tNoPeriod = pr.span ? t.replace(rest.slice(pr.span[0], pr.span[1]), ' ') : t;
  const benefit = lineBenefitPrefill(tNoPeriod.replace(TARGET_MARK_RE, ' '));
  const title = readTitle(noPeriod);
  const { channels, unsupported } = readChannels(t);
  return {
    title,
    period: pr.period,
    periodNote: pr.note,
    benefit,
    productTerms: lineProductTerms(noPeriod).filter((w) => !/^\d/.test(w)),
    audience,
    channels,
    unsupported,
  };
}
