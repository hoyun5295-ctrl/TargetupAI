// utils/concurrency.ts
// ★ 컨트롤타워 — 동시성 상한을 둔 병렬 실행. (2026-07-26 정산 속도)
//
// 배경: 정산 집계가 SMSQ 테이블을 `for (const t of tables) { await ... }`로 하나씩 훑는다.
//   회사당 라인 11~12개 + LOG 3개월치 = 40~48개 테이블이고, 집계 함수가 둘이라 왕복이 90~100회다.
//   각 쿼리가 1~2초면 그것만으로 2분이 나온다(금강제화 실측). 인덱스는 이미 있다 —
//   느린 원인은 쿼리 하나가 아니라 **순차 왕복 횟수**다.
//
// 무제한 병렬은 답이 아니다. 커넥션을 다 물면 그 풀을 쓰는 다른 일이 멈춘다.
// 그래서 ①정산은 **전용 MySQL 풀**(`mysqlBillingPool`)을 쓰고 ②그 풀 크기를 넘지 않게 상한을 둔다.
// 전용 풀이라 발송 풀(10)은 정산과 무관하게 항상 10이다 — 기간계에 닿지 않는다.

// 이 파일은 **순수 유틸**로 둔다 — 동시성 상한 값은 풀을 소유한 `config/database.ts`가 정하고
// 호출부가 넘긴다. 여기서 config를 import하면 순수 함수 테스트가 DB 설정을 끌고 온다.

/**
 * 입력 순서를 보존하며 최대 `limit`개씩 동시에 실행한다.
 *
 * 순서를 지키는 이유: 집계 결과를 이어 붙이는 쪽이 순서에 의존하지 않더라도,
 * 로그·디버깅에서 "몇 번째 테이블이 느렸나"를 보려면 입력과 출력이 같은 축이어야 한다.
 *
 * 하나라도 실패하면 그대로 throw한다 — 테이블 하나를 조용히 건너뛰면 그 라인 발송분이
 * 통째로 미청구가 된다(`queryImcOrSkipIfMissing`과 달리 SMSQ 라인 테이블은 반드시 터져야 한다).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const max = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  const out: R[] = new Array(list.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  };

  await Promise.all(Array.from({ length: max }, () => worker()));
  return out;
}

/**
 * ★ 2026-11-02 엔진 재설계 E2-2 · E2-5 — 회사 돌아가며 섞기(순수 함수). 회사마다 원래 순서를 지키며 한 회사에 하나씩 번갈아 꺼낸다
 *   (회사 순서 = 그 회사 첫 항목이 나온 순서). 한 회사의 여정 40개가 앞자리를 다 차지해 다른 회사가 회차 예산 밖으로 밀리는 일을 막는다.
 */
export function interleaveByCompany<T>(items: readonly T[], companyOf: (item: T) => string): T[] {
  const queues = groupByCompany(items, companyOf);
  const total = queues.reduce((n, q) => n + q.length, 0);
  const out: T[] = [];
  for (let round = 0; out.length < total; round++) {
    for (const q of queues) if (round < q.length) out.push(q[round]);
  }
  return out;
}

/** 회사별 줄(회사 순서 = 첫 항목이 나온 순서 · 줄 안 = 원래 순서) */
function groupByCompany<T>(items: readonly T[], companyOf: (item: T) => string): T[][] {
  const lanes = new Map<string, T[]>();
  for (const it of Array.isArray(items) ? items : []) {
    const k = String(companyOf(it));
    const lane = lanes.get(k);
    if (lane) lane.push(it);
    else lanes.set(k, [it]);
  }
  return [...lanes.values()];
}

/**
 * ★ 2026-11-02 엔진 재설계 E2-1 · E2-3 — 회사 줄: 같은 회사 항목은 한 줄에서 차례로(예산 · 잔액 · 피로도 판정이 지금과 같다) ·
 *   회사 줄끼리는 동시에 최대 `limit` 개. 항목 하나의 실패는 fn 이 맡는다(던지면 그 회사 줄만 멈추고 나머지 줄은 끝까지 간다 · 첫 오류를 끝에 던짐).
 */
export async function runCompanyLanes<T>(
  items: readonly T[],
  companyOf: (item: T) => string,
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let firstErr: unknown = null;
  await mapWithConcurrency(groupByCompany(items, companyOf), limit, async (lane) => {
    try {
      for (const it of lane) await fn(it);
    } catch (e) {
      if (firstErr === null) firstErr = e;
    }
  });
  if (firstErr !== null) throw firstErr;
}
