# AI 크레딧 후불 overage 월말 청구 설계 (점검 #3)

> 2026-06-01. 점검 3순위. 후불 overage(한도 음수 사용분)를 월 마감 솔루션 이용요금에 자동 합산.
> 청구 흐름(Harold 확정): 매월 1~말일 취합 → 발송 결과 확정 후 익월 7일 거래내역서 + 사용월 말일자 세금계산서. AI 크레딧 = 솔루션 이용요금 항목(문자요금과 별개, 통합 표시 무방).
> 기본 `postpaid_overage_limit`=0 → 현재 실제 발생 0(미래 대비). DB ALTER 1컬럼(DEFAULT 0, 회귀 0).

## 1. 문제

- 후불사가 한도까지 음수로 쓴 overage 사용분이 billing 월말 청구에 안 잡힘(현재 충전 `ai_credit_requests`만 합산).
- 청구액 = 초과분(shortfall)만(기본 제공분은 요금제에 포함)인데, `ai_credit_transactions`는 차감 총액(`amount`)만 남기고 초과분을 따로 안 적음(`bucket='overage'` 표시뿐).
- `base`는 월 리셋 시 음수가 소멸 → 리셋 전 월 마감에 반드시 집계해야 함.

## 2. 해법 (A — 차감 시 초과분 기록)

### 2-1. DB (Harold 실행 — information_schema 검증 먼저)
```sql
-- 존재 확인
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ai_credit_transactions' AND column_name = 'overage_credits';
-- 없으면
ALTER TABLE ai_credit_transactions ADD COLUMN overage_credits integer DEFAULT 0;
```

### 2-2. 차감 (`_deductWithClient`)
- 이미 계산하는 `shortfall`(한도 음수로 넘어간 크레딧)을 INSERT 시 `overage_credits`로 기록.
- `shortfall=0`(기본분·구매분으로 충당)이면 `overage_credits=0` → 기존 차감 영향 0.

### 2-3. billing (`generate`)
- 충전 집계 다음에 추가:
  ```sql
  SELECT COALESCE(SUM(overage_credits),0) AS oc FROM ai_credit_transactions
   WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
     AND created_at >= $2::date AND created_at < ($3::date + interval '1 day');
  ```
- `overageCount = oc`, `overageSupply = overageCount × CREDIT_UNIT_PRICE(2000)`.
- `aiCreditCount += overageCount`, `aiCreditSupply += overageSupply`(충전분과 통합) → 기존 subtotal 합산식이 자동 반영.
- **이중 방지**: 기존 기간 겹침 중복 차단(`billing.ts:138`, 겹치면 409)으로 월 1회만 생성 → `created_at` 기간 집계가 다음 달과 겹치지 않음. 별도 `billed` 플래그 불필요.

### 2-4. 표시 (거래내역서·세금계산서)
- 기존 `ai_credit_count`/`ai_credit_supply` 줄에 충전 + 초과사용을 통합 표시. 라벨을 "AI 크레딧 충전" → "AI 크레딧"으로 정리(충전·초과 혼재 반영). 단가 2,000원 동일이라 수량×단가=공급가 일관.
- 별도 계산서·별도 컬럼 없음. 솔루션 이용요금 항목.

## 3. 검증
- 단위(`ai-credit-tx.verify` 확장): 후불 한도 음수 차감 시 `overage_credits=shortfall` INSERT / 기본분·구매분 충당 시 `overage_credits=0` / 선불은 overage 0.
- 기존 회귀(tx/calc/adjust/safe) GREEN 유지.
- backend tsc 0. billing 통합 집계는 실DB라 배포 후 Harold 확인.

## 4. 안전망
- `db_alter_safety_net`: overage_credits 활용 경로(billing generate) catch에 `column does not exist` → 503(기존 패턴 정합).
- 컬럼 DEFAULT 0 → 기존 차감·충전·billing 회귀 0. 기본 한도 0이라 당장 값도 0.

## 5. 배포 순서
1. `information_schema` 검증 SQL → Harold 결과 확인.
2. ALTER 실행(Harold).
3. 코드(`_deductWithClient` overage_credits 기록 + billing 합산) + tsc + 단위검증.
4. tp-push → backend build:safe + pm2 restart all.

## 6. 영구 원칙
- db_column_verify_before_code: `overage_credits` information_schema 검증 후 코드(tsc ≠ SQL 유효).
- 돈 = 정확 집계(shortfall만) + 이중 방지(기간 겹침) + 단가 백엔드 상수.
- no_inline_duplication: 집계는 billing generate, 단가는 ai-credit-calc 상수. 모델명·박-단어 0.
