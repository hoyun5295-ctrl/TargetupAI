/**
 * marketing-planner.test.ts — 플래너 CT 계약 (★ 2026-08-12 Phase 1)
 *
 * 고정하는 계약:
 *  ① 시점 계산은 문자열 연산이다 — 타임존이 끼면 KST 자정 경계에서 발송일이 하루 밀린다.
 *  ② 예상 크레딧에서 문자·알림톡은 null(실행 시 별도)이다 — 0으로 내리면 "공짜"로 읽힌다.
 *  ③ 단가의 진실은 getCreditCost 하나다 — 이 테스트도 숫자를 하드코딩하지 않고 같은 소스로 대조한다.
 *  ④ 입력 검증은 사용자 문장으로 실패한다(추측 진입 차단 — 채널 화이트리스트·중복 시점·기간 역전).
 */
import { describe, it, expect } from 'vitest';
import {
  computeTouchpointDate,
  estimateChannelCredits,
  sumEstimatedCredits,
  parsePlannerEventInput,
  parsePlanMonth,
} from './marketing-planner';
import { getCreditCost } from './ai-credit-calc';

describe('computeTouchpointDate — 문자열 날짜 연산', () => {
  it('start/end 앵커는 행사 날짜 그대로', () => {
    expect(computeTouchpointDate({ anchor: 'start' }, '2026-09-10', '2026-09-14')).toBe('2026-09-10');
    expect(computeTouchpointDate({ anchor: 'end' }, '2026-09-10', '2026-09-14')).toBe('2026-09-14');
  });

  it('before_start는 시작일에서 offsetDays를 뺀다 — 월 경계·연 경계 통과', () => {
    expect(computeTouchpointDate({ anchor: 'before_start', offsetDays: 5 }, '2026-09-03', '2026-09-05')).toBe('2026-08-29');
    expect(computeTouchpointDate({ anchor: 'before_start', offsetDays: 3 }, '2027-01-02', '2027-01-10')).toBe('2026-12-30');
  });
});

describe('estimateChannelCredits — 단가는 getCreditCost와 같은 소스', () => {
  it('소재 채널 3종은 단가표 합성과 일치한다', () => {
    expect(estimateChannelCredits('email')).toBe(getCreditCost('email-campaign-complete'));
    expect(estimateChannelCredits('dm')).toBe(getCreditCost('dm-ai-generate') + getCreditCost('dm-builder'));
    expect(estimateChannelCredits('inapp')).toBe(getCreditCost('inapp-publish'));
  });

  it('문자·알림톡은 null — 실행 축 과금이라 0이 아니다', () => {
    expect(estimateChannelCredits('sms')).toBeNull();
    expect(estimateChannelCredits('alimtalk')).toBeNull();
  });

  it('합계는 null 채널을 건너뛴다', () => {
    const expected =
      getCreditCost('email-campaign-complete') +
      getCreditCost('dm-ai-generate') + getCreditCost('dm-builder') +
      getCreditCost('inapp-publish');
    expect(sumEstimatedCredits(['sms', 'alimtalk', 'email', 'dm', 'inapp'])).toBe(expected);
  });
});

describe('parsePlannerEventInput — 기입 검증', () => {
  const base = {
    title: '가을 신상 위크',
    startsOn: '2026-09-10',
    endsOn: '2026-09-14',
    benefitText: '',
    products: [{ name: '니트 가디건' }],
    touchpoints: [
      { channel: 'sms', timing: { anchor: 'start' } },
      { channel: 'email', timing: { anchor: 'before_start', offsetDays: 5 }, format: 'bromide' },
    ],
  };

  it('정상 입력 — plan_month는 시작일에서 파생한다', () => {
    const r = parsePlannerEventInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.planMonth).toBe('2026-09');
      expect(r.value.touchpoints).toHaveLength(2);
      expect(r.value.benefitText).toBeNull(); // 빈 문자열은 null — "혜택 없음"을 명시로
    }
  });

  it('기간 역전·채널 밖 값·중복 시점은 사용자 문장으로 거부한다', () => {
    expect(parsePlannerEventInput({ ...base, endsOn: '2026-09-01' })).toMatchObject({ ok: false });
    expect(parsePlannerEventInput({ ...base, touchpoints: [{ channel: 'fax', timing: { anchor: 'start' } }] }))
      .toMatchObject({ ok: false, error: '지원하지 않는 채널이 있습니다.' });
    expect(parsePlannerEventInput({
      ...base,
      touchpoints: [
        { channel: 'sms', timing: { anchor: 'start' } },
        { channel: 'sms', timing: { anchor: 'start' } },
      ],
    })).toMatchObject({ ok: false, error: '같은 채널의 같은 시점이 중복 선택됐습니다.' });
  });

  it('터치포인트 0개는 거부 — 채널 없는 행사는 플래너에 넣을 이유가 없다', () => {
    expect(parsePlannerEventInput({ ...base, touchpoints: [] })).toMatchObject({ ok: false });
  });

  /**
   * ★ 2026-08-25 접수 cmt80akay00yqjnot2cqk4bw3(임은지) — "한 채널에서 시작일·종료일·사전 안내를 함께 고르고 싶다".
   * 검증기는 처음부터 (채널·시점·오프셋·대상) 조합으로만 중복을 막았으므로 다중 시점은 원래 통과한다.
   * 막고 있던 것은 화면이었다(채널 하나에 접점 하나만 두고 시점을 덮어썼다).
   * 이 계약이 좁아지면 그 화면이 다시 못 쓰게 되므로 여기서 고정한다.
   */
  it('같은 채널의 다른 시점은 함께 담긴다 — 시작·종료·사전 안내 동시 선택', () => {
    const r = parsePlannerEventInput({
      ...base,
      touchpoints: [
        { channel: 'sms', timing: { anchor: 'start' } },
        { channel: 'sms', timing: { anchor: 'end' } },
        { channel: 'sms', timing: { anchor: 'before_start', offsetDays: 3 } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.touchpoints).toHaveLength(3);
      expect(r.value.touchpoints.map((t) => t.timing.anchor)).toEqual(['start', 'end', 'before_start']);
    }
  });

  it('사전 안내는 며칠 전인지가 다르면 다른 발송이다', () => {
    const r = parsePlannerEventInput({
      ...base,
      touchpoints: [
        { channel: 'email', timing: { anchor: 'before_start', offsetDays: 7 } },
        { channel: 'email', timing: { anchor: 'before_start', offsetDays: 1 } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.touchpoints).toHaveLength(2);
  });

  it('before_start의 offsetDays는 1~30만', () => {
    expect(parsePlannerEventInput({
      ...base,
      touchpoints: [{ channel: 'email', timing: { anchor: 'before_start', offsetDays: 45 } }],
    })).toMatchObject({ ok: false });
  });
});

describe('parsePlanMonth', () => {
  it('YYYY-MM만 통과 — 어긋나면 null(전체 조회로 안 떨어진다)', () => {
    expect(parsePlanMonth('2026-09')).toBe('2026-09');
    expect(parsePlanMonth('2026-9')).toBeNull();
    expect(parsePlanMonth('')).toBeNull();
    expect(parsePlanMonth(undefined)).toBeNull();
  });
});
