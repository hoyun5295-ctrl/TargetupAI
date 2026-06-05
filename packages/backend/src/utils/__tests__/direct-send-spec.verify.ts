/**
 * direct-send-spec.verify.ts — 직접발송 campaign INSERT 파라미터 빌더(순수) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/direct-send-spec.verify.ts
 * (DB import 0 — 파라미터 배열/JSON 합성만 검증. 컬럼 순서 회귀 방지.)
 */
import assert from 'node:assert';
import { buildDirectSendCampaignParams, DirectSendError, type DirectSendSpec } from '../direct-send-spec';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

const base: DirectSendSpec = {
  stagingId: 'STG', campaignName: 'C1', msgType: 'LMS', message: '본문', subject: '제목',
  callback: '01012345678', sendChannel: 'sms', adEnabled: true, total: 50,
  scheduled: false, scheduledAt: null, mmsImagePaths: null,
  dedupEnabled: true, unsubFilterEnabled: true,
};
const ctx = { companyId: 'CID', userId: 'UID' };

console.log('[direct-send-spec] buildDirectSendCampaignParams — INSERT 18 파라미터');
ok('파라미터 18개', () => assert.strictEqual(buildDirectSendCampaignParams(base, ctx).length, 18));
ok('$1 company / $2 name / $3 msgType / $7 total / $12 userId / $15 staging', () => {
  const p = buildDirectSendCampaignParams(base, ctx);
  assert.strictEqual(p[0], 'CID');   // company_id
  assert.strictEqual(p[1], 'C1');    // campaign_name
  assert.strictEqual(p[2], 'LMS');   // message_type
  assert.strictEqual(p[6], 50);      // target_count
  assert.strictEqual(p[11], 'UID');  // created_by
  assert.strictEqual(p[14], 'STG');  // staging_id
});
ok('adEnabled true → is_ad($13)=true', () => assert.strictEqual(buildDirectSendCampaignParams(base, ctx)[12], true));
ok('adEnabled 비-true → is_ad=false', () =>
  assert.strictEqual(buildDirectSendCampaignParams({ ...base, adEnabled: undefined as any }, ctx)[12], false));
ok('scheduled false → status($8)=sending', () => assert.strictEqual(buildDirectSendCampaignParams(base, ctx)[7], 'sending'));
ok('scheduled true → status=scheduled + scheduled_at($9) Date', () => {
  const p = buildDirectSendCampaignParams({ ...base, scheduled: true, scheduledAt: '2026-12-01T10:00:00+09:00' }, ctx);
  assert.strictEqual(p[7], 'scheduled');
  assert.ok(p[8] instanceof Date);
});
ok('sendChannel 미지정 → send_channel($14)=sms', () =>
  assert.strictEqual(buildDirectSendCampaignParams({ ...base, sendChannel: undefined as any }, ctx)[13], 'sms'));
ok('mmsImagePaths 빈/없음 → mms($18)=null', () => {
  assert.strictEqual(buildDirectSendCampaignParams(base, ctx)[17], null);
  assert.strictEqual(buildDirectSendCampaignParams({ ...base, mmsImagePaths: [] }, ctx)[17], null);
});
ok('mmsImagePaths 존재 → mms=JSON 문자열', () => {
  const p = buildDirectSendCampaignParams({ ...base, mmsImagePaths: ['/a.jpg'] }, ctx);
  assert.ok(typeof p[17] === 'string' && p[17].includes('/a.jpg'));
});
ok('send_config($16) JSON에 핵심 필드 포함', () => {
  const cfg = JSON.parse(buildDirectSendCampaignParams(base, ctx)[15]);
  assert.strictEqual(cfg.msgType, 'LMS');
  assert.strictEqual(cfg.sendChannel, 'sms');
  assert.strictEqual(cfg.dedupEnabled, true);
  assert.strictEqual(cfg.unsubFilterEnabled, true);
});
ok('message/subject 누락 시 안전 기본값', () => {
  const p = buildDirectSendCampaignParams({ ...base, message: undefined as any, subject: undefined as any }, ctx);
  assert.strictEqual(p[3], '');     // message_content
  assert.strictEqual(p[4], null);   // subject
});

console.log('[direct-send-spec] DirectSendError');
ok('code/httpStatus 보존', () => {
  const e = new DirectSendError('INSUFFICIENT_BALANCE', '잔액 부족', 402, { balance: 0 });
  assert.strictEqual(e.code, 'INSUFFICIENT_BALANCE');
  assert.strictEqual(e.httpStatus, 402);
  assert.strictEqual((e.extra as any)?.balance, 0);
  assert.ok(e instanceof Error);
});

console.log(`\n${passed} assertions passed`);
