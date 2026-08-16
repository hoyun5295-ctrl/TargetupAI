/**
 * DiagnosisAdminPanel — 슈퍼관리자 「신규마케팅진단」 (2026-08-16 신설 · 설계서 §5-7)
 *
 * A(고객사)+B(잠재고객 리드) 통합 목록 · 필터 · lower(email) 그룹 카운트 · 상세(답변+리포트+파이프라인)
 * · 상태 전이(허용 표는 서버가 강제 — 여기는 표시·요청만) · 수동 부여 1클릭(§4-6 CT).
 * 게이트는 서버(ceo 전용·비허용 404) — 이 컴포넌트는 allowed일 때만 마운트된다.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';

const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
  'Content-Type': 'application/json',
});

interface Row {
  id: string;
  funnel: 'A' | 'B';
  company_id: string | null;
  company_name: string | null;
  lead_company_name: string | null;
  lead_contact_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_status: string;
  contact_attempts: number;
  disqualify_reason: string | null;
  linked_company_id: string | null;
  recommended_plan_code: string | null;
  recommended_monthly_price: string | null;
  source_utm: string | null;
  created_at: string;
  same_email_count: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  none: '—',
  new: '신규',
  attempted: '연락 시도',
  contacted: '통화 완료',
  account_created: '계정 생성',
  trial_granted: '체험 지급',
  converted: '전환',
  disqualified: '실격',
  on_hold: '보류',
};

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-sky-50 text-sky-700 border-sky-200',
  attempted: 'bg-amber-50 text-amber-700 border-amber-200',
  contacted: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  account_created: 'bg-violet-50 text-violet-700 border-violet-200',
  trial_granted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  converted: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  disqualified: 'bg-gray-100 text-gray-500 border-gray-200',
  on_hold: 'bg-orange-50 text-orange-700 border-orange-200',
};

interface Props {
  onBadgeRefresh: () => void;
  toast: (msg: string, type: 'success' | 'error') => void;
}

export default function DiagnosisAdminPanel({ onBadgeRefresh, toast }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [funnel, setFunnel] = useState<'' | 'A' | 'B'>('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [disqualifyReason, setDisqualifyReason] = useState('');
  const [linkCompanyId, setLinkCompanyId] = useState('');
  const [acting, setActing] = useState(false);

  const load = async (nextOffset = 0) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (funnel) qs.set('funnel', funnel);
      if (status) qs.set('status', status);
      qs.set('limit', String(LIMIT));
      qs.set('offset', String(nextOffset));
      const r = await fetch(`/api/admin/marketing-diagnosis/?${qs.toString()}`, { headers: authHeaders() });
      const d = await r.json();
      if (r.ok && d?.success) {
        setRows(d.rows);
        setTotal(d.total);
        setOffset(nextOffset);
      } else {
        toast(d?.error || '목록 조회에 실패했습니다.', 'error');
      }
    } catch {
      toast('목록 조회에 실패했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [funnel, status]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    setNextStatus('');
    setDisqualifyReason('');
    setLinkCompanyId('');
    try {
      const r = await fetch(`/api/admin/marketing-diagnosis/${id}`, { headers: authHeaders() });
      const d = await r.json();
      if (r.ok && d?.success) setDetail(d.diagnosis);
      else toast(d?.error || '상세 조회에 실패했습니다.', 'error');
    } catch {
      toast('상세 조회에 실패했습니다.', 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const changeStatus = async () => {
    if (!detail || !nextStatus || acting) return;
    setActing(true);
    try {
      const body: any = { status: nextStatus };
      if (nextStatus === 'disqualified') body.disqualify_reason = disqualifyReason.trim() || undefined;
      if (linkCompanyId.trim()) body.linked_company_id = linkCompanyId.trim();
      const r = await fetch(`/api/admin/marketing-diagnosis/${detail.id}/status`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d?.success) {
        toast('상태가 변경되었습니다.', 'success');
        await openDetail(detail.id);
        load(offset);
        onBadgeRefresh();
      } else {
        toast(d?.error || '상태 변경에 실패했습니다.', 'error');
      }
    } catch {
      toast('상태 변경에 실패했습니다.', 'error');
    } finally {
      setActing(false);
    }
  };

  const manualGrant = async () => {
    if (!detail || acting) return;
    setActing(true);
    try {
      const r = await fetch(`/api/admin/marketing-diagnosis/${detail.id}/grant`, {
        method: 'POST', headers: authHeaders(),
      });
      const d = await r.json();
      if (r.ok && d?.success) {
        toast('진단 체험 7일이 지급되었습니다.', 'success');
        await openDetail(detail.id);
        load(offset);
        onBadgeRefresh();
      } else {
        toast(d?.error || '수동 부여에 실패했습니다.', 'error');
      }
    } catch {
      toast('수동 부여에 실패했습니다.', 'error');
    } finally {
      setActing(false);
    }
  };

  const displayName = (r: Row) => (r.funnel === 'A' ? r.company_name || '(고객사)' : r.lead_company_name || '(리드)');

  // ── 상세 화면 ──
  if (detailLoading || detail) {
    const result = detail?.result;
    return (
      <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm break-keep">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> 목록으로
          </button>
          {detail && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[detail.lead_status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              {STATUS_LABELS[detail.lead_status] || detail.lead_status}
              {detail.contact_attempts > 0 ? ` · 시도 ${detail.contact_attempts}회` : ''}
            </span>
          )}
        </div>

        {detailLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 불러오는 중
          </div>
        )}

        {detail && (
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            {/* 좌: 신원·파이프라인 */}
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-400">
                  {detail.funnel === 'A' ? '퍼널 A · 기존 고객사' : '퍼널 B · 잠재고객 리드'}
                </p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {detail.funnel === 'A' ? detail.company_name || detail.company_id : detail.lead_company_name}
                </p>
                {detail.funnel === 'B' && (
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <p>{detail.lead_contact_name} · {detail.lead_phone}</p>
                    <p>{detail.lead_email}</p>
                    {detail.source_utm && <p className="text-xs text-gray-400">유입: {detail.source_utm}</p>}
                    {detail.linked_company_id && (
                      <p className="text-xs text-emerald-600">연결 회사: {detail.linked_company_name || detail.linked_company_id}</p>
                    )}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-400">접수 {new Date(detail.created_at).toLocaleString('ko-KR')}</p>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-bold text-gray-800">파이프라인</p>
                <div className="mt-3 flex flex-col gap-2.5">
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                    className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
                  >
                    <option value="">상태 변경 선택</option>
                    {['attempted', 'contacted', 'account_created', 'converted', 'disqualified', 'on_hold'].map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  {nextStatus === 'disqualified' && (
                    <input
                      value={disqualifyReason}
                      onChange={(e) => setDisqualifyReason(e.target.value)}
                      maxLength={30}
                      placeholder="실격 사유 (예: existing_customer)"
                      className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
                    />
                  )}
                  {detail.funnel === 'B' && (
                    <input
                      value={linkCompanyId}
                      onChange={(e) => setLinkCompanyId(e.target.value)}
                      placeholder="생성된 회사 ID 연결 (고객사 관리에서 복사)"
                      className="h-10 rounded-lg border border-gray-300 px-3 text-sm"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={changeStatus}
                      disabled={!nextStatus || acting}
                      className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
                    >
                      상태 변경
                    </button>
                    {detail.funnel === 'B' && (
                      <button
                        type="button"
                        onClick={manualGrant}
                        disabled={acting || detail.lead_status !== 'account_created' || !detail.linked_company_id}
                        title={detail.lead_status !== 'account_created' ? '계정 생성 상태에서만 지급할 수 있어요' : !detail.linked_company_id ? '먼저 생성된 회사를 연결해 주세요' : undefined}
                        className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
                      >
                        진단 체험 7일 지급
                      </button>
                    )}
                  </div>
                  {detail.disqualify_reason && (
                    <p className="text-xs text-gray-400">실격 사유: {detail.disqualify_reason}</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-bold text-gray-800">답변 원본</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {detail.answers && Object.entries(detail.answers as Record<string, string>).map(([k, v]) => (
                    <div key={k} className="contents">
                      <span className="text-gray-400">{k}</span>
                      <span className="font-medium text-gray-800">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 우: 리포트 스냅샷 */}
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-bold text-gray-800">리포트 요약</p>
                <p className="mt-2 text-sm text-gray-700">{result?.summary}</p>
                {result?.recommendation ? (
                  <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm">
                    <span className="font-bold text-indigo-700">{result.recommendation.plan_name}</span>
                    <span className="ml-2 text-indigo-500">월 {Number(result.recommendation.monthly_price).toLocaleString()}원</span>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-400">추천 없음(no_match) — 상담 대상</p>
                )}
                {Array.isArray(result?.findings) && result.findings.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[13px] text-gray-600">
                    {result.findings.map((f: any) => <li key={f.key}>· {f.text}</li>)}
                  </ul>
                )}
                {Array.isArray(result?.effects) && result.effects.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {result.effects.map((e: any, i: number) => (
                      <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <p className="text-xs text-gray-400">{e.label}</p>
                        <p className="text-sm font-medium text-gray-800">{e.value}</p>
                      </div>
                    ))}
                  </div>
                )}
                {detail.grant_outcome && (
                  <p className="mt-3 text-xs text-gray-400">지급 판정: {detail.grant_outcome}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 목록 화면 ──
  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm break-keep">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <div>
          <h3 className="text-base font-bold text-gray-900">신규마케팅진단</h3>
          <p className="text-xs text-gray-400">진단 완료 고객사(A) + 잠재고객 리드(B) · 총 {total.toLocaleString()}건</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={funnel} onChange={(e) => setFunnel(e.target.value as any)} className="h-9 rounded-lg border border-gray-300 px-2.5 text-sm">
            <option value="">전체 퍼널</option>
            <option value="A">A · 고객사</option>
            <option value="B">B · 리드</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-gray-300 px-2.5 text-sm">
            <option value="">전체 상태</option>
            {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'none').map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { load(offset); onBadgeRefresh(); }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50"
            aria-label="새로고침"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 불러오는 중
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-400">아직 접수된 진단이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                <th className="px-5 py-2.5 font-medium">접수일</th>
                <th className="px-3 py-2.5 font-medium">퍼널</th>
                <th className="px-3 py-2.5 font-medium">회사/리드</th>
                <th className="px-3 py-2.5 font-medium">연락처</th>
                <th className="px-3 py-2.5 font-medium">추천</th>
                <th className="px-3 py-2.5 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openDetail(r.id)}
                  className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50"
                >
                  <td className="px-5 py-3 text-gray-500">{new Date(r.created_at).toLocaleDateString('ko-KR')}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${r.funnel === 'A' ? 'bg-blue-50 text-blue-600' : 'bg-fuchsia-50 text-fuchsia-600'}`}>
                      {r.funnel}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">{displayName(r)}</td>
                  <td className="px-3 py-3 text-gray-500">
                    {r.funnel === 'B' ? (
                      <span>
                        {r.lead_email}
                        {(r.same_email_count ?? 0) > 1 && (
                          <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600">
                            ×{r.same_email_count}
                          </span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{r.recommended_plan_code || (r.funnel === 'A' ? '상담' : '—')}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[r.lead_status] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {STATUS_LABELS[r.lead_status] || r.lead_status}
                      {r.contact_attempts > 0 ? ` ${r.contact_attempts}` : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > offset + LIMIT && (
            <div className="flex justify-center border-t border-gray-100 py-3">
              <button
                type="button"
                onClick={() => load(offset + LIMIT)}
                className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                다음 {LIMIT}건
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
