"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReportCode = exports.IMC_REPORT_CODE_MAP = void 0;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.isAllowedWebhookIp = isAllowedWebhookIp;
exports.generateMessageKey = generateMessageKey;
exports.parseMessageKey = parseMessageKey;
exports.processKakaoWebhook = processKakaoWebhook;
exports.getRecentWebhookEvents = getRecentWebhookEvents;
exports.getFailedWebhookEventCount = getFailedWebhookEventCount;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const alimtalk_result_map_1 = require("./alimtalk-result-map");
Object.defineProperty(exports, "IMC_REPORT_CODE_MAP", { enumerable: true, get: function () { return alimtalk_result_map_1.IMC_REPORT_CODE_MAP; } });
Object.defineProperty(exports, "resolveReportCode", { enumerable: true, get: function () { return alimtalk_result_map_1.resolveReportCode; } });
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
function verifyWebhookSignature(rawBody, headerSignature, secret) {
    if (!secret || !headerSignature)
        return false;
    const expected = crypto_1.default
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(headerSignature, 'utf8');
    if (a.length !== b.length)
        return false;
    return crypto_1.default.timingSafeEqual(a, b);
}
/**
 * IP 화이트리스트 체크.
 * env `IMC_WEBHOOK_ALLOWED_IPS` (쉼표 구분) 에 포함된 IP만 허용.
 * 값 미설정 시 `true` 반환 (Phase 0 대응 — 개발 환경 편의).
 */
function isAllowedWebhookIp(clientIp) {
    const csv = process.env.IMC_WEBHOOK_ALLOWED_IPS;
    if (!csv || csv.trim() === '')
        return true;
    if (!clientIp)
        return false;
    const allow = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length === 0)
        return true;
    // IPv6 `::ffff:xxx.xxx.xxx.xxx` 형식도 허용하기 위해 suffix 비교
    return allow.some((ip) => clientIp === ip || clientIp.endsWith(`:${ip}`));
}
/**
 * 발송 메시지 추적 키. IMC의 messageKey로 전달 → 웹훅에서 돌려받음 → 본 시스템 레코드 매핑.
 * 형식: `<kind>_<id>_<idx>` (예: `CR_b1a2c3_42`)
 * - kind: CR/DS/TS/AC
 * - id: 각 kind별 원천 레코드 PK (12자리 이상)
 * - idx: 배치 내 수신자 순번 (0-based, 10진)
 *
 * 128자 이내 보장 (IMC templateKey/messageKey 길이 제한).
 */
function generateMessageKey(kind, recordId, index) {
    // uuid dashes 제거 + 최대 32자 → 총 길이 `kind(2) + _(1) + id(32) + _(1) + idx(~10) = 46자` 수준
    const cleanedId = recordId.replace(/-/g, '').slice(0, 32);
    const idx = Math.max(0, Math.floor(index)).toString(10);
    return `${kind}_${cleanedId}_${idx}`;
}
/**
 * messageKey 파싱. 웹훅 수신 시 어떤 발송 경로의 어떤 레코드인지 역추적용.
 * 형식이 맞지 않으면 null 반환.
 */
function parseMessageKey(messageKey) {
    const m = messageKey.match(/^(CR|DS|TS|AC)_([0-9a-f]{1,32})_(\d+)$/i);
    if (!m)
        return null;
    return {
        kind: m[1].toUpperCase(),
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
function parseReceivedAt(s) {
    if (!s)
        return null;
    // 이미 timezone 포함되어 있으면 그대로 반환
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s))
        return s;
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
async function processSingleEvent(ev, batchId) {
    try {
        const exist = await (0, database_1.query)('SELECT event_id FROM kakao_webhook_events WHERE event_id = $1', [ev.eventId]);
        if (exist.rows.length > 0)
            return 'skipped';
        await (0, database_1.query)(`INSERT INTO kakao_webhook_events
         (event_id, batch_id, server_key, message_key,
          report_type, report_code, resend, received_at, net_info, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)`, [
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
        ]);
        // TODO (Phase 2): messageKey → campaign_runs / auto_campaign_runs / direct_send / test_send 매핑 UPDATE.
        // 매핑 규칙(generateMessageKey)은 확정되었으나, 각 레코드별 "수신자 단위 결과 컬럼"이
        // 부재한 상태이므로 Phase 2에서 스키마 확장과 함께 구현한다.
        await (0, database_1.query)(`UPDATE kakao_webhook_events
         SET process_status = 'OK', processed_at = now()
       WHERE event_id = $1`, [ev.eventId]);
        return 'processed';
    }
    catch (err) {
        console.error('[alimtalk-webhook] event 처리 실패', ev.eventId, err?.message);
        try {
            await (0, database_1.query)(`UPDATE kakao_webhook_events
           SET process_status = 'FAILED', error_message = $2, processed_at = now()
         WHERE event_id = $1`, [ev.eventId, String(err?.message || err).slice(0, 1000)]);
        }
        catch {
            // 무시 (최초 INSERT 조차 실패했을 수 있음)
        }
        return 'failed';
    }
}
/**
 * 배치 payload 처리 — 설계서 §8.
 * events 배열을 하나씩 순차 처리 (DB 부하 고려 + idempotent).
 */
async function processKakaoWebhook(payload) {
    const result = { processed: 0, skipped: 0, failed: 0 };
    if (!payload?.events || !Array.isArray(payload.events))
        return result;
    for (const ev of payload.events) {
        const r = await processSingleEvent(ev, payload.batchId);
        result[r]++;
    }
    return result;
}
// ════════════════════════════════════════════════════════════
// 조회 헬퍼 (운영/디버그용)
// ════════════════════════════════════════════════════════════
async function getRecentWebhookEvents(limit = 50) {
    const res = await (0, database_1.query)(`SELECT event_id, message_key, report_type, report_code, resend,
            received_at, process_status, error_message, processed_at
       FROM kakao_webhook_events
       ORDER BY processed_at DESC NULLS LAST, received_at DESC NULLS LAST
       LIMIT $1`, [limit]);
    return res.rows;
}
async function getFailedWebhookEventCount() {
    const res = await (0, database_1.query)(`SELECT COUNT(*)::int AS c FROM kakao_webhook_events WHERE process_status = 'FAILED'`);
    return res.rows[0]?.c ?? 0;
}
//# sourceMappingURL=alimtalk-webhook-handler.js.map