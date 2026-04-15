/**
 * ★ CT-F12 — 전단AI POS Agent 데이터 수신/정규화 컨트롤타워
 *
 * POS Agent가 보내는 판매/재고/회원 데이터를
 * flyer_pos_sales, flyer_pos_inventory, flyer_customers에 저장.
 *
 * 설계: FLYER-POS-AGENT.md §3 서버 API, FLYER-POS-AGENT-DEV.md
 */

import { query } from '../../../config/database';
import { normalizePhone } from '../../normalize-phone';

export interface PosSaleItem {
  receipt_no: string;
  sold_at: string; // ISO datetime
  product_code: string;
  product_name: string;
  category?: string;
  quantity?: number;
  unit_price?: number;
  sale_price?: number;
  total_amount?: number;
  cost_price?: number;
  pos_member_id?: string;
  raw?: Record<string, any>;
}

export interface PosInventoryItem {
  product_code: string;
  product_name: string;
  category?: string;
  current_stock?: number;
  unit?: string;
  cost_price?: number;
  sale_price?: number;
  expiry_date?: string;
  raw?: Record<string, any>;
}

export interface PosMember {
  pos_member_id: string;
  name?: string;
  phone?: string;
  gender?: string;
  birth_date?: string;
  grade?: string;
  points?: number;
  total_purchase?: number;
  last_purchase_at?: string;
  sms_opt_in?: boolean;
}

export interface IngestResult {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; reason: string }>;
}

/**
 * POS Agent 인증 (agent_key 검증).
 */
export async function verifyPosAgent(agentKey: string): Promise<{
  companyId: string; agentId: string;
} | null> {
  const result = await query(
    `SELECT pa.id, pa.company_id
     FROM flyer_pos_agents pa
     WHERE pa.agent_key = $1
       AND EXISTS (SELECT 1 FROM flyer_companies fc WHERE fc.id = pa.company_id AND fc.deleted_at IS NULL)`,
    [agentKey]
  );
  if (result.rows.length === 0) return null;
  return { companyId: result.rows[0].company_id, agentId: result.rows[0].id };
}

/**
 * ★ 판매 데이터 수신 + 정규화 + flyer_pos_sales UPSERT.
 *
 * - receipt_no + product_code + sold_at UNIQUE 기준 중복 방지
 * - 매칭된 회원의 구매 통계 자동 업데이트
 * - 카탈로그 자동 등록 (신상품 감지)
 */
export async function ingestSales(
  companyId: string,
  agentId: string,
  items: PosSaleItem[]
): Promise<IngestResult> {
  let accepted = 0;
  let rejected = 0;
  const errors: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (!item.receipt_no || !item.sold_at) {
        rejected++;
        errors.push({ index: i, reason: 'receipt_no와 sold_at 필수' });
        continue;
      }

      // 판매 데이터 UPSERT
      await query(
        `INSERT INTO flyer_pos_sales
           (company_id, pos_agent_id, receipt_no, sold_at,
            product_code, product_name, category,
            quantity, unit_price, sale_price, total_amount, cost_price,
            pos_member_id, pos_raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (company_id, receipt_no, product_code, sold_at)
         DO UPDATE SET
           quantity = EXCLUDED.quantity,
           sale_price = EXCLUDED.sale_price,
           total_amount = EXCLUDED.total_amount,
           pos_raw = EXCLUDED.pos_raw`,
        [
          companyId, agentId,
          item.receipt_no, item.sold_at,
          item.product_code || '', item.product_name || '',
          item.category || null,
          item.quantity || 1, item.unit_price || 0,
          item.sale_price || 0, item.total_amount || 0,
          item.cost_price || null,
          item.pos_member_id || null,
          item.raw ? JSON.stringify(item.raw) : null,
        ]
      );

      // 회원 매칭 시 구매 통계 업데이트
      if (item.pos_member_id) {
        await query(
          `UPDATE flyer_customers
           SET total_purchase_amount = COALESCE(total_purchase_amount, 0) + $3,
               purchase_count = COALESCE(purchase_count, 0) + 1,
               last_purchase_at = GREATEST(last_purchase_at, $4::timestamptz),
               updated_at = NOW()
           WHERE company_id = $1 AND pos_member_id = $2`,
          [companyId, item.pos_member_id, item.total_amount || item.sale_price || 0, item.sold_at]
        );
      }

      // 카탈로그 자동 등록 (신상품)
      if (item.product_code && item.product_name) {
        await query(
          `INSERT INTO flyer_catalog (company_id, product_name, category, default_price, pos_product_code)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (company_id, pos_product_code) WHERE pos_product_code IS NOT NULL
           DO UPDATE SET
             default_price = EXCLUDED.default_price,
             updated_at = NOW()`,
          [companyId, item.product_name, item.category || '기타', item.sale_price || item.unit_price || 0, item.product_code]
        );
      }

      accepted++;
    } catch (err: any) {
      rejected++;
      errors.push({ index: i, reason: err.message });
    }
  }

  return { accepted, rejected, errors: errors.slice(0, 20) }; // 에러 최대 20건
}

/**
 * ★ 재고 스냅샷 수신 + 재고부족/유통기한 자동 감지.
 */
export async function ingestInventory(
  companyId: string,
  agentId: string,
  items: PosInventoryItem[]
): Promise<IngestResult> {
  let accepted = 0;
  let rejected = 0;
  const errors: Array<{ index: number; reason: string }> = [];

  const snapshotAt = new Date().toISOString();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (!item.product_code) {
        rejected++;
        errors.push({ index: i, reason: 'product_code 필수' });
        continue;
      }

      const currentStock = item.current_stock ?? 0;
      const isLowStock = currentStock <= 5 && currentStock >= 0;

      let isExpiringSoon = false;
      if (item.expiry_date) {
        const expiry = new Date(item.expiry_date);
        const now = new Date();
        const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        isExpiringSoon = diffDays <= 7 && diffDays >= 0;
      }

      await query(
        `INSERT INTO flyer_pos_inventory
           (company_id, product_code, product_name, category,
            current_stock, unit, cost_price, sale_price, expiry_date,
            is_low_stock, is_expiring_soon, snapshot_at, pos_raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (company_id, product_code, snapshot_at)
         DO UPDATE SET
           current_stock = EXCLUDED.current_stock,
           is_low_stock = EXCLUDED.is_low_stock,
           is_expiring_soon = EXCLUDED.is_expiring_soon`,
        [
          companyId, item.product_code, item.product_name || '', item.category || null,
          currentStock, item.unit || null,
          item.cost_price || null, item.sale_price || null, item.expiry_date || null,
          isLowStock, isExpiringSoon, snapshotAt,
          item.raw ? JSON.stringify(item.raw) : null,
        ]
      );

      accepted++;
    } catch (err: any) {
      rejected++;
      errors.push({ index: i, reason: err.message });
    }
  }

  return { accepted, rejected, errors: errors.slice(0, 20) };
}

/**
 * ★ 회원 수신 → flyer_customers UPSERT (phone 기준).
 *
 * - 전화번호 정규화 후 매칭
 * - pos_member_id 연결
 * - 마스킹된 번호 자동 스킵 + 경고
 */
export async function ingestMembers(
  companyId: string,
  agentId: string,
  members: PosMember[]
): Promise<IngestResult> {
  let accepted = 0;
  let rejected = 0;
  const errors: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    try {
      if (!m.pos_member_id) {
        rejected++;
        errors.push({ index: i, reason: 'pos_member_id 필수' });
        continue;
      }

      // 전화번호 정규화
      const phone = m.phone ? normalizePhone(m.phone) : null;

      // 마스킹된 전화번호 감지 → 스킵
      if (m.phone && /\*/.test(m.phone)) {
        rejected++;
        errors.push({ index: i, reason: `마스킹된 전화번호: ${m.phone}` });
        continue;
      }

      if (!phone) {
        // 전화번호 없어도 pos_member_id로 기존 고객 업데이트 시도
        const existing = await query(
          `SELECT id FROM flyer_customers WHERE company_id = $1 AND pos_member_id = $2 LIMIT 1`,
          [companyId, m.pos_member_id]
        );
        if (existing.rows.length > 0) {
          await query(
            `UPDATE flyer_customers SET
               name = COALESCE($3, name),
               gender = COALESCE($4, gender),
               pos_grade = COALESCE($5, pos_grade),
               pos_points = COALESCE($6, pos_points),
               updated_at = NOW()
             WHERE id = $2`,
            [companyId, existing.rows[0].id, m.name, normalizeGender(m.gender), m.grade, m.points]
          );
          accepted++;
        } else {
          rejected++;
          errors.push({ index: i, reason: '유효한 전화번호 없음' });
        }
        continue;
      }

      // phone 기준 UPSERT
      await query(
        `INSERT INTO flyer_customers
           (company_id, phone, name, gender, birth_date,
            pos_member_id, pos_grade, pos_points,
            total_purchase_amount, last_purchase_at,
            sms_opt_in, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pos_sync')
         ON CONFLICT (company_id, phone) WHERE deleted_at IS NULL
         DO UPDATE SET
           name = COALESCE(EXCLUDED.name, flyer_customers.name),
           gender = COALESCE(EXCLUDED.gender, flyer_customers.gender),
           birth_date = COALESCE(EXCLUDED.birth_date, flyer_customers.birth_date),
           pos_member_id = COALESCE(EXCLUDED.pos_member_id, flyer_customers.pos_member_id),
           pos_grade = COALESCE(EXCLUDED.pos_grade, flyer_customers.pos_grade),
           pos_points = COALESCE(EXCLUDED.pos_points, flyer_customers.pos_points),
           total_purchase_amount = COALESCE(EXCLUDED.total_purchase_amount, flyer_customers.total_purchase_amount),
           last_purchase_at = GREATEST(EXCLUDED.last_purchase_at, flyer_customers.last_purchase_at),
           updated_at = NOW()`,
        [
          companyId, phone,
          m.name || null, normalizeGender(m.gender), m.birth_date || null,
          m.pos_member_id, m.grade || null, m.points || null,
          m.total_purchase || null, m.last_purchase_at || null,
          m.sms_opt_in !== false, // 기본 true
        ]
      );

      accepted++;
    } catch (err: any) {
      rejected++;
      errors.push({ index: i, reason: err.message });
    }
  }

  return { accepted, rejected, errors: errors.slice(0, 20) };
}

/**
 * Agent 하트비트 업데이트.
 */
export async function updateAgentHeartbeat(
  agentId: string,
  lastSyncAt: string,
  pendingCount: number,
  errorCount24h: number
): Promise<void> {
  await query(
    `UPDATE flyer_pos_agents SET
       last_heartbeat = NOW(),
       last_sync_at = $2,
       sync_status = CASE WHEN $4 > 5 THEN 'error' ELSE 'connected' END,
       updated_at = NOW()
     WHERE id = $1`,
    [agentId, lastSyncAt, pendingCount, errorCount24h]
  );
}

/**
 * ★ POS 판매 데이터 기반 인기 상품 TOP N 추천.
 * 최근 period일간 판매 수량 기준 정렬.
 */
export async function getTopSellingProducts(
  companyId: string,
  limit: number = 20,
  period: number = 30
): Promise<Array<{ product_name: string; product_code: string; category: string | null; total_qty: number; total_amount: number; avg_price: number; image_url: string | null }>> {
  const result = await query(
    `SELECT
       s.product_name,
       s.product_code,
       s.category,
       SUM(s.quantity) AS total_qty,
       SUM(s.total_amount) AS total_amount,
       ROUND(AVG(s.sale_price)) AS avg_price,
       (SELECT c.image_url FROM flyer_catalog c WHERE c.company_id = $1 AND c.product_name = s.product_name LIMIT 1) AS image_url
     FROM flyer_pos_sales s
     WHERE s.company_id = $1
       AND s.sold_at >= NOW() - ($3 || ' days')::INTERVAL
       AND s.product_name IS NOT NULL AND s.product_name != ''
     GROUP BY s.product_name, s.product_code, s.category
     ORDER BY total_qty DESC
     LIMIT $2`,
    [companyId, limit, String(period)]
  );
  return result.rows.map(r => ({
    product_name: r.product_name,
    product_code: r.product_code,
    category: r.category,
    total_qty: Number(r.total_qty),
    total_amount: Number(r.total_amount),
    avg_price: Number(r.avg_price),
    image_url: r.image_url,
  }));
}

/**
 * ★ POS Agent 상태 목록 (슈퍼관리자 대시보드용).
 */
export async function getPosAgentStatusList(): Promise<Array<{
  agentId: string; companyId: string; companyName: string; storeName: string;
  syncStatus: string; lastSyncAt: string | null; lastHeartbeat: string | null;
  posType: string; dbType: string; errorCount: number;
}>> {
  const result = await query(
    `SELECT pa.id AS agent_id, pa.company_id,
            fc.company_name, fu.store_name,
            pa.sync_status, pa.last_sync_at, pa.last_heartbeat,
            pa.pos_type, pa.db_type,
            (SELECT COUNT(*) FROM flyer_pos_sales ps
             WHERE ps.pos_agent_id = pa.id AND ps.created_at >= NOW() - INTERVAL '24 hours') AS recent_sales
     FROM flyer_pos_agents pa
     JOIN flyer_companies fc ON fc.id = pa.company_id
     LEFT JOIN flyer_users fu ON fu.company_id = pa.company_id AND fu.role = 'flyer_admin' LIMIT 1
     ORDER BY pa.last_heartbeat DESC NULLS LAST`
  );
  return result.rows.map(r => ({
    agentId: r.agent_id,
    companyId: r.company_id,
    companyName: r.company_name || '',
    storeName: r.store_name || '',
    syncStatus: r.sync_status || 'unknown',
    lastSyncAt: r.last_sync_at,
    lastHeartbeat: r.last_heartbeat,
    posType: r.pos_type || '',
    dbType: r.db_type || '',
    errorCount: Number(r.recent_sales) || 0,
  }));
}

// ============================================================
// ★ Phase 4: 할인/행사 정보 수신 (POS Agent → flyer_pos_promotions)
// ============================================================

export interface PosPromotionItem {
  product_code: string;
  product_name: string;
  original_price?: number;
  promo_price: number;
  promo_type?: string; // 'discount' | 'bogo' | 'bundle' etc.
  starts_at?: string; // ISO datetime
  ends_at?: string;
}

export async function ingestPromotions(
  companyId: string,
  posAgentId: string,
  items: PosPromotionItem[],
): Promise<{ accepted: number; rejected: number; errors: any[] }> {
  let accepted = 0;
  let rejected = 0;
  const errors: any[] = [];

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    try {
      if (!p.product_name || !p.promo_price) {
        rejected++;
        errors.push({ index: i, reason: '상품명/할인가 누락' });
        continue;
      }

      await query(
        `INSERT INTO flyer_pos_promotions
           (company_id, pos_agent_id, product_code, product_name,
            original_price, promo_price, promo_type, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (company_id, product_code, starts_at) DO UPDATE SET
           promo_price = EXCLUDED.promo_price,
           ends_at = EXCLUDED.ends_at,
           is_processed = false`,
        [
          companyId, posAgentId,
          p.product_code || null, p.product_name,
          p.original_price || null, p.promo_price,
          p.promo_type || 'discount',
          p.starts_at || new Date().toISOString(),
          p.ends_at || null,
        ]
      );
      accepted++;
    } catch (err: any) {
      rejected++;
      errors.push({ index: i, reason: err.message });
    }
  }

  return { accepted, rejected, errors: errors.slice(0, 20) };
}

/**
 * 성별 코드 정규화
 */
function normalizeGender(gender?: string): string | null {
  if (!gender) return null;
  const g = gender.trim().toUpperCase();
  if (['M', '남', '남성', '1', 'MALE'].includes(g)) return 'M';
  if (['F', '여', '여성', '2', 'FEMALE'].includes(g)) return 'F';
  return null;
}
