/**
 * continuous-operator 스팸 안전망 순수 정책 테스트 — ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/continuous-operator-spam.manual-test.ts
 *
 * D227+ 스팸 안전장치 격상 — 실제 테스트 → AI 재생성 → 재테스트 → 끝내 실패 시 담당자 검토.
 * 이 파일은 순수 정책(상태 결정 + 재생성 프롬프트)만 검증. 실제 발송/AI 호출은 통합 영역.
 */
import { decideSpamOutcome, buildSpamRegeneratePrompt } from '../continuous-operator-policy';

let pass = 0;
let fail = 0;
function check(n: string, f: () => void) {
  try { f(); pass++; console.log('  PASS:', n); }
  catch (e: any) { fail++; console.log('  FAIL:', n, '—', e?.message); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ═══════════════════════════════════════════════════════
// decideSpamOutcome — 스팸 최종 결과 → 제안 상태 결정
// ═══════════════════════════════════════════════════════

check('스팸 통과 → spam_passed, 발송 차단 X', () => {
  const r = decideSpamOutcome('pass', 0);
  assert(r.status === 'spam_passed', `status=${r.status}`);
  assert(r.autoExecuteBlocked === false, '발송 차단 X');
});

check('재생성 후 통과 → spam_passed (재생성 횟수 reason 반영)', () => {
  const r = decideSpamOutcome('pass', 2);
  assert(r.status === 'spam_passed', `status=${r.status}`);
  assert(r.reason.includes('2'), `재생성 횟수 reason (실제 "${r.reason}")`);
});

check('최종 차단(blocked) → admin_review, 발송 차단', () => {
  const r = decideSpamOutcome('blocked', 2);
  assert(r.status === 'admin_review', `status=${r.status}`);
  assert(r.autoExecuteBlocked === true, '발송 차단');
  assert(/담당자|검토/.test(r.reason), `담당자 검토 reason (실제 "${r.reason}")`);
});

check('failed/timeout도 → admin_review (안전 우선)', () => {
  assert(decideSpamOutcome('failed', 1).status === 'admin_review', 'failed → admin_review');
  assert(decideSpamOutcome('timeout', 0).status === 'admin_review', 'timeout → admin_review');
});

// ═══════════════════════════════════════════════════════
// buildSpamRegeneratePrompt — AI 재작성 프롬프트
// ═══════════════════════════════════════════════════════

check('재생성 프롬프트 = objective + 스팸 안내 + 혜택 생성 금지', () => {
  const p = buildSpamRegeneratePrompt('VIP 재구매 유도');
  assert(p.includes('VIP 재구매 유도'), 'objective 포함');
  assert(/스팸/.test(p), '스팸 차단 안내 포함');
  assert(/혜택|할인|쿠폰/.test(p), '구체 혜택 생성 금지 명시 (feedback_ai_no_arbitrary_benefit)');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
