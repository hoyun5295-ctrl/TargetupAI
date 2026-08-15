/**
 * CallbackConfirmModal — 미등록 회신번호 제외 확인
 *
 * 개별회신번호 사용 시 미등록 회신번호가 있으면 발송 전에 이 창을 띄워
 * 어떤 번호가 몇 명 제외되는지 보여주고 사용자 확인을 받는다.
 * CT-08(callback-filter.ts) → campaigns.ts → 프론트엔드 확인 흐름의 마지막 단계.
 *
 * ★ 2026-08-15 셸을 `shared/ConfirmDialogShell`로 교체(화이트 고급형 정합).
 *   판정·흐름은 무변경 — 바뀐 것은 표현뿐이다.
 */

import { PhoneOff } from 'lucide-react';
import { formatPhoneNumber } from '../utils/formatDate';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';

interface UnregisteredDetail {
  phone: string;
  excludedCount: number;
}

interface CallbackConfirmData {
  show: boolean;
  callbackMissingCount: number;
  callbackUnregisteredCount: number;
  unregisteredDetails: UnregisteredDetail[];
  remainingCount: number;
  message: string;
  /** 확인 후 실행할 발송 경로 식별자 — 'auto'는 D123 P11 자동발송 생성 경로 */
  sendType: 'direct' | 'target' | 'ai' | 'aiCustom' | 'auto';
}

interface CallbackConfirmModalProps {
  data: CallbackConfirmData;
  onClose: () => void;
  onConfirm: () => void;
  isSending: boolean;
}

export type { CallbackConfirmData };

export default function CallbackConfirmModal({
  data, onClose, onConfirm, isSending,
}: CallbackConfirmModalProps) {
  if (!data.show) return null;

  const totalExcluded = data.callbackMissingCount + data.callbackUnregisteredCount;
  const blocked = data.remainingCount === 0;
  const isAuto = data.sendType === 'auto';

  return (
    <ConfirmDialogShell
      show
      tone={blocked ? 'rose' : 'amber'}
      icon={<PhoneOff size={18} strokeWidth={1.9} className="text-white" />}
      title={blocked ? '발송할 수 있는 대상이 없습니다' : '일부 수신자가 제외됩니다'}
      subtitle="회신번호가 발신번호로 등록되지 않은 고객은 발송 대상에서 빠집니다."
      z="z-[2200]"
      maxW="max-w-[500px]"
      cancelLabel={blocked ? '확인' : '취소'}
      onCancel={onClose}
      confirmLabel={blocked ? undefined : (isAuto
        ? `제외하고 생성 (${data.remainingCount.toLocaleString()}명)`
        : `제외하고 발송 (${data.remainingCount.toLocaleString()}명)`)}
      onConfirm={blocked ? undefined : onConfirm}
      busy={isSending}
      busyLabel={isAuto ? '생성 중...' : '접수 중...'}
    >
      <DialogHeadline
        label={isAuto ? '생성 대상' : '실제 발송 대상'}
        value={data.remainingCount}
        unit="명"
        tone={blocked ? 'rose' : 'emerald'}
      />

      <div className="mt-3">
        <DialogRow label="총 제외 인원" value={`${totalExcluded.toLocaleString()}명`} accent="rose" />
        {data.callbackMissingCount > 0 && (
          <DialogRow label="회신번호 미보유" value={`${data.callbackMissingCount.toLocaleString()}명`} />
        )}
        {data.callbackUnregisteredCount > 0 && (
          <DialogRow label="미등록 번호 사용" value={`${data.callbackUnregisteredCount.toLocaleString()}명`} />
        )}
      </div>

      {data.unregisteredDetails.length > 0 && (
        <div className="mt-4">
          <p className="text-[11.5px] text-slate-400 mb-2">미등록 회신번호</p>
          <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-900/5 divide-y divide-slate-100 max-h-[200px] overflow-y-auto">
            {data.unregisteredDetails.map((detail, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="font-mono text-[12.5px] text-slate-700">{formatPhoneNumber(detail.phone)}</span>
                <span className="text-[12px] font-semibold text-rose-500 tabular-nums shrink-0">
                  {detail.excludedCount.toLocaleString()}명 제외
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DialogCaution tone={blocked ? 'rose' : 'amber'}>
        {blocked
          ? '전체 수신자가 미등록 회신번호로 제외됐습니다. 발신번호 관리에서 해당 번호를 등록한 뒤 다시 시도해 주세요.'
          : '이 번호들을 계속 쓰려면 발신번호 관리에서 먼저 등록해 주세요.'}
      </DialogCaution>
    </ConfirmDialogShell>
  );
}
