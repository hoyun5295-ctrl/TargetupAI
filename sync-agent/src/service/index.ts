/**
 * 서비스 관리 모듈 (Windows + Linux)
 *
 * Windows: 작업 스케줄러(schtasks)로 부팅 자동시작 작업 등록/해제
 *   ★ 2026-06-18: Windows 서비스(sc create) → 작업 스케줄러로 교체 (1053 근본 해소).
 *     Node pkg 단일 exe는 SCM 핸드셰이크(SetServiceStatus)를 못 해, sc 서비스로 등록하면
 *     시작 시 STATE RUNNING 보고를 못 함 → SCM 타임아웃 → 1053 (어느 Windows에서도 동일).
 *     WinSW=.NET 의존, NSSM=외부 바이너리 동봉 필요 → 둘 다 "모든 환경 보장" 불가.
 *     작업 스케줄러는 모든 Windows(2008 R2~11) 내장 + .NET/외부 바이너리/SCM 0 → 1053 자체가 없음.
 *   콘솔 출력은 ASCII 태그 + 한글 (2008 R2 cp949 콘솔 mojibake 차단: 이모지/박스문자 제거 — 4-B).
 * Linux: systemd unit (Type=simple) — 종전 그대로 (1053과 무관, 정상 동작).
 *
 * CLI:
 *   sync-agent --install-service    → 등록 (Windows=작업 스케줄러 / Linux=systemd)
 *   sync-agent --uninstall-service  → 제거
 *   sync-agent --service-status     → 상태 확인
 *
 * Windows 작업명: SyncAgent  /  Linux 서비스명: sync-agent
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── 공통 설정 ──────────────────────────────────────────

const isWindows = process.platform === 'win32';

const WIN_TASK_NAME = 'SyncAgent';
const WIN_TASK_DISPLAY = 'Sync Agent';
const LINUX_SERVICE_NAME = 'sync-agent';
const SERVICE_DESCRIPTION = '한줄로(Target-UP) 데이터 동기화 에이전트 — 고객사 POS/ERP DB에서 한줄로 서버로 고객·구매 데이터를 자동 동기화합니다.';
// 작업 스케줄러 XML은 schtasks가 파싱(콘솔 출력 아님)하나, 구형 OS 파서 안전을 위해 작업 설명은 ASCII 고정.
const WIN_TASK_DESCRIPTION = 'Hanjullo (Target-UP) data sync agent. Auto-starts at boot as SYSTEM.';

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
// Windows 작업 스케줄러 (schtasks)
// ═══════════════════════════════════════════════════════════

function isWindowsAdmin(): boolean {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 작업 스케줄러 XML(1.2):
//   - 부팅 트리거 + 2분 지연 (D142: 부팅 직후 네트워크/DB 미준비 상태 회피)
//   - SYSTEM 계정(S-1-5-18, 로케일 무관) + 최고 권한
//   - 실패 시 1분 후 재시작(최대 3회), 실행시간 무제한(PT0S — 기본 72시간 종료 함정 차단)
//   - 액션: sync-agent.exe --service (main.ts가 마법사 대신 에이전트 루프 실행)
function buildWindowsTaskXml(exePath: string): string {
  const workDir = path.dirname(exePath);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${WIN_TASK_DESCRIPTION}</Description>
    <URI>\\${WIN_TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT2M</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(exePath)}</Command>
      <Arguments>--service</Arguments>
      <WorkingDirectory>${esc(workDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

// 효과 검증용 — 실제 에이전트 프로세스 기동 여부 (로케일 무관: tasklist 이미지명)
function isAgentProcessRunning(): boolean {
  const exeName = path.basename(getExePath());
  const r = runCommand(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`);
  return r.success && r.output.toLowerCase().includes(exeName.toLowerCase());
}

// 레거시 정리 — 과거 sc 서비스(1053으로 죽던 구버전) + 기존 동일명 작업 모두 제거 (idempotent)
function cleanupWindowsLeftovers(): void {
  runCommand(`sc stop ${WIN_TASK_NAME}`);
  runCommand(`sc delete ${WIN_TASK_NAME}`);
  runCommand(`schtasks /End /TN "${WIN_TASK_NAME}"`);
  runCommand(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F`);
}

function installServiceWindows(): void {
  console.log('');
  console.log('==================================================');
  console.log('  Sync Agent - Windows 작업 등록 (작업 스케줄러)');
  console.log('==================================================');
  console.log('');

  if (!isWindowsAdmin()) {
    console.error('[ERROR] 관리자 권한이 필요합니다.');
    console.error('        cmd/PowerShell 을 관리자 권한으로 실행 후 다시 시도하세요.');
    console.error('');
    process.exit(1);
  }

  const exePath = getExePath();
  console.log(`exe 경로: ${exePath}`);

  // 1) 레거시 + 기존 작업 정리 — 실패했던 설치 흔적이 있어도 깨끗이 재등록
  cleanupWindowsLeftovers();

  // 2) XML 작성 (UTF-16LE + BOM = 작업 스케줄러 표준 포맷)
  const xmlPath = path.join(os.tmpdir(), `syncagent-task-${process.pid}.xml`);
  fs.writeFileSync(xmlPath, '﻿' + buildWindowsTaskXml(exePath), { encoding: 'utf16le' });

  // 3) 작업 생성
  const createResult = runCommand(`schtasks /Create /TN "${WIN_TASK_NAME}" /XML "${xmlPath}" /F`);
  try { fs.unlinkSync(xmlPath); } catch { /* noop */ }
  if (!createResult.success) {
    console.error('[ERROR] 작업 생성 실패:', createResult.output);
    process.exit(1);
  }
  console.log('[OK] 작업 등록 완료 (부팅 시 SYSTEM 권한 자동 시작, 2분 지연, 실패 시 자동 재시작)');

  // 4) 즉시 시작
  const startResult = runCommand(`schtasks /Run /TN "${WIN_TASK_NAME}"`);
  if (!startResult.success) {
    console.log(`[WARN] 즉시 시작 실패 - 수동 시작: schtasks /Run /TN ${WIN_TASK_NAME}`);
  }

  // 5) 효과 검증 — 실제 프로세스가 떴는지 확인한 뒤에만 성공 표시 (6원칙 #2)
  let running = false;
  for (let i = 0; i < 10; i++) {
    if (isAgentProcessRunning()) { running = true; break; }
    try { execSync('timeout /t 1 /nobreak >nul', { stdio: 'ignore' }); } catch { /* noop */ }
  }
  if (running) {
    console.log('[OK] 에이전트 실행 확인 (프로세스 기동됨)');
  } else {
    console.log('[INFO] 에이전트 프로세스가 아직 확인되지 않습니다.');
    console.log('       설정이 없으면 먼저 설정하세요: sync-agent.exe --setup');
    console.log('       (설정 완료 후 자동 시작되며, 재부팅 시에도 자동 시작됩니다)');
  }

  printWindowsInfo(exePath);
}

function uninstallServiceWindows(): void {
  console.log('');
  console.log('==================================================');
  console.log('  Sync Agent - Windows 작업 제거');
  console.log('==================================================');
  console.log('');

  if (!isWindowsAdmin()) {
    console.error('[ERROR] 관리자 권한이 필요합니다.');
    console.error('        cmd/PowerShell 을 관리자 권한으로 실행 후 다시 시도하세요.');
    console.error('');
    process.exit(1);
  }

  // 작업 + 레거시 sc 서비스 모두 제거 (idempotent)
  runCommand(`schtasks /End /TN "${WIN_TASK_NAME}"`);
  const delTask = runCommand(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F`);
  runCommand(`sc stop ${WIN_TASK_NAME}`);
  runCommand(`sc delete ${WIN_TASK_NAME}`);

  if (delTask.success) {
    console.log('[OK] 작업 제거 완료');
  } else {
    console.log('[INFO] 제거할 작업이 없거나 이미 제거되었습니다.');
  }
  console.log('');
}

function serviceStatusWindows(): void {
  console.log('');
  const exists = runCommand(`schtasks /Query /TN "${WIN_TASK_NAME}"`);
  if (!exists.success) {
    console.log(`[INFO] 작업 "${WIN_TASK_DISPLAY}" 가 등록되어 있지 않습니다.`);
    console.log('       등록: sync-agent.exe --install-service');
    console.log('');
    return;
  }

  const running = isAgentProcessRunning();
  console.log(`작업: ${WIN_TASK_DISPLAY} (${WIN_TASK_NAME})`);
  console.log(`상태: ${running ? '[RUNNING] 실행 중' : '[STOPPED] 중지됨'}`);
  console.log('');
  console.log('명령:');
  if (running) {
    console.log(`  중지: schtasks /End /TN ${WIN_TASK_NAME}`);
  } else {
    console.log(`  시작: schtasks /Run /TN ${WIN_TASK_NAME}`);
  }
  console.log('  제거: sync-agent.exe --uninstall-service');
  console.log('');
}

function printWindowsInfo(exePath: string): void {
  console.log('');
  console.log('작업 정보:');
  console.log(`  이름: ${WIN_TASK_NAME}`);
  console.log(`  실행: ${exePath} --service`);
  console.log('  시작: 부팅 시 자동 (SYSTEM 권한, 2분 지연)');
  console.log('  복구: 실패 시 1분 후 자동 재시작 (최대 3회)');
  console.log('');
  console.log('관리 명령:');
  console.log('  상태 확인: sync-agent.exe --service-status');
  console.log(`  중지: schtasks /End /TN ${WIN_TASK_NAME}`);
  console.log(`  시작: schtasks /Run /TN ${WIN_TASK_NAME}`);
  console.log('  제거: sync-agent.exe --uninstall-service');
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
