import { describe, it, expect, vi } from 'vitest';
import {
  buildWindowsUpdateBat,
  buildWindowsUpdateLauncher,
  buildLinuxUpdateSh,
  buildLinuxUpdateLauncher,
  buildWindowsRestartBat,
  buildWindowsRestartLauncher,
} from './scripts';
import { UpdateManager } from './index';

const WIN_EXE = 'C:\\SyncAgent\\sync-agent.exe';
const WIN_NEW = 'C:\\SyncAgent\\temp\\sync-agent-1.6.0.exe';
const LIN_BIN = '/opt/sync-agent/sync-agent';
const LIN_NEW = '/opt/sync-agent/temp/sync-agent-1.6.0';

describe('Windows update bat — job 밖 실행 + 원자적 스왑', () => {
  const bat = buildWindowsUpdateBat({
    currentVersion: '1.5.7',
    newVersion: '1.6.0',
    currentExePath: WIN_EXE,
    newBinPath: WIN_NEW,
    pid: 4242,
  });

  it('SyncAgent 작업을 종료한다', () => {
    expect(bat).toContain('schtasks /End /TN SyncAgent');
  });

  it('교체 후 SyncAgent 작업을 재기동한다', () => {
    expect(bat).toContain('schtasks /Run /TN SyncAgent');
  });

  it('자기 일회성 작업(SyncAgentUpdate)을 마지막에 삭제한다', () => {
    expect(bat).toContain('schtasks /Delete /TN SyncAgentUpdate /F');
  });

  it('새 바이너리를 먼저 .new 로 복사한다', () => {
    expect(bat).toContain(`copy /y "${WIN_NEW}" "${WIN_EXE}.new"`);
  });

  it('원자적 move /y 로 .new 를 exe 자리로 교체한다', () => {
    expect(bat).toContain(`move /y "${WIN_EXE}.new" "${WIN_EXE}"`);
  });

  it('롤백용 .old 백업을 둔다', () => {
    expect(bat).toContain(`${WIN_EXE}.old`);
  });

  it('새 바이너리를 exe 자리에 직접 copy 하지 않는다(원자 스왑 아닌 옛 공백 패턴 폐기)', () => {
    expect(bat).not.toContain(`copy /y "${WIN_NEW}" "${WIN_EXE}"`);
  });
});

describe('Windows update launcher — 별도 일회성 작업', () => {
  const l = buildWindowsUpdateLauncher('C:\\SyncAgent\\temp\\update.bat');

  it('SyncAgentUpdate 이름의 ONCE/SYSTEM/HIGHEST 작업을 생성한다', () => {
    expect(l.createCmd).toContain('/TN SyncAgentUpdate');
    expect(l.createCmd).toContain('/SC ONCE');
    expect(l.createCmd).toContain('/RU SYSTEM');
    expect(l.createCmd).toContain('/RL HIGHEST');
    expect(l.createCmd).toContain('/F');
    expect(l.createCmd).toContain('update.bat');
  });

  it('bat을 cmd /c 로 실행한다 (bare .bat 경로는 2008 R2에서 작업이 실행 안 됨 — VM E2E 실측)', () => {
    expect(l.createCmd).toContain('cmd /c');
  });

  it('그 작업을 즉시 실행한다', () => {
    expect(l.runCmd).toContain('/Run /TN SyncAgentUpdate');
  });
});

describe('Linux update sh — 서비스 밖 실행 + 원자적 스왑', () => {
  const sh = buildLinuxUpdateSh({
    currentVersion: '1.5.7',
    newVersion: '1.6.0',
    currentBinPath: LIN_BIN,
    newBinPath: LIN_NEW,
    pid: 4242,
  });

  it('서비스를 중지/재기동한다', () => {
    expect(sh).toContain('systemctl stop sync-agent');
    expect(sh).toContain('systemctl start sync-agent');
  });

  it('새 바이너리를 .new 로 복사 후 원자적 mv 로 교체한다', () => {
    expect(sh).toContain(`cp "${LIN_NEW}" "${LIN_BIN}.new"`);
    expect(sh).toContain(`mv "${LIN_BIN}.new" "${LIN_BIN}"`);
  });

  it('새 바이너리를 bin 자리에 직접 cp 하지 않는다(옛 공백 패턴 폐기)', () => {
    expect(sh).not.toContain(`cp "${LIN_NEW}" "${LIN_BIN}"`);
  });

  it('롤백용 .old 백업을 둔다', () => {
    expect(sh).toContain(`${LIN_BIN}.old`);
  });
});

describe('Linux update launcher — systemd-run transient 서비스(--scope 아님)', () => {
  const l = buildLinuxUpdateLauncher('/opt/sync-agent/temp/update.sh');

  it('systemd-run 으로 실행한다', () => {
    expect(l.cmd).toBe('systemd-run');
  });

  it('transient 서비스 유닛으로 등록한다(--unit)', () => {
    expect(l.args.join(' ')).toContain('--unit=sync-agent-update');
  });

  it('--scope 를 쓰지 않는다(샌드박스 상속으로 exe 쓰기 실패 — spike-2 실측)', () => {
    expect(l.args.join(' ')).not.toContain('--scope');
  });

  it('/bin/bash 로 sh 를 실행한다', () => {
    expect(l.args).toContain('/bin/bash');
    expect(l.args.join(' ')).toContain('/opt/sync-agent/temp/update.sh');
  });
});

describe('Windows restart 명령 — 예약작업 모델 자동 재시작 결함 수정', () => {
  const bat = buildWindowsRestartBat();

  it('SyncAgent 를 종료 후 재기동한다(별도 작업에서)', () => {
    expect(bat).toContain('schtasks /End /TN SyncAgent');
    expect(bat).toContain('schtasks /Run /TN SyncAgent');
  });

  it('자기 일회성 작업(SyncAgentRestart)을 삭제한다', () => {
    expect(bat).toContain('schtasks /Delete /TN SyncAgentRestart /F');
  });

  it('런처는 SyncAgentRestart 일회성 작업을 만든다 (cmd /c로 bat 실행)', () => {
    const l = buildWindowsRestartLauncher('C:\\SyncAgent\\temp\\restart.bat');
    expect(l.createCmd).toContain('/TN SyncAgentRestart');
    expect(l.createCmd).toContain('/SC ONCE');
    expect(l.createCmd).toContain('cmd /c');
    expect(l.runCmd).toContain('/Run /TN SyncAgentRestart');
  });
});

describe('UpdateManager.execute — 하드닝 가드', () => {
  function stubApi() {
    return {
      downloadVersion: vi.fn(async () => {
        throw new Error('downloadVersion 호출되면 안 됨(가드가 먼저 차단해야 함)');
      }),
    };
  }

  it('latestVersion 이 비면 다운로드 전에 거부한다(D-5①)', async () => {
    const api = stubApi();
    const um = new UpdateManager(api as any, '1.6.0');
    const ok = await um.execute({ updateAvailable: true, latestVersion: '' } as any);
    expect(ok).toBe(false);
    expect(api.downloadVersion).not.toHaveBeenCalled();
  });

  it('checksum 이 없으면 다운로드 전에 거부한다(오배포 차단, spec 3-3)', async () => {
    const api = stubApi();
    const um = new UpdateManager(api as any, '1.6.0');
    const ok = await um.execute({ updateAvailable: true, latestVersion: '1.7.0' } as any);
    expect(ok).toBe(false);
    expect(api.downloadVersion).not.toHaveBeenCalled();
  });

  it('동일 버전이면 스킵한다', async () => {
    const api = stubApi();
    const um = new UpdateManager(api as any, '1.6.0');
    const ok = await um.execute({ updateAvailable: true, latestVersion: '1.6.0', checksum: 'abc' } as any);
    expect(ok).toBe(false);
    expect(api.downloadVersion).not.toHaveBeenCalled();
  });
});
