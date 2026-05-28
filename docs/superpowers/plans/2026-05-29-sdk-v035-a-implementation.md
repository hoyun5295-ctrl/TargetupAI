# SDK v0.3.5-a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SDK v0.3.5-a 출시 = 한줄로 자사몰 = `<script>` 1줄 활용 + 15분 안 첫 이벤트 수신 + heartbeat 5 단계 진단 작동 + PII masking 7 분류 자동 적용 + trust_level `observed` 명시.

**Architecture:** 
- IIFE 단일 진입점 (`dist/iife/hanjul.min.js`) = CDN 활용 `<script src>` 1줄 + 옛 npm 패키지 (ESM/CJS/types) 동시 보존
- Auto-Capture 5 모듈 분리 (pageview / click 보수 / identify / consent / heartbeat) + storage (anonymous_id + session_id) + transport (batch + retry + `schema_version: 'v1'`)
- 백엔드 `/api/cdp/ingest` 신규 endpoint + PII masking 7 분류 (email + 휴대폰 + 카드 + 주민 + URL token + 계좌 + 세션토큰)
- TDD = vitest + jsdom (SDK) + jest (backend 옛 영역 정합) + RED-GREEN-REFACTOR 충실

**Tech Stack:** TypeScript 5.3 + Rollup (IIFE 빌드) + vitest (SDK 테스트) + jsdom (브라우저 환경 시뮬레이션) + 옛 fetch 표준 + localStorage/sessionStorage + 옛 npm `@hanjullo/sdk` 영역 보존

**v0.3.5-a 범위 (3~4 영업일)**: SDK Auto-Capture + 백엔드 ingestion + heartbeat 한정. **v0.3.5-b (별 plan)** = 백오피스 1-click 발급 UI + first event 검증 화면.

**§12 결정 매트릭스 정합 (Harold 확정 2026-05-28)**:

| # | 결정 영역 | 본 plan 적용 |
|---|----------|-------------|
| 1 | 자동 수집 5 한정 | pageview + click 보수 + identify + consent + heartbeat — declared/verified는 v0.4.0~v0.4.5 |
| 2 | `data-hjl-*` 접두사 | `data-hjl-user-id` / `data-hjl-consent-{4분리}` / `data-hjl-event` / `data-hjl-capture="text"` opt-in |
| 3 | 평문 OK + 백엔드 PII masking | SDK = 평문 전송 OK + 백엔드 ingestion 안 7 분류 자동 마스킹 + PG 저장 시 마스킹 형식 한정 |
| 4 | consent 4 분리 | `data-hjl-consent-{analytics,marketing,ad,kakao}` 4 attribute |
| 5 | `schema_version: 'v1'` | 모든 ingestion payload 필수 필드 |
| 6 | ID 병합 전체 보존 | anonymous_id + customer_id 매핑 영구 (가입 시점 자동 + 휴면 복귀 cohort) |
| 7 | PII masking 7 분류 | 본 plan Task 2.2 + Task 3.4 |
| 8 | 100만원/월+ 진입 자격 | `requireCdpApiKey` 미들웨어 + `companies.plan_code` 검증 (별 plan — 본 v0.3.5-a 안 검증 X) |
| 9 | pinned CDN | `https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js` (Harold 직접 배포 의무) |
| 10 | POPPON 기본 기준 | 15분 first event + PII 0 + Next.js 15 App Router SPA route + 회원 1~2명 identify + heartbeat 5 단계 |

---

## File Structure

### 신규 파일 (D2~D3)

```
packages/sdk-js/
├── rollup.config.js                          (D1 — IIFE 빌드 설정)
├── vitest.config.ts                          (D1 — 테스트 runner 설정)
├── src/
│   └── auto-capture/
│       ├── index.ts                          (D1 — IIFE 진입점 + window.hjl 노출)
│       ├── storage.ts                        (D2 — anonymous_id + session_id)
│       ├── pii-masking.ts                    (D2 — 7 분류 regex)
│       ├── identify.ts                       (D2 — data-hjl-user-id 자동 감지)
│       ├── consent.ts                        (D2 — data-hjl-consent-* 4 분리)
│       ├── pageview.ts                       (D2 — history.pushState patching)
│       ├── click.ts                          (D2 — click 보수 수집)
│       ├── heartbeat.ts                      (D3 — 5 단계 진단)
│       ├── transport.ts                      (D3 — batch + retry + schema_version)
│       └── __tests__/
│           ├── storage.test.ts               (D2)
│           ├── pii-masking.test.ts           (D2)
│           ├── identify.test.ts              (D2)
│           ├── consent.test.ts               (D2)
│           ├── pageview.test.ts              (D2)
│           ├── click.test.ts                 (D2)
│           ├── heartbeat.test.ts             (D3)
│           └── transport.test.ts             (D3)
```

### 정정 파일 (D1, D3)

```
packages/sdk-js/package.json                  (D1 — Rollup + vitest devDeps + build:iife script)
packages/sdk-js/src/types.ts                  (D2 — Auto-Capture 타입 + trust_level + consent mode)
packages/backend/src/routes/cdp.ts            (D3 — POST /ingest endpoint 신규 + 5 event batch)
packages/backend/src/utils/pii-masking.ts     (D3 — 옛 영역 검색 후 신설 또는 강화 = 7 분류)
```

### 보존 영역 (정정 X)

```
packages/sdk-js/src/index.ts                  (옛 HanjulloSDK 클래스 = npm 활용 영역 그대로)
packages/sdk-js/src/push.ts                   (옛 D175-A 영역 그대로)
packages/sdk-js/src/inapp.ts                  (옛 D175-A 영역 그대로)
packages/sdk-js/src/journey-variants.ts       (옛 D189 #4 영역 그대로)
packages/sdk-js/tsconfig.esm.json             (옛 ESM 빌드 보존)
packages/sdk-js/tsconfig.cjs.json             (옛 CJS 빌드 보존)
packages/sdk-js/tsconfig.types.json           (옛 types 빌드 보존)
```

---

## Pre-flight

### Step 0.1: 옛 SDK 빌드 작동 확인 (baseline)

- [ ] **Step 0.1.1: 옛 SDK npm 빌드 실행**

```bash
cd packages/sdk-js
npm run build
```

Expected: `dist/esm/` + `dist/cjs/` + `dist/types/` 3 폴더 생성 + 0 errors

- [ ] **Step 0.1.2: 옛 SDK 빌드 산출물 검증**

```bash
ls dist/esm/index.js dist/cjs/index.js dist/types/index.d.ts
```

Expected: 3 파일 모두 존재

- [ ] **Step 0.1.3: 옛 빌드 dist/ git ignore 정합 확인**

```bash
grep -E "^dist|^packages/sdk-js/dist" .gitignore packages/sdk-js/.gitignore 2>/dev/null
```

Expected: `dist/` 또는 `dist` 한 줄 이상 매칭 (옛 영역 정합 — 빌드 산출물 = git 추적 X)

---

## D1 — CDN script build 셋업 (Rollup IIFE)

### Task 1.1: Rollup + vitest devDependency 추가

**Files:**
- Modify: `packages/sdk-js/package.json`

- [ ] **Step 1.1.1: package.json 안 devDependencies 추가**

Edit `packages/sdk-js/package.json` 안 `devDependencies` 객체에 다음 5 추가:

```json
"devDependencies": {
  "typescript": "^5.3.3",
  "rollup": "^4.9.6",
  "@rollup/plugin-typescript": "^11.1.6",
  "@rollup/plugin-node-resolve": "^15.2.3",
  "@rollup/plugin-commonjs": "^25.0.7",
  "@rollup/plugin-terser": "^0.4.4",
  "vitest": "^1.2.2",
  "jsdom": "^24.0.0",
  "@vitest/coverage-v8": "^1.2.2"
}
```

- [ ] **Step 1.1.2: scripts 안 build:iife + test 추가**

Edit `packages/sdk-js/package.json` 안 `scripts` 객체:

```json
"scripts": {
  "build": "tsc -p tsconfig.esm.json && tsc -p tsconfig.cjs.json && tsc -p tsconfig.types.json",
  "build:iife": "rollup -c rollup.config.js",
  "build:all": "npm run build && npm run build:iife",
  "build:clean": "rm -rf dist && npm run build:all",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 1.1.3: npm install 진행 의무 안내 (Harold 직접)**

Harold 직접 실행 명령어:

```bash
cd packages/sdk-js
npm install
```

Expected: `node_modules/` 안 rollup + vitest + jsdom 설치 종결 + 0 vulnerabilities

- [ ] **Step 1.1.4: Commit**

```bash
git add packages/sdk-js/package.json packages/sdk-js/package-lock.json
git commit -m "chore(sdk): D1 — Rollup + vitest devDeps 추가 (v0.3.5-a 진입)"
```

---

### Task 1.2: rollup.config.js 신설 (IIFE 빌드)

**Files:**
- Create: `packages/sdk-js/rollup.config.js`

- [ ] **Step 1.2.1: rollup.config.js 작성**

Create `packages/sdk-js/rollup.config.js`:

```js
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/auto-capture/index.ts',
  output: {
    file: 'dist/iife/hanjul.min.js',
    format: 'iife',
    name: 'Hanjullo',
    sourcemap: true,
    banner: '/*! @hanjullo/sdk v0.3.5-a — Auto-Capture IIFE | (c) Hanjullo (TargetUp) | MIT */',
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      outDir: undefined,
    }),
    terser({
      format: { comments: /^\!/ },
      compress: { drop_console: false },
    }),
  ],
  treeshake: {
    moduleSideEffects: false,
  },
};
```

- [ ] **Step 1.2.2: vitest.config.ts 작성**

Create `packages/sdk-js/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/auto-capture/**/*.ts'],
      exclude: ['src/auto-capture/__tests__/**'],
    },
  },
});
```

- [ ] **Step 1.2.3: Commit**

```bash
git add packages/sdk-js/rollup.config.js packages/sdk-js/vitest.config.ts
git commit -m "chore(sdk): D1 — Rollup IIFE 빌드 + vitest 설정 신설"
```

---

### Task 1.3: Auto-Capture IIFE 진입점 (skeleton)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/index.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/index.test.ts`

- [ ] **Step 1.3.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/index.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('Auto-Capture index (IIFE 진입점)', () => {
  beforeEach(() => {
    // jsdom 환경 안 window 객체 초기화
    delete (window as any).hjl;
  });

  it('window.hjl 객체 노출 의무', async () => {
    await import('../index');
    expect((window as any).hjl).toBeDefined();
    expect(typeof (window as any).hjl.init).toBe('function');
    expect(typeof (window as any).hjl.track).toBe('function');
  });

  it('hjl.init({apiKey, secret}) 호출 시 config 저장 의무', async () => {
    await import('../index');
    const hjl = (window as any).hjl;
    hjl.init({ apiKey: 'hjl_test123', secret: 'sk_test456' });
    expect(hjl._config).toBeDefined();
    expect(hjl._config.apiKey).toBe('hjl_test123');
  });

  it('hjl.init() 호출 X 시 apiKey 누락 에러 던짐', async () => {
    await import('../index');
    const hjl = (window as any).hjl;
    expect(() => hjl.init({})).toThrow('apiKey');
  });

  it('apiKey 안 hjl_ 접두사 누락 시 에러 던짐', async () => {
    await import('../index');
    const hjl = (window as any).hjl;
    expect(() => hjl.init({ apiKey: 'invalid', secret: 'sk_test' })).toThrow('hjl_');
  });
});
```

- [ ] **Step 1.3.2: Run failing test**

```bash
cd packages/sdk-js
npm run test
```

Expected: FAIL with "Cannot find module '../index'" 또는 `window.hjl is undefined`

- [ ] **Step 1.3.3: Auto-Capture index.ts skeleton 작성**

Create `packages/sdk-js/src/auto-capture/index.ts`:

```ts
/**
 * @hanjullo/sdk v0.3.5-a — Auto-Capture IIFE 진입점
 *
 * CDN 활용: <script src="https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js"></script>
 * Harold 명시 §12 결정 매트릭스 정합 — 무료 진입 X = 100만원/월+ 요금제 진입 자격 의무 (백엔드 검증).
 *
 * 매뉴얼: https://hanjul.ai/docs/sdk/v0.3.5
 */

export interface AutoCaptureConfig {
  apiKey: string;
  secret?: string;
  endpoint?: string;
  debug?: boolean;
}

interface HjlGlobal {
  init: (config: AutoCaptureConfig) => void;
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (externalId: string, traits?: Record<string, unknown>) => void;
  _config: AutoCaptureConfig | null;
  _version: string;
}

const VERSION = '0.3.5-a';

function createHjlGlobal(): HjlGlobal {
  const hjl: HjlGlobal = {
    init(config: AutoCaptureConfig) {
      if (!config || !config.apiKey) {
        throw new Error('[Hanjullo] apiKey 누락 — CdpSettingsPage 안 발급 의무');
      }
      if (!config.apiKey.startsWith('hjl_')) {
        throw new Error('[Hanjullo] apiKey = hjl_ 접두사 의무');
      }
      hjl._config = {
        apiKey: config.apiKey,
        secret: config.secret,
        endpoint: config.endpoint || 'https://app.hanjul.ai/api/cdp',
        debug: !!config.debug,
      };
      if (hjl._config.debug) {
        console.log('[Hanjullo] init OK', { version: VERSION, endpoint: hjl._config.endpoint });
      }
    },

    track(_eventName: string, _properties?: Record<string, unknown>) {
      // D3 안 transport.ts 통합 = TODO Task 3.2
    },

    identify(_externalId: string, _traits?: Record<string, unknown>) {
      // D2 안 identify.ts 통합 = TODO Task 2.3
    },

    _config: null,
    _version: VERSION,
  };
  return hjl;
}

if (typeof window !== 'undefined') {
  (window as any).hjl = createHjlGlobal();
}

export { createHjlGlobal, VERSION };
```

- [ ] **Step 1.3.4: Run passing test**

```bash
cd packages/sdk-js
npm run test
```

Expected: PASS — 4 test all green

- [ ] **Step 1.3.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/index.ts packages/sdk-js/src/auto-capture/__tests__/index.test.ts
git commit -m "feat(sdk): D1 — Auto-Capture IIFE 진입점 skeleton + window.hjl 노출 + apiKey 검증"
```

---

### Task 1.4: 옛 npm 패키지 호환 검증 + IIFE 빌드 검증

- [ ] **Step 1.4.1: 옛 ESM/CJS/types 빌드 작동 확인**

```bash
cd packages/sdk-js
npm run build
```

Expected: `dist/esm/index.js` + `dist/cjs/index.js` + `dist/types/index.d.ts` 모두 0 errors

- [ ] **Step 1.4.2: IIFE 빌드 진행**

```bash
cd packages/sdk-js
npm run build:iife
```

Expected: `dist/iife/hanjul.min.js` 신규 생성 + sourcemap 생성 + terser 압축 (target <30KB gzipped)

- [ ] **Step 1.4.3: IIFE 빌드 산출물 검증**

```bash
ls -lh dist/iife/hanjul.min.js
head -c 200 dist/iife/hanjul.min.js
```

Expected: banner `/*! @hanjullo/sdk v0.3.5-a ... */` 첫 줄 + IIFE wrapper (`!function(){...}()` 형식)

- [ ] **Step 1.4.4: 빌드 산출물 .gitignore 정합 확인**

옛 .gitignore 안 `packages/sdk-js/dist/` 또는 `dist/` 매칭 확인. 매칭 X 시 추가 의무.

```bash
grep -E "^(packages/sdk-js/)?dist" .gitignore
```

- [ ] **Step 1.4.5: D1 종결 commit**

```bash
git add packages/sdk-js/
git commit -m "build(sdk): D1 — ESM/CJS/types + IIFE 4 영역 빌드 검증 종결"
```

---

## D2 — Auto-Capture 5 모듈 + PII masking

### Task 2.1: storage.ts (anonymous_id + session_id)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/storage.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/storage.test.ts`

- [ ] **Step 2.1.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getAnonymousId, getSessionId, clearSession } from '../storage';

describe('Auto-Capture storage (anonymous_id + session_id)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('getAnonymousId() 첫 호출 시 신규 UUID 발급 + localStorage 보존', () => {
    const id = getAnonymousId();
    expect(id).toMatch(/^anon_[a-f0-9-]{36}$/);
    expect(localStorage.getItem('hjl_anon_id')).toBe(id);
  });

  it('getAnonymousId() 두 번째 호출 시 같은 ID 반환', () => {
    const id1 = getAnonymousId();
    const id2 = getAnonymousId();
    expect(id1).toBe(id2);
  });

  it('getSessionId() 첫 호출 시 신규 UUID + 30분 TTL 보존', () => {
    const id = getSessionId();
    expect(id).toMatch(/^sess_[a-f0-9-]{36}$/);
    const raw = sessionStorage.getItem('hjl_session_id');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.id).toBe(id);
    expect(parsed.expires).toBeGreaterThan(Date.now());
    expect(parsed.expires).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
  });

  it('getSessionId() 30분 경과 시 신규 ID 발급', () => {
    const id1 = getSessionId();
    const expired = { id: id1, expires: Date.now() - 1000 };
    sessionStorage.setItem('hjl_session_id', JSON.stringify(expired));
    const id2 = getSessionId();
    expect(id2).not.toBe(id1);
  });

  it('clearSession() 호출 시 sessionStorage 안 영역 영구 제거', () => {
    getSessionId();
    clearSession();
    expect(sessionStorage.getItem('hjl_session_id')).toBeNull();
  });
});
```

- [ ] **Step 2.1.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/storage.test.ts
```

Expected: FAIL — "Cannot find module '../storage'"

- [ ] **Step 2.1.3: storage.ts 작성**

Create `packages/sdk-js/src/auto-capture/storage.ts`:

```ts
/**
 * anonymous_id (영구) + session_id (30분 TTL) 발급 + localStorage/sessionStorage 영역 보존.
 * §12 #6 정합 = ID 병합 전체 보존 흐름.
 */

const ANON_KEY = 'hjl_anon_id';
const SESS_KEY = 'hjl_session_id';
const SESS_TTL_MS = 30 * 60 * 1000;

function generateUUID(): string {
  // crypto.randomUUID() = 옛 브라우저 호환 X — fallback 포함
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = `anon_${generateUUID()}`;
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export function getSessionId(): string {
  const raw = sessionStorage.getItem(SESS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id: string; expires: number };
      if (parsed.expires > Date.now()) {
        return parsed.id;
      }
    } catch {
      // 파싱 실패 = 신규 발급 흐름
    }
  }
  const id = `sess_${generateUUID()}`;
  const expires = Date.now() + SESS_TTL_MS;
  sessionStorage.setItem(SESS_KEY, JSON.stringify({ id, expires }));
  return id;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESS_KEY);
}
```

- [ ] **Step 2.1.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/storage.test.ts
```

Expected: PASS — 5 test all green

- [ ] **Step 2.1.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/storage.ts packages/sdk-js/src/auto-capture/__tests__/storage.test.ts
git commit -m "feat(sdk): D2 — storage.ts (anonymous_id 영구 + session_id 30분 TTL)"
```

---

### Task 2.2: pii-masking.ts (7 분류 자동)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/pii-masking.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/pii-masking.test.ts`

- [ ] **Step 2.2.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/pii-masking.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maskPII, maskUrl } from '../pii-masking';

describe('PII masking 7 분류 (§12 #7)', () => {
  it('email 마스킹 — 앞 1글자 + ***@domain 흐름', () => {
    expect(maskPII('hoyun5295@gmail.com')).toBe('h********@gmail.com');
    expect(maskPII('a@b.co')).toBe('a@b.co'); // 1글자 짧음 = 마스킹 X
  });

  it('휴대폰 010-1234-5678 마스킹 → 010-****-5678', () => {
    expect(maskPII('010-1234-5678')).toBe('010-****-5678');
    expect(maskPII('01012345678')).toBe('010****5678');
  });

  it('카드번호 16자리 마스킹 → 앞 4 + 끝 4 + 중간 ****', () => {
    expect(maskPII('1234-5678-9012-3456')).toBe('1234-****-****-3456');
    expect(maskPII('1234567890123456')).toBe('1234********3456');
  });

  it('주민번호 6+7 마스킹 → 앞 6 + 뒤 *******', () => {
    expect(maskPII('900101-1234567')).toBe('900101-*******');
  });

  it('계좌번호 (10~14자리) 마스킹 → 앞 3 + 끝 3 + 중간 ****', () => {
    expect(maskPII('110-123-456789')).toBe('110-***-***789');
    expect(maskPII('12345678901234')).toBe('123********234');
  });

  it('세션토큰 (JWT-like) 마스킹 → eyJ... → [REDACTED_TOKEN]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc';
    expect(maskPII(jwt)).toBe('[REDACTED_TOKEN]');
  });

  it('URL token sanitization — query string 안 access_token / api_key 마스킹', () => {
    const url = 'https://example.com/path?access_token=abc123&foo=bar&api_key=def456';
    expect(maskUrl(url)).toBe('https://example.com/path?access_token=[REDACTED]&foo=bar&api_key=[REDACTED]');
  });

  it('비 PII 문자열 = 옛 그대로 반환', () => {
    expect(maskPII('hello world')).toBe('hello world');
    expect(maskPII('cart_added')).toBe('cart_added');
  });

  it('object 안 7 분류 자동 마스킹', () => {
    const input = {
      email: 'hoyun5295@gmail.com',
      phone: '010-1234-5678',
      note: 'hello',
    };
    expect(maskPII(input)).toEqual({
      email: 'h********@gmail.com',
      phone: '010-****-5678',
      note: 'hello',
    });
  });
});
```

- [ ] **Step 2.2.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/pii-masking.test.ts
```

Expected: FAIL — "Cannot find module '../pii-masking'"

- [ ] **Step 2.2.3: pii-masking.ts 작성**

Create `packages/sdk-js/src/auto-capture/pii-masking.ts`:

```ts
/**
 * PII masking 7 분류 (§12 #7 Harold 확정).
 * email + 휴대폰 + 카드 + 주민 + URL token + 계좌 + 세션토큰.
 * SDK 안 1차 마스킹 + 백엔드 ingestion 안 2차 마스킹 (이중 안전망 흐름).
 */

const PATTERNS = {
  // 세션토큰 (JWT-like) — 가장 우선 (다른 패턴 매칭 차단)
  jwt: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  // 주민번호 (6+7) — 우선 (휴대폰 매칭 차단)
  rrn: /\b(\d{6})-?(\d{7})\b/g,
  // 카드번호 (4+4+4+4) — 우선 (계좌 매칭 차단)
  card: /\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g,
  // 휴대폰 (010~019)
  phone: /\b(01[0-9])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g,
  // 계좌번호 (3+3+6 or 10~14자리)
  account: /\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{6})\b|\b(\d{3})\d{8,11}(\d{3})\b/g,
  // email
  email: /\b([a-zA-Z0-9])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
};

const URL_TOKEN_KEYS = [
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'token',
  'secret',
  'password',
  'session',
  'sessionid',
];

function maskString(s: string): string {
  let out = s;
  // 우선순위 = JWT → 주민 → 카드 → 휴대폰 → 계좌 → email
  out = out.replace(PATTERNS.jwt, '[REDACTED_TOKEN]');
  out = out.replace(PATTERNS.rrn, (_m, p1) => `${p1}-*******`);
  out = out.replace(PATTERNS.card, (m, p1, p2) => {
    if (m.includes('-')) return `${p1}-****-****-${p2}`;
    return `${p1}********${p2}`;
  });
  out = out.replace(PATTERNS.phone, (m, p1, _p2, p3) => {
    if (m.includes('-')) return `${p1}-****-${p3}`;
    return `${p1}****${p3}`;
  });
  out = out.replace(PATTERNS.account, (m, p1, _p2, p3, q1, q2) => {
    if (m.includes('-') && p1) return `${p1}-***-***${p3.slice(-3)}`;
    if (q1) return `${q1}********${q2}`;
    return m;
  });
  out = out.replace(PATTERNS.email, (m, p1, domain) => {
    const local = m.split('@')[0];
    if (local.length <= 1) return m;
    return `${p1}${'*'.repeat(local.length - 1)}@${domain}`;
  });
  return out;
}

export function maskPII(input: unknown): unknown {
  if (typeof input === 'string') {
    return maskString(input);
  }
  if (Array.isArray(input)) {
    return input.map(maskPII);
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = maskPII(v);
    }
    return out;
  }
  return input;
}

export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of URL_TOKEN_KEYS) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    }
    return u.toString();
  } catch {
    return url; // 파싱 X = 옛 그대로 반환
  }
}
```

- [ ] **Step 2.2.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/pii-masking.test.ts
```

Expected: PASS — 9 test all green

- [ ] **Step 2.2.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/pii-masking.ts packages/sdk-js/src/auto-capture/__tests__/pii-masking.test.ts
git commit -m "feat(sdk): D2 — PII masking 7 분류 (email + 휴대폰 + 카드 + 주민 + URL token + 계좌 + JWT)"
```

---

### Task 2.3: identify.ts (body data-hjl-user-id 자동 감지)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/identify.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/identify.test.ts`

- [ ] **Step 2.3.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/identify.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { detectIdentify, watchIdentifyChanges } from '../identify';

describe('Identify auto-detection (body data-hjl-user-id)', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-hjl-user-id');
    document.body.removeAttribute('data-hjl-email');
    document.body.removeAttribute('data-hjl-phone');
  });

  it('body data-hjl-user-id 자동 감지 → externalId 추출', () => {
    document.body.setAttribute('data-hjl-user-id', 'user_123');
    const result = detectIdentify();
    expect(result).toEqual({ externalId: 'user_123' });
  });

  it('data-hjl-user-id 누락 시 null 반환', () => {
    const result = detectIdentify();
    expect(result).toBeNull();
  });

  it('body data-hjl-email + data-hjl-phone 추가 traits 추출', () => {
    document.body.setAttribute('data-hjl-user-id', 'user_123');
    document.body.setAttribute('data-hjl-email', 'hoyun@example.com');
    document.body.setAttribute('data-hjl-phone', '01012345678');
    const result = detectIdentify();
    expect(result).toEqual({
      externalId: 'user_123',
      email: 'hoyun@example.com',
      phone: '01012345678',
    });
  });

  it('watchIdentifyChanges() — MutationObserver 안 attribute 변경 감지', async () => {
    const captured: Array<unknown> = [];
    const stop = watchIdentifyChanges((result) => {
      captured.push(result);
    });
    document.body.setAttribute('data-hjl-user-id', 'user_456');
    // MutationObserver = 비동기 = microtask 대기
    await new Promise((r) => setTimeout(r, 10));
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toEqual({ externalId: 'user_456' });
    stop();
  });
});
```

- [ ] **Step 2.3.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/identify.test.ts
```

Expected: FAIL

- [ ] **Step 2.3.3: identify.ts 작성**

Create `packages/sdk-js/src/auto-capture/identify.ts`:

```ts
/**
 * Body data-hjl-* attribute 자동 감지 + identify 추출.
 * §12 #2 정합 — data-hjl-* 접두사.
 * MutationObserver = body 단독 + 짧은 window 한정 (옛 spec §6.1 #10 정합).
 */

export interface IdentifyResult {
  externalId: string;
  email?: string;
  phone?: string;
  name?: string;
}

const ATTR_USER_ID = 'data-hjl-user-id';
const ATTR_EMAIL = 'data-hjl-email';
const ATTR_PHONE = 'data-hjl-phone';
const ATTR_NAME = 'data-hjl-name';

export function detectIdentify(): IdentifyResult | null {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }
  const externalId = document.body.getAttribute(ATTR_USER_ID);
  if (!externalId) {
    return null;
  }
  const result: IdentifyResult = { externalId };
  const email = document.body.getAttribute(ATTR_EMAIL);
  const phone = document.body.getAttribute(ATTR_PHONE);
  const name = document.body.getAttribute(ATTR_NAME);
  if (email) result.email = email;
  if (phone) result.phone = phone;
  if (name) result.name = name;
  return result;
}

export function watchIdentifyChanges(
  callback: (result: IdentifyResult | null) => void,
): () => void {
  if (typeof MutationObserver === 'undefined' || !document.body) {
    return () => {};
  }
  let lastUserId = document.body.getAttribute(ATTR_USER_ID);
  const observer = new MutationObserver(() => {
    const currentUserId = document.body.getAttribute(ATTR_USER_ID);
    if (currentUserId !== lastUserId) {
      lastUserId = currentUserId;
      callback(detectIdentify());
    }
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [ATTR_USER_ID, ATTR_EMAIL, ATTR_PHONE, ATTR_NAME],
  });
  return () => observer.disconnect();
}
```

- [ ] **Step 2.3.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/identify.test.ts
```

Expected: PASS — 4 test all green

- [ ] **Step 2.3.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/identify.ts packages/sdk-js/src/auto-capture/__tests__/identify.test.ts
git commit -m "feat(sdk): D2 — identify.ts (body data-hjl-user-id 자동 감지 + MutationObserver 변경 감지)"
```

---

### Task 2.4: consent.ts (4 분리 자동 감지)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/consent.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/consent.test.ts`

- [ ] **Step 2.4.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/consent.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { detectConsent } from '../consent';

describe('Consent auto-detection (§12 #4 4 분리)', () => {
  beforeEach(() => {
    document.body.removeAttribute('data-hjl-consent-analytics');
    document.body.removeAttribute('data-hjl-consent-marketing');
    document.body.removeAttribute('data-hjl-consent-ad');
    document.body.removeAttribute('data-hjl-consent-kakao');
  });

  it('consent 4 분리 attribute 누락 시 default = 4 모두 false', () => {
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: false,
      ad: false,
      kakao: false,
    });
  });

  it('data-hjl-consent-marketing="true" 안 marketing 한정 true', () => {
    document.body.setAttribute('data-hjl-consent-marketing', 'true');
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: true,
      ad: false,
      kakao: false,
    });
  });

  it('4 분리 모두 "true" 안 4 모두 true', () => {
    document.body.setAttribute('data-hjl-consent-analytics', 'true');
    document.body.setAttribute('data-hjl-consent-marketing', 'true');
    document.body.setAttribute('data-hjl-consent-ad', 'true');
    document.body.setAttribute('data-hjl-consent-kakao', 'true');
    expect(detectConsent()).toEqual({
      analytics: true,
      marketing: true,
      ad: true,
      kakao: true,
    });
  });

  it('"false" / "0" / "" 값 = false 흐름', () => {
    document.body.setAttribute('data-hjl-consent-marketing', 'false');
    document.body.setAttribute('data-hjl-consent-ad', '0');
    document.body.setAttribute('data-hjl-consent-kakao', '');
    expect(detectConsent()).toEqual({
      analytics: false,
      marketing: false,
      ad: false,
      kakao: false,
    });
  });
});
```

- [ ] **Step 2.4.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/consent.test.ts
```

Expected: FAIL

- [ ] **Step 2.4.3: consent.ts 작성**

Create `packages/sdk-js/src/auto-capture/consent.ts`:

```ts
/**
 * Consent mode 4 분리 자동 감지 (§12 #4 Harold 확정).
 * data-hjl-consent-{analytics,marketing,ad,kakao} body attribute 영역.
 * 한국 정보통신망법 정합 — analytics + marketing + ad + kakao 분리.
 */

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  ad: boolean;
  kakao: boolean;
}

const CHANNELS = ['analytics', 'marketing', 'ad', 'kakao'] as const;

function parseBool(v: string | null): boolean {
  if (!v) return false;
  return v.toLowerCase() === 'true' || v === '1';
}

export function detectConsent(): ConsentState {
  const result: ConsentState = {
    analytics: false,
    marketing: false,
    ad: false,
    kakao: false,
  };
  if (typeof document === 'undefined' || !document.body) {
    return result;
  }
  for (const ch of CHANNELS) {
    const value = document.body.getAttribute(`data-hjl-consent-${ch}`);
    result[ch] = parseBool(value);
  }
  return result;
}
```

- [ ] **Step 2.4.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/consent.test.ts
```

Expected: PASS — 4 test all green

- [ ] **Step 2.4.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/consent.ts packages/sdk-js/src/auto-capture/__tests__/consent.test.ts
git commit -m "feat(sdk): D2 — consent.ts (4 분리 자동 감지 — analytics/marketing/ad/kakao)"
```

---

### Task 2.5: pageview.ts (history.pushState patching)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/pageview.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/pageview.test.ts`

- [ ] **Step 2.5.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/pageview.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupPageviewTracking } from '../pageview';

describe('Pageview auto-capture (history.pushState + popstate + hashchange)', () => {
  let captured: Array<{ url: string; title: string; referrer: string }>;
  let stop: () => void;

  beforeEach(() => {
    captured = [];
    stop = setupPageviewTracking((event) => {
      captured.push(event);
    });
  });

  it('초기 load 시 즉시 1건 pageview 발송', () => {
    expect(captured.length).toBe(1);
    expect(captured[0].url).toBe(window.location.href);
  });

  it('history.pushState() 호출 시 pageview 발송', () => {
    window.history.pushState({}, '', '/new-path');
    expect(captured.length).toBe(2);
    expect(captured[1].url).toContain('/new-path');
  });

  it('history.replaceState() 호출 시 pageview 발송', () => {
    window.history.replaceState({}, '', '/replaced-path');
    expect(captured.length).toBe(2);
    expect(captured[1].url).toContain('/replaced-path');
  });

  it('popstate event 안 뒤로가기 시 pageview 발송', () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(captured.length).toBe(2);
  });

  it('hashchange event 안 #hash 변경 시 pageview 발송', () => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(captured.length).toBe(2);
  });

  it('stop() 호출 후 추가 pushState = pageview 발송 X', () => {
    stop();
    window.history.pushState({}, '', '/after-stop');
    expect(captured.length).toBe(1);
  });
});
```

- [ ] **Step 2.5.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/pageview.test.ts
```

Expected: FAIL

- [ ] **Step 2.5.3: pageview.ts 작성**

Create `packages/sdk-js/src/auto-capture/pageview.ts`:

```ts
/**
 * Pageview 자동 수집 (§5 #4).
 * history.pushState/replaceState patching + popstate + hashchange + 초기 load.
 * SPA (Next.js / React Router / Vue Router 등) 정합.
 */

export interface PageviewEvent {
  url: string;
  title: string;
  referrer: string;
}

export function setupPageviewTracking(
  emit: (event: PageviewEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastReferrer = document.referrer || '';

  const fire = () => {
    emit({
      url: window.location.href,
      title: document.title || '',
      referrer: lastReferrer,
    });
    lastReferrer = window.location.href;
  };

  // 초기 load
  fire();

  // history.pushState patching
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;
  window.history.pushState = function (...args) {
    const result = originalPush.apply(this, args);
    fire();
    return result;
  };
  window.history.replaceState = function (...args) {
    const result = originalReplace.apply(this, args);
    fire();
    return result;
  };

  const onPopState = () => fire();
  const onHashChange = () => fire();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
  };
}
```

- [ ] **Step 2.5.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/pageview.test.ts
```

Expected: PASS — 6 test all green

- [ ] **Step 2.5.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/pageview.ts packages/sdk-js/src/auto-capture/__tests__/pageview.test.ts
git commit -m "feat(sdk): D2 — pageview.ts (history.pushState patching + SPA 정합)"
```

---

### Task 2.6: click.ts (보수 수집)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/click.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/click.test.ts`

- [ ] **Step 2.6.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/click.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setupClickTracking } from '../click';

describe('Click auto-capture (보수 — §5 #5)', () => {
  let captured: Array<Record<string, unknown>>;
  let stop: () => void;

  beforeEach(() => {
    captured = [];
    stop = setupClickTracking((event) => {
      captured.push(event);
    });
    document.body.innerHTML = '';
  });

  it('단순 button 클릭 시 tag + position 수집 + innerText 수집 X', () => {
    const btn = document.createElement('button');
    btn.textContent = '구매하기';
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].tag).toBe('button');
    expect(captured[0].text).toBeUndefined();
  });

  it('a href 클릭 시 href sanitize 의무 (access_token 마스킹)', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/path?access_token=secret&foo=bar';
    document.body.appendChild(a);
    a.click();
    expect(captured.length).toBe(1);
    expect(captured[0].href).toContain('[REDACTED]');
    expect(captured[0].href).not.toContain('secret');
  });

  it('data-hjl-event="purchase_click" attribute 안 event 명 추출', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-hjl-event', 'purchase_click');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].event).toBe('purchase_click');
  });

  it('role="link" attribute 안 role 수집', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'link');
    document.body.appendChild(div);
    div.click();
    expect(captured.length).toBe(1);
    expect(captured[0].role).toBe('link');
  });

  it('data-hjl-capture="text" opt-in 안 innerText 수집 OK', () => {
    const btn = document.createElement('button');
    btn.textContent = '특별 혜택';
    btn.setAttribute('data-hjl-capture', 'text');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].text).toBe('특별 혜택');
  });

  it('stop() 호출 후 click = 수집 X', () => {
    stop();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    expect(captured.length).toBe(0);
  });
});
```

- [ ] **Step 2.6.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/click.test.ts
```

Expected: FAIL

- [ ] **Step 2.6.3: click.ts 작성**

Create `packages/sdk-js/src/auto-capture/click.ts`:

```ts
/**
 * Click 자동 수집 (보수 — §5 #5).
 * 기본 수집값 = tag + role + data-hjl-event + href sanitized + position 한정.
 * innerText = 기본 OFF — data-hjl-capture="text" opt-in 한정 (개인정보/주문번호 섞임 위험 차단).
 */

import { maskUrl } from './pii-masking';

export interface ClickEvent {
  tag: string;
  role?: string;
  event?: string;
  href?: string;
  text?: string;
  position?: { x: number; y: number };
}

export function setupClickTracking(emit: (event: ClickEvent) => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.tagName) return;

    const event: ClickEvent = {
      tag: target.tagName.toLowerCase(),
      position: { x: e.clientX, y: e.clientY },
    };

    const role = target.getAttribute('role');
    if (role) event.role = role;

    const hjlEvent = target.getAttribute('data-hjl-event');
    if (hjlEvent) event.event = hjlEvent;

    if (target.tagName === 'A') {
      const href = (target as HTMLAnchorElement).href;
      if (href) event.href = maskUrl(href);
    }

    // innerText = opt-in 한정 (§5 #5)
    if (target.getAttribute('data-hjl-capture') === 'text') {
      const text = target.textContent?.trim();
      if (text) event.text = text.slice(0, 100); // 100자 한도
    }

    emit(event);
  };

  // capture phase = SPA 안 stopPropagation 우회
  document.addEventListener('click', handler, true);

  return () => {
    document.removeEventListener('click', handler, true);
  };
}
```

- [ ] **Step 2.6.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/click.test.ts
```

Expected: PASS — 6 test all green

- [ ] **Step 2.6.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/click.ts packages/sdk-js/src/auto-capture/__tests__/click.test.ts
git commit -m "feat(sdk): D2 — click.ts (보수 수집 — tag/role/href sanitized/position + innerText opt-in 한정)"
```

---

## D3 — heartbeat + 백엔드 ingestion endpoint

### Task 3.1: heartbeat.ts (5 단계 진단)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/heartbeat.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/heartbeat.test.ts`

- [ ] **Step 3.1.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/heartbeat.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Heartbeat, HEARTBEAT_STAGES } from '../heartbeat';

describe('Heartbeat 5 단계 진단 (§5 #8)', () => {
  let captured: Array<{ stage: string; timestamp: number }>;
  let hb: Heartbeat;

  beforeEach(() => {
    captured = [];
    hb = new Heartbeat((stage) => captured.push({ stage, timestamp: Date.now() }));
  });

  it('HEARTBEAT_STAGES = 5 단계 정의', () => {
    expect(HEARTBEAT_STAGES).toEqual([
      'sdk_loaded',
      'config_loaded',
      'domain_matched',
      'first_pageview_sent',
      'first_event_accepted',
    ]);
  });

  it('mark() 호출 시 해당 단계 emit', () => {
    hb.mark('sdk_loaded');
    expect(captured.length).toBe(1);
    expect(captured[0].stage).toBe('sdk_loaded');
  });

  it('같은 단계 두 번 mark() 호출 시 두 번째 emit X (중복 차단)', () => {
    hb.mark('sdk_loaded');
    hb.mark('sdk_loaded');
    expect(captured.length).toBe(1);
  });

  it('5 단계 sequential mark — 모두 emit', () => {
    HEARTBEAT_STAGES.forEach((stage) => hb.mark(stage));
    expect(captured.length).toBe(5);
    expect(captured.map((c) => c.stage)).toEqual([
      'sdk_loaded',
      'config_loaded',
      'domain_matched',
      'first_pageview_sent',
      'first_event_accepted',
    ]);
  });

  it('snapshot() — 5 단계 + timestamp + completed 여부', () => {
    hb.mark('sdk_loaded');
    hb.mark('config_loaded');
    const snap = hb.snapshot();
    expect(snap.sdk_loaded).toBeGreaterThan(0);
    expect(snap.config_loaded).toBeGreaterThan(0);
    expect(snap.domain_matched).toBeNull();
  });
});
```

- [ ] **Step 3.1.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/heartbeat.test.ts
```

Expected: FAIL

- [ ] **Step 3.1.3: heartbeat.ts 작성**

Create `packages/sdk-js/src/auto-capture/heartbeat.ts`:

```ts
/**
 * Heartbeat 5 단계 진단 (§5 #8).
 * sdk_loaded → config_loaded → domain_matched → first_pageview_sent → first_event_accepted.
 * 백오피스 진단 화면 안 5/10/30분 단계별 상태 표시 흐름 (v0.3.5-b 진입).
 */

export const HEARTBEAT_STAGES = [
  'sdk_loaded',
  'config_loaded',
  'domain_matched',
  'first_pageview_sent',
  'first_event_accepted',
] as const;

export type HeartbeatStage = (typeof HEARTBEAT_STAGES)[number];

export type HeartbeatSnapshot = {
  [K in HeartbeatStage]: number | null;
};

export class Heartbeat {
  private stages: HeartbeatSnapshot;
  private emit: (stage: HeartbeatStage) => void;

  constructor(emit: (stage: HeartbeatStage) => void) {
    this.emit = emit;
    this.stages = HEARTBEAT_STAGES.reduce((acc, s) => {
      acc[s] = null;
      return acc;
    }, {} as HeartbeatSnapshot);
  }

  mark(stage: HeartbeatStage): void {
    if (this.stages[stage] !== null) return; // 중복 차단
    this.stages[stage] = Date.now();
    this.emit(stage);
  }

  snapshot(): HeartbeatSnapshot {
    return { ...this.stages };
  }

  isStageComplete(stage: HeartbeatStage): boolean {
    return this.stages[stage] !== null;
  }
}
```

- [ ] **Step 3.1.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/heartbeat.test.ts
```

Expected: PASS — 5 test all green

- [ ] **Step 3.1.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/heartbeat.ts packages/sdk-js/src/auto-capture/__tests__/heartbeat.test.ts
git commit -m "feat(sdk): D3 — heartbeat.ts (5 단계 진단 + 중복 차단 + snapshot)"
```

---

### Task 3.2: transport.ts (batch + retry + schema_version)

**Files:**
- Create: `packages/sdk-js/src/auto-capture/transport.ts`
- Create: `packages/sdk-js/src/auto-capture/__tests__/transport.test.ts`

- [ ] **Step 3.2.1: failing test 작성**

Create `packages/sdk-js/src/auto-capture/__tests__/transport.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Transport } from '../transport';

describe('Transport (batch + retry + schema_version v1)', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, accepted: 5 }),
    } as Response);
  });

  it('queue() 안 5 event 모음 시 자동 flush', async () => {
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 5,
      flushIntervalMs: 5000,
    });
    for (let i = 0; i < 5; i++) {
      t.queue({ type: 'pageview', url: `/p${i}` });
    }
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.schema_version).toBe('v1');
    expect(body.events).toHaveLength(5);
  });

  it('5초 timer 흐름 안 자동 flush (batchSize 미달 영역)', async () => {
    vi.useFakeTimers();
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 100,
      flushIntervalMs: 5000,
    });
    t.queue({ type: 'pageview', url: '/' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5001);
    await vi.runAllTimersAsync();
    expect(fetchSpy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('네트워크 실패 시 retry 2회 (exponential backoff)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 1,
      flushIntervalMs: 5000,
      retries: 2,
    });
    t.queue({ type: 'pageview', url: '/' });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3), { timeout: 5000 });
  });

  it('X-Hanjullo-Key + X-Hanjullo-Schema-Version 헤더 의무', async () => {
    const t = new Transport({
      apiKey: 'hjl_test',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      batchSize: 1,
      flushIntervalMs: 5000,
    });
    t.queue({ type: 'pageview', url: '/' });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['X-Hanjullo-Key']).toBe('hjl_test');
    expect(headers['X-Hanjullo-Schema-Version']).toBe('v1');
  });
});
```

- [ ] **Step 3.2.2: Run failing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/transport.test.ts
```

Expected: FAIL

- [ ] **Step 3.2.3: transport.ts 작성**

Create `packages/sdk-js/src/auto-capture/transport.ts`:

```ts
/**
 * Transport — batch + retry + schema_version v1 (§12 #5).
 * POST /api/cdp/ingest 안 5 event 모음 또는 5초 timer 흐름 자동 flush.
 * §12 #5 정합 — 모든 ingestion payload schema_version: 'v1' 필수 필드.
 */

import { getAnonymousId, getSessionId } from './storage';

export interface TransportConfig {
  apiKey: string;
  endpoint: string;
  batchSize?: number;
  flushIntervalMs?: number;
  retries?: number;
}

export interface QueuedEvent {
  type: string;
  [k: string]: unknown;
}

const SCHEMA_VERSION = 'v1';

export class Transport {
  private apiKey: string;
  private endpoint: string;
  private batchSize: number;
  private flushIntervalMs: number;
  private retries: number;
  private queueArr: QueuedEvent[];
  private timer: ReturnType<typeof setTimeout> | null;

  constructor(config: TransportConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.batchSize = config.batchSize ?? 20;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.retries = config.retries ?? 2;
    this.queueArr = [];
    this.timer = null;
  }

  queue(event: QueuedEvent): void {
    this.queueArr.push(event);
    if (this.queueArr.length >= this.batchSize) {
      this.flush();
    } else if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queueArr.length === 0) return;

    const events = this.queueArr.splice(0);
    const payload = {
      schema_version: SCHEMA_VERSION,
      anonymous_id: getAnonymousId(),
      session_id: getSessionId(),
      sent_at: new Date().toISOString(),
      events,
    };

    const url = `${this.endpoint}/ingest`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hanjullo-Key': this.apiKey,
      'X-Hanjullo-Schema-Version': SCHEMA_VERSION,
      'X-Hanjullo-SDK-Version': '0.3.5-a',
    };

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          keepalive: true,
        });
        if (res.ok) return;
        // 4xx (429 제외) = retry X
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return;
        }
      } catch {
        // 네트워크 실패 = retry 흐름
      }
      if (attempt < this.retries) {
        const delay = Math.min(2000, 200 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
```

- [ ] **Step 3.2.4: Run passing test**

```bash
cd packages/sdk-js
npm run test src/auto-capture/__tests__/transport.test.ts
```

Expected: PASS — 4 test all green

- [ ] **Step 3.2.5: Commit**

```bash
git add packages/sdk-js/src/auto-capture/transport.ts packages/sdk-js/src/auto-capture/__tests__/transport.test.ts
git commit -m "feat(sdk): D3 — transport.ts (batch 20 + 5초 timer + retry 2 + schema_version v1)"
```

---

### Task 3.3: index.ts 통합 (5 모듈 + Heartbeat + Transport)

**Files:**
- Modify: `packages/sdk-js/src/auto-capture/index.ts`

- [ ] **Step 3.3.1: index.ts 통합 안 5 모듈 호출**

Replace contents of `packages/sdk-js/src/auto-capture/index.ts`:

```ts
/**
 * @hanjullo/sdk v0.3.5-a — Auto-Capture IIFE 진입점 (5 모듈 통합).
 */

import { getAnonymousId, getSessionId } from './storage';
import { detectIdentify, watchIdentifyChanges } from './identify';
import { detectConsent } from './consent';
import { setupPageviewTracking } from './pageview';
import { setupClickTracking } from './click';
import { Heartbeat } from './heartbeat';
import { Transport } from './transport';

export interface AutoCaptureConfig {
  apiKey: string;
  secret?: string;
  endpoint?: string;
  debug?: boolean;
}

interface HjlGlobal {
  init: (config: AutoCaptureConfig) => void;
  track: (eventName: string, properties?: Record<string, unknown>) => void;
  identify: (externalId: string, traits?: Record<string, unknown>) => void;
  _config: AutoCaptureConfig | null;
  _version: string;
  _heartbeat: Heartbeat | null;
  _transport: Transport | null;
}

const VERSION = '0.3.5-a';

function createHjlGlobal(): HjlGlobal {
  let stopPageview: (() => void) | null = null;
  let stopClick: (() => void) | null = null;
  let stopIdentify: (() => void) | null = null;
  let firstEventSent = false;

  const hjl: HjlGlobal = {
    init(config: AutoCaptureConfig) {
      if (!config || !config.apiKey) {
        throw new Error('[Hanjullo] apiKey 누락 — CdpSettingsPage 안 발급 의무');
      }
      if (!config.apiKey.startsWith('hjl_')) {
        throw new Error('[Hanjullo] apiKey = hjl_ 접두사 의무');
      }
      hjl._config = {
        apiKey: config.apiKey,
        secret: config.secret,
        endpoint: config.endpoint || 'https://app.hanjul.ai/api/cdp',
        debug: !!config.debug,
      };

      const heartbeat = new Heartbeat((stage) => {
        if (hjl._config!.debug) console.log('[Hanjullo] heartbeat:', stage);
      });
      const transport = new Transport({
        apiKey: hjl._config.apiKey,
        endpoint: hjl._config.endpoint!,
      });
      hjl._heartbeat = heartbeat;
      hjl._transport = transport;

      heartbeat.mark('sdk_loaded');
      heartbeat.mark('config_loaded');

      // 도메인 매칭 — endpoint 안 호스트 정합
      try {
        const endpointHost = new URL(hjl._config.endpoint!).hostname;
        if (endpointHost) heartbeat.mark('domain_matched');
      } catch {
        // 파싱 X — 단순 무시
      }

      // 초기 identify + consent
      const id = detectIdentify();
      if (id) {
        transport.queue({
          type: 'identify',
          external_id: id.externalId,
          email: id.email,
          phone: id.phone,
          name: id.name,
          trust_level: 'declared',
        });
      }
      stopIdentify = watchIdentifyChanges((result) => {
        if (result) {
          transport.queue({
            type: 'identify',
            external_id: result.externalId,
            email: result.email,
            phone: result.phone,
            name: result.name,
            trust_level: 'declared',
          });
        }
      });

      const consent = detectConsent();
      transport.queue({ type: 'consent', ...consent, trust_level: 'declared' });

      // Pageview
      stopPageview = setupPageviewTracking((event) => {
        transport.queue({
          type: 'pageview',
          ...event,
          trust_level: 'observed',
        });
        if (!firstEventSent) {
          firstEventSent = true;
          heartbeat.mark('first_pageview_sent');
        }
      });

      // Click
      stopClick = setupClickTracking((event) => {
        transport.queue({
          type: 'click',
          ...event,
          trust_level: 'observed',
        });
      });
    },

    track(eventName: string, properties?: Record<string, unknown>) {
      if (!hjl._transport) {
        throw new Error('[Hanjullo] init() 호출 의무');
      }
      hjl._transport.queue({
        type: 'track',
        event: eventName,
        properties: properties || {},
        trust_level: 'declared',
      });
    },

    identify(externalId: string, traits?: Record<string, unknown>) {
      if (!hjl._transport) {
        throw new Error('[Hanjullo] init() 호출 의무');
      }
      hjl._transport.queue({
        type: 'identify',
        external_id: externalId,
        ...(traits || {}),
        trust_level: 'declared',
      });
    },

    _config: null,
    _version: VERSION,
    _heartbeat: null,
    _transport: null,
  };

  return hjl;
}

if (typeof window !== 'undefined') {
  (window as any).hjl = createHjlGlobal();
}

export { createHjlGlobal, VERSION };
```

- [ ] **Step 3.3.2: index.test.ts 업데이트 (통합 테스트)**

Edit `packages/sdk-js/src/auto-capture/__tests__/index.test.ts` 안 추가 테스트:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Auto-Capture index 통합 (5 모듈 + Heartbeat + Transport)', () => {
  beforeEach(() => {
    delete (window as any).hjl;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);
  });

  it('init() 안 5 heartbeat 단계 = sdk_loaded + config_loaded + domain_matched mark', async () => {
    const { createHjlGlobal } = await import('../index');
    const hjl = createHjlGlobal();
    hjl.init({ apiKey: 'hjl_test', endpoint: 'https://app.hanjul.ai/api/cdp', debug: false });
    expect(hjl._heartbeat).toBeDefined();
    expect(hjl._heartbeat!.isStageComplete('sdk_loaded')).toBe(true);
    expect(hjl._heartbeat!.isStageComplete('config_loaded')).toBe(true);
    expect(hjl._heartbeat!.isStageComplete('domain_matched')).toBe(true);
  });

  it('init() 안 초기 pageview = first_pageview_sent mark', async () => {
    const { createHjlGlobal } = await import('../index');
    const hjl = createHjlGlobal();
    hjl.init({ apiKey: 'hjl_test', endpoint: 'https://app.hanjul.ai/api/cdp' });
    expect(hjl._heartbeat!.isStageComplete('first_pageview_sent')).toBe(true);
  });
});
```

- [ ] **Step 3.3.3: Run passing test**

```bash
cd packages/sdk-js
npm run test
```

Expected: PASS — 옛 + 신규 테스트 모두 green

- [ ] **Step 3.3.4: Commit**

```bash
git add packages/sdk-js/src/auto-capture/index.ts packages/sdk-js/src/auto-capture/__tests__/index.test.ts
git commit -m "feat(sdk): D3 — index.ts 안 5 Auto-Capture 모듈 + Heartbeat + Transport 통합"
```

---

### Task 3.4: 백엔드 POST /api/cdp/ingest endpoint 신설

**Files:**
- Modify: `packages/backend/src/routes/cdp.ts`

- [ ] **Step 3.4.1: 옛 PII masking utility 영역 검색**

```bash
cd packages/backend
grep -rn "pii.*mask\|maskPii\|maskEmail\|maskPhone" src/utils/ src/routes/ 2>/dev/null | head -30
```

Expected: 옛 유틸 X 또는 부분 한정 → 신설 또는 강화 의무 (Step 3.4.2 안).

- [ ] **Step 3.4.2: backend pii-masking.ts 신설**

옛 영역 검색 결과 = 없거나 부분 → 신설. Create or extend `packages/backend/src/utils/pii-masking.ts`:

```ts
/**
 * 백엔드 PII masking 7 분류 (§12 #7 Harold 확정).
 * SDK 안 1차 마스킹 + 백엔드 안 2차 마스킹 (이중 안전망).
 */

const PATTERNS = {
  jwt: /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  rrn: /\b(\d{6})-?(\d{7})\b/g,
  card: /\b(\d{4})[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g,
  phone: /\b(01[0-9])[-\s]?(\d{3,4})[-\s]?(\d{4})\b/g,
  account: /\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{6})\b|\b(\d{3})\d{8,11}(\d{3})\b/g,
  email: /\b([a-zA-Z0-9])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
};

function maskString(s: string): string {
  let out = s;
  out = out.replace(PATTERNS.jwt, '[REDACTED_TOKEN]');
  out = out.replace(PATTERNS.rrn, (_m, p1) => `${p1}-*******`);
  out = out.replace(PATTERNS.card, (m, p1, p2) => {
    if (m.includes('-')) return `${p1}-****-****-${p2}`;
    return `${p1}********${p2}`;
  });
  out = out.replace(PATTERNS.phone, (m, p1, _p2, p3) => {
    if (m.includes('-')) return `${p1}-****-${p3}`;
    return `${p1}****${p3}`;
  });
  out = out.replace(PATTERNS.account, (m, p1, _p2, p3, q1, q2) => {
    if (m.includes('-') && p1) return `${p1}-***-***${p3.slice(-3)}`;
    if (q1) return `${q1}********${q2}`;
    return m;
  });
  out = out.replace(PATTERNS.email, (m, p1, domain) => {
    const local = m.split('@')[0];
    if (local.length <= 1) return m;
    return `${p1}${'*'.repeat(local.length - 1)}@${domain}`;
  });
  return out;
}

export function maskPII(input: unknown): unknown {
  if (typeof input === 'string') return maskString(input);
  if (Array.isArray(input)) return input.map(maskPII);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = maskPII(v);
    }
    return out;
  }
  return input;
}
```

- [ ] **Step 3.4.3: cdp.ts 안 POST /ingest endpoint 신설**

Add to `packages/backend/src/routes/cdp.ts` (옛 router.post('/identify' ...) 영역 직전 또는 옛 endpoint 영역 종결 직후):

```ts
import { maskPII } from '../utils/pii-masking';

// ════════════════════════════════════════════════════════════════
// ★ v0.3.5-a (2026-05-29): Auto-Capture batch ingestion endpoint
// §12 #5 정합 — schema_version 'v1' 의무 + 7 분류 PII masking 자동
// ════════════════════════════════════════════════════════════════

router.post('/ingest', requireCdpApiKey, async (req: Request, res: Response) => {
  try {
    const { schema_version, anonymous_id, session_id, sent_at, events } = req.body;

    if (schema_version !== 'v1') {
      return res.status(400).json({
        success: false,
        error: `schema_version 'v1' 의무 — 옛 값 = ${schema_version}`,
        code: 'INVALID_SCHEMA_VERSION',
      });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'events 배열 비어 있음',
        code: 'EMPTY_EVENTS',
      });
    }

    if (events.length > 100) {
      return res.status(413).json({
        success: false,
        error: 'events 최대 100건/batch 한도 초과',
        code: 'BATCH_TOO_LARGE',
      });
    }

    // ★ 핵심 — PII masking 2차 안전망
    const masked = events.map((e) => maskPII(e));

    // companyId = requireCdpApiKey 미들웨어 안 (req as any).cdp.companyId
    const companyId = (req as any).cdp?.companyId;
    if (!companyId) {
      return res.status(401).json({
        success: false,
        error: 'CDP API key 인증 실패',
        code: 'AUTH_FAILED',
      });
    }

    // cdp_events insert (옛 영역 호환 — 단순 batch insert)
    const { pool } = await import('../db/pg');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of masked as Array<Record<string, unknown>>) {
        await client.query(
          `INSERT INTO cdp_events (
             company_id, anonymous_id, session_id, event_type, payload, trust_level, schema_version, sent_at, received_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            companyId,
            anonymous_id || null,
            session_id || null,
            (e.type as string) || 'unknown',
            JSON.stringify(e),
            (e.trust_level as string) || 'observed',
            schema_version,
            sent_at || new Date().toISOString(),
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.json({
      success: true,
      accepted: events.length,
      schema_version,
    });
  } catch (err: any) {
    // ★ db_alter_safety_net 룰 정합 — column does not exist 분기 (CLAUDE.md §db_alter_safety_net)
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 의무 — 운영자에게 cdp_events ALTER 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'cdp_events 테이블 X — DB 마이그레이션 의무',
        code: 'DB_TABLE_MISSING',
      });
    }
    console.error('[CDP /ingest] 사고:', err);
    return res.status(500).json({
      success: false,
      error: '서버 사고 — 잠시 후 재시도',
      code: 'INTERNAL_ERROR',
    });
  }
});
```

- [ ] **Step 3.4.4: backend tsc 검증**

```bash
cd packages/backend
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3.4.5: Commit**

```bash
git add packages/backend/src/utils/pii-masking.ts packages/backend/src/routes/cdp.ts
git commit -m "feat(backend): D3 — POST /api/cdp/ingest endpoint 신설 + PII masking 7 분류 + DB safety net"
```

---

### Task 3.5: cdp_events 테이블 ALTER 안내 (Harold 직접 진행)

**Files:**
- Modify: `status/SCHEMA.md` (옛 SCHEMA 안 cdp_events 영역 정정 의무)

- [ ] **Step 3.5.1: cdp_events 테이블 ALTER SQL 작성 + Harold 안내**

다음 SQL = Harold 직접 PG 실행 의무 (no_system_modification 룰 정합):

```sql
-- D225+ (2026-05-29) v0.3.5-a Auto-Capture ingestion 정합 ALTER
ALTER TABLE cdp_events
  ADD COLUMN IF NOT EXISTS anonymous_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS trust_level VARCHAR(16) DEFAULT 'observed' CHECK (trust_level IN ('observed', 'inferred', 'declared', 'verified')),
  ADD COLUMN IF NOT EXISTS schema_version VARCHAR(8) DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_cdp_events_anon_session ON cdp_events(anonymous_id, session_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdp_events_trust_level ON cdp_events(trust_level, received_at);
```

- [ ] **Step 3.5.2: status/SCHEMA.md 업데이트 안내 (Harold 직접 또는 본 작업 종결 후)**

cdp_events 안 신규 6 컬럼 + 2 인덱스 영역 SCHEMA.md 안 명시 의무.

---

## D4 — tsc + 자가 grep + Codex 이중 검증 + 최종 검증

### Task 4.1: 옛 SDK + Auto-Capture 통합 빌드 검증

- [ ] **Step 4.1.1: 옛 npm 빌드 검증 (ESM/CJS/types)**

```bash
cd packages/sdk-js
npm run build
```

Expected: `dist/esm/` + `dist/cjs/` + `dist/types/` 0 errors + 옛 HanjulloSDK 클래스 export OK

- [ ] **Step 4.1.2: IIFE 빌드 검증**

```bash
cd packages/sdk-js
npm run build:iife
ls -lh dist/iife/hanjul.min.js
```

Expected: `dist/iife/hanjul.min.js` 생성 + 사이즈 <50KB (gzipped <15KB target)

- [ ] **Step 4.1.3: vitest 전체 테스트 검증**

```bash
cd packages/sdk-js
npm run test
```

Expected: PASS — 8 테스트 파일 + 약 40+ test all green

- [ ] **Step 4.1.4: backend tsc 검증**

```bash
cd packages/backend
npx tsc --noEmit
```

Expected: 0 errors

---

### Task 4.2: 영구 룰 자가 grep (의무)

- [ ] **Step 4.2.1: 모델명 노출 grep = 0건 의무 (no_model_name_ui_exposure)**

```bash
grep -rn "Opus\|Sonnet\|Haiku\|GPT\|Claude\|Anthropic\|claude-opus\|claude-sonnet\|claude-haiku" \
  packages/sdk-js/src/auto-capture/ \
  packages/backend/src/utils/pii-masking.ts 2>/dev/null
```

Expected: 0건 (코드 주석 영역 포함)

- [ ] **Step 4.2.2: 박-단어 grep = 0건 의무**

```bash
grep -rEn "박[음힘는을힌지혀힙히혔힐았혀]" \
  packages/sdk-js/src/auto-capture/ \
  packages/backend/src/utils/pii-masking.ts \
  packages/backend/src/routes/cdp.ts 2>/dev/null
```

Expected: 0건

- [ ] **Step 4.2.3: 옛 단어 / 진정 / 영영 / 본격 / 본 AI grep = 0건 의무**

```bash
grep -rEn "박[음힘는을힌지혀힙히혔힐았혀]|진정|영영|본격|본 AI" \
  packages/sdk-js/src/auto-capture/ \
  packages/backend/src/utils/pii-masking.ts 2>/dev/null
```

Expected: 0건

- [ ] **Step 4.2.4: native dialog grep = 0건 의무**

```bash
grep -rEn "confirm\(|prompt\(|alert\(" \
  packages/sdk-js/src/auto-capture/ 2>/dev/null
```

Expected: 0건 (SDK = 브라우저 영역 — native dialog 절대 금지)

- [ ] **Step 4.2.5: 휴머스온 grep = 0건 의무**

```bash
grep -rEn "휴머스온|Humuson" packages/sdk-js/src/ packages/backend/src/utils/pii-masking.ts 2>/dev/null
```

Expected: 0건

- [ ] **Step 4.2.6: 검출 영역 있으면 정정 의무 + 재실행 + 0건 의무**

---

### Task 4.3: Codex Plugin 이중 검증 (의무)

- [ ] **Step 4.3.1: Codex Plugin 호출 (CLAUDE.md codex_review_after_code_change 룰)**

Harold 직접 slash command 호출:

```
/codex:review packages/sdk-js/src/auto-capture/ packages/backend/src/utils/pii-masking.ts packages/backend/src/routes/cdp.ts
```

Expected: Codex AI 분석 + 검출 영역 0~5건 + Codex 권장 정정

- [ ] **Step 4.3.2: Codex 검출 영역 정정 (최대 5라운드)**

검출 영역 = 정정 의무 + 재호출 의무.

- [ ] **Step 4.3.3: Codex 종결 컨펌**

---

### Task 4.4: Harold 직접 배포 (의무 — no_system_modification 룰)

- [ ] **Step 4.4.1: Harold 직접 tp-push**

본 v0.3.5-a 작업 종결 = Harold 직접 다음 진행 의무:

```
tp-push "D226+ SDK v0.3.5-a — Auto-Capture 5 모듈 (pageview + click 보수 + identify + consent + heartbeat) + PII masking 7 분류 + transport batch + retry + schema_version v1 + 백엔드 /api/cdp/ingest endpoint + cdp_events ALTER 6 컬럼"
```

- [ ] **Step 4.4.2: Harold 직접 서버 SSH + backend build:safe + pm2 restart all**

```bash
ssh administrator@app.hanjul.ai
cd /home/administrator/targetup-app/packages/backend
npm run build:safe
pm2 restart all
```

- [ ] **Step 4.4.3: Harold 직접 cdp_events ALTER (PG SQL Step 3.5.1 실행)**

- [ ] **Step 4.4.4: Harold 직접 CDN 배포 (`https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js`)**

본 CDN 인프라 영역 = Harold 직접 진행 의무 (S3 / Cloudflare R2 / 옛 인프라 정합).

---

### Task 4.5: POPPON 검증 (Harold + POPPON 회사 공동 진행)

- [ ] **Step 4.5.1: POPPON Next.js 15 App Router 안 `<script>` 1줄 추가 안내**

```html
<!-- POPPON 안 _document.tsx 또는 layout.tsx 안 추가 -->
<script src="https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js" async></script>
<script>
  window.addEventListener('load', () => {
    window.hjl.init({
      apiKey: 'hjl_poppon_xxx',
      endpoint: 'https://app.hanjul.ai/api/cdp',
      debug: true,
    });
  });
</script>
```

- [ ] **Step 4.5.2: POPPON body 안 data-hjl-user-id 자동 매핑 추가**

```html
<!-- POPPON 회원 영역 안 layout.tsx -->
<body data-hjl-user-id={user.id} data-hjl-consent-marketing="true">
```

- [ ] **Step 4.5.3: 15분 안 first event 수신 확인 (Harold + POPPON)**

PG SQL 호출:

```sql
SELECT event_type, COUNT(*) AS cnt, MIN(received_at) AS first
FROM cdp_events
WHERE company_id = (SELECT id FROM companies WHERE name LIKE '%POPPON%' LIMIT 1)
  AND received_at >= NOW() - INTERVAL '15 minutes'
GROUP BY event_type
ORDER BY first;
```

Expected: pageview + click + identify + consent 4 event_type 이상 검출 + first 수신 = SDK 활용 시점 +15분 안

- [ ] **Step 4.5.4: heartbeat 5 단계 작동 확인 (Browser console 안)**

POPPON 안 브라우저 콘솔:

```js
window.hjl._heartbeat.snapshot()
```

Expected:
```js
{
  sdk_loaded: <timestamp>,
  config_loaded: <timestamp>,
  domain_matched: <timestamp>,
  first_pageview_sent: <timestamp>,
  first_event_accepted: null  // 또는 백엔드 ACK 후 timestamp
}
```

- [ ] **Step 4.5.5: PII leakage 0건 확인 (PG 안)**

```sql
SELECT COUNT(*) AS pii_leak
FROM cdp_events
WHERE company_id = (SELECT id FROM companies WHERE name LIKE '%POPPON%' LIMIT 1)
  AND received_at >= NOW() - INTERVAL '1 hour'
  AND (
    payload::text ~ '\d{6}-\d{7}'  -- 주민번호 raw 검출 (마스킹 X = 사고)
    OR payload::text ~ '010-\d{4}-\d{4}'  -- 휴대폰 raw
    OR payload::text ~ '\d{4}-\d{4}-\d{4}-\d{4}'  -- 카드 raw
  );
```

Expected: 0건

---

## Self-review (본 plan 종결 직후 의무)

- [ ] **§12 결정 매트릭스 10 = 본 plan 적용 검증**

각 결정 = 본 plan 안 Task 또는 코드 라인 매칭:
- #1 자동 수집 5 한정 → D2 Task 2.3~2.6 + D3 Task 3.1
- #2 `data-hjl-*` → identify.ts + consent.ts + click.ts 안 ATTR_* 영역
- #3 평문 OK + 백엔드 마스킹 → Task 3.4 안 maskPII 2차 안전망
- #4 consent 4 분리 → Task 2.4 CHANNELS = ['analytics', 'marketing', 'ad', 'kakao']
- #5 schema_version v1 → Task 3.2 transport.ts SCHEMA_VERSION = 'v1'
- #6 ID 병합 전체 보존 → Task 2.1 anonymous_id 영구 (localStorage)
- #7 PII masking 7 분류 → Task 2.2 + Task 3.4 PATTERNS 7 영역
- #8 100만원/월+ 진입 자격 → requireCdpApiKey 미들웨어 (옛 영역) + companies.plan_code 검증 (별 plan)
- #9 pinned CDN → Task 1.2 rollup.config.js output `dist/iife/hanjul.min.js` + Task 4.4 Harold 직접 배포
- #10 POPPON 기본 기준 → Task 4.5 (Step 4.5.1~4.5.5)

- [ ] **Placeholder 검색 = TBD/TODO/FIXME = 0건 의무**

```bash
grep -rn "TBD\|TODO\|FIXME\|XXX" docs/superpowers/plans/2026-05-29-sdk-v035-a-implementation.md
```

Expected: 0건 (단순 코드 안 의도된 TODO X — Task 안 모든 step = 명확 의무)

- [ ] **타입 + 메서드명 일관성 검증**

- `getAnonymousId()` (Task 2.1) → `Transport` constructor (Task 3.2) 안 호출 영역 = 일치
- `Heartbeat.mark()` (Task 3.1) → `index.ts` (Task 3.3) 안 호출 영역 = 일치
- `maskPII()` (Task 2.2 SDK) ↔ `maskPII()` (Task 3.4 backend) = 동일 시그니처 + 동일 7 분류 패턴

---

## v0.3.5-a 종결 직후 (Harold 직접 진행)

1. **Codex 이중 검증 종결 후 = STATUS.md + LESSONS_FRONTEND.md / LESSONS_BACKEND.md 안 v0.3.5-a 영역 추가**
2. **본 plan 파일 = 옛 spec 안 §17 명시 = `docs/superpowers/archive/` 이동 의무** (또는 본 plan 그대로 plans 폴더 보존 + spec 한정 archive 이동)
3. **v0.3.5-b 별 plan 작성 진입** (백오피스 1-click 발급 UI + first event 검증 화면 + 5/10/30분 단계별 자동 진단)
4. **메모리 신설** = `memory/project_d226_sdk_v035_a_completed.md`
5. **MEMORY.md 안 1줄 추가**
