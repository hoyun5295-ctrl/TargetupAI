/**
 * journey-row-actions.ts — 여정 목록 행 동작의 노출 규칙(★ 2026-09-30 AI 존 대개편 · 설계서 §4-1 · D5)
 *
 * 옛 행: 색 아이콘 버튼 최대 10개가 라벨 없이 나열(JourneysPage 2208~2264). 새 행: 대표 글자 1 + 보조 1 + ⋯.
 * **어떤 상태에서 어떤 동작이 보이는가(노출 조건)는 옛 조건식을 한 글자도 바꾸지 않고 옮겼다.** 바뀐 것은 자리(대표·보조·⋯)뿐.
 *   진입 고객 = 항상 · 성과 = 항상 · 발송 대상 확인 = 보관 아님 && 끝남 아님 · 문안 수정 = 보관 아님 && (초안|멈춤|켜짐)
 *   정지 이력 = 항상 · 켜기 = 보관 아님 && (초안|멈춤) · 멈추기 = 보관 아님 && 켜짐 · 끝내기 = 보관 아님 && 끝남 아님
 *   보관 = 보관 아님 && 켜짐 아님 · 복원 = 보관 · 삭제 = 켜짐 아님
 * 계약 테스트(`journey-row-actions.test.ts`)가 상태 × 보관 8조합의 동작 집합을 옛 조건식과 대조한다.
 * JSX 없는 .ts — 백엔드 테스트가 import 한다.
 */
export type JourneyRowActionId =
  | 'entrants' | 'stats' | 'target' | 'edit_message' | 'pause_logs'
  | 'activate' | 'pause' | 'end' | 'archive' | 'unarchive' | 'delete';

export interface JourneyRowActionPlan {
  primary: JourneyRowActionId | null;
  secondary: JourneyRowActionId | null;
  /** ⋯ 안 순서 그대로(보기 → 고치기 → 상태 바꾸기 → 보관 → 삭제) */
  menu: JourneyRowActionId[];
}

/** 옛 조건식 그대로: 이 상태에서 보이는 동작 전부 */
export function journeyVisibleActions(status: string, archived: boolean): Set<JourneyRowActionId> {
  const s = new Set<JourneyRowActionId>(['entrants', 'stats', 'pause_logs']);
  if (!archived && status !== 'ended') s.add('target');
  if (!archived && (status === 'draft' || status === 'paused' || status === 'active')) s.add('edit_message');
  if (!archived && (status === 'draft' || status === 'paused')) s.add('activate');
  if (!archived && status === 'active') s.add('pause');
  if (!archived && status !== 'ended') s.add('end');
  if (!archived && status !== 'active') s.add('archive');
  if (archived) s.add('unarchive');
  if (status !== 'active') s.add('delete');
  return s;
}

const MENU_ORDER: JourneyRowActionId[] = ['target', 'entrants', 'stats', 'edit_message', 'pause_logs', 'end', 'archive', 'delete'];

export function journeyRowActionPlan(status: string, archived: boolean): JourneyRowActionPlan {
  const vis = journeyVisibleActions(status, archived);
  const pick = (...ids: JourneyRowActionId[]) => ids.find((id) => vis.has(id)) ?? null;
  const primary = archived ? pick('unarchive')
    : status === 'draft' || status === 'paused' ? pick('activate')
    : status === 'active' ? pick('pause')
    : pick('stats');
  const secondary = archived ? pick('stats')
    : status === 'draft' ? pick('edit_message')
    : status === 'ended' ? pick('entrants')
    : pick('stats');
  const menu = MENU_ORDER.filter((id) => vis.has(id) && id !== primary && id !== secondary);
  return { primary, secondary, menu };
}

/** 대표 자리 글자(상태 동사 = 서버 지도 문구와 같은 말: 켜기·멈추기·다시 켜기·끝내기) */
export function journeyRowActionLabel(id: JourneyRowActionId, status: string): string {
  switch (id) {
    case 'activate': return status === 'paused' ? '다시 켜기' : '켜기';
    case 'pause': return '멈추기';
    case 'end': return '끝내기';
    case 'archive': return '보관함으로';
    case 'unarchive': return '복원';
    case 'delete': return '영구 삭제';
    case 'entrants': return '진입 고객';
    case 'stats': return '성과';
    case 'target': return '발송 대상 확인';
    case 'edit_message': return '문안 수정';
    case 'pause_logs': return '정지 이력';
  }
}

/** 여정 상태 이름(목록·지도·상세 한 벌) */
export const JOURNEY_STATUS_LABEL: Record<string, string> = { draft: '초안', active: '켜짐', paused: '멈춤', ended: '끝남' };
