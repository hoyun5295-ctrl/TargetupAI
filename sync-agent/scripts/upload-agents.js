// scripts/upload-agents.js — dist-tiers/downloads/*.zip 를 서버 agent-builds/ 로 한 번에 업로드(scp).
// 사용: npm run upload:agents   (또는 빌드+업로드 한 번에 = npm run build:tiers:deploy)
// 인증 = 시스템 SSH 설정(키가 있으면 무인증, 없으면 비밀번호 1회). 서버 정보는 ENV로 override 가능.
//   AGENT_UPLOAD_HOST (기본 administrator@58.227.193.62)
//   AGENT_UPLOAD_DIR  (기본 /home/administrator/targetup-app/packages/backend/agent-builds/)
// ★ AI가 직접 실행하지 않는다 — Harold 본인 PowerShell에서 실행(tp-push와 동일).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DL = path.join(ROOT, 'dist-tiers', 'downloads');
const HOST = process.env.AGENT_UPLOAD_HOST || 'administrator@58.227.193.62';
const DEST = process.env.AGENT_UPLOAD_DIR || '/home/administrator/targetup-app/packages/backend/agent-builds/';

if (!fs.existsSync(DL)) {
  console.error(`다운로드 폴더 없음: ${DL}\n먼저 npm run build:tiers 를 실행하세요.`);
  process.exit(1);
}
const zips = fs.readdirSync(DL).filter((f) => f.endsWith('.zip')).sort();
if (zips.length === 0) {
  console.error('업로드할 zip이 없습니다 — 먼저 npm run build:tiers 를 실행하세요.');
  process.exit(1);
}

console.log(`업로드 ${zips.length}개 → ${HOST}:${DEST}`);
for (const z of zips) console.log('  - ' + z);

// 다운로드 폴더에서 상대경로로 한 번에 전송 → scp 인증 1회 + Windows 'C:' 콜론 함정 회피.
const fileArgs = zips.map((z) => `"${z}"`).join(' ');
try {
  execSync(`scp ${fileArgs} ${HOST}:${DEST}`, { cwd: DL, stdio: 'inherit' });
} catch (e) {
  console.error('\n업로드 실패. SSH 접속/비밀번호 또는 서버 경로를 확인하세요.');
  process.exit(1);
}
console.log('\n업로드 완료 — 위저드 다운로드가 새 산출물을 서빙합니다.');
