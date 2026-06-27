// 여러 목표 동시 분석 — 멀티골 충돌 분석 모달 (2026-06-27, 자립형)
// 여러 목표를 동시에 설정할 때 AI가 충돌(중복 발송·시점 겹침)을 분석.
import { useState } from 'react';
import { GitMerge, X, AlertCircle, Plus, Loader2, Sparkles } from 'lucide-react';
import { MultiGoalInput, MultiGoalAnalysis } from './types';
import { useToast } from '../ToastProvider';

const INP = 'px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 transition-colors';

export default function MultiGoalModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [goals, setGoals] = useState<MultiGoalInput[]>([
    { name: '', description: '', weight: 0.5 },
    { name: '', description: '', weight: 0.5 },
  ]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MultiGoalAnalysis | null>(null);

  const token = () => localStorage.getItem('token');

  const analyze = async () => {
    const valid = goals.filter((g) => g.name.trim().length > 0);
    if (valid.length < 2) { toast.warning('2개 이상의 목표를 입력해주세요.'); return; }
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch('/api/ai/operator/multi-goal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ goals: valid }),
      });
      const data = await res.json();
      if (data.success) { setAnalysis(data.analysis); toast.success('충돌 분석이 완료되었습니다.'); }
      else toast.error(data.error || '충돌 분석에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const update = (idx: number, patch: Partial<MultiGoalInput>) => {
    const next = [...goals];
    next[idx] = { ...next[idx], ...patch };
    setGoals(next);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b border-white/10 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <GitMerge className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-white">여러 목표 동시 분석</h3>
            <p className="text-[11px] text-white/50 mt-0.5">2~5개 목표를 한번에 — AI가 충돌(중복 발송·시점 겹침)을 분석합니다.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 mb-4 text-xs text-amber-100 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>여러 목표를 동시에 설정하면 AI가 충돌(동일 고객 중복 발송·메시지 중복·시점 겹침)을 분석합니다. 실행은 담당자 승인 후에만 진행됩니다.</div>
          </div>

          {!analysis ? (
            <>
              <div className="space-y-3 mb-4">
                {goals.map((g, idx) => (
                  <div key={idx} className="border border-white/10 rounded-lg p-3 bg-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-white/80">목표 {idx + 1}</span>
                      {goals.length > 2 && (
                        <button onClick={() => setGoals(goals.filter((_, i) => i !== idx))} className="text-rose-300 hover:text-rose-200 text-xs ml-auto">제거</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input type="text" value={g.name} onChange={(e) => update(idx, { name: e.target.value })} placeholder="예: VIP 재구매" className={INP} maxLength={100} />
                      <div>
                        <label className="text-[10px] text-white/50 block">가중치 (0~1, 합 자동 정규화)</label>
                        <input type="number" step="0.1" min="0" max="1" value={g.weight} onChange={(e) => update(idx, { weight: parseFloat(e.target.value) || 0 })} className={`${INP} w-full`} />
                      </div>
                    </div>
                    <textarea value={g.description || ''} onChange={(e) => update(idx, { description: e.target.value })} placeholder="자연어 상세 (선택) — 예: VIP 등급 + 최근 30일 미구매 고객" className={`${INP} w-full h-16 resize-none`} maxLength={500} />
                  </div>
                ))}
                {goals.length < 5 && (
                  <button onClick={() => setGoals([...goals, { name: '', description: '', weight: 0.2 }])} className="w-full py-2 border-2 border-dashed border-white/20 hover:border-indigo-400 hover:bg-indigo-500/10 text-xs text-white/70 rounded-lg flex items-center justify-center gap-1.5 transition-colors">
                    <Plus className="w-3 h-3" /> 목표 추가 (최대 5건)
                  </button>
                )}
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
                <button onClick={onClose} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors">취소</button>
                <button onClick={analyze} disabled={analyzing} className="px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 text-sm rounded-lg disabled:opacity-40 flex items-center gap-1.5 transition-colors">
                  {analyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 분석 중...</> : <><Sparkles className="w-3.5 h-3.5" /> 충돌 분석 시작</>}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-violet-500/10 border border-violet-400/30 rounded-lg p-4 mb-4">
                <div className="text-xs font-bold text-violet-200 mb-1">통합 전략</div>
                <div className="text-sm text-violet-100/80 whitespace-pre-wrap leading-relaxed">{analysis.overallStrategy}</div>
              </div>

              <div className="mb-4">
                <div className="text-xs font-bold text-white/80 mb-2">추천 순서</div>
                <div className="flex flex-wrap gap-2">
                  {analysis.recommendedOrder.map((name, idx) => (
                    <div key={idx} className="bg-white/5 border border-violet-400/40 rounded-full px-3 py-1 text-xs flex items-center gap-1.5 text-white/80">
                      <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                      {name}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-4 space-y-2">
                <div className="text-xs font-bold text-white/80">목표별 계획</div>
                {analysis.subPlans.map((sp, idx) => (
                  <div key={idx} className={`border rounded-lg p-3 ${sp.shouldExecute ? 'bg-white/5 border-white/10' : 'bg-rose-500/10 border-rose-400/30'}`}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{sp.priority}</span>
                      <span className="text-sm font-bold text-white">{sp.goalName}</span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-1.5 py-0.5 rounded-full">{sp.channelRecommended}</span>
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded-full">{sp.timingRecommended}</span>
                      {!sp.shouldExecute && <span className="text-[10px] bg-rose-500/30 text-rose-200 px-1.5 py-0.5 rounded-full">실행 제외</span>}
                    </div>
                    <div className="text-xs text-white/70 mb-1">{sp.targetCriteria}</div>
                    {sp.conflicts.length > 0 && <div className="text-[11px] text-amber-300 mt-1.5"><strong>충돌:</strong> {sp.conflicts.join(' / ')}</div>}
                    <div className="text-[11px] text-white/50 mt-1">{sp.reasoning}</div>
                  </div>
                ))}
              </div>

              {analysis.conflictMatrix && (
                <details className="mb-4">
                  <summary className="text-xs font-bold text-white/80 cursor-pointer">충돌 분석 상세</summary>
                  <pre className="bg-white/5 border border-white/10 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap mt-2 text-white/70">{analysis.conflictMatrix}</pre>
                </details>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-white/10">
                <button onClick={() => setAnalysis(null)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors">다시 분석</button>
                <button onClick={onClose} className="px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 text-sm rounded-lg transition-colors">확인</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
