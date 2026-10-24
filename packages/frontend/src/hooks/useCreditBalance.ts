/**
 * useCreditBalance — 지금 크레딧 잔액(★ 2026-10-24 자동 마케팅 한 줄 창의 「잔액 a → b」 · 대시보드와 같은 주소)
 *   열려 있을 때만 읽는다. 크레딧제 미적용 회사 = enabled false(잔액으로 잠그지 않는다). 못 읽으면 null(금액만 보인다).
 */
import { useEffect, useState } from 'react';

export function useCreditBalance(open: boolean, refreshKey?: unknown): { total: number; enabled: boolean } | null {
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
        const d = await res.json().catch(() => null);
        if (alive && res.ok && d && d.success !== false) setBalance({ total: Number(d.total) || 0, enabled: d.creditEnabled !== false });
      } catch { /* 잔액 줄만 못 보인다 */ }
    })();
    return () => { alive = false; };
  }, [open, refreshKey]);
  return balance;
}
