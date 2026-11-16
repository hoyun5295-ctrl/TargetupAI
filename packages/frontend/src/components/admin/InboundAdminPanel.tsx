/**
 * InboundAdminPanel — 답장 상담 운영(★ 2026-11-14 C133 F5 · 슈퍼관리자 탭)
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-3 · §18 「배포 D」 정한 것 7 · 13)
 *
 * 상담 번호(등록 · 회사에 묶기 · 풀기 — 지우기는 없다) · 미배정함(어느 회사로도 붙지 않은 글 → 회사 배정) · 직접 등록(수신 배선 전 시험).
 *   · 판정은 전부 서버(utils/inbound-sms): 한 번호는 한 회사 · 전에 묶였던 번호는 그 회사에만 · 한 번이라도 글을 직접 배정한 번호는 묶을 수 없다.
 *   · 화면은 서버의 거절 문장을 그대로 보여 준다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Plus } from 'lucide-react';
import { fetchJson, sendJson } from '../../utils/dashboard-live';
import { formatPhoneNumber } from '../../utils/formatDate';
import { ADMIN_TABLE, ADMIN_TBODY, ADMIN_TD, ADMIN_TD_FIRST, ADMIN_TH, ADMIN_TH_FIRST, ADMIN_THEAD, ADMIN_TR, AdminDetailItem, AdminDetailModal, AdminLongText, AdminPanel, AdminPill } from './ui/admin-ui';

const API = '/api/admin/inbound';
interface CompanyOption { id: string; company_name: string }
interface NumberRow { number: string; companyId: string | null; companyName: string | null; firstCompanyId: string | null; firstCompanyName: string | null; shared: boolean; note: string | null; createdAt: string }
interface UnassignedRow { id: string; fromMasked: string; toNumber: string; body: string; receivedAt: string; onlyCompanyId: string | null; onlyCompanyName: string | null }
type Pick = { kind: 'bind'; number: NumberRow } | { kind: 'assign'; message: UnassignedRow };

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const BTN = 'px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40';
const BTN_MAIN = 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 inline-flex items-center gap-1.5';
const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-gray-500 outline-none';

export default function InboundAdminPanel({ companies }: { companies: CompanyOption[] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [receiveReady, setReceiveReady] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [newNote, setNewNote] = useState('');
  const [manual, setManual] = useState({ from: '', to: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [pickCompany, setPickCompany] = useState('');
  const [pickNote, setPickNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await fetchJson(`${API}/overview`);
    setLoading(false);
    if (!r.ok || !r.body?.success) { setError(r.status === 503 ? '표가 아직 없습니다(DDL C133-DDL-7 실행 전).' : '불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); return; }
    setNumbers(r.body.numbers || []); setUnassigned(r.body.unassigned || []); setReceiveReady(r.body.receiveReady === true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** 서버에 보내고 · 서버의 문장을 그대로 보여 주고 · 다시 읽는다 */
  const act = async (url: string, body: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true); setNote(null);
    const r = await sendJson(url, { method: 'POST', body });
    setBusy(false);
    if (!r.ok || !r.body?.success) { setNote({ tone: 'bad', text: r.body?.error || '처리하지 못했습니다.' }); return false; }
    setNote({ tone: 'ok', text: done });
    await load();
    return true;
  };

  const openPick = (p: Pick) => {
    setPick(p); setPickNote(null);
    setPickCompany(p.kind === 'assign' ? (p.message.onlyCompanyId || '') : (p.number.firstCompanyId || ''));
  };
  const confirmPick = async () => {
    if (!pick || !pickCompany) return;
    setBusy(true); setPickNote(null);
    const r = pick.kind === 'bind'
      ? await sendJson(`${API}/numbers/bind`, { method: 'POST', body: { number: pick.number.number, companyId: pickCompany } })
      : await sendJson(`${API}/messages/${pick.message.id}/assign`, { method: 'POST', body: { companyId: pickCompany } });
    setBusy(false);
    if (!r.ok || !r.body?.success) { setPickNote(r.body?.error || '처리하지 못했습니다.'); return; }
    setNote({ tone: 'ok', text: pick.kind === 'bind' ? '번호를 회사에 묶었습니다.' : '문의를 회사에 배정했습니다.' });
    setPick(null);
    await load();
  };
  /** 고를 수 있는 회사 — 전에 묶였던 회사가 있으면 그 회사 하나(서버도 그 회사만 받는다) */
  const lockedTo = pick ? (pick.kind === 'bind' ? pick.number.firstCompanyId : pick.message.onlyCompanyId) : null;
  const options = lockedTo ? companies.filter((c) => c.id === lockedTo) : companies;

  return (
    <div className="space-y-4">
      {note && <div className={`rounded-lg border px-4 py-2.5 text-sm ${note.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`} role="status">{note.text}</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{error}</div>}

      <AdminPanel
        title="상담 번호"
        description="한 번호는 한 회사에만 묶습니다. 전에 묶였던 번호는 그 회사에만 다시 묶을 수 있고, 글을 직접 배정한 적이 있는 번호는 어느 회사에도 묶을 수 없습니다(다른 회사 고객의 문의가 섞입니다). 번호는 지울 수 없습니다."
        actions={<button type="button" onClick={() => { void load(); }} disabled={loading} className={BTN}><RefreshCw className={`w-3.5 h-3.5 inline ${loading ? 'animate-spin' : ''}`} /> 다시 읽기</button>}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-end gap-2">
          <label className="block w-48">
            <span className="block text-xs text-gray-500 mb-1">번호</span>
            <input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="0503-0000-0000" className={INPUT} />
          </label>
          <label className="block flex-1 min-w-[180px]">
            <span className="block text-xs text-gray-500 mb-1">메모(선택)</span>
            <input value={newNote} onChange={(e) => setNewNote(e.target.value)} maxLength={100} className={INPUT} />
          </label>
          <button type="button" disabled={busy || !newNumber.trim()} className={BTN_MAIN}
            onClick={async () => { if (await act(`${API}/numbers`, { number: newNumber, note: newNote }, '번호를 등록했습니다.')) { setNewNumber(''); setNewNote(''); } }}>
            <Plus className="w-3.5 h-3.5" />번호 등록
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className={ADMIN_TABLE}>
            <thead className={ADMIN_THEAD}><tr><th className={ADMIN_TH_FIRST}>번호</th><th className={ADMIN_TH}>상태</th><th className={ADMIN_TH}>회사</th><th className={ADMIN_TH}>메모</th><th className={ADMIN_TH}>등록</th><th className={ADMIN_TH} /></tr></thead>
            <tbody className={ADMIN_TBODY}>
              {loading && <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-400"><Loader2 className="w-4 h-4 inline animate-spin" /></td></tr>}
              {!loading && numbers.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-500">등록한 번호가 없습니다. 번호가 하나도 없으면 고객사 화면에 상담 기능이 보이지 않습니다.</td></tr>}
              {!loading && numbers.map((n) => (
                <tr key={n.number} className={ADMIN_TR}>
                  <td className={`${ADMIN_TD_FIRST} font-medium text-gray-900 tabular-nums`}>{formatPhoneNumber(n.number) || n.number}</td>
                  <td className={ADMIN_TD}>
                    {n.companyId ? <AdminPill tone="green">묶임</AdminPill> : n.shared ? <AdminPill tone="amber">직접 배정 전용</AdminPill> : <AdminPill>안 묶임</AdminPill>}
                  </td>
                  <td className={ADMIN_TD}>{n.companyName || (n.firstCompanyName ? `(전에 ${n.firstCompanyName})` : '')}</td>
                  <td className={ADMIN_TD}><AdminLongText text={n.note || ''} max={160} label="메모" /></td>
                  <td className={ADMIN_TD}>{when(n.createdAt)}</td>
                  <td className={`${ADMIN_TD} text-right`}>
                    {n.companyId
                      ? <button type="button" disabled={busy} className={BTN} onClick={() => { void act(`${API}/numbers/unbind`, { number: n.number }, '번호를 풀었습니다. 이 뒤에 들어오는 글은 미배정함으로 갑니다.'); }}>풀기</button>
                      : !n.shared && <button type="button" disabled={busy} className={BTN} onClick={() => openPick({ kind: 'bind', number: n })}>회사에 묶기</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel title={`미배정함 ${unassigned.length ? `(${unassigned.length})` : ''}`} description="어느 회사에도 묶이지 않은 번호로 온 글입니다. 배정하면 그 회사 상담함에 「사람 필요」로 보입니다(자동 답장 없음).">
        <div className="overflow-x-auto">
          <table className={ADMIN_TABLE}>
            <thead className={ADMIN_THEAD}><tr><th className={ADMIN_TH_FIRST}>받은 시각</th><th className={ADMIN_TH}>보낸 번호</th><th className={ADMIN_TH}>받은 번호</th><th className={ADMIN_TH}>글</th><th className={ADMIN_TH} /></tr></thead>
            <tbody className={ADMIN_TBODY}>
              {!loading && unassigned.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-500">미배정 글이 없습니다.</td></tr>}
              {unassigned.map((m) => (
                <tr key={m.id} className={ADMIN_TR}>
                  <td className={ADMIN_TD_FIRST}>{when(m.receivedAt)}</td>
                  <td className={`${ADMIN_TD} tabular-nums`}>{m.fromMasked}</td>
                  <td className={`${ADMIN_TD} tabular-nums`}>{formatPhoneNumber(m.toNumber) || m.toNumber}{m.onlyCompanyName ? <span className="ml-1.5 text-xs text-amber-700">전에 {m.onlyCompanyName}에 묶였던 번호</span> : null}</td>
                  <td className={ADMIN_TD}><AdminLongText text={m.body} max={320} label="받은 글" /></td>
                  <td className={`${ADMIN_TD} text-right`}><button type="button" disabled={busy} className={BTN} onClick={() => openPick({ kind: 'assign', message: m })}>회사로 배정</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel title="직접 등록" description={`수신 배선이 정해지기 전의 시험용입니다. 수신 입구와 같은 길로 저장됩니다. 수신 입구 열쇠(INBOUND_SMS_KEY) = ${receiveReady ? '설정됨' : '비어 있음(입구 닫힘)'}`}>
        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-[180px_180px_1fr_auto] gap-2 items-end">
          <label className="block"><span className="block text-xs text-gray-500 mb-1">보낸 번호(고객)</span><input value={manual.from} onChange={(e) => setManual({ ...manual, from: e.target.value })} placeholder="010-0000-0000" className={INPUT} /></label>
          <label className="block"><span className="block text-xs text-gray-500 mb-1">받은 번호(상담 번호)</span><input value={manual.to} onChange={(e) => setManual({ ...manual, to: e.target.value })} placeholder="0503-0000-0000" className={INPUT} /></label>
          <label className="block"><span className="block text-xs text-gray-500 mb-1">글</span><input value={manual.text} onChange={(e) => setManual({ ...manual, text: e.target.value })} maxLength={2000} className={INPUT} /></label>
          <button type="button" disabled={busy || !manual.from.trim() || !manual.to.trim() || !manual.text.trim()} className={BTN_MAIN}
            onClick={async () => { if (await act(`${API}/manual`, manual, '등록했습니다. 묶인 번호면 그 회사 상담함으로, 아니면 미배정함으로 갑니다.')) setManual({ from: '', to: '', text: '' }); }}>
            등록
          </button>
        </div>
      </AdminPanel>

      {pick && (
        <AdminDetailModal
          title={pick.kind === 'bind' ? '번호를 회사에 묶기' : '문의를 회사에 배정'}
          onClose={() => setPick(null)}
          footer={<><button type="button" onClick={() => setPick(null)} disabled={busy} className={BTN}>취소</button><button type="button" onClick={() => { void confirmPick(); }} disabled={busy || !pickCompany} className={BTN_MAIN}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{pick.kind === 'bind' ? '묶기' : '배정'}</button></>}
        >
          <dl>
            {pick.kind === 'bind'
              ? <AdminDetailItem label="번호">{formatPhoneNumber(pick.number.number) || pick.number.number}</AdminDetailItem>
              : <><AdminDetailItem label="받은 번호">{formatPhoneNumber(pick.message.toNumber) || pick.message.toNumber}</AdminDetailItem><AdminDetailItem label="글">{pick.message.body}</AdminDetailItem></>}
            <AdminDetailItem label="회사">
              <select value={pickCompany} onChange={(e) => setPickCompany(e.target.value)} className={INPUT} aria-label="회사">
                {!lockedTo && <option value="">회사를 고르세요</option>}
                {options.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </AdminDetailItem>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {pick.kind === 'bind'
              ? '한 번 묶은 번호는 다른 회사로 옮길 수 없습니다(그 회사가 고객에게 안내한 번호입니다). 풀기와 같은 회사에 다시 묶기만 됩니다.'
              : lockedTo
                ? '이 번호는 전에 이 회사에 묶였던 번호라 이 회사로만 배정할 수 있습니다.'
                : '이 번호로 온 글을 직접 배정하면, 이 번호는 그때부터 직접 배정 전용이 되어 어느 회사에도 묶을 수 없습니다.'}
          </p>
          {pickNote && <p className="mt-2 text-sm font-medium text-rose-700">{pickNote}</p>}
        </AdminDetailModal>
      )}
    </div>
  );
}
