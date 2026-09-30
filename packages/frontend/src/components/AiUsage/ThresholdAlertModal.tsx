/**
 * ThresholdAlertModal.tsx — AI 사용량 한도 알림 설정 모달 (D217+ 2026-05-25)
 *
 * 다크 톤 + violet 액센트 정합 + ESC + backdrop click.
 * 임계값 3 (50% / 80% / 95%) + 채널 (email / sms / inapp) + 활성/비활성.
 */

import { useEffect, useState } from 'react';
import { X, Bell, Mail, MessageSquare, Smartphone, Loader2 } from 'lucide-react';

export interface ThresholdConfig {
  enabled?: boolean;
  threshold_percent?: number;
  channels?: Array<'email' | 'sms' | 'inapp'>;
  updated_at?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial: ThresholdConfig | null;
  onSave: (config: { threshold_percent: number; channels: Array<'email' | 'sms' | 'inapp'>; enabled: boolean }) => Promise<void>;
}

const THRESHOLD_OPTIONS: Array<{ value: 50 | 80 | 95; label: string; tone: string; description: string }> = [
  { value: 50, label: '50%',  tone: 'text-sky-700',     description: '여유 있게 미리 알림: 추세 모니터링 우선' },
  { value: 80, label: '80%',  tone: 'text-amber-700',   description: '주의 단계 알림: 일반적인 권장 임계값' },
  { value: 95, label: '95%',  tone: 'text-rose-700',    description: '곧 차단 단계 알림: 즉시 조치 필요' },
];

const CHANNEL_OPTIONS: Array<{ value: 'email' | 'sms' | 'inapp'; label: string; icon: typeof Mail; description: string }> = [
  { value: 'email', label: '이메일',  icon: Mail,        description: '회사 admin 이메일로 발송' },
  { value: 'sms',   label: 'SMS',     icon: MessageSquare, description: '회사 admin 휴대폰으로 발송' },
  { value: 'inapp', label: '앱 알림', icon: Smartphone,  description: 'AI 사용량 화면에 표시' },
];

export default function ThresholdAlertModal({ open, onClose, initial, onSave }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState<50 | 80 | 95>(80);
  const [channels, setChannels] = useState<Array<'email' | 'sms' | 'inapp'>>(['email', 'inapp']);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setValidationError(null);
    if (initial) {
      setEnabled(initial.enabled !== false);
      const t = initial.threshold_percent;
      if (t === 50 || t === 80 || t === 95) setThreshold(t);
      if (Array.isArray(initial.channels) && initial.channels.length > 0) {
        setChannels(initial.channels.filter((c): c is 'email' | 'sms' | 'inapp' => ['email', 'sms', 'inapp'].includes(c)));
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, initial, onClose, saving]);

  if (!open) return null;

  const toggleChannel = (c: 'email' | 'sms' | 'inapp') => {
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const handleSave = async () => {
    setValidationError(null);
    if (enabled && channels.length === 0) {
      setValidationError('알림을 활성화하려면 채널을 1개 이상 선택해주세요.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ threshold_percent: threshold, channels, enabled });
    } catch (e: any) {
      setValidationError(e?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white backdrop-blur-sm border-b border-slate-200 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Bell className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900">한도 알림 설정</h3>
            <p className="text-xs text-slate-500 mt-0.5">AI 호출 한도 도달 전 사전 알림. 차단 사고 예방</p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors disabled:opacity-30"
            disabled={saving}
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 활성/비활성 토글 */}
          <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg">
            <div>
              <div className="text-sm font-medium text-slate-900">알림 활성화</div>
              <div className="text-[11px] text-slate-500 mt-0.5">비활성 시 한도 알림이 발송되지 않습니다</div>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
              aria-pressed={enabled}
              aria-label="알림 활성화"
            >
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* 임계값 */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-2">알림 임계값</label>
            <div className="space-y-2">
              {THRESHOLD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setThreshold(opt.value)}
                  disabled={!enabled}
                  className={`w-full p-3 rounded-lg border text-left transition-all ${
                    threshold === opt.value
                      ? 'bg-amber-100 border-amber-300'
                      : 'bg-white border-slate-200 hover:bg-slate-100'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      threshold === opt.value ? 'border-amber-400' : 'border-slate-300'
                    }`}>
                      {threshold === opt.value && <div className="w-2 h-2 rounded-full bg-amber-400" />}
                    </div>
                    <span className={`text-base font-bold ${opt.tone}`}>{opt.label}</span>
                    <span className="text-xs text-slate-500 flex-1">{opt.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 채널 선택 */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-2">
              알림 채널 <span className="text-slate-400 font-normal">(중복 선택 가능)</span>
            </label>
            <div className="grid md:grid-cols-3 gap-2">
              {CHANNEL_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = channels.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleChannel(opt.value)}
                    disabled={!enabled}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      selected
                        ? 'bg-violet-100 border-violet-300'
                        : 'bg-white border-slate-200 hover:bg-slate-100'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${selected ? 'text-violet-700' : 'text-slate-500'}`} />
                      <span className={`text-sm font-medium ${selected ? 'text-slate-900' : 'text-slate-600'}`}>{opt.label}</span>
                      {selected && <span className="ml-auto text-[10px] text-violet-700">선택됨</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">{opt.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg">
            <div className="text-[11px] text-slate-600 leading-relaxed">
              <strong className="text-amber-800">알림 발송 흐름:</strong> 회사 admin에게 발송됩니다. 동일 임계값은 이번 달 중복 발송되지 않습니다 (월 1회).
              한도 100% 도달 시 별도 차단 알림이 자동 발송됩니다.
            </div>
          </div>

          {validationError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
              {validationError}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white backdrop-blur-sm border-t border-slate-200 px-6 py-3 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-white disabled:opacity-30"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                저장 중...
              </>
            ) : (
              <>
                <Bell className="w-3.5 h-3.5" />
                저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
