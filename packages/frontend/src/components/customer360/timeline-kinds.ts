/**
 * timeline-kinds.ts — 고객 360 타임라인 종류 표 (★ 2026-08-22 신설)
 *
 * 아이콘·색만 여기가 소유한다. **라벨·제목·상태 문구는 서버가 완성해서 보낸다**
 * (설계서 §2-5: 화면이 status_code를 다시 해석하면 라벨 표가 두 벌이 되어 갈린다).
 *
 * 색은 콘솔 톤(라이트) 안에서만 고른다. 종류마다 다른 색을 주되 채도는 낮게 —
 * 타임라인은 "무슨 일이 있었나"를 훑는 화면이라 아이콘이 글자보다 진하면 안 된다.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Send, Eye, MessageSquareReply, ShoppingCart, MousePointerClick, Smartphone,
  ShieldCheck, BellOff, GitBranch, PhoneCall, Mail, UserPlus,
} from 'lucide-react';

export type TimelineKind =
  | 'send' | 'dm_view' | 'dm_response' | 'purchase' | 'behavior' | 'inapp'
  | 'consent' | 'unsubscribe' | 'journey' | 'inbound' | 'email' | 'profile';

export interface KindStyle {
  /** 필터 칩에 쓰는 이름 */
  label: string;
  icon: LucideIcon;
  /** 아이콘 타일 */
  tile: string;
}

export const KIND_STYLE: Record<TimelineKind, KindStyle> = {
  send:        { label: '발송',     icon: Send,               tile: 'bg-indigo-50 text-indigo-600' },
  dm_view:     { label: 'DM 열람',  icon: Eye,                tile: 'bg-sky-50 text-sky-600' },
  dm_response: { label: 'DM 응답',  icon: MessageSquareReply, tile: 'bg-sky-50 text-sky-600' },
  purchase:    { label: '구매',     icon: ShoppingCart,       tile: 'bg-emerald-50 text-emerald-600' },
  behavior:    { label: '행동',     icon: MousePointerClick,  tile: 'bg-neutral-100 text-neutral-600' },
  inapp:       { label: '인앱',     icon: Smartphone,         tile: 'bg-violet-50 text-violet-600' },
  consent:     { label: '동의',     icon: ShieldCheck,        tile: 'bg-teal-50 text-teal-700' },
  unsubscribe: { label: '수신거부', icon: BellOff,            tile: 'bg-rose-50 text-rose-600' },
  journey:     { label: '자동화',   icon: GitBranch,          tile: 'bg-amber-50 text-amber-700' },
  inbound:     { label: '문의',     icon: PhoneCall,          tile: 'bg-orange-50 text-orange-600' },
  email:       { label: '이메일',   icon: Mail,               tile: 'bg-blue-50 text-blue-600' },
  profile:     { label: '등록',     icon: UserPlus,           tile: 'bg-neutral-100 text-neutral-500' },
};

/** 필터 칩 순서 — 자주 보는 것부터. `profile`은 사건이 하나뿐이라 칩을 두지 않는다 */
export const FILTER_KINDS: TimelineKind[] = [
  'send', 'dm_view', 'purchase', 'behavior', 'journey', 'consent', 'unsubscribe', 'inbound',
];

/** 칩 하나가 켜질 때 서버로 보내는 종류들(묶어서 보는 것이 자연스러운 것은 함께 켠다) */
export const FILTER_EXPAND: Partial<Record<TimelineKind, TimelineKind[]>> = {
  dm_view: ['dm_view', 'dm_response'],
  send: ['send', 'email'],
};

/** 상태 점 색 — 서버가 준 status 그대로 */
export const STATUS_DOT: Record<string, string> = {
  success: 'bg-emerald-500',
  fail: 'bg-rose-500',
  pending: 'bg-amber-500',
  scheduled: 'bg-indigo-400',
  unknown: 'bg-neutral-300',
};

/** 날짜 묶음 제목 — 오늘·어제·그 외는 날짜 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

/** 시:분 (KST) */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
