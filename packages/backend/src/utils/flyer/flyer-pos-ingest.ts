/**
 * ★ CT-F12 — 전단AI POS Agent 데이터 수신/정규화 컨트롤타워
 *
 * Phase B: POS Agent가 보내는 판매/재고/회원 데이터를
 * flyer_pos_sales, flyer_pos_inventory, flyer_customers에 저장.
 *
 * 설계: FLYER-POS-AGENT.md §3 서버 API 참조.
 * ⚠️ 스켈레톤 — Phase B 구현 시 채운다.
 */

import { query } from '../../config/database';
import { normalizePhone } from '../normalize-phone';

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
 * 판매 데이터 수신 + 정규화 + flyer_pos_sales INSERT.
 */
export async function ingestSales(
  companyId: string,
  agentId: string,
  items: PosSaleItem[]
): Promise<IngestResult> {
  // Phase B 구현 시 작성
  // 1. 각 item 정규화 (날짜, 금액, 회원 매칭)
  // 2. UPSERT (receipt_no + product_code + sold_at UNIQUE)
  // 3. 매칭된 customer의 purchase 통계 업데이트
  return { accepted: 0, rejected: items.length, errors: [{ index: 0, reason: 'Not implemented (Phase B)' }] };
}

/**
 * 재고 스냅샷 수신.
 */
export async function ingestInventory(
  companyId: string,
  agentId: string,
  items: PosInventoryItem[]
): Promise<IngestResult> {
  // Phase B 구현 시 작성
  return { accepted: 0, rejected: items.length, errors: [{ index: 0, reason: 'Not implemented (Phase B)' }] };
}

/**
 * 회원 수신 → flyer_customers UPSERT.
 */
export async function ingestMembers(
  companyId: string,
  agentId: string,
  members: PosMember[]
): Promise<IngestResult> {
  // Phase B 구현 시 작성
  // phone 기준 UPSERT → pos_member_id 연결
  return { accepted: 0, rejected: members.length, errors: [{ index: 0, reason: 'Not implemented (Phase B)' }] };
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
