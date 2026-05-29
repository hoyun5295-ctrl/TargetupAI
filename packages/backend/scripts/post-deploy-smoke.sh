#!/usr/bin/env bash
# ★ D227+ (2026-05-28) 배포 후 핵심 read endpoint 스모크 체크
#
# 목적: campaigns.alimtalk_template_code 같은 "없는 컬럼 SELECT" SQL 에러를 배포 직후 즉시 감지.
#   이번 D227+ 사고 = tsc 통과 + 인증 통과 후 SQL 500 → 토큰 없는 curl(401에서 막힘)로는 못 잡음.
#   → SMOKE_TOKEN(테스트계정 admin 토큰) 환경변수로 실제 endpoint 호출 → 200 확인 의무.
#
# 사용:
#   1) 서버 .env 또는 export 로 SMOKE_TOKEN 설정 (테스트계정 hoyun 등 admin JWT)
#   2) pm2 restart all 직후 실행: bash packages/backend/scripts/post-deploy-smoke.sh
#   3) FAIL 1건이라도 = 배포 직후 즉시 점검 (운영 다운 30분 방치 차단)
#
# exit code: 0 = 전체 PASS / 1 = FAIL 1건+ (CI/배포 게이트 활용 가능)

set -uo pipefail

BASE="${SMOKE_BASE:-http://localhost:3000}"
TOKEN="${SMOKE_TOKEN:-}"
FAILED=0

echo "=== D227+ 배포 후 스모크 체크 ($BASE) ==="

# 1. health (인증 X) — 라우트 로딩 자체 확인
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)
if [ "$HEALTH" = "200" ]; then
  echo "[PASS] /health = 200"
else
  echo "[FAIL] /health = $HEALTH (backend 미기동 또는 포트 X)"
  FAILED=$((FAILED+1))
fi

# 2. 핵심 read endpoint — 토큰 없으면 401(라우트 살아있음) / 500이면 라우트 로딩 실패
#    토큰 있으면 200 의무 (이번 SQL 에러 = 인증 통과 후 발생 → 토큰 검증이 핵심)
ENDPOINTS=(
  "/api/v1/results/campaigns?fromDate=2026-05-01&toDate=2026-05-29&from=202605&limit=20|발송결과 목록"
  "/api/v1/results/summary?from=202605&fromDate=2026-05-01&toDate=2026-05-29|발송결과 요약"
  "/api/manage/scheduled?page=1&limit=50|예약조회"
)

for entry in "${ENDPOINTS[@]}"; do
  path="${entry%%|*}"
  label="${entry##*|}"
  if [ -n "$TOKEN" ]; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE$path" 2>/dev/null)
    if [ "$CODE" = "200" ]; then
      echo "[PASS] $label = 200 (토큰 검증)"
    else
      echo "[FAIL] $label = $CODE (SMOKE_TOKEN 유효 확인 + SQL 에러 점검 — pm2 logs targetup-backend | grep -i 'does not exist')"
      FAILED=$((FAILED+1))
    fi
  else
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null)
    # 토큰 없을 때: 401 = 라우트 정상(인증에서 막힘) / 500 = 라우트 로딩/초기화 실패
    if [ "$CODE" = "401" ] || [ "$CODE" = "200" ]; then
      echo "[PASS] $label = $CODE (라우트 정상 — SMOKE_TOKEN 설정 시 SQL 검증까지 확인 가능)"
    else
      echo "[FAIL] $label = $CODE (라우트 로딩 실패 의심)"
      FAILED=$((FAILED+1))
    fi
  fi
done

echo "=== 스모크 결과: $([ $FAILED -eq 0 ] && echo '전체 PASS' || echo "${FAILED}건 FAIL") ==="
[ $FAILED -eq 0 ] && exit 0 || exit 1
