/**
 * send-placeholder-gate.ts — 발송 길목의 "미완성 문안" 차단 CT (★ 2026-09-30 프롬프트 점검 WP1)
 *
 * AI 가 문안을 만들 때 사실을 지어내지 않으려고 남겨 두는 "직접 채울 자리"(링크 · 혜택)가 채워지지 않은 채
 * 고객에게 나가는 것을 발송 길목에서 막는다. 판정은 이 파일 하나다 — 길목마다 따로 적지 않는다.
 *
 *   - 링크 자리 = brand-link-core `hasUneditedLinkPlaceholder`(07-02 부터 캠페인 생성 · 직접 발송 길목이 쓰던 판정 그대로 · 문구 · 코드 불변)
 *   - 혜택 자리 = copy-benefit-detector `hasAiFillPlaceholder` — **AI 가 넣는 정확한 문구만** 본다.
 *     고객이 직접 쓴 "[혜택] 30% 할인" 같은 제목 줄은 잡지 않는다(자동발송의 넓은 판정 `hasUneditedBenefitPlaceholder` 를 쓰지 않는 이유).
 *
 * 소비처(발송 길목 전부): routes/campaigns.ts 캠페인 생성 · 예약 문안 수정 · 브랜드메시지 발송 · 옛 동기 직접발송(/direct-send = AI 오퍼레이터 승인 발송) ·
 *   utils/direct-send-core.ts(직접 · 자율 · DM · 대행 공통).
 * 이메일 · DM 발행은 email-ai PLACEHOLDER_PATTERN 을 쓴다.
 * ★ 2026-11-01 여정 재발 방지 배포 2 C4(J13) — 여정(켜기 관문 · 보내기 전 검사)과 자동마케팅 · 플래너의 자리표시 판정도 이 파일이 주인이다.
 *   옛: 여정 켜기(journey-builder) · 보내기 전 검사(journey-pretest-validator · 「[직접 작성해주세요]」 · 「[URL…]」만) · 자동마케팅(autosend-policy)이
 *   저마다 적어 같은 여정 글이 검사는 통과하고 켜기에서 막혔다. 각 판정의 기준(무엇을 자리로 보나)은 옛 켜기 · 자동마케팅 기준 그대로다.
 */
import { hasUneditedLinkPlaceholder, LINK_PLACEHOLDER } from './brand-link-core';
import { findAiFillPlaceholder } from './copy-benefit-detector';

export type SendPlaceholderCode = 'LINK_PLACEHOLDER_UNEDITED' | 'BENEFIT_PLACEHOLDER_UNEDITED';

export const LINK_PLACEHOLDER_ERROR = `문안에 링크 자리(${LINK_PLACEHOLDER})가 비어 있습니다. 링크 삽입으로 URL을 넣거나 해당 줄을 지운 뒤 발송해주세요.`;
/** 채우지 않은 자리 안내 — 어느 자리인지 문구를 그대로 보여 준다(혜택 · 기간 · 안내문 등 자리가 여러 종류다). */
export const fillPlaceholderError = (found: string): string =>
  `문안에 직접 채울 자리(${found})가 남아 있습니다. 내용을 직접 적거나 그 줄을 지운 뒤 발송해 주세요.`;

/** 본문 · 제목 등에 채우지 않은 자리가 남았는가. 남았으면 {code, error}, 없으면 null. 링크를 먼저 본다(종전 문구 · 코드 그대로). */
export function findUneditedSendPlaceholder(
  ...texts: Array<string | null | undefined>
): { code: SendPlaceholderCode; error: string } | null {
  const list = texts.map((t) => String(t || ''));
  if (list.some((t) => hasUneditedLinkPlaceholder(t))) return { code: 'LINK_PLACEHOLDER_UNEDITED', error: LINK_PLACEHOLDER_ERROR };
  for (const t of list) {
    const found = findAiFillPlaceholder(t);
    if (found) return { code: 'BENEFIT_PLACEHOLDER_UNEDITED', error: fillPlaceholderError(found) };
  }
  return null;
}

// ★ 2026-06-26 라프레리 신고 fix(옛 journey-builder): 대괄호가 있기만 하면 막던 판정이 「[송파가락점]」 같은 정상 글까지 막았다 →
//   실제 미편집 자리([... 직접/작성해/수정해/입력해 ...] · [URL ...])만 본다.
const JOURNEY_PLACEHOLDER_PATTERN = /\[[^\[\]\n]{0,80}(직접|작성해|수정해|입력해|URL)[^\[\]\n]{0,80}\]/;

/** 여정 칸 글에 채우지 않은 자리가 남았는가(켜기 관문 · 보내기 전 검사 · 점검 응답 공용 · 빈 글 = false — 빈 글은 길이 판정이 본다) */
export function hasUneditedJourneyPlaceholder(text: string | null | undefined): boolean {
  return !!text && JOURNEY_PLACEHOLDER_PATTERN.test(text);
}

/**
 * 자동마케팅 · 플래너 발송 출구의 혜택 자리 판정(넓은 판정 · 2026-07-07 기준 그대로).
 *  대상: [혜택 ...] 대괄호 자리 + 「직접 입력/작성해주세요」 문구 잔존.
 */
export function hasUneditedBenefitPlaceholder(text: string): boolean {
  const s = String(text || '');
  if (!s) return false;
  return /\[혜택[^\]]*\]/.test(s) || s.includes('직접 입력해주세요') || s.includes('직접 작성해주세요');
}
