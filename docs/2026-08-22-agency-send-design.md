# 대행발송 셀프 접수 설계서 (2026-08-22)

> 호출어 **"대행발송"**. 이 문서가 이 축의 정체성·불변 원칙·구조·이력을 소유한다. 상태·잔여는 §11.
> 경위: Harold 2026-08-22 "직원 2명이 대행발송에 붙어 있다. 대행발송 메뉴를 만들어 슈퍼관리자가 체크한 업체에만 열고, 담당자가 등록하면 스팸 검사·다듬기·테스트 문자·승인·예약·당일 재검사까지 기계가 돌게 하자. 유료 요금제만."

## 0) 30초 요약

| 질문 | 답 |
|---|---|
| 이게 뭔가 | 고객사 담당자가 수신 파일·문안·시각·담당자 번호를 접수하면 **스팸 검사 → AI 다듬기 → 담당자 테스트 문자 → 승인 → 발송 2시간 전 재검사 → 발송**을 기계가 돌리는 메뉴 |
| 왜 | 직원 2명이 고객사 계정에 들어가 손으로 하던 일. 사람은 승인 버튼만 남긴다 |
| 누구에게 | 메뉴는 **모든 회사에 보인다(미끼)**. 들어가는 것은 슈퍼관리자가 켠 플래그 **AND** 유료 요금제. 나머지는 안내 모달 + 요금제 가입 버튼(§4-8). 판정은 서버 한 곳 |
| 엔진은 어디서 | 옛 자동발송 워커에 같은 파이프라인이 이미 있다(§2-1). 검사 루프·다듬기·알림 문안 CT를 가져다 쓰고, **접수·승인 원장과 워커는 새로** 만든다 |
| 가장 중요한 구조 결정 | **큐 적재는 당일 재검사 통과 뒤 1회뿐**(§3-3). 승인 때 적재하지 않으므로 당일 차단에 큐 DELETE가 없다. 그리고 **적재 자체를 직접발송 배관에 위임한다**(★0823 · §4-4) |
| 돈 | 스팸 검사·본 발송이 고객사 차감(차감의 실체 = 배관의 선차감 + `send_type='agency'`가 청구 축에 있는 것 · §3-5). 담당자 안내·테스트 문자는 무차감. AI 다듬기 크레딧 = 0 |
| 다음 | Codex 적대 검토(§13) → `build:safe` → 배포 → 실측 10건(§10) |

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
2. **⛔ 당일 검사 없이 발송 0.** 워커가 죽어 2시간 전 재검사가 안 돌았으면 그 건은 나가지 않고 `expired`로 안내한다. "승인했으니 그냥 보내자"는 없다.
3. **⛔ 큐 적재는 당일 재검사 통과 뒤 1회뿐.** 승인 시점에는 원장 상태만 바꾼다. 그래서 당일 차단에 큐 DELETE가 없다(2-4의 사고 경로를 구조로 제거). 적재 뒤(`queued`)의 취소만 기존 `cancelCampaign` CT를 탄다.
   **★0823 추가: 적재는 이 축이 직접 하지 않는다.** 검사를 통과하면 `campaign_send_staging`에 넣고 `createDirectSendCampaign`을 부른다. 차감·수신거부 제외·중복 제거·큐 적재·미적재분 환불·`sentTables` 기록·적재 중 취소 감지는 전부 그 배관이 소유한다. 이 축이 큐에 직접 넣는 것은 담당자 안내·테스트 문자(인증 라인)뿐이다.
4. **⛔ 변수 치환·(광고) 부착·회신번호 검증·채널 확정은 직접발송과 같은 CT만 쓴다.** 이 축에 치환 함수·광고 문구를 새로 쓰지 않는다(2-5).
   **★0823 추가: 그래서 문안 변수는 주소록 슬롯 네 칸(`%이름%`·`%기타1~3%`)에 얹는다.** 치환 함수는 값을 **DB 컬럼 이름**으로 찾으므로, 접수 화면이 모은 "변수명 → 값"을 그대로 넘기면 하나도 못 찾고 전부 빈 문자열이 된다. 번역은 `utils/agency-send-vars.ts`가 하고, 다섯 번째 변수는 접수에서 막는다(발송 직전에 조용히 잘리면 안 된다).
5. **⛔ 비용은 전액 고객사 귀속.** 스팸 검사(테스트폰)·본 발송이 회사 차감이다. 우리가 대신 내는 항목이 없다(Harold 확정 · 2-3과 동일).
   **★0823 정정: 본 발송 차감의 실체는 `createDirectSendCampaign`의 선차감이고, 후불 회사의 청구는 `send_type='agency'`가 청구 축에 들어 있는 덕분이다.** 둘 중 하나라도 빠지면 무과금 발송이 된다(실제로 그 상태였다 · §12-A).
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
| `awaiting_approval` | 120분 | 승인 뒤 당일 재검사가 들어가야 한다 |
| `reapproval` | 10분 | 검사를 이미 통과한 문안이다. 남은 일은 예약뿐 |
| `approved` | 10분 | 승인이 끝났다. 워커가 검사·적재를 하면 된다 |

재검사 대상 판정(`isFinalTestDue`)에서 10분 창을 없애고 단조 조건으로 바꿨다. 중복 처리를 막는 것은 창이 아니라 선점 UPDATE(`status='approved'`)다. 재검사 대상과 만료 대상이 **겹치지도 비지도 않는다**(테스트가 1분 단위로 고정).

**`final_test_at` = 지금 문안이 당일 검사를 통과했다는 표시.** 통과 시 워커가 적고, 문안 수정·시각 변경 라우트가 지운다. 재승인 뒤 재검사를 건너뛰는 근거이자, 바뀐 문안이 검사 없이 나가지 못하게 막는 스위치다.

| 상태 | 뜻 | 들어오는 길 |
|---|---|---|
| `received` | 접수됨, 1차 검사 대기 | 접수 |
| `testing` | 워커가 검사 중(lock) | 워커 선점 |
| `awaiting_approval` | 통과 문안을 담당자 번호로 테스트 발송함, 승인 대기 | 1차 검사 통과 |
| `test_failed` | 원문·다듬기·최소 수정 3회 모두 차단 | 검사 실패 · 안내 단문 |
| `approved` | 승인됨. **큐 미적재.** 요청 시각 대기 | 담당자 승인(버전 일치) |
| `final_testing` | 발송 2시간 전 재검사 중 | 워커 |
| `queued` | 재검사 통과 → 캠페인 생성 + 큐 적재 완료 | 워커 |
| `reapproval` | 당일 차단 → 다듬은 문안 테스트 발송 → 재승인 대기 | 워커 |
| `expired` | 승인·재승인이 요청 시각 2시간 전까지 없음 → 미발송 | 워커 |
| `cancelled` | 담당자 취소 | 담당자 |

### 4-4) 워커 `utils/agency-send-worker.ts` (5분 cron · app.ts 등록)

| 단계 | 조건 | 하는 일 |
|---|---|---|
| A 1차 검사 | `received` | lock → 첫 수신자로 치환한 문안을 CT-09에 넣는다(`maxRetries: 2`, 1회차 콜백 = AI 다듬기, 2회차 = 표현만 최소 수정) → 통과: 최종 문안 저장(`content_version`++) + 담당자 번호로 **테스트 발송**(실제 수신 확인용, 본문 그대로) + 안내 단문 → `awaiting_approval` / 3회 차단: `test_failed` + 안내 |
| B 당일 재검사 | `approved` AND 남은 시간 ≤ 2시간 AND `final_test_at` 없음 | `final_testing` → 같은 루프(텍스트) → 통과: `final_test_at` 기록 후 **예약 위임**(아래) → `queued` / 차단: Harold 원문 안내 단문 → 다듬기·재검사 → 통과 문안 테스트 발송(MMS면 이미지 포함) → `reapproval` / 더 차단: `test_failed` |
| B' 예약만 | `approved` AND `final_test_at` 있음 | 재승인 건이다. **검사하지 않고** 곧바로 예약 위임 → `queued`. 다시 검사하면 승인받은 문안이 또 뒤집히고 남은 시간도 사라진다 |
| C 만료 | `awaiting_approval`·`reapproval`·`approved` AND 남은 시간 ≤ 그 상태의 리드타임 | `expired` + 안내 단문(승인한 건과 승인이 없던 건은 문장이 다르다) |
| D 대조 | `queued` ↔ `campaigns` | 캠페인이 `cancelled`면 원장도 `cancelled`. `send_phase='failed'`면 상태는 그대로 두고 이벤트·안내 1회(일부가 이미 나갔을 수 있어 "미발송"으로 적으면 거짓이 된다) |
| E 복구 | `testing`·`final_testing`이 30분 넘게 lock | 상태 되돌림(옛 워커 `generating_at` 선례). **예약을 이미 만든 건은 되돌리지 않고 `queued`로 올린다** — 되돌리면 다음 tick이 한 벌 더 만든다 |

**예약 위임(★0823).** `campaign_send_staging`에 수신자를 넣고(`staging_id` = 접수 id) `countStagingFiltered`로 정제 후 건수를 센 뒤 `createDirectSendCampaign`을 부른다(`sendType: 'agency'` · `scheduled: true` · `scheduledAt = requested_at`).
멱등의 근거는 원장의 `campaign_id`가 아니라 **캠페인이 들고 있는 `staging_id`**다. 캠페인을 만든 직후 죽으면 원장에는 아직 아무것도 안 적혀 있으므로, 만들기 전에 `staging_id`로 먼저 찾는다. 찾은 캠페인이 `preparing`·`failed`면 발송되지 않는 상태이므로 `expired`로 닫고 다시 만들지 않는다.

재검사 소요 = 테스트폰 결과 대기 25초 × 최대 3회 + 다듬기 호출 ≈ 3~5분. 2시간 창 안에서 여유가 있다.
승인 라우트는 성공 직후 `triggerAgencySendDispatch()`로 워커를 깨운다. 재승인은 남은 시간이 짧아 다음 tick(최대 5분)을 기다리면 그 사이에 만료 기준을 지난다.

### 4-5) 안내 단문 5종 (인증 라인 · 회사 발신번호 · 회사 차감)

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
| 단계 3 · 승인과 예약 | 받은 문자를 확인하고 승인하면 요청한 시각에 예약됩니다. 발송 2시간 전에 한 번 더 검사하고, 걸리면 다시 다듬어 승인을 받은 뒤에만 나갑니다 |
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
```

- `dispatch_key` = **이번 예약 시도의 식별자.** 캠페인이 이 값을 `staging_id`로 들고 있어, 크래시 뒤 재시도가 같은 시도를 두 번 만들지 않는다. 접수 id를 그대로 쓰면 실패한 시도와 새 시도를 가를 수 없어, 한 번 실패한 건이 재예약해도 옛 캠페인에 영원히 막힌다. 문안 수정·시각 변경이 이 값을 지운다(= 새 시도).
- `idx_campaigns_staging` = 예약 직전 멱등 조회(`campaigns.staging_id`)가 매번 전체 스캔이 되지 않게 한다.
- `revision` = **행 수정 번호.** 담당자 경로의 낙관적 잠금이 이 값 하나를 본다(§12-E).
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
    - `SELECT send_type, send_phase, status, target_count FROM campaigns WHERE staging_id = '<접수 id>';` → `agency` · `sent`(적재 완료 후) · 건수 일치
    - 선불 계정이면 `balance_transactions`에 그 campaign_id로 차감 1행. 후불 계정이면 그 달 거래내역서 수량에 이 건이 들어간다
    - 발송결과 화면 유형이 **"대행발송"**으로 보인다(AI 추천이 아니다)
    - 담당자 테스트 문자와 실제 수신 문자에서 `%이름%` 자리에 **명단의 이름이 들어가 있다**(빈칸이 아니다)
11. **재승인 경로(★0823 신설).** 6번의 차단 문안으로 승인까지 마친 뒤 당일 재검사에서 걸리게 두면, 예약 취소 안내 + 수정 문안 + 재승인 요청 세 통이 오고 **화면에서 승인 버튼이 실제로 눌린다**. 누른 직후 예약이 만들어진다(5분을 기다리지 않는다).

당일 차단은 운영에서 강제하기 어렵다. 워커 B의 분기는 vitest(검사 결과 주입)로 고정하고, 운영 실측은 6·7·11로 갈음한다.

---

## 11) 상태·잔여

- **2026-08-22 Harold 설계 승인.** 크레딧 0 · 인디고 톤 · MMS 포함 · 미끼 노출 확정.
- **2026-08-22(밤) DDL 실행완료**(information_schema 4행 실측: 컬럼 1 + 테이블 3). SCHEMA.md 등재 완료.
- **2026-08-23(새벽) §9 6단계 전량 구현 완료.**
- **2026-08-23 `dispatch_key` + `idx_campaigns_staging` ALTER·CREATE 실행완료**(Harold · 배포 전). SCHEMA.md 등재 완료.
- **2026-08-23 §12 판정·정정 완료 · 배포 대기.** 의심 3건은 전부 사실이었고, 파고드는 과정에서 같은 자리(적재)에서 배포를 막는 것 다섯 개가 더 나왔다. 정정 내용은 §12.

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

1. **Codex 라운드 반복**(Harold 지시 2026-08-23: 지적이 안 나올 때까지). 3라운드 진행 중
2. **프론트 `build:safe`** (리뷰 통과 후 1회)
3. **배포 → §10 실측 10건** (Harold). 특히 6·7·8·9·10은 화면·문자에서만 확인된다
4. 슈퍼관리자 현황 **화면**(API만 만들었다) = 추가 과제
5. `campaign_send_staging` SCHEMA.md 등재 = 추가 과제(이 축이 새로 쓰기 시작한 테이블인데 원장에 없다. 컬럼은 기존 `/direct-send/stage` INSERT와 같은 것을 그대로 쓴다)
6. **발송이 끝난 뒤의 상태 표시** = 추가 과제. 상태 CHECK에 종료 값이 없어 발송 뒤에도 원장은 `queued`("예약 완료")로 남는다. 실제 결과는 `campaign_id`로 발송결과 화면에서 본다. 값을 늘리려면 CHECK를 바꾸는 DDL이 필요하다

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
| 4 | 후불 청구에서 빠진다 | 청구 3축이 `campaign_runs` 또는 `send_type IN ('direct','operator')` 기준. 이 축은 `send_type`을 안 넣어 기본값 `'ai'`로 적재됐다(0823 `information_schema` 실측) | 후불 회사도 청구 0 |
| 5 | 결과 동기화·실패 환불이 멎는다 | 같은 집합을 보는 `campaign-lifecycle` 2번 분기. runs도 없다 | `status='scheduled'` 고정 · 화면 유형이 "AI 추천" |
| 6 | 변수가 전부 빈 문자열로 나간다 | 치환 CT는 값을 DB 컬럼 이름으로 찾는데(`customer[mapping.column]`) 워커는 문안 변수명을 키로 넘겼다 | `%이름%님` → `님` |
| 7 | 수신거부를 안 뺀다 | 직접발송은 적재 직전 제외 | 수신거부자에게 발송 |

3과 4를 합치면 **본 발송이 전액 무과금**이었다. 잘못된 환불은 없었다(환불 sweeper 후보 상태에 `scheduled`가 없고, `prepaidRefund`는 차감 원장이 없으면 거절한다).

**정정** = 적재를 손으로 하지 않는다. `campaign_send_staging` 적재 → `createDirectSendCampaign(sendType: 'agency')` → 그 뒤는 배관이 소유한다(§4-4 예약 위임). `send-type-axis` CT에 `agency`를 등재해 결과 동기화·환불·청구 세 축에 합류시켰다. 변수는 주소록 슬롯으로 번역한다(불변 4).

### 12-B) 뿌리 2: 시각 상수 하나가 뜻 셋을 겸했다

`FINAL_TEST_LEAD_MINUTES` 120분이 승인 마감·재검사 시작·적재 여유를 동시에 뜻했다.

- **재승인이 구조적으로 불가능했다(옛 §12-2).** `reapproval`은 정의상 2시간 미만이 남은 때 생기는데 승인이 2시간을 요구했다. 승인 버튼은 100% 거절됐고, 더 나쁘게는 만료 판정이 `reapproval`을 그대로 잡아 **재승인 안내 문자를 보낸 다음 tick(최대 5분)에 "승인이 없어 발송되지 않았습니다"가 갔다.**
- **승인된 건이 창을 놓치면 어디에도 안 걸렸다(옛 §12-3).** 재검사 창은 10분뿐이고 만료 판정은 `approved`를 보지 않았다. 발송도 만료도 안내도 없었다.

**정정** = 필요한 리드타임을 상태가 정한다(`requiredLeadMinutes`). 재검사 창을 없애고 단조 조건으로 바꿨다. 만료 대상에 `approved`를 넣고 안내 문장을 사유별로 나눴다. 승인 라우트가 워커를 즉시 깨운다. 재검사 대상과 만료 대상이 겹치지도 비지도 않는 성질을 테스트가 1분 단위로 고정한다.

### 12-C) Codex 적대 검토 1라운드 (2026-08-23 · critical 2 · high 3 전부 수용)

| 지적 | 판정 | 정정 |
|---|---|---|
| 라우트가 관찰한 상태를 조건에 넣지 않는다 | **사실(critical)** | `/cancel`이 `approved`를 읽은 뒤 워커가 예약을 만들면 큐 삭제를 건너뛴 채 `queued`를 `cancelled`로 덮는다. **화면은 취소, 큐는 발송**(0611과 같은 형태). 라우트 3곳에 CAS를 넣고 0행이면 409 |
| `staging_id` 멱등이 원자적이지 않다 | **사실(critical)** | lock 복구가 되돌린 뒤 두 핸들러가 각자 캠페인을 만들 수 있었다. 워커 선점의 `lock_at`을 lease로 삼아 이후 모든 쓰기에 걸고, lock 복구도 관찰한 `lock_at`으로 CAS |
| `failed`·`preparing` 시도가 영구 고착 | **사실(high)** | `campaign_id`를 적고 닫으니 재예약해도 같은 캠페인을 다시 찾아 또 닫혔다. `dispatch_key`(시도 식별자)를 신설하고 문안·시각 변경이 그것을 지운다 |
| LIMIT 앞의 만료 후보가 재승인 건을 가린다 | **사실(high)** | 후보 SQL에 하한(`남은 시간 > 여유`)을 넣고, 승인 직후 트리거는 전역 배치가 아니라 **그 건만** 집는다 |
| 제목 변수와 본문 슬롯 불일치 | **원인 정정 후 수용(high)** | "제목의 `%이름%`이 쿠폰으로 해석된다"는 부정확하다. 배관은 제목을 **치환하지 않는다**(기존 계약). 실제 결함은 미치환 `%변수%`가 그대로 고객에게 가는 것이라 접수·수정에서 거절한다 |

### 12-E) Codex 2라운드 (2026-08-23 · critical 3 · high 3 · **전부 정정 완료**)

**즉시 정정한 1건(내가 만든 회귀).** `lock_at = NOW()`를 lease로 쓴 것이 틀렸다. PostgreSQL `timestamptz`는 마이크로초를 담는데 드라이버는 밀리초짜리 `Date`로 파싱한다. `RETURNING`으로 받은 값을 조건으로 되보내면 `.123456`과 `.123000`이 되어 **정상 소유자의 UPDATE도 0행**이 되고, 그 건은 `testing`·`final_testing`에 영구 고착된다(복구 CAS도 같은 값을 쓰므로 풀리지 않는다). 선점 시각을 애플리케이션이 만든 밀리초 값으로 넣어 왕복을 보존하게 고쳤다(`newLease()`).

**남은 5건도 같은 날 정정했다.** 뿌리는 하나였다: 이 행은 **워커·담당자·lock 복구·승인 직후 트리거 네 주체**가 만지는데 소유권 모델 없이 조건을 자리마다 덧대고 있었다. 1라운드도 2라운드도 지적의 실체가 전부 "그 조건이 안 걸린 자리"였다. 여섯 번째 조건을 붙이는 대신 소유권을 두 축으로 모았다.

| # | 지적 | 정정 |
|---|---|---|
| 1 | 캠페인 생성이 소유권 경계 밖이고, 생성 뒤 연결 CAS가 0행이어도 성공으로 넘어갔다 | 연결 결과를 확인하고, 실패하면 그 캠페인을 **취소 CT로 중화**한다(`skipTimeCheck`). 중화까지 실패하면 시스템 경보를 던진다 |
| 2 | 결과 미확정 오류인데 `expired`로 닫고, 재예약이 시도 키를 지웠다 | 생성이 예외로 끝나면 **시도 키로 캠페인을 다시 찾아 실제 상태로 확정**한다. 캠페인이 없을 때만 되돌려 다음 tick이 재시도한다(안내는 만료 때 한 번) |
| 3 | `saveTestResult`가 소유권 없이 써서 담당자가 고친 문안을 되덮었다 | 토큰 조건 + 0행이면 즉시 중단. **담당자 알림도 상태 전이가 성공한 뒤로** 옮겼다(옛 순서는 상태가 안 바뀐 건에도 문자를 보냈다) |
| 4 | lock 복구가 캠페인 `send_phase`를 안 보고 `queued`로 만들었다 | `classifyCampaign` 하나를 dispatch와 복구가 함께 쓴다 |
| 5 | 시각 변경 뒤에도 상태·문안 버전이 그대로라 옛 승인이 통과했다 | **행 수정 번호 `revision`** 신설. 모든 쓰기가 +1 하고, 담당자 경로는 화면이 본 값을 조건으로 쓴다 |

**소유권 두 축(DDL 2컬럼 · 실행완료).**

1. **`revision`** = 담당자 경로의 낙관적 잠금. 승인·문안 수정·시각 변경이 화면이 본 값을 되돌려주고 서버가 `WHERE revision = ?`로 쓴다. 0행이면 아무것도 바꾸지 않고 409를 돌려주고, 화면은 현재 상태를 다시 읽어 무엇이 달라졌는지 보여 준다.
2. **`lock_token uuid`** = 워커 경로의 소유권. 선점할 때 발급하고 워커의 모든 쓰기가 조건으로 건다. ⛔ **타임스탬프를 토큰으로 쓰지 않는다** — PG 마이크로초와 드라이버 밀리초가 왕복에서 어긋나 정상 소유자도 0행이 된다.

**취소는 "읽고 나서 쓰기"를 버리고 "잡으면서 읽기"로 바꿨다.** 상태를 원자적으로 `cancelled`로 잡고, 그때 함께 나온 `campaign_id`로 지울 큐가 있는지 정한다. 큐 취소가 실패하면 잡은 상태를 되돌리고 실패를 알린다(원장만 취소로 남고 큐가 사는 0611 형태를 구조로 없앤다).

### 12-D) 이 정정이 만든 계약(다음에 손대는 사람이 지켜야 하는 것)

1. **이 축은 큐에 직접 넣지 않는다.** 넣는 것은 담당자 안내·테스트 문자뿐이다.
2. **새 발송 경로를 만들면 `send-type-axis`에 먼저 등재한다.** 안 하면 기본값 `'ai'`로 적재되어 세 축에서 사라진다.
3. **`final_test_at`은 스위치다.** 문안·시각이 바뀌면 반드시 지운다. 남아 있으면 검사 없이 나간다.
4. **멱등의 근거는 `campaigns.staging_id`다.** 원장의 `campaign_id`는 나중에 적히므로 근거가 못 된다.
5. **문안 변수는 네 개까지다.** 접수에서 막는다.
6. **승인 버전은 적재 직전에 다시 본다**(`isApprovalCurrent`). 라우트에만 두면, 워커가 문안을 다듬은 뒤 상태 전이가 실패해 되돌아간 경로로 **담당자가 못 본 문장이 적재까지 간다**. 게이트는 효과가 만들어지는 함수 안에 있어야 한다.
7. **소유권은 두 축뿐이다**(★0823 Codex 1R·2R critical). 담당자 경로 = 화면이 본 **`revision`**, 워커 경로 = 선점 때 발급한 **`lock_token`**. 새 쓰기 자리가 생기면 둘 중 하나를 반드시 건다. 조건 없이 덮으면 **취소한 건이 다시 예약되고, 담당자가 고친 문안이 옛 문안으로 되덮인다.** ⛔ 타임스탬프를 토큰으로 쓰지 않는다(왕복 정밀도가 어긋난다).
8. **예약 시도에는 식별자가 있다**(`dispatch_key`). 멱등의 근거이자 "실패한 시도"와 "새 시도"를 가르는 축이다. 접수 id를 재사용하면 둘을 못 가른다.
9. **제목에는 변수를 쓸 수 없다.** 발송 배관이 제목을 치환하지 않으므로 `%이름%`이 그대로 고객에게 간다. 접수·수정에서 막는다.

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
