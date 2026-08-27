/**
 * 허용 대역 CIDR 검증 계약 (★2026-08-27 전송자격인증 2.2)
 *
 * 왜 있나
 *   화면에서 `115.138.27.202/0`을 넣었더니 "국내 대역 등록 실패"만 떴다. 정규식은 통과했는데
 *   PG `cidr`가 INSERT에서 거부해 트랜잭션이 롤백됐고, **어느 값이 왜 틀렸는지 화면에 남지 않았다.**
 *   검증이 PG보다 느슨하면 실패가 진단 불가능해진다.
 *
 * 못 박는 것
 *   1. 마스크 오른쪽에 비트가 남은 값은 **DELETE 전에** 거부하고, 고쳐 넣을 값을 알려준다.
 *   2. 옥텟 255 초과·프리픽스 범위 초과를 거부한다(옛 정규식은 통과시켰다).
 *   3. 정상 국내 대역과 단일 IP(/32)는 통과한다.
 *   4. IPv6는 형식·프리픽스 범위만 본다(호스트 비트 계산을 다시 구현하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { validateCidrToken, isInvalidCidrError } from '../geo-access';

const reasonOf = (v: string) => {
  const r = validateCidrToken(v);
  return r.ok ? null : r.reason;
};

describe('통과해야 하는 값', () => {
  it.each([
    '211.234.0.0/16',
    '1.201.0.0/16',
    '14.32.0.0/15',
    '115.138.0.0/16',
    '115.138.27.202/32', // 단일 IP
    '0.0.0.0/0',         // 전체 (프리픽스 0에서 유일하게 유효한 값)
    '2001:db8::/32',
  ])('%s', (v) => {
    expect(validateCidrToken(v).ok).toBe(true);
  });
});

describe('마스크 오른쪽 비트가 남은 값 — 화면에서 실제로 터진 형태', () => {
  it('115.138.27.202/0 은 거부하고 고쳐 넣을 값을 알려준다', () => {
    const r = validateCidrToken('115.138.27.202/0');
    expect(r.ok).toBe(false);
    expect(reasonOf('115.138.27.202/0')).toContain('0.0.0.0/0');
    expect(reasonOf('115.138.27.202/0')).toContain('115.138.27.202/32');
  });

  it('115.138.27.202/16 은 속한 네트워크(115.138.0.0/16)를 알려준다', () => {
    expect(reasonOf('115.138.27.202/16')).toContain('115.138.0.0/16');
  });

  it('192.168.1.1/24 는 192.168.1.0/24 를 알려준다', () => {
    expect(reasonOf('192.168.1.1/24')).toContain('192.168.1.0/24');
  });
});

describe('옛 정규식이 통과시키던 값 — 이제 막힌다', () => {
  it.each([
    ['999.1.1.0/24', '255'],
    ['10.0.0.0/33', '0~32'],
    ['2001:db8::/129', '0~128'],
  ])('%s', (v, hint) => {
    const r = validateCidrToken(v);
    expect(r.ok).toBe(false);
    expect(reasonOf(v)).toContain(hint);
  });
});

describe('형식 자체가 아닌 값', () => {
  it('프리픽스가 없으면 /32 를 안내한다', () => {
    expect(reasonOf('115.138.27.202')).toContain('/32');
  });

  it('IP가 아니면 거부한다', () => {
    expect(validateCidrToken('hello/24').ok).toBe(false);
  });

  it('빈 값은 거부한다', () => {
    expect(validateCidrToken('').ok).toBe(false);
  });
});

describe('PG cidr 거부 판정 — 500 대신 400으로 흘리기 위한 것', () => {
  it('PG의 invalid cidr 메시지를 알아본다', () => {
    expect(isInvalidCidrError(new Error('invalid cidr value: "115.138.27.202/0"'))).toBe(true);
    expect(isInvalidCidrError(new Error('invalid input syntax for type cidr: "x"'))).toBe(true);
  });

  it('그 밖의 오류를 cidr 오류로 오인하지 않는다', () => {
    expect(isInvalidCidrError(new Error('connection terminated'))).toBe(false);
  });
});
