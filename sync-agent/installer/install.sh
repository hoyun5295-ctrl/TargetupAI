#!/usr/bin/env bash
# ============================================================================
# Sync Agent — Linux 설치 스크립트
# ============================================================================
set -euo pipefail

INSTALL_DIR="/opt/sync-agent"
BIN_NAME="sync-agent"
WASM_NAME="sql-wasm.wasm"
SERVICE_NAME="sync-agent"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── root 확인 ──────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    error "root 권한이 필요합니다."
    echo "  sudo bash install.sh"
    exit 1
fi

# ── 스크립트 위치 기준으로 파일 찾기 ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SCRIPT_DIR/$BIN_NAME" ]; then
    error "$SCRIPT_DIR/$BIN_NAME 파일을 찾을 수 없습니다."
    exit 1
fi
if [ ! -f "$SCRIPT_DIR/$WASM_NAME" ]; then
    error "$SCRIPT_DIR/$WASM_NAME 파일을 찾을 수 없습니다."
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      Sync Agent — Linux 설치             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
info "설치 경로: $INSTALL_DIR"
echo ""

# ── 기존 설치 감지 (업그레이드) ────────────────────────────
UPGRADE=false
if [ -f "$INSTALL_DIR/$BIN_NAME" ]; then
    UPGRADE=true
    warn "기존 설치가 감지되었습니다. 업그레이드를 진행합니다."
    warn "설정 파일(data/)은 유지됩니다."
    echo ""

    # 서비스 중지
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        info "기존 서비스 중지 중..."
        systemctl stop "$SERVICE_NAME" || true
        sleep 2
    fi
fi

# ── 디렉토리 생성 ─────────────────────────────────────────
info "디렉토리 생성..."
mkdir -p "$INSTALL_DIR"/{data,logs,temp}

# ── 파일 복사 ──────────────────────────────────────────────
info "파일 복사..."
cp -f "$SCRIPT_DIR/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
cp -f "$SCRIPT_DIR/$WASM_NAME" "$INSTALL_DIR/$WASM_NAME"
chmod +x "$INSTALL_DIR/$BIN_NAME"

# uninstall.sh 도 설치 경로에 복사
if [ -f "$SCRIPT_DIR/uninstall.sh" ]; then
    cp -f "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
    chmod +x "$INSTALL_DIR/uninstall.sh"
fi

info "파일 복사 완료"

# ── systemd 서비스 등록 ───────────────────────────────────
if $UPGRADE; then
    # 업그레이드: 서비스 재시작
    info "서비스 재시작 중..."
    systemctl daemon-reload
    systemctl start "$SERVICE_NAME"
    info "업그레이드 완료!"
else
    # 신규 설치: --install-service 호출 (기존 코드 재사용)
    info "systemd 서비스 등록 중..."
    "$INSTALL_DIR/$BIN_NAME" --install-service
fi

# ── 완료 메시지 ───────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║             설치 완료!                    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

if ! $UPGRADE; then
    echo "  다음 단계: 초기 설정을 진행하세요."
    echo ""
    echo "    sudo $INSTALL_DIR/$BIN_NAME --setup-cli"
    echo ""
    echo "  설정 완료 후 서비스를 시작하세요:"
    echo ""
    echo "    sudo systemctl start $SERVICE_NAME"
    echo ""
fi

echo "  유용한 명령어:"
echo "    서비스 상태   systemctl status $SERVICE_NAME"
echo "    로그 확인     journalctl -u $SERVICE_NAME -f"
echo "    설정 편집     sudo $INSTALL_DIR/$BIN_NAME --edit-config"
echo "    설정 조회     $INSTALL_DIR/$BIN_NAME --show-config"
echo "    제거          sudo $INSTALL_DIR/uninstall.sh"
echo ""
