/**
 * 발신프로필 080 무료수신거부 설정 모달 (슈퍼관리자)
 */

import { useState } from 'react';

interface Props {
  profile: {
    id: string;
    profile_key: string;
    profile_name: string;
    unsubscribe_phone?: string | null;
    unsubscribe_auth?: string | null;
  };
  onClose: () => void;
  onSuccess: () => void;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

export default function UnsubscribeSettingModal({
  profile,
  onClose,
  onSuccess,
}: Props) {
  const [phone, setPhone] = useState(profile.unsubscribe_phone || '');
  const [auth, setAuth] = useState(profile.unsubscribe_auth || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!/^080\d{7,8}$/.test(phone))
      return setErr('080 번호 형식이 아닙니다 (예: 08012345678)');
    if (!auth.trim()) return setErr('인증번호/비밀번호가 필요합니다');

    setSaving(true);
    try {
      const res = await fetch(`/api/alimtalk/senders/${profile.id}/unsubscribe`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          unsubscribePhoneNumber: phone,
          unsubscribeAuthNumber: auth,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data?.error || '설정 실패');
        return;
      }
      onSuccess();
    } catch (e: any) {
      setErr(e?.message || '서버 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b bg-gradient-to-r from-emerald-50 to-white flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900">080 무료수신거부 설정</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-gray-500">
            프로필:{' '}
            <span className="font-medium">{profile.profile_name}</span>{' '}
            <span className="text-gray-400">
              ({profile.profile_key.slice(0, 20)}…)
            </span>
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              080 수신거부 번호
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              placeholder="08012345678"
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              인증번호 / 비밀번호
            </label>
            <input
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
              placeholder="나래인터넷 ARS 인증번호"
              maxLength={10}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>

          {err && (
            <p className="text-xs text-red-500 border border-red-200 bg-red-50 rounded p-2">
              {err}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
