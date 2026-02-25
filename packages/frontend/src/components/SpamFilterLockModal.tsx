import { Crown, ShieldOff, X } from 'lucide-react';

interface SpamFilterLockModalProps {
  show: boolean;
  onClose: () => void;
}

export default function SpamFilterLockModal({ show, onClose }: SpamFilterLockModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="relative p-6 bg-gradient-to-br from-indigo-50 to-blue-50 text-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldOff className="w-8 h-8 text-indigo-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-1">스팸필터 테스트</h3>
          <p className="text-sm text-gray-500">프로 요금제 이상에서 이용 가능합니다</p>
        </div>

        {/* 본문 */}
        <div className="p-6">
          <div className="bg-gray-50 rounded-xl p-4 mb-5">
            <div className="flex items-start gap-3">
              <Crown className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-gray-600 leading-relaxed">
                스팸필터 테스트는 SKT·KT·LG U+ 3사의<br />
                <span className="font-medium text-gray-800">실제 스팸 차단 여부</span>를 확인하는 기능으로<br />
                <span className="font-medium text-indigo-600">프로 요금제(15만원/월)</span> 이상 이용 가능합니다.
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            <a
              href="https://hanjul.ai/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold transition-colors text-center"
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
