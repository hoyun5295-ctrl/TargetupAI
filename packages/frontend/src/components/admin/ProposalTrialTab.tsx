/**
 * ProposalTrialTab — 제안 체험(★ 2026-11-16 C136 배포 나 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §5-4 · §5-5 · §7)
 *
 * 메일로 보낸 제안 페이지를 연 회사가 어디에서 멈췄는지 보고, 기계가 만든 완성본을 직원이 확인해 담당자에게 전달한다.
 *   - 링크별 = 링크 값(src)마다 열람 수 · 로그인한 회사 수(최근 30일).
 *   - 회사별 = 로그인 → 신청 → 제작 → 전달 → 완성본 열람 → 보내기 누름 → 발송(보내기 누름 뒤 직접발송 건수).
 *   - 상세 = 사진 · 한 줄 · 포스터 3 · 모바일 DM · 문안 3(고치기) · 검사 결과 · 발신번호 · 다시 만들기 · 전달 · 도착 알림.
 * 판정 · 제작 · 전달은 서버(utils/proposal-trial.ts). 노출 게이팅은 부모(AdminDashboard)가 「소개 방문 · 시연 요청」과 같은 판정으로 한다.
 * ⛔ 기본 대화상자를 쓰지 않는다(확인 = ConfirmModal) · 이 화면은 발송하지 않는다(완성본은 담당자가 자기 화면에서 보낸다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { ADMIN_TABLE_ONELINE } from './ui/admin-ui';
import { MSG_TYPE_LABEL } from '../../utils/campaign-axis';
import {
  PROPOSAL_STAGES as STAGES, PROPOSAL_NOTIFY_TEXT as NOTIFY_TEXT, proposalStageOf, proposalNotifyState, mergeProposalDrafts, proposalDraftDirty, type ProposalCopyDraft,
} from '../../utils/proposal-admin';

type Spam = 'none' | 'pass' | 'blocked' | 'checking' | 'rejected' | 'unknown';
interface LinkRow { src: string; views: number; companies: number; last_at: string }
interface CompanyRow {
  company_id: string; company_name: string | null; src: string | null; first_open: string | null; last_open: string | null;
  status: 'requested' | 'producing' | 'produced' | 'delivered' | null; requested_at: string | null; produced_at: string | null; delivered_at: string | null;
  opened_at: string | null; used_at: string | null; produce_error: string | null; notify_tries: number | null; notify_tried_at: string | null; notified_at: string | null;
  updated_at: string | null; channel: string | null; sent_after: number;
}
interface Kit {
  title?: string; posters?: Array<{ url: string; assetId: string | null } | null>;
  copies?: Array<{ subject: string; text: string; spam: Spam }>; dm?: { id: string; url: string } | null; callback?: string | null; spamDone?: boolean;
}
interface Detail {
  row: {
    company_id: string; status: CompanyRow['status']; revision: number; brief: string; extra: string | null; channel: string; notify_phone: string | null;
    photo_urls: string[]; kit: Kit; produce_error: string | null; garbage: unknown[]; notify_tries: number; notify_tried_at: string | null; notified_at: string | null;
    requested_at: string;
  };
  producing: boolean;
  callbacks: string[];
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const phoneFmt = (p: string | null | undefined) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d; };
const authHeaders = (json = false): Record<string, string> => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, ...(json ? { 'Content-Type': 'application/json' } : {}) });

const SPAM_TEXT: Record<Spam, string> = { none: '검사 전', pass: '통신사 검사 통과', blocked: '통신사가 막음', checking: '통신사 확인 중(잠시 뒤 검사 다시)', rejected: '보낼 수 없는 글', unknown: '검사하지 못함' };
const SPAM_TONE: Record<Spam, string> = { none: 'text-gray-500', pass: 'text-emerald-700', blocked: 'text-red-700', checking: 'text-amber-700', rejected: 'text-red-700', unknown: 'text-amber-700' };

export default function ProposalTrialTab() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [drafts, setDrafts] = useState<ProposalCopyDraft[]>([]);
  /** 편집 칸을 채울 때의 서버 문안(손댄 칸을 가리는 기준) */
  const baseRef = useRef<ProposalCopyDraft[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = openId;

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/plans/proposal/admin', { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok || !d.success) { setError(d.error || '불러오지 못했습니다.'); return; }
      setError('');
      setLinks(d.links || []);
      setCompanies(d.companies || []);
    } catch {
      setError('불러오지 못했습니다.');
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/plans/proposal/admin/${id}`, { headers: authHeaders() });
      const d = await r.json();
      if (openRef.current !== id) return;   // 그 사이 다른 회사를 열었으면 버린다
      if (!r.ok || !d.success) { setNote(d.error || '불러오지 못했습니다.'); setDetail(null); return; }
      setDetail(d as Detail);
      // 화면의 문안 = 서버의 문안(직원이 손댄 칸만 · 그 서버 값이 그대로일 때만 지킨다) — 읽을 때마다 같은 규칙
      const server: ProposalCopyDraft[] = (d.row.kit.copies || []).map((c: any) => ({ subject: c.subject || '', text: c.text || '' }));
      const base = baseRef.current;
      baseRef.current = server;
      setDrafts((prev) => mergeProposalDrafts(prev, base, server));
    } catch {
      setNote('불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    setDetail(null);
    setNote('');
    setDrafts([]);
    baseRef.current = [];
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);
  // 제작 중이면 10초마다 다시 본다(끝나면 멈춘다)
  const working = detail?.row.status === 'producing';
  useEffect(() => {
    if (!openId || !working) return;
    const t = window.setInterval(() => { void loadDetail(openId); void loadList(); }, 10_000);
    return () => window.clearInterval(t);
  }, [openId, working, loadDetail, loadList]);

  /** 직원 동작 하나 — 도는 동안 단추를 잠그고, 끝나면 목록 · 상세를 다시 읽는다 */
  const act = async (path: string, body: Record<string, unknown>, okText: string) => {
    if (!openId || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await fetch(`/api/plans/proposal/admin/${openId}/${path}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) setNote(d.error || '처리하지 못했습니다.');
      else setNote(d.notice === 'unknown' ? '전달했습니다. 알림 문자는 보냈는지 확인되지 않았습니다.' : d.notice === 'held' ? '지금은 보낼 수 없습니다. 잠시 뒤 다시 확인해 주세요.' : d.notice === 'no_phone' ? '알림 받을 번호가 없습니다.' : okText);
    } catch {
      setNote('처리하지 못했습니다.');
    } finally {
      setBusy(false);
      await loadDetail(openId);
      void loadList();
    }
  };

  const row = detail?.row;
  const kit = row?.kit || {};
  const editable = row?.status === 'produced' && !busy;
  const canStart = !!row && row.status !== 'delivered' && !busy && !detail?.producing;
  const notify = row ? proposalNotifyState(row) : 'before';
  /** 저장하지 않은 문안이 있으면 전달하지 않는다(화면에 보이는 문안과 전달되는 문안이 달라진다) */
  const unsaved = drafts.some((d, i) => proposalDraftDirty(d, kit.copies?.[i]));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">제안 체험</h2>
        <p className="mt-1 text-sm text-gray-500">제안 링크를 연 회사가 어디에서 멈췄는지 봅니다. 확인 대기인 회사는 눌러서 완성본을 확인하고 전달합니다.</p>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between"><b>링크별</b><span className="text-sm text-gray-500">최근 30일</span></div>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${ADMIN_TABLE_ONELINE}`}>
            <thead><tr className="bg-gray-50 text-left text-xs text-gray-500"><th className="px-5 py-2.5">링크 값</th><th className="px-5 py-2.5">열람</th><th className="px-5 py-2.5">로그인한 회사</th><th className="px-5 py-2.5">마지막</th></tr></thead>
            <tbody>
              {links.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">아직 열린 링크가 없습니다</td></tr>}
              {links.map((l) => (
                <tr key={l.src} className="border-t border-gray-100"><td className="px-5 py-3 font-semibold">{l.src}</td><td className="px-5 py-3 tabular-nums">{l.views}</td><td className="px-5 py-3 tabular-nums">{l.companies}</td><td className="px-5 py-3">{fmt(l.last_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap"><b>회사별</b><span className="text-sm text-gray-500">{STAGES.join(', ')}</span></div>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${ADMIN_TABLE_ONELINE}`}>
            <thead><tr className="bg-gray-50 text-left text-xs text-gray-500"><th className="px-5 py-2.5">회사</th><th className="px-5 py-2.5">링크 값</th><th className="px-5 py-2.5">단계</th><th className="px-5 py-2.5">도착 알림</th><th className="px-5 py-2.5">마지막 변화</th></tr></thead>
            <tbody>
              {companies.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">아직 로그인해 제안 페이지를 연 회사가 없습니다</td></tr>}
              {companies.map((c) => {
                const st = proposalStageOf(c);
                const n = proposalNotifyState({ status: c.status, notify_tries: c.notify_tries, notify_tried_at: c.notify_tried_at, notified_at: c.notified_at });
                const on = c.company_id === openId;
                return (
                  <tr
                    key={c.company_id}
                    className={`border-t border-gray-100 ${c.status ? 'cursor-pointer hover:bg-gray-50' : ''} ${on ? 'bg-orange-50' : ''}`}
                    onClick={c.status ? () => setOpenId(on ? null : c.company_id) : undefined}
                    onKeyDown={c.status ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(on ? null : c.company_id); } } : undefined}
                    tabIndex={c.status ? 0 : undefined}
                    aria-expanded={c.status ? on : undefined}
                  >
                    <td className="px-5 py-3 font-semibold">{c.company_name || c.company_id.slice(0, 8)}</td>
                    <td className="px-5 py-3">{c.src || ''}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        {STAGES.map((s, i) => <i key={s} title={s} className={`block w-5 h-1.5 rounded-full ${i < st.done ? 'bg-gray-900' : i === st.done && st.waiting ? 'bg-orange-600' : 'bg-gray-200'}`} />)}
                        <span className={`ml-2 font-semibold ${st.waiting ? 'text-orange-700' : 'text-gray-800'}`}>{st.label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">{c.status ? `${NOTIFY_TEXT[n]}${n === 'sent' ? ` ${fmt(c.notified_at)}` : ''}` : ''}</td>
                    <td className="px-5 py-3">{fmt(c.updated_at || c.last_open)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {openId && row && (
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden" aria-busy={busy}>
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <b>{companies.find((c) => c.company_id === openId)?.company_name || '신청 상세'}</b>
            <span className="text-sm text-gray-500">신청 {fmt(row.requested_at)}, {MSG_TYPE_LABEL[row.channel] || row.channel}{working ? ', 제작 중(10초마다 다시 봅니다)' : ''}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-gray-100 space-y-4 text-sm">
              <div><h4 className="text-xs font-bold text-gray-500 mb-2">올린 사진</h4>
                <div className="grid grid-cols-4 gap-1.5">{row.photo_urls.map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`올린 사진 ${i + 1}`} className="w-full aspect-square object-cover rounded-lg bg-gray-100" /></a>)}</div></div>
              <div><h4 className="text-xs font-bold text-gray-500 mb-1">무엇을 알릴지</h4><p className="font-semibold leading-relaxed break-keep">{row.brief}</p></div>
              {row.extra && <div><h4 className="text-xs font-bold text-gray-500 mb-1">더 필요한 것</h4><p className="font-semibold leading-relaxed break-keep">{row.extra}</p></div>}
              <div><h4 className="text-xs font-bold text-gray-500 mb-1">알림 받을 번호</h4><p className="font-semibold">{phoneFmt(row.notify_phone)}</p></div>
              {row.produce_error && <p role="alert" className="text-sm font-semibold text-red-700 break-keep">제작이 멈췄습니다: {row.produce_error}</p>}
              {row.garbage.length > 0 && <p className="text-xs text-amber-700">지우지 못한 옛 산출물 {row.garbage.length}개(다음 동작 때 다시 지웁니다)</p>}
            </div>
            <div className="p-5 text-sm">
              <h4 className="text-xs font-bold text-gray-500 mb-2">포스터 3장과 모바일 DM</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2].map((i) => {
                  const p = kit.posters?.[i] || null;
                  return (
                    <div key={i}>
                      {p?.url ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={`포스터 ${i + 1}`} className="w-full aspect-[3/4] object-cover rounded-xl bg-gray-100" /></a>
                        : <div className="w-full aspect-[3/4] rounded-xl bg-gray-100 grid place-items-center text-xs text-gray-400">{working ? '만드는 중' : '없음'}</div>}
                      <button type="button" disabled={!canStart} onClick={() => void act('produce', { kind: 'poster', index: i }, '포스터를 다시 만듭니다.')}
                        className="mt-2 w-full h-9 rounded-lg border border-gray-300 text-[13px] font-bold disabled:opacity-40">포스터 {i + 1} 다시 만들기</button>
                    </div>
                  );
                })}
                <div>
                  <div className="w-full aspect-[3/4] rounded-xl bg-gray-50 border border-gray-200 grid place-items-center text-center px-2">
                    {kit.dm?.url ? <a href={kit.dm.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-bold underline underline-offset-2">모바일 DM 열어 보기</a>
                      : <span className="text-xs text-gray-400">{kit.dm === undefined ? (working ? '만드는 중' : '아직 없음') : '만들지 못함'}</span>}
                  </div>
                  <button type="button" disabled={!canStart} onClick={() => void act('produce', { kind: 'dm' }, '모바일 DM 을 다시 만듭니다.')}
                    className="mt-2 w-full h-9 rounded-lg border border-gray-300 text-[13px] font-bold disabled:opacity-40">DM 다시 만들기</button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                {drafts.map((d, i) => {
                  const saved = kit.copies?.[i];
                  const dirty = proposalDraftDirty(d, saved);
                  const spam: Spam = saved?.spam || 'none';
                  return (
                    <div key={i}>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5" htmlFor={`ptt-subject-${i}`}>문안 {i + 1} 제목</label>
                      <input id={`ptt-subject-${i}`} value={d.subject} maxLength={40} disabled={!editable} onChange={(e) => setDrafts((prev) => prev.map((x, y) => (y === i ? { ...x, subject: e.target.value } : x)))}
                        className="w-full h-9 rounded-lg border border-gray-300 px-2.5 text-[13.5px] disabled:bg-gray-50" />
                      <label className="block text-xs font-bold text-gray-700 mt-2 mb-1.5" htmlFor={`ptt-text-${i}`}>문안 {i + 1}</label>
                      <textarea id={`ptt-text-${i}`} aria-describedby={`ptt-spam-${i}`} value={d.text} maxLength={2000} disabled={!editable}
                        onChange={(e) => setDrafts((prev) => prev.map((x, y) => (y === i ? { ...x, text: e.target.value } : x)))}
                        className="w-full h-40 rounded-lg border border-gray-300 px-3 py-2.5 text-[13.5px] leading-relaxed resize-y disabled:bg-gray-50" />
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] font-bold" id={`ptt-spam-${i}`}>
                        <span className={SPAM_TONE[spam]}>{SPAM_TEXT[spam]}</span>
                        {dirty && <button type="button" disabled={!editable} onClick={() => void act('copy', { revision: row.revision, index: i, subject: d.subject, text: d.text }, '문안을 저장했습니다. 검사를 다시 돌려 주세요.')}
                          className="h-8 px-3 rounded-lg bg-gray-900 text-white disabled:opacity-40">저장</button>}
                      </div>
                    </div>
                  );
                })}
                {drafts.length === 0 && <p className="text-gray-400 md:col-span-3">{working ? '문안을 만드는 중입니다' : '아직 문안이 없습니다'}</p>}
              </div>

              <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-2.5 flex-wrap">
                <label className="flex items-center gap-2">발신번호
                  <select value={kit.callback || ''} disabled={!editable || detail.callbacks.length === 0}
                    onChange={(e) => void act('callback', { revision: row.revision, callback: e.target.value }, '발신번호를 바꿨습니다. 검사를 다시 돌려 주세요.')}
                    className="h-10 rounded-lg border border-gray-300 px-2.5 bg-white disabled:bg-gray-50">
                    {!kit.callback && <option value="">{detail.callbacks.length === 0 ? '등록된 번호 없음' : '고르기'}</option>}
                    {detail.callbacks.map((c) => <option key={c} value={c}>{phoneFmt(c)}</option>)}
                  </select>
                </label>
                <button type="button" disabled={!canStart || row.status !== 'produced'} onClick={() => void act('produce', { kind: 'spam' }, '검사를 다시 돌립니다.')} className="h-10 px-4 rounded-lg border border-gray-300 font-bold disabled:opacity-40">검사 다시</button>
                <button type="button" disabled={!canStart} onClick={() => void act('produce', { kind: 'resume' }, '제작을 이어 갑니다.')} className="h-10 px-4 rounded-lg border border-gray-300 font-bold disabled:opacity-40">끊긴 제작 잇기</button>
                <button type="button" disabled={!canStart} className="h-10 px-4 rounded-lg border border-gray-300 font-bold disabled:opacity-40"
                  onClick={() => setConfirm({ mode: 'warning', title: '전체를 다시 만들까요?', description: '지금 포스터, 문안, 모바일 DM 을 지우고 처음부터 다시 만듭니다.', confirmLabel: '다시 만들기', onConfirm: () => act('produce', { kind: 'all' }, '전체를 다시 만듭니다.') })}>전체 다시 제작</button>
                <span className="flex-1" />
                <button type="button" disabled={row.status !== 'produced' || busy || unsaved} className="h-10 px-5 rounded-lg bg-gray-900 text-white font-extrabold disabled:opacity-40"
                  onClick={() => setConfirm({ mode: 'default', title: '담당자에게 전달할까요?', description: '완성본이 담당자 화면에 열리고 알림 문자가 한 통 갑니다. 전달한 뒤에는 고칠 수 없습니다.', confirmLabel: '전달', onConfirm: () => act('deliver', { revision: row.revision }, '전달했습니다. 알림 문자를 보냈습니다.') })}>담당자에게 전달</button>
              </div>

              {unsaved && row.status === 'produced' && <p className="mt-2 text-right text-[13px] font-semibold text-amber-700">저장하지 않은 문안이 있습니다. 저장한 뒤 전달해 주세요.</p>}

              <div className="mt-5 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-500 mb-2">도착 알림</h4>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`font-bold ${notify === 'sent' ? 'text-emerald-700' : notify === 'unknown' ? 'text-amber-700' : 'text-gray-800'}`}>
                    {notify === 'before' ? '전달하면 적어 주신 번호로 문자 한 통이 갑니다' : notify === 'idle' ? '아직 보내지 않았습니다' : notify === 'sending' ? '방금 보냈습니다. 잠시 뒤 결과가 보입니다'
                      : notify === 'unknown' ? '보냈는지 확인되지 않았습니다' : `${fmt(row.notified_at)} ${phoneFmt(row.notify_phone)}`}
                  </span>
                  {notify === 'idle' && <button type="button" disabled={busy} onClick={() => void act('notify', { tries: row.notify_tries }, '알림 문자를 보냈습니다.')} className="h-9 px-3 rounded-lg border border-gray-300 text-[13px] font-bold disabled:opacity-40">알림 보내기</button>}
                  {notify === 'unknown' && <button type="button" disabled={busy} className="h-9 px-3 rounded-lg border border-gray-300 text-[13px] font-bold disabled:opacity-40"
                    onClick={() => setConfirm({ mode: 'warning', title: '알림을 다시 보낼까요?', description: '앞에 보낸 문자가 이미 도착했을 수 있습니다. 다시 보내면 같은 문자가 두 번 갈 수 있습니다.', confirmLabel: '다시 보내기', onConfirm: () => act('notify', { tries: row.notify_tries }, '알림 문자를 다시 보냈습니다.') })}>다시 보내기</button>}
                </div>
              </div>
              {note && <p role="status" className="mt-4 text-sm font-semibold text-gray-900">{note}</p>}
            </div>
          </div>
        </section>
      )}
      {openId && !row && note && <p role="alert" className="text-sm font-medium text-red-600">{note}</p>}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
