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

import { buildAdMessage } from './messageUtils';

export interface AutoCampaignNotifyContext {
  campaignName: string;
  scheduledDateStr?: string;
  scheduledTimeStr?: string;
  targetCount?: number;
  messageType?: string;       // 본문 발송 타입 ('SMS'|'LMS'|'MMS') — buildAdMessage에 전달. 알림 SMS 자체는 항상 LMS로 발송됨.
  messageContent?: string;
  spamResultLabel?: string;
  spamBlocked?: boolean;
  // ★ D111 P5: (광고)+무료거부 부착용
  isAd?: boolean;
  opt080Number?: string;
}

/**
 * ★ D111 P5: messageContent에 (광고)+무료거부 부착.
 * D103 buildAdMessage 안전장치(중복 방지) 내장 — 이미 붙어있으면 건드리지 않음.
 * isAd=false거나 opt080Number 없으면 sanitize만 적용하고 원본 반환.
 */
function applyAdAndSanitize(ctx: AutoCampaignNotifyContext): string {
  const raw = sanitizeSmsText(ctx.messageContent || '');
  if (!raw) return '';
  return buildAdMessage(
    raw,
    ctx.messageType || 'LMS',
    !!ctx.isAd,
    ctx.opt080Number || ''
  );
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
  lines.push(applyAdAndSanitize(ctx));
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
  lines.push(applyAdAndSanitize(ctx));
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
  // ★ D111 P6: replace(✓→통과) 제거. 호출부가 순수 '통과'/'차단' 문자열을 넘긴다.
  // sanitizeSmsText가 dingbats/이모지를 자동 제거하므로 혹시 호출부 실수로 ✓가 들어와도 안전.
  const safeResult = sanitizeSmsText(ctx.spamResultLabel || '').replace(/[✓✗✔✘]/g, '').trim();
  lines.push(`스팸테스트 결과: ${safeResult}`);
  if (ctx.messageContent) {
    lines.push('');
    lines.push('=== 발송 문안 ===');
    lines.push(applyAdAndSanitize(ctx));
  }
  if (ctx.spamBlocked) {
    lines.push('');
    lines.push('[경고] 문안이 스팸필터에 차단되었습니다.');
    lines.push('관리자 페이지에서 문안을 수정하거나 일시정지해주세요.');
  }
  return lines.join('\n');
}
