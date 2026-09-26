/**
 * sms-charset.ts — 문자로 보낼 수 있는 글자인가 · 서버 판정 컨트롤타워 (★ 2026-09-26 한줄로 V2 m068)
 *
 * 화면 판정 = frontend `utils/smsSafeChars.ts isSmsEncodableChar`와 같은 식·같은 표(게이트웨이 CP949 인코더 표).
 * 설계 = docs/2026-09-10-unsupported-char-substitution-design.md §4-2(백엔드 CT) · 불변 2(CP949에 있는 글자는 바꾸지 않는다).
 * 소비처 = `message-sanitizer.sanitizeUnsendableForSms`(여정 발송 직전 정리가 보낼 수 있는 글자를 건드리지 않게).
 */
import { CP949_NON_HANGUL_CHARS } from './cp949-chars';

let cp949Set: Set<string> | null = null;

/** 문자로 보낼 수 있는 글자인가 — ASCII · 한글 음절 전부 · CP949 표 */
export function isSmsEncodableChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return true;
  if (cp >= 0xac00 && cp <= 0xd7a3) return true;
  if (!cp949Set) cp949Set = new Set(Array.from(CP949_NON_HANGUL_CHARS));
  return cp949Set.has(ch);
}
