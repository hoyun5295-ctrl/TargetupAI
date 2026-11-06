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

// ★ 2026-09-26 한줄로 V2 m068 — 보낼 수 있는 글자 판정(게이트웨이 CP949 표) · 발송 경로 정리가 쓴다
import { isSmsEncodableChar } from './sms-charset';
import { UserFacingError } from './http-error';

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
// ★ 2026-11-06 C109 · B-1106-1 — 「문자로 보낼 수 없는 글자」 분류 CT 하나(설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §2-1 · 뿌리 R1)
//   보낼 수 있음(게이트웨이 표) = 그대로 · 보낼 수 없음 = 뺌(이모지 범위 · 결합) · 바꿈(바꿈 표) · 막음(그 밖).
//   이 분류 = 여정 발송 정리(sanitizeUnsendableForSms)가 쓰던 순서 그대로(새 규칙 0). 지우는 · 바꾸는 · 판정하는 자리는 전부 이 함수를 지난다.
// ════════════════════════════════════════════════════════════════════

export type SmsCharAction =
  | { action: 'keep' }
  | { action: 'remove'; kind: 'emoji' | 'combining' }
  | { action: 'replace'; to: string }
  | { action: 'block' };

/** 한 글자를 어떻게 다루나(보낼 수 있음 → 이모지 범위 → 결합 → 바꿈 표 → 막음) */
export function smsCharAction(ch: string): SmsCharAction {
  if (isSmsEncodableChar(ch)) return { action: 'keep' };
  const code = ch.codePointAt(0) || 0;
  if (isInRange(code, EMOJI_RANGES)) return { action: 'remove', kind: 'emoji' };
  if (COMBINING_CHARS.has(code)) return { action: 'remove', kind: 'combining' };
  if (Object.prototype.hasOwnProperty.call(SPECIAL_CHAR_MAP, ch)) return { action: 'replace', to: SPECIAL_CHAR_MAP[ch] };
  return { action: 'block' };
}

export interface SmsCharFinding {
  char: string;
  /** 'U+1F60A' 꼴 */
  code: string;
  action: 'remove' | 'replace' | 'block';
  removeKind?: 'emoji' | 'combining';
  to?: string;
  /** 1부터 · '\n' 기준 */
  line: number;
  /** 그 글자 앞 같은 줄의 보낼 수 있는 글자 최대 8자(줄 맨 앞이면 '') */
  before: string;
}

const BEFORE_MAX = 8;
const codeOf = (ch: string) => 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');

/** 글을 훑는다 — cleaned = 뺌 글자만 빠지고 바꿈 적용 · 막음 글자는 남는다(= 여정 발송 정리와 같은 글) */
export function scanSmsText(text: string): { cleaned: string; findings: SmsCharFinding[]; multiline: boolean } {
  const findings: SmsCharFinding[] = [];
  let cleaned = '';
  let line = 1;
  let before = '';
  const src = String(text ?? '');
  for (const ch of Array.from(src)) {
    if (ch === '\n') { line += 1; before = ''; cleaned += ch; continue; }
    const a = smsCharAction(ch);
    if (a.action === 'keep') {
      cleaned += ch;
      before = (before + ch).slice(-BEFORE_MAX);
      continue;
    }
    const base = { char: ch, code: codeOf(ch), line, before: before.trim() };
    if (a.action === 'remove') { findings.push({ ...base, action: 'remove', removeKind: a.kind }); continue; }
    if (a.action === 'replace') {
      findings.push({ ...base, action: 'replace', to: a.to });
      cleaned += a.to;
      before = (before + a.to).slice(-BEFORE_MAX);
      continue;
    }
    findings.push({ ...base, action: 'block' });
    cleaned += ch;
  }
  return { cleaned, findings, multiline: src.includes('\n') };
}

/** AI 글 · 검사 입력 치환 값 정리 = 뺌 · 바꿈 적용 + 막음 글자도 뺀다(결과 = 보낼 수 있는 글자만) */
export function cleanSmsTextAll(text: string): string {
  let out = '';
  for (const ch of Array.from(String(text ?? ''))) {
    const a = smsCharAction(ch);
    if (a.action === 'keep') out += ch;
    else if (a.action === 'replace') {
      // 바꿈 표의 결과도 보낼 수 있는 글자만 남긴다(표 = 사람이 만든 목록 · 결과가 표 밖이면 뺀다)
      for (const t of Array.from(a.to)) if (isSmsEncodableChar(t) || t === '\n') out += t;
    }
  }
  return out;
}

function findingName(f: SmsCharFinding): string {
  if (f.action === 'block') return '보낼 수 없는 글자';
  if (f.action === 'remove') return f.removeKind === 'emoji' ? '이모지' : '보이지 않는 글자';
  return f.to === '' ? '보이지 않는 글자' : '특수 기호';
}

/**
 * 위치 문장(P4) — `3번째 줄 '여름 세일' 뒤 이모지(U+1F60A)` · where 가 있으면 그 말이 앞에(`명단 3행 이름 칸 ...`).
 *   문장에는 그 글자를 넣지 않는다(이 문장이 문자로 나간다) · 같은 글자 · 줄 · 앞 글자는 한 번 · max 넘으면 `외 n곳`.
 */
export function describeSmsCharFindings(findings: SmsCharFinding[], opts: { max?: number; where?: string; multiline?: boolean } = {}): string[] {
  const max = Math.max(1, opts.max ?? 5);
  const seen = new Set<string>();
  const uniq = findings.filter((f) => {
    const k = `${f.code}|${f.line}|${f.before}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const lines = uniq.slice(0, max).map((f) => {
    const at = f.before ? `'${f.before}' 뒤` : '맨 앞';
    // 여러 줄 글 = 줄 번호 · 한 줄 칸(제목 · 명단 칸)에 이름이 붙으면 그 이름만
    const where = opts.where && !opts.multiline ? opts.where : `${opts.where ? `${opts.where} ` : ''}${f.line}번째 줄`;
    return `${where} ${at} ${findingName(f)}(${f.code})`;
  });
  if (uniq.length > max) lines.push(`외 ${uniq.length - max}곳`);
  return lines;
}

/** 칸마다 보낼 수 없는 글자의 위치 문장(쉼표로 이음 · 없으면 null · 관문 · 나가는 글 판정 공용 · P4) */
export function smsTextPlaces(fields: Array<{ label: string; text: string | null | undefined }>): string | null {
  const parts: string[] = [];
  for (const f of fields) {
    if (!f.text) continue;
    const s = scanSmsText(f.text);
    if (s.findings.length === 0) continue;
    parts.push(...describeSmsCharFindings(s.findings, { where: f.label, multiline: s.multiline, max: 3 }));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** 사람 글 화면 저장 관문(Harold ② · 뺌 · 바꿈 · 막음 전부) — 보낼 수 없는 글자가 있으면 문장 · 없으면 null */
export function smsTextBlockReason(fields: Array<{ label: string; text: string | null | undefined }>): string | null {
  const places = smsTextPlaces(fields);
  return places ? `문자로 보낼 수 없는 글자가 있어요: ${places}. 그 글자를 빼고 다시 저장해 주세요.` : null;
}

/** 위 관문 · 있으면 400 UNSUPPORTED_CHARS(라우트 catch 의 respondUserError 가 문장 그대로 내보낸다) */
export function assertSmsTextSendable(fields: Array<{ label: string; text: string | null | undefined }>): void {
  const reason = smsTextBlockReason(fields);
  if (reason) throw new UserFacingError(400, 'UNSUPPORTED_CHARS', reason);
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
  const blockedChars: string[] = [];
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

    // ★ 2026-11-06 C109 S2 — 표에 없는 보낼 수 없는 글자(막음 · smsCharAction 'block')도 뺀다(이 함수 = AI 글 정리 · 옛: 남겨 검사 반려 · 9401)
    if (smsCharAction(char).action === 'block') {
      blockedChars.push(char);
      continue;
    }

    result += char;
  }

  if (removedEmojis.length > 0) {
    const unique = Array.from(new Set(removedEmojis));
    warnings.push(`이모지 ${unique.length}종 제거: ${unique.slice(0, 10).join(' ')}`);
  }
  if (blockedChars.length > 0) {
    warnings.push(`보낼 수 없는 글자 ${new Set(blockedChars).size}종 제거`);
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
// ★ 2026-09-26 한줄로 V2 m068(B-0910-5) — 발송 직전 정리: 보낼 수 없는 글자만
// ════════════════════════════════════════════════════════════════════

/**
 * 발송 경로 전용 정리. **문자로 보낼 수 있는 글자(ASCII · 한글 · CP949 표)는 한 글자도 바꾸지 않는다.**
 * 보낼 수 없는 글자에만 `sanitizeForSms`와 같은 규칙(이모지·보이지 않는 글자 제거 · 표의 글자 바꿈)을 쓴다.
 * 공백·줄바꿈 정리는 하지 않는다(고객이 쓴 모양 그대로).
 *
 * 왜: 여정 실행기가 사람이 쓴 문안에 `sanitizeForSms`를 돌려 `★ ♥ ☎`을 지우고 `▶→>` `※→*` `“”→"`로 바꿨다.
 *   이 글자들은 게이트웨이 CP949 인코더가 그대로 보낸다(고객 문안은 우리가 바꾸지 않는다 · B-0910-4와 같은 부류).
 * AI 생성 경로(생성 직후 정리)는 이번 축 밖이라 `sanitizeForSms` 그대로 쓴다.
 */
export function sanitizeUnsendableForSms(text: string): SanitizeResult {
  if (!text) {
    return { sanitized: '', warnings: [], hadChanges: false, removedEmojis: [], replacedChars: [] };
  }

  const removedEmojis: string[] = [];
  const replacedChars: string[] = [];
  // ★ 2026-11-06 C109 — 분류 = smsCharAction 한 곳(옛 본문의 순서 · 규칙 그대로 · 출력 대조 = c109-chars-contract K1)
  const { cleaned: result, findings } = scanSmsText(text);
  for (const f of findings) {
    if (f.action === 'remove' && f.removeKind === 'emoji') removedEmojis.push(f.char);
    else if (f.action === 'replace' && f.to !== f.char) replacedChars.push(`${f.char}${f.to || '∅'}`);
  }

  const warnings: string[] = [];
  if (removedEmojis.length > 0) {
    const unique = Array.from(new Set(removedEmojis));
    warnings.push(`보낼 수 없는 이모지 ${unique.length}종 제거: ${unique.slice(0, 10).join(' ')}`);
  }
  if (replacedChars.length > 0) {
    const unique = Array.from(new Set(replacedChars));
    warnings.push(`보낼 수 없는 특수문자 ${unique.length}종 바꿈: ${unique.slice(0, 10).join(', ')}`);
  }

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

// ════════════════════════════════════════════════════════════════════
// ★ D210+ Phase 2 (Harold 명시 2026-05-23): 미처리 변수 검출.
//   발송 직전 sanitize 단계에서 `{{ var }}` / `%변수%` 잔존 영역 검출 → 발송 차단 의무.
//   본질 = "%고객명%님" 그대로 발송 사고 차단 (Harold 명시: 어설픈 개인화 = 신뢰 파괴).
//
//   영구 룰 정합 = feedback_ai_no_arbitrary_benefit.
// ════════════════════════════════════════════════════════════════════

/**
 * 텍스트 안 미처리 변수 검출.
 *   - Liquid 변수 출력: {{ customer.name }} / {{ var | default: '...' }}
 *   - Liquid 태그: {% if %} / {% else %} / {% endif %}
 *   - 한글/영문 변수: %고객명% / %name% (10% 같은 숫자% 영역 제외)
 *
 * 반환 = 검출된 패턴 배열 (빈 배열 = 안전).
 */
export function detectUnresolvedVariables(text: string): string[] {
  if (!text) return [];

  // Liquid 변수 출력
  const liquidVars = text.match(/\{\{[^}]*\}\}/g) || [];
  // Liquid 태그 (if/else/endif/for 등)
  const liquidTags = text.match(/\{%[^%]*%\}/g) || [];
  // %변수% 영역 — 한글/영문/_ 시작 (10% 같은 숫자% 제외)
  const percentVars = text.match(/%[가-힣A-Za-z_][\w가-힣]*%/g) || [];

  return [...liquidVars, ...liquidTags, ...percentVars];
}

/**
 * 미처리 변수 잔존 영역 검증 — 발송 직전 호출 의무.
 *   true = 잔존 = 차단 의무.
 *   false = 안전 = 발송 가능.
 */
export function hasUnresolvedVariables(text: string): boolean {
  return detectUnresolvedVariables(text).length > 0;
}
