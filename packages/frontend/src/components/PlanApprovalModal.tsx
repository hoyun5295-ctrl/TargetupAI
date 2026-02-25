import { PartyPopper, Crown, X } from 'lucide-react';

interface PlanApprovalModalProps {
  show: boolean;
  planName: string;
  onClose: () => void;
}

export default function PlanApprovalModal({ show, planName, onClose }: PlanApprovalModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="relative p-6 bg-gradient-to-br from-emerald-50 to-green-50 text-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <PartyPopper className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-1">요금제가 승인되었습니다!</h3>
          <p className="text-sm text-gray-500">모든 기능을 이용하실 수 있습니다</p>
        </div>

        {/* 본문 */}
        <div className="p-6">
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <div className="flex items-start gap-3">
              <Crown className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-600 leading-relaxed">
                <span className="font-bold text-emerald-600">{planName}</span> 요금제가 활성화되었습니다.<br />
                AI 마케팅 자동화, 고객 인사이트 등<br />
                한줄로의 모든 기능을 이용해보세요!
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-bold transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
