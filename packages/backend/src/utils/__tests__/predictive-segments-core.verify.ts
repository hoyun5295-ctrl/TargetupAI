/**
 * predictive-segments-core.verify.ts — AI 발견 세그먼트 근거 요약 순수 코어 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/predictive-segments-core.verify.ts
 * (DB import 0 — count + 보조 실측 숫자 → 근거 문장 생성 순수 함수.)
 */
import assert from 'node:assert';
import { buildDiscoveredSegments, formatKoreanNumber } from '../predictive-segments-core';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[predictive-segments-core] formatKoreanNumber');
ok('천단위 콤마', () => {
  assert.strictEqual(formatKoreanNumber(1234567), '1,234,567');
  assert.strictEqual(formatKoreanNumber(999), '999');
  assert.strictEqual(formatKoreanNumber(0), '0');
});
ok('소수 반올림 + 음수/NaN 방어', () => {
  assert.strictEqual(formatKoreanNumber(1234.7), '1,235');
  assert.strictEqual(formatKoreanNumber(-5), '0');
  assert.strictEqual(formatKoreanNumber(NaN), '0');
});

console.log('[predictive-segments-core] buildDiscoveredSegments');
ok('세 세그먼트 count>0 → 3건, 순서 churn/purchase/vip', () => {
  const r = buildDiscoveredSegments({
    churn: { count: 120, avgInactiveDays: 45 },
    purchase: { count: 88, avgNextPurchaseDays: 7 },
    vip: { count: 30, sumLtv365d: 12345678 },
  });
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].key, 'churn_recovery');
  assert.strictEqual(r[1].key, 'purchase_push');
  assert.strictEqual(r[2].key, 'vip_engagement');
});
ok('count 0 세그먼트 제외', () => {
  const r = buildDiscoveredSegments({
    churn: { count: 0, avgInactiveDays: null },
    purchase: { count: 5, avgNextPurchaseDays: 10 },
    vip: { count: 0, sumLtv365d: 0 },
  });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].key, 'purchase_push');
});
ok('모두 0 → 빈 배열', () => {
  const r = buildDiscoveredSegments({
    churn: { count: 0, avgInactiveDays: null },
    purchase: { count: 0, avgNextPurchaseDays: null },
    vip: { count: 0, sumLtv365d: 0 },
  });
  assert.strictEqual(r.length, 0);
});
ok('이탈 근거 = 미활동일수 + 인원수 실측 포함', () => {
  const [seg] = buildDiscoveredSegments({
    churn: { count: 1200, avgInactiveDays: 45 },
    purchase: { count: 0, avgNextPurchaseDays: null },
    vip: { count: 0, sumLtv365d: 0 },
  });
  assert.ok(seg.reasonSummary.includes('45'), '미활동일수 45 포함');
  assert.ok(seg.reasonSummary.includes('1,200'), '인원수 1,200 포함');
});
ok('이탈 avgInactiveDays null → 인원수만, 일수 표기 없음', () => {
  const [seg] = buildDiscoveredSegments({
    churn: { count: 50, avgInactiveDays: null },
    purchase: { count: 0, avgNextPurchaseDays: null },
    vip: { count: 0, sumLtv365d: 0 },
  });
  assert.ok(seg.reasonSummary.includes('50'), '인원수 50 포함');
  assert.ok(!seg.reasonSummary.includes('일째'), 'null이면 N일째 표기 없음');
});
ok('구매 근거 = 다음 구매일 + 인원수', () => {
  const [seg] = buildDiscoveredSegments({
    churn: { count: 0, avgInactiveDays: null },
    purchase: { count: 88, avgNextPurchaseDays: 7 },
    vip: { count: 0, sumLtv365d: 0 },
  });
  assert.ok(seg.reasonSummary.includes('7'), '다음 구매일 7 포함');
  assert.ok(seg.reasonSummary.includes('88'), '인원수 88 포함');
});
ok('VIP 근거 = 합산 LTV 콤마 + 인원수', () => {
  const [seg] = buildDiscoveredSegments({
    churn: { count: 0, avgInactiveDays: null },
    purchase: { count: 0, avgNextPurchaseDays: null },
    vip: { count: 30, sumLtv365d: 12345678 },
  });
  assert.ok(seg.reasonSummary.includes('12,345,678'), '합산 LTV 콤마 포함');
  assert.ok(seg.reasonSummary.includes('30'), '인원수 30 포함');
});
ok('accent 색상 정확', () => {
  const r = buildDiscoveredSegments({
    churn: { count: 1, avgInactiveDays: 10 },
    purchase: { count: 1, avgNextPurchaseDays: 5 },
    vip: { count: 1, sumLtv365d: 1000 },
  });
  assert.strictEqual(r[0].accent, 'rose');
  assert.strictEqual(r[1].accent, 'emerald');
  assert.strictEqual(r[2].accent, 'fuchsia');
});
ok('label 정확', () => {
  const r = buildDiscoveredSegments({
    churn: { count: 1, avgInactiveDays: 10 },
    purchase: { count: 1, avgNextPurchaseDays: 5 },
    vip: { count: 1, sumLtv365d: 1000 },
  });
  assert.strictEqual(r[0].label, '이탈 위험 고객');
  assert.strictEqual(r[1].label, '구매 기회 고객');
  assert.strictEqual(r[2].label, 'VIP 보존 대상');
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
