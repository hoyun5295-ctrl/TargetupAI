/**
 * PrepaidTermCard — 선불 요금제 이용 기간 카드 (★2026-10-04 · docs/2026-10-04-prepaid-plan-term-design.md §7)
 *
 * /pricing 맨 위. 선불로 요금제를 쓰는 회사(이용 기간 관리 대상)에만 보인다(my-plan.prepaid_term).
 * 금액·날짜·남은 날은 전부 서버가 계산해 내려 준다 — 화면은 계산하지 않는다(×1.1 0곳).
 *
 * - 1개월 연장: 누를 때마다 서버 견적 → 확인 창("추가 결제를 하시겠습니까?") → 결제. 남은 기간 뒤에 이어 붙는다.
 *   요청마다 requestId 하나 — 응답이 끊겨 다시 눌러도 서버가 첫 결과를 돌려준다(두 번 결제 없음).
 * - 자동 연장 스위치: 켜기는 바로, 끄기는 확인 한 단계(만료되면 잠긴다는 것을 알릴 유일한 자리).
 * - 잠김: 원래 요금제 이름 · 사유 · 되는 것 · [잔액 충전] [1개월 연장하고 다시 열기].
 * - 조작은 회사 관리자만(서버 can_manage). 다른 사용자는 읽기 전용.
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarPlus, Lock, Wallet, ChevronDown } from 'lucide-react';
import ZoneStatStrip from './zone/ZoneStatStrip';
import ConfirmDialogShell, { DialogHeadline, DialogRow, DialogCaution } from './shared/ConfirmDialogShell';
import { formatDate, formatDateTimeShort } from '../utils/formatDate';
import { useToast } from './ToastProvider';

export interface PrepaidTermView {
  state: 'active' | 'blocked';
  plan_name: string;
  plan_code: string;
  expires_on: string;
  days_left: number;
  auto_renew: boolean;
  next_charge_date: string | null;
  next_charge_plan_name: string;
  price_supply: number;
  price_vat: number;
  price_total: number;
  next_plan_name: string | null;
  next_plan_from: string | null;
  block_reason: 'insufficient' | 'auto_off' | null;
  block_snapshot: { balance: number; required: number } | null;
  blocked_on: string | null;
  version: number;
  can_manage: boolean;
}

interface Quote {
  version: number;
  plan_name: string;
  restoring: boolean;
  expires_before: string | null;
  days_left: number;
  starts_on: string;
  new_expires: string;
  supply: number;
  vat: number;
  total: number;
  balance: number;
  balance_after: number;
  enough: boolean;
  auto_renew: boolean;
  next_plan_free: boolean;
}

interface TermEvent {
  id: string;
  at: string;
  label: string;
  plan_name: string | null;
  amount_total: number;
  expires_before: string | null;
  expires_after: string | null;
  actor_label: string;
}

const won = (n: number) => `${Math.floor(Number(n) || 0).toLocaleString('ko-KR')}원`;
/** 'YYYY-MM-DD' → 'M월 D일'(칸이 좁아 연도는 제목 줄·확인 창의 전체 날짜가 맡는다) */
const md = (ymd: string | null) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '-';
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}월 ${d}일`;
};
/** 'YYYY-MM-DD' 하루 뒤(시간대 영향 없이 UTC로만) */
const nextDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
/** 서버가 검사하는 UUID 형식(v4)으로 만든다 */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 요금제 신청 창 한 줄 — 선불 이용 기간 회사가 다른 요금제를 신청할 때 승인되면 돈이 어떻게 움직이는지(설계 §5-2).
 * 방향은 서버 판정과 같은 가격 축(월정액 비교)이고 금액은 적지 않는다(승인하는 날 서버가 계산한다).
 */
export function prepaidTermRequestNote(term: PrepaidTermView, currentMonthly: number, plan: { plan_name: string; monthly_price: number }): string {
  if (term.state === 'blocked') {
    return `승인되면 오늘부터 ${plan.plan_name} 요금제 1개월 요금(부가세 포함)이 충전 잔액에서 빠지고 바로 다시 열립니다.`;
  }
  if (Number(plan.monthly_price) >= currentMonthly) {
    return `승인되는 날부터 ${formatDate(term.expires_on)}까지 남은 기간의 요금 차액(부가세 포함)이 충전 잔액에서 빠지고 바로 바뀝니다. 만료일은 그대로입니다.`;
  }
  return `승인되면 ${formatDate(nextDay(term.expires_on))}부터 ${plan.plan_name} 요금제로 바뀝니다. 남은 기간은 지금 요금제로 이용하고 환불되지 않습니다.`;
}

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/companies/plan-term${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

export default function PrepaidTermCard({ term, onChanged, onOpenCharge }: {
  term: PrepaidTermView;
  /** 연장·스위치 뒤 my-plan을 다시 읽는다 */
  onChanged: () => void;
  /** 잔액 충전 창을 연다(확인 창은 먼저 닫힌 상태로 부른다 · 겹침 순서) */
  onOpenCharge: () => void;
}) {
  const toast = useToast();
  const [events, setEvents] = useState<TermEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requestId, setRequestId] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const blocked = term.state === 'blocked';

  const loadEvents = useCallback(async (offset = 0) => {
    const r = await api(`/events?offset=${offset}&limit=${offset === 0 ? 5 : 10}`).catch(() => null);
    if (!r?.ok || !r.body) return;
    setEventsTotal(Number(r.body.total) || 0);
    setEvents((prev) => (offset === 0 ? r.body.rows : [...prev, ...r.body.rows]));
  }, []);

  useEffect(() => { loadEvents(0); }, [loadEvents, term.version]);

  const openExtend = async () => {
    setQuoting(true);
    try {
      const r = await api('/quote');
      if (!r.ok) { toast.error(r.body?.error || '견적을 불러오지 못했습니다.'); return; }
      setQuote(r.body.quote);
      setRequestId(newRequestId());
    } catch {
      toast.error('연결이 끊겼습니다. 잠시 뒤 다시 눌러 주세요.');
    } finally {
      setQuoting(false);
    }
  };

  const closeExtend = () => { if (!paying) setQuote(null); };

  const pay = async () => {
    if (!quote) return;
    if (!quote.enough) { setQuote(null); onOpenCharge(); return; }
    setPaying(true);
    try {
      const r = await api('/extend', { method: 'POST', body: JSON.stringify({ requestId, version: quote.version, total: quote.total }) });
      if (r.ok) {
        const until = r.body?.expires_on;
        toast.success(r.body?.restored
          ? `${quote.plan_name} 요금제가 다시 열렸습니다. ${formatDate(until)}까지 이용합니다.`
          : `${formatDate(until)}까지 연장했습니다. 충전 잔액 ${won(r.body?.balance_after ?? 0)}`);
        setQuote(null);
        onChanged();
        loadEvents(0);
        return;
      }
      if (r.status === 409 && r.body?.quote) {
        setQuote(r.body.quote);
        setRequestId(newRequestId());
        toast.info(r.body?.code === 'NEXT_PLAN_FREE' ? r.body.error : '그사이 이용 기간이나 금액이 바뀌어 바뀐 내용으로 다시 보여 드립니다.');
        return;
      }
      if (r.status === 402) {
        const again = await api('/quote');
        if (again.ok) { setQuote(again.body.quote); setRequestId(newRequestId()); }
        toast.error(r.body?.error || '잔액이 부족합니다.');
        return;
      }
      toast.error(r.body?.error || '결제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    } catch {
      // 같은 requestId를 그대로 둔다 — 다시 누르면 서버가 첫 결과를 돌려준다(두 번 결제 없음)
      toast.error('연결이 끊겼습니다. 다시 누르면 같은 요청으로 확인합니다.');
    } finally {
      setPaying(false);
    }
  };

  const setAuto = async (enabled: boolean) => {
    setToggling(true);
    try {
      const r = await api('/auto-renew', { method: 'PATCH', body: JSON.stringify({ enabled }) });
      if (!r.ok) { toast.error(r.body?.error || '바꾸지 못했습니다.'); return; }
      toast.success(enabled
        ? `${formatDate(nextDay(term.expires_on))}에 충전 잔액에서 ${won(term.price_total)}을 결제하고 1개월 연장합니다.`
        : `자동 연장을 껐습니다. ${formatDate(term.expires_on)}이 지나면 ${term.plan_name} 요금제가 잠깁니다.`);
      setOffOpen(false);
      onChanged();
    } catch {
      toast.error('연결이 끊겼습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setToggling(false);
    }
  };

  const onSwitch = () => {
    if (toggling) return;
    if (term.auto_renew) setOffOpen(true);
    else setAuto(true);
  };

  const nextChargeFree = !blocked && !term.next_charge_date && term.auto_renew;

  return (
    <div className="mb-6 space-y-3" data-testid="prepaid-term-card">
      {blocked ? (
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-500 flex items-center justify-center shrink-0 shadow-md shadow-rose-200">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-bold text-rose-900">{term.plan_name} 요금제가 잠겼습니다</h2>
              <p className="text-[13px] text-rose-800 mt-1 leading-relaxed">
                {term.block_reason === 'auto_off'
                  ? `자동 연장이 꺼져 있어 ${formatDate(term.expires_on)}에 이용 기간이 끝났습니다.`
                  : `충전 잔액이 부족해 ${formatDate(nextDay(term.expires_on))} 자동 연장 결제를 하지 못했습니다.`}
                {term.block_reason !== 'auto_off' && term.block_snapshot && (
                  <span className="text-rose-600"> (그때 잔액 {won(term.block_snapshot.balance)} · 필요 {won(term.block_snapshot.required)})</span>
                )}
              </p>
              <p className="text-[12.5px] text-slate-600 mt-2">문자 직접 발송(예약 포함), 수신거부, 발송결과는 그대로 쓸 수 있습니다. {term.plan_name} 요금제 기능은 다시 열 때까지 쓸 수 없습니다.</p>
              {term.can_manage ? (
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button type="button" onClick={onOpenCharge}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-[13px] font-semibold ring-1 ring-rose-200 bg-white text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center gap-1.5">
                    <Wallet className="w-4 h-4" />잔액 충전
                  </button>
                  <button type="button" onClick={openExtend} disabled={quoting}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-400 hover:to-red-400 shadow-md shadow-rose-200 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    <CalendarPlus className="w-4 h-4" />{quoting ? '불러오는 중...' : '1개월 연장하고 다시 열기'}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-[12.5px] text-slate-500">다시 열기는 회사 관리자만 할 수 있습니다.</p>
              )}
              <p className="mt-3 text-[11.5px] text-slate-500">충전한 뒤 1개월 연장을 누르면 바로 다시 열립니다. 충전만으로는 자동으로 열리지 않습니다.</p>
              <p className="mt-1 text-[10px] text-slate-400 italic">출처: 한줄로 이용 기간 기록 · 금액은 부가세 포함</p>
            </div>
          </div>
        </div>
      ) : (
        <ZoneStatStrip
          title={`${term.plan_name} 요금제 이용 기간 · ${formatDate(term.expires_on)}까지`}
          icon={CalendarClock}
          source="한줄로 이용 기간 기록 · 금액은 부가세 포함"
          cells={[
            { label: '끝나는 날', value: md(term.expires_on), tone: !term.auto_renew && term.days_left <= 7 ? 'amber' : undefined },
            { label: '남은 날', value: term.days_left <= 1 ? '오늘까지' : `${term.days_left}일` },
            { label: '1개월 요금', value: won(term.price_total) },
            { label: '다음 자동 결제', value: term.auto_renew && term.next_charge_date ? md(term.next_charge_date) : '꺼짐', tone: term.auto_renew ? undefined : 'amber' },
          ]}
          footnote={(
            <div className="space-y-3">
              {term.next_plan_name && term.next_plan_from && (
                <p className="text-[12.5px] text-slate-600">
                  {formatDate(term.next_plan_from)}부터 {term.next_plan_name} 요금제로 바뀝니다. 남은 기간은 환불되지 않습니다.
                </p>
              )}
              {term.can_manage ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="flex items-start gap-3 min-w-0">
                    <button type="button" role="switch" aria-checked={term.auto_renew} aria-label="자동 연장"
                      onClick={onSwitch} disabled={toggling}
                      className={`relative mt-0.5 shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${term.auto_renew ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${term.auto_renew ? 'translate-x-5' : ''}`} />
                    </button>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800">자동 연장 {term.auto_renew ? '켬' : '꺼짐'}</p>
                      <p className={`text-[12px] leading-relaxed ${term.auto_renew ? 'text-slate-500' : 'text-amber-700'}`}>
                        {nextChargeFree
                          ? `${formatDate(nextDay(term.expires_on))}부터 미가입으로 바뀌도록 예약되어 있어 자동 결제를 하지 않습니다.`
                          : term.auto_renew
                            ? `${formatDate(nextDay(term.expires_on))}에 충전 잔액에서 ${won(term.price_total)}을 결제하고 1개월 연장합니다. 잔액이 모자라면 요금제가 잠깁니다.`
                            : `${formatDate(term.expires_on)}이 지나면 ${term.plan_name} 요금제가 잠깁니다. 그 전에 직접 1개월 연장할 수 있습니다.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex sm:justify-end">
                    <button type="button" onClick={openExtend} disabled={quoting}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-md shadow-emerald-500/25 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                      <CalendarPlus className="w-4 h-4" />{quoting ? '불러오는 중...' : '1개월 연장'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] text-slate-500">연장과 자동 연장 설정은 회사 관리자만 할 수 있습니다.</p>
              )}
            </div>
          )}
        />
      )}

      {/* 최근 기록 — 고객 화면에서 요금제 결제를 확인하는 유일한 자리 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 pt-3.5 pb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-slate-600">이용 기간 기록</h3>
          <span className="text-[10px] text-slate-400 italic">출처: 한줄로 이용 기간 기록</span>
        </div>
        {events.length === 0 ? (
          <p className="px-5 pb-4 text-[12.5px] text-slate-400">아직 기록이 없습니다.</p>
        ) : (
          <>
            <table className="hidden md:table w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-slate-400 border-y border-slate-100 bg-slate-50/60">
                  <th className="px-5 py-2 font-medium">일시</th>
                  <th className="px-3 py-2 font-medium">내용</th>
                  <th className="px-3 py-2 font-medium text-right">결제 금액</th>
                  <th className="px-3 py-2 font-medium">바뀐 이용 기간</th>
                  <th className="px-5 py-2 font-medium">처리</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{formatDateTimeShort(e.at)}</td>
                    <td className="px-3 py-2.5 text-slate-800">{e.label}{e.plan_name ? ` · ${e.plan_name}` : ''}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{e.amount_total > 0 ? won(e.amount_total) : '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                      {e.expires_before !== e.expires_after && (e.expires_before || e.expires_after)
                        ? `${e.expires_before ? formatDate(e.expires_before) : '없음'} → ${e.expires_after ? formatDate(e.expires_after) : '없음'}`
                        : '-'}
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{e.actor_label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="md:hidden divide-y divide-slate-100 border-t border-slate-100">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-slate-800">{e.label}{e.plan_name ? ` · ${e.plan_name}` : ''}</span>
                    <span className="text-[13px] tabular-nums text-slate-800">{e.amount_total > 0 ? won(e.amount_total) : ''}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-slate-400">
                    {formatDateTimeShort(e.at)} · {e.actor_label}
                    {e.expires_before !== e.expires_after && e.expires_after ? ` · ${formatDate(e.expires_after)}까지` : ''}
                  </div>
                </li>
              ))}
            </ul>
            {events.length < eventsTotal && (
              <button type="button" onClick={() => loadEvents(events.length)}
                className="w-full py-2.5 text-[12.5px] text-slate-500 hover:text-slate-800 hover:bg-slate-50 border-t border-slate-100 inline-flex items-center justify-center gap-1">
                더 보기 <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* 1개월 연장 확인 창 */}
      <ConfirmDialogShell
        show={!!quote}
        tone={quote?.restoring ? 'rose' : 'emerald'}
        icon={<CalendarPlus className="w-5 h-5 text-white" />}
        title="추가 결제를 하시겠습니까?"
        subtitle={quote ? `${quote.plan_name} 요금제 1개월 ${quote.restoring ? '다시 열기' : '연장'}` : undefined}
        onCancel={closeExtend}
        confirmLabel={quote ? (quote.enough ? `${won(quote.total)} 결제하고 ${quote.restoring ? '다시 열기' : '연장'}` : '잔액 충전하기') : undefined}
        onConfirm={pay}
        confirmDisabled={!!quote?.next_plan_free}
        busy={paying}
        busyLabel="결제 중..."
      >
        {quote && (
          <div>
            <DialogHeadline value={Math.floor(quote.total).toLocaleString('ko-KR')} unit="원" label="결제 금액 (부가세 포함)" tone={quote.restoring ? 'rose' : 'emerald'} />
            <p className="mt-1.5 text-[11.5px] text-slate-400">월 요금 {won(quote.supply)} + 부가세 {won(quote.vat)}</p>
            <div className="mt-3">
              {quote.restoring ? (
                <DialogRow label="이용 기간" value={`${formatDate(quote.starts_on)} ~ ${formatDate(quote.new_expires)}`} accent="blue" />
              ) : (
                <>
                  <DialogRow label="지금 이용 기간" value={`${formatDate(quote.expires_before)}까지 (${quote.days_left}일 남음)`} />
                  <DialogRow label="연장 후" value={`${formatDate(quote.new_expires)}까지`} accent="blue" />
                </>
              )}
              <DialogRow label="충전 잔액" value={`${won(quote.balance)} → ${won(quote.balance_after)}`} accent={quote.enough ? undefined : 'rose'} />
            </div>
            {quote.restoring ? (
              <p className="mt-3 text-[12px] text-slate-600 leading-relaxed">결제하면 {quote.plan_name} 요금제가 바로 다시 열립니다.</p>
            ) : (
              <p className="mt-3 text-[12px] text-slate-600 leading-relaxed">
                남은 {quote.days_left}일은 그대로 두고 {formatDate(quote.starts_on)}부터 {formatDate(quote.new_expires)}까지 1개월을 이어 붙입니다.
                {quote.auto_renew && ` 다음 자동 결제일도 ${formatDate(nextDay(quote.new_expires))}로 함께 미뤄집니다.`}
              </p>
            )}
            {quote.next_plan_free && (
              <DialogCaution tone="rose">미가입으로 바뀌도록 예약되어 있어 연장할 수 없습니다. 요금제를 다시 신청해 주세요.</DialogCaution>
            )}
            {!quote.enough && !quote.next_plan_free && (
              <DialogCaution tone="rose">{won(quote.total - quote.balance)}이 부족합니다. 충전한 뒤 다시 눌러 주세요.</DialogCaution>
            )}
          </div>
        )}
      </ConfirmDialogShell>

      {/* 자동 연장 끄기 확인 */}
      <ConfirmDialogShell
        show={offOpen}
        tone="amber"
        icon={<CalendarClock className="w-5 h-5 text-white" />}
        title="자동 연장을 끌까요?"
        onCancel={() => { if (!toggling) setOffOpen(false); }}
        confirmLabel="자동 연장 끄기"
        onConfirm={() => setAuto(false)}
        busy={toggling}
        busyLabel="바꾸는 중..."
      >
        <p className="text-[13px] text-slate-700 leading-relaxed">
          {formatDate(term.expires_on)}이 지나면 {term.plan_name} 요금제가 잠깁니다. 그 전에는 언제든 직접 1개월 연장할 수 있습니다.
        </p>
        <p className="mt-2 text-[12px] text-slate-500">잠겨도 문자 직접 발송, 수신거부, 발송결과는 그대로 쓸 수 있습니다.</p>
      </ConfirmDialogShell>
    </div>
  );
}
