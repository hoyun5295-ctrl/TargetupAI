/**
 * planner-approval.test.ts — 플래너 결재 CT 계약 (★ 2026-08-13 Phase 2)
 *
 * 고정하는 계약:
 *  ① 차감 멱등키는 회사·월 고정이다 — 이 형식이 흔들리면 재승인·더블클릭이 이중 차감이 된다.
 *  ② 합계는 대행 + 제작이고, 대행 단가의 진실은 getCreditCost 하나다(테스트도 숫자를 하드코딩하지 않는다).
 *  ③ 승인 게이트는 잔액 ≥ 합계다. 행사 0건은 승인 대상이 아니고, 크레딧제 미적용 회사는 게이트가 없다.
 *  ④ 지난 달 판정은 KST 기준이다 — UTC로 세면 매월 1일 오전 9시 이전에 이번 달이 "지난 달"이 된다.
 *  ⑤ 셀 수 없는 축(인앱·알림톡)은 사유를 말한다. 그 문장에 내부 코드명·테이블명이 없어야 한다.
 *  ⑥ 결재 문자는 정보성이다 — 혜택·할인 표현을 넣지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  PLANNER_AGENCY_SOURCE,
  getAgencyCredits,
  buildApprovalIdempotencyKey,
  computeBriefTotals,
  evaluateApprovalGate,
  channelAudienceNote,
  buildApprovalNoticeBody,
  generateApprovalToken,
  computeTokenExpiry,
  currentPlanMonth,
  isPastPlanMonth,
  hasAudienceError,
  computePlanHash,
  APPROVAL_TOKEN_TTL_DAYS,
  type BriefEvent,
} from './planner-approval';
import { getCreditCost } from './ai-credit-calc';
import { estimateChannelCredits } from './marketing-planner';

const tp = (channel: any, id: string, state: 'known' | 'deferred' | 'error' = 'known') => ({
  id,
  channel,
  label: channel,
  timing: { anchor: 'start' as const },
  scheduledOn: '2026-09-10',
  estCredits: estimateChannelCredits(channel),
  audience: { count: state === 'known' ? 100 : null, state, note: '' },
});

const makeEvent = (id: string, channels: string[]): BriefEvent => {
  const touchpoints = channels.map((c, i) => tp(c, `${id}-${i}`));
  return {
    id,
    title: `행사 ${id}`,
    startsOn: '2026-09-10',
    endsOn: '2026-09-14',
    benefitText: null,
    products: [],
    status: 'draft',
    touchpoints: touchpoints as any,
    estCredits: touchpoints.reduce((s, t) => s + (t.estCredits ?? 0), 0),
  };
};

describe('멱등키 — 회사·월 고정', () => {
  it('같은 회사·같은 달은 항상 같은 키, 달이 바뀌면 키도 바뀐다', () => {
    const a = buildApprovalIdempotencyKey('c-1', '2026-09');
    expect(a).toBe('planner:c-1:2026-09');
    expect(buildApprovalIdempotencyKey('c-1', '2026-09')).toBe(a);
    expect(buildApprovalIdempotencyKey('c-1', '2026-10')).not.toBe(a);
    expect(buildApprovalIdempotencyKey('c-2', '2026-09')).not.toBe(a);
  });
});

describe('대행 단가 — getCreditCost가 유일 소스', () => {
  it('대행 크레딧은 CREDIT_COST_MAP의 그 source 값이다', () => {
    expect(getAgencyCredits()).toBe(getCreditCost(PLANNER_AGENCY_SOURCE));
    expect(getAgencyCredits()).toBeGreaterThan(0);
  });
});

describe('computeBriefTotals — 대행 + 제작', () => {
  it('제작 합계는 소재 채널만 센다(문자·알림톡은 실행 축이라 합계에 없다)', () => {
    const totals = computeBriefTotals([makeEvent('e1', ['sms', 'email']), makeEvent('e2', ['dm', 'alimtalk'])]);
    const expectedProduction =
      (estimateChannelCredits('email') ?? 0) + (estimateChannelCredits('dm') ?? 0);
    expect(totals.eventCount).toBe(2);
    expect(totals.touchpointCount).toBe(4);
    expect(totals.productionCredits).toBe(expectedProduction);
    expect(totals.agencyCredits).toBe(getAgencyCredits());
    expect(totals.totalCredits).toBe(getAgencyCredits() + expectedProduction);
  });

  it('행사가 없으면 제작은 0이어도 대행은 그대로 표시된다(승인 대상 여부는 게이트가 정한다)', () => {
    const totals = computeBriefTotals([]);
    expect(totals.productionCredits).toBe(0);
    expect(totals.totalCredits).toBe(getAgencyCredits());
  });
});

describe('evaluateApprovalGate — 잔액 ≥ 합계', () => {
  const totals = computeBriefTotals([makeEvent('e1', ['sms', 'email'])]);

  it('행사 0건은 승인 대상이 아니다', () => {
    const r = evaluateApprovalGate({ totals, balance: { total: 999999, creditEnabled: true }, eventCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('행사가 없습니다');
  });

  it('잔액이 합계보다 적으면 부족분을 숫자로 알린다', () => {
    const r = evaluateApprovalGate({
      totals,
      balance: { total: totals.totalCredits - 300, creditEnabled: true },
      eventCount: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.shortfall).toBe(300);
  });

  it('잔액이 정확히 합계면 통과한다(경계)', () => {
    const r = evaluateApprovalGate({
      totals,
      balance: { total: totals.totalCredits, creditEnabled: true },
      eventCount: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.shortfall).toBe(0);
  });

  it('크레딧제 미적용 회사는 게이트가 없다 — 차감 축 자체가 없기 때문이다', () => {
    const r = evaluateApprovalGate({ totals, balance: { total: 0, creditEnabled: false }, eventCount: 1 });
    expect(r.ok).toBe(true);
  });

  it('대행분을 이미 낸 달은 제작비만 요구한다 — 재결재에서 대행료를 두 번 묻지 않는다', () => {
    // 대행 차감 뒤 잔액이 줄어든 상태(1,500 보유 → 1,000 차감 → 500). 제작 500이면 통과해야 한다.
    const balance = { total: totals.productionCredits, creditEnabled: true };
    expect(evaluateApprovalGate({ totals, balance, eventCount: 1, agencyPaid: true }).ok).toBe(true);
    // 같은 잔액인데 대행분을 안 냈다면 막힌다 — 두 경로가 같은 게이트 하나를 쓴다.
    expect(evaluateApprovalGate({ totals, balance, eventCount: 1, agencyPaid: false }).ok).toBe(false);
  });

  it('대상 수를 못 센 축이 있으면 금액과 무관하게 막는다 (fail-closed)', () => {
    const r = evaluateApprovalGate({
      totals,
      balance: { total: 999999, creditEnabled: true },
      eventCount: 1,
      audienceError: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('대상 고객 수를 확인하지 못했습니다');
  });
});

describe('hasAudienceError — 셀 수 없는 축(deferred)과 못 센 축(error)의 구분', () => {
  it('인앱·알림톡의 deferred는 승인을 막지 않는다', () => {
    const ev = makeEvent('e1', ['inapp', 'alimtalk']);
    ev.touchpoints = [tp('inapp', 'a', 'deferred'), tp('alimtalk', 'b', 'deferred')] as any;
    expect(hasAudienceError([ev])).toBe(false);
  });

  it('실릴 채널 하나라도 error면 막는다', () => {
    const ev = makeEvent('e1', ['sms', 'inapp']);
    ev.touchpoints = [tp('sms', 'a', 'error'), tp('inapp', 'b', 'deferred')] as any;
    expect(hasAudienceError([ev])).toBe(true);
  });
});

describe('computePlanHash — 결재 서류의 지문', () => {
  it('행사 순서가 달라도 같은 계획이면 같은 지문이다', () => {
    const a = [makeEvent('e1', ['sms']), makeEvent('e2', ['email'])];
    const b = [makeEvent('e2', ['email']), makeEvent('e1', ['sms'])];
    expect(computePlanHash(a)).toBe(computePlanHash(b));
  });

  it('행사가 늘면 다른 서류다 — 제출 뒤 담은 행사는 승인 대상이 아니다', () => {
    const base = [makeEvent('e1', ['sms'])];
    expect(computePlanHash([...base, makeEvent('e2', ['email'])])).not.toBe(computePlanHash(base));
  });

  it('ID가 그대로여도 혜택·기간·상품·채널·시점이 바뀌면 다른 서류다', () => {
    const base = makeEvent('e1', ['sms']);
    const h = computePlanHash([base]);
    expect(computePlanHash([{ ...base, benefitText: '첫 구매 사은품' }])).not.toBe(h);
    expect(computePlanHash([{ ...base, endsOn: '2026-09-20' }])).not.toBe(h);
    expect(computePlanHash([{ ...base, products: [{ name: '니트 가디건' }] }])).not.toBe(h);
    expect(computePlanHash([makeEvent('e1', ['email'])])).not.toBe(h);
    const retimed = makeEvent('e1', ['sms']);
    retimed.touchpoints = [{ ...retimed.touchpoints[0], timing: { anchor: 'end' } } as any];
    expect(computePlanHash([retimed])).not.toBe(h);
  });

  it('같은 계획을 다시 계산해도 지문이 흔들리지 않는다', () => {
    const ev = [makeEvent('e1', ['sms', 'email', 'dm'])];
    expect(computePlanHash(ev)).toBe(computePlanHash(ev));
    expect(computePlanHash(ev)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('월 축 — KST 기준', () => {
  it('currentPlanMonth는 YYYY-MM이다', () => {
    expect(currentPlanMonth(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09');
  });

  it('UTC 9월 1일 00:00은 KST로 이미 9월이다 — 9월 계획이 지난 달이 되지 않는다', () => {
    const utcMidnight = new Date('2026-09-01T00:00:00Z');
    expect(currentPlanMonth(utcMidnight)).toBe('2026-09');
    expect(isPastPlanMonth('2026-09', utcMidnight)).toBe(false);
  });

  it('UTC 8월 31일 15:30은 KST로 9월 1일 00:30이다 — 8월 계획은 그 순간부터 지난 달', () => {
    const kstNewMonth = new Date('2026-08-31T15:30:00Z');
    expect(currentPlanMonth(kstNewMonth)).toBe('2026-09');
    expect(isPastPlanMonth('2026-08', kstNewMonth)).toBe(true);
    expect(isPastPlanMonth('2026-10', kstNewMonth)).toBe(false);
  });
});

describe('대상 수 사유 문장 — 고객 언어', () => {
  it('인앱·알림톡은 수를 만들지 않고 이유를 말한다', () => {
    expect(channelAudienceNote('inapp')).toContain('방문 시점');
    expect(channelAudienceNote('alimtalk')).toContain('참여 신청자');
  });

  it('사유 문장에 내부 코드명·테이블명이 없다', () => {
    const all = (['sms', 'alimtalk', 'email', 'dm', 'inapp'] as const).map(channelAudienceNote).join(' ');
    expect(all).not.toMatch(/customers|callback_numbers|kakao_sender_profiles|cdp_events|SDK|MySQL|PG/);
  });
});

describe('결재 요청 문자 — 정보성', () => {
  const totals = computeBriefTotals([makeEvent('e1', ['sms', 'email'])]);
  const body = buildApprovalNoticeBody({ planMonth: '2026-09', totals, link: 'https://hanjul.ai/api/marketing-planner/approval/abc' });

  it('달·건수·합계·링크를 담고, 승인 전 미차감을 밝힌다', () => {
    expect(body).toContain('9월');
    expect(body).toContain('https://hanjul.ai/api/marketing-planner/approval/abc');
    expect(body).toContain('승인 전에는');
  });

  it('혜택·할인 표현을 만들지 않는다(AI 임의 혜택 금지 계열)', () => {
    expect(body).not.toMatch(/할인|쿠폰|무료|특가|%/);
  });
});

describe('결재 토큰', () => {
  it('추측 불가한 hex 48자이고 매번 다르다', () => {
    const a = generateApprovalToken();
    const b = generateApprovalToken();
    expect(a).toMatch(/^[a-f0-9]{48}$/);
    expect(a).not.toBe(b);
  });

  it('만료는 발급 시점 + TTL이다', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const exp = computeTokenExpiry(now);
    expect(exp.getTime() - now.getTime()).toBe(APPROVAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  });
});
