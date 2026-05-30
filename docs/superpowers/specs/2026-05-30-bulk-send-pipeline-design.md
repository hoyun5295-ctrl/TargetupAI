# 대량 발송 파이프라인 재설계 — 전면 비동기 (2026-05-30)

> 직접발송을 건수 무관(18만 ~ 500만+) 안정 처리하는 전면 비동기 구조로 재설계.
> 기존 단일 요청 + 동기 처리 경로는 폐기.

---

## 1. 배경 (root cause)

- 직접발송이 18만 수신자를 단일 HTTP body로 POST → nginx `client_max_body_size 50M` 초과 → 413 HTML → 프론트 `res.json()`이 `<html>`을 만나 `Unexpected token '<'`.
- PM2 로그 확인: 18만 요청은 express 미도달(처리 로그 0건) = nginx body 단계 차단. 504 timeout이 아니라 413.
- 백엔드도 18만을 동기 처리(변수치환 18만 루프 + 180배치 순차 INSERT)해 Node 단일 스레드를 수십 초 블로킹 → timeout·다른 사용자 영향 잠재.
- 한도 상향은 땜질 — 500만 건에서 다시 초과. 근본 원인 = "단일 요청 전송 + 동기 처리" 구조 자체.

## 2. 목표

- 18만 ~ 500만+ 건수와 무관하게 안정 발송.
- 전면 비동기 통일: 모든 직접발송 = 청크 적재 → staging → worker. 기존 동기 경로 폐기.
- body 한도 / timeout / Node 블로킹을 구조에서 제거.

## 3. 아키텍처

흐름: `stage(청크 적재) → commit(검증·차감·접수) → worker(청크 처리) → 진행률`

### 3-1. 청크 적재 — POST /api/campaigns/direct-send/stage
- frontend가 수신자를 1만건씩 청크로 전송 (각 요청 ~1-2MB, body 한도 무관).
- 각 청크 → `campaign_send_staging` batch INSERT.
- 묶음 식별 = `staging_id`(UUID, 첫 stage 응답에서 발급).
- 응답: `{ stagingId, staged, totalSoFar }`.

### 3-2. 발송 커밋 — POST /api/campaigns/direct-send/commit
- body: `{ stagingId, msgType, sendChannel, message, subject, callback, 옵션... }` — recipients 미포함.
- 서버 처리:
  1. staging 총 건수 조회.
  2. 동기 검증 (라인그룹 설정 / 회신번호 등록 / LMS·MMS 제목 / 알림톡 승인) — 즉시 피드백.
  3. 캠페인 생성 (`send_phase='queued'`, `total_count`, `staging_id` 연결).
  4. 잔액 차감 (전체 건수 기준).
  5. **즉시 202 응답** `{ campaignId, accepted }`.

### 3-3. worker — direct-send-worker.ts
- `send_phase='queued'` 캠페인 polling(5초) + commit 직후 즉시 트리거.
- staging에서 1만건씩 꺼내:
  - 중복제거 + 수신거부·금액 필터.
  - customers SELECT 변수 매핑.
  - 변수치환 + 채널별 큐 INSERT (`bulkInsertSmsQueue` / `insertKakaoQueue` / `insertAlimtalkQueue`).
  - `processed_count` 갱신.
  - 청크 간 `await`로 이벤트루프 양보 → Node 블로킹 0.
- 완료: `send_phase='sent'` + staging row 삭제.
- 청크 실패분 환불 + 로깅 후 다음 청크 진행.

### 3-4. 진행률 (UX)
- campaigns: `total_count`, `processed_count`, `send_phase`(staging/queued/processing/sent/failed).
- frontend: commit 후 "발송이 시작됐습니다" 안내 + 진행률 카드(발송결과 연동) — `GET /campaigns/:id/send-progress` polling으로 % 표시.
- 소량은 worker가 즉시 100% → 완료 표시(사실상 즉시 결과).
- 적재 단계(stage)도 "수신자 업로드 n/m" 진행 표시 → 사용자 혼란 차단 (marketing_user_ux_priority 준수).

## 4. DB 스키마

### 신규 campaign_send_staging
```sql
CREATE TABLE IF NOT EXISTS campaign_send_staging (
  id BIGSERIAL PRIMARY KEY,
  staging_id UUID NOT NULL,
  company_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  name TEXT, extra1 TEXT, extra2 TEXT, extra3 TEXT,
  callback VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_css_staging ON campaign_send_staging(staging_id);
CREATE INDEX IF NOT EXISTS idx_css_company_created ON campaign_send_staging(company_id, created_at);
```

### campaigns ALTER (진행률 + staging 연결)
```sql
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS staging_id UUID,
  ADD COLUMN IF NOT EXISTS total_count INT,
  ADD COLUMN IF NOT EXISTS processed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS send_phase VARCHAR(20);
```
- 구현 직전 `information_schema`로 campaigns 기존 컬럼/타입 검증 (db_column_verify_before_code 준수).

## 5. 기존 흐름 전환

- 기존 `POST /direct-send`(동기, recipients 직접 수신) → 폐기. frontend는 stage + commit 사용.
- 기존 처리 로직(검증·필터·변수치환·큐 INSERT·환불)을 worker가 재사용하도록 `utils/`로 함수 추출 (no_inline_duplication 준수) — 예: `utils/direct-send-processor.ts`의 `processSendChunk()`.
- 예약발송(scheduled) / 알림톡 / 카카오 채널도 동일 파이프라인 통과 (worker가 채널 분기).

## 6. 안전망

- 트랜잭션: commit의 잔액 차감 + 캠페인 INSERT 원자성. worker 청크별 트랜잭션.
- idempotent: worker 재시작 시 `processed_count` offset 기준 이어서 처리 (중복 INSERT 방지).
- staging 정리: 완료·실패 후 삭제 + 24h orphan cleanup cron(미커밋 staging).
- 부분 실패: 청크 실패 시 해당 건 환불 + 로깅, 다음 청크 진행.
- 잔액 부족: commit에서 차단 (worker 진입 전).
- DB ALTER 미실행 대비: stage/commit catch에 `column does not exist` → 503 분기 (db_alter_safety_net 준수).

## 7. 테스트 (TDD)

- stage: 청크 적재 → staging row 수 확인.
- commit: 검증 통과 + 잔액 차감 + 캠페인 `queued` 생성.
- commit: 잔액 부족 시 402 차단.
- worker: staging → 큐 INSERT + `processed_count` 갱신 + staging 정리.
- worker idempotent: 중도 재시작 시 중복 INSERT 0건.
- 대량 시뮬: 5만건(청크 5개) → worker 완료 + 처리 건수 일치.

## 8. 구현 순서

1. DB: `campaign_send_staging` 생성 + campaigns ALTER (information_schema 검증 후).
2. `utils/direct-send-processor.ts` — 기존 처리 로직 함수 추출 (`processSendChunk`).
3. `POST /direct-send/stage` (청크 적재) + 테스트.
4. `POST /direct-send/commit` (검증·차감·접수) + 테스트.
5. `utils/direct-send-worker.ts` (staging 청크 처리 + 진행률 + 환불) + 테스트.
6. `GET /campaigns/:id/send-progress` (진행률 조회).
7. frontend DirectSendPanel/Dashboard: 청크 전송 + 적재·발송 2단계 진행률.
8. 기존 `POST /direct-send` 폐기.
9. app.ts에 worker 등록.

---

## 부록 — 핵심 결정 (확정)

- 처리 경로: **전면 비동기 통일** (Harold 선택 2026-05-30). 임계값 분기 없음.
- 청크 크기: 적재 1만건/요청, worker 처리 1만건/배치.
- staging 저장소: PostgreSQL 테이블 (기존 인프라 일관).
- 잔액 차감: commit 시점 전체 차감 + worker 실패분 환불.
