/**
 * ★ CT-82: In-app Message Trigger Engine — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   복합 트리거 검증 — SDK 호출 시 server-side에서 메시지 트리거 매칭 여부 판정.
 *   - evaluateTrigger: 단일 메시지 + SDK 이벤트 컨텍스트 매칭
 *   - listMessagesByTriggerEvent: 특정 이벤트와 매칭되는 active 메시지 목록
 *   - isTimeWindowValid: 시간대 + 요일 윈도우 검증
 *
 * 📋 트리거 종류
 *   - page_load: 페이지 로드 직후 (default)
 *   - cart_add: 장바구니 추가 직후
 *   - cart_view: 장바구니 페이지 진입
 *   - checkout_start: 결제 페이지 진입
 *   - scroll: 페이지 N% 스크롤 도달 (scroll_percent)
 *   - time_on_page: 페이지 N초 체류 (time_on_page_seconds)
 *   - exit_intent: 마우스 상단 이탈 (desktop)
 *   - cart_value: 장바구니 금액 N원 이상 (cart_value_min)
 *
 * ⛔ 영구 원칙
 *   - 회사 격리 (company_id 의무)
 *   - 시간대 0~23 / 요일 0~6 (일~토) 표준
 *   - 시간대 윈도우 = KST 기준
 *   - 트리거 조건 미설정 = 단순 event 매칭만 (조건 충족)
 */

import { query } from '../config/database';
import type { TriggerConditions } from './inapp-ai-generator';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface SdkEventContext {
  event: TriggerConditions['event'];
  scrollPercent?: number;
  timeOnPageSeconds?: number;
  cartValue?: number;
  currentPath?: string;
}

export interface TriggerableMessage {
  id: string;
  triggerConditions: TriggerConditions;
  sendStartHour: number | null;
  sendEndHour: number | null;
  allowedWeekdays: number[];
  status: string;
}

export interface TriggerEvaluationResult {
  matches: boolean;
  reason: string;
}

// ════════════════════════════════════════════════════════════════════
// 핵심 — 트리거 매칭 평가
// ════════════════════════════════════════════════════════════════════

/**
 * 단일 메시지 트리거 조건과 SDK 이벤트 컨텍스트 매칭 여부 판정.
 */
export function evaluateTrigger(
  message: TriggerableMessage,
  eventContext: SdkEventContext
): TriggerEvaluationResult {
  // Step 1: 이벤트 명칭 매칭
  if (message.triggerConditions.event !== eventContext.event) {
    return { matches: false, reason: `이벤트 미일치 (메시지: ${message.triggerConditions.event}, SDK: ${eventContext.event})` };
  }

  // Step 2: scroll 임계값 검증
  if (message.triggerConditions.event === 'scroll') {
    const minScroll = message.triggerConditions.scroll_percent ?? 50;
    if ((eventContext.scrollPercent ?? 0) < minScroll) {
      return { matches: false, reason: `scroll 미달 (${eventContext.scrollPercent}% < ${minScroll}%)` };
    }
  }

  // Step 3: time_on_page 임계값 검증
  if (message.triggerConditions.event === 'time_on_page') {
    const minTime = message.triggerConditions.time_on_page_seconds ?? 10;
    if ((eventContext.timeOnPageSeconds ?? 0) < minTime) {
      return { matches: false, reason: `체류 시간 미달 (${eventContext.timeOnPageSeconds}초 < ${minTime}초)` };
    }
  }

  // Step 4: cart_value 임계값 검증
  if (message.triggerConditions.event === 'cart_value') {
    const minValue = message.triggerConditions.cart_value_min ?? 0;
    if ((eventContext.cartValue ?? 0) < minValue) {
      return { matches: false, reason: `장바구니 금액 미달 (${eventContext.cartValue}원 < ${minValue}원)` };
    }
  }

  // Step 5: 시간대 + 요일 윈도우 검증
  const windowResult = isTimeWindowValid(message);
  if (!windowResult.valid) {
    return { matches: false, reason: windowResult.reason };
  }

  return { matches: true, reason: '트리거 매칭 정합' };
}

/**
 * 현재 KST 시각이 메시지의 시간대 + 요일 윈도우와 일치하는지 검증.
 */
export function isTimeWindowValid(message: TriggerableMessage): { valid: boolean; reason: string } {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hour = nowKst.getUTCHours();
  const weekday = nowKst.getUTCDay();  // 0=일, 1=월, ..., 6=토

  // 시간대 윈도우 검증 (null = 24h 허용)
  if (message.sendStartHour !== null && message.sendEndHour !== null) {
    const startH = message.sendStartHour;
    const endH = message.sendEndHour;
    let inWindow: boolean;
    if (startH <= endH) {
      // 예: 9~22시
      inWindow = hour >= startH && hour <= endH;
    } else {
      // 예: 22~6시 (자정 넘김)
      inWindow = hour >= startH || hour <= endH;
    }
    if (!inWindow) {
      return { valid: false, reason: `시간대 외 (현재 ${hour}시 / 허용 ${startH}~${endH}시)` };
    }
  }

  // 요일 윈도우 검증
  const allowedDays = message.allowedWeekdays || [0, 1, 2, 3, 4, 5, 6];
  if (allowedDays.length > 0 && !allowedDays.includes(weekday)) {
    const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    return { valid: false, reason: `요일 외 (현재 ${weekdayLabels[weekday]}요일 / 허용 ${allowedDays.map((d) => weekdayLabels[d]).join('/')})` };
  }

  return { valid: true, reason: '시간대 + 요일 정합' };
}

// ════════════════════════════════════════════════════════════════════
// 회사 active 메시지 중 트리거 매칭 후보 조회
// ════════════════════════════════════════════════════════════════════

/**
 * 회사 active 메시지 중 특정 이벤트와 매칭 후보 (시간대 + 요일 추가 필터 후 SDK 응답).
 */
export async function listMessagesByTriggerEvent(
  companyId: string,
  eventName: TriggerConditions['event']
): Promise<TriggerableMessage[]> {
  if (!companyId) return [];

  const r = await query(
    `SELECT id, trigger_conditions, send_start_hour, send_end_hour, allowed_weekdays, status
     FROM cdp_inapp_messages
     WHERE company_id = $1::uuid
       AND status = 'active'
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
       AND (
         trigger_event = $2
         OR (trigger_conditions->>'event' = $2)
       )
     ORDER BY created_at DESC`,
    [companyId, eventName]
  );

  return r.rows.map((row: any) => ({
    id: String(row.id),
    triggerConditions: row.trigger_conditions || { event: eventName },
    sendStartHour: row.send_start_hour,
    sendEndHour: row.send_end_hour,
    allowedWeekdays: Array.isArray(row.allowed_weekdays) ? row.allowed_weekdays.map((d: any) => Number(d)) : [0, 1, 2, 3, 4, 5, 6],
    status: row.status,
  }));
}

/**
 * SDK 호출 시점 — 특정 이벤트 + 컨텍스트로 매칭 메시지 목록 응답 (트리거 + 시간대 + 요일 모두 통과).
 */
export async function findMatchingMessages(
  companyId: string,
  eventContext: SdkEventContext
): Promise<string[]> {
  const candidates = await listMessagesByTriggerEvent(companyId, eventContext.event);
  const matches: string[] = [];
  for (const candidate of candidates) {
    const result = evaluateTrigger(candidate, eventContext);
    if (result.matches) matches.push(candidate.id);
  }
  return matches;
}

// ════════════════════════════════════════════════════════════════════
// CDP 이벤트 → 인앱 트리거 자동 매핑 헬퍼
// ════════════════════════════════════════════════════════════════════

/**
 * cdp-events trackEvent 안 호출용 — 인앱 트리거 매칭 ID 목록 응답 (캐싱 없는 단순 lookup).
 * trackEvent 흐름에서 호출 시 = 비동기 fire-and-forget 정합 (인앱 표시는 SDK가 직접 처리).
 */
export async function listInAppTriggerCandidates(
  companyId: string,
  eventName: string
): Promise<string[]> {
  // cdp_events event_name → 인앱 trigger event 매핑
  const triggerEventMap: Record<string, TriggerConditions['event']> = {
    'page_view': 'page_load',
    'page.view': 'page_load',
    'cart_add': 'cart_add',
    'cart.add': 'cart_add',
    'cart_view': 'cart_view',
    'cart.view': 'cart_view',
    'checkout_start': 'checkout_start',
    'checkout.start': 'checkout_start',
  };

  const triggerEvent = triggerEventMap[eventName];
  if (!triggerEvent) return [];

  const candidates = await listMessagesByTriggerEvent(companyId, triggerEvent);
  return candidates.map((c) => c.id);
}
