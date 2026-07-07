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
    const later = computeNextOccurrence('daily', '14:00', null, null, null, now);
    expect(later.toISOString()).toBe('2026-07-02T05:00:00.000Z'); // KST 14:00 당일
    const passed = computeNextOccurrence('daily', '09:00', null, null, null, now);
    expect(passed.toISOString()).toBe('2026-07-03T00:00:00.000Z'); // KST 09:00 다음날
  });

  it('weekly: 지정 요일로, 같은 요일인데 시각이 지났으면 다음 주', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // 2026-07-02 = 목요일(4). now = KST 12:00.
    const now = new Date('2026-07-02T03:00:00Z');
    const thuLater = computeNextOccurrence('weekly', '14:00', 4, null, null, now);
    expect(thuLater.toISOString()).toBe('2026-07-02T05:00:00.000Z'); // 같은 목요일 14:00
    const thuPassed = computeNextOccurrence('weekly', '09:00', 4, null, null, now);
    expect(thuPassed.toISOString()).toBe('2026-07-09T00:00:00.000Z'); // 다음 주 목요일 09:00
  });

  it('monthly: 지정 일자로, 말일 초과(31일 → 그 달 말일) 클램프', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // now = KST 2026-06-15 12:00 → 6월 31일 없음 → 6월 30일로 클램프
    const now = new Date('2026-06-15T03:00:00Z');
    const d = computeNextOccurrence('monthly', '10:00', null, 31, null, now);
    expect(d.toISOString()).toBe('2026-06-30T01:00:00.000Z'); // KST 6/30 10:00
  });

  it('yearly: 지정 월·일 연 1회 — 올해 지났으면 내년 (2026-07-05 캘린더 시즌)', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    // now = KST 2026-07-05 12:00
    const now = new Date('2026-07-05T03:00:00Z');
    // 3월 14일은 올해 지남 → 내년 3월 14일
    const passed = computeNextOccurrence('yearly', '10:00', null, 14, 3, now);
    expect(passed.toISOString()).toBe('2027-03-14T01:00:00.000Z');
    // 9월 10일은 아직 → 올해 9월 10일
    const upcoming = computeNextOccurrence('yearly', '10:00', null, 10, 9, now);
    expect(upcoming.toISOString()).toBe('2026-09-10T01:00:00.000Z');
    // 같은 달 미래 일자 → 올해 그 날
    const sameMonth = computeNextOccurrence('yearly', '10:00', null, 20, 7, now);
    expect(sameMonth.toISOString()).toBe('2026-07-20T01:00:00.000Z');
    // 같은 달 지난 일자 → 내년
    const sameMonthPassed = computeNextOccurrence('yearly', '10:00', null, 1, 7, now);
    expect(sameMonthPassed.toISOString()).toBe('2027-07-01T01:00:00.000Z');
  });

  it('yearly: 2월 30일 같은 없는 날짜는 그 달 말일로 클램프', async () => {
    const { computeNextOccurrence } = await import('./autosend-policy');
    const now = new Date('2026-07-05T03:00:00Z');
    const feb = computeNextOccurrence('yearly', '10:00', null, 30, 2, now);
    expect(feb.toISOString()).toBe('2027-02-28T01:00:00.000Z'); // 2027년 2월 말일
  });
});

describe('computeNextGenerationRun — 생성 시각 = 발송 희망 시각 − 준비시간', () => {
  it('준비 창이 확보되면: 생성 = 희망 − lead, 발송 = 희망 정각', async () => {
    const { computeNextGenerationRun } = await import('./autosend-policy');
    // now = KST 11:00, 희망 14:00 daily, lead 120분 → 생성 KST 12:00 / 발송 KST 14:00
    const now = new Date('2026-07-02T02:00:00Z');
    const r = computeNextGenerationRun('daily', '14:00', null, null, null, 120, now);
    expect(r.sendAt.toISOString()).toBe('2026-07-02T05:00:00.000Z');
    expect(r.nextRunAt.toISOString()).toBe('2026-07-02T03:00:00.000Z');
  });

  it('생성 시각이 이미 지났으면 한 주기 뒤로 (생성 직후 재계산이 같은 주기를 다시 잡는 무한 루프 차단)', async () => {
    const { computeNextGenerationRun } = await import('./autosend-policy');
    // now = KST 12:00 정각(= 생성 시각) — 같은 주기 재선정 금지 → 다음날 14:00 / 생성 다음날 12:00
    const now = new Date('2026-07-02T03:00:00Z');
    const r = computeNextGenerationRun('daily', '14:00', null, null, null, 120, now);
    expect(r.sendAt.toISOString()).toBe('2026-07-03T05:00:00.000Z');
    expect(r.nextRunAt.toISOString()).toBe('2026-07-03T03:00:00.000Z');
  });

  it('yearly: 생성 = 대상 월·일 발송 − lead (2026-07-05)', async () => {
    const { computeNextGenerationRun } = await import('./autosend-policy');
    // now = KST 2026-07-05 12:00, 대상 = 9월 10일 10:00, lead 120분
    const now = new Date('2026-07-05T03:00:00Z');
    const r = computeNextGenerationRun('yearly', '10:00', null, 10, 9, 120, now);
    expect(r.sendAt.toISOString()).toBe('2026-09-10T01:00:00.000Z');   // KST 9/10 10:00
    expect(r.nextRunAt.toISOString()).toBe('2026-09-09T23:00:00.000Z'); // KST 9/10 08:00
  });
});

describe('normalizeCopyStyle / buildCopyStylePromptBlock — 문안 스타일 4종 (2단계)', () => {
  it('4종 화이트리스트만 통과, 그 외/미지정은 null(브랜드 톤 자동)', async () => {
    const { normalizeCopyStyle } = await import('./autosend-policy');
    expect(normalizeCopyStyle('courteous')).toBe('courteous');
    expect(normalizeCopyStyle('friendly')).toBe('friendly');
    expect(normalizeCopyStyle('witty')).toBe('witty');
    expect(normalizeCopyStyle('punchy')).toBe('punchy');
    expect(normalizeCopyStyle('funny')).toBeNull();
    expect(normalizeCopyStyle(undefined)).toBeNull();
    expect(normalizeCopyStyle(null)).toBeNull();
  });

  it('스타일 지정 시 문안 생성 프롬프트 블록을, null이면 빈 문자열을 돌려준다', async () => {
    const { buildCopyStylePromptBlock } = await import('./autosend-policy');
    expect(buildCopyStylePromptBlock(null)).toBe('');
    const block = buildCopyStylePromptBlock('witty');
    expect(block).toContain('문안 스타일');
    expect(block).toContain('위트');
  });

  it('프롬프트 블록에 구체 혜택 유도 표현(%/원/쿠폰/무료)이 없다', async () => {
    const { buildCopyStylePromptBlock, COPY_STYLES } = await import('./autosend-policy');
    for (const s of COPY_STYLES) {
      const block = buildCopyStylePromptBlock(s.key);
      expect(block).not.toMatch(/%|원 |쿠폰|무료/);
    }
  });
});

describe('kstYesterdayRange — 어제(KST) 하루 구간 (성과 회고 2차)', () => {
  it('KST 자정 기준 어제 00:00 ~ 오늘 00:00 (UTC 값으로) 반환', async () => {
    const { kstYesterdayRange } = await import('./autosend-policy');
    // now = 2026-07-02 21:00 KST (12:00Z) → 어제 = 7/1 00:00 KST(6/30 15:00Z) ~ 7/2 00:00 KST(7/1 15:00Z)
    const r = kstYesterdayRange(new Date('2026-07-02T12:00:00Z'));
    expect(r.start.toISOString()).toBe('2026-06-30T15:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-07-01T15:00:00.000Z');
    expect(r.dateLabel).toBe('7월 1일');
  });
});

describe('buildDailyRecapBody — 성과 회고 문자 (2차)', () => {
  it('발송·성공·클릭(있을 때)·학습 반영 안내를 담는다', async () => {
    const { buildDailyRecapBody } = await import('./autosend-policy');
    const body = buildDailyRecapBody({
      operatorName: '휴면 고객 회복', dateLabel: '7월 1일',
      sentCount: 1543, successCount: 1540, clickedCount: 172,
    });
    expect(body).toContain('7월 1일');
    expect(body).toContain('휴면 고객 회복');
    expect(body).toContain('1,543명');
    expect(body).toContain('1,540명');
    expect(body).toContain('172명');
    expect(body).toContain('11.1%'); // 172/1543
    expect(body).toContain('학습');
  });

  it('클릭 0이면 클릭 줄을 표기하지 않는다 (미측정과 0 구분 불가 — 정직)', async () => {
    const { buildDailyRecapBody } = await import('./autosend-policy');
    const body = buildDailyRecapBody({
      operatorName: 'VIP 재구매', dateLabel: '7월 1일',
      sentCount: 200, successCount: 199, clickedCount: 0,
    });
    expect(body).not.toContain('클릭');
  });
});

describe('buildPrepReminderBody — 월간 캠페인 D-2 사전 준비 문자 (Harold 확정)', () => {
  it('혜택 미입력: 캠페인명·예정 일시·입력 요청·미입력 시 승인 대기 안내를 담는다', async () => {
    const { buildPrepReminderBody } = await import('./autosend-policy');
    const body = buildPrepReminderBody({
      operatorName: '7월 생일 축하', sendAtLabel: '7월 5일 10:00', benefitContent: null,
    });
    expect(body).toContain('7월 생일 축하');
    expect(body).toContain('7월 5일 10:00');
    expect(body).toContain('혜택');
    expect(body).toContain('입력');
    expect(body).toContain('승인 대기');
  });

  it('혜택 입력됨: 현재 혜택을 보여주고 바꾸려면 수정하라고 안내한다', async () => {
    const { buildPrepReminderBody } = await import('./autosend-policy');
    const body = buildPrepReminderBody({
      operatorName: 'VIP 데이', sendAtLabel: '7월 10일 10:00', benefitContent: '마스크팩 증정',
    });
    expect(body).toContain('마스크팩 증정');
    expect(body).toContain('수정');
    expect(body).not.toContain('승인 대기');
  });
});

describe('wrapOperatorNoticeBody — 담당자 안내 문자 머리말 (Harold 2026-07-02 지시)', () => {
  it('본문이 [한줄로 AI 자동마케팅 안내문자]로 시작한다', async () => {
    const { wrapOperatorNoticeBody } = await import('./autosend-policy');
    const wrapped = wrapOperatorNoticeBody('내용입니다.');
    expect(wrapped.startsWith('[한줄로 AI 자동마케팅 안내문자]\n')).toBe(true);
    expect(wrapped).toContain('내용입니다.');
  });

  it('이미 머리말이 있으면 중복으로 붙이지 않는다', async () => {
    const { wrapOperatorNoticeBody } = await import('./autosend-policy');
    const once = wrapOperatorNoticeBody('내용');
    expect(wrapOperatorNoticeBody(once)).toBe(once);
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

// ── 2026-07-07 마케팅 캘린더 완비 — 타겟 축·혜택 치환·출구 가드·만료 리마인드 ──

describe('normalizeTargetHint / targetHintLabel — 타겟 축 화이트리스트', () => {
  it('화이트리스트 키만 통과, 그 외/미지정 = null', async () => {
    const { normalizeTargetHint } = await import('./autosend-policy');
    expect(normalizeTargetHint('all')).toBe('all');
    expect(normalizeTargetHint('dormant')).toBe('dormant');
    expect(normalizeTargetHint('recent_buyers')).toBe('recent_buyers');
    expect(normalizeTargetHint('vip')).toBe('vip');
    expect(normalizeTargetHint('birthday')).toBe('birthday');
    expect(normalizeTargetHint('new_customers')).toBe('new_customers');
    expect(normalizeTargetHint('churn_risk_high')).toBeNull(); // 예측 축 유입 차단
    expect(normalizeTargetHint('')).toBeNull();
    expect(normalizeTargetHint(undefined)).toBeNull();
    expect(normalizeTargetHint(null)).toBeNull();
  });

  it('라벨은 한글 표기, null = 빈 문자열', async () => {
    const { targetHintLabel } = await import('./autosend-policy');
    expect(targetHintLabel('dormant')).toBe('휴면 고객');
    expect(targetHintLabel('all')).toBe('전체 고객');
    expect(targetHintLabel(null)).toBe('');
  });
});

describe('buildTargetHintPromptBlock — 타겟 축 고정 지시 블록', () => {
  it('축 지정 시 라벨·지시·준수 문구를 담는다', async () => {
    const { buildTargetHintPromptBlock } = await import('./autosend-policy');
    const block = buildTargetHintPromptBlock('dormant');
    expect(block).toContain('휴면 고객');
    expect(block).toContain('반드시');
    expect(block).toContain('filters');
  });

  it('null = 빈 문자열(기존 자유 해석 유지)', async () => {
    const { buildTargetHintPromptBlock } = await import('./autosend-policy');
    expect(buildTargetHintPromptBlock(null)).toBe('');
  });
});

describe('applyBenefitToBody — 혜택 placeholder 치환 (생성·발송 두 지점 공용)', () => {
  it('[혜택 ...] 대괄호 placeholder를 관리자 입력값으로 전부 치환한다', async () => {
    const { applyBenefitToBody } = await import('./autosend-policy');
    const out = applyBenefitToBody(
      '안녕하세요. [혜택 내용을 입력해주세요] 이번 달 준비했습니다. [혜택 안내 — 직접 작성해주세요]',
      '아메리카노 1잔 증정',
    );
    expect(out).toBe('안녕하세요. 아메리카노 1잔 증정 이번 달 준비했습니다. 아메리카노 1잔 증정');
  });

  it('혜택이 비어 있으면 원문 그대로(placeholder 보존 → 출구 가드 대상)', async () => {
    const { applyBenefitToBody } = await import('./autosend-policy');
    const src = '본문 [혜택 내용을 입력해주세요] 끝';
    expect(applyBenefitToBody(src, null)).toBe(src);
    expect(applyBenefitToBody(src, '   ')).toBe(src);
  });

  it('혜택 값에 $ 특수 패턴($&·$$)이 있어도 문자 그대로 들어간다 (replace 특수 패턴 미해석)', async () => {
    const { applyBenefitToBody } = await import('./autosend-policy');
    expect(applyBenefitToBody('본문 [혜택 내용을 입력해주세요] 끝', '커피 $5 & $& 할인 $$'))
      .toBe('본문 커피 $5 & $& 할인 $$ 끝');
  });
});

describe('hasUneditedBenefitPlaceholder — 발송 출구 가드 검출', () => {
  it('[혜택 대괄호·직접 입력/작성해주세요 잔존 = true', async () => {
    const { hasUneditedBenefitPlaceholder } = await import('./autosend-policy');
    expect(hasUneditedBenefitPlaceholder('본문 [혜택 내용을 입력해주세요]')).toBe(true);
    expect(hasUneditedBenefitPlaceholder('본문 [혜택 안내 — 직접 작성해주세요]')).toBe(true);
    expect(hasUneditedBenefitPlaceholder('혜택을 직접 입력해주세요 라고 남음')).toBe(true);
  });

  it('정상 문안(치환 완료·placeholder 없음) = false', async () => {
    const { hasUneditedBenefitPlaceholder } = await import('./autosend-policy');
    expect(hasUneditedBenefitPlaceholder('(광고) 이번 달 아메리카노 1잔 증정 안내')).toBe(false);
    expect(hasUneditedBenefitPlaceholder('')).toBe(false);
    expect(hasUneditedBenefitPlaceholder('혜택 가득한 하루')).toBe(false); // 대괄호 없는 일반 표현
  });
});

describe('decideExpiryReminder — 승인 대기 만료 임박 리마인드 판정', () => {
  const now = new Date('2026-07-10T00:00:00Z');
  it('pending + 만료 3일 안 + 미발송 = true', async () => {
    const { decideExpiryReminder } = await import('./autosend-policy');
    expect(decideExpiryReminder(
      { status: 'pending', expiresAt: new Date('2026-07-12T00:00:00Z'), reminderSentAt: null }, now,
    )).toBe(true);
  });

  it('만료까지 3일 초과 남음 = false (아직 이르다)', async () => {
    const { decideExpiryReminder } = await import('./autosend-policy');
    expect(decideExpiryReminder(
      { status: 'pending', expiresAt: new Date('2026-07-15T00:00:00Z'), reminderSentAt: null }, now,
    )).toBe(false);
  });

  it('이미 만료·이미 리마인드·pending 아님 = false', async () => {
    const { decideExpiryReminder } = await import('./autosend-policy');
    expect(decideExpiryReminder(
      { status: 'pending', expiresAt: new Date('2026-07-09T00:00:00Z'), reminderSentAt: null }, now,
    )).toBe(false);
    expect(decideExpiryReminder(
      { status: 'pending', expiresAt: new Date('2026-07-12T00:00:00Z'), reminderSentAt: new Date('2026-07-09T12:00:00Z') }, now,
    )).toBe(false);
    expect(decideExpiryReminder(
      { status: 'admin_review', expiresAt: new Date('2026-07-12T00:00:00Z'), reminderSentAt: null }, now,
    )).toBe(false);
    expect(decideExpiryReminder(
      { status: 'pending', expiresAt: null, reminderSentAt: null }, now,
    )).toBe(false);
  });
});

describe('buildExpiryReminderBody — 만료 임박 리마인드 문구', () => {
  it('오퍼레이터명·대상·비용·만료 시한·미승인 시 미발송 경고를 담는다', async () => {
    const { buildExpiryReminderBody } = await import('./autosend-policy');
    const body = buildExpiryReminderBody({
      operatorName: '3월 봄맞이 신규 관심 환기',
      expiresAtLabel: '3월 21일 08:00',
      recipientCount: 1200,
      costEstimate: 32400,
    });
    expect(body).toContain('3월 봄맞이 신규 관심 환기');
    expect(body).toContain('1,200명');
    expect(body).toContain('32,400원');
    expect(body).toContain('3월 21일 08:00');
    expect(body).toContain('만료');
    expect(body).toContain('발송되지 않습니다');
  });
});
