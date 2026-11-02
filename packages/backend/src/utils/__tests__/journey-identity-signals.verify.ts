/**
 * journey-identity-signals.verify.ts — 신규 고객 판정 게이트(순수) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-identity-signals.verify.ts
 *
 * ★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-6(D19) — 판정 근거 = 가입 근거 칸(joined_at)만.
 *   구매 · 포인트 · 등급 「기존 근거」 술어(buildExistingCustomerPredicate) · 가입일 술어를 지웠다(신규 판정 = customer-joined-at newSignupSql 한 곳).
 *   못 박는 것: 근거가 없으면 canJudge=false(「명단에 없으니 신규」로 폴백하지 않는다) · 구매 수 · 포인트만으로는 열지 않는다 · 가입일 칸 이름 = 화이트리스트.
 */
import assert from 'node:assert';
import { availableSignals, resolveNewCustomerJudgement } from '../journey-identity-signals';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

ok('근거 0 = 판정 불가', () => {
  assert.strictEqual(resolveNewCustomerJudgement({}).canJudge, false);
});
ok('구매 수 · 포인트만 = 판정 불가(가입 사실이 아니다)', () => {
  assert.strictEqual(resolveNewCustomerJudgement({ hasPurchaseCount: true, hasPoints: true }).canJudge, false);
});
ok('가입 근거 칸 = 판정 가능', () => {
  const j = resolveNewCustomerJudgement({ signupDateColumn: 'joined_at' });
  assert.strictEqual(j.canJudge, true);
  assert.deepStrictEqual(j.basis, ['signup_date']);
});
ok('화이트리스트 밖 칸 이름 = 무시', () => {
  assert.deepStrictEqual(availableSignals({ signupDateColumn: 'evil_col' }), []);
});

console.log(`journey-identity-signals.verify: ${passed} passed`);
