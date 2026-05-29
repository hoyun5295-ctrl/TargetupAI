# 알림톡 표시 + 결과 조회 성능 통합 fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline execution — 주인님 직접 의무 영역 다수 = PG ALTER + tp-push + 서버 풀)

**Goal:** 영업팀장 박성용 신고 2건 통합 fix — (1) 알림톡 발송결과 안 메시지 내용 빈 영역 + templateCode 표시 사고 + (2) 발송결과 조회 시 30초 로딩 사고 (톤28 영역 = 524,331 발송).

**Architecture:** 
- backend `routes/results.ts` 안 = SELECT 안 `alimtalk_template_code` 컬럼 추가 + alimtalkTemplateInfo 응답 안 campaigns fallback 추가 + `/campaigns` GET 안 default 7일 한정 추가
- frontend `utils/formatDate.ts` 안 = formatCampaignMessageForDisplay 함수 안 알림톡 분기 추가
- frontend `components/ResultsModal.tsx` 안 = 메시지 미리보기 안 알림톡 분기 추가
- PG 인덱스 추가 = `campaigns(company_id, COALESCE(sent_at, scheduled_at, created_at) DESC)` (주인님 직접 DB ALTER 의무)

**Tech Stack:** TypeScript + Express + PG + React + 옛 알림톡 표시 영역 흐름 보존 (D225+ fix 영역 동일 흐름 추가).

---

## File Structure

### 정정 파일 (4건)

```
packages/backend/src/routes/results.ts    (3 영역 정정 — Line 247~264 SELECT + Line 304+ 상세 SELECT + Line 673~687 alimtalkTemplateInfo + Line 215+ default 7일)
packages/frontend/src/utils/formatDate.ts (1 영역 정정 — Line 1002 formatCampaignMessageForDisplay 함수)
packages/frontend/src/components/ResultsModal.tsx (1 영역 정정 — Line 879 메시지 미리보기 안 알림톡 분기)
packages/frontend/src/pages/Dashboard.tsx (1 영역 정정 — 캠페인 목록 default 기간 영역 — 옛 영역 확인 후 정정)
```

### PG ALTER (1건 — 주인님 직접 의무)

```
CREATE INDEX CONCURRENTLY idx_campaigns_company_period ON campaigns(company_id, COALESCE(sent_at, scheduled_at, created_at) DESC);
```

### 보존 영역 (정정 X)

```
packages/backend/src/routes/campaigns.ts  (옛 D224+ + D225+ fix 영역 보존)
packages/frontend/src/components/CalendarModal.tsx  (옛 영역 보존)
packages/frontend/src/pages/AdminDashboard.tsx  (옛 영역 보존)
```

---

## Pre-flight

### Step 0.1: 옛 frontend 캠페인 목록 default 기간 영역 확인

- [ ] **Step 0.1.1: Dashboard.tsx 안 default 기간 영역 grep**

```bash
grep -n "fromDate\|toDate\|results/campaigns" packages/frontend/src/pages/Dashboard.tsx | head -20
```

= 옛 default 기간 영역 정확한 위치 확인 의무.

- [ ] **Step 0.1.2: ResultsModal.tsx 안 fetch 영역 grep**

```bash
grep -n "fetch.*results/campaigns\|fromDate\|toDate" packages/frontend/src/components/ResultsModal.tsx | head -10
```

= 옛 fetch 호출 시 default 기간 영역 확인.

---

## Task A: 알림톡 표시 (backend + frontend 4건)

### Task A1: backend `routes/results.ts` 캠페인 목록 SELECT 안 `alimtalk_template_code` 추가

**Files:**
- Modify: `packages/backend/src/routes/results.ts:249`

- [ ] **Step A1.1: SELECT 영역 안 `c.alimtalk_template_code` 컬럼 추가**

Edit `packages/backend/src/routes/results.ts` Line 249:

옛 영역:
```ts
        c.id, c.company_id, c.created_by, c.campaign_name, c.message_type, c.message_content, c.send_type, c.status,
        c.target_count,
        c.is_ad, c.scheduled_at, c.sent_at, c.created_at, c.send_channel, c.callback_number,
        c.subject, c.message_subject, c.mms_image_paths,
```

신규 영역 (`c.alimtalk_template_code` 추가):
```ts
        c.id, c.company_id, c.created_by, c.campaign_name, c.message_type, c.message_content, c.send_type, c.status,
        c.target_count,
        c.is_ad, c.scheduled_at, c.sent_at, c.created_at, c.send_channel, c.callback_number,
        c.subject, c.message_subject, c.mms_image_paths,
        c.alimtalk_template_code,
```

---

### Task A2: backend `routes/results.ts` 캠페인 상세 SELECT 안 `alimtalk_template_code` 추가

**Files:**
- Modify: `packages/backend/src/routes/results.ts:304~480` (캠페인 상세 endpoint 안 캠페인 row SELECT 영역)

- [ ] **Step A2.1: 캠페인 상세 SELECT 영역 위치 정독 + `alimtalk_template_code` 컬럼 추가**

옛 영역 정독 의무 — `routes/results.ts:304~480` 안 = 옛 SELECT 영역 (campaigns 테이블 안) 정확한 영역 확인 후 = `c.alimtalk_template_code` 또는 `alimtalk_template_code` 컬럼 추가.

---

### Task A3: backend `routes/results.ts:673~687` alimtalkTemplateInfo fallback 추가

**Files:**
- Modify: `packages/backend/src/routes/results.ts:673~700`

- [ ] **Step A3.1: alimtalkTemplateInfo 응답 안 campaigns fallback 추가**

옛 영역 (옛 enrichedMessages 안 k_template_code 활용 — 옛 발송 X 시 NULL):
```ts
const firstTemplateCode = enrichedMessages.find((m: any) => m.k_template_code)?.k_template_code || '';
if (firstTemplateCode) {
  const tplResult = await query(
    `SELECT template_code, template_name FROM kakao_templates
     WHERE company_id = $1::uuid AND template_code = $2 LIMIT 1`,
    [companyId, firstTemplateCode]
  );
  if (tplResult.rows.length > 0) {
    alimtalkTemplateInfo = {
      code: tplResult.rows[0].template_code,
      name: tplResult.rows[0].template_name,
    };
  }
}
```

신규 영역 (옛 영역 + campaigns 안 alimtalk_template_code fallback):
```ts
// 옛 D225+ fix 영역 = messages 안 k_template_code 활용
let firstTemplateCode = enrichedMessages.find((m: any) => m.k_template_code)?.k_template_code || '';
// ★ D227+ (2026-05-28 영업팀장 박성용 신고 재발 fix): 옛 발송 X 영역 시 (messages 영역 X) = campaigns 안 alimtalk_template_code fallback
if (!firstTemplateCode && campaign?.alimtalk_template_code) {
  firstTemplateCode = campaign.alimtalk_template_code;
}
if (firstTemplateCode) {
  const tplResult = await query(
    `SELECT template_code, template_name FROM kakao_templates
     WHERE company_id = $1::uuid AND template_code = $2 LIMIT 1`,
    [companyId, firstTemplateCode]
  );
  if (tplResult.rows.length > 0) {
    alimtalkTemplateInfo = {
      code: tplResult.rows[0].template_code,
      name: tplResult.rows[0].template_name,
    };
  } else {
    // 옛 PG kakao_templates 영역 X 시 = 단순 code 영역 응답
    alimtalkTemplateInfo = {
      code: firstTemplateCode,
      name: '(템플릿 영역 미동기화)',
    };
  }
}
```

---

### Task A4: frontend `utils/formatDate.ts:1002` formatCampaignMessageForDisplay 안 알림톡 분기 추가

**Files:**
- Modify: `packages/frontend/src/utils/formatDate.ts:1002~1028`

- [ ] **Step A4.1: campaign 타입 안 send_channel + alimtalk_template_code 영역 추가**

옛 영역 (Line 1002~1010):
```ts
export function formatCampaignMessageForDisplay(
  campaign: {
    message_content?: string | null;
    message_type?: string | null;
    is_ad?: boolean | null;
    opt_out_080_number?: string | null;
  } | null | undefined,
  realSentMessage?: string | null
): string {
```

신규 영역:
```ts
export function formatCampaignMessageForDisplay(
  campaign: {
    message_content?: string | null;
    message_type?: string | null;
    is_ad?: boolean | null;
    opt_out_080_number?: string | null;
    send_channel?: string | null;
    alimtalk_template_code?: string | null;
  } | null | undefined,
  realSentMessage?: string | null
): string {
```

- [ ] **Step A4.2: 옛 함수 안 알림톡 분기 추가**

옛 영역 (Line 1011~1017):
```ts
  const source = realSentMessage || campaign?.message_content || '';
  if (!campaign) return source;

  // ★ D143 (2026-05-04, 정식 오픈 D-Day 1일 전) — Harold님 명시 정책:
  //   광고체크 OFF (is_ad=false) → 사용자 입력 본문 그대로 표시 (어떤 처리도 안 함)
  //   사용자가 본문에 (광고)/무료거부 복붙한 경우도 사용자 입력이므로 그대로 보존
  if (!campaign.is_ad) return source;
```

신규 영역 (옛 영역 + 알림톡 분기 추가):
```ts
  const source = realSentMessage || campaign?.message_content || '';
  if (!campaign) return source;

  // ★ D227+ (2026-05-28 영업팀장 박성용 신고 fix): 알림톡 = message_content 영역 = 사용자 직접 입력 X 영역
  //   = 옛 표시 시 templateCode 영역 활용 의무 (옛 메시지 내용 영역 = 빈 영역 표시 사고 정정)
  if (campaign.send_channel === 'alimtalk') {
    if (source && source.trim()) {
      // 옛 실발송 텍스트 영역 OR 사용자 직접 본문 영역 = 옛 영역 보존
      return source;
    }
    // 옛 본문 영역 X = templateCode 영역 활용
    return campaign.alimtalk_template_code
      ? `[알림톡 템플릿] ${campaign.alimtalk_template_code}`
      : '[알림톡 템플릿 미설정]';
  }

  // ★ D143 (2026-05-04, 정식 오픈 D-Day 1일 전) — Harold님 명시 정책:
  //   광고체크 OFF (is_ad=false) → 사용자 입력 본문 그대로 표시 (어떤 처리도 안 함)
  //   사용자가 본문에 (광고)/무료거부 복붙한 경우도 사용자 입력이므로 그대로 보존
  if (!campaign.is_ad) return source;
```

---

### Task A5: frontend `components/ResultsModal.tsx:879` 메시지 미리보기 안 알림톡 분기 추가

**Files:**
- Modify: `packages/frontend/src/components/ResultsModal.tsx:870~889`

- [ ] **Step A5.1: 메시지 미리보기 안 알림톡 분기 추가**

옛 영역 (Line 873~878 — 옛 단순 = formatCampaignMessageForDisplay 한정):
```tsx
                            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[11.5px] leading-[1.7] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                              {/* ★ D91: LMS/MMS 제목 표시 */}
                              {(selectedCampaign.message_type === 'LMS' || selectedCampaign.message_type === 'MMS' || selectedCampaign.message_type === 'L' || selectedCampaign.message_type === 'M') && (selectedCampaign.subject || selectedCampaign.message_subject) && (
                                <div className="font-bold text-gray-900 mb-1 pb-1 border-b border-gray-200">{buildAdSubjectFront(selectedCampaign.subject || selectedCampaign.message_subject || '', selectedCampaign.message_type, selectedCampaign.is_ad ?? false)}</div>
                              )}
                              {/* ★ B2: 컨트롤타워 — 실발송 텍스트(MySQL) 우선, 없으면 순수본문에 (광고)+080 부착 */}
                              {formatCampaignMessageForDisplay(selectedCampaign, messages[0]?.msg_contents)}
```

신규 영역 (옛 영역 + 알림톡 분기 추가):
```tsx
                            <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm border border-gray-100 text-[11.5px] leading-[1.7] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]">
                              {/* ★ D227+ (2026-05-28 영업팀장 박성용 신고 fix): 알림톡 = 옛 templateCode + templateName 표시 영역 */}
                              {selectedCampaign.send_channel === 'alimtalk' && alimtalkTemplateInfo ? (
                                <>
                                  <div className="font-bold text-emerald-700 mb-1 pb-1 border-b border-emerald-100">📨 {alimtalkTemplateInfo.name || '(템플릿명 미설정)'}</div>
                                  <div className="text-[10px] text-gray-400 mb-2">템플릿코드: {alimtalkTemplateInfo.code || '-'}</div>
                                  <div>{formatCampaignMessageForDisplay(selectedCampaign, messages[0]?.msg_contents)}</div>
                                </>
                              ) : (
                                <>
                                  {/* ★ D91: LMS/MMS 제목 표시 */}
                                  {(selectedCampaign.message_type === 'LMS' || selectedCampaign.message_type === 'MMS' || selectedCampaign.message_type === 'L' || selectedCampaign.message_type === 'M') && (selectedCampaign.subject || selectedCampaign.message_subject) && (
                                    <div className="font-bold text-gray-900 mb-1 pb-1 border-b border-gray-200">{buildAdSubjectFront(selectedCampaign.subject || selectedCampaign.message_subject || '', selectedCampaign.message_type, selectedCampaign.is_ad ?? false)}</div>
                                  )}
                                  {/* ★ B2: 컨트롤타워 — 실발송 텍스트(MySQL) 우선, 없으면 순수본문에 (광고)+080 부착 */}
                                  {formatCampaignMessageForDisplay(selectedCampaign, messages[0]?.msg_contents)}
                                </>
                              )}
```

---

## Task B: 결과 조회 성능 (backend default + PG 인덱스)

### Task B1: backend `routes/results.ts:182~232` `/campaigns` GET 안 default 7일 적용

**Files:**
- Modify: `packages/backend/src/routes/results.ts:215~222`

- [ ] **Step B1.1: 옛 buildPeriodFilter 호출 안 default 영역 추가**

옛 영역 (Line 215~222):
```ts
    // ★ D143 (2026-05-04, shiseido6 신고): 발송결과 출력 기준 = 발송일시
    //   발송 완료(sent_at) 우선 → 예약 대기(scheduled_at) → 미발송(created_at) 폴백
    //   정산이 발송일 기준이므로 4/30 등록 + 5/7 예약 캠페인은 5월 결과에 표시되어야 함
    const campDr = buildPeriodFilter('COALESCE(sent_at, scheduled_at, created_at)', {
      fromDate: fromDate ? String(fromDate) : undefined,
      toDate: toDate ? String(toDate) : undefined,
      yearMonth: (!fromDate || !toDate) ? (from ? String(from) : undefined) : undefined,
    }, paramIndex);
```

신규 영역 (옛 영역 + default 7일 한정):
```ts
    // ★ D143 (2026-05-04, shiseido6 신고): 발송결과 출력 기준 = 발송일시
    //   발송 완료(sent_at) 우선 → 예약 대기(scheduled_at) → 미발송(created_at) 폴백
    //   정산이 발송일 기준이므로 4/30 등록 + 5/7 예약 캠페인은 5월 결과에 표시되어야 함
    // ★ D227+ (2026-05-28 영업팀장 박성용 신고 fix): 옛 흐름 = 전체 조회 → 30초 로딩 사고
    //   = 옛 from/to/fromDate/toDate 모두 누락 시 = default 7일 한정 (524,331건+ 영역 안 성능 보장)
    let effectiveFromDate = fromDate ? String(fromDate) : undefined;
    let effectiveToDate = toDate ? String(toDate) : undefined;
    const effectiveYearMonth = from ? String(from) : undefined;
    if (!effectiveFromDate && !effectiveToDate && !effectiveYearMonth) {
      // default = 옛 최근 7일 (오늘 - 7일 ~ 오늘)
      const today = new Date();
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      effectiveFromDate = sevenDaysAgo.toISOString().split('T')[0];
      effectiveToDate = today.toISOString().split('T')[0];
      console.log('[results/campaigns] default 7일 한정 적용:', { effectiveFromDate, effectiveToDate });
    }
    const campDr = buildPeriodFilter('COALESCE(sent_at, scheduled_at, created_at)', {
      fromDate: effectiveFromDate,
      toDate: effectiveToDate,
      yearMonth: (!effectiveFromDate || !effectiveToDate) ? effectiveYearMonth : undefined,
    }, paramIndex);
```

---

### Task B2: PG 인덱스 추가 (주인님 직접 DB ALTER 의무)

- [ ] **Step B2.1: PG 안 직접 실행 (주인님 직접 의무)**

주인님 DB 클라이언트 (DBeaver / pgAdmin / 서버 안 psql) 안 진입 후 실행:

```sql
-- ★ D227+ (2026-05-28): 발송결과 조회 30초 로딩 사고 정정 — 표현식 인덱스 추가
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaigns_company_period
ON campaigns(company_id, COALESCE(sent_at, scheduled_at, created_at) DESC);
```

예상: `CREATE INDEX` 종결 + 옛 톤28 영역 발송결과 로딩 시간 = 30초 → 1~3초 한정.

---

## Task C: frontend default 기간 영역

### Task C1: 옛 캠페인 목록 페이지 default 기간 영역 정정

**Files:**
- Modify: `packages/frontend/src/pages/Dashboard.tsx` 또는 옛 별 영역 (Step 0.1.1 안 정확한 위치 확인 후)

- [ ] **Step C1.1: 옛 캠페인 목록 default 기간 영역 정정**

옛 흐름 정확한 영역 = Step 0.1.1 안 확인 후 정정. 일반 흐름:

옛 영역 (옛 default 영역):
```ts
const [fromDate, setFromDate] = useState<string>('');
const [toDate, setToDate] = useState<string>('');
```

신규 영역 (옛 default 영역 = 7일 한정):
```ts
const [fromDate, setFromDate] = useState<string>(() => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return sevenDaysAgo.toISOString().split('T')[0];
});
const [toDate, setToDate] = useState<string>(() => {
  return new Date().toISOString().split('T')[0];
});
```

= 옛 캠페인 목록 페이지 default 기간 = 7일 자동 표시 흐름.

---

## Task D: 검증 + 자가 grep

### Task D1: backend tsc 검증

- [ ] **Step D1.1: backend tsc 실행**

```bash
cd packages/backend
npx tsc --noEmit
```

예상: 0 errors.

### Task D2: frontend tsc 검증

- [ ] **Step D2.1: frontend tsc 실행**

```bash
cd packages/frontend
npx tsc --noEmit
```

예상: 0 errors.

### Task D3: 영구 룰 자가 grep

- [ ] **Step D3.1: 박-단어 / 진정 / 영영 / 본격 / 본 AI 자가 grep**

```bash
grep -rEn "박[음힘는을힌지혀힙히혔힐았혀]|진정|영영|본격|본 AI" \
  packages/backend/src/routes/results.ts \
  packages/frontend/src/utils/formatDate.ts \
  packages/frontend/src/components/ResultsModal.tsx \
  packages/frontend/src/pages/Dashboard.tsx 2>/dev/null
```

예상: 0건.

- [ ] **Step D3.2: 모델명 / 휴머스온 / native dialog 자가 grep**

```bash
grep -rEn "Opus|Sonnet|Haiku|GPT|Claude|Anthropic|휴머스온|Humuson" \
  packages/backend/src/routes/results.ts \
  packages/frontend/src/utils/formatDate.ts \
  packages/frontend/src/components/ResultsModal.tsx 2>/dev/null
grep -rEn "confirm\(|prompt\(|alert\(" packages/frontend/src/components/ResultsModal.tsx 2>/dev/null
```

예상: 0건 (또는 옛 영역 보존 알림 단순).

---

## Task E: 주인님 직접 배포 (no_system_modification 룰)

### Step E.1: tp-push (A 영역 — 로컬)

```powershell
cd C:\Users\ceo\projects\targetup
tp-push "D227+ 영업팀장 박성용 신고 통합 fix — (1) 알림톡 표시 (캠페인 목록 SELECT alimtalk_template_code + alimtalkTemplateInfo campaigns fallback + formatCampaignMessageForDisplay 알림톡 분기 + ResultsModal 메시지 미리보기 알림톡 분기) + (2) 발송결과 조회 성능 (default 7일 + PG 인덱스 추가)"
```

### Step E.2: 서버 SSH (B 영역) — backend + frontend build + pm2 restart

```bash
ssh administrator@app.hanjul.ai
cd /home/administrator/targetup-app
git pull
cd packages/backend
npm run build:safe
cd ../frontend
npm run build:safe
pm2 restart all
pm2 status
```

### Step E.3: PG ALTER (C 영역 — DBeaver / pgAdmin / psql)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaigns_company_period
ON campaigns(company_id, COALESCE(sent_at, scheduled_at, created_at) DESC);
```

---

## Self-Review

- [ ] **Spec coverage**: 6 fix 영역 모두 Task 매핑 종결?
  - A1 + A2 + A3 + A4 + A5 = 알림톡 표시 5건 (A1+A2 backend SELECT + A3 alimtalkTemplateInfo fallback + A4 frontend 함수 + A5 frontend UI) ✅
  - B1 + B2 = 결과 조회 성능 2건 (default 7일 + PG 인덱스) ✅
  - C1 = frontend default 기간 1건 ✅
  - D1~D3 + E1~E3 = 검증 + 배포

- [ ] **Placeholder scan**: TBD / TODO / FIXME / "implement later" 영역 0건 확인.

- [ ] **Type consistency**: 옛 alimtalkTemplateInfo 타입 = `{ code: string; name: string } | null` 영역 — ResultsModal.tsx Line 87 + backend response 정합.

---

## Codex 이중 검증 (CLAUDE.md 영구 룰 — codex_review_after_code_change)

배포 직전 = 주인님 직접 호출 의무:

```
/codex:review packages/backend/src/routes/results.ts packages/frontend/src/utils/formatDate.ts packages/frontend/src/components/ResultsModal.tsx packages/frontend/src/pages/Dashboard.tsx
```

옛 검출 이슈 = 정정 + 재배포 의무.

---

## 종결 직후

- 표준 종료 멘트: "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."
