/**
 * brand-tone-evolution — Brand Voice 가이드라인 변경을 brand_tone_evolution 메모리로 누적.
 *
 * extract-guideline / update-guideline UPSERT 직전에 기존 가이드라인을 읽어두고(fetchBrandGuideline),
 * UPSERT 후 직전 값과 비교(diffGuideline)해 의미 있는 변화면 1건 기록한다.
 * 첫 등록(직전 값 없음)·무변화는 기록하지 않는다. 순수 비교 코어 = ai-memory-text.diffGuideline.
 */

import { query } from '../config/database';
import { addMemory } from './company-memory';
import { diffGuideline, GuidelineSnapshot } from './ai-memory-text';

/** 회사의 현재 brand_guideline(memory_key='main')을 GuidelineSnapshot으로 반환. 없으면 null. */
export async function fetchBrandGuideline(companyId: string): Promise<GuidelineSnapshot | null> {
  const r = await query(
    `SELECT memory_value FROM ai_company_memory
      WHERE company_id = $1::uuid AND memory_type = 'brand_guideline'
      LIMIT 1`,
    [companyId],
  );
  if (!r.rows[0]) return null;
  try {
    const raw = r.rows[0].memory_value;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * 직전 가이드라인 대비 의미 있는 변화면 brand_tone_evolution 1건 기록.
 * @returns 기록 여부(변화 없으면 false)
 */
export async function recordToneEvolution(
  companyId: string,
  prev: GuidelineSnapshot | null,
  next: GuidelineSnapshot & { extracted_at?: string },
): Promise<boolean> {
  const change = diffGuideline(prev, next);
  if (!change) return false;
  await addMemory({
    companyId,
    memoryType: 'brand_tone_evolution',
    memoryKey: `tone_change_${next.extracted_at || new Date().toISOString()}`,
    memoryValue: change.summary,
    importance: 6,
    source: 'ai_auto',
    metadata: { changed_fields: change.changedFields },
  });
  return true;
}
