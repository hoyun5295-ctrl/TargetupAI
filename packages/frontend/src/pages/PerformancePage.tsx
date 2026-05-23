import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Brain, Clock, Loader2, RefreshCw, Sparkles, Target, TrendingUp, Users } from 'lucide-react';

// ★ D174 (2026-05-19) Step 1 — 성과 리포트 + AI Next Action 추천
//   BUSINESS+ 베타 게이팅 (백엔드 isBetaAccessAllowed).

interface Snapshot {
  totalCampaigns: number;
  totalSent: number;
  totalSuccess: number;
  successRate: number;
  byChannel: Array<{ channel: string; sent: number; success: number; successRate: number }>;
  byHour: Array<{ hour: number; sent: number; successRate: number }>;
  estimatedRevenue: number;
  newCustomers30d: number;
  activeCustomers30d: number;
}

interface Advice {
  summary: string;
  recommendedAudience: string;
  recommendedChannel: string;
  recommendedTime: string;
  insights: string[];
  suggestedObjective: string;
  expectedClickRate: number;
  expectedConversionRate: number;
  expectedRevenue: number;
}

export default function PerformancePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [advice, setAdvice] = useState<Advice | null>(null);

  const token = () => localStorage.getItem('token');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/next-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'BETA_GATE') {
          setError('본 기능은 비즈니스 / 엔터프라이즈 요금제에서 이용 가능합니다.');
        } else {
          setError(data.error || '성과 리포트 생성 실패');
        }
        return;
      }
      setSnapshot(data.snapshot);
      setAdvice(data.advice);
    } catch (e: any) {
      setError(e?.message || '성과 리포트 호출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const goAiOperatorWithObjective = () => {
    if (!advice?.suggestedObjective) return;
    sessionStorage.setItem('ai_operator_prefill_objective', advice.suggestedObjective);
    navigate('/ai-operator');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-400 to-pink-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-fuchsia-500/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">성과 리포트</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">최근 30일 매출 / ROI / 클릭률 분석 + AI가 다음 캠페인 자동 추천</p>
          </div>
          <div className="ml-auto">
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-2 text-sm text-indigo-200 bg-indigo-500/20 hover:bg-indigo-500/30 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex flex-col items-center gap-3 text-white/50">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-300" />
            <div className="text-sm">최근 30일 캠페인 성과 + AI 추천을 생성하는 중입니다...</div>
            <div className="text-xs text-white/40">AI가 데이터를 분석합니다 (10~20초 소요)</div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-6 text-amber-200">
            {error}
          </div>
        )}

        {snapshot && !loading && (
          <>
            {/* 30일 성과 카드 4종 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard icon={<TrendingUp className="w-5 h-5" />} label="발송 캠페인" value={`${snapshot.totalCampaigns}건`} accent="indigo" />
              <StatCard icon={<Target className="w-5 h-5" />} label="성공률" value={`${(snapshot.successRate * 100).toFixed(1)}%`} sub={`${snapshot.totalSuccess.toLocaleString()} / ${snapshot.totalSent.toLocaleString()}`} accent="emerald" />
              <StatCard icon={<Users className="w-5 h-5" />} label="활성 고객" value={`${snapshot.activeCustomers30d.toLocaleString()}명`} sub={`신규 ${snapshot.newCustomers30d.toLocaleString()}명`} accent="rose" />
              <StatCard icon={<TrendingUp className="w-5 h-5" />} label="추정 매출 (CDP)" value={`${snapshot.estimatedRevenue.toLocaleString()}원`} sub="자사몰 연동 시" accent="amber" />
            </div>

            {/* 채널별 + 시간대별 매트릭스 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="text-sm font-bold text-white mb-3">채널별 성과</div>
                {snapshot.byChannel.length === 0 ? (
                  <div className="text-xs text-white/40 py-6 text-center">최근 30일 발송 이력이 없습니다.</div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.byChannel.map((c) => (
                      <div key={c.channel} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-white/80">{c.channel}</span>
                        <div className="flex items-center gap-3 text-xs text-white/50">
                          <span>{c.sent.toLocaleString()}건</span>
                          <span className="font-bold text-emerald-300">{(c.successRate * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="text-sm font-bold text-white mb-3">시간대별 성과 (상위 5)</div>
                {snapshot.byHour.length === 0 ? (
                  <div className="text-xs text-white/40 py-6 text-center">데이터 없음</div>
                ) : (
                  <div className="space-y-2">
                    {[...snapshot.byHour].sort((a, b) => b.sent - a.sent).slice(0, 5).map((h) => (
                      <div key={h.hour} className="flex items-center justify-between text-sm">
                        <span className="font-medium text-white/80">{String(h.hour).padStart(2, '0')}시</span>
                        <div className="flex items-center gap-3 text-xs text-white/50">
                          <span>{h.sent.toLocaleString()}건</span>
                          <span className="font-bold text-indigo-300">{(h.successRate * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* AI 추천 카드 */}
            {advice && (
              <div className="bg-gradient-to-br from-indigo-500/15 via-fuchsia-500/10 to-amber-500/15 border border-indigo-400/30 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-indigo-300" />
                  <h2 className="text-base font-bold text-white">AI 다음 캠페인 추천</h2>
                </div>

                {advice.summary && (
                  <div className="bg-white/10 border border-white/10 rounded-xl p-4 text-sm font-medium text-white leading-relaxed">
                    {advice.summary}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <RecCard icon={<Target className="w-4 h-4" />} label="추천 타겟" value={advice.recommendedAudience || '-'} />
                  <RecCard icon={<Sparkles className="w-4 h-4" />} label="추천 채널" value={advice.recommendedChannel} />
                  <RecCard icon={<Clock className="w-4 h-4" />} label="추천 시점" value={advice.recommendedTime ? new Date(advice.recommendedTime).toLocaleString('ko-KR') : '-'} />
                </div>

                {advice.insights.length > 0 && (
                  <div className="bg-white/10 border border-white/10 rounded-xl p-4">
                    <div className="text-xs font-medium text-white/80 mb-2">핵심 인사이트</div>
                    <ul className="space-y-1.5">
                      {advice.insights.map((ins, i) => (
                        <li key={i} className="text-sm text-white/80 flex gap-2">
                          <span className="text-indigo-300 shrink-0">·</span>
                          <span>{ins}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-white/10 border border-white/10 rounded-lg px-3 py-2">
                    <div className="text-white/50">예상 클릭률</div>
                    <div className="text-lg font-bold text-white">{(advice.expectedClickRate * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-lg px-3 py-2">
                    <div className="text-white/50">예상 전환율</div>
                    <div className="text-lg font-bold text-white">{(advice.expectedConversionRate * 100).toFixed(2)}%</div>
                  </div>
                  <div className="bg-white/10 border border-white/10 rounded-lg px-3 py-2">
                    <div className="text-white/50">예상 매출</div>
                    <div className="text-lg font-bold text-white">{advice.expectedRevenue.toLocaleString()}원</div>
                  </div>
                </div>

                {advice.suggestedObjective && (
                  <div className="border-t border-indigo-400/30 pt-4">
                    <div className="text-xs text-white/70 mb-2">
                      "<span className="font-medium">{advice.suggestedObjective}</span>" — AI Operator에 사용할 자연어 한 줄
                    </div>
                    <button
                      onClick={goAiOperatorWithObjective}
                      className="px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      AI Operator에서 이 캠페인 실행하기
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="text-xs text-white/40 text-center pt-4">
          본 추천은 AI 분석 결과이며 사용자 검토 + 승인 후 발송됩니다 (AI 단독 발송 X). 타겟 매칭 0건 시 발송 차단 정책 정합.
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: 'indigo' | 'emerald' | 'rose' | 'amber' }) {
  const accentClass = {
    indigo: 'text-indigo-300 bg-indigo-50',
    emerald: 'text-emerald-300 bg-emerald-500/15',
    rose: 'text-rose-300 bg-rose-500/15',
    amber: 'text-amber-300 bg-amber-500/15',
  }[accent];
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${accentClass} mb-3`}>{icon}</div>
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-white/40 mt-1">{sub}</div>}
    </div>
  );
}

function RecCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/10 border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-xs text-white/50 mb-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold text-white">{value}</div>
    </div>
  );
}
