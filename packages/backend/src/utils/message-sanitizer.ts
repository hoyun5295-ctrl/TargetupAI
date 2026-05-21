/**
 * CT-46: Message Sanitizer — D187-fix5 (2026-05-21)
 *
 * 목적
 *   한국 SMS/LMS/MMS 통신사 표준에 부합 X 단어 자동 정규화.
 *   - 이모지 자동 제거 (🎂🎉💝🌸 등 — 통신사 미지원, 발송 실패 / 깨짐 위험)
 *   - 비표준 특수문자 정규화 (— ・ ✓ ★ ※ ▶ ‣ • 등 → 표준 단어)
 *   - zero-width / BOM / non-breaking space 제거
 *
 * 사용 영역
 *   - journey-ai-generator: AI 응답 받은 후 자동 sanitize
 *   - journey-executor: 발송 직전 최후 안전망
 *   - JourneysPage frontend: 사용자 입력 검증 + 경고 표시
 *
 * 영구 룰
 *   - feedback_no_emoji_special_chars: AI 생성 / 사용자 입력 어디에도 이모지 + 비표준 특수문자 X
 *   - D102/D103 (광고)+080 컨트롤타워 정합
 */

// ════════════════════════════════════════════════════════════════════
// 이모지 유니코드 범위 (한국 통신사 SMS/LMS 미지원 매트릭스)
// ════════════════════════════════════════════════════════════════════
const EMOJI_RANGES: Array<[number, number]> = [
  [0x1F000, 0x1FFFF],  // Miscellaneous Symbols + Pictographs + Emoticons + Transport + Supplemental
  [0x2600, 0x27BF],    // Miscellaneous Symbols + Dingbats (★ ☆ ✓ ✗ ☀ ☁ 등)
  [0x2300, 0x23FF],    // Miscellaneous Technical
  [0x2B00, 0x2BFF],    // Miscellaneous Symbols and Arrows
  [0xFE00, 0xFE0F],    // Variation Selectors
  [0xE0020, 0xE007F],  // Tag Characters
];

// 조합 단어 (ZWJ 등) 제거
const COMBINING_CHARS = new Set<number>([
  0x200D,  // ZWJ
  0x20E3,  // Combining Enclosing Keycap
]);

// ════════════════════════════════════════════════════════════════════
// 비표준 특수문자 → 표준 단어 정규화 매트릭스
// ════════════════════════════════════════════════════════════════════
const SPECIAL_CHAR_MAP: Record<string, string> = {
  // dash 종류
  '—': '-',
  '–': '-',
  '‐': '-',
  '−': '-',
  '－': '-',

  // 중점/불릿
  '・': '·',
  '•': '·',
  '⦁': '·',
  '‣': '-',
  '◦': '-',
  '▪': '-',
  '▫': '-',

  // 화살표
  '▶': '>',
  '▷': '>',
  '◀': '<',
  '◁': '<',
  '►': '>',
  '◄': '<',
  '➤': '>',
  '➔': '>',
  '➜': '>',
  '➡': '>',

  // 표시 단어
  '※': '*',
  '★': '*',
  '☆': '*',
  '✓': 'V',
  '✔': 'V',
  '✗': 'X',
  '✘': 'X',
  '◆': '*',
  '◇': '*',
  '■': '*',
  '□': '*',
  '●': '*',
  '○': '*',

  // 따옴표/괄호
  '«': '<<',
  '»': '>>',
  '〈': '<',
  '〉': '>',
  '《': '<<',
  '》': '>>',
  '「': '"',
  '」': '"',
  '『': '"',
  '』': '"',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",

  // 전각 기호 (한자 영역 — 표준 단어로 정규화)
  '＆': '&',
  '％': '%',
  '＋': '+',
  '＝': '=',
  '？': '?',
  '！': '!',
  '：': ':',
  '；': ';',
  '，': ',',
  '．': '.',
  '＠': '@',
  '＃': '#',
  '＄': '$',
  '＊': '*',
  '／': '/',
  '＼': '\\',
  '｜': '|',

  // zero-width / BOM / non-breaking space
  ' ': ' ',
  '​': '',
  '‌': '',
  '‍': '',
  '‎': '',
  '‏': '',
  '﻿': '',
  ' ': '\n',
  ' ': '\n',
};

function isInRange(code: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (code >= start && code <= end) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// 핵심 함수 — sanitizeForSms (자동 정규화)
// ════════════════════════════════════════════════════════════════════

export interface SanitizeResult {
  sanitized: string;
  warnings: string[];
  hadChanges: boolean;
  removedEmojis: string[];
  replacedChars: string[];
}

export function sanitizeForSms(text: string): SanitizeResult {
  if (!text) {
    return { sanitized: '', warnings: [], hadChanges: false, removedEmojis: [], replacedChars: [] };
  }

  const warnings: string[] = [];
  const removedEmojis: string[] = [];
  const replacedChars: string[] = [];
  let result = '';

  for (const char of Array.from(text)) {
    const code = char.codePointAt(0) || 0;

    if (isInRange(code, EMOJI_RANGES)) {
      removedEmojis.push(char);
      continue;
    }

    if (COMBINING_CHARS.has(code)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(SPECIAL_CHAR_MAP, char)) {
      const replacement = SPECIAL_CHAR_MAP[char];
      result += replacement;
      if (replacement !== char) {
        replacedChars.push(`${char}${replacement || '∅'}`);
      }
      continue;
    }

    result += char;
  }

  if (removedEmojis.length > 0) {
    const unique = Array.from(new Set(removedEmojis));
    warnings.push(`이모지 ${unique.length}종 제거: ${unique.slice(0, 10).join(' ')}`);
  }
  if (replacedChars.length > 0) {
    const unique = Array.from(new Set(replacedChars));
    warnings.push(`특수문자 ${unique.length}종 정규화: ${unique.slice(0, 10).join(', ')}`);
  }

  // 연속 공백/줄바꿈 정규화 (최대 3 연속까지)
  result = result.replace(/ {3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n');

  return {
    sanitized: result,
    warnings,
    hadChanges: result !== text,
    removedEmojis,
    replacedChars,
  };
}

// ════════════════════════════════════════════════════════════════════
// 검증 only (정규화 안 함) — frontend 입력 onChange 시 경고 표시
// ════════════════════════════════════════════════════════════════════

export interface UnsafeDetectResult {
  hasUnsafe: boolean;
  hasEmoji: boolean;
  hasSpecialChars: boolean;
  emojiList: string[];
  specialCharList: string[];
}

export function detectUnsafeChars(text: string): UnsafeDetectResult {
  const emojiList: string[] = [];
  const specialCharList: string[] = [];

  if (text) {
    for (const char of Array.from(text)) {
      const code = char.codePointAt(0) || 0;
      if (isInRange(code, EMOJI_RANGES)) {
        emojiList.push(char);
      } else if (COMBINING_CHARS.has(code)) {
        emojiList.push(char);
      } else if (Object.prototype.hasOwnProperty.call(SPECIAL_CHAR_MAP, char)) {
        const replacement = SPECIAL_CHAR_MAP[char];
        if (replacement !== char) {
          specialCharList.push(char);
        }
      }
    }
  }

  const uniqueEmoji = Array.from(new Set(emojiList));
  const uniqueSpecial = Array.from(new Set(specialCharList));

  return {
    hasUnsafe: uniqueEmoji.length > 0 || uniqueSpecial.length > 0,
    hasEmoji: uniqueEmoji.length > 0,
    hasSpecialChars: uniqueSpecial.length > 0,
    emojiList: uniqueEmoji,
    specialCharList: uniqueSpecial,
  };
}
