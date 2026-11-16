# C139 발송결과 표시 흐름 표 (테스트 제목 · 여정 변수 표기)

> 접수 = 그룹웨어 오류접수 두 건(2026-11-16)
> - cmwilrt0m1pawjnscgp2enddb 남지현 「발송결과 - 테스트 발송내역 - 제목 표시」(P1): 전송결과 · 예약내역은 상세에서 제목을 볼 수 있지만 테스트발송내역은 내용을 눌러도 제목이 안 보인다 · 내용 누를 때 제목도 함께.
> - cmwilf3re1p9yjnscplq781q6 임은지 「발송결과 - 여정발송 건에 대한 변수값 표기」(P2): 직접발송은 %이름% 으로 보이는데 여정 발송은 개인화된 이름(류지현님)으로 보인다 · %이름% · %매장명% 처럼 변수 자리로.
>   댓글 서수란 「캘린더 쪽 문안도 %개인화% 가 아니라 개인화가 처리된 대표 문안(최수아님 · DM03와)으로 보인다」(캡처).
> 기준 판 = 서버 배포본 f01c711f(= 로컬 HEAD · 아래 파일 중 미커밋 변경은 journey-executor.ts 의 다른 카드(C133) 덩어리뿐이고 아래 줄과 겹치지 않음 · `git status -vv` 덩어리 위치로 확인).
> 칸을 뽑은 패턴 = 백엔드 `INSERT INTO campaigns\b` · `message_content|message_template`(campaigns 표 읽기) · `title_str` · 프론트 `formatCampaignMessageForDisplay\(|\.message_content\b` · `setMsgDetailContent` · `subject|title_str` (PowerShell Select-String · __tests__ 제외).

## 1. 접수 A · 메시지 내용 창의 제목

발송결과 창의 「메시지 내용」 창(ResultsModal.tsx:1412 ~ 1501)은 **한 부품**이고 여는 자리가 넷이다. 창에는 본문 · 유형 · 그림 칸만 있고 **제목 자리가 없다**(1413 `{ content, msgType, mmsImages }`).

| 여는 자리 | 제목 원천(쓰는 쪽) | 서버가 읽나(읽는 쪽) | 화면이 넘기나 |
|---|---|---|---|
| 테스트발송내역 · 담당자 테스트 이력(ResultsModal.tsx:991) | 보낼 때 큐 제목 칸 `title_str` 에 씀: campaigns.ts:453 `prepareSendMessage(subject)` → :461 `insertTestSmsQueue(…, testSubject)` → sms-queue.ts:1353 | 안 읽음: campaigns.ts:1647 읽는 칸에 `title_str` 없음 · :1690 줄에 제목 없음 | 안 넘김(:994) |
| 테스트발송내역 · 스팸필터 테스트 이력(:1056) | 자동 검사만 씀(spam-test-queue.ts:723 `subject`) · 손으로 하는 검사는 **안 씀**(spam-filter.ts:231 · :258 INSERT 에 subject 칸 없음) | 안 읽음: campaigns.ts:1745 | 안 넘김(:1059) |
| 전송결과 · 채널통합조회 내용(:712) | 캠페인 행 `subject` · `message_subject` | 읽음: results.ts:333 | 안 넘김(:714) |
| 전송결과 · 상세 · 발송 내역 줄(:1225) | 큐 제목 칸 `title_str` | 안 읽음: results.ts:58 `SMS_DETAIL_FIELDS` 에 없음 | 안 넘김(:1227) |

값 범위(제목)
- 단문(SMS) = 제목 없음(큐 SMS 줄은 제목을 싣지 않는다 · campaigns.ts:2961 `subjectForMsgType`) · 장문 · 그림(LMS · MMS) = 제목 있음 · 알림톡(K) 창 = 카카오 모양 창(:1415 · 제목 자리 없음 · 이번 범위 밖 그대로).
- 테스트 제목 = 보낼 때 붙은 (광고) 까지 큐에 들어간 그대로 · 채널통합조회 제목 = 저장 원문 + 표기 칸 판정(CampaignDetailModal.tsx:81 · :185 와 같은 식 `buildAdSubjectFront(…, adTextOnFront(is_ad, ad_text))`).
- 손 스팸 검사 = 저장된 제목이 없다(옛 행 전부 · 새 행도 지금 코드로는 없음).

그리는 화면
- 메시지 내용 창 하나(ResultsModal.tsx:1458 ~ 1500 문자 모양 · :1415 알림톡 모양).
- 같은 꼴의 다른 기능 화면(발송결과 밖): 슈퍼관리자 메시지 상세(MessageDetailModal.tsx · AdminDashboard.tsx:3012) · 슈퍼관리자 SmsDetailModal.tsx · 관리 메뉴 통계 StatsTab.tsx:669. 셋 다 제목 0.

## 2. 접수 B · 여정 발송 건의 본문이 한 고객 몫으로 보임

| 단계 | 쓰는 쪽 | 읽는 쪽 |
|---|---|---|
| 고객마다 글 만들기 | journey-executor.ts:899 ~ 903 `renderJourneySmsMessage`(문자) · :894 `fillAlimtalkVarMap`(알림톡) = 변수 · (광고) · 080 을 채운 **완성 글** | :959 보낼 줄 `message` |
| 단계 캠페인 행 만들기(칸마다 하루 한 행) | journey-executor.ts:1055 `representativeMessage: rows[0].message` = **첫 고객의 완성 글** · `subject: rows[0].subject` | journey-step-campaign.ts:294 ~ 306 INSERT `message_content = message_template = 그 글` |
| 다른 생산자(비교) | 직접발송 campaigns.ts:2863(`sanitizedMessage` = 변수 자리가 남은 원문) · AI 캠페인 :681(`sanitizedContent`) · 브랜드 :4529(`message`) · 자동발송 auto-campaign-worker.ts:949(`ac.message_content` 원문) | 같은 칸 |

→ campaigns.message_content 를 쓰는 생산자 여섯 가운데 **여정 하나만** 원문이 아니라 한 고객에게 채운 글을 쓴다.

그 칸을 다시 그리는 화면(여정 행이 닿는 곳 전부)
| 화면 | 서버 | 화면 파일 |
|---|---|---|
| 발송결과 채널통합조회(데스크톱 · 휴대폰) | results.ts:327 | ResultsModal.tsx:713 · :807 |
| 발송결과 상세 | results.ts GET /campaigns/:id | CampaignDetailModal.tsx:69 |
| 캘린더(서수란 댓글) | campaigns.ts:215 | CalendarModal.tsx:345 |
| 슈퍼관리자 발송 통계 상세 | admin.ts:3290 · :3339 GET /stats/send/detail | StatsDetailModal.tsx:154 |
| 관리 메뉴 통계 상세 | manage-stats.ts:270 → stats-aggregation.ts:709 `querySendStatsDetail`(:732 · :806) | StatsTab.tsx:560 |
| 발송결과 목록 엑셀 | results.ts:481 · :518 | (파일) |
| 예약 목록 | campaigns.ts:215 | ScheduledCampaignModal.tsx:151 · 여정 행은 예약 상태가 없어 닿지 않음 |

화면 밖 읽는 쪽(여정 행 포함)
- citations.ts:98 AI 참고 글(최근 30일 완료 캠페인 본문 200자 · 지금은 한 고객 이름이 AI 에 들어간다)
- admin.ts:1012 슈퍼관리자 스팸 차단 규칙 모의(본문에 규칙을 대 봄)
- full-analysis-collect.ts:87 마케팅 진단 글 길이 분포
- human-sent-messages.ts:89 = 직접발송만(여정 행 안 읽음) · analysis.ts:768 = campaign_runs 조인(여정 행 해당 없음)

값 범위(여정 대표 본문)
- 문자 칸 · A/B 칸(고객마다 판이 다름 · 첫 줄 고객의 판) · 알림톡 칸(템플릿 `#{변수}`) · 원문에 (광고) · 080 이 든 판 · Liquid(`{{ }}`) · 추천 자리 표식(C133 · 미배포) · 오늘 이미 열린 행(배포 전에 만든 행은 그날 그대로) · 지난 행(이미 저장된 완성 글).
- 제목 = 여정은 제목에 변수가 있으면 보내지 않는다(journey-executor.ts:769 `journeyCopyIssue` 제목 변수 보류) → 제목은 고객마다 같다(개인정보 아님).

## 3. 판정(접수 대조)

| 접수 | 판정 | 근거 |
|---|---|---|
| A 테스트 제목 | 개선 요청(결함 아님 · 제목을 보여 주는 자리가 처음부터 없음) | 창에 제목 자리 0 · 테스트 목록 서버가 제목 칸을 안 읽음 |
| B 여정 변수 | 결함 | 생산자 여섯 중 여정만 첫 고객의 완성 글을 저장 · 화면 일곱 곳이 그 글을 그대로 그림(캘린더 댓글 포함) · 운영 실측(1116 Harold) = 연결 있는 4행 모두 저장 본문 「…박지민님」 ↔ 칸 원문 「%고객명%님」 |
