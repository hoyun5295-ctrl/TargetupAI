# SDK Auto-Capture v0.4.0 — GPT 기술/시장 검토 답변

> 작성일: 2026-05-28  
> 작성: GPT 의견 정리  
> 대상 문서: `2026-05-28-sdk-auto-capture-gpt-review.md`  
> 목적: 한줄로 SDK Auto-Capture v0.4.0 신설 전 기술 가능성, 시장성, 위험, 단계 전략 검토

---

## 1. 총평

SDK Auto-Capture 방향은 충분히 시도할 가치가 있습니다. 다만 제품 메시지를 `Script 1줄로 모든 데이터 100% 자동 수집`으로 잡으면 위험합니다. 실제 시장과 기술 현실에 맞는 포지션은 다음이 더 적절합니다.

> Script 1줄로 70% 자동 시작, postback/webhook으로 핵심 매출 99% 신뢰 확보, AI가 한국 채널 캠페인까지 이어주는 구조

Auto-Capture 자체는 이미 Heap, Amplitude, Mixpanel 등에서 검증된 방향입니다. 따라서 한줄로의 차별점은 Auto-Capture 그 자체가 아니라, 아래의 결합입니다.

- 한국 SMS/LMS/MMS + 카카오 알림톡 native
- 자사몰 전환 이벤트를 마케팅 자동화까지 바로 연결
- AI 세그먼트와 캠페인 추천
- 회사별 Brand Voice 학습
- 한국 자사몰 플랫폼에 맞춘 설치/검증 UX

즉, `한국형 Braze`보다는 `한국 자사몰용 AI CRM 운영자`에 가깝게 포지셔닝하는 편이 더 강합니다.

---

## 2. 기술 가능성 검토

### 2.1. Script tag + Autocapture

가능합니다. Heap, Amplitude, Mixpanel 계열이 이미 유사한 접근을 검증했습니다. 다만 `가능하다`는 말은 `모든 자사몰에서 정확하다`는 뜻은 아닙니다.

권장 범위:

- 페이지뷰 자동 수집
- URL/UTM/referrer/device/browser 자동 수집
- 표준 클릭 이벤트 자동 수집
- form submit 발생 사실 자동 수집
- body/data attribute 기반 identify
- JSON-LD/Open Graph 기반 상품/주문 후보 파싱

주의할 범위:

- form input value 자동 수집
- 주문 금액 DOM 파싱 100% 신뢰
- iframe 내부 자동 추적
- 모든 SPA/커스텀 라우터 완전 대응

### 2.2. SPA pageview 감지

대부분의 SPA는 다음 조합으로 대응 가능합니다.

- `history.pushState` patch
- `history.replaceState` patch
- `popstate` listener
- `hashchange` listener
- 최초 load 시 pageview
- route 변경 후 일정 delay를 둔 metadata 재수집

Next.js, Vue, Nuxt, Svelte, 정적 HTML까지 큰 틀은 대응 가능합니다. 다만 일부 앱은 자체 router, shallow routing, modal route, iframe route를 쓰기 때문에 `pageview 중복 방지`와 `URL 안정화 debounce`가 필요합니다.

### 2.3. MutationObserver

MutationObserver는 쓸 수 있지만 전역 DOM 전체를 무제한으로 감시하면 성능 위험이 있습니다.

권장 방식:

- 전역 observer는 최소화
- route 변경 후 짧은 window에서 metadata 탐색
- 상품/주문 후보 selector만 제한 관찰
- throttle/debounce 필수
- DOM snapshot 대량 저장 금지
- textContent 전체 수집 금지

### 2.4. DOM 자동 파싱

JSON-LD, Open Graph, Schema.org, Microdata는 유용하지만 한국 자사몰 전체에서 충분히 표준화되어 있다고 보기는 어렵습니다. 특히 카페24/메이크샵/고도몰/아임웹/자체개발 쇼핑몰은 테마와 커스텀 코드에 따라 마크업 편차가 큽니다.

따라서 DOM 파싱 결과에는 반드시 `confidence`를 붙여야 합니다.

예시:

```json
{
  "event": "order_detected",
  "capture_method": "dom_jsonld",
  "confidence": 0.74,
  "requires_postback": true
}
```

### 2.5. iframe

cross-origin iframe 내부는 자동 추적 불가로 보는 것이 맞습니다. 가능한 선택지는 두 가지입니다.

- iframe 내부에도 SDK를 설치
- iframe 제공자가 `postMessage`로 이벤트 전달

결제 PG iframe, 외부 리뷰 위젯, 외부 폼은 기본 자동 수집 범위에서 제외하는 편이 안전합니다.

---

## 3. 보안 및 개인정보 보호

### 3.1. body data attribute 설계

문서 제안의 `data-user-email`, `data-user-phone`은 그대로 권장하기에는 위험합니다. 기본 설치 가이드는 다음 수준으로 제한하는 것이 좋습니다.

권장 기본:

```html
<body data-hjl-user-id="USER_ID" data-hjl-marketing-agreed="true">
```

선택 옵션:

```html
<body
  data-hjl-user-id="USER_ID"
  data-hjl-phone-hash="..."
  data-hjl-email-hash="..."
  data-hjl-marketing-agreed="true"
>
```

전화번호/이메일 원문은 가능하면 서버 postback 또는 명시 API로만 받는 편이 안전합니다.

### 3.2. form tracking 기본값

form tracking은 반드시 보수적으로 설계해야 합니다.

기본 차단:

- `input[type=password]`
- `autocomplete="cc-number"`
- 카드번호 패턴
- 주민등록번호/생년월일 패턴
- 계좌번호 패턴
- 비밀번호/인증번호/토큰/secret/API key 관련 name
- textarea value 전체
- hidden input value 전체

기본 수집:

- form submit 발생 여부
- form action host/path
- submit button label의 안전한 요약
- field count
- form purpose 추정값

명시 opt-in이 있는 경우에만 일부 field value를 허용해야 합니다.

예시:

```html
<input name="search" data-hjl-capture="value" />
<input name="password" data-hjl-redact />
```

### 3.3. PII 마스킹

DOM 파싱과 클릭 text 수집에는 자동 마스킹이 필요합니다.

필수 처리:

- 이메일 마스킹
- 한국 휴대폰 번호 마스킹
- 카드번호 마스킹
- 주민번호 유사 패턴 마스킹
- 긴 숫자열 마스킹
- URL query 내 token/code/session 제거

URL도 그대로 저장하면 위험합니다. `?token=`, `?code=`, `?phone=`, `?email=` 등은 제거해야 합니다.

### 3.4. 마케팅 동의

마케팅 동의 자동 감지는 100% 자동화하기 어렵습니다. 쇼핑몰마다 checkbox, radio, hidden field, 약관 페이지, 회원가입 단계가 다릅니다.

권장 방식:

- 기본은 `unknown`으로 시작
- `data-hjl-marketing-agreed="true|false"`를 가장 신뢰
- 자동 checkbox 탐지는 보조 신호로만 사용
- 발송 가능 여부는 서버 정책에서 최종 차단
- 동의 출처와 시각을 저장

마케팅 동의는 `자동 추정`이 아니라 `명시 신호 우선 + 자동 보조`가 맞습니다.

---

## 4. 성능 영향

### 4.1. SDK 크기 목표

초기 목표는 gzip 기준 20~35KB가 적절합니다. 50KB를 넘기면 설치 저항과 성능 우려가 커집니다.

권장:

- core loader: 5KB 이하
- autocapture core: 20~30KB gzip
- heatmap/session replay는 별도 모듈로 분리
- AI/diagnostics UI 코드는 SDK에 넣지 않기

### 4.2. 로딩 방식

`async`로 로딩하되, SDK 내부에서도 first paint를 방해하지 않아야 합니다.

권장:

- 초기 실행은 `requestIdleCallback` 우선
- 미지원 브라우저는 `setTimeout`
- 첫 pageview만 빠르게 queue
- network 전송은 batch + keepalive/sendBeacon 활용
- 실패 시 local queue 제한

### 4.3. 이벤트 리스너

개별 요소마다 listener를 붙이지 말고 document-level delegation을 써야 합니다.

권장:

- click: document capture listener 1개
- submit: document capture listener 1개
- scroll depth: passive listener + throttle
- rage click: 짧은 window의 좌표/target count만 계산
- MutationObserver: 제한적 사용

---

## 5. 시장 차별점 평가

Auto-Capture 자체는 충분한 차별점이 아닙니다. 이미 시장에 존재합니다.

기존 제품의 강점:

- Segment: 표준화된 데이터 파이프라인과 destination ecosystem
- Mixpanel: product analytics와 autocapture
- Heap: 자동 수집과 사후 event definition
- Amplitude: product analytics, autocapture, activation, experiment ecosystem

한줄로가 이길 수 있는 지점은 다릅니다.

한줄로 강점:

- 한국 커머스/자사몰 채널에 집중
- 카카오 알림톡/친구톡/SMS/LMS/MMS native
- 마케팅 동의/수신거부/한국 번호 처리 내장
- AI가 segment, message, campaign action까지 이어줌
- 회사별 Brand Voice 학습
- 카페24/메이크샵/고도몰/아임웹 중심 onboarding

따라서 메시지는 다음이 좋습니다.

> 분석툴을 하나 더 붙이는 것이 아니라, 자사몰 데이터를 자동으로 읽고 한국 채널 캠페인까지 실행하는 AI CRM 운영자

---

## 6. 매출 트래킹 추천

문서의 A/B/C 중에서는 A + C 하이브리드를 추천합니다.

### 6.1. A: DOM 파싱 우선

장점:

- 설치 직후 빠른 가치 제공
- 개발자 작업 최소화
- self-service 진입에 유리

단점:

- 주문완료 페이지 마크업 다양성
- PG 리다이렉트 누락
- React state 내부 데이터 누락
- lazy render 누락
- 중복 주문 감지 어려움

### 6.2. C: Webhook/Postback

장점:

- 매출 데이터 신뢰도 높음
- order_id 기반 dedup 가능
- 환불/취소/배송 상태 확장 가능
- ROAS/CRM 성과 측정에 적합

단점:

- 개발 작업이 필요
- 플랫폼별 가이드 필요

### 6.3. 최종 추천

- v0.4 onboarding: DOM 자동 감지 + confidence score
- 운영 매출 KPI: postback/webhook 권장
- 고액 고객 또는 광고/성과 리포트 고객: postback 필수

정책 예시:

| 상황 | 처리 |
|---|---|
| order confidence >= 0.9 | 자동 매출 후보로 사용 가능 |
| 0.5 <= confidence < 0.9 | 검증 필요 표시 |
| confidence < 0.5 | postback 권장 |
| ROAS/정산/성과 리포트 | postback 필수 |

---

## 7. AI 세그먼트 정확도 검증

AI 단독 분류는 위험합니다. 처음에는 rule baseline + AI score 방식이 좋습니다.

### 7.1. 권장 구조

- VIP: 구매금액/구매횟수 기반 rule
- 신규: 가입일/첫 구매일 기반 rule
- 휴면: 마지막 방문/구매일 기반 rule
- 이탈 위험: 방문 감소, 반응률 감소, 장바구니 잔존 score
- 카트 이탈: cart_added 후 order_completed 없음
- 가격 민감: 할인/쿠폰/특가 페이지 반복 반응

### 7.2. 측정 지표

- Precision
- Recall
- F1
- segment별 conversion lift
- campaign holdout 대비 uplift
- admin correction rate

### 7.3. Admin 피드백

회사 admin이 직접 정정할 수 있어야 합니다.

필수 기능:

- 세그먼트 포함/제외 수동 조정
- AI 추천 사유 표시
- `맞음`, `아님`, `보류` 피드백
- 피드백 기반 rule/threshold 조정
- AI 추천 캠페인 승인 전 preview

초기에는 자동 발송보다 `추천 + 1-click 승인`이 맞습니다.

---

## 8. 자동 검증 및 진단

5분 자동 검증은 좋은 방향입니다. 다만 진단 정확도를 높이려면 SDK가 단계별 heartbeat를 보내야 합니다.

### 8.1. 권장 heartbeat 이벤트

- `sdk_loaded`
- `config_loaded`
- `domain_matched`
- `consent_state_detected`
- `first_pageview_queued`
- `first_pageview_sent`
- `first_event_accepted`
- `identify_detected`
- `order_candidate_detected`

### 8.2. 진단 메시지 원칙

진단은 확정형이 아니라 가능성 기반으로 보여줘야 합니다.

나쁜 예:

> CORS 오류입니다.

좋은 예:

> SDK는 로드됐지만 서버 수신이 없습니다. API key, 등록 도메인, 네트워크 차단 가능성을 확인해주세요.

### 8.3. 자동 알림

진단 실패 시 한줄로 운영팀 알림이 필요합니다.

추천 흐름:

- 5분 0건: 고객 admin에게 자동 진단 표시
- 10분 0건: 한줄로 운영팀 Slack/console 알림
- 30분 0건: 고객 admin에게 1:1 지원 CTA 표시

---

## 9. 한국 시장 통합 전략

### 9.1. 카페24/메이크샵

한국 시장에서는 카페24/메이크샵이 핵심이므로 일반 script guide만으로는 부족합니다.

권장 순서:

1. 수동 script 삽입 가이드
2. 플랫폼별 주문완료/상품상세 selector preset
3. webhook/postback 가이드
4. 앱스토어/플러그인 등록

v0.5.0에서는 카페24/메이크샵 앱 등록을 진지하게 봐야 합니다. 그래야 `개발자 0명 고객`도 들어옵니다.

### 9.2. 카카오 알림톡 차별점

카카오 알림톡은 SDK 자체보다 activation에서 차별점이 납니다.

예시:

- 주문완료 후 알림톡 자동 후속 캠페인
- 장바구니 이탈 알림톡/친구톡
- 재입고/가격하락 알림
- VIP 전용 쿠폰 메시지
- 휴면 고객 재활성화 SMS + 알림톡 조합
- Brand Voice 기반 문안 자동 생성

핵심 메시지:

> 한줄로는 이벤트를 수집하는 데서 끝나지 않고, 한국 채널로 바로 매출 액션을 실행한다.

---

## 10. 단계 전략

문서의 단계 분할안에 동의합니다. 바로 v0.4.0 풀스펙으로 가는 것보다 v0.3.5를 먼저 내는 편이 안전합니다.

### v0.3.5 — 1주

목표: 자동 시작 경험 검증

범위:

- CDN script tag
- body data attribute identify
- 자동 pageview
- 기본 click tracking
- marketing consent 명시 attribute
- POPPON 검증

성공 기준:

- 설치 15분 내 첫 이벤트 수신
- PII leakage 0건
- pageview 중복률 허용 범위 내
- POPPON에서 핵심 퍼널 확인 가능

### v0.4.0 — 2~3주

목표: Auto-Capture 본격화

범위:

- SPA route tracking
- DOM metadata parser
- 표준 이벤트 taxonomy
- order candidate parser
- confidence score
- 백오피스 1-click 발급
- 자동 진단

성공 기준:

- 주요 페이지 자동 분류 정확도 80%+
- order candidate precision 80%+
- SDK gzip 35KB 이하
- 설치 진단 오진율 관리

### v0.5.0 — 4~6주

목표: 한국 자사몰 native 확장

범위:

- 카페24/메이크샵 preset
- platform app/plugin
- order webhook/postback
- AI segment feedback loop
- AI campaign recommendation

성공 기준:

- 카페24/메이크샵 설치 시간 15분 이하
- order postback 성공률 95%+
- AI 추천 캠페인 승인율/성과 uplift 확인

---

## 11. 추가 위험 및 기회

### 11.1. 가장 큰 위험

데이터가 많이 들어오는 것과 마케팅에 쓸 수 있는 데이터는 다릅니다. Autocapture는 노이즈를 많이 만듭니다.

따라서 초기에 event taxonomy를 강제해야 합니다.

권장 표준 이벤트:

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

모든 이벤트 공통 속성:

- `schema_version`
- `capture_method`
- `confidence`
- `source_platform`
- `anonymous_id`
- `user_id_hash`
- `session_id`
- `page_url_sanitized`
- `referrer_sanitized`

### 11.2. 중복 이벤트

자동 pageview, route change, hydration, back/forward cache 때문에 중복 이벤트가 반드시 발생합니다.

필수:

- event_id 생성
- session 기준 dedup
- order_id 기준 dedup
- pageview debounce
- 동일 URL 짧은 시간 중복 차단

### 11.3. Consent mode

마케팅 동의와 분석 동의를 분리해야 합니다.

- analytics consent
- marketing consent
- ad consent
- kakao consent

동의가 없으면 campaign 대상에서 자동 제외해야 합니다.

### 11.4. 데이터 품질 대시보드

Auto-Capture 제품에는 데이터 품질 화면이 필요합니다.

예시 지표:

- 수신 이벤트 수
- 식별률
- 익명 -> 회원 merge율
- 주문 감지 confidence 분포
- postback 연결 여부
- PII masking count
- 이벤트 중복률
- 최근 SDK 오류

---

## 12. 최종 권고

한줄로 SDK v0.4.0 Auto-Capture는 추진할 만합니다. 단, 제품 약속은 현실적으로 잡아야 합니다.

권장 문장:

> 한줄로는 자사몰에 script 1줄만 붙여도 고객 행동 데이터를 자동으로 수집하고, 주문/회원/동의 데이터는 신뢰도 점수와 postback으로 보강해, 한국 SMS/알림톡 캠페인까지 AI가 추천하는 CRM 자동화 플랫폼입니다.

최종 선택:

- 단계 분할: 찬성
- v0.3.5 선출시: 강력 추천
- v0.4.0 full autocapture: POPPON 검증 후 진행
- 매출 트래킹: DOM 자동 + confidence + postback/webhook 하이브리드
- AI 세그먼트: rule baseline + AI score + admin feedback
- 차별점: Auto-Capture가 아니라 한국 채널 실행력 + AI CRM 운영자
