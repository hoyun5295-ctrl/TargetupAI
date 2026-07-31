import { describe, it, expect } from 'vitest';
import { pickRecipients, isRecipientRejected, type BillingRecipientRow } from './billing-recipients';

/**
 * ★ 2026-07-31 정산 수신자 해석 계약.
 *
 * 이 축이 틀리면 청구서가 엉뚱한 사람에게 가거나, 받아야 할 사람이 못 받은 채
 * 3일 자동발급 타이머만 돈다. 그래서 순수 함수로 뽑아 계약을 고정한다.
 */
const row = (p: Partial<BillingRecipientRow>): BillingRecipientRow => ({
  id: p.id || Math.random().toString(36).slice(2),
  user_id: p.user_id ?? null,
  doc_type: p.doc_type || 'statement',
  email: p.email || 'a@b.com',
  name: p.name ?? null,
  is_primary: p.is_primary ?? false,
  is_active: p.is_active ?? true,
});

describe('pickRecipients — 수신자 해석 (2026-07-31)', () => {
  it('계정 행이 있으면 계정 행만 쓴다 — 회사 레벨과 섞지 않는다', () => {
    const rows = [
      row({ id: 'c1', user_id: null, email: 'company@x.com', is_primary: true }),
      row({ id: 'u1', user_id: 'U', email: 'user@x.com', is_primary: true }),
    ];
    const r = pickRecipients(rows, 'U', 'statement');
    expect(r.primary?.email).toBe('user@x.com');
    expect(r.cc).toEqual([]);
  });

  it('계정 행이 없으면 회사 레벨로 폴백한다 — 계정 장도 발송이 끊기지 않는다', () => {
    const rows = [row({ id: 'c1', user_id: null, email: 'company@x.com', is_primary: true })];
    expect(pickRecipients(rows, 'U', 'statement').primary?.email).toBe('company@x.com');
  });

  it('대표가 to, 나머지가 cc — 참조는 사본으로 함께 나간다', () => {
    const rows = [
      row({ id: 'a', user_id: null, email: 'boss@x.com', is_primary: true }),
      row({ id: 'b', user_id: null, email: 'acct@x.com' }),
      row({ id: 'c', user_id: null, email: 'team@x.com' }),
    ];
    const r = pickRecipients(rows, null, 'statement');
    expect(r.primary?.email).toBe('boss@x.com');
    expect(r.cc.sort()).toEqual(['acct@x.com', 'team@x.com']);
  });

  it('유형이 다르면 서로 섞이지 않는다 — 거래내역서와 세금계산서는 다른 사람이 받을 수 있다', () => {
    const rows = [
      row({ id: 's', user_id: null, doc_type: 'statement', email: 'stmt@x.com', is_primary: true }),
      row({ id: 't', user_id: null, doc_type: 'taxbill', email: 'tax@x.com', is_primary: true }),
    ];
    expect(pickRecipients(rows, null, 'statement').primary?.email).toBe('stmt@x.com');
    expect(pickRecipients(rows, null, 'taxbill').primary?.email).toBe('tax@x.com');
    expect(pickRecipients(rows, null, 'taxbill').cc).toEqual([]);
  });

  it('비활성 행은 대표든 참조든 빠진다', () => {
    const rows = [
      row({ id: 'a', user_id: null, email: 'off@x.com', is_primary: true, is_active: false }),
      row({ id: 'b', user_id: null, email: 'on@x.com' }),
    ];
    const r = pickRecipients(rows, null, 'statement');
    expect(r.primary?.email).toBe('on@x.com');
    expect(r.cc).toEqual([]);
  });

  it('수신자가 없으면 primary가 null — 그 장은 발송에서 빠지는 정상 경로다', () => {
    expect(pickRecipients([], null, 'statement').primary).toBeNull();
  });
});

describe('isRecipientRejected — 부분 거부 판정 (2026-07-31)', () => {
  it('받아야 할 주소가 rejected에 있으면 거부다 — 참조만 수락된 발송을 성공으로 세지 않는다', () => {
    expect(isRecipientRejected({ accepted: ['cc@x.com'], rejected: ['boss@x.com'] }, 'boss@x.com')).toBe(true);
  });

  it('참조만 거부된 건 발송 실패가 아니다', () => {
    expect(isRecipientRejected({ accepted: ['boss@x.com'], rejected: ['cc@x.com'] }, 'boss@x.com')).toBe(false);
  });

  it('대소문자·꺾쇠 표기가 달라도 같은 주소로 본다', () => {
    expect(isRecipientRejected({ rejected: ['<BOSS@X.com>'] }, 'boss@x.com')).toBe(true);
  });

  it('rejected가 없거나 형식이 달라도 터지지 않는다', () => {
    expect(isRecipientRejected({}, 'boss@x.com')).toBe(false);
    expect(isRecipientRejected(null, 'boss@x.com')).toBe(false);
    expect(isRecipientRejected({ rejected: 'boss@x.com' }, 'boss@x.com')).toBe(false);
  });

  it('대상 주소가 비면 거부로 보지 않는다 — 빈 값으로 전건 실패시키지 않는다', () => {
    expect(isRecipientRejected({ rejected: ['x@y.com'] }, '')).toBe(false);
  });
});
