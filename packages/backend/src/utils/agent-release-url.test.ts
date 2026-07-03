import { describe, it, expect } from 'vitest';
import { buildReleaseDownloadUrl } from './agent-build-tiers';

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
