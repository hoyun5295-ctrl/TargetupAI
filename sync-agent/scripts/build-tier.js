// scripts/build-tier.js — 티어 1개 빌드
// 사용: node scripts/build-tier.js <tierId>
//   tierId: win-modern | win-mid | win-legacy | linux-modern | linux-legacy
// 룰표(백엔드 utils/agent-build-tiers.ts)의 buildTier id와 1:1.
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

const TIERS = {
  'win-modern':   { node: 'node20', pkg: 'node20-win-x64',   out: 'release/sync-agent-win-modern.exe',   legacy: false },
  'win-mid':      { node: 'node16', pkg: 'node16-win-x64',   out: 'release/sync-agent-win-mid.exe',       legacy: true },
  'win-legacy':   { node: 'node14', pkg: 'node14-win-x64',   out: 'release/sync-agent-win-legacy.exe',    legacy: true },
  'linux-modern': { node: 'node20', pkg: 'node20-linux-x64', out: 'release/sync-agent-linux-modern',      legacy: false },
  'linux-legacy': { node: 'node16', pkg: 'node16-linux-x64', out: 'release/sync-agent-linux-legacy',      legacy: true },
};

const tierId = process.argv[2];
const t = TIERS[tierId];
if (!t) {
  console.error('알 수 없는 tier:', tierId, '\n사용 가능:', Object.keys(TIERS).join(', '));
  process.exit(1);
}

console.log(`\n=== build tier ${tierId} (${t.node}) ===`);
try {
  // 레거시 티어: 구형 node에 맞는 의존성으로 임시 다운(express4/mssql10), 빌드 후 원복
  if (t.legacy) sh('npm i express@4.22.2 mssql@10.0.4 --no-save');
  sh(`node esbuild.config.js --target=${t.node}`);
  sh('npm run prebundle:wasm');
  // modern = @yao-pkg/pkg, legacy = vercel/pkg@5.8.1 (node16/14 prelude 버그 우회)
  const pkgCmd = t.legacy ? 'npx -y pkg@5.8.1' : 'npx -y @yao-pkg/pkg';
  sh(`${pkgCmd} dist/bundle.js --targets ${t.pkg} --output ${t.out}`);
} finally {
  if (t.legacy) sh('npm ci'); // 의존성 원복 (메인 node20 빌드 무손)
}
console.log(`완료: ${t.out}`);
