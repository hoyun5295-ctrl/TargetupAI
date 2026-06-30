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
                       ORDER BY "${safeColumn}" ASC
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

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
  ): Promise<RawRow[]> {
    this.ensureConnected();
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
        { outFormat: this.oracledb.OUT_FORMAT_OBJECT },
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
