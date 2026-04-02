import { Pool, types } from 'pg';
import mysql from 'mysql2/promise';

// timestamp without timezone를 UTC로 처리 (PostgreSQL timezone=Etc/UTC)
types.setTypeParser(1114, (str) => str + 'Z');

import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL 연결 풀
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT) || 5000,
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

// ★ 보안: MySQL 비밀번호 미설정 시 서버 기동 차단 (fail-fast)
if (!process.env.MYSQL_PASSWORD) {
  console.error('❌ [FATAL] MYSQL_PASSWORD 환경변수가 설정되지 않았습니다. 서버를 시작할 수 없습니다.');
  process.exit(1);
}

// MySQL 연결 풀 (QTmsg SMS 발송용)
export const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'smsdb',
  user: process.env.MYSQL_USER || 'smsuser',
  password: process.env.MYSQL_PASSWORD,
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
// ★ conn.query() 사용: conn.execute()(prepared statement)는 UNION ALL + 다수 파라미터 조합에서
//    'Incorrect arguments to mysqld_stmt_execute' 에러 발생 (mysql2 known issue)
//    conn.query()는 문자열 이스케이프 방식이므로 이 문제 없음. ? 파라미터 바인딩 동일 지원.
export const mysqlQuery = async (sql: string, params?: any[]) => {
  const conn = await mysqlPool.getConnection();
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
};

export default pool;
