/**
 * NameEmptyWarningModal — D111 P2
 *
 * 직접발송/직접타겟발송 제출 시 메시지에 %이름%(또는 %고객명%/%성함%) 변수가 있는데
 * 수신자 목록에 이름이 비어있는 경우 경고를 표시.
 *
 * Harold님 지시: "사용자 한 번 더 클릭은 단점 아님 — 정확한 메시징 발송을 위한 당연한 조치"
 *
 * 재사용 원칙:
 *   - 직접발송(executeDirectSend) / 직접타겟발송(executeTargetSend) / 향후 다른 발송 경로에서도 사용
 *   - sendType으로 호출부 구분, onConfirm에 재호출 로직 주입
 *
 * ★ 2026-08-15 셸을 `shared/ConfirmDialogShell`로 교체(화이트 고급형 정합).
 *   판정·흐름은 무변경. 옛 화면의 `animate-in fade-in zoom-in`은 해당 플러그인이 없어
 *   실제로는 아무 효과도 없었다 — 셸이 자체 모션을 갖는다.
 */

import { UserX } from 'lucide-react';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';

interface NameEmptyWarningModalProps {
  show: boolean;
  emptyCount: number;
  totalCount: number;
  sendType?: 'direct' | 'target' | 'ai';
  onCancel: () => void;
  onConfirm: () => void;
  isSending?: boolean;
}

export default function NameEmptyWarningModal({
  show, emptyCount, totalCount, onCancel, onConfirm, isSending,
}: NameEmptyWarningModalProps) {
  if (!show) return null;

  const percentage = totalCount > 0 ? Math.round((emptyCount / totalCount) * 100) : 0;

  return (
    <ConfirmDialogShell
      show
      tone="amber"
      icon={<UserX size={18} strokeWidth={1.9} className="text-white" />}
      title="이름이 비어 있는 수신자가 있습니다"
      subtitle="문구에 이름 변수가 있어, 그대로 보내면 그 자리가 빈칸으로 나갑니다."
      z="z-[2200]"
      maxW="max-w-[460px]"
      cancelLabel="취소하고 수정"
      onCancel={onCancel}
      confirmLabel="그대로 발송"
      onConfirm={onConfirm}
      busy={!!isSending}
      busyLabel="접수 중..."
    >
      <DialogHeadline
        label="이름 없는 수신자"
        value={emptyCount}
        unit={`명 (전체 ${totalCount.toLocaleString()}명 중 ${percentage}%)`}
        tone="amber"
      />

      <div className="mt-3">
        <DialogRow label="발송 시 표시" value={<span className="font-normal text-slate-500">“님 안녕하세요”</span>} />
        <DialogRow label="정상 표시" value={<span className="font-normal text-slate-500">“홍길동님 안녕하세요”</span>} />
      </div>

      <DialogCaution>
        취소 후 수신자 목록에 이름을 채우거나, 이름 변수를 빼고 보내는 편을 권합니다.
      </DialogCaution>
    </ConfirmDialogShell>
  );
}
