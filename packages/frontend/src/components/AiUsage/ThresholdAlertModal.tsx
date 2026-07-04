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
  { value: 50, label: '50%',  tone: 'text-sky-300',     description: '여유 있게 미리 알림 — 추세 모니터링 우선' },
  { value: 80, label: '80%',  tone: 'text-amber-300',   description: '주의 단계 알림 — 일반적인 권장 임계값' },
  { value: 95, label: '95%',  tone: 'text-rose-300',    description: '곧 차단 단계 알림 — 즉시 조치 필요' },
];

const CHANNEL_OPTIONS: Array<{ value: 'email' | 'sms' | 'inapp'; label: string; icon: typeof Mail; description: string }> = [
  { value: 'email', label: '이메일',  icon: Mail,        description: '회사 admin 이메일로 발송' },
  { value: 'sms',   label: 'SMS',     icon: MessageSquare, description: '회사 admin 휴대폰으로 발송' },
  { value: 'inapp', label: '앱 알림', icon: Smartphone,  description: '앱 내 알림 센터에 표시' },
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
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Bell className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white">한도 알림 설정</h3>
            <p className="text-xs text-white/50 mt-0.5">AI 호출 한도 도달 전 사전 알림 — 차단 사고 예방</p>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors disabled:opacity-30"
            disabled={saving}
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 활성/비활성 토글 */}
          <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg">
            <div>
              <div className="text-sm font-medium text-white">알림 활성화</div>
              <div className="text-[11px] text-white/50 mt-0.5">비활성 시 한도 알림이 발송되지 않습니다</div>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-white/20'}`}
              aria-pressed={enabled}
              aria-label="알림 활성화"
            >
              <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* 임계값 */}
          <div>
            <label className="text-xs font-medium text-white/70 block mb-2">알림 임계값</label>
            <div className="space-y-2">
              {THRESHOLD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setThreshold(opt.value)}
                  disabled={!enabled}
                  className={`w-full p-3 rounded-lg border text-left transition-all ${
                    threshold === opt.value
                      ? 'bg-amber-500/15 border-amber-400/50'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      threshold === opt.value ? 'border-amber-400' : 'border-white/30'
                    }`}>
                      {threshold === opt.value && <div className="w-2 h-2 rounded-full bg-amber-400" />}
                    </div>
                    <span className={`text-base font-bold ${opt.tone}`}>{opt.label}</span>
                    <span className="text-xs text-white/60 flex-1">{opt.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 채널 선택 */}
          <div>
            <label className="text-xs font-medium text-white/70 block mb-2">
              알림 채널 <span className="text-white/40 font-normal">(중복 선택 가능)</span>
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
                        ? 'bg-violet-500/15 border-violet-400/50'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${selected ? 'text-violet-300' : 'text-white/50'}`} />
                      <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-white/70'}`}>{opt.label}</span>
                      {selected && <span className="ml-auto text-[10px] text-violet-300">선택됨</span>}
                    </div>
                    <div className="text-[10px] text-white/40 leading-snug">{opt.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-400/20 rounded-lg">
            <div className="text-[11px] text-white/70 leading-relaxed">
              <strong className="text-amber-200">알림 발송 흐름:</strong> 회사 admin에게 발송됩니다. 동일 임계값은 이번 달 중복 발송되지 않습니다 (월 1회).
              한도 100% 도달 시 별도 차단 알림이 자동 발송됩니다.
            </div>
          </div>

          {validationError && (
            <div className="p-3 bg-rose-500/10 border border-rose-400/30 rounded-lg text-xs text-rose-200">
              {validationError}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm border-t border-white/10 px-6 py-3 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="px-4 py-2 border border-white/10 rounded-lg text-sm text-white/70 hover:bg-white/5 disabled:opacity-30"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-1.5"
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
