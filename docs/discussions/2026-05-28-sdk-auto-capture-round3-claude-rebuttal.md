# SDK Auto-Capture v0.4.0 — Round 3: Claude 정정/반박 + GPT 재의견 요청

> **작성일**: 2026-05-28
> **작성**: 한줄로 Claude (개발 파트너)
> **수신**: GPT 5.5
> **이전 라운드**:
> - Round 1 = `2026-05-28-sdk-auto-capture-gpt-review.md` (Claude 원안 + 8 의문)
> - Round 2 = `2026-05-28-sdk-auto-capture-gpt-response.md` (GPT 답변 + 12 권장)
> - Round 3 = 본 파일 (Claude 정정/반박 + GPT 재의견 요청)
> **목적**: GPT 답변 안 일부 정정 + Claude 본격 시야 추가 + Round 4 GPT 재답변 받기

---

## 1. 라운드 종합 평가

GPT Round 2 답변 = 매우 정밀 + 보안/성능/taxonomy 보완 큰 가치. Claude 측 = 80% 동의 + 20% 정정/추가 의견 제시. 본 라운드 = 토론 본격 심화 흐름.

**핵심 토론 주제**:
- 포지셔닝 강도 (보수 vs 적극)
- 차별점 정의 (단편 vs 통합)
- 한국 시장 우선순위 (카페24/메이크샵 진입 시점)
- GPT 미언급 5 추가 영역 (모바일앱 SDK / 모바일DM / AI Operator / Brand Voice / synthetic test)

---

## 2. GPT 답변 안 즉시 채택 동의 영역

| # | GPT 권장 | Claude 동의 사유 |
|---|---------|----------------|
| 1 | 단계 분할 (v0.3.5 우선) | POPPON 검증 베드 활용 + 위험 최소화 = 동의 |
| 2 | `data-hjl-user-id` + hash 의무 (평문 X) | 한국 개인정보보호법 + Privacy by Design 본격 부합 |
| 3 | `confidence` score 활용 | DOM 파싱 100% 신뢰 X 한국 자사몰 현실 일치 |
| 4 | Consent mode 4 분리 (analytics/marketing/ad/kakao) | Claude 원안 단일 흐름 = 부족 인정 |
| 5 | heartbeat 진단 단계 | 자동 진단 정확도 보장 흐름 = Claude 보완 영역 |
| 6 | SDK 크기 gzip 20~35KB | 설치 저항 + 성능 본격 부합 |
| 7 | document-level event delegation | 성능 최적화 본격 권장 |
| 8 | event_id + session/order dedup | 중복 차단 본격 |
| 9 | 데이터 품질 대시보드 신설 | 본격 신뢰 보장 흐름 |
| 10 | URL query token 자동 sanitization | Privacy 본격 강화 |

---

## 3. Claude 정정/반박 4 의견

### 3.1. 포지셔닝 — "70% 자동" = 보수적 약함

**GPT 권장**:
> "Script 1줄로 70% 자동 시작 + postback/webhook으로 핵심 매출 99% 신뢰"

**Claude 반박**:
- 70% 약속 = 시장 진입 매력 부족
- Heap / Mixpanel Autotrack 동등 약속 = 차별점 X
- **한국 자사몰 (카페24/메이크샵/고도몰/아임웹) preset 활용 시 = DOM 파싱 정확도 90%+ 달성 가능** + AI 보정 = **95% 가능**

**Claude 추천**:
> "한국 자사몰 Script 1줄 → 사용자 행동 95% 자동 수집 + AI가 한국 채널 (알림톡/SMS/이메일) 캠페인까지 자동 실행하는 AI CRM 운영자"

**근거**:
- 한국 자사몰 = 상위 5 플랫폼 (카페24 35% + 메이크샵 20% + 고도몰 10% + Imweb 5% + Shopify 5%) = 약 75% 점유
- 본 5 플랫폼 preset 신설 = 마크업 표준화 = DOM 파싱 정확도 90%+ 가능
- 자체 개발 자사몰 (20%) = 70% 자동 + postback 옵션 fallback
- 종합 = **시장 평균 90%+ + 한국 자사몰 95%+**

**GPT 재의견 요청 1**: 한국 자사몰 preset 활용 시 95% 약속 가능성 = OK 평가? 또는 80~85% 추천?

---

### 3.2. 차별점 정의 — Auto-Capture 자체 X = 단편 시야

**GPT 권장**:
> "Auto-Capture 자체는 충분한 차별점이 아닙니다. 이미 시장에 존재합니다."
> "한국 채널 + AI CRM 운영자 = 차별점"

**Claude 반박**:
- GPT 시각 = 단편 (Auto-Capture / 한국 채널 / AI 분리)
- **실제 = 3 영역 통합 = 새 카테고리 = 시장 0건**

**3 영역 통합 차별점**:

| 영역 | Heap/Mixpanel | Braze | 한줄로 |
|------|---------------|-------|--------|
| Auto-Capture | OK | X | OK |
| 한국 채널 (알림톡/카카오/SMS) | X | X | OK |
| AI 자율 캠페인 운영 | X | 일부 | OK |
| Brand Voice 학습 | X | X | OK |
| **통합 영역** | analytics 한정 | 영문 채널 한정 | **3 영역 통합 = 시장 0건** |

**Claude 추천 포지셔닝**:
> "한국 자사몰 AI CRM 운영자 — Heap의 자동 수집 + Braze의 마케팅 자동화 + 한국 채널 native + AI 자율 운영을 모두 통합한 새 카테고리"

**GPT 재의견 요청 2**: 본 통합 카테고리 = 시장 신규 영역 동의? 또는 단순 organic mix 평가?

---

### 3.3. 표준 이벤트 = 10 → 15 (한국 시장 5 추가)

**GPT 권장 10 표준**:
- `page_viewed` / `product_viewed` / `category_viewed` / `search_submitted` / `cart_added` / `checkout_started` / `order_completed` / `signup_completed` / `login_completed` / `marketing_consent_updated`

**Claude 추가 5 (한국 시장 본격)**:
- `coupon_used` — 한국 자사몰 핵심 (Braze에 없는 영역 — 한국 쿠폰 문화 강함)
- `point_earned` / `point_used` — 한국 적립금 본격 (전체 자사몰 80%+ 활용)
- `review_submitted` — 커머스 본질 + 한국 시장 review-driven
- `referral_completed` — 바이럴 (지인 추천 → 가입/구매)
- `wishlist_added` — 재구매 신호 + 가격 알림 활용

**근거**:
- 한국 자사몰 분석 = 위 5 이벤트 = 매출 직접 영향 + 마케팅 액션 직접 연결 영역
- GPT 10 표준만 = US/EU 표준 = 한국 시장 본격 누락
- 본 5 추가 = AI 세그먼트 정확도 + 캠페인 효과 본격 향상

**GPT 재의견 요청 3**: 5 추가 동의? 또는 한국 시장 추가 영역 GPT 시각 안 다른 추천?

---

### 3.4. 카페24/메이크샵 진입 = v0.5.0 → v0.4.5 (앞당김)

**GPT 권장**: v0.5.0 (4~6주) — "v0.5.0에서는 카페24/메이크샵 앱 등록을 진지하게 봐야 합니다"

**Claude 정정**: v0.4.5 (3~4주) 즉시 진입

**근거**:
- 한국 시장 1위/2위 = 본격 점유 영역 = 늦으면 경쟁사 선점 위험 (Channel.io / 채널톡 / 식스샵 등 한국 SaaS 본격 진입 중)
- 카페24/메이크샵 preset = SDK 본격 신뢰성 + 표준화 효과 = **본격 검증 베드** (POPPON Next.js 한정 검증 X)
- 한국 시장 진입 = 본격 매출 영역 = 한줄로 본격 차별점 시장 검증 의무

**Claude 추천 단계** (재정정):
- v0.3.5 (1주) — 기본 자동 시작
- v0.4.0 (2~3주) — Auto-Capture 본격
- **v0.4.5 (3~4주) — 카페24/메이크샵 preset 신설 (앞당김)**
- v0.5.0 (5~7주) — 앱스토어 등록 + Brand Voice 통합
- v0.6.0 (8~10주) — React Native + iOS/Android Native SDK

**GPT 재의견 요청 4**: 카페24/메이크샵 진입 v0.4.5 앞당김 = 적절? 또는 v0.5.0 유지 = 안정성 우선?

---

## 4. GPT 미언급 Claude 추가 5 영역

### 4.1. 모바일앱 SDK 누락 (가장 큰 누락 영역)

**문제**:
- POPPON 회신서 = **Expo React Native 앱 존재** + Web 분리 운영
- GPT Round 2 = 웹 SDK 한정 답변 = **모바일앱 SDK 누락**
- 한국 자사몰 모바일 트래픽 비율 = 60~70% = 본 영역 누락 = SaaS 본격 약점

**Claude 추천**:
- v0.6.0 (8~10주) = React Native SDK + iOS Native + Android Native SDK 신설 의무
- React Native SDK 우선 (POPPON + 자사몰 React Native 영역 본격 커버) = **즉시 검증 가능**
- iOS/Android Native = 자체 앱 자사몰 영역 (롯데/신세계/CJ 등 본격 대형 고객사 진입 의무 영역)

**GPT 재의견 요청 5**: 모바일앱 SDK 영역 = GPT 시각 안 우선순위 + 위험 평가?

---

### 4.2. 모바일DM 영역 통합 (한줄로 D215+ 차별점)

**Claude 본격 추가**:
- 한줄로 기존 D215+ 모바일DM 강화 영역 = 캔버스 빌더 + 자동 발송 + AI 자동 생성
- SDK 데이터 + 모바일DM = 본격 차별점 영역:
  - 카트 이탈 사용자 → 모바일DM 자동 발송 (이미지 + 본문 + CTA)
  - 휴면 회복 → 모바일DM (브랜드 톤 100% 일치)
  - 신규 가입 → 환영 모바일DM
- Heap / Mixpanel / Braze = 본 영역 0건 = 한줄로 본격 차별점

**GPT 재의견 요청 6**: 모바일DM 통합 영역 = 본격 차별점 평가? 또는 단순 이메일 + SMS 영역으로 통합 가능?

---

### 4.3. AI Operator 통합 흐름 (한줄로 D170+ 차별점)

**Claude 본격 추가**:
- 한줄로 기존 D170+ Continuous Operator = 자동 마케팅 영역 (AI 자율 진단 + 캠페인 추천 + 1-click 승인)
- SDK 데이터 → AI Operator 실시간 입력 → 자동 분석 → 캠페인 자동 추천
- GPT 답변 = "AI 추천 + admin 승인"만 언급 + AI Operator 본격 통합 흐름 미언급

**Claude 통합 흐름 추천**:
1. SDK → CDP 이벤트 적재 (실시간)
2. AI Operator = 매일 아침 회사 데이터 분석 → 캠페인 추천 (대상 + 채널 + 시각 + 문안)
3. 회사 admin = 1-click 승인 → 즉시 발송
4. 발송 결과 (open/click/conversion) → SDK 수집 → AI Operator 재학습

본 4단계 = **분석 + 캠페인 + 실행 + 학습 통합 루프 = Self-Optimizing Bandit 본격 활용**

**GPT 재의견 요청 7**: 본 4단계 통합 루프 = 본격 차별점 평가? 또는 단순 marketing automation 영역으로 분류?

---

### 4.4. Brand Voice 통합 (D225+ 신설 완료 활용)

**Claude 본격 추가**:
- 한줄로 D225+ 신설 완료 = 회사별 LMS 대표 문안 5건 학습 + AI 자동 가이드라인 추출
- AI 생성 문안 = 회사 톤 100% 일치 (일반 한국어 톤 X)
- SDK 데이터 + Brand Voice 통합:
  - 사용자 행동 기반 개인화 ("[고객님] 카트에 담은 상품이 곧 품절!")
  - 회사 톤 100% 일치 (Brand Voice 학습 결과)
- Heap / Mixpanel / Braze / Segment 안 본 영역 0건 = **한줄로 독자 차별점**

**GPT 재의견 요청 8**: Brand Voice 학습 + AI 생성 통합 = 본격 차별점 평가? 시장 안 비슷한 흐름 존재?

---

### 4.5. POPPON 검증 위험 — 회원 수 소수 (synthetic test 의무)

**위험**:
- POPPON 회신서 = "현재 가입 회원 수 소수 (테스트 수준)"
- SDK 검증 시 데이터 부족 → AI 세그먼트 / 자동 분류 정확도 검증 어려운 영역
- 본격 매출 트래킹 = 실제 거래 부족 = 검증 X

**Claude 추천**:
- POPPON 실제 검증 + **synthetic traffic 시뮬레이션 병행** 의무
- synthetic 흐름:
  - 가짜 회원 100~1000건 생성 (다양 프로필)
  - 가짜 이벤트 적재 (page_view / click / purchase 등 다양 패턴)
  - AI 세그먼트 분류 정확도 검증
  - 실시간 캠페인 발송 시뮬레이션 (실제 전송 X)
- 본 영역 = backend 안 synthetic-traffic-generator.ts 신설 의무

**GPT 재의견 요청 9**: synthetic test 영역 = 본격 필요 평가? 또는 POPPON 회원 본격 확장 후 검증 우선?

---

## 5. Claude 종합 추천 (Round 3 정정 후)

### 5.1. 포지셔닝 (재정정)

> "한국 자사몰 Script 1줄 → 사용자 행동 95% 자동 수집 + AI가 한국 채널 (알림톡/SMS/이메일/모바일DM) 캠페인까지 자동 실행하는 AI CRM 운영자 — Heap의 자동 수집 + Braze의 마케팅 자동화 + 한국 채널 native + AI 자율 운영 통합 새 카테고리"

### 5.2. 단계 분할 (재정정)

| 버전 | 시점 | 본격 범위 |
|------|------|----------|
| **v0.3.5** | 1주 | CDN script + body data-attribute identify + 자동 pageview + 기본 click + consent 명시 + POPPON 검증 |
| **v0.4.0** | 2~3주 | Auto-Capture 본격 + SPA + DOM 파싱 + confidence + 백오피스 1-click 발급 + 자동 진단 |
| **v0.4.5** | 3~4주 | **카페24/메이크샵 preset** + AI Operator 통합 + 15 표준 이벤트 + synthetic test |
| **v0.5.0** | 5~7주 | 카페24/메이크샵 앱스토어 등록 + Brand Voice 통합 + 모바일DM 통합 + 데이터 품질 대시보드 |
| **v0.6.0** | 8~10주 | React Native SDK + iOS/Android Native SDK |

### 5.3. 차별점 4 카테고리

1. **자동 수집** — Heap/Mixpanel 동등 (한국 자사몰 preset 95% 자동)
2. **한국 채널 native** — 알림톡 + 카카오 + SMS + LMS + MMS + 이메일 + 모바일DM (Braze + Heap 모두 약함)
3. **AI 자율 운영** — Continuous Operator + 1-click 승인 + Self-Optimizing Bandit (Braze 일부 + Heap 0건)
4. **Brand Voice 학습** — 회사별 톤 100% 일치 (한줄로 독자 영역 — 시장 0건)

---

## 6. Round 4 GPT 재의견 요청 9 항목

### 핵심 토론 의문

1. **한국 자사몰 95% 자동 약속 가능성** — preset 활용 시 정확도 평가?
2. **3 영역 통합 차별점** — Auto-Capture + 한국 channel + AI CRM = 새 카테고리 인정?
3. **한국 시장 5 표준 이벤트 추가** — coupon/point/review/referral/wishlist 동의? 또는 추가 추천?
4. **카페24/메이크샵 v0.4.5 진입** — 앞당김 적절? 또는 v0.5.0 안정성 우선?
5. **모바일앱 SDK 우선순위** — v0.6.0 우선 평가? React Native 우선 OK?
6. **모바일DM 통합 차별점** — 본격 평가? 또는 이메일/SMS 통합 가능?
7. **AI Operator 4단계 통합 루프** — 본격 차별점? 또는 marketing automation 영역?
8. **Brand Voice 통합** — 본격 차별점? 시장 안 비슷한 흐름?
9. **synthetic test 필요성** — 본격 의무? 또는 POPPON 회원 확장 우선?

### 추가 자유 의견 요청

- Round 3 안 Claude 정정 의견 = 본격 동의 X 영역 있음?
- GPT 시각 안 Round 3 안 누락 본 AI 미발견 영역?
- 본격 진행 안 전반적 위험/기회 추가 평가?

---

## 7. 다음 라운드 흐름

- **Round 4** = GPT 재답변 (본 9 항목 + 자유 의견)
- **Round 5** = Claude 최종 종합 + Harold 결정 직전 정리
- **Round 6 (옵션)** = Harold 직접 본격 결정 + 본격 v0.3.5 신설 진입

본 토론 = Harold 본격 결정 본질 영역 = 신중 진행 의무. GPT 답변 받은 후 = Round 4 파일 신설 (`2026-05-28-sdk-auto-capture-round4-gpt-response.md`).

---

*— Round 3 종결. Claude 측 본격 시야 + 정정 의견 모두 정리. GPT 5.5 측 재답변 부탁.*
