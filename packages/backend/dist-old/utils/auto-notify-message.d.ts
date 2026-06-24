/**
 * auto-notify-message.ts — 자동발송 담당자 알림 메시지 빌더 (CT-B, B6)
 *
 * 자동발송 워커가 담당자에게 보내는 SMS/LMS 알림(D-2 AI생성/D-1 사전알림/D-day 스팸결과)을
 * 한 곳에서 만든다.
 *
 * 배경 (B6 버그):
 *   기존 알림 메시지에 ▼ ※ ⚠️ 같은 dingbats/이모지가 들어가 있어
 *   일부 단말에서 EUC-KR/KS5601 변환 시 '?'로 표시되는 문제가 있었음.
 *
 * 정책:
 *   1) 본문에 EUC-KR 안전 문자만 사용 — ASCII 기호(=, -, [, ]) + 한글
 *   2) 구분선은 '===' 또는 '---' (가독성 + 안전)
 *   3) sanitizeSmsText() 로 위험 문자(▼ ▲ ▶ ◀ ※ ★ ☆ ◆ ◇ → ← ↑ ↓ + 모든 이모지)
 *      는 공백/대체 문자로 강제 치환 (재발 방지)
 *
 * ⚠️ 절대 금지:
 *   - 워커에서 알림 메시지를 인라인 템플릿 리터럴로 직접 작성 금지
 *   - 반드시 buildAutoCampaignNotifyMessage() 또는 sanitizeSmsText() 통과
 *
 * D111 (0408 검수 P5/P6):
 *   - (P5) 3개 빌더 전부 messageContent를 buildAdMessage로 감싸서 (광고)+무료거부 부착
 *     → isAd / opt080Number 파라미터 추가. D103 안전장치(중복방지) 내장이므로 이중 부착 걱정 없음.
 *   - (P6) buildSpamTestResultNotifyMessage의 .replace(/✓/g, '통과') 제거.
 *     호출부(auto-campaign-worker.ts)가 라벨을 '통과 ✓'로 넘기는데 ✓→'통과' 치환 → '통과 통과' 중복.
 *     호출부 라벨을 순수 '통과'/'차단'으로 단순화 + 빌더 내부 replace 제거.
 */
export interface AutoCampaignNotifyContext {
    campaignName: string;
    scheduledDateStr?: string;
    scheduledTimeStr?: string;
    targetCount?: number;
    messageType?: string;
    messageContent?: string;
    spamResultLabel?: string;
    spamBlocked?: boolean;
    isAd?: boolean;
    opt080Number?: string;
}
export interface TemplateInspectionNotifyContext {
    templateName: string;
    profileName?: string | null;
    status: 'APPROVED' | 'REJECTED';
    rejectReason?: string | null;
}
/**
 * 알림톡 템플릿 검수 결과 알림 메시지 빌더.
 *
 * 배경 (D135+):
 *   이전에는 휴머스온 IMC `createAlarmUser` API로 검수 알림 수신자를 등록하면
 *   IMC가 승인/반려 시점에 자동으로 카톡 알림을 보내는 구조로 설계되어 있었으나,
 *   해당 API가 인비토 API 키에 활성화되어 있지 않아 4032 에러로 전면 거부됨.
 *
 * 대체 설계:
 *   - IMC 호출 제거. 한줄로가 직접 SMS로 담당자에게 알림.
 *   - `alimtalk-jobs.ts` `syncPendingTemplatesJob` 5분 폴링에서 APR/REJ 전환을 감지하면
 *     `kakao_alarm_users` 활성 수신자 조회 → 인증 라인(getAuthSmsTable)으로 SMS 발송.
 *   - 추후 한줄로 자체 알림톡 템플릿이 승인되면 SMS→알림톡 전환 예정 (Harold님 로드맵).
 *
 * 출력 예시 (승인):
 *   [알림톡 템플릿 승인]
 *
 *   템플릿: 주문 완료 안내
 *   발신프로필: 주식회사 인비토
 *
 *   검수가 승인되었습니다. 이제 발송에 사용할 수 있습니다.
 *
 * 출력 예시 (반려):
 *   [알림톡 템플릿 반려]
 *
 *   템플릿: 주문 완료 안내
 *   발신프로필: 주식회사 인비토
 *
 *   반려 사유: 변수명 #{주문번호}에 공백 포함됨
 *
 *   관리자 페이지에서 내용을 수정한 뒤 재검수요청 해주세요.
 */
export declare function buildTemplateInspectionNotifyMessage(ctx: TemplateInspectionNotifyContext): string;
/**
 * 위험 문자(dingbats/이모지)를 안전 문자로 치환한다.
 *
 * 차단 대상:
 *   - dingbats: ▼ ▲ ▶ ◀ ◇ ◆ ◈ ▣ ▤ ▥ ▦ ▧ ▨ ▩
 *   - 별표류: ★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰
 *   - 화살표: → ← ↑ ↓ ↔ ↕ ⇒ ⇐ ⇑ ⇓
 *   - 기타: ※ ⚠ ⚡ ⓘ ⓒ ⓡ ™
 *   - 이모지: U+1F300 ~ U+1FAFF, U+2600 ~ U+27BF
 */
export declare function sanitizeSmsText(text: string): string;
/**
 * D-2 AI 문안 생성 완료 알림 메시지 빌더.
 *
 * 출력 예시:
 *   [AI 문안 생성 완료]
 *
 *   캠페인: 신상품 4월 프로모션
 *   발송 예정: 4월 15일 11:00
 *
 *   === AI 생성 문안 ===
 *   [브랜드명] 안녕하세요 김철수님...
 *
 *   [안내] 문안 수정이 필요하면 관리자 페이지에서 수정해주세요.
 */
export declare function buildAiGeneratedNotifyMessage(ctx: AutoCampaignNotifyContext): string;
/**
 * D-1 사전 알림 메시지 빌더 (담당자 통지).
 *
 * 출력 예시:
 *   [자동발송 사전알림]
 *
 *   캠페인: 신상품 4월 프로모션
 *   발송 예정: 4월 15일 11:00
 *   발송 대상: 1,234명
 *   메시지 타입: LMS
 *
 *   === 발송 문안 ===
 *   [브랜드명] 안녕하세요 김철수님...
 *
 *   [안내] 취소하려면 관리자 페이지에서 자동발송을 일시정지해주세요.
 */
export declare function buildPreNotifyMessage(ctx: AutoCampaignNotifyContext): string;
/**
 * D-day 2시간 전 스팸테스트 결과 알림 메시지 빌더.
 *
 * 출력 예시:
 *   [자동발송 스팸테스트 결과]
 *
 *   캠페인: 신상품 4월 프로모션
 *   발송 예정: 오늘 11:00
 *
 *   스팸테스트 결과: 통과
 *
 *   === 발송 문안 ===
 *   [브랜드명] 안녕하세요 김철수님...
 *
 *   (차단 시)
 *   [경고] 문안이 스팸필터에 차단되었습니다.
 *   관리자 페이지에서 문안을 수정하거나 일시정지해주세요.
 */
export declare function buildSpamTestResultNotifyMessage(ctx: AutoCampaignNotifyContext): string;
//# sourceMappingURL=auto-notify-message.d.ts.map