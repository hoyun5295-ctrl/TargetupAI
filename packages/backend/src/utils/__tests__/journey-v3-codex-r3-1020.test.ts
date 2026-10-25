/**
 * 여정 V.3 — Codex 적대 3라운드 정정 고정(2026-10-20)
 *
 * B 3R(같은 부류 세 번째: 1R 칸 수 대조 → 2R 내용 지문 → 3R 지문 불일치 재전송 · 확인 때 뒤 편집 유실)
 *   왜 되풀이됐나 = 멱등이 아닌 넣기 요청의 성공 여부를 화면이 서버 상태로 **추측**했다. 추측 장치를 바꿀 때마다 다른 틈이 났다.
 *   구조 = 화면이 칸 id 를 미리 만들어 보낸다(clientStepId) · 서버는 여정 행 잠금 뒤 같은 id 가 있으면 만들지 않고 그 칸을 돌려준다.
 *          결과를 못 받은 칸은 잠근다(뒤 편집 0) · 다시 저장 = 같은 id 로 다시 보낸다 · 다시 읽어 그 id 가 보이면 대기 목록에서 뺀다.
 *   덧댄 장치(칸 목록 다시 읽기 · 지문 · 서버 보정 맞추기)는 함께 지웠다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { pool } from '../../config/database';
import { addJourneyStep } from '../journey-builder';

const connect = (pool as any).connect as ReturnType<typeof vi.fn>;
const FE = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf-8');
const ROUTE = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'ai.ts'), 'utf-8');

const COMPANY = '11111111-1111-1111-1111-111111111111';
const JOURNEY = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Rule = { match: RegExp; rows?: any[] };
function mockClient(rules: Rule[]) {
  const calls: Array<{ text: string; params?: any[] }> = [];
  const client = {
    query: vi.fn(async (text: string, params?: any[]) => {
      calls.push({ text, params });
      const hit = rules.find((r) => r.match.test(text));
      return { rows: hit?.rows ?? [], rowCount: hit?.rows?.length ?? 0 };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return calls;
}
const idx = (calls: Array<{ text: string }>, re: RegExp) => calls.findIndex((c) => re.test(c.text));
const MSG = { stepType: 'message' as const, delayHours: 24, channel: 'sms' };

describe('칸 넣기 멱등(clientStepId)', () => {
  beforeEach(() => connect.mockReset());

  it('같은 여정에 같은 id 가 이미 있으면 만들지 않고 그 칸을 돌려준다 · 켜진 상태여도(이미 들어간 칸을 「못 넣었다」고 답하지 않는다)', async () => {
    const calls = mockClient([
      { match: /SELECT status, start_kind FROM journeys/, rows: [{ status: 'active' }] },
      { match: /SELECT journey_id, step_order FROM journey_steps WHERE id = \$1::uuid/, rows: [{ journey_id: JOURNEY, step_order: 3 }] },
    ]);
    const r = await addJourneyStep(COMPANY, JOURNEY, MSG, { clientStepId: CLIENT_ID });
    expect(r).toEqual({ stepId: CLIENT_ID, stepOrder: 3, existed: true });
    expect(idx(calls, /INSERT INTO journey_steps/)).toBe(-1);
    expect(idx(calls, /last_pretest_passed_at = NULL/)).toBe(-1);
    // 여정 행 잠금 뒤에 본다(같은 요청이 동시에 와도 한 칸)
    expect(idx(calls, /SELECT status, start_kind FROM journeys/)).toBeLessThan(idx(calls, /SELECT journey_id, step_order FROM journey_steps/));
    expect(idx(calls, /^ROLLBACK$/)).toBeGreaterThan(-1);
  });

  it('다른 여정의 칸 id 와 겹치면 409(STEP_ID_CONFLICT) · INSERT 없음', async () => {
    const calls = mockClient([
      { match: /SELECT status, start_kind FROM journeys/, rows: [{ status: 'draft' }] },
      { match: /SELECT journey_id, step_order FROM journey_steps WHERE id = \$1::uuid/, rows: [{ journey_id: '99999999-9999-9999-9999-999999999999', step_order: 1 }] },
    ]);
    await expect(addJourneyStep(COMPANY, JOURNEY, MSG, { clientStepId: CLIENT_ID })).rejects.toMatchObject({ code: 'STEP_ID_CONFLICT' });
    expect(idx(calls, /INSERT INTO journey_steps/)).toBe(-1);
  });

  it('없으면 그 id 로 넣는다($20) · 응답에 existed 없음', async () => {
    const calls = mockClient([
      { match: /SELECT status, start_kind FROM journeys/, rows: [{ status: 'draft' }] },
      { match: /COUNT\(\*\)::int AS n/, rows: [{ n: 2, mx: 2 }] },
      { match: /INSERT INTO journey_steps/, rows: [{ id: CLIENT_ID }] },
    ]);
    const r = await addJourneyStep(COMPANY, JOURNEY, MSG, { clientStepId: CLIENT_ID });
    expect(r).toEqual({ stepId: CLIENT_ID, stepOrder: 3 });
    const ins = calls.find((c) => /INSERT INTO journey_steps/.test(c.text))!;
    expect(ins.text).toContain('COALESCE($20::uuid, gen_random_uuid())');
    expect(ins.params?.[19]).toBe(CLIENT_ID);
  });

  it('id 를 안 주면(빌더 · 새 모양 복제본) 서버가 만든다 · 존재 확인도 안 한다', async () => {
    const calls = mockClient([
      { match: /SELECT status, start_kind FROM journeys/, rows: [{ status: 'draft' }] },
      { match: /COUNT\(\*\)::int AS n/, rows: [{ n: 0, mx: 0 }] },
      { match: /INSERT INTO journey_steps/, rows: [{ id: 'x' }] },
    ]);
    await addJourneyStep(COMPANY, JOURNEY, MSG);
    expect(idx(calls, /SELECT journey_id, step_order FROM journey_steps/)).toBe(-1);
    expect(calls.find((c) => /INSERT INTO journey_steps/.test(c.text))!.params?.[19]).toBeNull();
  });

  it('형식이 아닌 id = 입력 오류 · DB 에 닿지 않는다', async () => {
    await expect(addJourneyStep(COMPANY, JOURNEY, MSG, { clientStepId: 'new:1' })).rejects.toMatchObject({ code: 'JOURNEY_INVALID_INPUT' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('주소가 clientStepId 를 받아 넘기고 existed 를 돌려준다', () => {
    expect(ROUTE).toContain('notMetGoto, waitEventName, waitTimeoutHours, clientStepId,');
    expect(ROUTE).toContain('}, { clientStepId: clientStepId != null ? String(clientStepId) : undefined });');
    expect(ROUTE).toContain('existed: result.existed === true });');
  });
});

describe('화면 — 칸 id 로 다시 보내기 · 결과 모름 칸 잠금', () => {
  const ws = FE('components/journey/workspace/JourneyWorkspace.tsx');
  it('새 칸마다 칸 id 를 만들고 그 id 로 넣는다', () => {
    expect(ws).toContain('setNewSteps((list) => [...list, { tempId, clientId: crypto.randomUUID(), step }]);');
    expect(ws).toContain("'POST', { ...stepDefinition(n.step), clientStepId: n.clientId }).catch(() => null);");
  });
  it('결과를 못 받으면 그 칸을 잠근다(편집 무시 · 편집기 대신 안내) · 다시 저장은 같은 id', () => {
    expect(ws).toContain('setNewSteps((list) => list.map((x) => (x.tempId === n.tempId ? { ...x, sent: true } : x)));');
    expect(ws).toContain('n.tempId === id && !n.sent ? { ...n, step: { ...n.step, ...p } } : n');
    expect(ws).toContain('(selNew ? !selNew.sent : (selRaw?.step_type');
    expect(ws).toContain(') : selNew?.sent ? (');
  });
  it('4R — 결과 모름 = 연결 끊김 · 5xx(게이트웨이 502 · 504) · 확정 실패 = 4xx 뿐 · 잠금을 푸는 코드는 없다', () => {
    expect(ws).toContain('if (!(r && r.status >= 400 && r.status < 500)) {');
    expect(ws).not.toContain('sent: false');
    expect(ws).not.toContain('if (r === null) {');
  });
  it('다시 읽어 그 칸 id 가 서버에 있으면 대기 목록에서 빼고 그 칸으로 옮긴다', () => {
    expect(ws).toContain('const landed = newStepsRef.current.filter((n) => ids.has(n.clientId));');
    expect(ws).toContain('if (sel) setSelected(sel.clientId);');
  });
  it('추측 장치는 없다(칸 목록 다시 읽기 · 지문)', () => {
    for (const t of ['stepsNow', 'landedIn', 'sigBody', 'studioSig', 'rawSig', 'beforeIds']) expect(ws).not.toContain(t);
  });
});
