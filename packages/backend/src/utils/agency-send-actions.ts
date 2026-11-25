/**
 * agency-send-actions.ts — 대행발송 조작 주체 · 정책 한 벌(★2026-10-18 · 설계서 docs/2026-10-16-agency-send-mobile-control-design.md §2 축 2)
 *
 * 주체 = user(로그인 화면) | link(담당자 휴대폰 링크) | staff(운영 · 슈퍼관리자). 조작마다 허용 · 막힌 사유를 **여기 한 곳**이 만든다.
 * 링크 info 의 `actions{}` 와 링크 POST 가드가 같은 함수를 부른다(화면에 보이는 버튼 = 서버가 받는 조작).
 * 상태 축은 기존 판정(`checkApproval` · `canCancel` · `isEditable`) 재사용 · 새 규칙을 만들지 않는다.
 *   링크 = 승인 · 취소 · 시각 변경(승인 전 + 미발송 재개) · 맞춤법 제안 적용 · 자유 문안 수정 = 로그인만 · staff = 취소만.
 * ⛔ 순수(DB 0) · 문장은 사람이 읽는 말 · 줄표 0.
 */
import {
  AGENCY_SEND_LOCK_REASON, approvalDeadline, canCancel, checkApproval, isAgencySendLocked, isEditable, isSameKstDay, MIN_LEAD_MINUTES, type AgencySendStatus,
} from './agency-send-state';
import { readAgencySpell } from './agency-send-spell';

export type AgencyActor = 'user' | 'link' | 'staff';
export interface AgencyActionState { ok: boolean; reason: string | null }
export interface AgencyActions {
  approve: AgencyActionState;
  cancel: AgencyActionState;
  reschedule: AgencyActionState;
  /** 만료 건을 **같은 시각으로** 다시 진행(되살린 뒤 상태로 승인이 통과할 때만 · 최종 검증 3) */
  resume: AgencyActionState;
  spellFix: AgencyActionState;
  editText: AgencyActionState;
  /** ★ 2026-11-24 통신사 스팸 막힘 「그대로 보내기」(로그인 화면만 · 설계서 docs/2026-11-24-agency-spam-override-design.md §3) */
  spamOverride: AgencyActionState;
  /** 승인 마감(ISO) · 승인 대기가 아니면 null */
  approveBy: string | null;
}

const yes: AgencyActionState = { ok: true, reason: null };
const no = (reason: string): AgencyActionState => ({ ok: false, reason });
const dateOf = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? null : d;
};

function cancelReason(status: AgencySendStatus): string {
  if (status === 'sent') return '이미 발송이 끝난 건이에요.';
  if (status === 'cancelled') return '이미 취소된 건이에요.';
  if (status === 'cancelling') return '취소를 처리하고 있어요.';
  return '검사가 진행 중이라 지금은 취소할 수 없어요. 잠시 후 다시 열어 주세요.';
}

/** (순수) 이 주체가 지금 이 접수에 할 수 있는 조작 */
export function agencyActions(actor: AgencyActor, row: any, now: Date = new Date()): AgencyActions {
  const status = String(row?.status || '') as AgencySendStatus;
  const requestedAt = dateOf(row?.requested_at) || new Date(0);
  const finalTestedAt = dateOf(row?.final_test_at);
  const approvalRequestedAt = dateOf(row?.approval_requested_at);
  const revision = Number(row?.revision);
  const dispatched = !!row?.campaign_id;
  // ★ 2026-10-19 보낼 시각 15분 전 잠금(직접발송 예약 취소와 같은 판정) — 승인은 checkApproval 리드타임이 같은 15분으로 막는다
  const locked = isAgencySendLocked(row?.requested_at, now);

  const appr = checkApproval({ status, revision, requestedAt, finalTestedAt, approvalRequestedAt }, revision, now);
  const approve = actor === 'staff' ? no('운영 화면에서는 승인하지 않아요.') : appr.ok ? yes : no(appr.error || '지금은 승인할 수 있는 상태가 아니에요.');
  const cancel = !canCancel(status) ? no(cancelReason(status)) : locked ? no(AGENCY_SEND_LOCK_REASON) : yes;
  const editable = isEditable(status) && !dispatched;
  const reschedule = actor === 'staff' ? no('운영 화면에서는 시각을 바꾸지 않아요.')
    : !editable ? no(dispatched ? '이미 발송 준비가 시작된 건이에요.' : '지금은 시각을 바꿀 수 있는 상태가 아니에요.')
      : locked ? no(AGENCY_SEND_LOCK_REASON) : yes;
  // 되살린 뒤 = 승인 대기 · 승인 요청 시각 = 지금(24시간 다시 시작)으로 승인이 통과하는가
  const revived = status === 'expired' && editable
    ? checkApproval({ status: 'awaiting_approval', revision, requestedAt, finalTestedAt: null, approvalRequestedAt: now }, revision, now)
    : null;
  const resume = actor === 'staff' ? no('운영 화면에서는 다시 진행하지 않아요.')
    : revived?.ok ? yes : no(status !== 'expired' ? '만료된 건만 다시 진행할 수 있어요.' : '보낼 시각이 너무 가까워 같은 시각으로는 다시 진행할 수 없어요. 시각을 바꿔 주세요.');
  const issues = readAgencySpell(row);
  const fixable = (issues || []).filter((i) => !i.blocked).length;
  const minutesLeft = (requestedAt.getTime() - now.getTime()) / 60000;
  const spellFix = actor === 'staff' ? no('운영 화면에서는 문안을 고치지 않아요.')
    : !editable ? no('지금은 문안을 고칠 수 있는 상태가 아니에요.')
      : locked ? no(AGENCY_SEND_LOCK_REASON)
      : fixable === 0 ? no('고칠 수 있는 맞춤법 제안이 없어요.')
        : minutesLeft < MIN_LEAD_MINUTES ? no(`보낼 시각까지 ${MIN_LEAD_MINUTES}분이 남지 않아 고치면 다시 검사 · 승인할 시간이 없어요.`) : yes;
  const editText = actor !== 'user' ? no('문안을 직접 고치는 일은 한줄로 화면에서 해요.')
    : !editable ? no('지금은 문안을 고칠 수 있는 상태가 아니에요.') : locked ? no(AGENCY_SEND_LOCK_REASON) : yes;
  const offer = spamOverrideOf(row, now);
  const spamOverride = actor !== 'user' ? no('그대로 보내기는 한줄로 화면에서 골라요.') : offer.ok ? yes : no(offer.reason || '지금은 그대로 보낼 수 없어요.');
  const by = approvalDeadline(status, requestedAt, finalTestedAt, approvalRequestedAt);
  return { approve, cancel, reschedule, resume, spellFix, editText, spamOverride, approveBy: by ? by.toISOString() : null };
}

/** 「그대로 보낼 수 있음」 표식(결과 칸 `last_test_result.spamOverridable` · 통신사 막힘 세 갈래만 쓴다 · 다른 상태 변경은 지운다) */
/**
 * submittedTested = 보낼 글(submitted) 자체를 checkedAt 의 검사에서 새로 봤는가(★ Codex 구현 1R #2 · 다듬은 글이나 다른 날 검사를 이어 본 글만 막혔으면 false
 *   = 「당일 검사 끝」으로 세지 않는다 · 값이 없는 옛 표식도 false).
 */
export interface SpamOverrideMarker { version: number; submitted: string; checkedAt: Date; submittedTested: boolean }
export function spamOverrideMarkerOf(row: any): SpamOverrideMarker | null {
  const m = row?.last_test_result?.spamOverridable;
  if (!m || typeof m !== 'object') return null;
  const version = Number(m.version);
  const submitted = typeof m.submitted === 'string' ? m.submitted : '';
  const checkedAt = dateOf(m.checkedAt);
  if (!Number.isFinite(version) || !submitted.trim() || !checkedAt) return null;
  return { version, submitted, checkedAt, submittedTested: m.submittedTested === true };
}

export interface SpamOverrideOffer {
  ok: boolean;
  reason: string | null;
  /** 그대로 보낼 글(허용일 때) */
  text: string | null;
  /** 그대로 보낸 뒤 「당일 검사 끝」(막힘이 보낼 날 · KST 에 확정됐으면 그 시각 · 아니면 null = 발송 2시간 전 검사가 한 번 돈다) */
  finalTestedAt: Date | null;
  /** 막힘 표식은 맞는데 보낼 시각 때문에 못 고른다(시각을 바꾸면 다시 검사 · 다시 고를 수 있다) */
  retime: boolean;
}

/**
 * (순수) 지금 이 접수를 「그대로 보내기」할 수 있는가 · 보낼 글 · 「당일 검사 끝」.
 *   상태 test_failed · 표식 version = 지금 문안 버전 · 이미 적재 0 · 15분 잠금 밖 · 그리고 그대로 보낸 뒤 승인이 통하는가(승인 판정과 같은 함수 ·
 *   설계 Codex 1R #1 = 2시간 안쪽에서 고르면 승인이 「너무 늦음」으로 막히던 길 · 당일 막힘은 그 검사를 받아들인 것이라 「당일 검사 끝」 = 막힌 시각).
 */
export function spamOverrideOf(row: any, now: Date = new Date()): SpamOverrideOffer {
  const none = (reason: string, retime = false): SpamOverrideOffer => ({ ok: false, reason, text: null, finalTestedAt: null, retime });
  if (String(row?.status || '') !== 'test_failed') return none('스팸 검사에 막힌 접수만 그대로 보낼 수 있어요.');
  const marker = spamOverrideMarkerOf(row);
  if (!marker || marker.version !== Number(row?.content_version)) return none('스팸 검사 막힘이 아닌 사유라 그대로 보낼 수 없어요. 문안을 고쳐 주세요.');
  if (row?.campaign_id) return none('이미 발송 준비가 시작된 건이에요.');
  if (isAgencySendLocked(row?.requested_at, now)) return none(AGENCY_SEND_LOCK_REASON, true);
  const requestedAt = dateOf(row?.requested_at) || new Date(0);
  const finalTestedAt = marker.submittedTested && isSameKstDay(marker.checkedAt, requestedAt) ? marker.checkedAt : null;
  const revision = Number(row?.revision);
  const appr = checkApproval({ status: 'awaiting_approval', revision, requestedAt, finalTestedAt, approvalRequestedAt: now }, revision, now);
  if (!appr.ok) return none('보낼 시각이 가까워 그대로 보내려면 시각을 먼저 바꿔 주세요.', true);
  return { ok: true, reason: null, text: marker.submitted, finalTestedAt, retime: false };
}
