import { describe, it, expect } from 'vitest';
import { resolveSetupMode, isInternetExplorer } from './setup-mode';

describe('isInternetExplorer — 웹 마법사 2차 안전망', () => {
  it('IE11은 UA에 MSIE가 없고 Trident를 쓴다', () => {
    expect(isInternetExplorer('Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko')).toBe(true);
  });
  it('구형 IE(MSIE 토큰)도 감지', () => {
    expect(isInternetExplorer('Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)')).toBe(true);
  });
  it('Edge·Chrome은 아니다', () => {
    expect(isInternetExplorer('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120')).toBe(false);
    expect(isInternetExplorer('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36')).toBe(false);
  });
  it('UA 없음은 아니다', () => {
    expect(isInternetExplorer(undefined)).toBe(false);
    expect(isInternetExplorer('')).toBe(false);
  });
});

describe('resolveSetupMode — old Windows는 CLI, modern Windows는 web', () => {
  it('Server 2008 R2 (win32 6.1) -> cli (IE8 웹 마법사 미동작)', () => {
    expect(resolveSetupMode('win32', '6.1.7601')).toBe('cli');
  });
  it('Windows 7 / 2008 R2 RTM (win32 6.1.7600) -> cli', () => {
    expect(resolveSetupMode('win32', '6.1.7600')).toBe('cli');
  });
  it('Windows 8.1 / Server 2012 R2 (win32 6.3) -> cli', () => {
    expect(resolveSetupMode('win32', '6.3.9600')).toBe('cli');
  });
  it('Windows 10/11 클라이언트 (win32 10.0) -> web', () => {
    expect(resolveSetupMode('win32', '10.0.26200')).toBe('web');
    expect(resolveSetupMode('win32', '10.0.26200', 'Windows 11 Pro')).toBe('web');
  });

  // ★ 2026-07-27 Server 2016 VM 실측 — 커널은 Windows 10 1607과 같은 10.0.14393인데
  //   기본 브라우저가 IE11이라 웹 마법사 버튼이 전부 죽었다. 제품명으로 갈라야 한다.
  it('Windows Server는 커널 major가 10이어도 cli (기본 브라우저 IE11)', () => {
    expect(resolveSetupMode('win32', '10.0.14393', 'Windows Server 2016 Datacenter Evaluation')).toBe('cli');
    expect(resolveSetupMode('win32', '10.0.17763', 'Windows Server 2019 Standard')).toBe('cli');
    expect(resolveSetupMode('win32', '10.0.20348', 'Windows Server 2022 Datacenter')).toBe('cli');
  });

  it('같은 커널이라도 클라이언트 제품명이면 web (Server 2016 vs Win10 1607 구분)', () => {
    expect(resolveSetupMode('win32', '10.0.14393', 'Windows 10 Enterprise')).toBe('web');
  });

  it('제품명 판별 불가(node12 등 os.version 없음)면 기존 커널 규칙으로', () => {
    expect(resolveSetupMode('win32', '10.0.14393', undefined)).toBe('web');
    expect(resolveSetupMode('win32', '6.1.7601', undefined)).toBe('cli');
  });
  it('release 불명(win32 빈 문자열) -> cli (안전: 웹 깨짐 회피)', () => {
    expect(resolveSetupMode('win32', '')).toBe('cli');
  });
  it('linux -> cli', () => {
    expect(resolveSetupMode('linux', '5.4.0')).toBe('cli');
  });
});
