/**
 * DashboardActionRow.tsx — 대시보드 맨 위 버튼 줄 (★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §3)
 *
 * Harold 1018: 「오른쪽 3개를 걷어내고 위에 3열 그리드로 · 상단 메뉴는 그대로」.
 * 옛 오른쪽 40% 세로 버튼 열(0707 확정 3색 그라데이션 · 글래스 칩 · 원형 화살표)을 같은 폭 한 줄로 옮겼다 — 높이만 줄였다.
 * 버튼마다의 누름 동작 · 잠금 판정은 대시보드가 그대로 넘긴다(이 부품은 모양만 소유).
 * 모바일 = 한 줄 작은 타일(아이콘 + 이름) · 4개면 2열 두 줄.
 * ⛔ 이모지 0(잠김 = 자물쇠 아이콘) · 줄표 0 · 모델명 0.
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, Lock } from 'lucide-react';

export type DashboardActionTone = 'violet' | 'emerald' | 'amber' | 'sky';

export interface DashboardAction {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  tone: DashboardActionTone;
  onClick: () => void;
  locked?: boolean;
  /** 「자동화 n개 작동 중」 같은 상태 배지(있을 때만) */
  badge?: string | null;
}

const TONE: Record<DashboardActionTone, string> = {
  violet: 'bg-gradient-to-br from-violet-700 via-purple-700 to-fuchsia-600 hover:from-violet-600 hover:via-purple-600 hover:to-fuchsia-500 shadow-violet-500/25 hover:shadow-violet-500/40',
  emerald: 'bg-gradient-to-br from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-500/25 hover:shadow-emerald-500/40',
  amber: 'bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-amber-500/25 hover:shadow-amber-500/40',
  sky: 'bg-gradient-to-br from-sky-600 to-blue-500 hover:from-sky-500 hover:to-blue-400 shadow-sky-500/25 hover:shadow-sky-500/40',
};

const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

export default function DashboardActionRow({ actions, enterClass = '' }: { actions: DashboardAction[]; enterClass?: string }) {
  if (actions.length === 0) return null;
  return (
    <div className={`grid gap-2.5 sm:gap-4 mb-4 ${COLS[actions.length] || 'grid-cols-3'}`} data-zone="dashboard-actions">
      {actions.map((a, i) => {
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            type="button"
            onClick={a.onClick}
            className={`group relative overflow-hidden rounded-xl ring-1 ring-white/20 shadow-lg hover:shadow-xl transition-all text-left text-white
              p-3 sm:px-4 sm:py-0 sm:h-[84px] flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3
              ${TONE[a.tone]} ${a.locked ? 'opacity-60' : ''} ${enterClass}`}
            style={{ animationDelay: `${60 + i * 60}ms` }}
          >
            <span className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
            <span className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Icon className="w-[18px] h-[18px] sm:w-5 sm:h-5 text-white" />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] sm:text-[15px] lg:text-[17px] font-bold leading-tight whitespace-nowrap min-w-0">
                {a.locked && <Lock className="w-3.5 h-3.5 shrink-0" aria-label="잠김" />}
                <span className="truncate">{a.label}</span>
              </span>
              {/* ★ 2026-10-19 배지는 설명 줄 자리에(제목 줄에 두면 좁은 폭에서 제목을 밀어내 두 줄로 깨졌다 · Harold 1019 실화면) */}
              {a.badge ? (
                <span className="hidden sm:flex items-center gap-1.5 mt-1 text-[12.5px] font-semibold text-white/90 min-w-0">
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  <span className="truncate">{a.badge}</span>
                </span>
              ) : (
                <span className="hidden sm:block mt-0.5 text-[13px] text-white/80 truncate">{a.desc}</span>
              )}
            </span>
            <span className="relative hidden md:flex w-8 h-8 rounded-full bg-white/15 ring-1 ring-white/25 items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform">
              <ChevronRight className="w-[18px] h-[18px] text-white" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
