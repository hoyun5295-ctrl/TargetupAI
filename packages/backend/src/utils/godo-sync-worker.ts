/**
 * godo-sync-worker.ts — 고도몰 주기 수집 워커 (★2026-08-10 신설)
 *
 * 왜 만드는가
 *   고도몰은 `connectMethod: 'polling'`으로 선언돼 있고 화면은 "주문·고객 자동 동기화"라고 안내하는데,
 *   실제 수집 경로는 `POST /api/godo/connect`가 부르는 백필 **1회**뿐이었다(호출부 grep = routes/godo.ts 한 곳).
 *   연결한 뒤에 생긴 주문은 재연결 전까지 영영 안 들어왔다. 안내가 사실이 아니었다.
 *   고도몰은 웹훅이 없어(godo-adapter — OAuth/webhook 경로 없음) 우리가 주기적으로 당겨오는 것이 유일한 길이다.
 *
 * ⛔ 이 워커가 지키는 것
 *   1. **수집 로직을 다시 쓰지 않는다.** 창 분할·페이지 커서·identify·syncOrder는 전부
 *      `godo-client.backfillGodoOrders`가 이미 소유한다. 여기는 **언제·누구를·얼마나**만 정한다.
 *   2. **중복은 구조가 막는다.** 고도몰 API는 날짜 단위 조회라 시각으로 창을 자를 수 없어 최근 며칠을
 *      다시 읽는다. 같은 주문을 다시 넣어도 `syncOrder`가 `properties->>'order_id'`로 멱등이라
 *      이벤트가 두 번 생기지 않는다 — 즉 여정 중복 진입도 구조적으로 없다.
 *   3. **소급 적재가 발송이 되지 않는다.** 공백이 길었던 회사는 창이 넓어지는데, 그렇게 늦게 들어온
 *      과거 주문은 여정 발생 시각 창(journey-purchase-ledger.PURCHASE_TRIGGER_MAX_AGE_HOURS)이 막는다.
 *      데이터는 채워지고 발송은 안 나간다. 이 워커가 그 가드보다 **뒤에** 배포돼야 하는 이유다.
 *   4. **실패로 연동을 끊지 않는다.** 키 오류·IP 미등록·호출 한도는 `status`를 건드리지 않고 `meta`에만
 *      남긴다. `status`를 'error'로 바꾸면 화면이 그 몰을 "연결 안 됨"으로 표시해(getGodoStatus) 사실이 뒤집힌다.
 *   5. **한 회사의 실패가 다음 회사를 막지 않는다.** 회사별 try로 격리한다.
 */

import { query } from '../config/database';
import { backfillGodoOrders, GodoApiError } from './godo-client';
import { isCdpEnabledForPlan } from './cdp-auth';

/** 주기. 고도몰은 호출 한도(429·EXHAUSTED)가 있어 짧게 돌리지 않는다. */
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 평상시 재조회 창(일). 고도몰 조회는 날짜 단위(YYYY-MM-DD)라 "직전 30분"을 지정할 수 없다.
 * 하루만 보면 자정 직후 회차가 어제 늦은 주문을 놓치므로 어제까지 함께 본다.
 */
const MIN_WINDOW_DAYS = 2;

/**
 * 한 회차 상한(일). 공백이 이보다 길면 이 워커로는 다 못 메운다 —
 * 그건 재연결(90일 백필)이 복구 경로이고, 여기서는 경고만 남긴다(조용히 지나가면 누락을 아무도 모른다).
 */
const MAX_WINDOW_DAYS = 30;

/** 회사 간 간격 — 외부 API에 몰아치지 않는다. */
const COMPANY_GAP_MS = 1000;

const GODO_INTEGRATION_MALL_ID = 'godo';

let running = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GodoSyncTarget {
  company_id: string;
  /** 마지막 성공 수집 시각. NULL이면 아직 이 워커가 돈 적 없는 회사. */
  last_synced_at: Date | null;
  connected_at: Date | null;
}

/**
 * 이번 회차에 볼 일수. 기준점은 "마지막으로 확인한 시점"이다 —
 * 워커가 돈 적 있으면 last_synced_at, 없으면 연결 시점(connected_at, 그때 백필이 돌았다).
 * 하루 여유를 더해 경계에서 새는 것을 막고, 상한으로 한 회차가 길어지는 것을 막는다.
 */
export function resolveWindowDays(lastSyncedAt: Date | null, connectedAt: Date | null, now: Date): number {
  const anchor = lastSyncedAt || connectedAt;
  if (!anchor) return MIN_WINDOW_DAYS;
  const elapsedDays = (now.getTime() - new Date(anchor).getTime()) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0) return MIN_WINDOW_DAYS;
  const needed = Math.ceil(elapsedDays) + 1;
  return Math.min(Math.max(needed, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}

/** 공백이 상한을 넘었는가 — 넘었으면 이 회차로는 다 못 메운다(경고 대상). */
export function isGapBeyondWindow(lastSyncedAt: Date | null, connectedAt: Date | null, now: Date): boolean {
  const anchor = lastSyncedAt || connectedAt;
  if (!anchor) return false;
  const elapsedDays = (now.getTime() - new Date(anchor).getTime()) / (24 * 60 * 60 * 1000);
  return Number.isFinite(elapsedDays) && elapsedDays > MAX_WINDOW_DAYS;
}

async function markSuccess(companyId: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET last_synced_at = NOW(),
            meta = COALESCE(meta, '{}'::jsonb) - 'godo_sync_error' - 'godo_sync_error_code' - 'godo_sync_error_at',
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
}

/**
 * 실패 기록. `status`는 건드리지 않는다(원칙 4) — 사유만 남겨 다음 회차가 같은 창을 다시 시도한다.
 * `last_synced_at`도 올리지 않는다. 올리면 실패한 구간이 창 밖으로 밀려 영영 안 들어온다.
 */
async function markFailure(companyId: string, code: string, message: string): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
              'godo_sync_error', $3::text,
              'godo_sync_error_code', $4::text,
              'godo_sync_error_at', to_char(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS')
            ),
            updated_at = NOW()
      WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID, String(message || '').slice(0, 500), code],
  );
}

export interface GodoSyncPassResult {
  companies: number;
  synced: number;
  imported: number;
  failed: number;
}

export async function runGodoSyncPass(): Promise<GodoSyncPassResult> {
  const result: GodoSyncPassResult = { companies: 0, synced: 0, imported: 0, failed: 0 };

  // 검증된 연동만 — 저장만 하고 확인 안 된 키는 getGodoStatus와 같은 기준으로 제외한다(status='active' + connected_at).
  const targets = await query(
    `SELECT company_id, last_synced_at, connected_at
       FROM company_integrations
      WHERE provider = 'godo'
        AND mall_id = $1
        AND status = 'active'
        AND connected_at IS NOT NULL
      ORDER BY COALESCE(last_synced_at, connected_at) ASC`,
    [GODO_INTEGRATION_MALL_ID],
  );

  const now = new Date();
  for (const row of targets.rows as GodoSyncTarget[]) {
    result.companies++;
    try {
      // 요금제 게이트 — 연결 라우트와 같은 기준. 다운그레이드한 회사가 계속 수집되지 않게 한다.
      if (!(await isCdpEnabledForPlan(row.company_id))) continue;

      if (isGapBeyondWindow(row.last_synced_at, row.connected_at, now)) {
        console.warn(
          `[Godo Sync] 공백이 ${MAX_WINDOW_DAYS}일을 넘음 — 이번 회차로는 다 못 메운다(company=${row.company_id}). 전체 복구는 재연결 백필.`,
        );
      }

      const days = resolveWindowDays(row.last_synced_at, row.connected_at, now);
      const r = await backfillGodoOrders(row.company_id, { days });
      await markSuccess(row.company_id);
      result.synced++;
      result.imported += r.imported;
    } catch (err: any) {
      result.failed++;
      const code = err instanceof GodoApiError ? err.code : 'unknown';
      const message = String(err?.message || 'unknown');
      await markFailure(row.company_id, code, message).catch((e) =>
        console.error('[Godo Sync] 실패 기록 실패:', e),
      );
      // 429는 정상 흐름의 일부(호출 한도) — 다음 회차에 같은 창을 다시 본다.
      console.error(`[Godo Sync] 수집 실패 company=${row.company_id} code=${code} — ${message}`);
    }
    await sleep(COMPANY_GAP_MS);
  }

  return result;
}

async function tick(): Promise<void> {
  if (running) return;   // 앞 회차가 길어지면 겹치지 않게 건너뛴다
  running = true;
  try {
    const r = await runGodoSyncPass();
    if (r.companies > 0) {
      console.log(`[Godo Sync] 대상 ${r.companies}곳 · 성공 ${r.synced} · 주문 ${r.imported}건 · 실패 ${r.failed}`);
    }
  } catch (err) {
    console.error('[Godo Sync] 주기 실행 오류:', err);
  } finally {
    running = false;
  }
}

export function startGodoSyncWorker(): void {
  setInterval(tick, SYNC_INTERVAL_MS);
  // 기동 3분 후 첫 실행 (부팅 직후 다른 스케줄러와 겹치지 않게)
  setTimeout(tick, 3 * 60 * 1000);
  console.log(`[Godo Sync] 워커 시작 (${SYNC_INTERVAL_MS / 60000}분 주기, 재조회 창 최소 ${MIN_WINDOW_DAYS}일)`);
}
