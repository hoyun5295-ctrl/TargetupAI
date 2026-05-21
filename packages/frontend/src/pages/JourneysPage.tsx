import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronUp, Loader2, Pause, Play, Plus, Power, RefreshCw, Sparkles,
  ShoppingCart, Cake, Calendar as CalendarIcon, UserPlus, Repeat, Moon, MessageSquare,
  Clock, DollarSign, Users, Phone, Wand2, X, AlertCircle,
} from 'lucide-react';

// D187 (2026-05-20): Journey Builder Lite — 7 표준 여정 + Custom 자연어
// D187-fix2: 회사 admin이 step 메시지 + 회신번호 직접 입력 + AI 다듬기
//   영구 룰: AI는 임의 혜택(%/원/무료/쿠폰) 절대 만들지 않음. 회사 admin이 직접 작성.

type TemplateCode = 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom';
type JourneyStatus = 'draft' | 'active' | 'paused' | 'ended';
type ChannelType = 'sms' | 'lms' | 'mms' | 'kakao' | 'email';

interface TemplateStep {
  stepOrder: number;
  stepType: string;
  delayHours: number;
  channel?: ChannelType;
  messageTemplate?: string;
  isAd?: boolean;
}

interface JourneyTemplate {
  templateCode: TemplateCode;
  name: string;
  description: string;
  triggerEvent: string;
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  stepCount: number;
  steps: TemplateStep[];
}

interface JourneyRow {
  id: string;
  name: string;
  template_code: TemplateCode;
  trigger_event: string;
  status: JourneyStatus;
  budget_monthly: number | null;
  callback_number: string | null;
  allow_reentry: boolean;
  reentry_cooldown_days: number | null;
  stats_total_entered: number;
  stats_total_completed: number;
  stats_total_cost: number;
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
  is_ad: boolean;
}

interface JourneyDetail {
  journey: JourneyRow;
  steps: StepRow[];
}

interface CallbackOption {
  phone: string;
  source: string;
  description: string | null;
  is_default: boolean;
}

interface RefineCandidate {
  message: string;
  bytes?: number;
  reason?: string;
}

interface StepInput {
  stepOrder: number;
  stepType: string;
  delayHours: number;
  channel: ChannelType;
  messageTemplate: string;
  isAd: boolean;
}

interface CreateForm {
  templateCode: TemplateCode;
  name: string;
  customObjective: string;
  callbackNumber: string;
  steps: StepInput[];
  budgetMonthly: string;
  thresholdCost: string;
  allowReentry: boolean | null;
  reentryCooldownDays: string;
}

const TEMPLATE_VISUAL: Record<TemplateCode, { icon: typeof UserPlus; gradient: string }> = {
  onboarding:  { icon: UserPlus,     gradient: 'from-emerald-400 to-teal-500' },
  repeat:      { icon: Repeat,       gradient: 'from-cyan-400 to-blue-500' },
  dormant:     { icon: Moon,         gradient: 'from-violet-400 to-indigo-500' },
  cart:        { icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500' },
  birthday:    { icon: Cake,         gradient: 'from-pink-400 to-rose-500' },
  reservation: { icon: CalendarIcon, gradient: 'from-blue-400 to-indigo-500' },
  custom:      { icon: Sparkles,     gradient: 'from-fuchsia-400 to-purple-500' },
};

const STATUS_BADGE: Record<JourneyStatus, { label: string; cls: string }> = {
  draft:  { label: '초안',     cls: 'bg-slate-700 text-slate-200' },
  active: { label: '활성',     cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
  paused: { label: '일시정지', cls: 'bg-amber-500/20 text-amber-300 border border-amber-400/30' },
  ended:  { label: '종료',     cls: 'bg-slate-800 text-slate-400' },
};

function buildPreview(message: string, isAd: boolean, channel: ChannelType, opt080: string): string {
  if (!isAd || !message) return message;
  const isLms = channel === 'lms' || channel === 'mms';
  const adPrefix = isLms ? '(광고) ' : '(광고)';
  const rejectText = opt080
    ? (isLms ? `\n무료수신거부 ${opt080}` : `\n무료거부${opt080.replace(/-/g, '')}`)
    : (isLms ? '\n무료수신거부' : '\n무료거부');
  return `${adPrefix}${message}${rejectText}`;
}

function getByteLength(s: string): number {
  // 한글 2바이트 + ASCII 1바이트 근사
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    bytes += s.charCodeAt(i) > 127 ? 2 : 1;
  }
  return bytes;
}

function hasPlaceholder(message: string): boolean {
  return message.includes('[') && message.includes(']');
}

export default function JourneysPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [journeys, setJourneys] = useState<JourneyRow[]>([]);
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const [callbackOptions, setCallbackOptions] = useState<CallbackOption[]>([]);
  const [opt080Number, setOpt080Number] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, JourneyDetail>>({});
  const [creating, setCreating] = useState<CreateForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState<{ stepIdx: number; candidates: RefineCandidate[] } | null>(null);
  const [refineLoading, setRefineLoading] = useState(false);

  const token = () => localStorage.getItem('token');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [jr, cr] = await Promise.all([
        fetch('/api/ai/operator/journeys?status=all', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/ai/operator/journeys-callback-numbers', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const jd = await jr.json();
      const cd = await cr.json();
      if (jd.success) {
        setJourneys(jd.journeys || []);
        setTemplates(jd.templates || []);
      } else if (jd.code === 'AI_OPERATOR_GATED') {
        setError('AI Operator 진입 권한이 없습니다. 관리자에게 문의해주세요.');
      } else {
        setError(jd.error || '여정 조회 실패');
      }
      if (cd.success) {
        setCallbackOptions(cd.numbers || []);
        setOpt080Number(cd.opt080Number || '');
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
    } catch {}
  };

  const toggleExpand = (journeyId: string) => {
    if (expandedId === journeyId) setExpandedId(null);
    else { setExpandedId(journeyId); loadDetail(journeyId); }
  };

  const handleStartCreate = (templateCode: TemplateCode) => {
    const tmpl = templates.find((t) => t.templateCode === templateCode);
    const defaultCallback = callbackOptions.find((c) => c.is_default)?.phone || (callbackOptions[0]?.phone || '');
    const initialSteps: StepInput[] = (tmpl?.steps || []).map((s, idx) => ({
      stepOrder: s.stepOrder || idx + 1,
      stepType: s.stepType || 'message',
      delayHours: s.delayHours || 0,
      channel: (s.channel || 'lms') as ChannelType,
      messageTemplate: s.messageTemplate || '',
      isAd: s.isAd !== false,
    }));
    setCreating({
      templateCode,
      name: '',
      customObjective: '',
      callbackNumber: defaultCallback,
      steps: initialSteps,
      budgetMonthly: '',
      thresholdCost: '',
      allowReentry: null,
      reentryCooldownDays: '',
    });
  };

  const updateStep = (idx: number, patch: Partial<StepInput>) => {
    if (!creating) return;
    const newSteps = [...creating.steps];
    newSteps[idx] = { ...newSteps[idx], ...patch };
    setCreating({ ...creating, steps: newSteps });
  };

  const handleRefineOpen = async (idx: number) => {
    if (!creating) return;
    const msg = creating.steps[idx].messageTemplate.trim();
    if (msg.length < 10) {
      alert('메시지를 10자 이상 작성한 후 다듬기를 사용해주세요.');
      return;
    }
    if (hasPlaceholder(msg)) {
      alert('미편집 [...] 영역이 남아있습니다. 회사 admin이 직접 작성한 본문에만 다듬기를 적용하세요.');
      return;
    }
    setRefineLoading(true);
    try {
      const res = await fetch('/api/ai/operator/journeys-refine-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          message: msg,
          channel: creating.steps[idx].channel,
          tone: 'seasonal',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRefining({ stepIdx: idx, candidates: data.candidates || [] });
      } else {
        alert(data.error || 'AI 다듬기 실패');
      }
    } catch (e: any) {
      alert(e?.message || '다듬기 중 오류');
    } finally {
      setRefineLoading(false);
    }
  };

  const handleAcceptRefine = (candidate: RefineCandidate) => {
    if (!creating || !refining) return;
    updateStep(refining.stepIdx, { messageTemplate: candidate.message });
    setRefining(null);
  };

  const handleCreate = async () => {
    if (!creating) return;
    if (!creating.callbackNumber) {
      alert('회신번호를 선택해주세요.');
      return;
    }
    if (creating.templateCode === 'custom' && !creating.customObjective.trim() && creating.steps.length === 0) {
      alert('Custom 여정은 목표(자연어) 또는 step 목록이 필요합니다.');
      return;
    }
    const invalid = creating.steps.find((s) => !s.messageTemplate.trim() || s.messageTemplate.trim().length < 10);
    if (invalid) {
      alert(`step ${invalid.stepOrder} 본문이 비어있거나 너무 짧습니다 (최소 10자).`);
      return;
    }
    const stillPlaceholder = creating.steps.find((s) => hasPlaceholder(s.messageTemplate));
    if (stillPlaceholder) {
      const ok = confirm(`step ${stillPlaceholder.stepOrder} 본문에 미편집 [...] 영역이 있습니다.\n초안으로 저장은 가능하지만 활성화 시 차단됩니다.\n계속 저장하시겠습니까?`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      const body: any = {
        templateCode: creating.templateCode,
        name: creating.name.trim() || undefined,
        customObjective: creating.customObjective.trim() || undefined,
        callbackNumber: creating.callbackNumber,
        steps: creating.steps,
        budgetMonthly: creating.budgetMonthly ? Number(creating.budgetMonthly) : null,
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
      action === 'activate' ? '여정을 활성화하시겠습니까? 트리거 조건에 맞는 고객이 진입하고 step별 메시지가 자동 발송됩니다.\n\n광고 자동 검증 4건이 모두 자동 부착됩니다 ((광고)+무료거부 080+발송시간 08~21시+KISA 제목).' :
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
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="AI Operator로 돌아가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-2xl font-bold truncate">여정 자동화 (Journey Builder Lite)</h1>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">7 표준 여정 + 자연어 진입 — 회사 admin이 메시지/회신번호 직접 설정</p>
          </div>
          <button onClick={loadAll} disabled={loading} className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50" aria-label="새로고침">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="max-w-7xl mx-auto px-3 md:px-6 flex gap-1">
          <button onClick={() => setTab('list')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === 'list' ? 'border-fuchsia-400 text-white' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            활성 여정 ({journeys.length})
          </button>
          <button onClick={() => setTab('create')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'create' ? 'border-fuchsia-400 text-white' : 'border-transparent text-white/50 hover:text-white/80'}`}>
            <Plus className="w-4 h-4" /> 신규 여정 생성
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-200 text-sm">{error}</div>
        )}

        {callbackOptions.length === 0 && !loading && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-200 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>회사에 등록된 발신번호가 없습니다. 여정 발송 전 발신번호를 먼저 등록해주세요.</div>
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
                <button onClick={() => setTab('create')} className="mt-4 px-4 py-2 bg-gradient-to-r from-fuchsia-500 to-purple-500 rounded-lg text-sm font-medium hover:opacity-90">
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
                  <div className="p-3 md:p-4 cursor-pointer hover:bg-white/[0.07] transition-colors" onClick={() => toggleExpand(j.id)}>
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
                          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {Number(j.stats_total_cost).toLocaleString()}원</span>
                          {j.callback_number && <span className="flex items-center gap-1 text-cyan-300/80"><Phone className="w-3 h-3" /> {j.callback_number}</span>}
                        </div>
                        {j.pause_reason && j.status === 'paused' && (
                          <div className="mt-1.5 text-xs text-amber-200/90 bg-amber-500/10 px-2 py-1 rounded">일시정지 사유: {j.pause_reason}</div>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {(j.status === 'draft' || j.status === 'paused') && (
                          <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'activate'); }} className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300" title="활성화">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {j.status === 'active' && (
                          <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'pause'); }} className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300" title="일시정지">
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        {j.status !== 'ended' && (
                          <button onClick={(e) => { e.stopPropagation(); handleAction(j.id, 'end'); }} className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300" title="종료">
                            <Power className="w-4 h-4" />
                          </button>
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && detail && (
                    <div className="border-t border-white/10 p-3 md:p-4 bg-slate-950/40">
                      <div className="text-xs text-white/60 mb-3">
                        <span>트리거: <span className="text-white/80">{detail.journey.trigger_event}</span></span>
                        {detail.journey.callback_number && <span className="ml-4">회신번호: <span className="text-white/80">{detail.journey.callback_number}</span></span>}
                      </div>
                      <div className="space-y-2">
                        {detail.steps.map((s) => (
                          <div key={s.id} className="flex items-start gap-3 p-2.5 bg-white/5 rounded-lg">
                            <div className="shrink-0 w-8 h-8 rounded-full bg-fuchsia-500/20 text-fuchsia-300 flex items-center justify-center text-sm font-semibold">{s.step_order}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white/50 mb-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 진입 후 {s.delay_hours}시간</span>
                                {s.channel && <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {s.channel.toUpperCase()}</span>}
                                {s.is_ad && <span className="text-amber-300/80">광고 표기</span>}
                              </div>
                              {s.message_template && <div className="text-sm text-white/90 whitespace-pre-wrap break-words">{s.message_template}</div>}
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

        {/* 신규 여정 생성 탭 — 템플릿 카드 선택 */}
        {!loading && tab === 'create' && !creating && (
          <div>
            <p className="text-sm text-white/60 mb-4">템플릿을 선택하면 step별 메시지 + 회신번호를 직접 편집할 수 있습니다. Custom은 자연어 또는 직접 작성 가능합니다.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {templates.map((t) => {
                const visual = TEMPLATE_VISUAL[t.templateCode] || TEMPLATE_VISUAL.custom;
                const Icon = visual.icon;
                return (
                  <button key={t.templateCode} onClick={() => handleStartCreate(t.templateCode)} className="text-left p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-colors">
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
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 md:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base md:text-lg font-semibold">
                {templates.find((t) => t.templateCode === creating.templateCode)?.name} 여정 생성
              </h3>
              <button onClick={() => setCreating(null)} className="text-white/40 hover:text-white/80 text-sm">취소</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">여정 이름 (선택)</label>
                <input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="비워두면 템플릿 기본 이름이 사용됩니다." className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">회신번호 <span className="text-rose-400">*</span></label>
                <select value={creating.callbackNumber} onChange={(e) => setCreating({ ...creating, callbackNumber: e.target.value })} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400">
                  <option value="">선택해주세요</option>
                  {callbackOptions.map((c) => (
                    <option key={`${c.source}-${c.phone}`} value={c.phone}>
                      {c.phone}{c.description ? ` (${c.description})` : ''}{c.is_default ? ' • 기본' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {creating.templateCode === 'custom' && (
              <div>
                <label className="block text-xs text-white/60 mb-1">여정 목표 (자연어, 선택)</label>
                <textarea value={creating.customObjective} onChange={(e) => setCreating({ ...creating, customObjective: e.target.value })} placeholder="예: 첫 구매 후 30일 동안 재구매 유도하기" rows={2} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400 resize-none" />
                <p className="mt-1 text-[11px] text-white/40">목표 입력 시 AI가 골격 step을 생성합니다. 회사 admin이 활성화 전 본문을 직접 편집해야 합니다.</p>
              </div>
            )}

            {/* Step 편집 영역 */}
            {creating.steps.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-white/80">Step별 메시지 — 회사 admin이 직접 작성</label>
                  <span className="text-[11px] text-amber-300/80">[...] 영역에 구체 혜택/URL을 직접 입력해주세요</span>
                </div>
                <div className="space-y-3">
                  {creating.steps.map((s, idx) => {
                    const bytes = getByteLength(s.messageTemplate);
                    const maxBytes = s.channel === 'sms' ? 90 : 2000;
                    const preview = buildPreview(s.messageTemplate, s.isAd, s.channel, opt080Number);
                    const previewBytes = getByteLength(preview);
                    const placeholderWarn = hasPlaceholder(s.messageTemplate);

                    return (
                      <div key={idx} className="p-3 bg-slate-900/60 border border-white/10 rounded-lg space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="shrink-0 w-7 h-7 rounded-full bg-fuchsia-500/20 text-fuchsia-300 flex items-center justify-center text-sm font-semibold">
                            {s.stepOrder}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-white/40" />
                            <input type="number" min={0} max={720} value={s.delayHours} onChange={(e) => updateStep(idx, { delayHours: Number(e.target.value) || 0 })} className="w-16 px-2 py-1 bg-slate-800 border border-white/10 rounded text-xs" />
                            <span className="text-xs text-white/50">시간 후</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MessageSquare className="w-3.5 h-3.5 text-white/40" />
                            <select value={s.channel} onChange={(e) => updateStep(idx, { channel: e.target.value as ChannelType })} className="px-2 py-1 bg-slate-800 border border-white/10 rounded text-xs">
                              <option value="sms">SMS</option>
                              <option value="lms">LMS</option>
                              <option value="mms">MMS</option>
                            </select>
                          </div>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input type="checkbox" checked={s.isAd} onChange={(e) => updateStep(idx, { isAd: e.target.checked })} className="rounded" />
                            <span className="text-amber-300/80">광고 표기</span>
                          </label>
                          <button type="button" onClick={() => handleRefineOpen(idx)} disabled={refineLoading} className="ml-auto px-2.5 py-1 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded text-xs flex items-center gap-1 disabled:opacity-50">
                            {refineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} AI 다듬기
                          </button>
                        </div>

                        <textarea value={s.messageTemplate} onChange={(e) => updateStep(idx, { messageTemplate: e.target.value })} rows={4} placeholder="회사가 제공할 혜택/안내를 직접 작성해주세요." className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded text-sm focus:outline-none focus:border-fuchsia-400 resize-y font-mono" />

                        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-white/40">
                          <span className={bytes > maxBytes ? 'text-rose-400' : ''}>본문: {bytes} / {maxBytes} bytes</span>
                          {placeholderWarn && <span className="text-amber-300/80">⚠ [...] 영역이 남아있습니다</span>}
                        </div>

                        {s.isAd && s.messageTemplate.trim().length >= 10 && (
                          <div className="p-2 bg-slate-950/60 border border-white/5 rounded text-[11px] text-white/60">
                            <div className="text-white/40 mb-1">실제 발송 미리보기 (자동 합성, {previewBytes} bytes):</div>
                            <div className="whitespace-pre-wrap text-white/80 font-mono">{preview}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">월간 예산 (원, 선택)</label>
                <input type="number" value={creating.budgetMonthly} onChange={(e) => setCreating({ ...creating, budgetMonthly: e.target.value })} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">step당 비용 한도 (원, 선택)</label>
                <input type="number" value={creating.thresholdCost} onChange={(e) => setCreating({ ...creating, thresholdCost: e.target.value })} placeholder="비워두면 무제한" className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-fuchsia-400" />
              </div>
            </div>

            <div className="text-xs text-white/40 bg-white/5 rounded-lg p-3 leading-relaxed">
              <div className="font-medium text-white/60 mb-1">광고 자동 검증 4건 (활성화 시 모두 자동 적용)</div>
              <ul className="space-y-0.5">
                <li>· (광고) 표기 자동 부착 (광고 표기 체크된 step)</li>
                <li>· 무료거부 080 자동 부착</li>
                <li>· 발송 시간 KST 08:00 ~ 21:00 자동 준수</li>
                <li>· KISA 제목 자동 적용 (LMS/MMS)</li>
              </ul>
              <div className="mt-2 text-amber-200/70">생성 직후 상태는 초안입니다. 활성화 버튼을 누르면 트리거 매칭이 시작됩니다.</div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setCreating(null)} disabled={saving} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">취소</button>
              <button onClick={handleCreate} disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} 초안 여정 생성
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI 다듬기 모달 */}
      {refining && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setRefining(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-400" /> AI 다듬기 후보</h3>
              <button onClick={() => setRefining(null)} className="text-white/40 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              {refining.candidates.length === 0 ? (
                <p className="text-sm text-white/60">생성된 후보가 없습니다.</p>
              ) : (
                refining.candidates.map((c, i) => (
                  <div key={i} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                    <div className="text-sm text-white/90 whitespace-pre-wrap mb-2 font-mono">{c.message}</div>
                    {c.reason && <div className="text-[11px] text-white/40 mb-2">{c.reason}</div>}
                    <button onClick={() => handleAcceptRefine(c)} className="px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded text-xs">이 후보 적용</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
