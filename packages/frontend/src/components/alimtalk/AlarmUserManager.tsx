/**
 * 알림톡 검수 결과 알림 수신자 관리 (고객사)
 *
 * 최대 10명 (IMC 정책).
 */

import { useEffect, useState } from 'react';

interface AlarmUser {
  id: string;
  company_id: string;
  name: string | null;
  phone_number: string;
  active_yn: 'Y' | 'N';
  imc_alarm_user_id: string | null;
  created_at: string;
}

interface Props {
  onClose: () => void;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

export default function AlarmUserManager({ onClose }: Props) {
  const [users, setUsers] = useState<AlarmUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alimtalk/alarm-users', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setUsers(data.users || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    setErr(null);
    if (!/^01\d{8,9}$/.test(newPhone.replace(/\D/g, '')))
      return setErr('휴대폰 번호 형식을 확인하세요');
    setAdding(true);
    try {
      const res = await fetch('/api/alimtalk/alarm-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          name: newName || null,
          phoneNumber: newPhone.replace(/\D/g, ''),
          activeYn: 'Y',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErr(data?.error || '등록 실패');
        return;
      }
      setNewName('');
      setNewPhone('');
      load();
    } catch (e: any) {
      setErr(e?.message || '서버 오류');
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (u: AlarmUser) => {
    await fetch(`/api/alimtalk/alarm-users/${u.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ activeYn: u.active_yn === 'Y' ? 'N' : 'Y' }),
    });
    load();
  };

  const remove = async (u: AlarmUser) => {
    if (!confirm(`'${u.phone_number}' 수신자를 삭제할까요?`)) return;
    await fetch(`/api/alimtalk/alarm-users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    load();
  };

  const activeCount = users.filter((u) => u.active_yn === 'Y').length;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">검수 알림 수신자</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              활성 {activeCount}/10명 · 템플릿 검수 결과 카톡 알림 대상
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-3 border-b bg-gray-50 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-600 mb-1">
              이름
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={30}
              placeholder="(선택)"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-medium text-gray-600 mb-1">
              휴대폰
            </label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
              maxLength={11}
              placeholder="01012345678"
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={adding || activeCount >= 10}
            onClick={add}
            className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm disabled:opacity-50"
          >
            추가
          </button>
        </div>

        {err && <p className="px-6 py-2 text-xs text-red-500">{err}</p>}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-center text-sm text-gray-400">로딩 중...</p>
          ) : users.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">
              등록된 수신자가 없습니다.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">이름</th>
                  <th className="text-left px-4 py-2">휴대폰</th>
                  <th className="text-center px-4 py-2">활성</th>
                  <th className="text-right px-4 py-2">삭제</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">{u.name || '-'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {u.phone_number}
                    </td>
                    <td className="text-center px-4 py-2">
                      <button
                        type="button"
                        onClick={() => toggle(u)}
                        className={`px-2 py-0.5 rounded text-xs ${
                          u.active_yn === 'Y'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {u.active_yn === 'Y' ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="text-right px-4 py-2">
                      <button
                        type="button"
                        onClick={() => remove(u)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
