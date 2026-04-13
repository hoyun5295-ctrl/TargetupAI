/**
 * POS DB 커넥터 — MSSQL / MySQL / SQLite 3종 지원
 *
 * POS 매장 로컬 DB에 접속하여 데이터를 읽는다.
 * ⚠️ SELECT 권한만 사용 — INSERT/UPDATE/DELETE 절대 금지.
 *
 * 재연결: 연결 끊김 시 exponential backoff로 최대 5회 재시도.
 */

import { getConfig } from './config';
import { logger } from './logger';

// ============================================================
// 드라이버 타입 (동적 import)
// ============================================================

let mssqlConnection: any = null;
let mysqlConnection: any = null;
let sqliteDb: any = null;

const MAX_RETRY = 5;
const RETRY_BASE_MS = 2000;

// ============================================================
// 연결
// ============================================================

export async function connect(): Promise<boolean> {
  const { type } = getConfig().db;

  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      let ok = false;
      if (type === 'mssql') ok = await connectMssql();
      else if (type === 'mysql') ok = await connectMysql();
      else if (type === 'sqlite') ok = connectSqlite();
      else { logger.error(`지원하지 않는 DB 타입: ${type}`); return false; }

      if (ok) return true;
    } catch (err: any) {
      logger.warn(`DB 연결 시도 ${attempt}/${MAX_RETRY} 실패: ${err.message}`);
    }

    if (attempt < MAX_RETRY) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.info(`${delay}ms 후 재시도...`);
      await sleep(delay);
    }
  }

  logger.error(`DB 연결 ${MAX_RETRY}회 시도 실패`);
  return false;
}

// ============================================================
// MSSQL (tedious)
// ============================================================

async function connectMssql(): Promise<boolean> {
  const { Connection } = require('tedious');
  const { host, port, database, username, password } = getConfig().db;

  return new Promise((resolve) => {
    const conn = new Connection({
      server: host,
      authentication: {
        type: 'default',
        options: { userName: username, password },
      },
      options: {
        database,
        port,
        encrypt: false,
        trustServerCertificate: true,
        rowCollectionOnRequestCompletion: true,
        connectTimeout: 10000,
        requestTimeout: 30000,
      },
    });

    conn.on('connect', (err: any) => {
      if (err) {
        logger.error('MSSQL 연결 실패:', err.message);
        resolve(false);
      } else {
        mssqlConnection = conn;
        logger.info(`MSSQL 연결 성공: ${host}:${port}/${database}`);
        resolve(true);
      }
    });

    conn.on('error', (err: any) => {
      logger.error('MSSQL 연결 에러:', err.message);
      mssqlConnection = null;
    });

    conn.connect();
  });
}

// ============================================================
// MySQL (mysql2)
// ============================================================

async function connectMysql(): Promise<boolean> {
  try {
    const mysql = require('mysql2/promise');
    const { host, port, database, username, password, charset } = getConfig().db;

    const conn = await mysql.createConnection({
      host, port, database,
      user: username,
      password,
      charset: charset || 'utf8mb4',
      connectTimeout: 10000,
    });

    mysqlConnection = conn;
    logger.info(`MySQL 연결 성공: ${host}:${port}/${database}`);
    return true;
  } catch (err: any) {
    logger.error('MySQL 연결 실패:', err.message);
    return false;
  }
}

// ============================================================
// SQLite (better-sqlite3)
// ============================================================

function connectSqlite(): boolean {
  try {
    const Database = require('better-sqlite3');
    const { filePath } = getConfig().db;

    if (!filePath) {
      logger.error('SQLite: filePath가 설정되지 않았습니다.');
      return false;
    }

    sqliteDb = new Database(filePath, { readonly: true });
    logger.info(`SQLite 연결 성공: ${filePath}`);
    return true;
  } catch (err: any) {
    logger.error('SQLite 연결 실패:', err.message);
    return false;
  }
}

// ============================================================
// 연결 해제
// ============================================================

export function disconnect(): void {
  const { type } = getConfig().db;

  if (type === 'mssql' && mssqlConnection) {
    mssqlConnection.close();
    mssqlConnection = null;
  } else if (type === 'mysql' && mysqlConnection) {
    mysqlConnection.end().catch(() => {});
    mysqlConnection = null;
  } else if (type === 'sqlite' && sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }

  logger.info('DB 연결 해제');
}

export function isConnected(): boolean {
  const { type } = getConfig().db;
  if (type === 'mssql') return mssqlConnection !== null;
  if (type === 'mysql') return mysqlConnection !== null;
  if (type === 'sqlite') return sqliteDb !== null;
  return false;
}

// ============================================================
// 쿼리 실행 (SELECT 전용)
// ============================================================

export async function executeQuery(sql: string, params?: any[]): Promise<any[]> {
  const { type } = getConfig().db;

  // 연결 끊김 시 자동 재연결
  if (!isConnected()) {
    logger.warn('DB 연결 끊김 — 재연결 시도');
    const reconnected = await connect();
    if (!reconnected) throw new Error('DB 재연결 실패');
  }

  if (type === 'mssql') return executeMssql(sql, params);
  if (type === 'mysql') return executeMysql(sql, params);
  if (type === 'sqlite') return executeSqlite(sql, params);
  throw new Error(`지원하지 않는 DB 타입: ${type}`);
}

// ── MSSQL 쿼리
async function executeMssql(sql: string, params?: any[]): Promise<any[]> {
  const { Request, TYPES } = require('tedious');

  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    const request = new Request(sql, (err: any, _rowCount: number, resultRows: any[]) => {
      if (err) return reject(err);
      if (resultRows) {
        for (const row of resultRows) {
          const obj: Record<string, any> = {};
          for (const col of row) {
            obj[col.metadata.colName] = col.value;
          }
          rows.push(obj);
        }
      }
      resolve(rows);
    });

    if (params) {
      params.forEach((p, i) => {
        if (typeof p === 'string') request.addParameter(`p${i}`, TYPES.NVarChar, p);
        else if (typeof p === 'number') request.addParameter(`p${i}`, TYPES.Float, p);
        else if (p instanceof Date) request.addParameter(`p${i}`, TYPES.DateTime, p);
      });
    }

    mssqlConnection.execSql(request);
  });
}

// ── MySQL 쿼리
async function executeMysql(sql: string, params?: any[]): Promise<any[]> {
  const [rows] = await mysqlConnection.execute(sql, params || []);
  return rows as any[];
}

// ── SQLite 쿼리
function executeSqlite(sql: string, params?: any[]): any[] {
  const stmt = sqliteDb.prepare(sql);
  return params ? stmt.all(...params) : stmt.all();
}

// ============================================================
// 연결 테스트
// ============================================================

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const connected = await connect();
    if (!connected) return { ok: false, error: 'Connection failed' };

    const { type } = getConfig().db;
    if (type === 'mssql') await executeQuery('SELECT 1 AS test');
    else if (type === 'mysql') await executeQuery('SELECT 1 AS test');
    else if (type === 'sqlite') executeQuery('SELECT 1 AS test');

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
// 유틸
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
