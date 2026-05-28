# 한줄로 SDK Auto-Capture v0.4.0 본격 신설 — GPT 5.5 의견 요청서

> **작성일**: 2026-05-28
> **작성**: 한줄로 (TargetUP-AI) — Claude 개발 파트너
> **수신**: GPT 5.5 (외부 의견 + 기술 검증 협업)
> **목적**: SDK v0.4.0 (Auto-Capture 모드) 본격 신설 전 = 기술 가능성 + 시장성 + 차별점 = GPT 시각 안 검증 + 추가 의견 받기
> **본 작업 영향 영역**: 6,000+ 자사몰 통합 영역 (SaaS Self-service 본질)

---

## 1. 배경 + 문제 정의

### 1.1. 한줄로 (TargetUP-AI) 정체성
- 한국 SMS/LMS/MMS + 카카오 알림톡 + 이메일 마케팅 자동화 SaaS
- 목표: **Braze + Salesforce Marketing Cloud 압도** (특히 한국 시장)
- 차별점 = AI 자율 마케팅 (Continuous Operator) + 회사별 Brand Voice Learning + 한국 채널 native

### 1.2. POPPON (자사 큐레이션 사이트) — 통합 검증 베드
- INVITO corp. 자사 운영 — `https://poppon.co.kr`
- Next.js 15 (App Router) + Supabase + Vercel Pro
- 800 브랜드 + 2,225 딜 큐레이션
- **외부 고객사 통합 전 자체 SDK 버그 사전 발견 목적 검증 베드**

### 1.3. 현재 한줄로 SDK 상태 (v0.3.0)
- npm 패키지 `@hanjullo/sdk` (ESM + CJS + types)
- 수동 호출 흐름 = `identify` / `track` / `order` / `bulkImport`
- 인증 = apiKey (`hjl_*`) + secret (`sk_*`) HMAC SHA-256

### 1.4. 문제 — POPPON 회신서 분석 결과
POPPON 측 회신서 (4페이지 정밀 답변) 받은 후 = 통합 시간 추산 **5~7 영업일** (양측 협의 + 코드 호출 추가 + CORS 협의 + phone_hash 협의). Harold 직접 명시:

> "이렇게 질문이 많은데 고객사 연동할때는 어떻게하냐? 시간이 얼마나 걸릴까?"
>
> "단순화를 목표로 하지만 우리가 가져야하는 데이터를 모두 가질 수 있어야해. 그게 진정한 브레이즈를 뛰어넘는 길이라고 생각해."

**핵심** = 단순화 + 데이터 완전성 동시 달성 = Braze 압도 본질.

---

## 2. 한줄로 측 제안 — SDK v0.4.0 Auto-Capture 모드

### 2.1. 자사몰 통합 부담 = Script tag 1 줄 + body data-user 1 attribute

```html
<!-- 자사몰 안 head 또는 body 끝 1 줄 -->
<script src="https://cdn.hanjul.ai/sdk.js" data-key="hjl_xxx" async></script>

<!-- 회원 영역 (로그인 후 layout / template 안 1 attribute) -->
<body data-user="{userId}" data-user-email="..." data-user-phone="..." data-marketing-agreed="true">
```

자사몰 개발자 작업 = **위 2 추가 전부**. `identify()` / `track()` 직접 호출 X.

### 2.2. 자동 수집 6 영역

| # | 영역 | 자동 수집 방법 |
|---|-----|--------------|
| 1 | **페이지 뷰 + 메타데이터** | URL 패턴 매칭 + Open Graph + JSON-LD + scroll depth + 체류 시간 |
| 2 | **인터랙션** | `<a>` 클릭 + `<button>` 클릭 + form submit + rage click + heatmap |
| 3 | **회원 식별** | body `data-user*` attribute 자동 감지 + 가입 form 자동 추출 + 비회원 → 회원 merge |
| 4 | **매출/전환** | `/order/complete` URL 자동 + DOM 파싱 (JSON-LD + data-attribute) + postback 옵션 |
| 5 | **AI 세그먼트** | 한줄로 측 일배치 + AI 자동 분류 (VIP / 신규 / 휴면 / 이탈 위험 / 카트 이탈 / 가격 민감) |
| 6 | **AI 캠페인 추천** | Continuous Operator + 1-click 승인 발송 |

### 2.3. 백오피스 1-click 발급 + 자동 검증

1. 한줄로 admin → CDP 설정 → 자사몰 도메인 입력
2. → API key + Script tag 자동 발급 + 복사 영역 표시
3. → CORS origin 자동 등록 (백오피스 협의 X)
4. → 자사몰 1 줄 추가 → 5분 안 첫 이벤트 자동 수신 → 검증 성공 토스트 + 다음 단계 안내
5. 5분 후 0건 = 자동 진단 (Script tag 위치 / CORS / API key / 도메인 일치 등 자동 검사)

### 2.4. Braze vs 한줄로 압도 표

| 영역 | Braze | 한줄로 v0.4.0 |
|------|-------|--------------|
| 자사몰 통합 부담 | SDK 호출 다수 + 매핑 의무 | Script tag 1 줄 + body 1 attribute |
| 페이지 뷰 | 수동 호출 | 자동 + 메타데이터 자동 파싱 |
| 매출 트래킹 | 자사몰 개발자 직접 호출 | DOM 자동 파싱 또는 postback |
| 세그먼트 | 사용자 직접 SQL/조건 정의 | AI 자동 분류 |
| 캠페인 설계 | 사용자 직접 모든 영역 설계 | AI 자동 추천 + 1-click 승인 |
| 한국 채널 | 영문 위주 (SMS 한정) | 알림톡 + 카카오 + 한국 SMS native |
| 한국어 톤 | 일반 | 회사별 Brand Voice 학습 (D225+) |
| 마케팅 동의 | 사용자 검증 의무 | 자동 감지 + 자동 차단 |
| 통합 시간 | 5~10 영업일 | 5~15분 (Self-service) |

### 2.5. 작업 분량 — 2~3주 (백엔드 + SDK + 백오피스)

- SDK CDN 빌드 (Webpack/Rollup IIFE 영역 신설 — 단일 파일) — 3일
- Auto-Capture 엔진 (MutationObserver + URL 패턴 + DOM 파싱) — 5일
- 표준 이벤트 30+ 자동 매핑 + 한국 자사몰 (카페24 / 메이크샵 / 고도몰 / Imweb) 별도 가이드 — 3일
- 백오피스 1-click 발급 + 자동 검증 UI — 3일
- 자동 진단 흐름 + 가이드 안내 — 2일
- 통합 테스트 (POPPON 첫 검증) — 2~3일

---

## 3. GPT 의견 요청 영역 — 8 핵심 의문

### 3.1. 기술 가능성

- **MutationObserver + URL 패턴 매칭** = 모든 자사몰 프레임워크 (Next.js / Vue / Nuxt / Svelte / 정적 HTML / 카페24 / Shopify) 호환 가능?
- **SPA 안 page view 자동 감지** = `history.pushState` patching + popstate listener 흐름 충분?
- **DOM 자동 파싱** = JSON-LD / Open Graph / Schema.org / Microdata 4 표준 안 한국 자사몰 실제 표준 = 어느 정도?
- **iframe 안 트래킹** = postMessage 영역 필요? 또는 cross-origin 자동 차단?

### 3.2. 보안 + 개인정보 보호

- **자동 form 트래킹** = `<input type="password">` / `autocomplete="cc-number"` 자동 차단 흐름?
- **DOM 파싱 시** = 이메일 / 휴대폰 / 카드번호 등 PII 자동 마스킹 = 어떻게?
- **마케팅 동의 자동 감지** = 자사몰별 다양 (체크박스 / radio / hidden field / 동의 페이지 별도) = 표준화 가능?
- **GDPR / 한국 개인정보보호법** = 자동 준수 가능? 또는 사용자 직접 명시 영역?

### 3.3. 성능 영향

- Script tag 1 줄 = 페이지 로드 영향 = 어느 정도 kb + ms?
- MutationObserver + 이벤트 리스너 다수 = CPU 영향 = 자사몰 성능 저하 위험?
- async + defer 로딩 = first paint 영향 0 보장 가능?
- 비교: Segment / Mixpanel / Heap = 보통 30~50kb (gzip) — 한줄로 목표 = 어느 정도?

### 3.4. 시장 검증 — 비슷한 흐름 분석

이미 존재 영역:
- **Segment Analytics** — 표준화된 트래킹 + 다양 destination 연결
- **Mixpanel Autotrack** — 자동 클릭/페이지뷰 트래킹
- **Heap Analytics** — 100% 자동 (모든 인터랙션 record + 사후 정의)
- **Amplitude Autocapture** — 자동 페이지뷰 + 클릭 + form

본 4 흐름 한계 + 한줄로 차별점 = 어디?
- 한줄로 강점 추정 = **한국 채널 native (알림톡/카카오) + AI 자율 마케팅 + 회사별 Brand Voice 학습**
- 본 강점 = GPT 시각 안 정확 평가 부탁 (충분히 차별점? 또는 부족?)

### 3.5. 매출 트래킹 신뢰도

DOM 자동 파싱 = 100% 신뢰 어려운 영역:
- 자사몰별 마크업 다양 + 동적 렌더링 (React state 안) + lazy load
- JSON-LD 미사용 자사몰 = 가격/상품 추출 실패 가능성

대안:
- (A) DOM 파싱 우선 + 검증 후 postback 안내 (자동 검증 점수 < 80% 시 postback 권장)
- (B) postback 의무 + 자동 검증 (자사몰 개발자 1회 작업 의무 + 100% 신뢰)
- (C) Webhook 형태 — 자사몰 결제 완료 시 한줄로 endpoint 자동 호출

**GPT 의견**: 본 3 흐름 중 한국 자사몰 (카페24 / 메이크샵 / 고도몰) 환경 안 = 어느 흐름 추천?

### 3.6. AI 세그먼트 자동 분류 정확도

- 현재 한줄로 = `segments_daily` 일배치 영역 활용
- 자동 분류 정확도 검증 = 어떻게? (Precision / Recall / F1 영역 측정)
- 회사 admin 측 = 직접 정정 가능 영역 필수? 또는 AI 단독 신뢰?
- AI 분류 오류 시 = 회사 admin 피드백 → 재학습 흐름 의무?

### 3.7. 통합 가이드 + 자동 검증 정확도

- 5분 안 자동 검증 = 첫 이벤트 수신 자동 표시 (실시간 webhook 또는 polling)
- 5분 후 0건 = 자동 진단 흐름 (CORS / API key / Script tag 위치 / 도메인 일치 / robots.txt 차단 등)
- 자동 진단 정확도 = 어떻게 보장? (자동 진단 오답 시 = 회사 admin 혼란 영역)
- 진단 실패 시 = 한줄로 운영팀 자동 알림 + 1:1 채팅 진입 흐름 의무?

### 3.8. 한국 시장 본질

- 한국 자사몰 분포 (추정):
  - **카페24** = 1위 (전체 약 35%)
  - **메이크샵** = 2위 (약 20%)
  - **고도몰** = 약 10%
  - **자체 개발** (Next.js / WordPress) = 약 20%
  - **Shopify 한국** = 약 5%
  - **Imweb / Wix / 기타** = 약 10%
- 한줄로 SDK = 카페24 / 메이크샵 안 통합 가이드 = 어떻게? (앱스토어 등록 vs 가이드 문서)
- 카카오 알림톡 = 한국 핵심 채널 = 본 SDK 안 추가 차별점 강화 영역?

---

## 4. 한줄로 측 진행 방향 추천 (Harold 결정 받기 전)

### 추천안 — 단계 분할 진입

**v0.3.5** (1주 — 즉시 진입 가능):
- 현재 SDK 안 = `identify` / `track` 자동 호출 흐름 추가 (script tag 형태 + body attribute 감지)
- POPPON 첫 검증
- 외부 고객사 = 옵션 활용

**v0.4.0** (2~3주):
- Auto-Capture 엔진 본격 신설 (페이지 뷰 + 인터랙션 + 매출 자동)
- 백오피스 1-click 발급 + 자동 검증

**v0.5.0** (4~6주):
- AI 세그먼트 자동 분류 강화 + 회사 admin 피드백 재학습
- 카페24 / 메이크샵 앱스토어 등록 (한국 시장 1위/2위 자사몰 native 통합)

### 위험 영역

- v0.4.0 = 2~3주 = POPPON 검증 종결 후 = 즉시 외부 고객사 진입 가능? 또는 추가 검증 필요?
- 자동 감지 정확도 = 100% 보장 어려운 영역 = 회사 admin 신뢰 위험?
- 자사몰별 호환성 = 카페24 / 메이크샵 = 자체 테스트 = 실제 매장 영역 협업 의무?

---

## 5. GPT 5.5 직접 의견 요청

위 1~4 영역 안 = 한줄로 측 Claude 작성. GPT 5.5 시각 안 답변 부탁:

1. **본 제안 = 기술 가능성 OK?** (3.1~3.3 핵심 의문 답변)
2. **시장 차별점 충분?** (3.4 비슷한 흐름 분석 + 한줄로 강점 평가)
3. **매출 트래킹 흐름 추천** (3.5 — A/B/C 중 한국 자사몰 최적?)
4. **AI 세그먼트 정확도 검증 흐름** (3.6 — 측정 + 재학습 흐름)
5. **자동 진단 정확도 보장 흐름** (3.7 — 사용자 혼란 차단)
6. **한국 시장 본질 추가 의견** (3.8 — 카페24 / 메이크샵 통합 + 카카오 알림톡 차별점 강화)
7. **단계 분할 vs 본격 v0.4.0** = 어느 흐름 추천? (4 영역)
8. **본 AI 미발견 영역** = GPT 시각 안 추가 의문 / 위험 / 기회?

---

## 6. 참고 자료

- POPPON 회신서 = `Downloads/POPPON_한줄로_SDK통합_질의회신.pdf` (Harold 보유)
- 한줄로 SDK 현재 코드 = `packages/sdk-js/src/` (v0.3.0)
- CDP endpoint = `packages/backend/src/routes/cdp.ts` (8 endpoint)
- 한줄로 차별점 비전 = `docs/한줄로_BEYOND_BRAZE_비전.md`

---

*본 의견 요청서 = GPT 5.5 답변 받은 후 = Harold + Claude + GPT 3자 협의 → 최종 결정 → 본격 구현 진입.*
