/**
 * ★2026-10-22 오류접수(서수란) — 이메일 대행 승인 뒤 취소하면 고객 발송결과에 「직접발송(실패)」로 보였다.
 *
 * 경로(실측 10/19 · 10/20 담당자 링크 취소 2건): 예약 대행 캠페인은 예약 시각까지 'scheduled' →
 *   대행 취소 = 캠페인 취소 CT queueOnly(큐만 지우고 상태는 둔다) → 예약 시각 +10분 예약 정리가 큐 0건을 'failed'로 굳혔다.
 * 처방: queueOnly 가 실제로 막은 예약(지운 대기 > 0 · 픽업 0 · 대기를 떠난 행 0)이면 정산 CT confirmQueueOnlyCancel 이
 *   캠페인을 'cancelled'로 확정한다(상태만 · 돈은 건수 환불이 끝냈다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock('../sms-queue', () => ({
  getCampaignSmsTables: vi.fn(async () => ['SMSQ_SEND_1']),
  smsCampaignCountsSafe: vi.fn(),
  smsCountAll: vi.fn(),
}));
vi.mock('../prepaid', () => ({ prepaidRefund: vi.fn(), REFUND_KEYS: { CANCEL: 'cancel' } }));
vi.mock('../system-alert', () => ({ sendSystemAlert: vi.fn() }));

import { query } from '../../config/database';
import { smsCountAll } from '../sms-queue';
import { confirmQueueOnlyCancel } from '../cancel-settle';

const q = query as unknown as ReturnType<typeof vi.fn>;
const started = smsCountAll as unknown as ReturnType<typeof vi.fn>;

const camp = (status: string) => ({ id: 'c1', company_id: 'co1', created_by: 'u1', status, created_at: '2026-10-20T05:08:00Z', scheduled_at: '2026-10-20T06:10:00Z' });
const cancel = { cancelledBy: null, cancelledByType: 'agency_link', reason: null };
const updates = () => q.mock.calls.map((c: any[]) => String(c[0]));

beforeEach(() => {
  q.mockReset();
  started.mockReset();
});

describe('confirmQueueOnlyCancel — 막은 예약 = 취소 확정(상태만)', () => {
  it('scheduled · 대기를 떠난 행 0 → cancelled 로 확정하고 실행 행도 취소한다', async () => {
    started.mockResolvedValue(0);
    q.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 1 });
    expect(await confirmQueueOnlyCancel({ camp: camp('scheduled'), liveTables: ['SMSQ_SEND_1'], refDates: [new Date()], cancel })).toBe(true);
    const [upd, runs] = updates();
    expect(upd).toContain("SET status = 'cancelled'");
    expect(upd).toContain("WHERE id = $4 AND status = 'scheduled'");
    expect(q.mock.calls[0][1]).toEqual([null, 'agency_link', null, 'c1']);
    expect(runs).toContain("UPDATE campaign_runs SET status = 'cancelled'");
  });

  it('대기를 떠난 행이 있으면(발송 시작) 바꾸지 않는다 — 예약 정리가 completed 로 넘겨 청구가 남는다', async () => {
    started.mockResolvedValue(2);
    expect(await confirmQueueOnlyCancel({ camp: camp('scheduled'), liveTables: [], refDates: [new Date()], cancel })).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });

  it('completed(즉시 발송 대행)는 건드리지 않는다 — 청구 축', async () => {
    expect(await confirmQueueOnlyCancel({ camp: camp('completed'), liveTables: [], refDates: [new Date()], cancel })).toBe(false);
    expect(started).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
  });

  it('그 사이 상태가 바뀌었으면(갱신 0행) 실행 행을 건드리지 않는다', async () => {
    started.mockResolvedValue(0);
    q.mockResolvedValueOnce({ rowCount: 0 });
    expect(await confirmQueueOnlyCancel({ camp: camp('scheduled'), liveTables: [], refDates: [new Date()], cancel })).toBe(false);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('돈을 움직이지 않는다 — 환불 함수를 부르지 않는다', async () => {
    const src = readFileSync(join(__dirname, '..', 'cancel-settle.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function confirmQueueOnlyCancel('));
    expect(fn).not.toContain('prepaidRefund');
    expect(fn).not.toContain('settleCancelledLoadRefund');
  });
});

describe('취소 CT — queueOnly 끝에서만 · 실제로 막았을 때만 부른다', () => {
  const src = readFileSync(join(__dirname, '..', 'campaign-lifecycle.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function cancelCampaign('), src.indexOf('// ===== 결과 동기화 ====='));
  const qo = body.slice(body.indexOf('if (queueOnly) {\r') >= 0 ? body.indexOf('if (queueOnly) {\r') : body.indexOf('if (queueOnly) {\n'));

  it('조건 = 적재 중 아님 · 앞선 표식 없음 · 지운 대기 > 0 · 픽업 0', () => {
    expect(qo).toContain('if (!loadStopped && !stoppedEarlier && totalCancelCount > 0 && alreadyPickedUp === 0) {');
    expect(qo).toContain('await confirmQueueOnlyCancel({ camp, liveTables: cancelTables, refDates, cancel: { cancelledBy, cancelledByType, reason } });');
  });

  it('환불 뒤 · 응답 앞이고 실패해도 취소 응답을 깨지 않는다(try/catch)', () => {
    const iRefund = qo.indexOf('prepaidRefund(');
    const iConfirm = qo.indexOf('confirmQueueOnlyCancel(');
    const iReturn = qo.indexOf('return {');
    expect(iRefund).toBeGreaterThan(-1);
    expect(iConfirm).toBeGreaterThan(iRefund);
    expect(iReturn).toBeGreaterThan(iConfirm);
    expect(qo.slice(qo.indexOf('try {', iConfirm - 200), iReturn)).toContain('} catch (confirmErr');
  });

  it('취소 함수 본문에 취소 UPDATE 를 직접 쓰지 않는다(확정은 정산 CT 한 곳)', () => {
    expect(body).not.toMatch(/UPDATE campaigns SET\s+status = 'cancelled'/);
  });
});
