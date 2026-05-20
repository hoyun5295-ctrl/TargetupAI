import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { COMPANY_NAME } from '../constants/company';

interface BalanceInfo {
  billingType: string;
  balance: number;
  costPerSms: number;
  costPerLms: number;
  costPerMms: number;
  costPerKakao: number;
}

interface BalanceModalsProps {
  showBalanceModal: boolean;
  setShowBalanceModal: (v: boolean) => void;
  showChargeModal: boolean;
  setShowChargeModal: (v: boolean) => void;
  balanceInfo: BalanceInfo | null;
  showInsufficientBalance: { show: boolean; balance: number; required: number } | null;
  setShowInsufficientBalance: (v: { show: boolean; balance: number; required: number } | null) => void;
}

type ChargeStep = 'select' | 'card' | 'deposit';

const PRESET_AMOUNTS = [10000, 30000, 50000, 100000, 300000, 500000];

export default function BalanceModals({
  showBalanceModal, setShowBalanceModal,
  showChargeModal, setShowChargeModal,
  balanceInfo,
  showInsufficientBalance, setShowInsufficientBalance,
}: BalanceModalsProps) {
  const [chargeStep, setChargeStep] = useState<ChargeStep>('select');

  // 무통장입금 영역
  const [depositAmount, setDepositAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);

  // 카드결제 영역
  const [cardAmount, setCardAmount] = useState('');
  const [cardBuyerName, setCardBuyerName] = useState('');
  const [cardBuyerEmail, setCardBuyerEmail] = useState('');
  const [cardBuyerTel, setCardBuyerTel] = useState('');
  const [cardSubmitting, setCardSubmitting] = useState(false);

  // 결제 결과 postMessage 수신 영역
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'INICIS_PAYMENT_RESULT') return;
      if (data.status === 'success') {
        const amt = Number(data.amount || 0);
        const bal = Number(data.newBalance || 0);
        if (data.alreadyProcessed) {
          alert('이미 처리된 결제입니다.');
        } else {
          alert(`결제가 완료되었습니다.\n충전: ${amt.toLocaleString()}원\n잔액: ${bal.toLocaleString()}원`);
        }
        setShowChargeModal(false);
        setChargeStep('select');
        window.location.reload();
      } else if (data.status === 'cancelled') {
        // 사용자 취소 = 별도 안내 X
      } else if (data.status === 'failed') {
        alert(`결제 실패: ${data.resultMsg || '알 수 없는 오류'}`);
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setShowChargeModal]);

  async function handleCardSubmit() {
    const amt = Number(cardAmount);
    if (!amt || amt < 1000) { alert('1,000원 이상 입력해주세요.'); return; }
    if (amt > 100_000_000) { alert('1억원 이하 입력해주세요.'); return; }
    if (!cardBuyerName.trim()) { alert('구매자명을 입력해주세요.'); return; }

    setCardSubmitting(true);
    try {
      const res = await fetch('/api/payments/inicis/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}` },
        body: JSON.stringify({
          amount: amt,
          buyerName: cardBuyerName.trim(),
          buyerEmail: cardBuyerEmail.trim(),
          buyerTel: cardBuyerTel.replace(/[^0-9]/g, ''),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '결제 준비 실패');
        setCardSubmitting(false);
        return;
      }
      const { form } = await res.json();
      await loadInicisStdPay(form.stdpayUrl);
      submitInicisForm(form);
    } catch (e: any) {
      alert(`네트워크 오류: ${e.message || e}`);
    } finally {
      setCardSubmitting(false);
    }
  }

  return (
    <>
      {/* 잔액 현황 모달 */}
      {showBalanceModal && balanceInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={() => setShowBalanceModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            <div className="p-5 bg-gradient-to-r from-emerald-50 to-green-50 border-b">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-xl">💰</div>
                <div>
                  <div className="text-sm text-gray-500">충전 잔액</div>
                  <div className={`text-2xl font-bold ${balanceInfo.balance < 10000 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {balanceInfo.balance.toLocaleString()}원
                  </div>
                </div>
              </div>
              {balanceInfo.balance < 10000 && (
                <div className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1.5 flex items-center gap-1">
                  <span>⚠️</span> 잔액이 부족합니다. 충전 후 발송해주세요.
                </div>
              )}
            </div>
            <div className="p-5">
              <div className="text-xs text-gray-400 font-medium mb-3">발송 가능 건수</div>
              <div className="space-y-2.5">
                {[
                  { label: 'SMS', price: balanceInfo.costPerSms },
                  { label: 'LMS', price: balanceInfo.costPerLms },
                  ...(balanceInfo.costPerMms && balanceInfo.costPerMms > 0 ? [{ label: 'MMS' as const, price: balanceInfo.costPerMms }] : []),
                  ...(balanceInfo.costPerKakao && balanceInfo.costPerKakao > 0 ? [{ label: '카카오톡' as const, price: balanceInfo.costPerKakao }] : []),
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">{item.label}</span>
                      <span className="text-xs text-gray-400">@{item.price}원</span>
                    </div>
                    <span className="text-sm font-bold text-gray-800">
                      {item.price > 0 ? `${Math.floor(balanceInfo.balance / item.price).toLocaleString()}건` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 pb-5 space-y-2">
              <button
                onClick={() => {
                  setShowBalanceModal(false);
                  setChargeStep('select');
                  setDepositSuccess(false);
                  setShowChargeModal(true);
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors text-sm"
              >
                잔액 충전하기
              </button>
              <button
                onClick={() => setShowBalanceModal(false)}
                className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 잔액 충전 모달 */}
      {showChargeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[65]">
          <div className="bg-white rounded-2xl shadow-2xl w-[460px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>

            {/* 충전 방법 선택 */}
            {chargeStep === 'select' && (
              <>
                <div className="px-6 pt-6 pb-5 border-b">
                  <h3 className="text-xl font-bold text-gray-900">잔액 충전</h3>
                  <p className="text-xs text-gray-500 mt-1">충전 방법을 선택해주세요</p>
                </div>
                <div className="p-6 space-y-3">
                  {/* 카드결제 — 강조 영역 */}
                  <button
                    onClick={() => {
                      setChargeStep('card');
                      setCardAmount('');
                      setCardBuyerName('');
                      setCardBuyerEmail('');
                      setCardBuyerTel('');
                    }}
                    className="w-full p-5 rounded-xl border-2 border-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 hover:border-blue-600 transition-all text-left shadow-sm hover:shadow-md group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-white rounded-xl flex items-center justify-center shadow-sm">
                        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <rect x="2" y="5" width="20" height="14" rx="2" ry="2"/>
                          <line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-bold text-gray-900">카드결제</div>
                          <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full font-medium">즉시 충전</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">신용/체크카드 · 무이자 할부 가능</div>
                      </div>
                      <div className="text-blue-500 text-lg group-hover:translate-x-1 transition-transform">→</div>
                    </div>
                  </button>

                  {/* 무통장입금 — 보조 영역 */}
                  <button
                    onClick={() => {
                      setChargeStep('deposit');
                      setDepositAmount('');
                      setDepositorName('');
                      setDepositSuccess(false);
                    }}
                    className="w-full p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-700">무통장입금</div>
                        <div className="text-xs text-gray-500 mt-0.5">계좌이체 후 입금 확인 요청</div>
                      </div>
                      <div className="text-gray-400 text-sm">→</div>
                    </div>
                  </button>
                </div>
                <div className="px-6 pb-6">
                  <button onClick={() => setShowChargeModal(false)} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    닫기
                  </button>
                </div>
              </>
            )}

            {/* 카드결제 폼 */}
            {chargeStep === 'card' && (
              <>
                <div className="px-6 pt-6 pb-5 border-b">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setChargeStep('select')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">←</button>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">카드결제</h3>
                      <p className="text-xs text-gray-500 mt-0.5">신용/체크카드 즉시 충전</p>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  {/* 금액 입력 */}
                  <div>
                    <label className="text-xs text-gray-600 font-medium mb-1.5 block">충전 금액 <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <input
                        type="text"
                        value={cardAmount ? Number(cardAmount).toLocaleString() : ''}
                        onChange={e => setCardAmount(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="금액을 입력해주세요"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-10"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">원</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 mt-2">
                      {PRESET_AMOUNTS.map(p => (
                        <button
                          key={p}
                          onClick={() => setCardAmount(String(p))}
                          className="py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors text-gray-600"
                        >
                          +{(p / 10000).toLocaleString()}만
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 구매자명 */}
                  <div>
                    <label className="text-xs text-gray-600 font-medium mb-1.5 block">구매자명 <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={cardBuyerName}
                      onChange={e => setCardBuyerName(e.target.value)}
                      placeholder="홍길동"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* 이메일 + 전화 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600 font-medium mb-1.5 block">이메일</label>
                      <input
                        type="email"
                        value={cardBuyerEmail}
                        onChange={e => setCardBuyerEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 font-medium mb-1.5 block">연락처</label>
                      <input
                        type="tel"
                        value={cardBuyerTel}
                        onChange={e => setCardBuyerTel(e.target.value.replace(/[^0-9-]/g, ''))}
                        placeholder="010-0000-0000"
                        className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 leading-relaxed">
                    결제 진행 버튼을 누르면 이니시스 결제창이 새 창으로 열립니다. 결제 완료 시 잔액이 즉시 충전됩니다.
                  </div>
                </div>
                <div className="px-6 pb-6 space-y-2">
                  <button
                    onClick={handleCardSubmit}
                    disabled={cardSubmitting || !cardAmount || !cardBuyerName.trim()}
                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all text-sm shadow-sm hover:shadow-md"
                  >
                    {cardSubmitting ? '결제창 호출 중...' : `${Number(cardAmount || 0).toLocaleString()}원 결제 진행`}
                  </button>
                  <button onClick={() => setChargeStep('select')} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    뒤로
                  </button>
                </div>
              </>
            )}

            {/* 무통장입금 폼 */}
            {chargeStep === 'deposit' && !depositSuccess && (
              <>
                <div className="px-6 pt-6 pb-5 border-b">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setChargeStep('select')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">←</button>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">무통장입금</h3>
                      <p className="text-xs text-gray-500 mt-0.5">아래 계좌로 입금 후 요청해주세요</p>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                    <div className="text-xs text-emerald-600 font-medium mb-2">입금 계좌</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-gray-800">기업은행 585-028893-01-011</div>
                        <div className="text-xs text-gray-500 mt-0.5">예금주: {COMPANY_NAME}</div>
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText('585-028893-01-011')}
                        className="text-xs bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        복사
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 font-medium mb-1.5 block">입금 금액 <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <input
                        type="text"
                        value={depositAmount ? Number(depositAmount).toLocaleString() : ''}
                        onChange={e => setDepositAmount(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="금액을 입력해주세요"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 pr-10"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">원</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 font-medium mb-1.5 block">입금자명 <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={depositorName}
                      onChange={e => setDepositorName(e.target.value)}
                      placeholder="입금자명을 입력해주세요"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="px-6 pb-6 space-y-2">
                  <button
                    onClick={async () => {
                      if (!depositAmount || Number(depositAmount) < 1000) return alert('1,000원 이상 입력해주세요.');
                      if (!depositorName.trim()) return alert('입금자명을 입력해주세요.');
                      setDepositSubmitting(true);
                      try {
                        const res = await fetch('/api/balance/deposit-request', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}` },
                          body: JSON.stringify({ amount: Number(depositAmount), depositorName: depositorName.trim() }),
                        });
                        if (res.ok) {
                          setDepositSuccess(true);
                        } else {
                          const err = await res.json();
                          alert(err.error || '요청 실패');
                        }
                      } catch (e) { alert('네트워크 오류'); }
                      setDepositSubmitting(false);
                    }}
                    disabled={depositSubmitting || !depositAmount || !depositorName.trim()}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors text-sm"
                  >
                    {depositSubmitting ? '요청 중...' : `${Number(depositAmount || 0).toLocaleString()}원 입금 확인 요청`}
                  </button>
                  <button onClick={() => setChargeStep('select')} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    뒤로
                  </button>
                </div>
              </>
            )}

            {/* 무통장입금 요청 완료 */}
            {chargeStep === 'deposit' && depositSuccess && (
              <>
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-4 text-emerald-600">✓</div>
                  <h3 className="text-lg font-bold text-gray-800 mb-2">입금 확인 요청 완료</h3>
                  <p className="text-sm text-gray-500 mb-1">관리자가 입금 확인 후 잔액이 충전됩니다.</p>
                  <p className="text-sm text-gray-500">영업일 기준 1시간 이내 처리됩니다.</p>
                  <div className="mt-4 bg-gray-50 rounded-xl p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">요청 금액</span>
                      <span className="font-bold text-emerald-700">{Number(depositAmount).toLocaleString()}원</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">입금자명</span>
                      <span className="font-medium text-gray-700">{depositorName}</span>
                    </div>
                  </div>
                </div>
                <div className="px-6 pb-6">
                  <button onClick={() => setShowChargeModal(false)} className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium transition-colors text-sm">
                    확인
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* 잔액 부족 모달 */}
      {showInsufficientBalance?.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 bg-gradient-to-r from-red-50 to-orange-50 border-b flex items-center gap-3">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl">💳</div>
              <div>
                <h3 className="text-lg font-bold text-red-700">잔액이 부족합니다</h3>
                <p className="text-sm text-red-500">충전 후 다시 시도해주세요</p>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-sm">현재 잔액</span>
                  <span className="text-lg font-bold text-red-600">{(showInsufficientBalance.balance || 0).toLocaleString()}원</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-sm">발송 비용</span>
                  <span className="text-lg font-bold text-gray-800">{(showInsufficientBalance.required || 0).toLocaleString()}원</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">부족 금액</span>
                    <span className="text-lg font-bold text-orange-600">
                      {((showInsufficientBalance.required || 0) - (showInsufficientBalance.balance || 0)).toLocaleString()}원
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={() => setShowInsufficientBalance(null)}
                className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── INIStdPay 영역 동적 로드 + form 호출 helper ─────────────────

async function loadInicisStdPay(stdpayUrl: string): Promise<void> {
  if ((window as any).INIStdPay) return;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${stdpayUrl}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).INIStdPay) { resolve(); return; }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('INIStdPay 로드 실패')));
      return;
    }
    const script = document.createElement('script');
    script.src = stdpayUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('INIStdPay 로드 실패'));
    document.body.appendChild(script);
  });
}

function submitInicisForm(form: any) {
  const existing = document.getElementById('SendPayForm_id');
  if (existing) existing.remove();

  const formEl = document.createElement('form');
  formEl.id = 'SendPayForm_id';
  formEl.method = 'POST';
  formEl.acceptCharset = 'UTF-8';
  formEl.style.display = 'none';

  const fields: Record<string, string> = {
    version: '1.0',
    mid: form.mid,
    oid: form.orderId,
    price: String(form.amount),
    timestamp: form.timestamp,
    signature: form.signature,
    verification: form.verification,
    mKey: form.mKey,
    use_chkfake: 'true',          // 이니시스 위변조 검증 활성 (매뉴얼 영역 필수)
    currency: form.currency,
    goodname: form.productName,
    buyername: form.buyerName,
    buyertel: form.buyerTel || '',
    buyeremail: form.buyerEmail || '',
    returnUrl: form.returnUrl,
    closeUrl: form.closeUrl,
    gopaymethod: form.gopaymethod,
    acceptmethod: form.acceptmethod,
    languageView: 'ko',
    charset: 'UTF-8',
    payViewType: 'overlay',
  };

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value ?? '';
    formEl.appendChild(input);
  });

  document.body.appendChild(formEl);

  try {
    (window as any).INIStdPay.pay('SendPayForm_id');
  } catch (e: any) {
    alert(`결제창 호출 실패: ${e?.message || e}`);
  }
}
