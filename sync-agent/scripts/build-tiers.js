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

const packages = {};
let zipCount = 0;
for (const [tier, src] of Object.entries(TIER_SRC)) {
  for (const driver of DRIVERS) {
    const packageKey = `${tier}-${driver}`;
    zipTo(src, packageKey);
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
