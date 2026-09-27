/**
 * email-send-gate.ts — 이메일 "완성·발송" 잠금 판정 CT (★ 2026-09-27 만들기 개편 S3)
 *
 * 옛: 채울 자리(placeholder) · 링크 결함 검사가 `/send` 라우트 안 인라인이었고, `/complete`(완성 50 차감)에는 없었다.
 *     그래서 채울 자리가 남은 캠페인도 50을 먼저 내고, 발송에서야 막혔다. 발신 설정(SMTP)은 `/send`가 선점한 **뒤**
 *     백그라운드에서 failed 로 떨어졌다(화면은 "발송 시작"을 봤다).
 * 지금: 완성·발송 두 자리가 이 CT 하나를 **차감·선점 앞**에서 부른다(불변 6·7 · LESSONS_BACKEND "게이트는 효과 앞").
 *
 * ⛔ 판정 문구·코드는 옛 `/send` 인라인과 같다(UNEDITED_PLACEHOLDER · LINK_DEFECT) — 화면이 이미 이 코드로 분기한다.
 * ⛔ 임시 저장(PATCH)에서는 부르지 않는다 — 작업 중인 값까지 막으면 편집이 불가능해진다.
 */
import { findUneditedPlaceholder } from '../email-ai';
import { webLinkReason } from '../normalize';
import { isSmtpConfigured } from '../company-smtp-client';

export type EmailGateBlock = {
  status: 400;
  code: 'UNEDITED_PLACEHOLDER' | 'LINK_DEFECT' | 'SMTP_NOT_CONFIGURED';
  error: string;
};

/** 본문 잠금(순수) — 채울 자리 → 링크 결함 순. 없으면 null. */
export function emailContentBlocker(campaign: {
  subject?: string | null;
  htmlBody?: string | null;
  textBody?: string | null;
}): EmailGateBlock | null {
  const ph = findUneditedPlaceholder(campaign.subject, campaign.htmlBody, campaign.textBody);
  if (ph) {
    return {
      status: 400,
      code: 'UNEDITED_PLACEHOLDER',
      error: `${ph.where}에 직접 입력이 필요한 자리 "${ph.sample}"가 남아 있습니다. 편집에서 그 자리를 채운 뒤 발송해주세요.`,
    };
  }
  for (const m of String(campaign.htmlBody || '').matchAll(/href=["']([^"']+)["']/gi)) {
    const r = webLinkReason(m[1], '메일 본문의 링크는');
    if (r) return { status: 400, code: 'LINK_DEFECT', error: r };
  }
  return null;
}

/** 발신 설정 잠금 — 회사 메일(SMTP)이 연결되지 않았으면 막는다. */
export async function emailSmtpBlocker(
  companyId: string,
  deps: { isSmtpConfigured: (companyId: string) => Promise<boolean> } = { isSmtpConfigured },
): Promise<EmailGateBlock | null> {
  if (await deps.isSmtpConfigured(companyId)) return null;
  return {
    status: 400,
    code: 'SMTP_NOT_CONFIGURED',
    error: '회사 메일(발신 설정)을 먼저 연결해 주세요. 연결하면 바로 보낼 수 있어요.',
  };
}
