import { Pool } from 'pg';
import mysql from 'mysql2/promise';
export declare const pool: Pool;
export declare const query: (text: string, params?: any[]) => Promise<import("pg").QueryResult<any>>;
export declare const mysqlPool: mysql.Pool;
export declare const mysqlQuery: (sql: string, params?: any[]) => Promise<mysql.QueryResult>;
export default pool;
//# sourceMappingURL=database.d.ts.map