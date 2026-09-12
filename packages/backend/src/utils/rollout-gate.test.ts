/**
 * rollout-gate — 단계 적용 게이트 CT (★2026-09-12 전송자격인증 3.4·3.5 공용)
 *
 * 왜 CT로 빼는가
 *   다중인증(3.4)과 발신 인증(3.5)이 같은 모양의 게이트를 쓴다. 판정을 두 벌 두면
 *   한쪽만 고쳐져 "켠 줄 알았는데 안 켜진" 상태가 생긴다. 판정은 한 곳이 소유한다.
 *
 * 못 박는 것:
 *   1. 시행일 값이 없거나 날짜가 아니면 **미시행** — 오타 하나로 전 고객 발송이 막히지 않는다.
 *   2. 명단이 비어 있으면 제한 없음, 명단이 있으면 그 계정만. 대소문자·공백은 무시한다.
 *   3. 판정 함수는 ENV 이름을 모른다 — 축마다 자기 ENV를 갖고 값만 넘긴다.
 */
import { describe, it, expect } from 'vitest';
import { isEnforcedFrom, isPilotTarget } from './rollout-gate';

const NOW = new Date('2026-09-12T01:00:00+09:00');

describe('시행일 게이트 — 값이 성립하지 않으면 미시행', () => {
  it('값이 없으면 미시행 — 배포만으로는 아무것도 바뀌지 않는다', () => {
    expect(isEnforcedFrom(undefined, NOW)).toBe(false);
    expect(isEnforcedFrom('', NOW)).toBe(false);
    expect(isEnforcedFrom('   ', NOW)).toBe(false);
  });

  it('값이 날짜가 아니면 미시행 — 오타로 전 고객을 막지 않는다', () => {
    expect(isEnforcedFrom('구월일일', NOW)).toBe(false);
    expect(isEnforcedFrom('2026-13-45', NOW)).toBe(false);
  });

  it('시행일 전이면 미시행', () => {
    expect(isEnforcedFrom('2026-09-01T00:00:00+09:00', new Date('2026-08-31T23:59:59+09:00'))).toBe(false);
  });

  it('시행일 이후면 시행', () => {
    expect(isEnforcedFrom('2026-09-01T00:00:00+09:00', new Date('2026-09-01T00:00:01+09:00'))).toBe(true);
  });
});

describe('시범 명단 — 명단이 있으면 그 계정만', () => {
  it('명단이 비어 있으면 제한 없음 (전면 시행 때는 명단을 지운다)', () => {
    expect(isPilotTarget(undefined, 'anyone')).toBe(true);
    expect(isPilotTarget('', 'anyone')).toBe(true);
    expect(isPilotTarget('  ', 'anyone')).toBe(true);
    expect(isPilotTarget(' , , ', 'anyone')).toBe(true);
  });

  it('명단이 있으면 명단 계정만 대상 · 대소문자와 공백은 무시한다', () => {
    const list = 'hoyun, psy5868 ,suran';
    expect(isPilotTarget(list, 'psy5868')).toBe(true);
    expect(isPilotTarget(list, ' HOYUN ')).toBe(true);
    expect(isPilotTarget(list, 'suran')).toBe(true);
    expect(isPilotTarget(list, 'kumkang4')).toBe(false);
  });

  it('계정이 비어 있으면 대상이 아니다 — 빈 값이 명단을 통과하지 않는다', () => {
    const list = 'hoyun,psy5868,suran';
    expect(isPilotTarget(list, '')).toBe(false);
    expect(isPilotTarget(list, null)).toBe(false);
    expect(isPilotTarget(list, undefined)).toBe(false);
  });
});
