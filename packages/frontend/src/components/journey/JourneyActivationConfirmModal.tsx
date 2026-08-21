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
  /** ★ 2026-07-10 목표 달성 시 자동 종료 — 활성화 직전 마지막 확인 표시(옵션 상태) */
  goalExitEnabled?: boolean;
  /** ★ 2026-08-02 §13-5 — 현재 저장된 "한 번에 보낼 최대 인원". 전 트리거 필수라 없으면 활성화가 거부된다. */
  thresholdRecipients?: number | null;
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
  journeyId, journeyName, journeyStatus, goalExitEnabled, thresholdRecipients, onClose, onActivated, token,
}: Props) {
  const toast = useToast();
  const [capInput, setCapInput] = useState(thresholdRecipients != null ? String(thresholdRecipients) : '');
  /** 서버에 저장된 값 — prop은 목록에서 오므로 저장 직후 갱신되지 않는다. 이걸 안 두면 저장·재검증이 반복된다. */
  const [savedCap, setSavedCap] = useState<number | null>(thresholdRecipients ?? null);
  const [phase, setPhase] = useState<'validating' | 'failed' | 'ready' | 'activating' | 'migration_pending' | 'callback_confirm'>('validating');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditConfirm, setCreditConfirm] = useState(false);
  const [callbackConfirm, setCallbackConfirm] = useState<{ count: number; details: { phone: string; excludedCount: number }[]; message: string } | null>(null);

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
      // ★ 2026-08-02 Codex 2R — 검증하는 사이에 스텝·옵션이 바뀌면 통과로 기록하지 않는다(서버 판정).
      //   실패 항목이 없는 실패라 사유를 따로 보여주지 않으면 화면이 빈 채로 멈춘다.
      if (validateData?.staleRevision) {
        setError(validateData?.error || '검증하는 사이에 여정이 바뀌었습니다. 한 번 더 검증해 주세요.');
      }

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

  const runActivate = async (confirmExclusion = false) => {
    // ★ 2026-08-02 §13-5 — 상한을 먼저 저장하고 활성화한다. 순서를 바꾸면 활성화가 옛 값으로 판정된다.
    //   ⛔ 저장이 실패하면 활성화하지 않는다 — 상한 없이 켜지는 것이 이 입력을 만든 이유 자체를 없앤다.
    // ⛔ 2026-08-02 Codex 4R — 저장·비교·표시가 **같은 값**을 써야 한다.
    //   1.5를 넣으면 서버엔 1이 저장되는데 입력칸은 1.5로 남아, 다음 확인에서도 다르다고 판정해
    //   저장과 재검증만 무한히 반복하고 활성화에 도달하지 못한다.
    const capNum = Math.floor(Number(capInput));
    if (!capInput.trim() || !Number.isFinite(capNum) || capNum < 1) {
      toast.warning('한 번에 보낼 최대 인원을 1 이상 정수로 정해 주세요.');
      return;
    }
    if (String(capNum) !== capInput.trim()) setCapInput(String(capNum));
    if (capNum !== savedCap) {
      try {
        const optRes = await fetch(`/api/ai/operator/journeys/${journeyId}/options`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ thresholdRecipients: capNum }),
        });
        const optData = await optRes.json().catch(() => ({}));
        if (!optRes.ok || !optData?.success) {
          toast.error(optData?.error || '최대 인원 저장 실패');
          return;
        }
      } catch (e: any) {
        toast.error(e?.message || '최대 인원 저장 중 오류');
        return;
      }
      // ⛔ 2026-08-02 Codex 3R — 설정을 바꿨으면 **바꾼 구성으로 다시 검증**해야 켤 수 있다.
      //   옵션 변경은 서버에서 사전검사 통과를 무효로 만든다(검사받지 않은 구성으로 발송이 시작되는 것을 막는 규약).
      setSavedCap(capNum);
      toast.info('최대 인원을 저장했습니다. 바뀐 설정으로 다시 검증합니다.');
      await runValidate();
      return;
    }
    setPhase('activating');
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmCallbackExclusion: confirmExclusion }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('여정이 활성화되었습니다');
        onActivated();
        onClose();
      } else if (data?.callbackConfirmRequired) {
        // 매장번호 발송(store 모드) 미등록 회신번호 — 실패 예정 인원 고지 후 재확인
        setCallbackConfirm({
          count: Number(data.callbackUnregisteredCount || 0),
          details: Array.isArray(data.unregisteredDetails) ? data.unregisteredDetails : [],
          message: String(data.message || ''),
        });
        setPhase('callback_confirm');
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
              <p className="text-[11px] text-white/50 mt-0.5">
                {journeyName}
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${goalExitEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/40'}`}>
                  목표 달성 자동 종료 {goalExitEnabled ? '켜짐' : '꺼짐'}
                </span>
              </p>
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
                AI 자율 진단 진행 중: 모든 step + variant 일제 검증
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
                Data source: 여정 자동 검증 엔진
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
              {/* ★ 2026-08-02 §13-5 — 한 번에 보낼 최대 인원. 전 트리거 필수라 받는 자리를 여기 만든다.
                  옛 화면은 값이 없으면 활성화가 거부되는데 그 값을 넣을 곳이 없었다. */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-1.5">
                  <ShieldCheck className="w-4 h-4 text-violet-300" />
                  <span className="text-[12px] font-semibold text-white/85">한 번에 보낼 최대 인원</span>
                </div>
                <input
                  type="number"
                  min={1}
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  placeholder="예: 500"
                  className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-violet-400/50 focus:outline-none"
                />
                <p className="text-[11px] text-white/45 mt-1.5">
                  고객 정보를 한꺼번에 옮겨 올 때 예상보다 많은 분께 나가는 것을 막습니다. 한 회차에 이 인원을 넘지 않습니다.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  <div className="text-[14px] font-semibold text-emerald-100">자동 검증 통과: 모든 step 정합 OK</div>
                </div>
                {result.confidenceScore > 0 && (
                  <div className="text-[12px] text-emerald-100/80">
                    스팸필터 신뢰도 점수: <span className="font-mono font-semibold">{result.confidenceScore}</span> / 100
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
                    {balance != null ? `${balance.toLocaleString()}원` : '조회 불가'}
                  </div>
                  {isInsufficientBalance && (
                    <div className="text-[10px] text-rose-300 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      잔액 부족: 충전 의무
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
                Data source: 여정 자동 검증 엔진
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
                        자동 검증 미통과: {result.failedSteps.length}건 정정 의무
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
                            매칭된 stop word: {fs.matchedStopWords.slice(0, 5).join(', ')}
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
                    Data source: 여정 자동 검증 엔진
                  </div>
                </>
              )}
            </div>
          )}
          {/* 매장번호 발송 — 미등록 회신번호 실패 예정 고지 */}
          {phase === 'callback_confirm' && callbackConfirm && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-400/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[14px] font-semibold text-amber-100">
                      미등록 매장번호: 발송 실패 예정 {callbackConfirm.count.toLocaleString()}명
                    </div>
                    <div className="text-[12px] text-amber-100/80 mt-1 leading-relaxed">
                      {callbackConfirm.message || '매장번호가 등록 발신번호가 아닌 고객은 발송이 자동 실패 처리됩니다.'}
                      {' '}발신번호 관리에서 매장번호를 등록하면 정상 발송됩니다. 매장번호가 없는 고객은 기본 회신번호로 발송됩니다.
                    </div>
                  </div>
                </div>
              </div>
              {callbackConfirm.details.length > 0 && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-[11px] text-white/60 mb-2">미등록 매장번호별 실패 예정 인원</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {callbackConfirm.details.slice(0, 20).map((d) => (
                      <div key={d.phone} className="flex items-center justify-between text-[12px]">
                        <span className="font-mono text-white/80">{d.phone}</span>
                        <span className="text-rose-300">{d.excludedCount.toLocaleString()}명 실패</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-[10px] text-white/30 italic">
                Data source: customers.store_phone ↔ 등록 발신번호(callback_numbers) 대조
              </div>
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
                onClick={journeyStatus === 'draft' ? () => setCreditConfirm(true) : () => runActivate()}
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

          {phase === 'callback_confirm' && (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => runActivate(true)}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-amber-500/30"
              >
                확인하고 활성화
              </button>
            </>
          )}

          {phase === 'validating' && (
            <div className="w-full text-center text-[11px] text-white/40">
              검증 진행 중 (5~10초 소요)
            </div>
          )}

          {phase === 'activating' && (
            <div className="w-full text-center text-[12px] text-violet-200 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              활성화 진행 중: snapshot 보존 + 알림 스케줄 등록
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
