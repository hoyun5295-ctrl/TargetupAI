/**
 * AgencyEmailSendersModal — 대행발송 허용 발신 이메일 관리 (★2026-08-26 §18-2 · 슈퍼관리자)
 *
 * 이메일 접수(hanjullo 메일함)의 발신자 → 회사·귀속 사용자 매핑 원장을 회사 편집 화면에서 관리한다.
 * ⛔ 즉시 저장(추가 POST · 상태 PATCH · 삭제 DELETE)이고 목록은 **서버 응답으로 통째 교체**한다.
 *   부모 회사 편집 모달의 낙관적 갱신+롤백 패턴을 복제하지 않는다(스테일 클로저 유실 · LESSONS_FRONTEND).
 * ⛔ 귀속 사용자 필수 — 이 주소로 온 접수의 created_by(발송·정산 귀속)가 된다.
 * ⛔ 활성 주소는 전역 유일 — 409(EMAIL_TAKEN)는 "이미 다른 곳에 등록"으로만 보이고 어느 회사인지는 안 보인다.
 * 톤 = 부모(AdminDashboard 회사 편집)와 같은 흰 모달 + 인디고. 스크림 z-[60](중첩 모달 관례).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, Plus, Trash2, X } from 'lucide-react';
import { CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_INPUT, CUI_LABEL, CUI_SELECT } from '../../utils/console-ui';

interface SenderRow {
  id: string;
  email_norm: string;
  user_id: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  user_name: string | null;
  user_login_id: string | null;
  user_status: string | null;
  user_is_active: boolean | null;
}

interface UserRow { id: string; name: string | null; login_id: string; status: string | null; is_active: boolean | null }

interface Props {
  companyId: string;
  companyName: string;
  show: boolean;
  onClose: () => void;
  /** 활성 주소 수가 바뀔 때마다 부모 트리거 표기를 맞춘다 */
  onChanged?: (activeCount: number) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` });

export default function AgencyEmailSendersModal({ companyId, companyName, show, onClose, onChanged, showConfirm, showAlert }: Props) {
  const [senders, setSenders] = useState<SenderRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  const activeCount = senders.filter((s) => s.is_active).length;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/agency-send-emails`, { headers: authHeaders() });
      const data = await res.json();
      if (res.status === 503 && data?.code === 'DB_MIGRATION_PENDING') {
        setMigrationPending(true);
        setSenders([]);
        setUsers([]);
        return;
      }
      if (!data?.success) throw new Error(data?.error || '목록을 불러오지 못했습니다.');
      setMigrationPending(false);
      setSenders(data.senders || []);
      setUsers(data.users || []);
      onChanged?.((data.senders || []).filter((s: SenderRow) => s.is_active).length);
    } catch (e: any) {
      showAlert('불러오기 실패', e?.message || '허용 이메일 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!show) return;
    setEmail(''); setUserId(''); setLabel(''); setFormError('');
    void load();
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    setTimeout(() => emailRef.current?.focus(), 60);
    return () => window.removeEventListener('keydown', onEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, companyId]);

  if (!show) return null;

  const mutate = async (fn: () => Promise<Response>, okMessage?: string) => {
    setBusy(true);
    setFormError('');
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data?.code === 'DB_MIGRATION_PENDING') { setMigrationPending(true); return false; }
      if (!res.ok || data?.success === false) {
        const msg = data?.error || '처리하지 못했습니다.';
        if (data?.code === 'EMAIL_TAKEN') setFormError(msg);
        else showAlert('처리 실패', msg, 'error');
        return false;
      }
      if (okMessage) showAlert('완료', okMessage, 'success');
      await load();
      return true;
    } catch {
      showAlert('처리 실패', '네트워크 문제로 처리하지 못했습니다.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addSender = async () => {
    const v = email.trim();
    if (!v) { setFormError('이메일 주소를 입력해 주세요.'); return; }
    if (!userId) { setFormError('접수를 귀속할 사용자를 골라 주세요.'); return; }
    const ok = await mutate(() => fetch(`/api/admin/companies/${companyId}/agency-send-emails`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: v, userId, label: label.trim() || undefined }),
    }));
    if (ok) { setEmail(''); setLabel(''); setFormError(''); emailRef.current?.focus(); }
  };

  const toggleSender = (s: SenderRow) => {
    void mutate(() => fetch(`/api/admin/companies/${companyId}/agency-send-emails/${s.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !s.is_active }),
    }));
  };

  const removeSender = (s: SenderRow) => {
    showConfirm(
      '허용 이메일 삭제',
      `${s.email_norm} 을(를) 목록에서 삭제할까요?\n이 주소에서 오는 접수 메일은 더 이상 받지 않습니다.`,
      () => { void mutate(() => fetch(`/api/admin/companies/${companyId}/agency-send-emails/${s.id}`, { method: 'DELETE', headers: authHeaders() })); },
    );
  };

  const deactivateAll = () => {
    showConfirm(
      '전부 비활성',
      `활성 주소 ${activeCount}개를 모두 비활성으로 바꿀까요?\n등록은 남고 접수만 멈춥니다(긴급 정지). 주소별 스위치로 다시 켤 수 있습니다.`,
      () => { void mutate(() => fetch(`/api/admin/companies/${companyId}/agency-send-emails/deactivate-all`, { method: 'POST', headers: authHeaders() }), '전부 비활성으로 바꿨습니다.'); },
    );
  };

  const userLabel = (u: UserRow) => {
    const name = u.name || u.login_id;
    const inactive = u.is_active !== true || u.status !== 'active';
    return inactive ? `${name} (비활성)` : name;
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-neutral-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Mail className="w-[17px] h-[17px] text-indigo-600" />
            </div>
            <div>
              <h3 className="text-[15.5px] font-bold text-neutral-900">허용 발신 이메일</h3>
              <p className="mt-0.5 text-[12.5px] text-neutral-500">
                {companyName} · 이 주소에서 온 요청서 메일만 접수됩니다. 접수는 고른 사용자 명의로 만들어집니다.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100" aria-label="닫기">
            <X className="w-[16px] h-[16px]" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {migrationPending ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-800">
              이메일 접수 준비 중입니다. DB 마이그레이션(agency_send_email_senders) 실행 뒤 다시 열어 주세요.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-2.5">
                  <div>
                    <label className={CUI_LABEL}>이메일 주소</label>
                    <input
                      ref={emailRef}
                      className={CUI_INPUT}
                      placeholder="manager@company.co.kr"
                      value={email}
                      disabled={busy}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addSender(); }}
                    />
                  </div>
                  <div>
                    <label className={CUI_LABEL}>귀속 사용자</label>
                    <select className={CUI_SELECT} value={userId} disabled={busy} onChange={(e) => setUserId(e.target.value)}>
                      <option value="">선택</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id} disabled={u.is_active !== true || u.status !== 'active'}>{userLabel(u)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2.5 items-end">
                  <div>
                    <label className={CUI_LABEL}>표시명 (선택)</label>
                    <input
                      className={CUI_INPUT}
                      placeholder="예: 김대리(마케팅)"
                      value={label}
                      disabled={busy}
                      onChange={(e) => setLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addSender(); }}
                    />
                  </div>
                  <button type="button" className={`${CUI_BTN_PRIMARY} justify-center`} disabled={busy} onClick={() => void addSender()}>
                    {busy ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Plus className="w-[15px] h-[15px]" />}추가
                  </button>
                </div>
                {formError && <p className="mt-2 text-[12.5px] font-medium text-rose-600">{formError}</p>}
                <p className="mt-2 text-[12px] text-neutral-500">
                  접수 메일의 보낸 주소와 글자 그대로 일치해야 합니다. 같은 주소는 한 곳에만 등록할 수 있습니다.
                </p>
              </div>

              <div className="mt-4">
                {loading ? (
                  <div className="py-10 flex items-center justify-center text-neutral-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : senders.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-neutral-400">
                    등록된 주소가 없습니다. 등록 전에는 어떤 메일도 접수되지 않습니다.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {senders.map((s) => {
                      const ownerBroken = s.user_is_active !== true || s.user_status !== 'active';
                      return (
                        <li key={s.id} className={`rounded-xl border px-3.5 py-2.5 flex items-center gap-3 ${s.is_active ? 'border-neutral-200 bg-white' : 'border-neutral-150 bg-neutral-50 opacity-70'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[13.5px] font-semibold text-neutral-800 truncate">{s.email_norm}</span>
                              {s.label && <span className="text-[12px] text-neutral-500 truncate">{s.label}</span>}
                            </div>
                            <div className="mt-0.5 text-[12px] text-neutral-500 truncate">
                              귀속: {s.user_name || s.user_login_id || '(사용자 없음)'}
                              {ownerBroken && s.is_active && (
                                <span className="ml-1.5 text-amber-600 font-medium">사용자 비활성 · 이 주소의 접수는 반려됩니다</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleSender(s)}
                            className={`shrink-0 h-[26px] px-2.5 rounded-full text-[12px] font-semibold border transition-colors ${
                              s.is_active
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                                : 'bg-white border-neutral-300 text-neutral-500 hover:bg-neutral-100'
                            }`}
                          >
                            {s.is_active ? '활성' : '비활성'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => removeSender(s)}
                            className="shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50"
                            aria-label="삭제"
                          >
                            <Trash2 className="w-[15px] h-[15px]" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-neutral-100 flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-neutral-500">활성 {activeCount}개 / 전체 {senders.length}개</div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <button type="button" className={CUI_BTN_OUTLINE} disabled={busy} onClick={deactivateAll}>전부 비활성</button>
            )}
            <button type="button" className={CUI_BTN_PRIMARY} onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
