/**
 * 1031 AI 오퍼레이터 되묻기 답의 링크가 문안에서 빠짐(카드 C86 · 설계서 docs/2026-10-31-ai-line-answer-link-design.md · 뿌리 대장 R32)
 *   L0 출구 템플릿 거름이 링크 토큰을 지움 · L1~L10 링크 질문 · 결정 · 출구 · 다시 쓰기.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { applyCopyExitGuards } from '../copy-exit-guards';
import { protectLinkTokens, LINK_PLACEHOLDER } from '../brand-link-core';
import {
  readLinkText, asciiLink, ensureOnceLink, onceLinkPromptSection, decideVoiceForm, decideSentVoiceForm, cleanFormLink,
  resolveFormLink, voiceFormPromptSection, LINK_MAX, VOICE_FORM_ASK, ONCE_LINK_LABEL, LINK_INVALID_ERROR,
  rewriteDropsLinks, textLinks, readVoiceFormDecision,
} from '../voice-form-slots';
import {
  sanitizeAiAsks, mergeLineAsks, voiceLineAsks, splitVoiceLineAnswers, withLinkToken, readLineAnswers, LINE_LINK_ASK,
} from '../ai-line';

const BACK = resolve(__dirname, '..', '..');
const FRONT = resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (root: string, p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n');
const TOKEN = `{{LINK:${ONCE_LINK_LABEL}}}`;
const exitBase = {
  channel: 'LMS', isAd: false, bannedWords: [] as string[], benefitGround: '가을 신상 안내', baseDate: new Date('2026-10-31T00:00:00Z'),
  validationVars: [] as string[], stripAllVars: false, senderNames: ['한줄'], brandLinks: [] as Array<{ label: string; url: string }>,
};
const exit = (text: string, ctx: Partial<typeof exitBase> & { onceLink?: string | null; linkOmit?: boolean }) =>
  applyCopyExitGuards({ message_text: text, subject: '' }, { ...exitBase, ...ctx } as any);

describe('L0 · P0 출구 템플릿 거름이 링크 토큰을 지나간다', () => {
  it('재현 입력 그대로: once 토큰 · 등록 토큰 = 주소로 바뀌고 템플릿 판정 0', () => {
    const once = exit(`가을 신상을 만나 보세요\n자세히 보기\n${TOKEN}`, { brandLinks: [{ label: ONCE_LINK_LABEL, url: 'https://shop.example.com/e/1031' }] });
    expect(once.message_text).toBe('가을 신상을 만나 보세요\n자세히 보기\nhttps://shop.example.com/e/1031');
    expect(once.flags.liquid).toBe(false);
    const reg = exit('가을 신상\n{{LINK:공식몰}}', { brandLinks: [{ label: '공식몰', url: 'https://shop.example.com' }] });
    expect(reg.message_text).toBe('가을 신상\nhttps://shop.example.com');
    expect(reg.flags.liquid).toBe(false);
  });
  it('토큰 아닌 {{ }} 는 지금처럼 평문화 · 템플릿 판정', () => {
    const r = exit('안녕하세요 {{ customer.name }}님\n{{LINK:공식몰}}', { brandLinks: [{ label: '공식몰', url: 'https://shop.example.com' }] });
    expect(r.flags.liquid).toBe(true);
    expect(r.message_text).toContain('https://shop.example.com');
    expect(r.message_text).not.toContain('{{');
  });
  it('사이 거름이 라벨을 깎지 않는다(금지어 「몰」 · 혜택 낱말 라벨 「쿠폰함」)', () => {
    const links = [{ label: '공식몰', url: 'https://a.example.com' }, { label: '공식', url: 'https://wrong.example.com' }, { label: '쿠폰함', url: 'https://c.example.com' }];
    const ban = exit('가을 신상\n{{LINK:공식몰}}', { brandLinks: links, bannedWords: ['몰'] });
    expect(ban.message_text).toContain('https://a.example.com');
    expect(ban.message_text).not.toContain('wrong.example.com');
    const cpn = exit('가을 신상 보러 가기\n{{LINK:쿠폰함}}', { brandLinks: links });
    expect(cpn.message_text).toContain('https://c.example.com');
  });
  it('미등록 라벨 = 자리 표시 + 재생성 조건(placeholderLeft)', () => {
    const r = exit('가을 신상\n{{LINK:없는라벨}}', { brandLinks: [{ label: '공식몰', url: 'https://a.example.com' }] });
    expect(r.message_text).toContain(LINK_PLACEHOLDER);
    expect(r.flags.placeholderLeft).toBe(true);
    const ok = exit('가을 신상\n{{LINK:공식몰}}', { brandLinks: [{ label: '공식몰', url: 'https://a.example.com' }] });
    expect(ok.flags.placeholderLeft).toBe(false);
  });
  it('protectLinkTokens: 감춘 글에 토큰 · 숫자 0 · 되돌리면 그대로', () => {
    const m = protectLinkTokens(`a ${TOKEN} b {{LINK:공식몰}}`);
    expect(m.text).not.toMatch(/\{\{|\d/);
    expect(m.restore(m.text)).toBe(`a ${TOKEN} b {{LINK:공식몰}}`);
  });
});

describe('P2 정해진 링크는 결과에 꼭 있다', () => {
  const url = 'https://shop.example.com/e/2026/10/31';
  it('출구: 모델이 링크를 뺐어도 마지막 줄에 · 주소 숫자는 날짜 · 혜택 판정을 안 탄다', () => {
    const r = exit('가을 신상을 만나 보세요', { onceLink: url, brandLinks: [{ label: ONCE_LINK_LABEL, url }] });
    expect(r.message_text).toBe(`가을 신상을 만나 보세요\n${url}`);
    expect(r.flags.inventedDates).toEqual([]);
  });
  it('출구: 등록 라벨 토큰 · 자리 표시도 사람이 정한 주소로 · 두 번 붙지 않는다', () => {
    const r = exit('가을 신상\n{{LINK:공식몰}}', { onceLink: url, brandLinks: [{ label: '공식몰', url: 'https://reg.example.com' }, { label: ONCE_LINK_LABEL, url }] });
    expect(r.message_text).toBe(`가을 신상\n${url}`);
    const p = exit(`가을 신상\n${LINK_PLACEHOLDER}`, { onceLink: url });
    expect(p.message_text).toBe(`가을 신상\n${url}`);
    expect(p.flags.placeholderLeft).toBe(false);
  });
  it('ensureOnceLink: 토큰 · 여정 자리 표시 바꿈 · 있으면 그대로 · url 없음 = 무변 · 비 ASCII = ASCII 로', () => {
    expect(ensureOnceLink(`자세히 → [URL 입력]`, url)).toEqual({ text: `자세히 → ${url}`, appended: false });
    expect(ensureOnceLink(`보기 ${url}`, url)).toEqual({ text: `보기 ${url}`, appended: false });
    expect(ensureOnceLink('보기', null)).toEqual({ text: '보기', appended: false });
    const k = ensureOnceLink('보기', 'https://shop.example.com/이벤트');
    expect(k.text).toBe('보기\nhttps://shop.example.com/%EC%9D%B4%EB%B2%A4%ED%8A%B8');
    expect(k.appended).toBe(true);
  });
  it('지시문 once 갈래 = 그 토큰 하나 · 꼭 한 번 · 습관 위치', () => {
    const s = onceLinkPromptSection({ uses_url: true, position: 'body_end', avg_urls_per_message: 1 });
    expect(s).toContain(TOKEN);
    expect(s).toContain('꼭 한 번');
    expect(s).toContain('CTA 문구 다음 줄');
  });
  it('resolveFormLink once 치환 값 · 비토큰 지시문 줄 = asciiLink 같은 값', () => {
    const raw = 'https://shop.example.com/가을';
    const r = resolveFormLink([], { link: { value: raw } });
    expect(r.mode).toBe('once');
    expect(r.links[0].url).toBe(asciiLink(raw));
    const sec = voiceFormPromptSection({ slots: ['link'], values: { link: false, phone: null }, decision: { link: { value: raw } }, useLinkTokens: false });
    expect(sec).toContain(`링크 칸: ${asciiLink(raw)}`);
  });
});

describe('P5 주소 읽기 한 곳', () => {
  it('readLinkText: 글 속 · 한 덩어리 · www · 도메인 꼴 · 사설 거절 · 끝 문장부호', () => {
    expect(readLinkText('https://shop.example.com/e')).toEqual({ raw: 'https://shop.example.com/e', url: 'https://shop.example.com/e' });
    // ★ Harold 1031 「적은 그대로 넣기」 — https:// 는 검사할 때만 붙여 본다(값 = 적은 그대로)
    expect(readLinkText('www.shop.example.com/e')).toEqual({ raw: 'www.shop.example.com/e', url: 'www.shop.example.com/e' });
    expect(readLinkText('shop.co.kr/event')?.url).toBe('shop.co.kr/event');
    expect(readLinkText('bit.ly/abc')?.url).toBe('bit.ly/abc');
    expect(readLinkText('이벤트 페이지는 https://shop.example.com/e 입니다.')?.url).toBe('https://shop.example.com/e');
    expect(readLinkText('http://192.168.0.1/x')).toBeNull();
    expect(readLinkText('localhost:3000')).toBeNull();
    expect(readLinkText('없어요')).toBeNull();
    expect(readLinkText('v2.0')).toBeNull();
  });
  it('길이 = 사람이 적은 글자(LINK_MAX) · 직렬화로 길어져도 거절하지 않는다', () => {
    expect(LINK_MAX).toBe(500);
    expect(VOICE_FORM_ASK.link.maxLength).toBe(LINK_MAX);
    const long = `https://shop.example.com/${'a'.repeat(400)}`;
    expect(cleanFormLink(long)).toBe(long);
    expect(cleanFormLink(`https://shop.example.com/${'a'.repeat(480)}`)).toBeNull();
    const ko = `https://shop.example.com/${'가'.repeat(60)}`;
    expect(readLinkText(ko)?.url).toBe(ko);
    expect(asciiLink(ko).length).toBeGreaterThan(LINK_MAX);
  });
  it('asciiLink: ASCII 그대로(끝 / 안 붙임) · 한글 · 이모지 · 한글 도메인 → ASCII', () => {
    expect(asciiLink('https://shop.example.com')).toBe('https://shop.example.com');
    expect(asciiLink('https://shop.example.com/🎁')).toBe('https://shop.example.com/%F0%9F%8E%81');
    expect(/^[\x21-\x7e]+$/.test(asciiLink('https://한글.kr/가'))).toBe(true);
  });
  it('목소리 링크 결정: www 꼴을 받는다 · 거절 문구 · 지금 받던 입력 = 결정 · 지문 글자 그대로', () => {
    expect(decideVoiceForm(['link'], { link: 'www.shop.example.com' })).toEqual({ ok: true, decision: { link: { value: 'www.shop.example.com' } } });
    expect(readVoiceFormDecision({ link: { value: 'www.shop.example.com/e' } })).toEqual({ link: { value: 'www.shop.example.com/e' } });
    expect(decideVoiceForm(['link'], { link: '없음' })).toEqual({ ok: false, slot: 'link', error: LINK_INVALID_ERROR });
    const sent = decideSentVoiceForm(['link'], { link: 'https://shop.example.com/a' });
    expect(sent.ok && sent.print).toBe('link=https://shop.example.com/a');
  });
});

describe('P1 링크 질문 한 자리', () => {
  const ai = (list: Array<{ kind: string; question: string }>) => sanitizeAiAsks(list.map((q) => ({ ...q, why: '' })), '가을 신상 홍보');
  it('목소리 링크 질문이 있으면 그것 하나 · AI kind link 질문은 빠진다 · 한 줄 주소 = 미리 채움', () => {
    const asks = mergeLineAsks('가을 신상 홍보 https://shop.example.com/e', ai([{ kind: 'link', question: '이벤트 페이지 주소를 알려 주세요' }]), voiceLineAsks(['link']), 'https://shop.example.com/e');
    const links = asks.filter((a) => /링크|주소/.test(a.text));
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe('voice_link');
    expect(links[0].prefill).toBe('https://shop.example.com/e');
  });
  it('목소리 링크 질문이 없고 AI 가 kind link 로 물었으면 = 서버 상수 질문 하나', () => {
    const asks = mergeLineAsks('가을 신상 홍보', ai([{ kind: 'link', question: '링크가 있나요?' }, { kind: 'link', question: '사이트 주소는요?' }]), [], null);
    const link = asks.filter((a) => a.id === LINE_LINK_ASK.id);
    expect(link).toHaveLength(1);
    expect(link[0].text).toBe(LINE_LINK_ASK.label);
    expect(asks.some((a) => a.id === 'ai_link')).toBe(false);
  });
  it('한 줄 주소만 있어도 = 서버 상수 질문 + 미리 채움 · 없으면 링크 질문 0', () => {
    expect(mergeLineAsks('가을 신상', [], [], 'https://shop.example.com/e').find((a) => a.id === LINE_LINK_ASK.id)?.prefill).toBe('https://shop.example.com/e');
    expect(mergeLineAsks('가을 신상', [], [], null).some((a) => a.id === LINE_LINK_ASK.id)).toBe(false);
  });
  it('kind text 질문은 글에 링크 · URL · 홈페이지가 있어도 그대로(Codex 설계 2R ③ · 3R 반례)', () => {
    const asks = mergeLineAsks('가을 신상 홍보', ai([
      { kind: 'text', question: '링크로 접속해야만 행사에 참여할 수 있나요?' },
      { kind: 'text', question: '이번 행사는 홈페이지에서만 진행하나요?' },
    ]), voiceLineAsks(['link']), null);
    expect(asks.map((a) => a.text)).toEqual(expect.arrayContaining(['링크로 접속해야만 행사에 참여할 수 있나요?', '이번 행사는 홈페이지에서만 진행하나요?']));
  });
  it('답 가르기: LINE_LINK_ASK 답 = lineLink(근거 글 밖) · 목소리 링크 = voice · 그 밖 = others', () => {
    const r = splitVoiceLineAnswers([
      { q: LINE_LINK_ASK.label, a: 'shop.example.com/e' },
      { q: VOICE_FORM_ASK.link.label, a: '' },
      { q: '어떤 상품인가요?', a: '니트 https://shop.example.com/ref' },
    ], []);
    expect(r.lineLink).toBe('shop.example.com/e');
    expect(r.voice).toEqual({ link: '' });
    expect(r.others).toEqual([{ q: '어떤 상품인가요?', a: '니트 https://shop.example.com/ref' }]);
  });
  it('withLinkToken: 정해진 주소 글자(raw · url)만 토큰으로 · 참고 주소는 그대로', () => {
    const link = readLinkText('www.shop.example.com/e')!;
    // 링크 구간(덩어리 몸 전체)이 글자 그대로 같을 때만 · 부분 문자열 0(Codex 1031 ② 링크 구간 읽기 한 곳)
    expect(withLinkToken('www.shop.example.com/e 여기서 · 참고 https://other.example.com', link)).toBe(`${TOKEN} 여기서 · 참고 https://other.example.com`);
    expect(withLinkToken('https://www.shop.example.com/e', link)).toBe('https://www.shop.example.com/e');   // 적은 꼴(www)과 다른 글자 = 그대로
    expect(withLinkToken('https://shop.example.com/a', readLinkText('https://shop.example.com/a'))).toBe(TOKEN);
    expect(withLinkToken('그대로', null)).toBe('그대로');
  });
  it('답 상한 500(긴 주소가 잘리지 않는다)', () => {
    const long = `https://shop.example.com/${'a'.repeat(300)}`;
    const r = readLineAnswers([{ q: LINE_LINK_ASK.label, a: long }]);
    expect(r !== 'invalid' && r[0].a).toBe(long);
  });
});

describe('P6 다시 쓰기 링크 보존', () => {
  it('rewriteDropsLinks: 원문 주소가 빠지거나 바뀌면 참 · 남으면 거짓 · 원문에 주소 없으면 거짓', () => {
    expect(rewriteDropsLinks('새 글', '원문 https://shop.example.com/e')).toBe(true);
    expect(rewriteDropsLinks('새 글 https://shop.example.com/x', '원문 https://shop.example.com/e')).toBe(true);
    expect(rewriteDropsLinks('새 글\nhttps://shop.example.com/e', '원문 https://shop.example.com/e.')).toBe(false);
    expect(rewriteDropsLinks('새 글', '원문')).toBe(false);
  });
  it('꾸미기: 자르기 · 정제 뒤 최종 글로 판정 · 빠지면 원문 · kept', () => {
    const src = read(BACK, 'utils/operator-message-decorator.ts');
    expect(src).toContain('const linkKept = !ok || !rewriteDropsLinks(made, origOut);');
    expect(src).toContain('const out = linkKept ? made : origOut;');
    expect(src).toContain('if (!ok || !linkKept || out === origOut) kept.push(i);');
    expect(src.indexOf('const made = sanitizeForSms(decorated.slice(0, 2000)).sanitized;')).toBeLessThan(src.indexOf('rewriteDropsLinks(made, origOut)'));
  });
  it('다듬기 후보 거름: 마지막 다듬은 글로 rewriteDropsLinks · 빠진 후보 = fabricated', () => {
    const src = read(BACK, 'services/ai.ts');
    expect(src).toContain('if (rewriteAddsFacts(text, factSource) || rewriteDropsLinks(text, originalMessage)) {');
  });
});

describe('배선(계약)', () => {
  const svc = read(BACK, 'services/ai-line.ts');
  it('AI 한줄로 만들기: 링크 = 링크 질문 한 자리 · 키 채널 = 칼럼 규칙 · 출력 채널 = 칼럼 또는 링크 · 결정 · 사실 글 토큰', () => {
    expect(svc).toContain('const sentLink = split.voice.link !== undefined ? split.voice.link : split.lineLink;');
    expect(svc).toContain("const keyChannel: 'SMS' | 'LMS' | 'MMS' = input.vars.length > 0 && input.channel === 'SMS' ? 'LMS' : input.channel;");
    expect(svc).toContain("const channel: 'SMS' | 'LMS' | 'MMS' = (input.vars.length > 0 || humanLink) && input.channel === 'SMS' ? 'LMS' : input.channel;");
    expect(svc).toContain('types: input.types, vars: input.vars, channel: keyChannel, isAd: input.isAd,');
    expect(svc).toContain('const voiceForm = humanLink ? { ...voiceDecided.decision, link: { value: humanLink.url } } : voiceDecided.decision;');
    expect(svc).toContain('${buildLineEventText(withLinkToken(input.line, humanLink), { benefit: input.facts.benefit })}');
    expect(svc).toMatch(/\n {8}voiceForm,\n/);
    expect(svc.indexOf('const sentLink')).toBeLessThan(svc.indexOf('const copyKey = aiLineCopyKey('));
  });
  it('AI 한줄로 대상 찾기: 한 줄 속 주소 = 링크 질문 미리 채움', () => {
    expect(svc).toContain('voiceLineAsks(voiceForm.asks), readLinkText(line)?.url ?? null);');
  });
  it('생성기: once 주소를 출구에 넘긴다 · 지시문 once 갈래 · 대상 찾기 지시문 kind link', () => {
    const ai = read(BACK, 'services/ai.ts');
    expect(ai).toContain('const onceLink = formLink.once ?? null;');
    expect(ai).toContain('channel, isAd, bannedWords, benefitGround, baseDate, onceLink,');
    expect(ai).toContain('"kind": "benefit 또는 period 또는 link 또는 text"');
    const bvp = read(BACK, 'utils/brand-voice-prompt.ts');
    expect(bvp).toMatch(/formLink\.mode === 'once'\s*\?\s*onceLinkPromptSection\(/);
  });
  it('여정 출구: 정제 · 거름 뒤 · 전송자 명칭 앞에 ensureOnceLink', () => {
    const j = read(BACK, 'utils/journey-ai-generator.ts');
    expect(j).toContain('const linked = ensureOnceLink(season.text, onceLink).text;');
    expect(j).toContain('const named = ensureSenderName(linked,');
  });
  it('화면: 답 칸 500 · 미리 채움(빈 칸만) · LMS 안내 · 모델명 0', () => {
    const m = read(FRONT, 'components/ai-line/LineIntakeModal.tsx');
    expect(m).toContain('const ANSWER_MAX = 500;');
    expect(m).toContain('maxLength={ANSWER_MAX}');
    expect(m).toContain("a: (textAns[a.id] || '').trim().slice(0, ANSWER_MAX)");
    expect(m).toContain('for (const a of fills) if (next[a.id] === undefined) next[a.id] = a.prefill as string;');
    expect(m).toContain('칼럼이나 링크가 들어가면 장문(LMS)으로 보내요');
    expect(m).toMatch(/onChange=\{\(e\) => setTextAns\(\(cur\) => \(\{ \.\.\.cur, \[a\.id\]: e\.target\.value \}\)\)\}\s*maxLength=\{ANSWER_MAX\}/);
    expect(m).not.toMatch(/Opus|Sonnet|Haiku|Claude|Anthropic|GPT/);
    expect(read(FRONT, 'utils/ai-line.ts')).toMatch(/prefill\?: string;/);
  });
});

describe('Codex 구현 1R 반례', () => {
  it('① 회사가 「이번 문자 링크」 라벨을 등록해도 once = 사람이 정한 주소', () => {
    const r = resolveFormLink([{ label: ONCE_LINK_LABEL, url: 'https://reg.example.com' }], { link: { value: 'https://new.example.com/e' } });
    expect(r.once).toBe('https://new.example.com/e');
    const out = exit(`보기\n${TOKEN}`, { onceLink: r.once, brandLinks: r.links });
    expect(out.message_text).toBe('보기\nhttps://new.example.com/e');
  });
  it('② 같은 주소 = 꺼낸 주소가 글자 그대로(「/event」 ≠ 「/event-new」)', () => {
    expect(rewriteDropsLinks('보기 https://shop.example.com/event-new', '보기 https://shop.example.com/event')).toBe(true);
    const e = ensureOnceLink('보기 https://shop.example.com/event-new', 'https://shop.example.com/event');
    expect(e.appended).toBe(true);
    expect(e.text.endsWith('\nhttps://shop.example.com/event')).toBe(true);
  });
  it('③ 토큰화는 주소 단위로만 · 다른 참고 주소의 일부를 바꾸지 않는다', () => {
    const link = readLinkText('shop.example.com')!;
    expect(withLinkToken('참고 https://help.shop.example.com/terms', link)).toBe('참고 https://help.shop.example.com/terms');
    // 낱말에 붙은 자리(입니다(…)는 덩어리 몸이 링크가 아니다 = 그대로(링크로 오인하지 않는 쪽)
    expect(withLinkToken('주소는 shop.example.com 입니다(shop.example.com).', link)).toBe(`주소는 ${TOKEN} 입니다(shop.example.com).`);
    const full = readLinkText('https://shop.example.com/event')!;
    expect(withLinkToken('새 https://shop.example.com/event-new · 이것 https://shop.example.com/event.', full)).toBe(`새 https://shop.example.com/event-new · 이것 ${TOKEN}.`);
  });
  it('④ 주소의 $ 는 글자 그대로(치환 문법 0)', () => {
    const url = 'https://shop.example.com/p/$$';
    const e = ensureOnceLink(`보기\n${TOKEN}`, url);
    expect(e).toEqual({ text: `보기\n${url}`, appended: false });
    const amp = ensureOnceLink(`보기 ${LINK_PLACEHOLDER}`, 'https://shop.example.com/a$&b');
    expect(amp.text).toBe('보기 https://shop.example.com/a$&b');
  });
});

describe('Codex 구현 2R 반례', () => {
  it('맨 주소 꼴 토큰화는 일반 글 구간에만 · 다른 주소 구간 안쪽(괄호 경로)은 그대로', () => {
    const link = readLinkText('shop.example.com/event')!;
    const ref = 'https://help.example.com/(shop.example.com/event)/terms';
    expect(withLinkToken(`참고 ${ref} · 문자 링크 (shop.example.com/event).`, link)).toBe(`참고 ${ref} · 문자 링크 (${TOKEN}).`);
  });
});

describe('Codex 구현 3R 반례', () => {
  it('구간 끝에 다른 주소가 이어진 맨 주소 꼴은 그대로 · http 주소 구간은 통째로 같을 때만', () => {
    const link = readLinkText('shop.example.com/login?next=')!;
    const txt = 'shop.example.com/login?next=https://help.example.com/terms';
    expect(withLinkToken(txt, link)).toBe(txt);
    const full = readLinkText('https://shop.example.com/r?u=https://b.example.com')!;
    expect(withLinkToken('보기 https://shop.example.com/r?u=https://b.example.com 끝', full)).toBe(`보기 ${TOKEN} 끝`);
  });
});

describe('Harold 1031 「적은 그대로 넣기」', () => {
  it('asciiLink: https:// 없는 꼴도 적은 그대로 · 비 ASCII 만 바꾼다', () => {
    expect(asciiLink('www.shop.example.com/e')).toBe('www.shop.example.com/e');
    expect(asciiLink('www.shop.example.com/가')).toBe('www.shop.example.com/%EA%B0%80');
  });
  it('textLinks: http 주소 + https:// 없는 한 덩어리 링크(괄호 · 끝 문장부호 뺀 몸) · 링크 아닌 글은 0', () => {
    expect(textLinks('보기 https://a.example.com/e. 또는 (www.b.example.com/x), bit.ly/abc 끝')).toEqual(['https://a.example.com/e', 'www.b.example.com/x', 'bit.ly/abc']);
    expect(textLinks('1.5배 · v2.0 · 가을.신상 · 2026.10.31')).toEqual([]);
  });
  it('once 가 https:// 없는 꼴이면 그 글자 그대로 넣고 · 있으면 붙이지 않는다 · 빠지면 붙인다', () => {
    const url = 'www.shop.example.com/e';
    expect(exit(`가을 신상\n${TOKEN}`, { onceLink: url, brandLinks: [{ label: ONCE_LINK_LABEL, url }] }).message_text).toBe(`가을 신상\n${url}`);
    expect(ensureOnceLink(`보기 ${url} 에서`, url)).toEqual({ text: `보기 ${url} 에서`, appended: false });
    expect(ensureOnceLink('보기 www.shop.example.com/event', url).appended).toBe(true);
    const r = resolveFormLink([], { link: { value: url } });
    expect(r.once).toBe(url);
  });
  it('다시 쓰기: https:// 없는 링크도 빠지면 잡는다', () => {
    expect(rewriteDropsLinks('새 글', '원문 www.shop.example.com/e')).toBe(true);
    expect(rewriteDropsLinks('새 글 bit.ly/abc', '원문 bit.ly/abc.')).toBe(false);
    expect(rewriteDropsLinks('새 글 bit.ly/abcd', '원문 bit.ly/abc')).toBe(true);
  });
});

describe('Codex 1031(두 갈래) 반례', () => {
  it('② 안쪽에 다른 주소가 이어진 링크 = 덩어리 전체가 링크 하나(안쪽 주소로 쪼개지 않는다)', () => {
    const outer = 'shop.example.com/login?next=https://help.example.com/terms';
    expect(textLinks(`보기 ${outer} 끝`)).toEqual([outer]);
    expect(rewriteDropsLinks('보기 https://help.example.com/terms', `보기 ${outer}`)).toBe(true);
    expect(ensureOnceLink(`보기 ${outer}`, outer)).toEqual({ text: `보기 ${outer}`, appended: false });
    expect(textLinks('주소:https://a.example.com/e 참고')).toEqual(['https://a.example.com/e']);
  });
  it('③ 길이 상한 = 사람이 적은 글자 검사에만 · ASCII 로 길어진 링크도 꺼내 본다', () => {
    const typed = `www.shop.example.com/${'가'.repeat(60)}`;
    expect(readLinkText(typed)?.url).toBe(typed);
    const ascii = asciiLink(typed);
    expect(ascii.length).toBeGreaterThan(LINK_MAX);
    expect(textLinks(`보기 ${ascii}`)).toEqual([ascii]);
    expect(ensureOnceLink(`보기 ${ascii}`, typed)).toEqual({ text: `보기 ${ascii}`, appended: false });
    expect(rewriteDropsLinks('새 글', `원문 ${ascii}`)).toBe(true);
  });
});

describe('Codex 1031(두 갈래) 3R 반례 · 주소 끝 떼기 한 곳', () => {
  it('경로 안 짝 맞는 괄호는 지키고 · 감싼 괄호 · 문장부호만 뗀다', () => {
    const u = 'https://shop.example.com/p/item(v2)';
    expect(textLinks(`보기 ${u}`)).toEqual([u]);
    expect(textLinks(`(보기 ${u})`)).toEqual([u]);
    expect(textLinks(`보기 (${u}).`)).toEqual([u]);
    expect(textLinks('보기 (www.shop.example.com/e).')).toEqual(['www.shop.example.com/e']);
    expect(readLinkText(`이 주소 ${u} 로 안내`)?.url).toBe(u);
    expect(rewriteDropsLinks('보기 https://shop.example.com/p/item(v2', `보기 ${u}`)).toBe(true);
    expect(ensureOnceLink(`보기 ${u}`, u)).toEqual({ text: `보기 ${u}`, appended: false });
  });
});
