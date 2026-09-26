// ===========================================================================
// utils/mysql-refund-sweeper.ts — MySQL 진실 원천 환불 sweep 워커
// ---------------------------------------------------------------------------
// ★ D153 (2026-05-13) 신설 — 환불 누락 뿌리뽑기
//
// 사고 패턴 (D151-2 cron 도입 후에도 재발):
//   campaign-sync-worker → syncCampaignResults 흐름이 매 5분 호출되지만
//   directCampaigns SELECT 결과에 일부 캠페인이 누락되어 PG fail_count 갱신 0회
//   → prepaidRefund 호출 0회 → 환불 영구 누락
//   (스킨큐어 5/11 f6a0/2f77: MySQL fail=1,199 vs PG fail=566 / 633건 영구 누락 사고)
//
// 해결 (이 워커):
//   PG fail_count 의존 0% — status + 14d 윈도우 + billing_type='prepaid'만 후보
//   balance_transactions 환불 누적이 진실 원천 회계 (prepaidRefund idempotent 가드가 비교)
//   MySQL status_code별 GROUP BY → 실제 fail count → prepaidRefund(누적 fail) idempotent 호출
//   차액 자동 환불 + PG fail_count/success_count 동시 갱신 (화면 정합 보조)
//
// 차별점 (기존 campaign-sync-worker D151-2):
//   기존: cron 24h 윈도우 + syncCampaignResults `target_count > success_count + fail_count` (PG fail 의존)
//   신규: 14d 윈도우 + status만 (PG fail 무관) + balance_transactions 회계 진실
//
// 패턴 기준: utils/campaign-sync-worker.ts (D151-2 setInterval) + utils/auto-campaign-worker.ts 미러
// ===========================================================================

import pool, { query } from '../config/database';
import { resolveChargeUnitPrice } from './unit-price';
import { parseDeductDescription, parseFreeCount, resolveAlimtalkLedgerUnits } from './deduct-reference';
// ★ 2026-06-11: 카운트는 smsCampaignCountsSafe(이력=결과/라이브=대기 분리) — 이동 중 이중 카운트 차단
import { getCompanySmsTablesWithLogs, smsCampaignCountsSafe, smsAlimtalkResultAgg, smsCampaignSubRowCounts, type CampaignAggCounts } from './sms-queue';
// ★ 2026-07-30 브랜드 SMSQ 합류 — 환불 원장 축(BRAND vs message_type) 판정 CT
import { resolveCampaignLedger } from './billing-types';
import { isStepCampaignDayClosed } from './journey-step-campaign';
import { prepaidRefund, prepaidReverseOverRefund, REFUND_KEYS } from './prepaid';
// ★ 2026-06-11: 환불 누적 단일 산식 — 정당 환불 = 차감 실측 − 성공 − 대기 (미적재분 과소 환불 근본 fix)
// ★ 2026-06-29: refundInvariantGap — 차감 = 성공 + 순환불 머니 불변식 감시
import { calcRefundParts, refundInvariantGap, resolveAlimtalkMix, calcAlimtalkUnitDiff } from './refund-calc';
// ★ 2026-06-29: 머니 불변식 위반 시 운영자 LMS 경보 (쿨다운·미설정 시 무발송)
import { sendSystemAlert } from './system-alert';
// ★ D182 (2026-05-19): 캠페인 종료 시 회사별 학습 메모리 자동 누적
import { recordCampaignLearning } from './company-memory';
// ★ 2026-06-13: 차등 주기 — 발송 48h 이내 매 사이클 / 경과(휴면) 60분 1회 (PROCESSLIST 10초 쿼리 상시 점유 fix)
import { isSweepDue } from './sweep-cadence';
import { sendTypeLabel } from './send-type-axis';
// ★ 2026-08-04: sweep 대상 캠페인 상태 CT — lifecycle 동기화와 같은 집합을 본다
import { SWEEPABLE_CAMPAIGN_STATUS_SQL } from './campaign-sweep-scope';

const INTERVAL_MS = 30 * 1000;     // 30초 — Harold님 명시 (D153 5/13): 레거시 실시간 환불 패턴 정합 + 후불 8.5/선불 1.5 부하 보수 마진 (1.5초/사이클 / 5% 점유 / 후불 업체는 billing_type filter로 쿼리 자체 X)
const BOOT_DELAY_MS = 90 * 1000;   // campaign-sync-worker(60초)와 시작 시점 차이 둠
// ★ 2026-06-29: 머니 불변식(차감 = 성공 + 순환불) 위반 경보 임계 — 반올림 노이즈(±1) 차단용 2건 이상
const INVARIANT_ALERT_THRESHOLD = 2;
// ★ 2026-09-26 한줄로 V2 F05 — 여정은 발송 1건마다 차감 → 적재가 하루 종일 이어진다. 방금 차감하고 아직 적재가 안 보이는 건을
//   미적재로 환불하지 않도록, 여정의 미적재는 이 시간이 지난 차감만 센다(적재는 차감 뒤 ms~초 안에 끝난다 · 적재 실패분은 이 뒤에 돌아간다).
const JOURNEY_LOAD_SETTLE_MS = 5 * 60 * 1000;
// ★ 2026-09-26 한줄로 V2 F13·F42 — 캠페인 학습 누적은 급하지 않다: 10분 간격 · 한 번 평가한 캠페인은 다시 고르지 않는다.
//   옛 코드는 클릭 0 캠페인(학습 행을 안 만든다)을 24시간 동안 30초마다 다시 골라 그 회사의 클릭 이벤트 전체를 COUNT했다.
//   평가 기록은 프로세스 메모리(DB 쓰기 없음) — 재기동 뒤엔 한 번 더 평가될 뿐이다. 후보 창(24시간)보다 조금 길게 들고 있다가 버린다.
const LEARNING_INTERVAL_MS = 10 * 60 * 1000;
const LEARNING_MEMO_TTL_MS = 25 * 60 * 60 * 1000;
let _lastLearningAt = 0;
const _learningEvaluated = new Map<string, number>();

/** 여정 알림톡 단계 캠페인인가 — 원장 CT(resolveCampaignLedger)가 journey · KAKAO 축으로 보는 캠페인(대체 행이 붙는다). */
function isJourneyAlimtalk(c: { send_type: string | null; send_channel: string | null; message_type: string }): boolean {
  const l = resolveCampaignLedger(c.send_type, c.send_channel, c.message_type);
  return l.referenceType === 'journey' && l.axes[0]?.type === 'KAKAO';
}

let _timer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;
let _running = false;

function log(...args: any[]) {
  console.log('[mysql-refund-sweeper]', ...args);
}

interface CampaignRow {
  id: string;
  company_id: string;
  created_by: string | null;
  message_type: string;
  send_channel: string | null;   // ★ 2026-07-30 환불 축 판정(BRAND vs message_type)
  send_type: string | null;      // ★ 2026-09-26 여정 단계 캠페인은 journey 원장(resolveCampaignLedger)
  journey_ledger: boolean | null; // ★ 2026-09-26 새 원장 표식(send_config.journeyLedger) — 없는 여정 캠페인은 정산하지 않는다
  success_count: number | null;
  fail_count: number | null;
  sent_count: number | null;
  send_phase: string | null;
  send_base: Date | string | null;
}

// ★ 2026-06-13 차등 주기 마커 — 캠페인별 마지막 실집계 시각(메모리).
//   재시작 시 비어 첫 사이클만 전수 집계(기존과 동일) 후 다시 차등화 — PG 컬럼 추가 0.
const _lastSweptAt = new Map<string, number>();

/**
 * 회사·메시지타입별 단가 조회 (사이클 내 캐시) — `prepaid.ts`와 **같은 CT**를 지난다.
 *
 * ★ 2026-07-26 단가 선택을 SQL `CASE`에서 걷어냈다. 부가세 기준(`unit_price_basis`)에 따라
 *   차감·환불 단가가 달라지는데, SQL 안에서 컬럼만 고르면 그 변환이 빠져 **회수 금액만 기준이 달라진다.**
 *   차감·환불·회수 셋의 단가가 갈리면 잔액이 수렴하지 않는다(D182 계열).
 */
async function getUnitPrice(companyId: string, messageType: string, cache: Map<string, number>): Promise<number> {
  const key = `${companyId}:${messageType}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = await query(
    `SELECT unit_price_basis, cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, cost_per_brand, cost_per_brand_nonfriend
     FROM companies WHERE id = $1`,
    [companyId]
  );
  const unit = resolveChargeUnitPrice(r.rows[0], messageType);
  cache.set(key, unit);
  return unit;
}

/**
 * 1회 sweep 사이클:
 *  1) prepaid 회사 + 14일 내 발송 캠페인 후보 SELECT (PG fail 무관)
 *  2) 회사/유저 그룹별 MySQL 배치 집계 (UNION ALL GROUP BY 효율)
 *  3) 캠페인별 처리:
 *     - PG success/fail_count != MySQL 이면 UPDATE (화면 정합 보조)
 *     - MySQL fail > 0 이면 prepaidRefund(누적 fail) idempotent 호출 → 차액 환불
 *
 * idempotency 보장:
 *   prepaidRefund 내부 가드가 balance_transactions refund 누적과 비교해 차액만 환불.
 *   이미 충분히 환불됐으면 refunded=0 반환. 같은 캠페인 반복 호출해도 추가 차감/환불 0%.
 */
async function runOnce(): Promise<void> {
  if (_running) {
    log('이전 실행 진행 중 → skip');
    return;
  }
  _running = true;
  const startedAt = Date.now();

  try {
    // === 1. 후보 캠페인 SELECT (PG fail_count 무관) ===
    const candidates = await query(`
      SELECT c.id, c.company_id, c.created_by, c.message_type, c.send_channel, c.send_type,
             (c.send_config ? 'journeyLedger') AS journey_ledger,
             c.success_count, c.fail_count, c.sent_count, c.send_phase,
             COALESCE(c.scheduled_at, c.sent_at, c.created_at) AS send_base
      FROM campaigns c
      JOIN companies co ON co.id = c.company_id
      WHERE co.billing_type = 'prepaid'
        -- ★ 2026-08-04 대상 상태는 CT(campaign-sweep-scope)가 소유한다 — lifecycle 동기화와
        --   같은 집합을 봐야 한쪽에만 보이는 캠페인이 생기지 않는다. 'failed' 합류 근거도 그 파일에.
        AND c.status IN (${SWEEPABLE_CAMPAIGN_STATUS_SQL})
        AND c.message_type IS NOT NULL
        AND COALESCE(c.scheduled_at, c.sent_at, c.created_at) >= NOW() - INTERVAL '14 days'
      ORDER BY c.created_at DESC
    `);

    if (candidates.rows.length === 0) {
      log('후보 캠페인 0건 → 종료');
      return;
    }

    // === 1-1. ★ 2026-06-13 차등 주기 — 발송 48h 이내는 매 사이클, 경과(휴면)는 60분 1회만 실집계.
    //   후보 SELECT(14일 안전망)·환불 산식은 불변 — MySQL 집계 대상만 줄인다.
    //   30초마다 14일치 전체(IN 380건)를 18개 이력 테이블 UNION으로 돌던 10초 쿼리가
    //   전 화면을 상시 지연시키던 구조 fix (PROCESSLIST 실측 2026-06-13).
    const nowMs = Date.now();
    const allRows = candidates.rows as CampaignRow[];
    const activeRows: CampaignRow[] = [];
    for (const c of allRows) {
      const baseMs = c.send_base ? new Date(c.send_base).getTime() : 0;
      if (isSweepDue(baseMs, _lastSweptAt.get(c.id), nowMs)) {
        activeRows.push(c);
        _lastSweptAt.set(c.id, nowMs);
      }
    }
    // 14일 윈도우를 벗어난 캠페인 마커 정리 (메모리 상한)
    if (_lastSweptAt.size > allRows.length * 2) {
      const liveIds = new Set(allRows.map(c => c.id));
      for (const k of _lastSweptAt.keys()) if (!liveIds.has(k)) _lastSweptAt.delete(k);
    }

    // === 2. 회사/유저 조합별 그룹화 ===
    const byUserKey = new Map<string, CampaignRow[]>();
    for (const c of activeRows) {
      const key = `${c.company_id}::${c.created_by || ''}`;
      if (!byUserKey.has(key)) byUserKey.set(key, []);
      byUserKey.get(key)!.push(c);
    }

    // === 3. 회사/유저별 MySQL 배치 집계 — ★ 2026-06-11 정합성 100% 산식(이력=결과/라이브=대기) ===
    // ★ 2026-07-30: 브랜드 행(msg_type='F')이 같은 테이블에 합류 — 전체 집계가 자동 포함.
    //   'both' 캠페인만 브랜드/문자 분리 집계 추가(환불 원장이 BRAND와 message_type으로 갈린다).
    const smsAggMap = new Map<string, CampaignAggCounts>();
    const brandAggMap = new Map<string, CampaignAggCounts>();
    const nonBrandAggMap = new Map<string, CampaignAggCounts>();
    // ★ 2026-09-26 선불 알림톡 결과별 정산(4-2-A)이 같은 테이블을 다시 쓴다 — 두 번 풀지 않는다.
    const tablesByKey = new Map<string, string[]>();
    // ★ 2026-09-26 (Codex 3R) 여정 알림톡 단계 캠페인의 대체 행 수(smsCampaignCountsSafe와 같은 가시성 규칙)
    const subRowMap = new Map<string, number>();
    for (const [key, camps] of byUserKey) {
      const [cid, uid] = key.split('::');
      const tables = await getCompanySmsTablesWithLogs(cid, uid || undefined);
      tablesByKey.set(key, tables);
      const ids = camps.map(c => c.id);
      const partial = await smsCampaignCountsSafe(tables, ids);
      for (const [g, v] of partial) smsAggMap.set(g, v);
      const bothIds = camps.filter(c => String(c.send_channel || '') === 'both').map(c => c.id);
      if (bothIds.length > 0) {
        for (const [g, v] of await smsCampaignCountsSafe(tables, bothIds, 'app_etc1', 'brand')) brandAggMap.set(g, v);
        for (const [g, v] of await smsCampaignCountsSafe(tables, bothIds, 'app_etc1', 'nonBrand')) nonBrandAggMap.set(g, v);
      }
      // ★ 2026-09-26 (Codex 3R) 여정 알림톡 단계 캠페인만 — 대체 행 수(행 실패 − 대체 행 = 수신자 기준 실패). 다른 캠페인엔 조회 0.
      const journeyAlimIds = camps.filter(c => isJourneyAlimtalk(c)).map(c => c.id);
      if (journeyAlimIds.length > 0) {
        for (const [g, v] of await smsCampaignSubRowCounts(tables, journeyAlimIds)) subRowMap.set(g, v);
      }
    }

    // === 4. 캠페인별 sweep ===
    let pgUpdateCount = 0;
    let refundCount = 0;
    let totalRefundAmount = 0;
    let reverseOverCount = 0;
    let totalReverseOverAmount = 0;
    let invariantAlertCount = 0;
    const unitCache = new Map<string, number>();

    for (const camp of activeRows) {
      try {
        const smsAgg = smsAggMap.get(camp.id);

        const mysqlSuccess = Number(smsAgg?.success || 0);
        const mysqlFail = Number(smsAgg?.fail || 0);
        const mysqlPending = Number(smsAgg?.pending || 0);

        // === 4-1. PG count 동시 갱신 (화면 보조) — 결과가 하나라도 있을 때만 ===
        // target_count는 절대 건드리지 않음 (protect_completed_target_count trigger 호환)
        // ★ 2026-06-11: sent_count 덮어쓰기 제거 — sent_count는 적재 실측(worker 기록)이 진실.
        //   success+fail로 덮으면 결과 도착 전 "전송"이 작아 보이고 대기가 0으로 굳는다(건5 출처 혼선).
        //   worker 이전 세대(sent_count NULL/0)만 success+fail로 보완.
        if (mysqlSuccess > 0 || mysqlFail > 0) {
          const pgSuccess = Number(camp.success_count || 0);
          const pgFail = Number(camp.fail_count || 0);
          const pgSent = Number(camp.sent_count || 0);
          // ★ 2026-06-29: 실제 적재수 = 큐에 들어간 전체(성공+실패+대기). sent_count가 이보다 작게
          //   기록된 것(폴라초이스 15271 vs 15400)을 GREATEST로 진실에 맞춤 — 올림만, 이동 찰나에도 안 내려감.
          // ★ 2026-09-26 (Codex 3R) 여정 단계 캠페인의 발송 수는 실행기가 발송마다 +1 한다(bumpStepCampaignCount) —
          //   여기서 행 수로 올리면 알림톡 대체 행이 적재 수를 부풀려 미적재(차감 − 적재)를 줄인다(적재 실패분 미환불).
          const loaded = camp.send_type === 'journey' ? pgSent : mysqlSuccess + mysqlFail + mysqlPending;
          if (pgSuccess !== mysqlSuccess || pgFail !== mysqlFail || pgSent < loaded) {
            await query(
              `UPDATE campaigns
                 SET success_count = $1,
                     fail_count = $2,
                     sent_count = GREATEST(COALESCE(sent_count, 0), $4::int),
                     updated_at = NOW()
               WHERE id = $3 AND status IN (${SWEEPABLE_CAMPAIGN_STATUS_SQL})`,
              [mysqlSuccess, mysqlFail, camp.id, loaded]
            );
            pgUpdateCount++;
          }
        }

        // === 4-2. 환불 — 단일 산식: 정당 환불 = 차감 실측 − 성공 − 대기 (utils/refund-calc.ts) ===
        // ★ 2026-06-11: 기존 mysqlFail 기준은 미적재분(차감됐는데 큐에 안 들어간 것)을 영구 누락시켰다.
        //   worker의 미적재 환불과 같은 누적 풀에서 max로 수렴 — 미적재 발생 시(D231 톤28형) 그 몫이 사라짐.
        //   차감 건수 = balance_transactions deduct 실측(금액/단가) — 기록(target_count)이 아니라 돈이 진실.
        //   적재가 끝난 캠페인만(send_phase 'sent' 또는 NULL=동기 적재 경로) — 적재 진행 중 오발동 차단.
        // ★ 2026-07-30: 환불·회수·불변식 전부를 **원장 축 단위**로 돈다(resolveRefundAxes) —
        //   브랜드 전용 캠페인은 BRAND 원장 하나, 'both'는 문자/브랜드 두 원장이 각자 수렴한다.
        //   축을 섞으면 한쪽 차감이 다른 쪽 실패를 삼켜 미환불·초과환불이 동시에 생긴다.
        if (camp.send_phase == null || camp.send_phase === 'sent') {
          // ★ 2026-09-26 한줄로 V2 F05·F06·F11 — 원장 위치는 CT가 정한다. 여정 단계 캠페인은 (journey, 단계 캠페인 id) ·
          //   알림톡 단계는 KAKAO 축. 옛 코드는 campaign 원장만 읽어 여정 실패분이 영구 과금됐다(차감 0으로 보였다).
          const ledger = resolveCampaignLedger(camp.send_type, camp.send_channel, camp.message_type);
          // ★ Codex 1R — 새 원장 표식이 없는 여정 캠페인(배포 전에 만든 날 · 차감이 옛 참조 = 여정 id)은 종전 그대로 건너뛴다.
          //   섞인 날을 새 원장으로 정산하면 원장과 결과의 경계가 어긋나고, 빈 원장으로 보면 거짓 경보가 난다.
          const journeySkip = ledger.referenceType === 'journey' && camp.journey_ledger !== true;
          for (const axis of journeySkip ? [] : ledger.axes) {
            const axisCounts = axis.scope === 'all'
              ? { success: mysqlSuccess, fail: mysqlFail, pending: mysqlPending }
              : (axis.scope === 'brand' ? brandAggMap : nonBrandAggMap).get(camp.id)
                ?? { success: 0, fail: 0, pending: 0 };
            const axisSuccess = Number(axisCounts.success || 0);
            const axisFail = Number(axisCounts.fail || 0);
            const axisPending = Number(axisCounts.pending || 0);
            // 분리 축은 PG sent_count(전 채널 합)를 못 쓴다 — MySQL 실측만으로 처리수를 잡는다.
            const axisSentCount = axis.scope === 'all' ? Number(camp.sent_count || 0) : 0;

            // ★ 2026-07-26 **차감 원장을 먼저 읽는다**(Codex #5·#6).
            //   그 전에는 ①`현재 단가 > 0`인지로 환불 진입을 판정하고 ②차감 건수를 `총차감액 ÷ 현재단가`로
            //   역산했다. 둘 다 "지금 단가"에 기대는 구조라, 단가를 비우면 환불이 통째로 건너뛰어지고(미환불)
            //   단가를 바꾸면 건수가 부풀어 없는 실패가 환불된다(2026-07-26 패밀리투 83건 622.5원 실측).
            //   정산의 근거는 그 차감이 남긴 값이다.
            //   NULL(옛 세대) 행은 기본 축에만 합산한다 — BRAND 원장은 2026-07-29 이후 세대라 NULL이 없다.
            const dedRes = axis.type === 'BRAND'
              ? await query(
                  `SELECT amount, description, created_at FROM balance_transactions
                   WHERE company_id = $1 AND type = 'deduct' AND reference_type = $4 AND reference_id = $2
                     AND message_type = $3`,
                  [camp.company_id, camp.id, axis.type, ledger.referenceType]
                )
              : await query(
                  `SELECT amount, description, created_at FROM balance_transactions
                   WHERE company_id = $1 AND type = 'deduct' AND reference_type = $4 AND reference_id = $2
                     AND (message_type = $3 OR message_type IS NULL)`,
                  [camp.company_id, camp.id, axis.type, ledger.referenceType]
                );
            let dedTotal = 0;
            let parsedCount = 0;
            // ★ 2026-08-05 요금제 무료 제공으로 덮인 건수 — 정산 축은 `부담 = 차감 + 무료`(설계 §5-1-B).
            let freeCount = 0;
            // ★ 2026-09-26 F05 — 여정 미적재 판정용: JOURNEY_LOAD_SETTLE_MS가 지난 차감만(여정이 아니면 전부).
            let settledParsedCount = 0;
            let settledFreeCount = 0;
            const settleNowMs = Date.now();
            let allParsed = dedRes.rows.length > 0;
            for (const d of dedRes.rows as any[]) {
              const amount = Number(d.amount) || 0;
              dedTotal += amount;
              const free = parseFreeCount(d.description);
              freeCount += free;
              const settled = ledger.referenceType !== 'journey'
                || (d.created_at != null && settleNowMs - new Date(d.created_at).getTime() >= JOURNEY_LOAD_SETTLE_MS);
              if (settled) settledFreeCount += free;
              // 금액 0 행 = 전량 무료라 차감이 없었던 행. 단가 역산에 기여할 것이 없고, 파싱 대상에 두면
              // `allParsed`가 거짓이 되어 같은 캠페인의 유료 행 정산까지 통째로 보류된다(prepaid.ts와 같은 규칙).
              if (amount === 0) continue;
              const parsed = parseDeductDescription(d.description);
              if (parsed) {
                parsedCount += parsed.count;
                if (settled) settledParsedCount += parsed.count;
              } else allParsed = false;
            }
            dedTotal = Math.round(dedTotal * 100) / 100;
            const ledgerUnit = allParsed && parsedCount > 0 ? Math.round((dedTotal / parsedCount) * 100) / 100 : null;

            // 차감은 있는데 되읽지 못했다 = 추측으로 돈을 움직이면 안 되는 상태. 이번 사이클은 건너뛴다.
            // 환불은 idempotent하고 30초마다 다시 도므로, 원인을 고치면 밀린 환불이 자동으로 나간다.
            if (dedTotal > 0 && ledgerUnit === null) {
              log(`[정산보류] campaign=${camp.id} ${axis.type} — 차감 원장 설명을 되읽지 못해 환불·회수를 건너뛴다`);
              await sendSystemAlert({
                dedupKey: `sweep-ledger-unresolved:${camp.id}:${axis.type}`,
                message: `선불 sweep 보류 — 차감 원장 설명을 되읽지 못했습니다(환불 보류). campaign=${camp.id} ${axis.type}`,
              }).catch(() => { /* 경보 실패가 sweep을 막지는 않는다 */ });
              continue;
            }

            // 차감 자체가 없는 캠페인만 현재 단가로 떨어진다(그 경우 건수 0이라 환불도 0이다).
            const unit = ledgerUnit ?? await getUnitPrice(camp.company_id, axis.type, unitCache);
            if (unit > 0) {
              const deductedCount = parsedCount > 0 ? parsedCount : Math.round(dedTotal / unit);
              // ★ 2026-08-05 부담 건수 = 차감 + 무료. 무료로 덮인 건도 큐에 올라갔어야 할 발송이라
              //   미적재·정당 한도·불변식은 전부 이 축으로 잰다. 무료 0이면 부담 = 차감이라 종전과 같다.
              const coveredCount = deductedCount + freeCount;

              // === 4-2-A. ★ 2026-09-26 한줄로 V2 F01·F04 — 선불 알림톡 결과별 단가 차액 ===
              //   알림톡은 대체 문자까지 덮는 문자 단가로 차감한다. 결과가 알림톡 성공·SMS 대체로 나오면 그 단가와의 차액을
              //   돌려준다(후불 청구와 같은 결과). 차감 행에 결과별 단가가 실린 캠페인만 — 옛 차감·문자 발송은 건너뛴다(조회 0).
              //   실패·미적재 환불(아래)은 종전 행 기준 그대로다: sent_count가 대체 행까지 센 적재수로 올라가 있어
              //   실패만 수신자 기준으로 바꾸면 미적재가 줄어 미환불이 난다. 행 기준 합은 정당 환불 건수와 같고 넘친 몫은 4-3 회수가 맞춘다.
              //   차액을 먼저 돌려준다 — 실패 환불이 한도를 먼저 채우면 차액 항아리가 비어 기록이 흐려진다(금액은 4-3이 맞춘다).
              let unitDiffAmt = 0;
              const alimUnits = axis.scope === 'all' ? resolveAlimtalkLedgerUnits(dedRes.rows as any[]) : null;
              if (alimUnits) {
                const tables = tablesByKey.get(`${camp.company_id}::${camp.created_by || ''}`) || [];
                const agg = (await smsAlimtalkResultAgg(tables, [camp.id])).get(camp.id);
                const { mix, ambiguous } = resolveAlimtalkMix(agg, axisSuccess);
                if (ambiguous) {
                  // 한 캠페인에 대체 모양 두 가지(K행 7830/7831 · 대체 행)가 같이 있으면 한 수신자를 두 번 셀 수 있다.
                  // 추측으로 돈을 움직이지 않는다 — 차액 없이 차감 단가로 정산하고(종전 동작) 사람이 보게 한다.
                  log(`[결과별정산보류] campaign=${camp.id} ${axis.type} — K행 대체 코드와 대체 행이 함께 있다`);
                  await sendSystemAlert({
                    dedupKey: `alimtalk-settle-ambiguous:${camp.id}`,
                    message: `선불 알림톡 결과별 정산 보류 — K행 대체 성공 코드와 대체 행이 한 캠페인에 함께 있어 차액 환불을 멈췄습니다(차감 단가로 정산). campaign=${camp.id}`,
                  }).catch(() => { /* 경보 실패가 sweep을 막지는 않는다 */ });
                } else {
                  unitDiffAmt = calcAlimtalkUnitDiff({ deductUnit: unit, units: alimUnits, mix, freeCount });
                }
              }
              if (unitDiffAmt > 0) {
                const r = await prepaidRefund(
                  camp.company_id, 0, axis.type, camp.id, '알림톡 결과별 단가 차액 환불',
                  ledger.referenceType, { refundKey: REFUND_KEYS.KAKAO_DIFF, targetAmount: unitDiffAmt },
                );
                if (r.refunded > 0) {
                  refundCount++;
                  totalRefundAmount += r.refunded;
                  log(`✓ campaign=${camp.id} ${axis.type} 알림톡 결과별 단가 차액 목표 ${unitDiffAmt}원 → ${r.refunded}원`);
                }
              }

              // ★ 2026-09-26 F05 — 실패·미적재 환불 목표는 여정이면 **자리 잡은 차감**(5분 지난)으로 잰다. 회수 한도·불변식은 전체 차감 그대로
              //   (방금 차감분은 회수 한도를 늘리는 쪽이라 안전하다). 여정이 아니면 두 값이 같다.
              const partsDeducted = ledger.referenceType === 'journey' ? settledParsedCount : deductedCount;
              const partsFree = ledger.referenceType === 'journey' ? settledFreeCount : freeCount;
              // ★ 2026-06-29: 미적재 = 부담 − max(적재기록, 성공+실패+대기). sent_count 과소 기록 초과환불 fix.
              const processed = Math.max(axisSentCount, axisSuccess + axisFail + axisPending);
              const notLoaded = processed > 0 ? Math.max(0, partsDeducted + partsFree - processed) : 0;
              // ★ 2026-07-27 (B-0727-2): 한 덩어리로 환불하던 것을 원인별 항아리로 나눈다.
              //   미적재분(notloaded)은 워커가 종결 때 넣는 것과 **같은 키**라 둘이 서로를 삼키지 않고 수렴한다.
              //   실패분(fail)은 결과가 도착할수록 커지므로 그 키 안에서 계속 top-up된다.
              //   합계는 옛 calcRefundDue와 동일하다(상한 포함).
              if (ledger.referenceType === 'journey') {
                // ★ 2026-09-26 (Codex 3R high) 여정은 원인별 항아리 대신 **단일 목표를 순환불(환불 − 회수)과 비교**한다.
                //   하루 종일 쌓이는 캠페인이라 "실패 환불 → 회수(대체 성공) → 새 정당 환불(적재 실패 등)"이 생기는데,
                //   항아리 지급 누계와 비교하면 회수된 몫이 새 환불을 막는다(prepaidRefund netTargetCount).
                //   목표 = min(자리 잡은 차감, 수신자 기준 실패 + 미적재) — 알림톡은 행 실패 − 대체 행(K 실패 + 대체 성공 = 실패 아님).
                //   미적재 = 자리 잡은 부담 − 적재(발송 수는 실행기가 성공마다 +1 · 차감 → 적재라 발송 수 0이면 정말 전부 미적재).
                //   회수 한도(아래 4-3 = 전체 차감 − 성공 − 대기)는 이 목표보다 작아질 수 없다(적재 ≥ 성공 + 실패 + 대기) → 요동 없음.
                const failR = Math.max(0, axisFail - (subRowMap.get(camp.id) || 0));
                const processedR = Math.max(axisSentCount, axisSuccess + failR + axisPending);
                const notLoadedR = Math.max(0, partsDeducted + partsFree - processedR);
                const target = Math.min(partsDeducted, failR + notLoadedR);
                if (target > 0) {
                  const r = await prepaidRefund(
                    camp.company_id, 0, axis.type, camp.id, '여정 발송 실패 환불 (sweep)',
                    'journey', { refundKey: REFUND_KEYS.FAIL, netTargetCount: target },
                  );
                  if (r.refunded > 0) {
                    refundCount++;
                    totalRefundAmount += r.refunded;
                    log(`✓ campaign=${camp.id} ${axis.type} 여정 목표 ${target}건(실패 ${failR} + 미적재 ${notLoadedR} / 자리 잡은 차감 ${partsDeducted}) 차액 ${r.refunded}원`);
                  }
                }
              } else {
                const parts = calcRefundParts({
                  deductedCount: partsDeducted, freeCount: partsFree, sentCount: axisSentCount,
                  mysqlSuccess: axisSuccess, mysqlFail: axisFail, mysqlPending: axisPending,
                });
                for (const [key, dueCount, label] of [
                  [REFUND_KEYS.FAIL, parts.fail, '실패'],
                  [REFUND_KEYS.NOT_LOADED, parts.notLoaded, '미적재'],
                ] as const) {
                  if (dueCount <= 0) continue;
                  const r = await prepaidRefund(
                    camp.company_id, dueCount, axis.type, camp.id, `발송 ${label} 환불 (sweep)`,
                    ledger.referenceType, { refundKey: key },
                  );
                  if (r.refunded > 0) {
                    refundCount++;
                    totalRefundAmount += r.refunded;
                    log(`✓ campaign=${camp.id} ${axis.type} ${label} ${dueCount}건 (실패 ${axisFail} + 미적재 ${notLoaded} / 차감 ${deductedCount}${freeCount > 0 ? ` + 무료 ${freeCount}` : ''} 처리 ${processed}) 차액 ${r.refunded}원`);
                  }
                }
              }

              // === 4-3. ★ 2026-06-29: 초과 환불 자동 회수 (양방향 수렴) ===
              //   누적 환불이 정당 한도(차감 − 성공 − 대기)를 넘었으면 초과분만 reverse 차감.
              //   sent_count 과소·과거 ratchet 고착분을 코드로 자동 회수하고, 미래 어떤 변수가 튀어도 스스로 보정.
              //   settle 가드 — 정산 끝난 캠페인에서만: 대기 0(발송 중 아님) + 집계 유효(0/0 agg 실패 제외) + 30분 경과.
              //   (정당 한도 = MySQL 실측 성공으로만 계산 → 성공은 이력 append-only라 과대 불가 = 과다 회수 0)
              const ageMs = camp.send_base ? (Date.now() - new Date(camp.send_base).getTime()) : 0;
              // ★ 2026-09-26 (Codex 2R high) 여정도 회수는 언제든 돈다 — 차감 → 적재 순서(journey-executor)라 차감 없는 성공이 보일 수 없어
              //   회수 한도(전체 차감 − 성공 − 대기)가 정상 환불보다 작아지지 않는다. 날짜 마감으로 막던 1R 처방은 닫힘을 증명하지 못해 걷었다.
              if (axisPending === 0 && (axisSuccess + axisFail) > 0 && ageMs > 30 * 60 * 1000) {
                // ★ 2026-08-05 정당 한도는 **부담 − 성공 − 대기**다. 차감만으로 재면 무료 제공이 낀 캠페인에서
                //   성공이 차감보다 커져 한도가 0이 되고, **정상 실패 환불을 초과로 오인해 회수한다**(설계 §5-1-B).
                const maxLegitRefund = Math.max(0, coveredCount - axisSuccess - axisPending);
                // ★ 2026-09-26 알림톡 결과별 차액은 정당 환불이다 — 한도에 더하지 않으면 30분 뒤 차액을 다시 빼간다.
                const rev = await prepaidReverseOverRefund(camp.company_id, maxLegitRefund, axis.type, camp.id, unitDiffAmt, ledger.referenceType);
                if (rev.reversed > 0) {
                  reverseOverCount++;
                  totalReverseOverAmount += rev.reversed;
                  log(`✓ campaign=${camp.id} ${axis.type} 초과환불 회수 ${rev.reversed}원 (정당한도 ${maxLegitRefund}건 = 부담 ${coveredCount} − 성공 ${axisSuccess})`);
                }

                // === 4-4. ★ 2026-06-29: 머니 불변식 감시 — 차감 = 성공 + 순환불(환불−회수). 깨지면 즉시 경보 ===
                //   "발송사는 한 건도 안 잃는다"를 코드로 보장. gap>0=미환불(고객 손해)·gap<0=초과환불 잔존.
                //   reverse가 소유한 캠페인(타임아웃 등 skipped)은 제외. 반올림 노이즈는 임계값으로 차단.
                //   순환불은 reverse가 같은 집계로 돌려준 값 재사용(추가 쿼리 0).
                // ★ 2026-09-26 여정 단계 캠페인의 불변식 경보는 그날이 끝난 뒤에만 — 진행 중엔 방금 차감(적재 전)·5분 안 미적재가
                //   gap으로 잡혀 거짓 경보가 난다. 돈은 움직이지 않는 감시라 날짜 기준으로 충분하다.
                const invariantDue = ledger.referenceType !== 'journey' || isStepCampaignDayClosed(camp.send_base, new Date());
                if (!rev.skipped && invariantDue) {
                  const netRefundedCnt = Math.round(rev.netRefundedAmt / unit);
                  // ★ 2026-09-26 차액은 정당 환불 — 순환불에서 빼고 본다(못 돌려줬으면 gap > 0 미환불로 드러난다).
                  const gapCnt = refundInvariantGap({ deductedCount, freeCount, successCount: axisSuccess, netRefundedCount: netRefundedCnt, unitDiffCount: unitDiffAmt / unit });
                  if (Math.abs(gapCnt) >= INVARIANT_ALERT_THRESHOLD) {
                    invariantAlertCount++;
                    const dir = gapCnt > 0 ? '미환불 의심(고객 손해)' : '초과환불 잔존';
                    log(`[불변식위반] campaign=${camp.id} ${axis.type} 부담 ${coveredCount} ≠ 성공 ${axisSuccess} + 순환불 ${netRefundedCnt}${unitDiffAmt > 0 ? ` (결과별 차액 ${unitDiffAmt}원)` : ''} (차이 ${Math.round(gapCnt * 10) / 10}건, ${dir})`);
                    await sendSystemAlert({
                      dedupKey: `refund-invariant:${camp.id}:${axis.type}`,
                      message: `환불 불변식 위반 — ${axis.type} 캠페인: 부담 ${coveredCount}건(차감 ${deductedCount}${freeCount > 0 ? ` + 무료 ${freeCount}` : ''}) ≠ 성공 ${axisSuccess} + 순환불 ${netRefundedCnt}${unitDiffAmt > 0 ? ` (알림톡 결과별 차액 ${unitDiffAmt}원 포함)` : ''} (차이 ${Math.round(gapCnt * 10) / 10}건, ${dir}). campaign=${camp.id}`,
                    });
                  }
                }
              }
            }
          }
        }
      } catch (campErr: any) {
        log(`✗ campaign=${camp.id} 처리 에러:`, campErr?.message || campErr);
      }
    }

    // === 5. D182 (2026-05-19) — 타임아웃 환불 reverse 체크 ===
    //   직원 신고 — 30~34분 시점 통신사 응답 도착하는데 30분 임계값에 환불 처리되어 회사 손해 발생.
    //   campaign-lifecycle 임계값 30→120분 변경 + 본 reverse 로직으로 영구 안전망 구축.
    //   타임아웃 환불 처리 후 success 증가 감지 시 자동 차감 (idempotent: reverse 1회만).
    const reverseRes = await reverseTimeoutRefundIfRecovered();
    if (reverseRes.reversed > 0) {
      log(`[reverse-refund] ${reverseRes.reversed}건 reverse 차감 / 총 ${reverseRes.totalAmount}원 (타임아웃 환불 후 발송 성공 확인)`);
    }

    // === 6. D182 (2026-05-19) — 캠페인 종료 시 회사별 학습 메모리 자동 누적 ===
    //   D181 Memory tool 본질 — 캠페인 종료 후 성공 패턴 / 채널 성과 ai_company_memory에 자동 누적
    //   idempotent — campaign_id 기준 1회만 학습 (중복 누적 차단)
    const learningRes = await accumulateCampaignLearning();
    if (learningRes.learned > 0) {
      log(`[memory-learning] ${learningRes.learned}개 캠페인 학습 누적 (성공 패턴 + 채널 성과 → ai_company_memory)`);
    }

    const elapsedMs = Date.now() - startedAt;
    if (pgUpdateCount > 0 || refundCount > 0 || reverseOverCount > 0 || invariantAlertCount > 0 || reverseRes.reversed > 0 || learningRes.learned > 0) {
      log(`사이클 완료 — 후보 ${candidates.rows.length}(실집계 ${activeRows.length}/휴면 ${candidates.rows.length - activeRows.length}) / PG 갱신 ${pgUpdateCount} / 환불 ${refundCount}건 ${totalRefundAmount}원 / 초과회수 ${reverseOverCount}건 ${totalReverseOverAmount}원 / 불변식경보 ${invariantAlertCount}건 / 타임아웃reverse ${reverseRes.reversed}건 ${reverseRes.totalAmount}원 / 학습 ${learningRes.learned}건 / ${elapsedMs}ms`);
    }
  } catch (err: any) {
    log('전체 오류:', err?.message || err);
  } finally {
    _running = false;
  }
}

// ===========================================================================
// D182 (2026-05-19) — 타임아웃 환불 reverse 로직
// ---------------------------------------------------------------------------
// 트리거: campaign-lifecycle.ts의 isTimedOut → prepaidRefund(description='타임아웃 실패 환불')
// 사고: 통신사 응답이 임계값 직후(30~34분 시점)에 도착하면 환불 처리 후 success 카운트 증가 → 회사 손해
// fix: 본 함수가 30초 주기로 타임아웃 환불 row 추적 → success 증가분만큼 reverse 차감 (idempotent)
//
// idempotency 보장:
//   동일 campaign_id에 description='타임아웃 환불 reverse'인 admin_deduct row가 이미 있으면 skip.
//   윈도우 24h — 그 이전은 통신사 응답 거의 불가능.
// ===========================================================================

interface TimeoutRefundRow {
  refund_id: string;
  company_id: string;
  amount: string;
  description: string;
  campaign_id: string;
  message_type: string;
  current_success: number;
  current_fail: number;
  refund_created_at: Date;
}

async function reverseTimeoutRefundIfRecovered(): Promise<{ reversed: number; totalAmount: number }> {
  // 1. 최근 24h 내 '타임아웃 실패 환불' row 조회 (reverse 미처리만)
  const candidates = await query(`
    SELECT
      bt.id AS refund_id,
      bt.company_id,
      bt.amount,
      bt.description,
      bt.reference_id AS campaign_id,
      bt.message_type,
      bt.created_at AS refund_created_at,
      COALESCE(camp.success_count, 0) AS current_success,
      COALESCE(camp.fail_count, 0) AS current_fail
    FROM balance_transactions bt
    JOIN campaigns camp ON bt.reference_id = camp.id
    WHERE bt.type = 'refund'
      AND bt.description LIKE '%타임아웃 실패 환불%'
      AND bt.reference_type = 'campaign'
      AND bt.created_at > NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM balance_transactions bt2
        WHERE bt2.reference_id = bt.reference_id
          AND bt2.type = 'admin_deduct'
          AND bt2.description LIKE '%타임아웃 환불 reverse%'
      )
    ORDER BY bt.created_at DESC
  `);

  let reversed = 0;
  let totalAmount = 0;

  for (const row of candidates.rows as TimeoutRefundRow[]) {
    try {
      // 2. description에서 환불된 fail 건수 + 단가 추출
      // 예: '타임아웃 실패 환불 (MMS 1건 × 60.5원)' or '타임아웃 실패 환불 (LMS 1건 × 26.4원)'
      const match = row.description.match(/(\w+)\s*(\d+)\s*건\s*[×x]\s*([\d.]+)\s*원/);
      if (!match) {
        log(`[reverse-refund] campaign=${row.campaign_id} description 파싱 실패: "${row.description}"`);
        continue;
      }
      const refundedFailCount = parseInt(match[2], 10);
      const unitPrice = parseFloat(match[3]);

      // 3. 환불 후 success 증가량 = 실제 발송 성공한 양
      const currentSuccess = Number(row.current_success);
      if (currentSuccess <= 0) continue; // 여전히 success 0 = 진짜 실패, reverse 불요

      // 4. reverse 금액 계산: min(success 증가량, 환불된 fail 양) × 단가
      const recoveredCount = Math.min(currentSuccess, refundedFailCount);
      const reverseAmount = Math.round(recoveredCount * unitPrice * 100) / 100; // 소수점 2자리

      if (reverseAmount <= 0) continue;

      // 5. companies 잔액 차감 + balance_transactions INSERT (트랜잭션)
      // ★ 2026-07-25 트랜잭션을 실제로 성립시킨다. 전에는 `query('BEGIN')`을 썼는데
      //   `config/database.ts`의 `query`는 `pool.query`라 BEGIN·UPDATE·INSERT·COMMIT이
      //   각각 다른 커넥션에 나뉠 수 있어 트랜잭션이 성립하지 않았다.
      //   INSERT가 실패하면 잔액만 깎이고 이력이 안 남는다(돈이 조용히 사라진다).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 잔액 차감
        const balanceRes = await client.query(
          `UPDATE companies SET balance = balance - $1 WHERE id = $2::uuid RETURNING balance`,
          [reverseAmount, row.company_id]
        );
        if (balanceRes.rows.length === 0) {
          throw new Error(`company_id=${row.company_id} 잔액 갱신 실패`);
        }
        const newBalance = Number(balanceRes.rows[0].balance);

        // balance_transactions INSERT (type='admin_deduct', 추적 가능 description)
        await client.query(
          `INSERT INTO balance_transactions (
            id, company_id, type, amount, balance_after, description,
            reference_type, reference_id, message_type, created_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, 'admin_deduct', $2, $3,
            $4, 'campaign', $5::uuid, $6, NOW()
          )`,
          [
            row.company_id,
            -reverseAmount, // 차감이므로 음수
            newBalance,
            `타임아웃 환불 reverse (발송 성공 ${recoveredCount}건 확인, ${row.message_type} ${recoveredCount}건 × ${unitPrice}원, D182)`,
            row.campaign_id,
            row.message_type,
          ]
        );

        await client.query('COMMIT');
        reversed++;
        totalAmount += reverseAmount;
        log(`✓ reverse campaign=${row.campaign_id} company=${row.company_id} ${row.message_type} success=${recoveredCount}건 → ${reverseAmount}원 차감`);
      } catch (innerErr: any) {
        try { await client.query('ROLLBACK'); } catch (rb: any) {
          log(`✗ reverse campaign=${row.campaign_id} 롤백 실패:`, rb?.message || rb);
        }
        log(`✗ reverse campaign=${row.campaign_id} 트랜잭션 롤백:`, innerErr?.message || innerErr);
      } finally {
        client.release();
      }
    } catch (rowErr: any) {
      log(`✗ reverse campaign=${row.campaign_id} 처리 에러:`, rowErr?.message || rowErr);
    }
  }

  return { reversed, totalAmount };
}

// ===========================================================================
// D182 (2026-05-19) — 캠페인 종료 시 회사별 학습 메모리 자동 누적
// ---------------------------------------------------------------------------
// 캠페인 종료 후 ai_company_memory에 자동 누적한다.
// 트리거: status='completed' + sent_at 존재 + 학습 누락 (ai_company_memory에 해당 campaign_id row 없음)
// 처리: recordCampaignLearning 호출 → success_pattern (클릭률 10%+) + channel_performance
// idempotency: metadata->>'campaign_id' 기준 중복 차단
// ===========================================================================

interface LearningCandidateRow {
  campaign_id: string;
  company_id: string;
  campaign_name: string;
  message_type: string;
  send_type: string;
  is_ad: boolean;
  sent_count: number;
  success_count: number;
  fail_count: number;
  click_count: number | null;
  conversion_count: number | null;
  sent_at: Date;
}

async function accumulateCampaignLearning(): Promise<{ learned: number }> {
  const nowMs = Date.now();
  if (nowMs - _lastLearningAt < LEARNING_INTERVAL_MS) return { learned: 0 };
  _lastLearningAt = nowMs;
  for (const [id, at] of _learningEvaluated) if (nowMs - at > LEARNING_MEMO_TTL_MS) _learningEvaluated.delete(id);
  // 1. 최근 24h 내 종료된 캠페인 후보 (학습 누락분만)
  //   - status='completed' + sent_at 존재 + sent_count >= 10 (표본 부족 차단)
  //   - ai_company_memory에 해당 campaign_id metadata row 미존재
  const candidates = await query(`
    SELECT
      c.id AS campaign_id,
      c.company_id,
      c.campaign_name,
      c.message_type,
      c.send_type,
      COALESCE(c.is_ad, false) AS is_ad,
      COALESCE(c.sent_count, 0) AS sent_count,
      COALESCE(c.success_count, 0) AS success_count,
      COALESCE(c.fail_count, 0) AS fail_count,
      -- D183 (2026-05-20): cdp_events 'message_click' 영역 정확 집계 — 단축 URL 트래킹 통합
      COALESCE((
        SELECT COUNT(*)::int FROM cdp_events e
        WHERE e.company_id = c.company_id
          AND e.event_name = 'message_click'
          AND e.properties->>'campaign_id' = c.id::text
      ), 0) AS click_count,
      0 AS conversion_count,
      c.sent_at
    FROM campaigns c
    WHERE c.status = 'completed'
      AND c.sent_at IS NOT NULL
      AND COALESCE(c.scheduled_at, c.sent_at) > NOW() - INTERVAL '24 hours'
      AND COALESCE(c.sent_count, 0) >= 10
      AND NOT EXISTS (
        -- D216+ 비효율 정정 (2026-05-25):
        --   campaign_id만 매칭하면 channel_performance가 안 잡혀 매 사이클 동일 UPSERT가 반복된다.
        --   success_pattern(campaign_id) + channel_performance(last_campaign_id) 양쪽을 매핑해 캠페인당 1회만 학습.
        SELECT 1 FROM ai_company_memory m
        WHERE m.company_id = c.company_id
          AND m.source = 'campaign_result'
          AND (
            m.metadata->>'campaign_id' = c.id::text
            OR m.metadata->>'last_campaign_id' = c.id::text
          )
      )
      -- ★ 2026-09-26 F13·F42 이미 평가한 캠페인(학습 행을 안 만든 클릭 0 캠페인 포함)은 다시 고르지 않는다
      AND NOT (c.id = ANY($1::uuid[]))
    ORDER BY c.sent_at DESC
    LIMIT 100
  `, [Array.from(_learningEvaluated.keys())]);

  let learned = 0;

  for (const row of candidates.rows as LearningCandidateRow[]) {
    try {
      // click_count = cdp_events 'message_click' 집계 (campaign_id 매칭).
      // conversion_count는 cdp_events purchase/order 적재 후 연결 — 현재 데이터 없어 hasConversionData=false.
      // ★ 2026-07-31 이분법 폐기 — 'direct'가 아니면 전부 'AI추천'이라 자동발송·여정이 뭉개졌다.
      const channelLabel = sendTypeLabel(row.send_type);
      await recordCampaignLearning({
        companyId: row.company_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || `${channelLabel} ${new Date(row.sent_at).toLocaleDateString('ko-KR')}`,
        channel: row.message_type,
        targetCriteria: row.send_type,
        messageBody: '', // 본문 별도 조회 불요 (memory_key는 channel/name 기준)
        sentCount: Number(row.sent_count),
        clickCount: Number(row.click_count || 0),
        conversionCount: Number(row.conversion_count || 0),
        hasConversionData: false, // cdp_events 0건 — 전환 데이터 없음(가짜 전환율 차단)
        isAd: !!row.is_ad,
      });
      _learningEvaluated.set(row.campaign_id, nowMs);
      learned++;
    } catch (innerErr: any) {
      log(`✗ memory-learning campaign=${row.campaign_id} 처리 에러:`, innerErr?.message || innerErr);
    }
  }

  return { learned };
}

/** 테스트 진입점 — 한 사이클만 돈다(★2026-09-26 선불 알림톡 결과별 정산 배선 테스트). 운영은 startMysqlRefundSweeper만 쓴다. */
export const runMysqlRefundSweepOnce = runOnce;

export function startMysqlRefundSweeper(): void {
  if (_timer || _boot) return;
  log(`started — boot ${BOOT_DELAY_MS / 1000}초 후 첫 실행, 이후 ${INTERVAL_MS / 1000}초 주기`);
  _boot = setTimeout(() => {
    _boot = null;
    runOnce();
    _timer = setInterval(runOnce, INTERVAL_MS);
  }, BOOT_DELAY_MS);
}

export function stopMysqlRefundSweeper(): void {
  if (_boot) {
    clearTimeout(_boot);
    _boot = null;
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log('stopped');
  }
}
