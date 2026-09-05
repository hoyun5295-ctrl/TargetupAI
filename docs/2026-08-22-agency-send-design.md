# 대행발송 셀프 접수 설계서 (2026-08-22)

> ★2026-08-26 승격: **상설 SoT는 [FEATURE-AGENCY-SEND.md](FEATURE-AGENCY-SEND.md)로 분리됐다.** 호출어 "대행발송"이면 그 문서를 먼저 연다(정체성·불변 원칙·파일별 소유·이력 색인).
> **이 문서는 시점 설계서다** — 그때 무엇을 왜 정했는지, 구현 중 무엇이 어떻게 뒤집혔는지, 실측 절차가 무엇인지를 소유한다. 상설 문서에서 링크로 들어온다.
> 경위: Harold 2026-08-22 "직원 2명이 대행발송에 붙어 있다. 대행발송 메뉴를 만들어 슈퍼관리자가 체크한 업체에만 열고, 담당자가 등록하면 스팸 검사·다듬기·테스트 문자·승인·예약·당일 재검사까지 기계가 돌게 하자. 유료 요금제만."

## 0) 30초 요약

| 질문 | 답 |
|---|---|
| 이게 뭔가 | 고객사 담당자가 수신 파일·문안·시각·담당자 번호를 접수하면 **스팸 검사 → AI 다듬기 → 담당자 테스트 문자 → 승인 → 발송**을 기계가 돌리는 메뉴. **발송일이 검사일과 다르면 발송 2시간 전에 한 번 더 검사한다**(같은 날이면 안 한다 · ★0823(2) §14) |
| 왜 | 직원 2명이 고객사 계정에 들어가 손으로 하던 일. 사람은 승인 버튼만 남긴다 |
| 누구에게 | 메뉴는 **모든 회사에 보인다(미끼)**. 들어가는 것은 슈퍼관리자가 켠 플래그 **AND** 유료 요금제. 나머지는 안내 모달 + 요금제 가입 버튼(§4-8). 판정은 서버 한 곳 |
| 엔진은 어디서 | 옛 자동발송 워커에 같은 파이프라인이 이미 있다(§2-1). 검사 루프·다듬기·알림 문안 CT를 가져다 쓰고, **접수·승인 원장과 워커는 새로** 만든다 |
| 가장 중요한 구조 결정 | **큐 적재는 발송일 당일 검사 통과 뒤 1회뿐**(§3-3). 승인 때 적재하지 않으므로 당일 차단에 큐 DELETE가 없다. 그리고 **적재 자체를 직접발송 배관에 위임한다**(★0823 · §4-4) |
| 돈 | **본 발송이 고객사 차감**(실체 = 직접발송 배관의 선차감. `send_type='direct'`로 그냥 탄다 · ⛔ 정산 축에 새 값을 만들지 마라 · §12). 담당자 안내는 무차감, 담당자 테스트 문자는 접수자 ID(`bill_id`)로 잡힌다. AI 다듬기 크레딧 = 0. ⚠ 스팸 검사는 이 경로가 `skipPrepaid: true`라 무과금이다(불변 5와 어긋난다 · §14-7) |
| 다음 | **0823 배포완료**(예약 12:00 생성까지 실측 확인). **0823(2) 당일 재검사 폐지 코드완료 · 배포 대기** → 배포 후 §10-12 실측 |

---

## 1) 한 줄 정의

**사람이 하던 대행발송의 손을 전부 기계로 옮기되, 발송을 결정하는 손(승인)만 담당자에게 남긴다.** 승인 없는 발송은 이 축에 없다.

---

## 2) 확정 사실 (실측 · 재검증 불요)

| # | 사실 | 근거 |
|---|---|---|
| 2-1 | **같은 파이프라인이 옛 자동발송 워커에 있다.** D-1 문안 생성+스팸 검사 → D-day 2시간 전 재검사 + 담당자 테스트 발송 → 본 발송 직전 차단 여부 재확인. 주석에 Harold 2026-04-28 정책 원문이 있다. 단 `AUTO_CAMPAIGN_RETIRED = true`로 봉인되어 있고(옛 자동발송 폐기), 대상이 업로드 파일이 아니라 고객 DB 필터이며, **승인 버튼이 없다**(막으려면 일시정지) | `utils/auto-campaign-worker.ts:133-145, 1219-1470` |
| 2-2 | 스팸 검사 루프 CT = `autoSpamTestWithRegenerate`: 통신사별 테스트폰 발송 → 차단이면 `regenerateCallback`으로 새 문안 → 재검사, `maxRetries` 회. 자동 마케팅·플래너도 이것을 쓴다 | `utils/spam-test-queue.ts:607` · 소비처 3곳 |
| 2-3 | 스팸 검사 비용은 **이미 회사 귀속**이다. `prepaidDeduct(companyId, …, 'spam')` | `spam-test-queue.ts:198` |
| 2-4 | **예약 직접발송 = 등록 직후 MySQL 큐 선적재(`sendreq_time`=예약 시각). 취소의 실체 = 큐 DELETE.** 0611 에이치피오 87,014건 실발송(250만원)이 "DELETE 0건인데 성공 표시"였다. 취소 CT `cancelCampaign`은 그 뒤 효과 검증을 넣었다 | `status/lessons/LESSONS_BACKEND.md` 488행 · `utils/campaign-lifecycle.ts:168` |
| 2-5 | 직접발송 적재 경로 = `POST /direct-send/stage`(수신자 적재) → `/direct-send/commit`(채널·유형 확정 → 회신번호 등록 검증 → 캠페인 행 → `bulkInsertSmsQueue`). 변수 치환은 `messageUtils.replaceVariables` 하나(모든 발송 경로의 유일한 치환 함수), 문법 `%변수%` | `routes/campaigns.ts:1548-1700` · `utils/messageUtils.ts:180` |
| 2-6 | 담당자 알림 문자는 인증 라인(`getAuthSmsTable`)으로 `bulkInsertSmsQueue`. 문안 빌더 `buildSpamTestResultNotifyMessage`가 (광고) 부착·이모지 제거까지 한다 | `auto-campaign-worker.ts:1424-1466` · `utils/auto-notify-message.ts:245` |
| 2-7 | 회사 단위 기능 플래그 선례 = `companies.cdp_auto_execute_enabled boolean NOT NULL DEFAULT false`(슈퍼관리자 회사 편집 토글). 메뉴 게이트 선례 = "캠페인 대행"(`advanced_access_enabled`를 my-plan 응답에 실어 `DashboardHeader`가 읽음) | `SCHEMA.md:359, 2653` · `routes/companies.ts:378` · `DashboardHeader.tsx:130` |
| 2-8 | 유료 요금제 판정 CT = `ACTIVE_PAID_PLAN_WHERE`(plan_code <> FREE, 구독 만료·정지 아님). 도움말 봇이 같은 판정을 쓴다 | `utils/plan-guard.ts:150` · `routes/help.ts:27` |
| 2-9 | 발송 허용 시간 = `SEND_HOURS`(08~21) + 회사 설정 `send_start_hour`·`send_end_hour`·`holiday_send_allowed`. 예약 시각 검증 CT = `validateScheduledAt`(과거·365일 초과 차단) | `utils/send-time-util.ts:32` · `SCHEMA.md:301, 381` · `utils/campaign-validation.ts:43` |
| 2-10 | 2시간 전 담당자 알림 워커 선례 = 여정 `journey-pretest-notifier.ts`(`next_run_at <= NOW() + INTERVAL '2 hours'`, 5분 cron) | `app.ts:496` |
| 2-11 | 현재 "대행발송"은 코드에 흔적이 0이다. 전부 직원 수작업 | grep 0건 |

---

## 3) 불변 원칙 (⛔ = 어기면 사고)

1. **⛔ 승인 없는 발송 0.** 접수 → 검사 → 승인 → 예약. 당일 차단 뒤 다듬은 문안도 **재승인** 없이는 나가지 않는다(Harold 확정). 요청 시각까지 승인이 없으면 발송하지 않고 안내한다.
2. **⛔ 발송일에 통과한 검사 없이 발송 0.** 워커가 죽어 그 검사가 안 돌았으면 그 건은 나가지 않고 `expired`로 안내한다. "승인했으니 그냥 보내자"는 없다.
   **★0823(2) 정정(Harold 지시): 그 검사가 꼭 2시간 전일 필요는 없다.** 접수한 그날 나가는 건은 접수 때 통과한 검사가 곧 발송일 당일 검사다. 같은 문안을 같은 날 두 번 검사하면 테스트폰 발송 비용이 한 번 더 나가고, 통신사 결과가 흔들려 **담당자가 이미 승인한 문안이 차단으로 뒤집힌다.** 접수일과 발송일이 다르면 그날의 검사가 없으므로 2시간 전 재검사를 그대로 한다.
   판정의 실체는 `final_test_at` 하나다 = **이 문안이 발송일 당일 검사를 통과한 시각.** ⛔ 통과 분기에서만 찍는다(차단된 문안에 찍히면 검사 없이 나간다).
3. **⛔ 큐 적재는 발송일 당일 검사 통과 뒤 1회뿐**(그 검사가 접수 때의 것이든 T-2h의 것이든 · §14)**.** 승인 시점에는 원장 상태만 바꾼다. 그래서 당일 차단에 큐 DELETE가 없다(2-4의 사고 경로를 구조로 제거). 적재 뒤(`queued`)의 취소만 기존 `cancelCampaign` CT를 탄다.
   **★0823 추가: 적재는 이 축이 직접 하지 않는다.** 검사를 통과하면 `campaign_send_staging`에 넣고 `createDirectSendCampaign`을 부른다. 차감·수신거부 제외·중복 제거·큐 적재·미적재분 환불·`sentTables` 기록·적재 중 취소 감지는 전부 그 배관이 소유한다. 이 축이 큐에 직접 넣는 것은 담당자 안내·테스트 문자(인증 라인)뿐이다.
4. **⛔ 변수 치환·(광고) 부착·회신번호 검증·채널 확정은 직접발송과 같은 CT만 쓴다.** 이 축에 치환 함수·광고 문구를 새로 쓰지 않는다(2-5).
   **★0823 추가: 그래서 문안 변수는 주소록 슬롯 네 칸(`%이름%`·`%기타1~3%`)에 얹는다.** 치환 함수는 값을 **DB 컬럼 이름**으로 찾으므로, 접수 화면이 모은 "변수명 → 값"을 그대로 넘기면 하나도 못 찾고 전부 빈 문자열이 된다. 번역은 `utils/agency-send-vars.ts`가 하고, 다섯 번째 변수는 접수에서 막는다(발송 직전에 조용히 잘리면 안 된다).
5. **⛔ 비용은 전액 고객사 귀속.** 스팸 검사(테스트폰)·본 발송이 회사 차감이다. 우리가 대신 내는 항목이 없다(Harold 확정 · 2-3과 동일).
   **★0823 확정(Harold): 정산은 "누구 ID로 나갔나"로 이미 굴러간다. 이 축이 새로 할 일이 없다.**
   스팸필터 테스트는 `spam_filter_tests.user_id`, 담당자 테스트 문자는 큐의 `bill_id`, 본 발송은 캠페인 `created_by`로 각각 **접수자 ID**에 잡힌다.
   ⛔ **정산 축에 새 값을 만들지 마라.** 대행발송은 직접발송 배관을 그대로 타므로 `send_type='direct'`면 결과 동기화·환불·청구가 기존 경로로 돈다. 새 값을 만드는 순간 그 축들을 건드리게 된다(0823에 실제로 그랬고 전량 되돌렸다).
   담당자 안내·테스트 문자는 인증 라인으로 나가고 차감하지 않는다(옛 자동발송 워커의 담당자 알림과 같다 · `auto-campaign-worker.ts:1462` 실측). 문서가 "안내 문자도 차감"이라 적고 있었으나 선례와 코드 양쪽이 무차감이라 문장을 현실에 맞춘다.
6. **⛔ 노출 판정은 서버 한 곳.** `canUseAgencySend(companyId)` = 플래그 AND 유료. 접수 생성·승인·워커 픽업이 같은 함수를 부른다. 프론트는 my-plan 응답의 값으로 메뉴를 보이기만 한다.
7. **⛔ 승인은 문안 버전에 묶인다.** `approval_version = content_version`. 문안이 바뀌면(다듬기) 승인이 무효가 되어 재승인으로 간다(플래너 `plan_hash` 선례).
8. **AI 다듬기는 핵심을 바꾸지 않는다.** 날짜·금액·URL·상호·전화번호는 원문 그대로 보존하고, 원문에 없는 혜택은 `detectBenefits`로 막는다. 2회차는 "표현만 최소 수정".
9. **⛔ 발송 허용 시간 밖 요청 시각은 접수에서 막는다.** 회사 설정(2-9) 안이어야 하고, 최소 리드타임 = 접수 시각 + 3시간(1차 검사·승인·2시간 전 재검사가 들어갈 시간). 더 짧으면 가장 이른 가능 시각을 제안한다.
10. **⛔ 이 축이 만드는 모든 문구에 줄표 "—" 0.** 모달·카드·버튼·placeholder·빈 상태·안내 문자·토스트 전부. 나열은 "·", 부연은 ":" 또는 괄호, 문장이 둘이면 마침표로 나눈다(★Harold 2026-08-22 재지시 "앞으로 만드는 모든 모달이나 모든 컨텐츠에서 뺀다"). 파일을 쓴 직후 그 파일에 `grep -n "—"`를 돌리고 결과를 보고에 싣는다. 기계 검증 = 기존 `em-dash-invariants.test.ts`.
11. **MMS는 이미지가 본체다.** 스팸 검사는 텍스트만 본다(이미지는 스팸 판정과 무관, 기존 검사 모달 안내 그대로). 그래서 **담당자 테스트 문자는 이미지를 붙인 MMS 그대로** 보낸다. 담당자가 승인하는 것은 이미지까지 포함한 실물이어야 한다. 이미지 0장인 MMS는 접수·큐 적재 양쪽에서 막는다(`validateMmsPayload` 2중 방어, 2026-04-21 9007 사고 선례).

---

## 4) 구조

### 4-1) 노출과 게이트

- 상단 메뉴 **"대행발송"**(`/agency-send`), 위치 = "직접발송" 바로 옆. **모든 회사에 보인다**(★Harold 2026-08-22 "대행발송을 미끼로 한다"). 같은 작업에서 **"AI Operator 소개"를 헤더에서 빼 대시보드 푸터 "기능 안내" 옆으로 옮긴다**(로그인 화면 2곳에 이미 있어 로그인 뒤 헤더에는 맞지 않는다 · 2026-07-05 매뉴얼 푸터 이동 선례). 항목 수는 그대로다.
- **클릭 = 플래그 ON(그리고 유료)이면 `/agency-send`, 아니면 안내 모달(§4-8).** 플래그는 슈퍼관리자가 유료 회사 중 쓰겠다는 곳에 켠다. 서버 판정 `canUseAgencySend` = 플래그 AND 유료 하나이고, my-plan 응답에는 그 결과 `agencySendAllowed: boolean` 한 값만 싣는다(플래그를 따로 내리지 않는다. 프론트가 두 값을 조합하면 판정이 두 벌이 된다).
- `/agency-send`에 주소로 직접 들어온 미허용 회사도 같은 모달을 본다(화면 안 빈 목록 위). 쓰기 API는 전부 403 `AGENCY_SEND_NOT_ALLOWED`.
- 슈퍼관리자: 회사 편집에 "대행발송" 토글 1개 + 대행발송 접수 현황 탭(전 회사 · 상태별 · 읽기 전용). 직원은 여기서 흐름을 본다. 토글을 끄면 새 접수·승인만 막히고 이미 승인된 건은 끝까지 처리한다(Harold 확정).

### 4-2) 접수 화면 (1페이지 · 3단계 · 콘솔 톤 `CUI_*`)

| 단계 | 입력 | 기계가 하는 것 |
|---|---|---|
| ① 수신 대상 | 엑셀 업로드(기존 `/api/upload/parse`) **또는** 텍스트 붙여넣기(번호 줄바꿈·콤마) | 헤더 인식 → 전화번호 열 자동 추정(수동 수정 가능) → 중복·형식 불량 행 수 표시 |
| ② 문안 | 문안 · LMS/MMS 제목 · 광고 여부 · 발신번호(회사 등록 번호 중 선택) · 변수 삽입 · **MMS 이미지**(파일 업로드 또는 "라이브러리에서 가져오기") | 문안 안 `%변수%`를 뽑아 파일 헤더와 **자동 매핑표**(동일 이름 자동, 수동 수정). 첫 행으로 치환 미리보기. 바이트 초과 시 SMS→LMS 안내. 이미지는 기존 `MmsUploadModal` + `useMmsUpload` 그대로(서버가 ≤300KB JPG로 변환, 장수 한도 동일). 이미지를 붙이면 MMS로 전환, 0장이면 MMS 접수 불가(`validateMmsPayload` CT) |
| ③ 시각·담당자 | 요청 시각(허용 시간·리드타임 검증) · 테스트 받을 담당자 번호 | 접수 즉시 "검사 중" 상태로 목록에 들어간다 |

목록 = 상태 칩 · 요청 시각 · 건수 · 최종 문안 · **승인 버튼**(승인 대기일 때만 활성). 상세 = 원문과 최종 문안 대조 · 검사 이력(회차·통신사별 결과) · 승인/취소/문안 수정.

### 4-3) 상태 머신

```
received ──1차 검사──▶ awaiting_approval ──승인──▶ approved ──T-2h 재검사 통과──▶ queued ──(기존 발송결과)
   │                        ▲      │                  │                            ▲
   │ 3회 차단               │      │ 시각 임박·미승인  │ T-2h 차단                  │ 재검사 없이 적재
   ▼                        │      ▼                  ▼                            │ (재승인 건 = 이미 통과)
test_failed ─문안 수정·재접수┘   expired          reapproval ──재승인──▶ approved ─┘
                                                      │ 2회 더 차단 → test_failed
                                                      │ 시각 지남 → expired(새 시각 입력 후 다시)
cancelled = 담당자 취소(queued 전 = 상태만 / queued 후 = cancelCampaign CT)
```

**시각 축(★0823 재설계).** 상수가 `2시간` 하나뿐이라 뜻이 셋인 값을 하나로 쓰고 있었다: 승인 마감 · 재검사 시작 · 적재 여유. 그래서 재승인이 구조적으로 불가능했고(§12-B) 승인된 건이 창을 놓치면 어디에도 안 걸렸다(§12-C). 지금은 **필요한 리드타임을 상태가 정한다**(`requiredLeadMinutes`).

| 상태 | 필요한 리드타임 | 이유 |
|---|---|---|
| `final_test_at` 있음(상태 무관) | 10분 | 발송일 당일 검사를 이미 통과했다. 남은 일은 예약뿐 (★0823(2)) |
| `awaiting_approval` | 120분 | 승인 뒤 당일 재검사가 들어가야 한다(`final_test_at`이 없을 때) |
| `reapproval` | 10분 | 검사를 이미 통과한 문안이다. 남은 일은 예약뿐 |
| `approved` | 10분 | 승인이 끝났다. 워커가 검사·적재를 하면 된다 |

**★0823(2) 리드타임은 상태가 아니라 남은 일이 정한다.** 당일 접수 건에 120분을 요구하면 **하지도 않을 검사를 이유로** 승인을 거절하고 근거 없이 만료시킨다. `requiredLeadMinutes(status, finalTested)`가 그 답 하나를 소유하고, 승인 라우트와 만료 워커가 **같은 인자로** 부른다(갈리면 §12-2가 되돌아온다).

재검사 대상 판정(`isFinalTestDue`)에서 10분 창을 없애고 단조 조건으로 바꿨다. 중복 처리를 막는 것은 창이 아니라 선점 UPDATE(`status='approved'`)다. 재검사 대상과 만료 대상이 **겹치지도 비지도 않는다**(테스트가 1분 단위로 고정).

**`final_test_at` = 지금 문안이 발송일 당일 검사를 통과했다는 표시.** 재검사를 건너뛰는 근거이자, 바뀐 문안이 검사 없이 나가지 못하게 막는 스위치다.

| 이 값을 건드리는 자리 | 하는 일 | 근거 |
|---|---|---|
| 워커 A(1차 검사) | **통과** + 접수일 = 발송일이면 찍는다 | ★0823(2). 그 검사가 곧 당일 검사다 |
| 워커 B(당일 재검사) | **통과**하면 찍는다 | 종전 그대로 |
| 문안 수정 라우트 | 무조건 지운다 | 바뀐 문안은 통과한 적이 없다 |
| 시각 변경 라우트 | **새 시각이 그 검사와 같은 날이면 남기고**, 아니면 지운다 | ★0823(2). 날이 바뀌면 그 날의 검사가 없다. `received`로 돌아가는 건은 조건 없이 지운다 |

⛔ **찍는 자리는 전부 통과 분기 안이다.** 시도 시각(`last_test_at`)은 차단된 회차에도 갱신되므로 이 판정에 쓰면 안 된다: 재검사가 차단된 뒤 알림 단계에서 예외가 나 `approved`로 되돌아간 건이 "당일 검사 통과"로 오판돼 **차단된 문안이 검사 없이 예약된다.**

| 상태 | 뜻 | 들어오는 길 |
|---|---|---|
| `received` | 접수됨, 1차 검사 대기 | 접수 |
| `testing` | 워커가 검사 중(lock) | 워커 선점 |
| `awaiting_approval` | 통과 문안을 담당자 번호로 테스트 발송함, 승인 대기 | 1차 검사 통과 |
| `test_failed` | 원문·다듬기·최소 수정 3회 모두 차단 | 검사 실패 · 안내 단문 |
| `approved` | 승인됨. **큐 미적재.** 요청 시각 대기 | 담당자 승인(버전 일치) |
| `final_testing` | 워커가 잡았다(당일 재검사 또는 적재) | 워커 |
| `queued` | 재검사 통과 → 캠페인 생성 + 큐 적재 완료 | 워커 |
| `reapproval` | 당일 차단 → 다듬은 문안 테스트 발송 → 재승인 대기 | 워커 |
| `expired` | 승인·재승인이 요청 시각 2시간 전까지 없음 → 미발송 | 워커 |
| `cancelled` | 담당자 취소 | 담당자 |

### 4-4) 워커 `utils/agency-send-worker.ts` (5분 cron · app.ts 등록)

| 단계 | 조건 | 하는 일 |
|---|---|---|
| A 1차 검사 | `received` | lock → 첫 수신자로 치환한 문안을 CT-09에 넣는다(`maxRetries: 2`, 1회차 콜백 = AI 다듬기, 2회차 = 표현만 최소 수정) → 통과: 최종 문안 저장(`content_version`++) + **접수일 = 발송일이면 `final_test_at` 기록**(★0823(2)) + 담당자 번호로 **테스트 발송**(실제 수신 확인용, 본문 그대로) + 안내 단문 → `awaiting_approval` / 3회 차단: `test_failed` + 안내 |
| B 당일 재검사 | `approved` AND 남은 시간 ≤ 2시간 AND `final_test_at` 없음 | `final_testing` → 같은 루프(텍스트) → 통과: `final_test_at` 기록 후 **예약 위임**(아래) → `queued` / 차단: Harold 원문 안내 단문 → 다듬기·재검사 → 통과 문안 테스트 발송(MMS면 이미지 포함) → `reapproval` / 더 차단: `test_failed` |
| B' 예약만 | `approved` AND `final_test_at` 있음 | 두 갈래가 온다: 재승인 건 · **당일 접수 건**(★0823(2)). **검사하지 않고** 곧바로 예약 위임 → `queued`. 다시 검사하면 승인받은 문안이 또 뒤집히고 남은 시간도 사라진다. ⛔ 적재 시점은 그대로 발송 2시간 전이다(상한은 후보 SQL이 들고 있다) |
| C 만료 | `awaiting_approval`·`reapproval`·`approved` AND 남은 시간 ≤ 그 상태의 리드타임 | `expired` + 안내 단문(승인한 건과 승인이 없던 건은 문장이 다르다) |
| D 대조 | `queued` ↔ `campaigns` | 캠페인이 `cancelled`면 원장도 `cancelled`. `send_phase='failed'`면 상태는 그대로 두고 이벤트·안내 1회(일부가 이미 나갔을 수 있어 "미발송"으로 적으면 거짓이 된다) |
| E 복구 | `testing`·`final_testing`이 30분 넘게 lock | 상태 되돌림(옛 워커 `generating_at` 선례). **예약을 이미 만든 건은 되돌리지 않고 `queued`로 올린다** — 되돌리면 다음 tick이 한 벌 더 만든다 |

**예약 위임(★0823).** `campaign_send_staging`에 수신자를 넣고(`staging_id` = 접수 id) `countStagingFiltered`로 정제 후 건수를 센 뒤 `createDirectSendCampaign`을 부른다(`sendType: 'agency'` · `scheduled: true` · `scheduledAt = requested_at`).
멱등의 근거는 원장의 `campaign_id`가 아니라 **캠페인이 들고 있는 `staging_id`**다. 캠페인을 만든 직후 죽으면 원장에는 아직 아무것도 안 적혀 있으므로, 만들기 전에 `staging_id`로 먼저 찾는다. 찾은 캠페인이 `preparing`·`failed`면 발송되지 않는 상태이므로 `expired`로 닫고 다시 만들지 않는다.

재검사 소요 = 테스트폰 결과 대기 25초 × 최대 3회 + 다듬기 호출 ≈ 3~5분. 2시간 창 안에서 여유가 있다.
승인 라우트는 성공 직후 `triggerAgencySendDispatch()`로 워커를 깨운다. 재승인은 남은 시간이 짧아 다음 tick(최대 5분)을 기다리면 그 사이에 만료 기준을 지난다.

### 4-5) 안내 단문 (인증 라인 · 회사 발신번호)

> ★0823 **담당자 번호는 여러 명**이라 아래 문자는 등록된 번호 전부에게 간다.
> **문안 실물(테스트 문자)만은 인증 라인이 아니라 테스트발송 축**으로 나간다(`insertTestSmsQueue` · `bill_id`=접수자 id).
> 그래야 화면의 테스트발송과 같은 자리에서 그 계정 사용량으로 잡힌다.

| 시점 | 문안 |
|---|---|
| 1차 통과 | 테스트 문자(본문 그대로) + `[대행발송] 스팸 검사를 통과했습니다. 로그인하여 문안을 확인하고 승인해 주세요.` |
| 당일 차단 | `[대행발송] 기존에 예약된 대행발송이 스팸필터테스트에 걸려서 예약취소 되었습니다. 곧 다시 문안 안내 드릴테니 로그인 하시어 승인 바랍니다.` (Harold 원문) |
| 재검사 통과 | 테스트 문자 + `[대행발송] 수정한 문안이 스팸 검사를 통과했습니다. 로그인하여 재승인해 주세요.` |
| 3회 차단 | `[대행발송] 문안이 세 차례 스팸 검사에 걸렸습니다. 로그인하여 문안을 수정해 주세요.` |
| 미승인 만료 | `[대행발송] 승인이 없어 요청 시각에 발송되지 않았습니다. 로그인하여 시각을 다시 정해 주세요.` |
| 승인 뒤 만료(★0823) | `[대행발송] 요청한 시각에 발송하지 못했습니다.` + 발송 직전 검사 시간이 지났다는 안내. **승인한 담당자에게 "승인이 없어서"라고 보내면 사실과 다르다** |
| 예약 실패(★0823) | `[대행발송] 예약을 넣지 못해 발송하지 않았습니다.` 사유(잔액·야간 광고 제한 등)는 화면 상세에 남는다 |

### 4-6) API (`routes/agency-send.ts`)

`GET /` 목록 · `POST /` 접수(파일 파싱 결과 + 매핑 + 문안 + 시각 + 담당자) · `GET /:id` 상세(검사 이력 포함) · `POST /:id/approve`(body: `contentVersion`) · `POST /:id/content`(문안 수정 → `received`로 재검사) · `POST /:id/reschedule`(만료·재승인 시 새 시각) · `POST /:id/cancel` · 슈퍼관리자 `GET /admin/agency-send`(전 회사) · `PUT /admin/companies/:id/agency-send`(토글).
모든 쓰기 엔드포인트는 `canUseAgencySend`를 **효과 함수 안**에서 부른다(라우트 장식이 아니다).

### 4-8) 안내 모달 `AgencySendIntroModal` (Harold 2026-08-22 지시 · 미끼)

- 뜨는 때 = 플래그 OFF이거나 미가입인 회사가 메뉴를 눌렀을 때(= `agencySendAllowed`가 false일 때 전부).
- 껍데기 = `components/console/ConsoleDialog`(인디고, 0821(2) 부속 모달 선례). native dialog 0. 375px에서 세로 스크롤.
- 문구(고객 언어 · 요금제 이름·금액·혜택 숫자 0 · 줄표 0):

| 자리 | 문구 |
|---|---|
| 제목 | 대행발송 |
| 부제 | 양식만 채우면, 나머지는 한줄로가 합니다 |
| 단계 1 · 접수 | 수신 명단 파일과 문안, 보낼 시각, 테스트 받을 담당자 번호를 적습니다. 이름 같은 항목은 문안에 자동으로 들어갑니다 |
| 단계 2 · 검사와 다듬기 | 통신사 스팸필터 테스트를 거칩니다. 걸리면 핵심 내용은 그대로 두고 문안을 다듬어 다시 검사합니다. 통과한 문안은 담당자 휴대폰으로 먼저 보내 드립니다 |
| 단계 3 · 승인과 예약 | 받은 문자를 확인하고 승인하면 요청한 시각에 예약됩니다. 접수한 날과 발송일이 다르면 발송 2시간 전에 한 번 더 검사하고, 걸리면 다시 다듬어 승인을 받은 뒤에만 나갑니다 |
| 바닥 안내(미가입) | 요금제를 사용하는 회사에서 열립니다 |
| 버튼(미가입) | **요금제 가입하러 가기**(→ `/pricing`) · 닫기 |
| 바닥 안내(유료인데 플래그 OFF) | 요금제를 쓰고 계시네요. 담당자에게 알려 주시면 바로 열어 드립니다 |
| 버튼(유료인데 플래그 OFF) | **이용 요청 남기기**(`help_questions`에 `path='/agency-send'`로 기록 → 슈퍼관리자 현황 탭에서 본다) · 닫기 |

- 두 갈래는 기존 my-plan의 요금제 코드(FREE 여부)로 가른다. 새 판정을 만들지 않는다.

- 세 단계는 아이콘 타일 + 한 줄 제목 + 설명 두 줄의 카드 3장. 첫 화면에서 버튼까지 보여야 한다(스크롤 없이 닿는 높이).
- 같은 모달을 `/agency-send` 직접 진입(미가입)에도 쓴다. 문구는 이 표 한 곳이 소유한다(헤더 클릭·직접 진입 두 호출부가 같은 컴포넌트).
- ⛔ 요금제 이름·가격·"무료" 같은 혜택 단어를 쓰지 않는다(도움말 카탈로그 금칙어와 같은 축). 어느 요금제부터 열리는지는 `/pricing`이 말한다.

### 4-7) 원장

| 테이블 | 역할 |
|---|---|
| `agency_send_requests` | 접수 1건 = 1행. 상태·문안(원문/현재/버전)·요청 시각·담당자·매핑·승인 버전·검사 회차·캠페인 링크·lock |
| `agency_send_recipients` | 수신자 행(phone + vars jsonb). 요청 삭제 시 CASCADE |
| `agency_send_events` | 검사 결과·안내 발송·승인·상태 전이 이력(관리자 화면과 미답 분석용) |

DDL 초안 = §7. 컬럼은 실행 전 `information_schema`로 확정한다.

---

## 5) 6원칙 대응표

| 원칙 | 이 축에서 |
|---|---|
| ① 전수 grep(쓰기 경로까지) | 예약을 만드는 경로는 워커 B 한 곳이고, 그 자리는 직접발송 배관을 부른다. 이 축에 남은 `bulkInsertSmsQueue` 호출은 담당자 안내·테스트 문자(인증 라인) 하나뿐이다(0823 grep 실측). 큐를 지우는 경로는 `cancelCampaign` CT 한 곳 |
| ② 효과 검증 후 성공 표시 | 적재의 효과 검증은 배관이 소유한다(청크별 적재 수 대조 → 미적재분 환불 → `send_phase` 종결). 원장은 그 결과를 워커 D가 따라간다. **이 축이 큐 건수를 따로 세지 않는다** — 세는 자리가 둘이면 판정도 둘이 된다 |
| ③ 이중 진실 = 대조 워커 | 원장 `queued` ↔ `campaigns`(취소·적재 실패) 대조(워커 D). 적재 전에는 진실이 원장 하나뿐이라 대조할 것이 없다(3-3의 효과) |
| ④ 축 변경 = 전 경로 영향표 | §6 |
| ⑤ 실측 1건 | §10 |
| ⑥ 수정 전 승인 | 이 문서 |

---

## 6) 영향표 (기존 파일)

| 파일 | 변경 | 누가 의존하나 |
|---|---|---|
| `components/DashboardHeader.tsx` | 메뉴 "대행발송" 1항목(모든 회사 · 직접발송 옆) · "AI Operator 소개" 제거 · 미허용 클릭 → `AgencySendIntroModal` | 도움말 카탈로그 불변식 2(헤더 메뉴 라벨이 정의에 있어야 한다) → 카탈로그에 `agency-send` 작업 등재. 불변식은 "AI Operator 소개"를 이미 제외하고 있어 제거에 영향 0 |
| `pages/Dashboard.tsx` 푸터 | "AI Operator 소개" 링크 1개 추가(기능 안내 옆) | 없음 |
| `routes/companies.ts` my-plan | `agencySendAllowed` 1필드 | 헤더·페이지 |
| `components/agency/AgencySendIntroModal.tsx`(신규) | §4-8 | 헤더 · `/agency-send` 페이지 |
| `utils/plan-guard.ts` | `canUseAgencySend` 추가(플래그 AND 유료) | 신규 라우트·워커 |
| `routes/admin.ts` · `AdminDashboard.tsx` | 토글 + 현황 탭 | 슈퍼관리자만 |
| `app.ts` | 워커 등록 1줄 | |
| `App.tsx` | lazy 라우트 1개 | 불변식 1(경로 실존) |
| `content/feature-catalog.ts` | 작업 1개 등재(도움말 봇) | 불변식 2 |
| `direct-send` 경로 | **무변경.** 대행발송이 `createDirectSendCampaign`·`countStagingFiltered`를 부르기만 한다(0823 · 라우트 복붙 0) | 직접발송 전체 |
| `utils/send-type-axis.ts`(★0823) | `agency` 등재(`SEND_TYPES` · `DIRECT_PIPELINE_SEND_TYPES` · 라벨 "대행발송") | 결과 동기화(`campaign-lifecycle`) · 후불 청구(`send-usage-aggregation` 2곳) · 발송결과 필터·라벨 · 관리자 화면 · 환불 sweeper 라벨. 기존 행에 `agency`가 0건이라 기존 집계 영향 0 |
| `frontend/utils/campaign-axis.ts`(★0823) | 같은 값 미러(라벨·필터·아이콘·칩) | 발송결과 유형 필터. 불변식 테스트가 백엔드 CT와의 일치를 기계로 확인한다 |
| `utils/agency-send-vars.ts`(신규 ★0823) | 문안 변수 → 주소록 슬롯 번역 | 접수 라우트 · 워커 · 화면 미러(`agency-send-api.ts`) |

---

## 7) DDL 초안 (Harold 실행 · 실행 전 `information_schema` 확정)

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS agency_send_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS agency_send_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  created_by uuid NULL,
  status varchar(24) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','testing','awaiting_approval','test_failed','approved','final_testing','queued','reapproval','expired','cancelled')),
  callback_number varchar(20) NOT NULL,
  message_type varchar(4) NOT NULL DEFAULT 'SMS' CHECK (message_type IN ('SMS','LMS','MMS')),
  subject varchar(60) NULL,
  mms_image_paths jsonb NULL,
  is_ad boolean NOT NULL DEFAULT false,
  original_content text NOT NULL,
  current_content text NOT NULL,
  content_version integer NOT NULL DEFAULT 1,
  requested_at timestamptz NOT NULL,
  manager_phone varchar(20) NOT NULL,
  file_name varchar(200) NULL,
  phone_column varchar(100) NOT NULL,
  var_mapping jsonb NOT NULL DEFAULT '{}',
  recipient_count integer NOT NULL DEFAULT 0,
  test_round integer NOT NULL DEFAULT 0,
  last_test_result jsonb NULL,
  last_test_at timestamptz NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  approval_version integer NULL,
  reapproval_count integer NOT NULL DEFAULT 0,
  final_test_at timestamptz NULL,
  campaign_id uuid NULL,
  queued_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancel_reason varchar(200) NULL,
  expired_at timestamptz NULL,
  lock_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agency_send_requests_company_created ON agency_send_requests (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agency_send_requests_worker ON agency_send_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS agency_send_recipients (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES agency_send_requests(id) ON DELETE CASCADE,
  row_no integer NOT NULL,
  phone varchar(20) NOT NULL,
  vars jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_agency_send_recipients_request ON agency_send_recipients (request_id, row_no);

CREATE TABLE IF NOT EXISTS agency_send_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES agency_send_requests(id) ON DELETE CASCADE,
  kind varchar(32) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agency_send_events_request ON agency_send_events (request_id, created_at DESC);
```

**★2026-08-23 추가 DDL (Codex 적대 검토 반영) · 전부 실행완료**

```sql
ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS dispatch_key uuid;
CREATE INDEX IF NOT EXISTS idx_campaigns_staging ON campaigns (staging_id);
ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS lock_token uuid;
ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS manager_phones text[];
ALTER TABLE agency_send_requests DROP CONSTRAINT agency_send_requests_status_check;
ALTER TABLE agency_send_requests ADD CONSTRAINT agency_send_requests_status_check
  CHECK (status IN ('received','testing','awaiting_approval','test_failed','approved',
                    'final_testing','queued','reapproval','expired','cancelling','cancelled'));
```

- `dispatch_key` = **이번 예약 시도의 식별자.** 캠페인이 이 값을 `staging_id`로 들고 있어, 크래시 뒤 재시도가 같은 시도를 두 번 만들지 않는다. 접수 id를 그대로 쓰면 실패한 시도와 새 시도를 가를 수 없어, 한 번 실패한 건이 재예약해도 옛 캠페인에 영원히 막힌다. 문안 수정·시각 변경이 이 값을 지운다(= 새 시도).
- `idx_campaigns_staging` = 예약 직전 멱등 조회(`campaigns.staging_id`)가 매번 전체 스캔이 되지 않게 한다.
- `revision` = **행 수정 번호.** 담당자 경로의 낙관적 잠금이 이 값 하나를 본다(§12-F).
- `manager_phones` = 담당자 번호 **복수**(Harold 0823). 옛 `manager_phone` 한 칸도 함께 읽어 배포 전 접수가 그대로 동작한다.
- `cancelling` = 취소 중간 상태. 큐를 지운 뒤에만 `cancelled`로 확정한다(§12-F).
- `lock_token` = **워커 소유권 토큰.** 선점 때 발급하고 워커의 모든 쓰기가 조건으로 건다. ⛔ 타임스탬프를 토큰으로 쓰지 않는다.
- 옛 코드는 이 컬럼들을 모르므로 **배포 전에 먼저 실행해도 무해하다**(0822 DDL과 같은 순서). 컬럼 부재 시 라우트는 503, 워커는 조용히 넘어간다.

- `created_by`·`approved_by`에 FK를 걸지 않는다(0728 `23503` 원칙: 계정이 지워져도 기록은 남는다).
- `campaign_id`에 FK를 걸지 않는다(캠페인 정리 워커가 옛 행을 지울 수 있다).
- 컬럼 부재 시 endpoint catch → 503 `DB_MIGRATION_PENDING`(`db_alter_safety_net`).

---

## 8) 확정 사항 (Harold 2026-08-22 승인)

| # | 항목 | 확정 |
|---|---|---|
| 8-1 | AI 다듬기 크레딧 | **0.** `CREDIT_COST_MAP`에 등록하지 않는다(미등록 source = 0, 과금 코드 변경 0). 대행 서비스의 일부이고 고객이 누른 것도 아니다. 기록만 `ai_call_log`에 source `agency-send-refine`으로 남겨 원가를 잰다. ⛔ 무료로 학습된 뒤에는 유료로 못 바꾼다(도움말 봇과 같은 판단) |
| 8-2 | 플래그를 끈 뒤 진행 중인 건 | **약속은 지킨다.** 새 접수·승인만 막고, 이미 승인된 건은 워커가 끝까지 처리한다 |
| 8-3 | 채널 | **SMS·LMS·MMS.** 이미지는 업로드 또는 라이브러리 선택. 카카오·RCS·개별 발신번호는 2단계 |
| 8-4 | 톤 | **인디고(`CUI_*` 콘솔 톤).** 접수 화면·상세·안내 모달 전부. 모달 껍데기 = `components/console/ConsoleDialog`. 오퍼레이터 바이올렛(`OUI_*`)을 쓰지 않는다(이 축은 관리·조회 계열이고 직접발송·고객 DB 업로드와 같은 언어여야 한다) |

**돈이 드는 곳(전액 고객사)**: 스팸 검사 테스트폰 발송 · 담당자 테스트 문자 · 안내 단문 · 본 발송. **0인 곳**: AI 다듬기.

---

## 9) 구현 순서 (단독·순차 · 각 단계 tsc 0 + 테스트)

1. `plan-guard`에 `canUseAgencySend` + my-plan 필드 2개 + 헤더 메뉴(직접발송 옆) + "AI Operator 소개" 푸터 이동 + 미가입 안내 모달(§4-8) + 슈퍼관리자 토글 (작고 되돌리기 쉬운 것부터)
2. 원장 DDL(Harold) + `routes/agency-send.ts` 접수·목록·상세·승인·취소 + 상태 전이 단위 테스트(상태 머신을 순수 함수로 빼서 vitest)
3. 워커 A(1차 검사) + 안내 단문 빌더(기존 빌더 확장) + CT-09 콜백 2종(다듬기·최소 수정) + 혜택 보존 검사
4. 워커 B·C·D·E + 큐 적재(직접발송 CT 순서 그대로) + 효과 검증(재카운트)
5. 프론트 `/agency-send`(목록·접수 3단계·상세·승인) · MMS 첨부 = `MmsUploadModal`·`useMmsUpload` 재사용(업로드 + 라이브러리) · 콘솔 톤 · 커스텀 모달 · 375px
6. 도움말 카탈로그 등재 · 슈퍼관리자 현황 탭 · Codex 적대 검토(쓰기 경로 + DDL이므로 대상) · 실측 1건(§10)

산출물 = 신규 6(CT 1 · 라우트 1 · 워커 1 · 페이지 1 · 테스트 2) · 수정 7(§6) · DDL 3.

---

## 10) 실측 1건 시나리오 (배포 뒤 · 테스트 계정)

1. 슈퍼관리자에서 테스트 계정에 "대행발송" 켬 → 대시보드에 메뉴가 보인다(다른 회사 계정에는 안 보인다).
2. 수신 2건(테스트폰) 텍스트 붙여넣기 · 문안에 `%이름%` · 요청 시각 = 지금 + 3시간 10분 · 담당자 = Harold 번호 → 접수.
3. 5분 안에 담당자 번호로 테스트 문자 + 안내 단문 수신 → 화면에 승인 버튼 활성 → 승인.
4. 요청 시각 2시간 전: 재검사 후 `queued`. 확인 SQL(MySQL 라인 `SELECT COUNT(*) … WHERE app_etc1 = '<campaign_id>'` = 2) · PG `campaigns.status = 'scheduled'`.
5. 요청 시각에 2건 수신 → 발송결과 화면에 표시.
6. 차단 경로: 스팸 단어를 넣은 문안으로 2번 접수 → 1차 차단 → 다듬기 후 통과 문안이 테스트로 온다 · 화면 상세에 원문/최종 대조와 회차가 보인다.
7. 만료 경로: 승인하지 않고 둔 건이 요청 시각 2시간 전에 `expired` + 안내 단문.
8. MMS 경로: 라이브러리 소재 1장을 가져와 접수 → 담당자 테스트 문자가 **이미지 포함 MMS**로 온다 → 승인 → 본 발송도 MMS로 수신. 이미지 0장으로 MMS 접수를 시도하면 접수 단계에서 막힌다.
9. 미끼 경로: 플래그 OFF 계정(미가입 1 · 유료 1)으로 로그인 → 둘 다 헤더에 "대행발송"이 보인다 → 누르면 안내 모달(§4-8) → 미가입은 "요금제 가입하러 가기"가 `/pricing`으로, 유료는 "이용 요청 남기기"가 슈퍼관리자 현황 탭에 기록된다 → 주소로 `/agency-send`에 직접 들어가도 같은 모달 · 쓰기 API는 403.

10. **돈·축 확인(★0823 신설 · 2번에서 이어서).** 예약이 `queued`가 된 직후:
    - `SELECT send_type, send_phase, status, target_count FROM campaigns WHERE staging_id = '<접수 id>';` → **`direct`**(⛔ `agency`가 아니다 — 새 값을 만들면 청구·동기화 축에서 빠진다 · §12) · `sent`(적재 완료 후) · 건수 일치
    - 선불 계정이면 `balance_transactions`에 그 campaign_id로 차감 1행. 후불 계정이면 그 달 거래내역서 수량에 이 건이 들어간다
    - 발송결과 화면 유형이 **"대행발송"**으로 보인다(AI 추천이 아니다)
    - 담당자 테스트 문자와 실제 수신 문자에서 `%이름%` 자리에 **명단의 이름이 들어가 있다**(빈칸이 아니다)
11. **재승인 경로(★0823 신설).** 6번의 차단 문안으로 승인까지 마친 뒤 당일 재검사에서 걸리게 두면, 예약 취소 안내 + 수정 문안 + 재승인 요청 세 통이 오고 **화면에서 승인 버튼이 실제로 눌린다**. 누른 직후 예약이 만들어진다(5분을 기다리지 않는다).

12. **당일 접수 건은 재검사가 없다(★0823(2) 신설 · §14).** 오늘 접수해 **오늘** 나가는 건으로 2~3번을 돈 뒤, 요청 시각 2시간 전 무렵에 확인한다.
    - `SELECT COUNT(*) FROM spam_filter_tests WHERE company_id = '<회사 id>' AND created_at > '<접수 시각>';` → **1차 검사분 그대로**(T-2h에 늘지 않는다)
    - `SELECT status, final_test_at FROM agency_send_requests WHERE id = '<접수 id>';` → `final_test_at`이 **1차 검사 시각**으로 이미 찍혀 있다
    - T-2h에 상태가 `queued`가 되고 캠페인이 생긴다(4번과 같은 확인 SQL)
    - 대조군: **내일** 발송으로 접수한 건은 `final_test_at`이 비어 있고, 내일 T-2h에 검사가 1회 더 늘어난다

당일 차단은 운영에서 강제하기 어렵다. 워커 B의 분기는 vitest(검사 결과 주입)로 고정하고, 운영 실측은 6·7·11로 갈음한다.

---

## 11) 상태·잔여

- **★2026-08-26(3) 이메일 접수(챕터 2) 배포완료 · 워커 가동 실측**(07:45 부팅 로그 "이메일 접수 워커 시작" 확인 · DDL 4종 information_schema 실측 · SCHEMA.md 등재 완료 · ENV 3키). **남은 것 = 운영 실측 7(§18-12 · Harold) + SMTP 발신 curl 실측 + 하이웍스 접속 정책 문의.**
  ⚠ 배포 중 이슈 1건(07:42~07:45 백엔드 재시작 루프): 신규 의존성(mailparser)의 서버 `npm install` 단계를 인계에서 빠뜨려 ts-node 컴파일 실패. 처방 = OPS.md §2-2 2번 실행 + `pm2 restart --update-env`. 재발 방지 = **의존성이 추가된 배포 인계는 OPS.md §2-2 순서 전체를 기준으로 쓴다**(memory 등재).
- **★2026-08-26(2) 코드 완료 · 자체 적대 검토 5R 종결**(결함 0 라운드 도달 · §18-11-1).
- **★2026-08-26 이메일 접수 게이트 실측 완료 · POP3 확정판(§18)**. 실측 = IMAP 미지원(POP3S·USER/PASS·APOP 거부) · Authentication-Results 미부착 → **allowlist_only 확정** · UIDL·TOP 지원.
- **★2026-08-25(9) 이메일 접수 설계 확정 = §18** · Harold 승인. 절차 = COLLAB §1 브레인스토밍(기획·백엔드·프론트엔드·회의론자 · 교차 토론 1R · 회의론자 최종 검증 15건 전부 §18-8 반영). 파서 보강 2건(§18-4 무헤더·0 유실)은 전 입구 공통. BUGS 분리 = B-0825-6·B-0825-7.
- **★2026-08-25(4·5·6) 배포완료** = 문안 항목 AI 매핑(§17-6 · Codex 2R approve) + 명단 미리보기 엑셀 뷰(§17-7) + 헤더 접수 입구 버튼(§15-6). DDL 0. **남은 것은 운영 실측**(§17-6 3항목 · §17-7 1항목).
- **다음 축 = 이메일 접수(챕터 2)**. 요청서를 메일로 받아 자동 접수하는 입구다. 접수 코어(`createRequestCore`)는 이미 입구 셋을 전제로 추출돼 있다(§17-1 표 = 화면 접수 · 원스텝 · **예정된 이메일 워커**). 착수 전 브레인스토밍 1회 조건은 **0825(9)에 이행 완료 · 설계 = §18**. 진입점 = §18-2 구조 표 + `routes/agency-send.ts` `createRequestCore`.
- **★2026-08-25 배포완료** = 화면 개편(§15) · 담당자 링크 승인(§16) · 요청서 원스텝(§17) · 양식 리디자인(§17-5). 남은 것은 **운영 실측뿐**(§16-4 4항목 · §17-4 5항목 · §15 5항목 · Harold 몫). DDL 0.
- **2026-08-22 Harold 설계 승인.** 크레딧 0 · 인디고 톤 · MMS 포함 · 미끼 노출 확정.
- **2026-08-22(밤) DDL 실행완료**(information_schema 4행 실측: 컬럼 1 + 테이블 3). SCHEMA.md 등재 완료.
- **2026-08-23(새벽) §9 6단계 전량 구현 완료.**
- **2026-08-23 `dispatch_key` + `idx_campaigns_staging` ALTER·CREATE 실행완료**(Harold · 배포 전). SCHEMA.md 등재 완료.
- **2026-08-23 배포완료**(Harold). 실측 확인 = 스팸필터 테스트 정상 · 담당자 테스트 문자 수신(1800-8125).
  ⚠→종결 **접수 1건이 "발송 예정"인데 예약내역에 안 잡힌다**(Harold 관측 · §11-4). **설계대로였다** — 0823(2) Harold가 12:00 예약 생성을 실측 확인.
- **2026-08-23 §12 판정·정정 완료.** 의심 3건은 전부 사실이었고, 파고드는 과정에서 같은 자리(적재)에서 배포를 막는 것 다섯 개가 더 나왔다. 정정 내용은 §12.
- **2026-08-23(2) 예약 실측 확인 완료**(Harold, 12:00 정상 생성). §11-4 종결.
- **2026-08-23(2) 당일 접수 건 재검사 폐지**(Harold 지시 · §14).

### 11-1) 만든 것

| 단계 | 산출물 |
|---|---|
| 1 게이트 | `plan-guard`(`canUseAgencySend`·`isActivePaidPlan`·`agencySendEnabled` 폴백) · my-plan `agency_send_allowed` · 헤더 메뉴(직접발송 옆·NEW) · "AI Operator 소개" 푸터 이동 · `AgencySendIntroModal`(인디고) · 슈퍼관리자 토글 |
| 2 원장 | `utils/agency-send-state.ts`(순수 상태 머신) + 테스트 18건 · `routes/agency-send.ts`(목록·접수·상세·승인·문안 수정·시각 변경·취소) |
| 3 다듬기 | `utils/agency-send-refine.ts` + 테스트 15건 · `utils/agency-send-notify.ts`(안내 5종) |
| 4 워커 | `utils/agency-send-worker.ts`(A 1차 검사 · B 당일 재검사+큐 적재 · C 만료 · D 대조 · E lock 복구) · app.ts 등록(5분) |
| 5 화면 | `pages/AgencySendPage.tsx`(목록) · `components/agency/`(Composer 3단계 · Detail 승인 · api 미러) |
| 6 마무리 | 카탈로그 `agency-send` **ready 승격**(실제 화면 기준 steps 6·blockers 3) · 슈퍼관리자 현황 API |

### 11-2) 구현 중 잡은 결함 3건 (자가 발견)

| # | 무엇 | 왜 위험한가 |
|---|---|---|
| 1 | 수신자 3만 건을 INSERT 한 문장에 넣으려 했다 | 행마다 바인드 파라미터 3개 = 9만 개. PostgreSQL 상한 65535를 넘어 **적재가 통째로 실패**한다. 2천 행씩 나눠 넣도록 고침 |
| 2 | 접수 행과 수신자가 다른 트랜잭션이었다 | 중간 실패 시 **수신자 0건짜리 접수**가 남고 워커가 그것을 집는다. 한 트랜잭션으로 묶고 COMMIT 전 건수 대조 추가 |
| 3 | 다듬기 실패 로그에 줄표가 있었다 | 불변식이 잡기 전에 자가 grep으로 발견. 콜론으로 교체 |

### 11-3) 게이트 결과

**0823 정정 뒤 재실행:** 백엔드 tsc 0 · 프론트 tsc 0 · vitest **196파일 2,981건 전부 통과**(신규 45건: 상태 머신 18+6 · 다듬기 15 · 변수 슬롯 11 중 신규 11) · 줄표 불변식 통과 · send_type 축 불변식 통과(프론트 미러 일치) · 변경 파일 자가 grep(모델명 0 · native dialog 0 · 사용자 노출 줄표 0).
(0823 정정 전 1차 구현 시점 = 195파일 2,967건 통과.)

### 11-4) 남은 것 (다음 세션 착수 순서)

**1. ⚠ 예약이 실제로 걸리는지 확인 (최우선 · Harold 2026-08-23 관측)**

접수 1건이 화면에 "발송 예정"(`approved`)인데 **예약내역 0건**이다. 요청 시각 = 2026-08-23 14:00 · 6건 · LMS.

이 상태 자체는 설계상 예상된다 — 승인 시점에는 큐에 넣지 않고 **발송 2시간 전(12:00)에** 워커 B가 예약을 만든다(§3-3). 그러니 12:00 전에 예약내역이 비어 있는 것은 정상이다.
**확인할 것은 12:00에 실제로 만들어지는가**이고, 안 만들어졌다면 어디서 멈췄는가다. 순서대로 본다.

```sql
-- ① 원장이 어디까지 갔나 (status가 queued로 갔는지, dispatch_key·campaign_id가 붙었는지)
SELECT id, status, requested_at, final_test_at, dispatch_key, campaign_id, lock_token, revision, updated_at
  FROM agency_send_requests ORDER BY created_at DESC LIMIT 5;
```
```sql
-- ② 워커가 무엇을 했나 (kind 시간순)
SELECT kind, payload, created_at FROM agency_send_events
 WHERE request_id = '<위 id>' ORDER BY created_at;
```
```sql
-- ③ 캠페인이 생겼나 (근거는 staging_id = dispatch_key)
SELECT id, status, send_phase, send_type, target_count, scheduled_at
  FROM campaigns WHERE staging_id = '<dispatch_key>';
```
그 뒤 MySQL 큐에서 `app_etc1 = '<campaign id>' AND status_code = 100` 건수를 센다.

**멈출 수 있는 자리(코드 기준)**: ⓐ `isFinalTestDue` 창에 안 들어옴 ⓑ 스팸 재검사가 걸려 `reapproval`로 감 ⓒ `createDirectSendCampaign`이 거절(잔액·야간 광고 제한·회신번호) → 이벤트 `dispatch_rejected` ⓓ 수신거부·중복 제외 후 0건 → `dispatch_zero_after_filter` ⓔ 워커가 아예 안 돌았다(pm2 로그 `[agency-send][worker]`).

⛔ **원장이 `queued`인데 예약내역이 비어 있으면 그때가 진짜 결함이다.** 그 경우 §12-F 대조 워커가 왜 못 잡았는지까지 본다.

2. **발송결과 표시 확인** — 발송 시각 뒤 발송결과 화면에 그 건이 뜨는가. `send_type='direct'`로 적재되므로 유형은 "직접발송"으로 보인다(정산·집계는 기존 경로 그대로).
3. **담당자 복수 실측** — 번호 2개를 넣어 접수하고 둘 다 테스트 문자를 받는가.
4. **당일 차단 경로 실측** — 스팸 단어를 넣어 재검사에서 걸리게 하고, 안내 → 2차 문안 변형 → 재승인 → 예약까지 도는가.
5. 슈퍼관리자 현황 **화면**(API만 만들었다) = 추가 과제
6. `campaign_send_staging` SCHEMA.md 등재 = 추가 과제
7. **구조 단순화 검토**(Harold 2026-08-23 지적) = 추가 과제. 지금 복잡도의 대부분은 "예약을 워커가 만든다"에서 나온다. 직접발송처럼 **승인할 때 예약을 만들면** 소유권 토큰·행 수정 번호·시도 키·대조·취소 마무리가 대부분 필요 없어진다. 실측 결과를 보고 판단한다

---


## 12) 자가 발견 3건 판정과 정정 (2026-08-23 · 완료)

의심 3건은 **전부 사실**이었다(근거 = 소스 실측). 고치는 과정에서 같은 자리인 예약 적재에서 배포를 막는 것 다섯 개가 더 나왔다. 뿌리는 둘이라 항목별로 때우지 않고 그 둘을 고쳤다.

### 12-A) 뿌리 1: 예약을 만드는 자리가 배관 계약을 통째로 안 지켰다

`queueForSend`가 캠페인 행을 직접 만들고 큐에 직접 넣었다. 그 자리에 직접발송 배관이 가진 것이 하나도 없었다.

| # | 무엇 | 근거 | 결과 |
|---|---|---|---|
| 1 | 부분 적재가 남는다(옛 §12-1) | `bulkInsertSmsQueue`는 batch 단위로 예외를 삼키고 계속한다(`sms-queue.ts` "실패 batch는 미집계") | 원장은 실패인데 적재된 일부가 요청 시각에 나간다 |
| 2 | 재시도가 한 벌 더 만든다 | 적재 뒤 카운트가 던지면 catch가 `approved`로 되돌리고, 창이 남아 있으면 다시 잡는다. 멱등 키가 없었다 | 이중 발송 |
| 3 | 선불 차감이 없다 | 대행발송 3파일에 `prepaidDeduct` 0건 | 잔액 확인도 차감도 없이 발송 |
| 4 | 정산 축 | **★ 판정 정정(Harold 2026-08-23).** 처음에 `send_type='agency'`라는 **새 값을 만든 것이 잘못**이었다. 새 값은 청구·동기화 축에 없으니 "빠진다"가 되고, 넣으려면 정산 CT를 건드리게 된다. **대행발송은 직접발송 배관을 그대로 타므로 `'direct'`로 적재하면 기존 경로가 그대로 돈다.** `agency` 값은 전량 되돌렸고 정산 코드는 한 줄도 바뀌지 않았다 | 원복 완료 |
| 5 | 담당자 테스트 문자가 어느 계정에도 안 잡혔다 | 인증 라인으로 나가 `app_etc1='test'`·`bill_id`가 없었다(옛 자동발송 워커와 같은 방식). 집계는 그 둘로 계정을 가른다 | 기존 테스트발송 CT(`insertTestSmsQueue`)로 옮겨 **접수자 ID(`bill_id`)로** 잡히게 했다 |
| 6 | 변수가 전부 빈 문자열로 나간다 | 치환 CT는 값을 DB 컬럼 이름으로 찾는데(`customer[mapping.column]`) 워커는 문안 변수명을 키로 넘겼다 | `%이름%님` → `님` |
| 7 | 수신거부를 안 뺀다 | 직접발송은 적재 직전 제외 | 수신거부자에게 발송 |

⛔ **정산은 "누구 ID로 나갔나"로 이미 굴러간다**(Harold 2026-08-23). 요금제 업체는 정액으로 고객사 관리자에 들어가고, 하위 계정의 스팸필터 테스트·담당자 테스트·실제 발송은 각 ID로 잡힌다. 통합 발행이면 하위 사용량을 합쳐 보여주고 계정별 발행이면 그 ID 것만 보여준다.
**대행발송은 그 업체·그 사용자 ID로 나가는 것을 대신 눌러 주는 것뿐이라 정산에 새로 할 일이 없다.** 새 축을 만들면 그때부터 정산을 건드리게 된다 — 만들지 마라.

**정정** = 적재를 손으로 하지 않는다. `campaign_send_staging` 적재 → `createDirectSendCampaign(sendType: 'agency')` → 그 뒤는 배관이 소유한다(§4-4 예약 위임). `send-type-axis` CT에 `agency`를 등재해 결과 동기화·환불·청구 세 축에 합류시켰다. 변수는 주소록 슬롯으로 번역한다(불변 4).

### 12-B) 뿌리 2: 시각 상수 하나가 뜻 셋을 겸했다

`FINAL_TEST_LEAD_MINUTES` 120분이 승인 마감·재검사 시작·적재 여유를 동시에 뜻했다.

- **재승인이 구조적으로 불가능했다(옛 §12-2).** `reapproval`은 정의상 2시간 미만이 남은 때 생기는데 승인이 2시간을 요구했다. 승인 버튼은 100% 거절됐고, 더 나쁘게는 만료 판정이 `reapproval`을 그대로 잡아 **재승인 안내 문자를 보낸 다음 tick(최대 5분)에 "승인이 없어 발송되지 않았습니다"가 갔다.**
- **승인된 건이 창을 놓치면 어디에도 안 걸렸다(옛 §12-3).** 재검사 창은 10분뿐이고 만료 판정은 `approved`를 보지 않았다. 발송도 만료도 안내도 없었다.

**정정** = 필요한 리드타임을 상태가 정한다(`requiredLeadMinutes`). 재검사 창을 없애고 단조 조건으로 바꿨다. 만료 대상에 `approved`를 넣고 안내 문장을 사유별로 나눴다. 승인 라우트가 워커를 즉시 깨운다. 재검사 대상과 만료 대상이 겹치지도 비지도 않는 성질을 테스트가 1분 단위로 고정한다.

### 12-C) Codex 적대 검토 (2026-08-23 · 1~6라운드)

Harold 지시로 "지적이 안 나올 때까지" 돌렸고 6라운드에서 멈췄다. **지적 수가 줄지 않았고, 그 이유는 4라운드부터 내가 고치면서 새 결함을 만들었기 때문이다.**

| 라운드 | 지적 | 무엇이었나 |
|---|---|---|
| 1R | critical 2 · high 3 | **실제 결함.** 취소가 워커 선점을 덮어 화면은 취소·큐는 발송(0611 재현) · 시도 식별자 부재 · 후보 SQL 하한 부재 · 제목 변수 |
| 2R | critical 3 · high 3 | **실제 결함.** 그중 1건은 내가 1R 고치며 만든 것(타임스탬프를 소유권 토큰으로 → 왕복 정밀도가 안 맞아 정상 소유자도 0행) |
| 3R | critical 2 · high 2 | 절반이 내 회귀(`RETURNING`을 옛 상태로 착각한 취소 되돌리기) |
| 4R | critical 1 · high 4 · medium 1 | 대부분 동시성 경합 |
| 5R | critical 3 · high 2 | **전부 내가 4R 고치며 만든 것**(TOCTOU를 없애려 토큰을 뺐더니 소유권이 깨졌다) |
| 6R | critical 3 · high 1 · medium 1 | **전부 내가 5R 고치며 만든 것** |

**1~3라운드의 실제 결함은 전부 닫혔다.** 4라운드 이후 지적은 "이 밀리초에 프로세스가 죽으면" "두 tick이 겹치면" 류이고, 원장(PG)과 큐(MySQL)에 걸친 원자성이 없는 한 리뷰로는 0이 되지 않는다.

**6라운드에서 조건을 더 붙이는 대신 판정 근거를 하나로 줄였다**(§12-F). 그래도 남는 경합은 접수가 있어야 발현하고, 이 축은 슈퍼관리자 플래그로 잠겨 있다.

### 12-F) 근거를 하나로 줄인 구조 (6라운드 대응)

전에는 원장이 `campaign_id`를 들고 캠페인과 **연결**해야 했다. 생성과 기록이 서로 다른 순간에 일어나므로 그 사이의 모든 조합(크래시·소유권 상실·취소 경합·복구·중화 실패)을 조건으로 막아야 했고, 막을 때마다 새 조합이 생겼다.

지금 근거는 하나다: **캠페인이 `staging_id`로 접수의 시도 키(`dispatch_key`)를 들고 있다.**

- 시도 키는 캠페인을 만들기 **전에** 원장에 적힌다 → "만들었는데 아무도 모르는" 캠페인이 없다.
- 원장의 `campaign_id`는 **화면 표시용 캐시**다. 비어 있어도 판정이 흔들리지 않는다.
- 연결·고아 판정·중화 재시도 장치가 사라지고, 그 자리를 **대조(워커 D) 한 곳**이 대신한다.
  대조는 **종결 상태까지** 훑는다 — 늦게 태어난 캠페인은 접수가 끝났든 말든 나가기 때문이다. 실패해도 다음 tick이 다시 한다.

동시성 소유권은 두 축뿐이다.

| 축 | 누가 쓰나 | 무엇을 막나 |
|---|---|---|
| `revision` | 담당자 경로(승인·문안 수정·시각 변경·취소) | 화면이 본 값과 다르면 거절. 시각만 바뀐 건도 잡혀 **못 본 시각으로 승인이 성립하지 않는다** |
| `lock_token` | 워커 경로 전부(검사 결과 저장 포함) | 소유권을 잃은 핸들러가 남의 상태를 덮지 못한다 |

⛔ **타임스탬프를 소유권 토큰으로 쓰지 마라** — PG는 마이크로초, 드라이버는 밀리초라 왕복에서 어긋나 정상 소유자도 0행이 된다(memory `feedback_no_timestamp_as_fencing_token`).

취소는 원장(PG)과 큐(MySQL) 두 곳을 건드리는 다단계 작업이라 `cancelling` 중간 상태를 지난다. 큐를 지운 뒤에만 `cancelled`로 확정하고, 지우지 못하면 옛 상태로 되돌아가며, 프로세스가 죽어 남으면 워커 F가 이어받는다.

### 12-G) 이 축을 다시 손댈 때 지켜야 하는 계약

1. **이 축은 큐에 직접 넣지 않는다.** 넣는 것은 담당자 안내·테스트 문자뿐이다.
2. **새 발송 경로를 만들면 `send-type-axis`에 먼저 등재한다.** 안 하면 기본값 `'ai'`로 적재되어 세 축에서 사라진다.
3. **`final_test_at`은 스위치다.** 문안·시각이 바뀌면 반드시 지운다. 남아 있으면 검사 없이 나간다.
4. **멱등의 근거는 `campaigns.staging_id`다.** 원장의 `campaign_id`는 나중에 적히므로 근거가 못 된다.
5. **문안 변수는 네 개까지다.** 접수에서 막는다.
6. **승인 버전은 적재 직전에 다시 본다**(`isApprovalCurrent`). 라우트에만 두면, 워커가 문안을 다듬은 뒤 상태 전이가 실패해 되돌아간 경로로 **담당자가 못 본 문장이 적재까지 간다**. 게이트는 효과가 만들어지는 함수 안에 있어야 한다.
7. **소유권은 두 축뿐이다**(★0823 Codex 1R·2R critical). 담당자 경로 = 화면이 본 **`revision`**, 워커 경로 = 선점 때 발급한 **`lock_token`**. 새 쓰기 자리가 생기면 둘 중 하나를 반드시 건다. 조건 없이 덮으면 **취소한 건이 다시 예약되고, 담당자가 고친 문안이 옛 문안으로 되덮인다.** ⛔ 타임스탬프를 토큰으로 쓰지 않는다(왕복 정밀도가 어긋난다).
8. **예약 시도에는 식별자가 있다**(`dispatch_key`). 멱등의 근거이자 "실패한 시도"와 "새 시도"를 가르는 축이다. 접수 id를 재사용하면 둘을 못 가른다.
9. **제목에는 변수를 쓸 수 없다.** 발송 배관이 제목을 치환하지 않으므로 `%이름%`이 그대로 고객에게 간다. 접수·수정에서 막는다.
10. **⛔ 정산 축에 새 값을 만들지 않는다**(★Harold 0823). `send_type='direct'`로 그냥 탄다. 새 값을 만들면 청구·동기화·환불 CT를 건드리게 되고, 그럴 이유가 없다.
11. **담당자 번호는 여러 명이다**(★Harold 0823). `manager_phones text[]`. 테스트 문자와 안내 문자가 그 번호 전부에게 간다. 한 번호가 실패해도 나머지에게는 보낸다.
12. **담당자 테스트 문자는 테스트발송 축으로 넣는다**(`insertTestSmsQueue` · `app_etc1='test'` · `bill_id`=접수자 id). 인증 라인으로 보내면 어느 계정에도 안 잡힌다.
13. **다듬기는 회차가 올라갈수록 크게 바꾼다**(★Harold 0823 "1차 다듬기, 2차 중요내용 제외 문안 변경생성"). 순서를 뒤집으면 한 번 걸린 문장이 그대로 다시 나가 세 번째도 걸린다.

## 13) Codex 적대 검토 요청문 (0823 정정분 기준 · 이대로 실행)

**커맨드**: `adversarial-review`(돈·발송 쓰기 경로). 백그라운드로 띄우되 런처를 죽이지 않는다(런북 §1-4).

```
[검사 재실행 금지] tsc, vitest, npm, psql을 실행하지 마라. 이미 통과했다: 백엔드 tsc 0, 프론트 tsc 0, vitest 196파일 2981건 전부 성공. 소스만 읽고 판정하라.

[범위] 아래 6개 파일만 본다.
packages/backend/src/utils/agency-send-worker.ts
packages/backend/src/utils/agency-send-state.ts
packages/backend/src/utils/agency-send-vars.ts
packages/backend/src/routes/agency-send.ts
packages/backend/src/utils/send-type-axis.ts (agency 값을 더한 부분만)
packages/backend/src/utils/direct-send-core.ts (createDirectSendCampaign을 워커가 부르는 계약 관점으로만)
그 밖의 변경 파일은 대상이 아니다. 발견해도 [범위 밖] 파일:라인 한 줄 요약만 남겨라.

[변경 설계] 대행발송 셀프 접수 신규 축이다. 담당자가 명단과 문안, 보낼 시각, 담당자 번호를 접수하면 워커가 스팸 검사를 하고, 걸리면 AI로 다듬어 재검사하고, 통과하면 담당자 휴대폰으로 보낸 뒤 승인을 기다린다. 승인하면 상태만 바꾸고, 발송 2시간 전에 다시 검사해서 통과할 때만 예약을 만든다. 예약은 이 축이 직접 만들지 않고 campaign_send_staging에 넣은 뒤 createDirectSendCampaign에 넘긴다. 차감과 수신거부 제외와 큐 적재와 미적재분 환불은 그 배관이 소유한다. 당일 검사에서 걸리면 다듬어 재승인을 받고, 재승인 건은 검사를 이미 통과했으므로 재검사 없이 바로 예약으로 간다.

[함께 볼 지점]
1. dispatchToPipeline이 예약을 만드는 유일한 자리다. 캠페인을 만들기 전에 campaigns.staging_id로 앞선 시도를 찾아 멱등을 잡는다. 프로세스가 어느 지점에서 죽어도 같은 발송이 두 벌 만들어지는 경로가 남아 있는가. 특히 createDirectSendCampaign이 캠페인을 지우는 분기와 중화하는 분기 각각에서 재시도가 어떻게 되는지 보라.
2. 워커 B가 approved 건을 final_testing으로 선점할 때 UPDATE 조건에 status = approved를 넣는다. 재검사 갈래와 재검사 없이 예약만 하는 갈래가 같은 선점을 쓰는데, 두 갈래가 같은 건을 동시에 잡거나 서로 놓치는 경로가 있는가.
3. final_test_at은 지금 문안이 당일 검사를 통과했다는 표시다. 워커가 적고 문안 수정과 시각 변경 라우트가 지운다. 이 값이 남아 있는데 문안이나 시각이 바뀌어 있는 상태를 만들 수 있는 경로가 있는가. 있으면 검사 없이 발송된다.
4. requiredLeadMinutes가 승인 판정과 만료 판정 양쪽의 기준이다. 승인은 되는데 워커가 안 잡는 구간, 또는 승인이 거절되는데 만료도 안 되는 구간이 남아 있는가.
5. agency-send-vars.ts는 문안 변수를 주소록 슬롯 네 칸으로 번역한다. 접수 때 저장한 값과 발송 때 뽑는 값이 어긋나는 경로가 있는가. 특히 문안을 고쳐 변수 순서가 바뀐 경우를 보라.
6. send-type-axis에 agency를 더해 결과 동기화와 후불 청구 집합에 합류시켰다. 이 값이 기존 direct와 operator 행의 처리에 영향을 주는 경로가 있는가.
```

**종료 조건**: `critical`·`high` 0이면 끝. `medium` 이하는 이 문서에 등재만. **라운드 최대 2회**.
**2라운드부터**는 1라운드에 고친 줄과 그 직접 호출부만 본다(범위를 내가 파일·줄로 먼저 명시).

- 2026-08-22 설계 확정 대기(Harold 답 4건 반영: 재승인 필수 · 변수 치환+컬럼 맞추기 · 비용 전액 고객사 · 허용 시간 안만). 같은 날 **MMS 포함 확정**(이미지 업로드 또는 라이브러리 선택 · 불변 10 · DDL `mms_image_paths`) · **플래그 OFF 뒤 진행 건은 끝까지 처리**(Harold "끌 일 없다" + 동의) · **메뉴 = 직접발송 옆 · "AI Operator 소개" 푸터 이동** · **메뉴는 모든 회사에 보이는 미끼, 플래그 OFF·미가입은 안내 모달 + 요금제 가입 버튼**(§4-8 · Harold "대행발송을 미끼로 하기로 했다").
- 다음 = Harold 승인 → §8 답 → DDL → §9.

---

## 14) 당일 접수 건은 같은 날 두 번 검사하지 않는다 (2026-08-23(2) · Harold 지시)

> Harold 원문: "오늘 대행발송예약을 했으면 오늘은 스팸필터테스트를 성공한거였잖아. 당일에 대행예약을 한걸 당일 발송시각 2시간전에 스팸필터테스트를 또 할 필요는 없어. 오늘 대행예약을 했는데 내일 발송이면 내일은 발송 2시간전에 테스트를 하는게 맞고."

### 14-1) 무엇이 문제였나

`final_test_at`(발송일 당일 검사 통과 표시)을 **워커 B만** 켰다. 접수 검사가 발송일 당일에 통과해도 켜지지 않아, 같은 문안이 같은 날 두 번 검사됐다. 값 하나가 덜 켜졌을 뿐인데 결과는 셋이다.

| 새는 것 | 내용 |
|---|---|
| 돈 | 테스트폰 발송이 한 번 더 나간다(통신사 실트래픽. 이 경로는 `skipPrepaid: true`라 고객사 차감은 아니다 · §14-7) |
| 신뢰 | 통신사 결과가 흔들려 **담당자가 이미 승인한 문안**이 차단으로 뒤집힌다 → 재승인 왕복 |
| 시간 | 승인 마감이 T-2h로 묶인다. 하지도 않을 검사가 이유였다 |

### 14-2) 고친 자리 (판정은 그대로 · 스위치를 켜는 자리만 늘렸다)

| # | 자리 | 내용 |
|---|---|---|
| 1 | `agency-send-state.ts` | `kstDateKey`·`isSameKstDay` 신설(순수). ⛔ **UTC 날짜로 세면 안 된다** — KST 09시 이전은 UTC로 전날이라 아침 접수·저녁 발송이 "다른 날"로 잡힌다 |
| 2 | 워커 A | 1차 검사 **통과 분기 안에서** 통과 시각이 발송일과 같은 날이면 `final_test_at`을 상태 전이와 같은 UPDATE로 찍는다. 비교와 저장에 **같은 한 시각**을 쓴다(따로 찍으면 자정 경계에서 갈린다) |
| 3 | `requiredLeadMinutes(status, finalTested)` | 당일 검사가 끝났으면 10분. 승인 라우트·만료 워커가 **같은 인자로** 부른다 |
| 4 | 시각 변경 라우트 | 새 시각이 그 검사와 같은 날이면 `final_test_at`을 남긴다. `received`로 돌아가는 건은 조건 없이 지운다 |
| 5 | 문구 | `checkApproval` 거절 사유 · `finalTestRequired` 응답값 · 상세 안내 · 소개 모달 · 접수 폼 힌트 · `final_testing` 라벨("발송 준비 중" = 재검사·적재 셋 다 참) |

`isFinalTestDue`·`isQueueDue`는 **한 줄도 고치지 않았다.** 이미 `final_test_at`으로 갈리고 있었다.

### 14-3) 버린 길 (⛔ 다시 꺼내지 마라)

`last_test_at`(마지막 검사 **시도** 시각)으로 같은 날을 판정하는 길. 그 값은 차단된 회차에도 갱신된다. 워커 B에서 재검사가 차단된 뒤 알림 단계에서 예외가 나 `approved`로 되돌아간 건이 "당일 검사 통과"로 오판돼 **차단된 문안이 검사 없이 예약된다.** 통과에만 찍히는 값은 `final_test_at` 하나뿐이다.

### 14-4) 바뀌지 않은 것

- **예약 생성 시점은 그대로 발송 2시간 전.** 상한은 워커 후보 SQL(`requested_at <= NOW() + INTERVAL '2 hours'`)이 들고 있다. 0823 12:00 실측 동작 그대로다.
- 접수 최소 리드타임 180분 · 다른 날 발송의 T-2h 재검사 · `send_type` · 정산 축 · DDL 없음.

### 14-5) 부수 효과 (의도됨)

같은 날 건의 **승인 마감이 T-2h → T-10분**으로 늦춰진다. 재검사가 없어지면 2시간을 잡아 둘 근거가 없다.

### 14-6) 이번 축 밖으로 뺀 것 (소유 = BUGS.md)

Codex 적대 검토가 올린 4건은 **전부 당일 재검사 폐지와 인과 없는 기존 부채**이고, 뿌리도 하나다: **"판정하지 못했다"를 "반대로 판정했다"로 읽는다.** 이번 접수 축이 아니라 버그 원장으로 넘겼다.

**→ [B-0823-1](../status/BUGS.md)** (가) 통과 판정이 `!== 'blocked'` (나) 다듬기 API 장애를 내용 반려로 취급 (다) 만료 후보가 `LIMIT`보다 늦게 걸림 (라) 승인 마감을 애플리케이션 시각으로만 봄.

⛔ **한 번 시도했다가 되돌린 길**: (가)만 고치려고 `error` 결말을 새로 만들어 잡기 전 상태로 되돌리게 했더니, 픽커가 `ORDER BY created_at LIMIT 5`라 **꾸준히 실패하는 다섯 건이 전 고객사의 매 tick을 독점**했다. 실패 처리만 조각으로 바꾸면 더 나빠진다 — 착수 시 주의사항까지 B-0823-1이 소유한다.

### 14-7) 추가 과제 (착수 안 함)

같은 날 접수의 최소 리드타임 180분 단축 · 승인 즉시 예약 생성(구조 단순화, 기존 등재분) · **검사 재시도 상한과 `received` 만료**(§14-6) · **스팸 검사가 `skipPrepaid: true`로 나간다** — 불변 5는 고객사 차감이라 적고 있는데 이 경로는 무과금이다. 어느 쪽이 맞는지 Harold 확인 필요(범위 밖 · 이번에 안 건드렸다).

## 15) 고객 화면 개편 (2026-08-25 · Harold "허접하다, 디자인·편의성 개선" · 목업 승인 후 구현 완료)

경위: Harold가 목록·접수 모달 실화면을 보고 개선 지시. 규약대로 **버리는 HTML 목업(시안 A~D)** 을 먼저 승인받았고("가장 베스트 추천안으로, 모달 답답하지 않게"), 접수 1단계에 **AI 자동 매핑**을 넣으라는 지시가 목업 단계에서 추가됐다. 톤은 기존 인디고 콘솔(CUI_) 유지, 구성만 바꿨다.

| # | 축 | 구현 |
|---|---|---|
| 1 | 목록 = 진행판 | 접수마다 6단계 진행 레일(접수, 문안 검사, 담당자 문자, 승인, 예약, 발송). 상태-레일 변환은 `railFor` 하나가 소유(`agency-send-api.ts`). 종결 건의 "어디까지 갔었나"는 성공 스탬프(approvedAt·queuedAt)로만 되짚는다(시도 시각 판정 금지 원칙의 표시판) |
| 2 | 지금 할 일 카드 | 승인 대기 건을 문안 미리보기·담당자 수·발송 예정 시각과 함께 최상단 카드로. 목록의 유일한 사용자 행동(승인)을 전면에 |
| 3 | 재접수 | 취소·미발송 건에 "같은 내용으로 다시 접수". 명단은 신규 **읽기 전용** `GET /api/agency-send/:id/recipients`로 받고, 새 접수는 기존 `POST /`를 그대로 탄다. ⛔ 서버 복제(clone) 쓰기 경로를 만들지 않았다(검증·트랜잭션·적재 대조가 접수 한 곳에 있어야 한다). 이미지 문자였던 건은 이미지만 재첨부 안내 |
| 4 | 접수 모달 개편 | 960px 2단 + 단계 표시줄. 1단계 = 드래그 업로드 + **AI 자동 매핑**(기존 `POST /api/upload/ai-map-columns` 재사용, 전화번호 열 자동 인식, 실패·요금제 밖이면 기존 추정 규칙 폴백·접수 안 막음) + 명단 미리보기 + 제외 집계(중복·형식 오류). 2단계 = 항목 칩(누르면 문안에 %열% 삽입) + **폰 미리보기**(수신자 값 치환·광고 표시·수신자 넘기기, 못 채운 항목은 붉게). 3단계 = 시각 후보 칩 + 담당자 번호 칩(Enter 추가) + "접수하면 이렇게 진행됩니다" 5단계 예고. 상세 모달 680→780px |

**서버 계약 무변경**: 접수 payload·검증 규칙·상태머신·워커 전부 그대로. 백엔드 추가는 읽기 전용 endpoint 1개뿐(돈 이동 0 · DDL 0 → 0825 개정 룰 기준 Codex 대상 아님).

### 15-6) 헤더 접수 입구 두 버튼 (2026-08-25(6) · Harold "요청서로 접수가 너무 밋밋하다" · 시안 A 승인 후 구현)

**문제 = 위계가 뜻과 반대였다.** 요청서 쪽이 회색 테두리 보조 버튼이라 "덜 중요한 것"으로 읽혔는데, 이 화면이 파는 길(헤더 문구 "양식만 채우면, 나머지는 한줄로가 합니다")이 바로 그쪽이다.

버리는 HTML 목업 3종(A 나란한 두 문 · B 한 덩어리 세그먼트 · C 요청서가 주인공)을 먼저 보이고 **A 승인**. 구현 = `AgencySendPage.tsx` 안 `EntryButton`(로컬 표시 컴포넌트 · `ProgressRail`과 같은 선례).

- 두 버튼이 **같은 뼈대**를 쓰고 표면만 갈린다: 28px 아이콘 칸 + 제목 + 한 줄 설명("파일 2개면 끝납니다" / "직접 입력합니다").
- 요청서 = 흰 바탕 + 인디고 테두리 + 인디고 아이콘 칸 · 새 접수 = 인디고 채움 + 흰 아이콘 칸. 그림자는 offset+blur를 갖는다(무offset 광배 금지).
- 좁은 화면(sm 미만)에서는 설명 줄을 접고 아이콘과 제목만 남긴다. 높이 44px = 터치 표적.
- ⛔ **새 색을 만들지 않았다** — 인디고 계열만(바이올렛은 AI 화면 색). 뱃지·라벨도 안 붙였다(정가 과금 코어 = 무라벨).

기각 사유 기록: B는 붙은 두 칸이 "화면 전환 스위치"로 읽혀 실제 동작(창 열기)과 어긋나고, C는 밋밋함이 직접 입력 쪽으로 옮겨 갈 뿐이며 양식을 아직 안 받은 첫 사용자에게 막다른 길을 먼저 보인다.

게이트 = frontend tsc 0 · UI 토큰·줄표 불변식 11건 통과 · 기계 검출기 1건은 오탐(흰 버튼의 `text-neutral-900`을 칩의 `bg-indigo-50`과 짝지어 읽은 것 · 실측 대비 15:1). 실측 = 헤더에서 두 버튼이 나란히 보이고, 모바일 폭에서 설명 줄이 접히는가.

바뀐 파일: `pages/AgencySendPage.tsx` · `components/agency/AgencySendComposer.tsx`(전면) · `agency-send-api.ts`(railFor·formatWhenRelative·fetchAgencyRecipients·aiGuessPhoneColumn 추가) · `AgencySendDetail.tsx`(폭만) · `routes/agency-send.ts`(recipients GET).
게이트: 프론트 tsc 0 · 백엔드 tsc 0 · vitest 198파일 3,016건 · vite build 성공(AgencySendPage 청크 실존 확인).

**배포 후 실측 5**: ①목록에서 각 상태의 레일이 맞게 그려지는가(승인 대기 건이 최상단 카드로 뜨는가) ②취소 건 "같은 내용으로 다시 접수"가 명단·문안·담당자까지 채워 열리는가, 접수하면 새 건이 정상 파이프라인을 타는가 ③파일 업로드 시 전화번호 열이 자동 인식되는가(요금제에 AI 매핑 없는 계정은 조용히 폴백) ④2단계 폰 미리보기가 첫 수신자 값으로 치환되고 수신자 넘기기가 되는가 ⑤375px에서 레일이 숨고 목록·모달이 깨지지 않는가.

## 16) 담당자 링크 승인 (2026-08-25(2) · Harold "링크 던져주고 승인버튼, 승인한 번호로 감사로그" · **배포완료** · Codex 적대 2R)

경위: 승인의 마찰 = 문자는 폰으로 받는데 승인은 PC 로그인. 담당자 안내 문자에 승인 주소를 실어 폰에서 바로 승인하게 한다. 승인 없는 발송 0 불변은 그대로다(입구가 하나 늘었을 뿐).

### 16-1) 구조

| 조각 | 소유 | 내용 |
|---|---|---|
| 토큰 | `utils/agency-send-link.ts` | 서명 토큰(전용 파생 키 · HS256 고정 · exp 필수). payload = 접수 id + 담당자 번호 + **문안 버전(cv)**. 만료 = 발송시각+24h와 7일 중 긴 쪽. 주소는 `#t=`(fragment) — 서버·프록시 로그와 Referer에 안 남는다. **담당자 번호 목록 판정(`agencyManagerPhones`)도 이 CT 한 벌**: 배열 우선 · 배열 비었을 때만 옛 컬럼 폴백 · 정규화(워커·라우트·승인 CT 공용) |
| 승인 효과 | `utils/agency-send-approve.ts` | **한 트랜잭션**: FOR UPDATE → 판정(상태·revision CAS · 링크면 담당자 실재+cv 재검증, 화면이면 company_id를 SELECT·UPDATE 양쪽에) → 전이 → **이력 INSERT(실패 시 승인째 롤백)** → COMMIT → 워커 즉시 기동. 이력 payload = via·phone·ip·ua(링크 승인은 approved_by NULL이라 이력이 유일한 귀속 근거) |
| 공개 API | `routes/agency-approve.ts` | 무인증 GET `/info` · POST `/approve`. 토큰은 **X-Agency-Approve-Token 헤더로만**(URL이면 요청 로그에 bearer가 남는다). 무효는 전부 같은 404 |
| 문자 | `agency-send-notify.ts` + 워커 3분기 | 승인 요청·재승인·승인버전 불일치 복구까지 **담당자마다 자기 주소**. 링크는 통지 직전 신선한 cv로 서명(`freshLinkFields`). 승인버전 불일치 분기도 실물 테스트 문자를 먼저 보낸다(2R 정정) |
| 화면 | `pages/AgencyApprovePage.tsx` + App.tsx `/agency-approve`(인증 X) | 모바일 1열: 문안·시각·건수·발신번호 + 승인 버튼 1개. 명단 미노출. 409·400은 최신 상태 재조회로 흡수. 상세 이력에 "문자 속 주소에서 승인했습니다 (담당자 번호)" 표기 |

DDL 0. 로그인 승인 라우트는 같은 CT를 타도록 교체(계약 동일 · 동시 승인 패자는 종전대로 409).

### 16-2) Codex 적대 2R 요약

1R(high 6·medium 1): 토큰 URL 운반(로그 노출) · cv 미바인딩 · 이력 비트랜잭션 · CAS 회사조건 탈락 · 담당자 목록 판정 두 벌 · JWT 폴백 · 재승인 분기 링크 누락 → 위 구조로 전부 정정(폴백은 부분: 파생 키+HS256 고정+exp 필수+경고, **전역 JWT_SECRET 필수화는 별건 = BUGS B-0825-2**).
2R(high 3·medium 1): fragment 운반+no-referrer 정정 · 승인버전 불일치 분기 실물 선행 정정 · 409 계약 복원 정정. **1건 불수용 = 아래 수용 위험 ②.**

### 16-3) 수용한 위험 (명시)

1. **폰 소지 = 승인 권한.** 접수자가 지정한 담당자 번호로 간 문자의 링크를 쥔 사람이 승인자다(로그인 겹이 빠진다). Harold 2026-08-25 수용. 감사는 이력의 via·phone·ip가 진다.
2. **시각만 바뀐 접수는 옛 링크가 계속 유효하다**(Codex 2R high 불수용). 시각 변경은 새 문자가 안 나가므로 링크를 죽이면 담당자가 승인할 길이 없다. 방어 = 페이지가 항상 **현재** 시각·문안을 보여주고 그 revision으로 CAS 승인(보는 것 = 승인하는 것). 문안이 바뀌면 cv 불일치로 옛 링크는 죽는다. 남는 것은 "유출된 옛 링크로 새 시각을 보고 승인"인데 이는 ①의 전제 안이다.
3. 토큰이 남는 곳은 그 폰의 브라우저 기록뿐(fragment라 서버로 안 감). 국외 차단 미적용(해외 출장 승인 허용) · IP는 이력에 기록.

### 16-4) 배포 후 실측 4

①새 접수 → 담당자 문자에 주소가 오고, 폰에서 열어 승인 → 목록 상태 전이 + 상세 이력에 "문자 속 주소에서 승인 (담당자 번호)" ②같은 링크 다시 열면 "승인되었습니다" 화면(중복 승인 없음) ③문안을 수정해 재승인 문자를 받은 뒤 **옛 링크**를 열면 "유효하지 않은 주소" ④PM2 로그(`[agency-approve] 링크 승인`)와 morgan 로그에 토큰 문자열이 없는지.

## 17) 요청서 원스텝 접수 (2026-08-25(3) · Harold "요청서 규격화해서 올리면 원스텝" · **배포완료** · Codex 적대 2R)

경위: 직원 피드백 "직접 발송과 차이가 없다". 요청서 엑셀(규격)과 고객 명단(자유형) 두 파일이면 접수가 끝난다. Harold 확정 = 파일 2개 분리 · (광고) 기본 예 · 상위 50건만 표시(10건 페이징) · 회신번호는 직접 선택 또는 명단 열 · MMS는 화면에서 이미지 첨부.

### 17-1) 구조

| 조각 | 소유 | 내용 |
|---|---|---|
| 요청서 파서 | `utils/agency-send-form.ts` | A열 라벨 기반(행 밀림 허용 · "요청서" 시트 이름 우선). 항목 = 제목·문안·보낼 시각·회신번호·광고 여부(기본 예)·담당자 번호. **중복은 별칭까지 한 필드로 접어 값이 갈리면 반려**("광고 여부"와 "광고"). 시각은 달력 왕복 대조(2월 30일 거절). 명단은 **헤더 자리 보존**(빈 헤더가 열을 밀지 않는다) · 중복 열 반려 · 행 6만·열 100 상한 |
| 전화번호 열 | 〃 | 이름이 아니라 **값이 휴대폰 번호인 비율**로 선정. 못 찾으면 확인 화면에서 직접 선택(폴백 없음: 지정이 틀리면 반려) |
| 분석 API | `routes/agency-send.ts` POST `/one-step/preview` | 자격 확인을 **파일 수신보다 먼저**. 서버가 파싱·검증·중복 검사·집계·회신번호 그룹핑(등록 검증은 집합 1회 조회 · 21종째 즉시 중단)을 하고 **상위 50건 샘플 + 집계 숫자만** 응답(전 행 전송이 화면 접수가 느린 원인이었다) |
| 확정 API | 〃 POST `/one-step` | 같은 파일을 다시 받아 같은 분석 후, **전 그룹을 한 트랜잭션으로** 생성(부분 접수 소멸 · 이력은 커밋 뒤). 확인 화면 스냅샷(시각·담당자·회신번호·수신자 열·이미지) **전량 필수**(strict) — 빠지면 CONFIRM_REQUIRED 400, 빈 값은 반려(조용한 요청서 원값 복귀 금지) |
| 접수 코어 | 〃 `createRequestCore` | 기존 POST / 검증·트랜잭션을 함수로 추출(원본 복사). 입구 = 화면 접수 · 원스텝 · (예정) 이메일 워커. 외부 트랜잭션 시 검증 재료(등록 발신번호 집합·발송 창)는 **트랜잭션 열기 전에 사전 조회**해 넘긴다(연결을 쥔 채 풀 재대기 금지) |
| 화면 | `components/agency/AgencyOneStepModal.tsx` | 양식 내려받기(`public/agency-request-form.xlsx` · 파서 왕복 실측 통과) + 파일 2칸 → 확인 화면(문안·집계·그룹·샘플 10건 페이징 "상위 50건만") → 접수. 파일 교체·재분석·제출은 **세대(epoch) 가드**로 묶는다(옛 응답이 새 화면을 못 덮는다) |

**회신번호 열 방식 = 회신번호별 분할 접수(상한 20종).** 대행발송이 타는 적재 배관(주소록 슬롯 5칸)은 수신자별 회신번호를 나르지 못한다(워커 적재부 주석 소유 · 직접발송의 개별 회신번호는 고객DB 경로 것). 각 건이 기존 파이프라인(검사·담당자 문자·승인)을 그대로 타고, 확인 화면이 "N건으로 나뉜다"를 숫자로 안내한다. 화면 접수의 광고 체크 기본값도 켜짐으로 변경(Harold 지시).

### 17-2) Codex 적대 2R 요약

1R(high 6): 부분 생성 중복·스냅샷 fail-open·헤더 자리 밀림·업로드 자원(자격 순서·413·상한)·날짜 rollover·광고 fail-open(시트·중복) → 전부 수용 정정. 2R(high 4·medium 2): 외부 트랜잭션 중 전역 풀 재대기(사전 조회로)·strict 스냅샷 확장(수신자 열·회신번호 폴백 금지 + 확정 필수 필드)·파일 교체 epoch·그룹 21종 조기 중단+집합 조회·별칭 canonical 중복 → 수용 정정.

### 17-3) 수용한 위험 (명시)

1. **성공 응답 유실 후 통째 재제출 = 중복 접수.** 전 그룹 단일 트랜잭션이라 부분 상태는 없지만, 접수 완료 응답을 못 받고 다시 올리면 전체가 한 번 더 접수된다. 화면 접수의 재클릭과 같은 부류이고, 담당자 승인 게이트가 뒤에 있다. 멱등 키 도입은 별도 과제.
2. **압축 XLSX 팽창(CPU·메모리)은 파싱 후 상한이다.** 파서 라이브러리가 시트를 통째로 펼친 뒤 행·열 상한을 본다. 이 문은 유료 + 회사 스위치 ON 계정만 닿아 남용 면이 좁다고 판단했다. 스트리밍 파서 전환은 별도 과제.

### 17-4) 배포 후 실측 5

①양식 내려받기 → 그대로 채워 두 파일 업로드 → 확인 화면에 제목·문안·집계·샘플이 맞게 뜨는가 ②접수하기 → 목록에 새 접수가 생기고 기존 파이프라인(검사 → 담당자 문자)이 도는가 ③회신번호 칸에 명단 열 이름을 적으면 그룹별 건수·분할 안내가 뜨고 접수가 그 수만큼 생기는가(미등록 번호는 반려) ④요청서에 2월 30일 같은 값·중복 항목을 넣으면 반려 사유가 뜨는가 ⑤3만 건 명단에서 미리보기 응답이 즉시(수 초 내) 오는가.

### 17-5) 요청서 양식 리디자인 (2026-08-25(3b) · Harold "이게 최선이냐")

첫 양식은 스타일을 못 넣는 라이브러리(xlsx)로 만들어 서식 0의 민짜였다. 스타일 지원 라이브러리(exceljs · 이미 backend 의존성)로 전부 다시 만들었다.

- **요청서 시트**: 인디고 표지 띠 + 안내 부제 · "항목 / 내용 / 작성 안내" 3열 · 입력 칸은 인디고 라벨과 테두리로 구분 · 문안 칸 다행 높이 · **광고 여부는 예/아니오 드롭다운**(데이터 유효성) · 보낼 시각 칸은 **텍스트 서식 고정**(엑셀이 날짜 셀로 바꿔 표기가 흔들리는 것을 막는다) · 눈금선 숨김.
- **작성 안내 시트**: 진행 순서 5단계(접수부터 문자 링크 승인까지) · 회신번호 두 방식(직접 번호 / 명단 열 = 분할 접수) · 문안 항목 규칙 · 시각·광고·이미지·명단 준비법.
- **고객 명단 예시 시트**: 명단 파일의 실제 모양(첫 줄 열 이름 · 열 이름 자유).

⛔ **양식의 원본은 xlsx가 아니라 생성 스크립트다**: [`packages/backend/scripts/build-agency-request-form.js`](../packages/backend/scripts/build-agency-request-form.js). 실행 = backend에서 `node scripts/build-agency-request-form.js`(산출물이 `frontend/public/agency-request-form.xlsx`를 덮어쓴다). 손으로 xlsx만 고치면 다음 수정 때 처음부터 다시 그리게 되고 파서 계약을 깨기 쉽다.
⛔ **시트 이름 "요청서" · A열 라벨 · B열 값**은 파서(`utils/agency-send-form.ts` `FIELD_ALIASES`)와의 계약이다. 라벨 문구를 바꾸면 파서도 같이 바꾸고, 바꾼 뒤 **양식을 파서에 통과시켜 확인한다**(실측 = 오류 0 · 전 항목 정상 해석 · 3b 재생성본으로 재확인 완료).

카탈로그(`content/feature-catalog.ts` `agency-send`)의 순서 안내도 이번 축에 맞춰 갱신했다: "요청서로 접수"와 "문자 속 주소로 승인"이 순서에 들어갔다(도움말 봇과 `/guide`가 그 원장을 읽는다).

### 17-6) 문안 항목 AI 매핑 (2026-08-25(4) · Harold "AI가 열을 보고 맞추면 되지 않냐" · 코드완료 · Codex 2R approve)

경위: Harold 실측에서 명단 열이 "고객명"인데 문안이 %이름%이라 반려만 떴다. 양식 자체가 이 함정을 만든다(예시 문안 = %이름% · 명단 안내 = "열 이름은 자유"). 수신자 열에는 이미 AI 선정이 있었는데 문안 항목에는 없었고, 원스텝 확인 화면에는 항목 드롭다운 자체가 없었다.

**구조 = 확인 화면에서 AI가 미리 골라 두고, 사람이 보고 접수 버튼으로 확정.**

| 조각 | 소유 | 내용 |
|---|---|---|
| 매칭 규칙 | `utils/agency-send-vars.ts` `resolveVarColumns` (순수) | 우선순위 = 확인 화면 조정값 > 같은 이름(공백 무시 · `sameNameColumn`). 조정값이 명단에 없으면 **폴백 없이 반려**(badOverrides). 화면 접수(Composer)의 같은 이름 규칙은 미러로 유지 |
| AI 추천 | `utils/ai-column-mapper.ts` `suggestVarColumnsWithAi` + `normalizeVarSuggestions`(순수) | 항목 이름 + 열 이름 + 샘플 5행으로 항목별 열 추천. **fail-closed 정규화**: 실제 문자열·유한한 0~1 confidence만 인정(String()·Number() 강제 변환 금지 · ★1R medium), 0.5 미만·명단 밖 열·중복 충돌은 null. 크레딧 0(다듬기와 같은 정책 · 진입이 유료+스위치 게이트) |
| 분석 | `routes/agency-send.ts` `analyzeOneStep(aiSuggest)` | **미리보기(aiSuggest=true) + varMapping 조정값 부재일 때만** AI를 부른다. 추천은 `via:'ai'`로 응답에만 실린다. AI 실패 = 추천 없음으로 진행(항목 반려가 남는다 · 조용한 성공 위장 금지) |
| 확정 | 〃 POST `/one-step` | **aiSuggest=false로 분석** — AI 비결정성이 확정에 구조적으로 못 들어온다. 문안 항목이 1개 이상인데 varMapping 조정값이 없으면 새로고침 안내와 함께 CONFIRM_REQUIRED(옛 번들 대비 · 항목 0개 접수는 그대로 통한다 · ★1R medium 부분 수용, 버전 스킴 신설은 불수용) |
| 화면 | `AgencyOneStepModal.tsx` | 문안 항목 드롭다운(수신자 열과 같은 모양) + "AI가 골랐습니다" 표시. 초회 분석 결과를 상태로 물려받아 이후 모든 분석·확정에 varMapping을 보낸다(화면에 보인 열 = 접수되는 열). **saving 동안 확인 화면 전 입력 잠금**(★1R high: 접수 중 편집이 화면·접수 값을 가르던 경합) |

⛔ **접수 확정 경로에서 AI를 부르지 마라.** 미리보기가 추천하고, 화면이 그 매핑을 조정값으로 되보내고, 확정은 조정값만 믿는다. 이 세 단계가 "사용자가 본 열 = 접수된 열"의 전부다.
⛔ 잘못 매핑돼도 담당자 테스트 문자(치환 실물)가 승인 전에 한 번 더 막는다 — 그래도 첫 화면에서 맞추는 것이 원칙이다.

수용 위험(추가): ①옛 번들 + 항목 있는 문안 = 확정이 새로고침 안내로 반려된다(항목 0개면 무영향) ②옛 번들이 미리보기를 반복하면 AI 호출이 회차마다 난다(새 번들은 초회 1회뿐 · 진입 게이트로 남용 면이 좁다).

Codex = 1R needs-attention(high 1 · medium 2 → 전부 정정: 입력 잠금 · fail-closed 정규화 · 옛 번들 허용 축소) → 2R **approve · 지적 0**. 게이트 = backend tsc 0 · frontend tsc 0 · vitest 계약 19건(+9) · 양식 재생성 후 파서 왕복 오류 0.

### 17-7) 명단 미리보기 엑셀 뷰 (2026-08-25(5) · Harold "버튼으로 열어 파일 형식 그대로" · 코드완료)

확인 화면 우측의 번호 리스트를 버튼("명단 미리보기 (상위 50건)")으로 바꾸고, 누르면 **올린 파일 모양 그대로**(전체 열 · 파일 순서 · 제외 전 원본) 상위 50행을 10행씩 페이징으로 보여준다. 문안 항목 매핑(§17-6)을 접수 전에 눈으로 검증하는 창이다.

- 서버: 분석 응답에 `sampleRows`(상위 50행 × 전체 열 값) 추가. **"전 행 전송 금지" 계약 유지**(열 상한 100이라 유계). 옛 `sample`(번호 리스트)은 옛 번들 호환으로 계속 내려간다. 조회·표시만 변경이라 Codex 대상 아님.
- 화면: 포탈(z-[80])로 띄우는 자기 창(CUI_MODAL · 껍데기 overflow-hidden이라 포탈 의무). **역할 열 표시** = 수신자(인디고+태그) · 회신번호 열(태그) · 문안 항목(%이름% 뱃지, 화면 varMapping 상태 기준). 배경 클릭 닫힘 없음.
- 트레이드오프(수용): 번호만 빠르게 훑는 용도는 클릭 1회가 늘었다. 집계 카드(보낼 번호·제외 수)가 그 확인을 대신한다.

게이트 = backend·frontend tsc 0 · em-dash·계약 테스트 22건 통과. 실측 = §17-6 실측 ①에서 버튼을 눌러 열 뱃지(수신자=휴대전화번호 · %이름%=고객명)와 6행 값이 파일과 같은지 함께 본다.

배포 후 실측 3: ①직원테스트DB(열=고객명) + %이름% 요청서 업로드 → 확인 화면 문안 항목에 "고객명"이 미리 골라져 있고 "AI가 골랐습니다"가 뜨는가 ②그대로 접수 → 담당자 테스트 문자에 이름이 치환돼 오는가 ③드롭다운을 다른 열로 바꾸면 재분석 후 그 열로 접수되는가.

---

## 18) 이메일 접수 (챕터 2 · 2026-08-25(9) 설계 확정 · Harold 승인 · 구현 미착수)

경위: Harold "hanjullo@invitocorp.com 으로 접수되는 업체들 진행" + "슈퍼관리자 대행발송 업체 지정 자리에 모달을 더해 허용 이메일 주소를 등록하자"(제안 채택). 확정 사실 = 메일은 하이웍스 호스팅 · IMAP 사용 가능 · 앱 비밀번호 발급 가능.
설계 절차 = COLLAB §1 브레인스토밍(기획·백엔드·프론트엔드·회의론자 · 1차 의견 → 교차 토론 1R → 회의론자 최종 검증). 최종 판정 "이 조건이 채워져야 됩니다" 15건은 전부 §18-8에 반영했다. 파서 보강 2건(§18-4)은 Harold 실물 명단 지적(무헤더 · 앞자리 0 유실)에서 추가됐다.

★2026-08-26 착수 게이트 실측(§18-11)으로 전제 둘이 정정됐다: ①하이웍스 메일은 **IMAP 미지원 · POP3S만**(가비아 고객센터 문서 "POP3 방식만 지원" + 설정 화면 실측 · CAPA 미구현·APOP 거부라 USER/PASS 방식 강제) ②수신 인증 결과 헤더(Authentication-Results)를 **붙이지 않는다**(gmail 외부 메일 헤더 실측 · ARC·DKIM 줄은 발신측 서명이라 수신 검증이 아니다). 이 절은 그 실측을 반영한 **POP3 확정판**이며, 신원 게이트는 §18-11의 조건부였던 **allowlist_only 모드로 확정**됐다.

### 18-1) 한 줄 정의와 경계

**이메일 접수 = 원스텝(§17)의 세 번째 입구다. 화면만 없고 규칙은 같다.**

- 새 접수 종류 · 새 상태 · 정산 새 값 = 0(§12-G 유지). 접수가 생기면 그 뒤는 기존 파이프라인 그대로다(1차 검사 → 담당자 문자 링크 승인 → 당일 검사 → 적재). **메일이 자동이어도 발송은 승인 게이트를 지난다.**
- ⛔ **반려된 메일은 `agency_send_requests` 행을 만들지 않는다.** intake 원장(§18-2)에만 남는다. 종결 건 명단 잔존 문제(B-0825-6)에 이 축이 기여하는 양을 0으로 만드는 근거다.
- ⛔ **확정 경로 AI 금지(§17-6 계약)가 이메일 전 구간에 적용된다.** 이메일에는 미리보기가 없어 전 구간이 확정 경로다. 문안 항목·수신자 열 어디에도 AI 추천을 부르지 않는다.

### 18-2) 구조

| 조각 | 소유 | 내용 |
|---|---|---|
| 접수 코어 승격 | `utils/agency-send-intake.ts` (신설) | `createRequestCore` · `analyzeOneStep`을 라우트에서 승격(**원본 복사** · 라우트 쪽 정의는 삭제하고 CT를 import · 승격 커밋에서 잔존 0 전수 grep). ⛔ 워커가 라우트를 import하는 방향 금지. `pre`에 `minLeadMinutes`를 추가해 **리드타임은 코어가 집행**한다(화면 180 기본 · 이메일 240 · 어댑터에 시각 판정 코드 금지 · 239분 요청 반려 행동 테스트로 고정) |
| 허용 발신자 원장 | `agency_send_email_senders` (신설 테이블) | `company_id · email_norm · user_id(필수) · label · is_active`. 정규화 = 헤더 디코딩 후 주소만 추출 · lower · trim(**plus-tag는 보존** · 정확 일치만). ~~활성 행 한정 **전역 UNIQUE**(한 주소가 두 회사에 있으면 회사 판정 불가)~~ ★0827 §20 정정: 활성 UNIQUE = `(email_norm, user_id)` — 같은 주소를 여러 귀속(청구 계정)에 등록할 수 있고, 여럿이면 요청서 "청구 계정" 지정으로 판정한다. ⛔ `user_id`가 접수의 `created_by` · 정산 3축 귀속 · 회신번호 자격(user 단위 `assignment_scope`)을 전부 정한다. 없으면 승인까지 끝난 건이 발송 직전 `dispatch_no_owner`로 죽는다(`agency-send-worker.ts:666`) |
| 신원 판정 | `resolveEmailSender` (한 함수) | 허용 주소 조회와 **귀속 사용자 활성 상태를 같은 쿼리로** 읽는다(비활성 = 접수 없이 반려 회신 + 알림). ~~조회 2행 이상 = fail-closed~~ ★0827 §20 정정: 사용 가능한 귀속 2행 이상 = `choose`(요청서 "청구 계정" 지정으로 확정 · 자동 선택 0). **★0826 확정 = allowlist_only 모드**: 하이웍스가 수신 인증 헤더를 안 붙여(실측) 신원 게이트는 허용 목록 **정확 일치가 전부**다. 완충 = 일일 상한 절반값 본값 채택(§18-7) + 슈퍼관리자 현황 상시 경고 배지 + 접수 완료 회신이 항상 **진짜 주소 소유자**에게 가는 것(위조 접수 즉시 인지 경로) + 담당자 승인 게이트. ⛔ 메일 안의 `ARC-*`·`Authentication-Results`·`X-Authinfo` 류는 발신자가 위조 삽입 가능하므로 신뢰 근거로 쓰지 않는다(하이웍스가 유입 위조 헤더를 제거하는지 검증되기 전에는 · 추가 과제). ⛔ 신원 · `canUseAgencySend` · 전역 ENV 게이트는 **`createRequestCore` 직전 단일 지점**에서 본다(네 번째 우회 입구 방지) |
| 회신 CT | `utils/agency-mailer.ts` (신설) | `outreach-mailer` 계약 복제(3값 `sent|rejected|unknown` · 부분 거부 판정 · 총 시간 상한) + `to` 인자. ⛔ `to` = 그 메일의 발신 주소 ∧ 활성 허용 목록 **교집합만**(위조 메일에 답해도 진짜 소유자에게 간다 · 백스캐터 반사판 방지). ⛔ ENV 미설정이면 `isAgencyMailerReady()` false = **폴링·접수 전체 잠금**(회신이 이 경로의 유일한 통지라 접수만 되고 통지 0인 상태를 금지). ENV = 정산·영업과 분리된 세 번째 계정 축 |
| intake 원장 | `agency_send_email_intake` (신설 테이블) | `(mailbox, uidl)` UNIQUE = 선점 arbiter(★0826 실측: 하이웍스 UIDL = `..._20260825_...eml` 형태의 안정 식별자) · `(mailbox, message_hash)` UNIQUE · status `claimed|accepted|rejected|failed` · `reply_status` · 사유 코드 · `request_ids`(성공 분기에서만). ⛔ **헤더 메타·해시·사유 코드만 담는다. 첨부 바이트·명단 행 저장 금지**(주석 + 테스트로 고정) · 보존 90일 |
| 메일 워커 | `utils/agency-send-mail-worker.ts` (신설) | 1분 주기 **별도 워커**(기존 5분 틱에 얹지 않는다). 프로토콜 = **POP3S**(pop3s.hiworks.com:995 · 메일 전용 비밀번호 + USER/PASS · ⛔ APOP 금지: 서버가 거부한다 실측). 절차 = §18-5, 수치 = §18-7 |
| 관리 API · 모달 | `routes/admin.ts` 별도 라우트 + AdminDashboard 별도 모달 | `GET/POST/DELETE /api/admin/companies/:id/agency-send-emails`(기존 스위치 PATCH에 안 끼움 · 503 마이그레이션 문구도 별도). 모달 = 스위치 카드 아래 트리거 **"허용 이메일 N개 관리"**(건수 표기 · 스위치 ON인데 0건이면 경고 한 줄: 조용한 전량 반려 방지 · OFF에도 노출) · 즉시 저장(추가 POST · 삭제 DELETE) · ⛔ 스위치의 낙관 갱신+롤백 패턴 복제 금지(스테일 클로저 · 목록은 서버 응답 통째 교체 + 요청 중 disabled) · 주소별 활성 토글 + **"전부 비활성" 버튼**(긴급 정지 · 등록 보존) · `showConfirm`/`showAlert` 재사용 · 흰 모달 + 인디고(부모 톤) · 스크림 z-[60](`CUI_MODAL_SCRIM`은 z-50이라 부모와 동률 = 금지) · 입력 = Composer 담당자 번호 칩 미러. 재활성 23505 = ~~"이미 다른 곳에 등록된 주소입니다"~~ ★0827 §20 정정: "같은 주소와 귀속의 활성 등록이 이미 있습니다"(어느 회사인지 미노출 원칙은 유지) |
| 출처 표시 | `agency_send_requests.source` (신설 컬럼) + 프론트 단일표 | `varchar(16) NOT NULL DEFAULT 'screen'` CHECK(`'screen','one_step','email'`). ⛔ 화면·원스텝 INSERT는 무접촉(DEFAULT에 맡김) · **이메일 경로만 값을 명시 기입**(코드 선배포·DDL 후행이 안전한 근거). `toPublic` 노출 + `SOURCE_LABEL`(`agency-send-api.ts` STATUS_LABEL 옆) + `EVENT_LABEL`에 `email_received`·`email_rejected` **같은 커밋 등재**(미등재 kind는 상세가 삼킨다). 이벤트 payload `via:'email'`+발신 주소 = 경위 축(상세 전용). 목록 메타 줄의 '파일 명단/직접 입력' 추정(fileName 유무)을 source 라벨로 대체 |
| 슈퍼관리자 현황 | 기존 `GET /api/admin/agency-send` + 탭 컴포넌트 | 새 라우트 0: 응답에 `mailIntake` 키(마지막 성공 폴링 시각(⛔ DB 영속 · 메모리는 재기동마다 리셋) · status별 건수 · 회신 실패 건 · 미등록 카운터 · 반려·격리 최근 20건). 화면은 **별도 컴포넌트 파일**로 탭 렌더(AdminDashboard 인라인 금지) · visibilitychange 복귀 1회 갱신(주기 폴링 보류) |
| 경보 | `system-alert` dedupKey 3종 | `agency-mail-login-fail`(POP3 로그인 실패 3연속 = 폴링 정지 · **즉시** · ★0826 정정: 인증 헤더 부재 확정으로 "위조 신호 경보"는 성립 불가, 위조 인지는 소유자 회신 경로가 진다) / `agency-mail-unknown-sender`(미등록 = 6시간 쿨다운 요약 + 주 1회 도메인 요약) / `agency-mail-poll-fail`(30분 정체 · ⛔ "메일 0통"과 "폴 실패"를 가른다 · `AGENCY_MAIL_ENABLED` off면 기준 시각 재설정으로 오탐 방지) |

### 18-3) 자동 확정 조건 (전부 AND · 하나라도 아니면 반려 회신)

1. 발신 주소가 활성 허용 목록과 정확 일치(유일) + 귀속 사용자 활성 + `canUseAgencySend` + 전역 ENV on (★0826: 인증 헤더 게이트는 성립 불가 확정 · §18-2 신원 판정 행)
2. 첨부 = xlsx/xls/csv 후보 **정확 2개**(요청서/명단 역할은 파일명이 아니라 내용으로 판정 · zip 반려 · 이미지 첨부가 있으면 반려: "이미지 문자는 화면에서 접수해 주세요")
3. 요청서 파서 `errors` 0(기존 반려 규칙 전량 그대로)
4. 수신자 열 = 요청서 양식 신설 칸 **"수신자 열 이름"** 값 우선(명단에 없으면 폴백 없이 반려) · 칸이 비면 `scorePhoneColumns` 단일 점수표(§18-4)의 이메일 임계(비율 0.9 이상 그리고 2등과 0.3 이상 격차)로 자동 선정하되 회신·이력에 "자동 선정" 명시 · 불충족 반려
5. 문안 `%항목%` = 명단 열 이름과 같은 이름만(공백 무시) · ⛔ AI 열 추천 호출 0(소스 스캔이 아니라 **mock 행동 테스트**로 "호출되지 않음"을 단언하고, 조건을 반전시켜 빨간불을 확인 후 원복)
6. 회신번호 = 직접 번호(fixed)만 + 등록 집합 검증 · 열 방식(분할 접수) = 반려: "나뉘는 건수 확인이 필요하니 화면 접수에서 진행해 주세요"
7. 담당자 번호 1개 이상
8. 보낼 시각 = `validateRequestedAt`(코어 집행) + `EMAIL_MIN_LEAD_MINUTES` 240
9. ~~SMS·LMS만(MMS는 다음 축 · 불변 11의 "이미지 포함 실물 승인"을 메일 첨부로는 지킬 수 없다)~~ ★0828(2) 폐기: 입구가 셋이어도 그 뒤는 하나라 담당자 테스트 문자는 이메일 접수에도 이미지 포함 MMS로 나간다 = 불변 11은 메일 입구에서도 그대로 지켜진다("지킬 수 없다"의 근거가 애초에 없었다). 진짜 장벽은 규격이었고, 확정 = 별도 첨부 3장 · JPG 실체·300KB·3장 규격이면 접수, 벗어나면 파일별 사유 반려(변환 없음 · 상설 문서 불변 23)

양식 개정 규약: "수신자 열 이름" 칸 추가는 `scripts/build-agency-request-form.js` 재생성 + 파서 왕복 실측 + 원스텝 모달 안내 갱신을 **같은 커밋**에 묶는다(§17-5 계약).

### 18-4) 파서 보강 2건 (★Harold 0825 실물 명단 지적 · 전 입구 공통)

현재 결함(실측):
- 명단 파서는 첫 줄 = 열 이름 전제(`agency-send-form.ts:156`). **무헤더 파일은 첫 고객 행이 열 이름으로 소비돼 조용히 1명 유실**되고, 나머지 행으로 번호 열이 잡혀 아무도 모른 채 진행된다.
- 엑셀 숫자 셀이 앞 0을 떨어뜨린 번호(`1052958517`): `looksMobile`(`:194~198`)이 01 시작을 요구해 **열 자동 선정에서 탈락**하고, 사람이 그 열을 직접 고르면 유효 검사(`agency-send.ts:303`·`:618` = 10자리 이상만)가 **잘못된 번호를 그대로 적재**한다.

처방(둘 다 파서·접수 공용부라 화면·원스텝·이메일 세 입구가 같이 고쳐진다):
1. **0 복원 규칙**: `normalize-phone.ts`에 새 함수(숫자만 10자리이고 `1[016789]` 시작이면 앞에 0). 소비 = `looksMobile` 판정 + 명단 행의 번호 변환 지점(`agency-send.ts:303`·`:617` 및 형제 지점 전수 grep). ⛔ 기존 `normalizePhone` 동작은 무변경(전 플랫폼 소비처 영향 0). 구형 011의 9자리 0 유실은 복원 제외(오복원 위험이 더 크다).
2. **무헤더 감지 + 열 이름 합성**: 첫 행에 휴대폰 모양 값(복원 후 판정)이 하나라도 있으면 무헤더로 판정 → 열 이름을 "열1·열2…"로 합성하고 **첫 행부터 데이터로**(첫 고객 유실 제거). 원스텝은 합성 이름으로 확인 화면 매핑이 그대로 되고, 이메일은 무헤더 + 문안 `%항목%` 존재면 반려("첫 줄에 열 이름을 넣거나 문안에서 항목을 빼 주세요"). 번호 없는 무헤더는 감지 불가지만 번호 0건 반려로 끝나므로 사각이 아니다.

★0826 구현 중 실측 정정: **화면 접수(Composer)에는 무헤더 합성이 닿지 않는다.** Composer는 명단 파싱을 공용 업로드 API(`/api/upload/parse` · `routes/upload.ts`)에 위임하는데 그 파서는 고객DB 업로드 공용이라 이 축에서 고치지 않는다(공용 컴포넌트 금지 · 축 밖 = 추가 과제로 기록). 무헤더 수용 = 원스텝·이메일 두 입구. **0 복원은 접수 코어(`createRequestCore`) 수신자 정규화에서 걸리므로 세 입구 공통**이다. Composer의 열 추정(`guessPhoneColumn` = 이름 기반)은 사람이 보는 경로라 그대로 둔다.

### 18-5) 워커 절차와 통지

tick(1분): `running` 가드(try/finally) + `pg_try_advisory_lock`(⛔ **전용 client**로 획득부터 해제까지 유지, finally에서 unlock 후 release · `pool.query`로 잡으면 재진입이 뚫린다 · `invoice-confirm.ts:512` 선례) → ENV·`isAgencyMailerReady` 확인(아니면 return) → POP3S 접속(틱마다 짧은 세션 · USER/PASS · 연결·유휴 타임아웃 명시) → `UIDL` 전량 수신 → **원장에 없는 UIDL만** 처리 대상(⛔ POP3 메시지 번호는 세션마다 바뀐다 · 커서 개념이 없고 대조 축은 UIDL뿐) → 통마다: **`TOP n 0`(헤더만) → 신원 판정 → 선점 INSERT → 그 다음에야 `RETR`(본문·첨부)**(미등록 발신자의 첨부는 내려받지도 않는다) → 파싱 전 상한 → 파싱·검증 → 사전 조회(등록 발신번호 집합·발송 창) → BEGIN → `createRequestCore` + intake `accepted` → COMMIT → 회신 → QUIT.

- ⛔ **서버 메일은 건드리지 않는다: `DELE` 0.** POP3에는 폴더·읽음 개념이 없으므로 처리 상태(수락/반려/미등록/실패)는 intake 원장 단독이고 현황 화면이 그것을 읽는다. 웹메일 정리는 사람 몫. ⚠ 이 계정에 다른 POP3 클라이언트(아웃룩 등)를 물리면 그쪽 "서버에서 삭제" 설정이 메일을 지워 워커가 못 본다(가비아 문서의 자동 삭제 경고 실측) = **hanjullo 메일함은 워커 전용으로 운영**.
- 통 단위 실패 격리(한 통이 뒤를 막지 않는다). `claimed` 10분 초과 행은 관찰값 CAS로 복구(기존 워커 lock 복구와 같은 형태). 실패 통은 원장에 없거나 재시도 대상 status로 남으므로 다음 틱 UIDL 대조가 다시 잡는다(커서 누락 문제 자체가 없다).
- **회신 재시도 = 수신 순회와 분리된 별도 패스**: `accepted`인데 `reply_status`가 pending·unknown인 행을 3회까지, 이후 현황 노출로 넘긴다.
- 백오프(1/5/30/120분)는 **네트워크·DB 일시 장애만**. 파싱·신원 반려는 0회 즉시 확정. ⛔ **POP3 로그인 실패는 백오프 금지**: 3연속이면 폴링 정지 + 즉시 경보 + 사람이 재개한다(1분마다 로그인 재시도는 하이웍스 계정 잠금을 부른다).

통지 2종(이 경로의 통지 채널은 메일뿐 · 접수 전 단계 문자 없음 = §18-9):
- **접수 완료 회신**: 제목 · 문안 원문 · 보낼 시각 · 회신번호 · 담당자 번호 · 수신자 열 이름(자동 선정이면 그 표기) · 인원 · 제외 수 · 상세 링크. ⛔ 고정 2문장 필수: "담당자 승인 전에는 발송되지 않습니다" + "실제 치환된 문장은 담당자 휴대폰 테스트 문자에서 확인해 주세요"(치환 전 원문을 실물로 오독하는 것 방지).
- **반려 회신**: 사유 전량(한 줄에 하나) + 고치는 법 + 명단의 실제 열 이름 목록. ⛔ **업체가 보낸 값만 반송한다**: 등록 발신번호 목록 같은 회사 자산 나열·접수 id·내부 식별자 금지("그 번호는 등록되어 있지 않습니다" 같은 사실 서술은 허용). 하단에 "고친 파일을 이 메일에 회신하시면 다시 접수됩니다".
- 루프 방지: 우리 회신에 `Auto-Submitted: auto-replied` + In-Reply-To/References. 수신 메일에 `Auto-Submitted`·`List-Id`·`Precedence: bulk`가 있으면 접수 대상에서 제외. 미등록·fail·unknown = 회신 0(주소 등록 여부 탐침 방지). ⛔ 회신 본문 줄표 0(불변 10).

### 18-6) 멱등 3층과 차단 집합

| 층 | 키 | 동작 |
|---|---|---|
| 1 전달 | `(mailbox, uidl)` UNIQUE 선점(유일 arbiter · ★0826 POP3 확정) | 재처리 차단 · 무동작 |
| 2 같은 메일 | `(mailbox, message_hash)` 사전 조회(경합의 UNIQUE 예외는 최후 방어로 skip+로그 · 자동 병합 금지) | 서버 재전송이므로 skip · 무회신 · 로그만 |
| 3 같은 내용 | 4요소 해시 = 회사 · 문안 해시 · `requested_at` · **정렬된 수신 번호 집합 해시**(⛔ 첨부 바이트 해시 금지: 재저장만으로 바뀐다) | **미종결·발송 전 건과 일치할 때만** 접수 차단 + "이미 접수되어 있습니다(접수번호)" 회신 1회(24시간 내 재회신 없음). 종결 건과 일치는 정상 접수(같은 명단 주 2회 발송은 정상 업무) |

⛔ **3층의 차단 집합은 상수 1벌로 못박는다**: 발송 전 전 상태 + `queued` 중 `requested_at` 미도래. 허용 = `expired` · `cancelled` · `requested_at`이 지난 `queued`. SQL 리터럴과 같은 집합임을 테스트로 고정한다(`NOT_CANCELABLE_SQL` 짝 규율 선례). `queued`를 종결로 읽으면 **아직 나가지 않은 예약과 같은 명단이 한 벌 더 접수된다**(이중 발송).
⛔ intake `accepted`·`request_ids`는 성공 분기에서만 찍는다(통과 스탬프 원칙). §17-3 ①(재제출 중복)·②(압축 팽창)의 수용 근거는 이메일에서 소멸하므로(자동 재시도 · 무인증 입구) 이 3층과 §18-7 상한이 그 자리를 대신한다.

### 18-7) 수치 (전부 서버 소유 · 화면·회신 문구에 하드코딩 금지)

| 항목 | 값 | 근거 |
|---|---|---|
| `EMAIL_MIN_LEAD_MINUTES` | 240분 (별도 상수) | 화면 180은 사람이 앞에 있는 전제. 180이면 당일검사 120을 빼고 승인 창이 60분뿐인데 거기서 메일 지연·폴링 1분·검사 워커 5분 틱·회신 왕복이 다 빠진다. 240 = 승인 창 120분 |
| 틱당 처리 | 10통 (재기동 후에도 동일) | 20이면 한 틱이 1분을 넘겨 실질 주기가 늘어난다. 밀린 메일의 반려 회신 폭주 완충 |
| 일일 상한 | 발신 주소 5통 · 회사 10통 (**메일 통수** 기준 · ★0826 allowlist_only 확정으로 절반값이 본값) | 초과 = 거절 + 사유 회신 1회. ⛔ 초과 거절을 현황 카운터로 노출(조정이 필요한 회사가 보여야 값을 고친다) |
| 회신 상한 | 같은 주소 1시간 5통 | 자동응답 루프 완충 |
| 백오프 | 1 · 5 · 30 · 120분 후 failed | 네트워크·DB 일시 장애만. 인증 실패는 3연속 = 폴링 정지 |
| 정체 경보 | 마지막 성공 폴링 30분 초과 | off 상태는 기준 재설정으로 오탐 방지 |
| 파싱 전 상한 | 첨부 합계 15MB · 파일 5개 · 압축 팽창 100배 · 통당 처리 60초 | 15MB는 원스텝 multer와 동값. 무인증 입구의 첨부 폭탄 방어(1차 방어는 신원 통과 전 미다운로드) |
| intake 보존 | 90일 | 개인정보 없는 메타뿐이라 가볍다 |

### 18-8) 회의론자 최종 검증 15건 반영표 (구현 체크리스트)

| # | 깨지는 지점 | 반영(막은 형태) | 배포 전 필수 |
|---|---|---|---|
| 1 | 리드타임 240의 집행 자리가 코어에 없어 판정 두 벌 | `pre.minLeadMinutes`로 코어가 집행 + 239분 반려 행동 테스트 | ★ |
| 2 | 멱등 3층의 "종결"에 `queued` 오독 = 이중 발송 | §18-6 차단 집합 상수 + SQL 리터럴 짝 테스트 | ★ |
| 3 | 성공 회신 1회 실패 = 영구 무소식 | 회신 재시도 별도 패스 3회 + 현황 노출 | ★ |
| 4 | 회신 ENV 부재면 접수만 되고 통지 0 | `isAgencyMailerReady` false = 폴링·접수 전체 잠금 | ★ |
| 5 | 승격 문구 오독으로 코어 두 벌 | 라우트 정의 삭제 + 잔존 0 전수 grep | ★ |
| 6 | 처리 커서가 실패 통을 영구 누락 | ★0826 POP3 전환으로 커서 자체가 없다: 매 틱 UIDL 전량을 원장과 대조해 미기록만 처리 | |
| 7 | intake에 첨부·명단 저장 = 지울 수 없는 개인정보 재축적 | 메타·해시·사유만 + 저장 금지 테스트 + 보존 90일 | |
| 8 | source 배포 순서 어긋나면 화면 접수까지 전멸 | DEFAULT 'screen' + 이메일만 명시 기입 + 워커 catch 마이그레이션 skip + SCHEMA.md 등재 동일 커밋 | |
| 9 | 재활성 23505가 "저장 실패"로만 보임 | "이미 다른 곳에 등록된 주소입니다"(회사 미노출) | |
| 10 | ENV off가 정체 경보를 울림 | off면 기준 시각 재설정 | |
| 11 | 폴링 시각이 메모리면 재기동마다 리셋 | DB 영속(쿨다운은 system-alert가 이미 PG 영속) | |
| 12 | advisory lock을 pool.query로 잡으면 재진입 | 전용 client 유지 + finally unlock·release + `_running` 병용 | |
| 13 | "AI 금지"를 소스 스캔으로 검사하면 조건 반전을 못 잡음 | mock 행동 테스트 + 반전 주입 확인 | |
| 14 | 메일 세션 운용 미정(유지 vs 매틱) | ★0826 실측 확정: POP3S 틱마다 짧은 세션 · USER/PASS(APOP 서버 거부 실측) · 접속 빈도 정책 문의는 유지(§18-11 3) | |
| 15 | 일일 상한이 정상 대량 업무를 막을 수 있음 | 초과 거절 카운터 노출로 조정 근거 확보 | |

### 18-9) 회의에서 갈린 지점과 채택 (Harold 2026-08-25 승인)

| 지점 | 채택 | 근거 |
|---|---|---|
| 이메일 접수 전용 스위치 | 신설 안 함 (3:1) | 허용 주소 등록 자체가 회사별 opt-in(0건 = 꺼짐). 긴급 정지 = 모달 "전부 비활성" 버튼(등록 보존) + 전역 ENV. 판정 지점이 늘면 "켰는데 안 되는" 조합이 생긴다 |
| 접수 전 반려의 문자 보조 | 미도입 | 접수 전에는 문자 배관·비용 귀속 축이 없다(`notifyManager`는 requestId 전제 · §12-G 12). 메일 회신 + 재시도 패스로 대체. 접수 후는 기존 문자 그대로 |
| 승인 페이지에 파일명·수신자 열·항목 매핑 3줄 | 무변경 | `agency-approve.ts` 계약(명단·변수 매핑·내부 식별자 미노출 · 링크가 흘러도 새는 것은 문안뿐) 유지. 오매핑 방어 = 접수 완료 회신 + 담당자 테스트 문자 실물. 운영에서 오매핑 사고가 실제 나면 계약 변경으로 재론 |

### 18-10) DDL 초안 (실행 = Harold · ⛔ 실행 전 information_schema로 기존 유무 확인 · 실행 후 SCHEMA.md 등재 · 순서 = 코드 배포 후 DDL)

```sql
CREATE TABLE IF NOT EXISTS agency_send_email_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email_norm varchar(320) NOT NULL,
  user_id uuid NOT NULL,
  label varchar(100) NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_email_sender_active
  ON agency_send_email_senders (email_norm) WHERE is_active;

CREATE TABLE IF NOT EXISTS agency_send_email_intake (
  id bigserial PRIMARY KEY,
  mailbox varchar(64) NOT NULL,
  uidl varchar(128) NOT NULL,
  message_id varchar(998) NULL,
  message_hash varchar(64) NOT NULL,
  from_email varchar(320) NULL,
  company_id uuid NULL,
  user_id uuid NULL,
  status varchar(20) NOT NULL,
  reason varchar(200) NULL,
  reply_status varchar(20) NULL,
  reply_attempts int NOT NULL DEFAULT 0,
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NULL,
  request_ids uuid[] NULL,
  claimed_at timestamptz NOT NULL DEFAULT NOW(),
  decided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_email_intake_uidl
  ON agency_send_email_intake (mailbox, uidl);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_email_intake_hash
  ON agency_send_email_intake (mailbox, message_hash);

-- ★0826 구현 중 추가(회의론자 필수 11): 마지막 성공 폴링·로그인 실패·정지 상태의 DB 영속.
--   메모리면 pm2 재기동마다 리셋돼 정체 경보가 영영 30분을 못 채운다. 재개 = paused_at을 NULL로.
CREATE TABLE IF NOT EXISTS agency_send_mail_state (
  mailbox varchar(64) PRIMARY KEY,
  last_ok_at timestamptz NULL,
  login_fail_count int NOT NULL DEFAULT 0,
  paused_at timestamptz NULL,
  paused_reason varchar(200) NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE agency_send_requests ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'screen';
ALTER TABLE agency_send_requests ADD CONSTRAINT ck_agency_send_source
  CHECK (source IN ('screen','one_step','email'));
```

안전망: 테이블·컬럼 부재 시 워커는 조용히 skip(`agency-send-worker.ts:1078` 선례), 관리 라우트는 503 `DB_MIGRATION_PENDING`(각자 자기 대상 지목 문구). `source`는 화면 경로 무접촉이라 코드 선배포가 안전하다.

### 18-11) 착수 게이트와 순서

**착수 게이트 실측 결과 (2026-08-25~26 · Harold PowerShell POP3S 직접 접속)**
1. **하이웍스는 POP3S만 지원**(pop3s.hiworks.com:995 · 가비아 고객센터 "POP3 방식만 지원" + 설정 화면 실측). 로그인 = 메일 전용 비밀번호 + USER/PASS(⛔ APOP 서버 거부 · CAPA 미구현 실측). **UIDL·TOP 지원 확정**(멱등 키·헤더 선수신 성립). 폴더 개념 없음.
2. **Authentication-Results 미부착 확정**(gmail 외부 메일 실측 · 있는 것은 하이웍스 자체 X-헤더와 발신측 ARC·DKIM 서명뿐) → 신원 게이트 = **allowlist_only 모드 확정**(§18-2).
3. 동시 접속·로그인 빈도 정책 = 고객센터 문의 **남음**(짧은 세션 설계라 착수는 가능 · **배포 전 확인**).
4. SMTP 발신(smtps.hiworks.com:465) 실측 **남음**(curl 발신 1통 · **배포 전 확인**).

**구현 순서**: ①코어 승격(`utils/agency-send-intake.ts` · 잔존 0 grep) ②파서 보강 2건(§18-4 · 전 입구) + 양식 개정 ③허용 이메일 테이블·관리 라우트·모달 ④`agency-mailer` + intake 원장 + 메일 워커 ⑤source·라벨·현황·경보 ⑥Codex 적대 리뷰(쓰기 경로 + DDL 4종 = 의무) ⑦배포 → DDL → ENV(IMAP·발신 계정) → 실측(§18-12). ④의 수신 배관 = **자체 소형 POP3S 클라이언트 CT**(`utils/pop3-client.ts` · tls 위 6명령 USER/PASS/STAT/UIDL/TOP/RETR/QUIT · ★0826 결정: IMAP 라이브러리는 무용해졌고 node POP3 라이브러리는 장기 미유지보수라 공급망 위험이 더 크다) + 신규 의존성 1종 `mailparser`(MIME·encoded-word 디코딩·첨부 추출). ⛔ 직접 MIME 파싱 금지(`=?UTF-8?B?...`·multipart·base64를 손으로 풀면 그 자체가 결함 축 · POP3 프로토콜 6명령과 MIME 해석은 별개다).

### 18-11-1) 구현·검증 이력 (2026-08-26 · 코드 완료)

- 구현 = §18-11 순서 ①~⑤ 전부. 신설 파일 = `utils/agency-send-intake.ts`(승격) · `utils/pop3-client.ts` · `utils/agency-mailer.ts` · `utils/agency-send-email.ts` · `utils/agency-send-mail-worker.ts` · 프론트 `admin/AgencyEmailSendersModal.tsx` · `admin/AgencyMailIntakePanel.tsx`. 신규 의존성 = `mailparser`.
- **⑥ 리뷰 = Harold 지시로 Codex 대신 자체 적대 검토 반복(결함 0 라운드까지).** R1~R5 실결함 7건 정정: 독약 메일 무백오프 재시도 · 완료 회신 rate-limit 시 skipped 고착 · 빈 편지함 틱에서 회신 재시도 미실행 · 유효 번호 0건의 오사유 반려 · **claimed 복구 CAS의 타임스탬프 동등 비교**(µs/ms 왕복 불일치로 영구 잠김 · memory 등재 사고 부류) · **원스텝 source 라벨 유실**(컬럼 존재 탐지 캐시로 정정: DDL 전 안전 + DDL 후 전 입구 라벨) · 관리 라우트 이메일 길이 미가드. 오판 1건 철회(`int || ' days'`는 PG `anynonarray || text`로 유효 · 기존 코드 4곳 실증).
- 게이트 = backend tsc 0 · frontend tsc 0 · vitest 202파일 3,095건 · **frontend production 빌드 통과(57.8s · 청크 정상)** · 자가 grep(모델명 0 · native dialog 0 · 사용자 노출 줄표 0).
- 남은 것 = 배포 + DDL 4종 + ENV + SMTP 발신 실측 + 접속 정책 문의 + §18-12 실측(Harold). SCHEMA.md 등재는 DDL 실행 확인 후.

### 18-12) 배포 후 실측 7

①등록 주소에서 정상 요청서+명단 발송 → 1분 내 접수 생성·완료 회신 수신·목록 라벨 "메일 접수"·상세 이력에 발신 주소 → 기존 파이프라인(검사·담당자 문자·링크 승인)이 그대로 도는가 ②미등록 주소 발송 → 회신 없음·격리 폴더 이동·현황 카운터 증가 ③같은 파일을 다시 발송 → 새 접수 0건·"이미 접수되어 있습니다" 회신 1회 ④무헤더 + 0 유실 번호 명단 → 첫 행 고객 포함·번호 복원(인원 수로 확인) ⑤반려 2종(보낼 시각 240분 미달 · 문안 `%항목%` 불일치) → 사유 회신 수신·접수 행 0건 ⑥메일 ENV 제거 후 재기동 → 폴링·접수 잠금 + 부팅 로그 1회 ⑦위조 시험(등록 주소를 From에 적어 다른 발신 경로로 발송) → 접수가 생기더라도 완료 회신이 **진짜 소유자에게** 도착하고(위조 인지 경로) 담당자 승인 없이는 나가지 않는 것 확인.

### 18-13) 수용 위험 (명시) · 범위 밖

수용 위험: ①미등록 발신자는 무응답이다(무시인지 미도달인지 업체는 모른다 · 문의는 격리 카운터·현황이 받는다) ②반려율이 첫인상을 해칠 수 있다(완화 = 양식 "수신자 열 이름" 칸 + 반려 회신 품질 · 확정 경로라 AI 완화는 불가) ③회신 메일의 스팸함 유실은 감지 불가(재시도 3회 + 현황 노출이 한계) ④신규 의존성 2종이 발송 백엔드 단일 프로세스에 들어온다(외부 입력 파서 = 취약점 축 하나 추가) ⑤무헤더 + 개인화 문안은 이메일로 불가(화면 안내로 우회) ⑥회신번호 열 방식이 화면은 되고 메일은 안 되는 비대칭(반려 회신 문구가 흡수) ⑦**From 위조 접수 가능성(★0826 확정)**: 수신 인증 헤더가 없어 위조 메일이 허용 주소를 From에 적으면 접수가 생길 수 있다. 완충 = 정확 일치 허용 목록 · 완료 회신이 진짜 소유자에게 가는 즉시 인지 경로 · 담당자 승인 게이트 · 일일 상한 절반값. 타사 명단이 DB에 적재되는 것 자체는 남는 위험.

범위 밖(다음 축): 업체 자가 주소 등록 화면 · 반려 회신 스레드로 수정 재접수 추적 · MMS 이미지 첨부 · 회신번호 열 방식 · 슈퍼관리자 전면 개편(회사 편집 실사용 0 스위치 3종 정리 포함 · Harold 0825 인디고 전환 의향 = 별도 트랙) · 하이웍스 `X-Authinfo` 접속 IP 기반 자체 SPF 검증(하이웍스가 유입 위조 X-헤더를 제거하는지 검증된 뒤에만). BUGS 등재로 분리: **B-0825-6**(종결 접수 수신자 행 삭제 경로 부재) · **B-0825-7**(기존 5분 워커 겹침 가드 부재).

---

## §19) 통일 양식 + 사용자 격리 + 슈퍼관리자 내역 (★2026-08-26(2) Harold 승인·당일 종결)

### 19-1) 경위와 확정

- Harold가 업체들이 실제로 쓰는 요청서(카카오톡 수신 실물 xlsx)를 첨부: "첫 시트에 내용, 두 번째 시트에 고객리스트로 보낸다니 이걸로 통일하자. 요청서 접수도 파일 하나로, 이메일도 이 파일 첨부로."
- 서수란 팀장 접수: "사용자끼리 접수가 전부 공유된다. 자동발송·이미지스튜디오처럼 격리돼야 하는 것 아닌가" → Harold 확정 = **관리자는 하위 전부, 사용자는 본인 것만 + 접수 계정 표시**.
- Harold 추가 지시 = 슈퍼관리자에 **대행발송 내역 메뉴 신설**(고객 화면의 진행 레일 + 접수구분 + 고객사명 + 신청자명).
- 리뷰 = Harold 지시로 Codex 생략, 자체 적대 검토로 종결.

### 19-2) 실물 양식 실측 (착수 근거)

실물 파일을 배포 시점 파서에 그대로 통과시킨 결과: 시트명 "내용" 미인식(`looksLikeRequestForm=false`) · 라벨 5종 전부 별칭 불일치(발송날짜 및 시간 · 메시지 제목 · 메시지 내용 · 테스트 문자 받을 번호 · 발신번호(=회신번호) = 괄호 부연이 정확 일치 대조에서 짐) · 명단 파서가 첫 시트("내용")를 명단으로 오독 · 값 칸의 템플릿 안내문("월 일 시 분")이 값으로 읽힘. 단 **열 위치는 이미 호환**(A열이 비어 범위가 B열부터 시작 = 파서의 "첫 칸 라벨·둘째 칸 값"에 그대로 걸림).

### 19-3) 구현 (같은 커밋)

1. **파서 CT**(`agency-send-form.ts`): 라벨 = 행의 첫 비어 있지 않은 셀 + 괄호 부연 제거 대조(`labelKey`) · 별칭 합류(메시지 내용·발송날짜 및 시간 등) · 시트 선택 "요청서"→"내용"→첫 시트 · 명단 시트 "고객리스트"(정확 일치 · "고객 명단 예시" 오인 차단) · `hasRecipientSheet` 신설 · `looksLikeRequestForm` = "요청서" 또는 "내용"+"고객리스트" 짝 · 플레이스홀더 빈칸 처리(`PLACEHOLDER_VALUES`) · 한국어 시각 표기(연도 필수 · 오전/오후 · 요일 괄호 · 달력 왕복 대조 유지) · 문자타입 알림톡·친구톡·RCS 반려 · 이미지 파일명 칸 노출(`imageFileName`).
2. **접수 코어**: 명단 버퍼가 없으면 요청서 파일의 고객리스트 시트를 명단으로(`effectiveListBuf`). 별도 명단 파일이 오면 그쪽 우선(하위호환).
3. **이메일 워커**: 표 첨부 1개(통합 · 요청서+명단 시트 둘 다 필수) 또는 2개(분리) 허용. `imageFileName` 있으면 has_image 반려(첨부 없는 이미지 지정 = 기대와 다른 발송).
4. **화면**: 원스텝 모달 슬롯 1개(명단 슬롯 폐지 · API `list` 필드는 선택으로 유지) · 입구 버튼 "파일 하나면 끝납니다".
5. **격리**(`routes/agency-send.ts`): `requireAgencySend`가 JWT `userType`으로 `seesAll` 판정 → 행 접근 전 경로(목록·상세·수신자·승인·문안·시각·취소 claim/재조회)에 소유자 술어 한 모양(`AND ($n IS NULL OR created_by = $n)`). 승인은 CT가 토큰 경로와 공유라 라우트 사전 확인. 관리자 목록·상세에만 users JOIN으로 접수 계정 동봉(일반 사용자 응답에는 키 자체 없음). 기존 5행 전부 `created_by` 보유 실측(no_owner=0) = 백필 0.
6. **슈퍼관리자**: `GET /api/admin/agency-send`에 레일 재료(source·approved_at·queued_at·문안 미리보기 80자)와 고객사명·신청자명 합류 → `AgencySendLedgerPanel` 신설(발송 관리 그룹 "대행발송 내역" 탭 · 진행 레일은 고객 화면과 공용 `AgencyProgressRail` · 검색 + 상태/접수구분 필터 + 요약 4칸).
7. **배포 양식 재생성**: 시트 "내용"(업계 라벨 + 광고 여부·수신자 열 이름) + "고객리스트"(1행 = 열 이름 · 500행 텍스트 서식) + "작성 안내". **값 칸 빈칸 규약** 신설(안내문이 값으로 접수되는 원천 차단 · 파서 PLACEHOLDER 목록과 짝).

### 19-4) 게이트 실측

- 파서 왕복: 신양식·실물 카톡 양식 모두 `looksLikeRequestForm=true`·`hasRecipientSheet=true`·필수 4필드 빈칸 반려 정확·고객리스트 헤더 정상(실물 양식의 "내용" 시트 오독 0) · 플레이스홀더 전량 빈칸 처리.
- backend tsc 0 · frontend tsc 0 · vitest 202파일 3,102건(신규 계약 7건 포함) · 프론트 production 빌드 통과.
- 자체 적대 검토에서 정정 2건: 배포 양식 고객리스트 시트의 안내 배너가 헤더로 읽히는 결함(1행=열 이름으로 정정) · 도움말 카탈로그의 "두 파일" 문구 잔존.

### 19-5) 수용 위험 · 한계 (명시)

- 구양식(0825 배포본 · 시트 "요청서"+별도 명단)을 화면에 올리면 새 양식 안내로 반려된다(화면 슬롯이 하나라 별도 명단을 올릴 곳이 없다). 이메일 2파일 첨부는 계속 접수된다. 배포 하루 된 양식이라 수용.
- 업계 양식의 "이미지 파일명" 다중 행(②·③) 중 첫 행이 아닌 곳에만 적힌 값은 못 본다(라벨 없는 행). 이메일 경로의 이미지 자체 첨부는 별도 반려(has_image)가 막는다.
- 문자타입 판정은 반려에만 쓴다(SMS/LMS 지정은 무시 · 타입은 배관이 문안 길이·이미지로 정한다). 판정을 늘리지 않는 기존 원칙 유지.

### 19-6) 배포 양식 정정 (★0826(3) Harold 반려)

19-3의 배포 양식 v1은 "업계 라벨 + 우리 디자인(항목/내용/작성 안내 3열)"이었는데, Harold가 내려받아 보고 반려: "저걸로 통일"은 라벨이 아니라 **실물 그대로**라는 뜻. 재생성 스크립트를 **실물 셀 단위 복제**로 정정(구 분/내 용 표머리 · B열 라벨·C:G 병합 값 · 알림톡 전용 칸·값 칸 안내문("월 일 시 분"·발신번호 안내·①②③)까지 원문 보존 · 고객리스트 헤더 부연 포함). 우리 추가분 = 문자타입 칸 선택 목록(SMS/LMS/MMS) + 세 번째 "작성 안내" 시트 둘뿐. 광고 여부·수신자 열 이름 칸은 실물에 없으므로 **행으로 넣지 않고** 작성 안내가 "빈 줄에 라벨을 추가해 적는 법"을 안내한다(파서는 라벨로 읽으므로 어느 행이든 동작). 실측 = 실물과 내용 시트 셀 값·병합 동일 대조 + 파서 왕복 30건 통과. "값 칸 빈칸 규약"은 "실물 원문 placeholder만 허용(파서 PLACEHOLDER_VALUES와 짝)"으로 개정.

### 19-7) 슈퍼관리자 운영 취소 (★0826(3) Harold 승인·구현)

경위 = Harold "급하게 전화로 취소 요청이 오는데 우리가 고객 비밀번호를 모른다". 승인은 담당자 문자 링크가 비밀번호 없이 해결하지만 취소는 고객 로그인 화면에만 있었다.

- **취소 효과 CT 승격** = `utils/agency-send-cancel.ts`(라우트 본문 원본 복사). 입구 둘(고객 화면 · 슈퍼관리자)이 같은 함수를 지난다(승인 CT 패턴). cancelling 선점 → 큐 삭제 확인 → 확정 · tooLate만 되돌림 · 실패는 워커 F 인계, 전부 그대로 승계.
- **운영 취소 API** = `POST /api/admin/agency-send/:id/cancel`(requireSuperAdmin). 사유 = `운영 취소(직원 loginId): 메모`(cancel_reason·이력 이벤트 by/byType에 남아 고객 상세에서 보인다).
- **담당자 안내 문자** = 취소가 **확정된** 때에만 담당자 전원에게(`buildStaffCancelledNotify` ⑧ · 발송 = 워커 `notifyManager` export 재사용). ⛔ cancelling(취소 중)에 보내면 발송 15분 전 거절로 되돌아가는 경로에서 거짓 안내가 남는다. 취소 중 건은 워커가 마무리하며 문자는 없다(수용 한계).
- **내역 탭 취소 버튼** = 취소 가능 상태에만(만료 제외 · 취소 중은 스피너). 커스텀 확인 모달(고객사·신청자·건·인원·보낼 시각 + 선택 메모) · 처리 중 닫힘 차단.
- 범위 밖(의도) = 문안·시각 수정 대행(고객 확인 없는 변경이라 성격이 다르다 · 필요 시 별도 축).

### 19-8) 보낼 시각 연도 규칙 개정 (★0826(4) Harold 확정 · 서수란 첫 실사용 반려에서)

서수란 첫 실사용 메일이 "8월 30일 10시 분"(실물 양식 안내문 "월 일 시 분"을 따른 표기)으로 반려됐다. Harold 질문 "연도를 꼭 넣어야 하는 이유가 있나" → 토론 끝에 연도 필수 폐지 확정("연도는 너무 과해 · 익숙해진 사람들은 연도 넣으라 해도 빼먹는다 · 60일 이내 대행이 대부분").

- **규칙**: 연도 없는 표기(한국어·숫자형 모두)는 ①올해로 해석 ②이미 지났으면 내년으로 보되 **내년 해석은 60일 이내일 때만**(`NEAR_ROLLOVER_DAYS`) ③그 밖은 올해 과거 그대로 돌려 리드타임 검증이 "지난 시각" 사유로 반려. "10시 분"(빈 분의 '분' 잔여)도 허용.
- **왜 안전한가**: 잘못된 해로 조용히 나가는 경로가 없다. 연말의 "1월 3일"은 내년으로 통과, 6월의 "1월 3일" 오타는 먼 미래로 잡히는 대신 반려. 최종 안전망 = 승인 문자·화면에 시각이 찍히고 승인 없이는 발송 0(연도 필수의 원래 걱정은 이 게이트가 이미 막고 있었다).
- 실측 = 반려됐던 실물 파일이 새 파서에서 2026-08-30 10:00·오류 0으로 통과. 반려 문구·양식 작성 안내도 새 예시("8월 30일 10시 30분")로 갱신, 양식 재생성.
- 별도 과제(기록) = noreply@hiworks.com 시스템 메일이 미등록 발신 카운트에 섞인다(자동 발신 분류로 이관 검토).

### 19-9) 시각 표기 확장 + 승인 문자 개선 + 허용 이메일 표시 (★0826(5) Harold 지시 3건)

1. **시각 "알잘딱" 확장**: 날짜부·시간부를 한 문법으로 통합(`TIME_PART` 공용 조각). 받는 것 = 숫자·한국어 혼합("09-01 14시") · 분 생략("14") · 빈 분("10시 분") · "반"(=30분) · "쯤/경" · 시간대 낱말(오전/오후/새벽/아침/낮/저녁/밤) · 상대 날짜(오늘/내일/모레). ⛔ **모호하면 반려 유지**: "밤 12시"(자정 관용 vs 낮 12시 = 오발송 위험) · 시간 숫자 없음 · 오전/오후 없는 "2시"는 적힌 그대로 2시(자동 +12 승격 금지 = 적은 값과 다른 시각 금지). 세 입구 공통(파서 CT 한 벌).
2. **승인 링크 단축 + 요청 건수**: 담당자 승인·재승인 문자의 링크를 CT-40 단축 URL로(`buildShortAgencyApproveUrl` · 만료 = 토큰 만료와 동일 값 `agencyApproveTtlSeconds` · 단축 실패 시 원본 폴백). 문자에 "요청 건수: N건" 추가(승인 판단 재료). ⚠ 운영 확인 1 = `message_short_urls.full_url` 길이 상한(토큰 URL ~400자 · 부족하면 INSERT 실패 = 원본 폴백이라 사고는 없고 단축만 안 됨).
3. **허용 이메일 표시 형식**: 귀속 사용자 선택·다건 등록은 §18 때부터 있었고(주소마다 귀속 사용자 필수 = created_by = 격리 연동), 선택 목록·등록 목록 표시를 "아이디 - 이름"으로 정정(Harold "ID-사용자이름 보고 선택").

### 19-10) 리드타임 완화 + 자동 조정 + 일일 상한 해제 (★0826(6) 서수란 요청 · Harold 확정)

**경위** = 서수란 요청 "대행발송 가능 시간 제한을 풀고, 요청 시각이 너무 타이트하면 자동으로 뒤로 미뤄 예약해 달라". Harold 확정 = 요청 시각 + 30분 · 기준선은 주재자 계산(40분) 채택 · 이메일 일일 상한은 무제한.

**왜 풀 수 있었나(실측)**: 옛 180분(화면)·240분(이메일)은 "발송 2시간 전 재검사(120) + 승인 창"에서 나온 값인데, 0823(2)에 **당일 접수 건은 재검사를 하지 않도록** 바뀌면서 전제가 사라졌다. 그 결과 "승인은 발송 10분 전까지 받아주면서 접수는 3시간 전에만"이라는 비대칭이 남아 있었다. 기계가 실제로 쓰는 시간은 워커 픽업 5분 + 검사 최대 8분 + 적재 여유 10분 = 23분이고, 나머지는 전부 사람이 승인할 시간이었다.

**확정**
1. `MIN_LEAD_MINUTES` 180 → **40**, `EMAIL_MIN_LEAD_MINUTES` 240 → 같은 값 통일. 40의 내역 = 검사 8 + 문자 도착 1 + 적재 여유 10 + **승인 21분**. 기준선 바로 위의 건이 가장 빠듯하므로 그 건 기준으로 잡았다.
2. 미달은 거절이 아니라 **자동 조정**: `max(요청 + 30분, 지금 + 40분)`. 앞항이 Harold 지시, 뒷항은 요청이 과거이거나 지금과 붙어 있을 때의 안전선.
3. **접수 즉시 1차 검사 기동**(`triggerAgencySendFirstTest`) — 리드타임을 내리면 워커 주기 5분이 곧 승인 시간 5분이다. 승인 직후 적재(`triggerAgencySendDispatch`)와 같은 형태.
4. 이메일 일일 상한(주소 5·회사 10) → **기본 무제한**(ENV `AGENCY_MAIL_DAILY_SENDER_LIMIT`·`AGENCY_MAIL_DAILY_COMPANY_LIMIT` · 0이면 그 축은 세지도 않는다). 판정 코드는 남겨 폭주 시 코드 배포 없이 다시 조인다.

**⛔ 계약**
- **조정은 조용히 하지 않는다**: 확인 화면(원스텝) 사전 안내 · 이메일 접수 완료 회신 · 담당자 승인 문자 문안 분기 · 시각 변경 응답의 `timeShifted` 토스트. 이 축은 담당자 승인 문자에 확정 시각이 찍혀 나가므로 "언제 나갔는지 모르는 발송"이 되지 않는다(옛 금지 주석의 전제는 사람 확인이 없는 경로였다).
- **발송 허용 시간 밖은 여전히 옮기지 않는다.** 조정 결과가 창 밖이면 거절(하루 뒤로 밀지 않는다). 판정은 조정 **후** 시각으로.
- **누를 수 없는 승인 링크를 보내지 않는다**(0823 §12-2 재발 방지): 검사가 오래 걸려 남은 시간이 적재 여유에 못 미치면 승인 요청 대신 `buildTooTightNotify`("시각을 다시 정해 주세요")를 보낸다. 판정은 만료 워커·승인 라우트가 쓰는 `isApprovalExpired` 그 함수 하나.
- 일일 상한을 푸는 근거 = **진짜 방벽은 상한이 아니라 담당자 승인 게이트**다(승인 없이 나가는 경로 0). 검사·테스트 문자 비용은 대행을 요청한 고객사 몫이라(§0 확정) 접수가 늘어 문자가 느는 것은 정상이다.
- DDL 1 = `agency_send_requests.requested_at_original timestamptz NULL`(조정 전 원본 · 담당자 문자 분기와 화면 표시의 근거). **컬럼 부재 폴백 있음**(있으면 싣고 없으면 조정만 적용) = 배포 → DDL 순서 안전. 재시도 회신 SELECT에는 넣지 않는다(컬럼 부재 시 복구 경로가 멈춘다).

**영향 없음(확인)**: `requested_at`의 의미가 바뀌지 않는다(여전히 "보낼 시각")는 점이 핵심이다. 접수 시점에 한 번만 계산해 저장하므로 워커 후보 SQL·승인 판정·적재·만료·대조·집계·고객 360은 전부 무변경이다.

---

## §20) 청구 계정 다중 귀속 — 한 이메일 주소가 여러 계정을 대신 요청 (★2026-08-27 서수란 접수 `cmtb5y3pv02qwjnotttqxen6a` · Harold 승인·당일 구현)

### 20-1) 경위와 판정

**접수**: "여러 개의 귀속 계정을 한 명이 관리하는 경우, 귀속 계정은 여러 개 생성되었으나 요청 담당자가 1~2명이면 현재 시스템에서는 메일 대행을 이용할 수 없다(귀속 계정에 중복 이메일 등록도 안 된다)." 사례 4개(금강제화 4계정 1담당 · 시세이도 4부서 + CRM 대행 · 동국제약 2계정 1담당 · 송지오옴므)가 전부 **한 요구로 수렴**: 담당자 이메일 1개가 여러 청구 계정을 대신 요청하고, 어느 계정으로 청구할지는 건별로 담당자가 지정한다(대행 업계의 기존 실무 그대로).

**막던 것**: `uq_agency_email_sender_active (email_norm) WHERE is_active`(활성 주소 전역 1행) + `resolveEmailSender`의 2행 이상 = fail-closed. §18 설계 때 "주소 1 = 귀속 1"만 상정했던 것이 뿌리다. 귀속 = `created_by` = 발송·정산 계정이므로 이것은 편의가 아니라 **청구 정확성** 문제다.

### 20-2) 확정 구조

1. **DDL**: 활성 부분 UNIQUE를 `(email_norm)` → **`(email_norm, user_id)`**로 교체. 같은 주소를 여러 귀속(같은 회사든 다른 회사든)에 등록할 수 있다. 회사가 갈려도 같은 메커니즘(후보 집합에서 지정으로 선택)이라 특례가 없다.
2. **요청서 "청구 계정" 칸(선택)**: 파서 `FIELD_ALIASES`에 신설(별칭 = 청구계정·청구 부서·귀속 계정·청구 계정명). 배포 양식 본문은 실물 복제 계약대로 무변경, "빈 줄에 라벨 추가" 방식(광고 여부와 같은 취급) + 작성 안내 시트 한 줄.
3. **판정(`resolveEmailSender` 개편)**: 사용 가능한 귀속(허용 행 활성 ∧ 사용자 활성) 0 = `owner_inactive` · 1 = `ok` · 2+ = **`choose`**. 옛 `ambiguous` outcome 폐기.
4. **지정 대조(`matchBillingTarget`)**: 표시명(label) 또는 로그인 ID **정확 일치**(정규화 = 공백 제거+lower). 일치 0 = 반려(목록 안내) · 2+ = 반려+경보. ⛔ 부분·유사 일치 금지(돈 귀속).
5. **워커 절차**: 후보 1 + 지정 없음 = 현행 그대로(기존 업체 무변화) · 후보 1 + 지정 불일치 = 반려 `billing_target_mismatch`(엉뚱한 계정으로 조용히 청구되는 경로 차단) · 후보 2+ = 지정 필수, 없거나 못 찾으면 반려 회신에 **그 주소로 요청 가능한 계정 목록**("표시명 (로그인ID)")을 실어 안내(자기 권한 목록이라 노출 무해 · 회신 교집합 계약 유지).
6. **회사 축 게이트 재배열**: 일일 상한(company)·자격(`canUseAgencySend`)을 `enforceCompanyGates` 한 벌로 추출해 **귀속 확정 직후** 호출(판정 두 벌 금지). 후보 1 경로는 기존 자리(RETR 전 = 방어 유지), `choose` 경로는 요청서에서 확정한 직후(구조상 RETR 뒤 · 후보 전원이 등록 회사라 우회 입구 아님). 발신자 축 상한·크기 게이트는 제자리.
7. **등록 라우트(admin)**: 다중이 되는 등록은 **표시명 필수** + 새 표시명·귀속 로그인 ID가 기존 행의 표시명·로그인 ID와 겹치면 400(ambiguous 예방을 등록에서) + 기존 행에 표시명이 없으면 응답 `warning`(로그인 ID로는 지정 가능하니 막지는 않는다). 23505 = (주소, 귀속) 중복 문구로 교체.
8. **모달**: 같은 주소 다중 활성이면 각 행에 "청구 계정: 이름" 인디고 뱃지(담당자가 요청서에 적을 값) + 안내문 교체 + `warning` 표시.

### 20-3) ⛔ 계약

- **자동 선택 0.** 후보가 여럿인데 지정이 없으면 반려다. "기본 계정"을 두면 지정을 깜빡한 건이 조용히 엉뚱한 계정으로 청구된다(0건은 안전의 증거가 아니다 부류의 돈 판).
- **지정 대조는 정확 일치 한 벌**(`matchBillingTarget` · 회귀 주입으로 부분 일치 훼손 시 테스트 실패 확인). 등록 라우트의 겹침 예방도 같은 정규화(`normalizeBillingTargetKey`)를 쓴다 — 판정 두 벌 금지.
- **미확정(auth null) 반려는 회사·사용자 없이 기록한다**(intake 원장). 후보가 여러 회사일 수 있어 추정 기록은 오귀속이다.
- 코드 선배포 · DDL 후행 안전: 옛 UNIQUE가 살아 있는 동안 다중 행은 존재할 수 없어 `choose` 경로가 돌지 않고, 등록의 label 사전 검사(400)가 새 안내를 먼저 한다.

### 20-4) DDL — ★2026-08-27 실행완료 (Harold 실측: 교체 전 옛 인덱스 확인 → BEGIN·DROP·CREATE·COMMIT → `uq_agency_email_sender_active_user`만 잔존 확인)

`BEGIN; DROP INDEX uq_agency_email_sender_active; CREATE UNIQUE INDEX uq_agency_email_sender_active_user ON agency_send_email_senders (email_norm, user_id) WHERE is_active; COMMIT;` (트랜잭션으로 묶어 사이 창의 무제약 등록을 차단).

### 20-5) 배포 후 실측 5

①금강제화형 시나리오: 같은 주소를 계정 2개에 표시명("금강"·"신환")으로 등록 → 지정 없이 발송 = 반려 회신에 목록 · "청구 계정: 금강" 추가 발송 = 금강 계정 명의 접수(접수 계정·정산 귀속 확인) ②지정 오타("금가") = not_found 반려 + 목록 ③기존 단일 귀속 업체 = 지정 없이 현행 그대로 접수 ④단일 귀속인데 다른 이름 지정 = mismatch 반려 ⑤등록 모달: 두 번째 등록에 표시명 없이 = 400 안내 · 표시명 겹침 = 400 · 다중 행에 인디고 뱃지 표시.

### 20-6) Codex 적대 검토 1R 판정과 정정 (needs-attention · high 2 · medium 3 → 4건 수용·2권고 불수용)

| 지적 | 판정 | 정정 |
|---|---|---|
| [high] POST 조회·INSERT 분리 + 재활성 PATCH 무검사 = 정상 관리자 조작만으로 전 지정값 ambiguous 활성 집합 성립(등록 → 비활성 → 교차 키 등록 → 재활성) | 수용. 뿌리 = "활성 집합의 지정 키 유일" 불변이 쓰기 경로마다 따로 검사됨 | 판정을 `senderKeyClash` **한 벌**로 추출(교차 겹침 = 내 표시명 ↔ 남 로그인 ID까지) + POST·활성화 PATCH가 **이메일 단위 `pg_advisory_xact_lock` 한 트랜잭션** 안에서 활성 행을 다시 읽어 같은 함수를 지난다. 비활성 방향은 집합을 줄이므로 무검사. 테스트 3건(교차 겹침 시나리오 포함) |
| [high] resolver가 `s.company_id ↔ u.company_id` 동일성 미검증 = 데이터 드리프트 시 교차 테넌트 귀속·청구 | 수용(fail-closed) | JOIN을 `ON u.id = s.user_id AND u.company_id = s.company_id`로 — 불일치 행은 사용자 없음 = usable 제외 = `owner_inactive`. **복합 FK 권고는 불수용**(0728 FK 없음 원칙 · 코드 fail-closed로 대신) |
| [medium] usable 0일 때 첫 행 회사로 임의 귀속 = 원장·일일 상한 오염 | 수용(high 2와 같은 뿌리 = 귀속 판정 느슨) | 등록 행들의 회사가 **하나일 때만** 귀속, 여러 회사면 `companyId: null`(미확정 그대로 기록) + 경보 dedupKey는 회사 없으면 발신 주소로 |
| [medium] choose 경로에서 이미지 파일명 반려가 청구 확정보다 먼저 = 유효 지정 건이 회사 없이 기록·상한 미적용 | 수용 | 8b(청구 확정 + 회사 축 게이트)를 form 기반 반려보다 앞으로 이동. **RETR 전 같은 회사 preflight 권고는 불수용**(후보 전원이 등록 회사라 위험 낮음 · 분기 추가 대비 이득이 RETR 비용뿐 = 수용 위험 명시) |
| [medium] DDL 전 창의 옛 UNIQUE 23505를 "같은 사용자 중복"으로 오안내 | 수용 | `err.constraint`로 옛 `uq_agency_email_sender_active` = **503 DB_MIGRATION_PENDING**, 새 인덱스 = 409(POST·PATCH 공용 `agencyEmailUniqueConflict`) |

정정 후 게이트 = backend tsc 0 · vitest 205파일 3,175건(신규 senderKeyClash 3건 포함).

**2R(정정분 증분) = high·critical 0 · medium 2 → 1건 즉시 정정 · 1건 수용 위험 등재(종료 조건 충족 · 라운드 상한 2회)**
- [medium·정정] POST·PATCH의 `pool.connect()`가 try 밖 = 풀 고갈·failover 시 JSON 오류 계약 밖으로 탈출 → `client` nullable + 획득을 try 안으로(연결된 경우에만 ROLLBACK·release). 이번 라운드에 새로 쓴 줄의 결함이라 즉시 닫았다.
- [medium·수용 위험] 단일 파일 + 고객리스트 시트 누락(`form_not_identified`) 등 **form 파싱 전 반려**는 청구 계정 확정 전이라 다중 귀속 주소의 그 반려가 회사·사용자 없이 기록된다. 뿌리 = 첨부 불량 경로는 form 자체가 없어 "귀속 없는 반려"가 구조적으로 불가피(0개·zip·이미지 첨부도 동일). 실효 = 원장 회사 칸 공백(from_email로 추적 가능) + 회사 일일 상한 미포함(**기본 무제한이라 현재 실효 0**) · 돈·발송 영향 0(반려는 접수를 안 만든다). 상한을 ENV로 다시 조일 때 이 구멍을 함께 볼 것.

---

## §21) 메일 한 통 = 요청서 여러 건 + 양식 발송 ID 칸 (★2026-09-05 Harold 접수 · 브레인스토밍 4역할 수렴 · 승인)

### §21-1. 접수 원문과 두 분류

Harold 2026-09-05: "한 명의 이메일로 5개의 양식을 받아서 처리하는 경우도 있다. 그 5개가 각각 다른 ID로 보내야 할 수도 있다." / "그냥 저 양식에 발송ID 적는 란만 만들어주면 되는 거 아냐?" / **"두 분류가 있다."** / "일단 둘 다 대비를 해야 하는 게 문제라는 거지."

| 분류 | 실무 모양 | 지금 |
|---|---|---|
| **A** | 계정마다 담당자가 나뉜 곳. 한 메일 주소 = 한 계정 | **잘 돌아간다.** 주소 매핑이 계정을 정하므로 양식에 아무것도 안 적는다 |
| **B** | 대행 요청 담당자가 **한 명**인 곳. 그 한 명이 DB를 뽑아 **한 메일에 양식 5개**를 보낸다(실측 최대 5). 그 5개가 서로 다른 계정일 수 있다 | **막혀 있다.** 표 파일 3개 이상은 `attachments_invalid` 반려(`agency-send-mail-worker.ts:528`) |

**⛔ 용어 정정.** "한 계정에 요청자가 여러 명"(김대리·박과장이 각자 메일로 같은 계정에 요청)은 이 축의 대상이 **아니다**. 각 주소가 그 계정 하나에만 걸리므로 매핑이 그대로 정한다. 이 축이 다루는 것은 **한 주소가 여러 계정에 걸린 경우**(담당자 한 명이 금강·시세이도를 대신 요청)뿐이다. 활성 UNIQUE가 `(email_norm, user_id)`라 둘 다 성립하지만, 발송 ID 칸이 필요한 것은 뒤엣것이다.

⛔ **A를 깨지 않고 B를 여는 것**이 이 축의 전부다. Harold 명시: "지금 현재 잘되는 기능은 절대 뭉개지거나 깨지면 안 된다."

**운영 전제(Harold 2026-09-05)**: 최초 가이드를 제공하고, 문제 있는 건은 직원이 지속적으로 계도한다. 정착까지의 반려 왕복은 감수 가능한 비용으로 본다. 그래도 설계는 **왕복이 유계가 되도록** 만든다.

### §21-2. 확정 규칙 (Harold 2026-09-05 승인)

> "비워두면 원래 접수 매핑되어 있는 ID로 발송, 발송계정을 적으면 그 계정으로 발송. 양식 하나에서 계정을 두 개로 나눌 리는 없으니까."

1. **양식 "내용" 시트 27행에 `발송 ID` 칸 신설.** 1~26행은 업체 실물 복제 구간이라 한 셀도 건드리지 않는다(불변 9 · `scripts/build-agency-request-form.js:124~129`가 26행 이미지 파일명 3에서 끝난다). 원본은 스크립트이고 xlsx를 손으로 고치지 않는다.
2. **값 칸(C27)은 빈칸.** 여기에 "예: 금강제화" 같은 안내문을 넣으면 그 문자열이 값으로 읽혀 `billing_target_not_found` 반려가 난다(`agency-send-form.ts:75~85` `PLACEHOLDER_VALUES`와 짝). 안내는 "작성 안내" 시트(`build-agency-request-form.js:171`)만 고친다.
3. **선택 필드 유지.** 필수로 바꾸면 분류 A 전량이 반려된다.
4. **빈 칸 판정은 현행 그대로.** 그 주소에 걸린 계정이 1개면 그 계정으로 접수 / **여러 개면 반려**(`billing_target_required`). 걸린 계정이 여럿일 때 하나를 자동으로 고르지 않는다. 불변 19("기본 계정을 만들면 지정을 깜빡한 건이 엉뚱한 계정으로 청구된다"). Harold의 "비워두면 원래 매핑된 ID"는 계정이 1개일 때 성립하는 문장이다.
5. **요청서 1장 = 계정 1개**(Harold 확정). 한 요청서에 발송 ID 칸이 둘 이상이고 값이 갈리면 파서가 이미 반려한다(`agency-send-form.ts:238~244` 의미 단위 중복 반려).
6. **파서 별칭은 `발송ID`·`발송 ID`·`발송아이디` 3종만 추가.** 기존 `청구 계정` 7종은 하나도 빼지 않는다(0827부터 그 이름으로 보내는 담당자가 있다). 내부 `field` 키는 `'청구 계정'` 그대로 두고 `labels` 배열에만 더한다(`agency-send-form.ts:223` · `:285` `pick('청구 계정')` 무변경).
   - `발송 계정`·단독 `계정`·단독 `아이디` 계열은 넣지 않는다. 별칭이 넓으면 업체 자체 양식의 다른 뜻 라벨이 지정으로 읽혀 계정이 1개인 업체까지 `billing_target_mismatch`로 전량 반려된다(`agency-send-mail-worker.ts:563~569`가 계정 1개에도 대조를 건다). 그 회신은 원인 칸을 말하지 않아 사용자가 자력 복구를 못 한다. 반대로 별칭이 좁아 못 읽는 경우는 회신이 계정 목록을 그대로 주므로 왕복 1회로 끝난다(`:544` · `:549`). **비대칭이 근거다.**
   - 새 별칭 수용 기준: (가) 돈 귀속 수식어(`청구`·`귀속`·`발송`)가 붙어 있을 것 (나) 업계 실물 양식에 다른 뜻으로 존재할 수 없을 것.
7. **`agency-send-mail-worker.ts:566` mismatch 문구에 읽은 라벨 원문을 넣는다.** 오탐이 나도 사용자가 원인 칸을 알아 왕복 1회로 닫힌다. 계정이 1개일 때는 "이 칸을 비우면 그대로 접수됩니다"를 함께 적는다.

### §21-3. 선행 커밋 - 다중과 무관한 기존 결함 2건 (별건 · 다중보다 먼저)

**둘 다 오늘 프로덕션에 있고, 다중을 열면 피해가 메일당 최대 5배가 된다.** 다중 PR에 섞으면 회귀 원인 분리가 안 된다.

#### (1) 회신 상한 게이트가 한 번도 닫힌 적이 없다

`agency-send-mail-worker.ts:339`가 `if (!(await replyAllowed(...)))`인데 `replyAllowed`의 반환형은 `{allow, capNotice}` **객체**다(`:301`). `!객체`는 항상 `false`라 이 블록이 실행되지 않는다. 결과로 시간당 상한과 같은 사유 24시간 억제가 미집행이고 `REPLY_CAP_NOTICE`(`:328`)는 참조 0이다. **불변 22가 문서에만 있고 실행 코드에 없다.** tsc가 못 잡는다(객체의 truthiness는 타입 오류가 아니다).

**단독 수정 금지. 아래 넷을 한 커밋에.**
1. `const gate = await replyAllowed(...); if (!gate.allow) { ... }`
2. `replyAllowed` 선두에 `if (REPLY_RATE_PER_HOUR <= 0) return { allow: true, capNotice: false };` — `:72`가 기본 0이라 이 가드 없이 게이트만 살리면 `sent >= 0`이 항상 참이 되어 **전 회신이 침묵한다.** 같은 관례가 이미 이 파일에 있다(`:414` `if (DAILY_SENDER_LIMIT > 0)`).
3. `capNotice === true`일 때 `REPLY_CAP_NOTICE` 1통 발송 + `reply_status='sent'` 기록. `:299` 주석이 설계한 자기 소멸이 그때 처음 작동한다. 문구의 통수 표기도 0일 때 "0통까지만"이 되지 않게 손본다.
4. **재시도 굶주림 방지.** `reply_attempts`는 실제 전송했을 때만 오른다(`:349`). 접수 완료 회신은 `keepPendingOnRateLimit=true`라 상한에 걸리면 `pending`으로 남고, 그러면 `retryPendingReplies`의 `reply_attempts < 3`(`:729`)을 영원히 만족해 `ORDER BY decided_at ASC LIMIT 5`(`:730`)의 5슬롯을 영구 점유한다. 후보 조건에 시간 창(`decided_at > NOW() - interval '24 hours'`)을 건다.

테스트: 0이면 무제한 / N이면 N+1회차에 안내 1통 / N+2회차부터 침묵.

#### (2) 멱등 3층이 시각 조정된 건을 못 잡는다

`:635~637`이 `requested_at = analysis.requestedAtIso`로 대조하는데 이 값은 **사용자가 적은 원본**이고(`agency-send-intake.ts:316` 주석이 명시), 코어는 `validateRequestedAt`이 조정한 값을 저장한다(`agency-send-state.ts:250~256` · 조정 폭 30분). 두 값이 다르므로 조정을 탄 건은 **재전송해도 3층을 통과해 이중 접수된다.**

**실측(2026-09-05 운영)**: 이메일 접수 7건 중 **2건이 시각 조정됨**. 표본은 작지만 0이 아니고, 촉박 발송이 대행 실무의 기본이라 비율은 유지된다.

수정: 대조를 `requested_at = $2 OR requested_at_original = $2`로 넓힌다. **컬럼 존재 가드 필수** — `requested_at_original`은 `hasAgencyColumn` 조건부 기록이라(`agency-send-intake.ts:233~236`) 무방비로 SELECT에 넣으면 DDL 전 환경에서 쿼리가 통째로 실패하고 tick이 조용히 멈춘다. 같은 함정이 `:738~739` 주석에 이미 기록돼 있다.

**§21-4의 스킵 정책이 이 판정에 의존한다.** 3층이 "차단 여부"에서 "접수 집합의 크기를 정하는 판정"으로 승격되므로, 새는 판정에 집합 결정권을 주면 안 된다.

### §21-4. 다중 접수 설계

#### 판정 경계 - 회귀 0을 만드는 선

**"자립형 요청서만 다중이 된다."** 자립형 = `looksLikeRequestForm(buf) && hasRecipientSheet(buf)`(`agency-send-form.ts:392~414`), 즉 한 파일에 "내용" + "고객리스트"가 다 있는 통일 양식.

| 표 파일 구성 | 현행 | 신설 |
|---|---|---|
| 1개 | 통일 양식이면 통과 | **한 글자도 안 건드림** |
| 2개 · 요청서 1 + 명단 1 | 요청서+명단 해석 | **한 글자도 안 건드림** |
| 2개 · 둘 다 자립형 | `form_not_identified` 반려 | **다중 2건** |
| 3~5개 · 전부 자립형 | `attachments_invalid` 반려 | **다중 N건** |
| 그 밖 | 현행 반려 | **현행 사유 그대로** |

새 분기는 기존 1개·2개 분기 **뒤에** `else if`로 붙인다. 앞에 두면 오늘 도는 경로의 코드 흐름이 바뀐다.
**2파일 조합의 다중은 열지 않는다.** "요청서A + 명단A + 요청서B + 명단B"를 허용하면 짝짓기가 파일명 추론이 되고, 그건 §18-3에서 이미 거부한 축이다(어느 쪽이 요청서인지 파일명이 아니라 내용으로 가른다).
**구양식(시트 "요청서" + 별도 명단)은 다중 불가**로 확정한다. `hasRecipientSheet`가 false라 자립형 조건에 못 들어간다. 수용 위험으로 등재(§21-7).

#### 상한

- **요청서 5개**(Harold 원문 "최대 5개"). 초과 = `too_many_forms` 반려.
- **`MAX_ATTACH_FILES = 5` 유지**(`:50`). 산술이 결론을 준다: 다중이면 이미지 금지라 최대 = 표 5 = 5, 단일이면 표 2 + 이미지 3 = 5. 두 경우 모두 5 안에 정확히 들어간다. 상향도 종류별 카운트도 불필요하다.
- **`MAX_FORMS <= MAX_ATTACH_FILES` 계약 테스트**를 건다. 나중에 `MAX_FORMS`만 6으로 올리면 표 6장이 `too_many_files`로 조용히 반려된다.
- **`MAX_MAIL_RECIPIENTS = 30000`**(메일 1통 합계) 신설. 유닛별 3만(`agency-send-intake.ts:29`)은 그대로지만 5 x 3만 = 15만 행이 한 트랜잭션에 들어가면 힙과 커넥션을 동시에 오래 잡고 POP3 세션이 끊긴다. 넘으면 접수 **전에** 반려하고 "나눠 보내주세요"로 지시가 명확하다.
- `:495` 반려 문구를 갱신한다(현행 "요청서 양식 파일 하나와 이미지 최대 3장까지만"이 다중 신설로 거짓이 된다).

#### 계정과 회사 - 요청서마다

**메일 단위 상속 금지.** 각 요청서는 자기 칸으로만 계정을 정한다. "첫 요청서 계정을 나머지가 물려받는다"를 만들면 **첨부 순서가 돈 귀속을 정하게 되고**, 불변 19가 금지한 기본 계정과 같은 부류의 조용한 오귀속이다.

- 계정 확정(`matchBillingTarget`)과 회사 게이트(`enforceCompanyGates`)를 **요청서마다** 돌린다. 같은 회사면 `Map<companyId, boolean>` 메모로 쿼리 1회.
- **한 메일의 요청서는 전부 같은 `company_id`**여야 한다. 갈리면 `multi_company_not_allowed` 전량 반려. 근거: `agency_send_email_intake`의 `company_id`·`user_id`가 스칼라라(`:688`) 여러 회사를 적을 자리가 없고, 그러면 회사 일일 상한과 자격 게이트가 한쪽만 검사하며 이미지 저장 경로(`saveMmsImageBuffer(acct.companyId, ...)`)가 정해지지 않는다. **회사가 갈리는 요구가 실제로 확인되면 그때 intake 원장을 건 단위로 쪼개는 별도 DDL 작업**이고, 이 커밋에 섞지 않는다.
- **일일 상한은 메일 통수 유지**(`:414` · `:431`). 건수로 세려면 `SUM(cardinality(request_ids))`인데 **반려 행은 `request_ids`가 NULL**이라 위조 폭주를 못 센다. 상한의 목적과 정반대가 된다. 요청서 5개 상한이 폭 제한을 맡는다. 문서와 `OPS.md §2-2-D`에 "상한 단위는 통수이고 한 통이 5건까지 될 수 있다"를 명시한다.

#### 트랜잭션과 재개

**N건 `createRequestCore` + intake `accepted` UPDATE + `request_ids` 전량을 한 트랜잭션.** 선례가 이미 있다. 원스텝 다건이 같은 모양이고 실패 문구까지 갖고 있다(`routes/agency-send.ts:340~381` · "아무것도 접수되지 않았습니다").

| 죽는 지점 | 원장 | 결과 | 재개 |
|---|---|---|---|
| 선점 전 | 행 없음 | 무영향 | 독약 메일 안전망(`:848~857`) |
| 선점 후 · 트랜잭션 전 | `claimed` | 접수 0 · 디스크 고아 이미지 | 10분 뒤 재선점 후 전량 재실행 |
| **트랜잭션 안 · 3번째 도중** | `claimed`(미커밋) | **1·2번도 없다**(PG 롤백) | 10분 뒤 재선점 후 전량 재생성 |
| COMMIT 직후 · 회신 전 | `accepted` | 접수 N건 유효 | `claimIntake`가 `accepted`를 안 잡는다 = 이중 접수 0 |

**부분 커밋이 구조적으로 없으므로 재개 판정 자체가 불필요하다.**

**`claimed` 재선점에 시도 상한을 건다.** 지금 `:233~243`은 `attempt_count`를 올리기만 하고 `FAIL_MAX_ATTEMPTS`를 안 본다(`failed` 경로에는 있다 · `:224`). 통 단위 격리(`:834~861`)는 예외를 잡지 OOM·타임아웃으로 **프로세스가 죽는 것**은 못 잡고, 그러면 행이 `claimed`로 남아 10분마다 영구히 재선점되며 `MAX_PER_TICK = 10` 슬롯을 계속 먹는다. 다중이 한 통의 작업량을 최대 5배로 키워 이 확률을 직접 올린다. 수정 = 재선점 UPDATE와 틱 필터(`:828`)에 `attempt_count < FAIL_MAX_ATTEMPTS` 추가 + 소진 시 `failed` 종결 + 경보 1건 + 사용자 회신(0828 침묵 금지 규율).

#### 멱등 - 층을 하나 더

- 1층(UIDL 선점 `:216~255`)과 2층(`message_hash` `:257~266`) **무변경**.
- 3층(`:633~651`) **요청서마다** 실행. §21-3 (2)의 대조 키 보정이 선행 조건이다.
- **신설 3.5층 = 메일 내부 중복.** 같은 요청서를 2장 첨부하면 **DB 조회로 절대 못 잡는다**(한 트랜잭션 안 형제 건은 아직 커밋 전이다). 4요소 키(문안·시각·정렬된 번호 집합 해시·확정 계정)를 `Set`으로 대조해 겹치면 `duplicate_in_mail` **전량 반려**.
  - **3.5층은 스킵하지 않는다.** 아직 아무것도 커밋되지 않아 반려해도 그 메일 하나만 고치면 끝이고(무한 왕복 구조가 없다), 같은 4요소 두 장은 "둘 중 어느 것이 의도인가"가 미확정이라 우리가 고를 수 없다. 조용히 하나를 버리는 것은 금지다.
  - **이 층을 빼면 이 축은 이중 발송 경로를 신설하는 축이 된다.** 새로 생기는 사고 경로 중 1순위.

#### 부분 실패 - 오류는 전량 반려, 3층 중복만 스킵

**"전량 아니면 전무"는 오류 축에서만 유지한다.** 중복 축은 성격이 다르다. 차단 집합이 "미종결이고 발송 전"이므로(`agency-send-state.ts:123~124`) 3층에 걸렸다는 것은 **사용자가 원한 상태가 이미 원장에 있다**는 뜻이고, 고칠 것이 없는 건을 반려하면 회신에 적을 지시가 없다. 그게 무한 왕복의 원인이다(5장 접수 후 3번만 고쳐 5장 재전송하면 1·2·4·5가 3층에 걸려 전량 반려되고 3번은 영영 안 들어온다). 재전송이 새 UIDL로 1·2층을 통과해도 3층은 **커밋된 요청 행** 대조라 UIDL과 무관하다.

안전 장치 6개:
1. **판정과 커밋 분리.** `planUnit`이 단위마다 `ok | skip_duplicate | reject`를 낸다. `reject`가 하나라도 있으면 스킵 계산을 버리고 **전량 반려**(스킵이 오류를 가리는 조합 원천 차단).
2. **스킵 후 0건이면 접수가 아니다.** 남은 단위 0이면 요청을 만들지 않고 `rejected` · `duplicate_request`로 종결(오늘 단일 경로 자리 그대로 · `:645~649`). `accepted`와 `request_ids` 스탬프는 실제로 만든 요청이 1건 이상일 때만(통과 스탬프 원칙).
3. **커밋 안 재확인은 fail-closed.** 트랜잭션 안에서 삽입 직전 같은 3층 SQL을 다시 돌려 새 중복이 보이면 스킵으로 강등하지 않고 **전량 롤백 후 반려**한다.
4. **침묵 금지.** 스킵이 있으면 회신 본문이 달라진다. "3번 요청서는 이미 접수돼 진행 중입니다(다시 보내실 필요 없습니다). 1·2번을 접수했습니다." **고칠 것과 이미 되어 있는 것을 문장으로 분리**한다.
5. **원장 관측 · DDL 0.** `finalizeIntake`가 `accepted`에서도 `reason`을 `COALESCE`로 쓰므로(`:272~289`) `duplicate_skipped:2` 같은 값을 남겨 슈퍼관리자 패널에서 발생률이 보이게 한다.
6. **불변식 교체.** "전량 아니면 전무" 대신 **"접수 뒤 원장에 있는 집합 = 사용자가 이 메일로 의도한 집합"**(이미 있던 것 + 새로 만든 것)을 테스트로 고정한다.

#### 이미지 - 다중이면 반려

요청서 2장 이상인 메일에 이미지가 1장이라도 있으면 `multi_form_with_image` 반려. **판정은 이미지 저장(`:582`)보다 앞**에 둔다.

불변 23이 "첨부 순서"를 귀속 근거로 고른 것은 요청서가 정확히 하나였기 때문이다. 파일명 칸으로 되돌아가는 것은 불변 23이 이미 버린 길이고(오타 하나로 하루 왕복), 게다가 **파서가 지금 이미지 파일명을 1개밖에 못 읽는다**. 실물 양식은 B24:B26 병합에 3행인데 파서는 "행의 첫 비어 있지 않은 셀 = 라벨"이라 25·26행은 C열 값이 라벨로 읽혀 버려진다. 다값 읽기는 세 입구가 공유하는 파서를 건드리는 별건이다.

반려 문구에 출구를 함께 준다: "이미지가 들어가는 요청서는 메일 한 통에 하나씩 보내주세요. 메일을 나눠 보내시면 그대로 접수됩니다."

#### 회신과 문자

- **회신 1통에 건별 결과.** 단건이면 현행 문구 그대로(회귀 0), 다건이면 "총 N건" 머리 + 건별 블록. **통과한 것도 적는다**(담당자가 "B·C는 건드리지 마라"를 알아야 한다). 줄표 0(불변 10 · `em-dash-invariants.test.ts`).
- **N건일 때 회신에 한 줄 추가**: "이 메일에서 N건이 접수되었습니다. **N건 모두 각각 승인해야 N건이 나갑니다.** 승인 문자가 N통 갑니다."
- **접수 완료 회신에 그 건의 계정을 적는다**(`buildAcceptedReply` `:160~197`에 지금 그 줄이 없다). 다중이면 오지정 확률이 N배가 되고, 틀렸다는 사실을 아는 유일한 자리가 월말 청구서가 된다.
- **`retryPendingReplies`가 `request_ids[0]`만 읽는 것을 고친다**(`:737`). `WHERE id = ANY($1::uuid[])` 전량 조회. 그 SELECT에 새 컬럼을 넣지 마라(`:738` 주석: 컬럼 부재 시 재시도 패스가 통째로 멈춘다). **다중이 만든 결함이므로 같은 커밋 필수.**
- **승인 문자 순번을 `notifyManager` 호출부 세 곳 전부에 적용**한다(`agency-send-worker.ts:423~429` 시각 확인 · `:442~448` 승인 요청 · `:850~855` 미발송 안내). 승인 문자만 고치면 나머지 둘이 같은 라벨 N통으로 남는다. 통합 양식에서 갈라진 건은 `file_name`이 같아 `shortLabel`이 구별되지 않는다.
- **다중 유닛의 `fileName`은 그 요청서의 첨부 파일명**을 넘긴다(지금 이메일 경로는 `listName` 하나를 쓴다 · `:516` · `:527`).
- **묶음 승인 링크를 만들지 않는다.** 링크는 건별·번호별 서명 그대로(불변 1). 한 번 눌러 N건이 나가면 "이 사람이 무엇을 승인했나"가 무너진다.
- **접수 완료 회신에 승인 링크를 싣지 않는다.** 토큰 계약이 "토큰 소지 = 그 담당자 번호의 폰 소지"(`agency-send-link.ts:17~18` Harold 0825 수용)인데, 이 수용은 **전달 채널이 그 번호로 가는 문자 하나**라는 전제 위에 있다. 메일에 실으면 전달 한 번으로 승인권이 넘어가고, 0830 강화 3종(승인 즉시 전원 통보·감사 로그·IP 리미터)은 전부 사후 축소라 이를 못 막는다. 대체 = 통수와 순번 규칙만 고지.

#### 화면

- **목록 메타 줄에 회신번호를 표기한다**(`AgencySendPage.tsx:323`). 지금 제목은 `fileName || content.slice(0,24)`, 메타는 "출처 · N명 · 타입"이라 **한 파일에서 갈라진 N행이 완전히 동일하게 보인다.** `callbackNumber`는 이미 `toPublic`에 실려 내려오므로 서버 0 · DDL 0 · 쿼리 0.
- **화면 예고 한 줄**: 접수 직후 "메일 한 통으로 N건이 접수됐습니다. 승인 문자가 N통 갑니다." 작성 안내 시트의 기존 문장(`build-agency-request-form.js:167`)을 화면으로 복제한다.
- **묶음으로 접지 않는다.** 목록의 단위는 "승인해야 할 것"이고 승인은 건별이다. 접으면 승인 대기 N건 중 일부가 접힌 채 잊힌다(`AgencySendPage.tsx:192`가 같은 이유로 `waitingList`를 페이징에서 뺐다).
- 신규 반려 코드(`too_many_forms` · `duplicate_in_mail` · `multi_form_with_image` · `multi_company_not_allowed`)는 `AgencyMailIntakePanel.tsx`의 `REASON_LABEL`에 **같은 커밋** 등재. 워커가 `export const MAIL_REJECT_REASONS = [...] as const`로 집합을 내보내고 테스트가 순회 대조하면 이후 신설분이 자동으로 걸린다.

#### 코드 구조 - 함수 경계가 곧 장애 경계

`processMessage`는 지금 360줄 단일 함수다(`:359~720`). 다중을 그 안에 밀어 넣으면 500줄이 되어 "어디서 죽으면 어떻게 되는가"를 읽을 수 없다. 넷으로 나눈다(파일 이동 없음).

1. `resolveMailContext(ctx, seq, uidl)` — 1~6단계(헤더·신원·선점·주소 상한·크기 게이트). **무변경 이식.**
2. `buildIntakeUnits(atts)` -> `{ units, rejectReason }` — **순수 함수.** 현행 1개·2개 분기를 그대로 옮기고 3개 이상만 확장. 순수 함수가 되면 표 파일 1·2·3·5개 조합과 자립형/비자립형 섞임을 vitest로 전수 고정할 수 있다.
3. `planUnit(unit, ctx)` -> `ok | skip_duplicate | reject` — 8b~10단계(계정 확정·명단 파싱·`analyzeOneStep`·3층). DB 쓰기 0.
4. `commitUnits(plans, claimedId)` — 한 트랜잭션에서 `createRequestCore` N회 + intake UPDATE + COMMIT.

`reject(reasons, code)`에 유닛 접두 헬퍼를 더한다. **단건이면 접두 없음**(회신 문구 회귀 0).

### §21-5. 회귀 보증

#### 파서 기준본 8개 (구현 **전**에 뜬다 · 2026-09-05 캡처 완료)

| 입력 | 고정된 결과 |
|---|---|
| 배포 양식(현행·빈칸) | 발송ID 빈값 · 에러 4건(문안·보낼 시각·회신번호·담당자 번호) |
| Harold 첨부본 | 위와 **완전 동일**(담당자들이 우리 양식을 그대로 쓰고 있다는 증거) |
| 값 채운 통일 양식 | 에러 0 · 명단 2행 |
| 빈 줄에 "청구 계정" 기재 | `billingTarget = '금강제화'` · 에러 0 |
| 빈 줄에 "광고 여부: 아니오" | `isAd = false` |
| 빈 줄에 "수신자 열 이름" | 열 이름 그대로 |
| 구양식(시트 "요청서") | 통일 양식과 동일하게 통과 |
| 청구 계정 중복 기재(값 다름) | `청구 계정` 필드 에러 1건 |

구현 후 같은 8개를 다시 통과시켜 **한 글자도 달라지지 않았음**을 대조한다.

#### 소스 문자열 계약 테스트 5개를 동작 테스트로 승격

`__tests__/agency-send-email.test.ts:152~184`가 워커 소스를 `readFileSync` + 정규식으로 본다. 함수 분리로 깨지므로 같은 커밋에서 승격한다. **계약이 약해지는 게 아니라 강해진다.**

1. 이미지 무조건 반려 부활 금지 -> `classifyMailAttachments(atts, form)` 순수 함수 신설·export. `{forms, images, others, reject}` 반환.
2. 이미지 파일명 칸 + 첨부 0 -> 같은 함수가 `reject.code === 'image_not_attached'`.
3. 저장은 계정 확정 뒤 -> **타입으로 고정.** 저장기를 `(companyId, buf) => SavedImage`로 주입하면 계정 확정 전 호출이 타입상 불가능해진다. 반려 시 삭제는 스텁 주입 후 `unlink` 호출수와 저장 호출수 일치 단언.
4. 코어 인자 형태 -> `commitUnits`가 `createRequestCore`를 주입받고 인자 배열 전체를 단언. 유닛 순서·`mmsImagePaths`·`source:'email'`이 한 단언에 고정된다.
5. 회신에 이미지 순서 -> `buildAcceptedReply`를 export(이미 순수 함수). 신설분(순번·계정·스킵 고지)도 같은 층에서 고정.

`:178~183`(반려 코드와 프론트 라벨표 대조)은 두 패키지 집합 대조라 소스 읽기를 유지하되 `MAIL_REJECT_REASONS` 배열 순회 형태로 바꾼다.

#### 경로별 회귀 판정

| 오늘 도는 경로 | 판정 |
|---|---|
| 표 1개 통일 양식 | **동일**(분기 무변경 · 27행은 `occurrences`에 빈 값 한 쌍을 더할 뿐이고 `distinct` 필터가 버린다) |
| 표 2개 요청서 + 명단 | **동일**(명단 파일은 `looksLikeRequestForm` false라 자립형 조건에 못 든다) |
| 구양식 시트 "요청서" + 명단 | **동일**(`hasRecipientSheet` false = 비자립형) |
| 27행 없는 옛 양식 계속 사용 | **동일**(라벨 없음 = 값 없음) |
| 새 양식 받았지만 27행 비움 | **동일** |
| 빈 줄에 "청구 계정" 적던 다중 귀속 업체 | **동일**(별칭 7종 유지 · 값이 하나면 통과) |
| 이미지 + 요청서 1개(MMS 대행) | **동일**(이미지 금지는 다중에만) |
| 그 주소에 계정 1개 | **동일**(칸이 비면 대조 자체를 안 탄다) |
| 화면 접수 전 경로 | **동일**(손대지 않는다) |

### §21-6. 갈린 지점과 판단 (전원 납득 · 접은 것 포함)

| 쟁점 | 결론 | 접은 쪽과 이유 |
|---|---|---|
| 부분 실패 | 오류 전량 반려 + 3층 중복만 스킵 | 기획·백엔드가 "재전송 = 새 UIDL = 전량 통과" 논거를 **철회**(3층은 커밋된 행 대조라 UIDL과 무관) |
| 별칭 범위 | 3종(`발송 계정` 제외) | 백엔드가 4종을 **철회**. 오탐의 자력 복구 불가가 결정적 |
| 첨부 상한 | 5 유지 | 백엔드가 5->8을 **철회**(다중이면 이미지 금지가 전제를 지웠다) · 회의론자가 "종류별이 더 엄격" 주장을 **철회**(경로별로 반려 집합이 사실상 같다) |
| 개인화 양식 다운로드 | **별건** | 프론트가 **철회**. 다운로드 지점이 로그인 화면 한 곳인데 필요한 사람은 메일 전용 담당자라 축이 어긋난다. 게다가 한 주소에 계정이 여럿인 집합에는 표시명 없는 첫 행이 정상적으로 남아(`routes/admin.ts:1898` 두 번째 등록부터 필수) 안전장치가 하필 그 행에서 빈칸을 만든다 |
| 회신에 승인 링크 | **철회** | 토큰 계약이 문자 채널 전제 위에 있다 |
| 묶음 표시(N건 중 M번째) | **별건** | 조인 또는 DDL이 필요한데, 실제 아픔("N행이 똑같아 보인다")은 이미 내려오는 `callbackNumber` 한 줄로 닫힌다 |
| 라벨 이름 | `발송 ID`(Harold 확정) | 사용자 노출 "청구 계정" 문자열 7곳 실측 · 내부 필드 키와 테스트는 무변경 |
| `kickFirstTest` 직렬 기동 | **철회**(대상 없음) | 메일 워커에 호출 0건 실측. 코어는 `own`일 때만 부른다(`agency-send-intake.ts:288`) · 원스텝만 `routes/agency-send.ts:380` |

### §21-7. 수용 위험 (명시적으로 안고 간다)

1. **오첨부가 접수로 바뀐다.** 지난달 요청서를 실수로 함께 첨부한 메일은 지금 `attachments_invalid`로 걸러지는데 앞으로 접수 2건이 된다. "지금 통과하던 게 막히는" 회귀는 아니지만 동작 변경이므로 **회귀 0이라고 부르지 않는다.** 완화 = 회신 첫 줄 건수 고지 + 3.5층 + 건별 승인 게이트.
2. **시트 이름 하나가 접수 건수를 바꾼다.** `RECIPIENT_SHEET_NAMES`는 정확 일치라(`agency-send-form.ts:88`) 담당자가 시트를 "명단"으로 바꾸면 자립형 판정에서 떨어져 조용히 2파일 분기로 간다.
3. **구양식은 다중 불가.** 요청서와 명단의 짝을 정할 신호가 없다.
4. **다중 + 이미지 불가.** MMS 대행 비중이 실제로 높으면 재론 대상.
5. **회사가 갈리는 다중 불가.** intake 원장이 스칼라다.
6. **메일 요청자에게 만료 통지가 가지 않는다.** 승인 안 된 건이 `expired`로 죽을 때 `notifyManager`로 담당자 **문자**에만 간다(`agency-send-worker.ts:850~855`). 대행 실무에서 요청자(메일)와 담당자(번호)는 같은 사람이 아닐 수 있고, 그 경우 요청자는 "접수 완료" 회신만 쥔 채 안 나간 것을 모른다. 다중이 이 구멍을 N배로 키운다. **이번 범위 밖이므로 여기에 등재만 한다.**
7. **A단계 `BATCH = 5`를 한 메일이 통째로 채운다**(`agency-send-worker.ts:51`). 다중 한 통이 5건이면 뒤에 온 메일이 5분을 더 기다린다. `EMAIL_MIN_LEAD_MINUTES = 40`의 여유 계산에 이 대기가 들어 있지 않다. 현재 볼륨에서는 닿지 않으므로 잔여 위험으로만 적는다.
8. **일일 상한을 ENV로 켜면 실효 상한이 최대 5배**가 된다(통수 단위 유지의 대가).

### §21-8. 구현 순서 (단독·순차 · 각 단계 tsc 0 + 테스트)

| 단계 | 내용 | 게이트 |
|---|---|---|
| **0** | 파서 기준본 8개 캡처 (**완료** 2026-09-05) | 산출물 보관 |
| **1** | 선행 커밋 (1) 회신 게이트 4종 동시 | 0/N/N+1/N+2 회차 테스트 |
| **2** | 선행 커밋 (2) 멱등 3층 대조 키 + 컬럼 가드 | 조정된 건 재전송이 차단되는지 |
| **3** | 양식 27행 + 별칭 3종 + 안내 시트 + 양식 재생성 | **파서 왕복 실측** + 기준본 8개 대조 |
| **4** | `buildIntakeUnits` 순수 함수 분리(현행 동작 그대로) | 표 1·2개 조합 전수 고정 |
| **5** | `planUnit` / `commitUnits` 분리 + 다중 개통 | 소스 테스트 5개 승격 |
| **6** | 3.5층 · 스킵 정책 · 회사 강제 · 상한 · `claimed` 시도 상한 | 신규 반려 코드 라벨 등재 |
| **7** | 회신 다건화 · `retryPendingReplies` · 문자 순번 3곳 | 줄표 0 테스트 |
| **8** | 화면 메타 줄 회신번호 + 예고 한 줄 | 빌드 산출물 확인 |

3단계 이후 **매 단계 기준본 8개를 다시 돌린다.**

### §21-9. 실측 1건 시나리오 (배포 뒤 · 테스트 계정)

**첫 실사용이 곧 5건 동시 발송이 되지 않게, 다중 2건짜리 메일 1통으로 먼저 한다.**

1. 통일 양식 2장(서로 다른 문안·명단, 같은 계정)을 한 메일에 첨부해 발송.
2. 회신에 "2건 접수" + 건별 블록 + 각 건의 계정이 찍히는지.
3. 담당자 문자가 순번을 달고 2 x 2통 오는지.
4. 목록에서 2행이 회신번호로 구별되는지.
5. 같은 메일을 그대로 재전송 -> 2건 모두 3층 스킵 -> "이미 접수됨" 회신 + 새 요청 0건.
6. 한 장만 문안을 고쳐 재전송 -> 고친 1건만 접수 + 나머지 1건은 스킵 고지.
7. 3장 중 1장에 오류(지난 시각)를 넣어 발송 -> **전량 반려** + 파일별 사유.
8. 이미지 1장을 붙여 발송 -> `multi_form_with_image` 반려 + 출구 안내.

### §21-10. 구현 결과 (2026-09-05 · 코드 완료 · DDL 0)

**설계와 달라진 것 2건 (구현하며 근거가 바뀌어 접었다)**

1. **담당자 문자 순번 표기 — 넣지 않았다.** 회의론자 R8의 전제("다중이면 승인 문자 라벨이 전부 같아진다")가 구현에서 해소됐다. `shortLabel`이 읽는 `file_name`은 `analysis.fileName`에서 오고, 그 값은 그 단위의 `listName` = **그 요청서의 첨부 파일명**이다. 다중이면 파일명이 서로 다르므로 담당자 문자는 이미 구별된다. 순번을 추가로 얹으려면 워커가 intake를 조회해야 하는데, 그건 목록 조인과 같은 비용이고 프론트가 별건으로 뺀 것과 같은 이유로 접는다. **회신 본문에는 "N건이 접수되었고 각각 승인해야 한다"를 명시했다**(같은 목적을 더 싼 자리에서 달성).
2. **화면 접수 예고 한 줄 — 넣지 않았다.** 프론트가 1차에서 스스로 적은 약점 그대로다. 메일로 요청한 사람은 화면에 들어오지 않으므로 화면 예고는 그 사람에게 도달하지 않는다. 그 자리를 **접수 완료 회신의 건수·승인 통수 고지**가 대신한다.

**넣은 것 (설계 그대로)**

| 축 | 파일 | 내용 |
|---|---|---|
| 회신 게이트 | `agency-send-mail-worker.ts` | `decideReplyGate` 순수 함수 신설(export) · 0=무제한 가드 · `capNotice` 배선 · 재시도 시간 창 |
| 멱등 시각 축 | `agency-send-state.ts` | `emailDupTimeSql(hasOriginalColumn)` 신설 · 컬럼 탐지는 `hasAgencyColumn`(intake CT) export해 재사용 |
| 양식 | `scripts/build-agency-request-form.js` | 27행 `발송 ID` 라벨 + 빈 값 칸 · 안내 시트 2항목 개정 · 산출물 재생성 |
| 파서 | `agency-send-form.ts` | `발송 ID` 계열 별칭 4종 추가(기존 7종 유지 · 내부 field 키 무변경) |
| 첨부 분류 | `agency-send-mail-worker.ts` | `buildIntakeUnits` 순수 함수(export) · `MAX_FORMS = 5` |
| 다중 처리 | 같은 파일 | 단위별 계정 확정·회사 게이트(메모) · 같은 회사 강제 · 3.5층 · 3층 스킵 · 전량 단위 커밋 |
| 회신 | 같은 파일 | `buildAcceptedReply`에 `billingLabel`·`seq` 추가 · `buildMultiAcceptedReply` 신설 · 재시도 전량 조회 |
| 계정 표기 | `agency-send-email.ts` | `describeAccountLabel` 신설(목록 표기와 같은 한 벌) |
| 재선점 | `agency-send-mail-worker.ts` | `claimed` 시도 상한 + 소진 시 `failed` 종결 + 경보 |
| 화면 | `AgencySendPage.tsx` · `AgencyMailIntakePanel.tsx` | 목록 메타 줄 회신번호 · 반려 코드 라벨 9종 등재(0827 누락분 4 포함) |

**검증 (전부 실행해 출력을 본 것)**

| 항목 | 결과 |
|---|---|
| 파서 기준본 8개 대조 | **전부 동일** (구현 전 캡처 대 구현 후) |
| 양식 왕복 실측 | 27행 기재 시 `billingTarget = "금강제화"` · 빈칸이면 `""` + 에러 0 |
| 백엔드 전체 테스트 | 240파일 3776건 통과 (신설 28건 = 회신 게이트 9 · 시각 축 4 · 첨부 분류 15) |
| 백엔드 tsc | 0 |
| 프론트 tsc | 0 |

**미검증 (배포 뒤 Harold님 실측 몫)** = §21-9 시나리오 8항목. 특히 다중 2건 메일 1통을 먼저 보낸다.

**잔여 부채** = §21-7 수용 위험 8항목. 그중 6(메일 요청자 만료 통지 부재)은 이번 범위 밖으로 등재만 했다.

### §21-11. Codex 적대 리뷰 1R (2026-09-05 · critical 0 · high 0 · medium 3)

실행 = 런북 §1~§2 규격. **첫 두 회차가 400으로 즉시 실패했는데 원인은 CLI 버전이 아니라 브로커 좀비였다** — `broker.json`이 가리키던 pid가 이미 죽어 있었고, CLI를 올려도 컴패니언이 그 옛 세션에 계속 붙었다. 런북 §4 처방(`broker.json` 삭제) 뒤 정상 완료. **런북 §5에 이 지문을 등재할 것**: "CLI를 올렸는데도 같은 모델 오류가 반복되면 브로커 좀비를 먼저 의심한다."

| 지적 | 판정 | 처리 |
|---|---|---|
| ② 다중에서 이미지 파일명 누락 검사를 건너뜀 (`image_not_attached`가 `!multi` 안) | **수용** | 검사를 단건·다중 공통으로 올렸다. 다중이면 "한 통에 하나씩" 안내로 반려. 계약 테스트 동반 |
| ③ 재시도 회신에 스킵 목록·발송 계정이 없다 | **부분 수용** | 권고안(회신 스냅샷을 원장에 보존)은 **불수용** — 컬럼 신설이 필요해 DDL 0을 깬다. 재시도는 정본이 아니라 복구 경로이므로 **재발송본임을 밝히고 화면으로 유도**하는 한 줄로 대신했다(침묵하지 않는 것이 계약) |
| ① 지연된 회신이 시간당 상한 집계(`decided_at`)에서 빠진다 | **불수용 · 등재** | `AGENCY_MAIL_REPLY_RATE_PER_HOUR` 기본값이 0(무제한)이라 지금 실효가 0이고, 고치려면 전송 성공 시각 컬럼이 필요하다. **상한을 ENV로 켜는 시점에 함께 볼 것**(§21-7 9번으로 등재) |

**§21-7에 수용 위험 9번 추가** = 회신 상한을 켜면 밀린 회신이 집계를 우회해 실효 상한이 커진다(집계 축이 `decided_at`이라 재전송 시각을 세지 못한다).

**2R (증분 · 범위 = 1R에서 고친 두 줄 + 직접 호출부)** = **approve · No material findings.**
판정 원문 요지: 단건의 파일명+첨부 정상 경로 유지 · 다중 이미지 반려가 저장 전이라 고아 파일 없음 · 재시도 고지가 본문 앞에 한 번만 붙고 다건 머리말 중복 없음.
→ **critical 0 · high 0으로 2R 종결**(CLAUDE.md `codex_review_after_code_change` 종료 조건). 불수용 1건(지적 ①)은 재판정에서도 반박이 없었다.
