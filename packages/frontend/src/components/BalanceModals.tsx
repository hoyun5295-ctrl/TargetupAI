import { useState } from 'react';
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

export default function BalanceModals({
  showBalanceModal, setShowBalanceModal,
  showChargeModal, setShowChargeModal,
  balanceInfo,
  showInsufficientBalance, setShowInsufficientBalance,
}: BalanceModalsProps) {
  const [chargeStep, setChargeStep] = useState<'select' | 'deposit'>('select');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositorName, setDepositorName] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);

  return (
    <>
      {/* 잔액 현황 모달 */}
      {showBalanceModal && balanceInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" onClick={() => setShowBalanceModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[380px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
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
            {/* 발송 가능 건수 */}
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
            {/* 하단 버튼 */}
            <div className="px-5 pb-5 space-y-2">
            <button
                onClick={() => { setShowBalanceModal(false); setChargeStep('select'); setDepositSuccess(false); setShowChargeModal(true); }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium transition-colors text-sm"
              >
                💳 잔액 충전하기
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
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            
            {/* 충전 방법 선택 */}
            {chargeStep === 'select' && (
              <>
                <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-xl">💳</div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">잔액 충전</h3>
                      <p className="text-xs text-gray-500">충전 방법을 선택해주세요</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  {/* 카드결제 - 준비중 */}
                  <div className="relative p-4 rounded-xl border border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed">
                    <div className="absolute top-2 right-2 bg-gray-400 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">준비 중</div>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center text-lg">💳</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-500">카드결제</div>
                        <div className="text-xs text-gray-400">신용카드 / 체크카드 즉시 충전</div>
                      </div>
                    </div>
                  </div>
                  {/* 가상계좌 - 준비중 */}
                  <div className="relative p-4 rounded-xl border border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed">
                    <div className="absolute top-2 right-2 bg-gray-400 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">준비 중</div>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center text-lg">🏦</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-500">가상계좌</div>
                        <div className="text-xs text-gray-400">발급된 계좌로 입금 시 자동 충전</div>
                      </div>
                    </div>
                  </div>
                  {/* 무통장입금 */}
                  <button
                    onClick={() => { setChargeStep('deposit'); setDepositAmount(''); setDepositorName(''); setDepositSuccess(false); }}
                    className="w-full p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center text-lg">📋</div>
                      <div>
                        <div className="text-sm font-semibold text-gray-800">무통장입금</div>
                        <div className="text-xs text-gray-500">계좌이체 후 입금 확인 요청</div>
                      </div>
                      <div className="ml-auto text-emerald-500 text-sm">→</div>
                    </div>
                  </button>
                </div>
                <div className="px-5 pb-5">
                  <button onClick={() => setShowChargeModal(false)} className="w-full py-2.5 text-gray-500 hover:text-gray-700 text-sm transition-colors">
                    닫기
                  </button>
                </div>
              </>
            )}

            {/* 무통장입금 폼 */}
            {chargeStep === 'deposit' && !depositSuccess && (
              <>
                <div className="p-5 border-b bg-gradient-to-r from-emerald-50 to-green-50">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setChargeStep('select')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-emerald-100 text-gray-500 transition-colors">←</button>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">무통장입금</h3>
                      <p className="text-xs text-gray-500">아래 계좌로 입금 후 요청해주세요</p>
                    </div>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  {/* 입금 계좌 안내 */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                    <div className="text-xs text-blue-500 font-medium mb-2">입금 계좌</div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-gray-800">기업은행 585-028893-01-011</div>
                        <div className="text-xs text-gray-500 mt-0.5">예금주: {COMPANY_NAME}</div>
                      </div>
                      <button
                        onClick={() => { navigator.clipboard.writeText('585-028893-01-011'); }}
                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-600 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        복사
                      </button>
                    </div>
                  </div>
                  {/* 입금 금액 */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1.5 block">입금 금액 *</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={depositAmount}
                        onChange={e => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          setDepositAmount(v);
                        }}
                        placeholder="금액을 입력해주세요"
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 pr-10"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">원</span>
                    </div>
                    {depositAmount && (
                      <div className="text-xs text-gray-400 mt-1 text-right">{Number(depositAmount).toLocaleString()}원</div>
                    )}
                  </div>
                                    {/* 입금자명 */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1.5 block">입금자명 *</label>
                    <input
                      type="text"
                      value={depositorName}
                      onChange={e => setDepositorName(e.target.value)}
                      placeholder="입금자명을 입력해주세요"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
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

            {/* 요청 완료 */}
            {chargeStep === 'deposit' && depositSuccess && (
              <>
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-4">✅</div>
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
                <div className="px-5 pb-5">
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
