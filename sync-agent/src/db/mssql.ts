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

    try {
      const result = await this.pool!.request()
        .input('since', sql.DateTime, new Date(since))
        .input('limit', sql.Int, limit)
        .input('offset', sql.Int, offset)
        .query(`
          -- SQL Server 2008~최신 공통 (OFFSET/FETCH는 2012+ 전용 → 2008에서 실패).
          SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (ORDER BY [${safeColumn}] ASC) AS rn_
            FROM [${safeTable}]
            WHERE [${safeColumn}] > @since
          ) t WHERE rn_ > @offset AND rn_ <= @offset + @limit
        `);

      logger.debug(`증분 조회: ${result.recordset.length}건`, { tableName, since, offset });
      return result.recordset.map((r: any) => { delete r.rn_; return r; });
    } catch (err: any) {
      // ★ D151-5 (2026-05-11): SQL Server raw 에러 → 사용자 친화 메시지 변환
      //   timestamp/테이블 누락 시 mssql 패키지가 EREQUEST raw 에러를 그대로 throw하여
      //   운영 화면엔 "Invalid column name 'updated_at'..." 같은 영문 원본만 노출 → 직원 진단 어려움.
      //   설치 마법사 재실행 안내 메시지로 변환.
      const msg = err?.message || err?.originalError?.message || String(err);
      const colMatch = msg.match(/Invalid column name '([^']+)'/i);
      if (colMatch) {
        logger.error('MSSQL 증분 조회 실패: 컬럼 누락', { tableName, timestampColumn, rawMessage: msg });
        throw new Error(
          `타임스탬프 컬럼 '${colMatch[1]}'이 테이블 [${safeTable}]에 없습니다. ` +
          `설치 마법사를 다시 실행하여 올바른 컬럼명을 입력해주세요. ` +
          `(SQL Server에서 SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${safeTable}' 로 확인 가능)`
        );
      }
      const tableMatch = msg.match(/Invalid object name '([^']+)'/i);
      if (tableMatch) {
        logger.error('MSSQL 증분 조회 실패: 테이블 누락', { tableName, rawMessage: msg });
        throw new Error(
          `테이블 '${tableMatch[1]}'이 DB에 없습니다. 설치 마법사에서 올바른 테이블명을 재확인해주세요.`
        );
      }
      logger.error('MSSQL 증분 조회 실패', { tableName, timestampColumn, error: msg });
      throw err;
    }
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
        -- SQL Server 2008~최신 공통 (OFFSET/FETCH는 2012+ 전용 → 2008에서 실패).
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS rn_
          FROM [${safeTable}]
        ) t WHERE rn_ > @offset AND rn_ <= @offset + @limit
      `);

    logger.debug(`전체 조회: ${result.recordset.length}건`, { tableName, offset });
    return result.recordset.map((r: any) => { delete r.rn_; return r; });
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
