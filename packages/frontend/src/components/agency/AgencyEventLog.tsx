/**
 * AgencyEventLog — 대행발송 진행 기록 (★2026-08-28(2) 공용화)
 *
 * 고객 상세와 슈퍼관리자 내역 상세가 **같은 표·같은 문장**으로 이력을 읽는다.
 * 화면마다 라벨을 따로 두면 "고객에게는 승인 번호가 보이는데 직원 화면에는 안 보이는" 상태가 된다
 * (실제로 0828(2)에 슈퍼관리자 상세를 만들면서 이력을 빠뜨려 Harold 지적을 받았다).
 *
 * ⛔ 모르는 kind에 내부 이름을 그대로 쓰지 않는다(고객 화면이다).
 * ⛔ 새 이벤트 kind를 만들면 이 표에 등재하는 것이 같은 커밋이다(미등재 kind는 문장이 뭉개진다).
 */
import { Clock, History } from 'lucide-react';
import { formatWhen, type AgencySendEvent } from './agency-send-api';
import { CUI_SEC_TITLE } from '../../utils/console-ui';

/** 검사 이력을 담당자 언어로 */
const EVENT_LABEL: Record<string, string> = {
  received: '접수했습니다',
  spam_blocked: '스팸 검사에 걸렸습니다',
  refined: '문안을 다듬었습니다',
  // ★2026-08-31 다듬을 곳이 없어 문안이 그대로인 회차. `refined`와 나눈 이유는 이 경우 담당자에게
  //   새 문안·재승인 문자가 나가지 않기 때문이다(바뀐 문장이 없으니 보낼 것이 없다).
  refine_nochange: '다듬을 곳이 없어 그대로 다시 검사했습니다',
  refine_failed: '문안을 다듬지 못했습니다',
  awaiting_approval: '검사를 통과해 승인을 기다립니다',
  approved: '승인했습니다',
  reapproval: '발송 직전 검사에 걸려 다시 승인을 기다립니다',
  queued: '예약을 마쳤습니다',
  test_failed: '문안 확인이 필요합니다',
  final_test_failed: '발송 직전 검사를 통과하지 못했습니다',
  expired: '시각이 지나 발송하지 않았습니다',
  cancelled: '취소했습니다',
  cancel_queue_failed: '예약을 지우지 못해 취소를 되돌렸습니다',
  cancel_sweep_retry: '취소를 마무리하는 중입니다',
  cancel_swept: '남은 취소를 마무리했습니다',
  cancel_rejected: '발송이 임박해 취소하지 못했습니다',
  cancel_pending_dispatch: '예약을 만드는 중이라 취소를 이어서 처리합니다',
  reconciled_neutralize: '나가지 않아야 할 예약을 되돌렸습니다',
  reconciled_queued: '예약 상태를 확인해 맞췄습니다',
  cancel_finalized_elsewhere: '취소가 이미 마무리되었습니다',
  queued_by_other: '예약이 이미 연결되어 있습니다',
  dispatch_orphan_cancelled: '연결되지 않은 예약을 되돌렸습니다',
  dispatch_recovered: '예약 상태를 확인해 반영했습니다',
  dispatch_retry: '예약을 만들지 못해 다시 시도합니다',
  content_edited: '문안을 고쳤습니다',
  rescheduled: '시각을 고쳤습니다',
  lock_recovered: '멈춘 작업을 되돌렸습니다',
  notify_failed: '안내 문자를 보내지 못했습니다',
  reconciled_cancelled: '예약이 취소되어 반영했습니다',
  queued_already: '예약을 이미 마친 건입니다',
  queue_failed: '예약을 만드는 중 문제가 있었습니다',
  dispatch_rejected: '예약을 넣지 못했습니다',
  dispatch_no_recipient: '보낼 번호가 남지 않았습니다',
  dispatch_zero_after_filter: '수신거부를 빼고 나니 보낼 번호가 없습니다',
  dispatch_var_overflow: '문안에 넣을 항목이 너무 많습니다',
  dispatch_no_owner: '접수자 정보를 찾지 못했습니다',
  dispatch_error: '예약을 만들지 못해 다시 시도합니다',
  dispatch_incomplete: '예약이 끝나지 않아 발송하지 않았습니다',
  dispatch_unapproved_version: '승인한 문안과 달라 다시 승인을 기다립니다',
  first_test_error: '검사 중 문제가 있어 다시 시도합니다',
  final_test_error: '발송 전 검사 중 문제가 있어 다시 시도합니다',
};

/** 이벤트 한 줄을 사람 문장으로. 링크 승인·메일 접수는 "누가·어디서"까지 남긴다(부인 방지 기록) */
export function describeAgencyEvent(e: AgencySendEvent): string {
  // ★2026-08-25 링크 승인은 어느 담당자 번호가 눌렀는지까지 보여준다
  if (e.kind === 'approved' && e.payload?.via === 'link') {
    return `문자 속 주소에서 승인했습니다 (담당자 ${e.payload?.phone || '번호 미상'})`;
  }
  // ★2026-08-26 §18 이메일 접수는 어느 주소의 메일인지까지 보여준다(모르는 발송을 승인하지 않게)
  if (e.kind === 'received' && e.payload?.via === 'email') {
    return `메일로 접수했습니다 (${e.payload?.fromEmail || '주소 미상'})`;
  }
  return EVENT_LABEL[e.kind] || '진행 상황을 기록했습니다';
}

interface Props {
  events: AgencySendEvent[];
  /** 제목 톤 — 고객 상세는 인디고 콘솔 섹션 제목, 관리자 모달은 작은 회색 제목 */
  variant?: 'section' | 'compact';
}

export default function AgencyEventLog({ events, variant = 'section' }: Props) {
  if (!events || events.length === 0) return null;
  return (
    <div>
      <h4 className={variant === 'section'
        ? `${CUI_SEC_TITLE} flex items-center gap-1.5`
        : 'text-[12.5px] font-semibold text-gray-500 flex items-center gap-1.5'}>
        <History className="w-4 h-4 text-neutral-400" strokeWidth={2} />진행 기록
      </h4>
      <ul className="mt-2 space-y-1.5">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
            <Clock className="w-3.5 h-3.5 text-neutral-300 mt-0.5 shrink-0" strokeWidth={2} />
            <span className="text-neutral-500 tabular-nums shrink-0">{formatWhen(e.created_at)}</span>
            <span className="text-neutral-800">
              {describeAgencyEvent(e)}
              {e.payload?.round ? ` (${e.payload.round}번째)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
