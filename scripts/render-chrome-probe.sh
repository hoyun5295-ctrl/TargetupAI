#!/bin/bash
# ============================================================================
# 렌더 크롬 샌드박스 기동 시험 — 「성공」의 정의는 여기 한 곳(설치 = install-render-chrome.sh · 매일 감시 = security-watch.sh 가 부른다)
#   ★2026-10-27 Codex 3R — 두 스크립트가 시험을 따로 갖고 기준이 달랐다(한쪽은 종료 코드를 버렸다).
#   성공 = 종료 코드 0 + 빈 페이지 DOM(<body>). 그 밖(시간 초과 124 · 강제 종료 137 · No usable sandbox)은 전부 실패.
#   바깥 접속 0(about:blank) · 임시 프로필은 끝나면 지운다 · 시간 상한 60초 + 10초 뒤 강제 종료.
# 사용: render-chrome-probe.sh <크롬 실행 파일> → 한 줄 출력(OK 또는 FAIL 사유) · 종료 코드 0 = 성공
# ============================================================================
set -uo pipefail
chrome="${1:-}"
[[ -n "${chrome}" && -x "${chrome}" ]] || { echo "FAIL 크롬 실행 파일 없음(${chrome:-경로 없음})"; exit 1; }
probe_dir="$(mktemp -d)"
trap 'rm -rf "${probe_dir}"' EXIT
out="$(timeout --kill-after=10 60 "${chrome}" --headless=new --disable-gpu --no-first-run --user-data-dir="${probe_dir}" --dump-dom about:blank 2>&1)"
rc=$?
if [[ ${rc} -eq 0 && "${out}" == *"<body>"* ]]; then
  echo "OK"
  exit 0
fi
why="$(echo "${out}" | grep -m1 -o 'No usable sandbox' || echo "${out}" | head -1 | cut -c1-80)"
echo "FAIL rc=${rc} ${why}"
exit 1
