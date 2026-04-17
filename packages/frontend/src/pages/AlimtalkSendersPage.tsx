/**
 * 알림톡/브랜드메시지 발신프로필 관리 (슈퍼관리자 전용)
 *
 * - 전 회사 발신프로필 목록 (IMC 연동 상태 포함)
 * - 발신프로필 등록 Wizard (3-Step)
 * - 080 무료수신거부 설정
 * - 카테고리 수동 동기화 버튼
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SenderRegistrationWizard from '../components/alimtalk/SenderRegistrationWizard';
import UnsubscribeSettingModal from '../components/alimtalk/UnsubscribeSettingModal';

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

export default function AlimtalkSendersPage() {
  const navigate = useNavigate();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [unsubTarget, setUnsubTarget] = useState<Sender | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
        // /api/companies는 슈퍼관리자 전용 목록 응답 구조에 따름
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
        {loading ? (
          <p className="text-center text-sm text-gray-400 py-10">로딩 중...</p>
        ) : senders.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
            <p className="text-sm text-gray-500">등록된 발신프로필이 없습니다.</p>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
            >
              첫 발신프로필 등록
            </button>
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
                  <th className="text-center px-4 py-2">상태</th>
                  <th className="text-center px-4 py-2">080</th>
                  <th className="text-center px-4 py-2">브랜드M/N</th>
                  <th className="text-right px-4 py-2">관리</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
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
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-600">
                      {s.yellow_id || '-'}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {s.category_name_cache || s.category_code || '-'}
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
                    <td className="text-right px-4 py-2 space-x-1">
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
                ))}
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

      {toast && (
        <div
          className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[60]"
          onAnimationEnd={() => setToast(null)}
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
