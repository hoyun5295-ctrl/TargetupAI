/**
 * 자동 업데이트 실행 모듈
 *
 * 흐름:
 * 1. HeartbeatManager에서 VersionResponse 전달받음
 * 2. ApiClient.downloadVersion()으로 새 바이너리 다운로드
 * 3. SHA-256 체크섬 검증
 * 4. OS별 업데이트 스크립트 생성 → 현재 바이너리 교체 → Agent 재시작
 *
 * Windows: bat 스크립트 (실행 중 exe 직접 교체 불가)
 * Linux: sh 스크립트 (실행 중 바이너리 교체 가능하지만 안전하게 스크립트 사용)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execSync, spawn, spawnSync } from 'node:child_process';
import type { ApiClient } from '../api/client';
import type { VersionResponse } from '../types/api';
import { getLogger } from '../logger';
import {
  buildWindowsUpdateBat,
  buildWindowsUpdateLauncher,
  buildLinuxUpdateSh,
  buildLinuxUpdateLauncher,
} from './scripts';

const logger = getLogger('updater');

const isWindows = process.platform === 'win32';

/** schtasks /ST용 HH:MM (지금+mins분). /Run으로 즉시 실행하므로 실제 트리거 시각은 무의미하나 유효 포맷 필요. */
export function hhmmMinutesFromNow(mins: number): string {
  const d = new Date(Date.now() + mins * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 기동 시 자기교체 잔여물 정리 (D-4 안전망).
 * 원자적 move/mv로 exe 부재 순간은 없지만, 교체 bat이 정리 전에 죽으면 .old/.new가 남을 수 있다.
 * 현재 exe가 실행 중(=이 코드가 도는 것 자체가 증거)이므로 .old/.new는 안전하게 제거 가능.
 */
export function selfHealBinaries(exePath: string = process.execPath): void {
  for (const suffix of ['.old', '.new']) {
    const p = exePath + suffix;
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        logger.info(`자기교체 잔여물 정리: ${path.basename(p)}`);
      }
    } catch (e: any) {
      logger.warn(`잔여물 정리 실패(${path.basename(p)}): ${e?.message || e}`);
    }
  }
}

export class UpdateManager {
  private apiClient: ApiClient;
  private currentVersion: string;
  private installDir: string;
  private tempDir: string;
  private isUpdating = false;

  constructor(apiClient: ApiClient, currentVersion: string, installDir?: string) {
    this.apiClient = apiClient;
    this.currentVersion = currentVersion;
    this.installDir = installDir || process.cwd();
    this.tempDir = path.join(this.installDir, 'temp');
  }

  /**
   * 버전 응답 받아서 업데이트 필요 시 실행
   * HeartbeatManager.checkForUpdates()에서 호출
   *
   * @returns true면 업데이트 진행 (곧 process.exit), false면 스킵
   */
  async execute(versionInfo: VersionResponse): Promise<boolean> {
    // 이미 업데이트 진행 중이면 스킵
    if (this.isUpdating) {
      logger.info('업데이트 이미 진행 중 — 스킵');
      return false;
    }

    // 업데이트 필요 여부 확인
    if (!versionInfo.updateAvailable && !versionInfo.forceUpdate) {
      return false;
    }

    // D-5①: 빈/undefined 버전 진입 차단.
    //   서버 응답 파싱 정합이 깨져 latestVersion이 비면 이후 다운로드 URL/버전이 전부 무의미하고,
    //   동일버전 가드(undefined===current=false)가 무력화돼 force 재시도 루프가 생긴다.
    if (!versionInfo.latestVersion) {
      logger.warn('latestVersion이 비어 있음 — 업데이트 스킵 (서버 /version 응답 파싱 정합 확인 필요)');
      return false;
    }

    // 현재 버전과 동일하면 스킵 (force여도 동일버전 재교체 방지)
    if (versionInfo.latestVersion === this.currentVersion) {
      return false;
    }

    // D-5②/오배포 차단(spec 3-3): checksum 미제공 시 업데이트 거부.
    //   티어 오매핑(win-modern 슬롯에 win-legacy 바이너리 등) 브릭을 checksum 불일치로 막으려면
    //   checksum이 반드시 있어야 한다. 없으면 검증 자체가 불가하므로 교체하지 않는다.
    if (!(versionInfo as any).checksum) {
      logger.error('릴리즈 checksum 미제공 — 오배포/무결성 검증 불가로 업데이트 거부');
      return false;
    }

    logger.info(`업데이트 감지: ${this.currentVersion} → ${versionInfo.latestVersion} (${isWindows ? 'Windows' : 'Linux'})`);
    if (versionInfo.forceUpdate) {
      logger.warn('강제 업데이트 플래그 활성화 — 즉시 업데이트 진행');
    }
    if (versionInfo.releaseNotes) {
      logger.info(`릴리즈 노트: ${versionInfo.releaseNotes}`);
    }

    this.isUpdating = true;

    try {
      // 1. 다운로드
      const downloadPath = await this.download(versionInfo);

      // 2. 체크섬 검증 (checksum은 위에서 필수화 — 항상 검증)
      const valid = await this.verifyChecksum(downloadPath, (versionInfo as any).checksum);
      if (!valid) {
        logger.error('체크섬 검증 실패 — 업데이트 취소');
        this.cleanup(downloadPath);
        return false;
      }
      logger.info('체크섬 검증 통과');

      // 3. OS별 교체 + 재시작
      if (isWindows) {
        await this.applyUpdateWindows(downloadPath, versionInfo.latestVersion);
      } else {
        await this.applyUpdateLinux(downloadPath, versionInfo.latestVersion);
      }
      return true;

    } catch (error: any) {
      logger.error(`업데이트 실패: ${error.message}`);
      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  // ─── 다운로드 ─────────────────────────────────────────

  private async download(versionInfo: VersionResponse): Promise<string> {
    // temp 디렉토리 생성
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    const ext = isWindows ? '.exe' : '';
    const downloadPath = path.join(this.tempDir, `sync-agent-${versionInfo.latestVersion}${ext}`);

    // ApiClient의 스트림 다운로드 사용
    const { stream, totalSize } = await this.apiClient.downloadVersion(
      versionInfo.downloadUrl,
      versionInfo.latestVersion,
    );

    let downloaded = 0;
    let lastLogPct = -1;
    const writer = fs.createWriteStream(downloadPath);

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const pct = Math.floor((downloaded / totalSize) * 10) * 10; // 10% 단위
          if (pct > lastLogPct) {
            lastLogPct = pct;
            logger.info(`다운로드 진행: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
          }
        }
      });

      stream.pipe(writer);

      writer.on('finish', () => {
        logger.info(`다운로드 완료: ${(downloaded / 1024 / 1024).toFixed(1)}MB → ${downloadPath}`);

        // Linux: 실행 권한 부여
        if (!isWindows) {
          fs.chmodSync(downloadPath, 0o755);
        }

        resolve(downloadPath);
      });

      writer.on('error', (err) => {
        this.cleanup(downloadPath);
        reject(new Error(`다운로드 쓰기 실패: ${err.message}`));
      });

      stream.on('error', (err: Error) => {
        writer.close();
        this.cleanup(downloadPath);
        reject(new Error(`다운로드 스트림 실패: ${err.message}`));
      });
    });
  }

  // ─── 체크섬 검증 ──────────────────────────────────────

  private async verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => {
        const actual = hash.digest('hex');
        logger.info(`체크섬 — 예상: ${expectedHash.substring(0, 16)}... / 실제: ${actual.substring(0, 16)}...`);
        resolve(actual.toLowerCase() === expectedHash.toLowerCase());
      });
      stream.on('error', reject);
    });
  }

  // ─── Windows: bat 스크립트로 교체 ─────────────────────

  private async applyUpdateWindows(newBinPath: string, newVersion: string): Promise<void> {
    const currentExePath = process.execPath;
    const batPath = path.join(this.tempDir, 'update.bat');

    const isService = process.argv.includes('--service') ||
                      process.env.RUNNING_AS_SERVICE === 'true';

    // 콘솔 모드는 예약작업 job이 없어 자기교체 문제가 없다 — taskkill/PID + start로 교체.
    // 서비스 모드는 SyncAgent 작업 job 밖(별도 일회성 작업)에서 bat을 실행해야 job 자살을 피한다. [spike-1 실측]
    // 양쪽 모두 원자적 스왑(copy→.new, 검증, .old 백업, move /y = NTFS 원자 교체)으로 exe 부재 순간을 없앤다(D-4).
    const batContent = buildWindowsUpdateBat({
      currentVersion: this.currentVersion,
      newVersion,
      currentExePath,
      newBinPath,
      pid: process.pid,
      ...(isService ? {} : {
        stopCmd: `taskkill /PID ${process.pid} /F`,
        restartCmd: `start "" "${currentExePath}"`,
      }),
    });
    // 콘솔 bat는 전부 ASCII (2008 R2 cp949 콘솔에서 한글 bat는 파싱이 깨져 실행 실패 — 2026-06-19 실측).
    fs.writeFileSync(batPath, batContent, { encoding: 'utf8' });
    logger.info(`업데이트 스크립트 생성: ${batPath}`);

    if (isService) {
      // 별도 일회성 작업(SyncAgentUpdate)으로 실행 — SyncAgent 작업 job 밖이라 /End에 안 죽는다.
      // 등록·실행을 동기로 확인한 뒤에만 process.exit — 실패 시 에이전트를 유지(교체 미실행+종료=죽은 박스 방지).
      const startHHMM = hhmmMinutesFromNow(3);
      const { createCmd, runCmd } = buildWindowsUpdateLauncher(batPath, undefined, startHHMM);
      try {
        try { execSync('schtasks /Delete /TN SyncAgentUpdate /F', { stdio: 'ignore' }); } catch { /* 잔존 없으면 무시 */ }
        execSync(createCmd, { stdio: 'ignore' });
        execSync(runCmd, { stdio: 'ignore' });
      } catch (e: any) {
        logger.error(`업데이트 작업 등록/실행 실패 — 교체 취소, 에이전트 유지: ${e?.message || e}`);
        return;
      }
      logger.info('업데이트 작업(SyncAgentUpdate) 실행 — Agent 종료 후 새 버전으로 교체됩니다');
      await new Promise(resolve => setTimeout(resolve, 1000));
      process.exit(0);
    }

    // 콘솔 모드: detached 실행 (job 자살 없음)
    logger.info('업데이트 스크립트 실행(콘솔) — Agent 재시작 예정');
    const child = execFile('cmd.exe', ['/c', batPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    } as any);
    child.unref();
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  }

  // ─── Linux: sh 스크립트로 교체 ────────────────────────

  private async applyUpdateLinux(newBinPath: string, newVersion: string): Promise<void> {
    const currentBinPath = process.execPath;
    const shPath = path.join(this.tempDir, 'update.sh');

    // systemd 서비스로 실행 중인지 확인
    const isService = process.env.RUNNING_AS_SERVICE === 'true' ||
                      process.env.INVOCATION_ID !== undefined; // systemd가 설정하는 환경변수

    const shContent = buildLinuxUpdateSh({
      currentVersion: this.currentVersion,
      newVersion,
      currentBinPath,
      newBinPath,
      pid: process.pid,
      ...(isService ? {} : {
        stopCmd: `kill ${process.pid}`,
        startCmd: `nohup "${currentBinPath}" > /dev/null 2>&1 &`,
      }),
    });
    fs.writeFileSync(shPath, shContent, { encoding: 'utf8', mode: 0o755 });
    logger.info(`업데이트 스크립트 생성: ${shPath}`);

    // 서비스 + systemd-run 가용 → transient 서비스로 실행(서비스 cgroup/ProtectSystem 밖). [spike-2 실측]
    if (isService && this.hasCommand('systemd-run')) {
      const { cmd, args } = buildLinuxUpdateLauncher(shPath);
      try {
        try { execSync('systemctl reset-failed sync-agent-update', { stdio: 'ignore' }); } catch { /* 잔존 없으면 무시 */ }
        const r = spawnSync(cmd, args, { stdio: 'ignore' });
        if (r.error) throw r.error;
        if (typeof r.status === 'number' && r.status !== 0) throw new Error(`systemd-run exit ${r.status}`);
      } catch (e: any) {
        logger.error(`systemd-run 실행 실패 — 교체 취소, 에이전트 유지: ${e?.message || e}`);
        return;
      }
      logger.info('업데이트(systemd-run transient 서비스) 실행 — Agent 종료 후 교체됩니다');
      await new Promise(resolve => setTimeout(resolve, 1000));
      process.exit(0);
    }

    // systemd-run 부재 또는 콘솔 모드: detached 실행
    logger.info('업데이트 스크립트 실행(detached) — Agent 재시작 예정');
    const child = spawn('/bin/bash', [shPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  }

  // ─── 유틸: 명령 존재 확인 ─────────────────────────────
  private hasCommand(cmd: string): boolean {
    try {
      execSync(isWindows ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // ─── 유틸 ─────────────────────────────────────────────

  private cleanup(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e: any) {
      logger.warn(`임시 파일 삭제 실패: ${e.message}`);
    }
  }
}
