/**
 * ai-credit-calc.verify.ts — 순수 함수 단위 검증
 *
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-credit-calc.verify.ts
 * (테스트 러너 미설치 프로젝트 — node:assert + ts-node 직접 실행. DB import 0 = 연결 불필요.)
 */
import assert from 'node:assert';
import {
  splitDeduction,
  needsMonthlyReset,
  buildIdempotencyKey,
  kstYearMonth,
  kstMonthTag,
  kstDateTag,
  kstHour,
  getCreditCost,
  dailyDbAnalysisCredits,
  isOperationSource,
} from '../ai-credit-calc';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('[ai-credit-calc] splitDeduction (2버킷: base 먼저 → purchased)');
ok('base 충분 → base에서만', () =>
  assert.deepStrictEqual(splitDeduction(100, 50, 10), { fromBase: 10, fromPurchased: 0, shortfall: 0 }));
ok('base 부족 → purchased 보충', () =>
  assert.deepStrictEqual(splitDeduction(3, 50, 10), { fromBase: 3, fromPurchased: 7, shortfall: 0 }));
ok('base 0 → purchased에서만', () =>
  assert.deepStrictEqual(splitDeduction(0, 50, 10), { fromBase: 0, fromPurchased: 10, shortfall: 0 }));
ok('정확히 소진 (base+purchased=cost)', () =>
  assert.deepStrictEqual(splitDeduction(4, 6, 10), { fromBase: 4, fromPurchased: 6, shortfall: 0 }));
ok('둘 다 부족 → shortfall', () =>
  assert.deepStrictEqual(splitDeduction(3, 4, 10), { fromBase: 3, fromPurchased: 4, shortfall: 3 }));
ok('cost 0 → 차감 0', () =>
  assert.deepStrictEqual(splitDeduction(100, 100, 0), { fromBase: 0, fromPurchased: 0, shortfall: 0 }));
ok('음수·소수 입력 방어', () =>
  assert.deepStrictEqual(splitDeduction(-5, 10.9, 3.2), { fromBase: 0, fromPurchased: 3, shortfall: 0 }));

console.log('[ai-credit-calc] needsMonthlyReset (KST 월 기준)');
ok('resetAt 없음 → 리셋 필요', () =>
  assert.strictEqual(needsMonthlyReset(null, new Date('2026-05-31T00:00:00Z')), true));
ok('같은 KST 월 → 불필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T10:00:00Z')), false));
ok('지난 달 → 필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-03-15T00:00:00Z'), new Date('2026-05-01T00:00:00Z')), true));
ok('KST 월 경계 — UTC 4/30 15:00Z = KST 5/1 → 필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-04-15T00:00:00Z'), new Date('2026-04-30T15:00:00Z')), true));
ok('KST 같은 달 — UTC 4/30 14:00Z = KST 4/30 23:00 → 불필요', () =>
  assert.strictEqual(needsMonthlyReset(new Date('2026-04-01T00:00:00Z'), new Date('2026-04-30T14:00:00Z')), false));

console.log('[ai-credit-calc] kstYearMonth / kstMonthTag');
ok('kstMonthTag — UTC 4/30 15:00Z = KST 202605', () =>
  assert.strictEqual(kstMonthTag(new Date('2026-04-30T15:00:00Z')), '202605'));
ok('kstMonthTag 일반', () =>
  assert.strictEqual(kstMonthTag(new Date('2026-05-15T03:00:00Z')), '202605'));
ok('kstYearMonth 월 경계 차이 = 1', () =>
  assert.strictEqual(
    kstYearMonth(new Date('2026-04-30T15:00:00Z')) - kstYearMonth(new Date('2026-03-31T15:00:00Z')), 1));

console.log('[ai-credit-calc] kstDateTag / kstHour');
ok('kstDateTag — UTC 4/30 15:00Z = KST 20260501', () => assert.strictEqual(kstDateTag(new Date('2026-04-30T15:00:00Z')), '20260501'));
ok('kstHour — UTC 0시 = KST 9시', () => assert.strictEqual(kstHour(new Date('2026-06-02T00:00:00Z')), 9));

console.log('[ai-credit-calc] buildIdempotencyKey');
ok('aiCallLogId 있음 → source:id', () =>
  assert.strictEqual(buildIdempotencyKey('orchestrate', 'abc-123'), 'orchestrate:abc-123'));
ok('aiCallLogId 없음 → null', () => {
  assert.strictEqual(buildIdempotencyKey('orchestrate', null), null);
  assert.strictEqual(buildIdempotencyKey('orchestrate', undefined), null);
});

console.log('[ai-credit-calc] getCreditCost (source → 크레딧)');
ok('풀분석 orchestrate = 300', () => assert.strictEqual(getCreditCost('orchestrate'), 300));
ok('여정 생성(돌려보기) journey-ai-generate = 3', () => assert.strictEqual(getCreditCost('journey-ai-generate'), 3));
ok('여정 생성(돌려보기) journey-builder-custom = 3', () => assert.strictEqual(getCreditCost('journey-builder-custom'), 3));
ok('여정 활성화 journey-activate = 200', () => assert.strictEqual(getCreditCost('journey-activate'), 200));
ok('자동마케팅 저장(활성화) continuous-operator = 200', () => assert.strictEqual(getCreditCost('continuous-operator'), 200));
ok('자동마케팅 발송 continuous-operator-send = 10', () => assert.strictEqual(getCreditCost('continuous-operator-send'), 10));
ok('예측 predictive-daily = 3', () => assert.strictEqual(getCreditCost('predictive-daily'), 3));
ok('모바일DM 생성(돌려보기) dm-ai-generate = 5', () => assert.strictEqual(getCreditCost('dm-ai-generate'), 5));
ok('모바일DM 발행 dm-builder = 100', () => assert.strictEqual(getCreditCost('dm-builder'), 100));
ok('인앱 생성(돌려보기) inapp-ai-generator = 3', () => assert.strictEqual(getCreditCost('inapp-ai-generator'), 3));
ok('인앱 게시 inapp-publish = 100', () => assert.strictEqual(getCreditCost('inapp-publish'), 100));
ok('이메일 발행 email-ai-publish = 50', () => assert.strictEqual(getCreditCost('email-ai-publish'), 50));
ok('인터랙션 발행 dm-interaction-publish = 120', () => assert.strictEqual(getCreditCost('dm-interaction-publish'), 120));
ok('꾸미기 ai-operator-decorate = 3', () => assert.strictEqual(getCreditCost('ai-operator-decorate'), 3));
ok('여정 운영 journey-operation = 10', () => assert.strictEqual(getCreditCost('journey-operation'), 10));
ok('인앱 빠른액션(다듬기) inapp-quick-action = 1', () => assert.strictEqual(getCreditCost('inapp-quick-action'), 1));
ok('문안·분석 generate-messages = 5', () => assert.strictEqual(getCreditCost('generate-messages'), 5));
ok('직접발송 다듬기 refine-direct = 1', () => assert.strictEqual(getCreditCost('refine-direct'), 1));
ok('다듬기 journey-ai-refine = 1', () => assert.strictEqual(getCreditCost('journey-ai-refine'), 1));
ok('스팸 spam-filter-test = 0 (크레딧 비대상 — 현금/후불 청구)', () => assert.strictEqual(getCreditCost('spam-filter-test'), 0));
ok('미등록 source = 0', () => assert.strictEqual(getCreditCost('unknown'), 0));
ok('source 없음(null/undefined) = 0', () => {
  assert.strictEqual(getCreditCost(null), 0);
  assert.strictEqual(getCreditCost(undefined), 0);
});

console.log('[ai-credit-calc] dailyDbAnalysisCredits (DB 규모 일일 분석)');
ok('10만 = 3', () => assert.strictEqual(dailyDbAnalysisCredits(100000), 3));
ok('≤10만(2만) = 3', () => assert.strictEqual(dailyDbAnalysisCredits(20000), 3));
ok('20만 = 5 (4.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(200000), 5));
ok('30만 = 6', () => assert.strictEqual(dailyDbAnalysisCredits(300000), 6));
ok('80만 = 14 (13.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(800000), 14));
ok('100만 = 17 (16.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(1000000), 17));
ok('300만 = 47 (46.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(3000000), 47));
ok('0명 = 0', () => assert.strictEqual(dailyDbAnalysisCredits(0), 0));
ok('블록 경계 10만+1 = 5', () => assert.strictEqual(dailyDbAnalysisCredits(100001), 5));

console.log('[ai-credit-calc] isOperationSource (마이너스 허용군)');
ok('journey-operation = true', () => assert.strictEqual(isOperationSource('journey-operation'), true));
ok('continuous-operator-send = true', () => assert.strictEqual(isOperationSource('continuous-operator-send'), true));
ok('predictive-daily = false', () => assert.strictEqual(isOperationSource('predictive-daily'), false));
ok('dm-builder = false', () => assert.strictEqual(isOperationSource('dm-builder'), false));
ok('null = false', () => assert.strictEqual(isOperationSource(null), false));

console.log(`\n${passed} assertions passed`);
