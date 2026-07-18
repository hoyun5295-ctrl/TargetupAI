#!/bin/bash
# ============================================================
# D145 (2026-05-07) — Atomic deploy 패턴 (company-frontend)
# ============================================================
# packages/frontend/scripts/safe-build.sh와 동일 로직.
# 자세한 설명은 frontend 측 스크립트 헤더 참조.
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."

FRONTEND_DIR="$(pwd)"
DIST_DIR="$FRONTEND_DIR/dist"
DIST_NEW="$FRONTEND_DIR/dist-new"
DIST_OLD="$FRONTEND_DIR/dist-old"

echo "════════════════════════════════════════════════════════════"
echo "[atomic-build:company] safe build 시작 — $(date '+%Y-%m-%d %H:%M:%S')"
echo "[atomic-build:company] 작업 폴더: $FRONTEND_DIR"
echo "════════════════════════════════════════════════════════════"

if [ -d "$DIST_NEW" ]; then
  rm -rf "$DIST_NEW"
fi

npx tsc
npx vite build --outDir dist-new

if [ ! -f "$DIST_NEW/index.html" ]; then
  echo "❌ [atomic-build:company] 빌드 실패 — dist-new/index.html 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

INDEX_SIZE=$(stat -c %s "$DIST_NEW/index.html" 2>/dev/null || stat -f %z "$DIST_NEW/index.html")
if [ "$INDEX_SIZE" -lt 100 ]; then
  echo "❌ [atomic-build:company] 빌드 실패 — index.html 사이즈 비정상 ($INDEX_SIZE bytes)"
  rm -rf "$DIST_NEW"
  exit 1
fi

if [ ! -d "$DIST_NEW/assets" ]; then
  echo "❌ [atomic-build:company] assets 폴더 없음 / 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi

# ★ B-0718-1 게이트 이식 (2026-07-18) — frontend safe-build 3-1/3-2와 동일 로직.
#   company-frontend는 난독화가 더 무겁게(stringArrayThreshold 0.75 + CallsTransform) 걸려 있어
#   스플리팅(M2) 도입 시 같은 사고 확률이 더 높다. 현재 동적 import 0건 = 자동 통과(무해).
# 3-1. src 동적 import 대상 전수 → dist-new 청크 실존 1:1 대조
LAZY_TARGETS=$(grep -rhoE "import\(['\"]\./pages/[A-Za-z0-9_]+['\"]\)" src/ 2>/dev/null | sed -E 's/.*\/pages\/([A-Za-z0-9_]+).*/\1/' | sort -u || true)
LAZY_COUNT=$(echo $LAZY_TARGETS | wc -w)
MISSING_CHUNKS=""
for name in $LAZY_TARGETS; do
  if ! ls "$DIST_NEW/assets/$name"-*.js >/dev/null 2>&1; then
    MISSING_CHUNKS="$MISSING_CHUNKS $name"
  fi
done
if [ -n "$MISSING_CHUNKS" ]; then
  echo "❌ [atomic-build:company] lazy 청크 미생성 감지 —$MISSING_CHUNKS / 스왑 거부 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi
echo "[atomic-build:company] lazy 청크 게이트 통과 — 대상 ${LAZY_COUNT}건"

# 3-2. 번들 전체 "비literal 동적 import" 검출 — 인자 전체가 단일 완결 문자열 literal인지 파싱
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
  echo "❌ [atomic-build:company] 비literal 동적 import ${BAD_IMPORT_COUNT}건 — 난독화 경로 암호화 / 스왑 거부 + 옛 dist 유지"
  rm -rf "$DIST_NEW"
  exit 1
fi
echo "[atomic-build:company] 비literal 동적 import 게이트 통과 — 0건"

if [ -d "$DIST_OLD" ]; then rm -rf "$DIST_OLD"; fi
if [ -d "$DIST_DIR" ]; then mv "$DIST_DIR" "$DIST_OLD"; fi
mv "$DIST_NEW" "$DIST_DIR"

echo "✅ [atomic-build:company] swap 완료 ($INDEX_SIZE bytes)"
exit 0
