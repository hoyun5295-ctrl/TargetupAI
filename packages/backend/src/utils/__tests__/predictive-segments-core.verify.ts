/**
 * predictive-segments-core.verify.ts — AI 발견 세그먼트 근거 요약 순수 코어 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/predictive-segments-core.verify.ts
 * (DB import 0 — count + 보조 실측 숫자 → 근거 문장 생성 순수 함수.)
 *
 * 2026-06-07 6종 확장: count 0이어도 6종 카드 항상 반환(빈 칸은 비활성 안내), 솔루션 시작 단계 빈 화면 방지.
 */
import assert from 'node:assert';
import { buildDiscoveredSegments, formatKoreanNumber } from '../predictive-segments-core';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const FULL = {
  churn: { count: 120, avgInactiveDays: 45 },
  purchase: { count: 88, avgNextPurchaseDays: 7 },
  vip: { count: 30, sumLtv365d: 12345678 },
  firstPurchase: { count: 500 },
  engagement: { count: 60, avgClickPct: 42 },
  repurchase: { count: 25, avgNextPurchaseDays: 9 },
};
const ZERO = {
  churn: { count: 0, avgInactiveDays: null },
  purchase: { count: 0, avgNextPurchaseDays: null },
  vip: { count: 0, sumLtv365d: 0 },
  firstPurchase: { count: 0 },
  engagement: { count: 0, avgClickPct: null },
  repurchase: { count: 0, avgNextPurchaseDays: null },
};

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

console.log('[predictive-segments-core] buildDiscoveredSegments — 6종 항상 반환');
ok('항상 6종 · 순서 고정', () => {
  const r = buildDiscoveredSegments(FULL);
  assert.strictEqual(r.length, 6);
  assert.deepStrictEqual(r.map((s) => s.key), [
    'churn_recovery', 'purchase_push', 'vip_engagement',
    'first_purchase', 'high_engagement', 'repurchase_imminent',
  ]);
});
ok('전부 0이어도 6종 유지 + 비활성 안내(활성화 안 됨)', () => {
  const r = buildDiscoveredSegments(ZERO);
  assert.strictEqual(r.length, 6);
  r.forEach((s) => {
    assert.strictEqual(s.count, 0);
    assert.ok(s.reasonSummary.includes('활성화'), `${s.key} 비활성 안내 포함`);
  });
});
ok('이탈 근거 = 미활동일수 + 인원수', () => {
  const r = buildDiscoveredSegments({ ...ZERO, churn: { count: 1200, avgInactiveDays: 45 } });
  const seg = r.find((s) => s.key === 'churn_recovery')!;
  assert.ok(seg.reasonSummary.includes('45'));
  assert.ok(seg.reasonSummary.includes('1,200'));
});
ok('구매 근거 = 다음 구매일 + 인원수', () => {
  const seg = buildDiscoveredSegments({ ...ZERO, purchase: { count: 88, avgNextPurchaseDays: 7 } }).find((s) => s.key === 'purchase_push')!;
  assert.ok(seg.reasonSummary.includes('7'));
  assert.ok(seg.reasonSummary.includes('88'));
});
ok('VIP 근거 = 합산 LTV 콤마 + 인원수', () => {
  const seg = buildDiscoveredSegments({ ...ZERO, vip: { count: 30, sumLtv365d: 12345678 } }).find((s) => s.key === 'vip_engagement')!;
  assert.ok(seg.reasonSummary.includes('12,345,678'));
  assert.ok(seg.reasonSummary.includes('30'));
});
ok('첫 구매 유도 근거 = 인원수 (혜택 수치 미포함)', () => {
  const seg = buildDiscoveredSegments({ ...ZERO, firstPurchase: { count: 3400 } }).find((s) => s.key === 'first_purchase')!;
  assert.ok(seg.reasonSummary.includes('3,400'));
  assert.ok(!/[0-9]+%|[0-9]+원|쿠폰|무료/.test(seg.reasonSummary), '임의 혜택 수치 없음');
});
ok('관심·반응 근거 = 클릭 가능성% + 인원수', () => {
  const seg = buildDiscoveredSegments({ ...ZERO, engagement: { count: 60, avgClickPct: 42 } }).find((s) => s.key === 'high_engagement')!;
  assert.ok(seg.reasonSummary.includes('42'));
  assert.ok(seg.reasonSummary.includes('60'));
});
ok('재구매 임박 근거 = 평균 일수 + 인원수', () => {
  const seg = buildDiscoveredSegments({ ...ZERO, repurchase: { count: 25, avgNextPurchaseDays: 9 } }).find((s) => s.key === 'repurchase_imminent')!;
  assert.ok(seg.reasonSummary.includes('9'));
  assert.ok(seg.reasonSummary.includes('25'));
});
ok('accent 6색 정확', () => {
  const r = buildDiscoveredSegments(FULL);
  assert.deepStrictEqual(r.map((s) => s.accent), ['rose', 'emerald', 'fuchsia', 'indigo', 'cyan', 'amber']);
});
ok('label 6종 정확', () => {
  const r = buildDiscoveredSegments(FULL);
  assert.deepStrictEqual(r.map((s) => s.label), [
    '이탈 위험 고객', '구매 기회 고객', 'VIP 보존 대상',
    '첫 구매 유도', '관심·반응 고객', '재구매 임박',
  ]);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
