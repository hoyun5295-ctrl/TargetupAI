import { Rocket, Sparkles, X, ArrowRight, Lightbulb } from 'lucide-react';
import { useState } from 'react';

interface AiSendTypeModalProps {
  onClose: () => void;
  // D171 영구 룰: autoRelax 인자 사용 X — 타겟 자동완화 절대 금지. memory/feedback_no_target_auto_relax.md
  onSelectHanjullo: (prompt: string) => void;
  onSelectCustom: () => void;
  initialPrompt?: string;
}

export default function AiSendTypeModal({
  onClose, onSelectHanjullo, onSelectCustom, initialPrompt,
}: AiSendTypeModalProps) {
  const [selected, setSelected] = useState<'hanjullo' | 'custom' | null>(initialPrompt ? 'hanjullo' : null);
  const [prompt, setPrompt] = useState(initialPrompt || '');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-[680px] overflow-hidden animate-in fade-in zoom-in duration-200 max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* 헤더 — sticky + 그라데이션 + Sparkles 아이콘 */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-bold text-lg">AI 발송 방식 선택</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-400/30 rounded">BETA</span>
              </div>
              <div className="text-xs text-white/50 mt-0.5">목적에 맞는 방식을 선택하세요</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 카드 영역 */}
        <div className="p-6">
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">

            {/* AI 한줄로 카드 — emerald 액센트 (AUTO) */}
            <button
              onClick={() => setSelected(selected === 'hanjullo' ? null : 'hanjullo')}
              className={`relative p-6 rounded-xl transition-all text-left h-[160px] flex flex-col justify-between ${
                selected === 'hanjullo'
                  ? 'bg-gradient-to-br from-emerald-500/30 to-teal-500/20 border-2 border-emerald-400/60 shadow-lg shadow-emerald-500/30'
                  : 'bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-400/30 hover:from-emerald-500/25 hover:to-teal-500/15 hover:border-emerald-400/50 hover:shadow-lg hover:shadow-emerald-500/20'
              }`}
            >
              <div className="absolute -top-2 right-3 bg-emerald-500/30 text-emerald-200 border border-emerald-400/40 text-[10px] font-bold px-2 py-0.5 rounded-full">
                AUTO
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Rocket className="w-5 h-5 text-emerald-300" />
                  <div className="text-lg font-bold text-white">AI 한줄로</div>
                </div>
                <div className="text-sm text-emerald-200/90 leading-relaxed">
                  자연어 한 줄이면 충분합니다.<br />
                  타겟부터 문안까지 AI가 자동 설계
                </div>
              </div>
              <div className="self-end">
                <ArrowRight className="w-5 h-5 text-emerald-300" />
              </div>
            </button>

            {/* AI 맞춤한줄 카드 — violet 액센트 (PRO) */}
            <button
              onClick={() => {
                setSelected('custom');
                onSelectCustom();
              }}
              className="relative p-6 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 border border-violet-400/30 hover:from-violet-500/25 hover:to-fuchsia-500/15 hover:border-violet-400/50 hover:shadow-lg hover:shadow-violet-500/20 rounded-xl transition-all text-left h-[160px] flex flex-col justify-between"
            >
              <div className="absolute -top-2 right-3 bg-violet-500/30 text-violet-200 border border-violet-400/40 text-[10px] font-bold px-2 py-0.5 rounded-full">
                PRO
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-violet-300" />
                  <div className="text-lg font-bold text-white">AI 맞춤한줄</div>
                </div>
                <div className="text-sm text-violet-200/90 leading-relaxed">
                  프로모션을 브리핑하면<br />
                  AI가 1:1 맞춤 문안을 생성
                </div>
              </div>
              <div className="self-end">
                <ArrowRight className="w-5 h-5 text-violet-300" />
              </div>
            </button>
          </div>

          {/* AI 한줄로 프롬프트 입력 확장 */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              selected === 'hanjullo' ? 'max-h-[280px] opacity-100 mt-4' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <div className="bg-emerald-500/5 border border-emerald-400/20 rounded-xl p-5">
              <div className="text-sm font-medium text-white/90 mb-2">캠페인 내용을 한 줄로 입력하세요</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 전체고객 30%할인행사 2월27일~3월1일 개인화 필수: 고객명, 등급"
                className="w-full h-20 px-4 py-3 bg-white/5 border border-white/15 rounded-lg text-sm text-white resize-none focus:outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder-white/30"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (prompt.trim()) onSelectHanjullo(prompt.trim());
                  }
                }}
                autoFocus
              />
              <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs text-white/40">Enter로 바로 실행</span>
                  <span className="text-[11px] text-white/40 flex items-center gap-1">
                    <Lightbulb className="w-2.5 h-2.5 text-amber-300 shrink-0" />
                    <span className="text-white/60 font-medium">개인화 필수:</span> 뒤에 업로드된 필드명을 쓰면 맞춤 변수로 활용됩니다
                  </span>
                </div>
                <button
                  onClick={() => { if (prompt.trim()) onSelectHanjullo(prompt.trim()); }}
                  disabled={!prompt.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-medium rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-emerald-500/30 shrink-0"
                >
                  <Rocket className="w-4 h-4" />
                  AI 한줄로 실행
                </button>
              </div>
            </div>
          </div>

          {/* 하단 안내 */}
          <div className="mt-5 flex items-start gap-2 text-xs text-white/40">
            <Lightbulb className="w-3 h-3 text-amber-300 mt-0.5 shrink-0" />
            <span>
              <b className="text-white/60">AI 한줄로</b> — 간단한 한 줄 지시로 타겟+문안 자동 설계 &nbsp;|&nbsp;
              <b className="text-white/60">AI 맞춤한줄</b> — 프로모션 상세 브리핑으로 고객별 맞춤 문안 생성
            </span>
          </div>

          <div className="text-[10px] text-white/30 italic mt-3 text-center">
            Data source — AI 발송 흐름 (자율 진단 + customer-filter)
          </div>
        </div>
      </div>
    </div>
  );
}
