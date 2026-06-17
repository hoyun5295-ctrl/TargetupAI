/**
 * 캠페인 카운트 표시 단일 산식 검증 (DB 의존 0).
 * 전송·성공·실패·대기를 한 곳(computeDisplayCounts)에서 계산해 표면 간 불일치를 차단.
 * 실행: cd packages/backend && npx ts-node scripts/verify-display-counts.ts
 */
import { computeDisplayCounts } from '../src/utils/sms-table-split';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.error(`  FAIL  ${name}`); }
}

console.log('[1] 완료 캠페인 — 대기는 정의상 0');
{
  // 정상 완료 (적재 = 성공+실패)
  const a = computeDisplayCounts(true, 1234, 1174, 60, 0);
  ok('정상: 전송 = 적재 1234', a.sent === 1234);
  ok('정상: 성공+실패 = 전송 (대기 0)', a.success + a.fail === a.sent);
  ok('정상: 대기 0', a.pending === 0);
}

console.log('[2] 디버깅2 시세이도 — 적재 < 성공+실패 (옛 제외분 33)');
{
  // shiseido4: 적재 1613, 성공 1586, 실패 60 → 성공+실패 1646
  const a = computeDisplayCounts(true, 1613, 1586, 60, 0);
  ok('전송 = max(적재, 성공+실패) = 1646', a.sent === 1646);
  ok('대기 0', a.pending === 0);
}

console.log('[3] 완료 캠페인 대기 = 적재 − 성공 − 실패 (실측 반영, 0 강제 X)');
{
  // 시세이도 61672: 성공 59917 + 실패 1753 + 결과대기(status 104) 2 = 61672. 대기 2가 진짜(상세조회 일치).
  const a = computeDisplayCounts(true, 61672, 59917, 1753, 0);
  ok('완료라도 실측 결과대기 2 표시 (상세 일치)', a.pending === 2);
  ok('전송 61672', a.sent === 61672);
  // 에이스: 캐시 fail 899(실측 1565 누락) → 적재 잔여 666이 대기로. worker 재대조(C)가 fail 정정 시 0.
  const b = computeDisplayCounts(true, 47846, 46281, 899, 0);
  ok('캐시 누락분 666 = 적재 잔여 (worker C 정정 대상)', b.pending === 666);
}

console.log('[4] 진행중 캠페인 — 실측 대기 반영');
{
  const a = computeDisplayCounts(false, 100, 50, 10, 40);
  ok('진행중 대기 = 실측 40', a.pending === 40);
  ok('전송 = max(적재 100, 성공+실패+대기 100) = 100', a.sent === 100);
  // 적재가 결과합보다 작아도 결과합 이상 보장
  const b = computeDisplayCounts(false, 90, 50, 10, 40);
  ok('적재 < 결과합이면 전송 = 결과합 100', b.sent === 100);
}

console.log('[5] 음수/누락 방어');
{
  const a = computeDisplayCounts(true, null, -5 as any, -3 as any, -2 as any);
  ok('음수 → 0 클램프', a.sent === 0 && a.success === 0 && a.fail === 0 && a.pending === 0);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
