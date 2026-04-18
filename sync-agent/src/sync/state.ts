/**
 * 동기화 상태 관리 (로컬 파일)
 * 마지막 동기화 시각 등을 JSON 파일에 저장/로드
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SyncState, SyncTarget } from '../types/sync';
import { DEFAULT_SYNC_STATE } from '../types/sync';
import { getLogger } from '../logger';

const logger = getLogger('sync:state');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'sync_state.json');

export class SyncStateManager {
  private state: SyncState;

  constructor() {
    this.state = this.load();
  }

  /** 현재 상태 반환 */
  getState(): Readonly<SyncState> {
    return { ...this.state };
  }

  /** 특정 대상의 마지막 동기화 시각 */
  getLastSyncAt(target: SyncTarget): string | null {
    return target === 'customers'
      ? this.state.lastCustomerSyncAt
      : this.state.lastPurchaseSyncAt;
  }

  /** 동기화 완료 후 상태 업데이트 */
  updateAfterSync(
    target: SyncTarget,
    syncedAt: string,
    count: number,
  ): void {
    if (target === 'customers') {
      this.state.lastCustomerSyncAt = syncedAt;
      this.state.totalCustomersSynced += count;
    } else {
      this.state.lastPurchaseSyncAt = syncedAt;
      this.state.totalPurchasesSynced += count;
    }
    this.save();
  }

  /** 전체 동기화 시각 기록 */
  updateFullSyncAt(syncedAt: string): void {
    this.state.lastFullSyncAt = syncedAt;
    this.save();
  }

  /** Agent ID 설정 (서버 등록 후) */
  setAgentId(agentId: string): void {
    this.state.agentId = agentId;
    this.save();
  }

  /** 상태 초기화 (전체 재동기화 시) */
  reset(): void {
    this.state = { ...DEFAULT_SYNC_STATE, agentId: this.state.agentId };
    this.save();
    logger.info('동기화 상태 초기화됨');
  }

  /** 커스텀 필드 정의 등록 완료 플래그 (v1.4.0) */
  setFieldDefinitionsRegistered(registered: boolean): void {
    this.state.fieldDefinitionsRegistered = registered;
    this.save();
  }

  /** 커스텀 필드 정의 등록 완료 여부 (v1.4.0) */
  isFieldDefinitionsRegistered(): boolean {
    return this.state.fieldDefinitionsRegistered;
  }

  // ─── 파일 I/O ─────────────────────────────────────────

  private load(): SyncState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const content = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(content);
        logger.debug('동기화 상태 로드됨', parsed);
        return { ...DEFAULT_SYNC_STATE, ...parsed };
      }
    } catch (error) {
      logger.warn('동기화 상태 파일 로드 실패, 기본값 사용', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { ...DEFAULT_SYNC_STATE };
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      logger.error('동기화 상태 파일 저장 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
