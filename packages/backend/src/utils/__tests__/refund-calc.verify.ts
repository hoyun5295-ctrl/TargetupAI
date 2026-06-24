/**
 * refund-calc.verify.ts — 환불 누적 단일 산식 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/refund-calc.verify.ts
 * (DB import 0 — 정당 환불 = 실패 + 미적재(차감 − 적재) 산식만 검증.)
 *
 * 2026-06-25: 산식을 "차감 − 성공 − 대기"에서 "실패 + 미적재"로 교체.
 *   기존 산식은 발송 직후 라이브→이력 이동 중 성공이 일시적으로 작게 잡히면 환불대상이 부풀고,
 *   prepaidRefund가 그 최고점을 굳혀(되돌림 없음) 영구 초과 환불(베이컨 외 25건 / 129,670원) 발생.
 *   성공 카운트 의존을 없애고, 실패(실측)와 미적재(차감−적재, 둘 다 안정값)만으로 계산해 차단.
 */
import assert from 'node:assert';
import { calcRefundDue } from '../refund-calc';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[refund-calc] calcRefundDue — 정당 환불 = 실패 + 미적재(차감 − 적재)');

ok('정상 발송(베이컨 6/14 실측): 적재=차감 10013, 실패 369 → 369 (성공 무관)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10013, sentCount: 10013, mysqlFail: 369 }), 369));

ok('미적재 포함(차감 985 / 적재 978 → 미적재 7 + 실패 30 = 37)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 985, sentCount: 978, mysqlFail: 30 }), 37));

ok('전량 적재형(폴라초이스 MMS 실측): 적재 15697, 실패 562 → 562', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 15697, sentCount: 15697, mysqlFail: 562 }), 562));

ok('대기 중은 환불 0(실패 아님) — 결과 도착해 실패되면 다음 사이클 반영: 적재 1000 실패 0 → 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 1000, sentCount: 1000, mysqlFail: 0 }), 0));

ok('실패 0이면 0 (성공 전량): 적재 8 실패 0 → 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 8, sentCount: 8, mysqlFail: 0 }), 0));

ok('sentCount 0/미상이면 미적재 0 (full 미적재는 worker 담당): 차감 500 적재 0 실패 0 → 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 500, sentCount: 0, mysqlFail: 0 }), 0));

ok('상한 — 실패+미적재는 차감을 넘지 않음: 차감 10 적재 8 실패 8 → 10', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10, sentCount: 8, mysqlFail: 8 }), 10));

ok('소수 혼입 방어: 정수 내림 (차감 10.9 적재 8.0 실패 3.2 → 미적재 2 + 실패 3 = 5)', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: 10.9, sentCount: 8.0, mysqlFail: 3.2 }), 5));

ok('음수 혼입 방어: 음수 입력은 0', () =>
  assert.strictEqual(calcRefundDue({ deductedCount: -5, sentCount: -1, mysqlFail: -3 }), 0));

console.log(`\n[refund-calc] ${passed}/9 passed`);
