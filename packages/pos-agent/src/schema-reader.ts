/**
 * POS DB 스키마 읽기 + 샘플 데이터 수집
 *
 * MSSQL / MySQL / SQLite 3종 지원.
 * 테이블/컬럼 정보 + 샘플 데이터를 서버 AI 분석에 전달.
 *
 * ⚠️ 테이블명은 [] (MSSQL) / backtick (MySQL) / "" (SQLite) 로 이스케이핑.
 */

import { executeQuery } from './db-connector';
import { getConfig } from './config';
import { logger } from './logger';

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount?: number;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength?: number;
  isPrimaryKey?: boolean;
}

// ============================================================
// 메인 진입점 — DB 타입별 분기
// ============================================================

export async function readSchema(): Promise<TableInfo[]> {
  const { type } = getConfig().db;
  logger.info(`스키마 읽기 시작 (${type})...`);

  let result: TableInfo[];
  if (type === 'mssql') result = await readMssqlSchema();
  else if (type === 'mysql') result = await readMysqlSchema();
  else if (type === 'sqlite') result = await readSqliteSchema();
  else { logger.error(`지원하지 않는 DB 타입: ${type}`); return []; }

  logger.info(`스키마 읽기 완료: ${result.length}개 테이블`);
  return result;
}

// ============================================================
// MSSQL 스키마
// ============================================================

async function readMssqlSchema(): Promise<TableInfo[]> {
  const tables = await executeQuery(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'
    ORDER BY TABLE_NAME
  `);

  const result: TableInfo[] = [];
  for (const t of tables) {
    const tableName = t.TABLE_NAME;

    const columns = await executeQuery(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.CHARACTER_MAXIMUM_LENGTH,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.TABLE_NAME = @p0 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME
      WHERE c.TABLE_NAME = @p0
      ORDER BY c.ORDINAL_POSITION
    `, [tableName]);

    let rowCount: number | undefined;
    try {
      const cnt = await executeQuery(`
        SELECT SUM(p.rows) AS row_count FROM sys.partitions p
        JOIN sys.tables t ON t.object_id = p.object_id
        WHERE t.name = @p0 AND p.index_id IN (0, 1)
      `, [tableName]);
      rowCount = cnt[0]?.row_count || 0;
    } catch {}

    result.push({
      name: tableName, rowCount,
      columns: columns.map((c: any) => ({
        name: c.COLUMN_NAME, dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        maxLength: c.CHARACTER_MAXIMUM_LENGTH || undefined,
        isPrimaryKey: c.IS_PK === 1,
      })),
    });
  }
  return result;
}

// ============================================================
// MySQL 스키마
// ============================================================

async function readMysqlSchema(): Promise<TableInfo[]> {
  const { database } = getConfig().db;

  const tables = await executeQuery(
    `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`, [database]
  );

  const result: TableInfo[] = [];
  for (const t of tables) {
    const tableName = t.TABLE_NAME;

    const columns = await executeQuery(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.CHARACTER_MAXIMUM_LENGTH,
        c.COLUMN_KEY
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION
    `, [database, tableName]);

    result.push({
      name: tableName,
      rowCount: t.TABLE_ROWS || 0,
      columns: columns.map((c: any) => ({
        name: c.COLUMN_NAME, dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        maxLength: c.CHARACTER_MAXIMUM_LENGTH || undefined,
        isPrimaryKey: c.COLUMN_KEY === 'PRI',
      })),
    });
  }
  return result;
}

// ============================================================
// SQLite 스키마
// ============================================================

async function readSqliteSchema(): Promise<TableInfo[]> {
  const tables = await executeQuery(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );

  const result: TableInfo[] = [];
  for (const t of tables) {
    const tableName = t.name;

    const columns = await executeQuery(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);

    let rowCount: number | undefined;
    try {
      const cnt = await executeQuery(`SELECT COUNT(*) AS cnt FROM "${tableName.replace(/"/g, '""')}"`);
      rowCount = cnt[0]?.cnt || 0;
    } catch {}

    result.push({
      name: tableName, rowCount,
      columns: columns.map((c: any) => ({
        name: c.name, dataType: c.type || 'TEXT',
        nullable: c.notnull === 0,
        isPrimaryKey: c.pk === 1,
      })),
    });
  }
  return result;
}

// ============================================================
// 샘플 수집 (3종 공통)
// ============================================================

export async function collectSamples(tables: TableInfo[]): Promise<Record<string, any[]>> {
  const { type } = getConfig().db;
  const samples: Record<string, any[]> = {};

  const candidates = tables
    .filter(t => (t.rowCount ?? 0) > 0)
    .sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
    .slice(0, 10);

  for (const table of candidates) {
    try {
      const safeName = escapeTableName(table.name, type);
      const limitClause = type === 'mssql' ? `SELECT TOP 10 * FROM ${safeName}` : `SELECT * FROM ${safeName} LIMIT 10`;
      const rows = await executeQuery(limitClause);

      // 민감 컬럼 마스킹
      const maskedRows = rows.map(row => {
        const masked: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          const lk = key.toLowerCase();
          if (lk.includes('jumin') || lk.includes('ssn') || lk.includes('card_no') || lk.includes('cardno') || lk.includes('주민')) {
            masked[key] = '***MASKED***';
          } else {
            masked[key] = value;
          }
        }
        return masked;
      });

      samples[table.name] = maskedRows;
    } catch (err: any) {
      logger.warn(`샘플 수집 실패: ${table.name} — ${err.message}`);
    }
  }

  logger.info(`샘플 수집 완료: ${Object.keys(samples).length}개 테이블`);
  return samples;
}

/** 테이블명 이스케이핑 */
function escapeTableName(name: string, dbType: string): string {
  if (dbType === 'mssql') return `[${name.replace(/\]/g, ']]')}]`;
  if (dbType === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  return `"${name.replace(/"/g, '""')}"`;
}
