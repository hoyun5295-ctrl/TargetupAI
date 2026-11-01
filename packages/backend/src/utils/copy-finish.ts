/**
 * copy-finish.ts — 여정 AI 문안의 출구 한 곳 + 검사된 글 표식(★ 2026-11-01 여정 재발 방지 배포 2 C2 · docs/2026-11-01-journey-recurrence-prevention-design.md §3 C2)
 *
 * 왜: 여정 AI 생산자(생성 · 다듬기 · 편집 · 다음 칸 · 변이 · 스팸 재작성)의 글이 응답 · 저장되기 전에 한 자리를 지나게 한다(J5).
 *   응답 · 저장 자리는 이 함수가 돌려준 `CheckedCopy` 만 받는다 — 그 표식 + 즉시 검사(check)가 화면 입구(C7)의 계약이다.
 * 하는 일 = 즉시 검사(D1 · 무료 0초 · 금지어 · 남은 자리 · 바이트 · 로컬 스팸 점수 · 고치기 꼴 바뀜) + 표식. **글을 바꾸지 않는다.**
 * ⛔ 사실 판정(지어낸 혜택 · 없던 숫자 · 효능 · 링크 빠짐)은 생산자가 소유한다(R13 · R33 · 생산자 계약 시험).
 *   ★ Codex 구현 1R #1 · 2R #1 #2 · 3R #1~#4 = 같은 뿌리 네 번 — 출구가 생산자 뒤에서 같은 판정을 다시 내리면 근거가 늘 어긋났다
 *   (정산 뒤 빈손 · 원장 링크 숫자 · 정제로 바뀐 링크 · 전송자 이름의 낱말 · 제목 + 본문 묶음 근거 · 사람 제목). 그래서 판정 = 생산자 한 곳 · 출구 = 검사 + 표식.
 * ⛔ `as CheckedCopy` 는 이 파일 밖 0(계약 시험) · 사람이 보낸 글은 HumanText(사람 저장 라우트).
 */
import { rewriteShapeDrift } from './copy-shape';
import { hasUneditedJourneyPlaceholder } from './send-placeholder-gate';
import { scoreSpamRisk, SPAM_FAIL_THRESHOLD } from './copy-spam-risk';
import { eucKrByteLength } from './message-byte';
import { buildAdMessage } from './messageUtils';
import { getBrandGuideline } from './brand-voice-prompt';

declare const checkedBrand: unique symbol;
declare const humanBrand: unique symbol;

export interface QuickCheckItem { key: 'banned' | 'placeholder' | 'bytes' | 'spam' | 'shape'; title: string }
export interface QuickCheck { quick: 'ok' | 'fix'; items: QuickCheckItem[] }

/** 출구를 지난 AI 글(이 파일만 만든다) */
export interface CheckedCopy {
  readonly text: string;
  readonly subject: string | null;
  readonly check: QuickCheck;
  readonly [checkedBrand]: true;
}
/** 사람이 보낸 글(사람 저장 라우트만 만든다 · 원장 근거가 되지 않는다) */
export type HumanText = string & { readonly [humanBrand]: true };

export interface FinishInput {
  companyId: string;
  /** 생산자 이름(로그) */
  producer: string;
  mode: 'write' | 'rewrite';
  text: string;
  subject?: string | null;
  channel: string;
  isAd: boolean;
  /** 고치기 전 글(rewrite) — 꼴 바뀜 검사에 쓴다 */
  before?: string | null;
  opt080?: string;
}

const BYTE_LIMIT: Record<string, number> = { SMS: 90, LMS: 2000, MMS: 2000 };

/** 즉시 검사(순수) — 화면 「검사 전 · 고칠 것」 줄과 C7 입구가 읽는다 */
export function quickCheckOf(input: { text: string; subject?: string | null; channel: string; isAd: boolean; opt080?: string; bannedWords?: readonly string[]; before?: string | null }): QuickCheck {
  const items: QuickCheckItem[] = [];
  const text = String(input.text || '');
  const banned = (input.bannedWords || []).filter((w) => w && (text.includes(w) || String(input.subject || '').includes(w)));
  if (banned.length > 0) items.push({ key: 'banned', title: `쓰지 않기로 한 말이 있어요: ${banned.join(', ')}` });
  if (hasUneditedJourneyPlaceholder(text) || hasUneditedJourneyPlaceholder(input.subject || '')) items.push({ key: 'placeholder', title: '채울 자리가 남았어요' });
  const msgType = String(input.channel || 'lms').toUpperCase();
  const limit = BYTE_LIMIT[msgType] ?? 2000;
  const bytes = eucKrByteLength(buildAdMessage(text, msgType, input.isAd, input.opt080 || ''));
  if (bytes > limit) items.push({ key: 'bytes', title: `${limit.toLocaleString('ko-KR')}바이트를 넘어요(${bytes.toLocaleString('ko-KR')}바이트)` });
  if (scoreSpamRisk(text).score >= SPAM_FAIL_THRESHOLD) items.push({ key: 'spam', title: '스팸으로 걸리기 쉬운 표현이 많아요' });
  if (input.before && String(input.before).trim() && rewriteShapeDrift(String(input.before), text).length > 0) items.push({ key: 'shape', title: '원래 글의 꼴(줄 · 머리 · 맺음)이 바뀌었어요' });
  return { quick: items.length > 0 ? 'fix' : 'ok', items };
}

/** 여정 AI 글의 출구(응답 · 저장 자리는 이 결과만 받는다 · 글을 바꾸지 않는다 · 실패 없음) */
export async function finishCopy(input: FinishInput): Promise<CheckedCopy> {
  const text = String(input.text || '');
  const subject = input.subject == null ? null : String(input.subject);
  let bannedWords: string[] = [];
  try { bannedWords = ((await getBrandGuideline(input.companyId))?.banned_words || []).filter((w: unknown): w is string => typeof w === 'string' && !!w.trim()); }
  catch (err) { console.warn(`[copy-finish] ${input.producer} 브랜드 키트 조회 실패 — 금지어 검사 없이:`, (err as Error)?.message); }
  const check = quickCheckOf({ text, subject, channel: input.channel, isAd: input.isAd, opt080: input.opt080, bannedWords, before: input.mode === 'rewrite' ? input.before : null });
  return { text, subject, check } as CheckedCopy;
}

/** 여러 안을 한 번에(응답 자리 · 안마다 출구) */
export async function finishMany(
  items: ReadonlyArray<{ text: string; subject?: string | null; before?: string | null }>,
  base: Omit<FinishInput, 'text' | 'subject' | 'before'>,
): Promise<CheckedCopy[]> {
  const out: CheckedCopy[] = [];
  for (const it of items) out.push(await finishCopy({ ...base, text: it.text, subject: it.subject ?? null, before: it.before ?? null }));
  return out;
}

/** 응답 꼴 — AI 글을 화면에 돌려줄 때(본문 · 제목 · 즉시 검사) */
export function copyResponse(c: CheckedCopy): { message: string; subject: string | null; check: QuickCheck } {
  return { message: c.text, subject: c.subject, check: c.check };
}

/** 사람 저장 라우트에서만 부른다(요청 글 = 사람 책임 · 원장 근거 아님) */
export function asHumanText(v: unknown): HumanText {
  return String(v ?? '') as HumanText;
}
