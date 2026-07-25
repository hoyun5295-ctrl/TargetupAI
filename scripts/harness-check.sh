#!/usr/bin/env bash
# harness-check.sh — 관제탑 문서 규율 기계 검증 (2026-07-03 관제탑 재설계 v2)
# doc_routing / doc_ownership 룰의 기계 강제판. 훅(PostToolUse)과 수동 실행 겸용.
# 사용: bash scripts/harness-check.sh   (repo 루트 기준. 위반 시 exit 1 + 사유 출력)
set -u
export LC_ALL=C # 로케일 무관 고정 — 환경별 grep collation 차이 차단 (byte-wise 매칭, 한글 안전)
cd "$(dirname "$0")/.." || exit 0

FAIL=0
say() { echo "[harness-check] $1"; }

# 1) STATUS.md 30KB 상한 (doc_ownership: 초과 = 회전 미이행 — 즉시 아카이브 회전)
S=$(wc -c < status/STATUS.md 2>/dev/null || echo 0)
if [ "$S" -gt 30720 ]; then
  say "위반: STATUS.md ${S}B > 30KB — 회전 룰 미이행. 완료 엔트리를 archive/TASKS_YYYY-MM.md로 원문 이동 + INDEX 등재 + 최근 완료 인덱스 1줄화."
  FAIL=1
fi

# 2) 상시 로드 합계 60KB 상한 (CLAUDE.md + STATUS.md)
C=$(wc -c < CLAUDE.md 2>/dev/null || echo 0)
T=$((S + C))
if [ "$T" -gt 61440 ]; then
  say "위반: 상시 로드 합계 ${T}B > 60KB (CLAUDE ${C} + STATUS ${S}) — 룰은 늘리지 말고 다듬어라. 중복 룰 통폐합 우선."
  FAIL=1
fi

# 2-1) 조기 경고 50KB (★2026-07-25 신설 — 벽에 부딪혀 급히 깎는 일 방지)
#      상한(60KB)에 닿아서야 회전하면 매 세션 압축에 시간을 쓴다. 여유 10KB 남았을 때 미리 알린다.
if [ "$T" -le 61440 ] && [ "$T" -gt 51200 ]; then
  say "경고: 상시 로드 합계 ${T}B > 50KB — 상한(60KB)까지 여유가 줄었다. 급해지기 전에 회전·통폐합 검토."
fi

# 3) CLAUDE.md 단독 35KB 경고선 (팽창 감시 — 위반은 아님, 경고)
if [ "$C" -gt 35840 ]; then
  say "경고: CLAUDE.md ${C}B > 35KB — 팽창 추세. 다음 정비 때 중복 룰 통폐합 검토."
fi

# 3-1) STATUS "완료분 잔여" 항목 수 상한 (★2026-07-25 신설 — 이 표가 재팽창의 진원지였다)
#      완료 서술은 archive가 소유한다. STATUS에는 남은 일이 있는 건만 한 줄씩.
D=$(awk '/^### 완료분 잔여/,/^## /' status/STATUS.md 2>/dev/null | grep -c '^| ' || echo 0)
D=$((D > 1 ? D - 1 : 0)) # 헤더 1행만 제외 (구분선 |--- 는 '^| ' 에 애초에 안 걸린다)
if [ "$D" -gt 20 ]; then
  say "위반: 완료분 잔여 ${D}행 > 20행 — 실측이 끝난 건은 지우고, 서술은 archive/TASKS_YYYY-MM.md에 맡겨라."
  FAIL=1
fi

# 4) LESSONS_META 5KB 상한 (매 답변 정독 문서 — 경량 유지가 전제)
M=$(wc -c < status/lessons/LESSONS_META.md 2>/dev/null || echo 0)
if [ "$M" -gt 5120 ]; then
  say "위반: LESSONS_META.md ${M}B > 5KB — 사례 서사는 archive/LESSONS_META_ORIGINAL-*.md로, META에는 1줄 룰만."
  FAIL=1
fi

# 5) 라우팅 표 25행 상한 (초과 = 문서 통폐합 먼저)
R=$(awk '/^## 1\) 라우팅 표/,/^---$/' status/STATUS.md 2>/dev/null | grep -c '^| ' || echo 0)
R=$((R > 1 ? R - 1 : 0)) # 헤더 1행만 제외 (구분선 |------ 는 '^| ' 에 애초에 안 걸린다 — 2를 빼면 1행씩 적게 세어 상한이 26으로 느슨해졌다. 2026-07-25 정정)
if [ "$R" -gt 25 ]; then
  say "위반: 라우팅 표 ${R}행 > 25행 — 신규 등재 전 문서 통폐합 먼저."
  FAIL=1
fi

# 6) status 루트 신규 .md = 라우팅 표 등재 의무 (미등재 문서 검출)
ALLOW="STATUS.md LESSONS_LEARNED.md"
for f in status/*.md; do
  base=$(basename "$f")
  case " $ALLOW " in *" $base "*) continue;; esac
  if ! grep -q "$base" status/STATUS.md; then
    say "위반: status/$base 가 라우팅 표에 미등재 — doc_ownership 룰. 등재하거나 archive/로 이동."
    FAIL=1
  fi
done

# 7) 아카이브 INDEX 링크 무결성 (TASKS/DESIGNS 대상 존재)
#    로케일 무관 패턴([^)]) — 한글 파일명 범위(가-힣)는 grep 로케일에 따라 "Invalid collation character"로
#    조용히 실패해 검사가 통째로 건너뛰어진다(2026-07-03 Harold 실행에서 실증). 절대 문자 범위 사용 금지.
if [ -f status/archive/INDEX.md ]; then
  LINKS=$(grep -oE '\]\([^)]+\.md\)' status/archive/INDEX.md | sed 's/^](//; s/)$//' | sort -u)
  if [ -z "$LINKS" ]; then
    say "위반: INDEX 링크 추출 0건 — 링크 검사 자체가 실패한 상태(패턴/로케일 점검)."
    FAIL=1
  fi
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if [ ! -f "status/archive/$rel" ]; then
      say "위반: archive/INDEX.md 링크 깨짐 — status/archive/$rel 없음."
      FAIL=1
    fi
  done <<< "$LINKS"
fi

if [ "$FAIL" = "0" ]; then
  say "통과: STATUS ${S}B / CLAUDE ${C}B / 합계 ${T}B / META ${M}B / 라우팅 ${R}행 / 완료잔여 ${D}행 / INDEX 링크 정상"
fi
exit $FAIL
