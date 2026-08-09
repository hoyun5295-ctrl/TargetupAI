/**
 * components/cdp/CdpIntegrationDashboard.tsx — 자사몰 연동 현황판 (★2026-08-10 Phase 2)
 *
 * 설계서 = docs/2026-08-09-cdp-integration-redesign-design.md
 *   1층 현황판 = §5-1 · 배지 5종 = §5-1-1 · 시인성 수치 규격 = §5-5
 *
 * 이 컴포넌트가 지키는 것(어기면 설계 위반):
 *   - **카드는 4줄·버튼 1개.** 그 이상 담고 싶으면 2층(진행 패널)으로 민다.
 *   - **1층에 코드 블록 0개.** 스크립트·웹훅 규격은 여기 없다.
 *   - **상태는 색이 아니라 문장으로 말한다.** 배지 문구는 훅이 소유하고 여기선 그리기만 한다.
 *   - **색만으로 구분하지 않는다.** 배지마다 아이콘+문구를 함께 둔다(접근성).
 *
 * 판정 로직을 여기서 다시 계산하지 않는다 — useCdpIntegrationStatus 하나가 소유한다.
 */

import { Check, Clock, Loader2, RefreshCw, AlertTriangle, Circle, ChevronRight } from 'lucide-react';
import type { CdpProviderKey } from '../../utils/cdp-provider-keys';
import type { CdpIntegrationBadge, CdpProviderStatus } from '../../hooks/useCdpIntegrationStatus';

/** 배지의 겉모습 — 의미(문구)는 훅이, 픽셀은 여기가 소유한다. */
const BADGE_VIEW: Record<CdpIntegrationBadge, { chip: string; Icon: typeof Check }> = {
  receiving: { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25', Icon: Check },
  awaiting: { chip: 'bg-amber-500/15 text-amber-200 border-amber-400/25', Icon: Clock },
  preparing: { chip: 'bg-violet-500/15 text-violet-200 border-violet-400/25', Icon: Loader2 },
  action: { chip: 'bg-rose-500/15 text-rose-200 border-rose-400/25', Icon: AlertTriangle },
  disconnected: { chip: 'bg-white/[0.06] text-white/45 border-white/12', Icon: Circle },
};

/** 카드 버튼 문구 — 상태가 정한다. 무엇을 눌러야 할지 고민할 순간을 만들지 않는다(§5-1). */
const ACTION_LABEL: Record<CdpIntegrationBadge, string> = {
  receiving: '상태 보기',
  awaiting: '이어서 설정',
  preparing: '상태 보기',
  action: '조치하기',
  disconnected: '연결하기',
};

export interface CdpDashboardProvider {
  key: CdpProviderKey;
  name: string;
  desc: string;
}

export interface CdpIntegrationDashboardProps {
  providers: CdpDashboardProvider[];
  statuses: Record<CdpProviderKey, CdpProviderStatus>;
  summary: { receiving: number; preparing: number; action: number };
  /** 페이지가 이미 가진 브랜드 아이콘 헬퍼를 그대로 받는다 — 아이콘 표를 여기 다시 만들지 않는다. */
  brand: (key: string, name: string) => { Icon: typeof Check; badge: string };
  onOpen: (key: CdpProviderKey) => void;
  onRefresh?: () => void;
  loading?: boolean;
}

function SummaryTile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="flex-1 min-w-[104px] rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className={`text-2xl font-bold leading-none ${tone}`}>{n}</div>
      <div className="text-[11px] text-white/45 mt-1.5">{label}</div>
    </div>
  );
}

export default function CdpIntegrationDashboard({
  providers, statuses, summary, brand, onOpen, onRefresh, loading,
}: CdpIntegrationDashboardProps) {
  return (
    <section className="space-y-4">
      {/* 요약 지표 3개 — 숫자만 크게, 설명은 작게(§5-1) */}
      <div className="flex flex-wrap items-stretch gap-2.5" aria-live="polite">
        <SummaryTile n={summary.receiving} label="데이터 수신 중" tone="text-emerald-300" />
        <SummaryTile n={summary.preparing} label="연동 준비 중" tone="text-violet-200" />
        <SummaryTile n={summary.action} label="조치 필요" tone="text-rose-200" />
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80 hover:border-white/25 transition-colors disabled:opacity-40"
            title="상태 새로고침"
            aria-label="연동 상태 새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* 몰 카드 — 모바일 1열 / md 2열 / lg 3열. 카드 1장 = 4줄 + 버튼 1개 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map((p) => {
          const st = statuses[p.key];
          if (!st) return null;
          const view = BADGE_VIEW[st.badge];
          const { Icon: BrandIcon, badge: brandBadge } = brand(p.key, p.name);
          const BadgeIcon = view.Icon;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onOpen(p.key)}
              aria-label={`${p.name} — ${st.label}. ${ACTION_LABEL[st.badge]}`}
              className="group flex flex-col gap-3 p-4 rounded-2xl border border-white/10 bg-white/[0.03] text-left transition-all duration-200 hover:border-violet-400/40 hover:bg-white/[0.06] hover:-translate-y-0.5"
            >
              {/* 1줄 — 아이콘 + 이름 */}
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg bg-gradient-to-br ${brandBadge}`}>
                  <BrandIcon className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-white truncate">{p.name}</div>
              </div>

              {/* 2줄 — 상태 배지(색 + 아이콘 + 문장) */}
              <span className={`self-start inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-medium ${view.chip}`}>
                <BadgeIcon className={`w-3 h-3 ${st.badge === 'preparing' ? 'animate-spin' : ''}`} />
                {st.label}
              </span>

              {/* 3줄 — 한 줄 요약 */}
              <p className="text-[11.5px] text-white/45 leading-relaxed line-clamp-2">{p.desc}</p>

              {/* 4줄 — 액션 1개 */}
              <div className="mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-violet-200 group-hover:text-violet-100">
                {ACTION_LABEL[st.badge]}
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
