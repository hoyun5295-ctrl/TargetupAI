/**
 * TablePagination — 목록 공용 페이저 (2026-07-20)
 *
 * 신설 사유: 슈퍼관리자 템플릿 관리가 전량(4,400건+)을 한 화면에 그려 세로 스크롤이 사실상 못 쓰는 상태였다.
 * 단순히 잘라내기만 하면 페이지 버튼이 200개 넘게 생겨 같은 문제가 반복되므로, **번호를 창(window)으로 접는다.**
 *
 * - 총 페이지 7 이하: 전부 표시
 * - 초과: 첫 페이지 · 현재 ±1 · 끝 페이지만 표시하고 사이는 말줄임
 * 목록 화면마다 페이저 마크업을 복붙하지 않도록 이 컴포넌트만 쓴다(인라인 중복 금지).
 */

interface TablePaginationProps {
  /** 필터 적용 후 전체 건수 */
  total: number;
  /** 현재 페이지 (1-base) */
  page: number;
  perPage: number;
  onChange: (page: number) => void;
  /** 건수 표기 단위 — 기본 '개' */
  unit?: string;
}

/** 표시할 페이지 번호 목록 (말줄임은 null) — 순수 함수라 계산 규칙이 한 곳에 모인다 */
export function buildPageWindow(current: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null); // 말줄임
    out.push(p);
    prev = p;
  }
  return out;
}

export default function TablePagination({
  total,
  page,
  perPage,
  onChange,
  unit = '개',
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="px-6 py-4 border-t flex items-center justify-between gap-3 flex-wrap">
      <span className="text-sm text-gray-500">
        총 {total.toLocaleString()}{unit} 중 {from.toLocaleString()}-{to.toLocaleString()}
      </span>
      <div className="flex gap-1 items-center flex-wrap">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50"
        >
          ◀ 이전
        </button>
        {buildPageWindow(page, totalPages).map((p, idx) =>
          p === null ? (
            <span key={`gap-${idx}`} className="px-2 text-sm text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={`px-3 py-1 rounded border text-sm ${
                page === p ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-gray-50"
        >
          다음 ▶
        </button>
      </div>
    </div>
  );
}
