/**
 * CardDetailModal — 대시보드 DB 현황 카드 상세 모달
 *
 * D224+ 본격 재작성 (2026-05-27):
 *   - Harold 명시 정합: 기존 D132 Phase B 단순 영역 → 현대적 + 모던 + Journey Builder 동급 정합
 *   - 크기: max-w-3xl → max-w-5xl + 모바일 풀스크린
 *   - 헤더 sticky + 그라데이션 아이콘 (카드 type별 색상)
 *   - AI 자율 진단 카드 (violet → fuchsia 그라데이션 + 카드별 인사이트 + 추천)
 *   - 요약 메트릭 강화 (현재 + 지난달 대비 + 활성도)
 *   - 6개월 추이 LineChart 강화 (Area 그라데이션 + 더 큰 영역)
 *   - breakdown 도넛 차트 4건 (성별 + 연령대 + 등급 + 지역 — recharts PieChart)
 *   - 1-click 액션 3 카드 (rose 직접 발송 / emerald 세그먼트 / violet AI Operator)
 *   - 모바일 반응형 (max-md: 풀스크린)
 *   - distribution 카드 = 전체 확장 리스트
 *   - birthday 카드 = 고객 리스트
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Cake,
  Calendar,
  Layers,
  Lightbulb,
  MapPin,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  UserX,
  X,
} from 'lucide-react';
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
  card: DashboardCardData | null;
  onClose: () => void;
}

// ─── 카드별 디자인 매핑 (헤더 그라데이션 + AI 인사이트 + 1-click 액션 흐름) ───

interface CardTheme {
  gradient: string;
  iconBg: string;
  iconText: string;
  IconComp: any;
  insightTitle: string;
  insightDesc: (count: number) => string;
  recommend: string;
  oneClickObjective: string;
}

const CARD_THEMES: Record<string, CardTheme> = {
  total_customers: {
    gradient: 'from-violet-500 to-purple-600',
    iconBg: 'bg-violet-500/15',
    iconText: 'text-violet-600',
    IconComp: Users,
    insightTitle: '전체 고객 추이',
    insightDesc: (n) => `현재 ${n.toLocaleString()}명의 고객 데이터를 보유하고 있습니다. 최근 6개월 추이를 통해 신규 유입 흐름을 확인하세요.`,
    recommend: '신규 가입 고객 환영 캠페인',
    oneClickObjective: '최근 30일 신규 가입 고객에게 환영 메시지 보내기',
  },
  gender_male: {
    gradient: 'from-blue-500 to-indigo-600',
    iconBg: 'bg-blue-500/15',
    iconText: 'text-blue-600',
    IconComp: Users,
    insightTitle: '남성 고객 분포',
    insightDesc: (n) => `남성 고객 ${n.toLocaleString()}명. 연령대별 분포를 통해 타겟 캠페인을 설계할 수 있습니다.`,
    recommend: '남성 타겟 맞춤 캠페인',
    oneClickObjective: '남성 고객 대상 맞춤 메시지 보내기',
  },
  gender_female: {
    gradient: 'from-pink-500 to-rose-600',
    iconBg: 'bg-pink-500/15',
    iconText: 'text-pink-600',
    IconComp: Users,
    insightTitle: '여성 고객 분포',
    insightDesc: (n) => `여성 고객 ${n.toLocaleString()}명. 연령대 + 등급 조합으로 정밀 타겟팅이 가능합니다.`,
    recommend: '여성 타겟 맞춤 캠페인',
    oneClickObjective: '여성 고객 대상 맞춤 메시지 보내기',
  },
  birthday_this_month: {
    gradient: 'from-amber-500 to-orange-600',
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-600',
    IconComp: Cake,
    insightTitle: '이번 달 생일 고객',
    insightDesc: (n) => `이번 달 생일 ${n.toLocaleString()}명. 생일 축하 + 쿠폰 발송으로 충성도를 높일 절호의 기회입니다.`,
    recommend: '생일 축하 캠페인',
    oneClickObjective: '이번 달 생일 고객에게 축하 메시지 보내기',
  },
  opt_in_count: {
    gradient: 'from-emerald-500 to-teal-600',
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-600',
    IconComp: Send,
    insightTitle: 'SMS 수신 동의 고객',
    insightDesc: (n) => `발송 가능 고객 ${n.toLocaleString()}명. 정보통신망법 정합 동의 고객 대상 메시지가 가능합니다.`,
    recommend: '동의 고객 전체 발송 캠페인',
    oneClickObjective: 'SMS 수신 동의 고객 전체 대상 캠페인 설계',
  },
  new_this_month: {
    gradient: 'from-cyan-500 to-blue-600',
    iconBg: 'bg-cyan-500/15',
    iconText: 'text-cyan-600',
    IconComp: Sparkles,
    insightTitle: '이번 달 신규 가입',
    insightDesc: (n) => `신규 ${n.toLocaleString()}명. 첫 인상 + 환영 메시지로 재방문율을 높이는 핵심 시점입니다.`,
    recommend: '신규 환영 + 첫 구매 유도 캠페인',
    oneClickObjective: '이번 달 신규 가입 고객 환영 메시지 보내기',
  },
  recent_30d_purchase: {
    gradient: 'from-emerald-500 to-green-600',
    iconBg: 'bg-emerald-500/15',
    iconText: 'text-emerald-600',
    IconComp: TrendingUp,
    insightTitle: '최근 30일 구매 고객',
    insightDesc: (n) => `활성 구매 고객 ${n.toLocaleString()}명. 재구매 유도 + 교차 판매 캠페인의 최적 대상입니다.`,
    recommend: '재구매 유도 + 교차 판매 캠페인',
    oneClickObjective: '최근 30일 구매 고객에게 재구매 유도 메시지 보내기',
  },
  inactive_90d: {
    gradient: 'from-rose-500 to-red-600',
    iconBg: 'bg-rose-500/15',
    iconText: 'text-rose-600',
    IconComp: UserX,
    insightTitle: '90일+ 미구매 고객',
    insightDesc: (n) => `이탈 위험 ${n.toLocaleString()}명. 즉시 재참여 메시지를 발송하면 이탈을 막을 수 있습니다.`,
    recommend: '휴면 회수 + 재참여 캠페인',
    oneClickObjective: '90일 이상 미구매 고객에게 재참여 메시지 보내기',
  },
  age_distribution: {
    gradient: 'from-violet-500 to-fuchsia-600',
    iconBg: 'bg-violet-500/15',
    iconText: 'text-violet-600',
    IconComp: BarChart3,
    insightTitle: '연령대별 분포',
    insightDesc: () => `고객 연령대 분포를 통해 세대별 맞춤 메시지 전략을 설계할 수 있습니다.`,
    recommend: '연령대별 맞춤 메시지 캠페인',
    oneClickObjective: '연령대별 맞춤 캠페인 설계',
  },
  grade_distribution: {
    gradient: 'from-amber-500 to-yellow-600',
    iconBg: 'bg-amber-500/15',
    iconText: 'text-amber-600',
    IconComp: Layers,
    insightTitle: '등급별 분포',
    insightDesc: () => `등급별 고객 분포를 활용해 VIP 우대 + 신규 등급 유도 캠페인을 진행하세요.`,
    recommend: 'VIP 우대 + 등급 승급 캠페인',
    oneClickObjective: 'VIP 등급 고객 대상 우대 캠페인 설계',
  },
  region_top: {
    gradient: 'from-cyan-500 to-teal-600',
    iconBg: 'bg-cyan-500/15',
    iconText: 'text-cyan-600',
    IconComp: MapPin,
    insightTitle: '지역별 상위 분포',
    insightDesc: () => `지역별 고객 분포를 통해 매장 진입 유도 + 지역 행사 캠페인 설계가 가능합니다.`,
    recommend: '지역 매장 진입 유도 캠페인',
    oneClickObjective: '지역별 맞춤 캠페인 설계',
  },
  store_distribution: {
    gradient: 'from-indigo-500 to-purple-600',
    iconBg: 'bg-indigo-500/15',
    iconText: 'text-indigo-600',
    IconComp: Target,
    insightTitle: '매장별 분포',
    insightDesc: () => `매장별 고객 분포를 통해 매장 차등 캠페인 + 본점 우대 행사 설계가 가능합니다.`,
    recommend: '매장별 차등 캠페인',
    oneClickObjective: '매장별 맞춤 캠페인 설계',
  },
};

const DEFAULT_THEME: CardTheme = {
  gradient: 'from-violet-500 to-purple-600',
  iconBg: 'bg-violet-500/15',
  iconText: 'text-violet-600',
  IconComp: BarChart3,
  insightTitle: '세부 분석',
  insightDesc: () => `본 카드 데이터를 활용해 정밀 타겟 캠페인을 설계할 수 있습니다.`,
  recommend: '맞춤 캠페인',
  oneClickObjective: '본 카드 데이터 활용 캠페인 설계',
};

// ─── 도넛 차트 색상 팔레트 (violet 톤 정합) ───

const DONUT_COLORS = ['#8b5cf6', '#d946ef', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7'];

// ─── 내부 컴포넌트: 도넛 차트 ───

function DonutCard({ title, items, icon: Icon }: { title: string; items: { label: string; count: number }[]; icon: any }) {
  if (!items || items.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-4 flex flex-col items-center justify-center min-h-[200px]">
        <Icon className="w-6 h-6 text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">데이터 없음</p>
      </div>
    );
  }
  const total = items.reduce((s, i) => s + i.count, 0);
  const data = items.slice(0, 6).map((it, i) => ({ ...it, fill: DONUT_COLORS[i % DONUT_COLORS.length] }));

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-violet-600" />
        <h5 className="text-sm font-semibold text-gray-800">{title}</h5>
      </div>
      <div className="grid grid-cols-2 gap-3 items-center">
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={36} outerRadius={62} paddingAngle={2} dataKey="count" nameKey="label">
                {data.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                formatter={(v: any) => Number(v).toLocaleString()}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5">
          {data.map((d, i) => {
            const pct = total > 0 ? (d.count / total) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: d.fill }} />
                <span className="text-gray-600 truncate flex-1">{d.label}</span>
                <span className="font-mono font-semibold text-gray-800 tabular-nums shrink-0">{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 내부 컴포넌트: 전체 확장 분포 리스트 ───

function DistributionList({ items }: { items: { label: string; count: number }[] }) {
  if (!items || items.length === 0) {
    return <div className="bg-gray-50 rounded-2xl p-6 text-center text-sm text-gray-400">데이터 없음</div>;
  }
  const max = Math.max(...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3 shadow-sm">
      {items.map((it, i) => {
        const pct = total > 0 ? (it.count / total) * 100 : 0;
        const barWidth = max > 0 ? (it.count / max) * 100 : 0;
        return (
          <div key={`${it.label}-${i}`}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-700 font-medium truncate max-w-[60%]">{it.label}</span>
              <span className="text-gray-900 font-semibold tabular-nums">
                {it.count.toLocaleString()}
                <span className="text-gray-400 font-normal ml-1.5 text-[11px]">({pct.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-500 rounded-full transition-all duration-700"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 메인 ───

export default function CardDetailModal({ card, onClose }: CardDetailModalProps) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const theme = useMemo(() => (card ? CARD_THEMES[card.cardId] || DEFAULT_THEME : DEFAULT_THEME), [card]);
  const ThemeIcon = theme.IconComp;

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

  // ESC 키 닫기
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const isBirthday = card.cardId === 'birthday_this_month';
  const isDistribution = card.type === 'distribution';
  const numVal = typeof card.value === 'number' ? card.value : 0;
  const suffix = card.type === 'rate' ? '%' : card.type === 'sum' ? '원' : card.cardId === 'active_campaigns' ? '건' : '명';
  const displayVal = card.type === 'rate' ? numVal.toFixed(1) : numVal.toLocaleString();

  // 1-click 액션 핸들러
  const goAiOperator = () => {
    sessionStorage.setItem('ai_operator_prefill_objective', theme.oneClickObjective);
    navigate('/ai-operator');
  };
  const goDirectSend = () => {
    sessionStorage.setItem('direct_send_prefill_card', card.cardId);
    navigate('/?openDirectSend=1');
    onClose();
  };
  const goSegment = () => {
    sessionStorage.setItem('segment_prefill_card', card.cardId);
    navigate('/segments');
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-0 md:p-4 animate-[fadeIn_0.18s_ease-out]"
    >
      <div
        className="bg-white w-full md:max-w-5xl md:rounded-3xl md:max-h-[90vh] max-h-screen overflow-hidden flex flex-col shadow-2xl animate-[zoomIn_0.22s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 sticky */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
          <div className="p-5 md:p-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${theme.gradient} flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0`}>
                <ThemeIcon className="w-6 h-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-lg md:text-xl font-bold text-gray-900 truncate">{card.label}</h3>
                  <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                    <Sparkles className="w-2.5 h-2.5" />
                    AI 분석
                  </span>
                </div>
                <p className="text-xs text-gray-500 italic">Data source — customers DB / 최근 6개월 기준</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-2xl hover:bg-gray-100 text-gray-500 flex items-center justify-center transition-colors shrink-0"
              aria-label="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 바디 */}
        <div className="flex-1 overflow-y-auto px-5 md:px-7 py-6 bg-gradient-to-b from-gray-50/60 to-white">
          {loading && !detail ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Sparkles className="w-8 h-8 text-violet-400 animate-pulse" />
              <span className="text-sm text-gray-500">불러오는 중...</span>
            </div>
          ) : detail?.blocked ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertCircle className="w-10 h-10 text-gray-300" />
              <p className="text-sm text-gray-500">접근 권한이 없습니다.</p>
            </div>
          ) : (
            <>
              {/* 1. AI 자율 진단 카드 (violet → fuchsia 그라데이션) */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 p-6 mb-6 shadow-lg shadow-violet-500/30">
                <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -bottom-16 -left-12 w-56 h-56 rounded-full bg-fuchsia-400/20 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold tracking-wider text-white/95 uppercase">AI 자율 진단</span>
                  </div>
                  <h4 className="text-lg md:text-xl font-bold text-white mb-2">{theme.insightTitle}</h4>
                  <p className="text-sm md:text-base text-white/90 leading-relaxed mb-4">{theme.insightDesc(numVal)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-300" />
                    <span className="text-xs text-yellow-100 font-medium">추천 — {theme.recommend}</span>
                  </div>
                </div>
              </div>

              {/* 2. 요약 메트릭 (현재 + 지난달 대비) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <div className="md:col-span-2 bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <p className="text-xs text-gray-500 font-medium mb-2">현재 값</p>
                  <p className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight tabular-nums">
                    {displayVal}
                    <span className="text-base font-normal text-gray-400 ml-1">{suffix}</span>
                  </p>
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                  <p className="text-xs text-gray-500 font-medium mb-2">지난달 대비</p>
                  {card.hasTrend && card.delta !== null && card.delta !== undefined ? (
                    <DeltaBadge delta={card.delta} deltaPercent={card.deltaPercent} baseline={card.deltaBaseline} suffix={suffix} size="md" />
                  ) : (
                    <p className="text-sm text-gray-400">데이터 부족</p>
                  )}
                </div>
              </div>

              {/* 3. 6개월 추이 AreaChart (violet 그라데이션 강조) */}
              {detail?.trend && detail.trend.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-violet-600" />
                    최근 6개월 추이
                  </h4>
                  <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm" style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <AreaChart data={detail.trend} margin={{ top: 10, right: 18, left: -6, bottom: 5 }}>
                        <defs>
                          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          axisLine={{ stroke: '#e5e7eb' }}
                          tickLine={false}
                          tickFormatter={(v: string) => v.slice(5)}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                          contentStyle={{
                            fontSize: 12,
                            borderRadius: 12,
                            border: '1px solid #e5e7eb',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
                          }}
                          labelStyle={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}
                          formatter={(v: any) => [Number(v).toLocaleString(), card.label]}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="#8b5cf6"
                          strokeWidth={2.5}
                          fill="url(#trendGradient)"
                          dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }}
                          activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* 4. breakdown 도넛 차트 4건 (성별 + 연령대 + 등급 + 지역) */}
              {detail?.breakdown && !isBirthday && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-violet-600" />
                    세그먼트 분포
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <DonutCard title="성별" items={detail.breakdown.byGender} icon={Users} />
                    <DonutCard title="연령대" items={detail.breakdown.byAge} icon={BarChart3} />
                    <DonutCard title="등급" items={detail.breakdown.byGrade} icon={Layers} />
                    <DonutCard title="지역" items={detail.breakdown.byRegion} icon={MapPin} />
                  </div>
                </div>
              )}

              {/* 5. 생일 카드 = 고객 리스트 */}
              {isBirthday && detail?.topList && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Cake className="w-4 h-4 text-amber-500" />
                    이번 달 생일 고객 ({detail.topList.total.toLocaleString()}명)
                  </h4>
                  <div className="bg-white border border-gray-100 rounded-2xl p-2 shadow-sm">
                    <BirthdayCustomerList initialData={detail.topList} cardId={card.cardId} />
                  </div>
                </div>
              )}

              {/* 6. distribution 카드 = 전체 확장 리스트 */}
              {isDistribution && detail?.fullDistribution && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-violet-600" />
                    전체 분포
                  </h4>
                  <DistributionList items={detail.fullDistribution} />
                </div>
              )}

              {/* 7. 1-click 액션 카드 3 영역 (rose 직접 발송 + emerald 세그먼트 + violet AI Operator) */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  1-click 액션 — 본 데이터로 즉시 캠페인
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* 직접 발송 (rose) */}
                  <button
                    onClick={goDirectSend}
                    className="group relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-4 text-left transition-all hover:shadow-lg hover:shadow-rose-200/40 hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-md shadow-rose-500/30">
                        <Send className="w-5 h-5 text-white" />
                      </div>
                      <ArrowRight className="w-4 h-4 text-rose-400 group-hover:translate-x-1 transition-transform" />
                    </div>
                    <p className="text-sm font-bold text-rose-900 mb-1">직접 타겟 발송</p>
                    <p className="text-xs text-rose-700/80 leading-relaxed">본 데이터를 필터 조건으로 즉시 발송 진입</p>
                  </button>

                  {/* 세그먼트 신설 (emerald) */}
                  <button
                    onClick={goSegment}
                    className="group relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 text-left transition-all hover:shadow-lg hover:shadow-emerald-200/40 hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/30">
                        <Layers className="w-5 h-5 text-white" />
                      </div>
                      <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
                    </div>
                    <p className="text-sm font-bold text-emerald-900 mb-1">세그먼트 저장</p>
                    <p className="text-xs text-emerald-700/80 leading-relaxed">재활용 가능한 세그먼트로 저장</p>
                  </button>

                  {/* AI Operator (violet — 강조) */}
                  <button
                    onClick={goAiOperator}
                    className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 p-4 text-left shadow-lg shadow-violet-500/30 transition-all hover:shadow-xl hover:shadow-violet-500/40 hover:-translate-y-0.5"
                  >
                    <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10 blur-2xl" />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <ArrowRight className="w-4 h-4 text-white/80 group-hover:translate-x-1 transition-transform" />
                      </div>
                      <p className="text-sm font-bold text-white mb-1">AI Operator로 진입</p>
                      <p className="text-xs text-white/85 leading-relaxed">자연어 한 줄로 AI가 자동 설계</p>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 푸터 sticky */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 md:px-7 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>

      {/* 애니메이션 정의 (Tailwind 안 keyframes 직접 정의) */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
