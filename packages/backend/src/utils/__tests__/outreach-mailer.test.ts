/**
 * outreach-mailer.test.ts — 자사 수신함 목록 파싱 계약 (2026-09-03 · Harold "suran·ceo가 먼저 받아보게")
 *
 * 고정하는 것: OUTREACH_MAIL_TO는 쉼표 목록이다 · 형식 불량은 버린다 · 대소문자 무시 중복 제거 · 순서 보존 · 전부 비면 기본값 1명.
 */
import { describe, it, expect } from 'vitest';
import { parseOutreachMailTo } from '../outreach-mailer';

describe('parseOutreachMailTo', () => {
  it('쉼표·세미콜론·공백 구분 · 공백 제거 · 순서 보존', () => {
    expect(parseOutreachMailTo(' suran@invitocorp.com , ceo@invitocorp.com;a@b.co ')).toEqual([
      'suran@invitocorp.com', 'ceo@invitocorp.com', 'a@b.co',
    ]);
  });
  it('형식 불량은 버리고 대소문자 무시로 중복을 제거한다', () => {
    expect(parseOutreachMailTo('CEO@invitocorp.com, ceo@invitocorp.com, not-an-email, @x.com, y@')).toEqual(['CEO@invitocorp.com']);
  });
  it('전부 비면 기본값 1명', () => {
    expect(parseOutreachMailTo('', 'mobile@invitocorp.com')).toEqual(['mobile@invitocorp.com']);
    expect(parseOutreachMailTo(undefined, 'mobile@invitocorp.com')).toEqual(['mobile@invitocorp.com']);
    expect(parseOutreachMailTo('garbage', 'mobile@invitocorp.com')).toEqual(['mobile@invitocorp.com']);
  });
});
