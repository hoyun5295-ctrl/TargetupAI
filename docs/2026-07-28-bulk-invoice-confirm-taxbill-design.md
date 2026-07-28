# 거래내역서 일괄발급 + 컨펌/이의신청 + 세금계산서(팝빌) — 설계

> 2026-07-28 Harold 구술 기획. SoT = 이 문서. 진행 시 갱신.
> **오늘 구현 범위 = 팝빌 API 호출부 제외 전부.** 팝빌은 계약 문의 접수 상태 — 호출부는 스텁으로 두고 발급 큐가 `ready`에서 대기한다. 계약·API 키 수령 후 §7만 붙이면 전 흐름이 돈다.
> 메일 문안·내용 = 구현 시 Harold와 별도 논의(확정 지시).

---

## §0 배경과 목표

- 후불 업체의 N월 정산은 결과대기가 빠지는 N+1월 초(서수란 팀장, 통상 3일)에 진행한다. 지금은 정산 생성 화면에서 **업체 하나씩** 골라 발행한다.
- 발행 소요는 2026-07-28 실측 **6.7초/건**(금강제화, 인덱스 힌트 적용 후 50.6초→6.7초)이라 수십 개 연속 발행이 성립한다.
- 목표 흐름: **대상 자동 산출 → 담기·배치 → 일괄 발급(진행률) → 자동 메일(컨펌/이의신청) → 컨펌 ack 또는 3일 경과 → 세금계산서 자동 발급(팝빌)**. 사람 개입은 확인과 직접선택(중간정산) 업체뿐.

기존 자산(재사용 — 새 개념 축 없음):
- 발행 단위 축 `billings.scope` = `combined`/`by_user`/`common` + `batch_id` (2026-07-26 ALTER 실측 완료)
- 발행 결과 메일 = `POST /api/admin/billing/:id/send-email` (buildInvoiceLines·정합검사·재발송 409 기보유)
- 계정 목록 = `GET /api/admin/billing/company-users/:companyId` (system 계정 제외 기보유)
- 배치 접수함 선례 = §5-4 충전 요청(`agent_charge_orders`) — 접수 → 처리 → 결과 목록

---

## §1 데이터 모델 (신규 3 + 확장 1)

> ⛔ DDL 실행 전 `information_schema` 검증 의무(db_column_verify_before_code). 아래는 초안이며 컬럼 실존·타입은 실행 시점에 확정한다.

### 1-1. `company_billing_settings` (회사 정산 설정 — 회사당 1행)
| 컬럼 | 타입 | 의미 |
|---|---|---|
| company_id | uuid PK FK companies | |
| issue_scope | varchar(20) NOT NULL DEFAULT 'combined' | 발행 단위 기본값. `combined`(회사 1장)/`by_user`(계정별). **일괄발급 화면 좌우 배치의 기본값** |
| taxbill_day_policy | varchar(20) NOT NULL DEFAULT 'last_day' | 계산서 작성일자 정책. `last_day`(대상월 말일 — 7월분=7/31, 30일 달이면 30일)/`first_day`(익월 1일 — 7월분=8/1)/`manual`(직접선택 — 중간정산 등, 발급 때마다 사람이 지정) |
| updated_at / updated_by | | |

### 1-2. `billing_contacts` (정산 담당자 + 계산서 수신 사업자 — 회사/계정 겸용)
| 컬럼 | 타입 | 의미 |
|---|---|---|
| id | uuid PK | |
| company_id | uuid NOT NULL FK | |
| user_id | uuid NULL FK users | **NULL = 회사 레벨**(전체 발급 수신자 + 계정별일 때 공통 장 수신자). 값 있으면 그 계정의 담당자 |
| contact_name / contact_email | varchar | 정산 담당자 (기존 고객사 담당자명·이메일과 **별개** — 그쪽은 마케팅 담당자로 유지) |
| taxbill_biz_number / taxbill_company_name / taxbill_ceo_name / taxbill_address / taxbill_biz_type / taxbill_biz_item | varchar NULL | **계산서 발급 사업자 등록**(계정별 발급 + 사업장이 다른 계정용). 전부 NULL이면 회사 기본 사업자 정보(companies.business_number 등) 사용 |
| UNIQUE (company_id, user_id) | | user_id NULL 중복은 partial unique index로 차단 |

### 1-3. `invoice_confirmations` (발송·컨펌·이의신청·계산서 추적 — **메일 1통 = 1행**)
| 컬럼 | 타입 | 의미 |
|---|---|---|
| id | uuid PK | |
| billing_id | uuid FK billings | 장 단위. 계정별 회사는 계정 장마다 1행(각자 메일·각자 컨펌·각자 계산서), 공통 장은 회사 레벨 담당자로 1행 |
| company_id / recipient_user_id NULL / recipient_email | | |
| token | varchar UNIQUE | 컨펌/이의신청 링크용 랜덤 토큰(DB 저장·1회성). 로그인 요구 없음 — 담당자가 한줄로 계정이 없을 수 있다 |
| sent_at | timestamptz | 메일 발송 시각. **3일 타이머의 기점** |
| confirmed_at / confirmed_ip | NULL | 컨펌 ack |
| objection_at / objection_text / objection_resolved_at | NULL | 이의신청. 접수 즉시 자동 계산서 제외 |
| taxbill_status | varchar(20) | `pending`(컨펌 대기) → `confirmed`(컨펌됨) / `due`(3일 경과 자동 대상) / `objected`(이의신청 — 제외) / `manual_wait`(직접선택 정책 — 자동 제외, 날짜 지정 대기) → `ready`(발급 큐 — **팝빌 연동 전 종착지**) → `issued` |
| taxbill_issue_date | date NULL | 정책으로 산출된 작성일자(manual은 사람 지정 시 기록) |
| taxbill_due_at | timestamptz | 자동 발급 시각 = **min(sent_at + 3일, 대상월 익월 10일)** — 법정 발급기한 캡 |
| issued_at / popbill_invoice_key | NULL | 팝빌 발급 결과(연동 후) |

### 1-4. `billing_bulk_jobs` + `billing_bulk_job_items` (일괄발급 작업 — 진행률의 원천)
- jobs: id·period_start·period_end·total/done/failed_count·status(`running`/`done`)·created_by·created_at
- items: job_id·company_id·scope(이번 발급에 쓴 값)·status(`pending`/`running`/`success`/`failed`)·error·billing_batch_id
- 진행률 = done/total 폴링. **한 업체 실패는 그 item만 failed** — 나머지를 막지 않는다(부분 실패 허용). 141사를 한 트랜잭션으로 묶지 않는다(§2-7 과잉 차단 함정).

---

## §2 정산 탭 (고객사 상세 — 필터항목 탭 대체)

- 탭 키 `fields`(필터항목, AdminDashboard 6206·7318)를 **`billing`(정산)으로 교체**. Harold 판정 = 의미 없는 메뉴.
  - ⚠ 구현 선행: 필터항목 UI가 저장하는 값의 소비처 grep — UI만 제거하고 데이터·백엔드는 건드리지 않는다(영향 검토 후 확정).
- 구성 (위→아래):
  1. **발행 단위 토글** — 기본 `고객사 전체 발급`. 누르면 `개별(계정별) 발급`.
  2. **회사 정산 담당자** (이름·이메일, 항상 표시) — 전체 발급 수신자이자, 계정별일 때 **공통 장(테스트·스팸·크레딧·요금제) 수신자**.
  3. 계정별 ON 시: 계정 목록(company-users API) 각 행에 담당자 이름·이메일 입력 + **[계산서 사업자 등록]** 버튼 → 모달(사업자번호·상호·대표자·주소·업태·종목). 미등록 계정은 회사 기본 사업자로.
  4. **계산서 발급일자 정책** — 말일 / 익월 1일 / 직접선택.
- 저장 = 1-1·1-2 UPSERT. 이메일 저장된 순간부터 거래내역서 자동 발송 대상이 된다.

## §3 거래내역서 일괄발급 화면 (신설 — 요금/정산 메뉴)

1. **대상월** 기본 = 전월(8월에 열면 7월분).
2. **상단 리스트(페이징)** = `billing_type='postpaid'` AND 그 달 `billings` 0건(발급 안 됨) 회사. 다중선택 → [추가] → 담긴 회사는 상단에서 선택 잠금(중복 차단).
3. **좌우 배치** — 왼쪽 = 고객사 전체(combined), 오른쪽 = 계정별(by_user). 담길 때 기본 위치 = 1-1 `issue_scope`. 좌우 이동 가능(이번 발급에만 적용, 설정은 안 바꿈).
4. **이메일 미등록 뱃지** — 발급은 막지 않는다(발급 차단 = 서수란 업무 차단). 그 회사는 발송·컨펌·계산서 자동화에서 빠짐을 담는 시점에 보여 주고, 결과 화면에 미등록 목록을 남긴다.
5. **[일괄 발급]** → 1-4 job 생성 → 서버 배치가 **순차** 실행(발행 코어는 이미 검증된 `/generate` 로직 — §6 재사용 방식) → **진행표시바**(% = done/total, 폴링).
6. item 성공 시: 수신자별 메일 자동 발송(기존 send-email 코어 재사용) + `invoice_confirmations` 행 생성(token·sent_at·taxbill_due_at 계산). 메일에 **[컨펌하기] [이의신청]** 두 버튼.

## §4 컨펌 / 이의신청 (공개 페이지 — 토큰 인증)

- `GET /invoice/confirm/:token` → **중간 확인 페이지**(회사명·정산월·금액 요약 표시). 메일 클릭 즉시 확정 금지 — 오클릭·전달 사고 차단. 페이지에서 [컨펌] 클릭 → `confirmed_at` 기록 → `taxbill_status='confirmed'` → 슈퍼관리자에 ack 표시.
- [이의신청] → 텍스트 입력(무엇이 이상한지·어떻게 수정하면 좋을지) → `objection_*` 기록 → **`objected` = 자동 계산서 즉시 제외** → 슈퍼관리자 이의신청 목록에 표시.
- **복귀 경로**: 이의 처리(정산 수정) 후 재발급 → 기존 행 무효화 + 새 메일·새 토큰·**타이머 리셋**. 제외만 있고 복귀가 없으면 그 업체는 영원히 계산서가 안 나간다.
- 토큰 만료: 발급(issued) 또는 재발급 무효화 시. 그 외 상시 유효(정산 담당자가 늦게 열 수 있다).

## §5 자동 발급 워커 (cron)

- `pending`이고 `NOW() >= taxbill_due_at` → `due`로 전이. `confirmed`·`due`는 발급 큐로 → **팝빌 연동 전에는 `ready`에서 정지** + 슈퍼관리자 "계산서 발급 대기" 목록 표시.
- `manual_wait`(직접선택 정책)는 **자동 전이 제외** — "날짜 지정 대기" 목록에서 사람이 날짜 입력 후 발급.
- 기한 캡: `taxbill_due_at = min(sent_at+3일, 대상월 익월 10일)`. `objected`가 익월 10일에 접근하면 슈퍼관리자 경고(기한 내 미해소 시 가산세 위험은 사람 판단).

## §6 발행 코어 재사용 (필수 리팩터링)

- 현재 발행 로직은 `routes/billing.ts` `/generate` 핸들러 인라인(86~713). 배치가 이걸 쓰려면 **코어를 `utils/billing-issue.ts`로 추출**하고 라우트·배치 워커가 같은 함수를 부른다(no_inline_duplication).
- 추출은 **동작 무변경 리팩터링**으로 먼저 커밋(대조: 기존 1,426 테스트 + 라우트 불변식 테스트 유지). 그 위에 배치를 얹는다.

## §7-0 팝빌 실문서 요지 (2026-07-28 Harold 제공 HTML 정독 — 계약 직전)

- **단건 발행 = `RegistIssue`(즉시 발행).** 수정세금계산서도 **같은 API**에 `modifyCode`(1~6)+`orgNTSConfirmNum`(당초 국세청승인번호)을 얹어 발행한다. '전송성공' 상태에서만 수정 가능, '전송실패'는 신규 발행.
- **수정사유 6종** — 1 기재사항 착오정정(부+정 **2장**, 기한 제한 없음) · 2 공급가액 변동(±**1장**, 변동일 작성·**익월 10일 기한**) · 3 환입(-1장) · 4 계약의 해제(-1장, 해제일 작성) · 5 내국신용장(무관) · 6 착오 이중발급(-1장, 기한 없음). 팝빌 권장 = 필요한 사유만 구현 → **우리 구현 대상 = 1·2·4·6**.
- **Bulk API** = `BulkSubmit` 1회 최대 100건. `submitID` 36자 **재사용 불가** / 건별 `invoicerMgtKey` **24자**(영문·숫자·`-`·`_`) 우리 발번 / `receiptID` 접수 시 팝빌 발번 / `ntsConfirmNum` 발행 시 할당. 발행은 팝빌 B/G 비동기 — 상태 확인은 **Webhook 권장**(Callback URL), 폴링 가능.
- 우리 선택: 기본 = 단건 `RegistIssue`(컨펌 시점이 제각각), Bulk는 3일 만료 일괄분에 선택 적용(이월 판단).
- `invoicerMgtKey` 발번 규칙(24자 제한 — uuid 32자 초과)은 연동 시 확정. 예: `TU` + YYMMDD + 순번.

### RegistIssue 파라미터 요지 (2026-07-28 발행/전송 API 문서 정독 — 우리 매핑)

- 시그니처: `registIssue(CorpNum, Taxinvoice, WriteSpecification?, Memo?, ForceIssue?, DealInvoiceKey?, EmailSubject?, UserID?)`. **공급자(인비토) 인증서를 팝빌 인증서버에 사전 등록해야 발행 가능.** 발행 시 팝빌 포인트 과금 + 공급받는자에게 발행 메일 자동 발송.
- Taxinvoice 필수 축(우리 값): `issueType='정발행'` · `taxType='과세'` · `chargeDirection='정과금'` · `writeDate=yyyyMMdd`(= `taxbill_issue_date`) · `purposeType='청구'` · `supplyCostTotal`/`taxTotal`/`totalAmount`(**정수 String** — 우리 절사 규칙과 일치) · `invoicerMgtKey`(24자, 정발행 필수 — `taxbill_issues.invoicer_mgt_key`)
- 공급자(invoicer*) = 인비토 고정: corpNum·corpName·CEOName·addr·bizType·bizClass·contactName·email (`config/defaults INVITO_INFO` 재사용 검토)
- 공급받는자(invoicee*) = `billing_contacts` 사업자(없으면 회사 기본): `invoiceeType='사업자'` · corpNum(사업자번호 '-' 제외) · corpName · CEOName · addr · bizType · bizClass · contactName1 · **email1**(= 정산 담당자 이메일 — 팝빌 발행 메일 수신)
- `modifyCode` + `orgNTSConfirmNum` = 수정분에만. `remark1`에 "당초 작성일자" 기재(사유 2·3·4).
- `detailList`(품목) — 우리는 요약 1줄(예: "N월 메시징 이용료")로 시작, `supplyCost`·`tax` 정수.

### SDK·웹훅 요지 (2026-07-28 추가 정독 — 환경설정·웹훅 개요/이벤트·인증·연동절차)

- **SDK 옵션**: `LinkID`·`SecretKey`(연동신청 시 메일 발급) + `IsTest`(true=테스트베드/false=운영, 기본 false) · `IPRestrictOnOff`(기본 true) · `UseStaticIP`(기본 false) · `UseLocalTimeYN`(기본 true). 테스트와 운영은 **완전 분리 환경**(설정 호환 안 됨 — Callback URL도 각각 등록).
- **웹훅**: REST POST. 등록은 팝빌 사이트(테스트=test.popbill.com / 운영=www.popbill.com) > 관리 > Webhook. 포트 80/443/9854만 허용. 인증 옵션 = 미사용(기본)/Basic/`X-Api-Key`. **응답 계약 = HTTP 200 + `"OK"` 또는 `{"result":"OK"}`** — 그 외 전부 실패로 간주, **5분 간격 총 4회 재전송**, 최종 실패분은 팝빌 사이트에서 수동 재실행 가능. 팝빌 Source IP = `54.180.62.221`·`13.124.72.158`(방화벽 화이트리스트).
- **이벤트 페이로드(Issue 기준)**: `corpNum`·`itemKey`(팝빌 식별)·`ntsconfirmNum`(국세청승인번호)·`stateCode`(301 전송전/304 전송완료/305 전송실패)·`issueDT`·**`invoicerMgtKey`(우리 발번 — 우리 행과의 매칭 축)**·`eventType`(Issue/SendToNTS…/MANUAL=사이트 수동 재실행). → 웹훅 수신부는 `invoicerMgtKey`로 `taxbill_issues` 행을 찾아 `nts_confirm_num`·`status`·`issued_at`을 갱신하고 200 "OK"를 돌려준다. **매칭 실패도 200을 돌려주고 로그로 남긴다**(4회 재전송 폭주 방지 — 사후 대사는 Search로).
- 인증(토큰 발급·IP 검증)은 SDK가 내부 처리 — 우리 코드는 LinkID·SecretKey·옵션만 관리.

### 세금계산서 내역 테이블 — `taxbill_issues` (★2026-07-28 추가)

수정발행은 "당초 승인번호에 연결된 새 계산서"라 정산 1건에 원본+수정 N장이 달린다. 컨펌 추적(`invoice_confirmations` — 메일 1통=1행)과 축이 달라 **별도 테이블**이 내역의 진실이다. 내역 페이지(정산 메뉴 안 버튼)는 이 테이블 + 컨펌 현황을 보여준다. 팝빌 연동 전에는 `ready` 대기 행이 여기 쌓이고, 연동 후 발행 결과(`nts_confirm_num`)가 채워진다.

## §7 팝빌 스텁 (오늘) → 연동 (계약 후)

- `utils/taxbill-popbill.ts`: `issueTaxbill(confirmation)` 인터페이스 + ENV 자리(`POPBILL_LINK_ID`·`POPBILL_SECRET`·사업자번호). 오늘은 미구현 예외 대신 **호출부가 `ready`에서 멈추는 구조**라 스텁 호출 자체가 없다.
- 연동 시: 샌드박스(팝빌 테스트베드)에서 전 흐름 실측 → 실발급 전환. 작성일자 = `taxbill_issue_date`. 계정별 사업자 등록(1-2) 있으면 그 사업자로, 없으면 회사 기본.
- 외부 API 원칙: 응답 추측 금지 — raw 확인 후 파싱(feedback_external_api_response_verification).

## §8 구현 순서 (오늘)

1. DDL 초안 → information_schema 검증 → Harold 실행 (신규 4테이블 — 기존 테이블 무변경)
2. §6 발행 코어 추출 (동작 무변경 — 테스트로 고정)
3. §2 정산 탭 (백엔드 UPSERT/조회 + 프론트)
4. §3 일괄발급 화면 + 배치 + 진행률
5. §4 발송 확장(토큰·버튼) + 공개 컨펌/이의신청 페이지
6. §5 워커 + 슈퍼관리자 목록(발급 대기·이의신청·날짜 지정 대기·ack 현황)
7. Codex 리뷰(증분 규칙) → 표준 종료

## §9 종결 상태 (2026-07-28 — Codex 5라운드 SHIP)

**구현 완료(팝빌 실호출 제외 전부)**: DDL 6테이블 → 발행 코어 추출(`utils/billing-issue.ts`, 동작 무변경) → 정산 탭(필터항목 대체) → 일괄발급 화면·배치·진행바 → 발송·컨펌·이의신청(공개 페이지 `/api/invoice-view` — helmet 앞 마운트) → 워커(ready 전이 + `taxbill_issues` 장부 생성) → 사업자등록증 자동입력(vision·크레딧 0). Codex 리뷰 5라운드(1R 15건 → 수용 정정 반복 → 5R SHIP YES). tsc 0·vitest 1,435.

**발송 안전 규격(확정)**: 장별 발송 = 행 잠금(FOR UPDATE) 트랜잭션 + `lock_timeout 10s` + 발송 총 60초 상한. 타임아웃 = 발송 불확정 → 마커만 커밋·추적 행 미생성(도착 불명 메일에 3일 타이머 금지). 이의 접수 = objected 전이 + ready 장부 보류 한 트랜잭션.

### 이월(수용 위험 — 기록)
- **outbox/재발송 체계 없음**: 메일 발송 후 DB 실패 시 죽은 링크(마커는 재적용해 보존). 복구 경로 = 삭제 후 재발행(새 토큰·타이머 리셋). 1R·3R 판정 포함 수용.
- **PDF 첨부·메일 확정 문안** = Harold와 별도 논의 후 교체(현재 초안 — `invoice-confirm.ts` 주석 표기).
- **공개 페이지 토큰**: issued 건은 계속 열람 가능(정당 수신자용·의도), URL 토큰이 서버 접근 로그에 남음(내부 로그 — 수용).
- **필터항목 탭**: UI 진입점만 제거(데이터·백엔드 무변경). `standardFields`/`enabledFields` 상태·저장 배선은 잔존 — 완전 철거는 소비처 grep 후 별건.
- **taxbill_issues 내역 전용 화면**: 현황판(confirmations 축)이 현재 담당. 팝빌 연동 후 원본/수정 장부 목록 + 수정발급 버튼(§7-0 사유 1·2·4·6) 추가.

### 남은 것 (팝빌 연동 시 — §7)
- 공동인증서 등록(팝빌 사이트) → 테스트베드 Webhook URL 등록·테스트포인트 → `utils/taxbill-popbill.ts` RegistIssue 연결(ready 소비) → 웹훅 수신부(`invoicerMgtKey` 매칭·200 "OK") → 수정세금계산서(modifyCode 1·2·4·6) → 운영 전환(`POPBILL_IS_TEST=false`).
- ENV 등록 완료: `POPBILL_LINK_ID`·`POPBILL_SECRET_KEY`·`POPBILL_CORP_NUM`·`POPBILL_IS_TEST=true` (2026-07-28 Harold 직접).
