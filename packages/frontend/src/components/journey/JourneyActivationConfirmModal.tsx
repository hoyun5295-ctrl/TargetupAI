/**
 * JourneyActivationConfirmModal.tsx — D218+ (2026-05-26) 신설
 *
 * 본질: 여정 활성화 직전 자동 검증 + 비용 카드 + 회사 잔액 확인 + 명시적 동의 모달.
 *   - 검증 진행 시각 효과 (6 sub-agent 카드 700ms 간격 — 옛 D210+ Phase 2-fix6 패턴)
 *   - POST /api/ai/operator/journeys/:id/pretest-validate 호출
 *   - 통과 시 = 비용 합산 + 7일 누적 예상 + 회사 잔액 + 확인 버튼
 *   - 통과 X = 실패 step 사유 표시 + AI 자동 재생성 1-click 진입 (placeholder 잔존 차단)
 *   - 확인 → POST /api/ai/operator/journeys/:id/activate
 *
 * 영구 룰 정합:
 *   - feedback_design_quality_minimum_journey_level (다크 톤 + violet 액센트 + Source caption)
 *   - feedback_no_native_browser_dialog (ConfirmModal + useToast 활용)
 *   - feedback_marketing_user_ux_priority (사용자 클릭 수 = 활성화 + 확인 = 2회)
 *   - db_alter_safety_net (503 분기 처리)
 */

import { useState, useEffect } from 'react';
import {
  X, Sparkles, CheckCircle2, AlertTriangle, Loader2, Wallet, TrendingUp,
  ShieldCheck, MessageSquare, FileText, Hash, Calculator, Wand2,
} from 'lucide-react';
import { useToast } from '../ToastProvider';
import CreditConfirmModal from '../credit/CreditConfirmModal';

interface Props {
  journeyId: string;
  journeyName: string;
  journeyStatus: string;
  onClose: () => void;
  onActivated: () => void;
  token: string;
}

interface FailedStep {
  stepId: string;
  variantId?: string;
  reason: 'placeholder_unedited' | 'variable_mapping_invalid' | 'spam_filter_failed' | 'subject_missing';
  details: string;
  matchedStopWords?: string[];
}

interface ValidationResult {
  ok: boolean;
  failedSteps: FailedStep[];
  totalCost: number;
  estimatedWeeklyTriggerCount: number;
  confidenceScore: number;
  perCarrierScore?: {
    skt: number;
    kt: number;
    lguplus: number;
  };
}

interface CompanyBalance {
  balance: number;
}

const REASON_LABEL: Record<FailedStep['reason'], string> = {
  placeholder_unedited: '문안 placeholder 잔존',
  variable_mapping_invalid: '알림톡 변수 매핑 누락',
  spam_filter_failed: '스팸필터 차단',
  subject_missing: 'LMS/MMS 제목 누락',
};

const SUB_AGENT_CARDS = [
  { icon: FileText, label: 'placeholder 잔존 검증', color: 'from-violet-500 to-purple-500' },
  { icon: Hash, label: '변수 매핑 검증', color: 'from-fuchsia-500 to-pink-500' },
  { icon: MessageSquare, label: 'LMS/MMS 제목 검증', color: 'from-indigo-500 to-blue-500' },
  { icon: ShieldCheck, label: '통신3사 스팸필터 검증', color: 'from-cyan-500 to-teal-500' },
  { icon: Calculator, label: '비용 합산 + 7일 누적 예상', color: 'from-emerald-500 to-green-500' },
  { icon: Wallet, label: '회사 잔액 정합 확인', color: 'from-amber-500 to-orange-500' },
];

export default function JourneyActivationConfirmModal({
  journeyId, journeyName, journeyStatus, onClose, onActivated, token,
}: Props) {
  const toast = useToast();
  const [phase, setPhase] = useState<'validating' | 'failed' | 'ready' | 'activating' | 'migration_pending'>('validating');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditConfirm, setCreditConfirm] = useState(false);

  // sub-agent 카드 700ms 간격 진행
  useEffect(() => {
    if (phase !== 'validating') return;
    if (activeCardIndex >= SUB_AGENT_CARDS.length) return;
    const t = setTimeout(() => setActiveCardIndex((i) => i + 1), 700);
    return () => clearTimeout(t);
  }, [phase, activeCardIndex]);

  // ESC 닫기
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'activating') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, phase]);

  // 검증 + 잔액 fetch 동시 진행
  useEffect(() => {
    runValidate();
  }, []);

  const runValidate = async () => {
    setPhase('validating');
    setActiveCardIndex(0);
    setError(null);
    try {
      const [validateRes, balanceRes] = await Promise.all([
        fetch(`/api/ai/operator/journeys/${journeyId}/pretest-validate`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/balance`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
      ]);

      if (validateRes.status === 503) {
        setPhase('migration_pending');
        return;
      }

      const validateData = await validateRes.json();
      if (!validateRes.ok) {
        setError(validateData?.error || '활성화 검증 오류');
        setPhase('failed');
        return;
      }
      setResult(validateData);

      if (balanceRes && balanceRes.ok) {
        const balanceData: CompanyBalance = await balanceRes.json();
        setBalance(Number(balanceData?.balance || 0));
      }

      // sub-agent 카드 6건 완료될 때까지 추가 대기 (시각 효과 본질)
      const minDelayMs = SUB_AGENT_CARDS.length * 700 + 300;
      await new Promise((resolve) => setTimeout(resolve, minDelayMs));

      setPhase(validateData.ok ? 'ready' : 'failed');
    } catch (e: any) {
      setError(e?.message || '검증 호출 오류');
      setPhase('failed');
    }
  };

  const runActivate = async () => {
    setPhase('activating');
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('여정이 활성화되었습니다');
        onActivated();
        onClose();
      } else {
        toast.error(data?.error || '활성화 오류');
        setPhase('ready');
      }
    } catch (e: any) {
      toast.error(e?.message || '활성화 호출 오류');
      setPhase('ready');
    }
  };

  // AI 자동 재생성 1-click — step 단위 placeholder/spam 오류 정정 호출 (backend 추가 endpoint — 본 모달은 안내만 + JourneysPage 편집 진입)
  const onRegenerate = (failedStep: FailedStep) => {
    toast.info('JourneysPage 편집 영역에서 step 본문을 정정 후 다시 활성화 의무');
    onClose();
    // step expand + 편집 UI scroll — 향후 강화 영역 (현 세션 범위 X)
    const evt = new CustomEvent('journey:expand-step', { detail: { journeyId, stepId: failedStep.stepId } });
    window.dispatchEvent(evt);
  };

  const isInsufficientBalance = balance != null && result != null && balance < result.totalCost;

  return (
    <>
      <CreditConfirmModal
        open={creditConfirm}
        source="journey-activate"
        onConfirm={() => { setCreditConfirm(false); void runActivate(); }}
        onCancel={() => setCreditConfirm(false)}
      />
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      >
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-purple-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                여정 활성화 자동 검증
              </h3>
              <p className="text-[11px] text-white/50 mt-0.5">{journeyName}</p>
            </div>
          </div>
          {phase !== 'activating' && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="닫기"
            >
              <X className="w-4 h-4 text-white/50" />
            </button>
          )}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 검증 진행 시각 효과 */}
          {phase === 'validating' && (
            <div>
              <div className="text-[11px] text-white/50 mb-3 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-violet-300" />
                AI 자율 진단 진행 중 — 모든 step + variant 일제 검증
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SUB_AGENT_CARDS.map((card, i) => {
                  const Icon = card.icon;
                  const isActive = i < activeCardIndex;
                  const isCurrent = i === activeCardIndex - 1;
                  return (
                    <div
                      key={card.label}
                      className={`p-3 rounded-xl border transition-all duration-500 ${
                        isActive
                          ? 'bg-white/5 border-white/20 opacity-100'
                          : 'bg-white/[0.02] border-white/5 opacity-40'
                      } ${isCurrent ? 'ring-1 ring-violet-400/40 shadow-lg shadow-violet-500/10' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center flex-shrink-0`}>
                          {isActive && !isCurrent ? (
                            <CheckCircle2 className="w-4 h-4 text-white" />
                          ) : isCurrent ? (
                            <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                          ) : (
                            <Icon className="w-3.5 h-3.5 text-white" />
                          )}
                        </div>
                        <span className="text-[12px] text-white/80 leading-tight">{card.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] text-white/30 italic mt-3">
                Data source — 여정 자동 검증 엔진
              </div>
            </div>
          )}

          {/* DB 마이그레이션 대기 */}
          {phase === 'migration_pending' && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-400/30">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[13px] font-semibold text-amber-100">잠시 후 다시 시도해 주세요</div>
                  <div className="text-[12px] text-amber-100/80 mt-1 leading-relaxed">
                    여정 자동 검증 기능을 준비 중입니다. 잠시 후 다시 활성화를 눌러주세요.
                    계속 반복되면 고객센터로 문의해 주세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 통과 — 비용 + 잔액 + 확인 카드 */}
          {phase === 'ready' && result && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  <div className="text-[14px] font-semibold text-emerald-100">자동 검증 통과 — 모든 step 정합 OK</div>
                </div>
                {result.confidenceScore > 0 && (
                  <div className="text-[12px] text-emerald-100/80">
                    스팸필터 신뢰도 점수 — <span className="font-mono font-semibold">{result.confidenceScore}</span> / 100
                    {result.perCarrierScore && (
                      <div className="grid grid-cols-3 gap-1 mt-2 text-[10px] text-emerald-100/60">
                        <div>SKT {result.perCarrierScore.skt}</div>
                        <div>KT {result.perCarrierScore.kt}</div>
                        <div>LG U+ {result.perCarrierScore.lguplus}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 비용 카드 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Calculator className="w-4 h-4 text-violet-300" />
                    <span className="text-[11px] text-white/60">7일 누적 예상 비용</span>
                  </div>
                  <div className="text-xl font-bold text-white font-mono">
                    {result.totalCost.toLocaleString()}원
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">
                    7일 트리거 {result.estimatedWeeklyTriggerCount.toLocaleString()}건 × step 단가
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Wallet className="w-4 h-4 text-amber-300" />
                    <span className="text-[11px] text-white/60">회사 현재 잔액</span>
                  </div>
                  <div className={`text-xl font-bold font-mono ${isInsufficientBalance ? 'text-rose-300' : 'text-white'}`}>
                    {balance != null ? `${balance.toLocaleString()}원` : '— 조회 X —'}
                  </div>
                  {isInsufficientBalance && (
                    <div className="text-[10px] text-rose-300 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      잔액 부족 — 충전 의무
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-400/20">
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 text-violet-300 flex-shrink-0 mt-0.5" />
                  <div className="text-[12px] text-violet-100/90 leading-relaxed">
                    활성화 직후 = 모든 step + variant 본문 snapshot 저장 + 발송 2시간 전 담당자 LMS 자동 발송 스케줄 진행.
                    회사 admin이 step 본문을 편집해도 발송 시점 = 활성화 시점 본문 100% 동일 보장.
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-white/30 italic">
                Data source — 여정 자동 검증 엔진
              </div>
            </div>
          )}

          {/* 통과 X — 실패 step 사유 + 재생성 */}
          {phase === 'failed' && (
            <div className="space-y-3">
              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/30">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
                    <div className="text-[12px] text-rose-100">{error}</div>
                  </div>
                </div>
              )}

              {result && result.failedSteps.length > 0 && (
                <>
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/30">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-rose-300" />
                      <div className="text-[14px] font-semibold text-rose-100">
                        자동 검증 미통과 — {result.failedSteps.length}건 정정 의무
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {result.failedSteps.map((fs, i) => (
                      <div key={`${fs.stepId}-${i}`} className="p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-200 font-mono uppercase">
                            {REASON_LABEL[fs.reason] || fs.reason}
                          </span>
                        </div>
                        <div className="text-[12px] text-white/80 mb-2">{fs.details}</div>
                        {fs.matchedStopWords && fs.matchedStopWords.length > 0 && (
                          <div className="text-[11px] text-white/50">
                            매칭된 stop word — {fs.matchedStopWords.slice(0, 5).join(', ')}
                          </div>
                        )}
                        <button
                          onClick={() => onRegenerate(fs)}
                          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-100 text-[11px] font-semibold transition-colors"
                        >
                          <Wand2 className="w-3 h-3" />
                          step 편집 영역 진입
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="text-[10px] text-white/30 italic">
                    Data source — 여정 자동 검증 엔진
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-slate-950/50">
          {phase === 'ready' && (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={journeyStatus === 'draft' ? () => setCreditConfirm(true) : runActivate}
                disabled={isInsufficientBalance}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-violet-500/30"
              >
                {journeyStatus === 'draft' ? '활성화 확인' : '재개 확인'}
              </button>
            </>
          )}

          {phase === 'failed' && (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
              >
                닫기
              </button>
              <button
                onClick={runValidate}
                className="flex-1 px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 rounded-lg text-sm font-semibold transition-colors"
              >
                다시 검증
              </button>
            </>
          )}

          {phase === 'validating' && (
            <div className="w-full text-center text-[11px] text-white/40">
              검증 진행 중 — 5~10초 소요
            </div>
          )}

          {phase === 'activating' && (
            <div className="w-full text-center text-[12px] text-violet-200 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              활성화 진행 중 — snapshot 보존 + 알림 스케줄 등록
            </div>
          )}

          {phase === 'migration_pending' && (
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
            >
              닫기
            </button>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
