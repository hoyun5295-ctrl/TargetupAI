/**
 * 여정 V.3 묶음 1 — D1 크레딧이 모자라면 멈춤 (2026-10-20 · 설계서 §5-6)
 *
 * Harold 1020 「선불이든 후불이든 크레딧을 월에 지급하는게 있는데 크레딧이 모자르면 둘 다 멈추는게 맞는거지 · 다음달 크레딧에서 땡겨오냐」.
 * 못 박는 것:
 *   - 여정 운영(journey-operation)은 마이너스 0(선불 · 후불 같음) · 자동 마케팅 운영(continuous-operator-send)은 옛 허용 그대로
 *   - 실행기는 그날 그 계보의 운영 크레딧을 아직 안 냈을 때만 잔액을 보고, 모자라면 보내지 않고 멈춘다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { creditOverageAllowance } from '../ai-credit-tx';

describe('여정 운영 마이너스 0 (선불 · 후불 같음)', () => {
  const prepaid = { plan_credits: 300, billing_type: 'prepaid', overage_limit: 0 };
  const postpaid = { plan_credits: 750, billing_type: 'postpaid', overage_limit: 5000 };
  it('journey-operation = 0', () => {
    expect(creditOverageAllowance(prepaid, 'journey-operation')).toBe(0);
    expect(creditOverageAllowance(postpaid, 'journey-operation')).toBe(0);
  });
  it('자동 마케팅 운영은 옛 허용(−월 기본분) 그대로', () => {
    expect(creditOverageAllowance(prepaid, 'continuous-operator-send')).toBe(300);
    expect(creditOverageAllowance(postpaid, 'continuous-operator-send')).toBe(750);
  });
  it('다른 출처는 옛 규칙(후불 = 추가 사용 한도 · 선불 = 0)', () => {
    expect(creditOverageAllowance(postpaid, 'dm-ai')).toBe(5000);
    expect(creditOverageAllowance(prepaid, 'dm-ai')).toBe(0);
  });
});

vi.mock('../ai-credit', () => {
  class InsufficientCreditError extends Error {}
  return { deductCreditSafe: vi.fn(), deductCreditOutcome: vi.fn(), isChargedByKey: vi.fn(), InsufficientCreditError };
});

describe('실행기 크레딧 = 보내기 전 그 자리 차감(★ Codex 적대 A1 · 확인과 차감 사이 경합 0)', () => {
  let mod: any;
  let charged: ReturnType<typeof vi.fn>;
  let outcome: ReturnType<typeof vi.fn>;
  let Insufficient: any;
  beforeEach(async () => {
    const credit: any = await import('../ai-credit');
    charged = credit.isChargedByKey; outcome = credit.deductCreditOutcome; Insufficient = credit.InsufficientCreditError;
    charged.mockReset(); outcome.mockReset();
    mod = await import('../journey-executor');
  });
  it('그날 이 계보의 운영 크레딧을 이미 받았으면 차감 없이 통과(발송마다 회사 행을 잠그지 않는다)', async () => {
    charged.mockResolvedValue(true);
    const ok = await mod.reserveJourneyOperationCredit({ company_id: 'c', journey_id: 'v2', lineage_root: 'root' }, new Date('2026-10-20T03:00:00Z'));
    expect(ok).toBe(true);
    expect(charged).toHaveBeenCalledWith('c', 'journey-operation:root:20261020');
    expect(outcome).not.toHaveBeenCalled();
  });
  it('아직 안 받았으면 같은 키로 엄격 차감(잔액 부족은 던진다 · 마이너스 0) — 성공 = 참', async () => {
    charged.mockResolvedValue(false);
    outcome.mockResolvedValue('deducted');
    const ok = await mod.reserveJourneyOperationCredit({ company_id: 'c', journey_id: 'v2', lineage_root: null, created_by: 'u' }, new Date('2026-10-20T03:00:00Z'));
    expect(ok).toBe(true);
    expect(outcome).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'c', cost: 10, source: 'journey-operation', idempotencyKey: 'journey-operation:v2:20261020', throwOnInsufficient: true,
    }));
  });
  it('잔액 부족(차감 시점 판정) = 거짓 → 보내지 않고 멈춘다', async () => {
    charged.mockResolvedValue(false);
    outcome.mockRejectedValue(new Insufficient('x'));
    expect(await mod.reserveJourneyOperationCredit({ company_id: 'c', journey_id: 'v2' }, new Date())).toBe(false);
  });
  it('잔액 부족이 아닌 차감 실패는 종전 원칙대로 발송을 막지 않는다(뒤 확정 경로가 같은 키로 다시 받는다)', async () => {
    charged.mockResolvedValue(false);
    outcome.mockResolvedValue('failed');
    expect(await mod.reserveJourneyOperationCredit({ company_id: 'c', journey_id: 'v2' }, new Date())).toBe(true);
  });
  it('자리 = 요금제 잠금 · 라인그룹 확인 뒤 · 멈춤 + 실패 기록 + 보내지 않음 · 옛 확인 함수(잔액만 보고 뒤에 차감) 없음', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'journey-executor.ts'), 'utf-8');
    const plan = src.indexOf("await pauseJourney(exec.journey_id, '요금제가 잠겨 발송을 멈췄습니다');");
    const line = src.indexOf('!(await hasCompanyLineGroup(exec.company_id))');
    const gate = src.indexOf('!(await reserveJourneyOperationCredit(exec, new Date()))');
    expect(plan).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(plan);
    expect(gate).toBeGreaterThan(line);
    const block = src.slice(gate, gate + 400);
    expect(block).toContain('await pauseJourney(exec.journey_id, JOURNEY_PAUSE_CREDIT_OUT);');
    expect(block).toContain("await logFailedStep(exec.execution_id, step.id, 'operation_credit_out');");
    expect(block).toContain("return 'failed';");
    expect(block).not.toContain('advanceOrComplete');
    expect(src).not.toContain('hasJourneyOperationCredit');
    expect(src).not.toContain('hasCreditForStrict');
  });
});

describe('이번 달 크레딧 80% 알림 판정(켜진 여정이 있는 회사)', () => {
  it('남은 크레딧이 월 기본의 20% 밑으로 내려가면 · 크레딧제 미적용 · 기본 0 은 보지 않는다', async () => {
    const { shouldAlertJourneyCredit } = await import('../ai-usage-threshold-alert');
    expect(shouldAlertJourneyCredit({ creditEnabled: true, planCredits: 750, total: 149 } as any)).toBe(true);
    expect(shouldAlertJourneyCredit({ creditEnabled: true, planCredits: 750, total: 150 } as any)).toBe(false);
    expect(shouldAlertJourneyCredit({ creditEnabled: false, planCredits: 750, total: 0 } as any)).toBe(false);
    expect(shouldAlertJourneyCredit({ creditEnabled: true, planCredits: 0, total: 0 } as any)).toBe(false);
  });
  it('달마다 한 번(선점 키) · 담당자 무과금 안내 문자 · 문구에 「여정이 멈춰요」 · 「요금제 상향」', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ai-usage-threshold-alert.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export async function runJourneyCreditAlerts'), src.indexOf('export async function runJourneyCreditAlerts') + 3000);
    expect(fn).toContain("jsonb_build_object('journey_credit_alert_month', $2::text)");
    expect(fn).toContain("COALESCE(ai_usage_threshold_config->>'journey_credit_alert_month', '') <> $2");
    expect(fn).toContain('notifyOperatorAdmins(');
    expect(fn).toContain('켜 둔 여정이 멈춰요');
    expect(fn).toContain('요금제 상향');
    expect(src).toContain('await runJourneyCreditAlerts()');
  });
});
