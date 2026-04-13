/**
 * ★ CT-F11 — 전단AI 상품 카탈로그 컨트롤타워
 *
 * Phase A 기능 15번: 한 번 만든 상품을 재사용 자산화.
 * flyer_catalog 테이블 기반 CRUD + 인기 정렬 + POS 연동 매핑.
 *
 * ⚠️ 스켈레톤 — Phase A 구현 시 채운다.
 */

import { query } from '../../../config/database';

export interface CatalogItem {
  id: string;
  company_id: string;
  product_name: string;
  category: string | null;
  default_price: number | null;
  image_url: string | null;
  description: string | null;
  usage_count: number;
  pos_product_code: string | null;
}

/**
 * 카탈로그 목록 (usage_count 내림차순 = 자주 쓴 순).
 */
export async function getCatalogItems(
  companyId: string,
  options: { category?: string; search?: string; limit?: number; offset?: number } = {}
): Promise<{ items: CatalogItem[]; total: number }> {
  const conditions = [`company_id = $1`];
  const params: any[] = [companyId];

  if (options.category) {
    params.push(options.category);
    conditions.push(`category = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`product_name ILIKE $${params.length}`);
  }

  const where = conditions.join(' AND ');
  const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM flyer_catalog WHERE ${where}`, params);

  const limit = Math.min(500, options.limit || 100);
  params.push(limit, options.offset || 0);
  const listRes = await query(
    `SELECT * FROM flyer_catalog WHERE ${where}
     ORDER BY usage_count DESC, created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { items: listRes.rows, total: countRes.rows[0]?.cnt || 0 };
}

/**
 * 전단지에 상품 사용 시 usage_count +1.
 */
export async function touchCatalogUsage(itemId: string): Promise<void> {
  await query(
    `UPDATE flyer_catalog SET usage_count = usage_count + 1, last_used_at = NOW() WHERE id = $1`,
    [itemId]
  );
}

/**
 * 카탈로그 아이템 추가/업데이트 (UPSERT by product_name).
 */
export async function upsertCatalogItem(
  companyId: string,
  item: Partial<CatalogItem>
): Promise<string> {
  // UNIQUE 제약 없으므로 기존 항목 검색 후 INSERT or UPDATE
  const existing = await query(
    `SELECT id FROM flyer_catalog WHERE company_id = $1 AND product_name = $2 LIMIT 1`,
    [companyId, item.product_name]
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE flyer_catalog SET
         category = COALESCE($2, category),
         default_price = COALESCE($3, default_price),
         image_url = COALESCE($4, image_url),
         description = COALESCE($5, description),
         pos_product_code = COALESCE($6, pos_product_code),
         updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, item.category || null, item.default_price || null,
       item.image_url || null, item.description || null, item.pos_product_code || null]
    );
    return existing.rows[0].id;
  }

  const result = await query(
    `INSERT INTO flyer_catalog (id, company_id, product_name, category, default_price, image_url, description, pos_product_code)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [companyId, item.product_name, item.category || null, item.default_price || null,
     item.image_url || null, item.description || null, item.pos_product_code || null]
  );
  return result.rows[0].id;
}
