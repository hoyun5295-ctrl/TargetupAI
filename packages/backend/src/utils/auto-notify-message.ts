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
}

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
export function sanitizeSmsText(text: string): string {
  if (!text) return '';
  return text
    // dingbats 사각/원형 도형
    .replace(/[▼▲▶◀◇◆◈▣▤▥▦▧▨▩□■◯●○◎◉]/g, '')
    // 별표류
    .replace(/[★☆✦✧✩✪✫✬✭✮✯✰]/g, '')
    // 화살표
    .replace(/[→←↑↓↔↕⇒⇐⇑⇓]/g, '')
    // 안내 기호
    .replace(/[※⚠⚡ⓘⓒⓡ™℃℉]/g, '')
    // 이모지 (Unicode 범위)
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    // 연속된 공백 정리
    .replace(/[ \t]+/g, ' ')
    .trim();
}

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
export function buildAiGeneratedNotifyMessage(ctx: AutoCampaignNotifyContext): string {
  const lines: string[] = [];
  lines.push('[AI 문안 생성 완료]');
  lines.push('');
  lines.push(`캠페인: ${sanitizeSmsText(ctx.campaignName)}`);
  if (ctx.scheduledDateStr || ctx.scheduledTimeStr) {
    lines.push(`발송 예정: ${ctx.scheduledDateStr || ''} ${ctx.scheduledTimeStr || ''}`.trim());
  }
  lines.push('');
  lines.push('=== AI 생성 문안 ===');
  lines.push(sanitizeSmsText(ctx.messageContent || ''));
  lines.push('');
  lines.push('[안내] 문안 수정이 필요하면 관리자 페이지에서 수정해주세요.');
  return lines.join('\n');
}

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
export function buildPreNotifyMessage(ctx: AutoCampaignNotifyContext): string {
  const lines: string[] = [];
  lines.push('[자동발송 사전알림]');
  lines.push('');
  lines.push(`캠페인: ${sanitizeSmsText(ctx.campaignName)}`);
  if (ctx.scheduledDateStr || ctx.scheduledTimeStr) {
    lines.push(`발송 예정: ${ctx.scheduledDateStr || ''} ${ctx.scheduledTimeStr || ''}`.trim());
  }
  if (typeof ctx.targetCount === 'number') {
    lines.push(`발송 대상: ${ctx.targetCount.toLocaleString()}명`);
  }
  if (ctx.messageType) {
    lines.push(`메시지 타입: ${ctx.messageType}`);
  }
  lines.push('');
  lines.push('=== 발송 문안 ===');
  lines.push(sanitizeSmsText(ctx.messageContent || ''));
  lines.push('');
  lines.push('[안내] 취소하려면 관리자 페이지에서 자동발송을 일시정지해주세요.');
  return lines.join('\n');
}

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
export function buildSpamTestResultNotifyMessage(ctx: AutoCampaignNotifyContext): string {
  const lines: string[] = [];
  lines.push('[자동발송 스팸테스트 결과]');
  lines.push('');
  lines.push(`캠페인: ${sanitizeSmsText(ctx.campaignName)}`);
  if (ctx.scheduledTimeStr) {
    lines.push(`발송 예정: 오늘 ${ctx.scheduledTimeStr}`);
  }
  lines.push('');
  // 결과 라벨에서 dingbats 제거 (✓ ✗ 등도 안전 문자로 대체)
  const safeResult = (ctx.spamResultLabel || '')
    .replace(/✓/g, '통과')
    .replace(/✗/g, '차단')
    .replace(/[✔✘]/g, '');
  lines.push(`스팸테스트 결과: ${sanitizeSmsText(safeResult)}`);
  if (ctx.messageContent) {
    lines.push('');
    lines.push('=== 발송 문안 ===');
    lines.push(sanitizeSmsText(ctx.messageContent));
  }
  if (ctx.spamBlocked) {
    lines.push('');
    lines.push('[경고] 문안이 스팸필터에 차단되었습니다.');
    lines.push('관리자 페이지에서 문안을 수정하거나 일시정지해주세요.');
  }
  return lines.join('\n');
}
