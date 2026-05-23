/**
 * AiUsagePage.tsx — Phase D 비용 안전 매트릭스 대시보드 (D209+ 2026-05-22)
 *
 * 회사 admin 진입 시 AI 호출 월 사용량 + 한도 + 30일 일별 통계 + cache 통계 시각화:
 *  - 월 사용량 진척률 (used / limit) — 한도 80% 진입 시 경고
 *  - 30일 일별 호출 BarChart (recharts)
 *  - cache 통계 (hit rate — 비용 절감 효과)
 *  - 비용 안전 안내
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  ArrowLeft, Activity, TrendingUp, Database, AlertTriangle, Loader2, Sparkles,
} from 'lucide-react';

interface DailyRow {
  date: string;
  count: number;
  cost: number;
}

interface BreakdownRow {
  source: string;
  modelType: string;
  count: number;
  cost: number;
}

interface UsageData {
  monthly: { used: number; limit: number | null };
  daily: DailyRow[];
  cache: { size: number; hit: number; miss: number; hitRate: number };
  // ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): 모델별 분포 + 비용 절감 영역
  breakdown?: BreakdownRow[];
  cacheSavingsWon?: number;
}

export default function AiUsagePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/ai/usage', {
          headers: { Authorization: `Bearer ${token()}` },
        });
        const json = await res.json();
        if (json.success) {
          setData({
            monthly: json.monthly,
            daily: json.daily || [],
            cache: json.cache,
            breakdown: json.breakdown || [],
            cacheSavingsWon: json.cacheSavingsWon || 0,
          });
        } else {
          setError(json.error || 'AI 사용량 조회 실패');
        }
      } catch {
        setError('네트워크 오류');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const progressPct = data?.monthly.limit
    ? Math.min(100, Math.round((data.monthly.used / data.monthly.limit) * 100))
    : 0;
  const isWarning = data?.monthly.limit !== null && progressPct >= 80;
  const isCritical = data?.monthly.limit !== null && progressPct >= 95;

  const dailySorted = data?.daily.slice().reverse().map((d) => ({
    ...d,
    label: d.date.slice(5),  // 'MM-DD' 단축
  })) || [];

  const totalDaily = dailySorted.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 sticky 영역 */}
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">AI 사용량 대시보드</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">회사별 AI 호출 월 한도 + 30일 일별 통계 + cache 효율 진단</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 text-rose-300 p-4 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* 월 한도 진척률 */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                    <TrendingUp className="w-5 h-5 text-blue-400" /> 이번 달 사용량
                  </h2>
                  <p className="text-sm text-white/50 mt-1">매월 1일 KST 기준 자동 초기화</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-white">
                    {data.monthly.used.toLocaleString()}
                    {data.monthly.limit !== null && (
                      <span className="text-lg text-white/40 font-normal"> / {data.monthly.limit.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-white/50">
                    {data.monthly.limit === null ? '무제한 (ENTERPRISE)' : `${progressPct}% 사용`}
                  </div>
                </div>
              </div>
              {data.monthly.limit !== null && (
                <>
                  <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isCritical ? 'bg-rose-400' : isWarning ? 'bg-amber-400' : 'bg-blue-400'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {isWarning && (
                    <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 ${
                      isCritical ? 'bg-rose-500/10 border border-rose-400/30 text-rose-200' : 'bg-amber-500/10 border border-amber-400/30 text-amber-200'
                    }`}>
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        {isCritical
                          ? '★ 한도 95% 초과 — AI 호출이 곧 차단됩니다. 요금제 업그레이드를 권장드립니다.'
                          : '한도 80% 초과 — 사용량을 모니터링해주세요. 한도 도달 시 다음 달까지 AI 호출이 차단됩니다.'}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 30일 일별 통계 BarChart */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">최근 30일 일별 호출 추이</h2>
                <div className="text-sm text-white/50">
                  총 {totalDaily.toLocaleString()}회 / 평균 일 {dailySorted.length > 0 ? Math.round(totalDaily / dailySorted.length) : 0}회
                </div>
              </div>
              {dailySorted.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailySorted}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="label" stroke="rgba(255,255,255,0.5)" fontSize={12} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: any) => [`${Number(value || 0).toLocaleString()}회`, '호출 수']}
                    />
                    <Bar dataKey="count" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="py-12 text-center text-white/40">
                  최근 30일 AI 호출 데이터가 없습니다.
                </div>
              )}
            </div>

            {/* cache 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-semibold text-white">cache 활성</h3>
                </div>
                <div className="text-2xl font-bold text-white">{data.cache.size.toLocaleString()}건</div>
                <div className="text-xs text-white/50 mt-1">5분 TTL · 최대 1000건</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <h3 className="font-semibold text-white">cache hit rate</h3>
                </div>
                <div className="text-2xl font-bold text-white">{(data.cache.hitRate * 100).toFixed(1)}%</div>
                <div className="text-xs text-white/50 mt-1">
                  hit {data.cache.hit.toLocaleString()} / miss {data.cache.miss.toLocaleString()}
                </div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-violet-400" />
                  <h3 className="font-semibold text-white">비용 절감 효과</h3>
                </div>
                {/* ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): 실제 cache hit × 평균 호출 비용 영역 (옛 fixed 0.5원 영역 정정) */}
                <div className="text-2xl font-bold text-white">
                  ≈ {(data.cacheSavingsWon || 0).toLocaleString()}원
                </div>
                <div className="text-xs text-white/50 mt-1">
                  cache hit × 실제 평균 호출 비용 (ai_call_log)
                </div>
              </div>
            </div>

            {/* ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): 모델별 분포 영역 (30일 source + modelType 매트릭스) */}
            {data.breakdown && data.breakdown.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-5 h-5 text-cyan-400" />
                  <h3 className="font-semibold text-white">30일 모델별 분포 — source + modelType</h3>
                  <span className="text-[10px] text-white/40 ml-auto">ai_call_log 영역 source</span>
                </div>
                <div className="space-y-1.5">
                  {(() => {
                    const maxCount = Math.max(...data.breakdown.map((b) => b.count), 1);
                    return data.breakdown.slice(0, 10).map((b, idx) => (
                      <div key={`${b.source}-${b.modelType}-${idx}`} className="flex items-center gap-2 text-xs">
                        <div className="w-32 text-white/70 truncate" title={b.source}>{b.source}</div>
                        <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          b.modelType === 'opus' ? 'bg-violet-500/20 text-violet-300' :
                          b.modelType === 'sonnet' ? 'bg-blue-500/20 text-blue-300' :
                          'bg-white/10 text-white/60'
                        }`}>
                          {b.modelType}
                        </div>
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              b.modelType === 'opus' ? 'bg-violet-400' :
                              b.modelType === 'sonnet' ? 'bg-blue-400' :
                              'bg-white/30'
                            }`}
                            style={{ width: `${(b.count / maxCount) * 100}%` }}
                          />
                        </div>
                        <div className="w-20 text-right font-mono text-white/60">{b.count.toLocaleString()}회</div>
                        <div className="w-24 text-right font-mono text-white/50">{b.cost.toLocaleString()}원</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* 안내 */}
            <div className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-5">
              <h3 className="font-semibold text-blue-200 mb-2">★ 비용 안전 매트릭스 안내</h3>
              <ul className="text-sm text-blue-100/80 space-y-1.5">
                <li>• 회사별 월 한도 초과 시 AI 호출 자동 차단 (다음 달 1일 KST 자동 초기화)</li>
                <li>• 동일 자연어 입력은 5분 안 자동 cache → AI 호출 0건 + 비용 0원</li>
                <li>• cache hit rate 높을수록 비용 절감 효과 증가</li>
                <li>• 한도 업그레이드 요청 = 회사 admin → 한줄로 운영팀 문의</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
