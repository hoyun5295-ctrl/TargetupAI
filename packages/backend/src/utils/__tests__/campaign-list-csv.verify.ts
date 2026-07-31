/**
 * campaign-list-csv.verify.ts — 발송결과 채널통합조회 CSV 빌더 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/campaign-list-csv.verify.ts
 * (DB import 0 — 채널 라벨 + CSV 직렬화 순수 함수.)
 */
import assert from 'node:assert';
import { buildCampaignListCsv, channelPlainLabel } from '../campaign-list-csv';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[campaign-list-csv] channelPlainLabel');
ok('kakao/alimtalk/both/LMS/MMS/SMS/default', () => {
  assert.strictEqual(channelPlainLabel('kakao', 'SMS'), '브랜드메시지');
  assert.strictEqual(channelPlainLabel('kakao_brand', 'LMS'), '브랜드메시지');
  assert.strictEqual(channelPlainLabel('alimtalk', 'LMS'), '알림톡');
  assert.strictEqual(channelPlainLabel('both', 'SMS'), 'SMS+브랜드메시지');
  assert.strictEqual(channelPlainLabel('sms', 'LMS'), 'LMS');
  assert.strictEqual(channelPlainLabel('sms', 'L'), 'LMS');
  assert.strictEqual(channelPlainLabel('sms', 'MMS'), 'MMS');
  assert.strictEqual(channelPlainLabel('sms', 'SMS'), 'SMS');
  assert.strictEqual(channelPlainLabel(null, null), 'SMS');
});

console.log('[campaign-list-csv] buildCampaignListCsv');
ok('BOM + 헤더 + 행 + 콤마 escape', () => {
  const csv = buildCampaignListCsv([
    { message: '안녕하세요, 반갑습니다', createdAt: '2026-05-04 13:17', sentAt: '2026-05-04 14:00', channel: 'LMS', sent: 8, success: 8, fail: 0, pending: 0, rate: 100, sender: 'suran' },
  ]);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.replace('﻿', '').split('\n');
  assert.strictEqual(lines[0], '메시지내용,등록일시,발송일시,채널,전송건수,성공,실패,대기,성공률(%),발송자');
  assert.ok(lines[1].includes('"안녕하세요, 반갑습니다"')); // 콤마 → 큰따옴표로 감쌈
  assert.ok(lines[1].includes('8,8,0,0,100,suran'));
});

ok('메시지 줄바꿈 → 공백 1줄 (엑셀 셀 개행 방지) + 큰따옴표 escape', () => {
  const csv = buildCampaignListCsv([
    { message: '제목 "특가"\n\n둘째줄', createdAt: '', sentAt: '', channel: 'SMS', sent: 1, success: 1, fail: 0, pending: 0, rate: 100, sender: '' },
  ]);
  assert.ok(csv.includes('"제목 ""특가"" 둘째줄"')); // \n\n → 공백 1개, " → ""
  assert.ok(!/특가""\s*\n/.test(csv));               // 메시지 셀 내부 개행 없음(행 폭발 방지)
});

ok('빈 배열 → 헤더만', () => {
  const csv = buildCampaignListCsv([]);
  assert.strictEqual(csv, '﻿메시지내용,등록일시,발송일시,채널,전송건수,성공,실패,대기,성공률(%),발송자');
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
