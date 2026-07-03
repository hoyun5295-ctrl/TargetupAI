// 설치 마법사 모드 판정 (순수 함수 — 테스트 단위)
// old Windows(2008 R2/Win7/8/8.1/2012/2012 R2 = major 6, 기본 브라우저 IE8~11)는 웹 마법사가 안 뜨므로 CLI로 라우팅.
// modern Windows(10/11/2016+ = major>=10)만 웹 마법사. 그 외 OS/판별 불가는 CLI(어디서나 동작).

/**
 * platform(process.platform) + release(os.release())로 설치 마법사 모드 결정.
 * @returns 'web' = 브라우저 마법사(startSetupWizard) / 'cli' = 터미널 마법사(startSetupCli)
 */
export function resolveSetupMode(platform: string, release: string): 'web' | 'cli' {
  if (platform !== 'win32') return 'cli';
  const m = /^(\d+)\./.exec(release || '');
  const major = m ? parseInt(m[1], 10) : 0;
  return major >= 10 ? 'web' : 'cli';
}
