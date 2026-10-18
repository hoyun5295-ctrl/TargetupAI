/**
 * utils/ai-line.ts — AI 한줄로 판정 · 키 · 금액 · 칩 글 CT (순수 · DB 0 · AI 0 · ★ 2026-10-18)
 *
 * 설계서 = docs/2026-10-18-ai-line-design.md §5 · §6
 * "한 줄을 치면 대상을 뽑고, 이미 말한 것은 다시 묻지 않고, 빠진 것만 확인한 뒤, 고른 종류의 문안만 만든다."
 *
 * ⛔ 불변
 *   - 판정(갈래 · 빠진 것)은 사용자가 친 한 줄로만 한다(생성물로 결측을 찾지 않는다 · one-line-facts 원칙).
 *   - 조건 출처는 AI 자기 신고가 아니라 **조각이 원문에 실제로 있는가**로 서버가 정한다. 모르면 「AI 가 보탬」(끌 수 있는 쪽).
 *   - 원장 키 = 회사 + 날짜/시도 + 입력 지문. 같은 날 같은 한 줄 = 기본 0 · 같은 시도 재요청 = 0.
 */
import { createHash } from 'crypto';
import { oneLineGaps, hasPromotionIntent } from './one-line-facts';
import { linePeriodMentioned, lineFingerprint } from './one-line-steps';
import { kstDateTag, getCreditCost } from './ai-credit-calc';
import { SENDABLE_RECIPIENTS_LIMIT } from './operator-recipients';

// ★ 2026-10-19 스위치 삭제(Harold 「스위치고 뭐고」) — 새 흐름 = 전 회사 · AI 한줄로의 유일한 흐름.

// ─────────────── read (AI 0 · DB 0) ───────────────

export type AiLineBranch = 'sms' | 'alimtalk' | 'ask_kakao';

const ALIMTALK_RE = /알림\s*톡/;
const KAKAO_RE = /카톡|카카오/;

export interface AiLineRead {
  branch: AiLineBranch;
  /** 문자 갈래에서만 — 행사인데 혜택 값이 없다 · 행사인데 기간 말이 없다 */
  gaps: { benefit: boolean; period: boolean };
  /** 알림톡 + 광고 의도(할인 · 이벤트) = 알림톡으로 보낼 수 없다 */
  adConflict: boolean;
}

/** (순수) 한 줄 → 갈래 · 빠진 것. 알림톡 갈래는 문안을 만들지 않으므로 묻지 않는다. */
export function readAiLine(line: string): AiLineRead {
  const t = String(line || '').trim();
  const branch: AiLineBranch = ALIMTALK_RE.test(t) ? 'alimtalk' : KAKAO_RE.test(t) ? 'ask_kakao' : 'sms';
  const promo = hasPromotionIntent(t);
  const sms = branch === 'sms';
  return {
    branch,
    gaps: {
      benefit: sms && oneLineGaps(t).benefit,
      period: sms && promo && !linePeriodMentioned(t),
    },
    adConflict: branch === 'alimtalk' && promo,
  };
}

/** (순수) 한 줄이 「전체 고객」을 말했는가(「전체 고객」 · 「모든 회원」 · 「고객 전체」) — 말했으면 「누구에게」를 다시 묻지 않는다 */
export function lineMentionsAllCustomers(line: string): boolean {
  const t = String(line || '').replace(/\s+/g, '');
  return /(전체|모든|모두|전부)(고객|회원)|(고객|회원)(전체|모두|전부)/.test(t);
}

// ─────────────── 문안 종류 ───────────────

export type AiLineCopyType = 'emo' | 'benefit' | 'mz';
export type AiLineType = 'direct' | AiLineCopyType;
export const AI_LINE_COPY_TYPES: readonly AiLineCopyType[] = ['emo', 'benefit', 'mz'];
/** 문안 생성기 변형 id(A 감성형 · B 혜택강조형 · C MZ 감성형 — generateMessages 계약) ↔ 종류 */
export const AI_LINE_TYPE_BY_VARIANT: Readonly<Record<string, AiLineCopyType>> = { A: 'emo', B: 'benefit', C: 'mz' };
export const AI_LINE_TYPE_LABEL: Readonly<Record<AiLineType, string>> = { direct: '직접입력', emo: '감성형', benefit: '혜택강조형', mz: 'MZ 감성형' };

/** (순수) 대상 AI 의 추천 종류 글 → 종류 id(모르면 null) */
export function styleToType(style: unknown): AiLineCopyType | null {
  const s = String(style || '').replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  if (s.includes('혜택')) return 'benefit';
  if (s.includes('mz')) return 'mz';
  if (s.includes('감성')) return 'emo';
  return null;
}

/** (순수) 요청 본문의 종류 목록 — 문안 종류만(직접입력은 생성하지 않는다) · 중복 0 · 1~3개 */
export function sanitizeLineTypes(raw: unknown): AiLineCopyType[] | 'invalid' {
  if (!Array.isArray(raw)) return 'invalid';
  const out: AiLineCopyType[] = [];
  for (const v of raw) {
    if (!AI_LINE_COPY_TYPES.includes(v as AiLineCopyType)) return 'invalid';
    if (!out.includes(v as AiLineCopyType)) out.push(v as AiLineCopyType);
  }
  return out.length >= 1 && out.length <= AI_LINE_COPY_TYPES.length ? out : 'invalid';
}

// ─────────────── 조건 출처 · 칩 글 ───────────────

const normForQuote = (s: string) => String(s || '').toLowerCase().replace(/[\s·,.!?~"'()[\]「」]/g, '');

/** (순수) AI 가 적은 근거 조각이 한 줄에 실제로 있는가(공백 · 문장부호 무시 · 2글자 이상) */
export function quoteInLine(line: string, quote: unknown): boolean {
  const q = normForQuote(String(quote || ''));
  return q.length >= 2 && normForQuote(line).includes(q);
}

const condValue = (cond: unknown): unknown =>
  cond !== null && typeof cond === 'object' && !Array.isArray(cond) && 'value' in (cond as object) ? (cond as any).value : cond;
const condOp = (cond: unknown): string =>
  cond !== null && typeof cond === 'object' && !Array.isArray(cond) && typeof (cond as any).operator === 'string' ? (cond as any).operator : 'eq';
const fmtNum = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v));

/** (순수) 조건 하나 → 칩 글(「서울」 · 「30대」 · 「여성」 · 「고객등급 VIP」). 화면 칩과 문안 대상 문장이 같은 글을 쓴다. */
export function filterChipText(key: string, cond: unknown, label: string): string {
  const v = condValue(cond);
  const op = condOp(cond);
  const L = label || key;
  if (key === 'gender') {
    const g = String(v || '').toUpperCase();
    return g === 'M' || g === '남' || g === '남성' ? '남성' : g === 'F' || g === '여' || g === '여성' ? '여성' : `${L} ${String(v)}`;
  }
  if (key === 'minAge' || key === 'min_age') return `${fmtNum(v)}세 이상`;
  if (key === 'maxAge' || key === 'max_age') return `${fmtNum(v)}세 이하`;
  if (op === 'between' && Array.isArray(v) && v.length === 2) {
    const [a, b] = v.map(Number);
    if (key === 'age' && Number.isFinite(a) && a % 10 === 0 && b === a + 9) return `${a}대`;
    return `${L} ${fmtNum(v[0])}~${fmtNum(v[1])}`;
  }
  if (op === 'gte') return `${L} ${fmtNum(v)} 이상`;
  if (op === 'lte') return `${L} ${fmtNum(v)} 이하`;
  if (op === 'in' && Array.isArray(v)) return key === 'region' ? v.join('·') : `${L} ${v.join('·')}`;
  if (op === 'birth_month') return `${fmtNum(v)}월 생일`;
  if (op === 'date_gte') return `${L} ${String(v)} 이후`;
  if (op === 'date_lte') return `${L} ${String(v)} 이전`;
  if (op === 'days_within') return `${L} ${fmtNum(v)}일 안`;
  if (key === 'region' || key === 'address') return String(v);
  if (op === 'contains') return `${L} 「${String(v)}」 포함`;
  return `${L} ${String(v)}`;
}

// ─────────────── 원장 키 · 금액 ───────────────

export const AI_LINE_SOURCE = {
  intake: 'ai-line-intake',
  compose: 'ai-line-compose',
  decorate: 'ai-line-decorate',
} as const;

/** 한 줄 지문 12자(공백 정리 후 · 1017 한 줄 완성과 같은 함수) */
export function aiLineLineFp(line: string): string {
  return lineFingerprint(line);
}

/** 기본(대상 찾기) 키 — 회사 · KST 날짜 · 한 줄 지문(최대 9+36+1+8+1+12 = 67자) */
export function aiLineBaseKey(companyId: string, line: string, at: Date): string {
  return `aio-base:${companyId}:${kstDateTag(at)}:${aiLineLineFp(line)}`;
}

/** 기본을 이미 냈는지 볼 키 — 오늘 · 어제(자정 경계 · 23:59 대상 찾기 → 00:01 만들기 = 다시 걷지 않는다) */
export function aiLineBaseKeys(companyId: string, line: string, now: Date): string[] {
  const today = aiLineBaseKey(companyId, line, now);
  const yesterday = aiLineBaseKey(companyId, line, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return today === yesterday ? [today] : [today, yesterday];
}

/** 입력 지문 16자 — 요청 본문 전체를 결박한다(같은 시도 토큰으로 내용을 바꾸면 새 키) */
export function aiLineInputFp(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 16);
}

/** 문안 키(최대 9+36+1+64+1+16 = 127자 · varchar(150) 안) */
export function aiLineCopyKey(companyId: string, attemptToken: string, payload: unknown): string {
  return `aio-copy:${companyId}:${attemptToken}:${aiLineInputFp(payload)}`;
}

/** 꾸미기 키 */
export function aiLineDecoKey(companyId: string, attemptToken: string, payload: unknown): string {
  return `aio-deco:${companyId}:${attemptToken}:${aiLineInputFp(payload)}`;
}

/** (순수) 만들기 금액 = 기본(아직 안 냈으면) + 종류마다 문안 단가 */
export function aiLineComposeCost(copyCount: number, basePaid: boolean): { base: number; copies: number; total: number } {
  const base = basePaid ? 0 : getCreditCost(AI_LINE_SOURCE.intake);
  const copies = Math.max(0, Math.floor(copyCount)) * getCreditCost(AI_LINE_SOURCE.compose);
  return { base, copies, total: base + copies };
}

/** 한 번에 보낼 수 있는 대상 상한 = 승인 발송 명단 상한(같은 값 하나) */
export const AI_LINE_MAX_AUDIENCE = SENDABLE_RECIPIENTS_LIMIT;

// ─────────────── 칼럼 · 1위 고객 ───────────────

/** 문안 변수로 쓰지 않는 칼럼(연락처 · 동의 · 주소 · 내부 코드 · 성별) — FIELD_MAP fieldKey */
export const AI_LINE_COLUMN_EXCLUDE: ReadonlySet<string> = new Set([
  'phone', 'sms_opt_in', 'email', 'address', 'store_code', 'store_phone', 'registration_type', 'gender',
]);
/** 이 대상 안 채움 비율이 이보다 낮으면 잠금(회사 프로필의 차단 기준과 같은 30) */
export const AI_LINE_FILL_LOCK = 30;

/** (순수) 이름 가리기 — 1자 = *, 2자 = 김*, 3자+ = 김*지(가운데 전부) */
export function maskName(name: unknown): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  const chars = Array.from(s);
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}
