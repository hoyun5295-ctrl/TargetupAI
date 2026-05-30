# 2026-05-30 세션 핸드오프 — 대량 발송 파이프라인 + 발송결과 속도 설계

> 본 세션 = 발송 18만 nginx 413 사고 → 대량 발송 파이프라인 **전면 비동기 재설계(코드 완성, 미commit/미배포)** + 발송결과 12초 속도 개선 **설계(spec 완료)**. SDK는 컨텍스트 한계로 미착수.
> 다음 세션 = 본 핸드오프 정독 → ① 발송 파이프라인 commit+배포 → ② 발송결과 속도 구현(spec) → ③ SDK.

---

## 1. 대량 발송 파이프라인 (코드 완성 — 미commit + 미배포)

### 사고
직접발송이 18만 수신자를 단일 HTTP body로 POST → nginx `client_max_body_size 50M` 초과 → 413 HTML → 프론트 `res.json()` "Unexpected token '<'". PM2 확인 = express 미도달(nginx 차단). 근본 = 단일 요청 + 동기 처리 구조.

### 해결 (전면 비동기 통일 — 주인님 선택)
`stage(청크 적재) → commit(전체 정제·차감·202 접수) → worker(청크 발송·진행률)`. 기존 동기 `/direct-send`는 하위호환 유지(Task 8 폐기 보류).

### DB (주인님 PG 실행 완료)
```sql
CREATE TABLE campaign_send_staging (id BIGSERIAL PK, staging_id UUID, company_id UUID, phone VARCHAR(20), name/extra1-3 TEXT, callback VARCHAR(20), created_at TIMESTAMPTZ);
+ idx_css_staging(staging_id,id), idx_css_company_created
ALTER campaigns ADD staging_id UUID, processed_count INT, send_phase VARCHAR(20), send_config JSONB;  -- total_count는 기존 target_count 재사용
```

### 코드 (전부 tsc 0 + 박-단어/모델명/native dialog grep 0)
- 신규: `utils/direct-send-processor.ts`(processSendChunk — 변수치환+채널별 큐 INSERT), `utils/direct-send-worker.ts`(staging 청크 처리+진행률+환불+idempotent), `utils/send-time-util.ts`(calcSplitSendTime 이동)
- `routes/campaigns.ts`: `/direct-send/stage`(UNNEST 적재) + `/direct-send/commit`(수신거부/중복제거 **전체 DB 1회** 정제 → target_count 설정 → 차감 → 202) + `/:id/send-progress`
- `app.ts`: startDirectSendWorker 등록
- `pages/Dashboard.tsx`: executeDirectSend = 청크 stage → commit → progress polling

### 핵심 결정 (주인님 우려 반영)
- **수신거부·중복제거 = commit에서 staging 전체 DB DELETE 1회** (청크별 X — 청크 간 중복 누락 방지). 그 후 worker가 청크 발송.
- **청크 5만** + **UNNEST INSERT**(파라미터 8 고정). 옛 1만 청크 = 8만 파라미터로 PG 한도(65,535) 초과 사고를 UNNEST로 해결. 500만 = 100회 적재. (10만으로 키우려면 Dashboard `CHUNK` + stage 한도 한 줄씩)
- UNNEST SQL 주인님 PG rollback 검증 통과(INSERT 0 2 + 2행).

### spec/plan
- `docs/superpowers/specs/2026-05-30-bulk-send-pipeline-design.md`
- `docs/superpowers/plans/2026-05-30-bulk-send-pipeline.md`

### ★ 다음 세션 1차 — 배포
git 미commit 상태. `git status` 확인 후:
```
tp-push "대량 발송 파이프라인 — 청크 stage(UNNEST 5만) + 비동기 worker (18만~500만 body/timeout 제거)"
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app && git pull
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
pm2 restart all
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```
배포 후 18만 발송 정상 동작 = 주인님/직원 직접 확인.

### 잔여
- Task 8(기존 `/direct-send` 폐기): 운영 안정 후
- `/codex:adversarial-review`(대형)
- 후속: staging orphan cleanup cron(24h) + 개별회신번호 미등록 확인 + 금액필터(targetFilter)

---

## 2. 발송결과 속도 개선 (spec 완료 — 다음 구현)

### root cause (확정)
발송결과 = 캠페인별 11개 SMSQ 테이블 GROUP BY app_etc1 매번 집계. 실측: `COUNT GROUP BY` 단독 = **12.03초**(57만 행, 커버링 인덱스인데도). 인덱스로 못 줄임 — 매번 재집계 구조 한계. 업체 늘면 폭증.

### 근본 솔루션 (spec 작성 완료)
**완료 캠페인 결과는 불변 → PG에 캐시, 발송결과는 읽기만**(12초 → 수십 ms). 진행 중만 MySQL 실시간.
- `docs/superpowers/specs/2026-05-30-result-cache-design.md` 정독 후 구현
- campaigns ALTER(pending_count/result_final/result_synced_at) + worker(완료 판정 후 PG 캐시) + results.ts 분기(final=PG, 진행중=MySQL)
- D144(PG 캐시 부정확으로 제거) 교훈 = "완료 판정된 것만 캐시 신뢰"
- 예약조회 느림(manage-scheduled, PG)도 별도 후속

---

## 3. SDK v0.3.5-a ingest 정정 (미완) + v0.3.5-b

본 세션 초반 진행분(발송 사고로 중단):
- cdp_events ALTER(timestamptz 6컬럼: anonymous_id/session_id/trust_level/schema_version/sent_at/received_at) — **주인님 실행 완료**.
- ingest(`routes/cdp.ts`) 결함 발견: INSERT가 `event_type`/`payload`(실 DB는 `event_name`/`properties`) + `source` NOT NULL 누락 → SDK 이벤트 항상 503. row_count=0이라 운영 영향 0.
- brainstorming 동의 = **raw 통합**: event_name=e.type(track만 e.event) / properties=마스킹 JSON / source='sdk' / occurred_at=sent_at. `utils/cdp-events.ts`에 `ingestAutoCaptureEvents` CT 신설 + 라우트가 호출(no_inline_duplication). SDK event.type = pageview/click/identify/consent/track(trackEvent 표준과 달라 재사용 불가).
- **구현 미착수.**
- v0.3.5-b: 백오피스 1-click 발급 UI + first event 검증 화면 (별 plan).

---

## 4. 이전 핸드오프(2026-05-29) 잔여 — 본 세션 정리됨

- §3 messages JOIN: information_schema 검증 완료 (campaigns_fk=1, kt_table=1, kt_code=1 → 안전).
- §1.5 DB 컬럼 3중 안전망: 이미 commit 4d7a37a 배포 종결(미commit 아님).
- §4-1 cdp_events ALTER: 완료(위 3).

---

## 5. 다음 세션 진입 순서

1. 본 핸드오프 정독
2. **발송 파이프라인 git status → commit + 배포** (§1) — 미배포 상태
3. **발송결과 속도 구현** (§2 spec 정독) — campaign-sync-worker 현황 확인부터
4. **SDK v0.3.5-a ingest 정정**(§3 raw 통합) + v0.3.5-b
5. 예약조회 속도(별도)

> 비토 사고 기록: 발송결과 app_etc1 인덱스 부재로 가설했으나 실제는 인덱스 있음(idx_app_etc1_status) — EXPLAIN으로 정정. 가설 단정 전 EXPLAIN/실측 우선(no_guess_strict). stage INSERT 1만 청크 = PG 파라미터 한도 초과를 tsc가 못 잡음(주인님 질문으로 발견 → UNNEST) — tsc ≠ SQL 유효(D227).
