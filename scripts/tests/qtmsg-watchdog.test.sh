#!/bin/bash
# qtmsg-watchdog.sh 순수 로직 테스트
#
# 2026-09-21 MySQL 크래시(11:03:20)로 QTmsg 11개가 전부 DB와 끊겼고, 재연결을 1회만
# 시도한 뒤 3시간 40분을 멈춰 있었다. 감시자는 그 끊김을 로그 문구로 잡아 재기동한다.
# 여기서 검증하는 것은 "언제 끊긴 것으로 판정하는가"와 "언제 다시 올려도 되는가"다.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/../qtmsg-watchdog.sh"

FAILED=0
PASSED=0

assert_eq() {
  local expect="$1" actual="$2" name="$3"
  if [ "$expect" = "$actual" ]; then
    PASSED=$((PASSED + 1))
    echo "  PASS  $name"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL  $name"
    echo "        expect=[$expect]"
    echo "        actual=[$actual]"
  fi
}

# main 을 돌리지 않고 함수만 가져온다.
# shellcheck disable=SC1090
. "$TARGET"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/logs"

# --- 1. 끊김 시각을 epoch 로 뽑는다 -------------------------------------
cat > "$TMP/logs/2026-0921-targetai4_m-mt" <<'LOG'
11:03:20:937:java.sql.DriverManager.getConnection(DriverManager.java:664)
11:03:25:937:db connection error(MYSQL)
LOG
assert_eq "$(date -d '2026-09-21 11:03:25' +%s)"   "$(latest_db_error_epoch "$TMP/logs" 2026-0921)"   "끊김 줄의 시각을 그 날짜의 epoch 로 변환한다"

# --- 2. 끊김이 없으면 빈 값 ---------------------------------------------
rm -f "$TMP/logs"/*
cat > "$TMP/logs/2026-0921-targetai4_m-mt" <<'LOG'
11:03:20:937:normal operation
LOG
assert_eq ""   "$(latest_db_error_epoch "$TMP/logs" 2026-0921)"   "끊김 기록이 없으면 빈 값을 돌려준다"

# --- 3. 같은 날 여러 로그 파일 중 가장 늦은 끊김 -------------------------
rm -f "$TMP/logs"/*
cat > "$TMP/logs/2026-0921-targetai4_m-mt" <<'LOG'
11:03:25:937:db connection error(MYSQL)
LOG
cat > "$TMP/logs/2026-0921-targetai4_m-rt" <<'LOG'
14:20:01:100:db connection error(MYSQL)
LOG
assert_eq "$(date -d '2026-09-21 14:20:01' +%s)"   "$(latest_db_error_epoch "$TMP/logs" 2026-0921)"   "같은 날 여러 파일이면 가장 늦은 끊김을 고른다"

# --- 4. 날짜는 파일명이 정한다(자정 경계) --------------------------------
# 파일명 날짜를 무시하고 오늘로 계산하면, 어제 23시의 끊김이 방금 일로 둔갑해
# 멀쩡한 에이전트를 내렸다 올린다.
rm -f "$TMP/logs"/*
cat > "$TMP/logs/2026-0920-targetai4_m-mt" <<'LOG'
23:59:59:001:db connection error(MYSQL)
LOG
assert_eq "$(date -d '2026-09-20 23:59:59' +%s)"   "$(latest_db_error_epoch "$TMP/logs" 2026-0920)"   "epoch 의 날짜는 파일명에서 가져온다"

# --- 5. 감지 창 판정 ------------------------------------------------------
NOW=$(date -d '2026-09-21 11:05:00' +%s)
EV=$(date -d '2026-09-21 11:03:25' +%s)
if is_within_window "$EV" "$NOW" 120; then R=yes; else R=no; fi
assert_eq "yes" "$R" "95초 전 끊김은 120초 창 안이다"

EV_OLD=$(date -d '2026-09-21 11:00:00' +%s)
if is_within_window "$EV_OLD" "$NOW" 120; then R=yes; else R=no; fi
assert_eq "no" "$R" "300초 전 끊김은 120초 창 밖이다"

if is_within_window "" "$NOW" 120; then R=yes; else R=no; fi
assert_eq "no" "$R" "끊김 기록이 없으면 창 안이 아니다"

# --- 6. 쿨다운 판정 -------------------------------------------------------
# 같은 에이전트를 반복해서 내렸다 올리면 복구가 아니라 장애가 된다.
STATE="$TMP/state"
: > "$STATE"
if in_cooldown "$STATE" agent4 "$NOW" 600; then R=yes; else R=no; fi
assert_eq "no" "$R" "재기동 이력이 없으면 쿨다운이 아니다"

echo "agent4 $((NOW - 60))" > "$STATE"
if in_cooldown "$STATE" agent4 "$NOW" 600; then R=yes; else R=no; fi
assert_eq "yes" "$R" "60초 전에 올렸으면 600초 쿨다운 안이다"

echo "agent4 $((NOW - 700))" > "$STATE"
if in_cooldown "$STATE" agent4 "$NOW" 600; then R=yes; else R=no; fi
assert_eq "no" "$R" "700초 전이면 쿨다운이 풀린다"

echo "agent7 $((NOW - 60))" > "$STATE"
if in_cooldown "$STATE" agent4 "$NOW" 600; then R=yes; else R=no; fi
assert_eq "no" "$R" "쿨다운은 에이전트마다 따로 센다"

# --- 7. 자정 직후에는 어제 로그도 함께 본다 -------------------------------
# 로그 파일은 날짜로 갈린다. 00:01 에 오늘 파일만 보면 23:59 의 끊김을 못 본다.
rm -f "$TMP/logs"/*
cat > "$TMP/logs/2026-0920-targetai4_m-mt" <<'LOG'
23:59:50:001:db connection error(MYSQL)
LOG
assert_eq "$(date -d '2026-09-20 23:59:50' +%s)"   "$(latest_db_error_epoch "$TMP/logs" 2026-0921 2026-0920)"   "오늘 로그가 없어도 어제 끊김을 찾는다"

cat > "$TMP/logs/2026-0921-targetai4_m-mt" <<'LOG'
00:00:30:001:db connection error(MYSQL)
LOG
assert_eq "$(date -d '2026-09-21 00:00:30' +%s)"   "$(latest_db_error_epoch "$TMP/logs" 2026-0921 2026-0920)"   "여러 날짜를 주면 가장 늦은 끊김을 고른다"

echo ""
echo "PASS=$PASSED FAIL=$FAILED"
[ "$FAILED" -eq 0 ]
