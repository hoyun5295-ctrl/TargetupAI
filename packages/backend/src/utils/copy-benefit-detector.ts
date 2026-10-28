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
 * ★ 2026-10-19 B-1018-1 — 글에서 혜택 자리(얼마 + 무엇 · findBenefitSpans)를 지운다(AI 근거용 · 값은 코드가 재료로 놓는 경로).
 *   근거에 혜택 값 · 낱말이 하나도 없으니, AI 가 만든 혜택은 무엇이든 findInventedBenefits 에 걸린다(교차 조합 「5% 할인」 포함).
 */
export function withoutBenefitSpans(text: string): string {
  // 검증(findInventedBenefits)과 같은 정규화 — 전각 · 「N퍼센트」 · 「N프로」 = %(F2 · 옛: 반각만 보아 「10퍼센트」가 근거에 남았다)
  const src = normalizeGroundText(String(text || ''));
  let out = src;
  for (const sp of findBenefitSpans(src).sort((a, b) => b.start - a.start)) out = out.slice(0, sp.start) + ' ' + out.slice(sp.end);
  return out.replace(/\s{2,}/g, ' ').trim();
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

// ─────────────── 효능 단정(★ 2026-10-24 · 한 줄 CT 글 · 첫 화면 그림 글 · 문자 문안이 같은 판정 · 뿌리 대장 R1) ───────────────
//   옛: 판정이 그림 글(line-headline)과 한 줄 판단 초안에만 있었고, 실제로 나가는 DM · 이메일 · 인앱 본문 문구와 문자 문안에는 없었다
//   (공용 문자 프롬프트는 오히려 「성분 효능 · before/after 기대감」을 쓰라고 시켰다 · 1024 한 줄 CT 구조체크).
//   판정 = **주장** 단위(대상 말 + 변화 말 한 짝) · 근거 = **고객이 긍정으로 쓴 그대로**(★ Codex 2R · 3R):
//   주장 글자(대상 말 ~ 변화 말)가 근거 글에 공백만 빼고 그대로 있고 뒤에 부정 말이 없어야 근거 있는 말이다 — 프롬프트 계약과 같다
//   (「고객이 요청에 직접 적은 기능 문구만 그 글자 그대로」). 근거 여기저기에 흩어진 낱말(「혈당 관리 … 포장재 감소」)이나
//   바꿔 쓴 효능 문구는 근거가 아니다(★ Codex 1R · 2R: 낱말이 함께 있는지만 보면 근거 없는 주장이 계속 통과했다).
//   ponytail: 낱말 목록 판정이다 — 목록 밖 효능 말은 프롬프트(### 4 · 맞춤 8번)가 첫 방어선 · 새 말은 목록에 더한다.

/** 받침이 붙은 꼴까지 한 글자 범위(지 → 진 · 질 · 집 · 짐 / 져 → 졌) — 해요체 · 격식체 · 과거 · 관형 활용을 한 번에 덮는다(★ Codex 2R 「낮춥니다」) */
const anyFinal = (syl: string): string => `[${syl}-${String.fromCharCode(syl.charCodeAt(0) + 27)}]`;
const BECOME = `(?:${anyFinal('지')}|${anyFinal('져')})`;

/** 대상 말(몸 · 피부) */
const EFFICACY_BODY_RE = /(피부|모공|주름|각질|탄력|피지|여드름|트러블|두피|머릿결|모발|몸|체중|뱃살|군살|체지방|혈색|안색|컨디션|붓기|부기|노화|기미|잡티|다크서클|피로|면역력|면역|관절|소화|숙면|혈당|혈압|콜레스테롤)/g;
/**
 * 변화 말 — 날씨 · 기분 · 가격 말(「따뜻해지는 · 기분 좋아지는 · 착해진」)과 「빠지지 않는 필수템」은 효능 말이 아니다.
 *   흔한 효능 서술(낮춰요 · 높여요 · 없애요 · 줄여요 · 잡아 줘요 · 지켜 줘요 · 도움)도 변화 말이다(★ Codex 1R).
 */
const EFFICACY_CHANGE_RE = new RegExp([
  `(?<!따뜻|포근|훈훈|든든|행복|즐거|신나|설레|착)해${BECOME}`, `(?<!기분\\s*)좋아${BECOME}`, `달라${BECOME}`, `나아${BECOME}`,
  `(?<!기분\\s*)맑아${BECOME}`, `가벼워${BECOME}`, `살아${anyFinal('나')}`, '개선', '효과', '회복', `사라${BECOME}`,
  '줄어', `줄(?:${anyFinal('이')}|${anyFinal('여')})`, `낮(?:${anyFinal('추')}|${anyFinal('춰')}|아${BECOME})`,
  `높(?:${anyFinal('이')}|${anyFinal('여')}|아${BECOME})`, `없(?:${anyFinal('애')}|어${BECOME})`,
  `(?:잡아|지켜)\\s*(?:${anyFinal('주')}|${anyFinal('줘')}|드)`, '강화', '완화', '예방', '해소', '감소', '도움',
].join('|'), 'g');
/** 그 자체로 효능 단정인 말(대상 없이도) */
const EFFICACY_STRONG_RE = new RegExp(`효능|약효|특효|치료|치유|완치|(?:군살|뱃살|체지방|붓기|부기|살)\\s*(?:이|가|은|는|도)?\\s*빠${BECOME}`, 'g');
/** 「이」로 끝나는 흔한 부사 — 주어(「일정이」)와 가른다 */
const ADVERB_I = new Set(['많이', '같이', '깊이', '높이', '깨끗이', '뚜렷이', '따뜻이', '촉촉이', '산뜻이', '반듯이', '가까이', '굳이', '일찍이', '틈틈이', '나날이']);

/** 문장 하나(p = 문단 번호 · sep = 뒤 구분자) */
interface CopyUnit { p: number; s: string; sep: string }
/** 주장 하나 — span = 주장 글자(대상 말 ~ 변화 말 · 근거 대조용) · units = 걸친 문장 번호(뺄 문장) */
interface EfficacyClaim { span: string; units: number[] }

/** (순수) 문단(빈 줄) · 문장(. ! ? 뒤) 단위로 나눈다 — 한 문단 안의 줄바꿈은 같은 문장(문자는 17자마다 줄을 바꾼다) */
function splitCopyUnits(src: string): CopyUnit[] {
  const units: CopyUnit[] = [];
  src.split(/\n[ \t]*\n/).forEach((para, p) => {
    const parts = para.split(/((?<=[.!?。])\s+)/);
    for (let i = 0; i < parts.length; i += 2) if (parts[i]) units.push({ p, s: parts[i], sep: parts[i + 1] ?? '' });
  });
  return units;
}

/** (순수) 글에 제 주어(○○이 · ○○가)가 있는가 — 있으면 앞 문장의 대상을 이어받지 않는다(「배송 일정이 달라져요」 · ★ Codex 2R) */
function hasOwnSubject(s: string): boolean {
  return Array.from(s.matchAll(/[가-힣]+(?:이|가)(?=[\s,.!?~]|$)/g), (m) => m[0]).some((w) => !ADVERB_I.has(w));
}

/**
 * (순수) 효능 주장 목록 — 문단 안에서만 짝짓는다(문단을 넘어 잇지 않는다 · ★ Codex 2R).
 *   변화 말의 주장 글자 = 같은 문장에서
 *   ① 앞 변화 말 뒤 ~ 이 말 앞의 첫 대상부터 이 말까지(「혈당과 혈압을 낮춰요」 = 혈당부터 · ★ Codex 2R)
 *   ② 앞 대상이 없거나 뜻이 갈리면(앞 변화 말이 뒤 대상으로 이미 쓴 말 · 한글 · 공백이 아닌 글자를 건너야 닿는 말) 이 말부터 다음 변화 말 앞까지
 *      뒤에 오는 대상 **전부**도 주장 글자다 — 두 해석을 **모두** 근거와 대조한다(「달라지는 피부와 눈가 주름」 = 주름까지 ·
 *      「달라지는 피부, 주름 개선과 모공 케어」의 개선 = 「피부, 주름 개선」과 「개선과 모공」 둘 다 · 연결 말을 읽지 않는다 · ★ Codex 3R · 4R · 5R)
 *   ③ 둘 다 없으면 문장 안 이 말 앞의 첫 대상부터(「주름 개선과 혈당 감소에 도움」의 도움 = 주름부터)
 *   ④ 문장 안에 대상이 없고 제 주어도 없으면 같은 문단 앞 문장의 가장 가까운 대상을 이어받는다(「피부 고민 끝! 매끈하게 달라져요.」 · ★ Codex 1R).
 *   앞 대상이 한글 · 공백만 사이에 두고 붙어 있으면 뒤 명사는 꾸밈을 받는 말이다(「피부가 좋아지는 모공 케어」 · 「주름 개선 기능성 크림으로 피부결을 가꿔요」).
 *   단정 말(효능 · 치료 · 살이 빠진다)은 그 자체로 한 주장(주장 글자 = 그 문장).
 */
function efficacyClaims(units: readonly CopyUnit[]): EfficacyClaim[] {
  const claims: EfficacyClaim[] = [];
  const paras = new Map<number, number[]>();
  units.forEach((u, i) => paras.set(u.p, [...(paras.get(u.p) ?? []), i]));
  for (const idxs of paras.values()) {
    // 문단 = 문장을 한 칸 띄워 이은 한 글 · starts[k] = k번째 문장의 시작 위치
    const starts: number[] = [];
    let text = '';
    for (const i of idxs) { starts.push(text.length); text += `${units[i].s} `; }
    const sentenceOf = (pos: number): number => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= pos) k++; return k; };
    const at = (re: RegExp) => Array.from(text.matchAll(re), (m) => {
      const i = m.index ?? 0;
      return { i, end: i + m[0].length, k: sentenceOf(i) };
    });
    const bodies = at(EFFICACY_BODY_RE);
    // 단정 말은 낱말만으론 주장이 안 잡힌다 — 그 문장 전체가 주장 글자(근거에 그 문장이 그대로 있어야 한다)
    for (const m of at(EFFICACY_STRONG_RE)) claims.push({ span: units[idxs[m.k]].s, units: [idxs[m.k]] });
    const changes = at(EFFICACY_CHANGE_RE);
    const taken = new Set<number>(); // 앞 변화 말이 뒤 대상으로 가져간 대상(위치)
    changes.forEach((c, n) => {
      const from = n > 0 && changes[n - 1].k === c.k ? changes[n - 1].end : starts[c.k];
      const next = changes.slice(n + 1).find((d) => d.k === c.k);
      const same = bodies.filter((b) => b.k === c.k);
      const pre = same.find((b) => b.i >= from && b.i < c.i);
      const post = same.filter((b) => b.i > c.i && (!next || b.i < next.i));
      const first = same.find((b) => b.i < c.i);
      const split = !pre || taken.has(pre.i) || /[^가-힣\s]/.test(text.slice(pre.end, c.i)); // 한글 · 공백이 아닌 글자(문장 부호 · 괄호 · 따옴표 · 줄표 등)를 건너면 뜻이 갈린다(★ Codex 6R)
      const ranges: Array<{ i: number; end: number; k: number }> = [];
      if (pre) ranges.push({ i: pre.i, end: c.end, k: c.k });
      if (split && post.length > 0) {
        post.forEach((b) => taken.add(b.i));
        ranges.push({ i: c.i, end: post[post.length - 1].end, k: c.k });
      }
      if (ranges.length === 0 && first) ranges.push({ i: first.i, end: c.end, k: c.k });
      if (ranges.length === 0 && !hasOwnSubject(text.slice(starts[c.k], c.i))) {
        const prev = bodies.filter((b) => b.k < c.k).pop();
        if (prev) ranges.push({ i: prev.i, end: c.end, k: prev.k });
      }
      for (const r of ranges) claims.push({ span: text.slice(r.i, r.end), units: Array.from(new Set([idxs[r.k], idxs[c.k]])) });
    });
  }
  return claims;
}

const squash = (v: string): string => String(v || '').replace(/\s+/g, '');

/** 부정 말 */
const NEGATION_RE = /없|않|아니|아[닌닐닙]|못|불가|금지/;
/** 부정이 아닌 「~뿐(만) 아니라」 — 이 말 그대로만 먼저 지운다(일반 「~이 아니라」는 부정 · ★ Codex 4R) */
const NOT_ONLY_RE = /뿐\s*(?:만\s*)?아니라/g;
/** 근거 절 끝 = 문장 부호 · 쉼표 · 줄만(「~고」 같은 어미로 끊지 않는다 — 「있다고 볼 수 없습니다」 · 「광고 금지」 · ★ Codex 4R) */
const GROUND_CLAUSE_END_RE = /[,.!?。\n;]/;

/**
 * (순수) 근거 글에 주장 글자가 **긍정으로** 있는가 — 공백만 무시하고 그대로 있고, 그 뒤 같은 절에 부정 말이 없어야 한다
 *   (「주름 개선 효과는 없습니다」는 「주름 개선 효과를 느껴 보세요」의 근거가 아니다 · ★ Codex 3R).
 */
function groundAffirms(ground: string, span: string): boolean {
  const g = String(ground || '');
  const chars = Array.from(squash(span));
  if (chars.length === 0) return true;
  const re = new RegExp(chars.map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
  for (const m of g.matchAll(re)) {
    const rest = g.slice((m.index ?? 0) + m[0].length);
    const end = rest.search(GROUND_CLAUSE_END_RE);
    if (!NEGATION_RE.test((end < 0 ? rest : rest.slice(0, end)).replace(NOT_ONLY_RE, ''))) return true;
  }
  return false;
}

/** (순수) 근거 글에 긍정으로 그대로 있지 않은 주장만 */
function inventedClaims(units: readonly CopyUnit[], ground: string): EfficacyClaim[] {
  return efficacyClaims(units).filter((c) => !groundAffirms(ground, c.span));
}

/** (순수) 효능 단정 꼴인가 — 근거를 쓰지 않는 자리(그림에 박히는 글자)의 판정 */
export function claimsEfficacy(v: string): boolean {
  return efficacyClaims(splitCopyUnits(String(v || ''))).length > 0;
}

/**
 * (순수) 근거 글에 없는 효능 주장이 있는가 — 주장마다 그 글자가 근거(사람이 쓴 한 줄 · 요청 · 상품 · 브랜드 정보)에 그대로 있어야 근거 있는 말이다
 *   (고객이 직접 쓴 기능성 문구 등 · 혜택 판정과 같은 원칙). 하나라도 근거가 없으면 참.
 */
export function claimsInventedEfficacy(v: string, ground: string): boolean {
  return inventedClaims(splitCopyUnits(String(v || '')), ground).length > 0;
}

/** 효능 단정 문장이 다 빠진 문안에 넣는 직접 채울 자리 — AI_FILL_DIRECT_PATTERN 꼴이라 발송 길목(send-placeholder-gate)이 사람이 고치기 전까지 막는다 */
export const EFFICACY_PLACEHOLDER = '[상품 소개: 직접 작성해주세요]';

/**
 * (순수) 문안에서 근거 없는 효능 주장 문장을 뺀다 — 걸리지 않은 문장은 글자 그대로 둔다 · 뺀 문장 = 재생성 힌트 · 로그.
 *   주장이 두 문장에 걸치면(이어받기) 두 문장을 함께 뺀다. 뺀 뒤 새로 붙는 이웃까지 다시 본다(고정점 · ★ Codex 2R).
 *   다 빠지면 빈 글 대신 직접 채울 자리(★ Codex 2R: 빈 문안 → 실패 대체 문안이면 이미 낸 생성 요금이 남는다).
 */
export function dropInventedEfficacy(text: string, ground: string): { text: string; dropped: string[] } {
  const src = String(text || '');
  let units = splitCopyUnits(src);
  const dropped: string[] = [];
  // 한 바퀴에 한 문장 이상 빠지므로 문장 수 안에서 끝난다
  for (;;) {
    const bad = new Set(inventedClaims(units, ground).flatMap((c) => c.units));
    if (bad.size === 0) break;
    units.forEach((u, i) => { if (bad.has(i)) dropped.push(u.s.replace(/\s+/g, ' ').trim()); });
    units = units.filter((_, i) => !bad.has(i));
  }
  if (dropped.length === 0) return { text: src, dropped: [] };
  const paras: string[] = [];
  for (const u of units) paras[u.p] = (paras[u.p] ?? '') + u.s + u.sep;
  const out = paras.filter((x) => x && x.trim()).map((x) => x.trim()).join('\n\n');
  return { text: out || EFFICACY_PLACEHOLDER, dropped };
}

// ─────────────── ★ 2026-10-24 세 채널 구조체크 ② — 생산자 출구 어댑터(판정 문법은 위 그대로 · 설계서 docs/2026-10-24-efficacy-guard-design.md) ───────────────
//   고객에게 나가는 글을 만드는 모든 생산자(DM · 이메일 · 인앱 · AI 영업 · 여정 · SNS · 변형 · 꾸밈 · 대행 · 한 줄 템플릿)가 혜택 거름 바로 다음에 이것을 부른다.
//   근거 = 그 생산자가 혜택에 쓰는 **사람 글** 근거와 같은 변수(AI 산출물 · 우리 지시문은 근거가 아니다).

/** 효능 단정 금지 지시 — 고객 글을 만드는 생성 프롬프트가 이 문안을 그대로 쓴다(같은 문안은 한 곳 · 문자 ### 4 와 같음) */
export const EFFICACY_PROMPT_RULES = `- 상품이 피부 · 몸을 바꾼다고 단정하지 마세요(효능 · 치료 · 개선 · 피부가 좋아진다 · 달라진다 · 살이 빠진다 · 붓기가 빠진다).
- 사용감(텍스처 · 향) · 쓰는 장면 · 고민 공감으로 쓰세요. 고객이 요청에 직접 적은 기능 문구(예: 주름 개선 기능성)만 그 글자 그대로 쓸 수 있습니다.`;

/** 다시 쓰기(다듬기 · 고치기 · 변형) 프롬프트 한 줄 — 근거는 글자 그대로여야 인정되므로 원문 기능 문구를 바꿔 쓰지 않게 */
export const EFFICACY_REWRITE_RULE = '- 원문에 있는 기능 문구(예: 주름 개선 기능성)는 글자 그대로 둡니다. 원문에 없는 효능 · 피부 · 몸 변화 말은 새로 쓰지 않습니다.';

/** 재생성 힌트(문자 재생성 · 생산자 재생성 공용) */
export const EFFICACY_RETRY_HINT = '상품이 피부 · 몸을 바꾼다고 단정하지 않기(효능 · 개선 · 좋아진다 · 달라진다). 사용감 · 쓰는 장면 · 고민 공감으로 쓰기';

/** 헤드라인 · 제목 칸이 효능으로 다 빠졌을 때의 직접 채울 자리(발송 길목 목록에 이미 있는 글자 · 제목에 '상품 소개' 자리가 오지 않게) */
export const HEADLINE_PLACEHOLDER = '[헤드라인을 작성해주세요]';

/** 제목류 칸(다 빠지면 헤드라인 자리) · 비워도 되는 칸 · 버튼 글 — 「그 칸 없이 글이 서는가」(설계서 §2) */
const EFF_HEADLINE_KEY_RE = /^(headline|title|event_title|subject|closingHeadline|inapp_title)$/;
const EFF_OPTIONAL_KEY_RE = /^(tag|eyebrow|badge|badge_text|preheader|sub_copy|caption|subtitle)$/;
const EFF_BUTTON_KEY_RE = /^(label|cta_label|button_label)$/;
/**
 * 한 객체 안 글 칸의 **읽는 순서**(머리글 → 제목 → 부제 → 본문) — 있는 칸만 이 순서로 이어 읽는다(★ Codex 2R · 옛 고정 짝 4개는
 *   뱃지 + 제목 · 태그 + 제목을 보지 않았다 · 규칙 한 벌 = guardReadingSequence).
 */
const EFF_READING_KEYS: readonly string[] = ['tag', 'eyebrow', 'badge', 'badge_text', 'headline', 'title', 'sub_copy', 'subtitle', 'body', 'description'];

/** 다 빠진 칸의 대체값(키마다) */
function efficacyFallbackFor(key: string): string {
  if (EFF_HEADLINE_KEY_RE.test(key)) return HEADLINE_PLACEHOLDER;
  if (EFF_OPTIONAL_KEY_RE.test(key)) return '';
  if (EFF_BUTTON_KEY_RE.test(key)) return '자세히 보기';
  return EFFICACY_PLACEHOLDER;
}

/**
 * (순수) 블록 · 객체 트리의 글 칸마다 근거 없는 효능 문장을 뺀다(혜택 Deep 과 같은 걸음 · 링크 · 이미지 · 모양 값은 건너뜀).
 *   새 객체를 돌려준다(입력 불변). 뺀 문장은 dropped 에 모은다.
 *   다 빠진 칸 = 키마다 대체값(제목류 = HEADLINE_PLACEHOLDER · 비워도 되는 칸 = '' · 버튼 = 「자세히 보기」 · 그 밖 = EFFICACY_PLACEHOLDER · 말없이 빈 필수 칸 0).
 *   같은 객체 안 글 칸은 읽는 순서(EFF_READING_KEYS)로 이어 읽어 걸리면 비워도 되는 칸부터 대체값으로(각각은 통과해도 이어 읽으면 단정인 꼴).
 */
export function dropInventedEfficacyDeep<T>(value: T, ground: string, dropped: string[] = []): T {
  const walk = (v: any, key: string): any => {
    if (typeof v === 'string') {
      if (NON_COPY_KEY_RE.test(key) || !v.trim()) return v;
      const r = dropInventedEfficacy(v, ground);
      if (r.dropped.length === 0) return v;
      dropped.push(...r.dropped);
      return r.text === EFFICACY_PLACEHOLDER ? efficacyFallbackFor(key) : r.text;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      const keys = EFF_READING_KEYS.filter((k) => typeof o[k] === 'string');
      if (keys.length > 1) {
        const texts = guardReadingSequence(keys.map((k) => ({ text: o[k], fallback: efficacyFallbackFor(k), optional: EFF_OPTIONAL_KEY_RE.test(k) })), ground, dropped);
        keys.forEach((k, i) => { o[k] = texts[i]; });
      }
      return o;
    }
    return v;
  };
  return walk(value, '') as T;
}

/**
 * (순수) 붙어 읽히는 두 칸(헤드라인 + 부제 · 제목 + 본문 · 제목 + 프리헤더)을 **문장 경계**로 이어 판정한다.
 *   공백으로 이으면 앞 칸에 마침표가 없을 때 한 문장이 되어, 제 주어가 있는 뒤 칸(「이번 주 가격이 달라져요」)까지 앞 칸 대상을 이어받아 오탐한다.
 *   문장 경계로 이으면 제 주어 판정이 살아나고, 주어 없는 뒤 칸(「매끈하게 달라져요」)은 같은 문단 이어받기로 그대로 잡힌다.
 */
export function pairClaimsInventedEfficacy(a: string, b: string, ground: string): boolean {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return claimsInventedEfficacy(x || y, ground);
  return claimsInventedEfficacy(/[.!?。…]$/.test(x) ? `${x} ${y}` : `${x}. ${y}`, ground);
}

/** 읽는 순서로 붙어 읽히는 칸 하나(대체값 · 비워도 되는 칸인가) */
export interface ReadingItem { text: string; fallback: string; optional?: boolean }

/**
 * (순수) ★ 1024 ② Codex 1R — **고객이 이어 읽는 단위**로 판정한다. 칸 · 블록을 따로 보면 「피부 고민」 + 「매끈하게 달라져요」처럼
 *   각각은 통과하고 이어 읽으면 단정인 꼴이 빠진다(헤드라인 블록 + 본문 블록 · 제목 + 프리헤더 · 제목 + 본문).
 *   빈 칸은 건너뛰고 앞 글과 잇는다. 걸리면 비워도 되는 쪽을 대체값으로(둘 다 필수면 뒤 칸 · 이미 대체값이면 다른 쪽) · 뺀 글은 dropped 에.
 *   ★ Codex 2R — 칸을 비우면 새로 붙은 이웃이 생긴다 → **더 바뀌지 않을 때까지** 처음부터 다시 본다(바뀔 때마다 칸 하나가 대체값이 되므로 칸 수 안에서 끝난다).
 */
export function guardReadingSequence(items: readonly ReadingItem[], ground: string, dropped: string[] = []): string[] {
  const out = items.map((x) => String(x.text ?? ''));
  const done = items.map(() => false);
  for (let round = 0; round <= items.length; round++) {
    let hit = false;
    let j = -1;
    for (let i = 0; i < out.length && !hit; i++) {
      if (!out[i].trim()) continue;
      if (j >= 0 && pairClaimsInventedEfficacy(out[j], out[i], ground)) {
        let t = !items[i].optional && items[j].optional ? j : i;
        if (done[t]) t = t === i ? j : i;
        if (done[t]) break;
        dropped.push(out[t].replace(/\s+/g, ' ').trim());
        out[t] = items[t].fallback;
        done[t] = true;
        hit = true;
      }
      j = i;
    }
    if (!hit) break;
  }
  return out;
}

/**
 * (순수) 제목 + 본문(여정 · 문자형 한 건) — 제목 = 비워도 되는 칸(걸리면 비움) · 본문 = 문장 빼기(다 빠지면 직접 채울 자리) ·
 *   그 뒤 둘을 이어 읽어 걸리면 제목을 비운다. dropped = 뺀 곳 수.
 */
export function dropInventedEfficacyTitledBody(subject: string, body: string, ground: string): { subject: string; body: string; dropped: number } {
  const lost: string[] = [];
  const s0 = String(subject || '');
  const b = dropInventedEfficacy(String(body || ''), ground);
  lost.push(...b.dropped);
  const s1 = s0.trim() && claimsInventedEfficacy(s0, ground) ? (lost.push(s0), '') : s0;
  const [s, body2] = guardReadingSequence([{ text: s1, fallback: '', optional: true }, { text: b.text, fallback: EFFICACY_PLACEHOLDER }], ground, lost);
  return { subject: s, body: body2, dropped: lost.length };
}

/**
 * 판정의 읽는 단위 — 한 섹션 · 한 건의 칸들을 읽는 순서로 잇는다(빈 칸 제외).
 *   ★ Codex 2R — 칸 경계 = **문장 경계**(짝 판정 pairClaimsInventedEfficacy 와 같은 이음 · 한 벌). 줄바꿈으로 이으면 마침표 없는 두 칸이
 *   한 문장이 되어 제 주어가 있는 뒤 칸(「이번 주 가격이 달라져요」)까지 앞 칸 대상을 이어받았다. 근거와 결과를 늘 이 함수 하나로 읽는다.
 */
export function readingUnit(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => String(p ?? '').trim()).filter(Boolean).map((p) => (/[.!?。…]$/.test(p) ? p : `${p}.`)).join(' ');
}

/**
 * (순수) 다시 쓰기(다듬기 · 빠른 고치기 · 변형 · 꾸밈 · 대행 · 문자 다듬기)가 원문에 없던 사실을 더했는가 — 새 숫자 ∥ 지어낸 혜택 값 ∥ 근거 없는 효능.
 *   before = 고치기 전 **실제 글** + 사람 지시(AI 가 돌려준 「전」 값은 근거가 아니다). 참이면 그 제안을 버리고 원래 글을 둔다.
 */
export function rewriteAddsFacts(after: string, before: string): boolean {
  const a = String(after || '');
  const b = String(before || '');
  return findNewNumbers(a, b).length > 0 || findInventedBenefits(a, b).length > 0 || claimsInventedEfficacy(a, b);
}

/**
 * (순수) 칸 여러 개(한 섹션 · 한 건)를 다시 쓴 결과를 **이어 읽으면** 원문에 없던 효능 단정이 생기는가(readingUnit · 근거 = 원래 칸들 + 사람 지시).
 *   ★ Codex 4R — 이 판정은 **효능만** 본다. 숫자 · 혜택은 칸 · 조각마다 원래 계약(rewriteAddsFacts · 0930 근거) 그대로 —
 *   섹션째로 넓히면 혜택 판정 문법 한계를 우회하려는 완화(원문 자기 대조 · 이웃 조각 근거)가 다른 자리 · 다른 상품의 할인을 통과시켰다.
 */
export function readingAddsEfficacy(afterParts: ReadonlyArray<string | null | undefined>, beforeParts: ReadonlyArray<string | null | undefined>, extraGround = ''): boolean {
  return claimsInventedEfficacy(readingUnit(...afterParts), [readingUnit(...beforeParts), extraGround].filter(Boolean).join('\n'));
}

/** 화면에 갈 서버 문장 하나(화면은 문구를 짓지 않는다 · 뺀 문장 원문은 싣지 않는다 = 되살리기 길 0) */
export function efficacyNote(kind: 'generate' | 'rewrite', count: number): string | null {
  if (!(count > 0)) return null;
  return kind === 'generate'
    ? `요청에 없는 효능 문장 ${count}곳을 뺐어요. 인증받은 기능 문구가 있으면 한 줄에 그대로 적어 주세요.`
    : `${count}곳은 원문에 없는 효능 · 숫자 · 혜택 말이 생겨 원래 글을 뒀어요.`;
}

// ─────────────── ★ 2026-10-28 AI 메모리 설계 K1-4 · K1-7(docs/2026-10-28-ai-memory-brand-voice-design.md) ───────────────
//   법(없는 날짜 · 기간 날조 금지)과 발송 규칙(여정 상시 발송 = 계절 낱말 금지)을 지시문 한 줄이 아니라 출구 코드가 지킨다.

/** 근거 글에 없는 날짜 · 기간 자리(AI_FILL_DIRECT_PATTERN 꼴 = 발송 길목이 사람이 고치기 전까지 막는다) */
export const DATE_PLACEHOLDER = '[날짜: 직접 입력해주세요]';

/** 재생성 힌트(문자 재생성 공용) */
export const DATE_RETRY_HINT = '요청에 없는 날짜 · 기간 · 시각(M/D · N일까지 · N일간 · D-n · N시)을 쓰지 않기. 요청에 적힌 날짜만 쓰고, 없으면 날짜 없이 쓰기';

/**
 * 날짜 근거 판정(Codex 구현 1R · 2R · 3R). 문법은 하나다 — 출력을 읽는 날짜 꼴(DATE_TOKEN_RES)을 근거 글에도 그대로 읽는다
 *   (같은 표현 = 양쪽 같은 판정 · 「오후 3시쯤」이 근거에 있으면 출력의 같은 말도 근거가 있다). 근거 글은 그 위에 사람 말투만 더 읽는다.
 *   - 쌍 키 `md:M/D` = 월 · 일이 한 덩이인 날짜(11/5 · 11월 5일 · 오늘 · 사람 글의 11.5 · 11/5~7). 숫자 쌍 꼴(/ · .)은 쌍 키만 낸다
 *     = 「10.5%」 · 「1.5~2배」 · 「1/2 가격」 의 숫자가 「5일까지」 · 「2일까지」의 근거가 되지 않는다(같은 숫자 쌍을 그대로 쓴 날짜만).
 *   - 단위 키 `일:N` 등 = 숫자에 단위가 붙은 말. 사람 말투 쪽은 단위 바로 뒤가 경계일 때만(「12일 오픈」 · 「5~7일」 = 근거 · 「3주년」 · 「5일장」 · 「3시즌」 = 아님).
 *   - D-n 은 식별자 안에서 읽지 않는다(「LED-3」 = 아님).
 * 출력은 위치가 있는 토큰으로 겹침 없이 읽는다(앞선 · 긴 꼴 먼저 · 「11월 5일까지」의 「5일」을 따로 다시 보지 않는다). 바꾸기도 위치로 한다.
 * 출력의 쌍 날짜는 쌍 키가 있거나 그 월 · 일 단위 키가 둘 다 있을 때 근거가 있다(「11월 5일~7일」 → 「11/7」).
 */
type DateUnit = '월' | '일' | '주' | '시간' | '시각';
const unitKey = (unit: DateUnit, n: string) => `${unit}:${Number(n)}`;
const pairKey = (m: string, d: string) => `md:${Number(m)}/${Number(d)}`;

/**
 * 날짜 · 기간 꼴(숫자를 품은 자리 · 출력과 근거 글이 같이 쓴다). pair = 월 · 일 한 덩이 · unit = 그 단위 키.
 * 꼴 밖의 숫자(수량 · 횟수 · 금액)는 이 판정이 보지 않는다(혜택 · 숫자 판정이 따로 본다).
 *   M/D(요일) · M월 D일 · N일간 · N일까지 · D-n · N주간 · N시간 한정 · N시까지 · 오전/오후 N시
 */
const DATE_TOKEN_RES: ReadonlyArray<{ re: RegExp; pair?: true; unit?: (token: string) => DateUnit }> = [
  { re: /(?<![\d.,/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])(?:\s*\([월화수목금토일]\))?/g, pair: true },
  { re: /(?<![\d.,])(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, pair: true },
  { re: /(?<![\d.,])(\d{1,3})\s*일\s*(?=간|동안|까지|부터|한정|만(?:[\s!.,~]|$))/g, unit: () => '일' },
  { re: /(?<![A-Za-z0-9])D\s*-\s*(\d{1,3})(?!\d)/gi, unit: () => '일' },
  { re: /(?<![\d.,])(\d{1,3})\s*(?:주|시간)\s*(?=간|동안|한정|만(?:[\s!.,~]|$))/g, unit: (t) => (t.includes('주') ? '주' : '시간') },
  { re: /(?:오전|오후|밤|새벽|저녁|아침)\s*(\d{1,2})\s*시(?!간)/g, unit: () => '시각' },
  { re: /(?<![\d.,])(\d{1,2})\s*시\s*(?=까지|부터|에|~|\s*~)/g, unit: () => '시각' },
];

interface DateToken { start: number; end: number; text: string; keys: string[]; pair: boolean; m: string; d: string }

/** 글을 날짜 토큰으로(위치 · 겹침 없음 · 앞선 것 먼저 · 같은 자리면 긴 것) */
function scanDateTokens(text: string): DateToken[] {
  const all: DateToken[] = [];
  for (const { re, pair, unit } of DATE_TOKEN_RES) {
    for (const x of text.matchAll(re)) {
      const t = x[0].trimEnd();
      const start = x.index ?? 0;
      all.push({
        start, end: start + t.length, text: t, pair: !!pair, m: x[1], d: x[2] ?? '',
        keys: pair ? [pairKey(x[1], x[2])] : [unitKey(unit!(x[0]), x[1])],
      });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DateToken[] = [];
  for (const t of all) if (!kept.some((k) => t.start < k.end && k.start < t.end)) kept.push(t);
  return kept;
}

/** 단위 바로 뒤 경계 = 한글이 아니거나 조사 · 날짜 뒷말의 첫 글자(사람 말투 쪽만) */
const UNIT_END = '(?:(?![가-힣])|(?=[간까부만에엔의은는이가을를로도째차께쯤내중전후말초경한동안]))';
const unitRe = (unit: string, max: 2 | 3) => new RegExp(`(?<![\\d.,/])(\\d{1,${max}})\\s*${unit}${UNIT_END}`, 'g');
const rangeRe = (unit: string) => new RegExp(`(?<![\\d.,/])(\\d{1,2})\\s*~\\s*(\\d{1,2})\\s*${unit}${UNIT_END}`, 'g');

/** 근거 글 사람 말투: 숫자 쌍(11.5 · 범위 꼬리 11/5~7 · 11.5~7 = 쌍 키만) · 단위 말(경계) */
const GROUND_PAIR_RES: readonly RegExp[] = [
  /(?<![\d.,/])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d])/g,
  /(?<![\d.,/])(\d{1,2})\s*[/.]\s*\d{1,2}\s*~\s*(\d{1,2})(?![\d/.])/g,
];
const GROUND_UNIT_RES: ReadonlyArray<[RegExp, DateUnit[]]> = [
  [rangeRe('일'), ['일', '일']],
  [unitRe('월', 2), ['월']],
  [unitRe('일', 3), ['일']],
  [unitRe('주', 3), ['주']],
  [unitRe('시간', 3), ['시간']],
  [rangeRe('시(?!간)'), ['시각', '시각']],
  [unitRe('시(?!간)', 2), ['시각']],
];

function groundDateKeys(ground: string): string[] {
  const out: string[] = [];
  for (const t of scanDateTokens(ground)) out.push(...t.keys);
  for (const re of GROUND_PAIR_RES) for (const m of ground.matchAll(re)) out.push(pairKey(m[1], m[2]));
  for (const [re, units] of GROUND_UNIT_RES) {
    for (const m of ground.matchAll(re)) units.forEach((u, i) => { if (m[i + 1] !== undefined) out.push(unitKey(u, m[i + 1])); });
  }
  return out;
}

/** (순수) 근거 글의 상대 날짜 말을 기준일 달력으로 푼 월 · 일. 기준일 = 발송일(자동마케팅) · 그 밖 = 지금 */
function relativeDateKeys(ground: string, base: Date): string[] {
  const g = String(ground || '');
  const kst = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000);
  const out: string[] = [];
  const add = (days: number) => {
    const d = kst(new Date(base.getTime() + days * 86400000));
    const mo = String(d.getUTCMonth() + 1);
    const da = String(d.getUTCDate());
    out.push(pairKey(mo, da), unitKey('월', mo), unitKey('일', da));
  };
  if (/오늘|당일/.test(g)) add(0);
  if (/내일/.test(g)) add(1);
  if (/모레/.test(g)) add(2);
  if (/이번\s*주말|주말/.test(g)) {
    const dow = kst(base).getUTCDay();   // 0 = 일
    const toSat = (6 - dow + 7) % 7;
    add(toSat); add(toSat + 1);
  }
  return out;
}

/** (순수) 출력의 근거 없는 날짜 토큰(위치 포함) · 변수 자리는 같은 길이 공백으로 가려 위치가 원문과 같다 */
function inventedDateTokens(output: string, ground: string, base: Date): DateToken[] {
  const out = toHalfwidth(String(output || '')).replace(/%[^%\s]{1,20}%/g, (v) => ' '.repeat(v.length));
  const g = toHalfwidth(String(ground || ''));
  const allowed = new Set<string>([...groundDateKeys(g), ...relativeDateKeys(g, base)]);
  return scanDateTokens(out).filter((t) => !(t.keys.some((k) => allowed.has(k))
    || (t.pair && allowed.has(unitKey('월', t.m)) && allowed.has(unitKey('일', t.d)))));
}

/** (순수) 출력의 날짜 · 기간 자리 중 근거 글(사람 글)에 근거가 없는 자리 원문 목록 */
export function findInventedDates(output: string, ground: string, base: Date = new Date()): string[] {
  return Array.from(new Set(inventedDateTokens(output, ground, base).map((t) => t.text)));
}

/** (순수) 근거 없는 날짜 · 기간 자리를 직접 채울 자리로 바꾼다(그 자리만 · 같은 글자의 다른 자리는 그대로 · 남은 자리는 발송 길목이 막는다) */
export function replaceInventedDates(output: string, ground: string, base: Date = new Date()): string {
  let text = String(output || '');
  for (const t of inventedDateTokens(text, ground, base).sort((a, b) => b.start - a.start)) {
    text = text.slice(0, t.start) + DATE_PLACEHOLDER + text.slice(t.end);
  }
  return text;
}

/**
 * 여정(상시 발송) 문안에 쓰지 않는 시점 말(계절 · 월 · 날씨 · 명절) — 옛 여정 지시문 금지 목록(journey-ai-generator 「상시 발송 원칙」)을 코드로 옮긴 것.
 *   근거 글(여정 목표)에 그 말이 있으면 쓸 수 있다(사람이 그 시기를 정했다).
 */
export const SEASON_WORDS: readonly string[] = [
  '여름', '가을', '겨울', '장마', '벚꽃', '단풍', '크리스마스', '연말', '연초', '새해', '설날', '추석', '명절',
  '환절기', '폭염', '한파', '휴가철', '바캉스', '요즘 날씨', '이 계절', '계절이 바뀌',
];
const SEASON_MONTH_RE = /(?<![\d.,])(\d{1,2})\s*월(?!\s*\d{1,2}\s*일)/g;
/** 한 글자 말은 낱말 속(「돌봄」)에서 걸리지 않게 앞 글자가 한글이 아닐 때만 */
const SEASON_SPRING_RE = /(?<![가-힣])봄/;

/** (순수) 글에 있는 시점 말 중 근거 글에 없는 것 */
export function findSeasonWords(text: string, ground: string): string[] {
  const t = String(text || '');
  const g = String(ground || '');
  const words = SEASON_WORDS.filter((w) => t.includes(w) && !g.includes(w));
  if (SEASON_SPRING_RE.test(t) && !SEASON_SPRING_RE.test(g)) words.push('봄');
  const months = Array.from(t.matchAll(SEASON_MONTH_RE), (m) => m[0].replace(/\s+/g, '')).filter((m) => !g.replace(/\s+/g, '').includes(m));
  return Array.from(new Set([...words, ...months]));
}

/** 여정 패키지 안내 줄(뺀 문장 수 · 화면 그대로) */
export function seasonNote(count: number): string {
  return `여정은 1년 내내 나가서 계절이나 달 이름이 든 문장 ${count}곳을 뺐어요. 특정 시기에 보낼 여정이면 목표에 그 시기를 적어 주세요.`;
}

/** 시점 말 문장이 다 빠진 문안에 넣는 직접 채울 자리(AI_FILL_DIRECT_PATTERN 꼴) */
export const SEASON_PLACEHOLDER = '[안내 문구: 직접 작성해주세요]';

/** (순수) 근거 없는 시점 말이 든 문장을 뺀다(효능 거름과 같은 꼴 · 문장 단위 · 다 빠지면 직접 채울 자리) */
export function dropSeasonSentences(text: string, ground: string): { text: string; dropped: string[] } {
  const src = String(text || '');
  if (findSeasonWords(src, ground).length === 0) return { text: src, dropped: [] };
  const units = splitCopyUnits(src);
  const dropped: string[] = [];
  const kept = units.filter((u) => {
    if (findSeasonWords(u.s, ground).length === 0) return true;
    dropped.push(u.s.replace(/\s+/g, ' ').trim());
    return false;
  });
  const paras: string[] = [];
  for (const u of kept) paras[u.p] = (paras[u.p] ?? '') + u.s + u.sep;
  const out = paras.filter((x) => x && x.trim()).map((x) => x.trim()).join('\n\n');
  return { text: out || SEASON_PLACEHOLDER, dropped };
}
