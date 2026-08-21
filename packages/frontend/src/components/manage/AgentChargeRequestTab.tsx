import { useEffect, useMemo, useState } from 'react';
import { formatAgentIdLabel, formatAgentBalance, formatAgentChargeAmount } from '../../utils/agentLabel'; // ★ 2026-07-27 발송ID 표시 규칙 단일 소스

/**
 * ★ 2026-07-27 §5-4 — 에이전트 충전 요청 (고객사 화면)
 *
 * 발송ID(게이트웨이) 지갑은 웹 잔액과 별개다. 여기서는 "입금했으니 충전해 달라"는 접수만 하고,
 * 실제 증액은 담당자가 확인 후 처리한다. 요청 등록만으로 잔액이 오르지 않는다.
 */

// ★ 2026-07-27 잔액 = 게이트웨이 계정 원장 실시간값. 기준일 축은 없다(옛 일별 통계 스냅샷의 잔재).
interface BalanceRow { agentSendId: string; remAmt: number | null; unknownReason?: string | null }
interface OrderRow {
  id: string;
  agentSendId: string;
  /** 발급명(게이트웨이 원장) — 발송ID만으론 어느 계정인지 고객사도 모른다. */
  custName?: string | null;
  amount: number;
  depositorName: string;
  expectedAt: string | null;
  memo: string | null;
  status: string;
  rejectReason: string | null;
  createdAt: string;
}

/**
 * ★ 2026-08-11 충전 내역(게이트웨이 원장) 행 — 신청 여부와 무관한 **실제 지갑 변동**이다.
 * 담당자가 계좌이체 확인 후 직접 넣은 충전과 상계 차감(음수)이 여기에 들어온다.
 */
interface LedgerRow {
  seqNo: number;
  agentSendId: string;
  custName?: string | null;
  amount: number;
  filledAt: string;
  applied: boolean;
  appliedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '접수 대기',
  processing: '충전 처리 중',
  fulfilled: '충전 완료',
  rejected: '반려',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-100',
  processing: 'bg-blue-50 text-blue-700 ring-blue-100',
  fulfilled: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  rejected: 'bg-rose-50 text-rose-600 ring-rose-100',
};

/** 금액 입력 — 숫자만. 요청은 양수 원 단위이므로 부호·소수점을 아예 받지 않는다. */
const sanitizeAmount = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 12);

const PAGE_SIZE = 10;

export default function AgentChargeRequestTab() {
  const [sendIds, setSendIds] = useState<string[]>([]);
  // ★ 2026-07-27 발송ID → 발급명(게이트웨이 원장). 화면 전체가 `발송ID / 발급명` 한 규칙으로 보인다.
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [agentSendId, setAgentSendId] = useState('');
  const [amount, setAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [memo, setMemo] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // ★ 2026-08-11 충전 내역 — 요청 이력과 별개 원장이라 페이징 상태도 따로 둔다.
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotalPages, setLedgerTotalPages] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState('');

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  const loadTargets = async () => {
    try {
      const res = await fetch('/api/agent-charge-orders/targets', { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        const ids: string[] = Array.isArray(d.sendIds) ? d.sendIds : [];
        setSendIds(ids);
        setCustNames(d.custNames && typeof d.custNames === 'object' ? d.custNames : {});
        setBalances(Array.isArray(d.balances) ? d.balances : []);
        if (ids.length === 1) setAgentSendId(ids[0]);
      }
    } catch { /* 목록 로드 실패 시 빈 상태 유지 */ }
    finally { setLoading(false); }
  };

  const loadOrders = async (p = page) => {
    try {
      const res = await fetch(`/api/agent-charge-orders?page=${p}&limit=${PAGE_SIZE}`, { headers: auth() });
      if (res.ok) {
        const d = await res.json();
        setOrders(Array.isArray(d.rows) ? d.rows : []);
        setTotal(Number(d.total) || 0);
        setTotalPages(Math.max(1, Number(d.totalPages) || 1));
        setPage(p);
      }
    } catch { /* 이력 로드 실패 시 기존 유지 */ }
  };

  /**
   * ⛔ 조회 실패를 "내역 없음"으로 보여주지 않는다(★ 2026-08-11 Codex 1R-1).
   * 충전을 했는데 화면이 "아직 충전 내역이 없습니다"를 띄우면 고객사는 충전이 안 된 것으로 읽는다.
   */
  const loadLedger = async (p = ledgerPage) => {
    setLedgerLoading(true);
    try {
      const res = await fetch(`/api/agent-charge-orders/ledger?page=${p}&limit=${PAGE_SIZE}`, { headers: auth() });
      if (!res.ok) {
        setLedger([]);
        setLedgerTotal(0);
        setLedgerTotalPages(1);
        setLedgerError('충전 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
        return;
      }
      const d = await res.json();
      setLedger(Array.isArray(d.rows) ? d.rows : []);
      setLedgerTotal(Number(d.total) || 0);
      setLedgerTotalPages(Math.max(1, Number(d.totalPages) || 1));
      setLedgerPage(p);
      setLedgerError('');
    } catch {
      setLedger([]);
      setLedgerTotal(0);
      setLedgerTotalPages(1);
      setLedgerError('충전 내역을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => {
    loadTargets();
    loadOrders(1);
    loadLedger(1);
  }, []);

  const balanceOf = useMemo(() => {
    const m = new Map<string, BalanceRow>();
    balances.forEach((b) => m.set(b.agentSendId, b));
    return m;
  }, [balances]);

  /** `D0078 / 런소프트` — 행이 이름을 갖고 있으면 그것, 없으면 대상 목록에서 찾는다. */
  const idLabel = (id: string, custName?: string | null) =>
    formatAgentIdLabel(id, custName || custNames[id] || null);

  const submit = async () => {
    setErrorMsg('');
    setOkMsg('');
    if (!agentSendId) { setErrorMsg('발송ID를 선택해 주세요.'); return; }
    if (!amount) { setErrorMsg('충전 요청 금액을 입력해 주세요.'); return; }
    if (!depositorName.trim()) { setErrorMsg('입금자명을 입력해 주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/agent-charge-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({
          agentSendId,
          amount: Number(amount),
          depositorName: depositorName.trim(),
          expectedAt: expectedAt || undefined,
          memo: memo.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErrorMsg(d.error || '충전 요청 등록에 실패했습니다.');
      } else {
        setOkMsg(d.message || '충전 요청이 접수되었습니다.');
        setAmount('');
        setMemo('');
        setExpectedAt('');
        loadOrders(1);
      }
    } catch {
      setErrorMsg('네트워크 오류로 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-sm text-slate-400">
        불러오는 중...
      </div>
    );
  }

  // ★ 2026-08-11 Codex 1R-3 — **선불 지정 여부로 화면 전체를 막지 않는다.**
  //   지금 선불로 지정된 발송ID가 없어도 과거에 담당자가 넣은 충전·차감 기록은 남아 있고,
  //   그것을 보여주는 것이 이번 접수의 요구다. 잠그는 것은 요청 폼과 잔액 카드까지다.
  const canRequest = sendIds.length > 0;

  return (
    <div className="space-y-4">
      {!canRequest && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
          <p className="text-sm font-medium text-slate-700">선불로 지정된 발송ID가 없습니다.</p>
          <p className="mt-1.5 text-xs text-slate-400">
            선불 충전을 이용하시려면 담당자에게 발송ID 선불 지정을 요청해 주세요. 지난 충전 내역은 아래에서 보실 수 있습니다.
          </p>
        </div>
      )}

      {/* 잔액 — 게이트웨이 실값. 기준일을 반드시 함께 보여준다(오래된 값을 현재 잔액으로 읽지 않도록) */}
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 ${canRequest ? '' : 'hidden'}`}>
        <h3 className="text-sm font-semibold text-slate-800">발송ID 잔액</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sendIds.map((id) => {
            const b = balanceOf.get(id);
            return (
              <div key={id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                <div className="font-mono text-xs text-slate-500">{idLabel(id)}</div>
                <div className="mt-1 text-lg font-semibold text-slate-800 tabular-nums">
                  {b && b.remAmt !== null
                    ? `${formatAgentBalance(Number(b.remAmt))}원`
                    : <span className="text-sm font-normal text-slate-400">잔액 확인 불가</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] italic text-slate-300">
          Data source: 발송 게이트웨이 계정 원장 실시간 잔액 (저장 없음). 발송이 나가는 동안 값이 계속 바뀝니다.
        </p>
      </div>

      {/* 요청 폼 — 선불 지정된 발송ID가 있을 때만 (충전 내역·요청 이력은 아래에 그대로 남는다) */}
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${canRequest ? '' : 'hidden'}`}>
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">충전 요청</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            입금 후 요청을 남겨 주시면 담당자가 확인하고 충전해 드립니다. 요청 접수만으로 잔액이 오르지는 않습니다.
          </p>
        </div>

        <div className="p-5 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">발송ID</span>
            <select
              value={agentSendId}
              onChange={(e) => setAgentSendId(e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">선택하세요</option>
              {sendIds.map((id) => <option key={id} value={id}>{idLabel(id)}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">충전 요청 금액</span>
            <div className="mt-1 relative">
              <input
                type="text"
                inputMode="numeric"
                value={amount ? Number(amount).toLocaleString() : ''}
                onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
                placeholder="1,000원 이상"
                className="w-full px-3 py-2.5 pr-8 border border-slate-200 rounded-xl text-sm text-right tabular-nums focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">원</span>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">입금자명</span>
            <input
              type="text"
              value={depositorName}
              onChange={(e) => setDepositorName(e.target.value.slice(0, 50))}
              placeholder="통장에 찍히는 이름"
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">입금일 <span className="text-slate-300">(선택)</span></span>
            <input
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-500">메모 <span className="text-slate-300">(선택)</span></span>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value.slice(0, 200))}
              placeholder="담당자에게 전달할 내용이 있으면 적어 주세요"
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </label>
        </div>

        <div className="px-5 pb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            {errorMsg && <span className="text-rose-500">{errorMsg}</span>}
            {okMsg && <span className="text-emerald-600">{okMsg}</span>}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-sm font-semibold transition-colors shrink-0"
          >
            {submitting ? '접수 중...' : '충전 요청'}
          </button>
        </div>
      </div>

      {/* ★ 2026-08-11 충전 내역 — 신청을 거치지 않은 담당자 직접 충전·차감까지 들어오는 실제 지갑 원장.
          아래 "요청 이력"(신청 원장)과 다른 표다. 접수 = "관리자가 충전·차감한 내역이 남아야 한다". */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              충전 내역
              {ledgerTotal > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">총 {ledgerTotal.toLocaleString()}건</span>}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              담당자가 처리한 충전과 차감이 모두 표시됩니다. 요청을 거치지 않은 입금 확인 충전도 여기에 남습니다.
            </p>
          </div>
          <button type="button" onClick={() => loadLedger(ledgerPage)} className="text-xs text-slate-400 hover:text-slate-600 shrink-0">
            새로고침
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5 font-medium">일시</th>
                <th className="px-3 py-2.5 font-medium">발송ID</th>
                <th className="px-3 py-2.5 font-medium">구분</th>
                <th className="px-3 py-2.5 font-medium text-right">금액</th>
                <th className="px-5 py-2.5 font-medium">반영</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => {
                const isDeduct = l.amount < 0;
                return (
                  <tr key={l.seqNo} className="border-b border-slate-50">
                    <td className="px-5 py-2.5 text-xs text-slate-400 whitespace-nowrap">{String(l.filledAt).slice(0, 16)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{idLabel(l.agentSendId, l.custName)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${
                        isDeduct ? 'bg-rose-50 text-rose-600 ring-rose-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                      }`}>
                        {isDeduct ? '차감' : '충전'}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${isDeduct ? 'text-rose-600' : 'text-slate-800'}`}>
                      {formatAgentChargeAmount(l.amount)}
                    </td>
                    <td className="px-5 py-2.5 text-xs whitespace-nowrap">
                      {/* 반영 완료(게이트웨이가 잔액에 실제로 더한 상태)만 완료로 본다 — 등록 자체는 완료가 아니다. */}
                      {l.applied
                        ? <span className="text-slate-500">반영 완료{l.appliedAt ? ` · ${String(l.appliedAt).slice(5, 16)}` : ''}</span>
                        : <span className="text-amber-600">반영 대기</span>}
                    </td>
                  </tr>
                );
              })}
              {/* ⛔ "없음"과 "못 읽음"을 같은 문구로 내리지 않는다 — 충전했는데 "내역 없음"이 뜨면 안 된 것으로 읽는다. */}
              {ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className={`px-5 py-8 text-center text-xs ${ledgerError ? 'text-rose-500' : 'text-slate-300'}`}>
                    {ledgerError || (ledgerLoading ? '불러오는 중...' : '아직 충전 내역이 없습니다.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {ledgerTotalPages > 1 && (
          <div className="px-5 py-3 flex items-center justify-center gap-2 border-t border-slate-50">
            <button
              type="button"
              disabled={ledgerPage <= 1}
              onClick={() => loadLedger(ledgerPage - 1)}
              className="px-3 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
            >
              이전
            </button>
            <span className="text-xs text-slate-500 tabular-nums">{ledgerPage} / {ledgerTotalPages}</span>
            <button
              type="button"
              disabled={ledgerPage >= ledgerTotalPages}
              onClick={() => loadLedger(ledgerPage + 1)}
              className="px-3 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
            >
              다음
            </button>
          </div>
        )}

        <p className="px-5 pb-4 text-[11px] italic text-slate-300">
          Data source: 발송 게이트웨이 충전 원장 실시간 조회 (저장 없음)
        </p>
      </div>

      {/* 요청 이력 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            요청 이력
            {total > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">총 {total.toLocaleString()}건</span>}
          </h3>
          <button type="button" onClick={() => loadOrders(page)} className="text-xs text-slate-400 hover:text-slate-600">
            새로고침
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5 font-medium">요청일</th>
                <th className="px-3 py-2.5 font-medium">발송ID</th>
                <th className="px-3 py-2.5 font-medium text-right">금액</th>
                <th className="px-3 py-2.5 font-medium">입금자</th>
                <th className="px-5 py-2.5 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-50">
                  <td className="px-5 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                    {String(o.createdAt).slice(0, 10)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{idLabel(o.agentSendId, o.custName)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-800">
                    {o.amount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{o.depositorName}</td>
                  <td className="px-5 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${STATUS_STYLE[o.status] || 'bg-slate-50 text-slate-500 ring-slate-100'}`}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                    {o.status === 'rejected' && o.rejectReason && (
                      <div className="mt-1 text-[11px] text-rose-500">{o.rejectReason}</div>
                    )}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-xs text-slate-300">
                    아직 요청 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-3 flex items-center justify-center gap-2 border-t border-slate-50">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => loadOrders(page - 1)}
              className="px-3 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
            >
              이전
            </button>
            <span className="text-xs text-slate-500 tabular-nums">{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => loadOrders(page + 1)}
              className="px-3 py-1 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
