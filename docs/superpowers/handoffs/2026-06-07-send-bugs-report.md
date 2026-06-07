# 발송 버그 3건 리포트 (2026-06-07) — 다음 세션 수정용

> 다음 세션은 이 문서로만 고친다. 각 버그 = 증상 / 증거 / 원인(파일·라인) / 수정 방향 / 1차 확인(코드 작성 전) / 주의.
> 도메인 = 발송·통계·정산. **진입 시 `status/lessons/LESSONS_BACKEND.md` 우선 정독.** SQL 신규 컬럼은 information_schema 검증, 외부(IMC/게이트웨이) 형식은 raw 직접 확인(`feedback_external_api_response_verification`). 발송 5경로(테스트/직접/캠페인/여정) 전수.
> **추측 금지** — 아래 "1차 확인"을 SQL/grep/raw로 먼저 끝낸 뒤 코드 작성.

---

## 버그 1 — 알림톡 버튼·추가유형 발송 실패 (게이트웨이 btnJson 빈값)

### 증상
알림톡 기본형(텍스트)은 발송 정상. 버튼 추가·채널추가형·강조표기형 등 기본형 외 모든 유형은 발송 실패.

### 증거
- 메시징 게이트웨이 deliver 수신 로그: `tmplCode[B_IV_013_02_79738] next[N] btnJson[] etcJson[]` — btnJson·etcJson이 **빈 값**으로 도착.
- 직원 리포트: "k_button_json 컬럼 입력 내용 확인 필요". 템플릿 유형이 기본형인 것 제외 전부 처리정보 누락.
- 템플릿 `B_IV_013_02_79738`(승인 안내) = "기본형·강조 표기형"(버튼/추가요소 있는 유형).

### 원인 (확정)
- 백엔드 발송 INSERT는 정상: [sms-queue.ts:768](packages/backend/src/utils/sms-queue.ts:768) `buttonJson → k_button_json`, `etcJson → k_etc_json` 저장.
- 호출부 [campaigns.ts:2023](packages/backend/src/routes/campaigns.ts:2023) `buttonJson: alimtalkButtonJson || null`. `alimtalkButtonJson`은 [campaigns.ts:1315·1490](packages/backend/src/routes/campaigns.ts:1490) **req.body로 받음**(프론트 전송 의존). 프론트가 안 보내면 null → 게이트웨이 btnJson[].
- `kakao_templates`엔 버튼 전용 컬럼이 **없음** — 버튼/강조요소는 `represent_link`·`item_highlight`·`item_list`·`item_summary`·`emphasize_subtitle`·`template_header`(jsonb, D130)에 저장(SCHEMA.md kakao_templates). `k_button_json`/`k_etc_json`은 SMSQ 발송 큐 컬럼(SCHEMA SMSQ_SEND).
- 프론트 grep: company-frontend(고객사)엔 버튼 처리 코드 0건. frontend는 `Dashboard.tsx`·`AlimtalkChannelPanel.tsx`·`AlimtalkManagementSection.tsx`에만 존재.

### 수정 방향 (정석)
백엔드가 `alimtalkTemplateCode`(또는 `alimtalkTemplateUuid`)로 `kakao_templates`를 조회해 `represent_link`(버튼)·`item_highlight`/`emphasize_subtitle`(강조) 등을 **IMC k_button_json/k_etc_json 형식으로 변환해 채운다**(프론트 전송이 비어도 안전, 검수 통과한 버튼이 정확). 프론트 전송값이 있으면 그걸 우선해도 됨.

### 1차 확인 (코드 작성 전)
1. frontend `Dashboard.tsx`/`AlimtalkChannelPanel.tsx`가 발송 시 `alimtalkButtonJson`을 실제로 채워 보내는지(content grep). 안 보내면 그게 1차 원인.
2. IMC/게이트웨이 `k_button_json`·`k_etc_json` 형식 스펙(버튼 배열 구조·강조표기 구조) — 정상 발송 1건 raw로 확인(추측 금지).
3. `kakao_templates`의 `represent_link`/`item_highlight` 등 실제 저장 구조 — information_schema + 샘플 row.

### 주의
발송 5경로(테스트/직접/캠페인/여정) 전수. 특히 테스트 발송이 실패라 테스트 경로 포함. 변환은 공통 CT로(경로별 누락 방지). 알림톡 실패 후 LMS 대체(next L/B) 시 title_str·etcJson도 함께(D224+ 사고 연장선).

---

## 버그 2 — 발송내역 일자 검색이 등록일 섞임 + 즉시발송 발송일시 −

### 증상
- 수퍼관리자 > 발송관리 > 캠페인관리에서 6/2~6/2 검색 시, 등록일만 6/2인 건(발송 6/4·6/19)도 노출. **발송일 기준으로만** 나와야 함.
- 예약이 아닌 즉시 발송 건은 발송일시가 −(빈 값)로 표시.

### 증거
- 시세이도: 등록 5/28·발송 6/2 건(발송일 매칭) + 등록 6/2·발송 6/4 건(등록일 매칭)이 6/2 검색에 **동시 노출**.
- 라프레리: 즉시 발송 건 발송일시 −, 등록 6/2 예약(발송 6/19) 건도 6/2 검색 노출.

### 원인 (확정)
- 검색 WHERE: [admin.ts:797·802](packages/backend/src/routes/admin.ts:797), [results.ts:118·248·393](packages/backend/src/routes/results.ts:118) 모두 `COALESCE(c.sent_at, c.scheduled_at, c.created_at)` — 발송일 우선이나 **둘 다 NULL이면 created_at(등록일)로 fallback**(D143 "미발송 폴백" 의도). 등록일만 6/2인 건이 섞임.
- 표시: admin 목록 SELECT [admin.ts:825](packages/backend/src/routes/admin.ts:825)가 `scheduled_at`만 가져옴(`sent_at` 미포함) → 즉시 발송(scheduled_at NULL) = −. (results 목록 [results.ts:466](packages/backend/src/routes/results.ts:466)은 `scheduled_at || sent_at`.)
- sent_at은 [campaign-lifecycle.ts:321](packages/backend/src/utils/campaign-lifecycle.ts:321)에서 완료 시 `COALESCE(scheduled_at, NOW())`로 채워짐(즉시 발송도 NOW). 즉 데이터는 있는데 **admin 표시가 sent_at을 안 봐서 −**.

### 수정 방향
1. 검색 = `COALESCE(sent_at, scheduled_at)`로 통일(created_at fallback 제거) — admin + results 공통. 발송일 기준만.
2. 표시 발송일시 = `COALESCE(sent_at, scheduled_at)` — admin SELECT에 `sent_at` 추가, 즉시 발송도 실제 발송 시각 표시. results도 `sent_at` 우선으로 통일 검토.

### 1차 확인 (코드 작성 전)
1. 화면(캠페인관리)의 정확한 endpoint 확정 — [admin.ts:771](packages/backend/src/routes/admin.ts:771)은 `status IN (scheduled, cancelled)` 전용(예약관리). 완료 포함 목록은 별도 endpoint(admin.ts:1632 근처 등) — 어느 것이 화면인지.
2. 실데이터 SQL — 등록 6/2·발송 6/4 "완료" 건의 `sent_at`/`scheduled_at` 실제 값. 왜 6/2 검색에 노출되는지 COALESCE 결과로 확정(추측 금지).
3. created_at 제거 시 "작성만 하고 미발송(scheduled_at도 NULL)" 캠페인이 검색에서 빠지는 영향 — 발송일 기준 정합인지 Harold 의도 재확인.

### 주의
정산이 발송일 기준(D143 취지)이라 sent_at 우선은 유지. billing 산출 소스(MySQL 직접 집계)와 충돌 없는지 확인.

---

## 버그 3 — 정산 통계에서 알림톡 대체발송 SMS/LMS 미구분

### 증상
- 알림톡 실패 후 대체발송이 통계에 "알림톡대체발송"으로만 잡히고 **SMS인지 LMS인지 구분 안 됨** → 정산 단가 산정 불가(게이트웨이 통계를 따로 봐야 함).
- 일부 케이스: 알림톡만 보냈는데 통계에 LMS로 표시(증거 2).

### 증거
- export 통계가 "알림톡 / 알림톡대체발송" 2행 분리(이전 세션5 작업)는 됨. 그러나 대체발송 행에 SMS/LMS 표기 없음.
- 직원 요청: "알림톡대체발송(LMS) 형식으로 타입 출력". 정산 시 S/LMS 확인 안 돼 청구 문제.

### 원인 (확정)
- [sms-result-map.ts:215](packages/backend/src/utils/sms-result-map.ts:215) `classifyMsgChannel`: `L + k_oriseq>0 → substitute`(단일). `S + k_oriseq>0`은 그냥 `sms`로 빠짐. substitute에 채널(SMS/LMS) 정보 없음.
- export [admin.ts:3320](packages/backend/src/routes/admin.ts:3320): `addExportBucket(c, 'substitute', '알림톡대체발송', ...)` — SMS/LMS 라벨 분리 없음.
- 증거 2(알림톡인데 LMS)는 다른 경로 — [stats-aggregation.ts:679](packages/backend/src/utils/stats-aggregation.ts:679)는 캠페인 `message_type` 기준(알림톡 캠페인은 message_type='LMS' 저장)이라, `send_channel='alimtalk'`이 안 잡히면 LMS로 표기.

### 수정 방향
1. `classifyMsgChannel`에서 대체발송을 채널별로 세분화: `L + oriseq>0 → substitute_lms`, `S + oriseq>0 → substitute_sms`.
2. `tallySmsChannelCounts`·`aggregateSmsChannelSplitByCampaign` 반영, export 라벨 "알림톡대체발송(LMS)" / "알림톡대체발송(SMS)".
3. `getSendTypeLabel`(발송결과 행 라벨)도 동일 세분화 검토.
4. 순수 코어라 [sms-channel-split.verify.ts](packages/backend/src/utils/__tests__/sms-channel-split.verify.ts) **TDD로 먼저** 케이스 추가(S+oriseq, L+oriseq).

### 1차 확인 (코드 작성 전)
1. 대체발송의 실제 `msg_type`(QTmsg SMSQ_SEND): 카카오 실패 후 SMS 대체가 `S`인지 `L`인지, `k_oriseq`가 채워지는지 raw row로 확인. (대체 채널이 본문 길이로 SMS/LMS 갈리는지도.)
2. 증거 2(알림톡인데 LMS) = `send_channel='alimtalk'` 미설정 캠페인이 있는지 SQL — 있으면 발송 시 send_channel 채우는 경로도 fix.

### 주의
정산 단가(SMS/LMS 상이)에 직결 = 청구 정확성. 발송결과 화면(getSendTypeLabel)과 export(classifyMsgChannel) 두 경로 모두 일관되게.

---

## 공통 — 다음 세션 진입 순서
1. `LESSONS_BACKEND.md` 정독 → 버그별 "1차 확인"(SQL/raw/grep) 먼저 끝낸다(추측 금지).
2. 버그 2가 가장 단순·확실(검색·표시 컬럼) → 먼저. 버그 3은 TDD(sms-channel-split). 버그 1은 IMC 형식 raw 확인이 선행.
3. 신규 컬럼 0 예상이나, SQL 추가 시 information_schema 검증. 배포 = backend + (버그1 frontend).
4. 미배포 상태인 자율예측(6종·VIP numeric·재계산 버튼·worker 조건)은 별도 — 이 버그 배포와 묶을지 분리할지 Harold 확인.
