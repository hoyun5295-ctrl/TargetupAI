import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { formatPhoneNumber } from '../utils/formatDate';
import {
  Building2, Users, PhoneCall, Wallet, Clock, ArrowLeft, Trash2, Plus,
  Save, CheckCircle2, XCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';

const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const disabledInputCls =
  'w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-400 outline-none cursor-not-allowed';
const labelCls = 'mb-1.5 block text-xs font-medium text-gray-500';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.userType === 'company_admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [managerContacts, setManagerContacts] = useState<{id?: string, phone: string, name: string}[]>([]);
  const [callbackNumbers, setCallbackNumbers] = useState<{id: string, phone: string, label: string, is_default: boolean, store_code?: string, store_name?: string}[]>([]);
  const [callbackPage, setCallbackPage] = useState(0);
  const callbackPageSize = 5;

  // 토스트
  const [toast, setToast] = useState<{show: boolean, type: 'success' | 'error', message: string}>({show: false, type: 'success', message: ''});

  const [settings, setSettings] = useState({
    brand_name: '',
    business_type: '',
    reject_number: '',
    monthly_budget: 1000000,
    cost_per_sms: 9.9,
    cost_per_lms: 27,
    cost_per_mms: 50,
    cost_per_kakao: 7.5,
    send_start_hour: 9,
    send_end_hour: 20,
    holiday_send_allowed: false,
    target_strategy: 'balanced',
    cross_category_allowed: true,
    approval_required: false,
    // ★ 2026-07-05 발송 피로도 보호 — null = 비활성(제한 없음). 둘 다 설정해야 동작.
    fatigue_cap_days: null as number | null,
    fatigue_cap_max: null as number | null,
    // ★ 2026-08-04 여정 진행 중 고객 제외(자동마케팅) — 기본 꺼짐(겹침 허용)
    automarketing_exclude_journey: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast({ show: false, type: 'success', message: '' }), 3000);
  };

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data) {
        const { manager_phones, manager_phone, callback_auth_phone, callback_auth_verified, ...rest } = data;
        setSettings((prev) => ({ ...prev, ...rest }));
        // 담당자 사전수신 목록
        const tcRes = await fetch('/api/test-contacts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const tcData = await tcRes.json();
        if (tcData.success) {
          setManagerContacts(tcData.contacts || []);
        }
      }

      // 회신번호 목록
      const cbRes = await fetch('/api/companies/callback-numbers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cbData = await cbRes.json();
      if (cbData.success) {
        setCallbackNumbers(cbData.numbers || []);
      }

    } catch (error) {
      console.error('설정 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      showToast('success', data.message || '저장 완료');
    } catch (error) {
      showToast('error', '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // 담당자 번호 포맷 — ★ D123 P6: 인라인 제거 → formatPhoneNumber 컨트롤타워 사용
  const formatPhone = formatPhoneNumber;

  // 사전수신 번호 추가
  const handleAddPhone = async () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 11) {
      showToast('error', '올바른 전화번호를 입력해주세요');
      return;
    }
    const token = localStorage.getItem('token');
    const res = await fetch('/api/test-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newName.trim(), phone: cleaned }),
    });
    const data = await res.json();
    if (data.success) {
      setManagerContacts([...managerContacts, data.contact]);
      setNewPhone('');
      setNewName('');
    } else {
      showToast('error', data.error || '추가 실패');
    }
  };

  // 사전수신 담당자 삭제
  const handleRemovePhone = async (id: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/test-contacts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      setManagerContacts(managerContacts.filter((c) => c.id !== id));
    } else {
      showToast('error', data.error || '삭제 실패');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
        불러오는 중...
      </div>
    );
  }

  const totalCbPages = Math.ceil(callbackNumbers.length / callbackPageSize);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* sticky 헤더 */}
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Building2 className="h-[18px] w-[18px] text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight text-gray-900">회사 설정</h1>
              <p className="text-[11px] text-gray-400">브랜드 · 발송 · 요금 환경</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/')} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700">
              <ArrowLeft className="h-3.5 w-3.5" /> 대시보드
            </button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">

          {/* 기본 정보 */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><Building2 className="h-[18px] w-[18px]" /></div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">기본 정보</h2>
                <p className="text-[11px] text-gray-400">브랜드명 · 업종 · 수신거부번호</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>브랜드명</label>
                <input type="text" value={settings.brand_name || ''} onChange={(e) => setSettings({ ...settings, brand_name: e.target.value })} className={inputCls} placeholder="예: 타겟업" />
              </div>
              <div>
                <label className={labelCls}>업종</label>
                <select value={settings.business_type || ''} onChange={(e) => setSettings({ ...settings, business_type: e.target.value })} className={inputCls}>
                  <option value="">선택</option>
                  <option value="cosmetics">화장품</option>
                  <option value="food">식품</option>
                  <option value="fashion">패션</option>
                  <option value="education">교육</option>
                  <option value="healthcare">헬스케어</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>080 수신거부번호</label>
                <input type="text" value={settings.reject_number || ''} onChange={(e) => setSettings({ ...settings, reject_number: e.target.value })} className={inputCls} placeholder="예: 080-123-4567" />
              </div>
            </div>
          </section>

          {/* 담당자 사전수신 */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Users className="h-[18px] w-[18px]" /></div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">담당자 사전수신</h2>
                <p className="text-[11px] text-gray-400">발송 전 담당자 전원에게 테스트 문자 발송</p>
              </div>
            </div>

            {managerContacts.length > 0 ? (
              <div className="mb-3 space-y-1.5">
                {managerContacts.map((contact, idx) => (
                  <div key={contact.id || contact.phone} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                    <span className="flex-1 truncate text-sm text-gray-700">
                      <b className="font-semibold text-gray-800">{contact.name || `담당자 ${idx + 1}`}</b>
                      <span className="ml-1.5 tabular-nums text-gray-500">{formatPhone(contact.phone)}</span>
                    </span>
                    <button onClick={() => contact.id && handleRemovePhone(contact.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-rose-500 transition hover:bg-rose-50">
                      <Trash2 className="h-3.5 w-3.5" /> 삭제
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">등록된 담당자가 없습니다</div>
            )}

            <div className="flex items-end gap-2">
              <div className="w-24 shrink-0">
                <label className={labelCls}>이름</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} placeholder="홍길동" />
              </div>
              <div className="flex-1">
                <label className={labelCls}>전화번호</label>
                <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value.replace(/[^\d-]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') handleAddPhone(); }} className={inputCls} placeholder="01012345678" />
              </div>
              <button onClick={handleAddPhone} disabled={!newPhone.replace(/\D/g, '')} className="flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" /> 추가
              </button>
            </div>
          </section>

          {/* 등록 회신번호 (읽기전용) */}
          <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><PhoneCall className="h-[18px] w-[18px]" /></div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">등록 회신번호</h2>
                <p className="text-[11px] text-gray-400">승인된 발신번호 · 신규 등록은 '발신번호 관리'</p>
              </div>
            </div>

            {callbackNumbers.length > 0 ? (
              <div className="space-y-1.5">
                {callbackNumbers.slice(callbackPage * callbackPageSize, (callbackPage + 1) * callbackPageSize).map((cb) => (
                  <div key={cb.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <span className="flex-1 truncate text-sm tabular-nums text-gray-700">
                      {cb.phone}
                      {cb.store_name && <span className="ml-1.5 text-xs text-gray-400">({cb.store_name})</span>}
                      {!cb.store_name && cb.label && <span className="ml-1.5 text-xs text-gray-400">({cb.label})</span>}
                    </span>
                    {cb.is_default && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">기본</span>}
                  </div>
                ))}
                {totalCbPages > 1 && (
                  <div className="flex items-center justify-center gap-1 pt-2">
                    <button onClick={() => setCallbackPage(p => Math.max(0, p - 1))} disabled={callbackPage === 0} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="px-1 text-[11px] tabular-nums text-gray-400">{callbackPage + 1} / {totalCbPages}</span>
                    <button onClick={() => setCallbackPage(p => Math.min(totalCbPages - 1, p + 1))} disabled={callbackPage >= totalCbPages - 1} className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
                등록된 회신번호가 없습니다<br />
                <span className="text-[11px]">관리 메뉴에서 발신번호 등록을 신청해주세요</span>
              </div>
            )}
          </section>

          {/* 요금 설정 — 관리자만 */}
          {isAdmin && (
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Wallet className="h-[18px] w-[18px]" /></div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">요금 설정</h2>
                  <p className="text-[11px] text-gray-400">월 예산은 직접, 단가는 관리자 설정</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>월 예산 <span className="text-gray-300">(원)</span></label>
                  <input type="number" value={settings.monthly_budget} onChange={(e) => setSettings({ ...settings, monthly_budget: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>SMS 단가 <span className="text-gray-300">(원)</span></label>
                  <input type="number" step="0.1" value={settings.cost_per_sms} disabled className={disabledInputCls} />
                </div>
                <div>
                  <label className={labelCls}>LMS 단가 <span className="text-gray-300">(원)</span></label>
                  <input type="number" step="0.1" value={settings.cost_per_lms} disabled className={disabledInputCls} />
                </div>
                <div>
                  <label className={labelCls}>MMS 단가 <span className="text-gray-300">(원)</span></label>
                  <input type="number" step="0.1" value={settings.cost_per_mms} disabled className={disabledInputCls} />
                </div>
                <div>
                  <label className={labelCls}>카카오 단가 <span className="text-gray-300">(원)</span></label>
                  <input type="number" step="0.1" value={settings.cost_per_kakao} disabled className={disabledInputCls} />
                </div>
              </div>
              <p className="mt-2.5 text-[11px] text-gray-400">※ 단가는 관리자가 설정합니다</p>
            </section>
          )}

          {/* 발송 정책 — 관리자만 */}
          {isAdmin && (
            <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Clock className="h-[18px] w-[18px]" /></div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">발송 정책</h2>
                  <p className="text-[11px] text-gray-400">발송 시간대 · 휴일 · 피로도 보호</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelCls}>발송 시작시간</label>
                  <select value={settings.send_start_hour} onChange={(e) => setSettings({ ...settings, send_start_hour: Number(e.target.value) })} className={inputCls}>
                    {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{i}시</option>))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>발송 종료시간</label>
                  <select value={settings.send_end_hour} onChange={(e) => setSettings({ ...settings, send_end_hour: Number(e.target.value) })} className={inputCls}>
                    {Array.from({ length: 24 }, (_, i) => (<option key={i} value={i}>{i}시</option>))}
                  </select>
                </div>
                {/* ★ 2026-07-11 거짓 설정 정리: "고객당 일일 한도"·"중복 방지 기간" 입력 제거 —
                    발송 경로 소비처 0곳(저장만 되던 죽은 설정). 실제 발송 횟수 제한 = 아래 발송 피로도 보호. */}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">고객별 발송 횟수 제한은 아래 "발송 피로도 보호"가 담당합니다.</p>
              <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <input type="checkbox" checked={settings.holiday_send_allowed} onChange={(e) => setSettings({ ...settings, holiday_send_allowed: e.target.checked })} className="h-4 w-4 rounded accent-violet-600" />
                <span className="text-sm text-gray-700">휴일 발송 허용</span>
              </label>

              {/* ★ 2026-07-05 발송 피로도 보호 — opt-in. 끄면(미설정) 제한 없음(현행 그대로) */}
              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <label className="flex w-fit cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.fatigue_cap_days != null && settings.fatigue_cap_max != null}
                    onChange={(e) => setSettings({ ...settings, fatigue_cap_days: e.target.checked ? 7 : null, fatigue_cap_max: e.target.checked ? 3 : null })}
                    className="h-4 w-4 rounded accent-violet-600"
                  />
                  <span className="text-sm text-gray-700">발송 피로도 보호</span>
                </label>
                <p className="mt-1 text-[11px] text-gray-400">
                  최근 N일 안에 광고 메시지(문자·알림톡 합산)를 M건 이상 받은 고객을 모든 자동·타겟 발송에서 자동 제외합니다.
                  정보성 메시지와 직접 입력한 수신자는 제한하지 않습니다.
                </p>
                {settings.fatigue_cap_days != null && settings.fatigue_cap_max != null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {[{ label: '주 1건', days: 7, max: 1 }, { label: '주 2건', days: 7, max: 2 }, { label: '주 3건', days: 7, max: 3 }].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setSettings({ ...settings, fatigue_cap_days: p.days, fatigue_cap_max: p.max })}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${settings.fatigue_cap_days === p.days && settings.fatigue_cap_max === p.max ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <span className="ml-1 text-xs text-gray-500">직접 설정: 최근</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={settings.fatigue_cap_days}
                      onChange={(e) => setSettings({ ...settings, fatigue_cap_days: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-xs"
                    />
                    <span className="text-xs text-gray-500">일 동안</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={settings.fatigue_cap_max}
                      onChange={(e) => setSettings({ ...settings, fatigue_cap_max: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-xs"
                    />
                    <span className="text-xs text-gray-500">건까지 허용</span>
                  </div>
                )}
              </div>

              {/* ★ 2026-08-04 여정 진행 중 고객 제외(자동마케팅) — opt-in. 끄면(기본) 현행 그대로 겹침 허용 */}
              <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <label className="flex w-fit cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.automarketing_exclude_journey === true}
                    onChange={(e) => setSettings({ ...settings, automarketing_exclude_journey: e.target.checked })}
                    className="h-4 w-4 rounded accent-violet-600"
                  />
                  <span className="text-sm text-gray-700">여정 진행 중인 고객은 자동마케팅에서 제외</span>
                </label>
                <p className="mt-1 text-[11px] text-gray-400">
                  켜면 고객 여정이 진행 중인 고객(환영·장바구니 안내 등 대화가 이어지는 중)에게는 자동마케팅 문자가 나가지 않습니다.
                  여정이 끝나면 다시 자동마케팅 대상에 포함됩니다. 끄면 지금처럼 둘 다 발송됩니다.
                </p>
              </div>
            </section>
          )}

        </div>
      </main>

      {/* 토스트 */}
      {toast.show && (
        <div className={`fixed left-1/2 top-5 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
