/**
 * ★ 2026-10-20 010 가운데 자리 0 = 세칙 위반(utils/callback-spec.ts) — 자동마케팅 회신번호 검사(checkOperatorCallback)
 *
 * 못 박는 것:
 *   1. 시연 회사의 시드 회신번호(010-0999-9999 · 도달 불가 대역)는 화면에서 골라도 막히지 않는다(발송 경로의 `chosenCb && !demo` 와 같은 판정).
 *   2. 시연이 아닌 회사는 같은 번호가 등록돼 있어도 규격 위반이라 막힌다.
 */
import { describe, it, expect, vi } from 'vitest';

const DEMO_ID = '11111111-1111-4111-8111-111111111111';
const REAL_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('../../config/database', () => ({
  pool: { connect: vi.fn() },
  query: vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('information_schema.columns')) return { rows: [{ n: 2 }] };
    if (sql.includes('FROM users')) return { rows: [{ user_type: 'admin' }] };
    if (sql.includes('is_demo FROM companies')) return { rows: [{ is_demo: params[0] === DEMO_ID }] };
    if (sql.includes('FROM sender_numbers')) return { rows: [{ phone: '010-0999-9999' }] };
    return { rows: [] };
  }),
}));

import { checkOperatorCallback, OperatorCallbackError } from '../continuous-operator';

describe('checkOperatorCallback — 010-0 회신번호', () => {
  it('시연 회사 = 시드 회신번호를 골라도 통과', async () => {
    await expect(checkOperatorCallback(DEMO_ID, null, { callbackNumber: '010-0999-9999' }))
      .resolves.toEqual({ callbackNumber: '01009999999', useIndividualCallback: false });
  });

  it('시연이 아닌 회사 = 등록돼 있어도 규격 위반이라 거부', async () => {
    await expect(checkOperatorCallback(REAL_ID, null, { callbackNumber: '010-0999-9999' }))
      .rejects.toBeInstanceOf(OperatorCallbackError);
  });
});
