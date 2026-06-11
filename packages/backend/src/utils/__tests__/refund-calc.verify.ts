/**
 * refund-calc.verify.ts — 환불 누적 단일 산식 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/refund-calc.verify.ts
 * (DB import 0 — 정당 환불 = 차감 − 성공 − 대기 산식만 검증.)
 * 2026-06-11: worker(미적재분)·sync/sweeper(실측 실패분)가 같은 환불 누적 풀에 서로 다른 의미를
 * 보내 max로 수렴하던 과소 환불 구조의 근본 fix — 미적재 발생 시(D231 톤28형) 그 몫이 영구 누락된다.
 */
import assert from 'node:assert';
import { calcRefundDue } from '../refund-calc';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[refund-calc] calcRefundDue — 정당 환불 = 차감 − 성공 − 대기');
ok('전량 적재형(폴라초이스 6/8 실측): 15697 - 15135 - 0 = 562', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 15697, mysqlSuccess: 15135, mysqlPending: 0 }), 562));
ok('적재 제외형(미적재 7 + 실측 실패 30 — D231 톤28형 잠재): 985 - 948 - 0 = 37 (max 수렴 30 아님)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 985, mysqlSuccess: 948, mysqlPending: 0 }), 37));
ok('결과 대기 중은 보류: 1000 - 700 - 200 = 100 (대기 도착 시 다음 sweep에서 자동 증가)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 1000, mysqlSuccess: 700, mysqlPending: 200 }), 100));
ok('성공+대기 >= 차감이면 0 (무한환불 0%)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 100, mysqlSuccess: 100, mysqlPending: 50 }), 0));
ok('차감 0(후불/무차감)이면 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 0, mysqlSuccess: 0, mysqlPending: 0 }), 0));
ok('전체 미적재형(차감만 되고 적재 0): 500 - 0 - 0 = 500 전액', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 500, mysqlSuccess: 0, mysqlPending: 0 }), 500));
ok('소수 혼입 방어: 정수 내림 후 계산 (10.9 - 3.2 → 10 - 3 = 7)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10.9, mysqlSuccess: 3.2, mysqlPending: 0 }), 7));
ok('음수 혼입 방어: 음수 입력은 0으로 취급', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: -5, mysqlSuccess: 0, mysqlPending: 0 }), 0));

console.log(`\n[refund-calc] ${passed}/8 passed`);
