/**
 * ★ 2026-09-23 AI 영업 작업대(전체 화면 · 설계서 docs/2026-09-23-outreach-direct-send-design.md §12)
 *
 * 업로드 묶음 하나를 줄(읽는 중 → 확인 대기 → 제작 중 → 검토 대기 → 발송 대기 → 보낸 건 · 사후 확인 · 보류 · 실패)로 나눠 보고,
 * 검토 대기 건을 3초 판정 카드로 넘기며 확인(O)·보류(X)한다. 확인한 건은 발송 대기로 모이고, 단계 2부터 묶어서 1클릭으로 보낸다.
 * 줄 · 잠금 · 건수 · 단계는 전부 서버 계산값(GET /workbench)이다 — 프론트는 판정을 복제하지 않는다.
 * 톤 = AI 영업 모달과 같은 라이트(0824 확정) · 캡처만 흰 바탕. native dialog 0 · 키보드는 한글 입력 중이면 무시(isComposing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check, Ban, ExternalLink, Send, RefreshCw, ShieldAlert, Sparkles, Store, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { useToast } from '../ToastProvider';
import OutreachDirectSendConfirm from './OutreachDirectSendConfirm';
import {
  outreachFetch, WORKBENCH_LANES, DOMAIN_BADGE, EDIT_REASON_OPTIONS, splitEmail, fmtDateTime,
  type WorkbenchData, type WorkbenchCard, type WorkbenchLane,
} from './sales-outreach-shared';

interface Props {
  onClose: () => void;
  /** 상세 열기 — 그 건 + 같은 줄의 순서(모달의 이전·다음) */
  onOpenJob: (id: string, laneIds: string[]) => void;
}

const LANE_ORDER_DEFAULT: WorkbenchLane[] = ['review', 'send', 'confirm', 'post_review', 'producing', 'reading', 'hold', 'failed', 'sent'];

export default function SalesOutreachWorkbench({ onClose, onOpenJob }: Props) {
  const toast = useToast();
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [batch, setBatch] = useState<string>('');
  const [lane, setLane] = useState<WorkbenchLane | ''>('');
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [holdFor, setHoldFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [autoStop, setAutoStop] = useState<{ stopped?: boolean; reason?: string; at?: string } | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async (b?: string) => {
    const seq = ++reqSeq.current;
    try {
      const q = (b ?? batch) ? `?batch=${encodeURIComponent(b ?? batch)}` : '';
      const r = await outreachFetch(`/api/sales-outreach/workbench${q}`);
      const d = await r.json().catch(() => ({}));
      if (seq !== reqSeq.current) return;
      if (!r.ok) { setNotice(d?.error || '작업대를 불러오지 못했습니다.'); return; }
      setData(d as WorkbenchData);
      if (!batch && d?.batch) setBatch(String(d.batch));
    } catch { /* 다음 폴링에서 회복 */ }
  }, [batch]);

  const loadStatus = useCallback(async () => {
    try {
      const r = await outreachFetch('/api/sales-outreach/direct/status');
      const d = await r.json().catch(() => ({}));
      if (r.ok) setAutoStop(d?.autoStop || null);
    } catch { /* 표시만 생략 */ }
  }, []);

  useEffect(() => { load(); loadStatus(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 폴링 — 움직이는 줄(읽는 중 · 제작 중 · 확인 대기 자동 확정)이 있으면 5초 · 없으면 20초
  const moving = !!data && ((data.laneCounts.reading || 0) + (data.laneCounts.producing || 0) > 0);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, moving ? 5000 : 20000);
    return () => clearInterval(t);
  }, [moving, load]);

  // 첫 진입 줄 = 일이 있는 첫 줄(검토 대기 우선)
  useEffect(() => {
    if (!data || lane) return;
    const first = LANE_ORDER_DEFAULT.find((k) => (data.laneCounts[k] || 0) > 0);
    setLane(first || 'review');
  }, [data, lane]);

  const cards: WorkbenchCard[] = useMemo(() => (data?.cards || []).filter((c) => c.lane === lane), [data, lane]);
  useEffect(() => { if (focus >= cards.length) setFocus(Math.max(0, cards.length - 1)); }, [cards.length, focus]);
  useEffect(() => { setSelected(new Set()); setFocus(0); }, [lane, batch]);

  const post = async (path: string, body?: unknown): Promise<{ ok: boolean; data: any }> => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await outreachFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setNotice(d?.error || '처리에 실패했습니다. 잠시 후 다시 시도해주세요.'); return { ok: false, data: d }; }
      return { ok: true, data: d };
    } catch {
      setNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
      return { ok: false, data: null };
    } finally {
      setBusy(false);
    }
  };

  const review = async (c: WorkbenchCard) => {
    if (!c.emailAssetId || c.lane !== 'review') return;
    const r = await post(`/api/sales-outreach/jobs/${c.id}/review`, { assetId: c.emailAssetId });
    if (r.ok) { toast.success(`${c.companyName} 확인 · 발송 대기로 옮겼습니다.`); await load(); }
  };
  const hold = async (c: WorkbenchCard, reason: string) => {
    setHoldFor(null);
    const r = await post(`/api/sales-outreach/jobs/${c.id}/hold`, { reason });
    if (r.ok) { toast.success(`${c.companyName} 보류했습니다.`); await load(); }
  };
  const flagSend = async (c: WorkbenchCard, flag: 'ok' | 'wrong') => {
    if (!c.send) return;
    const run = async () => {
      const r = await post(`/api/sales-outreach/sends/${c.send!.id}/review-flag`, { flag });
      if (r.ok) { toast.success(flag === 'ok' ? '문제없음으로 기록했습니다.' : '잘못 나감으로 기록했습니다. 자동 발송이 멈췄습니다.'); await load(); await loadStatus(); }
    };
    if (flag === 'wrong') {
      setConfirmState({ mode: 'danger', title: '잘못 나간 건으로 기록합니다', description: '기록하면 자동 발송이 바로 멈춥니다. 원인을 확인한 뒤 다시 켜세요.', confirmLabel: '기록하고 멈추기', onConfirm: run });
      return;
    }
    run();
  };
  const resumeAuto = () => {
    setConfirmState({
      mode: 'warning', title: '자동 발송을 다시 켭니다', description: `멈춘 사유: ${autoStop?.reason || '기록 없음'}. 원인을 확인했을 때만 켜세요.`, confirmLabel: '다시 켜기',
      onConfirm: async () => { const r = await post('/api/sales-outreach/direct/resume'); if (r.ok) { toast.success('자동 발송을 다시 켰습니다.'); await loadStatus(); await load(); } },
    });
  };

  const stage = data?.stage.effective ?? 0;
  const sendable = cards.filter((c) => c.lane === 'send' && !c.lock.locked && c.domainVerdict === 'same' && c.contact.email);
  const selectedItems = sendable.filter((c) => selected.has(c.id));
  const sendBulk = async () => {
    const r = await post('/api/sales-outreach/jobs/send-direct-bulk', { items: selectedItems.map((c) => ({ id: c.id, expectedTo: c.contact.email })) });
    setBulkOpen(false);
    if (r.ok) {
      const q = Array.isArray(r.data?.queued) ? r.data.queued.length : 0;
      const sk: Array<{ id: string; reason: string }> = Array.isArray(r.data?.skipped) ? r.data.skipped : [];
      toast.success(`${q}건을 30초 간격으로 보내기 시작했습니다.`);
      if (sk.length) setNotice(`제외 ${sk.length}건: ${sk.slice(0, 3).map((s) => s.reason).join(' / ')}`);
      setSelected(new Set());
      await load();
    }
  };

  // 키보드 — J/K 이동 · O 확인 · X 보류 · Enter 상세 · 입력 중(한글 조합 포함)이면 무시
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmState || bulkOpen) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (holdFor) setHoldFor(null); else onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (e.isComposing || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const c = cards[focus];
      if (k === 'j') { e.preventDefault(); setFocus((f) => Math.min(cards.length - 1, f + 1)); }
      else if (k === 'k') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (k === 'o' && c && !busy) { e.preventDefault(); review(c); }
      else if (k === 'x' && c && c.lane === 'review') { e.preventDefault(); setHoldFor(c.id); }
      else if (k === 'enter' && c) { e.preventDefault(); onOpenJob(c.id, cards.map((x) => x.id)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, focus, busy, confirmState, bulkOpen, holdFor, onClose, onOpenJob]);

  const batchLabel = (b: { batch: string; firstAt: string; n: number }) => `${fmtDateTime(b.firstAt)} 업로드 · ${b.n}곳`;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col">
      {/* 머리 */}
      <div className="bg-white border-b border-gray-200/70 px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">AI 영업 작업대</h2>
          <p className="text-xs text-gray-500">검토 대기 건을 확인(O)하면 발송 대기로 모입니다 · J/K 이동 · X 보류 · Enter 상세</p>
        </div>
        <select value={batch} onChange={(e) => { setBatch(e.target.value); setLane(''); load(e.target.value); }}
          className="ml-auto px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500 max-w-[260px]">
          {(data?.batches || []).map((b) => <option key={b.batch} value={b.batch}>{batchLabel(b)}</option>)}
          <option value="single">개별 등록 건</option>
        </select>
        {data && (
          <span className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700" title={data.stage.blockers.join(' · ') || undefined}>
            발송 단계 {data.stage.effective}{data.stage.env !== data.stage.effective ? ` (결재 ${data.stage.env})` : ''} · 오늘 {data.today}/{data.cap}
          </span>
        )}
        <button onClick={() => { load(); loadStatus(); }} disabled={busy} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40" title="새로고침"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50"><X className="w-5 h-5" /></button>
      </div>

      {autoStop?.stopped && (
        <div className="mx-4 md:mx-6 mt-3 px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> 자동 발송이 멈춰 있습니다 · {autoStop.reason || ''}{autoStop.at ? ` · ${fmtDateTime(autoStop.at)}` : ''}</span>
          <button onClick={resumeAuto} disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-xs hover:bg-rose-100 disabled:opacity-40">원인 확인 후 다시 켜기</button>
        </div>
      )}
      {notice && (
        <div className="mx-4 md:mx-6 mt-3 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 줄 */}
      <div className="px-4 md:px-6 pt-3 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-max">
          {WORKBENCH_LANES.map((l) => {
            const n = data?.laneCounts[l.key] || 0;
            const on = lane === l.key;
            return (
              <button key={l.key} onClick={() => setLane(l.key)}
                className={`px-3 py-1.5 rounded-full text-xs border whitespace-nowrap ${on ? 'bg-blue-600 text-white border-blue-600' : n ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50' : 'border-gray-200 text-gray-400 bg-white'}`}>
                {l.label} {n}
              </button>
            );
          })}
        </div>
      </div>

      {/* 발송 대기 줄 도구 */}
      {lane === 'send' && (
        <div className="mx-4 md:mx-6 mt-3 px-4 py-2.5 rounded-lg bg-white border border-gray-200/70 text-xs text-gray-600 flex items-center justify-between gap-3 flex-wrap">
          {stage >= 2 ? (
            <>
              <span>홈페이지와 같은 도메인이고 잠금이 없는 건만 묶어서 보낼 수 있습니다 · 선택 {selectedItems.length}건</span>
              <span className="flex items-center gap-2">
                <button onClick={() => setSelected(new Set(sendable.map((c) => c.id)))} disabled={sendable.length === 0} className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">전부 고르기</button>
                <button onClick={() => setBulkOpen(true)} disabled={busy || selectedItems.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-40 flex items-center gap-1"><Send className="w-3.5 h-3.5" /> 선택 {selectedItems.length}건 보내기</button>
              </span>
            </>
          ) : (
            <span>묶음 발송은 단계 2부터 열립니다. 지금은 카드의 [상세]에서 한 건씩 보냅니다{data?.stage.blockers.length ? ` · 남은 조건: ${data.stage.blockers.join(' · ')}` : ''}.</span>
          )}
        </div>
      )}

      {/* 카드 */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {!data ? (
          <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : cards.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">이 줄에 건이 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {cards.map((c, i) => {
              const b = DOMAIN_BADGE[c.domainVerdict];
              const on = i === focus;
              const canSelect = c.lane === 'send' && stage >= 2 && sendable.some((x) => x.id === c.id);
              return (
                <div key={c.id} onClick={() => setFocus(i)}
                  className={`bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col ${on ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200/70'}`}>
                  {/* 받은편지함 한 줄 */}
                  <div className="px-3 py-2 border-b border-gray-100 bg-gray-50/70 text-[11px] flex items-center gap-2 min-w-0">
                    <span className="shrink-0 font-semibold text-gray-700">한줄로 제안</span>
                    <span className="truncate text-gray-600">{c.directSubject || (c.stage === 'awaiting_confirm' ? '행사 확인 전' : '메일 조립 전')}</span>
                  </div>
                  <div className="p-3 flex gap-3 flex-1">
                    {c.captureUrl
                      ? <img src={c.captureUrl} alt="모바일 DM 첫 화면" loading="lazy" className="w-24 h-44 object-cover object-top rounded-lg border border-gray-200 bg-gray-50 shrink-0" />
                      : <div className="w-24 h-44 rounded-lg border border-dashed border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] text-gray-400 text-center px-1">DM 캡처 없음</div>}
                    <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">{c.companyName}</span>
                        {c.chainIndex ? <span className="text-[10px] text-gray-400">#{c.chainIndex}</span> : null}
                        {c.autoConfirmed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 inline-flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> 자동 확정</span>}
                        {c.naverStoreUrl && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 inline-flex items-center gap-0.5"><Store className="w-3 h-3" /> 스토어 저장</span>}
                      </div>
                      {c.contact.email ? (
                        <div className="text-gray-700 break-all">{splitEmail(c.contact.email).local}<b>{splitEmail(c.contact.email).domain}</b>
                          <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                        </div>
                      ) : <div className="text-rose-600">담당자 이메일 없음</div>}
                      {c.events.length > 0 && <div className="flex flex-wrap gap-1">{c.events.map((ev, k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 truncate max-w-full">{ev}</span>)}</div>}
                      {c.visionItems && (
                        <div className={`text-[10px] ${c.visionOk ? 'text-emerald-700' : 'text-amber-700'}`}>DM 캡처 확인 {c.visionItems.passed}/{c.visionItems.total}{c.visionOk === false ? ' · 첫 화면 헤드라인·글자 잘림 확인 필요' : ''}</div>
                      )}
                      {c.lane === 'failed' && c.failReason && <div className="text-rose-600">{c.failReason}</div>}
                      {c.hold && <div className="text-amber-700">보류 · {EDIT_REASON_OPTIONS.find((o) => o.value === c.hold?.reason)?.label || '사유 없음'}</div>}
                      {(c.lane === 'review' || c.lane === 'send' || c.lane === 'hold') && c.lock.locked && (
                        <div className="text-[11px] text-amber-800 flex items-start gap-1" title={c.lock.messages.join('\n')}>
                          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{c.lock.messages.filter((_, k) => !(c.lane === 'review' && c.lock.reasons[k] === 'NOT_REVIEWED'))[0] || '확인하면 보낼 수 있습니다'}{c.lock.reasons.length > 1 ? ` 외 ${c.lock.reasons.length - 1}건` : ''}</span>
                        </div>
                      )}
                      {c.send && (
                        <div className="text-[11px] text-gray-500">발송 {fmtDateTime(c.send.at)} · {c.send.outcome === 'sent' ? '도착' : c.send.outcome}{c.send.mode === 'auto' ? ' · 자동' : c.send.mode === 'bulk' ? ' · 묶음' : ''}</div>
                      )}
                      {c.directLast?.outcome === 'skipped' && c.lane !== 'sent' && <div className="text-[11px] text-gray-500">{c.directLast.detail}</div>}
                    </div>
                  </div>
                  {/* 조작 */}
                  <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    {canSelect && (
                      <button onClick={(e) => { e.stopPropagation(); setSelected((cur) => { const n = new Set(cur); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }); }}
                        className="text-blue-600" aria-label="선택">{selected.has(c.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button>
                    )}
                    {c.lane === 'review' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); review(c); }} disabled={busy || !c.emailAssetId}
                          className="px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-xs disabled:opacity-40 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 확인 O</button>
                        <button onClick={(e) => { e.stopPropagation(); setHoldFor(holdFor === c.id ? null : c.id); }} disabled={busy}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> 보류 X</button>
                      </>
                    )}
                    {c.lane === 'post_review' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); flagSend(c, 'ok'); }} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-40">문제없음</button>
                        <button onClick={(e) => { e.stopPropagation(); flagSend(c, 'wrong'); }} disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-40">잘못 나감</button>
                      </>
                    )}
                    {c.dmUrl && <a href={c.dmUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-gray-500 hover:text-blue-600 inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" /> DM</a>}
                    <button onClick={(e) => { e.stopPropagation(); onOpenJob(c.id, cards.map((x) => x.id)); }}
                      className="ml-auto px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 text-xs hover:bg-blue-50">{c.lane === 'confirm' ? '확인하기' : '상세'}</button>
                  </div>
                  {holdFor === c.id && (
                    <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                      {EDIT_REASON_OPTIONS.map((o) => (
                        <button key={o.value} onClick={(e) => { e.stopPropagation(); hold(c, o.value); }} disabled={busy}
                          className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[11px] hover:bg-amber-100 disabled:opacity-40">{o.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[10px] text-gray-400 italic">Data source: 업로드 묶음별 자동 제작·확인·발송 기록(서버 집계)</p>
      </div>

      <OutreachDirectSendConfirm
        open={bulkOpen}
        busy={busy}
        today={data?.today || 0}
        cap={data?.cap || 0}
        items={selectedItems.map((c) => ({ jobId: c.id, companyName: c.companyName, to: String(c.contact.email), domainVerdict: c.domainVerdict, directSubject: c.directSubject, captureUrl: c.captureUrl }))}
        onConfirm={sendBulk}
        onClose={() => setBulkOpen(false)}
      />
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>,
    document.body,
  );
}
