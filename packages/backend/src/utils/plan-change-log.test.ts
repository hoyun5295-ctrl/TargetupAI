import { describe, it, expect } from 'vitest';
import { classifyPlanChange, todayKst } from './plan-change-log';

describe('classifyPlanChange — 요금제 변경 방향 판정 (2026-07-25)', () => {
  it('직전 금액이 없으면 최초 설정', () => {
    expect(classifyPlanChange(null, 350000)).toBe('initial');
    expect(classifyPlanChange(undefined, 0)).toBe('initial');
  });

  it('★ 금액이 오르면 승급 — 스타터 150,000 → 비즈니스 3,000,000', () => {
    expect(classifyPlanChange(150000, 3000000)).toBe('upgrade');
  });

  it('★ 금액이 내리면 강등 — 엔터프라이즈 5,500,000 → 베이직 350,000', () => {
    expect(classifyPlanChange(5500000, 350000)).toBe('downgrade');
  });

  it('무료에서 유료로 = 승급', () => {
    expect(classifyPlanChange(0, 150000)).toBe('upgrade');
  });

  it('유료에서 무료(미가입)로 = 강등', () => {
    expect(classifyPlanChange(350000, 0)).toBe('downgrade');
  });

  it('금액이 같으면 구성 변경으로 본다 — FREE(0) ↔ TRIAL(0)', () => {
    expect(classifyPlanChange(0, 0)).toBe('admin');
    expect(classifyPlanChange(350000, 350000)).toBe('admin');
  });
});

describe('todayKst — 요금 적용 기준일 (2026-07-25)', () => {
  it('KST 기준으로 날짜를 낸다 — UTC 자정 직후는 이미 한국의 오전 9시', () => {
    expect(todayKst(Date.UTC(2026, 6, 25, 0, 30, 0))).toBe('2026-07-25');
  });

  it('★ UTC 15:00은 한국에서 이미 다음 날이다 — 일할계산 하루가 어긋나는 지점', () => {
    expect(todayKst(Date.UTC(2026, 6, 25, 15, 0, 0))).toBe('2026-07-26');
  });

  it('UTC 14:59는 아직 같은 날', () => {
    expect(todayKst(Date.UTC(2026, 6, 25, 14, 59, 59))).toBe('2026-07-25');
  });

  it('월 경계 — UTC 7/31 15:00 = KST 8/1', () => {
    expect(todayKst(Date.UTC(2026, 6, 31, 15, 0, 0))).toBe('2026-08-01');
  });

  it('연 경계 — UTC 12/31 15:00 = KST 다음 해 1/1', () => {
    expect(todayKst(Date.UTC(2026, 11, 31, 15, 0, 0))).toBe('2027-01-01');
  });

  it('월·일이 한 자리여도 두 자리로 채운다 (date 캐스팅 안전)', () => {
    expect(todayKst(Date.UTC(2026, 0, 5, 3, 0, 0))).toBe('2026-01-05');
  });
});
