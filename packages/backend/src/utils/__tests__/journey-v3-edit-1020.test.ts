/**
 * 여정 V.3 묶음 2 — 켜진 여정 고치는 범위 · 적용 시점(2026-10-20 · 설계서 §4)
 *
 * 원칙: 진행 중 고객이 이미 받은 것은 고치지 않는다 · 다음 일부터 바뀐다 · 진행 중 고객을 옮기지 않는다.
 * 못 박는 것:
 *   - 켜진 여정 = 문안 · 간격 그 자리(날짜 기준 · 한 번 보내기는 간격도 새 모양) · 칸 모양 = 새 모양
 *   - 여정 옵션 = 시작 조건 · 한도 · 재진입 · 홀드아웃 · 예산 · 목표 종료 켜기는 그 자리 · 목표 끄기 · 목표 종류 · 회신번호 = 새 모양
 *   - 사전검사 표식은 「건드린 키가 전부 유지 목록일 때만」 유지(새 키는 기본이 비움)
 *   - 화면 이유 문장에 「새 판」 0
 */
import { describe, it, expect } from 'vitest';
import {
  stepEditPolicy,
  blockedStepEditGroups,
  keepsPretestMarkerForStep,
  journeyOptionEditVerdict,
} from '../journey-step-edit-policy';

describe('칸 정책', () => {
  it('초안 = 전부', () => {
    expect(stepEditPolicy('draft', 0, 'event')).toMatchObject({ copy: true, timing: true, structure: true, ops: true });
  });
  it('켜진 여정 = 문안 · 간격 · 담당자 알림 그 자리 · 칸 모양은 새 모양', () => {
    const p = stepEditPolicy('active', 12, 'event');
    expect(p).toMatchObject({ copy: true, timing: true, structure: false, ops: true });
    expect(blockedStepEditGroups(p, { delayHours: 48 }, 'active')).toEqual([]);
    expect(blockedStepEditGroups(p, { delayMode: 'specific_hour', targetHourKst: 10 }, 'active')).toEqual([]);
    expect(blockedStepEditGroups(p, { channel: 'lms' }, 'active')).toEqual(['structure']);
    // 문안은 지금처럼 명시 opt-in(새 스냅숏 · 재검사) 요청만
    expect(blockedStepEditGroups(p, { messageTemplate: '안녕하세요 고객님' }, 'active')).toEqual(['copy']);
    expect(blockedStepEditGroups(p, { messageTemplate: '안녕하세요 고객님', allowActiveMessageEdit: true }, 'active')).toEqual([]);
  });
  it('켜진 날짜 기준 · 한 번 보내기 여정은 간격도 새 모양', () => {
    expect(stepEditPolicy('active', 3, 'date_anchor').timing).toBe(false);
    expect(stepEditPolicy('active', 0, 'one_shot').timing).toBe(false);
  });
  it('멈춤 = 진행 중 있으면 칸 모양 잠금 · 없으면 전부', () => {
    expect(stepEditPolicy('paused', 2, 'event')).toMatchObject({ copy: true, timing: true, structure: false });
    expect(stepEditPolicy('paused', 0, 'event')).toMatchObject({ structure: true });
  });
  it('끝남 = 전부 잠금', () => {
    expect(stepEditPolicy('ended', 0, 'event')).toMatchObject({ copy: false, timing: false, structure: false, ops: false });
  });
  it('이유 문장에 「새 판」 0', () => {
    for (const [st, n, k] of [['draft', 0, 'event'], ['paused', 2, 'event'], ['paused', 0, 'event'], ['active', 1, 'event'], ['active', 1, 'date_anchor'], ['ended', 0, 'event']] as const) {
      expect(stepEditPolicy(st, n, k).reason).not.toContain('새 판');
    }
  });
});

describe('사전검사 표식 유지(칸)', () => {
  it('간격 · 담당자 알림만 건드리면 유지 · 하나라도 다른 키면 비움', () => {
    expect(keepsPretestMarkerForStep({ delayHours: 24 })).toBe(true);
    expect(keepsPretestMarkerForStep({ delayMode: 'relative_at_hour', targetHourKst: 10, notifyManagerOnPretest: true })).toBe(true);
    expect(keepsPretestMarkerForStep({ delayHours: 24, messageTemplate: 'x' })).toBe(false);
    expect(keepsPretestMarkerForStep({ subject: 'x' })).toBe(false);
    expect(keepsPretestMarkerForStep({ mmsImagePaths: [] })).toBe(false);
    expect(keepsPretestMarkerForStep({ someNewKey: 1 })).toBe(false);
    expect(keepsPretestMarkerForStep({})).toBe(false);
  });
});

describe('여정 옵션 판정', () => {
  it('켜진 여정 = 시작 조건 · 한도 · 재진입 · 홀드아웃 · 예산 · 개인 발송 시각 그 자리 · 표식 유지', () => {
    const v = journeyOptionEditVerdict('active', {
      dormant_days: 60, points_min: 1000, thresholdRecipients: 500, thresholdCost: 0, budgetMonthly: 100000,
      allowReentry: true, reentryCooldownDays: 30, holdoutPct: 10, personalSendTime: true,
      customer_conditions: [{ field: 'grade', op: '==', value: 'VIP' }], logic: 'AND',
    });
    expect(v).toEqual({ ok: true, keepMarker: true });
  });
  it('켜진 여정 목표 종료 켜기 = 그 자리 · 끄기 · 목표 종류 · 회신번호 · 회신 모드 = 새 모양', () => {
    expect(journeyOptionEditVerdict('active', { goalExitEnabled: true })).toEqual({ ok: true, keepMarker: true });
    for (const body of [{ goalExitEnabled: false }, { goalKind: 'click' }, { callbackNumber: '0200000000' }, { callbackMode: 'store' }]) {
      expect(journeyOptionEditVerdict('active', body)).toMatchObject({ ok: false, code: 'JOURNEY_NEEDS_NEW_SHAPE' });
    }
  });
  it('초안 · 멈춤은 전부 그 자리 · 회신번호를 건드리면 표식 비움(검증 입력)', () => {
    expect(journeyOptionEditVerdict('paused', { callbackNumber: '0200000000' })).toEqual({ ok: true, keepMarker: false });
    expect(journeyOptionEditVerdict('draft', { goalKind: 'click', goalExitEnabled: false })).toEqual({ ok: true, keepMarker: true });
    expect(journeyOptionEditVerdict('paused', { dormant_days: 90 })).toEqual({ ok: true, keepMarker: true });
  });
  it('모르는 키가 섞이면 표식 비움(새 키는 기본이 비움)', () => {
    expect(journeyOptionEditVerdict('paused', { dormant_days: 90, brandNewKey: true })).toEqual({ ok: true, keepMarker: false });
  });
  it('끝난 여정은 못 고친다', () => {
    expect(journeyOptionEditVerdict('ended', { dormant_days: 90 })).toMatchObject({ ok: false, code: 'JOURNEY_ENDED' });
  });
});

describe('켜기 관문 검사 공용(validateJourneyEntryConfig)', () => {
  const base = { trigger_event: 'customer.dormant', allow_reentry: false, reentry_cooldown_days: 0, trigger_filters: {}, threshold_recipients_per_step: 500 };
  it('통과', async () => {
    const { validateJourneyEntryConfig } = await import('../journey-builder');
    expect(validateJourneyEntryConfig(base)).toBeNull();
  });
  it('상한 비우기 = 거절', async () => {
    const { validateJourneyEntryConfig } = await import('../journey-builder');
    expect(validateJourneyEntryConfig({ ...base, threshold_recipients_per_step: null })).toBe('한 번에 보낼 최대 인원을 정해 주세요. 고객 정보를 한꺼번에 옮겨 올 때 예상보다 많은 분께 나가는 것을 막습니다.');
  });
  it('허용 밖 고객 조건 = 거절(조건을 고칠 수 있으니 새로 만들라고 하지 않는다)', async () => {
    const { validateJourneyEntryConfig } = await import('../journey-builder');
    const r = validateJourneyEntryConfig({ ...base, trigger_filters: { customer_conditions: [{ field: 'nope', op: '==', value: 1 }] } });
    expect(r).toContain('여정에서 쓸 수 없는 항목');
    expect(r).not.toContain('새로 만들어야');
  });
  it('포인트 기준 0 = 거절', async () => {
    const { validateJourneyEntryConfig } = await import('../journey-builder');
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.points_expiring', trigger_filters: { points_min: 0 } }))
      .toBe('포인트 기준값을 1 이상으로 지정해 주세요. 0이면 포인트가 없는 분까지 전원 대상이 됩니다.');
  });
  it('쿨다운 최소(계약) 미만 재진입 = 거절', async () => {
    const { validateJourneyEntryConfig } = await import('../journey-builder');
    expect(validateJourneyEntryConfig({ ...base, trigger_event: 'customer.cycle_lapsed', allow_reentry: true, reentry_cooldown_days: 0 }))
      .toBe('이 발송 조건은 같은 분께 다시 보내기까지 최소 1일이 필요합니다. 재진입 간격을 지정해 주세요.');
  });
});
