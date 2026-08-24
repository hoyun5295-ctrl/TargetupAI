/**
 * HelpQuestionsTab — 도움말 봇 질문 이력 (★ 2026-08-24 · Harold 명시 · ceo 전용)
 *
 * 어떤 업체가 무엇을 물었고 봇이 답했는가. 원천 = help_questions(봇이 답했든 못 했든 전 질문).
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/help-questions/access로 한다 — 감사 로그와 같은 규약.
 * 톤 = 부모 화면(슈퍼관리자 라이트) 그대로.
 */
import { useCallback, useEffect, useState } from 'react';

interface HelpQuestionRow {
  id: string;
  company_id: string;
  company_name: string;
  user_name: string | null;
  user_login: string | null;
  path: string | null;
  question: string;
  matched_ids: string[];
  answered: boolean;
  /** 서버 판정(문구 레지스트리): 사람이 친 질문인가, 요청 버튼의 고정 문구인가 */
  kind: 'request' | 'question';
  created_at: string;
}

interface Props {
  companies: { id: string; company_name: string }[];
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function HelpQuestionsTab({ companies }: Props) {
  const [rows, setRows] = useState<HelpQuestionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [answered, setAnswered] = useState<'all' | 'yes' | 'no' | 'request'>('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '10', answered }); // 10건씩 = Harold 0824 지시
      if (companyFilter !== 'all') params.set('companyId', companyFilter);
      if (q.trim()) params.set('q', q.trim());
      const r = await fetch(`/api/admin/help-questions?${params}`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok || !d?.success) throw new Error(d?.error || '질문 이력을 불러오지 못했습니다.');
      setRows(d.questions || []);
      setTotal(Number(d.total || 0));
      setTotalPages(Number(d.totalPages || 1));
      setPage(p);
    } catch (e: any) {
      setError(e?.message || '질문 이력을 불러오지 못했습니다.');
      setRows([]); setTotal(0); setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [answered, companyFilter, q]);

  useEffect(() => { load(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [answered, companyFilter]);

  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">도움말 질문 이력</h2>
        <p className="text-xs text-gray-500 mt-1">어떤 업체가 무엇을 물었고 봇이 답했는지. 답 못한 질문이 카탈로그 보강의 입력입니다. "이용 요청 남기기" 버튼의 기록은 기능 요청으로 구분됩니다</p>
      </div>

      <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500 font-medium">답변</span>
        <select value={answered} onChange={(e) => setAnswered(e.target.value as any)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">전체</option>
          <option value="yes">답함</option>
          <option value="no">못 답함</option>
          <option value="request">기능 요청</option>
        </select>
        <span className="text-sm text-gray-500 font-medium">고객사</span>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
          <option value="all">전체</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(1); }}
          placeholder="질문 내용 검색"
          className="border rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <button onClick={() => load(1)}
          className="px-4 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors">
          조회
        </button>
      </div>

      <div className="px-6 py-2 text-xs text-gray-500">
        총 {total.toLocaleString()}건 · {page} / {totalPages} 페이지
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs text-gray-500">
              <th className="px-6 py-2 font-medium whitespace-nowrap">시각</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">고객사</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">사용자</th>
              <th className="px-4 py-2 font-medium">질문</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">물은 화면</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">매칭 기능</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">답변</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">질문 이력이 없습니다</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <td className="px-6 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-800">{r.company_name}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                  {r.user_name || '-'}{r.user_login ? <span className="text-gray-400 text-xs"> ({r.user_login})</span> : null}
                </td>
                <td className="px-4 py-2.5 text-gray-800 max-w-[360px]"><span className="line-clamp-2">{r.question}</span></td>
                <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{r.path || '-'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[200px] truncate">
                  {Array.isArray(r.matched_ids) && r.matched_ids.length > 0 ? r.matched_ids.join(', ') : '-'}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {r.kind === 'request'
                    ? <span className="inline-flex px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">기능 요청</span>
                    : r.answered
                      ? <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">답함</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">못 답함</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-3 border-t flex items-center justify-center gap-2">
          <button disabled={page <= 1 || loading} onClick={() => load(page - 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">이전</button>
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          <button disabled={page >= totalPages || loading} onClick={() => load(page + 1)}
            className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50">다음</button>
        </div>
      )}
    </div>
  );
}
