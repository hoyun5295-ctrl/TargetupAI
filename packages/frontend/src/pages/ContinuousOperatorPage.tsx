import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Brain, Check, ChevronDown, ChevronUp, Clock, Edit2, GitMerge, Loader2, Play, Plus, RefreshCw, Sparkles, Target, Trash2, X, Zap } from 'lucide-react';
// ★ D212+ (2026-05-23 Harold 명시): native confirm/alert 영구 폐기 — ConfirmModal + Toast 정합
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';

// ★ D176 (2026-05-19): Continuous Agentic Operator — AI는 매일 제안서 생성 / 실행은 사용자 동의 후
//   영구 원칙: AI 단독 실행 X / Zero-Count 차단 / ENT 자동 실행 옵션 default OFF
// ★ D177 (2026-05-19): Self-Optimizing Bandit (Thompson Sampling) — message variant 누적 학습 + 추천

interface ProposalVariant {
  id: string;
  proposalId: string;
  variantIndex: number;
  messageBody: string;
  byteCount: number;
  armAlpha: number;
  armBeta: number;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  rewardTotal: number;
}

interface BanditRecommendation {
  variantId: string;
  variantIndex: number;
  messageBody: string;
  posteriorMean: number;
  posteriorSample: number;
  totalTrials: number;
  reasoning: string;
}

// ★ D179 (2026-05-19): Multi-Goal Decisioning UI 추가
interface MultiGoalInput {
  name: string;
  description?: string;
  weight: number;
}

interface MultiGoalSubPlan {
  goalName: string;
  targetCriteria: string;
  channelRecommended: string;
  timingRecommended: string;
  conflicts: string[];
  priority: number;
  shouldExecute: boolean;
  reasoning: string;
}

interface MultiGoalAnalysis {
  goals: MultiGoalInput[];
  subPlans: MultiGoalSubPlan[];
  overallStrategy: string;
  conflictMatrix: string;
  recommendedOrder: string[];
  analyzedAt: string;
}

type Schedule = 'daily' | 'weekly' | 'monthly';
type OperatorStatus = 'active' | 'paused' | 'archived';
type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'expired';

interface ContinuousOperator {
  id: string;
  name: string;
  objective: string;
  schedule: Schedule;
  scheduleTime: string;
  status: OperatorStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalProposals: number;
  totalApproved: number;
  totalRejected: number;
  totalAutoExecuted: number;
  createdAt: string;
  // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 강화
  budgetMonthly?: number | null;
  budgetDaily?: number | null;
  budgetAlertThreshold?: number;
  budgetSpentMonth?: number;
  budgetSpentToday?: number;
  // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역
  deliveryPolicy?: 'daily' | 'weekly' | 'monthly';
  verificationRequiredDays?: number;
  verificationPassedDays?: number;
  adminPhoneNumbers?: string[];
  backupAdminPhone?: string | null;
  adminAlertChannel?: 'sms' | 'kakao' | 'email';
  optOutMinutes?: number;
  spamScoreThreshold?: number;
  maxSpamRetries?: number;
}

// ★ D212+ 1+2+3번 (2026-05-23 Harold 명시): AI 학습 영역 요약 응답
interface LearningSummary {
  memory: {
    total: number;
    successPatterns: number;
    customerInsights: number;
    brandToneEvolution: number;
    channelPerformance: number;
    complianceLearning: number;
    lastLearnedAt: string | null;
    avgImportance: number;
  };
  topPatterns: Array<{
    memoryType: string;
    summary: string;
    importance: number;
    usageCount: number;
    updatedAt: string | null;
  }>;
  performance: {
    totalProposals30d: number;
    approvedCount: number;
    rejectedCount: number;
    autoExecutedCount: number;
    avgRecipients: number;
    avgCost: number;
  };
  variantWinner: {
    variantLabel: string;
    ctr: number;
    sent: number;
    clicks: number;
  } | null;
}

interface OperatorProposal {
  id: string;
  operatorId: string;
  proposalJson: any;
  recipientCount: number;
  costEstimate: number;
  status: ProposalStatus;
  autoExecuted: boolean;
  autoExecuteReason: string | null;
  reviewedAt: string | null;
  expiresAt: string;
  createdAt: string;
  operatorName?: string;
  operatorObjective?: string;
}

export default function ContinuousOperatorPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'proposals' | 'operators'>('proposals');
  const [operators, setOperators] = useState<ContinuousOperator[]>([]);
  const [proposals, setProposals] = useState<OperatorProposal[]>([]);
  const [proposalStatus, setProposalStatus] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<ContinuousOperator> | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  // ★ D177 Self-Optimizing Bandit — proposal expand 시점에 variants + recommendation 로드
  const [variantsMap, setVariantsMap] = useState<Record<string, { variants: ProposalVariant[]; recommendation: BanditRecommendation | null }>>({});
  // ★ D179 Multi-Goal Decisioning — 다중 목표 충돌 분석 진입
  const [showMultiGoal, setShowMultiGoal] = useState(false);
  const [multiGoals, setMultiGoals] = useState<MultiGoalInput[]>([
    { name: '', description: '', weight: 0.5 },
    { name: '', description: '', weight: 0.5 },
  ]);
  const [analyzing, setAnalyzing] = useState(false);
  const [multiGoalAnalysis, setMultiGoalAnalysis] = useState<MultiGoalAnalysis | null>(null);

  // ★ D212+ (2026-05-23 Harold 명시): 커스텀 ConfirmModal state + Toast 정합
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const toast = useToast();
  // ★ D212+ 1+2+3번 (2026-05-23 Harold 명시): AI 학습 영역 요약
  const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(null);

  const token = () => localStorage.getItem('token');

  // ★ D177: proposal expand 시점에 variants + Bandit 추천 로드
  const loadVariants = async (proposalId: string) => {
    if (variantsMap[proposalId]) return; // 이미 로드됨
    try {
      const res = await fetch(`/api/ai/operator/proposals/${proposalId}/variants`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setVariantsMap((prev) => ({
          ...prev,
          [proposalId]: { variants: data.variants || [], recommendation: data.recommendation },
        }));
      }
    } catch (e) {
      console.error('variants 로드 실패:', e);
    }
  };

  const toggleExpand = (proposalId: string) => {
    if (expandedProposal === proposalId) {
      setExpandedProposal(null);
    } else {
      setExpandedProposal(proposalId);
      loadVariants(proposalId);
    }
  };

  // ★ D179 Multi-Goal 분석 진입
  const handleMultiGoalAnalyze = async () => {
    const validGoals = multiGoals.filter((g) => g.name.trim().length > 0);
    if (validGoals.length < 2) {
      toast.warning('2개 이상의 목표를 입력해주세요.');
      return;
    }
    setAnalyzing(true);
    setMultiGoalAnalysis(null);
    try {
      const res = await fetch('/api/ai/operator/multi-goal/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ goals: validGoals }),
      });
      const data = await res.json();
      if (data.success) {
        setMultiGoalAnalysis(data.analysis);
        toast.success('충돌 분석이 완료되었습니다.');
      } else {
        toast.error(data.error || '충돌 분석에 실패했습니다.');
      }
    } catch (e: any) {
      toast.error(e?.message || '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const addMultiGoal = () => {
    if (multiGoals.length >= 5) return;
    setMultiGoals([...multiGoals, { name: '', description: '', weight: 0.2 }]);
  };

  const removeMultiGoal = (idx: number) => {
    if (multiGoals.length <= 2) return;
    setMultiGoals(multiGoals.filter((_, i) => i !== idx));
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // ★ D212+ 1+2+3번 (2026-05-23 Harold 명시): learning-summary 영역 fetch 통합
      const [opRes, propRes, learnRes] = await Promise.all([
        fetch('/api/ai/operator/continuous', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`/api/ai/operator/proposals?status=${proposalStatus}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/ai/operator/continuous/learning-summary', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const opData = await opRes.json();
      const propData = await propRes.json();
      const learnData = await learnRes.json();
      if (opData.success) setOperators(opData.operators || []);
      if (propData.success) setProposals(propData.proposals || []);
      if (learnData.success) setLearningSummary(learnData.summary || null);
      if (!opRes.ok && opData.code === 'BETA_GATE') {
        setError('본 기능은 비즈니스 / 엔터프라이즈 요금제 베타에서 이용 가능합니다.');
      }
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [proposalStatus]);

  // ★ D212+ 4번 (2026-05-23 Harold 명시): Predictive 1-click → 자동 마케팅 prefill 자동 처리
  useEffect(() => {
    const raw = sessionStorage.getItem('continuousOperatorPrefill');
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw);
      sessionStorage.removeItem('continuousOperatorPrefill');
      setEditing({
        name: prefill.name || '',
        objective: prefill.objective || '',
        schedule: 'daily',
        scheduleTime: '09:00',
        status: 'active',
      });
      toast.info(`Predictive에서 추천된 액션을 자동 마케팅으로 시작합니다 (대상 ${(prefill.targetCount || 0).toLocaleString()}명).`);
    } catch {
      sessionStorage.removeItem('continuousOperatorPrefill');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!editing?.name?.trim() || !editing?.objective?.trim()) {
      toast.warning('이름과 마케팅 목표는 필수입니다.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = !!editing.id;
      const url = isUpdate ? `/api/ai/operator/continuous/${editing.id}` : '/api/ai/operator/continuous';
      const method = isUpdate ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          name: editing.name,
          objective: editing.objective,
          schedule: editing.schedule || 'daily',
          schedule_time: editing.scheduleTime || '09:00',
          status: editing.status,
          // ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 영역 전달
          budget_monthly: editing.budgetMonthly,
          budget_daily: editing.budgetDaily,
          budget_alert_threshold: editing.budgetAlertThreshold,
          // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역 전달
          delivery_policy: editing.deliveryPolicy || 'daily',
          verification_required_days: editing.verificationRequiredDays ?? 7,
          admin_phone_numbers: editing.adminPhoneNumbers || [],
          backup_admin_phone: editing.backupAdminPhone,
          admin_alert_channel: editing.adminAlertChannel || 'sms',
          opt_out_minutes: editing.optOutMinutes ?? 5,
          spam_score_threshold: editing.spamScoreThreshold ?? 30,
          max_spam_retries: editing.maxSpamRetries ?? 3,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(null);
        toast.success(editing.id ? '자동 마케팅이 수정되었습니다.' : '자동 마케팅이 시작되었습니다.');
        await loadAll();
      } else {
        setError(data.error || '저장 실패');
        toast.error(data.error || '저장에 실패했습니다.');
      }
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
      toast.error(e?.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ★ D212+ (2026-05-23 Harold 명시): native confirm/alert 영구 폐기 — 커스텀 모달 + Toast 정합
  const handleDelete = (id: string) => {
    setConfirmState({
      mode: 'danger',
      title: '자동 마케팅 중지',
      description: '이 자동 마케팅을 보관함으로 이동하시겠습니까?\n매일 새 캠페인 추천이 즉시 중단됩니다.',
      confirmLabel: '중지',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/ai/operator/continuous/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token()}` },
          });
          const data = await res.json();
          if (data.success) {
            toast.success('자동 마케팅이 중지되었습니다.');
            await loadAll();
          } else {
            toast.error(data.error || '중지에 실패했습니다.');
          }
        } catch (e: any) {
          toast.error(e?.message || '중지 중 오류가 발생했습니다.');
        }
      },
    });
  };

  const handleRunNow = (id: string) => {
    setConfirmState({
      mode: 'info',
      title: '지금 즉시 추천 받기',
      description: '예약 시점과 별개로 지금 새 캠페인 추천 1건을 생성합니다.\n생성 완료 후 "오늘 받은 제안" 탭에서 확인할 수 있습니다.',
      confirmLabel: '추천 받기',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/ai/operator/continuous/${id}/run-now`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token()}` },
          });
          const data = await res.json();
          if (data.success) {
            toast.success(data.message || '제안이 생성되었습니다. "오늘 받은 제안" 탭에서 확인해주세요.');
            await loadAll();
          } else {
            toast.error(data.error || '추천 생성에 실패했습니다.');
          }
        } catch (e: any) {
          toast.error(e?.message || '오류가 발생했습니다.');
        }
      },
    });
  };

  const handleApprove = (id: string) => {
    setConfirmState({
      mode: 'default',
      title: '제안 승인',
      description: '이 제안을 승인하시겠습니까?\n승인 후 AI Operator 화면으로 이동하여 발송을 진행할 수 있습니다.',
      confirmLabel: '승인',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/ai/operator/proposals/${id}/approve`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token()}` },
          });
          const data = await res.json();
          if (data.success) {
            const proposal = proposals.find((p) => p.id === id);
            if (proposal?.operatorObjective) {
              sessionStorage.setItem('ai_operator_prefill_objective', proposal.operatorObjective);
              toast.success('승인되었습니다. AI Operator 화면으로 이동합니다.');
              setTimeout(() => navigate('/ai-operator'), 800);
              return;
            }
            toast.success('제안이 승인되었습니다.');
            await loadAll();
          } else {
            toast.error(data.error || '승인에 실패했습니다.');
          }
        } catch (e: any) {
          toast.error(e?.message || '오류가 발생했습니다.');
        }
      },
    });
  };

  const handleReject = (id: string) => {
    setConfirmState({
      mode: 'warning',
      title: '제안 거부',
      description: '이 제안을 거부하시겠습니까?\n거부된 제안은 목록에서 제외됩니다.',
      confirmLabel: '거부',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/ai/operator/proposals/${id}/reject`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token()}` },
          });
          const data = await res.json();
          if (data.success) {
            toast.info('제안이 거부되었습니다.');
            await loadAll();
          } else {
            toast.error(data.error || '거부에 실패했습니다.');
          }
        } catch (e: any) {
          toast.error(e?.message || '오류가 발생했습니다.');
        }
      },
    });
  };

  return (
    // ★ D222+ Phase 2 (2026-05-27): 다크 → 보라 그라데이션 톤 다운 + 시인성 강화
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">AI 자동 마케팅</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">매일 아침 AI가 회사 데이터를 분석해 캠페인을 추천합니다. 확인 후 1-click 발송.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => { setShowMultiGoal(true); setMultiGoalAnalysis(null); }}
              className="text-xs bg-gradient-to-r from-violet-500/40 to-fuchsia-500/40 hover:from-violet-500/60 hover:to-fuchsia-500/60 text-violet-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-violet-400/30"
              title="여러 목표를 동시에 설정할 때 AI가 충돌 (동일 고객 중복 발송 / 시점 겹침 등)을 분석"
            >
              <GitMerge className="w-3.5 h-3.5" />
              여러 목표 동시 분석
            </button>
            <button
              onClick={() => setEditing({ name: '', objective: '', schedule: 'daily', scheduleTime: '09:00', status: 'active' })}
              className="text-xs bg-gradient-to-r from-indigo-500/40 to-violet-500/40 hover:from-indigo-500/60 hover:to-violet-500/60 text-indigo-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-indigo-400/30"
            >
              <Plus className="w-3.5 h-3.5" />
              새 자동 마케팅 만들기
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex gap-1">
          <button
            onClick={() => setTab('proposals')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'proposals' ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-white/50 hover:text-white/80'}`}
          >
            오늘 받은 제안 {proposals.filter((p) => p.status === 'pending').length > 0 && (
              <span className="ml-1.5 bg-rose-500/30 text-rose-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {proposals.filter((p) => p.status === 'pending').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('operators')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'operators' ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-white/50 hover:text-white/80'}`}
          >
            실행 중인 자동 마케팅 ({operators.filter((o) => o.status === 'active').length})
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {/* 안전 정책 안내 */}
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 text-xs text-amber-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>안전 정책:</strong> AI는 매일 회사 데이터를 분석해 캠페인을 추천할 뿐, 발송은 항상 회사 admin 확인 후에만 진행됩니다.
            Enterprise 플랜의 '자동 발송' 옵션은 기본 OFF — 활성화하더라도 1,000건 미만 + 5만원 미만 + 안전 단계 낮음 + 비광고 캠페인일 때만 자동 발송됩니다.
            조건에 맞는 고객이 0명이면 제안이 만들어지지 않습니다.
          </div>
        </div>

        {/* ★ D212+ 1+2+3번 (2026-05-23 Harold 명시): AI 학습 영역 안내 카드 — 회사별 누적 학습 본질 */}
        {learningSummary && learningSummary.memory.total > 0 && (
          <div className="bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-fuchsia-500/10 border border-indigo-400/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-indigo-300" />
              <span className="text-sm font-semibold text-indigo-100">AI 학습 현황 (시간 갈수록 더 똑똑해집니다)</span>
              {learningSummary.memory.lastLearnedAt && (
                <span className="ml-auto text-[10px] text-white/40">
                  마지막 학습 {new Date(learningSummary.memory.lastLearnedAt).toLocaleDateString('ko-KR')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="p-2.5 bg-white/5 rounded-lg">
                <div className="text-[10px] text-white/40">학습 누적</div>
                <div className="text-base font-bold font-mono text-indigo-200">{learningSummary.memory.total}건</div>
              </div>
              <div className="p-2.5 bg-white/5 rounded-lg">
                <div className="text-[10px] text-white/40">성공 패턴</div>
                <div className="text-base font-bold font-mono text-emerald-200">{learningSummary.memory.successPatterns}건</div>
              </div>
              <div className="p-2.5 bg-white/5 rounded-lg">
                <div className="text-[10px] text-white/40">30일 제안</div>
                <div className="text-base font-bold font-mono text-cyan-200">{learningSummary.performance.totalProposals30d}건</div>
              </div>
              <div className="p-2.5 bg-white/5 rounded-lg">
                <div className="text-[10px] text-white/40">승인률</div>
                <div className="text-base font-bold font-mono text-amber-200">
                  {learningSummary.performance.totalProposals30d > 0
                    ? `${Math.round((learningSummary.performance.approvedCount / learningSummary.performance.totalProposals30d) * 100)}%`
                    : '-'}
                </div>
              </div>
            </div>
            {/* 기존 winner variant */}
            {learningSummary.variantWinner && learningSummary.variantWinner.sent > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-white/70 p-2 bg-violet-500/10 border border-violet-400/20 rounded-lg mb-2">
                <Sparkles className="w-3 h-3 text-violet-300 flex-shrink-0" />
                <span>
                  지난 14일 가장 효과 좋은 변형 = <span className="font-semibold text-violet-200">Variant {learningSummary.variantWinner.variantLabel}</span>
                  <span className="text-white/40"> (클릭률 {(learningSummary.variantWinner.ctr * 100).toFixed(1)}% · 발송 {learningSummary.variantWinner.sent}건)</span>
                </span>
              </div>
            )}
            {/* 최고 성과 패턴 3건 */}
            {learningSummary.topPatterns.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-white/40 font-semibold mb-1">최고 성과 학습 패턴 (AI가 매일 활용)</div>
                {learningSummary.topPatterns.slice(0, 3).map((p, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-[11px] text-white/70 pl-2 border-l-2 border-indigo-400/30">
                    <span className="flex-1 leading-relaxed">{p.summary}</span>
                    <span className="text-[10px] text-amber-300/70 font-mono flex-shrink-0">{p.usageCount}회 활용</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex justify-center text-white/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {/* 탭 1: 대기 제안서 */}
        {!loading && tab === 'proposals' && (
          <>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-white/50">상태:</span>
              <select
                value={proposalStatus}
                onChange={(e) => setProposalStatus(e.target.value as any)}
                className="text-xs px-2 py-1 bg-violet-900/40 border border-white/10 rounded text-white focus:outline-none focus:border-violet-400/50"
              >
                <option value="pending">대기 중</option>
                <option value="all">전체 보기</option>
              </select>
            </div>

            {proposals.length === 0 ? (
              operators.filter((o) => o.status === 'active').length === 0 ? (
                /* ★ D212+ (2026-05-23 Harold 명시): 첫 진입 가이드 — 마케팅팀 친화 본질 */
                <div className="bg-gradient-to-br from-indigo-500/10 via-violet-500/5 to-fuchsia-500/10 border border-indigo-400/30 rounded-2xl p-6 md:p-8">
                  <div className="text-center mb-6">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <Brain className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-base md:text-lg font-semibold text-white mb-1">자동 마케팅을 시작해보세요</h3>
                    <p className="text-xs md:text-sm text-white/60">매일 아침 AI가 회사 데이터를 분석해 새 캠페인을 추천합니다</p>
                  </div>
                  {/* 3 step 안내 */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                    {[
                      { num: 1, title: '목표 입력', desc: '마케팅 목표를 자연어 한 줄로' },
                      { num: 2, title: '매일 추천 받기', desc: '아침 9시 AI가 새 캠페인 제안' },
                      { num: 3, title: '확인 후 발송', desc: '1-click 승인 → 즉시 발송' },
                    ].map((s) => (
                      <div key={s.num} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-6 h-6 rounded-lg bg-indigo-500/30 text-indigo-200 text-xs font-bold flex items-center justify-center">{s.num}</div>
                          <div className="text-sm font-semibold text-white">{s.title}</div>
                        </div>
                        <div className="text-[11px] text-white/60 leading-relaxed pl-8">{s.desc}</div>
                      </div>
                    ))}
                  </div>
                  {/* 예시 영역 */}
                  <div className="mb-5">
                    <div className="text-[11px] text-white/40 mb-2 font-medium">예시 목표</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {[
                        { label: 'VIP 재구매 유도', desc: 'VIP 등급 고객 90일 안 재구매 캠페인' },
                        { label: '휴면 회복', desc: '60일 미구매 고객 복귀 유도 캠페인' },
                        { label: '생일 축하', desc: 'D-7 사전 + 당일 축하 + 혜택 안내' },
                      ].map((ex) => (
                        <button
                          key={ex.label}
                          onClick={() => setEditing({ name: ex.label, objective: ex.desc, schedule: 'daily', scheduleTime: '09:00', status: 'active' })}
                          className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-400/30 rounded-lg text-left transition-all"
                        >
                          <div className="text-xs font-semibold text-white mb-0.5">{ex.label}</div>
                          <div className="text-[10px] text-white/50">{ex.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 큰 시작 버튼 */}
                  <button
                    onClick={() => setEditing({ name: '', objective: '', schedule: 'daily', scheduleTime: '09:00', status: 'active' })}
                    className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500/40 to-violet-500/40 hover:from-indigo-500/60 hover:to-violet-500/60 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border border-indigo-400/30 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    새 자동 마케팅 만들기
                  </button>
                </div>
              ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
                  {proposalStatus === 'pending' ? '오늘 받은 제안이 없습니다.' : '제안이 없습니다.'}
                  <br />
                  <span className="text-xs text-white/40 mt-2 block">자동 마케팅이 활성 상태입니다. 매일 정해진 시간에 AI가 새 캠페인을 추천해드립니다.</span>
                </div>
              )
            ) : (
              proposals.map((p) => {
                const expanded = expandedProposal === p.id;
                const target = p.proposalJson?.target;
                const channel = p.proposalJson?.channel;
                const messages = p.proposalJson?.messages || [];
                const performance = p.proposalJson?.performance;
                return (
                  <div key={p.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-4 h-4 text-indigo-300" />
                            <div className="text-sm font-bold text-white">{p.operatorName || '(Operator)'}</div>
                            <StatusBadge status={p.status} />
                            {p.autoExecuted && (
                              <span className="text-[10px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                <Zap className="w-2.5 h-2.5" /> 자동 실행
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-white/50 mb-2">목표: "{p.operatorObjective}"</div>
                          <div className="flex flex-wrap gap-3 text-xs text-white/70">
                            <span>대상 <strong className="text-indigo-300">{p.recipientCount.toLocaleString()}명</strong></span>
                            <span>·</span>
                            <span>비용 <strong>{p.costEstimate.toLocaleString()}원</strong></span>
                            <span>·</span>
                            <span>채널 <strong>{channel?.recommended || 'SMS'}</strong></span>
                            <span>·</span>
                            <span>생성 {new Date(p.createdAt).toLocaleString('ko-KR')}</span>
                            <span>·</span>
                            <span>만료 {new Date(p.expiresAt).toLocaleDateString('ko-KR')}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {p.status === 'pending' && (
                            <>
                              <button onClick={() => handleApprove(p.id)} className="text-xs bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 px-3 py-1.5 rounded flex items-center gap-1">
                                <Check className="w-3 h-3" /> 승인 + 발송
                              </button>
                              <button onClick={() => handleReject(p.id)} className="text-xs bg-white/5 border border-rose-400/30 hover:bg-rose-500/20 text-rose-300 px-3 py-1.5 rounded flex items-center gap-1">
                                <X className="w-3 h-3" /> 거부
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => toggleExpand(p.id)}
                            className="text-xs text-white/50 hover:bg-white/5 px-3 py-1.5 rounded flex items-center gap-1"
                          >
                            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            상세
                          </button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t bg-white/5 px-5 py-4 space-y-3 text-xs">
                        {target && (
                          <div>
                            <div className="font-bold text-white/80 mb-1">타겟 분석</div>
                            <div className="text-white/70">
                              {target.criteria || '(기준 미설정)'}
                              <span className="text-white/40 ml-2">— 매칭 {target.count?.toLocaleString()} / 전체 {target.totalCount?.toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                        {messages.length > 0 && (
                          <div>
                            <div className="font-bold text-white/80 mb-1">메시지 ({messages.length}안)</div>
                            <div className="space-y-1.5">
                              {messages.slice(0, 3).map((m: any, i: number) => {
                                const variantData = variantsMap[p.id]?.variants?.[i];
                                const recommendation = variantsMap[p.id]?.recommendation;
                                const isBanditRecommended = recommendation?.variantIndex === i;
                                return (
                                  <div key={i} className={`border rounded p-2 ${isBanditRecommended ? 'bg-indigo-500/15 border-indigo-400/40' : 'bg-white/5 border-white/10'}`}>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-white/80">{m.variantName || `Variant ${i + 1}`}</span>
                                      <span className="text-[10px] text-white/50">· {m.byteCount}byte</span>
                                      {isBanditRecommended && (
                                        <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                          <Target className="w-2.5 h-2.5" /> Bandit 추천
                                        </span>
                                      )}
                                      {variantData && (
                                        <span className="text-[10px] text-white/50">
                                          발송 {variantData.sentCount} · 클릭 {variantData.clickCount} · 전환 {variantData.conversionCount}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-white/70 whitespace-pre-wrap mt-1">{m.body}</div>
                                  </div>
                                );
                              })}
                            </div>
                            {/* D177 Bandit 추천 사유 표시 */}
                            {variantsMap[p.id]?.recommendation && (
                              <div className="mt-2 bg-indigo-500/10 border border-indigo-400/30 rounded p-2 text-indigo-200 text-[11px] flex items-start gap-1.5">
                                <Target className="w-3 h-3 mt-0.5 shrink-0" />
                                <div>
                                  <strong>Self-Optimizing 추천:</strong> {variantsMap[p.id].recommendation!.reasoning}
                                  <div className="text-indigo-200 mt-0.5">★ 안전 정책 — AI 추천은 참고만, 발송은 회사 admin이 선택한 변형으로 진행됩니다.</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {performance && (
                          <div>
                            <div className="font-bold text-white/80 mb-1">예상 성과</div>
                            <div className="text-white/70">
                              클릭률 {(performance.clickRate * 100).toFixed(1)}% · 전환율 {(performance.conversionRate * 100).toFixed(2)}% · 매출 {performance.expectedRevenue?.toLocaleString()}원
                            </div>
                          </div>
                        )}
                        {p.autoExecuteReason && (
                          <div className="bg-violet-500/15 border border-violet-400/30 rounded p-2 text-violet-200">
                            <strong>자동 실행 판정:</strong> {p.autoExecuteReason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* 탭 2: 자동 마케팅 목록 */}
        {!loading && tab === 'operators' && (
          <>
            {operators.length === 0 ? (
              <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
                실행 중인 자동 마케팅이 없습니다.
                <br />
                <span className="text-xs text-white/40 mt-2 block">마케팅 목표를 한 줄로 입력하면 AI가 매일 새 캠페인을 추천해드립니다.</span>
                <button
                  onClick={() => setEditing({ name: '', objective: '', schedule: 'daily', scheduleTime: '09:00', status: 'active' })}
                  className="mt-4 px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-50 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-indigo-400/30 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  새 자동 마케팅 만들기
                </button>
              </div>
            ) : (
              operators.map((op) => {
                // ★ D212+ 5번 (2026-05-23 Harold 명시): 예산 영역 사용률 계산
                const monthSpent = op.budgetSpentMonth || 0;
                const monthBudget = op.budgetMonthly || 0;
                const monthPct = monthBudget > 0 ? (monthSpent / monthBudget) * 100 : 0;
                const alertThreshold = op.budgetAlertThreshold || 80;
                const isMonthAlert = monthBudget > 0 && monthPct >= alertThreshold;
                const isMonthOver = monthBudget > 0 && monthPct >= 100;
                return (
                  <div key={op.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-base font-bold text-white">{op.name}</div>
                          <StatusBadge status={op.status} />
                        </div>
                        <div className="text-sm text-white/70 mb-2">"{op.objective}"</div>
                        <div className="flex flex-wrap gap-3 text-xs text-white/50">
                          <span><Clock className="w-3 h-3 inline" /> {op.schedule} {op.scheduleTime} (KST)</span>
                          <span>·</span>
                          <span>다음 실행 {op.nextRunAt ? new Date(op.nextRunAt).toLocaleString('ko-KR') : '-'}</span>
                          <span>·</span>
                          <span>제안 {op.totalProposals}건 (승인 {op.totalApproved} / 거부 {op.totalRejected} / 자동 {op.totalAutoExecuted})</span>
                        </div>
                        {/* ★ D212+ 정책 (2026-05-23 Harold 명시): 검증 영역 상태 표시 (daily 영역만) */}
                        {(op.deliveryPolicy === 'daily' || !op.deliveryPolicy) && (op.verificationRequiredDays ?? 7) > 0 && (op.verificationPassedDays ?? 0) < (op.verificationRequiredDays ?? 7) && (
                          <div className="mt-3 p-2.5 bg-amber-500/10 border border-amber-400/30 rounded-lg">
                            <div className="flex items-center justify-between text-[11px] mb-1.5">
                              <span className="text-amber-200 font-semibold flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> 검증 영역 안 (회사 admin 명시 컨펌 의무)
                              </span>
                              <span className="text-amber-100 font-mono">
                                {op.verificationPassedDays ?? 0} / {op.verificationRequiredDays ?? 7}일
                              </span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-400"
                                style={{ width: `${Math.min(100, ((op.verificationPassedDays ?? 0) / (op.verificationRequiredDays ?? 7)) * 100)}%` }}
                              />
                            </div>
                            <div className="mt-1.5 text-[10px] text-amber-100/70">
                              매일 제안 영역 = "오늘 받은 제안" 탭 영역 안 명시 컨펌 의무. 검증 통과 시 자동 발송 전환 본질.
                            </div>
                          </div>
                        )}
                        {(op.deliveryPolicy === 'daily' || !op.deliveryPolicy) && (op.verificationPassedDays ?? 0) >= (op.verificationRequiredDays ?? 7) && (op.verificationRequiredDays ?? 7) > 0 && (
                          <div className="mt-3 p-2 bg-emerald-500/10 border border-emerald-400/30 rounded-lg flex items-center gap-2 text-[11px]">
                            <Check className="w-3 h-3 text-emerald-300" />
                            <span className="text-emerald-200">검증 영역 통과 ({op.verificationPassedDays}일+) — 매일 자동 발송 진행</span>
                          </div>
                        )}
                        {op.deliveryPolicy && op.deliveryPolicy !== 'daily' && (
                          <div className="mt-3 p-2 bg-cyan-500/10 border border-cyan-400/30 rounded-lg flex items-center gap-2 text-[11px]">
                            <Clock className="w-3 h-3 text-cyan-300" />
                            <span className="text-cyan-200">
                              {op.deliveryPolicy === 'weekly' ? '매주' : '매달'} 발송 — 발송 {op.optOutMinutes ?? 5}분 전 담당자 안내 → 정지 X 시 자동 발송
                            </span>
                          </div>
                        )}

                        {/* ★ D212+ 5번 (2026-05-23 Harold 명시): 예산 영역 시각화 */}
                        {monthBudget > 0 && (
                          <div className="mt-3 p-2.5 bg-violet-900/30 border border-white/10 rounded-lg">
                            <div className="flex items-center justify-between text-[11px] mb-1.5">
                              <span className={isMonthOver ? 'text-rose-300 font-semibold' : isMonthAlert ? 'text-amber-300 font-semibold' : 'text-white/60'}>
                                이번 달 예산 사용
                              </span>
                              <span className="text-white/70 font-mono">
                                {monthSpent.toLocaleString()}원 / {monthBudget.toLocaleString()}원 ({monthPct.toFixed(0)}%)
                              </span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${isMonthOver ? 'bg-rose-400' : isMonthAlert ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                style={{ width: `${Math.min(100, monthPct)}%` }}
                              />
                            </div>
                            {isMonthOver && (
                              <div className="mt-1.5 text-[10px] text-rose-300 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" /> 월 예산 초과 — 새 제안 생성 자동 차단
                              </div>
                            )}
                            {!isMonthOver && isMonthAlert && (
                              <div className="mt-1.5 text-[10px] text-amber-300 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" /> 알림 임계값 {alertThreshold}% 도달
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <button onClick={() => handleRunNow(op.id)} className="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 px-2 py-1 rounded flex items-center gap-1 border border-indigo-400/30">
                          <Play className="w-3 h-3" /> 지금 실행
                        </button>
                        <button onClick={() => setEditing(op)} className="text-xs text-white/70 hover:bg-white/10 px-2 py-1 rounded flex items-center gap-1 border border-white/10">
                          <Edit2 className="w-3 h-3" /> 수정
                        </button>
                        <button onClick={() => handleDelete(op.id)} className="text-xs text-rose-300 hover:bg-rose-500/20 px-2 py-1 rounded flex items-center gap-1 border border-rose-400/30">
                          <Trash2 className="w-3 h-3" /> 중단
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* ★ D179 Multi-Goal 분석 모달 */}
      {showMultiGoal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowMultiGoal(false)}>
          <div className="bg-violet-900/40 border border-violet-400/30 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 영역 sticky */}
            <div className="flex items-center gap-3 p-5 border-b border-white/10 flex-shrink-0">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                <GitMerge className="w-5 h-5 text-violet-300" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-white">여러 목표 동시 분석</h3>
                <p className="text-[11px] text-white/50 mt-0.5">2~5개 목표를 한번에 입력 — AI가 충돌 (중복 발송 / 시점 겹침) 분석</p>
              </div>
              <button onClick={() => setShowMultiGoal(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
            <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 mb-4 text-xs text-amber-100 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>안전 정책:</strong> 여러 목표를 동시에 설정하면 AI가 충돌 영역 (동일 고객 중복 발송 / 메시지 중복 / 시점 겹침) 을 분석 + 회사 admin 검토 후 자동 마케팅 등록.
                실행은 사용자 승인 후에만 진행됩니다.
              </div>
            </div>

            {!multiGoalAnalysis && (
              <>
                <div className="space-y-3 mb-4">
                  {multiGoals.map((g, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-white/5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-white/80">목표 {idx + 1}</span>
                        {multiGoals.length > 2 && (
                          <button onClick={() => removeMultiGoal(idx)} className="text-rose-300 hover:text-rose-200 text-xs ml-auto">
                            제거
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <input
                          type="text"
                          value={g.name}
                          onChange={(e) => {
                            const next = [...multiGoals];
                            next[idx] = { ...next[idx], name: e.target.value };
                            setMultiGoals(next);
                          }}
                          placeholder="예: VIP 재구매"
                          className="px-3 py-2 bg-violet-900/40 border border-white/10 rounded text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                          maxLength={100}
                        />
                        <div>
                          <label className="text-[10px] text-white/50 block">가중치 (0~1, 합 자동 정규화)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="1"
                            value={g.weight}
                            onChange={(e) => {
                              const next = [...multiGoals];
                              next[idx] = { ...next[idx], weight: parseFloat(e.target.value) || 0 };
                              setMultiGoals(next);
                            }}
                            className="px-3 py-2 bg-violet-900/40 border border-white/10 rounded text-sm text-white placeholder-white/30 w-full focus:outline-none focus:border-violet-400/50"
                          />
                        </div>
                      </div>
                      <textarea
                        value={g.description || ''}
                        onChange={(e) => {
                          const next = [...multiGoals];
                          next[idx] = { ...next[idx], description: e.target.value };
                          setMultiGoals(next);
                        }}
                        placeholder="자연어 상세 (선택) — 예: VIP 등급 + 최근 30일 미구매 고객"
                        className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded text-xs text-white placeholder-white/30 resize-none h-16 focus:outline-none focus:border-violet-400/50"
                        maxLength={500}
                      />
                    </div>
                  ))}
                  {multiGoals.length < 5 && (
                    <button
                      onClick={addMultiGoal}
                      className="w-full py-2 border-2 border-dashed border-white/20 hover:border-violet-400 hover:bg-violet-500/10 text-xs text-white/70 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" /> 목표 추가 (최대 5건)
                    </button>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-2 border-t">
                  <button onClick={() => setShowMultiGoal(false)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors">취소</button>
                  <button
                    onClick={handleMultiGoalAnalyze}
                    disabled={analyzing}
                    className="px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 text-sm rounded-lg disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {analyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 분석 중...</> : <><Sparkles className="w-3.5 h-3.5" /> 충돌 분석 시작</>}
                  </button>
                </div>
              </>
            )}

            {/* 분석 결과 */}
            {multiGoalAnalysis && (
              <>
                <div className="bg-violet-500/10 border border-violet-400/30 rounded-lg p-4 mb-4">
                  <div className="text-xs font-bold text-violet-200 mb-1">통합 전략</div>
                  <div className="text-sm text-violet-100/80 whitespace-pre-wrap leading-relaxed">{multiGoalAnalysis.overallStrategy}</div>
                </div>

                <div className="mb-4">
                  <div className="text-xs font-bold text-white/80 mb-2">추천 순서 (Recommended Order)</div>
                  <div className="flex flex-wrap gap-2">
                    {multiGoalAnalysis.recommendedOrder.map((name, idx) => (
                      <div key={idx} className="bg-white/5 border border-violet-400/40 rounded-full px-3 py-1 text-xs flex items-center gap-1.5">
                        <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                        {name}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-4 space-y-2">
                  <div className="text-xs font-bold text-white/80">목표별 sub-plan</div>
                  {multiGoalAnalysis.subPlans.map((sp, idx) => (
                    <div key={idx} className={`border rounded-lg p-3 ${sp.shouldExecute ? 'bg-white/5 border-white/10' : 'bg-rose-500/10 border-rose-400/30'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{sp.priority}</span>
                        <span className="text-sm font-bold text-white">{sp.goalName}</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-1.5 py-0.5 rounded-full">{sp.channelRecommended}</span>
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.5 rounded-full">{sp.timingRecommended}</span>
                        {!sp.shouldExecute && <span className="text-[10px] bg-rose-500/30 text-rose-200 px-1.5 py-0.5 rounded-full">실행 제외</span>}
                      </div>
                      <div className="text-xs text-white/70 mb-1">{sp.targetCriteria}</div>
                      {sp.conflicts.length > 0 && (
                        <div className="text-[11px] text-amber-300 mt-1.5">
                          <strong>충돌:</strong> {sp.conflicts.join(' / ')}
                        </div>
                      )}
                      <div className="text-[11px] text-white/50 mt-1">{sp.reasoning}</div>
                    </div>
                  ))}
                </div>

                {multiGoalAnalysis.conflictMatrix && (
                  <details className="mb-4">
                    <summary className="text-xs font-bold text-white/80 cursor-pointer">충돌 분석 상세 (markdown)</summary>
                    <pre className="bg-white/5 border border-white/10 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap mt-2 text-white/70">{multiGoalAnalysis.conflictMatrix}</pre>
                  </details>
                )}

                <div className="flex gap-2 justify-end pt-3 border-t border-white/10">
                  <button onClick={() => { setMultiGoalAnalysis(null); }} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors">다시 분석</button>
                  <button onClick={() => setShowMultiGoal(false)} className="px-4 py-2 bg-violet-500/30 hover:bg-violet-500/50 text-violet-100 text-sm rounded-lg">확인</button>
                </div>
              </>
            )}
            </div>
          </div>
        </div>
      )}

      {/* 편집 모달 — D212+ 시인성 강화 (다크 톤 + 헤더 sticky + 명확한 input 영역) */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-violet-900/40 border border-indigo-400/30 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 영역 */}
            <div className="flex items-center gap-3 p-5 border-b border-white/10 flex-shrink-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <Brain className="w-5 h-5 text-indigo-300" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-white">{editing.id ? '자동 마케팅 수정' : '새 자동 마케팅 만들기'}</h3>
                <p className="text-[11px] text-white/50 mt-0.5">목표 입력 → 매일 정해진 시간에 AI가 새 캠페인을 추천합니다</p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            {/* 본문 영역 */}
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="text-xs font-medium text-white/70 block mb-1.5">이름 <span className="text-rose-400">*</span></label>
                <input
                  type="text"
                  value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 transition-colors"
                  placeholder="예: VIP 재구매 자동 마케팅"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/70 block mb-1.5">
                  마케팅 목표 (자연어) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={editing.objective || ''}
                  onChange={(e) => setEditing({ ...editing, objective: e.target.value })}
                  className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-none h-24 focus:outline-none focus:border-indigo-400/50 transition-colors"
                  placeholder="예: VIP 등급 고객 중 최근 30일 미구매 고객에게 재구매 유도 메시지를 매일 추천"
                  maxLength={500}
                />
                <div className="text-[10px] text-white/40 mt-1">AI가 이해할 수 있도록 구체적으로 작성해주세요 (대상 + 목적 + 시점)</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-white/70 block mb-1.5">추천 주기</label>
                  <select
                    value={editing.schedule || 'daily'}
                    onChange={(e) => setEditing({ ...editing, schedule: e.target.value as Schedule })}
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                  >
                    <option value="daily">매일</option>
                    <option value="weekly">매주</option>
                    <option value="monthly">매월</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-white/70 block mb-1.5">추천 시각 (한국 시간)</label>
                  <input
                    type="time"
                    value={editing.scheduleTime || '09:00'}
                    onChange={(e) => setEditing({ ...editing, scheduleTime: e.target.value })}
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                  />
                </div>
              </div>
              {editing.id && (
                <div>
                  <label className="text-xs font-medium text-white/70 block mb-1.5">상태</label>
                  <select
                    value={editing.status || 'active'}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as OperatorStatus })}
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                  >
                    <option value="active">활성 (매일 새 캠페인 추천)</option>
                    <option value="paused">일시 중지 (추천 멈춤)</option>
                  </select>
                </div>
              )}

              {/* ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 카드 — 매일/매주/매달 + 검증 + 담당자 옵트아웃 */}
              <div className="p-3 bg-indigo-500/5 border border-indigo-400/30 rounded-lg space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
                  <Brain className="w-3.5 h-3.5" />
                  발송 정책 (안전 영역)
                </div>
                <div>
                  <label className="text-[11px] text-white/60 block mb-1">발송 주기</label>
                  <select
                    value={editing.deliveryPolicy || 'daily'}
                    onChange={(e) => setEditing({ ...editing, deliveryPolicy: e.target.value as 'daily' | 'weekly' | 'monthly' })}
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                  >
                    <option value="daily">매일 — 옵트아웃 본질 (최초 N일 검증 후 자동)</option>
                    <option value="weekly">매주 — 발송 2시간 전 담당자 안내 (5분 옵트아웃)</option>
                    <option value="monthly">매달 — 발송 2시간 전 담당자 안내 (5분 옵트아웃)</option>
                  </select>
                </div>
                {editing.deliveryPolicy === 'daily' && (
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">검증 기간 (일)</label>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={editing.verificationRequiredDays ?? 7}
                      onChange={(e) => setEditing({ ...editing, verificationRequiredDays: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                    />
                    <div className="text-[10px] text-white/40 mt-1">처음 N일 = 회사 admin 매일 명시 컨펌 → N일 통과 후 자동 (기본 7일)</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">담당자 연락처 (쉼표 구분, 최대 3명)</label>
                    <input
                      type="text"
                      value={(editing.adminPhoneNumbers || []).join(', ')}
                      onChange={(e) => setEditing({
                        ...editing,
                        adminPhoneNumbers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
                      })}
                      placeholder="예: 01012345678, 01098765432"
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">백업 담당자 (휴가 영역)</label>
                    <input
                      type="text"
                      value={editing.backupAdminPhone ?? ''}
                      onChange={(e) => setEditing({ ...editing, backupAdminPhone: e.target.value.trim() || null })}
                      placeholder="예: 01087654321"
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 transition-colors"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">담당자 알림 채널</label>
                    <select
                      value={editing.adminAlertChannel || 'sms'}
                      onChange={(e) => setEditing({ ...editing, adminAlertChannel: e.target.value as 'sms' | 'kakao' | 'email' })}
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                    >
                      <option value="sms">SMS</option>
                      <option value="kakao">카카오 알림톡</option>
                      <option value="email">이메일</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">옵트아웃 시간 (분)</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={editing.optOutMinutes ?? 5}
                      onChange={(e) => setEditing({ ...editing, optOutMinutes: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-400/50 transition-colors"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-indigo-200/70 leading-relaxed">
                  매주/매달 영역 = 발송 N분 전 담당자 안내 → 정지 X = 자동 발송 본질. 모든 발송 = 스팸필터테스트 통과 영역만.
                </div>
              </div>

              {/* ★ D212+ 5번 (2026-05-23 Harold 명시): 비용 제어 영역 — 월 예산 + 일별 한도 + 알림 임계값 */}
              <div className="p-3 bg-emerald-500/5 border border-emerald-400/30 rounded-lg space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
                  <Zap className="w-3.5 h-3.5" />
                  비용 제어 (선택 — 비워두면 무제한)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">월 예산 (원)</label>
                    <input
                      type="number"
                      min="0"
                      step="10000"
                      value={editing.budgetMonthly ?? ''}
                      onChange={(e) => setEditing({ ...editing, budgetMonthly: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="예: 500000"
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-white/60 block mb-1">일별 한도 (원)</label>
                    <input
                      type="number"
                      min="0"
                      step="5000"
                      value={editing.budgetDaily ?? ''}
                      onChange={(e) => setEditing({ ...editing, budgetDaily: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="예: 50000"
                      className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-white/60 block mb-1">알림 임계값 (%)</label>
                  <input
                    type="number"
                    min="50"
                    max="100"
                    step="5"
                    value={editing.budgetAlertThreshold ?? 80}
                    onChange={(e) => setEditing({ ...editing, budgetAlertThreshold: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-400/50 transition-colors"
                  />
                  <div className="text-[10px] text-white/40 mt-1">예산 사용률이 임계값에 도달하면 자동 알림 (기본 80%)</div>
                </div>
                <div className="text-[10px] text-emerald-200/70 leading-relaxed">
                  예산 초과 시 새 제안 생성이 자동 차단됩니다. 회사 admin 신뢰 본질입니다.
                </div>
              </div>

              <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 text-xs text-amber-100 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="leading-relaxed">
                  <strong>안내:</strong> AI가 위 시각에 매일/매주/매월 새 캠페인을 추천합니다. 발송은 회사 admin 확인 후에만 진행됩니다. 7일 안에 확인하지 않으면 자동 만료됩니다.
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>{error}</div>
                </div>
              )}
            </div>

            {/* 액션 영역 sticky 하단 */}
            <div className="flex items-center gap-2 p-5 border-t border-white/10 bg-violet-900/30 flex-shrink-0">
              <button onClick={() => setEditing(null)} className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 rounded-lg text-sm font-medium transition-colors">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editing.name?.trim() || !editing.objective?.trim()}
                className="flex-1 px-4 py-2 bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-30 disabled:cursor-not-allowed text-indigo-50 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {saving ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 저장 중</>
                ) : editing.id ? (
                  <>수정 저장</>
                ) : (
                  <><Plus className="w-3.5 h-3.5" /> 자동 마케팅 시작</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D212+ (2026-05-23 Harold 명시): 커스텀 ConfirmModal — native confirm 영구 폐기 정합 */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: '활성', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
    paused: { label: '일시중지', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
    archived: { label: '보관', cls: 'bg-white/10 text-white/50' },
    pending: { label: '승인 대기', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
    approved: { label: '승인됨', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
    rejected: { label: '거부됨', cls: 'bg-white/10 text-white/50' },
    auto_executed: { label: '자동 실행됨', cls: 'bg-violet-500/20 text-violet-300' },
    expired: { label: '만료됨', cls: 'bg-rose-500/20 text-rose-300 border border-rose-400/30' },
  };
  const e = map[status] || { label: status, cls: 'bg-white/10 text-white/70' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
