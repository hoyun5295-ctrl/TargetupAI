/**
 * ★ CT-27: In-app Message 컨트롤타워 — D175-A (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 페이지 안에서 표시되는 banner/modal 메시지 박음.
 *   - 회사 admin이 메시지 정의 (제목/본문/CTA/위치/색상/트리거/빈도/노출 기간)
 *   - SDK가 페이지 로드 시 GET /api/cdp/inapp/active 호출 → 현재 사용자에게 표시할 메시지 반환
 *   - 표시/클릭/dismiss는 POST /api/cdp/inapp/track으로 트래킹
 *   - display_frequency 제어 (once_per_session / once_per_day / always)
 *
 * ⛔ 영구 원칙
 *   - 회사 단위 격리 (company_id 필터 절대)
 *   - 표시 빈도 제어는 클라이언트 localStorage + 서버 impressions 양쪽 검증
 *   - status='active' + start_at/end_at 윈도우 + 트리거 이벤트 매칭만 반환
 */

import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type InAppPosition = 'top_banner' | 'bottom_banner' | 'center_modal';
export type InAppFrequency = 'once_per_session' | 'once_per_day' | 'always';
export type InAppStatus = 'active' | 'paused' | 'archived';
export type InAppEventType = 'impression' | 'click' | 'dismiss';

export interface InAppMessage {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string;
  position: InAppPosition;
  backgroundColor: string;
  textColor: string;
  triggerEvent: string;
  displayFrequency: InAppFrequency;
  startAt: Date | null;
  endAt: Date | null;
  status: InAppStatus;
}

export interface CreateInAppMessageInput {
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
  position?: InAppPosition;
  backgroundColor?: string;
  textColor?: string;
  triggerEvent?: string;
  displayFrequency?: InAppFrequency;
  startAt?: string | null;
  endAt?: string | null;
  status?: InAppStatus;
}

// ════════════════════════════════════════════════════════════════════
// 회사 admin — CRUD
// ════════════════════════════════════════════════════════════════════

export async function createInAppMessage(
  companyId: string,
  createdBy: string,
  input: CreateInAppMessageInput
): Promise<InAppMessage> {
  if (!input.title || !input.body) throw new Error('title과 body는 필수입니다.');
  const validPositions: InAppPosition[] = ['top_banner', 'bottom_banner', 'center_modal'];
  const validFrequencies: InAppFrequency[] = ['once_per_session', 'once_per_day', 'always'];

  const position = (validPositions.includes(input.position as InAppPosition) ? input.position : 'top_banner') as InAppPosition;
  const frequency = (validFrequencies.includes(input.displayFrequency as InAppFrequency) ? input.displayFrequency : 'once_per_session') as InAppFrequency;

  const result = await query(
    `INSERT INTO cdp_inapp_messages (
      id, company_id, created_by, title, body, action_url, action_label,
      position, background_color, text_color,
      trigger_event, display_frequency, start_at, end_at, status,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12, $13, $14,
      NOW(), NOW()
    ) RETURNING *`,
    [
      companyId, createdBy, input.title, input.body,
      input.actionUrl || null, input.actionLabel || '자세히 보기',
      position, input.backgroundColor || '#4f46e5', input.textColor || '#ffffff',
      input.triggerEvent || 'page_load', frequency,
      input.startAt || null, input.endAt || null,
      input.status || 'active',
    ]
  );
  return mapRowToMessage(result.rows[0]);
}

export async function listInAppMessages(companyId: string): Promise<InAppMessage[]> {
  const result = await query(
    `SELECT * FROM cdp_inapp_messages
     WHERE company_id = $1::uuid AND status != 'archived'
     ORDER BY created_at DESC`,
    [companyId]
  );
  return result.rows.map(mapRowToMessage);
}

export async function updateInAppMessage(
  companyId: string,
  messageId: string,
  input: Partial<CreateInAppMessageInput>
): Promise<InAppMessage | null> {
  const result = await query(
    `UPDATE cdp_inapp_messages SET
      title = COALESCE($3, title),
      body = COALESCE($4, body),
      action_url = COALESCE($5, action_url),
      action_label = COALESCE($6, action_label),
      position = COALESCE($7, position),
      background_color = COALESCE($8, background_color),
      text_color = COALESCE($9, text_color),
      trigger_event = COALESCE($10, trigger_event),
      display_frequency = COALESCE($11, display_frequency),
      start_at = COALESCE($12, start_at),
      end_at = COALESCE($13, end_at),
      status = COALESCE($14, status),
      updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid
     RETURNING *`,
    [
      messageId, companyId,
      input.title ?? null, input.body ?? null,
      input.actionUrl ?? null, input.actionLabel ?? null,
      input.position ?? null, input.backgroundColor ?? null, input.textColor ?? null,
      input.triggerEvent ?? null, input.displayFrequency ?? null,
      input.startAt ?? null, input.endAt ?? null,
      input.status ?? null,
    ]
  );
  return result.rows.length > 0 ? mapRowToMessage(result.rows[0]) : null;
}

export async function deleteInAppMessage(companyId: string, messageId: string): Promise<boolean> {
  const result = await query(
    `UPDATE cdp_inapp_messages SET status = 'archived', updated_at = NOW()
     WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
    [messageId, companyId]
  );
  return result.rows.length > 0;
}

// ════════════════════════════════════════════════════════════════════
// SDK — 현재 사용자에게 표시할 active 메시지 조회
// ════════════════════════════════════════════════════════════════════

export interface ActiveMessagesInput {
  companyId: string;
  triggerEvent?: string;            // 기본 'page_load'
  externalId?: string;              // 회원 식별
  anonymousId?: string;             // 비회원 식별
  /** 클라이언트가 박은 표시 이력 (localStorage) — 서버 검증 보조 */
  seenMessageIds?: string[];
}

export async function getActiveMessagesForCustomer(input: ActiveMessagesInput): Promise<InAppMessage[]> {
  const trigger = input.triggerEvent || 'page_load';

  const result = await query(
    `SELECT * FROM cdp_inapp_messages
     WHERE company_id = $1::uuid
       AND status = 'active'
       AND trigger_event = $2
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY created_at DESC
     LIMIT 5`,
    [input.companyId, trigger]
  );

  let messages = result.rows.map(mapRowToMessage);

  // display_frequency 서버측 보조 검증 (클라이언트 localStorage가 진짜 진실의 원천)
  // once_per_day 메시지는 같은 사용자가 24h 안에 본 적 있는지 cdp_inapp_impressions 검증
  const onceMessages = messages.filter((m) => m.displayFrequency === 'once_per_day');
  if (onceMessages.length > 0 && (input.externalId || input.anonymousId)) {
    const messageIds = onceMessages.map((m) => m.id);
    const linkFilter = input.externalId
      ? `AND identity_link_id IN (SELECT id FROM cdp_identity_links WHERE company_id = $1::uuid AND external_id = $3)`
      : `AND anonymous_id = $3`;
    const seenResult = await query(
      `SELECT DISTINCT message_id FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND occurred_at > NOW() - INTERVAL '24 hours'
         ${linkFilter}`,
      [input.companyId, messageIds, input.externalId || input.anonymousId]
    );
    const seenIds = new Set<string>(seenResult.rows.map((r: any) => r.message_id));
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_day' || !seenIds.has(m.id));
  }

  // 클라이언트가 박은 seenMessageIds도 제외 (once_per_session 메시지)
  if (input.seenMessageIds && input.seenMessageIds.length > 0) {
    const seenSet = new Set(input.seenMessageIds);
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_session' || !seenSet.has(m.id));
  }

  return messages;
}

// ════════════════════════════════════════════════════════════════════
// SDK — 표시/클릭/dismiss 트래킹
// ════════════════════════════════════════════════════════════════════

export interface TrackImpressionInput {
  companyId: string;
  messageId: string;
  eventType: InAppEventType;
  customerId?: string | null;
  identityLinkId?: string | null;
  anonymousId?: string | null;
}

export async function trackImpression(input: TrackImpressionInput): Promise<void> {
  if (!input.companyId || !input.messageId || !input.eventType) {
    throw new Error('companyId, messageId, eventType은 필수입니다.');
  }
  if (!['impression', 'click', 'dismiss'].includes(input.eventType)) {
    throw new Error(`허용되지 않는 event_type: ${input.eventType}`);
  }
  await query(
    `INSERT INTO cdp_inapp_impressions (
      company_id, message_id, customer_id, identity_link_id, anonymous_id,
      event_type, occurred_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
      $6, NOW()
    )`,
    [
      input.companyId, input.messageId,
      input.customerId || null, input.identityLinkId || null, input.anonymousId || null,
      input.eventType,
    ]
  );
}

// ════════════════════════════════════════════════════════════════════
// 메시지별 성과 집계 (InAppMessagesPage)
// ════════════════════════════════════════════════════════════════════

export async function getMessageStats(companyId: string, messageId: string): Promise<{
  impressions: number;
  clicks: number;
  dismisses: number;
  ctr: number;
}> {
  const result = await query(
    `SELECT event_type, COUNT(*)::int AS cnt
     FROM cdp_inapp_impressions
     WHERE company_id = $1::uuid AND message_id = $2::uuid
     GROUP BY event_type`,
    [companyId, messageId]
  );
  const map: Record<string, number> = { impression: 0, click: 0, dismiss: 0 };
  result.rows.forEach((r: any) => { map[r.event_type] = r.cnt; });
  const impressions = map.impression || 0;
  return {
    impressions,
    clicks: map.click || 0,
    dismisses: map.dismiss || 0,
    ctr: impressions > 0 ? (map.click || 0) / impressions : 0,
  };
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼
// ════════════════════════════════════════════════════════════════════

function mapRowToMessage(row: any): InAppMessage {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    actionUrl: row.action_url,
    actionLabel: row.action_label,
    position: row.position,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    triggerEvent: row.trigger_event,
    displayFrequency: row.display_frequency,
    startAt: row.start_at ? new Date(row.start_at) : null,
    endAt: row.end_at ? new Date(row.end_at) : null,
    status: row.status,
  };
}
