/**
 * 저장 후 스텝 추가·삭제 — 계약 검증 (2026-08-02, 설계서 §13-1)
 *
 * 왜 행동을 직접 단정하는가
 *   순번에 구멍이 나면 여정이 통째로 죽는다. 실행기는 다음 step을 `current_step_order + 1`로 찾고
 *   진입은 `step_order = 1`을 찾는다. 그런데 "재번호를 한다"는 소스에 토큰이 있는지로는 검증되지 않는다 —
 *   한 문장으로 당기면 UNIQUE(journey_id, step_order)가 즉시 검사라 충돌하고, 보정 순서를 뒤집으면
 *   지운 자리를 가리키던 분기 포인터가 살아남는다. 그래서 **무엇이 어떤 순서로 나가는가**를 못 박는다.
 *
 * 고정하는 것:
 *   1. 게이트 3종(마지막 스텝·발송 이력·진행 중 고객)은 삭제보다 먼저 걸리고, 걸리면 DELETE가 아예 안 나간다.
 *   2. 진행 중 판정은 `current_step_order >= 삭제순번 − 1` — 날짜축 단발 실행행(발송 순번 − 1)까지 닫는다.
 *   3. 재번호는 2단계(+오프셋 → −(오프셋+1)).
 *   4. 분기 포인터 보정은 NULL(지운 자리)이 −1(뒤 자리)보다 먼저.
 *   5. 추가는 상한 7을 서버가 강제하고, 순번은 MAX+1이며, 부모 여정 행을 잠근 뒤 계산한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
  pool: { connect: vi.fn() },
}));

import { query, pool } from '../config/database';
import { addJourneyStep, deleteJourneyStep, withJourneyValidationReset, JourneyStepGateError, MAX_JOURNEY_STEPS } from './journey-builder';

const q = query as unknown as ReturnType<typeof vi.fn>;
const connect = (pool as any).connect as ReturnType<typeof vi.fn>;

const COMPANY = '11111111-1111-1111-1111-111111111111';
const JOURNEY = '22222222-2222-2222-2222-222222222222';
const STEP = '33333333-3333-3333-3333-333333333333';

type Rule = { match: RegExp; rows?: any[]; rowCount?: number };

function mockClient(rules: Rule[]) {
  const texts: string[] = [];
  const calls: Array<{ text: string; params?: any[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => {
      texts.push(text);
      calls.push({ text, params });
      const hit = rules.find((r) => r.match.test(text));
      return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows?.length ?? 0 };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { client, texts, calls };
}

/** 순서 단정용 — 처음 일치한 위치. 없으면 -1. */
const at = (texts: string[], re: RegExp) => texts.findIndex((t) => re.test(t));

const JOURNEY_LOCK: Rule = { match: /SELECT id FROM journeys/, rows: [{ id: JOURNEY }] };
const STEP_LOCK = (order: number): Rule => ({ match: /SELECT step_order FROM journey_steps/, rows: [{ step_order: order }] });
const STEP_COUNT = (n: number): Rule => ({ match: /COUNT\(\*\)::int AS n\s+FROM journey_steps/, rows: [{ n }] });
const NO_LOGS: Rule = { match: /FROM journey_step_logs/, rows: [] };
const NO_BUSY: Rule = { match: /FROM journey_executions/, rows: [] };

beforeEach(() => {
  vi.clearAllMocks();
  q.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('deleteJourneyStep — 게이트', () => {
  it('스텝이 하나뿐이면 거부하고 DELETE를 내보내지 않는다', async () => {
    const { texts } = mockClient([JOURNEY_LOCK, STEP_LOCK(1), STEP_COUNT(1)]);
    await expect(deleteJourneyStep(COMPANY, JOURNEY, STEP)).rejects.toMatchObject({ code: 'LAST_STEP' });
    expect(at(texts, /DELETE FROM journey_steps/)).toBe(-1);
    expect(texts.some((t) => t === 'ROLLBACK')).toBe(true);
  });

  it('발송 이력이 있으면 거부한다 — journey_step_logs가 CASCADE라 이력·비용이 함께 사라진다', async () => {
    const { texts } = mockClient([
      JOURNEY_LOCK,
      STEP_LOCK(2),
      STEP_COUNT(3),
      { match: /FROM journey_step_logs/, rows: [{ '?column?': 1 }] },
    ]);
    await expect(deleteJourneyStep(COMPANY, JOURNEY, STEP)).rejects.toBeInstanceOf(JourneyStepGateError);
    expect(at(texts, /DELETE FROM journey_steps/)).toBe(-1);
    expect(at(texts, /DELETE FROM journey_step_snapshots/)).toBe(-1);
  });

  it('진행 중 고객이 있으면 거부한다 — 판정은 삭제순번 − 1 이상', async () => {
    const { texts, calls } = mockClient([
      JOURNEY_LOCK,
      STEP_LOCK(3),
      STEP_COUNT(5),
      NO_LOGS,
      { match: /FROM journey_executions/, rows: [{ '?column?': 1 }] },
    ]);
    await expect(deleteJourneyStep(COMPANY, JOURNEY, STEP)).rejects.toMatchObject({ code: 'IN_PROGRESS' });

    const busy = calls.find((c) => /FROM journey_executions/.test(c.text));
    expect(busy?.text).toMatch(/current_step_order >= \$2/);
    // 날짜축 단발 실행행은 current_step_order = 발송 순번 − 1로 만들어진다 → 직전 자리까지 봐야 닫힌다.
    expect(busy?.params?.[1]).toBe(2);
    expect(at(texts, /DELETE FROM journey_steps/)).toBe(-1);
  });

  it('여정이 그 회사 것이 아니면 null — 삭제도 예외도 없다', async () => {
    const { texts } = mockClient([{ match: /SELECT id FROM journeys/, rows: [] }]);
    await expect(deleteJourneyStep(COMPANY, JOURNEY, STEP)).resolves.toBeNull();
    expect(at(texts, /DELETE FROM journey_steps/)).toBe(-1);
  });
});

describe('deleteJourneyStep — 재번호', () => {
  it('2단계로 옮긴다 — UNIQUE(journey_id, step_order)가 즉시 검사라 한 문장으로 당길 수 없다', async () => {
    const { texts, calls } = mockClient([
      JOURNEY_LOCK,
      STEP_LOCK(2),
      STEP_COUNT(4),
      NO_LOGS,
      NO_BUSY,
      { match: /step_order = step_order - \$2/, rowCount: 2 },
    ]);
    const r = await deleteJourneyStep(COMPANY, JOURNEY, STEP);
    expect(r).toEqual({ deletedOrder: 2, renumbered: 2 });

    const push = at(texts, /step_order = step_order \+ \$2/);
    const pull = at(texts, /step_order = step_order - \$2/);
    const del = at(texts, /DELETE FROM journey_steps/);
    expect(del).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(del);   // 지운 뒤에 옮긴다
    expect(pull).toBeGreaterThan(push);  // 임시 자리 → 최종 자리

    // 1단계는 삭제 순번보다 뒤에 있는 것만, 2단계는 임시 자리에 있는 것만 건드린다.
    const pushCall = calls.find((c) => /step_order = step_order \+ \$2/.test(c.text));
    const pullCall = calls.find((c) => /step_order = step_order - \$2/.test(c.text));
    expect(pushCall?.params?.[2]).toBe(2);
    expect(Number(pullCall?.params?.[1])).toBe(Number(pushCall?.params?.[1]) + 1);
    expect(pullCall?.params?.[2]).toBe(pushCall?.params?.[1]);
  });

  it('분기 포인터는 지운 자리를 먼저 비우고 그다음 뒤 자리를 당긴다', async () => {
    const { texts } = mockClient([JOURNEY_LOCK, STEP_LOCK(2), STEP_COUNT(4), NO_LOGS, NO_BUSY]);
    await deleteJourneyStep(COMPANY, JOURNEY, STEP);

    const toNull = at(texts, /not_met_goto = NULL/);
    const shift = at(texts, /not_met_goto = not_met_goto - 1/);
    expect(toNull).toBeGreaterThan(-1);
    expect(shift).toBeGreaterThan(toNull); // 뒤집으면 지운 자리를 가리키던 값이 살아남는다
  });

  it('FK가 없는 스냅샷은 직접 지운다 — CASCADE가 안 된다', async () => {
    const { texts } = mockClient([JOURNEY_LOCK, STEP_LOCK(2), STEP_COUNT(4), NO_LOGS, NO_BUSY]);
    await deleteJourneyStep(COMPANY, JOURNEY, STEP);
    const snap = at(texts, /DELETE FROM journey_step_snapshots/);
    const del = at(texts, /DELETE FROM journey_steps/);
    expect(snap).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(snap);
    expect(texts.some((t) => t === 'COMMIT')).toBe(true);
  });
});

describe('addJourneyStep', () => {
  it('상한을 서버가 강제한다 — 넘으면 INSERT가 나가지 않는다', async () => {
    const { texts } = mockClient([
      { match: /SELECT status FROM journeys/, rows: [{ status: 'draft' }] },
      { match: /COUNT\(\*\)::int AS n/, rows: [{ n: MAX_JOURNEY_STEPS, mx: MAX_JOURNEY_STEPS }] },
    ]);
    await expect(addJourneyStep(COMPANY, JOURNEY, { stepType: 'message', delayHours: 0, channel: 'sms' })).rejects.toMatchObject({
      code: 'STEP_LIMIT',
    });
    expect(at(texts, /INSERT INTO journey_steps/)).toBe(-1);
  });

  it('맨 뒤(MAX+1)에 붙이고 부모 여정 행을 잠근 뒤 계산한다', async () => {
    const { texts, calls } = mockClient([
      { match: /SELECT status FROM journeys/, rows: [{ status: 'draft' }] },
      { match: /COUNT\(\*\)::int AS n/, rows: [{ n: 3, mx: 3 }] },
      { match: /INSERT INTO journey_steps/, rows: [{ id: STEP }] },
    ]);
    const r = await addJourneyStep(COMPANY, JOURNEY, { stepType: 'message', delayHours: 24, channel: 'sms' });
    expect(r).toEqual({ stepId: STEP, stepOrder: 4 });

    const lock = calls.find((c) => /SELECT status FROM journeys/.test(c.text));
    expect(lock?.text).toMatch(/FOR UPDATE/);
    expect(lock?.text).toMatch(/company_id = \$2::uuid/); // 회사 격리
    expect(at(texts, /SELECT status FROM journeys/)).toBeLessThan(at(texts, /COUNT\(\*\)::int AS n/));

    const ins = calls.find((c) => /INSERT INTO journey_steps/.test(c.text));
    expect(ins?.params?.[1]).toBe(4); // step_order
    // 스텝 구성이 바뀌었으니 다음 활성화가 스팸 사전검사를 다시 받게 마커를 지운다.
    expect(at(texts, /last_pretest_passed_at = NULL/)).toBeGreaterThan(-1);
  });

  it('운영 중(active) 여정에는 추가하지 않는다 — 사전 스팸검사를 건너뛴 문안이 나간다', async () => {
    const { texts } = mockClient([
      { match: /SELECT status FROM journeys/, rows: [{ status: 'active' }] },
      { match: /COUNT\(\*\)::int AS n/, rows: [{ n: 1, mx: 1 }] },
      { match: /INSERT INTO journey_steps/, rows: [{ id: STEP }] },
    ]);
    await expect(addJourneyStep(COMPANY, JOURNEY, { stepType: 'message', delayHours: 1, channel: 'sms' })).rejects.toMatchObject({
      code: 'JOURNEY_ACTIVE',
    });
    expect(at(texts, /INSERT INTO journey_steps/)).toBe(-1);
    expect(texts.some((t) => t === 'ROLLBACK')).toBe(true);
  });

  it.each([
    ['stepType', { stepType: 'unknown' as any, delayHours: 0 }, 'INVALID_STEP_TYPE'],
    ['channel', { stepType: 'message' as any, delayHours: 0, channel: 'fax' as any }, 'INVALID_CHANNEL'],
    // ⛔ email은 타입에는 있지만 사전검사·실행기가 처리하지 못한다 — 열어 두면 스팸검사를 건너뛴다.
    ['email 채널', { stepType: 'message' as any, delayHours: 0, channel: 'email' as any }, 'INVALID_CHANNEL'],
    ['채널 누락', { stepType: 'message' as any, delayHours: 0 }, 'CHANNEL_REQUIRED'],
    ['delayMode', { stepType: 'message' as any, delayHours: 0, channel: 'sms' as any, delayMode: 'someday' as any }, 'INVALID_DELAY_MODE'],
  ])('등록되지 않은 %s 값은 DB에 닿기 전에 거부한다 — 타입 유니온은 요청 본문을 검사하지 않는다', async (_label, step, code) => {
    mockClient([]);
    await expect(addJourneyStep(COMPANY, JOURNEY, step as any)).rejects.toMatchObject({ code });
    expect(connect).not.toHaveBeenCalled();
  });

  it('조건 스텝인데 조건이 없으면 DB에 닿기도 전에 거부한다', async () => {
    mockClient([]);
    await expect(addJourneyStep(COMPANY, JOURNEY, { stepType: 'condition', delayHours: 0, channel: 'sms' })).rejects.toMatchObject({
      code: 'CONDITION_REQUIRED',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('여정이 그 회사 것이 아니면 null', async () => {
    const { texts } = mockClient([{ match: /SELECT status FROM journeys/, rows: [] }]);
    await expect(addJourneyStep(COMPANY, JOURNEY, { stepType: 'message', delayHours: 0, channel: 'sms' })).resolves.toBeNull();
    expect(at(texts, /INSERT INTO journey_steps/)).toBe(-1);
  });
});

/**
 * ★ 2026-08-02 Codex 4R — 검증 무효화 단일 문.
 *   규약을 경로마다 흩어 적었더니 라운드마다 빠진 곳이 나왔고, 문장이 따로 나가는 사이에 활성화가 끼어들 수 있었다.
 *   여기서 못 박는 것: 부모 여정을 **잠근 뒤** 변경과 무효화가 **같은 트랜잭션**에서 커밋된다.
 */
describe('withJourneyValidationReset — 변경과 무효화는 한 트랜잭션', () => {
  it('부모 여정을 FOR UPDATE로 잠그고, 변경 뒤 마커·판을 함께 지운 다음 커밋한다', async () => {
    const { texts } = mockClient([
      { match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'draft' }] },
      { match: /UPDATE journey_steps SET foo/, rows: [{ id: STEP }] },
    ]);
    const r = await withJourneyValidationReset(COMPANY, JOURNEY, (run) =>
      run(`UPDATE journey_steps SET foo = 1 WHERE id = $1::uuid RETURNING id`, [STEP])
    );
    expect(r?.rows?.[0]?.id).toBe(STEP);

    const lock = at(texts, /SELECT id, status FROM journeys/);
    const change = at(texts, /UPDATE journey_steps SET foo/);
    const reset = at(texts, /last_pretest_passed_at = NULL, updated_at = NOW\(\)/);
    const commit = texts.indexOf('COMMIT');
    expect(texts[0]).toBe('BEGIN');
    expect(lock).toBeGreaterThan(-1);
    expect(change).toBeGreaterThan(lock);    // 잠근 뒤에 바꾼다
    expect(reset).toBeGreaterThan(change);   // 바꾼 뒤에 무효화
    expect(commit).toBeGreaterThan(reset);   // 둘이 같은 커밋 안에 있다
  });

  it('마커와 판(updated_at)은 한 문장에서 함께 간다 — 하나만 가면 CAS나 활성화 게이트 중 하나가 새다', async () => {
    const { calls } = mockClient([{ match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'draft' }] }]);
    await withJourneyValidationReset(COMPANY, JOURNEY, async () => null);
    const reset = calls.find((c) => /last_pretest_passed_at/.test(c.text));
    expect(reset?.text).toMatch(/updated_at = NOW\(\)/);
  });

  it('그 회사 여정이 아니면 아무것도 바꾸지 않고 null', async () => {
    const { texts } = mockClient([{ match: /SELECT id, status FROM journeys/, rows: [] }]);
    const spy = vi.fn();
    const r = await withJourneyValidationReset(COMPANY, JOURNEY, async () => { spy(); return 1; });
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(at(texts, /last_pretest_passed_at/)).toBe(-1);
    expect(texts.some((t) => t === 'ROLLBACK')).toBe(true);
  });

  it('변경이 던지면 롤백하고 무효화도 커밋되지 않는다', async () => {
    const { texts } = mockClient([{ match: /SELECT id, status FROM journeys/, rows: [{ id: JOURNEY, status: 'draft' }] }]);
    await expect(
      withJourneyValidationReset(COMPANY, JOURNEY, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    expect(texts.some((t) => t === 'COMMIT')).toBe(false);
    expect(texts.some((t) => t === 'ROLLBACK')).toBe(true);
  });
});
