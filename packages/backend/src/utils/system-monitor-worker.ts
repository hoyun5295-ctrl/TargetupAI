/**
 * system-monitor-worker.ts — 시스템 크리티컬 감지 워커 (2026-06-13, 5분 주기)
 *
 * 감지 2종 (둘 다 system-alert CT로 운영자 문자 통지):
 *
 * 1) 발송 큐 지연 잔존 행
 *    배경 — 톤28 6/11(19:46 등록분 일부가 6/12 10:32~17:07 실발송)·시세이도(예약 +24h 처리)·
 *    에이치피오(취소 후 살아 있던 큐) 실측: 큐에 적재된 일부 행이 제때 처리되지 않고
 *    수 시간~하루 뒤 실발송되는 일이 에이전트 단에서 발생한다. 한줄로 측 안전망으로
 *    "발송 요청 시각이 60분 이상 지났는데 status_code=100(대기)로 남은 행"을 감지한다.
 *    - 대량 발송이 정상적으로 천천히 빠지는 중(드레인)일 수 있어, 직전 스냅샷(12분+ 전)보다
 *      대기 수가 줄지 않은 캠페인만 "정체"로 판정한다.
 *    - 자동 회수/삭제는 하지 않는다 — 감지·통지만 (회수 정책은 별도 결정).
 *
 * 2) 싱크에이전트 중단
 *    배경 — 인비토 동기화가 6/13 06:00(KST) 이후 기록 없이 멈춤(고객사 PC/에이전트 측).
 *    - AGENT_DOWN: 하트비트가 60분 이상 끊김 (PC 종료/에이전트 중지)
 *    - SYNC_STALLED: 하트비트는 살아 있는데 마지막 동기화가 주기의 3배(최소 3시간) 초과
 *    - 7일 이상 하트비트가 없는 에이전트는 방치/폐기로 보고 반복 통지하지 않는다.
 *
 * 패턴 기준: utils/cancelled-queue-sweeper.ts setInterval + 중복 진입 방지 플래그 미러.
 */

import { query, mysqlQuery } from '../config/database';
import { getAllBulkSmsTables } from './sms-queue';
import { sendSystemAlert } from './system-alert';

const PASS_INTERVAL_MS = 5 * 60 * 1000;        // 5분 주기
const FIRST_DELAY_MS = 60 * 1000;              // 기동 60초 후 첫 실행
const QUEUE_DELAY_MIN = 60;                    // 요청 시각 경과 임계(분)
const SNAPSHOT_MIN_AGE_MS = 12 * 60 * 1000;    // 정체 판정용 직전 스냅샷 최소 간격
const AGENT_HEARTBEAT_STALE_MS = 60 * 60 * 1000;        // 하트비트 60분 끊김 = 중단 의심
const AGENT_ABANDONED_MS = 7 * 24 * 60 * 60 * 1000;     // 7일+ 무신호 = 방치(통지 제외)
const SYNC_STALL_MIN_MS = 3 * 60 * 60 * 1000;           // 동기화 정체 최소 임계 3시간

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QueueSnapshot { cnt: number; ts: number; }
// app_etc1(캠페인 키) → 직전 관측 (정체 판정용 — 프로세스 메모리)
const queueSnapshots = new Map<string, QueueSnapshot>();

function log(...args: any[]) {
  console.log('[system-monitor]', ...args);
}

/** 1) 발송 큐 지연 잔존 행 감지 */
async function checkDelayedQueueRows(): Promise<void> {
  const tables = await getAllBulkSmsTables();
  if (tables.length === 0) return;

  // 캠페인 키별 합산 (여러 라인 테이블에 분산 적재될 수 있음)
  const byKey = new Map<string, { cnt: number; oldestMin: number }>();
  for (const t of tables) {
    try {
      const rows = (await mysqlQuery(
        `SELECT app_etc1, COUNT(*) AS cnt,
                TIMESTAMPDIFF(MINUTE, MIN(sendreq_time), NOW()) AS oldest_min
           FROM ${t}
          WHERE status_code = 100
            AND sendreq_time < NOW() - INTERVAL ${QUEUE_DELAY_MIN} MINUTE
          GROUP BY app_etc1`,
      )) as any[];
      for (const r of rows) {
        const key = String(r.app_etc1 || '(미상)');
        const prev = byKey.get(key) || { cnt: 0, oldestMin: 0 };
        byKey.set(key, {
          cnt: prev.cnt + Number(r.cnt || 0),
          oldestMin: Math.max(prev.oldestMin, Number(r.oldest_min || 0)),
        });
      }
    } catch (err: any) {
      // 테이블 1개 오류가 전체 패스를 막지 않게 (월별 테이블 부재 등)
      console.error(`[system-monitor] ${t} 지연 스캔 오류:`, err?.message || err);
    }
  }

  const now = Date.now();

  // 정체 판정 — 직전 스냅샷(12분+ 전)보다 대기 수가 줄지 않은 캠페인만
  const stalled: Array<{ key: string; cnt: number; oldestMin: number }> = [];
  for (const [key, cur] of byKey) {
    const prev = queueSnapshots.get(key);
    if (prev && now - prev.ts >= SNAPSHOT_MIN_AGE_MS && cur.cnt >= prev.cnt) {
      stalled.push({ key, cnt: cur.cnt, oldestMin: cur.oldestMin });
    }
    // 스냅샷 갱신은 "충분히 오래된 직전 값"을 보존해야 해서, 최소 간격이 지난 경우에만 교체
    if (!prev || now - prev.ts >= SNAPSHOT_MIN_AGE_MS) {
      queueSnapshots.set(key, { cnt: cur.cnt, ts: now });
    }
  }
  // 큐에서 사라진 키 스냅샷 정리
  for (const key of [...queueSnapshots.keys()]) {
    if (!byKey.has(key)) queueSnapshots.delete(key);
  }

  if (stalled.length === 0) return;

  // 캠페인명/회사명 해석 (uuid 키만 PG 조회)
  const ids = stalled.map((s) => s.key).filter((k) => UUID_RE.test(k));
  const nameMap = new Map<string, string>();
  if (ids.length > 0) {
    try {
      const res = await query(
        `SELECT c.id::text AS id, co.company_name, c.campaign_name
           FROM campaigns c JOIN companies co ON co.id = c.company_id
          WHERE c.id = ANY($1::uuid[])`,
        [ids],
      );
      for (const r of res.rows) nameMap.set(r.id, `${r.company_name} ${r.campaign_name}`);
      // campaigns에 없으면 campaign_runs(run_id 적재 경로) 역추적
      const missing = ids.filter((id) => !nameMap.has(id));
      if (missing.length > 0) {
        const runRes = await query(
          `SELECT r.id::text AS id, co.company_name, c.campaign_name
             FROM campaign_runs r
             JOIN campaigns c ON c.id = r.campaign_id
             JOIN companies co ON co.id = c.company_id
            WHERE r.id = ANY($1::uuid[])`,
          [missing],
        );
        for (const r of runRes.rows) nameMap.set(r.id, `${r.company_name} ${r.campaign_name}`);
      }
    } catch (err: any) {
      console.error('[system-monitor] 캠페인명 조회 오류:', err?.message || err);
    }
  }

  const totalRows = stalled.reduce((a, s) => a + s.cnt, 0);
  const maxOldest = Math.max(...stalled.map((s) => s.oldestMin));
  const top = stalled
    .sort((a, b) => b.cnt - a.cnt)
    .slice(0, 3)
    .map((s) => `${nameMap.get(s.key) || s.key.slice(0, 8)} ${s.cnt}행`)
    .join(' / ');
  const more = stalled.length > 3 ? ` 외 ${stalled.length - 3}건` : '';

  // 야간(21시~) 진입 위험 강조 — KST 20시 이후면 경고 줄 추가
  const kstHour = new Date(now + 9 * 60 * 60 * 1000).getUTCHours();
  const nightLine = kstHour >= 20 || kstHour < 8 ? ' 야간 발송 시간대 위험.' : '';

  const dedupKey = 'queue-delay:' + stalled.map((s) => s.key).sort().join(',');
  await sendSystemAlert({
    dedupKey,
    message:
      `발송 큐 지연 정체 — 캠페인 ${stalled.length}건, 대기 ${totalRows.toLocaleString()}행이 ` +
      `요청 시각을 ${QUEUE_DELAY_MIN}분 이상 지나 남아 있습니다(최장 ${maxOldest}분). ${top}${more}.${nightLine}`,
  });
  log(`지연 정체 통지 — 캠페인 ${stalled.length}건 / 대기 ${totalRows}행 / 최장 ${maxOldest}분`);
}

/** 2) 싱크에이전트 중단 감지 */
async function checkSyncAgents(): Promise<void> {
  let rows: any[] = [];
  try {
    const res = await query(
      `SELECT sa.*, c.company_name
         FROM sync_agents sa
         LEFT JOIN companies c ON c.id = sa.company_id`,
    );
    rows = res.rows;
  } catch (err: any) {
    console.error('[system-monitor] sync_agents 조회 오류:', err?.message || err);
    return;
  }

  const now = Date.now();
  for (const a of rows) {
    const hb = a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : 0;
    if (!hb) continue;                              // 등록만 되고 연결 이력 없음
    if (now - hb > AGENT_ABANDONED_MS) continue;    // 7일+ 방치 — 반복 통지 제외
    const label = `${a.company_name || '(회사 미상)'} ${a.agent_name || ''}`.trim();

    if (now - hb > AGENT_HEARTBEAT_STALE_MS) {
      const min = Math.floor((now - hb) / 60000);
      await sendSystemAlert({
        dedupKey: `agent-down:${a.id}`,
        cooldownMs: 12 * 60 * 60 * 1000,
        message: `싱크에이전트 중단 의심 — ${label}: 마지막 하트비트 ${min}분 전. 고객사 PC/에이전트 확인 필요.`,
      });
      continue;
    }

    const ls = a.last_sync_at ? new Date(a.last_sync_at).getTime() : 0;
    if (!ls) continue;
    const intervalMin = Number(a.sync_interval_customers) > 0 ? Number(a.sync_interval_customers) : 60;
    const stallMs = Math.max(3 * intervalMin * 60 * 1000, SYNC_STALL_MIN_MS);
    if (now - ls > stallMs) {
      const hours = Math.floor((now - ls) / 3600000);
      await sendSystemAlert({
        dedupKey: `sync-stalled:${a.id}`,
        cooldownMs: 12 * 60 * 60 * 1000,
        message: `싱크에이전트 동기화 정체 — ${label}: 하트비트는 정상인데 마지막 동기화가 ${hours}시간 전입니다.`,
      });
    }
  }
}

let running = false;

async function runPass(): Promise<void> {
  await checkDelayedQueueRows();
  await checkSyncAgents();
}

export function startSystemMonitorWorker(): void {
  setTimeout(() => {
    runPass().catch((e: any) => console.error('[system-monitor] 첫 패스 오류:', e?.message));
  }, FIRST_DELAY_MS);

  setInterval(() => {
    if (running) return;
    running = true;
    runPass()
      .catch((e: any) => console.error('[system-monitor] 패스 오류:', e?.message))
      .finally(() => { running = false; });
  }, PASS_INTERVAL_MS);

  log('시작 — 5분 주기 (발송 큐 지연 정체 + 싱크에이전트 중단 감지, SYSTEM_ALERT_PHONES 문자 통지)');
}
