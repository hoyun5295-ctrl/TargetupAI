/**
 * 자동 업데이트 스크립트/런처 빌더 (순수 함수 — 테스트 가능 단위)
 *
 * 자기교체 결함(2026-07-03 isae) 근본수정:
 *  - Windows: 교체 bat을 SyncAgent 작업 job 밖(별도 일회성 작업 SyncAgentUpdate)에서 실행. [spike-1 실측]
 *  - Linux: 교체 sh를 서비스 cgroup/샌드박스 밖(systemd-run transient 서비스)에서 실행. [spike-2 실측]
 *  - 양 OS 원자적 스왑(move /y · mv = 동일 볼륨 원자 교체) → exe 부재 순간 제거(D-4 브릭 차단).
 *
 * 콘솔 bat는 전부 ASCII (2008 R2 cp949 콘솔에서 한글 bat는 명령 파싱이 깨져 실행 실패 — 2026-06-19 실측).
 */

const WIN_AGENT_TASK = 'SyncAgent';
const WIN_UPDATE_TASK = 'SyncAgentUpdate';
const WIN_RESTART_TASK = 'SyncAgentRestart';
const LINUX_SERVICE = 'sync-agent';
const LINUX_UPDATE_UNIT = 'sync-agent-update';

export interface WinUpdateScriptParams {
  currentVersion: string;
  newVersion: string;
  currentExePath: string;
  newBinPath: string;
  pid: number;
  agentTaskName?: string;
  updateTaskName?: string;
  /** 에이전트 중지 명령 (기본: 서비스=schtasks /End). 콘솔=taskkill /PID. */
  stopCmd?: string;
  /** 에이전트 재기동 명령 (기본: 서비스=schtasks /Run). 콘솔=start "" exe. */
  restartCmd?: string;
}

/**
 * Windows 교체 bat — 별도 일회성 작업(SyncAgentUpdate) job에서 실행되는 스크립트.
 * SyncAgent 작업을 /End 해도 이 bat은 다른 job이라 살아남아 교체를 완주한다. [spike-1]
 */
export function buildWindowsUpdateBat(p: WinUpdateScriptParams): string {
  const agentTask = p.agentTaskName ?? WIN_AGENT_TASK;
  const updateTask = p.updateTaskName ?? WIN_UPDATE_TASK;
  const stopCmd = p.stopCmd ?? `schtasks /End /TN ${agentTask}`;
  const restartCmd = p.restartCmd ?? `schtasks /Run /TN ${agentTask}`;
  const exe = p.currentExePath;
  const neu = `${exe}.new`;
  const old = `${exe}.old`;

  return `@echo off
chcp 65001 >nul
echo [Sync Agent Updater] Update start: ${p.currentVersion} to ${p.newVersion}

REM 1. stop agent (agent may have already exited)
echo Stopping agent...
${stopCmd} >nul 2>&1

REM wait for old process (PID ${p.pid}) to exit, up to 30s
set /a count=0
:waitloop
tasklist /FI "PID eq ${p.pid}" 2>nul | find "${p.pid}" >nul
if errorlevel 1 goto afterwait
timeout /t 1 /nobreak >nul
set /a count+=1
if %count% geq 30 (
  echo [ERROR] Process stop timeout - update canceled
  ${restartCmd} >nul 2>&1
  goto cleanup_selftask
)
goto waitloop
:afterwait
echo Process stopped

REM 2. stage new binary as .new (exe untouched)
echo Staging new binary...
copy /y "${p.newBinPath}" "${neu}" >nul
if not exist "${neu}" (
  echo [ERROR] Staging copy failed - update canceled
  schtasks /Run /TN ${agentTask} >nul 2>&1
  goto cleanup_selftask
)

REM 3. backup current exe (rollback source)
if exist "${old}" del /f "${old}"
copy /y "${exe}" "${old}" >nul

REM 4. atomic replace: .new -> exe (move /y = NTFS same-volume atomic; exe never absent)
move /y "${neu}" "${exe}" >nul
if errorlevel 1 (
  echo [ERROR] Atomic replace failed - rolling back
  if exist "${old}" copy /y "${old}" "${exe}" >nul
  ${restartCmd} >nul 2>&1
  goto cleanup_selftask
)
echo New version applied

REM 5. restart agent
echo Restarting agent...
${restartCmd}

REM 6. cleanup leftovers
timeout /t 5 /nobreak >nul
if exist "${old}" del /f "${old}"
if exist "${neu}" del /f "${neu}"
if exist "${p.newBinPath}" del /f "${p.newBinPath}"
echo [Sync Agent Updater] Update complete: v${p.newVersion}

:cleanup_selftask
REM 7. remove our one-time task + self-delete
schtasks /Delete /TN ${updateTask} /F >nul 2>&1
(goto) 2>nul & del "%~f0"
`;
}

export interface WinLauncher {
  createCmd: string;
  runCmd: string;
}

/** SyncAgent job 밖에서 bat을 실행할 별도 일회성 작업 등록/실행 명령. */
export function buildWindowsUpdateLauncher(
  batPath: string,
  updateTaskName: string = WIN_UPDATE_TASK,
  startHHMM: string = '00:00',
): WinLauncher {
  // /TR은 반드시 `cmd /c <bat>` — bat 경로만 주면 2008 R2에서 작업이 bat을 실행하지 않는다(VM E2E 실측).
  //   설치 경로는 공백 없음(가이드 C:\SyncAgent) 전제 — 공백 경로 지원 필요 시 /XML 등록 방식으로 전환.
  return {
    createCmd: `schtasks /Create /TN ${updateTaskName} /TR "cmd /c ${batPath}" /SC ONCE /ST ${startHHMM} /RU SYSTEM /RL HIGHEST /F`,
    runCmd: `schtasks /Run /TN ${updateTaskName}`,
  };
}

export interface LinuxUpdateScriptParams {
  currentVersion: string;
  newVersion: string;
  currentBinPath: string;
  newBinPath: string;
  pid: number;
  serviceName?: string;
  /** 중지 명령 (기본: 서비스=systemctl stop). 콘솔=kill <pid>. */
  stopCmd?: string;
  /** 재기동 명령 (기본: 서비스=systemctl start). 콘솔=nohup bin &. */
  startCmd?: string;
}

/**
 * Linux 교체 sh — systemd-run transient 서비스(새 mount namespace)에서 실행되는 스크립트.
 * 서비스 cgroup을 stop 해도 형제 유닛이라 살아남고, ProtectSystem 미상속이라 exe 쓰기 가능. [spike-2]
 */
export function buildLinuxUpdateSh(p: LinuxUpdateScriptParams): string {
  const svc = p.serviceName ?? LINUX_SERVICE;
  const stopCmd = p.stopCmd ?? `systemctl stop ${svc}`;
  const startCmd = p.startCmd ?? `systemctl start ${svc}`;
  const bin = p.currentBinPath;
  const neu = `${bin}.new`;
  const old = `${bin}.old`;

  return `#!/bin/bash
echo "[Sync Agent Updater] update start: ${p.currentVersion} -> ${p.newVersion}"

# 1. stop service (agent may have already exited)
${stopCmd} 2>/dev/null || true

# wait for old process (PID ${p.pid}) to exit, up to 30s
count=0
while kill -0 ${p.pid} 2>/dev/null; do
  sleep 1
  count=$((count + 1))
  if [ $count -ge 30 ]; then
    echo "[ERROR] stop timeout - update canceled"
    ${startCmd} 2>/dev/null || true
    exit 1
  fi
done
echo "process stopped"

# 2. stage new binary as .new (bin untouched)
cp "${p.newBinPath}" "${neu}"
if [ ! -s "${neu}" ]; then
  echo "[ERROR] staging failed - update canceled"
  systemctl start ${svc} 2>/dev/null || true
  exit 1
fi
chmod 755 "${neu}"
sync

# 3. backup current binary (rollback source)
rm -f "${old}"
cp "${bin}" "${old}"

# 4. atomic replace: .new -> bin (mv = same-fs atomic rename; bin never absent)
mv "${neu}" "${bin}"
if [ $? -ne 0 ]; then
  echo "[ERROR] atomic replace failed - rolling back"
  cp "${old}" "${bin}" 2>/dev/null || true
  ${startCmd} 2>/dev/null || true
  exit 1
fi
chmod 755 "${bin}"
echo "new version applied"

# 5. restart service
${startCmd}

# 6. cleanup leftovers
sleep 5
rm -f "${old}" "${neu}" "${p.newBinPath}"
echo "[Sync Agent Updater] update complete: v${p.newVersion}"

# self-delete
rm -f "$0"
`;
}

export interface LinuxLauncher {
  cmd: string;
  args: string[];
}

/** 서비스 cgroup/샌드박스 밖에서 sh를 실행할 systemd-run transient 서비스 명령. (--scope 아님) */
export function buildLinuxUpdateLauncher(shPath: string, unit: string = LINUX_UPDATE_UNIT): LinuxLauncher {
  return {
    cmd: 'systemd-run',
    args: [`--unit=${unit}`, '--quiet', '/bin/bash', shPath],
  };
}

/**
 * Windows 'restart' 원격 명령 — 예약작업 모델에서 process.exit(0)은 자동 재시작을 트리거하지 못한다
 * (exit 0 = 정상종료 → RestartOnFailure 미발동, BootTrigger는 다음 부팅까지 대기).
 * 별도 일회성 작업(SyncAgentRestart)에서 /End 후 /Run 하여 실제 재시작을 보장한다.
 */
export function buildWindowsRestartBat(
  agentTaskName: string = WIN_AGENT_TASK,
  restartTaskName: string = WIN_RESTART_TASK,
): string {
  return `@echo off
chcp 65001 >nul
echo [Sync Agent] Restart requested
schtasks /End /TN ${agentTaskName} >nul 2>&1
timeout /t 3 /nobreak >nul
schtasks /Run /TN ${agentTaskName}
schtasks /Delete /TN ${restartTaskName} /F >nul 2>&1
(goto) 2>nul & del "%~f0"
`;
}

export function buildWindowsRestartLauncher(
  batPath: string,
  restartTaskName: string = WIN_RESTART_TASK,
  startHHMM: string = '00:00',
): WinLauncher {
  // /TR은 반드시 `cmd /c <bat>` — bare bat 경로는 2008 R2에서 실행 안 됨(VM E2E 실측).
  return {
    createCmd: `schtasks /Create /TN ${restartTaskName} /TR "cmd /c ${batPath}" /SC ONCE /ST ${startHHMM} /RU SYSTEM /RL HIGHEST /F`,
    runCmd: `schtasks /Run /TN ${restartTaskName}`,
  };
}
