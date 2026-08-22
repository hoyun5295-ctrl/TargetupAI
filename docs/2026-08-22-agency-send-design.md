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
| 가장 중요한 구조 결정 | **큐 적재는 당일 재검사 통과 뒤 1회뿐**(§3-3). 승인 때 적재하지 않으므로 당일 차단에 큐 DELETE가 없다 |
| 돈 | 스팸 검사·테스트 문자·본 발송 전부 고객사 귀속(지금도 고객사 계정으로 하므로 동일). AI 다듬기 크레딧 = 0(§8 결정 대기) |
| 다음 | Harold 승인 → DDL 3건(§7) → 구현 6단계(§9) |

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
4. **⛔ 변수 치환·(광고) 부착·회신번호 검증·채널 확정은 직접발송과 같은 CT만 쓴다.** 이 축에 치환 함수·광고 문구를 새로 쓰지 않는다(2-5).
5. **⛔ 비용은 전액 고객사 귀속.** 스팸 검사(테스트폰)·담당자 테스트 문자·안내 문자·본 발송 전부 회사 차감. 우리가 대신 내는 항목이 없다(Harold 확정 · 2-3과 동일).
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
   │                        ▲      │                  │
   │ 3회 차단               │      │ 시각 임박·미승인  │ T-2h 차단
   ▼                        │      ▼                  ▼
test_failed ─문안 수정·재접수┘   expired          reapproval(안내 단문 → 다듬기·재검사 → 테스트 발송 → 재승인 대기)
                                                      │ 재승인(시각 유효) → approved / 시각 지남 → 새 시각 입력 → approved
                                                      │ 2회 더 차단 → test_failed
cancelled = 담당자 취소(queued 전 = 상태만 / queued 후 = cancelCampaign CT)
```

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
| B 당일 재검사 | `approved` AND `requested_at` ∈ (now+1h50, now+2h] | `final_testing` → 같은 루프(텍스트) → 통과: **캠페인 행 + 큐 적재**(직접발송 commit과 같은 CT 순서 · `sendreq_time = requested_at` · MMS면 `mms_image_paths` 그대로 전달) → `queued` / 차단: Harold 원문 안내 단문 → 다듬기·재검사 → 통과 문안 테스트 발송(MMS면 이미지 포함) → `reapproval` / 더 차단: `test_failed` |
| C 만료 | `awaiting_approval`·`reapproval` AND `requested_at - now < 2h` | `expired` + 안내 단문 |
| D 대조 | `queued` ↔ `campaigns.status` | 캠페인이 `cancelled`면 원장도 `cancelled`(이중 진실 안전망, 6원칙 ③) |
| E 복구 | `testing`·`final_testing`이 30분 넘게 lock | 상태 되돌림(옛 워커 `generating_at` 선례) |

재검사 소요 = 테스트폰 결과 대기 25초 × 최대 3회 + 다듬기 호출 ≈ 3~5분. 2시간 창 안에서 여유가 있다.

### 4-5) 안내 단문 5종 (인증 라인 · 회사 발신번호 · 회사 차감)

| 시점 | 문안 |
|---|---|
| 1차 통과 | 테스트 문자(본문 그대로) + `[대행발송] 스팸 검사를 통과했습니다. 로그인하여 문안을 확인하고 승인해 주세요.` |
| 당일 차단 | `[대행발송] 기존에 예약된 대행발송이 스팸필터테스트에 걸려서 예약취소 되었습니다. 곧 다시 문안 안내 드릴테니 로그인 하시어 승인 바랍니다.` (Harold 원문) |
| 재검사 통과 | 테스트 문자 + `[대행발송] 수정한 문안이 스팸 검사를 통과했습니다. 로그인하여 재승인해 주세요.` |
| 3회 차단 | `[대행발송] 문안이 세 차례 스팸 검사에 걸렸습니다. 로그인하여 문안을 수정해 주세요.` |
| 미승인 만료 | `[대행발송] 승인이 없어 요청 시각에 발송되지 않았습니다. 로그인하여 시각을 다시 정해 주세요.` |

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
| ① 전수 grep(쓰기 경로까지) | 큐를 만드는 경로는 워커 B 한 곳. 큐를 지우는 경로는 `cancelCampaign` CT 한 곳(새로 만들지 않는다). 구현 후 `bulkInsertSmsQueue`·`cancelCampaign` 소비처 grep을 보고에 첨부 |
| ② 효과 검증 후 성공 표시 | 큐 적재 뒤 `smsCountAll(app_etc1 = campaign_id)` 재카운트 = 수신자 수일 때만 `queued`. 다르면 `failed_queue` 이벤트 + 슈퍼관리자 알림 |
| ③ 이중 진실 = 대조 워커 | 원장 `queued` ↔ `campaigns.status` 대조(워커 D). 적재 전에는 진실이 원장 하나뿐이라 대조할 것이 없다(3-3의 효과) |
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
| `direct-send` 경로 | **무변경.** 적재 순서를 함수로 빼 쓸 수 있으면 그것을 쓰고, 아니면 같은 CT를 같은 순서로 호출한다(라우트 복붙 금지) | 직접발송 전체 |

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

당일 차단은 운영에서 강제하기 어렵다. 워커 B의 분기는 vitest(검사 결과 주입)로 고정하고, 운영 실측은 6·7로 갈음한다.

---

## 11) 상태·잔여

- **2026-08-22 Harold 설계 승인.** 크레딧 0 · 인디고 톤 · MMS 포함 · 미끼 노출 확정.
- **2026-08-22(밤) DDL 실행완료**(information_schema 4행 실측: 컬럼 1 + 테이블 3). SCHEMA.md 등재 완료.
- **2026-08-23(새벽) §9 6단계 전량 구현 완료 · 배포 대기.**

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

백엔드 tsc 0 · 프론트 tsc 0 · vitest **195파일 2,967건 전부 통과**(신규 33건: 상태 머신 18 + 다듬기 15) · 카탈로그 불변식 9건 통과(ready 승격 뒤) · 줄표 불변식 통과 · 변경 파일 자가 grep(모델명·native dialog·줄표) 0.

### 11-4) 남은 것 (다음 세션 착수 순서)

1. **§12 자가 발견 의심 3건 판정·정정** (아래. 전부 미검증 = 코드를 읽고 추론한 것)
2. **Codex 적대 검토** (§13 요청문 그대로. 세션 한도로 2026-08-23 실행 중 중단했다)
3. **프론트 `build:safe`** (리뷰 통과 후 1회)
4. **배포 → §10 실측 9건** (Harold). 특히 6·7·8·9는 화면에서만 확인된다
5. 슈퍼관리자 현황 **화면**(API만 만들었다) = 추가 과제

---

## 12) 자가 발견 의심 3건 (⚠ 전부 **미검증** · 다음 세션 1순위)

구현을 마치고 코드를 다시 읽으며 찾은 것들이다. **실행으로 확인하지 않았다.** 판정부터 하고 고친다.

### 12-1) 부분 적재된 큐가 발송될 수 있다 (가장 위험)

`agency-send-worker.ts` `queueForSend`: 캠페인 행(`status='scheduled'`)을 **먼저** 만들고 큐를 적재한 뒤 `smsCountAll`로 센다. 어긋나면 `test_failed`로 되돌리는데, **이미 만든 캠페인 행과 부분 적재된 큐는 그대로 남는다.**

발송의 진실은 MySQL 큐다(`sendreq_time`이 요청 시각). 그러면 원장이 `test_failed`여도 **적재된 일부가 그 시각에 나간다.** 0611 사고의 반대 방향(원장은 실패인데 큐는 산다)이다.

**처방 후보**: 불일치를 만나면 ① 그 캠페인 id로 `cancelCampaign` CT를 불러 큐를 지우고(효과 검증 포함) ② 그다음에 `test_failed`로 적는다. 캠페인 행 생성을 큐 적재 **뒤**로 미루는 방법은 `app_etc1`에 campaign id가 필요해서 성립하지 않는다.

### 12-2) 재승인이 구조적으로 불가능하다

`runFinalTest`가 당일 차단 뒤 `reapproval`로 보낼 때 `requested_at`을 그대로 둔다. 그 시점은 발송 2시간 **미만** 전이다.
그런데 `checkApproval`은 `minutesLeft < FINAL_TEST_LEAD_MINUTES(120)`이면 `TOO_LATE`로 거절한다.
→ **담당자가 재승인 버튼을 눌러도 항상 거절된다.** 안내 문자는 "다시 승인 바랍니다"라고 하는데 실제로는 시각을 먼저 바꿔야 한다.

**처방 후보**: ① `reapproval` 안내 문자와 화면에 "새 시각을 정한 뒤 승인"을 명시하고 ② 상세 화면에서 시각 입력을 승인 버튼 위로 올리거나, ③ 재승인 때는 시각 변경과 승인을 한 번에 받는 문(`POST /:id/reapprove`)을 만든다. ③이 1클릭 원칙에 맞다.

### 12-3) 승인됐는데 발송도 만료도 안 되는 건이 생길 수 있다

`isFinalTestDue`는 남은 시간이 **110분 초과 120분 이하**일 때만 참이다(창 10분, 워커 5분 주기).
워커가 한 tick이라도 밀리거나 앞 건 검사가 길어져 창을 넘기면 그 건은 `approved`로 남는다.
`isApprovalExpired`는 `awaiting_approval`·`reapproval`만 보므로 **`approved`는 만료로도 가지 않는다.** 요청 시각이 지나도 아무 일도 일어나지 않는다.

**처방 후보**: ① 창을 "≤120분"으로 열고 대신 `final_test_at`으로 중복을 막거나 ② `approved`인데 `requested_at`이 지난 건을 만료로 보내는 분기를 워커 C에 더한다. 둘 다 필요할 수 있다.

---

## 13) Codex 적대 검토 요청문 (다음 세션에 이대로 실행)

⚠ 실행 전 §12를 먼저 고친다. 고친 뒤라면 [함께 볼 지점]의 1·5번은 "그 처방이 맞는지"로 바꿔 묻는다.

**커맨드**: `adversarial-review`(돈·발송·DB 마이그레이션 경로). 백그라운드로 띄우되 런처를 죽이지 않는다(런북 §1-4).

```
[검사 재실행 금지] tsc, vitest, npm, psql을 실행하지 마라. 이미 통과했다: 백엔드 tsc 0, 프론트 tsc 0, vitest 195파일 2967건 전부 성공. 소스만 읽고 판정하라.

[범위] 아래 6개 파일만 본다.
packages/backend/src/utils/agency-send-state.ts
packages/backend/src/utils/agency-send-refine.ts
packages/backend/src/utils/agency-send-worker.ts
packages/backend/src/routes/agency-send.ts
packages/backend/src/utils/plan-guard.ts (추가된 canUseAgencySend, isActivePaidPlan, agencySendEnabled 부분만)
packages/backend/src/routes/companies.ts (my-plan 응답에 agency_send_allowed 추가한 부분만)
그 밖의 변경 파일은 대상이 아니다. 발견해도 [범위 밖] 파일:라인 한 줄 요약만 남겨라.

[변경 설계] 대행발송 셀프 접수 신규 축이다. 고객사 담당자가 명단 파일과 문안, 보낼 시각, 담당자 번호를 접수하면 워커가 스팸 검사를 하고, 걸리면 AI로 문안을 다듬어 재검사하고, 통과하면 담당자 휴대폰으로 문안을 보낸 뒤 승인을 기다린다. 승인하면 상태만 바꾸고, 발송 2시간 전에 다시 검사해서 통과할 때만 캠페인 행과 MySQL 큐를 만든다. 당일 검사에서 걸리면 예약을 취소하고 다듬어 재승인을 받는다. 핵심 설계 결정은 큐 적재를 당일 재검사 통과 뒤 한 번만 하는 것이다. 승인 시점에 큐를 만들지 않으므로 당일 차단에 지울 큐가 없다. 이것은 2026-06-11 예약취소 87014건 실발송 사고(큐 DELETE 0건인데 성공 표시)의 경로를 구조로 없애려는 것이다.

[함께 볼 지점]
1. agency-send-worker.ts의 queueForSend가 이 축에서 큐를 만드는 유일한 자리다. 캠페인 행을 먼저 만들고 큐를 적재한 뒤 smsCountAll로 다시 세어 기대와 다르면 test_failed로 돌린다. 이때 이미 만든 캠페인 행과 부분 적재된 큐가 남는데, 그 상태에서 발송이 일어날 수 있는 경로가 있는가.
2. runFinalTest에서 approved 상태를 final_testing으로 선점할 때 UPDATE 조건에 status = approved를 넣어 두 tick이 같은 건을 잡지 못하게 했다. 그런데 runFirstTest는 FOR UPDATE SKIP LOCKED를 쓴다. 두 방식이 섞여 있어도 중복 처리가 없는가.
3. routes/agency-send.ts의 승인은 UPDATE 조건에 status와 content_version을 함께 넣어 이중 승인을 막는다. 워커가 같은 순간 content_version을 올리면(saveTestResult) 어떤 순서로든 안전한가.
4. 접수는 pool.connect로 트랜잭션을 잡아 requests와 recipients를 함께 넣고 COMMIT 전에 건수를 센다. client.release가 모든 경로에서 불리는가. 예외가 던져진 뒤 ROLLBACK이 실패하면 커넥션이 새는가.
5. agency-send-state.ts의 isFinalTestDue는 남은 시간이 110분 초과 120분 이하일 때만 참이다. 워커 주기가 5분인데 이 창을 놓치는 건이 생길 수 있는가. 놓치면 isApprovalExpired가 받아 만료로 가는데, 승인된 건이 만료로 가는 경로는 막혀 있는가.
6. agency-send-refine.ts의 checkRefined는 원문의 날짜 시각 전화번호 URL 변수 토큰이 다듬은 문안에 그대로 있는지 본다. 정규식이 잡지 못해 통과시키는 위험한 변형이 있는가.
```

**종료 조건**: `critical`·`high` 0이면 끝. `medium` 이하는 이 문서에 등재만. **라운드 최대 2회**.
**2라운드부터**는 1라운드에 고친 줄과 그 직접 호출부만 본다(범위를 내가 파일·줄로 먼저 명시).

- 2026-08-22 설계 확정 대기(Harold 답 4건 반영: 재승인 필수 · 변수 치환+컬럼 맞추기 · 비용 전액 고객사 · 허용 시간 안만). 같은 날 **MMS 포함 확정**(이미지 업로드 또는 라이브러리 선택 · 불변 10 · DDL `mms_image_paths`) · **플래그 OFF 뒤 진행 건은 끝까지 처리**(Harold "끌 일 없다" + 동의) · **메뉴 = 직접발송 옆 · "AI Operator 소개" 푸터 이동** · **메뉴는 모든 회사에 보이는 미끼, 플래그 OFF·미가입은 안내 모달 + 요금제 가입 버튼**(§4-8 · Harold "대행발송을 미끼로 하기로 했다").
- 다음 = Harold 승인 → §8 답 → DDL → §9.
