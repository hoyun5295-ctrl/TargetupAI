/**
 * 스팸 판정 4값 + 기다림 · 같은 검사 이어 보기(★ 2026-11-01 여정 재발 방지 B1-4 · B-1101-3)
 *   설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §2 B1-4.
 *   1101 Harold 「스팸 테스트 하는 건가?」 · 10-30 실측: 실제로 받은 LG U+ 문자 3건이 「차단」(통신사 전달 성공 + 앱 보고 늦음 = 차단으로 적었다).
 * 못 박는 것(순수 · 배선): 확인 중 · 기다림은 통과도 차단도 장애도 아니다 · 통과 = 통신사 결과 전부 pass · 묶음 판정 순서 ·
 *   차례 검사가 기다림에서 멈춤(재생성 0) · 상시 운영 기다림 = 정지 없음 · 화면이 읽기를 멈추는 때.
 */
import { describe, it, expect, vi } from 'vitest';
import { spamVerdictOf, spamTestOutcomeOf, sequenceSpamVariants, isSpamHold, SPAM_VERDICT_WORD, mergeAlternativeVerdicts } from '../spam-test-queue';
import { plannerFakeDmLink } from '../planner-copy';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mergeSpamVerdicts, batchVerdictOf } from '../journey-pretest-validator';
import { judgeSpamVerdict } from '../spam-trial';
import { decideSpamOutcome } from '../continuous-operator-policy';
import { deliveredUnreportedResult, SPAM_RESULT, getSpamResultLabel } from '../sms-result-map';
import { spamTestFinalBy } from '../spam-probe';

const v = (spamResult: string, results: Array<string | null>) => ({ spamResult, carrierResults: results.map((result) => ({ result })) });

describe('판정 값', () => {
  it('통신사 전달 성공 + 앱 보고 없음 = 확인 중(차단 아님) · 이름표', () => {
    expect(deliveredUnreportedResult()).toBe('unconfirmed');
    expect(getSpamResultLabel(SPAM_RESULT.UNCONFIRMED)).toBe('확인 중');
    expect(Object.keys(SPAM_VERDICT_WORD).sort()).toEqual(['blocked', 'error', 'pass', 'pending', 'rejected', 'unconfirmed']);   // ★ 1106 C109 여섯째 = 보낼 수 없는 글자
  });
  it('spamVerdictOf — 통과 = 결과 전부 pass · 확인 중 행 = 확인 중 · 기다림 · 새 값(error) · 빈 값 = 장애', () => {
    expect(spamVerdictOf(v('pass', ['pass', 'pass']), 1)).toBe('pass');
    expect(spamVerdictOf(v('pass', ['pass', 'unconfirmed']), 1)).toBe('unconfirmed');
    expect(spamVerdictOf(v('unconfirmed', ['pass', 'unconfirmed']), 1)).toBe('unconfirmed');
    expect(spamVerdictOf(v('pending', []), 1)).toBe('pending');
    expect(spamVerdictOf(v('pass', ['pass', 'error']), 1)).toBe('error');
    expect(spamVerdictOf(v('pass', ['pass', null]), 1)).toBe('error');
    expect(spamVerdictOf(v('blocked', ['pass', 'blocked']), 1)).toBe('blocked');
    expect(spamVerdictOf(v('pass', []), 0)).toBe('pass');   // 시연 회사(검사 0건)
    expect(isSpamHold('pending') && isSpamHold('unconfirmed') && !isSpamHold('error') && !isSpamHold('blocked')).toBe(true);
  });
  it('spamTestOutcomeOf — 차단 > 진행 중 > 결과 0행 = 장애 > 확인 중 > 전부 통과 · 그 밖 장애', () => {
    expect(spamTestOutcomeOf('active', [{ result: 'blocked' }])).toBe('blocked');
    expect(spamTestOutcomeOf('active', [{ result: null }])).toBe('pending');
    expect(spamTestOutcomeOf('queued', [])).toBe('pending');
    expect(spamTestOutcomeOf('completed', [])).toBe('error');
    expect(spamTestOutcomeOf('completed', [{ result: 'pass' }, { result: 'unconfirmed' }])).toBe('unconfirmed');
    expect(spamTestOutcomeOf('completed', [{ result: 'pass' }, { result: 'pass' }])).toBe('pass');
    expect(spamTestOutcomeOf('completed', [{ result: 'pass' }, { result: 'timeout' }])).toBe('error');
    expect(spamTestOutcomeOf('completed', [{ result: 'pass' }, { result: 'error' }])).toBe('error');
  });
  it('판 여럿 = 전부 통과일 때만 통과 · 차단 > 장애 > 확인 중 > 검사 중(켜기 검증 · 보내기 전 검사 공용)', () => {
    expect(mergeSpamVerdicts(['pass', 'pass'])).toBe('pass');
    expect(mergeSpamVerdicts(['pass', 'pending'])).toBe('pending');
    expect(mergeSpamVerdicts(['pending', 'unconfirmed'])).toBe('unconfirmed');
    expect(mergeSpamVerdicts(['unconfirmed', 'error'])).toBe('error');
    expect(mergeSpamVerdicts(['error', 'blocked', 'pass'])).toBe('blocked');
    expect(mergeSpamVerdicts([])).toBe('error');
    expect(batchVerdictOf([{ overallResult: 'pass', carrierResults: [{ result: 'pass' }] }, { overallResult: 'unconfirmed', carrierResults: [{ result: 'unconfirmed' }] }])).toBe('unconfirmed');
  });
  it('화면 판정 — 끝났는데 확인 중 행 = checking(결과 없음 warn 이 아니다) · 진행 중은 running', () => {
    const row = (result: string | null, received = false) => ({ carrier: 'LGU', received, result });
    expect(judgeSpamVerdict('completed', [row('pass', true), row('unconfirmed')])).toBe('checking');
    expect(judgeSpamVerdict('active', [row('unconfirmed')])).toBe('running');
    expect(judgeSpamVerdict('completed', [row('pass', true), row('error')])).toBe('warn');
    expect(judgeSpamVerdict('completed', [row('blocked'), row('unconfirmed')])).toBe('blocked');
  });
});

describe('자동 행동 0', () => {
  it('차례 검사 = 확인 중 · 검사 중이면 거기서 멈춘다(다음 안 검사 0 · 재생성 0)', async () => {
    for (const hold of ['unconfirmed', 'pending'] as const) {
      const runTest = vi.fn(async () => ({ spamResult: hold, carrierResults: [] }));
      const regenerate = vi.fn(async () => ({ messageText: '다시 쓴 글' }));
      const out = await sequenceSpamVariants({
        variants: [{ variantId: 'A', messageText: '1안' }, { variantId: 'B', messageText: '2안' }], maxRetries: 2, runTest, regenerate,
      });
      expect(runTest).toHaveBeenCalledTimes(1);
      expect(regenerate).not.toHaveBeenCalled();
      expect(out.passedVariantId).toBeNull();
      expect(out.variants[0].spamResult).toBe(hold);
    }
  });
  it('상시 운영 = 확인 중 · 검사 중이면 자동 발송만 보류(hold) · 사유는 한국어', () => {
    for (const k of ['unconfirmed', 'pending'] as const) {
      const o = decideSpamOutcome(k, 0);
      expect(o.hold).toBe(true);
      expect(o.autoExecuteBlocked).toBe(true);
      expect(o.reason).not.toMatch(/[a-z]{4,}/);
    }
    expect(decideSpamOutcome('blocked', 2).hold).toBeUndefined();
  });
});

describe('화면이 읽기를 멈추는 때', () => {
  it('확인 중 행이 있는 닫힌 검사만 = 닫힌 때 + 10 + 5 + 2 + 2분 · 없으면 null', () => {
    const at = '2026-11-01T03:00:00.000Z';
    expect(spamTestFinalBy(at, [{ result: 'pass' }, { result: 'unconfirmed' }])).toBe('2026-11-01T03:19:00.000Z');
    expect(spamTestFinalBy(at, [{ result: 'pass' }])).toBeNull();
    expect(spamTestFinalBy(null, [{ result: 'unconfirmed' }])).toBeNull();
  });
});

// ★ 2026-11-01 Codex 구현 1R(A #3 · #4 · #6 · #7) — 보류가 실패 · 정지 · 다시 쓰기로 새지 않는다
describe('보류 = 실패 · 정지 · 다시 쓰기 0(구현 2라운드)', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
  it('같은 키 재조회 = 잠금을 쥔 그 연결로(풀에서 연결을 더 기다리지 않는다)', () => {
    const q = src('spam-test-queue.ts');
    expect(q).toContain('const late = await reusable((sql, params) => client.query(sql, params));');
    expect(q).toMatch(/export async function spamCheckFor\(k: SpamCheckKey, run: SqlRun = query, windowDays\?: number\)/);
    expect(q).toContain('const { outcome } = await readSpamTestOutcome(String(t.id), run);');
  });
  it('대안 합산 = 통과 > 확인 중 > 검사 중 > 차단 > 장애(차례 검사와 같은 뜻 · 뒤 안이 확인 중이면 앞 안 차단으로 정지하지 않는다)', () => {
    expect(mergeAlternativeVerdicts(['blocked', 'unconfirmed'])).toBe('unconfirmed');
    expect(mergeAlternativeVerdicts(['error', 'pending'])).toBe('pending');
    expect(mergeAlternativeVerdicts(['blocked', 'pass'])).toBe('pass');
    expect(mergeAlternativeVerdicts(['blocked', 'error'])).toBe('blocked');
    expect(mergeAlternativeVerdicts([])).toBe('error');
    expect(src('continuous-operator.ts')).toMatch(/const altVerdict = mergeAlternativeVerdicts\(tested\.map\(/);
    expect(src('continuous-operator.ts')).toMatch(/: isSpamHold\(altVerdict\) \|\| altVerdict === 'blocked' \|\| altVerdict === 'rejected' \? altVerdict/);   // ★ 1106 C109 보낼 수 없는 글자도 그 판정 그대로
  });
  it('플래너 사전 준비 = 가짜 링크가 접점마다 고정(같은 글 = 같은 검사) · 확인 중은 실패 수에 안 셈 · 만든 글을 검사 대기로 남김', () => {
    expect(plannerFakeDmLink('tp-1')).toBe(plannerFakeDmLink('tp-1'));
    expect(plannerFakeDmLink('tp-1')).not.toBe(plannerFakeDmLink('tp-2'));
    const c = src('planner-copy.ts');
    expect((c.match(/plannerFakeDmLink\(carrier\.id\)/g) || []).length).toBe(2);
    expect(c).not.toMatch(/plannerFakeDmLink\(\)/);
    const hold1 = c.slice(c.indexOf('        if (isSpamHold(check.verdict)) {'));
    expect(hold1.slice(0, hold1.indexOf('continue;'))).not.toContain('generationFailed');
    expect(c).toMatch(/text: stripDmLink\(check\.body, link\), subject: check\.subject \|\| '', inputHash, spam: 'pending', checkedAt: null, withDmLink, held: true,/);
    expect(c).toContain("if ((cur?.edited || cur?.held) && cur.inputHash === inputHash) {");
    expect(c).toMatch(/const saved = await setTouchpointMetaIfCopyIs\(companyId, carrier\.id, before, \{ copy: held,[\s\S]{0,160}\.catch\(\(\) => null\);\s*if \(saved === null\) generationFailed = true;/);
  });
  it('대행발송 = 검사 중인 다듬은 글을 결과 칸에 남기고 다음 주기에 그 글부터(같은 문안 버전일 때만)', () => {
    const w = src('agency-send-worker.ts');
    expect(w).toMatch(/const held = row\.last_test_result\?\.heldCandidate;\s*if \(held && Number\(held\.version\) === Number\(row\.content_version \|\| 0\)/);
    expect(w).toContain("if (isSpamHold(verdict)) return { verdict, passed: false, finalContent: original, rounds, detail, heldContent: content !== original ? content : null };");
    // ★ Codex 구현 2R #2 — 후보 · 회차 저장 = 상태 되돌림과 한 문장 · 던지면 검사 장애(횟수 상한) 갈래
    expect(w).toMatch(/await setStatus\(row\.id, backTo, \{ \.\.\.RELEASE, last_test_result: heldResultJson\(row, heldContent, rounds\) \}, token\)\s*\.catch\(async \(e: any\) => \{[\s\S]{0,200}await settleSpamCheckError\(row, token, backTo, phase, detail\)/);
  });
  it('여정 후보 = 「이미 있음」은 다시 읽어 상태대로(만드는 중 = 기다림 · 검사 중 = 이어 봄) · 통과 반영은 한 트랜잭션', () => {
    const n = src('journey-pretest-notifier.ts');
    const taken = n.slice(n.indexOf("if (claim === 'taken') {"));
    expect(taken).toMatch(/const again = await readCandidate\(snapId!\);\s*if \(!again \|\| \(again\.status === 'generating' && !again\.stale\)\) return;/);
    // ★ 2026-11-02 설계서 3-9 — 통과 반영 = 사람이 누를 때(applyPassedCandidate) · 검사 통과 = 후보 passed 만
    expect(n).toContain("if (await moveCandidate(snapId, ['testing'], 'passed')) summary.passed++;");
    expect(n).not.toMatch(/newBody|candidatePassed|markCandidatePassedInTx/);
    // 정산 직전 확인 = 재작성 함수 run 끝(AI 결과 바로 뒤 · 정산 바로 앞) · 아직 내 후보가 아니면 null = 0원(ai-credit 계약은 그대로)
    const g = src('journey-ai-generator.ts');
    expect(g).toMatch(/return r !== null && charge && !\(await charge\.stillMine\(\)\) \? null : r;\s*\},\s*accept: \(r\) => r !== null,/);
    expect(src('ai-credit.ts')).toContain('  accept: (result: T) => boolean;');
    // ★ Codex 구현 3R — 소유권을 잃은 null 은 생성 실패가 아니다(조용히 끝) · 후보 갈래의 정지 = 판 확인과 한 트랜잭션
    expect(n).toMatch(/if \(!\(await candidateStillMine\(snapId!, claim\.token\)\.catch\(\(\) => false\)\)\) \{[\s\S]{0,200}return;\s*\}/);
    // ★ 1102 E3-3 — 후보 갈래 = 그 판 보류(holdCurrent · 판 확인 · 직전 결정 · 보류 기록 한 트랜잭션 · 여정 멈춤 0)
    expect(n).toMatch(/async function holdCurrent\([\s\S]{0,400}FOR UPDATE[\s\S]{0,200}if \(\(await latestSnapshotIdTx\(run, b\)\) !== snapId\) return null;/);
    const tc = n.slice(n.indexOf('async function testCandidate('), n.indexOf('async function holdCurrent('));
    expect(tc).not.toContain('pauseJourney(');
  });
});
