/**
 * POS DB 스키마 읽기 + 샘플 데이터 수집
 *
 * INFORMATION_SCHEMA에서 테이블/컬럼 정보를 읽고
 * 주요 테이블의 샘플 데이터를 수집하여 서버 AI 분석에 전달.
 */

import { executeQuery } from './db-connector';
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

/**
 * MS-SQL: INFORMATION_SCHEMA에서 모든 사용자 테이블 + 컬럼 읽기
 */
export async function readSchema(): Promise<TableInfo[]> {
  logger.info('스키마 읽기 시작...');

  // 1. 사용자 테이블 목록 (시스템 테이블 제외)
  const tables = await executeQuery(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND TABLE_SCHEMA = 'dbo'
    ORDER BY TABLE_NAME
  `);

  const result: TableInfo[] = [];

  for (const t of tables) {
    const tableName = t.TABLE_NAME;

    // 2. 컬럼 정보
    const columns = await executeQuery(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.CHARACTER_MAXIMUM_LENGTH,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.TABLE_NAME = '${tableName}' AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON pk.COLUMN_NAME = c.COLUMN_NAME
      WHERE c.TABLE_NAME = '${tableName}'
      ORDER BY c.ORDINAL_POSITION
    `);

    // 3. 행 수 (대략적 — sys.partitions 사용)
    let rowCount: number | undefined;
    try {
      const countResult = await executeQuery(`
        SELECT SUM(p.rows) AS row_count
        FROM sys.partitions p
        JOIN sys.tables t ON t.object_id = p.object_id
        WHERE t.name = '${tableName}' AND p.index_id IN (0, 1)
      `);
      rowCount = countResult[0]?.row_count || 0;
    } catch {
      // 권한 부족 시 무시
    }

    result.push({
      name: tableName,
      rowCount,
      columns: columns.map((c: any) => ({
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === 'YES',
        maxLength: c.CHARACTER_MAXIMUM_LENGTH || undefined,
        isPrimaryKey: c.IS_PK === 1,
      })),
    });
  }

  logger.info(`스키마 읽기 완료: ${result.length}개 테이블`);
  return result;
}

/**
 * 주요 테이블에서 샘플 데이터 10건 수집
 *
 * AI 분석을 위해 컬럼 값 패턴(전화번호 형식, 날짜 형식 등)을 파악.
 * 개인정보 최소화: 주민번호/카드번호 컬럼은 자동 마스킹.
 */
export async function collectSamples(tables: TableInfo[]): Promise<Record<string, any[]>> {
  const samples: Record<string, any[]> = {};

  // 행 수 기준 상위 10개 테이블만 샘플링 (데이터 있는 테이블 우선)
  const candidates = tables
    .filter(t => (t.rowCount ?? 0) > 0)
    .sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
    .slice(0, 10);

  for (const table of candidates) {
    try {
      const rows = await executeQuery(`SELECT TOP 10 * FROM [${table.name}]`);

      // 민감 컬럼 마스킹
      const maskedRows = rows.map(row => {
        const masked: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          const lk = key.toLowerCase();
          // 주민번호/카드번호 컬럼은 마스킹
          if (lk.includes('jumin') || lk.includes('ssn') || lk.includes('card_no') || lk.includes('cardno')) {
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
