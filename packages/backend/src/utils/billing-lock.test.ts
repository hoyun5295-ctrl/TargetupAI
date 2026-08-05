/**
 * billing-lock.test.ts — 회사 단위 정산 잠금 CT (★ 2026-08-05 신설)
 *
 * 기원: 다건 잠금이 교착을 막으려고 정렬을 넣었는데, 그 정렬 축을 **내가 손으로 정규화**하고 있었다.
 * 대소문자로 한 번, 중괄호·하이픈 생략으로 또 한 번 — 같은 부류가 세 번 났다. 규칙이 모자란 게 아니라
 * PG의 uuid 파서를 흉내내는 접근 자체가 틀렸다. 지금은 파싱·정규화·정렬을 전부 PG에 맡긴다.
 *
 * 그래서 이 파일이 못 박는 것은 **"정렬을 DB에 맡겼는가"**다 — 순서 자체는 SQL이 만든다.
 */
import { describe, it, expect } from 'vitest';
import { lockCompanyForBilling, lockCompaniesForBilling } from './billing-lock';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * 잠금 호출을 순서대로 기록하는 가짜 트랜잭션.
 * `resolve`는 "DB가 돌려준 순서"를 흉내낸다 — 실제 정렬은 PG의 `ORDER BY c.id`가 한다.
 */
function fakeTx(opts?: { resolve?: string[]; distinct?: number }) {
  const calls: { kind: 'resolve' | 'count' | 'advisory' | 'row'; arg: any }[] = [];
  const resolve = opts?.resolve;
  return {
    calls,
    query: async (text: string, params?: any[]) => {
      if (text.includes('DISTINCT ON (c.id)')) {
        calls.push({ kind: 'resolve', arg: params?.[0] });
        return { rows: (resolve ?? (params?.[0] as string[])).map((raw) => ({ raw })) };
      }
      if (text.includes('count(*)')) {
        calls.push({ kind: 'count', arg: params?.[0] });
        const n = opts?.distinct ?? (resolve ?? (params?.[0] as string[])).length;
        return { rows: [{ n }] };
      }
      if (text.includes('pg_advisory_xact_lock')) calls.push({ kind: 'advisory', arg: String(params?.[0]) });
      else if (text.includes('FOR NO KEY UPDATE')) calls.push({ kind: 'row', arg: String(params?.[0]) });
      return { rows: [] };
    },
  };
}

describe('회사 단위 정산 잠금 CT', () => {
  it('단건은 두 겹을 그 순서로 잡는다 — advisory(옛 축) 다음 회사 행(정규 축)', async () => {
    const tx = fakeTx();
    await lockCompanyForBilling(tx, A);
    expect(tx.calls.map((c) => c.kind)).toEqual(['advisory', 'row']);
  });

  it('advisory는 **원문 표기 그대로** 나간다 — 배포 창에서 옛 코드가 같은 값으로 잡고 있다', async () => {
    const tx = fakeTx();
    await lockCompanyForBilling(tx, A.toUpperCase());
    expect(tx.calls[0]).toEqual({ kind: 'advisory', arg: A.toUpperCase() });
  });

  it('다건은 **잠그기 전에** DB에 순서를 묻는다 — 순서를 JS에서 만들면 표기 하나 늘 때마다 또 뒤집힌다', async () => {
    const tx = fakeTx();
    await lockCompaniesForBilling(tx, [B, A]);
    expect(tx.calls[0].kind, '첫 호출이 순서 조회가 아니다').toBe('resolve');
    const firstLock = tx.calls.findIndex((c) => c.kind === 'advisory' || c.kind === 'row');
    const countAt = tx.calls.findIndex((c) => c.kind === 'count');
    expect(countAt, '실재 검사가 잠금보다 뒤에 있다').toBeLessThan(firstLock);
  });

  it('DB가 돌려준 순서를 **그대로** 따른다 — JS에서 다시 정렬하면 그 정렬이 다시 축이 된다', async () => {
    // PG는 uuid 의미값으로 정렬하므로 중괄호·하이픈 생략 표기도 같은 자리에 온다.
    const braced = `{${B}}`;
    const tx = fakeTx({ resolve: [braced, A], distinct: 2 });
    await lockCompaniesForBilling(tx, [A, braced]);
    expect(tx.calls.filter((c) => c.kind === 'row').map((c) => c.arg)).toEqual([braced, A]);
  });

  it('빈 값은 조회 전에 걸러진다 — 잠글 대상이 아닌 것으로 uuid 캐스트를 터뜨리지 않는다', async () => {
    const tx = fakeTx({ resolve: [A], distinct: 1 });
    await lockCompaniesForBilling(tx, ['', '   ', A]);
    expect(tx.calls[0].arg, '빈 값이 조회 인자에 섞였다').toEqual([A]);
  });

  it('넘길 것이 하나도 없으면 조회도 하지 않는다', async () => {
    const tx = fakeTx();
    await lockCompaniesForBilling(tx, ['', '  ']);
    expect(tx.calls).toHaveLength(0);
  });

  it('실재하지 않는 회사는 **조용히 빼지 않고 던진다** — 잠근 줄 알았는데 안 잠긴 상태가 제일 나쁘다', async () => {
    const tx = fakeTx({ resolve: [A], distinct: 2 });   // 둘 넘겼는데 하나만 실재
    await expect(lockCompaniesForBilling(tx, [A, B])).rejects.toThrow('실재하지 않는');
    expect(tx.calls.some((c) => c.kind === 'row'), '검사 전에 잠갔다').toBe(false);
  });

  it('회사마다 두 겹을 **붙여서** 잡는다 — 축을 나눠 두 바퀴 돌면 그 사이가 다시 열린다', async () => {
    const tx = fakeTx({ resolve: [A, B], distinct: 2 });
    await lockCompaniesForBilling(tx, [A, B]);
    expect(tx.calls.filter((c) => c.kind === 'advisory' || c.kind === 'row').map((c) => c.kind))
      .toEqual(['advisory', 'row', 'advisory', 'row']);
  });
});
