/**
 * agent-price-gaps.verify.ts — 발송ID 단가 공백 목록의 축 고정 (2026-08-14 신설)
 *
 * 실행: npx tsx packages/backend/src/utils/__tests__/agent-price-gaps.verify.ts
 * (순수 함수·상수만 — DB 연결 불필요.)
 *
 * 기원: `GET /billing/agent-price-gaps`가 "단가 NULL"만 보고 목록을 만들어, 유형이 하나 늘 때마다
 * (0729 브랜드 `G`) 그 유형을 쓰지도 않는 발송ID까지 전부 올라왔다. 0814 실측 190행 중 대부분이
 * 그 소음이었고 정작 급한 "전 유형 미설정" 20행이 묻혔다.
 *
 * 이 파일이 지키는 불변식 둘:
 *   ① 목록의 좁힘 기준 = 발행 게이트와 같다(실적 있는 유형만). 두 기준이 갈리면 목록이 거짓말을 한다.
 *   ② 게이트웨이 MsgType → 청구 유형키 변환은 `agentUsageKey` 한 곳뿐이다(매핑 두 벌 금지).
 */
import assert from 'node:assert';
import { BILLING_TYPES } from '../billing-types';
import { agentUsageKey } from '../send-usage-aggregation';

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

/** 라우트가 쓰는 것과 같은 파생 — 목록을 손으로 두 벌 두면 이 테스트가 의미를 잃는다 */
const PRICEABLE_AGENT_TYPE_KEYS = new Set(
  BILLING_TYPES.filter((t) => t.agentPriceColumn).map((t) => t.key),
);

console.log('[agent-price-gaps] MsgType → 유형키 변환 (agentUsageKey 단일 소스)');
ok('S → SMS', () => assert.strictEqual(agentUsageKey('S'), 'SMS'));
ok('L → LMS', () => assert.strictEqual(agentUsageKey('L'), 'LMS'));
ok('M → MMS', () => assert.strictEqual(agentUsageKey('M'), 'MMS'));
ok('K → KAKAO', () => assert.strictEqual(agentUsageKey('K'), 'KAKAO'));
ok('G → BRAND (0729 추가분)', () => assert.strictEqual(agentUsageKey('G'), 'BRAND'));
ok('소문자도 같은 키', () => assert.strictEqual(agentUsageKey('g'), 'BRAND'));
ok('미지 코드는 원본 보존 — 임의로 뭉치면 조용히 0원이 된다', () =>
  assert.strictEqual(agentUsageKey('KS'), 'KS'));
ok('빈 값 → (유형 미상)', () => assert.strictEqual(agentUsageKey(''), '(유형 미상)'));

console.log('[agent-price-gaps] 단가 입력이 가능한 유형키');
ok('SMS·LMS·MMS·KAKAO·BRAND 5종이 전부 입력 가능', () =>
  assert.deepStrictEqual(
    [...PRICEABLE_AGENT_TYPE_KEYS].sort(),
    ['BRAND', 'KAKAO', 'LMS', 'MMS', 'SMS'],
  ));
ok('KS(카카오 대체발송)는 단가 컬럼이 없다 — 입력으로 못 고친다', () =>
  assert.strictEqual(PRICEABLE_AGENT_TYPE_KEYS.has('KS'), false));
ok('테스트·스팸은 에이전트 축이 아니다', () => {
  assert.strictEqual(PRICEABLE_AGENT_TYPE_KEYS.has('TEST_SMS'), false);
  assert.strictEqual(PRICEABLE_AGENT_TYPE_KEYS.has('SPAM_SMS'), false);
});

console.log('[agent-price-gaps] 축 정합 — 게이트웨이 코드가 있으면 단가 컬럼도 있어야 한다');
ok('agentCode 있는 유형은 전부 agentPriceColumn 보유', () => {
  const broken = BILLING_TYPES.filter((t) => t.agentCode && !t.agentPriceColumn).map((t) => t.key);
  assert.deepStrictEqual(broken, [], `단가 컬럼 없는 게이트웨이 유형: ${broken.join(', ')}`);
});
ok('agentCode → 유형키가 PRICEABLE에 전부 포함', () => {
  for (const t of BILLING_TYPES) {
    if (!t.agentCode) continue;
    assert.strictEqual(
      PRICEABLE_AGENT_TYPE_KEYS.has(agentUsageKey(t.agentCode)), true,
      `${t.agentCode} → ${agentUsageKey(t.agentCode)}가 입력 불가로 분류됨`,
    );
  }
});

console.log('[agent-price-gaps] 좁힘 규칙 — 발행 게이트와 같은 기준');
type Row = { unsetAll: string[]; used: Set<string> | undefined; usageKnown: boolean };
/** 라우트의 좁힘 판정과 같은 식 */
const narrow = (r: Row) => (r.usageKnown ? r.unsetAll.filter((k) => r.used?.has(k)) : r.unsetAll);

ok('BRAND만 비었고 브랜드 실적 없음 → 목록에서 빠진다', () =>
  assert.deepStrictEqual(narrow({ unsetAll: ['BRAND'], used: new Set(['SMS']), usageKnown: true }), []));
ok('BRAND만 비었고 브랜드 실적 있음 → 남는다', () =>
  assert.deepStrictEqual(narrow({ unsetAll: ['BRAND'], used: new Set(['SMS', 'BRAND']), usageKnown: true }), ['BRAND']));
ok('전 유형 미설정 + SMS 실적 → SMS만 남는다', () =>
  assert.deepStrictEqual(
    narrow({ unsetAll: ['SMS', 'LMS', 'MMS', 'KAKAO', 'BRAND'], used: new Set(['SMS']), usageKnown: true }),
    ['SMS'],
  ));
ok('실적 자체가 없는 발송ID → 전부 빠진다', () =>
  assert.deepStrictEqual(narrow({ unsetAll: ['SMS', 'BRAND'], used: undefined, usageKnown: true }), []));
ok('★ 실적을 못 읽으면 fail-open — 전부 보여준다(공백을 숨기지 않는다)', () =>
  assert.deepStrictEqual(
    narrow({ unsetAll: ['SMS', 'BRAND'], used: undefined, usageKnown: false }),
    ['SMS', 'BRAND'],
  ));

console.log(`\n${passed} assertions passed`);
