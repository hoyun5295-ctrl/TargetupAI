# 🔧 대시보드 컴포넌트 분리 — 작업 레퍼런스

> **목적:** Dashboard.tsx (원본 8,039줄) → 핵심 로직만 남기고 모달/서브컴포넌트를 분리
> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md | AI-CUSTOM-SEND.md
> **작업 방식:** 3세션 분할 (Session 1 ✅ 완료 / Session 2 ✅ 완료 / **Session 3 = 다음 세션**)

---

## 1) AI 에이전트 역할 & 규칙

- **역할:** STATUS.md 1-1 동일 (15년 차 시니어 풀스택)
- **이번 작업 특수 규칙:**
  - 수정 파일은 **완성된 전체 파일**로 제공 (기존→새코드 형식 아님)
  - 분리 시 **기존 동작 100% 보존** (UI/로직 변경 없음, 리팩토링 전용)
  - 한 파일씩 분리 → 컴파일 확인 → 다음 파일 (순차적)
  - **파일 위치:** 모든 분리 파일 → `packages/frontend/src/components/`

---

## 2) ✅ Session 1 완료 요약

**결과:** 8,039줄 → **7,056줄** (-983줄)

**생성된 컴포넌트 10개:**

| 파일 | 줄수 | 내용 |
|------|------|------|
| CalendarModal.tsx | 366 | 캘린더 모달 |
| ChannelConvertModals.tsx | 203 | LMS/SMS 전환 2종 통합 |
| AiMessageSuggestModal.tsx | 135 | AI 문구 추천 (직접발송용) |
| CustomerInsightModal.tsx | 113 | 고객 인사이트 |
| TodayStatsModal.tsx | 97 | 이번 달 통계 |
| PlanLimitModal.tsx | 76 | 플랜 초과 에러 |
| RecentCampaignModal.tsx | 57 | 최근 캠페인 |
| RecommendTemplateModal.tsx | 46 | 추천 템플릿 |
| CampaignSuccessModal.tsx | 45 | 캠페인 확정 성공 |
| PlanUpgradeModal.tsx | 44 | 요금제 업그레이드 |

---

## 3) ✅ Session 2 완료 요약

**결과:** 7,056줄 → **4,964줄** (-2,092줄)

**생성된 컴포넌트 11개:**

| 파일 | 라인 범위 (원본) | 내용 | 난이도 |
|------|-----------------|------|--------|
| AiCampaignResultPopup.tsx | 2280~2564 | AI 결과 팝업 (Step 1/2, 가장 복잡) | ★★★ |
| AiPreviewModal.tsx | 2565~2721 | AI 미리보기 | ★★☆ |
| MmsUploadModal.tsx | 2743~2865 | MMS 이미지 업로드 | ★★☆ |
| UploadProgressModal.tsx | 3448~3569 | 업로드 프로그레스+결과 | ★★☆ |
| ScheduledCampaignModal.tsx | 3572~4054 | 예약 대기 (내부 state 30+개 이동) | ★★☆ |
| UploadResultModal.tsx | 4056~4082 | 업로드 결과 (중복 제거) | ★☆☆ |
| AddressBookModal.tsx | 5972~6333 | 주소록 | ★★☆ |
| ScheduleTimeModal.tsx | 6360~6530 | 예약전송 달력 | ★☆☆ |
| DirectPreviewModal.tsx | 6531~6658 | 미리보기 공용 | ★★☆ |
| SendConfirmModal.tsx | 6659~6738 | 발송 확인 | ★★☆ |
| BalanceModals.tsx | 6739~7031 | 잔액현황+충전+부족 3종 | ★★☆ |

**Session 2 작업 방식:**
- Python 스크립트로 바텀업 자동 변환 (라인 번호 밀림 방지)
- TypeScript 타입체크 통과 후 서버 배포 완료
- setToast 타입 불일치 2건 수정 (`type: string` → `type: 'error' | 'success'`)

---

## 4) 🎯 Session 3 — 직접 타겟 모달 분리 (다음 세션)

### 목표
- Dashboard.tsx (현재 4,964줄) 에서 직접 타겟 관련 모달 2개 분리
- **예상 절감:** ~2,400줄
- **완료 후 대시보드:** ~2,500줄

### 분리 대상 2개

| # | 새 파일명 | 모달 | 줄수 | 난이도 | 핵심 위험 |
|---|-----------|------|------|--------|----------|
| 1 | `DirectTargetSettingModal.tsx` | 직접 타겟 설정 | 578 | ★★★ | state 30+개 직접 참조, 하위 모달 5개 포함 |
| 2 | `DirectTargetSendModal.tsx` | 직접 타겟 발송 | 1,888 | ★★★★ | handler 10+개 깊은 결합, 실제 발송 로직 포함 |

### ⚠️ Session 3 난이도가 높은 이유
- Session 1~2: 대부분 "보여주기용" 모달 → props 전달만 잘하면 됨
- Session 3: **실제 발송을 실행하는 핵심 로직** 포함
  - executeDirectSend, executeTargetSend, 예약발송, MMS 첨부
  - 수신자 필터링, 바이트 계산, 선불 잔액 차감
  - Dashboard state와 양방향 연동
- 문제 시 "발송 안 됨" 등 치명적 이슈 가능

### Session 3 진행 전제조건
1. **Harold님이 최신 Dashboard.tsx 업로드** (Session 2 배포본)
2. AI가 실제 코드 기반으로 state 의존성 맵 완벽히 그린 후 작업
3. 한 파일씩 분리 → 타입체크 → 다음 파일 (절대 한번에 2개 동시 분리 안 함)
4. **오류 0% 목표:** 타입체크 + 모든 발송 경로 검증

---

## 5) 전체 진행 현황

```
원본:     Dashboard.tsx = 8,039줄
Session 1 후: 7,056줄 (-983줄)  + 컴포넌트 10개
Session 2 후: 4,964줄 (-2,092줄) + 컴포넌트 11개
Session 3 후: ~2,500줄 (-2,400줄) + 컴포넌트 2개 (예정)
                                    ─────────────
총: 8,039줄 → ~2,500줄 + 독립 컴포넌트 23개
```

**Dashboard에 최종 남는 것:**
- state 선언 + 핵심 handler 함수
- 상단 통계/요금제/발송현황 레이아웃
- 탭 영역 (타겟추출/캠페인설정/발송)
- 모달 호출부 (show/onClose props 전달)

---

## 6) DECISION LOG

| ID | 결정 | 근거 |
|----|------|------|
| D1 | 직접 타겟 발송 모달(2,466줄) Session 1~2에서 SKIP | state 결합도 최고, 전용 세션 필요 |
| D2 | 2세션 분할: 쉬운 것(★☆☆) 먼저 | Session 1 성공 → Session 2 안전 이어감 |
| D3 | 완성 파일 전체로 제공 | Harold님 요청 |
| D4 | UI/로직 변경 없음 (순수 리팩토링) | 회귀 리스크 제거 |
| D5 | 바텀업 교체 순서 | 뒤에서부터 교체해야 앞쪽 라인 번호 안 밀림 |
| D6 | Session 2: Python 스크립트 자동 변환 | 컨텍스트 한계 대응, 수작업 오류 방지 |
| D7 | Session 3: 오류 0% 목표, 실제 코드 기반 의존성 분석 선행 | 발송 로직 포함 → 치명적 버그 방지 |
