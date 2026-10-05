/**
 * ★1005 Codex 1R high — 규격 이전에 등록된 위반 번호는 등록 번호로 치지 않는다(개별 회신번호 · 단건 판정이 같은 집합을 쓴다).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [{ phone: '15881234' }, { phone: '158812345' }, { phone: '024038517' }, { phone: '112' }] })),
}));

import { getRegisteredCallbackSet, isCallbackRegistered } from '../callback-filter';

describe('등록 번호 집합 = 규격에 맞는 번호만', () => {
  it('9자리 대표번호 · 특수번호는 등록돼 있어도 빠진다', async () => {
    const set = await getRegisteredCallbackSet('c1');
    expect([...set].sort()).toEqual(['024038517', '15881234']);
  });

  it('단건 판정도 같은 집합을 본다', async () => {
    expect(await isCallbackRegistered('c1', '1588-1234')).toBe(true);
    expect(await isCallbackRegistered('c1', '1588-12345')).toBe(false);
  });
});
