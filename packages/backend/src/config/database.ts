import { Pool, types } from 'pg';
import mysql from 'mysql2/promise';

// timestamp without timezone를 UTC로 처리 (PostgreSQL timezone=Etc/UTC)
types.setTypeParser(1114, (str) => str + 'Z');

import dotenv from 'dotenv';

dotenv.config();

// ★ 2026-07-14 테스트(vitest) 실행 시엔 실제 DB/MySQL 연결을 시도하지 않는다 — 로컬 게이트에서 의미 없는 연결 실패 로그 차단.
//   VITEST는 vitest만 설정하는 env(운영/개발 런타임=undefined) → 아래 연결·로그·fail-fast는 운영에서 기존과 100% 동일 동작.
const IS_TEST = !!process.env.VITEST;

// PostgreSQL 연결 풀
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT) || 5000,
});

// PostgreSQL 연결 확인 — 부팅 순간 연결 경합으로 첫 시도가 타임아웃할 수 있어, 몇 회 재시도 후에만 실패로 기록(부팅 오탐 ❌ 방지). 앱은 그 사이 지연연결로 정상 동작.
void (async () => {
  if (IS_TEST) return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ PostgreSQL 연결됨');
      return;
    } catch (err: any) {
      if (attempt === 5) {
        console.error(`❌ PostgreSQL 연결 실패 (${attempt}회 재시도 후):`, err?.message);
        return;
      }
      // ★2026-08-28 **예상된 재시도는 경고가 아니다.** 바로 위 주석대로 부팅 순간 첫 시도가
      //   타임아웃하는 것은 정상 경로이고 실제로 매 부팅 1회씩 찍혀 에러 로그를 채우고 있었다.
      //   정상이 경고로 남으면 진짜 오류가 그 사이에 묻힌다.
      //   다만 2회째부터는 경합이 아니라 이상 신호이므로 경고로 올린다.
      const line = `[PostgreSQL] 연결 재시도 ${attempt}/5 — ${err?.message}`;
      if (attempt === 1) console.log(line);
      else console.warn(line);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
})();

pool.on('error', (err) => {
  console.error('❌ PostgreSQL 에러:', err);
});

// 쿼리 헬퍼
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

// ★ 보안: MySQL 비밀번호 미설정 시 서버 기동 차단 (fail-fast)
if (!IS_TEST && !process.env.MYSQL_PASSWORD) {
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
if (!IS_TEST) mysqlPool.getConnection()
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

// ============================================================
//  정산 집계 전용 MySQL 풀 (★ 2026-07-26)
// ============================================================
//
// 왜 나누는가: 정산 집계는 회사당 40~48개 테이블을 훑는다. 이걸 발송 풀에서 병렬로 돌리면
// **커넥션을 정산이 가져가 그동안 발송·환불 sweeper가 자리를 못 잡는다.**
// 기간계 발송 시스템에서 월 1회 작업이 실발송을 밀어내면 안 된다.
//
// 풀을 나누면 정산이 아무리 병렬로 돌아도 발송 풀(10)은 그대로 10이다.
// 정산 쪽은 자기 풀 안에서만 경쟁하므로 상한을 올려도 기간계에 닿지 않는다.
//
// `connectionLimit`은 MySQL `max_connections`를 넘기지 않는 선에서 잡는다 —
// 두 풀 합쳐 18이고, 여기에 다른 프로세스(게이트웨이 엔진)가 붙어도 여유가 있다.
export const MYSQL_BILLING_POOL_LIMIT = Number(process.env.MYSQL_BILLING_POOL_LIMIT) || 8;

export const mysqlBillingPool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'smsdb',
  user: process.env.MYSQL_USER || 'smsuser',
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: MYSQL_BILLING_POOL_LIMIT,
  charset: 'utf8mb4',
});

/** 정산 쿼리 1건 실행 시간 상한(ms). 0 = 미설정. */
export const MYSQL_BILLING_STMT_TIMEOUT_MS = Number(process.env.MYSQL_BILLING_STMT_TIMEOUT_MS) || 60_000;

/**
 * 정산 집계 전용 쿼리. **발송 풀을 쓰지 않는다.**
 *
 * 한 쿼리가 오래 물고 있으면 정산 풀도 고갈되므로 서버 측 실행 시간 상한을 함께 건다.
 * 상한에 걸리면 그 발행만 실패하고 발송은 영향을 받지 않는다.
 * `max_execution_time`은 MySQL 5.7.8+ 세션 변수이고 MariaDB에는 없다 —
 * 없는 서버에서는 조용히 건너뛴다(상한이 없을 뿐, 쿼리는 정상 실행된다).
 */
export const mysqlBillingQuery = async (sql: string, params?: any[]) => {
  const conn = await mysqlBillingPool.getConnection();
  try {
    if (MYSQL_BILLING_STMT_TIMEOUT_MS > 0) {
      try {
        await conn.query(`SET SESSION max_execution_time = ${Math.floor(MYSQL_BILLING_STMT_TIMEOUT_MS)}`);
      } catch { /* MariaDB 등 미지원 서버 — 상한 없이 진행 */ }
    }
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
};

export default pool;
