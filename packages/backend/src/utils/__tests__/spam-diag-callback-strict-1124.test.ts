/**
 * 발신번호 등록 집합 CT 의 strict 인자 (★2026-11-24 확인 판 권한 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2 5)
 *
 * 지금 getRegisteredCallbackSet 은 배정 칸 확인 쿼리가 실패하면 예외를 삼키고 배정 조건 없는 회사 전체 목록을 쓴다(하위호환).
 * 확인 판 권한은 그 강등을 쓰면 안 된다 → strict 이면 그 실패를 던진다. 기본값(인자 없음)은 지금 동작 그대로.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../config/database', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { getRegisteredCallbackSet } from '../callback-filter';

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT assignment_scope FROM callback_numbers LIMIT 0/.test(sql)) throw new Error('relation lost');
    return { rows: [{ phone: '0212345678' }] };
  });
});

describe('getRegisteredCallbackSet strict', () => {
  it('기본값 = 배정 칸 확인 실패 시 회사 전체 목록으로(지금 동작 그대로)', async () => {
    const set = await getRegisteredCallbackSet('c1', 'u1');
    expect(set.has('0212345678')).toBe(true);
  });

  it('strict = 배정 칸 확인 실패를 던진다(회사 전체 목록으로 내려가지 않는다)', async () => {
    await expect(getRegisteredCallbackSet('c1', 'u1', { strict: true })).rejects.toThrow();
  });
});
