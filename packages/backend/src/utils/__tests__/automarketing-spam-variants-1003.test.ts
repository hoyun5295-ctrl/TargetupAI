/**
 * 자동마케팅 스팸 검사 (★2026-10-03 임은지 접수 `cmuqcxfib0b5bjnn409ij7ncl`)
 *
 * 1) AI 재생성이 늘 0회: 재생성 콜백이 generateMessages 에 total_count 없는 객체를 넘겨 services/ai.ts 의
 *    targetInfo.total_count.toLocaleString() 이 던지고 catch 가 null 로 삼켰다(정책 2회가 한 번도 안 돌았다).
 * 2) 1안만 검사하고 화면·발송은 다른 안(무작위 추천)을 썼다 → 1안이 막히면 2안·3안을 차례로 검사하고
 *    통과한 안을 발송 문안으로 고정한다(검사한 문안 = 나가는 문안). 모두 막히면 그때 재생성.
 * 3) 고객 화면에 영문 내부 용어(Bandit · blocked)가 보였다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { sequenceSpamVariants } from '../spam-test-queue';
import { decideSpamOutcome } from '../continuous-operator-policy';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');

type R = 'pass' | 'blocked' | 'failed' | 'timeout';
const V = [
  { variantId: 'A', messageText: 'a' },
  { variantId: 'B', messageText: 'b' },
  { variantId: 'C', messageText: 'c' },
];
function fakeRun(results: Record<string, R>) {
  const tested: string[] = [];
  return {
    tested,
    runTest: async (_v: { variantId: string }, message: string) => {
      tested.push(message);
      return { spamResult: results[message] || 'pass', carrierResults: [] };
    },
  };
}

describe('sequenceSpamVariants — 첫 통과에서 멈춤', () => {
  it('1안이 통과하면 2·3안은 검사하지 않는다', async () => {
    const f = fakeRun({ a: 'pass' });
    const r = await sequenceSpamVariants({ variants: V, maxRetries: 2, runTest: f.runTest });
    expect(f.tested).toEqual(['a']);
    expect(r.passedVariantId).toBe('A');
    expect(r.variants.map((x) => x.spamResult)).toEqual(['pass']);
  });

  it('1안이 막히면 2안을 검사하고 통과한 2안으로 정한다(재생성 없음)', async () => {
    const f = fakeRun({ a: 'blocked', b: 'pass' });
    let regen = 0;
    const r = await sequenceSpamVariants({ variants: V, maxRetries: 2, runTest: f.runTest, regenerate: async () => { regen++; return { messageText: 'x' }; } });
    expect(f.tested).toEqual(['a', 'b']);
    expect(regen).toBe(0);
    expect(r.passedVariantId).toBe('B');
  });

  it('세 안이 모두 막히면 1안을 재생성해 다시 검사한다(정책 2회)', async () => {
    const f = fakeRun({ a: 'blocked', b: 'blocked', c: 'blocked', r1: 'blocked', r2: 'pass' });
    const msgs = ['r1', 'r2'];
    const r = await sequenceSpamVariants({ variants: V, maxRetries: 2, runTest: f.runTest, regenerate: async () => ({ messageText: msgs.shift()! }) });
    expect(f.tested).toEqual(['a', 'b', 'c', 'r1', 'r2']);
    expect(r.passedVariantId).toBe('A');
    const a = r.variants.find((x) => x.variantId === 'A')!;
    expect(a.messageText).toBe('r2');
    expect(a.regenerateCount).toBe(2);
    expect(a.regenerated).toBe(true);
  });

  it('막힌 것이 아니면(결과 없음·실패) 재생성하지 않는다 · 통과 없음', async () => {
    const f = fakeRun({ a: 'timeout', b: 'failed', c: 'timeout' });
    let regen = 0;
    const r = await sequenceSpamVariants({ variants: V, maxRetries: 2, runTest: f.runTest, regenerate: async () => { regen++; return { messageText: 'x' }; } });
    expect(regen).toBe(0);
    expect(r.passedVariantId).toBeNull();
  });

  it('시간 예산을 넘기면 새 검사를 시작하지 않는다(지금 실행 응답 상한)', async () => {
    let t = 0;
    const f = fakeRun({ a: 'blocked', b: 'blocked', c: 'blocked' });
    const runTest = async (v: { variantId: string }, m: string) => { t += 70_000; return f.runTest(v, m); };
    const r = await sequenceSpamVariants({ variants: V, maxRetries: 2, runTest, regenerate: async () => ({ messageText: 'x' }), budgetMs: 180_000, now: () => t });
    expect(f.tested).toEqual(['a', 'b', 'c']);
    expect(r.passedVariantId).toBeNull();
  });
});

describe('정책 사유는 한국어(영문 판정값을 화면에 싣지 않는다)', () => {
  it('blocked · timeout · failed', () => {
    expect(decideSpamOutcome('blocked', 2).reason).toContain('차단');
    expect(decideSpamOutcome('timeout', 0).reason).toContain('결과를 받지 못함');
    expect(decideSpamOutcome('failed', 0).reason).toContain('검사 실패');
    for (const k of ['blocked', 'timeout', 'failed'] as const) expect(decideSpamOutcome(k, 0).reason).not.toMatch(/blocked|timeout|failed/);
    expect(decideSpamOutcome('blocked', 2).reason).toMatch(/담당자|검토/);
  });
});

describe('배선', () => {
  it('재생성 콜백이 대상 정보 형식(total_count)을 지킨다 · 받는 쪽도 방어한다', () => {
    expect(back('services/ai.ts')).toContain('(Number(targetInfo?.total_count) || 0).toLocaleString()');
    const op = back('utils/continuous-operator.ts');
    expect(op).not.toContain('{ count: recipientCount, segmentName');
    expect(op).toContain('total_count: recipientCount');
    // ★ 2026-10-04 플래너 재생성 콜백은 문안 CT(planner-copy · 사람이 보기 전에만)로 옮겼다 — 실행부는 재생성하지 않는다.
    const pl = back('utils/planner-copy.ts');
    expect(pl).not.toContain('{ count: 0, segmentName: tp.title');
    expect(pl).toContain('total_count: 0');
    expect(back('utils/planner-executor.ts')).not.toContain('regenerateCallback');
  });

  it('자동마케팅은 3안을 차례로 검사하고 통과 안 번호를 제안에 남긴다', () => {
    const op = back('utils/continuous-operator.ts');
    expect(op).toContain('stopOnFirstPass: true');
    expect(op).toContain('messages.slice(0, 3).map(');
    expect(op).toContain("'{spamCheck}', $2::jsonb, true)");
    expect(op).toContain('passedIndex');
  });

  it('발송은 사용자가 고르지 않았으면 검사 통과 안을 보낸다(검사한 문안 = 나가는 문안)', () => {
    const op = back('utils/continuous-operator.ts');
    const fn = op.slice(op.indexOf('async function dispatchProposalSend('));
    expect(fn).toContain('spamCheckPassedIndex(pj)');
    expect(fn.indexOf('spamCheckPassedIndex(pj)')).toBeLessThan(fn.indexOf('const userSel ='));
  });

  it('기본 동작(다른 호출처 5곳)은 그대로다 — 옵션이 없으면 순서 함수를 타지 않는다', () => {
    const q = back('utils/spam-test-queue.ts');
    const fn = q.slice(q.indexOf('export async function autoSpamTestWithRegenerate('));
    expect(fn).toContain('if (params.stopOnFirstPass)');
  });
});

describe('화면', () => {
  const card = front('components/automarketing/ProposalDecisionCard.tsx');
  it('영문 내부 용어를 보이지 않는다', () => {
    // 주석과 타입 이름(BanditRecommendation)은 화면에 나가지 않는다 — 그 밖의 줄에 Bandit 이 없어야 한다
    const visible = card.split('\n').filter((l) =>!l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.includes('BanditRecommendation'));
    expect(visible.filter((l) => l.includes('Bandit'))).toEqual([]);
  });
  it('안마다 스팸 검사 결과를 보이고 기본 미리보기는 통과 안이다', () => {
    expect(card).toContain('스팸 검사 통과');
    expect(card).toContain('spamCheck');
    expect(card).toContain('passedIndex');
  });
});

/**
 * ★ Codex 1R(high 2 · medium 1) — 검사 결과 저장이 검사 중 사람의 승인·선택을 덮거나 저장 실패를 삼키면 안 된다.
 * 뿌리 = 메모리의 옛 제안 JSON 전체로 DB 를 덮어쓰기 + 실패를 catch 로 삼킴. 처방 = DB 의 지금 값에 검사 칸만 붙이고
 * 상태 결정은 사람이 아직 손대지 않은 제안(pending·scheduled · reviewed_at 없음)에만 · 저장 실패는 바깥 catch(담당자 검토)로.
 */
describe('Codex 1R — 검사 결과 저장', () => {
  const op = back('utils/continuous-operator.ts');
  const step9 = op.slice(op.indexOf('// 제안에 안별 결과와 통과 안 번호를 남긴다'), op.indexOf('// (검증 7일 게이팅 제거'));

  it('DB 의 지금 값에 검사 칸만 붙인다(제안 JSON 전체를 덮지 않는다)', () => {
    expect(step9).toContain("'{spamCheck}', $2::jsonb, true)");
    expect(step9).not.toContain('JSON.stringify(pj)');
    expect(step9).not.toContain('스팸 검사 결과 반영 skip');
  });

  it('재생성 문안은 사람이 손대지 않은(선택 없음) 제안에만 바꿔 넣는다', () => {
    expect(step9).toContain("NOT (proposal_json ? 'userSelection')");
    expect(step9).toContain("status IN ('pending', 'scheduled') AND reviewed_at IS NULL");
  });

  it('담당자 검토로 내리는 것·정지·통지는 사람이 손대지 않은 제안일 때만 · 바깥 오류 처리도 같다', () => {
    const downs = op.match(/SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL[^`]*WHERE id = \$1::uuid AND status IN \('pending', 'scheduled'\) AND reviewed_at IS NULL/g) || [];
    expect(downs.length).toBe(2);
    expect(step9).toContain('if (downgraded.rows.length > 0) {');
  });

  it('준비 알림은 아직 자동 발송 예정(scheduled · 사람 손 안 탐)일 때만', () => {
    expect(step9).toContain("autoExecuteEligible && untouched && liveStatus === 'scheduled'");
  });
});

describe('Codex 1R — 재생성 뒤 예산 재확인', () => {
  it('재생성 응답이 예산을 넘겨 오면 새 검사를 시작하지 않고 문안도 바꾸지 않는다', async () => {
    let t = 0;
    const tested: string[] = [];
    const r = await sequenceSpamVariants({
      variants: [{ variantId: 'A', messageText: 'a' }],
      maxRetries: 2,
      budgetMs: 180_000,
      now: () => t,
      runTest: async (_v, m) => { tested.push(m); t += 150_000; return { spamResult: 'blocked', carrierResults: [] }; },
      regenerate: async () => { t += 40_000; return { messageText: 'late' }; },
    });
    expect(tested).toEqual(['a']);
    expect(r.variants[0].messageText).toBe('a');
    expect(r.variants[0].regenerateCount).toBe(0);
    expect(r.passedVariantId).toBeNull();
  });
});

/**
 * ★ Codex 2R high — 검사 결과 저장과 담당자 검토 전환이 둘 다 실패하면(DB 장애) 'scheduled' 가 남아 DB 복구 뒤 미검증 문안이 나갈 수 있었다.
 * 뿌리 = 제안이 검사 전에 'scheduled' 로 들어가고 자동 발송 관문이 저장된 검사 결과를 보지 않는다.
 * 처방 = 효과가 만들어지는 자리(자동 발송 선점)에서 「스팸 검사 통과 저장」을 요구한다(보상 쓰기에 기대지 않는다).
 */
describe('Codex 2R — 자동 발송 관문은 저장된 검사 통과를 요구한다', () => {
  it('통과 판정 = 검사 통과 저장 · 사람의 승인 · 리마인드(자기 검증 뒤 승격)', async () => {
    const { AUTO_SEND_SPAM_VERIFIED_SQL } = await import('../continuous-operator-policy');
    expect(AUTO_SEND_SPAM_VERIFIED_SQL).toBe(
      "(COALESCE(spam_test_status, '') = 'pass' OR reviewed_at IS NOT NULL OR COALESCE(proposal_json->'meta'->>'is_reminder', 'false') = 'true')",
    );
  });

  it('★ Codex 3R — 검사 칸이 비어 있어도(NULL) 식이 참·거짓으로 갈린다(NULL 이면 전환도 선점도 안 되고 영원히 남는다)', async () => {
    const { AUTO_SEND_SPAM_VERIFIED_SQL } = await import('../continuous-operator-policy');
    // 세 조각 모두 NULL 을 거짓으로 바꾸는 꼴이어야 한다: COALESCE(..)= · IS NOT NULL · COALESCE(..)=
    expect(AUTO_SEND_SPAM_VERIFIED_SQL).not.toMatch(/\(spam_test_status = /);
    expect(AUTO_SEND_SPAM_VERIFIED_SQL).toContain("COALESCE(spam_test_status, '') = 'pass'");
    expect(AUTO_SEND_SPAM_VERIFIED_SQL).toContain('reviewed_at IS NOT NULL');
  });

  it('선점 전에 통과 기록이 없으면 담당자 검토로 내리고 · 선점 문장도 같은 조건을 건다', () => {
    const op = back('utils/continuous-operator.ts');
    const fn = op.slice(op.indexOf('async function sendScheduledProposal('), op.indexOf('// ★ Phase2 D — 자율 발송 직전 예산 재검증'));
    const down = fn.indexOf('AND NOT ${AUTO_SEND_SPAM_VERIFIED_SQL}');
    const claim = fn.indexOf("WHERE id = $1::uuid AND status = 'scheduled' AND ${AUTO_SEND_SPAM_VERIFIED_SQL} RETURNING *");
    expect(down).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(down);
  });
});
