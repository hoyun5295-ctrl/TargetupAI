/**
 * smsSafeChars.ts — SMS/LMS 발송 안전 자산 컨트롤타워
 *
 * SMS_SAFE_CHARS: EUC-KR 인코딩 지원이 확인된 특수문자 목록 (D152 검증 세트).
 *   소비처 = Dashboard 특수문자 모달 + MessageEditorModal 특수문자함. 목록 변경은 이 파일 1곳만.
 * koreanBytes: 한글 2바이트 기준 바이트 계산 (backend calculateKoreanBytes와 동일 기준).
 *
 * ★ 2026-09-10 규격 밖 글자(설계 = docs/2026-09-10-unsupported-char-substitution-design.md §3·§4-1)
 *   isSmsEncodableChar: 문자로 보낼 수 있는 글자인가 = 게이트웨이 CP949 인코더 표(`cp949Chars.ts`) 기준.
 *   findUnsupportedSmsChars: 보낼 수 없는 글자 목록 + 표에 있으면 바꿀 글자.
 *   substituteSmsChars: 대체표 v1 로 바꾼 문장. 표에 없는 글자는 그대로 둔다(불변 3).
 *   hasUnsupportedSmsChars + SMS_CHARSET_BLOCK_MESSAGE: 남아 있으면 작성 화면이 발송·저장 진입을 막는다(결정 D2).
 *   ⛔ 작성 화면에서 고객이 버튼을 눌렀을 때만 부른다(`SmsCharsetNotice`). 발송 경로에서 부르지 않는다(B-0910-4).
 *   ⛔ 대체표는 게이트웨이와 같은 표 하나다. 바꾸면 계약 테스트(`sms-charset-contract.test.ts`)의 해시와 게이트웨이 표를 함께 바꾼다.
 */
import { CP949_NON_HANGUL_CHARS } from './cp949Chars';

export const SMS_SAFE_CHARS: string[] = [
  '★', '☆', '♥', '♡', '◆', '◇', '■', '□', '▲', '△', '▶', '◀', '●', '○', '◎', '♤',
  '♠', '♧', '♣', '♪', '♬', '♩', '☎', '♨', '※', '☞', '↑', '↓', '←', '→', '▷', '◁',
  '▽', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '㈜', '㈔', '℡', '㉿', '㎝', '㎏', '㎡', '㎎',
];

/** 한글 2바이트 기준 바이트 수 (EUC-KR 발송 기준) */
export function koreanBytes(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    bytes += s.charCodeAt(i) > 0x7f ? 2 : 1;
  }
  return bytes;
}

/**
 * 대체표 v1 — [원래 글자, 바꿀 글자]. 바꿀 글자 '' = 지움(보이지 않는 글자).
 * 불변: 원래 글자는 전부 CP949 에 없고, 바꿀 글자는 전부 CP949 에 있다(계약 테스트가 강제).
 * 보이지 않는 글자가 섞여 있어 전부 코드로 적는다.
 */
export const SMS_CHAR_SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  // 대시: –→- —→― ‒→- ‐→- ‑→- −→-
  ['\u2013', '-'], ['\u2014', '\u2015'], ['\u2012', '-'], ['\u2010', '-'], ['\u2011', '-'], ['\u2212', '-'],
  // 불릿: •→· ∙→· ⦁→· ・→· ‣→▶ ◦→○ ▪→■ ▫→□
  ['\u2022', '\u00B7'], ['\u2219', '\u00B7'], ['\u2981', '\u00B7'], ['\u30FB', '\u00B7'], ['\u2023', '\u25B6'], ['\u25E6', '\u25CB'], ['\u25AA', '\u25A0'], ['\u25AB', '\u25A1'],
  // 체크: ✓→√ ✔→√ ✗→× ✘→×
  ['\u2713', '\u221A'], ['\u2714', '\u221A'], ['\u2717', '\u00D7'], ['\u2718', '\u00D7'],
  // 하트: ❤→♥ ❣→♥
  ['\u2764', '\u2665'], ['\u2763', '\u2665'],
  // 별: ⭐→★ ✩→☆
  ['\u2B50', '\u2605'], ['\u2729', '\u2606'],
  // 화살표: ➡→→ ➔→→ ➜→→ ⬅→← ⬆→↑ ⬇→↓ ➤→▶
  ['\u27A1', '\u2192'], ['\u2794', '\u2192'], ['\u279C', '\u2192'], ['\u2B05', '\u2190'], ['\u2B06', '\u2191'], ['\u2B07', '\u2193'], ['\u27A4', '\u25B6'],
  // 공백
  ['\u00A0', ' '],
  // 보이지 않는 글자 = 지움
  ['\u200B', ''], ['\u200C', ''], ['\u200D', ''], ['\u200E', ''], ['\u200F', ''], ['\uFEFF', ''], ['\uFE0E', ''], ['\uFE0F', ''],
];

const SUBSTITUTION_MAP = new Map<string, string>(SMS_CHAR_SUBSTITUTIONS);
let cp949Set: Set<string> | null = null;

/** 문자로 보낼 수 있는 글자인가 — ASCII · 한글 음절 전부 · CP949 표(게이트웨이 인코더와 같은 표) */
export function isSmsEncodableChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return true;
  if (cp >= 0xac00 && cp <= 0xd7a3) return true;
  if (!cp949Set) cp949Set = new Set(Array.from(CP949_NON_HANGUL_CHARS));
  return cp949Set.has(ch);
}

export interface UnsupportedSmsChar {
  char: string;
  /** 'U+2013' 형식 */
  code: string;
  count: number;
  /** 대체표에 있으면 바꿀 글자('' = 지움), 없으면 null(고객이 직접 고쳐야 한다) */
  replacement: string | null;
}

/** 문자로 보낼 수 없는 글자를 처음 나온 순서대로 모은다(같은 글자는 한 번, count 로 센다). */
export function findUnsupportedSmsChars(text: string): UnsupportedSmsChar[] {
  const found = new Map<string, UnsupportedSmsChar>();
  for (const ch of Array.from(text || '')) {
    if (isSmsEncodableChar(ch)) continue;
    const hit = found.get(ch);
    if (hit) { hit.count++; continue; }
    const rep = SUBSTITUTION_MAP.get(ch);
    found.set(ch, {
      char: ch,
      code: 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'),
      count: 1,
      replacement: rep === undefined ? null : rep,
    });
  }
  return Array.from(found.values());
}

/** 문장들 중 문자로 보낼 수 없는 글자가 하나라도 있는가 — 작성 화면의 발송 진입을 막는 데 쓴다(설계 D2). */
export function hasUnsupportedSmsChars(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => !!t && Array.from(t).some((ch) => !isSmsEncodableChar(ch)));
}

/** 발송 진입을 막을 때 보여 주는 문구. 화면마다 따로 쓰지 않는다. */
export const SMS_CHARSET_BLOCK_MESSAGE = '문자로 보낼 수 없는 글자가 있습니다. 안내에서 비슷한 글자로 바꾸거나 지운 뒤 다시 눌러 주세요.';

/** 대체표 v1 로 바꾼 문장. CP949 에 있는 글자와 표에 없는 글자는 건드리지 않는다. */
export function substituteSmsChars(text: string): string {
  let out = '';
  for (const ch of Array.from(text || '')) {
    const rep = isSmsEncodableChar(ch) ? undefined : SUBSTITUTION_MAP.get(ch);
    out += rep === undefined ? ch : rep;
  }
  return out;
}
