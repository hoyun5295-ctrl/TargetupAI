/**
 * 이니시스 결제 리턴 콜백 재전송 — 승인·망취소 전에 결제 상태를 본다 (★2026-09-26 한줄로 V2 F03·F25)
 *
 * 리턴 콜백이 두 번 오면(브라우저 재전송 · 재전송 · 이중 제출) 두 번째가 같은 인증 토큰으로 승인을 다시 부르고,
 * 실패하면 망취소를 불렀다. 망취소는 그 토큰의 거래 = 첫 번째로 이미 승인·충전된 거래를 취소한다 → 충전은 남고 카드 대금만 취소.
 * 결제 확정(finalizePaymentSuccess)은 멱등이지만 그 앞의 승인 재호출·망취소는 상태를 보지 않았다.
 *
 * 못 박는 것
 *   1. 같은 주문의 리턴 콜백은 주문번호 단위 잠금 안에서 한 번에 하나씩(동시 이중 제출이 둘 다 승인을 부르지 않게).
 *   2. 승인 전에 결제 상태를 읽는다 — completed = 성공 화면(이미 처리) · pending이 아님 = 실패 화면. 둘 다 승인·망취소를 부르지 않는다.
 *   3. 결제 행이 없거나 pending이면 종전 흐름(승인 → 확정 · 실패면 망취소).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '..', '..', 'routes', 'payments.ts'), 'utf8');
const h = route.slice(route.indexOf("router.post('/inicis/return'"), route.indexOf("router.post('/inicis/close'"));
const proc = readFileSync(join(__dirname, '..', 'payment-processor.ts'), 'utf8');

describe('리턴 콜백 재전송', () => {
  it('주문번호 단위 잠금 안에서 처리한다', () => {
    const iLock = h.indexOf("withKeyedLock('inicis-return', orderId, async () => {");
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(h.indexOf('approveInicisPayment(callback)'));
  });

  it('승인 전에 상태를 읽고, completed·비pending이면 승인·망취소 없이 돌아간다', () => {
    const iState = h.indexOf('const state = await readInicisPaymentState(orderId);');
    const iApprove = h.indexOf('approveInicisPayment(callback)');
    expect(iState).toBeGreaterThan(-1);
    expect(iState).toBeLessThan(iApprove);
    const pre = h.slice(iState, iApprove);
    expect(pre).toMatch(/if \(state && state\.status === 'completed'\) \{[\s\S]*?renderResultHtml\('success'[\s\S]*?alreadyProcessed: true[\s\S]*?return;/);
    expect(pre).toMatch(/if \(state && state\.status !== 'pending'\) \{[\s\S]*?renderResultHtml\('failed'[\s\S]*?return;/);
    expect(pre).not.toContain('netCancelInicisPayment(');
  });

  it('상태 조회 CT는 주문번호·이니시스 행의 상태만 읽는다(잔액·금액을 읽지 않는다 · Codex 5차 1R)', () => {
    const f = proc.slice(proc.indexOf('export async function readInicisPaymentState('), proc.indexOf('// ── 2단계'));
    expect(f).toContain("SELECT status FROM payments WHERE pg_order_id = $1 AND pg_provider = 'inicis'");
    expect(f).not.toContain('balance');
    expect(f).not.toContain('amount');
  });

  it('공개 재전송 응답(인증 앞 경로)에는 완료 여부만 싣는다 — 잔액·금액·결제 id 없음 (Codex 5차 1R high)', () => {
    const iState = h.indexOf('const state = await readInicisPaymentState(orderId);');
    const pre = h.slice(iState, h.indexOf('approveInicisPayment(callback)'));
    expect(pre).not.toMatch(/newBalance|amount:|paymentId/);
    expect(pre).toContain("renderResultHtml('success', { alreadyProcessed: true }, baseUrl)");
  });
});
