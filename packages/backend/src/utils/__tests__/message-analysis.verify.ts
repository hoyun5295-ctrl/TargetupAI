// 메시지·콘텐츠 분석 순수 로직 검증 (DB-free)
import assert from 'node:assert';
import { computeMessageTypePerformance, computeLengthDistribution } from '../message-analysis';

// 1) 빈 입력 → []
assert.deepEqual(computeMessageTypePerformance([], {}), []);

// 2) message_type별 집계 + 라벨 + 주입 단가 비용
let m = computeMessageTypePerformance(
  [
    { messageType: 'S', sent: 100, success: 95 },
    { messageType: 'S', sent: 100, success: 90 },
    { messageType: 'L', sent: 50, success: 48 },
  ],
  { S: 20, L: 50 },
);
const sms = m.find((x) => x.rawType === 'S')!;
assert.equal(sms.label, 'SMS');
assert.equal(sms.sent, 200);
assert.equal(sms.success, 185);
assert.ok(Math.abs(sms.successRate - 0.925) < 1e-9);
assert.equal(sms.unitCost, 20);
assert.equal(sms.estimatedCost, 200 * 20);
const lms = m.find((x) => x.rawType === 'L')!;
assert.equal(lms.label, 'LMS');
assert.equal(lms.estimatedCost, 50 * 50);

// 3) 단가 없음 → unitCost null, estimatedCost null (임의 상수 X)
m = computeMessageTypePerformance([{ messageType: 'M', sent: 10, success: 9 }], {});
assert.equal(m[0].label, 'MMS');
assert.equal(m[0].unitCost, null);
assert.equal(m[0].estimatedCost, null);

// 4) 미지/null type → '기타', 알림톡 라벨
m = computeMessageTypePerformance(
  [
    { messageType: 'K', sent: 5, success: 5 },
    { messageType: null, sent: 3, success: 3 },
  ],
  {},
);
assert.equal(m.find((x) => x.rawType === 'K')!.label, '알림톡');
assert.ok(m.some((x) => x.label === '기타'));

// 4-b) 풀네임 message_type(campaigns 실제 값 'SMS'/'LMS'/'MMS'/'KAKAO') 매핑
m = computeMessageTypePerformance(
  [
    { messageType: 'SMS', sent: 10, success: 9 },
    { messageType: 'LMS', sent: 10, success: 9 },
    { messageType: 'MMS', sent: 10, success: 9 },
    { messageType: 'KAKAO', sent: 10, success: 9 },
  ],
  { SMS: 20 },
);
assert.equal(m.find((x) => x.rawType === 'SMS')!.label, 'SMS');
assert.equal(m.find((x) => x.rawType === 'LMS')!.label, 'LMS');
assert.equal(m.find((x) => x.rawType === 'MMS')!.label, 'MMS');
assert.equal(m.find((x) => x.rawType === 'KAKAO')!.label, '알림톡');
assert.equal(m.find((x) => x.rawType === 'SMS')!.estimatedCost, 10 * 20);

// 5) sent=0 → successRate 0, 단가 있으면 estimatedCost 0
m = computeMessageTypePerformance([{ messageType: 'S', sent: 0, success: 0 }], { S: 20 });
assert.equal(m[0].successRate, 0);
assert.equal(m[0].estimatedCost, 0);

// 6) 정렬 = 발송량 내림차순
m = computeMessageTypePerformance(
  [
    { messageType: 'S', sent: 10, success: 9 },
    { messageType: 'L', sent: 100, success: 90 },
  ],
  {},
);
assert.equal(m[0].rawType, 'L');

// 7) 길이 분포 — 단문(≤90)/중문(91~2000)/장문(>2000) 통신 규격
let d = computeLengthDistribution([10, 50, 90, 200, 1500, 2500]);
assert.equal(d.find((x) => x.bucket === '단문')!.count, 3);
assert.equal(d.find((x) => x.bucket === '중문')!.count, 2);
assert.equal(d.find((x) => x.bucket === '장문')!.count, 1);

// 8) 빈 길이 → 3버킷 전부 0
d = computeLengthDistribution([]);
assert.equal(d.length, 3);
assert.ok(d.every((x) => x.count === 0));

console.log('message-analysis pure: PASS');
