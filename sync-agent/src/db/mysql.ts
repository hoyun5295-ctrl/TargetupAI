/**
 * MySQL 커넥터 (mysql2)
 * 중소형 POS/ERP 시스템 — MariaDB도 호환
 *
 * 변경사항 (2026-02-24 v3):
 *   - 이중 인코딩 감지 방식 변경: byte/char ratio(오류) → 실제 데이터 fix 후 한글 검증
 *   - cp1252 역매핑으로 이중 인코딩 복원 (test-encoding.js로 검증 완료)
 *   - 감지 흐름: 샘플 데이터 읽기 → fixDoubleEncodedString 적용 → 한글 유니코드 포함? → 확정
 */

import mysql from 'mysql2/promise';
import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { singleColumnPk } from './types';
// ★ 2026-08-03 커서 재설계 — 키셋 술어·행 커서 성분 추출(순수 공용 모듈)
import { buildKeysetPredicate, extractRowCursorMeta, IncrementalCursor, RowCursorMeta } from './keyset';
import { resolveDbSslOption } from './ssl';
import { getLogger } from '../logger';

const logger = getLogger('db:mysql');

/** 키셋 증분의 타임스탬프 원문 별칭 — payload로 새면 안 되는 내부 컬럼 */
const MYSQL_TS_RAW_ALIAS = '__sync_ts_raw__';

// ─── MySQL latin1 = cp1252 역매핑 테이블 ────────────────────
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * 이중 인코딩된 문자열을 원래 UTF-8로 복원
 * 각 문자 → cp1252 바이트 역매핑 → UTF-8 디코딩
 */
function fixDoubleEncodedString(str: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i)!;
    if (cp <= 0xff) {
      bytes.push(cp);
    } else if (CP1252_TO_BYTE[cp] !== undefined) {
      bytes.push(CP1252_TO_BYTE[cp]);
    } else {
      return str; // cp1252 범위 밖 → 이중 인코딩 아님
    }
    if (cp > 0xffff) i++;
  }
  try {
    const decoded = Buffer.from(bytes).toString('utf8');
    if (decoded.includes('\ufffd')) return str;
    return decoded;
  } catch {
    return str;
  }
}

/** 한글 음절(가~힣) 포함 여부 */
function containsKorean(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return true; // 한글 음절
    if (c >= 0x3131 && c <= 0x318e) return true; // 한글 자모
  }
  return false;
}

/**
 * 키셋 커서를 **정확히 비교할 수 있는** PK 타입 — 정수 계열만.
 * MySQL은 정수 컬럼과 문자열 상수를 비교할 때 문자열을 double로 바꿔 2^53 초과에서 어긋나므로
 * `CAST(? AS DECIMAL(65,0))`으로 넘긴다.
 * 소수 계열(decimal·numeric·float·double)은 넣지 않는다(Codex 3R-1) —
 * 스케일을 모르는 채 DECIMAL(65,0)으로 캐스팅하면 소수부가 잘려 커서가 앞 행을 다시 읽거나 건너뛴다.
 * 그런 PK는 키셋을 포기하고 OFFSET 경로로 폴백하는 것이 안전하다.
 */
const MYSQL_KEYSET_PK_TYPES = new Set([
  'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
]);

/** 키셋 커서 전용 별칭. 고객 테이블에 같은 이름의 컬럼이 실재하면 키셋을 쓰지 않는다(Codex 3R-2). */
const KEYSET_CURSOR_ALIAS = '__sync_keyset_cursor__';

function hasNonAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 127) return true;
  }
  return false;
}

export class MysqlConnector implements IDbConnector {
  readonly dbType = 'mysql' as const;
  private pool: mysql.Pool | null = null;
  private config: DbConnectionConfig;
  private needsEncodingFix = false;

  constructor(config: DbConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.pool) return;

    try {
      // ★ 2026-07-27 TLS 강제 DB(Aurora/RDS 등) 대응 — ssl 미설정 시 undefined라 기존 평문 동작 그대로.
      const ssl = resolveDbSslOption(this.config);
      this.pool = mysql.createPool({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.username,
        password: this.config.password,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        connectTimeout: 10000,
        charset: 'utf8mb4',
        // ★ 2026-07-27 (Codex 2R-2 후속 실측) BIGINT/DECIMAL 정밀도 보존.
        //   mysql2 기본값은 BIGINT를 JS Number로 주므로 2^53을 넘으면 값이 깎인다
        //   (실측: 9007199254740993 → …992, 9223372036854775806 → …776000).
        //   회원번호 같은 큰 정수 컬럼이 그대로 한줄로에 저장되면 원본과 다른 값이 된다.
        //   supportBigNumbers만 켜면 **정확히 표현 못 할 때만** 문자열로 오므로
        //   기존 작은 정수 컬럼의 타입(number)은 그대로 유지된다.
        supportBigNumbers: true,
        ...(ssl ? { ssl } : {}),
      });

      const conn = await this.pool.getConnection();

      // ── charset 환경 로그 ────────────────────────────────────
      const [globalRows] = await conn.query(
        'SELECT @@global.character_set_client AS gcc, @@character_set_database AS csdb',
      );
      const globalInfo = (globalRows as any[])[0];

      logger.info('MySQL charset 환경', {
        global_client: globalInfo.gcc,
        database: globalInfo.csdb,
      });

      // ── 이중 인코딩 감지: 항상 실제 데이터로 검증 ─────────────
      // charset 조합 조건에 의존하지 않음
      // (mysql2가 session charset을 변경하므로 global 값이 실제와 다를 수 있음)
      logger.info('이중 인코딩 여부 실제 데이터 검증 시작');
      this.needsEncodingFix = await this.verifyDoubleEncoding(conn);

      conn.release();

      const mode = this.needsEncodingFix
        ? '⚠️ 이중 인코딩 보정 활성화'
        : '✅ 정상 (utf8mb4)';
      logger.info(`MySQL 연결 성공 [${mode}]`, {
        host: this.config.host,
        database: this.config.database,
        needsEncodingFix: this.needsEncodingFix,
        // 암호화 여부를 로그에 남긴다 — "TLS로 붙은 줄 알았는데 평문"을 나중에 판별할 수 있어야 한다.
        tls: ssl ? (ssl.rejectUnauthorized ? 'on(인증서 검증)' : 'on(검증 생략)') : 'off',
      });
    } catch (error) {
      logger.error('MySQL 연결 실패', { error });
      throw error;
    }
  }

  /**
   * 실제 데이터로 이중 인코딩 검증
   *
   * 방법: 비ASCII 데이터를 하나 읽어서 fixDoubleEncodedString 적용
   *       → 결과에 한글이 포함되면 이중 인코딩 확정
   *       → 원본 자체에 이미 한글이 있으면 정상
   */
  private async verifyDoubleEncoding(conn: mysql.PoolConnection): Promise<boolean> {
    try {
      // varchar 컬럼 목록 조회
      const [cols] = await conn.query(`
        SELECT TABLE_NAME, COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND DATA_TYPE IN ('varchar', 'char', 'text')
          AND CHARACTER_MAXIMUM_LENGTH > 1
        LIMIT 20
      `);

      for (const col of cols as any[]) {
        const safeTable = col.TABLE_NAME.replace(/[^a-zA-Z0-9_]/g, '');
        const safeCol = col.COLUMN_NAME.replace(/[^a-zA-Z0-9_]/g, '');

        try {
          // 비ASCII 데이터가 있는 행 하나 조회
          const [rows] = await conn.query(
            `SELECT \`${safeCol}\` AS val FROM \`${safeTable}\`
             WHERE \`${safeCol}\` > '' AND \`${safeCol}\` != CONVERT(\`${safeCol}\` USING ASCII)
             LIMIT 1`,
          );

          const row = (rows as any[])[0];
          if (!row || !row.val) continue;

          const original = row.val as string;

          // 원본에 이미 한글이 있으면 → 정상 인코딩
          if (containsKorean(original)) {
            logger.info(`✅ 정상 인코딩 확인: ${safeTable}.${safeCol} 원본에 한글 존재`, {
              sample: original.substring(0, 20),
            });
            return false;
          }

          // fix 적용 후 한글이 나오면 → 이중 인코딩 확정
          const fixed = fixDoubleEncodedString(original);
          if (containsKorean(fixed)) {
            logger.warn(`⚠️ 이중 인코딩 확정: ${safeTable}.${safeCol}`, {
              original: original.substring(0, 30),
              fixed: fixed.substring(0, 30),
            });
            return true;
          }
        } catch {
          continue;
        }
      }

      logger.info('이중 인코딩 검증: 한글 데이터 없음 → 정상으로 간주');
      return false;
    } catch (error) {
      logger.warn('이중 인코딩 검증 실패 → 정상으로 간주', { error });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.needsEncodingFix = false;
      logger.info('MySQL 연결 해제');
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      const [rows] = await this.pool!.query('SELECT 1 AS test');
      return (rows as Record<string, unknown>[])[0]?.test === 1;
    } catch (error) {
      logger.error('MySQL 연결 테스트 실패', { error });
      return false;
    }
  }

  async getTables(): Promise<string[]> {
    this.ensureConnected();
    const [rows] = await this.pool!.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    return (rows as Record<string, unknown>[]).map((r) => r.TABLE_NAME as string);
  }

  async getColumns(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const [rows] = await this.pool!.query(
      `
      SELECT 
        c.COLUMN_NAME as name,
        c.DATA_TYPE as dataType,
        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
        c.CHARACTER_MAXIMUM_LENGTH as maxLength,
        CASE WHEN c.COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END as isPrimaryKey
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION
    `,
      [tableName],
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
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

    const safeTable = this.sanitizeIdentifier(tableName);
    const safeColumn = this.sanitizeIdentifier(timestampColumn);

    const sinceLocal = new Date(since)
      .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })
      .replace('T', ' ');

    // ★ 2026-06-30: 동일 타임스탬프가 배치 경계에 몰리면 OFFSET이 건너뜀/중복 → 단일 PK 타이브레이커로 결정적 순서.
    const pk = await this.resolvePk(tableName);
    const tieBreak = pk ? `, \`${this.sanitizeIdentifier(pk)}\` ASC` : '';
    const [rows] = await this.pool!.query(
      `SELECT * FROM \`${safeTable}\`
       WHERE \`${safeColumn}\` > ?
       ORDER BY \`${safeColumn}\` ASC${tieBreak}
       LIMIT ? OFFSET ?`,
      [sinceLocal, limit, offset],
    );

    const result = rows as RawRow[];
    logger.debug(`증분 조회: ${result.length}건`, { tableName, since, offset });
    return this.fixRowEncoding(result);
  }

  // ─── 키셋 증분 (★ 2026-08-03 커서 재설계) ─────────────
  //
  // 커서 시각은 DB 원문 문자열로 왕복한다 — DATE_FORMAT으로 만들고 같은 자리(CAST 상수)로 되돌린다.
  // 옛 경로의 `new Date(since).toLocaleString(... 'Asia/Seoul')` KST 수동 변환이 통째로 사라진다.
  // 커서 성분은 **인코딩 보정 전 원본**에서 뽑는다(fetchAllKeyset 커서와 같은 이유 — 보정값이 커서로
  // 나가면 WHERE가 안 맞는다).

  /** 타임스탬프 컬럼 원시 타입 캐시 */
  private tsTypeCache = new Map<string, string>();

  private async resolveRawColumnType(tableName: string, columnName: string): Promise<string> {
    const cacheKey = `${tableName}.${columnName}`;
    const cached = this.tsTypeCache.get(cacheKey);
    if (cached) return cached;
    const [rows] = await this.pool!.query(
      `SELECT DATA_TYPE AS dataType FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName],
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row || !row.dataType) {
      throw new Error(`타임스탬프 컬럼 타입 조회 실패: ${tableName}.${columnName}`);
    }
    const t = String(row.dataType).toLowerCase();
    this.tsTypeCache.set(cacheKey, t);
    return t;
  }

  /** 타입별 (원문 SELECT 식, 바인드 래퍼) — 변환은 항상 상수 쪽(컬럼 쪽 캐스트 = 인덱스 불가). */
  private tsFormats(rawType: string): {
    selectExpr: (colExpr: string) => string;
    wrapBind: (bindToken: string) => string;
  } {
    if (rawType === 'date') {
      return {
        selectExpr: (col) => `DATE_FORMAT(${col}, '%Y-%m-%d')`,
        wrapBind: (t) => `CAST(${t} AS DATE)`,
      };
    }
    if (rawType === 'datetime' || rawType === 'timestamp') {
      return {
        selectExpr: (col) => `DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s.%f')`,
        wrapBind: (t) => `CAST(${t} AS DATETIME(6))`,
      };
    }
    throw new Error(
      `타임스탬프 컬럼이 날짜/시각 타입이 아닙니다(${rawType}) — --edit-config로 올바른 컬럼을 지정해주세요.`,
    );
  }

  /** PK 컬럼 원시 타입 캐시 + 바인드 규약 — 정수 PK는 DECIMAL(65,0) 캐스트(문자열 비교는 2^53 위에서 근사 — Codex F5). */
  private pkTypeCache2 = new Map<string, Record<string, string>>();

  private static readonly PK_INT_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'bigint']);
  private static readonly PK_CHAR_TYPES = new Set(['char', 'varchar']);

  private async resolvePkBinding(
    tableName: string,
    safePks: string[],
  ): Promise<{ wrapKeyBind: (pkIdx: number, token: string) => string }> {
    let types = this.pkTypeCache2.get(tableName);
    if (!types) {
      types = {};
      for (const col of safePks) {
        types[col] = await this.resolveRawColumnType(tableName, col);
      }
      this.pkTypeCache2.set(tableName, types);
    }
    const isInt: boolean[] = [];
    for (const col of safePks) {
      const t = types[col];
      if (MysqlConnector.PK_INT_TYPES.has(t)) isInt.push(true);
      else if (MysqlConnector.PK_CHAR_TYPES.has(t)) isInt.push(false);
      else {
        throw new Error(
          `증분 불가: PK 컬럼 '${col}' 타입(${t})은 정확한 커서 왕복을 지원하지 않습니다(정수·문자형만).`,
        );
      }
    }
    return {
      wrapKeyBind: (pkIdx, token) => (isInt[pkIdx] ? `CAST(${token} AS DECIMAL(65,0))` : token),
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
    const safeTable = this.sanitizeIdentifier(tableName);
    const safeTs = this.sanitizeIdentifier(timestampColumn);
    const safePks = pkColumns.map((c) => this.sanitizeIdentifier(c));
    const rawType = await this.resolveRawColumnType(safeTable, safeTs);
    const fmt = this.tsFormats(rawType);
    const pkBind = await this.resolvePkBinding(safeTable, safePks);
    const tsCol = `\`${safeTs}\``;

    const params: unknown[] = [];
    let predicate = `${tsCol} IS NOT NULL`;
    if (cursor) {
      if (cursor.keys.length === 0) {
        // 열린 버킷 시작 커서 — 그 버킷 전체를 재조회한다(ts >=). 서버 멱등이 겹침을 흡수.
        params.push(cursor.tsRaw);
        predicate += ` AND ${tsCol} >= ${fmt.wrapBind('?')}`;
      } else {
        // 위치 기반 ? — bind 호출 시점에 push해 SQL 텍스트 순서와 값 순서를 맞춘다.
        const bind = (name: string): string => {
          if (name === 'ts') { params.push(cursor.tsRaw); return '?'; }
          const idx = Number(name.slice(1));
          params.push(cursor.keys[idx]);
          return pkBind.wrapKeyBind(idx, '?');
        };
        predicate += ` AND ${buildKeysetPredicate(tsCol, fmt.wrapBind, bind, safePks.map((c) => `\`${c}\``))}`;
      }
    }
    const orderBy = [`${tsCol} ASC`, ...safePks.map((c) => `\`${c}\` ASC`)].join(', ');
    params.push(limit);

    const [rows] = await this.pool!.query(
      `SELECT t.*, ${fmt.selectExpr(tsCol)} AS \`${MYSQL_TS_RAW_ALIAS}\`
         FROM \`${safeTable}\` t
        WHERE ${predicate}
        ORDER BY ${orderBy}
        LIMIT ?`,
      params,
    );
    const { cleanRows, meta } = extractRowCursorMeta(rows as Record<string, unknown>[], MYSQL_TS_RAW_ALIAS, pkColumns);
    logger.debug(`키셋 증분 조회: ${meta.length}건`, { tableName, cursorTs: cursor?.tsRaw ?? null });
    return { rows: this.fixRowEncoding(cleanRows as RawRow[]), meta };
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
    const rawType = await this.resolveRawColumnType(safeTable, safeTs);
    const fmt = this.tsFormats(rawType);
    // 타입 검증(미지원 PK 조기 거부)
    await this.resolvePkBinding(safeTable, safePks);
    const tsCol = `\`${safeTs}\``;
    const orderBy = [`${tsCol} DESC`, ...safePks.map((c) => `\`${c}\` DESC`)].join(', ');
    const pkSelect = safePks.map((c) => `\`${c}\``).join(', ');

    const params: unknown[] = [];
    let where = `${tsCol} IS NOT NULL`;
    if (beforeTsRawExclusive) {
      params.push(beforeTsRawExclusive);
      where += ` AND ${tsCol} < ${fmt.wrapBind('?')}`;
    }
    const [rows] = await this.pool!.query(
      `SELECT ${fmt.selectExpr(tsCol)} AS \`${MYSQL_TS_RAW_ALIAS}\`${pkSelect ? ', ' + pkSelect : ''}
         FROM \`${safeTable}\`
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT 1`,
      params,
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      tsRaw: String(row[MYSQL_TS_RAW_ALIAS] ?? ''),
      keys: safePks.map((c) => row[c]) as (string | number)[],
    };
  }

  /** 접속 대상 식별자 — 커서 fingerprint 재료. 계정까지 포함(2R F9와 같은 축). JSON = 경계 단사(3R F11). */
  getSourceId(): string {
    return JSON.stringify([this.config.host, this.config.port, this.config.database, this.config.username]);
  }

  /** 단일 PK 캐시 — 전체 동기화 안정 정렬 키 (매 배치 메타 조회 방지). */
  private pkCache = new Map<string, string | null>();
  /** 키셋 사용 가능 여부 — 정수 PK이고 커서 별칭과 충돌하지 않을 때만 true. */
  private keysetOkCache = new Map<string, boolean>();

  private async resolvePk(tableName: string): Promise<string | null> {
    const cached = this.pkCache.get(tableName);
    if (cached !== undefined) return cached;
    let pk: string | null = null;
    try {
      const cols = await this.getColumns(tableName);
      pk = singleColumnPk(cols);
      if (pk) {
        const t = String(cols.find((c) => c.name === pk)?.dataType || '').toLowerCase();
        // 정수 PK가 아니거나(소수 절삭 위험) 커서 별칭과 같은 이름의 컬럼이 실재하면(payload 손실 위험)
        // 키셋을 쓰지 않는다. 두 경우 모두 엔진이 OFFSET 경로로 폴백한다.
        const aliasClash = cols.some((c) => c.name === KEYSET_CURSOR_ALIAS);
        this.keysetOkCache.set(tableName, MYSQL_KEYSET_PK_TYPES.has(t) && !aliasClash);
      } else {
        this.keysetOkCache.set(tableName, false);
      }
    } catch {
      pk = null;
      this.keysetOkCache.set(tableName, false);
    }
    this.pkCache.set(tableName, pk);
    return pk;
  }

  async fetchAll(tableName: string, limit: number, offset: number): Promise<RawRow[]> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    // ★ 2026-06-30: OFFSET 페이지네이션은 안정 정렬이 없으면 깊은 구간에서 행 건너뜀/중복.
    //   단일 PK 기준 ORDER BY로 결정적 순서 보장(없으면 정렬 생략 — 엔진 완전성 가드가 누락 감지).
    const pk = await this.resolvePk(tableName);
    const orderBy = pk ? `ORDER BY \`${this.sanitizeIdentifier(pk)}\` ASC` : '';

    const [rows] = await this.pool!.query(
      `SELECT * FROM \`${safeTable}\` ${orderBy} LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    const result = rows as RawRow[];
    logger.debug(`전체 조회: ${result.length}건`, { tableName, offset });
    return this.fixRowEncoding(result);
  }

  /**
   * 키셋(안정 키) 전체 조회 — **정수 단일 PK 테이블 전용**.
   *
   * 배경: 2026-06-30 이새에프앤씨 전체동기화 조기 종료의 근본 정정이 키셋인데 oracle에만 있었다.
   * 깊은 OFFSET 재스캔이 없어 동기화 중 앞쪽 행이 삽입·삭제돼도 건너뛰지 않는다.
   *
   * 아래는 **던져서** 엔진이 OFFSET으로 폴백하게 한다(조용한 부분 결과 금지):
   *  - 단일 컬럼 PK 없음(복합·무 PK)
   *  - PK가 정수 계열이 아님 — 소수 PK는 커서 캐스팅이 정확할 수 없다(Codex 3R-1)
   *  - 고객 테이블에 커서 별칭과 같은 이름의 컬럼이 실재 — 반환 전 삭제 시 원본이 사라진다(Codex 3R-2)
   */
  async fetchAllKeyset(
    tableName: string,
    limit: number,
    afterKey: string | null,
  ): Promise<{ rows: RawRow[]; lastKey: string | null }> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const pk = await this.resolvePk(tableName);
    if (!pk) {
      throw new Error(`키셋 조회 불가: ${tableName}에 단일 컬럼 PK가 없습니다 (OFFSET 폴백)`);
    }
    if (this.keysetOkCache.get(tableName) !== true) {
      throw new Error(`키셋 조회 불가: ${tableName}의 PK가 정수형이 아니거나 커서 별칭과 충돌합니다 (OFFSET 폴백)`);
    }
    const safePk = this.sanitizeIdentifier(pk);

    // 커서 비교는 DECIMAL 캐스팅으로 정확히 — 정수 컬럼 vs 문자열 상수는 double 변환이라 2^53 위에서 어긋난다.
    const where = afterKey == null ? '' : `WHERE \`${safePk}\` > CAST(? AS DECIMAL(65,0))`;
    const params: unknown[] = afterKey == null ? [limit] : [afterKey, limit];

    // 커서는 CHAR 별칭으로 받아 **인코딩 보정 전 원본**을 쓴다(보정된 값이 커서로 나가면 WHERE가 안 맞는다).
    const [rows] = await this.pool!.query(
      `SELECT t.*, CAST(t.\`${safePk}\` AS CHAR) AS \`${KEYSET_CURSOR_ALIAS}\`
         FROM \`${safeTable}\` t ${where}
        ORDER BY t.\`${safePk}\` ASC LIMIT ?`,
      params,
    );

    const raw = rows as Record<string, unknown>[];
    const lastRaw = raw[raw.length - 1];
    const lastVal = lastRaw ? lastRaw[KEYSET_CURSOR_ALIAS] : undefined;
    const lastKey = lastVal === undefined || lastVal === null ? null : String(lastVal);

    // 커서 별칭은 동기화 payload로 새어 나가면 안 된다(고객 DB에 없는 컬럼).
    for (const r of raw) delete r[KEYSET_CURSOR_ALIAS];
    const result = this.fixRowEncoding(raw as RawRow[]);

    logger.debug(`키셋 전체 조회: ${result.length}건`, { tableName, afterKey });
    return { rows: result, lastKey };
  }

  async getRowCount(tableName: string): Promise<number> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const [rows] = await this.pool!.query(
      `SELECT COUNT(*) as cnt FROM \`${safeTable}\``,
    );
    return (rows as Record<string, unknown>[])[0].cnt as number;
  }

  // ─── 내부 헬퍼 ────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.pool) {
      throw new Error('MySQL 연결이 활성화되어 있지 않습니다. connect()를 먼저 호출하세요.');
    }
  }

  private fixRowEncoding(rows: RawRow[]): RawRow[] {
    if (!this.needsEncodingFix) return rows;

    return rows.map((row) => {
      const fixed: RawRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string' && hasNonAscii(value)) {
          fixed[key] = fixDoubleEncodedString(value);
        } else {
          fixed[key] = value;
        }
      }
      return fixed;
    });
  }

  private sanitizeIdentifier(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_가-힣]/g, '');
    if (cleaned !== name) {
      logger.warn('식별자 sanitize 적용', { original: name, cleaned });
    }
    return cleaned;
  }
}
