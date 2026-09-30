/**
 * ZoneEmphasis.tsx — 강조 카드(화면당 ≤1 · ★ 2026-09-30 AI 존 대개편 · 설계서 §3-2 ④)
 *
 * "지금 결정할 것"이 있을 때만 둔다(다음 수 + 오늘의 기회 · 일일 브리핑 · 월 결재 · 빠른 시작 · 추천 액션).
 * 흰 판 + 기능 카드 그림자 + 표지: AI 추천 = 앰버 반짝(허브 추천 띠 1순위 칩과 같은 모양) / 결재·조치 = 상태 점 + 같은 색 왼쪽 선.
 * 내용은 각 화면의 기존 JSX 를 그대로 넣는다(보이는 개수·1클릭 유지). **유료 AI 를 자동 호출하지 않는다.**
 */
import type { ReactNode } from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';

const LINE = { amber: 'border-l-amber-400', emerald: 'border-l-emerald-400', indigo: 'border-l-indigo-400', rose: 'border-l-rose-400', slate: 'border-l-slate-300' } as const;
const MARK = { amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600', indigo: 'bg-indigo-50 text-indigo-600', rose: 'bg-rose-50 text-rose-600', slate: 'bg-slate-100 text-slate-500' } as const;

export interface ZoneEmphasisProps {
  kind: 'ai' | 'status';
  title: ReactNode;
  meta?: ReactNode;
  /** 제목 줄 오른쪽(넘기기 · 버튼 1) */
  right?: ReactNode;
  /** kind='status' 의 상태 색(왼쪽 선 · 표지) */
  tone?: keyof typeof LINE;
  icon?: LucideIcon;
  children?: ReactNode;
}

export default function ZoneEmphasis({ kind, title, meta, right, tone = 'indigo', icon: Icon, children }: ZoneEmphasisProps) {
  const statusLine = kind === 'status' ? `border-l-[3px] ${LINE[tone]}` : '';
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 ${statusLine} shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] p-4 md:p-5`} data-zone="emphasis">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {kind === 'ai' ? (
          <span className="w-7 h-7 rounded-lg bg-amber-500 text-slate-900 flex items-center justify-center shrink-0"><Sparkles className="w-[14px] h-[14px]" /></span>
        ) : (
          <span className={`w-7 h-7 rounded-lg ${MARK[tone]} flex items-center justify-center shrink-0`}>{Icon ? <Icon className="w-[14px] h-[14px]" /> : <span className="w-2 h-2 rounded-full bg-current" />}</span>
        )}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
        {meta && <span className="text-[12.5px] text-slate-500">{meta}</span>}
        {right && <span className="ml-auto flex items-center gap-1">{right}</span>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}
