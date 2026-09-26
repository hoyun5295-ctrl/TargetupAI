/**
 * 예약 수신자 개별 삭제 환불 계약 (★2026-09-25 한줄로 전수점검 C-05 · Codex 1R·2R)
 *
 * 선차감된 큐 행을 지우기만 하고 환불하지 않았다. 1R에서 즉시 환불을 붙였더니 2R에서
 * "지운 뒤 환불이 실패하면 경보만 남고, 그 뒤 전체 취소 시 삭제분을 아무도 돌려주지 않는다"가 나왔다.
 * 그래서 순서를 고정한다: 캠페인 단위 잠금 → 삭제 뒤 상태 기준 전체 목표 환불 → 환불이 끝나야 삭제.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const route = (() => {
  const at = src.indexOf("router.delete('/:id/recipients/:idx'");
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\nrouter.', at + 10));
})();

describe('예약 수신자 개별 삭제', () => {
  it('캠페인 단위 잠금은 프로세스 안 잠금 CT로 기다리지 않고 잡는다 — 못 잡으면 409 · finally에서 놓는다', () => {
    expect(route).toContain('if (!tryAcquireInflight(deleteLockKey)) {');
    expect(route).toContain('res.status(409)');
    expect(route).toMatch(/finally \{\s*releaseInflight\(deleteLockKey\);\s*\}/);
  });

  it('DB 연결을 쥔 채 환불을 부르지 않는다(Codex 3R high — 중첩 연결 대여로 풀 고갈)', () => {
    expect(route).not.toContain('pool.connect()');
    expect(route).not.toContain('pg_try_advisory_xact_lock');
  });

  it('환불(keepCount · NOT_LOADED)이 큐 삭제보다 먼저이고, 환불 실패면 지우지 않고 503', () => {
    const iRefund = route.indexOf('keepCount: kept');
    const iFail = route.indexOf('res.status(503)');
    const iDelete = route.indexOf('DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND dest_no = ?');
    expect(iRefund).toBeGreaterThan(-1);
    expect(route).toContain('refundKey: REFUND_KEYS.NOT_LOADED, keepCount: kept');
    expect(iFail).toBeGreaterThan(iRefund);
    expect(iDelete).toBeGreaterThan(iFail);
  });

  it('남는 행은 삭제 뒤 기준(축별 대기 − 이 번호의 대기)', () => {
    expect(route).toContain('const kept = Math.max(0, axisWaiting - axisPhone);');
  });

  it('적재 중(preparing·queued·processing)에는 삭제를 막는다 — 큐에 일부만 있어 남는 행을 과소 계산(0926 F22·F23)', () => {
    const iGuard = route.indexOf("['preparing', 'queued', 'processing'].includes(loadingPhase)");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(route.indexOf('keepCount: kept'));
    expect(iGuard).toBeLessThan(route.indexOf('excluded_phones'));
  });

  it('마지막 수신자는 지우지 않는다(예약 취소로 안내)', () => {
    expect(route).toContain('if (waitingNow - phoneRows <= 0) {');
  });
});
