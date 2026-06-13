/**
 * ai-memory-text.verify.ts — 캠페인 학습 메모리 문구·기록 게이트 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-memory-text.verify.ts
 * (DB import 0 — 전환 데이터 유무에 따른 문구 생략 + 클릭 실측 0 기록 보류만 검증.)
 * 2026-06-13: cdp_events 0건 실측 → 가짜 "전환율 0.00%" 채널 성과 누적 차단(Phase A 정직성 수정).
 */
import assert from 'node:assert';
import {
  composeCampaignLearningText,
  shouldRecordCampaignLearning,
  diffGuideline,
  pickMemoriesToPrune,
} from '../ai-memory-text';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[ai-memory-text] composeCampaignLearningText — 전환 데이터 없으면 "전환율" 문구 생략');

ok('전환 데이터 없음 → "전환율" 미포함, 클릭률만', () => {
  const txt = composeCampaignLearningText({
    kind: 'channel_performance', channel: 'LMS', sentCount: 1000,
    clickRate: 0.12, hasConversionData: false, conversionRate: 0,
  });
  assert.ok(!txt.includes('전환율'), txt);
  assert.ok(txt.includes('클릭률 12.0%'), txt);
});

ok('전환 데이터 있음 → "전환율 X.XX%" 포함', () => {
  const txt = composeCampaignLearningText({
    kind: 'channel_performance', channel: 'LMS', sentCount: 1000,
    clickRate: 0.12, hasConversionData: true, conversionRate: 0.034,
  });
  assert.ok(txt.includes('전환율 3.40%'), txt);
});

ok('success_pattern → 캠페인명 + 클릭률 + "N명 발송" 포함', () => {
  const txt = composeCampaignLearningText({
    kind: 'success_pattern', channel: 'SMS', campaignName: '여름 세일',
    sentCount: 500, clickRate: 0.183, hasConversionData: false, conversionRate: 0,
  });
  assert.ok(txt.includes('"여름 세일"'), txt);
  assert.ok(txt.includes('클릭률 18.3%'), txt);
  assert.ok(txt.includes('500명 발송'), txt);
  assert.ok(!txt.includes('전환율'), txt);
});

ok('channel_performance → 발송수 문구 없음(롤링 채널 지표)', () => {
  const txt = composeCampaignLearningText({
    kind: 'channel_performance', channel: 'SMS', sentCount: 500,
    clickRate: 0.05, hasConversionData: false, conversionRate: 0,
  });
  assert.ok(!txt.includes('명 발송'), txt);
  assert.ok(txt.includes('최근 캠페인 성과'), txt);
});

console.log('[ai-memory-text] shouldRecordCampaignLearning — 클릭 실측 0 = 기록 보류(가짜 0% 차단)');

ok('표본 10 미만 → false', () =>
  assert.strictEqual(shouldRecordCampaignLearning({ sentCount: 9, clickCount: 5 }), false));
ok('클릭 실측 0 → false (데이터 없음/진짜 0 구분 불가 → 보류)', () =>
  assert.strictEqual(shouldRecordCampaignLearning({ sentCount: 1000, clickCount: 0 }), false));
ok('클릭 음수(방어) → false', () =>
  assert.strictEqual(shouldRecordCampaignLearning({ sentCount: 1000, clickCount: -1 }), false));
ok('표본 충분 + 클릭 1+ → true', () =>
  assert.strictEqual(shouldRecordCampaignLearning({ sentCount: 1000, clickCount: 1 }), true));

console.log('[ai-memory-text] diffGuideline — 첫 등록·무변화 null / 톤·CTA·이모지 변화만 감지');

const baseG = {
  tone_signature: '정보/실용', avg_length_chars: 245,
  cta_patterns: ['지금 확인'], emoji_whitelist: ['★'],
  greeting_pattern: '안녕하세요', ad_prefix_position: 'front', reject_position: 'back',
};

ok('첫 등록(prev 없음) → null', () =>
  assert.strictEqual(diffGuideline(null, baseG), null));
ok('동일 → null', () =>
  assert.strictEqual(diffGuideline(baseG, { ...baseG }), null));
ok('평균 길이만 변화 → null (단독 트리거 아님)', () =>
  assert.strictEqual(diffGuideline(baseG, { ...baseG, avg_length_chars: 180 }), null));
ok('tone_signature 변화 → 감지 + 양쪽 톤 + 길이 맥락', () => {
  const c = diffGuideline(baseG, { ...baseG, tone_signature: '친근/캐주얼', avg_length_chars: 180 });
  assert.ok(c && c.changedFields.includes('tone_signature'), JSON.stringify(c));
  assert.ok(c!.summary.includes('정보/실용') && c!.summary.includes('친근/캐주얼'), c!.summary);
  assert.ok(c!.summary.includes('245') && c!.summary.includes('180'), c!.summary);
});
ok('CTA 패턴 변화 → 감지', () => {
  const c = diffGuideline(baseG, { ...baseG, cta_patterns: ['지금 확인', '오늘까지'] });
  assert.ok(c && c.changedFields.includes('cta_patterns'), JSON.stringify(c));
});
ok('이모지 화이트리스트 변화 → 감지', () => {
  const c = diffGuideline(baseG, { ...baseG, emoji_whitelist: ['★', '♥'] });
  assert.ok(c && c.changedFields.includes('emoji_whitelist'), JSON.stringify(c));
});

console.log('[ai-memory-text] pickMemoriesToPrune — 타입별 상한 초과분만·저신호 우선 삭제');

const mk = (id: string, type: string, imp: number, usage: number, accessed: number) =>
  ({ id, memoryType: type, importance: imp, usageCount: usage, lastAccessedAt: accessed });

ok('상한 이내 → 삭제 0', () => {
  const ids = pickMemoriesToPrune(
    [mk('a', 'success_pattern', 5, 1, 100), mk('b', 'success_pattern', 6, 2, 200)],
    { success_pattern: 5 });
  assert.deepStrictEqual(ids, []);
});
ok('상한 초과 → 초과분만 최저신호 삭제', () => {
  const ids = pickMemoriesToPrune([
    mk('high', 'channel_performance', 9, 10, 500),
    mk('mid', 'channel_performance', 6, 5, 400),
    mk('low', 'channel_performance', 3, 0, 100),
  ], { channel_performance: 2 });
  assert.deepStrictEqual(ids, ['low']);
});
ok('importance 동률 → 오래된 last_accessed 먼저', () => {
  const ids = pickMemoriesToPrune([
    mk('new', 'success_pattern', 5, 1, 900),
    mk('old', 'success_pattern', 5, 1, 100),
    mk('keep', 'success_pattern', 8, 1, 500),
  ], { success_pattern: 2 });
  assert.deepStrictEqual(ids, ['old']);
});
ok('상한 없는 타입 → 삭제 0', () =>
  assert.deepStrictEqual(
    pickMemoriesToPrune([
      mk('a', 'compliance_learning', 1, 0, 1),
      mk('b', 'compliance_learning', 1, 0, 2),
      mk('c', 'compliance_learning', 1, 0, 3),
    ], { success_pattern: 1 }), []));

console.log(`\n[ai-memory-text] ${passed} passed`);
