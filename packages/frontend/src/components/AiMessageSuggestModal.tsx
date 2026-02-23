import { Sparkles } from 'lucide-react';

interface AiMessageSuggestModalProps {
  show: boolean;
  onClose: () => void;
  aiHelperPrompt: string;
  setAiHelperPrompt: (v: string) => void;
  aiHelperLoading: boolean;
  aiHelperResults: any[];
  aiHelperRecommendation: string;
  onGenerate: () => void;
  onSelectMessage: (variant: any) => void;
  msgType: string;
}

export default function AiMessageSuggestModal({
  show, onClose, aiHelperPrompt, setAiHelperPrompt,
  aiHelperLoading, aiHelperResults, aiHelperRecommendation,
  onGenerate, onSelectMessage, msgType
}: AiMessageSuggestModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-blue-500 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">AI 문구 추천</h3>
              <p className="text-xs text-gray-400">어떤 내용의 메시지를 보낼지 알려주세요</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* 프롬프트 입력 */}
        <div className="px-6 pt-4 pb-3">
          <textarea
            value={aiHelperPrompt}
            onChange={(e) => setAiHelperPrompt(e.target.value)}
            placeholder="예) 봄 신상 입고 안내, VIP 고객 감사 이벤트, 설 연휴 배송 안내..."
            className="w-full h-20 px-4 py-3 border-2 border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition-all placeholder-gray-400"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onGenerate(); } }}
            autoFocus
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">채널: {msgType} · Enter로 생성</span>
            <button
              onClick={onGenerate}
              disabled={aiHelperLoading || !aiHelperPrompt.trim()}
              className="px-4 py-2 bg-gradient-to-r from-violet-500 to-blue-500 text-white text-sm font-medium rounded-xl hover:from-violet-600 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shadow-sm"
            >
              {aiHelperLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" /><path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" /></svg>
                  생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  문구 생성
                </>
              )}
            </button>
          </div>
        </div>

        {/* 결과 영역 */}
        {aiHelperResults.length > 0 && (
          <div className="px-6 pb-5 space-y-2.5 max-h-[50vh] overflow-y-auto">
            <p className="text-xs text-gray-500 font-medium">💡 원하는 문구를 선택하세요 (선택 후 자유 수정 가능)</p>
            {aiHelperResults.map((variant: any, idx: number) => {
              const msg = variant.message_text || (msgType === 'SMS' ? variant.sms_text : variant.lms_text) || '';
              const isRecommended = variant.variant_id === aiHelperRecommendation;
              return (
                <button
                  key={idx}
                  onClick={() => onSelectMessage(variant)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all hover:shadow-md hover:scale-[1.01] ${
                    isRecommended 
                      ? 'border-violet-300 bg-violet-50/50 hover:border-violet-400' 
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      isRecommended ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {variant.variant_name || `${String.fromCharCode(65 + idx)}안`}
                    </span>
                    {isRecommended && (
                      <span className="text-xs bg-gradient-to-r from-violet-500 to-blue-500 text-white px-2 py-0.5 rounded-full font-medium">✨ 추천</span>
                    )}
                    {variant.score && (
                      <span className="text-xs text-gray-400 ml-auto">{variant.score}점</span>
                    )}
                  </div>
                  {variant.concept && (
                    <p className="text-xs text-gray-500 mb-1.5">{variant.concept}</p>
                  )}
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{msg}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {aiHelperLoading && (
          <div className="px-6 pb-5 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-xl border-2 border-gray-100 bg-gray-50 animate-pulse">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-5 bg-gray-200 rounded-full" />
                  <div className="w-20 h-4 bg-gray-200 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-full" />
                  <div className="h-3 bg-gray-200 rounded w-4/5" />
                  <div className="h-3 bg-gray-200 rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
