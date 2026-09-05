/**
 * ★ CT: AI 영업 아웃리치 — 행사 텍스트 추출기 (2026-08-26 신설 · 설계서 §17)
 *
 * 왜 별도 파일인가: `fetchEventTextFromUrl`은 DM 편집기(`routes/dm.ts`)와 공용이라 손대지 않는다.
 * 아웃리치만 쓰는 구조화 로직을 여기에 두고, 아웃리치 호출부만 이 함수를 부른다(축 규율 — 호출부에서 막는다).
 *
 * 무엇을 하나: 이미 받아 둔 HTML에서 행사로 보이는 조각을 먼저 골라 **앞에 싣고**, 그 뒤에
 * 기존 전체 텍스트를 그대로 붙인다. 구조화는 **우선순위 신호이지 필터가 아니다** —
 * 1·2단계가 0건이어도 결과는 기존 방식과 같은 문자열이 되어 무후퇴다.
 *
 * ⛔ 새 네트워크 요청 0. 입력은 `fetchHtmlGuarded`가 이미 가드를 통과해 받아 온 HTML뿐이다.
 * ⛔ 반환 문자열 하나가 AI 입력이자 재대조 원문이다(불변 4). 두 벌로 나누지 않는다.
 */
import { extractEventTextFromHtml } from './dm/dm-brand-extractor';

/** 행사성 블록으로 볼 class·id 토큰 */
const EVENT_CLASS_TOKENS = 'event|promotion|promo|sale|benefit|coupon|special|discount|campaign';

/** 조각 하나에서 뽑을 텍스트 상한 */
const CARD_TEXT_MAX = 400;

/** 반환 문자열 전체 상한 — 옮기기 전 `fetchEventTextFromUrl` 상수와 같은 값 */
const TOTAL_MAX = 6000;

/** 구조화 블록이 쓸 수 있는 상한. 나머지가 본문 예산이다 */
const STRUCTURED_MAX = 1500;

/** 1단계 — 행사성 class·id를 단 요소의 내부 텍스트 */
function extractEventCards(html: string): string[] {
  // 태그 이름 alternation은 긴 것부터 — article이 a보다 먼저 걸려야 역참조 </article>가 맞는다.
  const re = new RegExp(
    '<(div|ul|ol|section|article|li|a)[^>]*(?:class|id)=["\'][^"\']*(?:'
      + EVENT_CLASS_TOKENS
      + ')[^"\']*["\'][^>]*>(.*?)</\\1>',
    'gis',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = extractEventTextFromHtml(m[2], CARD_TEXT_MAX);
    if (text) out.push(text);
  }
  return out;
}

/** 혜택으로 읽히는 표현 — 링크·버튼 텍스트를 거르는 기준 */
const BENEFIT_KEYWORD_RE =
  /(\d+\s*%|\d[\d,]*\s*원|1\s*\+\s*1|할인|쿠폰|세일|특가|핫딜|타임딜|무료\s*배송|사은품|증정|선착순|한정|기획전|페스타|감사제|프로모션|이벤트)/;

/** 2단계 — 혜택 키워드가 든 링크 텍스트 (class 규약이 없는 사이트를 위한 축) */
function extractDealLinks(html: string): string[] {
  const re = /<a[^>]*>(.*?)<\/a>/gis;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = extractEventTextFromHtml(m[1], CARD_TEXT_MAX);
    if (text && BENEFIT_KEYWORD_RE.test(text)) out.push(text);
  }
  return out;
}

/** 같은 문장·이미 실린 문장에 포함된 조각 제거 (앞에 실린 것이 이긴다) */
function dedupeBlocks(blocks: string[]): string[] {
  const kept: string[] = [];
  for (const b of blocks) {
    const t = b.trim();
    if (!t) continue;
    if (kept.some((k) => k.includes(t))) continue;
    kept.push(t);
  }
  return kept;
}

/**
 * HTML → 아웃리치용 행사 원문 + 계측. 구조화 블록 + 기존 전체 텍스트.
 * ★ 2026-09-05(A-12) 구조화 블록이 본문에 그대로 다시 나오는 중복을 제거한다 : 잘리지 않고 온전히 실린 블록만
 *   본문에서 첫 1회 지운 뒤 남은 예산으로 절단한다. 0건이면 본문 경로가 옛 방식과 문자 단위로 같다(무후퇴 계약 유지).
 * 아무것도 못 뽑으면 text=null(현행 `fetchEventTextFromUrl` 실패와 같은 계약).
 */
export function buildOutreachEventMaterial(html: string): { text: string | null; structuredBlocks: number } {
  const blocks = dedupeBlocks([...extractEventCards(html), ...extractDealLinks(html)]);
  const structured = blocks.join('\n').slice(0, STRUCTURED_MAX);
  // 구조화 블록이 먹은 만큼만 본문 예산에서 뺀다. 0건이면 예산이 그대로 6000이라
  // 결과가 옛 방식과 문자 단위로 같아진다(무후퇴 계약).
  const baseBudget = TOTAL_MAX - structured.length - (structured ? 1 : 0);
  let base: string | null = null;
  if (baseBudget > 0) {
    if (blocks.length === 0) {
      base = extractEventTextFromHtml(html, baseBudget);
    } else {
      // 온전히 실린 블록(절단된 마지막 블록 제외)만 본문에서 첫 1회 제거 → 남은 예산으로 절단
      const whole = blocks.filter((b) => structured.includes(b));
      let full = extractEventTextFromHtml(html, TOTAL_MAX) || '';
      for (const b of whole) {
        const i = full.indexOf(b);
        if (i >= 0) full = (full.slice(0, i) + full.slice(i + b.length)).replace(/\s{2,}/g, ' ').trim();
      }
      base = full ? full.slice(0, baseBudget) : null;
    }
  }
  const merged = [structured, base].filter(Boolean).join('\n');
  return { text: merged || null, structuredBlocks: blocks.length };
}

/** 기존 계약(문자열 하나) 래퍼 — 테스트·호출부 유지 */
export function buildOutreachEventText(html: string): string | null {
  return buildOutreachEventMaterial(html).text;
}
