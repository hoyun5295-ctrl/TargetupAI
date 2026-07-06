/**
 * ★ CT: 행사 캠페인 공용 브리프 (2026-07-07(4))
 *
 * 행사 내용 자유 텍스트(한 줄이든 줄바꿈 나열이든) → 3채널 생성기(모바일DM one-shot /
 * 이메일 generate-sections / 인앱 ai-generate)에 동일하게 주입하는 프롬프트 블록 + 혜택 실존 검증.
 *
 * ⛔ 영구 룰 양립 (AI 임의 혜택 금지):
 *   - AI가 지어내는 혜택은 여전히 금지. "행사 원문에 사용자가 직접 적은 혜택"만 원문 그대로 통과.
 *   - 기계 검증 = benefitMatchesEventText: 혜택 핵심 토큰(수치·%·원·쿠폰 등)이 행사 원문에
 *     실존해야 통과 — AI 환각 혜택은 원문에 없어 자동 탈락한다.
 */

export const EVENT_TEXT_MAX = 3000;

export function normalizeEventText(raw: any): string {
  return String(raw ?? '').trim().slice(0, EVENT_TEXT_MAX);
}

/** 행사 원문 + 사용 규칙 프롬프트 블록 — 3채널 생성기 공용 (빈 원문 = 빈 문자열) */
export function buildEventPromptBlock(eventText: string): string {
  const t = normalizeEventText(eventText);
  if (!t) return '';
  return `[행사 내용 — 사용자가 직접 입력한 사실. 이 캠페인은 아래 행사를 알리는 것]
${t}

[행사 내용 사용 규칙 — 절대 준수]
- 행사명·기간·대상·조건은 위 원문에 적힌 것만 사용 (원문에 없는 사실 지어내기 금지)
- 혜택(%·원·쿠폰·무료·사은품 등)은 위 원문에 적힌 표현만 원문 그대로 인용 — 원문에 혜택이 없으면 혜택 자리는 기존 placeholder 규칙을 따른다
- 원문에 기간이 있으면 마감 임박감을, 대상이 있으면 그 대상에게 말 걸듯 반영`;
}

/**
 * 혜택 문구가 행사 원문에 실제로 존재하는지 검증.
 * - 수치·혜택 토큰(20%, 5만원, 1+1, 무료배송, 쿠폰, 사은품, 적립 등)이 있으면 전 토큰이 원문에 실존해야 통과
 * - 토큰이 없으면 정규화(공백 제거) 부분 문자열로 판정
 */
export function benefitMatchesEventText(benefitText: any, eventText: any): boolean {
  const norm = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
  const b = norm(benefitText);
  const e = norm(eventText);
  if (!b || !e) return false;
  const tokens = String(benefitText ?? '').match(/\d[\d.,]*\s*(?:%|퍼센트|원|만원|천원)|1\s*\+\s*1|무료\s*배송|무료|쿠폰|사은품|적립/g);
  if (tokens && tokens.length > 0) return tokens.every((tk) => e.includes(norm(tk)));
  return e.includes(b);
}
