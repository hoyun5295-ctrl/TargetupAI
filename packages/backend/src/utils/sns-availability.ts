/**
 * sns-availability.ts — SNS 채널 개방 판정 컨트롤타워 (2026-09-23 1차-B)
 *
 * 설계 SoT = docs/2026-09-23-sns-1b-design.md §3-9 · 불변 23.
 *
 * 채널이 "지금 쓸 수 있는가"는 셋이 모두 참일 때만이다.
 *   ① 어댑터 코드가 준비됐다(`available`)
 *   ② 한줄로 앱 자격 ENV 가 있다(없으면 연결 창이 열리자마자 실패한다)
 *   ③ 실비 채널(X)이면 **월 상한 ENV 가 양의 정수**다 — 비었거나 0 이면 열지 않는다(fail-closed)
 *
 * ⛔ 화면 카드 · 연결 시작 · 저장 · 발행 워커가 **이 함수 하나**를 부른다. 각자 판정하면 카드는 열렸는데
 *   저장에서 막히는 식으로 화면과 서버가 갈린다. 코드 배포만으로 고객에게 깨진 채널이 열리지 않게 하는 장치다.
 */

import type { ISnsAdapter } from './sns/adapter';
import { resolveSnsCredentials } from './sns-accounts';

/** 실비 채널의 이번 달 게시 상한. 비었거나 숫자가 아니거나 0 이하면 0(= 닫힘). */
export function snsMeteredMonthlyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(String(env.SNS_X_MONTHLY_POST_CAP ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function snsChannelAvailable(
  adapter: ISnsAdapter,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (!adapter.available) return { ok: false, reason: '아직 준비 중인 채널이에요.' };
  const creds = resolveSnsCredentials(adapter.platform, env);
  if (!creds.ok) return { ok: false, reason: creds.reason };
  if (adapter.capabilities.metered && snsMeteredMonthlyCap(env) === 0) {
    return { ok: false, reason: '아직 준비 중인 채널이에요.' };
  }
  return { ok: true };
}
