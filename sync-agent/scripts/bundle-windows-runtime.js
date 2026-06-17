// scripts/bundle-windows-runtime.js — Windows 구형 티어 app-local 런타임 동봉
// 사용: node scripts/bundle-windows-runtime.js <exePath> <outDir>
// 효과: outDir에 sync-agent.exe + sql-wasm.wasm + UCRT(46) + vcruntime + 자가진단 bat 배치.
//   2008R2/Win7에서 0xC0000139(entry point not found)·조용한 로드실패 차단. vc_redist 불필요.
const fs = require('fs');
const path = require('path');

const rawArgs = process.argv.slice(2);
const noRuntime = rawArgs.includes('--no-runtime'); // modern = UCRT/VC 동봉 불필요(폴더+bat 구조만 통일)
const [exePath, outDir] = rawArgs.filter((a) => !a.startsWith('--'));
if (!exePath || !outDir) {
  console.error('사용: node scripts/bundle-windows-runtime.js <exePath> <outDir> [--no-runtime]');
  process.exit(1);
}
const ROOT = path.resolve(__dirname, '..');
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
fs.mkdirSync(abs(outDir), { recursive: true });

// 1) exe(고정명 sync-agent.exe) + wasm
fs.copyFileSync(abs(exePath), path.join(abs(outDir), 'sync-agent.exe'));
fs.copyFileSync(path.join(ROOT, 'release/sql-wasm.wasm'), path.join(abs(outDir), 'sql-wasm.wasm'));

// 2)·3) 런타임 DLL 동봉 — 구형 OS(2008R2/Win7)만. modern은 --no-runtime로 건너뜀.
let dllCount = 0;
let sdkVer = null;
if (!noRuntime) {
  // 2) UCRT app-local 정식 세트 — 최신 Windows SDK redist 자동 탐색
  const sdkRedist = 'C:/Program Files (x86)/Windows Kits/10/Redist';
  sdkVer = fs
    .readdirSync(sdkRedist)
    .filter((d) => /^10\./.test(d) && fs.existsSync(path.join(sdkRedist, d, 'ucrt/DLLs/x64')))
    .sort()
    .pop();
  if (!sdkVer) {
    console.error('Windows SDK UCRT redist 없음 — Windows SDK(ucrt redist) 설치 필요');
    process.exit(1);
  }
  const ucrtDir = path.join(sdkRedist, sdkVer, 'ucrt/DLLs/x64');
  for (const f of fs.readdirSync(ucrtDir).filter((f) => f.endsWith('.dll'))) {
    fs.copyFileSync(path.join(ucrtDir, f), path.join(abs(outDir), f));
    dllCount++;
  }

  // 3) VC 런타임 (System32)
  const sys32 = path.join(process.env.WINDIR || 'C:/Windows', 'System32');
  for (const d of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
    const src = path.join(sys32, d);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(abs(outDir), d));
      dllCount++;
    }
  }
}

// 4) 자가진단 bat (EXIT_CODE -> diagnose.txt + 서비스 등록 분기) — 전 Windows 티어 공통
fs.copyFileSync(
  path.join(__dirname, 'INSTALL-run-as-admin.bat.tpl'),
  path.join(abs(outDir), 'INSTALL-run-as-admin.bat'),
);

console.log(`동봉 완료: ${outDir} (DLL ${dllCount}개${sdkVer ? ', SDK ' + sdkVer : ', 런타임 미동봉(modern)'})`);
