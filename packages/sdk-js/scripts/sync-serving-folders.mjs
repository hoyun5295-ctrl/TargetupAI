// ★ 2026-07-17 SDK 서빙 폴더 동기화 — B-0717-1 재발 클래스 차단.
// 배경: 자사몰 스니펫은 버전 고정 URL(예: /sdk/v0.3.9/hanjul.min.js)이라, 새 빌드를 일부 폴더에만
// 복사하면 옛 버전을 부르는 몰(팝폰 웹 등)은 새 코드를 영원히 못 받는다(0717 중앙정렬 미반영 실사고).
// 규칙: dist/iife 산출물(hanjul.min.js + .map)을 v0.3.8 이상 전 서빙 폴더에 동일 복사.
//       v0.3.8 미만(v0.3.5 등)은 구세대 API 빌드 세대라 제외(0716 수동 동기화 때와 동일 기준).
// 실행: npm run build:all 뒤 자동(postbuild:all) 또는 npm run sync:serving 단독.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '../dist/iife');
const SDK_DIR = resolve(__dirname, '../../company-frontend/public/sdk');
const MIN_SYNC = [0, 3, 8]; // v0.3.8 이상만 동기화
const FILES = ['hanjul.min.js', 'hanjul.min.js.map'];

// 버전 정규식·파싱은 서빙 CT(backend utils/sdk-serve.ts VERSION_RE·parseVer)와 동일 미러 —
// 서빙이 인식하는 폴더만 동기화 대상이면 충분하다(full semver prerelease 비교는 의도적으로 미지원, 서빙도 동일).
function parseVer(v) {
  const p = v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  return [p[0] || 0, p[1] || 0, p[2] || 0];
}
const atLeast = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

for (const f of FILES) {
  if (!existsSync(resolve(DIST, f))) {
    console.error(`[sdk-sync] dist/iife/${f} 없음 — build:iife 먼저 실행 필요`);
    process.exit(1);
  }
}

const targets = readdirSync(SDK_DIR).filter(
  (d) => /^v\d+\.\d+\.\d+(-[a-z0-9]+)?$/.test(d) && atLeast(parseVer(d), MIN_SYNC) >= 0,
);
if (targets.length === 0) {
  console.error('[sdk-sync] 동기화 대상 버전 폴더 없음');
  process.exit(1);
}

for (const v of targets) {
  for (const f of FILES) {
    writeFileSync(resolve(SDK_DIR, v, f), readFileSync(resolve(DIST, f)));
  }
  console.log(`[sdk-sync] ${v} <- dist/iife (${FILES.join(', ')})`);
}
console.log(`[sdk-sync] 완료 — ${targets.length}개 폴더 동기화`);
