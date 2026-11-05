# 브랜드메시지 결함 0 설계서 (C107 · 2026-11-05)

> 흐름 표 · 결함 장부 = [2026-11-05-brand-message-flow-ledger.md](2026-11-05-brand-message-flow-ledger.md)(이 문서는 그 표의 D번호를 처방한다).
> 순서 = `status/DEFECT-PLAYBOOK.md` §1 3단계 · Harold 1105 「설계서 → 구조체크(결함 0까지) → Codex 설계 → 구현 → Codex 구현 → 배포 명령」.
> 배포 = C104 · C105 · C106 과 한 배포(다른 세션 「한줄로-1105 오류접수 및 디버깅」 1105 연락) · 게이트웨이(묶음 G)는 게이트웨이 런북으로 따로.

## §0 Harold 결정(1105)

| # | 결정 |
|---|---|
| H1 | 대체 문안 = 누르면 **휴대폰 모양 창** · 그 안에서 쓰고 [저장] · 창은 화면 안 고정 높이(긴 글은 말풍선 안에서만 스크롤) |
| H2 | 휴대폰 창은 **알림톡 「실패 시 문자」에도 같이** |
| H3 | 실패 사유 9999(D-13)는 **비토엔진에서 고친다** |
| H4 | 흐름 표 범위 = 접수 5건 + 구조체크 발견 전부(결함이 닫힐 때까지) |

## §1 불변 원칙

- I1 「카카오(알림톡 · 브랜드) 실패 → 문자 대체」 판정은 `sms-result-map` 한 곳(`fallbackOf` · SQL 조각)만 · 카카오 부모 유형 = `K` · `F` 상수 하나.
- I2 대체로 나간 문자는 **문자로** 센다 · 문자로 청구한다(실체 · 매입 · 단가 모두 문자 · 청구 줄 = 기존 「SMS(대체발송) · LMS(대체발송)」).
- I3 광고 메시지가 문자로 나가면 어느 길이든 `(광고)` · `무료거부 080` 이 붙는다(문자 직접발송과 같은 CT `buildAdMessage`).
- I4 받는 사람 창은 세 채널(문자 · 알림톡 · 브랜드)이 같은 불러오기 칸 · 같은 중복 규칙(R31) · 같은 수신거부 판정 함수.
- I5 고객 결과 칸에 쓰는 실패 코드는 한줄로 결과 표가 아는 숫자만(모르는 코드 = 9999 · 대기 · 성공 코드와 겹침 0).

## §2 묶음 A · 대체 판정 한 곳(뿌리 R1 넓힘) · D-02 · D-03 · D-10 · D-11 · D-12

### A1 판정 소유 `packages/backend/src/utils/sms-result-map.ts`
- `KAKAO_FALLBACK_PARENT_TYPES = ['K', 'F']` · `KAKAO_FALLBACK_PARENT_SQL = "('K', 'F')"`(상수 하나에서 SQL).
- `fallbackOf(msgType, kOriseq, status)`: `K` 또는 `F` + 7830 → 'S' · 7831 → 'L'(옛 모양 S/L + k_oriseq 그대로).
- `FALLBACK_BILLING_CODE_WHEN_SQL`: `msg_type IN ('K','F') AND status_code = 7830 THEN 'KS'` · 7831 → 'KL' · 옛 모양 그대로.
- `SUBSTITUTE_ROW_SQL`(「대체」 거르기): `msg_type IN ('K','F') AND status_code IN (7830, 7831)` 포함.
- `tallyAlimtalkFallback` → **`tallyKakaoFallback`**(부모 = K · F 행 · 이름만 넓힘 · 판정 그대로) · 타입 `KakaoFallbackCount`.
- `getSendTypeLabel`: F + 7830 = 「대체 SMS」 · 7831 = 「대체 LMS」(fallbackOf 경유 · 자동). **부르는 자리 전부 결과 코드까지 넘긴다** — 지금 1인자로 부르는 테스트 목록 3곳(`admin.ts:3377` · `campaigns.ts:1621` · `manage-stats.ts:286`)은 그 SELECT 에 `status_code` · `k_oriseq` 를 더해 넘긴다(구조체크 1회차 발견 · 테스트 브랜드 대체가 「브랜드메시지」로 보이고 청구는 테스트 SMS).
- `getCampaignChannelLabel(sendChannel, messageType, targeting?)`: 브랜드 전용 채널은 대상값으로 청구 유형 이름을 그대로 쓴다 = `billingTypeLabel(친구 ? 'BRAND' : 'BRAND_NF')`(D-11 · 판정 = `unit-price.ts` `BRAND_FRIEND_TARGETINGS`).
- **이름 한 벌**: 청구 유형 `BRAND` 이름 「브랜드메시지」 → **「브랜드메시지(친구)」**(`BRAND_NF` = 「브랜드메시지(비친구)」 그대로). 정산서 · 통계 · 발송결과가 같은 이름을 쓴다. 프론트 미러 = `campaign-axis.ts` `BRAND_AUDIENCE_LABELS`(두 글자 일치 = `brand-axis-invariants.test.ts` 에 줄 추가).
- 대체 큐 유형 판정 `brandFallbackQueueType(resendType)`(순수 · `resolveBrandFallback` 의 NO/SM/LM → N/A/B 를 꺼낸 것) — A8 차감 자리가 같은 함수를 부른다(두 벌 0).

### A2 청구 식 `send-usage-aggregation.ts` `BILLING_MSG_TYPE_SQL`
- 순서를 바꾼다: `CASE ${FALLBACK_BILLING_CODE_WHEN_SQL} WHEN msg_type = 'F' THEN (친구/비친구) ELSE msg_type END`. 대체 갈래가 F 갈래보다 **먼저**(지금은 F 가 먼저라 F + 7830 이 BRAND 로 굳는다). GROUP BY 도 같은 식(그대로).
- 결과: 후불 정산서 · 정산 미리보기 · 고객사 발송통계 화면 · 엑셀 · 일일 인사이트가 한 식으로 바뀐다(V8 · M3). 테스트 라인 = `testBillingTypeKey` KS → 테스트 SMS · KL → 테스트 LMS(그대로).

### A3 선불 결과 집계 `sms-queue.ts` `smsAlimtalkResultAgg` → **`smsKakaoResultAgg`**
- 카카오 성공 = `msg_type IN ('K','F') AND status_code = 1800` · 행 안 대체 = `msg_type IN ('K','F') AND 7830/7831`. 옛 대체 행 칸은 그대로.

### A4 목록 분리 `stats-aggregation.ts`
- `loadAlimtalkFallbackForList` → **`loadKakaoFallbackForList`** · 대상 채널 = `isKakaoSplitChannel(send_channel)`(새 CT · `billing-types.ts` · 알림톡 + 브랜드 전용 `kakao` · `kakao_brand` · `both` 제외 = 문자가 섞여 부모 판정만으로 못 나눈다).
- `aggregateAlimtalkFallbackByCampaign` → **`aggregateKakaoFallbackByCampaign`**.
- 응답 칸 `alimtalk_split` → **`kakao_split`**(백 · 프론트 한 배포).
- 소비처: `results.ts` 목록 · `admin.ts` 관리자 목록 · 슈퍼 통계 엑셀(A6) · 목록 CSV(A5).

### A5 발송결과 목록 CSV(D-10 · 알림톡 포함) `results.ts /campaigns/export` + `campaign-list-csv.ts`
- 분리 채널 캠페인 = 머리 줄(시도 수 · 채널 이름) + 대체 줄(「↳ LMS(대체발송)」 · 「↳ SMS(대체발송)」 · 0 이면 줄 없음) · 화면 목록과 같은 줄 구성.
- 채널 이름 = `getCampaignChannelLabel(…, kakao_targeting)`(CSV 의 `channelPlainLabel` 이 따로 「브랜드메시지」를 쓰던 것을 이 CT 로 · SELECT 에 `kakao_targeting` 추가 · 구조체크 2회차).

### A6 슈퍼관리자 통계 엑셀 `admin.ts /stats/export`
- 분리 대상 = `isKakaoSplitChannel` · 브랜드 머리 줄 이름 = `getCampaignChannelLabel(…, targeting)` · 대체 줄 이름 = `billingTypeLabel('SMS_FB' | 'LMS_FB')`(그대로).
- 메타 SELECT 에 `c.kakao_targeting` 추가 · **브랜드 머리 줄 집계 키 = 청구 구분**(`brandBillingKey(targeting)` = 'BRAND' | 'BRAND_NF' · `unit-price.ts resolveBrandAudience` 와 같은 판정) — 이름만 바꾸면 같은 날 같은 계정의 친구 · 비친구 캠페인이 한 칸에 합쳐진다(Codex 설계 1R #6).

### A7 화면 `ResultsModal.tsx` · `AllCampaignsTab.tsx` · `utils/alimtalk-split.ts` → **`utils/kakao-split.ts`**
- `readKakaoSplit(c)` · `kakaoFallbackRows(s)` · `kakaoFailLabel(c)` = 알림톡이면 「알림톡 실패분」 · 브랜드면 「브랜드메시지 실패분」.
- 목록 줄(PC · 모바일) = 시도 수 + 아랫줄 대체(알림톡과 같은 모양) · 예상 비용 = 시도 성공 × (알림톡 단가 · 브랜드 친구/비친구 단가) + 대체 성공 × 문자 단가.
- 채널 칩 = `resolveChannelLabel` 에 대상값 → 「브랜드메시지(친구)」 · 「브랜드메시지(비친구)」(D-11).
- 요약 카드(총 발송 · 성공) = 받은 사람 기준 그대로(알림톡과 같은 정의 · 정상 판정 근거 = 흐름 표 V1).

### A8 선불 대체 정산(D-12) `prepaid.ts` · `deduct-reference.ts` · `mysql-refund-sweeper.ts`
- `prepaidDeduct(..., brand, opts)` 의 opts 에 `brandFallback?: 'A' | 'B'`(브랜드 전용 채널 · 대체 켬일 때만). 같은 잠금 행에서 브랜드(대상) 단가와 **고른 대체 유형 단가**(A = SMS · B = LMS)를 읽어 **차감 단가 = max(브랜드, 고른 대체 문자)** · 차감 설명에 결과별 단가 `· 결과별 정산: 브랜드메시지 X원 · SMS 대체 Y원 · LMS 대체 Z원`.
- 필수 단가 = 브랜드 + 고른 대체 유형 두 개. **고른 대체 유형 단가가 미설정이면 차감 앞에서 막는다**(브랜드 단가 미설정과 같은 문장 · 공짜 대체 0). **고르지 않은 유형 칸 = 차감 단가 그대로 기록**(그 결과가 와도 차액 0 · 미설정이어도 정산이 꺼지지 않는다 · Codex 설계 1R #1).
- `buildAlimtalkUnitsNote(u, label)` · `parseAlimtalkUnits` 정규식 = `(알림톡|브랜드메시지)` · 키 이름 `KAKAO` = 「카카오 성공 단가」(그대로). 알림톡의 세 단가 규칙(`prepaid.ts:117`)은 그대로.
- 스위퍼: 결과별 차액 갈래는 그대로(설명에서 단가를 되읽는 일반 갈래) · 결과 집계만 A3(`smsKakaoResultAgg`) · 환불 설명 「알림톡 결과별 단가 차액 환불」 → 「결과별 단가 차액 환불」.
- 부르는 자리: `brand-message.ts:1921`(자유형 · `fallback.nextType`) · `:2059`(기본형) · `campaigns.ts:1227`(AI 캠페인 `kakao` 일 때 `kakaoResendType`) · `:2883`(직접발송 `kakao` 일 때). `both` 는 브랜드 대체를 늘 끈다(`campaigns.ts:1165` · `:2843` · `direct-send-processor.ts:191`) = 해당 없음.

## §3 묶음 B · 발송 창 · D-01 · D-04 · D-05 · D-06 · D-07 · D-08 · D-09 · D-14 · D-15 · D-16

### B1 대체 문안 휴대폰 창(D-01 · H1 · H2) `components/kakao-send/FallbackPhoneModal.tsx`(새 · 공용)
- 열기 = 발송 바 [실패 시 문자] 타일(브랜드 `BrandMessageEditor.tsx:1086-1127` 풍선 · 알림톡 `AlimtalkSendModal.tsx:1134-1155` 풍선 → 둘 다 이 창).
- 창 = 흰 판 · 겹침 2100(부모 2000 위 · R27) · 높이 = `min(720px, 100dvh − 48px)` 고정 · 왼쪽 휴대폰 틀(말풍선 = 입력칸 · 긴 글은 말풍선 안 스크롤) · 오른쪽 좁은 칸(문자 종류 · 발신번호(브랜드) · [본문 가져오기] · 바이트) · 아래 [취소] [저장].
- 문자 종류: 브랜드 = 대체 안 함 · SMS · LMS / 알림톡 = 대체 안 함 · 원문 그대로 LMS(말풍선 = 템플릿 본문 · 읽기만) · 대체문안 작성 LMS(알림톡은 SMS 대체 없음 · 2026-06-01 결정 그대로).
- LMS = 말풍선 맨 위 제목 줄(필수 · 빈 칸이면 [저장] 막고 그 칸에 한 줄 안내).
- 바이트 = 프론트 CT `calculateSmsBytes` · 광고(브랜드 광고 표기 켬)면 말풍선 위 `(광고)` · 아래 `무료거부 080…` 고정 줄을 보여 주고 바이트에 포함(`buildAdMessageFront` · B3 과 같은 글자).
- SMS 가 90바이트를 넘으면 [저장] 막고 「LMS로 바꾸기」 단추(D-07). LMS 상한 2,000바이트.
- 상태: 창은 초안을 따로 들고 [저장] 때만 편집기 값으로 · [취소] · ESC · 바깥 = 버림. 발송 바 타일 = 「SMS로 대체 · 42바이트」 식 요약.
- 알림톡: 지금 `AlimtalkFallbackEditor`(`AlimtalkChannelPanel.tsx`) 의 판정(`validateAlimtalkChannelState` · `requiresNextSubject` · `requiresNextContents`)을 그대로 부른다 · 창은 겉모양만 바꾼다(판정 두 벌 0).

### B2 창 폭(T1 나머지) `styles/direct-send.css`
- 브랜드 창만 `ks-body--brand`: 작성 열 넓게 · 수신자 열 좁게(`minmax(560px, 1.4fr) 360px 340px` 출발 · 1440 · 1600 · 1920 폭 실측으로 확정 · 메모리 「레이아웃 = 여러 폭 실측」). 알림톡 창 `.ks-body` 는 그대로.

### B3 광고 문자 표기(D-14 · 뿌리 R61 신설) `brand-message.ts resolveBrandFallback`
- 입력에 `isAd` · `opt080Number` 추가 · 대체 문구 = `buildAdMessage(문구, A ? 'SMS' : 'LMS', isAd, opt080)`(문자 직접발송과 같은 CT) · LMS 제목 = 문자 직접발송 LMS 와 같은 광고 제목 규칙(같은 CT를 찾아 쓴다 · 없으면 제목은 그대로).
- **대체 조립 입력 = 광고 표기 전 원문 하나**(Codex 설계 1R #4): 부르는 쪽은 `resendMessage` · `originalMessage` 에 (광고) · 무료거부를 붙이기 전 글을 넘긴다. AI 캠페인(`campaigns.ts:1141`) · 직접발송(`:2749`)은 지금 `prepareSendMessage` 가 광고 표기를 붙인 글을 넘기므로, `prepareSendMessage` 반환에 **`body`(변수 치환 뒤 · 표기 전)** 칸을 더하고 그 글을 넘긴다(반환 칸 추가 = 기존 소비처 무영향) · 워커(`direct-send-processor.ts:184`)는 `replaceVariables` 결과(표기 전) 그대로 · `/brand-send` = 사람이 쓴 글. `resolveBrandFallback` 안에서도 `stripAdParts`(정확한 표기 꼴만 걷는 기존 CT · 본문 낱말 무손상 · `messageUtils.ts:501`)를 먼저 한 번 걸고 고른 유형으로 **한 번만** 조립(멱등 · 080 빈 꼬리처럼 못 걷는 꼴은 부르는 쪽이 표기 전 글을 넘겨 생기지 않는다). 바이트 판정(B4) · 금칙어 판정(B3') · 화면 바이트(B1)는 이 조립 결과 하나를 본다.
- 080 번호 = `getOpt080Number(userId, companyId)`(문자 직접발송과 같은 CT · `campaigns.ts:1129` · `:2750` 과 같은 값) · 080 이 비어 있으면 문자 직접발송과 같게 「무료거부」 글자만(막지 않음 · 같은 사실 같은 규칙).
- LMS 제목 = `buildAdSubject(제목, 'LMS', isAd)`(`messageUtils.ts:540` · 문자 LMS 와 같은 CT).
- 부르는 자리 다섯 전부 isAd · 080 을 넘긴다: `brand-message.ts:1896` · `:2036` · `campaigns.ts:1164` · `:2842` · `direct-send-processor.ts:190`.

### B3' 대체 문자 금칙어 판정(D-17 · 구조체크 1회차 발견 · 뿌리 R63 신설)
- 사실: 금칙어 차단(`spam-block.ts checkSpamBlockBeforeCharge` · 전송자격인증 5.2 · 「문자로 나가는 문안만 본다」)은 `sms` · `both` 일 때만 부른다(`campaigns.ts:1203` · `:2364` · `auto-campaign-worker.ts:874` · `direct-send-core.ts:276`). 카카오가 실패해 문자로 나가는 **대체 문구**는 어디서도 판정 입력에 없다(`/brand-send` 는 판정 호출 자체가 0).
- 처방: 대체 문구를 만드는 자리마다 차감 앞에 같은 CT 로 판정한다. 입력 = `kakaoFallbackSpamItems({ nextType, nextContents, titleStr, recipients })`(새 · `messageUtils.ts` · `composeSpamCheckText` 를 부른다 · 광고 문구는 B3 적용 뒤 글). 브랜드 = `resolveBrandFallback` 결과 · 알림톡 = 대체 L(템플릿 본문 그대로 LMS) · B(대체문안).
- 자리(전수 = `resolveBrandFallback(` · `insertAlimtalkQueue(` 부르는 파일): `brand-message.ts` 자유형 · 기본형(차감 앞 · 막히면 발송 0) · `campaigns.ts` AI 캠페인 `kakao` · 직접발송 `kakao` · 직접발송 알림톡(`:3129` 앞 · 판정은 차감 앞 한 번) · `auto-campaign-worker.ts:1113` · `direct-send-processor.ts:225` · `:343`(워커는 커밋 단계 판정을 따른다 · 확인 대상). 면제 = `system-alimtalk.ts`(우리 시스템 안내 · 고객 문안 아님 · 이유 줄).
- 수신자마다 개인화되는 대체 문구(AI · 직접 `kakao`)는 원문(치환 전) 한 번 판정 = 문자 경로와 같은 규칙(「변수 치환 전 원문」 · `composeSpamCheckText` 주석).

### B3'' 대체 발신번호(D-18 · 구조체크 2회차 발견 · 뿌리 R1)
- 사실: `resolveBrandCallback`(`brand-message.ts:1607-1615`)은 입력 번호를 정규화만 해서 그대로 쓴다 · 화면은 자유 입력 칸(`BrandMessageEditor.tsx:1109`). 다른 발송 길은 `fixedCallbackRejectReason` · `isCallbackRegistered`(`callback-filter.ts:203` · `:213`)로 규격 + 회사 등록을 본다 = 같은 사실 두 규칙.
- 처방: **대체가 켜진 경우에만**(확정된 큐 유형 A · B) 회신번호를 `fixedCallbackRejectReason` 으로 판정(거절이면 BrandMessageBuildError · 차감 앞) · 대체 끔(N) = 종전 그대로(빈 번호 허용 · 판정 0 · Codex 설계 1R #3). 판정 자리 = `sendBrandMessage` · `sendBrandMessageTemplate` 의 「회신번호 확정」 바로 뒤(`brand-message.ts:1913` · `:2053` · `nextType !== 'N'` 조건 안) · `/brand-send` 라우트의 선확정(`campaigns.ts:4165`)은 캠페인 기록용이라 판정하지 않는다(CT 가 막으면 캠페인은 failed). 휴대폰 창 발신번호 = **등록 회신번호 고르기**(문자 발송 창과 같은 목록 · 기본 = 기본 회신번호).

### B4 SMS 대체 길이(D-07)
- `resolveBrandFallback`: A(SMS) 최종 글(B3 뒤) 바이트 > 90 = `BrandMessageBuildError('SMS 대체 문구가 90바이트를 넘습니다(N바이트). LMS로 바꾸거나 줄여 주세요')` · B(LMS) > 2,000 = 같은 꼴. 바이트 = 백엔드 CT `smsByteLength`(`copy-text-metrics.ts`).
- `/brand-send` 는 차감 앞 조립에서 막힘(종전 순서) · AI · 직접발송 `kakao` 경로는 수신자마다 부르므로 차감 뒤 throw = 미적재 환불(종전 fail-closed 계약 · 그 경로 화면 입구 0 = API 전용).

### B5 받는 사람 4칸(D-05 · D-08 · D-09 · D-16) `BrandSendModal.tsx`
- 칸 = 직접입력 · 파일등록 · 주소록 · 타겟추출(문자 직접발송과 같은 4칸 · 옛 「AI 타겟추출」 탭은 타겟추출 창 안 AI 입력으로 합침 = `DirectTargetFilterModal`(`hideAi` 그대로)).
- 번호 규칙(D-16): 브랜드 직접입력도 알림톡과 같은 `checkAlimtalkPaste` 규칙(줄바꿈 · 쉼표 · 세미콜론 · `normalizePhoneKr` · 10자리 이상 · 공백 구분은 그대로 받는다 = 옛 브랜드 붙여넣기 호환) · 옛 「9~11자리 아무 숫자」 `checkBrandPaste` · `normalizeBrandPhones` 삭제. 사람이 직접 친 10자리 일반 전화는 그대로 받는다(사람 입력 = 의도 · 카카오가 실패로 돌려주고 실패 환불).
- 파일등록(D-08 · D-16): xlsx · xls · csv = `/api/upload/parse?includeData=true`(문자 · 알림톡과 같은 입구) → 번호 칸 고르기 · txt = 지금처럼 글로 읽어 직접입력 규칙. 칸 고르기: 앞 50행 중 80% 이상이 휴대폰 꼴(`010`·`011`·`016`·`017`·`018`·`019` + 10~11자리)인 칸이 **하나뿐이면 바로 담기**(안내 「'휴대폰' 칸에서 N명」 + [다른 칸 고르기]) · 둘 이상 · 0이면 칸 고르기 창(칸마다 앞 3개 값). 머리가 없는 파일(첫 줄도 휴대폰 꼴)은 첫 줄도 명단에 넣는다. 판정 = 프론트 CT `pickPhoneColumn`(`recipient-paste.ts` · 순수).
- 주소록(D-09): `AddressBookModal` 을 연다 · 번호만 쓴다 · `dedupOnAdd={dedupEnabled}`(R31 계약 = 붙여넣기도 `planAppend(…, dedupEnabled)`).
- 타겟추출(D-05): 문자 직접발송과 같은 잠금 축(`targetExtractLocked` · `onTargetExtractLocked`) · 담기 = `fetchTargetExtractionRows` → 번호 칸(`phoneField`) → 명단(조건 = 대상 → 지금 명단을 바꾼다 · 옛 AI 타겟추출과 같은 규칙).
- 늦은 응답 무효화 = 기존 `reqSeqRef` 하나(모든 불러오기가 `setRecipients` 한 길).

### B6 알림톡 창 타겟추출(D-05) `AlimtalkSendModal.tsx`
- 칸 = 직접입력 · 파일등록 · 주소록 · **타겟추출**(새) · 담기 = `fetchTargetExtractionRows` → `extractionRowsToTable` → 이 창의 파일등록 칸 맞추기 흐름(템플릿 변수 칸까지 고르기) · 잠금 축 = 문자 직접발송과 같다.

### B7 중복 · 수신거부 표시(D-04 · D-06 · D-15)
- 브랜드 수신자 열 = [중복제거](켜고 끔 · 기본 켬 · `planAppend` 의 dedup) · [수신거부제거 · 브랜드는 항상](잠김 · 서버가 늘 뺀다 = 사실과 같은 표시).
- 확인 창: 열 때 `/api/unsubscribes/check`(떠 둔 명단) → 돌려받은 `unsubscribePhones`(숫자) 집합으로 **떠 둔 명단의 각 출현**을 센다 = 「수신거부 k건 빠짐 · 실제 발송 N−k건」(서버 거름 `brand-message.ts:1594` 이 출현마다 빼는 것과 같은 셈 · 예 [A, A, B] 에서 A 거부 = 실제 1건 · Codex 설계 1R #7) · 중복제거를 끈 명단이면 「같은 번호 d건 · 여러 번 나갑니다」. 늦게 온 점검 응답은 세대로 버린다. 점검 실패 = 안내 없이 진행 막지 않음(서버가 늘 거른다).
- D-15: `/unsubscribes/check` 의 수신거부 비교를 서버 거름과 같은 CT `getUnsubscribedPhones`(숫자만 비교)로(지금 = `phone = ANY` 원문 비교 · 하이픈 저장 번호를 못 셈). 소비처 = 문자 직접발송 · 알림톡 확인 창(같은 계산이 됨 · 수가 늘 수만 있다).

### B8 타겟팅 안내(D-11)
- 타겟팅 풍선 각 줄에 단가 줄: 채널 친구 = 「친구 단가」 · 비친구만 · 마수동 전체 = 「비친구 단가」(마수동 전체는 친구가 섞여도 비친구 단가 · 기능 문서 §9-2).

## §4 묶음 G · 비토엔진 실패 코드(D-13 · H3 · 뿌리 R62 신설) · 게이트웨이 저장소

사실(흐름 표 §5-4): 원본 3018 · 509 가 엔진에서 그대로 오고 한줄로 에이전트가 `status_values.failed` = 9999 로 덮는다. 원본을 그대로 넘기면 안 된다(기계 대조 1105: 젬텍 원본 `100` · `104` = 한줄로 대기 코드 → 실패가 영영 대기 · `4000` = 한줄로 「전송 시간 초과」 · 글자 코드 `ME04` · `E_NET_FAIL` · `NO_BIND` = 숫자 칸 불가 · 휴머스온 21개 · 젬텍 26개 · 비토 5개 겹침).

- G1 DDL(게이트웨이 · 새 마이그레이션): `agent_account.failure_code_policy VARCHAR(16) NOT NULL DEFAULT 'raw'`(`raw` = 종전 · `mapped` = 아래 번역) · `report_queue.customer_code VARCHAR(10) NULL`.
- G2 SQL 함수 `customer_failure_code(agent_id, origin_request_id, raw_code, report_type)` — `origin_request_id` = **실패 원본을 낸 요청**(대체 문자 실패 = 문자 자식 `child.requestID` · 그 밖 = 그 요청 자신). 적재 · 전달 식별자는 부모 그대로(Codex 설계 1R #5 · `report.go:979` 부모 적재 · `:1302` 자식 코드). 콘솔과 같은 판정(원본 → 표준 = `provider_result_code_map` + 058 후보 함수 · 표준 → 고객 = `customer_result_code_map` **에이전트 범위 행만**) → 고객 코드 · 없으면 `'9999'`. 결과가 숫자 1~5자리가 아니면 `'9999'`.
- G3 엔진: `report_queue` 적재 SQL 두 곳(`report.go enqueueReportOnce` · `report_batcher.go`)이 같은 SQL 조각으로 `customer_code` 를 채운다(정책 `mapped` · 결과 판정 = 실패일 때만 · `RETURNING customer_code`). `OutboundReport` 를 만드는 다섯 자리(`report.go:368` · `:986` · `:1230` · `:1281` · `report_batcher.go:536`)는 한 생성 함수를 지나 `ResultCode = 고객 코드(있으면)` · 재전달(`grpc_server.go:925`)은 `COALESCE(customer_code, result_code)`. 성공 · 7830 · 7831 · 대기 · 결과 없음 = 손대지 않음. `report_queue.result_code` 원문은 그대로(콘솔 · 감사 근거).
- G4 DML(게이트웨이 · Harold): 한줄로 에이전트(설치 원장 = hanjul02 · hanjul03 · 그 밖 한줄로 에이전트는 실행 전 조회로 확정)마다 `customer_result_code_map` 행 = 표준 코드 → **한줄로 예약 대역 코드**. 대역 규칙 = 표준 코드 안 4자리 번호 n 과 계열로 **KAKAO = 20000 + n · LMSMMS = 30000 + n · SMS = 40000 + n · V(공통) = 50000 + n** · 그 밖 계열 = 행 없음(= 9999)(예: KAKAO_3018 → 23018 · LMSMMS_3000 → 33000). 계열 = 게이트웨이 코드북 기계 대조 1105(KAKAO 162 · LMSMMS 43 · SMS 28 · V 17 · 그 밖 0) · 한줄로 결과 표 최대 키 = 9999(1105 대조). 이 대역(20000 ~ 59999)이 한줄로 결과 표 키와 겹침 0 · 성공(6 · 1000 · 1800 · 7830 · 7831) · 대기(100 · 104) 밖 · `ABNORMAL_STATUS_MIN`(100000) 아래 = 생성 스크립트가 단언(겹치면 생성 실패). 행 = 생성 스크립트가 게이트웨이 운영 DB 의 표준 코드 표에서 뽑는다(손 목록 0 · 실행 전 조회 1회).
- G5 한줄로 라벨: `sms-result-map.ts STATUS_CODE_MAP` 에 대역 코드 라벨을 **생성 파일**(`result-code-hanjul-band.generated.ts`)로 붙인다 · 계약 시험 = 대역 코드 ⊂ 예약 대역 · 성공 · 대기 코드와 겹침 0 · 라벨 존재.
- G5' 사전 실측(Harold · 게이트웨이 배포 전): ① 한줄로 에이전트 판 · 설정의 `failure_code_source` · `state_policy` 조회(설치 폴더 설정 파일 읽기 · 비밀값 줄 제외) ② 운영 DB 표준 코드 목록(계열 · 번호 · 기본 고객 코드) ③ 한줄로 SMSQ 결과 칸(`status_code`) 형식 = 정수 확인(대역 5자리가 들어가는가).
- G6 정책 켜는 순서(배포 뒤): 한줄로 배포(G5 라벨) → 게이트웨이 배포(G1 · G2 · G3) → DML(G4) → `agent_account.failure_code_policy = 'mapped'`(에이전트 하나씩) → **전환 조건 조회**: 그 에이전트의 진행 중 요청(종결 전 `message_request`) 0 · **미확인 결과 보고(`report_queue` ACK 전) 중 `customer_code` 가 빈 행 0**(정책 전에 쌓인 보고는 원본 코드라 재전달되면 100 · 104 가 대기로 기록된다 · Codex 설계 1R #2 · 적재 0건만으로는 미확인 보고 0 이 보장되지 않는다) → 한줄로 에이전트 설정 `failure_code_source: gateway_report` + 재시작(한 대씩) → 실패 1건 실측. 조건이 0 이 아니면 기다렸다 다시 조회(설정을 바꾸지 않는다).

## §5 영향표(소비처 전수 · 바뀌는 것 · 돈)

| 소비처 | 바뀌는 것 | 돈 |
|---|---|---|
| 후불 정산서 · 메일 · 일괄발급 · 미리보기 | 브랜드 대체분이 「SMS(대체발송) · LMS(대체발송)」 줄로 · 브랜드 줄은 그만큼 감소 | 브랜드 단가 → 문자 단가(접수 T3 기대 그대로) · 이미 발행한 정산서 = 그대로(스냅샷) |
| 고객사 발송통계 화면 · 엑셀 | 같은 이동 | 없음(표시) |
| 일일 인사이트 메일 | 없음(전 유형 합) | 없음 |
| 선불 차감(브랜드 전용 · 대체 켬) | 차감 단가 = max(브랜드, 대체 문자) · 결과별 차액 환불 | 대체 성공은 문자 값 · 브랜드 성공은 브랜드 값으로 수렴 |
| 선불 차감(대체 끔 · both · 알림톡) | 없음 | 없음 |
| 발송결과 목록 · 모바일 · 관리자 목록 | 브랜드 = 시도 + 대체 아랫줄 · 채널 칩 친구/비친구 | 예상 비용 = 결과별 단가 |
| 목록 CSV | 알림톡 · 브랜드 대체 줄 추가 | 없음 |
| 슈퍼 통계 엑셀 | 브랜드 시도 줄 + 대체 줄 · 이름 친구/비친구 | 없음 |
| 발송 상세 · 상세 엑셀 · 고객 타임라인 | F + 7830 = 「대체 SMS」 · 「대체」 거르기에 잡힘 | 없음 |
| 관리자 발송 상세 isFallback | 브랜드 대체도 참 | 없음 |
| 테스트 브랜드 대체 | 테스트 SMS · LMS 로 | 단가 변화(테스트 브랜드 → 테스트 문자) |
| `/unsubscribes/check`(문자 · 알림톡 확인 창) | 하이픈 저장 번호도 셈 | 없음(표시 수만) |
| 브랜드 직접입력 · 파일 | 휴대폰 꼴만(9자리 · 지역번호 · 회원번호 빠짐) · 엑셀 받음 | 엉뚱한 번호 차감 0 |
| 게이트웨이(정책 raw 에이전트) | 없음 | 없음 |
| 후불 요금제 무료 제공(문자) | 브랜드 대체 문자도 문자 무료로 공제(`inheritFrom` · 알림톡 대체와 같은 현행 규칙) | 무료 남은 회사는 대체분 0원 |
| 선불 무료 제공 | 없음(브랜드 차감은 무료 대상 아님 · 종전) | 없음 |
| 정산서 줄 이름 | 「브랜드메시지」 → 「브랜드메시지(친구)」 · 2쪽 좁은 칸 줄바꿈 실측(「브랜드메시지(비친구)」가 이미 같은 길이) | 없음 · 발행본 = 스냅샷 |
| 금칙어 판정(D-17) | 대체 문구도 판정 · 걸리면 발송 0(차감 앞) | 없음 |
| 브랜드 타겟추출 잠금 | AI 요금제 잠금 → 문자 직접발송과 같은 고객 DB 잠금 · 창 안 AI 줄은 서버가 요금제로 거절(문자 발송 창과 같음) | 없음 |

DDL: 한줄로 0 · 게이트웨이 G1(ADD COLUMN 두 개 · nullable/기본값) · DML: 게이트웨이 G4.

## §6 뿌리 대장 · 계약 시험(대상은 소스에서 기계로 뽑는다)

| 뿌리 | 시험 | 대상 추출 | 변이(빨간불) |
|---|---|---|---|
| R1 넓힘(대체 판정 = K · F 한 곳) | `c107-brand-contract-1105.test.ts` K1 | ① backend 전수에서 `7830` · `7831` 숫자 · `msg_type = 'K'` 와 결과 코드를 함께 쓰는 줄 = `sms-result-map.ts` 밖 0 ② `send_channel === 'alimtalk'` 로 분리 대상을 고르는 줄 0(전부 `isKakaoSplitChannel`) ③ `BILLING_MSG_TYPE_SQL` 안에서 대체 WHEN 이 `msg_type = 'F'` 갈래보다 앞 ④ 표 시험: F + 7830/7831 → fallbackOf · tally · 라벨 · 청구 코드 | `KAKAO_FALLBACK_PARENT_TYPES` 에서 F 빼기 → K1 ④ 실패 · WHEN 순서 되돌리기 → ③ 실패 |
| R1(수신거부 판정 한 벌) | K2 | `routes/unsubscribes.ts` `/check` 처리기 안 `getUnsubscribedPhones` 호출 · `phone = ANY` 0 | 원문 비교로 되돌리기 → 실패 |
| R61 신설(광고 문자 표기 출구) | K3 | backend 전수 `resolveBrandFallback(` 부르는 자리 → 인자 객체에 `isAd` · `opt080Number` 키 · 함수 안 `buildAdMessage` 호출 · 표 시험(광고 SMS = `(광고)` 시작 · `무료거부` 끝 · 90바이트 넘으면 throw) | 함수에서 buildAdMessage 빼기 → 실패 |
| R31 넓힘(받는 사람 칸 · 중복 규칙) | K4 | 프론트 전수 `<RecipientDirectInputModal` 을 여는 파일 → 그 파일 붙여넣기 = `planAppend(…, dedupEnabled)` · `중복제거` 단추가 같은 `dedupEnabled` 에 묶임 · `checkBrandPaste` · `normalizeBrandPhones` 정의 0 | 브랜드 붙여넣기를 늘 중복 빼기로 되돌리기 → 실패 |
| R63 신설(문자로 나가는 글 = 금칙어 판정 입력 전부) | K6 | backend 전수: `resolveBrandFallback(` 을 부르는 함수 · `insertAlimtalkQueue(` 를 부르는 함수 → 같은 함수(또는 그 커밋 단계) 안에 `kakaoFallbackSpamItems` 호출 · 면제 = 이유 줄 · 낡은 면제 = 실패 | `/brand-send` 판정 호출 빼기 → 실패 |
| R62 신설(외부 결과 코드 → 고객 코드 번역 한 곳) | 게이트웨이 Go 시험 + 한줄로 K5 | 게이트웨이: `pb.ReportMessage{` 를 만드는 자리 전수 = 번역 함수 경유 · 한줄로: 생성 라벨 ⊂ 예약 대역 · 성공 · 대기 겹침 0 | 번역 함수 우회 → 실패 |
| (돈) 선불 대체 정산 | `refund-calc` · `deduct-reference` 표 시험 + 실 PG `c107-brand-prepaid-1105` | 브랜드 21 · SMS 8.18 · LMS 23.6 실례 · max 차감 · 차액 · 미설정 단가 = 종전 | 차감 단가를 브랜드로 되돌리기 → 실 PG 실패 |

## §7 시험(구현 때)

- 백엔드 vitest: 위 K1 ~ K5 · `sms-result-map` 표 · `refund-calc` · `deduct-reference` · `resolveBrandFallback` 표.
- 실 PG(test:pg): 선불 차감 결과별 단가 기록 · 스위퍼 차액(브랜드 전용 캠페인 · 7830 · 7831 · 1800 섞임).
- 프론트 tsc · 화면 실측(브라우저 미리보기 · 1440 · 1600 · 1920 · 모바일 폭 · 휴대폰 창 · 칩 · 4칸).
- 게이트웨이: Go 시험(번역 함수 · 두 전달 길) · 마이그레이션 왕복.

## §8 직원 지시문(초안 · 시트 = `docs/2026-11-05-c107-staff-sheet.xlsx` · 순 38 ~)

계정 = 테스트계정 psy5868 · 받는 번호 = 박성용 휴대폰(채널 친구) · 법인폰(비친구) · 시각 = 08:00 ~ 20:50.

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 38 | 문자 발송 창 오른쪽 위 [브랜드메시지]를 누른다 | 받는 사람 칸이 「직접입력 · 파일등록 · 주소록 · 타겟추출」 4개 · 그 아래 「중복제거」 · 「수신거부제거 · 브랜드는 항상」 |
| 39 | 아래 [실패 시 문자]를 누른다 | 휴대폰 모양 창이 뜬다 · 창이 화면 밖으로 내려가지 않는다 |
| 40 | 창에서 [SMS]를 고르고 말풍선에 「안녕하세요」를 쓰고 [저장] | 창이 닫히고 아래 칸에 「SMS로 대체」 |
| 41 | 다시 열어 말풍선에 아무 글을 100자 넘게 쓴다 | 바이트가 빨간색 · [저장]이 눌리지 않고 「LMS로 바꾸기」 단추가 보인다 |
| 42 | 직접입력에 박성용 · 법인폰 번호를 넣고 [채널 친구] · [SMS로 대체](「대체 시험」)로 보낸다 | 박성용 = 브랜드메시지 · 법인폰 = 문자 「(광고)대체 시험 … 무료거부080…」 |
| 43 | [발송결과]를 연다 | 그 줄 = 「브랜드메시지(친구) 2 · 성공 1 · 실패 1」 + 아랫줄 「↳ 브랜드메시지 실패분 · 대체 SMS 1 · 성공 1」 |
| 44 | 그 줄 [상세]를 누른다 | 법인폰 줄 유형 = 「대체 SMS」 · 결과 = 「SMS 대체 성공」 · 위 [대체]를 누르면 그 한 줄만 |
| 45 | 관리 > 발송통계에서 오늘을 엑셀로 받는다 | 「브랜드메시지」 1 과 「SMS(대체발송)」 1 이 따로 |
| 46 | 알림톡 발송 창 [실패 시 문자]를 누른다 | 같은 휴대폰 모양 창 · 「대체 안 함 · 원문 그대로 LMS · 대체문안 작성」 |
| 47 | 알림톡 · 브랜드 창에서 [타겟추출]을 누른다 | 문자 발송과 같은 타겟 추출 창 |
| 48 | 브랜드 창 [파일등록]에 엑셀(휴대폰 칸 + 매장 전화 칸)을 올린다 | 「'휴대폰' 칸에서 N명」 · 매장 전화 번호는 명단에 없다 |
| 49 | (게이트웨이 배포 · 정책 켬 뒤) [채널 친구]로 법인폰에만 [대체 안 함] 발송 | 발송 상세 결과 = 「카카오: 메시지를 발송할 수 없음」(「기타 오류」 아님) |

## §9 배포 순서

1. 한줄로(A · B · G5 라벨) = C104 · C105 · C106 과 한 배포 · DDL 0 · 배포 전 실측 = C105-S0(그 카드) · 빌드 = `npm run build:safe` · 재시작 = 적재 0건 때만(배포 원장 기록 그대로).
2. 게이트웨이(G1 · G2 · G3) = 게이트웨이 `status/DEPLOY-RUNBOOK.md` 그대로 · DDL G1 먼저.
3. G4 DML → G6 정책 켜기 → 에이전트 설정 · 재시작(한 대씩 · 적재 0건) → 순 49 실측.

## §10 구조체크 기록(설계)

### §10-1 1회차(이음매 = 흐름 표 E · R · C · S · X · V · M · K 전부 · 결함 9 → 설계 정정)

| # | 이음매 | 결함 | 정정 |
|---|---|---|---|
| S1-1 | 문자 경로 금칙어 판정 ↔ 카카오 대체 문구 | 대체 문구가 금칙어 판정 입력에 0(브랜드 · 알림톡 · 직접 · 자동) = **D-17** | B3' · R63 |
| S1-2 | 결과 라벨 ↔ 테스트 목록 3곳 | 1인자 호출 = 테스트 브랜드 대체가 「브랜드메시지」 · 청구는 테스트 SMS | A1 「부르는 자리 전부 결과 코드」 |
| S1-3 | 결과 화면 이름 ↔ 정산서 이름 | 「브랜드메시지(친구)」(화면) · 「브랜드메시지」(정산서) 두 이름 | A1 이름 한 벌(청구 유형 이름 하나) |
| S1-4 | 차감 자리 ↔ 대체 큐 유형 | NO/SM/LM → N/A/B 판정이 차감 자리에 또 생김 | `brandFallbackQueueType` 하나 |
| S1-5 | 광고 080 비었을 때 | 설계 초안 = 막음 · 문자 직접발송 = 「무료거부」 글자만 → 같은 사실 두 규칙 | 문자 직접발송 규칙 그대로 |
| S1-6 | 엔진 적재 ↔ 실시간 · 재전달 | 적재 SQL 두 곳 · 보고 생성 다섯 곳 중 일부만 번역할 수 있었다 | G3 두 적재 같은 조각 · 다섯 생성 = 한 함수 · 재전달 COALESCE |
| S1-7 | 대역 코드 ↔ 한줄로 결과 표 | 대역 규칙이 미확정(6자리 · 겹침 가능) | G4 계열별 2만 단위 · 대조 근거 |
| S1-8 | 파일 칸 고르기 ↔ 머리 없는 파일 · txt | 첫 줄 손실 · txt 를 못 받음(옛 기능 후퇴) | B5 머리 없는 파일 · txt 길 |
| S1-9 | 브랜드 타겟추출 잠금 | AI 요금제 잠금 → 고객 DB 잠금으로 바뀌는 것이 영향표에 없었다 | §5 줄 추가 |

정상 판정(근거): 요약 카드 받은 사람 기준(알림톡과 같은 정의 · 흐름 표 V1) · `both` 분리 제외(브랜드 대체를 늘 끔 · `campaigns.ts:1165`) · 취소 환불(대기 F행 BRAND 축 · 차감 단가 되읽기 · 그대로 수렴) · 후불 무료 공제(알림톡 대체와 같은 현행 · §5 줄) · 야간(대체 문구에 (광고)가 붙으면 게이트웨이 야간 광고 정책 `policy.go:368` 을 탄다 = 법 준수 쪽 · 브랜드 발송 창 08:00 ~ 20:50 이라 거의 0).

### §10-2 2회차(1회차 정정 줄 + 그 줄이 닿는 이음매 · 결함 2 → 정정)

| # | 이음매 | 결함 | 정정 |
|---|---|---|---|
| S2-1 | 대체 문자 발신번호 ↔ 회사 등록 발신번호 | 자유 입력 그대로 적재(규격 · 등록 판정 0) = **D-18** | B3'' |
| S2-2 | 목록 CSV 채널 이름 ↔ 이름 한 벌 | CSV 가 「브랜드메시지」를 따로 씀 · 대상값 SELECT 없음 | A5 이름 CT |

정상 판정(근거): 확인 창 수신거부 수(`/check` 정정 뒤 서버 거름과 같은 CT · 같은 user 범위) · 브랜드 기본형 차감 단가(대상 + 형태 순서표 그대로 · 결과별 단가의 브랜드 값 = 그 값) · 스위퍼 결과별 갈래(원장 축 `all` = 브랜드 전용 · 대체 행 0 이라 모호 판정 0) · 엔진 번역 입력(적재 때 request_id 로 요청 행의 유형 · 연결 공급사를 읽는다) · 에이전트 재시작(G6 적재 0건 · 한 대씩).

### §10-4 Codex 설계 1R(needs-attention · 지적 7 · 전부 수용)

| # | 등급 | 지적 | 판정 · 처방 자리 | 직전 뿌리와 같은가 |
|---|---|---|---|---|
| 1 | high | 고르지 않은 문자 단가 미설정 = 정산 꺼짐 | 수용 · A8 필수 단가 두 개 · 고르지 않은 칸 = 차감 단가 | 새 |
| 2 | high | 정책 전 미확인 보고가 원본 코드로 재전달 | 수용 · G6 전환 조건 조회 | 새 |
| 3 | high | 대체 끔에도 회신번호 판정 | 수용 · B3'' 대체 켬일 때만 | 새 |
| 4 | medium | LMS 광고 표기된 본문을 SMS 대체로 재조립 0 | 수용 · B3 조립 입력 = 표기 전 원문 하나 | 새 |
| 5 | medium | 대체 문자 실패를 부모 맥락으로 번역 | 수용 · G2 origin_request_id | 새 |
| 6 | medium | 슈퍼 통계 친구 · 비친구 합산 | 수용 · A6 집계 키 | 새 |
| 7 | medium | 중복 허용 시 수신거부 제외 수 | 수용 · B7 출현 단위 | 새 |

### §10-5 Codex 설계 2R = approve(지적 0 · 1105)

- 2R 실행 중 B3 「조립 입력」 줄을 구체화했다(`prepareSendMessage` 반환 `body` 칸 · 2R 지적 2번 물음의 답 = `stripAdParts` 는 정확한 표기 꼴만 걷어 본문 무손상 · 080 빈 꼬리는 못 걷으므로 부르는 쪽이 표기 전 글을 넘긴다). 판정 내용은 2R 이 본 #4 처방과 같고, 코드는 구현 리뷰 1R 범위에 넣는다.

### §10-3 3회차(2회차 정정 줄 + 닿는 이음매)

결함 0. 근거: B3'' 판정 CT 는 이미 다섯 발송 길이 쓰는 함수 · 거절은 차감 앞(`sendBrandMessage` 조립 단계 · 기본형도 같은 자리) · 휴대폰 창 목록은 문자 발송 창이 쓰는 회신번호 목록 API 그대로 · A5 SELECT 추가 칸은 이미 운영 SELECT(`results.ts:329`)가 읽는 칸.

## §11 구현 기록(1105)

### §11-1 한줄로(A · B · G5)

- 검증 = backend tsc 0 · frontend tsc 0 · 계약 `c107-brand-contract-1105` 23(K1 ~ K6) · 변이 21가지 전부 빨간불(설계 11 · 1R 처방 4 · 2R 처방 3 · 돈 1 · K6 보강 2) · 실 PG `c107-brand-prepaid-1105` 4(공급가 기준 = 부가세 포함 차감) · 스위퍼 브랜드 축 차액 단위 시험 · 화면 실측(임시 화면 · 1920 · 1440 · 1280 · 1150 · 1000 · 375 가로 넘침 0 · 휴대폰 창 57/90 = 서버 계산 · 91 = 저장 잠김 + LMS로 바꾸기 · 알림톡 같은 창 · 확인 뒤 임시 파일 삭제).
- 옛 동작을 고정하던 시험 갱신 = kakao-send-windows-0925 · direct-input-modal-0925 · target-send-keep-screen-0929 · sms-alimtalk-result-agg-0926 · spam-block-preflight-1003(배선 수 = 본문 5 + 대체 5) · 금칙어 경로 이름표 `brand`.
- Codex 구현 1R(needs-attention · 3 + 권고): ① 대체 080 = 화면 · 서버 다른 입력(R61 같은 부류) → `brandFallbackOpt080` = 보내는 수신거부 번호 · 없을 때만 설정 080 · 화면 휴대폰 창도 같은 값 ② 알림톡 타겟추출 늦은 응답 → 표 불러오기 세대 하나(열기 · 닫기 · 명단 바뀜 · 새 불러오기) ③ 번호 칸 판정 분모 → 원값 전부 · 드문드문 = 고르기 창 · 권고 = K6 「판정 결과가 막는가」(첫 꼴은 변이를 못 잡아 if 블록만 떼는 꼴로 고침).
- Codex 구현 2R(needs-attention · 2 + 범위 밖 1 · **둘 다 1R 과 같은 부류** → 구조 처방): 번호 칸 = 같은 기능 안 판정 두 벌(후보 = 숫자만 · 추출 = 0 복원) + 백엔드 CT 가 이미 있었다 → 프론트 판정 = 백엔드 `scorePhoneColumns` · `pickPhoneColumnStrict` 미러 하나(엄격 규칙 0.9 · 격차 0.3) · 계약이 두 판정을 표로 대조 · 칸 맞추기 창 = 열린 창도 세대를 갖는다(세대 바뀜 = 닫음 · 적용 직전 대조) · 범위 밖 [다른 칸 고르기] = 이번 축(D-08) 결함이라 같은 축에서 닫음(담기 전 명단 + 새 칸 = 바꾸기 · 명단이 바뀌었으면 단추 감춤).
- Codex 구현 3R = approve · 4R(G5 대역 라벨만) = approve.
- G5 = 대역 라벨 생성 파일 `result-code-hanjul-band.generated.ts`(244 · 생성 = `scripts/gen-result-code-hanjul-band.mjs` · 원천 = 게이트웨이 migrations 를 얹은 시험 DB) · 결과 표에 섞지 않고 `bandStatusInfo` 로 라벨 · 유형 조회 뒤 단계(섞으면 「스팸」 글자로 뽑는 SPAM_BLOCK_STATUS_CODES 가 바뀐다 = 추가 과제 · 비토 라인 스팸 차단 대역 코드를 스팸 몰림 경보에 넣을지).

### §11-2 게이트웨이(G1 ~ G4 · G6 절차)

- 파일 = `migrations/100_customer_failure_code.sql` · `scripts/gw/customer-failure-codes-hanjul.sql` · `internal/gateway/engine/customer_failure_code.go`(새) · `report.go`(적재 함수 + 보고 네 자리) · `report_batcher.go`(묶음 CTE · 입력 failed · 결과 customer_code · 보고 한 자리) · `session/grpc_server.go`(재전달 COALESCE) · `queue/registry.go` + `cmd/gateway/main.go`(기동 게이트 `CheckCustomerFailureCodeSchema`).
- 검증 = go build 0 · go vet ./... 0 · go test ./... = 바꾼 패키지 전부 통과(실패 5 = cmd/agent-bootstrap · internal/agent/bootstrap Windows 파일 권한 시험 · 바꾼 패키지 의존 0) · 시험 그릇 `t_gw_c107`(PG 15 · migrations 001 ~ 100 · 재실행 재진입) 에서 engine Postgres 시험 전부 + 새 `TestCustomerFailureCodePostgres`(3018 → 23018 · 대체 LMS 509 → 33000(자식 요청으로) · 미분류 → 59000 · 숫자 아닌 고객 코드 → 9999 · 없는 원 요청 → 9999 · 정책 raw · 성공 · 대체 성공 · 빈 코드 = 원 코드 · 단건 = 묶음) · 계약 `TestAgentReportCodeGoesThroughCustomerFailureCode`(AST) · G4 SQL psql 실행 = 대역 행 244 · 재실행 그대로 · 없는 에이전트 멈춤.
- 실 PG 가 잡은 것 = 같은 자리 번호를 칼럼(varchar) · 함수 인자(text)로 쓰면 42P08 inconsistent types → 적재 전체가 깨진다 → 그 자리 번호는 `$2::varchar` 로 굳힌다(목 DB 시험은 못 잡는 종류).
- Codex 게이트웨이 1R(needs-attention · 2 · 전부 수용): ① G4 가 남겨 두는 기존 에이전트 행이 한줄로 성공 · 대기 코드를 가리키면 실패가 「대기」 → G4 커밋 전 그 에이전트 활성 행 전부 × 예약 코드(6 · 1000 · 1800 · 7830 · 7831 · 100 · 104 · 정수 비교 = 0104 도) 겹치면 전부 되돌리고 멈춤 · 한줄로 K5 가 목록 = SUCCESS_CODES ∪ PENDING_CODES 대조 ② 고객 코드 고르기에 고객사 · 발송계정 범위 없음 → 웹훅과 같은 범위 조건.
- Codex 게이트웨이 2R(needs-attention · 1 · **1R ② 와 같은 부류** = 웹훅 순서를 손으로 옮기다 어긋남) → 구조 처방: 함수의 고객 매핑 조회 = 웹훅 crm 조각과 글자 그대로(다른 줄 둘 = 표준 코드 출처 · 이 에이전트 행만) · 계약 `TestCustomerCodeLookupMatchesWebhook` 가 두 파일 조각을 떼어 대조(순서 한 줄 변이 = 빨간불) · 실 PG 경쟁 사례(고객사 행 priority 20 · 에이전트만 행 priority 10 → 10).
- Codex 게이트웨이 3R = approve. 시험 그릇 DB 는 한줄로 test:pg 전체가 t_ DB 를 지워 한 번 다시 만들었다(스크래치패드 gw_apply_migrations.js --reset).
