# AI Operator 강화 — 감사 + 보완 설계도 (2026-06-20)

> 이번 세션 = 감사·보완점 도출·설계(본 문서). **다음 세션 = 본 설계대로 수정.**
> 작업 흐름: 본 문서 P1부터 TDD로 수정 → 검증 → 배포(Harold).

## 0. 감사 범위·방법
- 7 단위(A 핵심엔진 / B 자동마케팅 / C 성과·NextAction / D 여정 / E 채널 / F CDP·Provider / G 메모리·Batch·Citations·MultiGoal) + 배선.
- 5축: ① 코드 실재(stub/skeleton 아닌지) ② 배선(라우트·worker 등록) ③ 의존성(DB·env) ④ 버그·보류 ⑤ 영구 룰(모델명 노출 X / Zero-Count / AI 단독발송 X / 박-단어 / native dialog).
- 스캔 깊이: **A·C 정독**, B·D·E·F·G·배선 = 구조 + 마커 grep(stub/throw/TODO) + 핵심 함수 실재 확인.

## 1. 총평
**AI Operator 코드는 대체로 완성·견고하다.** 핵심 엔진·자동마케팅·성과 산식·채널·메모리·CDP 전부 실구현이고, 모든 worker·route가 app.ts에 등록되어 죽은 기능이 0이다. "미완" 인식의 상당수는 ① 과거 STATUS 노트(예: 성과 산식 — 실제는 재설계 완료) ② "배포 대기"(코드 완성, 배포만 남음)에서 온다. → "완벽하게 동작"의 핵심은 **소수의 코드 보완 + 기능별 런타임 검증·환경설정**이지, 대규모 미구현이 아니다.

## 2. 단위별 현황

| 단위 | 핵심 파일 | 상태 | 비고 |
|---|---|---|---|
| A 핵심엔진 | `services/ai-orchestrator.ts`(960) | 견고 | orchestrate(6 sub 순차) + orchestrateWithAI(Tool Use loop, max 8 iter·tool당 2회·실패 시 fallback). Zero-Count 0건 차단·compliance fail-closed·크레딧 이중차감 방지 적용. 경미 결함 3 (§4 A1~A3). |
| B 자동마케팅 | `utils/continuous-operator.ts`(1180) | 견고 | createOperator/list/update/archive + generateProposal + approve/reject + runAutoSendPass + 5분 worker + scheduler. 멱등 차감·claim·stuck 복구·광고 080 가드 적용됨. 경미 1 (§4 B1). |
| C 성과·NextAction | `utils/operator-performance-estimator.ts`(422) · `next-action-advisor.ts` | 견고 | estimator = D227+ 임의상수 0 실데이터 3계층(등급 실측 → 구매주기 포아송 → insufficient_data 정직) + HARD_RATE_GUARD. **과거 "산식 미완" 노트는 stale — 실코드 견고.** next-action = buildPerformanceSnapshot/V2 + recommendNextAction 실재. |
| D 여정 | `utils/journey-{builder,executor,trigger-watcher}.ts` | 실구현(미정독) | D232+ 9결함 전수 수정 이력(자유여정 진입·created_at 취약·조건 default pass·고객당 campaign·step 시점 등). 구조·marker 무stub. **다음 세션 executor 정독 권장(가장 복잡).** |
| E 채널 | `utils/{inapp-message,voice-inbound,email-channel,web-push}.ts` | 실구현 | getActiveMessagesForCustomerV2·handleInboundCall·email-channel·web-push 핵심 함수 실재. **런타임은 env·DB 의존(§6).** |
| F CDP·Provider | `utils/provider-registry.ts` + cafe24/naver/custom/godo | 실구현 + 계획공백 | cafe24·네이버·자체호스팅·고도몰 실구현. skeleton 5종(Shopify/메이크샵/imweb/식스샵/WooCommerce) = Phase 2 placeholder, `listProvidersForUI`가 `coming_soon` 정직 표시(거짓광고 X). |
| G 메모리·Batch·Citations·MultiGoal | `utils/{company-memory,batch-ai,citations,multi-goal-decisioning}.ts` | 실구현 | submitBatch·callAIWithCitations·analyzeGoalConflicts·buildMemoryPromptContext 실재. |
| 배선 | `app.ts` | 완료 | route 등록(ai/ai-memory/ai-usage/cdp/cafe24/naver-commerce/godo/voice/email…) + worker 기동(JourneyExecutor·TriggerWatcher·ContinuousOperator·AiMemoryAccumulator·Predictive·CdpWebhookRetry·CdpProfileRecompute·EmailSendSweeper·DmDraw…). 죽은 기능 0. |

## 3. 영구 룰 점검 (A·B 정독 기준)
- 모델 분리: Orchestrator/Target/Compliance/Insight = opus, Message = sonnet(D209+). 사용자 노출 모델명 0(추상 명칭). ✓
- Zero-Count: orchestrate·orchestrateWithAI 둘 다 0건 시 message 차단·자동완화 0. ✓
- AI 단독발송 X: 모든 제안 승인 후 발송(자동실행은 임계값+default OFF). ✓
- AI 임의혜택 X: 메시지 생성 전 경로가 혜택 placeholder 유지(grep 다수 확인). ✓
- compliance fail-closed(검수 실패=passed false=자동발송 보류). ✓

## 4. 보완점 — 우선순위

### P1 (코드 수정 — 다음 세션)
- **A1. `orchestrateWithAI`가 `seasonHint`를 메시지 생성에 안 넘김.** `orchestrate`는 `objective + seasonHint`로 넘김(L356)인데 AI 경로 message_composition은 `ctx.objective`만(L650). → AI-decision 경로로 계절 자동마케팅 시 시즌 유실. **fix**: L650을 orchestrate와 동일하게 `ctx.seasonHint ? \`${objective}\n\n${seasonHint}\` : objective`.
- **A2. `orchestrateWithAI`가 Orchestrator AI의 최종 통합 분석(200자)을 버림**(L787 console.log만, 결과 미반영). 토큰 쓰고 사용자에 안 보임. **fix**: 종료 분기에서 finalText를 capture → `recommendationReason` 보조 또는 신규 `meta.aiSynthesis`로 반환.
- **A3. 모델 주석 stale 정리.** L203·L401 "Compliance (Haiku 4.5)" → 실제 opus. 헤더 L5 "모든 AI 호출 = Opus 4.7" → Message는 sonnet. (backend 주석이라 룰 위반은 아니나 혼동 → 실제값으로 갱신.)
- **B1. `continuous-operator.notifyOperatorAdmins` 알림톡 fallback**(L1160 TODO). 담당자 알림이 LMS만 — 알림톡 1순위 → LMS 2순위. (무과금 인증라인·담당자 알림 한정이라 경미. 알림톡 템플릿 등록 선행.)
- **확인 필요: `cdp-orders`/`cdp-order-revenue` 취소·환불 매출 차감.** 주석상 "함께 해소"라 정정됐을 가능성 — 다음 세션에 실코드로 차감 로직 실재 확인(없으면 P1로 승격).

### P2 (계획·수요 기반)
- **Provider Adapter Phase 2**: Shopify/메이크샵/imweb/식스샵/WooCommerce 실구현. ENT 후보사 자사몰 종류 확정 후 1개씩(IProviderAdapter 구현체 추가, routes 변경 0). 현재는 coming_soon 정직 표시라 사용자 피해 0.
- **`alimtalk-webhook-handler` messageKey→campaign 매핑**(L199 Phase 2): 알림톡 발송결과를 campaign_runs/direct_send/test_send에 역매핑(스키마 확장 동반). 알림톡 발송결과 정밀 추적용.
- **`auto-campaign-worker` MMS**(L848 legacy): 과거 자동캠페인 MMS 미지원. 자동마케팅(Continuous Operator)이 대체 경로라 우선순위 낮음.

### P3 (런타임 검증·환경설정 — Harold/직원)
- 기능별 E2E 1건 실측(제안 생성 → 승인 → 발송 → 결과). AI는 코드만, 운영 검증은 Harold/직원.
- §6 env/DB 의존성 충족 여부 점검(미설정 시 해당 채널 미동작).

## 5. 다음 세션 작업 순서(제안)
1. A1·A2·A3 (`ai-orchestrator.ts` 단일 파일, 순수+통합) — TDD.
2. cdp 취소/환불 차감 실재 확인 → 결과에 따라 fix.
3. B1 (알림톡 템플릿 등록 상태 확인 후).
4. D 여정 executor 정독(숨은 결함 확인).
5. P2는 Harold 우선순위 지정 후.

## 6. 의존성 표 (런타임 동작 조건)

| 기능 | 필요 env | 필요 DB |
|---|---|---|
| Voice 인바운드 | NAVER_CLOVA_STT_*/TTS_*, VOICE_WEBHOOK_SECRET | voice_inbound_calls, companies.voice_inbound_enabled |
| Email | SMTP(company-smtp-client, SMTP_ENCRYPTION_KEY) 또는 SENDGRID_* | email_campaigns, email_events |
| Web Push | VAPID_PUBLIC/PRIVATE/SUBJECT | cdp_push_subscriptions, cdp_push_campaigns |
| 인앱 | (SDK 서빙) | cdp_inapp_messages, cdp_inapp_impressions |
| CDP/Provider | CAFE24_*, NAVER_COMMERCE_*, godo partner key | company_integrations, cdp_* |
| Batch/Citations/Memory | ANTHROPIC_API_KEY | ai_batch_jobs, ai_company_memory |
| Orchestrator AI 경로 | AI_OPERATOR_USE_AI_DECISION=true(옵션) | — |

## 7. 다음 세션 정독 권장(미정독)
- `journey-executor.ts`(가장 복잡, D232+ 다수 수정 — 숨은 결함 최종 확인).
- 채널 CT 실동작(inapp V2 매핑·voice STT/TTS 흐름·email 발송) = env 충족 후 런타임.

---
**핵심 결론**: 대규모 미구현 없음. P1 코드 보완 5건(대부분 `ai-orchestrator.ts` 1파일) + cdp 차감 확인 + 여정 executor 정독이 다음 세션 핵심. P2(Provider Phase 2)는 수요 기반. P3(런타임 검증)는 Harold/직원.
