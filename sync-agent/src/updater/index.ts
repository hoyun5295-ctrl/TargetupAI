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
import { execFile, spawn } from 'node:child_process';
import type { ApiClient } from '../api/client';
import type { VersionResponse } from '../types/api';
import { getLogger } from '../logger';

const logger = getLogger('updater');

const isWindows = process.platform === 'win32';

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

    // 현재 버전과 동일하면 스킵
    if (versionInfo.latestVersion === this.currentVersion) {
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

      // 2. 체크섬 검증 (서버가 checksum 제공한 경우)
      if ((versionInfo as any).checksum) {
        const valid = await this.verifyChecksum(downloadPath, (versionInfo as any).checksum);
        if (!valid) {
          logger.error('체크섬 검증 실패 — 업데이트 취소');
          this.cleanup(downloadPath);
          return false;
        }
        logger.info('체크섬 검증 통과 ✓');
      }

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
    const currentExeName = path.basename(currentExePath);
    const backupExePath = currentExePath + '.old';
    const batPath = path.join(this.tempDir, 'update.bat');

    const isService = process.argv.includes('--service') ||
                      process.env.RUNNING_AS_SERVICE === 'true';

    const stopCmd = isService
      ? 'net stop SyncAgent >nul 2>&1'
      : `taskkill /PID ${process.pid} /F >nul 2>&1`;

    const startCmd = isService
      ? 'net start SyncAgent'
      : `start "" "${currentExePath}"`;

    const batContent = `@echo off
chcp 65001 >nul
echo [Sync Agent Updater] 업데이트 시작: ${this.currentVersion} → ${newVersion}

REM 1. 현재 프로세스 종료
echo 프로세스 종료 대기 중 (PID: ${process.pid})...
${stopCmd}

REM 종료 대기 (최대 30초)
set /a count=0
:waitloop
tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul
if errorlevel 1 goto :continue
timeout /t 1 /nobreak >nul
set /a count+=1
if %count% geq 30 (
  echo [ERROR] 프로세스 종료 타임아웃 — 업데이트 취소
  exit /b 1
)
goto :waitloop

:continue
echo 프로세스 종료 확인

REM 2. 현재 exe 백업
if exist "${backupExePath}" del /f "${backupExePath}"
echo 백업: ${currentExeName} → ${currentExeName}.old
rename "${currentExePath}" "${currentExeName}.old"

REM 3. 새 exe 적용
echo 새 버전 적용 중...
copy /y "${newBinPath}" "${currentExePath}" >nul
if errorlevel 1 (
  echo [ERROR] 복사 실패 — 롤백 진행
  rename "${backupExePath}" "${currentExeName}"
  exit /b 1
)
echo 새 버전 적용 완료

REM 4. Agent 재시작
echo Agent 재시작 중...
${startCmd}

REM 5. 정리 (5초 후)
timeout /t 5 /nobreak >nul
if exist "${backupExePath}" del /f "${backupExePath}"
if exist "${newBinPath}" del /f "${newBinPath}"

echo [Sync Agent Updater] 업데이트 완료: v${newVersion}
REM bat 자기 삭제
(goto) 2>nul & del "%~f0"
`;

    fs.writeFileSync(batPath, batContent, { encoding: 'utf8' });
    logger.info(`업데이트 스크립트 생성: ${batPath}`);

    logger.info('업데이트 스크립트 실행 — Agent가 곧 재시작됩니다...');
    const child = execFile('cmd.exe', ['/c', batPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    } as any);
    child.unref();

    logger.info(`Agent 종료 — v${newVersion}으로 재시작 예정`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
  }

  // ─── Linux: sh 스크립트로 교체 ────────────────────────

  private async applyUpdateLinux(newBinPath: string, newVersion: string): Promise<void> {
    const currentBinPath = process.execPath;
    const currentBinName = path.basename(currentBinPath);
    const backupBinPath = currentBinPath + '.old';
    const shPath = path.join(this.tempDir, 'update.sh');

    // systemd 서비스로 실행 중인지 확인
    const isService = process.env.RUNNING_AS_SERVICE === 'true' ||
                      process.env.INVOCATION_ID !== undefined; // systemd가 설정하는 환경변수

    const serviceName = 'sync-agent';

    const stopCmd = isService
      ? `systemctl stop ${serviceName} 2>/dev/null || true`
      : `kill ${process.pid} 2>/dev/null || true`;

    const startCmd = isService
      ? `systemctl start ${serviceName}`
      : `nohup "${currentBinPath}" > /dev/null 2>&1 &`;

    const shContent = `#!/bin/bash
echo "[Sync Agent Updater] 업데이트 시작: ${this.currentVersion} → ${newVersion}"

# 1. 현재 프로세스 종료
echo "프로세스 종료 대기 중 (PID: ${process.pid})..."
${stopCmd}

# 종료 대기 (최대 30초)
count=0
while kill -0 ${process.pid} 2>/dev/null; do
  sleep 1
  count=$((count + 1))
  if [ $count -ge 30 ]; then
    echo "[ERROR] 프로세스 종료 타임아웃 — 업데이트 취소"
    exit 1
  fi
done
echo "프로세스 종료 확인"

# 2. 현재 바이너리 백업
rm -f "${backupBinPath}"
echo "백업: ${currentBinName} → ${currentBinName}.old"
mv "${currentBinPath}" "${backupBinPath}"

# 3. 새 바이너리 적용
echo "새 버전 적용 중..."
cp "${newBinPath}" "${currentBinPath}"
if [ $? -ne 0 ]; then
  echo "[ERROR] 복사 실패 — 롤백 진행"
  mv "${backupBinPath}" "${currentBinPath}"
  exit 1
fi
chmod 755 "${currentBinPath}"
echo "새 버전 적용 완료"

# 4. Agent 재시작
echo "Agent 재시작 중..."
${startCmd}

# 5. 정리 (5초 후)
sleep 5
rm -f "${backupBinPath}"
rm -f "${newBinPath}"

echo "[Sync Agent Updater] 업데이트 완료: v${newVersion}"

# sh 자기 삭제
rm -f "$0"
`;

    fs.writeFileSync(shPath, shContent, { encoding: 'utf8', mode: 0o755 });
    logger.info(`업데이트 스크립트 생성: ${shPath}`);

    logger.info('업데이트 스크립트 실행 — Agent가 곧 재시작됩니다...');
    const child = spawn('/bin/bash', [shPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    logger.info(`Agent 종료 — v${newVersion}으로 재시작 예정`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(0);
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
