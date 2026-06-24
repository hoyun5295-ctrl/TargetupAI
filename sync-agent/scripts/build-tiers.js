// scripts/build-tiers.js — 전체 티어 빌드 + Windows 구형 런타임 동봉 + manifest
// 사용: node scripts/build-tiers.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const sh = (c) => execSync(c, { cwd: ROOT, stdio: 'inherit' });

const TIERS = ['win-modern', 'win-mid', 'win-legacy', 'linux-modern', 'linux-legacy'];
// Windows 구형 티어 = exe 옆에 런타임 동봉 폴더 생성
const WIN_BUNDLE = {
  'win-mid': 'release/sync-agent-win-mid.exe',
  'win-legacy': 'release/sync-agent-win-legacy.exe',
};

for (const t of TIERS) sh(`node scripts/build-tier.js ${t}`);

for (const [tier, exe] of Object.entries(WIN_BUNDLE)) {
  sh(`node scripts/bundle-windows-runtime.js ${exe} dist-tiers/${tier}/SyncAgent`);
}
// win-modern도 폴더+bat 구조로 통일(런타임 DLL 불필요 → --no-runtime). 설치 안내(bat 실행)와 일치.
sh(`node scripts/bundle-windows-runtime.js release/sync-agent-win-modern.exe dist-tiers/win-modern/SyncAgent --no-runtime`);

// 다운로드용 zip — packageKey(`<buildTier>-<driver>`)당 1개. 같은 티어 exe(4종 드라이버 동봉)를
// 드라이버별 이름으로 zip(엔드포인트가 packageKey로 서빙). Oracle thick(10g/11g/12c)은 Instant Client
// 동봉이 필요한데(외부 확보) 디스크에 없으므로 지금은 base만 + manifest blocker. IC 확보 시 oracle zip에 폴더 추가.
const DRIVERS = ['oracle', 'mssql', 'mysql', 'pg'];
// win-legacy oracle(thick) 전용 Instant Client 11.2 스테이징(호스트 추출본, 약 290M). 없으면 동봉 skip(candidate 유지).
const IC_STAGE = 'C:/Users/ceo/oracle-client-11.2-stage';
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
if (fs.existsSync(stagedOra)) {
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
if (fs.existsSync(stagedWasm)) {
  fs.copyFileSync(stagedWasm, wlWasm);
  console.log('win-legacy SyncAgent sql-wasm.wasm = node12 호환 동봉:', fs.statSync(wlWasm).size, 'bytes');
} else {
  console.warn('경고: staged sql-wasm.wasm 없음 — win-legacy wasm node12 비호환 위험. build-tier.js win-legacy 확인.');
}

const packages = {};
let zipCount = 0;
for (const [tier, src] of Object.entries(TIER_SRC)) {
  for (const driver of DRIVERS) {
    const packageKey = `${tier}-${driver}`;
    // win-legacy oracle = thick → Instant Client 동봉(290M). 다른 tier/driver는 thin 또는 비-oracle이라 불필요.
    const needIC = tier === 'win-legacy' && driver === 'oracle';
    const icDest = path.join(ROOT, src, 'oracle-client');
    if (needIC) {
      if (fs.existsSync(IC_STAGE)) {
        fs.rmSync(icDest, { recursive: true, force: true });
        fs.cpSync(IC_STAGE, icDest, { recursive: true });
        console.log('win-legacy oracle zip에 Instant Client 동봉:', IC_STAGE);
      } else {
        console.warn('경고: IC_STAGE 없음 (' + IC_STAGE + ') — win-legacy oracle zip에 클라 미동봉(고객 thick 연결 불가).');
      }
    }
    zipTo(src, packageKey);
    if (needIC && fs.existsSync(icDest)) fs.rmSync(icDest, { recursive: true, force: true }); // 다른 driver zip 전 제거
    zipCount++;
    packages[packageKey] = {
      buildTier: tier,
      driver,
      node: TIER_NODE[tier],
      runtimeBundle: TIER_BUNDLE[tier],
      // 실연결 스모크 통과 시 백엔드 VERIFIED_COMBOS(osTierId__dbId)에 등록 → 위저드 verified 노출.
      state: 'candidate',
      blockers:
        driver === 'oracle'
          ? ['thick(10g/11g/12c)는 Oracle Instant Client 동봉 필요 — 외부 확보 후 이 zip에 IC 폴더 추가']
          : [],
    };
  }
}
console.log(`다운로드 zip 생성: ${dlDir} (sync-agent-<buildTier>-<driver>.zip ${zipCount}개)`);

const manifest = {
  builtAt: new Date().toISOString(),
  version: require('../package.json').version,
  packages,
};
fs.writeFileSync(path.join(ROOT, 'release/build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest 생성: release/build-manifest.json (packageKey별 state/blocker)');
