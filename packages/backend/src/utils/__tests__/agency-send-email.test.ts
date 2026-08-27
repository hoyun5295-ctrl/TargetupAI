/**
 * 대행발송 이메일 접수 · 허용 발신자 CT 계약 (★2026-08-27 §18-13 · 서수란 접수 cmtb5y3pv02qwjnotttqxen6a)
 *
 *   ① 발신 주소 정규화 = 주소만 추출 + lower. plus-tag 보존(접으면 위조 방향으로만 넓어진다)
 *   ② 청구 계정 지정 대조 = 표시명 또는 로그인 ID **정확 일치**(정규화 후)만.
 *      부분 일치·유사 일치 없음 — 돈 귀속에서 "비슷해서 골랐다"는 오귀속 사고다.
 *   ③ 일치 0 = not_found · 일치 2+ = ambiguous(자동 선택 없음 · 반려)
 *   ④ 회신 안내 목록 = "표시명 (로그인ID)" · 표시명 없으면 로그인 ID
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSenderEmail, normalizeBillingTargetKey, matchBillingTarget, describeBillingTargets,
  senderKeyClash, type SenderCandidate,
} from '../agency-send-email';

const cand = (over: Partial<SenderCandidate>): SenderCandidate => ({
  senderId: 's1', companyId: 'c1', userId: 'u1', label: null, loginId: 'login1', userName: null, ...over,
});

describe('허용 발신자 — 주소 정규화', () => {
  it('표시명 붙은 형태에서 주소만 추출하고 lower로 접는다. plus-tag는 보존한다', () => {
    expect(normalizeSenderEmail('"안지현" <JiHyun+ad@Company.co.kr>')).toBe('jihyun+ad@company.co.kr');
    expect(normalizeSenderEmail('  suran@invitocorp.com ')).toBe('suran@invitocorp.com');
    expect(normalizeSenderEmail('주소아님')).toBe('');
  });
});

describe('청구 계정 지정 대조(matchBillingTarget) — §18-13', () => {
  const KUMKANG = cand({ senderId: 'a', userId: 'u-kumkang', label: '금강', loginId: 'kumkang1' });
  const SHINHWAN = cand({ senderId: 'b', userId: 'u-shinhwan', label: '신환', loginId: 'shinhwan1' });
  const NO_LABEL = cand({ senderId: 'c', userId: 'u-plain', label: null, loginId: 'plain77' });

  it('표시명 정확 일치로 1개를 고른다(공백·대소문자는 접는다)', () => {
    const m = matchBillingTarget([KUMKANG, SHINHWAN], '금 강');
    expect(m.outcome).toBe('matched');
    if (m.outcome === 'matched') expect(m.candidate.userId).toBe('u-kumkang');
  });

  it('로그인 ID로도 고를 수 있다(표시명 없는 행의 유일한 지정 키)', () => {
    const m = matchBillingTarget([KUMKANG, NO_LABEL], 'PLAIN77');
    expect(m.outcome).toBe('matched');
    if (m.outcome === 'matched') expect(m.candidate.userId).toBe('u-plain');
  });

  it('일치 0 = not_found. 부분 일치는 일치가 아니다(돈 귀속 · 유사 매칭 금지)', () => {
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '동국').outcome).toBe('not_found');
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '금').outcome).toBe('not_found');
    expect(matchBillingTarget([KUMKANG, SHINHWAN], '').outcome).toBe('not_found');
  });

  it('일치 2+ = ambiguous(표시명이 겹치는 불량 데이터 · 자동 선택 없이 반려)', () => {
    const dup = cand({ senderId: 'd', userId: 'u-dup', label: '금강', loginId: 'other9' });
    expect(matchBillingTarget([KUMKANG, dup], '금강').outcome).toBe('ambiguous');
  });

  it('회신 안내 목록 = "표시명 (로그인ID)" · 표시명 없으면 로그인 ID', () => {
    expect(describeBillingTargets([KUMKANG, NO_LABEL])).toBe('금강 (kumkang1), plain77');
  });

  it('정규화 키 = 공백 제거 + lower(등록 라우트의 겹침 예방과 같은 한 벌)', () => {
    expect(normalizeBillingTargetKey(' Kum Kang1 ')).toBe(normalizeBillingTargetKey('kumkang1'));
    expect(normalizeBillingTargetKey(null)).toBe('');
  });
});

describe('활성 집합 지정 키 겹침(senderKeyClash) — 등록 POST·재활성 PATCH 공용 (★0827 Codex 1R)', () => {
  it('표시명끼리·로그인 ID끼리 겹치면 막는다', () => {
    expect(senderKeyClash([{ label: '금강', loginId: 'a1' }], { label: '금 강', loginId: 'b2' })).toBe(true);
    expect(senderKeyClash([{ label: null, loginId: 'a1' }], { label: null, loginId: 'A1' })).toBe(true);
    expect(senderKeyClash([{ label: '금강', loginId: 'a1' }], { label: '신환', loginId: 'b2' })).toBe(false);
  });

  it('교차 겹침(내 표시명 = 남의 로그인 ID)도 막는다 — 재활성 우회 시나리오의 뿌리', () => {
    // A(login=alpha, label=beta)를 재활성하려는데 B(login=beta, label=alpha)가 활성이면
    // alpha·beta 어느 지정값도 두 후보와 일치(ambiguous)라 그 주소의 접수가 전부 반려된다.
    expect(senderKeyClash([{ label: 'alpha', loginId: 'beta' }], { label: 'beta', loginId: 'alpha' })).toBe(true);
    expect(senderKeyClash([{ label: null, loginId: 'beta' }], { label: 'beta', loginId: 'c3' })).toBe(true);
  });

  it('기존 집합이 비어 있으면(첫 등록·단독 재활성) 겹침이 없다', () => {
    expect(senderKeyClash([], { label: '금강', loginId: 'a1' })).toBe(false);
  });
});
