/**
 * ★ CT-F07 — 전단AI 수신자 중복제거 컨트롤타워
 *
 * 한줄로 utils/deduplicate.ts의 normalizePhone 기반 중복제거 패턴을
 * 전단AI 발송 경로 전용으로 재사용.
 */

import { normalizePhone } from '../normalize-phone';

export interface FlyerRecipient {
  phone: string;
  [key: string]: any;
}

/**
 * phone 기준 중복제거. 정규화(normalizePhone) 후 Set으로 dedupe.
 * 앞쪽 레코드 유지, 뒤쪽 중복 제거.
 */
export function deduplicateFlyerRecipients<T extends FlyerRecipient>(recipients: T[]): T[] {
  if (!recipients || recipients.length === 0) return [];
  const seen = new Set<string>();
  const result: T[] = [];

  for (const r of recipients) {
    const normalized = normalizePhone(r.phone || '');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ ...r, phone: normalized });
  }
  return result;
}

/**
 * 중복제거 결과 통계.
 */
export function deduplicateWithStats<T extends FlyerRecipient>(
  recipients: T[]
): { deduplicated: T[]; originalCount: number; removedCount: number } {
  const originalCount = recipients?.length || 0;
  const deduplicated = deduplicateFlyerRecipients(recipients);
  return {
    deduplicated,
    originalCount,
    removedCount: originalCount - deduplicated.length,
  };
}
