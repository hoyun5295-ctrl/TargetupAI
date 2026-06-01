# AI 크레딧 차감 무결성 보강 설계 (점검 #1)

> 2026-06-01. 크레딧 시스템 점검에서 발견한 1순위(돈 직결). brainstorming 거쳐 확정.
> 결론: 차감 트랜잭션은 이미 원자적·멱등이므로, **그 실행을 분리·재시도·추적으로 끝까지 보장**한다. DB 스키마 변경 0.

---

## 1. 문제

`callAIWithFallback`(services/ai.ts)의 1차 경로(146~173)·fallback 경로(215~243)에서
`setCachedResponse`(캐시)·`recordAiCall`(통계)·`deductCredit`(차감)이 하나의 `try`에 묶이고,
`catch(trackErr)`가 `console.warn`(stderr)으로 조용히 넘긴다(best-effort).

또한 `ai-orchestrator.ts`(298·563)·`dm.ts`(333)의 묶음 진입점은 `deductCredit`을 `try` 없이 `await`한다 — 차감 실패 시 throw가 전파되어 이미 끝난 비싼 AI 결과를 통째로 폐기하고 에러를 반환하면서 차감도 0(롤백). ai.ts와 증상은 반대(누수 vs 결과 폐기)지만 "차감 실행이 보장되지 않는다"는 뿌리는 같다. 이 3곳은 `aiCallLogId` 없이 차감하므로 fallback 멱등키 대상이다.

## 2. Root cause (3겹)

1. **묶임** — 차감이 통계 best-effort catch에 묶여, 통계가 먼저 실패하면 차감이 아예 실행되지 않고, 차감만 실패해도 stderr에 묻혀 추적 불가.
2. **무재시도** — 차감 실패의 대부분인 일시 오류(deadlock·연결·잠금 경합)에 재시도가 없어 곧 영구 누락이 된다.
3. **멱등 구멍** — `recordAiCall` 실패로 `aiCallLogId`가 null이면 `buildIdempotencyKey`가 null을 반환 → `_deductWithClient`가 dup 체크를 건너뛰고 `idempotency_key=null`로 INSERT(ON CONFLICT 미발동) → 재시도 시 이중 차감 가능.

## 3. 해법 (DB 변경 0)

- 차감을 통계와 **분리**한다(캐시·통계는 기존대로 best-effort, 차감은 독립 경로).
- 차감 실행을 감싸는 CT 함수 `deductCreditSafe`를 신설한다 — 재시도 + 명시 로그 + 잔액부족 구분.
- `aiCallLogId`가 없을 때는 **호출당 고정 fallback 멱등키**를 부여해 재시도 이중 차감을 차단한다.

### 3-1. `_deductWithClient` / `deductCredit` — 멱등키 주입 허용

- `DeductOpts`에 `idempotencyKey?: string` 추가.
- `_deductWithClient`: `const idemKey = opts.idempotencyKey ?? buildIdempotencyKey(opts.source, opts.aiCallLogId);`
  - 기존 동작(aiCallLogId 기반)은 그대로 — `idempotencyKey` 미전달 시 변화 없음(회귀 0).
  - `ai_call_log_id` 컬럼 값은 종전대로 `aiCallLogId`(null 가능). 멱등키만 분리.

### 3-2. `deductCreditSafe` (ai-credit.ts 신설 — ai.ts 인라인 금지)

```
deductCreditSafe({ companyId, cost, source, aiCallLogId, createdBy }): Promise<void>
  - companyId 없음 / cost<=0 → return (no-op)
  - idempotencyKey = aiCallLogId ? undefined : `fallback:${companyId}:${source}:${Date.now()}`
      (통계 실패로 logId 없을 때만 호출당 1회 고정 — 재시도 루프 내내 동일)
  - for attempt 1..3:
      try { await deductCredit({ ...opts, idempotencyKey }); return; }
      catch (err):
        - InsufficientCreditError → console.log('[CREDIT][SKIP] ...') 후 return  (정상 차단, 재시도 무의미)
        - attempt<3 → await sleep(attempt*200ms); continue   (200·400ms 백오프)
        - 최종 → console.log('[CREDIT][MISS] company=.. source=.. cost=.. aiCallLogId=.. attempts=3 err=..')
  - throw 안 함 — AI 응답 반환을 막지 않는다(이미 성공한 호출).
```

- 재시도는 `deductCredit`이 원자·멱등이라 안전(중복 차감 0).
- 로그는 `console.log`(stdout) — LESSONS_BACKEND "console.warn(stderr) 진단 의존 금지" 준수. `[CREDIT][MISS]`로 grep·모니터링.

### 3-3. `callAIWithFallback` 2곳 — 분리 적용

```
if (companyId && cacheKey && text) {
  let aiCallLogId = null;
  try { setCachedResponse(...); aiCallLogId = await recordAiCall(...); }
  catch (e) { console.warn('[AI] 캐시/통계 기록 skip:', e?.message); }   // best-effort 유지
  if (creditCost > 0) {
    const { deductCreditSafe } = await import('../utils/ai-credit');
    await deductCreditSafe({ companyId, cost: creditCost, source, aiCallLogId, createdBy: userId });
  }
}
```

## 4. 변경 파일 (5개, DB 0)

1. `utils/ai-credit-tx.ts` — `DeductOpts.idempotencyKey?` + `_deductWithClient` 멱등키 분기.
2. `utils/ai-credit.ts` — `deductCredit`가 `idempotencyKey` 전달 + `deductCreditSafe` 신설.
3. `services/ai.ts` — 1차·fallback 경로 2곳 통계/차감 분리 + `deductCreditSafe` 호출.
4. `services/ai-orchestrator.ts` — orchestrate·orchestrateWithAI 묶음 진입점 2곳 `deductCredit` → `deductCreditSafe`(import 교체). 차감 실패 시 throw로 결과를 폐기하던 것을 재시도+로그로 전환(결과는 정상 반환). `aiCallLogId` 없어 fallback 키 적용.
5. `routes/dm.ts` — DM 묶음 진입점(oneShot 5크레딧) `deductCredit` → `deductCreditSafe`(import 교체).

## 5. 검증

- 단위(`__tests__/ai-credit-safe.verify.ts` 신규, mock client): 재시도 성공·일시오류 후 성공·3회 실패 후 MISS 로그·InsufficientCredit SKIP·fallback 멱등키 이중차감 0.
- 기존 `ai-credit-calc/tx/adjust.verify` 회귀 GREEN.
- backend tsc 0 + 자가 grep(박-단어·모델명·native dialog 0).
- 운영 검증·배포 = Harold.

## 6. 범위 밖 (의도적)

- 자동 보정 워커 + `ai_call_log.credit_cost` ALTER = 보류. 차감이 원자·멱등이고 재시도+추적으로 누수 실질 0이며, 영구 실패는 코드·스키마 버그라 워커가 재차감해도 동일 실패(자동 복구 불가) → 로그로 발견·수정이 유일. 실제 미차감이 운영에서 관측되면 그때 별도.

## 7. 영구 원칙 준수

- 돈 = 트랜잭션(기존) + 멱등(기존+fallback 보강) + 재시도(신규) + stdout 추적(신규).
- no_inline_duplication: 재시도/로그는 ai-credit.ts CT 단일, ai.ts 인라인 금지.
- db_column_verify: DB 변경 없음(신규 SQL 0).
- 모델명 UI 노출 0 · native dialog 0 · 박-단어 0.
