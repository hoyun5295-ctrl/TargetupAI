# D144 — 0506 PDF 사용자 피드백 13건 분석 + 다음 세션 작업 가이드

> **PDF 출처:** `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\한줄로_20260506.pdf`
> **PDF 작성 시점:** 2026-05-06 17:17 (file mtime) — D144 후속1 배포(12:00경) 이후
> **작성일:** 2026-05-06 17:30
> **목적:** 미배포 D144 후속2 작업 + PDF 신규 이슈 13건의 연관성 분석 + 다음 세션 우선순위
>
> **🚨 다음 세션 시작 절차:**
> 1. 본 문서 + [`STATUS.md` § 4 D144 후속2 섹션](STATUS.md) 정독
> 2. 추측 0% — 모든 수정은 끌로드원칙 7-1(grep 전수 → 컨펌 → 컨트롤타워 → grep 재확인 → 표시 경로 검증)
> 3. 우선순위에 따라 진행 → **D144 후속2 미배포 작업 + PDF 신규 작업 한 번에 묶음 배포**

---

## § 1. 미배포 D144 후속2 작업과 직접 일치 (배포만으로 해결 — 추가 검증)

### 🔴 P4 — 발송통계 발송완료 표시 문제 (사용자 + 슈퍼관리자) ✅ 미배포 작업으로 해결

**신고:** 아이소이/폴라초이스. 전송 완료된 건이지만 리포트 미수신 대기건 있으면 status='sending' 표시. 상세 내역에서 "발송대기" 표시 → 고객사 문의.

**원인:** PG `campaigns.status='sending'` 영구 표시 (sync-results 호출 안 되거나 pending > 0 조건으로 'completed' 전환 차단)

**미배포 해결:** D144 후속2 status 'sending'→'completed' 정책 — INSERT 완료 = 발송완료. pending 무관 전환. 6곳 수정 완료 (campaigns.ts AI/직접발송/자동완료, auto-campaign-worker, campaign-lifecycle sync).

**잔여 검토 (다음 세션):** "리포트 미수신 결과대기 건에 대한 상태값 추가" — 사용자에게 표시할 값을 "발송 대기"가 아니라 "결과 대기"로 텍스트 변경 검토. 발송 상세 모달의 status 텍스트 라벨 수정.
- 코드 위치: `packages/frontend/src/pages/AdminDashboard.tsx` line 6037 부근 status 라벨 매핑
  ```ts
  smsDetailCampaign.status === 'sending' ? '발송중' : ...
  ```
- 사용자 측: 발송결과 모달의 동일 라벨

### 🔴 P7 — 슈퍼관리자 발송관리 캠페인관리 발송 후 성공/대기 표시 문제 ✅ 미배포 작업으로 해결

**신고:** 전송 후 성공 결과 받았으나 계속 대기 + 발송중 표시.

**원인:** P4와 같은 사고 패턴 — status='sending' 영구 표시 + pending 카운트 표시.

**미배포 해결:** P4와 동일 — D144 후속2 status 정책으로 자동 'completed'.

**잔여 검토 (다음 세션):** P4 잔여 검토와 동일 (라벨 텍스트 보강).

---

## § 2. 미배포 작업과 부분 연관 (추가 작업 필요)

### 🟠 P6 — 폴라초이스 실패 건 자동 충전 안되는 문제

**신고:** 폴라초이스 11시 예약 전송 실패 후 자동 재충전 안 됨. 선불 테스트는 환불 정상.

**임시 응대:** "대기가 다 떨어지면 계산해서 잔액 충전 예정"

**미배포 후속1과 연관:** D144 후속1 배포(12:00경)로 fire-and-forget 호출 복원 → sync-results 자동 호출 → prepaidRefund 환불 처리. **하지만 PDF 작성 시점(17:17)에도 문제 잔존.** 가능성:
1. 후속1 배포 시점에 폴라초이스가 진행 중이라 미적용 (대기 잔존)
2. 환불 로직 자체에 폴라초이스 케이스 별 이슈
3. sync-results 진입 조건(`success_count IS NULL OR success_count = 0`) — 한 번 sync 후 다시 진입 안 되어 추가 fail 환불 누락

**다음 세션 작업:**
- [ ] 폴라초이스 PG `campaigns` + `balance_transactions` 직접 조회로 환불 처리 상태 확인 (Harold님 SQL 안내)
- [ ] **추가 fail 발생 시 재환불 — sync-results 진입 조건 완화 검토:**
  - 코드 위치: `packages/backend/src/utils/campaign-lifecycle.ts` line 184, 304
  - 현재: `AND (success_count IS NULL OR success_count = 0)` — 한 번만 sync
  - 고려: `AND (success_count IS NULL OR sent_count > COALESCE(success_count, 0) + COALESCE(fail_count, 0))` — 새 결과 있으면 재sync
- [ ] 후속2 status 정책 적용 후 sync-results 자동 호출 시 환불 누락 0 검증

### 🟠 P8 — 슈퍼관리자 발송관리 모든 조회 출력 기간을 발송일시 기준 변경 (정산 직결)

**신고:** 4월에 5월 1일 발송으로 예약 → 현재 5월로 기간 잡으면 출력 X (등록일 기준이라). **사용자 측은 이미 수정됨 (results.ts buildPeriodFilter `COALESCE(sent_at, scheduled_at, created_at)` 적용).** 슈퍼관리자만 미수정.

**영향 영역 (grep 결과):**
- `packages/backend/src/routes/admin.ts:1186` — `buildDateRangeFilter('c.sent_at', startDate, endDate, 1)` ← 이미 sent_at 기준 ✅
- `packages/backend/src/routes/admin.ts:1559, 1564` — 전체 캠페인 목록 — `WHERE COALESCE(c.sent_at, c.scheduled_at, c.created_at)` ✅ 이미 적용
- `packages/backend/src/routes/admin.ts:2931-2932` — `/stats/export` CSV — `WHERE c.sent_at >= ...` ← 이미 sent_at 기준 ✅

**잠재 잔존 영역 (재검증 필요):**
- 슈퍼관리자 예약관리 탭 (AdminDashboard.tsx scheduledCampaigns) — 등록일 기준 또는 예약일 기준?
- 발송통계 탭의 기간 필터
- 정산(billing.ts) 화면

**다음 세션 작업:**
- [ ] 슈퍼관리자 화면별 기간 필터 grep 전수 점검 (admin.ts + manage-stats.ts + billing.ts 호출부)
- [ ] 등록일/예약일 기준 잔존 곳 → `COALESCE(sent_at, scheduled_at, created_at)` 통일
- [ ] 사용자 측과 동일 정책 보장

**연관:** D144 후속2 sent_at MySQL 직접(MIN sendreq_time) helper로 표시값 정확. 기간 필터 자체는 PG `c.sent_at` 그대로 사용 (DB 조회는 PG 컬럼). MySQL 직접은 표시값만.

---

## § 3. 별건 (미배포 작업과 무관) — 다음 세션 진행

### 🟠 P2 — 수스 직접발송 % 데이터 빠지는 문제

**신고:** 50%~30% 같은 메시지에서 `%~30%` 부분이 머지(개인화)로 인식되어 빠짐.

**임시 응대:** %% 안에 띄어쓰기 설정.

**원인 추정 (코드 read 필요):**
- `packages/backend/src/utils/messageUtils.ts:169` `replaceVariables` 함수
- 변수 치환 regex가 `%(.+?)%` 패턴으로 매칭 → fieldMappings에 정의된 변수가 아닌 임의 문자열도 빈값으로 치환?
- 또는 안전망 regex가 잔존 `%...%` 제거할 때 빈값 처리

**다음 세션 작업:**
- [ ] `replaceVariables` 코드 read + regex 패턴 확인
- [ ] fieldMappings에 정의된 변수만 치환하도록 강화 (또는 매칭 실패 시 원본 보존)
- [ ] 직접발송 5경로(test-send, AI send, direct-send, schedule, auto) 모두 동일 동작 검증
- [ ] 수정 후 "50%~30%" 같은 메시지 + "abc%~30%def" 등 엣지 케이스 테스트

### 🔴 P1 — 라프레리 직접발송 보관함 MMS 이미지 깨짐

**신고:** 보관함에서 MMS 불러옴 → 이미지 삭제 실수 → 보관함 다시 불러오거나 재로그인/하드리프레쉬해도 엑박. 실제 전송도 실패.

**임시 응대:** 보관함 삭제 후 재등록 → 정상발송.

**원인 추정 (코드 read 필요):**
- 보관함(file_uploads 테이블?)의 MMS 이미지 메타데이터와 실제 파일 동기화 깨짐
- 이미지 삭제 시 보관함 메타 갱신 X → 사라진 path를 그대로 가리킴

**다음 세션 작업:**
- [ ] file_uploads 또는 mms-image-util 관련 grep
- [ ] 이미지 삭제 시 보관함 메타 자동 갱신 (또는 보관함 표시 시 파일 존재 검증)
- [ ] 발송 사전 단계에서 이미지 부재 시 차단 (validateMmsPayload?)

### 🟡 P3 — 캐럿글로벌 주소록 기능 추가 요청

**신고:** (a) 주소록에서 직접입력으로 등록 기능 추가 / (b) 여러 주소록 체크하여 발송 가능

**다음 세션 작업:**
- [ ] address-books 라우트 + 모달 컴포넌트 위치 grep
- [ ] (a) 직접 입력 등록 기능 — 주소록 추가 모달에 "직접 입력" 모드
- [ ] (b) 다중 선택 — 주소록 목록 체크박스 + 발송 시 합집합

### 🟡 P5 — 중간관리자 고객DB 전체 삭제(초기화) 기능 추가

**신고:** 개별 삭제만 가능. 전체 삭제 X.

**다음 세션 작업:**
- [ ] 중간관리자 고객DB 화면 (사용자 측 CustomerDBModal/SettingsTab) 위치 grep
- [ ] 전체 삭제 버튼 + confirm 모달 (안전장치 — 입력으로 회사명 확인 등)
- [ ] backend 라우트 — DELETE /api/customers/all (admin/company_admin 권한, 회사 격리)
- [ ] 트랜잭션 + count 응답

### 🟡 P9 — 슈퍼관리자 고객사목록 출력 정렬 기준 필요

**신고:** 계정 수정 시 페이지 전환되면서 다른 페이지로 옮겨짐 → 수정 후 확인 어려움.

**다음 세션 작업:**
- [ ] AdminDashboard.tsx 고객사 목록 정렬 기준 (현재 어떤 정렬?)
- [ ] 정렬을 "회사명 오름차순" 등 안정적 기준으로 고정
- [ ] 수정 후 같은 페이지 유지 (페이지 state 유지)

### 🟡 P10 — 슈퍼관리자 고객사목록 고객DB 화면 단순화

**신고:** 중간관리자에 DB 전체 삭제 기능 추가하면(P5) 슈퍼관리자에서는 고객 DB 정보 출력 + 삭제 기능 불필요.

**Harold님 결정 표시:** "회의 시간에 말씀 하신 것처럼... 슈퍼관리자에 고객 DB를 확인하고 삭제할 수 있는 기능이 없어도 될 것 같습니다"

**다음 세션 작업:**
- [ ] P5 진행 후
- [ ] 슈퍼관리자 고객DB 화면을 "전체 초기화 버튼"만 남기고 정보 출력 제거
- [ ] 슈퍼관리자가 회사별 고객 데이터를 볼 필요가 정말 없는지 Harold님 재컨펌 (보안/감사 측면)

### 🟡 P11 — 슈퍼관리자 사용자 추가 시 소속회사 입력 가능

**신고:** 스크롤하여 업체 찾는 번거로움.

**다음 세션 작업:**
- [ ] AdminDashboard.tsx 사용자 추가 모달 — 소속회사 select → searchable select (autocomplete)
- [ ] 입력으로 검색 + 클릭 선택 둘 다 지원

### 🟡 P12 — 슈퍼관리자 발신번호 관리 등록 번호 검색

**신고:** 회신번호 등록 유무 확인 시 번호로 검색 X (금강처럼 회신번호 많이 등록된 경우).

**임시 응대:** 발신번호 등록창에서 중복 체크.

**다음 세션 작업:**
- [ ] 발신번호 관리 화면(callback-numbers/sender-numbers) 검색 input에 "번호" 필드 추가
- [ ] 정규화된 phone(highligh dash 제거)으로 검색

### 🟡 P13 — 슈퍼관리자 발송통계 업체 입력 조회

**신고:** 특정 업체 조건 조회 시 스크롤 선택만 있는데 입력조회 추가.

**다음 세션 작업:**
- [ ] P11과 같은 패턴 — 발송통계 회사 필터를 searchable select로 변경
- [ ] (P11과 함께 진행 가능 — 공통 SearchableSelect 컴포넌트 신설 검토)

---

## § 4. 우선순위 + 묶음 작업 권장

### 그룹 A — 미배포 작업 + PDF P4/P7 검증 (배포만으로 해결, 별도 코드 작업 거의 X)
- **D144 후속2 미배포 8개 파일** ([STATUS.md § 4 참조](STATUS.md))
- 추가 검토: P4 잔여 (status 라벨 텍스트 "발송중" 등 문구 검토)

### 그룹 B — 정산/환불 직결 (다음 세션 1순위)
- **P8** — 슈퍼관리자 기간 필터 sent_at 기준 통일 잔존 점검
- **P6** — 폴라초이스 환불 누락 검증 + sync-results 진입 조건 완화 검토

### 그룹 C — 발송 정확성 (다음 세션 2순위)
- **P2** — `replaceVariables` % 데이터 보존 검증 (변수 치환 regex 강화)
- **P1** — MMS 보관함 이미지 동기화 (별건 분석 필요)

### 그룹 D — UX 개선 (다음 세션 또는 후속)
- **P11 + P13** — searchable select 공통 컴포넌트 신설 후 두 곳 동시 적용
- **P12** — 발신번호 관리 번호 검색
- **P9** — 슈퍼관리자 고객사목록 정렬 안정화

### 그룹 E — 신규 기능 (다음 세션 또는 후속)
- **P5 + P10** — 중간관리자 고객DB 전체 삭제 + 슈퍼관리자 고객DB 화면 단순화 (묶음 작업)
- **P3** — 주소록 직접 입력 + 다중 선택

---

## § 5. 묶음 배포 전략 (다음 세션 권장)

### Option 1 — D144 후속2 + PDF 그룹 A/B 묶음 배포 (권장)
- 미배포 후속2 + P8 슈퍼관리자 기간 필터 잔존 점검 + P6 환불 검증
- 배포 후 검증: STATUS.md 6건 + P4/P7 화면 정상 + P8 슈퍼관리자 화면 정상 + P6 폴라초이스 환불 처리 확인

### Option 2 — 그룹 A/B/C까지 묶음 (시간 여유 있을 때)
- 추가로 P2 변수 치환 + P1 MMS 보관함

### Option 3 — 그룹 A만 먼저 빠르게 배포 (가장 안전)
- 후속2 미배포 작업만 즉시 배포
- P4/P7 검증 후 안정화 확인
- 그 후 별도 사이클로 PDF 다른 이슈 진행

---

## § 6. 끌로드원칙 7-1 절차 재확인 (다음 세션 시작 전 필수)

이번 세션(05-06)에서 같은 실수 반복하지 않기 위해:

1. **작업 시작 전 grep 전수 리스트업** → Harold님께 보고 → 컨펌
2. **컨트롤타워 우선** — 인라인 SQL/함수 금지. 기존 helper 재사용 또는 신설.
3. **SCHEMA.md 검증** — DB 컬럼 다루는 작업 시 SCHEMA.md 또는 `pg_constraint`/`information_schema` 직접 확인
4. **수정 후 grep 재확인** — 잔존 패턴 0건 + 의도된 위치 명확
5. **표시 경로 전수 확인** — 슈퍼관리자/사용자/예약관리/캠페인관리/캘린더 등 모든 소비처
6. **TS 빌드 EXIT=0** ≠ 완료. 실데이터 화면 검증까지

### 이번 세션 위반 사례 (회고)
- ❌ sent_at 매핑 작업 시작 전 grep 전수 리스트업 누락 → admin.ts에 인라인 매핑 들어가기 시작 → Harold 지적 → 멈추고 grep + 보고 + 컨펌 후 일괄 적용 (회복)
- ❌ SCHEMA.md 안 보고 작업 진행 → Harold 지적 → 즉시 SCHEMA.md grep으로 `app_etc1` 컬럼 정의 검증 (실제 코드는 campaigns.id 사용 — SCHEMA 문서 부정확)
- 교훈: **작업 시작 전 grep + SCHEMA 검증은 절대 건너뛰지 말 것.**

---

## § 7. 다음 세션 시작 권장 메시지 (Harold님께)

```
이전 세션 마감 보고 정독 완료 — D144 후속2 미배포(코드 8파일) + PDF 0506 13건 분석 완료.

확인:
1. STATUS.md § 4 D144 후속2 미배포 8파일 변경사항 + 배포 명령어 준비됨
2. status/D144-PDF-0506-FIXES.md — 13건 우선순위 + 코드 위치 + 미배포 연관성 분석 완료
3. 추측 0% / 끌로드원칙 7-1 절차 그대로

진행 옵션:
- Option 1 (권장): D144 후속2 + PDF 그룹 A/B 묶음 배포 (P4/P7 검증 + P8 기간필터 + P6 환불)
- Option 2: 그룹 A 먼저 빠르게 배포 (가장 안전)
- Option 3: 그룹 A/B/C 모두 한 번에

어느 옵션으로 진행할까요? Option 결정 후 그룹 B의 P8/P6 grep 전수 리스트업부터 시작하겠습니다.
```

---

> **본 문서는 다음 세션 시작 시 정독 후 진행. 새 이슈 발견 시 본 문서에 추가 후 재정렬.**
