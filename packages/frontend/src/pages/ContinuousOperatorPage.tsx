import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Brain, Check, ChevronDown, ChevronUp, Clock, Edit2, GitMerge, Loader2, Play, Plus, RefreshCw, Sparkles, Target, Trash2, X, Zap } from 'lucide-react';

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
      alert('다중 목표 분석은 2건 이상 입력해야 합니다.');
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
      } else {
        alert(data.error || '충돌 분석 실패');
      }
    } catch (e: any) {
      alert(e?.message || '분석 중 오류');
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
      const [opRes, propRes] = await Promise.all([
        fetch('/api/ai/operator/continuous', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`/api/ai/operator/proposals?status=${proposalStatus}`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const opData = await opRes.json();
      const propData = await propRes.json();
      if (opData.success) setOperators(opData.operators || []);
      if (propData.success) setProposals(propData.proposals || []);
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

  const handleSave = async () => {
    if (!editing?.name?.trim() || !editing?.objective?.trim()) {
      alert('이름과 목표(자연어)는 필수입니다.');
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(null);
        await loadAll();
      } else {
        setError(data.error || '저장 실패');
      }
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Operator를 archive 처리하시겠습니까? 매일 제안서 생성이 즉시 중단됩니다.')) return;
    try {
      const res = await fetch(`/api/ai/operator/continuous/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await loadAll();
      else alert(data.error || '삭제 실패');
    } catch (e: any) {
      alert(e?.message || '삭제 중 오류');
    }
  };

  const handleRunNow = async (id: string) => {
    if (!confirm('지금 즉시 제안서를 생성하시겠습니까? (예약 시점과 별개로 1건 추가 생성)')) return;
    try {
      const res = await fetch(`/api/ai/operator/continuous/${id}/run-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || '제안서가 생성되었습니다. "대기 제안서" 탭에서 확인하세요.');
        await loadAll();
      } else {
        alert(data.error || '실패');
      }
    } catch (e: any) {
      alert(e?.message || '오류');
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm('제안서를 승인하시겠습니까? 승인 후 발송은 별도 발송 화면에서 진행됩니다.')) return;
    try {
      const res = await fetch(`/api/ai/operator/proposals/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        // 승인된 제안서의 objective를 AI Operator로 전달 → 사용자가 검토 후 발송
        const proposal = proposals.find((p) => p.id === id);
        if (proposal?.operatorObjective) {
          sessionStorage.setItem('ai_operator_prefill_objective', proposal.operatorObjective);
          if (confirm('AI Operator 화면으로 이동하여 발송을 진행하시겠습니까?')) {
            navigate('/ai-operator');
            return;
          }
        }
        await loadAll();
      } else {
        alert(data.error || '승인 실패');
      }
    } catch (e: any) {
      alert(e?.message || '오류');
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('제안서를 거부하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/ai/operator/proposals/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await loadAll();
      else alert(data.error || '거부 실패');
    } catch (e: any) {
      alert(e?.message || '오류');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Brain className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">AI 영구 운영 (Continuous Operator)</h1>
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => { setShowMultiGoal(true); setMultiGoalAnalysis(null); }}
              className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              title="다중 목표 설정 시 AI가 충돌 영역을 분석 (Multi-Goal Decisioning)"
            >
              <GitMerge className="w-3.5 h-3.5" />
              다중 목표 분석
            </button>
            <button
              onClick={() => setEditing({ name: '', objective: '', schedule: 'daily', scheduleTime: '09:00', status: 'active' })}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 영구 운영
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 border-b">
          <button
            onClick={() => setTab('proposals')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'proposals' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}
          >
            대기 제안서 {proposals.filter((p) => p.status === 'pending').length > 0 && (
              <span className="ml-1 bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {proposals.filter((p) => p.status === 'pending').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('operators')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'operators' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500'}`}
          >
            영구 운영 목록 ({operators.filter((o) => o.status === 'active').length})
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* 영구 원칙 안내 */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> AI는 매일 회고 + 제안서를 생성할 뿐, 실행은 항상 사용자 승인 후에만 이루어집니다.
            ENT 자동 실행 옵션은 default OFF — 활성 시에도 1,000건 미만 + 5만원 미만 + low risk + 비광고 임계값을 모두 만족해야만 자동 실행됩니다.
            타겟 0건 매칭 시 제안서가 생성되지 않습니다.
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {/* 탭 1: 대기 제안서 */}
        {!loading && tab === 'proposals' && (
          <>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-500">상태:</span>
              <select
                value={proposalStatus}
                onChange={(e) => setProposalStatus(e.target.value as any)}
                className="text-xs px-2 py-1 border rounded"
              >
                <option value="pending">대기</option>
                <option value="all">전체</option>
              </select>
            </div>

            {proposals.length === 0 ? (
              <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-500">
                {proposalStatus === 'pending' ? '대기 중인 제안서가 없습니다.' : '제안서가 없습니다.'}
                <br />
                <span className="text-xs text-gray-400 mt-2 block">활성 영구 운영이 있으면 매일 예약 시간에 자동으로 제안서가 생성됩니다.</span>
              </div>
            ) : (
              proposals.map((p) => {
                const expanded = expandedProposal === p.id;
                const target = p.proposalJson?.target;
                const channel = p.proposalJson?.channel;
                const messages = p.proposalJson?.messages || [];
                const performance = p.proposalJson?.performance;
                return (
                  <div key={p.id} className="bg-white border rounded-xl overflow-hidden">
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-4 h-4 text-indigo-500" />
                            <div className="text-sm font-bold text-gray-800">{p.operatorName || '(Operator)'}</div>
                            <StatusBadge status={p.status} />
                            {p.autoExecuted && (
                              <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                <Zap className="w-2.5 h-2.5" /> 자동 실행
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mb-2">목표: "{p.operatorObjective}"</div>
                          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                            <span>대상 <strong className="text-indigo-600">{p.recipientCount.toLocaleString()}명</strong></span>
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
                              <button onClick={() => handleApprove(p.id)} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded flex items-center gap-1">
                                <Check className="w-3 h-3" /> 승인 + 발송
                              </button>
                              <button onClick={() => handleReject(p.id)} className="text-xs bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 px-3 py-1.5 rounded flex items-center gap-1">
                                <X className="w-3 h-3" /> 거부
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => toggleExpand(p.id)}
                            className="text-xs text-gray-500 hover:bg-gray-50 px-3 py-1.5 rounded flex items-center gap-1"
                          >
                            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            상세
                          </button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t bg-gray-50 px-5 py-4 space-y-3 text-xs">
                        {target && (
                          <div>
                            <div className="font-bold text-gray-700 mb-1">타겟 분석</div>
                            <div className="text-gray-600">
                              {target.criteria || '(기준 미설정)'}
                              <span className="text-gray-400 ml-2">— 매칭 {target.count?.toLocaleString()} / 전체 {target.totalCount?.toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                        {messages.length > 0 && (
                          <div>
                            <div className="font-bold text-gray-700 mb-1">메시지 ({messages.length}안)</div>
                            <div className="space-y-1.5">
                              {messages.slice(0, 3).map((m: any, i: number) => {
                                const variantData = variantsMap[p.id]?.variants?.[i];
                                const recommendation = variantsMap[p.id]?.recommendation;
                                const isBanditRecommended = recommendation?.variantIndex === i;
                                return (
                                  <div key={i} className={`border rounded p-2 ${isBanditRecommended ? 'bg-indigo-50 border-indigo-300' : 'bg-white'}`}>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium text-gray-700">{m.variantName || `Variant ${i + 1}`}</span>
                                      <span className="text-[10px] text-gray-500">· {m.byteCount}byte</span>
                                      {isBanditRecommended && (
                                        <span className="text-[10px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                                          <Target className="w-2.5 h-2.5" /> Bandit 추천
                                        </span>
                                      )}
                                      {variantData && (
                                        <span className="text-[10px] text-gray-500">
                                          발송 {variantData.sentCount} · 클릭 {variantData.clickCount} · 전환 {variantData.conversionCount}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-gray-600 whitespace-pre-wrap mt-1">{m.body}</div>
                                  </div>
                                );
                              })}
                            </div>
                            {/* D177 Bandit 추천 사유 표시 */}
                            {variantsMap[p.id]?.recommendation && (
                              <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded p-2 text-indigo-900 text-[11px] flex items-start gap-1.5">
                                <Target className="w-3 h-3 mt-0.5 shrink-0" />
                                <div>
                                  <strong>Self-Optimizing 추천:</strong> {variantsMap[p.id].recommendation!.reasoning}
                                  <div className="text-indigo-700 mt-0.5">★ 영구 원칙 정합 — 본 추천은 참고만, 발송은 사용자가 선택한 variant로 진행됩니다.</div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {performance && (
                          <div>
                            <div className="font-bold text-gray-700 mb-1">예상 성과</div>
                            <div className="text-gray-600">
                              클릭률 {(performance.clickRate * 100).toFixed(1)}% · 전환율 {(performance.conversionRate * 100).toFixed(2)}% · 매출 {performance.expectedRevenue?.toLocaleString()}원
                            </div>
                          </div>
                        )}
                        {p.autoExecuteReason && (
                          <div className="bg-violet-50 rounded p-2 text-violet-800">
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

        {/* 탭 2: 영구 운영 목록 */}
        {!loading && tab === 'operators' && (
          <>
            {operators.length === 0 ? (
              <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-500">
                등록된 영구 운영이 없습니다.
                <br />
                <span className="text-xs text-gray-400 mt-2 block">자연어 한 줄로 마케팅 목표를 박으면 AI가 매일 새 캠페인을 제안합니다.</span>
              </div>
            ) : (
              operators.map((op) => (
                <div key={op.id} className="bg-white border rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-base font-bold text-gray-800">{op.name}</div>
                        <StatusBadge status={op.status} />
                      </div>
                      <div className="text-sm text-gray-600 mb-2">"{op.objective}"</div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        <span><Clock className="w-3 h-3 inline" /> {op.schedule} {op.scheduleTime} (KST)</span>
                        <span>·</span>
                        <span>다음 실행 {op.nextRunAt ? new Date(op.nextRunAt).toLocaleString('ko-KR') : '-'}</span>
                        <span>·</span>
                        <span>제안 {op.totalProposals}건 (승인 {op.totalApproved} / 거부 {op.totalRejected} / 자동 {op.totalAutoExecuted})</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => handleRunNow(op.id)} className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-1 rounded flex items-center gap-1">
                        <Play className="w-3 h-3" /> 지금 실행
                      </button>
                      <button onClick={() => setEditing(op)} className="text-xs text-gray-600 hover:bg-gray-50 px-2 py-1 rounded flex items-center gap-1">
                        <Edit2 className="w-3 h-3" /> 수정
                      </button>
                      <button onClick={() => handleDelete(op.id)} className="text-xs text-rose-500 hover:bg-rose-50 px-2 py-1 rounded flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> 중단
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* ★ D179 Multi-Goal 분석 모달 */}
      {showMultiGoal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowMultiGoal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <GitMerge className="w-5 h-5 text-violet-600" />
              <h3 className="text-base font-bold text-gray-800">Multi-Goal Decisioning — 다중 목표 충돌 분석</h3>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <strong>영구 원칙:</strong> 다중 목표 설정 시 AI가 충돌 영역(동일 고객 동시 발송 / 메시지 중복 / 시점 겹침)을 분석 + 사용자 검토 후 영구 운영 등록.
                실행은 사용자 승인 후에만 진행됩니다.
              </div>
            </div>

            {!multiGoalAnalysis && (
              <>
                <div className="space-y-3 mb-4">
                  {multiGoals.map((g, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-gray-700">목표 {idx + 1}</span>
                        {multiGoals.length > 2 && (
                          <button onClick={() => removeMultiGoal(idx)} className="text-rose-500 hover:text-rose-700 text-xs ml-auto">
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
                          className="px-3 py-2 border rounded text-sm"
                          maxLength={100}
                        />
                        <div>
                          <label className="text-[10px] text-gray-500 block">가중치 (0~1, 합 자동 정규화)</label>
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
                            className="px-3 py-2 border rounded text-sm w-full"
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
                        className="w-full px-3 py-2 border rounded text-xs resize-none h-16"
                        maxLength={500}
                      />
                    </div>
                  ))}
                  {multiGoals.length < 5 && (
                    <button
                      onClick={addMultiGoal}
                      className="w-full py-2 border-2 border-dashed border-gray-300 hover:border-violet-400 hover:bg-violet-50 text-xs text-gray-600 rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" /> 목표 추가 (최대 5건)
                    </button>
                  )}
                </div>
                <div className="flex gap-2 justify-end pt-2 border-t">
                  <button onClick={() => setShowMultiGoal(false)} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
                  <button
                    onClick={handleMultiGoalAnalyze}
                    disabled={analyzing}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {analyzing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 분석 중...</> : <><Sparkles className="w-3.5 h-3.5" /> 충돌 분석 시작</>}
                  </button>
                </div>
              </>
            )}

            {/* 분석 결과 */}
            {multiGoalAnalysis && (
              <>
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 mb-4">
                  <div className="text-xs font-bold text-violet-900 mb-1">통합 전략</div>
                  <div className="text-sm text-violet-800 whitespace-pre-wrap leading-relaxed">{multiGoalAnalysis.overallStrategy}</div>
                </div>

                <div className="mb-4">
                  <div className="text-xs font-bold text-gray-700 mb-2">추천 순서 (Recommended Order)</div>
                  <div className="flex flex-wrap gap-2">
                    {multiGoalAnalysis.recommendedOrder.map((name, idx) => (
                      <div key={idx} className="bg-white border border-violet-300 rounded-full px-3 py-1 text-xs flex items-center gap-1.5">
                        <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                        {name}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mb-4 space-y-2">
                  <div className="text-xs font-bold text-gray-700">목표별 sub-plan</div>
                  {multiGoalAnalysis.subPlans.map((sp, idx) => (
                    <div key={idx} className={`border rounded-lg p-3 ${sp.shouldExecute ? 'bg-white' : 'bg-rose-50 border-rose-200'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-violet-600 text-white w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">{sp.priority}</span>
                        <span className="text-sm font-bold text-gray-800">{sp.goalName}</span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{sp.channelRecommended}</span>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{sp.timingRecommended}</span>
                        {!sp.shouldExecute && <span className="text-[10px] bg-rose-200 text-rose-800 px-1.5 py-0.5 rounded-full">실행 제외</span>}
                      </div>
                      <div className="text-xs text-gray-600 mb-1">{sp.targetCriteria}</div>
                      {sp.conflicts.length > 0 && (
                        <div className="text-[11px] text-amber-700 mt-1.5">
                          <strong>충돌:</strong> {sp.conflicts.join(' / ')}
                        </div>
                      )}
                      <div className="text-[11px] text-gray-500 mt-1">{sp.reasoning}</div>
                    </div>
                  ))}
                </div>

                {multiGoalAnalysis.conflictMatrix && (
                  <details className="mb-4">
                    <summary className="text-xs font-bold text-gray-700 cursor-pointer">충돌 매트릭스 (markdown)</summary>
                    <pre className="bg-gray-50 border rounded p-3 text-[11px] font-mono whitespace-pre-wrap mt-2">{multiGoalAnalysis.conflictMatrix}</pre>
                  </details>
                )}

                <div className="flex gap-2 justify-end pt-3 border-t">
                  <button onClick={() => { setMultiGoalAnalysis(null); }} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">다시 분석</button>
                  <button onClick={() => setShowMultiGoal(false)} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg">확인</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800 mb-4">{editing.id ? '영구 운영 수정' : '신규 영구 운영'}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">이름</label>
                <input
                  type="text"
                  value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="VIP 재구매 영구 운영"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">자연어 목표</label>
                <textarea
                  value={editing.objective || ''}
                  onChange={(e) => setEditing({ ...editing, objective: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none h-20"
                  placeholder="VIP 등급 고객 중 최근 30일 미구매 고객에게 재구매 유도 메시지를 매일 추천"
                  maxLength={500}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">주기</label>
                  <select
                    value={editing.schedule || 'daily'}
                    onChange={(e) => setEditing({ ...editing, schedule: e.target.value as Schedule })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="daily">매일</option>
                    <option value="weekly">매주</option>
                    <option value="monthly">매월</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">실행 시각 (KST)</label>
                  <input
                    type="time"
                    value={editing.scheduleTime || '09:00'}
                    onChange={(e) => setEditing({ ...editing, scheduleTime: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
              {editing.id && (
                <div>
                  <label className="text-xs text-gray-600 block mb-1">상태</label>
                  <select
                    value={editing.status || 'active'}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as OperatorStatus })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="active">활성 (매일 제안서 생성)</option>
                    <option value="paused">일시 중지</option>
                  </select>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                <strong>안내:</strong> AI가 위 시각에 매일/매주/매월 새 제안서를 박습니다. 각 제안서는 사용자 승인 후에만 발송됩니다. 7일 안에 승인하지 않으면 자동 만료됩니다.
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg disabled:opacity-40">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: '활성', cls: 'bg-emerald-100 text-emerald-700' },
    paused: { label: '일시중지', cls: 'bg-amber-100 text-amber-700' },
    archived: { label: '보관', cls: 'bg-gray-100 text-gray-500' },
    pending: { label: '승인 대기', cls: 'bg-amber-100 text-amber-700' },
    approved: { label: '승인됨', cls: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: '거부됨', cls: 'bg-gray-100 text-gray-500' },
    auto_executed: { label: '자동 실행됨', cls: 'bg-violet-100 text-violet-700' },
    expired: { label: '만료됨', cls: 'bg-rose-100 text-rose-700' },
  };
  const e = map[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
