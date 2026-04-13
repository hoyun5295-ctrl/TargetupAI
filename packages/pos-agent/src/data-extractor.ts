/**
 * AI 매핑 기반 주기적 데이터 추출
 *
 * 서버에서 받은 SchemaMapping의 extractQueries를 사용하여
 * POS DB에서 증분 데이터를 추출하고 서버로 push.
 */

import { executeQuery } from './db-connector';
import { pushData } from './server-client';
import { getConfig, saveConfig } from './config';
import { logger } from './logger';

interface SchemaMapping {
  memberTable: string | null;
  salesTable: string | null;
  inventoryTable: string | null;
  memberColumns: Record<string, string>;
  salesColumns: Record<string, string>;
  inventoryColumns: Record<string, string> | null;
  extractQueries: {
    newMembers: string;
    newSales: string;
    inventorySnapshot: string;
  };
}

/** 증분 판매 데이터 추출 + push */
export async function extractAndPushSales(mapping: SchemaMapping): Promise<void> {
  if (!mapping.salesTable || !mapping.extractQueries.newSales) {
    logger.debug('판매 테이블 미매핑 — 스킵');
    return;
  }

  const config = getConfig();
  const lastSync = config.lastSalesSync || '2000-01-01T00:00:00';

  try {
    // AI가 생성한 쿼리 실행 — 파라미터 바인딩으로 SQL Injection 방지
    const sql = bindSyncParam(mapping.extractQueries.newSales, getConfig().db.type);
    const rows = await executeQuery(sql, [lastSync]);

    if (rows.length === 0) {
      logger.debug('새 판매 데이터 없음');
      return;
    }

    // 컬럼 매핑 적용 (POS 컬럼명 → 표준 필드명)
    const mapped = rows.map(row => mapColumns(row, mapping.salesColumns));

    const result = await pushData('sales', mapped);
    if (result.ok) {
      saveConfig({ lastSalesSync: new Date().toISOString() });
      logger.info(`판매 데이터 push: ${result.data?.accepted}건 성공`);
    }
  } catch (err: any) {
    logger.error('판매 데이터 추출 실패:', err.message);
  }
}

/** 증분 회원 데이터 추출 + push */
export async function extractAndPushMembers(mapping: SchemaMapping): Promise<void> {
  if (!mapping.memberTable || !mapping.extractQueries.newMembers) {
    logger.debug('회원 테이블 미매핑 — 스킵');
    return;
  }

  const config = getConfig();
  const lastSync = config.lastMembersSync || '2000-01-01T00:00:00';

  try {
    const sql = bindSyncParam(mapping.extractQueries.newMembers, getConfig().db.type);
    const rows = await executeQuery(sql, [lastSync]);

    if (rows.length === 0) {
      logger.debug('새 회원 데이터 없음');
      return;
    }

    const mapped = rows.map(row => mapColumns(row, mapping.memberColumns));

    const result = await pushData('members', mapped);
    if (result.ok) {
      saveConfig({ lastMembersSync: new Date().toISOString() });
      logger.info(`회원 데이터 push: ${result.data?.accepted}건 성공`);
    }
  } catch (err: any) {
    logger.error('회원 데이터 추출 실패:', err.message);
  }
}

/** 재고 스냅샷 추출 + push */
export async function extractAndPushInventory(mapping: SchemaMapping): Promise<void> {
  if (!mapping.inventoryTable || !mapping.extractQueries.inventorySnapshot) {
    logger.debug('재고 테이블 미매핑 — 스킵');
    return;
  }

  try {
    const rows = await executeQuery(mapping.extractQueries.inventorySnapshot);

    if (rows.length === 0) {
      logger.debug('재고 데이터 없음');
      return;
    }

    const mapped = rows.map(row => mapColumns(row, mapping.inventoryColumns || {}));

    const result = await pushData('inventory', mapped);
    if (result.ok) {
      saveConfig({ lastInventorySync: new Date().toISOString() });
      logger.info(`재고 데이터 push: ${result.data?.accepted}건 성공`);
    }
  } catch (err: any) {
    logger.error('재고 데이터 추출 실패:', err.message);
  }
}

/**
 * 컬럼 매핑 적용: POS 컬럼명 → 표준 필드명
 *
 * mapping: { "phone": "CUST_HP", "name": "CUST_NM" }
 * row: { CUST_HP: "01012345678", CUST_NM: "홍길동" }
 * result: { phone: "01012345678", name: "홍길동" }
 */
function mapColumns(row: Record<string, any>, columnMapping: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};

  // 역매핑 생성 (POS컬럼 → 표준필드)
  const reverseMap: Record<string, string> = {};
  for (const [standardField, posColumn] of Object.entries(columnMapping)) {
    reverseMap[posColumn.toLowerCase()] = standardField;
  }

  for (const [posCol, value] of Object.entries(row)) {
    const standardField = reverseMap[posCol.toLowerCase()];
    if (standardField) {
      result[standardField] = value;
    }
  }

  // raw 데이터도 보존 (디버깅용)
  result.raw = row;

  return result;
}

/**
 * :LAST_SYNC_AT placeholder를 DB별 파라미터로 치환
 * MSSQL: @p0, MySQL: ?, SQLite: ?
 */
function bindSyncParam(sql: string, dbType: string): string {
  const placeholder = dbType === 'mssql' ? '@p0' : '?';
  return sql.replace(/:LAST_SYNC_AT/g, placeholder);
}
