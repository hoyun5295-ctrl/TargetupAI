import { useNavigate } from 'react-router-dom';

interface PlanLimitModalProps {
  show: boolean;
  onClose: () => void;
  planLimitInfo: {
    planName: string;
    maxCustomers: number;
    currentCount: number;
    requestedCount: number;
    availableCount: number;
  } | null;
}

export default function PlanLimitModal({ show, onClose, planLimitInfo }: PlanLimitModalProps) {
  const navigate = useNavigate();

  if (!show || !planLimitInfo) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 bg-gradient-to-r from-red-50 to-orange-50 border-b">
          <div className="text-center">
            <div className="text-5xl mb-3">⚠️</div>
            <h3 className="text-xl font-bold text-gray-800">고객 DB 한도 초과</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">현재 플랜</span>
              <span className="font-semibold text-gray-800">{planLimitInfo.planName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">최대 고객 수</span>
              <span className="font-semibold text-gray-800">{Number(planLimitInfo.maxCustomers).toLocaleString()}명</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">현재 고객 수</span>
              <span className="font-semibold text-blue-600">{Number(planLimitInfo.currentCount).toLocaleString()}명</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">업로드 시도</span>
              <span className="font-semibold text-orange-600">+{Number(planLimitInfo.requestedCount).toLocaleString()}명</span>
            </div>
            <div className="border-t pt-3 flex justify-between">
              <span className="text-gray-600">추가 가능</span>
              <span className="font-bold text-red-600">{Number(planLimitInfo.availableCount).toLocaleString()}명</span>
            </div>
          </div>
          <p className="text-sm text-gray-600 text-center mb-4">
            플랜을 업그레이드하시면 더 많은 고객을 관리할 수 있습니다.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              닫기
            </button>
            <button
              onClick={() => {
                onClose();
                navigate('/pricing');
              }}
              className="flex-1 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800"
            >
              요금제 안내
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
