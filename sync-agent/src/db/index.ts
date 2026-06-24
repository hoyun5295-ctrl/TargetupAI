/**
 * DB 커넥터 팩토리
 * 설정의 db type에 따라 적절한 커넥터를 생성합니다.
 */

import type { IDbConnector, DbConnectionConfig, DbType } from './types';
import { MockDbConnector } from './mock';

/**
 * DB 타입에 따라 커넥터 인스턴스를 생성합니다.
 *
 * ★ 2026-06-24: 커넥터를 최상단에서 한꺼번에 import 하지 않고 선택된 타입만 지연 require 한다.
 *   node12(win-legacy)에서 안 쓰는 드라이버(예: mssql)의 모듈까지 파싱하다가
 *   `??`/`?.` 같은 신문법 때문에 SyntaxError로 죽던 것을 차단(이새F&C Oracle 케이스에서 mssql 때문에 사망).
 *   각 드라이버는 build-tier.js의 win-legacy 핀(mssql 8.1.4 / mysql2 3.2.0 / pg 8.7.3 / oracledb 5.5.0)으로
 *   node12 파싱이 보장되며, 지연 require로 실제 선택된 1종만 로드된다.
 */
export function createDbConnector(config: DbConnectionConfig): IDbConnector {
  switch (config.type) {
    case 'mssql': {
      const { MssqlConnector } = require('./mssql');
      return new MssqlConnector(config);
    }
    case 'mysql': {
      const { MysqlConnector } = require('./mysql');
      return new MysqlConnector(config);
    }
    case 'oracle': {
      const { OracleConnector } = require('./oracle');
      return new OracleConnector(config);
    }
    case 'postgres': {
      const { PostgresConnector } = require('./postgresql');
      return new PostgresConnector(config);
    }
    case 'excel':
    case 'csv': {
      const { ExcelCsvConnector } = require('./excel-csv');
      return new ExcelCsvConnector(config);
    }

    // 향후 확장 자리: case 'odbc' — ODBC 범용 브리지(티베로/DB2 등). 실제 고객 발생 시 추가.
    default:
      throw new Error(`지원하지 않는 DB 타입: ${config.type}`);
  }
}

/**
 * Mock DB 커넥터를 생성합니다. (테스트/개발용)
 */
export function createMockDbConnector(): IDbConnector {
  return new MockDbConnector();
}

export type { IDbConnector, DbConnectionConfig, DbType, RawRow, ColumnInfo } from './types';
export { MockDbConnector } from './mock';
