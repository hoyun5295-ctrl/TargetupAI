/**
 * operator-recipients.verify.ts — 발송 가능 수신자 추출 SQL(공통 안전필터) 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/operator-recipients.verify.ts
 * (DB import 0 — buildSendableRecipientsSql은 문자열만 합성. filterWhere는 주입.)
 */
import assert from 'node:assert';
import { buildSendableRecipientsSql } from '../operator-recipients';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[operator-recipients] buildSendableRecipientsSql — 안전필터 통일');
ok('안전필터 4종 + 회사+전화 안티조인 포함', () => {
  const { sql } = buildSendableRecipientsSql('AND c.grade = $2', ['VIP'], ['CID'], '');
  assert.ok(/c\.is_active\s*=\s*true/.test(sql), 'is_active');
  assert.ok(/c\.sms_opt_in\s*=\s*true/.test(sql), 'sms_opt_in');
  assert.ok(/c\.is_opt_out\s+IS\s+NOT\s+TRUE/.test(sql), 'is_opt_out');
  assert.ok(/c\.is_invalid\s+IS\s+NOT\s+TRUE/.test(sql), 'is_invalid');
  assert.ok(/NOT\s+EXISTS[\s\S]*unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id[\s\S]*u\.phone\s*=\s*c\.phone/.test(sql), 'unsub company+phone');
});
ok('FROM customers c + company_id=$1', () => {
  const { sql } = buildSendableRecipientsSql('', [], ['CID'], '');
  assert.ok(/FROM\s+customers\s+c/.test(sql));
  assert.ok(/c\.company_id\s*=\s*\$1/.test(sql));
});
ok('storeFilter 그대로 합성', () => {
  const { sql } = buildSendableRecipientsSql('', [], ['CID'], ' AND id IN (1)');
  assert.ok(sql.includes('AND id IN (1)'));
});
ok('filterWhere 그대로 합성', () => {
  const { sql } = buildSendableRecipientsSql('AND c.grade = ANY($2::text[])', ['x'], ['CID'], '');
  assert.ok(sql.includes('AND c.grade = ANY($2::text[])'));
});
ok('params = baseParams + filterParams (companyId 선두)', () => {
  const { params } = buildSendableRecipientsSql('AND c.grade = $2', ['VIP'], ['CID'], '');
  assert.deepStrictEqual(params, ['CID', 'VIP']);
});
ok('필수 컬럼 SELECT(phone·name·custom_fields)', () => {
  const { sql } = buildSendableRecipientsSql('', [], ['CID'], '');
  assert.ok(/c\.phone/.test(sql) && /c\.name/.test(sql) && /c\.custom_fields/.test(sql));
});
ok('LIMIT 포함', () => {
  const { sql } = buildSendableRecipientsSql('', [], ['CID'], '');
  assert.ok(/LIMIT\s+\d+/.test(sql));
});

console.log('[operator-recipients] excludeClickedSince — 다단계 시퀀스 미반응자(미클릭) 제외');
ok('미지정(null/undefined) → message_click 안티조인 없음(기존 동작 불변)', () => {
  const a = buildSendableRecipientsSql('', [], ['CID'], '');
  const b = buildSendableRecipientsSql('', [], ['CID'], '', null);
  assert.ok(!/message_click/.test(a.sql));
  assert.ok(!/message_click/.test(b.sql));
  assert.deepStrictEqual(b.params, ['CID']);
});
ok('지정 시 → cdp_events message_click NOT EXISTS + occurred_at >= 마지막 param', () => {
  const since = new Date('2026-06-26T00:00:00Z');
  const { sql, params } = buildSendableRecipientsSql('AND c.grade = $2', ['VIP'], ['CID'], '', since);
  assert.ok(/NOT\s+EXISTS[\s\S]*cdp_events\s+ce[\s\S]*message_click/.test(sql), 'message_click 안티조인');
  assert.ok(/ce\.customer_id\s*=\s*c\.id/.test(sql), 'customer 매칭');
  assert.ok(/ce\.occurred_at\s*>=\s*\$3/.test(sql), 'since param $3');
  assert.deepStrictEqual(params, ['CID', 'VIP', since]);
});

console.log(`\n${passed} assertions passed`);
