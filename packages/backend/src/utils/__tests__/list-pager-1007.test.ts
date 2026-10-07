/**
 * ★ 2026-10-07 보안·인증 목록 쪽 넘김(서수란 접수 cmuxrjywt0p2fjnn4bs9kktc3 · Harold 20건)
 *   공용 자르기(pageSlice) · 서버 쪽 넘김 두 라우트(국외 차단 로그 · 금칙어 결과 로그)를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pageSlice, LIST_PAGE_SIZE } from '../../../../frontend/src/components/shared/ListPager';

describe('pageSlice', () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);
  it('20건씩 · 마지막 쪽은 남은 만큼', () => {
    expect(LIST_PAGE_SIZE).toBe(20);
    expect(pageSlice(items, 1)).toEqual(items.slice(0, 20));
    expect(pageSlice(items, 3)).toEqual([41, 42, 43, 44, 45]);
  });
  it('범위 밖 쪽 = 끝 쪽 · 0 이하 = 첫 쪽 · 빈 목록 = 빈 쪽', () => {
    expect(pageSlice(items, 9)).toEqual([41, 42, 43, 44, 45]);
    expect(pageSlice(items, 0)).toEqual(items.slice(0, 20));
    expect(pageSlice([], 1)).toEqual([]);
  });
});

describe('서버 쪽 넘김', () => {
  const admin = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
  it('국외 차단 로그 · 금칙어 결과 로그 = 20건 · OFFSET · 전체 수', () => {
    for (const path of ["router.get('/geo/hits'", "router.get('/spam-block/hits'"]) {
      const at = admin.indexOf(path);
      const body = admin.slice(at, admin.indexOf('router.get(', at + 1));
      expect(body).toContain('const pageSize = 20;');
      expect(body).toContain('LIMIT $1 OFFSET $2');
      expect(body).toContain('total: cnt.rows[0]?.n || 0');
    }
  });
});
