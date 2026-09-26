/**
 * 큐만 지우는 취소(queueOnly)가 적재 워커를 멈춘다 (★2026-09-26 한줄로 V2 F10·F31·F32)
 *
 * 대행발송 취소는 청구 축(status='completed') 때문에 캠페인 상태를 바꾸지 않는다(queueOnly · 0828).
 * 그런데 직접발송 워커는 status='cancelled'만 보고 적재를 멈춰, 적재가 끝나기 전의 대행 취소가 워커에 전해지지 않았다.
 *   F32 적재 전(queued) 취소 = 큐 0건 → "이미 발송" 409로 거절 → 워커가 전량 적재 → 예약 시각에 발송·과금
 *   F10·F31 적재 중(processing) 취소 = 그때까지 적재분만 지우고 워커는 계속 적재 → 늦은 조각은 CANCEL 항아리 누적 목표에 삼켜져 환불 부족
 * 처방: 적재가 끝나지 않은 캠페인(preparing·queued·processing)에 queueOnly 취소가 오면 send_config.loadCancelled 표식을 남기고,
 *   워커는 그 표식을 취소와 같게 본다(선점 · 루프 · 종결 직전 · 종결 UPDATE) → 적재 중단 + 캠페인 전체 기준 정산(차감 − 남은 행).
 *   표식을 남긴 취소는 "이미 발송"이 아니다(워커가 막고 정산한다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isLoadingSendPhase, isLoadStopped, NOT_LOAD_STOPPED_SQL, LOAD_CANCELLED_SELECT } from '../load-cancel';

const lifecycle = readFileSync(join(__dirname, '..', 'campaign-lifecycle.ts'), 'utf8');
const worker = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');

describe('적재 중단 표식 CT', () => {
  it('적재가 끝나지 않은 단계 = preparing · queued · processing', () => {
    for (const p of ['preparing', 'queued', 'processing']) expect(isLoadingSendPhase(p)).toBe(true);
    for (const p of ['sent', 'failed', null, undefined, '']) expect(isLoadingSendPhase(p)).toBe(false);
  });

  it('중단 = 취소 상태 또는 표식(참·문자 true)', () => {
    expect(isLoadStopped('cancelled', null)).toBe(true);
    expect(isLoadStopped('scheduled', true)).toBe(true);
    expect(isLoadStopped('completed', 'true')).toBe(true);
    expect(isLoadStopped('scheduled', null)).toBe(false);
    expect(isLoadStopped('sending', false)).toBe(false);
  });

  it('SQL 조각이 같은 키를 읽는다', () => {
    expect(NOT_LOAD_STOPPED_SQL).toBe("status != 'cancelled' AND COALESCE((send_config->>'loadCancelled')::boolean, false) = false");
    expect(LOAD_CANCELLED_SELECT).toBe("(send_config->>'loadCancelled') = 'true' AS load_cancelled");
  });
});

describe('취소 CT — queueOnly가 적재 중 캠페인에 표식을 남긴다', () => {
  const body = () => lifecycle.slice(lifecycle.indexOf('export async function cancelCampaign('), lifecycle.indexOf('// ===== 결과 동기화 ====='));

  it('queueOnly + 적재 중 단계면 큐 확인보다 먼저 표식을 남긴다', () => {
    const b = body();
    const iFlag = b.indexOf("'{${LOAD_CANCEL_FLAG}}', 'true'::jsonb");
    // ★ 2026-09-26 F35(Codex 4차 3R): 상태를 바꾸는 취소의 표식은 정산 의무와 같은 UPDATE로 남긴다 — 이 블록은 대행 전용
    expect(b).toContain('if (queueOnly && isLoadingSendPhase(camp.send_phase)) {');
    expect(iFlag).toBeGreaterThan(0);
    expect(iFlag).toBeLessThan(b.indexOf('const cancelTables = await getCampaignQueueTables('));
  });

  it('표식은 처음 한 번만 쓰고 updated_at을 건드리지 않는다 — 대조 워커의 반복 취소가 끊긴 적재 복구(10분 무활동)를 미루지 않게(Codex 1R high)', () => {
    const b = body();
    const blk = b.slice(b.indexOf('if (queueOnly && isLoadingSendPhase(camp.send_phase)) {'), b.indexOf('loadStopped = true;'));
    const upd = blk.slice(blk.indexOf('`UPDATE campaigns'), blk.indexOf('[campaignId]'));
    expect(upd).toContain('UPDATE campaigns');
    expect(upd).not.toContain('updated_at');
    expect(upd).toContain("AND COALESCE((send_config->>'${LOAD_CANCEL_FLAG}')::boolean, false) = false");
  });

  it('표식을 남긴 취소는 "이미 발송"이 아니다', () => {
    expect(body()).toMatch(/alreadySent:\s*!loadStopped && !stoppedEarlier && totalCancelCount === 0 && alreadyPickedUp === 0/);
  });
});

describe('직접발송 워커 — 표식을 취소와 같게 본다', () => {
  it('선점 시', () => {
    expect(worker).toContain('const cancelledAtClaim = isLoadStopped(c.status, cfg.loadCancelled);');
  });

  it('루프 안 확인', () => {
    const loop = worker.slice(worker.indexOf('while (processed < total) {'), worker.indexOf('const chunkLimit = Math.min(CHUNK, total - processed);'));
    expect(loop).toContain('LOAD_CANCELLED_SELECT');
    expect(loop).toMatch(/if \(isLoadStopped\(cancelCheck\.rows\[0\]\?\.status, cancelCheck\.rows\[0\]\?\.load_cancelled\)\) \{/);
  });

  it('종결 직전 재확인', () => {
    expect(worker).toContain('const skipNotLoadedRefund = cancelledAtClaim || isLoadStopped(statusBeforeRefund.rows[0]?.status, statusBeforeRefund.rows[0]?.load_cancelled);');
  });

  it('종결 UPDATE는 중단된 캠페인을 건너뛰어 취소 정산 분기로 보낸다', () => {
    expect(worker).toContain('WHERE id = $4 AND ${NOT_LOAD_STOPPED_SQL}');
    expect(worker).not.toContain("WHERE id = $4 AND status != 'cancelled'`");
  });
});

/**
 * 표식을 남긴 취소가 다른 이유로 실패하면 접수는 '취소 중'으로 남고, 그사이 워커가 표식을 보고 정산을 끝낸다(큐 0).
 * 그 뒤 취소 마무리 워커·사용자 재시도가 다시 취소 CT를 부르면 큐가 비어 있어 "이미 발송"으로 보고 접수를 예약으로 되돌렸다
 * → 한 통도 안 나갔는데 "이미 발송". 이미 표식이 있는 캠페인은 우리가 멈춘 것이다 — "이미 발송"이 아니다.
 * 대조 워커는 같은 캠페인을 매 주기 다시 중화하므로, "이미 멈춘 것"은 기록을 반복하지 않는다(stoppedEarlier).
 */
describe('이미 적재 중단 표식이 있는 캠페인', () => {
  const body = () => lifecycle.slice(lifecycle.indexOf('export async function cancelCampaign('), lifecycle.indexOf('// ===== 결과 동기화 ====='));
  const campaignSrc = readFileSync(join(__dirname, '..', 'agency-send-campaign.ts'), 'utf8');
  const agencyWorker = readFileSync(join(__dirname, '..', 'agency-send-worker.ts'), 'utf8');

  it('취소 CT는 앞선 표식을 읽어 "이미 발송"으로 보지 않고 stoppedEarlier로 알린다', () => {
    const b = body();
    expect(b).toContain('const stoppedEarlier = queueOnly && !isLoadingSendPhase(camp.send_phase) && isLoadStopped(null, camp.send_config?.[LOAD_CANCEL_FLAG]);');
    expect(b).toMatch(/alreadySent:\s*!loadStopped && !stoppedEarlier && totalCancelCount === 0 && alreadyPickedUp === 0/);
    expect(b).toContain('stoppedEarlier,');
  });

  it('중화 함수가 stoppedEarlier를 그대로 돌려준다', () => {
    expect(campaignSrc).toContain('stoppedEarlier = !!undone.stoppedEarlier;');
    expect(campaignSrc).toContain('return { ok, error, alreadySent, stoppedEarlier };');
  });

  it('대조 워커는 이미 멈춘 캠페인의 반복 회차를 기록하지 않는다', () => {
    expect(agencyWorker).toContain('const { ok, error, alreadySent, stoppedEarlier } = await neutralizeCampaign(');
    expect(agencyWorker).toContain('if (!ok || !(alreadySent || stoppedEarlier) || !row.campaign_id) {');
  });
});
