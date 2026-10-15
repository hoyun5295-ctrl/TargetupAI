// 탈퇴·거부 표시(is_opt_out) → 수신거부로 접기 (2026-10-15 엠티콜렉션 YN_WITHDRAW)
// 서버 sync 는 is_opt_out 을 받지 않는다(FIELD_MAP 21 컬럼 · Zod 도 지운다) — sms_opt_in=false 로 보내야
// 서버 reconcileSyncUnsubscribes 가 수신거부로 등록한다. 탈퇴 회원에게 광고 발송 = 정보통신망법.
import { describe, it, expect } from 'vitest';
import { normalizeCustomer } from './index';
import { validateCustomers } from '../types/customer';

describe('탈퇴·거부 표시 → 수신거부', () => {
  it('거부·탈퇴 값이면 sms_opt_in=false 로 접고 is_opt_out 은 보내지 않는다', () => {
    for (const v of ['Y', 'y', '1', 1, true, '탈퇴', '거부', '수신거부']) {
      const r = normalizeCustomer({ phone: '01000000050', sms_opt_in: 'Y', is_opt_out: v });
      expect(r.sms_opt_in).toBe(false);
      expect('is_opt_out' in r).toBe(false);
    }
  });

  it('아니오 값이면 수신동의를 그대로 둔다', () => {
    for (const v of ['N', 'n', '0', 0, false, '정상']) {
      const r = normalizeCustomer({ phone: '01000000051', sms_opt_in: 'Y', is_opt_out: v });
      expect(r.sms_opt_in).toBe(true);
      expect('is_opt_out' in r).toBe(false);
    }
  });

  it('빈 값·값 없음은 손대지 않는다 — 수신동의 미제공이면 미제공 그대로', () => {
    expect(normalizeCustomer({ phone: '01000000052', sms_opt_in: 'Y', is_opt_out: '' }).sms_opt_in).toBe(true);
    expect(normalizeCustomer({ phone: '01000000052', sms_opt_in: 'Y', is_opt_out: null }).sms_opt_in).toBe(true);
    expect('sms_opt_in' in normalizeCustomer({ phone: '01000000052', is_opt_out: 'N' })).toBe(false);
  });

  it('알아볼 수 없는 값(탈퇴일 등)은 수신거부로 접고 그 글자를 opt_out_unknown 에 남긴다', () => {
    const r = normalizeCustomer({ phone: '01000000053', sms_opt_in: 'Y', is_opt_out: '2026-09-01' });
    expect(r.sms_opt_in).toBe(false);
    expect(r.opt_out_unknown).toBe('2026-09-01');
    const d = normalizeCustomer({ phone: '01000000053', sms_opt_in: 'Y', is_opt_out: new Date('2026-09-01T00:00:00Z') });
    expect(d.sms_opt_in).toBe(false);
  });

  it('거부로 접으면 수신동의 미인식 표시는 지운다', () => {
    const r = normalizeCustomer({ phone: '01000000054', sms_opt_in: '??', is_opt_out: 'Y' });
    expect(r.sms_opt_in).toBe(false);
    expect('sms_opt_in_unknown' in r).toBe(false);
  });

  it('수신동의 칸 없이 탈퇴 표시만 있어도 거부로 보낸다', () => {
    expect(normalizeCustomer({ phone: '01000000055', is_opt_out: 'Y' }).sms_opt_in).toBe(false);
  });

  it('전송 직전 검증(Zod)을 지나도 거부는 남고 표시 키는 빠진다', () => {
    const r = normalizeCustomer({ phone: '01012345678', sms_opt_in: 'Y', is_opt_out: '2026-09-01' });
    const v = validateCustomers([r]);
    expect(v.valid).toHaveLength(1);
    expect(v.valid[0].sms_opt_in).toBe(false);
    expect('opt_out_unknown' in (v.valid[0] as Record<string, unknown>)).toBe(false);
    expect('is_opt_out' in (v.valid[0] as Record<string, unknown>)).toBe(false);
  });
});
