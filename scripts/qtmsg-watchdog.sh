#!/bin/bash
# QTmsg watchdog — 순수 로직부(테스트 대상)
set -uo pipefail

# latest_db_error_epoch <log_dir> <YYYY-MMDD>...
# 주어진 날짜들의 로그에서 마지막 "db connection error(MYSQL)" 의 epoch 를 돌려준다.
# 날짜는 반드시 파일명에서 가져온다. 로그 줄에는 시:분:초만 있어서 오늘로 계산하면
# 어제 23시의 끊김이 방금 일로 둔갑하고, 멀쩡한 에이전트를 내렸다 올리게 된다.
# 날짜를 여러 개 받는 이유는 자정 직후다. 00:01 에 오늘 파일만 보면 23:59 의 끊김을 놓친다.
latest_db_error_epoch() {
  local log_dir="$1"; shift
  local best="" day iso f line hhmmss ep
  for day in "$@"; do
    iso="${day:0:4}-${day:5:2}-${day:7:2}"
    for f in "$log_dir/$day"-*; do
      [ -f "$f" ] || continue
      line="$(grep -a 'db connection error(MYSQL)' "$f" 2>/dev/null | tail -1)"
      [ -n "$line" ] || continue
      hhmmss="${line:0:8}"
      case "$hhmmss" in
        [0-9][0-9]:[0-9][0-9]:[0-9][0-9]) ;;
        *) continue ;;
      esac
      ep="$(date -d "$iso $hhmmss" +%s 2>/dev/null)" || continue
      [ -n "$ep" ] || continue
      if [ -z "$best" ] || [ "$ep" -gt "$best" ]; then
        best="$ep"
      fi
    done
  done
  printf '%s' "$best"
}

# is_within_window <event_epoch> <now_epoch> <window_sec>
# 끊김이 방금 일인지 본다. 창을 넘긴 기록은 이미 처리했거나 지난 사고다.
is_within_window() {
  local ev="$1" now="$2" win="$3"
  [ -n "$ev" ] || return 1
  local diff=$(( now - ev ))
  [ "$diff" -ge 0 ] && [ "$diff" -le "$win" ]
}

# in_cooldown <state_file> <agent> <now_epoch> <cooldown_sec>
# 같은 에이전트를 반복해서 내렸다 올리면 복구가 아니라 장애가 된다.
in_cooldown() {
  local state="$1" agent="$2" now="$3" cool="$4"
  [ -f "$state" ] || return 1
  local last
  last="$(awk -v a="$agent" '$1==a {print $2}' "$state" | tail -1)"
  [ -n "$last" ] || return 1
  [ $(( now - last )) -lt "$cool" ]
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
