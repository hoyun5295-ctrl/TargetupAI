// scripts/build-tiers.js — 전체 티어 빌드 + Windows 구형 런타임 동봉 + manifest
// 사용: node scripts/build-tiers.js [--tiers win-modern,win-mid]
//   --tiers 를 주면 그 티어만 빌드·포장하고 manifest 는 기존 파일에 병합한다(고객사 조합 하나만 다시 낼 때 · 2026-10-14).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const sh = (c) => execSync(c, { cwd: ROOT, stdio: 'inherit' });

const ALL_TIERS = ['win-modern', 'win-mid', 'win-legacy', 'linux-modern', 'linux-legacy'];
const tiersFlag = process.argv.includes('--tiers') || process.argv.some((a) => a.startsWith('--tiers='));
const tiersArg = process.argv.find((a) => a.startsWith('--tiers='))?.slice('--tiers='.length)
  ?? (process.argv.includes('--tiers') ? process.argv[process.argv.indexOf('--tiers') + 1] : null);
const TIERS = tiersArg ? tiersArg.split(',').map((t) => t.trim()).filter(Boolean) : ALL_TIERS;
// --tiers 를 적었는데 값이 비면(마지막 인자 · 빈 문자열) 조용히 전체 빌드로 가지 않는다
if (tiersFlag && TIERS.length === 0 || (tiersFlag && !tiersArg)) { console.error('--tiers 값이 비었습니다. 예: --tiers win-modern,win-mid'); process.exit(1); }
const unknown = TIERS.filter((t) => !ALL_TIERS.includes(t));
if (unknown.length) { console.error('알 수 없는 tier:', unknown.join(','), '\n사용 가능:', ALL_TIERS.join(', ')); process.exit(1); }
const want = (t) => TIERS.includes(t);
// Windows 구형 티어 = exe 옆에 런타임 동봉 폴더 생성
const WIN_BUNDLE = {
  'win-mid': 'release/sync-agent-win-mid.exe',
  'win-legacy': 'release/sync-agent-win-legacy.exe',
};

for (const t of TIERS) sh(`node scripts/build-tier.js ${t}`);

for (const [tier, exe] of Object.entries(WIN_BUNDLE)) {
  if (want(tier)) sh(`node scripts/bundle-windows-runtime.js ${exe} dist-tiers/${tier}/SyncAgent`);
}
// win-modern도 폴더+bat 구조로 통일(런타임 DLL 불필요 → --no-runtime). 설치 안내(bat 실행)와 일치.
if (want('win-modern')) sh(`node scripts/bundle-windows-runtime.js release/sync-agent-win-modern.exe dist-tiers/win-modern/SyncAgent --no-runtime`);

// 다운로드용 zip — packageKey(`<buildTier>-<driver>`)당 1개. 같은 티어 exe(4종 드라이버 동봉)를
// 드라이버별 이름으로 zip(엔드포인트가 packageKey로 서빙).
// ★ 2026-10-14 Oracle zip 동봉 규칙(엠티콜렉션 = Oracle 11g × Windows 2016):
//   · Oracle 10g·11g는 thick 전용(oracledb 6.x thin = DB 12.1+만) → Windows 티어의 oracle zip **전부**에 Instant Client 11.2 를 동봉한다
//     (옛: win-legacy 만 → win-modern zip 을 11g 고객에 보내면 접속 불가였다).
//   · thick 은 네이티브 바인딩(.node)이 필요한데 pkg 스냅샷에서 .node 로드는 보증이 없다(win-legacy NJS-045 선례) →
//     win-modern·win-mid 도 exe 옆 `oracledb/` 실폴더(설치된 6.x · win32-x64 .node 만)를 함께 동봉한다. oracle.ts 가 그 폴더를 1순위로 로드한다.
//   · Linux 티어는 IC(리눅스용)가 스테이징돼 있지 않아 thin(12.1+)만 — manifest blocker 로 남긴다.
const DRIVERS = ['oracle', 'mssql', 'mysql', 'pg'];
// Oracle thick 전용 Instant Client 11.2 스테이징(호스트 추출본, 약 290M). 없으면 동봉 skip(candidate 유지).
const IC_STAGE = 'C:/Users/ceo/oracle-client-11.2-stage';
const WIN_TIERS_WITH_IC = ['win-modern', 'win-mid', 'win-legacy'];
// ★ IC 11.2 의 dll 269개(oci.dll 포함)는 Microsoft.VC80.CRT 8.0.50727.762 를 요구한다(oci.dll 매니페스트 실측 2026-10-14).
//   Windows Server 2016 은 VC++ 2005 런타임이 없어 클라 로드부터 실패한다(Codex 1R high) → 공식 재배포판(vcredist_x64.exe · VC++ 2005 SP1 x64)을
//   스테이징에 두면 oracle zip 의 oracle-client/ 에 함께 싣고, 설치 bat 가 WinSxS 에 VC80 CRT 가 없을 때 /q 로 설치한다. 없으면 blocker.
const VCREDIST_2005 = path.join(IC_STAGE, 'vcredist_x64.exe');
// win-modern·win-mid 용 oracledb 사이드카(설치된 6.x). win-legacy 는 build-tier.js 가 5.5.0 을 따로 스테이징한다.
const ORACLEDB_SRC = path.join(ROOT, 'node_modules/oracledb');
function stageOracledbSidecar(dest) {
  if (!fs.existsSync(path.join(ORACLEDB_SRC, 'package.json'))) return false;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(ORACLEDB_SRC, dest, { recursive: true });
  const rel = path.join(dest, 'build/Release');
  for (const f of fs.readdirSync(rel)) {
    if (/\.node(-buildinfo\.txt)?$/.test(f) && !f.includes('win32-x64')) fs.rmSync(path.join(rel, f), { force: true });
  }
  for (const d of ['examples', 'package']) fs.rmSync(path.join(dest, d), { recursive: true, force: true });
  return fs.readdirSync(rel).some((f) => /win32-x64\.node$/.test(f));
}
const TIER_SRC = {
  'win-modern': 'dist-tiers/win-modern/SyncAgent',
  'win-mid': 'dist-tiers/win-mid/SyncAgent',
  'win-legacy': 'dist-tiers/win-legacy/SyncAgent',
  'linux-modern': 'release/sync-agent-linux-modern',
  'linux-legacy': 'release/sync-agent-linux-legacy',
};
const TIER_NODE = { 'win-modern': 20, 'win-mid': 16, 'win-legacy': 12, 'linux-modern': 20, 'linux-legacy': 16 };
const TIER_BUNDLE = { 'win-modern': false, 'win-mid': true, 'win-legacy': true, 'linux-modern': false, 'linux-legacy': false };

const dlDir = path.join(ROOT, 'dist-tiers/downloads');
fs.mkdirSync(dlDir, { recursive: true });
const zipTo = (srcRel, packageKey) => {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(dlDir, `sync-agent-${packageKey}.zip`);
  sh(`powershell -NoProfile -Command "Compress-Archive -Path '${src}' -DestinationPath '${dest}' -Force"`);
};

// ★ win-legacy SyncAgent에 외부 oracledb 모듈 동봉(build-tier.js가 5.5.0 설치 중 스테이징한 분).
//   pkg@5.8.1이 .node를 exe 스냅샷에 못 실어 NJS-045 → exe 옆 실폴더에서 로드하도록 함(oracle.ts가 감지).
const stagedOra = path.join(ROOT, 'release/staged-modules/win-legacy/oracledb');
const wlOra = path.join(ROOT, 'dist-tiers/win-legacy/SyncAgent/oracledb');
if (!want('win-legacy')) {
  // --tiers 로 win-legacy 를 뺀 빌드에서는 스테이징 경고를 내지 않는다(그 티어를 안 만들었다)
} else if (fs.existsSync(stagedOra)) {
  fs.rmSync(wlOra, { recursive: true, force: true });
  fs.cpSync(stagedOra, wlOra, { recursive: true });
  console.log('win-legacy SyncAgent에 oracledb 외부 모듈 동봉:', wlOra);
} else {
  console.warn('경고: staged oracledb 없음 — win-legacy oracle 연결 불가(스테이징 누락). build-tier.js win-legacy 확인.');
}

// ★ win-legacy sql-wasm.wasm을 node12 호환(1.8.0)으로 교체 — bundle-windows-runtime이 깐 공유 1.13.0 위에 덮어씀.
//   1.13.0 wasm은 node12에서 'wasm function signature contains illegal type'로 QueueManager.init 사망.
const stagedWasm = path.join(ROOT, 'release/staged-modules/win-legacy/sql-wasm.wasm');
const wlWasm = path.join(ROOT, 'dist-tiers/win-legacy/SyncAgent/sql-wasm.wasm');
if (!want('win-legacy')) {
  // 위와 같다
} else if (fs.existsSync(stagedWasm)) {
  fs.copyFileSync(stagedWasm, wlWasm);
  console.log('win-legacy SyncAgent sql-wasm.wasm = node12 호환 동봉:', fs.statSync(wlWasm).size, 'bytes');
} else {
  console.warn('경고: staged sql-wasm.wasm 없음 — win-legacy wasm node12 비호환 위험. build-tier.js win-legacy 확인.');
}

const packages = {};
let zipCount = 0;
for (const [tier, src] of Object.entries(TIER_SRC)) {
  if (!want(tier)) continue;
  for (const driver of DRIVERS) {
    const packageKey = `${tier}-${driver}`;
    // Windows oracle zip = thick → Instant Client 동봉(290M) + (modern·mid) oracledb 사이드카. 그 밖은 thin 또는 비-oracle이라 불필요.
    const needIC = driver === 'oracle' && WIN_TIERS_WITH_IC.includes(tier);
    const needSidecar = driver === 'oracle' && (tier === 'win-modern' || tier === 'win-mid');
    const icDest = path.join(ROOT, src, 'oracle-client');
    const sidecarDest = path.join(ROOT, src, 'oracledb');
    const blockers = [];
    if (needIC) {
      if (fs.existsSync(IC_STAGE)) {
        fs.rmSync(icDest, { recursive: true, force: true });
        fs.cpSync(IC_STAGE, icDest, { recursive: true });
        console.log(`${tier} oracle zip에 Instant Client 동봉:`, IC_STAGE);
        if (!fs.existsSync(VCREDIST_2005)) {
          console.warn('경고: ' + VCREDIST_2005 + ' 없음 — oci.dll 이 요구하는 VC++ 2005 x64 런타임을 동봉하지 못한다(런타임 없는 Server 2016 에서 클라 로드 실패).');
          blockers.push('VC++ 2005 SP1 x64 런타임(vcredist_x64.exe) 미동봉 — Microsoft.VC80.CRT 8.0.50727.762 없는 서버에서 oci.dll 로드 실패');
        }
      } else {
        console.warn('경고: IC_STAGE 없음 (' + IC_STAGE + ') — ' + tier + ' oracle zip에 클라 미동봉(고객 thick 연결 불가).');
        blockers.push('Instant Client 11.2 미동봉(IC_STAGE 없음) — 10g·11g thick 접속 불가');
      }
    }
    if (needSidecar) {
      if (stageOracledbSidecar(sidecarDest)) console.log(`${tier} oracle zip에 oracledb 사이드카 동봉:`, sidecarDest);
      else { console.warn('경고: oracledb 사이드카 스테이징 실패 — node_modules/oracledb(win32-x64 .node) 확인.'); blockers.push('oracledb 사이드카 미동봉'); }
    }
    if (driver === 'oracle' && !WIN_TIERS_WITH_IC.includes(tier)) blockers.push('Linux Instant Client 미동봉 — 12.1+ thin 만 가능(10g·11g 불가)');
    zipTo(src, packageKey);
    if (needIC && fs.existsSync(icDest)) fs.rmSync(icDest, { recursive: true, force: true }); // 다른 driver zip 전 제거
    if (needSidecar && fs.existsSync(sidecarDest)) fs.rmSync(sidecarDest, { recursive: true, force: true });
    zipCount++;
    packages[packageKey] = {
      buildTier: tier,
      driver,
      node: TIER_NODE[tier],
      runtimeBundle: TIER_BUNDLE[tier],
      // 실연결 스모크 통과 시 백엔드 VERIFIED_COMBOS(osTierId__dbId)에 등록 → 위저드 verified 노출.
      state: 'candidate',
      blockers,
    };
  }
}
console.log(`다운로드 zip 생성: ${dlDir} (sync-agent-<buildTier>-<driver>.zip ${zipCount}개)`);

// manifest — 일부 티어만 빌드했으면 기존 manifest 의 나머지 packageKey 를 유지한다(없으면 새로).
const manifestPath = path.join(ROOT, 'release/build-manifest.json');
let prevPackages = {};
if (tiersArg && fs.existsSync(manifestPath)) {
  try { prevPackages = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).packages || {}; } catch { prevPackages = {}; }
}
const manifest = {
  builtAt: new Date().toISOString(),
  version: require('../package.json').version,
  builtTiers: TIERS,
  packages: { ...prevPackages, ...packages },
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('\nmanifest 생성: release/build-manifest.json (packageKey별 state/blocker)');
