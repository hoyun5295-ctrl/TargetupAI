# AI 크레딧 충전·수동지급 멱등 보강 설계 (점검 #2)

> 2026-06-01. 크레딧 점검 2순위(돈 직결). **기간계 운영 중 — 절대 안전 최우선.**
> 원칙: 기존 충전 로직은 한 줄도 바꾸지 않는다. 멱등키가 있을 때만 중복 확인을 얹는다(하위 호환, 회귀 0).

---

## 1. 문제

- 선불 충전 `rechargePrepaid`: 멱등키가 `recharge:${companyId}:${Date.now()}:${random}` — 매 호출 달라 멱등 아님. 더블클릭·네트워크 재전송 시 잔액 2배 차감 + 크레딧 2배.
- 슈퍼관리자 수동 지급 `adjustCreditWithClient`: 멱등키 `${type}:${companyId}:${time}:${random}` — 동일. 이중 지급 가능.
- 프론트 버튼 disabled(`submitting`)는 더블클릭 일부만 막고 재전송은 못 막음.
- (후불 요청=중복 pending 차단, 후불 승인=requestId+status 차단 — 이미 안전. 대상 아님.)

## 2. 해법 — 클라이언트 멱등키 + 서버 중복 확인 (결제 API 표준)

### 2-1. 절대 안전 = 하위 호환 (운영 0 영향)

- `rechargePrepaid`·`adjustCreditWithClient`·`adjustCredit`에 `idempotencyKey?: string` **선택** 파라미터 추가.
- **키 미전달 시**: 기존과 100% 동일 — dup 체크 skip + 기존 random 키로 INSERT. 구프론트·누락·캐시 어느 경우든 현 동작 보존(회귀 0).
- **키 전달 시**: 아래 dup 체크 활성.

### 2-2. 서버 중복 확인 (키 있을 때만)

`rechargePrepaid` 트랜잭션 순서(기존 흐름에 한 단계만 삽입):
```
BEGIN → companies FOR UPDATE → billing_type 확인(기존)
  → [신규] idempotencyKey 있으면: SELECT 1 FROM ai_credit_transactions WHERE idempotency_key=$key
            → 있으면 ROLLBACK + throw RechargeError('이미 처리된 충전입니다.', 'DUPLICATE_RECHARGE')
  → balance < total 확인(기존) → 차감 → 지급 → tx INSERT(idempotency_key = key ?? 기존random) → requests INSERT → COMMIT
```
- FOR UPDATE 뒤에 dup 체크(동시 도착도 직렬화) — #1 `_deductWithClient`와 동일한 검증된 순서.
- `adjustCreditWithClient`도 같은 자리(FOR UPDATE 후)에 동일 dup 체크.

### 2-3. 프론트 (멱등키 생성)

- `CreditRechargeModal`: 모달 mount 시 `useRef`에 `crypto.randomUUID()` 1회 생성 → `submit` body `{ credits, idempotencyKey }`. 더블클릭·재전송은 같은 키. 성공(done) 후 모달 닫힘 → 재충전은 새 모달=새 키(정당한 반복 허용).
- 슈퍼관리자 지급 모달(AdminDashboard): 동일하게 키 생성 + `credit-adjust` body 포함.
- `DUPLICATE_RECHARGE` 응답 시: 에러가 아니라 "이미 충전 처리됨"으로 done 표시 + 잔액 새로고침(이중 0, 사용자 혼란 최소).

### 2-4. endpoint

- `POST /my-credit/recharge`: `req.body.idempotencyKey`(string, 선택) → `rechargePrepaid`로 전달.
- `POST /companies/:id/credit-adjust`: `req.body.idempotencyKey` → `adjustCredit`로 전달.

## 3. 변경 파일 (DB 0 — 기존 `ai_credit_transactions.idempotency_key` UNIQUE 활용)

1. `utils/ai-credit-recharge.ts` — `rechargePrepaid` 멱등키 파라미터 + dup 체크 + INSERT 키.
2. `utils/ai-credit-tx.ts` — `AdjustOpts.idempotencyKey?` + `adjustCreditWithClient` dup 체크 + INSERT 키.
3. `utils/ai-credit.ts` — `adjustCredit`가 `idempotencyKey` 전달.
4. `routes/companies.ts` — recharge endpoint 키 수신.
5. `routes/admin.ts` — credit-adjust endpoint 키 수신.
6. `components/credit/CreditRechargeModal.tsx` — 키 생성·전송 + DUPLICATE done 처리.
7. AdminDashboard 지급 모달 — 키 생성·전송(수정 단계에서 위치 확정).

## 4. 검증 (백엔드 먼저 → 프론트)

- 단위(`ai-credit-recharge-idem.verify.ts` 신규, mock client): ① 키 있고 dup 없음 → 정상 충전 ② 같은 키 두 번째 → DUPLICATE_RECHARGE, 차감/지급 0 ③ 키 미전달 → 기존 동작(dup 체크 skip) ④ FOR UPDATE 뒤 dup 체크 순서.
- 기존 회귀(tx/calc/adjust/safe) GREEN 유지.
- backend tsc 0 → 백엔드 안전 확인 후 프론트 → frontend tsc 0 + 자가 grep.
- 운영 검증·배포 = Harold.

## 5. 단계 (기간계 안전)

1. 백엔드(CT dup 체크 하위호환 + endpoint) → 단위검증·tsc·회귀 GREEN 확인.
2. 프론트(키 생성·DUPLICATE done) → frontend tsc.
3. 통합 보고 → Harold 배포.

## 6. 영구 원칙

- 돈 = 트랜잭션 + 멱등 + FOR UPDATE 직렬화(기존 패턴 재사용).
- 하위 호환으로 운영 회귀 0 — 키 없으면 기존 동작.
- no_inline_duplication: dup 체크는 CT 내부, endpoint·라우트 인라인 0.
- db_column_verify: 신규 컬럼/테이블 0(기존 UNIQUE 활용).
- 모델명·박-단어·native dialog 0.
