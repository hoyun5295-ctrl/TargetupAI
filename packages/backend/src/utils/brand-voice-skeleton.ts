/**
 * 대표 문안 뼈대 CT (★ 2026-10-28 AI 메모리 설계 K5-4 · I16 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 허용 목록 원칙: 생성 프롬프트에 들어가는 회사 문안 글자 = 사람이 확인한 뼈대뿐.
 * 뼈대 = 원문 글자 + 발송 차단 규격 칸(AI_FILL_DIRECT_PATTERN). AI 가 새 글을 만들 자리가 없다.
 *   - AI 가 돌려준 사실 조각(상품명 · 행사명 · 매장 · 기간 · 혜택 표현)은 **원문에 실제로 있는 것만** 칸으로 바꾼다.
 *   - 코드 판정 사실(링크 · 연락처 · 날짜 · 혜택 값 · 남은 숫자)도 칸으로 바꾼다.
 *   - %변수%(개인화)는 사실이 아니라 남긴다.
 * 같은 규칙이 가이드라인 문구 칸(빈출 표현 · CTA · 서명 · 인사 · 어미 예시)에도 걸린다(maskPhrase).
 */
import { createHash } from 'crypto';
import { BENEFIT_PLACEHOLDER, AI_FILL_DIRECT_PATTERN } from './copy-benefit-detector';
import { normalizeForShape } from './copy-shape';

export const SKELETON_SLOT = {
  product: '[상품명: 직접 입력해주세요]',
  event: '[행사명: 직접 입력해주세요]',
  store: '[매장: 직접 입력해주세요]',
  period: '[기간: 직접 입력해주세요]',
  benefit: BENEFIT_PLACEHOLDER,
  link: '[링크: 직접 입력해주세요]',
  phone: '[연락처: 직접 입력해주세요]',
  number: '[숫자: 직접 입력해주세요]',
} as const;
export type SkeletonSlotKind = keyof typeof SKELETON_SLOT;

/** AI 가 문안마다 돌려주는 사실 조각(원문 글자 그대로) */
export interface FactPieces {
  products?: unknown;
  events?: unknown;
  stores?: unknown;
  periods?: unknown;
  benefits?: unknown;
}

const PIECE_KIND: Array<[keyof FactPieces, SkeletonSlotKind]> = [
  ['events', 'event'], ['products', 'product'], ['stores', 'store'], ['periods', 'period'], ['benefits', 'benefit'],
];

function pieceList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter((x) => x.length >= 1 && x.length <= 60) : [];
}

/** 칸 자리는 건드리지 않고 나머지 글자에만 바꾸기를 건다 */
function replaceOutsideSlots(text: string, re: RegExp, slot: string): string {
  const parts = text.split(/(\[[^\]\n]{0,60}직접\s?(?:입력|작성|수정)해\s?주세요\]|%[^%\s]{1,20}%)/);
  return parts.map((p, i) => (i % 2 === 1 ? p : p.replace(re, slot))).join('');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** (순수) 코드 판정 사실 → 칸 */
function maskCodeFacts(text: string): string {
  let t = text;
  t = replaceOutsideSlots(t, /https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|co\.kr|kr|net|shop|me|ly)(?:\/\S*)?/gi, SKELETON_SLOT.link);
  t = replaceOutsideSlots(t, /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|1[568]\d{2}[-.\s]?\d{4}/g, SKELETON_SLOT.phone);
  t = replaceOutsideSlots(t, /\d{1,2}\s*\/\s*\d{1,2}(?:\s*\([월화수목금토일]\))?(?:\s*[~-]\s*\d{1,2}\s*\/\s*\d{1,2}(?:\s*\([월화수목금토일]\))?)?|\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([월화수목금토일]\))?|D\s*-\s*\d{1,3}/gi, SKELETON_SLOT.period);
  t = replaceOutsideSlots(t, /\d{1,3}\s*%|\d[\d,]*\s*만?\s*원|\d\s*\+\s*\d/g, SKELETON_SLOT.benefit);
  t = replaceOutsideSlots(t, /\d[\d,.]*/g, SKELETON_SLOT.number);
  return t;
}

/**
 * (순수) 원문 → 뼈대. AI 조각은 원문에 그대로 있는 것만 받는다(없는 조각 = 무시 · AI 가 글을 만들 자리 없음).
 * 긴 조각부터 바꾼다(「봄 신상 페스타」가 「봄 신상」보다 먼저).
 */
export function buildSkeleton(text: string, pieces: FactPieces | null | undefined): string {
  let t = normalizeForShape(text);
  const all: Array<{ s: string; slot: string }> = [];
  for (const [key, kind] of PIECE_KIND) {
    for (const s of pieceList(pieces?.[key])) if (t.includes(s)) all.push({ s, slot: SKELETON_SLOT[kind] });
  }
  all.sort((a, b) => b.s.length - a.s.length);
  for (const { s, slot } of all) t = replaceOutsideSlots(t, new RegExp(escapeRe(s), 'g'), slot);
  return maskCodeFacts(t);
}

/** (순수) 가이드라인 문구 칸 하나에 같은 칸 치기(빈출 표현 · CTA · 서명 · 인사 · 어미 예시) */
export function maskPhrase(phrase: string, pieces: ReadonlyArray<FactPieces | null | undefined>): string {
  let t = String(phrase || '');
  const all: Array<{ s: string; slot: string }> = [];
  for (const p of pieces) for (const [key, kind] of PIECE_KIND) for (const s of pieceList(p?.[key])) if (t.includes(s)) all.push({ s, slot: SKELETON_SLOT[kind] });
  all.sort((a, b) => b.s.length - a.s.length);
  for (const { s, slot } of all) t = replaceOutsideSlots(t, new RegExp(escapeRe(s), 'g'), slot);
  return maskCodeFacts(t);
}

/** 사람이 화면에서 고친 뼈대 검사 = 원문 글자 + 칸만(칸을 뗀 글자가 원문 글자의 부분 순서여야 한다 · 새 글 금지) */
export function isSkeletonOfText(skeleton: string, text: string): boolean {
  const pieces = String(skeleton || '').split(new RegExp(AI_FILL_DIRECT_PATTERN.source, 'g')).map((p) => p).filter((p) => p.length > 0);
  const src = normalizeForShape(text);
  let from = 0;
  for (const p of pieces) {
    const at = src.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

/** 문안 글 해시(뼈대가 지금 문안의 것인가 · 문안이 고쳐지면 그 뼈대는 쓰지 않는다) */
export function textHash(text: string): string {
  return createHash('sha256').update(normalizeForShape(text)).digest('hex').slice(0, 32);
}
