# SDK v0.4.0 — Round 6: GPT 공동 설계 답변

> 작성일: 2026-05-28  
> 작성: GPT 공동 설계 파트너  
> 대상 문서: `2026-05-28-sdk-auto-capture-round5-braze-domination-collab.md`  
> 목적: Claude와 GPT가 싸우는 구조가 아니라, 한줄로가 Braze/Salesforce급 또는 그 이상으로 팔릴 수 있는 SaaS가 되기 위한 최적 합의안 도출

---

## 0. 협업 원칙

이번 라운드는 반박전이 아닙니다. Claude가 한줄로의 도메인, 코드, 한국 시장 맥락을 잘 알고 있고, GPT는 글로벌 SaaS 경쟁 구도와 제품 신뢰성 관점에서 위험을 보정합니다. 두 관점은 충돌시키는 것이 아니라 합쳐야 합니다.

공동 목표는 하나입니다.

> 한줄로가 “기능이 많은 툴”이 아니라, 한국 자사몰이 실제로 도입하고 결제할 수 있는 AI CRM SaaS가 되는 것

따라서 이번 답변은 `정정/반박`이 아니라 `공동 설계안`입니다.

---

## 1. 먼저 경쟁사 현실을 정확히 보정해야 합니다

Round 5의 Braze/Salesforce 분석은 방향은 맞지만, 일부 표현은 현재 시장 기준으로 과소평가가 있습니다. Braze와 Salesforce도 이미 AI Operator, Agent, Decisioning, Brand Voice 성격의 기능을 빠르게 붙이고 있습니다.

확인한 공개 자료 기준:

- Braze는 `BrazeAI Operator`, `BrazeAI Agent Console`, `Decisioning Studio`를 전면에 내세우고 있습니다. Agent Console은 고객 행동/이벤트/브랜드 가이드라인을 활용해 메시지와 세그먼트, 여정 의사결정까지 지원한다고 설명합니다.  
  참고: https://www.braze.com/resources/articles/braze-ai-in-action-launch
- Braze는 Shopify partnership과 eCommerce features도 발표했습니다. 즉, Shopify 영역에서는 eCommerce integration을 강화하고 있습니다.  
  참고: https://www.braze.com/press-releases/braze-launches-new-shopify-partnership-and-ecommerce-features
- Salesforce는 Einstein Copilot for Marketers/Merchants, Einstein Personalization, Data Cloud 기반 next-best interaction을 발표했습니다. 또한 campaign brief, personalized content, brand voice aligned content를 언급합니다.  
  참고: https://investor.salesforce.com/news/news-details/2024/Salesforce-Unveils-New-Einstein-1-Marketing-and-Commerce-Innovations-to-Power-the-Complete-Customer-Journey-with-Unified-Data-and-Trusted-AI/default.aspx

따라서 외부 전략 문서에서 다음 식의 표현은 위험합니다.

- Braze AI = 제한적 추천뿐
- Salesforce Brand Voice = 0건
- Braze/Salesforce Auto-Capture = 완전 없음
- 한줄로만 AI Operator 가능

이렇게 잡으면 경쟁사를 낮춰봤다가 실제 영업/투자/고객 검토에서 바로 흔들립니다.

정확한 경쟁 관점은 이렇습니다.

> Braze와 Salesforce는 글로벌 enterprise-grade CRM/AI engagement에서 강하다. 한줄로는 이들과 정면으로 모든 기능을 복제해서 이기는 것이 아니라, 한국 자사몰 SMB/mid-market의 설치 속도, 한국 채널, 가격, 운영 자동화, 현지 compliance에서 먼저 이겨야 한다.

---

## 2. 한줄로가 이겨야 하는 전장은 “글로벌 Enterprise CRM”이 아닙니다

Braze/Salesforce를 압도한다는 말은 “모든 기업, 모든 국가, 모든 엔터프라이즈 기능에서 더 크다”가 아닙니다. 초기 SaaS가 그렇게 가면 제품이 너무 무거워집니다.

한줄로의 1차 승리 전장은 다음이어야 합니다.

> 한국 자사몰이 개발자 없이 15분 안에 고객 행동 수집을 시작하고, 1일 안에 매출 신뢰도까지 연결한 뒤, AI가 알림톡/SMS/이메일/모바일DM 캠페인을 추천해 매출 회복을 보여주는 SaaS

즉, 경쟁축은 다음입니다.

| 축 | Braze/Salesforce | 한줄로 승리 방식 |
|---|---|---|
| 고객군 | Enterprise/global | 한국 자사몰 SMB/mid-market 우선 |
| 도입 | 컨설팅/개발 리소스 필요 | self-service + preset + 진단 |
| 채널 | 글로벌 email/push/in-app 중심 | 알림톡/SMS/LMS/MMS/080/한국 동의 native |
| AI | 넓고 강하지만 복잡함 | 한국 커머스 use case에 좁고 빠르게 적용 |
| 가격 | 고가/영업 협의 | 무료 시작 + 사용량 기반 |
| 증명 | 플랫폼 가치 | 매출 회복/재구매/이탈 방지 성과 |

이 전장을 정확히 잡으면 “Braze/Salesforce보다 낫다”는 말이 과장이 아니라 특정 고객군에서는 진짜가 됩니다.

---

## 3. 최종 포지셔닝 합의안

Round 5의 방향은 살리되, 문구를 조금 더 방어 가능하게 바꿔야 합니다.

### 3.1. 추천 외부 포지셔닝

> 한줄로는 한국 자사몰을 위한 AI CRM 운영자입니다. Script 한 줄로 고객 행동 수집을 시작하고, 주문/회원/동의 데이터는 postback과 preset으로 신뢰도를 보강하며, AI가 알림톡/SMS/이메일/모바일DM 캠페인을 추천·실행·학습합니다.

### 3.2. 세일즈용 강한 문장

> Braze급 CRM 자동화를 한국 자사몰이 15분 만에 시작할 수 있게 만듭니다.

이 문장은 강하지만 비교적 안전합니다. “모든 정확도 100%”나 “사용자 행동 95%” 같은 숫자 약속보다 덜 위험하면서도 판매력이 있습니다.

### 3.3. 내부 비전 문장

> 한국 자사몰 preset, revenue-grade postback, 한국 채널 native, Brand Voice, AI Operator를 하나의 폐쇄 루프로 묶어 Braze/Salesforce가 무겁고 비싼 영역을 self-service로 낮춘다.

---

## 4. Round 5의 5 카테고리 평가와 공동 수정안

## 4.1. 카테고리 1 — 통합 속도 50~100배 압도

### GPT 평가

방향은 맞습니다. 단, `통합`을 한 단어로 쓰면 안 됩니다. 고객이 기대하는 통합 수준이 다릅니다.

통합은 3단계로 나눠야 합니다.

| 단계 | 목표 시간 | 의미 | 약속 가능성 |
|---|---:|---|---|
| Time to First Event | 5~15분 | script 설치 후 pageview/click/identify 후보 수신 | 가능 |
| Time to Useful CRM | 30~90분 | 회원/동의/장바구니/주문 후보까지 확인 | 지원 플랫폼에서 가능 |
| Time to Revenue-grade | 반나절~1일 | order postback/webhook 연결, 중복 방지, 매출 리포트 신뢰 | 현실적 |

따라서 외부 약속은 이렇게 가야 합니다.

> 15분 안에 첫 고객 행동 수집, 1일 안에 매출 신뢰도 연결

### 표준 hook 라이브러리 평가

카페24/메이크샵/고도몰/아임웹 hook library는 반드시 해야 합니다. 이것이 한줄로의 핵심 moat가 될 수 있습니다.

다만 `마크업 파싱 hook`과 `플랫폼 이벤트 hook`을 구분해야 합니다.

- 마크업 파싱 hook: 빠르지만 깨지기 쉬움
- 플랫폼 이벤트 hook: 더 안정적이지만 플랫폼별 권한/앱/스크립트 삽입 제약 필요
- 서버 postback hook: 주문/매출 신뢰도 최상

### 공동 설계안

v0.4.5에 다음을 만들면 좋습니다.

- `@hanjullo/platform-cafe24`
- `@hanjullo/platform-makeshop`
- `@hanjullo/platform-godomall`
- `@hanjullo/platform-imweb`
- `@hanjullo/platform-shopify`

각 adapter는 다음 책임을 갖습니다.

- product page 감지
- cart add 감지
- checkout start 후보 감지
- order complete 후보 감지
- platform name/version 추정
- confidence score 산정
- postback 설치 여부 확인

---

## 4.2. 카테고리 2 — 정확도 Braze 동급 100%

### GPT 평가

이 방향은 맞습니다. 단, 100% 정확도는 `명시 호출/postback 영역`에만 붙여야 합니다.

좋은 원칙입니다.

> 마케팅 발송 트리거는 명시 호출 또는 postback 기반 이벤트만 사용한다. Auto-Capture는 분석, 진단, 추천 후보, heatmap 보조로 쓴다.

이 원칙을 세우면 한줄로의 신뢰도가 올라갑니다.

### 공동 설계안

이벤트를 `trust_level`로 나눕니다.

| trust_level | 발생 방식 | 사용처 |
|---|---|---|
| `observed` | Auto-Capture DOM/URL/click | 분석, 후보, heatmap |
| `inferred` | DOM 파싱 + AI/preset confidence | 추천 후보, 검증 필요 |
| `declared` | SDK 명시 호출 | 캠페인 트리거 가능 |
| `verified` | server postback/webhook | 매출/성과/ROAS 기준 |

이 구조가 중요합니다. 그래야 “자동은 빠르게, 매출은 정확하게”가 됩니다.

### postback 의무 여부

매출 리포트, ROAS, AI 캠페인 성과 측정에는 postback이 사실상 의무입니다. 다만 onboarding 첫 화면에서 의무로 말하면 이탈합니다.

권장 UX:

1. script 설치: 15분 안에 시작
2. 자동 주문 후보 감지: “주문 감지가 시작됐습니다”
3. 매출 신뢰도 카드: “현재 매출 신뢰도 72점”
4. postback 연결 CTA: “정확한 매출 리포트와 AI 성과 측정을 위해 연결하세요”
5. 연결 후: “매출 신뢰도 99점”

---

## 4.3. 카테고리 3 — 한국 채널 native 압도

### GPT 평가

이 카테고리는 한줄로의 가장 현실적인 강점입니다. Braze/Salesforce가 한국에 진출하거나 파트너를 붙일 수는 있지만, 한국 SMB 자사몰 관점에서 아래를 제품 기본값으로 내장하는 것은 강한 차별점입니다.

- 알림톡 템플릿 검수 흐름
- 친구톡/브랜드메시지
- SMS/LMS/MMS 글자수/바이트 처리
- 080 수신거부 자동 부착
- 광고성 메시지 `(광고)` prefix
- 야간 발송 제한
- 수신동의/철회 이력
- 카카오 채널/템플릿 상태 진단
- 한국 휴대폰 번호 정규화
- 발송 실패 사유 한국어 해석

### 모바일DM 평가

모바일DM은 단순 발송 채널이면 약합니다. 하지만 `rich/canvas/AI 자동 생성/성과 회수`까지 있으면 강합니다.

정의가 중요합니다.

> 모바일DM은 이메일/SMS 대체 채널이 아니라, 행동 데이터 기반 개인화 랜딩 메시지입니다.

모바일DM이 차별점이 되려면 다음이 필요합니다.

- SDK 이벤트 기반 타겟팅
- AI가 이미지/본문/CTA 조합 생성
- Brand Voice 반영
- 클릭/전환 추적
- 알림톡/SMS/이메일과 orchestration
- 성과가 AI Operator로 회수

---

## 4.4. 카테고리 4 — AI 자율 운영 압도

### GPT 평가

AI Operator는 가야 합니다. 그러나 “Braze Sage AI 압도”라는 표현은 조심해야 합니다. 현재 Braze도 BrazeAI Operator와 Agent Console을 내세우고 있습니다. Salesforce도 Einstein Copilot/Personalization을 강화하고 있습니다.

따라서 차별점은 “AI가 있다”가 아니라 다음입니다.

> 한국 자사몰 데이터와 한국 채널 제약을 이해하는 좁고 깊은 AI Operator

### 공동 설계안: 5단계는 유지하되 증명 지표를 붙입니다

| Level | 기능 | 증명 지표 |
|---|---|---|
| 1 | AI 추천 + admin 승인 | 추천 승인율, 캠페인 생성 시간 단축 |
| 2 | holdout 자동 생성 | uplift 측정 가능 캠페인 비율 |
| 3 | 채널/시간/문안 A/B | variant별 성과 학습률 |
| 4 | bandit 제한 적용 | 매출/클릭 uplift, 실패 guardrail 작동률 |
| 5 | guardrail 내 자율 운영 | human override율, 안전 위반 0건 |

AI Operator는 기능보다 “성과를 어떻게 검증하느냐”가 중요합니다.

### 초기 제품에서는 Level 2까지가 판매 가능한 핵심

Level 5는 비전입니다. 실제 판매용 MVP에서는 Level 1~2만 제대로 되어도 충분히 강합니다.

- 매일 아침 추천
- 이유 설명
- 예상 대상 수
- 예상 비용
- 예상 매출/회복 고객 수
- holdout 자동 생성
- 승인 후 발송
- 결과 리포트

이것만 되어도 많은 SMB 자사몰에는 Braze보다 훨씬 실용적입니다.

---

## 4.5. 카테고리 5 — Brand Voice 시장 독자 카테고리

### GPT 평가

Brand Voice는 강력합니다. 다만 시장에 완전히 없는 개념은 아닙니다. Salesforce도 brand voice aligned content를 언급하고, Jasper/Copy.ai/Writer 같은 AI writing 계열도 브랜드 톤을 다룹니다.

그러나 한줄로가 이길 수 있는 지점은 분명합니다.

> 한국 CRM 발송 채널의 제약까지 반영하는 Brand Voice

일반 brand voice와 다릅니다.

- SMS 90바이트/짧은 글자수 압축
- LMS/MMS 문안 구조
- 알림톡 템플릿 검수 친화 문체
- `(광고)` prefix와 수신거부 문구 포함 후 자연스러운 문안
- 카카오 친구톡/브랜드메시지 톤
- 회사가 실제 발송한 한국어 문안 기반 학습

### 공동 설계안

Brand Voice를 AI copy 기능이 아니라 `Message Quality Layer`로 둬야 합니다.

입력:

- 회사 대표 문안
- 금칙어
- 필수어
- 브랜드 성격
- 상품군
- 고객군
- 채널별 문체 규칙

출력:

- channel-specific copy
- compliance-safe copy
- byte-length-safe copy
- CTA variant
- tone confidence
- admin edit learning

외부 문구는 `회사 톤 100% 일치`보다 다음이 좋습니다.

> 회사의 기존 문안 톤과 채널별 제약을 반영해, 승인 가능한 마케팅 문안을 빠르게 생성합니다.

---

## 5. Round 5의 부가 카테고리 평가

## 5.1. Self-service 무료 진입

강력히 동의합니다. Braze/Salesforce와 싸울 때 초기 진입 장벽을 낮추는 것은 핵심입니다.

권장 가격 구조:

- Free: 월 1만 이벤트, 1개 도메인, 기본 수집/진단
- Starter: 이벤트 증가 + SMS/알림톡 발송 연동
- Growth: AI 추천, Brand Voice, postback, 데이터 품질 대시보드
- Pro: multi-channel journey, holdout, advanced segmentation
- Enterprise: 전용 SLA, custom integration, 보안/감사

무료 플랜의 목적은 사용량 과금보다 `첫 가치 경험`입니다.

## 5.2. 한국 자사몰 preset

가장 먼저 해야 하는 moat입니다. 단순 문서가 아니라 테스트 가능한 adapter asset이어야 합니다.

필요 산출물:

- 플랫폼별 fixture HTML
- selector test
- order page scenario
- 네이버페이/카카오페이 예외 케이스
- mobile web fixture
- theme variation fixture

## 5.3. 데이터 품질 대시보드 + heartbeat

이것은 nice-to-have가 아니라 필수입니다. Auto-Capture 제품은 고객이 “수집이 되는지”를 의심합니다. 신뢰를 제품 안에서 보여줘야 합니다.

필수 카드:

- SDK 설치 상태
- 최근 이벤트 수신
- identity match rate
- consent detection rate
- order confidence
- postback 연결 상태
- duplicate rate
- PII masking count
- channel readiness
- campaign measurement readiness

---

## 6. GPT가 추가하는 6번째 압도 카테고리: Compliance & Trust Layer

Round 5의 5 카테고리에 하나를 더 추가해야 합니다.

> 카테고리 6 — 한국 개인정보/광고성 메시지/수신동의 Trust Layer

이것은 판매에서 매우 중요합니다. 대표나 마케터가 제일 무서워하는 것은 “잘못 보내서 문제 생기는 것”입니다.

한줄로가 아래를 기본 제공하면 강력한 판매 포인트가 됩니다.

- 마케팅 수신동의 ledger
- 동의 출처와 시각 기록
- 철회/수신거부 즉시 반영
- 080 수신거부 자동 삽입
- `(광고)` prefix 자동
- 야간 발송 제한
- 채널별 발송 가능 여부 계산
- 개인정보 필드 마스킹
- PII 탐지/차단 로그
- 캠페인 승인/수정 감사로그
- 민감 세그먼트 발송 guardrail

Braze/Salesforce도 compliance가 강하지만 한국 SMB 자사몰의 실무 수준에서는 한줄로가 더 쉽게 제공할 수 있습니다.

판매 문장:

> 마케터가 법을 몰라도, 한줄로가 한국 광고성 메시지 기본 안전장치를 먼저 걸어줍니다.

---

## 7. GPT가 추가하는 7번째 압도 카테고리: Proof-of-Revenue Dashboard

Braze/Salesforce급 SaaS가 되려면 기능보다 “이 툴이 돈을 벌어줬다”를 보여줘야 합니다.

따라서 데이터 품질 대시보드와 별개로 `매출 증명 대시보드`가 필요합니다.

필수 지표:

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

SMB 자사몰 대표는 Braze 기능 리스트보다 “이번 달 한줄로가 얼마 벌어줬나”를 봅니다. 이 대시보드는 판매와 retention에 직접 영향을 줍니다.

---

## 8. 최우선 진입 순서

Round 5의 5 + 부가 3 + GPT 추가 2를 모두 한 번에 만들면 안 됩니다. 제대로 된 SaaS는 순서가 중요합니다.

### 8.1. 1단계 — 신뢰 가능한 수집

목표: 고객이 “붙였더니 들어온다”를 15분 안에 봄

- CDN script
- first event
- identify 후보
- consent 후보
- pageview/click
- heartbeat
- install diagnostics

### 8.2. 2단계 — 매출 신뢰도

목표: 고객이 “매출과 연결된다”를 봄

- order candidate
- order postback
- dedup
- trust_level
- revenue readiness score

### 8.3. 3단계 — 한국 채널 실행

목표: 고객이 “실제로 캠페인을 보낸다”를 봄

- 알림톡/SMS/LMS/MMS
- 동의/수신거부 guardrail
- 기본 캠페인 template
- 장바구니/휴면/재구매 자동 추천

### 8.4. 4단계 — AI Operator

목표: 고객이 “내가 고민하지 않아도 제안이 온다”를 봄

- 매일 추천
- 1-click 승인
- holdout
- 결과 리포트

### 8.5. 5단계 — Brand Voice/모바일DM/고도화

목표: 고객이 “우리 회사답게 자동으로 운영된다”를 느낌

- Brand Voice
- 모바일DM
- advanced journeys
- channel orchestration

---

## 9. POPPON 검증 + 추가 검증 설계

POPPON은 좋은 검증 베드지만 충분하지 않습니다. Round 5가 맞습니다. synthetic test와 플랫폼 샘플몰 검증이 필요합니다.

### POPPON에서 검증할 것

- script 설치 UX
- Next.js SPA route tracking
- identify/body attribute
- product/deal page metadata
- click/scroll/session
- AI 추천 UI 흐름

### synthetic test에서 검증할 것

- event ingestion volume
- dedup
- identity merge
- segment classification
- campaign recommendation pipeline
- holdout/uplift calculation
- PII masking
- consent guardrail

### 플랫폼 샘플몰에서 검증할 것

- 카페24 상품/장바구니/주문완료
- 메이크샵 상품/장바구니/주문완료
- 고도몰 상품/장바구니/주문완료
- 아임웹 상품/장바구니/주문완료
- 모바일 웹/네이버페이/카카오페이 예외

### 실제 파일럿에서 검증할 것

최소 3개 실제 자사몰이 필요합니다.

- 패션/잡화 1개
- 식품/생활용품 1개
- B2B 또는 고관여 상품 1개

각 파일럿에서 볼 지표:

- 설치 완료 시간
- first event 시간
- postback 연결 시간
- order match rate
- campaign launch time
- 첫 캠페인 매출/전환
- 고객이 느낀 난이도

---

## 10. v0.3.5 착수 범위: 너무 작게, 그러나 팔릴 만큼

v0.3.5는 “미래의 모든 기능”이 아니라 첫 도입 마찰을 깨는 버전입니다.

### v0.3.5 필수

- CDN script build
- data attribute identify
- anonymous_id/session_id
- pageview 자동 수집
- click 자동 수집
- consent explicit attribute
- PII masking
- heartbeat
- 백오피스 script 발급
- first event 검증 화면

### v0.3.5 제외

- heatmap 전체
- full DOM capture
- AI segment 자동 분류
- 자동 발송
- 복잡한 journey builder
- native app SDK
- full platform preset

v0.3.5의 성공 기준은 단순합니다.

> 고객이 script를 붙이고 15분 안에 “데이터가 들어온다”를 확인한다.

---

## 11. v0.4.0 착수 범위: revenue-ready의 시작

v0.4.0은 Auto-Capture 본격 버전이지만, 핵심은 `trust model`입니다.

필수:

- event taxonomy
- trust_level
- confidence score
- product/order candidate parser
- postback API spec
- dedup key
- data quality dashboard MVP
- install diagnostics
- SPA support

v0.4.0의 성공 기준:

> 고객이 자동 수집과 postback의 차이를 이해하고, 매출 신뢰도를 높이기 위해 postback을 연결한다.

---

## 12. v0.4.5 착수 범위: 한국 자사몰 moat 시작

v0.4.5에서 카페24/메이크샵 preset을 앞당기는 데 동의합니다.

필수:

- Cafe24 adapter alpha
- MakeShop adapter alpha
- Commerce Korea Extension events
- fixture test suite
- synthetic traffic generator
- platform-specific install guide
- order postback recipe

성공 기준:

> 카페24/메이크샵 샘플몰에서 first event 15분, commerce useful CRM 1시간, revenue-ready 1일 안에 도달한다.

---

## 13. 가장 큰 위험 7개와 대응

| 위험 | 대응 |
|---|---|
| 경쟁사를 과소평가 | Braze/Salesforce AI 현황을 정확히 반영 |
| 95%/100% 과장 약속 | first event/useful CRM/revenue-grade로 분리 |
| DOM 파싱 불신 | trust_level + confidence + postback |
| 개인정보 사고 | PII masking + consent ledger + default value 미수집 |
| 제품 범위 폭발 | v0.3.5는 first value에 집중 |
| AI 성과 미증명 | holdout/uplift dashboard 필수 |
| 한국 플랫폼 파편화 | adapter fixture test suite 구축 |

---

## 14. Claude와 GPT의 최종 합의 문장

이 문장이 Round 6의 최종 합의라고 보면 좋겠습니다.

> 한줄로는 Braze/Salesforce를 모든 엔터프라이즈 기능에서 복제해 이기는 것이 아니라, 한국 자사몰이 가장 고통스러워하는 통합·동의·한국 채널·캠페인 운영을 self-service AI Operator로 낮춰 이긴다. Script 한 줄로 시작하고, postback으로 매출 신뢰도를 보장하며, Brand Voice와 한국 채널 guardrail을 통해 실제 매출 캠페인을 추천·실행·학습하는 SaaS가 되어야 한다.

---

## 15. Harold 결정용 요약

### 지금 바로 해야 할 것

v0.3.5 착수에 찬성합니다.

단, 목표는 “Braze 전체 복제”가 아니라 다음입니다.

1. 15분 안에 first event 확인
2. 개인정보 안전한 자동 수집
3. 백오피스 자동 검증
4. POPPON에서 실제 route/page/click/identify 검증
5. v0.4.0 postback/revenue-ready로 이어질 구조 확보

### 하지 말아야 할 것

- 처음부터 95%/100% 외부 약속
- full AI Operator 자동 발송
- 앱 SDK 동시 착수
- 모든 플랫폼 preset 동시 착수
- heatmap/session replay 대형 기능 동시 착수

### 30일 목표

- v0.3.5 출시
- POPPON first event 검증
- v0.4.0 trust_level/postback 설계 완료
- 카페24/메이크샵 샘플 fixture 수집 시작
- 데이터 품질 대시보드 MVP 설계

### 60일 목표

- v0.4.0 출시
- revenue-ready postback beta
- Cafe24/MakeShop adapter alpha
- AI 추천 Level 1 MVP
- 첫 실제 파일럿 3곳 확보

---

## 16. 마지막 의견

Claude의 Round 5는 중요한 전환입니다. 이제 Auto-Capture 기능 토론이 아니라 “판매 가능한 SaaS의 운영 루프”를 설계해야 합니다. GPT의 최종 입장은 명확합니다.

한줄로는 충분히 Braze/Salesforce와 다른 방식으로 이길 수 있습니다. 단, 이기는 방식은 더 많은 기능을 한 번에 만드는 것이 아닙니다. 한국 자사몰 고객에게 다음 순서로 가치를 증명하는 것입니다.

1. 빨리 붙는다.
2. 데이터가 안전하게 들어온다.
3. 매출 데이터는 믿을 수 있다.
4. 한국 채널로 바로 실행된다.
5. AI가 매일 할 일을 제안한다.
6. 결과가 매출로 보인다.

이 여섯 가지가 되면, 한줄로는 단순 SDK나 발송툴이 아니라 한국 자사몰 AI CRM 운영자가 됩니다.
