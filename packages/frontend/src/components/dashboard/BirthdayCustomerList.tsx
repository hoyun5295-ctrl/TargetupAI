/**
 * BirthdayCustomerList (D132 Phase B)
 *
 * 생일 카드 상세 모달 내부에 표시되는 이번달 생일 고객 리스트.
 *   - 검색 (이름/전화번호)
 *   - 페이지네이션 (기본 20건/페이지)
 *   - 백엔드 `/api/companies/dashboard-cards/birthday_this_month/detail?q=&page=&limit=` 호출
 */
import { useEffect, useState } from 'react';

interface BirthdayItem {
  id: number;
  name: string;
  phone: string;
  gender: string;
  grade: string;
  birth_month_day: string;
  recent_purchase_date: string;
  total_purchase_amount: number;
}

interface InitialTopList {
  items: BirthdayItem[];
  total: number;
  page: number;
  limit: number;
}

interface BirthdayCustomerListProps {
  initialData: InitialTopList;
  cardId: string; // 고정: 'birthday_this_month'
}

const PAGE_LIMIT = 20;

export default function BirthdayCustomerList({ initialData, cardId }: BirthdayCustomerListProps) {
  const [items, setItems] = useState<BirthdayItem[]>(initialData.items);
  const [total, setTotal] = useState<number>(initialData.total);
  const [page, setPage] = useState<number>(initialData.page || 0);
  const [q, setQ] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  useEffect(() => {
    // 초기 데이터 외 쿼리/페이지 변경 시 재조회
    if (page === 0 && q === '') return; // 초기 상태는 initialData 그대로
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        q,
        page: String(page),
        limit: String(PAGE_LIMIT),
      });
      const res = await fetch(`/api/companies/dashboard-cards/${cardId}/detail?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setItems(data.topList?.items || []);
      setTotal(data.topList?.total || 0);
    } catch (err) {
      console.error('생일 고객 리스트 조회 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchList();
  };

  // 전화번호 마스킹 (하이픈 포함 시 끝 4자리만 표시 옵션 — 요구사항 나오면 추가)
  const fmtPhone = (v: string) => v || '-';

  // 생년월일 형식 (MM-DD → 월/일)
  const fmtBirthday = (v: string) => {
    if (!v) return '-';
    const parts = v.split('-');
    if (parts.length === 2) return `${parts[0]}/${parts[1]}`;
    return v;
  };

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">생일 고객 리스트</h4>
        <span className="text-xs text-gray-400">총 {total.toLocaleString()}명</span>
      </div>

      {/* 검색 */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 또는 전화번호 검색"
            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-2 text-xs font-semibold bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 transition-all"
        >
          검색
        </button>
      </form>

      {/* 리스트 */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">이름</th>
              <th className="px-3 py-2 text-left font-semibold">전화번호</th>
              <th className="px-3 py-2 text-center font-semibold">성별</th>
              <th className="px-3 py-2 text-center font-semibold">생일</th>
              <th className="px-3 py-2 text-center font-semibold">등급</th>
              <th className="px-3 py-2 text-right font-semibold">총 구매금액</th>
              <th className="px-3 py-2 text-center font-semibold">최근 구매</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">불러오는 중...</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                  {q ? `"${q}" 검색 결과가 없습니다` : '이번달 생일 고객이 없습니다'}
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <td className="px-3 py-2 font-medium text-gray-800">{it.name || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtPhone(it.phone)}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{it.gender || '-'}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{fmtBirthday(it.birth_month_day)}</td>
                  <td className="px-3 py-2 text-center">
                    {it.grade ? <span className="px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded text-[10px] font-semibold">{it.grade}</span> : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-700">
                    {it.total_purchase_amount > 0 ? `${it.total_purchase_amount.toLocaleString()}원` : '-'}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">{it.recent_purchase_date || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="px-2.5 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            이전
          </button>
          <span className="text-xs text-gray-500">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="px-2.5 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
