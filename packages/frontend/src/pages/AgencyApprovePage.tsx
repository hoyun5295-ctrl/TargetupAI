/**
 * AgencyApprovePage — 대행발송 담당자 링크 (★ 2026-08-25 신설 · 인증 X · ★ 2026-10-18 축 2 · 3 · 4 + Harold ①)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16 · docs/2026-10-16-agency-send-mobile-control-design.md §2 · docs/2026-10-18-planner-v2-design.md §0 ①.
 * 담당자 안내 문자의 주소(#t=토큰)가 여는 화면이다. 폰에서 열리는 것이 기본이므로 모바일 우선 한 컬럼으로 그린다.
 *
 * 할 수 있는 일 = 서버 `actions{}`(utils/agency-send-actions.ts 한 벌)만 그린다:
 *   승인(확인 창 → 필요하면 인증번호 → 실행 · Harold ①) · 취소(확인 창 · 담당자 전원 통보) · 보낼 시각 바꾸기 · 같은 시각으로 다시 진행 ·
 *   맞춤법 제안 골라 고치기(고르면 주 버튼 = [고른 N곳 고치고 다시 검사] · 승인 숨김 · 고치면 이 주소는 닫히고 새 문자가 간다).
 * ★2026-10-16 승인은 발신 인증(3.5) 인증번호를 받을 수 있다(서버가 요구할 때만) · 흐름 = `useSenderAuth` · 확인만 토큰 헤더 경로.
 * ⛔ 서버가 주는 것만 그린다(수신자 명단 없음) · 판정(actions · 409)은 전부 서버 · 문구 줄표 0 · native dialog 0(시각 칸만 native 입력).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Check, Loader2, RotateCcw, Send, SpellCheck2, X } from 'lucide-react';
import {
  agencyCallbackLabel, formatWhen, toLocalInput, STATUS_LABEL, STATUS_TONE, type AgencySendStatus,
} from '../components/agency/agency-send-api';
import { CUI_BTN_PRIMARY, CUI_PILL_BASE, CUI_PILL_TONE } from '../utils/console-ui';
import { buildAdSubjectFront } from '../utils/formatDate';
import { useApproveToken } from '../hooks/useApproveToken';
import { useSenderAuth } from '../hooks/useSenderAuth';
import SenderAuthModal from '../components/SenderAuthModal';
import LinkConfirmSheet from '../components/link/LinkConfirmSheet';
import { verifyAgencyLinkSenderAuth } from '../components/agency/agency-send-api';

interface ActionState { ok: boolean; reason: string | null }
interface LinkActions {
  approve: ActionState; cancel: ActionState; reschedule: ActionState; resume: ActionState; spellFix: ActionState; editText: ActionState;
  approveBy: string | null;
}
interface SpellIssueView { id: string; before: string; after: string; kind: 'typo' | 'spacing'; reason: string; blocked?: 'sms_bytes' }

interface ApprovalView {
  label: string;
  status: AgencySendStatus;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject: string | null;
  content: string;
  isAd: boolean;
  callbackNumber: string;
  /** ★2026-09-13 고객별 회신번호 종류 수(0 = 대표 번호로 나감 · 1 = callbackSole로 나감 · 2 이상 = 고객별) */
  callbackKinds?: number;
  /** 고객별 번호가 한 종류일 때 그 번호(대표 번호와 다를 수 있다) */
  callbackSole?: string | null;
  requestedAt: string;
  recipientCount: number;
  imageCount: number;
  revision: number;
  approvedAt: string | null;
  /** ★2026-09-25 맞춤법 확인 목록(문안 버전에 묶여 서버가 준다) */
  spellIssues?: SpellIssueView[] | null;
  /** ★2026-10-18 이 링크로 할 수 있는 조작(서버 판정 한 벌) */
  actions?: LinkActions;
}

type Sheet = 'approve' | 'cancel' | 'reschedule' | 'resume' | 'spell' | null;

type ViewState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  // forToken = 이 화면 재료가 어느 토큰의 것인가(★Codex 2R 수용) — 재진입으로 토큰이 바뀌면
  // A의 화면으로 B를 승인하는 불일치를 실행 게이트가 막는다
  | { kind: 'ready'; forToken: string; request: ApprovalView; approvable: boolean; blockReason: string | null; notice?: string }
  | { kind: 'done'; request: ApprovalView }
  | { kind: 'cancelled'; request: ApprovalView; pending: boolean }
  | { kind: 'fixed'; count: number };

/** 화면 껍데기 — 컴포넌트 바깥에 둔다(안에 두면 렌더마다 새 컴포넌트라 시각 칸 입력이 다시 마운트된다) */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-[560px] mx-auto px-5 py-3.5 flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
            <Send className="w-4 h-4" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">대행발송 승인</h1>
            <p className="text-[12.5px] text-neutral-500">받으신 테스트 문자 그대로 나갑니다</p>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[560px] mx-auto px-5 py-6">{children}</main>
      <footer className="w-full max-w-[560px] mx-auto px-5 pb-6 space-y-1">
        <p className="text-[11px] text-neutral-400">한줄로 대행발송 · 이 화면은 안내 문자를 받은 담당자용입니다</p>
        <p className="text-[11px] text-neutral-400">인증번호는 이 화면에만 입력합니다. 로그인은 hanjul.ai 로그인 화면에서만 하며, 전화나 메시지로 인증번호를 묻지 않습니다.</p>
      </footer>
    </div>
  );
}

function ResultCard({ tone, title, body }: { tone: 'ok' | 'muted'; title: string; body: string }) {
  return (
    <div className={`rounded-2xl border p-6 text-center ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-neutral-200 bg-white'}`}>
      <span className={`mx-auto mb-2.5 h-11 w-11 rounded-full grid place-items-center ${tone === 'ok' ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-500'}`}>
        <Check className="w-5 h-5" strokeWidth={2.6} />
      </span>
      <p className={`text-[15px] font-bold ${tone === 'ok' ? 'text-emerald-900' : 'text-neutral-900'}`}>{title}</p>
      <p className={`mt-1 text-[13px] leading-relaxed ${tone === 'ok' ? 'text-emerald-800' : 'text-neutral-600'}`}>{body}</p>
    </div>
  );
}

export default function AgencyApprovePage() {
  // 토큰은 fragment(#t=)에 실려 온다 — fragment는 서버로 전송되지 않아 어떤 접근 로그에도 안 남는다.
  // 캡처 즉시 주소에서 지우고, 같은 탭 재진입(#t=만 바뀌는 진입)도 잡는다(★2026-08-30 C6 · useApproveToken).
  const token = useApproveToken();
  // 재진입으로 토큰이 바뀐 뒤 도착하는 낡은 응답을 폐기하기 위한 최신값 참조
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [working, setWorking] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState('');
  // ★2026-10-16 발신 인증 — 확인은 이 화면의 토큰으로(로그인 없음)
  const senderAuth = useSenderAuth({ verifyRequest: (challengeId, code) => verifyAgencyLinkSenderAuth(token, challengeId, code) });

  // ⛔ 토큰은 API에 **헤더로만** 보낸다 — URL에 실으면 서버 요청 로그에 승인권이 평문으로 남는다.
  const tokenHeader = { 'X-Agency-Approve-Token': token };

  const load = useCallback(async (notice?: string) => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    try {
      const res = await fetch('/api/agency-approve/info', { headers: tokenHeader, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (tokenRef.current !== token) return; // 재진입으로 토큰이 바뀐 낡은 응답은 버린다
      // 끝난 화면(승인 · 취소 · 고침)을 늦게 도착한 조회 응답이 되돌리지 않는다(★Codex 2R 수용)
      const settled = (prev: ViewState) => prev.kind === 'done' || prev.kind === 'cancelled' || prev.kind === 'fixed';
      if (!res.ok || !data?.success) { setState((prev) => (settled(prev) ? prev : { kind: 'invalid' })); return; }
      setState((prev) => (settled(prev) ? prev : {
        kind: 'ready', forToken: token, request: data.request, approvable: !!data.approvable, blockReason: data.blockReason || null, notice,
      }));
      setPicked((cur) => cur.filter((id) => (data.request?.spellIssues || []).some((i: SpellIssueView) => i.id === id && !i.blocked)));
    } catch {
      if (tokenRef.current !== token) return;
      setState((prev) => (prev.kind === 'done' || prev.kind === 'cancelled' || prev.kind === 'fixed' ? prev : { kind: 'invalid' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 토큰이 바뀌면(재진입) 즉시 화면 재료를 비운다 — 옛 화면으로 새 토큰을 조작하는 창을 없앤다
  useEffect(() => { setState({ kind: 'loading' }); setSheet(null); setPicked([]); load(); }, [load]);

  /** 링크 조작 공통 — 성공 = onOk · 409 + 지금 행 = 그 값으로 바꾸고 사유를 보인다 · 그 밖 = 다시 읽고 사유 */
  const post = async (path: string, body: Record<string, unknown>): Promise<any | null> => {
    const res = await fetch(`/api/agency-approve/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeader }, referrerPolicy: 'no-referrer', body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (tokenRef.current !== token) return null;
    if (res.ok && data?.success) return data;
    if (data?.request && state.kind === 'ready') {
      setState({ ...state, request: data.request, approvable: !!data.request?.actions?.approve?.ok, blockReason: data.request?.actions?.approve?.reason || null, notice: data.error || '내용이 바뀌어 다시 불러왔습니다.' });
      return { failed: true, data };
    }
    return { failed: true, data };
  };

  const approve = async () => {
    if (working || state.kind !== 'ready' || state.forToken !== token) return;
    setWorking(true);
    try {
      const out = await post('approve', { revision: state.request.revision });
      if (!out) return;
      if (!out.failed) { setSheet(null); setState({ kind: 'done', request: out.request }); return; }
      // ★2026-10-16 인증번호 요구 — 창을 띄우고, 통과하면 같은 토큰일 때만 이 승인을 다시 보낸다
      if (senderAuth.handleResponse(out.data, () => { if (tokenRef.current === token) void approve(); })) { setSheet(null); return; }
      setSheet(null);
      await load(out.data?.error || '내용이 바뀌어 다시 불러왔습니다. 확인 후 승인해 주세요.');
    } catch {
      await load('잠시 문제가 있었습니다. 다시 시도해 주세요.');
    } finally {
      setWorking(false);
    }
  };

  const runAction = async (path: 'cancel' | 'reschedule' | 'spell-fix', body: Record<string, unknown>) => {
    if (working || state.kind !== 'ready' || state.forToken !== token) return;
    setWorking(true);
    try {
      const out = await post(path, { revision: state.request.revision, ...body });
      setSheet(null);
      if (!out) return;
      if (out.failed) { if (!out.data?.request) await load(out.data?.error || '처리하지 못했습니다. 다시 시도해 주세요.'); return; }
      if (path === 'cancel') { setState({ kind: 'cancelled', request: out.request, pending: !!out.pending }); return; }
      if (path === 'spell-fix') { setState({ kind: 'fixed', count: picked.length }); return; }
      setPicked([]);
      await load(out.timeShifted ? '준비 시간이 모자라 보낼 시각을 조금 뒤로 잡았습니다. 새 시각을 확인해 주세요.' : '보낼 시각을 바꿨습니다. 새 승인 요청 문자를 보내 드립니다.');
    } catch {
      setSheet(null);
      await load('잠시 문제가 있었습니다. 다시 시도해 주세요.');
    } finally {
      setWorking(false);
    }
  };

  if (state.kind === 'loading') {
    return <Shell><div className="rounded-xl border border-neutral-200 bg-white p-12 grid place-items-center text-neutral-400"><Loader2 className="w-5 h-5 animate-spin" /></div></Shell>;
  }
  if (state.kind === 'invalid') {
    return (
      <Shell>
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <span className="mx-auto mb-3 h-11 w-11 rounded-2xl bg-neutral-100 text-neutral-400 grid place-items-center"><AlertTriangle className="w-5 h-5" strokeWidth={2} /></span>
          <p className="text-[15px] font-semibold text-neutral-900">유효하지 않거나 만료된 주소입니다</p>
          <p className="mt-1.5 text-[13px] text-neutral-500 leading-relaxed">가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요.</p>
        </div>
      </Shell>
    );
  }
  if (state.kind === 'fixed') {
    return <Shell><ResultCard tone="ok" title={`맞춤법 ${state.count}곳을 고쳤습니다`} body="고친 문안으로 다시 검사한 뒤 새 테스트 문자와 승인 요청을 보내 드립니다. 이 주소는 닫혔으니 새로 받는 문자의 주소로 승인해 주세요." /></Shell>;
  }

  const r = state.request;
  const a = r.actions;
  const doneByStatus = r.status === 'approved' || r.status === 'final_testing' || r.status === 'queued';
  const fixable = (r.spellIssues || []).filter((i) => !i.blocked);
  const ready = state.kind === 'ready';

  const summaryRows = [
    { label: '건', value: r.label },
    { label: '보낼 시각', value: formatWhen(r.requestedAt) },
    { label: '받는 사람', value: `${r.recipientCount.toLocaleString()}명` },
    { label: '보내는 번호', value: agencyCallbackLabel(r) },
  ];

  return (
    <>
      <Shell>
        {ready && state.notice && (
          <div className="mb-4 flex gap-2.5 p-3.5 rounded-lg border border-amber-200 bg-amber-50" role="status">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-px" strokeWidth={2} />
            <p className="text-[13px] text-amber-900 leading-relaxed">{state.notice}</p>
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between gap-3">
            <p className="text-[14px] font-bold tracking-[-0.01em] truncate">{r.label}</p>
            <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[STATUS_TONE[r.status]]} shrink-0`}>{STATUS_LABEL[r.status]}</span>
          </div>
          <div className="px-5 py-4 space-y-2 text-[13px]">
            <p className="flex justify-between gap-4"><span className="text-neutral-500">보낼 시각</span><b className="text-neutral-900">{formatWhen(r.requestedAt)}</b></p>
            {a?.approveBy && ready && <p className="flex justify-between gap-4"><span className="text-neutral-500">승인 마감</span><b className="text-amber-800">{formatWhen(a.approveBy)}</b></p>}
            <p className="flex justify-between gap-4"><span className="text-neutral-500">받는 사람</span><b className="text-neutral-900 tabular-nums">{r.recipientCount.toLocaleString()}명</b></p>
            <p className="flex justify-between gap-4">
              <span className="text-neutral-500">형식</span>
              <b className="text-neutral-900">{r.messageType}{r.isAd ? ' · 광고' : ''}{r.imageCount > 0 ? ` · 이미지 ${r.imageCount}장` : ''}</b>
            </p>
            <p className="flex justify-between gap-4"><span className="text-neutral-500">보내는 번호</span><b className="text-neutral-900 tabular-nums">{agencyCallbackLabel(r)}{(r.callbackKinds ?? 0) > 1 ? ' (명단의 회신번호대로)' : ''}</b></p>
          </div>
          <div className="px-5 pb-5">
            <div className="rounded-xl bg-neutral-100 px-4 py-3.5 text-[13px] leading-relaxed text-neutral-900">
              {(r.messageType === 'LMS' || r.messageType === 'MMS') && (
                // ★2026-09-10 발송과 같은 규칙(이미 (광고)로 시작하는 제목에는 다시 안 붙인다 · 남지현 접수)
                <p className="font-extrabold mb-1.5">{buildAdSubjectFront(r.subject || '', r.messageType, r.isAd)}</p>
              )}
              <p className="whitespace-pre-wrap break-words">{r.content}</p>
              <p className="mt-2.5 text-[11.5px] text-neutral-500">
                받는 분마다 항목 값이 다르게 들어갑니다. 실제 모습은 받으신 테스트 문자와 같습니다.
                {r.isAd ? ' 광고 표시와 무료 수신거부 번호는 자동으로 붙습니다.' : ''}
              </p>
            </div>
            {Array.isArray(r.spellIssues) && r.spellIssues.length > 0 && ready && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                <p className="text-[13px] font-bold text-emerald-900">맞춤법을 확인할 곳 {r.spellIssues.length}곳</p>
                <ul className="mt-1.5 space-y-1.5">
                  {r.spellIssues.map((i) => {
                    const can = !!a?.spellFix.ok && !i.blocked;
                    const on = picked.includes(i.id);
                    return (
                      <li key={i.id}>
                        <button type="button" role="checkbox" aria-checked={on} disabled={!can || working}
                          onClick={() => setPicked((cur) => (on ? cur.filter((x) => x !== i.id) : [...cur, i.id]))}
                          className={`w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ${can ? 'hover:bg-emerald-100/60' : 'cursor-default'}`}>
                          {can && <span className={`mt-0.5 w-4 h-4 rounded-[5px] grid place-items-center shrink-0 ${on ? 'bg-emerald-600 text-white' : 'border border-emerald-400 bg-white'}`}>{on && <Check className="w-3 h-3" />}</span>}
                          <span className="min-w-0">
                            <span className="text-rose-600 line-through">{i.before}</span>
                            <span className="mx-1.5 text-neutral-400">→</span>
                            <b className="text-emerald-700">{i.after}</b>
                            <span className="ml-1.5 text-[11.5px] text-neutral-500">{i.blocked ? '고치면 단문 글자 수를 넘어 고칠 수 없어요' : i.reason || (i.kind === 'spacing' ? '띄어쓰기' : '맞춤법')}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11.5px] text-neutral-500 leading-relaxed">
                  {/* ★ 2026-10-19 「이대로 승인」 안내는 승인이 열려 있을 때만(보낼 시각 15분 전 잠금 · 그 밖 승인 불가 상태에서 어긋난 말 0) */}
                  {a?.spellFix.ok ? `고칠 곳을 고르면 다시 검사한 뒤 새 테스트 문자와 승인 요청을 보내 드려요.${a?.approve.ok ? ' 이대로 승인해도 됩니다.' : ''}` : `${a?.spellFix.reason || '지금은 여기서 고칠 수 없어요.'}${a?.approve.ok ? ' 이대로 승인해도 됩니다.' : ''}`}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          {state.kind === 'done' || (doneByStatus && ready && !a?.cancel.ok) ? (
            <ResultCard tone="ok" title="승인되었습니다" body="발송 2시간 전에 자동으로 예약을 잡고, 정해진 시각에 나갑니다. 이 창은 닫으셔도 됩니다." />
          ) : state.kind === 'cancelled' ? (
            <ResultCard tone="muted" title={state.pending ? '취소를 처리하고 있습니다' : '발송을 취소했습니다'} body={state.pending ? '예약을 지우는 중이에요. 끝나면 담당자 모두에게 결과를 문자로 알려 드립니다.' : '담당자 모두에게 취소 문자를 보냈습니다. 다시 보내려면 새로 접수해 주세요.'} />
          ) : (
            <>
              {doneByStatus && <ResultCard tone="ok" title="승인되었습니다" body="정해진 시각에 나갑니다. 보내지 않으려면 아래에서 취소할 수 있어요." />}
              {picked.length > 0 ? (
                <button type="button" onClick={() => setSheet('spell')} disabled={working} className={`${CUI_BTN_PRIMARY} w-full h-12 text-[15px] justify-center`}>
                  <SpellCheck2 className="w-[17px] h-[17px]" />고른 {picked.length}곳 고치고 다시 검사
                </button>
              ) : ready && state.approvable ? (
                <>
                  <button type="button" onClick={() => setSheet('approve')} disabled={working} className={`${CUI_BTN_PRIMARY} w-full h-12 text-[15px] justify-center`}>
                    {working ? <Loader2 className="w-[17px] h-[17px] animate-spin" /> : <Check className="w-[17px] h-[17px]" strokeWidth={2.4} />}
                    이 문안 그대로 승인하기
                  </button>
                  <p className="text-center text-[12.5px] text-neutral-500">누르면 확인 창이 한 번 더 떠요 · 승인하면 <b className="tabular-nums">{r.recipientCount.toLocaleString()}명</b> 발송이 확정됩니다</p>
                </>
              ) : !doneByStatus && (
                <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center">
                  <p className="text-[13.5px] font-semibold text-neutral-800">지금은 승인할 수 있는 상태가 아닙니다</p>
                  <p className="mt-1 text-[12.5px] text-neutral-500 leading-relaxed">{(ready && state.blockReason) || '처리 상태가 바뀌었습니다.'}</p>
                </div>
              )}
              {ready && (a?.resume.ok || a?.reschedule.ok) && picked.length === 0 && (
                <div className="grid grid-cols-1 gap-2">
                  {a?.resume.ok && (
                    <button type="button" onClick={() => setSheet('resume')} disabled={working} className="h-11 rounded-xl border border-indigo-300 bg-white text-[13.5px] font-semibold text-indigo-800 inline-flex items-center justify-center gap-1.5 hover:bg-indigo-50">
                      <RotateCcw className="w-4 h-4" />이 시각으로 다시 진행
                    </button>
                  )}
                  {a?.reschedule.ok && (
                    <button type="button" onClick={() => { setWhen(toLocalInput(new Date(r.requestedAt))); setSheet('reschedule'); }} disabled={working}
                      className="h-11 rounded-xl border border-neutral-300 bg-white text-[13.5px] font-semibold text-neutral-800 inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50">
                      <CalendarClock className="w-4 h-4" />보낼 시각 바꾸기
                    </button>
                  )}
                </div>
              )}
              {ready && a?.cancel.ok && picked.length === 0 && (
                <button type="button" onClick={() => setSheet('cancel')} disabled={working}
                  className="w-full h-11 rounded-xl border border-rose-200 bg-white text-[13.5px] font-semibold text-rose-700 inline-flex items-center justify-center gap-1.5 hover:bg-rose-50">
                  <X className="w-4 h-4" />이 발송 취소
                </button>
              )}
            </>
          )}
        </div>
      </Shell>

      {/* ── 확인 창(Harold ① · 버튼마다 한 번 더 · 위험 동작 자동 포커스 끔) ── */}
      <LinkConfirmSheet open={sheet === 'approve'} title="이 문안 그대로 승인할까요?" rows={summaryRows} tone="primary" busy={working}
        notes={[
          { tone: 'info', text: '승인하면 정해진 시각에 그대로 나갑니다. 보내기 전까지 이 화면에서 취소할 수 있어요.' },
          { tone: 'info', text: '인증번호 창이 뜨면 이 휴대폰으로 온 번호를 넣어 주세요.' },
        ]}
        confirmLabel={`승인하기 · ${r.recipientCount.toLocaleString()}명`} onConfirm={() => { void approve(); }} onCancel={() => setSheet(null)} />
      <LinkConfirmSheet open={sheet === 'cancel'} title="이 발송을 취소할까요?" rows={summaryRows} tone="danger" busy={working}
        notes={[
          { tone: 'warn', text: '취소하면 되돌릴 수 없어요. 다시 보내려면 새로 접수해야 해요.' },
          { tone: 'info', text: '담당자 모두에게 취소 문자가 갑니다.' },
        ]}
        confirmLabel="발송 취소" onConfirm={() => { void runAction('cancel', {}); }} onCancel={() => setSheet(null)} />
      <LinkConfirmSheet open={sheet === 'reschedule'} title="보낼 시각을 바꿀까요?" tone="primary" busy={working}
        rows={[{ label: '지금 시각', value: formatWhen(r.requestedAt) }, { label: '받는 사람', value: `${r.recipientCount.toLocaleString()}명` }]}
        notes={[
          { tone: 'info', text: r.status === 'test_failed' ? '처음부터 다시 검사한 뒤 테스트 문자와 승인 요청을 보내 드려요.' : '검사를 통과한 문안 그대로 승인 대기로 돌아가고, 새 승인 요청 문자를 보내 드려요.' },
          { tone: 'info', text: '담당자 모두에게 바뀐 시각을 알려 드려요.' },
        ]}
        confirmLabel="이 시각으로 바꾸기" onConfirm={() => { if (when) void runAction('reschedule', { requestedAt: new Date(when).toISOString() }); }} onCancel={() => setSheet(null)}>
        <label className="block">
          <span className="text-[12.5px] font-semibold text-neutral-700">새로 보낼 시각</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            className="mt-1.5 w-full h-11 px-3 rounded-xl border border-neutral-300 bg-white text-[14px] tabular-nums" />
        </label>
      </LinkConfirmSheet>
      <LinkConfirmSheet open={sheet === 'resume'} title="같은 시각으로 다시 진행할까요?" tone="primary" busy={working}
        rows={[{ label: '보낼 시각', value: formatWhen(r.requestedAt) }, { label: '받는 사람', value: `${r.recipientCount.toLocaleString()}명` }]}
        notes={[
          { tone: 'info', text: '승인 대기로 돌아가고 새 승인 요청 문자를 보내 드려요. 24시간 안에 승인해 주세요.' },
          { tone: 'info', text: '담당자 모두에게 알려 드려요.' },
        ]}
        confirmLabel="다시 진행" onConfirm={() => { void runAction('reschedule', { requestedAt: r.requestedAt }); }} onCancel={() => setSheet(null)} />
      <LinkConfirmSheet open={sheet === 'spell'} title={`맞춤법 ${picked.length}곳을 고칠까요?`} tone="primary" busy={working}
        rows={fixable.filter((i) => picked.includes(i.id)).map((i) => ({ label: i.before, value: i.after }))}
        notes={[
          { tone: 'info', text: '고치면 처음부터 다시 검사하고 새 테스트 문자와 승인 요청을 보내 드려요. 이 주소는 닫혀요.' },
          { tone: 'info', text: '담당자 모두에게 알려 드려요.' },
        ]}
        confirmLabel={`${picked.length}곳 고치기`} onConfirm={() => { void runAction('spell-fix', { issueIds: picked }); }} onCancel={() => setSheet(null)} />

      {/* ★2026-10-16 승인의 발신 인증(3.5) — 끝자리 표시 · 같은 폰 문자 자동 채움 · 통과하면 승인이 이어진다 */}
      {senderAuth.state && (
        <SenderAuthModal
          state={senderAuth.state}
          code={senderAuth.code}
          onCodeChange={senderAuth.setCode}
          error={senderAuth.error}
          busy={senderAuth.busy}
          onVerify={senderAuth.verify}
          onResend={senderAuth.resend}
          onProceed={senderAuth.cancel}
          onCancel={senderAuth.cancel}
        />
      )}
    </>
  );
}
