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

  /** 동기화 완료 후 상태 업데이트
   *
   * ★ D142 (2026-04-28) PDF 0428 #9: 누적(+=) → 마지막 sync 카운트(=)로 변경.
   *   누적은 서버 sync_agents.total_customers_synced를 매 sync마다 N×1500 부풀게 만드는 사고 유발.
   *   Agent state는 "직전 sync에서 처리된 행수"만 추적. 실제 회사 총고객수는 서버가 SET 스냅샷 관리.
   */
  updateAfterSync(
    target: SyncTarget,
    syncedAt: string,
    count: number,
  ): void {
    if (target === 'customers') {
      this.state.lastCustomerSyncAt = syncedAt;
      this.state.totalCustomersSynced = count;
    } else {
      this.state.lastPurchaseSyncAt = syncedAt;
      this.state.totalPurchasesSynced = count;
    }
    this.save();
  }

  /** 전체 동기화 시각 기록 */
  updateFullSyncAt(syncedAt: string): void {
    this.state.lastFullSyncAt = syncedAt;
    this.save();
  }

  // ─── 키셋 커서 (★ 2026-08-03 커서 재설계) ─────────────
  //
  // 커서 = 마지막 처리 행의 (타임스탬프 원문, PK 값들). 완료 시각을 넣던 옛 구조가
  // 시각 없는 판매일 컬럼과 만나 하루치 유실을 만들었다(이새 실측 — 유실 98%).
  // 청크마다 저장한다 — 중간에 죽어도 마지막 성공 청크 다음부터 이어받는다(서버 멱등이 겹침 흡수).

  getCursor(target: SyncTarget): import('../types/sync').SyncCursorState | null {
    return this.state.cursors?.[target] ?? null;
  }

  setCursor(target: SyncTarget, cursor: import('../types/sync').SyncCursorState): void {
    if (!this.state.cursors) this.state.cursors = {};
    this.state.cursors[target] = cursor;
    this.save();
  }

  clearCursor(target: SyncTarget): void {
    if (this.state.cursors) {
      this.state.cursors[target] = null;
      this.save();
    }
  }

  /** 증분 보류 사유 — 있으면 증분을 건너뛴다(매 주기 전량 폭주 방지). 전량 동기화 시작이 지운다. */
  getIncrementalHold(target: SyncTarget): string | null {
    return this.state.incrementalHold?.[target] ?? null;
  }

  setIncrementalHold(target: SyncTarget, reason: string | null): void {
    if (!this.state.incrementalHold) this.state.incrementalHold = {};
    this.state.incrementalHold[target] = reason;
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

  // ─── 명령 멱등 + ACK 보류함 (v1.6.1 — P1-4·5) ─────────
  //
  // 서버 큐가 At-Least-Once로 재전달하므로, 실행한 command_id를 기억해 중복 실행을 차단하고
  // 실행 결과는 서버 전송 성공 전까지 파일에 보존한다(restart 명령·프로세스 재시작에도 ACK 유실 0).

  private static readonly EXECUTED_IDS_MAX = 50;
  private static readonly PENDING_RESULTS_MAX = 20;
  /** 결과 data 직렬화 상한 — heartbeat payload·state 파일 비대 차단 (서버 저장 가드와 별개의 송신 측 선제 가드) */
  private static readonly RESULT_DATA_MAX_CHARS = 256_000;

  /** 결과 data 용량 가드 — report_logs(lines 배열)는 앞(오래된) 줄부터 버리고, 그 외는 truncated 마커로 대체 */
  private capResultData(data: unknown): unknown {
    if (data === null || data === undefined) return data;
    const size = (v: unknown) => {
      try { return JSON.stringify(v)?.length ?? 0; } catch { return Number.MAX_SAFE_INTEGER; }
    };
    if (size(data) <= SyncStateManager.RESULT_DATA_MAX_CHARS) return data;
    if (typeof data === 'object' && Array.isArray((data as any).lines)) {
      const obj = { ...(data as Record<string, unknown>) };
      let lines = [...((data as any).lines as unknown[])];
      while (lines.length > 1 && size({ ...obj, lines }) > SyncStateManager.RESULT_DATA_MAX_CHARS) {
        lines = lines.slice(Math.max(1, Math.floor(lines.length / 4)));
      }
      return { ...obj, lines, truncated: true };
    }
    return { truncated: true, note: '결과가 커서 전송을 생략했습니다. 요청 크기를 줄여 다시 시도해주세요.' };
  }

  hasExecutedCommand(commandId: string): boolean {
    return (this.state.executedCommandIds || []).includes(commandId);
  }

  markCommandExecuted(commandId: string): void {
    const ids = (this.state.executedCommandIds || []).filter((id) => id !== commandId);
    ids.push(commandId);
    this.state.executedCommandIds = ids.slice(-SyncStateManager.EXECUTED_IDS_MAX);
    this.save();
  }

  /** 실행 결과 적재 — 같은 commandId 기존 항목은 교체. 초과분은 오래된 것부터 유실(상한 20). data는 선제 용량 가드. */
  addCommandResult(result: import('../types/api').AgentCommandResult): void {
    const rest = (this.state.pendingCommandResults || []).filter((r) => r.commandId !== result.commandId);
    rest.push({ ...result, data: this.capResultData(result.data) });
    this.state.pendingCommandResults = rest.slice(-SyncStateManager.PENDING_RESULTS_MAX);
    this.save();
  }

  /** 미전송 실행 결과 조회 (heartbeat 동봉용) */
  getPendingCommandResults(): import('../types/api').AgentCommandResult[] {
    return [...(this.state.pendingCommandResults || [])];
  }

  /** 서버 전송 성공분 제거 */
  removeCommandResults(commandIds: string[]): void {
    if (commandIds.length === 0) return;
    const idSet = new Set(commandIds);
    this.state.pendingCommandResults = (this.state.pendingCommandResults || []).filter(
      (r) => !idSet.has(r.commandId),
    );
    this.save();
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
      // ★ v1.6.1 (Codex 지적 정정): 원자 저장 — temp 쓰기 후 rename(교체).
      //   직접 덮어쓰기는 쓰는 도중 비정상 종료(정전·강제 종료) 시 파일 손상 = 마지막 동기화 시각·ACK 보류함 유실.
      const tmpFile = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (error) {
      logger.error('동기화 상태 파일 저장 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
