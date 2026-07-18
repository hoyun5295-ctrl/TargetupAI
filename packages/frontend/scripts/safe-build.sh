#!/bin/bash
# ============================================================
# D145 (2026-05-07) — Atomic deploy 패턴
# ============================================================
# 목적: vite build 실패 시에도 옛 dist 그대로 유지하여 사이트 차단 0초 보장.
#
# D145 사고 (2026-05-06 18:54 ~ 5/7 04:00 = 9시간 거래처 차단):
#   - tp-deploy-full → npm run build → vite는 emptyOutDir: true(기본)로 dist 비움
#   - 어떤 이유로 빌드 도중 비정상 종료 → dist 비어있는 상태로 끝
#   - nginx 403 "directory index of dist/ is forbidden" 9시간
#
# 해결:
#   1. 빌드를 별도 폴더(dist-new)에 수행 → vite emptyOutDir이 dist-new만 비움
#   2. 빌드 성공(index.html 생성) 검증 후에만 dist로 atomic mv (swap)
#   3. 빌드 실패 시 dist-new 청소 + 옛 dist 그대로 유지 → 사이트 정상 작동 지속
# ============================================================

set -euo pipefail

# 스크립트 위치 → frontend 폴더로 이동
cd "$(dirname "$0")/.."

FRONTEND_DIR="$(pwd)"
DIST_DIR="$FRONTEND_DIR/dist"
DIST_NEW="$FRONTEND_DIR/dist-new"
DIST_OLD="$FRONTEND_DIR/dist-old"
TS="$(date +%Y%m%d-%H%M%S)"

echo "════════════════════════════════════════════════════════════"
echo "[atomic-build] frontend safe build 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[atomic-build] 작업 폴더: $FRONTEND_DIR"
echo "════════════════════════════════════════════════════════════"

# ★ D151-6 (2026-05-11): devDependencies 누락 자동 차단 안전망
#   운영 서버 NODE_ENV=production 이면 npm install이 devDependencies skip → tsc/vite 빌드 차단
#   사고: D151-2 backend 1310 tsc 에러 / D151-4 frontend 21,328 tsc 에러 동일 패턴 반복 발생
#   대책: typescript 누락 시 자동으로 npm install --include=dev 선행 → 운영 사이클 안전망
if [ ! -d "node_modules/typescript" ]; then
  echo "[atomic-build] ⚠️  devDependencies 누락 감지 (node_modules/typescript 없음)"
  echo "[atomic-build] 자동 복구: npm install --include=dev 실행"
  npm install --include=dev
fi

# 0. 잔존 dist-new 청소 (이전 빌드 실패 잔존물)
if [ -d "$DIST_NEW" ]; then
  echo "[atomic-build] 잔존 dist-new 청소"
  rm -rf "$DIST_NEW"
fi

# 1. TypeScript 체크 + Vite 빌드 → dist-new 폴더로
echo "[atomic-build] TypeScript 체크 시작..."
npx tsc

echo "[atomic-build] Vite 빌드 시작 → dist-new"
# ★ 2026-06-15: 난독화 render 단계 메모리 헤드룸 — 제한 서버에서 heap-OOM hang 방지 (4GB)
NODE_OPTIONS="--max-old-space-size=4096" npx vite build --outDir dist-new

# 2. 빌드 성공 검증 — dist-new/index.html 존재 + 사이즈 > 0
if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/index.html 없음"
  echo "   옛 dist 그대로 유지 (사이트 차단 0초)"
  rm -rf "$DIST_NEW"
  exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [atomic-build] 빌드 실패 — dist-new/index.html 사이즈 비정상 ($INDEX_SIZE bytes)"
  echo "   옛 dist 그대로 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 3. assets 폴더 검증 (vite chunk 누락 방지)
if [ ! -d "$DIST_NEW/assets" ]; then
  echo "⚠️  [atomic-build] dist-new/assets 폴더 없음 — chunk 누락 의심"
  echo "   안전을 위해 빌드 실패 처리 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# 3-1. ★ B-0718-1 (2026-07-18): lazy 청크 실존 기계 검증 게이트
#   사고: 난독화 stringArray(threshold 0.5 = 빌드마다 무작위 암호화)가 라우트 동적 import
#   경로 문자열(import('./pages/X'))을 암호화하면 rollup이 그 페이지 청크를 생성하지 못하고
#   런타임이 원시 경로를 요청 → SPA fallback HTML → 전 고객 오류 화면.
#   index.html/assets 존재 검증(위 2·3단계)만으론 이 불량 빌드가 전부 통과했다.
#   대책: src의 동적 import 대상 전수를 dist-new/assets/<이름>-*.js 실존과 1:1 대조,
#   하나라도 없으면 스왑 자체를 거부(옛 dist 유지). 현재 단일 번들(동적 import 0건)은 자동 통과.
#   주의: 스플리팅을 pages 외 경로로 확장하면 아래 grep 패턴도 함께 확장할 것.
LAZY_TARGETS=$(grep -rhoE "import\(['\"]\./pages/[A-Za-z0-9_]+['\"]\)" src/ 2>/dev/null | sed -E 's/.*\/pages\/([A-Za-z0-9_]+).*/\1/' | sort -u || true)
LAZY_COUNT=$(echo $LAZY_TARGETS | wc -w)
MISSING_CHUNKS=""
for name in $LAZY_TARGETS; do
  if ! ls "$DIST_NEW/assets/$name"-*.js >/dev/null 2>&1; then
    MISSING_CHUNKS="$MISSING_CHUNKS $name"
  fi
done
if [ -n "$MISSING_CHUNKS" ]; then
  echo "❌ [atomic-build] lazy 청크 미생성 감지 —$MISSING_CHUNKS"
  echo "   B-0718-1 유형(난독화 x 동적 import 비결정 빌드) — 스왑 거부 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi
echo "[atomic-build] lazy 청크 게이트 통과 — 대상 ${LAZY_COUNT}건 전부 실존"

# 3-2. ★ B-0718-1 보강 (Codex 2R P1): 산출물 안 "비literal 동적 import" 검출
#   같은 페이지에 import 지점이 2곳+(라우트 lazy + prefetch)이면 한 지점만 난독화로 깨져도
#   다른 지점 덕에 청크는 생성됨 → 3-1(실존)만으론 통과하는데 라우트는 런타임에 원시 경로를
#   요청해 깨진다. 실측 증거: 사고날 밤 "통과" 판정했던 로컬 76청크 빌드조차 동적 import
#   38지점 중 19지점이 import(W(491)) 형태(stringArray 조회 = 경로 암호화)였다.
#   대책: 번들 전체에서 import( 뒤가 따옴표가 아닌 지점(=계산식 인자)을 세어 1건이라도
#   있으면 스왑 거부. 현 src 동적 import 0건 + vendor 계산식 import 0건 실측이라 오탐 없음.
#   (Codex 3R P2 보강: 인자 "전체"가 단일 완결 문자열 literal인지 검사 — 따옴표로 시작해도
#    "./pages/"+name 연결식·`${}` 보간·미종결 문자열은 전부 계산식으로 판정)
BAD_IMPORT_COUNT=$(node - "$DIST_NEW/assets" <<'NODE_EOF'
const fs=require('fs'),path=require('path');
const dir=process.argv[2];
let bad=0;
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){
  const s=fs.readFileSync(path.join(dir,f),'utf8');
  const re=/(^|[^\w.$])import\(/g;let m;
  while((m=re.exec(s))!==null){
    const i=m.index+m[0].length;
    const q=s[i];
    if(q!=='"'&&q!=="'"&&q!=='`'){bad++;continue;}
    let j=i+1,closed=false,computed=false;
    while(j<s.length){
      const c=s[j];
      if(c==='\\'){j+=2;continue;}
      if(q==='`'&&c==='$'&&s[j+1]==='{'){computed=true;break;}
      if(c===q){closed=true;break;}
      j++;
    }
    if(!closed||computed){bad++;continue;}
    let k=j+1;
    while(k<s.length&&/\s/.test(s[k]))k++;
    if(s[k]!==')'&&s[k]!==','){bad++;}
  }
}
console.log(bad);
NODE_EOF
)
if [ "$BAD_IMPORT_COUNT" -gt 0 ]; then
  echo "❌ [atomic-build] 비literal 동적 import ${BAD_IMPORT_COUNT}건 검출 — 난독화가 import 경로를 암호화함"
  echo "   B-0718-1 유형(라우트 런타임 원시 경로 요청) — 스왑 거부 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi
echo "[atomic-build] 비literal 동적 import 게이트 통과 — 0건"

# 4. atomic swap — 옛 dist 백업 + dist-new를 dist로 rename
if [ -d "$DIST_OLD" ]; then
  rm -rf "$DIST_OLD"
fi

if [ -d "$DIST_DIR" ]; then
  mv "$DIST_DIR" "$DIST_OLD"
fi

mv "$DIST_NEW" "$DIST_DIR"

echo "════════════════════════════════════════════════════════════"
echo "✅ [atomic-build] 빌드 성공 + atomic swap 완료"
echo "   index.html: $DIST_DIR/index.html ($INDEX_SIZE bytes)"
echo "   옛 dist 백업: $DIST_OLD (다음 빌드 시 자동 정리)"
echo "════════════════════════════════════════════════════════════"
exit 0
