/**
 * PlannerRecheckPanel — 플래너 당일 재확인 본문 + 버튼(★ 2026-10-18 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2 · §3-3)
 *
 * 휴대폰 링크 화면(PlannerRecheckPage)과 PC 캘린더 할 일 창(PlannerRecheckModal)이 **같은 부품**을 쓴다(화면 두 벌이 갈리지 않게).
 * 본문 · 할 수 있는 일 · 막힌 사유는 전부 서버(buildRecheckView)가 정한다 — 화면은 판정하지 않는다.
 *
 * 흐름: 상황 카드 → 보낼 문안 고르기(새 문안 · 지금 문안) → [고른 문안으로 보내기 · N명] → 확인 창(Harold 1018 ①) → (링크면) 인증번호 → 실행.
 *   그 밖 = [직접 고치기](그 자리 편집 · 검사는 서버 몇 분) · [미루기](행사 기간 안 · 다른 문자 없는 날) · [오늘만 건너뛰기] · [행사 취소](확인 창 · 비환불 고지).
 * ⛔ 확인 창 없이 실행하는 버튼 0 · native dialog 0 · 줄표 0 · 모델명 0.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronDown, Loader2, Pencil, Send, ShieldCheck, SkipForward, XCircle } from 'lucide-react';
import LinkConfirmSheet from '../link/LinkConfirmSheet';
import { plannerDay } from '../../constants/planner-status';
import { won, type RecheckAction, type RecheckView } from './planner-api';

type Ask = null | 'approve' | 'skip' | 'defer' | 'cancel';

const sendsAtText = (v: RecheckView) => (v.sendsAt === 'now' ? '누르면 곧 보내요' : v.sendsAt === 'morning' ? '오늘 오전 8시에 보내요' : `${plannerDay(v.pair.date)} 오전 8시부터 보내요`);

function CopyBox({ text, subject, tone }: { text: string; subject: string; tone: 'slate' | 'rose' | 'emerald' }) {
  const box = tone === 'rose' ? 'bg-rose-50/70 border-rose-200' : tone === 'emerald' ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200';
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed text-slate-900 ${box}`}>
      {subject && <p className="font-extrabold mb-1">{subject}</p>}
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

export default function PlannerRecheckPanel({
  view, mode, busy, onAction,
}: {
  view: RecheckView;
  mode: 'link' | 'pc';
  busy: boolean;
  /** 실행(확인 창을 지난 뒤) — 성공 · 실패 처리는 부모가 한다(링크는 인증번호 요구를 받으면 같은 동작을 다시 보낸다) */
  onAction: (a: RecheckAction) => Promise<void> | void;
}) {
  const defaultChoice: 'proposal' | 'current' = view.proposal.hash ? 'proposal' : 'current';
  const [choice, setChoice] = useState<'proposal' | 'current'>(defaultChoice);
  const [ask, setAsk] = useState<Ask>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.current.rawText);
  const [draftSubject, setDraftSubject] = useState(view.current.subject);
  const [deferTo, setDeferTo] = useState<string>(view.deferDates[0] || '');
  const [dmOpen, setDmOpen] = useState(false);

  // 서버가 새 본문을 주면(검사 끝 · 회차 바뀜) 고른 쪽을 다시 맞춘다 — 고를 수 없게 된 쪽에 머물지 않게
  useEffect(() => {
    if (choice === 'proposal' && !view.proposal.hash && view.current.hash) setChoice('current');
    if (choice === 'current' && !view.current.hash && view.proposal.hash) setChoice('proposal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.proposal.hash, view.current.hash]);
  useEffect(() => { if (!view.deferDates.includes(deferTo)) setDeferTo(view.deferDates[0] || ''); }, [view.deferDates, deferTo]);

  const chosen = choice === 'proposal' ? view.proposal : view.current;
  const canSend = view.actions.approve.ok && !!chosen.hash;
  const people = view.recipients.state === 'known' && view.recipients.count !== null ? `${won(view.recipients.count)}명` : '확인 중';
  const day = view.pair.date === view.today ? '오늘' : plannerDay(view.pair.date);

  const head = useMemo(() => {
    if (view.pair.origin === 'deferred') return `${plannerDay(view.pair.date)}로 미룬 문자예요. 새 날짜 문안을 확인하고 보내기를 정해 주세요.`;
    if (view.pair.origin === 'post_approval') return `${plannerDay(view.pair.date)} 보낼 문자가 실제 모바일 DM 주소를 붙인 검사에서 스팸으로 판정돼 아직 나가지 않아요.`;
    return '오늘 문자가 스팸 검사에 막혀 아직 나가지 않았어요.';
  }, [view.pair.origin, view.pair.date]);

  const proposalNote = view.proposal.state === 'preparing'
    ? '새 문안을 만들고 스팸 검사를 하고 있어요. 몇 분 걸려요.'
    : view.proposal.state === 'unsafe' ? '새 문안이 혜택이나 숫자를 바꿔 쓰지 않았어요. 원래 문안을 직접 고쳐 보내 주세요.'
      : view.proposal.state === 'failed' ? '새 문안을 만들지 못했어요. 원래 문안을 직접 고쳐 보내 주세요.' : '';
  const currentNote = view.current.state === 'blocked' ? '이 문안이 검사에 막혔어요. 고쳐서 보내거나 새 문안을 골라 주세요.'
    : view.current.state === 'pending' ? '고치신 문안을 실제 주소로 검사하고 있어요. 몇 분 걸려요.'
      : view.current.state === 'fail' ? '고치신 문안도 검사를 통과하지 못했어요. 문구를 바꿔 다시 고쳐 주세요.'
        : view.current.state === 'stale' ? '날짜가 바뀌어 이 문안은 그대로 쓸 수 없어요. 새 문안을 고르거나 다시 고쳐 주세요.'
          : view.current.state === 'pass' ? '고치신 문안이 검사를 통과했어요.' : '';

  const choiceCard = (key: 'proposal' | 'current', title: string, body: { text: string; subject: string }, note: string, selectable: boolean, tone: 'slate' | 'rose' | 'emerald') => {
    const on = choice === key && selectable;
    return (
      <button type="button" disabled={!selectable || busy} onClick={() => setChoice(key)} aria-pressed={on}
        className={`w-full text-left rounded-2xl border p-3.5 transition-colors ${on ? 'border-amber-400 ring-2 ring-amber-200 bg-white' : 'border-slate-200 bg-white'} ${selectable ? 'hover:border-amber-300' : 'opacity-90 cursor-default'}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-5 h-5 rounded-full border-2 grid place-items-center shrink-0 ${on ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300'}`}>{on && <Check className="w-3 h-3" strokeWidth={3} />}</span>
          <b className="text-[14px] text-slate-900">{title}</b>
          {selectable && <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" />검사 통과</span>}
        </div>
        {body.text ? <CopyBox text={body.text} subject={body.subject} tone={tone} /> : null}
        {note && <p className={`mt-2 text-[12.5px] leading-snug ${selectable ? 'text-emerald-800' : 'text-slate-600'} flex items-start gap-1.5`}>
          {(key === 'proposal' && view.proposal.state === 'preparing') || (key === 'current' && view.current.state === 'pending')
            ? <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin" /> : null}{note}</p>}
      </button>
    );
  };

  const btnOutline = 'h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-40';
  const reasonLine = (r: string | null) => (r ? <p className="text-[12px] text-slate-500 leading-snug">{r}</p> : null);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3.5">
        <p className="flex items-start gap-2 text-[14px] font-bold text-amber-900"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{head}</p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-amber-900">
          <p>마감 <b className="tabular-nums">{plannerDay(view.deadline.date)} {view.deadline.hour}시</b></p>
          <p>받는 사람 <b className="tabular-nums">{people}</b></p>
          <p className="col-span-2">정하지 않으면 {day} 발송만 건너뛰고{view.nextSend ? ` 다음 발송 ${plannerDay(view.nextSend)}은 그대로 가요` : ' 끝나요'}.</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <p className="text-[13px] font-semibold text-slate-700">보낼 문안을 골라 주세요</p>
        {choiceCard('proposal', '새 문안', view.proposal, proposalNote || '실제 주소를 붙여 검사한 새 문안이에요.', !!view.proposal.hash, 'emerald')}
        {choiceCard('current', view.current.edited ? '고친 문안' : '원래 문안', view.current, currentNote, !!view.current.hash, view.current.state === 'blocked' || view.current.state === 'fail' ? 'rose' : 'slate')}
      </div>

      {view.dm && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <button type="button" onClick={() => setDmOpen((v) => !v)} className="w-full h-11 px-4 flex items-center justify-between text-[13px] font-semibold text-slate-700">
            함께 나가는 모바일 DM 보기<ChevronDown className={`w-4 h-4 transition-transform ${dmOpen ? 'rotate-180' : ''}`} />
          </button>
          {dmOpen && (view.dm.html
            ? <iframe title="모바일 DM 미리보기" srcDoc={view.dm.html} sandbox="" className="w-full bg-white block border-t border-slate-100" style={{ height: 520 }} />
            : <p className="px-4 pb-4 text-[12.5px] text-slate-500">미리보기를 불러오지 못했어요.</p>)}
        </div>
      )}

      {editing ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2.5">
          <p className="text-[13px] font-semibold text-slate-700">문안 직접 고치기</p>
          <input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} maxLength={60} placeholder="제목"
            className="w-full h-10 px-3 rounded-lg border border-slate-300 text-[13.5px] text-slate-900" />
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} maxLength={1000}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-[13.5px] leading-relaxed text-slate-900" />
          <p className="text-[12px] text-slate-500">광고 표시 · 무료 수신거부 번호 · 모바일 DM 주소는 보낼 때 자동으로 붙어요. 저장하면 실제 주소로 다시 검사해요(몇 분).</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setEditing(false); setDraft(view.current.rawText); setDraftSubject(view.current.subject); }} disabled={busy} className={btnOutline}>그만두기</button>
            <button type="button" disabled={busy || !draft.trim()} onClick={async () => { await onAction({ kind: 'edit', text: draft, subject: draftSubject }); setEditing(false); }}
              className="h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}고친 문안 검사받기
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <button type="button" onClick={() => setAsk('approve')} disabled={busy || !canSend}
          className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
          <Send className="w-[17px] h-[17px]" />{choice === 'proposal' ? '새 문안으로' : view.current.edited ? '고친 문안으로' : '이 문안으로'} 보내기 · {people}
        </button>
        {!view.actions.approve.ok ? reasonLine(view.actions.approve.reason) : <p className="text-center text-[12px] text-slate-500">{sendsAtText(view)} · 문안비 {won(view.copyCost)}크레딧은 보낸 뒤 1번</p>}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button type="button" onClick={() => setEditing(true)} disabled={busy || editing || !view.actions.edit.ok} className={btnOutline}><Pencil className="w-4 h-4" />고치기</button>
          <button type="button" onClick={() => setAsk('defer')} disabled={busy || !view.actions.defer.ok} className={btnOutline}><CalendarClock className="w-4 h-4" />미루기</button>
          <button type="button" onClick={() => setAsk('skip')} disabled={busy || !view.actions.skip.ok} className={btnOutline}><SkipForward className="w-4 h-4" />건너뛰기</button>
        </div>
        {!view.actions.edit.ok && mode === 'link' && reasonLine(view.actions.edit.reason)}
        {!view.actions.defer.ok && reasonLine(view.actions.defer.reason)}
        <button type="button" onClick={() => setAsk('cancel')} disabled={busy || !view.actions.cancel.ok}
          className="w-full h-11 rounded-xl border border-rose-200 bg-white text-[13.5px] font-semibold text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
          <XCircle className="w-4 h-4" />행사 취소
        </button>
        {!view.actions.cancel.ok && reasonLine(view.actions.cancel.reason)}
      </div>

      <LinkConfirmSheet
        open={ask === 'approve'}
        title={`${choice === 'proposal' ? '새 문안' : '이 문안'}으로 보낼까요?`}
        rows={[
          { label: '보낼 날', value: `${plannerDay(view.pair.date)} · ${sendsAtText(view)}` },
          { label: '받는 사람', value: people },
          { label: '비용', value: `지금 0 · 보낸 뒤 문안비 ${won(view.copyCost)}크레딧` },
        ]}
        notes={[
          { tone: 'info', text: '보내기 전에는 PC 한줄로에서 행사 승인을 풀거나 행사를 취소해 멈출 수 있어요.' },
          { tone: 'warn', text: '나간 문자는 되돌릴 수 없어요.' },
          ...(mode === 'link' ? [{ tone: 'info' as const, text: '이 휴대폰으로 인증번호를 한 번 받을 수 있어요.' }] : []),
        ]}
        confirmLabel="보내기"
        tone="amber"
        busy={busy}
        onConfirm={async () => { await onAction({ kind: 'approve', choice }); setAsk(null); }}
        onCancel={() => setAsk(null)}
      >
        <CopyBox text={chosen.text} subject={chosen.subject} tone="slate" />
      </LinkConfirmSheet>

      <LinkConfirmSheet
        open={ask === 'skip'}
        title={`${day} 문자를 건너뛸까요?`}
        rows={[{ label: '건너뛸 발송', value: `${plannerDay(view.pair.date)} 문자${view.dm ? ' + 모바일 DM' : ''}` }, { label: '다음 발송', value: view.nextSend ? `${plannerDay(view.nextSend)} 그대로` : '없음' }]}
        notes={[{ tone: 'warn', text: '건너뛴 날 발송은 다시 살릴 수 없어요.' }, { tone: 'info', text: '이 날 문안비는 빠지지 않아요. 담당자에게 알림이 가요.' }]}
        confirmLabel="건너뛰기"
        tone="primary"
        busy={busy}
        onConfirm={async () => { await onAction({ kind: 'skip' }); setAsk(null); }}
        onCancel={() => setAsk(null)}
      />

      <LinkConfirmSheet
        open={ask === 'defer'}
        title="언제로 미룰까요?"
        rows={[{ label: '지금 날짜', value: plannerDay(view.pair.date) }, { label: '행사 기간', value: `${plannerDay(view.event.startsOn)} ~ ${plannerDay(view.event.endsOn)}` }]}
        notes={[
          { tone: 'info', text: '행사 기간 안에서 다른 문자가 없는 날만 고를 수 있어요.' },
          { tone: 'info', text: '새 날짜 문안을 만들어 검사한 뒤 다시 확인 문자를 보내 드려요. 그때 보내기를 눌러야 나가요.' },
        ]}
        confirmLabel={deferTo ? `${plannerDay(deferTo)}로 미루기` : '미루기'}
        tone="primary"
        busy={busy || !deferTo}
        onConfirm={async () => { if (deferTo) { await onAction({ kind: 'defer', toDate: deferTo }); setAsk(null); } }}
        onCancel={() => setAsk(null)}
      >
        <div className="flex flex-wrap gap-1.5">
          {view.deferDates.map((d) => (
            <button key={d} type="button" onClick={() => setDeferTo(d)} aria-pressed={deferTo === d}
              className={`h-10 px-3 rounded-lg border text-[13px] font-semibold tabular-nums ${deferTo === d ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-300 bg-white text-slate-700'}`}>{plannerDay(d)}</button>
          ))}
        </div>
      </LinkConfirmSheet>

      <LinkConfirmSheet
        open={ask === 'cancel'}
        title={`'${view.event.title}' 행사를 취소할까요?`}
        rows={[{ label: '보내지 않을 발송', value: `${view.remaining.length}건` }]}
        notes={[
          { tone: 'warn', text: '남은 발송을 모두 보내지 않아요. 되돌릴 수 없어요.' },
          { tone: 'warn', text: '이미 낸 모바일 DM 발행비 · 메일 완성비는 돌려드리지 않아요.' },
          ...(mode === 'link' ? [{ tone: 'info' as const, text: '이 휴대폰으로 인증번호를 한 번 받을 수 있어요.' }] : []),
        ]}
        confirmLabel="행사 취소"
        tone="danger"
        busy={busy}
        onConfirm={async () => { await onAction({ kind: 'cancel' }); setAsk(null); }}
        onCancel={() => setAsk(null)}
      >
        <ul className="rounded-xl border border-slate-200 px-3.5 py-2.5 space-y-1 text-[12.5px] text-slate-700 tabular-nums">
          {view.remaining.map((r, i) => <li key={`${r.date}-${i}`}>{plannerDay(r.date)} · {r.label}</li>)}
        </ul>
      </LinkConfirmSheet>
    </div>
  );
}
