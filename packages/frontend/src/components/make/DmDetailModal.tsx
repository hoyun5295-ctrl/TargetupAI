/**
 * DmDetailModal — 보낸 DM 상세 창(★ 2026-09-27 만들기 개편 · 목업 (마) ②)
 *
 * 왼쪽 = 표지 · 발행 주소(단축 · 한글) · 정보 · 수정/복제/중지(재개)/삭제
 * 오른쪽 = 성과(개인화 링크 실측) · 보낸 기록 · 받은 사람별 · 응답(참여형만) / 다시 보내기 · 안 본 사람에게 다시 보내기
 * 숫자는 전부 서버 실측(GET /api/dm/:id/recipients-tracking · /event-stats · /responses · /alias). 지어내는 비율 0.
 * 개인화 발송 기록이 없으면(공용 링크만) 공용 링크 열람 패널을 그대로 보여 준다.
 */
import { useEffect, useMemo, useState } from 'react';
import { X, Copy, PenLine, CopyPlus, Pause, Play, Trash2, Send, RefreshCw, Loader2, Sparkles, Link2 } from 'lucide-react';
import { useToast } from '../ToastProvider';
import DmPublicLinkStatsPanel from '../dm/DmPublicLinkStatsPanel';
import { StatusChip, fmtDate } from './HomeParts';
import { MK_BTN_OUTLINE, MK_BTN_PRIMARY, MK_MODAL, MK_MODAL_BACKDROP } from '../../utils/make-ui';
import { dmChipStatus, INTERACTION_SECTION_TYPES } from '../../utils/make-flow';
import { formatKstMonthDayTime } from '../../utils/formatDate';
import { SECTION_META } from '../../utils/dm-section-defaults';
import { downloadAuthFile } from '../../lib/auth-download';

export interface DmDetailItem {
  id: string; title: string; status?: string; short_code?: string | null; layout_mode?: string; catalog?: boolean;
  view_count?: number; has_send_history?: boolean; updated_at?: string; created_at?: string;
  /** ★ 2026-10-03 다가오는 예약 시각(목록 API) — 상태 칩 「예약」 */
  scheduled_at?: string | null;
  section_summary?: { types: string[]; cover?: string | null; count: number };
}

/** ★ 2026-10-03 보낸 기록 한 줄의 상태 표기(남지현 접수 · 예약이 「보냄」으로 보였다) — 상태 원천 = 서버 dm-recipient-token DM_TOKEN_SEND_STATE_SQL */
const BATCH_STATE_LABEL: Record<string, { text: string; tone: string }> = {
  scheduled: { text: '(예약)', tone: 'text-amber-700' },
  cancelled: { text: '(예약 취소)', tone: 'text-slate-400' },
  failed: { text: '(보내지 못함)', tone: 'text-rose-700' },
};

interface Track {
  summary: { sent: number; scheduled?: number; viewed: number; reached50: number; completed: number; clicked: number; responded: number; purchased?: number };
  recipients: Array<{ customerId: string; name: string | null; phone: string | null; sendState?: string; sentAt: string | null; viewed: boolean; progressPct: number; clicks: number; responded: boolean }>;
  /** ★ 2026-10-03 발송마다 한 줄(시각 = 예약 시각 → 실제 발송 시각 · 상태 · 사람 수) */
  batches?: Array<{ at: string; state: string; count: number }>;
  /** ★ 2026-10-25 원장 #80 — 보낸 기록이 서버 상한에 걸렸다(「최근 N번」이라고 말한다) */
  batchesTruncated?: boolean;
  recipientsTotal?: number; listTruncated?: boolean;
  segments?: { unviewed?: number };
  hourDistribution?: Array<{ hour: number; cnt: number }>;
  sectionExits?: Array<{ id: string; label: string; count: number }>;
}

const authGet = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
/** 당첨 방법(서버 dm_winners.win_method) → 화면 말 */
const WIN_METHOD_LABEL: Record<string, string> = { random: '추첨', roulette: '룰렛', preset: '미리 정함' };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const maskPhone = (p: string | null) => (p ? p.replace(/(\d{3})\d{3,4}(\d{4})/, '$1-****-$2') : '');
const maskName = (n: string | null) => (n ? (n.length <= 1 ? n : `${n[0]}${'*'.repeat(Math.max(1, n.length - 2))}${n.length > 2 ? n[n.length - 1] : ''}`) : '이름 없음');

export default function DmDetailModal({ dm, onClose, onEdit, onClone, onStop, onResume, onDelete, onResend, onResendUnviewed, onGetUrl, onAlias, cloning }: {
  dm: DmDetailItem;
  onClose: () => void;
  onEdit: () => void;
  onClone: () => void;
  onStop: () => void;
  onResume: () => void;
  onDelete: () => void;
  onResend: () => void;
  onResendUnviewed: () => void;
  /** 발행 주소 받기 = 기존 [주소 복사]와 같은 경로(발행 멱등 · 추가 과금 0) — 주소는 서버 설정이 만든다 */
  onGetUrl: () => Promise<string | null>;
  /** 한글 주소 만들기(기존 창) */
  onAlias: () => void;
  cloning?: boolean;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'perf' | 'batches' | 'people' | 'responses'>('perf');
  const [track, setTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);
  const [alias, setAlias] = useState<string | null>(null);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  // ★ 2026-10-25 원장 #63 — 응답 탭 = 응답(더 보기) + 당첨자 명단 + 응모자 엑셀 + 미리 정한 당첨자 올리기(서버 주소 셋 그대로)
  const [resp, setResp] = useState<{ total: number; rows: any[]; stats?: any; winners: any[]; page: number } | null>(null);
  const [respBusy, setRespBusy] = useState<'' | 'more' | 'import'>('');
  const status = dmChipStatus(dm);
  const interactive = (dm.section_summary?.types || []).some((t) => INTERACTION_SECTION_TYPES.includes(t as any));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/dm/${dm.id}/recipients-tracking`, { headers: authGet() });
        const d = await r.json().catch(() => ({}));
        if (alive && r.ok && d?.success) setTrack(d as Track);
      } catch { /* 빈 성과 */ }
      if (alive) setLoading(false);
      try {
        const r = await fetch(`/api/dm/${dm.id}/alias`, { headers: authGet() });
        const d = await r.json().catch(() => ({}));
        const a = d?.alias?.shortUrl || null;
        if (alive && a) setAlias(String(a));
      } catch { /* 한글 주소 없음 */ }
    })();
    return () => { alive = false; };
  }, [dm.id]);

  useEffect(() => {
    if (tab !== 'responses' || resp) return;
    let alive = true;
    (async () => {
      try {
        const [a, b, w] = await Promise.all([
          fetch(`/api/dm/${dm.id}/responses?page=1&limit=50`, { headers: authGet() }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/dm/${dm.id}/event-stats`, { headers: authGet() }).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/dm/${dm.id}/winners`, { headers: authGet() }).then((r) => r.json()).catch(() => []),
        ]);
        if (alive) setResp({ total: Number(a?.total) || 0, rows: Array.isArray(a?.rows) ? a.rows : [], stats: b, winners: Array.isArray(w) ? w : [], page: 1 });
      } catch { if (alive) setResp({ total: 0, rows: [], winners: [], page: 1 }); }
    })();
    return () => { alive = false; };
  }, [tab, resp, dm.id]);

  const loadMoreResponses = async () => {
    if (!resp || respBusy) return;
    setRespBusy('more');
    try {
      const a = await fetch(`/api/dm/${dm.id}/responses?page=${resp.page + 1}&limit=50`, { headers: authGet() }).then((r) => r.json());
      const more = Array.isArray(a?.rows) ? a.rows : [];
      setResp((cur) => cur && ({ ...cur, rows: [...cur.rows, ...more], page: cur.page + 1, total: Number(a?.total) || cur.total }));
    } catch { toast.error('응답을 더 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.'); }
    finally { setRespBusy(''); }
  };
  // 미리 정한 당첨자 엑셀 — 추첨 블록 응모와 이어 붙인다(그 블록 응모가 있으면 그 칸 번호로 · 없으면 명단만)
  const importWinners = async (file: File | null | undefined) => {
    if (!file || respBusy) return;
    setRespBusy('import');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const sectionId = resp?.rows.find((r) => r.section_type === 'lucky_draw')?.section_id;
      if (sectionId) fd.append('section_id', String(sectionId));
      const r = await fetch(`/api/dm/${dm.id}/winners/import`, { method: 'POST', headers: authGet(), body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) { toast.error(String(d?.error || '당첨자 엑셀을 올리지 못했어요.')); return; }
      const bad = Array.isArray(d.parse_errors) ? d.parse_errors.length : 0;
      toast.success(`당첨자 ${Number(d.inserted) || 0}명을 올렸어요${Number(d.linked) > 0 ? ` · 응모와 이어진 ${d.linked}명` : ''}${bad > 0 ? ` · 읽지 못한 줄 ${bad}개(이름 · 전화 확인)` : ''}`);
      const w = await fetch(`/api/dm/${dm.id}/winners`, { headers: authGet() }).then((x) => x.json()).catch(() => null);
      if (Array.isArray(w)) setResp((cur) => cur && ({ ...cur, winners: w }));
    } catch { toast.error('당첨자 엑셀을 올리지 못했어요. 잠시 뒤 다시 해 주세요.'); }
    finally { setRespBusy(''); }
  };

  const s = track?.summary;
  // ★ 2026-10-03 보낸 기록 = 서버 묶음(발송마다 한 줄 · 남지현 접수). 옛 서버 응답이면 수신자 시각을 분 단위로 묶는다 —
  //   시각 글자는 자르지 않는다(옛: 앞 16자로 잘라 끝의 Z 가 떨어지고 지역 시각으로 다시 읽어 9시간 이른 시각이 보였다).
  const batches = useMemo<Array<{ at: string; state: string; count: number }>>(() => {
    if (Array.isArray(track?.batches)) return track!.batches!;
    const m = new Map<number, { at: string; count: number }>();
    for (const r of track?.recipients || []) {
      if (!r.sentAt) continue;
      const t = new Date(r.sentAt).getTime();
      if (Number.isNaN(t)) continue;
      const k = Math.floor(t / 60000);
      const cur = m.get(k);
      if (cur) cur.count += 1; else m.set(k, { at: r.sentAt, count: 1 });
    }
    return Array.from(m.entries()).sort((a, b) => b[0] - a[0]).map(([, v]) => ({ ...v, state: 'sent' }));
  }, [track]);
  const sentBatchCount = batches.filter((b) => b.state === 'sent').length;
  const scheduledCount = s?.scheduled || 0;
  const nextScheduledAt = batches.filter((b) => b.state === 'scheduled').map((b) => b.at).sort()[0] || null;
  const hours = useMemo(() => {
    const arr = Array.from({ length: 24 }, () => 0);
    for (const h of track?.hourDistribution || []) if (h.hour >= 0 && h.hour < 24) arr[h.hour] = h.cnt;
    return arr;
  }, [track]);
  const maxHour = Math.max(1, ...hours);
  const topHour = hours.indexOf(Math.max(...hours));
  const copy = async (u: string) => { try { await navigator.clipboard.writeText(u); toast.success('주소를 복사했어요.'); } catch { toast.error('복사하지 못했어요.'); } };
  const [urlBusy, setUrlBusy] = useState(false);
  const getUrl = async () => {
    if (urlBusy) return;
    setUrlBusy(true);
    try { const u = await onGetUrl(); if (u) setShortUrl(u); } finally { setUrlBusy(false); }
  };

  return (
    <div className={MK_MODAL_BACKDROP} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${MK_MODAL} w-full max-w-[1060px] max-h-[92vh] flex flex-col md:flex-row overflow-hidden`} role="dialog" aria-label={`${dm.title} 상세`}>
        {/* 왼쪽 */}
        <aside className="md:w-[250px] shrink-0 border-b md:border-b-0 md:border-r border-slate-200 p-5 flex flex-col gap-4 overflow-y-auto mk-scroll">
          <div className="mx-auto w-[150px] rounded-[26px] bg-black p-2 shadow-xl">
            <div className="rounded-[20px] overflow-hidden aspect-[9/16] bg-slate-100">{dm.section_summary?.cover ? <img src={dm.section_summary.cover} alt="" className="w-full h-full object-cover" /> : null}</div>
          </div>
          {dm.short_code && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] text-slate-500">발행 주소</div>
              {shortUrl ? <UrlRow url={shortUrl} onCopy={() => { void copy(shortUrl); }} disabled={status === 'stopped'} /> : (
                <button type="button" onClick={() => { void getUrl(); }} disabled={status === 'stopped' || urlBusy} title={status === 'stopped' ? '중지된 DM이에요. 재개 뒤 받을 수 있어요.' : undefined}
                  className="w-full h-9 rounded-lg bg-slate-100 border border-slate-200 text-[12px] font-semibold text-slate-700 hover:bg-white disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                  {urlBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}주소 복사
                </button>
              )}
              {alias ? <UrlRow url={alias} onCopy={() => { void copy(alias); }} disabled={status === 'stopped'} /> : (
                <button type="button" onClick={onAlias} disabled={status === 'stopped'} className="text-[11.5px] text-violet-700 hover:text-violet-800 disabled:opacity-40">한글 주소 만들기(무료)</button>
              )}
            </div>
          )}
          <dl className="space-y-1.5 text-[12px] border-t border-slate-200 pt-3">
            <Info k="보기 방식" v={dm.catalog ? '책처럼(카탈로그)' : dm.layout_mode === 'slides' ? '옆으로 넘기기' : '세로로 길게'} />
            <Info k="블록" v={`${dm.section_summary?.count ?? 0}개`} />
            <Info k="만든 날" v={fmtDate(dm.created_at || dm.updated_at)} />
            <Info k="마지막 수정" v={fmtDate(dm.updated_at)} />
          </dl>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <button type="button" onClick={onEdit} className={MK_BTN_OUTLINE}><PenLine className="w-4 h-4" />수정</button>
            <button type="button" onClick={onClone} disabled={cloning} className={MK_BTN_OUTLINE}>{cloning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CopyPlus className="w-4 h-4" />}복제</button>
            {status === 'stopped'
              ? <button type="button" onClick={onResume} className={MK_BTN_OUTLINE}><Play className="w-4 h-4" />재개</button>
              : dm.status === 'published' ? <button type="button" onClick={onStop} className={MK_BTN_OUTLINE}><Pause className="w-4 h-4" />중지</button> : <span />}
            <button type="button" onClick={onDelete} className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-rose-700 hover:bg-rose-50"><Trash2 className="w-4 h-4" />삭제</button>
          </div>
        </aside>

        {/* 오른쪽 */}
        <section className="flex-1 min-w-0 flex flex-col p-5 md:p-6 overflow-hidden">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><h3 className="text-[19px] font-bold text-slate-900 truncate">{dm.title || '(제목 없음)'}</h3><StatusChip status={status} /></div>
              <div className="text-[12px] text-slate-500 mt-1">{s && s.sent > 0
                ? `개인화 문자 ${s.sent.toLocaleString()}명 · ${sentBatchCount}번 보냄${scheduledCount > 0 ? ` · 예약 ${scheduledCount.toLocaleString()}명` : ''}`
                : scheduledCount > 0
                  ? `예약 ${scheduledCount.toLocaleString()}명${nextScheduledAt ? ` · ${formatKstMonthDayTime(nextScheduledAt)}에 보내요` : ''}`
                  : '개인화 문자로 보낸 기록이 없어요'}</div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex gap-1 border-b border-slate-200 mt-4">
            {([['perf', '성과'], ['batches', `보낸 기록`], ['people', '받은 사람별'], ...(interactive ? [['responses', '응답']] : [])] as Array<[typeof tab, string]>).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === k ? 'text-slate-900 border-violet-500' : 'text-slate-500 border-transparent hover:text-slate-700'}`}>
                {l}{k === 'batches' && batches.length > 0 && <span className="ml-1.5 text-[10.5px] rounded-md bg-slate-100 px-1.5 py-0.5">{batches.length}</span>}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto mk-scroll pt-4">
            {loading ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
              : tab === 'perf' ? (
                !s || s.sent === 0 ? (
                  <div className="space-y-3">
                    <div className="text-[12.5px] text-slate-500">{scheduledCount > 0
                      ? `예약한 문자가 ${nextScheduledAt ? `${formatKstMonthDayTime(nextScheduledAt)}에 ` : ''}나가면 성과가 쌓여요. 지금은 공용 링크 열람만 보여 드려요.`
                      : '개인화 문자로 보낸 기록이 없어 공용 링크 열람만 보여 드려요.'}</div>
                    <DmPublicLinkStatsPanel dmId={dm.id} />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <Tile k="보냄" v={s.sent} />
                      <Tile k="열람" v={s.viewed} p={pct(s.viewed, s.sent)} />
                      <Tile k="절반 이상 봄" v={s.reached50} p={pct(s.reached50, s.sent)} />
                      <Tile k="클릭" v={s.clicked} p={pct(s.clicked, s.sent)} />
                      <Tile k="구매로 이어짐" v={s.purchased || 0} p={pct(s.purchased || 0, s.sent)} />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <div className="text-[13px] font-bold text-slate-900 mb-3">보낸 뒤 흐름</div>
                        {[['보냄', s.sent], ['열람', s.viewed], ['절반 이상 봄', s.reached50], ['버튼·상품 클릭', s.clicked], ['구매로 이어짐', s.purchased || 0]].map(([k, v]) => (
                          <Bar key={k as string} label={k as string} value={v as number} max={s.sent} />
                        ))}
                        {s.viewed > 0 && (
                          <div className="mt-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2.5 text-[12px] text-slate-700 flex gap-2">
                            <Sparkles className="w-4 h-4 text-fuchsia-700 shrink-0 mt-0.5" />
                            연 사람 10명 중 {Math.round((s.reached50 / s.viewed) * 10)}명이 절반 넘게 봤어요. 버튼과 상품을 누른 사람은 {s.clicked.toLocaleString()}명이에요.
                          </div>
                        )}
                      </div>
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <div className="text-[13px] font-bold text-slate-900 mb-3">많이 멈춘 블록</div>
                        {(track?.sectionExits || []).length === 0 ? <div className="text-[12px] text-slate-400">아직 집계할 열람이 적어요.</div> : (track!.sectionExits!).map((x) => (
                          <Bar key={x.id} label={x.label} value={x.count} max={Math.max(...track!.sectionExits!.map((y) => y.count))} suffix="명" />
                        ))}
                        <div className="text-[13px] font-bold text-slate-900 mt-4 mb-2">열람 시간대</div>
                        <div className="flex items-end gap-[3px] h-[72px]">
                          {hours.map((c, i) => <span key={i} className="flex-1 rounded-t bg-gradient-to-t from-violet-600 to-violet-400" style={{ height: `${Math.max(4, (c / maxHour) * 100)}%`, opacity: c ? 1 : 0.25 }} title={`${i}시 ${c}회`} />)}
                        </div>
                        <div className="flex justify-between text-[10.5px] text-slate-400 mt-1"><span>0시</span><span>12시</span><span>23시</span></div>
                        {Math.max(...hours) > 0 && <div className="text-[11.5px] text-slate-500 mt-1.5">가장 많이 연 시간: {topHour}시</div>}
                      </div>
                    </div>
                  </div>
                )
              ) : tab === 'batches' ? (
                batches.length === 0 ? <Empty text="개인화 문자로 보낸 기록이 없어요." /> : (
                  <div className="space-y-1.5">
                    {track?.batchesTruncated && <p className="text-[12px] text-slate-500 px-1">최근 {batches.length}번 보낸 기록만 보여요.</p>}
                    {batches.map((b, i) => (
                      <div key={`${b.at}-${b.state}-${i}`} className="flex items-center gap-3 h-11 px-4 rounded-xl bg-white">
                        <Send className="w-4 h-4 text-violet-700" />
                        <span className="text-[13px] text-slate-700 flex-1">
                          {formatKstMonthDayTime(b.at)}
                          {BATCH_STATE_LABEL[b.state] && <span className={`ml-1.5 text-[12px] font-semibold ${BATCH_STATE_LABEL[b.state].tone}`}>{BATCH_STATE_LABEL[b.state].text}</span>}
                        </span>
                        <b className="text-[13px] text-slate-900">{b.count.toLocaleString()}명</b>
                      </div>
                    ))}
                    {track?.listTruncated && <div className="text-[11.5px] text-amber-700">받은 사람이 많아 앞쪽 일부로 묶었어요. 전체는 [자세히 보기]에서 볼 수 있어요.</div>}
                  </div>
                )
              ) : tab === 'people' ? (
                (track?.recipients || []).length === 0 ? <Empty text="받은 사람이 없어요." /> : (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="grid grid-cols-[1fr_1fr_70px_70px_60px] gap-2 px-3 py-2 text-[11px] text-slate-400 bg-white"><span>이름</span><span>번호</span><span>열람</span><span>본 만큼</span><span>클릭</span></div>
                    {track!.recipients.slice(0, 100).map((r) => (
                      <div key={r.customerId} className="grid grid-cols-[1fr_1fr_70px_70px_60px] gap-2 px-3 py-2 text-[12px] text-slate-700 border-t border-slate-100">
                        <span className="truncate">{maskName(r.name)}</span><span className="truncate">{maskPhone(r.phone)}</span>
                        <span className={r.viewed ? 'text-emerald-700' : r.sendState === 'scheduled' ? 'text-amber-700' : 'text-slate-400'}>{r.viewed ? '열람' : r.sendState === 'scheduled' ? '예약' : r.sendState === 'cancelled' ? '예약 취소' : r.sendState === 'failed' ? '보내지 못함' : '안 봄'}</span>
                        <span>{r.viewed ? `${Math.round(r.progressPct)}%` : '-'}</span><span>{r.clicks || 0}</span>
                      </div>
                    ))}
                    {(track!.recipientsTotal || 0) > 100 && <div className="px-3 py-2 text-[11.5px] text-slate-400 border-t border-slate-100">앞 100명만 보여요 · 전체 {track!.recipientsTotal!.toLocaleString()}명</div>}
                  </div>
                )
              ) : (
                !resp ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <Tile k="응답" v={resp.total} />
                      <Tile k="참여한 사람" v={Number(resp.stats?.unique_participants) || 0} />
                      <Tile k="당첨" v={resp.winners.length} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" disabled={resp.total === 0} onClick={() => { void downloadAuthFile(`/api/dm/${dm.id}/responses/export`, 'DM응모자.xlsx', (m) => toast.error(m)); }} className={MK_BTN_OUTLINE}>응모자 엑셀 받기</button>
                      <label className={`${MK_BTN_OUTLINE} cursor-pointer ${respBusy === 'import' ? 'opacity-50 pointer-events-none' : ''}`}>
                        {respBusy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}미리 정한 당첨자 올리기
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void importWinners(f); }} />
                      </label>
                      <span className="text-[11px] text-slate-400">엑셀 첫 줄 = 이름 · 전화(꼭) · 이메일 · 등급</span>
                    </div>
                    {resp.winners.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
                        <div className="px-3 py-2 text-[12px] font-semibold text-slate-800 border-b border-slate-100">당첨자 {resp.winners.length}명</div>
                        <table className="w-full text-[12px] text-slate-700">
                          <thead><tr className="text-left text-slate-400"><th className="px-3 py-1.5 font-medium">등수</th><th className="px-3 py-1.5 font-medium">이름</th><th className="px-3 py-1.5 font-medium">전화</th><th className="px-3 py-1.5 font-medium">경품</th><th className="px-3 py-1.5 font-medium">방법</th></tr></thead>
                          <tbody>
                            {resp.winners.map((w) => (
                              <tr key={w.id} className="border-t border-slate-100">
                                <td className="px-3 py-1.5">{w.rank ?? '-'}</td>
                                <td className="px-3 py-1.5">{w.winner_name || '이름 없음'}</td>
                                <td className="px-3 py-1.5 whitespace-nowrap">{w.winner_phone || '-'}</td>
                                <td className="px-3 py-1.5">{w.prize_name || '-'}</td>
                                <td className="px-3 py-1.5 whitespace-nowrap">{WIN_METHOD_LABEL[String(w.win_method)] || '추첨'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {resp.total === 0 ? <Empty text="아직 응답이 없어요." /> : (
                      <div className="space-y-1.5">
                        {resp.rows.map((r) => (
                          <div key={r.id} className="flex items-center gap-3 h-10 px-3 rounded-lg bg-white text-[12px] text-slate-700">
                            <span className="w-[120px] shrink-0 text-slate-500">{new Date(r.occurred_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="truncate flex-1">{maskName(r.customer_name)}</span><span className="text-slate-400">{(SECTION_META as Record<string, { label: string } | undefined>)[r.section_type]?.label || '참여 블록'}</span>
                          </div>
                        ))}
                        {resp.rows.length < resp.total && (
                          <button type="button" onClick={() => { void loadMoreResponses(); }} disabled={respBusy === 'more'} className="w-full h-9 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                            {respBusy === 'more' ? '불러오는 중' : `더 보기 · ${resp.rows.length.toLocaleString()} / ${resp.total.toLocaleString()}건`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-slate-200 flex-wrap">
            <span className="mr-auto text-[10px] text-slate-400 italic">구매 = 발송 뒤 7일 안 주문</span>
            {s && (track?.segments?.unviewed || 0) > 0 && (
              <button type="button" onClick={onResendUnviewed} className={MK_BTN_OUTLINE}><RefreshCw className="w-4 h-4" />안 본 사람에게 다시 보내기 · {(track!.segments!.unviewed || 0).toLocaleString()}명</button>
            )}
            <button type="button" onClick={onResend} disabled={status === 'stopped'} className={MK_BTN_PRIMARY}><Send className="w-4 h-4" />{s && s.sent > 0 ? '다시 보내기' : '보내기'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function UrlRow({ url, onCopy, disabled }: { url: string; onCopy: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 h-9 pl-3 pr-1 rounded-lg bg-slate-100 border border-slate-200">
      <Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-[12px] font-semibold text-slate-900 truncate flex-1">{url.replace(/^https?:\/\//, '')}</span>
      <button type="button" onClick={onCopy} disabled={disabled} title={disabled ? '중지된 DM이에요. 재개 뒤 복사할 수 있어요.' : '복사'} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-slate-600 hover:bg-slate-100 disabled:opacity-30"><Copy className="w-3.5 h-3.5" />복사</button>
    </div>
  );
}
function Info({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-700 font-semibold text-right">{v}</dd></div>;
}
function Tile({ k, v, p }: { k: string; v: number; p?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] text-slate-500">{k}</div>
      <div className="text-[18px] font-extrabold text-slate-900 leading-tight mt-0.5">{v.toLocaleString()}{typeof p === 'number' && <span className="text-[11.5px] font-bold text-violet-700 ml-1.5">{p}%</span>}</div>
    </div>
  );
}
function Bar({ label, value, max, suffix = '' }: { label: string; value: number; max: number; suffix?: string }) {
  const w = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[96px_1fr_64px_48px] items-center gap-2 py-1 text-[12px]">
      <span className="text-slate-500 truncate">{label}</span>
      <span className="h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400" style={{ width: `${Math.max(value > 0 ? 3 : 0, w)}%` }} /></span>
      <b className="text-slate-900 text-right">{value.toLocaleString()}{suffix}</b>
      <span className="text-slate-400 text-right">{max > 0 ? `${Math.round(w * 10) / 10}%` : ''}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="py-14 text-center text-[13px] text-slate-400">{text}</div>;
}
