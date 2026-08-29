/**
 * ChargeApprovePage — 충전 승인 링크 (★2026-08-28(3) 신설 · 인증 X)
 *
 * 승인 안내 문자의 주소(#t=토큰)가 여는 화면이다(선례 = AgencyApprovePage). 폰 우선 한 컬럼.
 *
 * ⛔ 이 화면이 하는 일은 승인 하나뿐이다. 거절·보류 해소는 시스템 관리 화면 소유.
 * ⛔ 서버가 주는 것만 그린다(잔액·다른 요청 없음). 승인 가능 판정은 전부 서버가 한다.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔 라이트.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Wallet } from 'lucide-react';
import { CUI_BTN_PRIMARY } from '../utils/console-ui';

interface ChargeApprovalView {
  kind: 'deposit' | 'agent_order';
  kindLabel: string;
  companyName: string;
  amount: number;
  depositorName: string;
  agentSendId: string | null;
  status: string;
  processed: boolean;
  createdAt: string;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; request: ChargeApprovalView; approvable: boolean; blockReason: string | null; notice?: string }
  | { kind: 'done'; request: ChargeApprovalView; message: string };

const fmtWhen = (v: string) => {
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ChargeApprovePage() {
  // 토큰은 fragment(#t=)에 실려 온다 — fragment는 서버로 전송되지 않아 어떤 접근 로그에도 안 남는다.
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t')
    || new URLSearchParams(window.location.search).get('t') || '';
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [approving, setApproving] = useState(false);

  // ⛔ 토큰은 API에 헤더로만 보낸다 — URL에 실으면 서버 요청 로그에 승인권이 평문으로 남는다.
  const tokenHeader = { 'X-Charge-Approve-Token': token };

  const load = useCallback(async (notice?: string) => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    try {
      const res = await fetch('/api/charge-approve/info', { headers: tokenHeader, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) { setState({ kind: 'invalid' }); return; }
      setState({ kind: 'ready', request: data.request, approvable: !!data.approvable, blockReason: data.blockReason || null, notice });
    } catch {
      setState({ kind: 'invalid' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    if (approving || state.kind !== 'ready') return;
    setApproving(true);
    try {
      const res = await fetch('/api/charge-approve/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeader },
        referrerPolicy: 'no-referrer',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setState({ kind: 'done', request: data.request, message: data.message || '승인되었습니다.' });
        return;
      }
      // 그 사이 처리됐거나 지금은 링크로 못 하는 상태다 — 서버가 준 사유를 보여주고 최신 상태를 다시 읽는다
      await load(data?.error || '상태가 바뀌어 다시 불러왔습니다. 확인해 주세요.');
    } catch {
      await load('잠시 문제가 있었습니다. 다시 시도해 주세요.');
    } finally {
      setApproving(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-[560px] mx-auto px-5 py-3.5 flex items-center gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
            <Wallet className="w-4 h-4" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">충전 승인</h1>
            <p className="text-[12.5px] text-neutral-500">입금을 확인하신 뒤 승인해 주세요</p>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[560px] mx-auto px-5 py-6">{children}</main>
      <footer className="w-full max-w-[560px] mx-auto px-5 pb-6">
        <p className="text-[11px] text-neutral-400">한줄로 충전 관리 · 이 화면은 안내 문자를 받은 담당자용입니다</p>
      </footer>
    </div>
  );

  if (state.kind === 'loading') {
    return (
      <Shell>
        <div className="rounded-xl border border-neutral-200 bg-white p-12 grid place-items-center text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <Shell>
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <span className="mx-auto mb-3 h-11 w-11 rounded-2xl bg-neutral-100 text-neutral-400 grid place-items-center">
            <AlertTriangle className="w-5 h-5" strokeWidth={2} />
          </span>
          <p className="text-[15px] font-semibold text-neutral-900">유효하지 않거나 만료된 주소입니다</p>
          <p className="mt-1.5 text-[13px] text-neutral-500 leading-relaxed">
            가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요.
          </p>
        </div>
      </Shell>
    );
  }

  const r = state.request;
  const done = state.kind === 'done' || r.processed;

  return (
    <Shell>
      {state.kind === 'ready' && state.notice && (
        <div className="mb-4 flex gap-2.5 p-3.5 rounded-lg border border-amber-200 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-px" strokeWidth={2} />
          <p className="text-[13px] text-amber-900 leading-relaxed">{state.notice}</p>
        </div>
      )}

      <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100">
          <p className="text-[12.5px] text-neutral-500">{r.kindLabel}</p>
          <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em] truncate">{r.companyName}</p>
        </div>
        <div className="px-5 py-4 space-y-2 text-[13px]">
          <p className="flex justify-between gap-4">
            <span className="text-neutral-500">금액</span>
            <b className="text-neutral-900 tabular-nums text-[15px]">{r.amount.toLocaleString()}원</b>
          </p>
          <p className="flex justify-between gap-4"><span className="text-neutral-500">입금자</span><b className="text-neutral-900">{r.depositorName}</b></p>
          {r.agentSendId && (
            <p className="flex justify-between gap-4"><span className="text-neutral-500">발송ID</span><b className="text-neutral-900 font-mono">{r.agentSendId}</b></p>
          )}
          <p className="flex justify-between gap-4"><span className="text-neutral-500">요청 시각</span><b className="text-neutral-900 tabular-nums">{fmtWhen(r.createdAt)}</b></p>
        </div>
      </div>

      <div className="mt-5">
        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <span className="mx-auto mb-2.5 h-11 w-11 rounded-full bg-emerald-600 text-white grid place-items-center">
              <Check className="w-5 h-5" strokeWidth={2.6} />
            </span>
            <p className="text-[15px] font-bold text-emerald-900">
              {state.kind === 'done' ? '승인되었습니다' : '이미 처리된 요청입니다'}
            </p>
            <p className="mt-1 text-[13px] text-emerald-800 leading-relaxed">
              {state.kind === 'done'
                ? state.message
                : '처리 내역은 시스템 관리 화면에서 확인할 수 있습니다.'} 이 창은 닫으셔도 됩니다.
            </p>
          </div>
        ) : state.kind === 'ready' && state.approvable ? (
          <>
            <button
              type="button"
              onClick={approve}
              disabled={approving}
              className={`${CUI_BTN_PRIMARY} w-full h-12 text-[15px] justify-center`}
            >
              {approving ? <Loader2 className="w-[17px] h-[17px] animate-spin" /> : <Check className="w-[17px] h-[17px]" strokeWidth={2.4} />}
              입금 확인했습니다. 승인합니다
            </button>
            <p className="mt-2.5 text-center text-[12.5px] text-neutral-500">
              누르는 즉시 <b className="tabular-nums">{r.amount.toLocaleString()}원</b>이 충전 처리됩니다
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center">
            <p className="text-[13.5px] font-semibold text-neutral-800">지금은 이 주소로 승인할 수 없습니다</p>
            <p className="mt-1 text-[12.5px] text-neutral-500 leading-relaxed">
              {(state.kind === 'ready' && state.blockReason) || '처리 상태가 바뀌었습니다.'} 거절이나 확인이 필요한 처리는 시스템 관리 화면에서 해 주세요.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
