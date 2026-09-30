/**
 * ZoneRowActions.tsx — AI 존 목록 행의 동작 묶음(★ 2026-09-30 AI 존 대개편 · 설계서 §3-2 ⑦ · D5)
 *
 * 대표 글자 1 + 보조 1(보기 동작) + ⋯(나머지 전부 라벨 · 위험 동작은 구분선 아래 빨강).
 * 라벨 없는 색 아이콘 버튼 줄(여정 행 9개 등)을 이것으로 바꾼다. 대표·보조·목록은 **호출부가 상태 규칙으로** 정한다.
 * 모바일(sm 미만)에서는 보조가 ⋯ 첫 줄로 들어간다(이름 칸이 눌리지 않게).
 * 콘솔 `RowActions`(카카오·RCS 표 3곳 공용)는 건드리지 않는다 — 공용 컴포넌트는 접수 하나로 고치지 않는다.
 */
import type { MouseEvent } from 'react';
import { ZoneMoreMenu, type ZoneMenuItem } from './ZoneHeader';
import type { LucideIcon } from 'lucide-react';

export interface ZoneRowAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
}

interface Props {
  primary?: ZoneRowAction | null;
  secondary?: ZoneRowAction | null;
  menu?: ZoneMenuItem[];
}

const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

export default function ZoneRowActions({ primary, secondary, menu = [] }: Props) {
  const mobileMenu: ZoneMenuItem[] = secondary
    ? [{ label: secondary.label, icon: secondary.icon, onClick: secondary.onClick, disabled: secondary.disabled }, ...menu.map((m, i) => (i === 0 ? { ...m, divider: true } : m))]
    : menu;
  return (
    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()} data-zone="row-actions">
      {secondary && (
        <button type="button" onClick={stop(secondary.onClick)} disabled={secondary.disabled} className="hidden sm:inline-flex items-center h-8 px-3 rounded-lg text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-40">
          {secondary.label}
        </button>
      )}
      {primary && (
        <button type="button" onClick={stop(primary.onClick)} disabled={primary.disabled} className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-40">
          {primary.icon && <primary.icon className="w-[14px] h-[14px]" />}
          {primary.label}
        </button>
      )}
      <div className="hidden sm:block"><ZoneMoreMenu items={menu} tone="light" /></div>
      <div className="sm:hidden"><ZoneMoreMenu items={mobileMenu} tone="light" /></div>
    </div>
  );
}
