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
 * 재사용 = 혜택 = 공용 듣기 `listenLine`(같은 한 줄 = 같은 의도 · 뿌리 대장 R9) · 상품 낱말 `lineProductTerms` · 전체 요청 `isPlainAllCustomersRequest` ·
 *   날짜 검사 `isValidLinePeriodEnd` · `kstDayOf` · 질문 모양 · 답 검증 = `one-line-ct/questions`.
 * ★ 2026-10-24 한 줄 + 모자란 것만 질문(뿌리 대장 R9) — 읽은 값은 그대로 두고 **못 읽은 칸만** 질문표로 묻는다(`plannerLineQuestions`).
 *   답 → 저장 본문 = `plannerLineEventBody`(서버가 다시 만든 질문표로만 검증 · 저장 판정은 행사 담기와 같은 함수).
 */
import { createHash } from 'crypto';
import { lineProductTerms } from './one-line-facts';
import { isPlainAllCustomersRequest } from './all-customers-signal';
import { isValidLinePeriodEnd, kstDayOf } from './one-line-steps';
import { listenLine } from './one-line-ct/listen';
import { pickAnswer, type LineAnswers, type LineQuestion } from './one-line-ct/questions';

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
  const benefit = listenLine(tNoPeriod.replace(TARGET_MARK_RE, ' '), { nowMs }).benefit;
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

// ── ★ 2026-10-24 한 줄 + 모자란 것만 질문(뿌리 대장 R9 · docs/ROOT-LEDGER.md) ─────────────────
//   옛: 한 줄 → 전체 기입 창 + 읽은 줄마다 「맞아요」 확인(공용 묻기 경로 밖 · 같은 한 줄이 기능마다 다르게 굴렀다).
//   지금: 읽은 칸은 그대로 · 못 읽은 칸만 질문표(여정 · 자동 마케팅과 같은 모양) → 버튼 한 번에 담는다(보내기는 늘 행사 확인 · 승인 뒤).

/** 질문표를 만드는 그 회사 사정(라우트가 읽어 넘긴다 · 여기는 DB 0) */
export interface PlannerLineAskContext {
  /** 채널 준비 판정(문자 · DM · 메일) — 잠김 사유 = 고객 문장 */
  channels: Array<{ channel: 'sms' | 'dm' | 'email'; label: string; available: boolean; reason: string | null }>;
  /** 관측 상품(구매자 많은 순) · 못 읽음 = null(상품 보기 없이 묻는다) */
  products: { door: 'mall' | 'ledger'; list: Array<{ key: string; name: string; buyers: number }> } | null;
}

/** 상품 보기 수(구매자 많은 순) · 한 줄 낱말에 맞은 상품 상한(= 저장 상한) */
const PRODUCT_OPTIONS = 6;
const READ_PRODUCT_MAX = 30;
const SINCE_OPTIONS = [{ value: '90', label: '최근 90일' }, { value: '180', label: '6개월' }, { value: '365', label: '1년' }, { value: '0', label: '기록 전체' }];

/** 한 줄 낱말에 맞은 관측 상품(맞춤 규칙 = confirmLineAudience 와 같다 · 화면 「「기초」가 든 상품 N개」 줄도 이것) */
export function plannerLineBuyerProducts(read: PlannerLineRead, ctx: PlannerLineAskContext): Array<{ key: string; name: string }> {
  const aud = read.audience;
  if (!aud || aud.kind !== 'product_buyers' || !ctx.products) return [];
  const terms = aud.terms.map((t) => t.toLowerCase());
  return ctx.products.list.filter((p) => terms.every((t) => String(p.name || '').toLowerCase().includes(t))).map((p) => ({ key: p.key, name: p.name }));
}

/** 읽은 채널 중 지금 열린 것 = 담을 채널(닫힌 것은 빼고 담는다 · 화면 「이렇게 담을게요」도 이 값을 그린다) */
export function plannerLineSendChannels(read: PlannerLineRead, ctx: PlannerLineAskContext): Array<'sms' | 'dm' | 'email'> {
  return read.channels.filter((ch) => ctx.channels.some((c) => c.channel === ch && c.available));
}

/** (순수) 못 읽은 칸만 질문(읽은 칸은 묻지 않는다) */
export function plannerLineQuestions(read: PlannerLineRead, ctx: PlannerLineAskContext): LineQuestion[] {
  const qs: LineQuestion[] = [];
  if (!read.title) qs.push({ id: 'title', kind: 'text', label: '행사 이름은?', required: true, maxLength: 120, placeholder: '예: 가을 기초 1+1' });
  if (!read.period) {
    const help = read.periodNote || undefined;
    qs.push({ id: 'startsOn', kind: 'date', label: '행사 시작일은?', required: true, ...(help ? { help } : {}) });
    qs.push({ id: 'endsOn', kind: 'date', label: '행사 마지막 날은?', required: true });
  }
  if (!read.benefit) {
    qs.push({ id: 'benefit', kind: 'text', label: '혜택은?', help: '알림 문구에 들어가요. 혜택이 없는 행사면 「혜택 없이」를 눌러 주세요', required: true, maxLength: 300, placeholder: '예: 전 품목 20% 할인', noneLabel: '혜택 없이' });
  }
  const aud = read.audience;
  const readBuyers = plannerLineBuyerProducts(read, ctx);
  const audResolved = aud?.kind === 'all' || (aud?.kind === 'product_buyers' && readBuyers.length > 0 && readBuyers.length <= READ_PRODUCT_MAX);
  if (!audResolved) {
    const products = (ctx.products?.list || []).slice(0, PRODUCT_OPTIONS);
    qs.push({
      id: 'audience', kind: 'choice', label: '누구에게 보낼까요?', required: true,
      help: aud?.kind === 'unread' ? `「${aud.raw}」은 아직 바로 고르지 못해요. 가까운 쪽을 골라 주세요` : '여러 상품을 묶은 조건은 담은 뒤 행사 화면에서 고칠 수 있어요',
      options: [{ value: 'all', label: '전체 고객' }, ...products.map((p) => ({ value: `p:${p.key}`, label: `「${p.name}」 산 고객`, desc: `구매자 ${p.buyers}명` }))],
    });
  }
  if (!audResolved || aud?.kind === 'product_buyers') {
    // 구매자 대상일 때만 쓴다(전체 고객을 고르면 답하지 않아도 된다) · 「모두」라고 적었으면 기록 전체를 추천
    // 기본값 없음 — 한 줄의 「모두」는 도움말로만 짚는다(대상 상품 고르기의 [기록 전체] 표시와 같은 규칙)
    // ★ 2026-10-25 원장 #61 — 필수 = 서버 담기 판정과 같다(대상이 상품 구매자로 정해졌으면 답이 있어야 담는다 · 옛: 늘 required false 로 내보내고 담기에서 거절)
    //   대상을 아직 안 골랐으면 상품을 고를 때만 필요하다(전체 고객이면 묻지 않는다) — 그 갈래는 화면이 상품을 고른 뒤에만 보이고 그때 필수로 다룬다(PlannerLineAsk)
    qs.push({
      id: 'since', kind: 'choice', label: '언제 산 고객인가요?', required: audResolved && aud?.kind === 'product_buyers', options: SINCE_OPTIONS,
      ...(aud?.kind === 'product_buyers' && aud.allTime ? { help: '한 줄에 「모두」라고 적으셨어요. 기록 전체가 그 뜻이에요' } : {}),
    });
  }
  if (plannerLineSendChannels(read, ctx).length === 0) {
    qs.push({
      id: 'channel', kind: 'choice', label: '어디로 보낼까요?', required: true,
      ...(read.channels.length > 0 ? { help: '한 줄에 적은 채널이 지금 닫혀 있어요. 열린 채널을 골라 주세요' } : {}),
      options: ctx.channels.map((c) => ({ value: c.channel, label: c.label, ...(c.available ? {} : { disabled: true, reason: c.reason || '지금은 고를 수 없어요.' }) })),
    });
  }
  return qs;
}

/**
 * (순수) 화면에 보일 질문 창 한 벌 + 그 지문(★ Codex 1024 1R) — 읽기 · 담기가 같은 함수.
 *   담기 때 서버가 다시 만든 창의 지문이 화면이 본 지문과 다르면(그 사이 상품 · 채널 사정이 바뀜) 저장하지 않고 새 창으로 다시 묻는다
 *   — 사람이 고른 답을 조용히 버리거나 다른 대상으로 저장하지 않게(뿌리 대장 R5 · 본 것 = 저장하는 것).
 */
export function plannerLineAsk(read: PlannerLineRead, ctx: PlannerLineAskContext) {
  const questions = plannerLineQuestions(read, ctx);
  const buyers = plannerLineBuyerProducts(read, ctx);
  const sendChannels = plannerLineSendChannels(read, ctx);
  const askKey = createHash('sha256').update(JSON.stringify({ read, questions, buyers, sendChannels, door: ctx.products?.door ?? null })).digest('hex').slice(0, 32);
  return { questions, buyerNames: buyers.map((p) => p.name), sendChannels, askKey };
}

/** 시작 기준일에서 N일 전(KST 'YYYY-MM-DD' · 0 = null = 기록 전체 · 화면 sinceDateOf 와 같은 계산) */
function sinceDateOf(days: number, nowMs: number): string | null {
  if (days === 0) return null;
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  kst.setUTCDate(kst.getUTCDate() - days);
  return kst.toISOString().slice(0, 10);
}

/**
 * (순수) 한 줄 + 답 → 행사 담기 본문(parsePlannerEventInput · normalizePlannerAudience 가 그대로 판정한다).
 * 질문표는 서버가 다시 만든 것만 쓴다(화면이 보낸 질문표를 믿지 않는다) · 답 검증 = pickAnswer.
 */
export function plannerLineEventBody(read: PlannerLineRead, answers: LineAnswers, ctx: PlannerLineAskContext, nowMs: number):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const qs = plannerLineQuestions(read, ctx);
  const got: Record<string, string> = {};
  for (const q of qs) {
    const a = pickAnswer(q, answers || {});
    if (!a.ok) return a;
    got[q.id] = a.value;
  }
  const startsOn = read.period?.startsOn ?? got.startsOn;
  const endsOn = read.period?.endsOn ?? got.endsOn;
  if (!read.period) {
    const today = kstDayOf(nowMs);
    if (endsOn < `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`) return { ok: false, error: '이미 지난 날짜예요. 행사 마지막 날을 다시 골라 주세요.' };
    if (!isValidLinePeriodEnd(endsOn, nowMs)) return { ok: false, error: '너무 먼 날짜예요. 행사 마지막 날을 다시 골라 주세요.' };
  }
  let audience: Record<string, unknown>;
  const pick = got.audience;
  if (pick === undefined) {
    audience = read.audience?.kind === 'all'
      ? { kind: 'all' }
      : { kind: 'product_buyers', door: ctx.products!.door, ...keysOf(plannerLineBuyerProducts(read, ctx)), since: sinceOf(got.since, nowMs) };
  } else if (pick === 'all') {
    audience = { kind: 'all' };
  } else {
    const p = ctx.products?.list.find((x) => `p:${x.key}` === pick);
    if (!p || !ctx.products) return { ok: false, error: '받는 사람을 다시 골라 주세요.' };
    audience = { kind: 'product_buyers', door: ctx.products.door, ...keysOf([p]), since: sinceOf(got.since, nowMs) };
  }
  if (audience.kind === 'product_buyers' && audience.since === undefined) return { ok: false, error: '「언제 산 고객인가요?」에 답해 주세요.' };
  const channels = got.channel ? [got.channel as 'sms' | 'dm' | 'email'] : plannerLineSendChannels(read, ctx);
  return {
    ok: true,
    body: {
      title: read.title ?? got.title,
      startsOn, endsOn,
      benefitText: read.benefit ?? got.benefit ?? '',
      touchpoints: channels.map((channel) => ({ channel, timing: { anchor: 'start' } })),
      audience,
    },
  };
}

const keysOf = (ps: Array<{ key: string; name: string }>) => ({ keys: ps.map((p) => p.key), names: ps.map((p) => p.name) });
/** 답 → since(빈 답 = undefined = 아직 안 고름) */
function sinceOf(v: string | undefined, nowMs: number): string | null | undefined {
  if (!v) return undefined;
  const days = Number(v);
  return SINCE_OPTIONS.some((o) => o.value === v) ? sinceDateOf(days, nowMs) : undefined;
}
