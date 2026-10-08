/**
 * ★2026-10-08 블록 · 버튼 접수 3건 고정(모바일 DM · 이메일 공용)
 *   - 남지현 cmuz1os880: 이메일 블록 설정을 누를 때마다 미리보기가 맨 위로 · 화면이 흔들림
 *       → 미리보기 다리: 그림이 다 들어올 때까지 스크롤을 다시 맞추고, 맞추는 중엔 멈춘 값을 부모에 보고하지 않는다
 *       → PreviewFrame: 새 문서는 뒤 칸에서 받고 다 받으면 바꿔 끼운다(DM · 이메일 · 카탈로그 공용)
 *   - 남지현 cmuz1s8l80: 블록으로 만들기 오른쪽 칸이 스크롤을 안 따라옴 → 양옆 칸 sticky(붙은 편집 창과 같은 자리)
 *   - 임은지 cmuz1aijm0: 버튼 블록 「색」이 바뀌는 곳이 안 보임 → 버튼마다 「글씨 색」 · 버튼(cta)은 「색」 칸 제외
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderSection } from '../dm/dm-section-renderer';
import type { Section } from '../dm/dm-section-registry';
import { guardPreviewHtml } from '../../../../frontend/src/utils/make-preview';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const cta = (buttons: any[], treatment?: string): Section =>
  ({ id: 's1', type: 'cta', order: 0, visible: true, treatment, props: { buttons, layout: 'stack' } } as unknown as Section);

describe('버튼 글씨 색(DM 발행)', () => {
  const TC = '#a1b2c3';
  for (const t of ['classic', 'ghost', 'bar', 'sticky']) {
    it(`[${t}] text_color 가 출력에 실리고, 없으면 출력이 바뀌지 않는다`, () => {
      const base = renderSection(cta([{ label: '보러 가기', url: 'https://ex.com', style: 'primary' }], t), {} as any);
      const painted = renderSection(cta([{ label: '보러 가기', url: 'https://ex.com', style: 'primary', text_color: TC }], t), {} as any);
      expect(painted).toContain(`color:${TC}`);
      expect(base).not.toContain(TC);
    });
  }
  it('버튼 색과 같이 고르면 글씨 색이 이긴다(채움형)', () => {
    const html = renderSection(cta([{ label: 'A', url: 'https://ex.com', style: 'primary', color: '#112233', text_color: TC }]), {} as any);
    expect(html.indexOf(`color:${TC}`)).toBeGreaterThan(html.indexOf('background:#112233'));
  });
  it('바 구도 둘째 버튼도 버튼 색 · 글씨 색을 읽는다', () => {
    const html = renderSection(cta([
      { label: 'A', url: 'https://ex.com', style: 'primary' },
      { label: 'B', url: 'https://ex.com/b', style: 'secondary', color: '#445566', text_color: TC },
    ], 'bar'), {} as any);
    expect(html).toContain('background:#445566');
    expect(html).toContain(`color:${TC}`);
  });
});

describe('편집기', () => {
  it('버튼마다 「글씨 색」 칸 · 버튼(cta)은 오른쪽 「색」 칸에서 뺐다(DM · 이메일 새 화면 · 옛 이메일 화면)', () => {
    expect(read('frontend/src/components/dm/panels/editors/CtaEditor.tsx')).toContain('updateBtn(i, { text_color: v })');
    expect(read('frontend/src/components/make/DmEditScreen.tsx')).not.toMatch(/ACCENT_AWARE = new Set\(\[[^\]]*'cta'/);
    expect(read('frontend/src/components/make/EmailEditScreen.tsx')).not.toMatch(/EMAIL_ACCENT_AWARE = new Set<SectionType>\(\[[^\]]*'cta'/);
    expect(read('frontend/src/components/email/EmailVisualEditor.tsx')).not.toMatch(/EMAIL_ACCENT_AWARE = new Set<SectionType>\(\[[^\]]*'cta'/s);
  });
  it('DM 캔버스(조립 화면) = 발행과 같은 규칙', () => {
    const src = read('frontend/src/components/dm/canvas/CtaSection.tsx');
    expect(src).toContain("color: tcOf(b) || '#fff'");
    expect(src).toContain("btnColorStyle({ ...x, style: 'secondary' })");
  });
  it('블록으로 만들기 양옆 칸 = 화면에 붙어 따라온다', () => {
    const src = read('frontend/src/components/dm/build/DmBlockBuilder.tsx');
    expect(src.match(/\$\{MK_SIDE_STICKY\}/g)?.length).toBe(2);
    expect(read('frontend/src/utils/make-ui.ts')).toContain("MK_SIDE_STICKY = 'lg:sticky");
  });
  it('미리보기 = 두 겹(뒤 칸에서 받고 loaded 에 바꿔 끼운다)', () => {
    const src = read('frontend/src/components/make/PreviewFrame.tsx');
    expect(src).toContain("m.type === 'loaded'");
    expect(src).toContain('SWAP_FALLBACK_MS');
  });
});

describe('미리보기 다리 스크롤 복원', () => {
  function boot() {
    const out = guardPreviewHtml('<html><head></head><body><div data-section-id="s1">x</div></body></html>', { tap: true });
    const src = out.slice(out.lastIndexOf('<script>') + '<script>'.length, out.lastIndexOf('</script>'));
    const sent: any[] = [];
    const win: Record<string, any> = {};
    const docL: Record<string, (e: any) => void> = {};
    const parent = { postMessage: (m: any) => sent.push(m) };
    const fakeWin: any = {
      parent, scrollY: 0, maxY: 100,
      addEventListener: (t: string, fn: any) => { win[t] = fn; },
      scrollTo: (_x: number, y: number) => { fakeWin.scrollY = Math.min(y, fakeWin.maxY); },
      requestAnimationFrame: (fn: any) => fn(),
    };
    const fakeDoc = { addEventListener: (t: string, fn: any) => { docL[t] = fn; }, querySelector: () => null, querySelectorAll: () => [] };
    new Function('window', 'document', 'setTimeout', src)(fakeWin, fakeDoc, () => 0);
    return { sent, win, docL, fakeWin, parent };
  }
  it('그림 받기 전 짧은 문서에서 멈춘 값을 부모에 보고하지 않고, 다 받은 뒤 다시 맞춘다', () => {
    const { sent, win, fakeWin, parent } = boot();
    win.message({ source: parent, data: { src: 'mk-preview', type: 'scrollTo', y: 800 } });
    expect(fakeWin.scrollY).toBe(100);           // 문서가 아직 짧아 100에서 멈춤
    win.scroll();
    expect(sent.some((m) => m.type === 'scroll')).toBe(false);   // 멈춘 값으로 기억을 덮지 않는다
    fakeWin.maxY = 2000;                          // 그림이 들어와 문서가 자람
    win.load();
    expect(fakeWin.scrollY).toBe(800);
    expect(sent.some((m) => m.type === 'loaded')).toBe(true);
    win.scroll();
    expect(sent.filter((m) => m.type === 'scroll').pop()).toMatchObject({ y: 800 });
  });
  it('사람이 직접 움직이면 바로 내려놓는다', () => {
    const { sent, win, fakeWin, parent } = boot();
    win.message({ source: parent, data: { src: 'mk-preview', type: 'scrollTo', y: 800 } });
    win.wheel();
    fakeWin.scrollY = 40;
    win.scroll();
    expect(sent.filter((m) => m.type === 'scroll').pop()).toMatchObject({ y: 40 });
  });
});
