# 싱크에이전트 OS별 빌드 티어 + 슈퍼관리자 배포 위저드 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OS별로 도는 싱크에이전트 빌드 5종을 실제로 산출하고, 서수란 팀장(구형 개발자, 전문지식 X)이 OS를 평범한 말로 고르기만 하면 "이 버전 내보내라"를 알려주는 슈퍼관리자 단계별 위저드를 만든다.

**Architecture:** 빌드 티어 룰표를 백엔드 컨트롤타워 1곳(`agent-build-tiers.ts`)에 두고(단일 진실원, AI 판단 0), 백엔드 endpoint가 그대로 내려주며, 프론트 위저드가 그걸 받아 단계별 선택 → 결과 카드를 렌더한다. 빌드는 `sync-agent`의 node 스크립트가 5종을 산출하고 Windows 구형 티어엔 런타임 DLL을 app-local로 동봉한다.

**Tech Stack:** Node/esbuild/pkg(@yao-pkg & vercel/pkg@5.8.1), Express + PostgreSQL(기존), React + Tailwind(다크톤), vitest.

**설계서:** `docs/superpowers/specs/2026-06-16-sync-agent-build-tiers-design.md`

**CLAUDE.md 제약(전 태스크 적용):** ① 룰표는 CT 1곳에만 — 프론트/라우트 인라인 복제 금지(`no_inline_duplication`) ② 위저드 = AI 여정 빌더 동급 디자인 + native dialog 0건(기존 커스텀 모달 패턴) ③ 1차 stateless = **신규 DB 테이블·컬럼 0건** ④ 빌드/배포는 Harold 직접(AI는 코드만) ⑤ 모델명 노출 X(해당 없음).

**지원 바닥:** Windows = Server 2008 R2 SP1 / Win7 SP1 이상, Linux = CentOS7/RHEL7/Ubuntu14.04(glibc≥2.17) 이상. 미만 = 명시적 비지원.

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `sync-agent/scripts/build-tier.js` | 티어 1개 빌드(deps 세팅 → esbuild target → pkg target → 산출물명) | 신규 |
| `sync-agent/scripts/bundle-windows-runtime.js` | Windows 구형 티어 폴더에 UCRT/vcruntime DLL + wasm + bat 동봉 | 신규 |
| `sync-agent/scripts/build-tiers.js` | 5종 전체 빌드 + 런타임 동봉 + `manifest.json` 생성 | 신규 |
| `sync-agent/package.json` | 티어별 npm 스크립트 6개 추가 | 수정 |
| `packages/backend/src/utils/agent-build-tiers.ts` | 빌드 티어 룰표 + `resolveAgentBuild()` (컨트롤타워, 단일 진실원) | 신규 |
| `packages/backend/src/utils/__tests__/agent-build-tiers.test.ts` | 룰표·resolve 단위 테스트 | 신규 |
| `packages/backend/src/routes/admin-sync.ts` | `GET /api/admin/sync/build-tiers` endpoint 추가 | 수정 |
| `packages/frontend/src/components/admin/AgentDeployWizard.tsx` | 단계별 배포 위저드 UI(여정 동급) | 신규 |
| `packages/frontend/src/pages/AdminDashboard.tsx` | `agentDeploy` 탭 + 메뉴 + 위저드 렌더 | 수정 |
| `sync-agent/installer/README.md` | 지원 범위·티어별 설치·diagnose 안내 | 수정 |

> 위저드는 `LoginBlocksManagement`처럼 `components/admin/`에 자립 컴포넌트로 두고 AdminDashboard가 탭으로 렌더(기존 패턴).

---

## Phase 1 — 백엔드 룰표 컨트롤타워 (TDD)

### Task 1: 빌드 티어 룰표 CT + resolve 함수

**Files:**
- Create: `packages/backend/src/utils/agent-build-tiers.ts`
- Test: `packages/backend/src/utils/__tests__/agent-build-tiers.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// packages/backend/src/utils/__tests__/agent-build-tiers.test.ts
import { describe, it, expect } from 'vitest';
import {
  PLATFORMS, OS_TIERS, DB_OPTIONS, resolveAgentBuild,
} from '../agent-build-tiers';

describe('agent-build-tiers', () => {
  it('윈도우 2008R2 → win-legacy node14 + 런타임 동봉', () => {
    const r = resolveAgentBuild('windows', 'win-2008r2', 'mssql-old');
    expect(r.supported).toBe(true);
    expect(r.buildTier).toBe('win-legacy');
    expect(r.node).toBe(14);
    expect(r.runtimeBundle).toBe(true);
    expect(r.dbNotes.join(' ')).toMatch(/encrypt=false/);
  });

  it('윈도우 모던 → win-modern node20 + 동봉 없음', () => {
    const r = resolveAgentBuild('windows', 'win-modern', 'mssql-modern');
    expect(r.buildTier).toBe('win-modern');
    expect(r.node).toBe(20);
    expect(r.runtimeBundle).toBe(false);
  });

  it('리눅스 CentOS7 → linux-legacy node16', () => {
    const r = resolveAgentBuild('linux', 'linux-legacy', 'postgres');
    expect(r.buildTier).toBe('linux-legacy');
    expect(r.node).toBe(16);
  });

  it('바닥 미만(win-ancient) → 미지원 + 안내 문구', () => {
    const r = resolveAgentBuild('windows', 'win-ancient', 'mssql-old');
    expect(r.supported).toBe(false);
    expect(r.buildTier).toBeNull();
    expect(r.rangeMessage).toMatch(/지원 범위 밖/);
  });

  it('OS_TIERS는 플랫폼별로 분기되고 라벨은 평범한 한국어', () => {
    const win = OS_TIERS.filter((t) => t.platform === 'windows');
    expect(win.some((t) => /Windows 7|2008 R2/.test(t.label))).toBe(true);
    expect(PLATFORMS.map((p) => p.id).sort()).toEqual(['linux', 'windows']);
    expect(DB_OPTIONS.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/backend && npx vitest run src/utils/__tests__/agent-build-tiers.test.ts`
Expected: FAIL — "Cannot find module '../agent-build-tiers'"

- [ ] **Step 3: CT 구현 (룰표 + resolve)**

```ts
// packages/backend/src/utils/agent-build-tiers.ts
// ============================================================================
// CT — 싱크에이전트 빌드 티어 룰표 (단일 진실원, AI 판단 0)
// OS(플랫폼+버전) → 내보낼 빌드 티어 + node + 런타임 동봉 + DB 주의사항.
// 프론트 위저드 / endpoint는 이 표만 소비한다. 인라인 복제 금지.
// 지원 바닥: Windows 2008R2/Win7, Linux glibc≥2.17(CentOS7). 미만 = 미지원.
// ============================================================================

export type PlatformId = 'windows' | 'linux';

export interface Platform { id: PlatformId; label: string; }

export interface OsTier {
  id: string;
  platform: PlatformId;
  label: string;          // 서수란 팀장용 평범한 말
  buildTier: string | null;
  node: 14 | 16 | 20 | null;
  supported: boolean;
  runtimeBundle: boolean; // Windows 구형 = UCRT app-local 동봉
  rangeMessage?: string;  // 미지원 안내
}

export interface DbOption { id: string; label: string; notes: string[]; }

export interface ResolveResult {
  supported: boolean;
  buildTier: string | null;
  node: 14 | 16 | 20 | null;
  runtimeBundle: boolean;
  packageFile: string | null;   // manifest의 산출물 파일명 키
  dbNotes: string[];
  installSummary: string[];
  rangeMessage?: string;
}

export const PLATFORMS: Platform[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
];

export const OS_TIERS: OsTier[] = [
  // Windows
  { id: 'win-modern', platform: 'windows', label: 'Windows 10/11 · Server 2016 이상',
    buildTier: 'win-modern', node: 20, supported: true, runtimeBundle: false },
  { id: 'win-2012', platform: 'windows', label: 'Windows 8.1 · Server 2012 / 2012 R2',
    buildTier: 'win-mid', node: 16, supported: true, runtimeBundle: true },
  { id: 'win-2008r2', platform: 'windows', label: 'Windows 7 · Server 2008 R2',
    buildTier: 'win-legacy', node: 14, supported: true, runtimeBundle: true },
  { id: 'win-ancient', platform: 'windows', label: '그 이하 (Server 2008 · 2003)',
    buildTier: null, node: null, supported: false, runtimeBundle: false,
    rangeMessage: '지원 범위 밖입니다 (Windows는 Server 2008 R2 / Win7 이상만 지원). 가능하면 같은 네트워크의 최신 PC에 에이전트를 설치해 이 DB를 읽어오세요.' },
  // Linux
  { id: 'linux-modern', platform: 'linux', label: 'Ubuntu 20.04+ · RHEL 8+ · Debian 10+',
    buildTier: 'linux-modern', node: 20, supported: true, runtimeBundle: false },
  { id: 'linux-legacy', platform: 'linux', label: 'CentOS 7 · RHEL 7 · Ubuntu 16~18',
    buildTier: 'linux-legacy', node: 16, supported: true, runtimeBundle: false },
  { id: 'linux-ancient', platform: 'linux', label: 'CentOS 6 · RHEL 6 이하',
    buildTier: null, node: null, supported: false, runtimeBundle: false,
    rangeMessage: '지원 범위 밖입니다 (Linux는 glibc 2.17 / CentOS 7 이상만 지원). 가능하면 같은 네트워크의 최신 서버에 에이전트를 설치해 이 DB를 읽어오세요.' },
];

export const DB_OPTIONS: DbOption[] = [
  { id: 'mssql-old', label: 'MS SQL Server 2008 · 2012',
    notes: ['연결 옵션 encrypt=false 권장', 'SQL Server에서 TLS 1.0/1.1 허용 여부 점검', '읽기전용 계정 사용'] },
  { id: 'mssql-modern', label: 'MS SQL Server 2016 이상',
    notes: ['기본 설정으로 연결', '읽기전용 계정 사용'] },
  { id: 'mysql', label: 'MySQL / MariaDB',
    notes: ['mysql2 드라이버 사용', '읽기전용 계정 사용'] },
  { id: 'postgres', label: 'PostgreSQL',
    notes: ['pg 드라이버 사용', '읽기전용 계정 사용'] },
];

export function resolveAgentBuild(
  platform: PlatformId,
  osTierId: string,
  dbId: string,
): ResolveResult {
  const tier = OS_TIERS.find((t) => t.platform === platform && t.id === osTierId);
  const db = DB_OPTIONS.find((d) => d.id === dbId);
  const dbNotes = db ? db.notes : [];

  if (!tier || !tier.supported || !tier.buildTier) {
    return {
      supported: false, buildTier: null, node: null, runtimeBundle: false,
      packageFile: null, dbNotes,
      installSummary: [],
      rangeMessage: tier?.rangeMessage ?? '지원 범위 밖이거나 알 수 없는 OS입니다.',
    };
  }

  const installSummary = platform === 'windows'
    ? [
        '받은 폴더를 대상 PC의 C:\\ 바로 아래에 복사 (예: C:\\SyncAgent)',
        'INSTALL-run-as-admin.bat 을 관리자 권한으로 실행',
        '화면에 sync-agent v… 가 뜨면 정상 (안 뜨면 diagnose.txt 회신)',
        '읽기전용 DB 계정 정보로 설정',
      ]
    : [
        '받은 tar.gz 를 대상 서버에 풀고 install.sh 실행',
        'systemctl status bito-agent 로 동작 확인',
        '읽기전용 DB 계정 정보로 설정',
      ];

  return {
    supported: true,
    buildTier: tier.buildTier,
    node: tier.node,
    runtimeBundle: tier.runtimeBundle,
    packageFile: tier.buildTier, // manifest 키 = buildTier id
    dbNotes,
    installSummary,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd packages/backend && npx vitest run src/utils/__tests__/agent-build-tiers.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 5: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```
git add packages/backend/src/utils/agent-build-tiers.ts packages/backend/src/utils/__tests__/agent-build-tiers.test.ts
git commit -m "feat(agent): 빌드 티어 룰표 CT + resolveAgentBuild (단일 진실원)"
```

---

### Task 2: 슈퍼관리자 endpoint — 룰표 + resolve 제공

**Files:**
- Modify: `packages/backend/src/routes/admin-sync.ts` (라우트 추가; 기존 패턴 `authenticate, requireSuperAdmin`)

- [ ] **Step 1: 실패 테스트 작성 (supertest 패턴이 있으면 사용, 없으면 resolve 재노출만 단위 확인)**

```ts
// packages/backend/src/utils/__tests__/agent-build-tiers.endpoint.test.ts
import { describe, it, expect } from 'vitest';
import { PLATFORMS, OS_TIERS, DB_OPTIONS, resolveAgentBuild } from '../agent-build-tiers';

// endpoint는 아래 payload를 그대로 직렬화해 내려준다(라우트는 얇게).
describe('build-tiers payload', () => {
  it('위저드 부트스트랩 payload 구성', () => {
    const payload = { platforms: PLATFORMS, osTiers: OS_TIERS, dbOptions: DB_OPTIONS };
    expect(payload.platforms.length).toBe(2);
    expect(payload.osTiers.every((t) => 'label' in t)).toBe(true);
  });
  it('resolve payload', () => {
    expect(resolveAgentBuild('windows', 'win-2008r2', 'mssql-old').node).toBe(14);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** — Run: `cd packages/backend && npx vitest run src/utils/__tests__/agent-build-tiers.endpoint.test.ts` · Expected: FAIL(파일 없음)

- [ ] **Step 3: 라우트 추가 (admin-sync.ts 상단 import + 라우트 2개)**

`admin-sync.ts` import 영역에 추가:
```ts
import { PLATFORMS, OS_TIERS, DB_OPTIONS, resolveAgentBuild, PlatformId } from '../utils/agent-build-tiers';
```

`router` 정의 뒤 아무 곳(다른 라우트 사이)에 추가:
```ts
// GET /api/admin/sync/build-tiers — 위저드 부트스트랩(플랫폼/OS/DB 목록)
router.get('/build-tiers', authenticate, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, platforms: PLATFORMS, osTiers: OS_TIERS, dbOptions: DB_OPTIONS });
});

// GET /api/admin/sync/build-tiers/resolve?platform=&osTier=&db= — 결과 1건
router.get('/build-tiers/resolve', authenticate, requireSuperAdmin, (req: Request, res: Response) => {
  const platform = String(req.query.platform || '') as PlatformId;
  const osTier = String(req.query.osTier || '');
  const db = String(req.query.db || '');
  if (platform !== 'windows' && platform !== 'linux') {
    return res.status(400).json({ success: false, error: 'platform 값이 올바르지 않습니다.' });
  }
  res.json({ success: true, result: resolveAgentBuild(platform, osTier, db) });
});
```

- [ ] **Step 4: 테스트/타입 확인** — Run: `cd packages/backend && npx vitest run src/utils/__tests__/agent-build-tiers.endpoint.test.ts && npx tsc --noEmit` · Expected: PASS + 0 errors

- [ ] **Step 5: Commit**
```
git add packages/backend/src/routes/admin-sync.ts packages/backend/src/utils/__tests__/agent-build-tiers.endpoint.test.ts
git commit -m "feat(agent): build-tiers 위저드 endpoint (목록 + resolve)"
```

---

## Phase 2 — 프론트 배포 위저드 (여정 동급)

### Task 3: AgentDeployWizard 컴포넌트

**Files:**
- Create: `packages/frontend/src/components/admin/AgentDeployWizard.tsx`

**계약(백엔드와 1:1):**
- `GET /api/admin/sync/build-tiers` → `{ platforms[], osTiers[], dbOptions[] }`
- `GET /api/admin/sync/build-tiers/resolve?platform=&osTier=&db=` → `{ result: ResolveResult }`
- 기존 `api/client`의 인증 fetch 래퍼 사용(같은 디렉터리 다른 admin 컴포넌트의 호출 방식을 따른다).

**동작 명세 (단계별 위저드 — 드롭다운 폼 아님):**
1. **Step 1 플랫폼:** Windows / Linux 카드 2개. 클릭 시 선택 + 자동 다음 단계.
2. **Step 2 OS:** 선택한 플랫폼의 `osTiers`만 카드 리스트로. 평범한 라벨(`label`)만 노출 — **node/glibc 같은 기술용어는 화면에 안 보임.** 클릭 → 다음.
   - `supported=false` 티어 클릭 → 결과 단계로 가되 `rangeMessage`만 큰 안내로 표시(빌드/다운로드 없음).
3. **Step 3 DB:** `dbOptions` 카드. 클릭 → resolve 호출 → 결과 단계.
4. **결과 카드:** buildTier 사람이 읽는 이름(예: "Windows 7 / 2008 R2 전용"), `installSummary` 체크리스트, `dbNotes` 주의 박스, 다운로드 버튼(Task 5 manifest 링크), "처음부터" 버튼.
- 상단 Step 1/2/3 진행 바. 각 단계 "이전" 가능.

**디자인 체크리스트(`design_quality_minimum_journey_level`):**
- sticky 헤더 + BETA badge + 그라데이션 아이콘(10x10 rounded-xl).
- 다크톤: `bg-slate-950`, 카드 `border-white/10`, violet/fuchsia 액센트.
- 카드 hover 그라데이션, 선택 시 ring.
- **native dialog 0건** — 안내/확인은 토스트 또는 인라인 카드(AdminDashboard의 `ModalState` 커스텀 모달 패턴 참고, `alert/confirm/prompt` 금지).
- 모바일 반응형: `grid-cols-1 md:grid-cols-2`, `flex-wrap`.
- 결과 카드 하단 Source caption: `text-[10px] text-white/30 italic` "기준: 사내 빌드 티어 룰표".

- [ ] **Step 1: 컴포넌트 작성**
  - 위 명세대로 구현. state: `step(1|2|3|result)`, `platform`, `osTier`, `db`, `bootstrap`, `result`, `loading`.
  - 마운트 시 `build-tiers` GET → `bootstrap` 세팅.
  - 라벨/노트는 전부 백엔드 payload에서 받은 값만 렌더(**프론트에 OS→node 매핑 인라인 금지** — `no_inline_duplication`).
  - 자가검증: 작성 직후 `grep -nE "alert\(|confirm\(|prompt\(" AgentDeployWizard.tsx` = 0건, 모델명 grep = 0건.

- [ ] **Step 2: 타입체크** — Run: `cd packages/frontend && npx tsc --noEmit` · Expected: 0 errors

- [ ] **Step 3: native dialog/모델명 자가 grep** — Run: `grep -REn "alert\(|confirm\(|prompt\(|Opus|Sonnet|Claude|GPT" packages/frontend/src/components/admin/AgentDeployWizard.tsx` · Expected: 결과 없음

- [ ] **Step 4: Commit**
```
git add packages/frontend/src/components/admin/AgentDeployWizard.tsx
git commit -m "feat(admin): 싱크에이전트 배포 위저드 (단계별, 여정 동급)"
```

---

### Task 4: AdminDashboard에 위저드 탭 연결

**Files:**
- Modify: `packages/frontend/src/pages/AdminDashboard.tsx`

- [ ] **Step 1: import 추가** (다른 admin 컴포넌트 import 줄 근처)
```ts
import AgentDeployWizard from '../components/admin/AgentDeployWizard';
```

- [ ] **Step 2: activeTab 유니온에 `'agentDeploy'` 추가** (68번 줄 `useState<... 'loginBlocks'>` 유니온 끝에 `| 'agentDeploy'`)

- [ ] **Step 3: 메뉴/탭 항목 추가** — `syncAgents` 탭 근처 메뉴 구조를 따라 "배포 버전 선택" 메뉴 1건 추가(기존 탭 버튼 패턴 그대로). 라벨: `싱크에이전트 배포`.

- [ ] **Step 4: 렌더 분기 추가** — 다른 탭 렌더 분기 패턴을 따라:
```tsx
{activeTab === 'agentDeploy' && <AgentDeployWizard />}
```

- [ ] **Step 5: 타입체크 + 자가 grep** — Run: `cd packages/frontend && npx tsc --noEmit` · Expected: 0 errors. native dialog 0건 유지.

- [ ] **Step 6: Commit**
```
git add packages/frontend/src/pages/AdminDashboard.tsx
git commit -m "feat(admin): 배포 위저드 탭 연결"
```

---

## Phase 3 — 빌드 시스템 (5종 실제 산출)

### Task 5: 티어 빌드 스크립트 3종 + package.json 스크립트

**Files:**
- Create: `sync-agent/scripts/build-tier.js`, `sync-agent/scripts/bundle-windows-runtime.js`, `sync-agent/scripts/build-tiers.js`
- Modify: `sync-agent/package.json` (scripts)

- [ ] **Step 1: `build-tier.js` 작성 (티어 1개 빌드)**

```js
// sync-agent/scripts/build-tier.js
// 사용: node scripts/build-tier.js <tierId>
// tierId: win-modern | win-mid | win-legacy | linux-modern | linux-legacy
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

const TIERS = {
  'win-modern':   { node: 'node20', pkg: 'node20-win-x64',   out: 'release/sync-agent-win-modern.exe',   legacy: false, os: 'win' },
  'win-mid':      { node: 'node16', pkg: 'node16-win-x64',   out: 'release/sync-agent-win-mid.exe',       legacy: true,  os: 'win' },
  'win-legacy':   { node: 'node14', pkg: 'node14-win-x64',   out: 'release/sync-agent-win-legacy.exe',    legacy: true,  os: 'win' },
  'linux-modern': { node: 'node20', pkg: 'node20-linux-x64', out: 'release/sync-agent-linux-modern',      legacy: false, os: 'linux' },
  'linux-legacy': { node: 'node16', pkg: 'node16-linux-x64', out: 'release/sync-agent-linux-legacy',      legacy: true,  os: 'linux' },
};

const tierId = process.argv[2];
const t = TIERS[tierId];
if (!t) { console.error('알 수 없는 tier:', tierId, '\n사용 가능:', Object.keys(TIERS).join(', ')); process.exit(1); }

console.log(`\n=== build tier ${tierId} (${t.node}) ===`);
if (t.legacy) sh('npm i express@4.22.2 mssql@10.0.4 --no-save');
sh(`node esbuild.config.js --target=${t.node}`);
sh('npm run prebundle:wasm');
// modern은 @yao-pkg/pkg, legacy는 vercel/pkg@5.8.1 (node16/14 prelude 버그 우회)
const pkgCmd = t.legacy ? 'npx -y pkg@5.8.1' : 'npx -y @yao-pkg/pkg';
sh(`${pkgCmd} dist/bundle.js --targets ${t.pkg} --output ${t.out}`);
if (t.legacy) sh('npm ci'); // 의존성 원복 (메인 무손)
console.log(`완료: ${t.out}`);
```

- [ ] **Step 2: 단일 티어 빌드 검증** — Run: `cd sync-agent && node scripts/build-tier.js win-legacy` · Expected: `release/sync-agent-win-legacy.exe` 생성. 이어서 `node -e "require('child_process').execSync('release\\sync-agent-win-legacy.exe --version',{stdio:'inherit'})"` 로 `sync-agent v1.5.5` 확인(이번 세션 node14 검증과 동일).

- [ ] **Step 3: `bundle-windows-runtime.js` 작성 (Windows 구형 티어 app-local 동봉)**

```js
// sync-agent/scripts/bundle-windows-runtime.js
// 사용: node scripts/bundle-windows-runtime.js <exePath> <outDir>
// 효과: outDir에 exe(sync-agent.exe) + wasm + UCRT 46 + vcruntime + 자가진단 bat 배치
const fs = require('fs');
const path = require('path');

const [exePath, outDir] = process.argv.slice(2);
if (!exePath || !outDir) { console.error('사용: node scripts/bundle-windows-runtime.js <exePath> <outDir>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

// 1) exe + wasm
fs.copyFileSync(exePath, path.join(outDir, 'sync-agent.exe'));
fs.copyFileSync(path.resolve(__dirname, '../release/sql-wasm.wasm'), path.join(outDir, 'sql-wasm.wasm'));

// 2) UCRT app-local 정식 세트 (최신 Windows SDK redist 자동 탐색)
const sdkRedist = 'C:/Program Files (x86)/Windows Kits/10/Redist';
const sdkVer = fs.readdirSync(sdkRedist)
  .filter((d) => /^10\./.test(d) && fs.existsSync(path.join(sdkRedist, d, 'ucrt/DLLs/x64')))
  .sort().pop();
if (!sdkVer) { console.error('Windows SDK UCRT redist 없음 — SDK 설치 필요'); process.exit(1); }
const ucrtDir = path.join(sdkRedist, sdkVer, 'ucrt/DLLs/x64');
for (const f of fs.readdirSync(ucrtDir).filter((f) => f.endsWith('.dll'))) {
  fs.copyFileSync(path.join(ucrtDir, f), path.join(outDir, f));
}

// 3) VC 런타임 (System32)
for (const d of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
  const src = path.join(process.env.WINDIR || 'C:/Windows', 'System32', d);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, d));
}

// 4) 자가진단 bat (이번 세션 산출물과 동일 — exit code → diagnose.txt)
fs.copyFileSync(path.resolve(__dirname, 'INSTALL-run-as-admin.bat.tpl'), path.join(outDir, 'INSTALL-run-as-admin.bat'));
console.log(`동봉 완료: ${outDir} (DLL ${fs.readdirSync(outDir).filter((f)=>f.endsWith('.dll')).length}개)`);
```
> `INSTALL-run-as-admin.bat.tpl` = 이번 세션의 자가진단 bat 내용 그대로 `sync-agent/scripts/`에 1회 저장(EXIT_CODE→diagnose.txt + 서비스 등록 분기).

- [ ] **Step 4: `build-tiers.js` 작성 (5종 + 동봉 + manifest)**

```js
// sync-agent/scripts/build-tiers.js  — 전체 티어 빌드 + manifest
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const sh = (c) => execSync(c, { cwd: ROOT, stdio: 'inherit' });

const TIERS = ['win-modern', 'win-mid', 'win-legacy', 'linux-modern', 'linux-legacy'];
const WIN_BUNDLE = { 'win-mid': 'sync-agent-win-mid.exe', 'win-legacy': 'sync-agent-win-legacy.exe' };

for (const t of TIERS) sh(`node scripts/build-tier.js ${t}`);

// Windows 구형 티어 = app-local 동봉 폴더 생성
for (const [tier, exe] of Object.entries(WIN_BUNDLE)) {
  sh(`node scripts/bundle-windows-runtime.js release/${exe} dist-tiers/${tier}/SyncAgent`);
}

// manifest: 티어 → 파일·sha256·node·빌드시각
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
const manifest = {
  builtAt: new Date().toISOString(),
  version: require('../package.json').version,
  tiers: {
    'win-modern':   { file: 'release/sync-agent-win-modern.exe', node: 20, sha: sha(path.join(ROOT, 'release/sync-agent-win-modern.exe')) },
    'win-mid':      { dir: 'dist-tiers/win-mid/SyncAgent', node: 16 },
    'win-legacy':   { dir: 'dist-tiers/win-legacy/SyncAgent', node: 14 },
    'linux-modern': { file: 'release/sync-agent-linux-modern', node: 20, sha: sha(path.join(ROOT, 'release/sync-agent-linux-modern')) },
    'linux-legacy': { file: 'release/sync-agent-linux-legacy', node: 16, sha: sha(path.join(ROOT, 'release/sync-agent-linux-legacy')) },
  },
};
fs.writeFileSync(path.join(ROOT, 'release/build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest 생성: release/build-manifest.json');
```
> `dist-tiers/` 는 .gitignore에 추가(산출물). manifest는 다운로드 endpoint가 읽는다(Task 2 후속 — 구현 시 admin-sync에 다운로드 라우트 1건 추가, 기존 산출물 서빙 패턴 따름).

- [ ] **Step 5: package.json 스크립트 추가**
```json
"build:win-modern": "node scripts/build-tier.js win-modern",
"build:win-mid": "node scripts/build-tier.js win-mid",
"build:win-legacy": "node scripts/build-tier.js win-legacy",
"build:linux-modern": "node scripts/build-tier.js linux-modern",
"build:linux-legacy": "node scripts/build-tier.js linux-legacy",
"build:tiers": "node scripts/build-tiers.js"
```

- [ ] **Step 6: 전체 빌드 실행 (Linux 타깃은 pkg가 base를 받아옴)** — Run: `cd sync-agent && node scripts/build-tiers.js` · Expected: release에 5 산출물 + `dist-tiers/win-*/SyncAgent/` 동봉 폴더 + `release/build-manifest.json`. (각 win exe `--version` 통과 — node16/14 사전 검증)

- [ ] **Step 7: Commit**
```
git add sync-agent/scripts sync-agent/package.json sync-agent/.gitignore
git commit -m "feat(agent): OS 티어 5종 빌드 스크립트 + 런타임 동봉 + manifest"
```

---

## Phase 4 — 매뉴얼 갱신

### Task 6: README/매뉴얼에 지원 범위·티어·diagnose 반영

**Files:**
- Modify: `sync-agent/installer/README.md`

- [ ] **Step 1: README에 아래 절 추가/갱신**
  - **지원 범위:** Windows Server 2008 R2 / Win7 이상, Linux CentOS7 / glibc 2.17 이상. 미만은 미지원(같은 망 최신 PC 설치 안내).
  - **티어별 설치:** 슈퍼관리자 "싱크에이전트 배포"에서 OS 고르면 받을 파일과 절차가 나온다. Windows 구형은 폴더 통째 복사 + `INSTALL-run-as-admin.bat`(런타임 동봉, vc_redist 불필요).
  - **안 뜰 때:** `diagnose.txt`의 `EXIT_CODE`를 회신 → 원인 분류.
  - **읽기전용:** 에이전트는 DB를 읽기전용으로만 접근(읽기전용 계정 권장).

- [ ] **Step 2: Commit**
```
git add sync-agent/installer/README.md
git commit -m "docs(agent): 지원 범위·티어별 설치·diagnose 매뉴얼 반영"
```

---

## Phase 5 — 검증 게이트

### Task 7: 구형 OS 실측 + 룰표 supported 확정

- [ ] **Step 1:** 우리 측 Win7(실 PC 또는 VirtualBox VM)에서 `dist-tiers/win-legacy/SyncAgent` 폴더로 `INSTALL-run-as-admin.bat` → `EXIT_CODE=0` + `sync-agent v1.5.5` 확인. (Win7 SP1 ≡ Server 2008 R2 SP1 동일 커널)
- [ ] **Step 2:** 같은 환경에서 **실제 DB 동기화 1건**(SELECT→전송) 확인 — legacy는 express4/mssql10로 내려가므로 `--version`만으로 끝내지 않는다.
- [ ] **Step 3:** `win-mid`/`linux-legacy`도 각 구형 환경 1건씩 동일 확인.
- [ ] **Step 4:** 통과한 티어만 룰표/매니페스트에서 정식 노출. 미검증 티어는 위저드에서 "검증 대기"로 숨김 처리(필요 시 `OsTier`에 `verified` 플래그 1건 추가 — 표 CT만 수정).
- [ ] **Step 5:** Harold 직접 빌드·배포(`tp-push` + 서버 build:safe). AI는 코드만.

> 실측은 Harold/직원 영역(AI 운영검증 X). 본 태스크는 체크리스트로만 둔다.

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** 설계서 §3 빌드5(Task5) · §4 위저드(Task3,4)+룰표(Task1)+endpoint(Task2) · §5 빌드스크립트/manifest(Task5) · §6 DB주의(Task1 dbNotes→Task3 표시) · §7 매뉴얼(Task6) · §8 검증(Task7) — 전 절 대응됨.
- **플레이스홀더:** 코드 스텝은 실제 코드 포함. 위저드 JSX는 "명세+계약+디자인 체크리스트"로 두고 실행자가 AdminDashboard 패턴으로 채움(거대 화면 컴포넌트라 의도적 — 실행 시 실파일 참조).
- **타입 일관성:** `resolveAgentBuild(platform, osTierId, db)` 시그니처 Task1=Task2 동일. `ResolveResult` 필드(buildTier/node/runtimeBundle/dbNotes/installSummary/rangeMessage) endpoint·위저드 계약과 일치. `OsTier.buildTier` ↔ manifest 키 일치.
- **DB 컬럼:** 신규 0건(stateless) — information_schema 검증 불요.

---

## Execution Handoff
구현은 main 코드 직접(CLAUDE.md: worktree 금지). 빌드·배포 명령은 Harold 직접.
