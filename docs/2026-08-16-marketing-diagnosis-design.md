# AI 마케팅 진단 — 설계서 (착수 원장) v3

> 2026-08-16 브레인스토밍(5역할·교차 반박·회의론자 검증) 수렴 → **적대 검토 3중 반영**(자가 4 · 회의론자 D1~D17 · Codex critical 2/high 15/medium 1). Harold 승인 완료.
> **다음 세션은 이 문서만 읽고 구현한다.** 목업 24종은 끌로드디자인이 [마스터 프롬프트](2026-08-16-diagnosis-example-mockups-master-prompt.md)(개정판 — 이미지 슬롯·Pretendard·비비드 톤)로 재제작 중.
> 완료 후 `docs/FEATURE-MARKETING-DIAGNOSIS.md`로 승격, STATUS 카드 회전. 호출어 **"마케팅 진단"**.

---

## 0. 정체성 — "진단다움"이 전부다 (Harold 원칙)

기존 AI 안내(AI Operation 모달·AI 꾸미기·무료체험 팝업)는 전부 **우리 얘기**였고 전환이 없었다. 진단은 순서를 뒤집는다: 고객이 먼저 자기 얘기를 하고(답변), 우리가 **그 회사 얘기로** 돌려준다.

- **리포트가 본체, 설문은 문진.** 전 블록이 답변·실적에서 파생 — 왜 이 요금제인지, 크레딧으로 뭘 할 수 있는지, 그 분야 실물 예시까지.
- **수치는 계산 가능한 것만.** 임의 % 절대 금지.
- **추천 근거는 실효 게이트다** — 이미 열려 있는 기능을 근거로 상위 요금제를 밀면 거짓 리포트다(§7 검증 C).
- 예시 = 이미지 스튜디오 실렌더 + 3채널 목업(셸은 끌로드디자인, 실물 이미지·폰트는 구현 세션 배치).

## 1. 확정 구조

| | 퍼널 A — 기존 고객사 | 퍼널 B — 잠재고객 |
|---|---|---|
| 대상 | **서버 판정 `plan_code='FREE'` 정확 일치**(유료·STAFF·TRIAL활성·plan 미배정 비노출) | 미인증 |
| 진입 | 로그인 후 대시보드: 최초 1회 초대 모달 + dismiss 없는 히어로 카드 | 영업 메일 링크 + 로그인 페이지 「무료 마케팅 진단」 버튼(좌측+모바일 우측) |
| 진단 | 8문항 위저드(§7 — 정의는 서버 단일) | 동일 + 첫 질문 "기존 고객사이십니까?"(예=로그인 안내·행 생성 없음) |
| 결과 | 제출 = 저장+**TRIAL 7일 자동 지급 한 트랜잭션**(1회 한정·예외 없음) → 히어로 "체험이 시작되었습니다 · D-7" | preview(추천 가린 결과) → 신청 폼(회사명·이름·이메일·전화·동의) → submit 저장 |
| 관리 | 「신규마케팅진단」 = A+B 전부 · **ceo 전용** | 동일 메뉴에서 리드 관리·수동 부여 |

**명명 규약**: 코드 축 접두 `marketing-diagnosis`. 라우트 파일 `routes/marketing-diagnosis{,-public,-admin}.ts` · API `/api/marketing-diagnosis/*`(인증) · `/api/public/marketing-diagnosis/*`(미인증) · `/api/admin/marketing-diagnosis/*`(ceo) · 프론트 `components/marketing-diagnosis/` · 사용자 URL만 `/diagnosis`. grep 앵커 = `marketing.?diagnos`.

## 2. 불변 원칙

1. **화면은 게이트가 아니다.** 노출·지급·제출 전부 서버가 `plan_code='FREE'` 재검사. 프론트는 요금제를 해석하지 않는다(state 필드만 소비).
2. **진단 계산은 크레딧을 차감하지 않는다** — AI 호출 0(A·B 공통, 순수 룰만). `ai_credits_purchased` 불변. ⚠ TRIAL **지급**이 `ai_credits_base_*`를 TRIAL 월값으로 리셋하는 것은 기존 지급 계약의 정상 동작이다(`basic-trial.ts:84-85`) — "차감 0"과 혼동 금지(§9-7).
3. **1회 한정 = DB 제약**: `diagnosis_trial_grants UNIQUE(company_id)` + funnel A 부분 UNIQUE(§3). 예외 재지급 경로 없음 — 예외는 기존 슈퍼관리자 수동 부여(`grant-basic-trial`)가 담당.
4. **답변→요금제 직접 매핑 금지.** 선택지→요구조건→plans 컬럼 2단. **요구조건은 ①실효 게이트 실측(§7 검증 C)을 통과한 축, 또는 ②정가표 용량 기준 축(Harold 확정)만 쓴다.** ②의 근거(★2026-08-16 v2): `max_customers`는 런타임 적재를 막지 않지만 요금제의 공표 용량 기준이라 "귀사 규모에 맞는 플랜" 추천은 거짓이 아니다 — 거짓은 "이미 열린 기능을 잠긴 것처럼 파는 것"뿐. 시장 실측(관리 10만+·월 발송 10만+ 업체가 흔함)으로 Harold가 직접 지시.
5. **추천 후보 = `is_active AND monthly_price > 0` 서버 파생.** 기존 `/api/plans`(비인증 SELECT *) 사용 금지.
6. **크레딧 환산 진실 = `ai-credit-calc.ts`.** 서버 계산 → result 스냅샷. 프론트 `credit.ts` 무접촉.
7. **진단 데이터를 companies 컬럼에 붙이지 않는다**(SELECT c.* 노출).
8. 퍼널 B 금액 0(건수·횟수만, 발송량은 구간 하한 인용).
9. 모델명 0 · native dialog 0 · Source caption · 목업 캡션 「예시 목업 · 가상 브랜드 · 실제 고객 사례 아님」 의무.
10. 신규 테이블 endpoint catch: `relation|column does not exist` **또는 활성 문항 세트 0개** → 503 `DB_MIGRATION_PENDING`(500 노출 금지 — `app.ts:408-411` 최종 핸들러가 500으로 바꾸기 전에 잡는다).

## 3. 데이터 모델 (DDL — 서버 psql, 코드 배포 후, **한 트랜잭션**)

```sql
BEGIN;

CREATE TABLE diagnosis_question_sets (
  version varchar(20) PRIMARY KEY,
  definition jsonb NOT NULL,               -- §7-1 스키마
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 활성 세트는 정확히 1개만 (0개=503, 2개+ 금지)
CREATE UNIQUE INDEX uq_dqs_active ON diagnosis_question_sets (is_active) WHERE is_active;

CREATE TABLE marketing_diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel char(1) NOT NULL CHECK (funnel IN ('A','B')),
  company_id uuid NULL REFERENCES companies(id) ON DELETE CASCADE,
  submitted_by uuid NULL,                  -- funnel A 제출 사용자 id (FK 미부착 — users 삭제 정책과 분리)
  lead_company_name varchar(200), lead_contact_name varchar(100),
  lead_email varchar(200), lead_phone varchar(30),
  consent_agreed boolean NOT NULL DEFAULT false,
  consent_agreed_at timestamptz, consent_version varchar(20),
  source_ip inet, user_agent text,
  source_utm varchar(100),                 -- 영업 링크 ?src= (answers에 넣지 않는다 — validator가 거부)
  question_set_version varchar(20) NOT NULL REFERENCES diagnosis_question_sets(version),
  answers jsonb NOT NULL,                  -- { "<question.key>": "<option.key>" } 전 문항 필수(§7-1 검증)
  result  jsonb NOT NULL,                  -- DiagnosisResultV1 (§7-2)
  recommended_plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,  -- 요금제 삭제와 충돌 금지(코드 스냅샷이 진실)
  recommended_plan_code varchar(20),
  recommended_monthly_price numeric(12,2),
  rule_version varchar(20) NOT NULL,
  lead_status varchar(20) NOT NULL DEFAULT 'none'
    CHECK (lead_status IN ('none','new','attempted','contacted','account_created','trial_granted','converted','disqualified','on_hold')),
  contact_attempts integer NOT NULL DEFAULT 0,
  disqualify_reason varchar(30),
  linked_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- funnel별 상호배타·필수 강제 (B는 동의 증빙 전부 필수 — 이름·전화·시각·버전)
  CHECK ( (funnel='A' AND company_id IS NOT NULL AND lead_email IS NULL)
       OR (funnel='B' AND company_id IS NULL AND lead_email IS NOT NULL
           AND lead_contact_name IS NOT NULL AND lead_phone IS NOT NULL
           AND consent_agreed AND consent_agreed_at IS NOT NULL AND consent_version IS NOT NULL) )
);
-- 퍼널 A 1회 제출을 DB가 강제 (동시 submit 경쟁 차단 — completedAt 조회는 보조)
CREATE UNIQUE INDEX uq_md_funnel_a ON marketing_diagnoses (company_id) WHERE funnel='A';
CREATE INDEX idx_md_created   ON marketing_diagnoses (created_at DESC);
CREATE INDEX idx_md_lead_mail ON marketing_diagnoses (lower(lead_email)) WHERE funnel='B';
CREATE INDEX idx_md_pipeline  ON marketing_diagnoses (lead_status) WHERE lead_status <> 'none';

CREATE TABLE diagnosis_trial_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  diagnosis_id uuid NOT NULL REFERENCES marketing_diagnoses(id),
  granted_days integer NOT NULL CHECK (granted_days > 0),
  trial_expires_at timestamptz NOT NULL,
  granted_by varchar(64) NOT NULL DEFAULT 'diagnosis-auto',  -- 자동='diagnosis-auto' / 수동='admin:{super_admins.id}' (행위자 원장 스냅샷 — Codex 2R)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id),
  UNIQUE (diagnosis_id)                    -- 한 진단이 여러 회사에 지급되는 경로 차단
);

CREATE TABLE diagnosis_invites (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  invited_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- seed v1 (★2026-08-16 커밋 0 실측·B안 확정 최종형 — §3-1·§7-1. DDL 커밋 후 실행)
INSERT INTO diagnosis_question_sets (version, definition, is_active) VALUES ('v1', $$
{"version":"v1","rule_version":"r1","questions":[
 {"key":"industry","text":"어떤 분야이신가요?","type":"industry_grid","tags":["example_filter","asset"],
  "options":[{"key":"fashion","label":"의류/패션"},{"key":"beauty","label":"뷰티/화장품"},
             {"key":"fnb","label":"식음료/카페"},{"key":"ecommerce","label":"쇼핑몰/이커머스"},
             {"key":"medical","label":"병원/의료"},{"key":"education","label":"학원/교육"},
             {"key":"travel","label":"여행/레저"},{"key":"fitness","label":"피트니스"}]},
 {"key":"monthly_send","text":"한 달 메시지 발송량은 어느 정도인가요?","type":"single","tags":["asset"],
  "options":[{"key":"u1k","label":"1천 건 이하"},{"key":"k1_10k","label":"1천~1만 건"},
             {"key":"k10_100k","label":"1만~10만 건"},{"key":"o100k","label":"10만 건 이상"}]},
 {"key":"customer_db","text":"관리할 고객 데이터 규모는 어느 정도인가요?","type":"single","tags":["asset"],
  "options":[{"key":"none","label":"아직 없어요"},{"key":"u1k","label":"1천 명 이하"},
             {"key":"k1_10k","label":"1천~1만 명"},{"key":"o10k","label":"1만 명 이상"}]},
 {"key":"mobile_dm","text":"모바일 DM(랜딩형 메시지)이 필요하신가요?","type":"single","tags":["asset"],
  "options":[{"key":"no","label":"필요 없어요"},{"key":"interest","label":"관심 있어요"},
             {"key":"m1_2","label":"월 1~2회 쓸 것 같아요"},{"key":"m3p","label":"월 3회 이상"}]},
 {"key":"ai_usage","text":"AI 제작(문안·이미지)은 얼마나 쓰실 것 같나요?","type":"single","tags":["recommend"],
  "options":[{"key":"none","label":"안 쓸 것 같아요"},
             {"key":"u10","label":"월 10회 이하","requires":[{"column":"ai_credits_per_month","op":"gte","value":50}]},
             {"key":"m10_50","label":"월 10~50회","requires":[{"column":"ai_credits_per_month","op":"gte","value":250}]},
             {"key":"o50","label":"월 50회 이상","requires":[{"column":"ai_credits_per_month","op":"gte","value":500}]}]},
 {"key":"auto_campaign","text":"자동 발송(생일·재방문 등)을 몇 개나 돌리고 싶으신가요?","type":"single","tags":["asset"],
  "options":[{"key":"none","label":"필요 없어요"},{"key":"q1_5","label":"1~5개"},
             {"key":"q6_10","label":"6~10개"},{"key":"q11p","label":"10개 초과"}]},
 {"key":"cdp","text":"자사몰(쇼핑몰) 연동이 필요하신가요? 필요하다면 월 고객 행동 데이터 규모는?","type":"single","tags":["asset"],
  "options":[{"key":"no","label":"필요 없어요"},{"key":"u10k","label":"월 1만 건 이하"},
             {"key":"k10_100k","label":"월 1만~10만 건"},{"key":"o100k","label":"월 10만 건 이상"}]},
 {"key":"email_mkt","text":"이메일 마케팅은 어떻게 하고 계신가요?","type":"single","tags":["asset"],
  "options":[{"key":"none","label":"안 하고 있어요"},{"key":"own_tool","label":"자체 도구로"},
             {"key":"agency","label":"외주/대행"},{"key":"want_hanjul","label":"한줄로로 하고 싶어요"}]}
]}
$$::jsonb, true);

-- seed v2 (★2026-08-16 개통 직후 Harold 확정 — 규모 축 재도입·구간 상향. 진행 원장 참조.
--  실행 = v1 비활성 + v2 활성 한 트랜잭션. 문항 표시는 즉시 v2로 바뀐다·v1 제출분 무영향)
BEGIN;
UPDATE diagnosis_question_sets SET is_active = false WHERE is_active;
INSERT INTO diagnosis_question_sets (version, definition, is_active) VALUES ('v2', $$
{"version":"v2","rule_version":"r2","questions":[
 {"key":"industry","text":"어떤 분야이신가요?","type":"industry_grid","tags":["example_filter","asset"],
  "options":[{"key":"fashion","label":"의류/패션"},{"key":"beauty","label":"뷰티/화장품"},
             {"key":"fnb","label":"식음료/카페"},{"key":"ecommerce","label":"쇼핑몰/이커머스"},
             {"key":"medical","label":"병원/의료"},{"key":"education","label":"학원/교육"},
             {"key":"travel","label":"여행/레저"},{"key":"fitness","label":"피트니스"}]},
 {"key":"monthly_send","text":"한 달 메시지 발송량은 어느 정도인가요?","type":"single","tags":["asset"],
  "options":[{"key":"u10k","label":"1만 건 이하"},{"key":"k10_100k","label":"1만~10만 건"},
             {"key":"k100_500k","label":"10만~50만 건"},{"key":"o500k","label":"50만 건 이상"}]},
 {"key":"customer_db","text":"관리할 고객 데이터 규모는 어느 정도인가요?","type":"single","tags":["recommend"],
  "options":[{"key":"none","label":"아직 없어요"},
             {"key":"u100k","label":"10만 명 이하","requires":[{"column":"max_customers","op":"gte_or_null","value":100000}]},
             {"key":"k100_300k","label":"10만~30만 명","requires":[{"column":"max_customers","op":"gte_or_null","value":300000}]},
             {"key":"k300_1m","label":"30만~100만 명","requires":[{"column":"max_customers","op":"gte_or_null","value":1000000}]},
             {"key":"o1m","label":"100만 명 이상","requires":[{"column":"max_customers","op":"gte_or_null","value":3000000}]}]},
 {"key":"mobile_dm","text":"모바일 DM(랜딩형 메시지)이 필요하신가요?","type":"single","tags":["asset"],
  "options":[{"key":"no","label":"필요 없어요"},{"key":"interest","label":"관심 있어요"},
             {"key":"m1_2","label":"월 1~2회 쓸 것 같아요"},{"key":"m3p","label":"월 3회 이상"}]},
 {"key":"ai_usage","text":"AI 제작(문안·이미지)은 얼마나 쓰실 것 같나요?","type":"single","tags":["recommend"],
  "options":[{"key":"none","label":"안 쓸 것 같아요"},
             {"key":"u10","label":"월 10회 이하","requires":[{"column":"ai_credits_per_month","op":"gte","value":50}]},
             {"key":"m10_50","label":"월 10~50회","requires":[{"column":"ai_credits_per_month","op":"gte","value":250}]},
             {"key":"o50","label":"월 50회 이상","requires":[{"column":"ai_credits_per_month","op":"gte","value":500}]}]},
 {"key":"auto_campaign","text":"자동 발송(생일·재방문 등)을 몇 개나 돌리고 싶으신가요?","type":"single","tags":["asset"],
  "options":[{"key":"none","label":"필요 없어요"},{"key":"q1_5","label":"1~5개"},
             {"key":"q6_10","label":"6~10개"},{"key":"q11p","label":"10개 초과"}]},
 {"key":"cdp","text":"자사몰(쇼핑몰) 연동이 필요하신가요? 필요하다면 월 고객 행동 데이터 규모는?","type":"single","tags":["asset"],
  "options":[{"key":"no","label":"필요 없어요"},{"key":"u10k","label":"월 1만 건 이하"},
             {"key":"k10_100k","label":"월 1만~10만 건"},{"key":"o100k","label":"월 10만 건 이상"}]},
 {"key":"email_mkt","text":"이메일 마케팅은 어떻게 하고 계신가요?","type":"single","tags":["asset"],
  "options":[{"key":"none","label":"안 하고 있어요"},{"key":"own_tool","label":"자체 도구로"},
             {"key":"agency","label":"외주/대행"},{"key":"want_hanjul","label":"한줄로로 하고 싶어요"}]}
]}
$$::jsonb, true);
COMMIT;
```

**착수 전 검증 SQL·grep (커밋 0 — 결과가 §7 requires를 확정한다)**
```sql
-- A. 참조 컬럼 실존
SELECT column_name FROM information_schema.columns WHERE table_name='companies'
  AND column_name IN ('subscription_status','trial_expires_at','plan_id');
SELECT column_name FROM information_schema.columns WHERE table_name='company_plan_changes'
  AND column_name IN ('change_type','company_id');
-- B. plans 실값 (§7 gte 값·후보 필터 확인)
SELECT plan_code, monthly_price, is_active, max_customers, max_auto_campaigns,
       cdp_events_per_month, ai_credits_per_month, customer_db_enabled,
       auto_campaign_enabled, mobile_dm_enabled, cdp_enabled
  FROM plans ORDER BY monthly_price;
-- D. 강등 안전 가드 대상 실측 (§4-2 — 유료 plan + status='trial' 조합이 실존하는가)
SELECT p.plan_code, count(*) FROM companies c JOIN plans p ON p.id=c.plan_id
  WHERE c.subscription_status='trial' GROUP BY 1;
-- (정정 2026-08-16: companies에 is_active 없음 — 실컬럼 status·NULL=활성)
SELECT COALESCE(status,'(null)') AS status, count(*) FROM companies
  WHERE plan_id IS NULL GROUP BY 1;
```
**C. 실효 게이트 실측(grep — Codex 지적: 문서가 인용한 플래그는 타입 필드였고 런타임은 0814 이후 더 넓게 개방)**: `plan-guard.ts` 실행 함수들(339행 부근~)에서 고객DB·DM·자동캠페인·CDP가 **실제로 어느 요금제에서 막히는지** 실독 → 막히지 않는 축은 §7 requires에서 **제거**(추천 근거 금지 — 이미 열린 기능으로 상위 플랜을 밀면 거짓 리포트). 한도 축(`ai_credits_per_month`·`cdp_events_per_month` 등)은 게이트가 아니라 수량이므로 유지.

### 3-1. 커밋 0 실측 결과 (2026-08-16 — 이 절이 §7-1 값을 확정한다)

- **A**: 참조 컬럼 전부 실존. D-2의 `is_active`는 설계서 오기 — 정정 쿼리 재실측 = **plan 미배정 회사 0건**(비노출 분기는 실population 없는 안전망).
- **B**: `ai_credits_per_month` 사다리 정상(STARTER 300 / BASIC 750 / PRO 2400 / BUSINESS 7800 / ENTERPRISE 16500). **역전 2축** — `max_auto_campaigns`: STARTER·BASIC **NULL(런타임 무제한)** vs PRO 5·BUSINESS 10 / `cdp_events_per_month`: STARTER **NULL(무제한)** vs BASIC 1만. `auto_campaign_enabled` 실값은 ENTERPRISE·STAFF만 t(플래그를 requires로 썼다면 550만원 오추천 — 적대 검토 함정 실증).
- **C**: 런타임 게이트는 **FREE만 차단** — 고객DB는 FREE 포함 전 플랜 허용(`plan-guard.ts:339`), DM·자동발송은 플래그 미사용, CDP는 `cdp-auth.ts isCdpEnabledForPlan`이 FREE만 차단. 수량 축 실사용 = `max_auto_campaigns`(`resolveMaxAutoCampaigns`) · `cdp_events_per_month`(`isOverMonthlyCdpLimit` — NULL=무제한) · `ai_credits_per_month`(크레딧).
- **D**: 유료 plan+`status='trial'` **0건**(§4-2 가드 = 예방 장치 확정) · FREE+trial **29건**(체험 이력 4항 ②로 `not_eligible` — 진단은 저장·구제는 수동 부여) · TRIAL 6건 정상.
- **§7-1 확정**: Q5 value = **50/250/500**(`generate-messages` 5크레딧 × 10/50/100회 — 경계: u10·m10_50 STARTER+, o50 BASIC+). Q3·Q4 requires **제거**(실효 게이트 아님). **Q6·Q7 requires도 제거 = B안 — Harold 확정(2026-08-16 "추천 방식으로 진행")**(역전 실값 탓 — gte_or_null이면 "6~10개" 답에 PRO 탈락·STARTER 추천). 추천 차별 축은 `ai_credits_per_month` 단일(추천은 STARTER 또는 BASIC으로 수렴 — FREE 첫 유료 전환 퍼널에 정합). 리포트 "잠금 해제" 블록은 **DM·자동발송·AI·CDP 4축만**(고객DB는 FREE도 열려 있어 잠금 해제 근거 사용 금지).

## 4. 백엔드

### 4-1. 제출+지급 = 한 트랜잭션 (Codex critical 2 — submit이 소유한다)

`POST /api/marketing-diagnosis/submit` 이 **client 하나로 전 과정을 소유**한다. 진단 저장과 지급을 쪼개면: 먼저 커밋 → 지급 실패 시 completedAt이 재시도를 영구 차단 / 안 커밋 → grants FK가 진단을 못 본다. 그래서:

```
BEGIN (client 1개)
  SELECT c.*, p.plan_code FROM companies c LEFT JOIN plans p ON p.id=c.plan_id
    WHERE c.id=$1 FOR UPDATE OF c                    -- 직렬화. LEFT JOIN(plan_id NULL도 행 필요)
  ⓐ 기지급 선판정: SELECT 1 FROM diagnosis_trial_grants WHERE company_id=$1
      → 있으면 ROLLBACK, 저장된 result와 함께 'already_granted' (재호출 안정 응답)
  ⓑ funnel A 중복: 부분 UNIQUE가 최후 방어 — INSERT 충돌 시 ROLLBACK '이미 제출됨'(409)
  ⓒ answers 완전 검증(§7-1) → 룰 계산(순수 함수) → INSERT marketing_diagnoses (result 포함)
  ⓓ 지급 자격: plan_code IS DISTINCT FROM 'FREE' → 'not_applicable'(지급 없이 COMMIT — 진단은 저장)
     체험 이력 4항 OR(아래) → 'not_eligible'(동일 — 진단은 저장, 지급만 없음)
  ⓔ expiresAt = grantFreeTrial(companyId, 7, { client })   -- 반환의 trial_expires_at 사용(이미 반환함 — 확장 금지)
  ⓕ INSERT diagnosis_trial_grants(...) — UNIQUE 충돌 시 전체 ROLLBACK 'already_granted'
COMMIT → 'granted'
실패(예외) → 전체 ROLLBACK 'failed' — 진단도 저장 안 됨 = 재시도 가능(복구 경로)
```

**체험 이력 4항 OR** (fail-closed): ①`EXISTS(company_plan_changes WHERE company_id=$1 AND change_type='trial_start')` ②`subscription_status IN ('trial','trial_expired')` ③`plan_code='TRIAL'` ④**`trial_expires_at IS NOT NULL`**(FREE인데 만료일 잔존 = 관리자 직접 변경 등 원장 밖 이력의 흔적 — 이 조건이 `GREATEST` 초과 연장도 함께 차단).

**`grantFreeTrial` 변경 = client 주입 하나** — 단 **helper 내부의 모든 SQL이 그 client를 타야 한다**(Codex high: 현재 TRIAL 플랜 조회가 전역 `query`(`basic-trial.ts:50-56`)라 client만 넘기면 풀 고갈 데드락이 그대로 남는다). client 있으면 BEGIN/COMMIT/ROLLBACK/알림 호출부 소유·`recordPlanChange`·플랜 조회까지 전부 client, 없으면 기존 동작. **반환 shape 불변**(이미 `trial_expires_at` 반환 — `companies.ts:1951-1958`이 응답에 그대로 실음). 기존 호출부 2곳(`companies.ts:1951`·`admin.ts:1554`) 회귀 테스트 같은 커밋.

### 4-2. 동반 수정 — 강등 워커 (`trial-downgrade-worker.ts`)

기존 구멍: 헤더 주석은 plan_code 기준인데 실제 WHERE(61행)는 status만 → 관리자 수정이 status를 덮으면 체험 영구 무료. 수정:

- 술어 상수(무접두사 — SELECT·UPDATE 공유): `( (subscription_status = 'trial' OR plan_id = (SELECT id FROM plans WHERE plan_code = 'TRIAL' LIMIT 1)) AND trial_expires_at IS NOT NULL AND trial_expires_at < NOW() )`
- **유료 플랜 강등 절대 금지 가드**(Codex critical 1): 강등 실행 전 현재 plan의 `monthly_price > 0 AND plan_code <> 'TRIAL'`이면 **강등하지 않고 경고 로그**(상태만 잘못 남은 유료사가 FREE로 떨어지는 사고 차단 — `admin.ts:655-660,714`가 상태 단독 변경을 허용하므로 실존 조합이다. 커밋 0 검증 D가 현재 몇 건인지 확인). 레거시 유료코드 체험이 이 가드에 걸리면 로그로 드러난다 — 그때 개별 처리.
- 헤더 주석 일치화(같은 커밋) · 회귀 픽스처 4종: ①status trial+만료 ②status 덮인 TRIAL+만료(새는 집합) ③TRIAL+만료일 NULL(강등 금지) ④**유료 plan+status trial+만료(강등 금지 — 가드)**. 조건 반전 주입으로 빨간불 실측.
- `admin.ts:714` COALESCE는 별건(§10).

### 4-3. 인증 API — `routes/marketing-diagnosis.ts`

| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/state` | 아래 명세 — 화면 판정 전부 이 한 응답 |
| GET | `/report` | 최신 funnel A 행의 result(DiagnosisResultV1) + recommended_* — 「리포트 다시 보기」·새로고침 재열람 계약(submit 400과 무관) |
| POST | `/invited` | 초대 모달 표시 기록(멱등 ON CONFLICT DO NOTHING). localStorage 판정 금지 |
| POST | `/submit` | §4-1 전체. 이미 제출이면 409 + report 안내 |
| POST | `/consult` | CTA②: 기존 A 행 `lead_status 'none'→'new'`(새 행 아님·멱등) |

**state 응답**: `{ eligible, grantable: 'available'|'already_granted'|'not_eligible'|'not_applicable', completedAt, invitedAt, trialExpiresAt, recommendedPlanCode }` — `grantable`이 CTA 분기의 유일 입력, `trialExpiresAt`(companies 실측)이 D-N 카드의 유일 출처. 활성 문항 세트 0개면 503(원칙 10).

### 4-4. 공개 API — `routes/marketing-diagnosis-public.ts` (퍼널 B)

- **마운트(medium 정정)**: 라우터는 정상 mount 블록에 두고, **경로 한정 `express.json({limit:'32kb'})` 한 줄만** 전역 파서(`app.ts:254`) 앞에 선배치(라우터 전체를 앞에 두면 공통 미들웨어를 건너뛴다). 413(limit 초과)은 400으로 변환해 응답(최종 핸들러 500 방지).
- 라우트 4: `GET /questions`(활성 definition — **문항의 단일 진실. 프론트 상수 없음**) / `POST /preview`(answers만 → 완전 검증 → 룰 계산 → **추천 요금제를 가린 부분 결과** 반환·저장 없음) / `POST /submit`(answers+리드 4필드+동의 → 서버가 재계산·검증 후 funnel B 저장, `lead_status='new'` **명시**, `consent_agreed_at=now()`·`consent_version` 서버 기록, 결과 전체 반환) / `GET /credit-costs`(CREDIT_COST_MAP 파생, 단가 제외).
- 방어: IP 10분 5회 리밋 · 허니팟 · 서버 형식 검증(이메일 정규식·전화 숫자·길이 상한) · 동의 없으면 400 · **이메일 중복 = 항상 200 동일 문구, 새 행 저장**(스냅샷 불변 — 묶음은 관리 목록 grouping) · POST body 전용 · `?src=`는 `source_utm` 컬럼(100자 상한 — answers에 넣으면 validator가 거부한다).
- **AI 호출 0.**

### 4-5. 추천 룰 CT — `utils/plan-recommend.ts` (순수 함수)

입력 `(answers, planRows, definition)` → 출력 `{ plan|null, reasons[], no_match }`.
- requires는 **선택지에** 붙는 배열(§7-1). op 3종 `is_true`/`gte`/`gte_or_null` — **컬럼별 허용 op 표를 CT가 소유**, `ai_credits_per_month`는 `gte`만(NULL=0 컬럼 — gte_or_null이면 값 안 채운 요금제가 최저가 추천되는 사고).
- **answers 완전 검증**(Codex high): 객체형 · 활성 definition의 문항 key 집합과 **정확히 일치**(누락·초과 400) · 값은 그 문항의 option key 중 하나. 저장·계산·지급 전부 이 검증 뒤에만.
- 선택 = 전 조건 만족 행 중 `monthly_price ASC, plan_code ASC`(동률 2차 정렬 확정). **만족 행 0 = `no_match`** → 리포트는 추천 카드 대신 「상담으로 확인해 드립니다」 + CTA 상담 신청(오추천 금지).
- `reasons[]` = 발동한 (문항 문장, 선택지 라벨, 컬럼) 목록.
- 룰 행렬 테스트: ①전부 최소 → 최저 유료 ②Q4 월1~2회 → DM 요구 발동 ③Q4 "관심" → 미발동 ④Q6 1~5 → 자동발송 요구 발동 ⑤Q7 10만+ → 상위 이벤트 한도 ⑥전부 최대 ⑦빈 answers·위조 option·문항 누락 → 400 ⑧no_match 케이스.

### 4-6. ceo 게이트 — `routes/marketing-diagnosis-admin.ts`

```ts
router.get('/access', authenticate, requireSuperAdmin, accessHandler); // ★게이트 use보다 먼저 선언
router.use(authenticate, requireDiagnosisAdmin, requireSuperAdmin);   // 이하 전 라우트 게이트
```
- `/access`는 **같은 전용 라우터 안에서 게이트 use 앞줄**(Codex: 별도 generic 라우터에 두면 전용 라우터 mount가 선점해 404 — mount는 한 번만). 응답 `200 {allowed}` — 기존 3축 대칭.
- 판정: `audit-log.ts`에 **`isDiagnosisViewer(superAdminId)` 래퍼 추가·export**(기존 `isSuperAdminAllowed`는 미export — D1). **인자 = `req.user.userId`(super_admins.id uuid)** — loginId 문자열을 넘기면 uuid 비교 예외를 catch가 삼켜 전원 404. ENV `MARKETING_DIAGNOSIS_VIEWER_IDS`, fallback `'ceo'`.
- 게이트 안: 목록(A+B·필터·이메일 그룹) / 상세 / 상태 변경(허용 전이 표: `none→new`는 consult만, `account_created`는 funnel B만) / **수동 부여 = 잠긴 diagnosis 행에서 대상 파생**(임의 companyId 입력 금지 — 연결·지급·상태·감사 한 CT, §4-1과 같은 원자성) / `GET /badge`(신규 리드 수 — 404면 프론트 미렌더).
- 감사로그 details = `{diagnosis_id, company_id, outcome}`만(키 허용목록 테스트). pending-badges 공용 CT에 넣지 않는다.

### 4-7. 회사 병합·요금제 삭제 연동 (Codex high — 안 하면 기존 기능이 죽는다)

- **`company-merge.ts` 축 등록**: 신규 3테이블(company_id)+`linked_company_id`를 COMPANY_MERGE_AXES에 추가 — 미등록 테이블에 행이 있으면 병합이 차단된다(`company-merge.ts:370-382,589-607`). 정책: `marketing_diagnoses.company_id`·`linked_company_id` = 승계, `diagnosis_trial_grants`·`diagnosis_invites` = UNIQUE 충돌 시 선행 행 유지. 머지 축 테스트 동반.
- `recommended_plan_id ON DELETE SET NULL`(§3 반영) — 요금제 삭제(`admin.ts:1471-1491`)가 500으로 죽지 않게. 스냅샷 3컬럼(code·price)이 진실이라 정보 손실 없음.

## 5. 프론트엔드

### 5-1. 제거·청소 좌표 (전수 실측)

**A. 죽은 무료체험 축**(마감 경과로 무동작 — 청소): `Dashboard.tsx:10`(import) · `:176-186`(state — `plan-request/status` 호출은 남기고 setter만) · `:2474-2515`(와이드 배너) · `:4049-4063`(팝업 마운트) · `components/OpenTrialPopup.tsx` 파일 삭제 · `backend/utils/basic-trial.ts:19-20` 주석 갱신. 백엔드 라우트·CT 무접촉.

**B. 직접발송 AI 다듬기 안내**: `Dashboard.tsx:64·354-356·1036-1050·1052-1063·3705-3711` + **`:1060` dispatch와 `DirectSendPanel.tsx:235,246-247` 리스너 쌍 제거** + `DirectSendAiRefinePopup.tsx` 파일 삭제. ⚠`AiRefineModal.tsx` 삭제 금지(소비처 3곳).

**C. AI Operation 모달 존치 + 분기**: `AiOperatorWalkthroughModal.tsx`·`Dashboard.tsx:65-66,171-172,4075-4077` 존치. `:2249-2263`·`:2823-2836` 분기: `access=true→이동 / false&&eligible→진단 / false&&기타·catch→기존 모달`.

### 5-2. 노출 로직

- `GET /state` **독립 useEffect** 1회(loadStats 직렬에 안 매담). 상태 4값 `loading/show/hide/error` — error=이번 세션 미노출·무기록(fail-quiet).
- **초대 모달**: `eligible && !completedAt && !invitedAt` → 표시 즉시 `POST /invited`. 초대 형식(3줄+시작 버튼·백드롭/Esc 허용·「나중에 하기」·요금제/가격/무료 단어 0).
- **히어로 카드**: `eligible && !completedAt` → 진단 유도(dismiss 없음·실물 크기) / `completedAt && trialExpiresAt>now` → 「체험 D-N · 첫 발송 해보기」(D-N=state.trialExpiresAt) / 그 외 없음.
- **위치**: `<main>`(`:2316`) **안** 최상단 — BrandVoiceNudgeCard(`:2318`) 위(`:2313` OnboardingCard는 main 밖 — 그 자리 아님).
- 카드 문안 4조건(회사명 1인칭·"8문항 약 2분" 비용 공개·가격 단어 0·NEW 뱃지만). BrandVoiceNudgeCard는 진단 카드 노출 중 `suppress` prop으로 미렌더 — 미등록은 리포트 소견 항목으로 흡수.

### 5-3. 위저드 — `components/marketing-diagnosis/DiagnosisWizard.tsx` (1소스, A=모달 셸·B=페이지 셸)

- **문항 정의 = 서버 단일**(Codex high — 프론트 상수 폐지): A·B 모두 `GET /api/public/marketing-diagnosis/questions`로 활성 definition 수신. 로드 실패 = 위저드 미노출(fail-quiet).
- 한 화면 1문항 · 선택 220ms 후 전환 · [다음] 없음 · 답 칩 줄 복귀 · 진행바+"남은 질문 N개" · 일반 문항 선택지 4개/12자 상한 · 업종만 8칩 그리드 · `JourneyModalShell` 재사용 + **백드롭·Esc 2축 opt-out prop 신설**(`:95` 백드롭, `:54-55` Esc capture — 하나만 막으면 Esc 한 번에 답 소실) · z-[2000] · 모바일 바텀시트·탭 타깃 56px · aria-live.

### 5-4. 결과 리포트 — 1 히어로 + 2 근거 (진단 → 효과 → 요금제)

- **히어로(퍼널 A, outcome별)**: `granted` → **"7일 무료체험이 시작되었습니다 · D-7"** + 흰 버튼 「첫 발송 해보기」(자동 지급이므로 "시작하기" 버튼은 존재하지 않는다 — 죽은 버튼 금지) / `not_eligible`·`already_granted` → 진단 판정 1문장 + 흰 버튼 「추천 요금제로 상담 신청」(`POST /consult`) + 보조 「리포트 다시 보기」(`GET /report`) — "이미 사용하셨습니다"는 하단 회색 1줄만 / `no_match` → 「상담으로 확인해 드립니다」.
- 근거 1 효과 → 근거 2 추천 요금제 1장+reasons(발동 문항 문장 표기)+「다른 요금제 보기」 링크 → 예시 블록(§5-5) → 하단 「나중에 결정할게요」.
- **데이터 원천표** — 퍼널 A: 월 실발송·유형 비중·사용금액(`customers.ts:794-802` — **SMS 799행 포함, 계산은 공용 utils CT로 추출해 대시보드와 공유** — route-local 복사 금지) · 잠금 해제 기능(실효 게이트 기준 — §7 검증 C 통과 축만) · 크레딧 환산(`ai_credits_per_month`×`ai-credit-calc`) · 한도 배수. 퍼널 B: 크레딧 환산·한도 수치·답변 인용 대조표만, **금액 0**. 공통 금지: 단가 절감(회사별 협상값 — 구조적 거짓)·무료 메시징 수량(DDL 미실행)·매출/응답률 %.
- 퍼널 B preview 판: 추천 요금제 카드 자리 = "요금제 추천은 담당자가 함께 확인드립니다"(블러 금지) → submit 후 전체 공개.

### 5-5. 목업 통합

- **수납 완료(0816 선배치)** = `packages/frontend/public/diagnosis-examples/` — HTML 24 + `assets/` 자리표시 PNG 40 + `assets/README.md`(슬롯 목록·비율 소유). 끌로드디자인 v2 산출물이 **기계 검증 12항목 전부 PASS**(JS 0·외부요청 0·플레이스홀더 0·Pretendard 24/24·도형 일러스트 제거·수신거부 24/24·모델명 0·참조 40종=동봉 40종). 다음 세션은 이 폴더를 그대로 쓴다.
- **남은 우리 몫 2** (커밋 6): ①`assets/fonts/PretendardVariable.woff2` 배치(zip 미포함 — 게이트웨이 대시보드 `web/dashboard/public/fonts/`에 같은 파일 실재, SIL OFL 고지 동반 복사) ②**회색 자리표시 40종 → 이미지 스튜디오 실렌더 교체**(비율은 `assets/README.md`. 이 교체가 최종 퀄리티를 결정한다 — 자리표시 상태로 노출 금지).
- 업종 8칩 = 마스터 프롬프트 8코드 1:1. 렌더 = `<iframe sandbox="" loading="lazy">` 1행 3장·클릭 확대만·**JS 금지 CSS만**. 캡션 의무. 이미지·목업 블록 분리. 미완성 카테고리 블록 감춤.

### 5-6. 퍼널 B 페이지 — `pages/DiagnosisPage.tsx`

- 라우트 `/diagnosis` 공개(`App.tsx:650-658` 전례) · **정적 import**(`:10-12` — 0718 사고) · 와일드카드(`:661`) 확인 · `?src=` → submit의 `source_utm`.
- 다크+violet 세계관(영업 랜딩·미인증 전례 동일) · 성공만 emerald · 폼 = **회사명**·담당자명·이메일·전화·동의 1체크(사전 체크 금지·미동의 disabled — 히어로가 회사명을 쓰므로 회사명 필수) · 허니팟 · `/privacy` 링크 · 옛 흰 form 마크업 복제 금지.
- 로그인 버튼 2곳: `LoginPage.tsx:541-545` 좌측 + 모바일 우측 `:635-641`(좌측 패널 `hidden lg:flex`).

### 5-7. 슈퍼관리자 「신규마케팅진단」

- 메뉴: `AdminDashboard.tsx:4076` tabs + `:4077-4088` items 스프레드 조건부(기존 3축 패턴 `:4097,4099,4103`). `diagnosisAllowed` = `/access` mount 1회.
- 목록 A+B 통합·필터·`lower(lead_email)` 그룹 · 상세=답변+리포트+상태 변경+(B) 수동 부여 1클릭(§4-6 CT). 파이프라인 `none→new→attempted(n)→contacted→account_created(B만)→trial_granted→converted/disqualified/on_hold` + `existing_customer` 실격·`linked_company_id` 수동. 뱃지 = `/badge`(404 미렌더).

## 6. 디자인 지침 — 최신·모던 (하한이지 상한 아님)

- 하한 = LESSONS_FRONTEND 「디자인 최소 기준」 전 항목. 시각 차별화 = **sky→indigo + 맥박/청진 아이콘**(violet→fuchsia는 기존 「AI 자율 진단」 점유). 명칭 「AI 마케팅 진단」.
- 모던 디테일: 그라데이션 보더·글래스 히어로·선택 칩 스프링·220ms 슬라이드+페이드·카운트업 1회 600ms·`prefers-reduced-motion` 존중·tailwind 실존 클래스만.

## 7. 문항 정의 v1

> 문형: "필요하십니까/다른 도구로 하고 계십니까"(FREE는 기능 잠김 — "하십니까"는 전원 "안 함").
> **requires 확정 절차** = 커밋 0의 검증 B(plans 실값)·C(실효 게이트 실측) 결과로 §7-1 JSON의 `requires`를 채우거나 비운다. 실효 게이트에서 열려 있는 축은 추천 근거 금지.

| # | key | 문항 | 선택지(key) | requires(선택지별 — 검증 C 통과 시) | 태그 |
|---|---|---|---|---|---|
| 1 | industry | 어떤 분야이신가요? | 8업종 칩(§5-5 코드) | 없음 | 예시 필터·자산 |
| 2 | monthly_send | 한 달 메시지 발송량은? | u1k/k1_10k/k10_100k/o100k | 없음 | 자산·B 인용 |
| 3 | customer_db | 관리할 고객 데이터 규모는? | none/u1k/k1_10k/o10k | u1k+ → `customer_db_enabled is_true`(+`max_customers gte_or_null` — **검증 C에서 제한 폐지 확인 시 제거**) | 추천 |
| 4 | mobile_dm | 모바일 DM이 필요하신가요? | no/interest/m1_2/m3p | **m1_2+만** `mobile_dm_enabled is_true` — interest 미발동(의향으로 고액 추천 금지) | 추천·자산 |
| 5 | ai_usage | AI 제작(문안·이미지) 예상 사용량은? | none/u10/m10_50/o50 | `ai_credits_per_month` **gte** — 환산 = 선택지 상한 횟수 × **`CREDIT_COST_MAP`의 문안 생성 키 단가**(보수·과추천 방지. o50은 상한 100회로 계산 — 상한 없는 구간 금지) | 추천 |
| 6 | auto_campaign | 자동 발송을 몇 개나 돌리고 싶으신가요? | none/q1_5/q6_10/q11p | q1_5+ → `auto_campaign_enabled is_true` + `max_auto_campaigns gte_or_null 5/10/11` | 추천 |
| 7 | cdp | 자사몰 연동이 필요하신가요? + 월 규모 | no/u10k/k10_100k/o100k | u10k+ → `cdp_enabled is_true` + `cdp_events_per_month gte_or_null <하한>` — **단위 주의**: 런타임 계량은 방문자가 아니라 API call_count(`cdp-auth.ts:405-471`) — 문항 문구를 "월 고객 행동 데이터(이벤트)"로, 구간값은 검증 B 실값 |
| 8 | email_mkt | 이메일 마케팅은 어떻게 하고 계신가요? | none/own_tool/agency/want_hanjul | 없음 | 자산 |

퍼널 B 전용 0번: "기존 한줄로 고객사이십니까?" — 예=로그인 안내(행 생성 없음).

### 7-1. definition jsonb 스키마 (완성 형태 — seed와 이 문서가 동일 내용, 프론트는 API 수신)

```jsonc
{
  "version": "v1",
  "rule_version": "r1",
  "questions": [
    { "key": "industry", "text": "어떤 분야이신가요?", "type": "industry_grid",
      "tags": ["example_filter","asset"],
      "options": [
        { "key": "fashion", "label": "의류/패션" }, { "key": "beauty", "label": "뷰티/화장품" },
        { "key": "fnb", "label": "식음료/카페" },   { "key": "ecommerce", "label": "쇼핑몰/이커머스" },
        { "key": "medical", "label": "병원/의료" }, { "key": "education", "label": "학원/교육" },
        { "key": "travel", "label": "여행/레저" },  { "key": "fitness", "label": "피트니스" } ] },
    { "key": "monthly_send", "text": "한 달 메시지 발송량은 어느 정도인가요?", "type": "single", "tags": ["asset"],
      "options": [ { "key": "u1k", "label": "1천 건 이하" }, { "key": "k1_10k", "label": "1천~1만 건" },
                   { "key": "k10_100k", "label": "1만~10만 건" }, { "key": "o100k", "label": "10만 건 이상" } ] },
    { "key": "customer_db", "text": "관리할 고객 데이터 규모는 어느 정도인가요?", "type": "single", "tags": ["recommend"],
      "options": [ { "key": "none", "label": "아직 없어요" },
        { "key": "u1k",    "label": "1천 명 이하",  "requires": [ { "column": "customer_db_enabled", "op": "is_true" } ] },
        { "key": "k1_10k", "label": "1천~1만 명",   "requires": [ { "column": "customer_db_enabled", "op": "is_true" } ] },
        { "key": "o10k",   "label": "1만 명 이상",  "requires": [ { "column": "customer_db_enabled", "op": "is_true" } ] } ] },
    { "key": "mobile_dm", "text": "모바일 DM(랜딩형 메시지)이 필요하신가요?", "type": "single", "tags": ["recommend","asset"],
      "options": [ { "key": "no", "label": "필요 없어요" }, { "key": "interest", "label": "관심 있어요" },
        { "key": "m1_2", "label": "월 1~2회 쓸 것 같아요", "requires": [ { "column": "mobile_dm_enabled", "op": "is_true" } ] },
        { "key": "m3p",  "label": "월 3회 이상",           "requires": [ { "column": "mobile_dm_enabled", "op": "is_true" } ] } ] },
    { "key": "ai_usage", "text": "AI 제작(문안·이미지)은 얼마나 쓰실 것 같나요?", "type": "single", "tags": ["recommend"],
      "options": [ { "key": "none", "label": "안 쓸 것 같아요" },
        { "key": "u10",    "label": "월 10회 이하",  "requires": [ { "column": "ai_credits_per_month", "op": "gte", "value": 0 } ] },
        { "key": "m10_50", "label": "월 10~50회",    "requires": [ { "column": "ai_credits_per_month", "op": "gte", "value": 0 } ] },
        { "key": "o50",    "label": "월 50회 이상",  "requires": [ { "column": "ai_credits_per_month", "op": "gte", "value": 0 } ] } ] },
    { "key": "auto_campaign", "text": "자동 발송(생일·재방문 등)을 몇 개나 돌리고 싶으신가요?", "type": "single", "tags": ["recommend"],
      "options": [ { "key": "none", "label": "필요 없어요" },
        { "key": "q1_5",  "label": "1~5개",     "requires": [ { "column": "auto_campaign_enabled", "op": "is_true" },
                                                              { "column": "max_auto_campaigns", "op": "gte_or_null", "value": 5 } ] },
        { "key": "q6_10", "label": "6~10개",    "requires": [ { "column": "auto_campaign_enabled", "op": "is_true" },
                                                              { "column": "max_auto_campaigns", "op": "gte_or_null", "value": 10 } ] },
        { "key": "q11p",  "label": "10개 초과", "requires": [ { "column": "auto_campaign_enabled", "op": "is_true" },
                                                              { "column": "max_auto_campaigns", "op": "gte_or_null", "value": 11 } ] } ] },
    { "key": "cdp", "text": "자사몰(쇼핑몰) 연동이 필요하신가요? 필요하다면 월 고객 행동 데이터 규모는?", "type": "single", "tags": ["recommend"],
      "options": [ { "key": "no", "label": "필요 없어요" },
        { "key": "u10k",     "label": "월 1만 건 이하",  "requires": [ { "column": "cdp_enabled", "op": "is_true" },
                                                                       { "column": "cdp_events_per_month", "op": "gte_or_null", "value": 10000 } ] },
        { "key": "k10_100k", "label": "월 1만~10만 건",  "requires": [ { "column": "cdp_enabled", "op": "is_true" },
                                                                       { "column": "cdp_events_per_month", "op": "gte_or_null", "value": 100000 } ] },
        { "key": "o100k",    "label": "월 10만 건 이상", "requires": [ { "column": "cdp_enabled", "op": "is_true" },
                                                                       { "column": "cdp_events_per_month", "op": "gte_or_null", "value": 1000000 } ] } ] },
    { "key": "email_mkt", "text": "이메일 마케팅은 어떻게 하고 계신가요?", "type": "single", "tags": ["asset"],
      "options": [ { "key": "none", "label": "안 하고 있어요" }, { "key": "own_tool", "label": "자체 도구로" },
                   { "key": "agency", "label": "외주/대행" }, { "key": "want_hanjul", "label": "한줄로로 하고 싶어요" } ] }
  ]
}
```
⚠ **커밋 0 확정 결과(2026-08-16 — §3-1 · B안 Harold 확정)**: ①Q5 `value` = 50/250/500 ②Q3·Q4 requires 제거(검증 C 실효 게이트 아님) ③**Q6·Q7 requires 제거(B안)**. **seed v1 = 위 JSON에서 Q3·Q4·Q6·Q7의 requires 키를 전부 빼고 Q5 value만 50/250/500으로 넣은 형태가 최종이다**(위 JSON의 해당 requires는 v2 재도입용 참고 표기). plans 실값 정정(§10 ⑧) 후 문항 세트 v2로 재도입 — 버저닝이 그 용도다.
CT 검증: op 3종만 · 컬럼별 허용 op 표 · answers 완전 검증(§4-5).

### 7-2. DiagnosisResultV1 (result jsonb — 서버가 쓰고 프론트·관리 메뉴가 읽는 단일 스키마)

```jsonc
{
  "v": 1,
  "summary": "…",                          // 히어로 1문장 (조립식 — AI 아님)
  "findings": [ { "key": "brand_voice_missing", "text": "…" } ],   // 소견(브랜드보이스 흡수 포함)
  "effects": [ { "kind": "credit_conversion"|"limit"|"usage"|"compare", "label": "…", "value": "…", "source": "…" } ],
  "recommendation": { "plan_code": "…", "plan_name": "…", "monthly_price": 0,
                      "reasons": [ { "question": "…", "option": "…", "column": "…" } ] } | null,  // null = no_match
  "no_match": false,
  "grant_outcome": "granted"|"already_granted"|"not_eligible"|"not_applicable"|null,  // 퍼널 B = null
  "examples": { "industry": "fashion" }
}
```
숫자는 정수/문자열 확정형으로 저장(반올림은 쓰는 시점이 아니라 계산 시점 1회). 무제한(NULL) 한도는 `"unlimited"` 문자열.

## 8. 구현 순서 (커밋 단위)

| # | 커밋 | 내용 | 게이트 |
|---|---|---|---|
| 0 | (선행) | §3 검증 SQL A·B·D 실행(Harold) + **검증 C(실효 게이트) 코드 실독** → §7-1 값 3곳 확정 | 실값 회신 |
| 1 | fix(worker) | §4-2 워커(술어·유료 가드·주석) + 픽스처 4종 | 기존 테이블만으로 빨간불 실측 |
| 2 | feat(api) | §4-1 submit 트랜잭션 + grantFreeTrial client(전 SQL — 회귀 2곳) + §4-3 API + 503 가드 | tsc 0 + DB 미접촉 단위테스트 + **로컬 DB에 §3 DDL 선적용해 원자성·UNIQUE 실측**(운영 DDL은 배포 후) |
| 3 | feat(api) | §4-5 추천 CT + §7-1 파서·검증 + §4-4 공개 4라우트 | 룰 행렬 8케이스 |
| 4 | feat(api) | §4-6 게이트(래퍼·access·badge·감사 키 제한) + **§4-7 머지 축 등록·테스트** | 게이트 404 실측 + 머지 축 테스트 |
| 5 | feat(front) | §5-1 제거·청소 + §5-2 노출·모달·카드 | 빌드+육안 |
| 6 | feat(front) | §5-3 위저드(questions API 수신·셸 opt-out 2축) + §5-4 리포트 + §5-5 목업 블록(+assets 배치) | 빌드 |
| 7 | feat(front) | §5-6 퍼널 B 페이지 + 로그인 버튼 2곳 | 빌드+공개 라우트 |
| 8 | feat(front) | §5-7 관리자 메뉴 | 빌드 |
| — | DDL | §3 실행(배포 후·한 트랜잭션) + seed v1 | — |

Codex `adversarial-review` 의무 = 커밋 1·2(돈·DB). 배포 = tp-push + build:safe.

**진행 원장(2026-08-16 세션)**
- 커밋 0 실측 완료(§3-1) · **B안 Harold 확정**.
- **커밋 1 완결**: 워커 술어 공유 상수·유료 가드 이중·plan_id 원자 결합 + 행동 테스트 9 + **실 SQL 의미론 테스트 11(pg-mem devDep — mock이 못 잡는 OR→AND류 의미 반전을 실행으로 잡는다·변이 민감도 스위트 내장)**. Codex 적대 1R(high 1·medium 2)·2R(high 1) **전부 수용·반영** — 라운드 상한 2회 도달·잔여 미해소 0.
- **커밋 2~4 백엔드 코드 완성**: `grantFreeTrial` client 주입(회귀 6) · `monthly-usage` CT 추출(customers.ts /stats 전환 — 산식 단일 소스) · `plan-recommend`(룰 행렬 14) · `marketing-diagnosis-report`(5) · `marketing-diagnosis-grant`(판정·실행 CT — submit·수동부여 공유) · 라우트 3종(인증 5 API·공개 4 API+32kb 파서·관리 6 API) · `audit-log` 래퍼 · **§4-7 머지 축 3+간접 1+linked 승계(계약 테스트 3)**. 진단 트랙 테스트 46/46·tsc 0.
- §4-1 ⓓ의 "not_applicable = 저장 후 COMMIT"은 §9-3(유료 submit 400)과 모순이라 **400 ROLLBACK으로 확정 구현**(유료사 진단 행 자체를 만들지 않는다 — 비노출 정책 정합).
- **커밋 2~4 Codex 적대 1R(high 4·medium 4)**: high 4 **전부 수용·반영** — ①수동 부여 출발 상태 account_created 제한+조건부 전이 ②기지급 판정을 plan 검사 앞으로(지급 직후 재시도 already_granted 보장)+B 수동 지급 선행 시 A 진단 저장 경로 ③병합 퍼널 B 지급 결합 차단(`DIAGNOSIS_GRANT_SPLIT_SQL` — linked 축 포함·pg-mem 실측) ④활성 definition 검증을 로더로 집중(위반 = typed 503 fail-closed). medium 3건 수용 — preview 허용목록 DTO(요금제 지문 차단)·linked 승계 잔존을 verified 계산에 포함·수동 부여 감사 기록을 client 반환 뒤로(풀 자기 고갈 차단). **medium 1건 불수용** = rule_version별 op 스키마 분리 — seed 버저닝의 목적이 코드 무변경 재도입이라 코드에 축을 고정하면 목적이 죽는다. 위험 축(NULL=0 오추천)은 컬럼별 op 표가 이미 차단 — §10 잔여 위험 ⑤ 등재.
- **커밋 2~4 Codex 적대 2R(high 1·medium 1) — 전부 수용·반영, 라운드 상한 소진**: high(병합 중 동시 지급이 결합 차단을 우회) = 이동 직후 in-tx 재검사(잔존=롤백) + postCommit 재검사(verified=false로 표면화) — 동시성 순서 재현 테스트는 단일 프로세스로 불가라 §9 시나리오 13(배포 후 실측)으로 등재. medium(감사 내구성) = `granted_by`를 지급 트랜잭션 안에 행위자 스냅샷으로 영속화(DDL varchar 30→64 · 수동 = admin:{super_admins.id}) + 사후 감사 로그는 client 반환 뒤 best-effort 유지.
- **프론트 커밋 5~8 코드 완성(같은 세션)**: §5-1 청소 전량(옛 무료체험 팝업·배너·AI 다듬기 안내 — 파일 2 삭제·잔존 grep 0) · §5-2 노출(서버 state 독립 useEffect·초대 모달·히어로 카드 2형·BrandVoiceNudgeCard suppress) · §5-1 C AI Operator 분기 2곳 · §5-3 위저드(문항 서버 수신·220ms 전환·답 칩 복귀·JourneyModalShell `disableDismiss` 신설 — 기존 소비처 4곳 무변경) · §5-4 리포트(outcome별 히어로·Source caption·목업 iframe 캡션) · §5-6 퍼널 B 페이지+`/diagnosis` 공개 라우트(정적 import)+로그인 버튼 2곳 · §5-7 관리 메뉴(신규마케팅진단 — access 게이팅·뱃지·목록·상세·전이·수동 부여) · Pretendard+OFL 배치. **검증 = backend 테스트 90/90·양쪽 tsc 0·frontend 빌드 통과(산출물에 목업 24·PNG 40·폰트 실림 확인)·금칙어 4축 grep 0.**
- **배포 게이트 ①~④ 완료(2026-08-16 저녁 — 개통)**: ①코드 배포(0816(3)) ②DDL §3(4테이블 실측 확인) ③**이미지 40종 실렌더 교체 완료** — 스튜디오 UI가 아니라 같은 엔진(Gemini) 직접 호출 일회성 스크립트로 일괄 생성(로컬 실행 — 서버 트리 오염 회피·키는 Harold 터미널만 경유), 시각 검수 표본 5종 합격, 웹 최적화 57MB→4.8MB(1200px·JPEG 재인코딩 — **.png 파일명에 JPEG 바이트: 브라우저 내용 판독 전제, 의도된 것**) — 스크립트·프롬프트 지시서는 규정대로 삭제(git 이력에 잔존) ④seed v1 INSERT(`v1 | t | 8` 실측). ⚠빌드 중 1회 Segmentation fault — atomic 안전망이 dist 보존, 재확인 결과 dist=소스 40장 동일로 판정(md5 대조). **잔여 = ⑤§9 실측 13종(운영 검증 — Harold)**.
- **★보상 문구 정책 개정(2026-08-16 — Harold 지시)**: §5-2 초대 형식의 "무료 단어 0" 계약 폐기 — 완료 유도를 위해 **7일 무료체험 보상을 시작 시점에 노출**한다. 단 퍼널 A는 `state.grantable==='available'`일 때만(체험 이력 회사에 보이면 거짓 약속 — 조건부 렌더 4곳: 초대 모달·히어로·문진 상단·(D-N 카드는 비대상)). **퍼널 B는 "진단을 완료하고 가입하시면 7일 무료체험을 드려요"로 공개 약속** — 자동 지급이 없으므로 리드가 계정을 만들면 관리 메뉴 수동 부여(account_created → 지급 버튼)로 이행하는 **운영 의무**가 생겼다(파이프라인이 그 동선을 소유).
- **★문항 세트 v2(2026-08-16 개통 직후 — Harold 지시·코드 무변경)**: ①Q3 고객 규모 축을 추천 근거로 재도입 — `max_customers gte_or_null`(실값 사다리 무결: STARTER 10만/BASIC 30만/PRO 100만/BUSINESS 300만·NULL 없음 — Q6·Q7을 뺀 역전 문제가 이 축엔 없다). 구간 = 없음/10만 이하/10만~30만/30만~100만/100만 이상(각 10만·30만·100만·300만 요구) ②Q2 발송량 구간 상향(1만 이하/1만~10만/10만~50만/50만 이상 — 자산 축) ③나머지 문항·Q5 크레딧 축 동일(rule_version r2). **효과 = 규모 큰 곳(A·B 공통)에 PRO·BUSINESS가 정직하게 나간다**(v1은 소규모 전제의 과소 추천). 원칙 4 개정 동반(정가표 용량 기준 축 허용). v1 제출분은 행이 `question_set_version='v1'` 스냅샷을 소유해 무영향.

## 9. 검증 (배포 후 실측 — 불변 원칙 10 전부)

| # | 시나리오 | 원칙 |
|---|---|---|
| 1 | FREE(이력 0) → 모달 1회 → 완료 → 히어로 "체험 시작 D-7" → `trial_expires_at`+7 · grants 1행 · `trial_start` 1행 | 3 |
| 2 | 재열람 = `/report` 200 · 재제출 409 · 지급 1회 유지 | 3 |
| 3-a/3-b | 유료 / STAFF 각 1건 → 미노출 + submit 400 | 1 |
| 4 | 체험 만료 FREE → 완주·`not_eligible`·진단은 저장·CTA 상담(`lead_status='new'`) | 3 |
| 5 | 퍼널 B preview(추천 가림) → submit → 리드 1행(`lead_status='new'`·동의 4필드) → 직원 admin 404 / ceo 200 | — |
| 6 | 워커 픽스처 ②강등·**④유료+trial 미강등** | — |
| 7 | 제출 처리에서 `ai_credits_purchased` 불변 + AI 호출 로그 0 (base는 TRIAL 지급 규칙대로 변경 — 정상) | 2 |
| 8 | 추천 응답에 FREE·TRIAL·STAFF 0건 + result가 §7-2 스키마 | 4·5·6 |
| 9 | `GET /api/companies`(직원) 응답에 진단 필드 0 | 7 |
| 10 | 퍼널 B 원화 0 + 목업 캡션 + 모델명 grep 0 | 8·9 |
| 11 | DDL 전 배포에서 state → 503 / seed 없이 테이블만 → 503 | 10 |
| 12 | 진단 행 있는 회사 병합 성공(축 등록) + 요금제 삭제 시 진단 조회 정상(SET NULL) | — |
| 13 | **병합×수동 지급 동시성(Codex 2R)** — 옛 회사 연결 리드에 지급을 걸어둔 채 병합 실행 → 결합 재검사가 롤백(residue)하거나 postCommit `verified=false`로 드러나는지. 단일 프로세스 테스트로 재현 불가라 실측만 가능 | — |

## 10. 등재 (범위 밖 — STATUS/BUGS로)

- **별건 결함 4**: ①로그인 「이용신청 문의」 401(인증 미들웨어 뒤 + DB 무기록) ②`admin.ts:714` COALESCE의 상태 덮어쓰기(+유료 plan에 status='trial' 잔존 조합 — 검증 D로 실태 확인) ③기존 `/api/plans` 비인증 SELECT * ④`JourneyModalShell` 백드롭·Esc 무조건 닫힘
- **별건 개선 4**: ⑤`credit.ts` 숫자 사본 ⑥`/pricing` 라이트 톤 단절 ⑦`basic-trial.ts:32-38` vs `companies.ts:1700` TRIAL 동급 설명 불일치(BASIC vs PRO — 주석 정정) ⑧**plans 한도 사다리 역전(2026-08-16 실측)** — STARTER·BASIC `max_auto_campaigns` NULL(런타임 무제한)이 PRO 5·BUSINESS 10보다 넓고, STARTER `cdp_events_per_month` NULL(무제한)이 BASIC 1만보다 넓다. 값 부여 = 운영 중 고객사 실행 한도를 새로 만드는 요금 정책 판단(Harold) — 정정 후 문항 세트 v2로 Q6·Q7 requires 재도입
- **잔여 위험 5**: 공개 리밋 pm2 배수 / 0원 요금제 신설 시 추천 재유입(컬럼별 op 표가 1차 방어) / soft delete 재가입(외부 실행 불가·재활성 회사는 수동 부여 구제) / state 실패 fail-quiet 노출 손실 / **⑤ seed에 한도 축(gte_or_null) requires를 사람이 넣으면 validator가 rule_version 무관 통과**(Codex 커밋 2~4 1R medium — 불수용 근거는 §8 진행 원장. seed 갱신은 §7-1 확정 JSON대로만, plans 정정(⑧) 전 한도 축 재도입 금지)

## 11. 완료 후

`docs/FEATURE-MARKETING-DIAGNOSIS.md` 승격 → `status/SOT-INDEX.md` §0 등재 → STATUS 카드 회전.
