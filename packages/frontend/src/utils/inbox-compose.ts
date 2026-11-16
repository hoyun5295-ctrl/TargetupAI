/**
 * ★ 2026-11-14 C133 F5 — 상담함 답장 칸의 값(화면 쪽 · React 밖 · 가져오는 것 없음 = 서버 시험이 그대로 돌린다)
 *
 * 답장 칸에 보이는 글은 둘에서만 온다. 어느 쪽도 비동기 응답이 「옮겨 적지」 않는다(늦게 닿은 응답이 보낸 글을 다시 채우는 길이 없다).
 *   · 적던 글 — 대화마다(고객 번호). 대화를 오가도 · 답장 요청이 거절되거나 버려져도 남는다. 서버가 「나갔다」고 답했을 때만 지운다.
 *   · 서버가 적어 둔 초안 — 담아 두지 않고 지금 읽은 대화에서 그때그때 읽는다. 이 화면에서 이미 답한 글까지의 초안은 쓰지 않는다.
 */

export interface InboxMsg { direction: 'in' | 'out'; status: string; draft: string | null; at: string }

/** 지금 읽은 대화에서 — 답할 글(가장 최근에 받은 글 · 수신거부한 글 제외) · 닫을 글(가장 최근의 사람 필요 글) · 초안 */
export function inboxTargets<M extends InboxMsg>(messages: readonly M[], answeredUpTo?: string): { target: M | null; toClose: M | null; optedOut: boolean; draft: string } {
  const inbound = [...messages].reverse().filter((m) => m.direction === 'in');
  const target = inbound.find((m) => m.status !== 'optout') || null;
  const toClose = inbound.find((m) => m.status === 'human') || null;
  const draft = inbound.find((m) => m.status === 'human' && !!m.draft && (!answeredUpTo || m.at > answeredUpTo))?.draft || '';
  return { target, toClose, optedOut: inbound.length > 0 && !target, draft };
}

/** typed = 적던 글(고객 번호마다 · 없는 번호 = 손대지 않은 대화) · doneAt = 이 화면에서 답장이 나간 글의 시각(고객 번호마다) */
export interface InboxCompose { typed: Record<string, string>; doneAt: Record<string, string> }
export const composeEmpty = (): InboxCompose => ({ typed: {}, doneAt: {} });

/** 답장 칸의 글 = 적던 글이 있으면 그것(빈 글이어도) · 없으면 서버의 초안 */
export const composeText = (c: InboxCompose, phone: string, draft: string): string => c.typed[phone] ?? draft;

/** 적었다(보낼 때도 이것 — 보낸 글은 서버가 나갔다고 답할 때까지 그 대화의 답장 칸에 그대로 둔다) */
export const composeTyped = (c: InboxCompose, phone: string, text: string): InboxCompose => ({ ...c, typed: { ...c.typed, [phone]: text } });

/** 서버가 「나갔다(접수됐다)」고 답했다 — 그 대화의 적던 글을 지우고 · 그 글(at)까지의 초안을 다시 쓰지 않는다 */
export function composeSent(c: InboxCompose, phone: string, at: string): InboxCompose {
  const typed = { ...c.typed };
  delete typed[phone];
  return { typed, doneAt: { ...c.doneAt, [phone]: at } };
}
