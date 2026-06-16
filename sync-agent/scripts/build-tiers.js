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

// manifest: 티어 -> 파일/폴더 · node · sha(단일파일만) · 빌드시각
const sha = (rel) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);

const manifest = {
  builtAt: new Date().toISOString(),
  version: require('../package.json').version,
  tiers: {
    'win-modern': { file: 'release/sync-agent-win-modern.exe', node: 20, sha: sha('release/sync-agent-win-modern.exe') },
    'win-mid': { dir: 'dist-tiers/win-mid/SyncAgent', node: 16, runtimeBundle: true },
    'win-legacy': { dir: 'dist-tiers/win-legacy/SyncAgent', node: 14, runtimeBundle: true },
    'linux-modern': { file: 'release/sync-agent-linux-modern', node: 20, sha: sha('release/sync-agent-linux-modern') },
    'linux-legacy': { file: 'release/sync-agent-linux-legacy', node: 16, sha: sha('release/sync-agent-linux-legacy') },
  },
};
fs.writeFileSync(path.join(ROOT, 'release/build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest 생성: release/build-manifest.json');
