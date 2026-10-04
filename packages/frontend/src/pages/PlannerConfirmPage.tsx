/**
 * PlannerConfirmPage — 담당자 휴대폰 확인 화면 (★ 2026-10-04 보강 · 설계서 §5-3 · 목업 v2 (다) · 공개 · 인증 X)
 *
 * 확인 요청 문자의 주소(`/planner-confirm#t=토큰`)가 여는 화면이다. 휴대폰이 기본이라 한 컬럼으로 그린다.
 * 본문은 PC 행사 상세와 같은 부품(PlannerConfirmView).
 *
 * ⛔ 토큰은 주소의 # 뒤에만 있다(useApproveToken이 읽는 즉시 주소에서 지운다) · 서버에는 요청 **본문**으로만 보낸다.
 * ⛔ 토큰은 미리보기 권한이다 — 승인은 로그인한 계정만(D3). 하단 바는 **로그인 여부에 따라 처음부터 다르다**(★1004 개정):
 *    로그인 없음 = "승인은 PC 한줄로 '할 일'에서" + [이 휴대폰에서 로그인하고 승인](PC 접속은 끊김 고지) ·
 *    로그인 있음(그 행사를 볼 수 있는 계정) = 잔액 변화 + [문안 고치기][승인하기 · N크레딧].
 * ⛔ 공개 본문에는 잔액이 없다(서버가 싣지 않는다). 무로그인 화면 3종 공통 고지.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CalendarDays, Check, Link2Off, Loader2, Monitor } from 'lucide-react';
import { useApproveToken } from '../hooks/useApproveToken';
import { useAuthStore } from '../stores/authStore';
import { rememberLoginReturn } from '../utils/login-return';
import { useToast } from '../components/ToastProvider';
import { ApproveBody, ConfirmSummary, ConfirmTimeline, CopyEditDialog } from '../components/planner/PlannerConfirmView';
import { plannerDay, plannerRange, plannerStateOf } from '../constants/planner-status';
import { plannerApi, plannerErrorText, won, type ConfirmSend, type ConfirmView } from '../components/planner/planner-api';

const PUBLIC_NOTICE = '이 화면은 입력을 받지 않습니다. 로그인은 hanjul.ai 로그인 화면에서만 합니다.';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; view: ConfirmView; member: boolean }
  | { kind: 'approved'; view: ConfirmView };

export default function PlannerConfirmPage() {
  const token = useApproveToken();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated } = useAuthStore();
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [sheet, setSheet] = useState(false);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<ConfirmSend | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // 이미 연 행사(로그인판)면 토큰 없이 다시 읽는다(고친 뒤 · 승인 뒤 토큰은 무효가 된다)
    if (eventId && isAuthenticated) {
      const m = await plannerApi<ConfirmView>(`/api/marketing-planner/events/${encodeURIComponent(eventId)}/confirm-view`);
      if (m.ok) { setState({ kind: 'ready', view: m.data, member: true }); return; }
    }
    if (!token) { setState({ kind: 'expired' }); return; }
    const r = await plannerApi<ConfirmView>('/api/marketing-planner/confirm-view', { body: { token }, auth: false });
    if (r.status === 410) { setState({ kind: 'expired' }); return; }
    if (!r.ok) { setState({ kind: 'error', message: plannerErrorText(r, '확인 화면을 불러오지 못했어요. 잠시 후 다시 열어 주세요.') }); return; }
    setEventId(r.data.event.id);
    // 이 휴대폰이 로그인돼 있고 그 행사를 볼 수 있는 계정이면 로그인판(잔액 · 승인 · 문안 고치기)
    if (isAuthenticated) {
      const m = await plannerApi<ConfirmView>(`/api/marketing-planner/events/${encodeURIComponent(r.data.event.id)}/confirm-view`);
      if (m.ok) { setState({ kind: 'ready', view: m.data, member: true }); return; }
    }
    setState({ kind: 'ready', view: r.data, member: false });
  }, [token, isAuthenticated, eventId]);
  useEffect(() => { void load(); }, [token, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (view: ConfirmView) => {
    setWorking(true);
    const r = await plannerApi(`/api/marketing-planner/events/${encodeURIComponent(view.event.id)}/approve`, { body: { seenHash: view.fingerprint, shownTotal: view.quote?.total ?? 0 } });
    setWorking(false);
    setSheet(false);
    if (r.ok) { setState({ kind: 'approved', view }); return; }
    toast.error(r.status === 402 ? '크레딧이 부족해요. 충전한 뒤 다시 승인해 주세요.' : plannerErrorText(r, '승인하지 못했어요. 다시 시도해 주세요.'));
    void load();
  };
  const loginAndApprove = (view: ConfirmView) => {
    rememberLoginReturn(`/marketing-planner/events/${view.event.id}`);
    navigate('/login');
  };

  const header = (
    <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
      <div className="max-w-[560px] mx-auto px-5 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white grid place-items-center shrink-0"><CalendarDays className="w-4 h-4" /></div>
        <div className="min-w-0">
          <p className="text-[16px] font-bold tracking-[-0.02em]">마케팅 플래너 확인</p>
          <p className="text-[12.5px] text-neutral-600 truncate">{state.kind === 'ready' || state.kind === 'approved' ? `${state.view.event.companyName}에서 보낼 내용이에요` : '한줄로 마케팅 플래너'}</p>
        </div>
      </div>
    </div>
  );
  const footer = (
    <div className="space-y-1.5 pt-2">
      <p className="text-[11.5px] text-neutral-500">한줄로 마케팅 플래너 · 안내 문자를 받은 담당자용 화면입니다</p>
      <p className="text-[11.5px] text-neutral-500">{PUBLIC_NOTICE}</p>
    </div>
  );

  if (state.kind === 'loading') {
    return <div className="min-h-screen bg-neutral-50">{header}<div className="max-w-[560px] mx-auto px-5 py-16 grid place-items-center text-neutral-400"><Loader2 className="w-5 h-5 animate-spin" /></div></div>;
  }
  if (state.kind === 'expired' || state.kind === 'error') {
    return (
      <div className="min-h-screen bg-neutral-50">{header}
        <div className="max-w-[560px] mx-auto px-5 py-8">
          <div className="rounded-2xl border border-neutral-200 bg-white p-7 text-center">
            <span className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-neutral-100 text-neutral-500 grid place-items-center"><Link2Off className="w-5 h-5" /></span>
            <p className="text-[16px] font-bold">{state.kind === 'expired' ? '이 확인 주소는 지금 쓸 수 없어요' : '확인 화면을 열지 못했어요'}</p>
            <p className="mt-2 text-[13.5px] text-neutral-600 leading-relaxed">{state.kind === 'expired' ? '이미 승인했거나, 내용이 바뀌어 새 주소를 보냈거나, 승인 마감이 지났어요. 가장 최근에 받은 문자의 주소로 열어 주세요.' : state.message}</p>
            <p className="mt-4 pt-4 border-t border-neutral-100 text-[13px] text-neutral-600 leading-relaxed">PC 한줄로 <b className="text-neutral-900">마케팅 플래너</b>에서도 같은 행사를 볼 수 있어요.</p>
          </div>
          <div className="mt-6">{footer}</div>
        </div>
      </div>
    );
  }

  const view = state.view;
  const ev = view.event;
  const st = plannerStateOf(ev.displayState);
  const total = view.quote?.total ?? 0;
  const smsSend = view.sends.find((s) => s.sms?.editable);
  const pending = view.sends.filter((s) => s.status !== 'sent' && s.status !== 'skipped');

  if (state.kind === 'approved') {
    return (
      <div className="min-h-screen bg-neutral-50">{header}
        <div className="max-w-[560px] mx-auto px-5 py-8">
          <div className="rounded-2xl border border-emerald-200 bg-white p-7 text-center">
            <span className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 grid place-items-center"><Check className="w-5 h-5" /></span>
            <p className="text-[16px] font-bold">'{ev.title}' 행사를 승인했어요</p>
            <p className="mt-2 text-[13.5px] text-neutral-600 leading-relaxed">{pending[0] ? `${plannerDay(pending[0].scheduledOn)} 오전 ${view.sendHour}시부터 정해진 날 그대로 나가요.` : '정해진 날 그대로 나가요.'} 첫 발송 전까지 PC 한줄로에서 승인을 풀 수 있어요.</p>
          </div>
          <div className="mt-6">{footer}</div>
        </div>
      </div>
    );
  }

  const canApprove = state.member && ev.displayState === 'review' && !view.sends.some((s) => s.sms && s.sms.spam !== 'pass');
  return (
    <div className="relative min-h-screen bg-neutral-50">
      {header}
      <div className="max-w-[560px] mx-auto px-4 pt-5 pb-[170px]">
        {st && <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[12px] font-semibold ${st.badge}`}><st.icon className="w-[13px] h-[13px]" />{st.label}</span>}
        <h2 className="text-[22px] font-bold tracking-[-0.02em] mt-2 leading-tight">{ev.title}</h2>
        <p className="text-[13.5px] text-neutral-600 tabular-nums mt-0.5">{plannerRange(ev.startsOn, ev.endsOn)}</p>
        {view.deadline && !view.approved && (
          <p className="text-[13.5px] font-bold text-amber-800 mt-2 inline-flex items-center gap-1 tabular-nums">
            <AlarmClock className="w-4 h-4" />승인 마감 {plannerDay(view.deadline.date)} {view.deadline.hour}시 · {view.deadline.daysLeft > 0 ? `${view.deadline.daysLeft}일 남음` : view.deadline.daysLeft === 0 ? '오늘' : '지남'}
          </p>
        )}
        <ConfirmSummary view={view} />
        <div className="mt-7 mb-4 flex items-baseline gap-2"><h3 className="text-[17px] font-bold">보낼 내용 {view.sends.length}번</h3><span className="text-[12.5px] text-neutral-600">나가는 순서대로</span></div>
        <ConfirmTimeline view={view} mode="phone" />
        <div className="space-y-1.5">
          <p className="text-[10px] text-neutral-500 italic">Data source: {view.dataSource}</p>
          {!state.member && footer}
        </div>
      </div>
      {ev.displayState === 'review' && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-white border-t border-neutral-200 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
          <div className="max-w-[560px] mx-auto px-4 pt-3 pb-5">
            {state.member ? (
              <>
                <p className="text-[13px] font-semibold text-neutral-900 text-center tabular-nums">{view.balance !== null ? `승인하면 보유 크레딧 ${won(view.balance)} → ${won(view.balance - total)}` : `승인하면 ${won(total)}크레딧이 빠져요`}</p>
                <div className="flex gap-2 mt-2.5">
                  {smsSend && <button type="button" onClick={() => setEditing(smsSend)} className="h-12 px-4 rounded-[10px] border border-neutral-300 text-[13.5px] font-semibold text-neutral-700">문안 고치기</button>}
                  <button type="button" disabled={!canApprove || working} onClick={() => setSheet(true)} className="flex-1 h-12 rounded-[10px] bg-indigo-600 text-white text-[15px] font-bold disabled:opacity-50">
                    승인하기 <span className="font-semibold text-indigo-100 text-[13px]">· {won(total)}크레딧</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13.5px] font-bold text-neutral-900 flex items-center gap-1.5"><Monitor className="w-[15px] h-[15px] text-indigo-600" />승인은 PC 한줄로 '할 일'에서 해요</p>
                <p className="text-[12.5px] text-neutral-600 mt-0.5 tabular-nums">마케팅 플래너 맨 위에 이 행사가 있어요{view.deadline ? ` · 마감 ${plannerDay(view.deadline.date)} ${view.deadline.hour}시` : ''}</p>
                <button type="button" onClick={() => loginAndApprove(view)} className="mt-2.5 w-full h-12 rounded-[10px] border border-neutral-300 bg-white text-[13.5px] font-semibold text-neutral-800 inline-flex items-center justify-center gap-1.5">
                  이 휴대폰에서 로그인하고 승인<span className="text-[12px] font-medium text-amber-800">PC 접속은 끊겨요</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {sheet && (
        <div className="fixed inset-0 z-30 bg-black/45 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="승인 확인">
          <div className="w-full max-w-[560px] bg-white rounded-t-[24px] px-5 pt-3 pb-6">
            <div className="w-10 h-1 rounded-full bg-neutral-300 mx-auto" />
            <div className="mt-4"><ApproveBody view={view} /></div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setSheet(false)} disabled={working} className="h-12 px-5 rounded-[10px] border border-neutral-300 text-[14px] font-semibold text-neutral-700">취소</button>
              <button type="button" onClick={() => { void approve(view); }} disabled={working} className="flex-1 h-12 rounded-[10px] bg-indigo-600 text-white text-[15px] font-bold disabled:opacity-60">
                {working ? '승인하는 중' : '승인하기'} <span className="font-semibold text-indigo-100 text-[13px]">· {won(total)}크레딧</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <CopyEditDialog send={editing} eventId={ev.id} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.success('문안을 저장했어요. 스팸 검사가 끝나면 승인할 수 있어요.'); void load(); }}
          onError={(m) => toast.error(m)} />
      )}
    </div>
  );
}
