/**
 * 스케줄러 모듈 (node-cron)
 *
 * 동작 (v1.5.0 설계서 §7):
 *   - 고객 동기화: 매 N분 (기본 360분 = 6시간)
 *   - 구매 동기화: 매 N분 (기본 360분 = 6시간)
 *   - Heartbeat: 매 60분 (1시간)
 *   - 큐 재전송: 매 30분 (테스트: 매 1분)
 *   - 큐 정리: 매일 자정
 *   - 원격 설정 폴링: ★제거 (싱크 응답 config로 대체 — ApiClient에서 자동 업데이트)
 *
 * v1.5.0 변경:
 *   - 모든 주기 설계서 §7-1 기준으로 통일
 *   - pollRemoteConfig 삭제 — 설정 변경은 싱크 응답의 config 필드로 수신
 *   - 서버 부하 20배 감소 (~19,440회/일 → ~960회/일)
 */

import cron from 'node-cron';
import type { SyncEngine } from '../sync/engine';
import type { HeartbeatManager } from '../heartbeat';
import type { QueueManager } from '../queue';
import type { ApiClient } from '../api/client';
import type { SyncStateManager } from '../sync/state';
import { getLogger } from '../logger';
import type { AgentCommand } from '../types/api';

const logger = getLogger('scheduler');

export interface SchedulerConfig {
  customerIntervalMin: number;
  purchaseIntervalMin: number;
  /** ★ v1.4.1: 구매 동기화 활성화 여부 (default true, 하위호환). false면 구매 cron 등록 자체 안 함 */
  enablePurchase?: boolean;
}

export class Scheduler {
  private engine: SyncEngine;
  private heartbeat: HeartbeatManager | null;
  private queue: QueueManager;
  private apiClient: ApiClient | null;
  private stateManager: SyncStateManager | null;
  private config: SchedulerConfig;
  private tasks: cron.ScheduledTask[] = [];
  private running = false;
  // ★ D131 후속(2026-04-21): 원격 pause 명령 상태 플래그
  //   true면 customer/purchase/queue cron 작업의 실행 분기에서 즉시 skip.
  //   heartbeat는 계속 돌아서 서버에 살아있음 신호 유지.
  private paused = false;

  /** 동시 실행 방지 플래그 */
  private customerSyncing = false;
  private purchaseSyncing = false;
  private queueProcessing = false;

  constructor(
    engine: SyncEngine,
    heartbeat: HeartbeatManager | null,
    queue: QueueManager,
    apiClient: ApiClient | null,
    config: SchedulerConfig,
    stateManager?: SyncStateManager,
  ) {
    this.engine = engine;
    this.heartbeat = heartbeat;
    this.queue = queue;
    this.apiClient = apiClient;
    this.config = config;
    this.stateManager = stateManager || null;
  }

  /**
   * 모든 스케줄 시작
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    const isTestMode = process.env.RETRY_PRESET === 'test';

    // 고객 동기화
    const custCron = this.minutesToCron(this.config.customerIntervalMin);
    this.tasks.push(
      cron.schedule(custCron, async () => {
        // ★ D131 후속: paused면 즉시 skip (cron task는 돌지만 동기화 로직 자체 스킵)
        if (this.paused) {
          logger.debug('⏸️  일시정지 상태 — 고객 동기화 스킵');
          return;
        }
        if (this.customerSyncing) {
          logger.debug('고객 동기화 이미 실행 중 — 스킵');
          return;
        }
        this.customerSyncing = true;
        try {
          logger.info('⏰ [스케줄] 고객 증분 동기화 시작');
          await this.engine.runIncremental('customers');
        } catch (error) {
          logger.error('고객 동기화 스케줄 실패', { error });
        } finally {
          this.customerSyncing = false;
        }
      }),
    );
    logger.info(`고객 동기화 스케줄 등록: 매 ${this.config.customerIntervalMin}분`);

    // 구매 동기화 — ★ v1.4.1: enablePurchase=false 면 등록 스킵 (구매 테이블 미사용 고객사 대응)
    if (this.config.enablePurchase !== false) {
      const purchCron = this.minutesToCron(this.config.purchaseIntervalMin);
      this.tasks.push(
        cron.schedule(purchCron, async () => {
          // ★ D131 후속: paused면 스킵
          if (this.paused) {
            logger.debug('⏸️  일시정지 상태 — 구매 동기화 스킵');
            return;
          }
          if (this.purchaseSyncing) {
            logger.debug('구매 동기화 이미 실행 중 — 스킵');
            return;
          }
          this.purchaseSyncing = true;
          try {
            logger.info('⏰ [스케줄] 구매 증분 동기화 시작');
            await this.engine.runIncremental('purchases');
          } catch (error) {
            logger.error('구매 동기화 스케줄 실패', { error });
          } finally {
            this.purchaseSyncing = false;
          }
        }),
      );
      logger.info(`구매 동기화 스케줄 등록: 매 ${this.config.purchaseIntervalMin}분`);
    } else {
      logger.info('구매 동기화 스케줄 미등록 (구매 테이블 미사용 옵션)');
    }

    // Heartbeat (매 60분 = 1시간 — v1.5.0 설계서 §7-1)
    if (this.heartbeat) {
      this.tasks.push(
        cron.schedule('0 * * * *', async () => {
          await this.heartbeat!.send();
        }),
      );
      logger.info('Heartbeat 스케줄 등록: 매 60분');
    }

    // ※ v1.5.0: 원격 설정 폴링 제거 — 싱크 응답 config로 대체 (ApiClient에서 자동 갱신)

    // 큐 재전송 (프로덕션: 매 30분, 테스트: 매 1분 — v1.5.0 설계서 §7-1)
    const queueCron = isTestMode ? '*/1 * * * *' : '*/30 * * * *';
    const queueIntervalLabel = isTestMode ? '1분 (테스트)' : '30분';
    this.tasks.push(
      cron.schedule(queueCron, async () => {
        await this.processQueue();
      }),
    );
    logger.info(`큐 재전송 스케줄 등록: 매 ${queueIntervalLabel}`);

    // 큐 정리 (매일 자정)
    this.tasks.push(
      cron.schedule('0 0 * * *', () => {
        this.queue.cleanup();
      }),
    );
    logger.info('큐 정리 스케줄 등록: 매일 00:00');

    logger.info('✅ 스케줄러 시작 완료');
  }

  // ─── 원격 설정 적용 (싱크 응답 config → 스케줄러 반영) ───
  //
  // v1.5.0: /api/sync/customers, /api/sync/purchases 응답에 config가 포함된다.
  // ApiClient가 응답을 파싱하여 이 메소드를 호출, 주기 변경 시 스케줄러 재시작.
  //
  // 추적을 위해 lastAppliedVersion을 저장하여 동일 version 반복 재시작을 방지.

  private lastAppliedVersion: string | null = null;

  applyRemoteConfig(remoteConfig: {
    syncIntervalCustomers?: number;
    syncIntervalPurchases?: number;
    heartbeatInterval?: number;
    queueRetryInterval?: number;
    version?: string;
    commands?: AgentCommand[];
  }): void {
    if (!remoteConfig) return;

    // version이 동일하면 스킵 (불필요한 재시작 방지)
    if (remoteConfig.version && remoteConfig.version === this.lastAppliedVersion) {
      return;
    }

    let configChanged = false;

    if (remoteConfig.syncIntervalCustomers &&
        remoteConfig.syncIntervalCustomers !== this.config.customerIntervalMin) {
      logger.info('🔧 원격 설정 변경: 고객 동기화 주기', {
        before: this.config.customerIntervalMin,
        after: remoteConfig.syncIntervalCustomers,
      });
      this.config.customerIntervalMin = remoteConfig.syncIntervalCustomers;
      configChanged = true;
    }

    if (remoteConfig.syncIntervalPurchases &&
        remoteConfig.syncIntervalPurchases !== this.config.purchaseIntervalMin) {
      logger.info('🔧 원격 설정 변경: 구매 동기화 주기', {
        before: this.config.purchaseIntervalMin,
        after: remoteConfig.syncIntervalPurchases,
      });
      this.config.purchaseIntervalMin = remoteConfig.syncIntervalPurchases;
      configChanged = true;
    }

    if (remoteConfig.version) {
      this.lastAppliedVersion = remoteConfig.version;
    }

    // 주기가 변경되면 스케줄러 재시작
    if (configChanged && this.running) {
      logger.info('🔄 동기화 주기 변경 — 스케줄러 재시작');
      this.stop();
      this.start();
    }

    // 원격 명령 처리 (v1.5.0 유지 — full_sync/restart)
    if (remoteConfig.commands && remoteConfig.commands.length > 0) {
      this.processCommands(remoteConfig.commands).catch((e) => {
        logger.error('원격 명령 처리 실패', { error: e instanceof Error ? e.message : String(e) });
      });
    }
  }

  // ─── 원격 명령 처리 ───────────────────────────────────

  private async processCommands(commands: AgentCommand[]): Promise<void> {
    for (const cmd of commands) {
      logger.info(`📡 원격 명령 수신: ${cmd.type}`, { commandId: cmd.id });

      try {
        switch (cmd.type) {
          case 'full_sync':
            logger.info('🔄 원격 명령: 전체 동기화 시작');
            await this.engine.runFull('customers');
            await this.engine.runFull('purchases');
            logger.info('✅ 원격 명령: 전체 동기화 완료');
            break;

          case 'restart':
            logger.info('🔄 원격 명령: Agent 재시작');
            // 프로세스 종료 → Windows 서비스가 자동 재시작
            process.exit(0);
            break;

          // ★ D131 후속(2026-04-21): 원격 pause/resume
          case 'pause':
            logger.info('⏸️  원격 명령: 동기화 일시정지');
            this.pause();
            break;

          case 'resume':
            logger.info('▶️  원격 명령: 동기화 재개');
            this.resume();
            break;

          default:
            logger.warn(`알 수 없는 원격 명령: ${cmd.type}`);
        }
      } catch (error) {
        logger.error(`원격 명령 실행 실패: ${cmd.type}`, {
          commandId: cmd.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 큐에 쌓인 항목 재전송
   */
  private async processQueue(): Promise<void> {
    // ★ D131 후속: paused면 큐 재전송도 스킵 (데이터 저장은 큐에 계속 쌓이지만 송신 중단)
    if (this.paused) {
      logger.debug('⏸️  일시정지 상태 — 큐 재전송 스킵');
      return;
    }
    if (this.queueProcessing || !this.apiClient) return;
    this.queueProcessing = true;

    try {
      const items = this.queue.dequeueAll();
      if (items.length === 0) return;

      logger.info(`📤 큐 재전송 시작: ${items.length}건`);

      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        try {
          const data = JSON.parse(item.payload);

          if (item.type === 'customers') {
            await this.apiClient.syncCustomers({
              customers: data,
              mode: 'incremental',
            });
          } else {
            await this.apiClient.syncPurchases({
              purchases: data,
              mode: 'incremental',
            });
          }

          this.queue.remove(item.id);
          successCount++;
          logger.info(`✅ 큐 항목 전송 성공 (id: ${item.id}, type: ${item.type})`);
        } catch (error) {
          this.queue.incrementRetry(item.id);
          failCount++;
          logger.warn(`❌ 큐 항목 전송 실패 (id: ${item.id}, retry: ${item.retries + 1})`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 결과 요약
      logger.info(`📤 큐 재전송 완료: 성공 ${successCount}건, 실패 ${failCount}건, 잔여 ${this.queue.getCount()}건`);
    } finally {
      this.queueProcessing = false;
    }
  }

  /**
   * 모든 스케줄 중지
   */
  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    this.running = false;
    logger.info('스케줄러 중지');
  }

  // ─── 일시정지/재개 (D131 후속 — 원격 UI 명령용) ─────────
  //
  // pause(): cron task 자체는 살아있지만 실행 분기에서 즉시 return.
  //   → 동기화/큐 재전송 모두 skip. heartbeat는 계속 전송 (서버에 살아있음 + status='paused' 보고).
  // resume(): paused 플래그만 해제. cron task는 다음 스케줄에서 정상 실행.
  //
  // stop()과의 차이: stop()은 cron task 자체 destroy. pause()는 유지 (재개 시 재생성 불필요).

  pause(): void {
    if (this.paused) {
      logger.info('이미 일시정지 상태');
      return;
    }
    this.paused = true;
    // heartbeat에 status 반영 — send() 시점에 isPaused() 체크
    this.heartbeat?.setPaused(true);
    logger.info('⏸️  스케줄러 일시정지 (heartbeat는 유지)');
  }

  resume(): void {
    if (!this.paused) {
      logger.info('이미 실행 중');
      return;
    }
    this.paused = false;
    this.heartbeat?.setPaused(false);
    logger.info('▶️  스케줄러 재개');
  }

  isPaused(): boolean {
    return this.paused;
  }

  // 분 단위를 cron 표현식으로 변환
  private minutesToCron(minutes: number): string {
    if (minutes >= 60 && minutes % 60 === 0) {
      const hours = minutes / 60;
      return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
    }
    return `*/${minutes} * * * *`;
  }
}
