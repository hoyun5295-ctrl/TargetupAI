/**
 * AI 존 기능 보존 불변식 (2026-09-30 AI 존 대개편 · docs/2026-09-30-ai-zone-redesign-design.md §6-1)
 *
 * 개편은 틀·색만 바꾸고 기능은 그대로 둔다. 그 약속을 기계가 지키게 **개편 직전 소스에서 뽑은 기준표**와 대조한다.
 *   - 서버 경로: AI 존 전체에서 경로별 등장 횟수가 기준 이상(호출처 하나가 사라지면 그 기능이 사라진 것)
 *   - 이동 목적지: 기준 집합이 전부 남아 있다(입구가 사라지지 않는다)
 * 기준표를 다시 뜨는 것은 **기능을 일부러 바꿀 때만**이다: `ZONE_BASELINE_WRITE=1 npx vitest run zone-api-preserve`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractZoneCalls, zoneFiles } from './zone-scope';

const BASELINE = resolve(__dirname, 'fixtures/zone-api-baseline.json');

describe('AI 존 기능 보존(서버 경로·이동 목적지)', () => {
  const now = extractZoneCalls();

  if (process.env.ZONE_BASELINE_WRITE === '1') {
    it('기준표 기록', () => {
      writeFileSync(BASELINE, JSON.stringify({ files: zoneFiles().length, ...now }, null, 1) + '\n');
      expect(existsSync(BASELINE)).toBe(true);
    });
    return;
  }

  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as { api: Record<string, number>; nav: string[] };

  it('서버 경로는 기준표의 경로별 횟수 이상 남아 있다', () => {
    const lost = Object.entries(base.api)
      .filter(([p, n]) => (now.api[p] || 0) < n)
      .map(([p, n]) => `${p} 기준 ${n} → 지금 ${now.api[p] || 0}`);
    expect(lost).toEqual([]);
  });

  it('이동 목적지는 기준표 전부가 남아 있다', () => {
    const lost = base.nav.filter((p) => !now.nav.includes(p));
    expect(lost).toEqual([]);
  });
});
