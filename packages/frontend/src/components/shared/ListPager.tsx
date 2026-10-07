/**
 * ListPager — 목록 쪽 넘김 공용 부품(★2026-10-07 보안·인증 하위 메뉴 페이징 · 서수란 접수 cmuxrjywt0p2fjnn4bs9kktc3 · Harold 20건)
 *
 * 쪽이 하나뿐이면 그리지 않는다. 쪽 번호는 현재 쪽 둘레 최대 10개.
 * 화면이 전체를 받아 둔 목록 = pageSlice 로 자른다 · 서버가 쪽마다 주는 목록 = total 만 넘긴다.
 */
export const LIST_PAGE_SIZE = 20;

/** 받아 둔 목록에서 그 쪽만 자른다(쪽이 범위를 넘으면 마지막 쪽) */
export function pageSlice<T>(items: T[], page: number, size: number = LIST_PAGE_SIZE): T[] {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return items.slice((p - 1) * size, p * size);
}

export default function ListPager({ page, total, pageSize = LIST_PAGE_SIZE, onPage }: {
  page: number; total: number; pageSize?: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const cur = Math.min(Math.max(1, page), pages);
  const start = Math.max(1, Math.min(cur - 4, pages - 9));
  const nums = Array.from({ length: Math.min(10, pages) }, (_, i) => start + i);
  const btn = 'px-3 py-1.5 text-sm rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="px-5 py-3 border-t flex flex-wrap items-center justify-between gap-2 bg-gray-50">
      <span className="text-sm text-gray-500 tabular-nums">
        총 {total.toLocaleString()}건 중 {((cur - 1) * pageSize + 1).toLocaleString()}-{Math.min(cur * pageSize, total).toLocaleString()}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onPage(cur - 1)} disabled={cur <= 1} className={btn}>◀ 이전</button>
        {nums.map((p) => (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={p === cur ? 'page' : undefined}
            className={`min-w-[36px] px-3 py-1.5 text-sm rounded-md tabular-nums transition-colors ${p === cur ? 'bg-blue-600 text-white' : 'bg-white border hover:bg-gray-100'}`}>{p}</button>
        ))}
        <button type="button" onClick={() => onPage(cur + 1)} disabled={cur >= pages} className={btn}>다음 ▶</button>
      </div>
    </div>
  );
}
