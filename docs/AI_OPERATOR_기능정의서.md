# 한줄로 AI Operator — 기능 정의서

**서비스명:** 한줄로 (TargetUp) AI Operator
**버전:** v1.0.5 (D170~D176 누적)
**최종 갱신일:** 2026-05-19
**대상:** ENTERPRISE / BUSINESS 베타 운영
**도메인:** hanjul.ai (서비스), app.hanjul.ai (고객사 관리자), sys.hanjullo.com (슈퍼관리자)
**작성자:** Hanjullo CTO (AI 협업)

---

## 1. 개요

한줄로 AI Operator는 한국 SMS/LMS/MMS/카카오 마케팅 자동화 SaaS 한줄로(TargetUp)의 핵심 진입점입니다. 사용자가 자연어 한 줄(예: "VIP 재구매 유도")을 입력하면 Opus 4.7 Orchestrator AI + 6 Sub-agent가 협업하여 **타겟 추출 + 메시지 3안 + 채널 의사결정 + 발송 시점 + 비용/성과 추정 + 정책 검수 + 발송 흐름**을 한 패키지로 자동 박는 시스템입니다.

### 1-1. 진정 차별화 (Braze / Klaviyo / Insider 대비)

| 영역 | Braze (글로벌 표준) | 한줄로 AI Operator |
|------|-------------------|------------------|
| 진입 friction | 마케터가 Canvas + Liquid 직접 박음 | **자연어 한 줄 → AI가 통합 패키지 박음** |
| 한국 통신 정합 | 글로벌, 한국 통신사/카카오/080 custom 박아야 함 | **한국 native (통신사 + 알림톡 + 정보통신망법 + 무료거부)** |
| AI 모델 | Sage AI (예측) | **Opus 4.7 Orchestrator + Tool Use** |
| 가격 | $25k+/년 (ENT 타겟) | **한국 SMB 가격대** |
| 통합 영역 | Journey / Personalization / 채널 / Predictive 모듈 분리 | **자연어 한 줄로 통합 패키지** |

---

## 2. 시스템 아키텍처

### 2-1. 진정 Orchestrator AI (D171-D) — Tool Use 기반 multi-agent loop

```
사용자 자연어 입력 ("VIP 재구매 유도")
        │
        ▼
┌─────────────────────────────────────┐
│  Opus 4.7 Orchestrator AI           │
│  (orchestrateWithAI)                │
│  - system 프롬프트 (회사 메모리 + 영구 원칙 강제) │
│  - max_iterations 8                 │
│  - per-tool max 2 호출              │
│  - 실패 시 orchestrate() fallback   │
└─────────────────────────────────────┘
        │ Tool Use API (Anthropic 표준)
        ├──────────────┬──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
   target_analysis  count_verification  message_composition  compliance_check  (cost_roi 산술)
   (Opus 4.7)       (DB 실측, AI X)     (Opus 4.7)           (Opus 4.7)        (산술)
        │              │                  │                    │                 │
        └──────────────┴──────────────────┴────────────────────┴─────────────────┘
                                          │
                                          ▼
                              ┌──────────────────────┐
                              │  OrchestratorResult  │
                              │  통합 제안서          │
                              └──────────────────────┘
                                          │
                                          ▼
                       사용자 검토 + 승인 + 발송 시점 결정
                                          │
                                          ▼
                         /direct-send 2-step (검증된 흐름 재사용)
```

### 2-2. 환경 변수 토글

| 환경 변수 | 기본값 | 동작 |
|----------|:-:|------|
| `AI_OPERATOR_USE_AI_DECISION` | false | true 시 진정 `orchestrateWithAI` 진입, false 시 기존 `orchestrate` 순차 호출 (안전 default) |

운영 진입 시 ENT 베타 회사 한정 toggle, 안정성 검증 후 전체 확장.

---

## 3. AI 모델 정합 (절대 분리 룰)

### 3-1. 모델 분리 매트릭스 (Harold 영구 원칙)

| 영역 | Claude 모델 | GPT fallback | temperature |
|------|------------|--------------|------------|
| **AI Operator 신메뉴** (Target/Message/Compliance/Orchestrator AI/Next Action) | **Opus 4.7** (`claude-opus-4-7`) | **GPT 5.5** (`gpt-5.5`) | 박지 X (둘 다 default 1만 지원) |
| **기존 한줄로AI** (refine/generate/recommend-target/parse-briefing/recommendNextCampaign) | **Sonnet 4.6** (`claude-sonnet-4-6`) | **gpt-5.4-mini** | 그대로 박음 |

### 3-2. Opus 4.7 Breaking Changes 정합

- `temperature` / `top_p` / `top_k` 박으면 400 error → Opus 호출 시 박지 X
- `thinking.type: 'enabled' + budget_tokens` 박으면 400 → `adaptive` 박음
- Adaptive thinking은 off by default

### 3-3. Prompt Caching (D167)

- system 블록을 `cache_control: 'ephemeral'`로 박음
- 회사별 시스템 프롬프트 (브랜드 톤 + 30일 history + 고객 DB 스키마) 1h TTL 캐싱
- 동일 시스템 재호출 시 90% 비용 절감 + latency 1/3

---

## 4. 6 Sub-agent 상세

### 4-1. Target Analysis Sub-agent

| 항목 | 내용 |
|------|------|
| 함수 | `recommendTarget` (services/ai.ts) |
| 모델 | Opus 4.7 (AI Operator), Sonnet 4.6 (기존 흐름) |
| 입력 | 자연어 objective + 회사 customer_schema + 고객 통계 |
| 출력 | filters (JSON) + recommended_channel + is_ad + personalization_vars + reasoning + suggested_campaign_name |
| 영구 원칙 | 0건 매칭 시 자동완화 절대 금지 |

### 4-2. Count Verification Sub-agent (D168)

| 항목 | 내용 |
|------|------|
| 함수 | `countFilteredCustomers` (services/ai.ts) |
| AI 호출 | X (DB SQL 직접) |
| 동작 | Target 결과 filters로 customers 테이블 실제 매칭 수 + 수신거부 수 반환 |
| 영구 원칙 | 0건 시 발송 차단 (Harold 명시 D171) |

### 4-3. Message Composition Sub-agent

| 항목 | 내용 |
|------|------|
| 함수 | `generateMessages` (services/ai.ts) |
| 모델 | Opus 4.7 (AI Operator), Sonnet 4.6 (기존) |
| 입력 | 자연어 objective + 회사 정보 + 타겟 통계 + 채널 + 광고 여부 |
| 출력 | A/B/C 메시지 3안 + recommendation (베스트) + 사유 |
| 정합 | byte_count (KSX-1001) + byte_warning (SMS 한도) |

### 4-4. Compliance Check Sub-agent (D170)

| 항목 | 내용 |
|------|------|
| 함수 | `checkCompliance` (services/ai-orchestrator.ts) |
| 모델 | Opus 4.7 |
| 검수 기준 | 정보통신망법 + 카카오 정책 + 통신사 스팸 정책 |
| 출력 | passed (boolean) + riskLevel (low/medium/high) + warnings + suggestions |
| UI 정합 | 모델명 사용자 노출 X (통과/경고만 표시) |

### 4-5. Cost-ROI Sub-agent

| 항목 | 내용 |
|------|------|
| 함수 | `calculateCostROI` (services/ai-orchestrator.ts) |
| AI 호출 | X (산술) |
| 입력 | 매칭 count + 채널 + 회사별 단가 + 평균 객단가 |
| 출력 | 추정 비용 + 클릭률/전환율/매출 추정 |

### 4-6. (Schedule Optimization은 Target Sub-agent의 recommended_time에 통합 박힘)

---

## 5. 핵심 기능

### 5-1. AI Operator 통합 제안서 (D164~D170)

| 흐름 | endpoint | 모델 |
|------|---------|:-:|
| 자연어 입력 → 통합 제안서 | `POST /api/ai/operator/propose` | Opus 4.7 |
| 통합 제안서 → 수신자 미리보기 | `POST /api/ai/operator/preview-recipients` | (DB) |
| 미리보기 → 발송 | `POST /api/campaigns/direct-send` (검증된 기존 흐름) | (DB + MySQL) |

### 5-2. 발송 시점 안전장치 (D170+ Harold 명시)

| sendMode | 동작 | 안전장치 |
|---------|------|---------|
| `aiRecommended` | AI 추천 시점 자동 예약 | 미래 시점 시 예약, 과거 시점이면 즉시 + confirm 모달 |
| `immediate` | 즉시 발송 | confirm 모달 필수 |
| `custom` | 사용자 직접 지정 | datetime input + 미래 1분+ / 08:00~21:00 KST 검증 |

### 5-3. Step 1 — 성과 리포트 + Next Action Advisor (D174)

| 흐름 | endpoint | 모델 |
|------|---------|:-:|
| 30일 성과 + AI 다음 캠페인 추천 | `POST /api/ai/operator/next-action` | Opus 4.7 |
| PerformancePage → AI Operator | sessionStorage `ai_operator_prefill_objective` | (FE) |

성과 매트릭스: 캠페인 수 / 성공률 / 채널별 / 시간대별 / CDP 매출(자사몰 연동 시) / 신규+활성 고객 / Opus 4.7 통합 추천.

---

## 6. 영구 원칙 (Harold 명시 절대 룰)

### 6-1. 타겟 자동완화 절대 금지 (D171)

- 타겟 매칭 0건 시 자동완화(relaxFilters / auto-relax) 절대 금지 — **발송 차단이 정합**
- 사유: AI가 임의로 조건 풀어서 다른 고객에게 발송 = 마케팅 의도 파괴 + 정보통신망법 위험 + 수신자 권리 침해 + 발신번호 차단 위험
- 정합: 0건 응답 시 "조건을 조정해주세요" 안내만, AI 재추천 X
- 박힌 위치: orchestrate / orchestrateWithAI / recommendNextAction system 프롬프트 + count_verification tool 결과에 warning 박음

### 6-2. AI 단독 발송 X (모든 추천 검토 + 승인 필수)

- AI Operator + Next Action Advisor 모두 추천만 박음
- 발송은 사용자가 검토 + 승인 후 `/direct-send` 호출
- 자동발송(auto-campaigns)도 사용자가 미리 등록한 조건 + 시점에만 발화

### 6-3. AI 모델 영역 절대 분리 (6,000사+ 영향 사고 차단)

- AI Operator = Opus 4.7 / GPT 5.5 fallback
- 기존 한줄로AI = Sonnet 4.6 / gpt-5.4-mini fallback (절대 변경 X)
- 결정 위치: `packages/backend/src/config/defaults.ts` `AI_MODELS`

### 6-4. UI 모델명 노출 금지

- Compliance Check 카드에 "HAIKU 4.5" / "Opus 4.7" 박지 X (사용자에게 모델명 노출 시 비교 + 불신 + 모델 변경 시 사용자 영향)
- 통과/경고/위험만 표시

### 6-5. 미래 로드맵/마일스톤 사용자 노출 금지 (D177-fix Harold 명시 영구 원칙)

- AiOperatorPage / DashboardPage 등 사용자 페이지에 D-시리즈 마일스톤 + 9-Phase 로드맵 + 진행률 카드 박지 X
- 직원/외부 노출 시 영업/보안/사용자 혼란 위험 (예: "곧 출시" 약속 = 미이행 시 신뢰 파괴 / 경쟁사 노출 = 차별화 자산 유출)
- 이미 박힌 기능만 사용자에게 표시 / 미래 로드맵은 비전 문서(`docs/한줄로_BEYOND_BRAZE_비전.md`, 체어맨+CTO 전용) 박음

---

## 7. 데이터 인프라 — 한줄로 CDP (D172)

### 7-1. CDP 표준 endpoint (4종 외부 + 3종 운영)

| Endpoint | 용도 |
|----------|------|
| `POST /api/cdp/identify` | 회원 식별/upsert (Identity Resolution: source+external_id → email → phone → 신규) |
| `POST /api/cdp/event` | 행동 이벤트 (page_view/cart_add/purchase 등 11 표준 + custom_*) |
| `POST /api/cdp/order` | 주문 sync + customers RFM 자동 갱신 |
| `POST /api/cdp/bulk-import` | 초기 마이그레이션 (최대 1,000건/요청) |
| `GET /api/cdp/usage` | 이번 달 API 호출 누적 + plan 한도 |
| `GET /api/cdp/recent-events` | 최근 이벤트 50건 (디버깅) |
| `POST /api/cdp/issue-key` | public/secret key 발급 (raw 1회 노출) |

### 7-2. 인증

- 헤더: `X-Hanjullo-Key` (public, `hjl_` 접두사) + `X-Hanjullo-Secret` (raw, `sk_` 접두사)
- DB: `companies.cdp_api_key` (public) + `companies.cdp_api_secret_hash` (bcrypt)
- **기존 `companies.api_key` (싱크에이전트 인증)와 영역 분리**

### 7-3. 요금제 게이팅 (`ai_cdp` feature)

| 요금제 | cdp_enabled | cdp_events_per_month |
|--------|:-:|:-:|
| BASIC | false | 10,000 (잠금) |
| PRO | false | 100,000 (잠금) |
| BUSINESS | **true** | 1,000,000 |
| ENTERPRISE | **true** | NULL (무제한) |

### 7-4. JavaScript SDK (`@hanjullo/sdk` v0.1.0)

```typescript
import { HanjulloSDK } from '@hanjullo/sdk';
const hanjullo = new HanjulloSDK({ apiKey: 'hjl_...', secret: 'sk_...' });
await hanjullo.identify({ externalId, email, phone, name });
await hanjullo.track({ eventName: 'cart_add', externalId, properties: { product_id: 'P001' } });
await hanjullo.order({ orderId, externalId, status: 'completed', totalAmount, orderedAt });
await hanjullo.bulkImport({ customers: [...], orders: [...] });
```

- 브라우저 + Node.js 양쪽 호환 (fetch 표준)
- retry exponential backoff (2회 default)
- ESM + CJS + .d.ts 3형식 빌드

---

## 8. 자사몰 통합 매트릭스 — Provider Adapter (D173)

### 8-1. IProviderAdapter 인터페이스 (CT-24)

```typescript
interface IProviderAdapter {
  readonly provider: string;        // 'cafe24' / 'shopify' / 'makeshop' 등
  readonly displayName: string;
  readonly capabilities: { oauth, webhook, webhookSignatureVerification, adminApi };
  buildAuthorizeUrl(mallId, state, scope?): string;
  exchangeCode(mallId, code): Promise<ProviderTokenResponse>;
  refreshToken(integration): Promise<ProviderTokenResponse>;
  verifyWebhookSignature(rawBody, signature, secret): boolean;
  processWebhookEvent(companyId, event, resource): Promise<void>;
  extractMallIdFromWebhook(headers, body): string | null;
  extractEventFromWebhook(headers, body): string | null;
  buildIdempotencyKey(event, resource, body): string;
}
```

### 8-2. 자사몰 wrapper 매트릭스

| Provider | 상태 | 박힘 위치 | 진입 friction |
|---------|:-:|----------|---|
| **cafe24** | ✓ 사용 가능 | `utils/cafe24-client.ts` cafe24Adapter | OAuth 1회 (코딩 0건) |
| Shopify | ⏸ 곧 출시 | skeleton 박힘 (Phase 2) | (SDK direct 호출 가능) |
| 메이크샵 | ⏸ 곧 출시 | skeleton (Phase 2) | (SDK direct 호출 가능) |
| imweb | ⏸ 곧 출시 | skeleton (Phase 2) | (SDK direct 호출 가능) |
| 식스샵 | ⏸ 곧 출시 | skeleton (Phase 2) | (SDK direct 호출 가능) |
| WooCommerce | ⏸ 곧 출시 | skeleton (Phase 2) | (SDK direct 호출 가능) |
| **자체구축** (Next.js/Node/Django/PHP) | ✓ 즉시 가능 | wrapper 불요 | SDK 또는 raw API 직접 호출 |

### 8-3. 카페24 통합 (D172-B 박힘)

- OAuth 흐름: `GET /api/cafe24/oauth/authorize` → 카페24 → `GET /api/cafe24/oauth/callback`
- Webhook 수신: `POST /api/cafe24/webhook` (HMAC-SHA256 서명 검증 + idempotency_key 중복 차단)
- 표준 이벤트: `customer.created/updated` → identifyCustomer / `order.created/updated` → syncOrder / `order.cancelled/refunded` → custom_order_cancelled 이벤트
- access_token TTL 2h / refresh_token TTL 14d / 5분 마진 자동 갱신

---

## 9. 베타 게이팅 정책

### 9-1. 진입 게이팅 매트릭스

| 등급 | AI Operator 메뉴 | `POST /api/ai/operator/*` | CDP API | BetaFeatureModal |
|------|:-:|:-:|:-:|:-:|
| ENTERPRISE | ✓ | ✓ 200 OK | ✓ 무제한 | — |
| BUSINESS | ✓ | ✓ 200 OK | ✓ 1M/월 | — |
| PRO | ✓ (메뉴만) | ✗ 403 `BETA_GATE` | ✗ 잠금 | ✓ 표시 |
| BASIC | ✓ (메뉴만) | ✗ 403 `BETA_GATE` | ✗ 잠금 | ✓ 표시 |
| STARTER | ✓ (메뉴만) | ✗ 403 `BETA_GATE` | ✗ 잠금 | ✓ 표시 |
| TRIAL/FREE | ✓ (메뉴만) | ✗ 403 `BETA_GATE` | ✗ 잠금 | ✓ 표시 |

### 9-2. 베타 운영 진입 가이드 (D171-C)

1. ENT/BUS 베타 회사 1~3사 대상 사전 안내 (실 발송 청구 + AI 추천 흐름 + 발송 시점 안전장치 + 0건 차단 정책 인지)
2. PM2 로그 모니터링: `pm2 logs targetup-backend --lines 200 | grep -E "Orchestrator|AI Operator|Compliance|CDP|NextActionAdvisor"`
3. Orchestrator AI 사용 시 `meta.aiDecisionTrace[]` (iteration/tool/inputSummary/durationMs) 박힌 로그 분석
4. 사고 발견 시 Harold 신고 → root cause 분석 → 통합 fix → 재배포
5. 4주 무사고 + Prompt cache hit 60%+ + Compliance high risk 차단 0건 + 자동완화 정합성 검증 시 PRO 확장

---

## 10. API 인터페이스 매트릭스

### 10-1. AI Operator (BUSINESS+)

| Method | Path | 용도 |
|--------|------|------|
| POST | `/api/ai/operator/propose` | 자연어 → 통합 제안서 |
| POST | `/api/ai/operator/preview-recipients` | 제안서 → 발송 수신자 미리보기 |
| POST | `/api/ai/operator/next-action` | 30일 성과 → AI 다음 캠페인 추천 |

### 10-2. CDP (BUSINESS+)

위 7-1 참조.

### 10-3. 카페24 OAuth (BUSINESS+)

| Method | Path | 용도 |
|--------|------|------|
| GET | `/api/cafe24/oauth/authorize?mall_id=` | OAuth authorize URL 생성 |
| GET | `/api/cafe24/oauth/callback` | OAuth callback (카페24 → 한줄로) |
| GET | `/api/cafe24/status` | 연동 상태 조회 |
| DELETE | `/api/cafe24/disconnect` | 연동 해제 |
| POST | `/api/cafe24/webhook` | 카페24 표준 webhook 수신 |

---

## 11. 로드맵 (Step 1~3, D175~D230)

| Step | 범위 | 박을 시점 |
|------|------|----------|
| **Step 0 (D163~D175-A)** | AI Operator + CDP + Provider Adapter + Next Action + **Web Push + In-app Message** | ✓ 완료 |
| **Step 1 후반 (D175-B~D180)** | Web Push 자동 트리거 (CDP 이벤트 기반 자동 발송) + In-app 추가 트리거(cart_add 등 활성화) | 사용 검증 후 |
| **Step 2 (D181~D200)** | Journey Builder Lite — 가입/재구매/휴면/장바구니/생일/예약 자동 여정 (AI 자연어 진입) | CDP 이벤트 + Step 1 데이터 확보 후 |
| **Step 3 (D201~D230)** | Decisioning Engine — 고객별 채널/시점/오퍼 AI 자동 결정 (반응 점수 + 채널 선호도 + 빈도 제한 + 홀드아웃) | Step 2 박힌 후 |
| **Phase 2 (시장 우선순위)** | Shopify/메이크샵/imweb/식스샵 wrapper 구체 구현 | ENT 베타 후보사 자사몰 종류에 따라 |

---

## 12. 환경 변수 매트릭스

| 변수 | 용도 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API (Sonnet 4.6 + Opus 4.7 호출) |
| `OPENAI_API_KEY` | GPT fallback (gpt-5.4-mini + gpt-5.5) |
| `AI_OPERATOR_USE_AI_DECISION` | true 시 진정 Orchestrator AI Tool Use 진입 (default false) |
| `CAFE24_CLIENT_ID` | 카페24 App client_id |
| `CAFE24_CLIENT_SECRET` | 카페24 App client_secret |
| `CAFE24_REDIRECT_URI` | 카페24 OAuth callback URL |

---

## 13. 변경 이력

| 버전 | 일자 | 영역 | 내용 |
|------|------|------|------|
| v0.1 | 2026-05-19 (D163) | 인프라 | 베타 안내 시스템 (헤더 메뉴 + BetaFeatureModal + isBetaAccessAllowed + /ai-operator 라우트 + placeholder) |
| v0.2 | 2026-05-19 (D164) | Backend | `POST /api/ai/operator/propose` endpoint + Hero/Pipeline/Result 6 카드 |
| v0.3 | 2026-05-19 (D165) | Frontend | 결과 카드 정합 (메시지 3안 토글 + 다듬기 + 성과 차트 + 비용 breakdown) |
| v0.4 | 2026-05-19 (D166) | Frontend | 승인 → 발송 + 발송 시점 안전장치 (sendMode 3분기 + datetime input + confirm) |
| v0.5 | 2026-05-19 (D167) | Backend | Prompt Caching (cache_control ephemeral, 90% 비용 절감) |
| v0.6 | 2026-05-19 (D168) | Backend | Tool Use SQL Loop 정신 (countFilteredCustomers — AI 추정 → DB 실측) |
| v0.7 | 2026-05-19 (D169) | Backend | Extended Thinking (Opus 4.7 adaptive 호환) |
| v0.8 | 2026-05-19 (D170) | Backend | Multi-Agent Orchestrator (ai-orchestrator.ts 신설 + 6 Sub-agent + 회사별 메모리 + Compliance UI) |
| v0.9 | 2026-05-19 (D170+) | 룰 | Harold 명시 fix 누적 (모델 분리 + Opus 4.7 breaking changes + GPT 5.5 + UI 모델명 제거 + 발송 시점 안전장치) |
| **v1.0.0** | 2026-05-19 (D171) | Frontend/Backend/메모리 | SESSION_MILESTONES + ENT 베타 운영 진입 가이드 + **Zero-Count Auto-Relax 영구 제거** + **진정 Orchestrator AI Tool Use** |
| v1.0.1 | 2026-05-19 (D172) | Backend/Frontend/SDK | 한줄로 CDP — utils CT 5(cdp-auth/cdp-identity/cdp-events/cdp-orders/cafe24-client) + routes/cdp + routes/cafe24 OAuth/Webhook + `@hanjullo/sdk` 패키지 + CdpSettingsPage |
| v1.0.2 | 2026-05-19 (D173) | Backend/Frontend | Provider Adapter 일반화 (CT-24) + cafe24Adapter + skeleton 5종 + Provider 매트릭스 UI |
| v1.0.3 | 2026-05-19 (D174) | Backend/Frontend | Step 1 Next Action Advisor (CT-25 Opus 4.7) + PerformancePage + 성과리포트 메뉴 + AiOperator prefill |
| **v1.0.4** | 2026-05-19 (D175-A) | Backend/Frontend/SDK | **Web Push + In-app Message 채널** — DB 4 신규 테이블(cdp_push_subscriptions + cdp_push_campaigns + cdp_inapp_messages + cdp_inapp_impressions) + utils CT-26 web-push(VAPID + sendNotification + 410/404 자동 expire) + CT-27 inapp-message(CRUD + active 매칭 + frequency 제어 + 트래킹) + routes/cdp.ts push+inapp endpoint 9건 + SDK `@hanjullo/sdk` v0.2.0 (push 모듈 + inapp 모듈 + service-worker.ts) + PushCampaignsPage + InAppMessagesPage + DashboardHeader 메뉴 2건 (회사 admin only). VAPID 환경변수 3건 + `web-push` 패키지 의존성 추가 |
| **v1.0.5** | 2026-05-19 (D176) | Backend/Frontend | **Continuous Agentic Operator — 사용자 동의 흐름** (BEYOND BRAZE 비전 압축 로드맵 1순위) — DB 2 신규 테이블(continuous_operators + operator_proposals) + companies ALTER 3 컬럼 (cdp_auto_execute_enabled/max_recipients/max_cost_krw) + utils CT-28 continuous-operator(createOperator/listOperators/updateOperator/archiveOperator/generateProposalForOperator + Zero-Count 영구 원칙 정합 0건 시 제안서 박지 X + ENT 자동 실행 임계값 체크 + 7일 후 자동 만료 + 5분 주기 worker scheduler) + routes/ai.ts Operator CRUD 4 endpoint + run-now + Proposals 3 endpoint(목록/승인/거부) + ContinuousOperatorPage(2 탭 대기 제안서/영구 운영 목록 + 신규 모달 + 상세 expand + 영구 원칙 안내) + DashboardHeader "AI 영구운영" 메뉴 + /continuous-operator 라우트. **AI 단독 발송 X 영구 원칙 100% 정합** — 모든 제안서는 사용자 승인 후에만 발송 (ENT 자동 실행 옵션은 default OFF + 1,000건/5만원/low risk/비광고 임계값 통과 시만) |

---

## 14. 참조 문서

- 운영 추적: [status/STATUS.md](../status/STATUS.md)
- DB 스키마: [status/SCHEMA.md](../status/SCHEMA.md) (D172 운영 환경 실행 SQL 10건 박힘)
- AI Operator 진행: [status/ai_operator_progress.md](../status/ai_operator_progress.md)
- 영구 원칙 메모리: `memory/feedback_no_target_auto_relax.md` + `memory/feedback_ai_operator_model_isolation.md` + `memory/feedback_jondaetmal_to_harold.md`
- 누적 작업 메모리: `memory/project_d162_5_braze_grade_roadmap_kickoff.md` + `memory/project_d172_cdp_kickoff.md` + `memory/project_d173_d174_provider_and_next_action.md`

---

> 본 문서는 한줄로 AI Operator의 살아있는 기능 정의서입니다. 신규 기능 / 변경 / 영구 원칙은 본 문서 § 13 변경 이력에 박히고, 메이저 버전(v2.0.0+)은 Step 2 Journey Builder 진입 시점에 갱신 박힙니다. 사외 소개서(.docx)는 본 문서를 그대로 변환하여 박을 수 있습니다.
