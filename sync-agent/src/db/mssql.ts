/**
 * MSSQL 커넥터 (mssql/tedious)
 * 한국 POS/ERP 시스템 주력 DB
 */

import sql from 'mssql';
import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { singleColumnPk } from './types';
// ★ 2026-08-03 커서 재설계 — 키셋 술어·행 커서 성분 추출(순수 공용 모듈)
import { buildKeysetPredicate, extractRowCursorMeta, IncrementalCursor, RowCursorMeta } from './keyset';
import { resolveDbSslOption } from './ssl';
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

    // ★ 2026-07-27 TLS 옵션 단일 해석(ssl.ts CT). ssl 미설정 = undefined = 기존 평문 동작.
    const tls = resolveDbSslOption(this.config);

    const poolConfig: sql.config = {
      server: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      requestTimeout: this.config.queryTimeout,
      options: {
        // ★ 2026-07-27 기본 false = 사내망 고객사 환경(기존 동작 보존).
        //   Azure SQL·암호화 강제 인스턴스는 설정에서 ssl=true로 켠다.
        encrypt: tls !== undefined,
        // 사설·자체서명 인증서 허용. CA를 지정한 경우에만 검증한다.
        trustServerCertificate: !tls?.ca,
        // ★ Codex 2R-4 정정: CA를 실제로 Tedious에 넘긴다.
        //   전에는 trustServerCertificate만 뒤집어서, CA를 지정해도 검증이 안 되고
        //   경로가 틀려도 아무도 몰랐다(검증되는 줄 아는 상태).
        ...(tls?.ca ? { cryptoCredentialsDetails: { ca: tls.ca } } : {}),
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
    // ★ 2026-06-30: 동일 타임스탬프가 배치 경계에 몰리면 건너뜀/중복 → 단일 PK 타이브레이커로 결정적 순서.
    const pk = await this.resolvePk(tableName);
    const tieBreak = pk ? `, [${this.sanitizeIdentifier(pk)}] ASC` : '';

    try {
      const result = await this.pool!.request()
        .input('since', sql.DateTime, new Date(since))
        .input('limit', sql.Int, limit)
        .input('offset', sql.Int, offset)
        .query(`
          -- SQL Server 2008~최신 공통 (OFFSET/FETCH는 2012+ 전용 → 2008에서 실패).
          SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (ORDER BY [${safeColumn}] ASC${tieBreak}) AS rn_
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

  // ─── 키셋 증분 (★ 2026-08-03 커서 재설계) ─────────────
  //
  // 커서 시각은 DB 원문 문자열로 왕복한다 — CONVERT(style 121, 언어 중립)로 만들고 같은 스타일로 되돌린다.
  // 옛 경로의 `new Date(since)` + sql.DateTime 바인드(JS Date 경유·ms 절삭)가 사라진다.
  // 바인드는 컬럼 타입에 맞춘다 — datetime 컬럼에 datetime2 상수를 대면 타입 우선순위 때문에
  // 컬럼 쪽이 변환되어 인덱스를 못 탄다(sargable 붕괴).

  /** 타임스탬프 컬럼 원시 타입 캐시 */
  private tsTypeCache = new Map<string, string>();

  /** CONVERT 대상 타입 화이트리스트 — SQL 텍스트에 들어가므로 여기 없는 타입은 거부한다. */
  private static readonly TS_CONVERT_TYPES: Record<string, string> = {
    datetime: 'datetime',
    datetime2: 'datetime2(7)',
    smalldatetime: 'smalldatetime',
    date: 'date',
    datetimeoffset: 'datetimeoffset(7)',
  };

  private async resolveRawColumnType(tableName: string, columnName: string): Promise<string> {
    const cacheKey = `${tableName}.${columnName}`;
    const cached = this.tsTypeCache.get(cacheKey);
    if (cached) return cached;
    const result = await this.pool!.request()
      .input('tableName', sql.VarChar, tableName)
      .input('columnName', sql.VarChar, columnName)
      .query(`SELECT DATA_TYPE as dataType FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME = @tableName AND COLUMN_NAME = @columnName`);
    const row = result.recordset[0];
    if (!row || !row.dataType) {
      throw new Error(`타임스탬프 컬럼 타입 조회 실패: ${tableName}.${columnName}`);
    }
    const t = String(row.dataType).toLowerCase();
    this.tsTypeCache.set(cacheKey, t);
    return t;
  }

  private tsConvertType(rawType: string): string {
    const mapped = MssqlConnector.TS_CONVERT_TYPES[rawType];
    if (!mapped) {
      throw new Error(
        `타임스탬프 컬럼이 날짜/시각 타입이 아닙니다(${rawType}) — --edit-config로 올바른 컬럼을 지정해주세요.`,
      );
    }
    return mapped;
  }

  private static readonly TS_RAW_ALIAS = '__sync_ts_raw__';

  /** PK 타입 화이트리스트 — 정확 왕복이 보장되는 타입만(decimal·float는 드라이버가 JS number로 근사 — Codex F5·F6과 같은 부류). */
  private static readonly PK_ALLOWED_TYPES = new Set([
    'int', 'bigint', 'smallint', 'tinyint',
    'char', 'varchar', 'nchar', 'nvarchar', 'uniqueidentifier',
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
      if (!MssqlConnector.PK_ALLOWED_TYPES.has(types[col])) {
        throw new Error(
          `증분 불가: PK 컬럼 '${col}' 타입(${types[col]})은 정확한 커서 왕복을 지원하지 않습니다(정수·문자·uniqueidentifier만).`,
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
    const convertType = this.tsConvertType(await this.resolveRawColumnType(safeTable, safeTs));
    await this.validatePkTypes(safeTable, safePks);
    const tsCol = `[${safeTs}]`;

    const request = this.pool!.request().input('lim', sql.Int, limit);
    let predicate = `${tsCol} IS NOT NULL`;
    if (cursor) {
      request.input('cts', sql.VarChar, cursor.tsRaw);
      const wrapTsBind = (t: string) => `CONVERT(${convertType}, ${t}, 121)`;
      if (cursor.keys.length === 0) {
        // 열린 버킷 시작 커서 — 그 버킷 전체를 재조회한다(ts >=). 서버 멱등이 겹침을 흡수.
        predicate += ` AND ${tsCol} >= ${wrapTsBind('@cts')}`;
      } else {
        const bind = (name: string): string => {
          if (name === 'ts') return '@cts';
          // 같은 키가 두 번 등장(>·=)해도 named 바인드라 1회 등록이면 된다 — 중복 등록은 드라이버가 거부한다.
          const idx = Number(name.slice(1));
          try { request.input(name, cursor.keys[idx]); } catch { /* 이미 등록됨 */ }
          return `@${name}`;
        };
        predicate += ` AND ${buildKeysetPredicate(tsCol, wrapTsBind, bind, safePks.map((c) => `[${c}]`))}`;
      }
    }
    const orderBy = [`${tsCol} ASC`, ...safePks.map((c) => `[${c}] ASC`)].join(', ');

    // TOP은 2008에서도 동작(OFFSET/FETCH는 2012+). 커서가 페이지를 이으므로 OFFSET이 필요 없다.
    const result = await request.query(
      `SELECT TOP (@lim) t.*, CONVERT(varchar(40), ${tsCol}, 121) AS [${MssqlConnector.TS_RAW_ALIAS}]
         FROM [${safeTable}] t
        WHERE ${predicate}
        ORDER BY ${orderBy}`,
    );
    const { cleanRows, meta } = extractRowCursorMeta(result.recordset, MssqlConnector.TS_RAW_ALIAS, pkColumns);
    logger.debug(`키셋 증분 조회: ${meta.length}건`, { tableName, cursorTs: cursor?.tsRaw ?? null });
    return { rows: cleanRows as RawRow[], meta };
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
    const convertType = this.tsConvertType(await this.resolveRawColumnType(safeTable, safeTs));
    await this.validatePkTypes(safeTable, safePks);
    const tsCol = `[${safeTs}]`;
    const orderBy = [`${tsCol} DESC`, ...safePks.map((c) => `[${c}] DESC`)].join(', ');
    const pkSelect = safePks.map((c) => `[${c}]`).join(', ');

    const request = this.pool!.request();
    let where = `${tsCol} IS NOT NULL`;
    if (beforeTsRawExclusive) {
      request.input('beforeTs', sql.VarChar, beforeTsRawExclusive);
      where += ` AND ${tsCol} < CONVERT(${convertType}, @beforeTs, 121)`;
    }
    const result = await request.query(
      `SELECT TOP (1) CONVERT(varchar(40), ${tsCol}, 121) AS [${MssqlConnector.TS_RAW_ALIAS}]${pkSelect ? ', ' + pkSelect : ''}
         FROM [${safeTable}]
        WHERE ${where}
        ORDER BY ${orderBy}`,
    );
    const row = result.recordset[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      tsRaw: String(row[MssqlConnector.TS_RAW_ALIAS] ?? ''),
      keys: safePks.map((c) => row[c]) as (string | number)[],
    };
  }

  /** 접속 대상 식별자 — 커서 fingerprint 재료. 계정까지 포함(기본 스키마가 사용자별 — 2R F9). JSON = 경계 단사(3R F11). */
  getSourceId(): string {
    return JSON.stringify([this.config.host, this.config.port, this.config.database, this.config.username]);
  }

  /** 단일 PK 캐시 — 전체 동기화 안정 정렬 키 (매 배치 메타 조회 방지). */
  private pkCache = new Map<string, string | null>();

  private async resolvePk(tableName: string): Promise<string | null> {
    const cached = this.pkCache.get(tableName);
    if (cached !== undefined) return cached;
    let pk: string | null = null;
    try {
      pk = singleColumnPk(await this.getColumns(tableName));
    } catch {
      pk = null;
    }
    this.pkCache.set(tableName, pk);
    return pk;
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    // ★ 2026-06-30: ROW_NUMBER OVER (ORDER BY (SELECT NULL))은 임의 순번 → 깊은 OFFSET에서
    //   행 건너뜀/중복. 단일 PK 기준 ORDER BY로 결정적 순서 보장(없으면 기존 임의 순번 유지 —
    //   엔진 완전성 가드가 누락을 감지). 2008 호환 위해 ROW_NUMBER 유지.
    const pk = await this.resolvePk(tableName);
    const orderClause = pk
      ? `ORDER BY [${this.sanitizeIdentifier(pk)}] ASC`
      : 'ORDER BY (SELECT NULL)';

    const result = await this.pool!.request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset)
      .query(`
        -- SQL Server 2008~최신 공통 (OFFSET/FETCH는 2012+ 전용 → 2008에서 실패).
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (${orderClause}) AS rn_
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
