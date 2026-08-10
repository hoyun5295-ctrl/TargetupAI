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
import { query } from '../config/database';
import { syncOrder } from './cdp-orders';
import { identifyCustomer, parseConsentValue } from './cdp-identity';
import { GODO_SOURCE, parseGodoOrderResponse, mapGodoOrderToCdp, type GodoParsedResponse } from './godo-parse';

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
}

/**
 * 회사 고도몰 주문 백필. days(기본 90)를 30일 윈도우로 끊어 과거로 순회, 각 윈도우는 lastOrder 커서로 페이지네이션.
 * 각 주문 = (수신동의 있으면 identify) → syncOrder. dedup은 syncOrder 멱등(order_id)로 보장.
 */
export async function backfillGodoOrders(
  companyId: string,
  opts?: { days?: number; sandbox?: boolean },
): Promise<GodoBackfillResult> {
  const creds = await getGodoCredentials(companyId);
  if (!creds?.key) throw new GodoApiError('key', '고도몰 쇼핑몰 인증키가 설정되지 않았습니다.');

  const days = opts?.days ?? DEFAULT_BACKFILL_DAYS;
  let imported = 0;
  let windows = 0;
  let pages = 0;

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
      for (const raw of page.orders) {
        const mapped = mapGodoOrderToCdp(raw);
        if (!mapped) continue;
        const consent = parseConsentValue(mapped.smsRaw);
        if (consent !== undefined) {
          await identifyCustomer(companyId, {
            source: GODO_SOURCE,
            externalId: mapped.order.externalId,
            phone: mapped.order.phone,
            name: mapped.order.name,
            email: mapped.order.email,
            smsOptIn: consent,
          });
        }
        await syncOrder(companyId, mapped.order);
        imported++;
      }
      cursor = page.hasNext ? page.lastOrderNo ?? undefined : undefined;
    } while (cursor);

    windows++;
    windowEnd = new Date(start);
  }

  await query(
    `UPDATE company_integrations SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );

  return { imported, windows, pages };
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
  await query(
    `UPDATE company_integrations
     SET status = 'active', connected_at = COALESCE(connected_at, NOW()), updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'godo' AND mall_id = $2`,
    [companyId, GODO_INTEGRATION_MALL_ID],
  );
}

// ════════════════════════════════════════════════════════════════════
// 자격 저장/조회/상태 (company_integrations.meta — 카페24 BYO와 동일 패턴)
// ════════════════════════════════════════════════════════════════════

/** 고객 쇼핑몰 인증키(key)를 company_integrations.meta.godo_key에 저장. */
export async function saveGodoCredentials(companyId: string, key: string): Promise<void> {
  await query(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, 'godo', $2, '', '',
      NULL, '', $3::jsonb, NULL, NULL, 'pending', NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      meta = company_integrations.meta || EXCLUDED.meta,
      status = 'pending',
      updated_at = NOW()`,
    [companyId, GODO_INTEGRATION_MALL_ID, JSON.stringify({ godo_key: key })],
  );
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
  return meta.godo_key ? { key: meta.godo_key } : undefined;
}

export interface GodoStatus {
  connected: boolean;
  status?: string;
  connectedAt?: string | null;
  /** ★2026-08-10 마지막 주기 수집 성공 시각(godo-sync-worker). 한 번도 안 돌았으면 null. */
  lastSyncedAt?: string | null;
  /** ★2026-08-10 마지막 수집 실패 사유. 있으면 화면이 '조치 필요'로 말한다(키 무효·IP 미등록·호출 한도). */
  syncError?: { message: string; code: string; at: string | null } | null;
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
