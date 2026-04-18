/**
 * MySQL 커넥터 (mysql2)
 * 중소형 POS/ERP 시스템 — MariaDB도 호환
 *
 * 변경사항 (2026-02-24):
 *   - 이중 인코딩(Double Encoding) 자동 감지 + 보정 (ADR-20260224-02)
 *   - 한국 POS/ERP 현실: character_set_client=latin1 환경에서 UTF-8 데이터 INSERT
 *     → MySQL이 각 바이트를 cp1252 문자로 해석 → utf8mb4로 재인코딩 → 이중 인코딩
 *   - connect() 시 실제 데이터의 byte/char 비율로 이중 인코딩 여부 확정
 *   - MySQL latin1 = cp1252 (Node.js latin1 = ISO-8859-1과 다름!) → cp1252 역매핑 사용
 *   - mysql2 charset 설정에 의존하지 않음 → utf8mb4로 읽고 JS에서 직접 변환
 */

import mysql from 'mysql2/promise';
import type { IDbConnector, DbConnectionConfig, RawRow, ColumnInfo } from './types';
import { getLogger } from '../logger';

const logger = getLogger('db:mysql');

// ─── MySQL latin1 = cp1252 역매핑 테이블 ────────────────────
// 0x80~0x9F 범위: cp1252와 ISO-8859-1이 다르게 매핑됨
// MySQL이 latin1 클라이언트에서 받은 바이트를 cp1252로 해석하므로
// 복원할 때도 cp1252 역매핑 필요
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201c: 0x93, // "
  0x201d: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/**
 * 이중 인코딩된 문자열을 원래 UTF-8로 복원
 *
 * 동작 원리:
 *   MySQL 이중 인코딩 과정:
 *     UTF-8 바이트 [EC, A0, 95] ("정")
 *     → POS앱이 latin1 커넥션으로 전송
 *     → MySQL이 cp1252로 해석: ì(U+00EC), NBSP(U+00A0), •(U+2022)
 *     → utf8mb4로 저장: [C3AC, C2A0, E280A2]
 *
 *   Agent가 utf8mb4로 읽으면: "ì\u00A0•" (mojibake)
 *
 *   복원 과정:
 *     1. 각 문자 → cp1252 바이트값으로 역매핑
 *        ì(U+00EC) → 0xEC, NBSP(U+00A0) → 0xA0, •(U+2022) → 0x95
 *     2. 바이트 배열 [EC, A0, 95] → UTF-8 디코딩 → "정" ✅
 */
function fixDoubleEncodedString(str: string): string {
  const bytes: number[] = [];

  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i)!;

    if (cp <= 0xff) {
      // U+0000~U+00FF: 바이트값 = 코드포인트 (ISO-8859-1 범위)
      bytes.push(cp);
    } else if (CP1252_TO_BYTE[cp] !== undefined) {
      // cp1252 특수 문자 (U+2022 → 0x95 등): 역매핑으로 원래 바이트 복원
      bytes.push(CP1252_TO_BYTE[cp]);
    } else {
      // cp1252 범위 밖의 문자 발견 → 이중 인코딩이 아닌 정상 문자열
      // (실제 한글 U+AC00~U+D7A3 등이 여기 해당)
      return str;
    }

    // 서로게이트 페어 처리 (U+10000 이상)
    if (cp > 0xffff) i++;
  }

  try {
    const decoded = Buffer.from(bytes).toString('utf8');
    // UTF-8 디코딩 결과에 replacement character(U+FFFD)가 있으면 원본 유지
    if (decoded.includes('\ufffd')) return str;
    return decoded;
  } catch {
    return str;
  }
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
      // ── pool 생성 (항상 utf8mb4 — charset 트릭 사용 안 함) ───
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
      });

      const conn = await this.pool.getConnection();

      // ── charset 환경 로그 ────────────────────────────────────
      const [charsetRows] = await conn.query("SHOW VARIABLES LIKE 'character_set_%'");
      const charsetInfo = (charsetRows as Record<string, unknown>[]).reduce(
        (acc, row: any) => {
          acc[row.Variable_name] = row.Value;
          return acc;
        },
        {} as Record<string, string>,
      );

      const [globalRows] = await conn.query(
        'SELECT @@global.character_set_client AS gcc, @@character_set_database AS csdb',
      );
      const globalInfo = (globalRows as any[])[0];

      logger.info('MySQL charset 환경', {
        global_client: globalInfo.gcc,
        database: globalInfo.csdb,
        session_client: charsetInfo['character_set_client'],
        session_results: charsetInfo['character_set_results'],
      });

      // ── 이중 인코딩 감지 ─────────────────────────────────────
      const clientDefault = (globalInfo.gcc || '').toLowerCase();
      const dbCharset = (globalInfo.csdb || '').toLowerCase();
      const isClientLatin1 = clientDefault === 'latin1';
      const isDbUtf8 = ['utf8mb4', 'utf8', 'utf8mb3'].includes(dbCharset);

      if (isClientLatin1 && isDbUtf8) {
        // charset 조합이 의심스러움 → 실제 데이터의 byte/char 비율로 확정
        this.needsEncodingFix = await this.detectDoubleEncoding(conn);
      }

      conn.release();

      const mode = this.needsEncodingFix
        ? '⚠️ 이중 인코딩 보정 모드 (cp1252 역매핑)'
        : '✅ 정상 모드 (utf8mb4)';
      logger.info(`MySQL 연결 성공 [${mode}]`, {
        host: this.config.host,
        database: this.config.database,
        needsEncodingFix: this.needsEncodingFix,
      });
    } catch (error) {
      logger.error('MySQL 연결 실패', { error });
      throw error;
    }
  }

  /**
   * 실제 데이터의 BYTE_LENGTH/CHAR_LENGTH 비율로 이중 인코딩 확정
   *
   * 정상 UTF-8 한글: 1글자 = 3바이트 → ratio ≈ 3.0
   * 이중 인코딩 한글: 1글자 = 5~7바이트 → ratio ≈ 5.0~7.0
   * ratio > 3.5 이면 이중 인코딩으로 판정
   */
  private async detectDoubleEncoding(conn: mysql.PoolConnection): Promise<boolean> {
    try {
      const [tables] = await conn.query(`
        SELECT TABLE_NAME, COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND DATA_TYPE IN ('varchar', 'char', 'text')
          AND CHARACTER_MAXIMUM_LENGTH > 1
        LIMIT 20
      `);

      for (const tbl of tables as any[]) {
        const safeTable = tbl.TABLE_NAME.replace(/[^a-zA-Z0-9_]/g, '');
        const safeCol = tbl.COLUMN_NAME.replace(/[^a-zA-Z0-9_]/g, '');

        try {
          const [hexRows] = await conn.query(
            `SELECT HEX(\`${safeCol}\`) AS h,
                    LENGTH(\`${safeCol}\`) AS byte_len,
                    CHAR_LENGTH(\`${safeCol}\`) AS char_len
             FROM \`${safeTable}\`
             WHERE \`${safeCol}\` > ''
               AND LENGTH(\`${safeCol}\`) != CHAR_LENGTH(\`${safeCol}\`)
             LIMIT 1`,
          );

          const row = (hexRows as any[])[0];
          if (!row || row.char_len === 0) continue;

          const ratio = row.byte_len / row.char_len;
          logger.info('이중 인코딩 검사', {
            table: safeTable,
            column: safeCol,
            hex_sample: (row.h as string).substring(0, 40),
            byte_len: row.byte_len,
            char_len: row.char_len,
            ratio: ratio.toFixed(2),
          });

          if (ratio > 3.5) {
            logger.warn(
              `⚠️ 이중 인코딩 확정: ${safeTable}.${safeCol} byte/char=${ratio.toFixed(2)} (>3.5)`,
            );
            return true;
          } else {
            logger.info(
              `✅ 정상 인코딩: ${safeTable}.${safeCol} byte/char=${ratio.toFixed(2)}`,
            );
            return false;
          }
        } catch {
          // 이 테이블/컬럼은 스킵하고 다음 시도
          continue;
        }
      }

      logger.info('이중 인코딩 검사: 비ASCII 데이터 없음 → 정상으로 간주');
      return false;
    } catch (error) {
      logger.warn('이중 인코딩 검사 실패 → 정상으로 간주', { error });
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

    // UTC ISO 문자열을 로컬 시간(MySQL 기준)으로 변환
    const sinceLocal = new Date(since)
      .toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })
      .replace('T', ' ');

    const [rows] = await this.pool!.query(
      `SELECT * FROM \`${safeTable}\`
       WHERE \`${safeColumn}\` > ?
       ORDER BY \`${safeColumn}\` ASC
       LIMIT ? OFFSET ?`,
      [sinceLocal, limit, offset],
    );

    const result = rows as RawRow[];
    logger.debug(`증분 조회: ${result.length}건`, { tableName, since, offset });
    return this.fixRowEncoding(result);
  }

  async fetchAll(tableName: string, limit: number, offset: number): Promise<RawRow[]> {
    this.ensureConnected();
    const safeTable = this.sanitizeIdentifier(tableName);

    const [rows] = await this.pool!.query(
      `SELECT * FROM \`${safeTable}\` LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    const result = rows as RawRow[];
    logger.debug(`전체 조회: ${result.length}건`, { tableName, offset });
    return this.fixRowEncoding(result);
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

  /**
   * 이중 인코딩 보정 — cp1252 역매핑 방식
   *
   * mysql2 charset 설정에 의존하지 않음
   * utf8mb4로 읽은 mojibake 문자열을 JS에서 직접 cp1252 바이트로 역변환
   */
  private fixRowEncoding(rows: RawRow[]): RawRow[] {
    if (!this.needsEncodingFix) return rows;

    return rows.map((row) => {
      const fixed: RawRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string' && this.hasNonAscii(value)) {
          fixed[key] = fixDoubleEncodedString(value);
        } else {
          fixed[key] = value;
        }
      }
      return fixed;
    });
  }

  private hasNonAscii(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) return true;
    }
    return false;
  }

  private sanitizeIdentifier(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_가-힣]/g, '');
    if (cleaned !== name) {
      logger.warn('식별자 sanitize 적용', { original: name, cleaned });
    }
    return cleaned;
  }
}
