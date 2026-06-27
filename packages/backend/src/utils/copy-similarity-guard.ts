/**
 * copy-similarity-guard.ts — 문안 두뇌 ④ 복제·금지어·시그니처 가드 (순수 함수, DB·AI 무의존)
 *
 * 두 역할:
 *   1) 입력단 — 한 회사(tenant)에서 반복되는 고유 문구를 시그니처 후보로 판정 → 업종 예시에서 제외.
 *   2) 출력단 — 생성문이 참조 예시와 연속 n어절 일치 또는 단어집합 유사도 임계 초과면 누출로 차단.
 *   + 브랜드 키트 금지어 검출.
 *
 * 마스킹 토큰({brand}/{phone}/{amount}/{url}/{email})은 비교 전 제거 — 토큰 일치로 인한 오탐 방지.
 */

export interface CopyLeakResult {
  leaked: boolean;
  matched?: string;
}

export interface CopyLeakOptions {
  ngram?: number;   // 연속 어절 일치 길이 (기본 6)
  jaccard?: number; // 단어집합 유사도 임계 (기본 0.6)
}

/** 마스킹 토큰·구두점 제거 + 공백 정규화 + 소문자화 */
export function normalizeForCompare(text: string): string {
  if (!text) return '';
  return text
    .replace(/\{[a-z]+\}/gi, ' ')      // 마스킹 토큰 제거
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // 문자/숫자/공백만 남김
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 정규화된 텍스트의 연속 n어절 토큰 배열 */
export function ngramTokens(normalizedText: string, n: number): string[] {
  const tokens = normalizedText.split(' ').filter(Boolean);
  if (n <= 0 || tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

/** 한 tenant에서 임계 이상 반복되는 문구 = 시그니처 후보 (업종 예시에서 제외 대상) */
export function isLikelySignature(
  phrase: string,
  perTenantFreq: Record<string, number>,
  threshold = 3,
): boolean {
  const freq = perTenantFreq[phrase] || 0;
  return freq >= threshold;
}

/** 생성문 ↔ 참조 예시 복제 검출 (연속 n어절 일치 우선, 그다음 단어집합 Jaccard) */
export function checkCopyLeak(
  generated: string,
  examples: string[],
  opts: CopyLeakOptions = {},
): CopyLeakResult {
  const ngram = opts.ngram ?? 6;
  const jaccardLimit = opts.jaccard ?? 0.6;

  const gNorm = normalizeForCompare(generated);
  if (!gNorm) return { leaked: false };

  const gNgrams = new Set(ngramTokens(gNorm, ngram));
  const gWords = new Set(gNorm.split(' ').filter(Boolean));

  for (const ex of examples || []) {
    const exNorm = normalizeForCompare(ex);
    if (!exNorm) continue;

    // 1) 연속 n어절 일치
    for (const ng of ngramTokens(exNorm, ngram)) {
      if (gNgrams.has(ng)) return { leaked: true, matched: ng };
    }

    // 2) 단어집합 Jaccard 유사도 (어순만 바꾼 변형 베낌 방어)
    const exWords = new Set(exNorm.split(' ').filter(Boolean));
    if (exWords.size === 0) continue;
    let inter = 0;
    for (const w of exWords) if (gWords.has(w)) inter++;
    const union = new Set([...exWords, ...gWords]).size;
    if (union > 0 && inter / union >= jaccardLimit) {
      return { leaked: true, matched: exNorm.slice(0, 40) };
    }
  }

  return { leaked: false };
}

/** 브랜드 키트 금지어 검출 (부분 일치) */
export function findBannedWords(text: string, banned: string[]): string[] {
  if (!text || !banned || banned.length === 0) return [];
  const found: string[] = [];
  for (const w of banned) {
    const word = (w || '').trim();
    if (word && text.includes(word)) found.push(word);
  }
  return found;
}
