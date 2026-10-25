#!/bin/bash
# ============================================================================
# 운영 경보 공용 입구 — 문자 + 메일 두 길 (ROOT-LEDGER R14 · 설계 docs/2026-10-25-agent-watchdog-design.md §5-B)
#
#   2026-10-25 = 65번이 hanjul03 멈춤을 10분 만에 잡고도 화면에만 적었고, 운영자 문자는 전부
#   16번 라인 → 65번 한 길이라 그 길이 죽으면 알릴 길이 없었다. 운영 경보는 이 입구 하나로만 보낸다.
#
# 사용: ops-alert "<제목>" "<본문>"
#   문자 = ALERT_CMD(기존 · 백업 경보와 같은 명령) — ALERT_SMS_ENV 파일에서 읽는다(기본 /home/administrator/backups/.env)
#   메일 = 하이웍스 SMTP — OPS_ALERT_MAIL_ENV 파일(기본 /etc/bito-ops-alert.env · root:administrator 640)
#          SMTP_URL · SMTP_USER · SMTP_PASS · MAIL_FROM · MAIL_TO(쉼표)
#   한 길이 실패해도 다른 길은 간다. 둘 다 실패하면 exit 1. 비밀번호는 명령 인자에 싣지 않는다(curl -K 표준입력).
#
# 서버 배포(root): install -m 755 scripts/ops-alert.sh /usr/local/bin/ops-alert
# ============================================================================
set -uo pipefail

SUBJECT="${1:-}"
BODY="${2:-}"
[[ -n "${SUBJECT}" ]] || { echo "사용: ops-alert <제목> <본문>" >&2; exit 2; }

SMS_ENV="${ALERT_SMS_ENV:-/home/administrator/backups/.env}"
MAIL_ENV="${OPS_ALERT_MAIL_ENV:-/etc/bito-ops-alert.env}"

note(){ logger -t ops-alert -- "$*" 2>/dev/null || true; echo "[ops-alert] $*"; }

sms_ok=0
mail_ok=0

# ── 1) 문자: 기존 ALERT_CMD (출력 alert_http=코드 · 2xx 만 성공) ─────────────
send_sms(){
  [[ -r "${SMS_ENV}" ]] || { note "문자 건너뜀: ${SMS_ENV} 못 읽음"; return 1; }
  local text out code
  # 문자 본문은 한 줄로 · 따옴표 · 역슬래시는 걷는다(ALERT_CMD 가 JSON 에 그대로 싣는다)
  text="$(printf '%s %s' "${SUBJECT}" "${BODY}" | tr '\n' ' ' | tr -d '"\\' | cut -c1-900)"
  out="$( ( set -a; source "${SMS_ENV}" >/dev/null 2>&1; set +a
            [[ -n "${ALERT_CMD:-}" ]] || { echo "ALERT_CMD 없음"; exit 3; }
            ALERT_MSG="${text}" timeout 20 bash -c "${ALERT_CMD}" ) 2>&1 )"
  code=$?
  # 성공 = 끝까지 돌았고 알림 API 가 2xx 를 돌려줬다(코드가 안 찍히면 성공으로 치지 않는다)
  if [[ ${code} -eq 0 ]] && grep -q 'alert_http=2[0-9][0-9]' <<<"${out}"; then
    note "문자 성공 $(grep -o 'alert_http=[0-9]*' <<<"${out}" | tail -1)"
    return 0
  fi
  note "문자 실패 exit=${code} $(grep -o 'alert_http=[0-9]*' <<<"${out}" | tail -1)"
  return 1
}

# ── 2) 메일: 하이웍스 SMTP 직접 ───────────────────────────────────────────
send_mail(){
  [[ -r "${MAIL_ENV}" ]] || { note "메일 건너뜀: ${MAIL_ENV} 못 읽음"; return 1; }
  local SMTP_URL="" SMTP_USER="" SMTP_PASS="" MAIL_FROM="" MAIL_TO="" k v
  # source 하지 않는다(비밀번호에 $ · 공백이 있어도 그대로)
  while IFS='=' read -r k v; do
    v="${v%$'\r'}"
    case "${k}" in
      SMTP_URL|SMTP_USER|SMTP_PASS|MAIL_FROM|MAIL_TO) printf -v "${k}" '%s' "${v}" ;;
    esac
  done < "${MAIL_ENV}"
  SMTP_URL="${SMTP_URL:-smtps://smtps.hiworks.com:465}"
  [[ -n "${SMTP_USER}" && -n "${SMTP_PASS}" && -n "${MAIL_FROM}" && -n "${MAIL_TO}" ]] || { note "메일 건너뜀: 설정 빠짐"; return 1; }

  local tmp rcpts=() list=() r esc_user esc_pass out code
  tmp="$(mktemp)" || { note "메일 실패: 임시 파일"; return 1; }
  IFS=',' read -r -a list <<<"${MAIL_TO}"
  for r in "${list[@]}"; do r="${r// /}"; [[ -n "${r}" ]] && rcpts+=(--mail-rcpt "${r}"); done
  {
    printf 'From: %s\n' "${MAIL_FROM}"
    printf 'To: %s\n' "${MAIL_TO}"
    printf 'Subject: =?UTF-8?B?%s?=\n' "$(printf '%s' "${SUBJECT}" | base64 -w0)"
    printf 'Date: %s\n' "$(LC_ALL=C date -R)"
    printf 'MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n'
    printf '%s\n\n— %s · %s\n' "${BODY}" "$(hostname)" "$(date '+%F %T %Z')" | base64 -w76
  } > "${tmp}"
  esc_user="$(printf '%s' "${SMTP_USER}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  esc_pass="$(printf '%s' "${SMTP_PASS}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  out="$(printf 'user = "%s:%s"\n' "${esc_user}" "${esc_pass}" \
    | curl -K - --ssl-reqd --url "${SMTP_URL}" --mail-from "${MAIL_FROM}" "${rcpts[@]}" \
           -T "${tmp}" --crlf --max-time 20 -sS 2>&1)"
  code=$?
  rm -f "${tmp}"
  if [[ ${code} -eq 0 ]]; then note "메일 성공 ${MAIL_TO}"; return 0; fi
  note "메일 실패 curl=${code} $(printf '%s' "${out}" | tr '\n' ' ' | cut -c1-200)"
  return 1
}

send_sms && sms_ok=1
send_mail && mail_ok=1
note "결과 문자=${sms_ok} 메일=${mail_ok} · ${SUBJECT}"
(( sms_ok + mail_ok > 0 )) || exit 1
exit 0
