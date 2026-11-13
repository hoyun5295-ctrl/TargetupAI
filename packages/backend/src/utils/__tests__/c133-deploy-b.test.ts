// replaces: none
/**
 * C133 배포 B — 기본 여정 한 번에 켜기(F1 1 ~ 7번 · ★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §3)
 *   1. 추천 칸 = 단계가 닫힌 회사는 종전 다섯 칸 그대로 · 열린 회사는 순간 칸 셋(장바구니 · 조회 후 미구매 · 생일)이 더 나온다
 *   2. 혜택 답 = 적은 혜택만 넘긴다 · 요청 키에 든다(다른 혜택 = 다른 요청) · 비우면 키가 종전과 글자 그대로 같다
 *   3. 무료 추정 = 주소의 cap 값 읽기(없음 = 저장된 값 · none = 비움 · 1 이상 정수) · 그 밖은 거절
 *   실 PG 판(저장 전 최대 인원으로 판정 · 선불 잔액) = c133-deploy-b.pg.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() }, withTransaction: vi.fn() }));

import { buildFlowPlan, recoRequestId, normalizeRecoBenefit } from '../journey-opportunities';
import { parseSimulationCap } from '../journey-simulator';
import { triggerKeyForEvent, aiSelectableTriggerEvents } from '../journey-trigger-capability';
import { MAX_BENEFIT_CHARS } from '../journey-interview';
import {
  estimateUrl, toEstimate, estimateLine, stopLine, sumEstimates, totalLine, balanceShort, createEstimateQueue,
  type JourneyEstimate, type EstimateCell,
} from '../../../../frontend/src/utils/journey-estimate';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const BASE = ['customer.created', 'purchase.first', 'cdp.purchase', 'customer.dormant', 'customer.dormant_return'];
const MOMENTS = ['cdp.cart_abandon', 'cdp.browse_no_purchase', 'customer.birthday_approaching'];

describe('추천 칸 — 단계가 닫힌 회사 = 종전 다섯 칸 · 열린 회사 = 순간 칸 셋 더', () => {
  it('기본(닫힘) = 다섯 칸 · 차례 · 내용이 순간 칸을 켠 때의 앞 다섯과 같다', () => {
    const off = buildFlowPlan(null, new Set(), {});
    const on = buildFlowPlan(null, new Set(), {}, new Set(), new Set(), true);
    expect(off.map((p) => p.triggerEvent)).toEqual(BASE);
    expect(on.map((p) => p.triggerEvent)).toEqual([...BASE, ...MOMENTS]);
    expect(on.slice(0, 5)).toEqual(off);   // 닫힌 회사의 응답은 한 글자도 달라지지 않는다
  });

  it('순간 칸 = 한 칸 · 참고 간격 · 실측이라고 말하지 않는다 · 시작 사건은 계약에 있는 AI 선택 가능 사건', () => {
    const on = buildFlowPlan(null, new Set(), {}, new Set(), new Set(), true).slice(5);
    expect(on.map((p) => p.key)).toEqual(['cart', 'browse', 'birthday']);
    for (const p of on) {
      expect(p.daysFromStart).toEqual([0]);
      expect(p.measured).toBe(false);
      expect(p.sample).toBeNull();
      expect(p.dormantDays).toBeNull();
      expect(p.status).toBe('ready');
      expect(triggerKeyForEvent(p.triggerEvent)).toBe(p.key);
      expect(aiSelectableTriggerEvents()).toContain(p.triggerEvent);
      expect(`${p.title} ${p.objective} ${p.evidence}`).not.toMatch(/\d|%|보장|무료/);   // 지어낸 숫자 · 혜택 0
    }
  });

  it('데이터가 없는 회사 = 잠금 사유 그대로 · 이미 켠 여정 · 초안이 있는 칸은 다시 권하지 않는다', () => {
    const plan = buildFlowPlan(
      null,
      new Set(['cdp.cart_abandon']),
      { browse: { available: false, reason: '자사몰 상품 조회가 들어와야 해요' } } as any,
      new Set(['customer.birthday_approaching']),
      new Set(),
      true,
    );
    const by = (ev: string) => plan.find((p) => p.triggerEvent === ev)!;
    expect(by('cdp.cart_abandon')).toMatchObject({ status: 'exists', reason: '이미 켜진 여정이 있어요.' });
    expect(by('cdp.browse_no_purchase')).toMatchObject({ status: 'locked', reason: '자사몰 상품 조회가 들어와야 해요' });
    expect(by('customer.birthday_approaching').status).toBe('drafted');
  });

  it('진단 = 단계 판정을 한 번 읽어 칸과 pack 칸에 같이 쓴다 · 포인트 소멸은 넣지 않는다', () => {
    const src = code(back('utils/journey-opportunities.ts'));
    expect(src).toContain("const pack = await v3Live('journey-pack', companyId);");
    expect(src).toContain('flowPlan: buildFlowPlan(rhythm, activeTriggers, availability, draftedTriggers, othersTriggers, pack),');
    expect(src).toMatch(/flowPlan: buildFlowPlan\([^\n]*\),\n\s*pack,/);
    const fn = src.slice(src.indexOf('export function buildFlowPlan('), src.indexOf('const DIAG_TTL_MS'));
    expect(fn).not.toContain('customer.points_expiring');
    expect(fn).toContain('const items = momentSlots ? [...base, ...moments] : base;');
  });
});

describe('혜택 답 — 적은 것만 · 요청 키', () => {
  const plan = { triggerEvent: 'purchase.first', daysFromStart: [1, 14, 28], dormantDays: null };
  const legacy = (company: string, user: string) => {
    const h = createHash('sha256').update(`${company}|${user}|reco|purchase.first|1,14,28|`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };

  it('⛔ 혜택을 비우면 요청 키가 종전과 글자 그대로 같다(이미 만든 초안의 「이미 만듦」 판정 유지)', () => {
    expect(recoRequestId('c1', 'u1', plan)).toBe(legacy('c1', 'u1'));
    expect(recoRequestId('c1', 'u1', plan, null)).toBe(legacy('c1', 'u1'));
    expect(recoRequestId('c1', 'u1', plan, '')).toBe(legacy('c1', 'u1'));
    expect(recoRequestId('c1', 'u1', plan, '   ')).toBe(legacy('c1', 'u1'));
  });

  it('다른 혜택 = 다른 요청 · 같은 혜택(공백만 다름) = 같은 요청', () => {
    const a = recoRequestId('c1', 'u1', plan, '첫 구매 10% 쿠폰');
    expect(a).not.toBe(legacy('c1', 'u1'));
    expect(recoRequestId('c1', 'u1', plan, '  첫 구매   10% 쿠폰 ')).toBe(a);
    expect(recoRequestId('c1', 'u1', plan, '첫 구매 20% 쿠폰')).not.toBe(a);
    expect(recoRequestId('c1', 'u2', plan, '첫 구매 10% 쿠폰')).not.toBe(a);
  });

  it('정리 = 문자열만 · 앞뒤 · 이어진 공백 · 빈 글 = 없음(길이는 자르지 않는다 = 질문표 판정이 거절한다)', () => {
    expect(normalizeRecoBenefit('  첫 구매   10% 쿠폰 ')).toBe('첫 구매 10% 쿠폰');
    expect(normalizeRecoBenefit('')).toBeNull();
    expect(normalizeRecoBenefit('  \n ')).toBeNull();
    expect(normalizeRecoBenefit(undefined)).toBeNull();
    expect(normalizeRecoBenefit({ a: 1 })).toBeNull();
    expect(normalizeRecoBenefit(123)).toBeNull();
    const long = '가'.repeat(MAX_BENEFIT_CHARS + 50);
    expect(normalizeRecoBenefit(long)).toBe(long);
    expect(MAX_BENEFIT_CHARS).toBe(200);
  });

  it('라우트: 단계가 열린 회사만 혜택을 받는다 · 답 키 = 인터뷰가 읽는 그 키 · 비면 답을 싣지 않는다', () => {
    const r = back('routes/ai.ts');
    const route = code(r.slice(r.indexOf("router.post('/operator/journeys-reco/design'"), r.indexOf('// POST /api/ai/operator/journeys — 신규 여정 생성')));
    expect(route).toContain("const benefitText = (await v3Live('journey-pack', companyId)) ? normalizeRecoBenefit(benefit) : null;");
    expect(route).toContain('interviewId: recoRequestId(companyId, userId, plan, benefitText),');
    expect(route).toContain('...(benefitText ? { [`reco-${plan.key}:benefit`]: benefitText } : {}),');
    expect(back('utils/journey-interview.ts')).toContain('const benefitRaw = String(answers[`${plan.key}:benefit`] ??');
  });

  it('화면: 혜택 칸은 서버가 열렸다고 한 회사에만 · 추천 여정 초안 요청에만 싣는다(상품 여정 요청에는 안 싣는다) · 길이 = 서버와 같은 값', () => {
    const p = front('components/journey/map/JourneyDiagnosisPanel.tsx');
    expect(p).toContain('{diag.pack === true && diag.flowPlan.some((p) => p.status === \'ready\') && (');
    expect(p).toContain("...(diag.pack === true && benefit.trim() ? { benefit: benefit.trim() } : {})");
    const productCall = p.slice(p.indexOf("call('/api/ai/operator/journeys-product/create'"), p.indexOf("call('/api/ai/operator/journeys-product/create'") + 300);
    expect(productCall).not.toContain('benefit');
    expect(p).toContain(`const BENEFIT_MAX = ${MAX_BENEFIT_CHARS};`);
    expect(p).toContain('드릴 혜택이 있으면 적어 주세요');
  });
});

describe('무료 추정 — 주소의 cap 값', () => {
  it('없음 = 저장된 값(종전) · none = 비움 · 1 이상 정수 = 그 값 · 그 밖 = 거절', () => {
    expect(parseSimulationCap(undefined)).toEqual({ ok: true, cap: undefined });
    expect(parseSimulationCap('none')).toEqual({ ok: true, cap: null });
    expect(parseSimulationCap('1')).toEqual({ ok: true, cap: 1 });
    expect(parseSimulationCap('120000')).toEqual({ ok: true, cap: 120000 });
    for (const bad of ['0', '-5', '1.5', '1e3', ' 10', '10 ', 'abc', '', '01', '1234567890', ['10'], 10, null, { a: 1 }]) {
      expect([bad, parseSimulationCap(bad).ok]).toEqual([bad, false]);
    }
  });

  it('라우트: 읽기는 CT 한 곳 · 틀린 값 = 400 · cap 이 없으면 종전 호출 그대로', () => {
    const r = back('routes/ai.ts');
    const route = code(r.slice(r.indexOf("router.get('/operator/journeys/:id/simulate'"), r.indexOf("router.get('/operator/journeys/:id/live-positions'")));
    expect(route).toContain('const capQ = parseSimulationCap(req.query.cap);');
    expect(route).toContain('if (!capQ.ok) return res.status(400)');
    expect(route).toContain('await simulateJourney(req.params.id, companyId, capQ.cap === undefined ? {} : { cap: capQ.cap });');
    expect(route.indexOf('journeyGate(req, res)')).toBeLessThan(route.indexOf('parseSimulationCap('));
  });

  it('시뮬레이터: 판정 칸 = 경고 문장과 같은 조건 하나 · 저장하지 않는다(UPDATE 0)', () => {
    const s = code(back('utils/journey-simulator.ts'));
    expect(s).toContain('const cap = opts.cap === undefined ? storedCap : opts.cap;');
    expect(s).toContain('const firstRoundCapExceeded = firstRoundIsMatched && entryCapExceeded(cap, backfill, matched);');
    expect(s).toContain('if (firstRoundCapExceeded) {');
    expect(s.match(/entryCapExceeded\(/g)).toHaveLength(1);
    expect(s).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
    expect(s).toContain("prepaidBalance: c.billing_type === 'prepaid' ? Number(c.balance) || 0 : null,");
  });
});

describe('켜기 창의 무료 추정 — 화면 순수 함수', () => {
  const E = (over: Partial<JourneyEstimate> = {}): JourneyEstimate => ({
    matchedCustomers: 1200, approximate: false, totalEstimatedSends: 2400, totalEstimatedCost: 48000,
    firstRoundCapExceeded: false, capUsed: null, prepaidBalance: null, fatigueCap: 'on', ...over,
  });

  it('주소 = 지금 칸의 최대 인원으로(비움 = none) · 서버 읽기 규칙과 같은 꼴', () => {
    expect(estimateUrl('j1', null)).toBe('/api/ai/operator/journeys/j1/simulate?cap=none');
    expect(estimateUrl('j1', 500)).toBe('/api/ai/operator/journeys/j1/simulate?cap=500');
    expect(parseSimulationCap('none')).toEqual({ ok: true, cap: null });
    expect(parseSimulationCap('500')).toEqual({ ok: true, cap: 500 });
  });

  it('서버 응답 → 화면 칸: 꼴이 다르면 쓰지 않는다 · 피로도는 켜짐 · 꺼짐만 믿는다', () => {
    const sim = { matchedCustomers: 5, approximate: true, totalEstimatedSends: 5, totalEstimatedCost: 100, firstRoundCapExceeded: true, capUsed: 3, prepaidBalance: 12345, fatigueCap: 'off' };
    expect(toEstimate(sim)).toEqual(sim);
    expect(toEstimate({ ...sim, capUsed: null, prepaidBalance: null, fatigueCap: 'weird' })).toMatchObject({ capUsed: null, prepaidBalance: null, fatigueCap: 'unknown' });
    expect(toEstimate({ ...sim, firstRoundCapExceeded: undefined })).toBeNull();     // 옛 서버 응답(판정 칸 없음) = 쓰지 않는다
    expect(toEstimate({ ...sim, matchedCustomers: '5' })).toBeNull();
    expect(toEstimate({ ...sim, capUsed: '3' })).toBeNull();
    expect(toEstimate(null)).toBeNull();
  });

  it('줄 글 = 상시 대상 「지금 대상」 · 사건형 「최근 사건 기준 약」 · 숫자는 받은 값 그대로', () => {
    expect(estimateLine(E())).toBe('지금 대상 1,200명 · 예상 발송 2,400건 · 발송비 약 48,000원');
    expect(estimateLine(E({ approximate: true }))).toBe('최근 사건 기준 약 1,200명 · 예상 발송 2,400건 · 발송비 약 48,000원');
  });

  it('켜면 바로 멈춤 = 판정 칸이 참일 때만 · 늘릴 인원 = 지금 대상 수', () => {
    expect(stopLine(E())).toBeNull();
    expect(stopLine(E({ firstRoundCapExceeded: true, capUsed: 100 }))).toBe('켜면 바로 멈춰요 · 최대 인원을 1,200명 이상으로 늘리거나 비워 주세요');
  });

  it('합계 = 추정을 아는 여정만 더한다 · 일부만 알면 그렇다고 적는다 · 하나도 모르면 빈 글(지어내지 않는다)', () => {
    const sum = sumEstimates([E(), null, E({ totalEstimatedSends: 100, totalEstimatedCost: 2000 }), undefined]);
    expect(sum).toEqual({ sends: 2500, cost: 50000, known: 2 });
    expect(totalLine(sum, 4)).toBe('예상 발송 2,500건 · 발송비 약 50,000원(2개 기준)');
    expect(totalLine(sum, 2)).toBe('예상 발송 2,500건 · 발송비 약 50,000원');
    expect(totalLine(sumEstimates([null]), 1)).toBe('');
  });

  it('잔액 안내 = 선불이고 잔액이 예상 발송비보다 적을 때만(후불 · 모름 · 발송비 0 = 안내 없음)', () => {
    expect(balanceShort(10000, 48000)).toBe(true);
    expect(balanceShort(48000, 48000)).toBe(false);
    expect(balanceShort(null, 48000)).toBe(false);
    expect(balanceShort(undefined, 48000)).toBe(false);
    expect(balanceShort(0, 0)).toBe(false);
  });
});

describe('추정 요청 줄 — 한 번에 하나 · 답은 지금 원하는 것과 맞을 때만(★ Codex 배포 B 1R)', () => {
  const EST = (matched: number, capUsed: number | null): JourneyEstimate => ({
    matchedCustomers: matched, approximate: false, totalEstimatedSends: matched, totalEstimatedCost: matched * 10,
    firstRoundCapExceeded: false, capUsed, prepaidBalance: null, fatigueCap: 'on',
  });
  /** 손으로 풀어 주는 가짜 조회 — 부른 차례 · 동시에 떠 있는 수를 잰다 */
  const harness = () => {
    const calls: Array<{ id: string; cap: number | null; resolve: (e: JourneyEstimate | null) => void }> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const cells: Record<string, EstimateCell> = {};
    const history: Array<{ id: string } & EstimateCell> = [];   // 화면에 쓴 것 전부(잠깐이라도 낡은 답을 쓰지 않는지 본다)
    const q = createEstimateQueue({
      fetch: (id, cap) => new Promise((res) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push({ id, cap, resolve: (e) => { inFlight -= 1; res(e); } });
      }),
      onCell: (id, cell) => { cells[id] = cell; history.push({ id, ...cell }); },
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { q, calls, cells, history, tick, max: () => maxInFlight };
  };

  it('고른 여정을 하나씩 차례로 묻는다(동시에 둘이 떠 있지 않다)', async () => {
    const h = harness();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: null }, { id: 'b', cap: 5 }, { id: 'c', cap: null }] });
    await h.tick();
    expect(h.calls.map((c) => c.id)).toEqual(['a']);
    expect(h.cells.a).toEqual({ epoch: 1, cap: null, est: undefined });      // 묻는 중
    h.calls[0].resolve(EST(10, null)); await h.tick();
    expect(h.cells.a.est).toEqual(EST(10, null));
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'b']);
    h.calls[1].resolve(EST(20, 5)); await h.tick();
    h.calls[2].resolve(null); await h.tick();                                   // 못 읽음
    expect(h.cells.c).toEqual({ epoch: 1, cap: null, est: null });
    expect(h.max()).toBe(1);
  });

  it('도는 동안 칸 · 고르기를 여러 번 바꿔도 조회가 겹치지 않는다 · 끝난 뒤 가장 최근 요청으로 한 번 다시 돈다', async () => {
    const h = harness();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: 10 }] });
    await h.tick();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: 20 }] });
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: 30 }, { id: 'b', cap: null }] });
    await h.tick();
    expect(h.calls).toHaveLength(1);                                             // a(10) 하나만 떠 있다
    h.calls[0].resolve(EST(1, 10)); await h.tick();
    // a(10) 의 답은 버린다(지금 칸 = 30) · a(20) 은 묻지도 않는다 · 가장 최근 요청으로 다시 돈다
    expect(h.cells.a).toEqual({ epoch: 1, cap: 30, est: undefined });
    expect(h.calls.map((c) => `${c.id}:${c.cap}`)).toEqual(['a:10', 'a:30']);
    h.calls[1].resolve(EST(3, 30)); await h.tick();
    h.calls[2].resolve(EST(7, null)); await h.tick();
    expect(h.cells.a.est).toEqual(EST(3, 30));
    expect(h.cells.b.est).toEqual(EST(7, null));
    expect(h.max()).toBe(1);
  });

  it('요청이 바뀌면 앞 요청의 남은 여정은 묻지 않는다(고르기를 바꾼 뒤 옛 목록을 끝까지 세지 않는다)', async () => {
    const h = harness();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: null }, { id: 'b', cap: null }, { id: 'c', cap: null }] });
    await h.tick();
    h.q.request({ epoch: 1, items: [{ id: 'x', cap: null }] });
    h.calls[0].resolve(EST(1, null)); await h.tick();
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'x']);                         // b · c 는 묻지 않았다
    h.calls[1].resolve(EST(9, null)); await h.tick();
    expect(h.cells.x.est).toEqual(EST(9, null));
    expect(h.cells.b).toBeUndefined();
    expect(h.max()).toBe(1);
  });

  it('화면이 사라지면(빈 요청 · 차례 -1) 떠 있던 조회의 답을 버리고 남은 여정을 더 묻지 않는다(★ Codex 배포 B 2R)', async () => {
    const h = harness();
    h.q.request({ epoch: 3, items: [{ id: 'a', cap: null }, { id: 'b', cap: null }, { id: 'c', cap: null }] });
    await h.tick();
    h.q.request({ epoch: -1, items: [] });                                        // 화면이 사라짐
    h.calls[0].resolve(EST(5, null)); await h.tick(); await h.tick();
    expect(h.calls.map((c) => c.id)).toEqual(['a']);                              // b · c 는 시작하지 않았다
    expect(h.history.some((x) => x.est)).toBe(false);                             // a 의 답도 쓰지 않았다
  });

  it('창을 닫았다 다시 열면 다시 열기 전의 답은 새 창에 반영되지 않는다(같은 칸 값이어도)', async () => {
    const h = harness();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: null }] });
    await h.tick();
    h.q.request({ epoch: 1, items: [] });                                         // 닫음
    h.q.request({ epoch: 2, items: [{ id: 'a', cap: null }] });                   // 같은 값으로 다시 엶
    await h.tick();
    h.calls[0].resolve(EST(111, null)); await h.tick();                           // 옛 창의 답이 이제 도착
    expect(h.cells.a.epoch).toBe(2);
    expect(h.cells.a.est).toBeUndefined();                                        // 새 창은 아직 묻는 중(옛 답을 쓰지 않았다)
    expect(h.history.some((x) => x.est && x.est.matchedCustomers === 111)).toBe(false);   // 잠깐이라도 화면에 쓰지 않았다
    expect(h.calls).toHaveLength(2);
    h.calls[1].resolve(EST(222, null)); await h.tick();
    expect(h.cells.a).toEqual({ epoch: 2, cap: null, est: EST(222, null) });
    expect(h.max()).toBe(1);
  });

  it('같은 창 · 같은 값으로 이미 물은 여정은 다시 묻지 않는다(답 · 못 읽음 모두) · 새로 고른 여정만 묻는다', async () => {
    const h = harness();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: null }, { id: 'b', cap: null }] });
    await h.tick(); h.calls[0].resolve(EST(1, null)); await h.tick(); h.calls[1].resolve(null); await h.tick();
    h.q.request({ epoch: 1, items: [{ id: 'a', cap: null }, { id: 'b', cap: null }, { id: 'c', cap: 9 }] });
    await h.tick();
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    h.calls[2].resolve(EST(3, 9)); await h.tick();
    // 고르기에서 뺐다가 도는 중에 답이 오면 버리고 · 다시 고르면 다시 묻는다
    h.q.request({ epoch: 1, items: [{ id: 'd', cap: null }] });
    await h.tick();
    h.q.request({ epoch: 1, items: [] });
    h.calls[3].resolve(EST(4, null)); await h.tick();
    expect(h.cells.d.est).toBeUndefined();
    h.q.request({ epoch: 1, items: [{ id: 'd', cap: null }] });
    await h.tick();
    expect(h.calls.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'd']);
  });
});

describe('켜기 창의 무료 추정 — 창 계약', () => {
  const m = front('components/journey/map/BatchActivateModal.tsx');
  const c = code(m);

  it('단계가 열린 회사에만 묻고 그린다(닫힌 회사 = 추정 요청 0 · 종전 화면)', () => {
    expect(c).toContain("const packOpen = useV3Feature('journey-pack');");
    expect(c).toMatch(/const estKey = packOpen && open && !results \?/);
    expect(c).toContain('const estOf = (id: string): JourneyEstimate | null => cellOf(id)?.est || null;');
    expect(c).toContain('{packOpen && (() => {');
  });

  it('창은 추정을 요청 줄 하나로만 묻는다(직접 부르지 않는다) · 입력이 멈춘 뒤 · 닫히면 빈 요청 · 다시 열면 새 차례', () => {
    const util = front('utils/journey-estimate.ts');
    expect(util).toContain('return e && e.capUsed === cap ? e : null;');
    expect(c).toContain('const estQueue = useMemo(() => createEstimateQueue({');
    expect(c.match(/fetchJourneyEstimate/g)).toHaveLength(2);                    // 가져오기 줄 + 요청 줄에 넘기는 자리(직접 호출 0)
    expect(c).not.toMatch(/await fetchJourneyEstimate|fetchJourneyEstimate\(/);
    const fx = c.slice(c.indexOf('if (!estKey) { estQueue.request({ epoch: estEpoch, items: [] }); return; }'), c.indexOf('const cellOf = '));
    expect(fx).toContain('const timer = setTimeout(() => estQueue.request({ epoch: estEpoch, items }), ESTIMATE_DEBOUNCE_MS);');
    expect(fx).toContain('return () => clearTimeout(timer);');
    expect(c).toContain('setEstEpoch((n) => n + 1);');
    expect(c).toMatch(/const estKey = packOpen && open && !results \? `\$\{estEpoch\}#/);
    expect(c).toContain('useEffect(() => () => estQueue.request({ epoch: -1, items: [] }), [estQueue]);');   // 화면이 사라지면 줄을 비운다
    // 화면도 이 창을 연 차례 · 지금 칸 값의 답만 읽는다
    expect(c).toContain('return packOpen && e && capOk(id) && e.epoch === estEpoch && e.cap === capOf(id) ? e : null;');
  });

  it('추정은 읽기만 한다(창이 서버 값을 바꾸는 요청을 더하지 않는다) · 켜면 바로 멈추는 여정이 있으면 [모두 켜기]를 잠근다', () => {
    const util = code(front('utils/journey-estimate.ts'));
    expect(util).not.toMatch(/sendJson|method:/);
    expect(c).toContain('const capStops = selectedEsts.some((e) => e?.firstRoundCapExceeded === true);');
    expect(c).toContain('const ready = selectedList.length > 0 && allCaps && allAck && !running && !capStops;');
  });

  it('잔액 · 피로도 = 안내만(잠그지 않는다 · 값을 여기서 정하지 않는다)', () => {
    expect(c).toContain('const lowBalance = balanceShort(anyEst?.prepaidBalance, total.cost);');
    expect(c).toContain("const fatigueOff = selectedEsts.some((e) => e?.fatigueCap === 'off');");
    expect(c).not.toMatch(/ready = [^;]*lowBalance/);
    expect(c).not.toMatch(/ready = [^;]*fatigueOff/);
    expect(m).toContain('한 고객이 받는 광고 문자 상한이 꺼져 있어요.');
    expect(m).toContain("navigate('/settings');");
    expect(c).not.toMatch(/fatigue_cap_days|fatigue_cap_max/);
  });
});

describe('입구', () => {
  it('여정 화면의 단추는 단계가 열린 회사에만 · 지도 화면은 열쇠를 읽어 진단 창을 열고 주소에서 지운다', () => {
    const list = front('pages/JourneysPage.tsx');
    expect(list).toContain("const journeyPackOpen = useV3Feature('journey-pack');");
    expect(list).toContain("{journeyPackOpen && (");
    expect(list).toContain("navigate('/ai-journeys/map?open=diagnosis')");
    const map = front('pages/JourneyMapPage.tsx');
    const fx = map.slice(map.indexOf("if (searchParams.get('open') !== 'diagnosis') return;"), map.indexOf('}, [searchParams, setSearchParams]);', map.indexOf("if (searchParams.get('open') !== 'diagnosis') return;")));
    expect(fx).toContain('setGapOpen(true);');
    expect(fx).toContain("n.delete('open');");
    expect(fx).toContain('{ replace: true }');
  });

  it('화면의 열린 기능 읽기 = 입구를 그릴지에만 쓴다 · 실패 = 닫힘 · 실패한 답은 기억하지 않는다', () => {
    const u = front('utils/v3-features.ts');
    expect(u).toContain("fetchJson('/api/plans/v3-features')");
    expect(u).toContain("r.ok && r.body?.success === true && r.body.features && typeof r.body.features === 'object'");
    expect(u).toContain('if (Object.keys(f).length === 0 && cache?.promise === promise) cache = null;');
    expect(u).toContain('const [on, setOn] = useState(false);');
  });
});
