/**
 * SendConfirmModal — 발송 직전 확인 (직접발송 · 직접타겟 · 알림톡 · 브랜드메시지 공용)
 *
 * ★ 2026-08-15 전면 재작성. 옛 화면은 흰 카드에 이모지 제목(⚡📅)과 회색 박스를 쌓은 옛 규격이라,
 *   화이트 고급형으로 정돈된 발송 워크스페이스 위에 뜨면 확인 단계에서만 품질이 꺾였다.
 *   셸은 `shared/ConfirmDialogShell`이 소유하고 여기는 **무엇을 보여줄지**만 정한다.
 *
 * 이 화면이 답해야 하는 것은 하나다 — "지금 누르면 몇 명에게 무엇이 나가는가."
 *   · 발송 건수를 주인공으로 크게(오발송의 대부분은 건수를 안 보고 누른 것이다)
 *   · 제외 내역(수신거부·중복)은 부수 정보로 아래에
 *   · 되돌릴 수 없다는 사실은 즉시 발송에서만, 예약은 취소 가능 기한을 적는다
 */

import { Zap, CalendarClock } from 'lucide-react';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';

export interface SendConfirmState {
  show: boolean;
  type: 'immediate' | 'scheduled';
  count: number;
  unsubscribeCount: number;
  /** ★ D137 D4: 중복 제외 건수 (0이거나 undefined면 UI 숨김) */
  duplicateCount?: number;
  dateTime?: string;
  /** 발송 경로 — 어느 실행 함수로 보낼지 판정한다 */
  from?: 'direct' | 'target' | 'alimtalk' | 'brand';
  msgType?: string;
}

interface SendConfirmModalProps {
  sendConfirm: SendConfirmState;
  setSendConfirm: (v: any) => void;
  directSending: boolean;
  executeDirectSend: () => void;
  executeTargetSend: () => void;
}

export default function SendConfirmModal({
  sendConfirm, setSendConfirm,
  directSending,
  executeDirectSend, executeTargetSend,
}: SendConfirmModalProps) {
  if (!sendConfirm.show) return null;

  const immediate = sendConfirm.type === 'immediate';
  const tone = immediate ? 'emerald' : 'blue';
  const excluded = (sendConfirm.unsubscribeCount || 0) + (sendConfirm.duplicateCount || 0);

  const scheduledAt = sendConfirm.dateTime
    ? new Date(sendConfirm.dateTime).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <ConfirmDialogShell
      show
      tone={tone}
      icon={immediate
        ? <Zap size={18} strokeWidth={2} className="text-white" />
        : <CalendarClock size={18} strokeWidth={1.9} className="text-white" />}
      title={immediate ? '지금 바로 발송합니다' : '예약 발송으로 등록합니다'}
      subtitle={immediate
        ? '누르는 즉시 발송 큐에 들어갑니다. 발송 후에는 회수할 수 없습니다.'
        : '지정한 시각에 자동으로 나갑니다.'}
      cancelLabel="취소"
      onCancel={() => setSendConfirm({ show: false, type: 'immediate', count: 0, unsubscribeCount: 0 })}
      confirmLabel={immediate ? '즉시 발송' : '예약 등록'}
      onConfirm={() => (sendConfirm.from === 'target' ? executeTargetSend() : executeDirectSend())}
      busy={directSending}
      busyLabel="접수 중..."
      confirmDisabled={sendConfirm.count <= 0}
    >
      <DialogHeadline
        label="발송 대상"
        value={sendConfirm.count}
        unit="명"
        tone={tone}
      />

      <div className="mt-3">
        <DialogRow label="메시지 유형" value={sendConfirm.msgType || 'SMS'} />
        {!immediate && scheduledAt && (
          <DialogRow label="예약 시각" value={scheduledAt} accent="blue" />
        )}
        {(sendConfirm.unsubscribeCount || 0) > 0 && (
          <DialogRow
            label="수신거부 제외"
            value={`${sendConfirm.unsubscribeCount.toLocaleString()}명`}
            accent="rose"
          />
        )}
        {(sendConfirm.duplicateCount || 0) > 0 && (
          <DialogRow
            label="중복 제외"
            value={`${(sendConfirm.duplicateCount || 0).toLocaleString()}명`}
            accent="amber"
          />
        )}
        {excluded > 0 && (
          <p className="pt-2.5 text-[11px] text-slate-400 leading-relaxed">
            제외된 {excluded.toLocaleString()}명은 발송·과금 대상이 아닙니다.
          </p>
        )}
      </div>

      {immediate ? (
        <DialogCaution tone="rose">
          발송이 시작되면 중간에 멈추거나 되돌릴 수 없습니다. 문구와 수신자를 다시 한번 확인해 주세요.
        </DialogCaution>
      ) : (
        <DialogCaution>
          예약 취소·문안 수정은 발송 <strong className="font-semibold">15분 전</strong>까지 가능합니다.
        </DialogCaution>
      )}
    </ConfirmDialogShell>
  );
}
