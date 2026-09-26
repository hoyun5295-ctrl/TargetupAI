/**
 * 발송이 시작된 캠페인의 취소 (★2026-09-26 한줄로 V2 F35 · Codex 4차 1R high A로 구조 정정)
 *
 * 15분 게이트는 "0 < 남은 분 < 15"만 막아, 예약 시각이 지난 뒤엔 취소가 통과했다. 옛 취소는 삭제 전에 센 대기 수로 환불하고
 * 결과와 무관하게 'cancelled'로 확정해, 이미 나간 발송이 청구(status='completed'만)와 정산 스위퍼(취소 제외)에서 빠졌다.
 * 1R 처방(라이브의 픽업 행 수로 사전 거절)은 ①세고 지우는 사이의 픽업 ②이력으로 넘어간 분할 발송 앞 회차를 못 막았다.
 *
 * 못 박는 것
 *   1. 사용자 사전 거절(큐를 건드리기 전) = 예약 시각이 지났고 [적재 중 · 대기를 떠난 행(라이브 비대기 + 이력)]이 있을 때.
 *   2. 상태를 바꾸는 취소는 건수 대신 "사실로 다시 정산하라"는 의무를 남긴다(삭제 전).
 *   3. 대기 삭제·잔존 0 검증 **뒤에** 공용 CT(settleCancelOutcome)가 결말을 가른다 — 나간 행이 있으면 발송 캠페인으로 넘기고 거절 응답,
 *      없으면 CT가 취소 확정 + 전체 기준 환불. 이 함수 안에 무조건 cancelled로 바꾸는 UPDATE가 남아 있으면 안 된다.
 *   4. 대행(queueOnly)은 상태를 안 바꾸므로 종전 그대로(건수 의무 · 건수 환불).
 *   5. 재시도 워커는 새 의무를 같은 CT로 정산한다(옛 건수 의무는 종전 그대로).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'campaign-lifecycle.ts'), 'utf8');
const body = src.slice(src.indexOf('export async function cancelCampaign('), src.indexOf('// ===== 결과 동기화 ====='));
const worker = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');

describe('사용자 사전 거절', () => {
  it('예약 시각이 지났고 적재 중이면 적재 중단 표식보다 먼저 tooLate(거절한 취소가 워커를 멈추면 안 된다)', () => {
    const i = body.indexOf('if (!skipTimeCheck && !queueOnly && scheduledPassed && isLoadingSendPhase(camp.send_phase)) {');
    expect(i).toBeGreaterThan(-1);
    expect(body.slice(i, i + 300)).toMatch(/return \{ success: false, error: '[^']+', tooLate: true, cancelledCount: 0, refundedAmount: 0 \};/);
    expect(i).toBeLessThan(body.indexOf("'{refundPendingCancel}'"));
  });

  it('상태를 바꾸는 취소는 기존 의무(배포 전 건수형 포함)가 있어도 정산 모드로 덮는다 · 최초 건수 보존은 대행만 (Codex 4차 4R)', () => {
    const iUpd = body.indexOf("'{refundPendingCancel}'");
    const blk = body.slice(body.lastIndexOf('const setObligation', iUpd), body.indexOf('} catch (obligationErr', iUpd));
    expect(blk).toMatch(/const setObligation = queueOnly\s*\?/);
    // 대행 = CASE로 기존 의무 보존 · 상태를 바꾸는 취소 = 그대로 덮기
    expect(blk).toContain("CASE WHEN send_config ? 'refundPendingCancel'");
    expect(blk).toContain("`jsonb_set(COALESCE(send_config, '{}'::jsonb), '{refundPendingCancel}', $2::jsonb)`");
  });

  it('상태를 바꾸는 취소의 적재 중단 표식은 정산 의무와 같은 UPDATE(워커가 표식을 보면 반드시 의무 표시도 본다 · Codex 4차 3R)', () => {
    expect(body).toContain('const markLoadStop = !queueOnly && isLoadingSendPhase(camp.send_phase);');
    const iUpd = body.indexOf("'{refundPendingCancel}'");
    const upd = body.slice(body.lastIndexOf('await query(', iUpd), body.indexOf('} catch (obligationErr', iUpd));
    expect(upd).toContain("markLoadStop ? `jsonb_set(${setObligation}, '{${LOAD_CANCEL_FLAG}}', 'true'::jsonb)` : setObligation");
    expect(body).toMatch(/if \(markLoadStop\) loadStopped = true;/);
  });

  it('예약 시각이 지났고 대기를 떠난 행(이력 포함)이 있으면 tooLate', () => {
    const i = body.indexOf('if (!skipTimeCheck && !queueOnly && scheduledPassed) {');
    expect(i).toBeGreaterThan(-1);
    const guard = body.slice(i, body.indexOf('// ★ 2026-07-27 (B-0727-2): 환불 의무를', i));
    expect(guard).toContain('countCampaignStartedRows(companyId, camp.created_by || \'\', campaignId, cancelTables, refDates)');
    expect(guard).toMatch(/return \{ success: false, error: '[^']+', tooLate: true, cancelledCount: 0, refundedAmount: 0 \};/);
  });

  it('거절은 큐를 건드리기 전(환불 의무 기록·DELETE보다 앞)', () => {
    const iGuard = body.indexOf('if (!skipTimeCheck && !queueOnly && scheduledPassed) {');
    expect(iGuard).toBeLessThan(body.indexOf("'{refundPendingCancel}'"));
    expect(iGuard).toBeLessThan(body.indexOf('DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100'));
  });
});

describe('상태를 바꾸는 취소의 결말', () => {
  it('의무는 삭제 전에 남긴다 — 상태를 바꾸는 취소 = 정산 모드 · 대행 = 종전 건수', () => {
    const iObl = body.indexOf("'{refundPendingCancel}'");
    expect(iObl).toBeLessThan(body.indexOf('DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100'));
    expect(body).toContain('const writeObligation = !queueOnly || totalCancelCount > 0;');
    expect(body).toMatch(/queueOnly\s*\?\s*\{\s*state: 'prepared',\s*sms: \{ count: cancelCount, messageType: camp\.message_type \}/);
    expect(body).toContain("{ state: 'prepared', mode: CANCEL_SETTLE_MODE, at: new Date().toISOString() }");
  });

  it('대기 삭제·잔존 0 검증 뒤에 공용 CT가 가른다 · 나간 행이 있으면 거절 응답', () => {
    const iVerify = body.indexOf("const remainingPending = await smsCountAll(cancelTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);");
    const iSettle = body.indexOf('await settleCancelOutcome({');
    expect(iVerify).toBeGreaterThan(-1);
    expect(iSettle).toBeGreaterThan(iVerify);
    const after = body.slice(iSettle);
    expect(after).toMatch(/if \(settled\.outcome === 'sent'\) \{\s*return \{ success: false, error: '[^']+', tooLate: true, cancelledCount: 0, refundedAmount: 0 \};/);
    expect(after).toContain('refundedAmount: settled.refunded');
  });

  it('무조건 cancelled로 바꾸는 UPDATE가 이 함수에 남아 있지 않다(결말은 CT가 정한다)', () => {
    expect(body).not.toMatch(/UPDATE campaigns SET\s+status = 'cancelled'/);
    expect(body).not.toMatch(/UPDATE campaign_runs SET\s+status = 'cancelled'/);
  });

  it('대행(queueOnly)의 건수 환불은 대행 분기 안에서만', () => {
    const iQ = body.indexOf('if (queueOnly) {', body.indexOf('const remainingPending'));
    const iSettle = body.indexOf('await settleCancelOutcome({');
    expect(iQ).toBeGreaterThan(-1);
    expect(iQ).toBeLessThan(iSettle);
    const q = body.slice(iQ, iSettle);
    expect(q).toContain("'예약 취소 환불', 'campaign',");
    expect(q).toContain('alreadySent:');
  });
});

describe('적재 중 취소의 결말은 적재 주체(워커)가 정한다 (Codex 4차 2R high)', () => {
  it('적재 중이고 예약 시각이 지났거나 슈퍼관리자 취소면 결말 판정 전에 위임 응답(대기 삭제·의무 승격 뒤)', () => {
    const iDefer = body.indexOf('if (loadStopped && (scheduledPassed || skipTimeCheck)) {');
    expect(iDefer).toBeGreaterThan(body.indexOf('const remainingPending'));
    expect(iDefer).toBeLessThan(body.indexOf('await settleCancelOutcome({'));
    expect(body.slice(iDefer, iDefer + 400)).toContain('deferred: true');
  });

  it('워커 취소 분기: 정산 모드 의무가 있으면 상태와 무관하게 결말 CT 하나로 · 그 밖(대행·옛 의무)은 종전 전체 기준 정산 (Codex 4차 3R)', () => {
    const branch = worker.slice(worker.indexOf('if (fin.rowCount === 0) {'), worker.indexOf('// ★ 2026-07-27 (B-0727-1): 환불 미완료 표시'));
    expect(branch).toContain("send_config->'refundPendingCancel'->>'mode' AS cancel_mode");
    expect(branch).toContain('if (freshCamp?.cancel_mode === CANCEL_SETTLE_MODE) {');
    expect(branch).not.toContain("st === 'scheduled'");
    expect(branch).toContain('settleCancelOutcome({ camp: freshCamp, liveTables: companyTables, refDates })');
    expect(branch).toContain('settleCancelledLoadRefund({');
    // 대기 삭제가 결말 판정보다 먼저
    expect(branch.indexOf('DELETE FROM SMSQ_SEND')).toBeLessThan(branch.indexOf('settleCancelOutcome('));
  });
});

describe('취소 환불 재시도 워커', () => {
  // ★ Codex 4차 5R — 캠페인별 처리는 processCancelObligation로 뺐다(재시도 함수 + 처리 함수를 함께 본다)
  const fn = () => worker.slice(worker.indexOf('async function processCancelObligation('), worker.indexOf('async function retryPendingRefunds('));

  it('캠페인 단위 취소 의무 잠금 안에서 의무를 다시 읽고 처리한다 · 취소 CT의 의무 기록도 같은 잠금 (Codex 4차 5R)', () => {
    const f = fn();
    const loop = f.slice(f.indexOf('async function retryPendingCancelRefunds('));
    expect(loop).toContain('await withCancelObligationLock(cand.id, async () => {');
    const inLock = loop.slice(loop.indexOf('await withCancelObligationLock(cand.id, async () => {'));
    expect(inLock).toContain("FROM campaigns WHERE id = $1 AND send_config ? 'refundPendingCancel'");
    expect(inLock).toMatch(/if \(row\.rp\?\.mode === CANCEL_SETTLE_MODE && isLoadingSendPhase\(row\.send_phase\)\) return;/);
    expect(inLock).toContain('await processCancelObligation(row);');
    expect(body).toContain('await withCancelObligationLock(campaignId, () => query(');
  });

  it('정산 모드 의무는 같은 CT로 결말을 다시 가른다 · 끝나면 해제 · 아니면 backoff', () => {
    const f = fn();
    expect(f).toContain('if (rp.mode === CANCEL_SETTLE_MODE) {');
    const i = f.indexOf('if (rp.mode === CANCEL_SETTLE_MODE) {');
    const branch = f.slice(i, f.indexOf('// ★ 2026-07-30: 브랜드 슬롯', i));
    expect(branch).toContain('settleCancelOutcome({ camp: row, liveTables: tables, refDates: campaignRefDates(row) })');
    expect(branch).toMatch(/if \(settled\.ok\) \{ await clear\(\); return; \}/);
  });

  it('정산 모드 판정은 대기 잔존 확인(prepared → ready) 뒤다', () => {
    const f = fn();
    expect(f.indexOf("if (rp.state !== 'ready') {")).toBeLessThan(f.indexOf('if (rp.mode === CANCEL_SETTLE_MODE) {'));
  });

  it('후보 조회가 결말 판정에 필요한 열을 함께 읽는다', () => {
    expect(fn()).toMatch(/SELECT id, company_id, created_by, status, send_channel, message_type, created_at, scheduled_at, send_phase, send_config,/);
  });

  it('적재 중 정산 모드 의무는 후보 조회에서 한도 적용 전에 뺀다(적재 주체가 먼저 정한다 · 다른 의무를 굶기지 않는다 · Codex 4차 3R)', () => {
    const f = fn();
    const sel = f.slice(f.indexOf('const rows = await query('), f.indexOf('LIMIT 20'));
    expect(sel).toContain(`AND NOT (send_config->'refundPendingCancel'->>'mode' = '\${CANCEL_SETTLE_MODE}' AND COALESCE(send_phase, '') IN (\${LOADING_SEND_PHASES_SQL}))`);
    // 루프 안 대기 장치는 걷었다(구조로 대체)
    expect(f).not.toContain('if (isLoadingSendPhase(row.send_phase)) continue;');
  });
});
