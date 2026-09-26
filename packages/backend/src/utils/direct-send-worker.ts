/**
 * ★ 대량 발송 worker (2026-05-30) — staging 청크 발송 + 진행률
 *
 * commit이 정제(수신거부/중복제거)를 끝낸 campaign_send_staging을 청크(1만)씩 처리.
 * 기존 worker 패턴(setInterval 5초) + commit 직후 즉시 트리거.
 * Node 블로킹 0(청크마다 이벤트루프 양보), idempotent(processed_count OFFSET).
 */
import { query } from '../config/database';
import { prepareFieldMappings, getOpt080Number } from './messageUtils';
import { prepaidRefund, REFUND_KEYS } from './prepaid';
import { buildRefundPending } from './refund-pending';
import { getCampaignQueueTables, smsCountAll } from './sms-queue';
import { getCompanySmsTables, smsExecAll, toKoreaTimeStr } from './sms-queue';
import { calcSplitSendTime } from './send-time-util';
import { processSendChunk, type ChunkRecipient } from './direct-send-processor';
// ★2026-09-02 브랜드 이미지 preflight(AI 판정 → 카카오 URL 치환) — 캠페인당 한 번
import { prepareBrandAttachmentForSend } from './brand-message';
// ★ 2026-07-30 환불 축 판정 — 차감(direct-send-core)과 같은 CT
import { resolveRefundAxes, isBrandOnlyChannel } from './billing-types';
import { sendSystemAlert } from './system-alert';
// ★ 2026-09-26 한줄로 V2 F10·F31·F32 — 대행 취소(queueOnly)의 적재 중단 표식도 취소로 본다(CT 하나).
import { isLoadStopped, isLoadingSendPhase, NOT_LOAD_STOPPED_SQL, LOAD_CANCELLED_SELECT, LOADING_SEND_PHASES_SQL } from './load-cancel';
// ★ 2026-09-26 (Codex 4차 5R) 취소 의무 쓰기 직렬화(취소 CT와 같은 잠금)
import { withCancelObligationLock } from './keyed-lock';
// ★ 2026-09-26 한줄로 V2 F19 — 개별 회신번호 등록 검사(동기 경로와 같은 CT)
import { filterByIndividualCallback, callbackAssignmentUserId } from './callback-filter';
// ★ 2026-09-26 한줄로 V2 F35(Codex 4차 1R A) — 취소 정산 공용 CT(취소 CT·재시도 워커·이 워커가 같은 산식)
import { countCampaignRows, settleCancelledLoadRefund, settleCancelOutcome, campaignRefDates, CANCEL_SETTLE_MODE } from './cancel-settle';

const CHUNK = 10000;
let running = false;
// ★ 2026-07-31 (10R): preparing 잔존 경보 — 미종료 작업 1개 상한(in-flight, settle 시에만 해제)
//   + 시도 간 최소 간격 10분. hang이면 그 1개가 복구 시 유일한 발송이 된다(누적·폭주 구조 불가).
let _preparingAlertInFlight = false;
let _preparingAlertLastAttemptMs = 0;

/**
 * ★ 2026-07-27 (B-0727-1): 미완료 환불 재시도.
 * prepaidRefund가 단가 미상·DB 오류로 처리하지 못하면 워커가 send_config.refundPending에 남긴다.
 * 그 캠페인은 종결 상태라 다른 어떤 워커도 다시 보지 않으므로(sweeper는 처리수 0인 전량 미적재를
 * 구조적으로 손대지 않는다) 여기서 되돌아와야 미환불이 영구화되지 않는다.
 * prepaidRefund는 누적 목표 기준 idempotent라 여러 번 불려도 이중 환불이 없다.
 */
/**
 * ★ 2026-07-27 (B-0727-2): 취소 환불 의무 재시도.
 * 취소는 MySQL 대기 행을 지운 뒤 환불하므로, 환불이 실패하면 "얼마를 돌려줘야 했는지"가 사라진다.
 * 그래서 cancelCampaign이 **지우기 전에** send_config.refundPendingCancel에 몫을 남긴다. 여기서 그걸 소진한다.
 * 키가 'cancel'이라 같은 항아리 기준 멱등 — 여러 번 불려도 이중 환불이 없다.
 */
/**
 * ★ 2026-09-26 한줄로 V2 (Codex 4차 5R) — 취소 환불 의무 캠페인 하나를 처리한다(본문은 옛 재시도 루프 그대로 · continue → return).
 * 호출부가 캠페인 단위 취소 의무 잠금 안에서 의무를 **다시 읽은** 행을 넘긴다 — 옛 의무를 읽은 뒤 취소 CT가 새 의무로 덮는 경합이 없다.
 */
async function processCancelObligation(row: any): Promise<void> {
  const rp = row.rp || {};
  let tables: string[] = [];
  // ★ prepared = 큐 삭제 전에 남긴 의무. 아직 안 지워진 큐를 두고 환불하면 환불 후 실발송이 된다.
  //   ready 전환 UPDATE가 실패해 prepared로 남은 경우를 위해, 실제 대기 행이 0인지 직접 확인해 승격시킨다.
  if (rp.state !== 'ready') {
    try {
      tables = await getCampaignQueueTables(row.company_id, row.created_by || undefined, row.send_config);
      const stillPending = await smsCountAll(tables, 'app_etc1 = ? AND status_code = 100', [row.id]);
      if (stillPending > 0) return;   // 삭제가 끝나지 않았다 — 환불하지 않는다
      await query(
        `UPDATE campaigns SET send_config = jsonb_set(send_config, '{refundPendingCancel,state}', '"ready"'::jsonb),
                updated_at = NOW() WHERE id = $1`,
        [row.id],
      );
      console.log(`[direct-send-worker] 취소 환불 의무 승격(prepared→ready) campaign=${row.id}`);
    } catch (e: any) {
      console.error(`[direct-send-worker] 취소 의무 승격 확인 실패 campaign=${row.id}:`, e?.message || e);
      return;
    }
  }
  const clear = () => query(
    `UPDATE campaigns SET send_config = send_config - 'refundPendingCancel', updated_at = NOW() WHERE id = $1`,
    [row.id],
  ).catch(() => {});
  const defer = () => {
    const attempts = Number(rp.attempts || 0);
    const backoffMin = Math.min(60, 2 ** Math.min(attempts, 5));
    return query(
      `UPDATE campaigns SET send_config = jsonb_set(send_config, '{refundPendingCancel}', $2::jsonb), updated_at = NOW() WHERE id = $1`,
      [row.id, JSON.stringify({
        ...rp,
        state: 'ready',   // 여기까지 왔으면 승격은 끝난 상태 — 다음 사이클이 다시 확인하지 않게 고정
        attempts: attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + backoffMin * 60_000).toISOString(),
      })],
    ).catch(() => {});
  };
  // ★ 2026-09-26 한줄로 V2 F35(Codex 4차 1R A) — 상태를 바꾸는 취소의 의무는 건수가 아니라 "사실로 다시 정산하라"다.
  //   취소 CT와 같은 CT로 결말을 다시 가른다(대기를 떠난 행이 있으면 발송 캠페인으로 넘김 · 없으면 취소 확정 + 전체 기준 환불).
  //   취소가 상태를 확정하기 전에 끊겼어도 여기서 같은 답이 나온다. 전체 기준 환불은 같은 목표 재호출 = 멱등.
  if (rp.mode === CANCEL_SETTLE_MODE) {
    let settled: { ok: boolean } = { ok: false };
    try {
      if (tables.length === 0) tables = await getCampaignQueueTables(row.company_id, row.created_by || undefined, row.send_config);
      settled = await settleCancelOutcome({ camp: row, liveTables: tables, refDates: campaignRefDates(row) });
    } catch (e: any) {
      console.error(`[direct-send-worker] 취소 정산 재시도 오류 campaign=${row.id}:`, e?.message || e);
    }
    if (settled.ok) { await clear(); return; }
    await defer();
    return;
  }
  // ★ 2026-07-30: 브랜드 슬롯(brand·BRAND 축) 추가 — 옛 kakao 슬롯은 하위호환으로 함께 읽는다(항상 0이었음).
  const parts = [rp.sms, rp.brand, rp.kakao].filter((p: any) => p && Number(p.count) > 0);
  if (parts.length === 0) { await clear(); return; }
  let allOk = true;
  for (const part of parts) {
    try {
      // 최초 호출과 **같은 옵션**으로 부른다. 키 항아리에서는 mode가 무시되어 멱등이고,
      // 키 이전 환불이 있는 레거시 캠페인에서는 최초 호출처럼 추가 환불로 동작한다
      //   — 재시도만 누적 목표로 계산하면 기존 환불이 더 커서 취소분이 통째로 사라진다.
      const res = await prepaidRefund(
        row.company_id, Number(part.count), String(part.messageType), row.id, '예약 취소 환불(재시도)',
        'campaign', { refundKey: REFUND_KEYS.CANCEL, forceKeyedPot: true },
      );
      if (!res.ok) allOk = false;
      else if (res.refunded > 0) console.log(`[direct-send-worker] 취소 환불 재시도 성공 campaign=${row.id} ${res.refunded}원`);
    } catch (e: any) {
      allOk = false;
      console.error(`[direct-send-worker] 취소 환불 재시도 오류 campaign=${row.id}:`, e?.message || e);
    }
  }
  if (allOk) { await clear(); return; }
  await defer();
}

async function retryPendingCancelRefunds(): Promise<void> {
  try {
    // 실패가 굳은 몇 건이 매 사이클 LIMIT을 점유해 뒤 의무를 굶기지 않도록, 미적재 재시도와 같은
    // due-time(backoff) 방식으로 집는다.
    const rows = await query(
      `SELECT id, company_id, created_by, status, send_channel, message_type, created_at, scheduled_at, send_phase, send_config,
              send_config->'refundPendingCancel' AS rp
         FROM campaigns
        WHERE send_config ? 'refundPendingCancel'
          AND COALESCE((send_config->'refundPendingCancel'->>'nextAttemptAt')::timestamptz, TIMESTAMPTZ '-infinity') <= NOW()
          -- ★ 2026-09-26 (Codex 4차 3R) 적재 중인 캠페인의 정산 모드 의무는 한도 적용 전에 뺀다 — 결말은 적재를 멈춘 워커가 먼저 정하고,
          --   여기 남겨 두면 적재 복구를 기다리는 의무가 LIMIT을 점유해 다른 회사 환불 재시도를 굶긴다.
          AND NOT (send_config->'refundPendingCancel'->>'mode' = '${CANCEL_SETTLE_MODE}' AND COALESCE(send_phase, '') IN (${LOADING_SEND_PHASES_SQL}))
        ORDER BY COALESCE((send_config->'refundPendingCancel'->>'nextAttemptAt')::timestamptz, TIMESTAMPTZ '-infinity') ASC
        LIMIT 20`
    );
    for (const cand of rows.rows) {
      // ★ 2026-09-26 (Codex 4차 5R) 캠페인 단위 취소 의무 잠금 안에서 의무를 **다시 읽고** 처리한다. 후보 조회 뒤 취소 CT가
      //   의무를 새로 덮었으면(건수형 → 정산 모드) 새 의무로 처리한다 — 옛 스냅샷으로 해제·연기하면 새 의무가 사라지거나 되돌려졌다.
      await withCancelObligationLock(cand.id, async () => {
        const fresh = await query(
          `SELECT id, company_id, created_by, status, send_channel, message_type, created_at, scheduled_at, send_phase, send_config,
                  send_config->'refundPendingCancel' AS rp
             FROM campaigns WHERE id = $1 AND send_config ? 'refundPendingCancel'`,
          [cand.id],
        );
        const row = fresh.rows[0];
        if (!row) return;   // 그 사이 해제됐다
        // 적재 중 정산 모드는 적재 주체가 먼저 정한다(후보 조회와 같은 조건 — 잠금을 기다리는 사이 새 의무로 바뀌었을 수 있다)
        if (row.rp?.mode === CANCEL_SETTLE_MODE && isLoadingSendPhase(row.send_phase)) return;
        await processCancelObligation(row);
      });
    }
  } catch (e: any) {
    console.error('[direct-send-worker] 취소 환불 재시도 조회 실패:', e?.message || e);
  }
}

async function retryPendingRefunds(): Promise<void> {
  try {
    // ★ 만료 없음 — 돈 채무에 유효기간을 두지 않는다. 대신 시도 간격(backoff)으로 부하를 제어한다.
    //   `nextAttemptAt` 순으로 집어야 실패가 굳은 몇 건이 LIMIT을 영구 점유해 뒤 채무를 굶기지 않는다.
    // 취소 환불 의무(refundPendingCancel)를 먼저 정리한다 — 취소 캠페인은 sweeper 보정 대상이 아니라
    // 여기서 되살리지 않으면 영구 미환불이다. 키가 'cancel'이라 반복 호출해도 그 항아리 안에서 멱등이다.
    await retryPendingCancelRefunds();
    const pending = await query(
      `SELECT id, company_id, send_config->'refundPending' AS rp
         FROM campaigns
        WHERE send_config ? 'refundPending'
          AND COALESCE((send_config->'refundPending'->>'nextAttemptAt')::timestamptz, TIMESTAMPTZ '-infinity') <= NOW()
        ORDER BY COALESCE((send_config->'refundPending'->>'nextAttemptAt')::timestamptz, TIMESTAMPTZ '-infinity') ASC
        LIMIT 20`
    );
    for (const row of pending.rows) {
      const rp = row.rp || {};
      const count = Number(rp.count || 0);
      const messageType = String(rp.messageType || '');
      const attempts = Number(rp.attempts || 0);
      // ★ 2026-08-18 CAS — 읽은 스냅샷이 그대로일 때만 지운다.
      //   축이 둘인 채무(주 슬롯 + brand)는 요청 쪽이 한 번에 쓰지만, 이 워커가 읽은 **뒤에**
      //   같은 캠페인에 축이 더해질 수 있다. 조건 없이 지우면 아직 안 갚은 축이 사라진다.
      const snapshot = JSON.stringify(rp);
      const clear = () => query(
        `UPDATE campaigns SET send_config = send_config - 'refundPending', updated_at = NOW()
          WHERE id = $1 AND send_config->'refundPending' = $2::jsonb`,
        [row.id, snapshot],
      ).catch(() => {});
      // 다음 시도까지 대기 — 2분에서 시작해 최대 60분. 같은 건이 매 사이클을 잡아먹지 않게 한다.
      const backoffMin = Math.min(60, 2 ** Math.min(attempts, 5));
      const defer = (err?: string) => query(
        `UPDATE campaigns
            SET send_config = jsonb_set(send_config, '{refundPending}', $2::jsonb),
                updated_at = NOW()
          WHERE id = $1 AND send_config->'refundPending' = $3::jsonb`,
        [row.id, JSON.stringify({
          ...rp,
          attempts: attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          nextAttemptAt: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          ...(err ? { lastError: err.slice(0, 200) } : {}),
        }), snapshot],
      ).catch(() => {});
      // ★ 2026-07-30: both의 두 원장이 모두 실패한 경우 brand 보조 슬롯이 함께 남는다 — 둘 다 소진해야 해제.
      // ★ 2026-08-18 원인 키(refundKey)를 기록대로 쓴다 — 없으면 NOT_LOADED로 폴백(옛 기록 호환).
      //   취소 보상(CANCEL)으로 생긴 채무를 NOT_LOADED 항아리로 갚으면 엉뚱한 항아리에서 멱등 처리돼 사라진다.
      const parts: Array<{ count: number; messageType: string; refundKey: string }> = [
        { count, messageType, refundKey: String(rp.refundKey || REFUND_KEYS.NOT_LOADED) },
        ...(rp.brand && Number(rp.brand.count) > 0
          ? [{ count: Number(rp.brand.count), messageType: String(rp.brand.messageType || ''), refundKey: String(rp.brand.refundKey || REFUND_KEYS.NOT_LOADED) }]
          : []),
      ].filter((p) => p.count > 0 && p.messageType);
      if (parts.length === 0) { await clear(); continue; }
      try {
        let allOk = true;
        for (const part of parts) {
          const res = await prepaidRefund(
            row.company_id, part.count, part.messageType, row.id, `대량 발송 미적재 ${part.count}건 자동 환불(재시도)`,
            'campaign', { refundKey: part.refundKey },
          );
          if (!res.ok) allOk = false;
          else if (res.refunded > 0) {
            console.log(`[direct-send-worker] 미적재분 환불 재시도 성공 campaign=${row.id} ${part.messageType} ${res.refunded}원`);
          }
        }
        if (allOk) await clear();
        else await defer('prepaidRefund ok=false');
      } catch (e: any) {
        console.error(`[direct-send-worker] 환불 재시도 오류 campaign=${row.id}:`, e?.message || e);
        await defer(String(e?.message || e));
      }
    }
  } catch (e: any) {
    console.error('[direct-send-worker] 환불 재시도 조회 실패:', e?.message || e);
  }
}

/**
 * ★ 2026-09-25 C-11: 끊긴 적재의 적재 수 실측. 워커 메모리 카운트(sent·brandSent)와 같은 정의로 돌려준다.
 *   both = 문자 축(비F) + 브랜드 축(F) 따로 · 브랜드 전용 = 둘 다 전체 · 그 밖 = 전체(브랜드 0).
 */
async function measureLoadedRows(
  companyId: string, userId: string, campaignId: string, sendChannel: string, companyTables: string[], refDates: Date[],
): Promise<{ sent: number; brandSent: number }> {
  if (String(sendChannel || '').trim() === 'both') {
    return {
      sent: await countCampaignRows(companyId, userId, campaignId, companyTables, 'nonBrand', refDates, 'loaded'),
      brandSent: await countCampaignRows(companyId, userId, campaignId, companyTables, 'brand', refDates, 'loaded'),
    };
  }
  const all = await countCampaignRows(companyId, userId, campaignId, companyTables, 'all', refDates, 'loaded');
  return isBrandOnlyChannel(sendChannel) ? { sent: all, brandSent: all } : { sent: all, brandSent: 0 };
}

/** queued 캠페인을 순차 처리 (동시 진입 방지 플래그) */
export async function runDirectSendOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // ★ 2026-09-25 한줄로 전수점검 C-11: 적재 중(processing) 프로세스가 죽으면(배포 reload·OOM 재시작) 그 캠페인을
    //   되돌리는 코드가 없었다 — 나머지 미발송 · 선차감 미적재분 미환불 · 화면 "발송 중" 고정.
    //   `running` 가드로 이 프로세스의 적재와 겹치지 않고, 적재 루프는 청크마다 updated_at을 갱신하므로
    //   10분 넘게 멈춘 processing은 주인 없는 적재다. 이어서 적재하지 않는다(마지막 청크 적재·processed_count 기록 사이에
    //   죽었으면 그 청크가 두 번 나간다) — MySQL 실측 적재 수로 종결해 적재분은 발송, 나머지는 미적재 환불.
    const orphans = await query(
      `SELECT id FROM campaigns
        WHERE send_phase = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'
        ORDER BY updated_at ASC LIMIT 5`
    );
    for (const row of orphans.rows) {
      try {
        await processCampaign(row.id, 'recover');
      } catch (e: any) {
        console.error(`[direct-send-worker] 캠페인 ${row.id} 끊긴 적재 정리 실패:`, e?.message || e);
      }
    }

    // ★ 2026-09-25 C-10: 적재 전에 취소된 queued도 집는다. 옛 조건(status != 'cancelled')은 취소된 캠페인을 영영 집지 않아
    //   선차감 전액이 환불되지 않았다(취소는 큐 대기 행 수만 환불 — 적재 전이면 0건). 집으면 적재 없이 종결 블록으로 간다.
    const due = await query(
      `SELECT id FROM campaigns WHERE send_phase = 'queued' ORDER BY created_at ASC LIMIT 5`
    );
    for (const row of due.rows) {
      try {
        await processCampaign(row.id);
      } catch (e: any) {
        console.error(`[direct-send-worker] 캠페인 ${row.id} 처리 실패:`, e);
        // ★ 2026-07-27 (B-0727-1): 여기는 최후 안전망이다. 적재 중 예외는 processCampaign 안에서 잡아
        //   정상 종결 블록(환불·건수·staging 정리)을 태우므로, 이 catch까지 오는 건 종결 블록 자체가 실패한 경우뿐.
        //   그때는 환불·집계가 수렴하지 않으므로 사유를 남겨 사람이 찾을 수 있게 한다.
        //   ⛔ status는 건드리지 않는다 — failed로 바꾸면 예약 캠페인이 예약 목록·취소 게이트(scheduled/draft만 허용)
        //   에서 빠지는데 이미 적재된 큐 행은 예약 시각에 그대로 나간다(취소 불가).
        //   ⛔ `send_phase IS DISTINCT FROM 'sent'` 가드 필수 — 종결 UPDATE는 성공했는데 그 뒤 staging 삭제만
        //   실패해도 여기로 온다. 가드가 없으면 정상 종결된 'sent'를 'failed'로 강등해, 실제로 나간 발송이
        //   후불 집계(send_phase='sent' AND status='completed')와 선불 sweeper에서 통째로 빠진다.
        // ★ 2026-09-25 C-10 (Codex 2R high): 취소된 캠페인은 failed로 바꾸지 않는다 — processing으로 남아야
        //   끊긴 적재 정리(recover · 10분)가 캠페인 전체 기준으로 다시 정산한다. failed가 되면 아무도 다시 보지 않아
        //   선차감이 영구 미환불로 남는다(적재 전 취소는 취소 경로의 환불도 0건이다).
        // ★ 2026-09-26 한줄로 V2 F02·F37: 취소 여부와 무관하게 **어떤 캠페인도** failed로 바꾸지 않는다.
        //   적재 루프 앞(적재 테이블·필드 매핑·브랜드 이미지 준비·정제)이나 뒤(종결 전 조회)에서 난 예외가 여기로 오는데,
        //   failed는 recover(processing만)·sweeper('sent'·NULL만)·환불 재시도(refundPending만) 누구도 다시 보지 않아
        //   선차감 전액이 영구 미환불로 굳었다. 단계를 그대로 두면 queued는 다음 주기에 다시 선점되고,
        //   processing은 10분 뒤 recover가 MySQL 실측 적재 수로 종결한다(적재분은 발송 · 나머지는 미적재 환불).
        //   사유만 남긴다 — updated_at 갱신이 recover의 10분 대기를 여기서부터 다시 센다.
        const failure = JSON.stringify({
          at: new Date().toISOString(),
          reason: String(e?.message || e).slice(0, 300),
        });
        await query(
          `UPDATE campaigns
              SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{failure}', $2::jsonb),
                  updated_at = NOW()
            WHERE id = $1 AND send_phase IS DISTINCT FROM 'sent'`,
          [row.id, failure],
        ).catch(() => {});
      }
    }
    // ★ 2026-07-27 (B-0727-1): 미완료 환불 재시도는 **신규 발송 처리 뒤**에 돈다.
    //   앞에 두면 밀린 환불 재시도가 발송 적재를 지연시킨다(발송이 늦는 편이 더 눈에 띄는 사고).
    await retryPendingRefunds();
    // ★ 2026-07-30 (3R): 'preparing' 잔존 감시 — commit이 차감 도중 죽으면 캠페인이 preparing으로 남는다.
    //   발송은 구조적으로 불가(fail-closed)지만 차감 여부가 불명이라 자동 환불하지 않는다 —
    //   돈은 틀린 자동보다 미확정+사람이 낫다.
    // ★ 2026-07-31 (6R 구조 정정): 행 단위 "정확한 1회 경보"를 best-effort 경보 인프라 위에 쌓으려던
    //   마커·Set 구조를 폐기했다 — 4R(기아)·5R(미전달 마킹)·6R(적재 실패 오인·쿨다운 미수렴·점유) 세 라운드
    //   연속으로 같은 부류가 샜다. 감시의 목적은 "발견"이지 행별 전달 보장이 아니다.
    //   **개수만 센다**: 잔존이 있으면 단일 dedupKey로 경보 — 쿨다운(전 인프라 공통)이 중복을 누르고,
    //   미전달이면 다음 쿨다운 창에서 자동 재경보된다(잔존이 남아 있는 한 COUNT>0이므로 수렴).
    //   행 목록은 경보를 받은 사람이 SQL로 뽑는다. 사이클당 COUNT 1회라 워커 점유도 상한이 명확하다.
    try {
      const stale = await query(
        `SELECT COUNT(*)::int AS cnt, MIN(created_at) AS oldest
           FROM campaigns
          WHERE send_phase = 'preparing' AND created_at < NOW() - INTERVAL '10 minutes'`,
      );
      const staleCnt = Number(stale.rows[0]?.cnt || 0);
      // ★ 2026-07-31 (7R): 경보는 동시 1개만(in-flight 가드) — 경보 MySQL이 지연되는 동안 다음 사이클이
      //   겹쳐 쌓이지 않게 한다. 안내 SQL은 감시와 **같은 10분 조건**으로 제한 — 전 preparing을 보여주면
      //   정상 차감 진행 중인 신규 캠페인이 섞여 운영자 수동 조치가 실제 활성화와 경합한다.
      //   (경보 적재 실패 시 쿨다운 창만큼 재경보가 늦는 것은 잔여 한계로 수용 — 잔존이 남는 한
      //    COUNT>0이라 다음 창에 반드시 재경보되고, 발생 시점의 direct-deduct-orphan 경보·CRITICAL 로그가 1차 신호다.)
      // ★ 2026-07-31 (10R 확정 구조): **미종료 작업 1개 상한 + 시도 간격 10분**.
      //   - in-flight 가드는 settle(성공·실패)에서만 해제 — hang이어도 미종료 작업은 정확히 1개이고,
      //     그 1개가 MySQL 복구 시 유일한 발송이 된다(누적·복구 폭주 구조 불가 — 9R·10R).
      //   - hang 중 감시가 새 시도를 안 하는 것은 결함이 아니다: 이미 떠 있는 작업이 곧 배달될 경보다.
      //     rejection으로 끝나면 catch가 소비하고 가드가 풀려 다음 10분 창에 재시도된다(8R).
      //   - 정상 상태에선 공통 쿨다운이 실발송을 1회로 누른다. MySQL 드라이버 취소 배관은 별도 과제.
      if (staleCnt > 0 && !_preparingAlertInFlight && Date.now() - _preparingAlertLastAttemptMs > 10 * 60 * 1000) {
        _preparingAlertInFlight = true;
        _preparingAlertLastAttemptMs = Date.now();
        void sendSystemAlert({
          dedupKey: 'direct-preparing-stale',
          message: `직접발송 preparing 잔존 ${staleCnt}건(최고령 ${stale.rows[0]?.oldest}) — 차감 여부 수동 확인 필요(발송은 차단된 상태). 목록: SELECT id, company_id, created_at FROM campaigns WHERE send_phase = 'preparing' AND created_at < NOW() - INTERVAL '10 minutes' ORDER BY created_at`,
        }).catch((alertErr: any) => {
          console.error('[direct-send-worker] preparing 잔존 경보 실패:', alertErr?.message || alertErr);
        }).finally(() => { _preparingAlertInFlight = false; });
      }
    } catch (staleErr: any) {
      console.error('[direct-send-worker] preparing 잔존 감시 오류:', staleErr?.message || staleErr);
    }
  } finally {
    running = false;
  }
}

/**
 * mode
 *  - 'normal'  : queued → processing 선점 후 적재. 적재 전에 이미 취소됐으면(C-10) 적재 없이 종결 블록으로 간다.
 *  - 'recover' : 10분 넘게 멈춘 processing(주인 없는 적재 · C-11)을 다시 선점해 **적재하지 않고** 종결한다.
 *                적재 수는 MySQL 실측(결과 이력 + 라이브 대기 · 선불 sweeper와 같은 산식)으로 잡는다.
 */
async function processCampaign(campaignId: string, mode: 'normal' | 'recover' = 'normal'): Promise<void> {
  // queued → processing claim (동시 처리/중복 발송 방지)
  // ★ 2026-09-25 C-10: 취소 여부로 거르지 않는다 — 취소된 queued도 선점해 적재 없이 종결(선차감 환불)한다.
  const claim = mode === 'recover'
    ? await query(
        `UPDATE campaigns SET updated_at = NOW()
         WHERE id = $1 AND send_phase = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes'
         RETURNING company_id, created_by, target_count, processed_count, staging_id, send_config, status, created_at, scheduled_at`,
        [campaignId]
      )
    : await query(
        `UPDATE campaigns SET send_phase = 'processing', updated_at = NOW()
         WHERE id = $1 AND send_phase = 'queued'
         RETURNING company_id, created_by, target_count, processed_count, staging_id, send_config, status, created_at, scheduled_at`,
        [campaignId]
      );
  if (claim.rows.length === 0) return; // 다른 사이클이 선점
  const c = claim.rows[0];
  const companyId: string = c.company_id;
  const userId: string = c.created_by;
  const stagingId: string = c.staging_id;
  const cfg: any = c.send_config || {};
  const total: number = c.target_count || 0;
  // ★ 2026-09-26 F10·F31·F32: 대행 취소는 상태를 안 바꾸고 적재 중단 표식을 남긴다 — 둘 다 취소다.
  const cancelledAtClaim = isLoadStopped(c.status, cfg.loadCancelled);
  // 큐·이력 행을 셀 기준월 — 생성일과 예약일(있으면). 끊긴 적재 실측 · 취소 정산이 쓴다(CT).
  const refDates: Date[] = campaignRefDates(c);
  // 적재 루프를 돌지 않는 경우 = 끊긴 적재 정리 · 적재 전에 이미 취소됨
  const skipLoad = mode === 'recover' || cancelledAtClaim;

  // ★ 2026-06-11 씨앗 제거: 실제 적재 테이블을 send_config.sentTables에 기록 —
  //   라인그룹이 이후 재배정되어도 취소/검증/안전망이 발송 당시 테이블을 직접 보게 한다.
  // ★ 2026-09-25 C-11: 끊긴 적재 정리는 죽은 프로세스가 적어 둔 sentTables를 그대로 쓴다(그 사이 라인이 바뀌었을 수 있다).
  const recordedTables: string[] = Array.isArray(cfg.sentTables) ? cfg.sentTables.filter((t: any) => typeof t === 'string' && t) : [];
  const companyTables = mode === 'recover' && recordedTables.length > 0
    ? recordedTables
    : await getCompanySmsTables(companyId, userId);
  if (!(mode === 'recover' && recordedTables.length > 0)) {
    await query(
      `UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{sentTables}', $1::jsonb), updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(companyTables), campaignId]
    );
  }
  // ★ 2026-09-26 F02·F37: 적재에만 쓰는 준비는 적재할 때만 한다 — recover(끊긴 적재 정리)가 여기서 막히면
  //   정산을 영영 못 해 선차감이 미환불로 남는다. 적재 루프는 skipLoad면 첫 줄에서 빠지므로 이 값을 쓰지 않는다.
  const directFieldMappings: Awaited<ReturnType<typeof prepareFieldMappings>> = skipLoad ? {} : await prepareFieldMappings(companyId);
  const finalIsAd = cfg.adEnabled === true;
  const opt080 = finalIsAd && !skipLoad ? await getOpt080Number(userId || null, companyId) : '';
  // ★ 2026-09-26 F19(Codex 4차 1R) — 개별 회신번호 배정 제한을 걸 사용자(관리자 = 제한 없음 · 동기 경로와 같은 CT).
  //   작성자 유형은 캠페인당 한 번 읽는다. users에 없는 작성자(슈퍼관리자 계정)는 역할을 몰라 CT가 본인 기준으로 걸지만,
  //   그 id로 배정된 번호가 없어 'assigned' 번호만 빠진다 — 회사 등록 여부(법적 요건)는 그대로 검사된다.
  const callbackFilterUserId = cfg.useIndividualCallback && !skipLoad
    ? callbackAssignmentUserId((await query(`SELECT user_type FROM users WHERE id = $1`, [userId])).rows[0]?.user_type, userId)
    : undefined;
  const useNow = !cfg.scheduled && !(cfg.splitEnabled && cfg.splitCount > 0);

  // ★2026-09-02(2) 브랜드 이미지 preflight — **청크 루프 밖에서 캠페인당 한 번**이다.
  //   Codex 2R high3: 청크마다 돌리면 같은 이미지를 청크 수만큼 올린다(processSendChunk는
  //   CHUNK 단위로 반복 호출된다). 판정(AI 생성 여부)도 캠페인 단위 값이라 한 번이면 된다.
  //   ⛔ 여기서 던지면 아래 루프에 들어가지 않고 실행이 중단된다 — 캠페인은 processing으로 남고(★0926 F02·F37 바깥 catch)
  //      10분 뒤 끊긴 적재 정리가 실측 적재 수(0)로 종결해 선차감을 미적재 환불로 되돌린다(recover는 이 준비를 건너뛴다).
  //   적재하지 않는 경우(skipLoad)는 올릴 이유가 없다.
  const brandPreflight = !skipLoad && (cfg.sendChannel === 'kakao' || cfg.sendChannel === 'both')
    ? await prepareBrandAttachmentForSend({
        companyId,
        userId: userId || null,
        bubbleType: cfg.kakaoBubbleType || 'TEXT',
        attachmentJson: cfg.kakaoAttachmentJson || null,
      })
    : { attachmentJson: (cfg.kakaoAttachmentJson || null), aiGenerated: false };

  let processed: number = c.processed_count || 0;
  let sent = 0;
  let brandSent = 0;   // ★ 2026-07-30 브랜드 축(msg_type='F') 적재수 — both 환불 분리용
  // ★ 2026-06-11 (근원 C): 정제 제외·청크 skip 건수를 send_config.exclusions에 기록 —
  //   "대상−전송 차이 사유"(수신거부/중복/무효)를 업체에 즉시 설명 가능하게 (폴라초이스 227건 문의 계열 차단).
  let unsubRemoved = 0;
  let dupRemoved = 0;
  let chunkSkipped = 0;
  // ★ 2026-09-26 F19 — 개별 회신번호가 없거나 등록·배정되지 않아 뺀 건수(chunkSkipped에도 들어간다 · 미적재 환불)
  let callbackExcluded = 0;

  // ★ 2026-06-04 정정: commit에서 옮긴 정제 — 발송 직전 1회. count/commit과 같은 기준이라 모달=차감=발송 일치.
  //   첫 처리(processed===0)에만 수행(재시작 시 중복 정제 방지). dedup/unsub은 send_config 기준.
  //   적재하지 않는 경우(skipLoad)는 정제할 이유가 없다 — 제외 사유 기록이 0으로 남는다.
  if (processed === 0 && !skipLoad) {
    if (cfg.unsubFilterEnabled !== false) {
      const r1 = await query(
        `DELETE FROM campaign_send_staging s USING unsubscribes u WHERE s.staging_id = $1 AND u.user_id = $2 AND u.phone = s.phone`,
        [stagingId, userId]
      );
      unsubRemoved = r1.rowCount || 0;
    }
    if (cfg.dedupEnabled !== false) {
      const r2 = await query(
        `DELETE FROM campaign_send_staging
         WHERE ctid IN (
           SELECT ctid FROM (
             SELECT ctid, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY id) AS rn
             FROM campaign_send_staging WHERE staging_id = $1
           ) t WHERE rn > 1
         )`,
        [stagingId]
      );
      dupRemoved = r2.rowCount || 0;
    }
  }

  // ★ 2026-07-27 (B-0727-1): 적재 중 예외가 나면 종결 블록(미적재분 환불 → 최종 상태·건수 기록 → staging 정리)에
  //   도달하지 못한 채 바깥 catch로 빠져나가, 선차감분이 환불되지 않고 실제로 나간 발송분도 후불 집계에서 빠졌다.
  //   (차감은 워커 실행 전 전량 선차감이고, 선불 sweeper는 send_phase IS NULL/'sent'만, 후불 집계는
  //    send_phase='sent' AND status='completed'만 본다.) 예외를 여기서 잡아 아래 종결 블록을 그대로 태운다 —
  //   중단 지점까지 적재된 건은 정상 발송분으로 집계되고, 나머지는 정상 경로와 같은 산식으로 환불된다.
  let failureReason: string | null = null;
  // ★2026-09-13(3) 키 기준 페이지(대행 등재분 ⑥). 직전 청크의 마지막 id. null = 아직 읽은 청크가 없다
  let lastId: string | null = null;
  try {
  while (processed < total) {
    // ★ 2026-09-25 C-10·C-11: 끊긴 적재 정리 · 적재 전 취소는 적재하지 않고 곧장 종결 블록으로 간다
    if (skipLoad) break;
    // ★ 2026-06-11: 적재 중 취소 감지 — 취소되면 적재를 멈춘다 (취소-적재 경합 차단).
    // ★ 2026-09-25 한줄로 전수점검 C-10: 옛 코드는 여기서 큐를 지우고 곧바로 return해 종결 블록의 미적재 환불을 타지 않았다.
    //   취소는 그 순간 큐 대기 행만 환불하므로 선차감된 미적재분과, 취소 뒤에 들어간 청크가 영구히 환불되지 않았다.
    //   이제 루프만 빠져나가 종결 블록으로 간다 — 미적재분 = NOT_LOADED 환불, 적재분 큐 삭제 + 취소 정산(CANCEL 항아리).
    const cancelCheck = await query(`SELECT status, ${LOAD_CANCELLED_SELECT} FROM campaigns WHERE id = $1`, [campaignId]);
    if (isLoadStopped(cancelCheck.rows[0]?.status, cancelCheck.rows[0]?.load_cancelled)) {
      console.log(`[direct-send-worker] 캠페인 ${campaignId} 적재 중 취소 감지 — 적재 중단 후 종결(환불) 처리`);
      break;
    }
    // ★2026-09-13(3) OFFSET 대신 직전 청크의 마지막 id 뒤를 읽는다(대행 등재분 ⑥). OFFSET은 앞 행을 청크마다 다시 세어
    //   100만 건이면 뒤로 갈수록 한 청크가 느려지고 그만큼 이 루프가 워커를 붙잡았다.
    //   ⛔ 같은 행·같은 순서다: 정렬 키 id는 PK(유일)이고, 이 루프 동안 staging 행을 지우는 곳은 위 정제(처음 한 번 · 루프 전)뿐이다
    //      (취소 감지는 루프를 빠져나가고 staging은 종결 블록 끝에서 지운다 · ★0925 C-10). 재시작(processed > 0)이면 처음 한 번만 OFFSET으로 이어 볼 자리를 찾는다
    //      (processed_count 멱등 계약 그대로 · 전역 순번 globalIndex도 그대로다).
    if (lastId === null && processed > 0) {
      const resume = await query(
        `SELECT id FROM campaign_send_staging WHERE staging_id = $1 ORDER BY id ASC LIMIT 1 OFFSET $2`,
        [stagingId, processed - 1]
      );
      if (resume.rows.length === 0) break;
      lastId = String(resume.rows[0].id);
    }
    // ★ 2026-09-26 한줄로 V2 F38 — 차감한 건수(total)까지만 읽는다. 커밋 뒤 준비분에 덧붙은 행(더 큰 id)은
    //   차감도 정제도 거치지 않은 행이라 읽으면 무료 발송이 된다. 정제(중복 제거)는 가장 작은 id를 남기므로
    //   total까지 읽으면 커밋 때의 행만 나간다.
    const chunkLimit = Math.min(CHUNK, total - processed);
    const chunkRes: Awaited<ReturnType<typeof query>> = lastId === null
      ? await query(
          `SELECT id, phone, name, extra1, extra2, extra3, callback
           FROM campaign_send_staging WHERE staging_id = $1 ORDER BY id ASC LIMIT $2`,
          [stagingId, chunkLimit]
        )
      : await query(
          `SELECT id, phone, name, extra1, extra2, extra3, callback
           FROM campaign_send_staging WHERE staging_id = $1 AND id > $3::bigint ORDER BY id ASC LIMIT $2`,
          [stagingId, chunkLimit, lastId]
        );
    if (chunkRes.rows.length === 0) break;
    lastId = String(chunkRes.rows[chunkRes.rows.length - 1].id);

    const recipients: ChunkRecipient[] = chunkRes.rows.map((r: any, i: number) => {
      const globalIndex = processed + i;
      let sendTime = '';
      if (cfg.scheduled && cfg.scheduledAt) {
        sendTime = (cfg.splitEnabled && cfg.splitCount > 0)
          ? toKoreaTimeStr(calcSplitSendTime(new Date(cfg.scheduledAt), Math.floor(globalIndex / cfg.splitCount)))
          : toKoreaTimeStr(new Date(cfg.scheduledAt));
      } else if (cfg.splitEnabled && cfg.splitCount > 0) {
        sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(), Math.floor(globalIndex / cfg.splitCount)));
      }
      return {
        phone: r.phone, name: r.name, extra1: r.extra1, extra2: r.extra2, extra3: r.extra3,
        callback: r.callback, sendTime,
      };
    });

    // ★ 2026-09-26 한줄로 V2 F19 — 개별 회신번호 모드면 적재 전에 등록 여부를 거른다(동기 /direct-send와 같은 CT).
    //   commit은 대표 번호만 등록을 확인하고 개별 번호는 건너뛰어, 미등록 발신번호로 적재됐다(사전등록제 위반).
    //   걸러진 행은 적재하지 않는다 → 종결 블록의 미적재 환불로 돌아간다.
    let chunkRecipients = recipients;
    if (cfg.useIndividualCallback) {
      const cb = await filterByIndividualCallback(recipients, companyId, callbackFilterUserId);
      chunkRecipients = cb.filtered;
      callbackExcluded += cb.callbackSkippedCount;
    }
    const result = await processSendChunk({
      companyId, campaignId, companyTables, recipients: chunkRecipients, directFieldMappings,
      kakaoImageAiGenerated: brandPreflight.aiGenerated,
      sendChannel: cfg.sendChannel || 'sms', msgType: cfg.msgType, message: cfg.message || '',
      subject: cfg.subject || '', callback: cfg.callback || '',
      useIndividualCallback: cfg.useIndividualCallback || false,
      finalIsAd, opt080, mmsImagePaths: cfg.mmsImagePaths || [], useNow,
      scheduled: !!cfg.scheduled,
      kakaoBubbleType: cfg.kakaoBubbleType, kakaoSenderKey: cfg.kakaoSenderKey, kakaoTargeting: cfg.kakaoTargeting,
      kakaoAttachmentJson: brandPreflight.attachmentJson ?? undefined, kakaoCarouselJson: cfg.kakaoCarouselJson, kakaoResendType: cfg.kakaoResendType,
      alimtalkTemplateCode: cfg.alimtalkTemplateCode, alimtalkVariableMap: cfg.alimtalkVariableMap,
      alimtalkButtonJson: cfg.alimtalkButtonJson, alimtalkNextType: cfg.alimtalkNextType,
      alimtalkNextContents: cfg.alimtalkNextContents, alimtalkNextSubject: cfg.alimtalkNextSubject,
      alimtalkEtcJson: cfg.alimtalkEtcJson,
    });
    sent += result.sentCount;
    brandSent += result.brandSentCount || 0;
    chunkSkipped += Math.max(0, chunkRes.rows.length - result.sentCount);
    processed += chunkRes.rows.length;

    await query(`UPDATE campaigns SET processed_count = $1, updated_at = NOW() WHERE id = $2`, [processed, campaignId]);
    await new Promise((res) => setImmediate(res)); // 이벤트루프 양보 — 다른 요청 블로킹 방지
  }
  } catch (loopErr: any) {
    failureReason = String(loopErr?.message || loopErr).slice(0, 300);
    console.error(`[direct-send-worker] 캠페인 ${campaignId} 적재 중단 (적재 ${sent}/${total}):`, loopErr);
  }

  // ★ 2026-09-25 C-11: 끊긴 적재 정리 — 적재 수를 MySQL 실측으로 잡는다(메모리 카운트는 죽은 프로세스와 함께 사라졌다).
  //   실측이 실패하면 추측으로 돈을 움직이지 않는다 — 던져서 이번 사이클을 멈추고, 선점이 updated_at을 갱신했으므로 10분 뒤 재시도.
  if (mode === 'recover') {
    const measured = await measureLoadedRows(companyId, userId, campaignId, cfg.sendChannel || 'sms', companyTables, refDates);
    sent = measured.sent;
    brandSent = measured.brandSent;
    failureReason = '서버 재시작으로 적재가 중단됨(자동 정리 · 적재된 건만 발송 · 나머지 환불)';
    console.warn(`[direct-send-worker] 캠페인 ${campaignId} 끊긴 적재 정리 — 실측 적재 ${sent}/${total}(브랜드 ${brandSent})${cancelledAtClaim ? ' · 취소됨' : ''}`);
  }

  // 미적재분(정제 제외 + 큐 INSERT skip) 환불 — 즉시성. 최종 수렴은 mysql-refund-sweeper 단일 산식이 보장.
  // ★ 2026-07-27 (B-0727-1): 환불 결과를 확인한다. prepaidRefund는 실패해도 throw하지 않고 refunded=0을
  //   돌려주므로, 옛 코드는 환불이 안 된 채로 캠페인을 종결했다. 전량 미적재(처리수 0)는 sweeper 산식이
  //   구조적으로 손대지 않는 자리라(refund-calc: 처리수 0이면 미적재 0) 그대로 영구 미환불이 됐다.
  //   실패하면 send_config.refundPending에 남겨 다음 워커 사이클이 재시도한다.
  const failed = Math.max(0, total - sent);
  // ★ 2026-07-30 적대검증 수용 — 차감 축(direct-send-core resolveRefundAxes)과 같은 축으로 환불한다.
  //   kakao/kakao_brand=BRAND 단일(적재수=brandSent=sent), both=message_type(적재수 sent)+BRAND(적재수 brandSent)
  //   두 원장 각각의 미적재분을 되돌린다. 옛 코드는 kakao를 KAKAO 원장으로 되돌려 차감(BRAND)과 어긋났다.
  const sendChannel = cfg.sendChannel || 'sms';
  const refundAxes = resolveRefundAxes(sendChannel, cfg.msgType).map((axis) => ({
    type: axis.type,
    failedCount: Math.max(0, total - (axis.scope === 'brand' ? brandSent : sent)),
  }));
  const pendingParts: Array<{ count: number; messageType: string }> = [];
  // ★ 2026-09-25 C-10·C-11 (Codex 1R 구조 정정): 이미 취소된 캠페인은 미적재 환불을 따로 하지 않는다.
  //   아래 취소 분기의 정산이 캠페인 전체 기준(차감 − 남는 행)으로 미적재·적재 후 삭제분을 한 번에 채운다.
  //   따로 하면 ①끊긴 적재 정리의 실측 적재 수가 취소가 지운 행을 못 세 그 몫이 두 번 나가고
  //   ②미적재 환불 실패의 재시도 의무(refundPending)가 전체 정산 뒤에 또 지급된다.
  //   직전에 상태를 다시 읽는다 — 이 시점 뒤에 도착한 취소는 아래 fin UPDATE가 0행이 되어 같은 정산으로 간다.
  const statusBeforeRefund = await query(`SELECT status, ${LOAD_CANCELLED_SELECT} FROM campaigns WHERE id = $1`, [campaignId]);
  const skipNotLoadedRefund = cancelledAtClaim || isLoadStopped(statusBeforeRefund.rows[0]?.status, statusBeforeRefund.rows[0]?.load_cancelled);
  for (const axis of refundAxes) {
    if (skipNotLoadedRefund) break;
    if (axis.failedCount <= 0) continue;
    try {
      const refundRes = await prepaidRefund(
        companyId, axis.failedCount, axis.type, campaignId, `대량 발송 미적재 ${axis.failedCount}건 자동 환불`,
        'campaign', { refundKey: REFUND_KEYS.NOT_LOADED },
      );
      if (!refundRes.ok) {
        pendingParts.push({ count: axis.failedCount, messageType: axis.type });
        console.error(`[direct-send-worker] 미적재분 환불 미완료 — 재시도 대기 등록 campaign=${campaignId} ${axis.type} ${axis.failedCount}건`);
      }
    } catch (refundErr) {
      pendingParts.push({ count: axis.failedCount, messageType: axis.type });
      console.error(`[direct-send-worker] 미적재분 환불 오류 (${axis.type}):`, refundErr);
    }
  }
  // refundPending 단일 슬롯 + brand 보조 슬롯(취소 의무의 parts 구조 미러 — 워커 재시도가 둘 다 읽는다)
  let refundPending: string | null = null;
  if (pendingParts.length > 0) {
    const main = buildRefundPending(pendingParts[0].count, pendingParts[0].messageType);
    refundPending = JSON.stringify(
      pendingParts.length > 1
        ? { ...main, brand: { count: pendingParts[1].count, messageType: pendingParts[1].messageType } }
        : main,
    );
  }

  // 완료 처리 + staging 정리
  // ★ 2026-06-11: status != 'cancelled' 가드 — 적재 완료 직전 취소된 캠페인을 'scheduled'로 되돌려
  //   취소 표시를 덮어쓰던 구멍 차단. 가드에 걸리면 적재분 큐 행도 삭제.
  // ★ 2026-06-11 (근원 C): 제외 사유 기록 — 첫 기록만 보존(재시작 시 정제 카운트 0이라 덮지 않음).
  const finalStatus = cfg.scheduled ? 'scheduled' : (sent === 0 ? 'failed' : 'completed');
  const exclusions = JSON.stringify({
    unsub: unsubRemoved, dup: dupRemoved, skipped: chunkSkipped, callbackExcluded,
    deducted: total, loaded: sent, recordedAt: new Date().toISOString(),
  });
  // ★ 2026-07-27 (B-0727-1): 적재가 중단됐어도 종결은 정상 경로와 같은 형태로 남긴다 —
  //   중단 사유만 send_config.failure에 덧붙인다. status는 건드리지 않는다(예약 캠페인은 'scheduled'를 유지해야
  //   예약 목록·취소 게이트에 남고, 이미 적재된 큐 행을 사용자가 취소할 수 있다).
  const failureJson = failureReason
    ? JSON.stringify({ at: new Date().toISOString(), reason: failureReason, loaded: sent, deducted: total })
    : null;
  const fin = await query(
    `UPDATE campaigns SET send_phase = 'sent', status = $1, sent_count = $2, fail_count = $3, sent_at = NOW(),
       send_config = CASE WHEN $6::jsonb IS NULL THEN (
           CASE WHEN send_config->'exclusions' IS NULL
             THEN jsonb_set(COALESCE(send_config, '{}'::jsonb), '{exclusions}', $5::jsonb)
             ELSE send_config END
         ) ELSE jsonb_set(
           CASE WHEN send_config->'exclusions' IS NULL
             THEN jsonb_set(COALESCE(send_config, '{}'::jsonb), '{exclusions}', $5::jsonb)
             ELSE COALESCE(send_config, '{}'::jsonb) END,
           '{failure}', $6::jsonb)
         END,
       updated_at = NOW()
     WHERE id = $4 AND ${NOT_LOAD_STOPPED_SQL}`,
    [finalStatus, sent, failed, campaignId, exclusions, failureJson]
  );
  if (fin.rowCount === 0) {
    // ★ 2026-09-25 C-10 (Codex 1R 구조 정정 · 2R 오류 경계): 큐 삭제 → 정산 → sent 표시를 **한 오류 경계**로 묶는다.
    //   어느 단계든 실패하면(MySQL 삭제 예외 · 실측 실패 · 환불 ok=false) processing으로 남겨 두고 돌아간다 —
    //   끊긴 적재 정리(recover · 10분)가 같은 캠페인 전체 목표로 다시 정산한다(재시도 의무를 따로 적지 않는다 · 같은 목표 재호출 = 멱등).
    //   예외를 밖으로 던지면 바깥 catch가 failed로 바꿔 아무도 다시 보지 않았다.
    let settled = false;
    try {
      await smsExecAll(companyTables, `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`, [campaignId]);
      // ★ 2026-09-26 한줄로 V2 F35(Codex 4차 2R·3R high) — 적재를 멈춘 지금이 결말을 정할 때다(더 들어올 청크가 없다).
      //   상태가 아니라 **취소 의무 표시**로 가른다(3R: 위임 뒤 동기화가 상태를 completed로 바꾸면 상태 판정이 옛 정산으로 새
      //   같은 삭제분이 두 번 나갔다). 정산 모드 의무 = 상태를 바꾸는 취소 → 취소 CT와 같은 결말 CT 하나로만.
      //   그 밖(대행 = 건수 의무 · 배포 전 취소) = 종전 전체 기준 정산. 상태를 바꾸는 취소는 표식과 의무를 한 UPDATE로 남긴다.
      const fresh = await query(
        `SELECT id, company_id, created_by, status, send_channel, message_type, created_at, scheduled_at,
                send_config->'refundPendingCancel'->>'mode' AS cancel_mode
           FROM campaigns WHERE id = $1`,
        [campaignId],
      );
      const freshCamp = fresh.rows[0];
      if (freshCamp?.cancel_mode === CANCEL_SETTLE_MODE) {
        settled = (await settleCancelOutcome({ camp: freshCamp, liveTables: companyTables, refDates })).ok;
      } else {
        settled = (await settleCancelledLoadRefund({
          companyId, userId, campaignId, sendChannel, msgType: cfg.msgType, companyTables, refDates,
        })).ok;
      }
      if (settled) {
        await query(`UPDATE campaigns SET send_phase = 'sent', updated_at = NOW() WHERE id = $1`, [campaignId]);
      }
    } catch (settleErr: any) {
      settled = false;
      console.error(`[direct-send-worker] 캠페인 ${campaignId} 취소 종결 실패:`, settleErr?.message || settleErr);
    }
    if (!settled) {
      void sendSystemAlert({
        dedupKey: `direct-cancel-settle:${campaignId}`,
        message: `직접발송 취소 정산 보류 — campaign=${campaignId} (processing 유지 · 10분 뒤 자동 재정산)`,
      }).catch(() => { /* 경보 실패가 흐름을 막지 않는다 */ });
      return;
    }
    console.log(`[direct-send-worker] 캠페인 ${campaignId} 취소 감지 — 적재분 큐 삭제 · 취소 정산 완료`);
  }
  // ★ 2026-07-27 (B-0727-1): 환불 미완료 표시는 종결 UPDATE와 분리해 남긴다(종결 표시는 이미 끝났고,
  //   이 값이 없어도 발송 자체는 정상이라 실패해도 다음 사이클이 다시 시도한다).
  // ★ 2026-09-25: 취소 분기에서 전체 정산이 끝났으면 미적재 재시도 의무를 남기지 않는다(전체 정산이 이미 그 몫을 포함).
  if (refundPending && fin.rowCount !== 0) {
    await query(
      `UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPending}', $2::jsonb),
              updated_at = NOW() WHERE id = $1`,
      [campaignId, refundPending],
    ).catch((e) => console.error('[direct-send-worker] refundPending 기록 실패:', e?.message || e));
  }
  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]);
  console.log(`[direct-send-worker] 캠페인 ${campaignId} 완료 — 발송 ${sent}/${total}, 실패 ${failed}`);
}

/** app.ts 등록 — 5초 주기 queued 캠페인 처리 */
export function startDirectSendWorker(): void {
  setInterval(() => { void runDirectSendOnce(); }, 5000);
  console.log('[direct-send-worker] 시작 — 5초 주기 + commit 즉시 트리거');
}

/** commit 직후 즉시 트리거 (5초 대기 없이) */
export function triggerDirectSendWorker(_campaignId: string): void {
  void runDirectSendOnce();
}
