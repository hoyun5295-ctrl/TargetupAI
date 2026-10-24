/**
 * 여정 V.3 묶음 1 — 요금제 내림 경고에 쓰는 예상 크레딧(2026-10-20 · 설계서 §5-4 · §5-5)
 *
 * 기대값은 손으로 센 예(독립 출처):
 *   - 켠 지 30일이 넘은 계보 = 지난 30일 운영 차감 행 수 × 10(원장 사실)
 *   - 30일이 안 된 계보 = 300(30일 × 10 · 규칙 · 「최대」)
 *   - V.3 전 새 판 id 키로 받은 행도 같은 계보로 모은다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeJourneyCreditForecast } from '../journey-credit-forecast';

const NOW = new Date('2026-10-20T03:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

describe('computeJourneyCreditForecast (순수)', () => {
  it('오래된 계보 = 30일 실측 · 새 계보 = 최대 300', () => {
    const r = computeJourneyCreditForecast({
      now: NOW,
      unitCost: 10,
      active: [{ id: 'A', name: '신규 가입', root: 'A' }, { id: 'B2', name: '휴면', root: 'B' }],
      idToRoot: new Map([['A', 'A'], ['B', 'B'], ['B2', 'B']]),
      ledger: [
        { journeyKey: 'A', n30: 12, firstAt: daysAgo(90) },
        { journeyKey: 'B2', n30: 3, firstAt: daysAgo(5) },
      ],
    });
    expect(r.perLineage).toEqual([
      { rootId: 'A', name: '신규 가입', measured30: 120, credits: 120, basis: 'measured' },
      { rootId: 'B', name: '휴면', measured30: 30, credits: 300, basis: 'max' },
    ]);
    expect(r.total).toBe(420);
    expect(r.basis).toBe('mixed');
  });
  it('V.3 전 새 판 키(B2) · 뿌리 키(B)가 같은 계보로 모인다 · 첫 차감은 둘 중 이른 것', () => {
    const r = computeJourneyCreditForecast({
      now: NOW,
      unitCost: 10,
      active: [{ id: 'B3', name: '휴면', root: 'B' }],
      idToRoot: new Map([['B', 'B'], ['B2', 'B'], ['B3', 'B']]),
      ledger: [
        { journeyKey: 'B', n30: 4, firstAt: daysAgo(60) },
        { journeyKey: 'B2', n30: 6, firstAt: daysAgo(10) },
      ],
    });
    expect(r.perLineage).toEqual([{ rootId: 'B', name: '휴면', measured30: 100, credits: 100, basis: 'measured' }]);
    expect(r.basis).toBe('measured');
  });
  it('차감 기록이 없는 켜진 계보 = 최대 · 켜진 계보 밖 기록은 세지 않는다', () => {
    const r = computeJourneyCreditForecast({
      now: NOW,
      unitCost: 10,
      active: [{ id: 'C', name: '생일', root: 'C' }],
      idToRoot: new Map([['C', 'C'], ['X', 'X']]),
      ledger: [{ journeyKey: 'X', n30: 30, firstAt: daysAgo(100) }],
    });
    expect(r.perLineage).toEqual([{ rootId: 'C', name: '생일', measured30: 0, credits: 300, basis: 'max' }]);
    expect(r.total).toBe(300);
    expect(r.basis).toBe('max');
  });
  it('같은 계보의 켜진 판이 둘(옛 판 마무리 + 새 판)이어도 한 줄', () => {
    const r = computeJourneyCreditForecast({
      now: NOW,
      unitCost: 10,
      active: [{ id: 'D', name: '구매 감사', root: 'D' }, { id: 'D2', name: '구매 감사', root: 'D' }],
      idToRoot: new Map([['D', 'D'], ['D2', 'D']]),
      ledger: [{ journeyKey: 'D', n30: 20, firstAt: daysAgo(40) }],
    });
    expect(r.perLineage.length).toBe(1);
    expect(r.total).toBe(200);
  });
  it('켜진 여정이 없으면 0', () => {
    const r = computeJourneyCreditForecast({ now: NOW, unitCost: 10, active: [], idToRoot: new Map(), ledger: [] });
    expect(r).toEqual({ total: 0, basis: 'measured', perLineage: [] });
  });
});

vi.mock('../../config/database', () => ({ query: vi.fn() }));
vi.mock('../journey-lineage', () => ({ lineageColumnsReady: vi.fn(async () => true) }));

describe('journeyCreditForecast (원장 조회 1번)', () => {
  let q: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const db: any = await import('../../config/database');
    q = db.query;
    q.mockReset();
  });
  it('켜진 계보 · 계보 표 · 원장 묶음을 읽어 계산한다(원장은 journey-operation 차감만)', async () => {
    q.mockImplementation(async (sql: string) => {
      if (/FROM ai_credit_transactions/.test(sql) && /continuous-operator-send/.test(sql)) {
        expect(sql).toContain("type = 'deduct'");
        return { rows: [{ n: 2 }] };   // ★ 2026-10-23 자동 마케팅 운영 2일 × 10
      }
      if (/FROM ai_credit_transactions/.test(sql)) {
        expect(sql).toContain("source = 'journey-operation'");
        expect(sql).toContain("type = 'deduct'");
        return { rows: [{ journey_key: 'A', n30: 3, first_at: daysAgo(45) }] };
      }
      if (/status = 'active'/.test(sql)) return { rows: [{ id: 'A', name: '신규 가입', root: 'A' }] };
      if (/FROM journeys/.test(sql)) return { rows: [{ id: 'A', root: 'A' }] };
      return { rows: [] };
    });
    const { journeyCreditForecast } = await import('../journey-credit-forecast');
    const r = await journeyCreditForecast('c', NOW);
    expect(r.total).toBe(50);   // 여정 3일 × 10 + 자동 마케팅 2일 × 10
    expect(r.autoMarketing30).toBe(20);
    expect(r.perLineage[0]).toMatchObject({ rootId: 'A', basis: 'measured' });
  });
});

describe('요금제 내림 경고 판정 · 주소 배선', () => {
  it('예상이 새 요금제 월 기본을 넘을 때만 · 크레딧제 미적용 요금제(null)는 보지 않는다', async () => {
    const { journeyCreditOverPlan } = await import('../journey-credit-forecast');
    const f = { total: 820, basis: 'measured' as const, perLineage: [] };
    expect(journeyCreditOverPlan(f, 750)).toBe(true);
    expect(journeyCreditOverPlan(f, 820)).toBe(false);
    expect(journeyCreditOverPlan(f, 2400)).toBe(false);
    expect(journeyCreditOverPlan(f, null)).toBe(false);
  });
  it('고객 신청 = 확인 전 409 JOURNEY_CREDIT_OVER_PLAN · 슈퍼관리자 목록 = 대기 신청마다 같은 숫자', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const co = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'companies.ts'), 'utf-8');
    const req = co.slice(co.indexOf("router.post('/plan-request'"), co.indexOf("router.post('/plan-request'") + 3500);
    expect(req).toContain('acknowledgeJourneyCredit');
    expect(req).toContain("code: 'JOURNEY_CREDIT_OVER_PLAN'");
    expect(req).toContain('journeyCreditForecast(companyId)');
    // 확인 뒤에만 저장(409 가 INSERT 보다 앞)
    expect(req.indexOf("code: 'JOURNEY_CREDIT_OVER_PLAN'")).toBeLessThan(req.indexOf('INSERT INTO plan_requests'));
    const ad = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf-8');
    const list = ad.slice(ad.indexOf("router.get('/plan-requests'"), ad.indexOf("router.get('/plan-requests'") + 2500);
    expect(list).toContain('p_requested.ai_credits_per_month as requested_plan_credits');
    expect(list).toContain('journeyCreditForecast(');
  });
});
