/**
 * ai-copy-entry.ts — AI 문안을 칸에 넣는 화면 입구 하나(★ 2026-11-01 여정 재발 방지 배포 2 C7 · 설계서 §3 C7)
 *
 * 서버는 AI 글을 출구(finishCopy)를 지나게 한 뒤에만 돌려준다 — 그 증거가 응답의 `check`(즉시 검사)다.
 * 화면은 `check` 가 붙은 글만 넣는다. 없으면 서버 계약 위반이라 넣지 않고 알린다(거름을 건너뛴 글이 칸에 들어가지 않게).
 * 쓰는 곳 = 여정 작업 화면(다듬기 · 꾸미기) · 여정 만들기 화면(AI 수정 · 다듬기 · 날짜축 계획 · 다듬기 · 꾸미기) · A/B 자동 생성.
 */
export interface AiQuickCheck { quick: 'ok' | 'fix'; items: Array<{ key: string; title: string }> }

export const AI_CHECK_MISSING = '검사 결과 없이 온 AI 문안이라 넣지 않았어요. 다시 눌러 주세요.';

export function isAiQuickCheck(c: unknown): c is AiQuickCheck {
  const x = c as AiQuickCheck | null;
  return !!x && (x.quick === 'ok' || x.quick === 'fix') && Array.isArray(x.items);
}

/** 고칠 것 한 줄(즉시 검사가 「고칠 것」일 때만) */
export function aiCheckNote(c: AiQuickCheck): string | null {
  return c.quick === 'fix' && c.items.length > 0 ? `고칠 것: ${c.items.map((i) => i.title).join(' · ')}` : null;
}

/** 응답 한 안 → 넣을 글(본문 칸 이름 = message 또는 messageTemplate) */
export function aiCopyEntry(x: unknown): { ok: true; text: string; check: AiQuickCheck; note: string | null } | { ok: false; error: string } {
  const o = (x || {}) as { message?: unknown; messageTemplate?: unknown; check?: unknown };
  const text = typeof o.message === 'string' ? o.message : typeof o.messageTemplate === 'string' ? o.messageTemplate : null;
  if (text == null || !isAiQuickCheck(o.check)) return { ok: false, error: AI_CHECK_MISSING };
  return { ok: true, text, check: o.check, note: aiCheckNote(o.check) };
}

/** 여러 안 · 칸(패키지)을 한 번에 — 검사가 빠진 글이 하나라도 있으면 통째로 넣지 않는다(일부만 바뀐 여정 방지) */
export function aiCopyEntriesAll<T>(list: readonly T[], hasCopy: (x: T) => boolean = () => true): { ok: true; notes: string[] } | { ok: false; error: string } {
  const notes: string[] = [];
  for (const x of list) {
    if (!hasCopy(x)) continue;
    const e = aiCopyEntry(x);
    if (!e.ok) return e;
    if (e.note) notes.push(e.note);
  }
  return { ok: true, notes };
}
