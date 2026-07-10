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
import type { AgentCommand, AgentCommandResult, UpdateConfigPayload, ReportLogsPayload, MappingDryrunPayload } from '../types/api';
import { restartAgent } from '../updater/restart';
// ★ v1.6.1 (P2-7): report_logs 명령 — 최근 로그 tail
import { readRecentLogLines } from '../logger/tail';
import { AGENT_VERSION } from '../version';

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

  // ★ 2026-07-01: update_config 매핑 갱신 시 config.enc 영구 저장 + 필드정의 재등록 콜백.
  //   파일 I/O·API를 scheduler가 직접 몰라도 되게 분리 — index.ts에서 연결.
  private mappingUpdateHandler:
    | ((mapping: NonNullable<UpdateConfigPayload['mapping']>) => Promise<void> | void)
    | null = null;

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

  // ★ 2026-07-01: index.ts에서 config.enc 저장 + 필드정의 재등록 핸들러 연결
  setMappingUpdateHandler(
    handler: (mapping: NonNullable<UpdateConfigPayload['mapping']>) => Promise<void> | void,
  ): void {
    this.mappingUpdateHandler = handler;
  }

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
  //
  // ★ v1.6.1 (P1-4·5): 서버 큐가 At-Least-Once로 재전달하므로
  //   ① command_id 멱등 — 이미 실행한 명령은 재실행하지 않고 "재전달 무시" ACK만 재기록
  //   ② 실행 결과를 state(파일)에 적재 → 다음 heartbeat가 ACK 동봉 → 서버가 큐에서 제거
  //   id 없는 명령(구서버 하위호환)은 기존대로 실행만 하고 ACK 없음.

  private async processCommands(commands: AgentCommand[]): Promise<void> {
    for (const cmd of commands) {
      logger.info(`📡 원격 명령 수신: ${cmd.type}`, { commandId: cmd.id });
      const cmdId = typeof cmd.id === 'string' && cmd.id.length > 0 ? cmd.id : null;

      // 멱등 가드 — 재전달분은 재실행 없이 ACK만 다시 적재(서버 큐 정리 유도)
      if (cmdId && this.stateManager?.hasExecutedCommand(cmdId)) {
        logger.info(`원격 명령 재전달 감지 — 실행 생략(멱등): ${cmd.type}`, { commandId: cmdId });
        this.stateManager.addCommandResult({
          commandId: cmdId,
          type: cmd.type,
          ok: true,
          message: '이미 실행된 명령 (재전달 무시)',
          completedAt: new Date().toISOString(),
        });
        continue;
      }

      let ok = true;
      let message = '';
      let data: unknown;

      try {
        switch (cmd.type) {
          case 'full_sync':
            logger.info('🔄 원격 명령: 전체 동기화 시작');
            await this.engine.runFull('customers');
            await this.engine.runFull('purchases');
            logger.info('✅ 원격 명령: 전체 동기화 완료');
            message = '전체 동기화 완료';
            break;

          case 'restart':
            logger.info('🔄 원격 명령: Agent 재시작');
            // 예약작업(Windows)/systemd(Linux) 모델은 exit(0)로 자동 재시작되지 않는다
            //   (예약작업 exit 0=정상종료→RestartOnFailure 미발동 / systemd Restart=on-failure).
            //   restartAgent가 OS별로 실제 재기동을 트리거한다(별도 일회성 작업 / systemctl restart 위임).
            // ★ v1.6.1: 재시작하면 ACK를 보낼 기회가 없다 — 결과·멱등 마킹을 먼저 파일에 저장(동기 I/O)
            //   → 재기동 후 첫 heartbeat가 ACK 동봉.
            if (cmdId && this.stateManager) {
              this.stateManager.markCommandExecuted(cmdId);
              this.stateManager.addCommandResult({
                commandId: cmdId,
                type: cmd.type,
                ok: true,
                message: '재시작 트리거 — 재기동 후 첫 heartbeat로 보고',
                completedAt: new Date().toISOString(),
              });
            }
            restartAgent();
            continue; // 이후 공통 기록 생략 (프로세스 종료 예정)

          // ★ D131 후속(2026-04-21): 원격 pause/resume
          case 'pause':
            logger.info('⏸️  원격 명령: 동기화 일시정지');
            this.pause();
            message = '동기화 일시정지 완료 (heartbeat 유지)';
            break;

          case 'resume':
            logger.info('▶️  원격 명령: 동기화 재개');
            this.resume();
            message = '동기화 재개 완료';
            break;

          // ★ 2026-07-01: 원격 매핑 갱신 — 슈퍼관리자에서 매핑 변경 시 재설치 없이 즉시 반영
          case 'update_config': {
            const payload = ((cmd.payload ?? cmd.params) ?? {}) as UpdateConfigPayload;
            const mapping = payload.mapping;
            if (mapping && (mapping.customers || mapping.purchases || mapping.customFieldLabels)) {
              logger.info('🔧 원격 명령: 매핑 갱신(update_config)');
              // 1) 런타임 매핑 즉시 교체 (재시작 없이 다음 배치부터 적용)
              this.engine.updateMapping({ customers: mapping.customers, purchases: mapping.purchases });
              // 2) config.enc 영구 저장 + 필드정의 재등록 (index.ts 콜백)
              if (this.mappingUpdateHandler) {
                await this.mappingUpdateHandler(mapping);
              }
              // 3) 바뀐 타겟만 전체 재적재 (구매 수백만건 불필요 재적재 방지)
              if (mapping.customers) await this.engine.runFull('customers');
              if (mapping.purchases) await this.engine.runFull('purchases');
              logger.info('✅ 원격 명령: 매핑 갱신 + 전체 동기화 완료');
              message = `매핑 갱신 + 전체 재동기화 완료 (customers ${mapping.customers ? Object.keys(mapping.customers).length : '유지'} · purchases ${mapping.purchases ? Object.keys(mapping.purchases).length : '유지'})`;
            } else {
              logger.warn('update_config 명령에 mapping이 없어 무시');
              ok = false;
              message = 'mapping payload가 없어 적용하지 않았습니다.';
            }
            break;
          }

          // ★ v1.6.1 (P2-7): 최근 로그 업로드 — 원격 지원 없이 슈퍼관리자가 로그 열람
          case 'report_logs': {
            const payload = ((cmd.payload ?? cmd.params) ?? {}) as ReportLogsPayload;
            const result = readRecentLogLines(Number(payload.lines) || 200);
            data = result;
            message = result.file
              ? `${result.file} 최근 ${result.lines.length}줄`
              : '로그 파일이 없습니다.';
            ok = !!result.file;
            break;
          }

          // ★ v1.6.1 (P2-8): 소스 DB 연결 테스트
          case 'test_connection': {
            const result = await this.engine.testSource();
            data = result;
            ok = result.connected;
            message = result.connected
              ? `소스 DB 연결 정상 (고객 ${result.customerColumns ?? 0}컬럼${result.purchaseColumns !== undefined ? ` · 구매 ${result.purchaseColumns}컬럼` : ''})`
              : (result.error || '소스 DB 연결 실패');
            break;
          }

          // ★ v1.6.1 (P2-9): 매핑 dry-run — 소스 1행 적용 미리보기(저장·적용 없음)
          case 'mapping_dryrun': {
            const payload = ((cmd.payload ?? cmd.params) ?? {}) as MappingDryrunPayload;
            const mapping = payload.mapping || {};
            const previews: Record<string, unknown> = {};
            let anyOk = false;
            if (mapping.customers) {
              previews.customers = await this.engine.previewMapping('customers', mapping.customers);
              anyOk = anyOk || (previews.customers as { ok: boolean }).ok;
            }
            if (mapping.purchases) {
              previews.purchases = await this.engine.previewMapping('purchases', mapping.purchases);
              anyOk = anyOk || (previews.purchases as { ok: boolean }).ok;
            }
            if (!mapping.customers && !mapping.purchases) {
              ok = false;
              message = 'dry-run할 mapping payload가 없습니다.';
            } else {
              data = previews;
              ok = anyOk;
              message = anyOk ? '매핑 미리보기 완료 (저장·적용 없음)' : '매핑 미리보기 실패';
            }
            break;
          }

          default:
            logger.warn(`알 수 없는 원격 명령: ${cmd.type}`);
            ok = false;
            message = `미지원 명령 (에이전트 v${AGENT_VERSION})`;
        }
      } catch (error) {
        ok = false;
        message = error instanceof Error ? error.message : String(error);
        logger.error(`원격 명령 실행 실패: ${cmd.type}`, {
          commandId: cmd.id,
          error: message,
        });
      }

      // ★ v1.6.1: 멱등 마킹 + ACK 적재 (성공·실패 모두 1회 실행 확정 — 재시도는 새 명령으로)
      if (cmdId && this.stateManager) {
        this.stateManager.markCommandExecuted(cmdId);
        this.stateManager.addCommandResult({
          commandId: cmdId,
          type: cmd.type,
          ok,
          message: message || undefined,
          data,
          completedAt: new Date().toISOString(),
        });
        // ACK를 다음 정각까지 묵히지 않도록 즉시 1회 전송 시도(실패해도 다음 heartbeat가 재동봉)
        void this.heartbeat?.send();
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

  // ─── heartbeat 부스트 (v1.6.1 — P1-6) ──────────────────
  //
  // 서버가 heartbeat 응답에 boost 지시를 동봉하면(대기 명령·미수신 ACK 존재 시)
  // until까지 heartbeat를 짧은 주기로 추가 전송 — 명령·ACK 왕복 지연을 60분→분 단위로 단축.
  // 인바운드 포트가 없는 폴링 구조에서의 현실적 즉시성 수단. until 경과 시 자동 종료.

  private boostTask: cron.ScheduledTask | null = null;
  private boostUntil = 0;

  boostHeartbeat(intervalMinutes: number, until: string): void {
    const ts = Date.parse(until);
    if (!Number.isFinite(ts) || ts <= Date.now()) return;
    this.boostUntil = Math.max(this.boostUntil, ts);
    if (this.boostTask) return; // 이미 부스트 중 — until만 연장
    const iv = Math.max(1, Math.min(10, Math.floor(Number(intervalMinutes)) || 1));
    this.boostTask = cron.schedule(`*/${iv} * * * *`, async () => {
      if (Date.now() > this.boostUntil) {
        this.boostTask?.stop();
        this.boostTask = null;
        logger.info('heartbeat 부스트 종료 (기한 경과 — 정규 60분 주기 복귀)');
        return;
      }
      await this.heartbeat?.send();
    });
    logger.info(`heartbeat 부스트 시작: 매 ${iv}분 (${until}까지)`);
  }

  /**
   * 모든 스케줄 중지
   */
  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    // ★ v1.6.1: 부스트 task도 함께 정리 — 다음 heartbeat 응답이 필요 시 재지시
    if (this.boostTask) {
      this.boostTask.stop();
      this.boostTask = null;
    }
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
