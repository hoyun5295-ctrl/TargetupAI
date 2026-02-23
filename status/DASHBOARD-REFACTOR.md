# 🔧 대시보드 컴포넌트 분리 — 작업 레퍼런스

> **목적:** Dashboard.tsx (원본 8,039줄) → 핵심 로직만 남기고 모달/서브컴포넌트를 분리
> **관련 문서:** STATUS.md | SCHEMA.md | OPS.md | AI-CUSTOM-SEND.md
> **작업 방식:** 2세션 분할 (Session 1 ✅ 완료 / **Session 2 = 이번 세션**)

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

**생성된 컴포넌트 10개** (이미 `components/`에 배치 완료):

| 파일 | 줄수 | 내용 |
|------|------|------|
| CalendarModal.tsx | 366 | 캘린더 모달 (인라인 정의 → 독립) |
| ChannelConvertModals.tsx | 203 | LMS 전환 + SMS 전환 2종 통합 |
| AiMessageSuggestModal.tsx | 135 | AI 문구 추천 (직접발송용) |
| CustomerInsightModal.tsx | 113 | 고객 인사이트 |
| TodayStatsModal.tsx | 97 | 이번 달 통계 |
| PlanLimitModal.tsx | 76 | 플랜 초과 에러 |
| RecentCampaignModal.tsx | 57 | 최근 캠페인 |
| RecommendTemplateModal.tsx | 46 | 추천 템플릿 |
| CampaignSuccessModal.tsx | 45 | 캠페인 확정 성공 |
| PlanUpgradeModal.tsx | 44 | 요금제 업그레이드 |

---

## 3) 🎯 CURRENT_TASK — Session 2

### 목표
- Dashboard.tsx (현재 7,056줄) 에서 남은 모달 13개를 11개 파일로 분리
- **예상 절감:** ~2,255줄
- **완료 후 대시보드:** ~4,900줄

### ❌ SKIP 대상 (이번에도 건드리지 않음)
| 모달 | 라인 | 줄수 | 사유 |
|------|------|------|------|
| 직접 타겟 설정 모달 | 2871~3448 | 578 | 30+개 state 직접 참조, 하위 모달 5개 포함 |
| 직접 타겟 발송 모달 | 4084~5971 | 1,888 | handler 10+개 깊은 결합, 전용 세션 필요 |

---

### 분리 대상 13개 모달 → 11개 파일

> **⚠️ 라인 번호는 현재 Dashboard.tsx (7,056줄) 기준입니다.**
> **작업 순서: 바텀업(뒤→앞)으로 교체해야 라인 번호가 밀리지 않습니다.**

| # | 새 파일명 | 모달 | 라인 범위 | 줄수 | 난이도 |
|---|-----------|------|-----------|------|--------|
| 1 | `BalanceModals.tsx` | 잔액현황+충전+부족 3종 | 6739~7031 | 293 | ★★☆ |
| 2 | `SendConfirmModal.tsx` | 발송 확인 모달 | 6659~6738 | 80 | ★★☆ |
| 3 | `DirectPreviewModal.tsx` | 미리보기 모달 (공용) | 6531~6658 | 128 | ★★☆ |
| 4 | `ScheduleTimeModal.tsx` | 예약전송 날짜/시간 선택 | 6360~6530 | 171 | ★☆☆ |
| 5 | `AddressBookModal.tsx` | 주소록 모달 | 5972~6333 | 362 | ★★☆ |
| 6 | `UploadResultModal.tsx` | 업로드 결과 모달 | 4056~4083 | 28 | ★☆☆ |
| 7 | `ScheduledCampaignModal.tsx` | 예약 대기 모달 | 3572~4055 | 484 | ★★☆ |
| 8 | `UploadProgressModal.tsx` | 업로드 프로그레스+결과1 | 3448~3569 | 122 | ★★☆ |
| 9 | `MmsUploadModal.tsx` | MMS 이미지 업로드 | 2743~2866 | 124 | ★★☆ |
| 10 | `AiPreviewModal.tsx` | AI 미리보기 모달 | 2565~2742 | 178 | ★★☆ |
| 11 | `AiCampaignResultPopup.tsx` | AI 캠페인 결과 팝업 | 2280~2564 | 285 | ★★★ |

### 권장 작업 순서 (바텀업: 뒤→앞)

```
①  BalanceModals.tsx          (6739~7031) — 잔액 3종, 독립적
②  SendConfirmModal.tsx       (6659~6738) — 작은 모달
③  DirectPreviewModal.tsx     (6531~6658) — 미리보기
④  ScheduleTimeModal.tsx      (6360~6530) — 예약전송 달력, 독립적
⑤  AddressBookModal.tsx       (5972~6333) — 주소록, state 많지만 독립적
⑥  UploadResultModal.tsx      (4056~4083) — 28줄, 바로 분리
⑦  ScheduledCampaignModal.tsx (3572~4055) — 예약 대기, 내부 state 많음
⑧  UploadProgressModal.tsx    (3448~3569) — 업로드 프로그레스
⑨  MmsUploadModal.tsx         (2743~2866) — MMS 업로드
⑩  AiPreviewModal.tsx         (2565~2742) — AI 미리보기
⑪  AiCampaignResultPopup.tsx  (2280~2564) — AI 결과 팝업, 가장 복잡 → 마지막
```

---

## 4) 분리 원칙 (Session 1과 동일)

### 4-1. Props 전달 패턴
```typescript
interface XxxModalProps {
  show: boolean;           // 표시 여부
  onClose: () => void;     // 닫기 콜백
  // + 모달별 필요한 데이터/콜백
}
```

### 4-2. state 처리 전략
- **모달 내부에서만 쓰는 state** → 모달 컴포넌트로 이동
- **Dashboard와 공유하는 state** → props로 전달
- **handler 함수** → 모달 내부 로직은 모달로, Dashboard 연동은 콜백으로

### 4-3. 난이도별 주의사항
- **★☆☆ (ScheduleTimeModal, UploadResultModal):** 단순 props 전달, 바로 분리
- **★★☆ (대부분):** 내부 state와 Dashboard state 경계 파악 필요
- **★★★ (AiCampaignResultPopup):** aiStep 1/2 분기, 다수 handler 참조, 스팸필터·캠페인확정 버튼 연동

---

## 5) 모달별 핵심 state 의존성

### BalanceModals (잔액 3종)
```
state: balanceInfo, showBalanceModal, showChargeModal, showInsufficientBalance,
       chargeStep, depositAmount, depositorName, depositSubmitting, depositSuccess
handler: 잔액조회 fetch, 무통장입금 요청 API
→ 3개 모달이 서로 연결 (현황→충전, 부족→충전)
```

### AddressBookModal (주소록)
```
state: showAddressBook, addressGroups, addressViewGroup, addressViewContacts,
       addressViewSearch, addressPage, addressSaveMode, addressFileData,
       addressFileHeaders, addressColumnMapping, newGroupName
handler: 주소록 CRUD, 파일업로드, directRecipients 추가
→ onSelectRecipients 콜백으로 Dashboard directRecipients에 추가
```

### ScheduledCampaignModal (예약 대기) — 내부 state 가장 많음
```
state: showScheduled, scheduledCampaigns, scheduledSearch, scheduledLoading,
       scheduledHasMore, cancelConfirm, deleteConfirm, messageEditModal,
       messageEditing, messagePreview, editMessage, editSubject, editScheduleTime,
       scheduledRecipients, scheduledRecipientsTotal, messageEditProgress
handler: 예약취소, 메시지수정, 수신자조회, 예약시간변경
→ 대부분 모달 전용 state → 모달 내부로 이동 가능 (Dashboard에서 제거)
→ token은 localStorage에서 직접 획득
```

### AiCampaignResultPopup (AI 결과 팝업) — 가장 복잡
```
state: showAiResult, aiStep, aiResult, selectedChannel, selectedAiMsgIdx,
       sendMode, isAd, useIndividualCallback, selectedCallback,
       successSendInfo, showSpamFilterTest
handler: setAiStep, handleChannelChange, handleSendModeChange,
         openCampaignSendModal, setShowSpamFilterTest
→ aiStep 1: 타겟 & 채널 선택 UI
→ aiStep 2: 핸드폰 미리보기 3개 + 스팸필터 버튼 + 캠페인확정 버튼
→ Dashboard의 다수 state를 참조하므로 props 많아짐
```

### AiPreviewModal (AI 미리보기)
```
state: showPreview, aiStep, selectedChannel, aiResult, selectedAiMsgIdx,
       useIndividualCallback, selectedCallback
→ AiCampaignResultPopup과 유사한 state 참조
→ 핸드폰 모양 미리보기 UI
```

### ScheduleTimeModal (예약전송 달력)
```
state: showReservePicker, reserveDateTime, reserveTime
handler: setReserveDateTime, setReserveEnabled, onConfirm
→ 독립적, 단순 날짜/시간 선택
```

### SendConfirmModal (발송 확인)
```
→ 발송 전 최종 확인 (건수, 채널, 비용 표시)
→ onConfirm 콜백으로 실제 발송 트리거
```

### DirectPreviewModal (미리보기 공용)
```
→ 직접발송 메시지 미리보기 (핸드폰 UI)
→ 메시지, 채널, 광고여부, 수신거부번호, 콜백번호, mergeData
```

### MmsUploadModal (MMS 업로드)
```
state: showMmsUploadModal, mmsUploadedImages, mmsSlotUploading
handler: handleMmsSlotUpload (파일 선택→업로드→슬롯 채우기)
```

### UploadProgressModal (업로드 프로그레스+결과1)
```
state: showUploadProgressModal, uploadProgress, showUploadResult, uploadResult
→ 프로그레스바 + 완료 후 결과 표시
```

### UploadResultModal (업로드 결과2)
```
state: showUploadResult, uploadResult (insertCount, duplicateCount)
→ 28줄, 가장 단순
```

---

## 6) 완료 기준 (DoD)

- [ ] 11개 파일 생성 완료
- [ ] Dashboard.tsx에서 해당 JSX 제거 + import 추가
- [ ] TypeScript 타입 에러 없음
- [ ] 기존 동작 100% 보존 (UI/로직 변경 없음)
- [ ] 최종 Dashboard.tsx ~4,900줄 달성
- [ ] 모든 파일 완성본으로 제공

---

## 7) DECISION LOG

| ID | 결정 | 근거 |
|----|------|------|
| D1 | 직접 타겟 발송 모달(2,466줄) SKIP | state 결합도 최고, 전용 세션 필요 |
| D2 | 2세션 분할: 쉬운 것(★☆☆) 먼저 | Session 1 성공 → Session 2 안전 이어감 |
| D3 | 완성 파일 전체로 제공 | Harold님 요청 |
| D4 | UI/로직 변경 없음 (순수 리팩토링) | 회귀 리스크 제거 |
| D5 | 바텀업 교체 순서 | 뒤에서부터 교체해야 앞쪽 라인 번호 안 밀림 |
| D6 | 업로드 관련 모달 2개 분리 (Progress + Result) | 같은 위치가 아니라 별도 파일 |

---

## 8) 리스크 & 대응

| ID | 리스크 | 대응 |
|----|--------|------|
| R1 | AiCampaignResultPopup의 aiStep 분기 복잡 | aiStep을 prop으로 받되, step 내부 UI는 그대로 이동 |
| R2 | ScheduledCampaignModal 내부 state 30+개 | 대부분 모달 전용 → 모달 내부로 이동, Dashboard에서 제거 |
| R3 | 잔액 충전 모달의 API 호출 | fetch 로직 모달 안에 포함, token은 localStorage에서 직접 획득 |
| R4 | 주소록 모달의 directRecipients 연동 | onSelectRecipients 콜백으로 처리 |

---

## 9) 예상 최종 결과

```
Session 1 후:  Dashboard.tsx = 7,056줄
Session 2 후:  Dashboard.tsx = ~4,900줄 (핵심 로직 + 직접발송 모달 2,466줄)
               + Session 1 컴포넌트 10개
               + Session 2 컴포넌트 11개
               = 총 21개 분리 컴포넌트
```

**Dashboard에 남는 것:**
- state 선언 + handler 함수 (핵심 로직)
- 상단 통계/요금제/발송현황 레이아웃
- 탭 영역 (타겟추출/캠페인설정/발송)
- 직접 타겟 설정 모달 (578줄) — 추후 별도 세션
- 직접 타겟 발송 모달 (1,888줄) — 추후 별도 세션
- 모달 호출부 (show/onClose props 전달)
