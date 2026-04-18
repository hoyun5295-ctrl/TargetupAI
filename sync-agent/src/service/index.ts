/**
 * 서비스 관리 모듈 (Windows + Linux)
 *
 * Windows: sc.exe로 Windows 서비스 등록/해제
 * Linux: systemd unit 파일 생성 + systemctl로 서비스 등록/해제
 *
 * CLI:
 *   sync-agent --install-service    → 서비스 설치
 *   sync-agent --uninstall-service  → 서비스 제거
 *   sync-agent --service-status     → 서비스 상태 확인
 *
 * Windows 서비스명: SyncAgent
 * Linux 서비스명: sync-agent
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ─── 공통 설정 ──────────────────────────────────────────

const isWindows = process.platform === 'win32';

const WIN_SERVICE_NAME = 'SyncAgent';
const WIN_SERVICE_DISPLAY = 'Sync Agent';
const LINUX_SERVICE_NAME = 'sync-agent';
const SERVICE_DESCRIPTION = '한줄로(Target-UP) 데이터 동기화 에이전트 — 고객사 POS/ERP DB에서 한줄로 서버로 고객·구매 데이터를 자동 동기화합니다.';

// ─── 공통 유틸 ──────────────────────────────────────────

function getExePath(): string {
  return process.execPath;
}

function runCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return { success: true, output: output.trim() };
  } catch (error: any) {
    return {
      success: false,
      output: (error.stderr?.toString() || error.stdout?.toString() || error.message).trim(),
    };
  }
}

// ═══════════════════════════════════════════════════════════
// Windows 서비스 (sc.exe)
// ═══════════════════════════════════════════════════════════

function isWindowsAdmin(): boolean {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function installServiceWindows(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sync Agent — Windows 서비스 설치        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (!isWindowsAdmin()) {
    console.error('❌ 관리자 권한이 필요합니다.');
    console.error('   PowerShell을 "관리자 권한으로 실행" 후 다시 시도하세요.');
    console.error('');
    process.exit(1);
  }

  const exePath = getExePath();
  console.log(`exe 경로: ${exePath}`);

  // 기존 서비스 확인
  const statusResult = runCommand(`sc query ${WIN_SERVICE_NAME}`);
  if (statusResult.success) {
    console.log('⚠️  기존 서비스가 이미 존재합니다.');
    console.log('   먼저 --uninstall-service로 제거 후 다시 설치하세요.');
    console.log('');
    process.exit(1);
  }

  // 서비스 생성
  const createResult = runCommand(
    `sc create ${WIN_SERVICE_NAME} ` +
    `binPath= "${exePath}" ` +
    `DisplayName= "${WIN_SERVICE_DISPLAY}" ` +
    `start= auto`,
  );
  if (!createResult.success) {
    console.error('❌ 서비스 생성 실패:', createResult.output);
    process.exit(1);
  }
  console.log('✅ 서비스 생성 완료');

  // 설명 추가
  runCommand(`sc description ${WIN_SERVICE_NAME} "${SERVICE_DESCRIPTION}"`);

  // 실패 시 자동 재시작
  runCommand(
    `sc failure ${WIN_SERVICE_NAME} ` +
    `reset= 86400 ` +
    `actions= restart/60000/restart/60000/restart/300000`,
  );
  console.log('✅ 자동 재시작 설정 완료 (실패 시 60초 후 재시작)');

  // 서비스 시작
  const startResult = runCommand(`sc start ${WIN_SERVICE_NAME}`);
  if (startResult.success) {
    console.log('✅ 서비스 시작 완료');
  } else {
    console.log('⚠️  서비스 시작 실패 — 수동으로 시작해주세요:');
    console.log(`   sc start ${WIN_SERVICE_NAME}`);
  }

  printWindowsInfo(exePath);
}

function uninstallServiceWindows(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sync Agent — Windows 서비스 제거        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (!isWindowsAdmin()) {
    console.error('❌ 관리자 권한이 필요합니다.');
    console.error('   PowerShell을 "관리자 권한으로 실행" 후 다시 시도하세요.');
    console.error('');
    process.exit(1);
  }

  const statusResult = runCommand(`sc query ${WIN_SERVICE_NAME}`);
  if (!statusResult.success) {
    console.log('ℹ️  서비스가 설치되어 있지 않습니다.');
    console.log('');
    return;
  }

  // 실행 중이면 중지
  if (statusResult.output.includes('RUNNING')) {
    console.log('서비스 중지 중...');
    runCommand(`sc stop ${WIN_SERVICE_NAME}`);
    for (let i = 0; i < 10; i++) {
      const check = runCommand(`sc query ${WIN_SERVICE_NAME}`);
      if (check.output.includes('STOPPED')) break;
      execSync('timeout /t 1 /nobreak >nul', { stdio: 'ignore' });
    }
    console.log('✅ 서비스 중지 완료');
  }

  const deleteResult = runCommand(`sc delete ${WIN_SERVICE_NAME}`);
  if (deleteResult.success) {
    console.log('✅ 서비스 제거 완료');
  } else {
    console.error('❌ 서비스 제거 실패:', deleteResult.output);
  }
  console.log('');
}

function serviceStatusWindows(): void {
  console.log('');
  const result = runCommand(`sc query ${WIN_SERVICE_NAME}`);

  if (!result.success) {
    console.log(`ℹ️  서비스 "${WIN_SERVICE_DISPLAY}" 가 설치되어 있지 않습니다.`);
    console.log('   설치: sync-agent --install-service');
    console.log('');
    return;
  }

  let state = 'UNKNOWN';
  const stateMatch = result.output.match(/STATE\s+:\s+\d+\s+(\w+)/);
  if (stateMatch) state = stateMatch[1];

  const stateEmoji: Record<string, string> = {
    RUNNING: '🟢 실행 중',
    STOPPED: '🔴 중지됨',
    START_PENDING: '🟡 시작 중...',
    STOP_PENDING: '🟡 중지 중...',
    PAUSED: '🟡 일시정지',
  };

  console.log(`서비스: ${WIN_SERVICE_DISPLAY} (${WIN_SERVICE_NAME})`);
  console.log(`상태: ${stateEmoji[state] || state}`);

  const pidMatch = result.output.match(/PID\s+:\s+(\d+)/);
  if (pidMatch && pidMatch[1] !== '0') console.log(`PID: ${pidMatch[1]}`);

  printWindowsCommands(state);
}

function printWindowsInfo(exePath: string): void {
  console.log('');
  console.log('📋 서비스 정보:');
  console.log(`   이름: ${WIN_SERVICE_NAME}`);
  console.log(`   표시: ${WIN_SERVICE_DISPLAY}`);
  console.log(`   실행: ${exePath}`);
  console.log('   시작: 자동 (PC 부팅 시 자동 실행)');
  console.log('   복구: 실패 시 60초 후 자동 재시작');
  console.log('');
  console.log('💡 관리 명령:');
  console.log('   상태 확인: sync-agent --service-status');
  console.log(`   서비스 중지: sc stop ${WIN_SERVICE_NAME}`);
  console.log(`   서비스 시작: sc start ${WIN_SERVICE_NAME}`);
  console.log('   서비스 제거: sync-agent --uninstall-service');
  console.log('');
}

function printWindowsCommands(state: string): void {
  console.log('');
  console.log('💡 명령:');
  if (state === 'RUNNING') {
    console.log(`   중지: sc stop ${WIN_SERVICE_NAME}`);
    console.log(`   재시작: sc stop ${WIN_SERVICE_NAME} && sc start ${WIN_SERVICE_NAME}`);
  } else if (state === 'STOPPED') {
    console.log(`   시작: sc start ${WIN_SERVICE_NAME}`);
  }
  console.log('   제거: sync-agent --uninstall-service');
  console.log('');
}

// ═══════════════════════════════════════════════════════════
// Linux 서비스 (systemd)
// ═══════════════════════════════════════════════════════════

const SYSTEMD_UNIT_PATH = `/etc/systemd/system/${LINUX_SERVICE_NAME}.service`;

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

function getSystemdUnit(exePath: string): string {
  const workDir = path.dirname(exePath);
  return `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exePath}
WorkingDirectory=${workDir}
Restart=on-failure
RestartSec=60
StartLimitIntervalSec=600
StartLimitBurst=3
Environment=RUNNING_AS_SERVICE=true
Environment=NODE_ENV=production

# 보안 설정
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${workDir}/data ${workDir}/logs ${workDir}/temp
ProtectHome=true

# 로그
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${LINUX_SERVICE_NAME}

[Install]
WantedBy=multi-user.target
`;
}

function installServiceLinux(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sync Agent — Linux 서비스 설치 (systemd)║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (!isRoot()) {
    console.error('❌ root 권한이 필요합니다.');
    console.error('   sudo sync-agent --install-service');
    console.error('');
    process.exit(1);
  }

  const exePath = getExePath();
  const workDir = path.dirname(exePath);
  console.log(`바이너리 경로: ${exePath}`);
  console.log(`작업 디렉토리: ${workDir}`);

  // 기존 서비스 확인
  const statusResult = runCommand(`systemctl is-active ${LINUX_SERVICE_NAME}`);
  if (statusResult.output === 'active') {
    console.log('⚠️  기존 서비스가 실행 중입니다.');
    console.log('   먼저 --uninstall-service로 제거 후 다시 설치하세요.');
    console.log('');
    process.exit(1);
  }

  // 필요 디렉토리 생성
  for (const dir of ['data', 'logs', 'temp']) {
    const dirPath = path.join(workDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`디렉토리 생성: ${dirPath}`);
    }
  }

  // 바이너리 실행 권한
  fs.chmodSync(exePath, 0o755);

  // systemd unit 파일 생성
  const unitContent = getSystemdUnit(exePath);
  fs.writeFileSync(SYSTEMD_UNIT_PATH, unitContent, { encoding: 'utf8' });
  console.log(`✅ systemd unit 파일 생성: ${SYSTEMD_UNIT_PATH}`);

  // systemd 리로드
  const reloadResult = runCommand('systemctl daemon-reload');
  if (!reloadResult.success) {
    console.error('❌ systemctl daemon-reload 실패:', reloadResult.output);
    process.exit(1);
  }

  // 서비스 활성화 (부팅 시 자동 시작)
  const enableResult = runCommand(`systemctl enable ${LINUX_SERVICE_NAME}`);
  if (enableResult.success) {
    console.log('✅ 서비스 활성화 완료 (부팅 시 자동 시작)');
  }

  // 서비스 시작
  const startResult = runCommand(`systemctl start ${LINUX_SERVICE_NAME}`);
  if (startResult.success) {
    console.log('✅ 서비스 시작 완료');
  } else {
    console.log('⚠️  서비스 시작 실패 — 로그를 확인해주세요:');
    console.log(`   journalctl -u ${LINUX_SERVICE_NAME} -n 20`);
  }

  printLinuxInfo(exePath);
}

function uninstallServiceLinux(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Sync Agent — Linux 서비스 제거 (systemd)║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  if (!isRoot()) {
    console.error('❌ root 권한이 필요합니다.');
    console.error('   sudo sync-agent --uninstall-service');
    console.error('');
    process.exit(1);
  }

  // 서비스 존재 확인
  if (!fs.existsSync(SYSTEMD_UNIT_PATH)) {
    console.log('ℹ️  서비스가 설치되어 있지 않습니다.');
    console.log('');
    return;
  }

  // 실행 중이면 중지
  const statusResult = runCommand(`systemctl is-active ${LINUX_SERVICE_NAME}`);
  if (statusResult.output === 'active') {
    console.log('서비스 중지 중...');
    runCommand(`systemctl stop ${LINUX_SERVICE_NAME}`);
    console.log('✅ 서비스 중지 완료');
  }

  // 서비스 비활성화
  runCommand(`systemctl disable ${LINUX_SERVICE_NAME}`);
  console.log('✅ 서비스 비활성화 완료');

  // unit 파일 삭제
  fs.unlinkSync(SYSTEMD_UNIT_PATH);
  runCommand('systemctl daemon-reload');
  console.log('✅ 서비스 제거 완료');
  console.log('');
}

function serviceStatusLinux(): void {
  console.log('');

  if (!fs.existsSync(SYSTEMD_UNIT_PATH)) {
    console.log(`ℹ️  서비스 "${LINUX_SERVICE_NAME}" 이 설치되어 있지 않습니다.`);
    console.log('   설치: sudo sync-agent --install-service');
    console.log('');
    return;
  }

  const activeResult = runCommand(`systemctl is-active ${LINUX_SERVICE_NAME}`);
  const enabledResult = runCommand(`systemctl is-enabled ${LINUX_SERVICE_NAME}`);

  const stateEmoji: Record<string, string> = {
    active: '🟢 실행 중',
    inactive: '🔴 중지됨',
    failed: '🔴 실패',
    activating: '🟡 시작 중...',
    deactivating: '🟡 중지 중...',
  };

  const state = activeResult.output;
  console.log(`서비스: ${LINUX_SERVICE_NAME}`);
  console.log(`상태: ${stateEmoji[state] || state}`);
  console.log(`자동시작: ${enabledResult.output === 'enabled' ? '✅ 활성화' : '❌ 비활성화'}`);

  // PID 확인
  const pidResult = runCommand(`systemctl show ${LINUX_SERVICE_NAME} --property=MainPID --value`);
  if (pidResult.success && pidResult.output !== '0') {
    console.log(`PID: ${pidResult.output}`);
  }

  // 최근 로그 3줄
  const logResult = runCommand(`journalctl -u ${LINUX_SERVICE_NAME} -n 3 --no-pager -o short-iso`);
  if (logResult.success && logResult.output) {
    console.log('');
    console.log('📋 최근 로그:');
    for (const line of logResult.output.split('\n').slice(0, 3)) {
      console.log(`   ${line}`);
    }
  }

  printLinuxCommands(state);
}

function printLinuxInfo(exePath: string): void {
  console.log('');
  console.log('📋 서비스 정보:');
  console.log(`   이름: ${LINUX_SERVICE_NAME}`);
  console.log(`   설명: ${SERVICE_DESCRIPTION}`);
  console.log(`   실행: ${exePath}`);
  console.log('   시작: 부팅 시 자동 실행');
  console.log('   복구: 실패 시 60초 후 자동 재시작 (최대 3회/10분)');
  console.log(`   Unit: ${SYSTEMD_UNIT_PATH}`);
  console.log('');
  console.log('💡 관리 명령:');
  console.log('   상태 확인: sync-agent --service-status');
  console.log(`   또는: systemctl status ${LINUX_SERVICE_NAME}`);
  console.log(`   로그 확인: journalctl -u ${LINUX_SERVICE_NAME} -f`);
  console.log(`   서비스 중지: sudo systemctl stop ${LINUX_SERVICE_NAME}`);
  console.log(`   서비스 시작: sudo systemctl start ${LINUX_SERVICE_NAME}`);
  console.log(`   서비스 재시작: sudo systemctl restart ${LINUX_SERVICE_NAME}`);
  console.log('   서비스 제거: sudo sync-agent --uninstall-service');
  console.log('');
}

function printLinuxCommands(state: string): void {
  console.log('');
  console.log('💡 명령:');
  if (state === 'active') {
    console.log(`   중지: sudo systemctl stop ${LINUX_SERVICE_NAME}`);
    console.log(`   재시작: sudo systemctl restart ${LINUX_SERVICE_NAME}`);
    console.log(`   로그: journalctl -u ${LINUX_SERVICE_NAME} -f`);
  } else {
    console.log(`   시작: sudo systemctl start ${LINUX_SERVICE_NAME}`);
    console.log(`   로그 확인: journalctl -u ${LINUX_SERVICE_NAME} -n 50`);
  }
  console.log('   제거: sudo sync-agent --uninstall-service');
  console.log('');
}

// ═══════════════════════════════════════════════════════════
// 공개 API (OS 자동 분기)
// ═══════════════════════════════════════════════════════════

export function installService(): void {
  if (isWindows) {
    installServiceWindows();
  } else {
    installServiceLinux();
  }
}

export function uninstallService(): void {
  if (isWindows) {
    uninstallServiceWindows();
  } else {
    uninstallServiceLinux();
  }
}

export function serviceStatus(): void {
  if (isWindows) {
    serviceStatusWindows();
  } else {
    serviceStatusLinux();
  }
}
