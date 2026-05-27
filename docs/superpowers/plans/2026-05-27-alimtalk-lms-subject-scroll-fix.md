# 알림톡 LMS 대체 제목 검증 + 직접발송 스크롤 사라짐 영구 fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 박성용(영업팀장) 2026-05-27 신고 — 알림톡 발송 시 모든 fallback 옵션(N/S/L/A/B)에서 "LMS/MMS 발송 시 제목을 입력해주세요" 알럴 오발생 + 알럴 후 직접발송 패널 스크롤 사라짐 사고 진정 root cause 영구 fix.

**Architecture:** 
1. **알럴 오발생 root cause** = backend campaigns.ts `subject?.trim()` 검증 (= 일반 LMS subject `directSubject`, 알림톡 흐름에서 항상 빈 값) → 올바른 컬럼 `alimtalkNextSubject` 검증으로 정정. 추가로 frontend AlimtalkChannelPanel value/onChange 안 nextSubject 매핑 누락 + Dashboard onSendConfirm 핸들러 setAlimtalkNextSubject 호출 누락 = state↔payload 흐름 단절 사고 동시 정정.
2. **스크롤 사라짐 root cause** = D218+ fix가 AlimtalkSendModal에만 body.overflow cleanup 안전망 추가됨 + DirectSendPanel 대칭 안전망 누락. AlimtalkSendModal:427~438 패턴 미러로 영구 차단.

**Tech Stack:** Node.js/Express (backend route) + React/TypeScript (frontend component) + PostgreSQL (DB 변경 0건)

---

## File Structure

- Modify: `packages/backend/src/routes/campaigns.ts` (line 605~608 별건 endpoint + 1306~1310 destructure + 1354~1364 검증 분기)
- Modify: `packages/frontend/src/components/DirectSendPanel.tsx` (line 381~395 handleAlimtalkSend 검증 분기 + 1031~1046 AlimtalkChannelPanel value/onChange + useEffect cleanup 안전망 추가)
- Modify: `packages/frontend/src/pages/Dashboard.tsx` (line 3501 onSendConfirm 핸들러 setAlimtalkNextSubject 호출 + showDirectSend useEffect 안전망 추가)

---

## Task 1: backend campaigns.ts direct-send endpoint destructure + 검증 분기 정정

**Files:**
- Modify: `packages/backend/src/routes/campaigns.ts:1306~1310` (destructure)
- Modify: `packages/backend/src/routes/campaigns.ts:1354~1364` (검증 분기)

**변경 내용:**
1. destructure 안 `alimtalkNextSubject` 추가
2. 검증 분기 = 알림톡 흐름 시 = `alimtalkNextSubject` 검증 (subject가 아닌) + 일반 LMS/MMS 흐름 시 = `subject` 검증 유지

---

## Task 2: backend campaigns.ts:605~608 별건 endpoint 동일 분기 정정

**Files:**
- Modify: `packages/backend/src/routes/campaigns.ts:605~608`

**변경 내용:** 캠페인 조회 → 발송 endpoint도 alimtalk 흐름 분기 처리 (campaign.send_channel === 'alimtalk' 시 message_subject 검증 skip 또는 alimtalk_next_subject 검증)

---

## Task 3: DirectSendPanel.tsx AlimtalkChannelPanel value/onChange nextSubject 매핑 추가

**Files:**
- Modify: `packages/frontend/src/components/DirectSendPanel.tsx:1031~1046`

**변경 내용:**
- `value` props 안 `nextSubject: alimtalkNextSubject` 추가
- `onChange` 안 `if (setAlimtalkNextSubject) setAlimtalkNextSubject(v.nextSubject)` 호출 추가

---

## Task 4: DirectSendPanel.tsx handleAlimtalkSend 검증 분기 추가 (frontend self-fail-safe)

**Files:**
- Modify: `packages/frontend/src/components/DirectSendPanel.tsx:381~395`

**변경 내용:** AlimtalkSendModal:371~384 패턴 미러 — A/B 시 alimtalkNextContents 검증 + L/B 시 alimtalkNextSubject 검증

---

## Task 5: Dashboard.tsx onSendConfirm setAlimtalkNextSubject 호출 추가

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx:3501~3520`

**변경 내용:** AlimtalkSendModal handleSend → onSendConfirm payload `nextSubject` 값 Dashboard state에 반영 (setAlimtalkNextSubject(data.nextSubject) 호출 추가)

---

## Task 6: DirectSendPanel.tsx useEffect cleanup 안전망 추가 (스크롤 영구 차단)

**Files:**
- Modify: `packages/frontend/src/components/DirectSendPanel.tsx` (useEffect cleanup 추가 — 첫 useEffect 그룹 직전)

**변경 내용:** D218+ AlimtalkSendModal:427~438 패턴 미러 — mount/unmount cleanup 시 `document.body.style.overflow = ''` reset

---

## Task 7: Dashboard.tsx showDirectSend useEffect 안전망 추가 (이중 영구 차단)

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx` (showDirectSend state 인근)

**변경 내용:** showDirectSend 변경 시 body.overflow reset useEffect 추가

---

## Task 8: 통합 검증

**검증 명령어:**
1. backend tsc: `cd packages/backend && npm run build` 또는 tsc 직접 호출
2. frontend tsc: `cd packages/frontend && npm run build:safe`
3. 박-단어 자가 grep: `Grep "박음|박힘|박는|박을|박힌|박지|박혀|박힙|박혔|박았|박혀서"` — 본 fix 안 0건
4. 모델명 자가 grep: `Grep "Opus|Sonnet|GPT|Claude"` — frontend 0건
5. native dialog 자가 grep: `Grep "alert\\(|confirm\\(|prompt\\("` — 본 fix 안 0건
6. 영역/본질/정합 과다 사용 자가 점검

---

## Self-Review

1. **Spec coverage**: 박성용 신고 2건 (LMS 제목 알럴 + 스크롤 사라짐) → Task 1~5 (알럴) + Task 6~7 (스크롤) = 100% 커버
2. **Placeholder scan**: TBD/TODO 0건
3. **Type consistency**: alimtalkNextSubject string 타입 일관
4. **D218+ fix 정합**: 옛 분기 코드 유지 + 검증 컬럼만 정정 (N/S/A 옵션 skip 흐름 유지)
5. **Full pattern grep**: backend 2 endpoint (1354 직접발송 + 605 별건) + frontend 3 컴포넌트 (DirectSendPanel + Dashboard + AlimtalkSendModal) 전수 처리
