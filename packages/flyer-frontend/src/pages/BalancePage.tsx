import { useState, useEffect } from 'react';
import { API_BASE } from '../App';
import { StatCard, DataTable, Badge } from '../components/ui';

interface BalanceInfo { balance: number; billing_type: string; }
interface Transaction { id: string; amount: number; type: string; description: string; created_at: string; }

export default function BalancePage({ token }: { token: string }) {
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        const [bRes, tRes] = await Promise.all([
          fetch(`${API_BASE}/api/balance`, { headers }),
          fetch(`${API_BASE}/api/balance/transactions?limit=30`, { headers }),
        ]);
        if (bRes.ok) setBalance(await bRes.json());
        if (tRes.ok) { const d = await tRes.json(); setTransactions(d.transactions || d || []); }
      } catch {}
      finally { setLoading(false); }
    })();
  }, [token]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; };
  const fmtMoney = (n: number) => n.toLocaleString();

  if (loading) return <div className="text-center py-20 text-text-muted">로딩 중...</div>;

  return (
    <>
      <h2 className="text-lg font-bold text-text mb-6">충전 관리</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="현재 잔액" value={balance ? `${fmtMoney(balance.balance)}원` : '-'} sub={balance?.billing_type === 'prepaid' ? '선불 요금제' : '후불 요금제'} className="md:col-span-1" />
      </div>

      <h3 className="text-sm font-bold text-text mb-3">충전/사용 내역</h3>
      <DataTable
        emptyMessage="거래 내역이 없습니다"
        columns={[
          { key: 'description', label: '내역', render: (v) => <span className="font-medium text-text">{v || '-'}</span> },
          { key: 'type', label: '구분', align: 'center', render: (v) => <Badge variant={v === 'charge' ? 'success' : 'error'}>{v === 'charge' ? '충전' : '사용'}</Badge> },
          { key: 'amount', label: '금액', align: 'right', render: (v) => <span className={`font-semibold ${v > 0 ? 'text-success-600' : 'text-error-500'}`}>{v > 0 ? '+' : ''}{fmtMoney(v)}원</span> },
          { key: 'created_at', label: '날짜', align: 'center', render: (v) => <span className="text-text-muted">{fmtDate(v)}</span> },
        ]}
        rows={transactions}
      />
    </>
  );
}
