/**
 * CompanySyncTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { formatDate } from '../../../../utils/formatDate';
import { fetchAuthJson } from '../../../../lib/auth-download';

/** 접속 허용 IP 조회 · 발급 · 회수 요청 상한(본문 읽기까지 · 넘으면 끊고 실패 갈래) */
const ORIGIN_REQUEST_TIMEOUT_MS = 20_000;
/** 발급 결과를 모를 때(본문 못 읽음 · 시간 넘김 · 연결 실패) — 서버는 이미 바꿨을 수 있다 */
const ISSUE_OUTCOME_UNKNOWN = '응답을 받지 못했습니다. 접속 허용 IP 목록을 다시 확인한 뒤 필요하면 다시 발급해 주세요.';

/** ★ 2026-10-29 접속 허용 IP(서버 GET /sync-origins · 그 회사 company_agent 활성 행 · 설계서 docs/2026-10-29-sync-key-origin-required-design.md §2-5) */
interface AgentOrigin { id: string; ip: string; reason: string; approved_at: string | null; expires_at: string | null; is_expired: boolean; }
interface OriginsState { canIssue: boolean; canRevoke: boolean; enforced: boolean; origins: AgentOrigin[]; }

export interface CompanySyncTabProps {
  editCompany: { id: string; companyName: string; contactName: string; contactEmail: string; contactPhone: string; status: string; planId: string; rejectNumber: string; businessNumber: string; ceoName: string; businessType: string; businessItem: string; industryCode: string; address: string; sendHourStart: number; sendHourEnd: number; dailyLimit: number; duplicateDays: number; costPerSms: string | number; costPerLms: string | number; costPerMms: string | number; costPerKakao: string | number; costPerBrand: string | number; costPerBrandNonfriend: string | number; costPerTestSms: string | number; costPerTestLms: string | number; unitPriceBasis: 'vat_included' | 'vat_excluded'; billingType: string; balance: number; balanceAdjustType: 'charge' | 'deduct'; balanceAdjustAmount: string; balanceAdjustReason: string; balanceAdjusting: boolean; targetStrategy: string; crossCategoryAllowed: boolean; excludedSegments: string[]; approvalRequired: boolean; allowCallbackSelfRegister: boolean; maxUsers: number; sessionTimeoutMinutes: number; storeCodeList: string[]; newStoreCode: string; newExcludedSegment: string; lineGroupId: string; kakaoEnabled: boolean; userIsolationEnabled: boolean; usageType: string; useAiOrchestrator: boolean; cdpAutoExecuteEnabled: boolean; cdpAutoExecuteMaxRecipients: number; cdpAutoExecuteMaxCostKrw: number; cdpAutoExecuteMaxRisk: string; agencySendEnabled: boolean; subscriptionStatus: string; trialExpiresAt: string | null | ''; planCode: string; aiOperatorTrialStartedAt: string | null | ''; aiOperatorTrialUntil: string | null | ''; };
  setShowEditCompanyModal: Dispatch<SetStateAction<boolean>>;
  setShowSyncRegenConfirm: Dispatch<SetStateAction<boolean>>;
  setSyncKeyVisible: Dispatch<SetStateAction<boolean>>;
  setSyncKeys: Dispatch<SetStateAction<{ api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; }>>;
  setSyncLoading: Dispatch<SetStateAction<boolean>>;
  setSyncSecretVisible: Dispatch<SetStateAction<boolean>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  showSyncRegenConfirm: boolean;
  syncKeyVisible: boolean;
  syncKeys: { api_key: string | null; api_secret?: string | null; has_secret?: boolean; use_db_sync: boolean; };
  syncLoading: boolean;
  syncSecretVisible: boolean;
}

export default function CompanySyncTab(props: CompanySyncTabProps) {
  const { editCompany, setShowEditCompanyModal, setShowSyncRegenConfirm, setSyncKeyVisible, setSyncKeys, setSyncLoading, setSyncSecretVisible, showAlert, showSyncRegenConfirm, syncKeyVisible, syncKeys, syncLoading, syncSecretVisible } = props;

  // ★ 2026-10-29 발급 = 설치 서버 공인 IP 필수(서버가 같은 트랜잭션에 출발지 등록) · 접속 허용 IP 칸 · 발급 등급 = 서버 조회 값만
  const [originIp, setOriginIp] = useState('');
  const [originsState, setOriginsState] = useState<OriginsState | null>(null);
  const [originsError, setOriginsError] = useState(false);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [originsLoading, setOriginsLoading] = useState(false);
  // 불러오기 하나 = 차례 하나(첫 await 전에 받고 돌아올 때마다 확인) — 늦게 온 옛 응답이 최신 목록을 덮지 않게(Codex 구현 1R · 메모리 async-load-is-one-turn)
  const originsTurn = useRef(0);
  // 이 탭 인스턴스가 살아 있는가 — 모달이 회사 key 로 탭을 다시 만들거나 닫히면 거짓.
  //   발급 · 회수 응답은 부모 상태(키 · 시크릿 · 알림)를 바꾸므로, 늦게 온 응답이 다른 회사 화면에 앞 회사 키를 띄우지 않게 막는다(Codex 구현 2R)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const loadOrigins = useCallback(async () => {
    if (!editCompany.id) return;
    const turn = ++originsTurn.current;
    setOriginsLoading(true);
    setOriginsError(false);
    try {
      const { res, data } = await fetchAuthJson(`/api/admin/companies/${editCompany.id}/sync-origins`, {}, ORIGIN_REQUEST_TIMEOUT_MS);
      if (turn !== originsTurn.current) return;
      if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
      setOriginsState(data);
    } catch (error) {
      if (turn !== originsTurn.current) return;
      console.error('접속 허용 IP 조회 실패:', error);
      setOriginsError(true);
    } finally {
      if (turn === originsTurn.current) setOriginsLoading(false);
    }
  }, [editCompany.id]);

  useEffect(() => { loadOrigins(); }, [loadOrigins]);

// SyncAgent 키 재발급
const handleSyncRegenerate = async () => {
  if (!editCompany.id || !originIp.trim()) return;
  setSyncLoading(true);
  try {
    const { res, data } = await fetchAuthJson(`/api/admin/companies/${editCompany.id}/sync-keys/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originIp: originIp.trim() }),
    }, ORIGIN_REQUEST_TIMEOUT_MS);
    if (!alive.current) return;
    if (res.ok && data) {
      setSyncKeys(data.syncKeys);
      setSyncKeyVisible(true);
      setSyncSecretVisible(true);
      setShowSyncRegenConfirm(false);
      setOriginIp('');
      showAlert('재발급 완료', data.message, 'success');
      loadOrigins();
    } else if (!data) {
      // 본문을 못 읽음(본문 읽기 시간 넘김 포함 · fetchAuthJson 은 그때 data = null) = 결과 불명 — 서버가 이미 바꿨을 수 있다(Codex 구현 2R)
      showAlert('재발급 실패', ISSUE_OUTCOME_UNKNOWN, 'error');
      loadOrigins();
    } else {
      // 확인 칸과 입력값은 남긴다(고쳐서 다시 누르게)
      showAlert('재발급 실패', data.error || '키를 발급하지 못했습니다.', 'error');
    }
  } catch (error) {
    // 시간 넘김 · 연결 실패 = 서버가 이미 바꿨을 수 있다 → 목록을 다시 받아 지금 상태를 보인다
    if (!alive.current) return;
    console.error('SyncAgent 키 재발급 실패:', error);
    showAlert('재발급 실패', ISSUE_OUTCOME_UNKNOWN, 'error');
    loadOrigins();
  } finally {
    if (alive.current) setSyncLoading(false);
  }
};

// 접속 허용 IP 회수 = 국외 접근 통제 회수 라우트(등급 · 감사 그대로)
const handleRevokeOrigin = async (id: string) => {
  setRevoking(true);
  try {
    const { res, data } = await fetchAuthJson(`/api/admin/geo/exceptions/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '싱크 탭에서 회수' }),
    }, ORIGIN_REQUEST_TIMEOUT_MS);
    if (!alive.current) return;
    if (res.ok) {
      setRevokeConfirmId(null);
      showAlert('회수 완료', '접속 허용 IP를 회수했습니다.', 'success');
    } else {
      showAlert('회수 실패', data?.error || '접속 허용 IP를 회수하지 못했습니다.', 'error');
    }
  } catch (error) {
    if (!alive.current) return;
    console.error('접속 허용 IP 회수 실패:', error);
    showAlert('회수 실패', '응답을 받지 못했습니다. 목록을 다시 불러와 확인해 주세요.', 'error');
  } finally {
    setRevoking(false);
    if (alive.current) loadOrigins();   // 성공 · 실패 · 시간 넘김 모두 지금 상태로 다시 그린다
  }
};

// SyncAgent use_db_sync 토글
const handleSyncToggle = async (useDbSync: boolean) => {
  if (!editCompany.id) return;
  setSyncLoading(true);
  try {
    const res = await fetch(`/api/admin/companies/${editCompany.id}/sync-keys`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ useDbSync })
    });
    if (res.ok) {
      const data = await res.json();
      // ★2026-09-13(3) 토글 응답에는 시크릿 원문이 없다(서버에 남지 않는다 · 싱크 등재분 ③).
      //   방금 재발급해 한 번만 보여 주던 원문을 토글 한 번에 지우지 않는다(같은 키일 때만 이어 둔다).
      setSyncKeys((prev) => ({
        ...data.syncKeys,
        ...(prev.api_secret && prev.api_key === data.syncKeys?.api_key ? { api_secret: prev.api_secret } : {}),
      }));
    }
  } catch (error) {
    console.error('SyncAgent 토글 실패:', error);
  } finally {
    setSyncLoading(false);
  }
};
  return (
    <>
    {(
                <div className="space-y-5">
                  {syncLoading ? (
                    <div className="text-center py-8 text-gray-500">로딩 중...</div>
                  ) : (
                    <>
                      {/* use_db_sync 토글 */}
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <div className="text-sm font-medium text-gray-800">SyncAgent 활성화</div>
                          <p className="text-xs text-gray-500 mt-0.5">고객사 DB 자동 동기화 기능</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSyncToggle(!syncKeys.use_db_sync)}
                          className={`relative w-12 h-6 rounded-full transition-colors ${syncKeys.use_db_sync ? 'bg-emerald-600' : 'bg-gray-300'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${syncKeys.use_db_sync ? 'translate-x-6' : ''}`} />
                        </button>
                      </div>

                      {/* API Key 영역 */}
                      <div className={`space-y-4 ${!syncKeys.use_db_sync ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_key ? (syncKeyVisible ? syncKeys.api_key : '••••••••••••••••••••') : '(미발급)'}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-[13px] font-mono pr-10"
                              />
                              {syncKeys.api_key && (
                                <button type="button" onClick={() => setSyncKeyVisible(!syncKeyVisible)}
                                  className="whitespace-nowrap absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                                  {syncKeyVisible ? '숨김' : '보기'}
                                </button>
                              )}
                            </div>
                            {syncKeys.api_key && syncKeyVisible && (
                              <button type="button"
                                onClick={() => { navigator.clipboard.writeText(syncKeys.api_key || ''); showAlert('복사 완료', '복사되었습니다.', 'success'); }}
                                className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                                복사
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ★2026-09-12 시크릿은 서버에 원문으로 남지 않는다. 재발급 직후 이 화면에서만 보인다. */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">API Secret</label>
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input type="text" readOnly
                                value={syncKeys.api_secret
                                  ? (syncSecretVisible ? syncKeys.api_secret : '••••••••••••••••••••')
                                  : (syncKeys.has_secret ? '발급되어 있습니다 (다시 볼 수 없음)' : '(미발급)')}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg bg-gray-50 text-[13px] font-mono pr-10"
                              />
                              {syncKeys.api_secret && (
                                <button type="button" onClick={() => setSyncSecretVisible(!syncSecretVisible)}
                                  className="whitespace-nowrap absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                                  {syncSecretVisible ? '숨김' : '보기'}
                                </button>
                              )}
                            </div>
                            {syncKeys.api_secret && syncSecretVisible && (
                              <button type="button"
                                onClick={() => { navigator.clipboard.writeText(syncKeys.api_secret || ''); showAlert('복사 완료', '복사되었습니다.', 'success'); }}
                                className="px-3 py-2 border rounded-lg text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                                복사
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {syncKeys.api_secret
                              ? '지금 화면을 벗어나면 다시 볼 수 없습니다. 설치에 쓸 값을 복사해 두세요.'
                              : '보안을 위해 서버에 원문을 두지 않습니다. 값이 필요하면 아래에서 재발급하세요.'}
                          </p>
                        </div>

                        {/* 재발급 버튼 — 발급 등급은 서버가 준 값만(접속 허용 IP 조회 응답) · 조회 전에는 그리지 않는다 */}
                        <div className="pt-3 border-t">
                          {!originsState ? null : !originsState.canIssue ? (
                            <p className="text-xs text-gray-500">키 발급은 국외 접근 통제를 바꿀 수 있는 등급만 할 수 있습니다.</p>
                          ) : !showSyncRegenConfirm ? (
                            <button type="button" onClick={() => setShowSyncRegenConfirm(true)} disabled={originsLoading}
                              className="whitespace-nowrap w-full px-4 py-2.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-[13px] font-medium hover:bg-orange-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
                              API Key 재발급
                            </button>
                          ) : (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
                              <div className="text-sm text-red-700 font-medium">정말 재발급하시겠습니까?</div>
                              <p className="text-xs text-red-600">기존 API Key는 즉시 무효화됩니다. 해당 고객사의 SyncAgent가 새 키로 재설정되어야 합니다.</p>
                              <div>
                                <label htmlFor="sync-origin-ip" className="block text-xs font-medium text-gray-700 mb-1">설치 서버 공인 IP</label>
                                <input id="sync-origin-ip" type="text" inputMode="decimal" autoComplete="off" value={originIp}
                                  onChange={(e) => setOriginIp(e.target.value)}
                                  placeholder="예: 203.0.113.10"
                                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-red-200"
                                />
                                <p className="mt-1 text-xs text-gray-600">이 IP에서 오는 싱크에이전트 접속만 받습니다. 발급과 함께 국외 접근 통제에 등록되고, 이전 발급 때 등록한 IP는 회수됩니다.</p>
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => setShowSyncRegenConfirm(false)}
                                  className="whitespace-nowrap flex-1 px-3 py-2 border rounded-lg text-[13px] text-gray-600 hover:bg-gray-50">
                                  취소
                                </button>
                                <button type="button" onClick={handleSyncRegenerate} disabled={!originIp.trim() || originsLoading}
                                  className="whitespace-nowrap flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-[13px] font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600">
                                  재발급 확인
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-gray-400">
                          SyncAgent 설치 시 위 API Key/Secret을 고객사 에이전트 설정 파일에 입력합니다.
                          재발급 시 기존 키는 즉시 무효화되므로, 에이전트 설정도 함께 변경해야 합니다.
                        </p>
                      </div>

                      {/* 접속 허용 IP — 사용 토글로 흐려지는 키 영역 밖(꺼져 있어도 보고 회수한다) */}
                      <div className="p-4 border border-gray-200 rounded-lg space-y-3">
                        <div>
                          <div className="text-sm font-medium text-gray-800">접속 허용 IP</div>
                          <p className="text-xs text-gray-500 mt-0.5">이 회사 싱크에이전트가 접속할 수 있는 설치 서버 주소입니다.</p>
                        </div>
                        {originsError ? (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-red-600">
                            <span>접속 허용 IP를 불러오지 못했습니다.</span>
                            <button type="button" onClick={loadOrigins}
                              className="whitespace-nowrap px-2.5 py-1 border border-red-200 rounded-md text-red-700 hover:bg-red-50">
                              다시 불러오기
                            </button>
                          </div>
                        ) : !originsState ? (
                          <div className="text-xs text-gray-400">불러오는 중...</div>
                        ) : originsState.origins.length === 0 ? (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-0.5">
                            <p className="font-medium">이 회사 전용 접속 허용 IP가 없습니다.</p>
                            <p>{originsState.enforced
                              ? '출발지 통제가 켜져 있어 등록되지 않은 곳의 싱크에이전트 접속은 막힙니다.'
                              : '지금은 기록만 하고 막지 않지만, 통제가 켜지면 막힙니다.'}</p>
                            <p>재발급할 때 설치 서버 IP를 넣으면 등록됩니다.</p>
                          </div>
                        ) : (
                          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                            {originsState.origins.map((o) => (
                              <li key={o.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-mono text-[13px] text-gray-900">{o.ip}</span>
                                <span className="text-xs text-gray-600">{o.reason}</span>
                                <span className="text-xs text-gray-400">
                                  {o.approved_at ? `${formatDate(o.approved_at)} 등록` : ''}{o.expires_at ? `, ${formatDate(o.expires_at)} 만료` : ''}
                                </span>
                                {o.is_expired && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">만료</span>}
                                {originsState.canRevoke && (
                                  revokeConfirmId === o.id ? (
                                    <span className="ml-auto flex items-center gap-1.5">
                                      <span className="text-xs text-red-600">이 IP를 접속 허용에서 뺍니다.</span>
                                      <button type="button" onClick={() => setRevokeConfirmId(null)} disabled={revoking}
                                        className="whitespace-nowrap px-2 py-1 border rounded-md text-xs text-gray-600 hover:bg-gray-50">
                                        취소
                                      </button>
                                      <button type="button" onClick={() => handleRevokeOrigin(o.id)} disabled={revoking || originsLoading}
                                        className="whitespace-nowrap px-2 py-1 bg-red-600 text-white rounded-md text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                                        회수 확인
                                      </button>
                                    </span>
                                  ) : (
                                    <button type="button" onClick={() => setRevokeConfirmId(o.id)} disabled={originsLoading}
                                      className="ml-auto whitespace-nowrap px-2 py-1 border border-gray-200 rounded-md text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                                      회수
                                    </button>
                                  )
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}

                  {/* 닫기 버튼 */}
                  <div className="flex pt-4 mt-4 border-t">
                    <button type="button" onClick={() => setShowEditCompanyModal(false)}
                      className="whitespace-nowrap w-full px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                      닫기
                    </button>
                  </div>
                </div>
              )}
    </>
  );
}
