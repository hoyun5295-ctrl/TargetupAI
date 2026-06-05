/**
 * journey-list-filter.verify.ts — 목록 status 화이트리스트(순수) 검증
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/journey-list-filter.verify.ts
 * (DB import 0. status를 화이트리스트에 있을 때만 SQL 조각에 넣어 주입을 차단하는지 검증.)
 */
import assert from 'node:assert';
import { journeyListWhere, executionStatusFilter } from '../journey-list-filter';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journeyListWhere] 여정 목록 WHERE 조각');
ok('active → status=active + archived IS NULL', () =>
  assert.strictEqual(journeyListWhere('active'), `AND status = 'active' AND archived_at IS NULL`));
ok('draft/paused/ended 허용', () =>
  assert.ok(journeyListWhere('paused').includes(`status = 'paused'`) && journeyListWhere('ended').includes(`status = 'ended'`)));
ok('archived → archived IS NOT NULL', () =>
  assert.strictEqual(journeyListWhere('archived'), `AND archived_at IS NOT NULL`));
ok('all → archived IS NULL(상태필터 없음)', () =>
  assert.strictEqual(journeyListWhere('all'), `AND archived_at IS NULL`));
ok('undefined → archived IS NULL', () =>
  assert.strictEqual(journeyListWhere(undefined), `AND archived_at IS NULL`));
ok('주입 시도 → 무시(안전 기본값)', () =>
  assert.strictEqual(journeyListWhere(`active' OR '1'='1`), `AND archived_at IS NULL`));
ok('주입 문자열이 SQL 조각에 안 들어감', () =>
  assert.ok(!/OR|1=1|--|;/.test(journeyListWhere(`active'; DROP TABLE journeys; --`))));

console.log('[executionStatusFilter] 실행 목록 status 필터');
ok('completed → e.status=completed', () =>
  assert.strictEqual(executionStatusFilter('completed'), `AND e.status = 'completed'`));
ok('active/failed/paused/ended 허용', () =>
  assert.ok(executionStatusFilter('failed').includes(`e.status = 'failed'`)));
ok('undefined → 빈 문자열', () =>
  assert.strictEqual(executionStatusFilter(undefined), ''));
ok('주입 시도 → 빈 문자열', () =>
  assert.strictEqual(executionStatusFilter(`x'; DROP TABLE journey_executions; --`), ''));

console.log(`\n${passed} assertions passed`);
