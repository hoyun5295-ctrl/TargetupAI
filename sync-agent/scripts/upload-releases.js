// scripts/upload-releases.js — 자동 업데이트용 5티어 exe를 서버 agent-releases/ 로 업로드(scp).
// 사용: npm run upload:releases   (먼저 npm run build:tiers 로 release/ 산출물 필요)
// 서버 /api/sync/download/<version>-<tier> 가 sync-agent-<version>-<tier>.exe 를 서빙하므로 그 이름으로 올린다.
// 인증 = 시스템 SSH 설정(키 있으면 무인증). 서버 정보 ENV override 가능.
//   AGENT_UPLOAD_HOST         (기본 administrator@58.227.193.62)
//   AGENT_RELEASES_DIR_REMOTE (기본 /home/administrator/targetup-app/packages/backend/agent-releases/)
// ★ AI가 직접 실행하지 않는다 — Harold 본인 PowerShell에서 실행(upload:agents와 동일).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const HOST = process.env.AGENT_UPLOAD_HOST || 'administrator@58.227.193.62';
const DEST = process.env.AGENT_RELEASES_DIR_REMOTE || '/home/administrator/targetup-app/packages/backend/agent-releases/';

// 티어 → 로컬 빌드 산출물(release/) 파일명 (linux는 확장자 없음)
const TIERS = {
  'win-legacy': 'sync-agent-win-legacy.exe',
  'win-mid': 'sync-agent-win-mid.exe',
  'win-modern': 'sync-agent-win-modern.exe',
  'linux-legacy': 'sync-agent-linux-legacy',
  'linux-modern': 'sync-agent-linux-modern',
};

const rel = path.join(ROOT, 'release');
const missing = Object.values(TIERS).filter((f) => !fs.existsSync(path.join(rel, f)));
if (missing.length) {
  console.error('빌드 산출물 없음: ' + missing.join(', ') + '\n먼저 npm run build:tiers 를 실행하세요.');
  process.exit(1);
}

console.log(`자동 업데이트 exe 업로드 v${version} → ${HOST}:${DEST}`);
for (const [tier, file] of Object.entries(TIERS)) {
  // 서버 파일명 = sync-agent-<version>-<tier>.exe (linux 바이너리도 .exe 이름 — /download가 항상 .exe로 서빙, 내용은 리눅스 바이너리)
  const remoteName = `sync-agent-${version}-${tier}.exe`;
  console.log(`  ${file} -> ${remoteName}`);
  try {
    execSync(`scp "${file}" ${HOST}:${DEST}${remoteName}`, { cwd: rel, stdio: 'inherit' });
  } catch (e) {
    console.error(`\n업로드 실패: ${file}. SSH 접속/서버 경로를 확인하세요.`);
    process.exit(1);
  }
}
console.log('\n업로드 완료 — 이제 슈퍼관리자에서 티어별 sync_releases 등록(POST /api/admin/sync/releases, tier별 checksum).');
