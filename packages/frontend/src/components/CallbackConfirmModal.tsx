/**
 * CallbackConfirmModal — 미등록 회신번호 제외 확인 모달
 *
 * 개별회신번호 사용 시 미등록 회신번호가 있으면 발송 전에 이 모달을 띄워
 * 어떤 번호가 몇 명 제외되는지 보여주고 사용자 확인을 받는다.
 *
 * CT-08(callback-filter.ts) → campaigns.ts → 프론트엔드 확인 흐름의 마지막 단계
 */

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
  /** 확인 후 실행할 발송 경로 식별자 */
  sendType: 'direct' | 'target' | 'ai' | 'aiCustom';
}

interface CallbackConfirmModalProps {
  data: CallbackConfirmData;
  onClose: () => void;
  onConfirm: () => void;
  isSending: boolean;
}

/** 전화번호 포맷팅 (01012345678 → 010-1234-5678, 0312345678 → 031-234-5678) */
function formatPhoneNumber(phone: string): string {
  if (!phone) return phone;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('02')) {
    // 서울 (02)
    if (cleaned.length === 9) return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 5)}-${cleaned.slice(5)}`;
    if (cleaned.length === 10) return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  return phone;
}

export type { CallbackConfirmData };

export default function CallbackConfirmModal({
  data, onClose, onConfirm, isSending
}: CallbackConfirmModalProps) {
  if (!data.show) return null;

  const totalExcluded = data.callbackMissingCount + data.callbackUnregisteredCount;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-amber-50">
          <h3 className="text-lg font-bold text-amber-700">
            ⚠️ 미등록 회신번호 제외 안내
          </h3>
        </div>

        {/* 본문 */}
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-gray-700 mb-4">
            아래 회신번호가 발신번호로 등록되지 않아 해당 고객이 발송 대상에서 제외됩니다.
          </p>

          {/* 미등록 회신번호 목록 */}
          {data.unregisteredDetails.length > 0 && (
            <div className="bg-rose-50 rounded-lg p-4 mb-4">
              <p className="text-sm font-semibold text-rose-700 mb-3">미등록 회신번호 목록</p>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {data.unregisteredDetails.map((detail, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-rose-200">
                    <span className="text-gray-700 font-mono text-sm">{formatPhoneNumber(detail.phone)}</span>
                    <span className="text-rose-600 font-bold text-sm">{detail.excludedCount.toLocaleString()}명 제외</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 회신번호 미보유 안내 */}
          {data.callbackMissingCount > 0 && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600 text-sm">회신번호 미보유 고객</span>
                <span className="text-gray-700 font-bold text-sm">{data.callbackMissingCount.toLocaleString()}명 제외</span>
              </div>
            </div>
          )}

          {/* 요약 */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">총 제외 인원</span>
              <span className="font-bold text-rose-600">{totalExcluded.toLocaleString()}명</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">실제 발송 대상</span>
              <span className="font-bold text-emerald-600">{data.remainingCount.toLocaleString()}명</span>
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-3">
            * 미등록 회신번호를 사용하려면 먼저 발신번호 관리에서 등록해주세요.
          </p>
        </div>

        {/* 하단 버튼 */}
        <div className="flex border-t">
          <button
            onClick={onClose}
            disabled={isSending}
            className="flex-1 py-3 text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isSending}
            className="flex-1 py-3 text-white font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50"
          >
            {isSending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span> 처리중...
              </span>
            ) : (
              `제외하고 발송 (${data.remainingCount.toLocaleString()}명)`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
