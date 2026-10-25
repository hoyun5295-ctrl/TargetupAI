/**
 * ★ 2026-10-24 효능 단정 판정 한 곳(한 줄 CT 구조체크 ① · ③ · 뿌리 대장 R1)
 *   그림 글 · 한 줄 CT 글(판단 이유 · 초안 · 본문 문구) · 문자 문안이 같은 판정(copy-benefit-detector)을 쓴다.
 *   근거(사람이 쓴 한 줄 · 요청)에 같은 단정 말이 있으면 근거 있는 말이다(혜택 판정과 같은 원칙).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { claimsEfficacy, claimsInventedEfficacy, dropInventedEfficacy, EFFICACY_PLACEHOLDER } from '../copy-benefit-detector';
import { findUneditedSendPlaceholder } from '../send-placeholder-gate';
import { headlineClaimsEfficacy } from '../line-headline';
import { sanitizeLineRichCopy, cleanLineCtText } from '../one-line-ct/ai';
import { getLineComposition } from '../line-compositions';

describe('효능 단정 판정', () => {
  it('몸 · 피부 말 + 변화 말 = 단정 · 「달라지는 · 좋아지는」 꼴도 잡는다 · 날씨 · 기분 말은 아니다', () => {
    expect(claimsEfficacy('내일 아침 피부가 달라지는 마스크팩')).toBe(true);
    expect(claimsEfficacy('피부가 좋아지는 시간')).toBe(true);
    expect(claimsEfficacy('가입만 해도 피부가 편안해져요')).toBe(true);
    expect(claimsEfficacy('붓기가 빠지는 아침')).toBe(true);
    expect(claimsEfficacy('효능을 확인하세요')).toBe(true);
    expect(claimsEfficacy('몸도 마음도 따뜻해지는 겨울')).toBe(false);
    expect(claimsEfficacy('피부 관리에 빠지지 않는 필수템')).toBe(false);
    expect(claimsEfficacy('기분 좋아지는 향이 피부에 닿아요')).toBe(false);
    expect(claimsEfficacy('뱃살이 빠지는 루틴')).toBe(true);
    expect(claimsEfficacy('바르는 순간 피부에 스며드는 촉촉함')).toBe(false);
    expect(claimsEfficacy('새로 나왔어요')).toBe(false);
  });
  it('그림 글 판정 = 같은 함수', () => {
    expect(headlineClaimsEfficacy).toBe(claimsEfficacy);
  });
  it('근거에 같은 말이 있으면 근거 있는 말 · 다른 말이면 지어낸 단정', () => {
    expect(claimsInventedEfficacy('주름 개선 기능성 크림이에요', '주름 개선 기능성 크림 출시')).toBe(false);
    expect(claimsInventedEfficacy('피부가 좋아져요', '주름 개선 기능성 크림 출시')).toBe(true);
    expect(claimsInventedEfficacy('효능을 느껴 보세요', '보습 크림 출시')).toBe(true);
    expect(claimsInventedEfficacy('촉촉한 사용감', '보습 크림 출시')).toBe(false);
  });
  it('주장마다 근거를 따로 본다 · 흔한 효능 서술(낮춰요 · 높여요 · 없애요)도 단정이다(★ Codex 1R)', () => {
    expect(claimsInventedEfficacy('주름 개선과 혈당 감소에 도움을 줘요', '주름 개선 기능성 크림 출시')).toBe(true);
    expect(claimsInventedEfficacy('주름 개선 기능성 크림', '주름 개선 기능성 크림 출시')).toBe(false);
    expect(claimsEfficacy('혈당을 낮춰요')).toBe(true);
    expect(claimsEfficacy('면역력을 높여요')).toBe(true);
    expect(claimsEfficacy('주름을 없애줘요')).toBe(true);
    expect(claimsEfficacy('가격은 착해졌어요')).toBe(false);
  });
  it('붙은 두 문장을 이어 읽어야 단정이 되면 두 문장을 함께 뺀다(★ Codex 1R)', () => {
    const r = dropInventedEfficacy('피부 고민 끝!\n매끈하게 달라져요.\n\n지금 만나 보세요', '보습 크림 출시');
    expect(r.dropped).toEqual(['피부 고민 끝!', '매끈하게 달라져요.']);
    expect(r.text).toBe('지금 만나 보세요');
  });
  it('다 빠지면 빈 글이 아니라 직접 채울 자리 — 발송 길목이 사람이 고치기 전까지 막는다(★ Codex 2R · 빈 문안 → 대체 문안이면 생성 요금이 남는다)', () => {
    const r = dropInventedEfficacy('피부가 좋아지는 크림', '');
    expect(r.text).toBe(EFFICACY_PLACEHOLDER);
    expect(findUneditedSendPlaceholder(r.text)?.code).toBe('BENEFIT_PLACEHOLDER_UNEDITED');
    const ai = readFileSync(resolve(__dirname, '../../services/ai.ts'), 'utf8');
    expect(ai).not.toContain('CUSTOM_COPY_EMPTY_AFTER_GUARD');
  });
  it('근거 = 고객이 쓴 그대로 · 근거 여기저기 흩어진 낱말 · 병렬 대상 하나만 근거인 것은 지어낸 단정(★ Codex 2R)', () => {
    expect(claimsInventedEfficacy('혈당 감소', '혈당 관리 상품입니다. 포장재 감소를 실천합니다.')).toBe(true);
    expect(claimsInventedEfficacy('혈당과 혈압을 낮춰요', '혈압을 낮춰요')).toBe(true);
    expect(claimsInventedEfficacy('혈압을 낮춰요', '혈압을 낮춰요')).toBe(false);
    expect(claimsInventedEfficacy('주름 개선\n기능성 크림', '주름 개선 기능성 크림 출시')).toBe(false);
    // 단정 말 = 그 문장 전체가 근거에 그대로 있어야 한다(낱말 「효능」만 근거에 있는 것은 근거가 아니다)
    expect(claimsInventedEfficacy('효능을 느껴 보세요', '효능 표기 없는 순한 크림')).toBe(true);
    expect(claimsInventedEfficacy('효능 인증을 받은 크림', '효능 인증을 받은 크림 출시')).toBe(false);
  });
  it('뒤에 붙은 병렬 대상까지 · 근거가 부정한 효능은 근거가 아니다 · 고객 기능 문구를 그대로 쓴 문장은 남는다(★ Codex 3R)', () => {
    expect(claimsInventedEfficacy('달라지는 피부와 모공', '달라지는 피부')).toBe(true);
    expect(claimsInventedEfficacy('달라지는 피부와 모공', '달라지는 피부와 모공 케어')).toBe(false);
    expect(claimsInventedEfficacy('주름 개선 효과를 느껴보세요.', '주름 개선 효과는 없습니다.')).toBe(true);
    expect(claimsInventedEfficacy('주름 개선 기능성', '주름 개선 기능성 크림, 끈적임 없어요')).toBe(false);
    expect(claimsInventedEfficacy('주름 개선 기능성', '주름 개선뿐 아니라 보습까지')).toBe(false);
    expect(claimsInventedEfficacy('주름 개선 기능성 크림으로 피부결을 가꿔 보세요', '주름 개선 기능성 크림')).toBe(false);
  });
  it('근거 절은 문장 부호 · 쉼표 · 줄에서만 끊는다 · 「~뿐 아니라」만 부정이 아니다 · 뒤 대상은 다음 변화 말 앞까지 전부(★ Codex 4R)', () => {
    expect(claimsInventedEfficacy('주름 개선 효과를 느껴보세요.', '주름 개선 효과가 있다고 볼 수 없습니다.')).toBe(true);
    expect(claimsInventedEfficacy('주름 개선 기능성', '주름 개선 광고 금지')).toBe(true);
    expect(claimsInventedEfficacy('주름 개선 기능성', '주름 개선 기능성이 아니라 일반 보습 제품입니다')).toBe(true);
    // 쉼표 없이 이어 쓴 부정은 앞 주장까지 부정으로 본다(안전 쪽)
    expect(claimsInventedEfficacy('주름 개선 기능성', '주름 개선 기능성 크림이고 끈적임 없어요')).toBe(true);
    expect(claimsInventedEfficacy('달라지는 피부와 눈가 주름', '달라지는 피부')).toBe(true);
    expect(claimsInventedEfficacy('달라지는 피부와 맑아지는 안색', '달라지는 피부와 맑아지는 눈빛')).toBe(true);
    expect(claimsInventedEfficacy('달라지는 피부와 맑아지는 안색', '달라지는 피부와 맑아지는 안색')).toBe(false);
    expect(claimsInventedEfficacy('달라지는 피부, 탄력이 좋아져요', '달라지는 피부, 탄력 있는 크림')).toBe(true);
  });
  it('대상이 어디 붙는지 뜻이 갈리면 두 해석을 모두 근거와 대조한다(★ Codex 5R)', () => {
    const text = '달라지는 피부, 주름 개선과 모공 케어';
    const ground = '달라지는 피부, 주름 고민 상담. 피부결 개선과 모공 케어';
    expect(claimsInventedEfficacy(text, ground)).toBe(true);
    expect(dropInventedEfficacy(text, ground).text).toBe(EFFICACY_PLACEHOLDER);
    // 쉼표 너머 앞 대상 = 뒤 대상도 함께 본다
    expect(claimsInventedEfficacy('피부 관리, 달라지는 모공', '피부 관리, 달라지는 하루')).toBe(true);
    // 고객 문구를 그대로 쓴 문장은 그대로 남는다
    expect(claimsInventedEfficacy(text, text)).toBe(false);
    // 괄호 · 따옴표 · 줄표 등 한글 · 공백이 아닌 글자를 건너도 뒤 대상을 함께 본다(★ Codex 6R)
    for (const [t, g] of [
      ['피부 관리(달라지는 모공)', '피부 관리(달라지는 하루)'],
      ['피부 관리 「달라지는 모공」', '피부 관리 「달라지는 하루」'],
      ['피부 관리 "달라지는 모공"', '피부 관리 "달라지는 하루"'],
      ['피부 관리 — 달라지는 모공', '피부 관리 — 달라지는 하루'],
    ]) {
      expect(claimsInventedEfficacy(t, g), t).toBe(true);
      expect(claimsInventedEfficacy(t, t), t).toBe(false);
    }
  });
  it('금지어 지우기는 자리표시를 넣기 전 — 뒤에서 지우면 자리표시 글자가 깎여 발송 길목을 지나간다(★ Codex 3R)', () => {
    const ai = readFileSync(resolve(__dirname, '../../services/ai.ts'), 'utf8');
    const banned = ai.indexOf('const hit = findBannedWords(msgField, bannedWords);');
    expect(banned).toBeGreaterThan(0);
    expect(banned).toBeLessThan(ai.indexOf('const inventedHere = findInventedBenefits(msgField, benefitGround);'));
    expect(banned).toBeLessThan(ai.indexOf('const effHere = dropInventedEfficacy(msgField, benefitGround);'));
    expect(ai.split('findBannedWords(').length - 1).toBe(1);
  });
  it('격식체 · 과거 · 관형 활용도 같은 단정(★ Codex 2R)', () => {
    for (const v of ['혈당을 낮춥니다', '면역력을 높입니다', '주름을 없앱니다', '피부가 달라졌어요', '달라진 피부', '피부가 좋아질 거예요', '피부가 편안해집니다', '뱃살이 빠졌어요']) {
      expect(claimsEfficacy(v), v).toBe(true);
    }
  });
  it('뺀 뒤 새로 붙는 이웃까지 본다 · 문단을 넘어 잇지 않는다 · 제 주어가 있는 문장은 앞 대상을 이어받지 않는다(★ Codex 2R)', () => {
    const r = dropInventedEfficacy('피부 고민 끝!\n효능을 확인하세요.\n매끈하게 달라져요.', '진정 앰플 출시');
    expect(r.text).toBe(EFFICACY_PLACEHOLDER);
    const keep = '피부 관리 제품이 새로 나왔어요.\n\n배송 일정이 달라져요.';
    expect(dropInventedEfficacy(keep, '수분 크림 출시')).toEqual({ text: keep, dropped: [] });
    const keep2 = '피부 관리 제품이 새로 나왔어요. 배송 일정이 달라져요.';
    expect(dropInventedEfficacy(keep2, '수분 크림 출시')).toEqual({ text: keep2, dropped: [] });
    expect(claimsEfficacy('피부 고민 끝! 많이 달라져요.')).toBe(true);
  });
  it('문자 문안 = 지어낸 단정 문장만 뺀다(문단 · 문장 단위 · 나머지 글자는 그대로)', () => {
    const text = '%이름%님, 겨울 준비하셨나요?\n\n자기 전 5분이면\n내일 아침 피부가 달라져요.\n촉촉한 사용감을 느껴 보세요.\n\n지금 만나 보세요';
    const r = dropInventedEfficacy(text, '수분 크림 신제품 출시');
    expect(r.dropped).toEqual(['자기 전 5분이면 내일 아침 피부가 달라져요.']);
    expect(r.text).toBe('%이름%님, 겨울 준비하셨나요?\n\n촉촉한 사용감을 느껴 보세요.\n\n지금 만나 보세요');
    const clean = '%이름%님\n\n새로 나온 크림이에요';
    expect(dropInventedEfficacy(clean, '')).toEqual({ text: clean, dropped: [] });
  });
});

describe('한 줄 CT 글 정리 = 같은 판정', () => {
  it('본문 문구 칸이 지어낸 단정이면 기본 문구 · 붙어서 읽히는 두 칸이 함께 단정이어도 기본 문구', () => {
    const comp = getLineComposition('spotlight')!;
    expect(cleanLineCtText('피부가 확 달라져요', 40, '진정 앰플 출시')).toBe('');
    const r = sanitizeLineRichCopy(comp, { headline: '피부 고민 끝', sub: '매끈하게 달라져요', closingHeadline: '지금 만나 보세요', closingBody: '버튼을 눌러 확인해 주세요' }, '진정 앰플 출시');
    const fb = Object.fromEntries(comp.copy.map((f) => [f.key, f.fallback]));
    expect(r.copy.headline).toBe(fb.headline);
    expect(r.copy.sub).toBe(fb.sub);
    expect(r.copy.closingHeadline).toBe('지금 만나 보세요');
    expect(r.replaced).toEqual(expect.arrayContaining(['headline', 'sub']));
  });
  // ★ 1025 F — 맞춤 생성(generateCustomMessages)은 부르는 곳이 없어 지웠다 · 남은 문자 생성 = 본문 · 제목 두 자리
  it('문자 생성 경로가 같은 거름을 부른다(혜택 거름과 같은 근거 글)', () => {
    const ai = readFileSync(resolve(__dirname, '../../services/ai.ts'), 'utf8');
    expect(ai).toContain('const effHere = dropInventedEfficacy(msgField, benefitGround);');
    expect(ai).toContain('const subjEff = dropInventedEfficacy(subj, benefitGround);');
    expect(ai).not.toContain('export async function generateCustomMessages(');
    // 프롬프트에 효능을 쓰라는 신호가 남지 않는다(LESSONS_BACKEND 0809 — 반대 신호를 세어 지운다)
    expect(ai).not.toMatch(/before\/after 기대감|성분 효능 \+|체감 변화 \+|건강 이점|피부가 달라지는 마스크팩|몸이 가벼워지는|성분\/효과 기반 설득/);
  });
});
