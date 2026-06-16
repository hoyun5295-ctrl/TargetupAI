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

console.log('[3] 디버깅1 에이스 — 완료인데 대기 666 둔갑 차단');
{
  // 에이스: 적재 47846, 성공 46281, 실패 899 (캐시 fail 누락분 666이 대기로 둔갑하던 케이스)
  const a = computeDisplayCounts(true, 47846, 46281, 899, 0);
  ok('완료 대기 0 (666 둔갑 차단)', a.pending === 0);
  ok('전송 = 적재 47846', a.sent === 47846);
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
