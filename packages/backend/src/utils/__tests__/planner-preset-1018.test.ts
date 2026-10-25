/**
 * ★ 2026-10-18 플래너 v2-1 — 템플릿 보내는 순서 기본값(frontend components/planner/planner-preset.ts · 설계서 docs/2026-10-18-planner-v2-design.md §3-5 · H2)
 * 빅세일 · 특별 = 시작일 메일 + 시작일 문자+DM + 마지막 날 문자+DM / 신상품 · 계절 = 시작일 문자+DM + 시작일 메일 ·
 * 하루 행사 = 같은 날 같은 채널 접기 · 지난 날 · 잠긴 채널 빼기 · 오늘 20시가 지나면 내일부터.
 */
import { describe, expect, it } from 'vitest';
import { plannerMinSendDate, plannerPreset } from '../../../../frontend/src/components/planner/planner-preset';

const all = () => true;
const key = (r: ReturnType<typeof plannerPreset>) => r.map((t) => `${t.channel}@${t.timing.anchor}`);

describe('plannerPreset', () => {
  it('빅세일 · 특별 이벤트 = 시작일 메일 · 시작일 문자+DM · 마지막 날 문자+DM', () => {
    for (const id of ['big-sale', 'special-event'] as const) {
      expect(key(plannerPreset(id, '2026-11-01', '2026-11-07', '2026-10-20', all))).toEqual(['email@start', 'sms@start', 'dm@start', 'sms@end', 'dm@end']);
    }
  });
  it('신상품 · 계절 = 시작일 문자+DM · 시작일 메일', () => {
    for (const id of ['new-launch', 'season'] as const) {
      expect(key(plannerPreset(id, '2026-11-01', '2026-11-07', '2026-10-20', all))).toEqual(['sms@start', 'dm@start', 'email@start']);
    }
  });
  it('하루 행사 = 마지막 날 문자+DM 를 시작일과 접는다', () => {
    expect(key(plannerPreset('big-sale', '2026-11-01', '2026-11-01', '2026-10-20', all))).toEqual(['email@start', 'sms@start', 'dm@start']);
  });
  it('지난 날은 뺀다(시작일이 지났으면 마지막 날만)', () => {
    expect(key(plannerPreset('big-sale', '2026-10-18', '2026-10-25', '2026-10-19', all))).toEqual(['sms@end', 'dm@end']);
    expect(plannerPreset('season', '2026-10-01', '2026-10-05', '2026-10-19', all)).toEqual([]);
  });
  it('잠긴 채널은 뺀다', () => {
    expect(key(plannerPreset('new-launch', '2026-11-01', '2026-11-07', '2026-10-20', (ch) => ch !== 'email'))).toEqual(['sms@start', 'dm@start']);
  });
});

describe('plannerMinSendDate', () => {
  // ★ 1025 #62 — 마감 시각 = 서버 값(GET /api/send-policy plannerDeadlineHour) · 화면 기본값 0
  it('KST 마감(20시) 전 = 오늘 · 마감부터 = 내일 · 다른 마감 값도 그대로 따른다', () => {
    expect(plannerMinSendDate(new Date('2026-10-18T10:59:00Z'), 20)).toBe('2026-10-18'); // KST 19:59
    expect(plannerMinSendDate(new Date('2026-10-18T11:00:00Z'), 20)).toBe('2026-10-19'); // KST 20:00
    expect(plannerMinSendDate(new Date('2026-10-18T15:30:00Z'), 20)).toBe('2026-10-19'); // KST 다음 날 00:30
    expect(plannerMinSendDate(new Date('2026-10-18T09:30:00Z'), 18)).toBe('2026-10-19'); // KST 18:30 · 마감 18시
  });
});
