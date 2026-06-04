/**
 * 진입 원장(Entry Ledger) — 신규가입 여정이 "전에 본 적 없는 고객"만 진입시키는 단일 컨트롤타워.
 *
 * 핵심: created_at·customer_id에 의존하지 않고, 시스템이 고객을 식별하는 그 키
 *   (회사 + 매장코드 + 전화번호 = customer-upsert 충돌 키)로 "전에 본 적 있나"를 직접 기록한다.
 *   - 활성화 때 그 시점 전체 고객 식별자를 'baseline'으로 1회 적재 → 그 후 원장에 없는 식별자만 신규.
 *   - 진입 시 'entered' 기록(같은 트랜잭션).
 *   - created_at이 어디서 바뀌든·id가 바뀌든·전체삭제 후 재업로드든 무관(전화번호가 원장에 남음).
 *   - journeys에 FK CASCADE(여정 삭제 시 정리), customers에는 FK 안 검(고객 삭제돼도 기억 보존).
 *
 * 검증된 컬럼(information_schema 2026-06-04):
 *   customers.company_id(uuid)·store_code(varchar,null)·phone(varchar,NOT NULL).
 *   journey_entry_ledger·journeys.entry_baseline_at = 본 재설계 마이그레이션으로 생성.
 */

import { query } from '../config/database';

/**
 * 신규가입 추출용 안티조인 SQL 조각 — 원장에 없는 고객 식별자만 통과.
 * 시스템 upsert 키(회사+매장코드+전화번호)와 동일 기준. 파라미터는 journeyId 1개(호출부 $N 재사용).
 */
export function buildLedgerAntiJoin(custAlias: string, journeyParamIndex: number): string {
  const a = custAlias;
  return (
    `NOT EXISTS (SELECT 1 FROM journey_entry_ledger l ` +
    `WHERE l.journey_id = $${journeyParamIndex} ` +
    `AND l.company_id = ${a}.company_id ` +
    `AND COALESCE(l.store_code, '__NONE__') = COALESCE(${a}.store_code, '__NONE__') ` +
    `AND l.phone = ${a}.phone)`
  );
}

/**
 * 활성화 시점 baseline 적재 — 그 시점 회사 전체 고객 식별자를 'baseline'으로 1회.
 * 멱등(ON CONFLICT DO NOTHING). entry_baseline_at은 아직 NULL일 때만 설정(첫 활성화 1회).
 */
export async function seedBaselineForJourney(journeyId: string, companyId: string): Promise<{ seeded: number }> {
  const r = await query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     SELECT $1::uuid, c.company_id, c.store_code, c.phone, 'baseline'
       FROM customers c
      WHERE c.company_id = $2::uuid AND c.phone IS NOT NULL AND c.phone <> ''
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId],
  );
  await query(
    `UPDATE journeys SET entry_baseline_at = NOW() WHERE id = $1::uuid AND entry_baseline_at IS NULL`,
    [journeyId],
  );
  return { seeded: r.rowCount || 0 };
}

/**
 * 진입 기록 — 호출부 트랜잭션 client로 execution INSERT와 원자 처리.
 * 멱등(ON CONFLICT DO NOTHING) — 같은 식별자 중복 진입 차단.
 */
export async function recordEnteredWithClient(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  journeyId: string,
  companyId: string,
  storeCode: string | null,
  phone: string,
): Promise<void> {
  await client.query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'entered')
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId, storeCode, phone],
  );
}

/**
 * baseline 적재 여부 — 추출이 원장 모드(활성)인지 created_at 추정 모드(초안 미리보기)인지 가른다.
 */
export async function hasBaseline(journeyId: string): Promise<boolean> {
  const r = await query(`SELECT entry_baseline_at FROM journeys WHERE id = $1::uuid`, [journeyId]);
  return !!r.rows[0]?.entry_baseline_at;
}
