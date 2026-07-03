import { describe, it, expect } from 'vitest';
import { resolveSetupMode } from './setup-mode';

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
  it('Windows 10/11 · Server 2016+ (win32 10.0) -> web', () => {
    expect(resolveSetupMode('win32', '10.0.26200')).toBe('web');
  });
  it('release 불명(win32 빈 문자열) -> cli (안전: 웹 깨짐 회피)', () => {
    expect(resolveSetupMode('win32', '')).toBe('cli');
  });
  it('linux -> cli', () => {
    expect(resolveSetupMode('linux', '5.4.0')).toBe('cli');
  });
});
