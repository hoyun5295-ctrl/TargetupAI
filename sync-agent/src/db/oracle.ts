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
import { buildKeysetPredicate, buildKeyTuplePredicate, extractRowCursorMeta, IncrementalCursor, RowCursorMeta } from './keyset';
import { getLogger } from '../logger';

const logger = getLogger('db:oracle');

/** ★ 2026-10-15 ROWID 를 못 주는 뷰(조인·집계)에 고유 키도 없을 때 — 전체 동기화를 페이지로 나눌 기준이 없다(D). */
const noRowidNoKeyMessage = (tableName: string): string =>
  `'${tableName}' 은(는) 행 위치(ROWID)를 줄 수 없는 뷰라서 고유 키 없이는 전체 동기화를 할 수 없습니다. ` +
  '설치 마법사를 다시 실행해 고유 컬럼(예: 회원번호, 전표번호+순번)을 지정해 주세요.';

// ★ 2026-10-14 thick 초기화는 프로세스당 한 번 — oracledb 5.x 엔 oracledb.thin 이 없어 두 번째 커넥터(마법사 접속 테스트 → 테이블 조회)가
//   initOracleClient 를 다시 부르면 예외다(같은 인자 재호출 허용은 6.0 부터 · Codex 3R). 성공했을 때만 기록해 실제 로드 실패는 다음 접속에서 다시 시도된다.
let thickInitialized = false;

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

      // 드라이버 모드 — thin(DB 12.1+ · 순수 JS · 12c 인증 지원) 과 thick(Oracle Client 필요 · 10g/11g 도 접속).
      //  ★ 2026-06-24: 고객 박스에 11.2+ 클라가 없어도(예: 10g만 설치) 연결되도록, 실행 파일 옆
      //    `oracle-client/` 폴더(동봉한 11.2 클라 = full home 서브셋)를 감지해 thick 으로 잡는다. 없으면 ORACLE_HOME 폴백.
      //    full home 서브셋이라 데이터 파일(NLS 등)을 찾도록 ORACLE_HOME 을 그 폴더로 함께 지정한다.
      //  ★ 2026-10-14 모드는 **접속 전에 설정(config.oracleClient)으로 정한다**(Codex 1R high).
      //    · "thin 먼저, 실패하면 thick" 은 못 쓴다 — createPool(poolMin 1) 은 11g 에도 thin 으로 일단 성공한 채 남아 그 뒤
      //      initOracleClient 가 NJS-118 로 막히고, 남은 thin 풀의 재접속 반복이 11g XE processes 를 2분 만에 소진했다(ORA-00020 · 2026-10-14 실측).
      //    · "동봉 클라가 있으면 무조건 thick" 도 못 쓴다 — Windows oracle zip 전부에 11.2 클라를 동봉하므로 12c+ 서버의
      //      SQLNET.ALLOWED_LOGON_VERSION_SERVER=12a 인증을 11.2 클라가 못 넘는다(ORA-28040).
      //    → 마법사(Oracle 버전 질문)·설정·--test-db --oracle-client 가 정한다. 미지정 = 옛 동작(동봉 클라·ORACLE_HOME 있으면 thick).
      //    node12 oracledb 5.x 는 thin 이 없어 늘 thick(동봉 클라 필수).
      const pathMod = require('path');
      const fsMod = require('fs');
      const isWin = process.platform === 'win32';
      const exeDir = pathMod.dirname(process.execPath || process.argv[0] || process.cwd());
      const bundled = pathMod.join(exeDir, 'oracle-client');
      const bundledLib = pathMod.join(bundled, isWin ? 'bin' : 'lib');
      const thickLibDir = (): string | null => {
        if (fsMod.existsSync(bundledLib)) { process.env.ORACLE_HOME = bundled; logger.info('동봉 Oracle Client 감지', { bundled }); return bundledLib; }
        if (process.env.ORACLE_HOME) return pathMod.join(process.env.ORACLE_HOME, isWin ? 'bin' : 'lib');
        return null;
      };
      const thinAvailable = typeof this.oracledb.thin === 'boolean'; // 6.x = thin 모드 존재 · 5.x(node12) = 없음
      const hasClient = fsMod.existsSync(bundledLib) || !!process.env.ORACLE_HOME;
      const mode: 'thick' | 'thin' = !thinAvailable ? 'thick' : (this.config.oracleClient ?? (hasClient ? 'thick' : 'thin'));
      // ★ 모드는 프로세스당 한 번만 정해진다(initOracleClient 는 되돌릴 수 없고, thin 접속을 한 번 만들면 thick 도 못 켠다 NJS-118).
      //   마법사에서 "11g 이하"로 시험한 뒤 "12c 이상"으로 바꿔 다시 시험하면(또는 반대) 같은 프로세스라 바뀌지 않는다 → 요청과 실제를 대조해
      //   어긋나면 마법사를 다시 실행하라고 분명히 말한다(Codex 2R · 조용히 옛 모드로 붙지 않는다).
      const RESTART_HINT = '설치 마법사(또는 이 명령)를 닫고 다시 실행한 뒤 Oracle DB 버전을 다시 고르세요. 드라이버 모드는 프로세스당 한 번만 정해집니다.';
      if (mode === 'thick') {
        const libDir = thickLibDir();
        if (!libDir) throw new Error('Oracle thick 클라이언트가 없습니다(동봉 oracle-client 도 ORACLE_HOME 도 없음). 10g·11g 는 Oracle Client 가 있어야 붙습니다');
        if (thickInitialized || this.oracledb.thin === false) {
          logger.info('Oracle thick 모드(10g·11g) · 이미 초기화됨', { libDir });
        } else {
          try {
            this.oracledb.initOracleClient({ libDir });
            thickInitialized = true;
            logger.info('Oracle thick 모드(10g·11g)', { libDir, oracleClient: this.config.oracleClient ?? '(미지정 → 클라 있음)' });
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            if (/NJS-118/.test(m)) throw new Error(`${m}\n→ 이 프로세스는 이미 thin(12c 이상)으로 접속한 적이 있어 11g 이하 방식으로 바꿀 수 없습니다. ${RESTART_HINT}`);
            // 클라이언트 로드 실패(DPI-1047 · VC++ 2005 런타임 없음 · 파일 손상)는 숨기지 않는다 — 여기서 삼키면 thin 으로 붙어 NJS-138 이 엉뚱하게 뜬다
            throw new Error(`${m}\n→ 동봉 Oracle Client 를 불러오지 못했습니다. oracle-client 폴더와 VC++ 2005 SP1 x64 런타임(diagnose.txt 의 VCREDIST_EXIT)을 확인하세요.`);
          }
        }
      } else {
        if (thickInitialized || this.oracledb.thin === false) {
          throw new Error(`이 프로세스는 이미 Oracle Client(11g 이하 방식)로 초기화돼 12c 이상(thin) 방식으로 바꿀 수 없습니다. ${RESTART_HINT}`);
        }
        logger.info('Oracle thin 모드(12c 이상)', { oracleClient: this.config.oracleClient ?? '(미지정 → 클라 없음)' });
      }

      this.oracledb.outFormat = this.oracledb.OUT_FORMAT_OBJECT;
      this.oracledb.autoCommit = true;
      this.oracledb.fetchAsString = [this.oracledb.CLOB];

      // 연결 문자열: host:port/database (Service Name 방식)
      const connectString = `${this.config.host}:${this.config.port}/${this.config.database}`;
      // 모드가 서버와 안 맞을 때의 두 오류에 설정으로 가는 길을 붙인다(--test-db JSON · 로그에 그대로 나온다)
      const withModeHint = (err: unknown): unknown => {
        const m = err instanceof Error ? err.message : String(err);
        if (/NJS-138/.test(m)) return new Error(`${m}\n→ 이 DB 는 12.1 미만입니다. 설정 database.oracleClient 를 'thick' 으로(마법사: Oracle DB 버전 = 11g 이하).`);
        if (/ORA-28040/.test(m)) return new Error(`${m}\n→ 서버가 11.2 클라이언트를 거부합니다(ALLOWED_LOGON_VERSION). 설정 database.oracleClient 를 'thin' 으로(마법사: Oracle DB 버전 = 12c 이상).`);
        return err;
      };
      const openPool = async () => this.oracledb.createPool({
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
      // ★ 2026-10-14 thin 은 풀보다 먼저 **단일 접속**으로 서버 세대를 확인한다 — createPool(poolMin 1) 은 11g 에도 "성공"한 채 남아
      //   그 뒤 getConnection 에서 NJS-138 이 나고, 그렇게 남은 풀의 재접속 반복이 11g 의 processes 를 소진한다(실측). 단일 접속은 NJS-138 로 즉시 끝나고 아무것도 남기지 않는다.
      if (mode === 'thin') {
        try {
          const probe = await this.oracledb.getConnection({ user: this.config.username, password: this.config.password, connectString });
          await probe.close();
        } catch (err) {
          throw withModeHint(err);
        }
      }
      this.pool = await openPool();

      // 연결 확인 + NLS 설정 검증 — 실패하면 풀을 닫고 던진다(반쯤 열린 접속을 들고 있지 않는다)
      try {
        const conn = await this.pool.getConnection();
        await conn.execute("ALTER SESSION SET NLS_LANGUAGE='KOREAN' NLS_TERRITORY='KOREA'");
        await conn.execute('SELECT 1 FROM DUAL');
        await conn.close();
      } catch (err) {
        const p = this.pool; this.pool = null;
        try { await p.close(0); } catch { /* 닫기 실패는 원래 오류를 가리지 않는다 */ }
        throw withModeHint(err);
      }

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

  /** ★ 2026-10-14 접속 실패는 이유째로 던진다 — false 로 접으면 모드 안내(NJS-138 · ORA-28040 · 재실행)가 마법사 응답·진단 JSON 에 닿지 않는다(Codex 3R).
   *  호출부 8곳(setup/server.ts ×3 · setup/cli.ts ×2 · setup/test-db.ts · index.ts · sync/engine.ts)은 모두 try/catch 로 message 를 받는다.
   *  connect() 가 이미 'Oracle 연결 실패' 를 로그한다. false = 붙었는데 검증 쿼리 결과가 없음. */
  async testConnection(): Promise<boolean> {
    const openedHere = !this.pool;
    await this.connect();
    try {
      const conn = await this.pool.getConnection();
      let result: any;
      try {
        result = await conn.execute('SELECT 1 AS test FROM DUAL');
      } catch (error) {
        // 검증 오류를 보존한다 — finally 로 두면 close() 의 실패(E2)가 검증 실패(E1)를 덮어 마법사·진단에 원인이 안 남는다(Codex 5R). close 실패는 보조 로그만.
        await conn.close().catch((e: unknown) => logger.warn('검증 커넥션 close 실패', { error: e instanceof Error ? e.message : String(e) }));
        throw error;
      }
      await conn.close(); // 검증이 성공한 뒤의 close 실패는 그대로 전파(정리 실패도 감지)
      return result.rows?.length > 0;
    } catch (error) {
      // 이 호출이 연 풀만 닫는다(마법사·CLI·진단의 임시 커넥터) — 종전엔 false 를 돌려줘 호출부가 disconnect() 를 불렀지만 예외 경로에선 못 부른다(Codex 4R).
      // 엔진이 공유하는(이미 열려 있던) 풀은 건드리지 않는다 — testSource() 의 일시 실패로 본 동기화 풀을 닫으면 안 된다.
      if (openedHere) await this.disconnect().catch(() => undefined);
      throw error;
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
      const own: string[] = (result.rows || []).map((row: any) => row.NAME);

      // ★ 2026-10-15 (엠티콜렉션) 시노님 없이 SELECT 권한만 받은 다른 스키마의 표·뷰를 `소유자.이름`으로 더한다(B).
      //   엠티 = 뷰 소유자 UBOB3_MTREAL · 읽기 계정 sync_reader 에 GRANT SELECT 만(매뉴얼 Oracle 절 그대로) → user_* 로는 0개라 마법사가 멈췄다.
      //   직접 권한 + 세션 역할 권한만 본다 — PUBLIC 권한까지 보면 시스템 뷰 수천 개가 목록에 쏟아진다.
      //   시퀀스에도 SELECT 권한이 붙어 그것만 뺀다. ⛔ all_objects 로 유형을 거르지 않는다 — 11g XE 실측에서
      //   그 조인이 189초를 넘겨도 안 끝났다(마법사가 목록 단계에서 멈춘다) · all_sequences 제외는 0.10초(2026-10-15 로컬 11g).
      //   이 조회가 실패해도 종전 목록은 그대로 돌려준다(기존 설치의 마법사를 깨지 않는다).
      let granted: string[] = [];
      try {
        const g = await conn.execute(
          `SELECT DISTINCT p.owner || '.' || p.table_name AS name
             FROM (SELECT owner, table_name FROM user_tab_privs
                    WHERE grantee = USER AND privilege = 'SELECT'
                   UNION
                   SELECT owner, table_name FROM role_tab_privs
                    WHERE privilege = 'SELECT' AND role IN (SELECT role FROM session_roles)) p
            WHERE p.owner <> USER
              AND NOT EXISTS (SELECT 1 FROM all_sequences s
                               WHERE s.sequence_owner = p.owner AND s.sequence_name = p.table_name)
            ORDER BY 1`,
        );
        granted = (g.rows || []).map((row: any) => row.NAME);
      } catch (err) {
        logger.warn('권한 받은 표·뷰 목록 조회 실패. 소유·시노님 목록만 씁니다', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const ownSet = new Set(own);
      return [...own, ...granted.filter((n) => !ownSet.has(n))];
    } finally {
      await conn.close();
    }
  }

  /**
   * ★ 2026-10-15 지정 키 유일성 실측(A) — 계약·반환 = types.ts countKeyUniqueness(mysql.ts 와 같은 판정).
   *   Oracle COUNT(DISTINCT)는 식 하나만 받아 복합 키(전표번호+순번)를 못 센다 → GROUP BY 한 번으로 셋을 같이 센다(뷰 1회 읽기).
   *   키가 하나라도 빈 행은 「서로 다른 키」에서 뺀다(MySQL COUNT(DISTINCT a,b) 와 같은 뜻).
   *   이 메서드가 없던 동안 마법사는 Oracle 뷰의 키 단계를 말없이 건너뛰었고(cli.ts designateKeyIfNoPk) 첫 전량 뒤 증분이 영구 잠겼다.
   */
  async countKeyUniqueness(tableName: string, keyColumns: string[]): Promise<{ total: number; distinct: number; nulls: number }> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const cols = keyColumns.map((c) => `"${this.sanitizeIdentifier(c)}"`);
      const hasNull = cols.map((c) => `${c} IS NULL`).join(' OR ');
      const result = await conn.execute(
        `SELECT NVL(SUM(cnt), 0) AS total,
                NVL(SUM(CASE WHEN has_null = 0 THEN 1 END), 0) AS distinct_keys,
                NVL(SUM(CASE WHEN has_null = 1 THEN cnt END), 0) AS null_keys
           FROM (SELECT COUNT(*) AS cnt,
                        CASE WHEN ${hasNull} THEN 1 ELSE 0 END AS has_null
                   FROM ${this.tableRef(tableName)}
                  GROUP BY ${cols.join(', ')})`,
      );
      const r = ((result.rows || [])[0] || {}) as Record<string, unknown>;
      return {
        total: Number(r.TOTAL) || 0,
        distinct: Number(r.DISTINCT_KEYS) || 0,
        nulls: Number(r.NULL_KEYS) || 0,
      };
    } finally {
      await conn.close();
    }
  }

  /**
   * ★ 2026-10-28 설치 값 확인(P2) — 계약 = types.ts countColumnValues · 뷰 1회 읽기(GROUP BY) · 상위 limit+1 행으로 넘침 판정.
   * 실행 시간 = timeoutMs 마감과 경주한다 — 마감이 먼저면 conn.break() 로 서버 쪽 실행 끊기를 시도하고 **끊기 성공 여부와 무관하게** 바로
   *   「시간 초과」로 던진다(Codex 구현 1R · 2R: break 가 실패해도 상한이 지켜진다). 남은 연결은 기다리지 않고 닫기만 걸고,
   *   부르는 쪽 disconnect 의 pool.close(0) 이 강제로 끝낸다.
   *   callTimeout 을 쓰지 않는 이유 = 동봉 Instant Client 11.2(thick)는 18 미만이라 callTimeout 을 받지 않는다(DPI-1050).
   */
  async countColumnValues(
    tableName: string, column: string, limit: number, timeoutMs: number,
  ): Promise<{ values: Array<{ value: string | null; count: number }>; truncated: boolean }> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutText = `값 세기 시간 초과(${Math.round(timeoutMs / 1000)}초)`;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        Promise.resolve().then(() => conn.break()).catch(() => { /* 끊기 실패여도 마감은 지킨다 */ });
        reject(new Error(timeoutText));
      }, timeoutMs);
    });
    try {
      const col = `"${this.sanitizeIdentifier(column)}"`;
      const exec = conn.execute(
        `SELECT v, n FROM (SELECT ${col} AS v, COUNT(*) AS n
                             FROM ${this.tableRef(tableName)}
                            GROUP BY ${col}
                            ORDER BY COUNT(*) DESC)
          WHERE ROWNUM <= :lim`,
        { lim: limit + 1 },
      );
      exec.catch(() => { /* 마감 뒤 늦게 끝나는 실행의 거절을 삼킨다(처리되지 않은 거절 방지) */ });
      let result: any;
      try {
        result = await Promise.race([exec, deadline]);
      } catch (e) {
        if (timedOut) throw new Error(timeoutText);
        throw e;
      }
      const rows = (result.rows || []) as Record<string, unknown>[];
      return {
        values: rows.slice(0, limit).map((r) => ({ value: r.V == null ? null : String(r.V), count: Number(r.N) || 0 })),
        truncated: rows.length > limit,
      };
    } finally {
      clearTimeout(timer);
      if (timedOut) conn.close().catch(() => { /* 실행이 남은 연결 · disconnect 의 pool.close(0) 이 끝낸다 */ });
      else await conn.close();
    }
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      // 선택한 이름이 시노님이거나 `소유자.이름`(★ 2026-10-15)이면 실제 소유자/테이블로 all_* 메타에서 조회한다.
      //   user_tab_columns는 본인 소유 테이블만 보여 시노님 컬럼이 0개가 되기 때문이다.
      //   그 밖(직접 소유 테이블)은 기존처럼 user_* 메타를 그대로 사용한다(동작 비악화).
      const owned = await this.resolveOwner(conn, tableName);

      let colSql: string;
      let pkSql: string;
      let binds: Record<string, any>;
      if (owned) {
        binds = { owner: owned.owner, tbl: owned.tbl };
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
        binds = { tbl: this.splitTableName(tableName).tbl.toUpperCase() };
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
      const safeColumn = this.sanitizeIdentifier(timestampColumn);

      // Oracle은 OFFSET/FETCH 구문 (12c+) 또는 ROWNUM 사용
      // 12c+ 기준으로 작성 (대부분 최신 Oracle 사용)
      // Oracle 11g~12c+ 공통 페이지네이션 (OFFSET/FETCH는 12c+ 전용 → 11g에서 ORA-00933).
      const sql = `SELECT * FROM (
                     SELECT inner_.*, ROWNUM AS rnum_ FROM (
                       SELECT * FROM ${this.tableRef(tableName)}
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
    // 시노님·`소유자.이름`이면 실제 소유자/테이블로 해석 — getColumns와 같은 해석(resolveOwner · user_* 메타는 소유 테이블만 보인다).
    const owned = await this.resolveOwner(conn, tableName);
    let result;
    if (owned) {
      result = await conn.execute(
        `SELECT data_type FROM all_tab_columns WHERE owner = :owner AND table_name = :tbl AND column_name = :col`,
        { owner: owned.owner, tbl: owned.tbl, col: columnName.toUpperCase() },
      );
    } else {
      result = await conn.execute(
        `SELECT data_type FROM user_tab_columns WHERE table_name = :tbl AND column_name = :col`,
        { tbl: this.splitTableName(tableName).tbl.toUpperCase(), col: columnName.toUpperCase() },
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
  ): Promise<{ fetchInfo: Record<string, any>; wrapKeyBind: (pkIdx: number, token: string) => string; isNumber: boolean[] }> {
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
      isNumber,
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
      // ★ 2026-10-15 메타 조회에는 원래 이름을 넘긴다 — sanitize 가 `소유자.이름`의 '.'을 지우면 메타를 못 찾는다(B).
      const safeTs = this.sanitizeIdentifier(timestampColumn);
      const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
      const rawType = await this.resolveRawColumnType(conn, tableName, safeTs);
      const fmt = this.tsFormats(rawType);
      const pkBind = await this.resolvePkBinding(conn, tableName, safePks);
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
                       FROM ${this.tableRef(tableName)} t
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
      const safeTs = this.sanitizeIdentifier(timestampColumn);
      const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
      const rawType = await this.resolveRawColumnType(conn, tableName, safeTs);
      const fmt = this.tsFormats(rawType);
      const pkBind = await this.resolvePkBinding(conn, tableName, safePks);
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
                     FROM ${this.tableRef(tableName)}
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

  private async pkFetchInfoForTable(tableName: string, keyColumns: string[] = []): Promise<Record<string, any>> {
    const cacheKey = keyColumns.length > 0 ? `${tableName}|${keyColumns.join(',')}` : tableName;
    const cached = this.pkFetchInfoCache.get(cacheKey);
    if (cached) return cached;
    const info: Record<string, any> = {};
    const cols = await this.getColumns(tableName); // 실패 = throw (fail-closed, 캐시 없음)
    if (cols.length === 0) {
      // 0행도 성공이 아니다(4R F12) — 권한·메타 접근 이상이면 빈 배열이 정상 반환된다.
      //   이걸 성공으로 캐시하면 NUMBER PK 반올림 경로가 프로세스 수명 동안 되살아난다.
      throw new Error(`컬럼 메타 조회 결과가 비어 있습니다: ${tableName} — 권한 또는 테이블명을 확인해주세요.`);
    }
    // ★ 2026-10-15 지정 키(뷰 · 엔진이 넘긴다)도 — 메타 PK 만 보던 때는 지정 키 NUMBER 가 JS number 로 와서
    //   16자리를 넘는 전표번호가 반올림됐다(이웃 전표 둘이 같은 원본 키 → 서버 UPSERT 가 한 건을 삼킨다). 증분 경로는 이미 문자열(resolvePkBinding).
    const extraKeys = new Set(keyColumns);
    for (const c of cols) {
      // mapOracleType: NUMBER → 'int' 또는 'decimal'
      if ((c.isPrimaryKey || extraKeys.has(c.name)) && (c.dataType === 'int' || c.dataType === 'decimal')) {
        info[this.sanitizeIdentifier(c.name)] = { type: this.oracledb.STRING };
      }
    }
    this.pkFetchInfoCache.set(cacheKey, info);
    return info;
  }

  /** 표마다 ROWID 를 줄 수 있는지(★ 2026-10-15 D) — 프로세스 안에서 기억한다. 「된다 · 안 된다」만 기억하고 그 밖 오류는 그대로 던진다(접속 끊김을 「ROWID 불가」로 오판하지 않는다). */
  private rowidCache = new Map<string, boolean>();

  private async rowidUsable(conn: any, tableName: string): Promise<boolean> {
    const hit = this.rowidCache.get(tableName);
    if (hit !== undefined) return hit;
    try {
      await conn.execute(`SELECT ROWIDTOCHAR(ROWID) AS rid_ FROM ${this.tableRef(tableName)} WHERE ROWNUM <= 1`);
      this.rowidCache.set(tableName, true);
      return true;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // ORA-01445 = 기준 표(key-preserved)가 없는 조인 뷰 · ORA-01446 = DISTINCT·GROUP BY 등이 있는 뷰
      if (!/ORA-0144[56]/.test(m)) throw err;
      logger.warn('행 위치(ROWID)를 줄 수 없는 뷰입니다. 전체 동기화를 고유 키 순서로 읽습니다', { tableName, error: m });
      this.rowidCache.set(tableName, false);
      return false;
    }
  }

  /**
   * ★ 2026-10-15 ROWID 없는 뷰의 전량 정렬 = 고유 키(메타 PK · 지정 키) 순서(D).
   *   문자 키는 이진 순서로 정렬한다 — 비교(>)는 NLS_COMP(기본 BINARY)를, ORDER BY 는 NLS_SORT(세션 NLS_LANGUAGE 에서 파생)를 따라
   *   둘이 어긋나면 키셋 페이지 사이에서 행을 건너뛴다. 숫자 키는 문자열로 받고 TO_NUMBER 로 바인드한다(resolvePkBinding).
   */
  private async keyOrder(conn: any, tableName: string, keyColumns: string[]): Promise<{
    safeKeys: string[];
    keyExprs: string[];
    pkBind: { wrapKeyBind: (pkIdx: number, token: string) => string; isNumber: boolean[] };
    orderBy: string;
  }> {
    const safeKeys = keyColumns.map((c) => this.sanitizeIdentifier(c));
    const keyExprs = safeKeys.map((c) => `"${c}"`);
    const pkBind = await this.resolvePkBinding(conn, tableName, safeKeys);
    const orderBy = keyExprs.map((c, i) => (pkBind.isNumber[i] ? c : `NLSSORT(${c}, 'NLS_SORT=BINARY')`)).join(', ');
    return { safeKeys, keyExprs, pkBind, orderBy };
  }

  async fetchAll(
    tableName: string,
    limit: number,
    offset: number,
    keyColumns: string[] = [],
  ): Promise<RawRow[]> {
    this.ensureConnected();
    const fetchInfo = await this.pkFetchInfoForTable(tableName, keyColumns);
    const conn = await this.pool.getConnection();
    try {
      // ★ 2026-10-15 정렬 기준(D): ROWID 가 되면 ROWID(종전 그대로) · 안 되는 뷰는 고유 키 · 둘 다 없으면 1행 미리보기만(engine previewMapping).
      //   동기화 페이지는 최소 100행(schema.ts batchSize)이라 1행 예외에 걸리지 않는다 — 정렬 없이 여러 페이지를 넘기면 행이 겹치거나 빠진다.
      let orderBy: string;
      if (await this.rowidUsable(conn, tableName)) orderBy = ' ORDER BY ROWID';
      else if (keyColumns.length > 0) orderBy = ` ORDER BY ${(await this.keyOrder(conn, tableName, keyColumns)).orderBy}`;
      else if (limit === 1 && offset === 0) orderBy = '';
      else throw new Error(noRowidNoKeyMessage(tableName));

      // Oracle 11g~12c+ 공통 페이지네이션 (OFFSET/FETCH는 12c+ 전용 → 11g에서 ORA-00933).
      const sql = `SELECT * FROM (
                     SELECT inner_.*, ROWNUM AS rnum_ FROM (
                       SELECT * FROM ${this.tableRef(tableName)}${orderBy}
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
    keyColumns: string[] = [],
  ): Promise<{ rows: RawRow[]; lastKey: string | null }> {
    this.ensureConnected();
    // ★ 2026-08-03 Codex 2R F8 — 전량 경로도 NUMBER PK를 문자열로(멱등키 반올림 차단) · ★ 2026-10-15 지정 키도
    const fetchInfo = await this.pkFetchInfoForTable(tableName, keyColumns);
    const conn = await this.pool.getConnection();
    try {
      const ref = this.tableRef(tableName);
      if (await this.rowidUsable(conn, tableName)) {
        const sql = `SELECT * FROM (
                       SELECT t.*, ROWIDTOCHAR(t.ROWID) AS rid_
                       FROM ${ref} t
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
      }

      // ★ 2026-10-15 ROWID 를 못 주는 뷰(조인·집계 · ORA-01445/01446) = 고유 키 순서로 읽는다(D).
      //   afterKey = 직전 페이지 마지막 행의 키 값 JSON — 엔진은 열어 보지 않고 되돌려 줄 뿐이다(engine full()).
      //   키가 빈 행은 읽지 않는다: 빈 키가 페이지 끝에 오면 다음 비교가 전부 거짓이 돼 거기서 끝나 버린다.
      //   설치 때 유일성 검사(A)가 빈 키를 막고, 그 뒤 생긴 빈 키 행은 엔진의 완전성 경고(수신 < 총건수)가 알린다.
      // ponytail: 복잡한 뷰는 페이지마다 뷰 전체를 다시 계산·정렬할 수 있다(120만 행 ≈ 300페이지). 첫 전량·원격 재싱크만 해당(증분은 바뀐 행만). 느리면 페이지 크기부터.
      if (keyColumns.length === 0) throw new Error(noRowidNoKeyMessage(tableName));
      const { safeKeys, keyExprs, pkBind, orderBy } = await this.keyOrder(conn, tableName, keyColumns);
      const binds: Record<string, any> = { lim: limit };
      const conds = keyExprs.map((c) => `${c} IS NOT NULL`);
      if (afterKey) {
        const prev = JSON.parse(afterKey) as (string | number)[];
        conds.push(`(${buildKeyTuplePredicate((name) => {
          const i = Number(name.slice(1));
          binds[name] = prev[i];
          return pkBind.wrapKeyBind(i, `:${name}`);
        }, keyExprs)})`);
      }
      const sql = `SELECT * FROM (
                     SELECT t.* FROM ${ref} t
                     WHERE ${conds.join(' AND ')}
                     ORDER BY ${orderBy}
                   ) WHERE ROWNUM <= :lim`;
      const result = await conn.execute(sql, binds, { outFormat: this.oracledb.OUT_FORMAT_OBJECT, fetchInfo });
      const raw = (result.rows || []) as Array<Record<string, unknown>>;
      const lastRaw = raw[raw.length - 1];
      const lastKey = lastRaw ? JSON.stringify(safeKeys.map((c) => lastRaw[c])) : null;
      const rows = this.normalizeRows(raw);
      logger.debug(`키 순서 전체 조회: ${rows.length}건`, { tableName, afterKey });
      return { rows, lastKey };
    } finally {
      await conn.close();
    }
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    const conn = await this.pool.getConnection();
    try {
      const result = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM ${this.tableRef(tableName)}`,
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

  /**
   * ★ 2026-10-15 표 이름 해석 — `소유자.이름`(권한만 받은 다른 스키마 · getTables 가 만든 형식)이면 둘로 나눈다(B).
   *   종전에는 sanitize 가 '.'을 지워 "소유자이름" 한 덩어리가 됐다. 점이 없으면 종전 그대로(owner = null).
   */
  private splitTableName(name: string): { owner: string | null; tbl: string } {
    const parts = name.split('.').map((p) => this.sanitizeIdentifier(p));
    if (parts.length > 2 || parts.some((p) => p === '')) {
      throw new Error(`표 이름 형식이 올바르지 않습니다: ${name} (이름 또는 소유자.이름)`);
    }
    return parts.length === 2 ? { owner: parts[0], tbl: parts[1] } : { owner: null, tbl: parts[0] };
  }

  /** SQL 에 넣는 표 식별자 — "이름" 또는 "소유자"."이름" */
  private tableRef(name: string): string {
    const { owner, tbl } = this.splitTableName(name);
    return owner ? `"${owner}"."${tbl}"` : `"${tbl}"`;
  }

  /**
   * 메타(all_* · user_*)를 볼 실제 소유자·이름 — getColumns·타입 조회 공용(★ 2026-10-15 두 곳에 따로 있던 시노님 해석을 하나로).
   *   `소유자.이름` → 그대로 / 시노님 → 대상 / 그 밖 = null(자기 소유 → user_* 메타).
   */
  private async resolveOwner(conn: any, name: string): Promise<{ owner: string; tbl: string } | null> {
    const { owner, tbl } = this.splitTableName(name);
    if (owner) return { owner, tbl };
    const syn = await conn.execute(
      `SELECT table_owner, table_name FROM user_synonyms WHERE synonym_name = :name`,
      { name: tbl },
    );
    const r = (syn.rows || [])[0] as any;
    return r && r.TABLE_OWNER && r.TABLE_NAME ? { owner: r.TABLE_OWNER, tbl: r.TABLE_NAME } : null;
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
