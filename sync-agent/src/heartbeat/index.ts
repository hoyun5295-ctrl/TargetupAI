/**
 * Heartbeat 모듈
 * 5분 주기로 Agent 상태를 서버에 보고
 * + 버전 확인 → 자동 업데이트 실행 (Phase 5 완료)
 * + 오프라인 알림 연동 (Phase 5 추가)
 */

import os from 'node:os';
import type { ApiClient } from '../api/client';
import type { SyncStateManager } from '../sync/state';
import type { QueueManager } from '../queue';
import type { AgentConfig } from '../config';
import type { AlertManager } from '../alert';
import type { AgentCommand, AgentSelfReport } from '../types/api';
import { UpdateManager } from '../updater';
import { getLogger } from '../logger';
import { AGENT_VERSION } from '../version';

const logger = getLogger('heartbeat');

export class HeartbeatManager {
  private apiClient: ApiClient;
  private stateManager: SyncStateManager;
  private queueManager: QueueManager;
  private config: AgentConfig;
  private startTime: number;
  private updateManager: UpdateManager;
  private alertManager: AlertManager | null;
  // ★ D131 후속(2026-04-21): 원격 pause 상태 반영 — send() 시 status='paused' 전송
  private paused = false;
  // ★ D131 후속(2026-04-21): heartbeat 응답으로 받은 commands를 scheduler로 전달하는 콜백.
  //   index.ts에서 scheduler.applyRemoteConfig로 연결.
  //   기존엔 싱크 응답(customers/purchases)에서만 commands 받았는데 0건이면 요청 자체 안 감 → 명령 누락.
  //   heartbeat 경로 추가로 안정적 전달 보장.
  private commandHandler: ((commands: AgentCommand[]) => void) | null = null;
  // ★ v1.6.1 (P0-1): 자기 보고 provider — index.ts에서 engine 매핑+소스 컬럼 캐시 연결.
  //   실패/미연결 시 undefined 동봉(heartbeat 자체는 계속).
  private reportProvider: (() => Promise<AgentSelfReport | null>) | null = null;
  // ★ v1.6.1 (P1-6): boost 지시 처리 — index.ts에서 scheduler.boostHeartbeat 연결.
  private boostHandler: ((intervalMinutes: number, until: string) => void) | null = null;
  // ★ v1.6.1: 동시 전송 가드 — 정각 cron·부스트 cron·명령 직후 즉시 전송이 겹칠 수 있다.
  private sending = false;

  constructor(
    apiClient: ApiClient,
    stateManager: SyncStateManager,
    queueManager: QueueManager,
    config: AgentConfig,
    alertManager?: AlertManager,
  ) {
    this.apiClient = apiClient;
    this.stateManager = stateManager;
    this.queueManager = queueManager;
    this.config = config;
    this.startTime = Date.now();
    this.alertManager = alertManager || null;

    // 자동 업데이트 매니저 초기화
    // ★ 2026-06-11: config 저장값이 아닌 실행 파일 버전 기준 — 구버전 config 보존 시 오판 차단
    this.updateManager = new UpdateManager(
      apiClient,
      AGENT_VERSION,
    );
  }

  // ★ D131 후속(2026-04-21): Scheduler의 pause/resume에서 호출 → send() 시점에 status 반영
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // ★ D131 후속(2026-04-21): scheduler와 연결할 명령 처리 콜백 등록 (index.ts에서 호출)
  setCommandHandler(handler: (commands: AgentCommand[]) => void): void {
    this.commandHandler = handler;
  }

  // ★ v1.6.1: 자기 보고 provider 등록 (index.ts에서 호출)
  setReportProvider(provider: () => Promise<AgentSelfReport | null>): void {
    this.reportProvider = provider;
  }

  // ★ v1.6.1: boost 지시 콜백 등록 (index.ts에서 scheduler.boostHeartbeat 연결)
  setBoostHandler(handler: (intervalMinutes: number, until: string) => void): void {
    this.boostHandler = handler;
  }

  /**
   * Heartbeat 1회 전송
   */
  async send(): Promise<void> {
    // ★ v1.6.1: 정각 cron·부스트 cron·명령 직후 즉시 전송 중복 가드
    if (this.sending) {
      logger.debug('Heartbeat 이미 전송 중 — 스킵');
      return;
    }
    this.sending = true;
    try {
      await this.sendOnce();
    } finally {
      this.sending = false;
    }
  }

  private async sendOnce(): Promise<void> {
    const state = this.stateManager.getState();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    // ★ v1.6.1 (P0-1): 자기 보고 — 실패해도 heartbeat는 계속
    let reported: AgentSelfReport | undefined;
    try {
      reported = (await this.reportProvider?.()) ?? undefined;
    } catch (error) {
      logger.debug('자기 보고 생성 실패 — 이번 heartbeat 생략', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ★ v1.6.1 (P1-4): 미전송 명령 실행 결과(ACK) 동봉
    const commandResults = this.stateManager.getPendingCommandResults();

    try {
      const response = await this.apiClient.heartbeat({
        agentId: state.agentId || '',
        agentVersion: AGENT_VERSION,
        // ★ D131 후속: paused 상태면 'paused' 보고, 아니면 'active'
        status: this.paused ? 'paused' : 'active',
        osInfo: `${os.platform()} ${os.release()}`,
        dbType: this.config.database.type,
        lastSyncAt: state.lastCustomerSyncAt || state.lastPurchaseSyncAt || null,
        totalCustomersSynced: state.totalCustomersSynced,
        queuedItems: this.queueManager.getCount(),
        uptime,
        reported,
        commandResults: commandResults.length > 0 ? commandResults : undefined,
      });

      // Heartbeat 성공 → 알림 모듈에 보고
      this.alertManager?.onHeartbeatResult(true);

      if (response) {
        logger.debug('Heartbeat 전송 성공', { uptime: `${uptime}s` });

        // ★ v1.6.1: 전송 성공한 ACK는 보류함에서 제거(서버가 기록·큐 정리 완료)
        if (commandResults.length > 0) {
          this.stateManager.removeCommandResults(commandResults.map((r) => r.commandId));
        }

        // ★ D131 후속(2026-04-21): 서버 원격 명령을 scheduler로 전달하여 실제 실행.
        //   기존엔 로그만 찍고 TODO로 방치 → pause/resume이 실행되지 않던 버그.
        const commands = response.remoteConfig?.commands;
        if (Array.isArray(commands) && commands.length > 0) {
          for (const cmd of commands) {
            logger.info(`📡 원격 명령 수신 (heartbeat): ${cmd.type}`, { commandId: cmd.id });
          }
          if (this.commandHandler) {
            this.commandHandler(commands);
          } else {
            logger.warn('commandHandler 미등록 — 명령 실행 불가 (index.ts 연결 확인)');
          }
        }

        // ★ v1.6.1 (P1-6): boost 지시 — 명령·ACK 왕복 동안 heartbeat 임시 단축
        const boost = response.remoteConfig?.boost;
        if (boost?.until && this.boostHandler) {
          this.boostHandler(boost.heartbeatIntervalMinutes ?? 1, boost.until);
        }

        // Heartbeat 응답에 강제 업데이트 플래그가 있으면 즉시 처리
        if (response.forceUpdate && response.latestVersion) {
          logger.warn(`Heartbeat 응답 강제 업데이트: v${response.latestVersion}`);
          await this.updateManager.execute({
            latestVersion: response.latestVersion,
            downloadUrl: response.downloadUrl,
            forceUpdate: true,
            updateAvailable: true,
          });
        }
      }
    } catch (error) {
      // Heartbeat 실패 → 알림 모듈에 보고
      this.alertManager?.onHeartbeatResult(false);

      logger.warn('Heartbeat 전송 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Heartbeat 성공 여부와 무관하게 버전 확인
    await this.checkForUpdates();
  }

  // ─── 자동 업데이트 확인 ────────────────────────────────

  private async checkForUpdates(): Promise<void> {
    const state = this.stateManager.getState();
    if (!state.agentId) return;

    try {
      const versionInfo = await this.apiClient.checkVersion(
        AGENT_VERSION,
        state.agentId,
      );
      if (!versionInfo) return;

      if (versionInfo.updateAvailable || versionInfo.forceUpdate) {
        logger.info('🔔 새 버전 발견', {
          current: versionInfo.currentVersion,
          latest: versionInfo.latestVersion,
          force: versionInfo.forceUpdate,
        });

        // 자동 다운로드 → 교체 → 재시작
        const started = await this.updateManager.execute(versionInfo);
        if (!started) {
          logger.debug('업데이트 스킵 (이미 진행 중이거나 동일 버전)');
        }
      }
    } catch (error) {
      logger.debug('버전 확인 실패 (무시)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
