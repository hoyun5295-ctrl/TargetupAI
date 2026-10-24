/**
 * PlannerLineAsk — 플래너 한 줄 → 못 읽은 칸만 묻고 버튼 한 번에 담기(★ 2026-10-24 뿌리 대장 R9 · docs/ROOT-LEDGER.md)
 *   질문 모양 = 공용 ZoneQuestion(여정 · 자동 마케팅과 같다) · 질문표 · 답 검증 = 서버(planner-line-read · 화면이 보낸 질문표는 믿지 않는다).
 *   읽은 칸은 「이렇게 담을게요」에 글로 보인다 · 고칠 곳은 담은 뒤 행사 창에서 · 「직접 적기」 = 빈 담기 창.
 *   담기만으로는 아무것도 나가지 않는다(보내기는 늘 행사 확인 · 승인 뒤).
 */
import { useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import ZoneQuestion from '../zone/ZoneQuestion';
import { PLANNER_CHANNEL, plannerDay } from '../../constants/planner-status';
import { plannerApi, plannerErrorText, type PlannerLineRead } from './planner-api';

export default function PlannerLineAsk({ line, read: first, onClose, onDirect, onDone }: {
  line: string;
  read: PlannerLineRead;
  onClose: () => void;
  onDirect: () => void;
  onDone: (saved: { id: string; month: string }) => void;
}) {
  // 담기 때 서버 사정이 바뀌었으면(409 LINE_CHANGED) 서버가 준 새 창으로 바꿔 그린다(남은 질문의 답은 그대로 둔다)
  const [read, setRead] = useState<PlannerLineRead>(first);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [none, setNone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audQ = read.questions.some((q) => q.id === 'audience');
  // 「언제 산 고객」 = 상품 구매자일 때만(전체 고객이면 묻지 않는다)
  const shown = read.questions.filter((q) => q.id !== 'since' || !audQ || (answers.audience || '').startsWith('p:'));
  const setAnswer = (id: string, v: string) => { setAnswers((a) => ({ ...a, [id]: v })); setError(null); };

  const aud = read.audience;
  const rows: Array<[string, string]> = [];
  if (read.title) rows.push(['행사 이름', read.title]);
  if (read.period) rows.push(['기간', `${plannerDay(read.period.startsOn)} ~ ${plannerDay(read.period.endsOn)}`]);
  if (read.benefit) rows.push(['혜택', read.benefit]);
  if (!audQ && aud?.kind === 'all') rows.push(['받는 사람', '전체 고객']);
  if (!audQ && aud?.kind === 'product_buyers') rows.push(['받는 사람', `${aud.terms.map((t) => `「${t}」`).join(' ')}가 든 상품 ${read.buyerNames.length}개를 산 고객`]);
  const channelQ = read.questions.some((q) => q.id === 'channel');
  if (!channelQ && read.sendChannels.length > 0) rows.push(['채널', read.sendChannels.map((c) => PLANNER_CHANNEL[c].label).join(' · ')]);
  // 한 줄에 적었지만 지금 닫혀 있어 빼고 담는 채널(조용히 빼지 않는다)
  const dropped = channelQ ? [] : read.channels.filter((c) => !read.sendChannels.includes(c));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sent: Record<string, string> = {};
      for (const q of shown) {
        if (none[q.id]) sent[q.id] = '';
        else if (answers[q.id] !== undefined) sent[q.id] = answers[q.id];
      }
      const r = await plannerApi<{ id: string; month: string; read?: PlannerLineRead }>('/api/marketing-planner/line-start', { body: { line, answers: sent, askKey: read.askKey } });
      if (!r.ok) {
        if (r.status === 409 && r.data?.code === 'LINE_CHANGED' && r.data?.read) {
          const next = r.data.read as PlannerLineRead;
          const ids = new Set(next.questions.map((q) => q.id));
          setRead(next);
          setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([k]) => ids.has(k))));
          setNone((n) => Object.fromEntries(Object.entries(n).filter(([k]) => ids.has(k))));
        }
        setError(plannerErrorText(r, '행사를 담지 못했어요. 잠시 후 다시 시도해 주세요.'));
        return;
      }
      onDone({ id: r.data.id, month: r.data.month });
    } finally {
      setBusy(false);
    }
  };

  return (
    <JourneyModalShell open onClose={onClose} labelledBy="planner-line-ask-title" panelClassName="w-full md:max-w-[560px] max-h-[92vh]">
      <div className="px-4 md:px-6 h-14 border-b border-slate-200 flex items-center gap-2 shrink-0">
        <h3 id="planner-line-ask-title" className="text-[16px] font-bold tracking-[-0.01em]">행사 담기</h3>
        <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto w-10 h-10 rounded-lg text-slate-500 hover:bg-slate-100 grid place-items-center"><X className="w-[18px] h-[18px]" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
        {rows.length > 0 && (
          <section className="rounded-xl border border-violet-200 bg-violet-50/50 px-3.5 py-3">
            <p className="text-[13px] font-semibold text-violet-900">이렇게 담을게요</p>
            <ul className="mt-2 space-y-1.5">
              {rows.map(([k, v]) => (
                <li key={k} className="flex items-start gap-2 text-[13px]">
                  <span className="w-[64px] shrink-0 text-slate-500">{k}</span>
                  <span className="min-w-0 flex-1 font-semibold text-violet-950 break-words">{v}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {read.unsupported.length > 0 && <p className="text-[12px] text-slate-600">{read.unsupported.join(' · ')}은 아직 플래너에서 보내지 못해요</p>}
        {dropped.length > 0 && <p className="text-[12px] text-slate-600">{dropped.map((c) => PLANNER_CHANNEL[c].label).join(' · ')}은 지금 닫혀 있어 빼고 담아요. 설정을 마치면 행사 창에서 더할 수 있어요</p>}
        {shown.length > 0 && (
          <section className="space-y-4">
            <p className="text-[13px] font-semibold text-slate-800">한 줄에서 못 읽은 것만 여쭤볼게요</p>
            {shown.map((q) => (
              <ZoneQuestion
                key={q.id}
                q={q}
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswer(q.id, v)}
                none={q.noneLabel ? { on: !!none[q.id], toggle: (on) => { setNone((n) => ({ ...n, [q.id]: on })); setError(null); } } : undefined}
              />
            ))}
          </section>
        )}
        {error && <p role="alert" className="text-[13px] text-rose-700">{error}</p>}
        <p className="text-[12px] text-slate-500">담아도 바로 나가지 않아요. 보내기 전에 행사 화면에서 한 번 더 확인해요</p>
      </div>
      <div className="px-4 md:px-6 py-3 border-t border-slate-200 flex items-center gap-2 shrink-0">
        <button type="button" onClick={onDirect} disabled={busy} className="h-11 md:h-10 px-3.5 rounded-xl border border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50">직접 적기</button>
        <button type="button" onClick={() => { void submit(); }} disabled={busy}
          className="ml-auto h-11 md:h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[13.5px] font-semibold inline-flex items-center gap-1.5">
          {busy && <LoaderCircle className="w-4 h-4 animate-spin" />}담기
        </button>
      </div>
    </JourneyModalShell>
  );
}
