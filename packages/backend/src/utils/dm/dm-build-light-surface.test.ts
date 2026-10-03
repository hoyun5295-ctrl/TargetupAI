/**
 * 블록 조립 창의 표면 색 계약 (★ 2026-09-16 Harold 접수 "메뉴들이 잘 안 보인다").
 *
 * 사고: ModalBase 본문은 **흰 표면(#fff)**인데 블록 창·스튜디오 창·쪽 창에 다크 전제 색(text-white/…)을 써서
 *       글씨가 흰 배경에 묻혔다. 화면에는 "메뉴가 없는 것"처럼 보인다.
 *
 * 그래서 두 축을 함께 고정한다(계약은 싣는 쪽과 덮는 쪽을 함께 묶는다):
 *   ① ModalBase 본문이 흰 표면이라는 전제 자체
 *   ② 그 안에 들어가는 파일들은 다크 전제 색을 쓰지 않는다
 * 파일을 지정해 검사한다 — 전역 규칙으로 만들면 오탐이 쌓여 무시된다(LESSONS_FRONTEND 2026-08-21).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const front = (p: string) => readFileSync(resolve(process.cwd(), '../frontend/src', p), 'utf8');

/** ModalBase(흰 표면) 안에서 그려지는 파일 */
const LIGHT_SURFACE_FILES = [
  'components/dm/build/BlockEditModal.tsx',
  'components/dm/build/StudioInsertModal.tsx',
  'components/dm/build/CatalogPageModal.tsx',
];

/** 흰 표면에서 글씨가 묻는 다크 전제 색 */
const DARK_ON_LIGHT = [
  /className=[^\n]*\btext-white\b/,
  /className=[^\n]*text-white\//,
  /className=[^\n]*hover:text-white\b/,
  /className=[^\n]*bg-white\/\[/,
  /className=[^\n]*border-white\//,
  /className=[^\n]*bg-slate-950/,
];

describe('블록 조립 창 표면 색', () => {
  it('전제: ModalBase 본문은 흰 표면이다', () => {
    const src = front('components/dm/modals/ModalBase.tsx');
    expect(src, 'ModalBase 가 다크로 바뀌면 아래 규칙을 다시 정해야 한다').toContain("background: '#fff'");
  });

  it.each(LIGHT_SURFACE_FILES)('%s 는 다크 전제 색을 쓰지 않는다', (file) => {
    const src = front(file);
    for (const line of src.split('\n')) {
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue; // 주석은 대상 아님
      for (const re of DARK_ON_LIGHT) {
        expect(re.test(line), `흰 표면에 묻히는 색: ${line.trim().slice(0, 120)}`).toBe(false);
      }
    }
  });

  it('입력칸은 글씨·안내 글씨 색을 명시한다 (브라우저 기본색에 기대지 않는다)', () => {
    for (const file of ['components/dm/build/StudioInsertModal.tsx', 'components/dm/build/CatalogPageModal.tsx']) {
      const src = front(file);
      const inputs = src.split('\n').filter((l) => l.includes('<input') || l.includes('className="w-full px-3 py-2 rounded'));
      expect(inputs.length, `${file} 에 입력칸이 있어야 한다`).toBeGreaterThan(0);
      expect(src).toContain('text-slate-900');
      expect(src).toContain('placeholder-slate-400');
    }
  });

  // ★ 2026-09-30 AI 존 대개편: 조립 화면도 밝은 작업대로 바뀌었다 — 창과 화면이 같은 흰 계열 표면이 된다.
  //   남는 짙은 면은 편집기 머리(남색 띠) 하나이고, 그 값은 make-ui(MK_HEADER·MK_PAGE)가 소유한다.
  it('조립 화면(전체 화면)은 밝은 작업대 + 남색 편집기 머리다(값은 make-ui 소유)', () => {
    const src = front('components/dm/build/DmBlockBuilder.tsx');
    expect(src).toContain('className={MK_PAGE}');
    expect(src).toContain('className={MK_HEADER}');
    expect(src).not.toMatch(/className=[^\n]*bg-slate-950/);
    expect(src).not.toContain('from-slate-950');
  });
});

/**
 * ★ 2026-10-03 편집 화면 오른쪽 칸 글씨가 안 보인다(남지현 접수 · 모바일 DM·이메일 편집).
 * make.css 의 편집기 변수 스코프가 9/30 밝은 작업대 전환 뒤에도 어두운 값(흰 글씨 · 남색 입력칸)으로 남아 있었다.
 * 편집기 27종·FormControls 는 --dm-* 변수만 읽으므로 값의 원천인 스코프 한 곳을 고정한다.
 * 기준 값 = dm-builder.css :root(블록 창 BlockEditModal 이 같은 편집기를 래퍼 없이 그 값으로 그려 정상이다).
 */
describe('만들기 수정 화면 편집기 변수 스코프 (make.css)', () => {
  const makeCss = front('styles/make.css');
  const rootCss = front('styles/dm-builder.css');
  const block = (css: string, sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at, `${sel} 블록이 있어야 한다`).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
  const vars = (body: string) => Object.fromEntries(
    Array.from(body.matchAll(/(--dm-[a-z0-9-]+)\s*:\s*([^;]+);/g)).map((m) => [m[1], m[2].trim()]),
  );
  // 수집 단계에서 던지지 않도록 각 시험 안에서 읽는다(블록이 없으면 그 시험이 실패로 보인다)
  const scopeVars = () => vars(block(makeCss, '.mk-editor'));
  const rootVars = () => vars(block(rootCss, ':root'));

  it('어두운 스코프 이름이 남지 않는다', () => {
    expect(makeCss).not.toContain('mk-dark-editor');
  });

  it('neutral 0~1000 은 :root 값과 같다(흰 글씨 · 반투명 흰색 금지)', () => {
    const scope = scopeVars(); const root = rootVars();
    for (const k of ['0', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000']) {
      const name = `--dm-neutral-${k}`;
      expect(scope[name], name).toBe(root[name]);
    }
    expect(makeCss.slice(makeCss.indexOf('.mk-editor {'), makeCss.indexOf('.mk-phone'))).not.toContain('rgba(255, 255, 255');
  });

  it('입력칸 바탕은 흰색이다(:root 의 --dm-bg = neutral-0)', () => {
    const scope = scopeVars(); const root = rootVars();
    expect(root['--dm-bg']).toBe('var(--dm-neutral-0)');
    expect(scope['--dm-bg']).toBe(root['--dm-neutral-0']);
  });

  it('dm-builder.css 를 안 불러오는 화면(이메일 편집 · 결과 시트)에서도 편집기가 읽는 변수가 모두 정의된다', () => {
    const scope = scopeVars(); const root = rootVars();
    for (const name of ['--dm-primary', '--dm-primary-hover', '--dm-primary-light', '--dm-error', '--dm-font-mono', '--dm-shadow-md', '--dm-shadow-lg']) {
      expect(scope[name], name).toBeTruthy();
    }
    expect(scope['--dm-error']).toBe(root['--dm-error']);
    expect(scope['--dm-font-mono']).toBe(root['--dm-font-mono']);
  });

  it('브라우저 색 체계도 밝은 쪽이다', () => {
    expect(block(makeCss, '.mk-editor')).toContain('color-scheme: light');
    expect(makeCss).not.toContain('color-scheme: dark');
  });

  it('스크롤 막대는 밝은 바탕에서 보이는 색이다(사용처 전부 밝은 칸)', () => {
    const thumb = makeCss.slice(makeCss.indexOf('.mk-scroll::-webkit-scrollbar-thumb'));
    expect(thumb.slice(0, thumb.indexOf('}'))).not.toContain('rgba(255, 255, 255');
  });

  it('편집기를 그리는 세 곳이 밝은 스코프 안에서 그린다', () => {
    expect(front('components/make/DmEditScreen.tsx')).toContain('<div className="mk-editor">');
    expect(front('components/make/EmailEditScreen.tsx')).toContain('<div className="mk-editor"><SectionPropsEditor');
    expect(front('components/make/BlockSheet.tsx')).toContain('<div className="mk-editor">');
  });
});
