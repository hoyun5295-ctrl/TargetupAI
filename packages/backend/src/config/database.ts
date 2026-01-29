import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL 연결 풀
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// 연결 테스트
pool.on('connect', () => {
  console.log('✅ PostgreSQL 연결됨');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL 에러:', err);
});

// 쿼리 헬퍼
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};

export default pool;
