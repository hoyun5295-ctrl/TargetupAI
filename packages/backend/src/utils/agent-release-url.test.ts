import { describe, it, expect } from 'vitest';
import {
  buildReleaseDownloadUrl,
  isPackageKeyVerified,
  resolveAgentBuild,
  VERIFIED_COMBOS,
  CURRENT_AGENT_VERSION,
} from './agent-build-tiers';

describe('buildReleaseDownloadUrl — 티어별 무선 서빙', () => {
  it('티어가 있으면 티어를 인코딩한다(티어마다 다른 exe 서빙)', () => {
    expect(buildReleaseDownloadUrl('1.6.0', 'win-legacy')).toBe('/api/sync/download/1.6.0-win-legacy');
    expect(buildReleaseDownloadUrl('1.6.0', 'linux-modern')).toBe('/api/sync/download/1.6.0-linux-modern');
    expect(buildReleaseDownloadUrl('1.6.0', 'win-modern')).toBe('/api/sync/download/1.6.0-win-modern');
  });
  it('티어가 없으면(전역) 버전만', () => {
    expect(buildReleaseDownloadUrl('1.6.0', null)).toBe('/api/sync/download/1.6.0');
    expect(buildReleaseDownloadUrl('1.6.0', undefined)).toBe('/api/sync/download/1.6.0');
    expect(buildReleaseDownloadUrl('1.6.0', '')).toBe('/api/sync/download/1.6.0');
  });
});

describe('다운로드 게이트 — 검증된 조합만 내보낸다 (2026-08-03)', () => {
  it('등재는 현 버전 세대 형식(조합__버전)만 유효하다', () => {
    for (const key of VERIFIED_COMBOS) {
      expect(key.endsWith(`__${CURRENT_AGENT_VERSION}`)).toBe(true);
    }
  });

  it('smoke PASS 등재 조합만 verified — 옛 세대 검증은 승계되지 않는다', () => {
    expect(resolveAgentBuild('windows', 'win-modern', 'mysql').state).toBe('verified');
    // 1.5.x 세대에서 통과했던 조합 — 현 세대 미등재라 candidate
    expect(resolveAgentBuild('windows', 'win-2008r2', 'oracle-10g').state).toBe('candidate');
  });

  it('packageKey 게이트 — 등재 조합이 매핑된 zip만 열린다(fail-closed)', () => {
    expect(isPackageKeyVerified('win-modern-mysql')).toBe(true);
    expect(isPackageKeyVerified('win-modern-oracle')).toBe(false);
    expect(isPackageKeyVerified('win-legacy-oracle')).toBe(false);
    expect(isPackageKeyVerified('linux-modern-mysql')).toBe(false);
    expect(isPackageKeyVerified('없는-키')).toBe(false);
  });
});
