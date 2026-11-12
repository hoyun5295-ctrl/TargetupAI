/**
 * CT 큐 적재 묶음 트랜잭션(★ 2026-11-10 설계서 docs/2026-11-10-load-resume-design.md §3 · Codex 설계 4R approve)
 *
 * 왜: 직접발송 워커의 1만 건 묶음 안 INSERT 가 5천 건 배치마다 따로 커밋돼, 묶음 중간에 프로세스가 죽으면(메모리 재시작 ·
 *     배포) 몇 건 들어갔는지 몰라 복구가 남은 분량을 버렸다(1110 SOOBIN02 9,906 · 1028 톤28 7,790 미발송).
 * 무엇: 묶음 하나 = MySQL 연결 하나의 트랜잭션. 첫 문장 = 커밋 기록(HANJUL_LOAD_CHUNK · PK = 캠페인 + 묶음 첫 staging id) INSERT.
 *       연결이 끊기면 서버가 되돌린다 = 그 묶음 0. 복구는 같은 묶음을 같은 PK 로 다시 시작해 판정한다
 *       (중복 키 = 이미 커밋됨 · 성공 = 앞 트랜잭션 되돌림 확정 · 잠금 대기 만료 = 보류).
 * 쓰는 곳 = 직접발송 워커 · 처리기 · 세 큐 CT(sms-queue bulkInsertSmsQueue · insertBrandQueue · insertAlimtalkQueue 의 tx 인자)만.
 */
import { mysqlPool, mysqlQuery } from '../config/database';
import { noteQueueSql } from './queue-scan-guard';

/** 커밋 기록 표(smsdb · InnoDB · DDL = 설계서 §3-0 · 없으면 관문이 옛 방식으로 돌린다) */
export const LOAD_CHUNK_TABLE = 'HANJUL_LOAD_CHUNK';
/** 같은 PK 를 쥔 앞 트랜잭션을 기다리는 상한(초 · 넘으면 보류) */
export const LOAD_CHUNK_LOCK_WAIT_SEC = 30;
/** 엔진 확인 캐시 수명(DDL 을 나중에 만들어도 이만큼 뒤엔 새 방식) */
const ENGINE_CACHE_MS = 10 * 60 * 1000;

/** 트랜잭션 안 배치 INSERT 실패 — MySQL 은 실패한 문장만 되돌리고 트랜잭션은 살아 있어, 삼키면 묶음 안 부분 커밋이 된다 */
export class QueueTxAbort extends Error {
  constructor(message: string) { super(message); this.name = 'QueueTxAbort'; }
}
/** 같은 묶음이 이미 커밋돼 있다(커밋 기록 중복 키) — 기록의 수로 진행 기록을 옮긴다 */
export class LoadChunkAlreadyCommitted extends Error {
  constructor(public record: { rowsRead: number; smsLoaded: number; brandLoaded: number }) {
    super('이미 커밋된 묶음'); this.name = 'LoadChunkAlreadyCommitted';
  }
}
/** 같은 묶음을 쥔 앞 트랜잭션이 아직 안 끝남(잠금 대기 만료) — 보류 */
export class LoadChunkLockTimeout extends Error {
  constructor() { super('앞 트랜잭션 대기 만료'); this.name = 'LoadChunkLockTimeout'; }
}

/** 세 큐 CT 에 넘기는 모양 — run = 그 연결의 query(rows 반환 · mysqlQuery 와 같은 꼴) · afterCommit = 커밋 확인 뒤 차례로 */
export interface QueueTx {
  run(sql: string, params?: any[]): Promise<any>;
  afterCommit(fn: () => void | Promise<void>): void;
}
export interface QueueTxHandle extends QueueTx {
  /** 'committed' = 확인 · 'unknown' = COMMIT 호출 오류(결과 불명 → 보류) */
  commit(): Promise<'committed' | 'unknown'>;
  /** 되돌림(오류 = 연결 파기 · 커밋을 보낸 적이 없으니 서버가 되돌린다) */
  rollback(): Promise<void>;
}

/**
 * 풀 연결 하나 · 잠금 대기 상한 · BEGIN(실패 = 연결 파기 후 던짐).
 * ★ Codex 구현 1R — 이 연결은 끝나면 **풀에 돌려주지 않고 닫는다**(커밋 · 되돌림 · 불명 모두).
 *   SET SESSION 잠금 대기 상한이 반납 뒤에도 남아, 같은 연결을 다시 쓰는 tx 없는 적재(bulkInsertSmsQueue 등)의 대기 상한이 바뀌었다.
 *   닫으면 세션 값이 다른 경로로 새는 길이 없다(비용 = 1만 건 묶음마다 연결 하나 새로).
 */
export async function openQueueTransaction(pool: { getConnection(): Promise<any> } = mysqlPool): Promise<QueueTxHandle> {
  const conn = await pool.getConnection();
  const close = () => { try { conn.destroy(); } catch { /* 닫기 실패 = 무시 */ } };
  try {
    const lockSql = `SET SESSION innodb_lock_wait_timeout = ${LOAD_CHUNK_LOCK_WAIT_SEC}`;
    noteQueueSql('openQueueTransaction', lockSql);
    await conn.query(lockSql);
    await conn.beginTransaction();
  } catch (e) {
    close();
    throw e;
  }
  const hooks: Array<() => void | Promise<void>> = [];
  let done = false;
  return {
    run: async (sql, params) => {
      noteQueueSql('openQueueTransaction', sql, params); // C131 R94 지킴이 — 판정 · 기록만(던지지 않음)
      const [rows] = await conn.query(sql, params);
      return rows;
    },
    afterCommit: (fn) => { hooks.push(fn); },
    commit: async () => {
      if (done) throw new Error('이미 끝난 적재 트랜잭션');
      done = true;
      try {
        await conn.commit();
      } catch {
        close();
        return 'unknown';
      }
      close();
      for (const fn of hooks) {
        try { await fn(); } catch (e: any) { console.error('[queue-load-tx] 커밋 뒤 작업 실패(발송 영향 0):', e?.message || e); }
      }
      return 'committed';
    },
    rollback: async () => {
      if (done) return;
      done = true;
      try { await conn.rollback(); } catch { /* 되돌림 실패 = 커밋을 보낸 적이 없으니 닫으면 서버가 되돌린다 */ }
      close();
    },
  };
}

const engineCache = new Map<string, { engine: string | null; at: number }>();

/** 관문 — 큐 테이블 전부 + 커밋 기록 표가 InnoDB 로 있을 때만 참(조회 실패 = 거짓 = 옛 방식) */
export async function queueTxReady(tables: string[], run: (sql: string, params?: any[]) => Promise<any> = mysqlQuery): Promise<boolean> {
  const names = [...new Set([...tables.filter(Boolean), LOAD_CHUNK_TABLE])];
  const now = Date.now();
  const stale = names.filter((n) => { const hit = engineCache.get(n); return !hit || now - hit.at > ENGINE_CACHE_MS; });
  if (stale.length > 0) {
    try {
      const rows: any[] = await run(
        `SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
        [stale],
      );
      const got = new Map<string, string | null>((rows || []).map((r: any) => [String(r.t), r.e == null ? null : String(r.e)]));
      for (const n of stale) engineCache.set(n, { engine: got.get(n) ?? null, at: now });
    } catch (e: any) {
      console.warn('[queue-load-tx] 엔진 확인 실패 — 이번 캠페인은 옛 방식:', e?.message || e);
      return false;
    }
  }
  return names.every((n) => String(engineCache.get(n)?.engine || '').toLowerCase() === 'innodb');
}

/** 시험 전용 — 엔진 캐시 비우기 */
export function __resetQueueTxEngineCache(): void { engineCache.clear(); }

/** 트랜잭션 첫 문장 = 커밋 기록 INSERT · 중복 키 = LoadChunkAlreadyCommitted(같은 트랜잭션에서 수를 읽음) · 잠금 대기 만료 = LoadChunkLockTimeout */
export async function claimLoadChunk(tx: QueueTx, campaignId: string, firstStagingId: string, rowsRead: number): Promise<void> {
  try {
    await tx.run(
      `INSERT INTO ${LOAD_CHUNK_TABLE} (campaign_id, first_staging_id, rows_read, sms_loaded, brand_loaded) VALUES (?, ?, ?, 0, 0)`,
      [campaignId, firstStagingId, rowsRead],
    );
  } catch (e: any) {
    if (e?.errno === 1062 || e?.code === 'ER_DUP_ENTRY') {
      const rows: any[] = await tx.run(
        `SELECT rows_read, sms_loaded, brand_loaded FROM ${LOAD_CHUNK_TABLE} WHERE campaign_id = ? AND first_staging_id = ?`,
        [campaignId, firstStagingId],
      );
      const r = rows?.[0];
      if (!r) throw new Error('커밋 기록 중복인데 줄을 읽지 못함');
      throw new LoadChunkAlreadyCommitted({
        rowsRead: Number(r.rows_read) || 0, smsLoaded: Number(r.sms_loaded) || 0, brandLoaded: Number(r.brand_loaded) || 0,
      });
    }
    if (e?.errno === 1205 || e?.code === 'ER_LOCK_WAIT_TIMEOUT') throw new LoadChunkLockTimeout();
    throw e;
  }
}

/** 큐 INSERT 가 끝난 뒤 같은 트랜잭션에서 적재 수를 남긴다(COMMIT 전) */
export async function sealLoadChunk(tx: QueueTx, campaignId: string, firstStagingId: string, smsLoaded: number, brandLoaded: number): Promise<void> {
  await tx.run(
    `UPDATE ${LOAD_CHUNK_TABLE} SET sms_loaded = ?, brand_loaded = ? WHERE campaign_id = ? AND first_staging_id = ?`,
    [smsLoaded, brandLoaded, campaignId, firstStagingId],
  );
}

/** 캠페인 종결 뒤 그 캠페인의 기록만 지운다(실패 = 무시 · 다음 종결 때) — 기간으로 지우지 않는다(Codex 설계 2R #3) */
export async function deleteLoadChunks(campaignId: string, run: (sql: string, params?: any[]) => Promise<any> = mysqlQuery): Promise<void> {
  try {
    await run(`DELETE FROM ${LOAD_CHUNK_TABLE} WHERE campaign_id = ?`, [campaignId]);
  } catch (e: any) {
    console.warn(`[queue-load-tx] 커밋 기록 정리 실패 campaign=${campaignId}(발송 영향 0):`, e?.message || e);
  }
}
