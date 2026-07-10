/**
 * operator-recipients.verify.ts — 발송 가능 수신자 추출 SQL(공통 안전필터) 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/operator-recipients.verify.ts
 * (DB import 0 — buildSendableRecipientsSql은 문자열만 합성. filterWhere는 주입.)
 */
import assert from 'node:assert';
import {
  buildSendableRecipientsSql, buildSendableStagingInsertSql,
  buildSendableRecipientsTopSql, resolveConditionColumns, ConditionFieldDef,
} from '../operator-recipients';

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

console.log('[operator-recipients] buildSendableStagingInsertSql — 발송용 서버사이드 적재(상한 없음)');
ok('INSERT INTO campaign_send_staging + SELECT customers (UNNEST 아님)', () => {
  const { sql } = buildSendableStagingInsertSql('STG', 'CID', '', [], '');
  assert.ok(/INSERT\s+INTO\s+campaign_send_staging\s*\(staging_id,\s*company_id,\s*phone,\s*name\)/.test(sql), 'INSERT 대상 4컬럼');
  assert.ok(/FROM\s+customers\s+c/.test(sql), 'SELECT FROM customers');
  assert.ok(!/UNNEST/.test(sql), 'Node 배열 UNNEST 없음');
});
ok('LIMIT 없음 (강제 상한 제거 — 발송 전량)', () => {
  const { sql } = buildSendableStagingInsertSql('STG', 'CID', '', [], '');
  assert.ok(!/LIMIT/i.test(sql), 'LIMIT 미포함');
});
ok('발송 안전필터 4종 + 회사+전화 안티조인 동일 적용', () => {
  const { sql } = buildSendableStagingInsertSql('STG', 'CID', '', [], '');
  assert.ok(/c\.is_active\s*=\s*true/.test(sql), 'is_active');
  assert.ok(/c\.sms_opt_in\s*=\s*true/.test(sql), 'sms_opt_in');
  assert.ok(/c\.is_opt_out\s+IS\s+NOT\s+TRUE/.test(sql), 'is_opt_out');
  assert.ok(/c\.is_invalid\s+IS\s+NOT\s+TRUE/.test(sql), 'is_invalid');
  assert.ok(/unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id[\s\S]*u\.phone\s*=\s*c\.phone/.test(sql), 'unsub company+phone');
});
ok('phone 숫자만 정규화(regexp_replace) + name 적재', () => {
  const { sql } = buildSendableStagingInsertSql('STG', 'CID', '', [], '');
  assert.ok(/regexp_replace\(c\.phone,\s*'\[\^0-9\]',\s*''/.test(sql), 'phone digit-strip');
  assert.ok(/c\.name/.test(sql), 'name 적재');
});
ok('param 배치 = companyId $1, filterParams $2+, stagingId 마지막', () => {
  const { sql, params } = buildSendableStagingInsertSql('STG', 'CID', 'AND c.grade = $2', ['VIP'], '');
  assert.deepStrictEqual(params, ['CID', 'VIP', 'STG'], 'params 순서');
  assert.ok(/c\.company_id\s*=\s*\$1/.test(sql), 'company $1');
  assert.ok(/\$3::uuid/.test(sql), 'stagingId $3(마지막)');
  assert.ok(sql.includes('AND c.grade = $2'), 'filterWhere 그대로');
});
ok('storeFilter 그대로 합성', () => {
  const { sql } = buildSendableStagingInsertSql('STG', 'CID', '', [], ' AND c.id IN (1)');
  assert.ok(sql.includes('AND c.id IN (1)'));
});
ok('excludeClickedSince 미지정 → message_click 안티조인 없음', () => {
  const { sql, params } = buildSendableStagingInsertSql('STG', 'CID', '', [], '', null);
  assert.ok(!/message_click/.test(sql));
  assert.deepStrictEqual(params, ['CID', 'STG']);
});
ok('excludeClickedSince 지정 → 미클릭가드 + stagingId는 since 뒤(마지막)', () => {
  const since = new Date('2026-06-26T00:00:00Z');
  const { sql, params } = buildSendableStagingInsertSql('STG', 'CID', 'AND c.grade = $2', ['VIP'], '', since);
  assert.ok(/NOT\s+EXISTS[\s\S]*cdp_events\s+ce[\s\S]*message_click/.test(sql), 'message_click 안티조인');
  assert.ok(/ce\.occurred_at\s*>=\s*\$3/.test(sql), 'since $3');
  assert.ok(/\$4::uuid/.test(sql), 'stagingId $4(since 뒤)');
  assert.deepStrictEqual(params, ['CID', 'VIP', since, 'STG']);
});

console.log('[operator-recipients] buildSendableRecipientsTopSql — [타겟확인] 상한 100 명단 (2026-07-10)');
ok('안전필터 4종 + 회사+전화 안티조인 동일 적용', () => {
  const { sql } = buildSendableRecipientsTopSql('', [], ['CID'], '');
  assert.ok(/c\.is_active\s*=\s*true/.test(sql), 'is_active');
  assert.ok(/c\.sms_opt_in\s*=\s*true/.test(sql), 'sms_opt_in');
  assert.ok(/c\.is_opt_out\s+IS\s+NOT\s+TRUE/.test(sql), 'is_opt_out');
  assert.ok(/c\.is_invalid\s+IS\s+NOT\s+TRUE/.test(sql), 'is_invalid');
  assert.ok(/NOT\s+EXISTS[\s\S]*unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id[\s\S]*u\.phone\s*=\s*c\.phone/.test(sql), 'unsub company+phone');
});
ok('ORDER BY c.id ASC(결정적) + LIMIT 100 고정 · COUNT/OFFSET 없음', () => {
  const { sql } = buildSendableRecipientsTopSql('', [], ['CID'], '');
  assert.ok(/ORDER\s+BY\s+c\.id\s+ASC/.test(sql), 'ORDER BY c.id ASC');
  assert.ok(/LIMIT\s+100/.test(sql), 'LIMIT 100');
  assert.ok(!/COUNT\(/i.test(sql) && !/OFFSET/i.test(sql), 'COUNT·OFFSET 없음');
});
ok('limit clamp — 0/음수→1, 500→100', () => {
  const a = buildSendableRecipientsTopSql('', [], ['CID'], '', null, null, [], 0);
  const b = buildSendableRecipientsTopSql('', [], ['CID'], '', null, null, [], 500);
  assert.ok(/LIMIT\s+100/.test(a.sql), '0(falsy)→기본 100');
  assert.ok(/LIMIT\s+100/.test(b.sql), '500→100');
  const c = buildSendableRecipientsTopSql('', [], ['CID'], '', null, null, [], -5);
  assert.ok(/LIMIT\s+1\b/.test(c.sql), '음수→1');
});
ok('기본 SELECT = phone·name만 / extraColumns 전달 시 select 조각 합성', () => {
  const base = buildSendableRecipientsTopSql('', [], ['CID'], '');
  assert.ok(/SELECT\s+c\.phone,\s*c\.name\s*\n/.test(base.sql), '기본 phone·name');
  const cols = [
    { key: 'grade', label: '고객등급', select: 'c.grade AS grade' },
    { key: 'custom_3', label: '커스텀3', select: "c.custom_fields->>'custom_3' AS custom_3" },
  ];
  const { sql } = buildSendableRecipientsTopSql('', [], ['CID'], '', null, null, cols);
  assert.ok(sql.includes('c.grade AS grade'), '실컬럼 select');
  assert.ok(sql.includes("c.custom_fields->>'custom_3' AS custom_3"), 'custom_fields select');
});
ok('param 배치 = staging과 동일 (companyId $1, filterParams, since, fatigue days·max)', () => {
  const since = new Date('2026-06-26T00:00:00Z');
  const { sql, params } = buildSendableRecipientsTopSql('AND c.grade = $2', ['VIP'], ['CID'], '', since, { days: 7, max: 3 });
  assert.deepStrictEqual(params, ['CID', 'VIP', since, 7, 3], 'params 순서');
  assert.ok(/ce\.occurred_at\s*>=\s*\$3/.test(sql), 'since $3');
  assert.ok(/\$4::int/.test(sql) && /\$5::int/.test(sql), 'fatigue $4·$5');
});
ok('★ WHERE 조각 = 발송 추출(buildSendableStagingInsertSql)과 문자 동일 (원칙 2 — 보여준 명단=나가는 명단)', () => {
  const since = new Date('2026-06-26T00:00:00Z');
  const cap = { days: 7, max: 3 };
  const top = buildSendableRecipientsTopSql('AND c.grade = $2', ['VIP'], ['CID'], '', since, cap);
  const stg = buildSendableStagingInsertSql('STG', 'CID', 'AND c.grade = $2', ['VIP'], '', since, cap);
  const whereOf = (sql: string, tail: RegExp) => sql.slice(sql.indexOf('WHERE')).replace(tail, '').replace(/\s+/g, ' ').trim();
  const topWhere = whereOf(top.sql, /ORDER\s+BY[\s\S]*$/);
  const stgWhere = whereOf(stg.sql, /$^/);
  assert.strictEqual(topWhere, stgWhere, 'WHERE 조각 동일');
});

console.log('[operator-recipients] resolveConditionColumns — 조건 필드 화이트리스트 해석');
const DEFS: ConditionFieldDef[] = [
  { fieldKey: 'gender', displayName: '성별', storageType: 'column', columnName: 'gender' },
  { fieldKey: 'age', displayName: '나이', storageType: 'column', columnName: 'age' },
  { fieldKey: 'region', displayName: '지역', storageType: 'column', columnName: 'region' },
  { fieldKey: 'grade', displayName: '고객등급', storageType: 'column', columnName: 'grade' },
  { fieldKey: 'points', displayName: '보유포인트', storageType: 'column', columnName: 'points' },
  { fieldKey: 'custom_3', displayName: '커스텀3', storageType: 'custom_fields', columnName: 'custom_3' },
];
ok('VVIP+포인트 → 등급·포인트 (FIELD_MAP 순서 유지)', () => {
  const cols = resolveConditionColumns({ points: { operator: 'gte', value: 5000 }, grade: 'VVIP' }, DEFS);
  assert.deepStrictEqual(cols.map((c) => c.key), ['grade', 'points'], 'defs 순서');
  assert.deepStrictEqual(cols.map((c) => c.label), ['고객등급', '보유포인트'], 'displayName 라벨');
  assert.strictEqual(cols[0].select, 'c.grade AS grade');
});
ok('minAge/max_age → age 1건 통합', () => {
  const cols = resolveConditionColumns({ minAge: 30, max_age: 49 }, DEFS);
  assert.deepStrictEqual(cols.map((c) => c.key), ['age']);
});
ok("custom_fields.custom_3 접두 → custom_3 (->> select)", () => {
  const cols = resolveConditionColumns({ 'custom_fields.custom_3': { operator: 'contains', value: '골드' } }, DEFS);
  assert.deepStrictEqual(cols.map((c) => c.key), ['custom_3']);
  assert.strictEqual(cols[0].select, "c.custom_fields->>'custom_3' AS custom_3");
});
ok('미등록 키·빈 값(null/""/빈배열)·phone·name 제외', () => {
  const cols = resolveConditionColumns(
    { unknown_field: 'x', gender: '', region: null, grade: [], phone: '010', name: '김', points: 100 },
    DEFS,
  );
  assert.deepStrictEqual(cols.map((c) => c.key), ['points']);
});
ok('filters null/undefined → 빈 배열', () => {
  assert.deepStrictEqual(resolveConditionColumns(null, DEFS), []);
  assert.deepStrictEqual(resolveConditionColumns(undefined, DEFS), []);
});

console.log(`\n${passed} assertions passed`);
