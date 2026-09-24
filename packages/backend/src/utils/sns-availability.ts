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
import { companyListAllows, SNS_CHANNEL_COMPANY_ENV } from './sns-constants';

/** 실비 채널의 이번 달 게시 상한. 비었거나 숫자가 아니거나 0 이하면 0(= 닫힘). */
export function snsMeteredMonthlyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(String(env.SNS_X_MONTHLY_POST_CAP ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * ★ 2026-09-24 넷째 조건 — **심사 전 채널(페이스북 페이지·X)은 채널 회사 명단에 든 회사에만** 연다.
 *   자사 실측용으로 자격 ENV 를 넣는 순간 SNS 가 열린 모든 회사에 카드가 열리던 구멍을 막는다.
 *   `companyId` 는 필수 인자다(호출부 4곳을 tsc 로 강제 · 빠뜨리면 카드와 저장 판정이 갈린다).
 */
export function snsChannelAvailable(
  adapter: ISnsAdapter,
  companyId: string | null,
  env: Record<string, string | undefined> = process.env,
): { ok: true } | { ok: false; reason: string } {
  if (!adapter.available) return { ok: false, reason: '아직 준비 중인 채널이에요.' };
  const creds = resolveSnsCredentials(adapter.platform, env);
  if (!creds.ok) return { ok: false, reason: creds.reason };
  if (adapter.capabilities.metered && snsMeteredMonthlyCap(env) === 0) {
    return { ok: false, reason: '아직 준비 중인 채널이에요.' };
  }
  const gateKey = SNS_CHANNEL_COMPANY_ENV[adapter.platform];
  // ⛔ `?? ''` — 명단 ENV 가 없으면 빈 문자열로 판정한다(닫힘). 다른 명단으로 넘어가지 않는다.
  if (gateKey && !companyListAllows(companyId, env[gateKey] ?? '')) {
    return { ok: false, reason: '아직 준비 중인 채널이에요.' };
  }
  return { ok: true };
}
