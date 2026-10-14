/**
 * email-block-copies.test.ts — 이메일 "지원 블록" 목록은 한 벌이다 (★ 2026-10-14 · 구조체크 R7)
 *
 * 종전엔 같은 목록이 네 곳에 손 사본으로 있었다: 렌더러 화이트리스트(진실) · 편집기 팔레트 상수 2벌(make-flow · EmailVisualEditor) ·
 * AI 생성 프롬프트의 `- type:` 줄. 한 곳이 늘면 나머지는 조용히 옛 목록으로 남는다(AI가 못 내는 블록 · 메뉴에 없는 블록).
 * 여기서 못 박는다: 진실 = `EMAIL_BLOCK_WHITELIST` 하나 · 프롬프트 줄 집합 = `EMAIL_AI_BLOCK_TYPES` ⊆ 화이트리스트 ·
 * 프론트 팔레트 = 화이트리스트와 같은 집합 · EmailVisualEditor는 그 값을 import(사본 0).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMAIL_BLOCK_WHITELIST, EMAIL_AI_BLOCK_TYPES } from '../email-blocks';

const FE_ROOT = resolve(__dirname, '../../../../../frontend/src');
const read = (p: string) => readFileSync(p, 'utf8');
const setOf = (a: readonly string[]) => [...new Set(a)].sort();

describe('이메일 지원 블록 사본 묶기', () => {
  it('AI 프롬프트의 "- type:" 줄 집합 = EMAIL_AI_BLOCK_TYPES ⊆ 화이트리스트', () => {
    const src = read(resolve(__dirname, '../../email-ai.ts'));
    const start = src.indexOf('const EMAIL_BLOCKS_SYSTEM = `');
    expect(start, 'email-ai.ts EMAIL_BLOCKS_SYSTEM 상수를 못 찾음').toBeGreaterThan(0);
    const end = src.indexOf('`;', start);
    const prompt = src.slice(start, end);
    const listed = [...prompt.matchAll(/^- (\w+):/gm)].map((m) => m[1]);
    expect(listed.length, '프롬프트에 블록 줄이 없다').toBeGreaterThan(0);
    expect(setOf(listed), '프롬프트 블록 줄 ≠ EMAIL_AI_BLOCK_TYPES — 한쪽만 고쳤다').toEqual(setOf(EMAIL_AI_BLOCK_TYPES));
    for (const t of EMAIL_AI_BLOCK_TYPES) expect(EMAIL_BLOCK_WHITELIST, `${t}는 AI가 내는데 렌더러가 안 그린다(화이트리스트 밖)`).toContain(t);
  });

  it('프론트 팔레트(make-flow EMAIL_PALETTE_TYPES) = 화이트리스트와 같은 집합', () => {
    const src = read(resolve(FE_ROOT, 'utils/make-flow.ts'));
    const m = src.match(/export const EMAIL_PALETTE_TYPES[^=]*=\s*\[([^\]]*)\]/);
    expect(m, 'make-flow.ts EMAIL_PALETTE_TYPES 를 못 찾음').toBeTruthy();
    const fe = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(setOf(fe), '프론트 팔레트 ≠ 렌더러 화이트리스트(메뉴에 없는 블록 / 못 그리는 블록)').toEqual(setOf(EMAIL_BLOCK_WHITELIST));
  });

  it('EmailVisualEditor는 make-flow 값을 import 한다(자기 사본 0)', () => {
    const src = read(resolve(FE_ROOT, 'components/email/EmailVisualEditor.tsx'));
    expect(src).toMatch(/import \{[^}]*\bEMAIL_PALETTE_TYPES\b[^}]*\} from '\.\.\/\.\.\/utils\/make-flow'/);
    expect(/const EMAIL_BLOCK_TYPES\s*[:=]/.test(src), 'EmailVisualEditor에 블록 목록 사본이 되살아났다').toBe(false);
  });
});
