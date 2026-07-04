/**
 * JourneyActionConfirmModal.tsx — D211+ Phase 3-fix (2026-05-23 Harold 명시)
 *
 * 본질: native confirm()/prompt()/alert() 절대 사용 금지 영구 룰 정합.
 *   - archive (보관함 이동) / unarchive (보관함 복원) / delete (영구 삭제) 3 모드 분기
 *   - 다크 톤 매트릭스 정합 (bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl)
 *   - delete 영역 = 2차 confirm "삭제" 단어 직접 입력 input (강력 안전망)
 *
 * 영구 룰 정합:
 *   - feedback_no_native_browser_dialog (D211+ Harold 명시)
 *   - feedback_jondaetmal_to_harold (자비스 톤)
 */

import { useState, useEffect } from 'react';
import { X, Archive, ArchiveRestore, Trash2, AlertTriangle, Info, Pause, Power } from 'lucide-react';

export type JourneyActionMode = 'archive' | 'unarchive' | 'delete' | 'pause' | 'end';

interface Props {
  mode: JourneyActionMode;
  journeyName: string;
  onConfirm: () => void;
  onClose: () => void;
}

const MODE_CONFIG: Record<JourneyActionMode, {
  icon: typeof Archive;
  iconBg: string;
  iconColor: string;
  title: string;
  accent: string;
  buttonBg: string;
  buttonHover: string;
  buttonText: string;
  confirmLabel: string;
}> = {
  archive: {
    icon: Archive,
    iconBg: 'bg-cyan-500/20',
    iconColor: 'text-cyan-300',
    title: '보관함으로 이동',
    accent: 'border-cyan-400/30',
    buttonBg: 'bg-cyan-500/30',
    buttonHover: 'hover:bg-cyan-500/50',
    buttonText: 'text-cyan-100',
    confirmLabel: '보관함으로 이동',
  },
  unarchive: {
    icon: ArchiveRestore,
    iconBg: 'bg-cyan-500/20',
    iconColor: 'text-cyan-300',
    title: '보관함에서 복원',
    accent: 'border-cyan-400/30',
    buttonBg: 'bg-cyan-500/30',
    buttonHover: 'hover:bg-cyan-500/50',
    buttonText: 'text-cyan-100',
    confirmLabel: '복원',
  },
  delete: {
    icon: Trash2,
    iconBg: 'bg-rose-500/20',
    iconColor: 'text-rose-300',
    title: '영구 삭제 (복구 불가)',
    accent: 'border-rose-400/40',
    buttonBg: 'bg-rose-500/40',
    buttonHover: 'hover:bg-rose-500/60',
    buttonText: 'text-rose-50',
    confirmLabel: '영구 삭제',
  },
  pause: {
    icon: Pause,
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-300',
    title: '여정 일시정지',
    accent: 'border-amber-400/30',
    buttonBg: 'bg-amber-500/30',
    buttonHover: 'hover:bg-amber-500/50',
    buttonText: 'text-amber-100',
    confirmLabel: '일시정지',
  },
  end: {
    icon: Power,
    iconBg: 'bg-rose-500/20',
    iconColor: 'text-rose-300',
    title: '여정 종료 (재시작 불가)',
    accent: 'border-rose-400/40',
    buttonBg: 'bg-rose-500/40',
    buttonHover: 'hover:bg-rose-500/60',
    buttonText: 'text-rose-50',
    confirmLabel: '종료',
  },
};

export default function JourneyActionConfirmModal({ mode, journeyName, onConfirm, onClose }: Props) {
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const isDeleteValid = mode !== 'delete' || deleteConfirmInput.trim() === '삭제';

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    >
      <div
        className={`bg-slate-900 border ${config.accent} rounded-2xl shadow-2xl max-w-md w-full overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${config.iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${config.iconColor}`} />
            </div>
            <h3 className="text-base font-semibold text-white">{config.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            aria-label="닫기"
          >
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 space-y-3">
          <div className="text-sm text-white/70">
            여정 <span className="font-semibold text-white">"{journeyName}"</span>
          </div>

          {mode === 'archive' && (
            <div className="space-y-2 text-[13px] text-white/80 leading-relaxed">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-cyan-300 flex-shrink-0 mt-0.5" />
                <span>보관함으로 이동하면 목록에서 숨겨지지만 통계는 영구 보존됩니다.</span>
              </div>
              <ul className="text-[12px] text-white/60 space-y-1 pl-6">
                <li>· 월간 / 분기 성과 비교 가능</li>
                <li>· "보관함" 필터에서 영구 접근 가능</li>
                <li>· 언제든 복원 가능 (보관함 복원 버튼)</li>
              </ul>
            </div>
          )}

          {mode === 'unarchive' && (
            <div className="text-[13px] text-white/80 leading-relaxed">
              <div className="flex gap-2">
                <Info className="w-4 h-4 text-cyan-300 flex-shrink-0 mt-0.5" />
                <span>보관함에서 복원하면 여정 목록에 다시 노출됩니다. 옛 통계 영역 영향 없음.</span>
              </div>
            </div>
          )}

          {(mode === 'pause' || mode === 'end') && (
            <div className="text-[13px] text-white/80 leading-relaxed">
              <div className="flex gap-2">
                <Info className={`w-4 h-4 ${mode === 'end' ? 'text-rose-300' : 'text-amber-300'} flex-shrink-0 mt-0.5`} />
                <span>
                  {mode === 'pause'
                    ? '일시정지하면 발송이 멈춥니다. 언제든 다시 재개할 수 있습니다.'
                    : '종료하면 발송이 멈추고 다시 시작할 수 없습니다. 통계는 보존됩니다.'}
                </span>
              </div>
            </div>
          )}

          {mode === 'delete' && (
            <>
              <div className="p-3 bg-rose-500/10 border border-rose-400/30 rounded-lg">
                <div className="flex gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
                  <span className="text-[13px] font-semibold text-rose-100">영구 삭제 시 즉시 손실되는 영역</span>
                </div>
                <ul className="text-[12px] text-rose-100/80 space-y-1 pl-6 leading-relaxed">
                  <li>· 모든 step 정의</li>
                  <li>· 진입 customer 실행 영역 (journey_executions)</li>
                  <li>· 발송 로그 영역 (journey_step_logs)</li>
                  <li>· A/B variant 영역 (journey_step_variants)</li>
                </ul>
                <div className="mt-2 text-[12px] text-rose-200/70">
                  복구 불가. 통계 보존이 필요하면 "보관함" 영역 정합 권장.
                </div>
              </div>

              <div>
                <label className="block text-[12px] text-white/60 mb-1.5">
                  확정을 위해 <span className="text-rose-300 font-mono font-semibold">삭제</span> 단어를 직접 입력해주세요
                </label>
                <input
                  type="text"
                  value={deleteConfirmInput}
                  onChange={(e) => setDeleteConfirmInput(e.target.value)}
                  placeholder="삭제"
                  autoFocus
                  className="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-rose-400/50 transition-colors"
                />
              </div>
            </>
          )}
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={!isDeleteValid}
            className={`flex-1 px-4 py-2 ${config.buttonBg} ${config.buttonHover} disabled:opacity-30 disabled:cursor-not-allowed ${config.buttonText} rounded-lg text-sm font-semibold transition-colors`}
          >
            {config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
