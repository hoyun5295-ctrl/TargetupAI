# 싱크에이전트 OS×DB 전담 빌드 — 구현 계획

> **For agentic workers:** 실행은 단계별 tsc/빌드 검증. 스펙 = `docs/superpowers/specs/2026-06-24-sync-agent-os-db-matrix-v2.md`.

**Goal:** 싱크에이전트를 (OS시대 × DB버전) 전담 패키지로 내보내고, 슈퍼관리자 배포 위저드가 그 조합을 정확히 매핑·다운로드하게 한다. 거짓 VERIFIED·빌드 누락 0.

**Architecture (정정 확정):**
- **exe = 5개** (buildTier별: win-legacy node12 / win-mid node16-win / win-modern node20-win / linux-legacy node16-linux / linux-modern node20-linux). 각 exe는 4종 드라이버를 그 node-안전 버전으로 핀 + db/index.ts 지연 require(이미 적용) → 교차 사망 불가. es-check es2019 빌드 가드가 위험 버전 유입을 빌드 타임 차단.
- **다운로드 zip = (buildTier × driver)** = `sync-agent-<buildTier>-<driver>.zip` (oracle/mssql/mysql/pg). DB **버전** 커버는 zip 수를 늘리지 않고 `resolveAgentBuild(OS, dbId)`의 **state**(candidate/blocked) + 연결 프로파일로 처리.
- **state 모델**: `agent-build-tiers.ts`가 단일 진실원. verified(실스모크 로그)만 위저드 노출. 그 전엔 candidate(빌드는 되나 노출 X) / blocked(구조적 불가).
- **Oracle IC**: 디스크에 없음(procurement-blocked). oracle zip은 IC 드롭인 자리를 두고, manifest가 `blocker: IC`로 표기. IC 확보 후 zip에 폴더만 추가.

**Tech:** Node.js, esbuild, vercel/pkg@5.8.1(legacy)·@yao-pkg/pkg(modern), es-check, Express, React.

---

## 계약(Contract) — 양쪽이 합의하는 키

- `buildTier` ∈ `win-legacy | win-mid | win-modern | linux-legacy | linux-modern` (5). exe = `release/sync-agent-<buildTier>(-<driver>)`.
- `driver` ∈ `oracle | mssql | mysql | pg`.
- `packageKey` = `<buildTier>-<driver>`. zip = `sync-agent-<packageKey>.zip`. 엔드포인트가 그 파일만 서빙.
- `dbId`(위저드 선택, 버전 인지): `mssql-2008 | mssql-modern | oracle-10g | oracle-11g | oracle-12c | oracle-19c | mysql | postgres`.
- `resolveAgentBuild(platform, osTierId, dbId)` → `{ packageKey, state, mode, nativeClient, connectionProfile, dbNotes, installSummary }`.
  - state=blocked 예: win-modern/linux-modern × mssql-2008(OpenSSL3) · win-legacy × oracle-19c가 thin 불가+IC19 미동봉.
  - mode: oracle만 thick/thin. 나머지 na.

---

## 작업 순서 (4 컴포넌트, 각 검증)

### T1. 백엔드 CT — `packages/backend/src/utils/agent-build-tiers.ts`
- state 타입(`BuildState`) + OS_TIERS(win-2012-nonr2 experimental 추가, state 부여) + DB_OPTIONS(버전 인지) + DRIVER_OF(dbId→driver) + VERIFIED_PACKAGES(빈 배열로 시작, 스모크 후 채움) + resolveAgentBuild 재작성(packageKey/state/profile 반환).
- 검증: `agent-build-tiers.sanity.ts` 갱신(2008R2×oracle-11g→win-legacy-oracle/candidate, win-modern×mssql-2008→blocked, linux-legacy×postgres→linux-legacy-pg/candidate) → `npx ts-node` 통과. backend `tsc --noEmit` 0.

### T2. 백엔드 엔드포인트 — `packages/backend/src/routes/admin-sync.ts`
- `/build-tiers` 부트스트랩이 dbOptions(버전), verifiedPackages 반환. `/resolve`는 그대로(resolveAgentBuild). `/download/:packageKey`로 변경(검증: OS_TIERS의 buildTier×driver 조합만 허용) → `sync-agent-<packageKey>.zip`.
- 검증: backend `tsc --noEmit` 0.

### T3. 프론트 위저드 — `packages/frontend/src/components/admin/AgentDeployWizard.tsx`
- DB 선택을 버전 인지 옵션으로 + result.state=blocked면 rangeMessage 표시(다운로드 숨김), candidate면 "아직 검증 전" 안내, verified면 다운로드 노출. download(packageKey).
- 검증: frontend `tsc --noEmit` 0 + 박-단어/모델명/native dialog grep 0.

### T4. 빌드 스크립트 + 실빌드 — `sync-agent/scripts/*`
- `build-tier.js`: win-legacy deps에 `lru-cache@7.18.3` 추가(mysql2 고정). 빌드 후 `es-check es2019 dist/bundle.js`(legacy 티어) 가드.
- `build-tiers.js`: zip을 `sync-agent-<buildTier>-<driver>.zip`로 (driver별 동일 exe + INSTALL bat + [oracle은 IC 자리]) + manifest에 packageKey/state/blocker.
- 실빌드: 5 exe + pure-JS zip(mssql/mysql/pg 15개) 로컬 빌드. oracle zip은 IC 자리 비움 + manifest blocker. 검증: 산출물 존재 + manifest 확인.

---

## 제 손 밖 (거짓 완료 방지)
- Oracle Instant Client 바이너리 확보(§9) — 디스크 없음. oracle thick 패키지 완성은 IC 확보 후.
- `upload:agents`(scp) — 주인님 PowerShell.
- state=verified 승격 — VM/DB 실스모크(주인님 환경).
