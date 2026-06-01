# 알림톡 디버깅 4건 — 근본원인 + 수정 설계도 (직원 신고)

> 2026-06-01 조사. systematic-debugging Phase 1~3 완료(근본원인 코드 확정). **수정은 다음 세션(Phase 4).**
> 원칙: 묶음별 하나씩 세심하게, 추측 금지(전부 file:line 증거). 발송/돈 영역 = 수정 후 검증 + 필요 시 codex 이중검증.

## 4건 요약 (묶음)

| # | 증상 | 묶음 |
|---|---|---|
| 1 | 직접발송→알림톡 발송→알림톡 닫기 후 직접발송 모달이 알림톡 화면으로 남음 | A 모달 상태 |
| 2 | 알림톡 발송 후 수신자 리스트 미초기화 | A 모달 상태 |
| 3 | 변수 자동 고정(데이터 없이) + 변수 미지정에도 발송 | B 변수/검증 |
| 4 | 결과 "[알림톡 템플릿 미설정]" + 알림톡 미수신·대기고착 + LMS 대체 결과 미조회 | C 백엔드 파이프라인 |

---

## 묶음 A — 프론트 모달 상태 (#1, #2)

### #1 — 직접발송 모달이 알림톡 화면으로 남음
**근본원인 (확정):**
- 알림톡 모달 발송 위임 `onSendConfirm`이 `setDirectSendChannel('kakao_alimtalk')` 설정 — [Dashboard.tsx:3568](packages/frontend/src/pages/Dashboard.tsx#L3568). (executeDirectSend가 채널로 알림톡 분기 판단하므로 필요한 설정)
- 그런데 AlimtalkSendModal `onClose`는 `setShowAlimtalkSend(false)`만 하고 **directSendChannel을 'sms'로 되돌리지 않음** — [Dashboard.tsx:3545](packages/frontend/src/pages/Dashboard.tsx#L3545).
- 밑에 깔린 DirectSendPanel은 `directSendChannel='kakao_alimtalk'`이라 알림톡 패널 렌더 → 직접발송이 알림톡 화면.
- 기존 안전망(직접발송 메뉴 재진입 시 sms 리셋, [Dashboard.tsx:2323](packages/frontend/src/pages/Dashboard.tsx#L2323))은 "이미 열려있는 직접발송" 케이스 미커버.

**수정 방향:** AlimtalkSendModal `onClose`(3545)에서 `setDirectSendChannel('sms')` 추가. (발송 안 하고 닫는 경우에도 안전.)

### #2 — 발송 후 수신 리스트 미초기화
**근본원인 (확정):**
- AlimtalkSendModal의 `recipients`는 모달 로컬 state — [AlimtalkSendModal.tsx:102](packages/frontend/src/components/AlimtalkSendModal.tsx#L102).
- 발송은 위임(onSendConfirm) 후 Dashboard `executeDirectSend`에서 일어남. D225+에서 발송 후 모달을 일부러 안 닫음(Harold 의도) — [Dashboard.tsx:3586](packages/frontend/src/pages/Dashboard.tsx#L3586).
- 모달이 발송 성공 시점을 모르고, 로컬 `recipients`를 비우는 코드도 없음 → 리스트 잔존.

**수정 방향:** 발송 성공 신호를 모달에 전달(예: `resetSignal` prop 또는 발송 성공 콜백)해 `recipients`/`directInput` 초기화. 모달은 열린 채(D225+ 유지), 리스트만 비움.

---

## 묶음 B — 변수 매핑·발송 검증 (#3)

### #3-1 — 데이터 소스 없이 치환값 자동 고정
**근본원인 (확정):**
- 템플릿 선택 시 `handleSelectTemplate`가 변수명이 고객 필드 key/label과 일치하면 **무조건 `@@필드키@@` 자동 매핑** — [AlimtalkChannelPanel.tsx:163](packages/frontend/src/components/alimtalk/AlimtalkChannelPanel.tsx#L163) (특히 178~181줄).
- 파일 업로드·실제 데이터 유무와 무관. #{고객명}→label '고객명' 매칭→`@@name@@` 고정. 직접입력 수신자(이름 없음)엔 빈 값 발송 위험.

**수정 방향:** (택1, 다음 세션 Harold 확정) ① 자동 매핑 제거(사용자 명시 매핑만) / ② recipients에 해당 데이터 있을 때만 자동 매핑 / ③ 자동 매핑은 두되 발송 시 미해결 변수 차단(#3-2와 통합).

### #3-2 — 변수 미지정에도 발송
**근본원인 (확정):**
- `handleSend`가 수신자·템플릿·승인·대체문구·LMS제목은 검증하나 **템플릿 변수(kakaoTemplateVars)가 다 채워졌는지 미검증** — [AlimtalkSendModal.tsx:356](packages/frontend/src/components/AlimtalkSendModal.tsx#L356).
- 빈 변수 또는 데이터 없는 `@@필드@@` → 빈 값/원시 변수 발송 위험(고객에 깨진 메시지).

**수정 방향:** 발송 전 검증 추가 — 모든 #{변수}가 (직접값 채워짐) 또는 (`@@필드@@`이고 실제 수신자 데이터 존재)인지 확인, 아니면 차단 + 안내. 백엔드에도 동일 가드(이중 안전망).

---

## 묶음 C — 백엔드 발송·결과 파이프라인 (#4)

### #4-a — 결과 "[알림톡 템플릿 미설정]" (확정)
**근본원인 (확정):**
- 발송/commit 핸들러가 `campaigns.kakao_template_id`를 **한 번도 저장 안 함** — `kakao_template_id` 문자열이 campaigns.ts 전체 0건(grep 무매칭). 프론트가 보낸 `alimtalkTemplateCode`는 QTmsg용으로만 쓰고 FK 미저장. 핸들러는 코드로 템플릿 조회까지는 함 — [campaigns.ts:1324](packages/backend/src/routes/campaigns.ts#L1324).
- 결과 조회는 D227+-3에서 `campaigns.kakao_template_id` FK로 `kakao_templates` JOIN해 코드 읽음 — [results.ts:557](packages/backend/src/routes/results.ts#L557), 폴백 [results.ts:741](packages/backend/src/routes/results.ts#L741). FK가 항상 NULL → 항상 "미설정".
- **발송 쪽(FK 미저장) ↔ 결과 쪽(FK로 읽음) 불일치가 핵심.**

**수정 방향 (정밀):** 캠페인 INSERT에 `kakao_template_id` 컬럼·값 추가 —
- commit 경로 INSERT [campaigns.ts:1367](packages/backend/src/routes/campaigns.ts#L1367): 컬럼 목록에 `kakao_template_id` 없음 → 추가.
- 타깃 경로 INSERT [campaigns.ts:1685](packages/backend/src/routes/campaigns.ts#L1685): 동일하게 없음 → 추가.
- 값 = `alimtalkTemplateCode`로 조회한 kakao_template의 id(조회는 이미 [campaigns.ts:1324](packages/backend/src/routes/campaigns.ts#L1324)~1327에 있음 — 결과 row의 id를 INSERT 변수로 영속).
- ★ 발송 5경로(직접/타깃/자동/스케줄/테스트) 전수 — 알림톡 INSERT 모두 `kakao_template_id` 누락 점검(LESSONS_BACKEND 발송 5경로 원칙).

### #4-b — 알림톡 미수신 + 대기(1) 고착
**현황:** QTmsg에 접수됐으나 전달 안 됨(대기) → 12h 후 LMS 대체 도착. **#3(빈 변수)로 카카오가 반려 → 미전달 가능성** 의심되나, 실제 미전달 사유는 코드만으로 단정 불가 — QTmsg/IMC 발송 raw 로그·반려코드 확인 필요(Harold 영역).
**수정 방향:** ① #3 변수 검증으로 빈 변수 발송 차단(선행) ② QTmsg 발송 결과/반려코드 raw 확인 후, 미전달 사유가 변수 외 사유면 별도 조치.

### #4-c — LMS 대체발송 결과 미조회
**현황:** 실제 도착한 LMS 대체(resend)가 발송 결과에 안 잡힘. results.ts에 resend_type/resend_report_code 필드는 있음 — [results.ts:53](packages/backend/src/routes/results.ts#L53). 대체 건 집계/표시 흐름 점검 필요.
**수정 방향:** 결과 집계가 알림톡 원건 + 대체(resend) 건을 함께 조회·표시하도록 보완. (#4-a 수정 시 결과 쿼리 함께 검토.)

---

## 다음 세션 수정 순서 (제안)
1. **C #4-a** (가장 심각·확정·국소): commit 핸들러 kakao_template_id 저장 → 결과 정상화.
2. **B #3-2 + #3-1**: 발송 전 변수 검증(프론트+백) → #4-b 미전달 1차 해소 가능.
3. **A #1 + #2**: 모달 close 시 directSendChannel 리셋 + 발송 후 리스트 초기화.
4. **C #4-b/#4-c**: QTmsg raw 확인(#4-b) + 결과 대체건 집계(#4-c).
- 발송/결과 영역 = 수정 후 tsc + 단위검증 + 운영 영향 점검. DB 변경 시 db_column_verify.

---

## 다음 세션 시작 가이드 (이 문서만으로 바로 수정 — 재조사 불필요)

**1) 정독 순서**: 이 문서 → `status/lessons/LESSONS_FRONTEND.md` + `LESSONS_BACKEND.md`(발송 5경로 원칙) → 코드: `AlimtalkSendModal.tsx`(handleSend·handleClose·recipients) / `alimtalk/AlimtalkChannelPanel.tsx`(handleSelectTemplate 자동매핑) / `Dashboard.tsx`(3532·3545·3565 알림톡 흐름, 2323 채널 리셋) / `campaigns.ts`(1291~1480 commit, 1367 INSERT) / `results.ts`(557·741 템플릿 JOIN).

**2) 수정 전 DB 검증 (db_column_verify — #4-a 필수)**:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='campaigns' AND column_name='kakao_template_id';  -- 1행이어야 존재. 0행이면 ALTER 먼저.
```
results.ts(D227+-3 주석)상 존재하나, 코드 작성 전 실측 확인 의무.

**3) 수정 순서**: 위 "다음 세션 수정 순서" 그대로(C #4-a → B #3 → A #1·#2 → C #4-b/#4-c). 각 건 후 frontend/backend tsc 0 + 자가 grep(모델명·박-단어·native dialog) + 발송 영역 단위검증.

**4) 코드만으로 단정 불가 = Harold 영역**: #4-b 미수신·반려 사유 = QTmsg/IMC raw 발송 로그·반려코드 직접 확인(운영 검증). 코드 수정 책임은 #3 변수 검증까지 — 변수 빈 값 차단 후에도 미수신이면 그때 QTmsg raw 요청.

**5) 절대 원칙**: 발송 5경로 동일 패턴 전수 점검 / CT(utils) 인라인 금지 / 추측 금지(막히면 추가 grep) / native dialog 0(ConfirmModal+useToast) / 모달은 화이트·모던(대시보드 톤).

**6) 확정 상태**: #1·#2·#3-1·#3-2·#4-a = 근본원인 코드 확정(file:line). #4-b·#4-c = 방향 확정 + 일부 운영 raw 확인 필요. 이번 세션은 조사·설계만 — 코드 수정 0.
