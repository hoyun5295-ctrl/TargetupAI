/**
 * scan-cursor.ts — 주기 작업의 회전 커서(★ 2026-11-02 엔진 재설계 Codex 구현 1R · 뿌리 R12)
 *
 * 회차마다 같은 순서 · 같은 LIMIT 으로 후보를 고르면, 진행 못 하는 행(잔액 부족 · 결과 대기 · 적재 실패)이 앞자리를 차지해 뒤 행이 영영 차례를 못 받는다.
 * 키 순(행 id) 커서로 회차마다 이어서 보고, 한 바퀴를 다 돌면(LIMIT 보다 적게 나오면) 처음부터 = 모든 후보가 ceil(후보 수 / LIMIT) 회차 안에 한 번은 본다.
 * 프로세스 메모리(재시작 = 처음부터 · 빠짐 아님). SQL 꼴 = `AND ($n::uuid IS NULL OR id > $n::uuid) ORDER BY id LIMIT L`.
 */
export function createScanCursor() {
  let last: string | null = null;
  return {
    get after(): string | null { return last; },
    advance(keys: readonly string[], limit: number): void { last = keys.length < limit ? null : keys[keys.length - 1]; },
    reset(): void { last = null; },
  };
}
