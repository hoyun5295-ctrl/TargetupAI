# 2026-06-04 핸드오프 — 톤28 504 fix 실측 + 여정 점검 잔여

## 다음 세션 진입 명령어
```
1. 이 핸드오프 정독
2. CLAUDE.md + status/lessons/LESSONS_BACKEND.md(D231+ 직접발송 504 사고) 정독
3. 톤28 발송이 끝났으면 §2-①(504 실측)부터 / 아직이면 §2-②(여정[3] ALTER) + §2-③(여정 [4][5][6])
4. 운영 DB 무거운 측정 금지 — 격리 더미 + company_id는 톤28 외
```

## 0. 철칙
- 추측 SQL 금지. 첫 SQL은 순수 덤프(미확인 컬럼·스키마필터 0).
- 배포 = tp-push → 서버 git pull → backend·frontend `build:safe` → `pm2 restart all`.
- 운영 DB에서 무거운 self-join/DELETE 측정 금지(톤28 발송 영향). 더미는 격리 staging_id + 톤28 외 company_id.

## 1. 완료·배포됨 (2026-06-04, tsc 0 backend+frontend)

### A. 톤28 504 근본 fix — 직접발송 대량 파이프라인 재설계
**원인(실측 확정)**: commit이 정제(수신거부 DELETE + 중복 self-join `a.phone=b.phone AND a.id>b.id`)를 **응답 전 동기로** 수행 → (staging_id,phone) 인덱스가 있어도 **자기조인**이라 10만에 59초(\timing 239,674ms) → commit 60초 초과 → **nginx 504(upstream timeout)**. 백엔드는 완주 → 발송 + status='scheduled' 잔존 → 사용자 재시도로 중복 64만건.
- nginx access.log `POST /direct-send/commit 504`(08:13·08:21·08:34), error.log `upstream timed out`. 백엔드 error.log엔 commit 에러 0(완주).

**fix(코드 완료·배포)**:
1. `routes/campaigns.ts` — `/direct-send/count` endpoint + 헬퍼 `countStagingFiltered`(중복 `COUNT(*)-COUNT(DISTINCT phone)` + 수신거부 `JOIN unsubscribes (user_id,phone)` COUNT).
2. commit — 정제 DELETE 제거 → 헬퍼 COUNT만 → 즉시 202(504 차단). 차감·target_count = sendCount.
3. `utils/direct-send-worker.ts` — 발송 직전(processed===0) 정제(수신거부 DELETE + 중복 ctid+ROW_NUMBER).
4. sendConfig에 dedupEnabled/unsubFilterEnabled 추가(worker가 읽음).
5. self-join → ROW_NUMBER(O(N log N)).
6. `components/DirectSendPanel.tsx` handleSend — phones POST(/unsubscribes/check)·프론트 중복 계산 폐기 → stage 적재 + count → 모달(정확) + stagingId. `pages/Dashboard.tsx` handleDirectSend — stage loop 제거 → `sendConfirm.stagingId`로 commit만(`as any` 임시 타입 — 깔끔히 하려면 sendConfirm 타입에 stagingId 추가).

**인덱스**: `idx_unsubscribes_user_phone (user_id,phone)` 존재 / `idx_css_staging_phone (staging_id,phone)` Harold 생성(있음).

### B. 여정 점검 [1][2][3] 코드(이번 push에 포함)
- [1] 알림톡 대체발송 nextContents 변수 미치환 → `utils/alimtalk-vars.ts` `fillAlimtalkVarMap` + 4경로(journey-executor:678 replaceAlimtalkVars / campaigns:2012 / direct-send-processor:210 / auto-campaign-worker:952). 본문 미변경.
- [2] journey_step_variants default 누락 → `utils/bandit-optimizer.ts:498` createJourneyStepVariant에 applyVariableDefaults.
- [3] 스팸테스트 첫 고객 정렬 불일치 → `utils/spam-test-queue.ts` enqueue INSERT `first_recipient` 저장 + execute 재사용(없으면 name ASC fallback) + catch db_alter_safety_net. **★ ALTER 필요(§2-②)**.

## 2. 다음 세션 할 일

### ① 톤28 504 fix 실측 (톤28 발송 끝난 뒤)
격리 더미(staging_id 신규, **company_id = 톤28 외**) 10만·중복50%:
```sql
\timing on
INSERT INTO campaign_send_staging (staging_id, company_id, phone)
SELECT 'dddddddd-0000-0000-0000-000000000001'::uuid,
       (SELECT id FROM companies LIMIT 1),  -- 톤28 아닌 회사
       '010' || lpad((g % 50000)::text, 8, '0') FROM generate_series(1,100000) g;
-- 새 방식 정제(59초→몇 초 기대)
DELETE FROM campaign_send_staging WHERE ctid IN (SELECT ctid FROM (SELECT ctid, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY id) rn FROM campaign_send_staging WHERE staging_id='dddddddd-0000-0000-0000-000000000001') t WHERE rn>1);
DELETE FROM campaign_send_staging WHERE staging_id='dddddddd-0000-0000-0000-000000000001';
```
+ 실제 직접발송 30만 1건으로 commit 즉시 202 + 모달 count 정확 + worker 정제 발송 확인.

### ② 여정 [3] ALTER (배포돼 first_recipient 참조 중 — catch 503 안전망 있으나 ALTER 의무)
먼저 정직 검증(추측 금지):
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='spam_filter_tests' AND column_name='first_recipient';
```
없으면:
```sql
ALTER TABLE spam_filter_tests ADD COLUMN first_recipient jsonb;
```

### ③ 여정 점검 [4][5][6] (핸드오프 2026-06-03 핀포인트)
- [4] 죽은 `/operator/journeys/:id/resume`(ai.ts:2997)+resumeJourney(journey-builder:741) — snapshot 없음, 프론트 미사용. activate(516 `['draft','paused']`)가 재개 완전 커버 확인됨. **fix=endpoint+함수+import 제거(정답), Harold 동의 후 적용**.
- [5] journey-executor evaluateCondition 오류 시 default pass=true 정책 확인.
- [6] snapshot 본문 합성 시점 / 캠페인 새벽(0~8시) 가드 필요 여부 Harold 확인.

## 3. 별도 발견(미처리, 점진 정정)
- 기존 박-단어: `Dashboard.tsx` "본격" 7건(D224+ 디자인), `campaigns.ts` "진정/박았"(D142+/D162), `bandit-optimizer.ts` 상단 주석(D177).
