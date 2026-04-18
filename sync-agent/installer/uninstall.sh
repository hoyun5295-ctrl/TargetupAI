#!/usr/bin/env bash
# ============================================================================
# Sync Agent — Linux 제거 스크립트
# ============================================================================
set -euo pipefail

INSTALL_DIR="/opt/sync-agent"
BIN_NAME="sync-agent"
SERVICE_NAME="sync-agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

if [ "$(id -u)" -ne 0 ]; then
    error "root 권한이 필요합니다."
    echo "  sudo bash uninstall.sh"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/$BIN_NAME" ]; then
    error "Sync Agent가 설치되어 있지 않습니다. ($INSTALL_DIR)"
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      Sync Agent — Linux 제거             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 서비스 제거 ───────────────────────────────────────────
info "서비스 제거 중..."
"$INSTALL_DIR/$BIN_NAME" --uninstall-service 2>/dev/null || true

# ── 바이너리/wasm 삭제 ────────────────────────────────────
info "프로그램 파일 삭제..."
rm -f "$INSTALL_DIR/$BIN_NAME"
rm -f "$INSTALL_DIR/sql-wasm.wasm"
rm -f "$INSTALL_DIR/uninstall.sh"
rm -rf "$INSTALL_DIR/temp"

# ── 설정/로그 삭제 여부 확인 ──────────────────────────────
echo ""
read -rp "설정 파일과 로그를 삭제하시겠습니까? (재설치 시 설정 유지하려면 N) [y/N]: " answer
case "$answer" in
    [yY]|[yY][eE][sS])
        info "설정 및 로그 삭제 중..."
        rm -rf "$INSTALL_DIR/data"
        rm -rf "$INSTALL_DIR/logs"
        rmdir "$INSTALL_DIR" 2>/dev/null || true
        info "모든 파일이 삭제되었습니다."
        ;;
    *)
        info "설정 파일과 로그가 유지됩니다: $INSTALL_DIR/data/, $INSTALL_DIR/logs/"
        rmdir "$INSTALL_DIR" 2>/dev/null || true
        ;;
esac

echo ""
info "Sync Agent 제거 완료!"
echo ""
