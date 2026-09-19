/**
 * ★ 2026-09-19 임은지 접수 `cmu51q01u05tujnluc32zp8ej` — 블록으로 만들기에서 블록 창이 가운데에 떠 미리보기를 가린다.
 *
 * 블록 창의 입력은 원래 섹션에 바로 반영된다(updateSectionProps) = 가운데 캔버스는 이미 실시간이었다.
 * 가린 것은 가운데 모달과 배경막이었다. 그래서 넓은 화면(3단이 보이는 lg 이상)에서는 창을 **오른쪽 열에 붙이고**
 * (배경막 없음 · 캔버스를 안 가림), 좁은 화면(열이 세로로 쌓임)은 종전 모달을 그대로 쓴다.
 *
 * 공용 ModalBase 는 건드리지 않는다(접수 하나 때문에 공용 컴포넌트를 고치지 않는다 · 호출부에서 해결).
 * 표면 색 = 흰 면 그대로 → dm-build-light-surface.test.ts 가 같은 파일을 계속 지킨다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const front = (p: string) => readFileSync(resolve(process.cwd(), '../frontend/src', p), 'utf8');

describe('블록 창 — 넓은 화면은 오른쪽 열에 붙는다', () => {
  const modal = front('components/dm/build/BlockEditModal.tsx');
  const builder = front('components/dm/build/DmBlockBuilder.tsx');

  it('BlockEditModal 에 docked 형태가 있고, 그 형태는 배경막 모달이 아니다(aside)', () => {
    expect(modal).toMatch(/docked\?: boolean/);
    expect(modal).toContain('<aside');
    // 좁은 화면용 모달 형태는 그대로 남는다
    expect(modal).toContain('<ModalBase');
  });

  it('조립 화면은 lg(1024px) 기준으로 붙일지 정한다 · 공용 훅을 쓴다(인라인 matchMedia 금지)', () => {
    expect(builder).toContain("useMediaQuery('(min-width: 1024px)')");
    expect(builder).not.toContain('window.matchMedia');
  });

  it('편집 중 오른쪽 열 = 붙은 블록 창(400px) · 아니면 쌓인 블록(300px)', () => {
    expect(builder).toContain('lg:grid-cols-[250px_minmax(0,1fr)_400px]');
    expect(builder).toContain('lg:grid-cols-[250px_minmax(0,1fr)_300px]');
    expect(builder).toMatch(/<BlockEditModal[\s\S]*?docked[\s\S]*?\/>/);
  });

  it('모달 형태는 좁은 화면에서만 연다(넓은 화면에서 모달·붙은 창이 동시에 뜨지 않는다)', () => {
    expect(builder).toMatch(/open=\{!!editingSection && !wide\}/);
  });

  it('공용 훅은 창 크기 변경을 따라간다(change 구독 · 해제)', () => {
    const hook = front('hooks/useMediaQuery.ts');
    expect(hook).toContain("addEventListener('change'");
    expect(hook).toContain("removeEventListener('change'");
  });
});
