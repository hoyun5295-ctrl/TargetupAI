#!/bin/bash
# ============================================================
# ★ 2026-11-11 (C124 · 뿌리 R88) 서버 리허설 — 판 관문 · 판 잠금 · 자동 복구 감시를 서버 실물로 확인한다.
# ============================================================
# 왜: 판 잠금(flock)과 pm2 는 개발 PC(Windows)에 없어 단위 시험이 닿지 않는다. 운영에 걸기 전에 서버에서 한 번 돌린다.
# 건드리는 것: 임시 폴더(/tmp/dist-gate-rehearsal.*)와 시험용 pm2 앱(wd-rehearsal) 뿐이다.
#   운영 백엔드(targetup-backend) · 그 dist · 그 판 잠금은 읽지도 옮기지도 않는다(끝에 재시작 횟수 · 기동 시각이 그대로인지 찍는다).
#   끝나면(실패해도) 시험용 앱을 pm2 목록에서 지우고 임시 폴더를 지운다. 경보는 보내지 않는다(OPS_ALERT=/bin/true).
# 실행(서버 administrator 셸 · 2분 안쪽):
#   bash /home/administrator/targetup-app/packages/backend/scripts/dist-gate-rehearsal.sh
# 종료 0 = 전부 통과 · 1 = 실패 있음(위 [실패] 줄)
# ============================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="wd-rehearsal"
PROD="targetup-backend"
T="$(mktemp -d /tmp/dist-gate-rehearsal.XXXXXX)"
PASS=0
FAIL=0
ok() { echo "[통과] $1"; PASS=$((PASS + 1)); }
ng() { echo "[실패] $1"; FAIL=$((FAIL + 1)); }
# pm2 앱 한 줄 요약: 상태 재시작횟수 기동시각(ms) — 없으면 none
st() {
  pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>{let p=null;try{p=JSON.parse(d).find((x)=>x&&x.name===process.argv[1]);}catch(e){}console.log(p?[p.pm2_env.status,p.pm2_env.restart_time,p.pm2_env.pm_uptime].join(" "):"none");});' "$1"
}
# st 출력이 「상태 재시작횟수 기동시각」 꼴인가 — 빈 글자 · none · 깨진 출력은 유효하지 않다
valid_state() { [[ "$1" =~ ^[a-z][a-z\ -]*\ [0-9]+\ [0-9]+$ ]]; }
wait_status() { # $1 = 기다리는 상태 · $2 = 최대 초
  local i=0
  while [ "$i" -lt "$2" ]; do
    [ "$(st "$APP" | cut -d' ' -f1)" = "$1" ] && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}
cleanup() {
  pm2 delete "$APP" >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup EXIT

for need in flock pm2 node; do
  command -v "$need" >/dev/null 2>&1 || { echo "[실패] $need 가 PATH 에 없습니다"; exit 1; }
done
PROD_BEFORE="$(st "$PROD")"
echo "운영 백엔드(시작 전) = $PROD_BEFORE"
# 이 셸의 pm2 가 운영 pm2 가 아니면(PM2_HOME · 실행 계정이 다름) 끝의 「운영 그대로」 확인이 뜻이 없다 → 시작하지 않는다(Codex 3R).
#   조회가 실패해 빈 글자가 나온 경우도 같다 — 「상태 재시작횟수 기동시각」 꼴일 때만 유효한 값으로 본다(Codex 4R).
if ! valid_state "$PROD_BEFORE"; then
  echo "[실패] 이 셸의 pm2 목록에 $PROD 가 보이지 않습니다(실행 계정 · PM2_HOME 확인) — 리허설을 시작하지 않습니다"
  exit 1
fi

# ────────────────────────────────────────────────────────────
# 1부. 판 관문(safe-build.sh) — tsc 자리에 가짜 npx 를 넣어 갈래마다 돌린다
# ────────────────────────────────────────────────────────────
mkdir -p "$T/bin"
cat > "$T/bin/npx" <<'EOF'
#!/bin/bash
out="$3"
mkdir -p "$out/routes" "$out/utils"
printf '"use strict";\n// %s\nexports.app = 1;\n' "$(printf 'x%.0s' $(seq 1 120))" > "$out/app.js"
printf '"use strict";\nexports.u = 1;\n' > "$out/utils/u.js"
case "$FAKE_MODE" in
  ok) printf '"use strict";\ntry {\n    f();\n}\ncatch (error) {\n}\n' > "$out/routes/billing.js" ;;
  leak) printf '"use strict";\nasync function h() {\n    try {\n        f();\n  } catch (error: any) {\n  }\n}\n' > "$out/routes/billing.js" ;;
  flip) if [ "$out" = "dist-new2" ]; then v=18; else v=10; fi; printf '"use strict";\nexports.rate = %s;\n' "$v" > "$out/routes/billing.js" ;;
  tscfail1) exit 2 ;;
  tscfail2) if [ "$out" = "dist-new2" ]; then exit 2; fi; printf '"use strict";\n' > "$out/routes/billing.js" ;;
esac
exit 0
EOF
chmod +x "$T/bin/npx"

gate() { # $1 = 갈래 → 종료 코드 · 결과 폴더 = $T/be-$1
  local B="$T/be-$1"
  mkdir -p "$B/scripts" "$B/node_modules/typescript" "$B/dist"
  cp "$HERE/safe-build.sh" "$HERE/verify-dist.js" "$B/scripts/"
  [ -f "$B/dist/app.js" ] || echo "// OLD-RUNNING-BUILD" > "$B/dist/app.js"
  DIST_LOCK_WAIT_S="${2:-90}" FAKE_MODE="$1" PATH="$T/bin:$PATH" bash "$B/scripts/safe-build.sh" > "$B/out.log" 2>&1
}
kept() { [ "$(head -1 "$T/be-$1/dist/app.js")" = "// OLD-RUNNING-BUILD" ] && [ ! -e "$T/be-$1/dist-new" ] && [ ! -e "$T/be-$1/dist-new2" ]; }

gate ok; rc=$?
if [ "$rc" = "0" ] && [ -f "$T/be-ok/dist/.installed" ] && [ -d "$T/be-ok/dist-old" ] && grep -q "verify-dist\] 통과" "$T/be-ok/out.log"; then ok "관문 · 정상 판 = 끼움 + 끼운 시각 표식"; else ng "관문 · 정상 판 (종료 $rc)"; fi
gate leak; rc=$?
if [ "$rc" = "1" ] && kept leak && grep -q "문법 오류 routes/billing.js:5" "$T/be-leak/out.log"; then ok "관문 · 소스 원문이 끼어든 판(11-10 꼴) = 끼우지 않음 · 옛 판 유지"; else ng "관문 · 소스 원문이 끼어든 판 (종료 $rc)"; fi
gate flip; rc=$?
if [ "$rc" = "1" ] && kept flip && grep -q "두 판이 다름 routes/billing.js" "$T/be-flip/out.log"; then ok "관문 · 두 번 빌드가 서로 다름 = 끼우지 않음"; else ng "관문 · 두 번 빌드가 서로 다름 (종료 $rc)"; fi
gate tscfail1; rc=$?
if [ "$rc" = "1" ] && kept tscfail1; then ok "관문 · 첫 빌드 실패 = 옛 판 유지 · 남는 폴더 없음"; else ng "관문 · 첫 빌드 실패 (종료 $rc)"; fi
gate tscfail2; rc=$?
if [ "$rc" = "1" ] && kept tscfail2; then ok "관문 · 둘째 빌드 실패 = 옛 판 유지 · 남는 폴더 없음"; else ng "관문 · 둘째 빌드 실패 (종료 $rc)"; fi

# 판 잠금 — 남이 쥐고 있으면 기다리다 실패 · 풀리면 빌드
mkdir -p "$T/be-ok2/dist"
echo "// OLD-RUNNING-BUILD" > "$T/be-ok2/dist/app.js"
( flock 8; sleep 6 ) 8> "$T/be-ok2/.dist.lock" &
HOLDER=$!
sleep 1
B="$T/be-ok2"
mkdir -p "$B/scripts" "$B/node_modules/typescript"
cp "$HERE/safe-build.sh" "$HERE/verify-dist.js" "$B/scripts/"
DIST_LOCK_WAIT_S=2 FAKE_MODE=ok PATH="$T/bin:$PATH" bash "$B/scripts/safe-build.sh" > "$B/out1.log" 2>&1; rc=$?
if [ "$rc" = "1" ] && grep -q "판 잠금을 쥐고 있습니다" "$B/out1.log" && [ "$(head -1 "$B/dist/app.js")" = "// OLD-RUNNING-BUILD" ]; then ok "판 잠금 · 남이 쥔 동안 빌드는 끼우지 않고 실패"; else ng "판 잠금 · 남이 쥔 동안 (종료 $rc)"; fi
wait "$HOLDER" 2>/dev/null
DIST_LOCK_WAIT_S=5 FAKE_MODE=ok PATH="$T/bin:$PATH" bash "$B/scripts/safe-build.sh" > "$B/out2.log" 2>&1; rc=$?
if [ "$rc" = "0" ] && [ -f "$B/dist/.installed" ]; then ok "판 잠금 · 풀린 뒤 빌드 = 끼움"; else ng "판 잠금 · 풀린 뒤 빌드 (종료 $rc)"; fi

# ────────────────────────────────────────────────────────────
# 2부. 자동 복구 감시(backend-watchdog.js) — 실제 pm2 · 시험용 앱
# ────────────────────────────────────────────────────────────
W="$T/wd"
mkdir -p "$W/dist"
echo 'setInterval(function () {}, 1000); // v1' > "$W/dist/app.js"
wd() { WATCHDOG_APP="$APP" WATCHDOG_BACKEND_DIR="$W" WATCHDOG_STATE="$T/wd-state.json" OPS_ALERT=/bin/true WATCHDOG_SETTLE_MS=4000 WATCHDOG_PROVEN_MS=3000 node "$HERE/backend-watchdog.js"; }

pm2 start "$W/dist/app.js" --name "$APP" --cwd "$W" >/dev/null 2>&1
if wait_status online 15; then ok "시험용 앱 v1 기동(online)"; else ng "시험용 앱 v1 기동 ($(st "$APP"))"; fi
sleep 4
out="$(wd 2>&1)"
if [ -z "$out" ] && grep -q '"provenDistId":"' "$T/wd-state.json" 2>/dev/null; then ok "감시 · online = 아무것도 하지 않고 돌던 판으로 적음"; else ng "감시 · online (출력: $out)"; fi
r1="$(st "$APP" | cut -d' ' -f2)"

# 깨진 새 판을 끼우고 다시 켠다(배포 흉내) → pm2 가 포기(errored)
mv "$W/dist" "$W/dist-old"
mkdir -p "$W/dist"
echo 'throw new Error("rehearsal: broken build"); // v2' > "$W/dist/app.js"
touch "$W/dist/.installed"
sleep 1
pm2 restart "$APP" >/dev/null 2>&1
if wait_status errored 60; then ok "깨진 새 판 v2 = pm2 errored"; else ng "깨진 새 판 v2 가 errored 가 되지 않음 ($(st "$APP"))"; fi

# 빌드가 판 잠금을 쥔 동안 = 감시는 건너뛴다
( flock 8; sleep 6 ) 8> "$W/.dist.lock" &
HOLDER=$!
sleep 1
out="$(wd 2>&1)"
if [ -z "$out" ] && grep -q "v2" "$W/dist/app.js" && [ -d "$W/dist-old" ] && [ "$(st "$APP" | cut -d' ' -f1)" = "errored" ]; then ok "감시 · 판 잠금을 남이 쥔 동안 = 건너뜀(판 · pm2 그대로)"; else ng "감시 · 판 잠금을 남이 쥔 동안 (출력: $out)"; fi
wait "$HOLDER" 2>/dev/null

# 잠금이 풀린 뒤 = 돌던 판으로 되돌려 켠다
out="$(wd 2>&1)"
echo "$out" | sed 's/^/    /'
if echo "$out" | grep -q "rollback 뒤 상태 = online" && grep -q "v1" "$W/dist/app.js" && ls -d "$W"/dist-failed-* >/dev/null 2>&1 && [ ! -d "$W/dist-old" ] && [ "$(st "$APP" | cut -d' ' -f1)" = "online" ]; then ok "감시 · 깨진 새 판 = 돌던 판으로 되돌려 online"; else ng "감시 · 되돌림 ($(st "$APP"))"; fi

# 되돌린 뒤 = 다시 손대지 않는다
r2="$(st "$APP" | cut -d' ' -f2)"
out="$(wd 2>&1)"
r3="$(st "$APP" | cut -d' ' -f2)"
if [ -z "$out" ] && [ "$r2" = "$r3" ]; then ok "감시 · 되돌린 뒤 online = 다시 손대지 않음"; else ng "감시 · 되돌린 뒤 (출력: $out · 재시작 $r2 → $r3)"; fi

# ────────────────────────────────────────────────────────────
PROD_AFTER="$(st "$PROD")"
echo "운영 백엔드(끝난 뒤) = $PROD_AFTER"
if valid_state "$PROD_AFTER" && [ "$PROD_BEFORE" = "$PROD_AFTER" ]; then ok "운영 백엔드 = 상태 · 재시작 횟수 · 기동 시각 그대로"; else ng "운영 백엔드 값이 달라짐(리허설과 무관한 재시작이 있었는지 확인): $PROD_BEFORE → $PROD_AFTER"; fi
echo "════════════════════════════════════════"
echo "리허설 결과: 통과 $PASS · 실패 $FAIL (시험용 앱 재시작 횟수 처음 $r1)"
[ "$FAIL" = "0" ]
