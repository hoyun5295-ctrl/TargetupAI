/**
 * ZoneStartCards.tsx — 시작 카드 한 줄(★ 2026-09-30 AI 존 보정 · Harold "시나리오로 시작 같은 게 칩으로 작게 있으니 전혀 눈에 안 띈다")
 *
 * 옛 화면에서 큰 타일·목적 카드·큰 [만들기]였던 입구가 명령 카드 아랫줄 칩(13px)으로 줄었던 것을 되돌린다.
 * 카드 = 색 아이콘 44 + 제목 15 + 한 줄 설명 12.5 · 추천 1장은 메뉴 색 옅은 바탕 + 배지. 개수에 따라 폭을 고르게 나눈다.
 * "그 밖에" = 자주 쓰지 않는 입구를 작은 외곽선 버튼으로(흩어진 칩·접힌 패널 대신 한 줄).
 */
import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ZoneAction } from './ZoneHeader';
import { useZoneModule, zoneFeatured } from './zone-color';

export interface ZoneStartItem {
  icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
  /** 아이콘 타일 그라데이션(글자 그대로 · 예: 'from-sky-400 to-indigo-500') */
  tint: string;
  featured?: boolean;
  badge?: string;
  disabled?: boolean;
}

const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};
const BTN_MORE = 'h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function ZoneStartCards({ items, more = [] }: { items: ZoneStartItem[]; more?: ZoneAction[] }) {
  const moduleId = useZoneModule();
  const featured = moduleId ? zoneFeatured(moduleId) : null;
  return (
    <div data-zone="start">
      {items.length > 0 && (
        <div className={`grid gap-3 ${COLS[Math.min(items.length, 4)]}`}>
          {items.map((it) => (
            <button
              key={it.title}
              type="button"
              onClick={it.onClick}
              disabled={it.disabled}
              className={`group text-left rounded-2xl border p-5 flex items-start gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_40px_-16px_rgba(15,23,42,0.32)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${it.featured && featured ? featured.card : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <span className={`w-11 h-11 rounded-xl bg-gradient-to-br ${it.tint} text-white flex items-center justify-center shrink-0 shadow-md`}>
                <it.icon className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="text-[15px] font-semibold text-slate-900 break-keep">{it.title}</b>
                  {it.badge && <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${featured ? featured.badge : 'bg-indigo-600 text-white'}`}>{it.badge}</span>}
                  <ArrowRight className="ml-auto w-[18px] h-[18px] text-slate-400 shrink-0 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                </span>
                <span className="block text-[12.5px] text-slate-500 mt-1 leading-snug break-keep">{it.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {more.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-slate-400 mr-1">그 밖에</span>
          {more.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled} className={BTN_MORE}>
              {a.icon && <a.icon className="w-[14px] h-[14px] text-slate-400" />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
