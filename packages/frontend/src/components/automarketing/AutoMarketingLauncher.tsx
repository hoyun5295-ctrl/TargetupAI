// 자동마케팅 런처 — 시작 방법 4개(2×2) + 브리핑 + 실행 중 관리 진입 (2026-06-27)
// 타일은 라벨만 있는 액션이라 가운데 정렬, 브리핑은 읽는 글이라 좌측 정렬.
import { ReactNode } from 'react';
import { Sparkles, MessageSquare, LayoutGrid, SlidersHorizontal, ChevronRight, Bot } from 'lucide-react';

interface Props {
  pendingCount: number;
  activeCount: number;
  onOpenRecommendations: () => void;
  onOpenNatural: () => void;
  onOpenScenario: () => void;
  onOpenAdvanced: () => void;
  onManage: () => void;
}

export default function AutoMarketingLauncher({
  pendingCount, activeCount,
  onOpenRecommendations, onOpenNatural, onOpenScenario, onOpenAdvanced, onManage,
}: Props) {
  return (
    <div>
      <div className="text-sm text-white/60 mb-4 text-center">시작 방법을 골라 가볍게 출발하세요</div>

      <div className="grid grid-cols-2 gap-3">
        <Tile featured icon={<Sparkles className="w-5 h-5" />} title="오늘의 추천 마케팅" badge={pendingCount > 0 ? `대기 ${pendingCount}건` : undefined} onClick={onOpenRecommendations} />
        <Tile icon={<MessageSquare className="w-5 h-5" />} title="자연어로 시작" onClick={onOpenNatural} />
        <Tile icon={<LayoutGrid className="w-5 h-5" />} title="시나리오로 시작" onClick={onOpenScenario} />
        <Tile icon={<SlidersHorizontal className="w-5 h-5" />} title="세부설정으로 시작" onClick={onOpenAdvanced} />
      </div>

      <div className="mt-6">
        <div className="text-xs text-white/40 mb-1">이렇게 시작합니다</div>
        <Brief accent icon={<Sparkles className="w-4 h-4" />} title="오늘의 추천 마케팅" desc="매일 아침 AI가 회사 데이터를 분석해 가장 효과 큰 캠페인을 띄웁니다. 기대 매출·등급별 전환·안전 검수까지 보고 승인만 하면 발송됩니다." />
        <Brief icon={<MessageSquare className="w-4 h-4" />} title="자연어로 시작" desc={'"VIP 중 30일 미구매 고객 재구매 유도" 한 줄만 쓰면 AI가 타겟·채널·발송 시각·문안 초안까지 자동으로 잡습니다.'} />
        <Brief icon={<LayoutGrid className="w-4 h-4" />} title="시나리오로 시작" desc="검증된 시나리오를 골라 한 번에 시작합니다. 세부 항목은 미리 채워져 있어 가동 전 한 번만 확인합니다." />
        <Brief icon={<SlidersHorizontal className="w-4 h-4" />} title="세부설정으로 시작" desc="채널·주기·예산·담당자 알림·다단계 시퀀스까지 직접 잡는 풀 컨트롤. 정교한 운영이 필요할 때 씁니다." />
      </div>

      <button onClick={onManage} className="mt-6 w-full flex items-center gap-2.5 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors">
        <Bot className="w-4 h-4 text-indigo-300 shrink-0" />
        <span className="text-sm text-white/80">실행 중인 자동 마케팅</span>
        <span className="text-sm text-white font-medium tabular-nums">{activeCount}</span>
        <ChevronRight className="w-4 h-4 text-white/40 ml-auto shrink-0" />
      </button>
    </div>
  );
}

function Tile({ featured, icon, title, badge, onClick }: { featured?: boolean; icon: ReactNode; title: string; badge?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center text-center rounded-xl px-3 py-6 min-h-[120px] border transition-colors ${featured ? 'bg-indigo-500/10 border-indigo-400/40 hover:bg-indigo-500/15' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
    >
      {badge && <span className="absolute top-2.5 right-2.5 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{badge}</span>}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${featured ? 'bg-indigo-500 text-white' : 'bg-white/5 text-white/70'}`}>{icon}</div>
      <div className="mt-3 text-sm font-medium text-white">{title}</div>
    </button>
  );
}

function Brief({ icon, accent, title, desc }: { icon: ReactNode; accent?: boolean; title: string; desc: string }) {
  return (
    <div className="flex gap-3 py-3 border-t border-white/5 first:border-t-0">
      <div className={`mt-0.5 shrink-0 ${accent ? 'text-indigo-300' : 'text-white/40'}`}>{icon}</div>
      <div>
        <div className="text-[13px] font-medium text-white">{title}</div>
        <div className="text-xs text-white/55 leading-relaxed mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
