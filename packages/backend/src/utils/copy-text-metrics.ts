// copy-text-metrics.ts — 문안 텍스트 메트릭(순수, 의존 0)
//   문안 두뇌 자기검수 루프의 채널 바이트·구조 판정에 쓰인다.
const CTA_HINTS = ['지금', '바로', '확인', '방문', '오세요', '받아', '신청', '예약', '클릭', '구매', '주문'];

/** 한국 SMS 바이트 길이(한글/비ASCII=2, ASCII=1). SMS 90 / LMS 2000 판정용 근사. */
export function smsByteLength(text: string): number {
  let n = 0;
  for (const ch of text || '') n += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return n;
}

export function sentenceCount(text: string): number {
  const t = String(text || '');
  if (!t.trim()) return 0;
  return t.split(/[.!?。\n]/).filter((s) => s.trim().length > 0).length || 1;
}

export function hasCta(text: string, hints: string[] = CTA_HINTS): boolean {
  const t = String(text || '');
  return hints.some((h) => t.includes(h));
}

export { CTA_HINTS };
