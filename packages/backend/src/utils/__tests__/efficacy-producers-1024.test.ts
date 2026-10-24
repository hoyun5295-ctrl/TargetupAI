/**
 * ★ 2026-10-24 세 채널 구조체크 ② — 효능 거름 독 탐침(설계서 docs/2026-10-24-efficacy-guard-design.md §7 (다) · 뿌리 대장 R13)
 *
 * 가짜 AI 가 모든 글 칸에 근거 없는 효능 문장을 넣어도 결과 어느 칸에도 남지 않는다 ·
 * 근거(사람 글)에 있는 기능 문구(주름 개선 기능성)는 남는다 · AI 파생 입력(spec · sg.before)에만 있는 주장도 빠진다 ·
 * 뺀 것이 있으면 안내 수(notes 재료)가 0 이 아니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const aiMock = vi.fn(async (_p: any): Promise<string> => '{}');
vi.mock('../../services/ai', () => ({ callAIWithFallback: (p: any) => aiMock(p), getSeasonContext: () => ({ month: 10, season: '가을', keywords: [] }) }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../copy-prompt-composer', () => ({ composeCopyBrain: async () => ({ promptSuffix: '', examples: [] }) }));
vi.mock('../brand-voice-prompt', () => ({ buildSystemPromptWithBrandVoice: async (_c: string, s: string) => s }));
vi.mock('../best-copy-assets', () => ({ getStructureSkeleton: async () => null }));
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: async () => '' }));
vi.mock('../company-data-profile', () => ({ getCompanyDataProfile: async () => null, formatProfileForAiPrompt: () => '' }));

import { claimsInventedEfficacy, efficacyNote, EFFICACY_PROMPT_RULES } from '../copy-benefit-detector';
import { generateEmailSections, refineEmail, refineEmailSections } from '../email-ai';
import { generateCopy, improveMessage } from '../dm/dm-ai';
import { sanitizeDmCopyBenefits } from '../sales-outreach-produce';
import { generateInAppMessagePackage } from '../inapp-ai-generator';
import { runInCreditBundle } from '../ai-credit-context';
import { query } from '../../config/database';
import { guardReadingSequence, dropInventedEfficacyTitledBody, htmlVisibleText, readingUnit, dropInventedEfficacyDeep, readingAddsEfficacy } from '../copy-benefit-detector';
import { applyQuickAction } from '../dm/dm-quick-action';
import { generateSnsCaption } from '../sns-caption-ai';
import { editJourneyPackage } from '../journey-ai-editor';

/** 객체 트리의 글 전부 */
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const POISON = '바르면 피부가 몰라보게 좋아져요.';
const GROUND = '주름 개선 기능성 세럼 신제품 안내';
const leftovers = (v: unknown, ground: string) => strings(v).filter((s) => claimsInventedEfficacy(s, ground));

beforeEach(() => { aiMock.mockReset(); });

describe('이메일 블록 생성 = 독 탐침', () => {
  it('모든 칸의 근거 없는 효능이 빠지고 · 근거 기능 문구는 남고 · 뺀 수가 안내 문장이 된다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({
      name: '가을 세럼', subjects: ['피부가 좋아지는 세럼', '가볍게 스며드는 세럼'], preheader: POISON,
      blocks: [
        { type: 'hero', props: { headline: '피부가 좋아지는 세럼', sub_copy: '주름 개선 기능성 세럼이에요' } },
        { type: 'text_card', props: { tag: '피부가 맑아져요', headline: '가볍게 스며드는 제형', body: `끈적임 없이 스며들어요. ${POISON}` } },
        { type: 'cta', props: { buttons: [{ label: '피부가 좋아지는 경험', url: '' }] } },
      ],
    }));
    const r = await generateEmailSections({ companyId: 'c1', prompt: GROUND, isAd: true });
    expect(leftovers(r, GROUND)).toEqual([]);
    expect(JSON.stringify(r.sections)).toContain('주름 개선 기능성 세럼이에요');
    expect(JSON.stringify(r.sections)).toContain('끈적임 없이 스며들어요.');
    expect(r.subjects[0]).toBe('가볍게 스며드는 세럼');
    expect(r.preheader).toBe('');
    expect(r.efficacyDropped).toBeGreaterThan(0);
    expect(efficacyNote('generate', r.efficacyDropped)).toBeTruthy();
    expect(String(aiMock.mock.calls[0][0].system)).toContain(EFFICACY_PROMPT_RULES);
  });
  it('근거 = 사람 글만(우리 규칙 문장 「쿠폰 · 무료 · 사은품」 · 시나리오 프리셋은 근거가 아니다)', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subjects: ['무료 배송 소식'], blocks: [{ type: 'hero', props: { headline: '무료 배송 시작', sub_copy: '지금 만나 보세요' } }] }));
    const r = await generateEmailSections({ companyId: 'c1', eventText: '가을 신상 입고', isAd: true });
    expect(JSON.stringify(r)).not.toContain('무료');
  });
  it('제목 후보가 다 빠지면 채울 자리(옛 「새 이메일」 무언 대체 0)', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subjects: ['피부가 좋아지는 세럼'], blocks: [{ type: 'hero', props: { headline: '가을 세럼', sub_copy: '가볍게 스며들어요' } }] }));
    const r = await generateEmailSections({ companyId: 'c1', prompt: '가을 세럼', isAd: true });
    expect(r.subjects[0]).toBe('[헤드라인을 작성해주세요]');
  });
});

describe('이메일 다듬기 = 효능을 새로 쓰면 원래 글', () => {
  it('블록 다듬기: 효능이 생긴 조각은 원래 글 · 바뀐 조각 0 = changed:false(차감 0)', async () => {
    aiMock.mockImplementation(async (p: any) => {
      const arr = JSON.parse(String(p.userMessage).slice(String(p.userMessage).indexOf('\n[') + 1).replace(/^[^\n]*\n/, ''));
      return JSON.stringify({ texts: arr.map((t: string) => `${t} ${POISON}`) });
    });
    const sections: any[] = [{ id: 't1', type: 'text_card', order: 1, visible: true, props: { tag: 'NEW', headline: '가을 세럼', body: '끈적임 없이 스며들어요.' } }];
    const r = await refineEmailSections({ companyId: 'c1', sections });
    expect(r.changed).toBe(false);
    expect(r.rejected).toBeGreaterThan(0);
    expect(JSON.stringify(r.sections)).not.toContain('몰라보게');
  });
  it('HTML 다듬기: 효능이 생기면 적용하지 않는다(차감 전 오류 · 효능을 말한다)', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subject: '가을 세럼', html_body: `<p>끈적임 없이 스며들어요.</p><p>${POISON}</p>` }));
    await expect(refineEmail({ companyId: 'c1', subject: '가을 세럼', htmlBody: '<p>끈적임 없이 스며들어요.</p>', instruction: '더 부드럽게' })).rejects.toThrow(/효능/);
  });
});

describe('DM 생성 · 개선 = 독 탐침 + 자기 참조', () => {
  it('생성: spec(AI 파생)에만 있는 효능 주장은 근거가 아니다 · 헤드라인이 다 빠지면 재생성 1회 → 그래도면 채울 자리', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ headlines: [{ style: 'direct', text: '피부가 좋아지는 세럼' }], subCopies: [POISON] }));
    const spec: any = { brand: { name: 'b' }, objective: '피부가 좋아지는 세럼 홍보', target: {}, tone: 'friendly', industry: 'beauty' };
    const r: any = await generateCopy(spec, { id: 's1', type: 'hero', props: {} } as any, 'c1', undefined, '', '가을 세럼 출시');
    expect(aiMock).toHaveBeenCalledTimes(2);
    expect(leftovers(r, '가을 세럼 출시')).toEqual([]);
    expect(r.headlines[0].text).toBe('[헤드라인을 작성해주세요]');
    expect(r.efficacyDropped).toBeGreaterThan(0);
  });
  it('개선: 근거 = 실제 칸 값(AI 가 돌려준 sg.before 가 아니다) · 효능이 생긴 제안은 버리고 센다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [{ section_id: 's1', field: 'headline', before: '피부가 좋아지는 세럼', after: '피부가 좋아지는 세럼', reason: 'x' }] }));
    const r = await improveMessage([{ id: 's1', type: 'hero', order: 1, visible: true, props: { headline: '가볍게 스며드는 세럼' } } as any], undefined, 'c1');
    expect(r.suggestions).toEqual([]);
    expect(r.rejected).toBe(1);
  });
});

describe('AI 영업 · 고객 입구 거름(sanitizeDmCopyBenefits · 엔진 deps.sanitize · 브랜드 이메일 공용)', () => {
  it('긴 칸 = 효능 문장만 · 짧은 칸 = 칸째 · 버튼 = 「자세히 보기」 · 헤드라인 비면 업체명 · 면허 인용의 기능 문구는 남는다', () => {
    const sections: any[] = [
      { id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '피부가 좋아지는 세럼', sub_copy: '가을 신상' } },
      { id: 't', type: 'text_card', order: 2, visible: true, props: { tag: '피부가 맑아져요', headline: '주름 개선 기능성 세럼', body: `끈적임 없이 스며들어요. ${POISON}` } },
      { id: 'c', type: 'cta', order: 3, visible: true, props: { buttons: [{ label: '피부가 좋아지는 경험', url: 'https://x.test' }] } },
    ];
    const r = sanitizeDmCopyBenefits(sections, '주름 개선 기능성 세럼 출시', '브랜드');
    expect(leftovers(r.sections, '주름 개선 기능성 세럼 출시')).toEqual([]);
    expect(r.heroFallback).toBe(true);
    expect(JSON.stringify(r.sections)).toContain('주름 개선 기능성 세럼');
    expect(JSON.stringify(r.sections)).toContain('끈적임 없이 스며들어요.');
    expect(JSON.stringify(r.sections)).toContain('자세히 보기');
    expect(r.efficacyStripped).toBeGreaterThanOrEqual(4);
  });
});

describe('인앱 생성 = 독 탐침', () => {
  it('제목 · 본문이 효능으로 다 빠지면 재생성 1회 · 블록 · 버튼 · 머리글도 거른다 · 뺀 수를 돌려준다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({
      title: '피부가 좋아지는 세럼', body: POISON, badge_text: '피부가 맑아져요', template: 'center_modal',
      buttons: [{ id: 'b1', label: '피부가 좋아지는 경험', action_url: null, style: 'primary' }],
      content_blocks: [{ type: 'headline', text: '피부가 좋아지는 세럼' }, { type: 'body', text: `가볍게 스며들어요. ${POISON}` }],
    }));
    const pkg = await runInCreditBundle(() => generateInAppMessagePackage({ companyId: 'c1', createdBy: 'u1', objective: '가을 세럼 신제품 알리기' } as any));
    expect(aiMock).toHaveBeenCalledTimes(2);
    expect(leftovers(pkg.message, '가을 세럼 신제품 알리기')).toEqual([]);
    expect(pkg.message.title).toBe('[헤드라인을 작성해주세요]');
    expect(pkg.message.buttons[0].label).toBe('자세히 보기');
    expect(JSON.stringify(pkg.message.content_blocks)).toContain('가볍게 스며들어요.');
    expect(pkg.efficacyDropped).toBeGreaterThan(0);
    expect(String(aiMock.mock.calls[0][0].system)).toContain(EFFICACY_PROMPT_RULES);
  });
});

describe('채울 자리 안내 = 자리 글자 인용(혜택 자리가 아닌 자리에 「혜택 안내를…」이 뜨지 않는다)', () => {
  const FILL = '[상품 소개: 직접 작성해주세요]';
  it('인앱 게시 관문 · 화면 사본(inappSlides) 짝 — 같은 순서 · 같은 자리 글자', async () => {
    const { inAppPublishDefect } = await import('../inapp-message');
    const { publishDefectOf } = await import('../../../../frontend/src/components/inapp/inappSlides');
    const base = { title: '가을 세럼', template: 'center_modal', buttons: [], content_blocks: [] };
    for (const d of [inAppPublishDefect({ ...base, body: `가볍게 스며들어요. ${FILL}` }), publishDefectOf({ ...base, body: `가볍게 스며들어요. ${FILL}` })]) {
      expect(d?.field).toBe('placeholder');
      expect(d?.message).toContain(FILL);
    }
    for (const d of [inAppPublishDefect({ ...base, body: '[혜택 안내: 직접 작성해주세요]' }), publishDefectOf({ ...base, body: '[혜택 안내: 직접 작성해주세요]' })]) {
      expect(d?.message).toContain('혜택 안내를 회사 정책에 맞게');
    }
  });
  it('DM 첫 발행 · 보내기 관문 · 플래너 거부 사유도 자리 글자로 말한다', async () => {
    const { dmPublishStaticBlock } = await import('../dm/dm-publish-gate');
    const b = dmPublishStaticBlock({ sections: [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '가을 세럼', sub_copy: FILL } }] } as any);
    expect(b?.code).toBe('UNEDITED_PLACEHOLDER');
    expect(b?.error).toContain(FILL);
    const { sendRejectReason } = await import('../planner-reasons');
    const { fillPlaceholderError } = await import('../send-placeholder-gate');
    expect(sendRejectReason('BENEFIT_PLACEHOLDER_UNEDITED', fillPlaceholderError(FILL))).toContain(FILL);
    expect(sendRejectReason('BENEFIT_PLACEHOLDER_UNEDITED', fillPlaceholderError('[혜택 내용을 입력해주세요]'))).toBe('문안에 채워지지 않은 혜택 자리가 있습니다.');
  });
});

describe('Codex 1R — 이어 읽는 단위(따로 본 칸이 고객 눈에는 이어 읽힌다)', () => {
  const PAIR_A = '피부 고민';
  const PAIR_B = '매끈하게 달라져요';
  it('어댑터: 이웃 둘을 이어 읽어 걸리면 비워도 되는 쪽(둘 다 필수면 뒤 칸) · 빈 칸은 건너뛰고 잇는다', () => {
    expect(guardReadingSequence([{ text: PAIR_A, fallback: 'H' }, { text: PAIR_B, fallback: 'B' }], '수분 세럼')).toEqual([PAIR_A, 'B']);
    expect(guardReadingSequence([{ text: PAIR_A, fallback: '', optional: true }, { text: PAIR_B, fallback: 'B' }], '수분 세럼')).toEqual(['', PAIR_B]);
    expect(guardReadingSequence([{ text: PAIR_A, fallback: 'H' }, { text: '', fallback: '' }, { text: PAIR_B, fallback: 'B' }], '수분 세럼')).toEqual([PAIR_A, '', 'B']);
    expect(guardReadingSequence([{ text: '촉촉한 피부', fallback: 'H' }, { text: '이번 주 가격이 달라져요', fallback: 'B' }], '')).toEqual(['촉촉한 피부', '이번 주 가격이 달라져요']);
    expect(dropInventedEfficacyTitledBody(PAIR_A, `${PAIR_B}. 오늘 만나 보세요.`, '수분 세럼').subject).toBe('');
  });
  it('HTML 보이는 글: <br> 은 문단을 끊지 않는다(덧댄 문단 경계 인자 삭제 · 문단 태그 = 한 줄 바꿈)', async () => {
    expect(htmlVisibleText('<p>피부가<br>좋아져요.</p>')).toBe('\n피부가\n좋아져요.\n');
    aiMock.mockResolvedValue(JSON.stringify({ subject: '가을 세럼', html_body: '<p>가볍게 스며들어요.</p><p>피부가<br>좋아져요.</p>' }));
    await expect(refineEmail({ companyId: 'c1', subject: '가을 세럼', htmlBody: '<p>가볍게 스며들어요.</p>', instruction: '부드럽게' })).rejects.toThrow(/효능/);
  });
  it('DM 빠른 고치기: 판정 = 실제로 저장할 섹션 글(새 헤드라인 + 남은 옛 부제)', async () => {
    (query as any).mockImplementationOnce(async () => ({ rows: [{ pages: null, sections: [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '패키지 디자인', sub_copy: PAIR_B } }] }] }));
    aiMock.mockResolvedValue(JSON.stringify({ refined: `${PAIR_A}
${PAIR_B}` }));
    const r = await applyQuickAction('c1', 'dm-1', 'ai_refine');
    expect(r.changes).toEqual([]);
    expect(r.notes?.[0]).toContain('원래 글을 뒀어요');
  });
  it('이메일 블록 다듬기: 섹션째 다시 보고 걸리면 조각 전부 원래 글 · changed = 최종 적용 결과', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ texts: [PAIR_A, PAIR_B] }));
    const sections: any[] = [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '패키지 디자인', sub_copy: PAIR_B } }];
    const r = await refineEmailSections({ companyId: 'c1', sections });
    expect(r.changed).toBe(false);
    expect(r.rejected).toBe(1);
  });
  it('DM 개선: 그 섹션의 남은 칸과 이어 읽어 걸리면 버린다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [{ section_id: 'h', field: 'headline', before: '패키지 디자인', after: PAIR_A, reason: 'x' }] }));
    const r = await improveMessage([{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '패키지 디자인', sub_copy: PAIR_B } } as any], undefined, 'c1');
    expect(r.suggestions).toEqual([]);
    expect(r.rejected).toBe(1);
  });
  it('이메일 생성: 제목과 이어 읽어 단정인 프리헤더는 비운다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subjects: [PAIR_A], preheader: PAIR_B, blocks: [{ type: 'hero', props: { headline: '가을 세럼', sub_copy: '가볍게 스며들어요' } }] }));
    const r = await generateEmailSections({ companyId: 'c1', prompt: '수분 세럼 소개', isAd: true });
    expect(r.preheader).toBe('');
    expect(r.efficacyDropped).toBeGreaterThan(0);
  });
  it('인앱 생성: 제목 블록 + 본문 블록을 이어 읽는다 · 걸려 본문이 빠지면 재생성 판단에 든다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({
      title: '가을 세럼', body: '가볍게 스며들어요.', template: 'center_modal', buttons: [],
      content_blocks: [{ type: 'headline', text: PAIR_A }, { type: 'body', text: PAIR_B }],
    }));
    const pkg = await runInCreditBundle(() => generateInAppMessagePackage({ companyId: 'c1', createdBy: 'u1', objective: '수분 세럼 알리기' } as any));
    expect(aiMock).toHaveBeenCalledTimes(2);
    const texts = (pkg.message.content_blocks as any[]).map((b) => b.text).filter(Boolean);
    expect(texts.some((t, i) => i > 0 && claimsInventedEfficacy(`${texts[i - 1]}. ${t}`, '수분 세럼 알리기'))).toBe(false);
  });
  it('SNS 사진 초안: 사진 속 글 · 회사 이름에 없는 효능 문장은 빼고 안내한다', async () => {
    aiMock.mockResolvedValueOnce(JSON.stringify({ lines: ['수분 크림'] }));
    aiMock.mockResolvedValueOnce(JSON.stringify({ caption: `수분 크림을 소개해요. ${POISON}`, tags: [] }));
    const r = await generateSnsCaption({ companyId: 'c1', action: 'write', body: '', tags: [], tagSet: [], brandName: '브랜드', media: { images: [{ media_type: 'image/png', data: 'AAAA' }], imageIds: ['probe-1'], imageCount: 1, videoCount: 0 } } as any);
    expect(r.caption).not.toContain('몰라보게');
    expect(r.caption).toContain('수분 크림을 소개해요.');
    expect(r.note).toBeTruthy();
  });
  it('여정 편집 = 다시 쓰기: 원문에 없던 효능이 생기면 수정 전체를 적용하지 않는다(원래 패키지 · 말없이 바꾸지 않음)', async () => {
    const pkg: any = { name: '가을', templateCode: 'repeat', triggerEvent: 'cdp.purchase', steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject: '가을 크림', messageTemplate: '주름 개선 기능성 크림을 만나보세요.', isAd: true }] };
    const reply = (body: string) => JSON.stringify({ ...pkg, steps: [{ ...pkg.steps[0], delayHours: 24, messageTemplate: body }], reasoning: '수정' });
    aiMock.mockResolvedValue(reply('피부가 좋아지는 크림을 만나보세요.'));
    await expect(editJourneyPackage({ companyId: 'c1', currentPackage: pkg, instruction: '대기 시간만 하루로' })).rejects.toThrow(/효능/);
    aiMock.mockResolvedValue(reply('주름 개선 기능성 크림을 만나보세요.'));
    const ok: any = await editJourneyPackage({ companyId: 'c1', currentPackage: pkg, instruction: '대기 시간만 하루로' });
    expect(ok.steps[0].messageTemplate).toBe('주름 개선 기능성 크림을 만나보세요.');
  });
});

describe('Codex 2R — 이어 읽기 규칙 한 벌(경계 · 반복 · 근거 모양)', () => {
  const PAIR_A = '피부 고민';
  const PAIR_B = '매끈하게 달라져요';
  it('비운 칸 뒤 새로 붙은 이웃도 다시 본다(더 바뀌지 않을 때까지)', () => {
    const out = guardReadingSequence([
      { text: PAIR_A, fallback: 'H' },
      { text: '주름 고민', fallback: '', optional: true },
      { text: PAIR_B, fallback: 'B' },
    ], '수분 세럼');
    const kept = out.filter((x) => x.trim());
    for (let i = 1; i < kept.length; i++) expect(claimsInventedEfficacy(`${kept[i - 1]}. ${kept[i]}`, '수분 세럼')).toBe(false);
  });
  it('읽는 단위 = 칸마다 문장 경계(제 주어가 있는 뒤 칸은 앞 칸 대상을 이어받지 않는다)', () => {
    expect(readingUnit(PAIR_A, '이번 주 가격이 달라져요.')).toBe('피부 고민. 이번 주 가격이 달라져요.');
    expect(claimsInventedEfficacy(readingUnit(PAIR_A, '이번 주 가격이 달라져요.'), '')).toBe(false);
    expect(claimsInventedEfficacy(readingUnit(PAIR_A, PAIR_B), '')).toBe(true);
  });
  it('객체 안 글 칸 = 읽는 순서(뱃지 → 제목 → 본문 · 태그 → 제목)', () => {
    const r = dropInventedEfficacyDeep({ badge_text: PAIR_A, title: PAIR_B, body: '가을 신상품을 만나보세요.' }, '수분 세럼');
    expect(r.badge_text).toBe('');
    expect(r.title).toBe(PAIR_B);
    const c = dropInventedEfficacyDeep({ tag: PAIR_A, headline: PAIR_B, body: '가볍게 스며들어요.' }, '수분 세럼');
    expect(c.tag).toBe('');
  });
  it('인앱: AI 블록이 없을 때 평면 값으로 합성한 블록도 같은 판정을 지난다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ title: PAIR_B, body: '가을 신상품을 만나보세요.', badge_text: PAIR_A, template: 'center_modal', buttons: [] }));
    const pkg = await runInCreditBundle(() => generateInAppMessagePackage({ companyId: 'c1', createdBy: 'u1', objective: '수분 세럼 알리기' } as any));
    const texts = (pkg.message.content_blocks as any[]).map((b) => b.text).filter((x) => typeof x === 'string' && x.trim());
    for (let i = 1; i < texts.length; i++) expect(claimsInventedEfficacy(`${texts[i - 1]}. ${texts[i]}`, '수분 세럼 알리기')).toBe(false);
    expect(pkg.message.badge_text ?? '').not.toBe(PAIR_A);
  });
  it('DM 개선: 남긴 제안을 사람이 어떻게 골라 받아도 이어 읽어 단정이 생기지 않는다(부분 조합 전수)', async () => {
    const props = { tag: '새 소식.', headline: '매일 가볍게.', body: '수분 세럼을 만나보세요.' };
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [
      { section_id: 't', field: 'tag', before: props.tag, after: '피부 고민.', reason: 'x' },
      { section_id: 't', field: 'headline', before: props.headline, after: '패키지가', reason: 'x' },
      { section_id: 't', field: 'body', before: props.body, after: '매끈하게 달라져요.', reason: 'x' },
    ] }));
    const r = await improveMessage([{ id: 't', type: 'text_card', order: 1, visible: true, props } as any], undefined, 'c1');
    const kept = r.suggestions;
    for (let mask = 0; mask < (1 << kept.length); mask++) {
      const state: any = { ...props };
      kept.forEach((k: any, i: number) => { if (mask & (1 << i)) state[k.field] = k.after; });
      expect(claimsInventedEfficacy(readingUnit(state.tag, state.headline, state.body), readingUnit(props.tag, props.headline, props.body))).toBe(false);
    }
  });
  it('HTML 다듬기: 연달아 온 문단 태그도 한 경계 · 이웃 문단을 이어 읽는다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subject: '가을 세럼', html_body: `<p>${PAIR_A}</p><p>${PAIR_B}</p>` }));
    await expect(refineEmail({ companyId: 'c1', subject: '가을 세럼', htmlBody: '<p>수분 세럼을 소개합니다.</p>', instruction: '부드럽게' })).rejects.toThrow(/효능/);
  });
  it('여정 편집: 문안을 그대로 둔 수정은 걸리지 않는다(근거에 편집 전 제목 + 본문을 같은 읽는 단위로)', async () => {
    for (const [subject, body] of [[PAIR_A, '이번 주 가격이 달라져요.'], [PAIR_A, `${PAIR_B}.`]]) {
      const pkg: any = { name: '가을', templateCode: 'repeat', triggerEvent: 'cdp.purchase', steps: [{ stepOrder: 1, stepType: 'message', channel: 'lms', delayHours: 0, subject, messageTemplate: body, isAd: true }] };
      aiMock.mockResolvedValue(JSON.stringify({ ...pkg, steps: [{ ...pkg.steps[0], delayHours: 24 }], reasoning: '수정' }));
      const ok: any = await editJourneyPackage({ companyId: 'c1', currentPackage: pkg, instruction: '대기 시간만 하루로' });
      expect(ok.steps[0].messageTemplate).toBe(body);
    }
  });
});

describe('Codex 3R — 칸 순서 · 판정별 경계', () => {
  it('DM 개선: 빈 칸을 채우는 제안도 화면 칸 순서(제목 → 본문) 자리에서 읽는다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [{ section_id: 't', field: 'headline', before: '', after: '피부 고민', reason: 'x' }] }));
    const r = await improveMessage([{ id: 't', type: 'text_card', order: 1, visible: true, props: { headline: '', body: '매끈하게 달라져요' } } as any], undefined, 'c1');
    expect(r.suggestions).toEqual([]);
    expect(r.rejected).toBe(1);
  });
  it('이어 읽기 판정 = 효능만 · 숫자 · 혜택은 조각마다 원래 계약(그대로 둔 조각은 판정하지 않는다)', async () => {
    expect(readingAddsEfficacy(['피부 고민', '매끈하게 달라져요'], ['패키지 디자인', '매끈하게 달라져요'])).toBe(true);
    expect(readingAddsEfficacy(['최대 30프로', '할인 혜택을 확인하세요'], ['최대 30프로', '할인 혜택을 만나보세요'])).toBe(false);
    aiMock.mockResolvedValue(JSON.stringify({ texts: ['최대 30프로', '할인 혜택을 확인하세요'] }));
    const r = await refineEmailSections({ companyId: 'c1', sections: [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '최대 30프로', sub_copy: '할인 혜택을 만나보세요' } }] as any[] });
    expect(r.changed).toBe(true);
    expect(r.rejected).toBe(0);
  });
});

describe('Codex 4R — 숫자 · 혜택 계약 복원(완화 장치 삭제) · 표시 순서 확인 섹션만 이어 읽기', () => {
  it('HTML 다듬기: 상품명의 「16프로」가 새 자리의 「16% 할인」 근거가 되지 않는다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ subject: '아이폰 16프로, 최대 성능', html_body: '<p>전 상품 16% 할인</p>' }));
    await expect(refineEmail({ companyId: 'c1', subject: '아이폰 16프로, 최대 성능', htmlBody: '<p>새 모델을 만나보세요</p>', instruction: '더 눈에 띄게' })).rejects.toThrow();
  });
  it('이메일 블록 다듬기: 이웃 조각의 할인을 다른 상품 조각으로 옮기면 그 조각은 원래 글', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ texts: ['아동 운동화 30% 할인', '성인 운동화 30% 할인'] }));
    const r = await refineEmailSections({ companyId: 'c1', sections: [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '아동 운동화 신상품 안내', sub_copy: '성인 운동화 30% 할인' } }] as any[] });
    expect(r.changed).toBe(false);
    expect(r.rejected).toBe(1);
  });
  it('DM 개선: 표시 순서를 확인하지 않은 섹션(머리글 · 변형마다 보이는 칸이 다르다)은 칸끼리 잇지 않는다', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [{ section_id: 'hd', field: 'event_title', before: '', after: '피부 고민', reason: 'x' }] }));
    const r = await improveMessage([{ id: 'hd', type: 'header', order: 0, visible: true, props: { variant: 'countdown', event_title: '', discount_label: '매끈하게 달라져요', brand_name: '뷰티샵' } } as any], undefined, 'c1');
    expect(r.suggestions.length).toBe(1);
  });
});

describe('Codex 5R — 반쪽 다듬기 · 변형마다의 표시 순서', () => {
  it('빠른 고치기: AI 가 줄을 덜 돌려준 여러 칸 섹션은 적용하지 않는다(옛 부제와 이어진 새 혜택 0)', async () => {
    (query as any).mockImplementationOnce(async () => ({ rows: [{ pages: null, sections: [{ id: 'h', type: 'hero', order: 1, visible: true, props: { headline: '무료 상담 안내', sub_copy: '배송은 내일부터 시작해요' } }] }] }));
    aiMock.mockResolvedValue(JSON.stringify({ refined: '무료' }));
    const r = await applyQuickAction('c1', 'dm-1', 'ai_refine');
    expect(r.changes).toEqual([]);
  });
  it('DM 개선: 인용형 텍스트 카드(제목 → 본문 → 태그)도 본다(변형은 편집기에서 바뀐다 · 순서 전부)', async () => {
    aiMock.mockResolvedValue(JSON.stringify({ suggestions: [{ section_id: 't', field: 'tag', before: '봄 소식', after: '매끈하게 달라져요', reason: 'x' }] }));
    const r = await improveMessage([{ id: 't', type: 'text_card', order: 1, visible: true, treatment: 'quote', props: { tag: '봄 소식', headline: '피부 고민', body: '' } } as any], undefined, 'c1');
    expect(r.suggestions).toEqual([]);
    expect(r.rejected).toBe(1);
  });
  it('AI 영업 거름: 인용형 순서(본문 → 태그)로 이어 읽어도 걸리면 비운다', () => {
    const r = sanitizeDmCopyBenefits([{ id: 't', type: 'text_card', order: 1, visible: true, props: { tag: '매끈하게 달라져요', headline: '수분 세럼', body: '피부 고민' } } as any], '수분 세럼 출시', '브랜드');
    const p: any = r.sections[0]?.props || {};
    for (const order of [['tag', 'headline', 'body'], ['headline', 'body', 'tag']]) {
      const texts = order.map((k) => String(p[k] || '')).filter((x) => x.trim());
      for (let i = 1; i < texts.length; i++) expect(claimsInventedEfficacy(`${texts[i - 1]}. ${texts[i]}`, '수분 세럼 출시')).toBe(false);
    }
  });
});

describe('Codex 6R — 반쪽 다듬기 = 옛 칸이 실제로 남는 조건', () => {
  it('빈 제목 + 본문에 한 줄 응답 = 적용하지 않는다 · 여러 줄 본문을 두 줄로 줄인 정상 다듬기는 적용한다', async () => {
    (query as any).mockImplementationOnce(async () => ({ rows: [{ pages: null, sections: [{ id: 't', type: 'text_card', order: 1, visible: true, props: { headline: '', body: '배송은 내일부터 시작해요. 무료 상담도 받아보세요' } }] }] }));
    aiMock.mockResolvedValue(JSON.stringify({ refined: '무료' }));
    expect((await applyQuickAction('c1', 'dm-1', 'ai_refine')).changes).toEqual([]);
    (query as any).mockImplementationOnce(async () => ({ rows: [{ pages: null, sections: [{ id: 't', type: 'text_card', order: 1, visible: true, props: { headline: '가을 소식', body: '새 세럼이 나왔어요.\n가볍게 스며들어요.\n매일 쓰기 좋아요.' } }] }] }));
    aiMock.mockResolvedValue(JSON.stringify({ refined: '가을 소식이에요\n가볍게 스며드는 새 세럼이 나왔어요.' }));
    expect((await applyQuickAction('c1', 'dm-1', 'ai_refine')).changes.length).toBe(1);
  });
});
