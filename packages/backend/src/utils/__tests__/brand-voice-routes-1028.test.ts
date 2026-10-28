/**
 * 브랜드 보이스 주소 동작 (★ 2026-10-28 AI 메모리 설계 · Codex 구현 1R 지적 닫기 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 1. 브랜드 키트 한 칸 고침 = 그 칸만 병합(빠진 칸 = 그대로 · 금지어 · 넣을 말 · 슬로건이 지워지지 않는다).
 * 2. 대표 문안 = 같은 글은 한 행(학습 실패 뒤 같은 고르기로 다시 눌러도 행 · 세대가 늘지 않는다 · 한 건 추가도 같다).
 * 라우트 손잡이를 직접 부르고 DB 는 잠금 트랜잭션 쿼리만 흉내 낸다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  state: { gen: 3, guidelineGen: 3, extract: null, extractError: null, reviewed: null, sample: null } as any,
  texts: new Map<string, string>(),
  log: [] as Array<{ sql: string; params: any[] }>,
}));

vi.mock('../../middlewares/auth', () => ({ authenticate: (_q: any, _r: any, n: any) => n() }));
vi.mock('../plan-guard', async (orig) => ({ ...(await orig() as any), aiZonePlanBlocked: vi.fn(async () => false) }));
vi.mock('../../config/database', () => {
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      db.log.push({ sql, params });
      if (sql.includes("'brand_voice_state'") && sql.includes('FOR UPDATE')) return { rows: [{ memory_value: JSON.stringify(db.state) }] };
      if (sql.includes("memory_value::jsonb->>'message_text' = $2")) return { rows: db.texts.has(params[1]) ? [{ id: db.texts.get(params[1]) }] : [] };
      if (sql.includes('SELECT COUNT(*)::int AS n')) return { rows: [{ n: db.texts.size, p: db.texts.size }] };
      if (sql.includes("'representative_message', $2")) return { rows: [{ id: `new-${db.log.length}` }] };
      if (sql.startsWith('UPDATE ai_company_memory SET memory_value = $2') && sql.includes('brand_voice_state')) { db.state = JSON.parse(params[1]); return { rows: [] }; }
      if (sql.includes("memory_type = 'brand_guideline' AND memory_key = 'main'") && sql.startsWith('UPDATE')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const q = vi.fn(async () => ({ rows: [] }));
  return { default: { query: q, connect: vi.fn(async () => client) }, query: q, pool: { query: q, connect: vi.fn(async () => client) } };
});

import router from '../../routes/ai-memory';

function handler(method: string, path: string) {
  const layer = (router as any).stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
  const hs = layer.route.stack.map((s: any) => s.handle);
  return hs[hs.length - 1];
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}
const USER = { companyId: '00000000-0000-0000-0000-000000000001', userId: 'u1', userType: 'company_user' };
const inserts = () => db.log.filter((l) => l.sql.includes("'representative_message', $2"));

beforeEach(() => {
  db.state = { gen: 3, guidelineGen: 3, extract: null, extractError: null, reviewed: null, sample: null };
  db.texts = new Map([['이미 올린 대표 문안 글입니다 반가워요', 'm1']]);
  db.log = [];
});

describe('브랜드 키트 = 요청에 든 칸만 병합', () => {
  it('맺음말 한 칸 고침이 금지어 · 넣을 말 · 슬로건 칸을 보내지 않는다', async () => {
    const res = mockRes();
    await handler('post', '/brand-voice/update-guideline')({ user: USER, body: { kind: 'marketing', guideline: { signature_locked: '늘 고맙습니다' } } }, res);
    expect(res.body?.success).toBe(true);
    const upd = db.log.find((l) => l.sql.startsWith('UPDATE') && l.sql.includes("memory_type = 'brand_guideline' AND memory_key = 'main'"))!;
    expect(JSON.parse(upd.params[1])).toEqual({ signature_locked: '늘 고맙습니다' });
  });
  it('빈 목록을 보내면 그 칸은 비운다(빠진 칸과 다르다)', async () => {
    const res = mockRes();
    await handler('post', '/brand-voice/update-guideline')({ user: USER, body: { kind: 'marketing', guideline: { banned_words: [] } } }, res);
    const upd = db.log.find((l) => l.sql.startsWith('UPDATE') && l.sql.includes("memory_type = 'brand_guideline' AND memory_key = 'main'"))!;
    expect(JSON.parse(upd.params[1])).toEqual({ banned_words: [] });
  });
});

describe('대표 문안 = 같은 글은 한 행', () => {
  it('학습 실패 뒤 같은 고르기로 다시 눌러도 넣지 않고 세대도 그대로', async () => {
    const res = mockRes();
    await handler('post', '/brand-voice/extract-guideline')({ user: USER, body: { messages: [{ channel: 'LMS', text: '이미 올린 대표 문안 글입니다 반가워요' }] } }, res);
    expect(inserts()).toHaveLength(0);
    expect(db.state.gen).toBe(3);
  });
  it('새 글은 한 번만(한 요청 안 같은 글 둘 = 한 행) · 세대 + 1', async () => {
    const res = mockRes();
    const fresh = { channel: 'LMS', text: '처음 올리는 대표 문안 글이에요 고맙습니다' };
    await handler('post', '/brand-voice/extract-guideline')({ user: USER, body: { messages: [fresh, fresh] } }, res);
    expect(inserts()).toHaveLength(1);
    expect(db.state.gen).toBe(4);
  });
  it('한 건 추가도 같은 글이면 기존 행을 돌려준다(세대 그대로)', async () => {
    const res = mockRes();
    await handler('post', '/brand-voice/messages')({ user: USER, body: { channel: 'LMS', text: '이미 올린 대표 문안 글입니다 반가워요' } }, res);
    expect(res.body).toEqual({ success: true, id: 'm1', duplicate: true });
    expect(inserts()).toHaveLength(0);
    expect(db.state.gen).toBe(3);
  });
});
