#!/usr/bin/env bash
# ============================================================================
# Sync Agent — Linux tar.gz 패키지 빌드
#
# 사용법:
#   bash installer/build-linux-package.sh [버전]
#   예: bash installer/build-linux-package.sh 1.4.0
# ============================================================================
set -euo pipefail

VERSION="${1:-1.0.0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_DIR/release"
INSTALLER_DIR="$SCRIPT_DIR"

PACKAGE_NAME="SyncAgent-${VERSION}-linux-x64"
STAGE_DIR="$INSTALLER_DIR/$PACKAGE_NAME"

echo ""
echo "============================================"
echo " Sync Agent Linux 패키지 빌드"
echo "============================================"
echo ""
echo " 버전: $VERSION"
echo ""

# ── [1/4] 빌드 산출물 확인 ────────────────────────────────
echo "[1/4] 빌드 산출물 확인..."

if [ ! -f "$RELEASE_DIR/sync-agent" ]; then
    echo "  release/sync-agent 가 없습니다."
    echo "  npm run build:linux 를 먼저 실행하세요."
    exit 1
fi
if [ ! -f "$RELEASE_DIR/sql-wasm.wasm" ]; then
    echo "  release/sql-wasm.wasm 이 없습니다."
    exit 1
fi

echo "  바이너리 확인 완료"
echo ""

# ── [2/4] 스테이징 디렉토리 준비 ──────────────────────────
echo "[2/4] 파일 준비..."

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

cp "$RELEASE_DIR/sync-agent"     "$STAGE_DIR/"
cp "$RELEASE_DIR/sql-wasm.wasm"  "$STAGE_DIR/"
cp "$INSTALLER_DIR/install.sh"   "$STAGE_DIR/"
cp "$INSTALLER_DIR/uninstall.sh" "$STAGE_DIR/"

chmod +x "$STAGE_DIR/sync-agent"
chmod +x "$STAGE_DIR/install.sh"
chmod +x "$STAGE_DIR/uninstall.sh"

echo "  파일 복사 완료"
echo ""

# ── [3/4] README 생성 ─────────────────────────────────────
echo "[3/4] README 생성..."

cat > "$STAGE_DIR/README.txt" << 'READMEEOF'
================================================================
 Sync Agent — Linux 설치 안내
================================================================

■ 설치
  sudo bash install.sh

■ 초기 설정 (설치 후 반드시 실행)
  sudo /opt/sync-agent/sync-agent --setup-cli

■ 서비스 명령
  sudo systemctl start   sync-agent    # 시작
  sudo systemctl stop    sync-agent    # 중지
  sudo systemctl status  sync-agent    # 상태
  sudo systemctl restart sync-agent    # 재시작
  journalctl -u sync-agent -f          # 로그

■ 설정
  sudo /opt/sync-agent/sync-agent --edit-config    # 편집
  /opt/sync-agent/sync-agent --show-config          # 조회

■ 제거
  sudo /opt/sync-agent/uninstall.sh

■ 설치 경로
  프로그램   /opt/sync-agent/
  설정 파일  /opt/sync-agent/data/
  로그       /opt/sync-agent/logs/

================================================================
READMEEOF

echo "  README.txt 생성 완료"
echo ""

# ── [4/4] tar.gz 패키징 ───────────────────────────────────
echo "[4/4] tar.gz 패키징..."

OUTPUT_FILE="$INSTALLER_DIR/${PACKAGE_NAME}.tar.gz"

tar -czf "$OUTPUT_FILE" -C "$INSTALLER_DIR" "$PACKAGE_NAME"

# 스테이징 디렉토리 정리
rm -rf "$STAGE_DIR"

echo ""
echo "============================================"
echo " 빌드 완료!"
echo " 출력: installer/${PACKAGE_NAME}.tar.gz"
echo ""
echo " 배포 방법:"
echo "   tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "   cd ${PACKAGE_NAME}"
echo "   sudo bash install.sh"
echo "============================================"
echo ""
