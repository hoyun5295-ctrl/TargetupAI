#!/usr/bin/env bash
# ============================================================================
# 싱크에이전트 티어 × 드라이버 스모크 — 배포되는 zip을 그대로 풀어 실제 DB에 붙인다.
#
# 왜 있나: 2026-07-27 세션에 20조합 중 1개만 검증된 채 zip 20개가 서버에 올라갔다.
#   나머지를 손으로 확인하려면 조합마다 설치 마법사를 직접 타이핑해야 했다. 그 반복을 없앤다.
#   싱크에이전트 고객은 앞으로 늘어난다 — 검증이 비싸면 결국 아무도 안 하고 미검증이 나간다.
#
# 무엇을 보나 (드라이버 축):
#   ① 그 티어 바이너리가 그 환경에서 실행되는가
#   ② 커넥터가 그 DB에 실제로 붙는가
#   ③ 테이블 목록·컬럼 목록을 읽어오는가
#
# 무엇을 안 보나:
#   · 전체 동기화(한줄로 API 업로드) — 운영 DB에 데이터가 들어가므로 여기서 하지 않는다.
#   · 서비스 등록·재부팅 자동시작 — 대상 OS에서만 의미가 있다(VM 몫).
#   · Windows Server 실환경 — 이 스크립트는 Windows Server를 대신하지 못한다(mode=launch 주석 참조).
#
# 어떻게: 에이전트의 `--test-db`(비대화형·읽기 전용)를 쓴다.
#   2026-07-28 이전에는 대화형 마법사에 답을 흘려넣었는데, 답이 프롬프트보다 먼저 도착하면
#   node readline이 그 줄을 리스너 없이 버려 실행마다 다른 자리에서 입력이 밀렸다(재현 불가).
#   `--test-db`는 종료 코드로 성패를 알리고 결과를 한 줄 JSON으로 내므로 판정이 결정적이다.
#   ⚠ 이 명령은 **1.6.5부터** 있다. 그 이전 바이너리는 SKIP으로 뺀다(옛 exe에 이 인자를 주면
#     분기에 안 걸려 에이전트 본체나 마법사가 떠버린다 — 판정이 아니라 사고다).
#
# 사용법:
#   bash scripts/smoke-combos.sh              # 전체
#   bash scripts/smoke-combos.sh --only linux # 이름에 linux가 든 조합만
#   bash scripts/smoke-combos.sh --keep       # 끝나고 DB 컨테이너를 남긴다(디버깅용)
#
# 전제: docker 실행 중 · dist-tiers/downloads/ 에 zip 존재 · Git Bash(MSYS)
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ZIP_DIR="$AGENT_ROOT/dist-tiers/downloads"

# 산출물 폴더를 절대 건드리지 않는다 — 작업은 전부 임시 폴더에서.
WORK_DIR="${TMPDIR:-/tmp}/sync-agent-smoke-$$"

# Git Bash가 -v 경로를 멋대로 변환하는 것을 막는다.
export MSYS_NO_PATHCONV=1

MIN_VERSION='1.6.5'          # --test-db가 들어간 최소 버전
DB_PASS='Smoke2026'
NET='smoke-net'
MYSQL_CT='smoke-mysql'
PG_CT='smoke-pg'
ORACLE_CT='smoke-oracle'
MYSQL_HOST_PORT=13306
PG_HOST_PORT=15432
ORACLE_HOST_PORT=11521
# 빌드가 남긴 packageKey별 state/blockers. 검증 불가 사유를 스크립트에 복제하지 않고 여기서 읽는다.
MANIFEST="$AGENT_ROOT/release/build-manifest.json"

KEEP=0
ONLY=''
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --only) shift; ONLY="${1:-}" ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── 조합표 ────────────────────────────────────────────────────────────────
# name|zip|binary|runner|image|dbtype|dbhost|dbport|dbname|dbuser|mode
#   dbname  MySQL/PG는 DB 이름, Oracle은 **서비스명**이다(커넥터가 host:port/dbname 으로 접속 문자열을 만든다)
#   runner  host   = 이 PC에서 직접 실행 / docker = 컨테이너 안에서 실행
#   mode    full   = 이 실행 환경이 그 티어의 대상 OS에 포함된다
#           launch = 대상 OS가 아니다. 바이너리가 깨지지 않았다는 것만 말한다(티어 검증 아님)
COMBOS=(
  "win-modern-mysql|sync-agent-win-modern-mysql.zip|SyncAgent/sync-agent.exe|host|-|mysql|127.0.0.1|$MYSQL_HOST_PORT|smokedb|root|full"
  "win-modern-pg|sync-agent-win-modern-pg.zip|SyncAgent/sync-agent.exe|host|-|postgres|127.0.0.1|$PG_HOST_PORT|smokedb|postgres|full"
  "linux-modern-mysql|sync-agent-linux-modern-mysql.zip|sync-agent-linux-modern|docker|ubuntu:24.04|mysql|$MYSQL_CT|3306|smokedb|root|full"
  "linux-modern-pg|sync-agent-linux-modern-pg.zip|sync-agent-linux-modern|docker|ubuntu:24.04|postgres|$PG_CT|5432|smokedb|postgres|full"
  "linux-legacy-mysql|sync-agent-linux-legacy-mysql.zip|sync-agent-linux-legacy|docker|centos:7|mysql|$MYSQL_CT|3306|smokedb|root|full"
  "linux-legacy-pg|sync-agent-linux-legacy-pg.zip|sync-agent-linux-legacy|docker|centos:7|postgres|$PG_CT|5432|smokedb|postgres|full"
  # Oracle 11g XE(gvenzl/oracle-xe:11-slim). 11g는 thin이 안 되므로 thick + Instant Client가 필요하고,
  # IC는 win-legacy zip에만 동봉된다(실측: win-legacy 921개 항목 / 나머지 티어 0개).
  # 나머지 티어는 oracle_ic_missing()이 풀린 zip을 보고 SKIP으로 뺀다.
  "win-legacy-oracle|sync-agent-win-legacy-oracle.zip|SyncAgent/sync-agent.exe|host|-|oracle|127.0.0.1|$ORACLE_HOST_PORT|XE|smoke|launch"
  "win-modern-oracle|sync-agent-win-modern-oracle.zip|SyncAgent/sync-agent.exe|host|-|oracle|127.0.0.1|$ORACLE_HOST_PORT|XE|smoke|full"
  "linux-modern-oracle|sync-agent-linux-modern-oracle.zip|sync-agent-linux-modern|docker|ubuntu:24.04|oracle|$ORACLE_CT|1521|XE|smoke|full"
  "linux-legacy-oracle|sync-agent-linux-legacy-oracle.zip|sync-agent-linux-legacy|docker|centos:7|oracle|$ORACLE_CT|1521|XE|smoke|full"
  # 구형 Windows 티어는 이 PC가 대상 OS가 아니다. 기동만 본다 — 통과해도 그 OS 검증이 아니다.
  "win-mid-mysql|sync-agent-win-mid-mysql.zip|SyncAgent/sync-agent.exe|host|-|mysql|127.0.0.1|$MYSQL_HOST_PORT|smokedb|root|launch"
  "win-legacy-mysql|sync-agent-win-legacy-mysql.zip|SyncAgent/sync-agent.exe|host|-|mysql|127.0.0.1|$MYSQL_HOST_PORT|smokedb|root|launch"
  # MSSQL은 이미지가 확보되면 여기에 추가한다 — mcr.microsoft.com/mssql/server
)

# Oracle 컨테이너는 초기화가 느리다(2분 안팎). Oracle 조합을 안 돌릴 거면 띄우지 않는다.
NEED_ORACLE=0
for c in "${COMBOS[@]}"; do
  n="${c%%|*}"
  [ -n "$ONLY" ] && case "$n" in *"$ONLY"*) ;; *) continue ;; esac
  case "$c" in *"|oracle|"*) NEED_ORACLE=1 ;; esac
done

PASS=(); FAIL=(); SKIP=()

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo ""
    echo "[--keep] DB 컨테이너를 남깁니다: $MYSQL_CT($MYSQL_HOST_PORT) $PG_CT($PG_HOST_PORT)"
  else
    docker rm -f "$MYSQL_CT" "$PG_CT" "$ORACLE_CT" >/dev/null 2>&1
    docker network rm "$NET" >/dev/null 2>&1
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# ── 사전 확인 ─────────────────────────────────────────────────────────────
docker info >/dev/null 2>&1 || { echo "docker가 실행 중이 아닙니다." >&2; exit 1; }
[ -d "$ZIP_DIR" ] || { echo "zip 폴더가 없습니다: $ZIP_DIR" >&2; exit 1; }
mkdir -p "$WORK_DIR"

# ── DB 기동 ───────────────────────────────────────────────────────────────
# 포트는 반드시 127.0.0.1에 묶는다. 0.0.0.0 바인딩 금지 (2026-02-28 MySQL 랜섬웨어 교훈).
echo "== DB 컨테이너 기동 =="
docker rm -f "$MYSQL_CT" "$PG_CT" "$ORACLE_CT" >/dev/null 2>&1
docker network create "$NET" >/dev/null 2>&1
if [ "$NEED_ORACLE" -eq 1 ]; then
  # 가장 느리므로 제일 먼저 띄워 MySQL·PG 준비 시간과 겹치게 한다.
  docker run -d --name "$ORACLE_CT" --network "$NET" \
    -p "127.0.0.1:$ORACLE_HOST_PORT:1521" \
    -e ORACLE_PASSWORD="$DB_PASS" -e APP_USER=smoke -e APP_USER_PASSWORD="$DB_PASS" \
    gvenzl/oracle-xe:11-slim >/dev/null
fi
docker run -d --name "$MYSQL_CT" --network "$NET" \
  -p "127.0.0.1:$MYSQL_HOST_PORT:3306" \
  -e MYSQL_ROOT_PASSWORD="$DB_PASS" -e MYSQL_DATABASE=smokedb mysql:8.0 >/dev/null
docker run -d --name "$PG_CT" --network "$NET" \
  -p "127.0.0.1:$PG_HOST_PORT:5432" \
  -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB=smokedb postgres:16-alpine >/dev/null

# mysqladmin ping은 초기화용 임시 서버에도 성공한다 — 그걸 준비 완료로 보면
# 곧바로 넣는 시드가 조용히 실패한다(2026-07-28 실측: 테이블 0개). 대상 DB에 실제 쿼리가
# 통할 때까지 기다린다. pg_isready도 같은 이유로 실쿼리로 확인한다.
echo -n "   준비 대기"
for _ in $(seq 1 60); do
  docker exec "$MYSQL_CT" mysql -uroot -p"$DB_PASS" -N -B -e 'SELECT 1' smokedb >/dev/null 2>&1 && break
  echo -n "."; sleep 2
done
for _ in $(seq 1 60); do
  docker exec "$PG_CT" psql -U postgres -d smokedb -t -A -c 'SELECT 1' >/dev/null 2>&1 && break
  echo -n "."; sleep 2
done
echo ""

# ── 테스트 데이터 ─────────────────────────────────────────────────────────
# ⛔ 전화번호를 010+랜덤으로 만들지 않는다. 실가입 번호와 겹친다(2026-07-27 운영 유입 사고).
#    형식만 11자리로 맞추고 값은 미할당 대역 고정, 이메일은 RFC 2606 예약 도메인(.invalid).
#    건수는 확인에 필요한 최소(5행)만. 늘려야 할 이유가 생기면 그때 늘린다.
echo "== 테스트 데이터 적재 (5행, 도달 불가 값) =="
SEED_MYSQL="CREATE TABLE IF NOT EXISTS members (
  member_id INT PRIMARY KEY AUTO_INCREMENT,
  member_nm VARCHAR(50), mobile VARCHAR(20), email VARCHAR(100),
  marketing_agree CHAR(1), birth_dt DATE, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4;
INSERT INTO members (member_nm, mobile, email, marketing_agree, birth_dt) VALUES
('테스트일','01000000001','smoke1@example.invalid','Y','1990-01-01'),
('테스트이','01000000002','smoke2@example.invalid','N','1991-02-02'),
('테스트삼','01000000003','smoke3@example.invalid','Y','1992-03-03'),
('테스트사','01000000004','smoke4@example.invalid','Y','1993-04-04'),
('테스트오','01000000005','smoke5@example.invalid','N','1994-05-05');"
SEED_PG="CREATE TABLE IF NOT EXISTS members (
  member_id SERIAL PRIMARY KEY,
  member_nm VARCHAR(50), mobile VARCHAR(20), email VARCHAR(100),
  marketing_agree CHAR(1), birth_dt DATE, updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO members (member_nm, mobile, email, marketing_agree, birth_dt) VALUES
('테스트일','01000000001','smoke1@example.invalid','Y','1990-01-01'),
('테스트이','01000000002','smoke2@example.invalid','N','1991-02-02'),
('테스트삼','01000000003','smoke3@example.invalid','Y','1992-03-03'),
('테스트사','01000000004','smoke4@example.invalid','Y','1993-04-04'),
('테스트오','01000000005','smoke5@example.invalid','N','1994-05-05');"

printf '%s' "$SEED_MYSQL" | docker exec -i "$MYSQL_CT" mysql -uroot -p"$DB_PASS" smokedb 2>/dev/null
printf '%s' "$SEED_PG"    | docker exec -i "$PG_CT" psql -U postgres -d smokedb -q 2>/dev/null

# 적재 결과를 세어 확인한다. 0이면 이후 판정이 전부 무의미하므로 여기서 멈춘다.
# (2026-07-28: 컨테이너가 덜 떴을 때 시드가 조용히 실패해 "테이블 0개"가 나왔다)
m_rows="$(docker exec "$MYSQL_CT" mysql -uroot -p"$DB_PASS" -N -B -e 'SELECT COUNT(*) FROM smokedb.members;' 2>/dev/null | tr -d '[:space:]')"
p_rows="$(docker exec "$PG_CT" psql -U postgres -d smokedb -t -A -c 'SELECT COUNT(*) FROM members;' 2>/dev/null | tr -d '[:space:]')"
echo "   MySQL ${m_rows:-0}행 / PostgreSQL ${p_rows:-0}행"
if [ "${m_rows:-0}" -lt 1 ] || [ "${p_rows:-0}" -lt 1 ]; then
  echo "테스트 데이터 적재 실패 — 판정이 무의미하므로 중단합니다." >&2
  exit 1
fi

# ── Oracle (느려서 따로) ──────────────────────────────────────────────────
if [ "$NEED_ORACLE" -eq 1 ]; then
  echo -n "   Oracle 준비 대기"
  for _ in $(seq 1 90); do
    docker exec "$ORACLE_CT" bash -lc \
      "echo 'SELECT 1 FROM dual;' | sqlplus -S smoke/$DB_PASS@localhost:1521/XE" >/dev/null 2>&1 && break
    echo -n "."; sleep 4
  done
  echo ""
  # Oracle은 다중 행 VALUES를 못 쓴다. INSERT를 나눠 넣고 COMMIT한다.
  docker exec -i "$ORACLE_CT" bash -lc "sqlplus -S smoke/$DB_PASS@localhost:1521/XE" >/dev/null 2>&1 <<'SQL'
CREATE TABLE members (
  member_id NUMBER(10) PRIMARY KEY,
  member_nm VARCHAR2(50), mobile VARCHAR2(20), email VARCHAR2(100),
  marketing_agree CHAR(1), birth_dt DATE, updated_at DATE DEFAULT SYSDATE
);
INSERT INTO members (member_id,member_nm,mobile,email,marketing_agree,birth_dt) VALUES (1,'테스트일','01000000001','smoke1@example.invalid','Y',DATE '1990-01-01');
INSERT INTO members (member_id,member_nm,mobile,email,marketing_agree,birth_dt) VALUES (2,'테스트이','01000000002','smoke2@example.invalid','N',DATE '1991-02-02');
INSERT INTO members (member_id,member_nm,mobile,email,marketing_agree,birth_dt) VALUES (3,'테스트삼','01000000003','smoke3@example.invalid','Y',DATE '1992-03-03');
INSERT INTO members (member_id,member_nm,mobile,email,marketing_agree,birth_dt) VALUES (4,'테스트사','01000000004','smoke4@example.invalid','Y',DATE '1993-04-04');
INSERT INTO members (member_id,member_nm,mobile,email,marketing_agree,birth_dt) VALUES (5,'테스트오','01000000005','smoke5@example.invalid','N',DATE '1994-05-05');
COMMIT;
EXIT
SQL
  o_rows="$(docker exec "$ORACLE_CT" bash -lc \
    "echo 'SET HEADING OFF FEEDBACK OFF PAGESIZE 0
SELECT COUNT(*) FROM members;' | sqlplus -S smoke/$DB_PASS@localhost:1521/XE" 2>/dev/null | tr -d '[:space:]')"
  echo "   Oracle ${o_rows:-0}행"
  if [ "${o_rows:-0}" -lt 1 ]; then
    echo "Oracle 테스트 데이터 적재 실패 — 판정이 무의미하므로 중단합니다." >&2
    exit 1
  fi
fi

# ── docker -v 용 경로 변환 ────────────────────────────────────────────────
# Git Bash의 /tmp/... 를 그대로 -v 에 주면 Docker Desktop이 데몬(리눅스) 경로로 읽어
# 빈 폴더가 마운트된다(2026-07-28 실측: cp: cannot stat '/agent/...').
# cygpath -m 으로 C:/... 형태로 바꿔 준다. 리눅스·macOS에서는 그대로 쓴다.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

# ── Oracle thick 가능 여부 ────────────────────────────────────────────────
# Oracle 10g·11g는 thin이 안 된다 — thick 모드이고 Instant Client가 있어야 붙는다.
# IC는 win-legacy zip에만 동봉된다(2026-07-28 실측: win-legacy 921개 항목 / 나머지 티어 0개).
# IC 없는 zip이 11g에 못 붙는 건 설계상 결과지 결함이 아니므로 FAIL이 아니라 SKIP으로 뺀다.
#
# 판정을 build-manifest.json 의 blockers 로 하지 않는다 — 그 선언이 산출물과 어긋나 있다.
# manifest는 win-legacy-oracle 에도 "IC 동봉 필요" blocker를 달아두는데 그 zip에는 IC가 실제로
# 들어 있고 접속도 된다(2026-07-28 실측). 선언보다 산출물이 진실이라 풀린 파일을 직접 본다.
oracle_ic_missing() { # $1 = 풀어둔 폴더
  [ -z "$(find "$1" -maxdepth 3 -iname 'oracle-client' -o -maxdepth 3 -iname 'instantclient*' 2>/dev/null | head -1)" ]
}

# ── 버전 비교 (a >= b) ────────────────────────────────────────────────────
ver_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

# ── 조합 실행 ─────────────────────────────────────────────────────────────
for combo in "${COMBOS[@]}"; do
  IFS='|' read -r name zip binary runner image dbtype dbhost dbport dbname dbuser mode <<<"$combo"
  [ -n "$ONLY" ] && case "$name" in *"$ONLY"*) ;; *) continue ;; esac

  if [ ! -f "$ZIP_DIR/$zip" ]; then
    SKIP+=("$name — zip 없음 ($zip)"); echo "-- $name: SKIP (zip 없음)"; continue
  fi


  ext="$WORK_DIR/$name"
  mkdir -p "$ext"
  # PowerShell Compress-Archive가 만든 zip은 경로 구분자가 역슬래시라 MSYS unzip이 경고와 함께
  # 종료 코드 1을 낸다. 해제 자체는 정상이다(2026-07-28 실측). 종료 코드가 아니라
  # 필요한 바이너리가 실제로 나왔는지로 판정한다.
  unzip -o -q "$ZIP_DIR/$zip" -d "$ext" 2>/dev/null
  if [ ! -f "$ext/$binary" ]; then
    echo "-- $name: FAIL (zip 해제 후 $binary 없음)"
    FAIL+=("$name — zip 해제 후 $binary 없음")
    continue
  fi

  printf -- "-- %-22s (%-6s) ... " "$name" "$mode"

  # Oracle 11g는 thick 전용 — IC 없는 zip은 붙을 수 없다(설계상 결과, 결함 아님).
  if [ "$dbtype" = "oracle" ] && oracle_ic_missing "$ext"; then
    echo "SKIP (Instant Client 미동봉)"
    SKIP+=("$name — zip에 Instant Client가 없다. Oracle 10g·11g는 thick 전용이라 붙을 수 없다(12.1+는 thin으로 가능)")
    continue
  fi

  # 실행기: 호스트면 그대로, 도커면 컨테이너 안으로 복사해 실행.
  run_agent() {
    if [ "$runner" = "host" ]; then
      timeout 120 "$ext/$binary" "$@" 2>&1
    else
      timeout 240 docker run --rm --network "$NET" --user root --entrypoint sh \
        -v "$(host_path "$ext")":/agent:ro "$image" \
        -c "cp /agent/$binary /tmp/a && chmod +x /tmp/a && cd /tmp && ./a $*" 2>&1
    fi
  }

  # ① 바이너리가 뜨는가 + --test-db를 아는 버전인가
  vout="$(run_agent --version | tr -d '\r')"
  ver="$(printf '%s' "$vout" | grep -ao 'v[0-9][0-9.]*' | head -1 | tr -d 'v')"
  if [ -z "$ver" ]; then
    echo "FAIL (기동 안 됨)"; FAIL+=("$name ($mode) — --version 응답 없음")
    printf '%s\n' "$vout" | tail -5 | sed 's/^/     | /'
    continue
  fi
  if ! ver_ge "$ver" "$MIN_VERSION"; then
    echo "SKIP (v$ver < $MIN_VERSION)"
    SKIP+=("$name — v$ver 에는 --test-db가 없다. $MIN_VERSION 이상으로 빌드 후 다시 돌린다")
    continue
  fi

  # ② 접속 · 테이블 · 컬럼
  out="$(run_agent --test-db --type "$dbtype" --host "$dbhost" --port "$dbport" \
          --db "$dbname" --user "$dbuser" --pass "$DB_PASS" | tr -d '\r')"
  code=$?
  json="$(printf '%s' "$out" | grep -a '^__TEST_DB__' | head -1 | sed 's/^__TEST_DB__ //')"

  if [ "$code" -eq 0 ] && printf '%s' "$json" | grep -q '"ok":true'; then
    echo "PASS  v$ver  $json"
    PASS+=("$name ($mode) v$ver")
  else
    echo "FAIL"
    FAIL+=("$name ($mode) v$ver")
    [ -n "$json" ] && echo "     | $json" || printf '%s' "$out" | tail -6 | sed 's/^/     | /'
  fi
done

# ── 결과 ──────────────────────────────────────────────────────────────────
echo ""
echo "===================== 결과 ====================="
printf 'PASS %d\n' "${#PASS[@]}"; for x in "${PASS[@]:-}"; do [ -n "$x" ] && echo "  o $x"; done
printf 'FAIL %d\n' "${#FAIL[@]}"; for x in "${FAIL[@]:-}"; do [ -n "$x" ] && echo "  x $x"; done
printf 'SKIP %d\n' "${#SKIP[@]}"; for x in "${SKIP[@]:-}"; do [ -n "$x" ] && echo "  - $x"; done
echo "================================================"
echo "mode=launch 는 이 PC가 대상 OS가 아니라는 뜻이다 — 통과해도 그 티어를 검증한 것이 아니다."
echo "전체 동기화·서비스 등록·재부팅 자동시작은 여기서 보지 않는다(대상 OS VM 몫)."
echo "PASS 한 조합만 utils/agent-build-tiers.ts 의 VERIFIED_COMBOS 에 등재한다."

[ "${#FAIL[@]}" -eq 0 ]
