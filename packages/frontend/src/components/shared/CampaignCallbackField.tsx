/**
 * CampaignCallbackField — 캠페인 회신번호 칸 (★2026-10-01 B-1001-6 · 임은지 접수 cmup5zrqd089kjnn43rj9tel0 · Harold 설계)
 *
 * 경위: 수신자별 회신번호로 나간 대행 메일 접수 건이 발송결과·예약 상세에 대표 번호 하나로 보여, 한 번호로 일괄 발송된 것처럼 읽혔다.
 * 처방: 수신자별 회신번호 캠페인(응답 칸 individual_callback) = 「고객별 회신번호 {가장 많이 쓰인 번호} 외 N개」 → 누르면
 *   실제 발신된 회신번호 목록 창(가로 4 × 세로 5 · 쪽당 20 · 검색). 그 밖 캠페인 = 종전 표시 그대로(회신번호 · 없으면 대체 글자).
 * 목록의 진실 = 발송 표 call_back(GET /api/v1/results/campaigns/:id/callbacks · 백엔드 CT campaign-callback-list).
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Loader2, Phone, Search, X } from 'lucide-react';
import { formatPhoneNumber } from '../../utils/formatDate';

type CallbackItem = { callback: string; count: number };

/** 목록 창 한 쪽 = 가로 4 × 세로 5 */
export const CALLBACK_LIST_COLUMNS = 4;
export const CALLBACK_LIST_ROWS = 5;
export const CALLBACK_LIST_PAGE_SIZE = CALLBACK_LIST_COLUMNS * CALLBACK_LIST_ROWS;

/** 수신자별 회신번호 캠페인인가 — 판정은 서버 응답 칸 하나(individual_callback)만 본다 */
export function isIndividualCallbackCampaign(campaign: any): boolean {
  return campaign?.individual_callback === true;
}

/** 칸 문구 — 첫 번호(가장 많이 쓰인 번호) + 나머지 개수 */
export function individualCallbackSummary(items: CallbackItem[]): string {
  if (items.length === 0) return '고객별 회신번호';
  const head = formatPhoneNumber(items[0].callback) || items[0].callback;
  return items.length > 1 ? `고객별 회신번호 ${head} 외 ${items.length - 1}개` : `고객별 회신번호 ${head}`;
}

/** 검색 — 숫자만 비교(하이픈을 넣어 쳐도 같은 결과) */
export function filterCallbacks(items: CallbackItem[], q: string): CallbackItem[] {
  const digits = q.replace(/\D/g, '');
  if (!digits) return items;
  return items.filter((it) => it.callback.includes(digits));
}

/**
 * @param refreshKey 바뀌면 목록을 다시 읽는다 — 예약 상세에서 수신자를 지우면 그 번호가 큐에서 빠진다(Codex 1001 R1 · 인원 수를 넘긴다)
 */
export default function CampaignCallbackField({ campaign, fallback = '-', refreshKey }: { campaign: any; fallback?: string; refreshKey?: unknown }) {
  const individual = isIndividualCallbackCampaign(campaign);
  const campaignId = campaign?.id ? String(campaign.id) : '';
  const [items, setItems] = useState<CallbackItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!individual || !campaignId) return;
    let alive = true;
    setItems(null);
    setFailed(false);
    const token = localStorage.getItem('token');
    fetch(`/api/v1/results/campaigns/${campaignId}/callbacks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => { if (alive) setItems(Array.isArray(d?.items) ? d.items : []); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [individual, campaignId, refreshKey]);

  if (!individual) return <>{campaign?.callback_number || fallback}</>;
  if (failed) return <span className="text-slate-500">고객별 회신번호 <span className="text-xs text-rose-500">(목록을 불러오지 못했습니다)</span></span>;
  if (items === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-500">
        고객별 회신번호 <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="불러오는 중" />
      </span>
    );
  }
  if (items.length === 0) return <span className="text-slate-700">고객별 회신번호</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left text-indigo-600 hover:text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:decoration-indigo-500 font-medium"
      >
        {individualCallbackSummary(items)}
      </button>
      {open && <CallbackListModal title={campaign?.campaign_name || ''} items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function CallbackListModal({ title, items, onClose }: { title: string; items: CallbackItem[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterCallbacks(items, q), [items, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / CALLBACK_LIST_PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * CALLBACK_LIST_PAGE_SIZE, current * CALLBACK_LIST_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 쪽 번호는 현재 쪽 기준 앞뒤 2개씩(최대 5개) — 1클릭 이동
  const start = Math.max(1, Math.min(current - 2, pages - 4));
  const pageNums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-3 md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="발신된 회신번호"
        className="w-full max-w-[720px] max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 md:px-6 pt-5 pb-4 bg-gradient-to-b from-indigo-50/70 via-white to-white">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white grid place-items-center shadow-lg shadow-indigo-500/25">
            <Phone className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-slate-900">발신된 회신번호 <span className="text-indigo-600 tabular-nums">{items.length.toLocaleString()}</span>개</h3>
            {title && <p className="text-xs text-slate-500 truncate mt-0.5">{title}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="w-8 h-8 shrink-0 grid place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 md:px-6 pb-3">
          <label className="flex items-center gap-2 rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-300">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode="numeric"
              placeholder="번호 검색 (숫자 일부만 넣어도 됩니다)"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="검색어 지우기" className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </label>
          {q && <p className="text-[11px] text-slate-500 mt-1.5">검색 결과 {filtered.length.toLocaleString()}개</p>}
        </div>

        <div className="px-5 md:px-6 flex-1 overflow-y-auto">
          {shown.length > 0 ? (
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="callback-grid">
              {shown.map((it) => (
                <li key={it.callback} className="rounded-xl bg-slate-50/70 ring-1 ring-slate-900/5 px-3 py-2.5 text-center text-sm font-medium text-slate-800 tabular-nums">
                  {formatPhoneNumber(it.callback) || it.callback}
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">검색 결과가 없습니다.</div>
          )}
        </div>

        <div className="px-5 md:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-[10px] text-slate-400 italic order-2 sm:order-1">Data source: 통신사 발송 큐·결과(MySQL) 회신번호</span>
          <div className="flex items-center gap-1 order-1 sm:order-2">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="이전 쪽"
              className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {pageNums.map((n) => (
              <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === current ? 'page' : undefined}
                className={`min-w-[2rem] h-8 px-2 rounded-lg text-sm tabular-nums ${n === current ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}>
                {n}
              </button>
            ))}
            <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="다음 쪽"
              className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="ml-2 text-xs text-slate-400 tabular-nums">{current} / {pages}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
