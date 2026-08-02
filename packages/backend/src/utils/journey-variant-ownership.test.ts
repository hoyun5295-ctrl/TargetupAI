/**
 * A/B 변이 — 소유 검증 (2026-08-02, Harold 승인)
 *
 * 무엇을 막는가
 *   라우트는 URL의 journeyId만 회사로 검증했고 stepId가 그 여정 소속인지는 보지 않았다.
 *   자기 회사 여정 id + **다른 회사 stepId** 조합이면 남의 변이를 만들거나 덮어쓸 수 있었다.
 *   판정을 CT 안 트랜잭션으로 옮겼으므로, 라우트가 무엇을 검사했든 이 문을 지나야 써진다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { pool } from '../config/database';
import { createJourneyStepVariant } from './bandit-optimizer';

const connect = (pool as any).connect as ReturnType<typeof vi.fn>;

const COMPANY = '11111111-1111-1111-1111-111111111111';
const JOURNEY = '22222222-2222-2222-2222-222222222222';
const STEP = '33333333-3333-3333-3333-333333333333';

type Rule = { match: RegExp; rows?: any[] };
function mockClient(rules: Rule[]) {
  const texts: string[] = [];
  const calls: Array<{ text: string; params?: any[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => {
      texts.push(text); calls.push({ text, params });
      const hit = rules.find((r) => r.match.test(text));
      return { rows: hit?.rows ?? [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { texts, calls };
}

const input = {
  companyId: COMPANY, journeyId: JOURNEY, stepId: STEP,
  variantId: 'A', messageTemplate: '본문입니다', trafficWeight: 0.5,
};

beforeEach(() => vi.clearAllMocks());

describe('createJourneyStepVariant — 소유 검증', () => {
  it('그 여정 소속이 아닌 step이면 INSERT가 나가지 않는다', async () => {
    const { texts } = mockClient([
      { match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'draft' }] },
      { match: /SELECT 1 FROM journey_steps WHERE id = \$1::uuid AND journey_id = \$2::uuid/, rows: [] },
    ]);
    await expect(createJourneyStepVariant(input as any)).rejects.toThrow('그 여정의 step이 아닙니다.');
    expect(texts.some((t) => /INSERT INTO journey_step_variants/.test(t))).toBe(false);
    expect(texts.some((t) => t === 'ROLLBACK')).toBe(true);
  });

  it('여정이 그 회사 것이 아니면 잠금 단계에서 멈춘다', async () => {
    const { texts, calls } = mockClient([{ match: /SELECT id, status FROM journeys/, rows: [] }]);
    await expect(createJourneyStepVariant(input as any)).rejects.toThrow('변이를 저장하지 못했습니다.');
    const lock = calls.find((c) => /SELECT id, status FROM journeys/.test(c.text));
    expect(lock?.text).toMatch(/company_id = \$2::uuid/);   // 회사 격리가 잠금 조건에 있다
    expect(texts.some((t) => /INSERT INTO journey_step_variants/.test(t))).toBe(false);
  });

  it('소유가 맞고 비활성이면 저장된다', async () => {
    const { texts } = mockClient([
      { match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'paused' }] },
      { match: /SELECT 1 FROM journey_steps WHERE id = \$1::uuid AND journey_id = \$2::uuid/, rows: [{ '?column?': 1 }] },
      { match: /INSERT INTO journey_step_variants/, rows: [{ id: 'new-variant' }] },
    ]);
    await expect(createJourneyStepVariant(input as any)).resolves.toBe('new-variant');
    expect(texts.some((t) => t === 'COMMIT')).toBe(true);
  });

  it('운영 중 여정이면 소유가 맞아도 거부한다', async () => {
    const { texts } = mockClient([
      { match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'active' }] },
    ]);
    await expect(createJourneyStepVariant(input as any)).rejects.toThrow('운영 중인 여정');
    expect(texts.some((t) => /INSERT INTO journey_step_variants/.test(t))).toBe(false);
  });
});
