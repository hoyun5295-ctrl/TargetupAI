# SDK 브라우저 ingest 인증 + 카페24·고도몰 듀얼 플랫폼 토대 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans. 체크박스(`- [ ]`) 추적.

**Goal:** 브라우저 SDK가 secret 없이 안전하게 `/ingest`에 수집할 수 있게 만들고(public key + 등록 도메인 Origin 검증), 카페24·고도몰 둘 다 회원 식별이 되도록 SDK identify를 플랫폼 자동 감지로 보강한다. 테스트 대상 = dibambi.com·isae.shop(둘 다 Cafe24 확인됨) + 고도몰 대비.

**Architecture:** ① 공통 토대 = 브라우저 전용 ingest 인증 미들웨어(secret 불요) + 회사별 `cdp_allowed_origins` + `/ingest` CORS + 도메인 등록 UI. ② 플랫폼별 identify = SDK가 Cafe24 전역(`CAPP_ASYNC_METHODS`) / 고도몰 data-attr를 자동 감지. 서버-투-서버(identify/order)는 기존 secret 인증 유지.

**Tech Stack:** Express + PG(companies.cdp_allowed_origins) + React/TS(다크 톤) + sdk-js(Rollup IIFE + vitest).

**전제(검증 완료):**
- `companies.cdp_allowed_origins text[] DEFAULT '{}'` ALTER 적용 확인(Harold 2026-05-31).
- cdp_events ALTER(6컬럼+2인덱스) 적용 확인.
- 블로커 근거: `transport.ts:71` = `X-Hanjullo-Key`만 전송 / `cdp-auth.ts:110` `requireCdpApiKey` = Key+Secret 둘 다 필수 → 브라우저 401.
- 회원ID 변수: 고도몰 `{=gSess.memNo}`(data-attr 직접) / Cafe24 `CAPP_ASYNC_METHODS.AppCommon.getMemberInfo().member_id`(JS 변수, 구현 직전 Cafe24 개발자 문서 재확인).

**규칙:** CT 단일 진입점(cdp-auth.ts에 미들웨어) / db_alter_safety_net(신규 컬럼 endpoint 503) / 다크 톤 + native dialog 0 + 모델명 0 / SDK 변경 시 vitest + IIFE 재빌드.

---

## Task 1: backend — 브라우저 전용 ingest 인증 미들웨어

**Files:** Modify `packages/backend/src/utils/cdp-auth.ts` (신규 export)

- [ ] **Step 1: `requireCdpBrowserOrigin` 추가** (public key + Origin 검증, secret 불요)

```typescript
/**
 * 브라우저 SDK 전용 — public key + 등록 도메인(Origin) 검증 (secret 미요구).
 * secret을 브라우저에 두면 탈취 사고 → 브라우저 경로는 Origin allowlist가 보안 경계.
 */
export async function requireCdpBrowserOrigin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cdpApiKey = (req.headers['x-hanjullo-key'] || req.headers['X-Hanjullo-Key']) as string | undefined;
    if (!cdpApiKey || !cdpApiKey.startsWith('hjl_')) {
      res.status(401).json({ success: false, error: 'X-Hanjullo-Key 누락 또는 포맷 오류', code: 'MISSING_KEY' });
      return;
    }
    const result = await query(
      `SELECT id, company_name, status, cdp_allowed_origins FROM companies WHERE cdp_api_key = $1`,
      [cdpApiKey],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'CDP 인증 실패', code: 'INVALID_KEY' });
      return;
    }
    const company = result.rows[0];
    if (company.status !== 'active') {
      res.status(403).json({ success: false, error: `회사 상태 ${company.status}`, code: 'COMPANY_INACTIVE' });
      return;
    }
    if (!(await isCdpEnabledForPlan(company.id))) {
      res.status(403).json({ success: false, error: '한줄로 CDP는 비즈니스 요금제부터 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
      return;
    }
    if (await isOverMonthlyCdpLimit(company.id)) {
      res.status(429).json({ success: false, error: '이번 달 CDP 호출 한도 초과', code: 'MONTHLY_LIMIT_EXCEEDED' });
      return;
    }
    const norm = (o: string) => o.trim().toLowerCase().replace(/\/+$/, '');
    const origin = norm((req.headers['origin'] as string) || '');
    const allowed: string[] = Array.isArray(company.cdp_allowed_origins) ? company.cdp_allowed_origins.map(norm) : [];
    if (!origin || !allowed.includes(origin)) {
      res.status(403).json({ success: false, error: '등록되지 않은 도메인입니다. 관리자 → CDP 설정에서 도메인을 먼저 등록해주세요.', code: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    req.cdpAuth = { companyId: company.id, companyName: company.company_name, source: 'sdk' };
    next();
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_origins ALTER 요청', code: 'DB_MIGRATION_PENDING' });
      return;
    }
    console.error('[CDP BrowserAuth] 실패:', err);
    res.status(500).json({ success: false, error: 'CDP 인증 처리 오류' });
  }
}
```

- [ ] **Step 2: backend tsc 0**

---

## Task 2: backend — `/ingest`를 브라우저 인증으로 전환

**Files:** Modify `packages/backend/src/routes/cdp.ts` (import + `/ingest` 미들웨어 교체)

- [ ] **Step 1:** import에 `requireCdpBrowserOrigin` 추가, `router.post('/ingest', requireCdpApiKey, ...)` → `router.post('/ingest', requireCdpBrowserOrigin, ...)`. companyId 추출부는 `req.cdpAuth?.companyId` 유지(동일). 나머지 endpoint(identify/order/event/push 등)는 `requireCdpApiKey` 그대로.
- [ ] **Step 2: backend tsc 0**

---

## Task 3: backend — 도메인 등록 endpoint (회사 admin)

**Files:** Modify `packages/backend/src/routes/cdp.ts` (신규 3 endpoint, `/usage` 인근)

- [ ] **Step 1:** `GET /api/cdp/allowed-origins`(목록) + `POST /api/cdp/allowed-origins`(추가, body {origin}) + `DELETE /api/cdp/allowed-origins`(삭제, body {origin}). 회사 admin(req.user) 인증. origin 정규화(소문자+trailing slash 제거) + `https://` 시작 검증 + 배열 갱신(`array_append`/`array_remove` 또는 SELECT→정제→UPDATE).

```typescript
// POST 예시 핵심
const norm = (o: string) => o.trim().toLowerCase().replace(/\/+$/, '');
const o = norm(req.body?.origin || '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(o)) return res.status(400).json({ success:false, error:'https://도메인 형식만 허용' });
await query(
  `UPDATE companies SET cdp_allowed_origins =
     (SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(cdp_allowed_origins,'{}') || $2::text[])) ) , updated_at=NOW()
   WHERE id = $1::uuid`, [companyId, [o]]);
```
- [ ] **Step 2: backend tsc 0**

---

## Task 4: backend — `/ingest` CORS 허용 (전역 제한과 무관)

**Files:** Modify `packages/backend/src/app.ts` (cdp ingest 경로 전용 cors를 전역 cors보다 먼저 mount)

- [ ] **Step 1: 현재 app.ts cors 블록 정독**(126-140) 후, 전역 `app.use(cors(...))` **앞**에 path 전용 추가:

```typescript
import cors from 'cors';
// 브라우저 SDK 수집 — 등록 도메인은 POST에서 key+Origin 검증하므로 preflight는 Origin reflect 허용
app.use('/api/cdp/ingest', cors({
  origin: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Hanjullo-Key', 'X-Hanjullo-Schema-Version', 'X-Hanjullo-SDK-Version'],
  maxAge: 86400,
}));
```
(이미 `cors` import 되어 있으면 재import 금지 — 확인 후.)
- [ ] **Step 2: backend tsc 0**

---

## Task 5: frontend — CdpSettingsPage 도메인 등록 UI

**Files:** Modify `packages/frontend/src/pages/CdpSettingsPage.tsx` (다크 톤 카드 + 상태/fetch)

- [ ] **Step 1:** `allowedOrigins` state + `GET /api/cdp/allowed-origins` 로드(loadAll에 합류 또는 별 fetch). 키 발급 카드/스니펫 카드 인근에 도메인 등록 카드: input(https://...) + 추가 버튼 + 등록 목록(삭제 버튼). 추가/삭제 = POST/DELETE 후 갱신 + useToast. native dialog 0. 다크 톤(bg-white/5 + border-white/10 + violet). Source caption.
- [ ] **Step 2:** 스니펫 카드에 "이 도메인을 먼저 등록하세요" 연계 안내(미등록 시).
- [ ] **Step 3: frontend tsc 0 + native dialog/모델명 grep 0**

---

## Task 6: SDK identify 플랫폼 자동 감지 (Cafe24 + 고도몰)

**Files:** Modify `packages/sdk-js/src/auto-capture/identify.ts` + 필요 시 `index.ts` + 테스트

- [ ] **Step 1: Cafe24 member API 형태 확정** — Cafe24 developers 문서로 `CAPP_ASYNC_METHODS.AppCommon.getMemberInfo()` 반환 형태(동기/콜백/Promise, member_id 키)를 실제 확인(추측 X). 확정 후 코드.
- [ ] **Step 2:** `detectIdentify`에 우선순위 추가: ① body `data-hjl-user-id`(고도몰/범용) → ② Cafe24 전역(`window.CAPP_ASYNC_METHODS` 존재 시 회원 조회) → 있으면 `external_id` 확정. 동기 미존재 시 콜백/짧은 폴링으로 1회 식별.
- [ ] **Step 3:** vitest 추가(고도몰 data-attr 케이스 + Cafe24 전역 mock 케이스). `npx vitest run` PASS.
- [ ] **Step 4:** IIFE 재빌드(`npm run build` rollup) → `dist/iife/hanjul.min.js` 갱신 + VERSION 표기 점검.

---

## Task 7: 설치 가이드 (플랫폼별)

**Files:** Create `docs/sdk/install-cafe24.md` + `docs/sdk/install-godomall.md` (또는 통합 1 문서)

- [ ] **Step 1:** 스니펫 삽입 위치(<head>) + 도메인 등록 + 회원 식별 주입(고도몰 `data-hjl-user-id="{=gSess.memNo}"` / Cafe24 글루 또는 SDK 자동) + `/install-status`로 확인. 업체 개발 담당 전달용.

---

## Task 8: 통합 검증
- [ ] backend tsc 0 / frontend tsc 0 / sdk vitest PASS
- [ ] 자가 grep: 모델명·native dialog·박-단어·정합·매트릭스 0 (변경 파일)
- [ ] cdp_allowed_origins ALTER 적용 확인됨 → `/ingest` 등록 도메인에서 200, 미등록 403 ORIGIN_NOT_ALLOWED

## Task 9: codex/내장 review
- [ ] `/codex:review`(또는 내장) — 브라우저 인증 미들웨어 + CORS + identify 감지

---

## Self-Review

**커버리지:** 브라우저 401 블로커 → Task 1·2·4. 도메인 등록 → Task 3·5. 카페24·고도몰 식별 → Task 6. 가이드 → Task 7.
**보안:** 브라우저 = public key + Origin allowlist(secret 미노출). 서버-투-서버 = secret 유지. CORS preflight reflect는 POST 인증이 실 경계.
**DB:** cdp_allowed_origins(ALTER 확인) + db_alter_safety_net 503. 신규 컬럼 외 추가 없음.
**SDK 변경 주의:** Task 6은 커밋된 v0.3.5-a 수정 → vitest + IIFE 재빌드 의무. Cafe24 API 형태는 구현 직전 문서 재확인(추측 X).
**범위 밖:** CDN 배포(인프라) / POPPON·dibambi·isae 실측(배포 후) / 고도몰 adapter(v0.4.5).
