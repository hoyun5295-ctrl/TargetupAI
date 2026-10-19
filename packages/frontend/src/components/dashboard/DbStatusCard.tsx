/**
 * DbStatusCard.tsx — 대시보드 「DB 현황」 칸 (★ 2026-10-19 Dashboard.tsx 에서 옮김 · 칸 → 목록 · docs/2026-10-19-dashboard-four-cards-design.md §2-3)
 *
 * 한 쪽 6개 · 쪽 넘김 · 기준 시각 · 상세보기 · 줄 누르면 상세 창 · 미설정 / 미업로드 / 데이터 없음 = 옛 칸 그대로.
 * 줄 = 아이콘(카드별 색) · 이름(두 줄까지 단어 단위 · Harold 「글씨 깨지면 별로」) · 증감(%) · 값(한 줄).
 * 값 표기(명 · 건 · % · 만원) = 옛 칸 원본 그대로 · 분포 = 1위 항목 수 + 아래 줄 「1위 이름」.
 */
import {
  Users, User, Cake, Calendar, BarChart3, Award, MapPin, Store, Mail, DollarSign, ShoppingCart, UserX, UserPlus, BellOff, Bell, Send, CreditCard, HelpCircle, Percent,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import CountUp from './CountUp';
import DeltaBadge from './DeltaBadge';
import { ENTER_ONCE, topByCount } from '../../utils/dashboard-live';
import { formatKstClock } from '../../utils/formatDate';
import { DASH_CARD, DashCardHead, DashHeadLink, DashSource } from './dash-card';

export interface DashboardCardData {
  cardId: string;
  label: string;
  type: string;
  icon: string;
  value: number | { label: string; count: number }[];
  hasData: boolean;
  // ★ D132 Phase A: 델타 뱃지
  delta?: number | null;
  deltaPercent?: number | null;
  deltaBaseline?: string;
  hasTrend?: boolean;
}

export interface DashboardCardsResponse {
  configured: boolean;
  cardCount: number;
  hasCustomerData?: boolean;
  cards: DashboardCardData[];
  /** ★ 2026-10-10 서버 계산 시각(epoch ms) — 캐시 값이면 그 값을 계산한 때 */
  asOf?: number | null;
}

// D41 대시보드 동적 카드 아이콘 맵
const CARD_ICON_MAP: Record<string, any> = {
  Users, User, Cake, Calendar, BarChart3, Award, MapPin, Store, Mail, DollarSign, ShoppingCart, UserX, UserPlus, BellOff, Bell, Send, CreditCard, HelpCircle, Percent,
};

// 카드별 색 매핑 (cardId 기반 — 아이콘 톤 통일)
const CARD_ACCENT_MAP: Record<string, { iconFrom: string; iconTo: string; iconText: string; ring: string }> = {
  total_customers:     { iconFrom: 'from-violet-100',  iconTo: 'to-violet-50',   iconText: 'text-violet-600',  ring: 'ring-violet-100' },
  gender_male:         { iconFrom: 'from-blue-100',    iconTo: 'to-blue-50',     iconText: 'text-blue-600',    ring: 'ring-blue-100' },
  gender_female:       { iconFrom: 'from-pink-100',    iconTo: 'to-pink-50',     iconText: 'text-pink-600',    ring: 'ring-pink-100' },
  birthday_this_month: { iconFrom: 'from-amber-100',   iconTo: 'to-amber-50',    iconText: 'text-amber-600',   ring: 'ring-amber-100' },
  opt_in_count:        { iconFrom: 'from-emerald-100', iconTo: 'to-emerald-50',  iconText: 'text-emerald-600', ring: 'ring-emerald-100' },
  new_this_month:      { iconFrom: 'from-cyan-100',    iconTo: 'to-cyan-50',     iconText: 'text-cyan-600',    ring: 'ring-cyan-100' },
  recent_30d_purchase: { iconFrom: 'from-emerald-100', iconTo: 'to-emerald-50',  iconText: 'text-emerald-600', ring: 'ring-emerald-100' },
  inactive_90d:        { iconFrom: 'from-rose-100',    iconTo: 'to-rose-50',     iconText: 'text-rose-600',    ring: 'ring-rose-100' },
  monthly_cost:        { iconFrom: 'from-violet-100',  iconTo: 'to-violet-50',   iconText: 'text-violet-600',  ring: 'ring-violet-100' },
  age_distribution:    { iconFrom: 'from-violet-100',  iconTo: 'to-violet-50',   iconText: 'text-violet-600',  ring: 'ring-violet-100' },
  grade_distribution:  { iconFrom: 'from-amber-100',   iconTo: 'to-amber-50',    iconText: 'text-amber-600',   ring: 'ring-amber-100' },
  region_top:          { iconFrom: 'from-cyan-100',    iconTo: 'to-cyan-50',     iconText: 'text-cyan-600',    ring: 'ring-cyan-100' },
  store_distribution:  { iconFrom: 'from-indigo-100',  iconTo: 'to-indigo-50',   iconText: 'text-indigo-600',  ring: 'ring-indigo-100' },
};
const DEFAULT_ACCENT = { iconFrom: 'from-violet-100', iconTo: 'to-violet-50', iconText: 'text-violet-600', ring: 'ring-violet-100' };
const CARDS_PER_PAGE = 6;

/** 값 표기 = 옛 칸 그대로(rate = 소수 한 자리 · sum 1만 이상 = N만 · 그 밖 = 쉼표) */
const formatCardValue = (type: string, v: number) => (type === 'rate' ? v.toFixed(1)
  : type === 'sum' && v >= 10000 ? `${Math.round(v / 10000).toLocaleString()}만`
    : v.toLocaleString());
const cardSuffix = (card: DashboardCardData) => (card.type === 'rate' ? '%' : card.type === 'sum' ? '원' : card.cardId === 'active_campaigns' ? '건' : '명');

const ROW = 'w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-left min-w-0';

export default function DbStatusCard({
  data, asOf, page, onPage, animate, enterClass, onOpenDetail, onOpenCustomerDb, onUpload,
}: {
  data: DashboardCardsResponse | null;
  asOf: Date | null;
  page: number;
  onPage: (next: (p: number) => number) => void;
  /** 처음 열 때 · 첫 업로드 공개 때만 줄이 차례로 들어오고 숫자가 한 번 찬다(쪽을 넘긴 뒤에는 정지) */
  animate: boolean;
  enterClass: string;
  onOpenDetail: (card: DashboardCardData) => void;
  onOpenCustomerDb: () => void;
  onUpload: () => void;
}) {
  const icon = (card: DashboardCardData, muted = false) => {
    const accent = CARD_ACCENT_MAP[card.cardId] || DEFAULT_ACCENT;
    const IconComp = CARD_ICON_MAP[card.icon] || HelpCircle;
    return (
      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${muted ? 'bg-gray-50 ring-1 ring-gray-100' : `bg-gradient-to-br ${accent.iconFrom} ${accent.iconTo} ring-1 ${accent.ring}`}`}>
        <IconComp className={`w-3.5 h-3.5 ${muted ? 'text-gray-300' : accent.iconText}`} />
      </span>
    );
  };

  const row = (card: DashboardCardData, ci: number) => {
    const enter = animate ? ENTER_ONCE : '';
    const enterDelay = animate ? { animationDelay: `${240 + ci * 60}ms` } : undefined;
    // 데이터 없는 카드 = 누를 곳 없음 · 값 「-」
    if (!card.hasData) {
      return (
        <div key={card.cardId} className={`${ROW} ${enter}`} style={enterDelay}>
          {icon(card, true)}
          <span className="min-w-0 flex-1 text-[13px] text-gray-400 leading-snug break-keep">{card.label}</span>
          <span className="shrink-0 text-[13px] font-bold text-gray-300 whitespace-nowrap">-</span>
        </div>
      );
    }
    const isDist = card.type === 'distribution' && Array.isArray(card.value);
    // 1위 = 수가 가장 큰 항목(서버 배열 순서는 순위가 아니다 · 연령 분포 = 연령순)
    const top = isDist ? topByCount(card.value as { label: string; count: number }[]) : undefined;
    const numVal = typeof card.value === 'number' ? card.value : 0;
    return (
      <button key={card.cardId} type="button" onClick={() => onOpenDetail(card)} className={`${ROW} hover:bg-gray-50 transition-colors ${enter}`} style={enterDelay}>
        {icon(card)}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-gray-700 leading-snug break-keep">{card.label}</span>
          {isDist && top && <span className="block text-[11px] text-gray-400 leading-snug break-keep">1위 {top.label}</span>}
        </span>
        {!isDist && card.hasTrend && card.delta !== null && card.delta !== undefined && (
          <span className="shrink-0"><DeltaBadge compact delta={card.delta} deltaPercent={card.deltaPercent} baseline={card.deltaBaseline} suffix={cardSuffix(card)} /></span>
        )}
        <span className="shrink-0 text-[13px] font-bold text-gray-900 tabular-nums whitespace-nowrap">
          {isDist
            ? (top ? top.count.toLocaleString() : '-')
            : <CountUp value={numVal} format={(v) => formatCardValue(card.type, v)} decimals={card.type === 'rate' ? 1 : 0} animate={animate} />}
          {(!isDist || top) && <span className="ml-0.5 text-[10px] font-medium text-gray-400">{isDist ? '명' : cardSuffix(card)}</span>}
        </span>
      </button>
    );
  };

  const body = () => {
    // 카드 미설정
    if (!data || !data.configured) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
          <span className="w-10 h-10 rounded-xl bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center mb-2"><BarChart3 className="w-5 h-5 text-gray-300" /></span>
          <div className="text-xs text-gray-400 break-keep">관리자가 대시보드 카드를 설정하면 표시됩니다</div>
        </div>
      );
    }
    // 고객 DB 미업로드 — 흐림 + 업로드
    if (data.hasCustomerData === false) {
      return (
        <div className="relative flex-1">
          <div className="filter blur-sm pointer-events-none select-none" aria-hidden>
            {data.cards.slice(0, CARDS_PER_PAGE).map((card) => (
              <div key={card.cardId} className={ROW}>
                {icon(card, true)}
                <span className="min-w-0 flex-1 text-[13px] text-gray-300 break-keep">{card.label}</span>
                <span className="shrink-0 text-[13px] font-bold text-gray-200">0</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-[3px] rounded-xl px-3">
            <div className="text-center">
              <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-green-100 flex items-center justify-center mx-auto mb-2 shadow-inner"><Users className="w-5 h-5 text-emerald-500" /></span>
              <div className="text-xs text-gray-700 font-semibold mb-2.5 break-keep">고객 DB를 업로드하면 현황을 확인할 수 있습니다</div>
              <button type="button" onClick={onUpload} className="px-4 py-2 bg-gradient-to-r from-gray-900 to-gray-800 text-white text-xs font-bold rounded-xl hover:shadow-lg hover:shadow-gray-900/30 transition-all shadow-md">
                고객 DB 업로드
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (!data.hasCustomerData) return null;
    return <div className="-mx-1.5 -mt-1">{pageCards.map(row)}</div>;
  };

  // 정상 = 6개씩 쪽 넘김(쪽 넘김 · 출처 = 바닥 묶음)
  const normal = !!data?.configured && !!data.hasCustomerData;
  const totalPages = normal ? Math.ceil(data!.cards.length / CARDS_PER_PAGE) : 0;
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const pageCards = normal ? data!.cards.slice(safePage * CARDS_PER_PAGE, (safePage + 1) * CARDS_PER_PAGE) : [];
  const paging = () => (
    // 끝 쪽의 이전 · 다음은 그리지 않는다(누를 수 없는 버튼 · 자리만 비움)
    <div className="pt-2 flex items-center justify-between">
      {safePage > 0 ? (
        <button type="button" onClick={() => onPage((p) => Math.max(0, p - 1))} aria-label="이전 쪽" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-600 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      ) : <span className="w-7 h-7" aria-hidden />}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalPages }, (_, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => onPage(() => idx)}
            aria-label={`${idx + 1}쪽`}
            className={`h-1.5 rounded-full transition-all duration-500 ${idx === safePage ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 w-6' : 'bg-gray-200 w-1.5 hover:bg-gray-300'}`}
          />
        ))}
      </div>
      {safePage < totalPages - 1 ? (
        <button type="button" onClick={() => onPage((p) => Math.min(totalPages - 1, p + 1))} aria-label="다음 쪽" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-600 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      ) : <span className="w-7 h-7" aria-hidden />}
    </div>
  );

  return (
    <div className={`${DASH_CARD} ${enterClass}`} style={{ animationDelay: '180ms' }} data-card="db">
      <DashCardHead
        bar="bg-gradient-to-b from-emerald-500 to-green-600"
        title="DB 현황"
        extra={asOf ? (
          // ★ 2026-10-10 대시보드 B안 — 늘 깜빡이던 REAL-TIME 대신 불러온 시각(데이터와 상관없이 깜빡이면 거짓 신호)
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 tabular-nums whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {formatKstClock(asOf)} 기준
          </span>
        ) : undefined}
        right={<DashHeadLink label="상세보기" onClick={onOpenCustomerDb} />}
      />
      {body()}
      <div className="mt-auto">
        {normal && totalPages > 1 && paging()}
        <DashSource>고객 DB 집계{data?.configured ? ' · 관리자가 고른 카드' : ''}</DashSource>
      </div>
    </div>
  );
}
