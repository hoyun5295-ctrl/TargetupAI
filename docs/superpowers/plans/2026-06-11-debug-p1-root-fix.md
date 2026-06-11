# P1 근원 코드 — 기록↔실측 구조 결함 영구 차단 설계서

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인, 하나씩 — 병렬 금지). 커밋/배포는 Harold 직접.
> 작성: 2026-06-11 비토. 원자료 = status/DEBUG-FIX-DESIGN-2026-06-11.md + 본 세션 P0 실측.
> **착수 전 Harold님 승인 필수(6원칙 ⑥).**

**Goal:** 0611 계열 5건의 공통 근원(기록 시점 값을 진실로 쓰고 실측과 자동 대조하는 장치 부재 + 라인 "현재 배정" 의존)을 코드에서 영구 제거한다. 같은 문제 재발 0이 목표.

**Architecture:** 4개 축 — ①돈(환불 산식 단일화) ②라인(전 bulk 합집합 원칙) ③수량(3층 출처 고정 + 사유 기록) ④폐기 봉인. 모두 기존 컨트롤타워(utils) 단일 진입점 수정이라 소비처는 자동 보강.

**Tech:** Node/Express + PG + MySQL(QTmsg). 순수 함수만 vitest TDD, DB-의존부는 tsc + 실측 1건.

---

## 0. 실측·코드로 확정한 근원 4축 (증거)

### 축 1 — 환불 누적 "의미 충돌" → 적재 제외분 과소 환불 (돈)
- `prepaidRefund`(utils/prepaid.ts:111-114) = 호출측 count를 "캠페인 정당 환불 누적"으로 보고 `unitPrice×count − alreadyRefunded` 차액만 환불. 누적 풀 = reference_id+message_type 합산.
- 그런데 호출 3곳의 count 의미가 서로 다름:
  - direct-send-worker.ts:147-151 → `total − sent` (**미적재분**)
  - campaign-lifecycle.ts:460-489 → `실측 fail (+타임아웃 pending)` (**결과 실패분**)
  - mysql-refund-sweeper.ts:128-153 → `실측 fail` (**결과 실패분**)
- 정당 환불 = 미적재분 + 결과 실패분의 **합**인데, 같은 풀에 서로 다른 누적이 들어가면 **max로 수렴** → 미적재분이 사라짐.
- 실측 증거: 시세이도 6/8 — 차감 985 / 적재 978(제외 7) / MySQL 실패 30 → 환불은 30건분으로 수렴(7건분 과소). 폴라초이스는 전량 적재(15,697)라 이 구멍이 안 보였을 뿐.

### 축 2 — 라인 합집합이 "현재 배정" 기준 → 해제/재배정 시 과거 발송이 안 보임 (큐·집계·정산)
- `getCompanyAllLiveSmsTables`(sms-queue.ts:535-540) = user현재 ∪ company현재 ∪ 전사용자현재. 라인 해제(에이치피오 6/11 11:18)되면 과거 발송 라인({1,2,3})이 합집합에서 사라짐.
- 실측 증거: 사고 캠페인 잔존 2,129건이 {1,2,3}에 살아 있는데 cancelled-queue-sweeper(ts:36)는 {7,8,9}만 조회 → 1분 주기 안전망이 영구 무력 + 에이전트가 1건씩 계속 발송(실측 +1).
- 같은 뿌리: billing.ts:23 `getBillingCompanyTables = getCompanySmsTables(companyId)` — **회사 라인만**. 사용자 라인 발송분(에이치피오 87k)이 정산 마감에서 누락.
- sweeper 2차 결함: 삭제 조건 status_code=100 한정(sweeper:37,39) — 픽업된 행 잔존 시 처리 없음(취소 경로 campaign-lifecycle:174-187은 9999 마킹까지 함).

### 축 3 — 수량 출처 혼선: sent_count를 sync가 "결과 도착 합"으로 덮어씀 (표시·신뢰)
- worker(direct-send-worker.ts:162)는 sent_count=적재 실측을 기록하는데, sync(campaign-lifecycle.ts:474)와 sweeper(mysql-refund-sweeper.ts:143)가 `sent_count = success+fail`로 덮음 → 결과 도착 전엔 "전송"이 작아 보임(폴라 15,470의 정체) + 엑셀 대기=sent−success−fail이 0으로 보임.
- 취소 경로(campaign-lifecycle.ts:225)는 fail=target/success=0으로 덮음 → 취소 캠페인이 "실패 87,014"로 표기.
- 정제 DELETE(worker:72-91)와 processSendChunk skip 건수를 어디에도 기록 안 함 → "대상−전송 차이 사유"를 업체에 설명 불가(폴라 문의의 발단).
- 발송통계 엑셀(admin.ts:3429-3434)은 대상=target_count·전송=exportResultMap.sent·대기=계산 — 컬럼별 출처가 캠페인 기록/실측 혼합(디버그노트 실측: 대상 2,885=실측합 vs 전송 2,895=기록합).

### 축 4 — 폐기 기능이 계속 실행 + 미정의 결과 코드
- auto-campaign-worker.ts:1423-1463 — D188 폐기는 POST 410뿐, 워커 3단계(문안→스팸테스트→발송)는 status='active'면 영원히 실행. 실측: 인비토 4건이 5월부터 매주/매월 실행.
- sms-result-map.ts — 코드 92 미정의(폴라 214건). unknown→fail 집계는 안전하나 라벨 "코드 92"로 노출.

## 0-1. 라인 축 영향표 (6원칙 ④ — 소비처 전수 grep 실측)

| 경로 | 함수 | 소비처 | 변경 |
|------|------|--------|------|
| 발송 적재 | getCompanySmsTables(cid, uid) | direct-send-worker:55 · journey-executor:703 · auto-campaign-worker:716 · campaigns.ts:80/539/1458 | **불변** (발송은 좁게) |
| 큐 변경 6곳 | getCampaignQueueTables | campaigns.ts:2187/2338/2406/2468 · campaign-lifecycle:161(취소) · cancelled-queue-sweeper:36 | 자동 보강 (내부 합집합 확장) |
| 집계 10곳 | getCompanySmsTablesWithLogs | campaign-lifecycle:58/298/433 · campaign-sync-worker:302 · results.ts:508/688/968 · mysql-refund-sweeper:107 · stats-aggregation:263/307/381 | 자동 보강 (동일) |
| 정산 | billing.ts:23 (회사 라인만) | smsAggByDateType/smsAggByRunAndType/smsAggTestByType | **전 bulk 합집합으로 교체** + 회사 격리 조건 점검 |

부하: bulk 라인 실측 3그룹 9테이블(대량발송 1·2·3). 현 합집합 상한과 동일(최악 9). app_etc1 인덱스 실재(0610 확인 idx_app_etc1_status). 정산은 월 1회 + 월별 이력 곱이라 수용.

---

## Task 1 — calcRefundDue 순수 CT 신설 (환불 산식 단일 정의)

**Files:** Create `packages/backend/src/utils/refund-calc.ts` / Test `packages/backend/src/utils/__tests__/refund-calc.verify.ts`

- [ ] 1-1. 실패하는 테스트 작성 (vitest):
```ts
import { describe, it, expect } from 'vitest';
import { calcRefundDue } from '../refund-calc';

describe('calcRefundDue — 환불 누적의 단일 정의', () => {
  it('폴라형(전량 적재): 차감 15697, 성공 15135, 대기 0 → 562', () => {
    expect(calcRefundDue({ deductedCount: 15697, mysqlSuccess: 15135, mysqlPending: 0 })).toBe(562);
  });
  it('시세이도형(적재 제외 7 + 실측 실패 30): 차감 985, 성공 948, 대기 0 → 37 (기존 max 수렴 30이 아니라 합 37)', () => {
    expect(calcRefundDue({ deductedCount: 985, mysqlSuccess: 948, mysqlPending: 0 })).toBe(37);
  });
  it('결과 대기 중에는 대기분 제외(통신사 처리 중 — 환불 보류)', () => {
    expect(calcRefundDue({ deductedCount: 1000, mysqlSuccess: 700, mysqlPending: 200 })).toBe(100);
  });
  it('성공+대기가 차감을 넘으면 0 (무한환불 0%)', () => {
    expect(calcRefundDue({ deductedCount: 100, mysqlSuccess: 100, mysqlPending: 50 })).toBe(0);
  });
  it('차감 0(후불/무차감)이면 0', () => {
    expect(calcRefundDue({ deductedCount: 0, mysqlSuccess: 0, mysqlPending: 0 })).toBe(0);
  });
});
```
- [ ] 1-2. 실행 → FAIL 확인: `npx vitest run src/utils/__tests__/refund-calc.verify.ts`
- [ ] 1-3. 최소 구현:
```ts
/**
 * 환불 누적의 단일 정의(컨트롤타워) — "정당 환불 = 차감 건수 − 통신사 성공 − 통신사 대기".
 * 미적재분(차감됐는데 큐에 안 들어간 것)과 실측 실패분이 자연히 '합'으로 포함된다.
 * 호출처(worker/lifecycle/sweeper)가 서로 다른 의미의 누적을 보내 max로 수렴하던 과소 환불 구조의 근본 fix.
 * pending은 통신사 처리 중이라 보류 — 결과 도착 시 다음 sweep에서 자동 증가.
 */
export function calcRefundDue(p: { deductedCount: number; mysqlSuccess: number; mysqlPending: number }): number {
  const due = Math.floor(p.deductedCount) - Math.floor(p.mysqlSuccess) - Math.floor(p.mysqlPending);
  return Math.max(0, due);
}
```
- [ ] 1-4. 실행 → PASS 확인 + `npx tsc --noEmit` 0 errors

## Task 2 — mysql-refund-sweeper 산식 교체 (차감 실측 기반)

**Files:** Modify `packages/backend/src/utils/mysql-refund-sweeper.ts:100-159`

- [ ] 2-1. aggFields에 pending 이미 있음(:102) — 캠페인 루프(:122-159)에서 차감 건수 조회 추가 + 환불 호출 교체:
```ts
// 4-2. 환불 호출 — 단일 산식: 정당 환불 = 차감 실측 − 성공 − 대기 (utils/refund-calc.ts)
//   차감 건수는 balance_transactions deduct 실측(금액/단가)으로 산출 — 기록(target_count)이 아니라 돈이 진실.
const mysqlPending = Number(smsAgg.pending_count || 0) + kakaoAgg.pending;
const dedRes = await query(
  `SELECT COALESCE(SUM(amount), 0) AS total FROM balance_transactions
   WHERE company_id = $1 AND type = 'deduct' AND reference_type = 'campaign' AND reference_id = $2
     AND (message_type = $3 OR message_type IS NULL)`,
  [camp.company_id, camp.id, camp.message_type]
);
const unitRes = await query(
  `SELECT CASE $2
            WHEN 'SMS' THEN cost_per_sms WHEN 'LMS' THEN cost_per_lms
            WHEN 'MMS' THEN cost_per_mms WHEN 'KAKAO' THEN cost_per_kakao ELSE 0 END AS unit
   FROM companies WHERE id = $1`,
  [camp.company_id, camp.message_type]
);
const unit = Number(unitRes.rows[0]?.unit || 0);
const deductedCount = unit > 0 ? Math.round(Number(dedRes.rows[0].total) / unit) : 0;
const refundDue = calcRefundDue({ deductedCount, mysqlSuccess, mysqlPending });
if (refundDue > 0) {
  const r = await prepaidRefund(camp.company_id, refundDue, camp.message_type, camp.id, '발송 실패 환불 (sweep)');
  if (r.refunded > 0) { /* 기존 로그 유지 — mysqlFail 대신 refundDue 출력 */ }
}
```
  - import 추가: `import { calcRefundDue } from './refund-calc';`
  - 기존 `if (mysqlFail > 0) prepaidRefund(mysqlFail ...)` 블록은 위로 대체(삭제).
  - 주의: deduct가 0(후불·무차감)이면 refundDue=0 → 호출 자체 skip (prepaidRefund 내부 후불 가드와 이중 안전).
- [ ] 2-2. worker(direct-send-worker:147-151)·lifecycle(:486-491)의 기존 호출은 **유지** — 즉시성 담당. 단 worker 환불 description을 `대량 발송 미적재 ${failed}건 자동 환불`로 정정(의미 명확화). idempotent 풀이 같아 sweep 산식이 최종 수렴 보장.
- [ ] 2-3. tsc 0 + 기존 refund 관련 verify 테스트 회귀 실행

## Task 3 — 전 bulk 라인 합집합 CT (라인 구멍 영구 제거)

**Files:** Modify `packages/backend/src/utils/sms-queue.ts:502-553`

- [ ] 3-1. getAllBulkSmsTables 신설 (캐시 — 기존 lineGroupCache TTL 재사용):
```ts
/** 시스템 전체 bulk 라인 테이블 합집합 — 라인 해제/재배정과 무관하게 과거 발송분을 항상 본다.
 *  배경: 에이치피오 사고 캠페인(기록 없음+라인 해제)을 현재 배정 기준 합집합이 못 봐 안전망이 무력했음(2026-06-11). */
export async function getAllBulkSmsTables(): Promise<string[]> {
  const cached = lineGroupCache.get('all-bulk');
  if (cached && cached.expires > Date.now()) return cached.tables;
  const r = await query(`SELECT sms_tables FROM sms_line_groups WHERE group_type = 'bulk' AND is_active = true`);
  const merged: string[] = [];
  for (const row of r.rows) for (const t of (row.sms_tables || [])) {
    if (isValidSmsTable(t) && !merged.includes(t)) merged.push(t);
  }
  const tables = merged.length > 0 ? merged : BULK_ONLY_TABLES;
  lineGroupCache.set('all-bulk', { tables, hasDedicatedGroup: true, expires: Date.now() + LINE_GROUP_CACHE_TTL });
  return tables;
}
```
- [ ] 3-2. getCompanyAllLiveSmsTables(:535-540)에 합류 — 한 줄 수정으로 큐 6곳+집계 10곳 자동 보강:
```ts
export async function getCompanyAllLiveSmsTables(companyId: string, userId?: string): Promise<string[]> {
  const userLive = await getCompanySmsTables(companyId, userId);
  const companyLive = userId ? await getCompanySmsTables(companyId) : userLive;
  const allUserLive = await getAllCompanyUserLineTables(companyId);
  const allBulk = await getAllBulkSmsTables(); // ★ 2026-06-11: 라인 해제/재배정 내성 — 전 bulk 합집합
  return mergeLineTables(mergeLineTables(mergeLineTables(userLive, companyLive), allUserLive), allBulk);
}
```
- [ ] 3-3. tsc 0 + 소비처 잔존 grep: `grep -rn "getCompanyAllLiveSmsTables\|getCampaignQueueTables\|getCompanySmsTablesWithLogs" packages/backend/src` 결과가 0-1 영향표와 일치하는지 재확인(잔존 누락 0)

## Task 4 — billing 정산 전 라인 + 회사 격리 점검

**Files:** Modify `packages/backend/src/routes/billing.ts:23` (+ 각 집계 호출부 WHERE 점검)

- [ ] 4-1. 교체:
```ts
import { getAllBulkSmsTables, getTestSmsTables } from '../utils/sms-queue';
// 정산은 회사가 역대 어떤 라인으로 발송했든 전부 봐야 한다 (라인 재배정/해제 내성 — 2026-06-11 에이치피오 사용자 라인 발송분 마감 누락 차단).
const getBillingCompanyTables = (_companyId: string) => getAllBulkSmsTables();
```
- [ ] 4-2. **회사 격리 검증(필수)**: billing.ts 안 smsAggByDateType/smsAggByRunAndType/smsAggTestByType 호출부의 whereClause를 정독해 회사 식별(app_etc1 IN (그 회사 campaign/run ids) 또는 bill_id/call_back 등)이 있는지 확인. app_etc1 기반이면 전 라인 조회여도 타사 데이터 미혼입. **회사 식별이 없는 호출부가 발견되면 그 지점은 교체 보류하고 보고**(추측 진행 금지).
- [ ] 4-3. tsc 0

## Task 5 — cancelled-queue-sweeper 보강 (픽업 행 + 효과 검증)

**Files:** Modify `packages/backend/src/utils/cancelled-queue-sweeper.ts:33-58`

- [ ] 5-1. 취소 경로(campaign-lifecycle:174-187)와 동일 정책으로 통일 + 삭제 후 재카운트:
```ts
const tables = await getCampaignQueueTables(c.company_id, c.created_by || undefined, c.send_config);
const pending = await smsCountAll(tables, 'app_etc1 = ? AND status_code = 100', [c.id]);
if (pending > 0) {
  await smsExecAll(tables, `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`, [c.id]);
}
// 픽업됐다 멈춘 행(비성공·비100) — 취소 마킹 9999 (취소 경로와 동일 정책. 성공 행은 보존 = 이력 진실)
const stuck = await smsCountAll(tables, `app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100 AND status_code != 9999`, [c.id]);
if (stuck > 0) {
  await smsExecAll(tables, `UPDATE SMSQ_SEND SET status_code = 9999 WHERE app_etc1 = ? AND status_code NOT IN (${SUCCESS_CODES.join(',')}) AND status_code != 100 AND status_code != 9999`, [c.id]);
}
if (pending > 0 || stuck > 0) {
  // 효과 검증(6원칙 ②) — 정리 후 잔존 0 재확인, 남으면 경고(다음 주기 재시도)
  const remain = await smsCountAll(tables, 'app_etc1 = ? AND status_code = 100', [c.id]);
  deleted += pending + stuck;
  console.log(`[cancelled-queue-sweeper] 취소 캠페인 ${c.id} 정리 — 대기 ${pending} 삭제 / 픽업잔존 ${stuck} 취소마킹 / 재카운트 잔존 ${remain}`);
}
```
  - import 추가: `import { SUCCESS_CODES } from './sms-result-map';`
  - 스캔 윈도우(:26-31)는 유지 — Task 3의 전 라인 합집합으로 테이블 구멍이 닫혔으므로 윈도우 내 재시도가 항상 유효해짐.
- [ ] 5-2. tsc 0

## Task 6 — sent_count = 적재 실측(②층) 의미 고정

**Files:** Modify `packages/backend/src/utils/campaign-lifecycle.ts:472-483` · `packages/backend/src/utils/mysql-refund-sweeper.ts:139-148` · (AI run 섹션 동일 패턴 grep 후 동일 적용)

- [ ] 6-1. 전수 grep(쓰기 경로 — 6원칙 ①): `grep -rn "sent_count\s*=" packages/backend/src` → sent_count를 success+fail로 덮는 지점 전수 목록화(예상: campaign-lifecycle:474, mysql-refund-sweeper:143, AI run 섹션). 결과를 보고에 첨부.
- [ ] 6-2. 각 지점에서 `sent_count = success+fail` 제거 — success_count/fail_count만 갱신, sent_count는 worker 적재 실측 보존:
```sql
UPDATE campaigns SET
  success_count = $1,
  fail_count = $2,
  status = $3::text,
  sent_at = CASE WHEN ... END
 WHERE id = $4
```
  - 예외: sent_count가 NULL/0인 과거 캠페인(worker 이전 세대)은 `sent_count = COALESCE(NULLIF(sent_count,0), $1::int + $2::int)`로 fallback(화면 0 표시 방지).
- [ ] 6-3. 취소 경로(campaign-lifecycle:222-234) counts 덮어쓰기 중단 — `fail_count = COALESCE(target_count, sent_count, 0), success_count = 0` 제거, status·cancelled_* 만 변경(실측 counts 보존 — 취소 전 발송분이 있으면 그대로 진실):
```sql
UPDATE campaigns SET
  status = 'cancelled', cancelled_by = $1, cancelled_by_type = $2,
  cancel_reason = $3, cancelled_at = NOW(), updated_at = NOW()
 WHERE id = $4
```
  - 소비처 영향 grep: `fail_count` 를 읽어 "취소 표시"에 쓰는 화면이 있는지 frontend/backend grep — status='cancelled'로 표현되는지 확인 후 적용. 의존 발견 시 그 화면을 status 기준으로 정정(목록 보고).
  - campaign_runs(:237-244) 동일 적용.
- [ ] 6-4. tsc 0 + 회귀: 발송결과 요약 산식(results.ts 508/688)이 sent_count를 어떻게 쓰는지 정독 — 대기 = sent_count − success − fail 자연 도출 확인(폴라형 227이 '대기'로 보이게 됨)

## Task 7 — 정제 제외·skip 사유 기록 (근원 C)

**Files:** Modify `packages/backend/src/utils/direct-send-worker.ts:70-91, 139-171`

- [ ] 7-1. 정제 DELETE rowCount 수집 + 청크 skip 합산 + 완료 시 send_config 기록:
```ts
let unsubRemoved = 0, dupRemoved = 0;
if (processed === 0) {
  if (cfg.unsubFilterEnabled !== false) {
    const r1 = await query(`DELETE FROM campaign_send_staging s USING unsubscribes u WHERE ...`, [...]);
    unsubRemoved = r1.rowCount || 0;
  }
  if (cfg.dedupEnabled !== false) {
    const r2 = await query(`DELETE FROM campaign_send_staging WHERE ctid IN (...)`, [...]);
    dupRemoved = r2.rowCount || 0;
  }
}
// 루프에서: chunkSkipped += (chunkRes.rows.length - result.sentCount);
```
완료 UPDATE(:161-164)에 exclusions 병합:
```ts
const exclusions = { unsub: unsubRemoved, dup: dupRemoved, skipped: Math.max(0, processed - sent - unsubRemoved - dupRemoved), recordedAt: new Date().toISOString() };
// jsonb_set(COALESCE(send_config,'{}'::jsonb), '{exclusions}', $N::jsonb) 를 기존 UPDATE에 추가
```
  - 재시작(idempotent) 주의: processed>0 재진입 시 정제 카운트는 0 — 기존 exclusions 보존(jsonb_set은 키 단위라 첫 기록 후 재진입 시 `send_config->'exclusions' IS NULL`일 때만 기록).
- [ ] 7-2. tsc 0

## Task 8 — 발송통계·발송결과 출처 통일 (3층 고정)

**Files:** Modify `packages/backend/src/routes/admin.ts`(발송통계 본문+엑셀 — exportResultMap 출처 포함) · `packages/backend/src/routes/results.ts`(요약/목록)

- [ ] 8-1. 정독: admin.ts 발송통계 쿼리에서 exportMetaResult/exportResultMap/exportSplitMap이 각각 PG 기록인지 MySQL 실측인지 출처 표 작성(구현 보고에 첨부).
- [ ] 8-2. 통일 원칙 적용 — 대상=①target_count(차감 기준), 전송=②sent_count(적재 실측), 성공/실패=③MySQL 실측, 대기=②−③(음수 방지 0 clamp). 컬럼별 출처가 같은 층만 합산하도록 수정.
- [ ] 8-3. results.ts 상단/캠페인정보/상세/엑셀 4표면이 같은 층을 읽는지 교차 확인(7-1 표시 경로 전수 확인). 다른 층을 읽는 표면 목록화 → 같은 층으로 통일.
- [ ] 8-4. tsc 0 + frontend 영향 grep(전송건수 표시 컴포넌트가 sent_count 외 다른 값을 읽는지)

## Task 9 — 자동발송 워커 영구 가드 + 코드 92 라벨

**Files:** Modify `packages/backend/src/utils/auto-campaign-worker.ts:1423` 직후 · `packages/backend/src/utils/sms-result-map.ts:53` 부근

- [ ] 9-1. runAutoCampaignWorker 최상단 영구 가드:
```ts
// ★ 2026-06-11 영구 폐기 봉인 — D188 폐기 후에도 active 잔존이 매주 실행되던 사고(인비토) 차단.
//   레코드가 다시 active가 되어도 실행되지 않는다. 데이터는 보존(슈퍼관리자 수동 조치용 PUT/DELETE 라우트 유지).
const AUTO_CAMPAIGN_RETIRED = true;
if (AUTO_CAMPAIGN_RETIRED) return;
```
  - stuck 복원/문안 생성/스팸테스트/발송 전 단계가 함께 봉인됨(담당자 알림 문자도 중단 — 인비토 요청 사항).
- [ ] 9-2. 코드 92 등록: `92: { label: '기타 실패(코드 92)', type: 'fail' },` — QTmsg 매뉴얼 의미 확인 후 라벨 정정(확인 전에도 fail 분류는 현행 unknown→fail과 동일해 안전).
- [ ] 9-3. tsc 0 + 전체 vitest 회귀

## Task 10 — 검증 (배포 후, Harold 실행)

- [ ] 10-1. 실측 1건 시나리오(6원칙 ⑤ — 발송·돈): 테스트 회사로 소량 직접발송 1건(수신거부 1 + 중복 1 포함, N건 등록) →
  1) 차감 = N건 확인(balance_transactions)
  2) send_config.exclusions = {unsub:1, dup:1} 확인
  3) sent_count = N−2 (적재 실측) / 화면 전송 = N−2 / 대기 = N−2−결과도착
  4) 결과 도착 후 환불 누적 = N − 성공(= 미적재 2 + 실측 실패) — calcRefundDue 산식 그대로인지 balance_transactions 대조
- [ ] 10-2. 취소 시나리오: 소량 예약 1건 → 취소 → 잔존 0 + (픽업 행 있으면 9999) + counts 보존 확인
- [ ] 10-3. 정산 교차: 에이치피오 6월 마감 미리보기에서 87,014 건이 성공 84,259로 잡히는지(전 라인 합집합 효과)
- [ ] 10-4. P3 전수 SQL(별도 단계): 새 산식 기준 과거 미환불 후보 — 캠페인별 (deduct합/단가 − MySQL성공 − 대기) × 단가 > refund합 목록 → 검토 후 sweep 윈도우 한시 확장으로 일괄 소급

## 작업 순서·원칙

1. Task 1→9 순차(하나씩 — 병렬 금지). 각 Task 종료마다 tsc 0 + 해당 grep 증거 확보.
2. 코드 92 외 전 Task는 기존 CT 수정 — 인라인 신설 0. 신규 CT는 refund-calc.ts(순수)·getAllBulkSmsTables(sms-queue 내부) 2개뿐.
3. 종료 직전 /codex:adversarial-review (돈·환불 — 의무) → 이슈 정정 → 표준 종료 멘트.
4. 배포 = backend build:safe + pm2 restart (Harold 직접). frontend는 Task 8 영향 grep 결과에 따라 결정.
