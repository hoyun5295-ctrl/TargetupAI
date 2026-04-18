/**
 * MSSQL 커넥터 (mssql/tedious)
 * 한국 POS/ERP 시스템 주력 DB
 */

import sql from 'mssql';
import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:mssql');

export class MssqlConnector implements IDbConnector {
  readonly dbType = 'mssql' as const;
  private pool: sql.ConnectionPool | null = null;
  private config: DbConnectionConfig;

  constructor(config: DbConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) return;

    const poolConfig: sql.config = {
      server: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      requestTimeout: this.config.queryTimeout,
      options: {
        encrypt: false,          // 로컬 네트워크 — 고객사 환경
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      pool: {
        max: 5,
        min: 1,
        idleTimeoutMillis: 30000,
      },
    };

    try {
      this.pool = await new sql.ConnectionPool(poolConfig).connect();
      logger.info('MSSQL 연결 성공', { host: this.config.host, database: this.config.database });
    } catch (error) {
      logger.error('MSSQL 연결 실패', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      logger.info('MSSQL 연결 해제');
    }
  }

  isConnected(): boolean {
    return this.pool?.connected ?? false;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.pool!.request().query('SELECT 1 AS test');
      return result.recordset[0]?.test === 1;
    } catch (error) {
      logger.error('MSSQL 연결 테스트 실패', { error });
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const result = await this.pool!.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    return result.recordset.map((r: Record<string, unknown>) => r.TABLE_NAME as string);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const result = await this.pool!.request()
      .input('tableName', sql.VarChar, tableName)
      .query(`
        SELECT 
          c.COLUMN_NAME as name,
          c.DATA_TYPE as dataType,
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
          c.CHARACTER_MAXIMUM_LENGTH as maxLength,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku 
            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.TABLE_NAME = @tableName AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
        WHERE c.TABLE_NAME = @tableName
        ORDER BY c.ORDINAL_POSITION
      `);

    return result.recordset.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      dataType: r.dataType as string,
      nullable: Boolean(r.nullable),
      maxLength: r.maxLength as number | undefined,
      isPrimaryKey: Boolean(r.isPrimaryKey),
    }));
  }

  async fetchIncremental(
    tableName: string,
    timestampColumn: string,
    since: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();

    // 파라미터화 쿼리로 SQL Injection 방지
    // 테이블명/컬럼명은 화이트리스트 검증 후 사용
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeColumn = this.sanitizeIdentifier(timestampColumn);

    const result = await this.pool!.request()
      .input('since', sql.DateTime, new Date(since))
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset)
      .query(`
        SELECT * FROM [${safeTable}]
        WHERE [${safeColumn}] > @since
        ORDER BY [${safeColumn}] ASC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    logger.debug(`증분 조회: ${result.recordset.length}건`, { tableName, since, offset });
    return result.recordset;
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const result = await this.pool!.request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset)
      .query(`
        SELECT * FROM [${safeTable}]
        ORDER BY (SELECT NULL)
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    logger.debug(`전체 조회: ${result.recordset.length}건`, { tableName, offset });
    return result.recordset;
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const result = await this.pool!.request().query(
      `SELECT COUNT(*) as cnt FROM [${safeTable}]`
    );
    return result.recordset[0].cnt;
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.pool?.connected) {
      throw new Error('MSSQL 연결이 활성화되어 있지 않습니다. connect()를 먼저 호출하세요.');
    }
  }

  /** SQL Injection 방지: 식별자에 허용된 문자만 통과 */
  private sanitizeIdentifier(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_가-힣]/g, '');
    if (cleaned !== name) {
      logger.warn('식별자 sanitize 적용', { original: name, cleaned });
    }
    return cleaned;
  }
}
