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

// 다운로드용 zip (티어당 1개) — 서버 agent-builds/ 에 업로드하면 위저드 다운로드가 서빙
const dlDir = path.join(ROOT, 'dist-tiers/downloads');
fs.mkdirSync(dlDir, { recursive: true });
const zipOne = (srcRel, tier) => {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(dlDir, `sync-agent-${tier}.zip`);
  sh(`powershell -NoProfile -Command "Compress-Archive -Path '${src}' -DestinationPath '${dest}' -Force"`);
};
zipOne('dist-tiers/win-modern/SyncAgent', 'win-modern');
zipOne('dist-tiers/win-mid/SyncAgent', 'win-mid');
zipOne('dist-tiers/win-legacy/SyncAgent', 'win-legacy');
zipOne('release/sync-agent-linux-modern', 'linux-modern');
zipOne('release/sync-agent-linux-legacy', 'linux-legacy');
console.log(`다운로드 zip 생성: ${dlDir} (sync-agent-<tier>.zip 5개)`);

// manifest: 티어 -> 파일/폴더 · node · sha(단일파일만) · 빌드시각
const sha = (rel) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

const manifest = {
  builtAt: new Date().toISOString(),
  version: require('../package.json').version,
  tiers: {
    'win-modern': { dir: 'dist-tiers/win-modern/SyncAgent', node: 20, runtimeBundle: false },
    'win-mid': { dir: 'dist-tiers/win-mid/SyncAgent', node: 16, runtimeBundle: true },
    'win-legacy': { dir: 'dist-tiers/win-legacy/SyncAgent', node: 12, runtimeBundle: true },
    'linux-modern': { file: 'release/sync-agent-linux-modern', node: 20, sha: sha('release/sync-agent-linux-modern') },
    'linux-legacy': { file: 'release/sync-agent-linux-legacy', node: 16, sha: sha('release/sync-agent-linux-legacy') },
  },
};
fs.writeFileSync(path.join(ROOT, 'release/build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest 생성: release/build-manifest.json');
