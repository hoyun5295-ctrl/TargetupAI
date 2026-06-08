// 우선순위 액션 플랜 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { buildActionPlan } from '../action-plan';

// 1) 전부 비어있으면 빈 배열
let p = buildActionPlan({ aiRecommendation: null, atRiskCount: 0, dormantCount: 0, lowPerformingChannels: [], newCustomerPct: null });
assert.deepEqual(p, []);

// 2) AI 권장은 항상 1순위
p = buildActionPlan({ aiRecommendation: '주말 저녁 발송 비중을 높이세요', atRiskCount: 10, dormantCount: 5, lowPerformingChannels: [], newCustomerPct: null });
assert.equal(p[0].priority, 1);
assert.ok(p[0].basis.includes('AI'));
assert.equal(p[0].expectedEffect, null);

// 3) 세그먼트는 규모 큰 순(이탈위험 50 > 휴면 30), priority 연속, 잠재매출 null
p = buildActionPlan({ aiRecommendation: null, atRiskCount: 50, dormantCount: 30, lowPerformingChannels: [], newCustomerPct: null });
assert.ok(p[0].basis.includes('50'));
assert.ok(p[1].basis.includes('30'));
assert.equal(p[0].priority, 1);
assert.equal(p[1].priority, 2);
assert.equal(p[0].expectedEffect, null);
assert.ok(p[0].linkHint && p[0].linkHint.length > 0);

// 4) 휴면이 더 크면 휴면 먼저
p = buildActionPlan({ aiRecommendation: null, atRiskCount: 10, dormantCount: 80, lowPerformingChannels: [], newCustomerPct: null });
assert.ok(p[0].basis.includes('휴면'));

// 5) 저성과 채널은 세그먼트보다 뒤, linkHint 없음, 성공률 근거
p = buildActionPlan({ aiRecommendation: null, atRiskCount: 10, dormantCount: 0, lowPerformingChannels: [{ label: 'MMS', successRate: 0.7 }], newCustomerPct: null });
const channelItem = p.find((x) => x.title.includes('MMS'))!;
const segItem = p.find((x) => x.basis.includes('이탈'))!;
assert.ok(segItem.priority < channelItem.priority);
assert.equal(channelItem.linkHint, null);
assert.ok(channelItem.basis.includes('70'));

// 6) AI + 세그먼트 + 채널 종합 순서
p = buildActionPlan({ aiRecommendation: 'x', atRiskCount: 5, dormantCount: 0, lowPerformingChannels: [{ label: 'SMS', successRate: 0.5 }], newCustomerPct: null });
assert.ok(p[0].basis.includes('AI'));
assert.ok(p[1].basis.includes('이탈'));
assert.ok(p[2].title.includes('SMS'));
assert.deepEqual(p.map((x) => x.priority), [1, 2, 3]);

console.log('action-plan pure: PASS');
