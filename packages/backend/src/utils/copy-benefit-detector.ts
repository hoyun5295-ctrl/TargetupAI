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
export const BENEFIT_PLACEHOLDER = '[혜택 안내: 직접 수정해주세요]';

/**
 * ★ 2026-09-30 AI · 시스템이 넣는 "직접 채울 자리"(발송 길목 가드 send-placeholder-gate 가 본다).
 *   두 갈래로 잡는다.
 *   ① 꼴 — 대괄호 안이 "직접 입력/작성/수정해주세요"로 끝나는 자리. 혜택 자리 계열 전부가 이 꼴이다(문자 · 여정 · 인앱 · 이메일 · 템플릿).
 *      고객이 자기 고객에게 쓰는 문안에 "직접 작성해주세요"를 대괄호로 적을 일은 없다 — 고객이 쓴 "[혜택] 30% 할인" 제목 줄은 잡지 않는다.
 *   ② 정확한 문구 — "직접"이 없는 자리(안내문 · 주소 자리 등). 꼴로 넓히면 고객 문안("[후기를 작성해주세요]" 같은 안내)을 막을 수 있어 문구 그대로 둔다.
 *   ⛔ 코드에 ②꼴 새 자리 문구를 만들면 아래 목록에 더한다 — 소스 스캔 테스트(prompt-upgrade-0930)가 빠진 문구를 잡는다.
 *     (0930 실측: AI 실패 비상 문안의 "[혜택 내용을 입력해주세요]"가 빠져 있어 발송 길목을 지나갈 수 있었다)
 */
export const AI_FILL_DIRECT_PATTERN = /\[[^\]\n]{0,60}직접\s?(?:입력|작성|수정)해\s?주세요\]/;

export const AI_FILL_PLACEHOLDERS: readonly string[] = [
  '[혜택 내용을 입력해주세요]',        // 문안 생성 AI 실패 비상 문안(services/ai getFallbackVariants) · 자동마케팅 혜택 자리
  '[장바구니 안내를 작성해주세요]', '[예약 정보를 작성해주세요]', '[당일 안내를 작성해주세요]',   // 여정 템플릿
  '[후기 안내 또는 다음 예약 안내를 작성해주세요]', '[첫 사용 가이드 또는 추천 상품을 작성해주세요]',
  '[환영 메시지와 첫 사용 안내를 작성해주세요]', '[리마인드 메시지를 작성해주세요]',
  '[브랜드 소개를 작성해주세요]', '[헤드라인을 작성해주세요]', '[질문을 작성해주세요]',          // DM · 인앱 템플릿
  '[YouTube URL을 입력해주세요]', '[Instagram URL을 입력해주세요]',                              // DM 섹션 · 기획 실행
  '[교환·반품 등 안심 안내를 작성해주세요]', '[돌아온 고객 안내를 작성해주세요]',                  // 디자인 템플릿(design-core)
  '[사용·관리 가이드를 작성해주세요]', '[첫 방문 고객 안내를 작성해주세요]',
];

/** AI · 시스템이 남긴 직접 채울 자리 중 처음 찾은 문구(공백 차이는 무시). 없으면 null. */
export function findAiFillPlaceholder(text: string): string | null {
  const s = String(text || '').replace(/\s+/g, ' ');
  if (!s.trim()) return null;
  const direct = s.match(AI_FILL_DIRECT_PATTERN);
  if (direct) return direct[0];
  return AI_FILL_PLACEHOLDERS.find((p) => s.includes(p)) ?? null;
}

/** AI · 시스템이 남긴 직접 채울 자리가 남았는가. */
export function hasAiFillPlaceholder(text: string): boolean {
  return findAiFillPlaceholder(text) !== null;
}

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

export interface BenefitSpan { start: number; end: number; text: string; }

/**
 * 문안에서 구체 혜택이 있는 **자리**를 찾는다. 토큰 문자열이 아니라 자리(span)인 이유 —
 * 교체는 원문 그대로의 자리를 바꿔야 한다. 토큰을 재조립해 정규식으로 되찾으면
 * 붙여쓰기·띄어쓰기 차이로 못 찾고 그대로 나간다('무료 체험'으로 '무료체험을'을 못 잡는다).
 */
// ★ 2026-09-24 export 만 추가(동작 불변) — SNS AI 캡션 가림·맞춤법 보호 구간이 같은 자리 판정을 쓴다.
export function findBenefitSpans(text: string): BenefitSpan[] {
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
    '## 풍성도 (혜택 미입력: 시의성으로)',
    '- 구체 혜택(%·원·쿠폰·무료 등)을 절대 지어내지 마세요. 혜택 날조 금지.',
    '- 대신 현재 계절감·해당 월 특성·시즌 이벤트·요일/시간 맥락을 자연스럽게 살려 문안 자체를 풍성하게 작성하세요.',
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-09-30 프롬프트 점검 WP2 — **새로 쓰는 문안**의 혜택 대조(값 기준) · **다시 쓰는 문안**의 새 숫자 대조
//
//   stripUnauthorizedBenefits 는 "원문에 글자 그대로 있던 혜택 덩어리만" 통과시킨다 — AI 가 혜택을 아예 쓰지 않아야 하는
//   여정 · 다듬기 계열에 맞다. 기본 · 맞춤 · DM · 이메일 생성은 사용자가 요청에 "30% 할인"을 적고 그것을 **주인공으로 강조하라**고
//   지시하는 흐름이라, 글자 대조를 쓰면 "30% OFF" · "할인 혜택" 같은 정상 표현이 자리표시가 된다(품질 저하).
//   그래서 여기서는 **값**을 본다 — 숫자 혜택(%·원·N+N)은 정규화한 값이, 구체 혜택 낱말(무료 · 사은품 · 쿠폰 · 적립 · 경품 · 증정 · 반값)은
//   낱말이 근거에 있어야 통과. 일반 낱말('할인' 등)은 보지 않는다(값이 없으면 지어낸 사실이 아니다).
//   ⚠ 한계(알고 둔다): 근거에 "10% 할인 · 5% 적립"이 있을 때 결과의 "5% 할인"(값과 낱말 교차)은 통과한다.
// ════════════════════════════════════════════════════════════════════

const FIGURE_AMOUNT_RE = /(?<![\d.,제])\d+(?:[.,]\d+)*\s*(?:만\s*(?:\d+\s*천)?\s*원|천\s*원|원|%)(?!칙)/g;
const FIGURE_NPLUSN_RE = /(?<!\d)\d\s*\+\s*\d(?!\d)/g;
/** 값이 없어도 그 자체로 구체 혜택인 낱말(근거에 없으면 지어낸 것). '할인'처럼 일반 낱말은 넣지 않는다. */
const CONCRETE_BENEFIT_WORDS = ['무료배송', '무료증정', '사은품', '쿠폰', '적립', '경품', '증정', '반값'];
/** 단독 '무료'(수신거부 · 무료하다 류 제외) — 근거에 '무료'가 있어야 통과. */
const FREE_WORD_RE = /무료(?!\s*수\s*신\s*거\s*부|\s*거부|[하한함해])/;

/** 금액 · 비율 표기를 값 키로("5천원" · "5,000원" → "5000원" · "1.5만원" → "15000원" · "30 %" → "30%"). 못 읽으면 공백만 뺀 원문. */
function figureKey(raw: string): string {
  const s = raw.replace(/\s+/g, '');
  if (s.endsWith('%')) return `${Number(s.slice(0, -1).replace(/,/g, ''))}%`;
  const man = s.match(/^(\d+(?:\.\d+)?)만(?:(\d+)천)?원$/);
  if (man) return `${Math.round(Number(man[1]) * 10000 + (man[2] ? Number(man[2]) * 1000 : 0))}원`;
  const chun = s.match(/^(\d+(?:\.\d+)?)천원$/);
  if (chun) return `${Math.round(Number(chun[1]) * 1000)}원`;
  const won = s.match(/^(\d+(?:,\d{3})*)원$/);
  if (won) return `${Number(won[1].replace(/,/g, ''))}원`;
  return s;
}

/*
 * ── 표기 정규화 (★ 2026-09-30 Codex 1~3R) ───────────────────────────────────────────────
 * 같은 값도 표기가 여럿이다(30% · 30퍼센트 · 30프로 · 전각 ３０％ · HTML 엔티티). 사례를 하나씩 막으면 다음 표기가 또 새어 나가서
 * (3라운드 연속 같은 부류), 규칙을 두 줄로 정했다.
 *   ① 모든 정규화는 **길이를 보존**한다 — 판정과 바꾸기가 같은 위치를 쓴다(위치를 따로 맞추는 코드가 없다).
 *   ② 모호한 표기("16 프로" = 상품명일 수도 비율일 수도)는 **출력 쪽은 넓게 · 근거 쪽은 좁게** 읽는다.
 *      출력의 "N프로"는 근거에 같은 글자가 그대로 있을 때만 그대로 두고, 아니면 비율(N%)로 본다 → 근거에 없으면 지어낸 값.
 *      근거의 "N프로"는 뒤가 할인 · 세일 등일 때만 비율로 인정한다 → 상품명 "아이폰 16 프로"가 16% 할인의 근거가 되지 않는다.
 *   틀리는 쪽은 늘 "자리표시가 하나 더 생긴다"(사람이 확인 · 발송 가드가 막는다)이지 "지어낸 혜택이 나간다"가 아니다.
 */

/**
 * 전각 ASCII(０-９ ％ ＋ 등) → 반각 · 전각 공백 · 폭 없는 문자(ZWSP · ZWNJ · ZWJ · WJ · BOM · 소프트 하이픈) → 공백.
 * 한 글자 ↔ 한 글자라 길이를 보존한다. 폭 없는 문자를 공백으로 두면 "50​%"가 "50 %"가 되어 금액 정규식(숫자와 단위 사이 공백 허용)이 잡는다.
 */
function toHalfwidth(t: string): string {
  return String(t || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\u3000\u200B-\u200D\u2060\uFEFF\u00AD]/g, ' ');
}

/** "N퍼센트" · "N프로" → "N  %"(채움 공백은 % 앞 · 금액 정규식이 숫자와 % 사이 공백을 허용해 원래 단위 글자 전체가 한 자리로 잡힌다). */
const pctPad = (m: string, num: string): string => `${num}${' '.repeat(Math.max(0, m.length - num.length - 1))}%`;
/** 출력 쪽(넓게) — 뚜렷한 다른 낱말(프로젝트 · 프로그램 · 프로모션 …)만 뺀다. */
const PCT_OUTPUT_RE = /(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(퍼센트|프로(?!젝트|그램|모션|필|세스|듀서|야구|포즈|페셔널))/g;
/** 근거 쪽(좁게) — "프로"는 뒤가 할인 · 세일 등(조사 하나 허용)일 때만. */
const PCT_GROUND_RE = /(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(?:퍼센트|프로(?=\s*(?:까지|이상|넘게|씩|나)?\s*(?:할인|세일|적립|페이백|캐시백|혜택|off|OFF|Off|DC|dc)))/g;

function normalizeGroundText(t: string): string {
  return toHalfwidth(t).replace(PCT_GROUND_RE, pctPad);
}
/**
 * 문장 안 혜택 · 수량 낱말 — 이 가운데 하나라도 **같은 문장**에 있으면 "N프로"를 상품명으로 두지 않는다.
 * (Codex 0930 4R~9R: 토큰 앞뒤 몇 글자의 문맥으로 비율을 찾는 방식은 "추가 할인" · "**할인**" · "** 만큼" 처럼 배치만 바꿔도 새어 나갔다
 *  → 판정 단위를 문장으로 올렸다. 배치 · 강조 · 공백과 상관없이 닫힌다.) 틀리면 자리표시가 하나 더 생길 뿐이다.
 */
const SENTENCE_BENEFIT_RE = /할인|세일|적립|혜택|페이백|캐시백|쿠폰|증정|사은|포인트|무료|반값|off|dc|sale|만큼|씩|가량|까지|이상|넘게|최대|정도/i;
/** 문장 경계 — 마침표 · 느낌표 · 물음표 · 줄바꿈(쉼표는 경계가 아니다). */
const SENTENCE_BREAK_RE = /[.!?。\n]/;
/**
 * 출력 정규화 — "N프로"는 **기본이 비율**이다. 상품명으로 두는 것은 네 조건을 모두 만족할 때뿐이다.
 *   ① 근거에 같은 토큰이 상품명 앞말(한글 · 영문 두 글자)과 붙어 있다("아이폰 16 프로").
 *   ② 출력에서도 그 앞말이 바로 앞에 있다(강조 기호 무시).
 *   ③ 토큰 바로 뒤가 글 끊김(공백 · 문장부호 · 끝)이거나 명사 뒤 조사(가 · 를 · 는 · 와 · 의 …) 다음 글 끊김이다 — 수량 조사("씩" 등) 아님.
 *   ④ **같은 문장에 혜택 · 수량 낱말이 하나도 없다**(SENTENCE_BENEFIT_RE).
 * groundFlat = 근거(반각 · 공백 제거).
 */
const NOUN_TAIL_RE = /^(?:$|[\s.,!?…·:;)\]」』】]|(?:가|이|를|을|는|은|와|과|의|도|로|으로|에|에서|부터)(?:$|[\s.,!?…·:;)\]」』】]))/;
const EMPHASIS_RE = /[*_~`]+/g;
/** 근거를 **한 번** 훑어 "N프로" 토큰별 상품명 앞말(한글 · 영문 두 글자) 색인을 만든다(Codex 0930 11R: 토큰마다 근거 전체를 다시 검색했다). */
function groundProductIndex(groundFlat: string): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const x of groundFlat.matchAll(/([가-힣A-Za-z]{2})(\d+(?:[.,]\d+)*프로)(?!\d)/g)) {
    const set = idx.get(x[2]) ?? new Set<string>();
    set.add(x[1]);
    idx.set(x[2], set);
  }
  return idx;
}

function normalizeOutputText(t: string, groundFlat: string): string {
  const src = toHalfwidth(t);
  // 문장 경계 · 문장별 혜택 낱말 여부는 **한 번만** 계산한다(Codex 0930 10R: 토큰마다 문장을 다시 훑어 반복 입력에서 제곱 시간이 들었다).
  const sentenceEnds: number[] = [];
  for (let i = 0; i < src.length; i += 1) if (SENTENCE_BREAK_RE.test(src[i])) sentenceEnds.push(i);
  sentenceEnds.push(src.length);
  const sentenceHasBenefit = new Map<number, boolean>();   // 문장 끝 위치 → 혜택 · 수량 낱말 여부
  let productIndex: Map<string, Set<string>> | null = null; // 필요할 때 한 번만 만든다
  let si = 0;                                               // replace 콜백은 위치 오름차순으로 온다
  return src.replace(PCT_OUTPUT_RE, (m: string, num: string, unit: string, offset: number) => {
    if (unit !== '프로') return pctPad(m, num);
    // 토큰이 문장 경계에 걸치면("16\n프로씩") 상품명으로 두지 않는다 — fail-closed(Codex 0930 11R)
    if (SENTENCE_BREAK_RE.test(m)) return pctPad(m, num);
    while (sentenceEnds[si] < offset) si += 1;
    const sEnd = sentenceEnds[si];
    const sStart = si > 0 ? sentenceEnds[si - 1] + 1 : 0;
    let hasBenefit = sentenceHasBenefit.get(sEnd);
    if (hasBenefit === undefined) {
      hasBenefit = SENTENCE_BENEFIT_RE.test(src.slice(sStart, sEnd).replace(EMPHASIS_RE, ''));
      sentenceHasBenefit.set(sEnd, hasBenefit);
    }
    if (hasBenefit) return pctPad(m, num);
    // 판정용 사본(강조 기호 제거 · 고정 길이) — 뒤 문맥은 **토큰 끝에서** 잰다(문장 경계와 따로). 반환 글 · 위치는 그대로다(길이 보존).
    const tokenEnd = offset + m.length;
    const afterRaw = src.slice(tokenEnd, tokenEnd + 40);
    const brk = afterRaw.search(SENTENCE_BREAK_RE);
    const after = (brk < 0 ? afterRaw : afterRaw.slice(0, brk)).replace(EMPHASIS_RE, '');
    const before = src.slice(Math.max(sStart, offset - 24), offset).replace(EMPHASIS_RE, '').replace(/\s+/g, '').slice(-2);
    if (!productIndex) productIndex = groundProductIndex(groundFlat);
    const prefixes = productIndex.get(m.replace(/\s+/g, ''));
    return prefixes?.has(before) && NOUN_TAIL_RE.test(after) ? m : pctPad(m, num);
  });
}

interface BenefitGround { figures: Set<string>; text: string; rawFlat: string }

/** 근거 글에서 혜택 값 · 낱말을 모은다(비율 · 금액은 값 키로). */
function groundOf(ground: string): BenefitGround {
  const g = normalizeGroundText(String(ground || ''));
  const figures = new Set<string>();
  for (const m of g.matchAll(FIGURE_AMOUNT_RE)) figures.add(figureKey(m[0]));
  for (const m of g.matchAll(FIGURE_NPLUSN_RE)) figures.add(m[0].replace(/\s+/g, ''));
  return { figures, text: g.replace(/\s+/g, ''), rawFlat: toHalfwidth(String(ground || '')).replace(/\s+/g, '') };
}

/** 한 조각(혜택 자리) 안에서 근거에 없는 값 · 낱말. */
function inventedIn(piece: string, g: BenefitGround): string[] {
  const out: string[] = [];
  for (const m of piece.matchAll(FIGURE_AMOUNT_RE)) { const k = figureKey(m[0]); if (!g.figures.has(k)) out.push(k); }
  for (const m of piece.matchAll(FIGURE_NPLUSN_RE)) { const k = m[0].replace(/\s+/g, ''); if (!g.figures.has(k)) out.push(k); }
  const flat = piece.replace(/\s+/g, '');
  for (const w of CONCRETE_BENEFIT_WORDS) if (flat.includes(w) && !g.text.includes(w)) out.push(w);
  if (FREE_WORD_RE.test(piece) && !FREE_WORD_RE.test(g.text)) out.push('무료');
  return Array.from(new Set(out));
}

/** 지어낸 혜택 자리(위치 = 원문 그대로 · 정규화가 길이를 보존한다). */
function inventedSpans(text: string, ground: string): Array<{ start: number; end: number; invented: string[] }> {
  const g = groundOf(ground);
  return findBenefitSpans(normalizeOutputText(text, g.rawFlat))
    .map((s) => ({ start: s.start, end: s.end, invented: inventedIn(s.text, g) }))
    .filter((s) => s.invented.length > 0);
}

/** 새로 쓴 문안에서 근거(요청 · 행사 원문 · 상품 정보)에 없는 혜택 값 · 낱말 목록. 없으면 []. */
export function findInventedBenefits(output: string, ground: string): string[] {
  const text = String(output || '');
  if (!text.trim()) return [];
  return Array.from(new Set(inventedSpans(text, ground).flatMap((s) => s.invented)));
}

/**
 * 새로 쓴 문안의 **지어낸 혜택 자리만** 자리표시로 바꾼다(근거에 있는 값을 다르게 표현한 자리는 그대로).
 * 자리표시는 발송 길목(send-placeholder-gate) · 이메일 · DM 발행 가드가 막는다 — 사람이 채우거나 지운 뒤에만 나간다.
 */
export function replaceInventedBenefits(output: string, ground: string): string {
  const text = String(output || '');
  if (!text.trim()) return text;
  const bad = inventedSpans(text, ground);
  if (bad.length === 0) return text;
  let out = text;
  for (const s of bad.sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + BENEFIT_PLACEHOLDER + out.slice(s.end);
  // 붙어 버린 자리표시 중복 정리(공백만 사이에 둔 연속 자리표시 → 하나).
  const escaped = BENEFIT_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out.replace(new RegExp(`(?:${escaped}\\s*){2,}`, 'g'), BENEFIT_PLACEHOLDER);
}

/**
 * **다시 쓰는 문안**(다듬기 · 변형 · 톤 바꾸기)에 원문에 없던 숫자가 생겼는가 — "90분 안에" · "3일 한정" 같은 지어낸 조건.
 *   숫자는 **값으로** 비교한다 — 금액 · 비율은 값 키로 바꾼 뒤 숫자를 뽑는다("1만원" = "10,000원" · "30퍼센트" = "30%" · 전각 = 반각)(Codex 0930 3R).
 *   허용 = 원문의 숫자 · 지금 달의 "N월" 표현 · %변수% 안.
 */
export function findNewNumbers(output: string, source: string, now: Date = new Date()): string[] {
  const valueForm = (t: string, pctRe: RegExp) => toHalfwidth(String(t || ''))
    .replace(/%[^%\s]{1,20}%/g, ' ')
    .replace(pctRe, pctPad)
    .replace(FIGURE_AMOUNT_RE, (m: string) => ` ${figureKey(m)} `);
  const nums = (t: string) => Array.from(t.matchAll(/\d+(?:[.,]\d+)*/g)).map((m) => m[0].replace(/,/g, ''));
  const allowed = new Set(nums(valueForm(source, PCT_GROUND_RE)));
  // 지금 달은 "9월" 같은 **달 표현일 때만** 허용한다(Codex 0930 1R: 숫자 자체를 허용하면 "선착순 9명" · "9일 한정"도 통과했다).
  const kstMonth = new Date(now.getTime() + 9 * 3600 * 1000).getUTCMonth() + 1;
  const out = valueForm(output, PCT_OUTPUT_RE).replace(new RegExp(`(?<![\\d.,])${kstMonth}\\s*월`, 'g'), ' ');
  return Array.from(new Set(nums(out).filter((n) => !allowed.has(n))));
}

/*
 * ── HTML (★ 2026-09-30 Codex 1~3R) ─────────────────────────────────────────────────────
 * 판정 = 보이는 글(위치 없음) · 바꾸기 = 글 조각 안에서만 · 조각 안에서 못 바꾼 값이 남으면 본문 맨 앞에 자리표시 한 줄(발송 가드가 막는다).
 * 조각 나누기는 정규식이 아니라 한 번 훑는 스캐너다(역추적 없음 · 입력 길이에 비례).
 */
interface HtmlToken { markup: boolean; raw: string }

/** 태그 시작 = "<" 바로 뒤가 글자 · "/" · "!" · "?"일 때만. "가격 < 5000원" 같은 글 속 꺾쇠는 글이다(Codex 0930 3R). */
const TAG_START_RE = /[A-Za-z/!?]/;

function htmlTokens(html: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  const n = html.length;
  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => { if (end > textStart) out.push({ markup: false, raw: html.slice(textStart, end) }); };
  while (i < n) {
    if (html[i] !== '<' || !TAG_START_RE.test(html[i + 1] || '')) { i += 1; continue; }
    flushText(i);
    let end: number;
    if (html.startsWith('<!--', i)) {
      const c = html.indexOf('-->', i + 4);
      end = c < 0 ? n : c + 3;
    } else {
      // 태그 끝 = 따옴표 밖의 첫 ">"(속성 값 안의 ">"는 태그 안이다)
      let j = i + 1;
      let q = '';
      while (j < n) {
        const ch = html[j];
        if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
        j += 1;
      }
      end = j < n ? j + 1 : n;
      const raw = /^<(style|script)\b/i.exec(html.slice(i, end));
      if (raw) {
        // 닫는 태그는 **원문에서** 대소문자를 무시해 찾는다(Codex 0930 4R: toLowerCase 가 "İ" 같은 글자를 두 칸으로 늘려 위치가 어긋났다)
        const closeRe = new RegExp(`</${raw[1]}`, 'ig');
        closeRe.lastIndex = end;
        const close = closeRe.exec(html);
        const closeEnd = close ? html.indexOf('>', close.index) : -1;
        end = closeEnd < 0 ? n : closeEnd + 1;
      }
    }
    out.push({ markup: true, raw: html.slice(i, end) });
    i = end;
    textStart = end;
  }
  flushText(n);
  return out;
}

/** 글 흐름을 끊는 태그(문단 · 줄 · 칸). 그 밖의 태그(strong · span · a 등)는 글 사이에 투명하다. */
const HTML_BLOCK_TAG_RE = /^<\/?(?:p|div|br|li|ul|ol|tr|td|th|table|tbody|thead|h[1-6]|section|article|header|footer|blockquote|hr|center|body|html)\b/i;
/**
 * 엔티티 해독(판정용 · Codex 0930 3R · 4R).
 *   - 숫자 참조는 세미콜론이 없어도 푼다(브라우저가 그렇게 보여 준다 · "&#37 할인" = "% 할인").
 *   - 이름 참조 가운데 **혜택 판정에 쓰이는 글자**를 내는 것은 %(percnt) · +(plus)뿐이다(숫자 · "원"은 이름 참조가 없다). 아는 것은 그 글자로,
 *     **모르는 이름 참조는 공백으로** 둔다 — 공백 계열(&ThinSpace; 등)이든 다른 글자든, 금액 정규식은 숫자와 단위 사이 공백을 허용하므로
 *     값이 드러나는 쪽으로 틀린다(숨는 쪽으로 틀리지 않는다).
 *   - 세미콜론 없는 옛 이름 참조(&nbsp &amp …)는 공백 · 기호로.
 */
const HTML_ENTITY: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", percnt: '%', plus: '+', num: '#', comma: ',', period: '.',
  colon: ':', sol: '/', lpar: '(', rpar: ')',
};
const LEGACY_NO_SEMI: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };

function decodeHtmlEntities(t: string): string {
  return t.replace(/&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]*);|(amp|lt|gt|quot|nbsp)(?![A-Za-z0-9;]))/gi,
    (_m: string, dec?: string, hex?: string, name?: string, legacy?: string) => {
      if (dec != null || hex != null) {
        const code = dec != null ? parseInt(dec, 10) : parseInt(hex as string, 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : ' ';
      }
      if (name != null) return HTML_ENTITY[name] ?? HTML_ENTITY[name.toLowerCase()] ?? ' ';
      return LEGACY_NO_SEMI[(legacy as string).toLowerCase()] ?? ' ';
    });
}

/** HTML 의 **보이는 글**(태그 · 속성 · 주석 · style · script 제외 · 엔티티 해독 · 문단 태그 = 줄바꿈). 판정 · 근거용 — 위치는 돌려주지 않는다. */
export function htmlVisibleText(html: string): string {
  return htmlTokens(String(html || '')).map((tk) => {
    if (!tk.markup) return decodeHtmlEntities(tk.raw);
    if (tk.raw.startsWith('<!--')) return '';
    if (/^<(style|script)\b/i.test(tk.raw)) return '\n';
    return HTML_BLOCK_TAG_RE.test(tk.raw) ? '\n' : '';
  }).join('');
}

/**
 * HTML 본문의 지어낸 혜택을 자리표시로 — **새로 쓰는 이메일**용. 태그 · 속성은 건드리지 않는다.
 *   ① 판정은 보이는 글 기준(태그로 나뉜 값 · 엔티티 · 전각도 본다).
 *   ② 바꾸기는 글 조각 안에서만(replaceInventedBenefits · 구조가 깨질 일이 없다).
 *   ③ 조각 안에서 못 바꾼 값이 남으면(태그 · 엔티티를 가로지른 표기) 본문 맨 앞에 자리표시 한 줄 — 이메일 발송 가드가 사람이 지우기 전까지 막는다.
 * 반환 = [바뀐 HTML, 잡힌 값 목록].
 */
export function replaceInventedBenefitsInHtml(html: string, ground: string): [string, string[]] {
  const src = String(html || '');
  const invented = findInventedBenefits(htmlVisibleText(src), ground);
  if (invented.length === 0) return [src, []];
  const tokens = htmlTokens(src);
  let out = tokens.map((tk) => (tk.markup ? tk.raw : replaceInventedBenefits(tk.raw, ground))).join('');
  if (findInventedBenefits(htmlVisibleText(out), ground).length > 0) {
    const line = `<p>${BENEFIT_PLACEHOLDER}</p>`;
    let at = 0;
    let pos = 0;
    for (const tk of htmlTokens(out)) {
      pos += tk.raw.length;
      if (tk.markup && /^<body\b/i.test(tk.raw)) { at = pos; break; }
    }
    out = out.slice(0, at) + line + out.slice(at);
  }
  return [out, invented];
}

/** 링크 · 이미지 · 모양 값 필드는 글이 아니다(혜택 대조 대상 아님). */
const NON_COPY_KEY_RE = /url|href|image|img|src|link|color|colour|align|style|variant|layout|height|width|position|type|id$|code$|icon|font|size/i;

/**
 * 블록(섹션) 구조의 **글 필드**를 깊게 훑어 replaceInventedBenefits 를 적용한다(링크 · 이미지 · 모양 값 · 숫자 필드는 건너뜀).
 * 새 객체를 돌려준다(입력 불변). 잡힌 값은 found 에 모은다.
 */
export function replaceInventedBenefitsDeep<T>(value: T, ground: string, found: string[] = []): T {
  const walk = (v: any, key: string): any => {
    if (typeof v === 'string') {
      if (NON_COPY_KEY_RE.test(key)) return v;
      const inv = findInventedBenefits(v, ground);
      if (inv.length === 0) return v;
      found.push(...inv);
      return replaceInventedBenefits(v, ground);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      return o;
    }
    return v;
  };
  return walk(value, '') as T;
}
