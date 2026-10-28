/**
 * AI 메모리 · 브랜드 보이스 묶음 B · C (★ 2026-10-28 · 설계서 docs/2026-10-28-ai-memory-brand-voice-design.md §6 · K11 · K14 · K15-3)
 *
 * 고치기 출구 대조 · 쓸수록(고친 차이 · 습관 · 조언) · CF 3사 격리(같은 한 줄 → 자기 뼈대만 · 법 우선 줄 늘 · 안부 = 안부 · 여정 = 성격별 블록).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const db = vi.hoisted(() => ({ byCompany: {} as Record<string, Record<string, any[]>> }));
vi.mock('../../config/database', () => {
  const q = vi.fn(async (sql: string, params: any[] = []) => {
    const rows = db.byCompany[String(params[0])] || {};
    for (const [needle, out] of Object.entries(rows)) if (sql.includes(needle)) return { rows: out };
    return { rows: [] };
  });
  return { default: { query: q, connect: vi.fn() }, query: q, pool: { query: q, connect: vi.fn() } };
});

import { rewriteShapeDrift } from '../copy-shape';
import { learnFromEdits, buildHabitProfile, habitAdvice, editFormLines, PHRASE_REPEAT_MIN, HABIT_MIN_SAMPLES } from '../voice-habits';
import { composeVoicePrompt, invalidateBrandVoiceCache } from '../brand-voice-prompt';
import { textHash } from '../brand-voice-skeleton';

const SRC = (...p: string[]) => readFileSync(resolve(process.cwd(), 'src', ...p), 'utf8').replace(/\r\n/g, '\n');

describe('K11-1 고치기 출구 대조(I12)', () => {
  it('줄바꿈이 사라짐 · 빈 줄이 늘어남 · 원문에 없던 기호 = 꼴 이탈', () => {
    const orig = '[한줄]\n가을 신상\n지금 만나요';
    expect(rewriteShapeDrift(orig, '[한줄] 가을 신상 지금 만나요')).toContain('줄바꿈이 사라짐');
    expect(rewriteShapeDrift(orig, '[한줄]\n\n\n가을 신상\n지금 만나요')).toContain('빈 줄이 늘어남');
    expect(rewriteShapeDrift(orig, '[한줄]\n가을 신상 ◆\n지금 만나요').some((x) => x.includes('◆'))).toBe(true);
    expect(rewriteShapeDrift(orig, '[한줄]\n가을 새 옷\n지금 만나요!')).toEqual([]);
  });
  it('고치기 생산자 = 다시 쓰기를 버린다(여정 스팸 재작성 · 단계 다듬기 · 대행 스팸 회피)', () => {
    expect(SRC('utils', 'journey-ai-generator.ts').match(/rewriteShapeDrift\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(SRC('utils', 'agency-send-refine.ts')).toContain('rewriteShapeDrift(original, text)');
  });
});

describe('K14-1 고친 차이 = 형식 값 + 반복 3 후보(사실 0)', () => {
  const pair = (k: string, before: string, after: string) => ({ sendKey: k, before, after });
  it('글귀 후보 = 서로 다른 발송 3건 이상 · 숫자 · 혜택 · 가린 자리 든 글귀는 후보도 아님', () => {
    const before = '봄 신상 입고.\n지금 만나보세요.';
    const after = '봄 신상 입고.\n늘 고맙습니다 한줄입니다.\n지금 만나보세요.';
    const pairs = ['a', 'b', 'c'].map((k) => pair(k, before, after));
    const r = learnFromEdits(pairs);
    expect(r.candidates.map((c) => [c.mode, c.text, c.count])).toEqual([['use', '늘 고맙습니다 한줄입니다.', 3]]);
    expect(learnFromEdits(pairs.slice(0, 2)).candidates).toEqual([]);   // 2건 = 아직
    const facty = ['a', 'b', 'c'].map((k) => pair(k, before, `${after}\n30% 할인 쿠폰 드려요.`));
    expect(learnFromEdits(facty).candidates.some((c) => c.text.includes('30%'))).toBe(false);
    expect(PHRASE_REPEAT_MIN).toBe(3);
  });
  it('지운 칩은 다시 올리지 않는다 · 형식 값 = 글자 0', () => {
    const pairs = ['a', 'b', 'c'].map((k) => pair(k, '안녕하세요 고객님.\n봄 신상이에요.', '봄 신상이에요.'));
    const first = learnFromEdits(pairs);
    expect(first.candidates[0]).toMatchObject({ mode: 'avoid', text: '안녕하세요 고객님.' });
    expect(learnFromEdits(pairs, [first.candidates[0].id]).candidates).toEqual([]);
    const lines = editFormLines({ moreLines: 3, fewerLines: 0, addedSymbols: ['★'], removedSymbols: [], toHaeyo: 3, toHapsho: 0, samples: 3 });
    expect(lines.join('\n')).toContain('줄을 더 나눈다');
    expect(lines.join('\n')).toContain('★');
    expect(lines.join('\n')).not.toMatch(/봄|신상/);
  });
});

describe('K14-2 · K14-3 습관 · 조언(AI 0)', () => {
  it('10건 미만 = 없음 · 요일 · 시각 = KST · 간격 중앙값 · 조언 = 숫자 문장', () => {
    const mk = (i: number) => ({ sentAt: new Date(Date.UTC(2026, 9, 6 + i * 7, 1, 0)).toISOString(), channel: 'LMS' as const, isAd: true, text: '이번 주 20% 할인' });
    expect(buildHabitProfile(Array.from({ length: HABIT_MIN_SAMPLES - 1 }, (_, i) => mk(i)))).toBeNull();
    const p = buildHabitProfile(Array.from({ length: 12 }, (_, i) => mk(i)))!;
    expect(p.topWeekdays).toEqual([2]);   // 2026-10-06 10:00 KST = 화
    expect(p.topHours).toEqual([10]);
    expect(p.intervalMedianDays).toBe(7);
    const advice = habitAdvice(p).join(' ');
    expect(advice).toContain('화요일');
    expect(advice).toContain('오전 10시');
    expect(advice).toContain('7일마다');
    expect(habitAdvice(null)).toEqual([]);
  });
  it('습관은 문안 프롬프트에 싣지 않는다(목소리 CT 는 받아들인 글귀 · 형식 값만)', () => {
    const v = SRC('utils', 'brand-voice-prompt.ts');
    expect(v).not.toMatch(/habit_profile|topWeekdays|intervalMedianDays/);
    expect(v).toContain('editFormLines(data.edit.form)');
  });
});

describe('K15-3 CF 3사 격리(도달 불가 값)', () => {
  const company = (id: string, brand: string, tone: string, kind: 'marketing' | 'notice') => {
    const text = `[${brand}]\n${brand} 단골 고객님께 드리는 소식이에요.\n매장에서 만나요.`;
    const skeleton = `[${brand}]\n${brand} 단골 고객님께 드리는 소식이에요.\n[매장: 직접 입력해주세요]에서 만나요.`;
    db.byCompany[id] = {
      "memory_type = 'brand_guideline'": [{ memory_key: 'main', memory_value: JSON.stringify({ tone_signature: tone, frequent_expressions: [], greeting_pattern: '', cta_patterns: [], signature: '', emoji_whitelist: [], voice_kind: kind }) }],
      "memory_type = 'representative_message'": [{ id: `${id}-m1`, memory_value: JSON.stringify({ channel: 'LMS', message_text: text, manual_priority: 1, content_type: kind === 'notice' ? 'greeting' : 'promo' }) }],
      "memory_type = 'brand_voice_state'": [{ memory_value: JSON.stringify({ gen: 1, guidelineGen: 1, extract: { gen: 1, at: '' }, reviewed: { extractGen: 1, at: '', by: null, skeletons: { [`${id}-m1`]: { hash: textHash(text), text: skeleton } }, phrases: {} } }) }],
    };
  };
  beforeEach(() => {
    db.byCompany = {};
    company('cf-a', '결온테스트', '정중/격조', 'marketing');
    company('cf-b', '오후담테스트', '친근/캐주얼', 'marketing');
    company('cf-c', '소요웨어테스트', '활기/감성', 'notice');
    for (const c of ['cf-a', 'cf-b', 'cf-c']) invalidateBrandVoiceCache(c);
  });
  it('같은 한 줄 → 자기 뼈대 · 톤만(다른 회사 글자 0) · 법 우선 줄 늘', async () => {
    const out: Record<string, string> = {};
    for (const c of ['cf-a', 'cf-b']) out[c] = (await composeVoicePrompt({ companyId: c, producer: 'cf', mode: 'write', kind: 'marketing', basePrompt: 'BASE' })).system;
    expect(out['cf-a']).toContain('결온테스트 단골 고객님께');
    expect(out['cf-a']).toContain('정중/격조');
    expect(out['cf-a']).not.toMatch(/오후담|소요웨어/);
    expect(out['cf-b']).toContain('오후담테스트 단골 고객님께');
    expect(out['cf-b']).not.toMatch(/결온|소요웨어/);
    for (const s of Object.values(out)) {
      expect(s).toContain('법(광고 표기 · 수신거부 · 전송자 명칭 · 바이트 · 없는 혜택 · 날짜 · 효능) > 발송 규칙');
      expect(s).toContain('[매장: 직접 입력해주세요]');   // 사실 자리 = 칸(원문 매장명 0)
    }
  });
  it('안부 줄 = 안부 예시 · 여정 패키지 = 성격별 블록 · 단계마다 종류 칸', async () => {
    const n = (await composeVoicePrompt({ companyId: 'cf-c', producer: 'cf', mode: 'write', kind: 'notice', contentType: 'greeting', basePrompt: 'BASE' })).system;
    expect(n).toContain('소요웨어테스트 단골 고객님께');
    expect(n).toContain('이 회사 안부 · 알림 문자 기준');
    const j = (await composeVoicePrompt({ companyId: 'cf-c', producer: 'journey', mode: 'write', kind: 'by_step', basePrompt: 'BASE' })).system;
    expect(j).toContain('단계마다 성격');
    expect(j).toContain('contentType');
  });
});
