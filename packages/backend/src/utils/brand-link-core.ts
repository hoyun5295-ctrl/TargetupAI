/**
 * brand-link-core.ts — 브랜드 링크 순수 컨트롤타워 (DB 미의존)
 *
 * 배경 (2026-07-02 Harold 확정 설계 — docs/superpowers/specs/2026-07-02-brand-voice-form-extraction-brand-links-design.md)
 *   실제 URL은 고객사 소유. AI는 URL을 절대 직접 작성하지 않고 {{LINK:라벨}} 토큰만 출력,
 *   백엔드가 등록 URL로 결정적 치환한다(컬럼 %변수% 치환과 같은 철학 — AI URL 오타 원천 차단).
 *   링크 미등록 회사는 [링크를 입력해주세요] placeholder → 발송 전 가드가 차단.
 *
 * 소비처
 *   - routes/ai-memory.ts  : scanLinkHabit (가이드라인 추출 시 링크 습관 코드 스캔)
 *   - utils/brand-voice-prompt.ts : buildBrandLinkPromptSection (생성 프롬프트 규칙)
 *   - services/ai.ts       : applyBrandLinkTokens (생성 후 토큰 치환)
 *   - utils/direct-send-core.ts + routes/campaigns.ts : hasUneditedLinkPlaceholder (발송 전 가드)
 *
 * DB 접근(getBrandLinks)은 brand-voice-prompt.ts(CT-99 캐시)에 있다 — 본 파일은 순수 함수만.
 */

export interface BrandLink {
  id?: string;
  label: string;
  url: string;
}

export interface LinkHabit {
  uses_url: boolean;
  position: 'body_end' | 'mid' | 'none';
  avg_urls_per_message: number;
}

/** 링크 미등록/미선택 자리 표시 — 잔존 시 발송 차단 (혜택 placeholder와 동일 철학) */
export const LINK_PLACEHOLDER = '[링크를 입력해주세요]';

/** AI 출력 토큰 — {{LINK:라벨}} (내부 공백 허용) */
const LINK_TOKEN_RE = /\{\{\s*LINK\s*:\s*([^{}]{1,100}?)\s*\}\}/g;

/** 문안 안 URL 스캔용 (habit 판별) */
const URL_RE = /https?:\/\/[^\s<>"'()\[\]]+/g;

export interface ApplyTokenResult {
  text: string;
  replacedCount: number;
  unresolvedCount: number;
}

/**
 * {{LINK:라벨}} 토큰을 등록 URL로 치환. 미등록 라벨 = LINK_PLACEHOLDER(발송 가드가 차단).
 * 라벨 비교 = trim + 대소문자 무시.
 */
export function applyBrandLinkTokens(text: string, links: BrandLink[]): ApplyTokenResult {
  if (!text) return { text: text || '', replacedCount: 0, unresolvedCount: 0 };
  let replacedCount = 0;
  let unresolvedCount = 0;
  const byLabel = new Map<string, string>();
  for (const l of links || []) {
    if (l && l.label && l.url) byLabel.set(l.label.trim().toLowerCase(), l.url);
  }
  const out = text.replace(LINK_TOKEN_RE, (_m, rawLabel: string) => {
    const url = byLabel.get(String(rawLabel).trim().toLowerCase());
    if (url) {
      replacedCount++;
      return url;
    }
    unresolvedCount++;
    return LINK_PLACEHOLDER;
  });
  return { text: out, replacedCount, unresolvedCount };
}

/** 발송 전 가드 — placeholder 또는 치환 안 된 {{LINK: 토큰 잔존 여부 */
export function hasUneditedLinkPlaceholder(text: string): boolean {
  if (!text) return false;
  if (text.includes(LINK_PLACEHOLDER)) return true;
  return /\{\{\s*LINK\s*:/i.test(text);
}

/**
 * 대표 문안들에서 링크 습관을 코드로 스캔 (AI 추출이 아니라 결정적 정규식 — 오탐 0).
 * uses_url = 과반(50%+) 문안에 URL 존재. position = URL이 본문 끝쪽(마지막 60% 지점 이후)에
 * 몰려 있으면 body_end, 아니면 mid.
 */
export function scanLinkHabit(texts: string[]): LinkHabit {
  const list = (texts || []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (list.length === 0) return { uses_url: false, position: 'none', avg_urls_per_message: 0 };

  let withUrl = 0;
  let totalUrls = 0;
  let bodyEndVotes = 0;
  for (const text of list) {
    const matches = Array.from(text.matchAll(new RegExp(URL_RE.source, 'g')));
    if (matches.length === 0) continue;
    withUrl++;
    totalUrls += matches.length;
    const last = matches[matches.length - 1];
    const idx = last.index ?? 0;
    // 본문 끝 판정: URL 뒤 잔여 텍스트가 짧거나(수신거부 한 줄 여유 40자) 위치가 뒤쪽 60% 이후
    const tailLen = text.slice(idx + last[0].length).trim().length;
    if (tailLen <= 40 || idx >= text.length * 0.6) bodyEndVotes++;
  }

  const usesUrl = withUrl > 0 && withUrl / list.length >= 0.5;
  if (!usesUrl) return { uses_url: false, position: 'none', avg_urls_per_message: 0 };

  return {
    uses_url: true,
    position: bodyEndVotes / withUrl >= 0.5 ? 'body_end' : 'mid',
    avg_urls_per_message: Math.round((totalUrls / withUrl) * 10) / 10,
  };
}

/**
 * 생성 시스템 프롬프트에 붙일 링크 규칙 섹션.
 * - 등록 링크 존재: 토큰만 출력 지시 + 라벨 목록. URL 직접 작성 절대 금지.
 * - 링크 0 + 링크 습관 회사: placeholder 한 줄 지시 (발송 가드가 미입력 차단).
 * - 둘 다 아니면 빈 문자열.
 */
export function buildBrandLinkPromptSection(links: BrandLink[], habit?: LinkHabit | null): string {
  const safeLinks = (links || []).filter((l) => l && l.label && l.url);
  const positionGuide = habit?.uses_url && habit.position === 'body_end'
    ? '이 회사 문안은 본문 마지막(CTA 문구 다음 줄)에 링크를 넣는 습관이 있습니다. CTA 문구 다음 줄에 배치하세요.'
    : '문안 흐름상 자연스러운 위치(CTA 부근) 1곳에만 배치하세요.';

  if (safeLinks.length > 0) {
    const labelList = safeLinks
      .map((l) => `- {{LINK:${l.label}}} — ${l.label} 링크 자리`)
      .join('\n');
    return `

## 브랜드 링크 규칙 (반드시 준수)

- 이 회사는 아래 브랜드 링크를 등록해 두었습니다. 링크가 필요한 자리에는 반드시 아래 토큰만 그대로 출력하세요. 시스템이 등록된 실제 URL로 자동 치환합니다.
${labelList}
- URL을 직접 작성(https://... 형태)하는 것은 절대 금지 — 토큰만 사용하세요.
- 링크 토큰은 문안당 최대 1개만 사용하세요. ${positionGuide}
- 링크가 어울리지 않는 문안이면 토큰을 넣지 않아도 됩니다.`;
  }

  if (habit?.uses_url) {
    return `

## 브랜드 링크 규칙 (반드시 준수)

- 이 회사 문안은 본문에 링크를 넣는 습관이 있으나, 아직 등록된 브랜드 링크가 없습니다.
- URL을 직접 작성(https://... 형태)하는 것은 절대 금지.
- 링크 자리에는 "${LINK_PLACEHOLDER}" 한 줄만 그대로 넣으세요. ${positionGuide}`;
  }

  return '';
}
