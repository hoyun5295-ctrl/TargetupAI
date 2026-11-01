/**
 * 엔진 재설계 E6-2 — 담당자 링크 화면 = 실행은 확인 단계 뒤에서만(★ 2026-11-02 · Harold 1101 「승인을 눌렀다고 바로 되는 게 아니라 되묻는 과정 필수」)
 *
 * 화면 파일 = 비추적 담당자 링크 목록(MANAGER_LINK_PATHS)에서 기계로 뽑는다(경로 → App.tsx 라우트의 화면 → import 파일 · 손 목록 0).
 * 판정: 실행 POST 를 부르는 함수가 버튼 onClick 에 바로 걸리지 않는다 · POST 가 있는 화면은 확인 창을 쓴다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MANAGER_LINK_PATHS } from '../short-url';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const app = readFileSync(join(FE, 'App.tsx'), 'utf8');

function pageFileOf(path: string): string {
  const route = app.match(new RegExp(`<Route path="/${path}" element={<(\\w+) />}`));
  expect(route, `${path} 라우트`).toBeTruthy();
  const imp = app.match(new RegExp(`import ${route![1]} from '\\./([^']+)'`))
    || app.match(new RegExp(`const ${route![1]} = lazyPage\\(\\(\\) => import\\('\\./([^']+)'\\)\\)`));
  expect(imp, `${route![1]} import`).toBeTruthy();
  const f = join(FE, `${imp![1]}.tsx`);
  expect(existsSync(f), f).toBe(true);
  return f;
}

/** 실행 POST 를 부르는 함수 이름(그 POST 앞에서 가장 가까운 `const 이름 = (useCallback()async`) */
function postFunctions(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/method:\s*'POST'/g)) {
    const before = src.slice(0, m.index);
    const decl = [...before.matchAll(/const\s+(\w+)\s*=\s*(?:useCallback\(\s*)?async\b/g)].pop();
    if (decl) names.add(decl[1]);
  }
  return [...names];
}

describe('E6-2 담당자 링크 화면 = 실행은 확인 단계 뒤에서만', () => {
  it('화면 목록을 경로에서 뽑았다(7곳 · 상황판 포함)', () => {
    expect(MANAGER_LINK_PATHS.length).toBeGreaterThanOrEqual(7);
    expect([...MANAGER_LINK_PATHS]).toContain('manager-board');
  });
  for (const p of MANAGER_LINK_PATHS) {
    it(`${p} — 실행 함수를 버튼이 바로 부르지 않는다 · POST 가 있으면 확인 창`, () => {
      const src = readFileSync(pageFileOf(p), 'utf8');
      const fns = postFunctions(src);
      for (const f of fns) {
        expect(src, `${p} 의 ${f} 를 버튼이 바로 부른다`).not.toMatch(new RegExp(`onClick=\\{\\s*(?:\\(\\)\\s*=>\\s*(?:void\\s+)?)?${f}\\b`));
      }
      const CONFIRM = /LinkConfirmSheet|ConfirmSheet|ConfirmModal|role="dialog"/;
      for (const f of fns) {
        if (CONFIRM.test(src)) continue;
        // 실행 함수를 넘겨받는 부품(<X ... ={f}>)이 확인 창을 가진다(예 = 플래너 재확인 판)
        const comp = src.match(new RegExp(`<(\\w+)[^>]*=\\{${f}\\}`));
        const imp = comp && src.match(new RegExp(`import ${comp[1]} from '(\\.[^']+)'`));
        const file = imp ? join(FE, 'pages', `${imp[1]}.tsx`) : '';
        expect(file && existsSync(file) && CONFIRM.test(readFileSync(file, 'utf8')), `${p} 의 ${f} 확인 창`).toBe(true);
      }
    });
  }
});
