/**
 * billing-label-month.test.ts — 정산월(라벨) 파생 CT (★ 2026-08-20 신설 — 서수란 0819 접수)
 *
 * 기원: 정산 한 건이 "몇 월분인가"를 시스템이 두 곳에서 따로 추측했다 — 정산 자신은 시작일의 역월,
 * 추가 청구 항목은 역월과 발행기간의 겹침. 역월 정산에서는 늘 같은 답이라 숨어 있다가
 * 중간정산(7/16~8/15)에서 갈렸다: 장은 "7월"이라 불리는데 8월 기준으로 입력한 부가서비스가 실린다.
 *
 * 이 파일이 못 박는 것:
 *   1. 정산월은 **사람이 정하는 값**이고, 기본값은 종료일의 역월이다.
 *   2. 허용 집합은 정산 기간에 걸친 역월뿐 — 밖이면 422 (이름이라도 기간 밖 달을 달 수 없다).
 *   3. 파생은 'YYYY-MM-DD' 문자열 절단으로만 한다 — Date 파싱이 없어서 서버 TZ와 무관하다
 *      (옛 `new Date(billing_start).getMonth()`는 음수 오프셋 TZ에서 1일 시작이 전월로 밀렸다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBillingLabelMonth, BillingIssueError } from './billing-issue';

describe('resolveBillingLabelMonth — 기본값 = 종료일의 역월', () => {
  it('역월 정산(1일~말일)은 그 달', () => {
    expect(resolveBillingLabelMonth(null, '2026-07-01', '2026-07-31')).toEqual({ year: 2026, month: 7 });
  });

  it('분할 발행(같은 달 안 부분 기간)도 그 달', () => {
    expect(resolveBillingLabelMonth(null, '2026-07-16', '2026-07-31')).toEqual({ year: 2026, month: 7 });
    expect(resolveBillingLabelMonth(null, '2026-07-01', '2026-07-15')).toEqual({ year: 2026, month: 7 });
  });

  it('중간정산(두 역월에 걸침)은 종료월 — 접수의 기대 동작', () => {
    expect(resolveBillingLabelMonth(null, '2026-07-16', '2026-08-15')).toEqual({ year: 2026, month: 8 });
  });

  it('연 경계를 넘는 중간정산은 다음 해 1월', () => {
    expect(resolveBillingLabelMonth(null, '2026-12-16', '2027-01-15')).toEqual({ year: 2027, month: 1 });
  });

  it('미지정은 null·undefined·빈 문자열 모두 기본값', () => {
    expect(resolveBillingLabelMonth(undefined, '2026-07-16', '2026-08-15')).toEqual({ year: 2026, month: 8 });
    expect(resolveBillingLabelMonth('', '2026-07-16', '2026-08-15')).toEqual({ year: 2026, month: 8 });
  });

  it('1일 시작을 전월로 밀지 않는다 — 문자열 절단이라 TZ 무관 (옛 Date 파싱의 잠복 결함 자리)', () => {
    expect(resolveBillingLabelMonth(null, '2026-08-01', '2026-08-31')).toEqual({ year: 2026, month: 8 });
  });
});

describe('resolveBillingLabelMonth — 명시 선택은 기간에 걸친 역월만', () => {
  it('중간정산에서 시작월을 고를 수 있다', () => {
    expect(resolveBillingLabelMonth('2026-07', '2026-07-16', '2026-08-15')).toEqual({ year: 2026, month: 7 });
  });

  it('중간정산에서 종료월을 고를 수 있다', () => {
    expect(resolveBillingLabelMonth('2026-08', '2026-07-16', '2026-08-15')).toEqual({ year: 2026, month: 8 });
  });

  it('세 역월에 걸친 기간이면 가운데 달도 허용', () => {
    expect(resolveBillingLabelMonth('2026-07', '2026-06-20', '2026-08-10')).toEqual({ year: 2026, month: 7 });
  });

  it('연 경계 기간에서 앞 해 12월을 고를 수 있다', () => {
    expect(resolveBillingLabelMonth('2026-12', '2026-12-16', '2027-01-15')).toEqual({ year: 2026, month: 12 });
  });

  it('기간 밖 달은 422 BILLING_LABEL_MONTH_INVALID', () => {
    for (const bad of ['2026-06', '2026-09', '2025-07', '2027-08']) {
      try {
        resolveBillingLabelMonth(bad, '2026-07-16', '2026-08-15');
        expect.unreachable(`기간 밖 정산월이 통과했다: ${bad}`);
      } catch (e: any) {
        expect(e).toBeInstanceOf(BillingIssueError);
        expect(e.status).toBe(422);
        expect(e.body.code).toBe('BILLING_LABEL_MONTH_INVALID');
      }
    }
  });

  it('형식이 YYYY-MM이 아니면 422 — 오타 하나로 청구서가 엉뚱한 이름을 달지 않는다', () => {
    for (const bad of ['2026-8', '2026/08', '202608', '2026-08-01', 'garbage', '2026-00', '2026-13']) {
      try {
        resolveBillingLabelMonth(bad, '2026-07-16', '2026-08-15');
        expect.unreachable(`형식 무효 정산월이 통과했다: ${bad}`);
      } catch (e: any) {
        expect(e).toBeInstanceOf(BillingIssueError);
        expect(e.status).toBe(422);
        expect(e.body.code).toBe('BILLING_LABEL_MONTH_INVALID');
      }
    }
  });
});

/**
 * ★ 2026-08-20 재오픈 정정(서수란 실측 — 7월분이 "8월 정산"에 합산) — 추가 청구 항목의 귀속 축은
 * 기간 겹침이 아니라 **청구월 = 정산월**이다. 중간정산(7/16~8/15)은 두 역월과 겹치므로 겹침 선택은
 * 남의 달 항목까지 쓸어 담는다. 소스 스캔으로 SQL 축 자체를 계약으로 고정한다(라우트 불변식 선례).
 */
describe('추가 청구 항목 선택 SQL — 귀속 축 = 청구월 = 정산월 (소스 스캔 계약)', () => {
  const src = readFileSync(resolve(__dirname, 'billing-issue.ts'), 'utf8');

  it('겹침 판정(period_month + INTERVAL 상한)이 선택 SQL에 남아 있지 않다', () => {
    expect(src).not.toMatch(/period_month \+ INTERVAL '1 month'/);
  });

  it('선택 조건은 정산월 1일과의 등치다 — 발행 코어·최소과금 두 곳 모두', () => {
    const matches = src.match(/e\.period_month = \$\d+::date/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
