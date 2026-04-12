/**
 * POS DB 커넥터 — MS-SQL (tedious) 우선
 *
 * POS 매장 로컬 DB에 접속하여 데이터를 읽는다.
 * ⚠️ SELECT 권한만 사용 — INSERT/UPDATE/DELETE 절대 금지.
 */

import { Connection, Request as TediousRequest, ColumnValue } from 'tedious';
import { getConfig } from './config';
import { logger } from './logger';

let connection: Connection | null = null;

/** MS-SQL 연결 */
export async function connect(): Promise<boolean> {
  const config = getConfig();
  const { host, port, database, username, password } = config.db;

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
        encrypt: false,          // 로컬 POS는 대부분 암호화 미사용
        trustServerCertificate: true,
        rowCollectionOnRequestCompletion: true,
        connectTimeout: 10000,
        requestTimeout: 30000,
      },
    });

    conn.on('connect', (err) => {
      if (err) {
        logger.error('MS-SQL 연결 실패:', err.message);
        resolve(false);
      } else {
        connection = conn;
        logger.info(`MS-SQL 연결 성공: ${host}:${port}/${database}`);
        resolve(true);
      }
    });

    conn.on('error', (err) => {
      logger.error('MS-SQL 연결 에러:', err.message);
      connection = null;
    });

    conn.connect();
  });
}

/** 연결 해제 */
export function disconnect(): void {
  if (connection) {
    connection.close();
    connection = null;
    logger.info('MS-SQL 연결 해제');
  }
}

/** 연결 상태 확인 */
export function isConnected(): boolean {
  return connection !== null;
}

/** SQL 쿼리 실행 (SELECT 전용) */
export async function executeQuery(sql: string, params?: any[]): Promise<any[]> {
  if (!connection) {
    throw new Error('DB 미연결 — connect() 먼저 실행');
  }

  return new Promise((resolve, reject) => {
    const rows: any[] = [];

    const request = new TediousRequest(sql, (err, rowCount, resultRows) => {
      if (err) {
        reject(err);
        return;
      }

      // tedious의 row 형식을 평범한 객체로 변환
      if (resultRows) {
        for (const row of resultRows) {
          const obj: Record<string, any> = {};
          for (const col of row as ColumnValue[]) {
            obj[col.metadata.colName] = col.value;
          }
          rows.push(obj);
        }
      }

      resolve(rows);
    });

    // 파라미터 바인딩 (선택)
    if (params) {
      params.forEach((p, i) => {
        const TYPES = require('tedious').TYPES;
        if (typeof p === 'string') {
          request.addParameter(`p${i}`, TYPES.NVarChar, p);
        } else if (typeof p === 'number') {
          request.addParameter(`p${i}`, TYPES.Int, p);
        } else if (p instanceof Date) {
          request.addParameter(`p${i}`, TYPES.DateTime, p);
        }
      });
    }

    connection!.execSql(request);
  });
}

/** 연결 테스트 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const connected = await connect();
    if (!connected) return { ok: false, error: 'Connection failed' };

    await executeQuery('SELECT 1 AS test');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
