import { useNavigate } from 'react-router-dom';

interface PlanUpgradeModalProps {
  show: boolean;
  onClose: () => void;
}

export default function PlanUpgradeModal({ show, onClose }: PlanUpgradeModalProps) {
  const navigate = useNavigate();

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">요금제 업그레이드가 필요합니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            AI 문구 추천 기능은<br /><span className="font-semibold text-violet-600">베이직 이상</span> 요금제에서 사용 가능합니다.
          </p>
        </div>
        <div className="px-6 pb-6 pt-4 space-y-2">
          <button
            onClick={() => { onClose(); navigate('/pricing'); }}
            className="w-full bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white font-medium py-2.5 rounded-xl text-sm transition-all shadow-sm"
          >
            요금제 보기
          </button>
          <button
            onClick={onClose}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
