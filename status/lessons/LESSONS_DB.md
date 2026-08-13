# LESSONS — DB / SCHEMA / 돈 / 환불 / 마이그레이션 사고

> **참조**: DB 쿼리 작성 / SCHEMA 변경 / 환불 로직 / 결제 / 마이그레이션 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 DB 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **★ 되돌릴 수 있는 결제에는 회차가 있고, 환불은 원 차감의 항아리로 돌려준다 (2026-08-13 크레딧 환불 축 신설 · Codex 적대 3라운드)** — ①차감·환불 멱등키가 **월(또는 대상) 고정**이면 "결제 → 무작업 취소·환불 → 재결제"가 duplicate로 끝나 **무료**가 된다(차감 행 존재만 보는 판정이 그것을 결제로 읽는다). 키에 **결제 회차**를 넣고, 그 회차는 **선점 UPDATE가 함께 돌려준다** — 잠금 밖에서 계산하면 그 사이 다른 요청이 승인·환불·재제출을 끝내 옛 회차 키로 확정하는 ABA가 된다. ②환불은 **원 차감의 bucket으로** 되돌린다: `purchased`는 구매분, `base`는 base, `mixed·overage`는 음수 base를 먼저 메우고 나머지를 구매분으로. 전액을 base로 넣으면 **월 리셋에서 양수 base가 소멸해 고객이 돈으로 산 구매분이 사라진다.** 정확한 구성분은 컬럼을 늘리지 않고도 구할 수 있다 — 차감 행과 **그 직전 거래 행의 `balance_*_after` 차이**(합이 차감액과 맞을 때만 신뢰, 아니면 bucket 규칙 폴백). ③환불도 **월 리셋을 먼저 적용**한 뒤 얹는다(차감과 같은 순서). ④**전액 환불만 지원한다** — 부분 환불을 허용하면 구성분 반올림이 누적되고 다른 멱등키로 나눠 원 차감액을 넘길 수 있다. 지원하지 않는 것을 지원하는 척하지 않으면 비율·반올림 코드가 사라진다. ⑤같은 차감에 대한 **누적 환불 상한**을 강제한다(환불 행에 원 차감 키 표식을 남겨 합으로 판정). ⑥`type` 신설은 CHECK가 없으니 **소비처 전수 확인**이 유일한 방어다 — 사용량 집계(순액으로 정정)·정산 초과사용 집계(원장에서 상계)·이력 화면 부호 2곳. 상세 = [SCHEMA.md](../SCHEMA.md) ai_credit_transactions 절 · [FEATURE-MARKETING-PLANNER.md](../../docs/FEATURE-MARKETING-PLANNER.md) §3-12·§3-13.

- **★ 컬럼을 쓰기 전 3단계 — 순서 절대 준수 (2026-07-25 Harold 질책)**
  1. **SCHEMA.md grep** — 이미 등재돼 있으면 그걸 쓴다. 안 보고 물으면 Harold 시간을 뺏는다(0725: `company_agent_ids`가 365행에 있었는데 다시 여쭘).
  2. **없으면 코드에서 실사용 컬럼 확인** — 운영에서 도는 SQL이 가장 확실한 증거다. 외부 DB라 information_schema를 못 볼 때 특히(0725: `RSRM_SalesStts` 성공 컬럼은 `pay-stats.ts` SELECT에 `OkCnt`로 있었다).
  3. **그래도 없으면 information_schema 순수 덤프를 Harold께 요청** — 그리고 **받은 즉시 SCHEMA.md에 등재한다.** 등재를 안 하면 다음에 또 묻게 되고, 그게 추측의 씨앗이 된다.
  - 위반 사례(같은 날 2회): `campaigns.name`(실제 `campaign_name`) / `RSRM_SalesStts.SuccCnt`(실제 `OkCnt`). 둘 다 확인 없이 명령어를 드려 에러가 났다.
- **★ 외부 DB에서 "잔액처럼 생긴 컬럼"을 잔액으로 쓰지 마라 — 스냅샷 컬럼과 원장 컬럼은 다르다 (2026-07-27, 런소프트 잔액 0원 오표시)** — 에이전트 잔액을 일별 통계 `RSRM_SalesStts.RemAmt`에서 읽었는데 그건 적재 시점 스냅샷이고 **계정에 따라 전 기간 0**이다. C0130은 실제 640,281원인데 화면에 `0원(07-09 기준)`으로 떴다 — 고객사가 잔액 0으로 오해해 불필요한 충전을 요청할 수 있는 상태였다. 진짜 잔액은 계정 원장 `RSRM_SalesMst.RemAmt`이고 발송이 나가는 대로 실시간으로 깎인다(몇 분 사이 4,881,401.2 → 4,881,227.5). **판별 방법 = 값이 움직이는지 시차를 두고 두 번 읽어 본다.** 같은 이름(`RemAmt`)이 두 테이블에 있으면 이름이 아니라 **그 테이블이 무엇을 기록하는 테이블인지**로 고른다(통계=일자별 집계, 원장=계정 현재 상태). ⚠ **`UpdTm`이 몇 년째 안 움직인다고 값이 안 움직이는 게 아니다** — 원장의 UpdTm은 계정 생성·정보 수정 시각이었다. 갱신 시각 컬럼으로 stale 판정하기 전에 그 컬럼이 무엇의 시각인지부터 확인. 다중 행 계정에서 대표 행이 없으면 **지점 행을 합산하지 말고 "확인 불가"** — 돈은 틀린 숫자보다 미확정이 낫다.
- **★ 여러 테이블에 걸친 작업의 "전수"는 도메인 감이 아니라 DB 카탈로그가 정한다 (2026-07-30 회사 병합 — 한 세션에 3회 연속 실증)** — 회사 병합에서 옮길 축을 도메인 지식으로 골랐더니 매번 빠뜨렸다. ①회사 축 5개를 골랐는데 `information_schema.columns`(`column_name='company_id'`) 전수는 10개 — `company_plan_changes`·`customer_code_sequences`·`company_settings` 누락(옮기면 병합 대상의 이력·설정을 옛 값으로 덮는다). ②UNIQUE 충돌 검사를 2개 골랐는데 `pg_index` 전수는 4개 — `kakao_sender_profiles(company_id, profile_key)`·`brand_message_templates(company_id, template_key)` 누락(23505로 롤백). ③간접 참조를 1개만 알았는데 `pg_constraint` 전수는 4개 — `billing_items(agent_id)`·`campaigns(kakao_profile_id)`·`campaigns(kakao_template_id)` 누락. **처방 = ①축 목록을 코드에 표로 두고 실행 시점에 카탈로그와 대조해 표에 없는 축이 나오면 통과시키지 말고 멈춘다(fail-closed) ②컬럼명 매칭은 전수가 아니다 — 이름이 다른 참조가 있는지 `pg_constraint`로 확인한다(0730 실측: companies FK 81개가 전부 `company_id`였지만 그건 확인해서 알게 된 사실이다) ③`company_id`가 없는 연결 테이블(예 `user_sender_profiles(user_id, profile_id)`)은 회사 축 열거로 절대 안 잡힌다 — 이동 대상을 FK로 가리키는 자식 테이블을 따로 전수한다. 등재는 테이블명이 아니라 `(자식, 자식컬럼, 부모)` 서명으로(이름만 쓰면 FK가 하나 더 생겼을 때 새 축이 기존 등재로 오인된다).** 상세=[[project_2026_0705_legacy_template_migration]] 0730 절.
- **★ psql에서 도는 카탈로그 쿼리가 앱에서도 도는 것은 아니다 — 배열 타입 (2026-07-30, 회사 병합 dryRun 500)** — `array_agg(a.attname)`은 `name[]`을 돌려주는데 node-pg가 그 타입을 배열로 파싱하지 않아 문자열로 온다 → `(row.cols ?? []).map is not a function`. **psql로 검증했을 때는 `{company_id,yellow_id}`로 정상 출력돼 보여 이 부류가 드러날 수 없었다**(psql은 배열을 그렇게 렌더링한다). 처방 = 카탈로그 컬럼은 `attname::text`처럼 **드라이버가 파싱하는 타입으로 캐스팅**하고, 카탈로그 쿼리는 psql 통과가 아니라 **앱에서 한 번 실행해서** 확정한다. 검증 3층으로 보면 `tsc 통과 ≠ SQL 유효`(db_column_verify_before_code) 다음에 `SQL 유효 ≠ 드라이버 통과`가 하나 더 있다.
- **★ 버전 의존 카탈로그 컬럼을 확인 없이 읽지 않는다 (2026-07-30)** — `pg_index.indnullsnotdistinct`는 PG15+ 전용이다. 운영 DB 버전을 모르는 상태로 읽으면 그 기능을 쓰는 경로 전체가 42703으로 죽는다. 버전 무관한 대안(`pg_get_indexdef` 문자열 판정)이 있으면 그쪽을 쓰고, 굳이 카탈로그 컬럼이 필요하면 `server_version_num`부터 확인한다.
- **SCHEMA.md 의존 X** — 실 DB `pg_constraint` + `information_schema.columns` 검증 후 SQL 작성 (D134)
  - ※ 위 3단계와 충돌 아님: SCHEMA.md는 **출발점**이고, 스키마를 **바꾸거나 제약에 의존**할 땐 실 DB 검증이 최종 근거다.
- **추측 컬럼명 X** — `\d 테이블명` 검증 SQL 먼저 (D162 42P08)
- **★ 원 미만 절사는 "사람이 검산하는 단위"에서 1회 — 반복 연산 안쪽에 절사를 넣으면 오차가 연산 횟수만큼 누적된다 (2026-07-30 Harold 정정, 서수란 0729 접수)** — 0726 "소수점 버려라" 지시(기원: `₩13,397,454.84` 인쇄)를 **일자별 행 단위 절사**로 과대 해석해 구현했더니, 절사가 일자 수만큼 누적돼 청구 항목표가 `수량×단가`와 수십 원씩 어긋났다(1,733×7.2=12,477.6인데 12,456 표시 — 정수 단가 행은 정확해서 소수 단가만 걸리고, 고객이 검산할 때마다 걸린다). **확정 계약: ①일자행(`billing_items.amount`)=정확값(소수 유지) ②절사는 `buildInvoiceLines` 항목줄에서 1회 — 같은 단가 그룹은 Σ(일자×단가)=총수량×단가라 절사값이 정확히 floor(수량×단가) ③헤더·장 공급가액 = 절사된 항목줄 합의 정수 덧셈(`sumFlooredInvoiceLines` — 그룹핑·절사 소유자는 buildInvoiceLines 하나) ④2페이지 합계·모달 세로합 등 최종 표시 금액은 전부 그 절사 합에서 파생(Σ소수를 따로 floor하면 항목표와 1원 갈린다) ⑤교차검증은 정확값 축(amountExact)**. 기존 발행분은 절사가 멱등(정수의 절사=자신)이라 검산·표시 그대로 통과. floorWon(Math.floor 직접 금지)·절사 방향(고객 유리) 원칙은 불변. **일반화: 지시를 받았으면 "지시의 단위"를 물어라 — 버리라는 소수점이 어느 화면의 어느 숫자인지가 설계다.**
- **★ 발송량과 무관한 "월별 청구 항목"에는 소비 마커가 있어야 한다 — 없으면 기간을 쪼개는 순간 이중청구다 (2026-07-30, 080 청구 Codex 적대검증 critical)** — `billing_extra_items`(080 이용료·통화료·부가서비스)를 "발행 기간과 월이 겹치면 싣는다"로만 만들었더니, **겹치지 않는 두 발행**(7/1~15 + 7/16~31)이 같은 달 항목을 각각 실었다. 기존 중복 검사는 **청구 기간끼리의 겹침**만 보므로 둘 다 통과한다 — 중간정산·월 경계가 다른 연속 발행에서 실제로 두 번 청구된다. 처방은 이미 저장소에 있었다: AI 크레딧이 같은 부류(월별 비발송 청구)를 `ai_credit_transactions.billed_billing_id`로 푼 계약을 그대로 미러한다 — **미소비 행만 `FOR UPDATE`로 싣고, 공통 장 커밋 트랜잭션에서 마킹**하며, FK `ON DELETE SET NULL`이라 발행을 지우면 자동으로 미소비로 돌아온다. **일반화: "이 행이 이미 청구됐는가"를 기간 겹침으로 유추하지 마라 — 소비 여부는 그 행이 스스로 들고 있어야 한다.**
- **★ 같은 자원을 건드리는 경로는 전부 같은 잠금 축에 세운다 — 조회만으로는 경합에서 진다 (2026-07-30)** — 080 반영·항목 취소·최소과금 정액 발행이 각자 "그 달 발행이 있나"를 조회만 하고 진행했다. 발행 트랜잭션과 엇갈리면 ①발행은 항목 없이 커밋되고 반영이 뒤따라 커밋돼 **청구 누락 고아 항목**이 남거나 ②취소가 '미발행'을 본 뒤 발행이 끼어들어 **청구서는 있는데 근거 행이 사라진다.** 처방 = 세 경로 모두 발행 코어와 **같은 키**(`pg_advisory_xact_lock(hashtext(company), hashtext('billing'))`)를 잡고 잠금 획득 **후** 재검사 + 삭제는 `WHERE billed_billing_id IS NULL` 원자 조건(경합에서 져도 소비된 행은 구조적으로 못 지운다). 크레딧 경로처럼 다른 잠금(`companies FOR UPDATE`)을 쓰는 이웃이 있으면 그 행 잠금도 함께 잡아 가시성 창을 닫는다.
- **★ 단가·금액 컬럼의 "세금 포함 여부"는 코드가 가정하면 안 된다 (2026-07-26 부가세 이중과세)** — `companies.cost_per_*`가 **부가세 포함**으로 입력돼 있는데 코드는 `Σ(수량×단가)`를 공급가액으로 놓고 10%를 또 더했다. 금강제화 7월 실측 **+1,339,745원 과청구**(13,397,454.84 → 14,737,199.84). 컬럼명(`cost_per_lms`)에는 포함 여부가 안 적혀 있고, tsc·테스트·금액 항등식 3중 검사 **전부 통과한다**(항등식은 "항목합=공급가액"만 보고 그 공급가액이 세전인지는 모른다). 판별 근거는 **값의 흔적**이었다 — 7.70=7×1.1 · 11.00=10×1.1 · 24.97=22.7×1.1 · 25.08=22.8×1.1. **처방(0726 구현 완료): ①금액 축마다(웹·테스트·스팸·에이전트·요금제·크레딧) 세금 기준을 문서에 명시 ②입력 화면에 "VAT 별도"를 명시하고 칸마다 `VAT 0.80원 · VAT 포함 8.80원 차감`을 실시간 표시 ③새 단가 축은 입력 전에 기준을 정한다.**
  - **기준 전환은 "회사별 마커 + 두 함수"로 한다** — 배포 시점과 재입력 시점이 같을 수 없어서, 그 사이 회사가 반드시 생긴다. `companies.unit_price_basis`(`vat_included`/`vat_excluded`)를 두고 CT(`utils/unit-price.ts`)가 `toSupplyPrice`(청구)와 `toVatIncludedPrice`(선불 차감·화면 표시) 두 방향을 담당한다. **전환 전 회사는 오늘과 1원도 다르지 않게** 만드는 것이 핵심 — 그래야 배포와 운영 작업을 분리할 수 있다. 모르는 값은 항상 전환 전으로 해석한다(÷1.1이 조용히 걸리면 청구액이 10% 준다).
  - **단가처럼 "값과 그 값의 의미"가 쌍인 컬럼은 쓰기 경로를 하나로 좁히고 같은 UPDATE 문에서 함께 쓴다.** 따로 쓰면 그 사이가 곧 사고다. 옛 경로는 주석이 아니라 **식별자 자체를 제거**해야 막힌다(다시 바인딩하면 tsc가 잡는다). 단 SQL의 `col = COALESCE($n, col)`은 남긴다 — placeholder를 지우면 미사용 파라미터가 되어 42P08을 부른다(D162).
  - **이 부류는 런타임 테스트로 안 잡히므로 소스 스캔 불변식이 필수다**(`unit-price-invariants.test.ts` 13건). 값의 흔적(7.70=7×1.1)으로만 발견됐다는 사실 자체가 근거다.
  - 상세=docs/2026-07-26-billing-scope-and-corrections-design.md §9-1·§9-6.
- **★ 환불·회수·정산은 "지금 단가"가 아니라 "차감 당시 단가"로 계산한다 (2026-07-26)** — `차감 = 성공 + 순환불`이 성립하려면 실패 1건을 되돌리는 금액이 그 1건을 깎은 금액과 **같아야** 한다. `prepaid.ts` 환불·회수와 `mysql-refund-sweeper`가 전부 현재 `cost_per_*`를 곱하고 있었다: 단가를 올리면 정당 한도가 부풀어 초과 환불을 못 잡고(회사 손해), 내리면 정상 환불을 초과로 오인해 회수한다(고객 손해). sweeper는 한술 더 떠 **차감 건수를 `총차감액 ÷ 현재단가`로 역산**해서, 단가가 바뀌면 건수 자체가 틀리고 그게 그대로 환불액이 된다. **평소엔 단가가 안 바뀌어 영원히 안 드러나다가, 단가를 손대는 날 전부 한꺼번에 발동한다.** 처방 = 차감 행이 자기 건수·단가를 설명에 기록하므로(`buildDeductDescription`) 그것을 되읽어 쓴다(`parseDeductDescription` — **되읽기 함수를 만든 함수와 같은 파일에** 둬야 형식 변경 시 함께 고쳐진다). 되읽을 수 없는 옛 행이 섞이면 현재 단가로 폴백. **일반화: 과거 거래를 되돌리는 계산에 "현재 설정값"을 쓰면 그 설정을 바꾸는 순간 회계가 조용히 어긋난다 — 되돌림의 근거는 그 거래가 남긴 값이어야 한다.**
- **돈 관련 = 단순 fix X** — root cause + 영구 안전망 (reverse + cron + idempotent + 트랜잭션) 동시 (D182)
- **DB ALTER 새 컬럼 → endpoint catch 분기 처리** (D214+ 신규)
- **GREATEST vs COALESCE** — 양방향 sync 영역 (POS + 자사몰) = GREATEST 강제 (D214+ 신규)
- **적재 목적지 전환 = dump~라이브 갭 필연 + 옛 수신 DB에서 백필** (2026-07-23) — 외부(강문희)가 push하는 통계 DB의 수신 목적지를 143→62로 바꾸니 초기 dump(07-07)~라이브 적재 시작(58=07-14) 사이 날짜(07-08~13)가 62에 통째 누락 = 게이트웨이 대비 484만(25%) 부족. replace는 당일만 갱신이라 과거 갭 자동 복구 X. **처방 = ①전환 후 `GROUP BY DestDt` 연속성 점검 의무(빠진 날짜 즉시 드러남) ②갭은 옛 수신 DB(전환 전 타깃이 그 기간 원본 보유)에서 mysqldump `--where` 결손일만 떠서 새 DB로 백필(신 스키마에 SysId 등 추가 컬럼 있으면 로드 후 UPDATE 백필) ③외부 "성공 N만"은 유형별(SMS/LMS/MMS/카카오) 합산 여부부터 확인 — 한 컬럼만 보면 착시**. 상세=docs/2026-07-07-pay-absorption-track-d-design.md §9-3.

---

## 사고 이력

### 2026-07-01 — 시스템 sync user INSERT 42P08 (동일 $1을 uuid 컬럼 + ::text 이중 사용) ★ 신규
- **현상**: `reconcileSyncUnsubscribes`(sync.ts) error.log "inconsistent types deduced for parameter $1, text versus uuid" 42P08 반복. `companies.ts` 회사생성 시스템 user INSERT도 동일(2곳).
- **근본**: `VALUES (..., $1 /*company_id uuid*/, 'system_sync_' || $1::text, ...)` — 같은 `$1`을 uuid 컬럼과 `::text`에 써서 PG가 $1 타입을 uuid·text 양쪽으로 추론 → 42P08(D162 계열, prepared statement 타입 추론).
- **fix**: `$1::uuid`(company_id) + 별도 `$2::text`(login_id 접미사) params 2개. 반복 INSERT 2곳은 `utils/system-sync-user.ts` CT(`ensureSystemSyncUser`)로 통합(controltower_first). 결과 데이터·downstream 동일, 42P08만 제거.
- **교훈**: 한 파라미터를 서로 다른 타입 문맥(uuid 컬럼 / `::text`)에 재사용하면 42P08 → 명시 cast + 문맥별 별도 param. **런타임 에러가 42P08(≠42703)이면 컬럼은 존재하는 것**(is_system 있음 — SCHEMA.md users 미기재라 갱신 대상). 비치명(수신거부 실차단은 admin·company_user 등록이 담당, 시스템 user 등록만 skip이었음)이나 로그 오염 + 시스템 user 미생성.

### 2026-06-29 — 선불 sweep 초과환불 재발 + 발송 근간 보강 (돈) ★ 신규
- **현상**: 6/25 산식 fix 이후에도 폴라초이스·라무르 초과환불 재발. 실측 51,722원/29건.
- **진단 함정**: 환불 진단 기준을 `실패 + (차감 − sent_count)`로 잡으면 버그 산식과 동일 → over 0으로 가려짐. **올바른 회계 기준 = `차감 − 성공`**(과금했는데 전달 안 된 전부). over = `환불 + 성공 − 차감`.
- **근본**: `calcRefundDue`의 미적재 = `차감 − sent_count`인데, 워커 기록 sent_count가 실제 처리수(성공+실패)보다 작게 남는 캠페인이 있음(폴라초이스 성공14790+실패610=15400=차감인데 sent_count 15271). 그 차이를 가짜 미적재로 환불 → prepaidRefund ratchet(올림만)이 영구 고착.
- **fix (양방향 수렴)**: ① 미적재 = `차감 − max(sent_count, 성공+실패+대기)` (refund-calc.ts) — MySQL 실측 처리수가 sent_count 과소를 덮음, max 하한이라 이동 중 race도 방어. ② reverse 안전망 `prepaidReverseOverRefund` (prepaid.ts) — 정산 캠페인(대기0·30분경과)에서 누적환불 > 정당한도(차감−성공)면 초과분 트랜잭션·idempotent 회수, 타임아웃 환불 캠페인은 skip(이중차감 차단). 14일 윈도우 자동 회수(46,569원 실회수).
- **발송 근간 보강**: ① sent_count = `GREATEST(sent_count, 성공+실패+대기)`로 실적재수 정정. ② 머니 불변식 `차감 = 성공 + 순환불(환불−회수)` 감시 — 정산 캠페인에서 깨지면 `sendSystemAlert`(쿨다운6h·미설정 시 PM2 로그만). gap>0=미환불(고객 손해)·gap<0=초과 잔존. **측정: 정산 1,480건 전부 불변식 성립 + 진짜 미적재 0** → 적재 신뢰성 OK라 적재 파이프라인 대공사 불필요.
- **교훈**:
  - 환불 회계 진단 기준은 항상 `차감 − 성공`. sent_count(워커 기록)는 진실 아님 — 미적재 단독 산정에 쓰면 과소 기록이 가짜 환불.
  - prepaidRefund는 한 방향(올림). 어떤 일시 변수가 튀어도 ratchet이 영구 고착 → 돈 영역은 reverse 양방향 수렴이 근본(D182 reverse 원칙 재확인). 입력 변수 하나씩 막으면 다음 변수에서 재발.
  - 위험한 코드(적재) 대공사 전 실측부터 — 진짜 미적재율을 SQL로 재서 0이면 대공사 불필요(데이터 없이 발송 근간 안 건드림).

### D214+ — customer-upsert.ts COALESCE 사고 (RFM GREATEST 강제 의무) ★ 신규
- **사례**: 옛 `customer-upsert.ts` ON CONFLICT UPDATE = recent_purchase_date / purchase_count / last_purchase_date = COALESCE 단순 덮어쓰기. 자사몰 (cdp-orders.ts) GREATEST 영역과 충돌.
- **시나리오**: 자사몰 5/24 매출 → cdp-orders → recent_purchase_date = 5/24 → 30분 후 싱크에이전트 POS 옛 5/23 sync → COALESCE(5/23, 5/24) = **5/23** = 5/24 사라짐 사고.
- **대책**: updateExclusions에 RFM 컬럼 추가 + 별도 GREATEST 강제 매트릭스 (`GREATEST(COALESCE(EXCLUDED.X, customers.X), COALESCE(customers.X, EXCLUDED.X))`). 양방향 sync 영역 = 항상 GREATEST 정합.

### D214+ — active_sources 컬럼 X 에러 (DB ALTER 안전망 부재) ★ 신규
- **사례**: DB ALTER 미실행 상태에서 endpoint 호출 시 = `column "active_sources" does not exist` 에러 = 사용자 친화 X.
- **대책**: 새 컬럼 활용 endpoint catch 영역에 `if (msg.includes('column') && msg.includes('does not exist')) return res.status(503).json({ code: 'DB_MIGRATION_PENDING' })` 분기 처리 의무. 운영자 안내 메시지 ("DB 마이그레이션 필요 — customers ALTER 10건 실행 요청") 포함.

### D188 (영업팀장 알림톡 14건 — admin_phone_number fallback)
- **사례**: `alimtalk-jobs.ts notifyTemplateInspectionResult` profile.admin_phone_number 빈 영역 시 return 0 → 영영 알림 X. 인비토 발신프로필 등록 시 admin_phone_number 누락된 회사 영구 사고.
- **대책**: callback fallback (admin_phone_number 빈 영역 → `sender_registrations` 첫 approved.phone). 회사 admin 의존성 데이터 = fallback 안전망 필수.

### D184 (이니시스 결제 ALTER — SCHEMA.md ≠ 실 DB 충돌)
- **사례**: SoT 문서 `legacy-payment-migration.md` §6-1 = `CREATE TABLE IF NOT EXISTS payments` 명시. 실 SCHEMA = payments 테이블 이미 존재 (12 컬럼 + row 0건).
- **대책**: SoT 문서 의존 X — 실 DB `pg_constraint` + `\d 테이블명` 검증 후 ALTER 진입. 9 컬럼 추가 + UNIQUE INDEX (pg_payment_key + pg_order_id) + 결제 영역 = 트랜잭션 + idempotent + 금액 위변조 검증 (approval.totPrice vs db.amount) 3중 안전망 필수.

### D182 (선불 타임아웃 환불 — 30분 임계값으로 회사 손해)
- **사례**: 디에스패션/태영 30~34분 시점에 통신사 응답 도착 → 30분 임계값으로 환불 처리 → 회사 손해 (디에스패션 26.4원 + 태영 60.5원).
- **Root cause**: `campaign-lifecycle.ts:427` directTimedOut 30분 = sync-worker가 pending 전체 fail 강제 + prepaidRefund 호출 → 직후 응답 도착 → success_count=1 갱신되지만 환불 reverse 없음.
- **5단 영구 안전망**:
  1. 임계값 30→**120분** 변경 (통신사 응답 99%ile + 안전 마진 2배)
  2. `mysql-refund-sweeper.ts reverseTimeoutRefundIfRecovered()` 30초 주기 + 24h 윈도우 + idempotent
  3. 트랜잭션 (BEGIN/COMMIT/ROLLBACK) 잔액 차감 + INSERT 원자성
  4. description 정규식 파싱으로 단가 추출 + min(currentSuccess, refundedFailCount) × unitPrice 차감
  5. `balance_transactions` admin_deduct + description='타임아웃 환불 reverse' INSERT
- **교훈**: 돈 영역 = 단순 fix X — root cause 분석 + 영구 안전망(reverse + cron + idempotent + 트랜잭션) 동시 구축.

### D162-3 (수신거부 사용자격리 4 분기 매트릭스)
- **신 설계**: `companies.user_isolation_enabled BOOLEAN DEFAULT false` 토글 + 4 분기:
  1. OFF + 누구든 = 회사 전체 broadcast
  2. ON + company_admin = 등록/삭제 차단 (IsolationBlockedError)
  3. ON + company_user = 본인 + 회사 admin 양쪽 INSERT (격리 + admin sync)
  4. ON + 그 외 = 차단

### D162 (수신거부 양방향 사고 — 42P08 PostgreSQL + 0 자동 보정 누락)
- **사례**: 토운/스킨큐어 수신거부 추가/엑셀 업로드 시 "서버 오류" + 0건 등록. PM2 로그 = `error 42P08: inconsistent types deduced for parameter $3`.
- **Root cause 2건 동시**:
  1. `unsubscribe-helper.ts:160` admin 분기 SQL `$2` placeholder 완전 미사용 → prepared statement cache가 미사용 placeholder type을 unknown 추론 → 운 나쁜 connection에서 42P08
  2. `routes/unsubscribes.ts:161/204` 수신거부 등록 경로 `replace(/\D/g, '')`만 박혀 카카오 CSV 앞 0 누락 10자리 (`1066133762`) 그대로 INSERT → customers.phone 11자리 (`01066133762`)와 매칭 X = **스팸 발송 사고 영구 위험**
- **대책**:
  1. SQL `$3→$2`, `$4→$3` 재번호 + `$1::uuid, $2::varchar, $3::varchar` 명시 cast (type inference 영구 고정)
  2. `normalizePhone(phone)` 적용 (CT-normalize.ts) — 0 자동 보정 + 한국 휴대폰 유효성
- **교훈**: prepared statement cache는 connection 단위 — 회사별 차이 가설 X. 미사용 placeholder 코드 결함 우선 점검. 수신거부 등록 경로 phone 정규화 누락 = 스팸 발송 사고 영구 위험.

### D151-2 (환불 워커 부재 1년 반복)
- **사례**: Dashboard 진입 의존 fire-and-forget sync(D144) 한계 — 사용자 화면 안 보면 sync 0회 → PG fail_count 미증가 → 환불 함수 호출 0건. 스킨큐어 547건 실패 중 251건만 환불, 293건 누락 8.5시간 영속.
- **대책**: `campaign-sync-worker.ts` 5분 cron 신설. 최근 24h pending>0 회사 자동 sync. idempotent 함수는 호출만 되면 자동 차액 환불.

### D145 P0+ (환불 idempotent)
- **사례**: delta 환불 패턴이 호출/함수 의미 충돌로 트렉스타 17,820원 누락 + 폴라초이스 113,559원 이상지급 양방향 사고.
- **대책**: count = 누적 fail 그대로 호출, 함수가 alreadyRefunded와 비교해 차액만 환불 (idempotency 함수 측 보장). delta 계산 폐기.

### D150-3 (직접발송 0 NULL — cellToString)
- **사례**: 엑셀 D2/E2/F2 = 0 값이 `row[col] || ''` falsy 처리로 빈 문자열 변환되어 발송 본문 NULL. 벤제프 113건 잘못 발송.
- **대책**: `cellToString` 컨트롤타워 신설 (frontend formatDate.ts + backend normalize.ts). `|| ''` 패턴 25곳+ 일괄 교체. 인라인 `safeStr` 정의 금지.

### D150-4 (발송결과 ORDER BY tie)
- **사례**: 폴라초이스 14df97e7 16,106건 모두 sendreq_time 단일 시각 → `ORDER BY sendreq_time ASC LIMIT 10000 OFFSET ?` tie-breaker 없음 → 청크 비결정적 분배. 화면 15,450/656 vs 엑셀 15,470/636.
- **대책**: `dest_no ASC` tie-breaker 추가. LIMIT/OFFSET 청크 패턴 = unique tie-breaker 필수.

### D150-2 (환불 description 행 단위 모순)
- **사례**: `prepaid.ts:130` description이 누적 fail × 단가 표시인데 amount는 차액 → 행 단위 모순.
- **대책**: `alreadyRefunded > 0`이면 신규 환불 건수 + 누적 정보 별도 표시.

### D145 P0 (환불 description 의미 불일치)
- 옛 사고 — `prepaid.ts` description / amount 의미 충돌. 행 단위 표시 일관성 영구 룰.

### D142 (호출부 의존성 파괴)
- **사례**: 포맷팅 안전 가드를 함수 호출부 파라미터에 의존 → 프론트 파라미터 누락 → 콤마 포맷팅 에러 1년 반복.
- **대책**: 호출부 의존 폐기. 컨트롤타워 내부에서 안전한 기본값 반환. `FIELD_DISPLAY_FORMAT_MAP` 22개 1:1 + `renderFieldValue/displayValue` 단일 진입점.

### D134 (DB 제약 조건 불일치)
- **사례**: SCHEMA.md 의존하다가 실 DB `CHECK` 제약 위반 → 마이그레이션 SQL 전건 실패.
- **대책**: DB 구조 = `pg_constraint` 쿼리로 실 값 확인 후 작성.

### D132 (보조 상태값 오염)
- **사례**: `subscription_status` 같이 여러 곳에서 덮어쓸 수 있는 보조 상태에 의존 → 평가 로직 꼬임.
- **대책**: 요금제 판정 = 단일 필드 (`plan_code`) 의존.

### D131 (SyncAgent 누적 합산)
- **사례**: Agent 상태를 DB 조회 카운트가 아닌 `+=` 누적 합산 → UI 수만 건 표시.
- **대책**: 통계와 실 스냅샷 카운트 의미 분리.

### D110 (하드코딩 테이블명)
- **사례**: `admin.ts` 상세 조회 `SMSQ_SEND` 하드코딩 → 완료 캠페인 데이터 누락.
- **대책**: `getCampaignSmsTables` 등 CT-04 함수 사용. 라우팅 단일 진입점.

### D106 (LEFT JOIN 모호성)
- **사례**: LEFT JOIN 추가 후 `WHERE status` 어느 테이블 컬럼인지 명시 X → SQL 500.
- **대책**: JOIN 추가 시 모든 컬럼에 alias (`c.`, `u.`) 명시 필수.

### D98 (MMS 절대경로)
- **사례**: 서버 절대경로 (`/home/admin/...`)를 웹브라우저 `img src`에 그대로 전달 → 이미지 깨짐.
- **대책**: `mmsServerPathToUrl` 컨트롤타워 활용.

### D70 (안전망의 역설)
- **사례**: 변수 치환 `replaceVariables`의 정규식 안전망이 주소록 변수를 빈 값 치환 삭제.
- **대책**: 방어 로직이 유효 데이터 지우지 않는지 데이터 흐름 끝까지 검증.

---

## 자가 검증 매트릭스 (DB 작업 시)

- [ ] SCHEMA.md 정독 + 컬럼명 정확 확인 (추측 X)
- [ ] `pg_constraint` 또는 `\d 테이블명` 실 DB 검증 SQL 안내 (Harold 실행)
- [ ] 양방향 sync 영역 (POS + 자사몰 + 파일 업로드) = GREATEST 강제
- [ ] DB ALTER 새 컬럼 활용 endpoint catch 영역 = `column does not exist` 분기 처리
- [ ] 돈 영역 (환불/결제) = root cause + 영구 안전망 동시 구축
- [ ] `42P08` 류 PostgreSQL 에러 = prepared statement cache 영역 = placeholder 영역 + 명시 cast
- [ ] 수신거부 등록 경로 = `normalizePhone` 의무 (스팸 발송 사고 차단)
- [ ] LIMIT/OFFSET 청크 = unique tie-breaker 필수
