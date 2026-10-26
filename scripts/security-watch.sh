#!/bin/bash
# ============================================================================
# 한줄로 보안 감시(매일) — 새 취약점 · 런타임 지원 종료 · 서버 보안 업데이트 · 재부팅 대기 · 렌더 크롬 샌드박스
#   2026-10-27 = 운영 의존성 취약 판이 32건까지 아무도 모르게 쌓였고, 서버 Node 20 은 지원이 끝난 지 6개월이었다
#   (보안 설계서 docs/2026-08-09-security-architecture-design.md §3-9-1). 쌓이기 전에 사람에게 닿게 한다.
#   경보 = 공용 입구 ops-alert(문자 + 메일 · ROOT-LEDGER R14).
# 판정:
#   ① 운영 의존성(npm audit --omit=dev): 치명 · 높음 1건 이상 = 경보 · 보통 · 낮음은 지난번보다 늘면 경보
#      기준값(상태 파일)은 경보가 실제로 나간 뒤에만 바꾼다 — 전송이 실패하면 다음 실행이 같은 경보를 다시 낸다(Codex 1R)
#   ② Node 지원 종료까지 NODE_EOL_WARN_DAYS(180)일 미만 · 이미 끝났으면 경보(nodejs/Release schedule.json)
#   ③ 서버 보안 업데이트 대기 1건 이상 · ④ 재부팅 필요 표시가 REBOOT_WARN_DAYS(3)일 이상
#   ⑤ 렌더 크롬(root 전용 경로)이 샌드박스로 뜨는가(빈 페이지 1회 · 바깥 접속 0) · 그 판이 puppeteer 가 기대하는 판인가 ·
#      렌더 워커 /health 가 ok · sandbox=true · sandboxError 없음을 스스로 말하는가(말하지 않으면 = 옛 판 · 감시 불가로 경보)
#   감시 자체가 실패한 항목(목록 못 받음 · 명령 없음)도 경보에 싣는다 — 안 도는 감시는 없는 감시보다 나쁘다.
# cron(administrator · 매일 08:40 = 무인 보안 업데이트 뒤 · 업무 시작 전):
#   40 8 * * * /home/administrator/targetup-app/scripts/security-watch.sh >> /home/administrator/backups/security-watch.log 2>&1
# ============================================================================
set -uo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# 경보 = 공용 입구(R14)
OPS_ALERT="${OPS_ALERT:-/usr/local/bin/ops-alert}"
STATE_DIR="${SECURITY_WATCH_STATE:-/home/administrator/.security-watch}"
APP_ROOT="${SECURITY_WATCH_APP_ROOT:-/home/administrator/targetup-app}"
AUDIT_DIRS="${SECURITY_WATCH_DIRS:-${APP_ROOT}/packages/backend ${APP_ROOT}/packages/frontend /home/administrator/hanjuldm-app/packages/backend}"
NODE_EOL_WARN_DAYS="${SECURITY_WATCH_NODE_EOL_DAYS:-180}"
REBOOT_WARN_DAYS="${SECURITY_WATCH_REBOOT_DAYS:-3}"
RENDER_HEALTH="${SECURITY_WATCH_RENDER_HEALTH:-http://127.0.0.1:4317/health}"
# 렌더 크롬 = ecosystem.config.js 의 OUTREACH_RENDER_CHROME 과 같은 값(R7 넓힘 1027 시험이 대조)
SECURITY_WATCH_CHROME="${SECURITY_WATCH_CHROME:-/opt/hanjul-chrome/current/chrome-linux64/chrome}"
NODE_SCHEDULE_URL="https://raw.githubusercontent.com/nodejs/Release/main/schedule.json"

mkdir -p "${STATE_DIR}"
alerts=()
baseline_keys=()
baseline_vals=()
stamp(){ date '+%F %T'; }
add(){ alerts+=("$*"); echo "[$(stamp)] 경보: $*"; }
ok(){ echo "[$(stamp)] 정상: $*"; }

# ── ① 운영 의존성 ────────────────────────────────────────────────────────────
for d in ${AUDIT_DIRS}; do
  name="${d#/home/administrator/}"
  if [[ ! -f "${d}/package-lock.json" ]]; then add "${name} 의존성 감시 불가(package-lock.json 없음)"; continue; fi
  counts="$(cd "${d}" && npm audit --omit=dev --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).metadata.vulnerabilities;console.log([v.critical,v.high,v.moderate,v.low].join(" "))}catch(e){console.log("ERR")}})')"
  if [[ ! "${counts}" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]; then add "${name} 의존성 감시 실패(npm audit 응답을 못 읽음)"; continue; fi
  read -r c h m l <<< "${counts}"
  key="${STATE_DIR}/audit-$(echo "${name}" | tr '/' '_')"
  prev="$(cat "${key}" 2>/dev/null || true)"
  if (( c + h > 0 )); then
    add "${name} 운영 의존성 치명 ${c} · 높음 ${h}(보통 ${m} · 낮음 ${l})"
  elif [[ "${prev}" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]; then
    read -r pc ph pm pl <<< "${prev}"
    if (( m > pm || l > pl )); then add "${name} 운영 의존성 경보 늘어남(보통 ${pm}→${m} · 낮음 ${pl}→${l})"
    else ok "${name} 치명 0 · 높음 0 · 보통 ${m} · 낮음 ${l}"; fi
  else
    ok "${name} 치명 0 · 높음 0 · 보통 ${m} · 낮음 ${l}(첫 기록)"
  fi
  baseline_keys+=("${key}"); baseline_vals+=("${counts}")
done

# ── ② Node 지원 종료 ─────────────────────────────────────────────────────────
major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
sched="$(curl -fsS -m 30 "${NODE_SCHEDULE_URL}" 2>/dev/null || true)"
if [[ ! "${major}" =~ ^[0-9]+$ ]]; then
  add "Node 판을 못 읽음"
elif [[ -z "${sched}" ]]; then
  add "Node 지원 일정을 못 받음(감시 실패 · ${NODE_SCHEDULE_URL})"
else
  end="$(echo "${sched}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=JSON.parse(s)["v"+process.argv[1]];console.log(e&&e.end?e.end:"")}catch(x){console.log("")}})' "${major}")"
  if [[ ! "${end}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    add "Node ${major} 지원 일정이 목록에 없음(지원이 끝난 판일 수 있음)"
  else
    days=$(( ( $(date -d "${end}" +%s) - $(date +%s) ) / 86400 ))
    if (( days < 0 )); then add "Node ${major} 지원이 ${end} 에 끝났다(${days#-}일 지남) — 보안판이 더 안 나온다 · 지금 LTS 로 올릴 것"
    elif (( days < NODE_EOL_WARN_DAYS )); then add "Node ${major} 지원 종료까지 ${days}일(${end}) — 다음 LTS 로 올릴 때"
    else ok "Node ${major} 지원 종료까지 ${days}일(${end})"; fi
  fi
fi

# ── ③ 서버 보안 업데이트 대기 ───────────────────────────────────────────────
if [[ -x /usr/lib/update-notifier/apt-check ]]; then
  ac="$(/usr/lib/update-notifier/apt-check 2>&1 | tail -1)"
  all="${ac%%;*}"; sec="${ac#*;}"
  if [[ "${all}" =~ ^[0-9]+$ && "${sec}" =~ ^[0-9]+$ ]]; then
    if (( sec > 0 )); then add "서버 보안 업데이트 대기 ${sec}건(전체 대기 ${all})"
    else ok "보안 업데이트 대기 0(전체 대기 ${all})"; fi
  else
    add "보안 업데이트 수를 못 읽음(${ac:0:80})"
  fi
else
  add "apt-check 없음(보안 업데이트 대기 감시 불가)"
fi

# ── ④ 재부팅 필요 표시 ───────────────────────────────────────────────────────
if [[ -f /var/run/reboot-required ]]; then
  rdays=$(( ( $(date +%s) - $(stat -c %Y /var/run/reboot-required) ) / 86400 ))
  pkgs="$(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null | cut -c1-80)"
  if (( rdays >= REBOOT_WARN_DAYS )); then add "재부팅 필요 표시 ${rdays}일째(${pkgs:-패키지 목록 없음}) — 밤 창에 재부팅"
  else ok "재부팅 필요 표시 ${rdays}일째(기준 ${REBOOT_WARN_DAYS}일 미만)"; fi
else
  ok "재부팅 필요 표시 없음"
fi

# ── ⑤ 렌더 크롬 샌드박스 · 판 · 렌더 워커 ───────────────────────────────────
chrome="${SECURITY_WATCH_CHROME}"
if [[ ! -x "${chrome}" ]]; then
  add "렌더 크롬이 전용 경로에 없음(${chrome}) — scripts/install-render-chrome.sh(root)"
else
  # 「성공」의 정의 = render-chrome-probe.sh 한 곳(종료 코드 0 + DOM · 설치 스크립트와 같은 판정 · Codex 3R)
  if verdict="$(bash "${APP_ROOT}/scripts/render-chrome-probe.sh" "${chrome}")"; then ok "렌더 크롬 샌드박스 기동($(readlink -f "${chrome}" | cut -c1-80))"
  else add "렌더 크롬이 샌드박스로 안 뜸(${verdict})"; fi
  # puppeteer 가 기대하는 판(npm install 이 받아 둔 것)과 같은가 — 다르면 /opt 를 안 옮긴 것(낡은 크롬으로 바깥 사이트를 연다)
  expected="$(cd "${APP_ROOT}/packages/backend" 2>/dev/null && node -e 'import("puppeteer").then(async(p)=>console.log(await p.default.executablePath())).catch(()=>console.log(""))' 2>/dev/null || true)"
  want="$(echo "${expected}" | grep -o -E 'linux-[0-9.]+' | head -1)"; want="${want#linux-}"
  have="$(basename "$(dirname "$(dirname "$(readlink -f "${chrome}")")")")"
  if [[ -z "${want}" ]]; then add "puppeteer 기대 크롬 판을 못 읽음(감시 실패)"
  elif [[ "${want}" != "${have}" ]]; then add "렌더 크롬 판 어긋남(전용 경로 ${have} · puppeteer 기대 ${want}) — scripts/install-render-chrome.sh(root)"
  else ok "렌더 크롬 판 = puppeteer 기대 판(${want})"; fi
fi
health="$(curl -fsS -m 10 "${RENDER_HEALTH}" 2>/dev/null || true)"
if [[ -z "${health}" ]]; then
  add "렌더 워커 응답 없음(${RENDER_HEALTH})"
else
  verdict="$(echo "${health}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.ok!==true)return console.log("응답 ok 아님");if(Object.prototype.hasOwnProperty.call(j,"sandboxError")===false)return console.log("sandboxError 칸 없음(옛 판 워커 · 재기동 필요)");if(j.sandbox!==true)return console.log("sandbox=true 가 아님");if(j.sandboxError)return console.log("기동 실패 기록: "+String(j.sandboxError).slice(0,120));console.log("OK")}catch(e){console.log("응답을 못 읽음")}})')"
  if [[ "${verdict}" == "OK" ]]; then ok "렌더 워커 = 샌드박스 필수 판 · 기동 실패 기록 없음"
  else add "렌더 워커 ${verdict}"; fi
fi

# ── 결과 · 기준값은 경보가 나간 뒤에만 ──────────────────────────────────────
save_baselines(){ local i; for i in "${!baseline_keys[@]}"; do echo "${baseline_vals[$i]}" > "${baseline_keys[$i]}"; done; }
if (( ${#alerts[@]} > 0 )); then
  body="$(printf '%s\n' "${alerts[@]}")"
  if [[ -x "${OPS_ALERT}" ]] && "${OPS_ALERT}" "한줄로 보안 감시 ${#alerts[@]}건" "${body}"; then
    save_baselines
  else
    echo "[$(stamp)] 공용 경보(${OPS_ALERT}) 전송 실패 — 기준값을 그대로 두어 다음 실행이 같은 경보를 다시 낸다"
  fi
  exit 1
fi
save_baselines
echo "[$(stamp)] OK: 보안 감시 이상 없음"
