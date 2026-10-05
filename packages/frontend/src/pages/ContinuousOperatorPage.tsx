// AI 자동 마케팅 (Continuous Operator) — 재설계 (2026-06-27)
// ★ 2026-09-30 AI 존 대개편(설계서 §4-2): 첫 화면 = 승인할 제안(런처 2×2 → 명령 카드로 흡수).
//   한 줄 입력 = 자연어 시작(스마트 기본값 + 목표 → 크레딧 확인 → 생성) · 다른 방법 = 시나리오 · 세부설정 · 자세히 쓰기.
// ★ 2026-10-05 한 줄 · 자세히 쓰기 = 미리보기 먼저(5크레딧 · 등록 0) → [이대로 시작] 에서만 200(설계서 docs/2026-10-05-automarketing-preview-design.md).
// ★ 2026-10-05 신뢰 설계(docs/2026-10-05-automarketing-trust-design.md) — 같은 창이 첫 주 승인 · 다음 승인 · 조건 확인을 맡는다.
//   [문안 직접 쓰기] = AI 문안 없이 대상만(미리보기 0크레딧) · 창 편집(칸 · 기준 · 문안 분기 · 혜택)은 서버가 다시 계산한다.
//   탭 = 승인할 제안 / 실행 중(`?tab=running` · 허브 "관리 →" 착지). 핸들러·저장 계약은 그대로.
// native dialog 0(ConfirmModal·useToast). 모델명 0.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goUpTo } from '../lib/scroll-restoration';
import { Check, GitMerge, LayoutGrid, Loader2, PenLine, SlidersHorizontal, Sparkles, TrendingUp } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import ZoneSection from '../components/zone/ZoneSection';
import ZoneSegmented from '../components/zone/ZoneSegmented';
import ZoneStatStrip from '../components/zone/ZoneStatStrip';
import { zoneModule } from '../constants/ai-operator-modules';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { AI_GENERATE_COSTS } from '../constants/credit';
import { useToast } from '../components/ToastProvider';
import {
  ContinuousOperator, OperatorProposal, ProposalVariant, BanditRecommendation,
  LearningSummary, AutoMarketingView, ProposalApproveSelection, AutoMarketingRoi, won,
} from '../components/automarketing/types';
import ProposalDecisionCard from '../components/automarketing/ProposalDecisionCard';
import NaturalLanguageStart from '../components/automarketing/NaturalLanguageStart';
import ScenarioStart, { ScenarioPick } from '../components/automarketing/ScenarioStart';
import OperatorSetupModal from '../components/automarketing/OperatorSetupModal';
import MultiGoalModal from '../components/automarketing/MultiGoalModal';
import OperatorsManageList from '../components/automarketing/OperatorsManageList';
import DailyBriefCard, { DailyBrief, DailyBriefRecommendation } from '../components/automarketing/DailyBriefCard';
import OperatorPreviewModal, { OperatorPreviewData } from '../components/automarketing/OperatorPreviewModal';
import { MK_LINE_EXTRA_BTN } from '../utils/make-ui';

/** 하위 보기의 머리 표시(제목은 메뉴 이름 한 벌 · 하위 위치만 "› …") */
const VIEW_SUB: Partial<Record<AutoMarketingView, string>> = {
  natural: '자세히 쓰기',
  scenario: '시나리오로 시작',
};

/** 승인 기간 끝(KST) 「10월 12일」 */
const untilLabel = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });

const SMART_DEFAULTS: Partial<ContinuousOperator> = {
  schedule: 'daily', scheduleTime: '09:00', status: 'active', channel: 'lms',
};

export default function ContinuousOperatorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ★ 2026-09-30: 첫 화면 = 승인할 제안. 실행 중 탭은 주소가 소유(허브 "관리 →" = ?tab=running)
  const [view, setView] = useState<AutoMarketingView>(() => (searchParams.get('tab') === 'running' ? 'operators' : 'recommendations'));
  const [line, setLine] = useState('');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [operators, setOperators] = useState<ContinuousOperator[]>([]);
  const [proposals, setProposals] = useState<OperatorProposal[]>([]);
  const [proposalStatus, setProposalStatus] = useState<'pending' | 'all'>('pending');
  const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(null);
  const [dailyBrief, setDailyBrief] = useState<DailyBrief | null>(null);
  // ★ 2026-07-12 C-3③: 최근 30일 매출 귀속(ROI) — 런처 상설 카드(성과 화면과 동일 endpoint)
  const [roi, setRoi] = useState<AutoMarketingRoi | null>(null);
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
  // ★ 2026-10-05 [제안 받기] = 미리보기 — 등록 전에 첫 제안을 보여 주고, 200은 [이대로 시작]에서만.
  // mode = new(처음 시작 · 서버 보관본) · renewal(실행 중의 다음 승인 · 조건 확인)
  const [preview, setPreview] = useState<{ mode: 'new' | 'renewal'; config: Partial<ContinuousOperator>; data: OperatorPreviewData | null; operatorId: string | null } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [ownCopy, setOwnCopy] = useState(false);   // [문안 직접 쓰기] — 켜면 AI 문안 없이 대상만(0크레딧)
  const [previewing, setPreviewing] = useState(false);
  const [startConfirm, setStartConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const previewGen = useRef(0);   // 닫기 · 새 요청 = 세대 증가 → 늦게 온 결과는 버린다(닫기를 잠그지 않는다)

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
      const [opRes, propRes, learnRes, briefRes, roiRes] = await Promise.all([
        fetch('/api/ai/operator/continuous', { headers: auth() }),
        fetch(`/api/ai/operator/proposals?status=${proposalStatus}`, { headers: auth() }),
        fetch('/api/ai/operator/continuous/learning-summary', { headers: auth() }),
        fetch('/api/ai/operator/daily-brief', { headers: auth() }),
        fetch('/api/ai/operator/performance/automarketing-roi?days=30', { headers: auth() }),
      ]);
      const opData = await opRes.json();
      const propData = await propRes.json();
      const learnData = await learnRes.json();
      const briefData = await briefRes.json().catch(() => ({ success: false }));
      const roiData = await roiRes.json().catch(() => ({ success: false }));
      if (opData.success) setOperators(opData.operators || []);
      if (propData.success) setProposals(propData.proposals || []);
      if (learnData.success) setLearningSummary(learnData.summary || null);
      // 브리핑은 부가 정보 — 미생성(503)·오류 시 조용히 숨김
      if (briefData.success) setDailyBrief(briefData.brief || null);
      // ROI는 부가 정보 — 오류 시 조용히 숨김
      if (roiData.success) setRoi(roiData.roi || null);
      if (!opRes.ok && opData.code === 'BETA_GATE') setError('본 기능은 요금제 가입 후 이용 가능합니다.');
      setLoadedAt(new Date());
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [proposalStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 ↔ 주소: 실행 중이면 ?tab=running, 그 밖은 비움(뒤로가기가 탭을 되돌리지 않게 replace)
  useEffect(() => {
    const want = view === 'operators' ? 'running' : null;
    if (searchParams.get('tab') !== want) {
      const next = new URLSearchParams(searchParams);
      if (want) next.set('tab', want); else next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

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
    admin_phone_numbers: e.adminPhoneNumbers || [],
    backup_admin_phone: e.backupAdminPhone,
    admin_alert_channel: e.adminAlertChannel || 'sms',
    auto_send_lead_minutes: e.autoSendLeadMinutes ?? 120,
    send_time_mode: e.sendTimeMode === 'ai_optimal' ? 'ai_optimal' : 'fixed',
    copy_style: e.copyStyle ?? null,
    // ★ 2026-08-03 타겟팅 재설계: 발송 대상 계약 — 고르면 매 회차 같은 조건으로 컴파일된다.
    segment_key: e.segmentKey ?? null,
    segment_params: e.segmentParams ?? null,
    // ★ 2026-08-04: 화면에서 축 선택 UI를 보고 저장했는가 — true면 서버 AI 매핑이 개입하지 않는다
    //   (명시적 "자동 판단" 선택을 1회 고정으로 덮으면 화면이 거짓말이 된다). 자연어·추천 흐름은 미전송.
    segment_choice_seen: e.segmentChoiceSeen === true,
    // ⛔ 2026-08-03 6R·8R 정정: 옛 축(target_hint)은 3상태로 다룬다.
    //   미전송 = 서버 유지(무관한 수정이 옛 축을 지우면 안 된다) / 사용자가 "자동 판단"을 명시적으로 고른 경우에만 해제.
    //   계약을 고르면 서버가 상호배타로 해제하므로 그때는 보낼 필요가 없다.
    ...(e.targetHintTouched ? { target_hint: null } : {}),
    channel: e.channel || 'lms',
    // ★ 2026-07-30 (임은지 접수): MMS 이미지 — mms가 아니면 null(해제)로 보내 채널 전환 시 이미지 잔존 차단
    mms_image_paths: (e.channel === 'mms') ? (e.mmsImagePaths ?? []) : null,
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
      setLine('');
      // ★ 2026-08-04 계약 필수화 — 등록 1회 AI 매핑으로 축이 고정됐으면 즉시 알린다.
      //   사용자 몰래 고정되는 상태를 만들지 않는다(수정 화면에서 언제든 바꿀 수 있다).
      if (data.appliedSegment?.label) {
        toast.info(`발송 대상을 '${data.appliedSegment.label}' 기준으로 고정했습니다. 매 회차 같은 기준으로 나가며, 수정에서 바꿀 수 있습니다.`);
      }
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
  // ★ 2026-08-04: 모달을 거친 등록은 사용자가 SegmentPicker를 **봤다** — "목표 문장으로 자동 판단"을
  //   그대로 두고 저장한 것도 선택이다. 서버 AI 매핑이 그 선택을 덮지 않도록 표식을 실어 보낸다.
  const handleSetupSubmit = () => {
    if (!editing) return;
    if (editing.id) { updateOperator(); return; }
    setPendingConfig({ ...editing, segmentChoiceSeen: true });
  };

  // 자연어 제출(명령 카드 한 줄 · 자세히 쓰기): 스마트 기본값 + 목표 (+선택 문안 스타일) → 미리보기.
  // ★ 2026-10-05 옛: 바로 200 확인 창 → 등록 → 첫 초안(제안을 보기도 전에 200). 지금: 첫 제안을 먼저 보고 시작할지 정한다.
  const handleNaturalSubmit = (goal: string, copyStyle: 'courteous' | 'friendly' | 'witty' | 'punchy' | null) => {
    if (!goal || previewing) return;
    requestPreview({ ...SMART_DEFAULTS, name: goal.slice(0, 40), objective: goal, copyStyle }, ownCopy ? 'fixed' : 'ai');
  };

  const requestPreview = async (config: Partial<ContinuousOperator>, copyMode: 'ai' | 'fixed') => {
    const gen = ++previewGen.current;
    setPreview({ mode: 'new', config, data: null, operatorId: null });
    setPreviewing(true);
    try {
      const res = await fetch('/api/ai/operator/continuous/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        // infer_schedule = 서버가 문장의 주기(매일 · 매주 ○요일 · 매월 ○일 · 생일인 날)를 읽는다 · 없으면 매월
        body: JSON.stringify({ ...serialize(config), copy_mode: copyMode, infer_schedule: true }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (gen !== previewGen.current) return;
      if (!data.success) {
        setPreview(null);
        toast.error(data.error || '제안을 만들지 못했습니다.');
        return;
      }
      setPreview({ mode: 'new', config, data: data as OperatorPreviewData, operatorId: null });
    } catch (e: any) {
      if (gen !== previewGen.current) return;
      setPreview(null);
      toast.error(e?.message || '제안을 만들지 못했습니다.');
    } finally {
      if (gen === previewGen.current) setPreviewing(false);
    }
  };

  // ★ 2026-10-05 다음 승인 · 조건 확인 — 실행 중 자동 마케팅의 승인 창(AI 문안 0 · 차감 0)
  //   창 상태는 서버 보관본 하나(처음 시작과 같다) — 화면은 판 번호(revision)를 들고 편집 · 승인한다(본 것 = 저장한 것).
  const toApprovalData = (r: any): OperatorPreviewData =>
    ({ ...(r.outcome || {}), lastWindow: r.lastWindow ?? null, needsContract: !!r.needsContract }) as OperatorPreviewData;
  // 서버 응답(편집 결과 · 409 의 지금 상태)으로 창을 바꾼다 — 지난 기간 요약 · 조건 확인 여부는 창을 열 때 값을 잇는다
  const applyServerData = (next: any) =>
    setPreview((p) => (p ? {
      ...p,
      data: { ...next, lastWindow: p.data?.lastWindow ?? null, needsContract: p.data?.needsContract ?? false } as OperatorPreviewData,
    } : p));

  const openRenewal = async (op: ContinuousOperator) => {
    const gen = ++previewGen.current;
    setPreview({ mode: 'renewal', config: { name: op.name, objective: op.objective }, data: null, operatorId: op.id });
    setPreviewing(true);
    try {
      const res = await fetch(`/api/ai/operator/continuous/${op.id}/approval-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: '{}',
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (gen !== previewGen.current) return;
      if (!data.success) { setPreview(null); toast.error(data.error || '승인 창을 열지 못했습니다.'); return; }
      setPreview({ mode: 'renewal', config: { name: op.name, objective: op.objective }, data: toApprovalData(data), operatorId: op.id });
    } catch (e: any) {
      if (gen !== previewGen.current) return;
      setPreview(null);
      toast.error(e?.message || '승인 창을 열지 못했습니다.');
    } finally {
      if (gen === previewGen.current) setPreviewing(false);
    }
  };

  // 창 편집 — 처음 시작 · 다음 승인 모두 서버 보관본 편집(preview/update). 판이 다르면 서버가 지금 상태를 돌려준다(409).
  const editPreview = async (patch: Record<string, any>) => {
    const cur = preview;
    if (!cur?.data?.previewId) return;
    const gen = previewGen.current;
    setPreviewBusy(true);
    try {
      const res = await fetch('/api/ai/operator/continuous/preview/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ preview_id: cur.data.previewId, revision: cur.data.revision, ...patch }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (gen !== previewGen.current) return;
      if (!data.success) {
        toast.error(data.error || '고친 내용을 반영하지 못했습니다.');
        if (res.status === 409 && data.current) applyServerData(data.current);
        if (res.status === 410) setPreview(null);   // 만료 — 다시 열기(차감 0)
        return;
      }
      applyServerData(data);
    } catch (e: any) {
      toast.error(e?.message || '고친 내용을 반영하지 못했습니다.');
    } finally {
      if (gen === previewGen.current) setPreviewBusy(false);
    }
  };

  const closePreview = () => {
    if (starting) return;
    previewGen.current += 1;
    setPreview(null);
    setPreviewing(false);
    setPreviewBusy(false);
  };

  // [세부 설정에서 고치기] — 처음 시작 = 이 값(+ 고정된 대상 기준)으로 세부 설정 창(저장 = 기존 등록 경로 · 200 확인 창) · 다음 승인 = 그 자동 마케팅 수정
  const editFromPreview = () => {
    if (!preview?.data) return;
    const { config, data, mode, operatorId } = preview;
    previewGen.current += 1;
    setPreview(null);
    if (mode === 'renewal') {
      const op = operators.find((o) => o.id === operatorId);
      if (op) setEditing(op);
      return;
    }
    setEditing({ ...config, ...(data.segment.key ? { segmentKey: data.segment.key, segmentParams: data.segment.params } : {}) });
  };

  // [이번 주 승인하고 시작] — 미리보기 id 하나만 보낸다(서버가 보관한 입력 그대로 등록 · 승인 기간 · 본 제안 = 첫 회차).
  const startFromPreview = async () => {
    const id = preview?.data?.previewId;
    if (!id) return;
    setStarting(true);
    try {
      const res = await fetch('/api/ai/operator/continuous/from-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ preview_id: id, revision: preview?.data?.revision }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) {
        toast.error(data.error || '자동 마케팅을 시작하지 못했습니다.');
        if (res.status === 409 && data.current) applyServerData(data.current);   // 화면이 본 판이 아니었다 — 지금 상태로
        if (res.status === 410) setPreview(null);   // 만료 — 다시 [제안 받기](차감 0)
        return;
      }
      setPreview(null);
      setLine('');
      toast.success(data.approvedUntil ? `자동 마케팅을 시작했어요. ${untilLabel(data.approvedUntil)}까지 승인한 대로 나가요.` : '자동 마케팅이 시작되었습니다.');
      if (!data.proposal && data.message) toast.info(data.message);
      setProposalStatus('pending');
      setView(data.proposal ? 'recommendations' : 'operators');
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || '자동 마케팅을 시작하지 못했습니다.');
    } finally {
      setStarting(false);
    }
  };

  // [다음 주 승인] · [조건 확인] — 고친 값과 함께 승인 기간을 저장한다(차감 0 · 서버가 다시 검증)
  const approveRenewal = async () => {
    const opId = preview?.operatorId;
    if (!opId) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/ai/operator/continuous/${opId}/approve-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ preview_id: preview?.data?.previewId, revision: preview?.data?.revision }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) {
        toast.error(data.error || '승인을 저장하지 못했습니다.');
        if (res.status === 409 && data.current) applyServerData(data.current);
        if (res.status === 410) setPreview(null);
        return;
      }
      setPreview(null);
      toast.success(`승인했어요. ${untilLabel(data.approvedUntil)}까지 승인한 대로 나가요.`);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message || '승인을 저장하지 못했습니다.');
    } finally {
      setStarting(false);
    }
  };

  // 시나리오 선택: 세부설정 모달 prefill (가동 전 한 번 확인). 월간형(생일·VIP 데이)은 주기까지 프리필.
  // ★ 2026-08-04 계약 필수화 — 축이 정확히 맞는 시나리오는 계약까지 프리필. 모달 SegmentPicker에 선택된
  //   상태로 보여 사용자가 확인·변경한 뒤 저장된다(§4-3의 "AI 제안 → 담당자 확인 → 계약" 그대로).
  const handleScenarioSelect = (s: ScenarioPick) => {
    setEditing({
      ...SMART_DEFAULTS,
      name: s.name,
      objective: s.objective,
      ...(s.schedule ? { schedule: s.schedule } : {}),
      ...(s.scheduleDayOfMonth != null ? { scheduleDayOfMonth: s.scheduleDayOfMonth } : {}),
      ...(s.segmentKey ? { segmentKey: s.segmentKey, segmentParams: s.segmentParams ?? null } : {}),
    });
  };

  // 오늘의 브리핑 추천 → 한 클릭 시작: 크레딧 확인 → 생성 + 즉시 초안 (전체 AI 체인은 이 순간에만).
  // ★ 5차: 정착 제안(journey_promotion) = 여정 승격다리 재사용 / 채널 제안(email·dm) = 해당 채널 화면 안내.
  const handleBriefStart = (rec: DailyBriefRecommendation) => {
    if (rec.opportunityType === 'journey_promotion') {
      sessionStorage.setItem('journeyObjectivePrefill', JSON.stringify({ objective: rec.objective, message: '' }));
      toast.info('성과가 검증된 목표를 여정으로 가져갑니다. 생성·활성화는 여정에서 진행됩니다.');
      navigate('/ai-journeys');
      return;
    }
    if (rec.recommendedChannel === 'email') { navigate('/email-campaigns'); return; }
    if (rec.recommendedChannel === 'dm') { navigate('/dm-builder'); return; }
    if (!rec.objective) return;
    // ★ 2026-10-05 오늘의 추천도 한 줄과 같은 승인 창을 거친다 — 옛: 매일 기본값으로 바로 등록(같은 고객 매일 반복 · 대상 확인 없음).
    if (previewing) return;
    requestPreview({ ...SMART_DEFAULTS, name: rec.title.slice(0, 40), objective: rec.objective }, 'ai');
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
    toast.info('검증된 목표를 여정으로 가져갑니다. 생성·활성화는 여정에서 진행됩니다.');
    navigate('/ai-journeys');
  };

  const goHome = () => setView('recommendations');
  // ★ 2026-10-01 첫 화면 ← = 항상 허브(goUpTo · 머리 부품과 같은 규칙)
  const headerBack = () => (view === 'natural' || view === 'scenario' ? goHome() : goUpTo(navigate, '/ai-operator'));
  const oneLine = zoneModule('auto-marketing').oneLine!;
  const scheduledCount = proposals.filter((p) => p.status === 'scheduled').length;
  const stampText = loadedAt ? `${loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 기준 · 다시 읽기` : '다시 읽기';

  const tabId = view === 'operators' ? 'running' : 'pending';
  const subView = view === 'natural' || view === 'scenario';

  return (
    <ZoneFrame
      moduleId="auto-marketing"
      sub={VIEW_SUB[view] ?? null}
      onBack={headerBack}
      tabs={[
        { id: 'pending', label: '승인할 제안', count: pendingCount, unit: '건', dot: 'amber' },
        { id: 'running', label: '실행 중', count: activeCount, unit: '개', dot: 'emerald' },
      ]}
      activeTab={subView ? undefined : tabId}
      onSelectTab={(id) => setView(id === 'running' ? 'operators' : 'recommendations')}
      command={{
        line: {
          value: line,
          onChange: setLine,
          onSubmit: () => handleNaturalSubmit(line.trim(), null),
          placeholder: oneLine.placeholder,
          verb: oneLine.verb,
          icon: Sparkles,
          busy: creating || previewing,
          // ★ 2026-10-05 문안 직접 쓰기(Q15) — 켜면 AI 문안 없이 대상만 뽑아 보여 준다(0크레딧)
          credit: ownCopy ? '0크레딧' : `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`,
          extra: (
            <button
              type="button"
              onClick={() => setOwnCopy((v) => !v)}
              aria-pressed={ownCopy}
              className={`${MK_LINE_EXTRA_BTN} ${ownCopy ? '!border-indigo-500 !bg-indigo-50 !text-indigo-700' : ''}`}
            >
              {ownCopy ? <Check className="w-[15px] h-[15px]" /> : <PenLine className="w-[15px] h-[15px]" />}문안 직접 쓰기
            </button>
          ),
        },
      }}
      stamp={{ text: stampText, onRefresh: loadAll, loading }}
      start={subView ? null : {
        items: [
          { icon: LayoutGrid, title: '시나리오로 시작', desc: '검증된 시나리오를 골라 바로 시작', tint: 'from-indigo-500 to-violet-500', featured: true, badge: '추천', onClick: () => setView('scenario') },
          { icon: SlidersHorizontal, title: '세부설정으로 시작', desc: '채널·주기·예산을 직접 잡아 시작', tint: 'from-sky-400 to-indigo-500', onClick: () => setEditing({ ...SMART_DEFAULTS, name: '', objective: '' }) },
          { icon: PenLine, title: '자세히 쓰기', desc: '목표를 길게 쓰고 말투까지 골라요', tint: 'from-violet-400 to-fuchsia-500', onClick: () => setView('natural') },
          { icon: GitMerge, title: '여러 목표 분석', desc: '목표 여러 개를 한 번에 비교해요', tint: 'from-emerald-400 to-teal-500', onClick: () => setShowMultiGoal(true) },
        ],
      }}
      blocks={error ? [{ text: error, tone: 'rose' }] : []}
      emphasis={view === 'recommendations' && dailyBrief ? (
        <DailyBriefCard brief={dailyBrief} submitting={creating} onStart={handleBriefStart} />
      ) : null}
    >
      {loading && !subView ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 flex justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {view === 'recommendations' && (
            <div className="space-y-6">
              <ZoneStatStrip
                title="최근 30일 성과"
                icon={TrendingUp}
                source="발송 후 7일 구매 귀속 · 최근 30일 실측 · 회사별 누적 학습"
                cells={[
                  { label: '발송 예약', value: `${scheduledCount}건` },
                  { label: '발송 캠페인', value: roi ? `${roi.campaigns.toLocaleString()}건` : '—' },
                  { label: '발송', value: roi ? `${roi.totalSent.toLocaleString()}명` : '—' },
                  { label: '비용', value: roi ? won(roi.spendKrw) : '—' },
                  // 못 읽음(null) · 미연동(false) · 연동(true)을 가른다 — 조회 실패를 "연동 후"로 보이지 않게(Codex v3 R1)
                  !roi ? { label: '귀속 매출', value: '—' }
                    : roi.hasCdpData ? { label: '귀속 매출(7일)', value: won(roi.revenue7dKrw), tone: 'emerald' }
                      : { label: '귀속 매출', value: '연동 후' },
                  { label: '성공 패턴', value: learningSummary ? `${learningSummary.memory.successPatterns}건` : '—' },
                  { label: '승인률', value: learningSummary && learningSummary.performance.totalProposals30d > 0 ? `${Math.round((learningSummary.performance.approvedCount / learningSummary.performance.totalProposals30d) * 100)}%` : '—' },
                  { label: '학습', value: learningSummary ? `${learningSummary.memory.total}건` : '—' },
                ]}
                footnote={(learningSummary?.variantWinner && learningSummary.variantWinner.sent > 0) || roi ? (
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {roi && (roi.hasCdpData
                      ? (roi.purchases7d > 0 && <span>발송 후 7일 안 구매 {roi.purchases7d.toLocaleString()}건이 귀속된 실측 매출입니다.</span>)
                      : <span>매출 귀속은 자사몰 연동(구매 데이터 수집) 후 표시됩니다.</span>)}
                    {learningSummary?.variantWinner && learningSummary.variantWinner.sent > 0 && (
                      <span>지난 14일 가장 효과 좋은 변형 = <b className="font-semibold text-slate-700">변형 {learningSummary.variantWinner.variantLabel}</b> (클릭률 {(learningSummary.variantWinner.ctr * 100).toFixed(1)}% · 발송 {learningSummary.variantWinner.sent}건)</span>
                    )}
                  </span>
                ) : null}
              />
              <div className="min-w-0">
                <ZoneSection
                  title="승인할 제안"
                  filter={(
                    <ZoneSegmented
                      ariaLabel="제안 거르기"
                      items={[{ id: 'pending', label: '대기', count: pendingCount }, { id: 'all', label: '전체' }]}
                      value={proposalStatus}
                      onChange={(id) => setProposalStatus(id)}
                    />
                  )}
                  desc="확인하고 승인하면 발송됩니다"
                />
                <div className="space-y-3">
                {proposals.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                    <div className="text-[15px] font-semibold text-slate-900">{proposalStatus === 'pending' ? '승인할 제안이 없습니다' : '제안이 없습니다'}</div>
                    <div className="text-[13px] text-slate-500 mt-1">자동 마케팅이 켜져 있으면 정해진 시간에 AI가 새 캠페인을 제안합니다. 지금 바로 시작하려면 위에 한 줄로 목표를 쓰세요.</div>
                    {activeCount > 0 && (
                      <button type="button" onClick={() => setView('operators')} className="mt-3 text-[13px] font-semibold text-indigo-600 hover:underline">실행 중 {activeCount} →</button>
                    )}
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
              </div>
            </div>
          )}

          {view === 'natural' && <div className="max-w-3xl mx-auto"><NaturalLanguageStart submitting={creating || previewing} onSubmit={handleNaturalSubmit} /></div>}

          {view === 'scenario' && <ScenarioStart onSelect={handleScenarioSelect} />}

          {view === 'operators' && (
            <div>
              <OperatorsManageList
                operators={operators}
                onRunNow={handleRunNow}
                onEdit={(op) => setEditing(op)}
                onApprove={openRenewal}
                onDelete={handleDelete}
                onCreate={() => setEditing({ ...SMART_DEFAULTS, name: '', objective: '' })}
              />
            </div>
          )}
        </>
      )}

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
      <OperatorPreviewModal
        open={!!preview}
        mode={preview?.mode || 'new'}
        loading={previewing}
        busy={previewBusy}
        objective={preview?.config.objective || ''}
        data={preview?.data || null}
        starting={starting}
        onClose={closePreview}
        onEdit={editFromPreview}
        onStart={() => (preview?.mode === 'renewal' ? approveRenewal() : setStartConfirm(true))}
        onConditions={(conditions) => editPreview({ conditions })}
        onAxis={(segmentKey) => editPreview({ segment_key: segmentKey })}
        onCopyMode={(m) => editPreview({ copy_mode: m })}
        onFixedCopy={(subject, body) => editPreview({ fixed_subject: subject, fixed_body: body })}
        onBenefit={(benefit) => editPreview({ benefit })}
      />
      <CreditConfirmModal
        open={startConfirm}
        source="continuous-operator"
        description="승인한 기간 동안 회차마다 자동으로 나가요. 보낸 날만 발송 크레딧이 차감돼요."
        onConfirm={() => { setStartConfirm(false); startFromPreview(); }}
        onCancel={() => setStartConfirm(false)}
      />
      <CreditConfirmModal
        open={!!pendingConfig}
        source="continuous-operator"
        onConfirm={() => { const c = pendingConfig; setPendingConfig(null); if (c) createOperator(c); }}
        onCancel={() => setPendingConfig(null)}
      />
    </ZoneFrame>
  );
}

