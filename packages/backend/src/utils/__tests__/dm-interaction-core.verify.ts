/**
 * dm-interaction-core.verify.ts — DM 인터랙션 순수 코어 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts
 */
import assert from 'node:assert';
import {
  makeSeededRng,
  pickRouletteSegment,
  drawWinners,
  parseWinnerRows,
  sumProbabilities,
  buildEventInsight,
} from '../dm/dm-interaction-core';

let passed = 0;
const ok = (n: string, f: () => void) => {
  f();
  passed++;
  console.log(`  ok - ${n}`);
};

const SEGS = [
  { id: '1', label: '1등', probability: 0.1 },
  { id: '2', label: '2등', probability: 0.3 },
  { id: '3', label: '꽝', probability: 0.6 },
];

console.log('[pickRouletteSegment]');
ok('가중 랜덤 — rng 0 → 첫 세그먼트 + 당첨', () => {
  const r = pickRouletteSegment(SEGS, { '1': { prizeId: 'p1', remaining: 5 } }, () => 0);
  assert.strictEqual(r.segmentId, '1');
  assert.strictEqual(r.won, true);
  assert.strictEqual(r.prizeId, 'p1');
});
ok('재고 0 세그먼트 = 꽝(won=false)', () => {
  const r = pickRouletteSegment(SEGS, { '1': { prizeId: 'p1', remaining: 0 } }, () => 0);
  assert.strictEqual(r.segmentId, '1');
  assert.strictEqual(r.won, false);
  assert.strictEqual(r.prizeId, null);
});
ok('경품 없는 세그먼트(꽝 구간) = won=false', () => {
  const r = pickRouletteSegment(SEGS, {}, () => 0.99);
  assert.strictEqual(r.segmentId, '3');
  assert.strictEqual(r.won, false);
});
ok('확률 합 0 → 균등 fallback(에러 X)', () => {
  const r = pickRouletteSegment([{ id: 'a', label: 'A', probability: 0 }], {}, () => 0.5);
  assert.strictEqual(r.segmentId, 'a');
});
ok('빈 세그먼트 안전', () => {
  const r = pickRouletteSegment([], {}, () => 0.5);
  assert.strictEqual(r.segmentId, '');
  assert.strictEqual(r.won, false);
});

console.log('[drawWinners]');
const ENTRIES = Array.from({ length: 10 }, (_, i) => ({ responseId: `r${i}`, key: `k${i}` }));
ok('등급별 인원만큼 추첨(1등1 + 2등2 = 3명)', () => {
  const w = drawWinners(
    ENTRIES,
    [{ prizeId: 'p1', rank: 1, count: 1 }, { prizeId: 'p2', rank: 2, count: 2 }],
    'seed-x',
  );
  assert.strictEqual(w.length, 3);
  assert.strictEqual(w.filter((x) => x.rank === 1).length, 1);
  assert.strictEqual(w.filter((x) => x.rank === 2).length, 2);
});
ok('중복 당첨 없음(responseId 유일)', () => {
  const w = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'seed-y');
  assert.strictEqual(new Set(w.map((x) => x.responseId)).size, w.length);
});
ok('같은 key 중복 응모는 1회만 풀 진입', () => {
  const dup = [
    { responseId: 'a', key: 'same' },
    { responseId: 'b', key: 'same' },
    { responseId: 'c', key: 'other' },
  ];
  const w = drawWinners(dup, [{ prizeId: 'p1', rank: 1, count: 5 }], 'seed-z');
  assert.strictEqual(w.length, 2);
});
ok('응모 < 인원 → 가능분만', () => {
  const w = drawWinners(ENTRIES.slice(0, 2), [{ prizeId: 'p1', rank: 1, count: 5 }], 'seed-q');
  assert.strictEqual(w.length, 2);
});
ok('같은 시드 = 같은 결과(재현)', () => {
  const a = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'fixed');
  const b = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'fixed');
  assert.deepStrictEqual(a.map((x) => x.responseId), b.map((x) => x.responseId));
});

console.log('[parseWinnerRows]');
ok('정상 행 파싱(한글 헤더 + 전화 정규화)', () => {
  const r = parseWinnerRows([{ 이름: '홍길동', 전화: '010-1234-5678', 이메일: 'a@b.c', 등급: 1 }]);
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.winners[0], { name: '홍길동', phone: '01012345678', email: 'a@b.c', rank: 1 });
});
ok('전화 누락 = 행 오류', () => {
  const r = parseWinnerRows([{ name: '김', email: 'x@y.z' }]);
  assert.strictEqual(r.winners.length, 0);
  assert.strictEqual(r.errors.length, 1);
});
ok('등급 비정상(문자) = 행 오류', () => {
  const r = parseWinnerRows([{ name: '이', phone: '01000000000', rank: 'A' }]);
  assert.strictEqual(r.errors.length, 1);
});
ok('등급 비우면 rank=null 허용', () => {
  const r = parseWinnerRows([{ name: '박', phone: '01011112222' }]);
  assert.strictEqual(r.winners[0].rank, null);
  assert.strictEqual(r.errors.length, 0);
});

console.log('[sumProbabilities]');
ok('합계 = 1.0', () => assert.ok(Math.abs(sumProbabilities(SEGS) - 1.0) < 1e-9));

console.log('[makeSeededRng]');
ok('결정적 — 같은 시드 같은 첫 값', () => {
  assert.strictEqual(makeSeededRng('s')(), makeSeededRng('s')());
});

console.log('[buildEventInsight]');
ok('데이터 0 = insufficient(추정 0)', () => {
  const r = buildEventInsight({ total_responses: 0, unique_participants: 0, views: 0, winners: 0, by_section: [] });
  assert.strictEqual(r.hasData, false);
});
ok('응모/열람 = 전환율 + 당첨 라인(실측)', () => {
  const r = buildEventInsight({ total_responses: 50, unique_participants: 40, views: 200, winners: 3, by_section: [{ section_type: 'lucky_draw', responses: 50, members: 30 }] });
  assert.strictEqual(r.hasData, true);
  assert.ok(r.lines.some((l) => l.includes('전환율')), r.lines.join(' '));
  assert.ok(r.lines.some((l) => l.includes('당첨 3명')), r.lines.join(' '));
});
ok('열람만 + 응모 0 = 응모 전 안내', () => {
  const r = buildEventInsight({ total_responses: 0, unique_participants: 0, views: 30, winners: 0, by_section: [] });
  assert.strictEqual(r.hasData, true);
  assert.ok(r.headline.includes('응모 전'), r.headline);
});

console.log(`\n[dm-interaction-core] ${passed} assertions GREEN`);
