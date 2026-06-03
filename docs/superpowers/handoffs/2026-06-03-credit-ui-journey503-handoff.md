# 2026-06-03 크레딧 UI + 여정 503 핸드오프

> 다음 세션 시작 시 이 문서 정독 → ① 여정 503 마무리 ② JourneysPage native dialog 전수 교체 → 배포.

---

## 0. 배포 (이번 세션 변경 — 검증됨 tsc 0, 미배포)

```bash
tp-push "크레딧 차감 정리+사전모달+사후토스트+토스트 다크톤 통일+D배지 제거+pretest-validate 에러 로그"
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app && git pull
cd packages/backend && npm run build:safe && pm2 restart all
cd ../frontend && npm run build:safe
```

---

## 1. 이번 세션 완료 (전부 tsc 0, 자가 grep 0)

### A. 크레딧 차감 정리 (생성/확정 2단계 통일)
- `utils/ai-credit-calc.ts` CREDIT_COST_MAP:
  - `dm-ai-generate` 3 신규(DM 생성), `dm-builder` 30(DM 발행)
  - `inapp-ai-generator` 15→3(인앱 생성), `inapp-publish` 15 신규(인앱 게시)
  - `inapp-quick-action` 15→1(다듬기 정합), `refine-direct` 1 신규(직접발송 다듬기)
- `routes/dm.ts`: 생성 5→3(`dm-ai-generate`) / 발행 30 신규(멱등 `dm-publish:id`, 최초 1회, test-send 자동발행 제외, 부족 시 402)
- `routes/cdp.ts`: 인앱 게시 15(POST 저장=active + PUT 재개, 멱등 `inapp-publish:msgId`)
- `routes/ai.ts:902`: 직접발송 다듬기 차감 — **refineDirectMessage가 callAIWithFallback 우회(anthropic 직접 호출)라 차감 누락이었음** → route에서 직접 deductCreditSafe(`refine-direct` 1)
- `frontend/constants/credit.ts`: 안내카드 9칸(생성·돌려보기 3 + 자동 발송 3 추가) + `CONFIRM_CREDIT_COSTS`(사전모달용 source→cost) + 라벨

### B. 크레딧 사전 확인 모달
- `components/credit/CreditConfirmModal.tsx` 신규(다크 톤, "[기능] NNN 크레딧 차감·현재→사용 후", 잔액부족 차단, ESC, GET /api/companies/my-credit 자체 조회)
- 큰 차감 5곳 연결: PerformancePage(풀분석 orchestrate)·DmBuilderPage(발행 dm-builder)·InAppMessagesPage(게시 active만)·ContinuousOperatorPage(자동마케팅 신규만)·여정은 기존 JourneyActivationConfirmModal에 150 안내 이미 있어 그대로

### C. 크레딧 사후 토스트 (작은 차감 — 전역, 호출처 무수정)
- `utils/request-context.ts`: creditEvent + setCreditEvent/getCreditEvent
- `utils/ai-credit.ts` deductCreditSafe: 차감 성공 시 setCreditEvent(used, balance, source)
- `app.ts`: 응답 미들웨어 — 차감 시 헤더 `X-Credit-Used/Balance/Source` 첨부(+Expose-Headers)
- `lib/credit-interceptor.ts` 신규: window.fetch 전역 래핑 + attachCreditInterceptor(axios) → `credit:used` CustomEvent
- `ToastProvider.tsx`: credit:used 수신 → 토스트(큰 차감 source는 CONFIRM_CREDIT_COSTS면 skip — 모달이 안내)
- attach 위치: main.tsx(import) + api/client.ts + stores/dmBuilderStore.ts + pages/DmBuilderPage.tsx
- ★ enterWith 전파 의존 — 배포 후 작은 차감 토스트 실제로 뜨는지 런타임 검증 필요(안 뜨면 보강)

### D. 토스트 다크 톤 통일
- `ToastProvider.tsx`: 베이스 slate-900/95 + backdrop-blur-xl + 좌측 액센트 바(컬러 배경 제거) + `useLegacyToast` shim
- 옛 `Toast.tsx`(이모지+단색) 5곳 전환 후 파일 제거: manage/UsersTab·CallbacksTab·StatsTab·ScheduledTab + StatsTab-company
- `Dashboard.tsx`: 자체 토스트(animate-bounce + ✅⚠️❌ 이모지) → useToast shim + 옛 렌더 제거

### E. D-시리즈 배지 사용자 노출 제거 6곳
JourneyActivationConfirmModal(D218+ 배지 + CT명 Source caption + 마이그 내부문구)·AiRefineLockedModal·AiRefineModal·JourneyPausePage·DirectSendAiRefinePopup·JourneyPauseLogsModal

### F. "DB 마이그레이션 대기 중" 사용자 노출 문구 5곳 → 친화
AiMemoryPage·AiUsagePage·EmailCampaignsPage·InAppMessagesPage·JourneyPauseLogsModal ("기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.")

### G. 여정 종료/일시정지 native confirm → 다크 톤 모달
- `JourneyActionConfirmModal.tsx`: pause/end mode 추가(amber/rose)
- `JourneysPage.tsx` handleAction: pause/end native confirm 제거 → setActionModal / executeArchiveAction method 분기(pause·end=POST)

### H. pretest-validate catch 에러 로그 (503 원인 추적용)
- `routes/ai.ts:2980`: catch에서 console.error를 503 분기 **앞으로** 이동(에러 삼킴 버그 수정) + 503 메시지 사용자 친화

---

## 2. 완료 (2026-06-03 다음 세션 — DB ALTER 0건)

### 여정 활성화 503 — 해결 (★ 이 핸드오프의 buildJourneyStats 진단은 틀렸었음)
- **진짜 원인**: buildJourneyStats가 아니라 `validateJourneyForActivation`(utils/journey-pretest-validator.ts)이 **없는 컬럼**을 읽던 코드 버그. ALTER 문제 아님.
  - `s.callback_number` — callback_number는 journey_steps에 없고 **journeys**에 있음 → `j.callback_number` (작동 코드 journey-executor.ts:143이 j.callback_number로 정상 사용)
  - `journey_step_variants.message_body` — 그 테이블 본문 컬럼은 **message_template** → `message_template` (작동 코드 bandit-optimizer.ts:476이 message_template로 INSERT)
- **확인 방법**: Harold 운영 PG에서 journey_steps/journeys/journey_step_variants/journey_executions 컬럼 덤프 → 코드가 읽는 컬럼과 대조 → 없는 2개 확정. buildJourneyStats(journey-stats.ts)는 활성화 경로가 **아님** — 지난 세션의 variant_label/arm_alpha/arm_beta ADD는 활성화 503과 무관했음.
- **fix**: 같은 버그 2파일 6줄 — journey-pretest-validator.ts(62 s→j callback_number / 90·97 message_body→message_template) + journey-builder.ts createJourneyStepSnapshots(675 JOIN journeys + j.callback_number / 685·690·703 message_template). 후자는 try/catch에 삼켜져 스냅샷이 조용히 저장 안 되던 잠재 버그. backend tsc 0.

### JourneysPage native dialog — 해결
- alert 27 + confirm 6 = 33곳 전부 useToast / ConfirmModal(공용 components/ConfirmModal)로 교체. alert/confirm/prompt grep 0, frontend tsc 0. 자동 재진입 안내문은 자연스러운 한국어로 정리.

### 여정 발송 치환 빈 값 — 해결
- **원인**: journey-executor 발송용 customer SELECT(332행)가 하드코딩 thin(id/phone/name/.../recent_purchase_date)이라 grade·region·age·gender·points·구매금액·구매횟수 변수가 빈 값으로 치환됐음. 조건 평가용 SELECT(265행)·미리보기(ai.ts sample-customer:370)·캠페인/직접/자동 발송(campaigns:640·direct-send:96·auto-campaign:739)은 동적/comprehensive라 무관 — 여정 발송만 thin이었음.
- **fix**: journey-executor customer SELECT 2곳(발송·조건) → `SELECT *` (컬럼명 단정 0 = 없는 컬럼 위험 0). backend tsc 0.

### 배포만 남음
- backend(journey-pretest-validator·journey-builder·journey-executor) + frontend(JourneysPage) 변경. tp-push + 양 패키지 `npm run build:safe` + `pm2 restart all`. **DB 작업 없음.**
- 배포 후 운영 확인(Harold): 여정 활성화 → 503 안 나는지 / native 흰 dialog 안 뜨는지 / 등급·지역 변수 넣은 발송이 값 채워지는지.

---

## 3. 반드시 지킬 교훈 (이번 세션 3번 틀림)

- **DB 컬럼 ALTER 전 `information_schema.columns`로 실제 컬럼 먼저 확인 → 없는 것만 ADD** (db_column_verify 원칙). 이번에 "테이블 없음"→"컬럼 누락"→"IF NOT EXISTS 뭉텅이 던지기" 3번 틀려 Harold 격분. 추측 ALTER 금지.
- **PM2 실제 에러 로그를 먼저 봐라.** 추측으로 ALTER 던지지 말 것.
- **catch가 에러를 삼키면(console.error가 분기 뒤) 디버깅 불가** — 항상 로그 먼저.
- 도구 호출 형식(antml:invoke) 정확히 — malformed 반복 금지.

---

## 4. 다음 세션 진입 명령어

```
docs/superpowers/handoffs/2026-06-03-credit-ui-journey503-handoff.md 정독 후 ① 여정 503 마무리(backend 배포→활성화→PM2 정확 컬럼→information_schema 확인→ALTER) ② JourneysPage native dialog 29곳 전수 교체(grep 0) → 배포
```
