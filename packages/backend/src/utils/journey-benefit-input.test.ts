/**
 * 혜택 입력 — placeholder 텍스트 수술 폐기 (2026-08-08, Harold 접수)
 *
 * 혜택은 AI가 못 지어내는 유일한 값이라 사용자 입력이 정당한 자리다. 값만 받고 치환은 기계가 한다.
 *
 * 못 박는 것:
 *   1. 입력한 혜택은 차단기의 허용 근거가 된다 — 살아남는다.
 *   2. 그 밖의 혜택은 여전히 창작이다 — placeholder로 되돌아간다(차단기 완화가 아니다).
 *   3. 패키지가 혜택을 기억한다 — 재생성·편집이 같은 혜택을 다시 싣는다(프리셋 유실과 같은 뿌리).
 *   4. 프론트 치환 규약은 백엔드 차단기가 심는 값과 실값으로 맞는다(문자열 grep 아님).
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
import { editJourneyPackage } from './journey-ai-editor';
import { BENEFIT_PLACEHOLDER } from './copy-benefit-detector';
// 프론트 규약을 **실제 import**로 대조한다 — 문자열 grep은 형태가 조금만 달라도 통과한다.
import {
  hasBenefitPlaceholder, fillBenefitPlaceholders,
  hasUrlPlaceholder, fillUrlPlaceholders, isSendableUrl,
} from '../../../frontend/src/utils/message-placeholders';

const ai = callAIWithFallback as unknown as ReturnType<typeof vi.fn>;
const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

/** AI가 입력한 혜택(10% 쿠폰)과 지어낸 혜택(30% 할인)을 함께 낸다 — 갈리는지가 요점이다. */
const AI_MIXED = JSON.stringify({
  name: '테스트 여정', templateCode: 'repeat', triggerEvent: 'cdp.purchase', triggerFilters: {},
  steps: [{
    stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms',
    subject: '다시 찾아주셔서 감사해요',
    messageTemplate: '고객님 안녕하세요. 신규 가입 10% 쿠폰을 준비했어요. 그리고 오늘만 30% 할인도 드려요.',
    isAd: true, stepIntent: '재구매 유도',
  }],
  allowReentry: false, reentryCooldownDays: null, budgetMonthlyHint: null, thresholdCostHint: null, reasoning: '테스트',
});

beforeEach(() => {
  ai.mockReset();
  ai.mockResolvedValue(AI_MIXED);
});

const gen = (benefitText?: string) =>
  generateJourneyPackage({ companyId: COMPANY_ID, createdBy: USER_ID, objective: '재구매 유도 여정', benefitText });

describe('입력한 혜택은 살고, 지어낸 혜택은 되돌아간다', () => {
  it('혜택을 입력하면 그 혜택만 본문에 남는다', async () => {
    const pkg = await gen('신규 가입 10% 쿠폰');
    expect(pkg.steps[0].messageTemplate).toContain('10% 쿠폰');
    expect(pkg.steps[0].messageTemplate, '입력에 없는 혜택은 여전히 창작이다').not.toContain('30%');
    expect(pkg.benefitText).toBe('신규 가입 10% 쿠폰');
  });

  it('혜택 미입력이면 전부 placeholder로 되돌아간다 (기존 동작)', async () => {
    const pkg = await gen();
    expect(pkg.steps[0].messageTemplate).not.toContain('10%');
    expect(pkg.steps[0].messageTemplate).not.toContain('30%');
    expect(pkg.benefitText).toBeNull();
  });

  it('프롬프트에 혜택 지시가 들어간다 — 입력했을 때만', async () => {
    await gen('신규 가입 10% 쿠폰');
    expect(String(ai.mock.calls[0][0].userMessage)).toContain('사용 가능한 혜택');
    ai.mockClear();
    ai.mockResolvedValue(AI_MIXED);
    await gen();
    expect(String(ai.mock.calls[0][0].userMessage)).not.toContain('사용 가능한 혜택');
  });

  it('상한 200자를 넘는 입력은 잘라서 쓴다', async () => {
    const long = '가'.repeat(300);
    const pkg = await gen(long);
    expect(pkg.benefitText?.length).toBe(200);
  });

  it('전용 입력이 있으면 목표문의 다른 혜택은 근거가 아니다 (Codex 1R — 모순 입력에서 전용 입력이 이긴다)', async () => {
    ai.mockResolvedValue(JSON.stringify({
      name: '테스트', templateCode: 'repeat', triggerEvent: 'cdp.purchase', triggerFilters: {},
      steps: [{ stepOrder: 1, stepType: 'message', delayHours: 0, channel: 'lms', subject: '안내',
        messageTemplate: '고객님 안녕하세요. 20% 쿠폰 행사와 신규 가입 10% 쿠폰을 드려요.', isAd: true, stepIntent: '유도' }],
      allowReentry: false, reentryCooldownDays: null, reasoning: '테스트',
    }));
    const pkg = await generateJourneyPackage({
      companyId: COMPANY_ID, createdBy: USER_ID,
      objective: '20% 쿠폰 행사를 알리는 여정',        // 목표문에 다른 혜택
      benefitText: '신규 가입 10% 쿠폰',               // 전용 입력
    });
    expect(pkg.steps[0].messageTemplate).toContain('10% 쿠폰');
    expect(pkg.steps[0].messageTemplate, '목표문 혜택까지 살리면 "이것 하나뿐"이 경계가 아니다').not.toContain('20%');
  });

  it('예외는 system 프롬프트에도 적힌다 (userMessage에만 두면 상위 규칙이 이긴다)', async () => {
    await gen('신규 가입 10% 쿠폰');
    const system = String(ai.mock.calls[0][0].system);
    expect(system).toContain('회사가 승인한 혜택');
    expect(system).toContain('신규 가입 10% 쿠폰');
    ai.mockClear();
    ai.mockResolvedValue(AI_MIXED);
    await gen();
    expect(String(ai.mock.calls[0][0].system)).not.toContain('회사가 승인한 혜택');
  });

  // ★ Codex 2R — 프롬프트의 허용 범위 = 차단기 근거. strip은 지우기만 한다 —
  //   AI가 좁은 프롬프트를 따라 placeholder를 내면 승인 혜택을 복원할 길이 없다.
  it('전용 입력이 없으면 목표문 혜택 허용이 system에 적힌다 (basis 폴백과 같은 집합)', async () => {
    await gen();   // objective만 있는 하위호환 경로
    const system = String(ai.mock.calls[0][0].system);
    expect(system, '프롬프트가 basis보다 좁으면 목표문에 적은 혜택이 placeholder로 나와 되살릴 수 없다')
      .toContain('목표문에 직접 적은 구체 혜택');
    ai.mockClear();
    ai.mockResolvedValue(AI_MIXED);
    await gen('신규 가입 10% 쿠폰');
    // 전용 입력이 있으면 목표문 혜택은 근거가 아니다 — 허용 문구도 함께 사라져야 한다.
    expect(String(ai.mock.calls[0][0].system)).not.toContain('목표문에 직접 적은 구체 혜택');
  });
});

describe('패키지가 혜택을 기억한다 — 재생성·편집 축', () => {
  it('대화형 수정 뒤에도 benefitText가 남는다 (없어지면 다시 만들기 한 번에 placeholder로 되돌아간다)', async () => {
    const pkg = await gen('신규 가입 10% 쿠폰');
    ai.mockResolvedValue(JSON.stringify({
      name: '수정', templateCode: 'repeat', triggerEvent: 'cdp.purchase',
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: '수정된 본문입니다. 고객님 안녕하세요.', isAd: true }],
      reasoning: '수정',
    }));
    const edited: any = await editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction: '문안을 짧게' });
    expect(edited.benefitText).toBe('신규 가입 10% 쿠폰');
  });
});

describe('편집 결과도 같은 기계 차단을 지난다 (Codex 1R — 메타데이터와 문안이 갈리면 안 된다)', () => {
  const editWith = async (pkg: any, editedBody: string, instruction = '문안을 짧게') => {
    ai.mockResolvedValue(JSON.stringify({
      name: '수정', templateCode: 'repeat', triggerEvent: 'cdp.purchase',
      steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '제목', messageTemplate: editedBody, isAd: true }],
      reasoning: '수정',
    }));
    return editJourneyPackage({ companyId: COMPANY_ID, currentPackage: pkg, instruction });
  };

  it('편집 프롬프트가 승인 혜택을 예외로 명시한다 — placeholder 유지 규칙과 충돌하지 않게', async () => {
    const pkg = await gen('신규 가입 10% 쿠폰');
    ai.mockClear();
    await editWith(pkg, '수정된 본문입니다. 고객님 안녕하세요.');
    expect(String(ai.mock.calls[0][0].system)).toContain('신규 가입 10% 쿠폰');
  });

  // ★ Codex 2R — 편집 프롬프트의 허용 집합은 editBasis(요청문 + 기존 문안 + 승인 혜택)와 같아야 한다.
  //   기존 문안 혜택·요청문 혜택을 프롬프트가 금지하면, AI가 지운 것을 strip이 복원하지 못한다.
  it('편집 프롬프트가 기존 문안·요청문의 혜택 유지를 명시한다 — benefitText 유무와 무관', async () => {
    const pkg = await gen();   // benefitText 없는 패키지
    ai.mockClear();
    await editWith(pkg, '수정된 본문입니다. 고객님 안녕하세요.');
    const system = String(ai.mock.calls[0][0].system);
    expect(system).toContain('이미 있는 혜택');
    expect(system).toContain('수정 요청문에 적힌 혜택');
  });

  it('AI가 편집 중 지어낸 새 혜택은 placeholder로 되돌아간다', async () => {
    const pkg = await gen('신규 가입 10% 쿠폰');
    const edited: any = await editWith(pkg, '고객님 안녕하세요. 오늘만 25% 할인해 드려요.');
    expect(edited.steps[0].messageTemplate).not.toContain('25%');
    expect(edited.steps[0].messageTemplate).toContain(BENEFIT_PLACEHOLDER);
  });

  it('편집 전 본문에 있던 혜택은 산다 (비파괴 — 기존 문안이 근거다)', async () => {
    const pkg = await gen('신규 가입 10% 쿠폰');   // 본문에 10% 쿠폰이 들어 있다
    const edited: any = await editWith(pkg, '짧게 줄인 본문이에요. 신규 가입 10% 쿠폰 잊지 마세요.');
    expect(edited.steps[0].messageTemplate).toContain('10% 쿠폰');
  });

  it('수정 요청문에 쓴 혜택도 사용자 입력이라 산다', async () => {
    const pkg = await gen();
    const edited: any = await editWith(pkg, '고객님, 5,000원 적립을 드려요.', '5,000원 적립 문구를 넣어줘');
    expect(edited.steps[0].messageTemplate).toContain('5,000원 적립');
  });
});

describe('프론트 치환 규약 ↔ 백엔드 차단기 (실값 대조)', () => {
  it('차단기가 심는 placeholder를 프론트가 알아본다', () => {
    expect(hasBenefitPlaceholder(BENEFIT_PLACEHOLDER)).toBe(true);
    expect(hasBenefitPlaceholder(`안녕하세요.\n${BENEFIT_PLACEHOLDER}\n감사합니다.`)).toBe(true);
  });

  it('인앱 표기(작성해주세요)도 알아본다 — placeholder 표기가 두 벌이다(실측)', () => {
    expect(hasBenefitPlaceholder('[혜택 안내 — 직접 작성해주세요]')).toBe(true);
  });

  it('placeholder가 아닌 대괄호는 건드리지 않는다', () => {
    expect(hasBenefitPlaceholder('[URL 입력]')).toBe(false);
    expect(hasBenefitPlaceholder('[혜택전] 안내')).toBe(false);
    expect(fillBenefitPlaceholders('자세히 → [URL 입력]', '10% 쿠폰')).toBe('자세히 → [URL 입력]');
  });

  it('정상 안내문은 placeholder가 아니다 — 완전 문구 요구 (Codex 1R: 낱개 키워드 매칭이 안내문을 지웠다)', () => {
    const normal = '[혜택은 앱에서 직접 확인하세요]';
    expect(hasBenefitPlaceholder(normal)).toBe(false);
    expect(fillBenefitPlaceholders(`자세한 내용: ${normal}`, '10% 쿠폰')).toBe(`자세한 내용: ${normal}`);
  });

  it('치환은 전 자리·원문 보존이다', () => {
    const src = `첫 혜택: ${BENEFIT_PLACEHOLDER}\n두 번째: ${BENEFIT_PLACEHOLDER} → [URL 입력]`;
    const out = fillBenefitPlaceholders(src, '신규 가입 10% 쿠폰');
    expect(out).toBe('첫 혜택: 신규 가입 10% 쿠폰\n두 번째: 신규 가입 10% 쿠폰 → [URL 입력]');
    expect(fillBenefitPlaceholders(src, '  ')).toBe(src);   // 빈 혜택은 원문 그대로
  });

  it('치환된 본문은 활성화 게이트를 통과할 형태다 (placeholder 잔존 0)', () => {
    const out = fillBenefitPlaceholders(`본문 ${BENEFIT_PLACEHOLDER} 끝`, '5,000원 적립');
    expect(hasBenefitPlaceholder(out)).toBe(false);
  });
});

/**
 * ★ 2026-08-08 (Harold 접수) — 혜택만 값으로 받고 링크는 손으로 고치게 두면 반쪽이다.
 *   `[URL 입력]`은 생성기 프롬프트가 심는 고정 표기다(같은 축·같은 처방).
 */
describe('링크 placeholder — 혜택과 같은 규약', () => {
  it('생성기가 심는 표기를 알아본다', () => {
    expect(hasUrlPlaceholder('자세히 → [URL 입력]')).toBe(true);
    expect(hasUrlPlaceholder('자세히 → [ url 입력 ]'), '공백·대소문자만 관용').toBe(true);
  });

  it('혜택 placeholder와 서로를 건드리지 않는다', () => {
    expect(hasUrlPlaceholder(BENEFIT_PLACEHOLDER)).toBe(false);
    expect(hasBenefitPlaceholder('[URL 입력]')).toBe(false);
    expect(fillUrlPlaceholders(BENEFIT_PLACEHOLDER, 'https://a.com')).toBe(BENEFIT_PLACEHOLDER);
    expect(fillBenefitPlaceholders('[URL 입력]', '10% 쿠폰')).toBe('[URL 입력]');
  });

  it('치환은 전 자리·원문 보존이다', () => {
    const out = fillUrlPlaceholders('첫 링크 [URL 입력]\n두 번째 [URL 입력]', 'https://hanjul.ai/e/1');
    expect(out).toBe('첫 링크 https://hanjul.ai/e/1\n두 번째 https://hanjul.ai/e/1');
    expect(hasUrlPlaceholder(out)).toBe(false);
  });

  it('발송 가능한 주소만 받는다 — 스킴을 우리가 붙이지 않는다', () => {
    expect(isSendableUrl('https://hanjul.ai/event')).toBe(true);
    expect(isSendableUrl('http://hanjul.ai')).toBe(true);
    expect(isSendableUrl('hanjul.ai'), '스킴 없는 값을 우리가 보정하면 의도와 다른 주소가 나갈 수 있다').toBe(false);
    expect(isSendableUrl('https://주소 띄어쓰기')).toBe(false);
    expect(isSendableUrl('')).toBe(false);
  });
});
