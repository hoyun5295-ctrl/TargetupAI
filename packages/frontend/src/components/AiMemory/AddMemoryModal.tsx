/**
 * AddMemoryModal.tsx — 회사 admin 직접 학습 메모리 입력 모달 (D217+ 2026-05-25)
 *
 * 다크 톤 + violet 액센트 정합 (bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl).
 * 5 타입 + key + value + 중요도 1~10. ESC + backdrop click + autoFocus.
 *
 * native dialog 사용 절대 X — 부모 컴포넌트에서 useToast로 에러/성공 표시.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Plus, Sparkles, Loader2 } from 'lucide-react';

export type MemoryType =
  | 'success_pattern'
  | 'customer_insight'
  | 'brand_tone_evolution'
  | 'channel_performance'
  | 'compliance_learning';

export interface NewMemoryInput {
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (input: NewMemoryInput) => Promise<void>;
  initialType?: MemoryType;
}

const TYPE_OPTIONS: Array<{ type: MemoryType; label: string; placeholder: string; valuePlaceholder: string; gradient: string }> = [
  {
    type: 'customer_insight',
    label: '고객 인사이트',
    placeholder: '예: VIP 등급 화요일 재구매 패턴',
    valuePlaceholder: '예: VIP 등급 고객은 화요일 오후 2시 알림톡 발송 시 가장 높은 클릭률을 보임 (18%, 30일 평균)',
    gradient: 'from-sky-400 to-cyan-500',
  },
  {
    type: 'brand_tone_evolution',
    label: '브랜드 톤 진화',
    placeholder: '예: 이모지 사용 자제 정책',
    valuePlaceholder: '예: 2026-Q1부터 이모지 사용 자제 — 전문성 우선. 느낌표는 1개 이내.',
    gradient: 'from-violet-400 to-purple-500',
  },
  {
    type: 'compliance_learning',
    label: '컴플라이언스 학습',
    placeholder: '예: 광고 차단 단어 대체',
    valuePlaceholder: '예: "특가" 단어 광고 차단 6건 발생 — "한정 혜택"으로 대체 적용 후 차단 0건',
    gradient: 'from-rose-400 to-pink-500',
  },
  {
    type: 'success_pattern',
    label: '성공 패턴',
    placeholder: '예: VIP 화요일 알림톡 성공',
    valuePlaceholder: '예: VIP 화요일 오후 2시 알림톡 → 클릭률 18.4% (320명 발송, 30일 평균)',
    gradient: 'from-emerald-400 to-teal-500',
  },
  {
    type: 'channel_performance',
    label: '채널 성과',
    placeholder: '예: LMS vs SMS 비교',
    valuePlaceholder: '예: LMS 평균 클릭률 7.4% > SMS 평균 5.2% — 30일 기준 (1,200건 발송)',
    gradient: 'from-amber-400 to-orange-500',
  },
];

const IMPORTANCE_GUIDE: Array<{ min: number; label: string; tone: string }> = [
  { min: 8, label: '매우 중요 (AI 우선 참고)',  tone: 'text-emerald-300' },
  { min: 5, label: '보통 (일반 참고)',           tone: 'text-amber-300' },
  { min: 1, label: '낮음 (참고만)',              tone: 'text-white/40' },
];

function importanceLabel(v: number): { label: string; tone: string } {
  for (const g of IMPORTANCE_GUIDE) {
    if (v >= g.min) return { label: g.label, tone: g.tone };
  }
  return IMPORTANCE_GUIDE[IMPORTANCE_GUIDE.length - 1];
}

export default function AddMemoryModal({ open, onClose, onSave, initialType = 'customer_insight' }: Props) {
  const [memoryType, setMemoryType] = useState<MemoryType>(initialType);
  const [memoryKey, setMemoryKey] = useState('');
  const [memoryValue, setMemoryValue] = useState('');
  const [importance, setImportance] = useState(7);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMemoryType(initialType);
      setMemoryKey('');
      setMemoryValue('');
      setImportance(7);
      setValidationError(null);
      setSaving(false);
      return;
    }
    setTimeout(() => keyRef.current?.focus(), 50);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, initialType, onClose, saving]);

  if (!open) return null;

  const currentOption = TYPE_OPTIONS.find((o) => o.type === memoryType) || TYPE_OPTIONS[0];
  const impMeta = importanceLabel(importance);

  const handleSave = async () => {
    setValidationError(null);
    const trimmedKey = memoryKey.trim();
    const trimmedValue = memoryValue.trim();
    if (trimmedKey.length < 2) {
      setValidationError('학습 제목은 2자 이상 입력해주세요.');
      return;
    }
    if (trimmedKey.length > 200) {
      setValidationError('학습 제목은 200자 이내로 입력해주세요.');
      return;
    }
    if (trimmedValue.length < 5) {
      setValidationError('상세 내용은 5자 이상 입력해주세요.');
      return;
    }
    if (trimmedValue.length > 2000) {
      setValidationError('상세 내용은 2000자 이내로 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        memoryType,
        memoryKey: trimmedKey,
        memoryValue: trimmedValue,
        importance,
      });
    } catch (e: any) {
      setValidationError(e?.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center">
            <Plus className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white">학습 메모리 직접 입력</h3>
            <p className="text-xs text-white/50 mt-0.5">AI가 시스템 프롬프트에 자동 포함하여 회사 고유 톤·정책을 우선 참고합니다</p>
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

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-white/70 block mb-2">학습 분류</label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setMemoryType(opt.type)}
                  className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                    memoryType === opt.type
                      ? `bg-gradient-to-br ${opt.gradient} text-white border-transparent shadow-lg`
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-white/70 block mb-1.5">
              학습 제목 <span className="text-rose-300">*</span>
              <span className="text-white/40 ml-2 font-normal">짧고 명확하게 (200자 이내)</span>
            </label>
            <input
              ref={keyRef}
              type="text"
              value={memoryKey}
              onChange={(e) => setMemoryKey(e.target.value)}
              placeholder={currentOption.placeholder}
              maxLength={200}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
            />
            <div className="text-[10px] text-white/30 mt-1 text-right">{memoryKey.length} / 200</div>
          </div>

          <div>
            <label className="text-xs font-medium text-white/70 block mb-1.5">
              상세 내용 <span className="text-rose-300">*</span>
              <span className="text-white/40 ml-2 font-normal">근거 데이터·수치 포함 권장 (2000자 이내)</span>
            </label>
            <textarea
              value={memoryValue}
              onChange={(e) => setMemoryValue(e.target.value)}
              placeholder={currentOption.valuePlaceholder}
              maxLength={2000}
              className="w-full px-3 py-2.5 bg-slate-950/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-none h-28 focus:outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
            />
            <div className="text-[10px] text-white/30 mt-1 text-right">{memoryValue.length} / 2000</div>
          </div>

          <div>
            <label className="text-xs font-medium text-white/70 block mb-1.5">
              중요도 <span className="text-white/40 ml-2 font-normal">높을수록 AI가 우선 참고</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={10}
                value={importance}
                onChange={(e) => setImportance(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                className="flex-1 accent-emerald-400"
              />
              <div className="flex items-center gap-2 min-w-[180px] justify-end">
                <span className="text-base font-bold text-white">{importance}</span>
                <span className="text-white/40 text-xs">/ 10</span>
                <span className={`text-xs font-medium ${impMeta.tone}`}>{impMeta.label}</span>
              </div>
            </div>
          </div>

          <div className="p-3 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-400/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-white/70 leading-relaxed">
                <strong className="text-amber-200">입력 팁:</strong> 구체 수치 (클릭률 % / 발송 건수 / 기간)를 포함하면 AI가 더 정확하게 참고합니다.
                같은 학습 제목으로 재입력 시 최신 내용으로 업데이트되며, 중요도는 기존 값과 비교하여 더 높은 값이 유지됩니다.
              </div>
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
            className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                저장 중...
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
