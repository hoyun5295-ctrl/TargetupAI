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
#      ★2026-07-28 재조정(50KB → 52KB): 카드 스키마 전환 직후가 51KB다. 경고선을 현재값 아래에 두면
#      매 실행마다 울려 경고가 무의미해지고, 너무 위에 두면 늦는다. 현재값 +1KB 지점에 둔다.
if [ "$T" -le 61440 ] && [ "$T" -gt 53248 ]; then
  say "경고: 상시 로드 합계 ${T}B > 52KB — 상한(60KB)까지 여유가 줄었다. 급해지기 전에 회전·통폐합 검토."
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

# 3-2) STATUS §2 트랙 카드 4줄 상한 (★2026-07-28 신설 — 카드 스키마의 기계 강제판)
#      제목 1줄 + 인용 3줄(SoT·기억·다음 / ⛔ / 잔여)이 상한. 네 줄째 인용이 붙는 순간
#      경위 재서술이 시작된 것이다 — 그 서술은 SoT 문서와 memory가 소유한다(doc_ownership).
#      "다음 세션"(예정 목록)과 "완료분 잔여"(표 + 회전 이력)는 트랙 카드가 아니라 제외한다.
OVER=$(awk '
  /^## 2\) CURRENT_TASK/ {in2=1}
  in2 && /^## 3\)/ {in2=0}
  !in2 {next}
  /^### / { if (n>3 && t !~ /다음 세션|완료분 잔여/) print t " (인용 " n "줄)"; t=$0; sub(/^### /,"",t); n=0; next }
  /^> / { n++ }
  END { if (n>3 && t !~ /다음 세션|완료분 잔여/) print t " (인용 " n "줄)" }
' status/STATUS.md 2>/dev/null)
if [ -n "$OVER" ]; then
  say "위반: STATUS §2 카드가 4줄(제목+인용 3줄)을 넘었다 — $(echo "$OVER" | tr '\n' ';') · 경위·수치는 SoT 문서·memory로 옮기고 카드는 SoT·기억·다음 / ⛔ / 잔여 3줄로."
  FAIL=1
fi

# 3-3) STATUS §2 인용줄 길이 상한 (★2026-07-28 신설 — 3-2 줄 수 게이트의 사각)
#      줄 수만 세면 한 줄에 무한정 쓸 수 있다. 실제로 그렇게 됐다(카드 전환 직후 최장 592B).
#      길이는 재서술의 대리 지표다 — 480B(한글 약 160자)를 넘으면 그 문장은 SoT 문서·memory 몫이다.
#      LC_ALL=C라 length()는 바이트 수다.
LONG=$(awk '
  /^## 2\) CURRENT_TASK/ {a=1}
  a && /^## 3\)/ {a=0}
  a && /^> / { if (length($0) > 480) printf "%dB \"%s…\"; ", length($0), substr($0, 3, 30) }
' status/STATUS.md 2>/dev/null)
if [ -n "$LONG" ]; then
  say "위반: STATUS §2 인용줄이 480B를 넘었다 — ${LONG}· 한 줄에 몰아 적는 것도 재서술이다. 경위·수치는 SoT 문서·memory로."
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
#    ★2026-07-28 하향(25 → 15): 이 표가 프로젝트마다 한 행씩 늘던 것이 상시 로드 팽창의 절반이었다.
#    프로젝트 SoT는 SOT-INDEX.md(상시 로드 아님)가 받는다. 이 표는 도메인 문서 전용으로 고정한다.
#    상한을 현재 행 수(13)에 딱 맞추지 않는다 — 새 도메인 문서 하나에 바로 위반이 나면 게이트가 일을 못 한다.
if [ "$R" -gt 15 ]; then
  say "위반: 라우팅 표 ${R}행 > 15행 — 프로젝트 SoT는 이 표가 아니라 status/SOT-INDEX.md에 등재한다. 도메인 문서 신규 등재라면 통폐합 먼저."
  FAIL=1
fi

# 6) status 루트 신규 .md = 라우팅 표 등재 의무 (미등재 문서 검출)
#    ★2026-07-28: 등재처가 둘로 나뉘었다 — 도메인 문서는 STATUS 라우팅 표, 프로젝트 SoT는 SOT-INDEX.md.
#    둘 중 어디에도 없으면 위반. (STATUS 한 곳만 보면 SOT-INDEX로 옮긴 문서가 전부 미등재로 잡힌다)
ALLOW="STATUS.md LESSONS_LEARNED.md"
for f in status/*.md; do
  base=$(basename "$f")
  case " $ALLOW " in *" $base "*) continue;; esac
  if ! grep -q "$base" status/STATUS.md && ! grep -q "$base" status/SOT-INDEX.md 2>/dev/null; then
    say "위반: status/$base 가 라우팅 표·SOT-INDEX 어디에도 미등재 — doc_ownership 룰. 등재하거나 archive/로 이동."
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
