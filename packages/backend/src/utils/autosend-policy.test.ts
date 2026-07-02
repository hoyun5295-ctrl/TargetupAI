// autosend-policy 순수 정책 테스트 — 담당자 통지 문구 빌더 (2026-07-02 1단계)
// 스펙(Harold): 통지 2번 문자 = 발송 일시 + 추출 타겟 수 + 예상 비용(해당 유형 단가 × 수량) + 예약취소(정지) 안내.
import { describe, it, expect } from 'vitest';
import { buildAutoSendPrepInfoBody, buildPendingReviewNoticeBody } from './autosend-policy';

describe('buildAutoSendPrepInfoBody — 자율 발송 예정 안내(통지 2번) 문구', () => {
  it('발송 일시·타겟 수·예상 비용(단가 × 수량)·정지 안내를 모두 담는다', () => {
    const body = buildAutoSendPrepInfoBody({
      sendAtLabel: '7월 3일 14:00',
      recipientCount: 1543,
      costEstimate: 41661,
      channelLabel: 'LMS',
      unitCost: 27,
    });
    expect(body).toContain('7월 3일 14:00');
    expect(body).toContain('1,543명');
    expect(body).toContain('41,661원');
    expect(body).toContain('LMS 27원 × 1,543건');
    expect(body).toContain('자동마케팅');
    expect(body).toContain('[정지]');
  });

  it('단가가 없으면(0) 산식 없이 총액만 담는다', () => {
    const body = buildAutoSendPrepInfoBody({
      sendAtLabel: '7월 3일 14:00',
      recipientCount: 200,
      costEstimate: 5400,
      channelLabel: 'LMS',
      unitCost: 0,
    });
    expect(body).toContain('5,400원');
    expect(body).not.toContain('×');
  });

  it('소수 단가(9.9)는 그대로 표기한다', () => {
    const body = buildAutoSendPrepInfoBody({
      sendAtLabel: '7월 5일 10:00',
      recipientCount: 100,
      costEstimate: 990,
      channelLabel: 'SMS',
      unitCost: 9.9,
    });
    expect(body).toContain('SMS 9.9원 × 100건');
  });
});

describe('normalizeSendTimeMode — 발송 시각 모드 정규화', () => {
  it("'ai_optimal'만 ai_optimal, 그 외 전부 'fixed'(희망 시각 고정)", async () => {
    const { normalizeSendTimeMode } = await import('./autosend-policy');
    expect(normalizeSendTimeMode('ai_optimal')).toBe('ai_optimal');
    expect(normalizeSendTimeMode('fixed')).toBe('fixed');
    expect(normalizeSendTimeMode(undefined)).toBe('fixed');
    expect(normalizeSendTimeMode(null)).toBe('fixed');
    expect(normalizeSendTimeMode('AI')).toBe('fixed');
  });
});

describe('computeNextOccurrence — 다음 발송 희망 시각(KST)', () => {
  it('daily: 오늘 그 시각이 아직 안 지났으면 오늘, 지났으면 내일', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // now = KST 2026-07-02 12:00 (UTC 03:00)
    const now = new Date('2026-07-02T03:00:00Z');
    const later = computeNextOccurrence('daily', '14:00', null, null, now);
    expect(later.toISOString()).toBe('2026-07-02T05:00:00.000Z'); // KST 14:00 당일
    const passed = computeNextOccurrence('daily', '09:00', null, null, now);
    expect(passed.toISOString()).toBe('2026-07-03T00:00:00.000Z'); // KST 09:00 다음날
  });

  it('weekly: 지정 요일로, 같은 요일인데 시각이 지났으면 다음 주', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // 2026-07-02 = 목요일(4). now = KST 12:00.
    const now = new Date('2026-07-02T03:00:00Z');
    const thuLater = computeNextOccurrence('weekly', '14:00', 4, null, now);
    expect(thuLater.toISOString()).toBe('2026-07-02T05:00:00.000Z'); // 같은 목요일 14:00
    const thuPassed = computeNextOccurrence('weekly', '09:00', 4, null, now);
    expect(thuPassed.toISOString()).toBe('2026-07-09T00:00:00.000Z'); // 다음 주 목요일 09:00
  });

  it('monthly: 지정 일자로, 말일 초과(31일 → 그 달 말일) 클램프', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // now = KST 2026-06-15 12:00 → 6월 31일 없음 → 6월 30일로 클램프
    const now = new Date('2026-06-15T03:00:00Z');
    const d = computeNextOccurrence('monthly', '10:00', null, 31, now);
    expect(d.toISOString()).toBe('2026-06-30T01:00:00.000Z'); // KST 6/30 10:00
  });
});

describe('computeNextGenerationRun — 생성 시각 = 발송 희망 시각 − 준비시간', () => {
  it('준비 창이 확보되면: 생성 = 희망 − lead, 발송 = 희망 정각', async () => {
    const { computeNextGenerationRun } = await import('./autosend-policy');
    // now = KST 11:00, 희망 14:00 daily, lead 120분 → 생성 KST 12:00 / 발송 KST 14:00
    const now = new Date('2026-07-02T02:00:00Z');
    const r = computeNextGenerationRun('daily', '14:00', null, null, 120, now);
    expect(r.sendAt.toISOString()).toBe('2026-07-02T05:00:00.000Z');
    expect(r.nextRunAt.toISOString()).toBe('2026-07-02T03:00:00.000Z');
  });

  it('생성 시각이 이미 지났으면 한 주기 뒤로 (생성 직후 재계산이 같은 주기를 다시 잡는 무한 루프 차단)', async () => {
    const { computeNextGenerationRun } = await import('./autosend-policy');
    // now = KST 12:00 정각(= 생성 시각) — 같은 주기 재선정 금지 → 다음날 14:00 / 생성 다음날 12:00
    const now = new Date('2026-07-02T03:00:00Z');
    const r = computeNextGenerationRun('daily', '14:00', null, null, 120, now);
    expect(r.sendAt.toISOString()).toBe('2026-07-03T05:00:00.000Z');
    expect(r.nextRunAt.toISOString()).toBe('2026-07-03T03:00:00.000Z');
  });
});

describe('buildPendingReviewNoticeBody — 승인 대기(수동 검토) 통지 문구', () => {
  it('오퍼레이터명·타겟 수·예상 비용·승인 안내를 담는다', () => {
    const body = buildPendingReviewNoticeBody({
      operatorName: 'VIP 재구매 유도',
      recipientCount: 320,
      costEstimate: 8640,
    });
    expect(body).toContain('VIP 재구매 유도');
    expect(body).toContain('320명');
    expect(body).toContain('8,640원');
    expect(body).toContain('승인');
  });
});
