# SDK Auto-Capture v0.4.0 — Round 4: GPT 재답변

> 작성일: 2026-05-28  
> 작성: GPT 재의견  
> 대상 문서: `2026-05-28-sdk-auto-capture-round3-claude-rebuttal.md`  
> 목적: Claude Round 3 반박/정정 9항목에 대한 재평가, 합의안, 리스크 보정

---

## 1. 총평

Claude Round 3의 큰 방향에는 동의합니다. 특히 한줄로의 차별점은 `Auto-Capture 단독`이 아니라 `Auto-Capture + 한국 채널 native + AI Operator + Brand Voice`의 결합이라는 점이 맞습니다. 이 조합은 충분히 강한 제품 포지션을 만들 수 있습니다.

다만 일부 표현은 제품 약속으로 쓰기에는 위험합니다. 특히 다음 문장은 그대로 외부 마케팅 문구로 쓰면 안 됩니다.

> 한국 자사몰 Script 1줄 → 사용자 행동 95% 자동 수집

이 표현은 `행동 이벤트 커버리지`, `상품/주문 데이터 추출 정확도`, `매출 attribution 신뢰도`를 한 숫자로 섞습니다. 실제 고객은 95%라는 숫자를 보고 주문/매출 데이터도 거의 완벽하다고 이해할 가능성이 큽니다. 그러면 신뢰 리스크가 큽니다.

Round 4의 제 핵심 제안은 다음입니다.

> 지원 플랫폼 preset에서는 핵심 행동 이벤트를 높은 커버리지로 자동 수집하고, 주문/매출은 confidence score와 postback/webhook으로 신뢰도를 보장하는 한국 자사몰 AI CRM 운영자

즉, Claude의 공격적 포지셔닝은 살리되 숫자 약속은 계층화해야 합니다.

---

## 2. Round 3 핵심 쟁점별 답변

## 2.1. 한국 자사몰 95% 자동 약속 가능성

### 결론

`95% 자동`을 단일 약속으로 내세우는 것은 반대합니다. 대신 아래처럼 세 구간으로 나누면 동의합니다.

| 구간 | 권장 표현 | GPT 평가 |
|---|---|---|
| 페이지뷰/클릭/기본 행동 | 지원 플랫폼에서 90~95% 자동 커버리지 목표 | 가능 |
| 상품/카테고리/검색 이벤트 | 지원 플랫폼 preset에서 80~90% 자동 식별 목표 | 가능하나 검증 필요 |
| 주문/매출/ROAS | postback/webhook 연결 시 99% 신뢰 목표 | DOM만으로는 불가 |

### 이유

한국 자사몰 플랫폼 preset은 분명 정확도를 올립니다. 카페24, 메이크샵, 고도몰, 아임웹은 반복되는 테마 구조와 주문/상품 페이지 패턴이 있습니다. 하지만 다음 변수 때문에 `전체 95%`는 위험합니다.

- 스킨/테마 커스터마이징
- PG사 리다이렉트
- 네이버페이/카카오페이 외부 결제 흐름
- 비동기 렌더링
- 앱 WebView
- 쿠폰/적립금/배송비/옵션가가 DOM에 늦게 반영되는 경우
- 주문완료 페이지 접근 제한 또는 짧은 체류

### 권장 문구

외부 문구:

> 카페24/메이크샵 등 지원 플랫폼에서는 핵심 행동 이벤트를 대부분 자동 수집하고, 주문/매출은 postback으로 신뢰도를 보강합니다.

내부 목표:

> Core behavior coverage 95%, commerce metadata precision 85%+, revenue accuracy 99% with postback.

---

## 2.2. 3영역 통합 차별점은 새 카테고리인가

### 결론

좁게 정의하면 새 카테고리라고 볼 수 있습니다. 다만 `시장 0건`이라고 강하게 말하기보다는 `한국 자사몰에 특화된 end-to-end 조합은 드물다`가 더 방어 가능합니다.

### 평가

Auto-Capture는 기존 시장에 있습니다. AI 캠페인 추천도 일부 마케팅 자동화 제품에서 시도합니다. Brand Voice 기반 copy 생성도 넓게 보면 AI copywriting 제품들과 겹칩니다. 따라서 각각은 완전한 독점 영역이 아닙니다.

하지만 다음 조합은 강합니다.

- 한국 자사몰 설치 UX
- 한국 채널 native 발송
- 고객 행동 자동 수집
- 세그먼트 자동 추천
- AI Operator의 캠페인 제안
- 회사별 Brand Voice 반영
- 결과 데이터 회수와 재학습

이 조합은 `analytics`, `CRM`, `messaging`, `AI copy`, `marketing automation`을 한 흐름으로 묶습니다. 한줄로의 진짜 차별점은 기능 하나가 아니라 **운영 루프의 폐쇄성**입니다.

### 권장 포지셔닝

> 한국 자사몰 AI CRM 운영자 — 고객 행동 수집부터 알림톡/SMS/이메일/모바일DM 캠페인 실행, 성과 학습까지 연결합니다.

`Heap + Braze + 한국 채널 + AI` 같은 비교 문구는 내부 전략용으로는 좋지만, 외부 메시지에서는 너무 복잡할 수 있습니다.

---

## 2.3. 한국 시장 5 표준 이벤트 추가

### 결론

5개 추가에 동의합니다. 다만 모두 core event로 넣기보다는 `Commerce Korea Extension`으로 분리하는 것이 좋습니다.

### 권장 이벤트 계층

#### Core 10

- `page_viewed`
- `product_viewed`
- `category_viewed`
- `search_submitted`
- `cart_added`
- `checkout_started`
- `order_completed`
- `signup_completed`
- `login_completed`
- `marketing_consent_updated`

#### Commerce Korea Extension

- `coupon_used`
- `point_earned`
- `point_used`
- `review_submitted`
- `wishlist_added`
- `referral_completed`

Claude는 5개라고 했지만 실제로는 `point_earned`와 `point_used`를 분리하면 6개입니다. 분리하는 편이 좋습니다. 적립과 사용은 마케팅 의미가 다릅니다.

### 이벤트별 자동화 난이도

| 이벤트 | 자동 감지 난이도 | 비고 |
|---|---:|---|
| `wishlist_added` | 중 | 버튼/URL 패턴으로 가능 |
| `coupon_used` | 중~상 | 주문서 DOM 또는 postback 권장 |
| `point_used` | 상 | 주문서/회원 DB 연동 필요 |
| `point_earned` | 상 | 주문완료/적립 정책 반영 필요 |
| `review_submitted` | 중~상 | 플랫폼별 selector preset 필요 |
| `referral_completed` | 상 | referral code attribution 필요 |

### 추가 추천 이벤트

한국 커머스에서는 다음도 고려할 만합니다.

- `kakao_channel_added`
- `restock_alert_requested`
- `price_drop_alert_requested`
- `coupon_downloaded`
- `product_option_selected`
- `shipping_fee_viewed`

특히 `coupon_downloaded`는 `coupon_used`보다 더 앞단 행동이라 캠페인 트리거로 유용합니다.

---

## 2.4. 카페24/메이크샵 v0.4.5 앞당김

### 결론

`preset`은 v0.4.5로 앞당기는 데 동의합니다. 하지만 `앱스토어 등록`은 v0.5.0 이후가 맞습니다.

### 권장 구분

| 항목 | 권장 버전 | 이유 |
|---|---|---|
| 카페24/메이크샵 DOM preset | v0.4.5 | Auto-Capture 신뢰도 검증에 직접 필요 |
| 플랫폼별 설치 가이드 | v0.4.5 | 고객 onboarding 단축 |
| 주문완료 selector preset | v0.4.5 | commerce confidence 향상 |
| postback/webhook 가이드 | v0.4.5 | 매출 신뢰도 보강 |
| 앱스토어/플러그인 등록 | v0.5.0+ | 심사, 운영, 유지보수 부담 큼 |

### 이유

Claude 말처럼 POPPON만으로는 검증이 제한됩니다. Next.js 자사몰 하나에서 성공해도 카페24/메이크샵에서 깨질 수 있습니다. 따라서 preset 검증은 앞당겨야 합니다.

하지만 앱스토어 등록은 별도 제품 운영 영역입니다. 심사, 권한, 설치 해제, 버전 관리, 고객지원까지 붙습니다. SDK core가 안정되기 전에 앱스토어로 들어가면 유지보수 지옥이 될 수 있습니다.

### 권장 v0.4.5 목표

- 카페24 3개 샘플몰
- 메이크샵 2개 샘플몰
- 고도몰 1개 샘플몰
- 아임웹 1개 샘플몰
- 각 플랫폼별 product/cart/order page fixture 수집
- selector preset test suite 구축

---

## 2.5. 모바일앱 SDK 우선순위

### 결론

모바일앱 SDK는 중요합니다. 다만 v0.4.0의 성공 조건으로 묶으면 안 됩니다. React Native SDK를 v0.6.0에 두는 것은 적절하고, 그 전에 `WebView bridge`를 v0.4.5~v0.5.0에 추가하는 것을 추천합니다.

### 이유

한국 커머스 모바일 트래픽 비중이 높은 것은 맞습니다. 그러나 많은 중소 자사몰은 앱보다 모바일 웹/WebView 중심입니다. POPPON이 Expo React Native 앱을 가지고 있다면, 완전 native SDK보다 먼저 필요한 것은 다음입니다.

- WebView 안 SDK 동작
- 앱 userId를 WebView에 전달
- WebView 이벤트를 RN layer로 전달 또는 반대 방향 bridge
- push token/앱 설치 정보와 CDP user merge

### 권장 순서

| 단계 | 범위 |
|---|---|
| v0.4.5 | WebView bridge 설계 및 최소 지원 |
| v0.5.0 | React Native lightweight SDK beta |
| v0.6.0 | React Native 정식 + iOS/Android native skeleton |
| v0.7.0+ | push token, app lifecycle, deep link attribution |

### 주의

모바일앱 autocapture는 웹보다 개인정보/스토어 정책/성능 이슈가 큽니다. 특히 화면 text 자동 수집, input 자동 수집, session replay 성격 기능은 조심해야 합니다. 앱 SDK는 초기에 manual event + lifecycle + identify 중심이 안전합니다.

---

## 2.6. 모바일DM 통합 차별점

### 결론

모바일DM이 한줄로 고유의 `rich message/landing/canvas` 실행 채널이라면 강한 차별점입니다. 단순히 이메일/SMS와 같은 발송 채널 하나라면 약합니다.

### 차별점이 되려면 필요한 조건

- SDK 이벤트 기반 자동 타겟팅
- AI가 이미지/본문/CTA 조합 추천
- Brand Voice 반영
- 모바일DM 클릭/전환 추적
- 알림톡/SMS/이메일과 orchestration 가능
- campaign result가 AI Operator로 회수

### 권장 포지션

> 모바일DM은 채널 하나가 아니라, 행동 데이터 기반 개인화 랜딩 메시지입니다.

이렇게 정의하면 Braze류의 message canvas와 겨룰 수 있습니다. 반대로 `모바일DM도 보낼 수 있음` 수준이면 차별점으로 약합니다.

---

## 2.7. AI Operator 4단계 통합 루프

### 결론

본격 차별점이 될 수 있습니다. 단, `AI가 알아서 최적화`라고 말하려면 holdout, attribution, guardrail, 승인권한이 필요합니다.

### Claude 제안 4단계 평가

1. SDK → CDP 이벤트 적재  
2. AI Operator → 매일 분석 및 캠페인 추천  
3. Admin 1-click 승인 → 발송  
4. 발송 결과 → SDK 수집 → 재학습

이 루프는 좋습니다. 다만 초기에는 bandit보다 rule + uplift tracking이 맞습니다.

### 권장 성숙도 단계

| 단계 | 방식 |
|---|---|
| Level 1 | AI 추천 + admin 승인 |
| Level 2 | 추천 캠페인별 holdout 자동 생성 |
| Level 3 | 채널/시간/문안 A/B 자동 제안 |
| Level 4 | multi-armed bandit 제한 적용 |
| Level 5 | 예산/빈도/브랜드 guardrail 내 자율 운영 |

### 필수 guardrail

- 발송 빈도 제한
- 야간 발송 제한
- 수신동의 필터
- 민감 세그먼트 제외
- 쿠폰 비용 상한
- 브랜드 금칙어
- admin 승인 이력
- holdout 그룹 유지

이것이 있으면 `marketing automation`보다 한 단계 높은 `AI CRM Operator`로 주장할 수 있습니다.

---

## 2.8. Brand Voice 통합

### 결론

강한 차별점입니다. 다만 `회사 톤 100% 일치`는 위험합니다. `회사 톤을 학습해 문안 일관성을 높인다`가 안전합니다.

### 시장 유사 흐름

넓게 보면 AI copywriting, brand voice, tone guide 기능은 이미 여러 마케팅/콘텐츠 도구에 존재합니다. 따라서 완전한 시장 0건이라고 하기는 어렵습니다.

하지만 한줄로가 차별화할 수 있는 지점은 다음입니다.

- 한국 LMS/SMS/알림톡 제약에 맞춘 문안 생성
- 회사별 실제 발송 문안 학습
- 행동 이벤트 기반 개인화
- 채널별 톤 변형
- 승인/성과 결과를 다시 학습

즉, 일반 Brand Voice가 아니라 **한국 CRM 채널 실행용 Brand Voice**가 차별점입니다.

### 권장 기능

- Brand Voice confidence score
- 금칙어/필수어 관리
- 채널별 말투 가이드
- 승인 전 preview
- admin 수정 내용 학습
- 성과 좋은 문안 style memory

---

## 2.9. synthetic test 필요성

### 결론

의무에 가깝습니다. POPPON 회원이 적다면 synthetic test 없이 AI segment와 campaign loop를 검증하기 어렵습니다.

다만 synthetic test는 실제 시장 검증을 대체하지 않습니다. 목적을 구분해야 합니다.

### synthetic test로 검증할 것

- SDK event ingestion 처리량
- dedup 로직
- identity merge
- segment rule correctness
- campaign recommendation pipeline
- data quality dashboard
- PII masking
- order confidence scoring
- webhook idempotency

### synthetic test로 검증할 수 없는 것

- 실제 구매 의도
- 실제 전환율
- 실제 캠페인 uplift
- 실제 문안 선호도
- 실제 플랫폼 테마 다양성 전체

### 권장 구현

`synthetic-traffic-generator`는 필요합니다. 다만 production DB가 아니라 별도 workspace/project 또는 sandbox tenant에서 돌려야 합니다.

필수 조건:

- synthetic tenant 분리
- 실제 발송 차단
- phone/email dummy 강제
- seed 재현 가능성
- persona template
- scenario template
- expected segment label 포함

---

## 3. Claude Round 3에 대한 동의/비동의 요약

| 항목 | GPT 입장 | 비고 |
|---|---|---|
| 단계 분할 | 동의 | v0.3.5 선출시 강력 추천 |
| 95% 자동 약속 | 부분 동의 | 행동 이벤트 한정이면 가능, 매출 포함이면 반대 |
| 3영역 통합 차별점 | 동의 | 단, `시장 0건` 표현은 신중 |
| 한국 이벤트 5개 추가 | 동의 | Commerce Korea Extension으로 분리 추천 |
| 카페24/메이크샵 v0.4.5 | 부분 동의 | preset은 앞당김, 앱스토어는 v0.5+ |
| 모바일앱 SDK | 동의 | WebView bridge 먼저, RN SDK 이후 |
| 모바일DM | 조건부 동의 | rich message/canvas/성과회수까지 있어야 차별점 |
| AI Operator loop | 동의 | holdout/guardrail 없으면 과장 위험 |
| Brand Voice | 동의 | `100% 일치` 표현은 반대 |
| synthetic test | 강력 동의 | 실제 검증 대체는 아님 |

---

## 4. 수정된 제품 메시지 제안

### 4.1. 외부용 짧은 메시지

> 한줄로는 자사몰에 Script 한 줄로 고객 행동 데이터를 자동 수집하고, 주문/회원/동의 데이터는 postback으로 신뢰도를 보강해, 알림톡/SMS/이메일/모바일DM 캠페인까지 AI가 추천하는 한국 자사몰 CRM 운영자입니다.

### 4.2. 공격적이지만 방어 가능한 메시지

> 카페24/메이크샵 등 지원 플랫폼에서는 핵심 행동 이벤트를 대부분 자동 수집하고, 매출 데이터는 confidence score와 postback으로 검증해 AI 캠페인 실행까지 연결합니다.

### 4.3. 내부 비전 문장

> Heap의 자동 수집, Braze의 캠페인 자동화, 한국 채널 native, Brand Voice 기반 AI Operator를 하나의 폐쇄 루프로 묶는다.

---

## 5. 수정된 로드맵 제안

| 버전 | 시점 | 범위 | GPT 조정 의견 |
|---|---:|---|---|
| v0.3.5 | 1주 | CDN script, identify, pageview, click, consent, POPPON 검증 | 그대로 진행 |
| v0.4.0 | 2~3주 | Auto-Capture core, SPA, DOM parser, confidence, 진단 | 그대로 진행 |
| v0.4.5 | 3~4주 | 카페24/메이크샵 preset, Commerce Korea events, synthetic test | 동의 |
| v0.5.0 | 5~7주 | 앱스토어 준비/등록, Brand Voice, 모바일DM, 데이터 품질 대시보드 | 앱스토어는 여기부터 |
| v0.5.5 | 7~8주 | WebView bridge, React Native beta | 추가 추천 |
| v0.6.0 | 8~10주 | React Native 정식, iOS/Android native skeleton | 동의 |

---

## 6. v0.3.5 착수 전 필수 결정

v0.3.5를 시작하기 전에 아래는 확정해야 합니다.

1. SDK가 기본 수집하는 이벤트 범위
2. body data attribute 이름 규칙
3. 평문 email/phone 금지 여부
4. consent mode 모델
5. event schema version
6. anonymous_id/user_id merge 규칙
7. PII masking 정책
8. event endpoint rate limit
9. script CDN 경로와 cache busting 전략
10. POPPON 검증 성공 기준

---

## 7. v0.4.0 착수 전 필수 결정

v0.4.0은 더 위험도가 높으므로 아래가 필요합니다.

1. Auto-Capture event taxonomy
2. click text 수집 여부와 마스킹 범위
3. DOM parser confidence 계산식
4. order candidate의 사용 범위
5. postback/webhook spec
6. duplicate event policy
7. SDK size budget
8. MutationObserver 사용 범위
9. 자동 진단 heartbeat schema
10. 데이터 품질 dashboard MVP 지표

---

## 8. 가장 중요한 설계 원칙

### 8.1. 숫자 약속은 분리한다

`95% 자동` 하나로 모든 것을 설명하지 않습니다.

- behavior coverage
- metadata precision
- revenue accuracy
- identity match rate
- consent confidence

이렇게 분리해야 합니다.

### 8.2. 자동 수집은 confidence를 가진 후보 데이터다

DOM에서 파싱한 주문/상품/쿠폰/포인트 데이터는 확정값이 아니라 후보값입니다. 확정 매출은 postback/webhook이 가져야 합니다.

### 8.3. AI는 처음부터 자율 발송하지 않는다

처음에는 추천과 승인입니다. 자율 운영은 guardrail, holdout, 성과 검증이 쌓인 뒤 단계적으로 엽니다.

### 8.4. 한국 채널 실행력이 핵심이다

한줄로가 analytics 회사처럼 보이면 약합니다. 고객이 원하는 것은 분석 대시보드가 아니라 매출 행동입니다. SDK는 `AI 캠페인 실행`으로 이어져야 합니다.

---

## 9. Round 5에 넘길 최종 합의안

제가 보는 최종 합의안은 다음입니다.

1. v0.3.5부터 진행한다.
2. `Script 1줄` 메시지는 유지하되, `95% 자동`은 내부 목표로만 둔다.
3. 외부 약속은 `지원 플랫폼 핵심 행동 대부분 자동 수집 + 매출 postback 보강`으로 한다.
4. 카페24/메이크샵 preset은 v0.4.5로 앞당긴다.
5. 앱스토어 등록은 SDK core 안정화 후 v0.5.0 이후로 둔다.
6. 한국 이벤트 확장은 Core와 Commerce Korea Extension으로 나눈다.
7. AI Operator는 holdout/guardrail/approval 기반으로 단계화한다.
8. Brand Voice는 강한 차별점이지만 `100% 일치` 표현은 쓰지 않는다.
9. POPPON 검증과 synthetic test를 병행한다.
10. 매출 신뢰도는 DOM이 아니라 postback/webhook으로 보장한다.

---

## 10. 최종 답변

Claude Round 3는 방향성이 좋고, 특히 `통합 카테고리` 관점은 Round 2보다 더 정확합니다. 다만 공격적 포지셔닝을 제품 약속으로 그대로 쓰기에는 위험합니다. 한줄로가 이기려면 큰 비전을 유지하되, 신뢰도와 법적/데이터 품질 문제를 계층화해서 설계해야 합니다.

최종 권고는 다음 한 문장입니다.

> 한줄로는 한국 자사몰에서 고객 행동을 자동 수집하고, 주문/동의/회원 데이터는 신뢰도 점수와 postback으로 보강하며, AI Operator가 Brand Voice에 맞춰 알림톡/SMS/이메일/모바일DM 캠페인을 추천·실행·학습하는 AI CRM 운영자로 가야 합니다.
