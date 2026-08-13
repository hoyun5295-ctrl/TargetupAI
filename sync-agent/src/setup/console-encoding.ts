/**
 * console-encoding.ts — 설치 마법사 콘솔 인코딩 (★ 2026-08-13 아난티 현장 결함)
 *
 * 무슨 일이 있었나:
 *   설치 배치(INSTALL-run-as-admin.bat)는 첫 줄에서 `chcp 65001`을 하지만, 마법사는 `start`로
 *   **새 콘솔 창**에 띄운다. 새 콘솔은 부모의 코드페이지를 물려받지 않고 시스템 기본(한국어 Windows = CP949)으로 뜬다.
 *   실행 파일은 UTF-8로 출력하므로 그 창에서는 한글이 전부 깨진다 —
 *   고객사는 무엇을 입력해야 하는지 읽을 수 없어 설치가 그 자리에서 멈췄다.
 *
 * 왜 배치만 고치지 않는가:
 *   배치의 그 한 줄을 고쳐도, 사용자가 `sync-agent.exe --setup`을 직접 실행하면 똑같이 깨진다.
 *   창을 어떻게 열든 안 깨지려면 **실행 파일이 스스로 맞춰야 한다.** 그래서 두 곳 다 고친다.
 *
 * chcp는 프로세스가 아니라 **콘솔의 속성**이라, 같은 콘솔에 붙은 자식이 바꾸면 이 프로세스 출력에도 적용된다.
 * 콘솔이 없는 실행(서비스·리다이렉트)에서는 실패하지만 그때는 출력이 종전 그대로라 무해하다.
 */
import { spawnSync } from 'node:child_process';

/** (순수) 이 플랫폼에서 콘솔 코드페이지를 맞춰야 하는가. Windows만 해당한다. */
export function needsConsoleCodepageFix(platform: string): boolean {
  return platform === 'win32';
}

/**
 * Windows 콘솔 출력 코드페이지를 UTF-8(65001)로 맞춘다.
 * 실패는 삼킨다 — 인코딩 보정이 설치 자체를 막으면 안 된다(콘솔 없는 실행에서도 호출된다).
 */
export function ensureUtf8Console(platform: string = process.platform): void {
  if (!needsConsoleCodepageFix(platform)) return;
  try {
    // System32의 실제 실행 파일이라 shell 없이 부른다(셸 경유 시 인자 해석이 환경마다 달라진다).
    // ⛔ windowsHide 금지 — CREATE_NO_WINDOW로 자식이 콘솔 없이 떠서 chcp가 허공에 적용된다
    //    (2026-08-13 실측: 플래그가 있으면 exit 0인데 코드페이지는 949 그대로였다. 부모가 콘솔 앱이라
    //     창 깜빡임도 없다 — 같은 콘솔을 그대로 물려받는다).
    spawnSync('chcp.com', ['65001'], { stdio: 'ignore' });
  } catch {
    /* 콘솔 없음·실행 실패 — 종전 동작 유지 */
  }
}
