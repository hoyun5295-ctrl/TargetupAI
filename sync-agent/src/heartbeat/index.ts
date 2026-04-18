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
import { UpdateManager } from '../updater';
import { getLogger } from '../logger';

const logger = getLogger('heartbeat');

export class HeartbeatManager {
  private apiClient: ApiClient;
  private stateManager: SyncStateManager;
  private queueManager: QueueManager;
  private config: AgentConfig;
  private startTime: number;
  private updateManager: UpdateManager;
  private alertManager: AlertManager | null;

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
    this.updateManager = new UpdateManager(
      apiClient,
      config.agent.version,
    );
  }

  /**
   * Heartbeat 1회 전송
   */
  async send(): Promise<void> {
    const state = this.stateManager.getState();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    try {
      const response = await this.apiClient.heartbeat({
        agentId: state.agentId || '',
        agentVersion: this.config.agent.version,
        status: 'active',
        osInfo: `${os.platform()} ${os.release()}`,
        dbType: this.config.database.type,
        lastSyncAt: state.lastCustomerSyncAt || state.lastPurchaseSyncAt || null,
        totalCustomersSynced: state.totalCustomersSynced,
        queuedItems: this.queueManager.getCount(),
        uptime,
      });

      // Heartbeat 성공 → 알림 모듈에 보고
      this.alertManager?.onHeartbeatResult(true);

      if (response) {
        logger.debug('Heartbeat 전송 성공', { uptime: `${uptime}s` });

        // 서버에서 원격 명령이 있으면 처리
        if (response.remoteConfig?.commands) {
          for (const cmd of response.remoteConfig.commands) {
            logger.info(`원격 명령 수신: ${cmd.type}`, { payload: cmd.payload });
            // TODO: 명령 처리 (full_sync, restart 등)
          }
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
        this.config.agent.version,
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
