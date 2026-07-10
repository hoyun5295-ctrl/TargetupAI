/**
 * agent-protocol.ts — 싱크에이전트 원격 관리 프로토콜 순수 CT (2026-07-10 원격 관리 전수 점검 P1)
 *
 * 명령 큐 정책의 단일 진실. routes/sync.ts(heartbeat)·routes/admin-sync.ts(명령 등록/조회)가 소비한다.
 * 순수 함수(DB import 0) — vitest 대상.
 *
 * 정책 (SoT: docs/superpowers/specs/2026-07-10-sync-agent-remote-admin-audit.md §3 P1):
 *   - 에이전트 v1.6.1+ = At-Least-Once: 전달 시 큐 유지(delivered_at·attempts 스탬프),
 *     ACK(commandResults) 수신 시에만 큐에서 제거. 재전달 상한 초과분은 실패 기록 후 큐 제거(무한 재전송 차단).
 *   - 구버전(< 1.6.1, 이새 1.5.7) = 기존 At-Most-Once 유지: 전달 즉시 큐 비움(동작 불변 — 이새 비범위).
 *   - 실행 결과는 config.command_results에 최근 N건 보관(용량 가드 동반 — config jsonb 비대 차단).
 */

// ─── 버전 비교 ──────────────────────────────────────────

/** 'x.y.z'(v 접두·suffix 허용) >= target 비교. 파싱 불가한 버전 = false(보수적 — 구버전 취급). */
export function isAgentVersionGte(version: string | null | undefined, target: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = String(v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] || '0', 10)];
  };
  if (!version) return false;
  const a = parse(version);
  const b = parse(target);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] >= b[2];
}

/** ACK(At-Least-Once) 지원 최소 에이전트 버전 */
export const ACK_MIN_AGENT_VERSION = '1.6.1';

// ─── 타입 (sync_agents.config jsonb 내 구조) ────────────

export interface QueuedAgentCommand {
  id?: string;
  type?: string;
  created_at?: string;
  payload?: unknown;
  params?: unknown;
  /** ★ P1-5: 마지막 전달 시각 (At-Least-Once) */
  delivered_at?: string;
  /** ★ P1-5: 전달 횟수 — 상한 초과 시 만료 */
  attempts?: number;
}

export interface AgentCommandAck {
  commandId: string;
  type?: string;
  ok?: boolean;
  message?: string;
  data?: unknown;
  completedAt?: string;
}

export interface StoredCommandResult {
  commandId: string;
  type: string;
  ok: boolean;
  message?: string;
  data?: unknown;
  completedAt: string;
  /** 서버 기록 시각 */
  recordedAt: string;
}

// ─── 상수 ──────────────────────────────────────────────

/** 재전달 상한 — 초과 시 "에이전트 미적용" 실패로 만료 */
export const COMMAND_MAX_ATTEMPTS = 5;
/** config.command_results 보관 상한 */
export const COMMAND_RESULTS_MAX = 20;
/** 결과 data 직렬화 용량 상한 (config jsonb 비대 차단) */
export const RESULT_DATA_MAX_BYTES = 300_000;

// ─── 용량 가드 ──────────────────────────────────────────

/**
 * 결과 data 용량 가드 — report_logs(lines 배열)는 앞(오래된) 줄부터 버리고,
 * 그 외 형태는 초과 시 truncated 마커로 대체한다.
 */
export function capResultData(data: unknown): unknown {
  if (data === undefined || data === null) return data;
  const size = (v: unknown) => {
    try { return JSON.stringify(v)?.length ?? 0; } catch { return Number.MAX_SAFE_INTEGER; }
  };
  if (size(data) <= RESULT_DATA_MAX_BYTES) return data;
  if (typeof data === 'object' && data !== null && Array.isArray((data as any).lines)) {
    const obj = { ...(data as Record<string, unknown>) };
    let lines = [...((data as any).lines as unknown[])];
    while (lines.length > 1 && size({ ...obj, lines }) > RESULT_DATA_MAX_BYTES) {
      lines = lines.slice(Math.max(1, Math.floor(lines.length / 4))); // 앞 1/4씩 버림
    }
    return { ...obj, lines, truncated: true };
  }
  return { truncated: true, note: '결과가 커서 저장을 생략했습니다. 줄 수를 줄여 다시 요청해주세요.' };
}

// ─── ACK 반영 ──────────────────────────────────────────

/**
 * 에이전트 ACK 수신 반영 — 해당 명령을 큐에서 제거하고 결과를 기록한다.
 * 큐에 없는 commandId의 ACK(재전달 중복분·이미 만료분)도 결과가 없으면 기록(정보 보존).
 */
export function applyCommandAcks(
  queue: QueuedAgentCommand[],
  results: StoredCommandResult[],
  acks: AgentCommandAck[],
  nowIso: string,
): { queue: QueuedAgentCommand[]; results: StoredCommandResult[] } {
  const valid = (acks || []).filter((a) => a && typeof a.commandId === 'string' && a.commandId.length > 0);
  if (valid.length === 0) return { queue, results };
  const ackIds = new Set(valid.map((a) => a.commandId));
  const nextQueue = (queue || []).filter((c) => !c.id || !ackIds.has(c.id));
  let nextResults = [...(results || [])];
  for (const ack of valid) {
    const already = nextResults.some((r) => r.commandId === ack.commandId);
    // "재전달 무시" 재-ACK가 원 결과를 덮지 않도록 — 최초 결과 우선, 미기록건만 추가
    if (already) continue;
    nextResults.push({
      commandId: ack.commandId,
      type: String(ack.type || 'unknown'),
      ok: ack.ok !== false,
      message: typeof ack.message === 'string' ? ack.message : undefined,
      data: capResultData(ack.data),
      completedAt: typeof ack.completedAt === 'string' ? ack.completedAt : nowIso,
      recordedAt: nowIso,
    });
  }
  nextResults = nextResults.slice(-COMMAND_RESULTS_MAX);
  return { queue: nextQueue, results: nextResults };
}

// ─── 전달 처리 (At-Least-Once vs 구버전 At-Most-Once) ───

export interface DeliveryOutcome {
  /** 이번 heartbeat 응답에 실어 보낼 명령 */
  deliver: QueuedAgentCommand[];
  /** 처리 후 큐 (At-Least-Once=스탬프 갱신 유지 / 구버전=빈 배열) */
  queue: QueuedAgentCommand[];
  /** 만료 실패 기록이 추가된 결과 목록 */
  results: StoredCommandResult[];
  /** 만료 처리된 명령 수 */
  expiredCount: number;
}

export function markCommandsDelivered(
  queue: QueuedAgentCommand[],
  results: StoredCommandResult[],
  supportsAck: boolean,
  nowIso: string,
): DeliveryOutcome {
  const pending = queue || [];
  if (pending.length === 0) {
    return { deliver: [], queue: pending, results: results || [], expiredCount: 0 };
  }
  if (!supportsAck) {
    // 구버전(이새 1.5.7) — 기존 At-Most-Once 그대로(전달 즉시 큐 비움·결과 기록 없음)
    return { deliver: pending, queue: [], results: results || [], expiredCount: 0 };
  }
  const deliver: QueuedAgentCommand[] = [];
  const keep: QueuedAgentCommand[] = [];
  let nextResults = [...(results || [])];
  let expiredCount = 0;
  for (const cmd of pending) {
    const attempts = (Number(cmd.attempts) || 0) + 1;
    if (attempts > COMMAND_MAX_ATTEMPTS) {
      expiredCount += 1;
      nextResults.push({
        commandId: String(cmd.id || ''),
        type: String(cmd.type || 'unknown'),
        ok: false,
        message: `에이전트 실행 확인(ACK) 미수신 — ${COMMAND_MAX_ATTEMPTS}회 재전달 후 만료`,
        completedAt: nowIso,
        recordedAt: nowIso,
      });
      continue; // 큐에서 제거
    }
    const stamped = { ...cmd, attempts, delivered_at: nowIso };
    deliver.push(stamped);
    keep.push(stamped);
  }
  nextResults = nextResults.slice(-COMMAND_RESULTS_MAX);
  return { deliver, queue: keep, results: nextResults, expiredCount };
}
