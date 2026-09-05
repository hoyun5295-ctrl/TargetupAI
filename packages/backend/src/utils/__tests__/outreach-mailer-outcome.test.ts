/**
 * outreach-mailer-outcome.test.ts — 수신자 판정·검수 허용 도메인 계약 (2026-09-05 · 설계서 B-11·B-15)
 * 고정하는 것: 포함 관계 주소(a@b.co / xa@b.co)를 구분한다 · 꺾쇠 형식 정규화 · 전원 거부 = rejected · 1명 이상 도착 = sent ·
 * 검수 수신 주소는 허용 도메인 정확 일치(서브도메인·대소문자·목록 밖 거절).
 */
import { describe, it, expect } from 'vitest';
import { matchAddress, decideMailOutcome, isAllowedTestRecipient, parseTestMailDomains } from '../outreach-mailer';

describe('matchAddress', () => {
  it('정확 일치만(포함 관계 구분) · 꺾쇠·대소문자 정규화', () => {
    expect(matchAddress(['xa@b.co'], 'a@b.co')).toBe(false);
    expect(matchAddress(['a@b.co'], 'a@b.co')).toBe(true);
    expect(matchAddress(['이름 <A@B.co>'], 'a@b.co')).toBe(true);
    expect(matchAddress('a@b.co', 'a@b.co')).toBe(false); // 배열이 아니면 false
    expect(matchAddress(['a@b.co'], '')).toBe(false);
  });
});

describe('decideMailOutcome', () => {
  const to = ['suran@invitocorp.com', 'ceo@invitocorp.com'];
  it('전원 거부 = rejected', () => {
    expect(decideMailOutcome({ rejected: to, accepted: [] }, to).outcome).toBe('rejected');
  });
  it('1명 이상 도착 = sent(거부 목록 동반)', () => {
    const r = decideMailOutcome({ rejected: ['ceo@invitocorp.com'], accepted: ['suran@invitocorp.com'] }, to);
    expect(r.outcome).toBe('sent');
    expect(r.accepted).toEqual(['suran@invitocorp.com']);
    expect(r.rejected).toEqual(['ceo@invitocorp.com']);
  });
  it('accepted에도 rejected에도 없음 = unknown(성공으로 접지 않는다)', () => {
    expect(decideMailOutcome({ accepted: ['someone@else.com'], rejected: [] }, to).outcome).toBe('unknown');
    expect(decideMailOutcome({}, to).outcome).toBe('unknown');
  });
});

describe('검수 허용 도메인', () => {
  it('parseTestMailDomains — 소문자 · @ 제거 · 형식 불량 제거 · 빈 값 기본', () => {
    expect(parseTestMailDomains('Invitocorp.com, @hanjul.ai;bad')).toEqual(['invitocorp.com', 'hanjul.ai']);
    expect(parseTestMailDomains('')).toEqual(['invitocorp.com']);
  });
  it('isAllowedTestRecipient — 정확 일치 · 서브도메인 불허 · 목록 밖 거절 · 형식 검사', () => {
    const d = ['invitocorp.com'];
    expect(isAllowedTestRecipient('suran@invitocorp.com', d)).toBe(true);
    expect(isAllowedTestRecipient('SURAN@INVITOCORP.COM', d)).toBe(true);
    expect(isAllowedTestRecipient('x@mail.invitocorp.com', d)).toBe(false);
    expect(isAllowedTestRecipient('x@gmail.com', d)).toBe(false);
    expect(isAllowedTestRecipient('not-an-email', d)).toBe(false);
    expect(isAllowedTestRecipient('x@invitocorp.com.evil.com', d)).toBe(false);
  });
});
