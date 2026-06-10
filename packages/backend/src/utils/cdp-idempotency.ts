/**
 * ★ CT-85: CDP Webhook 멱등 키 컨트롤타워 — 2026-06-10
 *
 * 목적
 *   자사몰 webhook의 idempotency_key 생성 단일 진입점.
 *   custom-self-hosted-adapter / cafe24-client / naver-commerce-client 3곳이 공용.
 *
 * 설계 원칙 (2026-06-10 점검에서 확정된 결함 정정)
 *   - 이전 방식 `${event}:${order_id || member_id}`는 같은 주문의 두 번째 갱신(order.updated)부터
 *     전부 duplicate로 버려져 주문 상태 전환·회원 정보 갱신이 영구 차단되는 결함이 있었다.
 *   - 1순위: 자사몰이 보낸 "전송 1건 고유값" (event_id / event_no / delivery_id / webhook_id)
 *     → 같은 전송의 재시도만 차단되고, 새 전송(상태 변경)은 통과.
 *   - 2순위(고유값 미전송): `${event}:${entityId}:${본문 해시 12자}`
 *     → 동일 내용 재전송 = 같은 키(차단), 내용이 바뀐 갱신 = 다른 키(통과).
 *
 * 주의
 *   - 본문 해시는 파싱된 body를 JSON.stringify한 문자열 기준 — 같은 파싱 결과면 결정적(deterministic).
 *   - DB import 없음 (순수 함수 — DB-free 테스트 가능).
 */

import { createHash } from 'crypto';

/** idempotency_key varchar(200) 한도 안에서 안전하게 자르기 */
const MAX_KEY_LENGTH = 200;

/** 전송 1건 고유값으로 인정하는 body 필드 (자사몰 공통 관례 순서) */
const DELIVERY_ID_FIELDS = ['event_id', 'event_no', 'delivery_id', 'webhook_id'] as const;

/** 엔티티 식별값으로 쓰는 resource 필드 (주문 → 회원 순) */
const ENTITY_ID_FIELDS = ['order_id', 'product_order_id', 'member_id', 'external_id', 'customer_id'] as const;

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function clampKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  // 한도 초과 시 앞부분 + 전체 해시로 충돌 없이 축약
  return `${key.slice(0, MAX_KEY_LENGTH - 13)}:${shortHash(key)}`;
}

/**
 * Webhook 멱등 키 생성 (3 어댑터 공용 단일 진입점).
 *
 * @param event    이벤트명 (order.created / customer.updated 등)
 * @param resource webhook body의 resource 객체
 * @param body     webhook body 전체 (전송 고유값 + 해시 원본)
 */
export function buildWebhookIdempotencyKey(
  event: string,
  resource: Record<string, any> | null | undefined,
  body: Record<string, any> | null | undefined
): string {
  const safeEvent = String(event || 'unknown');
  const r = resource || {};
  const b = body || {};

  // 1순위 — 전송 1건 고유값 (재시도만 차단, 새 전송은 통과)
  for (const field of DELIVERY_ID_FIELDS) {
    const v = b[field] ?? r[field];
    if (v !== undefined && v !== null && String(v).length > 0) {
      return clampKey(`${safeEvent}:evt:${String(v)}`);
    }
  }

  // 2순위 — 엔티티 식별값 + 본문 해시 (동일 내용 재전송만 차단)
  let entityId = 'noid';
  for (const field of ENTITY_ID_FIELDS) {
    const v = r[field];
    if (v !== undefined && v !== null && String(v).length > 0) {
      entityId = String(v);
      break;
    }
  }

  let bodyJson = '';
  try {
    bodyJson = JSON.stringify(b);
  } catch {
    bodyJson = String(Object.keys(b).length);
  }
  return clampKey(`${safeEvent}:${entityId}:${shortHash(bodyJson)}`);
}
