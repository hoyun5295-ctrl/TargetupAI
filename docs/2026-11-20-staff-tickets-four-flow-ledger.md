# 그룹웨어 오류접수 넷 흐름 표(2026-11-20)

> 플레이북 = `status/DEFECT-PLAYBOOK.md` §1 · 카드 = 설계서 때 STATUS-FEED 등재(번호 미배정) · 설계서 = 이 표 확인 뒤
> Harold 1120 「4건 꼼꼼히 체크 · 수정방향」 → 「결함은 다신 반복적인 문제가 일어나지 않도록 뿌리까지 뽑도록」
> 칸 뽑기 = 소스 grep(§8 뽑은 패턴) · 손 목록 0. 이 표 확인 전 설계 · 처방 · 코드 0.

## §0 접수 · 판 대조(단계 0)

| # | 접수 | 접수 번호 | 등록 | 등록자 | 판정 |
|---|---|---|---|---|---|
| T1 | (한줄로) 브랜드학습 기본정보 브랜드명 예시 수정 | cmwn673b8233mjnscx6ein41k | 11-19 15:29 | 서수란 | 개선 요청 + 고객사 실명 노출 |
| T2 | 여정만들기 · 발신번호 선택 | cmwlqkcso1ys4jnscwa8el9bl | 11-18 15:24 | 임은지 | 개선 요청 |
| T3 | (자동마케팅) 발송대상 최근구매일 관련 추출 방법 | cmwlsmtrm1zagjnsckv5rwga3 | 11-18 16:22 | 서수란 | **결함**(직원 시험 방법 문제 아님) |
| T4 | 충전 전후 잔액 확인 요청 | cmwmvyqjc228ojnschr5lgr77 | 11-19 10:43 | 박성용 | 개선 요청(원문 그대로는 일부 발송ID 만 가능) |
| T5 | AI 한줄로 혜택 자리표 · 다듬기 뒤 줄바꿈(Harold 직접 · 채팅 캡처 둘) | — | 11-20 | Harold | **결함** D12 · D13 · D14 · D15(§4-2 · 서버 실측) |

서버 지금 = 접수 자리 파일(`audience-translate.ts` · `customer-filter.ts` · `services/ai.ts` · `BrandBasicInfoTab.tsx` · `InterviewModal.tsx` · `automarketing-interview.ts` · `AgentChargeRequestTab.tsx`)은 C142(7d8bb591 · 배포 1118 07:37) 뒤 커밋 0(`git log --oneline 7d8bb591~1..HEAD -- <파일>` = 7d8bb591 한 줄) → 직원이 본 화면 = 지금 소스.

## §1 T3 날짜 조건 흐름(자동마케팅 + 같은 뿌리를 지나는 기능 전부)

직원 캡처 대조(근거 = 화면 원문 + 소스):
- 캡처 2 토스트 「고르신 칸이나 기준을 쓸 수 없어요. 값이 있는 칸과 숫자 기준으로 다시 골라 주세요.」 = 소스에 한 곳(`audience-translate.ts:297`) → `validateCondition` 이 null 을 낸 것.
- 캡처 1 「오늘 기준 90일 전 날짜 (recent_purchase_date) 이하 · 지금 기준 0명」 = 이 글자는 소스에 없음 → AI 가 값 자리에 쓴 글. 날짜 칸 이하 값이 날짜가 아니면 `customer-filter.ts:350-353` 이 `AND FALSE`.
- 캡처 4 AI 한줄로 「최근구매일 2026-08-20 이하 · 109명」 = 한 번 보내는 발송이라 그날 날짜로 계산(정상).

### 1-1 조건을 만드는 자리(생산)

| 자리 | 파일:행 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|
| 자동마케팅 번역 AI | `services/ai.ts:1808-1829`(지시) · 칸 안내 `:1671` 「days_within, gte, lte」 · 회사 칸 `:1689-1694` | 「N일 안」 = days_within 숫자 · 「N일 넘게 없음」 = **기준 없음** → AI 가 lte 에 설명 글을 넣거나 unexpressed 로 돌림 · 값 형식(YYYY-MM-DD) 지시 0 · 오늘 날짜 0 | 승인 창 「조건에 쓰는 칸」 | **결함 D1 · D2** |
| 자동마케팅 칸 고르기 답 | `automarketing-preview.ts:750-757` applyAnswers = `u.operator \|\| (숫자 ? gte : eq)` · 값 `u.value ?? 표본` | 날짜 칸 + AI 기준이 날짜용 아님 · AI 기준 없음 → eq | 질문 「「…」은(는) 어느 칸으로 볼까요?」(`automarketing-interview.ts:78-91`) → 400 토스트 | **결함 D1 · D3** |
| 자동마케팅 승인 창 「다른 칸 고르기」 | `OperatorPreviewModal.tsx:210-220` applyPick = 위와 같은 규칙을 화면이 따로 가짐 | 같음 | 승인 창 칸 고르기 → 400 | **결함 D3**(같은 규칙 두 벌 · R1) |
| 자동발송 대상(AI 추천) | `AutoSendFormModal.tsx:377` → `/api/ai/recommend-target` → `services/ai.ts:1975-1996`(현재 날짜 + 같은 칸 안내 `:1671`) · 연산자 안내 `:2048-2050` | 「N일 넘게 없음」 = 오늘 기준 고정 날짜 lte · 「최근 N일」 = days_within 또는 고정 날짜 gte(AI 선택) | 자동발송 요약 「최근구매일 이하 2026-08-20」 | **결함 D4**(반복 발송인데 기준일 고정) |
| 저장 세그먼트 생성 AI | `ai-segment-generator.ts:101-102`(최근구매일 = gte · lte · between · days_within · 예 `gte: "2026-04-27"`) · `:171` · `:188`(회사 날짜 칸 = YYYY-MM-DD 만) | 「N일 넘게」 = 고정 날짜만 | 세그먼트 화면 조건 · 미리보기 수 | **결함 D6** |
| 직접 타겟 칸 고르기(한 번 발송) | `customerFilterBuild.ts:107-116`(날짜 = birth_month 또는 days_within) · 화면 `DirectTargetFilterModal.tsx:565-575`(DAYS_PRESETS · 생일 = 월) · `TargetDirectPickPanel.tsx:185 · 399` · 소비처 = LineIntakeModal · BrandSendModal · AlimtalkSendModal · DirectSendPanel · Dashboard | 「최근 N일 안」 프리셋만 · 「N일 넘게 지남」 0 | 날짜 칸 프리셋 칩 | **결함 D7**(그 조건을 고를 길 0) |
| AI 한줄로(한 번 발송) | `recommendTarget` 같은 지시 | 그날 고정 날짜(정상) · AI 가 설명 글을 내면 → D8 | 확인 판 칩 `ai-line.ts:300-322` | 고정 날짜 = 정상 · 값 검사 = **D8** |
| 여정 조건(참고) | `journey-condition-fields.ts:20` days_since_purchase 「마지막 구매 뒤 지난 날」 · SQL `journey-target-extractor.ts:1207 · 1348-1352` = KST 오늘 − 최근구매일 · NULL 제외(`:1203`) | 경과일 숫자 · >= <= > < | 여정 조건 칸 | 정상(상대 기준이 이미 있음 · 새 기준의 뜻 · NULL 규칙 원천) |

### 1-2 쓰는 자리 검사

| 자리 | 파일:행 | 값 범위(가) | 판정 |
|---|---|---|---|
| 자동마케팅 조건 검사 | `audience-translate.ts:129-165` validateCondition · 날짜 허용 `:69` · 날짜 칸 gte · lte · date_gte · date_lte 값 = `:157-160` 아무 글자 통과(100자 자름) | 날짜 글자 · 설명 글 · 숫자 · 빈 값 | **결함 D2**(설명 글 · 숫자가 통과) |
| 자동마케팅 SQL 조각 검사 | `audience-translate.ts:192-213` conditionsToFilters `:207-211` = 조각이 비었는지만 | `AND FALSE` 는 빈 조각이 아님 → 통과 | **결함 D2**(같은 사슬) |
| 자동마케팅 AI 조건 → 고르기 | `audience-translate.ts:336-344` validateCondition 이 null 일 때만 고르기 | D2 로 통과한 글자 값은 고르기로 안 감 | **결함 D2** |
| 자동발송 저장 | `routes/auto-campaigns.ts:386-390`(새로) · `:631-632`(수정) = 빈 조건만 막음 · INSERT `:519-542` | 값 모양 검사 0 · 칸마다 SQL 이 나오는지 검사 0 | **결함 D5 · D11** |
| AI 타겟 추천 주소(자동발송이 부름) | `routes/ai.ts:368-` recommend-target = 결과 filters 를 그대로 돌려줌(칸마다 빈 조각 검사 0 · 그 안 `buildFilterWhereClauseCompat` 는 표본 · 수 세기용) | 모르는 기준 = 그 조건이 빠진 수 · 빠진 조건으로 저장 | **결함 D11** |
| 칸마다 빈 조각 검사가 있는 길(참고) | 자동마케팅 `audience-translate.ts:209` · AI 한줄로 `services/ai-line.ts:136` describeLineFilters(→ 「옮기지 못한 조건」) · 세그먼트 생성기 `ai-segment-generator.ts:326`(unapplied) | 빈 조각 = 고르기 · 옮기지 못함 · 거절 | 정상(같은 검사를 길마다 따로 가짐 = R1 · D11 처방의 원천) |
| 저장 세그먼트 저장 | `routes/saved-segments.ts:36-57`(받은 filter 그대로) · 생성기 `ai-segment-generator.ts` = SQL 만들어 보기 + 0건 거절 | 0건이면 생성기에서 걸림 · 손으로 보낸 filter 는 검사 0 | **결함 D5** |
| AI 한줄로 대상 | `services/ai-line.ts:76-99 · 407` = 조건이 비었는지(unresolved)만 · 값 모양 0 | 설명 글 → 0명 「zero」 | **결함 D8** |
| 여정 조건(참고) | `journey-target-extractor.ts:1223` findCustomerConditionIssues · `:1348-1352` 숫자 아니면 FAIL_CLOSED | | 정상 |

### 1-3 저장

| 표 · 칸 | 쓰는 쪽 | 읽는 쪽 | 값 범위(가) | 판정 |
|---|---|---|---|---|
| `continuous_operators.audience_filters`(`{conditions:[{term,field,label,operator,value}]}`) | 자동마케팅 등록 · 수정 | 회차 · 미리보기 `countContractAudience`(`audience-translate.ts:359-`) | 표식 없는 옛 행 = D2 글자 값이 이미 저장됐을 수 있음 | **미검증 → §7 SQL** |
| `auto_campaigns.target_filter`(customer-filter 호환) | `routes/auto-campaigns.ts:519-542 · 699` | 워커 `auto-campaign-worker.ts:446 · 592 · 783` buildFilterQueryCompat(회차마다 저장값 그대로) | 고정 날짜(등록일 기준) · 설명 글 | **미검증 → §7 SQL**(D4 실례 수) |
| `saved_segments.filter_jsonb` | `routes/saved-segments.ts:57 · 79` · `ai-segment-generator.ts:485-501` | 미리보기 `routes/saved-segments.ts:178-204` previewMatching · 화면 `SegmentsPage.tsx:231 · 307` | 고정 날짜 | **미검증 → §7 SQL** |

### 1-4 회차 · 발송 변환(조건 → SQL · 공용 CT)

| 자리 | 파일:행 | 값 범위(가) | 판정 |
|---|---|---|---|
| 표준 날짜 칸(칸 형식) | `customer-filter.ts:326-365` days_within `:328-333`(오늘 KST − N) · gte `:343-349` · lte `:350-353` · between `:354-361` · 날짜 아니면 `AND FALSE` | 날짜 글자 = 비교 · 그 밖 = 0명(넓히지 않음 · fail-closed) | 넓힘 0 = 정상 · 「N일 넘게」 갈래 0 = **D1** · 조용한 0명 = D2 의 끝 |
| 표준 날짜 칸(혼합 형식) | `customer-filter.ts:544-583` 같은 갈래 · 기준 없으면 `:526` eq | 같음 | 같음 |
| 날짜 · 숫자 칸의 모르는 기준 | 날짜 = days_within · birth_month · gte · lte · between 밖(eq · date_gte · date_lte · in …) · 숫자 = eq · gte · lte · between 밖(`:316-322` · `:528-543`) = **SQL 0(빈 조각)** · 글자 칸은 마지막 갈래가 받음 | 모르는 기준 · 기준 없는 날짜 값(→ eq) | **결함 D11**(빈 조각 검사가 없는 길에서 조건이 말없이 빠짐 = 대상이 넓어짐) |
| 회사 날짜 칸 | `customer-filter.ts:423-428 · 668-673` date_gte · date_lte(고정 날짜) | 고정 날짜만 | 「N일 넘게」 · 「N일 안」 갈래 0 = **D1**(회사 칸) |
| NULL 칸(구매일 없음) | 위 비교 전부 | NULL = 비교에서 빠짐 | 정상(여정 · AI 한줄로와 같은 규칙) |

### 1-5 그리는 화면(값 · 서버 문구)

| 자리 | 파일:행 | 그리는 것 | 판정 |
|---|---|---|---|
| 자동마케팅 승인 창 조건 줄 | `OperatorPreviewModal.tsx:78` OP_TEXT · `:423-441`(숫자 값일 때만 기준 입력 칸) | `{값} {이하}` → 설명 글 · 칸 key(recent_purchase_date)가 고객 화면에 | **결함 D2**(노출) · 새 기준 문구 없음 = D9 |
| 자동마케팅 조건 한 줄 · 문안 대상 블록 | `audience-translate.ts:216-228` describeConditions | 같음 | D9 |
| 0명 안내 | `automarketing-preview.ts:577` 「지금 조건에 맞는 고객이 없어요 … 기준을 고치거나 다른 대상을 골라 주세요.」 | 조건이 깨져 0명인데 「맞는 고객 없음」으로 말함 | **결함 D2 의 끝**(D2 닫으면 새로 안 생김 · 옛 행 = D10) |
| 칸 고르기 400 | `audience-translate.ts:297` | 「…숫자 기준으로 다시 골라 주세요」 = 날짜 칸을 고를 길이 없다고 말함 | **결함 D1** |
| AI 한줄로 칩 | `ai-line.ts:311-322` | 「N일 안」 · 이후 · 이전 | 새 기준 문구 없음 = D9 |
| 자동발송 요약 | `AutoSendFormModal.tsx:631-648` opLabels `:638` · 모르는 연산자 = `\|\| val.operator`(내부 키 그대로) | 새 기준이 「days_…」 영어로 보임 | **D9** |
| 세그먼트 조건 | `SegmentsPage.tsx:307` | 「필터 검증됨」 표시만(조건 글을 그리지 않음) | 정상 |
| 직접 타겟 칩 | `DirectTargetFilterModal.tsx:565-575` | 「최근 N일」 | D7 |

## §2 T2 여정 만들기 · 보내는 번호 · 만든 뒤 열리는 칸

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|---|
| 질문표 준비 | `journey-interview-ai.ts:113 · 141` callback = { defaultPhone: defaultCallbackOf · options } | `InterviewModal.tsx:99 · 181-183` | 등록 0 · 1 · 2+ 기본 있음 · 2+ 기본 없음 | | 정상 |
| 기본 번호 판정 | `journey-draft-save.ts:26-30` defaultCallbackOf = 기본 · 없으면 1개일 때 그 번호 · 그 밖 null | 만들기 서버 | 2+ 기본 없음 = null | | 정상(원천 한 곳) |
| 창 번호 칸 | `InterviewModal.tsx:344-360` 「어느 번호로 보낼까요?」 = 등록 1+ 이면 **늘** · `canBuild` `:183` = 번호 고름 | 만들기 요청 `:207` callbackNumber | 위 넷 | 창 칸(캡처 1) | **개선 요청 E2-1**(C103 F3 = `docs/2026-11-05-intake-1104-fix-design.md:69-76` 에서 「늘 묻기」 + [시작] 카드 칸을 함께 넣음) |
| 만들기 서버 | `journey-interview-ai.ts:209-213` 번호 없으면 기본 · 기본 없으면 400 「보낼 회신번호를 골라 주세요.」 · 등록 아닌 번호 400 | | 2+ 기본 없음 + 칸 없음 = 400 | 창 오류 | 칸을 뺄 때 이 값 범위만 칸 유지(E2-1 조건) |
| 상품으로 만들기(같은 갈래 참고) | `ProductJourneyModal.tsx:118` needCallback = 등록 2+ 이고 기본 없음일 때만 묻기 | | | | 정상(E2-1 의 규칙 원천) |
| 정보성 알림 여정 만들기 | `InfoAlertJourneyBuilder.tsx` 번호 질문 0 | | | | 정상(범위 밖) |
| 만든 뒤 「작업 화면 열기」 · 계획마다 「열기」 | `InterviewModal.tsx:490 · 407` onFocusJourney → `JourneysPage.tsx:2851` openWorkspace(id)(칸 없음) | `JourneyWorkspace.tsx:364-371` 첫 칸 = 주소의 칸 → 첫 문자 칸 → 시작 | 칸 없음 = 1번째 문자 칸 | 작업 화면 1번째(직원 원문) | **개선 요청 E2-2** |
| 지도 화면 만들기 창 | `JourneyMapPage.tsx:405-413` onFocusJourney = 지도 초점(`:137-139` focus) · 작업 화면 안 엶 | | | 「지도에서 보기」 | 정상(E2-2 범위 밖 · 그대로) |
| [시작] 카드 보내는 번호 | `JourneyStartCard.tsx` `data-fix-target="callback"` · callbackNumber · callbackMode | 저장 · 켜기 | | 「보내는 번호」 · 「개별회신번호로 보내기」(캡처 2) | 정상(번호를 고칠 자리 = 이미 있음) |
| 계약 시험 | `c103-intake-contract-1105.test.ts:64-74` 「늘 어느 번호로 보낼까요?」 고정 | | | | E2-1 에 맞춰 기대값을 옮김(면제 아님 · 계약 자체가 바뀜) |

## §3 T1 브랜드 학습 기본정보 예시

| 자리 | 파일:행 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|
| 브랜드명 예시 | `BrandBasicInfoTab.tsx:92` placeholder 「예: 폴라초이스」 | 칸 빈 회사 = 보임 | 브랜드 학습 · 기본정보(캡처) | **개선 요청 E1** + 고객사 실명(폴라초이스 = 운영 고객사 · 백엔드 사고 기록 다수) |
| 상호 예시 | `:93` 「예: (주)폴라초이스코리아」 | 칸 빈 회사 = 보임(캡처 회사는 값이 있어 안 보임) | 같은 창 | **E1 과 같은 뿌리** |
| 같은 패턴 전수 | 고객사 이름 71개(`backend/scripts/backfill-industry.ts` 목록)로 `frontend/src` 전체 | 고객 화면 노출 = 위 2곳 · `ImcProfileImportModal.tsx:214` 「예: 메트로시티」 = 슈퍼관리자 전용 창 · 나머지 = 주석 | | 목록 밖 고객사 이름 = 미검증(§7) |

## §4 T4 충전 내역 · 반영 뒤 잔액

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|---|
| 충전 · 차감 행 | 담당자 직접 · 요청 처리 `pay-stats.ts:1275` INSERT `RSRM_FillAmtHist`(RsApplyFlag 'N') | 반영하는 쪽 | 양수 = 충전 · 음수 = 차감 | | 정상 |
| 원장 칸 | — | — | **칸 8개 = SeqNo · StoreId · FillAmt · FillDtTm · PayMethod · RsApplyFlag · RsApplyDtTm · PayFkey**(Harold 1120 서버 `SHOW COLUMNS` 출력) · 반영 뒤 잔액 칸 0 | | 사실 |
| 반영(C · D · B 발송ID) | 중계 서버 PAY 엔진(한줄로 코드 밖) = Y · 반영 시각 | 한줄로 | 반영 순간 잔액 = 한줄로가 읽을 수 있는 곳에 남지 않음 | | 원문 그대로 불가(근거 = 칸 8개 + 아래 잔액 칸) |
| 반영(V 발송ID · 비토 게이트웨이 선불) | bito-gateway `migrations/064_prepaid_wallet_owner_and_pay_fill.sql` apply_pay_fill → `billing_ledger`(balance_before · balance_after · 멱등키 `pay-fill:<SeqNo>:<StoreId>:<FillDt>` = `internal/gateway/paystats/prepaid.go:117`) | 한줄로 = 읽는 길 0(`billing_ledger` 를 읽는 한줄로 코드 0) | 반영 앞뒤 잔액 = 정확값 있음 | | 원문 그대로 가능(새 읽기 길 필요) |
| 잔액 | 중계 · 게이트웨이 → `RSRM_SalesMst.RemAmt`(1분마다 덮어씀 · `status/SCHEMA.md:463`) | `pay-stats.ts:1506-1530` · `:1540` | 지금 값 하나 · 이력 0 | 「발송ID 잔액」 카드(`AgentChargeRequestTab.tsx:228-`) | 정상(지금 잔액은 이미 보임) |
| 충전 내역 목록 | `pay-stats.ts:1483-1497`(칸 여섯 읽음) | 고객사 `routes/agent-charge-orders.ts:118-165` · 슈퍼관리자 `routes/admin.ts:4794` | | 고객사 「충전 내역」 반영 칸 `AgentChargeRequestTab.tsx:355-392`(캡처 빨간 상자) · 슈퍼관리자 충전 화면 | **개선 요청 E4** |

## §4-2 T5 AI 한줄로 혜택 자리표 · 다듬기 뒤 줄바꿈(Harold 1120 접수 · 캡처 둘 · 「이것까지 수정」)

> Harold 1120 정정 = 「10,000원 이상 구매 시 적용 가능」은 Harold 가 넣은 답(지어낸 것 아님 · 넣은 것은 다 들어감) → 점검 = 넣은 혜택이 중간에 빠지는 때가 있나.

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위(가) | 그리는 화면(나) | 판정 |
|---|---|---|---|---|---|
| 혜택 근거 글 | `services/ai-line.ts:590` = 한 줄 + `[혜택] 답`(`one-line-facts.ts:531-536`) + `[기간]` + `[확인한 사실]` 답(`utils/ai-line.ts:221-223`) · 질문 글 제외(Codex 1020 R1) | 생성 출구 `copy-exit-guards.ts:149-152` | 값(30%) = [혜택] 줄 · 종류(쿠폰) = 한 줄 → **다른 절** | | 근거 = 정상 |
| 지어낸 혜택 판정 | `copy-benefit-detector.ts:567-587` 값 · 종류 짝(절 단위) · 자리 묶음 `:154-168`(겹침 · 공백 2칸 이내 = 한 덩어리) | 자리표 `[혜택 안내: 직접 수정해주세요]`(`:45`) | **실측(1120 · 실제 함수)**: 그대로 = 「30% 할인」 · 「최대 30% 할인」 · 「30% OFF」 · 「10,000원 이상 구매 시 30% 할인」 · **바뀜 = 「30% 할인 쿠폰」 · 「30% 쿠폰」 · 「쿠폰으로 30% 할인」 · 「재구매 쿠폰(30% 할인)」 · 「30% 할인 쿠폰을 드려요」(→ 「[혜택 안내: 직접 수정해주세요]을 드려요」)** | 결과 카드 본문 | **결함 D12**(사람이 준 혜택이 지어낸 것으로 판정돼 자리표로 바뀜 · AI 가 쿠폰과 붙여 쓸 때만 = 「가끔」) |
| 같은 판정을 쓰는 길 | 생성 출구 CT(AI 한줄로 · 자동마케팅 · 견본) · DM `dm-alert-copy.ts:133` · 이메일 `email-ai.ts:354-360` · 인앱 `inapp-ai-generator.ts:727-771` · 여정 `journey-ai-generator.ts:694 · 975 · 1089` · SNS `sns-caption-ai.ts:518` | | 근거 = 한 줄(종류) + 따로 받은 혜택 답(값)인 길 전부 | | D12 와 같은 자리(CT 하나) |
| 다듬기 서버 후처리 | `routes/ai.ts:680-740` → `services/ai.ts:2900` refineDirectMessage → `:2604-2680` 검증(이모지 정리 · 080 · (광고) · 변수 · 080 다시 붙임 · 사실 검사 `rewriteAddsFacts` · 주소 남음 `rewriteDropsLinks` · 길이) | 화면 `AiRefineModal.tsx:124-127` → `AiLinePage.tsx:2312-2314` 그대로 덮어씀 | **실측(1120 · 실제 함수)**: `stripIncompatibleEmojis` = 줄바꿈 보존(「▶ 주소」 한 줄 → 한 줄 · 「▶\n주소」 → 그대로) · 줄 머리 「⭐」 · 「✨」 · 「👉」 = 표시 지워지고 앞 공백 한 칸 남음 | | 후처리는 ▶ · ★ 줄을 옮기지 않음 · 줄 머리 이모지 공백 = **결함 D14** |
| 다듬기 꼴 보존 | 지시문(원문 꼴 유지 · `composeVoicePrompt` mode rewrite) 뿐 · 링크 줄 · 줄 머리 표시를 지키는 코드 판정 0(생성 길의 링크 감춤 `protectLinkTokens` 는 다듬기 길에 없음) | | 모델이 「▶ 주소」를 갈라 쓰거나 「★ 이번 주말」을 문장 안으로 넣어도 통과 · 두 번 다듬으면 겹침 | 카드 본문 `<pre whitespace-pre-wrap>`(`AiLinePage.tsx:1717` · 주소를 블록으로 그리지 않음 → ▶ 홀로 한 줄 = 글 안에 줄바꿈이 있음) | **결함 D13**(후보) |
| 생성 링크 줄 | `voice-form-slots.ts:333-340` ensureOnceLink = 모델이 링크 자리를 안 쓰면 **글 끝에 줄을 바꿔** 주소를 붙임(앞 줄의 「▶」 와 떨어짐) | 생성 결과 | 「…확인해 보세요 ▶」 + 끝에 「\n주소」 | | D13 의 또 다른 출처 후보 |
| 이번 건의 출처(서버 실측) | 자동 스팸 검사 본문 `spam_filter_tests.message_content_lms`(INSERT `spam-test-queue.ts:731-735` · 화면이 보내는 본문 = 다듬은 글 우선 `AiLinePage.tsx:1537`) · **Harold 1120 서버 출력 9행** | | 생성 원문(11-20 07:34:34) = 「> 지금 바로 확인하기 [NL] 주소」(주소 제 줄 · ★ 없음) → 다듬은 글(07:36:05) = 「…확인해 보세요 ▶ [NL] 주소」 · 「알려드려요 ★ 이번 주말」 | 화면 ▶ 홀로 = 줄 끝 ▶ 가 폭 때문에 넘어감 + 다음 줄 주소 | **출처 = 다듬기(D13)** · 생성 링크 붙이기(`voice-form-slots.ts:333-340`) = 이번 출처 아님(원문 주소 제 줄 · 정상) |
| 혜택 자리표 서버 실례 | 같은 표 11-19 11:34:18 「▶ 전 품목 [혜택 안내: 직접 수정해주세요]」 | | | | D12 실례(서버) |
| 마크다운 링크 꼴 | 생성 원문 · 다듬은 글 둘 다 `[www.invitocorp.com](https://www.invitocorp.com)` · 거르는 코드 0(`rg -F "](http"` · `rg -F "]\("` backend · frontend = 0) | 자동 스팸 검사 = 시험 폰 발송(completed) · 승인 발송 본문 = 같은 카드 본문 | AI 가 마크다운으로 쓰면 그대로 문자로 나감 | 카드 = 글자 그대로(이번 마지막 판은 꼴 없음 = 모델마다 다름) | **결함 D15** |

## §5 결함 장부(단계 2)

| # | 결함 | 사슬 · 자리 | 고객이 겪는 일 | 뿌리 |
|---|---|---|---|---|
| D1 | 반복해서 쓰는 날짜 조건에 「N일 넘게 지남」 기준이 공용 계약에 없다 | 허용 `audience-translate.ts:69` · AI 안내 `services/ai.ts:1671` · 변환 `customer-filter.ts:328 · 547` 갈래 0 · 회사 날짜 칸 = 고정 날짜만 | 「90일 넘게 구매 없는 VIP」를 자동마케팅에 걸 수 없음(400 막다른 길 · 캡처 2) | **새 R100** |
| D2 | 대상 조건의 모양(칸 · 기준 · 값) 판정이 한 곳에 없다 — 쓰는 자리마다 일부만 보고, 공용 변환기는 깨진 조건을 0명(값) 또는 말없이 뺌(기준 = D11)으로 닫는다 | `audience-translate.ts:157-160` 통과 → 저장 → `customer-filter.ts:350-353` AND FALSE → `automarketing-preview.ts:577` 「맞는 고객이 없어요」 | 매 회차 0명 · 칸 key 노출(캡처 1) | **새 R101** |
| D3 | 칸을 고른 뒤 기준을 정하는 규칙이 두 벌이고 날짜 칸이면 「같음」 | `automarketing-preview.ts:750-757` · `OperatorPreviewModal.tsx:210-220` | 날짜 칸을 고르면 늘 400 | R1 |
| D4 | 자동발송이 「N일 넘게 · 최근 N일」을 등록일 고정 날짜로 저장 · 회차마다 그대로 | `services/ai.ts:1975-1996` → `auto-campaigns.ts:519-542` → `auto-campaign-worker.ts:446 · 592 · 783` | 다음 회차부터 대상이 등록일 기준에 묶임(새로 이탈한 고객 빠짐 · 실례 수 = §7) | R100 |
| D5 | 자동발송 · 저장 세그먼트 저장에 값 모양 검사 0 | `auto-campaigns.ts:386-390 · 631-632` · `saved-segments.ts:36-57` | 설명 글이 들어오면 매 회차 · 미리보기 0명 | R101 |
| D6 | 세그먼트 생성기가 「N일 넘게」를 고정 날짜로만 · 저장 뒤 미리보기도 그 날짜 | `ai-segment-generator.ts:101-102 · 171 · 188` · `saved-segments.ts:204` | 저장 세그먼트 수가 날이 갈수록 어긋남 | R100 |
| D7 | 직접 타겟 칸 고르기 날짜 칸에 「N일 넘게 지남」 선택지 0 | `customerFilterBuild.ts:107-116` · `DirectTargetFilterModal.tsx:565-575` · `TargetDirectPickPanel.tsx:185 · 399` | 「90일 넘게 구매 없는 고객」을 직접 고를 길 0 | R100 |
| D8 | AI 한줄로 대상에 값 모양 검사 0 | `services/ai-line.ts:76-99 · 407` | AI 가 설명 글을 내면 「0명」으로만 보임(실례 미검증) | R101 |
| D9 | 조건 문구 표가 네 벌 · 모르는 기준을 내부 키로 그림 | `audience-translate.ts:216` · `OperatorPreviewModal.tsx:78` · `ai-line.ts:311-322` · `AutoSendFormModal.tsx:638-639` | 새 기준이 들어가면 영어 키가 고객 화면에 | R1 |
| D10 | 이미 저장된 깨진 조건 · 고정 날짜 행 | §1-3 세 표 | 처방 배포 뒤에도 그 행은 0명 · 고정 날짜 그대로 | R101 · R100(옛 행) · 수 = §7 |
| D12 | AI 가 사람 혜택을 다른 짝(쿠폰)으로 쓰면 판정이 지어낸 짝으로 보고 자리표로 바꾸는데(판정은 맞음), AI 한줄로만 그 자리를 사람 혜택 칸 답으로 채우지 않는다(자동마케팅 · 플래너는 `applyBenefitToBody` 로 채움) | 근거 `services/ai-line.ts:590` → 판정 `copy-benefit-detector.ts:567-587` → 출구 `copy-exit-guards.ts:149-152` → (채우기 없음) | 넣은 「30% 할인행사」가 본문에서 「[혜택 안내: 직접 수정해주세요]」로 바뀜 · 조사가 깨짐 | R33 넓힘(Codex 설계 2R 뒤 구조 처방) |
| D13 | 다시 쓰기(다듬기)가 꼴을 지키지 않는다(사실만 봄) — 링크 앞에 가리킴 표시(▶)로 끝나는 줄을 새로 써 주소와 갈라 놓고 · 강조 표시(★)를 문장 가운데 넣는다 | `services/ai.ts:2604-2680` · 서버 실측 07:34:34 → 07:36:05 | ▶ 와 주소가 갈라짐 · 「★ 이번 주말」이 문장 안으로 | 새 뿌리 후보 |
| D15 | 생성 · 다듬기 출구가 마크다운 꼴(링크 `[글](주소)` 등)을 거르지 않아 문자 본문에 그대로 남는다 | 출구 `copy-exit-guards.ts` · `services/ai.ts:2604-2680` · 거름 코드 0 | 고객 휴대폰에 `[www…](https://…)` 글자가 그대로 | 새 뿌리 후보(문자로 나가는 글의 꼴 판정 한 곳 · D13 과 같은 자리) |
| D14 | 줄 머리 이모지를 지운 자리에 공백 한 칸이 남는다 | `services/ai.ts:2452-2459`(줄 시작 공백 정리 없음) | 줄이 공백으로 시작 | R1(정리 규칙 두 벌 · 생성 출구 `copy-exit-guards.ts:52-58` 은 줄 시작 공백을 지움) |
| D11 | 공용 변환기가 날짜 · 숫자 칸의 모르는 기준을 빈 조각으로 돌리고, 자동발송 길(추천 주소 · 저장 · 회차)에는 칸마다 빈 조각 검사가 없다 | `customer-filter.ts:316-365 · 526 · 528-583` → `routes/ai.ts:368-`(추천) → `auto-campaigns.ts:386-390 · 519-542` → `auto-campaign-worker.ts:446 · 592 · 783`(전부 빈 조건만 막음 `:787`) | 그 조건이 빠진 넓은 대상에게 매 회차 발송(실례 수 = §7 M1 의 기준 분포) | R101 |

## §6 개선 요청 장부(원문 그대로 1안)

| # | 원문 | 1안(원문 그대로) | 원문과 다른 점 · 이유 |
|---|---|---|---|
| E1 | 「브랜드명 예시 … 인비토나 한줄로로 변경」 | 브랜드명 「예: 한줄로」 · 상호 「예: 주식회사 인비토」 | 상호 칸을 더함 = 같은 고객사 실명(§3) |
| E2-1 | 「여정 만들기 화면에서는 발신번호를 선택할 수 있는 란이 빠지고」 | 창 번호 칸 뺌 · 서버 기본 번호로 만듦 | 등록 2+ · 기본 번호 없는 회사만 칸 유지(빼면 서버 400 · 상품으로 만들기 창과 같은 규칙) · 등록 0 안내 그대로 |
| E2-2 | 「여정 생성 후 '시작' 페이지로 화면이 오픈」 | 만든 직후 「작업 화면 열기」 · 「열기」 → [시작] 칸 | 다른 길(목록 · 고치기 이동)의 첫 칸 규칙 그대로 · 지도 창 그대로 |
| E4 | 「반영 칸에 충전 or 차감 이후 금액 표기」 | 행마다 반영 뒤 잔액 = V 발송ID 만 가능(게이트웨이 원장 balance_after · 한줄로에 읽는 길 신설) | C · D · B 발송ID(직원 화면 = C0112 · C0115)는 반영 순간 잔액이 남지 않음(§4) · 「반영(Y)을 본 순간 지금 잔액을 기록」도 Y 표시와 RemAmt 갱신이 같은 순간이라는 근거가 없어 충전 전 값이 찍힐 수 있음(미검증 → 기록 방식 제외) → **1120 확정 = 코드 0 · 직원 회신**(같은 탭 맨 위 「발송ID 잔액」 카드 `AgentChargeRequestTab.tsx:228-` 가 지금 잔액을 이미 보임 · 옛 나)안 = 같은 값 한 번 더 = 거둠 · 가) V 행 정확값 = 범위 밖 기록) |

## §7 미검증 · 실측 대기

| # | 무엇 | 방법 | 쓰임 |
|---|---|---|---|
| M1 | 세 표(자동마케팅 · 자동발송 · 저장 세그먼트)에 저장된 날짜 조건의 모양별 수 | PG SQL · **Harold 1120 출력 = 1행: autosend · deleted · birth_date · birth_month · int · 4행 · 3개사** · 자동마케팅 · 세그먼트 날짜 조건 0 · 날짜 칸 모르는 기준 0 | D10 옛 행 보정 = 대상 0(보정 단계 없음) · D4 · D6 · D11 날짜 실례 0 = 길은 남음(0건 ≠ 안전) |
| M2 | 71개 목록 밖 고객사 이름이 화면 예시에 있는지 | PG 회사 이름 목록 → 화면 소스 대조 | E1 전수 |
| M3 | AI 한줄로에서 날짜 칸에 설명 글이 실제로 나온 적 | 로그 · 실례 없으면 「값 범위 축의 칸」으로만 닫음 | D8 |
| M4 | 켜진 자동발송 · 세그먼트 · 자동마케팅 가운데 숫자 · 날짜 · 회사 칸에 표 밖 기준이 든 행 수 | PG SQL | 설계서 §3 배포 뒤 멈추는 회차 |
| M5 | (삭제 1120) T5 출처 = 브라우저 값이라 꺼내지 않음 · D13 두 자리를 함께 닫는 것으로 대신 | — | — |

## §8 뽑은 패턴

- 날짜 연산자 = `rg -n "'(days_within|date_gte|date_lte|birth_month)'|\b(days_within|date_gte|date_lte)\b" backend/src frontend/src`(시험 제외) = 40줄(§1 전 자리)
- 조건 검사 함수 = `rg -n "export function (validate|sanitize|find|check)\w*(Filter|Condition)\w*"` = 2(`validateCondition` · `findCustomerConditionIssues`) · `safeDateValue|isDateLikeValue` customer-filter 밖 0
- 저장 칸 = `rg -n "target_filter|audience_filters|filter_jsonb"` 쓰기 · 읽기 · SCHEMA 2816 · 2276 · 1299
- 회차 변환 = `rg -n "buildFilterQueryCompat\(ac\.target_filter"` = 워커 3 · `countContractAudience`
- 칸 고른 뒤 기준 = `rg -n "operator \|\| .*(numeric|gte)"` = 3(applyAnswers · applyPick · 변환기 기본값 `customer-filter.ts:526`)
- 빈 조각 검사 = `rg -n "sql\.trim\(\)"` = 자동마케팅 `audience-translate.ts:209` · AI 한줄로 `services/ai-line.ts:79 · 136` · 세그먼트 `ai-segment-generator.ts:326` · 전체 고객 신호 `all-customers-signal.ts:58` · 자동발송 길 0
- 번호 질문 = `rg -n "보낼까요|callbackNumber|callbackPhone|needCallback" frontend/src/components/journey` · 첫 칸 = `JourneyWorkspace.tsx:364-371`
- 고객사 실명 = backfill-industry 71개 이름 × `frontend/src`(시험 제외)
- 충전 원장 읽기 = `rg -n "listAgentCharges\("` = 2 · `billing_ledger` 한줄로 0
