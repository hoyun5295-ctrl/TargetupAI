/**
 * smsSafeChars.ts — SMS/LMS 발송 안전 자산 컨트롤타워
 *
 * SMS_SAFE_CHARS: EUC-KR 인코딩 지원이 확인된 특수문자 목록 (D152 검증 세트).
 *   소비처 = Dashboard 특수문자 모달 + MessageEditorModal 특수문자함. 목록 변경은 이 파일 1곳만.
 * koreanBytes: 한글 2바이트 기준 바이트 계산 (backend calculateKoreanBytes와 동일 기준).
 */

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

/** EUC-KR에서 깨질 가능성이 높은 문자 감지 — 서로게이트 쌍 이모지 + variation selector + ZWJ */
export function hasIncompatibleEmoji(s: string): boolean {
  const surrogatePair = new RegExp('[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]');
  const invisibleJoiners = new RegExp('[\\uFE0F\\u200D]');
  return surrogatePair.test(s) || invisibleJoiners.test(s);
}
