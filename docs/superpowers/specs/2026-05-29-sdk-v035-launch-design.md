# 한줄로 SDK v0.3.5 출시 + 한국 자사몰 AI CRM Operator 완벽 설계도

> **작성일**: 2026-05-28 (Round 1~7 Claude + GPT 공동 토론 종결 + 다음 세션 진입 직전)
> **본 작업 종결 직후 = `docs/superpowers/archive/` 이동 의무** (GPT Round 7 권장 — 제품 의사결정 기록 보존)
> **다음 세션 진입 직전 명령어** = §17 참조
> **설계도 핵심** — 한줄로 = 한국 자사몰 AI CRM Operator 진입 = Braze/Salesforce 한국 SMB/mid-market 차별화 흐름
> **Round 7 GPT 평가** — "80점 이상 평가 + 6 보완 영역 반영 후 출시 가능 작업 명세서"

---

## 1. 본 설계도 본질 + Harold 명시

### 1.1. Harold 명시 흐름 (2026-05-28)

> "우린 브레이즈나 세일즈포스보다 뛰어나야해. 최소한 브레이즈와 세일즈포스급은 되어야한다는 이야기야. 그래야 판매를 할 수 있을 거 아니야?"
>
> "단순화를 목표로 하지만 우리가 가져야하는 데이터를 모두 가질 수 있어야해. 그게 브레이즈를 진짜로 뛰어넘는 길이라고 생각해."
>
> "자사몰연동에 있어서는 오차가 있어선 안되잖아? 그럼 어떻게 우릴 믿고 마케팅을하지?"
>
> "관련내용을 완벽하게 설계도로 만들고 그걸 다음세션부터 진행하도록하자."

### 1.2. 본 설계도 결정 사항

본 설계도 = Round 1 (Claude 원안 Auto-Capture) → Round 2 (GPT 보수적 70% 반론) → Round 3 (Claude 95% 재정정) → Round 4 (GPT 3계층 분리) → Round 5 (Claude Braze 압도 5 카테고리) → Round 6 (GPT 공동 7 카테고리 + Compliance + Proof-of-Revenue) 토론 = 공동 최종 합의안 일치.

---

## 2. 포지셔닝 (확정)

### 2.1. 외부 포지셔닝 (영업 페이지 안전)

> "한줄로는 한국 자사몰을 위한 빠른 CRM 자동화입니다. Script 한 줄로 15분 안에 첫 고객 행동 수집을 시작하고, 주문/회원/동의 데이터는 postback과 preset으로 신뢰도를 보강하며, AI가 알림톡/SMS/이메일/모바일DM 캠페인을 추천·실행·학습합니다."

### 2.2. 세일즈 강한 문장 (안전 표현)

> "한국 자사몰을 위한 빠른 CRM 자동화 — 15분 안에 첫 고객 행동 수집"

### 2.3. 내부 목표 (외부 노출 X — GPT Round 7 권장)

> "Braze급 CRM 자동화를 한국 자사몰이 15분 만에 시작할 수 있게 만든다."

### 2.4. 내부 비전

> "한국 자사몰 preset + revenue-grade postback + 한국 채널 native + Brand Voice + AI Operator를 하나의 폐쇄 루프로 묶어, Braze/Salesforce가 무겁고 비싼 영역을 self-service로 낮춘다."

**중요** — "Braze급" / "Salesforce 압도" 표현 = **내부 목표 한정** = 영업 페이지 / 외부 마케팅 자료 사용 X (비교 광고 위험 — GPT Round 7 명시).

### 2.4. 절대 사용 X 표현 (외부 약속 위험)

- "사용자 행동 95%/100% 자동 수집" (단일 약속)
- "Braze AI 단순 추천뿐" (경쟁사 과소평가)
- "Salesforce Brand Voice 0건" (경쟁사 과소평가)
- "회사 톤 100% 일치" (정확 약속 위험)
- "AI가 알아서 자율 운영" (Level 5 = 비전 한정)

### 2.5. 1차 승리 전장 

- **고객군** = 한국 자사몰 SMB/mid-market 우선 (Enterprise X)
- **도입** = self-service + preset + 자동 진단 (컨설팅 X)
- **채널** = 알림톡/SMS/LMS/MMS/080/한국 동의 native
- **AI** = 한국 커머스 use case 좁고 깊게
- **가격** = 무료 시작 + 사용량 기반
- **증명** = 매출 회복/재구매/이탈 방지 성과

---

## 3. 압도 7 카테고리 (Round 1~6 공동 최종 합의)

### 카테고리 1 — 통합 속도 3 계층 분리

| 단계 | 목표 시간 | 의미 | 약속 가능성 |
|------|---------|---------|-----------|
| Time to First Event | 5~15분 | script 설치 후 pageview/click/identify 후보 수신 | OK |
| Time to Useful CRM | 30~90분 | 회원/동의/장바구니/주문 후보까지 확인 | 지원 플랫폼 OK |
| Time to Revenue-grade | 반나절~1일 | order postback/webhook 연결 + 중복 방지 + 매출 리포트 신뢰 | 현실적 |

**외부 약속 표현**: "15분 안에 첫 고객 행동 수집, 1일 안에 매출 신뢰도 연결"

### 카테고리 2 — trust_level 4 분리

| trust_level | 발생 방식 | 사용처 |
|-------------|---------|--------|
| `observed` | Auto-Capture DOM/URL/click | 분석/heatmap/후보 |
| `inferred` | DOM 파싱 + AI/preset confidence | 추천 후보 (검증 의무) |
| `declared` | SDK 명시 호출 (`hjl.track()`) + `data-hjl-*` body attribute | 캠페인 트리거 가능 (단, 신뢰도 중간) |
| `verified` | server postback/webhook | 매출/ROAS/성과 — 최상 신뢰도 |

**핵심 원칙** — 마케팅 발송 트리거 = `declared` + `verified` 한정. Auto-Capture (`observed`/`inferred`) = 분석/후보 보조.

**data-hjl-* 신뢰도 강조 (GPT Round 7 보완)**:
- `data-hjl-user-id` / `data-hjl-consent-marketing` 등 = 클라이언트 조작 가능 = `declared` 한정
- 매출 / 발송 / 성과 판단 = 반드시 `verified` (server postback) 의무
- onboarding 첫 단계 = `declared` 빠른 시작 → 운영 = `verified` 보강 흐름

### 카테고리 3 — 한국 채널 native 압도

| 채널 | 본질 |
|------|---------|
| 카카오 알림톡 | 템플릿 검수 + 자동 발송 + 결과 트래킹 (Braze X) |
| 카카오 친구톡 | 마케팅 영역 (Braze X) |
| 카카오 브랜드메시지 | 대량 발송 (Braze X) |
| SMS/LMS/MMS | 한국 통신사 native + EUC-KR 안전망 |
| 이메일 | 회사 SMTP relay (Google Workspace / Naver Works / 자체) |
| 모바일DM | rich/canvas/AI 자동 생성 — 한줄로 독자 채널 |

**Compliance 자동**:
- (광고) prefix 자동 부착
- 080 수신거부 자동 부착
- 야간 발송 차단
- 마케팅 동의 검증
- 카카오 검수 자동 + 반려 자동 안내

### 카테고리 4 — AI Operator (Level 1~2 MVP + Level 5 비전)

| Level | 기능 | 증명 지표 |
|-------|---------|---------|
| **1 (MVP)** | AI 추천 + admin 1-click 승인 | 추천 승인율, 캠페인 생성 시간 단축 |
| **2 (MVP)** | holdout 자동 생성 (10% control) | uplift 측정 가능 캠페인 비율 |
| 3 | 채널/시간/문안 A/B | variant별 성과 학습률 |
| 4 | bandit 제한 적용 | 매출/클릭 uplift, guardrail 작동률 |
| 5 (비전) | guardrail 자율 운영 | human override율, 안전 위반 0건 |

**핵심** — Level 1~2 = MVP (60일 안 출시) + Level 5 = 비전 (외부 약속 X — 분리 의무).

**guardrail 영역** (Level 4~5 의무):
- 발송 빈도 제한
- 야간 발송 차단
- 수신동의 필터
- 민감 세그먼트 제외
- 쿠폰 비용 상한
- 브랜드 금칙어
- admin 승인 이력
- holdout 그룹 유지

### 카테고리 5 — Brand Voice = Message Quality Layer

**입력**:
- 회사 대표 문안 5건 (D225+ 신설 완료 영역)
- 금칙어 / 필수어
- 브랜드 성격 + 상품군 + 고객군
- 채널별 문체 규칙

**출력**:
- channel-specific copy (알림톡/SMS/LMS/이메일/모바일DM 톤 변형)
- compliance-safe copy (광고/수신거부 안전)
- byte-length-safe copy (SMS 90바이트 압축)
- CTA variant
- tone confidence score
- admin edit learning

**외부 표현** — "회사의 기존 문안 톤과 채널별 제약을 반영해, 승인 가능한 마케팅 문안을 빠르게 생성합니다." ("100% 일치" 표현 X)

### 카테고리 6 — Compliance & Trust Layer (GPT 추가)

**판매 핵심 영역** (마케터 두려움 = "법적 사고"):

- 마케팅 수신동의 ledger
- 동의 출처 + 시각 기록
- 철회/수신거부 즉시 반영
- 080 수신거부 자동 삽입
- (광고) prefix 자동
- 야간 발송 제한
- 채널별 발송 가능 여부 자동 계산
- 개인정보 필드 마스킹
- PII 탐지/차단 로그
- 캠페인 승인/수정 감사로그
- 민감 세그먼트 발송 guardrail

**판매 문장** — "마케터가 법을 몰라도, 한줄로가 한국 광고성 메시지 안전장치를 먼저 걸어줍니다."

### 카테고리 7 — Proof-of-Revenue Dashboard (GPT 추가)

**SMB 자사몰 대표 관심 = "이번 달 한줄로가 얼마 벌어줬나"**:

- 캠페인별 매출 회복액
- holdout 대비 uplift
- 메시지 비용
- 순증 매출 추정
- 주문 수
- 재구매율 변화
- 휴면 복귀 고객 수
- 카트 이탈 회복률
- 채널별 CPA/ROAS
- AI 추천 캠페인 승인 후 성과

---

## 4. 5 단계 진입 순서 (Round 6 확정)

### 4.1. 1단계 — 신뢰 가능한 수집 (v0.3.5 — 1주)

**목표**: 고객이 "붙였더니 들어온다"를 **15분 안에 봄**

### 4.2. 2단계 — 매출 신뢰도 (v0.4.0 — 2~3주)

**목표**: 고객이 "매출과 연결된다"를 봄

### 4.3. 3단계 — 한국 채널 실행 (v0.4.5 — 3~4주)

**목표**: 고객이 "실제로 캠페인을 보낸다"를 봄

### 4.4. 4단계 — AI Operator (v0.5.0 — 5~7주)

**목표**: 고객이 "내가 고민하지 않아도 제안이 온다"를 봄

### 4.5. 5단계 — Brand Voice/모바일DM/고도화 (v0.5.5+ — 7~10주)

**목표**: 고객이 "우리 회사답게 자동으로 운영된다"를 느낌

---

## 5. v0.3.5 범위 (1주 — 다음 세션 진입)

### 5.1. 필수 10

1. **CDN script build** — `https://cdn.hanjul.ai/sdk.js` 단일 IIFE 빌드 (Webpack/Rollup)
2. **data attribute identify** — body `data-hjl-user-id="..."` 자동 감지
3. **anonymous_id + session_id** — localStorage + cookie 자동 발급
4. **pageview 자동 수집** — `history.pushState` patching + popstate + hashchange + 초기 load
5. **click 자동 수집 (보수)** — document-level event delegation (capture phase)
   - **기본 수집값** = `tag` + `role` + `data-hjl-event` + `href sanitized` + `position` 한정
   - **innerText 전체 수집 = 기본 OFF** (개인정보/주문번호 섞임 위험 — GPT Round 7 보안 의무)
   - 명시 opt-in (`data-hjl-capture="text"`) 한정 = innerText 허용
6. **consent explicit attribute** — `data-hjl-consent-marketing="true"` 4 종 (analytics/marketing/ad/kakao)
7. **PII masking** — 이메일/휴대폰/카드번호/주민번호 자동 마스킹 + URL token sanitization
8. **heartbeat** — `sdk_loaded` / `config_loaded` / `domain_matched` / `first_pageview_sent` / `first_event_accepted` 5 단계
9. **백오피스 script 발급** — admin CDP 설정 → 도메인 입력 → API key + script 자동 발급 + CORS 자동 등록
10. **first event 검증 화면** — 5분 안 첫 이벤트 수신 자동 표시 + 5/10/30분 단계별 진단

### 5.2. 제외 7 (v0.3.5 외 영역)

- heatmap / session replay
- full DOM capture
- click innerText 전체 수집 (기본 OFF — opt-in 한정)
- AI segment 자동 분류
- 자동 발송
- 복잡한 journey builder
- native app SDK
- full platform preset (v0.4.5 진입)

### 5.3. 성공 기준 (v0.3.5)

> "고객이 script를 붙이고 15분 안에 데이터가 들어온다를 확인한다."

- POPPON Next.js 15 App Router 안 SDK 임베드 5분 안 완료
- POPPON 회원 1~2명 = identify + pageview + click 수신 확인
- PII leakage 0건
- 백오피스 안 첫 이벤트 자동 표시
- heartbeat 5 단계 작동

### 5.4. v0.3.5 작업 분량 (GPT Round 7 보완 — 7~10 영업일 분할)

기존 5 영업일 추산 = 과소 추산 사고. **v0.3.5-a + v0.3.5-b 분할** (GPT Round 7 권장):

#### v0.3.5-a (3~4 영업일) — SDK + ingestion + heartbeat

| 일자 | 작업 |
|------|------|
| D1 | CDN script build 셋업 (Webpack/Rollup IIFE) + 기존 npm 패키지 호환 검증 |
| D2 | Auto-Capture 기본 (pageview + click 보수 + identify + consent) + PII masking |
| D3 | heartbeat 5 단계 + backend ingestion endpoint 강화 |
| D4 | tsc + 자가 grep + 1차 검증 |

#### v0.3.5-b (3~4 영업일) — 백오피스 발급 + 진단 화면

| 일자 | 작업 |
|------|------|
| D5 | 백오피스 1-click 발급 UI (도메인 입력 + API key 발급 + CORS 자동 등록) |
| D6 | first event 검증 화면 + 5/10/30분 단계별 자동 진단 |
| D7 | POPPON 실제 검증 + 사고 정정 |
| D8 | tsc + 자가 grep + 배포 + 최종 검증 |

---

## 6. v0.4.0 범위 (2~3주 — Auto-Capture core + trust_level)

### 6.1. 필수

1. **event taxonomy** — Core 10 (page_viewed / product_viewed / category_viewed / search_submitted / cart_added / checkout_started / order_completed / signup_completed / login_completed / marketing_consent_updated)
2. **trust_level 4** — observed/inferred/declared/verified 적용
3. **confidence score** — DOM 파싱 결과 0~1 점수 부여
4. **product/order candidate parser** — JSON-LD + Open Graph + Schema.org 자동 파싱
5. **postback API spec** — POST `/api/cdp/order` server-to-server (orderId dedup)
6. **dedup key** — event_id + session + orderId 중복 차단
7. **data quality dashboard MVP** — 수신 이벤트 수 + 식별률 + 익명→회원 merge율 + PII masking count
8. **install diagnostics** — heartbeat 단계 + 자동 진단 안내 ("SDK 로드됐지만 서버 수신 X" 등)
9. **SPA support ** — Next.js / Vue / React Router / Nuxt / Svelte 호환 검증
10. **MutationObserver 제한 사용** — 전역 X = route 변경 후 짧은 window 한정

### 6.2. 성공 기준 (v0.4.0)

> "고객이 자동 수집과 postback의 차이를 이해하고, 매출 신뢰도를 높이기 위해 postback을 연결한다."

---

## 7. v0.4.5 범위 (3~4주 — 한국 자사몰 moat 진입)

### 7.1. 필수

1. **카페24 adapter** — `@hanjullo/platform-cafe24` (alpha)
2. **메이크샵 adapter** — `@hanjullo/platform-makeshop` (alpha)
3. **고도몰 adapter** — `@hanjullo/platform-godomall` (alpha)
4. **아임웹 adapter** — `@hanjullo/platform-imweb` (alpha)
5. **Commerce Korea Extension events** — Core 10 + 3 (kakao_channel_added / coupon_downloaded / restock_alert_requested)
6. **fixture test suite** — 플랫폼별 product/cart/order page fixture HTML + selector preset test
7. **synthetic traffic generator** — sandbox tenant 분리 + persona/scenario template + 실제 발송 차단
8. **WebView bridge 설계** — Expo React Native + iOS/Android WebView 호환
9. **postback recipe** — 플랫폼별 postback 등록 가이드

### 7.2. 성공 기준 (v0.4.5)

> "카페24/메이크샵 샘플몰에서 first event 15분, useful CRM 1시간, revenue-ready 1일 안에 도달한다."

---

## 8. v0.5.0 범위 (5~7주 — AI Operator Level 1~2 + Compliance Layer)

### 8.1. 필수

1. **AI Operator Level 1** — 매일 아침 추천 + 1-click 승인 + 발송
2. **AI Operator Level 2** — holdout 자동 (10% control) + uplift 측정
3. **Compliance & Trust Layer** — 동의 ledger + (광고) + 080 + 야간 제한 + PII 탐지
4. **Brand Voice 통합** — D225+ 영역 + 채널별 톤 변형
5. **모바일DM rich/canvas 진입** — AI 자동 생성 + 행동 기반 개인화
6. **데이터 품질 대시보드 강화** — heartbeat 단계 + 자동 진단 + 매출 신뢰도 점수
7. **앱스토어 등록 준비** — 카페24/메이크샵 (심사 + 권한 + 설치 해제 + 버전 관리)

### 8.2. 성공 기준 (v0.5.0)

> "고객이 한줄로 admin 안 매일 아침 AI 추천 → 1-click 승인 → 즉시 발송 흐름 활용 + holdout uplift 확인 가능."

---

## 9. v0.5.5~v0.7.0 범위 (개요)

### 9.1. v0.5.5 (7~8주) — WebView bridge + React Native beta

- WebView bridge (userId 전달 + 이벤트 bridge + push token CDP merge)
- React Native lightweight SDK beta
- AI Operator Level 3 (채널/시간/문안 A/B)

### 9.2. v0.6.0 (8~10주) — Native SDK 

- React Native SDK 정식
- iOS Native SDK skeleton
- Android Native SDK skeleton

### 9.3. v0.7.0 (10~12주) — Mobile + AI Operator Level 4

- push token + app lifecycle + deep link attribution
- AI Operator Level 4 (bandit 제한)

---

## 10. 30일 / 60일 목표

### 10.1. 30일 (D-Day = 2026-05-29)

- v0.3.5 출시 (D+7)
- POPPON first event 검증 (D+10)
- v0.4.0 trust_level/postback 설계 완료 (D+20)
- 카페24/메이크샵 샘플 fixture 수집 시작 (D+25)
- 데이터 품질 대시보드 MVP 설계 (D+30)

### 10.2. 60일

- v0.4.0 출시 (D+30)
- revenue-ready postback beta
- Cafe24/MakeShop adapter alpha (D+50)
- AI 추천 Level 1 MVP
- 첫 실제 파일럿 3곳 확보:
  - 패션/잡화 1건
  - 식품/생활용품 1건
  - B2B 또는 고관여 상품 1건

---

## 11. 위험 7 + 대응 (확정)

| 위험 | 대응 |
|------|------|
| 경쟁사 과소평가 (Braze AI 진행 중) | 외부 문서 안 정확 반영 + 한국 SMB 집중 |
| 95%/100% 과장 약속 | first event / useful CRM / revenue-grade 3 계층 분리 |
| DOM 파싱 불신 | trust_level + confidence + postback 의무 |
| 개인정보 사고 | PII masking + consent ledger + 평문 미수집 |
| 제품 범위 폭발 | v0.3.5 first value 집중 + 단계 분할 |
| AI 성과 미증명 | holdout + uplift dashboard |
| 한국 플랫폼 파편화 | adapter fixture test suite + synthetic test |

---

## 12. v0.3.5 착수 전 필수 결정 10 (Harold 확정 의무)

1. **기본 수집 이벤트 범위** — pageview + click + identify + consent + heartbeat 한정?
2. **body data attribute 이름 규칙** — `data-hjl-*` 확정?
3. **평문 email/phone 금지 여부** — 해시 의무?
4. **consent mode 모델** — analytics / marketing / ad / kakao 4 분리?
5. **event schema version** — `v1` 명시?
6. **anonymous_id ↔ user_id merge 규칙** — 가입 시점 자동 merge + 이전 익명 활동 보존?
7. **PII masking 정책** — 이메일/휴대폰/카드/주민/계좌/세션토큰 자동 마스킹?
8. **event endpoint rate limit** — 무료 10K/일 + 유료 100K/일?
9. **script CDN pinned version 전략** (GPT Round 7 권장):
   - **pinned (기본)** = `https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js`
   - **latest alias (옵션)** = `https://cdn.hanjul.ai/sdk/latest/hanjul.min.js`
   - 기존 `?v={version}` 형식 = 폐기 ("갑자기 SDK 바뀜" 사고 차단 — 운영 안정성)
   - 고객사 운영 기본 = pinned version 권장
10. **POPPON 검증 성공 기준** — 15분 안 first event + PII leakage 0 + 핵심 퍼널 확인?

---

## 13. 다음 세션 진입 직전 작업 흐름

### 13.1. 다음 세션 시작 시점 점검

1. 본 설계도 (`docs/superpowers/specs/2026-05-29-sdk-v035-launch-design.md`) 정독
2. §12 필수 결정 10 = Harold 직접 확정
3. v0.3.5-a 진입 (§5.4 영역) — 3~4 영업일 작업

### 13.2. 다음 세션 진입 명령어 (Harold 복붙)

```
docs/superpowers/specs/2026-05-29-sdk-v035-launch-design.md 정독 → v0.3.5-a 출시 진입 (§5 필수 10 + §12 필수 결정 10 Harold 확정 후 진입 + 본 작업 종결 직후 docs/superpowers/archive/ 이동 의무)
```

### 13.3. 작업 흐름 추천 (Superpowers skill 활용)

- `superpowers:brainstorming` — Harold + Claude 필수 결정 10 확정
- `superpowers:writing-plans` — v0.3.5 5 영업일 단계별 plan 작성
- `superpowers:test-driven-development` — Auto-Capture 검증 (RED-GREEN-REFACTOR)
- `superpowers:verification-before-completion` — 매 단계 종결 직전 검증
- `superpowers:subagent-driven-development` — 다중 task 분할
- `/codex:adversarial-review` — 본 작업 종결 직전 의무 (큰 영구 룰)

---

## 14. 본 작업 종결 직후 파일 정리 (GPT Round 7 정정 — archive 보관)

본 v0.3.5 출시 + POPPON 검증 + 메모리 신설 (`project_d226_sdk_v035_completed.md`) 종결 직후 = 본 파일 **`docs/superpowers/archive/` 이동** (제품 의사결정 기록 보존):

```bash
mkdir -p docs/superpowers/archive
mv docs/superpowers/specs/2026-05-29-sdk-v035-launch-design.md docs/superpowers/archive/
```

**왜 보관**:
- 본 문서 = SDK v0.3.5 출시 의사결정 영구 기록
- "왜 이렇게 만들었는지" 추적 의무 (향후 v0.4.0 / v0.5.0 진입 시 참조)
- GPT Round 7 명시 — "삭제 X = 제품 의사결정 기록 보존"

---

## 15. 참고 자료 (다음 세션 진입 직전 정독)

### 15.1. 본 토론 흐름 (Round 1~6)

- Round 1 — `docs/discussions/2026-05-28-sdk-auto-capture-gpt-review.md` (Claude 원안)
- Round 2 — `docs/discussions/2026-05-28-sdk-auto-capture-gpt-response.md` (GPT 12 권장)
- Round 3 — `docs/discussions/2026-05-28-sdk-auto-capture-round3-claude-rebuttal.md` (Claude 정정)
- Round 4 — `docs/discussions/2026-05-28-sdk-auto-capture-round4-gpt-response.md` (GPT 재답변)
- Round 5 — `docs/discussions/2026-05-28-sdk-auto-capture-round5-braze-domination-collab.md` (Claude 압도 5)
- Round 6 — `docs/discussions/2026-05-28-sdk-auto-capture-round6-gpt-collab-strategy.md` (GPT 공동 7 + Compliance + Proof-of-Revenue)

### 15.2. POPPON 회신서

- `C:\Users\ceo\Downloads\POPPON_한줄로_SDK통합_질의회신.pdf` (Harold 보유)

### 15.3. 현재 한줄로 SDK 코드

- `packages/sdk-js/src/` (v0.3.0 — npm 패키지 존재)
- `packages/sdk-js/package.json` (ESM + CJS + types 빌드)
- `packages/backend/src/routes/cdp.ts` (8 CDP endpoint)

### 15.4. 한줄로 차별점 비전

- `docs/한줄로_BEYOND_BRAZE_비전.md` (체어맨 + CTO 전용)

---

## 16. 본 설계도 본질 강조 (Harold 의문 답변)

### 16.1. "오차가 있어선 안되잖아?" 답변

본 설계도 = **trust_level 4 분리** = 오차 차단:
- 마케팅 발송 트리거 = `declared` (명시 호출 100%) + `verified` (postback 100%) 한정
- Auto-Capture (`observed`/`inferred`) = 분석/heatmap 보조 영역 한정 (마케팅 발송 X)

본 흐름 = **Braze 동급 정확도 + Self-service 5분 통합** 동시 달성 .

### 16.2. "어떻게 우릴 믿고 마케팅을 하지?" 답변

본 설계도 = **Proof-of-Revenue Dashboard** + **Compliance & Trust Layer** :
- 매출 회복액 + uplift + ROAS 표시 (한줄로가 매출 가져옴 증명)
- 동의 ledger + (광고) + 080 + 야간 제한 (법적 안전망 자동)
- 본 2 영역 = SMB 자사몰 대표 신뢰 보장

### 16.3. "Braze/Salesforce 압도?" 답변

본 설계도 = **모든 기능 복제 X = 한국 자사몰 SMB/mid-market 집중**:
- 통합 속도 50~100배 (5~10 영업일 → 15분)
- 한국 채널 native 100% (영문 한정 → 알림톡/카카오)
- AI Operator Level 1~2 + Level 5 비전 (Braze AI Operator 진행 중 인정)
- Brand Voice = Message Quality Layer (한국 LMS/SMS 제약 반영)
- Compliance & Trust Layer (한국 정보통신망법 자동)
- Proof-of-Revenue Dashboard (매출 증명)
- 한국 자사몰 preset (카페24/메이크샵/고도몰/아임웹)

본 7 카테고리 = 한국 SMB 자사몰 = Braze/Salesforce 압도.

---

## 17. 다음 세션 진입 명령어 (Harold 복붙 )

```
docs/superpowers/specs/2026-05-29-sdk-v035-launch-design.md 정독 + v0.3.5 출시 진입.
1. §12 필수 결정 10 Harold 확정
2. §5 v0.3.5 필수 10 진입 (5 영업일 작업)
3. 본 작업 종결 직후 본 파일 영구 제거 의무
```

---

## 18. 메시지 (Claude + GPT 공동 최종 합의)

> "한줄로는 Braze/Salesforce를 모든 엔터프라이즈 기능에서 복제해 이기는 것이 아니라, 한국 자사몰이 가장 고통스러워하는 통합·동의·한국 채널·캠페인 운영을 self-service AI Operator로 낮춰 이긴다. Script 한 줄로 시작하고, postback으로 매출 신뢰도를 보장하며, Brand Voice와 한국 채널 guardrail을 통해 실제 매출 캠페인을 추천·실행·학습하는 SaaS가 되어야 한다."

본 설계도 = 위 합의 흐름 = Harold 결정 + 다음 세션 진입 + v0.3.5 출시 + 30일/60일 목표 달성 의무.

---

*— 본 설계도 종결. Harold 결정 직후 다음 세션 진입 + v0.3.5 출시 + 한국 자사몰 AI CRM 운영자 진입.*
