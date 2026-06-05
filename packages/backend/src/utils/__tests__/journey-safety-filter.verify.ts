/**
 * journey-safety-filter.verify.ts — 공통 안전필터 SQL 조각 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts
 * (DB import 0 — 연결 불필요. 문자열만 검증.)
 */
import assert from 'node:assert';
import { buildJourneySafetyFilter, isCustomerSendable } from '../journey-safety-filter';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-safety-filter] alias=c');
const f = buildJourneySafetyFilter('c');
ok('is_active=true 포함', () => assert.ok(/\bc\.is_active\s*=\s*true\b/.test(f)));
ok('sms_opt_in=true 포함', () => assert.ok(/\bc\.sms_opt_in\s*=\s*true\b/.test(f)));
ok('is_opt_out IS NOT TRUE 포함', () => assert.ok(/\bc\.is_opt_out\s+IS\s+NOT\s+TRUE\b/.test(f)));
ok('is_invalid IS NOT TRUE 포함', () => assert.ok(/\bc\.is_invalid\s+IS\s+NOT\s+TRUE\b/.test(f)));
ok('unsubscribes 안티조인(company_id+phone)', () =>
  assert.ok(/NOT\s+EXISTS\s*\([\s\S]*unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id[\s\S]*u\.phone\s*=\s*c\.phone/.test(f)));
ok('파라미터 placeholder($n) 없음(순수 문자열)', () => assert.ok(!/\$\d/.test(f)));

console.log('[journey-safety-filter] alias 치환');
const fx = buildJourneySafetyFilter('x');
ok('다른 alias=x 반영', () => assert.ok(/\bx\.is_active\s*=\s*true\b/.test(fx) && /u\.phone\s*=\s*x\.phone/.test(fx)));
ok('AND로 시작 안 함(호출부가 앞에 AND 붙임)', () => assert.ok(!/^\s*AND\b/.test(f.trim())));

// ── 발송 시점 JS 판정 — SQL 안전필터와 동일 기준(is_active=true·sms_opt_in=true·is_opt_out/is_invalid IS NOT TRUE) ──
console.log('[isCustomerSendable] 발송 가능 판정(안전필터 SQL과 동일 기준)');
ok('전부 충족 → true', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: true, is_opt_out: false, is_invalid: false }), true));
ok('is_opt_out/is_invalid null → true(IS NOT TRUE 의미)', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: true, is_opt_out: null, is_invalid: null }), true));
ok('is_opt_out/is_invalid 미지정 → true', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: true }), true));
ok('is_active=false → false', () =>
  assert.strictEqual(isCustomerSendable({ is_active: false, sms_opt_in: true }), false));
ok('sms_opt_in=false → false', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: false }), false));
ok('is_active 미지정 → false(= true 엄격)', () =>
  assert.strictEqual(isCustomerSendable({ sms_opt_in: true }), false));
ok('sms_opt_in 미지정 → false(= true 엄격)', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true }), false));
ok('is_opt_out=true → false', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: true, is_opt_out: true }), false));
ok('is_invalid=true → false', () =>
  assert.strictEqual(isCustomerSendable({ is_active: true, sms_opt_in: true, is_invalid: true }), false));

console.log(`\n${passed} assertions passed`);
