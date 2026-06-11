# 디버깅 5건 수정 설계서 — 2026-06-11

> 작성: 2026-06-11 비토. 원자료 = `status/debug-notes-2026-06-11.md` (현상·캡처 실측 — 함께 정독).
> 본 문서 = 다음 세션의 작업 설계. **착수 전 Harold님 승인 필수(6원칙 ⑥). 발송·돈에 닿는 수정은 실측 1건 시나리오 포함(⑤).**
> 우선순위: P0(시한·돈) → P1(근원 코드) → P2(확인 후 fix) → P3(과거 전수).

---

## P0-1. [건 1] 인비토 자동발송 잔존 실행 — 시한 06-16(월) 10:00

### 확정 원인 (코드)
- `utils/auto-campaign-worker.ts` — app.ts 매 1분 setInterval. `status='active' AND next_run_at <= NOW()` 실행 후 next_run_at을 다음 주기로 갱신(L1135-1136) → weekly 영원 반복.
- `routes/auto-campaigns.ts:295` — D188 폐기 = POST만 410. "기존 활성 자연 소멸" 전제가 weekly에 불성립. 메뉴 제거로 고객사 중지 수단 없음. PUT/DELETE `/:id`는 잔존(L560/L876).

### 수정 설계
1. 즉시 데이터: 인비토 캠페인 종료.
   ```sql
   SELECT id, campaign_name, schedule_type, schedule_day, schedule_time, next_run_at FROM auto_campaigns WHERE status='active';  -- 전수 확인
   UPDATE auto_campaigns SET status='paused', updated_at=NOW() WHERE id='<인비토 마일리지 id>';
   ```
2. 코드: 전 고객사 active 일괄 종료(Harold 결정) + `auto-campaign-worker`에 폐기 가드(실행 진입 시 차단 로그) 또는 app.ts 워커 등록 해제. 레코드는 보존(삭제 X).
3. 이력 삭제 요청 → 보존 권장(정산 근거). [Harold 결정]
### 검증: UPDATE 후 next_run_at 도래 시각에 실행 0건 + 담당자 문자 0건 확인.

## P0-2. [건 3] 에이치피오 87,014건 — 취소로 굳은 캠페인 실적 정정 (청구)

### 확정 원인 (오늘 사고 후유증)
- 캠페인 status='cancelled'로 굳음 → ① 집계 워커·통계 제외 ② 발송내역/엑셀 "취소된 캠페인" 가드 차단 ③ 발송일시=등록일시(예약 sent_at 생성 시점 기록 — 0609 확정 문제) ④ 정산 누락 위험.
- MySQL 통신사 결과는 실재(SKT 39,162·KT 22,646·LG U+ 21,999 분포 표시 확인).

### 수정 설계 (데이터 정정 — 코드 수정 아님)
1. 캠페인 식별(0611 사고 메모리 bfee8e09 대조):
   ```sql
   SELECT id, status, send_phase, total_count, sent_at, scheduled_at, send_config->'sentTables' FROM campaigns WHERE total_count=87014 AND created_at >= '2026-06-10';
   ```
2. MySQL 실측 재집계: 에이치피오 전 라인 합집합 `_202606` 월별 이력에서 본 campaign_id의 성공/실패 카운트(청구 근거 확정).
3. 정정 UPDATE: status='completed' + sent_at='2026-06-11 10:00'(KST) + success/fail counts=실측 + result 캐시 재계산. 이후 사용자 화면·엑셀·슈퍼관리자 통계·정산 4경로 교차 확인.
4. audit-log(ceo 전용)에 정정 사유 기록(사고 정정 — 업체 합의 "성공 과금 후 100만원 차감").
### 검증: 정정 후 엑셀 다운로드 행수 = MySQL 성공+실패 합 일치.

## P0-3. [건 4] 폴라초이스 227건 미환불 — 환불 + 원인 확정

### 코드 체인 (이번 세션 확정 — 전 계열 공통 로직)
- 차감: `utils/direct-send-core.ts` — `countStagingFiltered()`가 **COUNT 산식만**으로 sendCount(=total-중복-수신거부 DISTINCT) 계산 → 모달 표시·`prepaidDeduct(spec.total)`(L63)·campaigns.target_count가 전부 이 **예상치**.
- 적재: `utils/direct-send-worker.ts` — 발송 시점에 staging **실제 DELETE**(수신거부 USING 조인·중복 rn>1, L72-91) 후 청크 INSERT(`processSendChunk`). **산식(COUNT)과 실제 정제(DELETE)+INSERT skip이 별개 구현** → 차이 발생 가능.
- 환불 안전망: ① worker `failed = target_count - sent` 환불(L146-151) — **6/4 운영 코드(6cf6305)에도 실재**했으나 try/catch 1회성(실패 시 재시도 없음·기록 없음) ② `mysql-refund-sweeper` — MySQL **실패 행 기준**이라 행이 없는 적재 누락분은 영구 미포착.
- 따라서 227건 미환불의 직접 원인은 다음 중 하나(현장 데이터로만 확정 가능):
  (a) worker 환불 호출이 예외로 삼켜짐 (b) target_count가 차감 수와 달랐음 (c) 환불은 됐는데 보고 시 누락 — 확정 SQL/로그:
   ```sql
   SELECT target_count, processed_count, send_config->>'msgType', status, send_phase FROM campaigns WHERE id='<폴라 6/8 캠페인>';
   SELECT created_at, amount, description FROM balance_transactions WHERE reference_id='<캠페인 id>' ORDER BY created_at;  -- 차감/환불 전 행
   ```
   ```bash
   pm2 logs --lines 5000 --nostream | grep "direct-send-worker.*완료 — 발송"   # "발송 X/Y, 실패 Z" 한 줄이면 sent/failed 즉시 확정
   ```

### 수정 설계 (폴라초이스 1건이 아니라 로직 근원 — 재발 불가 구조)
1. [정산] 폴라초이스 227건 환불(실측 확정액. 60.5원 기준 13,733.5원) + 동일 구조 과거 전수(P3).
2. [근원 A — 확정 카운트] worker 적재 완료 시점에 campaigns의 확정 건수를 **실측(sent)으로 UPDATE**(target_count는 차감 기준으로 보존하되 확정 전송 수 컬럼/계산을 분리) → 화면·통계가 예상치를 영원히 들고 있지 않게.
3. [근원 B — 차감↔적재 대조 sweeper 신설(6원칙 ③)] 발송 시작 캠페인 대상: balance_transactions 차감 건수 합 vs MySQL 적재 행수 비교 → 차액 자동 환불(idempotent, 설명에 "적재 제외 N건: 수신거부 n1·중복 n2·무효번호 n3") + worker 1회성 환불의 실패를 자동 복구. cancelled-queue-sweeper/mysql-refund-sweeper와 같은 워커 패턴.
4. [근원 C — 제외 사유 기록] worker 정제 DELETE 건수(수신거부/중복)와 processSendChunk skip 건수를 campaigns.send_config에 기록 → 업체 설명("대상-전송 차이 사유") 즉시 가능.
5. [업체 회신 문구] "예약 등록 시점 이후 추가된 수신거부·중복·무효번호는 발송 직전 자동 제외됩니다(수신자 보호). 제외분은 자동 환불되며, 이번 227건은 환불 결함으로 누락되어 환불 처리했습니다." — 원인 확정 후 수치 채워 발송.
### 검증(실측 1건 — ⑤): 소량 캠페인에 수신거부 1·중복 1 섞어 등록 → 차감 N, 적재 N-2, 자동 환불 2, 화면 전송 N-2 일치 확인.

## P1. [건 5] 수량 표기 출처 단일화 (건 4와 한 몸)

### 확정 사실
- 캠페인 기록(985/1,906)=차감 기준 예상치, 실측(978/1,903)=MySQL 행수. 캠페인 실패(37/40)는 total-성공 **계산값**(실측 30/37 아님 — 0609 markFinalized 계열).
- 발송통계 엑셀(admin.ts:3454 부근): 대상 2,885=실측 합(978+1,903+4), 전송 2,895=기록 합(985+1,906+4) — **컬럼별 출처가 뒤섞임**(폴라초이스 행과 방향 반대).

### 수정 설계
1. 수량 3층 정의 확정: ①차감 기준(등록 예상) ②적재 실측(MySQL 행) ③통신사 결과(성공/실패). 
2. 출처 매핑 전수표: 사용자 발송결과(상단/캠페인정보/상세/엑셀) + 슈퍼관리자(캠페인관리/발송통계/정산) 전 화면이 어느 층·어느 테이블을 읽는지 표로 만들고 → "표시는 ②·③, 차감 표시만 ①" 원칙으로 통일. admin.ts 발송통계 쿼리의 대상/전송 컬럼 출처를 우선 정독.
3. 건 4 근원 A(확정 카운트 UPDATE)가 들어가면 기록≠실측 자체가 소멸 — 표시 통일은 그 위에 마무리.
### 검증: 시세이도 6/8 두 캠페인이 모든 화면에서 동일 수치(978/1,903 계열)로 표시.

## P2. [건 2-②] 카카오 반려(KREJ) 알림 미발송

- 설계상 알림 대상(toTerminalStatus KREJ→REJECTED + 폴링 SELECT 포함 + 5분 재시도) — 미발송 원인 확정 2단계:
  ```sql
  SELECT template_name, status, alarm_notified_status, reject_reason, last_synced_at FROM kakao_templates WHERE template_code='Tmpm1qj80y5hdvj54iq';
  ```
  ```bash
  pm2 logs --lines 2000 --nostream | grep -E 'alarmNotify|pendingTemplateSync' | tail -40
  ```
- 결과별 fix: alarm_notified_status 선기록이면 데이터 정정+선기록 경로 차단 / notify 예외면 해당 예외 근본 수정. 건 2-①(지연 일괄)은 6/10 기수정 종결 — 작업 없음.

## P3. 과거 전수 정산
1. 차감-적재 차이 미환불 전수: 캠페인별 (차감 합 - MySQL 행수) > 0 AND 환불 합 < 차액 목록 → 일괄 환불(P0-3 sweeper 소급 실행으로 갈음 가능).
2. 자동발송 active 전수(P0-1 SQL) 종료.
3. KREJ AND alarm_notified_status IS NULL 전수(공통 결함 여부 판정).

## 작업 순서 (다음 세션)
1. P0 데이터 3건(승인 → SQL 실행은 Harold) → 2. P0-3/P1 근원 코드(TDD+실측 1건) → 3. P2 확인 후 fix → 4. P3 전수 → 5. 배포(backend build:safe) → 6. debug-notes 문서에 건별 종결 기록.
