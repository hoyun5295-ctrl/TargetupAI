/**
 * cdp-webhook-delivery.ts — 몰 웹훅 1건을 연동된 회사마다 기록 · 처리 (★ 2026-09-27 한줄로 V2 R098·R244·R188)
 *
 * 옛: 카페24·아임웹·네이버 웹훅 라우트가 몰 ID로 회사를 `LIMIT 1`(정렬 없음)로 골라, 같은 몰이 여러 회사에
 *   연동돼 있으면 이벤트가 임의 한 회사로만 갔다. 세 라우트가 같은 적재·중복·처리·실패 기록을 각자 들고 있었다.
 * 이제: 연동된(그리고 인증된) 회사 전부에 대해 이 CT 하나가 회사별 전달 행을 남기고 처리한다.
 *   - 중복 = (company_id, source, idempotency_key) — 회사마다 따로다(한 회사의 중복이 다른 회사를 막지 않는다).
 *
 * ★ 2026-10-27 자사몰 대비 설계 K2-5 · K2-6(docs/2026-10-27-mall-integration-hardening-design.md · 불변 I13)
 *   - 기록 → **즉시 200** → 처리는 뒤(같은 프로세스 회사별 직렬 줄 · 동시 수 · 길이 상한). 우커머스 · 자체호스팅 인라인 기록도 이 CT 로 합쳤다.
 *   - 행 하나를 처리하려는 쪽(수신 줄 · 재처리 워커)은 모두 claimDeliveries 의 **한 선점 문장**을 지난다.
 *     processed_at = 마지막으로 잡은(시도한) 시각 → 한 회차에서 실패한 행은 다시 걸리지 않고, 줄이 잡은 행은 워커가 LIMIT 전에 뺀다.
 *   - 넘치거나 프로세스가 죽으면 received 로 남아 재처리 워커가 10분 뒤 줍는다(즉시 200 으로 몰의 재전송이 끊겼으므로 이 표가 유일한 사본).
 *   - 처리 결과 'stale'(옛 스냅숏 · K1-6) = superseded 로 닫는다.
 */
import { query } from '../config/database';
import { getProvider } from './provider-registry';
import { runSerial } from './inflight-lock';
import { integrationRowScopeOf } from './integration-scope';
import type { MallScope } from './integration-row';
import { classifyIngestError } from './mall-import';

export type WebhookSource = 'cafe24' | 'imweb' | 'woocommerce' | 'custom';   // ★1028 M19 네이버 = 조회형(웹훅 없음)

/** 처리에 함께 넘기는 수신 맥락 — 받은 시각 = 전달 행 created_at(재처리 때도 같은 값 · 원천 시각이 없는 provider 의 사건 시각 · 값 시계) */
export interface WebhookCtx {
  observedAt: string;
  /** ★ 1027 K9 SC1 — 이 웹훅이 온 연동 행의 분류코드(없으면 null · 어댑터가 식별 · 주문 적재에 싣는다 · 요청 본문 값 아님) */
  storeCode: string | null;
  /** ★ 1028 K9 — 외부 회원 · 주문 번호의 몰 접두 범위(그 연동 행 · 어댑터는 mallScopedIds 로만 번호를 만든다 · I9) */
  idScope: MallScope;
}

/** 처리 결과 — 'stale' = 옛 스냅숏이라 쓰지 않음(전달은 superseded 로 닫는다) */
export type WebhookProcessResult = void | 'stale';

/** 재처리 상한(실패 행) — 다 쓰면 소진 경보 */
export const WEBHOOK_MAX_RETRY = 3;

/**
 * 웹훅 본문 → 처리 대상(resource). 원래 수신 라우트와 재처리 워커가 **같은 규칙**을 쓴다(R188 —
 * 재처리가 `payload.resource || payload`만 봐서 아임웹 실패 웹훅은 재처리해도 같은 모양으로 또 실패했다).
 */
export function extractWebhookResource(source: string, payload: any): any {
  const p = payload || {};
  if (source === 'imweb') return p.data || p.resource || p;
  if (source === 'cafe24') return p.resource || {};
  return p.resource || p;
}

export interface WebhookDeliveryOutcome {
  recorded: number;
  duplicate: number;
}

/**
 * 회사마다 전달 행을 기록하고 처리를 줄에 올린다. 처리 결과를 기다리지 않는다(라우트는 이 반환 뒤 바로 200).
 * payload = 재처리가 다시 읽는 원문(우커머스 = { mall_id, topic, delivery_id, resource } · 증명 주소 학습이 이 모양을 읽는다).
 */
export async function deliverWebhookToCompanies(opts: {
  source: WebhookSource;
  companyIds: string[];
  event: string;
  idempotencyKey: string;
  payload: any;
  /** 연동 행의 몰 식별자(서명 · 인증을 통과한 행 기준) — 원문에 `_mall_id` 로 남겨 재처리도 같은 행의 분류코드를 찾는다 */
  mallId?: string;
  logTag: string;
}): Promise<WebhookDeliveryOutcome> {
  const outcome: WebhookDeliveryOutcome = { recorded: 0, duplicate: 0 };
  const stored = opts.mallId && opts.payload && typeof opts.payload === 'object' && !Array.isArray(opts.payload) && opts.payload._mall_id === undefined
    ? { ...opts.payload, _mall_id: opts.mallId }
    : opts.payload;
  const companyIds = Array.from(new Set(opts.companyIds.map((c) => String(c))));
  for (const companyId of companyIds) {
    const insertRes = await query(
      `INSERT INTO cdp_webhook_deliveries (
        id, company_id, source, webhook_event, idempotency_key, payload, status, retry_count, created_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, $2, $3, $4, $5::jsonb, 'received', 0, NOW()
      )
      ON CONFLICT (company_id, source, idempotency_key) DO NOTHING
      RETURNING id`,
      [companyId, opts.source, opts.event, opts.idempotencyKey, JSON.stringify(stored || {})],
    );
    if (insertRes.rows.length === 0) {
      // 중복 — 처리 완료 행만 중복 표시(실패 행을 덮으면 재처리 워커 대상에서 빠져 이벤트가 유실된다 · R1-02)
      await query(
        `UPDATE cdp_webhook_deliveries
         SET status = 'duplicate', processed_at = NOW()
         WHERE company_id = $1::uuid AND source = $2 AND idempotency_key = $3
           AND status = 'processed'`,
        [companyId, opts.source, opts.idempotencyKey],
      );
      outcome.duplicate += 1;
      continue;
    }
    outcome.recorded += 1;
    scheduleDelivery(String(insertRes.rows[0].id), `${opts.source}:${companyId}`, opts.logTag);
  }
  return outcome;
}

// ── 수신 줄(같은 프로세스 · 회사별 직렬 · 동시 수 · 길이 상한) ─────────────────────
//   ponytail: 프로세스 메모리 줄(fork 1개 전제 · I14) — 재시작 · 넘침은 received 로 남아 재처리 워커가 줍는다(유실 0).
const QUEUE_MAX_TOTAL = 500;
const MAX_CONCURRENT = 4;
let queued = 0;
let active = 0;
const waiting: Array<() => void> = [];
const pending = new Set<Promise<void>>();

async function takeSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) { active += 1; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));   // 넘겨받은 자리(active 그대로)
}
function giveSlot(): void {
  const next = waiting.shift();
  if (next) next(); else active -= 1;
}

function scheduleDelivery(id: string, key: string, logTag: string): void {
  if (queued >= QUEUE_MAX_TOTAL) {
    console.warn(`[${logTag} Webhook] 수신 줄이 가득 차 재처리 워커에 맡깁니다 id=${id}`);
    return;
  }
  queued += 1;
  const p = runSerial(`cdp-webhook:${key}`, async () => {
    await takeSlot();
    try {
      const [row] = await claimDeliveries({ ownId: id });
      if (row) await processClaimedDelivery(row, false);
    } catch (err: any) {
      console.error(`[${logTag} Webhook] 수신 줄 처리 오류 id=${id}:`, err?.message || err);
    } finally {
      giveSlot();
    }
  }).finally(() => { queued -= 1; pending.delete(p); });
  pending.add(p);
}

/** 시험 전용 — 줄에 올린 처리가 다 끝날 때까지 기다린다 */
export async function drainWebhookQueueForTest(): Promise<void> {
  while (pending.size) await Promise.all(Array.from(pending));
}

// ── 선점 · 처리 ─────────────────────────────────────────────────────────

export interface ClaimedDelivery {
  id: string;
  company_id: string;
  source: string;
  webhook_event: string;
  payload: any;
  retry_count: number;
  created_at: Date | string;
}

/**
 * 처리할 행을 잡는다 — 수신 줄 · 재처리 워커가 지나는 **유일한** 선점 문장(R1 · claimDeliveries 밖에서 received · failed 행을 처리 대상으로 읽지 않는다).
 *   ownId = 수신 줄이 방금 기록한 자기 행(아직 아무도 안 잡음) · limit = 재처리 워커 한 묶음.
 *   처리 가능 = received 이고 잡힌 적 없이 10분(또는 잡고 10분 지나도 끝나지 않음 = 프로세스가 죽음) /
 *             failed 이고 재시도가 남았고 마지막 시도에서 5분 지남. 나이로 버리지 않는다(이 표가 유일한 사본).
 */
export async function claimDeliveries(opts: { ownId: string } | { limit: number }): Promise<ClaimedDelivery[]> {
  const RETURNING = `RETURNING id, company_id, source, webhook_event, payload, retry_count, created_at`;
  if ('ownId' in opts) {
    const r = await query(
      `UPDATE cdp_webhook_deliveries SET processed_at = NOW()
        WHERE id = $1::uuid AND status = 'received' AND processed_at IS NULL
        ${RETURNING}`,
      [opts.ownId],
    );
    return r.rows;
  }
  const r = await query(
    `UPDATE cdp_webhook_deliveries SET processed_at = NOW()
      WHERE id IN (
        SELECT id FROM cdp_webhook_deliveries
         WHERE webhook_event <> 'oauth_state'
           AND (
                 (status = 'received' AND COALESCE(processed_at, created_at) < NOW() - INTERVAL '10 minutes')
              OR (status = 'failed' AND retry_count < $1 AND processed_at < NOW() - INTERVAL '5 minutes')
               )
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      ${RETURNING}`,
    [WEBHOOK_MAX_RETRY, opts.limit],
  );
  return r.rows;
}

/**
 * 잡은 행 하나를 처리하고 끝 상태를 쓴다(수신 줄 · 재처리 워커 공용 · 같은 어댑터 함수 · 같은 resource 규칙 · 같은 받은 시각).
 * isRetry = 재처리 워커가 잡은 행(실패하면 retry_count + 1 · 수신 줄의 첫 시도는 세지 않는다 = 옛 규칙 그대로).
 */
export async function processClaimedDelivery(row: ClaimedDelivery, isRetry: boolean): Promise<'processed' | 'superseded' | 'failed'> {
  const adapter = getProvider(row.source);
  if (!adapter) {
    await finishDelivery(row.id, 'failed', `재처리 불가: 미등록 source: ${row.source}`, true);
    return 'failed';
  }
  const resource = extractWebhookResource(row.source, row.payload || {});
  const mallId = String(row.payload?._mall_id ?? row.payload?.mall_id ?? '').trim();
  try {
    // 분류코드 조회 실패도 그 전달의 실패로 남긴다(잡은 채 빠져나가 10분 뒤까지 아무 기록이 없지 않게)
    const scope = mallId ? await integrationRowScopeOf(row.company_id, row.source, mallId) : { storeCode: null, idPrefix: null };
    const ctx: WebhookCtx = {
      observedAt: new Date(row.created_at).toISOString(),
      storeCode: scope.storeCode,
      idScope: { provider: row.source, mallId, idPrefix: scope.idPrefix },
    };
    const result = await adapter.processWebhookEvent(row.company_id, row.webhook_event, resource, ctx);
    const status = result === 'stale' ? 'superseded' : 'processed';
    await finishDelivery(row.id, status, null, false);
    return status;
  } catch (err: any) {
    // ★ 1028 K11 — 넣을 수 없는 건(휴대폰 없음 · 필수 칸 · 시각 형식)은 다시 해도 같다 → 처리됨 + 사유 한 줄(새 상태 없음 · 소진 경보로 가지 않음)
    if (classifyIngestError(err) === 'skip') {
      console.warn(`[CDP Webhook] 넣을 수 없는 건 건너뜀 (company ${row.company_id} · ${row.source}): ${err?.message || err}`);
      await finishDelivery(row.id, 'processed', `건너뜀: ${String(err?.message || 'unknown')}`.slice(0, 1000), false);
      return 'processed';
    }
    console.error(`[CDP Webhook] 이벤트 처리 실패 (company ${row.company_id} · ${row.source}):`, err?.message || err);
    await finishDelivery(row.id, 'failed', String(err?.message || 'unknown').slice(0, 1000), isRetry);
    return 'failed';
  }
}

async function finishDelivery(id: string, status: 'processed' | 'superseded' | 'failed', errorMessage: string | null, countRetry: boolean): Promise<void> {
  if (status === 'failed') {
    await query(
      `UPDATE cdp_webhook_deliveries
          SET status = 'failed', error_message = $2, processed_at = NOW(), retry_count = retry_count + $3
        WHERE id = $1::uuid`,
      [id, errorMessage, countRetry ? 1 : 0],
    );
    return;
  }
  await query(`UPDATE cdp_webhook_deliveries SET status = $2, processed_at = NOW(), error_message = $3 WHERE id = $1::uuid`, [id, status, errorMessage]);
}
