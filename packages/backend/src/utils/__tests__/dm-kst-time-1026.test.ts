/**
 * ★ 2026-10-26 Codex 1R(워커 묶음 #3) — DM 발표 · 만료 시각 표시 = 한국 시각(서버 시간대 무관).
 *   오프셋 없는 글 = 한국 시각으로 적힌 값 · 오프셋이 있는 글 · Date = 그 시점 그대로.
 */
import { describe, it, expect } from 'vitest';
import { dmKstDateTime } from '../dm/dm-section-renderer';

const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

describe('dmKstDateTime', () => {
  it('오프셋 없는 글 = 한국 시각 그대로(10시는 10시)', () => {
    expect(dmKstDateTime('2026-10-26T10:00')).toBe(kst('2026-10-26T10:00:00+09:00'));
    expect(dmKstDateTime('2026-10-26 23:30:15')).toBe(kst('2026-10-26T23:30:15+09:00'));
    expect(dmKstDateTime('2026-10-26')).toBe(kst('2026-10-26T00:00:00+09:00'));
  });
  it('오프셋 있는 글 · Date = 그 시점 그대로', () => {
    expect(dmKstDateTime('2026-10-26T01:00:00Z')).toBe(kst('2026-10-26T10:00:00+09:00'));
    expect(dmKstDateTime(new Date('2026-10-26T01:00:00Z'))).toBe(kst('2026-10-26T10:00:00+09:00'));
  });
  it('읽을 수 없는 글 = 그대로', () => {
    expect(dmKstDateTime('곧 발표')).toBe('곧 발표');
  });
});
