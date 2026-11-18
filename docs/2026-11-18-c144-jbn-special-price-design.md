# C144 JBN 특별가 설계서 (2026-11-18)

> 접수 = Harold 1118 「JBN(중진공 대출 대표 모임 약 297명)에 한줄로 홍보 · JBN 대표는 요금제 월 구독료 30% 평생 할인」.
> 목업(버리는 파일) = `docs/mockups/2026-11-18-jbn-page-mockup.html`(전용 신청 페이지) · `docs/mockups/2026-11-18-jbn-admin-mockup.html`(슈퍼관리자 「JBN 회원」).
> 진행 = Harold 1118 「설계안 써 · 코덱스리뷰 닫힐 때까지 · 구현 · 구현 코덱스리뷰 닫힐 때까지 · 단톡방 멘트 · 포스터」.

## §0 접수 대조표 (축이 빠지면 닫히지 않는다)

| # | 접수(Harold 원문 요지) | 닫히는 조건 | 이 설계의 자리 |
|---|---|---|---|
| 1 | 단톡방 홍보 멘트 + 깔끔한 포스터 | 멘트 1편(꺾쇠 「」 0 · 마침표 0 · 쉼표만) + 포스터 1장(생성 모델 실물 · 흰 바탕 검정 주황 · 프리텐다드) | §9 |
| 2 | 슈퍼관리자 JBN 전용 요금제 · 직원이 JBN 요금으로 설정하면 월 납부금액만 30% 할인 · 선불 · 후불(후불은 정산서 구독료 줄이 할인 금액) | 요금제마다(스타터 ~ 엔터프라이즈) JBN 판 요금제 행 · 월정액 = 원 요금제 × 0.7 · 직원이 기존 고객사 화면에서 그 요금제를 고르면 선불 차감 · 후불 정산이 그 값을 읽는다 | §2 · §3-3 · §5 |
| 3 | 메시지 요금 = 가장 저렴하게(문구만 · 숫자 비공개 · 실제 단가는 직원이 회사마다 직접 입력 · 선불 / 후불 다름) | 페이지 · 멘트 · 포스터 문구 「온라인 최저가 수준」 · 단가는 시스템이 넣지 않는다(기존 단가 설정 화면 그대로) | §4-1 · §9 · §8 |
| 4 | JBN 전용 신청 페이지(링크로만 · 30% 는 그 링크에서만 보인다) | 공개 주소 `/jbn`(검색 제외 · 어디에도 걸지 않음) · 가격은 서버의 JBN 요금제 행에서 읽음 · 신청 저장 | §3-1 · §4-1 |
| 4-1 | (1118 추가) JBN 회원 확인용 단톡방 닉네임 수집 | 신청 폼 필수 칸 | §3-1 · §4-1 |
| 4-2 | (1118 추가) 슈퍼관리자 별도 메뉴에서 회원 체크 · ceo, suran 만 | 「JBN 회원」 탭 · 회원 확인 · 회사 연결 · 열람 = 소개 방문 · 시연 요청과 같은 관문(`isIntroLeadsViewer`) | §3-2 · §4-2 |
| 4-3 | (1118) 일반 요금표 · 추천 · 고객 화면에 JBN 가격 노출 0 | 공개 요금제 목록 · 진단 추천 · 무료 수량 표 = 공개 요금제만 | §3-3 |

## §0-1 미가입 · 직접발송만 쓰는 회사 = 동작 변화 0 (설계 맨 앞 기준)

| 바뀌는 길 | 바뀐 것 | JBN 요금제가 아닌 회사에서 왜 0 인가 | 증명 시험 |
|---|---|---|---|
| `GET /api/plans`(공개 요금표 · 요금제 안내 · 체험 권유 창) | WHERE 에 「제휴 요금제 아님」 조각 | 기존 행은 전부 `partner_code` NULL → 같은 행 · 같은 순서 · 같은 칸 | 실 PG: DDL · DML 전후 결과 행 집합 동일 |
| 진단 추천 후보(`DIAGNOSIS_PLAN_ROWS_SQL`) | 같은 조각 | 위와 같음 | 실 PG: 전후 동일 |
| 요금제별 무료 수량(`readPlanFreeQuotas`) | 같은 조각 | 위와 같음 | 실 PG: 전후 동일 |
| 슈퍼관리자 회사 등록 · 상세의 요금제 고르기 | 읽는 주소 `/api/plans` → `/api/admin/plans`(활성만 · 같은 정렬) | 고객 화면 아님(ceo · 직원) · 보이는 항목에 JBN 판 다섯 줄이 더해질 뿐 기존 선택값 · 저장 경로 무변 | 단위: 소스 계약 |
| 공개 `/api/public/jbn/*` · `/jbn` 화면 · 「JBN 회원」 탭 · 새 표 | 새로 생김 | 기존 회사가 부르지 않는다 · 쓰는 표가 새 표 하나 | 실 PG: 신청 · 확인 · 연결이 companies · plans · 발송 표를 쓰지 않음 |
| 발송 · 차감 · 정산 · 결과(`campaigns.ts` · `spam-filter.ts` · `messageUtils.ts` · `results.ts` · `billing.ts` · `plan-term.ts` · `billing-issue.ts`) | **무수정** | 코드 0줄 | diff 파일 목록 |

## §1 흐름 표 (누가 · 무엇을 · 어디에 남기나)

| 단계 | 누가 | 어디서 | 판정 자리 | 남는 곳 |
|---|---|---|---|---|
| ① 링크 열기 | JBN 대표 | `hanjul.ai/jbn` | 없음(공개) | 없음 |
| ② 가격 보기 | 화면 | `GET /api/public/jbn/plans` | JBN 행 = `partner_code='JBN' AND is_active` · 정가 = 원 요금제(`base_plan_id`) 행 | 없음 |
| ③ 신청 | JBN 대표 | `POST /api/public/jbn/apply` | `parseJbnApplication`(회사명 · 성함 · 닉네임 · 휴대폰 · 동의 필수 · 관심 요금제는 JBN 행의 원 코드만) · 숨은 칸 · IP 한도 | `jbn_applications`(status pending) |
| ④ 회원 확인 | ceo · suran | 「JBN 회원」 탭 상세 창 | `isIntroLeadsViewer` · 조건부 UPDATE(요청이 본 상태와 같을 때만 · 연결된 신청은 확인 해제 불가) | status verified / rejected · 누가 · 언제 · 사유 · 감사 기록 |
| ⑤ 회사 연결 | ceo · suran | 같은 창 | 확인된 신청만 · 있는 회사만 · 요청이 본 직전 연결값과 지금 값이 같을 때만(두 관리자 덮어쓰기 차단) | company_id · 누가 · 언제 · 감사 기록 |
| ⑤-1 신청 지우기(본인 요청 등) | ceo · suran | 같은 창 | 관문 · 확인 창 | 행 삭제 · 감사 기록(개인정보 없이 id 만) |
| ⑤-2 보관 기한 | 시스템 | 하루 한 번 | 신청 90일 지나면 IP 지움 · 1년 지나면 행 삭제(동의 문구 「1년 뒤 파기」 · 수집 항목 전부) | 없음(특별가 적용 여부는 회사 요금제가 진실 · 행이 없어도 적용 중 목록에 나온다) |
| ⑥ 요금제 바꾸기 | ceo · suran | **기존** 고객사 상세 · 요금제 칸(JBN 판 고르기) | 기존 회사 수정 경로 그대로(선불 이용 기간 회사 409 · 체험 · 이력 · 광고 관문 같은 트랜잭션) | companies.plan_id · company_plan_changes |
| ⑦ 단가 넣기 | 직원 | **기존** 단가 설정 | 기존 그대로(선불 · 후불에 맞춰 직접) | companies.cost_per_* |
| ⑧ 청구 | 시스템 | 선불 = plan-term 결제 · 후불 = 정산서 | 기존 그대로 · `plans.monthly_price` · `company_plan_changes.to_monthly_price` 스냅샷이 JBN 판 금액 | 기존 원장 |

⑥ 을 JBN 탭에 따로 만들지 않는 이유: 회사 수정 경로가 요금제 변경의 돈 규칙(선불 이용 기간 잠금 · 체험 CT · 이력 · 광고 관문)을 한 트랜잭션에 쥐고 있다. 같은 일을 하는 두 번째 길은 그 규칙의 두 벌이 된다(no_inline_duplication). 목업의 「JBN 특별가 적용」 단추는 「회사 연결」 + 「고객사 상세에서 요금제를 JBN 판으로 바꾸면 이 줄이 특별가 적용 중으로 넘어온다」 안내로 바뀐다.

탭의 단계(서버가 계산 · 화면은 그리기만):
- 특별가 적용 중 = 지금 요금제가 JBN 판인 회사(companies JOIN plans · 신청이 없어도 나온다 · 신청이 연결돼 있으면 닉네임 등을 붙인다)
- 회원 확인됨 = status verified 이고 연결 회사가 JBN 판 요금제가 아님
- 확인 전 = status pending
- 회원 아님 = status rejected

## §2 데이터

### §2-1 C144-DDL-1 (배포 **뒤** · 옛 코드가 돌 때 JBN 행이 공개 목록에 섞이지 않게)

SQL 원문 = `status/DEPLOY-LEDGER.md` 의 `ddl:C144-DDL-1` 블록(원장 한 곳 · 여기에는 옮겨 적지 않는다). 요지 = plans 에 `partner_code varchar(20)` · `base_plan_id uuid FK plans` · 둘이 함께 NULL 이거나 함께 값인 CHECK · 표 `jbn_applications`(id = 화면이 만든 uuid · 기본값 없음 · 칸은 status/SCHEMA.md).

### §2-2 C144-DML-1 (DDL-1 바로 뒤 · 공개 유료 요금제마다 JBN 판 한 줄 · 멱등)

SQL 원문 = `status/DEPLOY-LEDGER.md` 의 `dml:C144-DML-1` 블록. 요지 = BEGIN · 고정표 잠금 · 공개 유료 활성 요금제마다 JBN 판 복제(`jsonb_populate_record` 통째 복사 + 코드 · 이름 · 월정액 0.7 · 제휴 칸 덮어쓰기 · 멱등) · 원 요금제의 그 달 고정값 복사 · COMMIT.

- 한 트랜잭션(Codex 설계 2R high): JBN 행과 그 행의 월 크레딧 고정값이 같은 커밋에 보인다. 커밋 전에는 다른 연결의 월초 고정(`monthCredits` snapshot = `INSERT … SELECT FROM plans`)이 JBN 행을 볼 수 없어 지금 값으로 먼저 고정하지 못한다. 고정표를 SHARE ROW EXCLUSIVE 로 잠가 복사하는 동안 원 요금제의 고정값이 새로 들어오지 못하게 한다(복사가 보는 고정값 = 커밋까지 그대로). 중간에 실패하면 전부 되돌아가 다시 실행해도 같다.

- 기능 칸(고객 DB · AI · CDP · 상위 등급 · 크레딧 · 무료 수량 등)은 원 요금제를 통째로 복사한다(STAFF 신설 0728 과 같은 방식 · 칸 나열 0 = 빠짐 구조적 차단).
- 대상 행은 코드명이 아니라 조건으로 고른다. 배포 앞 C144-P0 에서 그 조건의 행이 스타터 ~ 엔터프라이즈 다섯 줄인지 본다(다르면 멈춘다).
- 월 크레딧 고정표(`plan_month_credits`): `monthCredits` 는 지금 `plans` 값 위에 그 달 고정값을 덮는다 → 원 요금제에 그 달 고정값이 있고 지금 값과 다르면 JBN 판(고정값 없음)만 지금 값을 받는다(Codex 설계 1R high). 그래서 같은 DML 에서 원 요금제의 고정값 행을 JBN 코드로 그대로 복사한다(있는 달 전부 · 멱등). 그 뒤의 달은 기존 월초 고정(snapshot)이 JBN 행의 지금 값(= 복사 시점 원 요금제 값)으로 넣는다.
- 원 요금제의 가격 · 월 크레딧 · 기능 칸을 나중에 바꾸면 JBN 판은 저절로 따라가지 않는다(ponytail · 바꿀 때 요금제 관리에서 JBN 줄도 고친다 · 탭 오른쪽 칸에 정가와 JBN 가격을 나란히 보여 어긋나면 보인다).

### §2-3 회사 병합 축

`company-merge.ts COMPANY_MERGE_AXES` 에 `jbn_applications` = move(회원 확인 · 특별가 이력이 살아 있는 회사를 따라간다). 미등재면 연결된 신청이 있는 회사의 병합이 차단된다(fail-closed).

## §3 서버

### §3-1 공개 `routes/jbn-public.ts` → `app.use('/api/public/jbn')`

- `GET /plans` = `loadJbnPlans()` → `[{ code(원 코드), name(원 이름), basePrice, price, credits }]` · 가격 오름차순 · 표 · 칸이 없으면(DDL 전) 503 `DB_MIGRATION_PENDING`.
- `POST /apply` = 숨은 칸(`website`)이 차 있으면 저장 없이 성공처럼 · `parseJbnApplication` 400 · `insertJbnApplication` · DDL 전 503 · 그 밖 500(저장 안 된 신청을 접수됐다고 하지 않는다). IP 한도 = 소개 페이지 시연 요청과 같은 값(`INTRO_RATE.request` 10분 5회). 화면이 신청 하나에 id(uuid) 를 한 번 만들어 싣고 서버는 그 id 로 `INSERT … ON CONFLICT (id) DO NOTHING` = 다시 눌러도 · 응답을 못 받고 다시 보내도 한 행.
- 관심 요금제 = 지금 활성 JBN 행의 원 코드 중 하나만 저장 · 그 밖은 NULL(아직 모름).

### §3-2 슈퍼관리자 `routes/admin.ts`(열람 · 조작 = `isIntroLeadsViewer` · ceo, suran)

- `GET /jbn/access` → `{ allowed }`(메뉴 노출)
- `GET /jbn/overview?stage=&q=` → `{ counts, rows, plans, recent }`(단계 계산 = §1 · 찾기 = 회사명 · 성함 · 닉네임 · 번호 · 단계당 최근 500 · JBN 요금제 표 = 정가 · JBN 가격 · 쓰는 회사 수 · 최근 처리 8 = 감사 기록)
- `POST /jbn/applications/:id/status` `{ from, to, reason? }` → 허용 = pending→verified · pending→rejected · rejected→pending · verified→pending(연결 없을 때만) · `WHERE id AND status = from AND (to <> 'pending' OR company_id IS NULL)` 조건부 UPDATE · 0행 = 409 + 지금 행
- `POST /jbn/applications/:id/link` `{ companyId | null, expectedCompanyId | null }` → `WHERE id AND status = 'verified' AND company_id IS NOT DISTINCT FROM expectedCompanyId` · 회사 존재 확인 · 0행 = 409 + 지금 행(두 관리자 · 오래 열린 화면의 덮어쓰기 · 해제 차단)
- `DELETE /jbn/applications/:id` → 행 삭제(본인 요청 등) · 감사 기록에는 id 만
- 모든 오류 갈래: 칸 · 표 없음 = 503 `DB_MIGRATION_PENDING`(db_alter_safety_net) · 권한 없음 403

### §3-3 공개 요금제 거르기 = CT 조각 하나

`utils/plan-guard.ts` 에 `publicCatalogPlanSql(alias)` = `(to_jsonb(alias) ->> 'partner_code') IS NULL`(칸이 없을 때도 참 = DDL 전후 같은 결과). 읽는 자리 셋에서 이 조각만 쓴다: `routes/plans.ts GET /` · `utils/marketing-diagnosis-store.ts DIAGNOSIS_PLAN_ROWS_SQL` · `utils/free-messaging.ts readPlanFreeQuotas`. 계약 시험이 세 자리의 조각 사용과 그 밖의 공개 목록 SQL 잔존 0 을 본다.

### §3-4 보관 기한(개인정보)

`utils/jbn.ts purgeJbnApplicationPii()` = 한 문장 둘(90일 지난 행의 IP NULL · 1년 지난 행 삭제 = 회사명을 포함한 수집 항목 전부 · Codex 설계 2R) · 감사 기록에는 지운 건수만 · 기동 1분 뒤 + 24시간마다(`startJbnRetentionWorker` · app.ts 기동부 · 표 · 칸이 없으면 조용히 넘김). 브라우저 정보(user agent)는 저장하지 않는다. 동의 문구 = 「수집 항목: 회사명, 성함, JBN 단톡방 닉네임, 휴대폰 번호, 접속 IP / 목적: JBN 회원 확인, 도입 상담 연락 / 보관: 신청일로부터 1년 뒤 파기(접속 IP 는 90일)」.

## §4 화면

### §4-1 공개 `pages/JbnPage.tsx` · `/jbn`

- 목업 그대로(첫 화면 · 이런 분께 · 기능 셋 · 특별가 · 신청). 가격 카드 = `/api/public/jbn/plans`(정가 줄 그음 · JBN 가격 · 할인율은 두 값으로 계산 · 인프라 문구는 원 코드로 `PLAN_INFRA`). 불러오기 실패 = 카드 자리에 「요금 안내를 불러오지 못했습니다」 + 다시 시도 · 신청은 그대로 가능.
- 신청 칸 = 회사명 · 대표자 성함 · JBN 단톡방 닉네임 · 휴대폰 · 관심 요금제(아직 모르겠어요 + 불러온 요금제) · 상담 방식(전화 · 방문 · 화상) · 궁금한 점 · 동의. 보내는 동안 단추 잠금 · 실패 = 칸 아래 문장 · 성공 = 신청 완료 판.
- 그림 = `public/jbn-assets/`(생성 모델 사진 3 = 고품질 2K 를 웹 크기로 · 이미지 스튜디오 포스터 5 · JPG). 폴더 이름을 `jbn` 으로 두지 않는다(빌드 결과에 `/jbn` 폴더가 생기면 nginx `try_files $uri $uri/` 가 화면 대신 폴더를 잡는다).
- 검색 제외 = 이 화면이 열리는 동안만 `<meta name="robots" content="noindex, nofollow">` 를 문서 머리에 넣고 떠날 때 뺀다(경로별 신호 · 구글은 그린 뒤의 meta 를 읽는다) + 링크를 어디에도 걸지 않는다. 응답 머리 `X-Robots-Tag` 는 nginx 설정이라 Harold 님 서버 작업(선택 · §8).
- 글: 가운뎃점 · 줄표 · 모델명 0(계약 시험).

### §4-2 슈퍼관리자 `components/admin/JbnMembersTab.tsx` · 탭 「JBN 회원」

- 목업 그대로(단계 칸 넷 · 고른 단계 목록 · 오른쪽 = 전용 주소 복사 · JBN 요금제 표 · 최근 처리 · 줄 = 상세 창).
- 상세 창 1단계 = 닉네임 크게 + 복사 · [JBN 회원 맞음] [단톡방에 없음](사유 칸) · 되돌리기. 창 아래 [신청 지우기](확인 창 · 본인 요청 등).
- 2단계 = 회사 찾기(기존 `GET /api/companies?search=` · 10건) → [이 회사로 연결](직전 연결값을 함께 보냄 · 409 면 지금 값으로 다시 그림) · 연결되면 「지금 요금제 ○○ · 고객사 상세에서 JBN 판으로 바꾸면 특별가 적용 중으로 넘어옵니다 · 발송 단가는 단가 설정에서 선불, 후불에 맞춰 넣습니다」.
- 메뉴 노출 = `GET /api/admin/jbn/access`(소개 방문 탭과 같은 판정).
- `AdminDashboard` 요금제 목록(회사 등록 · 상세의 고르기 칸) = `/api/admin/plans` 의 활성 행(JBN 판을 고를 수 있게).

## §5 영향표 — `plans` 를 읽는 자리 전수(grep `FROM plans|JOIN plans` 52줄 · 1118)

| 자리 | JBN 행이 생기면 | 처방 |
|---|---|---|
| `routes/plans.ts GET /`(공개) | 고객 요금표 · 체험 권유 창 · 진단 띠에 JBN 가격이 보임 | §3-3 거름 |
| `marketing-diagnosis-store DIAGNOSIS_PLAN_ROWS_SQL` → `recommendPlan`(공개 진단 · 문진) | 같은 기능 · 더 싼 JBN 행이 추천됨 | §3-3 거름 |
| `free-messaging readPlanFreeQuotas`(공개 목록과 함께 나감) | JBN 코드명이 공개 응답에 실림 | §3-3 거름 |
| `admin.ts GET /plans`(요금제 관리) · 회사 등록 · 상세 고르기 | JBN 판이 보여야 고를 수 있음 | 관리자 목록 사용(§4-2) |
| 선불 `plan-term.ts`(getPlan · 결제 · 갱신 · 업그레이드) | JBN 행의 월정액으로 계산 = 의도 | 무수정 |
| 후불 `billing-issue.ts` · `plan-proration.ts` · `billing-ledger.ts` | 이력 스냅샷 · 지금 월정액 = JBN 금액 = 의도 | 무수정 |
| `plan-change-log.ts recordPlanChange`(승강등 판정 = 월정액 비교) | JBN 판으로 내리면 downgrade 로 기록 = 사실 | 무수정 |
| 기능 판정(`plan-guard` · `cdp-auth` · `ai-credit*` · `continuous-operator` · `campaign-agency` · `spam-filter` · `ai-mapping` · `predictive-worker` · `ad-send-gate`) | 칸 통째 복사 = 원 요금제와 같은 결과 | 무수정 |
| `ai-credit-month monthCredits`(plan_code 별 월분) | 고정표에 없으면 지금 값 = 원 요금제 크레딧 | 무수정 |
| `trial-downgrade-worker`(유료 강등 금지 = 월정액 > 0) | JBN 판은 유료 = 강등 안 함 | 무수정 |
| `proposal-trial PROPOSAL_AGENCY_PLAN_SQL`(plan_code = BUSINESS) · `companies.ts` BASIC · `basic-trial` TRIAL · FREE 조회들 | 코드명이 다름 = 무관 | 무수정 |
| `my-plan`(고객 대시보드 요금제 표시) | JBN 회사는 「JBN 베이직 · 245,000」 = 사실 | 무수정 |
| 화면 `PLAN_INFRA`(plan_code 키) | 공개 요금표에만 씀 = JBN 행 안 옴 · JBN 페이지는 원 코드로 찾음 | §4-1 |

## §6 시험

- 단위 `c144-jbn.test.ts`: 신청 정규화(필수 칸 · 번호 · 동의 · 길이 자름 · 관심 요금제 허용 목록) · 단계 이동 허용표 · 소스 계약(공개 목록 셋이 조각 사용 · 공개 목록 SQL 잔존 0 · 관리자 대시보드가 관리자 요금제 목록 · 관리자 주소 넷이 관문 · 공개 화면 글에 가운뎃점 · 줄표 · 모델명 0 · 병합 축 등재).
- 실 PG `c144-jbn.pg.test.ts`(원장 블록 C144-DDL-1 · C144-DML-1 을 글자 그대로 실행): DDL 전 공개 목록 동작 · JBN 주소 503 / DDL · DML 뒤 JBN 행 = 공개 유료 행 수 · 월정액 70% · 기능 칸 같음 · 두 번 실행해도 그대로(멱등) / 공개 목록 · 진단 후보 · 무료 수량 = 전후 같은 집합 / 원 요금제의 그 달 크레딧 고정값이 지금 값과 다를 때 JBN 코드도 고정값(monthCredits) / DML 뒤 C144-RB-1 비활성화 = 옛 공개 SQL 결과에 JBN 0 / 신청 저장 · 같은 id 두 번 = 한 행 · 확인 · 동시 확인 한 쪽만 · 연결 · 다른 직전값 연결 409 · 연결 뒤 확인 해제 409 · 지우기 / 보관 기한(90일 IP NULL · 1년 행 삭제 · 지운 신청의 회사가 JBN 판이면 적용 중 목록에 그대로) / DML 을 두 번 · 중간 실패 뒤 다시 실행해도 같은 결과 · DML 커밋 뒤 월초 고정을 돌려도 JBN 고정값 그대로 / 단계 계산(연결 회사가 JBN 판이면 적용 중 · 신청 없는 JBN 판 회사도 적용 중) / 신청 · 확인 · 연결이 companies · plans 를 쓰지 않음.
- 변이: 거름 조각 빼기 · 단계 조건 바꾸기 · 조건부 UPDATE 의 from 빼기 · 연결 확인 조건 빼기 · 관문 빼기 = 전부 빨간불.

## §7 배포 순서(원장 id = status/DEPLOY-LEDGER.md)

C144-P0(읽기 · 공개 유료 요금제 다섯 줄 · plans 칸 목록과 타입 · 제약 목록) → 커밋 · push → 서버 pull → 백엔드 build:safe → 프론트 build:safe → 적재 0건 → 재시작(C144-H1) → C144-DDL-1 → C144-DML-1 → 실측 C144-S1(공개 요금표 그대로 · `/jbn` 가격 다섯 · 시험 신청 1건 · 탭에서 확인 · 연결 · 시험 회사 요금제를 JBN 판으로 바꿔 적용 중 확인 · 원래대로 되돌림).

**되돌리기(Codex 설계 1R)**: DML 뒤에 코드를 옛 판으로 되돌리면 옛 공개 목록 SQL(`is_active = true` 만)이 JBN 행을 그대로 내보낸다. 그래서 코드를 되돌리기 **전에** 원장 C144-RB-1(`UPDATE plans SET is_active = false WHERE partner_code = 'JBN'`)을 먼저 실행한다. JBN 판을 쓰는 회사의 청구는 행 id 로 읽어 영향이 없다(활성 칸은 목록 · 추천 · 무료 수량 표만 거른다). 다시 올릴 때 `true` 로 돌린다. 시험 = DML 뒤 비활성화하면 옛 공개 SQL 결과에 JBN 0.

## §8 범위 밖 · 미검증

- JBN 회사가 앱 안 요금제 화면(`/pricing`)을 열면 공개 가격이 보인다 · 그 화면에서 요금제 변경을 신청하면 공개 요금제가 신청된다(직원이 승인 때 JBN 판으로 따로 바꿔야 함) = 추가 과제(기록만).
- 선불 이용 기간 중인 회사를 JBN 판으로 바꾸는 길 = 기존 규칙 그대로(회사 수정 409 · 이용 기간 종료 뒤 변경 또는 고객 신청 승인) = 이 카드에서 새 길을 만들지 않는다.
- `/jbn` 검색 제외 = 화면이 넣는 meta 는 그린 뒤에 읽는 로봇에만 듣는다(네이버 로봇이 스크립트를 그리는지 미검증). 확실한 길 = nginx 의 `/jbn` 응답 머리 `X-Robots-Tag: noindex` · Harold 님 서버 설정(선택 · 명령 안내 없음).
- 소개 페이지(`/intro`) 시연 요청도 동의 문구는 「1년 뒤 파기」인데 지우는 작업이 없다 = 같은 부류 · 이 카드 범위 밖(기록만 · BUGS 등재 후보).
- C136 이 로그인 뒤로 옮긴 소개 그림과 달리 `/jbn` 의 포스터 다섯 장은 공개 폴더에 둔다(Harold 1118 목업 승인 = 이 페이지에 포스터가 있는 판).
- 원 요금제 가격을 바꿀 때 JBN 판 자동 연동 없음(§2-2).

## §9 홍보 산출물

- 단톡방 멘트: 꺾쇠 「」 0 · 마침표 0 · 쉼표만 · 가운뎃점 · 줄표 0 · 「AI 가 다 해 준다」 · 「직원 대신」 구도 0(반복은 한줄로 · 판단은 대표님) · 단가 숫자 0 · 링크 = `hanjul.ai/jbn`.
- 포스터: 생성 모델(GPT 이미지 2.6) · 흰 바탕 + 검정 + 주황 하나 · 프리텐다드 감 · 글자 자리는 잘라 확대해 맞춤법 확인 · 저장 = `marketing/promo/2026-11-jbn/`.

## §10 구현 기록(1118)

- 서버 = `utils/jbn.ts`(CT · 신청 정규화 · 저장 · 단계 · 상태 이동 · 연결 · 지우기 · 보관 기한 워커) · `routes/jbn-public.ts`(`/api/public/jbn/plans` · `/apply`) · `routes/admin.ts`(`/jbn/access` · `/jbn/overview` · `/jbn/applications/:id/status` · `/link` · DELETE) · `utils/plan-guard.ts PUBLIC_CATALOG_PLAN_SQL`(상수 · 별칭 p · 크레딧 계약 시험 R39 가 SQL 을 끝까지 펼치려면 함수가 아닌 상수여야 했다) · `routes/plans.ts` · `utils/marketing-diagnosis-store.ts` · `utils/free-messaging.ts` · `utils/company-merge.ts`(병합 축 move) · `app.ts`(마운트 · 워커).
- 화면 = `pages/JbnPage.tsx` · `pages/jbn-page.css`(.jbn 안으로 묶음) · `utils/jbn-public.ts` · `components/admin/JbnMembersTab.tsx` · `pages/AdminDashboard.tsx`(요금제 목록 = 관리자 목록 활성 행 · 탭 등록) · `App.tsx`(`/jbn`) · 그림 `public/jbn-assets/`(폴더 이름 = §4-1).
- 신청 표에 관심 요금제 이름을 함께 준다(화면 확인 때 코드 「BASIC」이 그대로 보여 `interest_plan_name` 을 JOIN 으로 더함).
- 옛 계약 시험 여섯의 기대값을 옮김 = 라우터 분류(jbn-public.ts = 공개 소개 묶음) · 병합 이동 축 8종 · 관리자 메뉴 40 · 표 한 줄 규칙 · 크레딧 칸 면제(utils/jbn.ts SELECT) · 기능 카탈로그 비등재 사유(/jbn).
- Codex 구현 = 1R 중간 2(① 응답을 못 받은 뒤 내용을 고쳐 다시 보내면 고친 내용이 사라짐 ② 한 회사에 연결된 신청이 여러 건이면 최신 하나만 보임) · 2R 중간 1(요금제 카드가 신청 잠금을 우회) = 1R ① 과 같은 부류(화면 칸과 보낸 내용이 어긋남)라 낱개로 막지 않고 구조를 바꿈 = 칸이 그리는 값 하나(`shown` = 보낸 신청이 있으면 그 내용) · 잠금 하나(`locked`) · 3R approve.
- 시험 = 단위 c144-jbn 16 · 실 PG c144-jbn.pg 16 · 변이 18 + 3(1R · 2R 수정 자리) 전부 빨간불 · 화면 = 개발 서버에 실제 부품 + 가짜 서버 답(요금 · 실패 상태 · 신청 · 잠금 · 다시 보내기 · 새로 신청 · 관리자 단계 · 상세 창 · 회원 확인 · 회사 연결 · 지우기 · 적용 중 여러 신청) · 폭 320 ~ 1920 넘침 0.

