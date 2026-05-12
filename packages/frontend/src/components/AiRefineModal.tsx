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

import { useState, useMemo } from 'react';
import { X, Sparkles, ArrowRight, Loader2, RotateCcw } from 'lucide-react';

/**
 * ★ D152-6 (2026-05-12) Before/After 하이라이트 — Harold님 지시:
 *   "지금은 뭐가 바꼈는지 올라갔다 내려갔다 확인해야하잖아"
 *   결과 카드에 원본 대비 추가된 부분 emerald 강조 → 사용자가 한 화면에서 즉시 체감.
 *   외부 의존성 없이 어절 단위 LCS(Longest Common Subsequence)로 자체 구현.
 */
function highlightAdditions(
  original: string,
  modified: string,
): Array<{ text: string; added: boolean }> {
  // ★ D152-6 정정3 (2026-05-12 Harold님 명시): "20분전" vs "20분 전" 같이 어절 자체가 공백으로 분리되는 케이스
  //   기존 어절 단위 LCS는 "20분전" 한 어절이 "20분 전" 두 어절과 매칭 X → 전체가 added로 잘못 강조.
  //   글자 단위 LCS로 변경 — 정확도 100%. 공백/구두점만 변경된 경우 공백 자체만 added(거의 안 보임), 진짜 추가된 어절만 강조.
  const m = original.length;
  const n = modified.length;

  // Int32Array 메모리 절약 (긴 LMS 1000자도 ~4MB 안전)
  const width = n + 1;
  const dp = new Int32Array((m + 1) * width);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cur = i * width + j;
      if (original.charCodeAt(i - 1) === modified.charCodeAt(j - 1)) {
        dp[cur] = dp[cur - width - 1] + 1;
      } else {
        const a = dp[cur - width];
        const b = dp[cur - 1];
        dp[cur] = a > b ? a : b;
      }
    }
  }

  // backtrack — modified 기준. 연속된 same/added 글자는 자동 그룹화로 token 수 절약.
  const result: Array<{ text: string; added: boolean }> = [];
  let i = m;
  let j = n;
  while (j > 0) {
    const isSame =
      i > 0 && original.charCodeAt(i - 1) === modified.charCodeAt(j - 1);
    const isAdded =
      !isSame &&
      (i === 0 || dp[i * width + j - 1] >= dp[(i - 1) * width + j]);

    if (isSame) {
      // 같은 글자 — 직전 항목이 same이면 prepend로 연결
      if (result.length > 0 && !result[0].added) {
        result[0].text = modified[j - 1] + result[0].text;
      } else {
        result.unshift({ text: modified[j - 1], added: false });
      }
      i -= 1;
      j -= 1;
    } else if (isAdded) {
      // 다듬에만 있는 글자 = added
      if (result.length > 0 && result[0].added) {
        result[0].text = modified[j - 1] + result[0].text;
      } else {
        result.unshift({ text: modified[j - 1], added: true });
      }
      j -= 1;
    } else {
      // 원본에만 있는 글자 = skip (modified 기준)
      i -= 1;
    }
  }
  return result;
}

// ★ D152+ Harold님 지시 재정정 (2026-05-12): 8→2 컨셉 축소.
//   톤 분류 자체가 의미 없음 — 풍성화 본질에 집중.
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
          throw new Error(data?.error || 'AI 다듬기는 베이직 요금제(35만원/월) 이상에서 이용 가능합니다');
        }
        throw new Error(data?.error || 'AI 다듬기에 실패했습니다');
      }
      // ★ D152+ 0건 fallback — Backend 후처리 검증 후 결과 0건이면 success:false + 친화 에러 (200)
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
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[70] animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      {/* ★ D152-6 정정2 (2026-05-12 Harold님 명시): 3컬럼 레이아웃 (좌 원본 / 가운데 ▶ / 우 결과).
            "왼쪽 원본, 가운데 다듬기 ▶ 화살표, 우측 다듬 결과 — 시각적 흐름으로 변화 즉시 체감"
            모달 max-w-6xl (1152px), grid-cols-1 lg:grid-cols-[1fr_auto_1fr]. */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
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

        {/* ── Body — 3컬럼 (좌: 원본+톤 / 가운데: ▶+CTA / 우: 결과). 모바일은 1단. ── */}
        <div className="overflow-y-auto flex-1 p-6 grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-5 lg:gap-4 items-start">
          {/* ── 좌측: 원본 + 톤 선택 ────────────────────────── */}
          <div className="space-y-5">
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
              <div className="grid grid-cols-2 gap-2">
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
          </div>

          {/* ── 가운데: ▶ 화살표 + CTA/로딩/다시 다듬기 ──────
                ★ D152-6 정정3 (Harold님 명시): "공간여유 많으니까 세로로, 다듬기와 띄어서"
                ▶ 크기 키움(lg:w-12) + ▶와 버튼 사이 lg:gap-6 박음 + items-start로 자연 위쪽 배치 */}
          <div className="flex lg:flex-col items-center justify-start gap-3 lg:gap-6 lg:pt-8 lg:px-2 lg:min-w-[140px]">
            <ArrowRight className="hidden lg:block w-12 h-12 text-emerald-400" strokeWidth={2.5} />
            <ArrowRight className="block lg:hidden w-8 h-8 text-emerald-300 rotate-90" strokeWidth={2.5} />

            {/* CTA — 결과 없고 로딩 아닐 때 */}
            {candidates.length === 0 && !loading && !error && (
              <button
                type="button"
                onClick={handleRefine}
                disabled={!originalMessage.trim()}
                className="w-full lg:w-auto px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white text-sm font-semibold shadow-md hover:shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" strokeWidth={2.25} />
                <span>다듬기 시작</span>
              </button>
            )}

            {/* 로딩 */}
            {loading && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-9 h-9 text-emerald-500 animate-spin" strokeWidth={2.5} />
                <p className="text-[11px] text-gray-500 text-center leading-tight whitespace-nowrap">다듬는 중...</p>
              </div>
            )}

            {/* 다시 다듬기 (결과 있을 때) */}
            {candidates.length > 0 && !loading && (
              <button
                type="button"
                onClick={handleRefine}
                className="px-3 py-2 rounded-lg border border-emerald-200 hover:bg-emerald-50 text-xs text-emerald-700 font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                다시 다듬기
              </button>
            )}
          </div>

          {/* ── 우측: 결과 / 에러 / placeholder ──────────────── */}
          <div className="space-y-3">
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block">
              AI 다듬은 안
            </label>

            {/* Placeholder — 다듬기 전 */}
            {candidates.length === 0 && !loading && !error && (
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 min-h-[200px] flex items-center justify-center text-center">
                <p className="text-xs text-gray-400 leading-relaxed">
                  가운데 <span className="text-emerald-500 font-semibold">다듬기 시작</span> 버튼을 누르면<br />
                  여기에 AI가 풍성하게 다듬은 결과가 표시됩니다
                </p>
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
                <p className="mt-3 text-[11px] text-gray-400 text-center">
                  <span className="bg-emerald-100 text-emerald-900 font-semibold rounded px-1">강조된 부분</span>이 AI가 풍성하게 다듬은 표현입니다 · 안을 클릭하면 본문에 즉시 적용됩니다
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex flex-col items-center gap-1 text-[11px] text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="font-mono text-gray-600">%이름%</span> 등 변수 자리 보존 · (광고) 표기 자동 정합
          </span>
          <span className="text-amber-600 font-medium">AI 결과는 참고용 · 발송 전 반드시 미리보기로 확인하세요</span>
        </div>
      </div>
    </div>
  );
}

/**
 * ★ D152-6 (2026-05-12) 결과 카드 — Before/After 하이라이트 적용.
 *   원본 대비 추가/변경된 어절을 emerald 강조로 표시.
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
      className="group relative p-4 rounded-xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/30 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-emerald-300"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-emerald-100 group-hover:bg-emerald-200 flex items-center justify-center text-[11px] font-bold text-emerald-700 transition-colors">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900 whitespace-pre-wrap break-words leading-relaxed">
            {parts.map((p, idx) =>
              p.added ? (
                <span
                  key={idx}
                  className="bg-emerald-100 text-emerald-900 font-semibold rounded px-0.5"
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
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {candidate.type}
            </span>
            <span className="text-[11px] text-gray-500 font-mono">
              {candidate.bytes}B
            </span>
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
  );
}
