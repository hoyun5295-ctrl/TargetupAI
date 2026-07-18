#!/bin/bash
# ============================================================
# B-0718-1 (2026-07-18) — 배포 직후 라이브 자산 전수 검사
# ============================================================
# 목적: "있어야 할" 자산이 전부 존재하고 라이브에서 올바른 타입으로 서빙되는지 기계 확인.
#   사고 때 nginx SPA fallback(try_files → /index.html)이 번들에 없는 .js 요청에
#   200 + HTML을 반환해 브라우저 "Unexpected token '<'"가 났고, 404가 없어 진단이 늦었다.
#
# 검사 URL 도출 기준 (Codex P1 정정 2026-07-18):
#   dist에 "이미 존재하는 파일"만 돌면 사고 시나리오(청크 미생성 = 파일 자체가 없음)를
#   영원히 못 잡는다. 그래서 기대 목록을 원천에서 도출한다:
#   [1] src의 라우트 동적 import 대상 → dist/assets/<이름>-*.js 실존 (B-0718-1 직접 시그니처)
#   [2] dist/index.html이 참조하는 /assets/* 전수 → 실존 + 라이브 타입 일치 (엔트리 사슬)
#   [3] dist/assets의 전 JS → 라이브 content-type=javascript (서빙 계층 오염 검출)
#   1차 차단은 safe-build.sh 3-1 게이트(스왑 전 거부) — 이 스크립트는 배포 후 라이브 최종 확인.
#
# (company-frontend 판 — app.hanjul.ai 기본. frontend 판과 동일 로직·이식 2026-07-18)
# 사용(서버에서): bash /home/administrator/targetup-app/packages/company-frontend/scripts/verify-live-chunks.sh
# 읽기 전용(GET만) — 서버 상태 무접촉.
# ============================================================

set -u
BASE_URL="${1:-https://app.hanjul.ai}"
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ] || [ ! -d dist/assets ]; then
  echo "❌ [verify-live] dist/index.html 또는 dist/assets 없음 — frontend 폴더/빌드 상태 확인"
  exit 1
fi

TOTAL=0
FAIL=0

# [0] 서빙 중인 dist 산출물 자체의 "비literal 동적 import" 검출 (Codex 2R P1 — safe-build 3-2와 동일 검출기)
#   난독화가 import 경로 문자열을 암호화하면 import(W(491)) 같은 계산식 인자가 남고,
#   그 라우트는 런타임에 원시 경로를 요청해 SPA HTML을 받는다. 이미 배포된 불량도 여기서 잡는다.
#   (Codex 3R P2: TOTAL 미가산 — TOTAL은 실제 자산 검사 건수만 세어 "검사 0건" 가드가 유효하도록.
#    검출기는 인자 전체가 단일 완결 literal인지 검사 — 연결식·보간·미종결 = 계산식 판정)
BAD_IMPORT_COUNT=$(node - "$(pwd)/dist/assets" <<'NODE_EOF'
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
) || BAD_IMPORT_COUNT="scanner_error"
# (Codex 4R P2) 검출기 자체가 못 돌면(node 부재·예외) 조용히 건너뛰지 않고 실패로 닫는다
case "$BAD_IMPORT_COUNT" in
  ''|*[!0-9]*)
    echo "FAIL 비literal import 검출기 실행 실패 (출력: '${BAD_IMPORT_COUNT}')"
    FAIL=$((FAIL+1))
    ;;
  *)
    if [ "$BAD_IMPORT_COUNT" -gt 0 ]; then
      echo "FAIL 산출물 비literal 동적 import ${BAD_IMPORT_COUNT}건 — 난독화 경로 암호화(B-0718-1 유형)"
      FAIL=$((FAIL+1))
    fi
    ;;
esac
echo "[verify-live] [0] 산출물 비literal 동적 import 검사 완료 (${BAD_IMPORT_COUNT}건)"

check_live() {
  # $1=URL 경로(/assets/..) $2=기대 content-type 부분 문자열
  # (Codex 3R P2: curl 실패는 -w 출력과 무관하게 즉시 실패 처리 + HTTP 200 요구)
  local path="$1" expected="$2" out code ct
  if ! out=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 10 "$BASE_URL$path"); then
    echo "FAIL $path → curl 전송 실패"
    return 1
  fi
  code="${out%% *}"
  ct="${out#* }"
  if [ "$code" != "200" ]; then
    echo "FAIL $path → HTTP $code (content-type: $ct)"
    return 1
  fi
  case "$ct" in
    *"$expected"*) return 0 ;;
    *) echo "FAIL $path → content-type: $ct (기대: $expected)"; return 1 ;;
  esac
}

# [1] src 기준 lazy 대상 전수 → dist 실존 + 라이브 서빙 (청크 미생성 = 여기서 즉시 검출)
LAZY_TARGETS=$(grep -rhoE "import\(['\"]\./pages/[A-Za-z0-9_]+['\"]\)" src/ 2>/dev/null | sed -E 's/.*\/pages\/([A-Za-z0-9_]+).*/\1/' | sort -u || true)
LAZY_COUNT=$(echo $LAZY_TARGETS | wc -w)
for name in $LAZY_TARGETS; do
  TOTAL=$((TOTAL+1))
  found=0
  for chunk in dist/assets/"$name"-*.js; do
    [ -e "$chunk" ] || continue
    found=1
    check_live "/assets/$(basename "$chunk")" "javascript" || FAIL=$((FAIL+1))
  done
  if [ "$found" -eq 0 ]; then
    echo "FAIL lazy 대상 $name — dist/assets에 청크 자체가 없음 (B-0718-1 시그니처)"
    FAIL=$((FAIL+1))
  fi
done
echo "[verify-live] [1] src lazy 대상 ${LAZY_COUNT}건 대조 완료"

# [2] dist/index.html이 참조하는 자산 전수 → 실존 + 라이브 타입 일치
REFS=$(grep -oE '/assets/[A-Za-z0-9._-]+\.(js|css)' dist/index.html | sort -u || true)
REF_COUNT=$(echo $REFS | wc -w)
if [ "$REF_COUNT" -eq 0 ]; then
  # (Codex 3R P2) 정상 빌드의 index.html은 최소 엔트리 JS 1건을 참조한다 — 0건 = 배포물 비정상
  echo "FAIL dist/index.html이 /assets 자산을 하나도 참조하지 않음"
  FAIL=$((FAIL+1))
fi
JS_REF_COUNT=$(printf '%s\n' $REFS | grep -c '\.js$' || true)
if [ "$JS_REF_COUNT" -eq 0 ]; then
  # (Codex 4R P2) CSS만 남고 엔트리 JS 참조를 잃은 index.html = 부팅 불가 배포물
  echo "FAIL dist/index.html에 JS(엔트리) 참조가 없음 — 부팅 불가"
  FAIL=$((FAIL+1))
fi
for ref in $REFS; do
  TOTAL=$((TOTAL+1))
  if [ ! -f "dist$ref" ]; then
    echo "FAIL $ref — index.html 참조 자산이 dist에 없음"
    FAIL=$((FAIL+1))
    continue
  fi
  case "$ref" in
    *.js)  check_live "$ref" "javascript" || FAIL=$((FAIL+1)) ;;
    *.css) check_live "$ref" "css"        || FAIL=$((FAIL+1)) ;;
  esac
done
echo "[verify-live] [2] index.html 참조 자산 ${REF_COUNT}건 대조 완료"

# [3] dist/assets의 전 JS → 라이브 content-type 검사 (서빙 계층 오염)
for f in dist/assets/*.js; do
  [ -e "$f" ] || continue
  TOTAL=$((TOTAL+1))
  check_live "/assets/$(basename "$f")" "javascript" || FAIL=$((FAIL+1))
done

echo "────────────────────────────────────────"
echo "[verify-live] $BASE_URL — 검사 총 ${TOTAL}건, 실패 ${FAIL}건"
if [ "$TOTAL" -eq 0 ]; then
  echo "❌ [verify-live] 검사 대상 0건 — dist 상태 비정상"
  exit 1
fi
if [ "$FAIL" -gt 0 ]; then
  echo "❌ [verify-live] 불량 존재 — 배포 불량, 즉시 롤백 검토"
  exit 1
fi
echo "[verify-live] 전 자산 실존 + 타입 일치 확인 완료"
exit 0
