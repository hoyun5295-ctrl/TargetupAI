/**
 * InboxSettingsModal — 상담함 설정(★ 2026-11-14 C133 F5 답장 상담 · 회사 관리자)
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-4 · §7-5 · §18 「배포 D」)
 *
 * 방식(바로 답장 · 초안만 · 끔) · 답장 발신번호 · 답변 항목 · 하루 상한 · 사람에게 넘길 때 알릴 번호 · 넘김 문장.
 *   · 판정 · 검사 문장은 서버의 답 그대로 보여 준다(utils/inbound-sms saveInboundSettings · saveKbItem).
 *   · 「바로 답장」으로 저장할 때는 그 답장 발신번호로 발신 인증을 지난다(서버가 요구하면 인증 창 → 통과하면 눌렀던 저장이 이어진다).
 *   · AI 는 등록한 답변 항목 가운데 하나를 고르기만 한다 = 나가는 글은 여기 적은 글 그대로다.
 */
import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2, Zap, PenLine, Hand } from 'lucide-react';
import SenderAuthModal from '../SenderAuthModal';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { useSenderAuth } from '../../hooks/useSenderAuth';
import { useToast } from '../ToastProvider';
import { fetchJson, sendJson } from '../../utils/dashboard-live';
import { formatPhoneNumber } from '../../utils/formatDate';
import { MK_MODAL, MK_MODAL_BACKDROP, MK_BTN_PRIMARY, MK_BTN_OUTLINE, MK_BTN_GHOST, MK_INPUT, MK_TEXTAREA, MK_LABEL, MK_HINT } from '../../utils/make-ui';

const API = '/api/inbox';
type Mode = 'auto' | 'draft' | 'off';
interface Settings { enabled: boolean; mode: Mode; replyCallback: string | null; dailyCap: number | null; notifyPhone: string | null; handoffText: string; autoReady: boolean }
interface KbItem { id: string; title: string; body: string; enabled: boolean; sort: number }
interface Limits { kbItems: number; kbTitle: number; kbBody: number; handoff: number; dailyDefault: number; autoFrom: number; autoTo: number }
interface CallbackNumber { id: string; phone: string; label: string; is_default: boolean }

const MODES: Array<{ id: Mode; title: string; body: string; icon: typeof Zap }> = [
  { id: 'auto', title: '바로 답장', body: '등록한 답변에 맞는 문의면 그 글을 바로 보내요. 맞는 답이 없으면 넘김 문장을 보내고 사람에게 넘겨요.', icon: Zap },
  { id: 'draft', title: '초안만', body: '맞는 답변을 골라 답장 칸에 채워 둬요. 확인하고 [보내기]를 눌러야 나가요.', icon: PenLine },
  { id: 'off', title: '직접 답하기', body: '자동으로 고르지 않아요. 상담함에서 직접 답해요.', icon: Hand },
];

export default function InboxSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const senderAuth = useSenderAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [callbacks, setCallbacks] = useState<CallbackNumber[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>('auto');
  const [replyCallback, setReplyCallback] = useState('');
  /** 저장해 둔 답장 발신번호가 지금 목록에 없다(등록이 풀렸다) — 다시 고르라고 알린다 */
  const [callbackGone, setCallbackGone] = useState(false);
  const [dailyCap, setDailyCap] = useState('');
  const [notifyPhone, setNotifyPhone] = useState('');
  const [handoffText, setHandoffText] = useState('');
  const [items, setItems] = useState<KbItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string | null; title: string; body: string; enabled: boolean } | null>(null);
  const [itemBusy, setItemBusy] = useState(false);
  const [itemNote, setItemNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    const [s, c] = await Promise.all([fetchJson(`${API}/settings`), fetchJson('/api/companies/callback-numbers')]);
    setLoading(false);
    if (!s.ok || !s.body?.success) { setLoadError(s.body?.error || '설정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.'); return; }
    const st = s.body.settings as Settings;
    setNumbers((s.body.numbers || []).map(String));
    setLimits(s.body.limits as Limits);
    setItems(s.body.items as KbItem[]);
    setEnabled(st.enabled); setMode(st.mode);
    setDailyCap(st.dailyCap === null ? '' : String(st.dailyCap));
    setNotifyPhone(st.notifyPhone || ''); setHandoffText(st.handoffText || '');
    const list: CallbackNumber[] = c.ok && c.body?.success ? (c.body.numbers || []) : [];
    setCallbacks(list);
    // 서버는 숫자만 적어 둔다 → 목록의 표기(줄표가 든 번호)와 숫자로 맞춰 고른다(값이 목록에 없으면 고른 칸이 다른 번호를 보여 준다)
    const digits = (v: string) => String(v || '').replace(/\D/g, '');
    const saved = st.replyCallback ? list.find((n) => digits(n.phone) === digits(st.replyCallback as string)) : null;
    setCallbackGone(!!st.replyCallback && !saved);
    setReplyCallback(saved?.phone || list.find((n) => n.is_default)?.phone || list[0]?.phone || '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true); setSaveNote(null);
    const r = await sendJson(`${API}/settings`, { method: 'PUT', body: { enabled, mode, replyCallback, dailyCap: dailyCap.trim() === '' ? null : Number(dailyCap), notifyPhone, handoffText } }, 30_000);
    setSaving(false);
    if (r.status === 403 && senderAuth.handleResponse(r.body, () => { void save(); })) return;
    if (!r.ok || !r.body?.success) { setSaveNote(r.body?.error || '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.'); return; }
    toast.success('상담 설정을 저장했어요.');
    onSaved();
    onClose();
  };

  const saveItem = async () => {
    if (!draft || itemBusy) return;
    setItemBusy(true); setItemNote(null);
    const body = { title: draft.title, body: draft.body, enabled: draft.enabled };
    const r = draft.id
      ? await sendJson(`${API}/kb/${draft.id}`, { method: 'PUT', body })
      : await sendJson(`${API}/kb`, { method: 'POST', body });
    setItemBusy(false);
    if (!r.ok || !r.body?.item) { setItemNote(r.body?.error || '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.'); return; }
    const saved = r.body.item as KbItem;
    setItems((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
    setDraft(null);
  };
  const removeItem = (it: KbItem) => setConfirm({
    mode: 'danger', title: '이 답변을 지울까요?', description: `「${it.title}」 답변을 지우면 이 문의에는 자동으로 답하지 않아요.`, confirmLabel: '지우기',
    onConfirm: async () => {
      const r = await sendJson(`${API}/kb/${it.id}`, { method: 'DELETE' });
      if (r.ok) setItems((prev) => prev.filter((x) => x.id !== it.id));
      else toast.error(r.body?.error || '지우지 못했어요.');
    },
  });

  const canAdd = !!limits && items.length < limits.kbItems;
  return (
    <div className={MK_MODAL_BACKDROP} role="dialog" aria-modal="true" aria-label="상담 설정">
      <div className={`${MK_MODAL} w-full max-w-2xl max-h-[90vh] flex flex-col`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div>
            <div className="text-[16px] font-bold text-slate-900">상담 설정</div>
            <div className="mt-0.5 text-[12px] text-slate-500">
              {numbers.length > 0 ? `상담 번호 ${numbers.map((n) => formatPhoneNumber(n) || n).join(' · ')}` : '상담 번호가 아직 연결되지 않았어요'}
            </div>
          </div>
          <button type="button" onClick={onClose} className={`${MK_BTN_GHOST} !px-2`} aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading && <div className="py-10 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {!loading && loadError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">{loadError}</div>}
          {!loading && !loadError && limits && (
            <>
              <section>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                  <span>
                    <span className="block text-[14px] font-bold text-slate-900">상담 켜기</span>
                    <span className={`${MK_HINT} block mt-0.5`}>켜면 상담 번호로 온 문의에 답할 수 있고, 문안 편집기에 「상담 번호 넣기」가 생겨요.</span>
                  </span>
                  <button type="button" role="switch" aria-checked={enabled} aria-label="상담 켜기" onClick={() => setEnabled((v) => !v)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-teal-600' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>
              </section>

              <section>
                <div className={MK_LABEL}>답장 방식</div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                  {MODES.map((m) => {
                    const on = mode === m.id;
                    return (
                      <button key={m.id} type="button" aria-pressed={on} onClick={() => setMode(m.id)}
                        className={`text-left rounded-xl border p-3 transition-colors ${on ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <m.icon className={`w-4 h-4 ${on ? 'text-teal-700' : 'text-slate-400'}`} />
                        <div className="mt-1.5 text-[13.5px] font-bold text-slate-900">{m.title}</div>
                        <div className="mt-1 text-[12px] leading-relaxed text-slate-600">{m.body}</div>
                      </button>
                    );
                  })}
                </div>
                {mode === 'auto' && (
                  <div className="mt-2 text-[12px] leading-relaxed text-slate-500">
                    자동 답장은 {limits.autoFrom}시 ~ {limits.autoTo}시에만 나가요(밤에 온 문의는 아침에 판정해요). 같은 번호에는 하루 3통까지 · 「수신거부」 같은 글에는 답하지 않고 수신거부로 등록해요. 저장할 때 답장 발신번호의 발신 인증을 확인해요.
                  </div>
                )}
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className={MK_LABEL}>답장 발신번호</span>
                  <select value={replyCallback} onChange={(e) => { setReplyCallback(e.target.value); setCallbackGone(false); }} className={`${MK_INPUT} mt-1.5`}>
                    {callbacks.length === 0 && <option value="">등록된 발신번호가 없어요</option>}
                    {callbacks.map((c) => <option key={c.id} value={c.phone}>{c.label ? `${c.phone} (${c.label})` : c.phone}</option>)}
                  </select>
                  {callbackGone && <span className="block mt-1 text-[12px] font-semibold text-rose-600">저장해 둔 답장 발신번호가 지금은 등록돼 있지 않아요. 다시 골라 저장해 주세요.</span>}
                  <span className={`${MK_HINT} block mt-1`}>답장이 이 번호로 나가요. 상담 번호와 다르면 답장 끝에 「이어서 문의하실 때는 상담 번호로」 한 줄이 붙어요.</span>
                </label>
                <label className="block">
                  <span className={MK_LABEL}>하루 자동 처리 상한 <span className={MK_HINT}>(선택)</span></span>
                  <input value={dailyCap} onChange={(e) => setDailyCap(e.target.value.replace(/[^\d]/g, '').slice(0, 5))} inputMode="numeric" placeholder={`비우면 ${limits.dailyDefault}`} className={`${MK_INPUT} mt-1.5`} />
                  <span className={`${MK_HINT} block mt-1`}>하루에 자동으로 판정하는 문의 수예요. 넘으면 사람에게 넘겨요.</span>
                </label>
                <label className="block">
                  <span className={MK_LABEL}>사람에게 넘길 때 알릴 번호 <span className={MK_HINT}>(선택)</span></span>
                  <input value={notifyPhone} onChange={(e) => setNotifyPhone(e.target.value)} inputMode="tel" placeholder="010-0000-0000" className={`${MK_INPUT} mt-1.5`} />
                  <span className={`${MK_HINT} block mt-1`}>직접 답해야 하는 문의가 생기면 문자로 알려요(30분에 한 번).</span>
                </label>
                <label className="block">
                  <span className={MK_LABEL}>넘김 문장</span>
                  <textarea value={handoffText} onChange={(e) => setHandoffText(e.target.value)} rows={2} maxLength={limits.handoff} className={`${MK_TEXTAREA} mt-1.5`} />
                  <span className={`${MK_HINT} block mt-1`}>맞는 답변이 없을 때 고객에게 보내는 글이에요.</span>
                </label>
              </section>

              <section>
                <div className="flex items-center justify-between gap-2">
                  <div className={MK_LABEL}>답변 항목 <span className={MK_HINT}>{items.length} / {limits.kbItems} · 나가는 글은 여기 적은 글 그대로예요</span></div>
                  {canAdd && !draft && <button type="button" disabled={itemBusy} onClick={() => { setItemNote(null); setDraft({ id: null, title: '', body: '', enabled: true }); }} className={MK_BTN_OUTLINE}><Plus className="w-4 h-4" />답변 더하기</button>}
                </div>
                {items.length === 0 && !draft && (
                  <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-[12.5px] leading-relaxed text-slate-600">
                    자주 받는 문의의 답을 적어 두세요. 예) 「영업시간」 평일 10시 ~ 19시에 열어요 / 「주차」 건물 지하에 2시간 무료로 주차할 수 있어요.
                  </div>
                )}
                {/* 답변 하나를 저장하는 동안에는 항목 · 초안 칸이 전부 잠긴다(저장 응답이 그 사이에 연 다른 초안을 지우지 않게) */}
                <fieldset disabled={itemBusy} className="min-w-0">
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {items.map((it) => (
                    <div key={it.id} className={`rounded-xl border p-3 ${it.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" onClick={() => { setItemNote(null); setDraft({ id: it.id, title: it.title, body: it.body, enabled: it.enabled }); }} className="min-w-0 text-left">
                          <div className="truncate text-[13.5px] font-bold text-slate-900">{it.title}{!it.enabled && <span className="ml-1.5 text-[11px] font-semibold text-slate-500">꺼 둠</span>}</div>
                          <div className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words">{it.body}</div>
                        </button>
                        <button type="button" onClick={() => removeItem(it)} className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100" aria-label={`${it.title} 지우기`}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                {draft && (
                  <div className="mt-3 rounded-xl border border-teal-300 bg-teal-50/50 p-3 space-y-2">
                    <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={limits.kbTitle} placeholder="제목(예: 영업시간)" aria-label="답변 제목" className={MK_INPUT} />
                    <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3} maxLength={limits.kbBody} placeholder="고객에게 나갈 답변 글" aria-label="답변 글" className={MK_TEXTAREA} />
                    {itemNote && <div className="text-[12px] font-semibold text-rose-600">{itemNote}</div>}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-teal-900">
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />이 답변 쓰기
                      </label>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setDraft(null)} disabled={itemBusy} className={MK_BTN_GHOST}>취소</button>
                        <button type="button" onClick={() => { void saveItem(); }} disabled={itemBusy || !draft.title.trim() || !draft.body.trim()} className={MK_BTN_PRIMARY}>{itemBusy && <Loader2 className="w-4 h-4 animate-spin" />}답변 저장</button>
                      </div>
                    </div>
                  </div>
                )}
                </fieldset>
              </section>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-slate-200">
          <div className="min-w-0 flex-1 text-[12px] font-semibold text-rose-600">{saveNote}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving} className={MK_BTN_OUTLINE}>닫기</button>
            <button type="button" onClick={() => { void save(); }} disabled={saving || loading || !!loadError} className={MK_BTN_PRIMARY}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}저장</button>
          </div>
        </div>
      </div>
      {senderAuth.state && (
        <SenderAuthModal
          state={senderAuth.state} code={senderAuth.code} onCodeChange={senderAuth.setCode} error={senderAuth.error} busy={senderAuth.busy}
          onVerify={senderAuth.verify} onResend={senderAuth.resend} onProceed={senderAuth.cancel} onCancel={senderAuth.cancel}
        />
      )}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
