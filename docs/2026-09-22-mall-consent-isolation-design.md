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
| S0·S2 | `customer_stores` 실측 → SCHEMA 등재 → DDL(§8) | **Harold 실행 대기** |
| S4 | 4몰 `run-woo-backfill.ts` 재실행(DDL 뒤 · 재기동 없음) | 대기 |
| 격리 스위치 ON | S5 배포(재기동) 뒤 | 대기 |
| S6-b · S7 | 표시·건수 화면 · 자동발송·여정 · 화면 3상태 · 관리자 몰 선택 | 다음 단계(설계 승인 범위 안 · 데이터가 채워진 뒤) |

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
