/**
 * Oracle 커넥터 (oracledb)
 * 대기업/공공기관 POS/ERP 시스템
 *
 * 설치 필요: npm install oracledb
 * Oracle Instant Client 불필요 (oracledb 6.x thin 모드)
 *
 * 참고:
 * - 테이블/컬럼명이 대문자인 경우가 많음
 * - DATE 타입이 날짜+시간 포함
 * - username → user_tables 스키마 기준
 *
 * 변경사항 (2026-02-24):
 *   - ALTER SESSION SET NLS_LANGUAGE/NLS_TERRITORY 추가 (한글 인코딩 보장)
 *   - 모든 getConnection() 래퍼에서 세션 초기화
 */

import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:oracle');

export class OracleConnector implements IDbConnector {
  readonly dbType = 'oracle' as const;
  private pool: any = null;
  private oracledb: any = null;
  private config: DbConnectionConfig;

  constructor(config: DbConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) return;

    try {
      // 동적 import (미설치 시 친절한 에러)
      try {
        this.oracledb = require('oracledb');
      } catch {
        throw new Error(
          'oracledb 패키지가 설치되지 않았습니다. npm install oracledb 실행 필요',
        );
      }

      // thin 모드 설정 (Oracle Instant Client 불필요, oracledb 6.x+)
      this.oracledb.outFormat = this.oracledb.OUT_FORMAT_OBJECT;
      this.oracledb.autoCommit = true;
      this.oracledb.fetchAsString = [this.oracledb.CLOB];

      // 연결 문자열: host:port/database (Service Name 방식)
      const connectString = `${this.config.host}:${this.config.port}/${this.config.database}`;

      this.pool = await this.oracledb.createPool({
        user: this.config.username,
        password: this.config.password,
        connectString,
        poolMin: 1,
        poolMax: 5,
        poolIncrement: 1,
        poolTimeout: 60,
        queueTimeout: this.config.queryTimeout,
        // sessionCallback으로 새 세션마다 NLS 설정 자동 적용
        sessionCallback: (conn: any, requestedTag: string, callback: Function) => {
          conn.execute(
            "ALTER SESSION SET NLS_LANGUAGE='KOREAN' NLS_TERRITORY='KOREA'",
            [],
            (err: any) => { callback(err); },
          );
        },
      });

      // 연결 확인 + NLS 설정 검증
      const conn = await this.pool.getConnection();
      await conn.execute("ALTER SESSION SET NLS_LANGUAGE='KOREAN' NLS_TERRITORY='KOREA'");
      await conn.execute('SELECT 1 FROM DUAL');
      await conn.close();

      logger.info('Oracle 연결 성공', {
        host: this.config.host,
        database: this.config.database,
      });
    } catch (error) {
      logger.error('Oracle 연결 실패', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
      this.pool = null;
      logger.info('Oracle 연결 해제');
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      const conn = await this.pool.getConnection();
      const result = await conn.execute('SELECT 1 AS test FROM DUAL');
      await conn.close();
      return result.rows?.length > 0;
    } catch (error) {
      logger.error('Oracle 연결 테스트 실패', { error });
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(
        `SELECT table_name FROM user_tables ORDER BY table_name`,
      );
      return (result.rows || []).map((row: any) => row.TABLE_NAME);
    } finally {
      await conn.close();
    }
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(
        `SELECT
           column_name,
           data_type,
           nullable,
           data_length,
           data_precision,
           data_scale
         FROM user_tab_columns
         WHERE table_name = :tableName
         ORDER BY column_id`,
        { tableName: tableName.toUpperCase() },
      );

      // PK 정보 조회
      const pkResult = await conn.execute(
        `SELECT cols.column_name
         FROM user_constraints cons
         JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
         WHERE cons.table_name = :tableName AND cons.constraint_type = 'P'`,
        { tableName: tableName.toUpperCase() },
      );
      const pkColumns = new Set(
        (pkResult.rows || []).map((r: any) => r.COLUMN_NAME),
      );

      return (result.rows || []).map((row: any) => ({
        name: row.COLUMN_NAME,
        dataType: this.mapOracleType(row.DATA_TYPE, row.DATA_PRECISION, row.DATA_SCALE),
        nullable: row.NULLABLE === 'Y',
        maxLength: row.DATA_LENGTH || undefined,
        isPrimaryKey: pkColumns.has(row.COLUMN_NAME),
      }));
    } finally {
      await conn.close();
    }
  }

  async fetchIncremental(
    tableName: string,
    timestampColumn: string,
    since: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);
      const safeColumn = this.sanitizeIdentifier(timestampColumn);

      // Oracle은 OFFSET/FETCH 구문 (12c+) 또는 ROWNUM 사용
      // 12c+ 기준으로 작성 (대부분 최신 Oracle 사용)
      const sql = `SELECT * FROM "${safeTable}"
                   WHERE "${safeColumn}" > TO_TIMESTAMP(:since, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
                   ORDER BY "${safeColumn}" ASC
                   OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;

      const result = await conn.execute(sql, { since, offset, limit }, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
      });

      const rows = this.normalizeRows(result.rows || []);
      logger.debug(`증분 조회: ${rows.length}건`, { tableName, since, offset });
      return rows;
    } finally {
      await conn.close();
    }
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);

      const sql = `SELECT * FROM "${safeTable}"
                   ORDER BY ROWID
                   OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`;

      const result = await conn.execute(sql, { offset, limit }, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
      });

      const rows = this.normalizeRows(result.rows || []);
      logger.debug(`전체 조회: ${rows.length}건`, { tableName, offset });
      return rows;
    } finally {
      await conn.close();
    }
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);
      const result = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM "${safeTable}"`,
      );
      return (result.rows as any[])[0]?.CNT || 0;
    } finally {
      await conn.close();
    }
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error('Oracle 연결이 활성화되어 있지 않습니다. connect()를 먼저 호출하세요.');
    }
  }

  private sanitizeIdentifier(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_가-힣]/g, '');
    if (cleaned !== name) {
      logger.warn('식별자 sanitize 적용', { original: name, cleaned });
    }
    return cleaned;
  }

  /**
   * Oracle 타입 → 공통 타입명 매핑
   */
  private mapOracleType(
    oracleType: string,
    precision?: number,
    scale?: number,
  ): string {
    const type = oracleType.toUpperCase();
    if (type === 'NUMBER') {
      if (scale && scale > 0) return 'decimal';
      if (precision && precision <= 10) return 'int';
      return 'decimal';
    }
    if (type === 'VARCHAR2' || type === 'NVARCHAR2') return 'varchar';
    if (type === 'CHAR' || type === 'NCHAR') return 'char';
    if (type === 'CLOB' || type === 'NCLOB') return 'text';
    if (type === 'DATE') return 'datetime';
    if (type.startsWith('TIMESTAMP')) return 'datetime';
    if (type === 'BLOB' || type === 'RAW' || type === 'LONG RAW') return 'binary';
    return type.toLowerCase();
  }

  /**
   * Oracle 결과 행 정규화
   * - Oracle은 컬럼명이 대문자로 반환됨
   * - Date 객체 → ISO 문자열 변환
   */
  private normalizeRows(rows: Record<string, any>[]): RawRow[] {
    return rows.map((row) => {
      const normalized: RawRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
          normalized[key] = value.toISOString();
        } else {
          normalized[key] = value ?? null;
        }
      }
      return normalized;
    });
  }
}
