/**
 * ZoneFrame.tsx — AI 존 화면의 틀(★ 2026-09-30 AI 존 대개편 · 설계서 §3)
 *
 * Harold "메뉴가 다 진짜 너무 제각각 … 본연의 기능은 잘 활용하면서 메뉴들의 이질감이 없도록".
 * 그래서 **같아야 할 틀은 이 부품이 전부 그리고, 화면은 작업면(children)만 채운다.**
 *   ① 남색 머리 띠(ZoneHeader) ② 띠 경계에 걸친 명령 카드(ZoneCommand) ③ 차단 상자 ④ 강조 카드(≤1) ⑤ 작업면
 * 밝은 작업대라는 사실을 문맥으로 내려 준다(SurfaceToneProvider) — 여기서 뜨는 공용 창이 밝게 따라온다.
 *
 * ⛔ className prop 없음 · 폭은 3가지(desk 1240 / flow 1240 안 왼쪽 768 / full 캔버스)뿐.
 */
import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import ZoneHeader, { type ZoneHeaderProps } from './ZoneHeader';
import ZoneCommand, { type ZoneCommandProps } from './ZoneCommand';
import { SurfaceToneProvider } from './surface-tone';

export interface ZoneBlockItem {
  text: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'amber' | 'rose';
}

export interface ZoneFrameProps extends ZoneHeaderProps {
  command?: ZoneCommandProps | null;
  blocks?: ZoneBlockItem[];
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

export default function ZoneFrame({ command, blocks = [], emphasis, width = 'desk', commitBar, children, ...head }: ZoneFrameProps) {
  const hasCommand = !!command;
  return (
    <SurfaceToneProvider tone="light">
      <div className="relative min-h-screen bg-slate-100 text-slate-900" data-zone-frame={head.moduleId}>
        <ZoneHeader {...head} />
        {hasCommand && (
          <>
            <div className="bg-slate-900 h-7" aria-hidden="true" />
            <div className="max-w-[1240px] mx-auto px-4 md:px-6 -mt-7 relative z-10">
              <ZoneCommand {...command!} />
            </div>
          </>
        )}
        <main className={`${width === 'full' ? 'w-full px-4 md:px-6' : 'max-w-[1240px] mx-auto px-4 md:px-6'} ${hasCommand ? 'pt-3' : 'pt-5'} ${commitBar ? 'pb-28' : 'pb-16'}`}>
          {blocks.length > 0 && <div className="space-y-2 mb-1">{blocks.map((b, i) => <ZoneBlock key={i} {...b} />)}</div>}
          {emphasis && <div className="mt-3">{emphasis}</div>}
          <div className={emphasis || blocks.length ? 'mt-5' : 'mt-2'}>
            {width === 'flow' ? <div className="w-full max-w-3xl">{children}</div> : children}
          </div>
        </main>
        {commitBar && (
          <div className="fixed inset-x-0 bottom-0 z-20 bg-white border-t border-slate-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]" data-zone="commit">
            <div className="max-w-[1240px] mx-auto px-4 md:px-6 min-h-16 py-2.5 flex items-center gap-3">{commitBar}</div>
          </div>
        )}
      </div>
    </SurfaceToneProvider>
  );
}
