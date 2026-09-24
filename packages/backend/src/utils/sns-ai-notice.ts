/**
 * sns-ai-notice.ts — 이 미디어에 AI 표시 문장을 붙이는가 (2026-09-24 B-8)
 * 설계 SoT = docs/2026-09-24-sns-channel-design.md §4 B-8 · 이전 규칙 = 0917 §3-9.
 *
 * 판정 = `ai_declared OR (asset_id 있음 AND (소재 행 없음 OR 소재 kind='generated'))`.
 *   - 이미지 스튜디오에서 **만든** 소재(kind='generated')를 가져온 사진 → 붙인다.
 *   - 소재 라이브러리에 **직접 올려 둔** 사진(kind 가 generated 아님) → 붙이지 않는다(전에는 붙었다 · 0924 변경).
 *   - 소재 행이 지워져 모르면 → 붙인다(모르면 붙이는 쪽이 안전하다).
 * ⛔ 판정은 이 파일 하나. /posts 확정본 · 미디어 응답(aiNotice) · 불러와서 쓰기가 같은 SQL 조각을 쓴다.
 */

import { query } from '../config/database';

type Db = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/** `sns_media` 별칭과 `cdp_assets` LEFT JOIN 별칭을 받아 판정 조각을 만든다. */
export function snsAiNoticeSql(media: string, asset: string): string {
  return `(COALESCE(${media}.ai_declared, false) OR (${media}.asset_id IS NOT NULL AND (${asset}.id IS NULL OR ${asset}.kind = 'generated')))`;
}

/** 소재 행 JOIN(회사 조건 포함). 판정 조각과 짝으로만 쓴다. */
export function snsAiNoticeJoin(media: string, asset: string): string {
  return `LEFT JOIN cdp_assets ${asset} ON ${asset}.id = ${media}.asset_id AND ${asset}.company_id = ${media}.company_id`;
}

/** 이 미디어 묶음 중 하나라도 AI 표시 대상인가. 미디어가 없으면 false. */
export async function snsMediaNeedsAiNotice(companyId: string, mediaIds: readonly string[], db: Db = { query }): Promise<boolean> {
  if (!mediaIds.length) return false;
  const r = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM sns_media m
       ${snsAiNoticeJoin('m', 'a')}
        WHERE m.company_id = $1::uuid AND m.id = ANY($2::uuid[])
          AND ${snsAiNoticeSql('m', 'a')}
     ) AS ai`,
    [companyId, [...mediaIds]],
  );
  return !!r.rows[0]?.ai;
}

/** 미디어마다 AI 표시 대상인가(불러와서 쓰기 응답용). */
export async function snsMediaAiNoticeMap(companyId: string, mediaIds: readonly string[], db: Db = { query }): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!mediaIds.length) return out;
  const r = await db.query(
    `SELECT m.id, ${snsAiNoticeSql('m', 'a')} AS ai
       FROM sns_media m
       ${snsAiNoticeJoin('m', 'a')}
      WHERE m.company_id = $1::uuid AND m.id = ANY($2::uuid[])`,
    [companyId, [...mediaIds]],
  );
  for (const row of r.rows) out.set(String(row.id), !!row.ai);
  return out;
}
