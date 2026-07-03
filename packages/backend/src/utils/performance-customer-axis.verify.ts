/**
 * performance-customer-axis-core 순수 검증 (DB-free — config/database 미import)
 * 실행: npx ts-node src/utils/performance-customer-axis.verify.ts
 */
import { mergeGradePerformance, toGradeCountMap, GradeComponents } from './performance-customer-axis-core';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`ok - ${name}`); }
  else { fail++; console.log(`FAIL - ${name}`); }
}

// 1) toGradeCountMap — 기본 변환 + 0/음수/NaN 제외 + 같은 등급 합산
const m1 = toGradeCountMap([
  { grade: 'VIP', cnt: 3 },
  { grade: 'VIP', cnt: 2 },
  { grade: '일반', cnt: 0 },
  { grade: '일반', cnt: 'x' },
  { grade: '', cnt: 5 },
]);
check('toGradeCountMap 같은 등급 합산', m1.get('VIP') === 5);
check('toGradeCountMap 0/NaN 제외', !m1.has('일반'));
check('toGradeCountMap 빈 grade → (미분류)', m1.get('(미분류)') === 5);

// 2) mergeGradePerformance — 전 컴포넌트 병합 + 없는 값 0
const empty = () => toGradeCountMap([]);
const comps: GradeComponents = {
  journeySent: toGradeCountMap([{ grade: 'VIP', cnt: 10 }]),
  dmSent: toGradeCountMap([{ grade: 'VIP', cnt: 4 }, { grade: '신규', cnt: 7 }]),
  dmViewers: toGradeCountMap([{ grade: 'VIP', cnt: 3 }]),
  emailClickers: empty(),
  smsTargetedSent: toGradeCountMap([{ grade: '일반', cnt: 100 }]),
  buyers: toGradeCountMap([{ grade: 'VIP', cnt: 2 }]),
  revenue: toGradeCountMap([{ grade: 'VIP', cnt: 50000 }, { grade: '신규', cnt: 12000 }]),
};
const rows = mergeGradePerformance(comps);
check('병합 행 수 = 등장 등급 3', rows.length === 3);
const vip = rows.find((r) => r.grade === 'VIP')!;
check('VIP 행 조립', !!vip && vip.journeySent === 10 && vip.dmSent === 4 && vip.dmViewers === 3 && vip.buyers === 2 && vip.revenue === 50000);
check('없는 컴포넌트 = 0', vip.emailClickers === 0 && vip.smsTargetedSent === 0);

// 3) 정렬 — 매출 desc 우선
check('정렬 1위 = VIP(매출 50000)', rows[0].grade === 'VIP');
check('정렬 2위 = 신규(매출 12000)', rows[1].grade === '신규');
check('정렬 3위 = 일반(매출 0, 발송만)', rows[2].grade === '일반');

// 4) 전 컬럼 0 행 제거
const comps2: GradeComponents = {
  journeySent: empty(), dmSent: empty(), dmViewers: empty(), emailClickers: empty(),
  smsTargetedSent: empty(), buyers: empty(), revenue: empty(),
};
check('전부 빈 컴포넌트 = 빈 배열', mergeGradePerformance(comps2).length === 0);

// 5) 매출 float 보존
const m2 = toGradeCountMap([{ grade: 'A', cnt: 1234.56 }]);
check('float 매출 보존', m2.get('A') === 1234.56);

console.log(`\n${pass + fail} tests: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
