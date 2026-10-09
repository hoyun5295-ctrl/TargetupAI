/**
 * zone-color.ts — 메뉴마다 자기 색(★ 2026-09-30 AI 존 보정 · Harold "통일은 좋은데 너무 단조롭다")
 *
 * 색의 원천은 허브 카드 원장(`ai-operator-modules.ts` 의 gradient)이다 — 여기서 새 색을 정하지 않는다.
 * 머리 띠의 빛(인라인 style)과 추천 시작 카드의 옅은 바탕(글자 그대로의 클래스 · Tailwind 가 읽는다)만 이 표가 만든다.
 */
import { createContext, useContext } from 'react';
import type { LucideIcon } from 'lucide-react';
import { zoneModule, type ZoneModuleId } from '../../constants/ai-operator-modules';

/**
 * ★ 2026-10-09 고객 허브 메뉴가 아닌 화면(슈퍼관리자 AI 영업 등)이 같은 틀을 쓰는 길 — 메뉴 원장(ai-operator-modules.ts)에 넣지 않고
 * 제목·설명·아이콘·색을 직접 넘긴다(고객 허브 노출 0 · 설계서 docs/2026-10-09-outreach-redesign-design.md R11).
 */
export interface ZoneCustomModule { id: string; label: string; description: string; icon: LucideIcon; gradient: string }
export type ZoneModuleRef = ZoneModuleId | ZoneCustomModule;
export function resolveZoneModule(m: ZoneModuleRef): { id: string; label: string; description: string; icon: LucideIcon; gradient: string } {
  return typeof m === 'string' ? zoneModule(m) : m;
}

const RGB: Record<string, string> = {
  fuchsia: '217,70,239', indigo: '99,102,241', violet: '139,92,246', purple: '168,85,247', amber: '245,158,11',
  yellow: '234,179,8', blue: '59,130,246', cyan: '6,182,212', rose: '244,63,94', pink: '236,72,153',
  orange: '249,115,22', sky: '14,165,233', emerald: '16,185,129', teal: '20,184,166',
};

function hues(id: ZoneModuleRef): [string, string] {
  const g = resolveZoneModule(id).gradient;
  const from = g.match(/from-([a-z]+)-\d/)?.[1] || 'indigo';
  const to = g.match(/to-([a-z]+)-\d/)?.[1] || from;
  return [RGB[from] ? from : 'indigo', RGB[to] ? to : 'indigo'];
}

/** 머리 띠 바탕: 남색 + 메뉴 색 빛 두 개(비블러 방사) */
export function zoneBand(id: ZoneModuleRef): string {
  const [a, b] = hues(id);
  return `radial-gradient(620px 220px at 6% 0%, rgba(${RGB[a]},0.34), transparent 70%), radial-gradient(520px 200px at 92% 0%, rgba(${RGB[b]},0.18), transparent 70%), #0F172A`;
}

/** 추천 시작 카드 · 배지 · 절 표지 — 글자 그대로(동적 조립 금지: Tailwind 가 못 읽는다) */
const FEATURED: Record<string, { card: string; badge: string }> = {
  fuchsia: { card: 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-white', badge: 'bg-fuchsia-600 text-white' },
  indigo: { card: 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-white', badge: 'bg-indigo-600 text-white' },
  violet: { card: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white', badge: 'bg-violet-600 text-white' },
  amber: { card: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', badge: 'bg-amber-500 text-slate-900' },
  blue: { card: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white', badge: 'bg-blue-600 text-white' },
  rose: { card: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white', badge: 'bg-rose-600 text-white' },
  orange: { card: 'border-orange-200 bg-gradient-to-br from-orange-50 to-white', badge: 'bg-orange-500 text-white' },
  sky: { card: 'border-sky-200 bg-gradient-to-br from-sky-50 to-white', badge: 'bg-sky-600 text-white' },
  emerald: { card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', badge: 'bg-emerald-600 text-white' },
  teal: { card: 'border-teal-200 bg-gradient-to-br from-teal-50 to-white', badge: 'bg-teal-600 text-white' },
};
export function zoneFeatured(id: ZoneModuleId): { card: string; badge: string } {
  return FEATURED[hues(id)[0]] || FEATURED.indigo;
}

/** ZoneFrame 이 내려 주는 "지금 메뉴" — 절 제목 표지·추천 카드가 읽는다 */
export const ZoneModuleContext = createContext<ZoneModuleId | null>(null);
export function useZoneModule(): ZoneModuleId | null {
  return useContext(ZoneModuleContext);
}
