/**
 * season-context.verify.ts — 월별 시즌 컨텍스트(자동마케팅 계절 문안) 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/season-context.verify.ts
 * (DB import 0 — 연결 불필요. 순수 로직만 검증.)
 */
import assert from 'node:assert';
import { SEASON_BY_MONTH, getSeasonContext, buildSeasonPromptBlock } from '../season-context';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[season-context] SEASON_BY_MONTH');
ok('12개월 전부 정의(season+keywords)', () => {
  for (let m = 1; m <= 12; m++) {
    assert.ok(SEASON_BY_MONTH[m], `${m}월 누락`);
    assert.ok(typeof SEASON_BY_MONTH[m].season === 'string' && SEASON_BY_MONTH[m].season.length > 0);
    assert.ok(Array.isArray(SEASON_BY_MONTH[m].keywords) && SEASON_BY_MONTH[m].keywords.length > 0);
  }
});
ok('5월 = 가정의달/어버이날 계열', () =>
  assert.ok(SEASON_BY_MONTH[5].keywords.some(k => k.includes('가정') || k.includes('어버이'))));
ok('9월 = 추석/한가위 계열', () =>
  assert.ok(SEASON_BY_MONTH[9].keywords.some(k => k.includes('추석') || k.includes('한가위'))));
ok('12월 = 연말/크리스마스 계열', () =>
  assert.ok(SEASON_BY_MONTH[12].keywords.some(k => k.includes('연말') || k.includes('크리스마스'))));

console.log('[season-context] getSeasonContext (KST 변환)');
ok('2026-09-15T03:00Z → KST 9/15 = 9월', () => {
  const c = getSeasonContext(new Date('2026-09-15T03:00:00Z'));
  assert.strictEqual(c.month, 9);
  assert.ok(c.keywords.some(k => k.includes('추석') || k.includes('한가위')));
});
ok('2026-12-31T15:30Z → KST 1/1 = 1월(롤오버)', () => {
  const c = getSeasonContext(new Date('2026-12-31T15:30:00Z'));
  assert.strictEqual(c.month, 1);
});

console.log('[season-context] buildSeasonPromptBlock');
ok('업종 반영 + 월 표기', () => {
  const b = buildSeasonPromptBlock(12, '카페');
  assert.ok(b.includes('12월') && b.includes('카페'));
});
ok('업종 null 안전(문자열 null 미노출)', () => {
  const b = buildSeasonPromptBlock(3, null);
  assert.ok(b.includes('3월'));
  assert.ok(!b.includes('null'));
});
ok('objective 불변 안내 포함(목표 바꾸지 말라)', () => {
  const b = buildSeasonPromptBlock(5, '병원');
  assert.ok(b.includes('목표') && b.includes('바꾸지'));
});

console.log(`\n${passed} assertions passed`);
