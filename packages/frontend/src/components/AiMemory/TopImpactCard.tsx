/**
 * TopImpactCard.tsx — AI 메모리 영향도 top 10 카드 view (D217+ 2026-05-25)
 *
 * Journey Builder 동급 디자인 — 카드 view (table view 폐기).
 * 회사 admin은 카드 직접 삭제 가능 (rose Trash2 버튼).
 */

import { Activity, Trash2 } from 'lucide-react';

export type MemoryType =
  | 'success_pattern'
  | 'customer_insight'
  | 'brand_tone_evolution'
  | 'channel_performance'
  | 'compliance_learning';

export interface TopImpactMemory {
  id: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance: number;
  source: string;
  usageCount: number;
  lastAccessedAt: string;
  createdAt: string;
}

const TYPE_META: Record<string, { label: string; gradient: string; badgeBg: string; badgeText: string }> = {
  success_pattern:        { label: '성공 패턴',          gradient: 'from-emerald-400 to-teal-500',  badgeBg: 'bg-emerald-500/20',  badgeText: 'text-emerald-200' },
  customer_insight:       { label: '고객 인사이트',      gradient: 'from-sky-400 to-cyan-500',      badgeBg: 'bg-sky-500/20',      badgeText: 'text-sky-200' },
  brand_tone_evolution:   { label: '브랜드 톤',          gradient: 'from-violet-400 to-purple-500', badgeBg: 'bg-violet-500/20',   badgeText: 'text-violet-200' },
  channel_performance:    { label: '채널 성과',          gradient: 'from-amber-400 to-orange-500',  badgeBg: 'bg-amber-500/20',    badgeText: 'text-amber-200' },
  compliance_learning:    { label: '컴플라이언스 학습',  gradient: 'from-rose-400 to-pink-500',     badgeBg: 'bg-rose-500/20',     badgeText: 'text-rose-200' },
};

// ★ D227+ defense-in-depth — 미지의 memory_type이 와도 전체 화면 blank(크래시) 차단
const FALLBACK_META = { label: '학습', gradient: 'from-slate-400 to-slate-500', badgeBg: 'bg-white/10', badgeText: 'text-white/70' };

interface Props {
  memory: TopImpactMemory;
  rank: number;
  canDelete: boolean;
  onDelete: (id: string) => void;
}

export default function TopImpactCard({ memory, rank, canDelete, onDelete }: Props) {
  const meta = TYPE_META[memory.memoryType] || FALLBACK_META;
  const lastUsed = new Date(memory.lastAccessedAt);
  const daysAgo = Math.max(0, Math.floor((Date.now() - lastUsed.getTime()) / 86_400_000));
  const lastUsedLabel = daysAgo === 0 ? '오늘 사용' : `${daysAgo}일 전 사용`;

  return (
    <div className="group p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/[0.07] hover:border-white/20 transition-all">
      <div className="flex items-start gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
          #{rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.badgeBg} ${meta.badgeText}`}>
              {meta.label}
            </span>
            <span className="text-[10px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full">
              중요도 {memory.importance}
            </span>
            {memory.usageCount > 0 && (
              <span className="text-[10px] bg-violet-500/20 text-violet-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <Activity className="w-2.5 h-2.5" />
                AI 활용 {memory.usageCount}회
              </span>
            )}
            <span className="text-[10px] text-white/40">{lastUsedLabel}</span>
          </div>
          <div className="text-sm font-medium text-white truncate" title={memory.memoryKey}>
            {memory.memoryKey}
          </div>
        </div>
        {canDelete && (
          <button
            onClick={() => onDelete(memory.id)}
            className="p-1.5 rounded-md text-white/40 hover:text-rose-200 hover:bg-rose-500/20 transition-colors opacity-0 group-hover:opacity-100"
            title="삭제"
            aria-label="메모리 삭제"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div
        className="text-xs text-white/70 leading-relaxed overflow-hidden"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {memory.memoryValue}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 max-w-[100px] h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full ${
              memory.importance >= 8 ? 'bg-emerald-400' :
              memory.importance >= 5 ? 'bg-amber-400' :
              'bg-white/30'
            }`}
            style={{ width: `${(memory.importance / 10) * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-white/40">{memory.importance}/10</span>
        <span className="ml-auto text-[10px] text-white/40">{memory.source}</span>
      </div>
    </div>
  );
}
