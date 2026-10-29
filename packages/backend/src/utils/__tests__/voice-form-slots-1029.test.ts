/**
 * 목소리 꼴 칸(링크 · 매장 · 연락처) 판정 · 질문 · 결정 · 지시문 · 링크 처리 (★ 2026-10-29 설계서 docs/2026-10-29-voice-form-slots-ask-design.md)
 * 접수 = Harold 1029 「학습된 보이스에서 필요한 게 빠져 있는지 그걸 질문을 하는지 · 빈 곳들이 제대로 매핑되어 들어가는지」
 */
import { describe, it, expect } from 'vitest';
import { SKELETON_SLOT } from '../brand-voice-skeleton';
import { LINK_PLACEHOLDER } from '../brand-link-core';
import {
  formSlotsInText, voiceFormSlotsOf, pickableSkeletons, companyFormValuesOf, cleanFormLink, cleanFormPhone, voiceFormAsksOf,
  voiceFormQuestions, decideVoiceForm, readVoiceFormDecision, voiceFormPrint, resolveFormLink, stripLinkLines, voiceFormPromptSection,
  VOICE_FORM_ASK, ONCE_LINK_LABEL, runWithVoiceForm, currentVoiceForm, decideSentVoiceForm,
} from '../voice-form-slots';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mergeLineAsks, voiceLineAsks, splitVoiceLineAnswers, readLineAnswers } from '../ai-line';
import { buildOperatorQuestions, decideOperatorAnswers } from '../automarketing-interview';
import { voiceInterviewQuestions, decideJourneyVoiceForm } from '../journey-interview';
import { voiceFormSlotsForData } from '../brand-voice-prompt';

const SK = `[테스트계정]\n안녕하세요\n▶ 자세히 보기: ${SKELETON_SLOT.link}\n※ ${SKELETON_SLOT.store}으로 문의 바랍니다\n문의: ${SKELETON_SLOT.phone}`;

describe('판정', () => {
  it('글에 든 꼴 칸 · 뼈대 + 문구 합 · 사실 칸(상품 · 혜택)은 꼴 칸이 아니다', () => {
    expect(formSlotsInText(SK)).toEqual(['link', 'store', 'phone']);
    expect(formSlotsInText(`${SKELETON_SLOT.product} ${SKELETON_SLOT.benefit}`)).toEqual([]);
    expect(voiceFormSlotsOf({ skeletons: [`a ${SKELETON_SLOT.link}`], phrases: [`문의 ${SKELETON_SLOT.phone}`] })).toEqual(['link', 'phone']);
  });
  it('고를 수 있는 뼈대 = 모든 종류 + null 로 돌린 결과의 합(중복 1번)', () => {
    const seen: Array<string | null> = [];
    const out = pickableSkeletons((c) => { seen.push(c); return [{ skeleton: `s-${c}`, message: { id: c ? 'x' : 'n' } }]; });
    expect(seen[0]).toBeNull();
    expect(seen.length).toBe(6);
    expect(out.length).toBe(2);
  });
  it('성격의 꼴 칸 = text 는 뼈대 + 문구 · tone 은 서명 · 어미 예시만(뼈대 0)', () => {
    const data: any = {
      guideline: { tone_signature: 't', avg_length_chars: 0, avg_length_bytes: 0, frequent_expressions: [], greeting_pattern: '', cta_patterns: [], signature: '', emoji_whitelist: [], extracted_at: '', admin_edited: false },
      noticeGuideline: null, admin: {},
      state: { reviewed: { skeletons: { m1: { text: SK, hash: '' } }, phrases: { marketing: { signature: `문의 ${SKELETON_SLOT.phone}` } } } },
      messages: [{ id: 'm1', message_text: 'x', kind: 'marketing', content_type: 'promo' }],
    };
    // 뼈대 해시가 원문과 달라 live 0 → 문구(서명)의 연락처 칸만
    expect(voiceFormSlotsForData(data, 'marketing', 'text')).toEqual(['phone']);
    expect(voiceFormSlotsForData(data, 'marketing', 'tone')).toEqual(['phone']);
  });
});

describe('회사 값 · 질문 · 결정', () => {
  it('링크 = 등록 링크 1개 이상 · 연락처 = 브랜드 킷 고객센터 → 대표 번호 순 · 번호 꼴 검사', () => {
    expect(companyFormValuesOf([{ label: '홈', url: 'https://a.co' }], { cs_phone: '1588-0000' })).toEqual({ link: true, phone: '1588-0000', links: [{ label: '홈', url: 'https://a.co' }] });
    expect(companyFormValuesOf([], { cs_phone: 'abc', phone: '02-123-4567' })).toEqual({ link: false, phone: '02-123-4567', links: [] });
    expect(cleanFormPhone('12')).toBeNull();
  });
  it('링크 꼴 = http(s) 도메인만(사설 · 숫자 주소 · 공백 거절)', () => {
    expect(cleanFormLink('https://shop.example.com/a')).toBe('https://shop.example.com/a');
    for (const bad of ['javascript:alert(1)', 'http://localhost/x', 'http://10.0.0.1/', 'https://a b.com', 'ftp://a.com']) expect(cleanFormLink(bad)).toBeNull();
  });
  it('물을 칸 = 꼴 칸 − 회사 값 − 결정(값 · 생략 모두 · 다시 묻지 않음)', () => {
    const v = { link: false, phone: null };
    expect(voiceFormAsksOf(['link', 'store', 'phone'], v, null)).toEqual(['link', 'store', 'phone']);
    expect(voiceFormAsksOf(['link', 'store', 'phone'], { link: true, phone: '1588-0000' }, null)).toEqual(['store']);
    expect(voiceFormAsksOf(['link', 'store', 'phone'], v, { store: { omit: true }, link: { value: 'https://a.co' } })).toEqual(['phone']);
  });
  it('답 → 결정 · 빈 답 = 명시 생략 · 꼴 틀림 = 거절', () => {
    expect(decideVoiceForm(['link', 'store'], { link: '', store: '강남점' })).toEqual({ ok: true, decision: { link: { omit: true }, store: { value: '강남점' } } });
    const bad = decideVoiceForm(['link'], { link: 'not a url' });
    expect(bad.ok).toBe(false);
  });
  it('저장 결정 읽기(꼴 틀림 = 미결정) · 지문은 값 · 생략이 바뀌면 바뀐다', () => {
    expect(readVoiceFormDecision({ link: { value: 'http://localhost' }, store: { omit: true }, x: 1 })).toEqual({ store: { omit: true } });
    expect(voiceFormPrint({ store: { value: 'A' } })).not.toBe(voiceFormPrint({ store: { omit: true } }));
    expect(voiceFormPrint({})).toBe('');
  });
  it('질문표 꼴 = 서버 상수 글 · 「이 줄 없이」', () => {
    const q = voiceFormQuestions(['store']);
    expect(q[0]).toMatchObject({ id: 'voice:store', label: VOICE_FORM_ASK.store.label, noneLabel: '이 줄 없이', required: false });
  });
});

describe('링크 결정 한 곳 · 생략 = 줄 지움', () => {
  const reg = [{ label: '홈페이지', url: 'https://a.co' }];
  it('registered · once(1회용 라벨 하나 더) · omit · none', () => {
    expect(resolveFormLink(reg, null).mode).toBe('registered');
    expect(resolveFormLink([], { link: { value: 'https://b.co' } })).toEqual({ mode: 'once', links: [{ label: ONCE_LINK_LABEL, url: 'https://b.co' }] });
    expect(resolveFormLink(reg, { link: { omit: true } })).toEqual({ mode: 'omit', links: [] });
    expect(resolveFormLink([], null).mode).toBe('none');
  });
  it('생략 = 토큰 · 자리 표시가 든 줄 전체 삭제 · 연속 빈 줄 하나로', () => {
    const t = `안녕하세요\n\n▶ 보기: {{LINK:홈}}\n\n${LINK_PLACEHOLDER}\n\n감사합니다`;
    expect(stripLinkLines(t)).toBe('안녕하세요\n\n감사합니다');
  });
});

describe('지시문 절', () => {
  it('값 · 생략 · 회사 값 · 값 없음이 각각 한 줄 · 토큰 생산자 = 1회용 토큰', () => {
    const s = voiceFormPromptSection({
      slots: ['link', 'store', 'phone'], values: { link: false, phone: '1588-0000' },
      decision: { link: { value: 'https://b.co' }, store: { omit: true } }, useLinkTokens: true,
    });
    expect(s).toContain(`{{LINK:${ONCE_LINK_LABEL}}}`);
    expect(s).toContain('매장 칸: 이번 문자에는 쓰지 않는다');
    expect(s).toContain('문의 번호 칸: 1588-0000');
    expect(voiceFormPromptSection({ slots: [], values: { link: false, phone: null }, decision: null, useLinkTokens: true })).toBe('');
  });
});

describe('질문 단계 배선', () => {
  it('AI 한줄로 = 혜택 · 기간 다음 · AI 의 그 밖 질문 앞 · 답 = 서버 질문 글로 가른다', () => {
    const ai = [{ id: 'q1', kind: 'text' as const, text: '어느 매장?', why: '', options: [], source: 'ai' as const }];
    const asks = mergeLineAsks('봄 세일 문자', ai, voiceLineAsks(['store']));
    expect(asks.map((a) => a.id)).toEqual(['benefit', 'period', 'voice_store', 'q1']);
    const sp = splitVoiceLineAnswers([{ q: VOICE_FORM_ASK.store.label, a: '강남점' }, { q: '기타', a: 'x' }], ['store']);
    expect(sp).toEqual({ voice: { store: '강남점' }, others: [{ q: '기타', a: 'x' }] });
  });
  it('자동마케팅 = 필수(답 또는 「이 줄 없이」) · 결정 패치 · 번호 꼴 틀림 거절', () => {
    const qs = buildOperatorQuestions({ translation: { kind: 'axis', segmentKey: 'vip', mapped: true } as any, axes: [], everyoneCount: null, schedule: 'monthly', benefitAsk: null, callbackCandidates: null, adminPhoneMissing: false, voiceAsks: ['store', 'phone'] });
    expect(qs.filter((q) => q.id.startsWith('voice:')).every((q) => q.required && q.noneLabel)).toBe(true);
    const vq = qs.filter((q) => q.id.startsWith('voice:'));
    expect(decideOperatorAnswers(vq, { 'voice:store': '', 'voice:phone': '02-123-4567' })).toEqual({ ok: true, patch: { fields: {}, voiceForm: { store: { omit: true }, phone: { value: '02-123-4567' } } } });
    expect(decideOperatorAnswers(vq, { 'voice:store': 'A', 'voice:phone': 'abc' }).ok).toBe(false);
    expect(decideOperatorAnswers(vq, {}).ok).toBe(false);   // 답하지 않으면 넘어가지 않는다(조용한 생략 0)
  });
  it('여정 = 계획마다 · id 계획 접두 · 결정', () => {
    const q = voiceInterviewQuestions('p1', ['link']);
    expect(q[0]).toMatchObject({ id: 'p1:voice:link', planKey: 'p1' });
    expect(decideJourneyVoiceForm('p1', ['link'], { 'p1:voice:link': 'https://b.co' })).toMatchObject({ ok: true, decision: { link: { value: 'https://b.co' } } });
    expect(decideJourneyVoiceForm('p1', ['link'], {})).toEqual({ ok: true, decision: { link: { omit: true } }, print: '' });
  });
});

describe('묶음 B — 한 줄 단계 창(DM · 이메일 · 인앱)', () => {
  it('요리 문맥 = 결정이 있을 때만 · 밖에서는 null', async () => {
    expect(currentVoiceForm()).toBeNull();
    const seen = await runWithVoiceForm({ store: { value: 'A' } }, async () => currentVoiceForm());
    expect(seen).toEqual({ store: { value: 'A' } });
    expect(await runWithVoiceForm({}, async () => currentVoiceForm())).toBeNull();
  });
  it('배선 — 판(기본 · 구성)에 같은 질문 · 주문 한 곳이 답을 판정 · 세 라우트가 답을 넘긴다 · 목소리 CT 가 문맥을 읽는다', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');
    const gaps = src('routes/ai.ts');
    expect(gaps).toMatch(/plan = \{ \.\.\.plan, voice: voiceQs \}/);
    expect(gaps).toMatch(/compositions\.plans\[k\] = \{ \.\.\.compositions\.plans\[k\], voice: voiceQs \}/);
    const order = src('utils/one-line-ct/order.ts');
    expect(order).toContain("refuse(400, 'VOICE_FORM_INVALID'");
    expect(order).toContain('runWithVoiceForm(voiceDecided.decision, () => input.cook(');
    for (const r of ['routes/dm.ts', 'routes/email.ts', 'routes/cdp.ts']) expect(src(r)).toContain('voiceFormRaw: req.body?.voice_form');
    expect(src('utils/brand-voice-prompt.ts')).toContain('input.formDecision ?? currentVoiceForm()');
  });
});

describe('구현 1R 정정', () => {
  it('AI 한줄로 — 꼴 칸 빈 답 보존(생략) · 질문에서 빠진 칸의 답도 꼴 칸 답(근거 글로 새지 않음) · 그 밖 빈 답은 버림', () => {
    const r = readLineAnswers([{ q: VOICE_FORM_ASK.link.label, a: '' }, { q: '기타', a: '' }, { q: VOICE_FORM_ASK.phone.label, a: '02-123-4567' }]);
    expect(r).toEqual([{ q: VOICE_FORM_ASK.link.label, a: '' }, { q: VOICE_FORM_ASK.phone.label, a: '02-123-4567' }]);
    const sp = splitVoiceLineAnswers(r as any, []);   // 그 사이 회사 값이 생겨 물을 칸이 0이어도
    expect(sp).toEqual({ voice: { link: '', phone: '02-123-4567' }, others: [] });
  });
  it('자동마케팅 — 저장 결정 = 미리 채운 답(정정 길)', () => {
    const qs = buildOperatorQuestions({ translation: { kind: 'axis', segmentKey: 'vip', mapped: true } as any, axes: [], everyoneCount: null, schedule: 'monthly', benefitAsk: null, callbackCandidates: null, adminPhoneMissing: false, voiceAsks: ['store'], voicePrefill: { store: { value: '강남점' } } });
    expect(qs.find((q) => q.id === 'voice:store')?.recommended).toBe('강남점');
  });
  it('비토큰 생산자 = 등록 링크 주소를 그대로', () => {
    const s = voiceFormPromptSection({ slots: ['link'], values: { link: true, phone: null, links: [{ label: '홈', url: 'https://a.co' }] }, decision: null, useLinkTokens: false });
    expect(s).toContain('홈 https://a.co');
  });
  it('배선 — 스팸 재생성 · 여정 키 · 한 줄 주문 지문 · 승인 창 저장 · 화면 초기화', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');
    expect(src('utils/continuous-operator.ts')).toContain("companyId: operator.companyId, voiceForm: operator.voiceForm,");
    expect(src('utils/journey-interview-ai.ts')).toContain('${plan.key}${vfSuffix}`');
    expect(src('utils/one-line-ct/order.ts')).toContain('vfPrint ? { payload: input.payload, vf: vfPrint } : input.payload');
    expect(src('utils/automarketing-preview.ts')).toContain('voiceForm: e.voiceAnswered ? readVoiceFormDecision(e.input.voiceForm) : null,');
    expect(readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'zone', 'LineStepsModal.tsx'), 'utf8')).toContain('useEffect(() => { setVoiceAns({}); }, [storeKey, open]);');
  });
});

describe('구현 2R 정정 — 지문 = 보낸 답만(회사 값과 무관한 멱등)', () => {
  it('같은 요청 = 회사 연락처가 생겨 물을 칸이 줄어도 같은 지문 · 안 보낸 물을 칸 = 생략(지문 밖)', () => {
    const sent = { phone: '02-123-4567', store: '' };
    const before = decideSentVoiceForm(['phone', 'store'], sent);
    const after = decideSentVoiceForm(['store'], sent);
    expect(before.ok && after.ok && before.print === after.print).toBe(true);
    const missing = decideSentVoiceForm(['link'], {});
    expect(missing).toEqual({ ok: true, decision: { link: { omit: true } }, print: '' });
  });
  it('여정 = 같은 규칙(보낸 칸만 지문)', () => {
    const a = decideJourneyVoiceForm('p1', ['phone'], { 'p1:voice:phone': '02-123-4567' });
    const b = decideJourneyVoiceForm('p1', [], { 'p1:voice:phone': '02-123-4567' });
    expect(a.ok && b.ok && a.print === b.print && a.print !== '').toBe(true);
  });
});

describe('구현 3R 정정', () => {
  it('여정 = 꼴 틀린 답은 캐시 조회 전에 거절', () => {
    const src = readFileSync(join(__dirname, '..', 'journey-interview-ai.ts'), 'utf8');
    const at = src.indexOf('if (!voicePre.ok) throw new JourneyInputError(');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf('const done = designDone.get(key);'));
    expect(decideJourneyVoiceForm('p1', [], { 'p1:voice:phone': 'abc' }).ok).toBe(false);
  });
});
