/**
 * 여정 발송 표식은 적재 전에 · 두 단계로 (★ 2026-09-26 한줄로 V2 m105 · CRASH 묶음 · Codex 1R ④ · 2R ③④⑤)
 *
 * 옛 순서: 차감 → 큐 적재(커밋) → step_log 'sent'. 적재 커밋과 기록 사이에 멈추면 멱등 가드(step_log 'sent')가 비어
 * 재실행이 같은 고객에게 다시 보내고 다시 차감했다.
 * 새 순서: 차감 → step_log 'sending'(적재 중 표식) → 큐 적재 → 'sent' 확정(+발송 수 한 문장 · 실패는 던진다).
 * 적재 오류에도 표식을 지우지 않는다(2R ③ — 응답만 유실되고 행은 들어갔을 수 있다). 판정은 CT(journey-send-claim) 하나가 한다.
 * 'sending'은 발송 수·월 예산(status='sent'만)에 들어가지 않는다.
 *
 * ★ 2026-11-02 묶음 발송(설계서 docs/2026-11-02-journey-batch-send-design.md 3-3 ⑤ · 3-8 적재 증명 계약 · Codex 설계 7R approve)
 *   단위(INSERT 한 문장)마다: 표식('sending' · 여정 · 실행 active 만) → 차감 n → 연결 번호 기록 → 같은 연결로 적재 → 결과 셋.
 *   들어감 = 크레딧(멱등) → 확정 한 문장 · 안 들어감(문장 보내기 전 실패) = 표식 지움 · 결과 불명 = 표식 보존(다음 회차 단위 판정).
 *   CT 자체의 동작은 journey-batch-send-1102 · 실 PG 시험이 소유한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
const units = src.slice(src.indexOf('async function sendUnits('), src.indexOf('async function retryOrPauseAfterLoadFailure('));
const guard = src.slice(src.indexOf('async function processMessageBatch('), src.indexOf('// ── 8 · 9 관문'));

describe('여정 발송 표식 순서', () => {
  const claimAt = units.indexOf("NOW(), 'sending', $4");
  const deductAt = units.indexOf('const deduct = await prepaidDeduct(head.company_id, claimed.length, prepaidMsgType as any, campaignId');
  const loadAt = units.indexOf('await loadQueueUnit({');
  const loadedAt = units.indexOf("if (outcome.state === 'loaded') {");
  const creditAt = units.indexOf('await chargeJourneyOperationCredit(head, claimAt);');   // ★1020 V.3 날짜 = 표식 시각
  const confirmAt = units.indexOf('confirmed = await confirmLoadUnit(campaignId, claimIds,');
  const rejectedAt = units.indexOf("if (outcome.state === 'rejected') {");

  it('적재 중 표식은 차감 앞(차감 수 = 표식 수) · 적재 앞이다', () => {
    expect(claimAt).toBeGreaterThan(0);
    expect(deductAt).toBeGreaterThan(claimAt);
    expect(loadAt).toBeGreaterThan(deductAt);
    // 표식 = 여정 · 실행 둘 다 active 인 행만(차감 직전 상태 재확인 · 설계서 3-3 ② · Codex 설계 1R #3)
    expect(units).toContain("WHERE e.id = ANY($1::uuid[]) AND j.id = e.journey_id AND e.status = 'active' AND j.status = 'active'");   // 시도 기록 CTE 조건 = 표식 행
  });

  it("'sent' INSERT는 없다 — 적재가 끝난 뒤 표식을 'sent'로 확정한다(발송 수와 한 문장)", () => {
    expect(src.split("NOW(), 'sent', $4").length - 1).toBe(0);
    expect(src.split("NOW(), 'sending', $4").length - 1).toBe(1);
    expect(confirmAt).toBeGreaterThan(loadedAt);
    // 실행 · 여정 비용 통계 = 확정과 같은 문장(withStats) · 전진은 비용 0(Codex 구현 1R)
    expect(units).toContain('{ variantCounts: [...counts].map(([variantId, sent]) => ({ variantId, sent })), withStats: true }');
    expect(units).toContain('await advanceExecutions(head, step, done.map((r) => ({ exec: r.exec, addedCost: 0 })));');
    // ★ 2026-09-29 차수 5(Codex 1R high) — 크레딧(멱등)을 확정 **전에** 받는다: 확정 뒤 끊겨도 'sent'면 이미 받은 상태
    expect(creditAt).toBeGreaterThan(loadedAt);
    expect(creditAt).toBeLessThan(confirmAt);
    // 발송 수는 확정 문장이 올린다 — 따로 올리는 호출이 남으면 두 번 오른다
    expect(src).not.toContain('bumpStepCampaignCount(');
  });

  it('확정 실패를 삼켜 진행하지 않는다(⑤) — 연결 파기 · 표식 · 단위 기록 보존 · 전진 0 · 다음 회차 단위 판정이 확정', () => {
    const seg = units.slice(confirmAt, units.indexOf('if (confirmed.length !== claimed.length)'));
    expect(seg).toContain('outcome.finish(false);');
    expect(seg).toContain('return unit[0].idx;');   // 멈춘 자리 = 이 단위 첫 고객(뒤 고객 결말 0)
    expect(seg).not.toContain('DELETE FROM journey_step_logs');
    expect(seg).not.toContain('clearLoadUnit(');
  });

  it('적재 오류(결과 불명)는 표식을 지우지 않는다(③) · 시도 횟수는 지금 남긴다(R8) · 지우는 곳 = 문장을 보내기 전 실패(rejected) · 차감 실패 둘뿐', () => {
    const unknown = units.slice(units.indexOf('// unknown = 표식 보존'));
    expect(unknown).not.toContain('DELETE FROM journey_step_logs');
    expect(unknown).not.toContain('clearLoadUnit(');
    expect(unknown).toContain('await holdUnknownLoad(head, step, claimed.map((r) => r.exec), outcome.reason, res);');
    const hold = src.slice(src.indexOf('async function holdUnknownLoad('), src.indexOf('function alertUnprovableUnit('));
    // ★ Codex 구현 3R · 4R — 근거 = 그 실행 · 그 칸의 시도 기록(load_attempt) = 표식과 같은 문장에서 미리 남긴다(사후 실패 기록 · 표식 삭제 · 멈춤 실패와 무관) · 공용 error_count 를 올리지 않는다
    expect(hold).toContain("reason: 'queue_insert_unknown', step_id: step.id");
    expect(hold).not.toContain('error_count');
    expect(src).toContain('export const LOAD_ATTEMPT_MAX = 2;');
    expect(src).toContain("WHERE fl->>'reason' = 'load_attempt' AND fl->>'step_id' = ${stepParam}::text");
    expect(src).not.toContain('loadFailuresSql');
    // 판정 자리 = 새 표식 앞 한 곳(확인 + 표식 문장 조건) · 가드에는 상한 판정 0(2R 덧댐 지움)
    const spentAt = units.indexOf("AND ${loadAttemptsSql('e', '$2')} >= ${LOAD_ATTEMPT_MAX}");
    expect(spentAt).toBeGreaterThan(0);
    expect(spentAt).toBeLessThan(claimAt);
    // 표식 문장 = 시도 기록 UPDATE(상한 · active) CTE → 그 행만 표식 INSERT(같이 커밋)
    const claimStmt = units.slice(units.indexOf('WITH att AS ('), claimAt + 200);
    expect(claimStmt).toContain("jsonb_build_object('reason', 'load_attempt', 'step_id', $2::text, 'campaign_id', $3::text, 'at', NOW())");
    expect(claimStmt).toContain("AND ${loadAttemptsSql('e', '$2')} < ${LOAD_ATTEMPT_MAX}");
    expect(claimStmt).toContain("SELECT gen_random_uuid(), att.id, $2::uuid, $3::uuid, NOW(), 'sending', $4 FROM att");
    // 다음 칸으로 넘어가면 시도 기록 지움(쌓임 0)
    const adv = src.slice(src.indexOf('async function advanceExecutions('), src.indexOf('async function finishExecutions('));
    expect(adv).toContain("WHERE el.v->>'reason' IS DISTINCT FROM 'load_attempt')");
    // ★ 2026-11-11 C129 D2 — 여정 멈춤이 먼저 성공해야 실패 기록 · 전진을 한다(옛: 실패 기록 · 전진 → 멈춤 = 여정 멈춤이 실패하면 실행 하나만 멈춘 채 남았다)
    expect(units.indexOf('await pauseJourney(', spentAt)).toBeLessThan(units.indexOf("await logStepMany(gave.map((e) => e.execution_id), step.id, 'failed', 'queue_insert_failed');", spentAt));
    expect(units.indexOf('await pauseJourney(', spentAt)).toBeLessThan(units.indexOf('await advanceExecutions(head, step, gave.map((exec) => ({ exec, addedCost: 0 })));', spentAt));
    expect(guard).not.toContain('LOAD_ATTEMPT_MAX');
    expect(hold).toContain("await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');");
    expect(hold).not.toMatch(/advanceExecutions|DELETE FROM journey_step_logs|clearLoadUnit/);
    expect(units.slice(rejectedAt, rejectedAt + 400)).toContain('await clearLoadUnit(campaignId, claimIds);');
    expect(units.split('clearLoadUnit(').length - 1).toBe(1);
    // 차감 실패(적재 전) = 표식 삭제 문장 한 곳(★ C129 D3 — 시도 기록 삭제와 한 문장 CLEAR_UNPAID_CLAIMS_SQL)
    expect(units.split('DELETE FROM journey_step_logs').length - 1).toBe(0);
    expect(units.split('CLEAR_UNPAID_CLAIMS_SQL').length - 1).toBe(2);   // 차감 실패 + ★ C129 D10 차감 꼴이 준비 때와 다름(둘 다 아무것도 싣지 않았다)
    expect(src.split('DELETE FROM journey_step_logs').length - 1).toBe(1);
  });

  it('안 들어감 확정 = 지금 재시도 규칙(첫 실패 = 5분 뒤 · 이미 한 번 실패 = 그 실행 자동 멈춤 + 여정 멈춤 · 전진 비용 0)', () => {
    const r = src.slice(src.indexOf('async function retryOrPauseAfterLoadFailure('), src.indexOf('function alertUnprovableUnit('));
    expect(r).toContain("next_run_at = NOW() + INTERVAL '5 minutes'");
    // ★ 2026-11-11 C129 D2 — 소진 · 재시도 기준 = 그 칸의 적재 시도 기록 수(옛: 실행 전체 error_count < 1)
    expect(r).toContain("AND ${loadAttemptsSql('e', '$3')} < ${LOAD_ATTEMPT_MAX}");
    expect(r).toContain("pauseReason: 'carrier_temp_fail', pauseTriggerSource: 'auto_retry_exhausted'");
    expect(r).toContain("await logStepMany([e.execution_id], step.id, 'failed', 'queue_insert_failed');");
    expect(r).toContain('await advanceExecutions(head, step, [{ exec: e, addedCost: 0 }]);');
  });

  it("가드는 'sending' 표식을 단위 판정 CT로 판정한다(들어감 = 확정 · 전진 · 안 들어감 = 지우고 보냄)", () => {
    expect(guard).toContain("status IN ('sent', 'sending')");
    expect(guard).toContain('const judged = await judgeLoadUnit(owner, campaignId, { beforeConfirm: (at) => chargeJourneyOperationCredit(head, at), withStats: true });');
    expect(guard).toMatch(/result === 'sent'\) \{[\s\S]*await advanceExecutions\(head, step, inBatch\.map\(\(exec\) => \(\{ exec, addedCost: 0 \}\)\)\);/);
    expect(guard).toMatch(/result === 'cleared'\) \{[\s\S]*continue;/);
  });

  it('가드: 닫힌 표식(load_unprovable)도 이미 처리됨으로 본다 — 닫은 뒤 전진이 실패해도 다시 보내지 않는다 (5R ①)', () => {
    expect(guard).toContain("OR (status = 'failed' AND error_reason = 'load_unprovable')");
    expect(guard).toContain("if (l.status === 'sent' || (l.status === 'failed' && l.error_reason === 'load_unprovable')) doneIds.add(String(l.execution_id));");
  });

  it('가드: 증명 안 됨 = 보내지 않고 10분 뒤 다시 본다(그 (여정 · 칸)은 새 단위 0 · I2) · 1시간 넘어 닫히면 경보 후 다음 단계로(다시 보내지 않는다 · 4R)', () => {
    expect(guard).toMatch(/result === 'held'\) \{\s*await delayExecutions\(inBatch\.map\(\(e\) => e\.execution_id\), 10\);[\s\S]*?return res;/);
    expect(guard).toMatch(/result === 'closed'\) \{\s*alertUnprovableUnit\(head\.company_id, campaignId, judged\.claims\.length\);\s*await advanceExecutions\(head, step, inBatch\.map\(\(exec\) => \(\{ exec, addedCost: 0 \}\)\)\);/);
  });

  it('새 단위 앞 = 그 캠페인의 미확정 단위(단위 기록 · sending 표식)를 먼저 판정 · 보류 · 닫힘이면 새 단위 0(I2)', () => {
    const at = units.indexOf("OR EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = $1::uuid AND l.status = 'sending') AS has");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(claimAt);
    expect(units).toMatch(/if \(judged\.result === 'held'\) \{ res\.waited \+= rows\.length; return rows\[0\]\.idx; \}/);
    expect(units).toMatch(/if \(judged\.result === 'closed'\) \{ alertUnprovableUnit\(head\.company_id, campaignId, judged\.claims\.length\); return rows\[0\]\.idx; \}/);
  });

  it('운영 크레딧은 한 함수가 원 발송일 키로 받는다 — 정상 발송 1 · 판정 확정 3(가드 · 새 단위 앞 · 활성 아닌 실행 정리) (3R ⑤)', () => {
    expect(src.split('await deductCreditSafe({').length - 1).toBe(1);
    const fn = src.slice(src.indexOf('async function chargeJourneyOperationCredit('), src.indexOf('async function chargeJourneyOperationCredit(') + 900);
    expect(fn).toContain('await deductCreditSafe({');
    expect(fn).toContain('idempotencyKey: `journey-operation:${operationCreditRoot(exec)}:${kstDateTag(sentAt)}`');
    expect(src.split('await chargeJourneyOperationCredit(').length - 1).toBe(1);
    expect(src.split('beforeConfirm: (at) => chargeJourneyOperationCredit(').length - 1).toBe(3);
  });

  it('원행 계수·확정은 CT만 한다(실행기 안 복제 0)', () => {
    expect(src).not.toContain('async function countClaimedJourneyRows');
    expect(src).not.toContain("UPDATE journey_step_logs SET status = 'sent'");
    expect(src).toMatch(/import \{ judgeLoadUnit, recordLoadUnit, clearLoadUnit, confirmLoadUnit \} from '\.\/journey-send-claim';/);
    // 단위 기록(연결 번호)은 적재 CT 가 문장을 보내기 전에 부른다(record = recordLoadUnit · I4)
    expect(units.split('record: (h) => recordLoadUnit(campaignId, h),').length - 1).toBe(2);
  });

  it('발송 수는 적재 뒤에만 오른다(미적재 환불의 근거)', () => {
    expect(confirmAt).toBeGreaterThan(loadAt);
  });

  it("월 예산 합계는 'sent'만 센다(적재 중 표식 비용이 들어가지 않는다)", () => {
    // ★ 2026-11-11 C129 D4 — 월 예산 문장 = JOURNEY_MONTH_COST_SQL(KST 달)
    const b = src.slice(src.indexOf('export const JOURNEY_MONTH_COST_SQL'), src.indexOf('export const JOURNEY_MONTH_COST_SQL') + 1700);   // ★ C129 D10 — 원장 순지출 조각이 앞에 붙었다
    expect(b).toContain("l.status = 'sent'");
  });
});
