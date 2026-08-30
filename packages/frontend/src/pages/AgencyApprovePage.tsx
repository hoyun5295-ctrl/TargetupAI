/**
 * AgencyApprovePage — 대행발송 담당자 링크 승인 (★ 2026-08-25 신설 · 인증 X)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16. 담당자 안내 문자의 주소(?t=토큰)가 여는 화면이다.
 * 폰에서 열리는 것이 기본이므로 모바일 우선 한 컬럼으로 그린다.
 *
 * ⛔ 이 화면이 하는 일은 승인 하나뿐이다. 문안 수정·시각 변경·취소는 로그인 화면 소유.
 * ⛔ 서버가 주는 것만 그린다(수신자 명단 없음). 판정(approvable·409)은 전부 서버가 한다.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔 라이트(CUI_ 계열 색).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Send } from 'lucide-react';
import {
  formatWhen, STATUS_LABEL, STATUS_TONE, type AgencySendStatus,
} from '../components/agency/agency-send-api';
import { CUI_BTN_PRIMARY, CUI_PILL_BASE, CUI_PILL_TONE } from '../utils/console-ui';
import { useApproveToken } from '../hooks/useApproveToken';

interface ApprovalView {
  label: string;
  status: AgencySendStatus;
  messageType: 'SMS' | 'LMS' | 'MMS';
  subject: string | null;
  content: string;
  isAd: boolean;
  callbackNumber: string;
  requestedAt: string;
  recipientCount: number;
  imageCount: number;
  revision: number;
  approvedAt: string | null;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  // forToken = 이 화면 재료가 어느 토큰의 것인가(★Codex 2R 수용) — 재진입으로 토큰이 바뀌면
  // A의 화면으로 B를 승인하는 불일치를 approve 게이트가 막는다
  | { kind: 'ready'; forToken: string; request: ApprovalView; approvable: boolean; blockReason: string | null; notice?: string }
  | { kind: 'done'; request: ApprovalView };

export default function AgencyApprovePage() {
  // 토큰은 fragment(#t=)에 실려 온다 — fragment는 서버로 전송되지 않아 어떤 접근 로그에도 안 남는다.
  // 캡처 즉시 주소에서 지우고, 같은 탭 재진입(#t=만 바뀌는 진입)도 잡는다(★2026-08-30 C6 · useApproveToken).
  const token = useApproveToken();
  // 재진입으로 토큰이 바뀐 뒤 도착하는 낡은 응답을 폐기하기 위한 최신값 참조
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const [approving, setApproving] = useState(false);

  // ⛔ 토큰은 API에 **헤더로만** 보낸다 — URL에 실으면 서버 요청 로그에 승인권이 평문으로 남는다.
  //   랜딩 주소의 토큰은 위에서 캡처 즉시 지웠다(C6) — 새로고침은 안내 문자의 주소로 다시 연다.
  const tokenHeader = { 'X-Agency-Approve-Token': token };

  const load = useCallback(async (notice?: string) => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    try {
      const res = await fetch('/api/agency-approve/info', { headers: tokenHeader, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (tokenRef.current !== token) return; // 재진입으로 토큰이 바뀐 낡은 응답은 버린다
      // 승인 완료(done)를 늦게 도착한 조회 응답이 되돌리지 않는다(★Codex 2R 수용)
      if (!res.ok || !data?.success) { setState((prev) => (prev.kind === 'done' ? prev : { kind: 'invalid' })); return; }
      setState((prev) => (prev.kind === 'done' ? prev : {
        kind: 'ready', forToken: token, request: data.request, approvable: !!data.approvable, blockReason: data.blockReason || null, notice,
      }));
    } catch {
      if (tokenRef.current !== token) return;
      setState((prev) => (prev.kind === 'done' ? prev : { kind: 'invalid' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 토큰이 바뀌면(재진입) 즉시 화면 재료를 비운다 — 옛 화면으로 새 토큰을 승인하는 창을 없앤다
  useEffect(() => { setState({ kind: 'loading' }); load(); }, [load]);

  const approve = async () => {
    if (approving || state.kind !== 'ready' || state.forToken !== token) return;
    setApproving(true);
    try {
      const res = await fetch('/api/agency-approve/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tokenHeader },
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ revision: state.request.revision }),
      });
      const data = await res.json().catch(() => ({}));
      if (tokenRef.current !== token) return; // 재진입으로 토큰이 바뀐 낡은 응답은 버린다
      if (res.ok && data?.success) {
        setState({ kind: 'done', request: data.request });
        return;
      }
      // 그 사이 내용이 바뀌었거나 이미 처리됐다 — 서버가 준 최신 상태를 다시 보여준다
      await load(data?.error || '내용이 바뀌어 다시 불러왔습니다. 확인 후 승인해 주세요.');
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
        <p className="text-[11px] text-neutral-400">이 화면은 승인 버튼 외에 어떤 입력도 요구하지 않습니다. 로그인·비밀번호·결제정보를 묻는 비슷한 화면은 가짜이니 입력하지 마세요.</p>
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
  const done = state.kind === 'done' || r.status === 'approved' || r.status === 'final_testing' || r.status === 'queued';

  return (
    <Shell>
      {state.kind === 'ready' && state.notice && (
        <div className="mb-4 flex gap-2.5 p-3.5 rounded-lg border border-amber-200 bg-amber-50">
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
          <p className="flex justify-between gap-4"><span className="text-neutral-500">받는 사람</span><b className="text-neutral-900 tabular-nums">{r.recipientCount.toLocaleString()}명</b></p>
          <p className="flex justify-between gap-4">
            <span className="text-neutral-500">형식</span>
            <b className="text-neutral-900">{r.messageType}{r.isAd ? ' · 광고' : ''}{r.imageCount > 0 ? ` · 이미지 ${r.imageCount}장` : ''}</b>
          </p>
          <p className="flex justify-between gap-4"><span className="text-neutral-500">보내는 번호</span><b className="text-neutral-900 tabular-nums">{r.callbackNumber}</b></p>
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-xl bg-neutral-100 px-4 py-3.5 text-[13px] leading-relaxed text-neutral-900">
            {(r.messageType === 'LMS' || r.messageType === 'MMS') && (
              <p className="font-extrabold mb-1.5">{r.isAd ? '(광고) ' : ''}{r.subject || ''}</p>
            )}
            <p className="whitespace-pre-wrap break-words">{r.content}</p>
            <p className="mt-2.5 text-[11.5px] text-neutral-500">
              받는 분마다 항목 값이 다르게 들어갑니다. 실제 모습은 받으신 테스트 문자와 같습니다.
              {r.isAd ? ' 광고 표시와 무료 수신거부 번호는 자동으로 붙습니다.' : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        {done ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <span className="mx-auto mb-2.5 h-11 w-11 rounded-full bg-emerald-600 text-white grid place-items-center">
              <Check className="w-5 h-5" strokeWidth={2.6} />
            </span>
            <p className="text-[15px] font-bold text-emerald-900">승인되었습니다</p>
            <p className="mt-1 text-[13px] text-emerald-800 leading-relaxed">
              발송 2시간 전에 자동으로 예약을 잡고, 정해진 시각에 나갑니다. 이 창은 닫으셔도 됩니다.
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
              이 문안 그대로 승인하기
            </button>
            <p className="mt-2.5 text-center text-[12.5px] text-neutral-500">
              누르는 즉시 승인되어 <b className="tabular-nums">{r.recipientCount.toLocaleString()}명</b> 발송이 확정됩니다
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center">
            <p className="text-[13.5px] font-semibold text-neutral-800">지금은 승인할 수 있는 상태가 아닙니다</p>
            <p className="mt-1 text-[12.5px] text-neutral-500 leading-relaxed">
              {(state.kind === 'ready' && state.blockReason) || '처리 상태가 바뀌었습니다.'} 문안 수정이나 시각 변경이 필요하면 한줄로 화면의 대행발송 메뉴에서 해 주세요.
            </p>
          </div>
        )}
      </div>
    </Shell>
  );
}
