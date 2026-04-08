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
 */
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-5 bg-gradient-to-r from-amber-50 to-orange-50 border-b flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-lg">이름 정보가 없는 수신자가 있습니다</h3>
            <p className="text-xs text-gray-500">정확한 발송을 위해 한 번 더 확인해주세요</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-amber-700">{emptyCount.toLocaleString()}</span>
              <span className="text-sm text-amber-800">명 / 전체 {totalCount.toLocaleString()}명</span>
              <span className="ml-auto text-sm font-semibold text-amber-700">({percentage}%)</span>
            </div>
            <p className="text-xs text-amber-700 mt-2">
              메시지에 <code className="bg-amber-100 px-1 rounded">%이름%</code> 변수가 있지만, 위 수신자들은 이름 정보가 비어있습니다.
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2">
            <div className="font-semibold text-gray-800">⚠️ 그대로 발송하면:</div>
            <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
              <li>이름 비어있는 수신자에게는 <code className="bg-white px-1 rounded border">%이름%</code> 자리가 <b>공백</b>으로 발송됩니다.</li>
              <li>예시: "<span className="text-gray-400">(공백)</span>님 안녕하세요" → "님 안녕하세요"</li>
            </ul>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
            <div className="font-semibold mb-1">✅ 권장 사항</div>
            <p className="text-xs">
              취소 후 엑셀 파일에 이름 컬럼을 추가하거나, 수신자 목록에서 이름을 채워넣는 것을 권장드립니다.
            </p>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isSending}
            className="px-5 py-2.5 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            취소하고 수정
          </button>
          <button
            onClick={onConfirm}
            disabled={isSending}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isSending ? '발송 중...' : '그대로 발송'}
          </button>
        </div>
      </div>
    </div>
  );
}
