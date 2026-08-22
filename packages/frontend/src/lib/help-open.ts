/**
 * help-open.ts — 도움말 열림 상태 CT (★ 2026-08-22(2) 신설)
 *
 * 도움말 진입점이 둘이 됐다: 전역 우하단 런처(`HelpDock`)와 대시보드 헤더 버튼(`DashboardHeader`).
 * 열림 상태를 각자 들면 한쪽에서 연 것을 다른 쪽이 모른다. 그래서 **상태는 여기 하나가 소유하고**
 * 두 진입점은 이것을 여닫는 손잡이일 뿐이다.
 *
 * `eligible`도 같이 둔다 — 도움말 대상인지(요금제 사용 중인 회사) 판정하는 곳은 서버 하나고,
 * 그 응답을 받는 곳은 `HelpDock`뿐이다. 헤더 버튼은 그것을 읽어 보이거나 숨는다.
 * ⛔ 헤더가 요금제를 따로 조회해 판정하지 않는다(판정이 두 벌이 된다 — `help-api.ts` 규약과 같다).
 *
 * 라우터·컨텍스트를 쓰지 않은 이유: 헤더는 대시보드 안, 런처는 라우트 바깥에 있어 공통 조상이
 * App 최상단뿐이다. 그 하나를 위해 Provider를 더 얹기보다 모듈 상태 + 구독이 얇다(`surface-flags.ts`와 같은 방식).
 */
import { useSyncExternalStore } from 'react';

let openState = false;
let eligibleState = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function openHelp(): void {
  if (openState) return;
  openState = true;
  emit();
}

export function closeHelp(): void {
  if (!openState) return;
  openState = false;
  emit();
}

export function toggleHelp(): void {
  openState = !openState;
  emit();
}

/** 서버 판정 결과를 알린다. 호출자는 `HelpDock` 하나 */
export function setHelpEligible(v: boolean): void {
  if (eligibleState === v) return;
  eligibleState = v;
  emit();
}

export function useHelpOpen(): boolean {
  return useSyncExternalStore(subscribe, () => openState, () => false);
}

export function useHelpEligible(): boolean {
  return useSyncExternalStore(subscribe, () => eligibleState, () => false);
}
