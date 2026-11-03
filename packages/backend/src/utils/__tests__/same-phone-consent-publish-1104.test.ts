/**
 * 세대 공개 2단계 · 번호 하나의 판정(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ④ · §6 C5)
 * 기대값 = 설계서 문장 · Codex 1R ~ 8R 반례 순서를 손으로 따라간 값(코드 방식으로 다시 계산하지 않는다).
 */
import { describe, it, expect } from 'vitest';
import { decidePublish, foldVotes } from '../same-phone-consent';

const T = (s: number) => new Date(Date.UTC(2026, 10, 4, 0, 0, s));
const one = { starts: [T(10)], multi: false };   // 에이전트 하나 · 확정 패스 시작 10

describe('C5 값 있는 고객', () => {
  it('거부 표 하나 = 거부로 낮춤(바로) · 미룸 지움', () => {
    expect(decidePublish({ current: true, fold: foldVotes(['yes', 'no']), refusalSeenAt: T(5), raiseSince: null, ...one }))
      .toEqual({ target: false, raiseSince: 'clear' });
  });
  it('이미 거부 + 수신만 = 올림(에이전트 하나 · 거부 관측이 이 패스 시작 앞)', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes']), refusalSeenAt: T(5), raiseSince: null, ...one }))
      .toEqual({ target: true, raiseSince: 'clear' });
  });
  it('이미 거부 + 수신만인데 거부 관측이 이 패스 시작 뒤(같은 패스 적재가 본 거부) = 올리지 않음', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes']), refusalSeenAt: T(11), raiseSince: null, ...one }))
      .toEqual({ target: null, raiseSince: 'keep' });
  });
  it('빈칸 · 모름만 = 바꾸지 않음(기존 거부 보존 · Codex 1R #4 · 5R #3 Y + 모름은 수신)', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['none']), refusalSeenAt: null, raiseSince: null, ...one })).toEqual({ target: null, raiseSince: 'clear' });
    expect(decidePublish({ current: false, fold: foldVotes(['unknown']), refusalSeenAt: null, raiseSince: null, ...one })).toEqual({ target: null, raiseSince: 'clear' });
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'unknown']), refusalSeenAt: T(1), raiseSince: null, ...one })).toEqual({ target: true, raiseSince: 'clear' });
  });
  it('이미 수신 + 수신 = 그대로', () => {
    expect(decidePublish({ current: true, fold: foldVotes(['yes']), refusalSeenAt: null, raiseSince: null, ...one })).toEqual({ target: null, raiseSince: 'clear' });
  });
  it('어느 에이전트 요약에도 없는 번호(원본에서 사라짐) = 바꾸지 않음', () => {
    expect(decidePublish({ current: false, fold: null, refusalSeenAt: T(1), raiseSince: T(2), ...one })).toEqual({ target: null, raiseSince: 'clear' });
  });
});

describe('C5 대기(NULL) 고객 = 신규 판정', () => {
  it('전부 빈칸 = 기본 동의로 올림(5R #4) · 모름 하나 = 미동의 · 수신 = 동의 · 거부 = 미동의', () => {
    expect(decidePublish({ current: null, fold: foldVotes(['none']), refusalSeenAt: null, raiseSince: null, ...one }).target).toBe(true);
    expect(decidePublish({ current: null, fold: foldVotes(['none', 'unknown']), refusalSeenAt: null, raiseSince: null, ...one }).target).toBe(false);
    expect(decidePublish({ current: null, fold: foldVotes(['yes']), refusalSeenAt: null, raiseSince: null, ...one }).target).toBe(true);
    expect(decidePublish({ current: null, fold: foldVotes(['no']), refusalSeenAt: T(3), raiseSince: null, ...one }).target).toBe(false);
  });
});

describe('C5 에이전트 둘 · 올리기 장벽(R*)', () => {
  it('8R G24: 확정 집합 = A2(30) · B1(20) · 처음 막힘 = raise_since 를 M(30) 으로 · 올리지 않음', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'yes']), refusalSeenAt: T(11), raiseSince: null, starts: [T(30), T(20)], multi: true }))
      .toEqual({ target: null, raiseSince: T(30) });
  });
  it('G19: raise_since 30 고정 · A40 · B30 = 둘 다 30 이상 = 올림', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'yes']), refusalSeenAt: null, raiseSince: T(30), starts: [T(40), T(30)], multi: true }))
      .toEqual({ target: true, raiseSince: 'clear' });
  });
  it('G19: raise_since 30 · B30 반영 때(A 는 아직 20) = 올리지 않음 · raise_since 그대로(다시 정하지 않음 · 5R #1)', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'yes']), refusalSeenAt: null, raiseSince: T(30), starts: [T(20), T(30)], multi: true }))
      .toEqual({ target: null, raiseSince: 'keep' });
  });
  it('4R #2 교차: raise_since 10 · 두 에이전트 확정 20 · 30 이어도 그 뒤 거부 관측(45) 이 있으면 안 올림', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'yes']), refusalSeenAt: T(45), raiseSince: T(10), starts: [T(20), T(30)], multi: true }))
      .toEqual({ target: null, raiseSince: 'keep' });
  });
  it('에이전트 둘 · 확정 시작이 같으면(둘 다 새 패스) 처음부터 올림', () => {
    expect(decidePublish({ current: false, fold: foldVotes(['yes', 'yes']), refusalSeenAt: T(5), raiseSince: null, starts: [T(30), T(30)], multi: true }))
      .toEqual({ target: true, raiseSince: 'clear' });
  });
  it('에이전트 둘 · 거부는 장벽 없이 바로 낮춤', () => {
    expect(decidePublish({ current: true, fold: foldVotes(['yes', 'no']), refusalSeenAt: T(5), raiseSince: null, starts: [T(30), T(20)], multi: true }))
      .toEqual({ target: false, raiseSince: 'clear' });
  });
});
