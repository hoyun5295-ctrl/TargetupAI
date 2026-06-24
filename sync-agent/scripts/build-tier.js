// scripts/build-tier.js — 티어 1개 빌드
// 사용: node scripts/build-tier.js <tierId>
//   tierId: win-modern | win-mid | win-legacy | linux-modern | linux-legacy
// 룰표(백엔드 utils/agent-build-tiers.ts)의 buildTier id와 1:1.
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit' });

// 티어 정의 — OS 바닥 / node / pkg 타깃 / 구형 런타임 동봉(legacy) / 레거시 의존성 핀(deps).
//   node 바닥: node20=Win10·2016·glibc2.28 / node16=Win8.1·2012R2·glibc2.17 / node12=Win7·2008R2·2012(비R2).
//   deps = 메인(express5/mssql11/oracledb6 thin)을 그 node가 받는 버전으로 내린 핀(modern=null=메인 그대로).
//     node12: oracledb 5.x thick(thin은 6.0+/node14.6+ 불가, 11g도 thick 필요) +
//             mssql 8.1.4(9.0이 node10/12 제거·??문법) + mysql2 3.2.0(3.2.1부터 node12 깨짐) +
//             pg 8.7.3(node12 시절) + nodemailer6. DB 4종 모두 node12 파싱 가능해야 함.
//     node16: mssql10(node14+) — oracledb는 메인 6.x thin 유지(node14.6+ OK).
const TIERS = {
  'win-modern':   { node: 'node20', pkg: 'node20-win-x64',   out: 'release/sync-agent-win-modern.exe',   legacy: false, deps: null },
  'win-mid':      { node: 'node16', pkg: 'node16-win-x64',   out: 'release/sync-agent-win-mid.exe',       legacy: true,  deps: 'express@4.22.2 mssql@10.0.4 tedious@16.7.1' },
  'win-legacy':   { node: 'node12', pkg: 'node12-win-x64',   out: 'release/sync-agent-win-legacy.exe',    legacy: true,  deps: 'express@4.22.2 mssql@8.1.4 tedious@14.7.0 mysql2@3.2.0 lru-cache@7.18.3 pg@8.7.3 oracledb@5.5.0 nodemailer@6.9.16' },
  'linux-modern': { node: 'node20', pkg: 'node20-linux-x64', out: 'release/sync-agent-linux-modern',      legacy: false, deps: null },
  'linux-legacy': { node: 'node16', pkg: 'node16-linux-x64', out: 'release/sync-agent-linux-legacy',      legacy: true,  deps: 'express@4.22.2 mssql@10.0.4 tedious@16.7.1' },
};

const tierId = process.argv[2];
const t = TIERS[tierId];
if (!t) {
  console.error('알 수 없는 tier:', tierId, '\n사용 가능:', Object.keys(TIERS).join(', '));
  process.exit(1);
}

console.log(`\n=== build tier ${tierId} (${t.node}) ===`);
try {
  // 레거시 티어: 그 node가 받는 의존성 핀(t.deps)으로 임시 다운, 빌드 후 npm ci로 원복(메인 node20 무손).
  if (t.legacy && t.deps) sh(`npm i ${t.deps} --no-save`);
  sh(`node esbuild.config.js --target=${t.node}`);
  sh('npm run prebundle:wasm');
  // ★ node12 안전 가드(GPT 제안) — 드라이버는 esbuild external이라 bundle.js가 아니라
  //   node_modules에서 raw로 pkg에 동봉된다. node12가 못 파싱하는 ??/?./#private이 그 raw에 있으면
  //   --setup이 SyntaxError로 죽는다(원래 사고 클래스). 핀이 미래에 위험 버전으로 바뀌면 빌드 실패로 차단.
  if (tierId === 'win-legacy') {
    const guard = [
      'node_modules/tedious/lib/**/*.js',
      'node_modules/mysql2/lib/**/*.js',
      'node_modules/lru-cache/index.js',
      'node_modules/pg/lib/**/*.js',
    ].map((g) => `"${g}"`).join(' ');
    sh(`npx -y es-check es2019 ${guard}`);
  }
  // modern = @yao-pkg/pkg, legacy = vercel/pkg@5.8.1 (node16/14 prelude 버그 우회)
  const pkgCmd = t.legacy ? 'npx -y pkg@5.8.1' : 'npx -y @yao-pkg/pkg';
  sh(`${pkgCmd} dist/bundle.js --targets ${t.pkg} --output ${t.out}`);
} finally {
  if (t.legacy) sh('npm ci'); // 의존성 원복 (메인 node20 빌드 무손)
}
console.log(`완료: ${t.out}`);
