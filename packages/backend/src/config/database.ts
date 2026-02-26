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

// MySQL 연결 테스트 + TZ 확인
mysqlPool.getConnection()
  .then(async conn => {
    console.log('✅ MySQL(QTmsg) 연결됨');
    // 시작 시 TZ 확인 로그
    await conn.query("SET time_zone = '+09:00'");
    const [rows] = await conn.execute("SELECT NOW() as mysql_now, @@session.time_zone as tz");
    const row = (rows as any[])[0];
    if (row) console.log(`[MySQL TZ] NOW()=${row.mysql_now}, session_tz=${row.tz}`);
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL 연결 실패:', err.message);
  });

// ★ GP-04: MySQL 쿼리 헬퍼 — 매 커넥션마다 KST 타임존 보장
// 풀에서 커넥션을 꺼낼 때마다 SET time_zone 실행 → 어떤 커넥션이든 KST 보장
// SET time_zone은 매우 가벼운 명령이므로 실무 오버헤드 무시 가능
export const mysqlQuery = async (sql: string, params?: any[]) => {
  const conn = await mysqlPool.getConnection();
  try {
    await conn.query("SET time_zone = '+09:00'");
    const [rows] = await conn.execute(sql, params);
    return rows;
  } finally {
    conn.release();
  }
};

export default pool;
