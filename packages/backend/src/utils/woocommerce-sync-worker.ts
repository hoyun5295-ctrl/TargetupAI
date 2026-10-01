/**
 * woocommerce-sync-worker.ts — 우커머스 주기 수집 워커 (2026-09-14 W3 · 고도몰 워커 규약 복제)
 * 설계서 = docs/2026-09-14-woocommerce-integration-design.md (§2 불변 8)
 *
 * 왜 있는가
 *   웹훅은 가속일 뿐이다 — 고객사가 웹훅을 안 만들었거나 전송이 실패하면 주문이 영영 안 들어온다.
 *   REST 키가 있는 몰은 30분마다 "마지막으로 확인한 시점 이후 수정된 주문"(modified_after · 상태 전환 포함)을 당겨온다.
 *
 * ⛔ 이 워커가 지키는 것(고도몰 워커와 같다)
 *   1. 수집 로직을 다시 쓰지 않는다 — 페이지 순회·identify·syncOrder 는 woocommerce-client.syncWooOrdersSince 가 소유한다.
 *   2. 중복은 구조가 막는다 — 겹친 창의 같은 주문은 syncOrder 멱등(order_id)이라 이벤트가 두 번 생기지 않는다.
 *   3. 소급 적재가 발송이 되지 않는다 — 여정 발생 시각 창(journey-purchase-ledger)이 막는다. 이 워커는 그 가드 뒤에 있다.
 *   4. 실패로 연동을 끊지 않는다 — status 는 그대로, meta.woo_sync_error 에만 남긴다(화면 "조치 필요" 근거).
 *   5. 한 몰의 실패가 다음 몰을 막지 않는다 — (회사, 몰) 행별 try 격리.
 *   6. REST 키 없는 몰(웹훅 전용)은 건너뛴다 — 매 회차 no_keys 실패를 남기면 "조치 필요"가 거짓 경보가 된다.
 */

import { query } from '../config/database';
import {
  syncWooOrdersSince, enqueueWooBackfill, ensureWooWebhooks, startWooOrderReread, removeWooWebhooks, listWooWebhookCleanupTargets,
  WooApiError, DEFAULT_BACKFILL_DAYS, MAX_SYNC_ORDERS,
} from './woocommerce-client';
import { isCdpEnabledForPlan } from './cdp-auth';

/** 주기 — 몰 서버(공유 호스팅일 수 있다)에 몰아치지 않는다. */
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 겹침(ms) — since 를 기준점보다 이만큼 물린다.
 * 우커머스 날짜 파라미터는 시간대 표기 없는 값(몰 시간대로 해석 · 미검증)이라 최대 반나절이 어긋날 수 있고,
 * 발신 지연도 있다. 겹친 주문은 syncOrder 멱등이 흡수하므로 넉넉히 12시간.
 */
export const OVERLAP_MS = 12 * 60 * 60 * 1000;

/** 기준점이 없을 때(연결 시각도 없음) 보는 일수. */
const MIN_WINDOW_DAYS = 2;

/** 한 회차 상한(일) = 연결 시 백필과 같은 깊이 — 얕으면 공백이 조용히 잊힌다(고도몰 워커 0810 정정 경위). */
export const MAX_WINDOW_DAYS = DEFAULT_BACKFILL_DAYS;

/** 몰 간 간격 — 외부 서버에 몰아치지 않는다. */
const MALL_GAP_MS = 1000;

/** 한 회차 상한에 닿았는데 주문 다시 읽기로 넘기지 못한 회차의 사유(화면 "조치 필요" 근거 · 고객이 읽는 말) */
const TRUNCATED_MESSAGE = '주문이 한 번에 읽을 수 있는 양보다 많아 수집이 밀려 있습니다. 자동으로 이어서 읽습니다.';

let running = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface WooSyncTarget {
  company_id: string;
  mall_id: string;
  last_synced_at: Date | null;
  connected_at: Date | null;
  meta: { woo_consumer_key?: string; woo_consumer_secret?: string; woo_key_permissions?: string; woo_backfill?: { stage?: string; requested?: boolean } } | null;
}

/**
 * 이번 회차의 since. 기준점 = 마지막 성공(last_synced_at) → 없으면 연결 시각(connected_at · 그때 백필이 돌았다) → 없으면 2일 전.
 * 기준점에서 OVERLAP 만큼 물리고, MAX_WINDOW_DAYS 바닥보다 과거로는 가지 않는다.
 */
export function resolveWooSince(lastSyncedAt: Date | null, connectedAt: Date | null, now: Date): Date {
  const floor = now.getTime() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const anchor = lastSyncedAt || connectedAt;
  if (!anchor) return new Date(now.getTime() - MIN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const t = new Date(anchor).getTime();
  if (!Number.isFinite(t)) return new Date(now.getTime() - MIN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return new Date(Math.max(t - OVERLAP_MS, floor));
}

/** 공백이 상한을 넘었는가 — 넘었으면 이 회차로는 다 못 메운다(경고 대상). */
export function isGapBeyondWindow(lastSyncedAt: Date | null, connectedAt: Date | null, now: Date): boolean {
  const anchor = lastSyncedAt || connectedAt;
  if (!anchor) return false;
  const elapsedDays = (now.getTime() - new Date(anchor).getTime()) / (24 * 60 * 60 * 1000);
  return Number.isFinite(elapsedDays) && elapsedDays > MAX_WINDOW_DAYS;
}

async function markSuccess(companyId: string, mallId: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET last_synced_at = NOW(),
            meta = COALESCE(meta, '{}'::jsonb) - 'woo_sync_error' - 'woo_sync_error_code' - 'woo_sync_error_at',
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId],
  );
}

/** 실패 기록 — status 는 건드리지 않고(원칙 4) last_synced_at 도 올리지 않는다(올리면 실패 구간이 창 밖으로 밀린다). */
async function markFailure(companyId: string, mallId: string, code: string, message: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'woo_sync_error', $3::text,
              'woo_sync_error_code', $4::text,
              'woo_sync_error_at', to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS')
            ),
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'woocommerce' AND mall_id = $2`,
    [companyId, mallId, String(message || '').slice(0, 500), code],
  );
}

export interface WooSyncPassResult {
  malls: number;
  synced: number;
  imported: number;
  failed: number;
  skipped: number;
}

export async function runWooSyncPass(): Promise<WooSyncPassResult> {
  const result: WooSyncPassResult = { malls: 0, synced: 0, imported: 0, failed: 0, skipped: 0 };

  // 검증된 몰만 — getWooStatus 와 같은 기준(status='active' + connected_at)
  const targets = await query(
    `SELECT company_id, mall_id, last_synced_at, connected_at, meta
       FROM company_integrations
      WHERE provider = 'woocommerce'
        AND status = 'active'
        AND connected_at IS NOT NULL
      ORDER BY COALESCE(last_synced_at, connected_at) ASC`,
  );

  const now = new Date();
  for (const row of targets.rows as WooSyncTarget[]) {
    result.malls++;
    try {
      // REST 키 없는 몰 = 웹훅 전용 — 당겨올 길이 없다. 실패로 남기지 않고 건너뛴다(원칙 6).
      if (!row.meta?.woo_consumer_key || !row.meta?.woo_consumer_secret) { result.skipped++; continue; }
      // 요금제 게이트 — 연결 라우트와 같은 기준
      if (!(await isCdpEnabledForPlan(row.company_id))) { result.skipped++; continue; }

      // ★0921 그 몰의 연결이 시작시킨(requested) 가져오기가 안 끝났으면(실패·서버 재시작) 줄 세워 이어 간다.
      //   워커가 스스로 시작하지 않는다 — 요청 없는 몰(상태 없음 · requested 아님)은 건드리지 않고 아래 주기 수집만 돈다
      //   (연동은 사용자 계정에서 자기 몰 하나씩 · 몰 1개 연동이 다른 몰로 번지면 안 된다 — Harold 0921).
      //   이어 가는 동안에는 그 몰의 주기 수집을 돌리지 않는다 — 같은 몰에 두 흐름이 동시에 붙으면 몰 서버 부하만 두 배다.
      const bf = row.meta?.woo_backfill;
      if (bf && bf.requested === true && bf.stage !== 'done') {
        enqueueWooBackfill(row.company_id, row.mall_id);
        result.skipped++;
        continue;
      }

      // ★ 2026-10-01 주문 상태 규칙이 바뀌었다 — **이미 가져오기를 끝낸 몰**의 최근 주문을 한 번 다시 읽는다(판정·줄 세우기는 client 소유).
      //   새 몰을 워커가 스스로 가져오는 것이 아니다(끝난 가져오기가 없는 몰은 false). 다시 읽는 회차에는 주기 수집을 건너뛴다(같은 몰에 두 흐름 금지).
      if (await startWooOrderReread(row.company_id, row.mall_id, 'rule')) {
        result.skipped++;
        continue;
      }

      if (isGapBeyondWindow(row.last_synced_at, row.connected_at, now)) {
        console.warn(`[Woo Sync] 공백이 ${MAX_WINDOW_DAYS}일을 넘음 — 그보다 과거 주문은 이 연동으로 가져오지 않는다(company=${row.company_id} mall=${row.mall_id}).`);
      }

      const since = resolveWooSince(row.last_synced_at, row.connected_at, now);
      const r = await syncWooOrdersSince(row.company_id, row.mall_id, since);
      result.imported += r.imported;

      // ★ 2026-10-01 한 회차 상한에 닿았다 = 남은 주문을 이 회차가 못 읽었다. 조용히 버리지 않는다 —
      //   상한 없는 주문 다시 읽기(진행 저장 · 이어 가기)로 넘긴다(몰 서버가 modified_after 를 몰라 회차마다 닿아도 하루 한 번까지).
      //   넘기지 못한 회차는 **커서를 전진시키지 않는다**(Codex 1001 R1) — 전진하면 남은 주문이 겹침 창 밖으로 밀려 영영 안 읽힌다.
      //   다음 회차가 같은 창을 다시 읽고(적재는 멱등), 다시 읽기로 넘어간 뒤에야 커서가 나간다.
      if (r.truncated && !(await startWooOrderReread(row.company_id, row.mall_id, 'truncated').catch(() => false))) {
        result.failed++;
        await markFailure(row.company_id, row.mall_id, 'truncated', TRUNCATED_MESSAGE).catch((e) => console.error('[Woo Sync] 실패 기록 실패:', e));
        console.warn(`[Woo Sync] 한 회차 상한(${MAX_SYNC_ORDERS}건)에 닿음 · 커서 유지 company=${row.company_id} mall=${row.mall_id}`);
        await sleep(MALL_GAP_MS);
        continue;
      }
      if (r.truncated) console.warn(`[Woo Sync] 한 회차 상한(${MAX_SYNC_ORDERS}건)에 닿음 · 주문 다시 읽기로 넘김 company=${row.company_id} mall=${row.mall_id}`);
      await markSuccess(row.company_id, row.mall_id);
      result.synced++;

      // ★ 2026-10-01 우리 웹훅 4개 점검 — 없으면 만들고 꺼졌으면(disabled) 다시 켠다. 쓰기 권한 키(1클릭 연결)만.
      //   실패는 수집 성공을 뒤집지 않는다(웹훅이 꺼져도 이 주기 수집이 안전망으로 돈다).
      if (String(row.meta?.woo_key_permissions || '').includes('write')) {
        try {
          const wh = await ensureWooWebhooks(row.company_id, row.mall_id);
          if (wh.created + wh.reactivated > 0) {
            console.log(`[Woo Sync] 웹훅 복구 company=${row.company_id} mall=${row.mall_id} 새로 만듦 ${wh.created} · 다시 켬 ${wh.reactivated}`);
          }
        } catch (whErr: any) {
          console.warn(`[Woo Sync] 웹훅 점검 실패(수집은 성공) company=${row.company_id} mall=${row.mall_id} — ${whErr?.message || whErr}`);
        }
      }
    } catch (err: any) {
      result.failed++;
      const code = err instanceof WooApiError ? err.code : 'unknown';
      const message = String(err?.message || 'unknown');
      await markFailure(row.company_id, row.mall_id, code, message).catch((e) => console.error('[Woo Sync] 실패 기록 실패:', e));
      console.error(`[Woo Sync] 수집 실패 company=${row.company_id} mall=${row.mall_id} code=${code} — ${message}`);
    }
    await sleep(MALL_GAP_MS);
  }

  // ★ 2026-10-01 해제 뒤 웹훅 정리가 덜 끝난 몰(몰 목록을 못 읽었거나 못 지운 것이 남음)을 이어서 정리한다(판정·기한·제거는 client 소유).
  //   실패해도 이 회차의 수집 결과와 무관하다 — 다음 회차가 다시 한다.
  for (const t of await listWooWebhookCleanupTargets().catch(() => [])) {
    const n = await removeWooWebhooks(t.companyId, t.mallId).catch((e: any) => { console.warn(`[Woo Sync] 해제 몰 웹훅 정리 실패 mall=${t.mallId} — ${e?.message || e}`); return 0; });
    if (n > 0) console.log(`[Woo Sync] 해제 몰 웹훅 정리 company=${t.companyId} mall=${t.mallId} 지움 ${n}`);
    await sleep(MALL_GAP_MS);
  }

  return result;
}

async function tick(): Promise<void> {
  if (running) return;   // 앞 회차가 길어지면 겹치지 않게 건너뛴다
  running = true;
  try {
    const r = await runWooSyncPass();
    if (r.malls > 0) {
      console.log(`[Woo Sync] 대상 ${r.malls}몰 · 성공 ${r.synced} · 주문 ${r.imported}건 · 실패 ${r.failed} · 건너뜀 ${r.skipped}`);
    }
  } catch (err) {
    console.error('[Woo Sync] 주기 실행 오류:', err);
  } finally {
    running = false;
  }
}

export function startWoocommerceSyncWorker(): void {
  setInterval(tick, SYNC_INTERVAL_MS);
  // 기동 4분 후 첫 실행 (고도몰 워커 3분과 겹치지 않게)
  setTimeout(tick, 4 * 60 * 1000);
  console.log(`[Woo Sync] 워커 시작 (${SYNC_INTERVAL_MS / 60000}분 주기 · 겹침 ${OVERLAP_MS / 3600000}시간 · 상한 ${MAX_WINDOW_DAYS}일)`);
}
