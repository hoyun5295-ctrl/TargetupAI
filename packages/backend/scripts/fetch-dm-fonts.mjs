/**
 * fetch-dm-fonts.mjs — 자가 호스팅 웹폰트(woff2) 내려받기 (DM/이메일 공용)
 *
 * 배경: 발행 DM/이메일 헤드라인 서체(명조 등)를 구글 Fonts CDN에서 불러오다
 *       수신 단말·망에서 미로드 → serif 제네릭(궁서)로 폴백되는 신고(박성용 2026-07-14).
 *       우리 서버에서 직접 서빙하면 CDN 의존/미로드가 사라진다.
 *
 * 소스: @fontsource(OFL/무료) woff2 (jsdelivr npm 미러). 한글+라틴 서브셋을 가중치별로 받는다.
 * 출력: packages/backend/assets/dm-fonts/<id>-<subset>-<weight>.woff2 (git 커밋 — PDF용 fonts/와 동일 패턴).
 * 재실행: 파일 있으면 스킵. 새 서체/가중치 추가 시 MANIFEST에 등록 후 재실행.
 *
 * 실행: node packages/backend/scripts/fetch-dm-fonts.mjs
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'dm-fonts');
const FS_VER = '5.2.5'; // @fontsource 버전 고정(재현성)

// id = design-core/fonts.ts CORE_FONTS의 self-host id와 일치. pkg = @fontsource 패키지명.
// weights = 받을 가중치. subsets = 'korean'(한글)·'latin'(영문/숫자) 둘 다 받아 unicode-range로 분리 소비.
const MANIFEST = [
  { id: 'noto-serif-kr',   pkg: 'noto-serif-kr',   weights: [400, 700, 900] },
  { id: 'nanum-myeongjo',  pkg: 'nanum-myeongjo',  weights: [400, 700, 800] },
  { id: 'gowun-batang',    pkg: 'gowun-batang',    weights: [400, 700] },
  { id: 'gowun-dodum',     pkg: 'gowun-dodum',     weights: [400] },
  { id: 'black-han-sans',  pkg: 'black-han-sans',  weights: [400] },
  { id: 'noto-sans-kr',    pkg: 'noto-sans-kr',    weights: [400, 500, 700, 900] },
  { id: 'ibm-plex-sans-kr',pkg: 'ibm-plex-sans-kr',weights: [400, 500, 700] },
  { id: 'gothic-a1',       pkg: 'gothic-a1',       weights: [400, 700, 900] },
  { id: 'nanum-gothic',    pkg: 'nanum-gothic',    weights: [400, 700, 800] },
  { id: 'jua',             pkg: 'jua',             weights: [400] },
  { id: 'do-hyeon',        pkg: 'do-hyeon',        weights: [400] },
];
const SUBSETS = ['korean', 'latin'];

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function fetchOne(pkg, file) {
  const url = `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${FS_VER}/files/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // woff2 매직 검증(wOF2) — 오류 페이지(HTML) 커밋 방지
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'wOF2') {
    throw new Error(`not a woff2 (${buf.length}B): ${url}`);
  }
  return buf;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let ok = 0, skip = 0, fail = 0;
  for (const f of MANIFEST) {
    for (const w of f.weights) {
      for (const sub of SUBSETS) {
        const out = join(OUT_DIR, `${f.id}-${sub}-${w}.woff2`);
        if (await exists(out)) { skip++; continue; }
        const srcFile = `${f.pkg}-${sub}-${w}-normal.woff2`;
        try {
          const buf = await fetchOne(f.pkg, srcFile);
          await writeFile(out, buf);
          console.log(`  ok  ${f.id}-${sub}-${w}.woff2 (${(buf.length / 1024).toFixed(0)}KB)`);
          ok++;
        } catch (e) {
          console.warn(`  FAIL ${f.id}-${sub}-${w}: ${e.message}`);
          fail++;
        }
      }
    }
  }
  console.log(`\n완료 — 받음 ${ok} · 스킵 ${skip} · 실패 ${fail} · 위치 ${OUT_DIR}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
