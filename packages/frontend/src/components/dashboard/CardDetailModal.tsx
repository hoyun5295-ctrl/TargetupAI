/**
 * CardDetailModal (D132 Phase B)
 *
 * 대시보드 DB 현황 카드 클릭 시 열리는 세부 지표 모달.
 *   - 디자인: FileUploadMappingModal 톤 계승 (violet 그라디언트 헤더, rounded-2xl, shadow-xl)
 *   - 카드 타입별 자동 분기:
 *     · count/rate/sum: 현재값·델타 요약 → recharts LineChart (6개월 추이) → breakdown 4칸
 *     · birthday: 위 + BirthdayCustomerList (검색+페이지네이션)
 *     · distribution: 전체 확장 리스트 (프로그레스 바)
 *   - 푸터: "닫기" 버튼
 */
import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DeltaBadge from './DeltaBadge';
import BirthdayCustomerList from './BirthdayCustomerList';

// ─── 타입 ───

interface DashboardCardData {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
  delta?: number | null;
  deltaPercent?: number | null;
  deltaBaseline?: string;
  hasTrend?: boolean;
}

interface CardDetailResponse {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  blocked?: boolean;
  trend?: { month: string; value: number }[];
  breakdown?: {
    byGender: { label: string; count: number }[];
    byAge: { label: string; count: number }[];
    byGrade: { label: string; count: number }[];
    byRegion: { label: string; count: number }[];
  };
  topList?: {
    items: any[];
    total: number;
    page: number;
    limit: number;
  };
  fullDistribution?: { label: string; count: number }[];
}

interface CardDetailModalProps {
  card: DashboardCardData | null; // null이면 닫힘
  onClose: () => void;
}

// ─── 내부 컴포넌트 ───

function BreakdownCard({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  if (!items || items.length === 0) {
    return (
      <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-center min-h-[100px]">
        <p className="text-xs text-gray-400">데이터 없음</p>
      </div>
    );
  }
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs font-semibold text-gray-600 mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((it, i) => (
          <div key={`${it.label}-${i}`}>
            <div className="flex justify-between text-[11px] mb-0.5">
              <span className="text-gray-500 truncate max-w-[65%]">{it.label}</span>
              <span className="font-semibold text-gray-800">{it.count.toLocaleString()}</span>
            </div>
            <div className="h-1 bg-white rounded-full overflow-hidden">
              <div className="h-full bg-violet-400" style={{ width: `${(it.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionList({ items }: { items: { label: string; count: number }[] }) {
  if (!items || items.length === 0) {
    return <div className="bg-gray-50 rounded-xl p-6 text-center text-sm text-gray-400">데이터 없음</div>;
  }
  const max = Math.max(...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
      {items.map((it, i) => {
        const pct = total > 0 ? (it.count / total) * 100 : 0;
        return (
          <div key={`${it.label}-${i}`}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-gray-700 font-medium truncate max-w-[65%]">{it.label}</span>
              <span className="font-semibold text-gray-800">
                {it.count.toLocaleString()} <span className="text-gray-400 font-normal">({pct.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="h-1.5 bg-white rounded-full overflow-hidden">
              <div className="h-full bg-violet-400 transition-all duration-500" style={{ width: `${(it.count / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCards({ card }: { card: DashboardCardData }) {
  const numVal = typeof card.value === 'number' ? card.value : 0;
  const suffix = card.type === 'rate' ? '%' : card.type === 'sum' ? '원' : card.cardId === 'active_campaigns' ? '건' : '명';
  const displayVal = card.type === 'rate' ? numVal.toFixed(1) : numVal.toLocaleString();

  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-xl p-4">
        <p className="text-[11px] text-violet-600 mb-1 font-medium">현재</p>
        <p className="text-2xl font-bold text-gray-900 tracking-tight">
          {displayVal}
          <span className="text-sm font-normal text-gray-500 ml-1">{suffix}</span>
        </p>
      </div>
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-[11px] text-gray-500 mb-1 font-medium">지난달 대비</p>
        {card.hasTrend && card.delta !== null && card.delta !== undefined ? (
          <DeltaBadge delta={card.delta} deltaPercent={card.deltaPercent} baseline={card.deltaBaseline} suffix={suffix} size="md" />
        ) : (
          <p className="text-xs text-gray-400">데이터 부족</p>
        )}
      </div>
    </div>
  );
}

// ─── 메인 ───

export default function CardDetailModal({ card, onClose }: CardDetailModalProps) {
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!card) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/companies/dashboard-cards/${card.cardId}/detail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        console.error('카드 상세 조회 실패:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [card]);

  if (!card) return null;

  const isBirthday = card.cardId === 'birthday_this_month';
  const isDistribution = card.type === 'distribution';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col animate-[zoomIn_0.2s_ease-out]">
        {/* 헤더 */}
        <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-purple-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm shadow-violet-200">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">{card.label}</h3>
              <p className="text-xs text-gray-500">세부 지표 및 분포</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/60 text-gray-500 text-xl flex items-center justify-center transition-colors"
            aria-label="닫기"
          >
            &times;
          </button>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && !detail ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <svg className="w-8 h-8 text-violet-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-gray-500">불러오는 중...</span>
            </div>
          ) : detail?.blocked ? (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">접근 권한이 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 요약 카드 */}
              <SummaryCards card={card} />

              {/* 6개월 추이 차트 */}
              {detail?.trend && detail.trend.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                    최근 6개월 추이
                  </h4>
                  <div className="bg-white border border-gray-100 rounded-xl p-4" style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <LineChart data={detail.trend} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="violetGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                          labelStyle={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}
                          formatter={(v: any) => [Number(v).toLocaleString(), card.label]}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#8b5cf6"
                          strokeWidth={2.5}
                          dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* breakdown 4칸 */}
              {detail?.breakdown && !isBirthday && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    세그먼트 분포
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <BreakdownCard title="성별" items={detail.breakdown.byGender} />
                    <BreakdownCard title="연령대" items={detail.breakdown.byAge} />
                    <BreakdownCard title="등급" items={detail.breakdown.byGrade} />
                    <BreakdownCard title="지역" items={detail.breakdown.byRegion} />
                  </div>
                </div>
              )}

              {/* 생일 카드: 고객 리스트 */}
              {isBirthday && detail?.topList && (
                <BirthdayCustomerList initialData={detail.topList} cardId={card.cardId} />
              )}

              {/* distribution 카드: 전체 확장 */}
              {isDistribution && detail?.fullDistribution && (
                <div className="mb-2">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                    </svg>
                    전체 분포
                  </h4>
                  <DistributionList items={detail.fullDistribution} />
                </div>
              )}
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t bg-white flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
