// EUC-KR byte 길이 — 순수 코어(DB-free). 통신 규격: ASCII 1byte, 한글 등 비-ASCII 2byte.
// SMS 발송은 EUC-KR 기준이라 길이 판정도 byte 기준. journey-ai-generator/variant-generator 인라인 중복의 통합 토대.

/** 문자열의 EUC-KR 근사 byte 길이. ASCII(<128) 1byte, 그 외(한글/특수) 2byte. */
export function eucKrByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) < 128 ? 1 : 2;
  }
  return bytes;
}
