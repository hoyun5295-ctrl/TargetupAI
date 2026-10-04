/**
 * planner-status.ts — 마케팅 플래너 상태 사전 1벌 (★ 2026-10-04 보강 · 설계서 §5-1 · 목업 v2)
 *
 * 캘린더 · 행사 목록 · 할 일 · 행사 상세 · 휴대폰 확인 화면이 같은 라벨·아이콘·색을 쓴다(두 벌 금지).
 * 행사 화면 상태는 **서버가 판정해 준 값**(`displayState`)이다 — 화면은 사전에 없는 값을 그리지 않는다.
 * 키 목록 = 서버 `PlannerDisplayState`(utils/planner-event.ts)와 같다(계약 테스트가 고정).
 * 색만으로 구분하지 않는다 — 상태마다 아이콘이 다르다(재료 필요 = 빗금 + 사진 아이콘).
 */
import type { LucideIcon } from 'lucide-react';
import { Ban, CheckCheck, CircleCheck, CirclePause, Eye, ImagePlus, LoaderCircle, Mail, MessageSquareText, Smartphone } from 'lucide-react';

export type PlannerDisplayState = 'material' | 'making' | 'review' | 'approved' | 'done' | 'hold' | 'cancelled';

export interface PlannerStateStyle {
  label: string;
  icon: LucideIcon;
  /** 배지(행사 목록 · 할 일 · 상세) */
  badge: string;
  /** 달력 행사 기간 막대 */
  bar: string;
  /** 발송 칩(달력 · 목록) */
  chip: string;
}

export const PLANNER_STATE: Record<PlannerDisplayState, PlannerStateStyle> = {
  material: { label: '재료 필요', icon: ImagePlus, badge: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-white bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(251,191,36,0.22)_6px_8px)] border-dashed border-amber-400 text-amber-900', chip: 'bg-white border-dashed border-amber-400 text-amber-900' },
  making: { label: '제작 중', icon: LoaderCircle, badge: 'bg-violet-50 text-violet-800 border-violet-200', bar: 'bg-violet-50 border-violet-300 text-violet-900', chip: 'bg-violet-50 border-violet-200 text-violet-900' },
  review: { label: '확인 대기', icon: Eye, badge: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-100 border-amber-300 text-amber-950', chip: 'bg-amber-50 border-amber-300 text-amber-900' },
  approved: { label: '승인됨', icon: CircleCheck, badge: 'bg-emerald-50 text-emerald-800 border-emerald-200', bar: 'bg-emerald-50 border-emerald-300 text-emerald-900', chip: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
  done: { label: '발송 완료', icon: CheckCheck, badge: 'bg-slate-100 text-slate-700 border-slate-200', bar: 'bg-slate-100 border-slate-200 text-slate-700', chip: 'bg-slate-100 border-slate-200 text-slate-600' },
  hold: { label: '보류', icon: CirclePause, badge: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-50 border-amber-300 text-amber-900', chip: 'bg-amber-50 border-amber-300 text-amber-900' },
  cancelled: { label: '취소됨', icon: Ban, badge: 'bg-slate-50 text-slate-500 border-slate-200', bar: 'bg-slate-50 border-slate-200 text-slate-400 line-through', chip: 'bg-slate-50 border-slate-200 text-slate-400' },
};

/** 범례 순서(달력 아래 · 취소 제외) */
export const PLANNER_LEGEND: PlannerDisplayState[] = ['material', 'making', 'review', 'approved', 'done', 'hold'];

/** (순수) 서버 값 → 사전 항목. 사전에 없으면 null(그리지 않는다). */
export function plannerStateOf(v: string | null | undefined): PlannerStateStyle | null {
  return v && Object.prototype.hasOwnProperty.call(PLANNER_STATE, v) ? PLANNER_STATE[v as PlannerDisplayState] : null;
}

/** 발송 한 번의 모양 — 문자 · 문자 1통 + 모바일 DM 링크 · DM 링크를 실은 문자 · 메일 */
export type PlannerSendKind = 'sms' | 'smsdm' | 'dm' | 'email';
export const PLANNER_SEND_KIND: Record<PlannerSendKind, { label: string; long: string; icon: LucideIcon }> = {
  sms: { label: '문자', long: '문자', icon: MessageSquareText },
  smsdm: { label: '문자+DM', long: '문자 1통 + 모바일 DM 링크', icon: Smartphone },
  dm: { label: '문자+DM', long: '모바일 DM 링크를 실은 문자', icon: Smartphone },
  email: { label: '메일', long: '메일', icon: Mail },
};

/** 채널(접점 한 개) 라벨 · 아이콘 — 1차 플래너 = 문자 · 모바일 DM · 메일 */
export const PLANNER_CHANNEL: Record<'sms' | 'dm' | 'email', { label: string; icon: LucideIcon }> = {
  sms: { label: '문자', icon: MessageSquareText },
  dm: { label: '모바일 DM', icon: Smartphone },
  email: { label: '메일', icon: Mail },
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** (순수) 'YYYY-MM-DD' → 'M/D(요일)' — 서버 통지 문자(formatPlannerDay)와 같은 표기 */
export function plannerDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}
/** (순수) 행사 기간 표기 — 하루면 "M/D(요) 하루" */
export function plannerRange(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? `${plannerDay(startsOn)} 하루` : `${plannerDay(startsOn)} ~ ${plannerDay(endsOn)}`;
}
/** KST 오늘 'YYYY-MM-DD' — 브라우저 타임존과 무관(해외 접속 하루 밀림 차단) */
export const kstToday = (): string => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
/** (순수) 두 날짜 사이 날수(문자열 축) */
export function plannerDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** 발송 한 번(접점)의 상태 — 이달 결과 표 · 담당자 언어(내부 값 노출 금지 · 사전에 없으면 그리지 않는다) */
export const PLANNER_TP_STATUS: Record<string, { label: string; cls: string }> = {
  planned: { label: '승인 전', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  ready: { label: '발송 대기', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  producing: { label: '보내는 중', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
  sent: { label: '발송 완료', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  hold_credit: { label: '보류(크레딧)', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  locked: { label: '보류', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};
