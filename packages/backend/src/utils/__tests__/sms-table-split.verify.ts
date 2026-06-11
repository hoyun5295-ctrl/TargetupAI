/**
 * sms-table-split.verify.ts — 라이브/이력 분리 + 정합성 카운트 병합 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/sms-table-split.verify.ts
 * (DB import 0 — 큐→이력 이동 중 이중 카운트 차단 산식 검증. toun28 6/11 실측이 기준 사례.)
 */
import assert from 'node:assert';
import { splitLiveAndLogTables, mergeCampaignCounts } from '../sms-table-split';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[sms-table-split] splitLiveAndLogTables');
ok('라이브/이력 분리 — _YYYYMM 접미사 기준', () => {
  const r = splitLiveAndLogTables(['SMSQ_SEND_7', 'SMSQ_SEND_7_202606', 'SMSQ_SEND_8', 'SMSQ_SEND_8_202605']);
  assert.deepStrictEqual(r.live, ['SMSQ_SEND_7', 'SMSQ_SEND_8']);
  assert.deepStrictEqual(r.logs, ['SMSQ_SEND_7_202606', 'SMSQ_SEND_8_202605']);
});
ok('이력 없는 입력 → logs 빈 배열', () => {
  const r = splitLiveAndLogTables(['SMSQ_SEND_1', 'SMSQ_SEND_2']);
  assert.deepStrictEqual(r.logs, []);
});
ok('빈 입력 → 둘 다 빈 배열', () => {
  const r = splitLiveAndLogTables([]);
  assert.deepStrictEqual(r, { live: [], logs: [] });
});

console.log('[sms-table-split] mergeCampaignCounts — 결과는 이력만, 대기는 라이브+이력');
ok('toun28형(이동 중): 이력 7079(성공 7079) + 라이브 대기 92 → total 7171 (이중 카운트 0)', () => {
  const r = mergeCampaignCounts({ t: 7079, s: 7079, f: 0, p: 0 }, 92);
  assert.deepStrictEqual(r, { total: 7171, success: 7079, fail: 0, pending: 92 });
});
ok('이동 완료 후: 이력 7171(성공 7165/실패 6) + 라이브 0 → 정확 수렴', () => {
  const r = mergeCampaignCounts({ t: 7171, s: 7165, f: 6, p: 0 }, 0);
  assert.deepStrictEqual(r, { total: 7171, success: 7165, fail: 6, pending: 0 });
});
ok('발송 직전(전부 라이브 대기): 이력 없음 + 라이브 대기 500 → total 500/대기 500', () => {
  const r = mergeCampaignCounts(undefined, 500);
  assert.deepStrictEqual(r, { total: 500, success: 0, fail: 0, pending: 500 });
});
ok('이동 중 행(라이브 비대기)은 어디에도 이중 포함되지 않음 — 라이브 대기 0이면 이력 값 그대로', () => {
  const r = mergeCampaignCounts({ t: 100, s: 90, f: 10, p: 0 }, 0);
  assert.deepStrictEqual(r, { total: 100, success: 90, fail: 10, pending: 0 });
});
ok('음수/누락 방어', () => {
  const r = mergeCampaignCounts({ t: -1, s: undefined as any, f: 3 }, -5);
  assert.deepStrictEqual(r, { total: 0, success: 0, fail: 3, pending: 0 });
});

console.log(`\n[sms-table-split] ${passed}/8 passed`);
