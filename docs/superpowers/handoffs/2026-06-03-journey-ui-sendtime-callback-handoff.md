# 2026-06-03 세션3 핸드오프 — 다음 세션: 여정 추가 점검 (핀포인트만)

> 배포 완료(backend + frontend). **다음 세션은 무작위 소스 grep 금지 — 아래 핀포인트의 파일·라인만 본다.**

---

## 0. 철칙 (이전 핸드오프 동일)
- 추측 금지. 코드 직접 읽기 + information_schema 사실만.
- DB ALTER 전 information_schema 검증. tsc 통과 ≠ SQL 유효.
- 배포 = tp-push → 서버 git pull → build:safe → pm2 restart.
- 답변 사실만 짧게. 자연 한국어. 이모지/포장 금지.

---

## 1. 오늘(세션3) 완료 — 배포됨

### 발송시간 야간 가드 (backend)
- `send-time-util.ts` `shiftToSendableHour(date)` 신규 — 발송 가능(08~21시) 밖이면 이동, **야간/새벽 도착은 아침 9시 고정**(Harold 명시, 시각 미지정 default).
- `journey-executor.ts` `calculateNextRunAt` 4분기(relative·specific_hour·next_business_day·fallback) 모두 `shiftToSendableHour` 적용.
- `journey-trigger-watcher.ts:144` 여정 진입 `nextRunAt`도 적용.

### 회신번호 매장번호 (backend + frontend)
- `journeys.callback_mode` 컬럼 ALTER 완료 (text DEFAULT 'fixed').
- `journey-executor.ts:369` callback_mode='store'면 customer.store_phone 우선(없으면 기존 journey.callback_number → customer.callback). ExecutionRow.callback_mode / CustomerRow.store_phone 타입 추가.
- `journey-builder.ts` CreateJourneyInput.callbackMode + createJourneyFromTemplate INSERT callback_mode($13).
- `ai.ts` POST /operator/journeys endpoint callbackMode 수신/전달.
- `JourneysPage.tsx` 회신 select 아래 "고객 매장번호로 발송" 체크박스(reviewUseStorePhone) + 저장 body callbackMode.

### UI 3분할 + 미리보기 (frontend)
- `JourneysPage.tsx` 빌더 step 카드: 가로 3열 그리드(gap-4) + 제목바(유형색 좌측 바: 메시지 보라/대기 파랑/조건 초록) + 카드 그림자.
- 본문 [원본 편집]/[발송 미리보기] 토글(previewSteps Set). 미리보기 = 추출된 타겟 최상위 1명 치환.
- 발송 시점 자연어 2줄("트리거 후 N시간 뒤"·"다음 N시에 발송", 밤이면 아침 자동) + 기능버튼(유형/채널/광고 표기/AI 다듬기/삭제).
- "10명 미리보기" 모달 + liquidPreview state 제거.
- `highlightVars.tsx` `mergeVarsPlain` 신규(강조 없는 순수 치환) — 블록({% %}) 유무 무관 모든 step 동일 표시(기존 mergeAndHighlightVars는 블록 있으면 {{ }} 강조 누락 = step마다 들쭉날쭉). 빌더·모달 미리보기 적용.
- 미리보기 제목 "(광고)" 합성 (광고 체크 + LMS/MMS). 빌더·모달.
- `JourneyMessageEditModal.tsx` isAd 읽기(getJourneyDetail SELECT * 응답) + 제목 (광고) + mergeVarsPlain.

---

## 2. 다음 세션 점검 핀포인트 (이번에 발견했으나 미수정 — 우선순위 순)

### [1] 알림톡 대체발송(B타입) nextContents 변수치환 누락 ★우선
- `sms-queue.ts:719` insertAlimtalkQueue — nextContents를 raw로 `k_next_contents` INSERT(758). 변수치환 X.
- 4 호출처 공통: journey-executor.ts:669 / campaigns.ts:2011 / auto-campaign-worker.ts:951 / direct-send-processor.ts:208.
- 알림톡 본문(message)은 replaceAlimtalkVars로 치환되는데 대체문구(nextContents)만 raw → nextType='B'(LMS+별도문구) + 변수 포함 시 `%이름%` 노출 가능.
- 확인 순서: alimtalk_next_contents 입력 UI에 변수 넣을 수 있는지 → IMC가 k_next_contents를 치환하는지(외부 API raw 확인). 의도면 무관, 누락이면 4경로 통합 fix.

### [2] journey_step_variants 본문 applyVariableDefaults 누락
- `bandit-optimizer.ts:464` createJourneyStepVariant INSERT — message_template에 applyVariableDefaults 미적용.
- step 본문은 journey-builder.ts:309에서 적용. 발송 시 variant 우선(executor:305)이라, variant에 default 없는 `{{ customer.X }}`가 있으면 빈 값으로 발송.
- fix: createJourneyStepVariant에도 applyVariableDefaults 적용.

### [3] 스팸테스트 첫 고객 정렬 불일치
- enqueueSpamTest:144 `ORDER BY name ASC NULLS LAST`(해시 계산용) vs executeSpamTest:322 `ORDER BY created_at DESC`(실제 발송용).
- 둘이 다른 고객을 가리키면 미리보기/해시와 실제 테스트 발송 본문이 어긋남. 한쪽으로 통일.

### [4] 죽은 /resume endpoint
- `ai.ts:2996` POST /operator/journeys/:id/resume + `journey-builder.ts:739` resumeJourney — snapshot 재생성 없음.
- 프론트는 재개도 activate(JourneyActivationConfirmModal → /activate)를 타서 snapshot 재생성되므로 현재 무해. resumeJourney에 createJourneyStepSnapshots 추가하거나 endpoint 제거(택1).

### [5] condition 평가 오류 default pass=true
- `journey-executor.ts` evaluateCondition — 평가 오류/미지원 type 시 true(발송 진행). 과발송 여지(activateJourney 사전 검증 전제라 드묾). 정책 확인.

### [6] 미점검 (필요 시)
- snapshot 본문에 광고합성/default가 반영되는 시점(활성화 vs 발송). createJourneyStepSnapshots는 원본 저장, 발송 시 prepareSendMessage 합성 — 정합 재확인.
- 캠페인·직접발송(non-journey) 발송시간: `calcSplitSendTime`은 21시 이후만 다음날 이월하고 **새벽(0~8시) 미처리**. 여정만 shiftToSendableHour로 9시 가드. 캠페인도 새벽 가드 필요한지 Harold 확인.

---

## 3. 코드 청소 (tsc 통과 = noUnusedLocals false, 동작 무관 — 여유 시)
- `JourneysPage.tsx` 미사용 import 가능성: highlightVars / mergeAndHighlightVars / Code / Sparkles / Save / Edit2 / previewBytes / previewSamples / LiquidPreviewModal. grep으로 실제 미사용 확인 후 제거.
- `JourneyMessageEditModal.tsx` 잔여 미사용(SAMPLE 등) 확인.

---

## 4. 진입 시 읽을 것 (무작위 X)
1. 이 핸드오프
2. CLAUDE.md + status/lessons/LESSONS_BACKEND.md (발송·알림톡 사고)
3. [1] 시작점 = sms-queue.ts:719 insertAlimtalkQueue + 4 호출처
