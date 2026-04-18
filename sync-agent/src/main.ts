/**
 * Sync Agent 진입점 (라우터)
 *
 * 실행 모드:
 *   --setup              → 설치 마법사 (OS 자동 감지: Windows=웹, Linux=CLI)
 *   --setup-web          → 설치 마법사 강제 웹 UI (브라우저)
 *   --setup-cli          → 설치 마법사 강제 CLI (터미널)
 *   --edit-config        → 설정 편집 (대화형 CLI)
 *   --show-config        → 현재 설정 조회 (민감정보 마스킹)
 *   --install-service    → 서비스 설치 (Windows sc.exe / Linux systemd)
 *   --uninstall-service  → 서비스 제거
 *   --service-status     → 서비스 상태 확인
 *   설정 파일 없음        → 설치 마법사 자동 실행
 *   설정 파일 있음        → Agent 실행
 *
 * 변경사항 (2026-02-14):
 *   - CLI 설치 마법사 추가 (리눅스 헤드리스 대응)
 *   - --setup 시 OS 자동 감지: Windows → 웹 UI, Linux → CLI
 *   - --setup-web / --setup-cli 로 명시적 선택 가능
 *
 * 변경사항 (2026-02-25):
 *   - --edit-config: 설정 편집 CLI 추가 (BUG-010 대응)
 *   - --show-config: 현재 설정 조회 (민감정보 마스킹)
 */

import dotenv from 'dotenv';
dotenv.config();

const args = process.argv;

// ─── 서비스 관리 명령 ───────────────────────────────────

if (args.includes('--install-service')) {
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
  console.log('🔧 설치 마법사 (웹 UI) 모드로 실행합니다...');
  import('./setup/server').then(({ startSetupWizard }) => {
    startSetupWizard({ autoLaunchAgent: true });
  });
} else if (args.includes('--setup-cli')) {
  console.log('🔧 설치 마법사 (CLI) 모드로 실행합니다...');
  import('./setup/cli').then(({ startSetupCli }) => {
    startSetupCli({ autoLaunchAgent: true });
  });
}

// ─── 설치 마법사 (OS 자동 감지) ──────────────────────────

else if (args.includes('--setup')) {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    console.log('🔧 설치 마법사 (웹 UI) 모드로 실행합니다...');
    import('./setup/server').then(({ startSetupWizard }) => {
      startSetupWizard({ autoLaunchAgent: true });
    });
  } else {
    console.log('🔧 설치 마법사 (CLI) 모드로 실행합니다...');
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
      // 설정 없음 → OS에 맞는 마법사 자동 실행
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║  ⚠️  설정 파일을 찾을 수 없습니다.                ║');
      console.log('║  설치 마법사를 자동으로 시작합니다...              ║');
      console.log('╚══════════════════════════════════════════════════╝');
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
      console.log(`📋 설정 소스: ${sourceLabel[source] || source}`);
      import('./index');
    }
  });
}
