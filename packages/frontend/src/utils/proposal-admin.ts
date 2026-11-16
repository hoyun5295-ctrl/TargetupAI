/**
 * proposal-admin.ts — 슈퍼관리자 「제안 체험」 탭의 표시 판정(순수) (★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §5-5 · §7)
 *   단계 = 로그인 → 신청 → 제작 → 전달 → 완성본 열람 → 보내기 누름 → 발송(보내기 누름 뒤 직접발송 건수).
 *   도착 알림 = 보내기 전 · 보내는 중(시도 뒤 2분 안) · 확인되지 않음 · 보냄(서버의 세 상태 표와 같은 뜻 · utils/proposal-trial.ts).
 */
export const PROPOSAL_STAGES = ['로그인', '신청', '제작', '전달', '완성본 열람', '보내기 누름', '발송'] as const;
/** 앞 시도가 아직 적재 중일 수 있는 동안(서버 PROPOSAL_NOTIFY_HOLD_MINUTES 와 같은 값) */
export const PROPOSAL_NOTIFY_HOLD_MS = 2 * 60_000;

export type ProposalStatus = 'requested' | 'producing' | 'produced' | 'delivered';
export interface ProposalStageInput {
  status: ProposalStatus | null; opened_at: string | null; used_at: string | null; sent_after: number; produce_error: string | null;
}

/** 회사가 지나온 단계 수 · 지금 자리의 글 · 우리 쪽에서 기다리는 중인가 */
export function proposalStageOf(c: ProposalStageInput): { done: number; label: string; waiting: boolean } {
  if (!c.status) return { done: 1, label: '로그인까지', waiting: false };
  if (c.status === 'requested') return { done: 2, label: c.produce_error ? '제작 멈춤' : '제작 대기', waiting: true };
  if (c.status === 'producing') return { done: 2, label: '제작 중', waiting: true };
  if (c.status === 'produced') return { done: 3, label: '확인 대기', waiting: true };
  if (!c.opened_at) return { done: 4, label: '전달함', waiting: false };
  if (!c.used_at) return { done: 5, label: '완성본 열람', waiting: false };
  if (!(c.sent_after > 0)) return { done: 6, label: '보내기 누름', waiting: false };
  return { done: 7, label: `보내기 누름 뒤 직접발송 ${c.sent_after}건`, waiting: false };
}

export interface ProposalCopyDraft { subject: string; text: string }
const sameDraft = (a?: ProposalCopyDraft | null, b?: ProposalCopyDraft | null): boolean => !!a && !!b && a.subject === b.subject && a.text === b.text;

/** 직원이 손댄 칸인가(저장된 값과 다르다) */
export function proposalDraftDirty(draft: ProposalCopyDraft | undefined, saved: { subject?: string | null; text: string } | undefined): boolean {
  return !!draft && !!saved && !sameDraft(draft, { subject: saved.subject || '', text: saved.text });
}

/**
 * 새로 읽은 서버 문안(server)으로 편집 칸을 맞춘다 — **화면의 문안 = 서버의 문안**이 기본이다(Codex 구현 1R: 제작 중에 연 화면이 문안 없이 남은 채 전달이 눌렸다).
 *   지키는 칸은 하나뿐: 직원이 손댄 칸(base = 그 칸을 채울 때의 서버 값과 다르다)이고 그 서버 값이 그대로일 때.
 *   서버 값이 바뀌었으면(다시 만들기 · 다른 직원의 저장) 서버 값을 보인다(본 적 없는 문안이 전달되지 않게).
 */
export function mergeProposalDrafts(drafts: readonly ProposalCopyDraft[], base: readonly ProposalCopyDraft[], server: readonly ProposalCopyDraft[]): ProposalCopyDraft[] {
  return server.map((s, i) => (drafts[i] && base[i] && !sameDraft(drafts[i], base[i]) && sameDraft(base[i], s) ? drafts[i] : s));
}

export type ProposalNotifyState = 'before' | 'idle' | 'sending' | 'unknown' | 'sent';
export interface ProposalNotifyInput { status: string | null; notify_tries: number | null; notify_tried_at: string | null; notified_at: string | null }

/** 도착 알림의 상태 — 전달 전 · 보내기 전 · 보내는 중(시도 뒤 2분 안) · 확인되지 않음 · 보냄 */
export function proposalNotifyState(r: ProposalNotifyInput, now: number = Date.now()): ProposalNotifyState {
  if (r.status !== 'delivered') return 'before';
  if (r.notified_at) return 'sent';
  if (!r.notify_tries) return 'idle';
  const tried = r.notify_tried_at ? new Date(r.notify_tried_at).getTime() : 0;
  return now - tried < PROPOSAL_NOTIFY_HOLD_MS ? 'sending' : 'unknown';
}

export const PROPOSAL_NOTIFY_TEXT: Record<ProposalNotifyState, string> = { before: '전달 전', idle: '보내기 전', sending: '보내는 중', unknown: '확인되지 않음', sent: '보냄' };
