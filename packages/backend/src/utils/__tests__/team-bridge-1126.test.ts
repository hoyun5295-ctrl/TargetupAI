/**
 * Team 한줄로 다리(한줄로AI 쪽) 문지기 — 2026-11-26 · CT utils/team-bridge.ts
 * 다리 문은 같은 서버(루프백)에서 온 · 서비스 키가 맞는 요청만. 키가 없거나 짧으면 늘 닫힘.
 */
import { describe, expect, it } from 'vitest';
import { isTeamBridgeCallerAllowed, teamBridgeKeyOk } from '../team-bridge';

const KEY = 'k'.repeat(40);

describe('Team 다리 문지기', () => {
  it('루프백만 받는다(nginx 를 거친 요청은 실제 출발지로 판정돼 거절)', () => {
    expect(isTeamBridgeCallerAllowed('127.0.0.1')).toBe(true);
    expect(isTeamBridgeCallerAllowed('::1')).toBe(true);
    expect(isTeamBridgeCallerAllowed('::ffff:127.0.0.1')).toBe(true);
    expect(isTeamBridgeCallerAllowed('203.0.113.9')).toBe(false);
    expect(isTeamBridgeCallerAllowed('10.0.0.5')).toBe(false);
    expect(isTeamBridgeCallerAllowed('')).toBe(false);
    expect(isTeamBridgeCallerAllowed(undefined)).toBe(false);
  });
  it('서비스 키 — 같으면 통과 · 다르거나 없으면 거절 · 서버 키가 없거나 짧으면 늘 닫힘', () => {
    expect(teamBridgeKeyOk(KEY, KEY)).toBe(true);
    expect(teamBridgeKeyOk(KEY + 'x', KEY)).toBe(false);
    expect(teamBridgeKeyOk('', KEY)).toBe(false);
    expect(teamBridgeKeyOk(undefined, KEY)).toBe(false);
    expect(teamBridgeKeyOk(['a'], KEY)).toBe(false);
    expect(teamBridgeKeyOk(KEY, undefined)).toBe(false);
    expect(teamBridgeKeyOk('short', 'short')).toBe(false);
    expect(teamBridgeKeyOk(KEY, `  ${KEY}  `)).toBe(true);
  });
});
