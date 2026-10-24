// AI 자동 마케팅 (Continuous Operator) — 재설계 (2026-06-27)
// ★ 2026-09-30 AI 존 대개편(설계서 §4-2): 첫 화면 = 승인할 제안(런처 2×2 → 명령 카드로 흡수).
//   한 줄 입력 = 자연어 시작(스마트 기본값 + 목표 → 크레딧 확인 → 생성) · 다른 방법 = 시나리오 · 세부설정 · 자세히 쓰기.
// ★ 2026-10-05 한 줄 · 자세히 쓰기 = 미리보기 먼저(5크레딧 · 등록 0) → [이대로 시작] 에서만 200(설계서 docs/2026-10-05-automarketing-preview-design.md).
// ★ 2026-10-05 신뢰 설계(docs/2026-10-05-automarketing-trust-design.md) — 같은 창이 첫 주 승인 · 다음 승인 · 조건 확인을 맡는다.
// ★ 2026-10-24 한 줄 → 모자란 것만 묻는다 · 한 창 두 상태 · 돈은 두 순간(설계서 docs/2026-10-24-automarketing-oneline-design.md).
//   요청 키 = 한 줄마다 하나(RequestKeys · 결과 모름 재전송 = 같은 키 = 차감 0) · 시작 키 = 미리보기 id · 뒤에 뜨던 크레딧 확인 창 없음.
//   세부설정 · 시나리오 · 오늘의 추천 · 한 줄 답 카드도 이 창 하나로 시작한다(POST /operator/continuous = 마케팅 캘린더 전용).
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
// ★ 2026-10-10 한 줄 묻기 — 질문이면 오늘의 추천으로 답한다(설계서 docs/2026-10-10-oneline-ask-design.md)
import { useLineAsk } from '../hooks/useLineAsk';
import { RequestKeys } from '../utils/request-id';
import LineAnswer from '../components/zone/LineAnswer';

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
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showMultiGoal, setShowMultiGoal] = useState(false);
  // ★ 2026-10-05 [제안 받기] = 미리보기 — 등록 전에 첫 제안을 보여 주고, 200은 [이대로 시작]에서만.
  // mode = new(처음 시작 · 서버 보관본) · renewal(실행 중의 다음 승인 · 조건 확인)
  const [preview, setPreview] = useState<{ mode: 'new' | 'renewal'; config: Partial<ContinuousOperator>; data: OperatorPreviewData | null; operatorId: string | null } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewBusyText, setPreviewBusyText] = useState<string | undefined>(undefined);
  // ★ 2026-10-24 시작 응답을 못 받았다 — 새로 시작하지 않고 [시작됐는지 확인하기](같은 미리보기 id = 같은 행 · 차감 0)
  const [startUnknown, setStartUnknown] = useState(false);
  const startVariant = useRef<number | null>(null);
  // ★ 2026-10-24 5를 낸 뒤 닫은 창 = 숨김 · [만들어 둔 제안 보기](같은 한 줄 · 같은 키 = 보관본 그대로 · 0 · 30분)
  const [parked, setParked] = useState<{ config: Partial<ContinuousOperator>; copyMode: 'ai' | 'fixed'; ai: boolean; at: number } | null>(null);
  // ★ 2026-10-24 요청 키 — 한 줄마다 하나 · 시작에 성공해 그 한 줄의 일이 끝났을 때만 지운다(회의론자 §9-5)
  const previewKeys = useRef(new RequestKeys());
  const [ownCopy, setOwnCopy] = useState(false);   // [문안 직접 쓰기] — 켜면 AI 문안 없이 대상만(0크레딧)
  // ★ 2026-10-10 한 줄 묻기 — 판정은 한 줄 입구에서만(「자세히 쓰기」 · 오늘의 추천 카드는 그대로)
  const lineAsk = useLineAsk('auto-marketing');
  const [previewing, setPreviewing] = useState(false);
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
      toast.info(`성과 분석에서 추천한 목표를 가져왔어요(대상 ${(prefill.targetCount || 0).toLocaleString()}명). 확인하고 시작해 주세요.`);
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
    // ★ 2026-10-07 회신번호 — 바꿨을 때만 보낸다(안 바꾼 저장은 서버 값 그대로)
    ...(e.callbackTouched ? { callback_number: e.useIndividualCallback ? null : (e.callbackNumber ?? null), use_individual_callback: e.useIndividualCallback === true } : {}),
    // ★ 2026-07-30 (임은지 접수): MMS 이미지 — mms가 아니면 null(해제)로 보내 채널 전환 시 이미지 잔존 차단
    mms_image_paths: (e.channel === 'mms') ? (e.mmsImagePaths ?? []) : null,
    benefit_content: e.benefitContent ?? null,
    sequence_enabled: e.sequenceEnabled === true,
    sequence_delay_days: e.sequenceEnabled ? (e.sequenceDelayDays ?? 3) : null,
    sequence_reminder_content: e.sequenceEnabled ? (e.sequenceReminderContent ?? null) : null,
  });

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

  // 세부설정 모달 제출: 수정이면 PUT, 신규면 ★ 2026-10-24 같은 한 창(미리보기 · 질문 · 승인)으로 — 옛: 200 확인 창 → 바로 등록.
  //   모달에서 고른 주기 · 시각 · 번호 · 혜택이 그대로 간다(infer_schedule 없음 = 사람이 쓴 주기).
  const handleSetupSubmit = () => {
    if (!editing) return;
    if (editing.id) { updateOperator(); return; }
    const cfg = { ...editing, segmentChoiceSeen: true };
    setEditing(null);
    void requestPreview(cfg, 'ai', { explicit: true });
  };

  // 자연어 제출(명령 카드 한 줄 · 자세히 쓰기): 스마트 기본값 + 목표 (+선택 문안 스타일) → 미리보기.
  // ★ 2026-10-05 옛: 바로 200 확인 창 → 등록 → 첫 초안(제안을 보기도 전에 200). 지금: 첫 제안을 먼저 보고 시작할지 정한다.
  const handleNaturalSubmit = (goal: string, copyStyle: 'courteous' | 'friendly' | 'witty' | 'punchy' | null) => {
    if (!goal || previewing) return;
    requestPreview({ ...SMART_DEFAULTS, name: goal.slice(0, 40), objective: goal, copyStyle }, ownCopy ? 'fixed' : 'ai');
  };

  /** 이 한 줄(+ 문안 방식 · 입구)의 요청 키 이름 — 같은 이름 = 같은 키 */
  const keyName = (config: Partial<ContinuousOperator>, copyMode: 'ai' | 'fixed', o: { explicit?: boolean; ai?: boolean }) =>
    `${o.explicit ? 'setup' : o.ai ? 'ai' : 'line'}|${copyMode}|${config.objective || ''}`;

  const requestPreview = async (config: Partial<ContinuousOperator>, copyMode: 'ai' | 'fixed', o: { explicit?: boolean; ai?: boolean } = {}) => {
    const gen = ++previewGen.current;
    setPreview({ mode: 'new', config, data: null, operatorId: null });
    setPreviewing(true);
    setStartUnknown(false);
    setParked(null);
    try {
      const res = await fetch('/api/ai/operator/continuous/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        // infer_schedule = 서버가 문장의 주기 · 시각을 읽는다(세부 설정 = 고른 주기 그대로) · 오늘의 추천 · 답 카드 = AI 가 쓴 목표(혜택을 채우지 않는다)
        body: JSON.stringify({
          ...serialize(config), copy_mode: copyMode,
          ...(o.explicit ? {} : { infer_schedule: true }),
          ...(o.ai ? { objective_source: 'ai' } : {}),
          request_key: previewKeys.current.keyFor(keyName(config, copyMode, o)),
        }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (gen !== previewGen.current) return;
      if (!data.success) {
        setPreview(null);
        toast.error(data.error || '제안을 만들지 못했습니다.');
        return;
      }
      setPreview({ mode: 'new', config: { ...config, _copyMode: copyMode, _ai: !!o.ai, _explicit: !!o.explicit } as any, data: data as OperatorPreviewData, operatorId: null });
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
  const editPreview = async (patch: Record<string, any>, busyText?: string) => {
    const cur = preview;
    if (!cur?.data?.previewId) return;
    const gen = previewGen.current;
    setPreviewBusyText(busyText);
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
    // ★ 2026-10-24 문안까지 만든 창(5를 냈다) = 숨김 — [만들어 둔 제안 보기]가 같은 키로 다시 연다(보관본 그대로 · 0)
    const cur = preview;
    if (cur?.mode === 'new' && cur.data?.proposal && !startUnknown) {
      const c: any = cur.config;
      setParked({ config: cur.config, copyMode: c._copyMode || 'ai', ai: !!c._ai, at: Date.now() });
    }
    previewGen.current += 1;
    setPreview(null);
    setPreviewing(false);
    setPreviewBusy(false);
    setStartUnknown(false);
  };
  const reopenParked = () => {
    if (!parked || Date.now() - parked.at > 30 * 60 * 1000) { setParked(null); return; }
    const c: any = parked.config;
    void requestPreview(parked.config, parked.copyMode, { ai: parked.ai, explicit: !!c._explicit });
  };

  // [세부 설정에서 고치기] — ★ 2026-10-24 다음 승인 창에만(그 자동 마케팅 수정) · 새 시작 창의 버튼은 지웠다(그 창 안에서 다 고친다)
  const editFromPreview = () => {
    if (!preview?.data || preview.mode !== 'renewal') return;
    const { operatorId } = preview;
    previewGen.current += 1;
    setPreview(null);
    const op = operators.find((o) => o.id === operatorId);
    if (op) setEditing(op);
  };

  // [이번 주 승인하고 시작] — 미리보기 id(= 운영자 행 id) · 판 · 지금 보고 있는 안 번호만 보낸다(서버가 보관한 입력 그대로 등록 · 본 안 = 첫 회차).
  const startFromPreview = async (variantIndex: number | null) => {
    const id = preview?.data?.previewId;
    if (!id) return;
    startVariant.current = variantIndex;   // [시작됐는지 확인하기]가 같은 안 번호로 다시 보낸다(Codex 1R)
    setStarting(true);
    try {
      let res: Response;
      try {
        res = await fetch('/api/ai/operator/continuous/from-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({ preview_id: id, revision: preview?.data?.revision, variant_index: variantIndex }),
        });
      } catch {
        // 응답을 못 받았다 = 시작됐는지 모른다 — 새로 시작하지 않고 확인만(같은 id = 같은 행)
        setStartUnknown(true);
        toast.error('시작 결과를 받지 못했어요. [시작됐는지 확인하기]를 눌러 주세요.');
        return;
      }
      const data = await res.json().catch(() => ({ success: false }));
      if (!data.success) {
        if (res.status >= 500 || res.status === 409 && data.code === 'PREVIEW_BUSY') setStartUnknown(true);
        toast.error(data.error || '자동 마케팅을 시작하지 못했습니다.');
        if (res.status === 409 && data.current) applyServerData(data.current);   // 화면이 본 판이 아니었다 — 지금 상태로
        if (res.status === 410) {
          // 410 = 그 미리보기로 만든 행이 없다(시작되지 않았다 · 처리 중이면 409 다) — 같은 한 줄로 다시 만들면 같은 키라 5 가 다시 빠지지 않는다
          if (startUnknown) toast.info('시작되지 않았어요. 같은 한 줄로 다시 만들어 주세요. 크레딧은 다시 빠지지 않아요.');
          setStartUnknown(false);
          setPreview(null);
        }
        return;
      }
      const c: any = preview?.config || {};
      previewKeys.current.settled(keyName(preview?.config || {}, c._copyMode || 'ai', { ai: !!c._ai, explicit: !!c._explicit }));
      setStartUnknown(false);
      setParked(null);
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
        // 410 = 창 만료 · SCHEDULE_CHANGED = 창을 연 뒤 일정이 바뀜 — 둘 다 이 창으로는 저장할 수 없어 닫는다(다시 열면 지금 일정)
        if (res.status === 410 || data.code === 'SCHEDULE_CHANGED') setPreview(null);
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
      // ★ 2026-10-24 결함 14 — 여정 입구 한 길(?objective= · 문장으로 만들기 창)
      navigate(`/ai-journeys?objective=${encodeURIComponent(rec.objective || '')}`);
      return;
    }
    if (rec.recommendedChannel === 'email') { navigate('/email-campaigns'); return; }
    if (rec.recommendedChannel === 'dm') { navigate('/dm-builder'); return; }
    if (!rec.objective) return;
    // ★ 2026-10-05 오늘의 추천도 한 줄과 같은 승인 창을 거친다 — 옛: 매일 기본값으로 바로 등록(같은 고객 매일 반복 · 대상 확인 없음).
    if (previewing) return;
    // ★ 2026-10-24 AI 가 쓴 목표 = 읽은 조각 취급(혜택 숫자를 채우지 않는다 · 값이 없으면 묻는다)
    requestPreview({ ...SMART_DEFAULTS, name: rec.title.slice(0, 40), objective: rec.objective }, 'ai', { ai: true });
  };

  // ── 제안 액션 (ConfirmModal) ──
  const proposalAction = async (path: string, body?: object): Promise<any> => {
    try {
      const res = await fetch(`/api/ai/operator/proposals/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({ success: false }));
      return { ...d, status: res.status };
    } catch {
      return { success: false, error: '서버에 닿지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
    }
  };

  const handleApprove = (p: OperatorProposal, selection: ProposalApproveSelection) => {
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
        if (d.success) { toast.success(d.message || '발송을 시작했어요.'); await loadAll(); return; }
        toast.error(d.error || '승인하지 못했습니다.');
        // ★ 2026-10-24 본 뒤 혜택 · 번호가 바뀌었다 = 바뀐 문안으로 다시 보여 준다(그 문안을 보고 다시 승인)
        if (d.code === 'FINAL_CHANGED') await loadAll();
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
    description: (() => {
      const open = proposals.filter((p) => p.operatorId === id && ['pending', 'admin_review', 'scheduled'].includes(p.status)).length;
      return `이 자동 마케팅을 보관함으로 이동할까요?\n새 회차 제안이 바로 멈춰요.${open > 0 ? `\n승인 대기 · 예약 제안 ${open}건도 함께 닫아요.` : ''}`;
    })(),
    onConfirm: async () => {
      const res = await fetch(`/api/ai/operator/continuous/${id}`, { method: 'DELETE', headers: auth() });
      const d = await res.json();
      if (d.success) { toast.success('자동 마케팅이 중지되었습니다.'); await loadAll(); } else toast.error(d.error || '중지에 실패했습니다.');
    },
  });

  // 승격 다리 — 검증된 자동마케팅 캠페인의 목표를 여정으로 넘긴다(기존 여정 생성·활성화·사전테스트 게이트 재사용, 우회 없음).
  // ★ 2026-10-24 결함 14 — 여정 입구 한 길(?objective= · 문장으로 만들기 창 · 옛: 없는 「검토 단계」를 안내하고 문안은 버려졌다)
  const handlePromoteToJourney = (p: OperatorProposal) => {
    const objective = p.operatorObjective || p.proposalJson?.target?.criteria || '';
    navigate(`/ai-journeys?objective=${encodeURIComponent(objective)}`);
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
          onSubmit: () => {
            const t = line.trim();
            void (async () => {
              if (await lineAsk.route(t)) return;
              void handleNaturalSubmit(t, null);
            })();
          },
          placeholder: oneLine.placeholder,
          verb: oneLine.verb,
          icon: Sparkles,
          busy: previewing || lineAsk.judging,
          // ★ 2026-10-05 문안 직접 쓰기(Q15) — 켜면 AI 문안 없이 대상만 뽑아 보여 준다(0크레딧)
          credit: ownCopy ? '0크레딧' : `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`,
          extra: (
            <>
              <button
                type="button"
                onClick={() => setOwnCopy((v) => !v)}
                aria-pressed={ownCopy}
                className={`${MK_LINE_EXTRA_BTN} ${ownCopy ? '!border-indigo-500 !bg-indigo-50 !text-indigo-700' : ''}`}
              >
                {ownCopy ? <Check className="w-[15px] h-[15px]" /> : <PenLine className="w-[15px] h-[15px]" />}문안 직접 쓰기
              </button>
              {parked && Date.now() - parked.at < 30 * 60 * 1000 && (
                <button type="button" onClick={reopenParked} className={MK_LINE_EXTRA_BTN}>
                  <Sparkles className="w-[15px] h-[15px]" />만들어 둔 제안 보기
                </button>
              )}
            </>
          ),
        },
      }}
      stamp={{ text: stampText, onRefresh: loadAll, loading }}
      start={subView || lineAsk.hasCards ? null : {
        items: [
          { icon: LayoutGrid, title: '시나리오로 시작', desc: '검증된 시나리오를 골라 바로 시작', tint: 'from-indigo-500 to-violet-500', featured: true, badge: '추천', onClick: () => setView('scenario') },
          { icon: SlidersHorizontal, title: '세부설정으로 시작', desc: '채널·주기·예산을 직접 잡아 시작', tint: 'from-sky-400 to-indigo-500', onClick: () => setEditing({ ...SMART_DEFAULTS, name: '', objective: '' }) },
          { icon: PenLine, title: '자세히 쓰기', desc: '목표를 길게 쓰고 말투까지 골라요', tint: 'from-violet-400 to-fuchsia-500', onClick: () => setView('natural') },
          { icon: GitMerge, title: '여러 목표 분석', desc: '목표 여러 개를 한 번에 비교해요', tint: 'from-emerald-400 to-teal-500', onClick: () => setShowMultiGoal(true) },
        ],
      }}
      blocks={error ? [{ text: error, tone: 'rose' }] : []}
      emphasis={lineAsk.ask ? (
        // ★ 2026-10-10 한 줄 묻기 — 답이 열려 있으면 어느 보기에서든 답이 먼저다(실행 중 탭에서 물어도 보이게)
        <LineAnswer
          ask={lineAsk.ask}
          busy={previewing}
          // 카드 = 오늘의 추천 1클릭과 같은 함수(handleBriefStart = 늘 AI 문안 · [문안 직접 쓰기]와 무관) · 여정으로 넘기기 · 이메일 · DM 안내는 이동만이라 표시 없음
          cardCost={(c) => {
            if (c.action.kind !== 'auto') return undefined;
            const rec = c.action.brief as DailyBriefRecommendation;
            if (rec.opportunityType === 'journey_promotion' || rec.recommendedChannel === 'email' || rec.recommendedChannel === 'dm') return undefined;
            return `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`;
          }}
          makeCost={ownCopy ? '0크레딧' : `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`}
          onClose={lineAsk.close}
          onPick={(c) => {
            if (c.action.kind !== 'auto') return;
            lineAsk.close();
            handleBriefStart(c.action.brief as DailyBriefRecommendation);
          }}
          onMakeAnyway={() => {
            const t = lineAsk.ask!.line;
            lineAsk.close();
            void handleNaturalSubmit(t, null);
          }}
        />
      ) : view === 'recommendations' && dailyBrief ? (
        <DailyBriefCard brief={dailyBrief} submitting={previewing || lineAsk.judging} onStart={handleBriefStart} />
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
                ) : (() => {
                  // ★ 2026-10-11 Harold: 「한 줄 꽉 찬 카드 = 공간 낭비 · 3열 · 누르면 모달」 — 맨 위 결정 카드(featured) 1장은 그대로 · 나머지 = 3열 카드
                  const card = (p: OperatorProposal) => (
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
                  );
                  const rest = proposals.filter((p) => p.id !== featuredId);
                  return (
                    <>
                      {proposals.filter((p) => p.id === featuredId).map((p) => card(p))}
                      {rest.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{rest.map((p) => card(p))}</div>}
                    </>
                  );
                })()}
                </div>
              </div>
            </div>
          )}

          {view === 'natural' && <div className="max-w-3xl mx-auto"><NaturalLanguageStart submitting={previewing} onSubmit={handleNaturalSubmit} /></div>}

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
        busyText={previewBusyText}
        objective={preview?.config.objective || ''}
        data={preview?.data || null}
        starting={starting}
        startUnknown={startUnknown}
        onClose={closePreview}
        onEdit={editFromPreview}
        onStart={(vi) => (preview?.mode === 'renewal' ? approveRenewal() : startFromPreview(vi))}
        onCheckStart={() => startFromPreview(startVariant.current)}
        onAnswers={(answers) => editPreview({ answers }, preview?.data?.copy.mode === 'fixed' ? '대상을 세고 있어요' : '첫 문안을 만들고 있어요')}
        onRegenerate={() => editPreview({ regenerate: true }, '문안을 만들고 있어요')}
        onConditions={(conditions) => editPreview({ conditions })}
        onAxis={(segmentKey) => editPreview({ segment_key: segmentKey })}
        onCopyMode={(m) => editPreview(preview?.mode === 'new' && m === 'ai' ? { copy_mode: m, regenerate: true } : { copy_mode: m }, m === 'ai' ? '문안을 만들고 있어요' : undefined)}
        onFixedCopy={(subject, body) => editPreview({ fixed_subject: subject, fixed_body: body })}
        onBenefit={(benefit) => editPreview(preview?.mode === 'new' ? { benefit, regenerate: true } : { benefit }, preview?.mode === 'new' ? '문안을 만들고 있어요' : undefined)}
        onSchedule={(patch) => editPreview(patch)}
        onSendVia={(patch) => editPreview(patch)}
        onBlockAction={(code) => navigate(code === 'OPT080_MISSING' ? '/settings' : '/manage')}
        onCharge={() => navigate('/pricing')}
      />
    </ZoneFrame>
  );
}

