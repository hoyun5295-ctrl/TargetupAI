# 자동마케팅(Continuous Operator) 자율 발송 — 설계서 (2026-06-05)

> 작성: 비토(CTO) · 승인: Harold(설계 방향 확정, 세부 질의는 §6) · 구현: 다음 세션
> 흐름: brainstorming(본 문서) → writing-plans → TDD 구현(여정과 동일 원칙)

---

## 0. 배경 — 왜 이 작업이 필요한가

2026-06-05 자동마케팅 소스 점검에서 결정적 결함 발견:

- **자동실행(`auto_executed`)이 크레딧만 차감하고 실제 발송 코드가 전무.**
  - `generateProposalForOperator`(continuous-operator.ts)가 status='auto_executed' INSERT + 문안 3 크레딧 차감(line 593)까지만 함.
  - `auto_executed` 제안서를 고객에게 보내는 코드가 없음(`markProposalExecuted` 호출 0건, 발송 워커·엔드포인트 0건).
  - 결과: ENT가 자동실행을 켜면 **크레딧만 빠지고 고객은 메시지를 못 받음.**

설계 의도(Harold 확정)는 "켜두면 매달 그 달 계절 문안을 AI가 생성·타겟 자동추출·테스트 후 자율 발송"인데, 그 **발송 한 덩어리가 통째로 빠져 있다.** 본 문서는 여정 발송 인프라를 재사용해 그 발송을 구현하는 설계다.

---

## 1. 핵심 의도 (Harold 확정)

- **여정 ≠ 자동마케팅**
  - 여정: 처음 만든 **고정 문안**을 트리거마다 반복.
  - 자동마케팅: 매달 그 달 **계절감에 맞는 새 문안을 AI가 생성** + 조건에 맞는 타겟 자동추출 + 테스트 후 발송.
- **첫 달부터 자율.** 익월부터 담당자가 설정하거나 화면 보며 대기할 것이 없음. 2시간 전 알림은 "원하면 정지" 용도(승인 대기가 아님).
- **운영자가 자동발송 시각 T를 직접 선택**(설계안 ㄱ).
- **스팸은 자율 처리** — 걸리면 AI가 2회 재생성+재테스트. 그래도 못 넘기면 **운영자 일시정지 + 담당자에 사유 알림**.
- **타겟 0건** → 그 사이클만 건너뜀, 다음 주기 정상(정지 X).

---

## 2. 현 상태 (점검 사실, 라인 근거)

| 영역 | 현 상태 | 판정 |
|---|---|---|
| 제안서 생성 | orchestrate(타겟·문안·검수) + 스팸테스트(2회 재생성) + INSERT + 크레딧 차감 | 됨 |
| **실제 발송** | **auto_executed 제안서를 보내는 코드 없음** (markProposalExecuted 호출 0) | ★ 빠짐 |
| 사후 통지 | 자동실행에 담당자 알림 없음 | 빠짐 |
| 안전필터 | `countFilteredCustomers`(services/ai.ts:2282)가 is_active·sms_opt_in만, **is_opt_out·is_invalid 누락** + 수신거부 user_id 기준 | 갭(여정 #1과 동일) |
| 검증 7일 | `isAutoSendAllowed`/`verification_*` — daily 모델용 | 월간 자율과 불일치 |
| compliance | 검수 AI 에러 시 passed=true fallback(ai-orchestrator:280) → 자동실행 자격에 들어감 | fail-open |
| 죽은 코드 | `spamTestWithRetry` + `estimateSpamScore`(가짜 SPAM_WORDS +15점) 등 미사용(주석 명시) | 제거 대상 |
| 검증기간 게이팅 | 미통과 시 auto_executed 플래그만 false, status 'auto_executed' 유지 → 차감 발생(line 580 vs 593) | 버그 |

---

## 3. 확정 설계 — 한 사이클 흐름 (ㄱ 모델)

운영자가 자동발송 시각 **T**를 설정(예: 매달 1일 10:00). 워커(5분 주기)가 두 시점을 처리한다.

### 3.1 T−2h — 준비(생성·테스트·담당자 알림)

1. 그 달 **계절 문안 생성** + 조건 타겟 자동추출(공통 안전필터) — orchestrate 재사용.
2. **스팸테스트** — 걸리면 AI 2회 재생성 + 재테스트(기존 `autoSpamTestWithRegenerate` 재사용).
   - 2회 후에도 실패 → **운영자 status='paused' + 담당자에 사유 알림** → 이번 사이클 종료(발송 X).
3. 타겟 **0건** → 이번 사이클만 건너뜀, operator next_run_at만 다음 주기로 → 종료(정지 X).
4. 통과 시 → 제안서 status='scheduled', `scheduled_send_at = T` 저장.
5. **담당자에게 테스트발송 + 알림** — 고객이 받을 실제 문안을 담당자 폰으로 1건 테스트 발송 + 정지 링크 안내(무과금, 인증 라인).

### 3.2 T−2h ~ T — 정지 창

- 담당자가 정지 링크를 누르면 제안서 status='admin_stopped' → 발송 취소.
- 손 안 대면 그대로 발송 예정.

### 3.3 T — 자율 발송

1. `scheduled_send_at <= NOW` + status='scheduled' + 미정지 제안서를 워커가 집어 **직접발송 파이프라인으로 전원 발송**.
2. campaign 1건 기록(source='continuous-operator') + step_log 성격 기록.
3. **크레딧 1회 차감**(멱등키 `continuous-operator-send:proposalId`) — 발송 성공 시점에만.
4. 제안서 status='sent', campaign_id 연결(`markProposalExecuted`).
5. 담당자에게 "N명 발송 완료" 통지(무과금).

---

## 4. 발송 메커니즘 — 직접발송 파이프라인 재사용

### 4.1 선택안 (검토 결과)

- **(채택) 직접발송 파이프라인 재사용** — `campaigns` 1건 + `campaign_send_staging` 적재 + 청크 워커 + 공통 안전필터. 톤28 504 안전장치(commit 즉시 202 + 청크) 포함. 한 메시지 → N명 = 캠페인 발송과 동형이라 가장 자연스럽고 검증됨.
- (기각) 여정 실행 경로 — per-customer execution 기반이라 단발 캠페인엔 과함.
- (기각) 신규 발송기 — 검증된 경로 두고 재발명, 위험.

### 4.2 필요한 리팩터

- 현재 직접발송은 HTTP 엔드포인트(`routes/campaigns.ts /direct-send`) 안에 로직이 묶여 있음 → **백엔드 호출 가능한 함수로 추출**(예: `sendCampaignDirect(spec)`) 후 엔드포인트와 자동마케팅 워커가 공유.
- 추출 시 직접발송의 타겟 추출 SQL도 **공통 안전필터(is_active·sms_opt_in·is_opt_out·is_invalid·수신거부 회사+전화)** 적용 여부 확인 → 갭 있으면 함께 정정(여정 #1과 동일 원칙).

---

## 5. 안전 / 엣지

- **안전필터 통일** — 추출·카운트·발송 3곳이 동일한 공통 안전필터. `countFilteredCustomers`의 is_opt_out·is_invalid 누락 + 수신거부 user_id 기준을 회사+전화 기준으로 정정.
- **크레딧 멱등** — 발송 확정 시 1회 차감(멱등키 proposalId). "차감만 되고 미발송" 현 문제 해소. 생성 단계 차감은 제거(발송 성공 시점으로 이동).
- **compliance fail-open 정정** — 검수 AI 에러 시 passed=true → 자동발송 자격 X(검수 못 했으면 자동발송 안 함). 단 실 스팸테스트는 별도 유지.
- **멱등(사이클)** — 한 사이클 = 제안서 1건 · 발송 1회. 워커가 같은 사이클을 두 번 처리해도 중복 생성·발송 X(scheduled_send_at + status 상태기계).
- **검증기간 게이팅 버그 정정** — verification 자체를 제거하므로 line 580/593 status 불일치도 해소.

---

## 6. ★ 다음 세션 결정 필요 (Harold 질의)

> 비토가 생각하는 자동발송 세부 — 구현 전 Harold 확정 필요.

1. **계절 컨텍스트 소스** — 월→테마 고정 달력(예: 1월 신년·2월 설·3월 봄/신학기·5월 가정의달·9월 추석·12월 연말)에 업종 반영까지? 아니면 단순 4계절만? (비토 추천: 월별 한국 시즌 달력 + 업종 톤. 여정 generator의 SEASON_BY_MONTH 패턴 재사용.)
2. **주기 제한** — daily도 자동발송 허용? daily는 "계절감"이 매일 같아 무의미. (비토 추천: 자동발송은 weekly/monthly만. daily 운영자는 제안서 검토용으로만.)
3. **2h 전 "테스트발송" 정의** — 담당자 폰에 고객이 받을 실제 문안을 진짜 SMS로 보냄 + 정지 링크 별도? (비토 추천: 실제 문안 1건 테스트 발송 + 정지 안내 1건. 여정 pretest-notifier 패턴.)
4. **정지 창 길이** — 2h 고정 vs 회사 설정(`opt_out_minutes` 컬럼 활용). (비토 추천: default 2h, 회사 설정 허용.)
5. **수동 승인 UI 유지 여부** — 자율이 default지만, 담당자가 대기 중 제안서를 미리 보고 일찍 승인/정지하는 화면은 유지? (비토 추천: 유지 — 자율 + 수동 개입 둘 다.)
6. **발송 완료 통지** — 발송 후 "N명 발송 완료" 담당자 알림 보낼지. (비토 추천: 보냄 — 자율이라 가시성 필요.)
7. **예산 초과 시** — 현재 제안서 생성 차단(스킵). 자율 발송도 동일 처리 + 담당자 알림? (비토 추천: 스킵 + 알림.)
8. **objective + 계절 결합** — objective(고정 목표, 예 "VIP 재구매")는 유지하고 계절은 톤·소재로 얹는 구조. 프롬프트 결합 방식 확정.
9. **기존 verification/검증 코드 제거 시 마이그레이션** — 운영 중 operator row의 verification_* 컬럼·data 처리(보존 vs drop). (비토 추천: 컬럼 보존 + 미사용. drop은 위험.)
10. **프론트(ContinuousOperatorPage)** — 자동발송 시각 선택 + 자율 모드 표시 + 정지 이력 + 발송 결과. AI 여정 빌더 동급 디자인.

---

## 6.1 §6 확정 + 코드 실측 (2026-06-05 세션8)

§6 질의 10건 Harold 확정:

| § | 항목 | 확정 |
|---|------|------|
| 1 | 계절 소스 | 월별 한국 시즌 달력 + 업종 톤 (journey-ai-generator SEASON_BY_MONTH 재사용) |
| 2 | 발송 주기 | 일간 포함 전체 주기 허용 (추천 '주간/월간만'에서 변경) |
| 3 | 테스트발송 | 실문안 1건 + 정지안내 1건 (무과금 인증 라인) |
| 4 | 정지 창 | 기본 2h + 회사 설정 허용 |
| 5 | 수동 UI | 유지 (자율 + 수동 승인/정지) |
| 6 | 완료 통지 | 보냄 (N명 발송 완료, 무과금) |
| 7 | 예산 초과 | 이번 사이클 스킵 + 담당자 알림 (정지 아님) |
| 8 | 목표+계절 | objective 불변 + 계절은 톤·소재로 주입 |
| 9 | 검증 컬럼 | verification_* 보존 + 미사용 (DROP 안 함) |
| 10 | 프론트 | 발송 시각 + 자율 모드 + 정지 이력 + 발송 결과 |

코드 실측:
- 공통 안전필터 CT 이미 존재 — `utils/journey-safety-filter.ts` `buildJourneySafetyFilter(alias)` / `isCustomerSendable`. is_active·sms_opt_in·is_opt_out IS NOT TRUE·is_invalid IS NOT TRUE·unsubscribes(회사+전화) 안티조인. → `countFilteredCustomers`(ai.ts:2282)·`preview-recipients`(ai.ts:1233)·자율 추출 세 곳이 이 CT를 재사용(인라인 작성 금지).
- 안전필터 갭 — `countFilteredCustomers`·`preview-recipients` 둘 다 is_opt_out·is_invalid 누락 + unsubscribes를 user_id 기준 조회(회사+전화 아님).
- 계절 소스 — `SEASON_BY_MONTH`+`getSeasonContext`가 `journey-ai-generator.ts`(90~110, 비export). 자율 발송 재사용 위해 `utils/season-context.ts`로 추출(journey-ai-generator는 import만 교체, 출력 불변).
- sendCampaignDirect 추출 대상 — `/direct-send/commit`(campaigns.ts:1407~1446): countStagingFiltered → campaigns INSERT(send_phase='queued', staging_id, send_config) → prepaidDeduct → triggerDirectSendWorker. staging 적재 = `/direct-send/stage`(campaigns.ts:1255 UNNEST INSERT campaign_send_staging).
- 수동 승인도 실발송은 프론트가 /direct-send 호출(ai.ts:2039). 자율은 프론트가 없으므로 백엔드 sendCampaignDirect 필수.
- 크레딧 두 갈래 — ① 기능 크레딧 `continuous-operator-send`(3, 멱등키 proposalId) ② 실 SMS 발송비 `prepaidDeduct`(N건, sendCampaignDirect 내부). 현 auto_executed는 ①만 생성 시점 차감, ②·실발송 전무.

---

## 7. 구현 순서 (다음 세션, 위험 감소 우선)

1. **안전필터 통일** — countFilteredCustomers + 직접발송 추출 SQL에 공통 안전필터(is_opt_out·is_invalid·수신거부 회사+전화). (즉시 오발송 차단. 수동 발송에도 효과.)
2. **직접발송 함수 추출** — `sendCampaignDirect(spec)`로 빼고 엔드포인트가 그걸 호출(동작 보존 회귀 테스트).
3. **신규 컬럼** — `operator_proposals.scheduled_send_at`(information_schema 선검증 후 Harold ALTER).
4. **워커 2단계화** — T−2h 준비(생성·테스트·담당자 알림·scheduled) + T 발송(직접발송 호출·campaign·크레딧·통지). 멱등 상태기계.
5. **스팸 실패 → 운영자 정지 + 사유 알림** / **0건 → 스킵**.
6. **검증 7일 제거** + 죽은 스팸 코드 제거 + compliance fail-open 정정.
7. **계절 문안 주입** — 월별 시즌 컨텍스트를 orchestrate 문안 생성에 주입.
8. **프론트** — 발송 시각 선택 + 자율 모드 + 정지/결과 UI.

각 단계 = 순수 로직 TDD(가능한 곳) + tsc 0 + 자가 grep + 코드만(배포 Harold).

---

## 8. 구현 전 검증 의무 (information_schema 선검증 — 추측 0)

코드 쓰기 전 순수 덤프로 확인(컬럼명 단정 금지):

1. `operator_proposals` 실제 컬럼 — scheduled_send_at 존재 여부 + status 가능 값 + spam_test_* 컬럼.
2. `continuous_operators` — verification_*·opt_out_minutes·admin_phone_numbers·budget_* 존재.
3. 직접발송 staging 테이블(`campaign_send_staging` 등) 실제 이름·컬럼.
4. `customers` 안전필터 컬럼(is_active·sms_opt_in·is_opt_out·is_invalid·phone) + `unsubscribes`(company_id·phone) — 여정에서 확인됨, 재확인.

---

## 9. 비목표 (YAGNI)

- 채널 분기(이메일·푸시) 자동발송, A/B 고도화, 실시간 대시보드는 이번 범위 밖. 이번은 **빠진 발송 + 안전 + 계절 문안**에 집중.
