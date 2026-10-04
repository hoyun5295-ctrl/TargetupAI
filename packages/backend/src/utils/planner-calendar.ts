/**
 * planner-calendar.ts — 캘린더 한 달 조립 CT (★ 2026-10-04 보강 B7 · 설계서 §5-1 · 목업 v2)
 *
 * 캘린더 화면이 그리는 것은 전부 서버가 판정한다 — 행사 화면 상태(상태 사전 1벌의 키) · 고칠 수 있는가(F10) · 할 일 ·
 * 남은 첫 발송 · 승인 마감 · 머리 숫자 [할 일][이달 행사][보유 크레딧]. 화면은 사전에 없는 값을 그리지 않는다.
 * 사용자 범위(§3-10) = 관리자 회사 전체 · 담당자 자기 행사(ownerId).
 */
import { getCreditState } from './ai-credit';
import { getMonthHolidays } from './kr-holidays';
import { PLANNER_CHANNEL_LABEL } from './marketing-planner';
import {
  PlannerDisplayState, PlannerEventRow, computeDisplayState, firstSendDate, isBuilding, isEventEditable, listPlannerEvents, staleBuildChannels,
} from './planner-event';
import { PlannerTouchpointRow, loadTouchpointsForEvents } from './planner-touchpoint';
import { PLANNER_APPROVAL_DEADLINE_HOUR } from './planner-confirm';

/** 할 일(앰버) = 담당자가 손을 대야 진행되는 상태 */
export const PLANNER_TODO_STATES: PlannerDisplayState[] = ['material', 'review', 'hold'];

export interface CalendarTouchpoint {
  id: string;
  channel: string;
  label: string;
  timing: unknown;
  scheduledOn: string;
  status: string;
  lockReason: string | null;
  approved: boolean;
  /** [다시 시작] 가능 — 보류·잠금 · 승인 각인 있음 · 발송 여부를 모르는 행 아님 */
  resumable: boolean;
  sentCount: number | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  benefitText: string | null;
  products: Array<{ name: string }>;
  status: string;
  displayState: PlannerDisplayState;
  editable: boolean;
  todo: boolean;
  revision: number;
  materials: unknown;
  /** 완성본이 없거나 재료가 바뀌어 다시 만들어야 하는 채널 */
  staleChannels: Array<'dm' | 'email'>;
  building: boolean;
  firstSend: string | null;
  deadline: { date: string; hour: number } | null;
  /** 문안 준비 실패 등 담당자에게 보일 사유(고객 문장) */
  notice: string | null;
  closedReason: string | null;
  migrated: boolean;
  touchpoints: CalendarTouchpoint[];
}

export interface PlannerCalendar {
  month: string;
  events: CalendarEvent[];
  kpi: { todo: number; events: number; balance: number | null };
  /** 옛 월간 결재에서 넘어온 행사 중 할 일이 남은 수(1회 안내 상자) */
  migratedTodo: number;
  holidays: unknown[];
  holidaysReady: boolean;
}

function toCalendarTouchpoint(t: PlannerTouchpointRow): CalendarTouchpoint {
  const approved = !!t.execMeta?.approved;
  return {
    id: t.id,
    channel: t.channel,
    label: PLANNER_CHANNEL_LABEL[t.channel] || t.channel,
    timing: t.timing,
    scheduledOn: t.scheduledOn,
    status: t.status,
    lockReason: t.lockReason ?? null,
    approved,
    resumable: (t.status === 'hold_credit' || t.status === 'locked') && approved && !(t.execMeta?.send_started_at && !t.execRef),
    sentCount: t.status === 'sent' && Number.isFinite(Number(t.execMeta?.sent_count)) ? Number(t.execMeta.sent_count) : null,
  };
}

/** (순수) 행사 1건 → 캘린더 항목 */
export function toCalendarEvent(ev: PlannerEventRow, tps: PlannerTouchpointRow[], now: Date = new Date()): CalendarEvent {
  const displayState = computeDisplayState(ev, tps, now);
  const pending = tps.filter((t) => t.status !== 'skipped' && t.status !== 'sent');
  const first = firstSendDate(ev, pending);
  const notice = displayState === 'material' || displayState === 'making'
    ? (tps.map((t) => t.execMeta?.copy_error?.reason).find(Boolean) as string | undefined) || null
    : displayState === 'hold'
      ? tps.find((t) => t.status === 'hold_credit' || t.status === 'locked')?.lockReason || null
      : null;
  return {
    id: ev.id,
    title: ev.title,
    startsOn: ev.startsOn,
    endsOn: ev.endsOn,
    benefitText: ev.benefitText,
    products: ev.products,
    status: ev.status,
    displayState,
    editable: isEventEditable(ev.status),
    todo: PLANNER_TODO_STATES.includes(displayState),
    revision: Number(ev.meta.revision) || 0,
    materials: ev.meta.materials || null,
    staleChannels: staleBuildChannels(ev, tps),
    building: isBuilding(ev.meta, now),
    firstSend: first,
    deadline: displayState === 'review' && first ? { date: first, hour: PLANNER_APPROVAL_DEADLINE_HOUR } : null,
    notice,
    closedReason: typeof ev.meta.closedReason === 'string' ? ev.meta.closedReason : null,
    migrated: !!ev.meta.migrated,
    touchpoints: tps.map(toCalendarTouchpoint),
  };
}

export async function buildPlannerCalendar(companyId: string, planMonth: string, ownerId: string | null): Promise<PlannerCalendar> {
  const rows = await listPlannerEvents(companyId, planMonth, ownerId);
  const tps = await loadTouchpointsForEvents(companyId, rows.map((e) => e.id));
  const byEvent = new Map<string, PlannerTouchpointRow[]>();
  for (const t of tps) byEvent.set(t.eventId, [...(byEvent.get(t.eventId) || []), t]);
  const now = new Date();
  const events = rows.map((ev) => toCalendarEvent(ev, byEvent.get(ev.id) || [], now));
  const credit = await getCreditState(companyId);
  const h = getMonthHolidays(planMonth);
  return {
    month: planMonth,
    events,
    kpi: {
      todo: events.filter((e) => e.todo).length,
      events: events.filter((e) => e.displayState !== 'cancelled').length,
      balance: credit.creditEnabled ? credit.total : null,
    },
    migratedTodo: events.filter((e) => e.migrated && e.todo).length,
    holidays: h.holidays,
    holidaysReady: h.ready,
  };
}
