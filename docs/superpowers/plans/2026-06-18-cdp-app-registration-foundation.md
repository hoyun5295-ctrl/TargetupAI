# CDP 자사몰 연동 — 앱 등록·앱 키 인증 토대 (1단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 한줄로 자사몰 연동(CDP)에 앱(번들ID) 등록을 추가하고, 네이티브 앱이 **퍼블릭키 + 등록 번들ID**로(시크릿 없이) `/inapp/active`·`/inapp/track`을 인증 호출할 수 있게 한다. 기존 웹(키+도메인)·서버(키+시크릿) 인증은 무손.

**Architecture:** `companies.cdp_allowed_origins`(text[]) + `requireCdpBrowserOrigin` 패턴을 그대로 미러 → `companies.cdp_allowed_app_ids`(text[]) + `requireCdpAppId`. `requireCdpKeyOrBrowserOrigin`에 "시크릿 없음 + `X-Hanjullo-App-Id` 있음 → 앱 경로" 분기를 추가한다(웹/서버 경로 변경 0). `/api/cdp/allowed-app-ids` CRUD + CdpSettingsPage 앱 등록 섹션.

**Tech Stack:** Node/Express + PostgreSQL + React/TS. backend vitest + tsc, frontend tsc.

**구현 레포:** `C:\Users\ceo\projects\targetup` (한줄로 본체). 

**운영 경고:** `/inapp/active`·`/inapp/track`은 운영 중 라이브 인증 경로다. 기존 분기를 건드리지 말고 **새 분기만 추가**한다. 종료 전 Codex `/codex:adversarial-review` 의무.

---

## 결정/선행 (착수 전)

- 인증 모델: 퍼블릭키(`X-Hanjullo-Key`) + `X-Hanjullo-App-Id`(번들ID, 예 `kr.poppon.app`)가 회사 `cdp_allowed_app_ids`에 있으면 통과. 시크릿 불요(앱에 시크릿 넣지 않음).
- DB ALTER는 Harold 직접 실행. 커밋·배포도 Harold.
- 본 단계는 한줄로 본체만. 팝폰 RN 렌더러는 2단계(`2026-06-18-app-inapp-rn-renderer-1.md`).

---

## File Structure

**수정 (backend):**
- `packages/backend/src/utils/cdp-auth.ts` — `isAllowedAppId` 헬퍼 + `requireCdpAppId` 미들웨어 + `requireCdpKeyOrBrowserOrigin` 앱 분기
- `packages/backend/src/routes/cdp.ts` — `GET/POST/DELETE /api/cdp/allowed-app-ids`
- `packages/backend/src/utils/__tests__/cdp-auth.test.ts` — `isAllowedAppId` 단위 테스트 (없으면 신규)

**수정 (frontend):**
- `packages/frontend/src/pages/CdpSettingsPage.tsx` — 앱 등록 상태·핸들러 + 자체 호스팅 모달 내 앱 등록 섹션 + 앱 SDK 안내

**수정 (문서):**
- `status/SCHEMA.md` — `companies.cdp_allowed_app_ids` 기록

---

## Task 1: DB 컬럼 추가 (information_schema 선검증 → ALTER)

**Files:** `status/SCHEMA.md`

- [ ] **Step 1: 컬럼 부재 확인 SQL을 Harold께 제공**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'companies' AND column_name = 'cdp_allowed_app_ids';
```
Expected: 0 rows (아직 없음).

- [ ] **Step 2: ALTER (Harold 실행)**

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cdp_allowed_app_ids text[];
```

- [ ] **Step 3: SCHEMA.md 기록** — `cdp_allowed_origins` 줄 아래에 추가:

```
| cdp_allowed_app_ids | text[] | ★ 2026-06-18 실측 (CDP 네이티브 앱 키 인증 허용 번들ID) |
```

- [ ] **Step 4: 커밋 (Harold)** — `docs: schema cdp_allowed_app_ids`

---

## Task 2: 앱 키 인증 (TDD)

**Files:**
- `packages/backend/src/utils/cdp-auth.ts`
- `packages/backend/src/utils/__tests__/cdp-auth.test.ts`

- [ ] **Step 1: 실패 테스트 (isAllowedAppId 순수 헬퍼)**

```ts
// packages/backend/src/utils/__tests__/cdp-auth.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedAppId } from '../cdp-auth';

describe('isAllowedAppId', () => {
  it('등록된 번들ID는 통과(대소문자·공백 무시)', () => {
    expect(isAllowedAppId(['kr.poppon.app'], ' KR.Poppon.App ')).toBe(true);
  });
  it('미등록 번들ID는 차단', () => {
    expect(isAllowedAppId(['kr.poppon.app'], 'com.other.app')).toBe(false);
  });
  it('빈 입력/빈 목록은 차단', () => {
    expect(isAllowedAppId([], 'kr.poppon.app')).toBe(false);
    expect(isAllowedAppId(['kr.poppon.app'], '')).toBe(false);
    expect(isAllowedAppId(null as any, 'kr.poppon.app')).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/__tests__/cdp-auth.test.ts` → FAIL (isAllowedAppId 미정의)

- [ ] **Step 3: 헬퍼 구현** — `cdp-auth.ts`에 추가 (export)

```ts
/** 번들ID 정규화 — 소문자 + 트림 */
function normAppId(s: string): string { return String(s || '').trim().toLowerCase(); }

/** 등록된 번들ID 목록에 appId가 있는지 (대소문자·공백 무시) */
export function isAllowedAppId(allowed: string[] | null | undefined, appId: string): boolean {
  const id = normAppId(appId);
  if (!id) return false;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.map(normAppId).includes(id);
}
```

- [ ] **Step 4: 통과 확인** — Run 동일 → PASS

- [ ] **Step 5: `requireCdpAppId` 미들웨어 추가** — `requireCdpBrowserOrigin`를 복제해, **회사 조회·status 체크·503 가드는 동일하게 두고 Origin 검증만 App-Id 검증으로 교체**한다. `cdp_allowed_origins` → `cdp_allowed_app_ids`, `req.headers['origin']` → `req.headers['x-hanjullo-app-id']`, allowlist 비교를 `isAllowedAppId(company.cdp_allowed_app_ids, appId)`로. **req에 회사 컨텍스트를 붙이는 줄은 `requireCdpBrowserOrigin`과 완전히 동일하게** 둔다(다운스트림 핸들러가 같은 값을 읽으므로).

```ts
// cdp-auth.ts — requireCdpBrowserOrigin 바로 아래에 추가
// 네이티브 앱 인증 — public key + 등록 번들ID(X-Hanjullo-App-Id). 시크릿/Origin 불요.
//   앱은 브라우저 Origin을 못 보내므로(RN), 등록 번들ID가 보안 경계.
export async function requireCdpAppId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cdpApiKey = (req.headers['x-hanjullo-key'] || req.headers['X-Hanjullo-Key']) as string | undefined;
    if (!cdpApiKey || !cdpApiKey.startsWith('hjl_')) {
      res.status(401).json({ success: false, error: 'X-Hanjullo-Key 누락 또는 포맷 오류입니다.', code: 'MISSING_KEY' });
      return;
    }
    const appId = (req.headers['x-hanjullo-app-id'] || req.headers['X-Hanjullo-App-Id']) as string | undefined;
    const r = await query(
      `SELECT id, company_name, status, cdp_allowed_app_ids
         FROM companies WHERE cdp_api_key = $1`,
      [cdpApiKey],
    );
    const company = r.rows[0];
    if (!company) { res.status(401).json({ success: false, error: '유효하지 않은 키입니다.', code: 'INVALID_KEY' }); return; }
    if (company.status && company.status !== 'active') { res.status(403).json({ success: false, error: '비활성 회사입니다.', code: 'INACTIVE' }); return; }
    if (!isAllowedAppId(company.cdp_allowed_app_ids, appId || '')) {
      res.status(403).json({ success: false, error: '등록되지 않은 앱입니다. 자사몰 연동에서 앱(번들ID)을 등록하세요.', code: 'APP_NOT_ALLOWED' });
      return;
    }
    // ★ req 회사 컨텍스트 부착 — requireCdpBrowserOrigin과 동일하게 (그 함수의 해당 줄을 그대로 복사)
    (req as any).cdpCompany = { id: company.id, companyName: company.company_name };
    next();
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
      return;
    }
    console.error('[CDP requireCdpAppId] 오류:', err);
    res.status(500).json({ success: false, error: '인증 처리 오류' });
  }
}
```
> ⚠️ `(req as any).cdpCompany = ...` 줄은 **반드시 `requireCdpBrowserOrigin`이 실제로 붙이는 필드명/형태와 일치**시킨다(이 파일에서 그 함수를 열어 해당 줄을 그대로 복사). 다르면 다운스트림 핸들러가 회사를 못 읽어 깨진다.

- [ ] **Step 6: `requireCdpKeyOrBrowserOrigin`에 앱 분기 추가** (기존 분기 무손)

```ts
export async function requireCdpKeyOrBrowserOrigin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const hasSecret = !!(req.headers['x-hanjullo-secret'] || req.headers['X-Hanjullo-Secret']);
  if (hasSecret) return requireCdpApiKey(req, res, next);
  const hasAppId = !!(req.headers['x-hanjullo-app-id'] || req.headers['X-Hanjullo-App-Id']);
  if (hasAppId) return requireCdpAppId(req, res, next);
  return requireCdpBrowserOrigin(req, res, next);
}
```

- [ ] **Step 7: tsc + 전체 vitest** — Run: `cd packages/backend && npx tsc --noEmit && npx vitest run src/utils/__tests__/cdp-auth.test.ts` → 0 errors + PASS
- [ ] **Step 8: 커밋 (Harold)** — `feat(cdp): native app-id auth branch`

---

## Task 3: allowed-app-ids 엔드포인트 (allowed-origins 미러)

**Files:** `packages/backend/src/routes/cdp.ts`

- [ ] **Step 1: 3개 엔드포인트 추가** — `allowed-origins` 블록(DELETE) 바로 아래에 삽입. 번들ID 형식 검증(역DNS: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`).

```ts
// GET /api/cdp/allowed-app-ids — 네이티브 앱 키 인증 허용 번들ID 목록
router.get('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids GET] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/cdp/allowed-app-ids — 번들ID 추가 (회사 관리자) body { appId }
router.post('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') return res.status(403).json({ success: false, error: '앱 등록은 회사 관리자만 가능합니다.' });
    const appId = String(req.body?.appId || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(appId)) {
      return res.status(400).json({ success: false, error: '번들ID 형식만 허용됩니다. (예: kr.poppon.app)' });
    }
    await query(
      `UPDATE companies
         SET cdp_allowed_app_ids = ARRAY(SELECT DISTINCT unnest(COALESCE(cdp_allowed_app_ids, '{}'::text[]) || $2::text[])),
             updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, [appId]],
    );
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids POST] 오류:', err);
    return res.status(500).json({ success: false, error: '등록 실패' });
  }
});

// DELETE /api/cdp/allowed-app-ids — 번들ID 삭제 (회사 관리자) body { appId }
router.delete('/allowed-app-ids', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (req.user?.userType !== 'company_admin') return res.status(403).json({ success: false, error: '앱 삭제는 회사 관리자만 가능합니다.' });
    const appId = String(req.body?.appId || '').trim().toLowerCase();
    await query(
      `UPDATE companies SET cdp_allowed_app_ids = array_remove(COALESCE(cdp_allowed_app_ids, '{}'::text[]), $2), updated_at = NOW()
       WHERE id = $1::uuid`,
      [companyId, appId],
    );
    const r = await query(`SELECT cdp_allowed_app_ids FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, appIds: r.rows[0]?.cdp_allowed_app_ids || [] });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.cdp_allowed_app_ids ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[CDP /allowed-app-ids DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: '삭제 실패' });
  }
});
```

- [ ] **Step 2: tsc** — Run: `cd packages/backend && npx tsc --noEmit` → 0 errors
- [ ] **Step 3: 커밋 (Harold)** — `feat(cdp): allowed-app-ids endpoints`

---

## Task 4: 자사몰 연동 화면 — 앱 등록 섹션

**Files:** `packages/frontend/src/pages/CdpSettingsPage.tsx`

- [ ] **Step 1: 상태·핸들러 추가** (`allowedOrigins` 패턴 미러)

```tsx
const [allowedAppIds, setAllowedAppIds] = useState<string[]>([]);
const [newAppId, setNewAppId] = useState('');

// 로드 — 기존 allowed-origins useEffect 옆에 추가
useEffect(() => {
  (async () => {
    try {
      const res = await fetch('/api/cdp/allowed-app-ids', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) setAllowedAppIds(data.appIds || []);
    } catch { /* 무시 */ }
  })();
}, []);

const addAppId = async () => {
  const id = newAppId.trim().toLowerCase();
  if (!id) return;
  try {
    const res = await fetch('/api/cdp/allowed-app-ids', {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: id }),
    });
    const data = await res.json();
    if (data.success) { setAllowedAppIds(data.appIds || []); setNewAppId(''); toast.success('앱이 등록되었습니다.'); }
    else toast.error(data.error || '앱 등록 실패');
  } catch { toast.error('앱 등록 네트워크 오류'); }
};

const removeAppId = async (id: string) => {
  try {
    const res = await fetch('/api/cdp/allowed-app-ids', {
      method: 'DELETE', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: id }),
    });
    const data = await res.json();
    if (data.success) { setAllowedAppIds(data.appIds || []); toast.success('앱이 삭제되었습니다.'); }
    else toast.error(data.error || '앱 삭제 실패');
  } catch { toast.error('앱 삭제 네트워크 오류'); }
};
```

- [ ] **Step 2: UI 섹션 추가** — 자체 호스팅(`connectProvider === 'custom'`) 모달 내, 도메인 등록(allowed-origins) 섹션 **바로 아래**에 "앱 등록" 섹션을 삽입(같은 모달 = 웹/앱 한자리). 디자인 = 기존 톤(`bg-white/5 border-white/10 rounded-xl`, violet 액센트, ConfirmModal/useToast — native dialog 금지).

```tsx
<div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
  <div className="flex items-center gap-2">
    <Code2 className="w-4 h-4 text-violet-300" />
    <span className="text-sm font-semibold text-white">앱(네이티브) 등록</span>
  </div>
  <p className="text-[12px] text-white/55 leading-relaxed">
    iOS·안드로이드 앱에 인앱 메시지를 띄우려면 앱의 번들ID(패키지명)를 등록하세요. 앱은 퍼블릭키 + 등록 번들ID로 인증하며, 시크릿은 앱에 넣지 않습니다.
  </p>
  <div className="flex gap-2">
    <input
      value={newAppId} onChange={(e) => setNewAppId(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') addAppId(); }}
      placeholder="예: kr.poppon.app"
      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30"
    />
    <button onClick={addAppId} className="px-4 py-2 rounded-lg bg-violet-500/80 hover:bg-violet-500 text-white text-sm font-medium">등록</button>
  </div>
  <div className="flex flex-wrap gap-2">
    {allowedAppIds.map((id) => (
      <span key={id} className="inline-flex items-center gap-1.5 bg-white/10 border border-white/10 rounded-lg px-2.5 py-1 text-[12px] text-white/80">
        {id}
        <button onClick={() => removeAppId(id)} className="text-white/40 hover:text-rose-300"><X className="w-3 h-3" /></button>
      </span>
    ))}
    {allowedAppIds.length === 0 && <span className="text-[12px] text-white/40">등록된 앱이 없습니다.</span>}
  </div>
  <div className="text-[10px] text-white/30 italic">Data source — companies.cdp_allowed_app_ids</div>
</div>
```

- [ ] **Step 3: tsc + 자가 grep** — Run: `cd packages/frontend && npx tsc --noEmit`(0) + `npx grep -rn "Opus\|Sonnet\|GPT\|Claude\|alert(\|confirm(\|prompt(" src/pages/CdpSettingsPage.tsx || echo "0건"` → 모델명·native dialog 0건
- [ ] **Step 4: 커밋 (Harold)** — `feat(cdp): app registration UI`

---

## Task 5: 검증 + Codex 리뷰

- [ ] **Step 1: 백엔드** — `cd packages/backend && npx tsc --noEmit`(0) + `npx vitest run src/utils/__tests__/cdp-auth.test.ts`(PASS)
- [ ] **Step 2: 프론트** — `cd packages/frontend && npx tsc --noEmit`(0)
- [ ] **Step 3: 자가 grep (영구 룰)** — 모델명 / native dialog / 박-단어 0건 (변경 파일 한정)
- [ ] **Step 4: Codex** — `/codex:adversarial-review` (라이브 CDP 인증 변경 — 기존 웹/서버 경로 무손 + 새 분기 안전성 검토)
- [ ] **Step 5: 스모크(배포 후, Harold)** — 등록 번들ID로 `curl -H "X-Hanjullo-Key: hjl_..." -H "X-Hanjullo-App-Id: kr.poppon.app" "https://app.hanjul.ai/api/cdp/inapp/active?channel=app"` → 200 + `success:true`. 미등록 ID → 403 `APP_NOT_ALLOWED`. **기존 웹**(Origin 헤더만, app-id 없음)도 그대로 200인지 회귀 확인.
- [ ] **Step 6: 배포** — Harold 직접 (`pm2 restart targetup-backend` + frontend `build:safe`).

---

## Self-Review

**Spec coverage:** 스펙 6절(전달 구조 앱 인증)·7절(자사몰 연동 앱 등록)·9절(cdp_allowed_app_ids)·10절 1단계를 Task 1~5가 덮음.

**Placeholder scan:** TBD/TODO 없음. `requireCdpAppId`의 req 컨텍스트 줄만 "sibling 복사"로 명시(추측 방지 — 그 함수 실값을 그대로 쓰라는 구체 지시).

**Type consistency:** 응답 키 `appIds`(GET/POST/DELETE 일치) ↔ 프론트 `allowedAppIds`. 헤더 `X-Hanjullo-App-Id`(미들웨어·스모크·2단계 RN 일치). `isAllowedAppId`(Task2) ↔ `requireCdpAppId`(Task2) 동일.

**영구 룰:** 기존 웹/서버 인증 분기 무손(새 분기만) · native dialog 0(ConfirmModal/useToast) · 모델명 0 · 박-단어 0 · 새 컬럼 503 가드 · information_schema 선검증 · Codex 의무 · 커밋/배포 Harold.

---

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-06-18-cdp-app-registration-foundation.md`. 두 실행 방식:**

1. **Subagent-Driven (recommended)** — Task별 fresh subagent + 사이 리뷰.
2. **Inline Execution** — 현 세션에서 Task 순서대로 + 체크포인트.

라이브 인증을 건드리므로 어느 쪽이든 Task 5 Codex 리뷰 + 회귀 스모크는 필수. 어느 방식으로 진행할까요?
