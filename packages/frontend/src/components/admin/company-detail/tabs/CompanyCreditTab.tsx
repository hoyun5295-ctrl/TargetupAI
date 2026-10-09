/**
 * CompanyCreditTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import type { ModalState } from '../../admin-types';

export interface CompanyCreditTabProps {
  companyCredit: any;
  creditAdj: { type: string; amount: string; reason: string; busy: boolean; };
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setCompanyCredit: Dispatch<any>;
  setCreditAdj: Dispatch<SetStateAction<{ type: string; amount: string; reason: string; busy: boolean; }>>;
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
  setModal: Dispatch<SetStateAction<ModalState>>;
}

export default function CompanyCreditTab(props: CompanyCreditTabProps) {
  const { companyCredit, creditAdj, editCompany, setCompanyCredit, setCreditAdj, setEditCompany, setModal } = props;

  return (
    <>
    {(
                <div className="space-y-4">
                  {/* AI 크레딧 (종량제 Phase 4 — 모든 요금제) */}
                  <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 rounded-xl p-4 border border-violet-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-bold text-gray-800">AI 크레딧</div>
                      <button type="button" onClick={async () => {
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch(`/api/admin/companies/${editCompany.id}/credit`, { headers: { Authorization: `Bearer ${token}` } });
                          if (res.ok) { const d = await res.json(); setCompanyCredit({ ...d, _forId: editCompany.id }); }
                          else { const d = await res.json().catch(() => ({})); setModal({ type: 'alert', title: '조회 실패', message: d.error || '오류', variant: 'error' }); }
                        } catch { setModal({ type: 'alert', title: '오류', message: '크레딧 조회 실패', variant: 'error' }); }
                      }} className="whitespace-nowrap text-[10px] text-violet-600 hover:underline">조회 / 새로고침</button>
                    </div>
                    {companyCredit && companyCredit._forId === editCompany.id ? (
                      <>
                        {/* 총 잔여 — 큰 숫자 + 기본분/구매분 게이지 */}
                        <div className="rounded-lg border border-violet-100 bg-white/70 p-3 mb-3">
                          <div className="flex items-end justify-between">
                            <div>
                              <div className="text-[11px] text-gray-500">총 잔여</div>
                              <div className="text-2xl font-bold tabular-nums text-violet-700">
                                {Number(companyCredit.total || 0).toLocaleString()}
                                <span className="ml-1 text-xs font-normal text-gray-400">크레딧</span>
                              </div>
                            </div>
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                              {companyCredit.billingType === 'postpaid' ? '후불' : '선불'}
                            </span>
                          </div>
                          {(() => {
                            const base = Math.max(0, Number(companyCredit.baseRemaining || 0));
                            const pur = Math.max(0, Number(companyCredit.purchased || 0));
                            const gmax = Math.max(Number(companyCredit.planCredits || 0), base + pur, 1);
                            const bp = Math.max(0, Math.min(100, (base / gmax) * 100));
                            const pp = Math.max(0, Math.min(100 - bp, (pur / gmax) * 100));
                            return (
                              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-100">
                                <div className="flex h-full">
                                  <div className="h-full bg-violet-500" style={{ width: `${bp}%` }} />
                                  <div className="h-full bg-fuchsia-400" style={{ width: `${pp}%` }} />
                                </div>
                              </div>
                            );
                          })()}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-violet-500" /> 기본분 {Number(companyCredit.baseRemaining || 0).toLocaleString()}</span>
                            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" /> 구매분 {Number(companyCredit.purchased || 0).toLocaleString()}</span>
                            <span className="text-gray-400">이번달 사용 {Number(companyCredit.monthlyUsed || 0).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mb-2">
                          <button type="button" onClick={() => setCreditAdj({ ...creditAdj, type: 'grant' })}
                            className={`whitespace-nowrap flex-1 py-1.5 text-xs font-medium rounded-lg ${creditAdj.type === 'grant' ? 'bg-violet-600 text-white' : 'bg-white border text-gray-600'}`}>지급</button>
                          <button type="button" onClick={() => setCreditAdj({ ...creditAdj, type: 'admin_deduct' })}
                            className={`whitespace-nowrap flex-1 py-1.5 text-xs font-medium rounded-lg ${creditAdj.type === 'admin_deduct' ? 'bg-rose-600 text-white' : 'bg-white border text-gray-600'}`}>차감</button>
                        </div>
                        <div className="space-y-2">
                          <input type="number" placeholder="크레딧" value={creditAdj.amount}
                            onChange={(e) => setCreditAdj({ ...creditAdj, amount: e.target.value })}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none" />
                          <input type="text" placeholder="사유 (필수)" value={creditAdj.reason}
                            onChange={(e) => setCreditAdj({ ...creditAdj, reason: e.target.value })}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none" />
                          <button type="button" disabled={creditAdj.busy || !creditAdj.amount || !creditAdj.reason}
                            onClick={async () => {
                              const idemKey = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                              setCreditAdj(prev => ({ ...prev, busy: true }));
                              try {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`/api/admin/companies/${editCompany.id}/credit-adjust`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ type: creditAdj.type, amount: Number(creditAdj.amount), reason: creditAdj.reason, idempotencyKey: idemKey })
                                });
                                const data = await res.json();
                                if (res.ok) {
                                  setCreditAdj({ type: 'grant', amount: '', reason: '', busy: false });
                                  const r2 = await fetch(`/api/admin/companies/${editCompany.id}/credit`, { headers: { Authorization: `Bearer ${token}` } });
                                  if (r2.ok) { const d2 = await r2.json(); setCompanyCredit({ ...d2, _forId: editCompany.id }); }
                                  setModal({ type: 'alert', title: '완료', message: data.message, variant: 'success' });
                                } else {
                                  setCreditAdj(prev => ({ ...prev, busy: false }));
                                  setModal({ type: 'alert', title: '실패', message: data.error, variant: 'error' });
                                }
                              } catch { setCreditAdj(prev => ({ ...prev, busy: false })); setModal({ type: 'alert', title: '오류', message: '크레딧 조정 실패', variant: 'error' }); }
                            }}
                            className={`whitespace-nowrap w-full py-2.5 text-[13px] font-medium rounded-lg disabled:opacity-50 ${creditAdj.type === 'grant' ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
                          >{creditAdj.busy ? '처리 중...' : creditAdj.type === 'grant' ? '지급하기' : '차감하기'}</button>
                        </div>
                        {companyCredit.billingType === 'postpaid' && (
                          <div className="mt-3 pt-3 border-t border-violet-200">
                            <label className="text-[11px] font-bold text-gray-700">후불 추가 사용 한도 (크레딧)</label>
                            <div className="flex gap-2 mt-1">
                              <input type="number" defaultValue={Number(companyCredit.overageLimit || 0)} id="overageLimitInput"
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-violet-500 outline-none" />
                              <button type="button" onClick={async () => {
                                const el = document.getElementById('overageLimitInput') as HTMLInputElement | null;
                                const v = Number(el?.value || 0);
                                try {
                                  const token = localStorage.getItem('token');
                                  const res = await fetch(`/api/admin/companies/${editCompany.id}/postpaid-overage-limit`, {
                                    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({ overageLimit: v })
                                  });
                                  const data = await res.json();
                                  if (res.ok) { setCompanyCredit({ ...companyCredit, overageLimit: data.overageLimit }); setModal({ type: 'alert', title: '완료', message: data.message, variant: 'success' }); }
                                  else setModal({ type: 'alert', title: '실패', message: data.error, variant: 'error' });
                                } catch { setModal({ type: 'alert', title: '오류', message: '한도 설정 실패', variant: 'error' }); }
                              }} className="whitespace-nowrap px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700">저장</button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-gray-400 text-center py-2">위 조회 버튼으로 크레딧 현황을 불러오세요.</div>
                    )}
                  </div>

                  <div className="pt-3 mt-1 border-t border-gray-100">
                    <div className="text-[11px] font-semibold text-gray-400">AI 타겟 전략 (고급)</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">타겟 전략</label>
                    <select value={editCompany.targetStrategy}
                      onChange={(e) => setEditCompany({ ...editCompany, targetStrategy: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                      <option value="balanced">균형형 (Balanced)</option>
                      <option value="aggressive">공격형 (Aggressive) - 넓은 타겟</option>
                      <option value="conservative">보수형 (Conservative) - 정밀 타겟</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">AI가 타겟을 추출할 때 적용하는 전략입니다.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="crossCategory" checked={editCompany.crossCategoryAllowed}
                      onChange={(e) => setEditCompany({ ...editCompany, crossCategoryAllowed: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500/30" />
                    <label htmlFor="crossCategory" className="text-[13px] text-gray-700">교차 카테고리 타겟 허용</label>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2 ml-6">예: 스킨케어 구매자에게 색조 제품 추천</p>
                  
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2">제외 세그먼트</label>
                    <p className="text-xs text-gray-500 mb-2">AI 타겟에서 항상 제외할 고객 그룹</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {editCompany.excludedSegments.map((seg: string, idx: number) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
                          {seg}
                          <button type="button"
                            onClick={() => setEditCompany({
                              ...editCompany,
                              excludedSegments: editCompany.excludedSegments.filter((_: string, i: number) => i !== idx)
                            })}
                            className="whitespace-nowrap text-red-600 hover:text-red-800 font-bold">×</button>
                        </span>
                      ))}
                      {editCompany.excludedSegments.length === 0 && (
                        <span className="text-gray-400 text-sm">제외 세그먼트 없음</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input type="text" value={editCompany.newExcludedSegment}
                        onChange={(e) => setEditCompany({ ...editCompany, newExcludedSegment: e.target.value })}
                        className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                        placeholder="예: 탈퇴요청, VIP제외, 휴면고객"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const seg = editCompany.newExcludedSegment.trim();
                            if (seg && !editCompany.excludedSegments.includes(seg)) {
                              setEditCompany({
                                ...editCompany,
                                excludedSegments: [...editCompany.excludedSegments, seg],
                                newExcludedSegment: ''
                              });
                            }
                          }
                        }} />
                      <button type="button"
                        onClick={() => {
                          const seg = editCompany.newExcludedSegment.trim();
                          if (seg && !editCompany.excludedSegments.includes(seg)) {
                            setEditCompany({
                              ...editCompany,
                              excludedSegments: [...editCompany.excludedSegments, seg],
                              newExcludedSegment: ''
                            });
                          }
                        }}
                        className="whitespace-nowrap px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-[13px]">
                        추가
                      </button>
                    </div>
                  </div>

                  <div className="bg-purple-50 rounded-lg p-3 mt-2">
                    <p className="text-xs text-purple-700">
                      이 설정은 AI가 캠페인 타겟을 추출할 때 기본 조건으로 적용됩니다.
                    </p>
                  </div>
                </div>
              )}
    </>
  );
}
