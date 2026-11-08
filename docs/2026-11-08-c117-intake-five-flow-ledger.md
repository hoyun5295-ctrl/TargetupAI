# C117 오류접수 다섯 흐름 표(2026-11-08)

> 플레이북 = `status/DEFECT-PLAYBOOK.md` §1 · 설계서 = [2026-11-08-c117-intake-five-design.md](2026-11-08-c117-intake-five-design.md) · 카드 = `status/STATUS-FEED.md` C117
> 칸 뽑기 = 소스 grep(아래 「뽑은 패턴」) · 손 목록 0. 흐름 표 확인 = Harold 1108 「구조체크 → 설계서 → Codex → 구현 → Codex → 보고」 지시(이 범위 = 아래 다섯 접수의 기능 흐름 전체).

## §0 접수 · 판 대조(단계 0)

| # | 접수 | 접수 번호 | 등록 · 재오픈 | 접수 판 | 서버 지금(deployed_head b374ed44 · 1108) |
|---|---|---|---|---|---|
| J1 | 여정 A/B 문안 저장 뒤 스팸검사 · 켜기 | cmw4o2iwn0t4kjnsch8om22yf | 11-06 16:42 | C108(16a7173) 뒤 · C109 배포(15:51) 뒤 | 결함 자리 파일(`journey-pretest-validator.ts` · `spam-test-queue.ts`) 접수 뒤 변경 = C113(4ffe7988) · C114 — 해당 줄 변화 0(grep 확인) = **서버 지금도 같음** |
| J2 | 여정 체크리스트 B-3 메모 | cmw4kd7pt0ruijnsci47lx4a0 | 11-06 14:58 | — | 체크리스트 `docs/2026-11-03-journey-automarketing-checklist.xlsx` B 시트 6행 그대로 |
| B1 | 브랜드메시지 수신거부 인증번호 칸 | cmw4e2ni90qh9jnsckokrc3nf | 11-06 12:02 | C107(11893902) | `BrandMessageEditor.tsx:740` 그대로 |
| B2 | 대체 발송 화면 개선(재오픈 11-06 · 댓글 서수란) | cmw2wry9z0kxjjnscfg0alhc7 | 11-05 11:10 · 재오픈 11-06 15:18 | C107 배포(11-05 23:46) 뒤 화면 | `direct-send.css:2093-2102` · `BrandSendModal.tsx` · `ResultsModal.tsx:741` 그대로 |
| B3 | 브랜드 메시지 통계 개선(재오픈 11-06) | cmw2zk4280lgkjnsc66eok0vw | 11-05 12:28 · 재오픈 11-06 11:13 | C107 뒤 · **C108(19:20) 전** | C108 = 받는 사람 실제 친구로 청구(SMSQ `k_friend_yn`) 배포됨 · 화면 줄 이름은 여전히 대상값 기준(`campaign-axis.ts:126`) · 수신번호별 친구 표시 0 |

## §1 J1 여정 칸 A/B 스팸 검사 흐름

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|---|
| A/B 문안 저장 | `ai.ts:3828` POST variants → `bandit-optimizer createJourneyStepVariant`(`journey_step_variants` id = uuid · variant_id = 'A'·'B'·'C') | `journey-step-versions.ts:77 loadVariantRowsByStep` | id 36자 · 이름표 1자 | 칸 화면 A/B 창 | 정상 |
| 판 목록 | `journey-step-versions.ts:49 stepSendVersions` = `variantId: v.id`(uuid) | 켜기 검증 `journey-pretest-validator.ts:132-229` · 점검 · 칸 검사 `:385` | 변이 0 = null · 있음 = uuid | 점검 칸 「A안 검사 · B안 검사」 | 정상(여정 쪽 식별자) |
| 칸 「A안 검사」 | `ai.ts:4471` → `journeyStepSpamParams`(`:400` uuid 로 판 찾기) → `enqueueStepSpamCheck` **`:445 variantId: params.variantId`** | `spam-test-queue.ts:707-716` INSERT `spam_filter_tests.variant_id` | **uuid 36자 → 칸 varchar(10)**(직원 화면 원문 「value too long for type character varying(10)」) | 검사 창 「검사를 시작하지 못했어요 · 스팸 테스트 큐 등록 오류: value too long…」(`spam-test-queue.ts:768` DB 원문을 그대로) | **결함 D1 · D2** |
| 켜기 자동 검증 | `journey-pretest-notifier.ts:336 · 590 · 913` · 검증 `:184` → `runStepSpamTest` **`:466 variantId: params.variantId`** | 같은 INSERT | 같은 uuid | 켜기 창 「자동 검증에서 2건이 걸렸어요 · 스팸 검사를 마치지 못했어요(검사 장애)」 | **결함 D1**(같은 자리) |
| 변이 없는 칸 | `stepSendVersions` null → `variantId: undefined` | INSERT null | null | 「스팸 검사 통과」 | 정상(직원 관찰 「2 · 3번째 칸은 통과」와 일치) |
| 검사 묶음 결과 읽기 | — | `spam-test-queue.ts:1211` `batch_id` 묶음 안 `variant_id` 순서 = 자동마케팅 runOneTest 결과 이름표 | 'A' · 'B' · 'final'(5) · 'agency'(6) | 자동마케팅 검사 결과 | 정상(여정은 묶음 하나 = 검사 하나 · 이름표를 읽는 곳 없음) |
| 같은 날 이어 보기 · 엿보기 | `spamHashInputsOf` 키 = 회사 · 번호 · 글 지문 · 유형 · 제목 | `peekSpamCheck` · `spamCheckFor` | variant 칸 안 읽음 | 점검 「검사 전 / 통과」 | 정상 |

뽑은 패턴: `grep -rn "enqueueSpamTest(" src` = 5 자리(ai-line-spam:119 · journey-pretest-validator:442 · :463 · spam-test-queue:1588 · 정의) · `grep -rln spam_filter_tests src | xargs grep -n variant_id` = 3 줄(쓰기 1 · 읽기 2) · variantId 를 실어 오는 곳 = runOneTest 호출부(auto-campaign-worker:326 · :1455 · agency-send-worker:405 · continuous-operator:1712 · :1726 · :1733 · :2294 · :2450 · ai-orchestrator:605 · :931) 값 = 'A'~ · 'final' · 'agency' · `v.variant_id`(AI 문안 이름표).

## §2 J2 여정 체크리스트 B-3

| 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 체크리스트 문구 | `docs/2026-11-03-journey-automarketing-checklist.xlsx` B 시트 6행 「…비웠다면 이유를 메모에 적었다」(머리 3행 = 순 · 확인할 것 · 어디서 보나 · 맞음 기준 · 결과 · **메모**) | 직원(남지현) | **결함 D3** = 「메모」가 표의 메모 열인데 제품 화면 칸으로 읽힘 · 고객 사유 기록은 제품이 요구하지 않음(Harold 1108 「적는 요구 빼기」) |
| 제품 화면 | [시작] 카드 `JourneyStartCard.tsx` 「비우면 제한 없음」 · 켜기 창 `JourneyActivationConfirmModal.tsx` 「비우면 제한 없이 보내요…」 | 고객사 | 정상(메모 칸 없음 = 설계 그대로 · `2026-11-05-intake-1104-fix-design.md:87`) |

## §3 B1 · B2 브랜드메시지 발송 창

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위 · 폭 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| 080 · 인증번호 | `BrandMessageEditor.tsx:325` `unsubAuth` · `:740` 입력 칸 · `:510` payload `unsubscribeAuth` | `brand-message.ts:466 · :512` `UNSUBSCRIBE_AUTH_NUMBER` | 빈 값(대부분) · 손 입력 | 080 줄 「인증번호 (선택)」 | **결함 D4**(접수 = 칸 삭제 · 080 은 설정값으로 잠겼는데 인증번호만 손 입력) |
| 열 폭 | `direct-send.css:2096` `≥1280 = minmax(560px, 1fr) 380 380` | 작성 열 | 1920 폭 = 작성 ~1140px | 작성 칸이 화면 절반 넘게 | **결함 D5**(C107 이 작성 열을 무한 1fr 로 · 직원 「너무 커짐」) |
| 작성 열 스크롤 | `direct-send.css:2090` `.ks-compose { overflow-y: auto }`(부모 `.ds-modal__body > section` = flex column) · 자식 `BrandMessageEditor.tsx:207` `<details … overflow-hidden>`(버튼 · 쿠폰 · 캐러셀 칸) | 브라우저 | flex 자식 기본 shrink 1 · overflow hidden 자식의 min-height = 0 | 쿠폰 칸이 아래에서 잘리고 스크롤이 안 생김(직원 캡처 「할인 금액」 반쯤) | **결함 D6** · 같은 꼴 = `.ks-preview`(`:2091` · 알림톡 창 공용) |
| 발송 바 | `direct-send.css:2097` 바 오른쪽 = 380(1280+) · 320(1100~1279) · `:1849 .ds-foot-send { justify-content: flex-end; min-width: 0 }` · `:2191 .ks-sender { min-width: 180px }` · 단추 「N명에게 브랜드메시지 보내기」 | 브라우저 | 오른쪽 칸 380 − 여백 48 = 332 < 발신 프로필 180 + 12 + 단추 약 250 | 단추 묶음이 왼쪽으로 넘쳐 「광고 표기」 칸을 덮음(직원 캡처) | **결함 D7** |
| 받는 사람 명단 | `BrandSendModal.tsx:107` `phones: string[]` · 파일 `:264-269`(번호 칸만) · 주소록 `:279-285`(이름 버림) · 타겟추출 `:296`(번호만) · 창 밖 인계 `:49 initialRecipients: string[]` ← `Dashboard.tsx:3013`(직접 타겟 발송 · 행 name 버림) · `:3217`(직접발송 창) · `:3358`(알림톡 창 전환) | 목록 `:499-512`(번호 한 칸) · 발송 `:672` | 이름 칸 있어도 0 | 「수신번호」 한 칸 | **결함 D8**(Harold 1108 「이름 칸 함께 보기」 · 발송 글은 그대로) |

## §4 B3 · B2 댓글 발송결과 브랜드 이름 · 줄

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| 캠페인 대상값 | 발송 `campaigns.ts:2863 · 4529` `kakao_targeting` I · M · N(빈 값 옛 행) | 목록 이름 `campaign-axis.ts:126 resolveChannelLabel` · 서버 `sms-result-map.ts:405 getCampaignChannelLabel` · `campaign-list-csv.ts:20 channelPlainLabel` | M · N → 「브랜드메시지(비친구)」 · I → 「(친구)」 | 목록 칩 · CSV · 캘린더 · 예약 · 상세 머리(소비처 13 = §6) | **결함 D9**(마수동 전체가 이름에서 사라짐 · C108 뒤 청구는 받는 사람 실제 값이라 캠페인 단위 친구 · 비친구 이름은 청구와도 다름) |
| 관리 통계 내보내기 | `admin.ts:6545 · 6551` 청구 칸 이름을 `getCampaignChannelLabel(…, targeting)` 로 빌림 | 엑셀 | 칸 키 = 청구(BRAND · BRAND_NF) | 슈퍼 통계 엑셀 | 정상(청구 줄) — D9 처방 때 이름 원천을 청구 이름 CT 로 옮겨야 깨지지 않음 |
| 받는 사람 실제 친구 | 게이트웨이 → 에이전트 → SMSQ `k_friend_yn`(C108 · 비토 라인 12 ~ 16 표만 · `sms-queue.ts:749 getFriendColumnTables`) | 청구 · 선불 · 목록 비용(`stats-aggregation.ts:449` friendSuccess) | Y · N · 빈 값(대기 · 실패 · C108 전 행 · 칸 없는 표) | — | 정상(청구) |
| 수신번호별 줄 이름 | `sms-result-map.ts:382 getSendTypeLabel(msgType, kOriseq, statusCode)` — 친구 값 인자 없음 | 줄 화면 9 자리(§6) | F → 늘 「브랜드메시지」 | 발송 내역 「유형」 · 엑셀 · 관리 상세 · 고객 이력 · 시험 발송 | **결함 D10**(R65 화면 쪽 = 실제 값이 줄 화면에서 멈춤) |
| 목록 채널 칩 줄바꿈 | `ResultsModal.tsx:741 · 813` 칩 `h-[22px]` · 줄바꿈 금지 없음 · 관리자 보기 = 발송자 열이 더해져 칸이 좁음 | 브라우저 | 「브랜드메시지(비친구)」 11자 | 두 줄로 깨진 칩(서수란 댓글 캡처) | **결함 D11** · 같은 칩 = `CampaignDetailModal.tsx:47`(CT `resolveChannelChipClass`) |

## §5 결함 장부(단계 2)

| # | 결함 | 사슬 · 자리 | 고객이 겪는 일 |
|---|---|---|---|
| D1 | 여정 변이 행 id(uuid)를 검사 이름표 칸(varchar 10)에 넣음 | `journey-pretest-validator.ts:445 · 466` → `spam-test-queue.ts:707` | A/B 칸 스팸 검사 · 켜기 검증이 늘 실패 · 켤 수 없음 |
| D2 | 등록 실패 문장이 DB 원문 | `spam-test-queue.ts:768` | 「value too long for type character varying(10)」 영어 원문 노출 |
| D3 | 체크리스트 「메모」 뜻 모호 + 제품에 없는 요구 | 체크리스트 B-3 | 직원이 메모 칸이 없다고 접수 |
| D4 | 인증번호 손 입력 칸 | `BrandMessageEditor.tsx:740` | 접수 = 칸 삭제 |
| D5 | 작성 열 무한 1fr | `direct-send.css:2096` | 넓은 화면에서 작성 칸이 과하게 큼 |
| D6 | 스크롤 열 자식이 줄어 잘림 | `direct-send.css:2090 · 2091` + 자식 overflow hidden | 쿠폰 · 버튼 · 캐러셀을 펼치면 아래가 잘리고 내려가지 않음 |
| D7 | 발송 바 오른쪽 내용 최소 폭 > 칸 폭 | `direct-send.css:2097 · 2101 · 1849 · 2191` | 발신 프로필 상자가 광고 표기 칸을 덮음 |
| D8 | 명단 = 번호만 | `BrandSendModal.tsx:107` | 엑셀 · 주소록 · 타겟추출 이름이 안 보임 |
| D9 | 캠페인 이름 = 청구 이름(대상 사라짐) | `campaign-axis.ts:126` · `sms-result-map.ts:405` · `campaign-list-csv.ts:20` | 마수동 전체 발송이 비친구로 보임 |
| D10 | 줄 이름이 실제 친구 값을 안 읽음 | `sms-result-map.ts:382` + 9 소비처 | 수신번호별 친구 · 비친구를 알 수 없음(후불 청구 · 선불 차감 확인 불가) |
| D11 | 채널 칩 줄바꿈 | `campaign-axis.ts resolveChannelChipClass` 소비 2 화면 | 관리자 발송결과 칩이 두 줄 |

정상 판정 근거: §1 「변이 없는 칸」 · 「검사 묶음 결과 읽기」 · 「이어 보기」 / §2 제품 화면 / §4 「관리 통계 내보내기」 · 「받는 사람 실제 친구」(위 표 근거 칸).

## §6 뽑은 패턴(재현용)

- 줄 이름 소비처: `grep -rn "getSendTypeLabel(" packages/backend/src --include=*.ts | grep -v test` = admin.ts:3381 · 3682 · 3683 · campaigns.ts:1694 · manage-stats.ts:301 · results.ts:918 · 1060 · campaign-sms-export.ts:108 · customer-timeline.ts:402.
- 캠페인 이름 소비처: `grep -rn "resolveChannelLabel(\|channelPlainLabel(\|getCampaignChannelLabel(\|brandAudienceLabel(" packages/*/src` = 프론트 13(SmsDetailModal · StatsDetailModal · AllCampaignsTab · CalendarModal 2 · CampaignDetailModal 2 · RecentCampaignModal · ResultsModal · ScheduledCampaignModal 2 · CalendarPage · campaign-axis) · 서버 admin.ts 3 · results.ts:518 · next-action-advisor.ts:39(대상 인자 없음 = 채널 묶음 · 영향 0) · campaign-list-csv · sms-result-map.
- 스크롤 열: `grep -n "overflow-y: auto" packages/frontend/src/styles/direct-send.css` 중 `.ks-body > section` = 2 줄(2090 · 2091).
