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

/** 사용자가 직접 채워야 하는 자리 — 프로젝트 표준 문구(활성화 게이트가 미편집 상태를 막는다). */
export const BENEFIT_PLACEHOLDER = '[혜택 안내 — 직접 수정해주세요]';

/**
 * ★ 2026-08-02 Codex 4R — **구조를 바꿨다. 비교를 없앴다.**
 *
 * 1~3라운드가 같은 자리에서 계속 지적을 냈다. 원인은 판정 자체가 열린 문제였다는 것 —
 * "AI가 쓴 혜택이 근거의 그 혜택과 같은가"를 문자열로 맞추려 하면 표기·조사·복합 금액·교차 조합이
 * 끝없이 나온다(1.5만원 대 5만원 / 10% 할인과 5% 적립의 교차 / 무료 체험을 대 무료체험).
 *
 * 실제로 필요한 불변식은 훨씬 좁다 — **AI는 구체 혜택을 쓰지 않는다.**
 * 그래서 근거를 **사람이 쓴 원본 본문 하나로** 좁히고, 판정을 "그 자리가 원본에 그대로 있었나"로 바꿨다.
 * 목적 문장·앞 스텝은 근거가 아니다 — 그건 AI에게 숫자를 렌더링할 면허가 아니고, 혜택은 사용자가 편집기에서 쓴다.
 * 정규화 키와 허용 집합 교차 비교가 통째로 사라졌고 남은 것은 **찾아서 바꾸기**뿐이다.
 * 방향은 언제나 덜 보내는 쪽 — 애매하면 placeholder로 두고, 미편집 placeholder는 활성화가 막는다.
 */

/** 단독 '무료' — 법정 문구·아래 무료배송류·형용사 활용(무료하다)은 제외. */
const FREE_RE = /무료(?!\s*수\s*신\s*거\s*부|\s*거부|\s*배송|\s*증정|[하한함해])\s*[가-힣]{0,4}/g;

/**
 * ⛔ 무료배송·무료증정은 **띄어쓰기·줄바꿈을 가리지 않고** 한 자리로 잡는다 (Codex 5R).
 *   고정 문자열 목록만 보면 `무료\n배송`이 어디에도 안 걸려 지어낸 혜택이 그대로 나간다(fail-open).
 */
const FREE_SHIP_RE = /무료\s*(?:배송|증정)/g;

/** 뒤에 붙은 조사는 혜택의 일부가 아니다 — 붙은 채로 두면 '무료 체험'과 '무료 체험을'이 다른 것이 된다. */
const TRAILING_PARTICLE = /(?:으로부터|부터|까지|으로|이나|에서|에게|을|를|이|가|은|는|로|에|의|도|만|와|과|나)$/;

/**
 * ⛔ 금액·비율은 **경계를 포함해 통째로** 잡는다.
 *   `\d+만원`류는 '1.5만원'에서 부분 문자열 '5만원'을 집어낸다. 조각을 잡으면 지운 자리도 조각이 된다.
 *   '1만5천원' 같은 복합 표기도 한 자리로 삼킨다.
 */
//   ⛔ 앞뒤 경계도 본다 (Codex 5R) — '제1원칙'의 '1원'을 금액으로 잡아 정상 문구를 지우던 오탐 차단.
const AMOUNT_RE = /(?<![\d.,제])\d+(?:[.,]\d+)*\s*(?:만\s*(?:\d+\s*천)?\s*원|천\s*원|원|%)(?!칙)/g;

/** N+N 증정 표기. */
const NPLUSN_RE = /(?<!\d)\d\s*\+\s*\d(?!\d)/g;

interface BenefitSpan { start: number; end: number; text: string; }

/**
 * 문안에서 구체 혜택이 있는 **자리**를 찾는다. 토큰 문자열이 아니라 자리(span)인 이유 —
 * 교체는 원문 그대로의 자리를 바꿔야 한다. 토큰을 재조립해 정규식으로 되찾으면
 * 붙여쓰기·띄어쓰기 차이로 못 찾고 그대로 나간다('무료 체험'으로 '무료체험을'을 못 잡는다).
 */
function findBenefitSpans(text: string): BenefitSpan[] {
  const spans: BenefitSpan[] = [];
  const add = (start: number, raw: string) => {
    const noTail = raw.replace(/\s+$/, '');
    const trimmed = noTail.replace(TRAILING_PARTICLE, '');
    const t = trimmed.trim() ? trimmed : noTail;
    if (t.trim()) spans.push({ start, end: start + t.length, text: t });
  };
  for (const re of [AMOUNT_RE, NPLUSN_RE, FREE_SHIP_RE, FREE_RE]) {
    for (const m of text.matchAll(re)) if (m.index != null) add(m.index, m[0]);
  }
  for (const kw of KEYWORD_BENEFITS) {
    let i = text.indexOf(kw);
    while (i !== -1) {
      spans.push({ start: i, end: i + kw.length, text: kw });
      i = text.indexOf(kw, i + kw.length);
    }
  }
  // 겹치거나 **바로 붙어 있는** 자리는 하나로 묶는다.
  //   ⛔ 겹침만 합치면 금액과 종류가 따로 논다 — 원본에 '10% 할인'과 '5% 적립'이 있을 때
  //     '5%'와 '할인'이 각각 있다는 이유로 **원본에 없던 '5% 할인'이 통과한다**(Codex 4R).
  //     혜택은 "얼마"와 "무엇"이 붙어 하나의 뜻이므로 그 덩어리째 대조한다.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: BenefitSpan[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last) {
      const gap = text.slice(last.end, s.start);
      const adjacent = s.start < last.end || (gap.length <= 2 && /^\s*$/.test(gap));
      if (adjacent) {
        if (s.end > last.end) { last.end = s.end; last.text = text.slice(last.start, last.end); }
        continue;
      }
    }
    merged.push({ ...s });
  }
  return merged;
}

/**
 * **AI가 지어낸 구체 혜택을 자리째 되돌린다.**
 *
 * 프롬프트는 경계가 아니다 — "구체 혜택을 쓰지 마라"는 지시를 어긴 응답은 그대로 저장·발송될 수 있다.
 * @param originalBody 사람이 쓴 원본 본문. **여기 그대로 있던 것만** 남는다.
 *   비우면(처음부터 쓰는 생성 모드) 구체 혜택은 전부 placeholder가 된다 — 지어낼 근거가 없기 때문이다.
 */
export function stripUnauthorizedBenefits(message: string, originalBody = ''): string {
  const text = String(message || '');
  if (!text.trim()) return text;

  const spans = findBenefitSpans(text);
  if (spans.length === 0) return text;

  // ⛔ 원본도 **같은 파서로** 자리를 뽑아 자리끼리 대조한다 (Codex 5R).
  //   `includes`로 보면 출력의 '5% 할인'이 원본 '15% 할인' 한가운데 걸려 다른 금액인데도 통과한다.
  //   비교 키는 공백만 정리한다(줄바꿈으로 쓴 '무료\n배송'과 '무료 배송'은 같은 자리다).
  //   ⚠ 한계 — 원본이 "무료배송은 제공하지 않습니다"여도 그 자리는 근거로 인정된다.
  //     부정 문맥 판정은 다시 열린 문제라 여기서 풀지 않는다. 다듬기는 사람이 후보를 골라 넣는 흐름이라 그 자리에서 걸러진다.
  const spanKey = (t: string) => t.replace(/\s+/g, ' ').trim();
  const allowed = new Set(findBenefitSpans(String(originalBody || '')).map((s) => spanKey(s.text)));
  const invented = spans.filter((s) => !allowed.has(spanKey(s.text)));
  if (invented.length === 0) return text;

  // 뒤에서부터 바꾼다 — 앞을 먼저 바꾸면 뒤 자리의 위치가 밀린다.
  let out = text;
  for (const s of invented.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + BENEFIT_PLACEHOLDER + out.slice(s.end);
  }
  // 붙어 버린 placeholder 중복 정리.
  const dup = BENEFIT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out.replace(new RegExp(`(?:${dup})(?:[\\s,]*${dup})+`, 'g'), BENEFIT_PLACEHOLDER);
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
