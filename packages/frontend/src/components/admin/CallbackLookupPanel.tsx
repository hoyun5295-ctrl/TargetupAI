/**
 * CallbackLookupPanel — 슈퍼관리자 「발신번호 관리 → 발신번호 조회」 (★ 2026-11-23 특수한 유형의 부가통신사업 갱신 1-1 ④)
 *
 * 발신번호 하나로 ① 등록 정보(고객사 · 배정 계정) ② 발송 이력(계정 ID · 이용자명 · 발신일)을 본다. 읽기만 한다.
 * 서버 = POST /api/admin/callback-lookup(번호를 주소에 싣지 않는다 · 조회마다 감사 기록) · 판정 = backend utils/callback-lookup.ts.
 * 늦게 온 옛 조회 응답이 새 조회 결과를 덮지 않게 요청 번호로 마지막 것만 받는다.
 */
import { useRef, useState } from 'react';
import { formatDate, formatDateTime } from '../../utils/formatDate';
import TablePagination from '../common/TablePagination';
import { ADMIN_TABLE_ONELINE } from './ui/admin-ui';

const STATUS_LABEL: Record<string, string> = {
  scheduled: '예약',
  sending: '발송 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소',
};

const SCOPE_LABEL: Record<string, string> = {
  assigned: '지정 사용자',
  ledger: '전체(원장)',
  all: '전체',
  invalid: '발송 불가(규격)',
};

interface LookupResult {
  phone: string;
  registrations: Array<{ id: string; companyName: string | null; phone: string; label: string | null; createdAt: string | null; usageScope: string; assignees: Array<{ loginId: string; name: string | null }> }>;
  sends: Array<{ campaignId: string; sentAt: string | null; scheduledAt: string | null; createdAt: string | null; status: string | null; companyName: string | null; loginId: string | null; userName: string | null; otherCompany: boolean; otherCompanyName: string | null; campaignName: string | null; sendType: string; targetCount: number | null; successCount: number | null; failCount: number | null }>;
  total: number;
  page: number;
  pageSize: number;
}

// ★1124 칸 여백 px-3 · 캠페인명 200px · 고객사 160px · 다른 소속은 계정 ID 아래 둘째 줄 = 관리자 화면 폭(1,188px)에 실패 칸까지 들어간다
//   (실측 표 1,246 → 1,163px · 예약일도 연도가 있는 꼴 · Codex 1124 1R)
const th = 'px-3 py-2 text-left text-xs font-medium text-gray-500';
const td = 'px-3 py-2.5 text-[13px] text-gray-800';
const n = (v: number | null) => (v === null || v === undefined ? '-' : v.toLocaleString('ko-KR'));

export default function CallbackLookupPanel() {
  const [input, setInput] = useState('');
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const run = async (page: number, phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 12) {
      setError('발신번호를 숫자 8 ~ 12자리로 입력해 주세요.');
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/callback-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: digits, page }),
      });
      const body = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok || !body?.success) {
        setError(body?.error || '조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        return;
      }
      setData(body as LookupResult);
    } catch {
      if (my === seq.current) setError('조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">발신번호 조회</h2>
        <p className="mt-1 text-xs text-gray-500">번호 하나로 그 번호를 등록한 고객사와 배정 계정, 그 번호로 보낸 계정과 발신일을 봅니다.</p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (!loading) run(1, input); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          inputMode="numeric"
          placeholder="발신번호(하이픈 없이 또는 있게)"
          className="h-10 w-72 max-w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? '조회 중' : '조회'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </form>

      {data && (
        <>
          <section className="rounded-xl border border-gray-200">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
              등록 정보 <span className="ml-1 font-normal text-gray-500">{data.registrations.length}건</span>
            </div>
            {data.registrations.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">이 번호로 등록된 발신번호가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`w-full ${ADMIN_TABLE_ONELINE}`}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={th}>고객사</th>
                      <th className={th}>발신번호</th>
                      <th className={th}>별칭</th>
                      <th className={th}>등록일</th>
                      <th className={th}>사용 범위</th>
                      <th className={th}>배정 계정</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.registrations.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{r.companyName || '-'}</td>
                        <td className={td}>{r.phone}</td>
                        <td className={td}>{r.label || '-'}</td>
                        <td className={td}>{formatDate(r.createdAt)}</td>
                        <td className={td}>{SCOPE_LABEL[r.usageScope] || r.usageScope}</td>
                        <td className={td}>
                          {r.assignees.length === 0
                            ? <span className="text-gray-400">-</span>
                            : r.assignees.map((a) => `${a.loginId}${a.name ? ` (${a.name})` : ''}`).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-gray-200">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">
              발송 이력 <span className="ml-1 font-normal text-gray-500">{data.total.toLocaleString('ko-KR')}건</span>
            </div>
            {data.sends.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">이 번호를 회신번호로 쓴 발송이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`w-full ${ADMIN_TABLE_ONELINE}`}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={th}>발신일</th>
                      <th className={th}>예약일</th>
                      <th className={th}>상태</th>
                      <th className={th}>고객사</th>
                      <th className={th}>계정 ID</th>
                      <th className={th}>이용자명</th>
                      <th className={th}>캠페인명</th>
                      <th className={th}>발송 방식</th>
                      <th className={`${th} text-right`}>대상</th>
                      <th className={`${th} text-right`}>성공</th>
                      <th className={`${th} text-right`}>실패</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.sends.map((s) => (
                      <tr key={s.campaignId}>
                        {/* 발신일 = 실제 발송 시각만(없으면 비움 · 만든 시각을 발신일로 보이지 않는다 · Codex 1R) */}
                        <td className={td}>{s.sentAt ? formatDateTime(s.sentAt) : <span className="text-gray-400">-</span>}</td>
                        <td className={td}>{s.scheduledAt ? formatDateTime(s.scheduledAt) : <span className="text-gray-400">-</span>}</td>
                        <td className={td}>{s.status ? (STATUS_LABEL[s.status] || s.status) : '-'}</td>
                        <td className={`${td} max-w-[160px] truncate`} title={s.companyName || ''}>{s.companyName || '-'}</td>
                        <td className={td}>
                          {s.loginId || '-'}
                          {s.otherCompany && (
                            <div className="max-w-[140px] truncate text-[11px] text-amber-700" title={`소속: ${s.otherCompanyName || '없음'}`}>
                              소속: {s.otherCompanyName || '없음'}
                            </div>
                          )}
                        </td>
                        <td className={td}>{s.userName || '-'}</td>
                        <td className={`${td} max-w-[200px] truncate`} title={s.campaignName || ''}>{s.campaignName || '-'}</td>
                        <td className={td}>{s.sendType}</td>
                        <td className={`${td} text-right`}>{n(s.targetCount)}</td>
                        <td className={`${td} text-right`}>{n(s.successCount)}</td>
                        <td className={`${td} text-right`}>{n(s.failCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.total > data.pageSize && (
              <div className="border-t border-gray-100 px-4 py-3">
                <TablePagination total={data.total} page={data.page} perPage={data.pageSize} unit="건" accent="emerald"
                  onChange={(p) => { if (!loading) run(p, data.phone); }} />
              </div>
            )}
          </section>

          <p className="text-xs text-gray-500">수신자마다 회신번호가 다른 캠페인과 비토 게이트웨이 사설발송은 이 목록에 들어가지 않습니다.</p>
        </>
      )}
    </div>
  );
}
