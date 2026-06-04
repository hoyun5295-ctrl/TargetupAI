# 라인그룹 합집합 — 발송통계 hpio 0건 fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the pure function. Steps use checkbox (`- [ ]`).

**Goal:** 집계/통계 조회가 발송자(user) 라인그룹만 보던 것을 user + company 라인그룹 합집합으로 바꿔, 발송 라인과 집계 라인이 어긋나도(hpio처럼) 통계가 0으로 빠지지 않게 한다.

**Architecture:** `getCompanySmsTablesWithLogs`(집계·결과·통계 조회 전용)가 `getCompanySmsTables`(user 우선) 단독 호출 → user 라인 + company 라인 **합집합**으로 확장. 발송 경로(`getCompanySmsTables` 직접 호출)는 **불변** — 여정·발송 로직 0.

**Tech Stack:** Node/Express, TypeScript, MySQL QTmsg(`SMSQ_SEND_*`), ts-node `.verify.ts`.

---

## 실측 근거 (확정)

- hpio 발송 데이터 87,326건 전부 회사 라인 `{SMSQ_SEND_7,8,9}`(대량발송3).
- 집계 `aggregateSmsCountsByCampaign`은 `getCompanySmsTablesWithLogs(company, created_by)`로 user 라인 `{1,2,3}`(대량발송1)을 봐서 매칭 0 → 통계 0.
- 합집합 `{1,2,3,7,8,9}`이면 발송 라인 `{7,8,9}`이 포함되어 정상 집계.
- `getCompanySmsTablesWithLogs`는 집계/결과 전용(491행 주석). 발송은 `getCompanySmsTables`/`getCampaignSmsTables`라 무영향.

## File Structure

- **Modify** `packages/backend/src/utils/sms-queue.ts` — `mergeLineTables` 순수 함수 추가 + `getCompanySmsTablesWithLogs`가 user+company 합집합.
- **Create** `packages/backend/src/utils/__tests__/line-merge.verify.ts` — 순수 테스트.

---

## Task 1: mergeLineTables 순수 함수 (TDD)

**Files:**
- Modify: `packages/backend/src/utils/sms-queue.ts` (getCompanySmsTablesWithLogs 앞)
- Test: `packages/backend/src/utils/__tests__/line-merge.verify.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
/**
 * line-merge.verify.ts — 라인그룹 테이블 합집합 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/line-merge.verify.ts
 */
import assert from 'node:assert';
import { mergeLineTables } from '../sms-queue';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

ok('user+company 합집합 — 중복 제거', () => {
  assert.deepStrictEqual(
    mergeLineTables(['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3'], ['SMSQ_SEND_7', 'SMSQ_SEND_8', 'SMSQ_SEND_9']),
    ['SMSQ_SEND_1', 'SMSQ_SEND_2', 'SMSQ_SEND_3', 'SMSQ_SEND_7', 'SMSQ_SEND_8', 'SMSQ_SEND_9']
  );
});
ok('겹치는 테이블 1번만', () => {
  assert.deepStrictEqual(mergeLineTables(['A', 'B'], ['B', 'C']), ['A', 'B', 'C']);
});
ok('한쪽 빈 배열', () => {
  assert.deepStrictEqual(mergeLineTables(['A'], []), ['A']);
  assert.deepStrictEqual(mergeLineTables([], ['B']), ['B']);
});
ok('양쪽 동일 → 그대로', () => {
  assert.deepStrictEqual(mergeLineTables(['A', 'B'], ['A', 'B']), ['A', 'B']);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
```

- [ ] **Step 2: 실패 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/line-merge.verify.ts`
Expected: FAIL — `mergeLineTables` is not exported.

- [ ] **Step 3: 최소 구현** — sms-queue.ts의 `getCompanySmsTablesWithLogs`(491행) 정의 바로 앞에 추가

```ts
/** 두 라인그룹 테이블 배열을 순서 보존 합집합(중복 제거). 집계 조회가 발송 라인을 놓치지 않게. */
export function mergeLineTables(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/line-merge.verify.ts`
Expected: PASS — `4 assertions passed`.

---

## Task 2: getCompanySmsTablesWithLogs 합집합 적용

**Files:**
- Modify: `packages/backend/src/utils/sms-queue.ts:491-510` (getCompanySmsTablesWithLogs)

- [ ] **Step 1: liveTables를 user+company 합집합으로 교체**

기존(492):
```ts
  const liveTables = await getCompanySmsTables(companyId, userId);
```
교체:
```ts
  // ★ 집계 전용 — user 라인그룹과 company 라인그룹 합집합 (발송이 둘 중 어느 라인으로 나갔든 포함).
  //   발송 후 라인그룹이 바뀌어도 과거 발송 집계가 안 깨지는 내성. 발송 경로(getCompanySmsTables)는 불변.
  const userLive = await getCompanySmsTables(companyId, userId);
  const companyLive = userId ? await getCompanySmsTables(companyId) : userLive;
  const liveTables = mergeLineTables(userLive, companyLive);
```

(이하 `existingLogs`·LOG 합치는 로직은 그대로 — liveTables 기반이라 자동으로 양쪽 LOG 포함.)

- [ ] **Step 2: tsc 통과 확인**

Run: `cd packages/backend && ../backend/node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

---

## Task 3: 검증 + 자가 grep

- [ ] **Step 1: 순수 테스트 재실행** — `4 assertions passed`
- [ ] **Step 2: backend tsc 0**
- [ ] **Step 3: 자가 grep** — 변경 파일에 모델명/박-계열 0건

Run: Grep `박[음힘는을힌지혀힙히혔힐았]|Opus|Sonnet|Haiku` in sms-queue.ts + line-merge.verify.ts
Expected: 0건.

- [ ] **Step 4: 배포 후 실측(Harold)** — 슈퍼관리자 발송통계에서 hpio 5/30 캠페인이 전송 87,326·성공 84,503으로 정상 표기되는지(0이 아닌지).

---

## 배포 메모

- backend만 변경. ts-node 운영 → `git pull` + `pm2 restart targetup-backend`.
- DB 마이그레이션 0. 신규 컬럼 0.
- 영향: `getCompanySmsTablesWithLogs` 소비처(aggregateSmsCountsByCampaign 등 집계 전용) — company 라인 1회 추가 조회(캐시 hit). 발송·여정 무영향.
- 다음 단계(별도): 발송통계 result_final 캐시 전환(속도), hoyun 500 status 정리(환불 검토).
