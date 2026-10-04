/**
 * PlanTermBox — 슈퍼관리자 회사 수정 · 단가/요금 탭의 "선불 이용 기간" 상자 (★2026-10-04 · docs/2026-10-04-prepaid-plan-term-design.md §7)
 *
 * - 기간이 없는 선불 유료 회사: [이용 기간 시작](결제 없음 · 만료일 지정 · 자동 연장 켬). 만료일을 어제로 두면 다음 정산(10분 안)에 첫 결제.
 * - 관리 중: 상태 · 자동 연장 스위치(대리 변경 · 처리자 기록) · 만료일 조정(돈 이동 없음) · [관리 종료](요금제 그대로 · 환불 없음) · 최근 기록.
 * - 유료 대리 연장 버튼은 두지 않는다(고객 관리자만 결제한다 · D5).
 * 조작마다 회차(version)를 같이 보낸다 — 그사이 고객이 연장했으면 409로 막고 상자를 다시 읽는다.
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Lock, Power } from 'lucide-react';
import ConfirmDialogShell, { DialogRow } from '../shared/ConfirmDialogShell';
import { formatDate, formatDateTimeShort } from '../../utils/formatDate';
import { useToast } from '../ToastProvider';
import type { PrepaidTermView } from '../PrepaidTermCard';

interface AdminState {
  ready: boolean;
  managed: boolean;
  view: PrepaidTermView | null;
  startable: boolean;
  start_block_reason: string | null;
  default_expires_on: string;
  plan_name: string | null;
  events: Array<{ id: string; at: string; label: string; plan_name: string | null; amount_total: number; expires_before: string | null; expires_after: string | null; actor_label: string; reason: string | null }>;
}

type Pending = { kind: 'start' | 'expires' | 'end' | 'auto_off' | 'auto_on' } | null;

const won = (n: number) => `${Math.floor(Number(n) || 0).toLocaleString('ko-KR')}원`;

/**
 * 기본정보 탭 요금제 칸 아래 한 줄 — 관리 중 회사는 여기서 요금제를 바꾸면 서버가 409로 막는다.
 * 저장한 뒤에야 거절을 보게 하지 않으려고 미리 알린다(관리 대상이 아니면 아무것도 그리지 않는다).
 */
export function PlanTermLockNote({ companyId }: { companyId: string }) {
  const [view, setView] = useState<PrepaidTermView | null>(null);
  useEffect(() => {
    let alive = true;
    const token = localStorage.getItem('token');
    fetch(`/api/admin/companies/${companyId}/plan-term`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (alive) setView(b?.managed ? b.view : null); })
      .catch(() => { if (alive) setView(null); });
    return () => { alive = false; };
  }, [companyId]);
  if (!view) return null;
  return (
    <p className="mt-1 text-[11.5px] text-amber-700">
      선불 이용 기간 중({view.state === 'blocked' ? '잠김' : `${formatDate(view.expires_on)}까지`})이라 여기서는 요금제를 바꿀 수 없습니다. 요금제 변경은 고객 신청 승인으로, 종료는 단가/요금 탭에서 합니다.
    </p>
  );
}

export default function PlanTermBox({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [st, setSt] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/companies/${companyId}/plan-term${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('');
      if (r.ok) {
        setSt(r.body);
        setDate(r.body?.view?.expires_on || r.body?.default_expires_on || '');
      } else {
        setSt(null);
      }
    } catch {
      setSt(null);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!pending || !st) return;
    setBusy(true);
    try {
      const version = st.view?.version;
      const r = pending.kind === 'start'
        ? await call('/start', { method: 'POST', body: JSON.stringify({ expiresOn: date, reason }) })
        : pending.kind === 'expires'
          ? await call('/expires', { method: 'PATCH', body: JSON.stringify({ expiresOn: date, reason, version }) })
          : pending.kind === 'end'
            ? await call('/end', { method: 'POST', body: JSON.stringify({ reason, version }) })
            : await call('/auto-renew', { method: 'PATCH', body: JSON.stringify({ enabled: pending.kind === 'auto_on' }) });
      if (r.ok) {
        toast.success(pending.kind === 'start' ? '이용 기간을 시작했습니다.' : pending.kind === 'expires' ? '만료일을 바꿨습니다.' : pending.kind === 'end' ? '이용 기간 관리를 끝냈습니다.' : '자동 연장을 바꿨습니다.');
        setReason('');
      } else {
        toast.error(r.body?.error || '처리하지 못했습니다.');
      }
      setPending(null);
      load();
    } catch {
      toast.error('연결이 끊겼습니다. 상자를 다시 읽은 뒤 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !st) return <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-400">이용 기간 불러오는 중...</div>;
  if (!st) return null;

  const v = st.view;
  const needReason = pending?.kind === 'start' || pending?.kind === 'expires' || pending?.kind === 'end';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="admin-plan-term-box">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <CalendarClock className="w-4 h-4 text-slate-500" />선불 이용 기간
        </div>
        <span className="text-[10px] text-slate-400 italic">출처: 이용 기간 원장</span>
      </div>

      {!st.ready ? (
        <p className="text-xs text-slate-500">DB 마이그레이션 전입니다. 표 생성 뒤 이용할 수 있습니다.</p>
      ) : !st.managed ? (
        st.startable ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-3 py-2">
              이용 기간이 없어 {st.plan_name} 요금제 월 요금을 받지 않고 있습니다. 첫 만료일을 정하면 그 다음 날부터 자동 연장 결제가 돕니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="첫 만료일"
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (필수)"
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <button type="button" disabled={!date || !reason.trim()} onClick={() => setPending({ kind: 'start' })}
              className="w-full py-2.5 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              이용 기간 시작
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{st.start_block_reason || '이용 기간 대상이 아닙니다.'}</p>
        )
      ) : v && (
        <div className="space-y-3">
          <div className={`rounded-lg px-3 py-2.5 text-xs ${v.state === 'blocked' ? 'bg-rose-50 ring-1 ring-rose-200 text-rose-800' : 'bg-slate-50 ring-1 ring-slate-200 text-slate-700'}`}>
            {v.state === 'blocked' ? (
              <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />잠김 · 다시 열 요금제 {v.plan_name} · {v.block_reason === 'auto_off' ? '자동 연장 꺼짐' : '잔액 부족'}{v.blocked_on ? ` · ${formatDate(v.blocked_on)}` : ''}</span>
            ) : (
              <span>{v.plan_name} · {formatDate(v.expires_on)}까지 · {v.days_left}일 남음 · 1개월 {won(v.price_total)}(부가세 포함)</span>
            )}
            {v.next_plan_name && v.next_plan_from && <div className="mt-1 text-slate-500">{formatDate(v.next_plan_from)}부터 {v.next_plan_name} 요금제(예약)</div>}
          </div>

          {v.state !== 'blocked' && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">자동 연장 <b className={v.auto_renew ? 'text-emerald-700' : 'text-amber-700'}>{v.auto_renew ? '켬' : '꺼짐'}</b></div>
              <button type="button" role="switch" aria-checked={v.auto_renew} aria-label="자동 연장(대리 변경)"
                onClick={() => setPending({ kind: v.auto_renew ? 'auto_off' : 'auto_on' })}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${v.auto_renew ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${v.auto_renew ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="만료일" disabled={v.state === 'blocked'}
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-slate-50" />
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유 (만료일 조정·관리 종료 필수)"
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={v.state === 'blocked' || !date || date === v.expires_on || !reason.trim()} onClick={() => setPending({ kind: 'expires' })}
                className="py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-900 text-white disabled:opacity-40">만료일 저장</button>
              <button type="button" disabled={!reason.trim()} onClick={() => setPending({ kind: 'end' })}
                className="py-2 text-xs font-medium rounded-lg ring-1 ring-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Power className="w-3.5 h-3.5" />관리 종료</button>
            </div>
          </div>
        </div>
      )}

      {st.events.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-bold text-gray-700 mb-2">최근 기록</div>
          <ul className="max-h-[200px] overflow-y-auto space-y-1">
            {st.events.map((e) => (
              <li key={e.id} className="text-[11px] px-2 py-1.5 bg-slate-50 rounded border border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">{e.label}{e.plan_name ? ` · ${e.plan_name}` : ''}</span>
                  <span className="tabular-nums text-slate-700">{e.amount_total > 0 ? `-${won(e.amount_total)}` : ''}</span>
                </div>
                <div className="text-slate-400 mt-0.5">
                  {formatDateTimeShort(e.at)} · {e.actor_label}
                  {e.expires_before !== e.expires_after && (e.expires_before || e.expires_after) ? ` · ${e.expires_before ? formatDate(e.expires_before) : '없음'} → ${e.expires_after ? formatDate(e.expires_after) : '없음'}` : ''}
                  {e.reason ? ` · ${e.reason}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialogShell
        show={!!pending}
        tone={pending?.kind === 'end' || pending?.kind === 'auto_off' ? 'amber' : 'emerald'}
        icon={<CalendarClock className="w-5 h-5 text-white" />}
        title={pending?.kind === 'start' ? '이용 기간을 시작할까요?'
          : pending?.kind === 'expires' ? '만료일을 바꿀까요?'
          : pending?.kind === 'end' ? '이용 기간 관리를 끝낼까요?'
          : pending?.kind === 'auto_off' ? '자동 연장을 끌까요?' : '자동 연장을 켤까요?'}
        onCancel={() => { if (!busy) setPending(null); }}
        confirmLabel="확인"
        onConfirm={run}
        confirmDisabled={needReason && !reason.trim()}
        busy={busy}
      >
        {pending?.kind === 'start' && (
          <div className="text-[13px] text-slate-700 leading-relaxed">
            결제 없이 {formatDate(date)}까지 이용 기간을 엽니다. 그 다음 날 충전 잔액에서 1개월 요금을 자동 결제합니다(잔액이 모자라면 요금제가 잠깁니다).
            <DialogRow label="사유" value={reason} />
          </div>
        )}
        {pending?.kind === 'expires' && v && (
          <div className="text-[13px] text-slate-700 leading-relaxed">
            돈은 움직이지 않습니다.
            <DialogRow label="만료일" value={`${formatDate(v.expires_on)} → ${formatDate(date)}`} accent="blue" />
            <DialogRow label="사유" value={reason} />
          </div>
        )}
        {pending?.kind === 'end' && (
          <div className="text-[13px] text-slate-700 leading-relaxed">
            요금제는 그대로 두고 이용 기간 관리만 끝냅니다. 남은 기간은 환불되지 않고, 이후 월 요금 자동 결제도 하지 않습니다. 필요하면 잔액 조정으로 처리해 주세요.
            <DialogRow label="사유" value={reason} />
          </div>
        )}
        {(pending?.kind === 'auto_off' || pending?.kind === 'auto_on') && (
          <p className="text-[13px] text-slate-700 leading-relaxed">
            {pending.kind === 'auto_off'
              ? '고객사 대신 자동 연장을 끕니다. 만료일이 지나면 요금제가 잠깁니다. 기록에 처리자가 남습니다.'
              : '고객사 대신 자동 연장을 켭니다. 만료 다음 날 충전 잔액에서 1개월 요금을 결제합니다. 기록에 처리자가 남습니다.'}
          </p>
        )}
      </ConfirmDialogShell>
    </div>
  );
}
