#!/bin/bash
# 백업 암호문 판정 계약 시험 (ROOT-LEDGER R110)
#
# 2026-11-27 03:00 MySQL 산출물 첫 바이트가 85 02 0b 03 이라 `file` 이 "GPG encrypted data" 로 불렀고,
# 좁은 판정 문구(PGP…encrypted 만)가 이 암호문을 실패로 보고 백업을 멈췄다(평소 꼴 85 02 0c 03 = "PGP RSA encrypted session key …").
# 판정 = 스크립트마다 함수 한 줄 is_pgp_ciphertext() { file -b "$1" | grep -qiE '…'; } (문구는 함수 안 글자 · 변수 없음)
# 셸 문법을 풀지 않는다 — 줄 단위 규칙만 본다(전체 주석 줄만 뺌):
#   1) 함수 이름이 든 줄 = 고정 꼴 정의 정확히 하나 + 나머지는 모두 고정 꼴 부름 is_pgp_ciphertext "…" ||
#      (어떤 꼴의 재정의든 빨간불) · 부르는 줄 수 >= 암호화(--encrypt) 줄 수
#   2) file 명령 · encrypted 가 든 코드 줄 = 같은 정의 한 줄뿐(다른 자리 판정 · 좁은 문구가 남으면 빨간불)
#   3) 정의는 env 파일 source 뒤
#   4) backup.sh 의 정의 줄을 그대로 실행해, 실제 file 로 암호문 꼴 셋은 받고 gzip · 평문은 막는가
# 실행: bash scripts/tests/backup-pgp-label.test.sh  (file 명령 필요)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$SCRIPT_DIR/.."
FAILED=0
PASSED=0
ok()  { PASSED=$((PASSED + 1)); echo "  PASS  $1"; }
bad() { FAILED=$((FAILED + 1)); echo "  FAIL  $1"; }

command -v file >/dev/null || { echo "file 명령이 없어 시험을 돌릴 수 없습니다"; exit 1; }

DEF_RE="^[0-9]+:is_pgp_ciphertext\(\) \{ file -b \"\\\$1\" \| grep -qiE '[^']+'; \}$"
CALL_RE='^[0-9]+:[[:space:]]*is_pgp_ciphertext "[^"]+" \|\| '
BACKUP_DEF=""

# 스크립트 하나의 줄 단위 규칙 판정 · 부르는 줄 수를 TOTAL 에 더한다
check_script() {
  local f="$1" name code filecmd gpgs enc named ncall def src_last def_n l
  name="$(basename "$f")"
  code="$(grep -nvE '^[[:space:]]*#' "$f")"
  gpgs=$(printf '%s\n' "$code" | grep -c -- '--encrypt')
  named="$(printf '%s\n' "$code" | grep 'is_pgp_ciphertext')"
  [ "$gpgs" -eq 0 ] && [ -z "$named" ] && return 0

  # 함수 이름이 든 줄 = 고정 꼴 정의 정확히 하나 + 나머지는 모두 고정 꼴 부름(어떤 꼴의 재정의든 빨간불)
  def="$(printf '%s\n' "$named" | grep -E "$DEF_RE")"
  if [ "$(printf '%s\n' "$def" | grep -c .)" = "1" ]; then ok "$name 판정 함수 정의 = 고정 꼴 하나"
  else bad "$name 고정 꼴 판정 함수 정의가 하나가 아님: $(printf '%s' "$def" | tr '\n' ' ')"; def=""; fi
  ncall=0
  while IFS= read -r l; do
    [ -z "$l" ] || [ "$l" = "$def" ] && continue
    if printf '%s\n' "$l" | grep -qE "$CALL_RE"; then ncall=$((ncall + 1)); ok "$name:${l%%:*} 부름 = 고정 꼴"
    else bad "$name 고정 꼴이 아닌 줄(재정의 · 다른 꼴 부름): $l"; fi
  done <<< "$named"

  # file 명령 · encrypted 가 든 코드 줄 = 그 정의 한 줄뿐(다른 자리에서 file 이름표로 판정하면 빨간불)
  filecmd="$(printf '%s\n' "$code" | grep -E '(^[0-9]+:|[;|&({[:space:]])file[[:space:]]')"
  [ -n "$def" ] && [ "$filecmd" = "$def" ] && ok "$name file 명령 줄 = 정의 하나" || bad "$name file 명령이 든 코드 줄이 정의 하나가 아님: $(printf '%s' "$filecmd" | tr '\n' ' ')"
  enc="$(printf '%s\n' "$code" | grep -i 'encrypted')"
  [ -n "$def" ] && [ "$enc" = "$def" ] && ok "$name encrypted 줄 = 정의 하나" || bad "$name encrypted 가 든 코드 줄이 정의 하나가 아님: $(printf '%s' "$enc" | tr '\n' ' ')"
  [ "$ncall" -ge "$gpgs" ] && ok "$name 암호화 ${gpgs}줄 · 부름 ${ncall}줄" || bad "$name 암호화 ${gpgs}줄 · 부름 ${ncall}줄"

  src_last=$(printf '%s\n' "$code" | grep -E '[:;{&[:space:]]source[[:space:]]+["$]' | tail -1 | cut -d: -f1)
  def_n="${def%%:*}"
  if [ -n "$def" ] && { [ -z "$src_last" ] || [ "$def_n" -gt "$src_last" ]; }; then ok "$name 정의 위치 = source 뒤(${src_last:-없음} < ${def_n})"
  else bad "$name 정의(${def_n:-없음})가 source(${src_last:-없음}) 뒤가 아님"; fi

  [ "$name" = "backup.sh" ] && BACKUP_DEF="${def#*:}"
  TOTAL=$((TOTAL + ncall))
}

echo "[1] 줄 단위 규칙"
TOTAL=0
for f in "$SCRIPTS"/*.sh; do check_script "$f"; done
[ "$TOTAL" -gt 0 ] && ok "부름 합계 ${TOTAL}줄" || bad "부름 0줄(추출 실패)"

echo "[2] backup.sh 정의 줄을 실행해 실제 file 이름표로 판정"
[ -n "$BACKUP_DEF" ] || { bad "backup.sh 정의를 못 뽑음"; echo "결과: PASS $PASSED · FAIL $FAILED"; exit 1; }
eval "$BACKUP_DEF"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
head -c 600 /dev/urandom > "$T/body"
mk() { printf "$2" | cat - "$T/body" > "$T/$1"; }
mk len0c.gpg '\x85\x02\x0c\x03\x37\xb5\x2d\x2e\xa5\x0e\x19\x3f\x01\x10\x00'   # 평소 꼴
mk len0b.gpg '\x85\x02\x0b\x03\x37\xb5\x2d\x2e\xa5\x0e\x19\x3f\x01\x0f\xf8'   # 11-27 MySQL 꼴
mk len0a.gpg '\x85\x02\x0a\x03\x37\xb5\x2d\x2e\xa5\x0e\x19\x3f\x01\x0f\xf0'
echo "-- SQL dump" | gzip > "$T/plain.gz"
echo "-- SQL dump" > "$T/plain.sql"
expect() {
  local name="$1" want="$2" got
  if is_pgp_ciphertext "$T/$name"; then got=pass; else got=block; fi
  [ "$got" = "$want" ] && ok "$name → $want ($(file -b "$T/$name"))" || bad "$name 기대 $want · 실제 $got ($(file -b "$T/$name"))"
}
expect len0c.gpg pass
expect len0b.gpg pass
expect len0a.gpg pass
expect plain.gz block
expect plain.sql block

echo
echo "결과: PASS $PASSED · FAIL $FAILED"
[ "$FAILED" -eq 0 ]
