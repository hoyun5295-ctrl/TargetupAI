/**
 * AgencySendLedgerPanel — 슈퍼관리자 대행발송 내역 (★2026-08-26(2) Harold 지시 신설)
 *
 * 전 고객사의 대행발송 접수 진행현황을 한 자리에서 본다: 고객 화면과 같은 6단계 진행 레일 +
 * 접수구분(요청서·직접 입력·메일) + 고객사명 + 신청자명. 읽기 전용(처리 손은 고객 화면·워커가 소유).
 * 데이터 = GET /api/admin/agency-send 의 requests(레일 재료 = approved_at·queued_at까지 실려 온다).
 * 표시 판정(레일·상태·출처 라벨)은 고객 화면과 **같은 CT**(agency-send-api)를 읽는다 — 두 화면이 다르게 읽히면 안 된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Eye, Loader2, RefreshCw, Search, Send, X } from 'lucide-react';
import AgencyProgressRail from '../agency/AgencyProgressRail';
import AgencyPreviewModal from '../agency/AgencyPreviewModal';
import AgencyEventLog from '../agency/AgencyEventLog';
import {
  formatWhenRelative, isCancelable, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE,
  type AgencyPreviewSample, type AgencySendEvent, type AgencySendStatus,
} from '../agency/agency-send-api';
import { CUI_PILL_BASE, CUI_PILL_TONE } from '../../utils/console-ui';


interface AdminAgencyDetail {
  request: {
    id: string; status: AgencySendStatus; messageType: string; subject: string | null;
    isAd: boolean; callbackNumber: string | null; requestedAt: string; recipientCount: number;
    fileName: string | null; currentContent: string; originalContent: string;
    companyName: string | null; userName: string | null; mmsImagePaths: unknown[];
  };
  events: AgencySendEvent[];
  samples: AgencyPreviewSample[];
  shown: number;
  total: number;
}

interface AdminAgencyRow {
  id: string;
  status: AgencySendStatus;
  source: 'screen' | 'one_step' | 'email' | null;
  message_type: string;
  subject: string | null;
  is_ad: boolean;
  callback_number: string | null;
  requested_at: string;
  recipient_count: number;
  file_name: string | null;
  content_preview: string | null;
  test_round: number;
  reapproval_count: number;
  created_at: string;
  approved_at: string | null;
  queued_at: string | null;
  campaign_id: string | null;
  company_name: string | null;
  user_name: string | null;
  user_login: string | null;
}

interface Summary { status: string; c: number }

/** 상태 필터에 올릴 순서(원장 상태 전체가 아니라 직원이 자주 찾는 순서) */
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '전체 상태' },
  { value: 'awaiting_approval', label: STATUS_LABEL.awaiting_approval },
  { value: 'reapproval', label: STATUS_LABEL.reapproval },
  { value: 'test_failed', label: STATUS_LABEL.test_failed },
  { value: 'approved', label: STATUS_LABEL.approved },
  { value: 'queued', label: STATUS_LABEL.queued },
  { value: 'expired', label: STATUS_LABEL.expired },
  { value: 'cancelled', label: STATUS_LABEL.cancelled },
];

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '전체 접수구분' },
  { value: 'one_step', label: SOURCE_LABEL.one_step },
  { value: 'screen', label: SOURCE_LABEL.screen },
  { value: 'email', label: SOURCE_LABEL.email },
];

export default function AgencySendLedgerPanel() {
  const [rows, setRows] = useState<AdminAgencyRow[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  // ★2026-08-26(3) 운영 취소(고객이 전화로 급히 요청 · 직원은 고객 비밀번호를 모른다)
  const [cancelTarget, setCancelTarget] = useState<AdminAgencyRow | null>(null);
  const [cancelMemo, setCancelMemo] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [notice, setNotice] = useState('');
  // ★2026-08-28(2) 상세 + 치환 미리보기(서수란 접수) — 직원이 실물 문장(발송과 같은 조립)을 확인하는 자리
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminAgencyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const openDetail = async (row: AdminAgencyRow) => {
    setDetailId(row.id); setDetail(null); setDetailError(''); setPreviewOpen(false);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/agency-send/${row.id}/preview`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || '상세를 불러오지 못했습니다.');
      setDetail(body);
    } catch (e: any) {
      setDetailError(e?.message || '상세를 불러오지 못했습니다.');
    } finally {
      setDetailLoading(false);
    }
  };

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError('');
    try {
      const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`/api/admin/agency-send${qs}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || '내역을 불러오지 못했습니다.');
      setRows(body.requests || []);
      setSummary(body.summary || []);
    } catch (e: any) {
      setError(e?.message || '내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  const openCancel = (row: AdminAgencyRow) => {
    setCancelTarget(row); setCancelMemo(''); setCancelError(''); setNotice('');
  };
  const closeCancel = () => {
    if (cancelBusy) return; // 처리 중에는 닫지 못한다(결과를 못 본 채 사라지면 재시도로 이어진다)
    setCancelTarget(null);
  };
  const runCancel = async () => {
    if (!cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    setCancelError('');
    try {
      const res = await fetch(`/api/admin/agency-send/${cancelTarget.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ reason: cancelMemo.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) throw new Error(body?.error || '취소하지 못했습니다.');
      setNotice(body?.pending
        ? '취소를 처리하고 있습니다. 예약 정리가 끝나면 목록의 상태가 취소됨으로 바뀝니다.'
        : '취소했습니다. 담당자 번호로 취소 안내 문자를 보냈습니다.');
      setCancelTarget(null);
      await load(statusFilter);
    } catch (e: any) {
      setCancelError(e?.message || '취소하지 못했습니다.');
    } finally {
      setCancelBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== 'all' && (r.source || 'screen') !== sourceFilter) return false;
      if (!kw) return true;
      return [r.company_name, r.user_name, r.user_login, r.file_name, r.content_preview]
        .some((v) => String(v || '').toLowerCase().includes(kw));
    });
  }, [rows, sourceFilter, keyword]);

  const countOf = (status: string) => summary.find((s) => s.status === status)?.c || 0;
  const activeCount = countOf('awaiting_approval') + countOf('reapproval');

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b flex flex-wrap gap-3 justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Send className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">대행발송 내역</h2>
            <p className="text-xs text-gray-500">전 고객사의 접수 진행현황입니다. 승인·취소 같은 처리는 고객 화면에서 담당자가 합니다.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="고객사·신청자·파일명 검색"
              className="h-9 pl-8 pr-3 rounded-lg border border-gray-200 text-[13px] w-[210px] focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/25">
            {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-gray-200 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/25">
            {SOURCE_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <button onClick={() => void load(statusFilter)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100" aria-label="새로고침">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 요약 — 지금 사람 손(고객사 담당자)을 기다리는 건이 몇인지부터 */}
      <div className="px-6 pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-200 p-3.5">
          <div className="text-[11.5px] font-medium text-gray-500">승인 대기(재승인 포함)</div>
          <div className={`mt-1 text-[15px] font-bold tabular-nums ${activeCount > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{activeCount.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3.5">
          <div className="text-[11.5px] font-medium text-gray-500">발송 예정·예약 완료</div>
          <div className="mt-1 text-[15px] font-bold tabular-nums text-gray-900">{(countOf('approved') + countOf('final_testing') + countOf('queued')).toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3.5">
          <div className="text-[11.5px] font-medium text-gray-500">문안 확인 필요</div>
          <div className={`mt-1 text-[15px] font-bold tabular-nums ${countOf('test_failed') > 0 ? 'text-rose-600' : 'text-gray-900'}`}>{countOf('test_failed').toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-gray-200 p-3.5">
          <div className="text-[11.5px] font-medium text-gray-500">취소·미발송</div>
          <div className="mt-1 text-[15px] font-bold tabular-nums text-gray-900">{(countOf('cancelled') + countOf('expired')).toLocaleString()}</div>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="py-14 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <div className="px-6 py-8 text-sm text-rose-600">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-10 text-sm text-gray-400">조건에 맞는 접수가 없습니다.</div>
      ) : (
        <div className="p-6 pt-4">
          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {filtered.map((r) => {
              const when = formatWhenRelative(r.requested_at);
              const terminal = r.status === 'cancelled' || r.status === 'expired';
              return (
                <div key={r.id} className={`flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6 px-5 py-4 bg-white ${terminal ? 'opacity-70' : ''}`}>
                  <div className="w-full lg:w-[300px] shrink-0 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-[13.5px] font-bold tracking-[-0.01em] truncate text-gray-900">
                        {r.company_name || '(회사 없음)'}
                      </p>
                      <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[STATUS_TONE[r.status]]} shrink-0`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                    <p className="text-[12px] text-gray-500 mt-0.5 truncate">
                      <span className="font-semibold text-indigo-700">{r.user_name || r.user_login || '(신청자 없음)'}</span>
                      {' · '}{SOURCE_LABEL[(r.source || 'screen') as keyof typeof SOURCE_LABEL]}
                      {' · '}<span className="tabular-nums">{Number(r.recipient_count || 0).toLocaleString()}</span>명 · {r.message_type}{r.is_ad ? ' · 광고' : ''}
                    </p>
                    <p className="text-[12px] text-gray-400 mt-0.5 truncate">{r.file_name || r.content_preview || ''}</p>
                  </div>
                  <div className="hidden md:flex flex-1 min-w-0">
                    <AgencyProgressRail r={{ status: r.status, approvedAt: r.approved_at, queuedAt: r.queued_at }} />
                  </div>
                  <div className="text-left lg:text-right lg:w-[130px] shrink-0">
                    <p className={`text-[13.5px] font-bold tracking-[-0.01em] ${terminal ? 'text-gray-400' : 'text-gray-900'}`}>{when.big}</p>
                    <p className="text-[12px] text-gray-400">{when.sub}</p>
                  </div>
                  <div className="lg:w-[158px] shrink-0 flex items-center gap-1.5 lg:justify-end">
                    {/* ★0828(2) 상세 = 문안 + 받는 사람별 치환 미리보기(서수란 접수) */}
                    <button
                      type="button"
                      onClick={() => void openDetail(r)}
                      className="h-8 px-3 rounded-lg border border-indigo-200 text-indigo-600 text-[12.5px] font-semibold hover:bg-indigo-50 hover:border-indigo-300 transition-colors inline-flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />상세
                    </button>
                    {r.status === 'cancelling' ? (
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />취소 중
                      </span>
                    ) : isCancelable(r.status) && r.status !== 'expired' ? (
                      <button
                        type="button"
                        onClick={() => openCancel(r)}
                        className="h-8 px-3 rounded-lg border border-rose-200 text-rose-600 text-[12.5px] font-semibold hover:bg-rose-50 hover:border-rose-300 transition-colors"
                      >
                        취소
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-gray-400 italic">Data source: 대행발송 접수 원장 (최근 200건)</p>
        </div>
      )}

      {notice && (
        <div className="mx-6 mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800">{notice}</div>
      )}

      {/* ── 상세 + 치환 미리보기 모달 (★0828(2) 서수란 접수 · 읽기 전용) ── */}
      {detailId && (
        <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-[640px] max-h-[88vh] flex flex-col" role="dialog" aria-modal="true" aria-label="대행발송 상세">
            <div className="px-5 py-4 border-b flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                  <Eye className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-gray-900 truncate">
                    {detail?.request ? `${detail.request.companyName || '(회사 없음)'} · ${detail.request.fileName || '대행발송'}` : '대행발송 상세'}
                  </h3>
                  {detail?.request && (
                    <p className="text-[12px] text-gray-500 truncate">
                      <span className="text-indigo-700 font-semibold">{detail.request.userName || '(신청자 없음)'}</span>
                      {' · '}<span className="tabular-nums">{Number(detail.request.recipientCount || 0).toLocaleString()}</span>명
                      {' · '}{detail.request.messageType}{detail.request.isAd ? ' · 광고' : ''}
                      {Array.isArray(detail.request.mmsImagePaths) && detail.request.mmsImagePaths.length > 0 ? ` · 이미지 ${detail.request.mmsImagePaths.length}장` : ''}
                      {' · '}{formatWhenRelative(detail.request.requestedAt).big}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto space-y-4">
              {detailLoading && <div className="py-10 grid place-items-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
              {detailError && !detailLoading && <p className="text-[13px] text-rose-600">{detailError}</p>}
              {detail && !detailLoading && (
                <>
                  <div>
                    <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5">문안</h4>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                      {detail.request.subject && <div className="font-semibold text-gray-900 mb-1">{detail.request.subject}</div>}
                      {detail.request.currentContent}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5">받는 사람별 발송 내용</h4>
                    {detail.samples.length === 0 ? (
                      <p className="text-[12.5px] text-gray-400">보여 줄 수신자가 없습니다.</p>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewOpen(true)}
                          className="h-9 px-4 rounded-lg border border-indigo-200 text-indigo-600 text-[13px] font-semibold hover:bg-indigo-50 hover:border-indigo-300 transition-colors inline-flex items-center gap-1.5"
                        >
                          <Eye className="w-4 h-4" />받는 사람별 발송 내용 보기
                        </button>
                        <p className="mt-1.5 text-[12px] text-gray-500">
                          실제 발송과 같은 치환으로 만든 문장입니다.
                          {detail.total > detail.shown ? ` 전체 ${detail.total.toLocaleString()}명 가운데 상위 ${detail.shown}명을 볼 수 있습니다.` : ` 전체 ${detail.shown}명입니다.`}
                        </p>
                      </>
                    )}
                  </div>
                  {/* ★0828(2) 진행 기록 — 링크 승인이면 어느 담당자 번호가 눌렀는지까지 보인다(고객 화면과 같은 표) */}
                  <AgencyEventLog events={detail.events || []} variant="compact" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ★0828(2) 받는 사람별 미리보기 — 고객 화면과 **같은 공용 모달**(조립은 서버 CT 한 벌) */}
      {detail && (
        <AgencyPreviewModal
          show={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={`${detail.request.companyName || '(회사 없음)'} · ${detail.request.fileName || '대행발송'}`}
          subtitle={`${Number(detail.request.recipientCount || 0).toLocaleString()}명 · ${detail.request.messageType}${detail.request.isAd ? ' · 광고' : ''} · ${formatWhenRelative(detail.request.requestedAt).big}`}
          samples={detail.samples}
          shown={detail.shown}
          total={detail.total}
          messageType={detail.request.messageType}
          callbackNumber={detail.request.callbackNumber}
          images={Array.isArray(detail.request.mmsImagePaths) ? detail.request.mmsImagePaths : []}
        />
      )}

      {/* ── 운영 취소 확인 모달 (native dialog 금지 · 처리 중 닫힘 차단) ── */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-[440px]" role="dialog" aria-modal="true" aria-label="대행발송 취소">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </div>
                <h3 className="text-[15px] font-semibold text-gray-900">이 접수를 취소할까요?</h3>
              </div>
              <button onClick={closeCancel} disabled={cancelBusy} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-[13px] space-y-1">
                <p><span className="text-gray-500">고객사</span> <b className="text-gray-900">{cancelTarget.company_name || '(회사 없음)'}</b>
                  <span className="text-gray-400"> · </span><span className="text-indigo-700 font-semibold">{cancelTarget.user_name || cancelTarget.user_login || '(신청자 없음)'}</span></p>
                <p className="text-gray-600 truncate">{cancelTarget.file_name || cancelTarget.content_preview || ''}</p>
                <p className="text-gray-600">
                  <span className="tabular-nums">{Number(cancelTarget.recipient_count || 0).toLocaleString()}</span>명 · {cancelTarget.message_type}
                  {' · '}보낼 시각 <b className="text-gray-900">{formatWhenRelative(cancelTarget.requested_at).big}</b>
                </p>
              </div>
              <p className="text-[12.5px] text-gray-500 leading-relaxed">
                취소가 확정되면 담당자 번호 전원에게 취소 안내 문자가 나가고, 처리 기록에 처리자 계정이 남습니다.
              </p>
              <div>
                <label className="block text-[12px] font-medium text-gray-500 mb-1">메모 (선택 · 취소 사유에 함께 남습니다)</label>
                <input
                  value={cancelMemo}
                  onChange={(e) => setCancelMemo(e.target.value)}
                  maxLength={120}
                  disabled={cancelBusy}
                  placeholder="예: 대표번호로 전화 요청"
                  className="w-full h-9 px-3 rounded-lg border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300"
                />
              </div>
              {cancelError && <p className="text-[12.5px] text-rose-600">{cancelError}</p>}
            </div>
            <div className="px-5 py-3.5 border-t flex justify-end gap-2">
              <button onClick={closeCancel} disabled={cancelBusy}
                className="h-9 px-4 rounded-lg border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                닫기
              </button>
              <button onClick={() => void runCancel()} disabled={cancelBusy}
                className="h-9 px-4 rounded-lg bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-1.5">
                {cancelBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                취소 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
