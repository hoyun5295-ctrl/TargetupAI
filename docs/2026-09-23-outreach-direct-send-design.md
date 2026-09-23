# AI 영업 직접 발송 · 엑셀 자동 영업 · 품질 재구성 설계서 (2026-09-23)

> 기능 상설 SoT = [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md). 이 문서는 2026-09-23 브레인스토밍 회의(기획·백엔드·프론트·디자이너·회의론자 · 1차 의견 → 교차 토론 1R → 회의론자 최종 검증 14항목) 수렴안과 그 구현 계약을 소유한다.
> Harold 결재 = 2026-09-23 "전체 동의하고 설계서 쓰고 그것을 토대로 구현까지 마무리하자".

---

## 0. 한 장 요약

- **수집 · 행사 확정 · 제작은 자동**으로 돈다. **외부 발송은 단계 1(건별) → 2(묶음 1클릭) → 3(묶음 사전 승인 자동)** 으로, 숫자 조건과 Harold 결재가 채워질 때마다 열린다.
- 담당자 주소는 **사람이 넣은 값만** 쓴다(엑셀 · 입력 칸 · 검토 화면). 크롤로 이메일을 뽑지 않는다.
- 발송 원장 · 수신거부 원장 · 일일 상한 · 같은 회사 재발송 차단은 **DB가 막는다**(트랜잭션 + 부분 UNIQUE).
- 네이버 브랜드스토어는 **우리 서버 IP가 막혀 있다**(0826 · 0923 두 번 실측 429). 다른 출구로 우회하지 않는다. 주소는 저장하고, 필요하면 사람이 저장한 기획전 페이지 파일을 올려 서버가 그 파일만 읽는다. ★0924 직원 크롬 북마크로 떠 있는 화면을 1클릭으로 가져온다(§9-1).
- 품질 1순위 둘: **렌더 워커 겹침으로 조용히 빠지던 재료·채점을 막는다** · **제안 메일 첫 화면을 다시 짠다**(헤드라인 + 버튼 + 그 브랜드 시안 머리가 첫 화면).

---

## 1. 접수 원문 · 축 대조표 (scope_discipline 1번)

| 접수(Harold 원문) | 닫는 축 | 이 축이 없으면 닫히는가 |
|---|---|---|
| R1 "검수메일을 우리 회사로만 보낼 수 있는데 실제 메일주소 넣고 보낼 수 있도록" | §4 수신처 칸 · §5 직접 발송 | 안 닫힌다 |
| R2 "퀄리티 끌어올릴 방법" | §8 직렬화 · §11 제안 메일 재구성 · §12 3초 판정 카드 | 안 닫힌다 |
| R3 "홈페이지, 네이버브랜드스토어 둘 다 주소를 받고 그걸 토대로" · "팝폰은 되는데 왜 우리는 안 되나" | §9 스토어 주소 · 저장본 업로드 · §2 실측 사실 | 안 닫힌다 |
| R4 "엑셀양식 … 리스트를 올리면 AI 영업이 자동으로 돌아서 담당자 이메일주소로 발송까지 = 완성형" | §10 엑셀 · §7 자동 확정 · §6 단계 1·2·3 | 안 닫힌다 |

빠진 축 0.

---

## 2. 실측으로 확정된 사실 (이 설계의 전제)

1. **brand.naver.com 은 우리 운영 서버(.62)에서 429다.** 0826 3회(curl 봇 UA · curl 크롬 UA · Puppeteer 실렌더) + **0923 Harold 실행 curl 크롬 UA 1회 = 429**. 차단 축 = 출구 IP. ★0924 정정: Harold PC 에서도 curl = 429 · 같은 PC 크롬은 정상 → "서버 IP 하나"로 단정할 근거가 없다(브라우저 아닌 요청 전반일 수 있음 · 원인 미확정 · §9-1).
2. **팝폰은 같은 방식(크롬 렌더)을 Vercel Cron 에서 돌린다**(`poppon-workspace/poppon-admin/vercel.json` · `src/lib/crawl/ai-engine.ts:99~210` · naver_brand fullPage). 차이는 출구뿐이다.
3. 제안 발송 수신처는 ENV 고정(`outreach-mailer.ts:151~158`), 검수만 허용 도메인 안에서 주소 인자(`:163~173`).
4. `decideMailOutcome`(`outreach-mailer.ts:95~101`)은 수신자 1명이라도 accepted 면 sent 다 → 외부 1명 + 사내 사본을 한 통에 섞으면 외부 거부가 sent 로 접힌다.
5. 렌더 워커는 동시 1건이다(`workers/outreach-render-worker.ts` busy → 409). 409 는 `sales-outreach-render.ts:91` 에서 busy 실패가 되고 호출부는 정적 결과로 조용히 넘어간다. 캡처·채점(`captureAndScoreDm` · `produce.ts:824`)도 같은 워커를 쓴다. 이미지 제작은 `imageInFlight`(`produce.ts:924`)가 차 있으면 예외를 던진다.
6. 일괄 체인(`sales-outreach-jobs.ts:2862~2873`)은 `awaiting_confirm` 에서 멈추고 다음 건 크롤을 시작한다 · 사람 확정 제작은 체인 밖에서 돈다(`:1231`) → 겹친다.
7. 광고성 이메일 법정 footer CT 가 이미 있다(`email-channel.ts:320 buildEmailAdFooter` · 전송자 명칭 + 연락처 + 수신거부 링크). 재사용한다(no_inline_duplication).
8. 확정 이미지 없이(imageUrl null) 제작해도 포스터는 상품 사본 누끼로 만들어진다(`jobs.ts:1602~1612` · `produce.ts:940~949`). 인물 판정은 `person` 만 제외한다.
9. 일괄 등록 묶음 키가 이미 있다(`stage_results.chain.batch`). 작업대 묶음 축은 새 컬럼 없이 이것을 쓴다.

---

## 3. 불변 원칙 (FEATURE-SALES-OUTREACH §2 개정 · 신설)

- **불변 1 개정**: 발송 경로는 **사람 승인 기록**이 있어야만 열린다. 승인 기록 = ①사람 클릭(단계 1·2 · `operatorSuperAdminId` + `assertOperator`) 또는 ②묶음 사전 승인 기록(단계 3 · 승인자·규칙 버전·시각 · 업로드 때 사람이 1클릭). 발송 코어 함수는 이 둘 중 하나를 **필수 인자**로 받는다. 워커·스케줄러가 승인 기록 없이 부를 수 없다(계약 테스트).
- **불변 24 개정**: 수신처를 인자로 받는 발송은 검수뿐이고 허용 도메인 **또는 허용 주소 목록**(`OUTREACH_TEST_MAIL_ADDRESSES`) 안에서만 받는다. **직접 발송의 수신처는 선점한 잡 행의 `contact_email` 에서만 읽는다**(요청 인자 0 · 화면은 `expectedTo` 로 확인만 한다).
- **불변 44(신설)**: 담당자 주소는 사람이 넣은 값만. 크롤 결과에서 이메일 주소를 추출하는 코드 0(정보통신망법 제50조의2 · 계약 테스트). 홈페이지에서는 제휴·문의 **페이지 링크**만 보여준다.
- **불변 45(신설)**: 직접 발송은 한 트랜잭션에서 잡 CAS → 수신거부 원장 확인 → 일일 상한(시도 건수 · advisory lock) → 발송 원장 INSERT(같은 회사 부분 UNIQUE) 를 모두 통과한 뒤에만 SMTP 를 부른다. 하나라도 실패하면 ROLLBACK · 발송 0.
- **불변 46(신설)**: 사람이 확인한 판만 나간다: `reviewed_asset_id` = 최신 `email_html` asset id 가 아니면 잠금(NOT_REVIEWED). 재조립은 재확인을 부른다. 단계 3(자동)은 확인 대신 **사후 표본 확인**(묶음마다 무작위 10% · 최소 1건).
- **불변 47(신설)**: 발송 html = 확인한 asset html. 외부용 부착물(법정 footer · 수신거부 링크)은 **조립 시점에 asset 안에** 들어간다. 발송 시점 변형은 제목 앞 `(광고) ` 접두 1개뿐이다(계약 테스트).
- **불변 48(신설)**: 수신거부는 GET 으로 기록하지 않는다(보안 스캐너 사전 열람 방어). GET = 확인 페이지 · POST = 기록 · `List-Unsubscribe-Post` 원클릭만 바로 기록. 기본 범위 = 그 회사 전체. 검수 메일에는 List-Unsubscribe 헤더를 넣지 않는다.
- **불변 49(신설)**: 원장에는 주소 원문을 두지 않는다. `to_hash`·`email_hash` = HMAC-SHA256(`OUTREACH_HASH_SECRET`, 소문자 주소). 비밀값이 없으면 직접 발송 전체가 잠긴다(fail-closed). 잡 파기(만료·삭제) 때 contact 3칸은 null 로 비운다.
- **불변 50(신설)**: 네이버 스토어는 어떤 경로로도 fetch 하지 않는다(0826 §16-1-1 유지 · 0923 재실측 429). 저장값은 slug(`brand:xxx` · `smartstore:xxx`)이고 주소는 코드 템플릿이 만든다. 사람이 올린 저장본 파일은 **네트워크 요청 0** 으로 파싱하고, 그 텍스트는 붙여넣기와 같은 성격(면허 없음)이다.
- **불변 51(신설)**: 렌더 워커 요청은 프로세스 안 대기열 하나를 지난다(겹침 409 로 재료·채점이 조용히 빠지는 것 차단 · 대기 상한 초과만 busy). 이미지 제작도 겹치면 기다린다(대기 상한 초과만 예외). 일괄 체인은 한 건의 제작이 끝날 때까지 다음 건을 시작하지 않는다.

---

## 4. 데이터 (DDL 1회 · 배포 전 실행 · 옛 코드 무영향)

```sql
SET lock_timeout = '3s';
BEGIN;
ALTER TABLE sales_outreach_jobs
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_basis text,
  ADD COLUMN IF NOT EXISTS naver_store_slug text,
  ADD COLUMN IF NOT EXISTS reviewed_asset_id uuid;

CREATE TABLE IF NOT EXISTS sales_outreach_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES sales_outreach_jobs(id),
  asset_id    uuid NOT NULL,
  to_hash     text NOT NULL,
  host_key    text NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('manual','bulk','auto')),
  outcome     text NOT NULL DEFAULT 'sending' CHECK (outcome IN ('sending','sent','rejected','unknown')),
  detail      text,
  meta        jsonb NOT NULL DEFAULT '{}',
  review_flag text CHECK (review_flag IN ('pending','ok','wrong')),
  reopened_at timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_sends_host_active
  ON sales_outreach_sends (host_key) WHERE outcome IN ('sending','sent') AND reopened_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_sends_created ON sales_outreach_sends (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_sends_job ON sales_outreach_sends (job_id);

CREATE TABLE IF NOT EXISTS sales_outreach_suppressions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash    text NOT NULL,
  host_key      text,
  scope         text NOT NULL CHECK (scope IN ('address','company')),
  reason        text NOT NULL CHECK (reason IN ('unsub','not_contact','bounce','manual')),
  source_job_id uuid,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_supp_email ON sales_outreach_suppressions (email_hash);
CREATE INDEX IF NOT EXISTS idx_outreach_supp_host ON sales_outreach_suppressions (host_key) WHERE scope = 'company';

CREATE TABLE IF NOT EXISTS sales_outreach_controls (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
COMMIT;
```

- 발송 원장 행은 파기 대상이 아니다(해시·호스트만 · 재발송 차단과 단계 조건의 원천).
- jsonb 키(DDL 0): `stage_results.review`({by, at, assetId}) · `stage_results.hold`({reason, by, at}) · `stage_results.domain_ack`({by, at}) · `stage_results.auto_confirmed_at` · `stage_results.auto_send`({by, at, rule}) · `stage_results.direct_last`({outcome, detail, at, mode}) · `brand_profile.contactPages`(제휴·문의 페이지 링크 ≤3).
- `sales_outreach_controls` 키 = `auto_send_stop`({stopped, reason, at, by}).

### ENV

| ENV | 뜻 | 없으면 |
|---|---|---|
| `OUTREACH_DIRECT_STAGE` | 직접 발송 단계 결재값 0·1·2·3 (Harold 결재 = 값) | 0 = 직접 발송 잠김 |
| `OUTREACH_HASH_SECRET` | 원장 해시·수신거부 토큰 비밀값(32바이트 hex) | 직접 발송 잠김 |
| `OUTREACH_DIRECT_DAILY_CAP` | 하루 직접 발송 시도 상한 | 5 |
| `OUTREACH_TEST_MAIL_ADDRESSES` | 검수 메일 허용 주소(정확 일치 · 쉼표) | 빈 목록 |

---

## 5. 직접 발송 (단계 1 기준 흐름)

**잠금(순수 `computeDirectSendLock` · 발송 함수와 조회 응답이 같은 함수)** = 기존 6종(`computeSendLock`) + 아래.

| 코드 | 뜻 |
|---|---|
| DIRECT_DISABLED | `OUTREACH_DIRECT_STAGE` < 1 |
| HASH_SECRET_MISSING | 비밀값 없음 |
| NO_CONTACT | 담당자 이메일 없음·형식 오류 |
| NO_BASIS | 수신 근거 없음 |
| DOMAIN_MISMATCH | 담당자 도메인이 다른 회사(홈페이지 등록 도메인과 다름 · 무료메일 아님) · 근거 확인 2클릭(`domain_ack`)으로 해제 |
| SUPPRESSED | 수신거부 원장(주소 또는 회사) |
| ALREADY_SENT_COMPANY | 이 회사(host_key)에 직접 발송 기록(sending·sent) 있음 |
| DAILY_CAP | 오늘 시도 건수 = 상한 |
| NOT_REVIEWED | 확인한 판 ≠ 최신 판 |
| UNSUB_LINK_STALE | 최신 판에 현재 담당자의 수신거부 링크가 없음(재조립 필요) |

도메인 판정 = `registrableDomain`(`sales-outreach-render-guard.ts`) 재사용 · 무료메일 표 = gmail.com · naver.com · daum.net · hanmail.net · kakao.com · nate.com · outlook.com · hotmail.com · yahoo.com · icloud.com · live.com · me.com.

**흐름**: `sendOutreachDirect(jobId, auth, expectedTo)`
1. 승인 기록 확인(사람 = `assertOperator` · 자동 = 승인 기록 형식 검사) → 잡·최신 asset 읽기 → 잠금 판정 → `expectedTo` ≠ 저장값이면 CONFLICT(CONTACT_CHANGED).
2. 트랜잭션: 잡 CAS(`mail_result='sending'` · stage ready · contact 일치) → `pg_advisory_xact_lock(hashtext('sales_outreach_direct'))` → 수신거부 NOT EXISTS → 오늘(KST) 시도 수 < 상한 → 원장 INSERT(outcome sending · 23505 = ALREADY_SENT_COMPANY) → COMMIT.
3. SMTP: 수신자 = 담당자 1명 · 제목 = `(광고) ` + asset.subject · html/text = asset 그대로 · 헤더 `List-Unsubscribe` + `List-Unsubscribe-Post`.
4. 결과: 원장 outcome·finished_at · 잡(sent = stage sent + mail_sent_at · 그 외 = mail_result) · rejected = 수신거부 원장 bounce(주소) · `direct_last`.
5. 자사 사본은 **따로** 1통(`[사본] ` 접두 · ENV 수신함 · 실패는 잡 결과 무영향).
6. 예외 = 원장·잡 sending → unknown 원복(발송 여부 모름 · 정직).

**조립 시점 부착(불변 47)**: 잡에 contact_email 이 있으면 제작·재조립이 `buildEmailAdFooter('주식회사 인비토(한줄로)', 발신 계정, 수신거부 URL)` 을 EMAIL_FOOTER_SLOT 에 넣는다. 수신거부 URL = `${PUBLIC_BASE}/api/outreach/u/${jobId}.${HMAC(jobId:toHash) 32자}`. 담당자를 저장·변경하면 ready 건은 **메일 재조립이 자동으로 돈다**(AI 0 · 제목·서두 보존 · 1클릭 원칙).

**수신거부 공개 경로**: `GET /api/outreach/u/:token` = 확인 페이지(noindex · "이 회사로 오는 안내 전체" 기본 체크 · 사유 = 더 받지 않음 / 담당자가 아님) · `POST` = 기록(폼 또는 원클릭 본문) · 토큰은 현재 담당자 또는 원장 해시로 검증 · 무효 토큰 = 같은 안내(존재 추측 차단) · 리미터 = 기존 공개 버킷.

**sweeper**: 끊긴 sending 복구가 잡과 원장을 한 문장(CTE)으로 함께 unknown. **파기**: 만료·삭제 파기 때 contact 3칸 null.

---

## 6. 단계 1 · 2 · 3 (완전 자동까지의 길)

**유효 단계 = min(`OUTREACH_DIRECT_STAGE`, 데이터가 허락하는 단계)** · 순수 `evaluateDirectStage(stats, env)` · 조회 응답에 그대로 싣는다.

| 단계 | 방식 | 데이터 조건(원장에서 센다) |
|---|---|---|
| 1 | 확인 → 건별 1클릭 | 없음(결재값 ≥1) |
| 2 | 확인한 건을 묶어 1클릭(백그라운드 순차 · 30초 간격 · 재시작 시 이어 보내지 않음) | 외부 발송 누적 30 · 하드 반송 0 · 오발송 0 |
| 3 | 업로드 때 "이 묶음 자동 발송 승인" 1클릭 → 제작이 끝난 건을 자동 발송 | 누적 100 · 반송률 2% 미만 · 수신거부율 1% 미만 · 최근 50건 중 발송 전 사람 수정 비율 10% 이하 · 최근 30건 자동 확정 뒤 사람 변경 0 · 자동 정지 아님 |

- **측정 출처**: 하드 반송 = 원장 outcome rejected · 오발송 = 수신거부 사유 `not_contact` + 사후 확인 `wrong` · 수신거부 = 원장 `unsub` · 사람 수정 = 잡 `stage_results.edits` 존재 · 자동 확정 변경 = `auto_confirmed_at` 이 있는데 발송 시 `confirmedBy` 가 `auto:v1` 이 아님(원장 meta 에 기록).
- **단계 3 자동 대상(건 조건)**: 잠금 0 · 담당자 도메인 = 홈페이지 도메인 · 확정 행사 중 **종료일이 명시된 미래** 면허가 1개 이상(홈 게시만의 면허는 제외) · DM 채점이 있고 `text_clipping_zero`·`first_screen_has_headline` 통과 · 붙여넣기·업로드 행사 아님 · 자동 확정 포스터는 인물 판정 `none` 만.
- **사후 확인**: 자동 발송분에 묶음마다 무작위 10%(최소 1) `review_flag='pending'` → 작업대 "사후 확인" 줄 → ok / wrong.
- **자동 정지**: 하드 반송 1건 · 하루 수신거부 2건 · 사후 확인 wrong 1건 → `sales_outreach_controls.auto_send_stop` 기록 → 자동 발송 멈춤. 다시 켜기 = 사람 버튼(감사 로그).
- 숫자는 전부 첫 기준값이다. 코드는 한 곳(`DIRECT_STAGE_RULES`)에 둔다.

---

## 7. 행사 자동 확정

- 일괄 업로드 옵션(기본 켬). 확정 대기에 닿은 건에서 **면허 있는 후보**(재대조 통과 + 미래 종료일 또는 홈 게시)를 후보 순서대로 앞 3개 → 사람 확정과 **같은 함수**(`confirmSelectionCore`) · `confirmedBy='auto:v1'` · imageUrl null · `stage_results.auto_confirmed_at`.
- 면허 후보 0 = 멈춘다(사람 3단계).
- 자동 확정 건의 포스터 누끼 후보는 인물 판정 `none` 만(`undetermined`·`unavailable` 제외 · fail-closed).

---

## 8. 직렬화 (조용한 품질 누수 차단)

1. **렌더 대기열**: `renderPageGuarded` 가 프로세스 안 대기열 하나를 지난다. 대기 상한(90초)을 넘으면 옛 계약 그대로 busy 실패. 호출부 무변경.
2. **이미지 제작 대기**: `imageInFlight` 가 차 있으면 기다린다(상한 120초 · 넘으면 옛 예외).
3. **일괄 체인**: 한 건 = 수집·분석 → (자동 확정) → 제작 완료(ready·failed)까지 기다린 뒤 다음 건. 대기 건 `lock_at` 은 체인이 갱신한다(대기 2시간 종결 회피).

---

## 9. 네이버 스토어

- 입력: 단건 칸 · 엑셀 열. `parseNaverStoreSlug(url)` → `brand:slug` / `smartstore:slug`(영문·숫자·`_`·`-` 2~40 · 예약어 거절). 형식 오류 = 그 칸만 무시 + 경고.
- 쓰임: 화면 표시(코드 템플릿 주소 링크) · 같은 스토어 중복 등록 판정. **fetch 0.**
- 화면 문구: "스토어 주소 저장됨 · 지금은 읽지 않습니다".
- 저장본 업로드(단건 예외 · 확정 대기 화면): 사람이 브라우저에서 저장한 기획전 페이지(.html/.htm · 2MB) → `buildOutreachEventMaterial` 로 텍스트만 추출(네트워크 0) → 직접 붙여넣기 칸을 채운다 → 확정하면 붙여넣기와 같은 경로(면허 없음 · 혜택 숫자는 빈칸 → 사람이 채우기 전 발송 잠금).
- DM 버튼 목적지로 스토어를 쓰는 것은 이번 범위 밖(CTA 키워드 표가 고정이라 DM 조립 순서가 바뀐다 · §16).

### 9-1. 화면 가져오기(★2026-09-24 · Harold B안 동의)

**코드 전 실측(Harold PC)**: G0 크롬에서 `brand.naver.com/toun28` 정상 표시 · 같은 PC curl(크롬 UA) = 429 → 막는 축은 "서버 IP 하나"가 아니라 브라우저 아닌 요청 전반일 수 있다(0923 설명 정정 · 원인 미확정). G1 시험 북마크 = 네이버 화면에서 실행됨 · 글자 13,749 · 정리본 130KB · 압축 24KB → `#` 전달 가능(크롬 주소 한도 2MB).

| 부품 | 규칙 |
|---|---|
| 북마크 [한줄로 가져오기] | 이미 떠 있는 화면만 읽는다(네이버 추가 요청 0). script·style·이미지·머리글·바닥글·입력칸 제거 · 속성은 class·id·href 만 · 공백 접기 · 60만 자 상한 · gzip → `{앱}/admin/outreach-grab#v=1&k=열쇠&g=압축본` 새 탭. 번들 난독화 때문에 스크립트는 문자열로 조립(`outreach-store-grab.ts`) |
| 설치 열쇠 | 설치 칸이 32자 hex 를 만들어 이 브라우저 localStorage 에 두고 버튼에 심는다. 수신 탭은 열쇠가 다르면 받지 않는다(남이 만든 링크로 문구를 못 붙인다) |
| 수신 탭 `/admin/outreach-grab` | `#` 를 읽자마자 주소에서 지운다(접속 기록은 pathname 만) → 판·열쇠 → 압축 풀기 → `POST /api/sales-outreach/store-grab` → 붙으면 BroadcastChannel 로 AI 영업 창·작업대에 알리고 2.5초 뒤 스스로 닫힘 · 여럿이면 고르기 1클릭 · 없으면 안내 |
| 서버 `grabOutreachStorePage` | 운영자 확인 → `parseNaverStoreSlug(페이지 주소)` → 같은 저장값 · 파기·삭제 제외 · 확정 전(`STORE_GRAB_STAGES`) 건 → `storePageTextOf`(저장본 업로드와 같은 추출기 · 2000자) → 조건부 UPDATE 1문으로 `stage_results.store_grab {text,chars,at,by}` 저장. 주소·HTML 원문 저장 0 · DDL 0 · 되돌리기(RESETTABLE_KEYS)가 지우지 않는다(홈페이지 재읽기와 무관한 입력) |
| 확인 화면 | 후보 카드 "네이버 스토어에서 가져옴"(고르면 칸에 들어가 사람이 보고 고친다 · 서버에는 직접 붙여넣기 경로 = 면허 없음) · [스토어 열기] · 설치 칸(열쇠 없으면 펼침) · 저장본(.html) 업로드는 예비로 유지 |
| 작업대 | 확정 전 카드에 [스토어 열기] · "스토어 가져옴 N자" 뱃지 · 알림 오면 새로고침 · 머리에 설치 칸 토글 |
| 일괄 자동 | 스토어 문구가 붙은 건은 자동 확정하지 않는다(선검사 + 확정 UPDATE 조건 `$7='human' OR store_grab IS NULL` · 확인과 확정 사이에 붙어도 막힌다) |

범위 밖: 배너 이미지 가져오기(약관 · §16-11 G5) · 홈페이지 없이 스토어만 있는 업체 등록 · DM 버튼 목적지.

---

## 10. 엑셀 양식

- 열: **업체명 · 홈페이지 · 업종(선택) · 네이버 스토어(선택) · 담당자 이메일 · 담당자명(선택) · 수신 근거**. 수신 근거 드롭다운 = 명함 / 기존 대화 / 제휴 문의 페이지 / 기타(직접 입력 허용).
- 파서 = **머리줄 이름으로 열을 찾는다**(옛 3열 양식도 그대로 읽힌다). 예시 영역은 I열부터(파서가 읽지 않는다).
- 이메일·스토어 형식 오류 = 행은 등록 · 그 칸만 무시 · `warnings`(거절 목록과 별도). 근거 공란 = 등록은 되고 발송만 잠긴다.
- 1회 상한 20행 유지.

---

## 11. 제안 메일 재구성 (순수 조립 · AI 0 · 렌더 0)

**제목**: 기본값 = `{업체} {확정 행사명} 모바일 DM 시안`(행사명은 면허와 무관하게 숫자·%·원 제거 · 6자 미만이면 행사명 빼기 · 35자 초과면 `{업체} 맞춤 모바일 DM 시안`). AI 제목은 `subjectCandidates` 에 후보로 남는다. 외부 발송 때만 코드가 `(광고) ` 를 붙인다(편집 칸 밖).

**구성(위에서 아래로)**
1. 발신 헤더(한줄로 · 작게)
2. 헤드라인 카드: `{업체} 홈페이지만 읽고 AI가 만든 모바일 DM 시안입니다` + 서두(담당자명이 있으면 첫 줄 호칭)
3. **[DM 열어보기] 버튼 바** ← 모바일 첫 화면 안
4. 그 브랜드 이메일 시안(로고 헤더 · 히어로부터 · 시안의 footer 는 뺀다)
5. 확정 행사 카드(제목 · 기간 줄) · 원문 인용 덤프 없음
6. 문자 문안 예시(있을 때)
7. 한 장 요약 카드: 자사몰 연동 · 5분 투자 3가지를 3줄로
8. 회신 문장 + 버튼(산출물 보기 · 카탈로그 · DM)
9. 법정 footer: 발신자 명칭 · 주소 · 연락처(INVITO_INFO) + (직접 발송 건) 수신거부 링크

- 'AI' 문구는 헤드라인 1번 · footer 고지 1번. 번호 태그(`1.`·`2.`·`3.`) 없음. "(예시 · 시안)" 괄호는 footer 고지로 합친다.
- 계약: 첫 cta 섹션이 앞에서 세 번째 안 · 조립 결과 'AI' 2회 이하 · 한글 리터럴 0(문구는 `emailCopy`).

---

## 12. 화면

**작업대(`SalesOutreachWorkbench.tsx` 신설 · 라이트 · 전체 화면)**: 모달 목록 모드의 "작업대" 버튼으로 연다.
- 머리: 묶음 고르기(최근 업로드 묶음 · 개별 등록) · 줄별 건수(서버 집계) · 발송 단계 뱃지(유효 단계 · 오늘 n/상한 · 자동 정지 상태와 다시 켜기).
- 줄: 읽는 중 · **확인 대기** · 제작 중 · **검토 대기** · **발송 대기** · 보낸 건 · 사후 확인 · 실패.
- **3초 판정 카드**: 받은편지함 한 줄(발신자 · `(광고)` 제목) · DM 첫 화면 캡처 · 받는 사람 + 도메인 뱃지(같음 녹색 · 무료메일 주황 · 다른 회사 빨강) · 잠금·경고 수 · 자동 확정 칩 · 채점 점 줄.
- 키보드: J/K 이동 · O 확인(그 판 id 기록) · X 보류(사유 5값) · Enter 상세 열기(`isComposing` 중 무시).
- 발송 대기 줄: "선택 N건 보내기"(단계 2 이상일 때만) · 확인 창에 수신자 표 전체.
- 상세 열기 = 기존 모달의 그 건 화면 + 이전·다음.

**모달(기존 4단계 · 이설 0 · 추가만)**
- 등록 칸: 담당자 이메일 · 담당자명 · 수신 근거 · 네이버 스토어 주소.
- 확정 대기: 스토어 저장본 올리기(붙여넣기 칸 채움).
- 검토: 담당자 카드(수정 · 제휴 문의 페이지 링크 칩 · 도메인 뱃지 · 불일치 해제 2클릭) · "이 판으로 확인" · "담당자에게 보내기"(주소 라벨 · 잠금 사유 · 전용 확인 창).

**발송 확인 창(`OutreachDirectSendConfirm.tsx` 신설)**: 받는 사람(도메인 굵게) · 도메인 뱃지 · 브랜드 · `(광고)` 제목 · DM 첫 화면 캡처 · 오늘 n/상한 · 되돌릴 수 없다는 문장. 서버 값만 표시.

---

## 13. API (ceo 전용 · 공개는 표시)

| 경로 | 뜻 |
|---|---|
| `POST /jobs` · `/jobs/bulk` | 담당자 3칸 · 스토어 주소 · 일괄 옵션(`autoConfirm` · `autoSend`) |
| `POST /jobs/:id/contact` | 담당자 저장(ready 면 재조립 자동) |
| `POST /jobs/:id/review` · `/hold` | 확인(assetId) · 보류(사유) |
| `POST /jobs/:id/domain-ack` | 도메인 불일치 해제 |
| `POST /jobs/:id/send-direct` | 단건 직접 발송(`expectedTo`) |
| `POST /jobs/send-direct-bulk` | 묶음 직접 발송(단계 2) |
| `POST /jobs/:id/reopen-contact` | 같은 회사 재접촉 열기(마지막 발송 90일 경과) |
| `POST /jobs/:id/store-page` | 저장본 파일 → 텍스트(DB 쓰기 0) |
| `GET /workbench` | 묶음 목록 + 카드(서버 계산) |
| `GET /direct/status` · `POST /direct/resume` | 유효 단계·통계 · 자동 정지 해제 |
| `POST /sends/:id/review-flag` | 사후 확인 ok·wrong |
| `GET·POST /api/outreach/u/:token` (공개) | 수신거부 확인 · 기록 |

---

## 14. 계약 테스트

1. 크롤·재료 코드에서 이메일 추출 0(불변 44).
2. 직접 발송 수신처 = 행 값 · 요청 인자 없음 · `expectedTo` 불일치 CONFLICT.
3. 발송 코어는 승인 기록(사람 · 묶음 승인) 없이 부를 수 없다(불변 1 개정).
4. 발송 html = asset html · 변형은 제목 접두 1개(불변 47).
5. 잠금 판정 표(순수) 전 항목 · 도메인 3구분 · 무료메일 표.
6. 단계 판정 표(순수) 경계값.
7. 수신거부 GET 은 기록하지 않는다 · 토큰 위조 거절 · 검수 메일 List-Unsubscribe 0.
8. 스토어 slug 파싱 · 네트워크 0 · 저장본 파싱 네트워크 0.
9. 엑셀 머리줄 파서(새 양식 · 옛 3열 · 경고 분리).
10. 제안 메일: 첫 cta 위치 · 'AI' 횟수 · 시안 footer 제거 · 제목 규칙 · 한글 리터럴 0.
11. 렌더·이미지 대기열 행동 테스트(겹친 두 요청이 순서대로 · 상한 초과 busy).
12. 자동 확정 = 면허 후보만 · 0이면 멈춤 · 포스터 인물 판정 fail-closed.

---

## 15. 순서

1. **DDL**(Harold · 배포 전) → information_schema 확인.
2. 백엔드: 순수 CT(해시·도메인·잠금·단계·slug·엑셀·제목) → 대기열 → 조립 재구성 → 발송 코어·원장 → 수신거부 공개 경로 → 자동 확정·체인 → 단계 2·3 → 라우트.
3. 프론트: 모달 추가분 → 발송 확인 창 → 작업대.
4. 테스트 · tsc · 빌드 확인 → 문서(FEATURE §2·§3·§4 · SCHEMA · OPS · STATUS).
5. 배포(백엔드 → 프론트) → ENV(`OUTREACH_HASH_SECRET` · `OUTREACH_DIRECT_STAGE=0` 유지) → 검수 메일 실측 → **법 판단 서면 뒤** `OUTREACH_DIRECT_STAGE=1`.

---

## 16. 범위 밖 · 미검증

- 범위 밖: DM 버튼 목적지에 스토어 주소 · 반송 메일(DSN) 수집(POP3) · 팝폰 DB 재사용 · 카탈로그 DM 수정(Harold §9 접수 대기) · 1회 20행 상한 조정.
- 미검증: 정보통신망법 제50조 사전 동의 대상 여부(Harold 서면 확인) · invitocorp.com SPF·DKIM·DMARC · 하이웍스 일일 발송 한도 · 브랜드스토어 차단 해제 시점.
