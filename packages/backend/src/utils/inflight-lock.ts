/**
 * ★ CT: 프로세스 안 동시 실행 잠금 (2026-09-14 T4 · AI 자동제작 설계서 §6-5 "동시 생성(같은 회사 · in-flight) = 409 · 클라 busy 와 한 쌍")
 *
 * 같은 키의 두 번째 실행을 막는다. 메모리 잠금이라 프로세스 1개(pm2 fork) 전제 · 재시작 = 전부 해제 · DDL 0.
 * 잡은 쪽이 finally 에서 반드시 놓는다(라우트 계약 테스트가 `finally { releaseInflight(lockKey); }` 를 고정한다).
 * 빈 키는 잡지 않는다(fail-closed · 회사 없는 요청이 잠금을 공유하지 않게).
 */
const held = new Set<string>();

export function tryAcquireInflight(key: string): boolean {
  if (!key || held.has(key)) return false;
  held.add(key);
  return true;
}

export function releaseInflight(key: string): void {
  held.delete(key);
}

export function isInflight(key: string): boolean {
  return !!key && held.has(key);
}

/** 테스트 전용 — 케이스 사이 잠금 초기화 */
export function clearInflightForTest(): void {
  held.clear();
  tails.clear();
}

// ── 한 줄로 세우기(★2026-10-01) ──
//   tryAcquireInflight 는 둘째 실행을 **거절**한다(사용자가 같은 생성을 두 번 누른 경우). 여기는 둘째가 **기다렸다가** 돈다 —
//   같은 외부 자원(예: 한 몰의 웹훅 목록)을 여러 실행이 다룰 때, 교차 순서마다 보상 장치를 덧대는 대신 교차 자체를 없앤다.
//   같은 전제: 메모리 줄이라 프로세스 1개(pm2 fork) · 재시작 = 줄이 비워진다(도는 중이던 실행은 그 자리에서 끊긴다).
const tails = new Map<string, Promise<void>>();

/**
 * 같은 키의 실행을 들어온 순서대로 하나씩 돌린다. 앞 실행이 실패해도 다음 차례는 돈다(결과·오류는 각자에게 돌아간다).
 * 빈 키는 줄 세우지 않고 바로 돌린다(키 없는 호출끼리 서로 막지 않게).
 */
export function runSerial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  const run = (tails.get(key) || Promise.resolve()).then(fn);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}
