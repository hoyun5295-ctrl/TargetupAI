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

### 3-1. 전체 담기 · 선택 제외 · 수동 정산완료 (★2026-07-29 Harold 지시 — 구현 완료·DDL 대기)

**계기.** 미발급 91개사가 1열·10개씩 10페이지로 나와 화면 절반이 늘 비어 있었고, 전량을 담으려면 체크·담기를 10번 반복해야 했다. 그런데 그중 몇 곳은 **우리 정산으로 발행 자체가 안 되는 회사**라 전량 담기가 곧 사고가 된다.

**축을 둘로 나눈다.**

| 축 | 저장 위치 | 성격 | 화면 동작 |
|---|---|---|---|
| 이 회사는 자동 발급 대상이 아니다 | `company_billing_settings.manual_billing` | 회사 속성(영구) | 목록에 `수동 정산` 뱃지. **담기에서 빠진다**(전체·선택 양쪽). 목록에서 숨기지는 않는다 |
| 이 달은 사람이 처리했다 | `billing_manual_completions` 1행 | 월 단위 기록 | 그 달 목록에서 빠진다. 헤더 토글에서 사유와 함께 보이고 해제하면 돌아온다 |

- **숨기지 않는 이유** — 회사 속성만으로 목록에서 감추면 "이번 달 그 회사 처리했나"를 아무도 볼 수 없다. 그게 매출 누락이다. 뜨되 안 담기고, 처리했으면 그 화면에서 [수동 정산완료]를 눌러 뺀다.
- **청구서를 만들지 않는다** — 목록에서 빼려고 금액 0짜리 `billings`를 만들면 PDF·세금계산서·매출 집계가 전부 그 가짜 장을 센다. 별도 축으로 두고 목록 쿼리에서만 뺀다. **그 회사 그 달 금액은 시스템에 남지 않는다 — 사유 텍스트가 유일한 근거다.**
- **겹침 판정은 `billings`와 같은 식** (`period_start <= end AND period_end >= start`). 축이 다르면 중간정산처럼 기간이 어긋나는 조회에서 대상이 화면마다 달라진다.
- **이미 발행된 회사는 기록을 막는다** — 청구서가 있는데 "수동으로 끝냈다"가 함께 남으면 나중에 어느 쪽이 진실인지 알 수 없다. 건너뛴 회사명을 응답으로 돌려 화면이 그대로 알린다.
- **재조회는 담긴 목록을 지우지 않는다** — 수동완료·해제 뒤 목록을 다시 읽을 때 `keepPicked`로 좌/우 pane을 보존한다. 담아둔 뒤 남은 회사를 수동완료로 표시하면 애써 담은 수십 개사가 통째로 날아가기 때문. 발급 job 완료 후 재조회만 전체를 비운다.
- **화면** — 2열 그리드·페이지당 20(91개사 = 10페이지 → 5페이지), 페이지 전체선택, `전체 N개사 담기 (수동 M 제외)`, 담긴 pane에 체크박스 + `선택 빼기` + `max-h-80` 내부 스크롤(전량 담아도 [일괄 발급 시작]이 화면 밖으로 밀리지 않게).

## §4 컨펌 / 이의신청 (공개 페이지 — 토큰 인증)

### 4-0. 내역은 첨부 PDF, 화면은 컨펌만 (★2026-07-28 Harold 지시로 재설계)

**메일에 거래내역서 PDF를 첨부한다.** 그 전까지는 첨부가 없어서 웹페이지에서 항목표를 다시 그려야 했고,
그 결과 화면이 "검토"와 "컨펌"을 겸하면서 버튼이 `거래내역서 확인 · 컨펌하기`라는 합성 라벨이 됐다 —
누르는 순간 컨펌되는 것처럼 읽힌다. 액션이 다르면 화면도 갈라야 한다.

- **메일**: PDF 첨부 + 금액 한 줄 + 버튼 **하나**(`컨펌하기`). 발신 = 고객문의와 같은 SMTP 계정, 표시명 `한줄로`, 회신 = `INVITO_INFO.email`.
- **첨부 단위 = 장(`billings` 행)**. 전체 발급이면 회사 한 장, 계정별이면 계정 장 각각(+공통 장) — 계정 담당자는 자기 계정 PDF만 받는다.
- **묶음 preflight (★Codex 적대검증 수용)** — 첫 SMTP 호출 **전에** 회사의 모든 장을 정합 검사하고 PDF까지 만든다.
  하나라도 막히면 **그 회사는 한 통도 보내지 않는다**. 장별로 검사하며 보내면 계정별 발행에서 앞 장만 나가고
  뒤 장이 막히는 부분 발송이 되는데, 그때 정상 장에는 이미 3일 타이머가 걸려 있고 기간 중복 가드 때문에
  막힌 장만 따로 재발행할 수도 없다 — 복구하려면 이미 받은 고객에게 다시 보내거나 묶음을 통째로 지워야 한다.
- **차단 사유는 두 축으로 나눠 센다** (뭉치면 일시적 장애에도 멀쩡한 묶음을 지우고 재발행하게 된다):
  - `mismatchBlocked` = 항목합 ≠ 공급가액. 금액을 정정한 뒤 장을 삭제하고 재발행.
  - `renderFailed` = 조회·렌더·디스크 장애. 금액은 정상이니 장애 해소 후 그대로 삭제·재발행.
  - `heldBack` = 위 둘 때문에 함께 보류된 정상 장 수. 보류로 끝난 PDF는 조기 반환 전에 지운다(첨부되지 않았고 경로가 DB에 남지도 않아 복구에 못 쓴다).

### 4-1. 미발송 재시도 + 묶음 발송 잠금 (★2026-07-28 — Codex 2R 수용, 구현 완료)

**재시도 경로.** 발행은 메일 단계보다 **먼저 커밋된다.** 그래서 발송이 막히면 장은 남고 메일·컨펌 행·타이머만 없는
상태가 되는데, 일괄발급을 다시 돌리면 기존 장 때문에 `BILLING_PERIOD_OVERLAP`에 먼저 막혀 재시도할 길이 없었다.
⇒ `POST /bulk/retry-confirmations`(body **`billing_id`**)로 **발행은 그대로 두고 컨펌 단계만 다시 태운다.**
화면은 정산 목록의 `메일 재시도` 버튼(`emailed_at IS NULL`인 모든 행에 노출).

⚠ **입력은 `batch_id`가 아니라 장 id다.** `batch_id`는 `sheets.length > 1`일 때만 생긴다(`billing-issue.ts:426`) —
기본 단위인 전체 발급은 장이 하나라 `batch_id`가 NULL이고, batch 기준으로만 받으면 **가장 흔한 경우에 복구 버튼이 닿지 않는다.**
장이 묶음의 일부면 형제 장까지 함께 태운다(부분 발송을 만들지 않는다).

멱등은 **두 겹**이다.
1. 대상 조회에서 `emailed_at IS NULL` **그리고** 살아 있는 confirmation 없음을 동시에 만족하는 장만 고른다.
2. 그것만으로는 부족하다 — 대상 조회는 회사 잠금 **밖**에서 돌기 때문에 두 요청이 같은 장을 집어올 수 있다.
   그래서 **잠금을 쥔 뒤 발송 직전에 같은 조건을 다시 본다**(`FOR UPDATE` + `emailed_at`/confirmation 재확인).
   뒤늦게 잠금을 받은 쪽은 여기서 걸러져 `alreadySent`로 세고 메일을 보내지 않는다.

**묶음 발송 잠금.** 장별 `FOR UPDATE`만으로는 묶음 단위 all-or-nothing이 성립하지 않는다 — 장 사이 틈에 삭제가
끼어들면 첫 장은 이미 나가고 다음 장이 0행으로 멈춘다. **첫 고객 메일은 회수할 수 없고 그 컨펌 링크는 삭제된 장을 가리킨다.**
⇒ 발송 2단계 전체를 회사 단위 advisory lock으로 감싼다.

| | 형태 | 이유 |
|---|---|---|
| 발송 | `pg_advisory_lock(hashtext(company), hashtext('billing-send'))` · 전용 커넥션 | 장마다 트랜잭션을 새로 열므로 `_xact_` 판으로는 안 된다 |
| 삭제 | `pg_try_advisory_xact_lock` 같은 키 → 실패 시 409 `BILLING_SEND_IN_PROGRESS` | 기다리면 삭제가 몇 분씩 멈춘다 |

발행 잠금(`hashtext('billing')`)과 두 번째 키가 달라 서로를 막지 않는다. 해제 실패 시 커넥션을 폐기한다 —
세션 잠금이라 오염된 커넥션이 풀로 돌아가면 다음 발송·삭제가 영원히 막힌다.

⚠ **발송 루프는 잠금을 쥔 그 커넥션으로 트랜잭션을 연다.** 장마다 `pool.connect()`를 또 하면 잠금 커넥션이
한 자리를 문 상태에서 두 번째 자리를 요구한다 — 풀이 작거나 같은 회사 잠금을 기다리는 요청들이 자리를 채우면
발송 중간에 커넥션을 못 얻어 결국 부분 발송이 된다. 세션 잠금은 커넥션에 붙으므로 같은 커넥션에서 트랜잭션을 열어도 유지된다.

**나가지 않은 렌더본은 전부 지운다.** 보류·중복 차단·메일 실패·루프 중 예외 어느 경로든, 실제로 나갔거나
나갔을 수 있는(발송 불확정) 첨부만 남기고 나머지는 바깥 `finally`에서 정리한다.

  ⚠ 카운터를 나눈 이유는 복구 방법이 달라서가 아니라 **금액 정정이 선행되어야 하는지**가 달라서다.
  재시도 경로가 생긴 지금, `renderFailed`는 장애 해소 후 `메일 재시도`로 풀리고 `mismatchBlocked`는 금액 정정이 먼저다.
- 이메일 미등록(`skippedNoEmail`)은 그 장만 자동 발송에서 빠지는 정상 경로다 — 묶음을 멈추지 않는다.
- **화면**: 회사명·기간·금액 요약 + `컨펌하기` 버튼 하나. 항목표를 다시 그리지 않는다(내역의 진실은 PDF 하나).
  이의신청은 같은 무게의 버튼이 아니라 아래 작은 링크로 둔다.

- `GET /api/invoice-view/:token` → 요약 + [컨펌하기]. **메일 링크(GET)만으로는 절대 확정하지 않는다** — 보안 스캐너·메일 클라이언트가 링크를 미리 열면 사람이 누르지 않은 컨펌이 찍힌다. 사람이 버튼을 눌러 보내는 POST 하나만 컨펌으로 친다.
- [컨펌하기] → `confirmed_at` 기록 → `taxbill_status='confirmed'` → 슈퍼관리자에 ack. **바뀐 행이 0이면 성공이라고 답하지 않는다**(409) — 상태 점검과 UPDATE 사이 경합에서 지면 화면만 "완료"가 되던 자리다(6원칙 ②).
- [이의신청] → 텍스트 입력(무엇이 이상한지·어떻게 수정하면 좋을지) → `objection_*` 기록 → **`objected` = 자동 계산서 즉시 제외** → 슈퍼관리자 이의신청 목록에 표시. 여기도 `rowCount` 0이면 409.
- **복귀 경로**: 이의 처리(정산 수정) 후 재발급 → 기존 행 무효화 + 새 메일·새 토큰·**타이머 리셋**. 제외만 있고 복귀가 없으면 그 업체는 영원히 계산서가 안 나간다.
- 토큰 만료: 발급(issued) 또는 재발급 무효화 시. 그 외 상시 유효(정산 담당자가 늦게 열 수 있다).

## §5 자동 발급 워커 (cron)

- `pending`이고 `NOW() >= taxbill_due_at` → `due`로 전이. `confirmed`·`due`는 발급 큐로 → **팝빌 연동 전에는 `ready`에서 정지** + 슈퍼관리자 "계산서 발급 대기" 목록 표시.
- `manual_wait`(직접선택 정책)는 **자동 전이 제외** — "날짜 지정 대기" 목록에서 사람이 날짜 입력 후 발급.
- 기한 캡: `taxbill_due_at = min(sent_at+3일, 대상월 익월 10일)`. `objected`가 익월 10일에 접근하면 슈퍼관리자 경고(기한 내 미해소 시 가산세 위험은 사람 판단).

### 5-1. 공급받는자 사업자 우선순위 (★2026-07-28 확정 — 팝빌 호출부가 지킬 규칙)

발급 시 사업자 정보는 **아래 순서로 처음 채워진 곳을 쓴다.** 세 곳을 섞지 않는다 — 섞으면 상호는 A, 주소는 B가 되어 계산서가 틀린다.

1. `billing_contacts` 계정 행(`user_id = 그 계정`)의 `taxbill_*` — 계정별 발급이고 사업장이 다른 계정
2. `billing_contacts` 회사 행(`user_id IS NULL`)의 `taxbill_*` — 정산 탭 "계산서 발급 사업자 (회사 기본)"
3. `companies.business_number` / `ceo_name` / `address` — 기본정보 탭. 위 둘이 비었을 때의 바닥값

판정 기준은 **`taxbill_biz_number`가 채워졌는가** 하나다(그 행을 통째로 쓴다). 부분 채움을 병합하지 않는다.

⚠ 거래내역서·청구서 PDF(`routes/billing.ts` 5곳)는 지금 **3번(`companies`)만** 본다. 회사 행에 사업자를 등록한 회사는
PDF와 계산서의 상호가 갈릴 수 있다 — PDF를 같은 우선순위로 옮기는 것은 팝빌 호출부와 **함께** 한다(그때까지는 3번이 계속 진실).

## §6 발행 코어 재사용 (필수 리팩터링)

- 현재 발행 로직은 `routes/billing.ts` `/generate` 핸들러 인라인(86~713). 배치가 이걸 쓰려면 **코어를 `utils/billing-issue.ts`로 추출**하고 라우트·배치 워커가 같은 함수를 부른다(no_inline_duplication).
- 추출은 **동작 무변경 리팩터링**으로 먼저 커밋(대조: 기존 1,426 테스트 + 라우트 불변식 테스트 유지). 그 위에 배치를 얹는다.

### 6-1. PDF 생성 CT + 파일명 규칙 (★2026-07-28)

PDF 생성기도 라우트 인라인이었고, 그래서 **일괄발급 경로에는 PDF 생성이 아예 없었다**(컨펌 메일이 첨부를 못 붙인 원인).
`utils/billing-pdf.ts`로 추출해 다운로드·메일·일괄발급이 같은 함수를 쓴다. 조회도 `loadBillingStatementData` 하나로 모아
라우트와 메일이 **같은 행·같은 정렬**을 쓰게 했다(정렬 tie-breaker 하나만 갈려도 두 문서의 줄 순서가 달라진다).

**표시 이름과 디스크 경로를 나눈다.**

| | 형식 | 이유 |
|---|---|---|
| 표시(고객이 봄) | `거래내역서_{회사명}_{기간}.pdf` | 첨부·`Content-Disposition`. 문서 이름은 화면·메일과 같은 말을 쓴다 |
| 디스크 | `billing_{id8}_{YYYYMMDDHHmmss}_{rand}.pdf` | 렌더마다 새 파일 |

디스크 이름을 표시 이름과 같이 쓰면 ① 같은 장을 동시에 렌더할 때(배치 중 다운로드·재발송) 한 파일에 두 스트림이 붙어 PDF가 깨지고,
② 재발행이 이전 문서를 덮어써 **"그때 고객에게 보낸 문서"의 서버 사본이 사라진다**(세금계산서 분쟁의 증거).

**메일 라우트는 파일 존재를 추측하지 않는다.** 예전에는 파일명 규칙을 재구성해 `existsSync`로 찾고 없으면 "먼저 다운로드하라"고 400을 줬다 —
규칙이 바뀌면 조용히 깨지고 운영자가 순서를 외워야 했다. 지금은 CT로 직접 렌더해 항상 최신 문서가 나간다.

**미발송 장 찾기**: 정합 검사로 발송이 막힌 장은 `invoice_confirmations` 행이 없어 컨펌 추적 목록에 뜨지 않는다.
정산 목록의 `발행됨 · 미발송만` 필터(`billings.emailed_at IS NULL`)가 유일한 회수 경로다.

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

## §9 종결 상태 (2026-07-28 — Codex 5라운드 SHIP · ★배포완료)

**구현 완료(팝빌 실호출 제외 전부)**: DDL 6테이블 → 발행 코어 추출(`utils/billing-issue.ts`, 동작 무변경) → 정산 탭(필터항목 대체) → 일괄발급 화면·배치·진행바 → 발송·컨펌·이의신청(공개 페이지 `/api/invoice-view` — helmet 앞 마운트) → 워커(ready 전이 + `taxbill_issues` 장부 생성) → 사업자등록증 자동입력(vision·크레딧 0). Codex 리뷰 5라운드(1R 15건 → 수용 정정 반복 → 5R SHIP YES). tsc 0·vitest 1,435.

**발송 안전 규격(확정)**: 장별 발송 = 행 잠금(FOR UPDATE) 트랜잭션 + `lock_timeout 10s` + 발송 총 60초 상한. 타임아웃 = 발송 불확정 → 마커만 커밋. 이의 접수 = objected 전이 + ready 장부 보류 한 트랜잭션.

### §9-1. 통지 파이프라인 재구성 (2026-07-29 배포완료 — 근본 수정)

**바뀐 것**: 통지 추적행을 **메일보다 먼저** 만든다(적재/전송 분리 — §4-1). 그전에는 발송이 성공한 뒤에야 만들어서
"이 장이 통지됐는가"의 진실이 메일 뒤에만 생겼고, 중간에 무엇이 어긋나도 상태가 남지 않았다.

**이것이 네 증상의 공통 뿌리였다** — 부분 발송 · 중복 발송 · 고아 PDF · 커넥션 고갈. Codex 3라운드에 걸쳐
preflight → 회사 세션 advisory lock → 발송 직전 재확인 → 렌더본 추적을 하나씩 덧댔지만 다음 구멍이 계속 나왔다.
구조를 바꾸자 **덧댄 장치가 전부 필요 없어져 삭제됐다**(`prepared`·`pg_advisory_lock`·`trySendLockInTx`·
`keptPaths`·`heldBack`·`alreadySent`·삭제 라우트의 `BILLING_SEND_IN_PROGRESS`). 코드가 늘지 않고 줄었다.

**함께 들어간 것**: PDF 생성 CT 추출(`utils/billing-pdf.ts` — 일괄발급에 PDF 생성 자체가 없어 컨펌 메일이 첨부를
못 붙이던 원인) + 표시 이름/디스크 경로 분리(§6-1) · 컨펌 메일 PDF 첨부 + 버튼 하나 · 공개 페이지 컨펌 전용화 +
`rowCount` 0이면 409 · **마감을 발송일 기준 3일 뒤 09:00 KST로**(Harold 지시 — 시각이 아니라 날짜로 자른다) ·
미발송 재시도 경로(`billing_id` 기준) · 회사 레벨 계산서 사업자 저장 + 사업자번호 10자리 검증 · 문서 이름 `거래내역서` 통일.

**검증**: backend tsc 0 · frontend tsc 0 · **vitest 1,468**(114파일) · harness-check 통과.
⚠ **이 재구성분은 Codex 검토를 받지 못했다** — 4·5차가 런타임 장애로 무산됐다(판정법 = `status/COLLAB.md` §3-1).
남은 자체 확인 위험 두 가지는 §4-1에 적어둔 적재 트랜잭션 길이(삭제와의 데드락 여지)와 발송 불확정 시 마감이 적재일 기준으로 남는 점.

### 이월(수용 위험 — 기록)
- **outbox/재발송 체계 없음**: 메일 발송 후 DB 실패 시 죽은 링크(마커는 재적용해 보존). 복구 경로 = 삭제 후 재발행(새 토큰·타이머 리셋). 1R·3R 판정 포함 수용.
- **PDF 첨부·메일 확정 문안** = Harold와 별도 논의 후 교체(현재 초안 — `invoice-confirm.ts` 주석 표기).
- **공개 페이지 토큰**: issued 건은 계속 열람 가능(정당 수신자용·의도), URL 토큰이 서버 접근 로그에 남음(내부 로그 — 수용).
- **필터항목 탭**: UI 진입점만 제거(데이터·백엔드 무변경). `standardFields`/`enabledFields` 상태·저장 배선은 잔존 — 완전 철거는 소비처 grep 후 별건.
- **taxbill_issues 내역 전용 화면**: 현황판(confirmations 축)이 현재 담당. 팝빌 연동 후 원본/수정 장부 목록 + 수정발급 버튼(§7-0 사유 1·2·4·6) 추가.

### 남은 것 (팝빌 연동 시 — §7)
- 공동인증서 등록(팝빌 사이트) → 테스트베드 Webhook URL 등록·테스트포인트 → `utils/taxbill-popbill.ts` RegistIssue 연결(ready 소비) → 웹훅 수신부(`invoicerMgtKey` 매칭·200 "OK") → 수정세금계산서(modifyCode 1·2·4·6) → 운영 전환(`POPBILL_IS_TEST=false`).
- ENV 등록 완료: `POPBILL_LINK_ID`·`POPBILL_SECRET_KEY`·`POPBILL_CORP_NUM`·`POPBILL_IS_TEST=true` (2026-07-28 Harold 직접).
