# 비-문자 채널 개인화 점검 + 타겟추출 UI 설계서 (sub-project A)

> 작성일 2026-06-30. 브레인스토밍 결정 누적 + 코드 그라운딩 기반. **다음 세션 구현용** — 본 문서대로 진행하면 추측/혼선 없이 구현 가능하게 작성.
> 범위 밖(별도 스펙) = 카페24·고도몰 적용 + 과금 조사(sub-project B).

---

## 1. 배경 / 목표

AI 오퍼레이터에서 **문자(SMS/LMS)를 제외한 채널(이메일·모바일DM·인앱·카카오)** 에 대해:
1. **개인화가 실제로 수신자별로 작동하는지 점검**하고 빈틈을 메운다.
2. **각 발송 화면에 타겟 추출 장치**를 붙인다 — (a) "타겟 추출" 버튼, (b) 자연어 프롬프트 입력, (c) 추출된 고객 **인원수 표시**, (d) 선택적 세그먼트 저장.

브레인스토밍 확정:
- 범위 = 비-문자 전부(이메일·DM·인앱·카카오).
- 타겟 수명 = 발송 1회용 기본 + "세그먼트로 저장" 선택(기존 saved_segments 재사용).
- 구조 = **A1: 공용 추출(재사용) + 공용 모달 + 채널별 개인화**.

---

## 2. 현재 코드 상태 (그라운딩 — 재사용 대상 확정)

"맨바닥 신규"가 아니다. 아래가 이미 있고, 설계는 이를 재사용 + 비-문자 화면에 잇는 것이다.

### 2-1. 타겟 추출 + 인원수 (이미 완성, 재사용)
- **CT-97 `utils/ai-segment-generator.ts`** `generateSegmentFromNaturalLanguage({ companyId, naturalLanguage, customFieldKeys })` → `{ filter, explanation, matchCount, samples }`. 자연어 → AI(callAIWithFallback `model:'opus'`) → CT-01 호환 structured filter → buildCustomerFilter dry-run 검증 → **matchCount(인원수) + 샘플 5건**. "단 1 오차 없는 타겟" 원칙. **0건 = 자동완화 X(D171)**.
- **엔드포인트 존재**: `POST /api/saved-segments/generate-from-text` (saved-segments.ts:126), `POST /api/saved-segments/:id/preview`(previewMatching), 그리고 customers.ts·onboarding.ts에도 동일 호출.
- **CT-01 `utils/customer-filter.ts`** `buildCustomerFilter(filter)` = structured filter → 안전 SQL → 실제 고객 목록(발송 대상 산출).

### 2-2. 세그먼트 저장 (이미 완성, 재사용)
- **`utils/saved-segments.ts`** `saveSegment` — `saved_segments.filter_jsonb`(CT-97 결과)로 저장. 사용자당 20개. `getSegments`/`previewMatching`로 재조회·인원수.

### 2-3. 채널별 개인화 현황
- **이메일**: `utils/email/email-personalization.ts`(+ 검증 테스트). 이메일은 수신자별 발송이라 개인화 자연 작동(이미 됨).
- **인앱**: `utils/inapp-personalization.ts` 존재.
- **카카오(알림톡)**: 템플릿 변수 매핑(`AlimtalkChannelPanel.tsx` + 발송 시 `#{변수}` 치환). 템플릿 기반 — 문안은 승인 템플릿, 변수만 개인화.
- **모바일DM**: `utils/dm/dm-variable-resolver.ts` `resolveSections(sections, customer, companyId)` + `dm-viewer.ts` `renderDmViewerHtmlWithCustomer(customer)` — **고객별 렌더 가능**. 단 발행 URL이 공용 1개(`/api/dm/v/dm-<short_code>`)라 **접속자가 누군지 모름** → 수신자별 개인화 미작동(빈틈). ← 본 설계의 유일한 실질 신규 백엔드.

### 2-4. 프론트 기존 자산
- `components/DirectTargetFilterModal.tsx`(기존 타겟 필터 UI), `pages/SegmentsPage.tsx`(세그먼트 NL UI), 발송 화면 = `InAppMessagesPage.tsx`·DM 컴포넌트군·이메일 발송·`AlimtalkChannelPanel.tsx`·`DirectSendPanel.tsx`(문자).

---

## 3. 아키텍처 (A1)

```
[각 발송화면: 이메일 / 모바일DM / 인앱 / 카카오]
        │  "타겟 추출" 버튼
        ▼
[공용 <TargetExtractModal>]  ── 자연어 입력
        │  POST /api/targets/extract (공용 래퍼 = CT-97 재사용 + 채널 자격 필터)
        ▼
{ filter, matchCount, channelEligibleCount, samples }  ── 인원수 표시
        │  (선택) "세그먼트로 저장" → POST /api/saved-segments (filter_jsonb)
        ▼
[발송 대상 확정 = filter → buildCustomerFilter → 고객 목록]
        ▼
[채널 개인화 렌더 → 발송]
   - 이메일/인앱/카카오 = 기존 개인화 엔진 재사용
   - 모바일DM = 수신자별 토큰 링크(신규)
```

격리된 단위(각각 한 가지 역할):
1. **공용 추출 래퍼**(백엔드) — CT-97 + 채널 자격 필터.
2. **공용 모달**(프론트) — 자연어·인원수·저장. 채널 무관 동일.
3. **채널 어댑터**(개인화/발송) — 채널별 기존 엔진 + DM 토큰.

---

## 4. 컴포넌트 설계

### 4-1. 백엔드 — 공용 추출 엔드포인트 `POST /api/targets/extract`
- 입력: `{ naturalLanguage: string, channel: 'email'|'dm'|'inapp'|'kakao' }`.
- 처리:
  1. `generateSegmentFromNaturalLanguage`(CT-97) 호출 → `{ filter, matchCount, samples }`(전체 매칭).
  2. **채널 자격 필터** 적용 → `channelEligibleCount`(그 채널로 실제 보낼 수 있는 인원). 자격 규칙은 §6.
  3. 반환 `{ filter, explanation, matchCount, channelEligibleCount, samples }`.
- 구현 메모: CT-97은 그대로 두고 얇은 래퍼만 신설(또는 기존 generate-from-text에 `channel` 옵션 추가 + 자격 카운트). **CT-97 내부 수정 최소화**(0건 no-relax·검증 로직 보존).
- 0건: matchCount=0이면 기존 CT-97대로 throw "조건을 정정해주세요"(자동완화 X). channelEligibleCount=0(매칭은 있으나 그 채널 자격자 0)이면 발송 차단 + "이 채널로 보낼 수 있는 고객이 없습니다" 안내.

### 4-2. 백엔드 — 세그먼트 저장
- 기존 `POST /api/saved-segments`(saveSegment, filter_jsonb) 재사용. 신규 0. 모달의 "저장" 버튼이 추출된 filter를 그대로 전달.

### 4-3. 프론트 — 공용 `<TargetExtractModal>`
- 구성: 자연어 입력(textarea + Enter) → "타겟 추출" → 로딩 → **인원수 카드**(전체 matchCount + "이 채널 발송 가능 channelEligibleCount") + 샘플 미리보기 + "세그먼트로 저장"(선택) + "이 타겟으로 발송".
- props: `channel`, `onApply(filter, count)`. 채널만 다르고 UI/로직 동일 → 4 화면 공용.
- 디자인: 다크 톤 + ConfirmModal/useToast(native dialog X) + 모바일 반응형 + Source caption(기존 디자인 기준 동급).
- 기존 `DirectTargetFilterModal`과 관계: 가능하면 그 모달을 공용화/확장(중복 X). 구현 시 둘을 하나로 합칠지 확정(§9).

### 4-4. 채널별 개인화
- **이메일/인앱/카카오**: 기존 엔진 재사용. 점검 항목 = 추출된 고객 목록으로 발송 시 수신자별 변수가 실제 치환되는지 1건 실측(§8). 카카오는 승인 템플릿 변수만.
- **모바일DM = 수신자별 토큰 링크(신규, §5)**.

### 4-5. 발송화면 배선 (4채널)
- 각 발송 화면(이메일·DM·인앱·카카오)에 "타겟 추출" 버튼 → `<TargetExtractModal>` 오픈 → 적용 시 추출 filter를 그 화면의 발송 대상으로 set. 발송 실행 = filter → buildCustomerFilter → 고객 목록 → 채널 발송(기존 경로).
- 공통 안전필터(sms_opt_in/is_active/수신거부/is_invalid)는 발송 경로에서 항상 적용(기존 CT 재사용 — D232+ 교훈).

---

## 5. 모바일DM 수신자별 개인화 (유일한 실질 신규 백엔드)

목표: 접속자(수신자)별로 그 사람 데이터(%고객명% 등)가 치환된 DM을 보여준다. Harold 질문 "각각 개인화 가능한가" = **가능**. 렌더 엔진(`renderDmViewerHtmlWithCustomer`)은 이미 있고, "누가 접속했는지" 식별만 신설.

설계 = **수신자별 고유 토큰 링크**:
1. **토큰 발급**: DM 발송 staging 시 수신자별 토큰 발급. 신규 테이블(예) `dm_recipient_tokens(token PK, dm_id, customer_id, company_id, created_at, expires_at)`. token = 추측 불가 난수(예: 22+자 base62). 만료 = 발송 후 N일(예: 30일).
2. **발송 링크**: SMS/카카오 본문에 들어가는 DM 링크를 `/api/dm/v/dm-<code>?r=<token>`로(수신자별). 기존 발송이 이미 수신자별이라 자연.
3. **뷰어 라우트**: `?r=<token>` 있으면 → dm_recipient_tokens 조회 → customer 조회 → `renderDmViewerHtmlWithCustomer(customer)` 개인화 렌더. token 없거나 만료 → 공용 렌더(`renderDmViewerHtml`, 변수=fallback 값). 즉 토큰 없는 접근도 안전(이름 노출 0).
4. **프라이버시/보안**: URL에 PII 직접 노출 X(토큰만). 토큰 유출 시 그 고객 1명 데이터만 + 만료. 추적(trackDmView)도 token으로 수신자 단위 가능(부가).
5. **대안 비교**: 발송 시점 개인화 정적 HTML N개 사전 저장 = 무거움(저장량·갱신 불가). 토큰+동적 렌더가 가볍고 깔끔 → 채택.

구현 메모: 토큰 발급은 DM 발송 staging(수신자 확정 시점). 짧은URL/추적 인프라(dm-code·trackDmView) 확장 여부는 §9에서 확정.

---

## 6. 채널 자격 표 (channelEligibleCount 규칙)

| 채널 | 발송 가능 자격 (매칭 고객 중) |
|---|---|
| 이메일 | `email` 보유(NULL/'' 아님) + 이메일 수신동의(있으면) + is_active |
| 모바일DM | 전달 채널(SMS/카카오) 발송 가능(전화 유효·수신거부 아님) + is_active |
| 인앱 | 인앱 식별자/푸시 토큰 보유(인앱 구조 확인 필요 §9) |
| 카카오(알림톡) | 전화 유효 + 알림톡 발송 가능(정보성=수신동의 무관 가능, §9 확인) + is_active |

공통: 0건 자동완화 X. 매칭은 있는데 채널 자격 0이면 "이 채널로 보낼 수 있는 고객이 없습니다" 안내(발송 차단).

---

## 7. 데이터 흐름 (end to end)

1. 담당자가 이메일/DM/인앱/카카오 발송 화면에서 "타겟 추출" 클릭.
2. 모달에 자연어 입력 → `POST /api/targets/extract { naturalLanguage, channel }`.
3. CT-97 → filter + matchCount, + 채널 자격 → channelEligibleCount. 모달에 인원수 표시 + 샘플.
4. (선택) "세그먼트로 저장" → `POST /api/saved-segments`(filter_jsonb).
5. "이 타겟으로 발송" → 화면의 발송 대상 = filter. 발송 실행 시 buildCustomerFilter(filter) + 공통 안전필터 → 고객 목록.
6. 채널 개인화 렌더: 이메일/인앱/카카오 = 기존 엔진(수신자별 변수 치환), DM = 수신자별 토큰 링크 발급 + 본문에 삽입.
7. 발송(기존 채널 경로). DM은 수신자가 자기 링크 접속 시 개인화 페이지.

---

## 8. 엣지 / 에러 / 테스트

엣지·에러:
- 0건 매칭 → throw "조건 정정"(자동완화 절대 X, D171).
- 채널 자격 0 → 발송 차단 + 안내.
- 이메일/푸시 토큰 없는 고객 → 채널 자격에서 자동 제외(개인화 누락 아님).
- DM 토큰 만료/없음 → 공용 fallback 렌더(PII 노출 0).
- AI 응답 JSON 파싱 = `extractJsonFromAiText`(2026-06-30 ai-json CT) 경유(raw 제어문자 방어). CT-97이 이미 이 경로면 그대로.

테스트:
- 순수: 채널 자격 판정 로직(매칭 고객 → 채널별 자격 카운트)을 DB-free 순수 함수로 분리 + `*.test.ts`(vitest 자동 포함 — `.verify.ts`는 미포함 주의). DM 토큰 fallback 판정(token 유무 → 개인화 vs 공용)도 순수.
- 통합/실측: 채널별 1건 실측(추출 → 발송 → 수신자별 변수 치환 확인). DM = 토큰 링크 접속 → 개인화 페이지 1건 실측. (발송·돈 닿는 부분 = 실측 1건 시나리오 — 6원칙 ⑤.)
- tsc 0 + 기존 발송 5경로 회귀 점검(개인화/안전필터 불변).

---

## 9. 구현 전 확정 사항 (다음 세션 시작 시 코드로 먼저 확인 — 추측 금지)

1. **공용 추출 엔드포인트**: 신규 `/api/targets/extract` 래퍼 vs 기존 `/api/saved-segments/generate-from-text`에 `channel` 옵션 추가 — 둘 중 하나 확정(기존 확장이 더 가벼움).
2. **프론트 모달 통합**: `DirectTargetFilterModal`을 공용화/확장할지, 신규 `<TargetExtractModal>`를 만들지(중복 0 원칙). 기존 모달 소비처 grep 전수 후 결정.
3. **인앱 발송 식별자**: 인앱 메시지가 누구에게 어떻게 전달되는지(푸시 토큰/인앱 세션) — `inapp-message.ts`/`InAppMessagesPage` 확인 후 자격 규칙 확정.
4. **카카오 알림톡 수신동의**: 정보성 알림톡의 발송 자격(수신동의 요부) — 기존 발송 경로의 자격 필터 확인.
5. **DM 토큰 인프라**: 신규 `dm_recipient_tokens` 테이블 vs 기존 dm-code/trackDmView/short-url 확장 — DDL 필요 여부 information_schema 확인 후. (DB ALTER면 endpoint catch `column does not exist` 분기 + 마이그레이션 안내.)
6. **DM 발송 staging 위치**: 수신자 확정·링크 삽입 지점(어느 발송 경로가 DM 링크를 본문에 넣는지) 확인 후 토큰 발급 삽입.

이 6개는 구현 1단계에서 grep/SCHEMA/information_schema로 확정한 뒤 코드 착수(0번 원칙).

---

## 10. 구현 순서 (제안 phase)

- **P1**: 공용 추출 엔드포인트(채널 자격 포함) + 순수 자격 판정 테스트. (§9-1,3,4 확정 동반)
- **P2**: 공용 `<TargetExtractModal>`(자연어·인원수·저장) + 이메일 발송화면 1곳 배선 + 1건 실측.
- **P3**: 나머지 발송화면 배선(인앱·카카오·DM 진입). 채널별 개인화 1건 실측.
- **P4**: 모바일DM 수신자별 토큰 링크(테이블/발급/뷰어 lookup/fallback) + 1건 실측. (§9-5,6 확정 동반)
- 각 P 끝에 tsc 0 + 발송 5경로 회귀 + 실측 1건.

---

## 11. 범위 밖 (별도)

- sub-project B: 카페24·고도몰 적용 방법 + 카페24 앱 등록/과금(수수료) 외부 조사 — `cafe24-client.ts`·`godo-adapter.ts` 기존 자산 점검 + 외부 리서치. 별도 스펙으로 작성.
