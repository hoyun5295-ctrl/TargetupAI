/**
 * CompanyBasicTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatPlanOptionLabel, trialDaysLeft } from '../../../../utils/planLabel';
import { AdminSection, AdminField, AdminPill, ADMIN_FIELD_INPUT, ADMIN_BTN, ADMIN_BTN_DANGER } from '../../ui/admin-ui';
import { PlanTermLockNote } from '../../PlanTermBox';
import { formatAgentIdLabel } from '../../../../utils/agentLabel';
import { previewUnitPrice, fmtPrice } from '../../../../utils/unitPrice';
import type { Plan } from '../../admin-types';

export interface CompanyBasicTabProps {
  agencyEmailActiveCount: number | null;
  agentIdSaving: boolean;
  agentIds: { id: string; agent_send_id: string; memo: string | null; cust_name?: string | null; billing_type?: string | null; cost_per_sms?: string | number | null; cost_per_lms?: string | number | null; cost_per_mms?: string | number | null; cost_per_kakao?: string | number | null; cost_per_brand?: string | number | null; }[];
  agentLedgerSaving: boolean;
  editAgentLedger: { billingType: string; costPerSms: string; costPerLms: string; costPerMms: string; costPerKakao: string; costPerBrand: string; memo: string; };
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  editingAgentRowId: string | null;
  industryOptions: { code: string; label: string; }[];
  labOpen: boolean;
  lineGroups: any[];
  linePolicy: { subscriberType: string | null; mobileLineLimit: number | null; landlineLineLimit: number | null; effective: { mobile: number | null; landline: number | null; source: string; }; held: { mobile: number; landline: number; }; perAccount?: { activeAccounts: number; perAccount: number; } | null; } | null;
  linePolicySaving: boolean;
  loadAgentIds: (companyId: string) => Promise<void>;
  loadData: () => Promise<void>;
  newAgentMemo: string;
  newAgentSendId: string;
  plans: Plan[];
  setAgencyEmailModalOpen: Dispatch<SetStateAction<boolean>>;
  setAgentIdSaving: Dispatch<SetStateAction<boolean>>;
  setAgentLedgerSaving: Dispatch<SetStateAction<boolean>>;
  setEditAgentLedger: Dispatch<SetStateAction<{ billingType: string; costPerSms: string; costPerLms: string; costPerMms: string; costPerKakao: string; costPerBrand: string; memo: string; }>>;
  setEditCompany: Dispatch<SetStateAction<{ id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; }>>;
  setEditingAgentRowId: Dispatch<SetStateAction<string | null>>;
  setLabOpen: Dispatch<SetStateAction<boolean>>;
  setLinePolicy: Dispatch<SetStateAction<{ subscriberType: string | null; mobileLineLimit: number | null; landlineLineLimit: number | null; effective: { mobile: number | null; landline: number | null; source: string; }; held: { mobile: number; landline: number; }; perAccount?: { activeAccounts: number; perAccount: number; } | null; } | null>>;
  setLinePolicySaving: Dispatch<SetStateAction<boolean>>;
  setNewAgentMemo: Dispatch<SetStateAction<string>>;
  setNewAgentSendId: Dispatch<SetStateAction<string>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function CompanyBasicTab(props: CompanyBasicTabProps) {
  const { agencyEmailActiveCount, agentIdSaving, agentIds, agentLedgerSaving, editAgentLedger, editCompany, editingAgentRowId, industryOptions, labOpen, lineGroups, linePolicy, linePolicySaving, loadAgentIds, loadData, newAgentMemo, newAgentSendId, plans, setAgencyEmailModalOpen, setAgentIdSaving, setAgentLedgerSaving, setEditAgentLedger, setEditCompany, setEditingAgentRowId, setLabOpen, setLinePolicy, setLinePolicySaving, setNewAgentMemo, setNewAgentSendId, showAlert, showConfirm } = props;


  const handleAddAgentId = async () => {
    const value = newAgentSendId.trim();
    if (!value || !editCompany.id) return;
    setAgentIdSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ agentSendId: value, memo: newAgentMemo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 등록 실패', 'error');
      } else {
        setNewAgentSendId('');
        setNewAgentMemo('');
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    } finally {
      setAgentIdSaving(false);
    }
  };

  const handleRemoveAgentId = async (rowId: string) => {
    if (!editCompany.id) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids/${rowId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 삭제 실패', 'error');
      } else {
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    }
  };

  // ★ 2026-07-24 §5-1 — 발송ID 원장(선/후불·단가·메모) 인라인 편집
  // 단가 입력 정제: 숫자+점 하나만 허용 ('1.2.3' 차단 — Codex 5R-2), 저장 시 점만 남은 값은 빈 값 처리
  const sanitizeCostInput = (v: string) => {
    const c = v.replace(/[^0-9.]/g, '');
    const i = c.indexOf('.');
    return i === -1 ? c : c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '');
  };
  const normalizeCostForSave = (v: string) => {
    const t = v.trim();
    return t === '.' ? '' : t;
  };

  const openAgentLedgerEdit = (a: (typeof agentIds)[number]) => {
    setEditingAgentRowId(a.id);
    setEditAgentLedger({
      billingType: a.billing_type === 'prepaid' ? 'prepaid' : 'postpaid',
      costPerSms: a.cost_per_sms != null && String(a.cost_per_sms) !== '' ? String(Number(a.cost_per_sms)) : '',
      costPerLms: a.cost_per_lms != null && String(a.cost_per_lms) !== '' ? String(Number(a.cost_per_lms)) : '',
      costPerMms: a.cost_per_mms != null && String(a.cost_per_mms) !== '' ? String(Number(a.cost_per_mms)) : '',
      costPerKakao: a.cost_per_kakao != null && String(a.cost_per_kakao) !== '' ? String(Number(a.cost_per_kakao)) : '',
      costPerBrand: a.cost_per_brand != null && String(a.cost_per_brand) !== '' ? String(Number(a.cost_per_brand)) : '',
      memo: a.memo || '',
    });
  };

  const handleSaveAgentLedger = async () => {
    if (!editCompany.id || !editingAgentRowId) return;
    setAgentLedgerSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/companies/${editCompany.id}/agent-ids/${editingAgentRowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          billingType: editAgentLedger.billingType,
          costPerSms: normalizeCostForSave(editAgentLedger.costPerSms),
          costPerLms: normalizeCostForSave(editAgentLedger.costPerLms),
          costPerMms: normalizeCostForSave(editAgentLedger.costPerMms),
          costPerKakao: normalizeCostForSave(editAgentLedger.costPerKakao),
          costPerBrand: normalizeCostForSave(editAgentLedger.costPerBrand),
          memo: editAgentLedger.memo.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('오류', data.error || '발송ID 설정 저장 실패', 'error');
      } else {
        setEditingAgentRowId(null);
        await loadAgentIds(editCompany.id);
      }
    } catch {
      showAlert('오류', '서버 오류', 'error');
    } finally {
      setAgentLedgerSaving(false);
    }
  };

  // ★ 2026-08-18 회선 정책 저장 — 회사 수정과 별도 endpoint(파라미터 40개 라우트에 끼우면 번호가 밀린다)
  const handleSaveLinePolicy = async () => {
    if (!editCompany.id || !linePolicy) return;
    setLinePolicySaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/companies/${editCompany.id}/sender-line-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          subscriberType: linePolicy.subscriberType || '',
          mobileLineLimit: linePolicy.mobileLineLimit,
          landlineLineLimit: linePolicy.landlineLineLimit,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        showAlert('오류', data?.error || '회선 정책 저장에 실패했습니다.', 'error');
        return;
      }
      const refreshed = await fetch(`/api/admin/companies/${editCompany.id}/sender-line-policy`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (refreshed.ok) setLinePolicy(await refreshed.json());
      showAlert('성공', '발신번호 회선 정책이 저장되었습니다.', 'success');
    } catch {
      showAlert('오류', '회선 정책 저장에 실패했습니다.', 'error');
    } finally {
      setLinePolicySaving(false);
    }
  };

  // ★ 2026-06-08: 30일 PRO 무료체험(grant-trial/revoke-trial) 제거 — BASIC 1개월 무료체험으로 통합(handleGrantBasicTrial/handleRevokeBasicTrial).

  // ★ 2026-06-08: BASIC 1개월 무료체험 부여 (PRO 체험 + AI op overlay 체험 대체)
  //   plan=BASIC + base 크레딧(750) 30일 → trial-downgrade-worker가 30일 후 FREE 자동 강등.
  // ★ 2026-10-08 「7일 체험」 추가(Harold · 시연 뒤 · 크레딧 300) — 일수 · 크레딧은 서버(ADMIN_WEEK_TRIAL)가 정한다. 화면은 kind 만 보낸다.
  const handleGrantBasicTrial = (kind: 'month' | 'week' = 'month') => {
    if (!editCompany.id) return;
    // ★ 2026-07-28 같은 버튼이 신규 부여와 추가 부여(연장) 두 가지를 한다 — 문구로 구분한다.
    const isExtending = editCompany.subscriptionStatus === 'trial';
    const week = kind === 'week';
    const span = week ? '7일' : '1개월';
    const dayCount = week ? 7 : 30;
    showConfirm(
      isExtending ? `무료체험 ${span} 추가 부여` : `무료체험 ${span} 부여`,
      isExtending
        ? `"${editCompany.companyName}" 의 무료체험을 ${span} 더 연장할까요?\n\n· 남은 기간에 ${dayCount}일이 더해집니다\n· 크레딧은 다시 채우지 않습니다(중복 지급 방지)`
        : `"${editCompany.companyName}" 에 ${span} 무료체험을 부여할까요?\n\n· 베이직과 같은 기능 + ${week ? 'AI 크레딧 300' : '크레딧 1개월분'} 개방 (요금 0원)\n· ${dayCount}일 후 자동으로 미가입(FREE)으로 강등`,
      async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/companies/${editCompany.id}/grant-basic-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(week ? { kind: 'week' } : { days: 30 }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'BASIC 무료체험 부여 실패');
          if (data.company) {
            setEditCompany((prev) => ({
              ...prev,
              subscriptionStatus: data.company.subscription_status || 'trial',
              trialExpiresAt: data.company.trial_expires_at || '',
              planId: data.company.plan_id || prev.planId,
              planCode: data.company.plan_code || 'TRIAL',
            }));
          }
          showAlert('성공', data.message || 'BASIC 무료체험이 부여되었습니다.', 'success');
          loadData();
        } catch (err: any) {
          showAlert('실패', err?.message || 'BASIC 무료체험 부여 실패', 'error');
        }
      },
    );
  };

  // ★ 2026-06-08: BASIC 무료체험 즉시 취소 (FREE 강등)
  const handleRevokeBasicTrial = () => {
    if (!editCompany.id) return;
    showConfirm(
      'BASIC 무료체험 취소',
      `"${editCompany.companyName}" 의 무료체험을 즉시 취소하고 미가입(FREE)으로 강등할까요?`,
      async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`/api/companies/${editCompany.id}/revoke-basic-trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || 'BASIC 무료체험 취소 실패');
          if (data.company) {
            setEditCompany((prev) => ({
              ...prev,
              subscriptionStatus: data.company.subscription_status || 'trial_expired',
              planId: data.company.plan_id || prev.planId,
              planCode: data.company.plan_code || 'FREE',
            }));
          }
          showAlert('완료', data.message || '무료체험이 취소되었습니다.', 'success');
          loadData();
        } catch (err: any) {
          showAlert('실패', err?.message || 'BASIC 무료체험 취소 실패', 'error');
        }
      },
    );
  };
  return (
    <>
    {(
                <div>
                  {/* ★ 2026-10-09 슈퍼관리자 다듬기(목업 v2) — 묶음 카드 + 이름표 왼쪽 칸. 칸 · 값 · 저장 계약은 그대로(배치만 옮김) */}
                  <AdminSection title="회사 정보" hint="사업자등록증 기준">
                    <AdminField label="회사명" required>
                      <input type="text" value={editCompany.companyName}
                        onChange={(e) => setEditCompany({ ...editCompany, companyName: e.target.value })}
                        className={ADMIN_FIELD_INPUT} required />
                    </AdminField>
                    <AdminField label="사업자번호">
                      <input type="text" value={editCompany.businessNumber}
                        onChange={(e) => setEditCompany({ ...editCompany, businessNumber: e.target.value })}
                        className={`${ADMIN_FIELD_INPUT} tabular-nums`} placeholder="000-00-00000" />
                    </AdminField>
                    <AdminField label="대표자">
                      <input type="text" value={editCompany.ceoName}
                        onChange={(e) => setEditCompany({ ...editCompany, ceoName: e.target.value })}
                        className={ADMIN_FIELD_INPUT} />
                    </AdminField>
                    <AdminField label="업태 · 종목">
                      <div className="flex gap-1.5">
                        <input type="text" value={editCompany.businessType} aria-label="업태"
                          onChange={(e) => setEditCompany({ ...editCompany, businessType: e.target.value })}
                          className={ADMIN_FIELD_INPUT} placeholder="도소매업" />
                        <input type="text" value={editCompany.businessItem} aria-label="종목"
                          onChange={(e) => setEditCompany({ ...editCompany, businessItem: e.target.value })}
                          className={ADMIN_FIELD_INPUT} placeholder="화장품" />
                      </div>
                    </AdminField>
                    {/* ★ 2026-07-21 문안 생성 참조 업종 — 사업자등록증 업태/종목(위)과 별개. 브랜드보이스 미등록 업체 문안 생성 시 참조 카테고리. */}
                    <AdminField label="문안 참조 업종" full hint="브랜드보이스 미등록 업체의 문안 생성 시 참조하는 업종입니다. 사업자등록증 업태·종목과 무관하게 실제 판매 카테고리로 지정하세요.">
                      <select value={editCompany.industryCode}
                        onChange={(e) => setEditCompany({ ...editCompany, industryCode: e.target.value })}
                        className={ADMIN_FIELD_INPUT}>
                        <option value="">미지정</option>
                        {industryOptions.map((o) => (
                          <option key={o.code} value={o.code}>{o.label}</option>
                        ))}
                      </select>
                    </AdminField>
                    <AdminField label="주소" full>
                      <input type="text" value={editCompany.address}
                        onChange={(e) => setEditCompany({ ...editCompany, address: e.target.value })}
                        className={ADMIN_FIELD_INPUT} placeholder="서울시 강남구..." />
                    </AdminField>
                  </AdminSection>

                  <AdminSection title="담당자 · 연락">
                    <AdminField label="담당자명">
                      <input type="text" value={editCompany.contactName}
                        onChange={(e) => setEditCompany({ ...editCompany, contactName: e.target.value })}
                        className={ADMIN_FIELD_INPUT} />
                    </AdminField>
                    <AdminField label="연락처">
                      <input type="text" value={editCompany.contactPhone}
                        onChange={(e) => setEditCompany({ ...editCompany, contactPhone: e.target.value })}
                        className={`${ADMIN_FIELD_INPUT} tabular-nums`} placeholder="010-0000-0000" />
                    </AdminField>
                    <AdminField label="이메일">
                      <input type="email" value={editCompany.contactEmail}
                        onChange={(e) => setEditCompany({ ...editCompany, contactEmail: e.target.value })}
                        className={ADMIN_FIELD_INPUT} />
                    </AdminField>
                    <AdminField label="080 수신거부번호">
                      <input type="text" value={editCompany.rejectNumber}
                        onChange={(e) => setEditCompany({ ...editCompany, rejectNumber: e.target.value })}
                        className={`${ADMIN_FIELD_INPUT} tabular-nums`} placeholder="080-000-0000" />
                    </AdminField>
                  </AdminSection>

                  <AdminSection title="요금제 · 상태" hint="체험 = 베이직과 같은 기능 · 요금 0원">
                    <AdminField label="요금제" required>
                      <select value={editCompany.planId}
                        onChange={(e) => setEditCompany({ ...editCompany, planId: e.target.value })}
                        className={ADMIN_FIELD_INPUT} required>
                        <option value="">선택하세요</option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{formatPlanOptionLabel(plan.plan_name, plan.monthly_price)}</option>
                        ))}
                      </select>
                      {/* ★ 2026-10-04 선불 이용 기간 중 회사 = 요금제 직접 변경 불가(서버 409) — 미리 알린다 */}
                      {editCompany.billingType === 'prepaid' && <PlanTermLockNote companyId={editCompany.id} />}
                    </AdminField>
                    <AdminField label="상태" required>
                      <select value={editCompany.status}
                        onChange={(e) => setEditCompany({ ...editCompany, status: e.target.value })}
                        className={ADMIN_FIELD_INPUT}>
                        <option value="trial">체험</option>
                        <option value="active">활성</option>
                        <option value="suspended">정지</option>
                        <option value="terminated">해지</option>
                      </select>
                    </AdminField>
                    <AdminField label="구독 상태" required full hint="expired/suspended 시 전 기능 차단. trial_expired 는 FREE plan 자동 강등 후 마커.">
                      <select value={editCompany.subscriptionStatus}
                        onChange={(e) => setEditCompany({ ...editCompany, subscriptionStatus: e.target.value })}
                        className={ADMIN_FIELD_INPUT}>
                        <option value="trial">체험 (trial)</option>
                        <option value="trial_expired">체험만료 (trial_expired)</option>
                        <option value="paid">정식 구독 (paid)</option>
                        <option value="active">정상 구독 (active)</option>
                        <option value="expired">만료 (expired)</option>
                        <option value="suspended">정지 (suspended)</option>
                      </select>
                    </AdminField>
                    {/* ★ 2026-06-08: BASIC 1개월 무료체험 (PRO 체험 + AI op overlay 체험 대체) · ★ 2026-10-08 7일 체험 추가 */}
                    <AdminField label="무료체험" full>
                      {editCompany.subscriptionStatus === 'trial' && editCompany.trialExpiresAt ? (
                        <p className="text-[13px] text-gray-800 flex items-center gap-1.5 flex-wrap pt-1">
                          체험 중 · 만료 <b className="tabular-nums">{new Date(editCompany.trialExpiresAt).toLocaleString('ko-KR')}</b>
                          <AdminPill tone="blue">D-{trialDaysLeft(editCompany.trialExpiresAt) ?? 0}</AdminPill>
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 pt-1 leading-relaxed">체험 미부여 상태. 부여 시 무료체험 요금제(베이직과 같은 기능, 요금 0원) 개방 · 7일(시연 뒤 · AI 크레딧 300) 또는 1개월(크레딧 1개월분) · 기간이 끝나면 자동 미가입(FREE) 강등.</p>
                      )}
                      <div className="flex gap-1.5 flex-wrap mt-2">
                        <button type="button" onClick={() => handleGrantBasicTrial('week')} className={ADMIN_BTN}>
                          {editCompany.subscriptionStatus === 'trial' ? '7일 추가 부여' : '7일 체험 부여'}
                        </button>
                        <button type="button" onClick={() => handleGrantBasicTrial('month')} className={ADMIN_BTN}>
                          {editCompany.subscriptionStatus === 'trial' ? '1개월 추가 부여' : '1개월 체험 부여'}
                        </button>
                        {editCompany.subscriptionStatus === 'trial' && (
                          <button type="button" onClick={handleRevokeBasicTrial} className={ADMIN_BTN_DANGER}>
                            체험 취소
                          </button>
                        )}
                      </div>
                    </AdminField>
                  </AdminSection>

                  <AdminSection title="계정 정책" plain>
                  {/* ★ 2026-07-03 사용구분 + 에이전트 발송ID 매핑 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">사용구분 *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'web', label: '웹발송', desc: '한줄로 전체 기능' },
                        { value: 'agent', label: '에이전트', desc: '카카오템플릿+결과만' },
                        { value: 'both', label: '웹+에이전트', desc: '웹 발송과 에이전트 발송을 함께 사용' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setEditCompany({ ...editCompany, usageType: opt.value })}
                          className={`px-2 py-2 rounded-lg border text-center transition ${
                            editCompany.usageType === opt.value
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    {editCompany.usageType === 'agent' && (
                      <p className="text-xs text-amber-600 mt-1.5">
                        에이전트 전용 계정은 로그인 시 카카오 템플릿 관리만 접근 가능합니다 (대시보드 차단). 다음 로그인부터 적용됩니다.
                      </p>
                    )}
                  </div>
                  {(editCompany.usageType === 'agent' || editCompany.usageType === 'both') && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                      <p className="text-sm font-semibold text-gray-800">에이전트 발송ID 매핑</p>
                      <p className="text-xs text-gray-500 mt-0.5 mb-2">이 회사에 속한 QTmsg 발송ID 목록. 발송량 조회·정산 합산의 기준이 됩니다.</p>
                      {agentIds.length > 0 ? (
                        <div className="space-y-1.5 mb-2">
                          {agentIds.map((a) => {
                            const costSummary = [
                              { l: 'S', v: a.cost_per_sms },
                              { l: 'L', v: a.cost_per_lms },
                              { l: 'M', v: a.cost_per_mms },
                              { l: '카카오', v: a.cost_per_kakao },
                              { l: '브랜드', v: a.cost_per_brand },
                            ].filter((c) => c.v != null && String(c.v) !== '').map((c) => `${c.l} ${Number(c.v)}`).join(' · ');
                            return (
                              <div key={a.id} className="bg-white rounded-lg border border-gray-200 px-3 py-1.5">
                                <div className="flex items-center justify-between">
                                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-mono text-gray-800">{formatAgentIdLabel(a.agent_send_id, a.cust_name)}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${a.billing_type === 'prepaid' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500'}`}>
                                      {a.billing_type === 'prepaid' ? '선불' : '후불'}
                                    </span>
                                    {costSummary && <span className="text-[10px] text-gray-400 tabular-nums">{costSummary}</span>}
                                    {a.memo && <span className="text-xs text-gray-400">{a.memo}</span>}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <button
                                      type="button"
                                      onClick={() => (editingAgentRowId === a.id ? setEditingAgentRowId(null) : openAgentLedgerEdit(a))}
                                      className="whitespace-nowrap text-xs text-emerald-700 hover:text-emerald-800"
                                    >
                                      설정
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAgentId(a.id)}
                                      className="whitespace-nowrap text-xs text-red-500 hover:text-red-700"
                                    >
                                      해제
                                    </button>
                                  </div>
                                </div>
                                {editingAgentRowId === a.id && (
                                  <div className="mt-1.5 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {(['prepaid', 'postpaid'] as const).map((bt) => (
                                        <button
                                          key={bt}
                                          type="button"
                                          onClick={() => setEditAgentLedger({ ...editAgentLedger, billingType: bt })}
                                          className={`whitespace-nowrap px-2.5 py-1 rounded-lg border text-xs transition ${
                                            editAgentLedger.billingType === bt
                                              ? bt === 'prepaid'
                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                                : 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                          }`}
                                        >
                                          {bt === 'prepaid' ? '선불' : '후불'}
                                        </button>
                                      ))}
                                      <span className="text-[10px] text-gray-400">선불 지정 시 고객 대시보드 잔액 표시·충전 대상</span>
                                    </div>
                                    {/* ★ 2026-07-26 발송ID 단가도 회사 단가와 **같은 기준(VAT 별도 공급가)** 으로 해석된다.
                                        라벨 없이 두면 계약서의 VAT 포함가를 그대로 넣어 10% 과청구가 난다(Codex #7). */}
                                    <div className="rounded-lg bg-emerald-50/70 px-2 py-1.5 text-[10px] text-emerald-800">
                                      발송ID 단가도 <b>VAT 별도 공급가</b>로 입력합니다. 건별 VAT 10%는 시스템이 자동 합산합니다.
                                    </div>
                                    <div className="grid grid-cols-3 lg:grid-cols-5 gap-1.5">
                                      {([['costPerSms', 'SMS'], ['costPerLms', 'LMS'], ['costPerMms', 'MMS'], ['costPerKakao', '카카오'], ['costPerBrand', '브랜드']] as const).map(([k, label]) => {
                                        const raw = editAgentLedger[k];
                                        const pv = previewUnitPrice(raw);
                                        const empty = raw === '' || raw === null || raw === undefined;
                                        return (
                                          <div key={k}>
                                            <label className="block text-[10px] text-gray-500 mb-0.5">{label} 단가 <span className="text-emerald-700">(VAT 별도)</span></label>
                                            <input
                                              type="text"
                                              value={raw}
                                              onChange={(e) => setEditAgentLedger({ ...editAgentLedger, [k]: sanitizeCostInput(e.target.value) })}
                                              className="w-full px-2 py-1 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500/30 outline-none"
                                              placeholder="미설정"
                                            />
                                            <div className="mt-0.5 text-[10px] text-emerald-700">
                                              {empty ? <span className="text-gray-400">미설정: 청구 차단</span> : <>VAT 포함 {fmtPrice(pv.withVat)}원</>}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="flex gap-1.5">
                                      <input
                                        type="text"
                                        value={editAgentLedger.memo}
                                        onChange={(e) => setEditAgentLedger({ ...editAgentLedger, memo: e.target.value })}
                                        className="flex-1 px-2 py-1 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500/30 outline-none"
                                        placeholder="메모(선택)"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleSaveAgentLedger}
                                        disabled={agentLedgerSaving}
                                        className="whitespace-nowrap px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white rounded-lg text-xs shrink-0"
                                      >
                                        {agentLedgerSaving ? '저장 중...' : '저장'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingAgentRowId(null)}
                                        className="whitespace-nowrap px-2.5 py-1 text-gray-500 hover:text-gray-700 text-xs shrink-0"
                                      >
                                        취소
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 mb-2">등록된 발송ID가 없습니다.</p>
                      )}
                      <div className="flex gap-2">
                        <input type="text" value={newAgentSendId}
                          onChange={(e) => setNewAgentSendId(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                          placeholder="발송ID" />
                        <input type="text" value={newAgentMemo}
                          onChange={(e) => setNewAgentMemo(e.target.value)}
                          className="w-28 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none"
                          placeholder="메모(선택)" />
                        <button
                          type="button"
                          onClick={handleAddAgentId}
                          disabled={agentIdSaving || !newAgentSendId.trim()}
                          className="whitespace-nowrap px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white rounded-lg text-[13px] shrink-0"
                        >
                          {agentIdSaving ? '등록 중...' : '추가'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">최대 사용자 수</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={editCompany.maxUsers}
                        onChange={(e) => setEditCompany({ ...editCompany, maxUsers: Math.max(1, Number(e.target.value)) })}
                        className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" min={1} />
                      <span className="text-sm text-gray-500">명</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">고객사 관리자가 생성할 수 있는 최대 사용자 계정 수</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">세션 타임아웃</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={editCompany.sessionTimeoutMinutes}
                        onChange={(e) => setEditCompany({ ...editCompany, sessionTimeoutMinutes: Math.min(480, Math.max(5, Number(e.target.value))) })}
                        className="w-24 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" min={5} max={480} />
                      <span className="text-sm text-gray-500">분</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">비활동 시 자동 로그아웃 시간 (5~480분 · 기본 480분 = 8시간)</p>
                  </div>
                  </div>
                  </AdminSection>

                  <AdminSection title="발송 설정" plain>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">발송 라인</label>
                    <select value={editCompany.lineGroupId}
                      onChange={(e) => setEditCompany({ ...editCompany, lineGroupId: e.target.value })}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none">
                      <option value="">미할당 (전체 라인 사용)</option>
                      {lineGroups.filter((lg: any) => (lg.group_type === 'bulk' || lg.group_type === 'bito') && lg.is_active).map((lg: any) => (
                        <option key={lg.id} value={lg.id}>{lg.group_name} ({(lg.sms_tables || []).join(', ')})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">대량발송 시 사용할 전용 라인그룹 (미할당 시 전체 라인 라운드로빈)</p>
                  </div>
                  {/* ★ 2026-08-18 발신번호 회선 정책 — 전송자격인증 2.1 */}
                  <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/60">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">발신번호 회선 정책</h4>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          상한은 <span className="font-medium">신규 등록에만</span> 적용됩니다. 이미 등록된 번호는 그대로 유지됩니다.
                        </p>
                      </div>
                      <button type="button" onClick={handleSaveLinePolicy} disabled={!linePolicy || linePolicySaving}
                        className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg transition-colors">
                        {linePolicySaving ? '저장 중…' : '회선 정책 저장'}
                      </button>
                    </div>

                    {!linePolicy ? (
                      <p className="text-xs text-gray-400">불러오는 중…</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3 text-xs">
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            현재 보유 · 무선 <span className="font-semibold text-gray-900">{linePolicy.held.mobile}</span>
                          </span>
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            현재 보유 · 유선 <span className="font-semibold text-gray-900">{linePolicy.held.landline}</span>
                          </span>
                          <span className="px-2 py-1 rounded-md bg-white border border-gray-200 text-gray-600">
                            적용 상한 · 무선 <span className="font-semibold text-gray-900">{linePolicy.effective.mobile ?? '제한 없음'}</span>
                            {linePolicy.perAccount && (
                              <span className="text-gray-500"> (활성 계정 {linePolicy.perAccount.activeAccounts}개 × {linePolicy.perAccount.perAccount})</span>
                            )}
                            {' / '}유선 <span className="font-semibold text-gray-900">{linePolicy.effective.landline ?? '제한 없음'}</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">가입자 유형</label>
                            <select
                              value={linePolicy.subscriberType || ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, subscriberType: e.target.value || null })}
                              className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none">
                              <option value="">미설정</option>
                              <option value="corporate">법인</option>
                              <option value="individual">개인</option>
                              <option value="foreigner">외국인</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">무선 상한</label>
                            <input type="number" min={1} placeholder="비우면 제한 없음"
                              disabled={linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner'}
                              value={linePolicy.mobileLineLimit ?? ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, mobileLineLimit: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">유선 상한</label>
                            <input type="number" min={1} placeholder="비우면 제한 없음"
                              disabled={linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner'}
                              value={linePolicy.landlineLineLimit ?? ''}
                              onChange={(e) => setLinePolicy({ ...linePolicy, landlineLineLimit: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-full px-3 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                          </div>
                        </div>

                        {(linePolicy.subscriberType === 'individual' || linePolicy.subscriberType === 'foreigner') && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            개인·외국인은 고시 기준값이 적용됩니다. 무선 {linePolicy.subscriberType === 'foreigner' ? 2 : 3}회선 · 유선 5회선. 상한을 따로 지정할 수 없습니다.
                          </p>
                        )}
                        {linePolicy.subscriberType === 'corporate' && linePolicy.landlineLineLimit === null && (
                          <p className="text-[11px] text-gray-500">
                            법인 유선 상한은 종사자 수 확인 자료(고용보험 자료 등)를 받아 입력합니다. 비워 두면 제한이 걸리지 않습니다.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  </AdminSection>

                  <AdminSection title="기능" plain>
                  {/* ★ D162-3 (2026-05-15) 수신거부 사용자격리 ON/OFF — 실무 스위치(0826 정리에서 본문 유지) */}
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-800">수신거부 사용자격리</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        ON: 멀티 브랜드 회사용. 고객사관리자는 조회만 가능하고, 사용자가 등록한 수신거부가 관리자에게 자동 동기화됩니다.
                        OFF: 누구든 등록·삭제 가능, 회사 전체 동일 수신거부(기본).
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                      <input
                        type="checkbox"
                        checked={editCompany.userIsolationEnabled}
                        onChange={(e) => setEditCompany({ ...editCompany, userIsolationEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                  {/* ★ 2026-08-22 대행발송 스위치 (docs/2026-08-22-agency-send-design.md §4-1)
                      메뉴는 모든 회사에 보이고, 이 스위치 AND 유료 요금제일 때만 화면으로 들어간다.
                      끄면 새 접수만 막히고 이미 승인된 건은 예정대로 나간다. */}
                  <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800">대행발송</span>
                          <span className="text-xs bg-indigo-500 text-white px-1.5 py-0.5 rounded">NEW</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          ON = 이 회사가 대행발송 화면으로 들어가 명단·문안을 직접 접수합니다 (요금제를 쓰는 계정만).
                          OFF = 메뉴는 보이되 안내만 나갑니다. 끄더라도 이미 승인된 건은 예정대로 발송됩니다.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-3">
                        <input
                          type="checkbox"
                          checked={editCompany.agencySendEnabled}
                          onChange={async (e) => {
                            const next = e.target.checked;
                            setEditCompany({ ...editCompany, agencySendEnabled: next });
                            try {
                              const token = localStorage.getItem('token');
                              const res = await fetch(`/api/admin/companies/${editCompany.id}/agency-send`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                body: JSON.stringify({ enabled: next }),
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                setEditCompany({ ...editCompany, agencySendEnabled: !next }); // 서버가 거절하면 되돌린다
                                showAlert('오류', data?.error || '대행발송 스위치 저장 실패', 'error');
                              } else {
                                setEditCompany({ ...editCompany, agencySendEnabled: !!data.company?.agency_send_enabled });
                                showAlert('완료', data?.message || '대행발송 스위치 저장 완료', 'success');
                              }
                            } catch (err: any) {
                              setEditCompany({ ...editCompany, agencySendEnabled: !next });
                              showAlert('오류', err?.message || '네트워크 오류', 'error');
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                    </div>
                    {/* ★2026-08-26 §18 허용 발신 이메일 — 스위치와 독립(OFF여도 주소는 관리한다). 건수가 곧 상태 표시다 */}
                    <div className="mt-3 pt-3 border-t border-indigo-100 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-500 min-w-0">
                        이메일 접수: 등록된 주소에서 온 요청서 메일만 자동 접수됩니다.
                        {editCompany.agencySendEnabled && agencyEmailActiveCount === 0 && (
                          <span className="ml-1 text-amber-600 font-medium">활성 주소가 0개라 접수 메일이 전부 무시됩니다.</span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAgencyEmailModalOpen(true)}
                        className="whitespace-nowrap shrink-0 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                      >
                        허용 이메일 {agencyEmailActiveCount === null ? '' : `${agencyEmailActiveCount}개 `}관리
                      </button>
                    </div>
                  </div>
                  {/* ★ 2026-08-26 실험실 — 실사용 0~1개사 기능을 접어 정리(실측: 카카오 0사 · Orchestrator 1사 · 자율발송 0사).
                      기능·값·저장 계약(카카오 = 폼 통째 저장 · Orchestrator = 즉시 PATCH · 자율발송 = 자체 저장 버튼)은 무변경 */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setLabOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-gray-600">실험실</span>
                        <span className="text-[10.5px] text-gray-400">카카오 채널 · AI 흐름 · 자율발송</span>
                        {[editCompany.kakaoEnabled, editCompany.useAiOrchestrator, editCompany.cdpAutoExecuteEnabled].filter(Boolean).length > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200">
                            ON {[editCompany.kakaoEnabled, editCompany.useAiOrchestrator, editCompany.cdpAutoExecuteEnabled].filter(Boolean).length}
                          </span>
                        )}
                      </span>
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${labOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {labOpen && (
                      <div className="p-3.5 space-y-3 border-t border-gray-200 bg-white">
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-gray-800">카카오 브랜드메시지</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">켜면 이 고객사에서 카카오 채널 발송이 가능합니다. 저장 버튼으로 반영됩니다.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={editCompany.kakaoEnabled}
                            onChange={(e) => setEditCompany({ ...editCompany, kakaoEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                      </div>
                  {/* ★ D190 #2 (2026-05-22): AI Orchestrator (Tool Use) 회사별 토글 — 토글 변경 시 즉시 PATCH 호출 */}
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">AI Orchestrator (Tool Use)</span>
                        <span className="text-[10px] bg-gray-400 text-white px-1.5 py-0.5 rounded">BETA</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        ON = AI Operator 동적 흐름 결정 모드 활성 (target → count → message → compliance 순서 자율 판단).<br/>
                        OFF = 기존 고정 순서 (안정 영역, default). ENT 1사 한정 활성 → PM2 로그 모니터링 후 단계적 확장 권장.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editCompany.useAiOrchestrator}
                        onChange={async (e) => {
                          const next = e.target.checked;
                          const prev = editCompany.useAiOrchestrator;
                          setEditCompany({ ...editCompany, useAiOrchestrator: next });
                          try {
                            const token = localStorage.getItem('token');
                            const res = await fetch(`/api/admin/companies/${editCompany.id}/ai-orchestrator`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify({ enabled: next }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              showAlert('오류', data?.error || 'AI Orchestrator 토글 실패', 'error');
                              setEditCompany({ ...editCompany, useAiOrchestrator: prev });
                            } else {
                              showAlert('완료', data?.message || 'AI Orchestrator 토글 완료', 'success');
                            }
                          } catch (err: any) {
                            showAlert('오류', err?.message || '네트워크 오류', 'error');
                            setEditCompany({ ...editCompany, useAiOrchestrator: prev });
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                  {/* ★ 2026-06-06 자동마케팅 자율발송 게이트 — 슈퍼관리자 회사별 ON/임계값 (cdp_auto_execute_*) */}
                  <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800">자동마케팅 자율발송 게이트</span>
                          <span className="text-[10px] bg-gray-400 text-white px-1.5 py-0.5 rounded">BETA</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          ON = AI 자동마케팅 제안서가 담당자 승인 없이 임계값 이내에서 <b>자율 발송</b> (회사 잔액 자동 차감 + 고객 자동 발송).<br/>
                          OFF = 제안서는 담당자 수동 승인 대기 (기본). 발신번호·무료거부(080)·잔액은 발송 직전 자동 확인.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-3">
                        <input
                          type="checkbox"
                          checked={editCompany.cdpAutoExecuteEnabled}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteEnabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                    </div>
                    <div className={`grid grid-cols-3 gap-2 mt-3 ${editCompany.cdpAutoExecuteEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 수신자(명)</label>
                        <input type="number" min="1" value={editCompany.cdpAutoExecuteMaxRecipients}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxRecipients: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 회당 비용(원)</label>
                        <input type="number" min="1" value={editCompany.cdpAutoExecuteMaxCostKrw}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxCostKrw: Number(e.target.value) })}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">최대 위험도</label>
                        <select value={editCompany.cdpAutoExecuteMaxRisk}
                          onChange={(e) => setEditCompany({ ...editCompany, cdpAutoExecuteMaxRisk: e.target.value })}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-[13px] focus:ring-2 focus:ring-emerald-500/30 outline-none bg-white">
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                    </div>
                    <button
                      type="button" // 0826 정정: type 미지정이라 폼 submit(통째 저장)까지 함께 나가던 결함
                      onClick={async () => {
                        try {
                          const token = localStorage.getItem('token');
                          const res = await fetch(`/api/admin/companies/${editCompany.id}/cdp-auto-execute`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({
                              enabled: editCompany.cdpAutoExecuteEnabled,
                              maxRecipients: editCompany.cdpAutoExecuteMaxRecipients,
                              maxCostKrw: editCompany.cdpAutoExecuteMaxCostKrw,
                              maxRisk: editCompany.cdpAutoExecuteMaxRisk,
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            showAlert('오류', data?.error || '자율발송 게이트 저장 실패', 'error');
                          } else {
                            const cc = data.company;
                            setEditCompany({ ...editCompany,
                              cdpAutoExecuteEnabled: cc.cdp_auto_execute_enabled,
                              cdpAutoExecuteMaxRecipients: cc.cdp_auto_execute_max_recipients,
                              cdpAutoExecuteMaxCostKrw: cc.cdp_auto_execute_max_cost_krw,
                              cdpAutoExecuteMaxRisk: cc.cdp_auto_execute_max_risk,
                            });
                            showAlert('완료', data?.message || '자율발송 게이트 저장 완료', 'success');
                          }
                        } catch (err: any) {
                          showAlert('오류', err?.message || '네트워크 오류', 'error');
                        }
                      }}
                      className="whitespace-nowrap mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-medium rounded-lg transition-colors">
                      자율발송 게이트 저장
                    </button>
                  </div>
                      </div>
                    )}
                  </div>
                  </AdminSection>
                </div>
              )}
    </>
  );
}
