/**
 * CT-18: 휴머스온 IMC 웹훅 수신 처리 컨트롤타워
 *
 * ALIMTALK-DESIGN.md §5-4, §8 준수.
 *
 * 역할:
 *   1) HMAC-SHA256 서명 검증 (`verifyWebhookSignature`)
 *   2) IP 화이트리스트 검증 (`isAllowedWebhookIp`)
 *   3) 이벤트 idempotent UPSERT (`kakao_webhook_events.event_id` PK)
 *   4) messageKey 생성 규칙 제공 (`generateMessageKey`) — 발송 5경로가 동일 규칙 사용
 *
 * 담당 범위 한계 (Phase 1):
 *   - `kakao_webhook_events` idempotent INSERT까지만 완료.
 *   - `messages` / `campaign_runs` / `auto_campaign_runs` 실 UPDATE는 Phase 2 착수 예정.
 *     (메시지별 추적 컬럼 + sync 로직 조정은 발송 경로 확장과 함께 설계)
 */

import crypto from 'crypto';
import { query } from '../config/database';
import { IMC_REPORT_CODE_MAP, resolveReportCode } from './alimtalk-result-map';

// ════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════

export interface WebhookEventPayload {
  serverKey: string;
  messageKey: string;
  reportType: string; // SM/LM/MM/AT/FT/RCS
  reportCode: string;
  resend: boolean;
  receivedAt: string; // 예: "2026-03-05 19:49:43" (휴머스온 표기)
  netInfo?: string;
}

export interface WebhookEvent {
  eventId: string;
  payload: WebhookEventPayload;
}

export interface WebhookPayload {
  events: WebhookEvent[];
  batchId: string;
  timestamp: number; // epoch second
}

export interface WebhookProcessResult {
  processed: number;
  skipped: number;
  failed: number;
}

// ════════════════════════════════════════════════════════════
// 보안 검증
// ════════════════════════════════════════════════════════════

/**
 * HMAC-SHA256 서명 검증.
 * 휴머스온이 헤더로 전달한 signature(hex)와 rawBody + secret을 비교.
 * 타이밍 공격 방어를 위해 `crypto.timingSafeEqual` 사용.
 *
 * env `IMC_WEBHOOK_HMAC_SECRET` 미설정 시 `false` 반환 (Phase 0 대응).
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headerSignature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !headerSignature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerSignature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * IP 화이트리스트 체크.
 * env `IMC_WEBHOOK_ALLOWED_IPS` (쉼표 구분) 에 포함된 IP만 허용.
 * 값 미설정 시 `true` 반환 (Phase 0 대응 — 개발 환경 편의).
 */
export function isAllowedWebhookIp(clientIp: string | undefined): boolean {
  const csv = process.env.IMC_WEBHOOK_ALLOWED_IPS;
  if (!csv || csv.trim() === '') return true;
  if (!clientIp) return false;
  const allow = csv.split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true;
  // IPv6 `::ffff:xxx.xxx.xxx.xxx` 형식도 허용하기 위해 suffix 비교
  return allow.some((ip) => clientIp === ip || clientIp.endsWith(`:${ip}`));
}

// ════════════════════════════════════════════════════════════
// messageKey 생성 규칙 (발송 5경로 공용)
// ════════════════════════════════════════════════════════════

export type MessageKeyKind =
  | 'CR' // campaign_run (일반 AI 캠페인 + 예약발송)
  | 'DS' // direct_send (직접발송)
  | 'TS' // test_send (테스트발송)
  | 'AC'; // auto_campaign_run (자동발송)

/**
 * 발송 메시지 추적 키. IMC의 messageKey로 전달 → 웹훅에서 돌려받음 → 본 시스템 레코드 매핑.
 * 형식: `<kind>_<id>_<idx>` (예: `CR_b1a2c3_42`)
 * - kind: CR/DS/TS/AC
 * - id: 각 kind별 원천 레코드 PK (12자리 이상)
 * - idx: 배치 내 수신자 순번 (0-based, 10진)
 *
 * 128자 이내 보장 (IMC templateKey/messageKey 길이 제한).
 */
export function generateMessageKey(
  kind: MessageKeyKind,
  recordId: string,
  index: number,
): string {
  // uuid dashes 제거 + 최대 32자 → 총 길이 `kind(2) + _(1) + id(32) + _(1) + idx(~10) = 46자` 수준
  const cleanedId = recordId.replace(/-/g, '').slice(0, 32);
  const idx = Math.max(0, Math.floor(index)).toString(10);
  return `${kind}_${cleanedId}_${idx}`;
}

/**
 * messageKey 파싱. 웹훅 수신 시 어떤 발송 경로의 어떤 레코드인지 역추적용.
 * 형식이 맞지 않으면 null 반환.
 */
export function parseMessageKey(messageKey: string): {
  kind: MessageKeyKind;
  recordId: string;
  index: number;
} | null {
  const m = messageKey.match(/^(CR|DS|TS|AC)_([0-9a-f]{1,32})_(\d+)$/i);
  if (!m) return null;
  return {
    kind: m[1].toUpperCase() as MessageKeyKind,
    recordId: m[2],
    index: parseInt(m[3], 10),
  };
}

// ════════════════════════════════════════════════════════════
// 이벤트 idempotent 처리
// ════════════════════════════════════════════════════════════

/**
 * receivedAt 문자열을 timestamptz로 안전 변환.
 * 휴머스온이 `"YYYY-MM-DD HH:mm:ss"` 형식(타임존 미포함)으로 보내면 **KST로 해석**
 * (휴머스온 서버 시간대 기준).
 */
function parseReceivedAt(s: string | undefined): string | null {
  if (!s) return null;
  // 이미 timezone 포함되어 있으면 그대로 반환
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  // "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DD HH:mm:ss+09:00"
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) {
    return `${s.replace(' ', 'T')}+09:00`;
  }
  return s;
}

/**
 * 단일 이벤트 처리 — idempotent INSERT + process_status='OK' 마킹.
 * 중복 event_id는 skip.
 */
async function processSingleEvent(
  ev: WebhookEvent,
  batchId: string,
): Promise<'processed' | 'skipped' | 'failed'> {
  try {
    const exist = await query(
      'SELECT event_id FROM kakao_webhook_events WHERE event_id = $1',
      [ev.eventId],
    );
    if (exist.rows.length > 0) return 'skipped';

    await query(
      `INSERT INTO kakao_webhook_events
         (event_id, batch_id, server_key, message_key,
          report_type, report_code, resend, received_at, net_info, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)`,
      [
        ev.eventId,
        batchId,
        ev.payload.serverKey,
        ev.payload.messageKey,
        ev.payload.reportType,
        ev.payload.reportCode,
        !!ev.payload.resend,
        parseReceivedAt(ev.payload.receivedAt),
        ev.payload.netInfo ?? null,
        JSON.stringify(ev.payload),
      ],
    );

    // TODO (Phase 2): messageKey → campaign_runs / auto_campaign_runs / direct_send / test_send 매핑 UPDATE.
    // 매핑 규칙(generateMessageKey)은 확정되었으나, 각 레코드별 "수신자 단위 결과 컬럼"이
    // 부재한 상태이므로 Phase 2에서 스키마 확장과 함께 구현한다.

    await query(
      `UPDATE kakao_webhook_events
         SET process_status = 'OK', processed_at = now()
       WHERE event_id = $1`,
      [ev.eventId],
    );

    return 'processed';
  } catch (err: any) {
    console.error('[alimtalk-webhook] event 처리 실패', ev.eventId, err?.message);
    try {
      await query(
        `UPDATE kakao_webhook_events
           SET process_status = 'FAILED', error_message = $2, processed_at = now()
         WHERE event_id = $1`,
        [ev.eventId, String(err?.message || err).slice(0, 1000)],
      );
    } catch {
      // 무시 (최초 INSERT 조차 실패했을 수 있음)
    }
    return 'failed';
  }
}

/**
 * 배치 payload 처리 — 설계서 §8.
 * events 배열을 하나씩 순차 처리 (DB 부하 고려 + idempotent).
 */
export async function processKakaoWebhook(
  payload: WebhookPayload,
): Promise<WebhookProcessResult> {
  const result: WebhookProcessResult = { processed: 0, skipped: 0, failed: 0 };
  if (!payload?.events || !Array.isArray(payload.events)) return result;

  for (const ev of payload.events) {
    const r = await processSingleEvent(ev, payload.batchId);
    result[r]++;
  }

  return result;
}

// ════════════════════════════════════════════════════════════
// 조회 헬퍼 (운영/디버그용)
// ════════════════════════════════════════════════════════════

export async function getRecentWebhookEvents(
  limit = 50,
): Promise<any[]> {
  const res = await query(
    `SELECT event_id, message_key, report_type, report_code, resend,
            received_at, process_status, error_message, processed_at
       FROM kakao_webhook_events
       ORDER BY processed_at DESC NULLS LAST, received_at DESC NULLS LAST
       LIMIT $1`,
    [limit],
  );
  return res.rows;
}

export async function getFailedWebhookEventCount(): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS c FROM kakao_webhook_events WHERE process_status = 'FAILED'`,
  );
  return res.rows[0]?.c ?? 0;
}

// 리포트 코드 매퍼 재노출 (편의)
export { IMC_REPORT_CODE_MAP, resolveReportCode };
