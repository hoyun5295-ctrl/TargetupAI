/**
 * refund-calc.verify.ts — 환불 누적 단일 산식 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/refund-calc.verify.ts
 * (DB import 0 — 정당 환불 = 실패 + 미적재(차감 − 실제 처리수) 산식만 검증.)
 *
 * 2026-06-29: 미적재 기준을 sent_count → max(sent_count, 성공+실패+대기)로 교체.
 *   직전(6/25) 산식 "차감 − sent_count"는 sent_count가 실제 처리수보다 작게 기록되면 그 차이를
 *   가짜 미적재로 환불 → ratchet이 영구 초과로 굳혔다(폴라초이스·라무르 외, 2026-06-29 실측 51,722원).
 *   실제 큐 처리수(성공+실패+대기)를 하한 max로 반영해 가짜 미적재를 차단한다.
 */
import assert from 'node:assert';
import { calcRefundDue, refundInvariantGap } from '../refund-calc';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[refund-calc] calcRefundDue — 정당 환불 = 실패 + 미적재(차감 − 실제 처리수)');

ok('정상 발송(베이컨 6/14): 처리=차감 10013, 실패 369 → 369', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10013, sentCount: 10013, mysqlSuccess: 9644, mysqlFail: 369, mysqlPending: 0 }), 369));

ok('미적재 포함(차감 985 / 처리 978 → 미적재 7 + 실패 30 = 37)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 985, sentCount: 978, mysqlSuccess: 948, mysqlFail: 30, mysqlPending: 0 }), 37));

ok('★회귀 폴라초이스 6/28: 차감 15400 적재기록 15271, 성공14790+실패610=15400 → 미적재 0, 실패 610 → 610 (가짜 미적재 129 차단)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 15400, sentCount: 15271, mysqlSuccess: 14790, mysqlFail: 610, mysqlPending: 0 }), 610));

ok('★회귀 라무르 6/24: 차감 32981 적재 32513, 성공32121+실패860=32981 → 미적재 0, 실패 860 → 860 (가짜 미적재 468 차단)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 32981, sentCount: 32513, mysqlSuccess: 32121, mysqlFail: 860, mysqlPending: 0 }), 860));

ok('★회귀 패밀리투: 차감 8 적재 8 성공 8 실패 0 → 0 (전량 성공인데 환불 금지)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 8, sentCount: 8, mysqlSuccess: 8, mysqlFail: 0, mysqlPending: 0 }), 0));

ok('전량 적재형(폴라초이스 MMS): 적재 15697 성공 15135 실패 562 → 562', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 15697, sentCount: 15697, mysqlSuccess: 15135, mysqlFail: 562, mysqlPending: 0 }), 562));

ok('대기 중은 환불 0(실패 아님): 적재 1000 대기 1000 실패 0 → 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 1000, sentCount: 1000, mysqlSuccess: 0, mysqlFail: 0, mysqlPending: 1000 }), 0));

ok('진짜 미적재(부분 적재): 차감 15400 적재 5000 성공 4900 실패 100 대기 0 → 미적재 10400 + 실패 100 = 10500', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 15400, sentCount: 5000, mysqlSuccess: 4900, mysqlFail: 100, mysqlPending: 0 }), 10500));

ok('이동 중 MySQL 일시 과소집계 방어 — sent_count 하한: 차감 1000 적재 1000 but 성공0 실패0 대기0(이동중) → 미적재 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 1000, sentCount: 1000, mysqlSuccess: 0, mysqlFail: 0, mysqlPending: 0 }), 0));

ok('처리수 0/미상이면 미적재 0 (full 미적재는 worker 담당): 차감 500 적재 0 성공0 실패0 대기0 → 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 500, sentCount: 0, mysqlSuccess: 0, mysqlFail: 0, mysqlPending: 0 }), 0));

ok('상한 — 실패+미적재는 차감 초과 안 함: 차감 10 적재 8 성공0 실패 8 대기 0 → min(10, 8+2)=10', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10, sentCount: 8, mysqlSuccess: 0, mysqlFail: 8, mysqlPending: 0 }), 10));

ok('소수 혼입 방어: 정수 내림 (차감 10.9 적재 8.0 성공 5.1 실패 3.2 → 처리 8, 미적재 2 + 실패 3 = 5)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10.9, sentCount: 8.0, mysqlSuccess: 5.1, mysqlFail: 3.2, mysqlPending: 0 }), 5));

ok('음수 혼입 방어: 음수 입력은 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: -5, sentCount: -1, mysqlSuccess: -2, mysqlFail: -3, mysqlPending: -1 }), 0));

console.log('\n[refund-calc] refundInvariantGap — 차감 = 성공 + 순환불 (발송사 머니 불변식)');

ok('정상(엔에스비): 차감 2699 = 성공 2618 + 순환불 81 → gap 0', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 2699, successCount: 2618, netRefundedCount: 81 }), 0));

ok('정상(초과환불 회수 후 폴라초이스): 차감 15400 = 성공 14790 + 순환불 610 → gap 0', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 15400, successCount: 14790, netRefundedCount: 610 }), 0));

ok('미환불 의심(고객 손해): 차감 1000 vs 성공 900 + 순환불 50 → gap +50', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 1000, successCount: 900, netRefundedCount: 50 }), 50));

ok('초과환불 잔존: 차감 1000 vs 성공 900 + 순환불 130 → gap -30', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 1000, successCount: 900, netRefundedCount: 130 }), -30));

ok('진짜 미적재 환불 포함도 정상: 차감 1000 = 성공 900 + 순환불(실패50+미적재50) 100 → gap 0', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 1000, successCount: 900, netRefundedCount: 100 }), 0));

ok('음수/소수 방어: 정수 내림 + 음수 0', () =>
  assert.strictEqual(refundInvariantGap({ deductedCount: 10.9, successCount: 8.2, netRefundedCount: -1 }), 2));

console.log(`\n[refund-calc] ${passed}/19 passed`);
