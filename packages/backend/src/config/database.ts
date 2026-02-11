import { Pool } from 'pg';
import mysql from 'mysql2/promise';

import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL 연결 풀
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 서버 시작 시 timezone 확인 및 설정
pool.query("SET timezone = 'Asia/Seoul'").then(() => {
  return pool.query("SHOW timezone");
}).then(res => {
  console.log(`✅ PostgreSQL 연결됨 (timezone: ${res.rows[0].TimeZone})`);
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

// MySQL 연결 테스트
mysqlPool.getConnection()
  .then(conn => {
    console.log('✅ MySQL(QTmsg) 연결됨');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL 연결 실패:', err.message);
  });

// MySQL 쿼리 헬퍼
export const mysqlQuery = async (sql: string, params?: any[]) => {
  const [rows] = await mysqlPool.execute(sql, params);
  return rows;
};

export default pool;
