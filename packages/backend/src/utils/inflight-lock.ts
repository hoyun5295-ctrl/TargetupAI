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
}
