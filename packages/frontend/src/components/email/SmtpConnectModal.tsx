/**
 * SmtpConnectModal — 회사 메일(발신 설정) 연결 창 공용 (★ 2026-10-03 EmailCampaignsPage 에서 원본 그대로 이관)
 *
 * 남지현 접수 「이메일 보내기 창 '회사 메일 연결하기' 버튼 미동작」: 버튼이 /email-campaigns?smtp=1 로 이동만 했는데
 * 이 창이 뜨는 대표 경로(이메일 수정 화면 · 목록 상세)가 이미 그 페이지 안이라 아무 일도 없었다.
 * 이제 보내기 창(MakeSendModal 이메일 카드)과 이메일 화면이 이 창을 직접 띄운다.
 *   - SmtpFormModal    = 입력 창(옮기기 전 모양 그대로)
 *   - SmtpConnectModal = 열릴 때 지금 설정을 읽고 · 프리셋 · 저장(PUT)까지 스스로 한다.
 *     저장·조회는 회사 관리자만(서버 ensureEmailAdmin) — 담당자에게는 여는 쪽이 요청 안내를 보인다.
 */
import { useEffect, useState } from 'react';
import { Server, X, AlertCircle, Lock, Eye, EyeOff, Check, Loader2, Trash2 } from 'lucide-react';
import { useToast } from '../ToastProvider';

// 4 표준 SMTP 가이드 (회사 admin 진입 단순화)
export const SMTP_PRESETS = [
  {
    key: 'gmail',
    label: 'Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    hint: '2단계 인증 + 앱 비밀번호 발급 의무 (Google 계정 안 보안 → 앱 비밀번호)',
    docs: 'https://support.google.com/accounts/answer/185833',
  },
  {
    key: 'naver_works',
    label: 'Naver Works',
    host: 'smtp.worksmobile.com',
    port: 587,
    secure: false,
    hint: 'Naver Works 관리자 → 발신 메일 보안 설정 → SMTP 활성',
    docs: 'https://guide.worksmobile.com/kr/mail/external-smtp/',
  },
  {
    key: 'office365',
    label: 'Office 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Microsoft 365 계정 + 앱 비밀번호 또는 OAuth 인증',
    docs: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission',
  },
  {
    key: 'custom',
    label: '자체 메일 서버',
    host: '',
    port: 587,
    secure: false,
    hint: '회사 본인 메일 서버 정보 직접 입력 (host/port/user/password)',
    docs: null,
  },
];

export const EMPTY_SMTP_FORM = {
  host: '',
  port: 587,
  user: '',
  password: '',
  secure: false,
  from_email: '',
  from_name: '',
};

export type SmtpForm = typeof EMPTY_SMTP_FORM;

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });

/** 연결 창(스스로 읽고 저장) · onSaved = 저장 뒤 여는 쪽이 연결 상태를 다시 읽는다 · onClear = 이메일 화면의 영구 제거(확인 창은 그 화면 소유) */
export default function SmtpConnectModal({ open, onClose, onSaved, onClear }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onClear?: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<SmtpForm>(EMPTY_SMTP_FORM);
  const [presetKey, setPresetKey] = useState<string>('gmail');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isUpdate, setIsUpdate] = useState(false);

  // 열릴 때마다 지금 설정을 읽는다(비밀번호는 응답에 없다 · 빈칸으로 둔다)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setShowPassword(false);
    (async () => {
      try {
        const r = await fetch('/api/email/smtp-config', { headers: authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        const c = d?.success ? d.config : null;
        setIsUpdate(!!c?.isConfigured);
        setForm(c?.isConfigured ? {
          host: c.host || '',
          port: c.port || 587,
          user: c.user || '',
          password: '',
          secure: !!c.secure,
          from_email: c.fromEmail || '',
          from_name: c.fromName || '',
        } : EMPTY_SMTP_FORM);
      } catch {
        if (alive) { setIsUpdate(false); setForm(EMPTY_SMTP_FORM); }
      }
    })();
    return () => { alive = false; };
  }, [open]);

  const applyPreset = (key: string) => {
    const preset = SMTP_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setPresetKey(key);
    setForm((prev) => ({ ...prev, host: preset.host || prev.host, port: preset.port, secure: preset.secure }));
  };

  const save = async () => {
    if (!form.host.trim() || !form.port || !form.user.trim() || !form.password.trim() || !form.from_email.trim()) {
      toast.warning('메일 서버 · 포트 · 사용자 · 비밀번호 · 발신 이메일을 모두 채워 주세요.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.from_email)) {
      toast.warning('발신 이메일 형식을 확인해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/email/smtp-config', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(form) });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        toast.success('회사 메일을 연결했어요.');
        setForm((prev) => ({ ...prev, password: '' }));  // 비밀번호 즉시 폐기
        onSaved();
        onClose();
        return;
      }
      if (data?.code === 'DB_MIGRATION_PENDING') toast.warning('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.');
      else toast.error(data?.error || '회사 메일 설정을 저장하지 못했어요.');
    } catch (e: any) {
      toast.error(e?.message || '회사 메일 설정을 저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <SmtpFormModal
      form={form}
      setForm={setForm}
      presetKey={presetKey}
      setPresetKey={applyPreset}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      saving={saving}
      onSave={() => { void save(); }}
      onClose={onClose}
      onClear={isUpdate && onClear ? onClear : undefined}
      isUpdate={isUpdate}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// SMTP 설정 모달
// ════════════════════════════════════════════════════════════════════

export interface SmtpFormModalProps {
  form: typeof EMPTY_SMTP_FORM;
  setForm: (form: typeof EMPTY_SMTP_FORM) => void;
  presetKey: string;
  setPresetKey: (key: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onClear?: () => void;
  isUpdate: boolean;
}

export function SmtpFormModal({ form, setForm, presetKey, setPresetKey, showPassword, setShowPassword, saving, onSave, onClose, onClear, isUpdate }: SmtpFormModalProps) {
  const currentPreset = SMTP_PRESETS.find((p) => p.key === presetKey);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-violet-50 border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-700" />
            {isUpdate ? 'SMTP 설정 수정' : 'SMTP 설정 등록'}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 표준 SMTP 가이드 */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-2">메일 서버 선택 (자동 입력 활용)</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SMTP_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => setPresetKey(preset.key)}
                  className={`text-xs px-2 py-2 rounded-lg border transition-colors ${
                    presetKey === preset.key
                      ? 'bg-blue-100 border-blue-300 text-slate-900'
                      : 'bg-violet-50 border-slate-200 text-slate-600 hover:bg-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {currentPreset && (
              <div className="text-[10px] text-slate-500 mt-2 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  {currentPreset.hint}
                  {currentPreset.docs && (
                    <> · <a href={currentPreset.docs} target="_blank" rel="noopener noreferrer" className="text-cyan-700 hover:underline">공식 가이드</a></>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* SMTP 정보 입력 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr,120px] gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">SMTP 서버 (host)</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">포트 (port)</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value, 10) || 587 })}
                placeholder="587"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-600 block mb-1">사용자 (user): 보통 이메일 주소</label>
            <input
              type="text"
              value={form.user}
              onChange={(e) => setForm({ ...form, user: e.target.value })}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
            />
          </div>

          <div>
            <label className="text-xs text-slate-600 block mb-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> 비밀번호 (password): 앱 비밀번호 권장 (Google 2단계 인증 영역)
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={isUpdate ? '변경 시에만 새 비밀번호 입력' : '앱 비밀번호 (16자)'}
                className="w-full px-3 py-2 pr-10 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 p-1"
                aria-label={showPassword ? '비밀번호 숨김' : '비밀번호 표시'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">서버 저장 시 AES-256-GCM 암호화. 평문 응답/로그 X</div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="smtp_secure"
              checked={form.secure}
              onChange={(e) => setForm({ ...form, secure: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="smtp_secure" className="text-xs text-slate-700">
              SSL/TLS 직접 연결 (포트 465 영역). 미체크 = STARTTLS (포트 587 default).
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">발신 이메일 (from_email)</label>
              <input
                type="email"
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="noreply@example.com"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">발신자 이름 (from_name, 선택)</label>
              <input
                type="text"
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                placeholder="브랜드명 또는 회사명"
                className="w-full px-3 py-2 bg-violet-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-violet-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between gap-2">
          <div>
            {isUpdate && onClear && (
              <button onClick={onClear} className="px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 rounded-lg flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> 영구 제거
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-white rounded-lg">취소</button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? '저장 중...' : isUpdate ? '수정 저장' : 'SMTP 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
