/**
 * AI 인라인 다듬기 모달 (D152+)
 *
 * 직접발송 화면에서 작성 중인 메시지를 AI에게 맡겨 톤/길이/이모지/스팸회피를
 * 자동 정리한 안 3~5개를 받아 선택 적용.
 *
 * 요금제 게이팅: BASIC(35만원/월) 이상 + TRIAL 자동 (CT-17 ai_messaging_enabled).
 * 변수 치환(`%이름%`, `%등급%` 등)은 AI가 자리 보존하도록 시스템 프롬프트에 박힘.
 *
 * 디자인 패턴:
 *   - emerald 톤 (AI 영역 일관성, D145 AI 가이드 페이지 미러)
 *   - animate-in fade-in zoom-in 등장
 *   - 헤더 / 원본 카드 / 톤 4선택 / CTA / 결과 3~5개 / 푸터 5섹션
 */

import { useState } from 'react';
import { X, Sparkles, ArrowRight, Loader2, RotateCcw } from 'lucide-react';

type Tone = 'friendly' | 'formal' | 'urgent' | 'warm';

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
  { value: 'friendly', label: '친근',   emoji: '😊', desc: '편안하고 가까운 톤' },
  { value: 'formal',   label: '공식',   emoji: '🏢', desc: '정중하고 신뢰감 있는 톤' },
  { value: 'urgent',   label: '긴급',   emoji: '⚡', desc: '주목 끄는 긴박한 톤' },
  { value: 'warm',     label: '따뜻함', emoji: '🤝', desc: '진심 어린 감성 톤' },
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
  const [tone, setTone] = useState<Tone>('friendly');
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
      if (!res.ok || !data.success) {
        if (res.status === 403) {
          throw new Error(data?.error || 'AI 다듬기는 베이직 요금제(35만원/월) 이상에서 이용 가능합니다');
        }
        throw new Error(data?.error || 'AI 다듬기에 실패했습니다');
      }
      setCandidates(data.candidates || []);
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
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[70] animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-emerald-50 via-emerald-50/50 to-white flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-200">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.25} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">AI 문안 다듬기</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">톤 · 길이 · 이모지 · 스팸 회피를 한 번에</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* 원본 메시지 카드 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">원본 메시지</label>
              <span className="text-[10px] text-gray-400 font-mono">
                {originalMessage.length}자
              </span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap break-words min-h-[64px]">
              {originalMessage.trim()
                ? originalMessage
                : <span className="text-gray-300">메시지를 먼저 입력해주세요</span>}
            </div>
          </div>

          {/* 톤 선택 4개 */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 block">톤 선택</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TONES.map((t) => {
                const active = tone === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={loading}
                    onClick={() => setTone(t.value)}
                    className={`relative px-3 py-3 rounded-xl border-2 text-left transition-all ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="text-xl mb-1 leading-none">{t.emoji}</div>
                    <div className="text-sm font-semibold text-gray-900">{t.label}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{t.desc}</div>
                    {active && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* CTA — 결과 없고 로딩 아닐 때 */}
          {candidates.length === 0 && !loading && !error && (
            <button
              type="button"
              onClick={handleRefine}
              disabled={!originalMessage.trim()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold shadow-md hover:shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Sparkles className="w-5 h-5" strokeWidth={2.25} />
              <span>AI 다듬기 시작</span>
            </button>
          )}

          {/* 로딩 */}
          {loading && (
            <div className="py-10 flex flex-col items-center gap-3">
              <Loader2 className="w-9 h-9 text-emerald-500 animate-spin" strokeWidth={2.5} />
              <p className="text-sm text-gray-700 font-medium">AI가 메시지를 다듬는 중...</p>
              <p className="text-[11px] text-gray-400">보통 2~4초 소요됩니다</p>
            </div>
          )}

          {/* 에러 */}
          {error && !loading && (
            <div>
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 leading-relaxed">
                {error}
              </div>
              <button
                type="button"
                onClick={reset}
                className="mt-3 w-full py-2.5 rounded-xl border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 font-medium transition-colors"
              >
                다시 시도
              </button>
            </div>
          )}

          {/* 결과 카드 */}
          {candidates.length > 0 && !loading && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  AI 다듬은 안 ({candidates.length}개)
                </label>
                <button
                  type="button"
                  onClick={handleRefine}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                  다시 다듬기
                </button>
              </div>
              <div className="space-y-2.5">
                {candidates.map((c, i) => (
                  <div
                    key={i}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleApply(c.text)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleApply(c.text); }}
                    className="group relative p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/30 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-emerald-100 group-hover:bg-emerald-200 flex items-center justify-center text-[11px] font-bold text-emerald-700 transition-colors">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">
                          {c.text}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            c.type === 'SMS' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {c.type}
                          </span>
                          <span className="text-[11px] text-gray-500 font-mono">{c.bytes}B</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity self-center">
                        <div className="px-3 py-1.5 rounded-lg bg-emerald-500 group-hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1 shadow-sm">
                          적용
                          <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400 text-center">
                카드 클릭 시 본문에 즉시 적용됩니다
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-center text-[11px] text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="font-mono text-gray-600">%이름%</span> 등 변수 자리 보존
          </span>
        </div>
      </div>
    </div>
  );
}
