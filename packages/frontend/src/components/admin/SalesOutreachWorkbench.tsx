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
import { X, Loader2, Check, Ban, ExternalLink, Send, RefreshCw, ShieldAlert, Sparkles, Store, CheckSquare, Square, AlertTriangle, Megaphone, FileSpreadsheet, Building2, ImageOff } from 'lucide-react';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { useToast } from '../ToastProvider';
import OutreachDirectSendConfirm from './OutreachDirectSendConfirm';
import {
  outreachFetch, WORKBENCH_LANES, WORKBENCH_GROUPS, HERO_KIND_LABEL, groupOfLane, DOMAIN_BADGE, EDIT_REASON_OPTIONS, splitEmail, fmtDateTime,
  type WorkbenchData, type WorkbenchCard, type WorkbenchLane, type WorkbenchGroup,
} from './sales-outreach-shared';
import ZoneFrame from '../zone/ZoneFrame';
import ZoneSegmented from '../zone/ZoneSegmented';
import ZoneSelect from '../zone/ZoneSelect';
import type { ZoneCustomModule } from '../zone/zone-color';
// ★0924 네이버 스토어 화면 가져오기(카드 [스토어 열기] → 북마크 → 수신 탭 알림 → 새로고침)
import OutreachStoreGrabInstall from './OutreachStoreGrabInstall';
import { onStoreGrab } from './outreach-store-grab';

interface Props {
  onClose: () => void;
  /** 상세 열기 — 그 건 + 같은 줄의 순서(모달의 이전·다음) */
  onOpenJob: (id: string, laneIds: string[]) => void;
  /** ★ 2026-10-09 R10·R11 'page' = /admin/outreach 페이지(AI 존 틀 · 머리 띠 탭 3개) · 기본 = 옛 전체 화면 덮개 */
  variant?: 'overlay' | 'page';
  /** 페이지 시작 카드(엑셀 올리기 · 한 곳 등록) */
  onOpenNew?: () => void;
}

/** ★ 2026-10-09 허브 밖 화면의 머리 띠 모듈(고객 허브 원장에 넣지 않는다) */
const OUTREACH_ZONE: ZoneCustomModule = {
  id: 'sales-outreach', label: 'AI 영업', description: '엑셀로 올리면 브랜드별 시안까지 만들어 확인 뒤 보냅니다', icon: Megaphone, gradient: 'from-sky-500 to-blue-600',
};

const LANE_ORDER_DEFAULT: WorkbenchLane[] = ['review', 'send', 'confirm', 'post_review', 'producing', 'reading', 'hold', 'failed', 'sent'];

export default function SalesOutreachWorkbench({ onClose, onOpenJob, variant = 'overlay', onOpenNew }: Props) {
  const page = variant === 'page';
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
  const [grabInstallOpen, setGrabInstallOpen] = useState(false);
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
  // ★0924 스토어 화면이 어느 건에 붙으면 바로 새로고침(카드의 "가져옴" 표시)
  useEffect(() => onStoreGrab(() => { load(); }), [load]);

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
      if (e.key === 'Escape') { e.stopPropagation(); if (holdFor) setHoldFor(null); else if (!page) onClose(); return; }
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
  }, [cards, focus, busy, confirmState, bulkOpen, holdFor, onClose, onOpenJob, page]);

  const batchLabel = (b: { batch: string; firstAt: string; n: number }) => `${fmtDateTime(b.firstAt)} 업로드 · ${b.n}곳`;
  const changeBatch = (v: string) => { setBatch(v); setLane(''); load(v); };
  const refresh = () => { load(); loadStatus(); };

  // ★ 2026-10-09 R12 머리 띠 탭 3개(줄 묶음) — 고르면 그 묶음에서 일이 있는 첫 줄로
  const group: WorkbenchGroup = lane ? groupOfLane(lane) : 'check';
  const groupCount = (g: (typeof WORKBENCH_GROUPS)[number]) => g.lanes.reduce((n, k) => n + (data?.laneCounts[k] || 0), 0);
  const selectGroup = (id: string) => {
    const g = WORKBENCH_GROUPS.find((x) => x.id === id);
    if (!g) return;
    setLane(g.lanes.find((k) => (data?.laneCounts[k] || 0) > 0) || g.lanes[0]);
  };
  // 세부 줄 = 이 묶음에서 건이 있는 줄 + 지금 고른 줄(0건 줄은 숨긴다)
  const laneItems = (WORKBENCH_GROUPS.find((g) => g.id === group)?.lanes || [])
    .filter((k) => (data?.laneCounts[k] || 0) > 0 || k === lane)
    .map((k) => ({ id: k, label: WORKBENCH_LANES.find((l) => l.key === k)?.label || k, count: data?.laneCounts[k] || 0 }));

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" data-zone="toolbar">
      <ZoneSelect<string>
        value={batch}
        onChange={changeBatch}
        ariaLabel="업로드 묶음"
        options={[...(data?.batches || []).map((b) => ({ value: b.batch, label: batchLabel(b) })), { value: 'single', label: '개별 등록 건' }]}
      />
      {laneItems.length > 0 && lane && <ZoneSegmented<WorkbenchLane> items={laneItems} value={lane} onChange={setLane} ariaLabel="세부 줄" />}
    </div>
  );

  const banners = (
    <>
      {grabInstallOpen && <div className="mb-3"><OutreachStoreGrabInstall /></div>}
      {autoStop?.stopped && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> 자동 발송이 멈춰 있습니다 · {autoStop.reason || ''}{autoStop.at ? ` · ${fmtDateTime(autoStop.at)}` : ''}</span>
          <button onClick={resumeAuto} disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-xs hover:bg-rose-100 disabled:opacity-40">원인 확인 후 다시 켜기</button>
        </div>
      )}
      {notice && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700 shrink-0" aria-label="알림 닫기"><X className="w-4 h-4" /></button>
        </div>
      )}
    </>
  );

  const sendTools = lane === 'send' && (
    <div className="mt-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-3 flex-wrap">
      {stage >= 2 ? (
        <>
          <span>홈페이지와 같은 도메인이고 잠금이 없는 건만 묶어서 보낼 수 있습니다 · 선택 {selectedItems.length}건</span>
          <span className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set(sendable.map((c) => c.id)))} disabled={sendable.length === 0} className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">전부 고르기</button>
            <button onClick={() => setBulkOpen(true)} disabled={busy || selectedItems.length === 0}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-40 flex items-center gap-1"><Send className="w-3.5 h-3.5" /> 선택 {selectedItems.length}건 보내기</button>
          </span>
        </>
      ) : (
        <span>묶음 발송은 단계 2부터 열립니다. 지금은 카드의 [상세]에서 한 건씩 보냅니다{data?.stage.blockers.length ? ` · 남은 조건: ${data.stage.blockers.join(' · ')}` : ''}.</span>
      )}
    </div>
  );

  // ★ 2026-10-09 R13 3초 판정 카드 — 위 = 받는 사람이 메일을 열면 처음 보는 모양(제목 줄 + 그 브랜드 히어로 + 휴대폰 속 DM) · 아래 = 재료 판정 한 줄 + O/X
  const cardGrid = (
    <div className="mt-4">
      {!data ? (
        <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600" /></div>
      ) : cards.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200">
          이 줄에 건이 없습니다{page && onOpenNew ? '. 위의 시작 카드로 업체를 올려 보세요.' : '.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((c, i) => {
            const b = DOMAIN_BADGE[c.domainVerdict];
            const on = i === focus;
            const canSelect = c.lane === 'send' && stage >= 2 && sendable.some((x) => x.id === c.id);
            const facts = [
              c.heroKind ? HERO_KIND_LABEL[c.heroKind] : null,
              typeof c.productCount === 'number' ? `상품 ${c.productCount}` : null,
              typeof c.eventCount === 'number' ? `행사 ${c.eventCount}` : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={c.id} onClick={() => setFocus(i)}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col ${on ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
                {/* 받은편지함 한 줄 */}
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 text-[11.5px] flex items-center gap-2 min-w-0">
                  <span className="shrink-0 font-semibold text-slate-700">한줄로 제안</span>
                  <span className="truncate text-slate-600">{c.directSubject || (c.stage === 'awaiting_confirm' ? '행사 확인 전' : '메일 조립 전')}</span>
                </div>
                {/* 메일 첫 화면(히어로) + 휴대폰 속 DM */}
                <div className="relative h-56 bg-slate-100">
                  {c.heroUrl
                    ? <img src={c.heroUrl} alt={`${c.companyName} 메일 첫 이미지`} loading="lazy" className="w-full h-full object-cover object-top" />
                    : <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[11.5px] text-slate-400"><ImageOff className="w-5 h-5" />첫 이미지 준비 전</div>}
                  {c.captureUrl && (
                    <img src={c.captureUrl} alt="모바일 DM 첫 화면" loading="lazy"
                      className="absolute right-2 bottom-2 w-16 h-28 object-cover object-top rounded-[10px] border-[3px] border-slate-800 bg-white shadow-md" />
                  )}
                </div>
                <div className="p-3 flex-1 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900 truncate">{c.companyName}</span>
                    {c.chainIndex ? <span className="text-[10.5px] text-slate-400">#{c.chainIndex}</span> : null}
                    {c.autoConfirmed && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 inline-flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> 자동 확정</span>}
                    {c.storeGrab
                      ? <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 inline-flex items-center gap-0.5" title={fmtDateTime(c.storeGrab.at)}><Store className="w-3 h-3" /> 스토어 기획 {c.storeGrab.campaigns}</span>
                      : c.naverStoreUrl && <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 inline-flex items-center gap-0.5"><Store className="w-3 h-3" /> 스토어</span>}
                  </div>
                  {facts && <div className="text-slate-600">{facts}</div>}
                  {c.templateName && (
                    <div className="text-slate-500 truncate" title={c.templateReason || undefined}>템플릿 {c.templateName}{c.templateReason ? ` · ${c.templateReason}` : ''}</div>
                  )}
                  {c.contact.email ? (
                    <div className="text-slate-700 break-all">{splitEmail(c.contact.email).local}<b>{splitEmail(c.contact.email).domain}</b>
                      <span className={`ml-1.5 text-[10.5px] px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                    </div>
                  ) : <div className="text-rose-600">담당자 이메일 없음</div>}
                  {c.events.length > 0 && <div className="flex flex-wrap gap-1">{c.events.map((ev, k) => <span key={k} className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 truncate max-w-full">{ev}</span>)}</div>}
                  {c.visionItems && (
                    <div className={`text-[11px] ${c.visionOk ? 'text-emerald-700' : 'text-amber-700'}`}>DM 캡처 확인 {c.visionItems.passed}/{c.visionItems.total}{c.visionOk === false ? ' · 첫 화면 헤드라인·글자 잘림 확인 필요' : ''}</div>
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
                    <div className="text-[11px] text-slate-500">발송 {fmtDateTime(c.send.at)} · {c.send.outcome === 'sent' ? '도착' : c.send.outcome}{c.send.mode === 'auto' ? ' · 자동' : c.send.mode === 'bulk' ? ' · 묶음' : ''}</div>
                  )}
                  {c.directLast?.outcome === 'skipped' && c.lane !== 'sent' && <div className="text-[11px] text-slate-500">{c.directLast.detail}</div>}
                </div>
                {/* 조작 */}
                <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                  {canSelect && (
                    <button onClick={(e) => { e.stopPropagation(); setSelected((cur) => { const n = new Set(cur); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }); }}
                      className="text-indigo-600" aria-label="선택">{selected.has(c.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button>
                  )}
                  {c.lane === 'review' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); review(c); }} disabled={busy || !c.emailAssetId}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-xs disabled:opacity-40 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 확인 O</button>
                      <button onClick={(e) => { e.stopPropagation(); setHoldFor(holdFor === c.id ? null : c.id); }} disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> 보류 X</button>
                    </>
                  )}
                  {c.lane === 'post_review' && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); flagSend(c, 'ok'); }} disabled={busy} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs disabled:opacity-40">문제없음</button>
                      <button onClick={(e) => { e.stopPropagation(); flagSend(c, 'wrong'); }} disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-xs hover:bg-rose-50 disabled:opacity-40">잘못 나감</button>
                    </>
                  )}
                  {/* ★0924 확정 전 건만 — 스토어를 열어 북마크 [한줄로 가져오기]를 누르면 이 건에 문구가 들어온다 */}
                  {c.naverStoreUrl && (c.lane === 'reading' || c.lane === 'confirm') && (
                    <a href={c.naverStoreUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                      className="px-2.5 py-1.5 rounded-lg border border-green-200 text-green-700 text-xs hover:bg-green-50 inline-flex items-center gap-1"><Store className="w-3.5 h-3.5" /> 스토어 열기</a>
                  )}
                  {c.dmUrl && <a href={c.dmUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11px] text-slate-500 hover:text-indigo-600 inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" /> DM</a>}
                  <button onClick={(e) => { e.stopPropagation(); onOpenJob(c.id, cards.map((x) => x.id)); }}
                    className="ml-auto px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 text-xs hover:bg-indigo-50">{c.lane === 'confirm' ? '확인하기' : '상세'}</button>
                </div>
                {holdFor === c.id && (
                  <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                    {EDIT_REASON_OPTIONS.map((o) => (
                      <button key={o.value} onClick={(e) => { e.stopPropagation(); hold(c, o.value); }} disabled={busy}
                        className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[11px] hover:bg-amber-100 disabled:opacity-40">{o.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-[10px] text-slate-400 italic">Data source: 업로드 묶음별 자동 제작·확인·발송 기록(서버 집계) · J/K 이동 · O 확인 · X 보류 · Enter 상세</p>
    </div>
  );

  const dialogs = (
    <>
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
    </>
  );

  // ★ 2026-10-09 페이지 = AI 존 틀(남색 머리 띠 · 탭 3개 · 시작 카드 · 밝은 작업대)
  if (page) {
    return (
      <ZoneFrame
        moduleId={OUTREACH_ZONE}
        backTo="/admin"
        backLabel="관리자 화면으로"
        width="full"
        tabs={WORKBENCH_GROUPS.map((g) => ({ id: g.id, label: g.label, count: data ? groupCount(g) : null, unit: '건', dot: g.id === 'check' && (data?.laneCounts.post_review || data?.laneCounts.failed) ? 'rose' as const : undefined }))}
        activeTab={group}
        onSelectTab={selectGroup}
        links={[{ label: grabInstallOpen ? '스토어 가져오기 버튼 닫기' : '스토어 가져오기 버튼', icon: Store, onClick: () => setGrabInstallOpen(!grabInstallOpen) }]}
        stamp={data ? { text: `발송 단계 ${data.stage.effective}${data.stage.env !== data.stage.effective ? `(결재 ${data.stage.env})` : ''} · 오늘 ${data.today}/${data.cap}`, onRefresh: refresh, loading: busy } : null}
        start={onOpenNew ? {
          items: [
            { icon: FileSpreadsheet, title: '엑셀로 여러 곳 올리기', desc: '업체·홈페이지·담당자를 한 번에 최대 20곳 · 행사 확정까지 자동', onClick: onOpenNew, tint: 'from-sky-500 to-blue-600', featured: true },
            { icon: Building2, title: '한 곳 등록', desc: '홈페이지 주소 하나로 시안을 만들고 확인합니다', onClick: onOpenNew, tint: 'from-sky-400 to-indigo-500' },
          ],
        } : null}
      >
        {banners}
        {toolbar}
        {sendTools}
        {cardGrid}
        {dialogs}
      </ZoneFrame>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-slate-50 flex flex-col">
      {/* 머리 */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">AI 영업 작업대</h2>
          <p className="text-xs text-slate-500">검토 대기 건을 확인(O)하면 발송 대기로 모입니다 · J/K 이동 · X 보류 · Enter 상세</p>
        </div>
        {data && (
          <span className="ml-auto text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700" title={data.stage.blockers.join(' · ') || undefined}>
            발송 단계 {data.stage.effective}{data.stage.env !== data.stage.effective ? ` (결재 ${data.stage.env})` : ''} · 오늘 {data.today}/{data.cap}
          </span>
        )}
        <button onClick={() => setGrabInstallOpen(!grabInstallOpen)}
          className={`px-3 py-2 rounded-lg border text-xs inline-flex items-center gap-1 ${grabInstallOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><Store className="w-3.5 h-3.5" /> 스토어 가져오기 버튼</button>
        <button onClick={refresh} disabled={busy} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" aria-label="새로고침"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50" aria-label="닫기"><X className="w-5 h-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {banners}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <ZoneSegmented<WorkbenchGroup>
            items={WORKBENCH_GROUPS.map((g) => ({ id: g.id, label: g.label, count: data ? groupCount(g) : null }))}
            value={group}
            onChange={selectGroup}
            ariaLabel="줄 묶음"
          />
        </div>
        {toolbar}
        {sendTools}
        {cardGrid}
      </div>
      {dialogs}
    </div>,
    document.body,
  );
}
