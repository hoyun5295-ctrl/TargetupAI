/**
 * ★ 2026-10-18 플래너 한 줄 읽기(utils/planner-line-read.ts · 설계서 docs/2026-10-18-planner-v2-design.md §3-6)
 * 받는 사람 구획을 먼저 잘라내고 · 기간은 범위 하나만 · 지난 기간 = 칩 0 + 사유 · 받는 사람 = 셋 중 하나(넓히지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { linePeriodRange, readPlannerLine } from '../planner-line-read';

// KST 2026-10-18 12:00
const NOW = Date.parse('2026-10-18T03:00:00Z');

describe('readPlannerLine — Harold 예시', () => {
  const r = readPlannerLine('10월10일~10월15일 기초 1+1 행사 진행할거야 타겟은 기초제품구매했던 모두야', NOW);
  it('지난 기간 = 칩 0 + 사유(내년으로 올리지 않는다)', () => {
    expect(r.period).toBeNull();
    expect(r.periodNote).toBe('이미 지난 기간이에요. 날짜를 골라 주세요');
  });
  it('행사명 · 혜택 · 상품 낱말 = 대상 말이 섞이지 않는다', () => {
    expect(r.title).toBe('기초 1+1 행사');
    expect(r.benefit).toBe('1+1');
    expect(r.productTerms).toContain('기초');
    expect(r.productTerms.some((w) => /타겟|구매|모두/.test(w))).toBe(false);
  });
  it('받는 사람 = 「기초」를 산 고객 + 「모두」는 기록 전체 제안', () => {
    expect(r.audience).toEqual({ kind: 'product_buyers', terms: ['기초'], allTime: true });
  });
});

describe('readPlannerLine — 받는 사람 셋 갈래', () => {
  it('조건 없는 전체 요청 = 전체', () => {
    expect(readPlannerLine('11월 1일~7일 가을 세일 대상은 전체 고객', NOW).audience).toEqual({ kind: 'all' });
  });
  it('「모두」가 들었어도 조건이 있으면 전체로 넓히지 않는다', () => {
    expect(readPlannerLine('가을 세일 대상은 VIP 모두', NOW).audience).toEqual({ kind: 'unread', raw: 'VIP 모두' });
  });
  it('부정 = 사람이 고른다(정반대 명단 금지)', () => {
    expect(readPlannerLine('가을 세일 대상은 기초 안 산 고객', NOW).audience?.kind).toBe('unread');
    // ★ Codex B 1R — 「안 구매한」 · 1글자 · 기간 말이 남으면 구매자로 만들지 않는다
    expect(readPlannerLine('가을 세일 타겟은 기초를 안 구매한 고객 모두', NOW).audience?.kind).toBe('unread');
    expect(readPlannerLine('가을 세일 타겟은 기초 못 산 고객', NOW).audience?.kind).toBe('unread');
    expect(readPlannerLine('가을 세일 타겟은 최근 3개월 기초 구매 고객', NOW).audience?.kind).toBe('unread');
    expect(readPlannerLine('가을 세일 대상은 기초 구매자 빼고 전부', NOW).audience?.kind).toBe('unread');
  });
  it('「고객에게」 꼴도 읽는다 · 「친구에게」는 대상이 아니다', () => {
    expect(readPlannerLine('크림 구매한 고객에게 11월 1일~3일 감사 세일', NOW).audience).toEqual({ kind: 'product_buyers', terms: ['크림'], allTime: false });
    expect(readPlannerLine('친구에게 선물하기 좋은 11월 세일', NOW).audience).toBeNull();
  });
});

describe('linePeriodRange', () => {
  it('허용 꼴 · 끝 월 생략 · 부터까지', () => {
    expect(linePeriodRange('11월 1일~7일 세일', NOW).period).toEqual({ startsOn: '2026-11-01', endsOn: '2026-11-07' });
    expect(linePeriodRange('11월1일부터 11월10일까지', NOW).period).toEqual({ startsOn: '2026-11-01', endsOn: '2026-11-10' });
    expect(linePeriodRange('2026.11.20~2026.11.30 블프', NOW).period).toEqual({ startsOn: '2026-11-20', endsOn: '2026-11-30' });
  });
  it('12월 → 1월 = 끝만 다음 해 · 연말에 적은 1~3월 = 내년', () => {
    expect(linePeriodRange('12월28일~1월3일', NOW).period).toEqual({ startsOn: '2026-12-28', endsOn: '2027-01-03' });
    expect(linePeriodRange('1월 5일~10일 새해 세일', NOW).period).toEqual({ startsOn: '2027-01-05', endsOn: '2027-01-10' });
  });
  it('숫자만 쓴 꼴 · 범위 둘 · 기한 낱말 = 읽지 않는다', () => {
    expect(linePeriodRange('10.20~10.25 세일', NOW).period).toBeNull();
    expect(linePeriodRange('11월1일~3일 · 11월10일~12일', NOW).period).toBeNull();
    expect(linePeriodRange('11월1일~3일 배송', NOW).period).toBeNull();
  });
});

describe('readPlannerLine — 채널 말', () => {
  it('문자 · DM · 메일만 읽고 못 보내는 채널은 따로', () => {
    const r = readPlannerLine('세일 문자랑 DM으로, 카톡도', NOW);
    expect(r.channels).toEqual(['sms', 'dm']);
    expect(r.unsupported).toEqual(['알림톡']);
  });
});
