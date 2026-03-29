import { useState, useEffect } from 'react';
import { API_BASE } from '../App';

interface BalanceInfo {
  balance: number;
  billing_type: string;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

export default function BalancePage({ token }: { token: string }) {
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    (async () => {
      try {
        const balRes = await fetch(`${API_BASE}/api/balance`, { headers });
        if (balRes.ok) {
          const data = await balRes.json();
          setBalance(data);
        }

        const txRes = await fetch(`${API_BASE}/api/balance/transactions?limit=30`, { headers });
        if (txRes.ok) {
          const data = await txRes.json();
          setTransactions(data.transactions || data || []);
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [token]);

  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getFullYear()}.${dt.getMonth()+1}.${dt.getDate()}`; };
  const fmtMoney = (n: number) => n.toLocaleString();

  if (loading) return <div className="text-center py-20 text-gray-400">로딩 중...</div>;

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-6">충전 관리</h2>

      {/* 잔액 카드 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 max-w-md">
        <p className="text-sm text-gray-500 mb-1">현재 잔액</p>
        <p className="text-3xl font-bold text-gray-800">
          {balance ? `${fmtMoney(balance.balance)}원` : '-'}
        </p>
        <p className="text-xs text-gray-400 mt-2">
          {balance?.billing_type === 'prepaid' ? '선불 요금제' : '후불 요금제'}
        </p>
      </div>

      {/* 거래 내역 */}
      <h3 className="text-sm font-bold text-gray-700 mb-3">충전/사용 내역</h3>
      {transactions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">거래 내역이 없습니다</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">내역</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">구분</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">금액</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">날짜</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{tx.description || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tx.type === 'charge' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {tx.type === 'charge' ? '충전' : '사용'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${tx.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tx.amount > 0 ? '+' : ''}{fmtMoney(tx.amount)}원
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400">{fmtDate(tx.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
