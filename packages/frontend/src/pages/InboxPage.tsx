/**
 * InboxPage — 상담함(★ 2026-11-14 C133 F5 답장 상담 · 회사 관리자)
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-5 · §18 「배포 D」)
 *
 * 상담 번호로 온 문의가 쌓이는 자리. 왼쪽 = 대화 목록(고객 번호 끝 4자리 · 마지막 한 줄 · 상태) · 오른쪽 = 대화 + 답장 칸.
 *   · 판정은 전부 서버가 한다(utils/inbound-sms). 화면은 서버 값만 그린다.
 *   · 답장 요청 = 나눠 보내기의 시작 요청과 같은 규칙의 기계(utils/split-start): 화면이 만든 id 하나 · **서버에 보낸 요청은 서버의 답으로만 떠난다**
 *     (그 id 의 답장 행을 서버가 돌려줬다 = 나갔거나 접수됐거나 안 나간 것으로 끝났다 · 서버가 그 id 를 닫았다 = 버려졌다).
 *     요청이 떠 있는 동안에는 새 답장을 보낼 수 없다(같은 답장이 두 번 나가지 않는다).
 *   · 화면이 갖는 값은 셋뿐이고 서로 덮지 않는다:
 *       ① 떠 있는 요청(화면에 하나) — 대화 위쪽에 따로 그린다. 지금 열린 대화 · 그 문의의 상태와 무관하게 [다시 확인] · [보내지 않기]가 늘 있다.
 *       ② 적던 글(대화마다 · 고객 번호로) — 대화를 오가도 · 요청이 어떻게 끝나도 그대로 남는다. 답장이 나갔다고 서버가 답했을 때만 지운다.
 *       ③ 서버가 적어 둔 초안 — 따로 담아 두지 않고 지금 읽은 대화에서 그때그때 읽는다(이 화면에서 이미 답한 글까지의 초안은 쓰지 않는다
 *          = 조회가 늦게 닿아도 보낸 초안이 답장 칸에 다시 채워지지 않는다).
 *   · 새 글 = 화면에 있는 동안 30초마다 + 탭으로 돌아올 때. 대화 조회는 가장 나중에 시작한 것의 답만 그린다.
 *   · 열리지 않은 회사 · 담당자 계정에는 이 화면이 없다(서버가 403 · 여기서는 안내 한 줄).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare, Settings, Send, CheckCheck, Bot, UserRound, Loader2, Inbox as InboxIcon, ArrowLeft, TriangleAlert } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import ZoneSegmented from '../components/zone/ZoneSegmented';
import type { ZoneCustomModule } from '../components/zone/zone-color';
import SenderAuthModal from '../components/SenderAuthModal';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import InboxSettingsModal from '../components/inbox/InboxSettingsModal';
import { useSenderAuth } from '../hooks/useSenderAuth';
import { useToast } from '../components/ToastProvider';
import { fetchJson, sendJson, serialRunner } from '../utils/dashboard-live';
import { formatPhoneNumber } from '../utils/formatDate';
import { splitStartMachine, splitStartEmpty, SPLIT_START_FAILED, type SplitStartAnswer, type SplitStartState } from '../utils/split-start';
import { inboxTargets, composeEmpty, composeText, composeTyped, composeSent } from '../utils/inbox-compose';
import { MK_BTN_PRIMARY, MK_BTN_OUTLINE, MK_BTN_GHOST, MK_CARD, MK_TEXTAREA } from '../utils/make-ui';

const INBOX_ZONE: ZoneCustomModule = {
  id: 'inbox', label: '상담함', description: '상담 번호로 온 문의에 답해요', icon: MessagesSquare, gradient: 'from-teal-500 to-emerald-500',
};
const API = '/api/inbox';
const POLL_MS = 30_000;

interface Counts { waiting: number; aiToday: number; human: number; today: number }
interface ThreadRow { key: string; phoneMasked: string; lastBody: string; lastAt: string; lastDirection: 'in' | 'out'; human: number; status: string }
interface Message { id: string; direction: 'in' | 'out'; body: string; status: string; handledBy: string | null; note: string | null; draft: string | null; at: string }
interface Thread { key: string; phone: string; toNumber: string; canReply: boolean; more: boolean; messages: Message[] }
type Filter = 'human' | 'all';
type Entry = { kind: 'loading' } | { kind: 'closed' } | { kind: 'open'; enabled: boolean; numbers: string[] };
/** 보낸 답장 요청 하나 — 어느 고객의 어느 글(그 글이 온 시각)에 무슨 글을. 요청을 만든 순간의 값이고 그 뒤의 편집과 무관하다. 대화는 고객 번호로 가린다 */
interface ReplyAsk { threadKey: string; phone: string; messageId: string; at: string; text: string }
/** 서버의 답장 행 */
interface ReplyRow { id: string; status: string; note: string | null }

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
/** 서버 답의 답장 행(reply)을 상태 기계가 읽는 자리(split)에 싣는다 */
const asReply = (r: SplitStartAnswer): SplitStartAnswer => ({ ...r, body: r.body ? { ...r.body, split: r.body.reply ?? null } : r.body });

const IN_STATUS: Record<string, { text: string; cls: string }> = {
  new: { text: '판정 기다림', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  waiting: { text: '아침에 판정', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  answered: { text: '답함', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  human: { text: '사람 필요', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  done: { text: '닫음', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  optout: { text: '수신거부', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};
const OUT_STATUS: Record<string, string> = { ready: '보내는 중', sending: '보내는 중', sent: '보냄', failed: '안 나감' };

export default function InboxPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const senderAuth = useSenderAuth();
  const [entry, setEntry] = useState<Entry>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('human');
  const [counts, setCounts] = useState<Counts | null>(null);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  /** ② 적던 글(고객 번호마다) · 이 화면에서 답장이 나간 글의 시각 — 규칙은 utils/inbox-compose */
  const [compose, setCompose] = useState(composeEmpty);
  /** 안 나간 답장의 사유 — 그 고객의 대화에서만 보인다 */
  const [note, setNote] = useState<{ phone: string; text: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const filterRef = useRef(filter);
  const keyRef = useRef(activeKey);
  const threadRef = useRef(thread);
  const threadSeq = useRef(0);
  filterRef.current = filter;
  keyRef.current = activeKey;
  threadRef.current = thread;

  const loadEntry = useCallback(async () => {
    const r = await fetchJson(`${API}/status`);
    setEntry(r.ok && r.body?.live === true ? { kind: 'open', enabled: r.body.enabled === true, numbers: (r.body.numbers || []).map(String) } : { kind: 'closed' });
  }, []);
  const loadList = useCallback(async () => {
    const asked = filterRef.current;
    const r = await fetchJson(`${API}/threads?filter=${asked}`);
    if (asked !== filterRef.current || !r.ok || !r.body?.success) return;
    setCounts(r.body.counts as Counts);
    setThreads(r.body.threads as ThreadRow[]);
  }, []);
  /** 대화 조회 — 가장 나중에 시작한 조회의 답만 그린다(늦게 닿은 옛 답이 새 상태를 덮지 않는다) */
  const loadThread = useCallback(async (key: string) => {
    threadSeq.current += 1;
    const seq = threadSeq.current;
    const r = await fetchJson(`${API}/threads/${key}`);
    if (seq !== threadSeq.current || keyRef.current !== key) return;
    setThread(r.ok && r.body?.thread ? (r.body.thread as Thread) : null);
  }, []);
  const refresh = useMemo(() => serialRunner(async () => {
    await loadList();
    if (keyRef.current) await loadThread(keyRef.current);
  }), [loadList, loadThread]);

  // ① 답장 요청의 상태 — 주인은 이 화면 하나(대화를 바꿔도 · 다시 열어도 남는다)
  const replyCur = useRef<SplitStartState<ReplyAsk, ReplyRow>>(splitStartEmpty());
  const [reply, setReply] = useState(replyCur.current);
  /** 서버가 그 답장 행을 돌려준 뒤에 할 일(렌더마다 지금 값으로 갈아 끼운다) */
  const settled = useRef<(row: ReplyRow, ask: ReplyAsk | null) => void>(() => undefined);
  const authRef = useRef(senderAuth);
  const lastAsk = useRef<ReplyAsk | null>(null);
  useLayoutEffect(() => { authRef.current = senderAuth; });
  const [replyOnce] = useState(() => splitStartMachine<ReplyAsk, ReplyRow>(
    { get: () => replyCur.current, set: (s) => { replyCur.current = s; setReply(s); } },
    {
      post: (b) => sendJson(`${API}/messages/${String(b.messageId)}/reply`, { method: 'POST', body: { replyId: b.replyId, text: b.text } }, 30_000).then(asReply),
      read: (id) => fetchJson(`${API}/replies/${id}`).then(asReply),
      discard: (id) => {
        const messageId = replyCur.current.pending?.view.messageId || '';
        return sendJson(`${API}/messages/${messageId}/reply-discard`, { method: 'POST', body: { replyId: id } }).then(asReply);
      },
      senderAuth: (body, retry) => authRef.current.handleResponse(body, retry),
      onStarted: (row) => settled.current(row, lastAsk.current),
    },
  ));
  settled.current = (row, ask) => {
    replyOnce.reopen();                                    // 이 요청은 끝났다 → 다음 답장을 받을 수 있게 처음 상태로
    if (ask && row.status === 'failed') {
      // 안 나간 답장 — 적던 글은 그 대화의 답장 칸에 그대로 있다(고쳐서 다시 보낼 수 있다)
      const text = `답장이 나가지 않았어요. ${row.note || ''}`.trim();
      setNote({ phone: ask.phone, text });
      if (threadRef.current?.phone !== ask.phone) toast.error(text);
    } else if (ask) {
      // 나갔다(또는 접수됐다)고 서버가 답했다 — 이때만 그 대화의 적던 글을 지우고 · 그 글까지의 초안을 다시 쓰지 않는다
      setCompose((c) => composeSent(c, ask.phone, ask.at));
      setNote((n) => (n && n.phone === ask.phone ? null : n));
      toast.success(row.status === 'sent' ? '답장을 보냈어요.' : '답장을 접수했어요. 곧 나가요.');
    }
    void refresh();
  };

  useEffect(() => { void loadEntry(); }, [loadEntry]);
  const open = entry.kind === 'open';
  useEffect(() => {
    if (!open) return;
    setThreads(null);
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const onShow = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, [open, filter, refresh]);

  /** 대화를 연다 — 읽기만 한다(떠 있는 요청 · 적던 글 어느 것도 건드리지 않는다) */
  const openThread = (key: string) => {
    setActiveKey(key); keyRef.current = key;
    setThread(null);
    void loadThread(key);
  };

  /** 답할 글 = 이 대화에서 가장 최근에 받은 글(수신거부한 글 제외) · 닫을 글 = 가장 최근의 「사람 필요」 글(그 앞의 사람 필요 글도 서버가 함께 닫는다) */
  /** ③ 서버가 적어 둔 초안 = 지금 읽은 대화에서 읽는다(이 화면에서 이미 답한 글까지의 것은 쓰지 않는다) */
  const { target, toClose, optedOut, draft } = inboxTargets(thread ? thread.messages : [], thread ? compose.doneAt[thread.phone] : undefined);
  /** 답장 칸의 글 = 적던 글이 있으면 그것 · 없으면 서버의 초안 */
  const text = thread ? composeText(compose, thread.phone, draft) : '';
  const ask = reply.pending;
  const askHere = !!ask && !!thread && ask.view.phone === thread.phone;
  const working = reply.phase.kind === 'busy' || reply.phase.kind === 'closing';

  const send = () => {
    if (!thread || !target || replyCur.current.pending || !text.trim()) return;
    const id = newId();
    if (!id) return;
    const asked: ReplyAsk = { threadKey: thread.key, phone: thread.phone, messageId: target.id, at: target.at, text };
    setCompose((c) => composeTyped(c, asked.phone, asked.text));   // 보낸 글은 서버가 나갔다고 답할 때까지 그 대화의 답장 칸에 그대로 둔다
    setNote(null);
    lastAsk.current = asked;
    replyOnce.open({ id, body: { replyId: id, messageId: asked.messageId, text: asked.text }, view: asked });
    void replyOnce.submit(id);
  };

  const closeTarget = () => {
    if (!thread || !toClose) return;
    const key = thread.key;
    setConfirm({
      mode: 'default', title: '답장 없이 닫을까요?', description: '전화로 답했거나 답이 필요 없는 문의일 때 눌러 주세요. 이 대화의 「사람 필요」 문의가 목록에서 빠져요.', confirmLabel: '닫기',
      onConfirm: async () => {
        const r = await sendJson(`${API}/messages/${toClose.id}/close`, { method: 'POST' });
        if (!r.ok) toast.error(r.body?.error || '닫지 못했어요.');
        if (keyRef.current === key) await loadThread(key);
        void loadList();
      },
    });
  };

  if (entry.kind === 'loading') {
    return <ZoneFrame moduleId={INBOX_ZONE} backTo="/"><div className={`${MK_CARD} p-12 flex justify-center text-slate-400`}><Loader2 className="w-5 h-5 animate-spin" /></div></ZoneFrame>;
  }
  if (entry.kind === 'closed') {
    return (
      <ZoneFrame moduleId={INBOX_ZONE} backTo="/">
        <div className={`${MK_CARD} p-10 text-center`}>
          <InboxIcon className="w-8 h-8 mx-auto text-slate-300" />
          <div className="mt-3 text-[15px] font-bold text-slate-900">지금은 상담함을 쓸 수 없어요</div>
          <div className="mt-1 text-[13px] text-slate-500">상담함은 회사 관리자 계정에서 열려요. 기능이 열려 있는지 관리자에게 확인해 주세요.</div>
          <button type="button" onClick={() => navigate('/')} className={`${MK_BTN_OUTLINE} mt-5`}><ArrowLeft className="w-4 h-4" />처음으로</button>
        </div>
      </ZoneFrame>
    );
  }

  const numbers = entry.numbers;
  // 기계의 기본 문구는 나눠 보내기의 말이다 → 서버가 준 거절 사유만 그대로 쓰고 나머지는 답장의 말로 적는다
  const phaseNote = reply.phase.kind === 'unknown' ? '답장이 나갔는지 확인하지 못했어요. [다시 확인]을 눌러 주세요.'
    : reply.phase.kind === 'error' ? (reply.phase.message === SPLIT_START_FAILED ? '답장을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.' : reply.phase.message)
    : null;
  const threadNote = note && thread && note.phone === thread.phone ? note.text : null;
  return (
    <ZoneFrame
      moduleId={INBOX_ZONE}
      backTo="/"
      kpis={[
        { label: '답 기다림', value: counts ? counts.waiting.toLocaleString() : '—' },
        { label: '자동으로 답함(오늘)', value: counts ? counts.aiToday.toLocaleString() : '—', tone: 'emerald' },
        { label: '사람 필요', value: counts ? counts.human.toLocaleString() : '—', tone: counts && counts.human > 0 ? 'amber' : undefined },
        { label: '오늘 받은 문자', value: counts ? counts.today.toLocaleString() : '—' },
      ]}
      links={[{ label: '설정', icon: Settings, onClick: () => setSettingsOpen(true) }]}
      stamp={{ text: '다시 읽기', onRefresh: () => { void refresh(); } }}
      blocks={[
        ...(numbers.length === 0 ? [{ text: '상담 번호가 아직 연결되지 않았어요. 번호가 연결되면 이 화면에 문의가 쌓여요.', tone: 'amber' as const }] : []),
        ...(numbers.length > 0 && !entry.enabled ? [{ text: '상담이 꺼져 있어요. 켜면 등록한 답변으로 자동 답장하거나 여기서 직접 답할 수 있어요.', actionLabel: '설정 열기', onAction: () => setSettingsOpen(true), tone: 'amber' as const }] : []),
      ]}
    >
      {/* ① 떠 있는 답장 요청 — 보내는 중이 아니면 늘 여기 보인다(지금 열린 대화 · 그 문의의 상태와 무관 = 문의가 수신거부로 바뀌어도 · 대화를 못 읽어도 정리할 수 있다) */}
      {ask && reply.phase.kind !== 'busy' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5" role="status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-amber-900">{formatPhoneNumber(ask.view.phone) || ask.view.phone} 고객에게 보낸 답장을 아직 정리하지 못했어요</div>
              {phaseNote && <div className="mt-0.5 text-[12.5px] font-semibold text-rose-700">{phaseNote}</div>}
              <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-amber-900">{ask.view.text}</div>
              <div className="mt-1.5 text-[11.5px] text-amber-800">정리하기 전에는 새 답장을 보낼 수 없어요. [보내지 않기]를 눌러도 이미 나간 답장이면 나간 것으로 알려 드려요. 적던 글은 그 대화의 답장 칸에 남아 있어요.</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!askHere && <button type="button" onClick={() => openThread(ask.view.threadKey)} className={MK_BTN_GHOST}>그 대화 열기</button>}
              <button type="button" onClick={() => { void replyOnce.leave(); }} disabled={working} className={MK_BTN_OUTLINE}>{reply.phase.kind === 'closing' ? '확인하는 중...' : '보내지 않기'}</button>
              <button type="button" onClick={() => { void replyOnce.submit(); }} disabled={working} className={MK_BTN_PRIMARY}>
                <Send className="w-4 h-4" />{reply.phase.kind === 'unknown' ? '다시 확인' : reply.phase.kind === 'error' ? '다시 보내기' : '보내기'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        {/* 왼쪽 — 대화 목록(모바일에서는 대화를 열면 숨는다) */}
        <div className={`${activeKey ? 'max-lg:hidden' : ''} space-y-3`}>
          <ZoneSegmented<Filter>
            ariaLabel="문의 걸러 보기"
            value={filter}
            onChange={(f) => { setFilter(f); filterRef.current = f; }}
            items={[{ id: 'human', label: '사람 필요', count: counts?.human ?? null }, { id: 'all', label: '전체' }]}
          />
          <div className={`${MK_CARD} overflow-hidden`}>
            {threads === null && <div className="p-8 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            {threads !== null && threads.length === 0 && (
              <div className="p-8 text-center">
                <CheckCheck className="w-7 h-7 mx-auto text-emerald-400" />
                <div className="mt-2 text-[13.5px] font-semibold text-slate-800">{filter === 'human' ? '직접 답해야 하는 문의가 없어요' : '아직 받은 문의가 없어요'}</div>
                {numbers.length > 0 && <div className="mt-1 text-[12px] text-slate-500">문안에 「{formatPhoneNumber(numbers[0])}로 문자 주시면 답해 드려요」를 적어 안내해 보세요.</div>}
              </div>
            )}
            {threads !== null && threads.map((t) => {
              const st = IN_STATUS[t.human > 0 ? 'human' : t.status] || null;
              return (
                <button
                  key={t.key} type="button" onClick={() => openThread(t.key)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors ${activeKey === t.key ? 'bg-teal-50/60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-bold text-slate-900 tabular-nums">{t.phoneMasked}</span>
                    <span className="text-[11.5px] text-slate-400 whitespace-nowrap">{when(t.lastAt)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">{t.lastDirection === 'out' ? '↳ ' : ''}{t.lastBody}</span>
                    {st && <span className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[11px] font-semibold ${st.cls}`}>{st.text}{t.human > 1 ? ` ${t.human}` : ''}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 오른쪽 — 대화 + 답장 칸 */}
        <div className={`${activeKey ? '' : 'max-lg:hidden'} ${MK_CARD} min-h-[420px] flex flex-col`}>
          {!activeKey && (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <MessagesSquare className="w-8 h-8 text-slate-300" />
              <div className="mt-2 text-[13.5px] text-slate-500">왼쪽에서 대화를 고르면 여기에 보여요.</div>
            </div>
          )}
          {activeKey && !thread && <div className="flex-1 flex items-center justify-center p-10 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {activeKey && thread && (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                <button type="button" onClick={() => { setActiveKey(null); keyRef.current = null; setThread(null); }} className={`${MK_BTN_GHOST} lg:hidden !px-2`} aria-label="목록으로"><ArrowLeft className="w-4 h-4" /></button>
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-slate-900 tabular-nums">{formatPhoneNumber(thread.phone) || thread.phone}</div>
                  <div className="text-[11.5px] text-slate-500">상담 번호 {formatPhoneNumber(thread.toNumber) || thread.toNumber}</div>
                </div>
              </div>
              <div className="flex-1 max-h-[52vh] overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/60">
                {thread.more && <div className="text-center text-[11.5px] text-slate-400">가장 최근 문의부터 보여 드려요. 이보다 오래된 글은 여기에 나오지 않아요.</div>}
                {thread.messages.map((m) => (m.direction === 'in' ? (
                  <div key={m.id} className="flex flex-col items-start">
                    <div className="max-w-[82%] rounded-2xl rounded-tl-md bg-white border border-slate-200 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-slate-800 whitespace-pre-wrap break-words">{m.body}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <span>{when(m.at)}</span>
                      {IN_STATUS[m.status] && <span className={`px-1.5 py-0.5 rounded-md border font-semibold ${IN_STATUS[m.status].cls}`}>{IN_STATUS[m.status].text}</span>}
                    </div>
                    {m.note && (m.status === 'human' || m.status === 'optout' || m.status === 'waiting') && <div className="mt-1 max-w-[82%] text-[11.5px] text-amber-700">{m.note}</div>}
                  </div>
                ) : (
                  <div key={m.id} className="flex flex-col items-end">
                    <div className={`max-w-[82%] rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${m.status === 'failed' ? 'bg-rose-50 border border-rose-200 text-rose-900' : 'bg-teal-600 text-white'}`}>{m.body}</div>
                    <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-slate-400">
                      {m.handledBy === 'ai' ? <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3" />자동으로 보냄</span> : <span className="inline-flex items-center gap-1"><UserRound className="w-3 h-3" />직접 보냄</span>}
                      <span>{when(m.at)}</span>
                      <span className={m.status === 'failed' ? 'font-semibold text-rose-600' : ''}>{OUT_STATUS[m.status] || m.status}</span>
                    </div>
                    {m.status === 'failed' && m.note && <div className="mt-1 max-w-[82%] text-right text-[11.5px] text-rose-600">{m.note}</div>}
                  </div>
                )))}
              </div>
              <div className="border-t border-slate-100 p-3">
                {optedOut && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-800">수신거부로 등록한 고객이에요. 답장을 보내지 않아요.</div>}
                {!optedOut && !thread.canReply && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[12.5px] text-slate-600">문자로 답장할 수 없는 번호예요(휴대폰 번호가 아니에요).</div>}
                {!optedOut && thread.canReply && target && (
                  <>
                    {!entry.enabled && <div className="mb-2 flex items-center gap-1.5 text-[12px] text-amber-700"><TriangleAlert className="w-3.5 h-3.5" />상담이 꺼져 있어 답장을 보낼 수 없어요. 설정에서 켜 주세요.</div>}
                    {/* 요청이 떠 있는 동안에는 답장 칸이 잠긴다(보낸 글과 답장 칸의 글이 달라지지 않게 · 정리는 위쪽 띠에서) */}
                    <textarea
                      value={text} rows={3} maxLength={1000} disabled={!!ask}
                      onChange={(e) => { const v = e.target.value; const phone = thread.phone; setCompose((c) => composeTyped(c, phone, v)); setNote(null); }}
                      placeholder="답장을 적어 주세요" aria-label="답장" className={MK_TEXTAREA}
                    />
                    {threadNote && <div className="mt-1.5 text-[12px] font-semibold text-rose-600">{threadNote}</div>}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11.5px] text-slate-500">일반 문자 요금으로 나가요 · 같은 답장은 두 번 나가지 않아요</span>
                      <div className="flex items-center gap-2">
                        {toClose && !ask && <button type="button" onClick={closeTarget} className={MK_BTN_OUTLINE}>답 없이 닫기</button>}
                        <button type="button" onClick={send} disabled={!!ask || !text.trim() || !entry.enabled} className={MK_BTN_PRIMARY}>
                          {askHere && reply.phase.kind === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          {askHere && reply.phase.kind === 'busy' ? '보내는 중' : '보내기'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {settingsOpen && (
        <InboxSettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { void loadEntry(); void refresh(); }}
        />
      )}
      {senderAuth.state && (
        <SenderAuthModal
          state={senderAuth.state} code={senderAuth.code} onCodeChange={senderAuth.setCode} error={senderAuth.error} busy={senderAuth.busy}
          onVerify={senderAuth.verify} onResend={senderAuth.resend} onProceed={senderAuth.cancel} onCancel={senderAuth.cancel}
        />
      )}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </ZoneFrame>
  );
}
