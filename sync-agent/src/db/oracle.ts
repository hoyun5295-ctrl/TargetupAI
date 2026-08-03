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
// ★ 2026-08-03 커서 재설계 — 키셋 술어·행 커서 성분 추출(순수 공용 모듈)
import { buildKeysetPredicate, extractRowCursorMeta, IncrementalCursor, RowCursorMeta } from './keyset';
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
      //  ★ 2026-06-24: pkg@5.8.1(node12)은 네이티브 .node를 exe 스냅샷에 못 싣는다(pkg.assets 무시 —
      //    sql.js도 같은 이유로 exe 옆 sidecar로 동봉 중). oracledb 모듈도 exe 옆 외부 실폴더로 동봉하고
      //    거기서 로드한다. 외부 실폴더면 oracledb의 __dirname이 실경로라 옆의 build/Release/oracledb-*.node를
      //    dlopen으로 정상 로드 → 스냅샷 NJS-045 회피. 없으면 기존 require('oracledb') 폴백(개발/비-pkg).
      try {
        const pathMod = require('path');
        const fsMod = require('fs');
        const exeDir = pathMod.dirname(process.execPath || process.argv[0] || process.cwd());
        const externalOracledb = pathMod.join(exeDir, 'oracledb');
        if (fsMod.existsSync(pathMod.join(externalOracledb, 'package.json'))) {
          this.oracledb = require(externalOracledb);
          logger.info('외부 동봉 oracledb 모듈 로드', { externalOracledb });
        } else {
          this.oracledb = require('oracledb');
        }
      } catch (reqErr) {
        const m = reqErr instanceof Error ? reqErr.message : String(reqErr);
        throw new Error(`oracledb 네이티브 로드 실패: ${m}`);
      }

      // 드라이버 모드 — Oracle Client 라이브러리가 있으면 thick(11g/10g 지원), 없으면 thin(DB 12.1+만).
      //  ★ 2026-06-24: 고객 박스에 11.2+ 클라가 없어도(예: 10g만 설치) 연결되도록, 실행 파일 옆
      //    `oracle-client/` 폴더(동봉한 11.2 클라 = full home 서브셋)를 1순위로 감지해 thick으로 잡는다.
      //    없으면 ORACLE_HOME(고객 PC에 클라가 있는 경우)로 폴백.
      //    · node12 oracledb 5.x = 항상 thick → 동봉 클라 필수 / node14+ 6.x = 동봉 있으면 thick, 없으면 thin.
      //    full home 서브셋이라 데이터 파일(NLS 등)을 찾도록 ORACLE_HOME을 그 폴더로 함께 지정한다.
      try {
        const pathMod = require('path');
        const fsMod = require('fs');
        const isWin = process.platform === 'win32';
        const exeDir = pathMod.dirname(process.execPath || process.argv[0] || process.cwd());
        const bundled = pathMod.join(exeDir, 'oracle-client');
        const bundledLib = pathMod.join(bundled, isWin ? 'bin' : 'lib');
        let libDir: string | null = null;
        if (fsMod.existsSync(bundledLib)) {
          libDir = bundledLib;
          process.env.ORACLE_HOME = bundled;
          logger.info('동봉 Oracle Client 감지', { bundled });
        } else if (process.env.ORACLE_HOME) {
          libDir = pathMod.join(process.env.ORACLE_HOME, isWin ? 'bin' : 'lib');
        }
        if (libDir) {
          this.oracledb.initOracleClient({ libDir });
          logger.info('Oracle thick 클라이언트 경로 지정', { libDir });
        }
      } catch (err) {
        logger.warn('initOracleClient 결과', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

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
      logger.error('Oracle 연결 실패', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
      logger.error('Oracle 연결 테스트 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      // 소유 테이블 + 뷰 + 시노님(synonym) 모두 노출한다.
      //   읽기전용 계정은 본인 소유 테이블이 0개이고, 타 스키마(예: ISUSER2)의 테이블을
      //   시노님 또는 뷰로만 노출하는 경우가 많다(예: CRM_VIEW_USER.고객 → ISUSER2.고객).
      //   user_tables만 보면 0개 감지되어 선택 자체가 불가했다(2026-06-30 isae 원격 설치 실측).
      //   데이터 조회(fetch*)는 `FROM "이름"`을 오라클이 시노님/뷰로 자동 해석하므로 이름만 노출하면 된다.
      const result = await conn.execute(
        `SELECT name FROM (
           SELECT table_name AS name FROM user_tables
           UNION
           SELECT view_name AS name FROM user_views
           UNION
           SELECT synonym_name AS name FROM user_synonyms
         ) ORDER BY name`,
      );
      return (result.rows || []).map((row: any) => row.NAME);
    } finally {
      await conn.close();
    }
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      // 선택한 이름이 시노님이면 실제 소유자/테이블로 해석해 all_* 메타에서 조회한다.
      //   user_tab_columns는 본인 소유 테이블만 보여 시노님 컬럼이 0개가 되기 때문이다.
      //   시노님이 아니면(직접 소유 테이블) 기존처럼 user_* 메타를 그대로 사용한다(동작 비악화).
      const synResult = await conn.execute(
        `SELECT table_owner, table_name FROM user_synonyms WHERE synonym_name = :name`,
        { name: tableName },
      );
      const synRow = (synResult.rows || [])[0] as any;
      const isSynonym = !!(synRow && synRow.TABLE_OWNER && synRow.TABLE_NAME);

      let colSql: string;
      let pkSql: string;
      let binds: Record<string, any>;
      if (isSynonym) {
        binds = { owner: synRow.TABLE_OWNER, tbl: synRow.TABLE_NAME };
        colSql = `SELECT
                    column_name,
                    data_type,
                    nullable,
                    data_length,
                    data_precision,
                    data_scale
                  FROM all_tab_columns
                  WHERE owner = :owner AND table_name = :tbl
                  ORDER BY column_id`;
        pkSql = `SELECT cols.column_name
                 FROM all_constraints cons
                 JOIN all_cons_columns cols
                   ON cons.constraint_name = cols.constraint_name AND cons.owner = cols.owner
                 WHERE cons.owner = :owner AND cons.table_name = :tbl AND cons.constraint_type = 'P'`;
      } else {
        binds = { tbl: tableName.toUpperCase() };
        colSql = `SELECT
                    column_name,
                    data_type,
                    nullable,
                    data_length,
                    data_precision,
                    data_scale
                  FROM user_tab_columns
                  WHERE table_name = :tbl
                  ORDER BY column_id`;
        pkSql = `SELECT cols.column_name
                 FROM user_constraints cons
                 JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
                 WHERE cons.table_name = :tbl AND cons.constraint_type = 'P'`;
      }

      const result = await conn.execute(colSql, binds);

      // PK 정보 조회
      const pkResult = await conn.execute(pkSql, binds);
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
      // Oracle 11g~12c+ 공통 페이지네이션 (OFFSET/FETCH는 12c+ 전용 → 11g에서 ORA-00933).
      const sql = `SELECT * FROM (
                     SELECT inner_.*, ROWNUM AS rnum_ FROM (
                       SELECT * FROM "${safeTable}"
                       WHERE "${safeColumn}" > TO_TIMESTAMP(:since, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
                       ORDER BY "${safeColumn}" ASC, ROWID ASC
                     ) inner_ WHERE ROWNUM <= :maxRow
                   ) WHERE rnum_ > :minRow`;

      const result = await conn.execute(sql, { since, maxRow: offset + limit, minRow: offset }, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
      });

      const rows = this.normalizeRows(result.rows || []);
      logger.debug(`증분 조회: ${rows.length}건`, { tableName, since, offset });
      return rows;
    } finally {
      await conn.close();
    }
  }

  // ─── 키셋 증분 (★ 2026-08-03 커서 재설계) ─────────────
  //
  // 커서 시각은 DB 원문 문자열로 왕복한다 — TO_CHAR로 만들고 같은 형식의 TO_TIMESTAMP/TO_DATE로 파싱.
  // JS Date를 거치지 않아 프로세스 TZ와 무관하고, 옛 `TO_TIMESTAMP(:since,'..."Z"')`가 UTC 문자열을
  // 벽시계로 오독하던 9시간 어긋남도 구조적으로 사라진다.
  // 바인드는 컬럼 타입에 맞춘다 — DATE 컬럼에 TIMESTAMP 상수를 대면 컬럼 쪽이 캐스트되어 인덱스를 못 탄다.

  /** 타임스탬프 컬럼 원시 타입 캐시(테이블.컬럼 → DATA_TYPE) */
  private tsTypeCache = new Map<string, string>();

  private async resolveRawColumnType(conn: any, tableName: string, columnName: string): Promise<string> {
    const cacheKey = `${tableName}.${columnName}`;
    const cached = this.tsTypeCache.get(cacheKey);
    if (cached) return cached;
    // 시노님이면 실제 소유자/테이블로 해석 — getColumns와 같은 이유(user_* 메타는 소유 테이블만 보인다).
    const synResult = await conn.execute(
      `SELECT table_owner, table_name FROM user_synonyms WHERE synonym_name = :name`,
      { name: tableName },
    );
    const synRow = (synResult.rows || [])[0] as any;
    let result;
    if (synRow && synRow.TABLE_OWNER && synRow.TABLE_NAME) {
      result = await conn.execute(
        `SELECT data_type FROM all_tab_columns WHERE owner = :owner AND table_name = :tbl AND column_name = :col`,
        { owner: synRow.TABLE_OWNER, tbl: synRow.TABLE_NAME, col: columnName.toUpperCase() },
      );
    } else {
      result = await conn.execute(
        `SELECT data_type FROM user_tab_columns WHERE table_name = :tbl AND column_name = :col`,
        { tbl: tableName.toUpperCase(), col: columnName.toUpperCase() },
      );
    }
    const row = (result.rows || [])[0] as any;
    if (!row || !row.DATA_TYPE) {
      throw new Error(`타임스탬프 컬럼 타입 조회 실패: ${tableName}.${columnName}`);
    }
    const t = String(row.DATA_TYPE).toUpperCase();
    this.tsTypeCache.set(cacheKey, t);
    return t;
  }

  /** 타입별 (원문 SELECT 식, 바인드 래퍼) — 변환은 항상 상수 쪽. */
  private tsFormats(rawType: string): {
    selectExpr: (colExpr: string) => string;
    wrapBind: (bindToken: string) => string;
  } {
    if (rawType === 'DATE') {
      return {
        selectExpr: (col) => `TO_CHAR(${col}, 'YYYY-MM-DD HH24:MI:SS')`,
        wrapBind: (t) => `TO_DATE(${t}, 'YYYY-MM-DD HH24:MI:SS')`,
      };
    }
    if (rawType.startsWith('TIMESTAMP') && rawType.includes('TIME ZONE')) {
      return {
        selectExpr: (col) => `TO_CHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM')`,
        wrapBind: (t) => `TO_TIMESTAMP_TZ(${t}, 'YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM')`,
      };
    }
    if (rawType.startsWith('TIMESTAMP')) {
      return {
        selectExpr: (col) => `TO_CHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.FF9')`,
        wrapBind: (t) => `TO_TIMESTAMP(${t}, 'YYYY-MM-DD HH24:MI:SS.FF9')`,
      };
    }
    throw new Error(
      `타임스탬프 컬럼이 날짜/시각 타입이 아닙니다(${rawType}) — --edit-config로 올바른 컬럼을 지정해주세요.`,
    );
  }

  private static readonly RAW_ALIAS = '__SYNC_TS_RAW__';

  /** PK 컬럼 원시 타입 캐시 — NUMBER는 문자열로 fetch해야 한다(JS number는 2^53 위에서 반올림 — Codex F6). */
  private pkTypeCache = new Map<string, Record<string, string>>();

  /**
   * PK 타입 검증 + 왕복 규약.
   *   NUMBER → fetchInfo로 문자열 추출 + 바인드는 TO_NUMBER(상수 쪽) — 인접 대형 PK가 같은 키가 되는
   *   반올림을 차단한다. 문자형은 그대로. 그 밖(RAW·FLOAT 등)은 정확 왕복이 불가하므로 명시 오류로 잠근다.
   */
  private async resolvePkBinding(
    conn: any,
    tableName: string,
    safePks: string[],
  ): Promise<{ fetchInfo: Record<string, any>; wrapKeyBind: (pkIdx: number, token: string) => string }> {
    const cacheKey = tableName;
    let types = this.pkTypeCache.get(cacheKey);
    if (!types) {
      types = {};
      for (const col of safePks) {
        types[col] = await this.resolveRawColumnType(conn, tableName, col);
      }
      this.pkTypeCache.set(cacheKey, types);
    }
    const fetchInfo: Record<string, any> = {};
    const isNumber: boolean[] = [];
    for (const col of safePks) {
      const t = types[col];
      if (t === 'NUMBER') {
        fetchInfo[col] = { type: this.oracledb.STRING };
        isNumber.push(true);
      } else if (['VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR'].includes(t)) {
        isNumber.push(false);
      } else {
        throw new Error(
          `증분 불가: PK 컬럼 '${col}' 타입(${t})은 정확한 커서 왕복을 지원하지 않습니다(NUMBER·문자형만).`,
        );
      }
    }
    return {
      fetchInfo,
      wrapKeyBind: (pkIdx, token) => (isNumber[pkIdx] ? `TO_NUMBER(${token})` : token),
    };
  }

  async fetchIncrementalKeyset(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    cursor: IncrementalCursor | null,
    limit: number,
  ): Promise<{ rows: RawRow[]; meta: RowCursorMeta[] }> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);
      const safeTs = this.sanitizeIdentifier(timestampColumn);
      const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
      const rawType = await this.resolveRawColumnType(conn, safeTable, safeTs);
      const fmt = this.tsFormats(rawType);
      const pkBind = await this.resolvePkBinding(conn, safeTable, safePks);
      const tsCol = `"${safeTs}"`;

      const binds: Record<string, any> = { maxRow: limit };
      let predicate = `${tsCol} IS NOT NULL`;
      if (cursor) {
        binds.cts = cursor.tsRaw;
        if (cursor.keys.length === 0) {
          // 열린 버킷 시작 커서 — 그 버킷 전체를 재조회한다(ts >=). 서버 멱등이 겹침을 흡수.
          predicate += ` AND ${tsCol} >= ${fmt.wrapBind(':cts')}`;
        } else {
          const bind = (name: string): string => {
            if (name === 'ts') return ':cts';
            const idx = Number(name.slice(1));
            binds[name] = cursor.keys[idx];
            return pkBind.wrapKeyBind(idx, `:${name}`);
          };
          predicate += ` AND ${buildKeysetPredicate(tsCol, fmt.wrapBind, bind, safePks.map((c) => `"${c}"`))}`;
        }
      }
      const orderBy = [`${tsCol} ASC`, ...safePks.map((c) => `"${c}" ASC`)].join(', ');

      // 11g 호환 ROWNUM 래퍼(기존 fetch 경로와 동일 이유). OFFSET 없음 — 커서가 페이지를 잇는다.
      const sql = `SELECT * FROM (
                     SELECT inner_.*, ROWNUM AS rnum_ FROM (
                       SELECT t.*, ${fmt.selectExpr(tsCol)} AS "${OracleConnector.RAW_ALIAS}"
                       FROM "${safeTable}" t
                       WHERE ${predicate}
                       ORDER BY ${orderBy}
                     ) inner_ WHERE ROWNUM <= :maxRow
                   )`;
      const result = await conn.execute(sql, binds, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: pkBind.fetchInfo,
      });
      const { cleanRows, meta } = extractRowCursorMeta(result.rows || [], OracleConnector.RAW_ALIAS, pkColumns);
      logger.debug(`키셋 증분 조회: ${meta.length}건`, { tableName, cursorTs: cursor?.tsRaw ?? null });
      return { rows: this.normalizeRows(cleanRows), meta };
    } finally {
      await conn.close();
    }
  }

  async fetchMaxCursor(
    tableName: string,
    timestampColumn: string,
    pkColumns: string[],
    beforeTsRawExclusive?: string | null,
  ): Promise<IncrementalCursor | null> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);
      const safeTs = this.sanitizeIdentifier(timestampColumn);
      const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
      const rawType = await this.resolveRawColumnType(conn, safeTable, safeTs);
      const fmt = this.tsFormats(rawType);
      const pkBind = await this.resolvePkBinding(conn, safeTable, safePks);
      const tsCol = `"${safeTs}"`;
      const orderBy = [`${tsCol} DESC`, ...safePks.map((c) => `"${c}" DESC`)].join(', ');
      const pkSelect = safePks.map((c) => `"${c}"`).join(', ');

      const binds: Record<string, any> = {};
      let where = `${tsCol} IS NOT NULL`;
      if (beforeTsRawExclusive) {
        binds.beforeTs = beforeTsRawExclusive;
        where += ` AND ${tsCol} < ${fmt.wrapBind(':beforeTs')}`;
      }
      const sql = `SELECT * FROM (
                     SELECT ${fmt.selectExpr(tsCol)} AS "${OracleConnector.RAW_ALIAS}"${pkSelect ? ', ' + pkSelect : ''}
                     FROM "${safeTable}"
                     WHERE ${where}
                     ORDER BY ${orderBy}
                   ) WHERE ROWNUM <= 1`;
      const result = await conn.execute(sql, binds, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: pkBind.fetchInfo,
      });
      const row = (result.rows || [])[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        tsRaw: String(row[OracleConnector.RAW_ALIAS] ?? ''),
        // 결과 키는 SELECT에 쓴(sanitize된) 이름이다 — 추출도 같은 이름으로.
        keys: safePks.map((c) => row[c]) as (string | number)[],
      };
    } finally {
      await conn.close();
    }
  }

  /** 접속 대상 식별자 — 커서 fingerprint 재료. username이 현재 스키마·시노님 해석을 정하므로 포함(2R F9). JSON = 경계 단사(3R F11). */
  getSourceId(): string {
    return JSON.stringify([this.config.host, this.config.port, this.config.database, this.config.username]);
  }

  /**
   * 전량 조회용 NUMBER PK 문자열 fetch 정보 (★ 2026-08-03 Codex 2R F8 · 3R F10).
   *   전량 경로도 PK 값으로 source_row_key를 만들므로, NUMBER PK가 JS number로 반올림되면
   *   2^53 초과 인접 PK가 같은 멱등키가 되어 서버 UPSERT가 한 구매를 삼킨다.
   *   메타 조회 실패는 **fail-closed** — 실패를 캐시하거나 무보정으로 진행하면 반올림 경로가
   *   프로세스 수명 동안 되살아난다(3R F10). 성공한 메타만 캐시하고, 실패는 그대로 던져
   *   그 전량 배치를 중단시킨다(다음 주기 재시도).
   */
  private pkFetchInfoCache = new Map<string, Record<string, any>>();

  private async pkFetchInfoForTable(tableName: string): Promise<Record<string, any>> {
    const cached = this.pkFetchInfoCache.get(tableName);
    if (cached) return cached;
    const info: Record<string, any> = {};
    const cols = await this.getColumns(tableName); // 실패 = throw (fail-closed, 캐시 없음)
    if (cols.length === 0) {
      // 0행도 성공이 아니다(4R F12) — 권한·메타 접근 이상이면 빈 배열이 정상 반환된다.
      //   이걸 성공으로 캐시하면 NUMBER PK 반올림 경로가 프로세스 수명 동안 되살아난다.
      throw new Error(`컬럼 메타 조회 결과가 비어 있습니다: ${tableName} — 권한 또는 테이블명을 확인해주세요.`);
    }
    for (const c of cols) {
      // mapOracleType: NUMBER → 'int' 또는 'decimal'
      if (c.isPrimaryKey && (c.dataType === 'int' || c.dataType === 'decimal')) {
        info[this.sanitizeIdentifier(c.name)] = { type: this.oracledb.STRING };
      }
    }
    this.pkFetchInfoCache.set(tableName, info);
    return info;
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const fetchInfo = await this.pkFetchInfoForTable(tableName);
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);

      // Oracle 11g~12c+ 공통 페이지네이션 (OFFSET/FETCH는 12c+ 전용 → 11g에서 ORA-00933).
      const sql = `SELECT * FROM (
                     SELECT inner_.*, ROWNUM AS rnum_ FROM (
                       SELECT * FROM "${safeTable}" ORDER BY ROWID
                     ) inner_ WHERE ROWNUM <= :maxRow
                   ) WHERE rnum_ > :minRow`;

      const result = await conn.execute(sql, { maxRow: offset + limit, minRow: offset }, {
        outFormat: this.oracledb.OUT_FORMAT_OBJECT,
        fetchInfo,
      });

      const rows = this.normalizeRows(result.rows || []);
      logger.debug(`전체 조회: ${rows.length}건`, { tableName, offset });
      return rows;
    } finally {
      await conn.close();
    }
  }

  /**
   * 전체 데이터 조회 (키셋 — ROWID 기준).
   * ★ 2026-06-30: 깊은 OFFSET 재스캔(이새 조기종료 원인)을 제거. afterKey(직전 마지막 ROWID)
   *   이후 행을 ROWID 순으로 limit개. 11g 호환(OFFSET/FETCH는 12c+)을 위해 ROWNUM 사용.
   *   CHARTOROWID(NULL)은 NULL을 반환하므로 afterKey=null 분기가 안전하다.
   */
  async fetchAllKeyset(
    tableName: string,
    limit: number,
    afterKey: string | null,
  ): Promise<{ rows: RawRow[]; lastKey: string | null }> {
    this.ensureConnected();
    // ★ 2026-08-03 Codex 2R F8 — 전량 경로도 NUMBER PK를 문자열로(멱등키 반올림 차단)
    const fetchInfo = await this.pkFetchInfoForTable(tableName);
    const conn = await this.pool.getConnection();
    try {
      const safeTable = this.sanitizeIdentifier(tableName);
      const sql = `SELECT * FROM (
                     SELECT t.*, ROWIDTOCHAR(t.ROWID) AS rid_
                     FROM "${safeTable}" t
                     WHERE (:afterKey IS NULL OR t.ROWID > CHARTOROWID(:afterKey))
                     ORDER BY t.ROWID
                   ) WHERE ROWNUM <= :lim`;
      const result = await conn.execute(
        sql,
        { afterKey: afterKey ?? null, lim: limit },
        { outFormat: this.oracledb.OUT_FORMAT_OBJECT, fetchInfo },
      );
      const raw = (result.rows || []) as Array<Record<string, unknown>>;
      const lastRaw = raw[raw.length - 1];
      const lastKey = lastRaw
        ? (String((lastRaw.RID_ ?? lastRaw.rid_) ?? '') || null)
        : null;
      const rows = this.normalizeRows(raw);
      logger.debug(`키셋 전체 조회: ${rows.length}건`, { tableName, afterKey });
      return { rows, lastKey };
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
        if (key === 'RNUM_') continue; // 11g 페이지네이션 헬퍼 컬럼 제외
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
