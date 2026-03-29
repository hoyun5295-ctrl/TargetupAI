import { useState, useEffect } from 'react';
import { API_BASE, apiFetch } from '../App';
import AlertModal from '../components/AlertModal';
import { SectionCard, StatCard, DataTable, Badge, Button, Input, Select } from '../components/ui';

interface BalanceInfo { balance: number; billing_type: string; costPerSms?: number; costPerLms?: number; costPerMms?: number; }
interface Transaction { id: string; amount: number; type: string; description: string; created_at: string; }
interface MonthlySummary { month: string; total_charged: number; total_deducted: number; total_refunded: number; transaction_count: number; }

export default function BalancePage({ token }: { token: string }) {
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 충전 요청
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [depositing, setDepositing] = useState(false);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });
  // apiFetch가 자동으로 Authorization 헤더 추가
  const PER_PAGE = 20;

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (typeFilter) params.set('type', typeFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const [bRes, tRes, sRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/balance`),
        apiFetch(`${API_BASE}/api/balance/transactions?${params}`),
        apiFetch(`${API_BASE}/api/balance/summary?months=6`),
      ]);
      if (bRes.ok) setBalance(await bRes.json());
      if (tRes.ok) { const d = await tRes.json(); setTransactions(d.transactions || d || []); setTotal(d.total || 0); }
      if (sRes.ok) { const d = await sRes.json(); setSummary(d.summary || []); }
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [token, page, typeFilter, startDate, endDate]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };
  const fmtMoney = (n: number) => n.toLocaleString();
  const totalPages = Math.ceil(total / PER_PAGE);

  const handleDeposit = async () => {
    const amount = Number(depositAmount.replace(/,/g, ''));
    if (!amount || amount < 1000) { setAlert({ show: true, title: '금액 오류', message: '최소 1,000원 이상 입력해주세요.', type: 'error' }); return; }
    if (!depositorName.trim()) { setAlert({ show: true, title: '입력 오류', message: '입금자명을 입력해주세요.', type: 'error' }); return; }

    setDepositing(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/balance/deposit-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, depositorName: depositorName.trim() }),
      });
      if (res.ok) {
        setAlert({ show: true, title: '충전 요청 완료', message: `${fmtMoney(amount)}원 충전 요청이 접수되었습니다.\n입금 확인 후 자동 충전됩니다.`, type: 'success' });
        setShowDeposit(false); setDepositAmount(''); setDepositorName('');
        loadData();
      } else {
        const e = await res.json();
        setAlert({ show: true, title: '요청 실패', message: e.error || '충전 요청에 실패했습니다.', type: 'error' });
      }
    } catch { setAlert({ show: true, title: '오���', message: '네트워크 오류', type: 'error' }); }
    finally { setDepositing(false); }
  };

  const typeLabel = (t: string) => {
    const map: Record<string, { variant: 'success' | 'error' | 'warn' | 'neutral'; label: string }> = {
      charge: { variant: 'success', label: '충전' },
      deposit_charge: { variant: 'success', label: '입금충전' },
      admin_charge: { variant: 'success', label: '관리자충전' },
      deduct: { variant: 'error', label: '사용' },
      refund: { variant: 'warn', label: '환불' },
      admin_deduct: { variant: 'error', label: '관리자차감' },
    };
    const m = map[t] || { variant: 'neutral' as const, label: t };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  if (loading && !balance) return <div className="text-center py-20 text-text-muted">로딩 중...</div>;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-text">충전 관리</h2>
        {balance?.billing_type === 'prepaid' && (
          <Button onClick={() => setShowDeposit(!showDeposit)}>{showDeposit ? '닫기' : '충전 요청'}</Button>
        )}
      </div>

      {/* 잔액 + 월별 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="현재 잔액" value={balance ? `${fmtMoney(balance.balance)}원` : '-'} sub={balance?.billing_type === 'prepaid' ? '선불 요금제' : '후불 요금제'} className="md:col-span-1" />
        {summary.length > 0 && (
          <>
            <StatCard label="이번 달 충전" value={`${fmtMoney(summary[0]?.total_charged || 0)}원`} sub={summary[0]?.month || ''} />
            <StatCard label="이번 달 사용" value={`${fmtMoney(Math.abs(summary[0]?.total_deducted || 0))}원`} sub={`${summary[0]?.transaction_count || 0}건`} />
            {summary[0]?.total_refunded ? (
              <StatCard label="이번 달 환불" value={`${fmtMoney(summary[0].total_refunded)}원`} />
            ) : null}
          </>
        )}
      </div>

      {/* 충전 요청 폼 */}
      {showDeposit && (
        <SectionCard title="충전 요청" className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <Input label="충전 금액 (원)" type="text" value={depositAmount} onChange={e => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              setDepositAmount(v ? Number(v).toLocaleString() : '');
            }} placeholder="최소 1,000원" />
            <Input label="입금자명" value={depositorName} onChange={e => setDepositorName(e.target.value)} placeholder="입금자명을 입력하세요" />
            <Button disabled={depositing} onClick={handleDeposit}>{depositing ? '요청 중...' : '충전 요청'}</Button>
          </div>
          <div className="mt-3 p-3 bg-primary-50 rounded-lg">
            <p className="text-xs text-primary-600 font-medium">충전 요청 후 아래 계좌로 입금해주세요. 입금 확인 후 자동 충전됩니다.</p>
            <p className="text-xs text-text-muted mt-1">* 정확한 입금 계좌는 관리자에게 문의해주세요.</p>
          </div>
        </SectionCard>
      )}

      {/* 필터 */}
      <div className="flex items-end gap-3 mb-4">
        <div className="w-32">
          <Select label="구분" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">전체</option>
            <option value="charge">충전</option>
            <option value="deduct">사용</option>
            <option value="refund">환불</option>
          </Select>
        </div>
        <div className="w-36">
          <Input label="시작일" type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
        </div>
        <div className="w-36">
          <Input label="종료일" type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
        </div>
        {(typeFilter || startDate || endDate) && (
          <Button variant="ghost" size="sm" onClick={() => { setTypeFilter(''); setStartDate(''); setEndDate(''); setPage(1); }}>초기화</Button>
        )}
      </div>

      {/* 거래 내역 */}
      <DataTable
        emptyMessage="거래 내역이 없습니다"
        columns={[
          { key: 'description', label: '내역', render: (v) => <span className="font-medium text-text">{v || '-'}</span> },
          { key: 'type', label: '구분', align: 'center', render: (v) => typeLabel(v) },
          { key: 'amount', label: '금액', align: 'right', render: (v) => <span className={`font-semibold ${v > 0 ? 'text-success-600' : 'text-error-500'}`}>{v > 0 ? '+' : ''}{fmtMoney(v)}원</span> },
          { key: 'created_at', label: '날짜', align: 'center', render: (v) => <span className="text-text-muted text-xs">{fmtDate(v)}</span> },
        ]}
        rows={transactions}
      />

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-6">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg disabled:opacity-30 transition-colors">이전</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 text-xs font-semibold rounded-lg transition-colors ${page === p ? 'bg-primary-600 text-white' : 'text-text-secondary hover:bg-bg'}`}
              >{p}</button>
            );
          })}
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-text-secondary hover:bg-bg disabled:opacity-30 transition-colors">다음</button>
        </div>
      )}

      <AlertModal alert={alert} onClose={() => setAlert({ ...alert, show: false })} />
    </>
  );
}
