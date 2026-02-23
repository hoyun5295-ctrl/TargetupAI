import React from 'react';

interface LineGroupErrorModalProps {
  show: boolean;
  onClose: () => void;
}

const LineGroupErrorModal: React.FC<LineGroupErrorModalProps> = ({ show, onClose }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div
        className="absolute inset-0 bg-black/50 animate-[fadeIn_0.2s_ease-out]"
        onClick={onClose}
      />

      {/* 모달 본체 */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 animate-[zoomIn_0.25s_ease-out] overflow-hidden">
        {/* 상단 경고 배너 */}
        <div className="bg-gradient-to-r from-red-500 to-orange-500 px-6 py-5 text-center">
          <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-white text-lg font-bold">발송 라인 미설정</h3>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5">
          <p className="text-gray-700 text-sm leading-relaxed text-center mb-4">
            현재 고객사에 <span className="font-semibold text-red-600">발송 라인그룹이 설정되어 있지 않아</span> 메시지를 발송할 수 없습니다.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-xs text-amber-800 leading-relaxed">
                <p className="font-semibold mb-1">해결 방법</p>
                <p>슈퍼관리자(INVITO)에게 연락하여 발송 라인그룹 배정을 요청해주세요.</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 text-center">
              📞 문의: <span className="font-medium text-gray-700">1800-8125</span>
            </p>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium text-sm transition-colors"
          >
            확인
          </button>
        </div>
      </div>

      {/* 애니메이션 */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default LineGroupErrorModal;
