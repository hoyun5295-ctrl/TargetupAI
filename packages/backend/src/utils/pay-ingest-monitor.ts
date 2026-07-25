/**
 * pay-ingest-monitor.ts — 통계 DB(pay-ingest-db) 침입 감시 + 적재 정체 감지 (★ 2026-07-25 신설)
 *
 * 신설 사유(Harold 승인 2026-07-25):
 *   `pay-ingest-db`가 `0.0.0.0:23388`로 게시돼 인터넷에서 TCP 접속이 된다(외부 `nc` 실측 succeeded).
 *   계정은 전부 호스트 제한이라(`mysql.user`에 `%` 0건, 원격 root 없음) 인증은 못 뚫지만
 *   인증 이전 단계는 열려 있다. 2026-02-28 MySQL 랜섬웨어와 같은 구조다.
 *
 *   방화벽으로 출처를 좁히는 건 별도 작업이고, 이 워커는 그 전후 모두에서 트립와이어로 남는다.
 *   막는 장치만 있고 알리는 장치가 없으면 뚫린 걸 아무도 모른다.
 *
 * ★ Harold 제약: **강문희 데이터 적재가 막히는 일이 있어선 안 된다.**
 *   그래서 이 워커는
 *     - 읽기 전용이다(상태 변수 조회 + COUNT 하나). 쓰기·잠금·DDL 없음.
 *     - 커넥션 풀을 새로 만들지 않고 pay-stats 기존 풀(connectionLimit 3)을 공유한다.
 *     - 실패해도 조용히 넘어간다. 감시가 죽어도 적재는 계속돼야 한다.
 *   나아가 **적재 정체 감지가 이 워커의 절반이다** — 방화벽을 잘못 걸어 push가 끊기면
 *   그 사실이 여기서 먼저 잡힌다.
 *
 * 상태는 메모리에 둔다(스키마 무변경). pm2 재기동 시 기준선을 다시 잡으며, 그 사이 한 주기를 건너뛴다.
 */

import { fetchPayDbSnapshot, isPayStatsConfigured, type PayDbSnapshot } from './pay-stats';
import { sendSystemAlert } from './system-alert';

const log = (...args: any[]) => console.log('[pay-ingest-monitor]', ...args);

/** 감시 주기 — 10분. 적재는 분 단위로 쏟아지지 않으므로 이 정도면 충분하고 DB 부담도 없다. */
const INTERVAL_MS = 10 * 60 * 1000;

/**
 * 인증 실패 급증 판정 임계.
 * 실측 기준선: 18.4일 동안 Aborted_connects 23건 ≈ 하루 1.25건.
 * 10분 창에서 20건이면 평소 16일치가 한 번에 온 것이라 스캔으로 본다.
 */
const ABORTED_SPIKE_THRESHOLD = Number(process.env.PAY_DB_ABORTED_SPIKE || 20);

/** 적재 정체 판정 — 오늘 행 수가 이 시간(분) 동안 하나도 안 늘면 push가 끊긴 것으로 본다. */
const INGEST_STALL_MIN = Number(process.env.PAY_INGEST_STALL_MIN || 120);

export interface MonitorState {
  abortedConnects: number;
  uptimeSec: number;
  todayRows: number;
  /** todayRows가 마지막으로 증가한 시각(ms) */
  lastIngestProgressAt: number;
  /** 마지막 관측 일자(YYYYMMDD) — 날짜가 바뀌면 오늘 행 수 기준선을 다시 잡는다 */
  observedDay: string;
}

export interface MonitorVerdict {
  /** 인증 실패 급증 — 스캔·무차별 대입 의심 */
  abortedSpike: { delta: number } | null;
  /** 적재 정체 — 강문희 push 중단 의심 */
  ingestStall: { stalledMin: number; todayRows: number } | null;
  /** DB 재시작 감지 — 누적 카운터 기준선 리셋 */
  dbRestarted: boolean;
  nextState: MonitorState;
}

function kstDay(nowMs: number): string {
  const d = new Date(nowMs + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * (순수) 이전 상태 + 이번 스냅샷 → 판정 + 다음 상태.
 * DB·시간·알림을 건드리지 않아 경계 조건을 테스트로 고정할 수 있다.
 */
export function evaluateSnapshot(
  prev: MonitorState | null,
  snap: PayDbSnapshot,
  nowMs: number,
  opts?: { abortedThreshold?: number; stallMin?: number },
): MonitorVerdict {
  const abortedThreshold = opts?.abortedThreshold ?? ABORTED_SPIKE_THRESHOLD;
  const stallMin = opts?.stallMin ?? INGEST_STALL_MIN;
  const today = kstDay(nowMs);

  // DB가 재시작되면 Aborted_connects·Connections가 0부터 다시 센다.
  // 그걸 모르고 델타를 재면 음수가 나오거나, 반대로 재시작 직후 증가를 놓친다.
  const dbRestarted = !!prev && snap.uptimeSec < prev.uptimeSec;

  // 첫 관측이거나 재시작 직후면 기준선만 잡고 판정하지 않는다(오탐 차단).
  if (!prev || dbRestarted) {
    return {
      abortedSpike: null,
      ingestStall: null,
      dbRestarted,
      nextState: {
        abortedConnects: snap.abortedConnects,
        uptimeSec: snap.uptimeSec,
        todayRows: snap.todayRows,
        lastIngestProgressAt: nowMs,
        observedDay: today,
      },
    };
  }

  const delta = snap.abortedConnects - prev.abortedConnects;
  const abortedSpike = delta >= abortedThreshold ? { delta } : null;

  // 날짜가 바뀌면 오늘 행 수는 0부터 다시 센다 → 정체 판정을 리셋한다.
  const dayRolled = today !== prev.observedDay;
  const progressed = dayRolled || snap.todayRows > prev.todayRows;
  const lastProgressAt = progressed ? nowMs : prev.lastIngestProgressAt;

  const stalledMin = Math.floor((nowMs - lastProgressAt) / 60000);
  const ingestStall = !progressed && stalledMin >= stallMin
    ? { stalledMin, todayRows: snap.todayRows }
    : null;

  return {
    abortedSpike,
    ingestStall,
    dbRestarted: false,
    nextState: {
      abortedConnects: snap.abortedConnects,
      uptimeSec: snap.uptimeSec,
      todayRows: snap.todayRows,
      lastIngestProgressAt: lastProgressAt,
      observedDay: today,
    },
  };
}

let state: MonitorState | null = null;

/** 한 주기 실행 — 실패는 삼킨다(감시가 죽어도 적재는 계속돼야 한다). */
export async function runPayIngestMonitorOnce(nowMs: number = Date.now()): Promise<MonitorVerdict | null> {
  if (!isPayStatsConfigured()) return null;

  let snap: PayDbSnapshot | null;
  try {
    snap = await fetchPayDbSnapshot();
  } catch (err: any) {
    // 조회 실패 자체가 신호다 — 방화벽 오설정으로 우리 서버조차 못 붙는 경우가 여기 걸린다.
    log('스냅샷 조회 실패:', err?.message || err);
    await sendSystemAlert({
      dedupKey: 'pay-db:unreachable',
      message: `통계DB(pay-ingest-db) 조회 실패 — 방화벽/네트워크 확인 필요. (${err?.message || err})`,
    }).catch(() => {});
    return null;
  }
  if (!snap) return null;

  const verdict = evaluateSnapshot(state, snap, nowMs);
  state = verdict.nextState;

  if (verdict.dbRestarted) {
    log(`DB 재시작 감지 — 기준선 재설정 (uptime=${snap.uptimeSec}s)`);
  }

  if (verdict.abortedSpike) {
    const { delta } = verdict.abortedSpike;
    log(`인증 실패 급증 delta=${delta} (누적 ${snap.abortedConnects})`);
    await sendSystemAlert({
      dedupKey: 'pay-db:aborted-spike',
      message: `통계DB 인증 실패 급증 — 10분간 ${delta}건(누적 ${snap.abortedConnects}). 23388 포트 외부 노출 상태이므로 스캔 가능성. 방화벽 출처 제한 확인 필요.`,
      cooldownMs: 60 * 60 * 1000,
    }).catch(() => {});
  }

  if (verdict.ingestStall) {
    const { stalledMin, todayRows } = verdict.ingestStall;
    log(`적재 정체 ${stalledMin}분 (오늘 ${todayRows}행)`);
    await sendSystemAlert({
      dedupKey: 'pay-db:ingest-stall',
      message: `통계DB 적재 정체 — ${stalledMin}분간 신규 행 0 (오늘 ${todayRows}행, 최근일자 ${snap.latestDestDt || '없음'}). 게이트웨이 push 중단 또는 방화벽 차단 확인 필요.`,
      cooldownMs: 3 * 60 * 60 * 1000,
    }).catch(() => {});
  }

  return verdict;
}

export function startPayIngestMonitor(): void {
  if (!isPayStatsConfigured()) {
    log('PAY_STATS 미설정 — 감시 미가동');
    return;
  }
  log(`감시 시작 — ${INTERVAL_MS / 60000}분 주기 (인증실패 급증 ${ABORTED_SPIKE_THRESHOLD}건/주기, 적재 정체 ${INGEST_STALL_MIN}분)`);
  setInterval(() => {
    void runPayIngestMonitorOnce().catch((e) => log('주기 실행 오류:', e?.message || e));
  }, INTERVAL_MS);
}

/** 테스트 전용 — 모듈 상태 초기화 */
export function __resetMonitorStateForTest(): void {
  state = null;
}
