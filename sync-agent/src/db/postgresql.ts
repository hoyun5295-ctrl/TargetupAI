/**
 * PostgreSQL 커넥터 (pg)
 * 최신 시스템/스타트업 POS/ERP
 *
 * 설치 필요: npm install pg @types/pg
 *
 * 참고:
 * - 스키마 개념 있음 (기본: public)
 * - timestamptz 네이티브 지원
 * - JSON/JSONB 네이티브 지원
 *
 * 변경사항 (2026-02-24):
 *   - SET client_encoding TO 'UTF8' 강제 실행 추가
 *   - pool.on('connect') 이벤트로 모든 새 커넥션에 UTF-8 적용
 */

import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:postgres');

export class PostgresConnector implements IDbConnector {
  readonly dbType = 'postgres' as const;
  private pool: any = null;
  private pg: any = null;
  private config: DbConnectionConfig;
  private schema = 'public';

  constructor(config: DbConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) return;

    try {
      // 동적 import (미설치 시 친절한 에러)
      try {
        this.pg = require('pg');
      } catch {
        throw new Error(
          'pg 패키지가 설치되지 않았습니다. npm install pg 실행 필요',
        );
      }

      this.pool = new this.pg.Pool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        max: 5,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 10000,
        statement_timeout: this.config.queryTimeout,
      });

      // 새 커넥션마다 UTF-8 강제 (소스 DB client_encoding이 다를 경우 대응)
      this.pool.on('connect', (client: any) => {
        client.query("SET client_encoding TO 'UTF8'");
      });

      // 연결 확인 + 첫 커넥션에도 UTF-8 강제
      const client = await this.pool.connect();
      await client.query("SET client_encoding TO 'UTF8'");
      await client.query('SELECT 1');
      client.release();

      logger.info('PostgreSQL 연결 성공', {
        host: this.config.host,
        database: this.config.database,
      });
    } catch (error) {
      logger.error('PostgreSQL 연결 실패', { error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('PostgreSQL 연결 해제');
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.pool.query('SELECT 1 AS test');
      return result.rows[0]?.test === 1;
    } catch (error) {
      logger.error('PostgreSQL 연결 테스트 실패', { error });
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const result = await this.pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [this.schema],
    );
    return result.rows.map((r: any) => r.table_name);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    // 컬럼 정보
    const colResult = await this.pool.query(
      `SELECT
         column_name,
         data_type,
         is_nullable,
         character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [this.schema, tableName],
    );

    // PK 정보
    const pkResult = await this.pool.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1
         AND tc.table_name = $2
         AND tc.constraint_type = 'PRIMARY KEY'`,
      [this.schema, tableName],
    );
    const pkColumns = new Set(
      pkResult.rows.map((r: any) => r.column_name),
    );

    return colResult.rows.map((row: any) => ({
      name: row.column_name,
      dataType: this.mapPgType(row.data_type),
      nullable: row.is_nullable === 'YES',
      maxLength: row.character_maximum_length || undefined,
      isPrimaryKey: pkColumns.has(row.column_name),
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
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeColumn = this.sanitizeIdentifier(timestampColumn);

    // PostgreSQL은 ISO 8601 문자열을 timestamptz로 자동 변환
    const result = await this.pool.query(
      `SELECT * FROM "${safeTable}"
       WHERE "${safeColumn}" > $1
       ORDER BY "${safeColumn}" ASC
       LIMIT $2 OFFSET $3`,
      [since, limit, offset],
    );

    const rows = this.normalizeRows(result.rows);
    logger.debug(`증분 조회: ${rows.length}건`, { tableName, since, offset });
    return rows;
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const result = await this.pool.query(
      `SELECT * FROM "${safeTable}"
       ORDER BY ctid
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const rows = this.normalizeRows(result.rows);
    logger.debug(`전체 조회: ${rows.length}건`, { tableName, offset });
    return rows;
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);
    const result = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM "${safeTable}"`,
    );
    return parseInt(result.rows[0].cnt, 10);
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error('PostgreSQL 연결이 활성화되어 있지 않습니다. connect()를 먼저 호출하세요.');
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
   * PostgreSQL 타입 → 공통 타입명 매핑
   */
  private mapPgType(pgType: string): string {
    const type = pgType.toLowerCase();
    if (type === 'integer' || type === 'bigint' || type === 'smallint') return 'int';
    if (type === 'numeric' || type === 'decimal' || type === 'real' || type === 'double precision') return 'decimal';
    if (type === 'character varying' || type === 'varchar') return 'varchar';
    if (type === 'character' || type === 'char') return 'char';
    if (type === 'text') return 'text';
    if (type === 'boolean') return 'bit';
    if (type === 'date') return 'date';
    if (type.includes('timestamp')) return 'datetime';
    if (type === 'json' || type === 'jsonb') return 'text';
    if (type === 'uuid') return 'varchar';
    if (type === 'bytea') return 'binary';
    return type;
  }

  /**
   * 결과 행 정규화
   * - Date → ISO 문자열
   * - Buffer(bytea) → null (바이너리 데이터는 동기화 대상 아님)
   */
  private normalizeRows(rows: Record<string, any>[]): RawRow[] {
    return rows.map((row) => {
      const normalized: RawRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
          normalized[key] = value.toISOString();
        } else if (Buffer.isBuffer(value)) {
          normalized[key] = null;
        } else {
          normalized[key] = value ?? null;
        }
      }
      return normalized;
    });
  }
}
