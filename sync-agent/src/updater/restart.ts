/**
 * 원격 'restart' 명령 실행 — 예약작업/systemd 모델에서 process.exit(0)이 자동 재시작을 트리거하지 못하는
 * 결함을 근본 수정한다.
 *
 * Windows 예약작업: exit 0 = 정상종료라 RestartOnFailure 미발동, BootTrigger는 다음 부팅까지 대기.
 *   → 별도 일회성 작업(SyncAgentRestart)에서 /End 후 /Run 하여 실제 재기동. [자기교체 spike-1과 동일 원리]
 * Linux systemd: Restart=on-failure라 exit 0에 재시작 안 됨.
 *   → systemd-run transient로 `systemctl restart`를 매니저에 위임(형제 컨텍스트라 stop에 안 죽음). [spike-2와 동일 원리]
 * 콘솔: exe를 detached 재실행 후 종료.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execSync, spawn, spawnSync } from 'node:child_process';
import { getLogger } from '../logger';
import { buildWindowsRestartBat, buildWindowsRestartLauncher } from './scripts';
import { hhmmMinutesFromNow } from './index';

const logger = getLogger('restart');
const isWindows = process.platform === 'win32';

function hasCommand(cmd: string): boolean {
  try {
    execSync(isWindows ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 재시작을 실행한다. 성공적으로 재시작 트리거가 걸리면 프로세스를 종료(또는 systemd가 종료)한다.
 * 트리거 등록 자체가 실패하면 종료하지 않고 그대로 유지한다(교체/재시작 미실행 + 종료 = 죽은 박스 방지).
 */
export function restartAgent(): void {
  const isService = isWindows
    ? process.argv.includes('--service') || process.env.RUNNING_AS_SERVICE === 'true'
    : process.env.RUNNING_AS_SERVICE === 'true' || process.env.INVOCATION_ID !== undefined;

  // ── Windows 서비스(예약작업) ──
  if (isWindows && isService) {
    const tempDir = path.join(path.dirname(process.execPath), 'temp');
    try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch { /* noop */ }
    const batPath = path.join(tempDir, 'restart.bat');
    try {
      fs.writeFileSync(batPath, buildWindowsRestartBat(), { encoding: 'utf8' });
      const { createCmd, runCmd } = buildWindowsRestartLauncher(batPath, undefined, hhmmMinutesFromNow(3));
      try { execSync('schtasks /Delete /TN SyncAgentRestart /F', { stdio: 'ignore' }); } catch { /* 잔존 없으면 무시 */ }
      execSync(createCmd, { stdio: 'ignore' });
      execSync(runCmd, { stdio: 'ignore' });
    } catch (e: any) {
      logger.error(`재시작 작업 등록/실행 실패 — 종료하지 않고 유지: ${e?.message || e}`);
      return;
    }
    logger.info('재시작 작업(SyncAgentRestart) 실행 — 곧 재기동됩니다');
    setTimeout(() => process.exit(0), 1000);
    return;
  }

  // ── Linux systemd 서비스 ──
  if (!isWindows && isService) {
    try {
      if (hasCommand('systemd-run')) {
        try { execSync('systemctl reset-failed sync-agent-restart', { stdio: 'ignore' }); } catch { /* noop */ }
        const r = spawnSync('systemd-run', ['--unit=sync-agent-restart', '--quiet', 'systemctl', 'restart', 'sync-agent'], { stdio: 'ignore' });
        if (r.error) throw r.error;
      } else {
        // systemd-run 부재 — 매니저가 restart 잡을 소유하므로 직접 위임 시도
        spawnSync('systemctl', ['restart', 'sync-agent'], { stdio: 'ignore' });
      }
    } catch (e: any) {
      logger.error(`systemd 재시작 실패 — 유지: ${e?.message || e}`);
      return;
    }
    logger.info('재시작(systemctl restart) 위임 — systemd가 재기동합니다');
    return; // systemd가 우리를 stop 후 start
  }

  // ── 콘솔 모드 ──
  try {
    if (isWindows) {
      const child = execFile('cmd.exe', ['/c', `start "" "${process.execPath}"`], {
        detached: true, windowsHide: true, stdio: 'ignore',
      } as any);
      child.unref();
    } else {
      const child = spawn(process.execPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch (e: any) {
    logger.error(`콘솔 재시작 실패 — 유지: ${e?.message || e}`);
    return;
  }
  logger.info('재시작(콘솔 detached 재실행) — 곧 종료합니다');
  setTimeout(() => process.exit(0), 500);
}
