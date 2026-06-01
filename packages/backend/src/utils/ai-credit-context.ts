/**
 * utils/ai-credit-context.ts — AI 크레딧 묶음 차감 컨텍스트 (AsyncLocalStorage)
 *
 * orchestrate처럼 여러 sub-agent가 callAIWithFallback을 호출하는 작업은, 진입점에서 1회만
 * 차감하고 내부 sub 호출은 차감하지 않아야 한다(묶음). runInCreditBundle로 감싸면 그 안에서
 * 도는 callAIWithFallback이 creditCost를 0으로 본다 — 차감 skip, 토큰 집계(recordAiCall)는 그대로.
 * 사전 체크/실제 차감은 진입점(orchestrate)이 deductCredit/checkCredit으로 직접 1회 수행한다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const creditBundleStore = new AsyncLocalStorage<{ bundled: true }>();

/** fn 실행 동안 "묶음 모드" — 내부 callAIWithFallback은 차감 skip. */
export function runInCreditBundle<T>(fn: () => Promise<T>): Promise<T> {
  return creditBundleStore.run({ bundled: true }, fn);
}

/** 현재 묶음 모드 여부 (callAIWithFallback이 차감 skip 판단). */
export function isInCreditBundle(): boolean {
  return creditBundleStore.getStore()?.bundled === true;
}
