/**
 * 로컬 큐 관리자 (sql.js 기반)
 *
 * 네트워크 실패 시 → 로컬 SQLite에 전송 대기 큐 저장
 * 복구 시 → 큐에서 순서대로 재전송
 * 7일 초과 데이터 자동 삭제
 */

import initSqlJs, { type Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

// pkg exe 환경에서 WASM 파일 경로 처리
function getWasmPath(): string {
  // pkg로 패키징된 경우 exe 옆에 WASM 파일 배치
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, 'sql-wasm.wasm'),
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return ''; // 빈 문자열이면 sql.js가 기본 경로에서 찾음
}
import { getLogger } from '../logger';
import type { SyncTarget } from '../types/sync';

const logger = getLogger('queue');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const QUEUE_DB_PATH = path.join(DATA_DIR, 'queue.db');
const MAX_RETENTION_DAYS = 7;

export interface QueueItem {
  id: number;
  type: SyncTarget;
  payload: string;
  createdAt: string;
  retries: number;
}

export class QueueManager {
  private db: Database | null = null;

  async init(): Promise<void> {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const wasmPath = getWasmPath();
    const SQL = wasmPath
      ? await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)).buffer as ArrayBuffer })
      : await initSqlJs();

    // 기존 DB 파일이 있으면 로드
    if (fs.existsSync(QUEUE_DB_PATH)) {
      const buffer = fs.readFileSync(QUEUE_DB_PATH);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    // 테이블 생성
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pending_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        retries INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.save();
    const count = this.getCount();
    if (count > 0) {
      logger.info(`큐 초기화 완료 — 대기 중인 항목: ${count}건`);
    } else {
      logger.debug('큐 초기화 완료 — 비어있음');
    }
  }

  /**
   * 전송 실패한 데이터를 큐에 저장
   */
  enqueue(type: SyncTarget, payload: object[]): void {
    this.ensureInitialized();
    const json = JSON.stringify(payload);
    this.db!.run(
      'INSERT INTO pending_sync (type, payload) VALUES (?, ?)',
      [type, json],
    );
    this.save();
    logger.info(`큐에 저장: ${type} ${payload.length}건`);
  }

  /**
   * 큐에서 대기 중인 항목 조회 (오래된 것부터)
   */
  dequeueAll(): QueueItem[] {
    this.ensureInitialized();
    const results = this.db!.exec(
      'SELECT id, type, payload, created_at, retries FROM pending_sync ORDER BY id ASC'
    );

    if (results.length === 0) return [];

    return results[0].values.map((row) => ({
      id: row[0] as number,
      type: row[1] as SyncTarget,
      payload: row[2] as string,
      createdAt: row[3] as string,
      retries: row[4] as number,
    }));
  }

  /**
   * 전송 성공한 항목 삭제
   */
  remove(id: number): void {
    this.ensureInitialized();
    this.db!.run('DELETE FROM pending_sync WHERE id = ?', [id]);
    this.save();
  }

  /**
   * 재시도 횟수 증가
   */
  incrementRetry(id: number): void {
    this.ensureInitialized();
    this.db!.run('UPDATE pending_sync SET retries = retries + 1 WHERE id = ?', [id]);
    this.save();
  }

  /**
   * 7일 초과 데이터 삭제
   */
  cleanup(): number {
    this.ensureInitialized();
    const before = this.getCount();
    this.db!.run(
      `DELETE FROM pending_sync WHERE created_at < datetime('now', '-${MAX_RETENTION_DAYS} days')`,
    );
    this.save();
    const deleted = before - this.getCount();
    if (deleted > 0) {
      logger.info(`큐 정리: ${deleted}건 삭제 (${MAX_RETENTION_DAYS}일 초과)`);
    }
    return deleted;
  }

  /**
   * 대기 중인 항목 수
   */
  getCount(): number {
    this.ensureInitialized();
    const result = this.db!.exec('SELECT COUNT(*) FROM pending_sync');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  }

  /**
   * DB를 파일에 저장
   */
  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(QUEUE_DB_PATH, Buffer.from(data));
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('QueueManager가 초기화되지 않았습니다. init()을 먼저 호출하세요.');
    }
  }

  /**
   * 종료 시 정리
   */
  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
