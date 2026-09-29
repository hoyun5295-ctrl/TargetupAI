/**
 * 이어달리기 생성 프리셋 — 추천의 약속을 지키는 장치 (2026-08-08, 설계서 §6)
 *
 * 기회 카드는 지금까지 목표 문장만 넘기고 트리거는 AI가 골랐다. 이어달리기에서 그대로 두면
 * "휴면 복귀 여정을 권했는데 AI가 재구매 여정을 만드는" 어긋남이 생긴다.
 *
 * 못 박는 것: **프롬프트 지시는 보장이 아니다.** AI가 무엇을 내든 트리거 축은 계약값으로 덮인다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn() },
}));
vi.mock('../services/ai', () => ({
  callAIWithFallback: vi.fn(),
  getKoreanCalendar: vi.fn(() => ''),
}));
vi.mock('./company-memory', () => ({ buildMemoryPromptContext: vi.fn(async () => '') }));
vi.mock('./brand-voice-prompt', () => ({ buildSystemPromptWithBrandVoice: vi.fn(async (_c: string, s: string) => s) }));
vi.mock('./company-data-profile', () => ({
  getCompanyDataProfile: vi.fn(async () => null),
  formatProfileForAiPrompt: vi.fn(() => ''),
}));

import { callAIWithFallback } from '../services/ai';
import { generateJourneyPackage } from './journey-ai-generator';
import { TRIGGER_CONTRACTS, aiSelectableTriggerEvents } from './journey-trigger-capability';
import { presetObjectiveFor } from './journey-opportunities';
import { editJourneyPackage } from './journey-ai-editor';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

/** AI는 프리셋과 **다른** 트리거를 낸다 — 그게 이 테스트의 요점이다. */
const AI_RESPONSE = JSON.stringify({
  name: '테스트 여정',
  templateCode: 'onboarding',
  triggerEvent: 'customer.created',
  triggerFilters: { recent_hours: 24, made_up: true },
  steps: [{ stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', subject: '안녕하세요', messageTemplate: '고객님 안녕하세요. 오늘도 좋은 하루 보내세요.', isAd: true, stepIntent: '인사' }],
  allowReentry: false,
  reentryCooldownDays: null,
  budgetMonthlyHint: null,
  thresholdCostHint: null,
  reasoning: '테스트',
});

const gen = (preferTriggerEvent?: string) =>
  generateJourneyPackage({ companyId: COMPANY_ID, createdBy: USER_ID, objective: '휴면에서 돌아온 고객 정착', preferTriggerEvent });

/** 다음 수 카드 = 클릭 한 번. 목표 문장을 화면이 지어내지 않는다. */
const genPresetOnly = (preferTriggerEvent: string) =>
  generateJourneyPackage({ companyId: COMPANY_ID, createdBy: USER_ID, preferTriggerEvent });

beforeEach(() => {
  ai.mockReset();
  ai.mockResolvedValue(AI_RESPONSE);
});

describe('프리셋이 있으면 트리거는 계약이 정한다', () => {
  it('AI가 다른 트리거를 내도 프리셋 값으로 덮인다', async () => {
    const pkg = await gen('customer.dormant_return');
    expect(pkg.triggerEvent, 'AI 출력에 약속을 걸면 추천과 다른 여정이 만들어진다').toBe('customer.dormant_return');
    expect(pkg.presetTriggerEvent).toBe('customer.dormant_return');
  });

  it('templateCode도 계약값으로 덮인다 (카드 모양·저장값이 트리거와 갈리지 않게)', async () => {
    const pkg = await gen('customer.dormant_return');
    expect(pkg.templateCode).toBe('repeat');
  });

  it('AI가 지어낸 트리거 조건은 싣지 않는다 (기본값은 추출기·워커가 소유한다)', async () => {
    const pkg = await gen('customer.dormant_return');
    expect(pkg.triggerFilters).toEqual({});
  });

  it('문안도 그 신호 전제로 쓰이게 프롬프트에 시작 신호를 넣는다 (내부 저장값 노출 없이)', async () => {
    await gen('customer.dormant_return');
    const userMessage = String(ai.mock.calls[0][0].userMessage);
    expect(userMessage).toContain('시작 신호 고정');
    expect(userMessage).toContain('휴면 복귀 고객');
    expect(userMessage, '저장값이 그대로 프롬프트에 들어가면 문안에 내부 용어가 샌다').not.toContain('customer.dormant_return');
  });

  it('목표 문장 없이 트리거만 와도 만들어진다 — 골격은 추천 문구에서 파생한다 (클릭 1회)', async () => {
    const pkg = await genPresetOnly('customer.dormant_return');
    expect(pkg.triggerEvent).toBe('customer.dormant_return');
    const userMessage = String(ai.mock.calls[0][0].userMessage);
    expect(userMessage, '화면이 자기 문장을 지어내면 같은 추천이 경로마다 다른 여정을 만든다').toContain('복귀 감사');
  });

  it('등록되지 않은 트리거는 만들지 않는다 (fail-closed)', async () => {
    await expect(gen('purchase.zzz')).rejects.toThrow(/지원하지 않는 발송 조건/);
    expect(ai, '거절은 AI 호출 전에 끝난다').not.toHaveBeenCalled();
  });

  it('구현되지 않은 트리거도 거절한다', async () => {
    await expect(gen('reservation.visit_dn')).rejects.toThrow(/지원하지 않는 발송 조건/);
  });
});

describe('고정된 트리거는 문안 수정으로 풀리지 않는다', () => {
  it('대화형 수정 뒤에도 트리거·표식이 남는다 (표식을 잃으면 저장에 트리거를 안 싣는다)', async () => {
    const pkg = await gen('customer.dormant_return');
    ai.mockResolvedValue(JSON.stringify({
      name: '수정된 여정',
      templateCode: 'onboarding',          // AI가 바꾸려 든다
      triggerEvent: 'customer.created',    // 발송 대상 자체가 달라지는 변경
      triggerFilters: { made_up: true },
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true, stepIntent: '인사' }],
      reasoning: '수정',
    }));
    const edited: any = await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: '2단계를 하루 늦춰줘' });
    expect(edited.triggerEvent).toBe('customer.dormant_return');
    expect(edited.templateCode).toBe('repeat');
    expect(edited.presetTriggerEvent).toBe('customer.dormant_return');
  });

  it('편집 AI에게도 같은 전제를 준다 — 메타데이터만 되돌리면 문안이 다른 대상 기준으로 남는다', async () => {
    const pkg = await gen('customer.dormant_return');
    ai.mockClear();
    ai.mockResolvedValue(JSON.stringify({
      name: '수정', templateCode: 'repeat', triggerEvent: 'customer.dormant_return',
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true }],
      reasoning: '수정',
    }));
    await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: '문안을 짧게' });
    const userMessage = String(ai.mock.calls[0][0].userMessage);
    expect(userMessage).toContain('시작 신호 고정');
    expect(userMessage).toContain('휴면 복귀 고객');
  });

  it('같은 트리거에 조건만 붙여도 이탈로 본다 — 조건은 비우면서 좁혔다고 답하면 안 된다', async () => {
    const pkg = await gen('customer.dormant_return');
    ai.mockResolvedValue(JSON.stringify({
      name: '수정', templateCode: 'repeat',
      triggerEvent: 'customer.dormant_return',            // 트리거는 그대로인데
      triggerFilters: { customer_conditions: [{ field: 'grade', value: 'VIP' }] },   // 조건만 붙였다
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true }],
      reasoning: 'VIP 고객에게만 발송하도록 변경했습니다',
    }));
    const edited: any = await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: 'VIP만 보내줘' });
    expect(edited.triggerFilters).toEqual({});
    expect(edited.reasoning, '좁혀졌다고 믿고 넓은 대상으로 활성화하게 된다').not.toContain('VIP');
    expect(edited.reasoning).toContain('대상은 바꾸지 않았습니다');
  });

  it('대상을 바꾸려 든 응답은 조용히 되돌리지 않고 사유에 적는다', async () => {
    const pkg = await gen('customer.dormant_return');
    ai.mockResolvedValue(JSON.stringify({
      name: '수정', templateCode: 'onboarding', triggerEvent: 'customer.created',
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true }],
      reasoning: '대상을 신규 가입으로 바꿨습니다',
    }));
    const edited: any = await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: '신규 가입 고객으로 바꿔줘' });
    expect(edited.reasoning, '바뀌지 않았는데 바뀐 것처럼 답하지 않는다').toContain('대상은 바꾸지 않았습니다');
    expect(edited.reasoning, '대상을 옮긴 전제로 쓰인 설명은 문안 부분도 믿을 수 없다 — 서버 문장으로 교체한다').not.toContain('신규 가입으로 바꿨습니다');
    expect(edited.triggerEvent).toBe('customer.dormant_return');
  });

  it('프리셋 없는 패키지의 수정은 옛 흐름 그대로다', async () => {
    const pkg = await gen();
    ai.mockResolvedValue(JSON.stringify({
      name: '수정된 여정',
      templateCode: 'dormant',
      triggerEvent: 'customer.dormant',
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true, stepIntent: '인사' }],
      reasoning: '수정',
    }));
    const edited: any = await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: '휴면 여정으로 바꿔줘' });
    expect(edited.triggerEvent).toBe('customer.dormant');
    expect(edited.presetTriggerEvent).toBeNull();
  });
});

describe('지어낸 혜택은 기계로 되돌린다 (프롬프트는 경계가 아니다)', () => {
  const withBenefit = JSON.stringify({
    name: '테스트 여정', templateCode: 'repeat', triggerEvent: 'cdp.purchase', triggerFilters: {},
    steps: [{ stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', subject: '30% 할인 안내', messageTemplate: '고객님 안녕하세요. 지금 오시면 30% 할인해 드려요.', isAd: true, stepIntent: '유도' }],
    allowReentry: false, reentryCooldownDays: null, reasoning: '테스트',
  });

  it('목표에 없는 할인율은 본문·제목에서 사라진다 (프리셋 1클릭 경로는 근거가 아예 없다)', async () => {
    ai.mockResolvedValue(withBenefit);
    const pkg = await genPresetOnly('customer.dormant_return');
    expect(pkg.steps[0].messageTemplate).not.toContain('30%');
    expect(pkg.steps[0].subject).not.toContain('30%');
  });

  it('사용자가 목표에 적은 혜택은 근거라 살아남는다', async () => {
    ai.mockResolvedValue(withBenefit);
    const pkg = await generateJourneyPackage({
      companyId: COMPANY_ID, createdBy: USER_ID,
      objective: '이번 주 30% 할인 행사를 알리는 여정',
    });
    expect(pkg.steps[0].messageTemplate, '근거가 있는 혜택까지 지우면 사용자가 시킨 일을 못 한다').toContain('30%');
  });
});

describe('프리셋이 없으면 옛 흐름 그대로 (하위호환)', () => {
  it('AI가 고른 트리거가 그대로 남고 프리셋 표식은 없다', async () => {
    const pkg = await gen();
    expect(pkg.triggerEvent).toBe('customer.created');
    expect(pkg.templateCode).toBe('onboarding');
    expect(pkg.triggerFilters).toEqual({ recent_hours: 24, made_up: true });
    expect(pkg.presetTriggerEvent, '표식이 없어야 화면이 저장에 트리거를 싣지 않는다').toBeNull();
  });

  it('시작 신호 고정 문구를 프롬프트에 넣지 않는다', async () => {
    await gen();
    expect(String(ai.mock.calls[0][0].userMessage)).not.toContain('시작 신호 고정');
  });
});

/**
 * ★ 2026-09-30 여정 V2 (0930 Harold 접수) — 지도 · 빈 곳 찾기의 [만들기]는 시작 사건만 넘긴다(목표 문장 없음).
 *   옛 생성기는 이어받는 3종에만 목표 문장이 있어 가입 · 장바구니 · 생일 등에서 개발용 문구 500 으로 멈췄다.
 *   AI 마케팅 여정이 받는 시작 사건 전부(= 생성기의 수용 목록 aiSelectableTriggerEvents · 지도 빈 자리 · 선 고치기 · 빈 곳 찾기가 내보내는 것은
 *   전부 이 안이다 · 예약은 정보 알림 축 · 상품 재구매는 상품 고르기 창)를 한 번씩 통과시킨다.
 */
describe('시작 사건만 온 1클릭 생성 = 켤 수 있는 모든 시작 사건에서 만들어진다', () => {
  const selectable = new Set(aiSelectableTriggerEvents());
  const presetable = TRIGGER_CONTRACTS.filter((c) => selectable.has(c.event));

  it('목표 골격: 켤 수 있는 시작 사건마다 문장이 있고 · 혜택 숫자 · 내부 이름이 없다', () => {
    expect(presetable.length).toBeGreaterThan(10);
    for (const c of TRIGGER_CONTRACTS.filter((x) => x.implemented)) {
      const o = presetObjectiveFor(c.event);
      expect(o, `${c.event} 목표 문장 없음`).toBeTruthy();
      // 날짜 이름(생일 D-7)의 숫자는 혜택이 아니다 — 혜택 표현만 본다.
      expect(o!, `${c.event}: 프리셋 경로는 혜택 근거가 없다`).not.toMatch(/%|\d+\s*원|쿠폰|무료|할인|적립/);
      expect(o!, `${c.event}: 저장값이 문장에 새면 문안에 내부 용어가 샌다`).not.toContain(c.event);
    }
    expect(presetObjectiveFor('reservation.visit_dn'), '켤 수 없는 시작 사건은 문장을 만들지 않는다').toBeNull();
    expect(presetObjectiveFor('purchase.zzz')).toBeNull();
  });

  it('이어받는 3종은 추천 카드와 같은 문장 그대로(하위호환)', () => {
    expect(presetObjectiveFor('customer.dormant_return')).toContain('복귀 감사');
    expect(presetObjectiveFor('purchase.first')).toContain('두 번째 구매');
  });

  it('화면이 만들 수 있는 시작 사건 전부 = 목표 문장 없이 생성 성공 · 시작 사건은 그대로 · 파생 문장이 AI 에 간다', async () => {
    for (const c of presetable) {
      ai.mockClear();
      const pkg = await genPresetOnly(c.event);
      expect(pkg.triggerEvent, `${c.event} 시작 사건이 바뀌었다`).toBe(c.event);
      const userMessage = String(ai.mock.calls[0][0].userMessage);
      expect(userMessage, `${c.event} 파생 목표가 AI 에 안 갔다`).toContain(presetObjectiveFor(c.event)!);
    }
  });
});
