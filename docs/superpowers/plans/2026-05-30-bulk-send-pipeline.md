# 대량 발송 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (inline, 본 세션 순차 — CLAUDE.md `no_parallel_tasks` 준수). Steps use checkbox (`- [ ]`).

**Goal:** 직접발송을 건수 무관(18만~500만+) 전면 비동기(stage→commit→worker)로 재구현. 기존 단일 요청 + 동기 처리 폐기.

**Architecture:** 수신자를 1만건씩 청크 적재(PG staging) → 발송 커밋(검증·차감·즉시 202 접수) → 백그라운드 worker가 staging을 청크 처리(진행률 갱신). worker는 기존 setInterval polling 패턴 + commit 직후 즉시 트리거.

**Tech Stack:** Express + PostgreSQL(pg) + MySQL 큐(bulkInsertSmsQueue) + setInterval worker + React.

**검증 방식 (한줄로 — 단위 테스트 인프라 부재):** 각 task = `npx tsc --noEmit` 0 errors + 박-단어/모델명/native dialog grep 0건 + 서버 배포 후 주인님 검증. Codex 리뷰(codex_review_after_code_change).

**git/배포:** 제가 commit·push 안 함. 전체 완료 후 주인님 `tp-push` + 서버 build:safe.

---

### Task 1: DB 스키마 (staging 테이블 + campaigns ALTER)

**Files:** SQL — 주인님 PG 직접 실행

- [ ] **Step 1: campaigns 기존 컬럼 검증** (db_column_verify_before_code)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='campaigns'
  AND column_name IN ('staging_id','total_count','processed_count','send_phase','send_config');
```
Expected: 0 rows (신규 컬럼이므로 미존재 정상). 일부 존재 시 충돌 점검.

- [ ] **Step 2: staging 테이블 생성 + campaigns ALTER**

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
CREATE INDEX IF NOT EXISTS idx_css_staging ON campaign_send_staging(staging_id, id);
CREATE INDEX IF NOT EXISTS idx_css_company_created ON campaign_send_staging(company_id, created_at);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS staging_id UUID,
  ADD COLUMN IF NOT EXISTS total_count INT,
  ADD COLUMN IF NOT EXISTS processed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS send_phase VARCHAR(20),
  ADD COLUMN IF NOT EXISTS send_config JSONB;
```
Note: `send_config` = worker가 읽을 발송 설정(채널/알림톡/분할 옵션) 직렬화. `idx_css_staging`에 `id` 포함 → worker `ORDER BY id LIMIT chunk OFFSET processed` idempotent 커버.

---

### Task 2: utils/direct-send-processor.ts — 처리 로직 함수 추출

**Files:** Create `packages/backend/src/utils/direct-send-processor.ts`

기존 `routes/campaigns.ts` direct-send 핸들러의 처리 로직(중복제거·필터·변수치환·채널별 큐 INSERT·부분실패 환불, 현 1339~1716)을 청크 단위 순수 함수로 이동. `no_inline_duplication` 준수 — worker와 (필요 시) 기타 경로가 재사용.

- [ ] **Step 1: 인터페이스 + processSendChunk 작성**

```ts
export interface SendChunkParams {
  companyId: string;
  userId: string;
  campaignId: string;
  companyTables: string[];
  recipients: Array<{ phone: string; name?: string; extra1?: string; extra2?: string; extra3?: string; callback?: string | null }>;
  msgType: string; sendChannel: string; message: string; subject: string;
  callback: string; useIndividualCallback: boolean; individualCallbackColumn?: string;
  adEnabled: boolean; finalIsAd: boolean; opt080: string;
  splitEnabled: boolean; splitCount: number | null;
  scheduled: boolean; scheduledAt: string | null;
  mmsImagePaths: any[];
  dedupEnabled: boolean; unsubFilterEnabled: boolean;
  // 알림톡/카카오 필드 (기존 핸들러 destructure 동일)
  kakaoBubbleType?: string; kakaoSenderKey?: string; kakaoTargeting?: string;
  kakaoAttachmentJson?: string; kakaoCarouselJson?: string; kakaoResendType?: string;
  alimtalkTemplateCode?: string; alimtalkVariableMap?: Record<string, string>;
  alimtalkButtonJson?: string; alimtalkNextType?: string; alimtalkNextContents?: string; alimtalkNextSubject?: string;
  directFieldMappings: Record<string, any>; // commit에서 1회 조회해 전달 (청크마다 재조회 X)
}

export interface SendChunkResult { sentCount: number; failedCount: number; }

// 한 청크(최대 1만건) 처리 — 필터 + 변수치환 + 채널별 큐 INSERT. 환불은 worker가 누적 집계 후 1회.
export async function processSendChunk(p: SendChunkParams): Promise<SendChunkResult> { /* 기존 1339~1689 로직 이동 (campaignId/필드매핑은 파라미터 주입) */ }
```

- [ ] **Step 2: 검증** — `npx tsc --noEmit` 0 errors. `grep -nE "박[음힘는을힌지혀힙히혔힐았]" direct-send-processor.ts` 0건.

---

### Task 3: POST /api/campaigns/direct-send/stage — 청크 적재

**Files:** Modify `packages/backend/src/routes/campaigns.ts` (신규 라우트 추가)

- [ ] **Step 1: 라우트 작성**

```ts
router.post('/direct-send/stage', async (req, res) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { stagingId: incoming, recipients } = req.body || {};
    if (!Array.isArray(recipients) || recipients.length === 0)
      return res.status(400).json({ success: false, error: 'recipients 비어 있음' });
    if (recipients.length > 10000)
      return res.status(413).json({ success: false, error: '청크 최대 1만건', code: 'CHUNK_TOO_LARGE' });
    const stagingId = incoming || uuidv4();
    const values: any[] = []; const ph: string[] = [];
    recipients.forEach((r: any, i: number) => {
      const b = i * 8;
      ph.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`);
      values.push(stagingId, companyId, normalizePhone(r.phone), cellToString(r.name),
        cellToString(r.extra1), cellToString(r.extra2), cellToString(r.extra3), r.callback || null);
    });
    await query(`INSERT INTO campaign_send_staging
      (staging_id, company_id, phone, name, extra1, extra2, extra3, callback) VALUES ${ph.join(',')}`, values);
    return res.json({ success: true, stagingId, staged: recipients.length });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist'))
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요 — campaign_send_staging' });
    console.error('[direct-send/stage] 오류:', err);
    return res.status(500).json({ success: false, error: '적재 오류' });
  }
});
```
Note: `cellToString` backend normalize.ts import 확인 (없으면 import 추가).

- [ ] **Step 2: 검증** — tsc 0 + grep 0건.

---

### Task 4: POST /api/campaigns/direct-send/commit — 검증·차감·접수

**Files:** Modify `packages/backend/src/routes/campaigns.ts`

- [ ] **Step 1: 라우트 작성** — 기존 핸들러의 동기 검증부(라인그룹/회신번호 등록/제목/알림톡 승인) 재사용 + 캠페인 생성 + prepaidDeduct + send_phase='queued'. 처리(큐 INSERT)는 worker로 위임.

```ts
router.post('/direct-send/commit', async (req, res) => {
  // 1. 인증 + getCompanySmsTables + hasCompanyLineGroup (기존 1252~1269)
  // 2. const total = SELECT COUNT(*) FROM campaign_send_staging WHERE staging_id=$1 AND company_id=$2
  //    total===0 → 400
  // 3. 동기 검증: 회신번호 등록(1377~1399) / 제목(1359~1369) / 알림톡 승인 gate(1726~1748)
  // 4. campaigns INSERT (기존 1504~1532) + send_phase='queued', total_count=total, staging_id, status='sending'
  // 5. prepaidDeduct(companyId, total, type, campaignId, userId) — 실패 시 캠페인 DELETE + 402
  // 6. 발송 설정(message/subject/callback/채널 옵션)을 campaigns 컬럼 or 별도 직렬화 저장 (worker가 읽음)
  // 7. triggerDirectSendWorker(campaignId)  // 즉시 트리거 (worker 함수 export)
  // 8. return res.status(202).json({ success: true, campaignId, accepted: total })
});
```
Note: worker가 발송 설정을 알아야 하므로, message/subject/callback/msgType/sendChannel/옵션을 campaigns 기존 컬럼(message_content/subject/...)에 저장 + 알림톡/분할 등 부가 옵션은 `campaigns.send_config jsonb`(ALTER 추가) 또는 기존 컬럼 활용. → Task 1 ALTER에 `send_config jsonb` 추가 검토.

- [ ] **Step 2: 검증** — tsc 0 + grep 0건.

---

### Task 5: utils/direct-send-worker.ts — staging 청크 처리

**Files:** Create `packages/backend/src/utils/direct-send-worker.ts`

- [ ] **Step 1: worker 작성** (campaign-sync-worker 패턴)

```ts
let running = false;
export async function runDirectSendOnce(): Promise<void> {
  if (running) return; running = true;
  try {
    const due = await query(`SELECT id FROM campaigns WHERE send_phase='queued' ORDER BY created_at LIMIT 5`);
    for (const row of due.rows) await processCampaign(row.id);
  } finally { running = false; }
}
async function processCampaign(campaignId: string): Promise<void> {
  // 1. UPDATE campaigns SET send_phase='processing' WHERE id=$1
  // 2. SELECT total_count, processed_count, staging_id, company_id, created_by, 발송설정 FROM campaigns
  // 3. directFieldMappings = prepareFieldMappings(companyId) (1회)
  // 4. loop: while processed < total {
  //      chunk = SELECT * FROM campaign_send_staging WHERE staging_id=$1 ORDER BY id LIMIT 10000 OFFSET processed
  //      r = await processSendChunk({... recipients: chunk, directFieldMappings ...})
  //      processed += chunk.length; sent += r.sentCount; failed += r.failedCount
  //      UPDATE campaigns SET processed_count=$processed WHERE id=$1
  //      await new Promise(res => setImmediate(res))  // 이벤트루프 양보
  //    }
  // 5. 실패분 환불: prepaidRefund(company, failed, type, campaignId, ...)
  // 6. UPDATE campaigns SET send_phase='sent' WHERE id=$1
  // 7. DELETE FROM campaign_send_staging WHERE staging_id=$1
}
export function startDirectSendWorker() { setInterval(() => { void runDirectSendOnce(); }, 5000); }
export function triggerDirectSendWorker(campaignId: string) { void runDirectSendOnce(); }
```
idempotent: OFFSET=processed_count 기준 → worker 재시작 시 이어서. 청크 INSERT 전 `app_etc`/campaignId로 중복 방지(기존 큐 구조 활용).

- [ ] **Step 2: 검증** — tsc 0 + grep 0건.

---

### Task 6: GET /api/campaigns/:id/send-progress — 진행률

**Files:** Modify `packages/backend/src/routes/campaigns.ts`

- [ ] **Step 1:** `SELECT total_count, processed_count, send_phase FROM campaigns WHERE id=$1 AND company_id=$2` → `{ total, processed, phase, percent }`.
- [ ] **Step 2: 검증** — tsc 0.

---

### Task 7: frontend — 청크 전송 + 진행률

**Files:** Modify `packages/frontend/src/pages/Dashboard.tsx` (`executeDirectSend`), `DirectSendPanel.tsx` (진행 UI)

- [ ] **Step 1:** `executeDirectSend` 재작성 — recipients를 1만건씩 잘라 `/direct-send/stage` 순차 POST(stagingId 누적) → 적재 진행률 표시 → `/direct-send/commit` POST → 202 후 send-progress polling → 완료 토스트.
- [ ] **Step 2:** 진행 UI — 적재 n/m + 발송 percent (ConfirmModal/카드, native dialog X).
- [ ] **Step 3: 검증** — frontend tsc 0 + 모델명/native dialog grep 0건.

---

### Task 8: 기존 POST /direct-send 폐기

**Files:** Modify `packages/backend/src/routes/campaigns.ts`

- [ ] **Step 1:** 기존 `router.post('/direct-send')` 제거(또는 410 Gone). 처리 로직은 Task 2로 이동 완료.
- [ ] **Step 2: 검증** — tsc 0 + 호출처 grep(frontend 잔존 0).

---

### Task 9: app.ts worker 등록

**Files:** Modify `packages/backend/src/app.ts`

- [ ] **Step 1:** `import { startDirectSendWorker } from './utils/direct-send-worker';` + `app.listen` 콜백에 `startDirectSendWorker();`
- [ ] **Step 2: 검증** — tsc 0.

---

## 구현 순서 / 검증 게이트

1→2→3→4→5→6 (backend) → 7 (frontend) → 8→9. 각 task tsc 0 통과 후 다음. 전체 완료 후 Codex 리뷰 → 주인님 배포(DB SQL → tp-push → build:safe → pm2 restart all).

## Self-Review (작성 후)

- 스펙 커버리지: stage(T3)/commit(T4)/worker(T5)/진행률(T6)/staging(T1)/함수추출(T2)/frontend(T7)/폐기(T8)/등록(T9) — 전 항목 task 존재.
- send_config 저장: commit→worker 발송설정 전달 = Task 1 ALTER `send_config jsonb` 추가 필요 (구현 시 확정).
- 타입 일관: processSendChunk 시그니처 T2 정의 ↔ T5 호출 일치.
