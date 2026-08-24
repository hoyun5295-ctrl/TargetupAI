# 대행발송 셀프 접수 설계서 (2026-08-22)

> 호출어 **"대행발송"**. 이 문서가 이 축의 정체성·불변 원칙·구조·이력을 소유한다. 상태·잔여는 §11.
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
