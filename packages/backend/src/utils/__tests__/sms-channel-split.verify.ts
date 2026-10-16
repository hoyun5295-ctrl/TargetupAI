/**
 * sms-channel-split.verify.ts — 알림톡/대체발송 판정·집계 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts
 * (DB import 0 — msg_type/k_oriseq/status_code 대체 판정 + 알림톡 시도·대체 집계 순수 함수.)
 * 2026-06-07: 대체발송 SMS/LMS 세분화 — 정산 단가 구분.
 * ★ 2026-10-16 B-1016-1: 옛 classifyMsgChannel·tallySmsChannelCounts 삭제 → fallbackOf·tallyAlimtalkFallback(통계 엑셀·목록 공용).
 *   고정본(6/7 옛 모양 행)은 그대로 두고 기대값을 새 집계로 옮겼다.
 */
import assert from 'node:assert';
import { fallbackOf, tallyAlimtalkFallback } from '../sms-result-map';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[sms-channel-split] fallbackOf');
ok('K → 대체 아님', () => assert.strictEqual(fallbackOf('K', null), null));
ok('L + k_oriseq>0 → L (LMS 대체)', () => assert.strictEqual(fallbackOf('L', 361669), 'L'));
ok('L + k_oriseq 문자열 → L', () => assert.strictEqual(fallbackOf('L', '361669'), 'L'));
ok('L + k_oriseq NULL → 대체 아님', () => assert.strictEqual(fallbackOf('L', null), null));
ok('L + k_oriseq 0 → 대체 아님', () => assert.strictEqual(fallbackOf('L', 0), null));
ok('S + k_oriseq>0 → S (SMS 대체)', () => assert.strictEqual(fallbackOf('S', 361669), 'S'));
ok('S + k_oriseq NULL → 대체 아님', () => assert.strictEqual(fallbackOf('S', null), null));
ok('M → 대체 아님', () => assert.strictEqual(fallbackOf('M', 361669), null));
ok('K + 7831 → L (비토 라인 K행 대체)', () => assert.strictEqual(fallbackOf('K', null, 7831), 'L'));

console.log('[sms-channel-split] tallyAlimtalkFallback');
ok('K 6(성공4·실패2) + LMS대체 2(성공2)', () => {
  const r = tallyAlimtalkFallback([
    { msg_type: 'K', k_oriseq: null, status_code: 1800, cnt: 4 },
    { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 2 },
    { msg_type: 'L', k_oriseq: 361669, status_code: 1000, cnt: 1 },
    { msg_type: 'L', k_oriseq: 361670, status_code: 1000, cnt: 1 },
  ]);
  assert.deepStrictEqual({ total: r.total, success: r.success, fail: r.fail, pending: r.pending }, { total: 6, success: 4, fail: 2, pending: 0 });
  assert.deepStrictEqual(r.fallback.LMS, { total: 2, success: 2, fail: 0, pending: 0 });
  assert.strictEqual(r.fallback.SMS.total, 0);
});
ok('일반 LMS(k_oriseq 없음)는 세지 않는다(알림톡 캠페인 행만 넘어온다)', () => {
  const r = tallyAlimtalkFallback([{ msg_type: 'L', k_oriseq: null, status_code: 1000, cnt: 3 }]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.fallback.LMS.total, 0);
});

console.log(`\n[sms-channel-split] ${passed} passed`);
