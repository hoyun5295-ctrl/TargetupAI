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
import { getLogger } from '../logger';

const logger = getLogger('db:mysql');

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
