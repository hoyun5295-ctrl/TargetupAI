# 2026-06-07 핸드오프 — AI 자율예측 재설계 (발견·제안 중심 + 난잡 금지)

> 다음 세션은 이 문서 기준으로만 움직인다. 자율예측(PredictiveDashboardPage)이 "어정쩡"하다는 Harold 지적을 잡는 작업.

> **[2026-06-07 구현 완료 — 미배포]** 이 핸드오프의 재설계는 같은 날 구현 완료(메인 3블록 + 발견 세그먼트 주인공 + 전부 모달 + backend `discoveredSegments` 실데이터 근거 TDD). 상세 = `memory/project_2026_0607_predictive_redesign_brainstorm.md` "자율예측 재설계 완료" 섹션. 남은 것 = 배포(Harold) + 운영검증. 별도 미점검 = impactScore·churn 임의상수, billing send_type='manual'.

## 0번 제약 (절대) — 난잡 금지

**난잡하면 실패다.** 예전 자율예측이 망한 건 정보가 많아서가 아니라 **한 화면에 다 쏟아부어서**였다(Harold 명시 2026-06-07). 정보량은 유지하되 한눈에 보이는 건 적게.

난잡 방지 5원칙:
1. **3단 위계** — 메인(한눈) → 클릭(모달 세부) → 드릴다운(개별 고객). 한 화면에 다 안 펼친다.
2. **메인은 3블록만** — ① cold start 안내 1줄 ② AI 발견 세그먼트 ③ 작은 요약 아이콘 바. 그 이상 안 깐다.
3. **나머지 전부 모달** — 지표 세부·분포·정확도·고객 테이블 = 아이콘/버튼 클릭 → 모달.
4. **일관성** — 카드 한 종류, 여백·타이포 통일, 색은 의미 있을 때만(위험=빨강 등).
5. **점진적 공개** — 처음엔 발견 + 요약만, 더 알고 싶을 때만 펼침.

매 화면 작성 직전 "이 화면, 한눈에 숨 쉴 공간 있나?" 자가 질의 의무.

## 방향 (Harold 확정 2026-06-07)

발견·제안 중심 = **인사이트 엔진**. AI가 위험·기회 고객을 발견 + 근거 + 제안, 캠페인은 운영자 확인 후 1클릭(사람이 최종 결정). 자동 발송은 옆 메뉴 Continuous Operator 담당 — 역할 분담.

## 메뉴 / 화면 흐름 (목표)

메인 (위→아래, 3블록):
1. 헤더 + 자동 예측 토글
2. cold start 안내 1줄
3. **AI 발견 세그먼트 (주인공)** — 이탈/구매/VIP, 각 "N명 + 근거 한 줄 + [근거 보기] [1클릭 캠페인]"
4. **작은 요약 아이콘 바** — 전체·진행·위험·기회·VIP·LTV (한 줄, 각 클릭 → 세부 모달)

모달 (클릭 시 띄움):
- 지표 세부(분포·고객 목록) / 분포·정확도 / 고객 근거(factors) / 고객 전체 테이블

## 백엔드 보강 필요

- AI 발견 세그먼트의 **"근거 요약"(왜 이 묶음인지) 생성** — 현재 `routes/ai.ts:3392` quick-action endpoint는 타겟 filter만 주고 근거 문장이 없다. 세그먼트별 근거 추가.
- 기존 자산: `predictive-suite.ts`(예측 계산), `predictive-explainer.ts`(고객별 근거 — 이번 세션 텍스트 자연 한국어 정리 완료), quick-action(churn_recovery/purchase_push/vip_engagement).
- 임의 상수 점검(별도): `predictive-explainer.ts` factors impactScore(0.9·0.7·2.5·10 등) + 이탈위험(churn_risk) 산식 — 실데이터 도출인지(feedback_no_arbitrary_constants). UI와 분리해서 따로.

## 이번 세션(2026-06-07) 자율예측에 한 것 (1차 재구성 — 미완·어정쩡)

`packages/frontend/src/pages/PredictiveDashboardPage.tsx` 현재 상태:
- 안내 카드 2→1 통합(cold start 추정 캡션 포함)
- 고객 행 인라인 확장 → **모달**(예측 3 + 근거 factors + 1클릭) — `PredictiveDetailModal`
- 작은 metric 4줄 → **큰 카드 6 그리드**(`PredictiveBigCard`) ← Harold "큰 카드만으론 어정쩡" → 다음 세션에 발견 세그먼트 + 작은 아이콘 바로 재배치
- "자세히 분석" 인라인 펼침 → **모달**(분포 히스토그램 3 + 정확도)
- 액션 카드 3 제거 → 큰 카드(이탈/구매/VIP) 클릭 = `handleQuickAction` 통합
- 화면 노출 "영역" 단어 전부 자연 한국어(factor.detail/label·source caption·정확도 안내)
- 테이블 cold start 동일값 흐림(`isAllColdStart`)
- backend `predictive-explainer.ts` topRecommendation·factor 텍스트 정리

미사용 정리 대상: `SummaryMetric`·`QuickActionCard` 컴포넌트 정의(사용 0, tsc는 통과·noUnusedLocals off).

**다음 세션 핵심 = 큰 카드 6이 메인인 현재 → "발견 세그먼트 주인공 + 작은 요약 아이콘 바 + 전부 모달"로 재배치(난잡 금지 5원칙).**

## 별도 (이번 세션 — 자율예측 외)

- **C 게이트 슈퍼관리자 토글**: `autosend-policy.ts` normalizeCdpAutoExecuteGate(+verify) / `admin.ts` PATCH `/companies/:id/cdp-auto-execute`(503 분기) / `AdminDashboard.tsx` editCompany 모달 카드. companies 4컬럼(cdp_auto_execute_*) information_schema 실재 확인 완료.
- **자동마케팅 크레딧 멱등 보강**: `continuous-operator.ts` reconcileStuckSending mark_sent에 deductCreditSafe(멱등키 proposalId) 1회.
- **자동마케팅+여정 전수 재검증**: 결함 0(회귀 + 5축 A진입/B발송/C돈/D정확/E표시). 상세 = STATUS 2026-06-07.
- **미점검(별도)**: billing `send_type='manual'` 카카오 정산 매칭(campaign INSERT엔 'manual' 없음·default 'ai') / 위 임의 상수.
- **배포 상태**: 배포 명령은 제공했으나 Harold 서버 비번 이슈로 미배포 가능 — 다음 세션 시작 시 git log로 배포분 실측.

## 세션 진입 명령어

```
CLAUDE.md 0번 원칙(추측SQL 금지) + 3원칙(자가진단·클로드원칙·슈퍼파워즈) + 이 핸드오프 0번 제약(난잡 금지 5원칙) 정독.

정독:
1. docs/superpowers/handoffs/2026-06-07-ai-predictive-redesign-handoff.md (본 문서)
2. status/lessons/LESSONS_FRONTEND.md + LESSONS_META.md (답변 패턴)
3. memory/feedback_marketing_user_ux_priority.md + feedback_design_quality_minimum_journey_level.md

작업 = AI 자율예측 재설계 (발견·제안 중심 + 난잡 금지).
- 현재 PredictiveDashboardPage = 큰 카드 6 메인(어정쩡) → 메인 3블록(안내 1줄 · AI 발견 세그먼트 주인공 · 작은 요약 아이콘 바) + 나머지 전부 모달로 재배치.
- backend: 발견 세그먼트 근거 요약 생성(quick-action 확장). 임의 상수는 별도.
- 화면 작성 직전마다 "한눈에 숨 쉴 공간 있나?" 자가 질의.
- 배포분 git log 실측 먼저(비번 이슈로 미배포 가능). 코드만 — 배포 Harold.
```
