import { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Wallet, Check, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { creditConversions, calcRechargeAmount } from '../../constants/credit';

/**
 * CreditRechargeModal — AI 크레딧 충전 모달 (D229+ 종량제 Phase B).
 * 크레딧 수량(프리셋+직접입력) → 작업 가능 횟수 + VAT 포함 금액.
 * 선불: 발송 잔액에서 즉시 차감(POST /my-credit/recharge).
 * 후불: 슈퍼관리자 승인 요청 + 월말 문자요금 합산(POST /my-credit/recharge-request).
 * 화이트/모던(요금제·대시보드 톤 일치). 금액의 진실원천은 백엔드 — 화면은 미리보기.
 */
interface Props {
  onClose: () => void;
  onSuccess?: () => void;
}

const PRESETS = [50, 100, 300, 500];
const fmt = (n: number) => Number(n || 0).toLocaleString();

export default function CreditRechargeModal({ onClose, onSuccess }: Props) {
  const [billingType, setBillingType] = useState('prepaid');
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { mode: 'prepaid' | 'request'; credits: number; newBalance?: number }>(null);
  // 멱등키 — 모달 mount 시 1회 생성. 더블클릭·재전송은 같은 키(백엔드 중복 차단). 성공 후 모달 닫힘 → 재충전은 새 모달=새 키.
  const [idemKey] = useState<string>(() =>
    (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/balance', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = await res.json();
          setBillingType(String(d?.billingType || 'prepaid'));
          setBalance(Number(d?.balance || 0));
        }
      } catch { /* 조회 실패 시 기본 선불 */ }
      finally { setLoading(false); }
    })();
  }, []);

  const isPostpaid = billingType === 'postpaid';
  const amt = useMemo(() => calcRechargeAmount(credits), [credits]);
  const conv = useMemo(() => creditConversions(credits), [credits]);
  const insufficient = !isPostpaid && balance < amt.total;

  async function submit() {
    if (credits <= 0) return;
    setSubmitting(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const url = isPostpaid ? '/api/companies/my-credit/recharge-request' : '/api/companies/my-credit/recharge';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credits, idempotencyKey: idemKey }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.success !== false) {
        setDone({ mode: isPostpaid ? 'request' : 'prepaid', credits, newBalance: d?.newBalance });
        onSuccess?.();
      } else if (d?.code === 'DUPLICATE_RECHARGE') {
        // 멱등: 같은 요청이 이미 처리됨 — 오류가 아니라 완료로 표시(이중 차감 0)
        setDone({ mode: 'prepaid', credits });
        onSuccess?.();
      } else {
        setError(d?.error || '처리에 실패했습니다.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="text-sm font-bold text-gray-900">AI 크레딧 충전</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex h-60 items-center justify-center text-gray-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : done ? (
          <div className="px-6 py-8 text-center">
            <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${done.mode === 'prepaid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {done.mode === 'prepaid' ? <Check className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
            </div>
            <div className="text-base font-bold text-gray-900">{done.mode === 'prepaid' ? '충전 완료' : '충전 요청 접수'}</div>
            <div className="mt-1.5 text-sm leading-relaxed text-gray-500">
              {done.mode === 'prepaid'
                ? <>+{fmt(done.credits)} 크레딧이 지급됐습니다.</>
                : <>승인 후 {fmt(done.credits)} 크레딧이 지급되고,<br />금액은 월말 문자요금과 함께 청구됩니다.</>}
            </div>
            {done.mode === 'prepaid' && done.newBalance != null && (
              <div className="mt-3 inline-block rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">충전 후 발송 잔액 {fmt(done.newBalance)}원</div>
            )}
            <button onClick={onClose} className="mt-6 w-full rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700">확인</button>
          </div>
        ) : (
          <>
            <div className="px-5 py-4">
              <div className="mb-2 text-[11px] font-medium text-gray-400">충전할 크레딧</div>
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p} onClick={() => setCredits(p)}
                    className={`rounded-lg border py-2 text-sm font-semibold tabular-nums transition ${credits === p ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {fmt(p)}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <input type="text" inputMode="numeric" value={credits ? fmt(credits) : ''}
                  onChange={(e) => setCredits(Math.max(0, Number(e.target.value.replace(/[^0-9]/g, '')) || 0))}
                  placeholder="직접 입력" className="w-full bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none" />
                <span className="flex-shrink-0 text-xs text-gray-400">크레딧</span>
              </div>

              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="text-[11px] text-gray-400">이 크레딧으로</div>
                <div className="mt-1 text-sm text-gray-700">
                  풀분석 <b className="text-gray-900">{fmt(conv.fullAnalysis)}</b>회 · 모바일 DM <b className="text-gray-900">{fmt(conv.dm)}</b>건 · 문안 <b className="text-gray-900">{fmt(conv.copy)}</b>건
                </div>
              </div>

              <div className="mt-3 flex items-end justify-between rounded-xl border border-violet-100 bg-violet-50 p-3">
                <div className="text-xs text-gray-500">결제 금액 <span className="text-gray-400">(VAT 포함)</span></div>
                <div className="text-xl font-bold tabular-nums text-gray-900">{fmt(amt.total)}<span className="ml-0.5 text-sm font-normal text-gray-400">원</span></div>
              </div>

              {isPostpaid ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                  <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  슈퍼관리자 승인 후 지급되며, 금액은 월말 문자 사용요금과 함께 청구됩니다.
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-gray-500"><Wallet className="h-3.5 w-3.5" /> 발송 잔액에서 차감</span>
                  <span className={insufficient ? 'text-rose-600' : 'text-gray-600'}>
                    {fmt(balance)}원{insufficient ? ' (부족)' : ` → ${fmt(balance - amt.total)}원`}
                  </span>
                </div>
              )}

              {insufficient && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> 발송 잔액이 부족합니다. 먼저 잔액을 충전해주세요.
                </div>
              )}
              {error && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 px-5 py-4">
              <button onClick={submit} disabled={submitting || credits <= 0 || insufficient}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-semibold text-white transition hover:from-violet-700 hover:to-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-40">
                {submitting ? '처리 중...' : isPostpaid ? `${fmt(amt.total)}원 충전 요청` : `${fmt(amt.total)}원 충전하기`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
