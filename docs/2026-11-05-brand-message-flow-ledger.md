# 브랜드메시지 흐름 표 · 결함 장부 (2026-11-05 · 오류접수 5건 + 구조체크)

> 순서 = `status/DEFECT-PLAYBOOK.md` §1. 이 문서는 **1단계 흐름 표 + 2단계 결함 장부(1차 판정)** 까지다. 설계 · 처방 · 코드 0.
> 넘어가는 조건 = 빈칸 0 + Harold 「이번 범위 흐름이 빠짐없다」 확인 + §5 실측 결과.

## §0 접수 · 서버판 대조

| # | 접수 | 등록 | 발생 메뉴 | 등록자 |
|---|---|---|---|---|
| T1 | 대체 발송 화면 개선 (`cmw2wry9z0kxjjnscfg0alhc7`) | 11-05 11:10 | 브랜드메시지 | 박성용 |
| T2 | 브랜드 메시지 통계 개선 필요 (`cmw2zk4280lgkjnsc66eok0vw`) | 11-05 12:28 | 미입력 | 박성용 |
| T3 | (통계) 브랜드메시지 실패 후 재전송 처리 (`cmw2yyhut0l2ljnscssmuzh2u`) | 11-05 12:11 | 미입력 | 서수란 |
| T4 | 중복제거 기능은 있으나 표기 단추 없음 (`cmw2x24fy0kyjjnsci89n3md5`) | 11-05 11:18 | 미입력 | 박성용 |
| T5 | 타겟 추출 기능 알림톡 · 브랜드메시지에도 (`cmw2wugad0kxxjnsc2sso9bn3`) | 11-05 11:12 | 미입력 | 박성용 |

- 접수 시각의 서버판 = `d7e3061f`(원장 `deployed_head` 의 그 전 값 · c5ebdd86 은 16:06 배포).
- `git log --oneline d7e3061f..HEAD -- <브랜드 관련 파일 11개>` = **0줄** → 결함 자리 파일은 **서버 지금 = 로컬 HEAD**.
- `routes/campaigns.ts` 에 다른 세션(C105 H4) 미커밋 변경이 있다(목록 주소 숫자 CT · 브랜드 경로 무관). 구현 때 같은 파일을 만지면 그 세션과 겹친다.

## §1 흐름 표

판정 자리마다 두 축: (가) 값 범위 · (나) 값을 그리는 화면. 판정 칸 = 결함(D번호) 또는 정상(근거).

### E 진입

| 칸 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| E1 직접발송 머리 [브랜드메시지] | `Dashboard.tsx:3229-3256`(entry direct) | `BrandSendModal.tsx:78-145`(열 때 전 상태 초기화) | 정상 |
| E2 직접 타겟 발송 → 브랜드 | Dashboard `brandEntry='target'` · `brandInitialRecipients` | `BrandSendModal.tsx:313-325`(빼기만) | 정상 |
| E3 창 머리 채널 전환(문자 · 알림톡) | `BrandSendModal.tsx:524` | `Dashboard.tsx:3234-3249`(명단 넘김) | 정상 |

### R 받는 사람

| 칸 | 쓰는 쪽 | 읽는 쪽 | (가) 값 범위 | (나) 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| R1 직접입력 창 | `RecipientDirectInputModal` → `BrandSendModal.tsx:169-195` planDraft | `recipient-paste.ts:48` checkBrandPaste | 이번 입력 안 중복 · 지금 명단과 중복 → **늘 뺌**(끌 수 없음) | 창 안 「중복 N 제외」 한 줄만. 수신자 열에 [중복제거] 칩 없음(`BrandSendModal.tsx:386-397`) · 문자 `DirectSendPanel.tsx:1046-1071` · 알림톡 `AlimtalkSendModal.tsx:893-902` 에는 있음 | **D-04**(T4) |
| R2 파일등록 | `BrandSendModal.tsx:199-215` | `recipient-paste.ts:60` normalizeBrandPhones | `.csv,.txt` 만(`:332` accept) · 엑셀 = 못 고름 · 번호만 읽음 · 늘 중복 뺌 | 「CSV · TXT에서 번호만」 안내. 문자 · 알림톡은 xlsx 받음 | **D-08**(구조체크 발견 · 접수 밖) |
| R3 AI 타겟추출 | `BrandSendModal.tsx:217-278` | `/customers/generate-from-text` → `/customers/extract`(smsOptIn true) | 잠금 = `isAiMessagingLocked`(`Dashboard.tsx:3254`) · 대상 = 전량 담기 | 탭 「AI 타겟추출」 | 정상(T5 와 축이 겹침 → §4) |
| R4 주소록 | 없음 | . | . | 문자 `DirectSendPanel.tsx:1030` · 알림톡 `AlimtalkSendModal.tsx:881-891` 에만 있음 | **D-09**(구조체크 발견 · 접수 밖) |
| R5 타겟추출(고객 DB 조건) | 문자만 `DirectSendPanel.tsx:1035-1042` → `DirectTargetFilterModal`(`:1299-1307`) → `handleTargetExtracted`(`:635-659`) | `target-extraction.ts:83` fetchTargetExtractionRows(주석 = 「알림톡·브랜드메시지로 넘길 때만」) | 잠금 = 고객 DB 잠금 축(`targetExtractLocked`) | 브랜드 · 알림톡 창에 칸 없음 | **D-05**(T5) |
| R6 수신거부 제거 | 서버 `brand-message.ts:1592-1597` filterUnsubscribed(1907 · 2047) · 늘 켬 | 차감 수 = 거른 뒤 수(`:1921`) | 수신거부 번호 k명 | 칩 없음 · 확인 창 「발송 대상 N명」= **거르기 전 수**(`BrandSendModal.tsx:586`) · 끝 토스트 = sentCount(`Dashboard.tsx:3271`) · 빠진 k명 설명 0. 문자는 보내기 전 수신거부 · 중복 수를 보여 줌(`DirectSendPanel.tsx:540-543`) | **D-06**(T4 와 같은 「표기」 자리) |
| R7 서버 중복 | `/brand-send` → `sendBrandMessage`(`brand-message.ts:1594-1596` 정규화 · 수신거부만) | 차감 · 적재 = 받은 배열 그대로 | 같은 번호 2회 → 2회 차감 · 2회 적재 | . | 정상(입구가 화면 하나 · 화면이 늘 뺌). 칩을 끌 수 있게 바꾸면 이 칸이 판정 자리가 된다 → §6 Q-D |

### C 만들기

| 칸 | 쓰는 쪽 | 읽는 쪽 | (가) 값 범위 | (나) 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| C1 대체 문안 편집 자리 | `BrandMessageEditor.tsx:1086-1127`(발송 바 풍선 · select + 발신번호 + LMS 제목 + **textarea rows=2** `:1115`) | payload `resendType/From/Message/Title`(`:499-504`) | 대체 문구 = 빈칸이면 본문 재사용 | 3열 폭 `520px · 380px · 1fr`(`direct-send.css:2087` · **알림톡 창과 공용**) · 수신자 열이 가장 넓다 · 대체 문안은 2줄 풍선 | **D-01**(T1) · 같은 꼴 알림톡 `AlimtalkSendModal.tsx:1134-1155` |
| C2 SMS 대체 + 본문 재사용 길이 | 화면 select `SM`(`:1104`) · 서버 `resolveBrandFallback`(`brand-message.ts:623-654`) | `insertBrandQueue` `sms-queue.ts:1230-1238`(빈 값만 막음) | TEXT 본문 최대 1,300자 → SMS 대체 90바이트 초과 가능 · 길이 판정 0(화면 · 서버) | 풍선에 바이트 표시 0. 알림톡은 같은 이유로 SMS 대체를 없앴다(`AlimtalkChannelPanel.tsx:101`) | **D-07**(구조체크 발견 · 게이트웨이가 자르는지 · 실패하는지 미검증 → §5) |
| C2' 광고 브랜드의 문자 대체 표기 | 한줄로 `resolveBrandFallback`(`brand-message.ts:644` · 대체 문구 = 입력 또는 본문 그대로) · 게이트웨이 `buildFallbackSpec`(`bito-gateway/internal/gateway/engine/report.go:822-853` · 본문 그대로) | 문자 직접발송은 `messageUtils.ts:416` buildAdMessage 로 (광고) · 무료거부 080 을 붙인다 | 광고(AD_FLAG Y) 브랜드 → 문자 대체 본문에 (광고) · 무료거부 080 이 붙는 자리 0(코드) | 풍선에 광고 표기 안내 0 | **D-14**(구조체크 발견 · **실측 확인** §5-4: 「광고표기 온」 시험 4건 포함 대체 문자 본문 전부 (광고) · 무료거부 080 없음 · 정보통신망법 제50조 표기 의무 자리) |
| C3 대체 회신번호 | 풍선 `:1109` | `resolveBrandCallback`(`brand-message.ts:1607-1615`) → 캠페인 · 큐 같은 값(`campaigns.ts:4165`) | 빈칸 = 회사 기본 회신번호 · 없음 = 거절(`:1914`) | . | 정상 |
| C4 타겟팅(대상 범위) | 풍선 `BrandMessageEditor.tsx:1057-1085` · 라벨 `TARGETING_OPTIONS`(`brand-message.ts:253-257`) | 큐 `k_etc_json.TARGETING`(`:498`) · 캠페인 `kakao_targeting`(`campaigns.ts:4218`) · 차감 단가(`:1921`) | I = 친구 단가 · M · N · 빈 값 = 비친구 단가(`unit-price.ts:121-135`) | 풍선에 080 필요 안내만 · 「비친구 단가로 청구」 안내 0(기능 문서 §9-2 가 적기로 한 문구) | **D-11** 의 일부(T2 ②) |

### S 발송 · 적재(F행을 쓰는 자리 전수 = `grep -rn "insertBrandQueue(" packages/backend/src`)

| 칸 | 자리 | 판정 |
|---|---|---|
| S1 전용 창 `/brand-send` | `campaigns.ts:4107-4321` → `brand-message.ts:1793-1976`(자유형) · `:1983-2111`(기본형) · 차감 BRAND(대상 단가) `:1921` · `:2059` · 적재 `:1943` · `:2080` · `k_next_type` A/B + `k_next_contents` | 정상(적재 규약) |
| S2 담당자 테스트 | `campaigns.ts:476` | 정상 |
| S3 AI 캠페인 | `campaigns.ts:1283`(차감 `:1072`) | 정상 |
| S4 직접발송 동기 | `campaigns.ts:2933`(차감 `:2700` · `:2951`) | 정상 |
| S5 직접발송 워커 | `direct-send-processor.ts:225` | 정상 |

### X 결과 기록(게이트웨이 → F행)

| 칸 | 자리 | (가) 값 범위 | 판정 |
|---|---|---|---|
| X1 부모 F행 최종 결과 | 게이트웨이 `bito-gateway/internal/gateway/engine/report.go:1302-1331` parentFallbackReport(알림톡 · 브랜드 공통) | **브랜드 성공 = 1800**(에이전트 `config.go:1038-1052` kakao_brand_* · 실측) · **대체 성공 = 7830(A · SMS) · 7831(B · LMS)**(실측) · 실패 = 에이전트가 코드가 없으면 **9999**(`poller.go:2174-2179`) · 대체까지 실패해도 9999(실측 5857 · B 두 번) · 게이트웨이 접수 거부 9404(실측) · 대기 100 · 104 · 7305 · 만료 4000 · 시간창 3022 | 사실(코드 + §5-2 실측 27행). 9999 하나로는 「브랜드 실패 · 대체 없음」과 「대체까지 실패」를 가를 수 없다 → 둘 다 실패 1(청구 0) · 알림톡 비토 라인과 같은 취급 |
| X2 대체 문자 행 | 에이전트 `bito-gateway/internal/agent/poller/poller.go:1413-1418`(7830 · 7831 이면 문자 행 적재 안 함) | SMSQ 에 별도 문자 행 0 | 사실(코드 + 실측: 15개 캠페인 27행 전부 F · k_oriseq 0 · 14 · 15 라인 이력 표 없음) |
| X3' 실패 사유 | 에이전트 실패 기록 = 결과코드 없으면 9999 | 친구만(I) → 비친구 번호 = 9999 · 비친구만(N) → 친구 번호 = 9999(실측) · 화면 「기타 오류」 | **D-13**(구조체크 발견 · Harold 1105 「비토엔진에서 고친다」) · 뿌리(§5-4 실측 + 코드): 엔진은 원본 코드를 그대로 넘긴다(`report.go:368` · `:990` · 실측 원본 = 카카오 3018 「메시지를 발송할 수 없음」 · 대체 LMS 509 「단말 LMS/MMS 미지원」) → 한줄로 에이전트 설정이 `failure_code_source: status_values.failed` · `failed: 9999`(게이트웨이 `status/AGENT_MANUAL.md:651` · SMSQ 결과 칸이 숫자라서) → 실패는 전부 9999. 원본 → 표준 → 고객 코드 표(`provider_result_code_map` · `customer_result_code_map` · agent_id 칸 있음)는 Go 엔진이 한 번도 안 읽는다(grep 0 · 관리 API · 콘솔만) |
| X3 매입 | `report.go:961-964` 부모(카카오) 과금 = 실패 확정 · 자식 문자 과금 | 우리가 내는 값 = 문자 단가 | 사실(코드) |

### V 보기(결과 · 통계) · 판정 자리 = `fallbackOf`(`sms-result-map.ts:271-282`) · **K 만 본다** · 성공 코드 7830 · 7831 포함(`:167`)

| 칸 | 쓰는 쪽(서버) | 그리는 쪽(화면) | 브랜드 대체 성공 1건이 보이는 모양 | 판정 |
|---|---|---|---|---|
| V1 발송결과 요약 카드 · 예상 비용 | `results.ts:83-229` | `ResultsModal.tsx:521-589` · 비용 `:546`(성공 × 브랜드 단가) | 성공 1 · 브랜드 단가 | **D-02**(T2 · T3) |
| V2 발송결과 목록(채널통합조회) | `results.ts:351-355` · 분리 = `stats-aggregation.ts:401-402`(**send_channel='alimtalk' 만**) | `ResultsModal.tsx:684-778`(PC) · `:793-827`(모바일) · 대체 아랫줄 = 알림톡만 | 「브랜드메시지 2 · 성공 2 · 100%」(T2 캡처) | **D-02**(T2 ①) |
| V3 발송결과 목록 CSV | `results.ts:414-541`(분리 없음 · **알림톡도**) | 다운로드 파일 | 성공 1 | **D-10**(구조체크 발견 · 알림톡 포함) |
| V4 캠페인 상세 차트 | `results.ts:547-695`(성공 · 통신사 분포에 7830 포함) | 상세 차트 | 성공 1 | **D-02** |
| V5 상세 수신자 목록 · 엑셀 유형 · 「대체」 거르기 | 라벨 `results.ts:916` · `:1058` · `campaign-sms-export.ts:108` → `getSendTypeLabel`(`sms-result-map.ts:326-336`) · 거르기 `results.ts:794` · `:885` · `:1005` · `campaign-sms-export.ts:68` → `SUBSTITUTE_ROW_SQL`(`:295-297` · K 만) | `ResultsModal.tsx:1153`(필터 「대체」) | 유형 「브랜드메시지」 · 결과 「SMS 대체 성공」(T3 캡처 2) · 「대체」 거르기에 안 잡힘 | **D-02**(T3) |
| V6 관리자 캠페인 목록 · 상세 | `admin.ts:3499-3517`(alimtalk 만) · `:3681` isFallback | `AllCampaignsTab.tsx:92-140` | 성공 1 · 대체 표시 0 | **D-02** |
| V7 슈퍼관리자 통계 엑셀 | `admin.ts:6501-6555`(알림톡만 대체 줄 · 브랜드 = 한 줄 `getCampaignChannelLabel`) | 엑셀 | 「브랜드메시지 3 · 3 · 0 · 0」(T3 캡처 3) | **D-02**(T3) |
| V8 고객사 발송통계 화면 · 엑셀 | `manage-stats.ts:69` · `:388` → `buildCompanyUsageByDay` → 청구 식(M3) | 통계 화면 · 엑셀 | 「브랜드메시지」 또는 「브랜드메시지(비친구)」 성공 1 | **D-03**(T2 · T3) |
| V9 고객 타임라인 | `customer-timeline.ts:400` getSendTypeLabel | 고객 상세 | 「브랜드메시지」 | **D-02** |
| V10 친구 · 비친구 | 목록 SELECT 에 `kakao_targeting` 있음(`results.ts:329`) · 그리는 화면 0 · 수신자별 실제 친구 여부(FRIEND_YN) = 게이트웨이 `message_request.friend_yn` 에만(기능 문서 §9-2-3) · 한줄로 소스 grep `friend_yn` = 0 | 목록 · 상세 · 엑셀 어디에도 대상 · 친구 구분 0. V8 만 단가 축(대상값)으로 갈림 | 구분 0 | **D-11**(T2 ②) |
| V11 완료 캠페인 캐시 | `campaign-sync-worker.ts:257`(성공에 7830 포함 · PG success_count) | V1 · V2 의 완료분 | 성공 1 | D-02 와 같은 자리(분리는 V2 처럼 캐시 위에 따로 읽는다) |

### M 돈

| 칸 | 자리 | (가) 값 범위 | 판정 |
|---|---|---|---|
| M1 선불 차감 | `brand-message.ts:1921` · `:2059` → `prepaid.ts:139-143` → 단가 `unit-price.ts:162`(대상값) | I = 친구 단가 · M · N = 비친구 단가 | 정상(차감 순간에는 결과를 모른다) |
| M2 선불 결과 정산(스위퍼) | `mysql-refund-sweeper.ts:430-447`(BRAND 축 · 실패만 환불 · 7830/7831 = 성공) · 결과별 차액 = **알림톡만**(`:506-556` · `sms-queue.ts:607-631`) | 대체 성공 = 브랜드 단가 그대로 남음 · LMS 대체(23.6원)가 브랜드 단가(21원)보다 비싼 회사는 덜 받은 채 남음 | **D-12**(T3 의 선불판) |
| M3 후불 청구 식 | `send-usage-aggregation.ts:70-75` BILLING_MSG_TYPE_SQL · **F 갈래가 먼저** → 대체분도 BRAND/BRAND_NF · 대체 조각 `sms-result-map.ts:288-292` = K 만 | F + 7830 → BRAND(I) 또는 BRAND_NF(M · N) | **D-03**(T3 캡처 4 · 정산 상세 「브랜드메시지 3건 ₩21」) |
| M4 청구서 대체 줄 | `billing-types.ts:297-298` SMS_FB · LMS_FB 「SMS(대체발송)」 · 단가 문자 상속 | 지금은 알림톡 대체만 들어옴 | 정상(줄은 있다) |
| M5 취소 환불 | `campaign-lifecycle.ts:298-301` · `:366` · `:459`(대기 100 의 F행 = BRAND 축) | . | 정상 |

### K 예약 · 시간창

| 칸 | 자리 | 판정 |
|---|---|---|
| K1 예약 브랜드 → scheduled | `campaigns.ts:4291-4296` | 정상 |
| K2 발송 가능 시간(08:00~20:50) | `brand-message.ts:529-551` · 예약 바꾸기 `campaigns.ts:3680` | 정상 |

## §2 칸을 뽑은 명령(손 목록 0)

```
# F행 쓰는 자리
grep -rn "insertBrandQueue(" packages/backend/src --include=*.ts | grep -v test
# 대체 판정 · 청구 조각 소비처
grep -rn "fallbackOf\|FALLBACK_BILLING_CODE_WHEN_SQL\|tallyAlimtalkFallback\|SUBSTITUTE_ROW_SQL\|aggregateAlimtalkFallbackByCampaign\|KAKAO_FALLBACK_SMS_CODE" packages/backend/src --include=*.ts | grep -v test
grep -rn "BILLING_MSG_TYPE_SQL" packages/backend/src --include=*.ts | grep -v test
# 행 유형 라벨 · 분리 표시
grep -rn "getSendTypeLabel\|getCampaignChannelLabel\|readAlimtalkSplit\|alimtalkFallbackRows\|alimtalk_split" packages --include=*.ts --include=*.tsx | grep -v test
# 받는 사람 칸(중복 · 수신거부 · 주소록 · 타겟추출)
grep -rn "중복제거\|수신거부제거\|타겟추출\|주소록" packages/frontend/src --include=*.tsx
# 친구 여부 · 친구 단가
grep -rni "friend_yn\|BRAND_FRIEND_TARGETINGS\|isBrandFriendTargeting\|pickBrandPriceRaw" packages --include=*.ts --include=*.tsx
# 게이트웨이 대체 결과코드
grep -rn "func parentFallbackReport\|isGatewayManagedFallbackReport\|7830\|7831" ../bito-gateway --include=*.go | grep -v _test
```

## §3 결함 장부(1차)

| D | 고객이 겪는 일 | 사슬 | 접수 | 뿌리 후보 |
|---|---|---|---|---|
| D-01 | 대체 문안을 2줄 풍선에서 써야 한다 · 수신자 열만 넓다 | C1 | T1 | (화면 배치 · 알림톡 창 공용 CSS) |
| D-02 | 브랜드 실패 → 문자 대체 성공이 브랜드 성공으로 보인다(목록 · 요약 · 상세 · 엑셀 · 관리자 · 타임라인 · 슈퍼 통계) | X1 → `fallbackOf` K 만 → V1 · V2 · V4 · V5 · V6 · V7 · V9 · V11 | T2 ① · T3 | R1(같은 사실 「카카오 실패 → 문자 대체」 판정이 알림톡 한 채널에만) |
| D-03 | 대체 문자분이 브랜드 단가로 청구 · 고객사 통계도 브랜드로 셈 | X1 → M3(F 갈래 먼저 · 대체 조각 K 만) → V8 · 정산서 | T3 · T2 | R1(위와 같은 뿌리) |
| D-04 | 중복을 빼는데 창에 [중복제거] 표시가 없다 | R1 | T4 | R31(받는 사람 중복 규칙 = 여는 창 규칙) |
| D-05 | 브랜드 · 알림톡 창에 고객 DB 조건 타겟추출이 없다 | R5 | T5 | . |
| D-06 | 수신거부로 빠진 수를 못 보고 보낸다(확인 창 수 ≠ 발송 수) | R6 | T4(같은 표기 자리) | . |
| D-07 | SMS 대체에 긴 본문이 그대로 실린다(90바이트 초과 · 결과 미검증) | C2 | 구조체크 | . |
| D-08 | 브랜드 창은 엑셀 파일을 못 올린다 | R2 | 구조체크 | . |
| D-09 | 브랜드 창에 주소록이 없다 | R4 | 구조체크 | R31 |
| D-10 | 발송결과 목록 CSV 는 대체를 따로 안 센다(알림톡 포함) | V3 | 구조체크 | R1 |
| D-11 | 친구 · 비친구(단가가 갈리는 축)를 결과 · 통계 화면에서 볼 수 없다 | C4 · V10 | T2 ② | . |
| D-12 | 선불: 대체 성공도 브랜드 단가로 남는다(LMS 대체면 덜 받음) | M2 | T3(선불판) | R1 |
| D-13 | 브랜드 실패 사유가 전부 「기타 오류」(9999) · 친구 대상 아님 같은 이유를 못 본다 | X3' · 에이전트는 게이트웨이 결과코드를 그대로 씀(`poller.go:1109-1123` · 기본 gateway_report) → 9999 는 게이트웨이 쪽 값 · 고객별 코드표(`customer_result_code_map`)는 관리 API · 콘솔만 읽고 Go 엔진은 안 읽음 | 구조체크 · Harold 1105 「비토엔진 쪽에서 고친다」 | . |
| D-14 | 광고 브랜드가 문자로 대체되면 (광고) · 무료거부 080 없이 나갈 수 있다 | C2' | 구조체크 | . |
| D-15 | 발송 전 수신거부 수를 원문 번호로 비교(하이픈 저장 번호를 못 셈 · 서버 거름과 다른 규칙) | `routes/unsubscribes.ts:642-645` ↔ `unsubscribe-helper.ts:336-348` | 구조체크(설계) | R1 |
| D-16 | 브랜드 파일 · 붙여넣기가 숫자 9~11자리면 아무 칸이든 번호로 읽는다(매장 전화 · 회원번호에도 발송) | `recipient-paste.ts:48-62` | 구조체크(설계) | R31 |
| D-17 | 카카오 대체 문구가 금칙어 차단 판정을 안 탄다(브랜드 전 경로 · 알림톡 대체문안) | `spam-block.ts:401` 부르는 4곳 = sms · both 만 | 설계 구조체크 1회차 | R63 |
| D-18 | 브랜드 대체 발신번호를 등록 여부 확인 없이 쓴다 | `brand-message.ts:1607-1615` | 설계 구조체크 2회차 | R1 |

## §4 접수 축 대조표(축이 없으면 그 접수가 닫히는가)

| 접수 | 닫는 칸 | 빠지면 |
|---|---|---|
| T1 | C1(+ C2 같은 자리) | 화면이 그대로 |
| T2 ① | X1 사실 + V1 · V2 · V4 · V5 · V6 · V11 + V8 | 목록 · 통계 중 하나라도 브랜드 성공으로 남음 |
| T2 ② | V10 + C4 | 친구 · 비친구 구분 0 |
| T3 | M3(후불) + M2(선불) + V5 · V7 | 정산서 · 통계 엑셀이 그대로 |
| T4 | R1 + R6(+ R7 판정 자리) | 칩 없음 · 빠진 수 모름 |
| T5 | R5(브랜드 · 알림톡 두 창) + R3 와 정리 | 한 창만 닫힘 |

## §5 실측(Harold 실행 · 하나씩)

1. **PG** · 11-02 이후 브랜드 캠페인과 적재 테이블(다음 MySQL 조회의 테이블 · 캠페인 id 를 여기서 얻는다) · 서버 셸에서:
   ```bash
   docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT c.id, co.company_name, u.login_id, LEFT(c.message_content, 20) AS msg, c.send_channel, c.kakao_targeting, c.kakao_resend_type, c.send_config->'sentTables' AS sent_tables, to_char(c.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS created_kst FROM campaigns c JOIN companies co ON co.id = c.company_id LEFT JOIN users u ON u.id = c.created_by WHERE c.send_channel IN ('kakao', 'kakao_brand', 'both') AND c.created_at >= '2026-11-02' ORDER BY c.created_at DESC LIMIT 30;"
   ```
   - **결과(Harold 실행 · 11-05)**: 15건 · 전부 `kakao_brand`. 인비토 psy5868 12건 = `SMSQ_SEND_15`(T2 재현 = 11:54 채널친구만 I·SM · 11:57 친구만 I·SM · 11:57 마수동 M·SM · 11:58 비친구만 N·SM) · 무주덕유산리조트 mdysresort 3건 = `SMSQ_SEND_14`(11-02 17:08 · 17:13 · 17:15 · 전부 I·SM). 대상값 M · N · I 와 대체 NO · SM · LM 이 모두 들어 있어 X1 값 범위 표본이 된다.
2. **결과(Harold 실행 · 11-05)**: 27행 · 전부 msg_type F · k_oriseq 0 · 표 = SMSQ_SEND_14 · 15(이력 표 없음). 성공 1800 · 대체 성공 7830(next A) 6행 · 7831(next B) 2행 · 실패 9999 5행 · 9404 1행. T2 재현과 일치: 박성용 = 끝 5868(친구) · 법인폰 = 끝 8125(비친구) · 채널친구만(I) 5868 1800 / 8125 7830 · 비친구만(N) 5868 7830 / 8125 1800 · 마수동(M) 둘 다 1800(청구 = 비친구 단가 2 · 실제 친구 1 · 비친구 1). 끝 5857 은 SMS 대체 7830 · LMS 대체 9999 두 번(대체 LMS 실패 사유는 게이트웨이 콘솔에만).
   - 실행한 명령 = 아래 설명의 모양 · 위 15개 캠페인의 행별 `msg_type · k_next_type · status_code · k_oriseq · TARGETING`(X1 · X2 값 범위 확인 · 옛 모양 대체 행 유무). 서버에서 smsuser 직접 접속은 거부되므로(OPS.md 25행 · 1001 실측 ERROR 1045) 백엔드 접속으로 조회한다(FEATURE-BRAND-CAROUSEL §3 모양).
4. **게이트웨이 DB**(.65 서버 셸 · D-13 원본 코드 · D-14 실제 대체 본문 · 친구 여부) · `docker exec bito-bench-postgres psql -U bito -d bito_gateway -P pager=off -c "…"`(11-05 11:15~12:35 · 번호 끝 5868 · 8125 · 5857 · 5257 · 0101 · kakao_brand · 대체 자식 행 조인).
   - **결과(Harold 실행 · 11-05 · 23행)**: ① 성공 원본 0000(BF) · 대체 성공 7830/7831(KAKAO_FALLBACK_OK) · 대체 실패 = 자식 원본(509 · KAKAO_FALLBACK_FAIL) · 카카오 실패 원본 3018 → 한줄로 큐엔 전부 9999(D-13). ② **수신자별 친구 여부(friend_yn)가 게이트웨이에 실제로 있다**: 배달된 브랜드 행마다 Y/N(5868 = Y · 8125 = N · 11:57 마수동 전체 = Y 1 · N 1) · 대체로 넘어간 행은 빈 값. 한줄로까지는 안 온다(V10 · Q-A). ③ 대체 문자 본문(앞 40자) 전부 (광고) · 무료거부 080 없음 · 직원이 본문에 「광고표기 온」이라 적은 시험도 같음(D-14). ④ 5857 의 LMS 대체 실패 = 509 단말 LMS/MMS 미지원(SMS 대체는 성공 · 우리 결함 아님). ⑤ 0101(12:26 9404)은 게이트웨이 요청 행이 없다 = 접수 단계에서 거부.
3. (2 뒤) D-07: SMS 대체 + 90바이트 넘는 대체 문구 1건 시험 발송(테스트계정 · 직원 휴대폰) 결과코드.

## §6 설계 때 정할 것(흐름 표 확인 뒤 · 추천 포함)

- **Q-A 친구 · 비친구 표시 기준** · 추천 = 청구와 같은 대상값(채널 친구 = 친구 단가 · 비친구만 · 마수동 전체 = 비친구 단가). 한줄로가 가진 사실이 이것뿐이고 정산서와 같은 말이 된다. 단 T2 재현의 「마수동 전체 2건 중 2건 성공」은 비친구 2 로 보인다 · 수신자별 실제 친구 1 · 비친구 1 을 원하면 게이트웨이 FRIEND_YN 을 결과 행까지 싣는 교차 저장소 작업이 필요하다(이번 축 밖).
- **Q-B 대체분 청구 줄** · 추천 = 알림톡 대체와 같은 「SMS(대체발송) · LMS(대체발송)」 줄(실체 · 매입 · 단가 모두 문자).
- **Q-C 선불 대체 정산** · 추천 = 알림톡과 같은 결과별 차액 방식(차감 단가 = 브랜드와 대체 문자 중 큰 값 · 결과로 차액 환불). LMS 단가 > 브랜드 단가 회사가 있어 차감 단가 결정이 같이 필요.
- **Q-D 중복제거 칩** · 추천 = 알림톡 창과 같은 켜고 끄는 [중복제거] · [수신거부제거] 칩(R31 = 여는 창 직접입력 규칙). 끌 수 있게 되면 R7 서버 중복 판정도 같이 정한다.
- **Q-E SMS 대체 길이** · 추천 = §5-3 실측 뒤 정함(90바이트 넘는 문구면 SMS 를 못 고르게 할지 · 알림톡처럼 SMS 대체를 없앨지).
- **Q-F 타겟추출** · 추천 = 문자 직접발송과 같은 받는 사람 4칸(직접입력 · 파일등록 · 주소록 · 타겟추출 · 잠금 축도 같게) · 브랜드의 옛 「AI 타겟추출」 탭은 타겟추출 창 안 AI 입력으로 합친다. 알림톡은 템플릿 변수 칸 맞추기(파일등록과 같은 창)로 잇는다.
- **Q-G 범위** · D-08 · D-09 · D-10 은 접수 밖(구조체크 발견) · 이번 배포에 넣을지. ~~C1 같은 꼴 알림톡~~ → **Harold 1105 확정: 대체문안 = 휴대폰 모양 창 · 저장 · 알림톡 「실패 시 문자」에도 같이**.
- **Q-H D-13 고치는 자리** · 추천 = 엔진이 보고를 넘기기 전에 에이전트별 고객 코드 표(`customer_result_code_map` · 이미 agent_id 칸이 있다)를 적용해 **숫자 코드만** 넘기고(모르는 코드 = 9999) · 한줄로 에이전트 hanjul02 · 03 은 `gateway_report` 로 바꾸고 · 한줄로 결과 라벨 표에 그 코드를 더한다. 에이전트 설정을 바꾸면 재시작이 필요하다(적재 0건 때만 · 한줄로 운영 에이전트는 v1.0.12 고정 운영).
- **Q-A 보강** · 게이트웨이에 수신자별 friend_yn 이 실제로 있다 → 「실제 친구 · 비친구」를 보이려면 그 값이 큐까지 와야 한다(엔진 보고 + 에이전트 + 큐 칸). 청구는 지금 대상값 규칙(M = 비친구 단가)이라 화면이 실제 값을 보이면 청구와 갈린다 · 매입 정산서 대조(기능 문서 §9-5)와 같이 정한다.
