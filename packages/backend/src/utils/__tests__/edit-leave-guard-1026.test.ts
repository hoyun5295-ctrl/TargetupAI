/**
 * ★ 2026-10-26 Codex 1R(삭제 묶음 #1) — 편집기 밖으로 가는 길(만들기 화면 · 다시 만들기)은 편집기의 이탈 처리를 거친다.
 *   옛: 재료 패널을 링크로 바꾸며 바로 이동해, 자동 저장 대기 중인 수정이 경고 없이 사라졌다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FE = resolve(__dirname, '../../../../frontend/src');
const code = (rel: string) => readFileSync(resolve(FE, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('편집기 이탈 보호 — 재료 패널 · 다시 만들기', () => {
  it('재료 패널은 이동을 편집기에 맡긴다(onNavigate 필수)', () => {
    const p = code('components/MaterialQuickPanel.tsx');
    expect(p).toContain('onNavigate: (go: () => void) => void');
    expect(p).toContain('onClick={() => onNavigate(() => navigate(');
    expect(p).not.toMatch(/onClick=\{\(\) => navigate\(/);
  });
  it('이메일 수정 화면 = 나가기 처리(저장 뒤 이동) · 뒤로 버튼은 인자 없이', () => {
    const s = code('components/make/EmailEditScreen.tsx');
    expect(s).toContain('const leave = (after: () => void = onClose) => {');
    expect(s).toContain('<MaterialQuickPanel channel="email" disabled={!!aiBusy} onNavigate={(go) => leave(go)} />');
    expect(s).not.toMatch(/=\{leave\}/);
  });
  it('이메일 비주얼 편집기 = 고친 내용이 있으면 확인 창(재료 패널 · 다시 만들기)', () => {
    const s = code('components/email/EmailVisualEditor.tsx');
    expect(s).toContain('<MaterialQuickPanel channel="email" disabled={aiBusy} onNavigate={guardLeave} />');
    expect(s).toContain('onRegenerate={() => guardLeave(() => {');
    const g = s.slice(s.indexOf('const guardLeave = (go: () => void) => {'));
    expect(g.slice(0, 400)).toContain('if (!isDirty()) { go(); return; }');
  });
});
