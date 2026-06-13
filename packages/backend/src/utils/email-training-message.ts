/**
 * email-training-message.ts — 이메일 학습 메시지 합성 (순수, DB import 0)
 *
 * sendEmailCampaign 발송완료 시 logCampaignTraining.finalMessage로 넘길
 * 제목+본문 텍스트를 만든다. textBody 우선, 없으면 htmlBody 태그 제거.
 * 브랜드/전화/금액/URL 마스킹은 logTrainingData(maskForTraining)가 별도 수행.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** 줄 단위 정리 — 각 줄 trim, 빈 줄 제거, \n으로 재결합. */
function cleanLines(s: string): string {
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** HTML 본문 → 순수 텍스트 (학습용). 줄 구조만 보존, 스타일/스크립트 제거. */
function htmlToText(html: string): string {
  let s = html;
  // script · style 블록은 내용까지 통째 제거
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // <br> · block 종료 태그 → 줄바꿈
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|thead|tbody|ul|ol|section|article)>/gi, '\n');
  // 남은 태그 제거
  s = s.replace(/<[^>]+>/g, '');
  // HTML 엔티티 디코드 (흔한 것만)
  s = s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => HTML_ENTITIES[m] || m);
  return cleanLines(s);
}

/**
 * 이메일 캠페인 제목+본문을 학습용 단일 텍스트로 합성한다.
 * @param subject  제목 (광고 prefix 합성 전 원본)
 * @param textBody 순수 텍스트 본문 (있으면 우선)
 * @param htmlBody HTML 본문 (textBody 없을 때 태그 제거해 사용)
 */
export function buildEmailTrainingMessage(subject: string, textBody: string | null, htmlBody: string): string {
  const subj = (subject || '').trim();
  const tb = (textBody || '').trim();
  const body = tb.length > 0 ? cleanLines(tb) : htmlToText(htmlBody || '');
  if (subj && body) return `${subj}\n\n${body}`;
  return subj || body || '';
}
