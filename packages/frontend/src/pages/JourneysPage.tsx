import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronUp, Loader2, Pause, Play, Plus, Power, RefreshCw, Sparkles,
  ShoppingCart, Cake, Calendar as CalendarIcon, UserPlus, Repeat, Moon, MessageSquare,
  Clock, DollarSign, Users,
} from 'lucide-react';

// D187 (2026-05-20): Journey Builder Lite — 7 표준 여정 + Custom 자연어 진입
//   영구 원칙 정합: AI_OPERATOR_ALLOWED_USERS 게이팅 / 회사 자유 임계값 (NULL=무제한)

type TemplateCode = 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom';
type JourneyStatus = 'draft' | 'active' | 'paused' | 'ended';

interface JourneyTemplate {
  templateCode: TemplateCode;
  name: string;
  description: string;
  triggerEvent: string;
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  stepCount: number;
}

interface JourneyRow {
  id: string;
  company_id: string;
  name: string;
  template_code: TemplateCode;
  trigger_event: string;
  status: JourneyStatus;
  budget_monthly: number | null;
  threshold_cost_per_step: number | null;
  threshold_recipients_per_step: number | null;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  stats_total_entered: number;
  stats_total_completed: number;
  stats_total_cost: number;
  approved_at: string | null;
  paused_at: string | null;
  pause_reason: string | null;
  created_at: string;
}

interface StepRow {
  id: string;
  step_order: number;
  step_type: string;
  delay_hours: number;
  channel: string | null;
  message_template: string | null;
}

interface JourneyDetail {
  journey: JourneyRow;
  steps: StepRow[];
}

interface CreateForm {
  templateCode: TemplateCode | null;
  name: string;
  customObjective: string;
  budgetMonthly: string;
  thresholdRecipients: string;
  thresholdCost: string;
  allowReentry: boolean | null;
  reentryCooldownDays: string;
}

const TEMPLATE_VISUAL: Record<TemplateCode, { icon: typeof UserPlus; gradient: string }> = {
  onboarding:  { icon: UserPlus,   gradient: 'from-emerald-400 to-teal-500' },
  repeat:      { icon: Repeat,     gradient: 'from-cyan-400 to-blue-500' },
  dormant:     { icon: Moon,       gradient: 'from-violet-400 to-indigo-500' },
  cart:        { icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500' },
  birthday:    { icon: Cake,       gradient: 'from-pink-400 to-rose-500' },
  reservation: { icon: CalendarIcon, gradient: 'from-blue-400 to-indigo-500' },
  custom:      { icon: Sparkles,   gradient: 'from-fuchsia-400 to-purple-500' },
};

const STATUS_BADGE: Record<JourneyStatus, { label: string; cls: string }> = {
  draft:  { label: '초안',     cls: 'bg-slate-700 text-slate-200' },
  active: { label: '활성',     cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  paused: { label: '일시정지', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  ended:  { label: '종료',     cls: 'bg-slate-800 text-slate-400' },
};

export default function JourneysPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, JourneyDetail>>({});
  const [creating, setCreating] = useState<CreateForm | null>(null);
  const [saving, setSaving] = useState(false);

  const token = () => localStorage.getItem('token');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/journeys?status=all', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setJourneys(data.journeys || []);
        setTemplates(data.templates || []);
      } else if (data.code === 'AI_OPERATOR_GATED') {
        setError('AI Operator 진입 권한이 없습니다. 관리자에게 문의해주세요.');
      } else {
        setError(data.error || '여정 조회 실패');
      }
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const loadDetail = async (journeyId: string) => {
    if (detailsMap[journeyId]) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setDetailsMap((prev) => ({ ...prev, [journeyId]: { journey: data.journey, steps: data.steps } }));
      }
    } catch (e) {
      // 상세 조회 실패는 silent
    }
  };

  const toggleExpand = (journeyId: string) => {
    if (expandedId === journeyId) {
      setExpandedId(null);
    } else {
      setExpandedId(journeyId);
      loadDetail(journeyId);
    }
  };

  const handleStartCreate = (templateCode: TemplateCode) => {
    setCreating({
      templateCode,
      name: '',
      customObjective: '',
      budgetMonthly: '',
      thresholdRecipients: '',
      thresholdCost: '',
      allowReentry: null,
      reentryCooldownDays: '',
    });
  };

  const handleCreate = async () => {
    if (!creating) return;
    if (creating.templateCode === 'custom' && !creating.customObjective.trim()) {
      alert('Custom 여정은 목표(자연어)를 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        templateCode: creating.templateCode,
        name: creating.name.trim() || undefined,
        customObjective: creating.customObjective.trim() || undefined,
        budgetMonthly: creating.budgetMonthly ? Number(creating.budgetMonthly) : null,
        thresholdRecipients: creating.thresholdRecipients ? Number(creating.thresholdRecipients) : null,
        thresholdCost: creating.thresholdCost ? Number(creating.thresholdCost) : null,
      };
      if (creating.allowReentry !== null) {
        body.allowReentry = creating.allowReentry;
        body.reentryCooldownDays = creating.reentryCooldownDays ? Number(creating.reentryCooldownDays) : 0;
      }
      const res = await fetch('/api/ai/operator/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setCreating(null);
        setTab('list');
        await loadAll();
      } else {
        alert(data.error || '여정 생성 실패');
      }
    } catch (e: any) {
      alert(e?.message || '생성 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (journeyId: string, action: 'activate' | 'pause' | 'end') => {
    const confirmMsg =
      action === 'activate' ? '여정을 활성화하시겠습니까? 트리거 조건에 맞는 고객이 진입하고 step별 메시지가 자동 발송됩니다.' :
      action === 'pause' ? '여정을 일시정지하시겠습니까? 진행 중인 고객의 다음 step 발송이 멈춥니다.' :
      '여정을 종료하시겠습니까? 종료 후 재시작 불가합니다.';
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetch(`/api/ai/operator/journeys/${journeyId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await loadAll();
      else alert(data.error || '처리 실패');
    } catch (e: any) {
      alert(e?.message || '처리 중 오류');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 */}
      <div className="border-b border-white/10 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 md:py-4 flex items-center gap-2 md:gap-4">
          <button
            onClick={() => navigate('/ai-operator')}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="AI Operator로 돌아가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-2xl font-bold truncate">여정 자동화 (Journey Builder Lite)</h1>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">7 표준 여정 + 자연어 진입 — 트리거 기반 자동 step 진행</p>
          </div>
          <button
            onClick={loadAll}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            aria-label="새로고침"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 탭 */}
        <div className="max-w-7xl mx-auto px-3 md:px-6 flex gap-1">
          <button
            onClick={() => setTab('list')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'list' ? 'border-fuchsia-400 text-white' : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            활성 여정 ({journeys.length})
          </button>
          <button
            onClick={() => setTab('create')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === 'create' ? 'border-fuchsia-400 text-white' : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            <Plus className="w-4 h-4" /> 신규 여정 생성
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/40" />
          </div>
        )}

        {/* 활성 여정 탭 */}
        {!loading && tab === 'list' && (
          <div className="space-y-3">
            {journeys.length === 0 && (
              <div className="p-8 md:p-12 text-center bg-white/5 border border-white/10 rounded-xl">
                <Sparkles className="w-10 h-10 mx-auto text-white/30 mb-3" />
                <p className="text-white/60 text-sm">아직 생성한 여정이 없습니다.</p>
                <button
                  onClick={() => setTab('create')}
                  className="mt-4 px-4 py-2 bg-gradient-to-r from-fuchsia-500 to-purple-500 rounded-lg text-sm font-medium hover:opacity-90"
                >
                  첫 여정 만들기
                </button>
              </div>
            )}

            {journeys.map((j) => {
              const visual = TEMPLATE_VISUAL[j.template_code] || TEMPLATE_VISUAL.custom;
              const Icon = visual.icon;
              const badge = STATUS_BADGE[j.status];
              const isExpanded = expandedId === j.id;
              const detail = detailsMap[j.id];

              return (
                <div key={j.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <div
                    className="p-3 md:p-4 cursor-pointer hover:bg-white/[0.07] transition-colors"
                    onClick={() => toggleExpand(j.id)}
                  >
                    <div className="flex items-start gap-3 md:gap-4">
                      <div className={`shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gradient-to-br ${visual.gradient} flex items-center justify-center`}>
                        <Icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="text-sm md:text-base font-semibold truncate">{j.name}</h3>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                        </div>
                        <div className="text-xs text-white/50 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 진입 {j.stats_total_entered}건</span>
                          <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> 완료 {j.stats_total_completed}건</span>
                          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {Number(j.stats_total_cost).toLocaleString()}원 사용</span>
                          {j.budget_monthly != null && (
                            <span className="flex items-center gap-1 text-amber-300/80">월 예산 {Number(j.budget_monthly).toLocaleString()}원</span>
                          )}
                        </div>
                        {j.pause_reason && j.status === 'paused' && (
                          <div className="mt-1.5 text-xs text-amber-200/90 bg-amber-500/10 px-2 py-1 rounded">
                            일시정지 사유: {j.pause_reason}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {j.status === 'draft' || j.status === 'paused' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'activate'); }}
                            className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300"
                            title="활성화"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        ) : j.status === 'active' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'pause'); }}
                            className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300"
                            title="일시정지"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        ) : null}
                        {j.status !== 'ended' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'end'); }}
                            className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300"
                            title="종료"
                          >
                            <Power className="w-4 h-4" />
                          </button>
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && detail && (
                    <div className="border-t border-white/10 p-3 md:p-4 bg-slate-950/40">
                      <div className="text-xs text-white/60 mb-2">트리거: <span className="text-white/80">{detail.journey.trigger_event}</span></div>
                      <div className="space-y-2">
                        {detail.steps.map((s) => (
                          <div key={s.id} className="flex items-start gap-3 p-2.5 bg-white/5 rounded-lg">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-fuchsia-500/20 text-fuchsia-300 flex items-center justify-center text-sm font-semibold">
                              {s.step_order}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white/50 mb-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 진입 후 {s.delay_hours}시간</span>
                                {s.channel && <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {s.channel.toUpperCase()}</span>}
                              </div>
                              {s.message_template && (
                                <div className="text-sm text-white/90 whitespace-pre-wrap break-words">{s.message_template}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 신규 여정 생성 탭 */}
        {!loading && tab === 'create' && !creating && (
          <div>
            <p className="text-sm text-white/60 mb-4">템플릿을 선택하세요. Custom은 자연어로 직접 작성할 수 있습니다.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {templates.map((t) => {
                const visual = TEMPLATE_VISUAL[t.templateCode] || TEMPLATE_VISUAL.custom;
                const Icon = visual.icon;
                return (
                  <button
                    key={t.templateCode}
                    onClick={() => handleStartCreate(t.templateCode)}
                    className="text-left p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-colors"
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${visual.gradient} flex items-center justify-center mb-3`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="font-semibold text-sm md:text-base mb-1">{t.name}</div>
                    <div className="text-xs text-white/50 mb-3 leading-relaxed">{t.description}</div>
                    <div className="text-[11px] text-white/40 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>step {t.stepCount}개</span>
                      <span>재진입 {t.allowReentry ? (t.reentryCooldownDays ? `${t.reentryCooldownDays}일 후` : '즉시') : '불가'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 생성 폼 */}
        {creating && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base md:text-lg font-semibold">
                {templates.find((t) => t.templateCode === creating.templateCode)?.name} 여정 생성
              </h3>
              <button
                onClick={() => setCreating(null)}
                className="text-white/40 hover:text-white/80 text-sm"
              >
                취소
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">여정 이름 (선택)</label>
                <input
                  value={creating.name}
                  onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                  placeholder="비워두면 템플릿 기본 이름이 사용됩니다."
                  className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400"
                />
              </div>

              {creating.templateCode === 'custom' && (
                <div>
                  <label className="block text-xs text-white/60 mb-1">여정 목표 (자연어, 필수)</label>
                  <textarea
                    value={creating.customObjective}
                    onChange={(e) => setCreating({ ...creating, customObjective: e.target.value })}
                    placeholder="예: 첫 구매 후 30일 동안 재구매 유도하기, 신상품 출시 알림 시리즈 등"
                    rows={3}
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400 resize-none"
                  />
                  <p className="mt-1 text-[11px] text-white/40">Opus 4.7이 회사 메모리 + 톤을 바탕으로 2~5개 step을 자동 생성합니다.</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/60 mb-1">월간 예산 (원, 선택)</label>
                  <input
                    type="number"
                    value={creating.budgetMonthly}
                    onChange={(e) => setCreating({ ...creating, budgetMonthly: e.target.value })}
                    placeholder="비워두면 무제한"
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">step당 비용 한도 (원, 선택)</label>
                  <input
                    type="number"
                    value={creating.thresholdCost}
                    onChange={(e) => setCreating({ ...creating, thresholdCost: e.target.value })}
                    placeholder="비워두면 무제한"
                    className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400"
                  />
                </div>
              </div>

              <div className="text-xs text-white/40 bg-white/5 rounded-lg p-3 leading-relaxed">
                <div className="font-medium text-white/60 mb-1">광고 자동 검증 4건 (모두 자동 적용)</div>
                <ul className="space-y-0.5">
                  <li>· (광고) 표기 자동 부착 (광고 메시지인 경우)</li>
                  <li>· 무료거부 080 자동 부착</li>
                  <li>· 발송 시간 KST 08:00 ~ 21:00 자동 준수</li>
                  <li>· KISA 제목 영역 자동 적용</li>
                </ul>
                <div className="mt-2 text-amber-200/70">생성 직후 상태는 초안입니다. 활성화 버튼을 누르면 트리거 매칭이 시작됩니다.</div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setCreating(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm"
                disabled={saving}
              >
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                초안 여정 생성
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
