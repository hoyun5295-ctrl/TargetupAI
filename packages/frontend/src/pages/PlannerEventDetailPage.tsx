/**
 * PlannerEventDetailPage — 행사 상세 = 로그인판 확인 화면 (★ 2026-10-04 보강 · 설계서 §5-4 · 목업 v2 (라))
 *
 * 본문(보낼 내용 · 승인 확인 창)은 휴대폰 확인 화면과 같은 부품(PlannerConfirmView)이다.
 * 왼쪽 = 행사 · 보낼 순서(누르면 그 칸으로) · 이 행사 비용(합계를 사용자가 더하지 않는다) / 오른쪽 = 보낼 내용.
 * 확정 바 = 승인 전 [승인하기 · N크레딧](잔액 변화 큰 줄 · 비환불·되돌림 작은 줄) / 승인 뒤 [승인 풀기](첫 발송 전) / 첫 발송 뒤 = 남은 발송 안내.
 * 고치기는 고칠 내용 옆에만(문안 = 시트 · 모바일 DM·메일 = 편집기). 행사 취소는 ⋯ 메뉴.
 * ⛔ 승인은 화면이 본 지문(fingerprint)과 표시 금액을 함께 보낸다 — 그 사이 바뀌었으면 서버가 409로 막고 화면이 다시 읽는다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, CircleCheck, Lock, Pencil, RotateCcw, Send, ShieldCheck, TriangleAlert } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ApproveBody, ConfirmSummary, ConfirmTimeline, CopyEditDialog, CostCard, DeadlineLine, recipientsText } from '../components/planner/PlannerConfirmView';
import { PLANNER_SEND_KIND, plannerDay, plannerRange, plannerStateOf } from '../constants/planner-status';
import { plannerApi, plannerErrorText, won, type ConfirmSend, type ConfirmView } from '../components/planner/planner-api';

const kstClock = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const k = new Date(t + 9 * 3600 * 1000).toISOString();
  return `${plannerDay(k.slice(0, 10))} ${k.slice(11, 16)}`;
};

export default function PlannerEventDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');
  const [view, setView] = useState<ConfirmView | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'fail' | 'pending'>('loading');
  const [loadedAt, setLoadedAt] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<ConfirmSend | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    const r = await plannerApi<ConfirmView>(`/api/marketing-planner/events/${encodeURIComponent(id)}/confirm-view`);
    if (r.ok) {
      setView(r.data);
      setState('ok');
      setLoadedAt(`${kstClock(new Date().toISOString())} 기준`);
      return;
    }
    if (r.status === 404) { setState('missing'); return; }
    if (r.status === 503 && r.data?.code === 'DB_MIGRATION_PENDING') { setState('pending'); return; }
    setState('fail');
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // 고친 문안 검사 중이면 잠시 뒤 조용히 다시 읽는다(검사 수 분 · 결과가 화면에 오게)
  useEffect(() => {
    if (!view || !view.sends.some((s) => s.sms?.spam === 'pending')) return;
    const t = setInterval(() => { void load(true); }, 30000);
    return () => clearInterval(t);
  }, [view, load]);

  const approve = async () => {
    if (!view) return;
    setWorking(true);
    const r = await plannerApi(`/api/marketing-planner/events/${encodeURIComponent(id)}/approve`, { body: { seenHash: view.fingerprint, shownTotal: view.quote?.total ?? 0 } });
    setWorking(false);
    setApproveOpen(false);
    if (r.ok) {
      toast.success('승인했어요. 정해진 날 오전 8시에 그대로 나가요.');
      void load(true);
      return;
    }
    if (r.status === 402) toast.error('크레딧이 부족해요. 충전한 뒤 다시 승인해 주세요.');
    else toast.error(plannerErrorText(r, '승인하지 못했어요. 다시 시도해 주세요.'));
    void load(true);
  };
  const unapprove = () => setConfirm({
    mode: 'warning', title: '승인을 풀까요?',
    description: '첫 발송 전이라 풀 수 있어요. 고친 뒤 다시 승인해도 같은 비용이 두 번 빠지지 않아요.',
    confirmLabel: '승인 풀기', cancelLabel: '그대로 두기',
    onConfirm: async () => {
      setConfirm(null);
      const r = await plannerApi(`/api/marketing-planner/events/${encodeURIComponent(id)}/unapprove`, { body: {} });
      if (r.ok) toast.success('승인을 풀었어요. 고친 뒤 다시 승인해 주세요.');
      else toast.error(plannerErrorText(r, '승인을 풀지 못했어요.'));
      void load(true);
    },
  });
  const cancelEvent = () => setConfirm({
    mode: 'danger', title: '이 행사를 취소할까요?',
    description: '남은 발송은 모두 나가지 않아요. 승인 때 낸 모바일 DM 발행비·메일 완성비는 돌려드리지 않아요.',
    confirmLabel: '행사 취소', cancelLabel: '돌아가기',
    onConfirm: async () => {
      setConfirm(null);
      const r = await plannerApi(`/api/marketing-planner/events/${encodeURIComponent(id)}/cancel`, { body: {} });
      if (r.ok) { toast.success('행사를 취소했어요. 남은 발송은 나가지 않아요.'); navigate('/marketing-planner'); return; }
      toast.error(plannerErrorText(r, '행사를 취소하지 못했어요.'));
      void load(true);
    },
  });
  const resume = async (s: ConfirmSend) => {
    const r = await plannerApi(`/api/marketing-planner/touchpoints/${encodeURIComponent(s.touchpointIds[0])}/resume`, { body: {} });
    if (r.ok) toast.success('다시 시작했어요. 예정일이면 곧 나가요.');
    else toast.error(plannerErrorText(r, '다시 시작하지 못했어요.'));
    void load(true);
  };

  const ev = view?.event;
  const st = ev ? plannerStateOf(ev.displayState) : null;
  const sentCount = view ? view.sends.filter((s) => s.status === 'sent').length : 0;
  const pending = view ? view.sends.filter((s) => s.status !== 'sent' && s.status !== 'skipped') : [];
  const nextSend = pending[0] || null;
  const held = view ? view.sends.find((s) => s.status === 'hold_credit' || s.status === 'locked') : null;
  const review = ev?.displayState === 'review';
  const approved = !!view?.approved && ev?.status !== 'cancelled';
  const total = view?.quote?.total ?? 0;
  const smsSend = view?.sends.find((s) => s.kind !== 'email');
  const mailSend = view?.sends.find((s) => s.kind === 'email');

  const commitBar = !view || !ev ? undefined
    : review ? (
      <>
        <span className="hidden sm:grid w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 place-items-center shrink-0"><ShieldCheck className="w-[18px] h-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] sm:text-[15px] font-bold tabular-nums">{view.balance !== null ? `승인하면 보유 크레딧 ${won(view.balance)} → ${won(view.balance - total)}` : `승인하면 ${won(total)}크레딧이 빠져요`}</p>
          <p className="text-[12.5px] text-slate-600 mt-0.5 hidden sm:block">모바일 DM 발행비·메일 완성비는 돌려드리지 않아요 · 첫 발송 전까지 승인을 풀 수 있고, 다시 승인해도 두 번 빠지지 않아요</p>
        </div>
        {phone && smsSend?.sms?.editable && <button type="button" onClick={() => setEditing(smsSend)} className="h-12 px-3 rounded-[10px] border border-slate-300 text-[13px] font-semibold text-slate-700">문안 고치기</button>}
        <button type="button" disabled={working || view.sends.some((s) => s.sms && s.sms.spam !== 'pass')} onClick={() => setApproveOpen(true)}
          className="h-12 sm:h-11 px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[14.5px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
          <Check className="w-4 h-4" />승인하기<span className="font-semibold text-indigo-100 text-[13px]">· {won(total)}크레딧</span>
        </button>
      </>
    )
      : approved && sentCount === 0 && !held ? (
        <>
          <span className="hidden sm:grid w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 place-items-center shrink-0"><CircleCheck className="w-[18px] h-[18px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] sm:text-[15px] font-bold tabular-nums">승인됨{nextSend ? ` · ${plannerDay(nextSend.scheduledOn)} 오전 ${view.sendHour}시부터 그대로 나가요` : ''}</p>
            <p className="text-[12.5px] text-slate-600 mt-0.5 hidden sm:block">첫 발송 전까지 승인을 풀 수 있어요 · 풀고 고친 뒤 다시 승인해도 같은 비용이 두 번 빠지지 않아요</p>
          </div>
          <button type="button" onClick={unapprove} className="h-11 px-4 rounded-[10px] border border-slate-300 bg-white hover:bg-slate-50 text-[13.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5"><RotateCcw className="w-4 h-4 text-slate-500" />승인 풀기</button>
        </>
      )
        : held ? (
          <>
            <span className="hidden sm:grid w-9 h-9 rounded-xl bg-amber-50 text-amber-600 place-items-center shrink-0"><TriangleAlert className="w-[18px] h-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] sm:text-[15px] font-bold tabular-nums">{plannerDay(held.scheduledOn)} 발송이 멈춰 있어요</p>
              <p className="text-[12.5px] text-slate-600 mt-0.5">{held.lockReason || '사유를 확인한 뒤 다시 시작해 주세요.'}</p>
            </div>
            <button type="button" onClick={() => { void resume(held); }} className="h-11 px-4 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[13.5px] font-bold">다시 시작</button>
          </>
        )
          : approved && sentCount > 0 ? (
            <>
              <span className="hidden sm:grid w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 place-items-center shrink-0"><Send className="w-[18px] h-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] sm:text-[15px] font-bold tabular-nums">{sentCount}번 나갔어요{nextSend ? ` · 남은 발송 ${plannerDay(nextSend.scheduledOn)} 오전 ${view.sendHour}시 ${PLANNER_SEND_KIND[nextSend.kind].label}` : ''}</p>
                <p className="text-[12.5px] text-slate-600 mt-0.5">첫 발송이 나가 승인은 풀 수 없어요{nextSend ? ' · 남은 발송을 멈추려면 위 ⋯ 메뉴의 행사 취소' : ''}</p>
              </div>
            </>
          ) : undefined;

  const kpis = !view || !ev ? [{ label: '상태', value: state === 'loading' ? '불러오는 중' : '확인 불가' }] : [
    { label: '상태', value: st?.label || '', tone: ev.displayState === 'approved' || ev.displayState === 'done' ? 'emerald' as const : ev.displayState === 'cancelled' ? undefined : 'amber' as const },
    { label: sentCount > 0 ? '다음 발송' : '첫 발송', value: nextSend ? `${plannerDay(nextSend.scheduledOn)} 오전 ${view.sendHour}시` : '남은 발송 없음' },
    { label: '받는 사람', value: [smsSend ? `문자 ${recipientsText(smsSend.recipients)}` : '', mailSend ? `메일 ${recipientsText(mailSend.recipients)}` : ''].filter(Boolean).join(' · ') || '없음' },
  ];

  const note = !view || !ev ? undefined
    : approved ? <span className="text-[13.5px] text-slate-600"><b className="text-emerald-800">{kstClock(view.approved!.at)} 승인</b> · 승인 뒤에는 읽기 전용이에요. 승인 뒤 내용이 바뀌면 그 발송은 멈추고 다시 확인을 요청해요</span>
      : review ? <span className="text-[13.5px] text-slate-600"><DeadlineLine view={view} className="font-bold text-amber-800 mr-2" />아래가 그대로 나갈 내용이에요</span>
        : ev.displayState === 'cancelled' ? <span className="text-[13.5px] text-slate-600">취소한 행사예요. 남은 발송은 나가지 않아요</span>
          : ev.displayState === 'done' ? <span className="text-[13.5px] text-slate-600">모든 발송이 끝났어요. 아래에 실제 결과가 있어요</span>
            : <span className="text-[13.5px] text-slate-600">완성본과 문자 문안을 준비하고 있어요. 준비되면 휴대폰으로 확인 요청이 가요</span>;

  return (
    <ZoneFrame
      moduleId="planner"
      sub={ev?.title || null}
      backTo="/marketing-planner"
      kpis={kpis}
      links={view?.preview ? [{ label: `확인 링크 ${kstClock(view.preview.issuedAt)} 보냄`, icon: Send, onClick: () => toast.info('확인 링크는 담당자 휴대폰으로 보냈어요. 이 화면과 같은 내용이에요.') }] : []}
      stamp={{ text: loadedAt || '다시 읽기', onRefresh: () => { void load(); }, loading: state === 'loading' }}
      more={ev ? [
        ...(ev.editable ? [{ label: '행사 고치기', icon: Pencil, onClick: () => navigate(`/marketing-planner?month=${ev.startsOn.slice(0, 7)}&edit=${ev.id}`) }] : []),
        ...(ev.status !== 'cancelled' && ev.displayState !== 'done' ? [{ label: '행사 취소', onClick: cancelEvent, danger: true, divider: ev.editable }] : []),
      ] : undefined}
      command={note ? { note } : null}
      blocks={[
        ...(state === 'fail' ? [{ text: '행사 내용을 불러오지 못했어요.', actionLabel: '다시 읽기', onAction: () => { void load(); }, tone: 'rose' as const }] : []),
        ...(state === 'missing' ? [{ text: '이 행사를 찾을 수 없어요. 지워졌거나 볼 수 있는 계정이 아니에요.', actionLabel: '캘린더로', onAction: () => navigate('/marketing-planner') }] : []),
        ...(state === 'pending' ? [{ text: '플래너 준비 작업이 진행 중이에요. 몇 분 뒤 다시 읽어 주세요.', actionLabel: '다시 읽기', onAction: () => { void load(); } }] : []),
      ]}
      commitBar={commitBar}
    >
      {view && ev && (phone ? (
        <div className="space-y-4">
          <div>
            {st && <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[12px] font-semibold ${st.badge}`}><st.icon className="w-[13px] h-[13px]" />{st.label}</span>}
            <h2 className="text-[22px] font-bold tracking-[-0.02em] mt-2 leading-tight">{ev.title}</h2>
            <p className="text-[13.5px] text-slate-600 tabular-nums mt-0.5">{plannerRange(ev.startsOn, ev.endsOn)}</p>
            <ConfirmSummary view={view} />
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 px-4 pt-5 pb-1">
            <div className="flex items-baseline gap-2 mb-4"><h3 className="text-[17px] font-bold">보낼 내용 {view.sends.length}번</h3><span className="text-[12.5px] text-slate-600">나가는 순서대로</span></div>
            <ConfirmTimeline view={view} mode="phone" />
            <p className="text-[10px] text-slate-500 italic pb-4">Data source: {view.dataSource}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6 items-start">
          <aside className="col-span-4">
            <div className="sticky top-4 rounded-2xl bg-white border border-slate-200 shadow-sm divide-y divide-slate-100">
              <section className="p-5">
                <h3 className="text-[18px] font-bold">{ev.title}</h3>
                <p className="text-[13px] text-slate-600 tabular-nums">{plannerRange(ev.startsOn, ev.endsOn)}</p>
                {ev.benefitText && (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
                    <p className="text-[12px] text-slate-600 inline-flex items-center gap-1"><Lock className="w-[11px] h-[11px] text-violet-600" />혜택(적은 그대로)</p>
                    <p className="text-[14px] font-semibold mt-0.5">{ev.benefitText}</p>
                  </div>
                )}
              </section>
              <section className="p-3">
                <h3 className="px-2 pt-2 pb-1 text-[12.5px] font-semibold text-slate-600">보낼 순서</h3>
                <ol>
                  {view.sends.map((s, i) => {
                    const done = s.status === 'sent';
                    const isNext = s === nextSend;
                    return (
                      <li key={s.key}>
                        <a href={`#send-${i + 1}`} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 ${isNext ? 'bg-indigo-50/70' : ''}`}>
                          <span className={`w-6 h-6 rounded-full ${done ? 'bg-emerald-600' : isNext ? 'bg-indigo-600' : 'bg-slate-900'} text-white text-[12px] font-bold grid place-items-center tabular-nums`}>{done ? <Check className="w-3 h-3" /> : i + 1}</span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold tabular-nums">{plannerDay(s.scheduledOn)} {PLANNER_SEND_KIND[s.kind].label}</span>
                            <span className="block text-[12px] text-slate-600 tabular-nums">{recipientsText(s.recipients)}{done ? ' · 보냄' : isNext ? ' · 다음 발송' : s.status === 'skipped' ? ' · 생략' : ''}</span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </section>
              <section className="p-5">
                <h3 className="text-[12.5px] font-semibold text-slate-600">이 행사 비용</h3>
                <CostCard view={view} />
                <p className="text-[10px] text-slate-500 italic mt-2">Data source: 금액은 서버 견적과 크레딧 차감 기록입니다.</p>
              </section>
            </div>
          </aside>
          <div className="col-span-8">
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm px-7 pt-7 pb-2">
              <div className="flex items-baseline gap-2 mb-6"><h2 className="text-[18px] font-bold">보낼 내용 {view.sends.length}번</h2><span className="text-[13px] text-slate-600">나가는 순서대로 · 휴대폰 확인 화면과 같은 본문</span></div>
              <ConfirmTimeline
                view={view}
                mode="pc"
                onEditCopy={ev.editable ? (s) => setEditing(s) : undefined}
                onEditDm={ev.editable ? (dmId) => navigate(`/dm-builder?id=${encodeURIComponent(dmId)}&plannerEvent=${encodeURIComponent(ev.id)}`) : undefined}
                onEditEmail={ev.editable ? (cid) => navigate(`/email-campaigns?edit=${encodeURIComponent(cid)}`) : undefined}
              />
              <p className="text-[10px] text-slate-500 italic pb-5">Data source: {view.dataSource}</p>
            </div>
          </div>
        </div>
      ))}
      {approveOpen && view && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-slate-900/50 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="승인 확인">
          <div className="w-full md:w-[480px] bg-white rounded-t-[24px] md:rounded-2xl border border-slate-200 shadow-2xl px-5 md:px-6 pt-3 md:pt-6 pb-6">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-4 md:hidden" />
            <ApproveBody view={view} />
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setApproveOpen(false)} disabled={working} className="h-12 md:h-11 px-5 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 text-[13.5px] font-semibold text-slate-700">취소</button>
              <button type="button" onClick={() => { void approve(); }} disabled={working} className="flex-1 md:flex-none h-12 md:h-11 px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
                <Check className="w-4 h-4" />{working ? '승인하는 중' : '승인하기'}<span className="font-semibold text-indigo-100 text-[13px]">· {won(total)}크레딧</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && view && (
        <CopyEditDialog send={editing} eventId={view.event.id} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.success('문안을 저장했어요. 스팸 검사가 끝나면 다시 승인할 수 있어요.'); void load(true); }}
          onError={(m) => toast.error(m)} />
      )}
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </ZoneFrame>
  );
}
