/**
 * CT: 미완료 환불 의무 기록 — ★ 2026-07-27 (B-0727-2)
 *
 * `prepaidRefund`는 단가 미상·DB 오류로 처리하지 못해도 throw하지 않고 `ok=false`로 돌아온다.
 * 그 상태로 캠페인을 종결하면 아무도 다시 보지 않는다 — 적재 0건이면 `status='failed'`라
 * 선불 sweeper 후보(`sending`/`completed`)에서도 빠지고, sweeper 산식은 처리수 0인 전량
 * 미적재를 구조적으로 손대지 않는다(refund-calc). 그래서 영구 미환불이 된다.
 *
 * 실패한 의무를 `campaigns.send_config.refundPending`에 남겨두면
 * `direct-send-worker`의 재시도 루프가 backoff를 두고 소진한다.
 * 기록 형식을 한 곳에 둔다 — 쓰는 쪽과 읽는 쪽의 키 이름이 어긋나면 의무가 조용히 사라진다.
 */
import { pool } from '../config/database';
import { getCampaignSmsTablesWide, smsCountAll, smsMsgTypeScopeSql } from './sms-queue';

export interface RefundPendingRecord {
  count: number;
  messageType: string;
  /**
   * ★ 2026-08-18 **원인 키**. 없으면 워커가 무조건 NOT_LOADED 항아리로 갚아,
   * 취소 보상(CANCEL)으로 생긴 채무가 엉뚱한 항아리에서 멱등 처리돼 사라진다.
   */
  refundKey?: string;
  at: string;
  attempts?: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
}

export function buildRefundPending(count: number, messageType: string, refundKey?: string): RefundPendingRecord {
  return { count, messageType, ...(refundKey ? { refundKey } : {}), at: new Date().toISOString() };
}

/**
 * 미적재 환불 실패를 캠페인에 남긴다. 기록 자체가 실패해도 발송 흐름을 막지 않는다
 * (막아봐야 이미 큐는 적재된 뒤다) — 로그로 남겨 사람이 찾을 수 있게 한다.
 */
export interface RefundAxis { count: number; messageType: string; refundKey?: string; }

/**
 * 실패한 환불 채무를 **축 단위로, 한 번에** 남긴다.
 *
 * ★ 2026-08-18 두 가지를 동시에 막는다.
 *  ① **보조 축 삭제** — 주 슬롯을 같은 축으로 갱신할 때 루트를 통째로 교체하면 `brand` 슬롯이 사라진다.
 *     (SMS 기록 → BRAND 기록 → SMS 재기록 순서에서 BRAND 채무가 증발한다)
 *  ② **워커와의 경합** — 축을 두 번에 나눠 쓰면, 그 사이에 워커가 첫 축만 담긴 스냅샷을 읽고
 *     소진 후 슬롯을 지워 두 번째 축이 사라진다. 그래서 행을 잠그고 **한 번의 UPDATE**로 쓴다.
 *
 * 축이 겹치면 건수는 **줄이지 않는다**(GREATEST) — 나중 호출이 더 작은 수를 들고 와도 채무는 최대치가 진실이다.
 * 지원 축은 2개(주 슬롯 + `brand` 보조). 읽는 쪽 `direct-send-worker`가 그 두 부분을 함께 소진한다.
 */
/**
 * 기존 의무(rp)에 새 축(wanted)을 합친 기록 — markRefundPendingAxes의 병합 규칙 그대로(★ 2026-09-26 V2 CRASH에서 순수 함수로 분리 · 동작 불변).
 * 같은 축·같은 키면 건수는 줄이지 않는다(GREATEST) · 축은 2개(주 슬롯 + brand) · 주 슬롯이 같은 축이면 재시도 상태 보존.
 * 합칠 것이 없으면 null.
 */
export function mergeRefundPendingSlots(
  rp: any,
  wanted: RefundAxis[],
  campaignId: string,
): { payload: Record<string, any>; slots: RefundAxis[] } | null {
  // 기존 슬롯을 축 목록으로 편다 — 주 슬롯의 재시도 상태(attempts·nextAttemptAt)는 보존한다.
  const slots: RefundAxis[] = [];
  if (rp?.messageType && Number(rp.count) > 0) slots.push({ count: Number(rp.count), messageType: String(rp.messageType), refundKey: rp.refundKey });
  if (rp?.brand?.messageType && Number(rp.brand.count) > 0) slots.push({ count: Number(rp.brand.count), messageType: String(rp.brand.messageType), refundKey: rp.brand.refundKey });

  for (const w of wanted) {
    const hit = slots.find((s) => s.messageType === w.messageType && (s.refundKey || '') === (w.refundKey || ''));
    if (hit) hit.count = Math.max(hit.count, w.count);
    else if (slots.length < 2) slots.push({ ...w });
    else console.error(`[환불의무][슬롯초과] campaign=${campaignId} 축 3개 이상 — ${w.messageType} ${w.count}건을 기록하지 못했다`);
  }
  if (slots.length === 0) return null;

  const next: RefundPendingRecord = {
    ...(rp && rp.messageType === slots[0].messageType ? rp : {}),   // 같은 축이면 backoff 상태 유지
    ...buildRefundPending(slots[0].count, slots[0].messageType, slots[0].refundKey),
    ...(rp?.attempts !== undefined && rp?.messageType === slots[0].messageType ? { attempts: rp.attempts, lastAttemptAt: rp.lastAttemptAt, nextAttemptAt: rp.nextAttemptAt } : {}),
  };
  const payload: Record<string, any> = { ...next };
  if (slots[1]) payload.brand = { count: slots[1].count, messageType: slots[1].messageType, ...(slots[1].refundKey ? { refundKey: slots[1].refundKey } : {}) };
  return { payload, slots };
}

export async function markRefundPendingAxes(campaignId: string, axes: RefundAxis[]): Promise<void> {
  const wanted = (axes || []).filter((a) => a && a.count > 0 && a.messageType);
  if (!campaignId || wanted.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT COALESCE(send_config, '{}'::jsonb) AS sc FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (cur.rows.length === 0) { await client.query('ROLLBACK'); return; }
    const sc = cur.rows[0].sc || {};
    const merged = mergeRefundPendingSlots(sc.refundPending || null, wanted, campaignId);
    if (!merged) { await client.query('ROLLBACK'); return; }
    const { payload, slots } = merged;

    await client.query(
      `UPDATE campaigns
          SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
              updated_at = NOW()
        WHERE id = $1`,
      [campaignId, JSON.stringify(payload)],
    );
    await client.query('COMMIT');
    console.warn(`[환불의무] campaign=${campaignId} ${slots.map((s) => `${s.messageType} ${s.count}건`).join(' + ')} 미완료 — 워커 재시도 대기 등록`);
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* 무시 */ }
    console.error(`[환불의무] campaign=${campaignId} 기록 실패:`, e?.message || e);
  } finally {
    client.release();
  }
}

export async function markRefundPending(campaignId: string, count: number, messageType: string, refundKey?: string): Promise<void> {
  return markRefundPendingAxes(campaignId, [{ count, messageType, refundKey }]);
}

/**
 * ★ 2026-09-26 한줄로 V2 CRASH(F08·m053·m123 · Codex 1R ①②) — 적재 0 고착 정산을 **의무로 넘긴다**(한 트랜잭션).
 *
 * 동기 발송 경로가 선불 차감 뒤 첫 큐 적재 전에 멈춘 캠페인(정산 스위퍼가 판정 · refund-calc `isZeroLoadShape`)을
 *   ① 실패로 종결한다(preparing이면 send_phase도 failed = 워커가 절대 집지 않는다)
 *   ② 실행 행 sending → failed(그 캠페인의 다음 발송을 막지 않게 · failCampaignRun과 같은 전이)
 *   ③ 축별 차감 건수를 refundPending으로 남긴다(markRefundPendingAxes와 같은 병합 · 원인 키는 호출부가 준다)
 *   ④ zeroLoadSettled 표식(스위퍼가 다시 세지 않게)
 * 넷을 한 UPDATE 묶음으로 커밋한다 — 상태를 먼저 바꾸고 환불을 나중에 하면 그 사이에 멈췄을 때 재시도 근거가 사라진다.
 * 갚는 것은 direct-send-worker `retryPendingRefunds`(전 축 성공까지 백오프 · 만료 없음 · prepaidRefund 멱등).
 *
 * 가드 — 잠근 뒤 다시 본다: sent_count 0 · send_phase 없음 또는 preparing · status sending/draft/failed · 아직 표식 없음.
 * 아니면 아무것도 하지 않고 false(그 사이 적재·종결됐다).
 */
export async function settleZeroLoadAsObligation(campaignId: string, axes: RefundAxis[]): Promise<boolean> {
  const wanted = (axes || []).filter((a) => a && a.count > 0 && a.messageType);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT COALESCE(send_config, '{}'::jsonb) AS sc, status, send_phase, COALESCE(sent_count, 0) AS sent
         FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    const row = cur.rows[0];
    const shapeOk = !!row
      && Number(row.sent) === 0
      && (row.send_phase == null || row.send_phase === 'preparing')
      && ['sending', 'draft', 'failed'].includes(String(row.status))
      && (row.sc || {}).zeroLoadSettled !== true;
    if (!shapeOk) { await client.query('ROLLBACK'); return false; }

    const merged = wanted.length > 0 ? mergeRefundPendingSlots((row.sc || {}).refundPending || null, wanted, campaignId) : null;
    // ★ Codex 2R ② — 재시도 워커가 갚기 직전에 원행을 다시 세게 한다(recheckZeroLoadObligation). 판정 뒤 늦게 들어온 동기 적재 대비.
    if (merged) merged.payload.verifyZeroLoad = true;
    const withMarker = `jsonb_set(COALESCE(send_config, '{}'::jsonb), '{zeroLoadSettled}', 'true'::jsonb)`;
    const sendConfigSql = merged ? `jsonb_set(${withMarker}, '{refundPending}', $2::jsonb)` : withMarker;
    await client.query(
      `UPDATE campaigns
          SET status = 'failed',
              send_phase = CASE WHEN send_phase = 'preparing' THEN 'failed' ELSE send_phase END,
              send_config = ${sendConfigSql},
              updated_at = NOW()
        WHERE id = $1`,
      merged ? [campaignId, JSON.stringify(merged.payload)] : [campaignId],
    );
    await client.query(
      `UPDATE campaign_runs SET status = 'failed', completed_at = COALESCE(completed_at, NOW())
        WHERE campaign_id = $1 AND status = 'sending'`,
      [campaignId],
    );
    await client.query('COMMIT');
    console.warn(`[환불의무][적재0고착] campaign=${campaignId} ${merged ? merged.slots.map((s) => `${s.messageType} ${s.count}건`).join(' + ') : '차감 0'} — 실패 종결 · 재시도 워커가 환불`);
    return true;
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* 무시 */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 적재 0 판정의 원행 수 — 전 라인·이력 · 상태 무관(집계 CT의 분류가 빼는 행까지 본다). "못 찾음"을 "안 보냄"으로 읽지 않는다.
 * 스위퍼의 넘기기 판정과 재시도 워커의 재확인이 **같은 문장**을 쓴다.
 */
export function countZeroLoadRawRows(tables: string[], campaignId: string): Promise<number> {
  return smsCountAll(tables, 'app_etc1 = ?', [campaignId]);
}

/**
 * ★ 2026-09-26 한줄로 V2 CRASH(Codex 2R ② · 3R ① · 4R ③) — 적재 0 의무를 갚기 직전 **축별** 재확인.
 * 판정(원행 0) 뒤 30분 넘게 멈췄던 동기 경로가 적재하면, 보낸 캠페인을 전액 환불하게 된다(동기 경로는 MySQL에 바로 넣어 PG 울타리가 없다).
 * both(문자 + 브랜드)는 한 축만 늦게 들어올 수 있다 — 전체 원행으로 의무 전체를 지우면 안 들어온 축의 환불까지 사라진다(3R ①).
 * 그래서 의무의 축마다(BRAND = 브랜드 행 · 그 외 = 브랜드 아닌 행 · 환불 축 분리와 같은 조건 smsMsgTypeScopeSql) 원행을 센다.
 * 테이블은 **그 캠페인의** 발송 기록 테이블 ∪ 회사 전 라인, 각각 캠페인 날짜 기준월 전후 이력(getCampaignSmsTablesWide) — 의무는 만료가 없어
 *   몇 달 뒤에 다시 볼 수 있다. "지금 기준 당월·전월"로 보면 그 달 이력을 못 봐 이미 나간 축을 원행 0으로 읽는다(4R ③).
 *   checked = loaded에 든 축은 늦은 적재가 있다 → 그 축은 갚지 않는다(호출부가 의무에서 빼서 저장 · 일반 정산이 차감 − 적재로 다시 잰다).
 *             loaded에 없는 축은 지금도 원행 0 → 갚는다.
 *   defer   = 셀 수 없다 → 갚지도 지우지도 않고 미룬다(돈은 틀린 자동보다 늦은 확정이 낫다)
 * 갚은 뒤에 들어온 적재는 일반 정산의 초과 환불 회수(4-3 · 정당 한도 = 차감 − 성공 − 대기)가 맞춘다.
 */
export async function recheckZeroLoadObligation(
  companyId: string,
  campaign: { id: string; created_by?: string | null; send_config?: any; sent_at?: any; scheduled_at?: any; created_at?: any },
  messageTypes: string[],
): Promise<{ verdict: 'checked'; loaded: string[] } | { verdict: 'defer'; error: string }> {
  try {
    const tables = await getCampaignSmsTablesWide(companyId, campaign);
    if (tables.length === 0) return { verdict: 'defer', error: '발송 테이블을 찾지 못했다' };
    const loaded: string[] = [];
    for (const type of messageTypes) {
      const scope = smsMsgTypeScopeSql(type === 'BRAND' ? 'brand' : 'nonBrand');
      const rows = await smsCountAll(tables, `app_etc1 = ? AND ${scope}`, [campaign.id]);
      if (rows > 0) loaded.push(type);
    }
    return { verdict: 'checked', loaded };
  } catch (e: any) {
    return { verdict: 'defer', error: `적재 재확인 실패: ${e?.message || e}` };
  }
}

/**
 * 의무 기록(주 슬롯 + brand 보조 슬롯)에서 원행이 들어온 축을 뺀 기록 — ★ 4R ③ 뺀 결과를 저장해야 미뤄진 뒤에도 되살아나지 않는다.
 * 주 슬롯이 빠지고 brand가 남으면 brand를 주 슬롯으로 올린다(원인 키도 brand 것으로 · 없으면 지운다). 재시도 상태(attempts 등)·표식은 그대로.
 * 남는 축이 없으면 null(의무를 지운다).
 */
export function dropRefundPendingAxes(rp: any, loaded: string[]): Record<string, any> | null {
  const drop = new Set(loaded);
  const primaryGone = !!rp?.messageType && drop.has(String(rp.messageType));
  const brand = rp?.brand && Number(rp.brand.count) > 0 && rp.brand.messageType ? rp.brand : null;
  const brandGone = !!brand && drop.has(String(brand.messageType));
  if (!primaryGone && !brandGone) return rp;
  const { brand: _omit, ...root } = rp || {};
  if (!primaryGone) return root;                     // brand만 빠졌다
  if (!brand || brandGone) return null;              // 남는 축이 없다
  const { refundKey: _k, ...rest } = root;
  return { ...rest, count: Number(brand.count), messageType: String(brand.messageType), ...(brand.refundKey ? { refundKey: brand.refundKey } : {}) };
}
