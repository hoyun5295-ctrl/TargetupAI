# 한줄로 — BEYOND BRAZE 비전

**문서 종류:** 살아있는 비전 문서 (체어맨 + CTO 전용, 대외 공개 X)
**버전:** v0.5 (D181 Phase 1 영구 개선 묶음 박음 — D179 UI + Anthropic Memory + Batch API + Citations)
**최종 갱신:** 2026-05-19
**체어맨:** Harold
**CTO:** 비토 (Claude Opus 4.7)
**미션:** 한줄로AI를 **글로벌 최강 마테크 기업 + 압도적 마케팅 AI Operator 솔루션**으로 박는다 — Braze + Klaviyo + Insider + Iterable + CleverTap을 모두 압도하는 단일 통합 솔루션.

---

## 0. Manifesto

> **"마케터가 자연어 한 줄을 박으면 AI Operator가 마케팅 전체를 운영한다.  
> 단, AI는 의견을 박을 뿐 실행은 항상 사용자가 동의한 후에만 이루어진다.  
> 한국 통신 인프라 native + 한국 자사몰 native + 글로벌 확장.  
> 누구도 따라하지 못하는 통합 솔루션."**

### 0-1. 영구 원칙 (절대 변경 X)

| # | 원칙 | 근거 |
|---|------|------|
| 1 | **AI 단독 실행 절대 금지** — 모든 추천/제안은 사용자 동의 후 실행 | Harold 명시 — "AI가 자기 맘대로 캠페인 실행 X / 결국 비용이 들어가는 영역" |
| 2 | **타겟 정합성 100%** — 0건 매칭 시 발송 차단 (자동완화 X) | Harold 명시 D171 — "원치 않는 고객에게 발송 = 마케팅 의도 파괴 + 수신자 권리 침해" |
| 3 | **모델 영역 절대 분리** — AI Operator(Opus 4.7) vs 기존 한줄로AI(Sonnet 4.6) | 6,000사+ 운영 영향 사고 차단 |
| 4 | **사용자 신뢰 절대** — 모델명 사용자 노출 X / 발송 시점 confirm / 비용 투명 | 6년+ 운영 신뢰 자산 보호 |
| 5 | **한국 통신/자사몰 native** — 정보통신망법 + 080 + 카카오 + 통신사 + 한국 자사몰 직접 박음 | 6년+ 한국 통신 인프라 운영 자산 |
| 6 | **미래 로드맵 사용자 노출 금지** — 직원/외부 사용자 페이지에 D-시리즈 마일스톤 + 9-Phase 로드맵 + 진행률 카드 박지 X | Harold 명시 D177-fix — "굳이 업그레이드 보여줄 필요 X / 이미 방향성 잡음 / 직원에게 노출 X" |
| 7 | **sub-module 페이지 뒤로가기 정합** — AI Operator 하위 페이지 5건 ArrowLeft = navigate('/ai-operator'). 부모-자식 계층 본질 정합 | Harold 명시 D177-ux3 — "AI 오퍼레이션 메뉴로 돌아가는게 아니라 메인페이지로 돌아간다 / 원칙에 맞도록" |

---

## 1. Braze 시장 분석 (글로벌 표준 진정 평가)

### 1-1. Braze 진정 강점 매트릭스 (정직 인정)

| 영역 | Braze 진정 가치 | 비고 |
|------|----------------|------|
| **Canvas Journey Builder** | 시각적 멀티 step 자동 여정 (가입→구매→재구매→휴면→회수) | ★★★★★ 핵심 가치 |
| **Liquid Templating** | 사용자별 동적 콘텐츠 (같은 메시지가 사용자별로 다른 콘텐츠) | ★★★★★ |
| **Real-time Personalization** | 이벤트 실시간 반응 + 컨텍스트 박음 | ★★★★★ |
| **Cross-Channel Orchestration** | Email + Push + SMS + In-app + Webhook 통합 발송 | ★★★★ |
| **Sage AI / Predictive Suite** | 클릭률/이탈 위험/구매 가능성 AI 예측 | ★★★ |
| **Connected Content** | 외부 API 동적 데이터 박음 (날씨/재고/가격 등) | ★★★ |
| **Currents** | 실시간 데이터 스트리밍 (BigQuery/Redshift 등) | ★★★ |
| **SDK 깊이** | iOS/Android/Web/React Native/Flutter | ★★★★ |

### 1-2. Braze 한계 (한국 시장 진입 0건의 본질)

| 한계 | 영향 |
|------|------|
| **글로벌 표준, 한국 통신 native X** | 카카오 알림톡 / 통신사 SMS/LMS/MMS / 정보통신망법 / 080 무료거부 / 발신번호 등록 모두 custom 박아야 함 |
| **한국 자사몰 native X** | 카페24/메이크샵/imweb/식스샵 OAuth/Webhook 직접 박지 X (Shopify 위주) |
| **가격** | $25k~$200k/년 (ENT 한정) — 한국 SMB 진입 0건 |
| **마케터 학습 곡선** | Canvas + Liquid 직접 박아야 함 — 자연어 진입 X |
| **모듈 분리 운영** | Canvas / Currents / Predictive / Sage / SDK 각각 박음 — 통합 부담 |
| **AI 자율성 한정** | Sage AI = 예측 한정 (Tool Use 기반 multi-agent X) |
| **음성 채널 X** | 인바운드 음성 / 외향 음성 AI 박음 X |
| **AI 챗봇 X** | 자사몰 In-app 챗봇 응답 박음 X (메시지 발송 한정) |

### 1-3. 담당자 의견 + 영업팀장 의견 진정 분석 (Harold 직관 정합)

| 의견 | 진정 평가 |
|------|----------|
| 담당자 "Braze는 사용자 이력 관리에 강하다" | **부분 사실** — 이력 관리는 Journey + Personalization의 수단이지 본질 X. Harold 직관(공감 못함) 정합. 진정 강점은 Canvas Journey + Liquid 박는 영역. |
| 영업팀장 "Braze 강한 사용 욕구가 푸시와 자동 팝업" | **부분 사실** — 채널의 일부일 뿐. 진정 사용 욕구는 자동 여정 + 개인화 + 트리거. Harold 직관(모르겠음) 정합. |
| 담당자 "AI Operator 많은 업체가 저렴한 금액으로 서비스 중" | **사실 정합 X** — 자연어 한 줄 → AI 통합 패키지 SaaS는 한국/글로벌 모두 거의 없음. 담당자가 본 것은 AI 콘텐츠 생성 도구(Jasper/Copy.ai) 또는 ChatGPT API wrapper 가능성 압도. |

---

## 2. 한줄로 압도 8축 차별화

| 축 | Braze | 한줄로 진정 압도 |
|----|-------|----------------|
| **1. 진입 friction** | 마케터 Canvas 직접 박음 (학습 곡선 큼) | **자연어 한 줄 → AI Operator 통합 패키지 (95% 감소)** |
| **2. Continuous Operator** | 1 Canvas = 1회성 흐름 | **사용자가 박은 목표가 매일/매주/매월 AI가 새 대상+메시지+시점 자동 제안 + 사용자 일괄 승인 흐름** |
| **3. Self-Optimizing** | A/B Test (마케터 분석) | **AI 자체 Bandit 박고 결과 분석 + 자동 정정 (단 발송은 항상 사용자 승인 흐름)** |
| **4. Multi-Goal Decisioning** | 1 Canvas = 1 목표 | **"매출 + 신규 + 휴면" 동시 박으면 AI가 충돌 없는 흐름 자동 제안 + 사용자 검토 후 진입** |
| **5. 한국 통신/자사몰 native** | 글로벌, 한국 custom 박아야 | **카카오 알림톡 + 통신사 SMS/LMS/MMS + 080 + 정보통신망법 + 카페24/메이크샵/imweb/식스샵 직접 박힘** |
| **6. 음성 채널 (인바운드)** | X | **자사몰 인바운드 음성 AI 응답 + CDP 데이터 기반 자동 답변 (D178~)** |
| **7. AI 챗봇** | X (메시지 발송만) | **자사몰 In-app AI 챗봇 + 사용자 질문 + CDP 답변 + 자율 운영 (D182~)** |
| **8. 가격 + Plan 확장** | $25k+/년 ENT 한정 | **한국 SMB 가격대 + Plan 단계 확장 (FREE→STARTER→BASIC→PRO→BUSINESS→ENT)** |

---

## 3. Continuous Agentic Operator — 한줄로 진정 핵심 (Harold 정정 정합)

### 3-1. 진정 정의 (AI 자기 맘대로 X)

| 단계 | AI 역할 | 사용자 역할 |
|------|--------|------------|
| 1. 목표 박음 | — | 자연어 한 줄 박음 ("VIP 재구매 유도 + 매출 30% 증대") |
| 2. 매일 회고 | AI가 어제까지 박힌 결과 자동 분석 + 인사이트 박음 | — |
| 3. 제안서 박음 | AI가 매일/매주 새 대상+메시지+채널+시점+비용 박은 제안서 1~5건 박음 | — |
| 4. 일괄 승인 | — | 사용자가 받은 제안서 일괄 승인 / 개별 승인 / 거부 박음 |
| 5. 발송 | AI가 사용자 승인한 캠페인만 실행 | — |
| 6. 결과 보고 | AI가 발송 결과 + ROI 분석 박음 | — |
| 7. 다음 사이클 | 다시 2단계로 (Continuous loop) | — |

### 3-2. 사전 동의 자동 실행 옵션 (ENT 한정, default OFF)

ENT 등급 + 회사 admin이 명시 ON 박을 때만 동작:
- **자동 실행 임계값:** 발송 1,000건 미만 + 비용 5만원 이하 + Compliance low risk + 광고성 X
- **위 조건 모두 만족 시에만** AI가 자동 발송 (그 외는 항상 사용자 승인 필요)
- **자동 실행 시 즉시 회사 admin에게 SMS/이메일 알림 박음** (사후 통지)
- 이 옵션 토글은 회사 admin이 언제든 OFF 박을 수 있음

### 3-3. Braze가 박지 못하는 영역

Braze Canvas Journey = 마케터가 박는 1회성. 한줄로 Continuous Operator = AI가 매일 박고 사용자가 일괄 승인. **운영 부담 95% 감소 + 사용자 통제 100% 보장**.

---

## 4. 음성 AI 진입 — 정직 분석 (Harold 효용성 의문 정합)

### 4-1. 인바운드 vs 외향 분리 정답

| 영역 | 효용성 평가 | 박을 시점 |
|------|------------|:-:|
| **인바운드 AI 음성 응답** — 자사몰 고객이 SMS/카카오 받은 후 "전화 문의" 클릭 시 AI가 CDP 데이터 기반 즉시 응답 | **압도적 가치** — 1인 사장 시간 절약 + 24시간 응답 + Braze 박지 X 영역 + 한국 SMB native | D178 Phase 1 |
| **외향 발신 음성 AI** — 한줄로 → 고객 → AI 자동 통화 | **신중 진입** — 한국 정보통신망법 광고 음성 사전 동의 필수 + 한국어 TTS 자연도 검증 + 통신사 가이드 검토 / 가치는 큼 (인간 텔러 ~1,000원 vs AI ~100원) | D195+ Phase 2 (규제 검토 후) |

### 4-2. 진입 인프라

- 한국 음성 인프라: KT/LG U+/SK 텔레콤 또는 클라우드 음성 (NCloud / Naver Clova / Twilio)
- TTS: ElevenLabs (한국어 자연도 신중 검토) / Naver Clova Voice / 자체 fine-tuning
- STT: Whisper / Naver Clova Speech
- 인바운드는 사용자가 능동 클릭하는 영역이라 동의 friction 0건 — 즉시 박을 가치 있음
- 외향은 사용자 동의 흐름 필수 — 규제 + 자연도 검토 후 박음

---

## 5. 압축 로드맵 — Harold "매일 1년처럼" 정합

### 5-1. D176~D200 압축 진입 (5년 시야를 1~2개월에 박음)

| 일자 | 영역 | 박을 핵심 |
|-----|------|----------|
| **D176** ✓ 박힘 | Continuous Operator + 사용자 동의 흐름 | AI 매일 제안서 박는 인프라 + 사용자 일괄 승인 UI + ENT 자동 실행 옵션 (default OFF) — **2026-05-19 박힘** (utils/continuous-operator.ts CT-28 + routes/ai.ts Operator CRUD + Proposals 승인/거부 + ContinuousOperatorPage + 5분 주기 worker) |
| **D177** | Self-Optimizing (Bandit A/B) | AI가 발송 결과 분석 + 메시지/시점/채널 자동 정정 + 사용자 검토 흐름 |
| **D178** | 인바운드 AI 음성 응답 | 자사몰 SMS/카카오 → 사용자 전화 클릭 → AI 응답 + CDP 데이터 기반 답변 |
| **D179** | Multi-Goal Decisioning | "매출 + 신규 + 휴면" 동시 박으면 AI가 충돌 없는 흐름 자동 제안 |
| **D180** | Email 채널 통합 | 한줄로 SDK에 Email 모듈 박음 + IMAP/SMTP 또는 SendGrid/Postmark 통합 |
| **D181~D185** | Journey Builder Lite | 가입/재구매/휴면/장바구니/생일/예약 6 표준 여정 + AI 자연어 진입 |
| **D186~D190** | Provider Adapter 구체 구현 — Shopify/메이크샵 | 글로벌 1위 + 한국 2위 진입 |
| **D191~D195** | 글로벌 확장 1차 | 영어 i18n + Shopify wrapper + WhatsApp Business API |
| **D196~D200** | AI 챗봇 (자사몰 In-app) | CDP 데이터 + Opus 4.7 + Tool Use → 자사몰 사용자 응답 자율 운영 |

### 5-2. 압축 진입 정합 — 매일 박을 핵심 1개 vs 단순 누적

매일 박는 영역의 본질 = "**Braze 또는 Klaviyo가 박지 못한 1가지 영역을 진정 압도하는 방식으로**" 박음. 단순 기능 누적 X.

---

## 6. 5년 시야 — 글로벌 최강 마테크 진정 비전

### 6-1. Phase 매트릭스

| Phase | 기간 | 영역 | 박을 KPI |
|-------|------|------|---------|
| **Phase 0** (D163~D175-A, 완료) | 2026 Q2 | AI Operator + CDP + Provider Adapter + Push/In-app | ENT 베타 1~3사 박힘 |
| **Phase 1** (D176~D200) | 2026 Q3 | Continuous Operator + 음성 인바운드 + Email + Journey + 글로벌 1차 | 한국 BUSINESS 등급 100사+ |
| **Phase 2** (D201~D300) | 2026 Q4~2027 Q1 | Decisioning Engine + 외향 음성 AI + WhatsApp + AI 챗봇 자율 | 한국 ENT 50사+ / 글로벌 진입 10사 |
| **Phase 3** (D301~) | 2027~2028 | 글로벌 확장 + 다국어 (영어/일본어/중국어) + 통합 옴니채널 | 글로벌 ENT 100사+ |
| **Phase 4** | 2028~2030 | **글로벌 최강 마테크 진정 1위** — AI 자율 운영 표준 + 음성/메시지/챗봇/Journey 통합 | 글로벌 시장 점유율 Top 3 |

### 6-2. 5년 후 진정 한줄로 (2030 비전)

> 글로벌 마케터가 "한줄로AI 박았는가?" 묻는 표준. 자연어 한 줄로 마케팅 전체를 운영하는 AI Operator가 한국에서 시작해 글로벌 표준 박은 솔루션. Braze + Klaviyo + Insider + Iterable + CleverTap이 따라하려 하나 한줄로의 통합 깊이를 못 박음. 한국어/영어/일본어/중국어 native + 통신/자사몰/Email/Push/In-app/음성/챗봇 옴니채널 + AI 자율 운영 (사용자 동의 흐름) + 한국 SMB 가격대 글로벌 진입 + 음성 AI 한국 1위 + WhatsApp Business 한국 1위.

---

## 7. 누구도 못 따라하는 진정 차별화 (왜 한줄로만 박을 수 있는가)

| 진입 장벽 | 한줄로 자산 | 경쟁사 박는 한계 |
|----------|-----------|----------------|
| **한국 통신 인프라 6년+ 운영** | QTmsg SMS + 카카오 IMC + 통신사 직접 연결 + 080 + 발신번호 자산 | 글로벌 SaaS는 한국 통신사 직접 연결 박지 X / 한국 SaaS는 AI Operator 박지 X |
| **6,000사+ 운영 데이터** | 회사별 customer_schema + 30일 history + 성공 패턴 누적 | 신규 진입자는 데이터 자산 0건 |
| **AI Operator + CDP + Provider 통합** | 단일 패키지 (CdpSettingsPage 1곳) | 글로벌 SaaS는 모듈 분리 / 신규 진입자는 통합 깊이 박지 X |
| **한국 자사몰 5종 native** | 카페24/메이크샵/imweb/식스샵/WooCommerce | 글로벌 SaaS는 Shopify 위주 |
| **Continuous Operator + 사용자 동의 흐름** | AI 자율 + 사용자 신뢰 둘 다 박음 | 글로벌 SaaS는 자동화 vs 통제 박지 X |
| **음성 채널 (한국 native)** | 한국 통신 인프라 위 음성 AI 진정 가치 | Braze/Klaviyo는 음성 채널 X |
| **모델 영역 분리 + 영구 원칙** | 6,000사+ 운영 영향 사고 차단 인프라 | 신규 진입자는 운영 사고 누적 위험 |

---

## 8. KPI + 검증 지표 (Phase별)

### 8-1. Phase 1 (D176~D200) KPI

| 영역 | 목표 |
|------|:-:|
| ENT 베타 진입사 | 1~3사 → 10사+ |
| Continuous Operator 사용 회사 | 5사+ |
| 인바운드 음성 AI 호출 건수 | 일 100건+ |
| 자동 실행 옵션(ENT 한정) 활성 회사 | 1~2사 |
| Prompt Cache 히트율 | 60%+ |
| Compliance high risk 차단 | 0건 |
| Zero-Count 차단 정확도 (false positive 0건 + 진정 차단 100%) | 100% |

### 8-2. 5년 시야 KPI (Phase 4)

| 영역 | 목표 (2030) |
|------|:-:|
| 글로벌 ENT 진입사 | 100사+ |
| 한국 시장 점유율 (마테크 SaaS) | Top 1 |
| 글로벌 시장 점유율 | Top 3 |
| AI Operator 일일 처리 자연어 입력 | 10만건+ |
| 누적 발송 건수 | 1조건+ |

---

## 9. 진정 원칙 (영구) — 비전 + 운영 + 사용자 신뢰

1. AI는 **의견을 박을 뿐**, 실행은 항상 사용자 동의 후
2. 타겟 매칭 0건이면 발송 차단
3. 사용자 신뢰 절대 — 모델명/내부 구조 사용자 노출 X / 발송 시점 confirm / 비용 투명
4. 한국 통신 영구 native — 정보통신망법 + 통신사 + 카카오 + 080 직접 박힘
5. 모델 분리 절대 — AI Operator(Opus 4.7) vs 기존 한줄로AI(Sonnet 4.6) 영구
6. 회사별 메모리 + 학습 — 시간 지날수록 정확도↑
7. 글로벌 확장 시에도 한국 자산 + 영구 원칙 유지 (다국어는 layer, 본질 변경 X)

---

## 10. 체어맨 + CTO 협업 원칙

| 영역 | Harold (체어맨) | 비토 (CTO) |
|------|---------------|-----------|
| 비전 + 시장 + 사용자 통찰 | ★★★★★ | (협업) |
| 기획 + 의사 결정 + 영구 원칙 | ★★★★★ | (제안 + 토론) |
| 시스템 아키텍처 + 개발 + 코드 품질 | (검증) | ★★★★★ |
| 운영 + 배포 + 인프라 | ★★★★★ (직접 진행) | (보조) |
| 살아있는 문서 + 메모리 + 영구 원칙 박음 | (검증) | ★★★★★ |
| 의사 결정 후 압축 진입 | (방향 박음) | ★★★★★ (실행) |

---

## 11. 변경 이력 (살아있는 문서, 체어맨 + CTO 지속 갱신)

| 버전 | 일자 | 영역 | 내용 |
|------|------|------|------|
| **v0.1** | 2026-05-19 (D175-B) | 비전 신설 | Manifesto + 영구 원칙 5건 + Braze 압도 8축 + Continuous Operator(사용자 동의 흐름) + 음성 AI 정직 분석 + 압축 로드맵 D176~D200 + 5년 시야 + KPI |
| **v0.2** | 2026-05-19 (D176) | Continuous Operator 박힘 | 비전 § 3 박힌 Continuous Agentic Operator 본격 구현 — utils/continuous-operator.ts CT-28 + DB 2 테이블 + routes/ai.ts Operator CRUD + Proposals 승인/거부 + ContinuousOperatorPage + 5분 주기 worker scheduler. **AI 단독 실행 X 영구 원칙 100% 정합** — 모든 제안서는 사용자 승인 후 발송 (ENT 자동 실행 default OFF + 1,000건/5만원/low risk/비광고 임계값) |
| **v0.3** | 2026-05-19 (D177) | 사용자 노출 영역 정리 + 영구 원칙 #6 + #7 박음 + 운영 DB 종결 | (D177-fix) AiOperatorPage SESSION_MILESTONES + 진행률 카드 + 9-Phase 로드맵 영구 제거. (D177-ux/ux2) DashboardHeader dropdown 박힘 → 영구 제거 + AiOperatorPage 안 SUB_MODULE_CARDS 5건 박음(함께 사용하는 AI 영역 섹션). (D177-ux3) sub-module 페이지 뒤로가기 5건 navigate('/ai-operator') 일괄 정정. **영구 원칙 #6 미래 로드맵 노출 X + #7 sub-module 뒤로가기 정합 박음.** **운영 DB schema 17건 박힘 종결** (11 테이블 + 6 companies + 2 plans 컬럼). |
| **v0.5** | 2026-05-19 (D181 Phase 1 영구 개선 묶음) | CTO 추천 박음 종결 — AI 영역 영구 핵심 박음 | **D179 Multi-Goal Frontend UI 박음** — ContinuousOperatorPage 다중 목표 modal + analyze + sub_plans + conflict_matrix + recommended_order UI 박음. **Anthropic Memory 패턴 박음 (영구 원칙 #6 본질)** — utils/company-memory.ts CT-37 + DB ai_company_memory + 5 메모리 타입 + ai-orchestrator buildMemoryPromptContext 박음 + 회사 admin endpoint. "시간 지날수록 정확도↑" 본질 박음. **Anthropic Batch API 박음** — utils/batch-ai.ts CT-38 + DB ai_batch_jobs + Anthropic native submitBatch/pollBatch/getBatchResults. **대량 발송 50% 비용 절감** (Continuous Operator 박은 영역에서 박음). **Anthropic Citations 박음** — utils/citations.ts CT-39 + buildCompanyDocuments(4 document 박음) + callAIWithCitations + /operator/explain endpoint. **사용자 신뢰 #4 본질 박음** ("AI가 박은 근거 박음" — 회사 데이터 출처 박음, 추측 X). 영구 원칙 정합 100% (모델 분리 Opus 4.7 영역, Sonnet 4.6 흐름 영향 0건). **CTO 의견: AI 영역 영구 본질 박힘 — 다음 박을 영역 = D181~D185 Journey Builder Lite 운영 데이터 1주+ 박힌 후 박음** |
| **v0.4** | 2026-05-19 (D178~D180 압축 진입) | Harold "한번에 싹 다 원칙에 맞게" 명시 정합 | **자사몰 영역 정정** — 카페24 후순위, 자체 호스팅 자사몰 + 네이버 스마트스토어 우선 박음 (Harold 명시 — "지들이 보유한 서버에서 자사몰 위주" + "네이버스토어를 자사몰처럼 쓰는 회사들 많음"). **압축 로드맵 D177~D180 한번에 박음** — (Track A-1) 자체 호스팅 자사몰 customSelfHostedAdapter CT-29 + HMAC-SHA256 검증 + webhook_secret 발급 흐름 + Node.js 코드 샘플. (Track A-2) 네이버 스마트스토어 CT-30 + Naver Commerce API OAuth + Webhook + cafe24 미러 패턴. (D177) Self-Optimizing Bandit CT-31 Thompson Sampling + operator_proposal_variants + cold start explore + operator 누적 학습. (D178) 인바운드 음성 AI CT-32 Naver Clova STT/TTS + CT-33 voice-inbound + voice_inbound_calls + companies ALTER voice_inbound_enabled + Opus 4.7 응답 + 트랜스크립트 사후 확인. (D179) Multi-Goal Decisioning CT-34 + Opus 4.7 충돌 분석 + sub_plans + conflict_matrix + 가중치 자동 정규화. (D180) Email CT-35 SendGrid native fetch + CT-36 email-channel + email_campaigns/email_events + 광고성 (광고) prefix + 무료거부 자동 박음 + 1,000건 batch. **AiOperatorPage SUB_MODULE_CARDS 5→7건** (음성 AI + Email 추가). **영구 원칙 7건 정합 100%** — AI 단독 실행 X / Zero-Count / 모델 분리(Opus 4.7 영역, Sonnet 4.6 흐름 영향 0건) / 사용자 신뢰 / 한국 native(Clova + 네이버 + 자체 호스팅) / 미래 로드맵 노출 X / sub-module 뒤로가기 navigate('/ai-operator'). |

---

## 12. 진정 비전 한 줄 (Manifesto 응축)

> **"자연어 한 줄을 박으면 AI가 마케팅 전체를 운영한다.  
> AI는 박지 못한다, 사용자가 박는다.  
> 한국에서 시작해 글로벌 최강 마테크 진정 1위를 박는다.  
> 한줄로 — Where AI proposes, humans approve."**

---

> **본 문서는 살아있는 비전입니다.** 한줄로AI가 박는 모든 방향 + 영구 원칙 + 도전 영역이 본 문서에서 박힙니다. 신규 영역 추가 시 § 11 변경 이력에 row 박혀 진행 추적됩니다. 대외 공개판은 본 문서 기반으로 공개 가능 범위만 발췌하여 별도 박습니다.

— Harold (체어맨) + 비토 (CTO)
