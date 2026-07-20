/**
 * gateway-template-mapping-worker.ts — 게이트웨이 매핑 동기화 워커 (Track C M2, 2026-07-20)
 *
 * 원칙 = desired state + 수렴 (docs/2026-07-14-template-migration-track-bc-design.md §4-9).
 * 이벤트 훅(승인 순간 push)에 의존하지 않는다 — 워커가 "있어야 할 매핑"을 상태에서 계산해
 * 게이트웨이와 수렴시킨다(놓친 전이 자동 복구·멱등).
 *
 * 3주기:
 *   ① 적재 스캔(5분): kakao_templates(APPROVED) × gateway_bill_mappings(auto_push_enabled) → desired 행 INSERT(pending)
 *   ② 푸시(1분): pending/재시도 도래분 배치(상한 50) → upsert → 효과 검증(GET 재조회) → synced.
 *      실패=백오프(1m→5m→30m→2h→6h), 8회 초과=failed + sendSystemAlert
 *   ③ 대조(6h): bill별 GET 전량 ↔ desired diff(4필드) — 고아 행 표시(자동 삭제 절대 X — 0611 원칙),
 *      드리프트=pending 재전환+알림, last_seen_at 갱신
 *
 * 게이트 2중 (§4-9-C 4·5):
 *   - GATEWAY_TMPL_SYNC_ENABLED=false(기본) → 자동 주기 전부 무동작 (배포≠가동)
 *   - GATEWAY_TMPL_54_ENABLED=false(기본) → server='54' 행은 네트워크 호출 skip
 *     (강문희 54 포팅 + P0001 한글 왕복 실측 통과 후에만 true — EUC-KR·latin1 리스크)
 *
 * 테이블 부재(DDL 미실행) = 조용히 skip — 배포 1회 원칙 양립 패턴 (LESSONS_BACKEND).
 * 발송 경로 무접촉(§4-9-C 7) — 이 워커는 매핑 등록만 한다.
 */

import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';
import {
  GatewayServer,
  buildMappingPayload,
  upsertMappingWithVerify,
  getGatewayMappings,
  computeBackoffMs,
  diffMappingFields,
  MAX_PUSH_ATTEMPTS,
} from './gateway-template-mapping';

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const PUSH_INTERVAL_MS = 60 * 1000;
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 90 * 1000;
const PUSH_BATCH_LIMIT = 50;

function log(...args: any[]) {
  console.log('[gateway-template-mapping-worker]', ...args);
}

export function isGatewaySyncEnabled(): boolean {
  return String(process.env.GATEWAY_TMPL_SYNC_ENABLED || '').trim() === 'true';
}

export function isGateway54Enabled(): boolean {
  return String(process.env.GATEWAY_TMPL_54_ENABLED || '').trim() === 'true';
}

/** 테이블 부재(DDL 미실행) 판정 — 워커는 조용히 skip, 라우트는 503 (db_alter_safety_net) */
export function isMissingRelationError(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'));
}

// ────────────────────────────────────────────────────────────
// ① 적재 스캔 — desired 행 생성
// ────────────────────────────────────────────────────────────

export interface ScanPassResult {
  inserted: number;
  skipped: boolean;
}

/**
 * 승인 확정 템플릿 × auto_push 허용 bill → 없는 desired 행 INSERT(pending).
 * usemod = bill의 default_usemod(신규 행 전용 — 기존 행 usemod 불변 §4-9-C 3),
 * senderkey = 템플릿 profile의 profile_key, tran_tmplcd = tmplcd 복사(§4-9-C 1).
 * ON CONFLICT (bill_id, tmplcd) DO NOTHING — 기존 행(seed 포함) 무접촉 멱등.
 */
export async function runScanPass(): Promise<ScanPassResult> {
  try {
    const r = await query(
      `INSERT INTO gateway_template_mappings
         (bill_id, server, tmplcd, tran_tmplcd, senderkey, billnm, usemod,
          company_id, kakao_template_id, source, sync_status)
       SELECT b.bill_id, b.server, t.template_code, t.template_code, p.profile_key, b.bill_name, b.default_usemod,
              t.company_id, t.id, 'auto', 'pending'
         FROM kakao_templates t
         JOIN gateway_bill_mappings b
           ON b.company_id = t.company_id
          AND b.auto_push_enabled = true
          AND b.is_active = true
         JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.status = 'APPROVED'
          AND t.template_code IS NOT NULL
          AND btrim(t.template_code) <> ''
       ON CONFLICT (bill_id, tmplcd) DO NOTHING`,
    );
    const inserted = r.rowCount || 0;
    if (inserted > 0) log(`적재 스캔 — 신규 desired ${inserted}건 (pending)`);
    return { inserted, skipped: false };
  } catch (err: any) {
    if (isMissingRelationError(err)) return { inserted: 0, skipped: true };
    throw err;
  }
}

// ────────────────────────────────────────────────────────────
// ② 푸시 — pending → upsert → 효과 검증 → synced
// ────────────────────────────────────────────────────────────

export interface PushPassResult {
  picked: number;
  synced: number;
  retried: number;
  failed: number;
  held54: number;
  skipped: boolean;
  authErrorHalt: boolean;
}

export async function runPushPass(): Promise<PushPassResult> {
  const result: PushPassResult = {
    picked: 0, synced: 0, retried: 0, failed: 0, held54: 0, skipped: false, authErrorHalt: false,
  };

  let rows: any[];
  try {
    const r = await query(
      `SELECT id, bill_id, server, tmplcd, tran_tmplcd, senderkey, billnm, usemod, attempts
         FROM gateway_template_mappings
        WHERE sync_status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY updated_at ASC
        LIMIT $1`,
      [PUSH_BATCH_LIMIT],
    );
    rows = r.rows;
  } catch (err: any) {
    if (isMissingRelationError(err)) return { ...result, skipped: true };
    throw err;
  }

  result.picked = rows.length;
  const allow54 = isGateway54Enabled();

  for (const row of rows) {
    const server = String(row.server) as GatewayServer;

    // 54 게이트: P0001 한글 왕복 실측 통과 전 = 네트워크 호출 자체를 보류(pending 유지·attempts 미증가)
    if (server === '54' && !allow54) {
      result.held54 += 1;
      continue;
    }

    const built = buildMappingPayload({
      billid: row.bill_id,
      senderkey: row.senderkey,
      usemod: row.usemod,
      tmplcd: row.tmplcd,
      tran_tmplcd: row.tran_tmplcd,
      billnm: row.billnm,
    });

    if (!built.ok) {
      // payload 결함 = 재시도 무의미 — failed 확정 + 알림 (데이터 정정 후 수동 재개)
      await markFailed(row.id, `payload 결함: ${built.error}`);
      result.failed += 1;
      await sendSystemAlert({
        dedupKey: `gtm-payload:${row.bill_id}:${row.tmplcd}`,
        message: `게이트웨이 매핑 payload 결함 — bill=${row.bill_id} tmplcd=${row.tmplcd} (${built.error})`,
      });
      continue;
    }

    try {
      const verify = await upsertMappingWithVerify(server, built.payload);

      if (verify.verified) {
        await query(
          `UPDATE gateway_template_mappings
              SET sync_status = 'synced', last_synced_at = now(), last_seen_at = now(),
                  next_retry_at = NULL, last_error = NULL, updated_at = now()
            WHERE id = $1`,
          [row.id],
        );
        result.synced += 1;
        continue;
      }

      // 인증 오류(21) = 전 호출 공통 결함 — 이번 패스 중단 + 즉시 알림 (행별 attempts 소모 방지)
      if (verify.upsert.code === '21') {
        result.authErrorHalt = true;
        await sendSystemAlert({
          dedupKey: 'gtm-auth-error',
          message: `게이트웨이 매핑 인증 오류(21) — GATEWAY_TMPL_API_TOKEN 확인 필요 (server=${server})`,
        });
        log(`인증 오류(21) — 푸시 패스 중단 (server=${server})`);
        break;
      }

      const permanent = !verify.upsert.ok && !verify.upsert.retryable;
      await handlePushFailure(row, verify.error || verify.upsert.message, permanent, result);
    } catch (err: any) {
      // 네트워크 예외(타임아웃·무응답 reject 포함) = 재시도 가능 — 멱등 upsert라 안전 (§4-9-C 8)
      await handlePushFailure(row, `호출 예외: ${err?.message || err}`, false, result);
    }
  }

  if (result.picked > 0) {
    log(
      `푸시 — picked=${result.picked} synced=${result.synced} retried=${result.retried} failed=${result.failed} held54=${result.held54}${result.authErrorHalt ? ' AUTH-HALT' : ''}`,
    );
  }
  return result;
}

async function handlePushFailure(
  row: any,
  errorMsg: string,
  permanent: boolean,
  result: PushPassResult,
): Promise<void> {
  const attempts = (Number(row.attempts) || 0) + 1;
  const backoff = permanent ? null : computeBackoffMs(attempts);

  if (backoff === null) {
    await markFailed(row.id, errorMsg, attempts);
    result.failed += 1;
    await sendSystemAlert({
      dedupKey: `gtm-failed:${row.bill_id}:${row.tmplcd}`,
      message: `게이트웨이 매핑 push ${permanent ? '영구 오류' : `${MAX_PUSH_ATTEMPTS}회 초과`} — bill=${row.bill_id} tmplcd=${row.tmplcd} (${errorMsg.slice(0, 80)})`,
    });
    return;
  }

  await query(
    `UPDATE gateway_template_mappings
        SET attempts = $2, next_retry_at = now() + ($3 || ' milliseconds')::interval,
            last_error = $4, updated_at = now()
      WHERE id = $1`,
    [row.id, attempts, String(backoff), errorMsg.slice(0, 500)],
  );
  result.retried += 1;
}

async function markFailed(id: string, errorMsg: string, attempts?: number): Promise<void> {
  await query(
    `UPDATE gateway_template_mappings
        SET sync_status = 'failed', attempts = COALESCE($3, attempts), next_retry_at = NULL,
            last_error = $2, updated_at = now()
      WHERE id = $1`,
    [id, errorMsg.slice(0, 500), attempts ?? null],
  );
}

// ────────────────────────────────────────────────────────────
// ③ 대조 — 게이트웨이 전량 ↔ desired diff (안전망, 6원칙 ③)
// ────────────────────────────────────────────────────────────

export interface ReconcileBillReport {
  billId: string;
  server: GatewayServer;
  remoteCount: number;
  desiredCount: number;
  matched: number;
  orphans: string[];      // 게이트웨이에만 있는 tmplcd — 표시만(자동 삭제 절대 X)
  drifts: string[];       // 필드 불일치 → pending 재전환
  missingOnGateway: string[]; // synced인데 게이트웨이 부재 → pending 재전환
  queryError?: string;
}

export interface ReconcilePassResult {
  bills: ReconcileBillReport[];
  held54: number;
  skipped: boolean;
}

export async function runReconcilePass(onlyBillId?: string): Promise<ReconcilePassResult> {
  const result: ReconcilePassResult = { bills: [], held54: 0, skipped: false };

  let bills: any[];
  try {
    const r = await query(
      `SELECT bill_id, server FROM gateway_bill_mappings
        WHERE is_active = true ${onlyBillId ? 'AND bill_id = $1' : ''}
        ORDER BY bill_id`,
      onlyBillId ? [onlyBillId] : [],
    );
    bills = r.rows;
  } catch (err: any) {
    if (isMissingRelationError(err)) return { ...result, skipped: true };
    throw err;
  }

  const allow54 = isGateway54Enabled();

  for (const bill of bills) {
    const server = String(bill.server) as GatewayServer;
    if (server === '54' && !allow54) {
      result.held54 += 1;
      continue;
    }
    result.bills.push(await reconcileOneBill(String(bill.bill_id), server));
  }

  const totOrphan = result.bills.reduce((s, b) => s + b.orphans.length, 0);
  const totDrift = result.bills.reduce((s, b) => s + b.drifts.length + b.missingOnGateway.length, 0);
  if (result.bills.length > 0) {
    log(`대조 — bills=${result.bills.length} orphan=${totOrphan} drift=${totDrift} held54=${result.held54}`);
  }
  if (totDrift > 0) {
    await sendSystemAlert({
      dedupKey: 'gtm-drift',
      message: `게이트웨이 매핑 대조 드리프트 ${totDrift}건 감지 — pending 재전환됨 (bills=${result.bills.length})`,
    });
  }
  return result;
}

async function reconcileOneBill(billId: string, server: GatewayServer): Promise<ReconcileBillReport> {
  const report: ReconcileBillReport = {
    billId, server, remoteCount: 0, desiredCount: 0, matched: 0,
    orphans: [], drifts: [], missingOnGateway: [],
  };

  let remoteRows: any[];
  try {
    const call = await getGatewayMappings(server, billId);
    if (!call.classified.ok) {
      report.queryError = call.classified.message;
      return report;
    }
    remoteRows = call.rows;
  } catch (err: any) {
    report.queryError = String(err?.message || err);
    return report;
  }
  report.remoteCount = remoteRows.length;

  const desiredRes = await query(
    `SELECT id, tmplcd, tran_tmplcd, usemod, billnm, sync_status
       FROM gateway_template_mappings
      WHERE bill_id = $1`,
    [billId],
  );
  const desiredByTmplcd = new Map<string, any>();
  for (const d of desiredRes.rows) desiredByTmplcd.set(String(d.tmplcd).trim(), d);
  report.desiredCount = desiredRes.rows.length;

  const remoteTmplcds = new Set<string>();

  for (const remote of remoteRows) {
    const tmplcd = String(remote?.tmplcd ?? '').trim();
    if (!tmplcd) continue; // 0720 결함 당시 산물(빈 tmplcd 행) — 매칭 불가·무해, 리포트만
    remoteTmplcds.add(tmplcd);
    const desired = desiredByTmplcd.get(tmplcd);

    if (!desired) {
      // 게이트웨이에만 있는 행 = 고아 — 표시만. 삭제는 사람이 웹관리자에서(0611 원칙 §4-1).
      // 우리 시스템 밖(수동 등록 등)에서 생긴 행이므로 source='manual'로 기록. GET 응답에 senderkey가
      // 없어(§4-9-E) senderkey는 빈 값 — orphan은 push 대상이 아니라(pending만 push) 전송될 일 없음.
      report.orphans.push(tmplcd);
      await query(
        `INSERT INTO gateway_template_mappings
           (bill_id, server, tmplcd, tran_tmplcd, senderkey, billnm, usemod, source, sync_status, last_seen_at)
         VALUES ($1, $2, $3, $4, '', $5, $6, 'manual', 'orphan', now())
         ON CONFLICT (bill_id, tmplcd) DO UPDATE SET last_seen_at = now(), updated_at = now()`,
        [
          billId, server, tmplcd,
          String(remote?.tran_tmplcd ?? '').trim(),
          String(remote?.billnm ?? '').trim(),
          String(remote?.usemod ?? '').trim(),
        ],
      );
      continue;
    }

    if (desired.sync_status === 'synced') {
      const mismatches = diffMappingFields(
        { tmplcd: desired.tmplcd, tran_tmplcd: desired.tran_tmplcd, usemod: desired.usemod, billnm: desired.billnm },
        remote,
      );
      if (mismatches.length > 0) {
        report.drifts.push(tmplcd);
        await query(
          `UPDATE gateway_template_mappings
              SET sync_status = 'pending', next_retry_at = now(), attempts = 0,
                  last_error = $2, last_seen_at = now(), updated_at = now()
            WHERE id = $1`,
          [desired.id, `대조 드리프트: [${mismatches.join(', ')}] 게이트웨이 실값과 불일치`],
        );
        continue;
      }
    }

    report.matched += 1;
    await query(
      `UPDATE gateway_template_mappings SET last_seen_at = now() WHERE id = $1`,
      [desired.id],
    );
  }

  // desired는 synced인데 게이트웨이에 없는 행 = 드리프트 → pending 재전환 (재push로 수렴)
  for (const [tmplcd, desired] of desiredByTmplcd) {
    if (remoteTmplcds.has(tmplcd)) continue;
    if (desired.sync_status === 'synced') {
      report.missingOnGateway.push(tmplcd);
      await query(
        `UPDATE gateway_template_mappings
            SET sync_status = 'pending', next_retry_at = now(), attempts = 0,
                last_error = '대조: 게이트웨이에 행 부재 — 재push', updated_at = now()
          WHERE id = $1`,
        [desired.id],
      );
    } else if (desired.sync_status === 'orphan') {
      // 고아 표시 행이 게이트웨이에서 사라짐(운영자가 웹관리자에서 삭제) → 우리 표시 행만 정리
      await query(`DELETE FROM gateway_template_mappings WHERE id = $1 AND sync_status = 'orphan'`, [desired.id]);
    }
  }

  return report;
}

// ────────────────────────────────────────────────────────────
// 워커 기동 (app.ts start* 패턴 — kakao-template-sync-worker 미러)
// ────────────────────────────────────────────────────────────

let _scanTimer: NodeJS.Timeout | null = null;
let _pushTimer: NodeJS.Timeout | null = null;
let _reconcileTimer: NodeJS.Timeout | null = null;
let _boot: NodeJS.Timeout | null = null;
let _scanRunning = false;
let _pushRunning = false;
let _reconcileRunning = false;

async function guardedRun(
  label: string,
  isRunning: () => boolean,
  setRunning: (v: boolean) => void,
  fn: () => Promise<unknown>,
): Promise<void> {
  if (!isGatewaySyncEnabled()) return; // 마스터 게이트 — 배포≠가동 (§4-9-C 5)
  if (isRunning()) return;
  setRunning(true);
  try {
    await fn();
  } catch (err: any) {
    log(`${label} 오류:`, err?.message || err);
  } finally {
    setRunning(false);
  }
}

export function startGatewayTemplateMappingWorker(): void {
  if (_boot || _scanTimer) return;
  const enabled = isGatewaySyncEnabled();
  log(
    `started — SYNC_ENABLED=${enabled} 54_ENABLED=${isGateway54Enabled()}` +
      (enabled ? ` (boot ${BOOT_DELAY_MS / 1000}s 후 주기: 적재 5m·푸시 1m·대조 6h)` : ' — 마스터 게이트 OFF, 자동 주기 무동작'),
  );
  _boot = setTimeout(() => {
    _boot = null;
    _scanTimer = setInterval(
      () => guardedRun('적재', () => _scanRunning, (v) => { _scanRunning = v; }, runScanPass),
      SCAN_INTERVAL_MS,
    );
    _pushTimer = setInterval(
      () => guardedRun('푸시', () => _pushRunning, (v) => { _pushRunning = v; }, runPushPass),
      PUSH_INTERVAL_MS,
    );
    _reconcileTimer = setInterval(
      () => guardedRun('대조', () => _reconcileRunning, (v) => { _reconcileRunning = v; }, () => runReconcilePass()),
      RECONCILE_INTERVAL_MS,
    );
    // 부팅 직후 1회 — 게이트 ON일 때만 동작
    guardedRun('적재', () => _scanRunning, (v) => { _scanRunning = v; }, runScanPass);
  }, BOOT_DELAY_MS);
}

export function stopGatewayTemplateMappingWorker(): void {
  if (_boot) { clearTimeout(_boot); _boot = null; }
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null; }
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_reconcileTimer) { clearInterval(_reconcileTimer); _reconcileTimer = null; }
  log('stopped');
}
