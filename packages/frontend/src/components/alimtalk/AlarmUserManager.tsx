/**
 * 알림톡 검수 결과 알림 수신자 관리 (고객사)
 *
 * 최대 3명 (한줄로 정책 — Harold님 지시 D131).
 * IMC 자체 정책은 10명이지만, 한줄로는 운영 단순화를 위해 3명으로 제한.
 */

const MAX_ALARM_USERS = 3;

import { useEffect, useState } from 'react';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { X } from 'lucide-react';
import { CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_INPUT, CUI_LABEL, CUI_MODAL, CUI_MODAL_CLOSE, CUI_MODAL_DESC, CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_SCRIM, CUI_MODAL_TITLE, CUI_REQUIRED } from '../../utils/console-ui';

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
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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
    if (activeCount >= MAX_ALARM_USERS) {
      return setErr(`검수 알림 수신자는 최대 ${MAX_ALARM_USERS}명까지 등록 가능합니다`);
    }
    if (!newName.trim()) return setErr('수신자 이름을 입력하세요 (필수)');
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

  const remove = (u: AlarmUser) => {
    setConfirm({
      mode: 'danger',
      title: '수신자 삭제',
      description: `'${u.phone_number}' 수신자를 삭제할까요?`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        await fetch(`/api/alimtalk/alarm-users/${u.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        load();
      },
    });
  };

  const activeCount = users.filter((u) => u.active_yn === 'Y').length;

  return (
    <div className={CUI_MODAL_SCRIM}>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <div className={`${CUI_MODAL} max-w-lg`} role="dialog" aria-modal="true">
        <div className={CUI_MODAL_HEAD}>
          <div>
            <h2 className={CUI_MODAL_TITLE}>검수 알림 수신자</h2>
            <p className={CUI_MODAL_DESC}>
              활성 {activeCount}/{MAX_ALARM_USERS}명 · 템플릿 검수 결과 문자 알림 대상
            </p>
            {/* ★ 2026-06-13: 수신자 0명일 때 동작 안내 — "알림이 안 온다" 문의 차단
                (발송 코드 기준: kakao_alarm_users 활성 수신자가 없으면 검수 결과 알림이 발송되지 않는다) */}
            {activeCount === 0 && (
              <p className="text-[12.5px] text-amber-700 mt-1.5">
                활성 수신자가 없으면 검수 결과 알림 문자가 발송되지 않습니다. 받으실 분을 등록해주세요.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={CUI_MODAL_CLOSE}
            aria-label="닫기"
          >
            <X className="w-[17px] h-[17px]" />
          </button>
        </div>

        <div className="shrink-0 px-6 py-3.5 border-b border-neutral-200 bg-neutral-50 flex gap-2 items-end flex-wrap">
          <div className="flex-1">
            <label className={CUI_LABEL}>
              이름 <span className={CUI_REQUIRED}>*</span>
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={30}
              placeholder="홍길동"
              className={CUI_INPUT}
            />
          </div>
          <div className="flex-1">
            <label className={CUI_LABEL}>
              휴대폰
            </label>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
              maxLength={11}
              placeholder="01012345678"
              className={CUI_INPUT}
            />
          </div>
          <button
            type="button"
            disabled={adding || activeCount >= MAX_ALARM_USERS}
            onClick={add}
            className={CUI_BTN_PRIMARY}
          >
            추가
          </button>
        </div>

        {err && <p className="px-6 py-2 text-[12.5px] text-rose-600">{err}</p>}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-8 text-center text-[13px] text-neutral-500">로딩 중...</p>
          ) : users.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-neutral-500">
              등록된 수신자가 없습니다.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-[12px] font-semibold text-neutral-500 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">이름</th>
                  <th className="text-left px-4 py-2">휴대폰</th>
                  <th className="text-center px-4 py-2">활성</th>
                  <th className="text-right px-4 py-2">삭제</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-neutral-100">
                    <td className="px-4 py-2">{u.name || '-'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {u.phone_number}
                    </td>
                    <td className="text-center px-4 py-2">
                      <button
                        type="button"
                        onClick={() => toggle(u)}
                        className={`h-[23px] px-2.5 rounded-full text-[12px] font-semibold transition ${
                          u.active_yn === 'Y'
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                      >
                        {u.active_yn === 'Y' ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="text-right px-4 py-2">
                      <button
                        type="button"
                        onClick={() => remove(u)}
                        className="text-[12.5px] font-semibold text-rose-600 hover:text-rose-700"
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

        <div className={CUI_MODAL_FOOT}>
          <button
            type="button"
            onClick={onClose}
            className={CUI_BTN_OUTLINE}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
