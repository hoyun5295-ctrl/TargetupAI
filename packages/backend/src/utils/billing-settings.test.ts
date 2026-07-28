/**
 * 계산서 날짜 산식 계약 테스트 (2026-07-28)
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §1-1·§5.
 * 작성일자·자동발급 기한은 돈에 닿는 계산이라 순수 함수 + 계약 테스트로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { computeTaxbillIssueDate, computeTaxbillDueAt, normalizeBizNumber, upsertBillingContact } from './billing-settings';

describe('computeTaxbillIssueDate — 작성일자 정책', () => {
  it('말일 정책 = 대상월 말일 (31일 달)', () => {
    expect(computeTaxbillIssueDate('last_day', '2026-07-31')).toBe('2026-07-31');
    // 기간 종료일이 월 중간이어도 "그 달의 말일"이다 — 중간 정산이 아니라 정책이 날짜를 정한다.
    expect(computeTaxbillIssueDate('last_day', '2026-07-26')).toBe('2026-07-31');
  });

  it('말일 정책 = 30일 달이면 30일, 2월이면 28/29일', () => {
    expect(computeTaxbillIssueDate('last_day', '2026-06-15')).toBe('2026-06-30');
    expect(computeTaxbillIssueDate('last_day', '2026-02-10')).toBe('2026-02-28');
    expect(computeTaxbillIssueDate('last_day', '2028-02-10')).toBe('2028-02-29'); // 윤년
  });

  it('익월 1일 정책 — 12월이면 익년 1월 1일', () => {
    expect(computeTaxbillIssueDate('first_day', '2026-07-31')).toBe('2026-08-01');
    expect(computeTaxbillIssueDate('first_day', '2026-12-05')).toBe('2027-01-01');
  });

  it('직접선택은 null — 사람이 지정할 때까지 작성일자가 없다', () => {
    expect(computeTaxbillIssueDate('manual', '2026-07-31')).toBeNull();
  });

  it('형식이 깨진 종료일은 throw — 조용히 이상한 날짜를 만들지 않는다', () => {
    expect(() => computeTaxbillIssueDate('last_day', '2026-7-1')).toThrow();
    expect(() => computeTaxbillIssueDate('first_day', '')).toThrow();
  });
});

describe('computeTaxbillDueAt — 자동발급 시각 = min(발송+3일, 익월 10일 00:00 KST)', () => {
  const KST = 9 * 60 * 60 * 1000;

  // ★ 2026-07-28 Harold 지시 — 발송 "시각"이 아니라 발송 "날짜"로 자른다.
  //   5일에 보냈으면 보낸 날을 1일로 쳐서 5·6·7일 사흘, 마감은 8일 아침 9시.
  it('발송일 기준 3일 뒤 09:00 KST — 5일 발송이면 8일 09시', () => {
    const sent = Date.UTC(2026, 7, 5, 1, 0, 0); // 8/5 10:00 KST
    const due = computeTaxbillDueAt(sent, '2026-07-31');
    expect(due.getTime()).toBe(Date.UTC(2026, 7, 8, 0, 0, 0)); // 8/8 00:00 UTC = 8/8 09:00 KST
  });

  it('같은 날이면 몇 시에 보냈든 마감이 같다 — 밤 11시 발송도 아침 발송과 동일', () => {
    const morning = Date.UTC(2026, 7, 5, 0, 30, 0);  // 8/5 09:30 KST
    const night   = Date.UTC(2026, 7, 5, 14, 50, 0); // 8/5 23:50 KST
    expect(computeTaxbillDueAt(morning, '2026-07-31').getTime())
      .toBe(computeTaxbillDueAt(night, '2026-07-31').getTime());
  });

  it('KST 날짜로 자른다 — UTC로 자르면 날이 밀린다(8/5 23:50 KST는 UTC로 8/5 14:50)', () => {
    const lateKst = Date.UTC(2026, 7, 5, 16, 0, 0); // 8/6 01:00 KST — KST로는 이미 6일
    const due = computeTaxbillDueAt(lateKst, '2026-07-31');
    expect(due.getTime()).toBe(Date.UTC(2026, 7, 9, 0, 0, 0)); // 8/9 09:00 KST
  });

  it('늦은 정산(8/8 발송): +3일이 8/10을 넘으므로 8/10 00:00 KST로 캡', () => {
    const sent = Date.UTC(2026, 7, 8, 12, 0, 0);
    const due = computeTaxbillDueAt(sent, '2026-07-31');
    expect(due.getTime()).toBe(Date.UTC(2026, 7, 10, 0, 0, 0) - KST);
  });

  it('12월분의 캡은 익년 1/10 00:00 KST', () => {
    const sent = Date.UTC(2027, 0, 9, 0, 0, 0);
    const due = computeTaxbillDueAt(sent, '2026-12-31');
    expect(due.getTime()).toBe(Date.UTC(2027, 0, 10, 0, 0, 0) - KST);
  });
});

// ═══════════════════════════════════════════════════════════
// 사업자 보존/지움 계약 (2026-07-28 — 적대적 검토에서 나온 데이터 유실 구멍)
// ═══════════════════════════════════════════════════════════

describe('normalizeBizNumber — 사업자등록번호 형식', () => {
  it('숫자 10자리는 000-00-00000으로 통일한다', () => {
    expect(normalizeBizNumber('1234567890')).toBe('123-45-67890');
    expect(normalizeBizNumber('123-45-67890')).toBe('123-45-67890');
    expect(normalizeBizNumber(' 123 45 67890 ')).toBe('123-45-67890');
  });

  it('비어 있으면 null — 미등록은 오류가 아니다', () => {
    expect(normalizeBizNumber('')).toBeNull();
    expect(normalizeBizNumber(undefined)).toBeNull();
    expect(normalizeBizNumber(null)).toBeNull();
  });

  it('10자리가 아니면 throw — 팝빌이 거부할 값을 저장하지 않는다', () => {
    expect(() => normalizeBizNumber('123-45-6789')).toThrow();
    expect(() => normalizeBizNumber('12345678901')).toThrow();
  });
});

describe('upsertBillingContact — 사업자 미전송이면 보존, 빈 값이면 지움', () => {
  /** 파라미터만 붙잡는 스텁. 마지막 인자가 "사업자 필드가 페이로드에 있었는가" 플래그다. */
  const stub = () => {
    const calls: any[] = [];
    return { db: { query: async (_sql: string, params: any[]) => { calls.push(params); return { rows: [] }; } }, calls };
  };
  const CID = '11111111-1111-1111-1111-111111111111';
  const UID = '22222222-2222-2222-2222-222222222222';

  it('회사 레벨 — 담당자만 보내면 보존 플래그 false', async () => {
    const { db, calls } = stub();
    await upsertBillingContact(db, CID, { userId: null, contactName: '홍길동', contactEmail: 'a@b.com' });
    expect(calls[0][calls[0].length - 1]).toBe(false);
  });

  it('회사 레벨 — 빈 문자열로 보내면 지움이므로 플래그 true', async () => {
    const { db, calls } = stub();
    await upsertBillingContact(db, CID, {
      userId: null, contactName: '홍길동', contactEmail: 'a@b.com',
      taxbillBizNumber: '', taxbillCompanyName: '', taxbillCeoName: '',
      taxbillAddress: '', taxbillBizType: '', taxbillBizItem: '',
    });
    expect(calls[0][calls[0].length - 1]).toBe(true);
    expect(calls[0][3]).toBeNull(); // 사업자번호 = NULL로 지움
  });

  it('회사 레벨 — 한 필드만 와도 묶음으로 판단해 true (부분 병합 금지)', async () => {
    const { db, calls } = stub();
    await upsertBillingContact(db, CID, { userId: null, taxbillCompanyName: '주식회사 한줄로' });
    expect(calls[0][calls[0].length - 1]).toBe(true);
  });

  it('계정 레벨도 같은 규칙 — 미전송이면 보존', async () => {
    const { db, calls } = stub();
    await upsertBillingContact(db, CID, { userId: UID, contactName: '담당', contactEmail: 'c@d.com' });
    expect(calls[0][calls[0].length - 1]).toBe(false);
    expect(calls[0][calls[0].length - 2]).toBe(UID);
  });

  it('사업자번호가 10자리가 아니면 던진다 — 쿼리를 아예 실행하지 않는다', async () => {
    const { db, calls } = stub();
    await expect(
      upsertBillingContact(db, CID, { userId: null, taxbillBizNumber: '123-45-678' }),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
