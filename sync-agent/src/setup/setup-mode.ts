// 설치 마법사 모드 판정 (순수 함수 — 테스트 단위)
// old Windows(2008 R2/Win7/8/8.1/2012/2012 R2 = major 6, 기본 브라우저 IE8~11)는 웹 마법사가 안 뜨므로 CLI로 라우팅.
// ★ 2026-07-27 VM 실측: Windows **Server**는 커널 major가 10이어도 기본 브라우저가 IE11이고 Edge가 없다.
//   Server 2016 커널(10.0.14393)은 Windows 10 1607과 **완전히 같아** 버전만으로는 구분할 수 없다.
//   그래서 제품명(os.version())에 'Server'가 있으면 CLI로 보낸다.
//   근거 = Server 2016 VM에서 웹 마법사 화면은 정상 렌더링됐으나 IE11이 스크립트를 파싱하지 못해
//   (화살표 함수·템플릿 문자열·async/await·fetch) 버튼이 전부 죽었다.

/**
 * platform(process.platform) + release(os.release()) + 제품명(os.version())으로 설치 마법사 모드 결정.
 * @param osVersion os.version() 결과. 예 'Windows Server 2016 Datacenter' / 'Windows 11 Pro'.
 *                  판별 불가(구형 node에서 undefined)면 기존 커널 버전 규칙으로 떨어진다.
 * @returns 'web' = 브라우저 마법사(startSetupWizard) / 'cli' = 터미널 마법사(startSetupCli)
 */
export function resolveSetupMode(platform: string, release: string, osVersion?: string): 'web' | 'cli' {
  if (platform !== 'win32') return 'cli';
  if (/\bserver\b/i.test(osVersion || '')) return 'cli';
  const m = /^(\d+)\./.exec(release || '');
  const major = m ? parseInt(m[1], 10) : 0;
  return major >= 10 ? 'web' : 'cli';
}

/**
 * 요청 User-Agent가 Internet Explorer인지. 웹 마법사가 뜬 뒤의 2차 안전망 —
 * Windows 클라이언트에서 굳이 IE로 여는 경우, 스크립트가 죽어 "버튼이 안 눌리는" 상태로 방치되지 않게
 * 스크립트 없는 안내 화면으로 돌린다. IE11은 UA에 MSIE 대신 Trident를 쓴다.
 */
export function isInternetExplorer(userAgent: string | undefined | null): boolean {
  const ua = String(userAgent || '');
  return /Trident\//i.test(ua) || /\bMSIE\s/i.test(ua);
}
