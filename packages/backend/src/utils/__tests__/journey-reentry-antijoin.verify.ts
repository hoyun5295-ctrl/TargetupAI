/**
 * journey-reentry-antijoin.verify.ts — 진입 안티조인 빌더(순수) 검증
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/journey-reentry-antijoin.verify.ts
 * (문자열 + params push만 검증 — DB 연결 불필요. 휴면·생일·포인트 추출이 회차마다 다음 분으로 밀리게 하는 dedup 조각.)
 *
 * 판정 기준 = checkCooldown(trigger-watcher)과 동일:
 *   - 재진입 불가 → execution이 하나라도 있으면 제외
 *   - 재진입 가능 + cooldown>0 → active이거나 마지막 진입이 cooldown 안이면 제외
 *   - 재진입 가능 + cooldown<=0 → 제외 없음(무제한 재진입, LIMIT 스로틀만)
 */
import assert from 'node:assert';
import { buildReentryAntiJoin } from '../journey-safety-filter';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[buildReentryAntiJoin] 재진입 불가 — 모든 execution 제외');
{
  const params: any[] = ['cid'];               // $1 이미 점유
  const frag = buildReentryAntiJoin('c', params, 'jid', false, 0);
  ok('NOT EXISTS journey_executions', () => assert.ok(/NOT\s+EXISTS\s*\([\s\S]*journey_executions\s+je/.test(frag)));
  ok('customer_id = c.id 매칭', () => assert.ok(/je\.customer_id\s*=\s*c\.id/.test(frag)));
  ok('status/entered_at 조건 없음(전부 제외)', () => assert.ok(!/status|entered_at/.test(frag)));
  ok('journeyId 1개만 push → $2 참조', () => assert.ok(params.length === 2 && /je\.journey_id\s*=\s*\$2::uuid/.test(frag)));
  ok('AND 로 시작(호출부에 직접 이어붙임)', () => assert.ok(/^AND\s+NOT\s+EXISTS/.test(frag)));
}

console.log('[buildReentryAntiJoin] 재진입 가능 + cooldown<=0 — 제외 없음');
{
  const params: any[] = ['cid'];
  const frag = buildReentryAntiJoin('c', params, 'jid', true, 0);
  ok('빈 문자열', () => assert.strictEqual(frag, ''));
  ok('params push 없음', () => assert.strictEqual(params.length, 1));
}

console.log('[buildReentryAntiJoin] 재진입 가능 + cooldown>0 — active 또는 cooldown 안 제외');
{
  const params: any[] = ['cid', 'x'];          // $1,$2 이미 점유
  const frag = buildReentryAntiJoin('c', params, 'jid', true, 90);
  ok('status=active 포함', () => assert.ok(/je\.status\s*=\s*'active'/.test(frag)));
  ok('entered_at cooldown 창', () => assert.ok(/je\.entered_at\s*>\s*NOW\(\)\s*-\s*\(\$4\s*\|\|\s*' days'\)::interval/.test(frag)));
  ok('journeyId $3 + cooldown일수 $4 push', () => assert.ok(params.length === 4 && /je\.journey_id\s*=\s*\$3::uuid/.test(frag) && params[3] === '90'));
}

console.log('[buildReentryAntiJoin] alias 치환 + cooldown 소수 내림');
{
  const params: any[] = [];
  const frag = buildReentryAntiJoin('x', params, 'jid', false, 0);
  ok('alias=x 반영', () => assert.ok(/je\.customer_id\s*=\s*x\.id/.test(frag)));
  const p2: any[] = [];
  buildReentryAntiJoin('c', p2, 'jid', true, 30.9);
  ok('cooldown 30.9 → 정수 30', () => assert.strictEqual(p2[1], '30'));
}

console.log(`\n${passed} assertions passed`);
