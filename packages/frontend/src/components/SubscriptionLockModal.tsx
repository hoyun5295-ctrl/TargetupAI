import { Lock, Crown, X } from 'lucide-react';

interface SubscriptionLockModalProps {
  show: boolean;
  onClose: () => void;
}

export default function SubscriptionLockModal({ show, onClose }: SubscriptionLockModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="relative p-6 bg-gradient-to-br from-amber-50 to-orange-50 text-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-1">요금제 가입이 필요합니다</h3>
          <p className="text-sm text-gray-500">이 기능은 유료 요금제 전용입니다</p>
        </div>

        {/* 본문 */}
        <div className="p-6">
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <div className="flex items-start gap-3">
              <Crown className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-600 leading-relaxed">
                AI 마케팅 자동화, 고객 인사이트, 캘린더 등<br />
                <span className="font-medium text-gray-800">한줄로의 핵심 기능</span>을 이용하시려면<br />
                요금제에 가입해주세요.
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <a
              href="https://hanjul.ai/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-colors text-center"
            >
              요금제 안내 보기
            </a>
            <button
              onClick={onClose}
              className="w-full py-3 border border-gray-200 hover:bg-gray-50 rounded-xl text-sm font-medium text-gray-600 transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
