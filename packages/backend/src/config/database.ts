import { Pool, types } from 'pg';
import mysql from 'mysql2/promise';

// timestamp without timezone를 UTC로 강제 처리
types.setTypeParser(1114, (str) => str + 'Z');

import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL 연결 풀
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// PostgreSQL 연결 확인
pool.query("SELECT 1").then(() => {
  console.log('✅ PostgreSQL 연결됨');
}).catch(err => {
  console.error('❌ PostgreSQL 연결 실패:', err.message);
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL 에러:', err);
});

// 쿼리 헬퍼
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

// MySQL 연결 풀 (QTmsg SMS 발송용)
export const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'smsdb',
  user: process.env.MYSQL_USER || 'smsuser',
  password: process.env.MYSQL_PASSWORD || 'sms123',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

// MySQL 연결 테스트 + TZ 확인 (서버 레벨 KST 영구 적용됨 — timezone.cnf)
mysqlPool.getConnection()
  .then(async conn => {
    console.log('✅ MySQL(QTmsg) 연결됨');
    const [rows] = await conn.execute("SELECT NOW() as mysql_now, @@global.time_zone as tz");
    const row = (rows as any[])[0];
    if (row) console.log(`[MySQL TZ] NOW()=${row.mysql_now}, global_tz=${row.tz}`);
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL 연결 실패:', err.message);
  });

// MySQL 쿼리 헬퍼 (서버 레벨 KST이므로 세션 SET 불필요)
export const mysqlQuery = async (sql: string, params?: any[]) => {
  const conn = await mysqlPool.getConnection();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally {
    conn.release();
  }
};

export default pool;
