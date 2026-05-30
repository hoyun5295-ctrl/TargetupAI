# SDK v0.3.5-b 구현 Plan — 백오피스 설치 스니펫 + first-event 온보딩

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans로 task 단위 실행. 체크박스(`- [ ]`)로 추적.

**Goal:** v0.3.5-a(SDK 코드·ingest·heartbeat)는 완료됨. v0.3.5-b는 백오피스(`CdpSettingsPage`)에 ① SDK 설치 스크립트 스니펫 카드 + ② first-event 온보딩 화면(5/10/30분 단계 + heartbeat 5단계)을 추가해 "붙이면 15분 안에 들어온다"를 admin이 확인하게 만든다.

**Architecture:** 기존 CDP 인프라(키 발급 `issue-key`, 진단 `buildCdpDiagnostics`, `GET /recent-events`, `GET /usage`)를 재사용하고 빠진 2개만 신설. CdpSettingsPage는 **다크 톤**(bg-slate-950 + violet)이라 추가 UI도 다크 톤 + design_quality 다크 변형 준수(흰 톤 X). 신규 backend는 cdp_events 조회라 db_alter_safety_net(503) 의무.

**Tech Stack:** Express + PostgreSQL(cdp_events) + React/TS + Tailwind(다크) + lucide.

**전제(검증 상태):**
- v0.3.5-a 코드 완료(commit 46ef104) — `sdk-js/src/auto-capture/` 9모듈 + `routes/cdp.ts` POST `/ingest`.
- heartbeat 5단계 = `sdk_loaded / config_loaded / domain_matched / first_pageview_sent / first_event_accepted` (`sdk-js/src/auto-capture/heartbeat.ts`).
- **DB gate(Harold 확인 중)**: cdp_events ALTER 6컬럼+2인덱스 — 미실행 시 `/ingest` 및 `/install-status`가 503(DB_MIGRATION_PENDING). 핸드오프 §4-1 SQL.
- 이미 존재(재사용, 신설 금지): `issue-key`, Public/Secret 복사(SecretRow), `buildCdpDiagnostics`, `GET /recent-events`, `GET /usage`(has_key/issued_at).

**범위 밖(분리 — Harold 결정 대기):**
- **도메인 입력 + CORS 자동 등록** — `/api/cdp`는 헤더 인증(X-Hanjullo-Key/Secret)이 보안 경계이고 CORS는 app.ts `CORS_ORIGIN` env 전역 관리. 회사별 도메인 allowlist 저장 미존재 = 인프라성 신규 = 우선순위 낮음. v0.3.5-b 1차에서 제외(별 spec).
- CDN 배포(`cdn.hanjul.ai/sdk/v0.3.5/...`) = 인프라(Harold).
- POPPON 실측 = 배포 후.

---

## Phase 1 — SDK 설치 스니펫 카드

### Task 1: backend — `/usage`에 public key 노출

**Files:** Modify `packages/backend/src/routes/cdp.ts` (GET `/usage` SELECT + 응답)

- [ ] **Step 1: public key 반환 추가** (`cdp_api_key`는 비밀 아님 — 스니펫 표시용. 이미 `has_key`로 같은 컬럼 사용 중이라 신규 컬럼 X)

`/usage` SELECT에 `c.cdp_api_key AS public_key` 추가, 응답에 `public_key: row.public_key || null` 추가.

```typescript
// SELECT 내
          c.cdp_api_key IS NOT NULL AS has_key,
          c.cdp_api_key AS public_key,
          c.cdp_api_key_issued_at AS issued_at,
// 응답 내
      has_key: !!row.has_key,
      public_key: row.public_key || null,
      issued_at: row.issued_at,
```

- [ ] **Step 2: backend tsc 0** — `cd packages/backend && npx tsc --noEmit` (exit 0)

### Task 2: frontend — 설치 스니펫 카드 (다크 톤)

**Files:** Modify `packages/frontend/src/pages/CdpSettingsPage.tsx` (usage state에 public_key 반영 + 스니펫 카드 1개 추가)

- [ ] **Step 1: usage 응답 public_key 반영** — usage fetch 결과에서 `public_key` 보관(state 또는 기존 usage 객체).

- [ ] **Step 2: 스니펫 카드 추가** (키 발급 카드 근처). 다크 톤 `bg-slate-900 border border-white/10 rounded-2xl`. pinned CDN URL + public key 자동 삽입 + 복사. 키 미발급 시 "먼저 CDP 키를 발급하세요" 안내.

```tsx
{usage?.public_key && (
  <div className="bg-slate-900 border border-white/10 rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-2">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center"><Code2 className="w-5 h-5 text-white" /></div>
      <div>
        <div className="text-sm font-semibold text-white">SDK 설치 스크립트</div>
        <div className="text-xs text-white/50">자사몰 &lt;head&gt;에 붙여넣으면 수집이 시작됩니다.</div>
      </div>
    </div>
    <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
    <button onClick={() => copyText(snippet, '설치 스크립트')} className="mt-2 px-3 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" />복사</button>
    <div className="text-[10px] text-white/30 italic mt-2">Data source — pinned CDN(cdn.hanjul.ai/sdk/v0.3.5)</div>
  </div>
)}
```

snippet 문자열(컴포넌트 내 const, public_key 주입):
```tsx
const snippet = usage?.public_key
  ? `<script src="https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js" data-hjl-key="${usage.public_key}" async></script>`
  : '';
```
`Code2`는 lucide import에 추가.

- [ ] **Step 3: frontend tsc 0**

---

## Phase 2 — first-event 온보딩 화면 (5/10/30분 + heartbeat 5단계)

### Task 3: backend — `GET /api/cdp/install-status`

**Files:** Modify `packages/backend/src/routes/cdp.ts` (신규 endpoint) + 필요 시 `utils/cdp-events.ts` CT에 조회 함수

- [ ] **Step 1: heartbeat 전송 형태 확인** — `sdk-js/src/auto-capture/index.ts`에서 heartbeat emit이 `/ingest`로 보낼 때 event_type을 확인(스테이지명 그대로인지 `heartbeat`+payload.stage인지). 그 결과로 아래 쿼리의 WHERE를 확정(db_column_verify 정신 — 추측 X).

- [ ] **Step 2: endpoint 신설** — 회사 인증(req.user.companyId). cdp_events 조회 + db_alter_safety_net.

```typescript
// GET /api/cdp/install-status — 설치 후 첫 이벤트/heartbeat 단계 진단
router.get('/install-status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // keyIssuedAt
    const keyRow = await query(`SELECT cdp_api_key_issued_at FROM companies WHERE id = $1::uuid`, [companyId]);
    const keyIssuedAt = keyRow.rows[0]?.cdp_api_key_issued_at || null;
    // 첫 이벤트 + 24h 건수 + heartbeat 단계 (Step 1 결과로 WHERE 확정)
    const ev = await query(
      `SELECT MIN(received_at) AS first_event_at,
              COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') AS count_24h
         FROM cdp_events WHERE company_id = $1::uuid`,
      [companyId],
    );
    const hb = await query(
      `SELECT DISTINCT event_type FROM cdp_events
        WHERE company_id = $1::uuid
          AND event_type = ANY($2::text[])`,
      [companyId, ['sdk_loaded','config_loaded','domain_matched','first_pageview_sent','first_event_accepted']],
    );
    const reached = new Set(hb.rows.map((r: any) => r.event_type));
    return res.json({
      success: true,
      keyIssuedAt,
      firstEventAt: ev.rows[0]?.first_event_at || null,
      count24h: parseInt(ev.rows[0]?.count_24h || '0'),
      heartbeat: {
        sdk_loaded: reached.has('sdk_loaded'),
        config_loaded: reached.has('config_loaded'),
        domain_matched: reached.has('domain_matched'),
        first_pageview_sent: reached.has('first_pageview_sent'),
        first_event_accepted: reached.has('first_event_accepted'),
      },
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 cdp_events ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /install-status] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});
```
> Step 1에서 heartbeat가 `event_type='heartbeat'` + payload.stage 형태로 확인되면 hb 쿼리를 `payload->>'stage'` 기준으로 교체.

- [ ] **Step 3: backend tsc 0**

### Task 4: frontend — first-event 온보딩 카드

**Files:** Modify `packages/frontend/src/pages/CdpSettingsPage.tsx`

- [ ] **Step 1: install-status fetch + 폴링** — 키 발급 상태에서 첫 이벤트 미수신 시 10초 폴링(첫 이벤트 수신되면 폴링 중단). `useEffect` + setInterval(언마운트 clearInterval).

- [ ] **Step 2: 온보딩 카드(다크 톤)** — keyIssuedAt 기준 경과시간으로 5/10/30분 단계 안내 + heartbeat 5단계 체크리스트(완료 emerald Check / 대기 slate). firstEventAt 있으면 "첫 이벤트 수신 완료" 성공 상태.

```tsx
// 단계: 경과 분 = (now - keyIssuedAt)/60000
// 0~5분: "설치 후 첫 이벤트 대기 중" / 5~10분: "5분 경과 — sdk_loaded 확인" / 10~30분: "10분 경과 — domain_matched/pageview 확인" / 30분+: "30분 경과 — 설치 점검 안내"
// firstEventAt != null → 성공 카드(emerald)
const STAGE_LABEL = {
  sdk_loaded: 'SDK 로드', config_loaded: '설정 수신', domain_matched: '도메인 확인',
  first_pageview_sent: '첫 페이지뷰 전송', first_event_accepted: '첫 이벤트 수신',
};
```
카드 구조: 헤더(아이콘 칩 violet + 제목) + 진행 상태 문구 + heartbeat 5단계 리스트(각 항목 Check/대기) + Source caption(`text-[10px] text-white/30 italic`). native dialog 0 / useToast 활용.

- [ ] **Step 3: frontend tsc 0**

---

## Task 5: 통합 검증

- [ ] backend `tsc --noEmit` 0 / frontend `tsc --noEmit` 0
- [ ] 자가 grep: 모델명(opus/sonnet/gpt/claude) 0 / native dialog(alert/confirm/prompt) 0 / 박-단어·정합·매트릭스 0 — CdpSettingsPage + cdp.ts 변경분
- [ ] sdk-js vitest 영향 없음(SDK 코드 미변경 — 백오피스만)
- [ ] cdp_events ALTER 실행 후 `/install-status` 503 아님 확인(Harold)

## Task 6: codex / 내장 review
- [ ] `/codex:review`(또는 내장 code-review) — install-status 쿼리 + 스니펫/온보딩 UI

---

## Self-Review

**Spec coverage(§5.1):** #9 스니펫 발급 → Task 1·2 / #10 first-event + 5/10/30분 + heartbeat → Task 3·4. #9의 "도메인+CORS 자동 등록" = 범위 밖(분리, 사유 명시). 키 발급(#9 일부)은 기존 재사용.

**중복 점검(no_inline_duplication):** 키 발급/진단/recent-events/usage 재사용, 신설은 `/install-status` 1개 + 카드 2개. cdp_events 조회는 `utils/cdp-events.ts` CT에 함수 추가 가능(인라인 금지).

**DB 안전(db_column_verify + db_alter_safety_net):** `/usage` public_key = 기존 `cdp_api_key` 컬럼(검증됨). `/install-status` = cdp_events 신규 컬럼 → ALTER gate + 503 분기.

**톤:** CdpSettingsPage 다크 톤 → 추가 UI 다크(bg-slate-900 + violet) + Source caption + useToast. 흰 톤 X.

**구현 중 정정(no_guess — SDK 소스 직접 확인):** heartbeat 5단계는 SDK 클라이언트 로컬 mark(`auto-capture/index.ts:58` debug console.log만, 서버 미전송)로 확인됨 → cdp_events에 적재 안 됨. 따라서 Phase 2는 **서버 관측 신호**(`/ingest`가 저장하는 event_type = pageview/identify/consent/click 수신 + MIN(received_at))로 진단하도록 변경 구현. `/install-status`는 BOOL_OR로 신호 집계 + db_alter_safety_net(503). literal heartbeat 5단계 서버 노출이 필요하면 SDK transport에 heartbeat 전송 추가(별 증분 — 커밋된 v0.3.5-a 변경).

**구현 완료(2026-05-31):** Phase 1(backend `/usage` public_key + 설치 스니펫 카드) + Phase 2(`/install-status` + 설치 검증 온보딩 카드 + 10초 폴링). backend/frontend tsc 0 + native dialog·모델명 grep 0. cdp_events ALTER 적용 확인됨(6컬럼+2인덱스). 잔여 = CDN 배포(인프라) + POPPON 실측 + `/codex:review` + package.json 0.3.5 범프 + spec archive 이동 + (분리)도메인·CORS.
