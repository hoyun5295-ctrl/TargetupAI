/**
 * AI 인라인 다듬기 모달 (D152+ → D219+ Phase 0 다크 톤 정정)
 *
 * 직접발송 화면에서 작성 중인 메시지를 AI에게 맡겨 톤/길이/이모지/스팸회피를
 * 자동 정리한 안 3~5개를 받아 선택 적용.
 *
 * 요금제 게이팅: BASIC(35만원/월) 이상 + TRIAL 자동 (CT-17 ai_messaging_enabled).
 * 변수 치환(`%이름%`, `%등급%` 등)은 AI가 자리 보존하도록 시스템 프롬프트에 정합.
 *
 * D219+ 정정 (Harold 명시 2026-05-26):
 *   - 흰 톤 + emerald → 다크 톤 (bg-slate-900) + violet 액센트
 *   - 강조 부분 bg-emerald-100 → bg-violet-500/30 + violet 형광 표시
 *   - 첨부 캡처 본보기 정합 (3 column 레이아웃 + 톤 선택 2 카드 + 적용 → 버튼 + LMS 바이트 배지)
 *   - 모든 AI 호출 위치 일관성 (Dashboard / DirectSendPanel / JourneysPage / DmBuilderPage / InAppMessagesPage / AiOperatorPage / PricingPage)
 *
 * 영구 룰 정합:
 *   - design_quality_minimum_journey_level (다크 톤 + violet 액센트 + Source caption + 모바일 반응형)
 *   - no_native_browser_dialog (ConfirmModal + useToast)
 *   - no_model_name_ui_exposure (AI 모델명 노출 0건)
 */

import { useState, useMemo } from 'react';
import { X, Sparkles, ArrowRight, Loader2, RotateCcw } from 'lucide-react';
// ★ 2026-08-08 — Before/After 하이라이트(글자 단위 LCS)는 CT가 소유한다. 여정 다듬기도 같은 것을 쓴다.
import { highlightAdditions } from '../utils/text-diff';

// 톤 분류 — D152+ Harold 명시 8→2 컨셉 축소 (풍성화 본질이 핵심)
//   ① seasonal — 시즌/월별 감성 자연 반영
//   ② trendy   — 최신 트렌드 감성 카피
type Tone = 'seasonal' | 'trendy';

interface RefineCandidate {
  text: string;
  bytes: number;
  type: 'SMS' | 'LMS';
}

interface Props {
  isOpen: boolean;
  originalMessage: string;
  companyName?: string;
  onClose: () => void;
  onApply: (text: string) => void;
}

const TONES: { value: Tone; label: string; emoji: string; desc: string }[] = [
  { value: 'seasonal', label: '시즌 풍성',   emoji: '🌸', desc: '계절/월별 감성 자연 반영' },
  { value: 'trendy',   label: '최신 트렌드', emoji: '✨', desc: 'MZ 감성 + 트렌디 카피' },
];

function getToken() {
  return localStorage.getItem('token') || '';
}

export default function AiRefineModal({
  isOpen,
  originalMessage,
  companyName,
  onClose,
  onApply,
}: Props) {
  const [tone, setTone] = useState<Tone>('seasonal');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<RefineCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRefine = async () => {
    setLoading(true);
    setError(null);
    setCandidates([]);
    try {
      const res = await fetch('/api/ai/refine-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ message: originalMessage, tone, companyName }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error(data?.error || 'AI 다듬기는 스타터 요금제 이상에서 이용 가능합니다');
        }
        throw new Error(data?.error || 'AI 다듬기에 실패했습니다');
      }
      // 0건 fallback — Backend 후처리 검증 후 결과 0건이면 success:false + 친화 에러 (200)
      if (!data.success) {
        throw new Error(data?.error || 'AI가 다듬은 안을 생성하지 못했습니다. 다시 시도해 주세요.');
      }
      const incoming: RefineCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
      if (incoming.length === 0) {
        throw new Error('AI 결과가 비어있습니다. 다시 시도해 주세요.');
      }
      setCandidates(incoming);
    } catch (e: any) {
      setError(e?.message || 'AI 다듬기 중 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (text: string) => {
    onApply(text);
    onClose();
  };

  const reset = () => {
    setCandidates([]);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[2000] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      {/* 3 column 레이아웃 (좌 원본 / 가운데 ▶ + CTA + 톤 선택 / 우 결과). 모바일은 1단 (lg: 분기). */}
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* 헤더 — 그라데이션 + violet 액센트 */}
        <div className="px-6 py-4 border-b border-white/10 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/15 to-purple-500/15 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/40">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.25} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight flex items-center gap-2">
                AI 문안 다듬기
              </h2>
              <p className="text-[11px] text-white/50 mt-0.5">톤 · 길이 · 이모지 · 스팸 회피를 한 번에</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Body — 3 column (좌: 원본 / 가운데: ▶+CTA+톤 선택 / 우: 결과). 모바일 1단. */}
        <div className="overflow-y-auto flex-1 p-6 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-5 lg:gap-4 items-start">
          {/* 좌측 — 원본 메시지 */}
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">원본 메시지</label>
                <span className="text-[10px] text-white/30 font-mono">
                  {originalMessage.length}자
                </span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white/85 whitespace-pre-wrap break-words min-h-[64px]">
                {originalMessage.trim()
                  ? originalMessage
                  : <span className="text-white/30">메시지를 먼저 입력해주세요</span>}
              </div>
            </div>
          </div>

          {/* 가운데 — ▶ + CTA/로딩/다시 다듬기 + (아래) 톤 선택 세로 */}
          <div className="flex lg:flex-col items-center justify-start gap-3 lg:gap-6 lg:pt-8 lg:px-2 lg:min-w-[180px]">
            <ArrowRight className="hidden lg:block w-12 h-12 text-violet-400" strokeWidth={2.5} />
            <ArrowRight className="block lg:hidden w-8 h-8 text-violet-300 rotate-90" strokeWidth={2.5} />

            {/* CTA — 결과 없고 로딩 아닐 때 */}
            {candidates.length === 0 && !loading && !error && (
              <button
                type="button"
                onClick={handleRefine}
                disabled={!originalMessage.trim()}
                className="w-full lg:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white text-sm font-semibold shadow-lg hover:shadow-xl shadow-violet-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" strokeWidth={2.25} />
                <span>다듬기 시작</span>
              </button>
            )}

            {/* 로딩 */}
            {loading && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-9 h-9 text-violet-400 animate-spin" strokeWidth={2.5} />
                <p className="text-[11px] text-white/60 text-center leading-tight whitespace-nowrap">다듬는 중...</p>
              </div>
            )}

            {/* 다시 다듬기 (결과 있을 때) */}
            {candidates.length > 0 && !loading && (
              <button
                type="button"
                onClick={handleRefine}
                className="px-3 py-2 rounded-lg border border-violet-400/40 hover:bg-violet-500/10 text-xs text-violet-200 font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                다시 다듬기
              </button>
            )}

            {/* 톤 선택 — 다듬기 시작 아래 세로 배치 */}
            <div className="w-full mt-4 lg:mt-12">
              <label className="text-[10px] font-semibold text-white/50 uppercase tracking-wider mb-2 block text-center">톤 선택</label>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                {TONES.map((t) => {
                  const active = tone === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={loading}
                      onClick={() => setTone(t.value)}
                      className={`relative px-2.5 py-2.5 rounded-xl border-2 text-left transition-all ${
                        active
                          ? 'border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/20'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-lg leading-none flex-shrink-0">{t.emoji}</div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-semibold leading-tight ${active ? 'text-violet-100' : 'text-white/90'}`}>{t.label}</div>
                          <div className={`text-[10px] mt-0.5 leading-tight truncate ${active ? 'text-violet-200/80' : 'text-white/50'}`}>{t.desc}</div>
                        </div>
                      </div>
                      {active && (
                        <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full bg-violet-500 flex items-center justify-center shadow-sm">
                          <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 우측 — 결과 / 에러 / placeholder */}
          <div className="space-y-3">
            <label className="text-[11px] font-semibold text-white/50 uppercase tracking-wider block">
              AI 다듬은 안
            </label>

            {/* Placeholder — 다듬기 전 */}
            {candidates.length === 0 && !loading && !error && (
              <div className="border-2 border-dashed border-white/10 rounded-xl p-6 min-h-[200px] flex items-center justify-center text-center bg-white/[0.02]">
                <p className="text-xs text-white/40 leading-relaxed">
                  가운데 <span className="text-violet-300 font-semibold">다듬기 시작</span> 버튼을 누르면<br />
                  여기에 AI가 풍성하게 다듬은 결과가 표시됩니다
                </p>
              </div>
            )}

            {/* 에러 */}
            {error && !loading && (
              <div>
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-400/30 text-sm text-rose-100 leading-relaxed">
                  {error}
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-3 w-full py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-sm text-white/80 font-medium transition-colors"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 결과 카드 */}
            {candidates.length > 0 && !loading && (
              <div>
                <div className="space-y-2.5">
                  {candidates.map((c, i) => (
                    <ResultCard
                      key={i}
                      index={i}
                      candidate={c}
                      originalMessage={originalMessage}
                      onApply={handleApply}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-white/50 text-center leading-relaxed">
                  <span className="bg-violet-500/30 text-violet-100 font-semibold rounded px-1">강조된 부분</span>이 AI가 풍성하게 다듬은 표현입니다 · 안을 클릭하면 본문에 즉시 적용됩니다
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — 다크 톤 정합 */}
        <div className="px-6 py-3 border-t border-white/10 bg-slate-950/50 flex flex-col items-center gap-1 text-[11px] text-white/50 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="font-mono text-white/70">%이름%</span> 등 변수 자리 보존 · (광고) 표기 자동 정합
          </span>
          <span className="text-amber-300 font-medium">AI 결과는 참고용 · 발송 전 반드시 미리보기로 확인하세요</span>
          <div className="text-[10px] text-white/30 italic mt-1">
            Data source: AI 문안 다듬기 (회사 30일 발송 패턴 학습 + 톤 자동 반영)
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 결과 카드 — Before/After 하이라이트 적용 (D152-6 → D219+ violet 변환).
 *   원본 대비 추가/변경된 어절을 violet 강조로 표시.
 *   사용자가 한 화면에서 "어떻게 풍성해졌는지" 즉시 체감 → AI 체험 가치 명확.
 */
function ResultCard({
  index,
  candidate,
  originalMessage,
  onApply,
}: {
  index: number;
  candidate: { text: string; bytes: number; type: 'SMS' | 'LMS' };
  originalMessage: string;
  onApply: (text: string) => void;
}) {
  const parts = useMemo(
    () => highlightAdditions(originalMessage, candidate.text),
    [originalMessage, candidate.text],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onApply(candidate.text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onApply(candidate.text);
      }}
      className="group relative p-4 rounded-xl border-2 border-white/10 hover:border-violet-400/60 hover:bg-violet-500/5 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white/[0.02]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-violet-500/20 group-hover:bg-violet-500/40 flex items-center justify-center text-[11px] font-bold text-violet-200 transition-colors">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/90 whitespace-pre-wrap break-words leading-relaxed">
            {parts.map((p, idx) =>
              p.added ? (
                <span
                  key={idx}
                  className="bg-violet-500/30 text-violet-50 font-semibold rounded px-0.5"
                >
                  {p.text}
                </span>
              ) : (
                <span key={idx}>{p.text}</span>
              ),
            )}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                candidate.type === 'SMS'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'bg-amber-500/20 text-amber-200'
              }`}
            >
              {candidate.type}
            </span>
            <span className="text-[11px] text-white/50 font-mono">
              {candidate.bytes}B
            </span>
          </div>
        </div>
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-center">
          <div className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 group-hover:from-violet-600 group-hover:to-fuchsia-600 text-white text-xs font-semibold flex items-center gap-1 shadow-lg shadow-violet-500/30">
            적용
            <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
          </div>
        </div>
      </div>
    </div>
  );
}
