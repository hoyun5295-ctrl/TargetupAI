/**
 * 고도몰(NHN커머스) Open API 폴링 커넥터 — IO 계층 — 2026-06-18
 *
 * BYO-키 방식:
 *   - partner_key = 한줄로 제휴사 인증키 (env GODO_PARTNER_KEY, 전 회사 공통)
 *   - key         = 고객 쇼핑몰 인증키 (회사가 발급받아 입력 → company_integrations.meta.godo_key)
 *
 * 흐름: Order_Search.php POST(partner_key+key+기간+size+lastOrder 커서) → parseGodoOrderResponse → 주문 → syncOrder CT.
 * 순수 파싱·매핑은 godo-parse.ts(DB-free, TDD). provider-registry(OAuth/Webhook 전용)엔 미등록.
 *
 * ⛔ XML 실제 중첩·orderDate 타임존은 partner_key·서버 IP 허용 도착 후 실 raw 1건으로 최종 확인(D217).
 */

import axios from 'axios';
import { saveIntegrationRowGuarded, integrationRowScopeOf } from './integration-scope';   // ★ 2026-10-27 자사몰 대비 K9 SC1 — 연동 행 저장 = 회사 모드 잠금 → 판정 → 저장(한 트랜잭션)
import { createIntegrationRow } from './integration-row';   // ★ 1028 K9 — 연동 행 INSERT = CT 하나(몰 접두 고정)
import { openSecret } from './secret-box';   // ★1028 K8 자격 읽기 이중(암호문 · 평문)
import { processImportItems, newImportGuard } from './mall-import';
import { integrationProblemOf, type IntegrationProblem } from './integration-problem';
import { query } from '../config/database';
import { syncOrder } from './cdp-orders';
import { parseGodoOrderResponse, mapGodoOrderToCdp, type GodoParsedResponse } from './godo-parse';

// ════════════════════════════════════════════════════════════════════
// 상수
// ════════════════════════════════════════════════════════════════════

const GODO_REAL_BASE = 'https://openhub.godo.co.kr';
const GODO_SANDBOX_BASE = 'http://sbopenhub.godo.co.kr';
const ORDER_SEARCH_PATH = '/godomall5/order/Order_Search.php';
const GODO_INTEGRATION_MALL_ID = 'godo'; // company_integrations UNIQUE(company_id, provider, mall_id) — 회사당 1건

const MAX_WINDOW_DAYS = 30;        // 주문조회 최대 기간(201 방지)
const DEFAULT_BACKFILL_DAYS = 90;
const PAGE_SIZE = 100;

// ════════════════════════════════════════════════════════════════════
// HTTP — Order_Search 1페이지
// ════════════════════════════════════════════════════════════════════

export class GodoApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'GodoApiError';
  }
}

const RETURN_CODE_MESSAGE: Record<string, string> = {
  '999': '쇼핑몰 인증키(key)가 유효하지 않습니다.',
  '998': '제휴사 인증키(partner_key)가 유효하지 않습니다.',
  '997': '인증키 사용기간이 맞지 않습니다.',
  '996': '한줄로 서버 IP가 고도몰에 허용 등록되어 있지 않습니다. 운영자에게 IP 등록을 요청해주세요.',
  '995': '해당 API에 접속 권한이 없습니다.',
  '201': '주문 조회 기간은 30일을 초과할 수 없습니다.',
  '202': '조회 기간 또는 주문번호는 필수입니다.',
};

export interface FetchGodoOrdersParams {
  key: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  size?: number;
  lastOrder?: string;  // 직전 마지막 주문번호(커서)
  sandbox?: boolean;
}

/**
 * Order_Search 1페이지 호출. RETURN 000=성공, 204=주문없음(빈 결과), 그 외=GodoApiError.
 * 429 또는 ratelimit-available-level=EXHAUSTED 시 GodoApiError('429').
 */
export async function fetchGodoOrderPage(params: FetchGodoOrdersParams): Promise<GodoParsedResponse> {
  const partnerKey = process.env.GODO_PARTNER_KEY || '';
  if (!partnerKey) throw new GodoApiError('partner_key', 'GODO_PARTNER_KEY 환경변수가 설정되지 않았습니다.');
  if (!params.key) throw new GodoApiError('key', '쇼핑몰 인증키(key)가 없습니다.');

  const base = params.sandbox ? GODO_SANDBOX_BASE : GODO_REAL_BASE;
  const form = new URLSearchParams();
  form.set('partner_key', partnerKey);
  form.set('key', params.key);
  form.set('dateType', 'order');
  form.set('startDate', params.startDate);
  form.set('endDate', params.endDate);
  form.set('size', String(params.size ?? PAGE_SIZE));
  if (params.lastOrder) form.set('lastOrder', params.lastOrder);

  const res = await axios.post(`${base}${ORDER_SEARCH_PATH}`, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    timeout: 20000,
    responseType: 'text',
    transformResponse: (d) => d,
    validateStatus: () => true,
  });

  if (res.status === 429) throw new GodoApiError('429', '고도몰 호출 한도 초과(429). 잠시 후 다시 시도해주세요.');
  if (String(res.headers?.['ratelimit-available-level'] ?? '').toUpperCase() === 'EXHAUSTED') {
    throw new GodoApiError('429', '고도몰 호출 한도 소진(EXHAUSTED). 잠시 후 다시 시도해주세요.');
  }

  const parsed = parseGodoOrderResponse(String(res.data ?? ''));
  if (parsed.code === '204') return { ...parsed, orders: [], hasNext: false }; // 주문 없음 = 빈 결과
  if (parsed.code && parsed.code !== '000') {
    throw new GodoApiError(parsed.code, RETURN_CODE_MESSAGE[parsed.code] || parsed.msg || `고도몰 오류(${parsed.code})`);
  }
  return parsed;
}

// ════════════════════════════════════════════════════════════════════
// 백필 — 30일 윈도우 분할 + size/lastOrder 커서 순회
// ════════════════════════════════════════════════════════════════════

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface GodoBackfillResult {
  imported: number;
  windows: number;
  pages: number;
  /** ★1028 K11 · M27 — 넣을 수 없는 건(휴대폰 없음 · 형식) · 그 밖 실패로 그 건만 건너뛴 수 */
  skipped: number;
  failed: number;
}

/**
 * 회사 고도몰 주문 백필. days(기본 90)를 30일 윈도우로 끊어 과거로 순회, 각 윈도우는 lastOrder 커서로 페이지네이션.
 * 각 주문 = (수신동의 있으면 identify) → syncOrder. dedup은 syncOrder 멱등(order_id)로 보장.
 */
export async function backfillGodoOrders(
  companyId: string,
  opts?: { days?: number; sandbox?: boolean; first?: boolean },
): Promise<GodoBackfillResult> {
  const creds = await getGodoCredentials(companyId);
  if (!creds?.key) throw new GodoApiError('key', '고도몰 쇼핑몰 인증키가 설정되지 않았습니다.');

  const days = opts?.days ?? DEFAULT_BACKFILL_DAYS;
  let imported = 0;
  let windows = 0;
  let pages = 0;
  let skipped = 0;
  let failed = 0;
  const guard = newImportGuard();

  // ★ 1028 K9 — 이 연동 행의 몰 접두(외부 번호 = mallScopedIds · 고도몰 = 빈 접두) · ★ Codex R1 #6 분류코드(연결 때 고른 값 · 적재마다 싣는다)
  const rowScope = await integrationRowScopeOf(companyId, 'godo', GODO_INTEGRATION_MALL_ID);
  const idScope = { provider: 'godo', mallId: GODO_INTEGRATION_MALL_ID, idPrefix: rowScope.idPrefix };

  // ★ 1028 K11 첫 구매 보호 — 첫 가져오기가 끝날 때까지 표시(처음 시작 시각을 지킴 · 성공해야 지움 · 실패하면 남아 주기 수집이 90일 창으로 잇는다 · 48시간 뒤 판정에서 빠짐)
  if (opts?.first) await setGodoFirstImportMark(companyId, true);
  let windowEnd = new Date();
  const floor = new Date();
  floor.setDate(floor.getDate() - days);

  while (windowEnd > floor) {
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - MAX_WINDOW_DAYS);
    const start = windowStart < floor ? floor : windowStart;

    let cursor: string | undefined;
    do {
      const page = await fetchGodoOrderPage({
        key: creds.key,
        startDate: ymd(start),
        endDate: ymd(windowEnd),
        size: PAGE_SIZE,
        lastOrder: cursor,
        sandbox: opts?.sandbox,
      });
      pages++;
      // ★ 1028 K11 · M27 — 건별 반복 = 공용 CT(그 건만 건너뜀 · 연속 실패만 멈춤 · 23505 1회 재시도) · 옛: 한 건 예외(유선 번호만 있는 비회원)가 회차 전체를 죽이고 30분마다 같은 창을 다시 읽어 또 죽었다.
      const t = await processImportItems(page.orders, async (raw: any) => {
        const mapped = mapGodoOrderToCdp(raw, idScope);
        if (!mapped) return false;
        // ★ 2026-10-27 자사몰 대비 K2-1 — 주문마다 실린 smsFl 은 원문으로 칸 뜻을 확인하기 전 동의로 쓰지 않는다(옛: 옛 주문의 Y 가 새 거부를 되돌렸다 · M2).
        await syncOrder(companyId, { ...mapped.order, ...(rowScope.storeCode ? { storeCode: rowScope.storeCode } : {}) });
        return true;
      }, guard, (raw: any) => `godo company=${companyId} order=${String(raw?.orderNo ?? '-')}`);
      imported += t.results.filter(Boolean).length;
      skipped += t.skipped;
      failed += t.failed;
      cursor = page.hasNext ? page.lastOrderNo ?? undefined : undefined;
    } while (cursor);

    windows++;
    windowEnd = new Date(start);
  }
  // 끝까지 읽었고 다시 해야 할 실패가 0일 때만 지운다(Codex R1 #3 · R2 #3 · 중간에 던지거나 재시도 부류 실패가 남으면 표시가 남아 다음 회차가 90일 창으로 다시 읽는다)
  if (opts?.first && failed === 0) await setGodoFirstImportMark(companyId, false).catch((e) => console.error('[Godo backfill] 첫 가져오기 표시 지우기 실패(48시간 뒤 판정에서 빠짐 · 다음 성공 회차가 지움):', e?.message || e));

  // ★ 2026-09-27 한줄로 V2 R124 — 백필 도중 연동을 해제(revoked)했으면 되살리지 않는다(옛: 조건 없이 active로 덮어 수집이 재개됐다).
  await query(
    `UPDATE company_integrations SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2 AND status <> 'revoked'`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );

  return { imported, windows, pages, skipped, failed };
}

async function setGodoFirstImportMark(companyId: string, on: boolean): Promise<void> {
  await query(
    `UPDATE company_integrations
        SET meta = CASE WHEN NOT $3 THEN COALESCE(meta, '{}'::jsonb) - 'first_import_started_at'
                        WHEN meta ? 'first_import_started_at' THEN meta   -- 이어 가는 회차 = 처음 시작 시각 그대로(48시간 상한이 늘지 않게)
                        ELSE COALESCE(meta, '{}'::jsonb) || jsonb_build_object('first_import_started_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) END
      WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID, on],
  );
}

/** 연결 확인 — 최근 1일 1건 조회로 partner_key·key·IP 유효성 확인. 실패 시 GodoApiError throw(성공=void). */
export async function verifyGodoConnection(companyId: string): Promise<void> {
  const creds = await getGodoCredentials(companyId);
  if (!creds?.key) throw new GodoApiError('key', '고도몰 쇼핑몰 인증키가 설정되지 않았습니다.');
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 1);
  await fetchGodoOrderPage({ key: creds.key, startDate: ymd(start), endDate: ymd(end), size: 1 });
  // ★ 2026-07-03 검증 성공 시에만 active + connected_at 기록 (실제 효과 검증 후 연동 표시 — 6원칙 ②).
  // ★ 1028 K11 — 검증 성공 = 키 · IP 조치가 풀렸다 → 주기 수집이 action 원인으로 멈춰 둔 사유를 지운다(다음 회차부터 다시 부른다)
  await query(
    `UPDATE company_integrations
     SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW(),
         meta = COALESCE(meta, '{}'::jsonb) - 'godo_sync_error' - 'godo_sync_error_code' - 'godo_sync_error_at'
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
}

// ════════════════════════════════════════════════════════════════════
// 자격 저장/조회/상태 (company_integrations.meta — 카페24 BYO와 동일 패턴)
// ════════════════════════════════════════════════════════════════════

/** 고객 쇼핑몰 인증키(key)를 company_integrations.meta.godo_key에 저장. */
export async function saveGodoCredentials(companyId: string, key: string, storeCode: string | null = null): Promise<void> {
  await saveIntegrationRowGuarded(companyId, 'godo', GODO_INTEGRATION_MALL_ID, storeCode, (run) => createIntegrationRow(run, {
    companyId, provider: 'godo', mallId: GODO_INTEGRATION_MALL_ID,
    meta: { godo_key: key, ...(storeCode ? { store_code: storeCode } : {}) },   // ★1028 N6 분류코드
    status: { sql: "'pending'" },
    onConflict: ["status = 'pending'"],
  }));
}

/** 저장된 고도몰 key 조회(없으면 undefined). */
export async function getGodoCredentials(companyId: string): Promise<{ key: string } | undefined> {
  const r = await query(
    `SELECT meta, status FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2 LIMIT 1`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
  if (r.rows.length === 0) return undefined;
  if (r.rows[0].status === 'revoked') return undefined;
  const meta = (r.rows[0].meta || {}) as { godo_key?: string };
  const key = openSecret(meta.godo_key);   // ★1028 K8 읽기 이중
  return key ? { key } : undefined;
}

export interface GodoStatus {
  connected: boolean;
  status?: string;
  connectedAt?: string | null;
  /** ★2026-08-10 마지막 주기 수집 성공 시각(godo-sync-worker). 한 번도 안 돌았으면 null. */
  lastSyncedAt?: string | null;
  /** ★2026-08-10 마지막 수집 실패 사유. 있으면 화면이 '조치 필요'로 말한다(키 무효·IP 미등록·호출 한도). */
  syncError?: { message: string; code: string; at: string | null } | null;
  /** ★1028 K7 — 문제 분류(서버 판정 · 없으면 null) */
  problem?: IntegrationProblem | null;
}

/** 연동센터 표시용 상태. */
export async function getGodoStatus(companyId: string): Promise<GodoStatus> {
  const r = await query(
    `SELECT status, connected_at, last_synced_at, meta FROM company_integrations
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2 LIMIT 1`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
  if (r.rows.length === 0) return { connected: false };
  const row = r.rows[0];
  const meta = (row.meta || {}) as { godo_sync_error?: string; godo_sync_error_code?: string; godo_sync_error_at?: string };
  // ★ 2026-07-03 검증된 연동만 connected — status='active' AND connected_at 존재(verify/backfill 성공 시에만 기록).
  //   저장만 하고 검증 안 된 key(가짜 active·connected_at NULL)는 미연동으로 판정.
  return {
    connected: row.status === 'active' && !!row.connected_at,
    status: row.status,
    connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    // 워커는 실패해도 status를 안 내린다(연동은 살아 있다) — 그래서 사유가 여기 남고, 성공하면 지워진다.
    syncError: meta.godo_sync_error
      ? { message: meta.godo_sync_error, code: meta.godo_sync_error_code || 'unknown', at: meta.godo_sync_error_at || null }
      : null,
    problem: meta.godo_sync_error ? integrationProblemOf('godo', row.status, meta.godo_sync_error_code || 'unknown') : null,
  };
}

/** 연동 해제(status='revoked'). */
export async function disconnectGodo(companyId: string): Promise<void> {
  await query(
    `UPDATE company_integrations SET status = 'revoked', updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
}
