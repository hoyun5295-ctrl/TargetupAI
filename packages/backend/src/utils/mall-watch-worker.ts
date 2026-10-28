/**
 * 자사몰 연동 감시 2단 — 경보 워커(★ 2026-10-28 자사몰 대비 K10 2단 · D14 · M31 · M35 · SC2)
 *
 * 1단 표(mall-integration-monitor · 슈퍼관리자 화면)와 같은 행을 1시간마다 읽어 사람에게 닿아야 할 것만 경보한다(sendSystemAlert · 중복 차단 · 쿨다운).
 *   1. 사람 조치(action · 키 거절 · 권한 · IP 미등록(고도몰 996 · M35) · 토큰 거절 · 주소) — 원인 = integrationProblemOf 한 곳
 *   2. 평소보다 긴 침묵 — 그 몰의 지난 30일 전달 중 가장 긴 간격보다 지금 침묵이 길다(그 몰의 실측에서 뽑음 · 30일 5건 이상 몰만 · 전역 배수 0)
 *   3. 모르는 주문 상태 글자(최근 7일) — 결제됐는데 구매 0 으로 조용히 빠지는 몰 고유 상태(SC2 · F7)
 * 토큰 갱신 거절 · 연속 실패는 토큰 유지 워커가 · 카페24 API 버전 거절(M36)은 API 호출 CT 가 그 자리에서 경보한다.
 */
import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';
import { loadMallIntegrationMonitor, type MallMonitorRow } from './mall-integration-monitor';

const INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 3600_000;
const LABEL: Record<string, string> = { cafe24: '카페24', imweb: '아임웹', godo: '고도몰', woocommerce: '우커머스', custom: '자체 호스팅', makeshop: '메이크샵', naver_smart_store: '네이버' };
const CAUSE_LABEL: Record<string, string> = {
  key_rejected: '몰이 연결 키를 거절', permission: '키 권한 부족', ip_not_allowed: '몰 쪽 서버 출발 IP 미등록',
  address: '몰 주소에 닿지 않음', header_overflow: '몰 응답 헤더 과다', token_rejected: '연결 승인(토큰) 거절',
  app_removed: '몰에서 앱 삭제', grace_over: '토큰 유예 끝',
};

/** 몰마다 지난 30일 전달 사이 가장 긴 간격(초) — 1단 표와 같은 몰 열쇠(우커머스 = 몰 · 그 밖 = provider) */
async function longestGaps(companyIds: string[]): Promise<Map<string, number>> {
  const r = await query(
    `SELECT company_id, source, mall, MAX(gap) AS max_gap FROM (
       SELECT company_id, source,
              CASE WHEN source = 'woocommerce' THEN split_part(webhook_event, ':', 1) ELSE '' END AS mall,
              EXTRACT(EPOCH FROM created_at - LAG(created_at) OVER (
                PARTITION BY company_id, source, CASE WHEN source = 'woocommerce' THEN split_part(webhook_event, ':', 1) ELSE '' END
                ORDER BY created_at)) AS gap
         FROM cdp_webhook_deliveries
        WHERE company_id = ANY($1::uuid[]) AND webhook_event <> 'oauth_state' AND created_at > NOW() - INTERVAL '30 days'
     ) g GROUP BY 1, 2, 3`,
    [companyIds],
  );
  const m = new Map<string, number>();
  for (const row of r.rows as any[]) if (row.max_gap != null) m.set(`${row.company_id}|${row.source}|${row.mall || ''}`, Number(row.max_gap));
  return m;
}

/** 침묵 판정(순수) — 30일 5건 이상 · 지금 침묵 > 그 몰의 30일 최장 간격 */
export function isUnusualSilence(row: Pick<MallMonitorRow, 'received30d' | 'lastReceivedAt'>, longestGapSec: number | undefined, nowMs: number): boolean {
  if (row.received30d < 5 || !row.lastReceivedAt || longestGapSec == null) return false;
  return (nowMs - Date.parse(row.lastReceivedAt)) / 1000 > longestGapSec;
}

export async function runMallWatchPass(nowMs: number = Date.now()): Promise<number> {
  const rows = await loadMallIntegrationMonitor(nowMs);
  if (rows.length === 0) return 0;
  const gaps = await longestGaps(Array.from(new Set(rows.map((r) => r.companyId))));
  let sent = 0;
  for (const r of rows) {
    const where = [`고객사: ${r.companyName}`, `몰: ${LABEL[r.provider] || r.provider} ${r.mallId}`];
    if (r.problem?.kind === 'action') {
      sent += await sendSystemAlert({
        dedupKey: `mall-action:${r.id}:${r.problem.cause}`,
        cooldownMs: DAY_MS,
        title: `자사몰 연동에 사람이 해야 할 일이 생겼습니다(${CAUSE_LABEL[r.problem.cause] || r.problem.cause}).`,
        details: where,
        action: '슈퍼관리자 자사몰 연동 감시 표에서 그 몰을 보고 고객사에 안내해 주세요.',
      });
    }
    const key = `${r.companyId}|${r.provider}|${r.provider === 'woocommerce' ? r.mallId : ''}`;
    if (isUnusualSilence(r, gaps.get(key), nowMs)) {
      sent += await sendSystemAlert({
        dedupKey: `mall-silence:${r.id}`,
        cooldownMs: DAY_MS,
        title: '자사몰에서 지난 30일 중 가장 긴 시간보다 오래 데이터가 오지 않습니다.',
        details: [...where, `마지막 수신: ${r.lastReceivedAt}`],
        action: '몰 쪽 웹훅 · 앱 삭제 · 연결 상태를 확인해 주세요.',
      });
    }
    if (r.unknownStatuses.length > 0) {
      sent += await sendSystemAlert({
        dedupKey: `mall-unknown-status:${r.companyId}:${r.provider}:${r.unknownStatuses.map((u) => u.status).sort().join(',')}`,
        cooldownMs: 7 * DAY_MS,
        title: '자사몰 주문에 우리 상태표에 없는 상태 글자가 들어왔습니다(결제 아님으로 둠).',
        details: [...where, ...r.unknownStatuses.slice(0, 5).map((u) => `${u.status}: ${u.count}건`)],
        action: '그 글자가 결제된 주문이면 상태표에 넣어야 구매로 셉니다.',
      });
    }
  }
  return sent;
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const n = await runMallWatchPass();
    if (n > 0) console.log(`[Mall Watch] 경보 ${n}건`);
  } catch (err) {
    console.error('[Mall Watch] 회차 오류:', err);
  } finally {
    running = false;
  }
}

export function startMallWatchWorker(): void {
  setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 11 * 60 * 1000);   // 기동 11분 뒤 첫 회차(토큰 유지 7분 · 고도몰 3분과 겹치지 않게)
  console.log('[Mall Watch] 워커 시작 (1시간 주기 · 사람 조치 · 평소보다 긴 침묵 · 모르는 상태)');
}
