import { Rocket, Sparkles } from 'lucide-react';
import { useState } from 'react';

interface AiSendTypeModalProps {
  onClose: () => void;
  onSelectHanjullo: (prompt: string) => void;
  onSelectCustom: () => void;
  initialPrompt?: string;
}

export default function AiSendTypeModal({ onClose, onSelectHanjullo, onSelectCustom, initialPrompt }: AiSendTypeModalProps) {
  const [selected, setSelected] = useState<'hanjullo' | 'custom' | null>(initialPrompt ? 'hanjullo' : null);
  const [prompt, setPrompt] = useState(initialPrompt || '');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">✨</span>
            <h3 className="text-lg font-bold text-gray-800">AI 발송 방식 선택</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl transition-colors">✕</button>
        </div>

        {/* 카드 영역 */}
        <div className="p-6">
          <p className="text-sm text-gray-500 mb-5">목적에 맞는 AI 발송 방식을 선택하세요.</p>

          <div className="grid grid-cols-2 gap-4">
            {/* AI 한줄로 카드 */}
            <button
              onClick={() => setSelected(selected === 'hanjullo' ? null : 'hanjullo')}
              className={`relative p-6 rounded-xl transition-all text-left h-[160px] flex flex-col justify-between ${
                selected === 'hanjullo'
                  ? 'bg-green-700 ring-2 ring-green-400 ring-offset-2 shadow-lg'
                  : 'bg-green-700 hover:bg-green-800 hover:shadow-lg'
              }`}
            >
              <div className="absolute -top-2 right-3 bg-white text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                AUTO
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Rocket className="w-5 h-5 text-green-200" />
                  <div className="text-lg font-bold text-white">AI 한줄로</div>
                </div>
                <div className="text-sm text-green-200 leading-relaxed">
                  자연어 한 줄이면 충분합니다.<br />
                  타겟부터 문안까지 AI가 자동 설계
                </div>
              </div>
              <div className="text-2xl text-green-300 self-end">→</div>
            </button>

            {/* AI 맞춤한줄 카드 */}
            <button
              onClick={() => {
                setSelected('custom');
                onSelectCustom();
              }}
              className="relative p-6 bg-violet-600 hover:bg-violet-700 rounded-xl transition-all hover:shadow-lg text-left h-[160px] flex flex-col justify-between"
            >
              <div className="absolute -top-2 right-3 bg-white text-violet-600 text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                PRO
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-violet-200" />
                  <div className="text-lg font-bold text-white">AI 맞춤한줄</div>
                </div>
                <div className="text-sm text-violet-200 leading-relaxed">
                  프로모션을 브리핑하면<br />
                  AI가 1:1 맞춤 문안을 생성
                </div>
              </div>
              <div className="text-2xl text-violet-300 self-end">→</div>
            </button>
          </div>

          {/* AI 한줄로 프롬프트 입력 확장 */}
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
            selected === 'hanjullo' ? 'max-h-[250px] opacity-100 mt-4' : 'max-h-0 opacity-0 mt-0'
          }`}>
            <div className="bg-green-50 rounded-xl border border-green-200 p-5">
              <div className="text-sm font-medium text-gray-700 mb-2">캠페인 내용을 한 줄로 입력하세요</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 전체고객 30%할인행사 2월27일~3월1일 개인화 필수: 고객명, 등급"
                className="w-full h-20 px-4 py-3 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white placeholder-gray-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) onSelectHanjullo(prompt.trim());
                  }
                }}
                autoFocus
              />
              <div className="flex items-center justify-between mt-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-gray-400">Enter로 바로 실행</span>
                  <span className="text-[11px] text-gray-400">💡 <span className="text-gray-500 font-medium">개인화 필수:</span> 뒤에 업로드된 필드명을 쓰면 맞춤 변수로 활용됩니다</span>
                </div>
                <button
                  onClick={() => { if (prompt.trim()) onSelectHanjullo(prompt.trim()); }}
                  disabled={!prompt.trim()}
                  className="px-5 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Rocket className="w-4 h-4" />
                  AI 한줄로 실행
                </button>
              </div>
            </div>
          </div>

          {/* 하단 안내 */}
          <div className="mt-5 flex items-start gap-2 text-xs text-gray-400">
            <span className="mt-0.5">💡</span>
            <span>
              <b className="text-gray-500">AI 한줄로</b> — 간단한 한 줄 지시로 타겟+문안 자동 설계 &nbsp;|&nbsp;
              <b className="text-gray-500">AI 맞춤한줄</b> — 프로모션 상세 브리핑으로 고객별 맞춤 문안 생성
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
