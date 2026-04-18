/**
 * DB 커넥터 팩토리
 * 설정의 db type에 따라 적절한 커넥터를 생성합니다.
 */

import type { IDbConnector, DbConnectionConfig, DbType } from './types';
import { MssqlConnector } from './mssql';
import { MysqlConnector } from './mysql';
import { OracleConnector } from './oracle';
import { PostgresConnector } from './postgresql';
import { ExcelCsvConnector } from './excel-csv';
import { MockDbConnector } from './mock';

/**
 * DB 타입에 따라 커넥터 인스턴스를 생성합니다.
 */
export function createDbConnector(config: DbConnectionConfig): IDbConnector {
  switch (config.type) {
    case 'mssql':
      return new MssqlConnector(config);

    case 'mysql':
      return new MysqlConnector(config);

    case 'oracle':
      return new OracleConnector(config);

    case 'postgres':
      return new PostgresConnector(config);

    case 'excel':
    case 'csv':
      return new ExcelCsvConnector(config);

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
