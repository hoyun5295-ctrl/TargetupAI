# 시연 회사 설계서 (2026-10-09)

> Harold 지시(1009): 시연용 회사 1개(로그인 `hanjulai` · 첫 로그인 비밀번호 변경) · 매일 합성 고객·구매가 싱크 에이전트와 같은 수집 경로로 들어오고 · 여정 기본 세팅 + 자동마케팅(생일) 세팅 ·
> **발송은 아예 안 나가고 발송 엔진까지도 안 가게** · 돈·통계·학습 오염 0.
> 브레인스토밍(COLLAB §1 · 5역할 · 교차 토론 1회 · 회의론자 최종 검증 12항목) 수렴안.

## 0. 불변식

1. **시연 회사 판정 = `utils/demo-company.ts` 한 곳**(`companies.is_demo`). 계정 이름·ENV 로 판정하지 않는다. 켜는 곳 = 시드 스크립트뿐(화면 수정 0).
2. **시연 회사 발송 0** — 문자 큐(MySQL)·알림톡·이메일·테스트·스팸 테스트 어느 것도 나가지 않는다. 판정은 **효과가 만들어지는 함수 안**에 있다(경로 층 + 최후 방어 층 두 겹).
3. **시연 회사 돈 0** — 선불 차감·AI 크레딧 차감·청구가 생기지 않는다. 환불 경로는 막지 않는다(no-op · 다른 회사 루프를 멈추지 않게).
4. **오염 0** — 회사 간 학습 풀·관리자 전역 집계에 시연 회사가 들어가지 않는다.
5. **목업 0** — 화면에 그려 넣지 않는다. 합성 데이터가 진짜 엔진(여정 실행기·자동마케팅 대상 계산)을 타고, 막힌 발송은 "시연 기록"으로 남아 여정이 다음 단계로 간다. **클릭은 합성하지 않는다**(목표 달성은 구매 원장 판정으로 생긴다 · journey-executor `hasPurchasedSince`).
6. 판정 조회 실패 = fail-closed: 컬럼 부재(42703)만 "시연 아님"(시연 회사는 컬럼 뒤에만 생긴다) · 그 밖의 오류는 throw.

## 1. 표식 · DDL

`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;` — **배포 뒤** Harold 실행. 판정 CT 는 컬럼 부재를 견딘다(전역 집계는 SQL 에 컬럼을 쓰지 않고 CT 가 준 id 목록으로 뺀다).

## 2. 경로 층 (진행을 기록하는 층)

| 경로 | 자리 | 처리 |
|------|------|------|
| 여정 | journey-executor processExecution · 발송 직전 상태 재확인 뒤 · 잔액 확인 앞 | step_log `status='sent'` · cost 0 · campaign_id NULL · `error_reason='demo_simulated'` → advanceOrComplete. 라인그룹 검사는 시연이면 건너뛴다(시연 회사는 라인그룹 미배정 = 2차 벽) |
| 자동마케팅(continuous-operator) | dispatchProposalSend · 적재 표식·createDirectSendCampaign 앞(시연 판정은 함수 첫머리 · 실발송 전용 080·등록 발신번호 검사는 시연이면 건너뛴다 · Codex 1R) | 제안 `sent` 마감 + meta `{ demo:{simulated, recipients, at} }` · 크레딧 차감 미도달 |
| 스팸 검사 공용 CT | autoSpamTestWithRegenerate(자동마케팅 · 리마인드 · 화면 재검사 공통) | 시연이면 검사 발송 없이 통과 |
| 여정 스팸 검사(★1010 추가) | runStepSpamTest(발송 2시간 전 스캐너 · 활성화 검증 공용) | 시연이면 검사 발송 없이 통과 · 1010 운영 로그 `[DEMO-LEAK] prepaidDeduct ref=spam:` 1건으로 발견(최후 방어가 막음 · 돈 · 발송 0) |
| 여정 발송 전 담당자 문자 | journey-pretest-notifier notifyManagerForStep | 시연이면 return |
| 담당자 통지 | notifyOperatorAdmins | 시연이면 맨 앞 return |
| 옛 자동발송(auto-campaign-worker · 신규 생성 410) | executeAutoCampaign · 사전알림 · 문안 알림 | 시연이면 return(기록 없음) |

## 3. 사람 입구 (거절)

사람이 누르는 발송·돈 입구는 맨 앞에서 `assertNotDemoCompany` → 409 `DEMO_BLOCKED` "시연 회사는 실제로 보내거나 결제하지 않습니다". 대상 = 직접 발송(`POST /campaigns/direct-send` · `/direct-send/commit`) · AI 캠페인 발송(`POST /campaigns/:id/send`) · 테스트 발송 · 브랜드 발송 · 스팸 테스트 · createDirectSendCampaign(공통 길목) · 충전 요청 · 발신번호 등록 · 080 등록. 화면은 기존 오류 표시(토스트)로 문구를 보여 준다.

## 4. 최후 방어 층 (도달 = 사고)

sms-queue 적재 CT 4개(bulkInsertSmsQueue · insertAlimtalkQueue · insertBrandQueue · insertTestSmsQueue) = 시연 회사면 throw + `[DEMO-LEAK]` 경보. `prepaidDeduct` = `{ ok:false }`(원장 0 · 발송이 멈춘다) + 경보. `prepaidRefund` = no-op + 경보(정산 스위퍼 회사 루프를 멈추지 않게). AI 크레딧 = `checkCredit` 통과 · `deductCredit` 은 `skipReason:'not_applicable'`(차감 대상 아님). 고객 발송이 MySQL 큐에 닿는 길은 위 CT 4개뿐이다(그 밖의 직접 INSERT = 로그인 인증·계정 알림 시스템 문자 · 1009 전수 grep). 회사를 판정할 수 없는 분기(인자 없는 테스트 적재)는 그대로 둔다(시스템 경로).

## 5. 제외 (회사 간 풀·전역 집계)

training-logger(logTrainingData · logCampaignTraining) 맨 앞 · AI 메모리 적재 워커 회사 루프 · 동종 벤치마크 · 베스트 카피 채굴 · 관리자 AI 학습 개요(operator_proposals 합계). 차감·캠페인이 생기지 않으므로 청구 입력은 0(시드는 요금제를 두지 않는다).

## 6. 화면

- 로그인 응답 `user.company.isDemo`(auth.ts · login-issue.ts 두 SELECT) → 앱 전역 띠 1줄(slate) "시연 회사 · 고객·구매는 매일 만들어지는 가상 데이터이고 문자는 실제로 나가지 않습니다".
- 여정 통계: `demo_simulated_count` 한 열 · 발송 수에서 뺀다 · 화면은 "시연 n".
- 그 밖(자동마케팅 비용·귀속 매출 문구, 슈퍼관리자 "시연" 배지)은 추가 과제.

## 7. 비밀번호

- 시드: 비밀번호는 ENV `DEMO_INIT_PASSWORD`(셸 `read -s` 로 받아 넘긴다 · argv·로그·감사 0) · `must_change_password=true`.
- **서버 강제**: must_change_password 인 일반 사용자는 로그인 시 세션 대신 변경 전용 흐름(지금은 프론트만 강제 · 토큰은 발급됨) → 서버가 비밀번호 변경·로그아웃 외 API 를 403 `PASSWORD_CHANGE_REQUIRED`.
- LoginPage 비밀번호 변경 응답 `res.ok` 를 확인한다(지금은 실패해도 로그인된다).

## 8. 합성 데이터

- **시드 스크립트** `packages/backend/scripts/setup-demo-company.ts`(Harold 서버 1회 · 멱등 · 끊기면 같은 명령으로 이어 간다): 회사 생성(공용 CT) 직후 `is_demo=true`(서버는 그 회사를 아직 캐시하지 않았다) · 라인그룹 NULL · use_db_sync · 요금제 없음 → 싱크 시크릿(서버엔 해시 · 원문은 **즉시** 권한 600 파일 · 화면 출력 0) → users `hanjulai`(bcrypt · must_change_password) → **고객 3,000명 + 과거 구매 이력**(입력 데이터만 · 결과 소급 0 · 덜 들어갔으면 다시 보낸다) → 여정 3개(신규 가입 환영 · 구매 후 재구매 · 휴면 고객 · LMS · 검증 통과 표식) **고객 적재 뒤에 켠다** → 생일 자동마케팅(segment birthday · 매일 10시 · 직접 쓴 문안).
- **매일 생성 워커**(utils/demo-data.ts): ENV `DEMO_SYNC_API_KEY`·`DEMO_SYNC_SECRET` 이 있을 때만 뜬다 · 키가 시연 회사 것이 아니면 거절 · 07:00 KST 이후 1회 · 루프백 `POST /api/sync/customers`·`/purchases`(사설 IP = 출발지 통제 통과) · 날짜 시드 결정적 · 어제 영업분(새 고객 20~40 · 재구매 30~80 · 주말 1.3배) · 순서 = 새 고객 → 구매(원장 고유 키 멱등) → 재구매 고객 누적값은 **구매 원장에서 다시 계산**(같은 날 다시 돌려도 이중 가산 0 · Codex 1R) · 생일은 3,000명에 고르게(하루 약 8명) · 수신동의 true 일관.
- 번호 = `0100`·`0101` 로 시작하는 11자리(010-0xxx 미할당 국번 · normalizePhone 통과).
- 예열 = 시연 날짜에서 거꾸로 최소 14일 · 권장 4주(지도 숫자가 30일 창).

## 9. 계약 테스트

- 행동: 시연 회사로 최후 방어 CT 호출 → throw · prepaidRefund → no-op · 판정 반전 변이에서 테스트 실패 확인.
- 소스: 사람 입구 라우트 목록에 `assertNotDemoCompany` 가 있다 · 여정 실행기 절단점이 잔액 확인보다 앞이다.

## 10. 범위 밖 (기록)

- 이메일 발송 경로는 게이트를 두지 않았다(합성 고객에 이메일 0 · 사람이 누르는 이메일 테스트 발송은 남는다 · 필요하면 email-channel 공용 함수에 같은 가드).

- journey-stats 단계 전환이 cdp_events 'purchase' 만 센다 → 싱크 고객사 전체 전환 0(별건 버그 · 시연과 무관).
- 일반 사용자 비밀번호 최소 길이 8 → 10.
- MySQL 큐에 시연 회사 app_etc2 가 생기면 경보하는 감시 워커.
- 자동마케팅 비용·귀속 매출 카드 문구 · 슈퍼관리자 "시연" 배지 · 상태 배지 "시연 기록".
