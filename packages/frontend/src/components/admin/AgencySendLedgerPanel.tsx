/**
 * AgencySendLedgerPanel — 슈퍼관리자 대행발송 내역 (★2026-08-26(2) Harold 지시 신설)
 *
 * 전 고객사의 대행발송 접수 진행현황을 한 자리에서 본다: 고객 화면과 같은 6단계 진행 레일 +
 * 접수구분(요청서·직접 입력·메일) + 고객사명 + 신청자명. 읽기 전용(처리 손은 고객 화면·워커가 소유).
 * 데이터 = GET /api/admin/agency-send 의 requests(레일 재료 = approved_at·queued_at까지 실려 온다).
 * 표시 판정(레일·상태·출처 라벨)은 고객 화면과 **같은 CT**(agency-send-api)를 읽는다 — 두 화면이 다르게 읽히면 안 된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Send } from 'lucide-react';
import AgencyProgressRail from '../agency/AgencyProgressRail';
import {
  formatWhenRelative, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE,
  type AgencySendStatus,
} from '../agency/agency-send-api';
import { CUI_PILL_BASE, CUI_PILL_TONE } from '../../utils/console-ui';

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
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-gray-400 italic">Data source: 대행발송 접수 원장 (최근 200건)</p>
        </div>
      )}
    </div>
  );
}
