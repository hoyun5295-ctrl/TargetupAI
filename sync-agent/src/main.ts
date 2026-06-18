/**
 * Sync Agent 진입점 (라우터)
 *
 * 실행 모드:
 *   --setup              → 설치 마법사 (OS 자동 감지: Windows=웹, Linux=CLI)
 *   --setup-web          → 설치 마법사 강제 웹 UI (브라우저)
 *   --setup-cli          → 설치 마법사 강제 CLI (터미널)
 *   --edit-config        → 설정 편집 (대화형 CLI)
 *   --show-config        → 현재 설정 조회 (민감정보 마스킹)
 *   --install-service    → 서비스 설치 (Windows 작업 스케줄러 / Linux systemd)
 *   --uninstall-service  → 서비스 제거
 *   --service-status     → 서비스 상태 확인
 *   --service            → 서비스/작업 모드로 Agent 실행 (작업 스케줄러/ systemd 가 부여)
 *   설정 파일 없음        → 설치 마법사 자동 실행 (단, 서비스 모드면 마법사 대신 종료)
 *   설정 파일 있음        → Agent 실행
 *
 * 변경사항 (2026-02-14): CLI 설치 마법사 추가 / --setup OS 자동 감지
 * 변경사항 (2026-02-25): --edit-config / --show-config 추가
 * 변경사항 (2026-06-18): 콘솔 출력 ASCII화(2008 R2 cp949 mojibake 차단) +
 *   서비스 모드(--service / RUNNING_AS_SERVICE)에서 설정 없으면 마법사 대신 즉시 종료.
 */

import dotenv from 'dotenv';
dotenv.config();

const args = process.argv;

// ─── 버전 출력 (★ 2026-06-11) ───────────────────────────
// 설정 파일 없이도 실행 파일 자신의 버전을 즉시 확인 — 전달/교체 검증용.
// (인비토 실측: 전달 라벨 1.5.4 ↔ 실행 v1.5.1 불일치를 현장에서 판별할 수단이 없었음)

if (args.includes('--version') || args.includes('-v')) {
  import('./version').then(({ AGENT_VERSION }) => {
    console.log(`sync-agent v${AGENT_VERSION}`);
    process.exit(0);
  });
}

// ─── 서비스 관리 명령 ───────────────────────────────────

else if (args.includes('--install-service')) {
  import('./service').then(({ installService }) => {
    installService();
  });
} else if (args.includes('--uninstall-service')) {
  import('./service').then(({ uninstallService }) => {
    uninstallService();
  });
} else if (args.includes('--service-status')) {
  import('./service').then(({ serviceStatus }) => {
    serviceStatus();
  });
}

// ─── 설정 편집 / 조회 ──────────────────────────────────

else if (args.includes('--edit-config')) {
  import('./setup/edit-config').then(({ startEditConfig }) => {
    startEditConfig({ showOnly: false });
  });
} else if (args.includes('--show-config')) {
  import('./setup/edit-config').then(({ startEditConfig }) => {
    startEditConfig({ showOnly: true });
  });
}

// ─── 설치 마법사 (명시적 선택) ──────────────────────────

else if (args.includes('--setup-web')) {
  console.log('[SETUP] 설치 마법사 (웹 UI) 모드로 실행합니다...');
  import('./setup/server').then(({ startSetupWizard }) => {
    startSetupWizard({ autoLaunchAgent: true });
  });
} else if (args.includes('--setup-cli')) {
  console.log('[SETUP] 설치 마법사 (CLI) 모드로 실행합니다...');
  import('./setup/cli').then(({ startSetupCli }) => {
    startSetupCli({ autoLaunchAgent: true });
  });
}

// ─── 설치 마법사 (OS 자동 감지) ──────────────────────────

else if (args.includes('--setup')) {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    console.log('[SETUP] 설치 마법사 (웹 UI) 모드로 실행합니다...');
    import('./setup/server').then(({ startSetupWizard }) => {
      startSetupWizard({ autoLaunchAgent: true });
    });
  } else {
    console.log('[SETUP] 설치 마법사 (CLI) 모드로 실행합니다...');
    import('./setup/cli').then(({ startSetupCli }) => {
      startSetupCli({ autoLaunchAgent: true });
    });
  }
}

// ─── Agent 실행 ─────────────────────────────────────────

else {
  import('./config').then(({ hasConfigFile }) => {
    const { exists, source } = hasConfigFile();

    if (!exists) {
      // ★ 서비스/작업 모드(--service 또는 RUNNING_AS_SERVICE)에서 설정이 없으면
      //   설치 마법사(웹 서버)를 띄우지 않고 즉시 정상 종료한다.
      //   (작업 스케줄러/ systemd 가 마법사를 무한히 띄우는 것을 차단 — 운영자가 --setup 으로 설정)
      const isServiceMode =
        args.includes('--service') || process.env.RUNNING_AS_SERVICE === 'true';
      if (isServiceMode) {
        console.log('[INFO] 설정 파일이 없습니다. 설정 후 자동 시작됩니다: sync-agent.exe --setup');
        process.exit(0);
      }

      // 설정 없음 → OS에 맞는 마법사 자동 실행
      console.log('');
      console.log('==================================================');
      console.log('  [!] 설정 파일을 찾을 수 없습니다.');
      console.log('  설치 마법사를 자동으로 시작합니다...');
      console.log('==================================================');
      console.log('');

      const isWindows = process.platform === 'win32';

      if (isWindows) {
        import('./setup/server').then(({ startSetupWizard }) => {
          startSetupWizard({ autoLaunchAgent: true });
        });
      } else {
        import('./setup/cli').then(({ startSetupCli }) => {
          startSetupCli({ autoLaunchAgent: true });
        });
      }
    } else {
      // 설정 있음 → Agent 실행
      const sourceLabel: Record<string, string> = {
        env: '환경변수 (.env)',
        encrypted: '암호화 설정 (config.enc)',
        json: '설정 파일 (config.json)',
      };
      console.log(`[설정 소스] ${sourceLabel[source] || source}`);
      import('./index');
    }
  });
}
