# 몰별 수신동의·수신거부 격리 설계서 (2026-09-22)

> 발단 = 이에스페이먼트(우커머스 4몰 · 몰별 사용자 espayment1~4) 첫 실데이터 가져오기.
> 결정 = 2026-09-22 브레인스토밍 회의(기획·백엔드·프론트엔드·회의론자 · `status/COLLAB.md` §1) 수렴안 + Harold 승인.
> 선행 문서 = `docs/2026-09-18-mall-integration-user-scope-design.md`(D92 · 폰당 1행 · 분류코드 축) · `docs/2026-09-14-woocommerce-integration-design.md` §5-0-1.

---

## 0. 한 줄

**한 몰에서의 동의·거부는 다른 몰에 어떤 영향도 주지 않는다.** 고객은 폰당 1행으로 두고, 몰이 받은 수신동의의 진실은 그 몰의 소속 행(`customer_stores`)이 단독으로 갖는다. 회사 공통 `customers.sms_opt_in` 은 몰 동의 회사에서 발송 자격에서 퇴역한다. 수신거부의 등록·삭제·동기화는 격리 회사에서 그 계정(+관리자) 행만 건드린다.

## 1. 확정 전제 (Harold 2026-09-22)

| # | 전제 |
|---|---|
| H1 | 수신동의의 법적 단위 = **몰**. 고객사가 자기 필요로 몰을 연동하는 것이므로 몰 단위로 못 박는다 |
| H2 | **한 몰에서의 동의·거부·고객 상태가 다른 몰에 어떤 영향도 주면 안 된다**("일본이모는 수신거부를 해도 이로이로도쿄는 안 했을 수 있다") |
| H3 | 수신거부 격리 스위치(`companies.user_isolation_enabled`)는 Harold 가 켠다 — **단 §4 수신거부 입구 격리가 배포된 뒤에**(지금 켜면 등록만 좁아지고 삭제는 회사 전체라 더 위험하다) |
| D1 | 관리자(회사 전체) **광고** 발송은 몰을 고르게 한다(S7). "전체 1통 합치기" 없음. 정보성은 몰 무관 허용 |
| D2 | 080 은 몰마다 번호가 달라야 몰 단위로 갈린다(`users.opt_out_080_number` 계정별 자리는 이미 있다). 번호가 하나면 코드로 못 가른다 — 고객사 확인 사항 |
| **H2-1 (0922 후속 · 고객사 결정)** | 이에스페이먼트는 **080 번호 1개 공유 + 수신거부는 회사 전체 공유**를 택했다(Harold 전달 · 고객사 관리자에 등록된 수신거부를 4몰이 그대로 쓴다). 따라서 **H2 는 수신동의에만 적용**하고 수신거부는 종전 broadcast 그대로다. **격리 스위치 OFF 유지**(H3·S5 의 "켠다" 단계 폐기) · §4-3 격리 ON 분기 4곳은 이 고객사에서 타지 않는다(코드는 그대로 둔다 · 다른 고객사가 몰별 수신거부를 원하면 스위치만 켜면 된다). ENV ON 뒤에도 080·수동 수신거부 제외는 `unsubscribes(user_id)` 안티조인(`campaigns.ts:635·879·3045`)이 종전대로 한다 — 등록이 회사 전 계정 행에 broadcast 되므로 4몰 계정 모두 제외된다(고객 행 `customers.sms_opt_in` 과 무관) |

## 2. 실측 (2026-09-22)

- 이 회사 고객 327,632명 중 2몰 소속 3,723 · 3몰 6(이로이로도쿄 1몰 완주 + 일본이모 초반 시점 — 3몰 완주 뒤 다시 잰다).
- 4몰 전부 같은 회사 · 몰마다 `meta.store_code`(이로이로도쿄·일본이모·렌즈고고·렌즈007) · 사용자 `store_codes` 1:1 · 관리자 `espayment` 는 코드 없음.
- `companies.user_isolation_enabled = false`(수신거부 1건이 회사 전 계정에 broadcast 중).
- 몰 수신동의 원본 = 회원·회원주문 메타 `mssms_agreement_label` = `YES`/`NO`.
- **미실측(착수 전 게이트)**: `customer_stores` 의 실제 컬럼·유니크·인덱스(SCHEMA.md 에 표 절이 없다 — 코드가 아는 것은 `ON CONFLICT (customer_id, store_code)` 뿐) · 4계정 `opt_out_080_number` · 그 회사 `plan_id`.

## 3. 왜 "몰별 고객 행 분리(B안)"가 아닌가

H2 를 실제로 깨는 경로는 고객 표가 아니라 아래 다섯이고, **행을 나눠도 그대로 남는다**(전부 phone 기준).

| # | 경로 | 자리 |
|---|---|---|
| 1 | 수동 등록 뒤 그 번호의 `customers.sms_opt_in` 을 회사 전체에서 끈다(사본 2벌) | `routes/unsubscribes.ts:104~133`·`:350` · `utils/unsubscribe-helper.ts:68~76` |
| 2 | 삭제가 회사 전 계정 행을 지우고 동의를 회사 전체에서 되살린다(격리 스위치 무시 · **과발송 방향**) | `routes/unsubscribes.ts:556~568` · `utils/unsubscribe-helper.ts:461~495` |
| 3 | 080 콜백이 끝에 회사 전체 동의를 끈다 · 회사 레벨 080 은 활성 계정 전원에 등록 | `utils/unsubscribe-helper.ts:290~307`·`:388~391` |
| 4 | 일괄 배정이 옛 `customers.store_code` 를 읽는다(주석은 "getStoreScope 와 동일 판정"이라 적혀 있으나 다르다) | `utils/unsubscribe-helper.ts:110~142` |
| 5 | 자사몰 적재가 기존 고객의 동의를 나중에 들어온 몰 값으로 덮는다 | `utils/cdp-identity.ts:221`·`:390` |

B안 비용: `FROM customers` 261곳 + `COUNT(*)` 73곳의 축 판정 · 폰 유니크 DROP(롤백 불가) · upsert arbiter 3곳(0814 이새 164건 재현) · `customers_unified` 뷰가 몰 행을 접어 상세 404 · 관리자 발송 2통·2건 차감 · 여정 2회 진입. 놓쳤을 때 방향이 **중복 발송·이중 과금**(회수 불가). 수렴안은 고칠 자리가 좁고 놓쳤을 때 "덜 보낸다".

## 4. 구조

### 4-1. "몰 동의 회사"와 "몰 동의 분류코드"의 판정 — CT `utils/mall-consent.ts`

- **몰 동의 분류코드** = 자사몰 연동 행(`company_integrations`)의 `meta.store_code` — **해제(revoked)된 연동도 포함**(Codex R1: 해제해도 그 몰의 동의·거부는 소속 행에 남는다. 빼면 그 코드의 발송이 고객 행 판정으로 돌아가 몰에서 거부한 사람이 다시 대상이 된다). 1개 이상이면 **몰 동의 회사**.
- ⛔ `customer_stores` 행이 있다는 것만으로 판정하지 않는다 — 업로드·싱크로 브랜드 체계를 쓰는 기존 고객사(이새 등)는 몰 동의 축이 없다. 그 회사들은 동작이 1바이트도 달라지지 않는다.
- 읽기 강제는 ENV `MALL_CONSENT_ENFORCE_COMPANY_IDS`(빈 값 = 아무도 아님 · `*` = 몰 동의 회사 전부)로 회사 단위로 켠다. 꺼져 있을 때도 부팅 로그에 상태를 남긴다.

### 4-2. 쓰기

| 자리 | 지금 | 바뀜 |
|---|---|---|
| `identifyCustomer` (`input.storeCode` 있음 + 동의 값 있음) | 고객 행 `sms_opt_in` 을 덮는다 | **올림 동결 · 내림 반영** — 고객 행 `sms_opt_in` 을 올리지 않는다(신규 INSERT 는 기본 false). **철회(false)는 고객 행에도 내린다**(Codex R1: ENV 가 켜지기 전과 관리자·여정·자동발송은 아직 고객 행을 읽는다 — 철회를 버리면 거부한 사람에게 나간다). 몰 동의의 진실은 소속 행 `upsertStoreConsent`(`sms_opt_in`·`consent_source`·`consent_at`) · 소속 행 생성 뒤에 쓴다 · **그 쓰기 실패는 삼키지 않는다**(웹훅 재처리 · 가져오기는 그 건만 failed) |
| `identifyCustomer` (`storeCode` 없음) | — | 불변(단일몰·무분류 회사 전부) |
| 컬럼 미존재(DDL 전) | — | `upsertStoreConsent` 가 42703 을 삼키고 1회 경고 로그 → 적재는 계속(동결은 유지) |

### 4-3. 수신거부 입구 (격리 ON 회사에서만 달라진다 · OFF 회사는 불변)

| 입구 | 바뀜 |
|---|---|
| 수동·업로드 등록 뒤 고객 행 동의 내림(`routes/unsubscribes.ts` 사본 2벌) | 격리 ON 이면 내리지 않는다 |
| 삭제 `DELETE /:id` | 격리 ON 이면 **본인 행만** 지운다. **관리자 행은 지우지 않는다**(Codex R1: 등록 사본인지 관리자 자신의 독립된 080 거부인지 행만으로 구별할 수 없다 — 남기는 쪽은 덜 보낼 뿐이다). 고객 행 동의를 되살리지 않는다 |
| 슈퍼관리자 `deleteUserUnsubscribes` | 격리 ON 이면 그 사용자 행만 · 되살림 없음 |
| 080 콜백 | 격리 ON 회사는 끝의 `syncCustomerOptIn` 을 돌리지 않는다. 계정 매칭은 그대로(`users.opt_out_080_number`) |
| 일괄 배정(`registerBulkCompanyUserUnsubscribes`) | 이번에 안 연다(싱크·업로드 전용 · 자사몰 고객은 `store_code` NULL 이라 배정되지 않음 = 닫힌 방향) — §7 별건 |

### 4-4. 읽기 (ENV 로 켠 회사 · 분류코드 사용자 경로)

- 발송 자격 조각은 CT `buildSendConsent(...)` 가 만든다. 분류코드 사용자의 코드가 몰 동의 분류코드면:
  - 고객 행 조건 `c.sms_opt_in = true` 를 **뺀다**(퇴역) 대신
  - 범위 서브쿼리에 소속 표 별칭을 달고 `AND mcs.sms_opt_in = true` 를 넣는다 → **NULL·행 없음 = 모름 = 제외**. 별칭으로 한정하는 이유(Codex R1) = 한정하지 않으면 컬럼이 없는 환경에서 PostgreSQL 이 바깥 `customers.sms_opt_in` 으로 해석해 오류 없이 통과시킨다.
  - 사용자 코드에 몰 동의가 아닌 코드가 섞여도 옛 판정으로 되돌리지 않는다(그 코드의 고객은 제외 · 경고 로그). 모르는 모양의 서브쿼리에 강제가 걸리면 `FALSE` 로 닫는다.
- 그 밖(관리자 · 몰 동의가 아닌 코드 · ENV 꺼짐 · 무분류 회사)은 지금과 **같은 문자열**.
- 1차 배선 = 실제 발송이 나가는 두 자리와 그 건수: `routes/campaigns.ts` `POST /:id/send` · 직접 타겟(수신자 조회·건수). 표시·건수 화면(고객 목록 · `customers.ts` filter-count·extract · `ai.ts` 7곳 · `targets.ts`)은 S6-b.

### 4-5. 거짓 숫자 (ENV 와 무관 · 즉시)

- **0922 구현**: `routes/campaigns.ts` 캠페인 생성 시 `target_count` 가 발송(`POST /:id/send`)과 같은 분류 범위·같은 동의 조각으로 센다 · 수신자 미리보기(예약·초안)도 같은 조각.
- **S6-b 로 넘김**: `routes/targets.ts`(이메일·DM·인앱·카카오 대상 미리보기 · 범위 0건). 숫자를 내는 SQL 이 CT `countTargetByFilter` 한 벌이고 그 채널들의 실발송 경로가 범위를 어떻게 거는지 먼저 대조해야 한다("세는 곳 = 뽑는 곳 = 보내는 곳" `utils/operator-audience.ts:130~132`). 세는 쪽만 먼저 좁히면 거꾸로 어긋난다.

## 5. 끝까지 갈린 지점과 선택

| 지점 | 갈림 | 선택 · 이유 |
|---|---|---|
| 과도기 회사 값 | 기획·백엔드 = "하나라도 미동의면 미동의(AND)" / 회의론자·프론트 = 반대 | 회의 선택 = 동결 → **Codex R1 로 정정: 올림만 동결 · 철회(false)는 고객 행에도 내린다.** 완전 동결은 ENV 가 꺼져 있는 동안 철회가 발송에 반영되지 않는다(과발송 방향). 내림은 "덜 보낸다"뿐이고, 몰 사용자 발송은 ENV ON 뒤 소속 행만 보므로 H2 는 그 경로에서 성립한다. 관리자·여정·자동발송이 읽는 고객 행 값은 보수적(하나라도 거부면 거부)으로 남는다 — S6-b·S7 에서 그 읽기들이 몰 축으로 옮겨지면 이 내림도 걷는다 |
| 몰 동의 기록이 없는 고객(모름) | 프론트 = 회사 기본값으로 발송 포함 / 회의론자 = 제외 | **제외 + 발송 확인 창에 「몰 동의 미확인 N명 제외」**. H1 아래 모름은 동의가 아니다 · 메타키 오타 1건이 33만 전수 발송이 되는 구조를 둘 수 없다 |

## 6. 단계 (각 단계 = 읽는 곳 0 으로 먼저 · 실데이터는 재기동 없는 스크립트로 증명 · 재기동은 업무시간 밖 묶음)

| 단계 | 내용 | 코드 | 실데이터 증명 |
|---|---|---|---|
| S0 | 3몰 가져오기 보류 유지 · 실측 4건(`customer_stores` 구조 · 080 번호 · `plan_id` · 격리값) | — | Harold SQL |
| S1 | 동결(몰 적재가 고객 행 동의를 안 건드림) | 0922 구현 | 한 몰 스크립트 재실행 전후 `customers.sms_opt_in` 분포 동일 |
| S2 | `customer_stores` 실측·SCHEMA 등재 → 컬럼 3 + 인덱스(읽는 곳 0) | DDL(§8) | `information_schema` |
| S3 | 쓰기 배선(`upsertStoreConsent`) | 0922 구현 | 한 몰 스크립트 완주 → 소속 행 동의 분포(동의/거부/모름) |
| S4 | 백필 = 4몰 `run-woo-backfill.ts` 재실행(재기동 없음 · 이미 덮인 고객도 몰별 값이 몰 REST 에서 다시 들어온다) | 기존 스크립트 | 몰별 동의 수 · 2몰 이상 소속 수 재측정 |
| S5 | 수신거부 입구 격리 → **그 뒤에** 격리 스위치 ON | 0922 구현 | 시험 계정 2개로 등록·삭제 · 다른 계정 행 불변 |
| S6 | 읽기 전환(ENV `MALL_CONSENT_ENFORCE_COMPANY_IDS` · 기본 꺼짐) — 1차 = `campaigns.ts` 발송·타겟 인원·수신자 미리보기(0922 구현) · S6-b = `customers.ts` filter-count·extract · `ai.ts` 7곳 · `targets.ts` · 자동발송·여정 · 화면 3상태·「몰 동의 미확인 N명 제외」 줄 | 1차 0922 구현 · S6-b 다음 | ENV 켜기 전후 몰별 대상 수 비교 + 실발송 1건 |
| S7 | 관리자 광고 발송 몰 선택(캠페인에 몰 축) | 다음 | — |

S5 가 S6 보다 앞인 이유(회의론자 최종 검증): 삭제 경로가 고객 행 동의를 `true` 로 되살리는 쓰기가 남은 채 읽기를 바꾸면, 아직 안 고친 읽기(여정·자동발송)가 그 값을 본다.

## 7. 이번에 안 여는 것 (기록만)

구매 집계의 몰 분리(`purchases.store_code` 는 실재하나 그 표는 싱크·업로드 원장이고 자사몰 주문은 안 들어간다 — 적재 축이 하나 더 느는 설계) · 몰별 이름·등급 오버레이 · 여정의 몰 축(`journey-safety-filter.ts:17~27` 시그니처) · 자동발송이 `customers.store_code` 를 읽어 분류 지정 자동발송이 0건인 결함 · 일괄 배정의 옛 컬럼 · 이메일 수신동의(`email_agreement_label`) · `godo-client` 가져오기의 같은 구조 · 엑셀·`%누적구매금액%` 의 "회사 합계" 라벨.

## 8. DDL (Harold 실행 · 추가만 · NULL 허용 · 기존 행 전부 NULL = 동작 변화 0)

먼저 실측:
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'customer_stores' ORDER BY ordinal_position;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'customer_stores';
```
그 결과를 SCHEMA.md 에 등재한 뒤:
```sql
ALTER TABLE customer_stores
  ADD COLUMN IF NOT EXISTS sms_opt_in boolean,
  ADD COLUMN IF NOT EXISTS consent_source varchar(60),
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;
```
인덱스(읽기 전환 S6 전 · `CONCURRENTLY`)는 실측한 기존 인덱스를 본 뒤 확정한다.

## 9. 되돌리기

| 대상 | 방법 |
|---|---|
| 읽기 전환 | ENV 에서 회사 id 제거 → 즉시 옛 SQL |
| 동결·쓰기 배선 | `identifyCustomer` 의 `storeCode` 분기 삭제(소속 행 컬럼은 방치해도 읽는 곳 0) |
| 수신거부 입구 격리 | 격리 스위치 OFF = 종전 동작 그대로(분기는 ON 회사에서만 탄다) |
| DDL | 컬럼 방치(읽는 곳 0) |

## 10. 0922 구현 범위와 남은 것

| 구분 | 내용 | 상태 |
|---|---|---|
| CT | `utils/mall-consent.ts`(몰 동의 분류코드 판정 · ENV 강제 · `buildSendConsent` · `upsertStoreConsent` · 부팅 로그) | 구현 · 테스트 16 |
| S1·S3 | `identifyCustomer` 동결 + 몰 동의를 소속 행에(`recordStoreMembership` 뒤) · `storeCode` 없는 호출은 불변 | 구현 · 테스트 +5 |
| S5 | 수신거부 입구 격리(삭제 라우트 · 슈퍼관리자 삭제 · 080 동의 내림 · 라우트 동의 동기화 사본 2벌) · 판정 CT `isUserIsolationEnabled` | 구현 · 테스트 8 |
| S6 1차 | `campaigns.ts` 발송 · 타겟 인원 · 수신자 미리보기(ENV 꺼짐 = 옛 문자열) | 구현 · 소스 계약 3 |
| 별건 선행 | 테스트 발송·스팸 테스트 샘플 고객 분류 격리(B-0922-1) | 구현 |
| S0·S2 | `customer_stores` 실측 → SCHEMA 등재 → DDL(§8) | 0922 실행(8컬럼 확인) |
| S4 | 4몰 `run-woo-backfill.ts` 재실행(DDL 뒤 · 재기동 없음) | 렌즈007 완료(yes 7,167·no 7,926·모름 2,043) · 나머지 3몰 `--restart` 재실행 대기(옛 코드 적재라 몰 동의 NULL) |
| 격리 스위치 ON | **폐기(H2-1)** — 고객사가 수신거부 회사 전체 공유를 택함 · OFF 유지 | 폐기 |
| S6-b | 표시·건수 화면 · 자동발송·여정 · AI · 타겟 · 자동마케팅 — **읽는 자리 전부를 CT 조각으로** | **★1002~03 구현(§13)** · ENV 켜기 전 = 동작 불변 |
| S7 · 화면 3상태 | 관리자 몰 선택 · 「모름」 표기 | 미구현(§13-9) |

**★0923 전후 비교 실측(ENV 켜기 직전 · 소속 행 × 고객 행)**: 지금(고객 행 true) → ENV 후(소속 행 true) = 이로이로도쿄 149,690→154,735(빠짐 12 · 들어옴 5,057) · 렌즈고고 25,342→24,835(빠짐 1,256 · 들어옴 749) · 일본이모 12,639→13,592(빠짐 11 · 들어옴 964) · **렌즈007 1,115→7,168**(빠짐 134 · 들어옴 6,187). 합 188,786→200,330. "들어옴" = S1 동결로 고객 행이 올라가지 않아 지금 빠져 있던 신규·렌즈007 적재분(ENV 를 켜야 정상 대상이 된다) · "빠짐" 1,413 = 다른 몰의 동의로 이 몰에서 나가던 교차 누수(H2 가 닫는 바로 그 인원).

**★1001 반영([B-1001-3](../status/BUGS.md) · [B-1001-4](../status/BUGS.md))**: ① 몰 동의 모드에서 타겟 브랜드 조건은 **그 브랜드 소속 행의 동의와 같은 행**에서 판정한다(`storeMembershipCond requireConsent` · 범위 [A,B] 계정이 A 를 고르면 A 거부·B 동의 고객이 B 동의로 통과하던 경로 차단). ② 브랜드 계정 수신거부 자동 등록은 몰 동의 코드가 섞인 계정을 뺀다(`mallConsentCodeAmong`). ③ **ENV 를 켜기 전 조건**: 관리자가 브랜드를 골라 보내는 발송은 고객 행 동의 그대로다(S7 미구현 · 렌즈고고는 고객 행 동의가 몰 동의보다 최소 491명 많다) — 켜는 작업에 "관리자 브랜드 선택 발송 = 그 브랜드 소속 행 동의"를 함께 넣는다. 1001 현재 ENV = OFF(부팅 로그).

**S6 를 켜기 전까지의 운영 가드**: ENV 가 꺼져 있는 동안 발송 자격은 종전대로 고객 행 `sms_opt_in` 이다. 동결 이후 새로 들어오는 몰 고객의 그 값은 false(발송 제외 방향)이고, 이미 들어와 있는 값은 그대로다. 이에스페이먼트의 **광고 발송은 S4 백필 확인 + ENV ON 뒤에** 시작한다(그 전 발송은 2몰 이상 소속 고객에서 다른 몰의 동의로 나갈 수 있다).

## 11. Codex 적대 검토 (0922)

**R1 — high 5건 전부 수용.** 공통 뿌리 = 과도기·예외 상태의 폴백이 옛 값(true) 쪽으로 열려 있었다 → 전부 "덜 보내는" 방향으로 닫았다.

| # | 지적 | 조치 |
|---|---|---|
| 1 | ENV 꺼짐 동안 동결이 철회를 버린다 | 올림만 동결 · 철회(false)는 고객 행에도 내린다(§4-2·§5) |
| 2 | 몰 동의 쓰기 실패를 삼켜 철회 재시도가 사라진다 | 소속 기록 실패만 삼키고 몰 동의 쓰기 실패는 전파 |
| 3 | 연동 해제가 그 몰의 거부를 무력화한다 | 해제된 연동의 코드도 몰 동의 판정에 포함 · 코드가 섞여도 옛 판정으로 되돌리지 않는다 |
| 4 | 컬럼 누락 시 서브쿼리의 `sms_opt_in` 이 바깥 고객 컬럼으로 바인딩된다 | 소속 표 별칭(`mcs`)으로 한정 · 모르는 모양은 `FALSE` 로 닫음 |
| 5 | 격리 삭제가 관리자의 독립된 080 거부까지 사본으로 지운다 | 격리 삭제는 관리자 행을 지우지 않는다 |

**R2(증분 · 수정 줄과 직접 호출부만) — critical·high 0 · medium 1 수용.** 몰 동의 컬럼 미존재(42703)를 조각을 쓰는 세 endpoint(캠페인 생성·발송·수신자 미리보기)가 500 이 아니라 **503 `DB_MIGRATION_PENDING`** 으로 답한다(`db_alter_safety_net` · 옛 판정으로 되돌리는 재시도 없음 · 발송 catch 는 실행 행 종결 뒤에 응답). 라운드 상한 2회 도달 · 종료.

## 12. 「회원 정보에 동의 값이 없으면 동의」 규칙 — 몰 단위 (2026-10-02 · [B-1001-8](../status/BUGS.md) 후속)

**경위**: 1002 박성용 「수신동의 회원수가 같아요(184,016 · 184,017)」 → 이에스페이먼트 대표 확인(카톡 · 박성용 전달) = **「no 만 수신거부 · 아무것도 없거나 YES 는 문자 보낼 수 있다」** · `mssms_agreement` 는 쓰지 않는다. Harold 「빈칸 되어 있는 애들 바꿔 달라잖아」.

### 12-1. 실측 (1002 · Harold 실행)
- 서버 저장 키 = 4몰 모두 `mssms_agreement_label`. 최근 7일 수집 원본 값 = `YES`·`NO` 둘뿐 · 빈 값 0건 · **「모름」 = 그 키 자체가 없는 건**(렌즈고고 2,039건 중 1,701 · 렌즈007 439건 중 335).
- 소속 행 분포(동의 / 거부 / 모름): 이로이로도쿄 154,894 / 150,976 / 3,278 · 렌즈고고 24,850 / 30,704 / 39,352 · 일본이모 13,617 / 7,275 / 292 · 렌즈007 7,170 / 7,934 / 2,057.
- **「모름」 44,982 중 그 몰의 회원 연결이 있는 고객 41,444**(렌즈고고 39,112 · 렌즈007 1,974 · 이로이로도쿄 287 · 일본이모 71) · 비회원뿐 3,538(240 · 84 · 2,993 · 221).
- 회원 연결이 있는 「모름」에는 **회원 정보가 한 번도 읽히지 않은 회원**이 섞여 있다: 첫 가져오기는 회원 → 주문 순서인데, 프로필에 휴대폰이 없는 회원(렌즈고고 19,635 · 이로이로 4,074 · 우커머스 설계서 §8-5 ⓐ)은 회원 단계에서 건너뛰고 주문 단계에서 고객이 됐다. 그 사람들의 YES·NO 는 아직 모른다 → **「모름」을 SQL 로 한꺼번에 동의로 바꾸면 안 된다**(못 읽은 NO 가 동의가 된다).
- 대시보드 「수신동의 수」(184,016)는 고객 행 `customers.sms_opt_in`(`routes/customers.ts` stats · `sms_opt_in_count`)이다 — §4-2 동결로 0922 부터 오르지 않고 내리기만 한다. **이 규칙만으로는 그 숫자가 바뀌지 않는다**(읽기 전환 = §10 S6-b 가 남아 있다).

### 12-2. 규칙
- **켜는 자리** = 연동 행 `company_integrations.meta.consent_missing_agree_key = '<동의 키 이름>'`(provider 공통 키 · 분류코드 단위). 기본(키 없음) = 종전 그대로 모름. 고객이 스스로 켜는 값이 아니다 — 고객사 서면 확인 뒤 우리가 SQL 로 적는다(화면 칸 없음).
- **동의 키 이름에 묶인다**: 규칙에 적힌 키와 그 회원 정보를 읽은 키(`woo_consent_meta_key`)가 같을 때만 적용한다. 연결 폼의 동의 키는 고객사가 고칠 수 있고, 잘못 적힌 키로 읽으면 모든 회원이 「값 없음」으로 보인다 → 키가 바뀌면 규칙이 멈춘다(모름 = 덜 보내는 방향).
- **부르는 자리 = 회원 정보(프로필) 수신 하나**. 주문에서는 부르지 않는다(회원 주문도 비회원 주문도) — 주문에는 동의 키가 실리지 않고, 비회원 주문도 전화번호로 회원 고객에 합쳐진다. **비회원(회원 정보가 없는 구매자)은 규칙의 대상이 아니다.**
- **「값이 없다」** = 동의 키가 설정돼 있고 + 메타 목록(배열)을 실제로 받았는데 + 그 키가 없거나 값이 null·빈 문자열. 키 미설정 · 메타 목록이 안 실린 본문 · 해석하지 못한 글자는 「없음」이 아니다(모름으로 둔다).
- **채우는 조건은 저장하는 SQL 한 문장이 전부 본다**(`applyMissingConsentRule` · 앱 메모리·호출 종류로 판정하지 않는다): ⓪ 그 순간 그 몰(회사 · 분류코드)에 **읽은 키와 같은 키의 규칙**이 켜져 있다 ① 그 고객의 그 몰 소속 행이 **모름(NULL)** 이다 = 명시 값(YES·NO)을 덮지 않는다 ② 그 고객에게 **그 몰의 다른 회원 연결이 없다**(같은 회사·같은 출처·`{몰}:` + 숫자뿐 · 이 호출의 식별자 제외) — 전화번호로 합쳐져 회원 계정이 둘 이상인 고객은 한 계정의 「값 없음」이 다른 계정의 못 읽은 NO 를 덮을 수 있어 명시 값만 믿는다.
- 채운 값의 출처 = `{source}:missing=agree`(예: `woocommerce:missing=agree`) — 명시 값과 구분된다(되돌리기 축).
- 명시 값이 이긴다: NO 뒤에 값 없는 재수신이 와도 거부 그대로 · 규칙으로 채운 뒤 NO 가 오면 거부로 덮인다(`upsertStoreConsent`).
- ★ 명시 값 쓰기는 소속 행이 없어도 행을 만들어 남긴다(`upsertStoreConsent` = INSERT … ON CONFLICT DO UPDATE · 다른 회사의 같은 행은 건드리지 않음). 종전 UPDATE 는 분류 기록이 실패한 건의 거부가 0행으로 조용히 빠졌다.
- 읽는 쪽에는 분기를 두지 않는다 — 읽는 자리는 전부 `sms_opt_in = true` 하나. 규칙은 고객 행 `customers.sms_opt_in` 을 건드리지 않는다.

### 12-3. 소스 위치
| 하는 일 | 파일 · 함수 |
|---|---|
| 채우는 SQL 한 문장(규칙 켜짐 · 키 일치 · 모름 · 다른 회원 연결 없음) | `utils/mall-consent.ts` `applyMissingConsentRule` · 규칙 키 `MISSING_CONSENT_RULE_KEY` · 출처 표기 `missingConsentSource` |
| 명시 값 쓰기(행이 없으면 만든다) | `utils/mall-consent.ts` `upsertStoreConsent` |
| 배선(명시 값이면 쓰고 끝 · 표시가 실린 호출만 규칙으로 · 실패는 삼킴) | `utils/cdp-identity.ts` `recordStoreMembership` · 입력 `IdentifyInput.profileConsentAbsent` · `isConsentAbsent` |
| 「읽을 수 있었는가」 · 회원 식별자 모양 | `utils/woocommerce-core.ts` `wooConsentReadable` · `wooMemberIdFormat` |
| 표시를 싣는 자리(회원 경로만) | `utils/woocommerce-client.ts` `applyWooResource` |
| 계약 테스트 | `__tests__/mall-consent.test.ts`(「회원 정보 동의 값 없음 규칙 — 몰 단위」 · `upsertStoreConsent`) · `cdp-identity-store-code.test.ts`(1002 묶음) · `woocommerce-client.test.ts`(1002 4건) |

### 12-4. 이에스페이먼트 반영 순서 (Harold 실행)
1. 코드 배포 + **백엔드 재기동**(가져오기는 줄 세운 앱 워커도 이어 가므로, 옛 코드의 앱이 떠 있으면 값 없는 회원을 채우지 않고 지나간다).
2. 규칙 켜기 SQL 1회(한 문장 `UPDATE … RETURNING`): 4몰 연동 행에 `consent_missing_agree_key = 'mssms_agreement_label'`. 조건 = 지금 그 키로 읽고 있는 행(`meta->>'woo_consent_meta_key'` 일치) + `cdp_identity_links(customer_id)` 색인이 있음(`pg_indexes`). **4행 반환 확인** — 0행이면 안 켜진 것이다. 켠 순간부터 적용된다.
3. 회원 정보 다시 읽기 = 몰마다 `npx ts-node scripts/run-woo-backfill.ts <몰> --restart`. 회원 정보의 YES·NO 는 명시 값으로, 값이 없는 회원은 규칙으로 동의가 된다. 휴대폰 없는 회원도 주문으로 생긴 연결이 있으면 이때 처음 읽힌다.
4. 분포 재측정(동의 / 거부 / 모름 / 규칙으로 채운 수).
5. 되돌리기 = 아래 두 묶음을 **이 순서로**(일회용 PostgreSQL 16 에서 그대로 실행 확인). ⚠ 2) 를 고정 대기(`pg_sleep`) 뒤에 실행하는 식으로 바꾸지 않는다 — 규칙을 끄기 전에 시작돼 행 잠금에서 기다리던 채우기 문장이 되돌리기가 끝난 뒤에 동의를 다시 쓴다(Codex R4 · 실제 동시 세션으로 재현함).

```sql
-- 1) 규칙 끄기 (끈 뒤에 시작하는 채우기 문장은 꺼진 규칙을 본다)
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE company_integrations
   SET meta = meta - 'consent_missing_agree_key', updated_at = NOW()
 WHERE company_id = '<회사 id>' AND provider = 'woocommerce' AND meta ? 'consent_missing_agree_key'
RETURNING mall_id;
COMMIT;
-- 2) 규칙으로 채운 값만 모름으로 (명시 동의·거부는 출처가 달라 닿지 않는다 · 다시 돌려도 같은 결과)
--    **한 문장**이다(표 잠금 → 규칙이 꺼졌는지 확인 → 되돌리기). 실행 도구가 오류 뒤 다음 문장을 계속 실행해도 갈라질 문장이 없다.
--    표 잠금 = 규칙을 끄기 전에 시작된 쓰기 문장이 전부 끝난 뒤에야 잡힌다(행 잠금에서 기다리던 문장 포함). 그 뒤의 새 문장은 꺼진 규칙을 본다.
--    5초 안에 못 잡으면 이 문장만 실패한다(규칙은 이미 꺼져 있다) → 2) 만 다시 실행한다.
--    규칙이 아직 켜져 있으면(1) 이 실패한 경우) 예외로 끝난다 → 1) 부터 다시 실행한다.
--    ⚠ 잠금을 기다리는 동안에도 뒤에 온 소속 표 쓰기(다른 회사 포함)가 줄을 서고, 잡은 뒤에는 되돌리는 UPDATE 가 끝날 때까지 기다린다.
--      lock_timeout 5초는 잠금을 기다리는 시간의 상한이지 UPDATE 실행 시간의 상한이 아니다 → 업무시간 밖에 실행한다.
DO $$
DECLARE n bigint;
BEGIN
  SET LOCAL lock_timeout = '5s';
  LOCK TABLE customer_stores IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM company_integrations WHERE company_id = '<회사 id>' AND meta ? 'consent_missing_agree_key') THEN
    RAISE EXCEPTION '규칙이 아직 켜져 있습니다 — 1) 부터 다시 실행합니다';
  END IF;
  UPDATE customer_stores
     SET sms_opt_in = NULL, consent_source = NULL, consent_at = NULL
   WHERE company_id = '<회사 id>' AND consent_source = 'woocommerce:missing=agree';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '모름으로 되돌린 행 = %', n;
END $$;
```

### 12-5. 남는 「모름」 (알고 남기는 것)
- 비회원뿐인 고객(3,538) — 회원 정보가 없어 규칙 대상이 아니다. 고객사가 비회원도 발송 대상으로 원하면 별도 결정.
- 회원 계정이 둘 이상인 기존 고객 중 두 계정 모두 값이 없는 경우(서로를 다른 회원 연결로 본다 · 덜 보내는 쪽).
- 몰이 회원 정보를 돌려주지 않는 회원(탈퇴 등) · 해석하지 못한 값.
- 순서에 따른 잔여: 값 없는 계정 B 가 먼저 채워진 뒤, 회원 정보를 읽을 수 없는 계정 A(프로필에 휴대폰·맞는 이메일 없음)의 주문이 같은 전화번호로 합쳐지면 그 행은 동의로 남는다. A 의 회원 정보는 어떤 순서로도 읽을 수 없고(§8-5 ⓐ), 그 번호는 값 없는 회원 B 의 번호다.

### 12-6. 검증 · 리뷰
- 계약 테스트(위 표) · **변이 36종 전부 검출**(파일 복사) · backend tsc 0 · vitest 전체 통과(1002 10:45 · 532파일 7,409건 · 같은 작업 트리의 다른 작업분 포함).
- **일회용 PostgreSQL 16 실행 62항목**: 실물 `processWooResource → identifyCustomer → applyMissingConsentRule` 로 규칙 꺼짐 = 쓰기 0 · 다시 읽기(기존 연결 경로)·신규 회원 채움 · 명시 거부·동의 불변 · 채운 뒤 NO = 거부 · 회원 계정 둘 · 주문으로 생긴 회원 · 비회원뿐이던 고객에 회원이 합쳐짐 · 다른 회원 계정이 붙은 고객 = 모름 유지 · 다른 몰·앞글자만 같은 식별자 · 메타 목록 없음·해석 못 한 값·키 불일치·키 미설정·다른 회사 = 모름 · **규칙을 끈 직후 = 모름 · 다시 켠 직후 = 동의** · 소속 행 없는 고객의 NO = 행 생성 · 다른 회사 행 불변 · **운영 SQL 3종(켜기 · 분포 · 되돌리기) 그대로 실행**(색인이 없으면 켜기 0행 · 규칙이 켜진 채 되돌리기 2단계만 실행하면 예외로 끝나고 채운 값 그대로) · **되돌리기와 진행 중인 채우기 문장의 순서를 실제 동시 세션으로**(고정 대기 절차 = 되돌린 뒤 동의가 다시 써짐을 재현 → 표 잠금 절차 = 모름 · 잠금 대기 초과 시 2단계만 실패 후 재실행으로 닫힘 · 표 잠금에서 기다리던 채우기 문장은 잠금이 풀린 뒤 실행 스냅샷을 잡아 꺼진 규칙을 봄 = 안 채움). 실행 계획 = 연결 20만 행에서 규칙·연결·소속 표 모두 색인(건당 1.85ms).
- **Codex 적대 = 7R approve**. R1 high(소속 행이 없으면 명시 거부가 0행으로 빠지고 그 뒤 규칙이 동의로 채움) · R2 high(비회원 주문이 전화번호로 회원 고객에 합쳐져 못 읽은 NO 가 동의로) · R3 high(규칙을 60초 캐시로 판정 → 끈 뒤에도 동의를 다시 만듦) = **셋 다 같은 뿌리**(채워도 되는가의 조건이 저장하는 SQL 밖에 있었다) → 개별 수정을 그만두고 조건 전부를 채우는 SQL 한 문장으로 옮김(주문 경로 원복 · 비회원 제외 · 캐시와 규칙 목록 함수 삭제). R4 = 코드(바인딩 9개 · 회사·분류코드·키 격리 · 호출부 실패 처리)는 맞음 · high 1(되돌리기 절차의 고정 3초 대기는 행 잠금에서 기다리던 채우기 문장의 종료를 보장하지 않음) → 되돌리기 2단계를 표 잠금 장벽으로(§12-4 5번 · 코드 변경 없음). R5 = R4 경합 닫힘(PostgreSQL 16 소스 근거: Parse 에서 표 잠금 → Execute 에서 실행 스냅샷) · medium 1(1단계가 실패해도 psql 이 2단계를 계속 실행) · R6 medium 1(문장별 오류 복구가 켜져 있으면 검사 예외 뒤 UPDATE 가 실행) = **같은 뿌리**(검사와 되돌리기가 별개 문장) → 2단계 전체를 DO 블록 한 문장으로 · 켜기 SQL 의 색인 확인도 UPDATE 의 WHERE 로. **R7 approve**(No material findings).

### 12-7. 반영 기록 (2026-10-02 · Harold 실행)
- **배포 완료**(Harold 보고 · 커밋 `2b6379a8`).
- **규칙 켜기 SQL 실행 = 4행 반환**(`UPDATE 4`): 일본이모(ilbonimo.com) · 렌즈007(lens007.net) · 이로이로도쿄(iroirotokyo.net) · 렌즈고고(lensgogo.info) 모두 `consent_missing_agree_key = 'mssms_agreement_label'`. 켠 순간부터 새로 읽는 회원 정보에 적용된다.
- **4몰 회원 정보 다시 읽기 완료**(§12-4 3번 · 서버에서 `nohup` 으로 실행 · 로그 `/tmp/woo-reread.log` · 1002 오후 Harold 확인): 렌즈007 103초 · 일본이모 296초 · 렌즈고고 1,364초 · 이로이로도쿄 5,640초 · 4몰 모두 `stage=done` · 실패 0 · 로그의 오류 줄 0. 로그의 `phone 충돌 … 자동변경 skip + 검수 플래그` 는 건너뛴 건이다(실패가 아니다). 다음 = §12-4 4번 분포 재측정(동의 / 거부 / 모름 / 규칙으로 채운 수).
- **분포 재측정(1002 오후 · Harold 실행 · 동의 / 거부 / 모름 / 규칙으로 채운 수)**: 이로이로도쿄 155,181 / 150,998 / 3,011 / 279 · 렌즈고고 62,581 / 30,703 / 1,623 / 37,730 · 일본이모 13,680 / 7,281 / 224 / 68 · 렌즈007 9,020 / 7,934 / 208 / 1,850. **모름 44,979 → 5,066 · 규칙으로 채운 수 39,927 · 동의 200,531 → 240,462.** 거부는 줄지 않았다(이로이로도쿄 +22 · 일본이모 +6 · 렌즈007 0 = 다시 읽으며 새로 읽힌 NO) — 렌즈고고만 30,704 → 30,703(1건 · 원인 미확인 · 규칙은 모름만 채우므로 규칙이 바꾼 것은 아니다). 남은 모름은 §12-5 의 범위(비회원뿐 약 3,538 + 회원 계정이 둘 이상이거나 회원 정보를 못 읽은 고객).
- **대시보드 「수신동의 수」(184,016)는 그대로다** — 이 규칙은 소속 행만 채우고, 대시보드와 실제 발송 대상은 고객 행 `customers.sms_opt_in` 을 읽는다(§12-1 끝). → **★1002~03 읽기 전환 구현 = §13**(배포 + ENV 켜기 뒤에 숫자와 발송 대상이 바뀐다 · 순서 = §13-6).
- 교훈(채우는 조건은 저장하는 SQL 한 문장이 본다 · 되돌리기 절차) = [LESSONS_BACKEND](../status/lessons/LESSONS_BACKEND.md) 2026-10-02 「채워도 되는가」 절.


## 13. 읽기 전환 — 수신동의를 읽는 자리 전부 (2026-10-02~03 · [B-1001-8](../status/BUGS.md) 재접수의 후속)

> 접수(1002 오후 · 이에스페이먼트): 「바뀐 게 없다 · 공란은 수신동의인데 왜 수신동의 숫자가 안 바뀌었냐」.
> 원인: §12 규칙은 **소속 행**을 채웠는데, 수신동의를 읽는 자리(대시보드 · 고객 화면 · 타겟 인원 · 발송 대상)가 전부 **고객 행**을 읽었다. 진실은 옮겼는데 읽는 자리를 옮기지 않았다.
> 처방: 읽는 자리는 `X.sms_opt_in = true` 를 손으로 적지 않고 CT 조각(`utils/mall-consent.ts`)을 넣는다. **DDL 0.**

### 13-1. 누구 기준으로 읽는가

| 범위 | 판정 | 쓰는 자리 |
|---|---|---|
| 옛 판정(ENV 에 없는 회사 · 몰 연동 없는 회사 · 범위 코드에 몰 동의 코드가 하나도 없는 사용자) | 고객 행 값 — 조각이 **옛 글자 그대로**라 SQL·파라미터가 달라지지 않는다. ENV 가 비어 있으면 DB 도 읽지 않는다 | 다른 고객사 전부 |
| 분류코드 범위(담당자 · 관리자가 고른 브랜드 · 자동발송의 브랜드) | 그 코드들의 소속 행 중 **하나라도 동의**. 거부 = 동의 행이 없고 거부 행이 있음. 모름(NULL · 행 없음)은 어느 쪽도 아니다 | 화면 · 캠페인 · AI · 자동발송 · 타겟 · DM (기존 발송 조각 `buildSendConsent` 와 같은 판정) |
| 범위 없음(관리자) | **어느 몰에서도 거부가 없고** 한 몰 이상 동의. 몰 코드의 소속 행도 회원 연결(`cdp_identity_links`)도 없는 고객(업로드 · 싱크로만 들어온 고객)은 **고객 행 값** | 관리자 화면 · 관리자 발송 · 회사 전체 통계 |
| 여정(자동 실행) | 작성자 기준. 작성자 범위가 분류코드 여럿이어도 **그 범위 안 어느 몰에서든 거부면 제외**(strict) — 추출 · 재진입 · 발송 직전 재판정이 같은 조각 | `journeyOwnerConsent` · `readOwnerConsentForCustomer` |

- 관리자 기준에 고객 행 값을 남긴 이유: 몰 동의로만 읽으면 켜는 순간 업로드 고객이 관리자 발송에서 전부 빠진다. 「몰에서 온 적 없음」을 몰 코드 목록만으로 가르면 연동의 분류코드를 바꿨을 때 옛 코드의 소속 행이 "몰 소속 없음"으로 읽혀 통과한다(Codex R1) → 회원 연결 유무로 가른다.
- 관리자가 타겟에서 브랜드를 고르면: 그 브랜드가 **몰 동의 코드일 때만** 그 소속 행의 동의를 같은 행에서 요구한다(`brandConsentOption` → `storeMembershipCond consentMallCodes`). 업로드 브랜드는 소속 행에 동의 값이 없어 소속만 본다.

### 13-2. CT 함수 (`utils/mall-consent.ts`)

| 함수 | 역할 |
|---|---|
| `resolveConsentScope` · `resolveViewerConsentScope` · `resolveOwnerConsentScope` | 범위 판정(코드 · 요청 사용자 · 주인) |
| `consentSql(scope, alias, idRef, {strict})` | 행 단위 조각 `isTrue` · `isFalse` · `value`. WHERE 에 쓴다 |
| `consentJoinSql` | 집계용 — 소속 표를 한 번 훑어 고객별 (동의 있음 · 거부 있음)을 만들어 LEFT JOIN. FILTER · SELECT 안에서 쓴다 |
| `consentCountTrue` · `consentWithUnsub` | 몰 동의 회사에서만 보는 사람의 수신거부를 뺀다(§13-4) |
| `viewerConsentSql` · `viewerConsentJoin` · `ownerConsentSql` · `ownerConsentTrue` | 라우트 · 주인 기준 한 줄 |
| `journeyOwnerConsent` · `ownerJourneyConsent` · `readOwnerConsentForCustomer` | 여정(strict) |
| `resolveAdminSendConsent` · `brandConsentOption` | 범위 없는 캠페인 발송 · 타겟의 브랜드 조건 옵션 |

### 13-3. 읽는 자리

- **바꾼 자리**: `routes/companies.ts`(대시보드 카드 집계 · 상세 · 추이) · `routes/customers.ts`(목록 · 다운로드 · 필터 미리보기 · 통계 · 필터 인원 · 추출 · 상세 · 타임라인 · 조건의 수신동의 필드) · `routes/campaigns.ts`(인원 · 발송 · 미리보기의 관리자 갈래) · `routes/auto-campaigns.ts` 3 · `utils/auto-campaign-worker.ts` 4 · `routes/ai.ts` 14 + 여정 미리보기 · `services/ai.ts` · 여정(`journey-safety-filter` · `journey-target-extractor` 14곳 + 고객 조건 · `journey-trigger-watcher` · `journey-anchor-scheduler` · `journey-activation` · `journey-simulator` · `journey-reentry-worker` · `journey-executor`) · 자동마케팅(`operator-recipients` · `operator-audience` 게이트 단일 문 · `planner-audience` · `continuous-operator` · `ai-orchestrator`) · `channel-eligibility` + `routes/dm.ts` · `routes/targets.ts` · `utils/target-count.ts` · `ai-segment-generator`(미리보기 = 요청자 기준) · `target-sample` · `customer-filter`(수신동의 필드 · 브랜드 조건 옵션) · `store-scope`(`consentMallCodes`) · `enabled-fields`(엑셀 값) · 통계 문맥 4(`citations` · `crm-agency-proposal` · `planner-executor` · `continuous-operator`).
- **일부러 안 바꾼 자리**(계약 테스트의 허용 목록): 개인화 미리보기용 샘플 고객 1명(`campaigns.ts` 테스트 발송 · `spam-filter.ts` · `spam-test-queue.ts`) · 동종 업체 평균 통계(`performance-benchmark.ts` — 다른 회사와 같은 식으로 세야 한다) · 프로필 파생값(`unified-customer-profile.ts` — 이벤트마다 계산) · 여정 조건 단계가 고객 행 열을 읽는 자리(`journey-executor` condition step).

### 13-4. 수신거부와의 관계

고객 행 값에는 수신거부(080 · 수동)가 이미 반영돼 있다(`syncCustomerOptIn`). 소속 행에는 반영되지 않는다. 발송 경로는 전부 수신거부 표를 따로 본다(캠페인 · 자동발송 · AI = 사용자 기준 · 여정 · 자동마케팅 = 회사+전화 · DM = 스테이징 정제). 수신거부 표를 따로 보지 않던 **세는 자리**(대시보드 수신동의 수 · 타겟 인원 · DM 대상 조회)는 몰 동의 회사에서만 보는 사람의 수신거부를 뺀다 — 대시보드 수 = 고객 통계의 수신동의 수.

### 13-5. 성능 (1002 실측 · 일회용 PG16 · 고객 24만 · 소속 행 44만 · 병렬 끔)

행 단위 조각은 WHERE 에서 해시 조인으로 풀리지만 FILTER 안에서는 고객 수만큼 소속 표를 찾는다(관리자 3.6초). 그래서 집계 자리는 조인 형태를 쓴다: 대시보드 관리자 약 1.0~1.4초 · 담당자 0.7~1.0초 · 고객 통계 0.4~1.0초 · 관리자 발송 대상 추출 약 1.1~1.2초. 대시보드 · 고객 통계는 캐시(60초 / 10분)를 지난다. 운영 수치는 켠 뒤 재측정한다.

### 13-6. 켜는 순서 (Harold 실행)

1. 배포(백엔드 재기동 — 업무시간 밖). **ENV 를 켜기 전에는 어떤 회사도 동작이 달라지지 않는다.**
2. 미리 보기 SQL(읽기 전용 · PG16 검증본 · 아래) — 관리자와 몰별 「지금 → 전환 뒤」 수신동의 수.
3. 서버 `.env` 에 `MALL_CONSENT_ENFORCE_COMPANY_IDS=19c59d0c-77d3-4e52-9ceb-9a47a3c37e49` 한 줄 → 백엔드 재기동 → 부팅 로그 `[MallConsent] 읽기 강제 ON (…)` 확인.
4. 화면 확인: 몰 계정 대시보드 수신동의 수 = 2번의 그 몰 `after_agree` − 그 계정의 수신거부 · 관리자 계정 = 첫 줄.

미리 보기 SQL(실행 위치 = .62 한줄로 운영 서버 · `docker exec -i targetup-postgres psql -U targetup targetup` 에 붙여 넣는다):

```sql
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = '120s';
-- (1) 새 코드가 읽는 열이 있는지 — 5행이 나와야 한다
SELECT table_name, column_name FROM information_schema.columns
 WHERE (table_name, column_name) IN (('customer_stores','sms_opt_in'), ('cdp_identity_links','customer_id'), ('cdp_identity_links','company_id'),
                                     ('unsubscribes','user_id'), ('unsubscribes','phone'))
 ORDER BY 1, 2;
-- (2) 이에스페이먼트: 수신동의 수가 「지금(고객 행)」에서 「읽기 전환 뒤(소속 행)」로 어떻게 바뀌는가 — 읽기만 한다
--   첫 줄 = 관리자 계정(범위 없음): 어느 몰에서도 거부가 없고 한 몰 이상 동의(몰 소속도 회원 연결도 없는 고객은 고객 행 값)
--   나머지 = 몰 계정(분류코드별): 그 몰 소속 행이 동의
--   now_agree = 지금 화면이 세는 수 · after_agree = 읽기 전환 뒤(화면 숫자는 여기서 보는 사람의 수신거부 등록분을 더 뺀 값)
WITH malls AS (
  SELECT ARRAY(SELECT DISTINCT meta->>'store_code' FROM company_integrations
                WHERE company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49' AND COALESCE(meta->>'store_code', '') <> '') AS codes
), mc AS (
  SELECT cs.customer_id, bool_or(cs.sms_opt_in) AS t, bool_or(NOT cs.sms_opt_in) AS f
    FROM customer_stores cs, malls
   WHERE cs.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49' AND cs.store_code = ANY(malls.codes)
   GROUP BY cs.customer_id
)
SELECT '관리자(전체)' AS scope,
       COUNT(*) AS customers,
       COUNT(*) FILTER (WHERE c.sms_opt_in = true) AS now_agree,
       COUNT(*) FILTER (WHERE mc.f IS NOT TRUE AND (mc.t IS TRUE OR (c.sms_opt_in = true AND mc.customer_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM cdp_identity_links l WHERE l.company_id = c.company_id AND l.customer_id = c.id)))) AS after_agree,
       COUNT(*) FILTER (WHERE mc.customer_id IS NULL) AS no_mall_row
  FROM customers c LEFT JOIN mc ON mc.customer_id = c.id
 WHERE c.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49'
UNION ALL
SELECT cs.store_code,
       COUNT(*),
       COUNT(*) FILTER (WHERE c.sms_opt_in = true),
       COUNT(*) FILTER (WHERE cs.sms_opt_in = true),
       NULL
  FROM customer_stores cs
  JOIN malls ON cs.store_code = ANY(malls.codes)
  JOIN customers c ON c.id = cs.customer_id AND c.company_id = cs.company_id
 WHERE cs.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49'
 GROUP BY cs.store_code
 ORDER BY 2 DESC;
```

**미리 보기 실측(2026-10-03 · Harold 실행 · ENV 켜기 전)**: 열 5행 확인. 고객 429,128명 전원이 몰 소속 행을 갖는다(`no_mall_row` 0 = 이 회사에는 고객 행 값으로 읽는 업로드 고객이 없다).

| 보는 사람 | 지금(고객 행) | 전환 뒤(소속 행) | 차이 |
|---|---|---|---|
| 관리자(전체) | 184,012 | 230,731 | +46,719 |
| 이로이로도쿄 | 149,652 | 155,185 | +5,533 |
| 렌즈고고 | 25,339 | 62,581 | +37,242 |
| 일본이모 | 12,639 | 13,681 | +1,042 |
| 렌즈007 | 1,116 | 9,021 | +7,905 |

화면 숫자는 여기서 그 계정의 수신거부 등록분을 더 뺀 값이다(미측정). 관리자 수가 몰 합(240,468)보다 작은 이유 = 여러 몰에 속한 고객은 한 번만 세고, 어느 몰에서든 거부한 고객은 뺀다.

**반영 기록(2026-10-03 · Harold 실행)**: 00:18 에 중간 상태(Codex R1 수정 전)가 먼저 올라가 있었다(읽기 강제 OFF 라 동작 불변) → 최종본 push·배포 뒤 서버 표식 확인(`linkedSql·consentWithUnsub·ownerJourneyConsent` 6줄) · 00:52:35 최종본으로 기동(OFF) → `.env` 에 한 줄 추가(사본 = 홈 폴더 `targetup-backend.env.bak-20261003`) → `pm2 restart all --update-env` → **00:57:54 부팅 로그 `읽기 강제 ON (19c59d0c-…)`**. ts-node 기동은 12초보다 오래 걸린다(부팅 로그는 재기동 뒤 1분쯤 지나 확인). 남은 것 = 화면 숫자 확인 · 켠 뒤 오류 로그 확인 · 고객사 회신.

**켠 뒤 계정별 대시보드 수신동의 수(2026-10-03 · Harold 실행 · 대시보드 집계와 같은 식 = 소속 행 동의 − 그 계정의 수신거부)**

| 계정 | 범위 | 켜기 전(고객 행) | 켠 뒤 | 차이 | 몰 동의 수 − 수신거부 |
|---|---|---|---|---|---|
| espayment | 관리자 | 184,012 | 220,101 | +36,089 | 230,731 − 10,630 |
| espayment1 | 이로이로도쿄 | 149,652 | 149,078 | −574 | 155,185 − 6,107 |
| espayment2 | 일본이모 | 12,639 | 12,885 | +246 | 13,681 − 796 |
| espayment3 | 렌즈고고 | 25,339 | 56,303 | +30,964 | 62,581 − 6,278 |
| espayment4 | 렌즈007 | 1,116 | 8,371 | +7,255 | 9,021 − 650 |

이로이로도쿄만 574 줄었다 — 켜기 전 수는 고객 행 기준이고 켠 뒤 수는 그 몰 소속 행 기준이라 두 수의 모집단이 다르다(어느 쪽이 얼마인지 분해는 미측정).

계정별 수를 다시 뽑는 SQL(읽기 전용 · PG16 에서 대시보드 집계 실물 조각과 대조한 검증본):

```sql
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = '180s';
-- 이에스페이먼트 계정별 「대시보드 수신동의 수」 — 화면이 지금 계산하는 식 그대로(읽기만 한다)
--   mall  = 담당자(분류코드에 몰 코드 있음): 그 코드 소속 행이 동의 − 그 계정의 수신거부
--   admin = 관리자(범위 없음): 어느 몰에서도 거부 없음 + 한 몰 이상 동의 − 그 계정의 수신거부
--   legacy = 몰 코드가 없는 담당자: 고객 행 값(종전 그대로)
WITH malls AS (
  SELECT ARRAY(SELECT DISTINCT meta->>'store_code' FROM company_integrations
                WHERE company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49' AND COALESCE(meta->>'store_code', '') <> '') AS codes
), u AS (
  SELECT us.id, us.login_id, us.user_type, us.store_codes::text[] AS codes,
         CASE WHEN us.user_type = 'user' AND COALESCE(array_length(us.store_codes, 1), 0) > 0
              THEN CASE WHEN us.store_codes::text[] && malls.codes THEN 'mall' ELSE 'legacy' END
              ELSE 'admin' END AS mode
    FROM users us, malls
   WHERE us.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49' AND us.user_type IN ('admin', 'user') AND COALESCE(us.is_active, true)
)
SELECT u.login_id, u.user_type, u.mode, array_to_string(u.codes, ',') AS store_codes,
       (SELECT COUNT(*)
          FROM customers c
          LEFT JOIN (SELECT cs.customer_id, bool_or(cs.sms_opt_in) AS t, bool_or(NOT cs.sms_opt_in) AS f
                       FROM customer_stores cs
                      WHERE cs.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49'
                        AND cs.store_code = ANY(CASE WHEN u.mode = 'admin' THEN (SELECT codes FROM malls) ELSE u.codes END)
                      GROUP BY cs.customer_id) mc ON mc.customer_id = c.id
         WHERE c.company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49'
           AND CASE u.mode
                 WHEN 'mall'  THEN mc.t IS TRUE
                                   AND NOT EXISTS (SELECT 1 FROM unsubscribes x WHERE x.user_id = u.id AND x.phone = c.phone)
                 WHEN 'admin' THEN mc.f IS NOT TRUE
                                   AND (mc.t IS TRUE OR (c.sms_opt_in = true AND mc.customer_id IS NULL
                                        AND NOT EXISTS (SELECT 1 FROM cdp_identity_links l WHERE l.company_id = c.company_id AND l.customer_id = c.id)))
                                   AND NOT EXISTS (SELECT 1 FROM unsubscribes x WHERE x.user_id = u.id AND x.phone = c.phone)
                 ELSE c.sms_opt_in = true AND mc.customer_id IS NOT NULL
               END) AS dashboard_opt_in
  FROM u
 ORDER BY u.user_type, u.login_id;
```

### 13-7. 되돌리기

ENV 에서 회사 id 를 빼고 재기동 → 즉시 옛 SQL(§9). 데이터는 건드리지 않는다. 캐시 키는 몰 동의로 읽을 때만 꼬리가 붙어 옛 값과 섞이지 않는다.

### 13-8. 검증 · 리뷰

- tsc 0 · vitest 538 파일 7,578건 · 테스트 `__tests__/mall-consent-read-switch-1002.test.ts`(조각 · 범위 판정 · 실제 함수의 SQL · 읽는 자리 소스 계약 = 직접 읽기 잔존은 허용 목록뿐).
- 일회용 PostgreSQL 16: 실물 조각을 읽는 자리와 같은 쿼리 모양에 넣어 실행(범위 판정 · 행 단위 ≡ 조인 형태 · 대시보드 · 목록 · 통계 · 엑셀 · 캠페인 관리자 갈래 · 브랜드 조건 · 자동발송 · 여정 strict · 발송 직전 재판정 · 자동마케팅 · 채널 자격 · 세그먼트 미리보기 · 미리 보기 SQL) 전부 일치.
- 변이 45종 전부 검출. Codex 적대 2라운드 approve(R1 = high 2 · medium 2 → 전부 수용 · R2 = 지적 없음).

### 13-9. 알고 남기는 것

- 분류코드가 없는 연동(SDK 등)으로만 들어온 고객은 켠 회사의 관리자 기준에서 모름이다(덜 보내는 쪽).
- 분류코드 여럿인 담당자: 화면 · 캠페인은 「내 코드 중 하나라도 동의」, 여정은 「어느 몰에서든 거부면 제외」 — 여정이 더 좁다.
- 고객 목록의 수신동의 표시는 3상태(동의 · 거부 · 모름)인데 화면은 모름을 거부와 같은 색으로 그린다(화면 3상태 표기 = 미구현).
- S7(관리자 발송에서 몰을 고르는 화면)은 열지 않았다 — 관리자 발송은 위 관리자 기준으로 나간다.
