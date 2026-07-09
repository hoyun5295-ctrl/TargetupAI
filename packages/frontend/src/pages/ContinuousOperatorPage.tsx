// AI 자동 마케팅 (Continuous Operator) — 재설계 (2026-06-27)
// 메인 = 런처(시작 방법 2×2 + 브리핑). 각 버튼이 화면을 연다.
//   오늘의 추천(의사결정 카드·버리는 데이터 0) / 자연어 시작 / 시나리오 시작 / 세부설정.
// 다크 slate 톤 + 단일 인디고 액센트. native dialog 0(ConfirmModal·useToast). 모델명 0.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Brain, RefreshCw, GitMerge, Loader2, Sparkles } from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
import {
  ContinuousOperator, OperatorProposal, ProposalVariant, BanditRecommendation,
  LearningSummary, AutoMarketingView, ProposalApproveSelection,
} from '../components/automarketing/types';
import AutoMarketingLauncher from '../components/automarketing/AutoMarketingLauncher';
import ProposalDecisionCard from '../components/automarketing/ProposalDecisionCard';
import NaturalLanguageStart from '../components/automarketing/NaturalLanguageStart';
import ScenarioStart, { ScenarioPick } from '../components/automarketing/ScenarioStart';
import OperatorSetupModal from '../components/automarketing/OperatorSetupModal';
import MultiGoalModal from '../components/automarketing/MultiGoalModal';
import OperatorsManageList from '../components/automarketing/OperatorsManageList';
import DailyBriefCard, { DailyBrief, DailyBriefRecommendation } from '../components/automarketing/DailyBriefCard';

const VIEW_TITLE: Record<AutoMarketingView, string> = {
  launcher: 'AI 자동 마케팅',
  recommendations: '오늘의 추천 마케팅',
  natural: '자연어로 시작',
  scenario: '시나리오로 시작',
  operators: '실행 중인 자동 마케팅',
};

const SMART_DEFAULTS: Partial<ContinuousOperator> = {
  schedule: 'daily', scheduleTime: '09:00', status: 'active', channel: 'lms', deliveryPolicy: 'daily',
};

export default function ContinuousOperatorPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [view, setView] = useState<AutoMarketingView>('launcher');
  const [operators, setOperators] = useState<ContinuousOperator[]>([]);
  const [proposals, setProposals] = useState<OperatorProposal[]>([]);
  const [proposalStatus, setProposalStatus] = useState<'pending' | 'all'>('pending');
  const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(null);
  const [dailyBrief, setDailyBrief] = useState<DailyBrief | null>(null);
  const [variantsMap, setVariantsMap] = useState<Record<string, { variants: ProposalVariant[]; recommendation: BanditRecommendation | null }>>({});
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<ContinuousOperator> | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showMultiGoal, setShowMultiGoal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<Partial<ContinuousOperator> | null>(null);

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  const pendingCount = proposals.filter((p) => p.status === 'pending' || p.status === 'admin_review').length;
  const activeCount = operators.filter((o) => o.status === 'active').length;
  const featuredId = proposals.find((p) => p.status === 'pending' || p.status === 'admin_review')?.id;

  // ── 데이터 ──
  const loadVariants = async (proposalId: string) => {
    if (variantsMap[proposalId]) return;
    try {
      const res = await fetch(`/api/ai/operator/proposals/${proposalId}/variants`, { headers: auth() });
      const data = await res.json();
      if (data.success) setVariantsMap((prev) => ({ ...prev, [proposalId]: { variants: data.variants || [], recommendation: data.recommendation } }));
    } catch (e) {
      console.error('variants 로드 실패:', e);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [opRes, propRes, learnRes, briefRes] = await Promise.all([
        fetch('/api/ai/operator/continuous', { headers: auth() }),
        fetch(`/api/ai/operator/proposals?status=${proposalStatus}`, { headers: auth() }),
        fetch('/api/ai/operator/continuous/learning-summary', { headers: auth() }),
        fetch('/api/ai/operator/daily-brief', { headers: auth() }),
      ]);
      const opData = await opRes.json();
      const propData = await propRes.json();
      const learnData = await learnRes.json();
      const briefData = await briefRes.json().catch(() => ({ success: false }));
      if (opData.success) setOperators(opData.operators || []);
      if (propData.success) setProposals(propData.proposals || []);
      if (learnData.success) setLearningSummary(learnData.summary || null);
      // 브리핑은 부가 정보 — 미생성(503)·오류 시 조용히 숨김
      if (briefData.success) setDailyBrief(briefData.brief || null);
      if (!opRes.ok && opData.code === 'BETA_GATE') setError('본 기능은 요금제 가입 후 이용 가능합니다.');
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [proposalStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // 추천 화면 진입 시 featured 제안의 변형(Bandit) 자동 로드
  useEffect(() => { if (featuredId) loadVariants(featuredId); }, [featuredId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Predictive 1-click → 세부설정 prefill (sessionStorage)
  useEffect(() => {
    const raw = sessionStorage.getItem('continuousOperatorPrefill');
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw);
      sessionStorage.removeItem('continuousOperatorPrefill');
      setEditing({ ...SMART_DEFAULTS, name: prefill.name || '', objective: prefill.objective || '' });
      toast.info(`Predictive에서 추천된 액션을 자동 마케팅으로 시작합니다 (대상 ${(prefill.targetCount || 0).toLocaleString()}명).`);
    } catch {
      sessionStorage.removeItem('continuousOperatorPrefill');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: string) => {
    if (expandedProposal === id) setExpandedProposal(null);
    else { setExpandedProposal(id); loadVariants(id); }
  };

  // ── 생성/수정 ──
  const serialize = (e: Partial<ContinuousOperator>) => ({
    name: e.name,
    objective: e.objective,
    schedule: e.schedule || 'daily',
    schedule_time: e.scheduleTime || '09:00',
    schedule_day_of_week: e.schedule === 'weekly' ? (e.scheduleDayOfWeek ?? 1) : null,
    schedule_day_of_month: (e.schedule === 'monthly' || e.schedule === 'yearly') ? (e.scheduleDayOfMonth ?? 1) : null,
    schedule_month: e.schedule === 'yearly' ? (e.scheduleMonth ?? 1) : null,  // ★ 2026-07-05 yearly 대상 월
    status: e.status,
    budget_monthly: e.budgetMonthly,
    budget_daily: e.budgetDaily,
    budget_alert_threshold: e.budgetAlertThreshold,
    delivery_policy: e.deliveryPolicy || 'daily',
    verification_required_days: e.verificationRequiredDays ?? 7,
    admin_phone_numbers: e.adminPhoneNumbers || [],
    backup_admin_phone: e.backupAdminPhone,
    admin_alert_channel: e.adminAlertChannel || 'sms',
    opt_out_minutes: e.optOutMinutes ?? 5,
    auto_send_lead_minutes: e.autoSendLeadMinutes ?? 120,
    send_time_mode: e.sendTimeMode === 'ai_optimal' ? 'ai_optimal' : 'fixed',
    copy_style: e.copyStyle ?? null,
    spam_score_threshold: e.spamScoreThreshold ?? 30,
    max_spam_retries: e.maxSpamRetries ?? 3,
    channel: e.channel || 'lms',
    benefit_content: e.benefitContent ?? null,
    sequence_enabled: e.sequenceEnabled === true,
    sequence_delay_days: e.sequenceEnabled ? (e.sequenceDelayDays ?? 3) : null,
    sequence_reminder_content: e.sequenceEnabled ? (e.sequenceReminderContent ?? null) : null,
  });

  // 생성: POST → (관리자면) run-now로 즉시 초안 → 추천 화면. 비관리자/0건이면 관리 화면.
  const createOperator = async (config: Partial<ContinuousOperator>) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/continuous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(serialize(config)),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || '저장 실패');
        toast.error(data.error || '저장에 실패했습니다.');
        return;
      }
      toast.success('자동 마케팅이 시작되었습니다.');
      setEditing(null);
      let gotProposal = false;
      const newId = data.operator?.id;
      if (newId) {
        try {
          const r2 = await fetch(`/api/ai/operator/continuous/${newId}/run-now`, { method: 'POST', headers: auth() });
          const d2 = await r2.json();
          if (d2.success && d2.proposal) gotProposal = true;
          else if (d2.success && !d2.proposal) toast.info(d2.message || '조건에 맞는 고객이 없어 이번엔 추천이 생성되지 않았습니다.');
        } catch { /* run-now는 관리자 전용 — 실패해도 예약 주기에 생성됨 */ }
      }
      setProposalStatus('pending');
      setView(gotProposal ? 'recommendations' : 'operators');
      await loadAll();
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
      toast.error(e?.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const updateOperator = async () => {
    if (!editing?.id) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/operator/continuous/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify(serialize(editing)),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('자동 마케팅이 수정되었습니다.');
        setEditing(null);
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

  // 세부설정 모달 제출: 수정이면 PUT, 신규면 크레딧 확인 후 생성.
  const handleSetupSubmit = () => {
    if (!editing) return;
    if (editing.id) { updateOperator(); return; }
    setPendingConfig(editing);
  };

  // 자연어 제출: 스마트 기본값 + 목표 (+선택 문안 스타일) → 크레딧 확인 → 생성 + 즉시 초안.
  const handleNaturalSubmit = (goal: string, copyStyle: 'courteous' | 'friendly' | 'witty' | 'punchy' | null) => {
    if (!goal) return;
    setPendingConfig({ ...SMART_DEFAULTS, name: goal.slice(0, 40), objective: goal, copyStyle });
  };

  // 시나리오 선택: 세부설정 모달 prefill (가동 전 한 번 확인). 월간형(생일·VIP 데이)은 주기까지 프리필.
  const handleScenarioSelect = (s: ScenarioPick) => {
    setEditing({
      ...SMART_DEFAULTS,
      name: s.name,
      objective: s.objective,
      ...(s.schedule ? { schedule: s.schedule } : {}),
      ...(s.scheduleDayOfMonth != null ? { scheduleDayOfMonth: s.scheduleDayOfMonth } : {}),
    });
  };

  // 오늘의 브리핑 추천 → 한 클릭 시작: 크레딧 확인 → 생성 + 즉시 초안 (전체 AI 체인은 이 순간에만).
  // ★ 5차: 정착 제안(journey_promotion) = 여정 승격다리 재사용 / 채널 제안(email·dm) = 해당 채널 화면 안내.
  const handleBriefStart = (rec: DailyBriefRecommendation) => {
    if (rec.opportunityType === 'journey_promotion') {
      sessionStorage.setItem('journeyObjectivePrefill', JSON.stringify({ objective: rec.objective, message: '' }));
      toast.info('성과가 검증된 목표를 여정으로 가져갑니다 — 생성·활성화는 여정에서 진행됩니다.');
      navigate('/ai-journeys');
      return;
    }
    if (rec.recommendedChannel === 'email') { navigate('/email-campaigns'); return; }
    if (rec.recommendedChannel === 'dm') { navigate('/dm-builder'); return; }
    if (!rec.objective) return;
    setPendingConfig({ ...SMART_DEFAULTS, name: rec.title.slice(0, 40), objective: rec.objective });
  };

  // ── 제안 액션 (ConfirmModal) ──
  const proposalAction = async (path: string, body?: object) => {
    const res = await fetch(`/api/ai/operator/proposals/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };

  const handleApprove = (p: OperatorProposal, selection?: ProposalApproveSelection) => {
    // ★ 2026-07-07 마케팅 캘린더 완비: 발송 예정일이 지난 제안 승인 = 즉시 발송이라, 시즌 캠페인이
    //   명절·기념일 지나서 나가는 사실을 승인 전에 고지(경고 모드 전환).
    const sched = p.scheduledSendAt ? new Date(p.scheduledSendAt) : null;
    const passedMs = sched ? Date.now() - sched.getTime() : 0;
    const passed = !!sched && passedMs > 0;
    const passedDays = passed ? Math.floor(passedMs / 86400000) : 0;
    const schedLabel = sched
      ? sched.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    setConfirmState({
      mode: passed ? 'warning' : 'default', title: '제안 승인 + 발송', confirmLabel: '승인 + 발송',
      description: passed
        ? `발송 예정 시각(${schedLabel})이 이미 ${passedDays >= 1 ? `${passedDays}일 ` : ''}지났습니다.\n지금 승인하면 예정일과 무관하게 즉시 발송됩니다. 시즌·기념일 캠페인이라면 시점이 맞는지 확인해 주세요.`
        : '이 제안을 승인하고 바로 발송하시겠습니까?\n승인 즉시 대상 고객에게 발송됩니다.',
      onConfirm: async () => {
        const d = await proposalAction(`${p.id}/approve`, selection);
        if (d.success) { toast.success(d.message || '발송했습니다.'); await loadAll(); } else toast.error(d.error || '승인에 실패했습니다.');
      },
    });
  };

  const handleReject = (id: string) => setConfirmState({
    mode: 'warning', title: '제안 거부', confirmLabel: '거부',
    description: '이 제안을 거부하시겠습니까?\n거부된 제안은 목록에서 제외됩니다.',
    onConfirm: async () => {
      const d = await proposalAction(`${id}/reject`);
      if (d.success) { toast.info('제안이 거부되었습니다.'); await loadAll(); } else toast.error(d.error || '거부에 실패했습니다.');
    },
  });

  const handleStop = (id: string) => setConfirmState({
    mode: 'warning', title: '자동 발송 정지', confirmLabel: '정지',
    description: '예정된 자동 발송을 정지하시겠습니까?\n정지하면 이번 회차는 발송되지 않습니다.',
    onConfirm: async () => {
      const d = await proposalAction(`${id}/admin-stop`, { reason: 'no_send' });
      if (d.success) { toast.info('자동 발송을 정지했습니다.'); await loadAll(); } else toast.error(d.error || '정지에 실패했습니다.');
    },
  });

  // ── 오퍼레이터 액션 ──
  const handleRunNow = (id: string) => setConfirmState({
    mode: 'info', title: '지금 즉시 추천 받기', confirmLabel: '추천 받기',
    description: '예약 시점과 별개로 지금 새 캠페인 추천 1건을 생성합니다.\n생성 후 "오늘의 추천 마케팅"에서 확인할 수 있습니다.',
    onConfirm: async () => {
      const res = await fetch(`/api/ai/operator/continuous/${id}/run-now`, { method: 'POST', headers: auth() });
      const d = await res.json();
      if (d.success) {
        toast.success(d.proposal ? '추천이 생성되었습니다.' : (d.message || '이번엔 추천이 생성되지 않았습니다.'));
        setProposalStatus('pending');
        if (d.proposal) setView('recommendations');
        await loadAll();
      } else toast.error(d.error || '추천 생성에 실패했습니다.');
    },
  });

  const handleDelete = (id: string) => setConfirmState({
    mode: 'danger', title: '자동 마케팅 중지', confirmLabel: '중지',
    description: '이 자동 마케팅을 보관함으로 이동하시겠습니까?\n매일 새 캠페인 추천이 즉시 중단됩니다.',
    onConfirm: async () => {
      const res = await fetch(`/api/ai/operator/continuous/${id}`, { method: 'DELETE', headers: auth() });
      const d = await res.json();
      if (d.success) { toast.success('자동 마케팅이 중지되었습니다.'); await loadAll(); } else toast.error(d.error || '중지에 실패했습니다.');
    },
  });

  // 승격 다리 — 검증된 자동마케팅 캠페인의 목표를 여정으로 넘긴다(기존 여정 생성·활성화·사전테스트 게이트 재사용, 우회 없음).
  const handlePromoteToJourney = (p: OperatorProposal) => {
    const pj = p.proposalJson || {};
    const msgs = pj.messages || [];
    const recIdx = variantsMap[p.id]?.recommendation?.variantIndex;
    const best = (recIdx != null && msgs[recIdx]) ? msgs[recIdx] : msgs[0];
    sessionStorage.setItem('journeyObjectivePrefill', JSON.stringify({
      objective: p.operatorObjective || pj.target?.criteria || '',
      message: best?.body || best?.message || '',
    }));
    toast.info('검증된 목표를 여정으로 가져갑니다 — 생성·활성화는 여정에서 진행됩니다.');
    navigate('/ai-journeys');
  };

  const goLauncher = () => setView('launcher');
  const headerBack = () => (view === 'launcher' ? goBackOr(navigate, '/ai-operator') : goLauncher());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 */}
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={headerBack} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-semibold text-white truncate">{VIEW_TITLE[view]}</h1>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {view === 'launcher' && (
              <button onClick={() => setShowMultiGoal(true)} className="hidden sm:flex text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg items-center gap-1.5 transition-colors" title="여러 목표를 동시에 설정할 때 충돌을 분석">
                <GitMerge className="w-3.5 h-3.5" />여러 목표 분석
              </button>
            )}
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        {error && <div className="mb-5 bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300">{error}</div>}

        {loading && view !== 'natural' && view !== 'scenario' ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex justify-center text-white/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <>
            {view === 'launcher' && (
              <AutoMarketingLauncher
                pendingCount={pendingCount}
                activeCount={activeCount}
                onOpenRecommendations={() => setView('recommendations')}
                onOpenNatural={() => setView('natural')}
                onOpenScenario={() => setView('scenario')}
                onOpenAdvanced={() => setEditing({ ...SMART_DEFAULTS, name: '', objective: '' })}
                onManage={() => setView('operators')}
              />
            )}

            {view === 'recommendations' && (
              <div className="space-y-4">
                {dailyBrief && (
                  <DailyBriefCard
                    brief={dailyBrief}
                    submitting={creating}
                    onStart={handleBriefStart}
                  />
                )}
                {learningSummary && learningSummary.memory.total > 0 && <LearningCard summary={learningSummary} />}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">상태</span>
                  <select value={proposalStatus} onChange={(e) => setProposalStatus(e.target.value as 'pending' | 'all')} className="text-xs px-2 py-1 bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-indigo-400/50">
                    <option value="pending">대기 중</option>
                    <option value="all">전체 보기</option>
                  </select>
                </div>
                {proposals.length === 0 ? (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
                    {proposalStatus === 'pending' ? '오늘 받은 제안이 없습니다.' : '제안이 없습니다.'}
                    <div className="text-xs text-white/40 mt-2">자동 마케팅이 활성 상태면 정해진 시간에 AI가 새 캠페인을 추천합니다.</div>
                  </div>
                ) : (
                  proposals.map((p) => (
                    <ProposalDecisionCard
                      key={p.id}
                      proposal={p}
                      featured={p.id === featuredId}
                      expanded={expandedProposal === p.id}
                      variantData={variantsMap[p.id]}
                      onToggleExpand={() => toggleExpand(p.id)}
                      onApprove={(sel) => handleApprove(p, sel)}
                      onReject={() => handleReject(p.id)}
                      onStop={() => handleStop(p.id)}
                      onPromoteToJourney={() => handlePromoteToJourney(p)}
                    />
                  ))
                )}
              </div>
            )}

            {view === 'natural' && <NaturalLanguageStart submitting={creating} onSubmit={handleNaturalSubmit} />}

            {view === 'scenario' && <ScenarioStart onSelect={handleScenarioSelect} />}

            {view === 'operators' && (
              <OperatorsManageList
                operators={operators}
                onRunNow={handleRunNow}
                onEdit={(op) => setEditing(op)}
                onDelete={handleDelete}
                onCreate={() => setEditing({ ...SMART_DEFAULTS, name: '', objective: '' })}
              />
            )}
          </>
        )}
      </div>

      {/* 모달 */}
      {editing && (
        <OperatorSetupModal
          editing={editing}
          setEditing={(e) => setEditing(e)}
          saving={saving}
          error={error}
          onClose={() => setEditing(null)}
          onSubmit={handleSetupSubmit}
        />
      )}
      {showMultiGoal && <MultiGoalModal onClose={() => setShowMultiGoal(false)} />}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      <CreditConfirmModal
        open={!!pendingConfig}
        source="continuous-operator"
        onConfirm={() => { const c = pendingConfig; setPendingConfig(null); if (c) createOperator(c); }}
        onCancel={() => setPendingConfig(null)}
      />
    </div>
  );
}

// AI 학습 현황 — 추천 화면 상단 (회사별 누적 학습)
function LearningCard({ summary }: { summary: LearningSummary }) {
  const approvalPct = summary.performance.totalProposals30d > 0
    ? Math.round((summary.performance.approvedCount / summary.performance.totalProposals30d) * 100)
    : null;
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-indigo-300" />
        <span className="text-sm font-semibold text-white">AI 학습 현황</span>
        {summary.memory.lastLearnedAt && (
          <span className="ml-auto text-[10px] text-white/40">마지막 학습 {new Date(summary.memory.lastLearnedAt).toLocaleDateString('ko-KR')}</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="학습 누적" value={`${summary.memory.total}건`} tone="text-indigo-200" />
        <Stat label="성공 패턴" value={`${summary.memory.successPatterns}건`} tone="text-emerald-200" />
        <Stat label="30일 제안" value={`${summary.performance.totalProposals30d}건`} tone="text-cyan-200" />
        <Stat label="승인률" value={approvalPct != null ? `${approvalPct}%` : '-'} tone="text-amber-200" />
      </div>
      {summary.variantWinner && summary.variantWinner.sent > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/70 p-2 bg-white/5 border border-white/10 rounded-lg">
          <Sparkles className="w-3 h-3 text-indigo-300 flex-shrink-0" />
          <span>지난 14일 가장 효과 좋은 변형 = <span className="font-semibold text-indigo-200">변형 {summary.variantWinner.variantLabel}</span>
            <span className="text-white/40"> (클릭률 {(summary.variantWinner.ctr * 100).toFixed(1)}% · 발송 {summary.variantWinner.sent}건)</span></span>
        </div>
      )}
      <div className="text-[10px] text-white/30 italic mt-2">Data source — 회사별 누적 학습 · 최근 30일 제안</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="p-2.5 bg-white/5 rounded-lg">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className={`text-base font-bold font-mono tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
