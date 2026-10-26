#!/bin/bash
# ============================================================================
# 렌더 워커 크롬을 root 전용 경로로 옮기고 AppArmor 프로필을 건다(root 실행 · 2026-10-27 보안 극대화 1번)
#   왜: 샌드박스 예외(userns)를 사용자가 쓸 수 있는 경로에 주면 그 사용자의 아무 실행 파일이나 예외를 얻는다(Codex 1R).
#       그래서 크롬을 root 소유 /opt/hanjul-chrome/<판> 에 두고, 프로필 · 워커(OUTREACH_RENDER_CHROME) · 보안 감시가 그 경로 하나만 쓴다.
#   판 = puppeteer 가 기대하는 크롬(administrator 의 ~/.cache/puppeteer 에 npm install 이 받아 둔 것).
#   puppeteer 를 올린 배포마다 다시 돌린다(보안 감시가 판 어긋남을 경보한다).
# 사용(root): bash /home/administrator/targetup-app/scripts/install-render-chrome.sh
# ============================================================================
set -euo pipefail
APP_USER="${APP_USER:-administrator}"
APP_ROOT="${APP_ROOT:-/home/${APP_USER}/targetup-app}"
BASE=/opt/hanjul-chrome
PROFILE_SRC="${APP_ROOT}/scripts/apparmor/puppeteer-chrome"
PROFILE_DST=/etc/apparmor.d/hanjul-render-chrome

[[ "$(id -u)" -eq 0 ]] || { echo "root 로 실행해야 한다"; exit 2; }

# 1) puppeteer 가 기대하는 크롬 경로(그 사용자 · 그 HOME 으로 묻는다)
expected="$(runuser -u "${APP_USER}" -- bash -c "cd '${APP_ROOT}/packages/backend' && HOME='/home/${APP_USER}' node -e 'import(\"puppeteer\").then(async(p)=>console.log(await p.default.executablePath()))'")"
[[ -x "${expected}" ]] || { echo "puppeteer 크롬이 없다(${expected}) — backend 에서 npm install 의 puppeteer postinstall 을 먼저 확인"; exit 1; }
src="$(dirname "$(dirname "${expected}")")"          # …/chrome/linux-<판>
ver="${src##*/linux-}"
[[ "${ver}" =~ ^[0-9.]+$ ]] || { echo "판을 못 읽었다(${src})"; exit 1; }
dest="${BASE}/${ver}"

# 2) root 소유로 복사(이미 있으면 그대로) · 사용자 쓰기 0
mkdir -p "${BASE}"
if [[ ! -d "${dest}" ]]; then
  rm -rf "${dest}.tmp"
  cp -a "${src}" "${dest}.tmp"
  mv "${dest}.tmp" "${dest}"
fi
chown -R root:root "${BASE}"
chmod -R u=rwX,go=rX "${BASE}"

# 3) AppArmor 프로필(경로 글롭이 판 폴더까지 덮는다 — current 를 바꾸기 전에 후보 판으로 시험한다)
install -m 644 "${PROFILE_SRC}" "${PROFILE_DST}"
apparmor_parser -r "${PROFILE_DST}"

# 4) 후보 판을 그 사용자로 샌드박스 기동 시험(빈 페이지 · 바깥 접속 0) — 실패면 current 를 그대로 두고 끝낸다(Codex 2R)
#    「성공」의 정의 = render-chrome-probe.sh 한 곳(종료 코드 0 + DOM · 매일 감시와 같은 판정 · Codex 3R)
if ! verdict="$(runuser -u "${APP_USER}" -- bash "${APP_ROOT}/scripts/render-chrome-probe.sh" "${dest}/chrome-linux64/chrome")"; then
  echo "후보 ${dest} 샌드박스 기동 = 실패(current 그대로 = $(readlink -f "${BASE}/current" 2>/dev/null || echo 없음)): ${verdict}"
  exit 1
fi

# 5) 통과한 뒤에만 current 를 원자적으로 바꾼다(임시 링크 → rename)
ln -sfnT "${dest}" "${BASE}/current.tmp"
mv -Tf "${BASE}/current.tmp" "${BASE}/current"
echo "샌드박스 기동 = 정상 · current = $(readlink -f "${BASE}/current")"
ls -1 "${BASE}"
