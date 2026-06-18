/**
 * ★ CT-27: In-app Message 컨트롤타워 — D175-A (2026-05-19)
 *
 * 🎯 목적
 *   자사몰 페이지 안에서 표시되는 banner/modal 메시지 관리.
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
// ★ D215+ (2026-05-25) 통합 영역 — CT-78 (segment) + CT-80 (variant) + CT-82 (trigger window)
import { customerMatchesSegment, isEmptySegment } from './inapp-segment-matcher';
import { selectVariantForCustomer } from './inapp-variant-optimizer';
import { isTimeWindowValid } from './inapp-trigger-engine';

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
  channel: 'web' | 'app';
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
  channel?: 'web' | 'app';
  // ★ 누락 시 이미지·CTA·표시형태·세그먼트가 저장 안 됨 (handleSave가 보내는 snake 키 매칭)
  template?: string;
  image_url?: string | null;
  badge_text?: string | null;
  buttons?: any[];
  segment_conditions?: any;
  trigger_conditions?: any;
  personalization_vars?: any[];
  auto_dismiss_seconds?: number | null;
  max_displays_per_user?: number | null;
  send_start_hour?: number | null;
  send_end_hour?: number | null;
  allowed_weekdays?: number[];
  animation?: string;
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
  // ★ 2026-06-17 채널 분리 — web(자사몰 팝업) / app(모바일 인앱). 미지정 시 web.
  const channel: 'web' | 'app' = input.channel === 'app' ? 'app' : 'web';

  const result = await query(
    `INSERT INTO cdp_inapp_messages (
      id, company_id, created_by, title, body, action_url, action_label,
      position, background_color, text_color,
      trigger_event, display_frequency, start_at, end_at, status, channel,
      template, image_url, buttons, segment_conditions, trigger_conditions,
      personalization_vars, auto_dismiss_seconds, max_displays_per_user,
      send_start_hour, send_end_hour, allowed_weekdays, animation, badge_text,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6,
      $7, $8, $9,
      $10, $11, $12, $13, $14, $15,
      $16, $17, $18::jsonb, $19::jsonb, $20::jsonb,
      $21::jsonb, $22, $23,
      $24, $25, $26, $27, $28,
      NOW(), NOW()
    ) RETURNING *`,
    [
      companyId, createdBy, input.title, input.body,
      input.actionUrl || null, input.actionLabel || '자세히 보기',
      position, input.backgroundColor || '#4f46e5', input.textColor || '#ffffff',
      input.triggerEvent || 'page_load', frequency,
      input.startAt || null, input.endAt || null,
      input.status || 'active', channel,
      input.template || position, input.image_url || null,
      JSON.stringify(input.buttons || []), JSON.stringify(input.segment_conditions || {}), JSON.stringify(input.trigger_conditions || {}),
      JSON.stringify(input.personalization_vars || []), input.auto_dismiss_seconds ?? null, input.max_displays_per_user ?? null,
      input.send_start_hour ?? null, input.send_end_hour ?? null, input.allowed_weekdays || [0, 1, 2, 3, 4, 5, 6], input.animation || 'fade',
      input.badge_text ?? null,
    ]
  );
  return mapRowToMessage(result.rows[0]);
}

export async function listInAppMessages(companyId: string, channel?: 'web' | 'app'): Promise<Record<string, any>[]> {
  const result = await query(
    `SELECT * FROM cdp_inapp_messages
     WHERE company_id = $1::uuid AND status != 'archived'
       AND ($2::varchar IS NULL OR channel = $2)
     ORDER BY created_at DESC`,
    [companyId, channel || null]
  );
  // 편집 화면이 전체 필드(buttons·badge_text·image_url·segment_conditions·시간설정)를 그대로 받도록
  // raw row(snake_case = 프론트 MessageRow 일치) 반환. mapRowToMessage는 기본 필드만 줘서
  // 수정 진입 시 신규 필드가 통째로 비던 문제(저장 시 덮어쓰기)를 차단한다.
  return result.rows;
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
      template = COALESCE($15, template),
      image_url = $16,
      buttons = COALESCE($17::jsonb, buttons),
      segment_conditions = COALESCE($18::jsonb, segment_conditions),
      trigger_conditions = COALESCE($19::jsonb, trigger_conditions),
      personalization_vars = COALESCE($20::jsonb, personalization_vars),
      auto_dismiss_seconds = $21,
      max_displays_per_user = $22,
      send_start_hour = $23,
      send_end_hour = $24,
      allowed_weekdays = COALESCE($25, allowed_weekdays),
      animation = COALESCE($26, animation),
      badge_text = COALESCE($27, badge_text),
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
      input.template ?? null, input.image_url ?? null,
      input.buttons ? JSON.stringify(input.buttons) : null, input.segment_conditions ? JSON.stringify(input.segment_conditions) : null,
      input.trigger_conditions ? JSON.stringify(input.trigger_conditions) : null, input.personalization_vars ? JSON.stringify(input.personalization_vars) : null,
      input.auto_dismiss_seconds ?? null, input.max_displays_per_user ?? null,
      input.send_start_hour ?? null, input.send_end_hour ?? null,
      input.allowed_weekdays ?? null, input.animation ?? null,
      input.badge_text ?? null,
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
  /** 클라이언트가 전달한 표시 이력 (localStorage) — 서버 검증 보조 */
  seenMessageIds?: string[];
  /** ★ 2026-06-17 2단계 — 'web'(자사몰 팝업, 기본) / 'app'(웹뷰 앱 인앱). 미지정 시 web 하위호환 */
  channel?: 'web' | 'app';
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

  // 클라이언트가 전달한 seenMessageIds 제외 (once_per_session 메시지)
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
  // ★ D215+ (2026-05-25) 신규 컬럼
  buttonId?: string | null;              // 다중 CTA click 분리용
  dwellSeconds?: number | null;          // 체류 시간 (UI 자세히 분석)
  attributedPurchaseId?: string | null;  // 24h purchase attribution 직접 매핑
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
      event_type, button_id, dwell_seconds, attributed_purchase_id, occurred_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
      $6, $7, $8, $9::uuid, NOW()
    )`,
    [
      input.companyId, input.messageId,
      input.customerId || null, input.identityLinkId || null, input.anonymousId || null,
      input.eventType,
      input.buttonId || null,
      input.dwellSeconds ?? null,
      input.attributedPurchaseId || null,
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

// ★ D210+ Phase 3 B-4 (2026-05-23 Harold 명시): 회사 전체 메시지 통계 (CTR funnel 시각화)
//   회사 admin Dashboard 메시지별 funnel 시각화 + 비교 표 일치
export async function getCompanyInAppStats(companyId: string, channel?: 'web' | 'app'): Promise<Array<{
  messageId: string;
  title: string;
  status: string;
  impressions: number;
  clicks: number;
  dismisses: number;
  ctr: number;             // click / impression
  dismissRate: number;     // dismiss / impression
  uniqueImpressions: number;  // distinct customer_id
}>> {
  const r = await query(
    `SELECT
       m.id AS message_id,
       m.title,
       m.status,
       COUNT(*) FILTER (WHERE i.event_type = 'impression')::int AS impressions,
       COUNT(*) FILTER (WHERE i.event_type = 'click')::int AS clicks,
       COUNT(*) FILTER (WHERE i.event_type = 'dismiss')::int AS dismisses,
       COUNT(DISTINCT i.customer_id) FILTER (WHERE i.event_type = 'impression' AND i.customer_id IS NOT NULL)::int AS unique_impressions
     FROM cdp_inapp_messages m
     LEFT JOIN cdp_inapp_impressions i ON i.message_id = m.id AND i.company_id = m.company_id
     WHERE m.company_id = $1::uuid
       AND ($2::varchar IS NULL OR m.channel = $2)
     GROUP BY m.id, m.title, m.status, m.created_at
     ORDER BY m.created_at DESC`,
    [companyId]
  );
  return r.rows.map((row: any) => {
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const dismisses = Number(row.dismisses) || 0;
    return {
      messageId: row.message_id,
      title: row.title,
      status: row.status,
      impressions,
      clicks,
      dismisses,
      ctr: impressions > 0 ? clicks / impressions : 0,
      dismissRate: impressions > 0 ? dismisses / impressions : 0,
      uniqueImpressions: Number(row.unique_impressions) || 0,
    };
  });
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
    channel: row.channel === 'app' ? 'app' : 'web',
  };
}

// ════════════════════════════════════════════════════════════════════
// ★ D215+ (2026-05-25) 통합 — InAppMessageDetail 타입 + V2 함수 + 헬퍼
//   옛 InAppMessage + getActiveMessagesForCustomer 보존 (backward compat)
// ════════════════════════════════════════════════════════════════════

export interface InAppMessageDetail extends InAppMessage {
  template: string;
  imageUrl: string | null;
  badgeText: string | null;
  buttons: any[];
  segmentConditions: any;
  triggerConditions: any;
  personalizationVars: string[];
  parentMessageId: string | null;
  variantWeight: number;
  autoDismissSeconds: number | null;
  maxDisplaysPerUser: number | null;
  sendStartHour: number | null;
  sendEndHour: number | null;
  allowedWeekdays: number[];
  localeVariants: any;
  animation: string;
}

function mapRowToMessageDetail(row: any): InAppMessageDetail {
  return {
    ...mapRowToMessage(row),
    template: row.template || row.position || 'top_banner',
    imageUrl: row.image_url || null,
    badgeText: row.badge_text || null,
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    segmentConditions: row.segment_conditions || {},
    triggerConditions: row.trigger_conditions || { event: row.trigger_event || 'page_load' },
    personalizationVars: Array.isArray(row.personalization_vars) ? row.personalization_vars : [],
    parentMessageId: row.parent_message_id || null,
    variantWeight: Number(row.variant_weight ?? 100),
    autoDismissSeconds: row.auto_dismiss_seconds ?? null,
    maxDisplaysPerUser: row.max_displays_per_user ?? null,
    sendStartHour: row.send_start_hour ?? null,
    sendEndHour: row.send_end_hour ?? null,
    allowedWeekdays: Array.isArray(row.allowed_weekdays) ? row.allowed_weekdays.map((d: any) => Number(d)) : [0, 1, 2, 3, 4, 5, 6],
    localeVariants: row.locale_variants || {},
    animation: row.animation || 'fade',
  };
}

const FULL_COLUMNS = `id, title, body, action_url, action_label, position, background_color, text_color,
                      trigger_event, display_frequency, start_at, end_at, status,
                      template, image_url, badge_text, buttons, segment_conditions, trigger_conditions,
                      personalization_vars, parent_message_id, variant_weight,
                      auto_dismiss_seconds, max_displays_per_user,
                      send_start_hour, send_end_hour, allowed_weekdays, locale_variants, animation, channel`;

/**
 * ★ D215+ V2 — SDK GET /inapp/active 호출 진입.
 *
 * 옛 V1 (getActiveMessagesForCustomer) 대비 강화:
 * - 신규 trigger_conditions 우선 매칭 (옛 trigger_event 컬럼 fallback)
 * - parent_message_id IS NULL = 부모만 후보 (variant는 CT-80 selectVariantForCustomer로 매핑)
 * - 시간대 + 요일 윈도우 검증 (CT-82 isTimeWindowValid)
 * - 세그먼트 조건 검증 (CT-78 customerMatchesSegment)
 * - max_displays_per_user 검증 (사용자별 누적 impression 한도)
 * - once_per_day 옛 영역 유지 (DB cdp_inapp_impressions 24h 매칭)
 */
export async function getActiveMessagesForCustomerV2(input: ActiveMessagesInput): Promise<InAppMessageDetail[]> {
  const trigger = input.triggerEvent || 'page_load';

  // Step 1 — 부모 메시지 후보 조회 (trigger_event 또는 trigger_conditions.event 매칭)
  const candidateResult = await query(
    `SELECT ${FULL_COLUMNS}
     FROM cdp_inapp_messages
     WHERE company_id = $1::uuid
       AND status = 'active'
       AND channel = $3
       AND parent_message_id IS NULL
       AND (trigger_event = $2 OR (trigger_conditions->>'event' = $2))
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY created_at DESC
     LIMIT 20`,
    [input.companyId, trigger, input.channel || 'web']
  );
  let candidates: any[] = candidateResult.rows;

  // Step 2 — customer ID 매핑 (외부 ID → customer_id)
  let customerId: string | null = null;
  if (input.externalId) {
    const linkR = await query(
      `SELECT customer_id FROM cdp_identity_links
       WHERE company_id = $1::uuid AND external_id = $2 LIMIT 1`,
      [input.companyId, input.externalId]
    );
    if (linkR.rows.length > 0 && linkR.rows[0].customer_id) {
      customerId = String(linkR.rows[0].customer_id);
    }
  }

  // Step 3 — 시간대 + 요일 윈도우 + 세그먼트 검증 (개별 후보 순회)
  const passed: any[] = [];
  for (const cand of candidates) {
    const timeWindow = isTimeWindowValid({
      id: String(cand.id),
      triggerConditions: cand.trigger_conditions || { event: trigger },
      sendStartHour: cand.send_start_hour,
      sendEndHour: cand.send_end_hour,
      allowedWeekdays: Array.isArray(cand.allowed_weekdays) ? cand.allowed_weekdays.map((d: any) => Number(d)) : [0, 1, 2, 3, 4, 5, 6],
      status: cand.status,
    });
    if (!timeWindow.valid) continue;

    const segmentConds = cand.segment_conditions || {};
    if (!isEmptySegment(segmentConds)) {
      if (!customerId) continue;  // 세그먼트 조건 있는데 customer 미식별 = 매칭 불가
      const segMatch = await customerMatchesSegment(input.companyId, customerId, segmentConds).catch(() => false);
      if (!segMatch) continue;
    }

    passed.push(cand);
  }

  // Step 4 — 각 후보별 variant 매핑 (CT-80 selectVariantForCustomer)
  const selected: any[] = [];
  for (const cand of passed) {
    const selection = await selectVariantForCustomer(
      input.companyId,
      String(cand.id),
      customerId,
      input.anonymousId || null,
    ).catch(() => null);

    if (selection && !selection.isParent && selection.messageId !== String(cand.id)) {
      const variantR = await query(
        `SELECT ${FULL_COLUMNS}
         FROM cdp_inapp_messages
         WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [selection.messageId, input.companyId]
      );
      if (variantR.rows.length > 0) {
        selected.push(variantR.rows[0]);
        continue;
      }
    }
    selected.push(cand);
  }

  let messages = selected.map(mapRowToMessageDetail);

  // Step 5 — once_per_day 누적 impression 검증 (24h 윈도우)
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

  // Step 6 — max_displays_per_user 검증 (사용자별 누적 impression 한도)
  const limitedMessages = messages.filter((m) => m.maxDisplaysPerUser !== null && m.maxDisplaysPerUser > 0);
  if (limitedMessages.length > 0 && (customerId || input.anonymousId)) {
    const checkUserKey = customerId || input.anonymousId;
    const userFilterSql = customerId ? `customer_id = $3::uuid` : `anonymous_id = $3`;
    const limitR = await query(
      `SELECT message_id, COUNT(*)::int AS cnt
       FROM cdp_inapp_impressions
       WHERE company_id = $1::uuid
         AND message_id = ANY($2::uuid[])
         AND event_type = 'impression'
         AND ${userFilterSql}
       GROUP BY message_id`,
      [input.companyId, limitedMessages.map((m) => m.id), checkUserKey]
    );
    const userCountMap = new Map<string, number>();
    limitR.rows.forEach((r: any) => userCountMap.set(String(r.message_id), Number(r.cnt || 0)));
    messages = messages.filter((m) => {
      if (m.maxDisplaysPerUser === null || m.maxDisplaysPerUser <= 0) return true;
      const userCount = userCountMap.get(m.id) || 0;
      return userCount < m.maxDisplaysPerUser;
    });
  }

  // Step 7 — once_per_session 클라이언트 hint (옛 영역 유지)
  if (input.seenMessageIds && input.seenMessageIds.length > 0) {
    const seenSet = new Set(input.seenMessageIds);
    messages = messages.filter((m) => m.displayFrequency !== 'once_per_session' || !seenSet.has(m.id));
  }

  return messages;
}
