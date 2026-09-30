/**
 * ZoneFrame.tsx — AI 존 화면의 틀(★ 2026-09-30 AI 존 대개편 · ★ 같은 날 보정 · 설계서 §3 · §11)
 *
 * Harold "메뉴가 다 진짜 너무 제각각 … 본연의 기능은 잘 활용하면서 메뉴들의 이질감이 없도록".
 * 그래서 **같아야 할 틀은 이 부품이 전부 그리고, 화면은 작업면(children)만 채운다.**
 *   ① 남색 머리 띠(ZoneHeader · 메뉴 색 빛 · 오른쪽 = 숫자 타일/탭) ② 띠 경계에 걸친 명령 카드(ZoneCommand)
 *   ③ 차단 상자 ④ 시작 카드(옛 큰 입구 자리 · ZoneStartCards) ⑤ 강조 카드(≤1) ⑥ 작업면
 * 보정(Harold 0930 "칩으로 작게 있으니 안 보인다 · 공간이 남는데 한쪽에 몰았다 · 너무 단조롭다"):
 *   입구 = 시작 카드 · 숫자·탭 = 머리 띠 오른쪽 · 메뉴 색 = 띠 빛·시작 카드·절 표지 · flow 폭은 가운데 정렬.
 * 밝은 작업대라는 사실을 문맥으로 내려 준다(SurfaceToneProvider) — 여기서 뜨는 공용 창이 밝게 따라온다.
 *
 * ⛔ className prop 없음 · 폭은 3가지(desk 1240 / flow 1240 안 가운데 768 / full 캔버스)뿐.
 */
import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import ZoneHeader, { type ZoneAction, type ZoneHeaderProps } from './ZoneHeader';
import ZoneCommand, { type ZoneCommandProps } from './ZoneCommand';
import ZoneStartCards, { type ZoneStartItem } from './ZoneStartCards';
import { SurfaceToneProvider } from './surface-tone';
import { ZoneModuleContext, zoneBand } from './zone-color';

export interface ZoneBlockItem {
  text: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'amber' | 'rose';
}

export interface ZoneFrameProps extends Omit<ZoneHeaderProps, 'paint' | 'full'> {
  command?: ZoneCommandProps | null;
  blocks?: ZoneBlockItem[];
  /** 시작 카드 한 줄 + "그 밖에" 작은 버튼 */
  start?: { items: ZoneStartItem[]; more?: ZoneAction[] } | null;
  emphasis?: ReactNode;
  width?: 'desk' | 'flow' | 'full';
  /** 작업면 아래 고정 확정 바(흐름 원형) */
  commitBar?: ReactNode;
  children?: ReactNode;
}

export function ZoneBlock({ text, actionLabel, onAction, tone = 'amber' }: ZoneBlockItem) {
  const t = tone === 'rose'
    ? { box: 'border-rose-200 bg-rose-50 text-rose-900', icon: 'text-rose-600', btn: 'border-rose-300 text-rose-900' }
    : { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'text-amber-600', btn: 'border-amber-300 text-amber-900' };
  return (
    <div className={`rounded-xl border ${t.box} px-4 py-2.5 min-h-12 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]`} data-zone="block" role="status">
      <TriangleAlert className={`w-[15px] h-[15px] shrink-0 ${t.icon}`} />
      <span className="flex-1 min-w-[180px]">{text}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={`h-8 px-3 rounded-lg bg-white border ${t.btn} text-[12.5px] font-semibold whitespace-nowrap hover:bg-white/70`}>{actionLabel}</button>
      )}
    </div>
  );
}

export default function ZoneFrame({ command, blocks = [], start, emphasis, width = 'desk', commitBar, children, ...head }: ZoneFrameProps) {
  const hasCommand = !!command;
  const hasStart = !!start && (start.items.length > 0 || (start.more?.length ?? 0) > 0);
  // 폭 한 줄 규칙: 머리 · 명령 카드 · 작업면 · 확정 바가 같은 상자를 쓴다(full = 전폭 · 그 밖 = 1240)
  const wrap = width === 'full' ? 'w-full px-4 md:px-6' : 'max-w-[1240px] mx-auto px-4 md:px-6';
  return (
    <SurfaceToneProvider tone="light">
      <ZoneModuleContext.Provider value={head.moduleId}>
        <div className="relative min-h-screen bg-slate-100 text-slate-900" data-zone-frame={head.moduleId}>
          {/* 머리 + 명령 카드가 걸치는 띠 = 한 덩어리 바탕(빛이 끊기지 않게) */}
          <div style={{ background: zoneBand(head.moduleId) }}>
            <ZoneHeader {...head} paint={false} full={width === 'full'} />
            {hasCommand && <div className="h-7" aria-hidden="true" />}
          </div>
          {hasCommand && (
            <div className={`${wrap} -mt-7 relative z-10`}>
              <ZoneCommand {...command!} />
            </div>
          )}
          <main className={`${wrap} ${hasCommand ? 'pt-4' : 'pt-5'} ${commitBar ? 'pb-28' : 'pb-16'}`}>
            {/* flow = 차단 상자 · 시작 카드 · 작업면이 같은 가운데 칸(왼쪽 끝이 한 줄) */}
            <div className={width === 'flow' ? 'w-full max-w-3xl mx-auto' : undefined}>
              {blocks.length > 0 && <div className="space-y-2 mb-4">{blocks.map((b, i) => <ZoneBlock key={i} {...b} />)}</div>}
              {hasStart && <div className="mb-5"><ZoneStartCards items={start!.items} more={start!.more} /></div>}
              {emphasis && <div className="mb-6">{emphasis}</div>}
              {children}
            </div>
          </main>
          {commitBar && (
            <div className="fixed inset-x-0 bottom-0 z-20 bg-white border-t border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]" data-zone="commit">
              <div className={`${wrap} min-h-16 py-2.5 flex items-center gap-3`}>{commitBar}</div>
            </div>
          )}
        </div>
      </ZoneModuleContext.Provider>
    </SurfaceToneProvider>
  );
}
