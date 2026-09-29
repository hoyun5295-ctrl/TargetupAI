/**
 * 여정 발송 표식은 적재 전에 · 두 단계로 (★ 2026-09-26 한줄로 V2 m105 · CRASH 묶음 · Codex 1R ④ · 2R ③④⑤)
 *
 * 옛 순서: 차감 → 큐 적재(커밋) → step_log 'sent'. 적재 커밋과 기록 사이에 멈추면 멱등 가드(step_log 'sent')가 비어
 * 재실행이 같은 고객에게 다시 보내고 다시 차감했다.
 * 새 순서: 차감 → step_log 'sending'(적재 중 표식) → 큐 적재 → 'sent' 확정(+발송 수 한 문장 · 실패는 던진다).
 * 적재 오류에도 표식을 지우지 않는다(2R ③ — 응답만 유실되고 행은 들어갔을 수 있다). 판정은 CT(journey-send-claim) 하나가 한다:
 *   5분 뒤 재시도 = 다음 실행의 가드가 판정 · 재시도 소진 = 그 자리에서 판정(이 단계를 떠나면 가드가 다시 보지 않는다).
 * 'sending'은 발송 수·월 예산(status='sent'만)에 들어가지 않는다.
 * CT 자체의 동작(이 시도의 행만 · 한 문장 확정 · 판정 결과)은 journey-send-claim-resolve 테스트가 소유한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');

describe('여정 발송 표식 순서', () => {
  const deductAt = src.indexOf("const deduct = await prepaidDeduct(exec.company_id, 1, prepaidMsgType as any, campaignId");
  const claimAt = src.indexOf("gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, NOW(), 'sending', $4");
  const alimLoadAt = src.indexOf('await insertAlimtalkQueue(');
  const smsLoadAt = src.indexOf("await bulkInsertSmsQueue(tables, [row], true, { companyId: exec.company_id, source: 'journey' });");
  const catchAt = src.indexOf('} catch (sendErr: any) {');
  const confirmAt = src.indexOf('await confirmJourneyClaimSent(claimLogId)');
  const creditAt = src.indexOf('await chargeJourneyOperationCredit(exec, new Date());', catchAt);

  it('적재 중 표식은 차감 뒤 · 두 적재 앞이다', () => {
    expect(deductAt).toBeGreaterThan(0);
    expect(claimAt).toBeGreaterThan(deductAt);
    expect(claimAt).toBeLessThan(alimLoadAt);
    expect(claimAt).toBeLessThan(smsLoadAt);
  });

  it("'sent' INSERT는 없다 — 적재가 끝난 뒤 표식을 'sent'로 확정한다(발송 수와 한 문장 · 실패는 던진다)", () => {
    expect(src.split("NOW(), 'sent', $4").length - 1).toBe(0);
    expect(src.split("NOW(), 'sending', $4").length - 1).toBe(1);
    expect(confirmAt).toBeGreaterThan(catchAt);
    // ★ 2026-09-29 차수 5(Codex 1R high) — 크레딧(멱등)을 확정 **전에** 받는다: 확정 뒤 끊겨도 'sent'면 이미 받은 상태
    expect(creditAt).toBeGreaterThan(catchAt);
    expect(creditAt).toBeLessThan(confirmAt);
    // 삼키지 않는다(⑤) — 확정 실패는 실행을 던져 다음 틱의 가드가 확정한다
    expect(src.slice(confirmAt, confirmAt + 80)).not.toContain('.catch(');
    // 발송 수는 확정 문장이 올린다 — 따로 올리는 호출이 남으면 두 번 오른다
    expect(src).not.toContain('bumpStepCampaignCount(');
  });

  it('적재 오류(catch)는 표식을 지우지 않는다(③)', () => {
    const catchBody = src.slice(catchAt, src.indexOf("return 'failed';\n  }\n", catchAt));
    expect(catchBody).not.toContain('DELETE FROM journey_step_logs');
  });

  it('재시도 소진 분기는 정지 전에 표식을 판정한다 — 들어갔으면 발송으로 마친다', () => {
    const catchBody = src.slice(catchAt, src.indexOf('// ★ 2026-09-26 한줄로 V2 m105 — 적재가 끝났다', catchAt));
    const retryAt = catchBody.indexOf('if (errorCount < 1) {');
    const resolveAt = catchBody.indexOf('resolveJourneyClaim(exec, claimLogId, { closeNow: true, beforeConfirm: (at) => chargeJourneyOperationCredit(exec, at) })');
    const pauseAt = catchBody.indexOf('await autoPauseExecution(');
    expect(retryAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(retryAt);
    expect(resolveAt).toBeLessThan(pauseAt);
    const seg = catchBody.slice(resolveAt, pauseAt);
    expect(seg).toMatch(/result === 'sent'\) \{[\s\S]*await advanceOrComplete\(exec, step, resolved\.cost\);\s*return 'sent';/);
    // 증명 안 됨 = 기다리지 않고 닫힘(이 실행은 정지·전진하므로 다시 볼 자리가 없다 · 다시 보내지 않는다) → 경보
    expect(seg).toMatch(/result === 'closed'\) \{[\s\S]*alertUnprovableClaim\(exec, step, claimLogId\)/);
  });

  it("가드는 'sending' 표식을 CT로 판정한다(있으면 확정·건너뜀 · 없으면 지우고 보냄 · 셀 수 없으면 던짐)", () => {
    const g = src.slice(src.indexOf('const alreadySent = await query('), src.indexOf("return 'skipped_already_sent';", src.indexOf('const alreadySent = await query(')) + 400);
    expect(g).toContain("l.status = 'sending'");
    expect(g).toContain('await resolveJourneyClaim(exec, claimRow.id, { beforeConfirm: (at) => chargeJourneyOperationCredit(exec, at) })');
    expect(g).toMatch(/result === 'sent'\) \{[\s\S]*await advanceOrComplete\(exec, step, resolved\.cost\);\s*return 'skipped_already_sent';/);
  });

  it('가드: 닫힌 표식(load_unprovable)도 이미 처리됨으로 본다 — 닫은 뒤 전진이 실패해도 다시 보내지 않는다 (5R ①)', () => {
    const at = src.indexOf('const alreadySent = await query(');
    const q = src.slice(at, src.indexOf(');', at));
    expect(q).toContain("status = 'sent' OR (status = 'failed' AND error_reason = 'load_unprovable')");
  });

  it('가드: 증명 안 됨 = 보내지 않고 10분 뒤 다시 본다 · 1시간 넘어 닫히면 경보 후 다음 단계로(다시 보내지 않는다 · 4R)', () => {
    const at = src.indexOf('const alreadySent = await query(');
    const g = src.slice(at, src.indexOf('// ★ D188 Phase 2-B-3', at));
    expect(g).toMatch(/result === 'held'\) \{[\s\S]*UPDATE journey_executions SET next_run_at = NOW\(\) \+ INTERVAL '10 minutes' WHERE id = \$1::uuid[\s\S]*return 'waited';/);
    expect(g).toMatch(/result === 'closed'\) \{[\s\S]*alertUnprovableClaim\(exec, step, claimRow\.id\);\s*await advanceOrComplete\(exec, step, 0\);\s*return 'failed';/);
    // 판정이 끝나지 않은 표식이 있으면(held·closed) 아래 발송으로 내려가지 않는다
    const heldAt = g.indexOf("result === 'held'");
    expect(g.slice(heldAt, heldAt + 600)).toContain("return 'waited';");
  });

  it('운영 크레딧은 한 함수가 원 발송일 키로 받는다 — 정상 발송·가드 복구·재시도 소진 복구 세 경로 (3R ⑤)', () => {
    expect(src.split('await deductCreditSafe({').length - 1).toBe(1);
    const fn = src.slice(src.indexOf('async function chargeJourneyOperationCredit('), src.indexOf('async function chargeJourneyOperationCredit(') + 900);
    expect(fn).toContain('await deductCreditSafe({');
    expect(fn).toContain('idempotencyKey: `journey-operation:${exec.journey_id}:${kstDateTag(sentAt)}`');
    // ★ 2026-09-29 차수 5(Codex 1R high): 판정으로 확정하는 자리(가드·재시도 소진·활성 아닌 실행 정리)는 확정 **전에**
    //   resolveJourneyClaim beforeConfirm 으로 받는다 → 직접 await 는 정상 발송 1곳 · beforeConfirm 3곳(v2-round5-0929 ⑤⑥)
    expect(src.split('await chargeJourneyOperationCredit(').length - 1).toBe(1);
    expect(src.split('beforeConfirm: (at) => chargeJourneyOperationCredit(').length - 1).toBe(3);
  });

  it('원행 계수·확정은 CT만 한다(실행기 안 복제 0)', () => {
    expect(src).not.toContain('async function countClaimedJourneyRows');
    expect(src).not.toContain("UPDATE journey_step_logs SET status = 'sent'");
    expect(src).toMatch(/import \{ confirmJourneyClaimSent, resolveJourneyClaim \} from '\.\/journey-send-claim';/);
  });

  it('발송 수는 적재 뒤에만 오른다(미적재 환불의 근거)', () => {
    expect(confirmAt).toBeGreaterThan(smsLoadAt);
    expect(confirmAt).toBeGreaterThan(alimLoadAt);
  });

  it("월 예산 합계는 'sent'만 센다(적재 중 표식 비용이 들어가지 않는다)", () => {
    const b = src.slice(src.indexOf('이번 달 실제 발송 비용'), src.indexOf('이번 달 실제 발송 비용') + 600);
    expect(b).toContain("l.status = 'sent'");
  });
});
