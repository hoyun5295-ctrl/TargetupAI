/**
 * C130 T2-4 — 반려 회신 본문에 명단 칸 값이 통째로 실리지 않는다(★ 2026-11-13 · 설계서 §3 값 범위 · 행동 시험)
 *
 *   회신 본문 = 우리 문장 + 반려 사유. 명단에서 온 사유는 메일 워커가 analyzeOneStep 의 errors · headers 를 그대로 싣는다
 *   (agency-send-mail-worker processMessage 「fail(analysis.errors …, analysis.headers)」 · 수신자 열 판별 실패 = list.headers).
 *   그래서 명단 칸마다 표식 값을 넣고 반려 갈래마다 analyzeOneStep 을 돌려, 사유와 열 이름에 표식이 통째로 나오지 않는지 본다.
 *   허용 = 열 이름 · 행 번호 · 보낼 수 없는 글자와 그 앞 최대 8자(message-sanitizer BEFORE_MAX · C109 기존 사유 · 8자 이하 칸 값은 통째일 수 있다) ·
 *          미등록 회신번호(명단 회신번호 열 값 = 업체 발신번호 · 설계서 §3).
 */
import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeOneStep, parseOneStepOverrides } from '../agency-send-intake';
import { EMAIL_MIN_LEAD_MINUTES } from '../agency-send-state';

vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../ai-column-mapper', () => ({ suggestVarColumnsWithAi: vi.fn(async () => []) }));
vi.mock('../callback-filter', () => ({
  getRegisteredCallbackSet: vi.fn(async () => new Set(['0500000000'])),
  isCallbackRegistered: vi.fn(async () => true),
}));

const AUTH = { companyId: '00000000-0000-0000-0000-0000000000c1', userId: '00000000-0000-0000-0000-0000000000c2' };
const when = () => {
  const d = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const book = (rows: any[][], sheet: string) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const form = (o: { content?: string; callback?: string; phoneCol?: string } = {}) => book([
  ['제목', '시험'],
  ['문안', o.content ?? '안내드립니다.'],
  ['보낼 시각', when()],
  ['회신번호', o.callback ?? '0500000000'],
  ['담당자 번호', '010-0000-1111'],
  ...(o.phoneCol ? [['수신자 열 이름', o.phoneCol]] : []),
], '요청서');
/** 표식 = MKR{행}{칸}-PAD-Q(8자 넘게) — 회신에 이 꼴이 통째로 나오면 칸 값이 실린 것이다 */
const mk = (row: number, col: string) => `MKR${row}${col}-PAD-Q`;
const MARK = /MKR\d+[^\s'"]*-PAD-Q/;

async function reply(formBuf: Buffer, listRows: any[][]): Promise<{ text: string; errors: number }> {
  const a = await analyzeOneStep(AUTH, formBuf, book(listRows, '명단'), '명단.xlsx', parseOneStepOverrides({}), false, EMAIL_MIN_LEAD_MINUTES);
  // 워커가 회신에 싣는 그대로: 사유 = `[field] error` 이음 · 열 이름 = headers
  return { text: [...a.errors.map((e) => `[${e.field}] ${e.error}`), ...a.headers].join('\n'), errors: a.errors.length };
}

describe('T2-4 반려 회신 = 명단 칸 값 통째 0', () => {
  it('형식 오류 번호 행 · 이름 · 메모 칸 + 맞지 않는 문안 항목 = 사유에 칸 값 없음', async () => {
    const r = await reply(form({ content: '%없는항목%님 안내드립니다.' }), [
      ['고객명', '연락처', '메모'],
      [mk(2, '고객명'), '01000001111', mk(2, '메모')],
      [mk(3, '고객명'), mk(3, '연락처'), mk(3, '메모')],
      [mk(4, '고객명'), '01000002222', mk(4, '메모')],
    ]);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.text).not.toMatch(MARK);
  });

  it('요청서 수신자 열 이름이 명단에 없음 = 사유에 칸 값 없음', async () => {
    const r = await reply(form({ phoneCol: '없는열' }), [
      ['고객명', '연락처'],
      [mk(2, '고객명'), '01000001111'],
    ]);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.text).not.toMatch(MARK);
  });

  it('보낼 수 없는 글자 = 행 번호 · 열 이름 · 그 글자와 앞 최대 8자 · 8자 넘는 칸 값은 통째 없음', async () => {
    const r = await reply(form({ content: '%고객명%님 안내드립니다.' }), [
      ['고객명', '연락처'],
      [`${mk(2, '고객명')}é`, '01000001111'],
      [mk(3, '고객명'), '01000002222'],
    ]);
    expect(r.text).toContain('명단 1행 고객명 칸');
    expect(r.text).toContain('U+00E9');
    expect(r.text).not.toMatch(MARK);
    const ctx = [...r.text.matchAll(/칸 '([^']*)' 뒤/g)].map((m) => m[1]);
    expect(ctx.length).toBeGreaterThan(0);
    for (const c of ctx) expect(c.length).toBeLessThanOrEqual(8);
  });

  it('보낼 수 있는 번호 없음(수신자 열 지정 · 번호 칸이 전부 형식 오류) = 사유에 칸 값 없음', async () => {
    const r = await reply(form({ phoneCol: '연락처' }), [
      ['고객명', '연락처'],
      [mk(2, '고객명'), mk(2, '연락처')],
      [mk(3, '고객명'), mk(3, '연락처')],
    ]);
    expect(r.text).toContain('보낼 수 있는 번호가 없습니다');
    expect(r.text).not.toMatch(MARK);
  });

  it('회신번호 열 방식 · 미등록 번호 = 그 회신번호만 실린다(업체 발신번호) · 이름 · 받는 번호 칸 값 없음', async () => {
    const r = await reply(form({ callback: '발신' }), [
      ['고객명', '연락처', '발신'],
      [mk(2, '고객명'), '01000001111', '0212345678'],
      [mk(3, '고객명'), '01000002222', '0212345678'],
    ]);
    expect(r.text).toContain('0212345678');
    expect(r.text).not.toMatch(MARK);
    expect(r.text).not.toContain('01000001111');
    expect(r.text).not.toContain('01000002222');
  });
});
