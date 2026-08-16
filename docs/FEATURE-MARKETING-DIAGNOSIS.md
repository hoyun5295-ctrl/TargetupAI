# AI 마케팅 진단 — 기능 상설 SoT

> **호출어 = "마케팅 진단"**. 이 문서가 이 기능의 **정체성·불변 원칙·구조·운영·이력**을 소유한다.
> 상태·잔여는 STATUS §2가, 시점 설계 근거(DDL 원문·seed 원문·적대 리뷰 취사 내역·검증 시나리오 13종)는
> [2026-08-16 설계서](2026-08-16-marketing-diagnosis-design.md)가 소유한다 — 여기 복사하지 않는다.
>
> 2026-08-16 하루에 설계(브레인스토밍 5역할·적대 3중) → 구현(백엔드·프론트) → 개통까지 끝났다.

---

## §1 착수 전 필독 순서

1. **§2 정체성** — 이 기능이 무엇을 뒤집으려고 만들어졌는지 모르면 문구·흐름을 반드시 망친다.
2. **§3 불변 원칙** — 특히 3-1(화면은 게이트가 아니다)·3-3(1회 한정은 DB가 강제).
3. 문항·추천을 만지면 **§5 버저닝 운영**(코드 수정이 아니라 seed로 바꾼다).
4. 화면·문구를 만지면 **§6 운영 계약**(보상 문구 조건부 노출 = 거짓 약속 차단).
5. DDL·seed 원문이 필요하면 설계서 §3, 검증 시나리오는 설계서 §9.

---

## §2 정체성 — 리포트가 본체, 설문은 문진

기존 AI 안내(AI Operation 모달·AI 꾸미기·무료체험 팝업)는 전부 **우리 얘기**였고 전환이 0이었다.
진단은 순서를 뒤집는다: **고객이 먼저 자기 얘기를 하고(답변), 우리가 그 회사 얘기로 돌려준다(리포트).**

- 설문은 문진일 뿐이고 **본체는 리포트다** — 왜 이 요금제인지, 크레딧으로 뭘 할 수 있는지, 그 분야 실물 예시까지 전부 답변·실적에서 파생된다.
- 퍼널 두 개가 같은 문진을 공유한다: **A = 기존 FREE 고객사**(완주 = TRIAL 7일 자동 지급) / **B = 미인증 잠재고객**(완주 = 리드 수집).
- 유료 요금제 사용자에게는 **기능 자체가 존재하지 않는다**(노출·제출·지급 3중 차단).

---

## §3 불변 원칙 (어길 수 없는 것)

### 3-1. 화면은 게이트가 아니다
노출·제출·지급 **전부 서버가 `plan_code='FREE'` 정확 일치를 재검사**한다. 프론트는 요금제를 해석하지 않고 `GET /state` 응답의 `eligible`·`grantable`만 소비한다. 화면을 숨기는 것은 UX이고, 막는 것은 서버다.

### 3-2. 진단 계산은 AI 호출 0 · 크레딧 차감 0
문항·추천·리포트 전부 순수 룰(`plan-recommend` + `marketing-diagnosis-report`)이다. `ai_credits_purchased` 불변.
⚠ TRIAL **지급**이 `ai_credits_base_*`를 TRIAL 월값으로 리셋하는 것은 기존 지급 계약의 정상 동작이다 — "차감 0"과 혼동 금지.

### 3-3. 1회 한정의 실효 장치는 DB 제약뿐이다
`diagnosis_trial_grants UNIQUE(company_id)` + funnel A 부분 UNIQUE(회사당 진단 1행). 조건문·화면은 보조다.
**예외 재지급 경로를 만들지 않는다** — 구제는 기존 슈퍼관리자 수동 부여(`grant-basic-trial`)가 담당한다.

### 3-4. 제출과 지급은 한 트랜잭션이다
`POST /submit`이 client 하나로 전 과정을 소유한다(회사 행 `FOR UPDATE` → 자격 판정 → 진단 INSERT → 지급 → grants INSERT).
쪼개면 ①먼저 커밋 시 완료 기록이 재시도를 영구 차단하거나 ②안 커밋 시 grants FK가 진단을 못 본다.
실패 = 전체 ROLLBACK = 진단도 미저장 = **재시도가 곧 복구 경로**.

### 3-5. 추천 근거로 쓸 수 있는 축은 두 부류뿐
① **실효 게이트 실측을 통과한 축** — 이미 열려 있는 기능을 잠긴 것처럼 팔면 거짓 리포트다.
② **정가표 용량 기준 축**(`max_customers` — ★2026-08-16 Harold 확정) — 적재를 막지는 않지만 요금제의 공표 규모 기준이라 "귀사 규모에 맞는 플랜" 안내는 사실이다. 리포트 문구는 **제한·상한 단어 없이 규모 권장 프레임**으로만 쓴다.
⛔ 2026-06-02 종량제 전환 이후 **boolean 기능 플래그는 런타임 게이트가 아니다**(FREE만 차단) — requires에 넣으면 오추천이 된다.

### 3-6. 만족하는 요금제가 없으면 추천하지 않는다
`no_match` = 추천 카드 대신 「상담으로 확인해 드립니다」. 억지 추천 금지.

### 3-7. 진단 데이터를 `companies` 컬럼에 붙이지 않는다
`SELECT c.*` 응답들이 전부 오염된다. 진단은 자기 테이블 4개로 산다.

### 3-8. 테이블·문항이 없으면 500이 아니라 503이다
신규 테이블 미생성(42P01/42703)·활성 문항 세트 0개·definition 구조 위반 = `503 DB_MIGRATION_PENDING`(fail-closed), 화면은 "준비 중" 안내. 검증은 **로더 한 곳**(`loadActiveQuestionSet`)이 소유한다.

---

## §4 구조 — 무엇이 어디에 있나

### 4-1. 백엔드

| 축 | 파일 | 소유 |
|---|---|---|
| 인증(퍼널 A) | `routes/marketing-diagnosis.ts` | `/state` `/report` `/invited` `/submit` `/consult` |
| 공개(퍼널 B) | `routes/marketing-diagnosis-public.ts` | `/questions` `/preview` `/submit` `/credit-costs` · IP 10분 5회 리밋 · 허니팟 · 32kb 파서(app.ts 전역 파서 앞) |
| 관리(ceo) | `routes/marketing-diagnosis-admin.ts` | `/access` `/badge` 목록·상세·상태 전이·수동 부여 |
| 추천 룰 CT | `utils/plan-recommend.ts` | 컬럼별 허용 op 표 · **v3 분기 스키마 검증(show_when·axis·level·section)** · answers 가시성 검증(비가시 답 거부·선치환 optionalKeys) · `no_match`+`no_match_kind` · 동률 2차 정렬 |
| 결과 조립 CT | `utils/marketing-diagnosis-report.ts` | V1·V2 조립(definition 축 게이트 유무로 분기 · AI 0) — V2 = 단계 관문·병목 인과 3단·30일 실행·각주 상한 |
| 문구 원장 CT | `utils/marketing-diagnosis-copy.ts` | **v3 리포트 전 문장 소유**(관찰 틀·단계·칭찬·병목·처방·각주·표지 절) — 문장 수정 = 이 파일만 |
| 지급 CT | `utils/marketing-diagnosis-grant.ts` | 자격 판정·지급 실행 — **submit과 수동 부여가 공유**(원자성 한 벌) |
| 데이터 접근 | `utils/marketing-diagnosis-store.ts` | 활성 세트 로더(+검증) · plans 조회 SQL |
| 사용 실적 | `utils/monthly-usage.ts` | 월 발송·사용금액 — **대시보드 `/stats`와 산식 단일 소스**(route-local 복사 금지) |
| 체험 지급 | `utils/basic-trial.ts` | `grantFreeTrial(companyId, days, { client })` — client 주입 시 **내부 전 SQL이 그 client**(풀 고갈 차단) |
| 만료 강등 | `utils/trial-downgrade-worker.ts` | 술어 상수 공유 + 유료 플랜 강등 금지 가드 + 관찰 plan_id 원자 결합 |
| 권한 | `utils/audit-log.ts` `isDiagnosisViewer` | ENV `MARKETING_DIAGNOSIS_VIEWER_IDS`(기본 `ceo`) · 인자 = `super_admins.id` |
| 병합 연동 | `utils/company-merge.ts` | 진단 3테이블 축 + 지급 결합 차단 SQL + `linked_company_id` 승계·잔존 검증 |

### 4-2. 프론트

`components/marketing-diagnosis/` — `DiagnosisWizard`(문진 1소스 · **v3 분기형**: 커서=문항 key·prune 고정점·섹션 도트+래칫·경계 화면·2단 보기·드래프트) · `DiagnosisModal`(A 셸 · 인증 questions·닫기 확인) · `DiagnosisInviteModal` · `DiagnosisHeroCard` · `DiagnosisReportView`(**라우터** — 스냅샷 v로 분기) · `ReportV1View`(v1 동결) · `ReportV2View`(스토리형) · `diagnosisApi.ts`
`pages/DiagnosisPage.tsx`(공개 `/diagnosis`) · `components/admin/DiagnosisAdminPanel.tsx`(신규마케팅진단 — v3 무수정: V2 result가 V1 상위집합)

### 4-3. DB

`diagnosis_question_sets`(문항 세트·활성 1개) · `marketing_diagnoses`(A+B 원장·result 스냅샷) · `diagnosis_trial_grants`(1회 한정 원장) · `diagnosis_invites`(초대 표시 기록). DDL 원문 = 설계서 §3.

---

## §5 문항·추천 버저닝 운영 — 코드가 아니라 seed로 바꾼다

문항 문장·선택지·추천 요구조건은 전부 `diagnosis_question_sets.definition`(jsonb)이 소유한다.
**바꾸려면 새 version을 INSERT하고 활성을 옮긴다** — 코드 배포 없이 즉시 반영되고, 기존 제출 행은 `question_set_version` 스냅샷을 물고 있어 영향이 없다(관리 화면의 답변 라벨도 그 행의 버전 문구로 표시된다).

- 활성 세트는 **정확히 1개**(부분 UNIQUE). 0개면 전 endpoint가 503.
- `requires`는 **컬럼별 허용 op 표**(CT 소유)를 통과해야 한다: `ai_credits_per_month`는 `gte`만(NULL=0 컬럼 — `gte_or_null`을 허용하면 값 안 채운 요금제가 최저가로 추천되는 사고), 한도 축은 `gte_or_null`만(NULL=무제한).
- 추천 후보 = `is_active AND monthly_price > 0`(FREE·TRIAL·STAFF 자동 제외) → 조건 만족 행 중 `monthly_price ASC, plan_code ASC`.

**현재 활성 = v2**(2026-08-16). v1 대비: 고객 규모 축을 추천 근거로 재도입(`max_customers` — 10만/30만/100만/300만), 발송량 구간 상향(1만/10만/50만), AI 크레딧 축 유지. v1은 소규모 전제라 STARTER·BASIC으로만 수렴했고, 실제 시장(관리 10만+·월 발송 10만+ 업체가 흔함)에서 과소 추천이었다.

⚠ **plans 한도 실값 역전이 남아 있다** — `max_auto_campaigns`·`cdp_events_per_month`가 STARTER·BASIC에서 NULL(=런타임 무제한)이라 PRO(5·10만)보다 넓다. 그래서 이 두 축은 requires에서 뺐다. plans 값이 정정되면 v3로 재도입한다(코드 무변경).

---

## §6 운영 계약

### 6-1. 노출 규칙 (퍼널 A)
`GET /state` 한 응답이 화면 판정을 전부 소유한다. 초대 모달 = `eligible && !completedAt && !invitedAt`(표시 즉시 서버 기록 — localStorage 판정 금지), 히어로 = 진단 유도(`eligible && !completedAt`) 또는 체험 D-N(`completedAt && trialExpiresAt > now`), 진단 카드 노출 중에는 BrandVoiceNudgeCard를 `suppress`(소견이 리포트로 흡수된다).

### 6-2. 7일 보상 문구는 조건부다
"진단을 끝내면 7일 무료체험이 바로 시작돼요"는 **`grantable === 'available'`일 때만** 노출한다(초대·히어로·문진 상단 3곳). 체험 이력이 있는 회사에 보이면 **거짓 약속**이 된다 — 그 회사는 완주해도 리포트만 저장되고 지급은 없다(상담 CTA로 이어진다).

### 6-3. 퍼널 B는 자동 지급이 없다 — 그래서 운영 의무가 생긴다
공개 페이지는 "완료하고 가입하시면 7일 무료체험을 드려요"라고 약속한다. 그 이행은 **관리 메뉴 파이프라인**이 담당한다:
`new → attempted(n) → contacted → account_created(B만) → [수동 부여] → trial_granted → converted / disqualified / on_hold`
수동 부여는 **`account_created` 상태 + 회사 연결 완료**일 때만 열린다(잠긴 진단 행에서 대상을 파생 — 임의 회사 ID 입력 금지). 지급 행위자는 `granted_by`에 스냅샷으로 남는다.

### 6-4. 관리 메뉴는 ceo 전용이고, 비허용 계정에는 존재하지 않는다
`/access`만 게이트 앞에 두고 나머지는 전부 404(존재 은닉). 감사 로그 details는 `{diagnosis_id, company_id, outcome}` 허용 키만.

---

## §7 예시 목업 자산

`packages/frontend/public/diagnosis-examples/` — 업종 8종 × 채널 3종 = **HTML 24개** + `assets/` **이미지 40장** + Pretendard(+OFL 고지).
리포트는 답변한 업종의 3장을 `<iframe sandbox="" loading="lazy">`로 띄운다(JS 0·클릭 확대만). **캡션 「예시 목업 · 가상 브랜드 · 실제 고객 사례 아님」은 의무**다.

- 이미지는 이미지 스튜디오 **UI가 아니라 같은 엔진(Gemini generateContent)을 직접 호출하는 일회성 스크립트**로 일괄 생성했다(로컬 실행 — 서버 작업 트리 오염 회피). 슬롯·비율 원장 = `assets/README.md`.
- 생성 규칙: **이미지 안에 글자·로고 0**(카피는 HTML이 얹는다), `dm-hero` 9:16과 `travel/fitness-email-hero`는 **하단 40%가 어둡고 단순**해야 한다(흰 카피 오버레이 자리).
- 웹 서빙용으로 1200px·JPEG 재인코딩했다(57MB→4.8MB). **파일명은 `.png`인데 내용은 JPEG** — 브라우저는 내용으로 판독하므로 의도된 상태다.
- 다시 만들 때는 같은 방식(슬롯명 그대로 저장 → 최적화 → 배치). 자리표시(10~25KB 회색 PNG) 상태로 노출 금지.

---

## §8 이력 색인

| 시점 | 내용 |
|---|---|
| 2026-08-16 설계 | 브레인스토밍 5역할 수렴 → 적대 검토 3중(자가 4 · 회의론자 D1~D17 · Codex critical 2/high 15/medium 1) 반영해 설계서 v3 확정. 목업 24종 선배치 |
| 2026-08-16 커밋 0 | plans 실값·실효 게이트 실측 → **B안 확정**(추천 축을 AI 크레딧 단일로) · 설계서 §3-1 |
| 2026-08-16 커밋 1~4 | 강등 워커 술어 통일·유료 가드 / 지급 트랜잭션(client 주입) / 추천·리포트·지급 CT / 라우트 3종 / 병합 축. **Codex 적대 4라운드**(커밋1 2R·커밋2~4 2R — high 6·medium 5 수용, medium 1 불수용) |
| 2026-08-16 커밋 5~8 | 옛 무료체험 팝업·배너·AI 다듬기 안내 제거 · 노출·위저드·리포트·퍼널 B 페이지·관리 메뉴 · `JourneyModalShell` dismiss opt-out 신설 |
| 2026-08-16 개통 | DDL 4테이블 → 이미지 40종 실렌더 교체 → seed v1 → **v2 전환**(규모 축 재도입) → 7일 보상 문구·줄바꿈·대시 제거·관리 답변 라벨 표기 |
| 2026-08-16 개통 후 정정 | ①관리 상태 전이 `42P08`(파라미터 캐스팅 불일치)로 **전건 실패 → 정정·실측 통과**(new→attempted 확인) ②관리자 토스트가 정산 탭 안에서만 그려져 **다른 탭에서 성공·실패가 안 보이던 것** → 탭 밖으로 이동 ③문구 B2B 정정("우리 매장"→"우리 브랜드") ④상태 전이 4xx 거절 사유를 서버 로그에 남기도록 보강 |
| **2026-08-16 v3 전면 개편(코드 완료)** | Harold 지적("한줄로 이용 진단이지 마케팅 진단이 아니다") → **브레인스토밍 5역할 + 교차 반박 + 회의론자 최종 검증 24건**으로 수렴 → 분기형 문진(6축 게이트+심화 · 풀 27문항·체감 13~20 · 의향 문항 4종 폐기) · 스토리형 리포트 V2(표지 2행·들은 것·칭찬·판정 표·병목 인과 3단·30일 실행·견적 강등) · 홍보 위치 계약(각주 ≤2+견적 1·삭제 테스트) · A 실측 선치환 · 계약 테스트 21종. **시점 근거·seed 원문·검증 시나리오 = [v3 설계서](2026-08-16-marketing-diagnosis-v3-design.md)** |

상세 근거·취사 내역은 설계서 §8 진행 원장이 소유한다.

---

## §9 뒤집힌 판단 · 함정 (다시 꺼내지 않기)

- ⛔ **문서가 인용한 플래그가 런타임 게이트가 아닐 수 있다** — 실측 결과 `auto_campaign_enabled`는 ENTERPRISE·STAFF만 true였다. 그걸 requires로 썼다면 "자동발송 1~5개" 답변에 550만원 플랜이 추천됐다.
- ⛔ **정가표 스펙과 런타임 제한은 다른 축이다** — `max_customers`는 적재를 막지 않는다(2026-08-14 아난티 사고로 전 경로 폐지). 추천에 쓰는 것은 "권장 규모" 안내이지 제한 부활이 아니다. 되살리지 마라.
- ⛔ **지급 판정 순서: 기지급 검사가 plan 검사보다 먼저다** — 지급에 성공하면 회사가 TRIAL로 바뀌므로, plan을 먼저 보면 "지급 직후 재시도"가 `already_granted`가 아니라 400으로 떨어진다(Codex 적대 지적).
- ⛔ **mock 테스트는 SQL 의미 반전을 못 잡는다** — 강등 술어는 `pg-mem`(실 SQL 엔진)으로 집합 논리를 실행 검증하고, 변이(OR→AND·NOT IN→IN)가 결과를 실제로 바꾸는지까지 스위트 안에서 단정한다.
- ⛔ **preview는 전체를 만든 뒤 일부만 덮으면 샌다** — 크레딧 환산 수치 × 공개 `/credit-costs` 제수로 숨긴 요금제를 역산할 수 있었다. **허용 필드만 조립한 DTO**로 내보낸다.
- ⛔ **문장 속 대시(—)를 쓰지 마라**(사용자 노출 문구) — AI가 쓴 티가 난다는 Harold 지적. 두 줄 구성이나 제목+보조설명으로 푼다. 한국어 화면은 `break-keep`(어절 단위 줄바꿈)이 기본.
- ⛔ **4xx로 돌려보내면서 서버에 흔적을 안 남기지 마라** — 거절 사유가 로그에 없으면 "눌러도 안 바뀐다"의 원인을 화면 문구로만 추측하게 된다(실제로 그 구간에서 헤맸다). 상태 전이는 성공·거절 양쪽을 다 찍는다.
- ⛔ **알림(토스트)은 탭 조건 밖에 그려라** — 다른 탭에서 재사용하면 메시지가 통째로 사라져 "아무 반응 없음"으로 보인다.
- ⛔ **한 SQL 문장에서 같은 `$n`을 두 문맥(대입·비교)으로 쓰지 마라** — 상태 전이 UPDATE가 `42P08`로 전건 실패했다(tsc·테스트 전부 통과한 채 운영에서만 드러남). 캐스팅을 `$2::text`로 통일해 닫았다. 경위·처방 = LESSONS_BACKEND 핵심 원칙 첫 항목.
- ⛔ **관리 화면에 raw key를 노출하지 마라** — `u10k`·`q1_5` 같은 내부 키가 아니라 그 제출 버전의 문진 문장·선택지 라벨로 보여준다.
- ⛔ **(v3) 상표 스테레오타입을 관찰로 쓰지 마라** — "캔바니까 재작업이 잦을 것"은 우리가 얹은 가정이다. 스테레오타입은 **선택지로 내려서 응답자가 직접 말하게** 한다("채널마다 다시 맞추는 일이 있나요"). 틀린 단정 한 줄이 리포트 전체 신뢰를 죽인다.
- ⛔ **(v3) 정렬된 병목 리스트의 부분 공개는 어느 쪽으로 잘라도 진다** — 1번을 주면 잠긴 건 덜 중요한 것이라 유인이 없고, 1번을 잠그면 인질이다. 가림 장치(흐림·자물쇠)는 앞 블록까지 미끼로 소급 오염시킨다. 분할선은 "무엇이 문제인가(공개) vs 어떻게 고치는가(폼 뒤)".
- ⛔ **(v3) 문항 수를 카피에 적지 마라** — 분기형은 경로마다 문항 수가 달라 "8문항"류 숫자는 거짓이 된다. 소요 안내는 seed(meta.est_label)가 소유하고 시간·마디만 말한다(계약 테스트 고정).
- ⛔ **(v3) 총점은 개념이 틀렸다** — 합산은 보상적이라 제작 3점이 명단 0점을 가린다(명단 없는 회사가 "나누는 중"이 되는 거짓). 분기 점수 가산·캡은 경로 의존 왜곡. 단계는 선행 축 관문 하나로만.
- ⛔ **(v3) 접힘 홍보는 숨긴 티 나는 광고다** — 접어도 토글 라벨이 노출 횟수를 만들고, 재열람마다 다시 접힌다. 자사 연결은 각주(작은 활자·브랜드색 0·개수 테스트 고정)로만.

---

## §12 v3 — 진단다움 강화 (★2026-08-16 구현 완료 · 배포·seed 실행 대기)

Harold 지시("진단다운 진단 + 스며드는 홍보")로 같은 날 브레인스토밍 회의를 거쳐 **전면 개편 구현 완료**.
방향·뼈대·회의 취사 내역·seed v3 원문·검증 시나리오는 전부 **[v3 설계서](2026-08-16-marketing-diagnosis-v3-design.md)가 소유**한다.

**v3에서 확정된 원칙(불변 — §3에 준한다)**
- 문진 = 분기형(축 게이트 6 + 같은 섹션 심화 0~2 · 심화는 등급 불개입). 의향 문항은 견적 축(AI 사용량) 하나만.
- 판정 = 관문 사다리(선행 축이 단계 결정). **총점·백분율·점수 캡·가산 전부 금지.**
- 리포트 = 관찰→칭찬→병목(인과 3단)→처방→견적 순. 견적은 구분선 뒤 "이 처방을 실행하려면".
- 홍보 = 위치 계약: 표지~병목 자사명 0 · 30일 실행 각주 ≤2 · 견적 1. **삭제 테스트**(자사 문장 전부 지워도 문서 성립)가 판정 기준.
- 원장 선행: 자기 문장을 못 만드는 문항은 seed에 넣지 않는다(쌍둥이 테스트 — 계약 테스트로 고정).
- B 미리보기 = 진단 전부 공개(병목 포함)·실행 순서와 예시만 폼 뒤. **흐림·자물쇠·부분 공개 금지**(부재가 정직).

**v4(2026-08-16 밤 · Harold 지적 "ERP·CRM·다른 마케팅 툴에 반응이 없다")** — 기존 도구 스택 축 신설:
locked 보기에 ERP 포함 + locked_tool·unified_tool·send_tool 3문항(풀 30·체감 13~22) + 리포트 반응
(도구 관찰·짚임 3종: 데이터와 발송이 분리된 구조 / 발송 도구 파편화 / 엑셀 단일 저장소 · ERP 처방 변형).
seed 원문 = `scripts/sql/2026-08-16-diagnosis-seed-v4.sql`(계약 테스트가 파일을 직접 파싱 — .gitignore `*.sql`은 `!scripts/sql/*.sql` 예외).

**남은 것**
1. 배포(tp-push + build:safe) → **seed v4 실행**(`scripts/sql/2026-08-16-diagnosis-seed-v4.sql` — 멱등. 실행 전까지 운영은 직전 활성 seed로 정상 동작).
2. 실측 = v3 설계서 §8 시나리오 12종.
3. 이연 과제 = 문항 단위 이탈 계측(DDL 필요 — v3 설계서 §9) · plans 실값 정정 시 축 재도입(seed v4).

## §10 관련 문서

- 시점 설계서(DDL·seed v1·v2 원문·검증 13종·적대 취사) = [2026-08-16-marketing-diagnosis-design.md](2026-08-16-marketing-diagnosis-design.md)
- **v3 설계서(브레인스토밍 수렴·분기 스키마·seed v3 원문·검증 12종·회의론자 24건 처리)** = [2026-08-16-marketing-diagnosis-v3-design.md](2026-08-16-marketing-diagnosis-v3-design.md)
- 목업 마스터 프롬프트(셸 제작 근거) = [2026-08-16-diagnosis-example-mockups-master-prompt.md](2026-08-16-diagnosis-example-mockups-master-prompt.md)
- 이미지 슬롯·비율 원장 = `packages/frontend/public/diagnosis-examples/assets/README.md`
- 요금제 게이팅 CT = `utils/plan-guard.ts` 상단 주석(고객 DB 상한 폐지 경위 포함)
- 기억 진입 = `memory/project_2026_0816_marketing_diagnosis.md`
