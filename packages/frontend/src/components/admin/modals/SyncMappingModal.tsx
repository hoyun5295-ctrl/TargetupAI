/**
 * SyncMappingModal — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTimeShort } from '../../../utils/formatDate';

export interface SyncMappingModalProps {
  loadSyncAgents: () => Promise<void>;
  setShowSyncMappingModal: Dispatch<SetStateAction<boolean>>;
  setSyncMapCustomers: Dispatch<SetStateAction<{ src: string; target: string; label: string; }[]>>;
  setSyncMapDryRunning: Dispatch<SetStateAction<boolean>>;
  setSyncMapPurchases: Dispatch<SetStateAction<{ src: string; target: string; label: string; }[]>>;
  setSyncMapSaving: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  syncMapAckSupported: boolean;
  syncMapCustomers: { src: string; target: string; label: string; }[];
  syncMapDryRunning: boolean;
  syncMapPurchases: { src: string; target: string; label: string; }[];
  syncMapReportLoading: boolean;
  syncMapReported: any;
  syncMapSaving: boolean;
  syncSelectedAgent: any;
}

export default function SyncMappingModal(props: SyncMappingModalProps) {
  const { loadSyncAgents, setShowSyncMappingModal, setSyncMapCustomers, setSyncMapDryRunning, setSyncMapPurchases, setSyncMapSaving, showAlert, showConfirm, syncMapAckSupported, syncMapCustomers, syncMapDryRunning, syncMapPurchases, syncMapReportLoading, syncMapReported, syncMapSaving, syncSelectedAgent } = props;

// ★ 2026-07-01: 원격 컬럼 매핑 편집(update_config) — 소스컬럼 → 표준/custom 슬롯
const SYNC_CUSTOM_SLOTS = Array.from({ length: 15 }, (_, i) => `custom_${i + 1}`);
const SYNC_CUSTOMER_TARGET_FIELDS = [
  'phone', 'name', 'gender', 'birth_date', 'email', 'address', 'region', 'grade',
  'store_phone', 'points', 'store_code', 'store_name', 'registered_store',
  'registered_store_number', 'registration_type', 'callback', 'sms_opt_in',
  'recent_purchase_date', 'recent_purchase_amount', 'recent_purchase_store',
  'total_purchase_amount', 'purchase_count', ...SYNC_CUSTOM_SLOTS,
];
const SYNC_PURCHASE_TARGET_FIELDS = [
  'customer_phone', 'purchase_date', 'total_amount', 'quantity',
  'store_code', 'store_name', 'product_code', 'product_name', 'unit_price', ...SYNC_CUSTOM_SLOTS,
];

// 편집 행 → 전송 payload (저장·dry-run 공용). 빈 행 제외.
const buildSyncMappingPayload = () => {
  const customers: Record<string, string> = {};
  const customFieldLabels: Record<string, string> = {};
  for (const r of syncMapCustomers) {
    const src = r.src.trim();
    const target = r.target.trim();
    if (!src || !target) continue;
    customers[src] = target;
    if (/^custom_\d+$/.test(target) && r.label.trim()) customFieldLabels[target] = r.label.trim();
  }
  const purchases: Record<string, string> = {};
  for (const r of syncMapPurchases) {
    const src = r.src.trim();
    const target = r.target.trim();
    if (!src || !target) continue;
    purchases[src] = target;
  }
  const mapping: any = {};
  if (Object.keys(customers).length) mapping.customers = customers;
  if (Object.keys(purchases).length) mapping.purchases = purchases;
  if (Object.keys(customFieldLabels).length) mapping.customFieldLabels = customFieldLabels;
  return { mapping, custCount: Object.keys(customers).length, purchCount: Object.keys(purchases).length };
};

// ★ 2026-07-10 P0-2: 저장 = "전체 교체" 확인 모달을 거친 후에만 전송 (부분 추가 저장 사고 차단)
const handleSyncMappingSave = () => {
  if (!syncSelectedAgent) return;
  if (!syncMapReported) {
    showAlert('저장 불가', '에이전트가 아직 적용 매핑을 보고하지 않았습니다(구버전 또는 첫 heartbeat 전). 빈 화면 저장은 기존 매핑 전체를 지울 수 있어 차단됩니다.', 'error');
    return;
  }
  const { mapping, custCount, purchCount } = buildSyncMappingPayload();
  if (!mapping.customers && !mapping.purchases) {
    showAlert('입력 오류', '매핑을 한 개 이상 입력해주세요.', 'error');
    return;
  }
  showConfirm(
    '매핑 전체 교체',
    `이 저장은 전송한 대상의 매핑 전체를 교체합니다.\n\n전송: 고객 ${custCount}행 · 구매 ${purchCount}행\n(행을 모두 지운 대상은 전송되지 않아 기존 매핑이 유지됩니다)\n\n적용 후 바뀐 대상만 전체 재동기화가 실행됩니다. 진행할까요?`,
    () => { void doSyncMappingSend(mapping); },
  );
};

const doSyncMappingSend = async (mapping: any) => {
  if (!syncSelectedAgent) return;
  setSyncMapSaving(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'update_config', mapping }),
    });
    const data = await res.json();
    // ★2026-09-02 매핑 검증 실패는 사유를 줄줄이 보여준다 — "무엇이 틀렸는지"를 모르면 담당자가 고칠 수 없다.
    //   서버가 잘못된 필드·빠진 필수 필드를 issues로 내려준다(BUGS B-0902-4 · 구매 98,600건 전량 드롭).
    if (!res.ok && Array.isArray(data?.issues) && data.issues.length > 0) {
      const lines = data.issues.map((it: any) => `· ${it.message}`).join('\n');
      throw new Error(`${data.error || '매핑을 저장할 수 없습니다.'}\n\n${lines}`);
    }
    if (!res.ok) throw new Error(data.error || '매핑 전송 실패');
    setShowSyncMappingModal(false);
    showAlert('성공', `매핑이 전송되었습니다. Agent가 다음 heartbeat(최대 60분)에 매핑을 갱신하고 바뀐 대상만 전체 재동기화합니다.${syncMapAckSupported ? '\n적용 결과는 상세 화면의 "명령 결과"에서 확인할 수 있습니다.' : ''}`, 'success');
    loadSyncAgents();
  } catch (e: any) {
    showAlert('오류', e.message || '매핑 전송 실패', 'error');
  } finally {
    setSyncMapSaving(false);
  }
};

// ★ 2026-07-10 P2-9: 매핑 dry-run — 편집 중 매핑을 소스 1행에 적용한 미리보기(저장·적용 없음).
//   결과는 에이전트 ACK로 상세 "명령 결과"에 도착(부스트로 보통 1~2분).
const handleSyncMappingDryRun = async () => {
  if (!syncSelectedAgent) return;
  const { mapping } = buildSyncMappingPayload();
  delete mapping.customFieldLabels; // dry-run은 라벨 불요
  if (!mapping.customers && !mapping.purchases) {
    showAlert('입력 오류', 'dry-run할 매핑을 한 개 이상 입력해주세요.', 'error');
    return;
  }
  setSyncMapDryRunning(true);
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/admin/sync/agents/${syncSelectedAgent.id}/command`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'mapping_dryrun', mapping }),
    });
    const data = await res.json();
    // 매핑 검증 사유도 그대로 보여준다(저장 경로와 같은 형태).
    if (!res.ok && Array.isArray(data?.issues) && data.issues.length > 0) {
      throw new Error(`${data.error || '매핑을 확인해 주세요.'}\n\n${data.issues.map((it: any) => `· ${it.message}`).join('\n')}`);
    }
    if (!res.ok) throw new Error(data.error || 'dry-run 전송 실패');
    showAlert('전송됨', '매핑 미리보기(dry-run) 명령을 보냈습니다. 결과는 상세 화면의 "명령 결과"에 도착합니다(에이전트 응답 주기에 따라 수 분 소요). 저장·적용은 일어나지 않습니다.', 'success');
  } catch (e: any) {
    showAlert('오류', e.message || 'dry-run 전송 실패', 'error');
  } finally {
    setSyncMapDryRunning(false);
  }
};
  return (
    <>
    {(
        <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[680px] max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in">
            <div className="p-5 border-b bg-gradient-to-r from-violet-50 to-fuchsia-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-800">컬럼 매핑 편집</h3>
                  <p className="text-xs text-gray-500">{syncSelectedAgent.company_name} · {syncSelectedAgent.agent_name}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto">
              {/* ★ 2026-07-10 P0: 에이전트 자기 보고 상태 배너 — 프리필 원천·구버전 정직 안내 */}
              {syncMapReportLoading ? (
                <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500">
                  에이전트 보고(적용 매핑·소스 컬럼)를 불러오는 중...
                </div>
              ) : syncMapReported ? (
                <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    에이전트 보고 기준 프리필: 보고 {syncMapReported.reportedAt ? formatDateTimeShort(syncMapReported.reportedAt) : '-'}
                    {' '}· 매핑 해시 <span className="font-mono">{syncMapReported.configVersion || '-'}</span>
                    {' '}· 소스 컬럼 고객 {(syncMapReported.sourceColumns?.customers || []).length}개
                    {syncMapReported.sourceColumns?.purchases ? ` / 구매 ${syncMapReported.sourceColumns.purchases.length}개` : ''}
                  </div>
                  {(() => {
                    const used = new Set<string>();
                    for (const r of [...syncMapCustomers, ...syncMapPurchases]) {
                      if (/^custom_\d+$/.test(r.target)) used.add(r.target);
                    }
                    return (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${used.size >= 15 ? 'bg-red-100 text-red-700' : 'bg-violet-100 text-violet-700'}`}>
                        custom 슬롯 {used.size}/15 사용 · 잔여 {Math.max(0, 15 - used.size)}
                      </span>
                    );
                  })()}
                </div>
              ) : (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  에이전트 보고 대기. 현재 적용 매핑을 아직 보고하지 않았습니다(구버전 v{syncSelectedAgent.agent_version || '?'} 또는 첫 heartbeat 전).
                  기존 매핑을 볼 수 없는 상태의 저장은 <b>매핑 전체 소실</b> 위험이 있어 차단됩니다. v1.6.1 이상 배포 후 사용해주세요.
                </div>
              )}

              {/* 고객 매핑 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[13px] font-semibold text-gray-700">고객 매핑</label>
                  <button
                    onClick={() => setSyncMapCustomers([...syncMapCustomers, { src: '', target: '', label: '' }])}
                    className="whitespace-nowrap text-xs text-violet-600 hover:text-violet-800 font-medium"
                  >+ 행 추가</button>
                </div>
                <div className="space-y-2">
                  {syncMapCustomers.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {/* ★ 2026-07-10 P0: 소스 컬럼 = 보고된 실컬럼 드롭다운(자유 타이핑 폐지 — 오타 매핑 차단). 보고 없으면 입력 유지 */}
                      {(syncMapReported?.sourceColumns?.customers || []).length > 0 ? (
                        <select
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], src: e.target.value }; setSyncMapCustomers(n); }}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                        >
                          <option value="">소스 컬럼 선택</option>
                          {row.src && !(syncMapReported.sourceColumns.customers as string[]).includes(row.src) && (
                            <option value={row.src}>{row.src} (보고 목록 밖)</option>
                          )}
                          {(syncMapReported.sourceColumns.customers as string[]).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input
                          placeholder="소스 컬럼 (예: 신규등록일자)"
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], src: e.target.value }; setSyncMapCustomers(n); }}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <span className="text-gray-400 text-xs">→</span>
                      <select
                        value={row.target}
                        onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], target: e.target.value }; setSyncMapCustomers(n); }}
                        className="w-36 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                      >
                        <option value="">타겟 선택</option>
                        {SYNC_CUSTOMER_TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {/^custom_\d+$/.test(row.target) && (
                        <input
                          placeholder="라벨 (예: 등록일자)"
                          value={row.label}
                          onChange={(e) => { const n = [...syncMapCustomers]; n[i] = { ...n[i], label: e.target.value }; setSyncMapCustomers(n); }}
                          className="w-28 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <button
                        onClick={() => setSyncMapCustomers(syncMapCustomers.filter((_, j) => j !== i))}
                        className="whitespace-nowrap text-red-400 hover:text-red-600 text-[13px] px-1"
                        title="행 삭제"
                      >✕</button>
                    </div>
                  ))}
                  {syncMapCustomers.length === 0 && !syncMapReportLoading && (
                    <p className="text-xs text-gray-400">{syncMapReported ? '보고된 고객 매핑이 없습니다. 행 추가로 입력하세요.' : '행 추가로 매핑을 입력하세요.'}</p>
                  )}
                </div>
              </div>

              {/* 구매 매핑 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[13px] font-semibold text-gray-700">구매 매핑</label>
                  <button
                    onClick={() => setSyncMapPurchases([...syncMapPurchases, { src: '', target: '', label: '' }])}
                    className="whitespace-nowrap text-xs text-violet-600 hover:text-violet-800 font-medium"
                  >+ 행 추가</button>
                </div>
                <div className="space-y-2">
                  {syncMapPurchases.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {(syncMapReported?.sourceColumns?.purchases || []).length > 0 ? (
                        <select
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], src: e.target.value }; setSyncMapPurchases(n); }}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                        >
                          <option value="">소스 컬럼 선택</option>
                          {row.src && !(syncMapReported.sourceColumns.purchases as string[]).includes(row.src) && (
                            <option value={row.src}>{row.src} (보고 목록 밖)</option>
                          )}
                          {(syncMapReported.sourceColumns.purchases as string[]).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <input
                          placeholder="소스 컬럼 (예: 고객전화)"
                          value={row.src}
                          onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], src: e.target.value }; setSyncMapPurchases(n); }}
                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                        />
                      )}
                      <span className="text-gray-400 text-xs">→</span>
                      <select
                        value={row.target}
                        onChange={(e) => { const n = [...syncMapPurchases]; n[i] = { ...n[i], target: e.target.value }; setSyncMapPurchases(n); }}
                        className="w-36 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
                      >
                        <option value="">타겟 선택</option>
                        {SYNC_PURCHASE_TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <button
                        onClick={() => setSyncMapPurchases(syncMapPurchases.filter((_, j) => j !== i))}
                        className="whitespace-nowrap text-red-400 hover:text-red-600 text-[13px] px-1"
                        title="행 삭제"
                      >✕</button>
                    </div>
                  ))}
                  {syncMapPurchases.length === 0 && <p className="text-xs text-gray-400">구매 매핑이 없으면 비워두세요.</p>}
                </div>
              </div>

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                <div>• <b>저장은 전송한 대상의 매핑 전체를 교체</b>합니다. 남길 매핑도 화면에 남아 있어야 합니다.</div>
                <div>• 저장 시 Agent가 다음 heartbeat(최대 60분)에 매핑을 갱신하고 <b>바뀐 대상만</b> 전체 재동기화합니다.</div>
                <div>• custom 슬롯은 라벨이 화면 표시명이 됩니다(비우면 슬롯명 표시).</div>
                <div>• <b>미리보기(dry-run)</b>는 소스 1행에 적용한 결과만 회신하고 저장·적용하지 않습니다. 결과는 상세의 "명령 결과"에 도착합니다.</div>
              </div>
            </div>

            <div className="flex border-t">
              <button
                onClick={() => setShowSyncMappingModal(false)}
                disabled={syncMapSaving || syncMapDryRunning}
                className="whitespace-nowrap flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors border-r disabled:opacity-50"
              >취소</button>
              {/* ★ 2026-07-10 P2-9: dry-run — v1.6.1+(ACK) 전용 */}
              <button
                onClick={handleSyncMappingDryRun}
                disabled={syncMapSaving || syncMapDryRunning || !syncMapAckSupported}
                title={!syncMapAckSupported ? '에이전트 v1.6.1 이상에서 지원' : undefined}
                className="whitespace-nowrap flex-1 px-4 py-3 text-emerald-700 font-medium hover:bg-emerald-50 transition-colors border-r disabled:opacity-50"
              >{syncMapDryRunning ? '전송 중...' : '미리보기(dry-run)'}</button>
              <button
                onClick={handleSyncMappingSave}
                disabled={syncMapSaving || syncMapDryRunning || syncMapReportLoading || !syncMapReported}
                title={!syncMapReported ? '에이전트 보고 수신 후 저장 가능(빈 화면 저장 차단)' : undefined}
                className="whitespace-nowrap flex-1 px-4 py-3 text-violet-600 font-medium hover:bg-violet-50 transition-colors disabled:opacity-50"
              >{syncMapSaving ? '전송 중...' : '매핑 저장 및 전송'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
