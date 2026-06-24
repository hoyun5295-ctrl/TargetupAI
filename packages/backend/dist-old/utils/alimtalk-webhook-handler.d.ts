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
import { IMC_REPORT_CODE_MAP, resolveReportCode } from './alimtalk-result-map';
export interface WebhookEventPayload {
    serverKey: string;
    messageKey: string;
    reportType: string;
    reportCode: string;
    resend: boolean;
    receivedAt: string;
    netInfo?: string;
}
export interface WebhookEvent {
    eventId: string;
    payload: WebhookEventPayload;
}
export interface WebhookPayload {
    events: WebhookEvent[];
    batchId: string;
    timestamp: number;
}
export interface WebhookProcessResult {
    processed: number;
    skipped: number;
    failed: number;
}
/**
 * HMAC-SHA256 서명 검증.
 * 휴머스온이 헤더로 전달한 signature(hex)와 rawBody + secret을 비교.
 * 타이밍 공격 방어를 위해 `crypto.timingSafeEqual` 사용.
 *
 * env `IMC_WEBHOOK_HMAC_SECRET` 미설정 시 `false` 반환 (Phase 0 대응).
 */
export declare function verifyWebhookSignature(rawBody: string | Buffer, headerSignature: string | undefined, secret: string | undefined): boolean;
/**
 * IP 화이트리스트 체크.
 * env `IMC_WEBHOOK_ALLOWED_IPS` (쉼표 구분) 에 포함된 IP만 허용.
 * 값 미설정 시 `true` 반환 (Phase 0 대응 — 개발 환경 편의).
 */
export declare function isAllowedWebhookIp(clientIp: string | undefined): boolean;
export type MessageKeyKind = 'CR' | 'DS' | 'TS' | 'AC';
/**
 * 발송 메시지 추적 키. IMC의 messageKey로 전달 → 웹훅에서 돌려받음 → 본 시스템 레코드 매핑.
 * 형식: `<kind>_<id>_<idx>` (예: `CR_b1a2c3_42`)
 * - kind: CR/DS/TS/AC
 * - id: 각 kind별 원천 레코드 PK (12자리 이상)
 * - idx: 배치 내 수신자 순번 (0-based, 10진)
 *
 * 128자 이내 보장 (IMC templateKey/messageKey 길이 제한).
 */
export declare function generateMessageKey(kind: MessageKeyKind, recordId: string, index: number): string;
/**
 * messageKey 파싱. 웹훅 수신 시 어떤 발송 경로의 어떤 레코드인지 역추적용.
 * 형식이 맞지 않으면 null 반환.
 */
export declare function parseMessageKey(messageKey: string): {
    kind: MessageKeyKind;
    recordId: string;
    index: number;
} | null;
/**
 * 배치 payload 처리 — 설계서 §8.
 * events 배열을 하나씩 순차 처리 (DB 부하 고려 + idempotent).
 */
export declare function processKakaoWebhook(payload: WebhookPayload): Promise<WebhookProcessResult>;
export declare function getRecentWebhookEvents(limit?: number): Promise<any[]>;
export declare function getFailedWebhookEventCount(): Promise<number>;
export { IMC_REPORT_CODE_MAP, resolveReportCode };
//# sourceMappingURL=alimtalk-webhook-handler.d.ts.map