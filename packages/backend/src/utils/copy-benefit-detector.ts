/**
 * copy-benefit-detector.ts — 입력 문안의 구체 혜택 토큰 감지 (순수, DB·AI 무의존)
 *
 * 목적: 사용자가 자연어로 넣은 실혜택(%·원·N+N·반값·무료배송·사은품·쿠폰 등)을 감지해
 *       후크·CTA의 주인공으로 강조하도록 generateMessages가 채널별 강조 지시를 붙이게 한다.
 *       감지 X면 시의성(계절·시즌)으로 풍성 — 혜택 날조는 절대 0.
 *
 * 오탐 가드: 연도(20xx년)·시각(N시)·N월/N일은 혜택 아님(원/%/N+N/키워드만 혜택으로 본다).
 */

export interface BenefitDetectResult {
  hasBenefit: boolean;
  tokens: string[]; // 감지된 혜택 토큰 (강조 대상)
}

const KEYWORD_BENEFITS = [
  '반값', '무료배송', '무료 배송', '사은품', '쿠폰', '적립', '무료증정', '무료 증정',
  '1+1', '2+1', '증정', '경품', '할인',
];

export function detectBenefits(input: string): BenefitDetectResult {
  const text = String(input || '');
  const tokens: string[] = [];

  // 1) 퍼센트 (예: 30%, 50 %)
  for (const m of text.matchAll(/\d{1,3}\s*%/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 2) 원 단위 금액 (예: 5000원, 1만원)
  for (const m of text.matchAll(/\d[\d,]*\s*원/g)) tokens.push(m[0].replace(/\s+/g, ''));
  for (const m of text.matchAll(/\d+\s*만\s*원/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 3) N+N (예: 1+1, 2+1)
  for (const m of text.matchAll(/\d\s*\+\s*\d/g)) tokens.push(m[0].replace(/\s+/g, ''));

  // 4) 키워드
  for (const kw of KEYWORD_BENEFITS) {
    if (text.includes(kw)) tokens.push(kw);
  }

  const uniq = Array.from(new Set(tokens));
  return { hasBenefit: uniq.length > 0, tokens: uniq };
}

type Channel = 'SMS' | 'LMS' | 'MMS' | '카카오' | 'KAKAO' | 'EMAIL' | string;

/**
 * 혜택 유무 + 채널에 따른 강조 지시문 생성.
 *  - 혜택 O: 후크·CTA 주인공 배치. SMS/LMS/MMS = 텍스트 강조(【】·▶·줄바꿈, 이모지 금지).
 *  - 혜택 X: 계절감·시의성으로 풍성. 혜택 날조 절대 금지.
 */
export function buildBenefitEmphasis(tokens: string[], channel: Channel): string {
  if (tokens.length > 0) {
    const list = tokens.join(', ');
    const isText = channel === 'SMS' || channel === 'LMS' || channel === 'MMS';
    const styleLine = isText
      ? '- 강조 방식: 첫 줄(후크)과 CTA에 혜택을 주인공으로 배치. 【】·▶·줄바꿈으로 텍스트 강조하되 이모지·통신사 미지원 특수문자는 절대 쓰지 마세요.'
      : '- 강조 방식: 혜택 숫자를 시각적으로 도드라지게(크게·굵게) 후크와 CTA의 주인공으로 배치하세요.';
    return [
      '',
      '## 혜택 강조 (최우선)',
      `- 사용자가 입력한 실제 혜택: ${list}`,
      '- 위 혜택을 메시지의 후크(첫 인상)와 CTA(행동 유도)의 중심에 두고, 혜택이 바로 보이게 구성하세요.',
      styleLine,
      '- 단, 입력에 없는 새로운 혜택(다른 %·원·쿠폰·무료 등)을 추가로 지어내지 마세요.',
    ].join('\n');
  }
  return [
    '',
    '## 풍성도 (혜택 미입력 — 시의성으로)',
    '- 구체 혜택(%·원·쿠폰·무료 등)을 절대 지어내지 마세요. 혜택 날조 금지.',
    '- 대신 현재 계절감·해당 월 특성·시즌 이벤트·요일/시간 맥락을 자연스럽게 살려 문안 자체를 풍성하게 작성하세요.',
  ].join('\n');
}
