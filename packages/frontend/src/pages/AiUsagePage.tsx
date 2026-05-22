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

interface UsageData {
  monthly: { used: number; limit: number | null };
  daily: DailyRow[];
  cache: { size: number; hit: number; miss: number; hitRate: number };
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
          setData({ monthly: json.monthly, daily: json.daily || [], cache: json.cache });
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/ai-operator')}
            className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow"
          >
            <ArrowLeft className="w-4 h-4" /> 뒤로
          </button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Activity className="w-7 h-7 text-blue-500" /> AI 사용량 대시보드
            </h1>
            <p className="text-sm text-gray-500 mt-1">회사별 AI 호출 월 한도 + 30일 일별 통계 + cache 효율 진단</p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* 월 한도 진척률 */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-500" /> 이번 달 사용량
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">매월 1일 KST 기준 자동 초기화</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-gray-800">
                    {data.monthly.used.toLocaleString()}
                    {data.monthly.limit !== null && (
                      <span className="text-lg text-gray-400 font-normal"> / {data.monthly.limit.toLocaleString()}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500">
                    {data.monthly.limit === null ? '무제한 (ENTERPRISE)' : `${progressPct}% 사용`}
                  </div>
                </div>
              </div>
              {data.monthly.limit !== null && (
                <>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-blue-500'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {isWarning && (
                    <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 ${
                      isCritical ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
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
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">최근 30일 일별 호출 추이</h2>
                <div className="text-sm text-gray-500">
                  총 {totalDaily.toLocaleString()}회 / 평균 일 {dailySorted.length > 0 ? Math.round(totalDaily / dailySorted.length) : 0}회
                </div>
              </div>
              {dailySorted.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailySorted}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
                    <YAxis stroke="#6b7280" fontSize={12} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}
                      formatter={(value: any) => [`${Number(value || 0).toLocaleString()}회`, '호출 수']}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="py-12 text-center text-gray-400">
                  최근 30일 AI 호출 데이터가 없습니다.
                </div>
              )}
            </div>

            {/* cache 통계 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-md p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold">cache 활성</h3>
                </div>
                <div className="text-2xl font-bold text-gray-800">{data.cache.size.toLocaleString()}건</div>
                <div className="text-xs text-gray-500 mt-1">5분 TTL · 최대 1000건</div>
              </div>
              <div className="bg-white rounded-xl shadow-md p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  <h3 className="font-semibold">cache hit rate</h3>
                </div>
                <div className="text-2xl font-bold text-gray-800">{(data.cache.hitRate * 100).toFixed(1)}%</div>
                <div className="text-xs text-gray-500 mt-1">
                  hit {data.cache.hit.toLocaleString()} / miss {data.cache.miss.toLocaleString()}
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-md p-5">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-violet-500" />
                  <h3 className="font-semibold">비용 절감 효과</h3>
                </div>
                <div className="text-2xl font-bold text-gray-800">
                  ≈ {Math.round(data.cache.hit * 0.5).toLocaleString()}원
                </div>
                <div className="text-xs text-gray-500 mt-1">cache hit × 평균 0.5원</div>
              </div>
            </div>

            {/* 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
              <h3 className="font-semibold text-blue-900 mb-2">★ 비용 안전 매트릭스 안내</h3>
              <ul className="text-sm text-blue-800 space-y-1.5">
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
