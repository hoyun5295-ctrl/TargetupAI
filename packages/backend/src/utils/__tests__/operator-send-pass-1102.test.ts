// replaces: none
/**
 * 자동마케팅 발송 패스 줄 풀 = 고르기가 던져도 보내는 중인 줄이 끝난 뒤에 패스가 끝난다(★ 2026-11-02 §16 G5 · Codex 구현 1R #2)
 *
 * 줄 표(inFlight)는 이 패스 안에만 있다 → 패스가 먼저 끝나면 tick 가드가 풀려 다음 패스가 같은 회사를 또 집는다(회사 하나 한 줄이 깨진다).
 * DB 는 흉내(고르기 문장 = 첫 번째는 회차 하나 · 두 번째는 실패 · 그 밖 문장 = 문이 열릴 때까지 기다림 = 보내는 중).
 */
import { describe, it, expect, vi } from 'vitest';

const ctl = vi.hoisted(() => ({ dueCalls: 0, open: null as null | (() => void), gate: null as null | Promise<void> }));
vi.mock('../../config/database', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    query: async (sql: string) => {
      if (String(sql).includes('SELECT DISTINCT ON (company_id) id, company_id')) {
        ctl.dueCalls++;
        if (ctl.dueCalls === 1) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', company_id: '22222222-2222-4222-8222-222222222222' }], rowCount: 1 };
        throw new Error('고르기 조회 실패');
      }
      await ctl.gate;
      return { rows: [], rowCount: 0 };
    },
  };
});

import { runAutoSendPass } from '../continuous-operator';

describe('§16 G5 발송 패스 줄 풀 · 고르기 실패', () => {
  it('두 번째 고르기가 던져도 보내는 중인 회차가 끝날 때까지 패스가 끝나지 않는다 · 끝나면 오류를 그대로 올린다', async () => {
    ctl.gate = new Promise<void>((r) => { ctl.open = r; });
    let settled = false;
    const p = runAutoSendPass();
    p.then(() => undefined, () => undefined).finally(() => { settled = true; });
    for (let i = 0; i < 100 && ctl.dueCalls < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(ctl.dueCalls).toBe(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);   // 옛: 여기서 이미 끝나 tick 가드가 풀렸다
    ctl.open!();
    await expect(p).rejects.toThrow('고르기 조회 실패');
  });
});
