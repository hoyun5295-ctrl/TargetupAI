#!/bin/bash
# Team 한줄로 다리 서비스 키(TEAM_BRIDGE_KEY)를 targetup 백엔드 .env 에 둔다 — 원장 C166-ENV-1 · 이 키를 만드는 유일한 자리.
#   이미 올바른 키(정확히 한 줄 · hex 64자)가 있으면 그대로 · 없으면 만들어 붙인다(마지막 줄 개행 보장) · 잘못된 키가 있으면 손대지 않고 멈춘다.
#   붙인 뒤 다시 읽어 확인한다. 값은 출력하지 않는다. Team 쪽 server/scripts/make-env.sh 는 이 값을 읽기만 한다.
#   사용(administrator): bash /home/administrator/targetup-app/packages/backend/scripts/team-bridge-key.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 대상은 이 백엔드 폴더의 .env 하나로 고정(덮어쓰기 변수 없음 · 경로 별칭으로 잠금이 갈리지 않게 · Codex C166 8R)
ENV_FILE=".env"
fail() { echo "❌ [team-bridge-key] $1"; exit 1; }

ensure_key() {
  [ -f "$ENV_FILE" ] || fail "$ENV_FILE 가 없습니다(백엔드 폴더에서 찾음)"
  # 세기부터 붙이고 다시 읽기까지 한 번에 하나(잠금 파일 = .env.lock · .gitignore 의 .env.* · Codex C166 7R #1)
  exec 8>"$ENV_FILE.lock"
  flock 8
  [ -r "$ENV_FILE" ] && [ -w "$ENV_FILE" ] || fail "$ENV_FILE 를 읽거나 쓸 수 없습니다(administrator 셸인지 확인)"
  local n key
  n="$(grep -c '^TEAM_BRIDGE_KEY=' "$ENV_FILE" || true)"
  if [ "$n" != 0 ]; then
    [ "$n" = 1 ] || fail "TEAM_BRIDGE_KEY 줄이 ${n}개입니다 — 손대지 않음(하나만 남기고 다시)"
    key="$(grep '^TEAM_BRIDGE_KEY=' "$ENV_FILE" | cut -d= -f2-)"
    [[ "$key" =~ ^[0-9a-f]{64}$ ]] || fail "TEAM_BRIDGE_KEY 값이 hex 64자가 아닙니다 — 손대지 않음(그 줄을 지우고 다시)"
    echo "✅ [team-bridge-key] 이미 있음(그대로)"
    return 0
  fi
  key="$(openssl rand -hex 32)"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || fail "openssl 로 키를 만들지 못했습니다"
  if [ -s "$ENV_FILE" ] && [ -n "$(tail -c1 "$ENV_FILE")" ]; then
    printf '\n' >> "$ENV_FILE"
  fi
  printf 'TEAM_BRIDGE_KEY=%s\n' "$key" >> "$ENV_FILE"
  [ "$(grep -c '^TEAM_BRIDGE_KEY=' "$ENV_FILE")" = 1 ] || fail "붙인 뒤 키 줄이 하나가 아닙니다 — 확인 필요"
  [ "$(grep '^TEAM_BRIDGE_KEY=' "$ENV_FILE" | cut -d= -f2-)" = "$key" ] || fail "붙인 키를 다시 읽지 못했습니다 — 확인 필요"
  echo "✅ [team-bridge-key] 넣음 · 다음 = 백엔드 재시작(pm2 restart targetup-backend --update-env · 적재 0건일 때)"
}

ensure_key
