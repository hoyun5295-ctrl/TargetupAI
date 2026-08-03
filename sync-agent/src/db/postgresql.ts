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
// ★ 2026-08-03 커서 재설계 — 키셋 술어·행 커서 성분 추출(순수 공용 모듈)
import { buildKeysetPredicate, extractRowCursorMeta, IncrementalCursor, RowCursorMeta } from './keyset';
import { resolveDbSslOption } from './ssl';
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

      const pgTls = resolveDbSslOption(this.config);
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
        // ★ 2026-07-27 Aurora/RDS PostgreSQL 등 TLS 강제 환경. 미설정 = 평문(기존 동작 보존).
        //   CA 해석은 ssl.ts CT 하나뿐 — 어댑터마다 규칙이 갈리지 않게 한다(Codex 2R-4).
        ...(pgTls ? { ssl: pgTls } : {}),
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
       ORDER BY "${safeColumn}" ASC, ctid ASC
       LIMIT $2 OFFSET $3`,
      [since, limit, offset],
    );

    const rows = this.normalizeRows(result.rows);
    logger.debug(`증분 조회: ${rows.length}건`, { tableName, since, offset });
    return rows;
  }

  // ─── 키셋 증분 (★ 2026-08-03 커서 재설계) ─────────────
  //
  // 커서 시각은 DB 원문 문자열로 왕복한다 — `::text`로 만들고 상수 캐스트($1::timestamptz 등)로 되돌린다.
  // timestamptz의 ::text는 오프셋을 포함하므로 세션 TimeZone과 무관하게 같은 순간으로 복원된다.

  /** 타임스탬프 컬럼 원시 타입(udt) 캐시 */
  private tsTypeCache = new Map<string, string>();

  /** 상수 캐스트 화이트리스트 — SQL 텍스트에 들어가므로 여기 없는 타입은 거부한다. */
  private static readonly TS_CAST_TYPES: Record<string, string> = {
    timestamptz: 'timestamptz',
    timestamp: 'timestamp',
    date: 'date',
  };

  private async resolveRawColumnType(tableName: string, columnName: string): Promise<string> {
    const cacheKey = `${tableName}.${columnName}`;
    const cached = this.tsTypeCache.get(cacheKey);
    if (cached) return cached;
    const result = await this.pool.query(
      `SELECT udt_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [this.schema, tableName, columnName],
    );
    const row = result.rows[0];
    if (!row || !row.udt_name) {
      throw new Error(`타임스탬프 컬럼 타입 조회 실패: ${tableName}.${columnName}`);
    }
    const t = String(row.udt_name).toLowerCase();
    this.tsTypeCache.set(cacheKey, t);
    return t;
  }

  private tsCastType(rawType: string): string {
    const mapped = PostgresConnector.TS_CAST_TYPES[rawType];
    if (!mapped) {
      throw new Error(
        `타임스탬프 컬럼이 날짜/시각 타입이 아닙니다(${rawType}) — --edit-config로 올바른 컬럼을 지정해주세요.`,
      );
    }
    return mapped;
  }

  private static readonly TS_RAW_ALIAS = '__sync_ts_raw__';

  /** PK 타입 화이트리스트 — 정확 왕복 보장 타입만. int8·numeric은 pg 드라이버가 문자열로 돌려줘 정밀도 보존, float는 근사라 잠근다. */
  private static readonly PK_ALLOWED_UDT = new Set([
    'int2', 'int4', 'int8', 'numeric', 'text', 'varchar', 'bpchar', 'uuid',
  ]);

  private pkTypeCache = new Map<string, Record<string, string>>();

  private async validatePkTypes(tableName: string, safePks: string[]): Promise<void> {
    let types = this.pkTypeCache.get(tableName);
    if (!types) {
      types = {};
      for (const col of safePks) {
        types[col] = await this.resolveRawColumnType(tableName, col);
      }
      this.pkTypeCache.set(tableName, types);
    }
    for (const col of safePks) {
      if (!PostgresConnector.PK_ALLOWED_UDT.has(types[col])) {
        throw new Error(
          `증분 불가: PK 컬럼 '${col}' 타입(${types[col]})은 정확한 커서 왕복을 지원하지 않습니다(정수·numeric·문자·uuid만).`,
        );
      }
    }
  }

  async fetchIncrementalKeyset(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    cursor: IncrementalCursor | null,
    limit: number,
  ): Promise<{ rows: RawRow[]; meta: RowCursorMeta[] }> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeTs = this.sanitizeIdentifier(timestampColumn);
    const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
    const castType = this.tsCastType(await this.resolveRawColumnType(safeTable, safeTs));
    await this.validatePkTypes(safeTable, safePks);
    const tsCol = `"${safeTs}"`;

    const params: unknown[] = [];
    let predicate = `${tsCol} IS NOT NULL`;
    if (cursor) {
      const wrapTsBind = (t: string) => `${t}::${castType}`;
      if (cursor.keys.length === 0) {
        // 열린 버킷 시작 커서 — 그 버킷 전체를 재조회한다(ts >=). 서버 멱등이 겹침을 흡수.
        params.push(cursor.tsRaw);
        predicate += ` AND ${tsCol} >= ${wrapTsBind(`$${params.length}`)}`;
      } else {
        // $n은 같은 자리를 재참조할 수 있다 — 이름당 번호 하나를 고정 배정한다.
        const indexByName = new Map<string, number>();
        const bind = (name: string): string => {
          let idx = indexByName.get(name);
          if (idx === undefined) {
            params.push(name === 'ts' ? cursor.tsRaw : cursor.keys[Number(name.slice(1))]);
            idx = params.length;
            indexByName.set(name, idx);
          }
          return `$${idx}`;
        };
        predicate += ` AND ${buildKeysetPredicate(tsCol, wrapTsBind, bind, safePks.map((c) => `"${c}"`))}`;
      }
    }
    const orderBy = [`${tsCol} ASC`, ...safePks.map((c) => `"${c}" ASC`)].join(', ');
    params.push(limit);

    const result = await this.pool.query(
      `SELECT t.*, ${tsCol}::text AS "${PostgresConnector.TS_RAW_ALIAS}"
         FROM "${safeTable}" t
        WHERE ${predicate}
        ORDER BY ${orderBy}
        LIMIT $${params.length}`,
      params,
    );
    const { cleanRows, meta } = extractRowCursorMeta(result.rows, PostgresConnector.TS_RAW_ALIAS, pkColumns);
    logger.debug(`키셋 증분 조회: ${meta.length}건`, { tableName, cursorTs: cursor?.tsRaw ?? null });
    return { rows: this.normalizeRows(cleanRows), meta };
  }

  async fetchMaxCursor(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    beforeTsRawExclusive?: string | null,
  ): Promise<IncrementalCursor | null> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeTs = this.sanitizeIdentifier(timestampColumn);
    const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
    const castType = this.tsCastType(await this.resolveRawColumnType(safeTable, safeTs));
    await this.validatePkTypes(safeTable, safePks);
    const tsCol = `"${safeTs}"`;
    const orderBy = [`${tsCol} DESC`, ...safePks.map((c) => `"${c}" DESC`)].join(', ');
    const pkSelect = safePks.map((c) => `"${c}"`).join(', ');

    const params: unknown[] = [];
    let where = `${tsCol} IS NOT NULL`;
    if (beforeTsRawExclusive) {
      params.push(beforeTsRawExclusive);
      where += ` AND ${tsCol} < $${params.length}::${castType}`;
    }
    const result = await this.pool.query(
      `SELECT ${tsCol}::text AS "${PostgresConnector.TS_RAW_ALIAS}"${pkSelect ? ', ' + pkSelect : ''}
         FROM "${safeTable}"
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT 1`,
      params,
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      tsRaw: String(row[PostgresConnector.TS_RAW_ALIAS] ?? ''),
      keys: safePks.map((c) => row[c]) as (string | number)[],
    };
  }

  /** 접속 대상 식별자 — 커서 fingerprint 재료. 스키마·계정까지 포함(2R F9). JSON = 경계 단사(3R F11). */
  getSourceId(): string {
    return JSON.stringify([this.config.host, this.config.port, this.config.database, this.schema, this.config.username]);
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
