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

  it('조립 화면(전체 화면)은 다크 그대로다 — 창과 화면의 표면이 다르다', () => {
    const src = front('components/dm/build/DmBlockBuilder.tsx');
    expect(src).toContain('from-slate-950');
    expect(src).toContain('text-white');
  });
});
