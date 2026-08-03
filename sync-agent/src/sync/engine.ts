/**
 * 동기화 엔진 (메인 오케스트레이터)
 *
 * 파이프라인:
 *   DB 조회 → 컬럼 매핑 → 데이터 정규화 → Zod 검증 → API 전송
 *   실패 시 → 로컬 큐 저장 → 나중에 재전송
 *
 * Phase 5 추가: AlertManager 연동 (동기화 결과 알림)
 *
 * 변경사항 (2026-02-25):
 *   - customerTimestampColumn / purchaseTimestampColumn 개별 지원 (BUG-010)
 *   - getTimestampForTarget() 헬퍼로 타겟별 timestamp 컬럼 결정
 */

import type { IDbConnector, RawRow, ColumnInfo } from '../db/types';
import type { ApiClient } from '../api/client';
import type { QueueManager } from '../queue';
import type { AlertManager } from '../alert';
import type { SyncTarget, SyncMode, SyncResult, SyncError, SyncCursorState } from '../types/sync';
// ★ 2026-08-03 커서 재설계 — 키셋 커서·원본 행 키 직렬화(순수 모듈, 어댑터 4종 공유)
import { serializeSourceRowKey, cursorKeysValid } from '../db/keyset';
import type { ColumnMapping } from '../mapping';
import { mapBatch } from '../mapping';
import { normalizeCustomerBatch, normalizePurchaseBatch } from '../normalize';
import { validateCustomers } from '../types/customer';
import { validatePurchases } from '../types/purchase';
import { SyncStateManager } from './state';
import { getLogger } from '../logger';
// ★ v1.6.1: mapping_dryrun 미리보기 마스킹 (서버 저장 payload — 개인정보 최소화)
import { maskPhone, maskEmail, maskSensitiveData } from '../logger/masking';

const logger = getLogger('sync:engine');

export interface SyncEngineConfig {
  /** 배치 크기 (기본 4000) */
  batchSize: number;
  /** 고객 테이블명 */
  customerTable: string;
  /** 구매 테이블명 */
  purchaseTable: string;
  /** 변경감지 타임스탬프 컬럼 (공통 폴백) */
  timestampColumn: string;
  /** 고객 테이블 전용 타임스탬프 컬럼 (미지정 시 timestampColumn 사용) */
  customerTimestampColumn?: string;
  /** 구매 테이블 전용 타임스탬프 컬럼 (미지정 시 timestampColumn 사용) */
  purchaseTimestampColumn?: string;
  /** updated_at 없을 때 전체 동기화 폴백 */
  fallbackToFullSync: boolean;
  /** 고객 컬럼 매핑 */
  customerMapping: ColumnMapping;
  /** 구매 컬럼 매핑 */
  purchaseMapping: ColumnMapping;
  /** dry run 모드 (API 전송 안 하고 로그만) */
  dryRun?: boolean;
}

export class SyncEngine {
  private db: IDbConnector;
  private apiClient: ApiClient | null;
  private queue: QueueManager | null;
  private stateManager: SyncStateManager;
  private config: SyncEngineConfig;
  private alertManager: AlertManager | null;

  constructor(
    db: IDbConnector,
    apiClient: ApiClient | null,
    stateManager: SyncStateManager,
    config: SyncEngineConfig,
    queue?: QueueManager,
    alertManager?: AlertManager,
  ) {
    this.db = db;
    this.apiClient = apiClient;
    this.stateManager = stateManager;
    this.config = config;
    this.queue = queue || null;
    this.alertManager = alertManager || null;
  }

  /**
   * 런타임 매핑 교체 (원격 update_config 명령용 — 2026-07-01).
   * config.enc 영구 저장은 호출부(scheduler)가 담당하고, 여기서는 실행 중 engine이
   * 참조하는 매핑만 즉시 교체한다 → 재시작 없이 다음 배치부터 새 매핑 적용.
   * 부분 갱신: 넘긴 것만 교체하고 나머지는 유지(구매만/고객만 갱신 안전).
   */
  updateMapping(m: { customers?: ColumnMapping; purchases?: ColumnMapping }): void {
    if (m.customers) this.config.customerMapping = m.customers;
    if (m.purchases) this.config.purchaseMapping = m.purchases;
  }

  /** 현재 런타임 매핑 조회 (검증/로깅용). */
  getMapping(): { customers: ColumnMapping; purchases: ColumnMapping } {
    return {
      customers: this.config.customerMapping,
      purchases: this.config.purchaseMapping,
    };
  }

  // ─── 원격 관리 지원 (v1.6.1 — 2026-07-10 P0-1·P2-8·P2-9) ─────────
  //
  // heartbeat 자기 보고(sourceColumns)·test_connection·mapping_dryrun이 소스 DB를 만지는 유일한 통로.
  // 전부 읽기 전용(getColumns/fetchAll 1행) — 동기화 상태·매핑에 영향 0.

  /** 소스 테이블 컬럼 목록 (heartbeat 자기 보고용). 조회 실패 타겟은 생략(부분 보고). */
  async getSourceColumns(): Promise<{ customers?: string[]; purchases?: string[] }> {
    const out: { customers?: string[]; purchases?: string[] } = {};
    try {
      out.customers = (await this.db.getColumns(this.config.customerTable)).map((c) => c.name);
    } catch (error) {
      logger.debug('소스 컬럼 조회 실패(customers) — 보고 생략', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.config.purchaseTable) {
      try {
        out.purchases = (await this.db.getColumns(this.config.purchaseTable)).map((c) => c.name);
      } catch (error) {
        logger.debug('소스 컬럼 조회 실패(purchases) — 보고 생략', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  /** 소스 DB 연결 테스트 (원격 test_connection 명령용) */
  async testSource(): Promise<{ connected: boolean; customerColumns?: number; purchaseColumns?: number; error?: string }> {
    try {
      const connected = await this.db.testConnection();
      if (!connected) return { connected: false, error: '소스 DB 연결 실패 (testConnection false)' };
      const result: { connected: boolean; customerColumns?: number; purchaseColumns?: number } = { connected: true };
      result.customerColumns = (await this.db.getColumns(this.config.customerTable)).length;
      if (this.config.purchaseTable) {
        result.purchaseColumns = (await this.db.getColumns(this.config.purchaseTable)).length;
      }
      return result;
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 매핑 dry-run (원격 mapping_dryrun 명령용) — 소스 1행에 후보 매핑을 적용한 결과 미리보기.
   * 저장·적용·전송 없음. 이새 custom_5 매장코드 오적재류 사고를 저장 전에 잡는 용도.
   * 미리보기는 heartbeat로 서버 config에 저장되므로 전화/이메일은 마스킹해 반환한다
   * (소스 원본 컬럼명은 표준 키 기반 maskSensitiveData가 못 잡음 — 매핑 대상 기준으로 직접 마스킹).
   */
  async previewMapping(
    target: SyncTarget,
    mapping: ColumnMapping,
  ): Promise<{ ok: boolean; sourceRow?: RawRow; mappedRow?: Record<string, unknown>; error?: string }> {
    const table = target === 'customers' ? this.config.customerTable : this.config.purchaseTable;
    if (!table) return { ok: false, error: `${target} 테이블이 설정되지 않았습니다.` };
    try {
      const rows = await this.db.fetchAll(table, 1, 0);
      if (rows.length === 0) return { ok: false, error: `${table} 테이블에 데이터가 없습니다.` };
      const mapped = mapBatch([rows[0]], mapping)[0] || {};
      const maskFns = new Map<string, (v: string) => string>([
        ['phone', maskPhone],
        ['customer_phone', maskPhone],
        ['email', maskEmail],
      ]);
      const sourceRow: RawRow = { ...rows[0] };
      for (const [srcCol, targetField] of Object.entries(mapping)) {
        const fn = maskFns.get(String(targetField));
        if (fn && typeof sourceRow[srcCol] === 'string') {
          sourceRow[srcCol] = fn(sourceRow[srcCol] as string);
        }
      }
      return { ok: true, sourceRow, mappedRow: maskSensitiveData(mapped) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 타겟(customers/purchases)에 맞는 timestamp 컬럼 반환
   * 개별 지정이 있으면 개별값, 없으면 공통 timestampColumn 폴백
   */
  private getTimestampForTarget(target: SyncTarget): string {
    if (target === 'customers') {
      return this.config.customerTimestampColumn || this.config.timestampColumn;
    }
    return this.config.purchaseTimestampColumn || this.config.timestampColumn;
  }

  // ─── 타임스탬프 컬럼 실재 검증 (2026-06-11) ────────────
  //
  // 배경: 인비토 첫 연동 실측 — 고객사 테이블(SyncTest)에 설정된 timestamp 컬럼(updated_at)이
  //   없으면 증분 동기화가 매 주기 DB 에러(MSSQL 207)로 실패하고, 최초 전체 동기화 이후의
  //   신규/수정 데이터가 영구히 반영되지 않았다. fallbackToFullSync는 선언만 있고
  //   소비처가 0건이라 동작하지 않았다. → 증분 직전 getColumns로 실재를 검증하고
  //   없으면 전체 동기화로 대체(true) 또는 명확한 한국어 에러로 중단(false).

  /** 검증 결과: ok=존재 / missing=없음 / unknown=메타 조회 실패(권한 등 — 증분 시도 유지) */
  private async checkTimestampColumn(
    tableName: string,
    timestampCol: string,
  ): Promise<'ok' | 'missing' | 'unknown'> {
    try {
      const columns = await this.db.getColumns(tableName);
      if (!columns || columns.length === 0) return 'unknown';
      const target = timestampCol.toLowerCase();
      return columns.some((c) => (c.name || '').toLowerCase() === target) ? 'ok' : 'missing';
    } catch (error) {
      logger.warn('타임스탬프 컬럼 검증 실패(컬럼 메타 조회 불가) — 증분 시도 계속', {
        tableName,
        timestampCol,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unknown';
    }
  }

  /**
   * 기동 시 고객/구매 타임스탬프 컬럼 실재 검증.
   * index.ts에서 최초 동기화 전에 호출 — 누락이면 즉시 경고를 남겨,
   * 60분 뒤 첫 증분 주기에서야 문제가 드러나는 일을 차단한다.
   */
  async validateTimestampColumnsAtStartup(): Promise<Array<{
    target: SyncTarget;
    table: string;
    column: string;
    status: 'ok' | 'missing' | 'unknown';
  }>> {
    const targets: SyncTarget[] = ['customers'];
    if (this.config.purchaseTable) targets.push('purchases');

    const report: Array<{
      target: SyncTarget;
      table: string;
      column: string;
      status: 'ok' | 'missing' | 'unknown';
    }> = [];

    for (const target of targets) {
      const table = target === 'customers' ? this.config.customerTable : this.config.purchaseTable;
      const column = this.getTimestampForTarget(target);
      const status = await this.checkTimestampColumn(table, column);
      report.push({ target, table, column, status });

      if (status === 'missing') {
        if (this.config.fallbackToFullSync) {
          logger.warn(
            `[기동 검증] 타임스탬프 컬럼 '${column}'이 테이블 '${table}'에 없습니다 — ` +
            `증분 주기마다 전체 동기화로 대체합니다. ` +
            `(권장: 테이블에 갱신 시각 컬럼을 추가하고 --edit-config로 컬럼명 지정)`,
          );
        } else {
          logger.error(
            `[기동 검증] 타임스탬프 컬럼 '${column}'이 테이블 '${table}'에 없습니다 — ` +
            `fallbackToFullSync=false 설정이라 증분 동기화가 매 주기 중단됩니다. ` +
            `--edit-config로 올바른 컬럼을 지정해주세요.`,
          );
        }
      }
    }
    return report;
  }

  // ─── 증분 동기화 ──────────────────────────────────────

  async runIncremental(target: SyncTarget): Promise<SyncResult> {
    // ★ v1.4.1: 구매 테이블 미사용(옵션) — 조기 종료하여 빈 결과 반환
    if (target === 'purchases' && !this.config.purchaseTable) {
      logger.info('구매 테이블 미설정 — 구매 증분 동기화 스킵 (사용 안 함 옵션)');
      const now = new Date().toISOString();
      return {
        target, mode: 'incremental',
        totalCount: 0, successCount: 0, failCount: 0, skippedCount: 0,
        durationMs: 0, startedAt: now, completedAt: now, errors: [],
      };
    }

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const errors: SyncError[] = [];

    const tableName = target === 'customers'
      ? this.config.customerTable
      : this.config.purchaseTable;

    const timestampCol = this.getTimestampForTarget(target);

    // ★ 2026-06-11: 증분 직전 타임스탬프 컬럼 실재 검증 (인비토 SyncTest updated_at 부재 실측)
    const columnStatus = await this.checkTimestampColumn(tableName, timestampCol);
    if (columnStatus === 'missing') {
      if (this.config.fallbackToFullSync) {
        logger.warn(
          `타임스탬프 컬럼 '${timestampCol}'이 테이블 '${tableName}'에 없음 → 전체 동기화로 대체합니다. ` +
          `(권장: 테이블에 갱신 시각 컬럼을 추가하고 --edit-config로 컬럼명 지정)`,
        );
        return this.runFull(target);
      }
      throw new Error(
        `타임스탬프 컬럼 '${timestampCol}'이 테이블 '${tableName}'에 없습니다. ` +
        `fallbackToFullSync=false 설정이라 증분 동기화를 중단합니다. ` +
        `--edit-config로 올바른 컬럼을 지정해주세요.`,
      );
    }

    // ★ 2026-08-03 커서 재설계 — 키셋 지원 어댑터(oracle·mssql·mysql·postgresql)는 새 경로.
    //   미지원(excel·csv — 해시 diff 방식이라 커서 무관)은 아래 기존 경로를 그대로 탄다.
    if (this.db.fetchIncrementalKeyset) {
      return this.runIncrementalKeyset(target, tableName, timestampCol, startedAt, startTime);
    }

    const lastSyncAt = this.stateManager.getLastSyncAt(target);
    logger.info(`증분 동기화 시작: ${target}`, { tableName, timestampCol, lastSyncAt });

    // 마지막 동기화 시각이 없으면 → 전체 동기화로 폴백
    if (!lastSyncAt) {
      logger.info('마지막 동기화 기록 없음 → 전체 동기화로 전환');
      return this.runFull(target);
    }

    let totalCount = 0;
    let successCount = 0;
    let failCount = 0;
    let offset = 0;

    while (true) {
      // DB에서 변경분 조회 — 타겟별 timestamp 컬럼 사용
      const rows = await this.db.fetchIncremental(
        tableName,
        timestampCol,
        lastSyncAt,
        this.config.batchSize,
        offset,
      );

      // ★ 2026-06-30: full과 동일 — "짧은 페이지면 끝" 단정 제거. 빈 페이지에서만 종료한다.
      //   깊은 OFFSET 구간에서 짧은 페이지가 오면 변경분을 일부만 받고 끊기던 조기 종료를 차단.
      if (rows.length === 0) break;

      // 파이프라인 실행
      const result = await this.processBatch(target, rows, 'incremental');
      totalCount += result.total;
      successCount += result.success;
      failCount += result.fail;
      errors.push(...result.errors);

      offset += rows.length;
    }

    // 상태 업데이트
    const completedAt = new Date().toISOString();
    if (successCount > 0) {
      this.stateManager.updateAfterSync(target, completedAt, successCount);
    }

    const result: SyncResult = {
      target,
      mode: 'incremental',
      totalCount,
      successCount,
      failCount,
      skippedCount: 0,
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt,
      errors,
    };

    this.logResult(result);
    await this.sendSyncLog(result);
    return result;
  }

  // ─── 증분 동기화: 키셋 커서 경로 (★ 2026-08-03 · Codex 적대검증 반영) ────────
  //
  // 커서 = 마지막 처리 행이 아니라 **닫힌 경계**. 완료 시각을 넣던 옛 구조가 시각 없는 판매일
  // 컬럼(이새 — 전량 자정)과 만나 그날 첫 배치 뒤 하루치를 영구 탈락시켰고, "마지막 행" 커서도
  // 같은 ts에 낮은 PK가 나중에 삽입되면(UUID·문자 PK) 그 행을 영구 유실한다(Codex F2 — PK 단조를
  // 아무도 보장하지 않는다).
  // 전진 규칙:
  //   - 커서는 **더 큰 ts가 관측된 버킷의 마지막 행**까지만 저장한다. 최대 ts 버킷(열린 버킷)은
  //     저장하지 않고 매 주기 재조회한다 — 겹침은 서버 멱등이 흡수한다(그래서 키 없는 행은 보내지 않는다).
  //   - API 실패(네트워크·5xx) = 미전진(다음 주기 재시도)
  //   - 행 검증 실패(전화번호 불량·키 직렬화 불가) = 전진 + failures 보고 — 멈추면 영구 재조회 루프
  //   - 닫힌 경계는 그 행이 포함된 페이지 전송 성공 후에만 저장 — 중간에 죽어도 재개 지점이 안전하다
  //   - 커서 fingerprint(소스·테이블·ts컬럼·PK 구성)가 하나라도 다르면 폐기 → 전량 재기준(Codex F3)

  /**
   * 커서 정체성 — 소스가 바뀌면 커서는 무효다.
   * 구분자 결합은 값 안의 구분자로 서로 다른 소스가 같은 문자열이 될 수 있다(Codex 3R F11 —
   * 비단사). JSON 직렬화는 경계를 이스케이프하므로 조립이 구조적으로 단사다.
   */
  private cursorFingerprint(tableName: string, timestampCol: string, pkCols: string[]): string {
    const sourceId = this.db.getSourceId ? this.db.getSourceId() : '';
    return JSON.stringify([this.db.dbType, sourceId, tableName, timestampCol, pkCols]);
  }

  /** PK 컬럼 해석 — getColumns 메타(isPrimaryKey, 복합 포함) 기반. 시노님 해석은 어댑터 getColumns가 이미 소유. */
  private async resolvePkColumns(tableName: string): Promise<
    | { ok: true; columns: string[]; nonScalarPk: string | null }
    | { ok: false; error: string }
  > {
    let columns: ColumnInfo[];
    try {
      columns = await this.db.getColumns(tableName);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const pks = columns.filter((c) => c.isPrimaryKey);
    // 날짜형 PK는 결정적 직렬화가 불가(드라이버 변환이 프로세스 TZ 의존) — 정직하게 잠근다.
    const nonScalar = pks.find((c) => ['datetime', 'date', 'timestamp', 'binary'].includes((c.dataType || '').toLowerCase()));
    return { ok: true, columns: pks.map((c) => c.name), nonScalarPk: nonScalar ? nonScalar.name : null };
  }

  private async runIncrementalKeyset(
    target: SyncTarget,
    tableName: string,
    timestampCol: string,
    startedAt: string,
    startTime: number,
  ): Promise<SyncResult> {
    const errors: SyncError[] = [];
    const finish = async (totals: { total: number; success: number; fail: number }): Promise<SyncResult> => {
      const completedAt = new Date().toISOString();
      if (totals.success > 0 && !this.config.dryRun) {
        this.stateManager.updateAfterSync(target, completedAt, totals.success);
      }
      const result: SyncResult = {
        target, mode: 'incremental',
        totalCount: totals.total, successCount: totals.success, failCount: totals.fail,
        skippedCount: 0, durationMs: Date.now() - startTime, startedAt, completedAt, errors,
      };
      this.logResult(result);
      await this.sendSyncLog(result);
      return result;
    };

    // 키셋 경로는 getSourceId가 필수 계약이다(4R F13) — 없으면 같은 dbType의 다른 소스가
    // 같은 fingerprint를 만들어, 소스 교체 후 옛 커서 재사용으로 앞부분 행을 조용히 건너뛴다.
    if (!this.db.getSourceId) {
      errors.push({
        code: 'INCREMENTAL_LOCKED_NO_SOURCE_ID',
        message: '증분 불가: 이 어댑터는 소스 식별자(getSourceId)를 제공하지 않아 커서를 신뢰할 수 없습니다.',
      });
      logger.warn(`증분 잠금(${target}): getSourceId 미구현 어댑터`);
      return finish({ total: 0, success: 0, fail: 0 });
    }

    // 증분 보류(타임스탬프 전부 NULL 등) — 매 주기 전량 폭주 대신 1행 탐침만 찔러 본다.
    //   시각 값이 나타나면(소스가 갱신 시각을 채우기 시작) 보류를 풀고 전량으로 기준을 다시 잡는다 —
    //   보류 기간에 쌓인 행은 커서 이전이라 증분으로는 영영 안 잡히기 때문에 전량 재기준이 유일한 길이다.
    const hold = this.stateManager.getIncrementalHold(target);
    if (hold) {
      let probe: import('../db/keyset').IncrementalCursor | null = null;
      if (this.db.fetchMaxCursor) {
        const probePk = await this.resolvePkColumns(tableName);
        if (probePk.ok && probePk.columns.length > 0 && !probePk.nonScalarPk) {
          try {
            probe = await this.db.fetchMaxCursor(tableName, timestampCol, probePk.columns);
          } catch { /* 탐침 실패 = 보류 유지 */ }
        }
      }
      if (probe) {
        logger.info(`증분 보류 해제(${target}) — 타임스탬프 값 관측, 전체 동기화로 기준 재설정`);
        this.stateManager.setIncrementalHold(target, null);
        return this.runFull(target);
      }
      errors.push({ code: 'INCREMENTAL_HOLD', message: `증분 보류: ${hold}` });
      logger.warn(`증분 보류 중(${target}): ${hold}`);
      return finish({ total: 0, success: 0, fail: 0 });
    }

    const pkResult = await this.resolvePkColumns(tableName);
    if (!pkResult.ok) {
      // 메타 조회 실패(권한 등) — 커서를 움직이지 않고 이번 주기는 실패 보고(다음 주기 재시도).
      errors.push({ code: 'PK_META_FAILED', message: `PK 메타 조회 실패: ${pkResult.error}` });
      return finish({ total: 0, success: 0, fail: 0 });
    }
    if (pkResult.columns.length === 0) {
      // PK 없는 테이블 — 자연키를 지어내면 같은 날 같은 상품 두 건이 한 건이 된다. 정직하게 잠근다.
      errors.push({
        code: 'INCREMENTAL_LOCKED_NO_PK',
        message: `증분 불가: 테이블 '${tableName}'에 기본키가 없습니다. 전체 동기화만 가능합니다 — 소스 테이블에 기본키(또는 유일한 행 번호)를 두면 열립니다.`,
      });
      logger.warn(`증분 잠금(${target}): '${tableName}' PK 없음`);
      return finish({ total: 0, success: 0, fail: 0 });
    }
    if (pkResult.nonScalarPk) {
      errors.push({
        code: 'INCREMENTAL_LOCKED_PK_TYPE',
        message: `증분 불가: PK 컬럼 '${pkResult.nonScalarPk}'가 날짜/이진형입니다. 문자·숫자 PK만 증분을 지원합니다.`,
      });
      logger.warn(`증분 잠금(${target}): PK 타입 미지원(${pkResult.nonScalarPk})`);
      return finish({ total: 0, success: 0, fail: 0 });
    }
    const pkCols = pkResult.columns;
    const fingerprint = this.cursorFingerprint(tableName, timestampCol, pkCols);

    let cursor = this.stateManager.getCursor(target);
    if (cursor && cursor.fingerprint !== fingerprint) {
      // 소스·테이블·ts컬럼·PK 구성 중 무엇이든 바뀌면 옛 커서는 새 소스의 행을 건너뛴다 — fail-closed 폐기.
      logger.warn('커서 fingerprint 불일치 — 커서 폐기, 전체 동기화로 기준을 다시 잡습니다', {
        stored: cursor.fingerprint, current: fingerprint,
      });
      cursor = null;
    }
    if (cursor && cursor.keys.length > 0 && !cursorKeysValid(cursor.keys)) {
      logger.warn('저장된 커서 키가 스칼라가 아님 — 전체 동기화로 기준을 다시 잡습니다');
      cursor = null;
    }
    if (!cursor) {
      // 신규 설치·옛 형식(완료 시각) 커서·fingerprint 변경 — 전량이 기준을 다시 잡고 씨앗을 심는다(runFull).
      logger.info(`키셋 커서 없음(${target}) → 전체 동기화로 기준 재설정`);
      return this.runFull(target);
    }

    logger.info(`증분 동기화 시작(키셋): ${target}`, { tableName, timestampCol, pkCols, cursorTs: cursor.tsRaw, openBucket: cursor.keys.length === 0 });

    let totalCount = 0;
    let successCount = 0;
    let failCount = 0;

    // 페이지 넘김용 스캔 커서(메모리) — 저장 커서와 다르다. 스캔은 튜플 strict >로 앞으로만 가고,
    // 저장은 닫힌 버킷 경계까지만 간다(열린 버킷은 다음 주기에 재조회).
    let scanCursor: { tsRaw: string; keys: (string | number)[] } = { tsRaw: cursor.tsRaw, keys: cursor.keys };
    let prevMeta: { tsRaw: string; keys: (string | number)[] } | null = null;
    let closedBoundary: { tsRaw: string; keys: (string | number)[] } | null = null;
    let persistedBoundaryTs: string | null = null;

    while (true) {
      const { rows, meta } = await this.db.fetchIncrementalKeyset!(
        tableName, timestampCol, pkCols, scanCursor, this.config.batchSize,
      );
      if (rows.length === 0) break;

      // 키 검증은 전송 **전에** — 스칼라 아닌 키가 하나라도 있으면 보내지도 전진하지도 않는다(Codex F4).
      if (!meta.every((m) => cursorKeysValid(m.keys))) {
        errors.push({
          code: 'INCREMENTAL_LOCKED_KEY_TYPE',
          message: 'PK 값이 문자·숫자로 왕복되지 않는 행이 있어 증분을 중단합니다(커서·멱등키 오염 방지).',
        });
        logger.warn(`증분 중단(${target}): 비스칼라 PK 값 관측`);
        break;
      }

      // 직렬화 불가(초과 길이 등) 행은 키 없이 보내지 않는다 — 열린 버킷 재조회마다 중복이 쌓인다(Codex F4).
      //   그 행만 제외하고 행 실패로 보고한다. 커서 경계 계산에는 남긴다(영구 실패로 기록된 행이다).
      let sendRows = rows;
      let srkList: (string | null)[] | undefined;
      if (target === 'purchases') {
        const all = meta.map((m) => serializeSourceRowKey(m.keys));
        const excludedIdx: number[] = [];
        for (let i = 0; i < all.length; i++) if (all[i] === null) excludedIdx.push(i);
        if (excludedIdx.length > 0) {
          for (const i of excludedIdx) {
            failCount++;
            errors.push({
              code: 'SOURCE_KEY_UNSERIALIZABLE',
              message: `원본 행 키 직렬화 불가(길이 초과 또는 NULL 포함) — 행을 보내지 않았습니다.`,
              recordKey: String((rows[i] as Record<string, unknown>).customer_phone ?? meta[i].keys.join('|')),
            });
          }
          const keep = (arr: any[]) => arr.filter((_, i) => !excludedIdx.includes(i));
          sendRows = keep(rows);
          srkList = keep(all);
        } else {
          srkList = all;
        }
      }

      if (sendRows.length > 0) {
        const result = await this.processBatch(target, sendRows, 'incremental', undefined, undefined, srkList);
        totalCount += result.total;
        successCount += result.success;
        failCount += result.fail;
        errors.push(...result.errors);

        if (result.errors.some((e) => e.code === 'API_SEND_FAILED')) {
          logger.warn('API 전송 실패 — 커서를 전진하지 않습니다(다음 주기 재시도, 서버 멱등이 겹침 흡수)');
          break;
        }
      }

      // 닫힌 버킷 경계 갱신 — ts가 바뀌는 지점의 직전 행이 "그 버킷의 끝"이다.
      for (const m of meta) {
        if (prevMeta && m.tsRaw !== prevMeta.tsRaw) closedBoundary = prevMeta;
        prevMeta = m;
      }
      // 이 페이지 전송이 성공했으므로, 경계가 전진했으면 저장한다(경계 행은 이미 보낸 행이다).
      if (closedBoundary && closedBoundary.tsRaw !== persistedBoundaryTs) {
        const next: SyncCursorState = {
          tsRaw: closedBoundary.tsRaw, keys: closedBoundary.keys, pkColumns: pkCols, fingerprint,
        };
        if (this.config.dryRun) {
          logger.info('🧪 [DRY RUN] 커서 저장 스킵', { tsRaw: next.tsRaw });
        } else {
          this.stateManager.setCursor(target, next);
        }
        persistedBoundaryTs = closedBoundary.tsRaw;
      }

      const last = meta[meta.length - 1];
      scanCursor = { tsRaw: last.tsRaw, keys: last.keys };

      // 키셋은 짧은 페이지가 곧 끝(커서 이후 행 없음) — OFFSET과 달리 신뢰 가능.
      // 마지막(최대 ts) 버킷은 저장하지 않은 채 끝난다 — 다음 주기가 재조회하고 서버 멱등이 흡수한다.
      if (rows.length < this.config.batchSize) break;
    }

    return finish({ total: totalCount, success: successCount, fail: failCount });
  }

  // ─── 전체 동기화 ──────────────────────────────────────

  async runFull(target: SyncTarget): Promise<SyncResult> {
    // ★ v1.4.1: 구매 테이블 미사용(옵션) — 조기 종료하여 빈 결과 반환
    if (target === 'purchases' && !this.config.purchaseTable) {
      logger.info('구매 테이블 미설정 — 구매 전체 동기화 스킵 (사용 안 함 옵션)');
      const now = new Date().toISOString();
      return {
        target, mode: 'full',
        totalCount: 0, successCount: 0, failCount: 0, skippedCount: 0,
        durationMs: 0, startedAt: now, completedAt: now, errors: [],
      };
    }

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const errors: SyncError[] = [];

    const tableName = target === 'customers'
      ? this.config.customerTable
      : this.config.purchaseTable;

    const totalRows = await this.db.getRowCount(tableName);
    const totalBatches = Math.ceil(totalRows / this.config.batchSize);

    logger.info(`전체 동기화 시작: ${target}`, { tableName, totalRows, totalBatches });

    // ★ 2026-08-03 커서 씨앗 (Codex 적대검증 반영) — 전량 스캔은 PK 순서라 "마지막 행"이 최대 시각이 아니다.
    //   씨앗은 **시작 시점의 닫힌 버킷 경계**다: 최대 ts 버킷은 아직 열려 있어(같은 ts로 계속 삽입)
    //   그 안의 튜플을 커서로 삼으면 낮은 PK 후행 삽입이 영구 유실된다(F2). 그래서 2단 조회 —
    //   ①최대 튜플(T0) ②ts < T0.tsRaw 중 최대 = 닫힌 경계. ②가 없으면(버킷 하나뿐) 열린 버킷
    //   시작 커서(keys=[] → ts >= T0)로 저장해 매 주기 재조회시킨다.
    //   PK 추출은 srk(원본 행 키)에도 같이 쓴다.
    let seedClosed: import('../db/keyset').IncrementalCursor | null = null;
    let seedOpenTs: string | null = null;
    let seedWanted = false;
    let fullPkCols: string[] = [];
    const probeSeed = async (tsCol: string): Promise<void> => {
      const t0 = await this.db.fetchMaxCursor!(tableName, tsCol, fullPkCols);
      if (!t0) { seedClosed = null; seedOpenTs = null; return; }
      seedClosed = await this.db.fetchMaxCursor!(tableName, tsCol, fullPkCols, t0.tsRaw);
      seedOpenTs = seedClosed ? null : t0.tsRaw;
    };
    if (this.db.fetchIncrementalKeyset && this.db.fetchMaxCursor && this.db.getSourceId) {
      const tsCol = this.getTimestampForTarget(target);
      const pkResult = await this.resolvePkColumns(tableName);
      const tsOk = (await this.checkTimestampColumn(tableName, tsCol)) === 'ok';
      if (pkResult.ok && pkResult.columns.length > 0 && !pkResult.nonScalarPk) {
        fullPkCols = pkResult.columns;
        if (tsOk) {
          seedWanted = true;
          try {
            await probeSeed(tsCol);
          } catch (seedErr) {
            logger.warn('커서 씨앗 조회 실패 — 전량 완료 후 재시도', {
              error: seedErr instanceof Error ? seedErr.message : String(seedErr),
            });
          }
        }
      }
    }

    let totalCount = 0;
    let successCount = 0;
    let failCount = 0;
    let batchIndex = 0;
    let fetchedRows = 0;

    const processFullBatch = async (rows: RawRow[]): Promise<void> => {
      batchIndex++;
      logger.info(`배치 ${batchIndex}/${totalBatches} 처리 중 (${rows.length}건)`);
      // 원본 행 키 — 전량도 멱등 적재(재싱크·재시도가 중복 행을 만들지 않는다). purchases만.
      //   PK가 있는데 직렬화 불가한 행은 키 없이 보내지 않고 행 실패로 보고한다(Codex F4 —
      //   키 없는 행은 재실행마다 중복이 쌓인다). PK 자체가 없는 테이블은 기존대로 키 없이 보낸다
      //   (증분은 어차피 잠겨 있고, 재기준 시 선삭제가 운영 절차다).
      let sendRows = rows;
      let srkList: (string | null)[] | undefined;
      if (target === 'purchases' && fullPkCols.length > 0) {
        const all = rows.map((r) => serializeSourceRowKey(fullPkCols.map((c) => r[c])));
        const excludedIdx: number[] = [];
        for (let i = 0; i < all.length; i++) if (all[i] === null) excludedIdx.push(i);
        if (excludedIdx.length > 0) {
          for (const i of excludedIdx) {
            failCount++;
            errors.push({
              code: 'SOURCE_KEY_UNSERIALIZABLE',
              message: '원본 행 키 직렬화 불가(길이 초과·NULL·비스칼라) — 행을 보내지 않았습니다.',
              recordKey: String(fullPkCols.map((c) => (rows[i] as Record<string, unknown>)[c]).join('|')),
            });
          }
          const keep = (arr: any[]) => arr.filter((_, i) => !excludedIdx.includes(i));
          sendRows = keep(rows);
          srkList = keep(all);
        } else {
          srkList = all;
        }
      }
      fetchedRows += rows.length;
      totalCount += rows.length - sendRows.length; // 제외 행도 총량에 계상(실패로 이미 집계)
      if (sendRows.length === 0) return;
      const result = await this.processBatch(target, sendRows, 'full', batchIndex, totalBatches, srkList);
      totalCount += result.total;
      successCount += result.success;
      failCount += result.fail;
      errors.push(...result.errors);
    };

    // ★ 2026-06-30 (이새에프앤씨 full 조기종료 근본 정정):
    //   원천 13만(계획 35배치)인데 full이 25배치(~10만)에서 끊긴 사고 = 깊은 OFFSET 구간에서
    //   fetchAll이 뒤에 데이터가 더 있는데도 짧은/빈 페이지를 돌려줘 "짧으면 끝" 단정으로 조기 종료.
    //   (1) 안정 키(키셋) 우선 — 깊은 OFFSET 재스캔이 없어 구조적으로 조기 종료가 없다.
    //   (2) 키셋 미구현/실패 시 OFFSET 폴백을 getRowCount(총건수)까지 구동(짧은 페이지로 안 끊김).
    //   (3) 완전성 가드 — 받은 수 < 총건수면 명확 경고(조용한 누락 차단).
    let keysetDone = false;
    const fetchKeyset = this.db.fetchAllKeyset?.bind(this.db);
    if (fetchKeyset) {
      try {
        let afterKey: string | null = null;
        while (true) {
          const { rows, lastKey } = await fetchKeyset(tableName, this.config.batchSize, afterKey);
          if (rows.length === 0) break;
          await processFullBatch(rows);
          // 키셋은 짧은 페이지가 곧 끝(키 이후 행 없음) — OFFSET과 달리 신뢰 가능.
          if (rows.length < this.config.batchSize || lastKey == null) break;
          afterKey = lastKey;
        }
        keysetDone = true;
      } catch (keysetErr) {
        logger.warn('키셋 전체 조회 실패 → OFFSET 폴백', {
          error: keysetErr instanceof Error ? keysetErr.message : String(keysetErr),
        });
      }
    }

    if (!keysetDone) {
      // OFFSET 폴백 — 처음부터 다시(UPSERT라 중복 무해). 키셋 부분처리분 카운트 리셋.
      totalCount = 0;
      successCount = 0;
      failCount = 0;
      batchIndex = 0;
      fetchedRows = 0;
      errors.length = 0;
      let offset = 0;
      let emptyRetries = 0;
      const MAX_EMPTY_RETRIES = 3;
      while (totalRows === 0 || offset < totalRows) {
        const rows = await this.db.fetchAll(tableName, this.config.batchSize, offset);
        if (rows.length === 0) {
          // 총건수 모를 때(0)는 빈 페이지가 곧 끝. 알 때는 일시 오류 가능 → 제한 재시도.
          if (totalRows === 0 || ++emptyRetries > MAX_EMPTY_RETRIES) break;
          continue;
        }
        emptyRetries = 0;
        await processFullBatch(rows);
        offset += rows.length;
      }
    }

    // 완전성 가드 — 받은 수 < 원천 총건수면 명확 경고(조용한 누락 차단).
    if (totalRows > 0 && fetchedRows < totalRows) {
      logger.warn(
        `전체 동기화 미완료 감지: ${fetchedRows}/${totalRows}건 수신 ` +
        `(${totalRows - fetchedRows}건 누락) — 다음 동기화 주기에서 보강 필요.`,
        { target, tableName },
      );
    }

    // 상태 업데이트
    const completedAt = new Date().toISOString();
    if (successCount > 0 && !this.config.dryRun) {
      this.stateManager.updateAfterSync(target, completedAt, successCount);
      this.stateManager.updateFullSyncAt(completedAt);
    }

    // ★ 2026-08-03 — 커서 씨앗 심기 (Codex 1R F1 + 2R F7 게이트).
    //   씨앗은 **시작 시점 탐침만** 쓴다. 종료 후 재탐침으로 씨앗을 만들면 마지막 페이지 이후
    //   삽입된 미전송 행이 씨앗 아래로 들어가 영구 유실된다(2R F7). 재탐침은 아래 보류 판정에만 쓴다.
    //   완전성: 카운트가 0인데 행을 받았다면 카운트 자체가 틀린 것 — 완결로 취급하지 않는다.
    const scanComplete = totalRows > 0 ? fetchedRows >= totalRows : fetchedRows === 0;
    const apiFailed = errors.some((e) => e.code === 'API_SEND_FAILED');
    if (seedWanted && !scanComplete) {
      logger.warn(
        `전량 미완(수신 ${fetchedRows}/${totalRows}) — 커서를 남기지 않습니다. ` +
        `다음 주기가 전체 동기화를 다시 시도합니다(서버 멱등이 겹침 흡수).`,
        { target },
      );
    } else if (seedWanted && apiFailed) {
      logger.warn(`전량 중 API 실패 — 커서를 남기지 않습니다(다음 주기 전량 재시도).`, { target });
    } else if (seedWanted && successCount > 0 && !this.config.dryRun) {
      const fp = this.cursorFingerprint(tableName, this.getTimestampForTarget(target), fullPkCols);
      if (seedClosed && cursorKeysValid((seedClosed as any).keys)) {
        const sc = seedClosed as import('../db/keyset').IncrementalCursor;
        this.stateManager.setCursor(target, { tsRaw: sc.tsRaw, keys: sc.keys, pkColumns: fullPkCols, fingerprint: fp });
        this.stateManager.setIncrementalHold(target, null);
        logger.info(`커서 씨앗 저장(${target}) — 닫힌 버킷 경계`, { tsRaw: sc.tsRaw });
      } else if (seedOpenTs) {
        // 버킷이 하나뿐(신규 매장 첫날 등) — 열린 버킷 시작 커서로 저장, 매 주기 그 버킷을 재조회한다.
        this.stateManager.setCursor(target, { tsRaw: seedOpenTs, keys: [], pkColumns: fullPkCols, fingerprint: fp });
        this.stateManager.setIncrementalHold(target, null);
        logger.info(`커서 씨앗 저장(${target}) — 열린 버킷 시작(ts >= 재조회)`, { tsRaw: seedOpenTs });
      } else {
        // 시작 탐침이 비었는데 행을 보냈다 — 시각 값이 전부 NULL이거나(보류) 스캔 중 새 행이 생긴 것(재기준).
        //   재탐침은 **씨앗이 아니라 이 판정에만** 쓴다: 값이 관측되면 보류 없이 커서도 없이 두어
        //   다음 주기가 전량으로 재기준한다. 여전히 비면 NULL 보류(매 주기 전량 폭주 방지).
        let endProbe: import('../db/keyset').IncrementalCursor | null = null;
        if (this.db.fetchMaxCursor) {
          try { endProbe = await this.db.fetchMaxCursor(tableName, this.getTimestampForTarget(target), fullPkCols); } catch { /* 보류 유지 */ }
        }
        if (endProbe) {
          logger.info(`씨앗 미저장(${target}) — 스캔 중 신규 행 관측, 다음 주기 전량 재기준`);
        } else {
          this.stateManager.setIncrementalHold(
            target,
            `타임스탬프 컬럼 값이 전부 NULL이라 증분 기준을 잡을 수 없습니다(전체 동기화만 가능). ` +
            `소스에서 갱신 시각이 채워지기 시작하면 전체 동기화를 한 번 다시 실행해 주세요.`,
          );
          logger.warn(`증분 보류 설정(${target}): 타임스탬프 값 없음`);
        }
      }
    }

    const result: SyncResult = {
      target,
      mode: 'full',
      totalCount,
      successCount,
      failCount,
      skippedCount: 0,
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt,
      errors,
    };

    this.logResult(result);
    await this.sendSyncLog(result);
    return result;
  }

  // ─── 배치 처리 파이프라인 ─────────────────────────────

  private async processBatch(
    target: SyncTarget,
    rows: Record<string, unknown>[],
    mode: SyncMode,
    batchIndex?: number,
    totalBatches?: number,
    // ★ 2026-08-03: 원본 행 키(rows[i]와 1:1, null=키 없이 legacy 적재) — purchases만 사용.
    sourceRowKeys?: (string | null)[],
  ): Promise<{ total: number; success: number; fail: number; errors: SyncError[] }> {
    const errors: SyncError[] = [];

    // ① 컬럼 매핑
    const mapping = target === 'customers'
      ? this.config.customerMapping
      : this.config.purchaseMapping;
    const mapped = mapBatch(rows, mapping);

    // ①-1 원본 행 키 부착 — mapBatch는 1:1 순서 보존(rows.map). 매핑이 만든 새 객체에는
    //   소스 PK 컬럼이 없으므로 여기서 붙인다. 정규화는 spread 복사라 통과하고, Zod 스키마에 등재돼 있다.
    if (sourceRowKeys && target === 'purchases') {
      for (let i = 0; i < mapped.length; i++) {
        if (sourceRowKeys[i]) (mapped[i] as Record<string, unknown>).source_row_key = sourceRowKeys[i];
      }
    }

    // ② 데이터 정규화
    const normalizeResult = target === 'customers'
      ? normalizeCustomerBatch(mapped)
      : normalizePurchaseBatch(mapped);

    // 정규화 실패 건 로깅
    for (const dropped of normalizeResult.dropped) {
      errors.push({
        code: 'NORMALIZE_FAILED',
        message: dropped.reason,
        recordKey: String(dropped.row.phone || dropped.row.customer_phone || 'unknown'),
      });
    }

    // ③ Zod 유효성 검증
    let validData: Record<string, unknown>[];
    if (target === 'customers') {
      const validation = validateCustomers(normalizeResult.normalized);
      validData = validation.valid as Record<string, unknown>[];
      for (const invalid of validation.invalid) {
        errors.push({
          code: 'VALIDATION_FAILED',
          message: invalid.errors.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
          recordKey: String(invalid.raw.phone || 'unknown'),
        });
      }
    } else {
      const validation = validatePurchases(normalizeResult.normalized);
      validData = validation.valid as Record<string, unknown>[];
      for (const invalid of validation.invalid) {
        errors.push({
          code: 'VALIDATION_FAILED',
          message: invalid.errors.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
          recordKey: String(invalid.raw.customer_phone || 'unknown'),
        });
      }
    }

    logger.info(`파이프라인 결과: 원본 ${rows.length}건 → 정규화 ${normalizeResult.normalized.length}건 → 유효 ${validData.length}건`);

    // ④ API 전송 (또는 dry run)
    let successCount = 0;
    if (validData.length > 0) {
      if (this.config.dryRun) {
        logger.info(`🧪 [DRY RUN] API 전송 스킵 — ${validData.length}건`);
        logger.info('📋 정규화 결과 샘플 (최대 3건):');
        for (const item of validData.slice(0, 3)) {
          logger.info(JSON.stringify(item, null, 2));
        }
        successCount = validData.length;
      } else if (this.apiClient) {
        try {
          if (target === 'customers') {
            const response = await this.apiClient.syncCustomers({
              customers: validData as any,
              mode,
              batchIndex,
              totalBatches,
            });
            successCount = response.data?.upsertedCount ?? validData.length;
          } else {
            const response = await this.apiClient.syncPurchases({
              purchases: validData as any,
              mode,
              batchIndex,
              totalBatches,
            });
            successCount = response.data?.insertedCount ?? validData.length;
          }
        } catch (error) {
          logger.error('API 전송 실패', { error });
          errors.push({
            code: 'API_SEND_FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
          // 큐에 저장 (오프라인 대비)
          if (this.queue) {
            this.queue.enqueue(target, validData);
            logger.info(`전송 실패 → 큐에 ${validData.length}건 저장`);
          }
        }
      }
    }

    return {
      total: rows.length,
      success: successCount,
      fail: rows.length - successCount,
      errors,
    };
  }

  // ─── 결과 로깅 + 알림 ─────────────────────────────────

  private logResult(result: SyncResult): void {
    const emoji = result.failCount === 0 ? '✅' : '⚠️';
    logger.info(
      `${emoji} 동기화 완료: ${result.target} (${result.mode})`,
      {
        total: result.totalCount,
        success: result.successCount,
        fail: result.failCount,
        duration: `${result.durationMs}ms`,
        errors: result.errors.length,
      },
    );

    if (result.errors.length > 0) {
      logger.warn(`오류 상세 (${result.errors.length}건):`);
      for (const err of result.errors.slice(0, 10)) {
        logger.warn(`  [${err.code}] ${err.message}`, { key: err.recordKey });
      }
      if (result.errors.length > 10) {
        logger.warn(`  ... 외 ${result.errors.length - 10}건`);
      }
    }

    // 알림 모듈에 결과 보고
    if (this.alertManager) {
      const hasApiError = result.errors.some(e => e.code === 'API_SEND_FAILED');
      const success = result.failCount === 0 && !hasApiError;
      const details = hasApiError
        ? result.errors.filter(e => e.code === 'API_SEND_FAILED').map(e => e.message).join('; ')
        : undefined;
      this.alertManager.onSyncResult(success, details);
    }
  }

  // ─── 서버에 동기화 로그 전송 ──────────────────────────

  private async sendSyncLog(result: SyncResult): Promise<void> {
    if (this.config.dryRun || !this.apiClient) return;

    const agentId = this.stateManager.getState().agentId;
    if (!agentId) return;

    try {
      await this.apiClient.sendLog({
        agentId,
        syncType: result.target,
        syncMode: result.mode,
        totalCount: result.totalCount,
        successCount: result.successCount,
        failCount: result.failCount,
        durationMs: result.durationMs,
        errorMessage: result.errors.length > 0
          ? result.errors.slice(0, 5).map(e => `[${e.code}] ${e.message}`).join('; ')
          : undefined,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      });
      logger.debug('동기화 로그 서버 전송 완료');
    } catch (error) {
      logger.warn('동기화 로그 서버 전송 실패 (무시)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
