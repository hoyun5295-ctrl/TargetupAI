/**
 * 1031 Harold 접수 둘(같은 배포)
 *   ① AI 한줄로 확인 창 뒤로가기(카드 C86 · 설계서 docs/2026-10-31-ai-line-answer-link-design.md §9) — 단계마다 앞 단계로 · 돌아가면 적은 답을 다시 채움.
 *   ② 이미지 스튜디오 새 제작 = 입력 칸 처음으로(카드 C87) — 포스터를 만든 뒤 템플릿을 다시 고르면 지난 문구 · 힌트 · 상품이 남지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FRONT = resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(resolve(FRONT, p), 'utf8').replace(/\r\n/g, '\n');

describe('① AI 한줄로 확인 창 뒤로가기', () => {
  const m = read('components/ai-line/LineIntakeModal.tsx');
  it('돌아갈 곳 한 자리: 빠진 정보 → 채널(카톡을 되물은 한 줄만) · 확인 판 · 누구에게 → 빠진 정보(문자 갈래 · 물은 것) · 아니면 채널', () => {
    expect(m).toContain("const kakaoAsked = read?.branch === 'ask_kakao';");
    expect(m).toContain("const backTo: 'kakao' | 'asks' | null = step === 'asks'\n    ? (kakaoAsked ? 'kakao' : null)\n    : step === 'board' ? (run.branch === 'sms' && asks.length > 0 ? 'asks' : kakaoAsked ? 'kakao' : null) : null;");
  });
  it('이전 버튼 = 빠진 정보 · 누구에게 · 확인 판 바닥 셋 + 칼럼 바닥(확인 판) 하나', () => {
    expect(m.match(/\{backTo && \(\n\s*<button type="button" onClick=\{goBack\} disabled=\{busy\}/g)?.length).toBe(3);
    expect(m).toContain("<ChevronLeft className=\"w-4 h-4\" />{backTo === 'kakao' ? '채널' : '빠진 정보'}");
    expect(m).toContain("<ChevronLeft className=\"w-4 h-4\" />확인 판");
    // 빠진 정보 바닥: 이전 → 나중에 → 다음 순서
    const asksFoot = m.slice(m.indexOf('{backTo && ('), m.indexOf('onClick={submitAsks}'));
    expect(asksFoot).toContain('나중에');
  });
  it('돌아가면 적은 답을 다시 채운다(혜택 · 기간 · 질문 답 = 질문 글로 짝) · 지금 적고 있는 칸은 덮지 않는다', () => {
    const body = m.slice(m.indexOf('const goBack = () => {'), m.indexOf("    setStep('asks');\n  };") + 20);
    expect(body).toContain("if (backTo === 'kakao') { setStep('kakao'); return; }");
    expect(body).toContain('if (askBenefit && !benefitDraft.trim() && !benefitNone) { if (f.benefit) setBenefitDraft(f.benefit); else setBenefitNone(true); }');
    expect(body).toContain('if (askPeriod && !periodPick && !periodNone) { if (f.period_end) setPeriodPick(f.period_end); else setPeriodNone(true); }');
    expect(body).toContain('if (next[a.id] !== undefined) continue;');
    expect(body).toContain('const hit = f.answers?.find((x) => x.q === a.text);');
  });
});

describe('② 이미지 스튜디오 새 제작 = 입력 칸 처음으로', () => {
  const make = read('components/studio/StudioMake.tsx');
  const page = read('pages/ImageStudioPage.tsx');
  it('restart = 처음 상태 + 그 템플릿 기본 문구 · 자동 채움 기준도 그 값', () => {
    expect(make).toMatch(/const restart = useCallback\(\(t: StudioTemplatePublic \| null\) => \{\n\s*const auto = t \? autoStudioTexts\(t\.defaultTexts, null\) : EMPTY_STUDIO_TEXTS;\n\s*reset\(auto\);\n\s*autoRef\.current = auto;\n\s*\}, \[reset\]\);/);
    expect(make).toContain('busyMsg, reset, restart, onPickMall, onUpload, generate,');
  });
  it('만든 뒤에만(성공 결과를 놓은 뒤) 템플릿을 다시 고르면 restart · 결과의 「문구·상품 수정」은 값을 남긴다', () => {
    const gen = page.slice(page.indexOf('const generate = async () => {'), page.indexOf("setStage('result');"));
    expect(gen.indexOf('if (!r) return;')).toBeLessThan(gen.indexOf('madeRef.current = true;'));
    expect(page).toContain("<TemplatePicker onPick={(t) => { if (busy) return; if (madeRef.current) { make.restart(t); madeRef.current = false; } setTemplate(t); setStage('setup'); }}");
    expect(page).toContain("<button onClick={() => setStage('setup')} className=\"ml-auto text-xs text-slate-400 hover:text-slate-600\">문구·상품 수정</button>");
  });
});

describe('Codex 1R(뒤로가기 · 스튜디오) 반례', () => {
  it('미리 채움 = 첫 다음 전에만(저장된 답을 처음 채움이 덮지 않는다)', () => {
    const m = read('components/ai-line/LineIntakeModal.tsx');
    const eff = m.slice(m.indexOf('const prefillKey ='), m.indexOf('}, [run.runId, prefillKey]);'));
    expect(eff.indexOf('if (run.facts !== null) return;')).toBeGreaterThan(0);
    expect(eff.indexOf('if (run.facts !== null) return;')).toBeLessThan(eff.indexOf('const fills ='));
  });
  it('처음 상태로 돌리면 진행 중 상품 준비의 늦은 응답을 버린다 · 처리 중 템플릿 고르기 막음', () => {
    const make = read('components/studio/StudioMake.tsx');
    expect(make).toMatch(/const reset = useCallback\(\(next: StudioTexts = EMPTY_STUDIO_TEXTS\) => \{\n\s*prepSeq\.current \+= 1;/);
    // ★ 1102 제품 사진 최대 3장 — 준비 반복을 lib/studio-products.ts runProductPrep 으로 옮겼다 · 지키는 성질은 그대로
    //   (설계서 docs/2026-11-02-image-studio-multi-product-design.md §4 S6 · 동작 시험 = image-studio-multi-product-1102.test.ts S6-가)
    const prep = make.slice(make.indexOf('const prepareProducts = async'), make.indexOf('const addProducts'));
    expect(prep).toContain('const seq = ++prepSeq.current;');
    expect(prep).toContain('const live = () => seq === prepSeq.current;');
    expect(prep).toContain('const r = await runProductPrep(added, {\n      live,');
    const runner = read('lib/studio-products.ts');
    // 늦은 응답 버림: 반복 입구 · 원본 저장 뒤 · 누끼 뒤 · 실패 처리 앞 · 반복 끝
    expect(runner.match(/if \(!d\.live\(\)\) return null;/g)?.length).toBe(5);
    expect(runner).toContain('if (!d.live()) { d.revoke(url); return null; }');
    // Codex 1031 ① 누끼 ID 는 미리보기보다 먼저(미리보기를 못 받아도 상품 없는 유료 생성 0)
    expect(runner.indexOf('d.onCutout(a.key, cutoutTempId);')).toBeLessThan(runner.indexOf('const url = await d.preview(cutoutTempId);'));
    expect(runner).toContain("if (!d.live()) return null;\n  d.setBusy('');");
  });
});
