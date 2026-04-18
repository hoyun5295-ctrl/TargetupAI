/**
 * 알림톡/브랜드메시지 발신프로필 관리 (슈퍼관리자 전용)
 *
 * - 전 회사 발신프로필 목록 (IMC 연동 상태 + 승인 워크플로우)
 * - 승인/반려 액션 (PENDING_APPROVAL만)
 * - 승인 상태 필터 탭 (전체 / 승인대기 / 승인완료 / 반려)
 * - 발신프로필 등록 Wizard (3-Step)
 * - 080 무료수신거부 설정
 * - 카테고리 수동 동기화 버튼
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SenderRegistrationWizard from '../components/alimtalk/SenderRegistrationWizard';
import UnsubscribeSettingModal from '../components/alimtalk/UnsubscribeSettingModal';

type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

interface Sender {
  id: string;
  company_id: string;
  company_name?: string;
  profile_key: string;
  profile_name: string;
  is_active: boolean;
  yellow_id: string | null;
  admin_phone_number: string | null;
  category_code: string | null;
  category_name_cache: string | null;
  status: string;
  unsubscribe_phone: string | null;
  unsubscribe_auth: string | null;
  top_sender_yn: 'Y' | 'N' | null;
  brand_targeting_yn: 'Y' | 'N' | null;
  registered_at: string | null;
  created_at: string;
  approval_status: ApprovalStatus | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  reject_reason: string | null;
}

interface Company {
  id: string;
  company_name: string;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

const STATUS_BADGE: Record<string, string> = {
  PENDING:  'bg-gray-100 text-gray-600',
  NORMAL:   'bg-emerald-100 text-emerald-700',
  DORMANT:  'bg-amber-100 text-amber-700',
  BLOCKED:  'bg-red-100 text-red-700',
  DELETED:  'bg-gray-200 text-gray-500',
};

const APPROVAL_BADGE: Record<ApprovalStatus, { label: string; cls: string }> = {
  PENDING_APPROVAL: { label: '승인대기', cls: 'bg-yellow-100 text-yellow-700' },
  APPROVED:         { label: '승인',     cls: 'bg-green-100 text-green-700' },
  REJECTED:         { label: '반려',     cls: 'bg-red-100 text-red-700' },
};

type TabKey = 'all' | ApprovalStatus;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',               label: '전체' },
  { key: 'PENDING_APPROVAL',  label: '승인대기' },
  { key: 'APPROVED',          label: '승인완료' },
  { key: 'REJECTED',          label: '반려' },
];

export default function AlimtalkSendersPage() {
  const navigate = useNavigate();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [unsubTarget, setUnsubTarget] = useState<Sender | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('all');
  const [rejectTarget, setRejectTarget] = useState<Sender | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch('/api/alimtalk/senders', {
          headers: { Authorization: `Bearer ${getToken()}` },
        }),
        fetch('/api/companies', {
          headers: { Authorization: `Bearer ${getToken()}` },
        }),
      ]);
      const sData = await sRes.json();
      if (sRes.ok && sData.success) setSenders(sData.profiles || []);

      const cData = await cRes.json();
      if (cRes.ok) {
        const list = cData.companies || cData.rows || cData || [];
        setCompanies(
          Array.isArray(list)
            ? list.map((c: any) => ({
                id: c.id,
                company_name: c.company_name || c.name || c.id,
              }))
            : [],
        );
      }
    } catch (e: any) {
      setToast(e?.message || '로딩 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const syncCategories = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/alimtalk/categories/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setToast(data.success ? '카테고리 동기화 요청 완료' : data?.error || '실패');
    } catch (e: any) {
      setToast(e?.message || '실패');
    } finally {
      setSyncing(false);
    }
  };

  const syncSenders = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/alimtalk/jobs/sync-sender-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setToast(data.success ? '발신프로필 상태 동기화 완료' : data?.error || '실패');
      load();
    } catch (e: any) {
      setToast(e?.message || '실패');
    } finally {
      setSyncing(false);
    }
  };

  const releaseDormant = async (s: Sender) => {
    if (!confirm(`'${s.profile_name}' 프로필의 휴면을 해제할까요?`)) return;
    const res = await fetch(`/api/alimtalk/senders/${s.id}/release`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await res.json();
    setToast(data.success ? '휴면 해제 완료' : data?.error || '실패');
    load();
  };

  const approveSender = async (s: Sender) => {
    if (!confirm(`'${s.profile_name}' 발신프로필을 승인합니다. 계속할까요?`)) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/alimtalk/senders/${s.id}/approve`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setToast(data.success ? '승인 처리 완료' : data?.error || '승인 실패');
      load();
    } catch (e: any) {
      setToast(e?.message || '승인 실패');
    } finally {
      setSubmittingAction(false);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) {
      setToast('반려 사유를 3자 이상 입력해주세요');
      return;
    }
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/alimtalk/senders/${rejectTarget.id}/reject`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rejectReason: reason }),
      });
      const data = await res.json();
      setToast(data.success ? '반려 처리 완료' : data?.error || '반려 실패');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (e: any) {
      setToast(e?.message || '반려 실패');
    } finally {
      setSubmittingAction(false);
    }
  };

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = {
      all: senders.length,
      PENDING_APPROVAL: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    senders.forEach((s) => {
      const k = (s.approval_status || 'PENDING_APPROVAL') as ApprovalStatus;
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [senders]);

  const filtered = useMemo(() => {
    if (tab === 'all') return senders;
    return senders.filter(
      (s) => (s.approval_status || 'PENDING_APPROVAL') === tab,
    );
  }, [senders, tab]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">
            알림톡/브랜드메시지 발신프로필
          </h1>
          <p className="text-xs text-gray-500">슈퍼관리자 · 휴머스온 IMC 연동</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            관리자 홈
          </button>
          <button
            type="button"
            onClick={syncCategories}
            disabled={syncing}
            className="px-3 py-1.5 text-sm bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg disabled:opacity-50"
          >
            카테고리 동기화
          </button>
          <button
            type="button"
            onClick={syncSenders}
            disabled={syncing}
            className="px-3 py-1.5 text-sm bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg disabled:opacity-50"
          >
            상태 동기화
          </button>
          <button
            type="button"
            onClick={() => setShowWizard(true)}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            + 발신프로필 등록
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 승인 상태 탭 */}
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => {
            const count = counts[t.key];
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  active
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t.label}
                <span
                  className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded ${
                    active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-400 py-10">로딩 중...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <p className="text-sm text-gray-500">
              {tab === 'all'
                ? '등록된 발신프로필이 없습니다.'
                : `'${TABS.find((t) => t.key === tab)?.label}' 상태인 발신프로필이 없습니다.`}
            </p>
            {tab === 'all' && (
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
              >
                첫 발신프로필 등록
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">회사</th>
                  <th className="text-left px-4 py-2">프로필</th>
                  <th className="text-left px-4 py-2">채널ID</th>
                  <th className="text-left px-4 py-2">카테고리</th>
                  <th className="text-center px-4 py-2">승인</th>
                  <th className="text-center px-4 py-2">IMC</th>
                  <th className="text-center px-4 py-2">080</th>
                  <th className="text-center px-4 py-2">브랜드M/N</th>
                  <th className="text-right px-4 py-2">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const approval = (s.approval_status ||
                    'PENDING_APPROVAL') as ApprovalStatus;
                  const approvalBadge = APPROVAL_BADGE[approval];
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-gray-100 hover:bg-gray-50 align-top"
                    >
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {s.company_name || s.company_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">
                          {s.profile_name}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {s.profile_key?.slice(0, 20)}...
                        </div>
                        {approval === 'REJECTED' && s.reject_reason && (
                          <div className="text-[11px] text-red-600 mt-0.5 max-w-xs truncate">
                            반려: {s.reject_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-600">
                        {s.yellow_id || '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {s.category_name_cache || s.category_code || '-'}
                      </td>
                      <td className="text-center px-4 py-2">
                        <span
                          className={`inline-block text-[11px] px-2 py-0.5 rounded ${approvalBadge.cls}`}
                        >
                          {approvalBadge.label}
                        </span>
                      </td>
                      <td className="text-center px-4 py-2">
                        <span
                          className={`inline-block text-[11px] px-2 py-0.5 rounded ${
                            STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="text-center px-4 py-2 text-xs">
                        {s.unsubscribe_phone ? (
                          <span className="text-emerald-600">설정됨</span>
                        ) : (
                          <span className="text-gray-300">미설정</span>
                        )}
                      </td>
                      <td className="text-center px-4 py-2 text-xs">
                        {s.brand_targeting_yn === 'Y' ? '✓' : '-'}
                      </td>
                      <td className="text-right px-4 py-2 space-x-1 whitespace-nowrap">
                        {approval === 'PENDING_APPROVAL' && (
                          <>
                            <button
                              type="button"
                              onClick={() => approveSender(s)}
                              disabled={submittingAction}
                              className="text-[11px] px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectTarget(s);
                                setRejectReason('');
                              }}
                              disabled={submittingAction}
                              className="text-[11px] px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50"
                            >
                              반려
                            </button>
                          </>
                        )}
                        {approval === 'REJECTED' && (
                          <button
                            type="button"
                            onClick={() => approveSender(s)}
                            disabled={submittingAction}
                            className="text-[11px] px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                          >
                            재승인
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setUnsubTarget(s)}
                          className="text-[11px] px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded"
                        >
                          080 설정
                        </button>
                        {s.status === 'DORMANT' && (
                          <button
                            type="button"
                            onClick={() => releaseDormant(s)}
                            className="text-[11px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded"
                          >
                            휴면해제
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {showWizard && (
        <SenderRegistrationWizard
          companies={companies}
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            setShowWizard(false);
            setToast('발신프로필 등록 완료');
            load();
          }}
        />
      )}

      {unsubTarget && (
        <UnsubscribeSettingModal
          profile={unsubTarget}
          onClose={() => setUnsubTarget(null)}
          onSuccess={() => {
            setUnsubTarget(null);
            setToast('080 설정 완료');
            load();
          }}
        />
      )}

      {/* 반려 사유 입력 모달 */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              발신프로필 반려
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              <span className="font-medium text-gray-700">
                {rejectTarget.profile_name}
              </span>
              <span className="mx-1">·</span>
              {rejectTarget.company_name || rejectTarget.company_id.slice(0, 8)}
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              반려 사유 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="반려 사유를 3자 이상 입력해주세요 (고객사에게 전달됩니다)"
              className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              maxLength={500}
            />
            <div className="text-right text-[11px] text-gray-400 mt-1">
              {rejectReason.length} / 500
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                disabled={submittingAction}
                className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={submittingAction || rejectReason.trim().length < 3}
                className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-50"
              >
                반려
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[60] cursor-pointer"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
