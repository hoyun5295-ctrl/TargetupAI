/**
 * journey-entry-ledger.verify.ts — 진입 원장 안티조인 빌더(순수) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-entry-ledger.verify.ts
 * (DB import 0 — 문자열만 검증. seed/record/hasBaseline은 DB 의존이라 별도 통합 확인.)
 */
import assert from 'node:assert';
import { buildLedgerAntiJoin } from '../journey-entry-ledger';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-entry-ledger] buildLedgerAntiJoin(c, 9)');
const frag = buildLedgerAntiJoin('c', 9);
ok('NOT EXISTS + 원장 테이블', () => assert.ok(/NOT\s+EXISTS\s*\([\s\S]*journey_entry_ledger\s+l/.test(frag)));
ok('journey_id 파라미터 $9', () => assert.ok(/l\.journey_id\s*=\s*\$9/.test(frag)));
ok('company_id 매칭', () => assert.ok(/l\.company_id\s*=\s*c\.company_id/.test(frag)));
// ★ 2026-08-01 판정 키에서 매장코드 제거(설계서 §3-0-2) — 매장을 옮겨 재등록된 사람이 신규가 되던 결함.
//   회귀 방지로 "store_code가 조각에 없다"를 못 박는다. 되살리면 이 단정이 깨진다.
ok('store_code를 판정에 쓰지 않는다(사람 단위 식별)', () => assert.ok(!/store_code/.test(frag)));
ok('phone 매칭', () => assert.ok(/l\.phone\s*=\s*c\.phone/.test(frag)));
ok('파라미터는 journeyId 1개만($n 1회)', () => assert.ok((frag.match(/\$\d+/g) || []).length === 1));

console.log('[journey-entry-ledger] alias 치환');
const fx = buildLedgerAntiJoin('x', 3);
ok('다른 alias=x 반영', () => assert.ok(/l\.company_id\s*=\s*x\.company_id/.test(fx) && /l\.phone\s*=\s*x\.phone/.test(fx) && /l\.journey_id\s*=\s*\$3/.test(fx)));

console.log(`\n${passed} assertions passed`);
