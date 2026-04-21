#!/usr/bin/env bash
# Sync Agent Linux 로컬 테스트 셋업 스크립트 (WSL Ubuntu용)
# 사용법: WSL에서 실행 — bash setup-wsl.sh
set -e

SRC="/mnt/c/Users/ceo/projects/targetup/sync-agent"
DST="${HOME}/sync-agent-test"

echo "=== Sync Agent Linux 로컬 테스트 셋업 ==="
echo "원본: $SRC"
echo "대상: $DST"
echo

# 1) 대상 폴더 생성
mkdir -p "$DST/data" "$DST/test-data" "$DST/logs"

# 2) 바이너리 복사 + 실행 권한
cp "$SRC/release/sync-agent" "$DST/sync-agent"
chmod +x "$DST/sync-agent"
echo "[1/4] 바이너리 복사 완료 ($(du -h "$DST/sync-agent" | cut -f1))"

# 2-1) sql-wasm.wasm 안전망 (package.json pkg.assets로 embed되지만, 구 빌드 or embed 실패 시 대비)
mkdir -p "$DST/dist"
if [ -f "$SRC/release/sql-wasm.wasm" ]; then
  cp "$SRC/release/sql-wasm.wasm" "$DST/sql-wasm.wasm"
  cp "$SRC/release/sql-wasm.wasm" "$DST/dist/sql-wasm.wasm"
  echo "[1.5/4] sql-wasm.wasm 안전망 복사 (pkg embed 우선, 폴백 대비)"
fi

# 3) CSV 복사 (20,000건 + 100건 샘플)
cp "$SRC/test-data/customers.csv" "$DST/test-data/"
cp "$SRC/test-data/customers_sample_100.csv" "$DST/test-data/"
echo "[2/4] CSV 복사 완료 ($(du -h "$DST/test-data/customers.csv" | cut -f1))"

# 4) config 템플릿 복사 (평문 config.json — 첫 실행 시 자동 암호화됨)
if [ ! -f "$DST/data/config.json" ] && [ ! -f "$DST/data/config.enc" ]; then
  cp "$SRC/test-data/config.json.template" "$DST/data/config.json"
  echo "[3/4] config.json 템플릿 복사"
  echo
  echo "⚠️  다음 값을 직접 채워주세요:"
  echo "    $DST/data/config.json"
  echo "    - server.apiKey"
  echo "    - server.apiSecret"
  echo "    (슈퍼관리자 UI에서 테스트 회사 생성 후 받은 값)"
else
  echo "[3/4] config 이미 존재 (덮어쓰지 않음)"
fi

# 5) 빠른 테스트용 100건 심볼릭 링크 (옵션)
echo "[4/4] 셋업 완료"
echo
echo "=== 실행 방법 ==="
echo "  cd $DST"
echo "  ./sync-agent                       # 실제 모드 (20,000건)"
echo "  # 먼저 100건으로 테스트하려면 config.json의 filePath를:"
echo "  # './test-data/customers_sample_100.csv' 로 변경"
