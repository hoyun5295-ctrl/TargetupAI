/**
 * PlannerRecheckPage — 플래너 당일 재확인 담당자 링크 화면(★ 2026-10-18 · 로그인 없음 · 설계서 docs/2026-10-18-planner-v2-design.md §3-2-4)
 *
 * 문자 속 주소 = /planner-recheck#t=토큰(읽자마자 주소에서 지운다 · useApproveToken) · API = /api/planner-recheck/* · 토큰은 헤더로만.
 * 보내기 · 고치기 · 취소는 서버가 인증번호를 요구할 수 있다(이 휴대폰 · 계정 MFA 번호) → 인증 창 → 통과하면 같은 동작을 다시 보낸다(useSenderAuth).
 * 고친 문안 검사 · 새 문안 준비는 서버가 몇 분 걸려 하므로, 그동안 8초마다 다시 읽는다(최대 15분).
 *
 * ⛔ 판정은 서버(buildRecheckView) · native dialog 0 · 줄표 0 · 모델명 0.
 */
import { getSendPolicy, plannerSendAtText } from '../utils/send-policy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck, CheckCircle2 } from 'lucide-react';
import { useApproveToken } from '../hooks/useApproveToken';
import { useSenderAuth } from '../hooks/useSenderAuth';
import SenderAuthModal from '../components/SenderAuthModal';
import { LinkShell, LinkLoading, LinkInvalid, LinkNotice } from '../components/link/LinkShell';
import PlannerRecheckPanel from '../components/planner/PlannerRecheckPanel';
import { plannerDay } from '../constants/planner-status';
import { plannerCancelText, type RecheckAction, type RecheckView } from '../components/planner/planner-api';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'closed'; outcome: string; title: string; date: string | null }
  | { kind: 'ready'; view: RecheckView };

const CLOSED_TEXT: Record<string, string> = {
  approved: '이미 보내기로 정했어요.',
  skipped: '이 날 발송은 건너뛰기로 정했어요.',
  past_deadline: '마감이 지나 이 날 발송은 보내지 않았어요.',
};

const POLL_MS = 8000;
const POLL_MAX = 110; // 약 15분

/** 기기 증명 보관 자리(탭 단위 · 서버 sender-auth SENDER_AUTH_DEVICE_HEADER 짝) */
const DEVICE_KEY = 'planner-recheck-device';

export default function PlannerRecheckPage() {
  const token = useApproveToken();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'amber' | 'rose' | 'emerald'; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const polls = useRef(0);
  // ★ Codex A 1R — 기기 증명(인증번호를 이 기기에서 확인했을 때만 서버가 준다 · 보내기 · 고치기 · 취소에 헤더로 싣는다 · 탭 안에서만 기억)
  const deviceRef = useRef<string>((() => { try { return sessionStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; } })());
  const hdrs = (): Record<string, string> => ({
    'X-Planner-Recheck-Token': token,
    ...(deviceRef.current ? { 'X-Sender-Auth-Device': deviceRef.current } : {}),
  });
  const senderAuth = useSenderAuth({
    verifyRequest: async (challengeId, code) => {
      const r = await fetch('/api/planner-recheck/auth/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Planner-Recheck-Token': token }, referrerPolicy: 'no-referrer',
        body: JSON.stringify({ challengeId, code }),
      });
      const data = await r.json().catch(() => ({}));
      if (data?.success && typeof data.device === 'string' && /^[0-9a-f]{64}$/.test(data.device)) {
        deviceRef.current = data.device;
        try { sessionStorage.setItem(DEVICE_KEY, data.device); } catch { /* 저장 못 해도 이 화면 동안은 쓴다 */ }
      }
      return data;
    },
  });

  const load = useCallback(async () => {
    if (!token) { setState({ kind: 'invalid' }); return; }
    try {
      const res = await fetch('/api/planner-recheck/view', { headers: hdrs(), referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (tokenRef.current !== token) return;
      if (!res.ok || !data?.success) { setState({ kind: 'invalid' }); return; }
      if (data.closed) { setState({ kind: 'closed', outcome: String(data.closed.outcome || ''), title: String(data.closed.title || ''), date: data.closed.date || null }); return; }
      setState({ kind: 'ready', view: data.view as RecheckView });
    } catch {
      if (tokenRef.current === token) setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'invalid' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { setState({ kind: 'loading' }); polls.current = 0; void load(); }, [load]);

  // 새 문안 준비 · 고친 문안 검사 중이면 다시 읽는다(서버가 몇 분 걸려 끝낸다)
  const waiting = state.kind === 'ready' && !done && (state.view.proposal.state === 'preparing' || state.view.current.state === 'pending');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (polls.current >= POLL_MAX || document.visibilityState !== 'visible') return;
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  const run = async (a: RecheckAction): Promise<void> => {
    if (state.kind !== 'ready' || busy) return;
    const v = state.view;
    setBusy(true);
    setNotice(null);
    try {
      const path = a.kind === 'approve' ? 'approve' : a.kind === 'edit' ? 'edit' : a.kind === 'skip' ? 'skip' : a.kind === 'defer' ? 'defer' : 'cancel';
      const body: Record<string, unknown> = { round: v.pair.round };
      if (a.kind === 'approve') { body.choice = a.choice; body.seenHash = a.choice === 'proposal' ? v.proposal.hash : v.current.hash; }
      if (a.kind === 'edit') { body.text = a.text; body.subject = a.subject; }
      if (a.kind === 'defer') body.toDate = a.toDate;
      const res = await fetch(`/api/planner-recheck/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs() }, referrerPolicy: 'no-referrer', body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (tokenRef.current !== token) return;
      if (res.ok && data?.success) {
        if (a.kind === 'approve') { const at = plannerSendAtText(getSendPolicy()); setDone(data.sendsAt === 'now' ? `보내기로 정했어요. ${Number(data.recipients || 0).toLocaleString('ko-KR')}명에게 곧 나가요.` : data.sendsAt === 'morning' ? `보내기로 정했어요. 오늘${at ? ` ${at}에` : ''} 나가요.` : `보내기로 정했어요. ${plannerDay(String(data.date))}${at ? ` ${at}부터` : '에'} 나가요.`); }
        else if (a.kind === 'skip') setDone(`이 날 발송을 건너뛰었어요.${data.nextSend ? ` 다음 발송 ${plannerDay(String(data.nextSend))}은 그대로 가요.` : ''}`);
        else if (a.kind === 'defer') setDone(`${plannerDay(String(data.to))}로 미뤘어요. 새 날짜 문안을 만들어 검사한 뒤 다시 문자로 알려 드려요.`);
        else if (a.kind === 'cancel') setDone(plannerCancelText(data).text);
        else { setNotice({ tone: 'emerald', text: '고친 문안을 실제 주소로 검사하고 있어요. 통과하면 이 화면에서 바로 보낼 수 있어요.' }); polls.current = 0; await load(); }
        return;
      }
      if (senderAuth.handleResponse(data, () => { if (tokenRef.current === token) void run(a); })) return;
      if (res.status === 410) { setState({ kind: 'invalid' }); return; }
      setNotice({ tone: data?.code === 'LINK_ACTION_PC_ONLY' ? 'amber' : 'rose', text: data?.error || '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
      if (res.status === 409) await load();
    } catch {
      setNotice({ tone: 'rose', text: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode, subtitle?: string) => (
    <LinkShell title="마케팅 플래너 · 발송 다시 정하기" subtitle={subtitle} icon={CalendarCheck} tone="amber" service="한줄로 마케팅 플래너">{children}</LinkShell>
  );

  if (state.kind === 'loading') return shell(<LinkLoading />);
  if (state.kind === 'invalid') {
    return shell(<LinkInvalid title="마감됐거나 내용이 바뀐 주소예요" body="최신 내용은 한줄로 마케팅 플래너 캘린더의 할 일에서 확인해 주세요. 새 확인 문자가 오면 그 주소로 열어 주세요." />);
  }
  if (state.kind === 'closed') {
    return shell(
      <LinkNotice tone="emerald" icon={CheckCircle2}>
        <b>'{state.title}'{state.date ? ` ${plannerDay(state.date)}` : ''} 문자</b> · {CLOSED_TEXT[state.outcome] || '이미 처리됐어요.'} 자세한 내용은 한줄로 마케팅 플래너 캘린더에서 볼 수 있어요.
      </LinkNotice>,
    );
  }
  const v = state.view;
  return (
    <>
      {shell(
        <div className="space-y-4">
          <div>
            <p className="text-[12.5px] text-slate-500">{v.event.companyName}</p>
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-slate-900 break-words">{v.event.title}</h2>
            <p className="text-[12.5px] text-slate-500 tabular-nums">{plannerDay(v.event.startsOn)} ~ {plannerDay(v.event.endsOn)}</p>
          </div>
          {done ? (
            // ★ 2026-10-25 원장 #60 — 통지 사실은 서버가 돌려준 결과로만 말한다(done 문장 · 옛: 늘 「담당자에게 알림이 갔어요」)
            <LinkNotice tone="emerald" icon={CheckCircle2}><b>{done}</b> 이 창은 닫으셔도 돼요.</LinkNotice>
          ) : (
            <>
              {notice && <LinkNotice tone={notice.tone}>{notice.text}</LinkNotice>}
              <PlannerRecheckPanel view={v} mode="link" busy={busy} onAction={run} />
            </>
          )}
        </div>,
        `${plannerDay(v.pair.date)} 문자 · 마감 ${v.deadline.hour}시`,
      )}
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
