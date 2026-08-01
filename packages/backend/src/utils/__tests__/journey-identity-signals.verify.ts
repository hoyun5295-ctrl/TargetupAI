/**
 * journey-identity-signals.verify.ts — 신규/기존 고객 판정 CT(순수) 검증 (2026-08-01)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-identity-signals.verify.ts
 *
 * 못 박는 것 (설계서 §2-3·§3-0-2):
 *   1. 근거가 없으면 canJudge=false — "명단에 없으니 신규"로 폴백하지 않는다.
 *   2. 부정 신호 조각은 절대 NULL을 돌려주지 않는다 — NOT(...)이 NULL이면 신규가 0건이 된다.
 *   3. alias·컬럼명은 화이트리스트 — 주입 표면 0.
 */
import assert from 'node:assert';
import {
  availableSignals,
  resolveNewCustomerJudgement,
  buildExistingCustomerPredicate,
  buildSignupDatePredicate,
} from '../journey-identity-signals';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-identity-signals] 판정 가능 여부');
ok('근거 0 → canJudge=false (억지 폴백 금지)', () => {
  const j = resolveNewCustomerJudgement({});
  assert.strictEqual(j.canJudge, false);
  assert.deepStrictEqual(j.basis, []);
  assert.strictEqual(j.strength, null);
  assert.ok(j.reason.includes('구분할 근거가 없습니다'));
});

ok('구매 흔적 하나만 있어도 판정 가능', () => {
  const j = resolveNewCustomerJudgement({ hasPurchaseCount: true });
  assert.strictEqual(j.canJudge, true);
  assert.deepStrictEqual(j.basis, ['purchase_count']);
  assert.strictEqual(j.strength, 'strong');
});

ok('가입일이 있으면 최우선 근거(exact)', () => {
  const j = resolveNewCustomerJudgement({ signupDateColumn: 'signup_date', hasPoints: true });
  assert.strictEqual(j.basis[0], 'signup_date');
  assert.strictEqual(j.strength, 'exact');
});

ok('포인트만 있으면 판정은 되지만 신뢰도 weak', () => {
  const j = resolveNewCustomerJudgement({ hasPoints: true });
  assert.strictEqual(j.canJudge, true);
  assert.strictEqual(j.strength, 'weak');
});

ok('기본등급 미설정이면 등급을 근거로 쓰지 않는다', () => {
  assert.deepStrictEqual(availableSignals({ defaultGrade: '   ' }), []);
  assert.deepStrictEqual(availableSignals({ defaultGrade: '일반' }), ['grade']);
});

ok('화이트리스트 밖 가입일 컬럼은 조용히 무시', () => {
  assert.deepStrictEqual(availableSignals({ signupDateColumn: 'evil_col' }), []);
  assert.deepStrictEqual(availableSignals({ signupDateColumn: 'joined_at' }), ['signup_date']);
});

console.log('[journey-identity-signals] 기존 고객 술어');
// ★ 2026-08-01 Codex 3R — 술어는 회사 능력으로 고르지 않는다. 데이터로 평가되는 절은 항상 들어간다.
//   회사가 그 데이터를 안 주면 그 컬럼이 전부 비어 있어 술어가 자연히 무력하다 = 결과가 같다.
//   고르지 않으므로 "능력을 읽은 시점"과 "고객 행을 읽는 시점"이 갈리는 경합 자체가 없다.
ok('능력을 안 넘겨도 술어가 만들어진다(고르지 않는다)', () => {
  const p: any[] = [];
  const frag = buildExistingCustomerPredicate('c', p);
  assert.ok(frag.startsWith('(') && frag.endsWith(')'));
  assert.strictEqual(p.length, 0);
});

ok('데이터 신호 5종이 항상 OR로 들어간다', () => {
  const frag = buildExistingCustomerPredicate('c', []);
  assert.ok(/COALESCE\(c\.purchase_count, 0\) > 0/.test(frag));
  assert.ok(/c\.recent_purchase_date IS NOT NULL/.test(frag));
  assert.ok(/COALESCE\(c\.last_purchase_date, ''\) <> ''/.test(frag));
  assert.ok(/COALESCE\(c\.total_purchase_amount, 0\) > 0/.test(frag));
  assert.ok(/COALESCE\(c\.points, 0\) > 0/.test(frag));
  assert.strictEqual(frag.split(' OR ').length, 5);
});

ok('숫자 신호는 전부 COALESCE — NOT(...)이 NULL이 되지 않는다', () => {
  const frag = buildExistingCustomerPredicate('c', []);
  const stripped = frag.replace(/COALESCE\([^)]*\)/g, 'X');
  // COALESCE를 걷어낸 뒤 맨 숫자 컬럼 비교가 남아 있으면 NULL 전파 경로다.
  assert.ok(!/c\.(purchase_count|total_purchase_amount|points)/.test(stripped));
});

ok('게이트가 보는 신호와 술어가 보는 신호가 같다(설정 기반 제외)', () => {
  const dataSignals = availableSignals({
    hasPurchaseCount: true, hasRecentPurchaseDate: true, hasLastPurchaseDate: true,
    hasTotalPurchaseAmount: true, hasPoints: true,
  });
  // 게이트가 통과시킨 근거를 술어가 안 보면 그 자체가 fail-open이다.
  assert.strictEqual(dataSignals.length, buildExistingCustomerPredicate('c', []).split(' OR ').length);
});

ok('기본등급은 파라미터로만 들어간다(리터럴 결합 금지)', () => {
  const p: any[] = [];
  const frag = buildExistingCustomerPredicate('c', p, { defaultGrade: "일반'; DROP TABLE customers; --" });
  assert.strictEqual(p.length, 1);
  assert.ok(/IS DISTINCT FROM \$1/.test(frag));
  assert.ok(!/DROP TABLE/.test(frag));
});

ok('파라미터 인덱스는 기존 배열 길이를 이어받는다', () => {
  const p: any[] = ['a', 'b'];
  const frag = buildExistingCustomerPredicate('c', p, { defaultGrade: '일반' });
  assert.ok(/IS DISTINCT FROM \$3/.test(frag));
});

ok('alias 치환', () => {
  const frag = buildExistingCustomerPredicate('x', []);
  assert.ok(/x\.recent_purchase_date IS NOT NULL/.test(frag));
});

ok('안전하지 않은 alias는 throw', () => {
  assert.throws(() => buildExistingCustomerPredicate('c; DROP', []));
});

console.log('[journey-identity-signals] 가입일 술어');
ok('화이트리스트 컬럼 + 일수 파라미터', () => {
  const p: any[] = [];
  const frag = buildSignupDatePredicate('c', p, 'signup_date', 30)!;
  assert.ok(/c\.signup_date IS NOT NULL/.test(frag));
  assert.deepStrictEqual(p, ['30']);
});

ok('화이트리스트 밖 컬럼은 null', () => {
  assert.strictEqual(buildSignupDatePredicate('c', [], 'phone; --', 30), null);
  assert.strictEqual(buildSignupDatePredicate('c', [], '', 30), null);
});

ok('일수는 1~3650으로 클램프', () => {
  const p1: any[] = []; buildSignupDatePredicate('c', p1, 'signup_date', 0);
  const p2: any[] = []; buildSignupDatePredicate('c', p2, 'signup_date', 99999);
  assert.deepStrictEqual(p1, ['1']);
  assert.deepStrictEqual(p2, ['3650']);
});

console.log(`\n${passed} assertions passed`);
