# D91 — QA 버그리포트 10건 전면 수정 (2026-03-23)

> **소스:** 한줄로_20260323.pptx (테스터 슬라이드 10개)
> **수정 방침:** 컨트롤타워(utils/) 우선 수정, 인라인 로직 금지, 근본 원인 해결

---

## 수정 요약

| 그룹 | 버그 | 슬라이드 | 근본 원인 | 수정 내용 |
|------|------|----------|----------|----------|
| 1 | **A. 미등록 회신번호 발송 차단** | 1 | 080 번호 미설정 시 에러 메시지 부정확 | 에러 메시지 개선 (원인 안내) |
| 1 | **B. 발신번호 배정 미작동** | 2 | CT-08에 assignment_scope 필터 없음 | CT-08에 userId+assignment_scope 필터 추가 |
| 2 | **C. 담당자 브랜드별 공유** | 3 | companies 테이블 company_id 단위 저장 | users.manager_contacts 추가 (브랜드별 격리) |
| 3 | **E. 스팸테스트 타겟 불일치** | 5 | autoSpamTestWithRegenerate에 firstRecipient 미전달 | 타겟 필터 적용 샘플 고객을 firstRecipient로 전달 |
| 3 | **H. 스팸테스트 정확성** | 8 | E와 동일 원인 | E와 동일 수정으로 해결 |
| 3 | **I. 소수점 잔존** | 9 | 프론트 인라인 replaceVars에 숫자 포맷팅 없음 | TargetSendModal, AiCustomSendFlow 숫자 포맷팅 추가 |
| 4 | **F. LMS 제목 미필수** | 6 | campaigns.ts에 subject 필수 검증 없음 | 발송 경로에 LMS/MMS subject 필수 체크 추가 |
| 4 | **G. 맞춤한줄 SMS→LMS 전환 불가** | 7 | 바이트 초과 경고만, 전환 UI 없음 | LMS 전환 확인 모달 추가 |
| 5 | **D. 평균주문금액 필터** | 4 | 자동 타입 감지에서 공백 trim 누락 | sampleValues 필터링 강화 + trim 적용 |
| 5 | **J. 발송결과 제목 미표시** | 10 | results.ts SELECT에 subject 미포함 | subject 추가 + ResultsModal 제목 표시 |

---

## 상세 수정 내역

### 그룹1: 콜백번호 관련 (A+B)

#### A. 미등록 회신번호 발송 차단 — invito01
- **현상:** 직접발송에서 "수신거부번호가 로딩되지 않았습니다" 에러로 발송 불가
- **근본 원인:** 080 수신거부번호가 회사에 설정되지 않은 상태에서 광고 발송 시도 → 부정확한 에러 메시지로 사용자 혼란
- **수정:** Dashboard.tsx 에러 메시지를 "광고 발송을 위해 수신거부번호(080) 설정이 필요합니다. 설정 > 발신번호 관리에서 등록해주세요."로 변경

#### B. 발신번호 사용자 배정 미작동 — 시세이도
- **현상:** 나스에만 배정한 번호를 다른 브랜드 사용자도 사용 가능
- **근본 원인:** CT-08 callback-filter.ts의 미등록 번호 조회 쿼리에 assignment_scope 필터 없음 → 회사 전체 등록 번호가 허용됨
- **수정:**
  - `filterByIndividualCallback()` 시그니처에 `userId?` 파라미터 추가
  - 미등록 번호 조회 시 `assignment_scope='all'` 또는 본인 배정된 `'assigned'` 번호만 허용
  - campaigns.ts 2개 호출부(AI send, direct-send)에서 userId 전달

**수정 파일:**
- `packages/backend/src/utils/callback-filter.ts` — CT-08 userId 파라미터 + assignment_scope 필터
- `packages/backend/src/routes/campaigns.ts` — 호출부 userId 전달 (2곳)
- `packages/frontend/src/pages/Dashboard.tsx` — 에러 메시지 개선 (3곳)

---

### 그룹2: 담당자 브랜드별 격리 (C)

- **현상:** sh_sh에서 담당자 변경 시 시세이도 전체 브랜드에 동일 적용
- **근본 원인:** `companies.manager_contacts`가 company_id 단위 → 동일 회사 내 모든 브랜드가 하나의 담당자 공유
- **수정:**
  - **DB:** users 테이블에 `manager_contacts` JSONB 컬럼 추가 (마이그레이션 완료)
  - **GET /settings:** 사용자별 manager_contacts 우선 반환, 없으면 companies fallback
  - **PUT /settings:** manager_contacts를 users 테이블에 저장 (사용자별 독립)
  - **POST /test-send:** 사용자별 manager_contacts 우선 조회
  - 하위호환: users.manager_contacts 컬럼 미존재 시 기존 companies 동작 유지

**수정 파일:**
- `packages/backend/src/routes/companies.ts` — GET/PUT /settings 사용자별 manager_contacts
- `packages/backend/src/routes/campaigns.ts` — test-send 사용자별 조회

**DB 마이그레이션 (서버 실행 완료):**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_contacts jsonb DEFAULT NULL;
UPDATE users u SET manager_contacts = c.manager_contacts FROM companies c WHERE u.company_id = c.id AND u.user_type IN ('admin', 'company_admin') AND c.manager_contacts IS NOT NULL AND u.manager_contacts IS NULL;
```

---

### 그룹3: 소수점 잔존 (I) + 스팸테스트 타겟 불일치 (E+H)

#### E+H. 스팸테스트 타겟 불일치
- **현상:** 성별:여성+지역:서울 타겟인데 "경기 여성 유지우님" 데이터로 스팸테스트 진행
- **근본 원인:** ai.ts에서 `autoSpamTestWithRegenerate()` 호출 시 `firstRecipient` 미전달 → CT-09가 타겟 필터 없이 `ORDER BY created_at DESC LIMIT 1`로 임의 고객 조회
- **수정:**
  - **한줄로(generate-messages):** filters 파라미터가 있으면 buildFilterWhereClauseCompat으로 타겟 필터 적용하여 샘플 고객 추출 → firstRecipient로 전달
  - **맞춤한줄(custom generate-messages):** req.body.sampleCustomer 우선 사용, 없으면 DB 조회 → firstRecipient로 전달

#### I. 소수점 잔존
- **현상:** 맞춤한줄 스팸필터 미리보기 + 직접타겟발송 미리보기에서 "1000.00", "35000.00" 표시
- **근본 원인:** 프론트 인라인 replaceVars에서 `String()` 변환만 하고 숫자 포맷팅(toLocaleString) 미적용
- **수정:**
  - TargetSendModal.tsx replaceVars: 숫자 감지 → toLocaleString('ko-KR') 적용
  - AiCustomSendFlow.tsx replaceSampleVars: data_type 의존 제거 → 순수 숫자 패턴 매칭으로 포맷팅
  - AiCustomSendFlow.tsx 스팸필터 핸들러 내 replaceVars: 동일 포맷팅 적용

**수정 파일:**
- `packages/backend/src/routes/ai.ts` — 스팸테스트 firstRecipient 전달 (2곳)
- `packages/frontend/src/components/TargetSendModal.tsx` — replaceVars 숫자 포맷팅
- `packages/frontend/src/components/AiCustomSendFlow.tsx` — replaceSampleVars + 스팸필터 replaceVars 숫자 포맷팅

---

### 그룹4: LMS 관련 UX (F+G)

#### F. LMS 제목 미필수
- **현상:** 단문→LMS 전환 시 제목 없이 발송/예약 가능
- **근본 원인:** campaigns.ts 발송 경로에 subject 필수 검증 없음
- **수정:** 직접발송(direct-send), AI 캠페인 발송(/:id/send) 경로에 `LMS/MMS && !subject` 체크 추가

#### G. 맞춤한줄 SMS→LMS 전환 불가
- **현상:** SMS 추천 문안이 90바이트 초과인데 경고만 뜨고 LMS 전환 방법 없음
- **근본 원인:** AiCustomSendFlow에 SMS 바이트 초과 시 LMS 전환 UI 미구현
- **수정:**
  - 기존 showAlert → LMS 전환 확인 모달(lmsConvertModal)로 교체
  - "취소" / "LMS 전환" 2버튼 제공
  - LMS 전환 시 channel state를 'LMS'로 변경

**수정 파일:**
- `packages/backend/src/routes/campaigns.ts` — LMS subject 필수 검증 (2곳)
- `packages/frontend/src/components/AiCustomSendFlow.tsx` — LMS 전환 모달

---

### 그룹5: 필터/표시 개선 (D+J)

#### D. 평균주문금액 필터 드롭다운만 제공
- **현상:** 평균주문금액이 이상/이하/범위 연산자 없이 값 선택만 가능
- **근본 원인:** enabled-fields 자동 타입 감지에서 sampleValues 필터링 시 공백 trim 부족 → 숫자로 인식 못함
- **수정:** sampleValues 필터링 강화 (null/빈값 정확히 제거 + trim 적용)

#### J. 발송결과 제목 미표시
- **현상:** LMS/MMS 캠페인 발송결과에서 제목 확인 불가
- **근본 원인:** results.ts SELECT에 subject/message_subject 미포함 + ResultsModal에 표시 로직 없음
- **수정:**
  - results.ts SELECT에 `c.subject, c.message_subject` 추가
  - ResultsModal 폰 미리보기에 LMS/MMS일 때 제목 표시 (bold + 하단 구분선)
  - 캠페인 정보에 "제목" 행 추가

**수정 파일:**
- `packages/backend/src/routes/customers.ts` — sampleValues 필터링 강화
- `packages/backend/src/routes/results.ts` — SELECT에 subject 추가
- `packages/frontend/src/components/ResultsModal.tsx` — 제목 표시 UI

---

## 전체 수정 파일 목록 (12개)

### 백엔드 (7개)
| 파일 | 수정 내용 |
|------|----------|
| `utils/callback-filter.ts` | CT-08 userId + assignment_scope 필터 추가 |
| `routes/campaigns.ts` | CT-08 userId 전달 + LMS subject 필수 + user 담당자 조회 |
| `routes/companies.ts` | GET/PUT settings 사용자별 manager_contacts |
| `routes/ai.ts` | 스팸테스트 firstRecipient 전달 (2곳) |
| `routes/customers.ts` | 자동 타입 감지 sampleValues 필터링 강화 |
| `routes/results.ts` | SELECT에 subject/message_subject 추가 |

### 프론트엔드 (5개)
| 파일 | 수정 내용 |
|------|----------|
| `pages/Dashboard.tsx` | 080 미설정 에러 메시지 개선 |
| `components/AiCustomSendFlow.tsx` | LMS 전환 모달 + 숫자 포맷팅 (2곳) |
| `components/TargetSendModal.tsx` | replaceVars 숫자 포맷팅 |
| `components/ResultsModal.tsx` | LMS/MMS 제목 표시 |

### DB 마이그레이션 (1건)
- `users.manager_contacts` JSONB 컬럼 추가 (실행 완료)

---

## D91 교훈

| 교훈 | 내용 |
|------|------|
| **컨트롤타워에 필터링 로직 추가 시 발송 경로도 확인** | D87에서 callback-numbers 조회에만 배정 필터 적용 → 발송 시 CT-08에는 미적용 → 배정이 무의미 |
| **스팸테스트 샘플은 반드시 타겟 필터 적용 고객** | 타겟과 무관한 임의 고객으로 테스트하면 개인화 불일치 + 스팸판정 신뢰도 하락 |
| **프론트 인라인 치환 함수에도 숫자 포맷팅 필수** | 백엔드 messageUtils.ts에만 포맷팅 추가하면 프론트 미리보기/스팸필터에서 소수점 잔존 |
| **발송 관련 검증은 백엔드에서 필수** | LMS 제목 필수 검증을 프론트에만 맡기면 API 직접 호출로 우회 가능 |
| **회사 단위 데이터 → 사용자 단위로 분리 시 하위호환** | users 컬럼 우선 → companies fallback 패턴으로 마이그레이션 점진적 진행 |
