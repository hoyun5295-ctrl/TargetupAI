# 디버깅 세션 정리 — 2026-06-02

진행 방식: Harold님 "여기까지" 지시 전까지 각 건의 내용만 파악·정리한다. 코드 수정·SQL/grep 검증 명령은 내리지 않는다. 실제 fix는 정리 완료 후 건별로 따로 진행한다.

---

## 건 1 — 알림톡 발송이 슈퍼관리자 통계에서 LMS로만 잡힘 (구분 누락)

### 증상 (직원 캡처 3장)
- 케이스 1 — 알림톡만 전송(대체발송 없음):
  - 계정 psy5868(박성용), 문자타입 LMS, 발송유형 직접
  - 캠페인 15 / 대상건 15 / 전송건 0 / 성공 0 / 실패 0 / 대기 0 — 전 항목 0
- 케이스 2 — 알림톡 전송 후 실패분 LMS 대체발송:
  - 계정 IVITO123 / psy5868(박성용), 문자타입 LMS, 발송유형 직접
  - 통계: 대상건 6 / 전송건 8 / 성공 6 / 실패 2
  - 발송내역 모달 8건: 1000(LMS 성공) 2건 + 1800(카카오 성공) 4건 + 7300(카카오 기타에러) 2건
  - 실제 = 알림톡 4 성공 / 2 실패→LMS 대체 2 성공 / 합계 성공 6·실패 2
  - 같은 화면 캐럿글로벌(carrotglob) 건도 LMS 8/8 성공으로 표시

### 직원 기대 동작
- 슈퍼관리자 화면에서 알림톡 발송과 LMS(대체)를 구분해 표시.
- 정산은 LMS 기준으로 처리하더라도, 통계 화면에서는 알림톡/LMS 구분이 보여야 함.

### 기존 맥락 (메모리 project_2026_0601_credit_recharge_alimtalk_debug D섹션 C2 — 대기 중이던 작업과 동일)
- QTmsg 실제 동작: 알림톡 K행(status 92) + 별도 LMS 대체 L행(성공 1000 / 실패 2002, k_oriseq=원본 K seqno). 대체 L행은 app_etc1 NULL.
- 통계 집계가 app_etc1 기준이라 K행·대체 L행이 캠페인에 안 붙어 누락 가능.
- 2026-06-01 #4-c 수정은 K행 app_etc1만 채움 → 별도 대체 L행(NULL·k_oriseq)은 여전히 미집계.
- 케이스 1의 전 항목 0 = K행 집계 누락 가능성 / 케이스 2의 LMS 일괄 표기 = 알림톡 성공·대체 성공 구분 없음.

### fix 단계에서 검증할 것 (추측 금지 — 실제 데이터 확인 후 진행)
- 슈퍼관리자 통계 쿼리의 문자타입 판정 기준 (왜 알림톡이 LMS로 찍히는지)
- 카카오 성공코드 1800이 성공 집계에 포함되는지 (SUCCESS_CODES 구성)
- 케이스 1에서 K행 status 92가 전송/성공/실패 어디에도 안 잡히는 원인
- 대체 L행(k_oriseq) 귀속·수신자당 최종 1건 집계 기준 (카운트 기준 Harold 확정 필요)

### 상태
내용 파악 완료. 코드 수정·SQL 검증 미실시.

---

## 건 2 — 발송 통계가 실제 발송일(예약 발송일시)이 아닌 등록일 기준으로 집계됨

### 증상 (직원 캡처 4장)
- AK플라자 분당점 라프레리(laprairieak)가 5월 30일에 6월 발송 일정으로 LMS 2건 예약
  - 발송결과 리스트: 발송일시 06.18 11:00 / 06.05 11:00, 등록일시 둘 다 05.30, 상태 "예약", 각 대기 1
- 슈퍼관리자 일별 통계(2026-05-30 단일일 조회): 라프레리 전송 175 / 성공 166 / 실패 7 / 대기 2 — 이 예약 2건이 5월 30일 "대기"에 포함됨
- 엑셀 다운로드: 2026-05-30 laprairieak LMS 직접, 대상건 2 / 전송건 2 / 성공 0 / 실패 0 / 대기 2
- 환경: Microsoft Edge

### 직원 기대 동작
- 발송일자(실제 발송 예정일 = 발송일시) 기준으로 통계가 잡혀야 함.
- 5월 30일에 등록만 한 6월 예약 건이 5월 30일 통계의 대기로 잡히면 안 됨.

### 파악된 차이
- 발송결과 리스트는 발송일시(06.05·06.18)와 등록일시(05.30)를 따로 들고 있음 → 데이터에는 두 날짜가 다 존재.
- 일별 통계·엑셀은 이 예약 건을 05.30에 묶어 "대기"로 집계 → 날짜 기준이 발송일시가 아니라 등록일시로 보임.

### fix 단계에서 검증할 것 (추측 금지 — 실제 데이터 확인 후 진행)
- 일별/월별 통계 쿼리의 날짜 GROUP/WHERE 기준 컬럼 (등록일 vs 발송일시 vs 예약일시)
- 엑셀 다운로드 통계가 같은 쿼리·같은 날짜 기준을 쓰는지
- 예약(대기) 상태 건을 발송일 기준 어느 날짜에 귀속할지 (예약 발송일시 기준이 맞는지 Harold 확정)

### 상태
내용 파악 완료. 코드 수정·SQL 검증 미실시.

---

## 건 3 — 슈퍼관리자 템플릿 관리에서 모든 템플릿 상태가 "승인대기"로만 표시됨

### 증상 (직원 캡처 2장)
- 슈퍼관리자 템플릿 관리(알림톡 탭) 목록에서 모든 템플릿 상태가 "승인대기"로 표시됨
  - 테스트계정2 템플릿 8건(문의 접수 요청 / 구매완료안내 / 교환 안내 / 참여 시 유의사항 / 채널추가형 승인안내 / 주문처리 / sdfsdf / 승인 안내) 전부 승인대기
  - 그중 B_XX_018_02_79965, B_IV_013_02_79955 등 실제 템플릿 코드가 붙은 건은 카카오 검수를 통과(승인)한 코드로 보임
- 같은 화면 상단 채널 목록(팝폰 @poppon / 인비토 @invitocorp)은 "승인" 상태로 정상 표시됨
- 실제로는 승인·반려 액션이 있었던 템플릿들인데 슈퍼관리자에서만 전부 승인대기로 보임

### 직원/Harold 진단
- 사용자(고객사 관리자) 화면에서는 상태가 정상 표시됨.
- 슈퍼관리자 화면만 상태 반영이 안 됨 → 슈퍼관리자 쪽 조회/표시 로직에 수정이 누락됐을 가능성.

### fix 단계에서 검증할 것 (추측 금지 — 실제 데이터·코드 확인 후 진행)
- 슈퍼관리자 템플릿 목록 조회 경로와 고객사 화면 조회 경로가 같은 상태 컬럼·같은 매핑을 쓰는지
- 슈퍼관리자 쪽 상태 매핑(원본 상태값 → 승인/반려/승인대기)이 누락·고정값인지
- 카카오 검수 상태 동기화 결과가 슈퍼관리자 조회 경로에 반영되는지
- 채널은 "승인"으로 잘 보이는데 템플릿만 승인대기인 차이 (채널 상태와 템플릿 상태가 다른 컬럼·다른 동기화 경로인지)

### 환경
직원 기재 없음 (캡처상 빈칸)

### 상태
내용 파악 완료. 근본원인 확정 — 아래 종합 참조.

---

## 검증 완료 — 세 건 확정 근본원인 + 수정안 (2026-06-02)

DB 검증(예약 sent_at · 알림톡 캠페인 · 템플릿 status · SMSQ_SEND 8행 · 컬럼 존재)으로 세 건 모두 확정.

### 건 1 확정 — 알림톡 통계 LMS + 발송내역 유형
- 알림톡 캠페인 = `send_channel='alimtalk'` + `message_type='LMS'`. 통계·엑셀·발송내역이 message_type만 봐서 LMS로 표시. 카운트는 정상(app_etc1=campaignID 매칭, K행+대체 L행 모두 채워짐, 1800·1000 성공 집계). 케이스1 "0"은 6/1 app_etc1 보강 이전 과거 발송분.
- 대체발송 식별 = `msg_type='L' AND k_oriseq 있음`(원본 K행 seqno). 검증6에서 361672→361670, 361671→361669 확인.
- 수정: ① sms-detail(admin.ts:1808) SELECT에 k_oriseq 추가 → 유형 산출(K=알림톡 / L+k_oriseq=카카오실패 대체발송 / L=LMS / S=SMS / M=MMS) → 프론트 모달에 유형 컬럼 ② 통계 문자타입은 send_channel='alimtalk'이면 "알림톡"(과금 message_type=LMS 유지, 표기만) ③ results.ts(고객사) 동일 표시 전수 grep 후 통일.

### 건 2 확정 — 예약이 등록일 통계에 잡힘
- 근본원인 = direct-send-worker.ts:122 대량 직접발송 워커가 예약(status='scheduled')에도 sent_at=NOW()를 조건 없이 set. AI 경로(campaigns.ts:884·898)·동기 직접발송(:2032)은 분기로 막았는데 이 워커만 누락. 통계는 sent_at 기준이라 등록일에 잡힘.
- 수정: ① worker:122 예약 시 sent_at 제외 (`${cfg.scheduled ? '' : ', sent_at = NOW()'}`) ② 통계 4곳 날짜 기준 COALESCE(c.sent_at, c.scheduled_at) — querySendStats·/stats/send·/stats/export·querySendStatsDetail, 필터+그룹핑 ③ 기존 보정 SQL(Harold): UPDATE campaigns SET sent_at=NULL WHERE status='scheduled' AND sent_at IS NOT NULL.

### 건 3 확정 — 슈퍼관리자 템플릿 전부 승인대기
- DB status 정확(APPROVED 9 · KREJ 1 · DRAFT 1 · DELETED 3). 백엔드(/admin/kakao-templates)는 raw status 반환. 슈퍼관리자 프론트가 이 값들을 인식 못 해 전부 승인대기 표시. 고객사 화면(/templates)은 정상 = 슈퍼관리자 프론트 매핑 버그.
- 수정: 슈퍼관리자 템플릿 관리 컴포넌트의 status 매핑을 고객사 화면과 동일하게(APPROVED/REQUESTED/REJECTED/KREJ/DRAFT/DELETED 처리). 컴포넌트 위치 확인 후.

### 진행 순서 (no_parallel_tasks)
건 1 → 건 2 → 건 3. 각 건 tsc + 자가 grep 후 다음으로.

---

## 구현 완료 (2026-06-02, 미배포)

### 건 1 완료 — 발송내역 유형 + 통계 문자타입
- sms-result-map.ts: `getSendTypeLabel`(K=알림톡 / L+k_oriseq=카카오실패 대체발송 / L=LMS / S=SMS / M=MMS) + `getCampaignChannelLabel`(send_channel='alimtalk'→알림톡). TDD 15/15 GREEN.
- admin.ts: sms-detail SELECT에 k_oriseq + 행 sendType(카카오 분기 포함) / 통계 엑셀 send_channel SELECT + 그룹 key + 문자타입 getCampaignChannelLabel.
- results.ts: SMS_DETAIL_FIELDS·SMS_EXPORT_FIELDS k_oriseq 추가 + 엑셀 카카오 NULL k_oriseq(both 컬럼 수 불일치 유지=silent corruption 방지) + enrichedMessages send_type + 엑셀 msgTypeDisplay getSendTypeLabel.
- AdminDashboard.tsx·ResultsModal.tsx: 발송내역 수신번호 앞 "유형" 컬럼(colSpan 9→10).

### 건 2 완료 — 통계 날짜 기준 (수정안 정정)
- 정정: direct-send-worker sent_at 제외 X. 환불·결과동기화가 `sent_at IS NOT NULL`을 "발송됨"으로 의존(campaign-sync-worker:241·mysql-refund-sweeper:368 등)하여, 발송 워커는 미수정.
- stats-aggregation.ts: `STAT_DATE_EXPR = COALESCE(c.scheduled_at, c.sent_at)` 신설. querySendStats·querySendStatsDetail 날짜 기준 적용.
- admin.ts: /stats/send·/stats/send/detail·/stats/export 날짜 기준 STAT_DATE_EXPR.
- 예약=scheduled_at(발송예정일), 즉시=sent_at. 기존 예약 데이터 보정 SQL 불필요(scheduled_at 우선). DB 작업 0.

### 건 3 완료 — 슈퍼관리자 템플릿 상태
- 근본: AdminDashboard가 소문자 'approved'/'pending'으로 비교 → DB 대문자(APPROVED/REQUESTED/KREJ) 불일치 → 전부 승인대기. 고객사(AlimtalkManagementSection)는 대문자 STATUS_LABELS라 정상.
- AdminDashboard.tsx: 템플릿 status 표시 → `getAlimtalkTemplateStatus`(formatDate, 대문자·동기화 값 정상 매핑) 알림톡+RCS / 승인·반려 버튼 조건 검수중 / 필터 클라이언트 라벨 기준(KREJ 등 호환, API status 파라미터 제거).

### 검증
backend tsc 0 / frontend tsc 0 / TDD 15/15 / 변경분 자가 grep 0(박-단어·모델명·native dialog).

### 별도 발견 (건 1~3 무관, Harold 판단)
- results.ts SMS↔카카오 UNION 컬럼 수 기존 불일치(상세 17 vs 15, 엑셀 10 vs 11) → send_channel='both' 발송결과 조회는 기존에도 에러(단독 발송은 정상).
- admin.ts kakao-templates approve/reject(2991/3026)는 주석상 frontend 미사용 dead route(슈퍼관리자 승인은 IMC `/api/alimtalk/templates` 워크플로우).

### 배포 (Harold)
DB 작업 없음. 코드만 — backend + frontend `build:safe` + pm2 restart.
