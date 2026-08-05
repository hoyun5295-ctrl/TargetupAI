/**
 * deductCreditSafe 반환 계약 — "차감 의무가 남아 있지 않은가" (2026-08-05 신설)
 *
 * 왜 이 파일이 있나:
 *   이 함수는 잔액 부족·영구 실패에도 **throw하지 않는다**. 그래서 호출부가 try/catch로 실패를 잡으려 하면
 *   그 catch는 절대 발화하지 않는 죽은 분기가 된다 — 자동마케팅 발송이 그 catch에 기대어 무과금 발송을
 *   'sent'로 마감했고(정지복구는 status='sending'만 본다) 재차감 경로가 영영 닫혔다.
 *   ⇒ 판정은 예외가 아니라 **반환값**으로 한다. 이 계약이 깨지면 돈이 조용히 샌다.
 *
 * true  = 차감됨 · 이미 차감됨(멱등 중복) · 차감 대상 아님(크레딧제 미적용·cost 0·companyId 없음)
 * false = 잔액 부족 · 영구 실패 · 크레딧 행 없음  → 호출부는 상태를 전진시키면 안 된다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deductCreditSafe, InsufficientCreditError } from './ai-credit';

const noSleep = (_ms: number) => Promise.resolve();
const BASE = { companyId: 'c1', cost: 10, source: 'continuous-operator-send', createdBy: 'u1', aiCallLogId: 'log' };

const DEDUCTED = { deducted: true, fromBase: 10, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0 };
const skipped = (skipReason: 'duplicate' | 'not_applicable' | 'no_credit_row') =>
  ({ deducted: false, fromBase: 0, fromPurchased: 0, baseAfter: 0, purchasedAfter: 0, skipReason });

/** behavior 순서대로 결과/예외를 흉내내는 mock deduct. 호출 인자를 기록한다. */
function makeDeduct(behavior: Array<any>) {
  const calls: any[] = [];
  let i = 0;
  const fn = async (opts: any) => {
    calls.push(opts);
    const b = behavior[Math.min(i, behavior.length - 1)];
    i++;
    if (b instanceof Error) throw b;
    return b;
  };
  return { fn: fn as any, calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('deductCreditSafe — 차감 확정 여부 반환', () => {
  it('차감 성공이면 true', async () => {
    const d = makeDeduct([DEDUCTED]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(true);
    expect(d.calls.length).toBe(1);
  });

  it('멱등 중복(duplicate)은 true — 돈은 이미 빠졌다', async () => {
    const d = makeDeduct([skipped('duplicate')]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(true);
  });

  it('크레딧제 미적용(not_applicable)은 true — 차감 대상이 아니다', async () => {
    const d = makeDeduct([skipped('not_applicable')]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(true);
  });

  it('크레딧 행 없음(no_credit_row)은 false — 미해결이다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const d = makeDeduct([skipped('no_credit_row')]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(false);
  });

  it('잔액 부족은 false + 재시도 없음', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: any[]) => { logs.push(a.map(String).join(' ')); });
    const d = makeDeduct([new InsufficientCreditError(10, 0)]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(false);
    expect(d.calls.length).toBe(1);
    expect(logs.some((l) => l.includes('[CREDIT][SKIP]'))).toBe(true);
  });

  it('일시 실패 2회 뒤 성공이면 true (3회 호출)', async () => {
    const d = makeDeduct([new Error('deadlock'), new Error('deadlock'), DEDUCTED]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(true);
    expect(d.calls.length).toBe(3);
  });

  it('3회 영구 실패는 false + MISS 로그', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: any[]) => { logs.push(a.map(String).join(' ')); });
    const d = makeDeduct([new Error('deadlock')]);
    expect(await deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).toBe(false);
    expect(d.calls.length).toBe(3);
    expect(logs.some((l) => l.includes('[CREDIT][MISS]'))).toBe(true);
  });

  it('cost 0 · companyId 없음은 true (차감 시도 0) — 정상 흐름을 보류로 오판하지 않는다', async () => {
    const d1 = makeDeduct([DEDUCTED]);
    expect(await deductCreditSafe({ ...BASE, cost: 0 }, { deductFn: d1.fn, sleep: noSleep })).toBe(true);
    expect(d1.calls.length).toBe(0);

    const d2 = makeDeduct([DEDUCTED]);
    expect(await deductCreditSafe({ ...BASE, companyId: null }, { deductFn: d2.fn, sleep: noSleep })).toBe(true);
    expect(d2.calls.length).toBe(0);
  });

  it('어떤 경로에서도 throw하지 않는다 — 호출부의 try/catch로는 실패를 잡을 수 없다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const b of [new InsufficientCreditError(10, 0), new Error('deadlock'), skipped('no_credit_row')]) {
      const d = makeDeduct([b]);
      await expect(deductCreditSafe({ ...BASE }, { deductFn: d.fn, sleep: noSleep })).resolves.toBe(false);
    }
  });

  it('재시도 중 멱등키가 바뀌지 않는다 — 바뀌면 이중 차감이 열린다', async () => {
    const d = makeDeduct([new Error('deadlock'), DEDUCTED]);
    await deductCreditSafe({ ...BASE, aiCallLogId: null }, { deductFn: d.fn, sleep: noSleep });
    expect(d.calls.length).toBe(2);
    expect(d.calls[0].idempotencyKey).toBe(d.calls[1].idempotencyKey);
  });
});
