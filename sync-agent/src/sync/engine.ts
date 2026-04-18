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

import type { IDbConnector } from '../db/types';
import type { ApiClient } from '../api/client';
import type { QueueManager } from '../queue';
import type { AlertManager } from '../alert';
import type { SyncTarget, SyncMode, SyncResult, SyncError } from '../types/sync';
import type { ColumnMapping } from '../mapping';
import { mapBatch } from '../mapping';
import { normalizeCustomerBatch, normalizePurchaseBatch } from '../normalize';
import { validateCustomers } from '../types/customer';
import { validatePurchases } from '../types/purchase';
import { SyncStateManager } from './state';
import { getLogger } from '../logger';

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
   * 타겟(customers/purchases)에 맞는 timestamp 컬럼 반환
   * 개별 지정이 있으면 개별값, 없으면 공통 timestampColumn 폴백
   */
  private getTimestampForTarget(target: SyncTarget): string {
    if (target === 'customers') {
      return this.config.customerTimestampColumn || this.config.timestampColumn;
    }
    return this.config.purchaseTimestampColumn || this.config.timestampColumn;
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

      if (rows.length === 0) break;

      // 파이프라인 실행
      const result = await this.processBatch(target, rows, 'incremental');
      totalCount += result.total;
      successCount += result.success;
      failCount += result.fail;
      errors.push(...result.errors);

      offset += rows.length;

      // 조회된 건수가 배치 크기보다 작으면 더 이상 없음
      if (rows.length < this.config.batchSize) break;
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

    let totalCount = 0;
    let successCount = 0;
    let failCount = 0;
    let offset = 0;
    let batchIndex = 0;

    while (true) {
      const rows = await this.db.fetchAll(
        tableName,
        this.config.batchSize,
        offset,
      );

      if (rows.length === 0) break;

      batchIndex++;
      logger.info(`배치 ${batchIndex}/${totalBatches} 처리 중 (${rows.length}건)`);

      const result = await this.processBatch(target, rows, 'full', batchIndex, totalBatches);
      totalCount += result.total;
      successCount += result.success;
      failCount += result.fail;
      errors.push(...result.errors);

      offset += rows.length;

      if (rows.length < this.config.batchSize) break;
    }

    // 상태 업데이트
    const completedAt = new Date().toISOString();
    if (successCount > 0) {
      this.stateManager.updateAfterSync(target, completedAt, successCount);
      this.stateManager.updateFullSyncAt(completedAt);
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
  ): Promise<{ total: number; success: number; fail: number; errors: SyncError[] }> {
    const errors: SyncError[] = [];

    // ① 컬럼 매핑
    const mapping = target === 'customers'
      ? this.config.customerMapping
      : this.config.purchaseMapping;
    const mapped = mapBatch(rows, mapping);

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
