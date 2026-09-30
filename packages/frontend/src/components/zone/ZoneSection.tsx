/**
 * ZoneSection.tsx — 절 제목 줄(★ 2026-09-30 AI 존 보정)
 *
 * [메뉴 색 표지] 제목 · 개수 · 거름(제목 바로 옆 · 한쪽 끝에 떨어뜨리지 않는다) · 설명 … [오른쪽: 찾기·정렬처럼 폭을 채우는 것만]
 */
import type { ReactNode } from 'react';
import { zoneModule } from '../../constants/ai-operator-modules';
import { useZoneModule } from './zone-color';

export default function ZoneSection({ title, count, desc, filter, right }: {
  title: ReactNode;
  count?: number | string | null;
  desc?: ReactNode;
  filter?: ReactNode;
  right?: ReactNode;
}) {
  const moduleId = useZoneModule();
  const gradient = moduleId ? zoneModule(moduleId).gradient : 'from-indigo-500 to-violet-500';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3" data-zone="section">
      <span className={`w-1.5 h-5 rounded-full bg-gradient-to-b ${gradient} shrink-0`} aria-hidden="true" />
      <h2 className="text-[17px] font-bold tracking-[-0.02em] text-slate-900">{title}</h2>
      {count != null && count !== '' && <span className="text-[13px] text-slate-400 tabular-nums -ml-1">{count}</span>}
      {filter}
      {desc && <span className="text-[13px] text-slate-500">{desc}</span>}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
