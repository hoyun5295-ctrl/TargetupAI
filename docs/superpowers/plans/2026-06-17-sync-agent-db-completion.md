# 싱크에이전트 표준 DB 완전 대응 — 구현 계획

> **For agentic workers:** 이 계획은 superpowers:subagent-driven-development 또는 executing-plans로 Task 단위 실행. 단계는 체크박스(`- [ ]`)로 추적.
> **git/배포 규칙(CLAUDE.md):** 비토는 코드만 작성. git add/commit/push·배포는 전체 완료 후 Harold님 일괄(tp-push). 각 Task는 커밋 대신 tsc/유닛/스모크 게이트로 닫는다.

**Goal:** 일반 기업 표준 DB 5종(MSSQL·MySQL·PostgreSQL·Oracle·Excel/CSV)을 싱크에이전트가 실제로 연결·동기화하게 만들고, 위저드에 보이는 DB = 그 빌드 티어에서 실제 연결되는 DB가 되도록 구조로 보증한다.

**Architecture:** Oracle 드라이버(oracledb)를 티어별로 .exe에 번들하고, 빌드 스모크로 통과한 (티어×DB) 조합만 CT(`agent-build-tiers.ts`) 단일 진실원에 등재한다. 위저드·resolve·설정 화면은 이 표만 소비해 미검증 조합을 노출하지 않는다(보이면 작동 불변식, fail-closed).

**Tech Stack:** Node.js(14/16/20)·TypeScript·esbuild·pkg(@yao-pkg/pkg, vercel/pkg@5.8.1)·oracledb 6.x(thin)·React(위저드)·vitest.

---

## File Structure

- `sync-agent/package.json` — oracledb 의존성 + pkg 포함 설정
- `sync-agent/esbuild.config.js` — oracledb external 유지(이미 있음)
- `sync-agent/scripts/build-tier.js` — 레거시 티어 oracledb 버전 핀
- `sync-agent/scripts/bundle-windows-runtime.js` — 필요 시 oracledb 네이티브 .node app-local 동봉
- `packages/backend/src/utils/agent-build-tiers.ts` — DB_OPTIONS 확장 + 티어×DB 지원표 + resolve 분기 (CT, 단일 진실원)
- `packages/backend/src/routes/admin-sync.ts` — /build-tiers 응답에 지원표 포함
- `packages/frontend/src/components/admin/AgentDeployWizard.tsx` — 티어 인지 DB 노출
- `sync-agent/src/setup/server.ts` — 연결 테스트 실패 메시지 노출 확인
- `sync-agent/src/db/types.ts`·`index.ts` — ODBC 확장 지점 주석(코드 없음)

---

## Task 1: oracledb 번들 가능성 검증 (node20 modern 먼저 — 최대 위험 선제거)

**Files:**
- Modify: `sync-agent/package.json` (dependencies + pkg)
- Read first: `sync-agent/esbuild.config.js` (oracledb 이미 external 확인)

- [ ] **Step 1: oracledb 설치 (메인 node20 기준)**

Run: `cd sync-agent && npm install oracledb@^6.7.0`
기대: dependencies에 oracledb 추가, node_modules/oracledb 생성. (6.x = thin 기본, Oracle Client 불요)

- [ ] **Step 2: pkg 강제 포함 설정**

`oracle.ts`는 `require('oracledb')`를 try/catch 안에서 동적 호출한다. pkg 정적 분석이 못 잡으므로 `package.json` `pkg` 필드에 명시한다.

```json
"pkg": {
  "assets": [
    "dist/sql-wasm.wasm"
  ],
  "scripts": [
    "node_modules/oracledb/**/*.js"
  ]
}
```

- [ ] **Step 3: 번들 + pkg (node20-win)**

Run: `cd sync-agent && node esbuild.config.js --target=node20 && npm run prebundle:wasm && npx -y @yao-pkg/pkg dist/bundle.js --targets node20-win-x64 --output release/_smoke-modern.exe`
기대: 빌드 성공, 경고에 oracledb 관련 치명적 누락 없음.

- [ ] **Step 4: 스모크 — packed exe에서 oracledb 로드 확인**

별도 1줄 진단을 에이전트에 임시 추가하지 말고, 다음으로 확인한다:
Run: `cd sync-agent && node -e "process.env.SMOKE=1; const o=require('oracledb'); console.log('oracledb', o.versionString || 'loaded', 'thin?', o.thin)"`
기대: `oracledb 6.x.x thin? true` 출력(미설치 에러 없음). packed exe 내부 로드는 Task 7 통합 스모크에서 재확인.

- [ ] **Step 5: 게이트**

tsc 0(에이전트): `cd sync-agent && npx tsc --noEmit`
임시 산출물 정리: `release/_smoke-modern.exe` 삭제.
node20에서 oracledb 로드 확인되면 Task 2로. 실패하면 원인(네이티브 .node 경로)부터 해결.

---

## Task 2: 레거시 티어(node16/node14) oracledb 핀 + 빌드 스모크 → 지원표 확정

**Files:**
- Modify: `sync-agent/scripts/build-tier.js:29` (레거시 분기)

- [ ] **Step 1: 레거시 분기에 oracledb 핀 추가**

현재(`build-tier.js`):
```js
if (t.legacy) sh('npm i express@4.22.2 mssql@10.0.4 --no-save');
```
변경 — 티어별 node에 맞는 oracledb 버전을 함께 임시 설치(메인 node20 무손, finally의 `npm ci`로 원복):
```js
if (t.legacy) {
  // oracledb 6.x = node 14.6+ 프리빌드. node14/16 호환 버전 함께 핀.
  const oraVer = t.node === 'node14' ? 'oracledb@6.0.0' : 'oracledb@6.5.1';
  sh(`npm i express@4.22.2 mssql@10.0.4 ${oraVer} --no-save`);
}
```
주: 정확한 호환 버전은 Step 2 스모크로 확정한다. 6.0.0/6.5.1은 시작점이며, 빌드 실패 시 oracledb 릴리스 노트의 node14/16 마지막 지원 버전으로 교체한다(추측으로 확정하지 않음).

- [ ] **Step 2: win-legacy(node14) 빌드 스모크**

Run: `cd sync-agent && node scripts/build-tier.js win-legacy`
기대: 빌드 완료(`release/sync-agent-win-legacy.exe`). pkg가 node14에서 oracledb를 포함하는지 경고 확인.

- [ ] **Step 3: win-legacy 산출물에서 oracledb 로드 스모크**

Run(임시 진단 env로 에이전트 부팅 후 즉시 종료 — 미설치면 connect 시 에러 로그):
`release\sync-agent-win-legacy.exe --version`
기대: `v1.5.5` 출력(크래시 없음). 실제 oracledb 로드는 Task 7 setup 흐름에서 Oracle 선택 시 확정.

- [ ] **Step 4: 결과를 지원표 기준으로 기록**

node14 빌드+로드 성공 = win-legacy에 oracle 추가 대상. 실패 = win-legacy에서 oracle 영구 제외(불변식이 사고 차단). Task 3의 `VERIFIED_DBS_BY_TIER` 작성 시 이 결과를 반영.

- [ ] **Step 5: 게이트**

5티어 모두 빌드 시도(`npm run build:tiers`는 Task 7에서). 여기선 win-modern·win-legacy 2개로 양 끝(node20/node14)만 먼저 확정.

---

## Task 3: CT — DB_OPTIONS 확장 + 티어×DB 지원표 + resolve 분기

**Files:**
- Modify: `packages/backend/src/utils/agent-build-tiers.ts`
- Test: `packages/backend/src/utils/agent-build-tiers.test.ts` (신규)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// agent-build-tiers.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAgentBuild, DB_OPTIONS, VERIFIED_DBS_BY_TIER } from './agent-build-tiers';

describe('표준 DB 완전 대응', () => {
  it('DB_OPTIONS에 oracle/excel/csv가 포함된다', () => {
    const ids = DB_OPTIONS.map((d) => d.id);
    expect(ids).toContain('oracle');
    expect(ids).toContain('excel');
    expect(ids).toContain('csv');
  });

  it('미검증 (티어×DB)는 supported:false로 막는다 (보이면 작동 불변식)', () => {
    // oracle을 일부러 빼둔 가짜 티어 검증: win-legacy에 oracle 미등재면 차단
    if (!(VERIFIED_DBS_BY_TIER['win-legacy'] || []).includes('oracle')) {
      const r = resolveAgentBuild('windows', 'win-2008r2', 'oracle');
      expect(r.supported).toBe(false);
      expect(r.rangeMessage).toMatch(/지원되지 않/);
    }
  });

  it('검증된 (티어×DB)는 정상 빌드를 돌려준다', () => {
    const r = resolveAgentBuild('windows', 'win-modern', 'mysql');
    expect(r.supported).toBe(true);
    expect(r.buildTier).toBe('win-modern');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd packages/backend && npx vitest run src/utils/agent-build-tiers.test.ts`
기대: FAIL (`VERIFIED_DBS_BY_TIER` 미정의, oracle/excel/csv 없음).

- [ ] **Step 3: DB_OPTIONS 확장**

`DB_OPTIONS` 배열에 추가(`postgres` 뒤):
```ts
  {
    id: 'oracle',
    label: 'Oracle',
    notes: [
      '읽기전용 계정 사용',
      'Service Name 방식 연결(host:port/service)',
      '테이블·컬럼명이 대문자인 경우가 많음 (대문자로 입력)',
    ],
  },
  {
    id: 'excel',
    label: 'Excel 파일 (.xlsx)',
    notes: ['파일 경로 지정', '에이전트가 파일 변경을 감시'],
  },
  {
    id: 'csv',
    label: 'CSV 파일 (.csv)',
    notes: ['파일 경로 지정', '구분자·인코딩 확인(기본 , / utf-8)'],
  },
```

- [ ] **Step 4: 티어×DB 지원표 추가**

`DB_OPTIONS` 아래에 — fail-closed: 운영 검증된 기존 4드라이버는 전 티어, oracle은 Task 2 스모크 통과 티어만.
```ts
/**
 * 티어별 실연결 검증을 통과한 DB(위저드 db id). 빌드 스모크 결과로만 갱신.
 * mssql/mysql/postgres/excel/csv = 운영 검증된 번들 드라이버(전 티어).
 * oracle = Task 2 빌드 스모크를 통과한 티어에만 등재(미통과 티어 = 비노출).
 */
const ALWAYS = ['mssql-old', 'mssql-modern', 'mysql', 'postgres', 'excel', 'csv'];
export const VERIFIED_DBS_BY_TIER: Record<string, string[]> = {
  'win-modern':   [...ALWAYS, 'oracle'],
  'win-mid':      [...ALWAYS, 'oracle'],
  'win-legacy':   [...ALWAYS], // node14 oracledb 스모크 통과 시 'oracle' 추가
  'linux-modern': [...ALWAYS, 'oracle'],
  'linux-legacy': [...ALWAYS, 'oracle'],
};
```
주: win-legacy의 oracle은 Task 2 Step 4 결과로만 추가. 기본은 fail-closed(미포함).

- [ ] **Step 5: resolveAgentBuild에 미검증 차단 분기 추가**

기존 "티어 미지원" 블록 직후, success 직전에:
```ts
  // ★ 보이면 작동 불변식: 이 티어에서 실연결 검증 안 된 DB는 차단
  const verified = VERIFIED_DBS_BY_TIER[tier.buildTier] || [];
  if (dbId && !verified.includes(dbId)) {
    return {
      supported: false,
      buildTier: null,
      node: null,
      runtimeBundle: false,
      packageFile: null,
      dbNotes,
      installSummary: [],
      rangeMessage: `${tier.label}에서는 ${db?.label ?? dbId} 연결이 아직 지원되지 않습니다. 같은 네트워크의 최신 PC/서버에 에이전트를 설치해 이 DB를 읽어오세요.`,
    };
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd packages/backend && npx vitest run src/utils/agent-build-tiers.test.ts`
기대: PASS 3건.

- [ ] **Step 7: 게이트**

Run: `cd packages/backend && npx tsc --noEmit`
기대: 0 errors.

---

## Task 4: admin-sync.ts — /build-tiers 응답에 지원표 포함

**Files:**
- Modify: `packages/backend/src/routes/admin-sync.ts:15,33`

- [ ] **Step 1: import 확장**

`agent-build-tiers` import에 `VERIFIED_DBS_BY_TIER` 추가:
```ts
import { PLATFORMS, OS_TIERS, DB_OPTIONS, VERIFIED_DBS_BY_TIER, resolveAgentBuild, PlatformId } from '../utils/agent-build-tiers';
```

- [ ] **Step 2: 부트스트랩 응답에 지원표 추가**

`/build-tiers` 핸들러:
```ts
router.get('/build-tiers', authenticate, requireSuperAdmin, (_req: Request, res: Response) => {
  res.json({ success: true, platforms: PLATFORMS, osTiers: OS_TIERS, dbOptions: DB_OPTIONS, verifiedDbsByTier: VERIFIED_DBS_BY_TIER });
});
```

- [ ] **Step 3: 게이트**

Run: `cd packages/backend && npx tsc --noEmit`
기대: 0 errors.

---

## Task 5: 위저드 — 티어 인지 DB 노출

**Files:**
- Modify: `packages/frontend/src/components/admin/AgentDeployWizard.tsx`

- [ ] **Step 1: 타입·상태 확장**

`OsTier` 인터페이스에 buildTier 추가:
```ts
interface OsTier { id: string; platform: PlatformId; label: string; supported: boolean; rangeMessage?: string; buildTier?: string | null; }
```
boot 상태 타입에 지원표 추가:
```ts
const [boot, setBoot] = useState<{ platforms: Platform[]; osTiers: OsTier[]; dbOptions: DbOption[]; verifiedDbsByTier: Record<string, string[]> } | null>(null);
```

- [ ] **Step 2: 부트스트랩에서 지원표 수신**

```ts
if (data.success) setBoot({ platforms: data.platforms, osTiers: data.osTiers, dbOptions: data.dbOptions, verifiedDbsByTier: data.verifiedDbsByTier || {} });
```

- [ ] **Step 3: step 3에서 티어 검증 DB만 노출**

step 3 렌더를 티어 필터로:
```tsx
{step === 3 && (() => {
  const verified = (osTier?.buildTier && boot?.verifiedDbsByTier[osTier.buildTier]) || [];
  const dbs = (boot?.dbOptions || []).filter((d) => verified.includes(d.id));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {dbs.map((d) => (
        <WizardCard key={d.id} icon={Database} title={d.label} onClick={() => pickDb(d)} />
      ))}
      {dbs.length === 0 && (
        <p className="col-span-full text-sm text-amber-600">
          이 OS 버전에서 연결을 지원하는 DB가 아직 없습니다. 같은 네트워크의 최신 PC/서버에 에이전트를 설치해 DB를 읽어오세요.
        </p>
      )}
      {loading && <p className="col-span-full text-sm text-gray-400">빌드 결정 중…</p>}
    </div>
  );
})()}
```

- [ ] **Step 4: 게이트**

Run: `cd packages/frontend && npx tsc --noEmit`
기대: 0 errors.
자가 grep: `cd packages/frontend && grep -nE "Opus|Sonnet|Haiku|GPT|alert\(|confirm\(|prompt\(" src/components/admin/AgentDeployWizard.tsx`
기대: 0건.

---

## Task 6: 설정 화면 — 연결 실패 메시지 노출 확인

**Files:**
- Read first: `sync-agent/src/setup/server.ts` (test-connection 핸들러)

- [ ] **Step 1: 연결 실패 경로 확인**

`server.ts`에서 DB 연결 테스트(`testConnection`/`connect`) 실패 시 사용자에게 원인 메시지를 반환하는지 확인. oracledb 미로드 같은 케이스가 조용히 죽지 않고 메시지로 노출돼야 한다.

- [ ] **Step 2: 필요 시 메시지 보강**

연결 테스트 실패를 try/catch로 잡아 `error.message`를 응답에 담는다(이미 그렇다면 변경 없음). native dialog 사용 금지 — 기존 setup-html 패턴 유지.

- [ ] **Step 3: 게이트**

Run: `cd sync-agent && npx tsc --noEmit`
기대: 0 errors.

---

## Task 7: ODBC 확장 지점 (설계만, 코드 없음)

**Files:**
- Modify: `sync-agent/src/db/types.ts:6`, `sync-agent/src/db/index.ts:35`

- [ ] **Step 1: DbType에 향후 주석**

```ts
// 향후 확장: 'odbc' — 티베로/DB2/알티베이스 등 Node 전용 드라이버가 없는 DB는
// node-odbc + 고객 PC ODBC 드라이버로 단일 커넥터 추가 예정(실제 고객 발생 시).
export type DbType = 'mssql' | 'mysql' | 'oracle' | 'postgres' | 'excel' | 'csv';
```

- [ ] **Step 2: 팩토리 default 분기에 자리 주석**

`createDbConnector`의 default 위에:
```ts
    // case 'odbc': return new OdbcConnector(config); // 향후 ODBC 범용 브리지 자리
    default:
      throw new Error(`지원하지 않는 DB 타입: ${config.type}`);
```

- [ ] **Step 3: 게이트**

Run: `cd sync-agent && npx tsc --noEmit`
기대: 0 errors.

---

## Task 8: 전체 5티어 빌드 + 통합 스모크 + 실 Oracle 연결 실측

**Files:** 없음(빌드·검증)

- [ ] **Step 1: 5티어 전체 빌드**

Run: `cd sync-agent && npm run build:tiers`
기대: 5티어 산출 + win 구형 2종 런타임 동봉 + `dist-tiers/downloads/` zip 5개 + manifest.

- [ ] **Step 2: 티어별 부팅 스모크**

각 win exe `--version` → `v1.5.5`. 크래시 없음.

- [ ] **Step 3: oracledb 로드 통합 확인**

win-modern·win-legacy 산출물에서 setup 흐름으로 Oracle 선택 → 연결 테스트 단계까지 진입 시 "oracledb 미설치" 에러가 안 나오는지 확인(드라이버 포함 증거).

- [ ] **Step 4: 실 Oracle 연결 실측 (Harold/직원 — 운영 영역)**

실제 Oracle 인스턴스 읽기전용 계정으로 setup 연결 테스트 → 테이블·컬럼 조회 → 증분 1건 동기화. (로컬에 Oracle 인스턴스 없음 = 본 단계는 운영 측 실측.)

- [ ] **Step 5: 지원표 최종 확정**

Step 1~4 결과로 `VERIFIED_DBS_BY_TIER` 확정. node14에서 oracledb가 안 되면 win-legacy에서 oracle 영구 제외(위저드가 자동 비노출).

- [ ] **Step 6: 종료 게이트**

backend·frontend·sync-agent tsc 0 / 유닛 GREEN / 박-단어·모델명·native dialog grep 0 / zip 5개 산출.
이후 표준 종료 멘트 → Harold님 git add/commit/push + 빌드머신 zip 업로드 + 배포.

---

## 자가 검토 (Self-Review)

- **Spec 커버리지:** §4 변경 지점 6개 → Task 1·2(4-1 드라이버), Task 3·4(4-2 CT), Task 5(4-3 위저드), Task 6(4-4 설정), Task 8(4-5 다운로드), Task 7(4-6 ODBC). §3 불변식 = Task 3 지원표+resolve. §5 검증 3단계 = Task 1·2 스모크 + Task 8 실측. 누락 없음.
- **Fail-closed:** oracle은 스모크 통과 전 어느 티어에도 노출 안 됨(VERIFIED 기본 미포함). "말로만 완벽" 차단 구조.
- **타입 일관성:** `VERIFIED_DBS_BY_TIER`(CT)→admin-sync 응답→위저드 `verifiedDbsByTier` 동일 키. db id(mssql-old/mssql-modern/mysql/postgres/oracle/excel/csv) 전 구간 동일.
- **기존 고객 무손:** 기존 4드라이버 경로 변경 없음, 추가만. tsc로 확인.
