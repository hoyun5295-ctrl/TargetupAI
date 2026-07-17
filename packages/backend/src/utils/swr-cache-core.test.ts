import { describe, it, expect } from 'vitest';
import { classifySwrEntry, buildSwrEnvelope } from './swr-cache-core';

const NOW = 1_800_000_000_000; // 고정 기준 시각

describe('classifySwrEntry — SWR 판정 순수 코어', () => {
  it('miss: null/undefined/빈 문자열', () => {
    expect(classifySwrEntry(null, 60, NOW).state).toBe('miss');
    expect(classifySwrEntry(undefined, 60, NOW).state).toBe('miss');
    expect(classifySwrEntry('', 60, NOW).state).toBe('miss');
  });

  it('miss: JSON 파싱 불가', () => {
    expect(classifySwrEntry('not-json{', 60, NOW).state).toBe('miss');
  });

  it('fresh: soft TTL 안(경계 포함)', () => {
    const raw = buildSwrEnvelope({ a: 1 }, NOW - 59_000);
    const r = classifySwrEntry<{ a: number }>(raw, 60, NOW);
    expect(r.state).toBe('fresh');
    expect(r.value).toEqual({ a: 1 });

    // 정확히 soft 경계 = fresh (<=)
    const atBoundary = buildSwrEnvelope({ a: 2 }, NOW - 60_000);
    expect(classifySwrEntry(atBoundary, 60, NOW).state).toBe('fresh');
  });

  it('stale: soft 초과 — 값과 함께 반환(즉시 반환 + 백그라운드 갱신용)', () => {
    const raw = buildSwrEnvelope({ fields: [1, 2] }, NOW - 61_000);
    const r = classifySwrEntry<{ fields: number[] }>(raw, 60, NOW);
    expect(r.state).toBe('stale');
    expect(r.value).toEqual({ fields: [1, 2] });
  });

  it('legacy: 엔벨로프 없는 구형식 직저장(배포 전 60초 TTL 잔존분) = 값 그대로', () => {
    const r = classifySwrEntry<{ stats: { total: number } }>(
      JSON.stringify({ stats: { total: 5 } }),
      60,
      NOW,
    );
    expect(r.state).toBe('legacy');
    expect(r.value).toEqual({ stats: { total: 5 } });
  });

  it('legacy 방어: __swr는 있으나 at이 숫자가 아니면 구형식 취급(엔벨로프 오인 금지)', () => {
    const r = classifySwrEntry(JSON.stringify({ __swr: 1, at: 'bad', v: 1 }), 60, NOW);
    expect(r.state).toBe('legacy');
  });

  it('왕복: buildSwrEnvelope → classifySwrEntry 값 보존', () => {
    const payload = { fields: [{ k: 'grade' }], options: { grade: ['VIP'] }, sample: { name: '홍' } };
    const r = classifySwrEntry<typeof payload>(buildSwrEnvelope(payload, NOW), 60, NOW);
    expect(r.state).toBe('fresh');
    expect(r.value).toEqual(payload);
  });
});
