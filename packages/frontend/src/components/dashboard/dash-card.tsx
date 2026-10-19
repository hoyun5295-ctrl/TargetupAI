/**
 * dash-card.tsx — 대시보드 아래 4칸 공용 껍데기 (★ 2026-10-19 · docs/2026-10-19-dashboard-four-cards-design.md §1)
 *
 * 요금제 · 발송 현황 · DB 현황 · 오늘의 추천이 같은 모서리 · 여백 · 머리 · 출처 줄을 쓴다(칸마다 다시 짜지 않는다).
 * 칸 높이는 대시보드 격자가 같은 줄끼리 맞춘다 → 칸마다 마지막 묶음을 바닥에 붙인다(mt-auto · 남는 높이는 가운데로).
 */
import type { ReactNode } from 'react';

export const DASH_CARD = 'bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col min-w-0';

/** 숫자 채우기(CountUp) 표기 = 천 단위 쉼표 */
export const fmtInt = (v: number) => v.toLocaleString();

/** 칸 머리 = 왼쪽 세로 막대 + 제목(+ 덧붙임) · 오른쪽 이동 글자 */
export function DashCardHead({ bar, title, extra, right }: { bar: string; title: string; extra?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-1 h-4 rounded-full shrink-0 ${bar}`} />
        <span className="text-sm font-semibold text-gray-800 whitespace-nowrap">{title}</span>
        {extra}
      </div>
      {right}
    </div>
  );
}

/** 머리 오른쪽 이동 글자(「요금제 안내 →」) — onClick 이 없으면 글자만(칸 전체가 누르는 곳일 때) */
export function DashHeadLink({ label, onClick }: { label: string; onClick?: () => void }) {
  const cls = 'shrink-0 text-[11px] font-medium text-gray-400 hover:text-green-700 transition-colors whitespace-nowrap';
  const body = <>{label} <span className="text-[10px]">→</span></>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <span className={cls}>{body}</span>;
}

/** 출처 줄(LESSONS_FRONTEND Source caption 의무) */
export function DashSource({ children }: { children: ReactNode }) {
  return <div className="pt-2 text-[10px] italic text-gray-400 break-keep">Data source: {children}</div>;
}
