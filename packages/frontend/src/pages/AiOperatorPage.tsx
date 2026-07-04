import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  LineChart,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Wand2,
  X,
  Pencil,
} from 'lucide-react';
import AiRefineModal from '../components/AiRefineModal';
import AiOperatorWalkthroughModal from '../components/AiOperatorWalkthroughModal';
import CreditHistoryModal from '../components/credit/CreditHistoryModal';
// ★ D210+ Phase 2-fix1 (Harold 명시 2026-05-23): 회사 데이터 활용 매트릭스 안내 카드 (3축 100% 보완).
import AiProposalSummaryModal from '../components/AiProposalSummaryModal';
// ★ D210+ Phase 2-fix4 (Harold 명시 2026-05-23): 변수 하이라이트 + 머지 결과 미리보기 컨트롤타워.
import { highlightVars, mergeAndHighlightVars } from '../utils/highlightVars';
// ★ 2026-07-02 문안 전용 편집기 모달 — 변수·브랜드 링크·회사 표현·특수문자 커서 삽입 + 미리보기
import MessageEditorModal from '../components/MessageEditorModal';
import { useAuthStore } from '../stores/authStore';
// ★ D210+ (Harold 명시 2026-05-23): SUB_MODULE_CARDS constants/ 모듈 추출 — Walkthrough STEP 6 공통 사용 정합.
import { SUB_MODULE_CARDS } from '../constants/ai-operator-modules';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';

// ============================================================
// 타입 정의
// ============================================================

interface ProposalMessage {
  variantId: string;
  variantName: string;
  concept: string;
  body: string;             // ★ D165 fix: backend message_text 단일 필드 (channel은 별도 필드)
  subject?: string;         // LMS/MMS 제목 (선택)
  byteCount?: number;       // SMS 경고용
  byteWarning?: boolean;
  score: number;
}

// ★ D170: Multi-Agent Orchestrator 응답 — compliance + agentDurations 추가
interface ComplianceBlock {
  passed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
  suggestions: string[];
}

export interface ProposalResponse {
  success: boolean;
  target: {
    count: number;
    totalCount: number;
    criteria: string;
    filters: Record<string, unknown>;
    suggestedName: string;
  };
  messages: ProposalMessage[];
  recommendation: string;
  recommendationReason: string;
  channel: {
    recommended: string;
    reason: string;
    isAd: boolean;
    rejectNumber?: string | null;  // ★ Harold 명시: 광고 메시지 미리보기에 (광고)+무료거부 자동 합성
  };
  schedule: {
    recommendedTime: string;
  };
  compliance?: ComplianceBlock;  // ★ D170: Compliance Sub-agent 응답
  cost: {
    estimated: number;
    unitCost: number;
    breakdown: string;
  };
  performance: {
    expectedClicks: number;
    expectedConversions: number;
    expectedRevenue: number;
    clickRate: number;
    conversionRate: number;
    basis?: {
      level: string;
      label: string;
      confidence: string;
      notes: string[];
      eventWindowDays?: number;
      gradeBreakdown?: Array<{ grade: string; count: number; conversionRate: number; expectedConversions: number; expectedRevenue: number; source: string }>;
    };
    insight?: {
      diagnosis: string;
      insights: string[];
      strategy: string[];
      risks: string[];
      generated: boolean;
    };
  };
  meta: {
    usePersonalization: boolean;
    personalizationVars: string[];
    useIndividualCallback: boolean;
    countVerified?: boolean;                    // ★ D168
    agentDurations?: Record<string, number>;    // ★ D170
    generatedAt: string;
    aiSynthesis?: string;                        // AI 자율 결정 경로 최종 종합 분석(있을 때만)
  };
}

// ============================================================
// 정적 데이터
// ============================================================

const EXAMPLE_PROMPTS = [
  '최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘',
  '장바구니 이탈 24시간 고객에게 10% 할인 알림',
  '휴면 전환 위험 고객에게 복귀 메시지',
  '신규 가입 후 7일 미구매 고객에게 첫 구매 혜택',
];

interface SubAgentStep {
  icon: typeof Target;
  label: string;
  gradient: string;
  hint: string;
}

const SUB_AGENT_STEPS: SubAgentStep[] = [
  { icon: Target, label: 'Target Analysis', gradient: 'from-rose-400 to-pink-500', hint: '고객군 자동 추출 · SQL 생성' },
  { icon: MessageSquare, label: 'Message Composition', gradient: 'from-amber-400 to-orange-500', hint: 'A/B 문구 + 스팸 검수' },
  { icon: Send, label: 'Channel Decisioning', gradient: 'from-emerald-400 to-teal-500', hint: '최적 채널 판단' },
  { icon: Clock, label: 'Schedule Optimization', gradient: 'from-cyan-400 to-blue-500', hint: '발송 시점 추천' },
  { icon: DollarSign, label: 'Cost Calculation', gradient: 'from-violet-400 to-purple-500', hint: '회사별 단가 적용' },
  { icon: LineChart, label: 'Performance Forecast', gradient: 'from-fuchsia-400 to-pink-500', hint: '클릭 · 전환 · 매출 추정' },
];

// ★ D209+ (Harold 명시 2026-05-22): EngineCard + ENGINE_CARDS 영역 영구 제거.
//   Harold 명시 — "7 코어 엔진 아키텍처 + Enterprise Beta Program 영역 필요 없음".
//   기능/라우트/페이지 모두 보존 + 사용자 진입 UI 영역만 제거 정합.

// ★ D177-fix (2026-05-19): SESSION_MILESTONES + STATUS_CONFIG 영구 제거.
//   Harold 명시 — "이미 작업완료한건 언제 적용? / 굳이 업그레이드 보여줄 필요 X / 직원들한테 방향성 잡음 명시 X".
//   직원/외부 노출 시 미래 로드맵 = 영업/보안/사용자 혼란 위험. 진행률 카드 + 9 세션 로드맵 영역 함께 제거.

// ★ D177-ux2 (2026-05-19): AI Operator 페이지 안 sub-module 배치 (Harold 명시 — 헤더 dropdown X / 페이지 안 메뉴 배치).
// ★ D210+ (Harold 명시 2026-05-23): SubModuleCard interface + SUB_MODULE_CARDS = constants/ai-operator-modules.ts 모듈 추출.
//   AiOperatorWalkthroughModal STEP 6 메뉴 매트릭스 공통 사용 — no_inline_duplication 룰 정합 (단일 source of truth).

// 결과 카드 액센트
interface AccentTokens {
  iconBg: string;
  border: string;
  glow: string;
  text: string;
}

const ACCENT_TOKENS: Record<string, AccentTokens> = {
  rose:    { iconBg: 'from-rose-400 to-pink-500',       border: 'border-rose-400/20',    glow: 'hover:shadow-rose-500/20',    text: 'text-rose-200' },
  amber:   { iconBg: 'from-amber-400 to-orange-500',    border: 'border-amber-400/20',   glow: 'hover:shadow-amber-500/20',   text: 'text-amber-200' },
  emerald: { iconBg: 'from-emerald-400 to-teal-500',    border: 'border-emerald-400/20', glow: 'hover:shadow-emerald-500/20', text: 'text-emerald-200' },
  cyan:    { iconBg: 'from-cyan-400 to-blue-500',       border: 'border-cyan-400/20',    glow: 'hover:shadow-cyan-500/20',    text: 'text-cyan-200' },
  violet:  { iconBg: 'from-violet-400 to-purple-500',   border: 'border-violet-400/20',  glow: 'hover:shadow-violet-500/20',  text: 'text-violet-200' },
  fuchsia: { iconBg: 'from-fuchsia-400 to-pink-500',    border: 'border-fuchsia-400/20', glow: 'hover:shadow-fuchsia-500/20', text: 'text-fuchsia-200' },
};

// ============================================================
// 헬퍼
// ============================================================

function formatScheduleTime(iso: string): string {
  if (!iso) return '추후 안내';
  // recommended_time 형식: "YYYY-MM-DD HH:mm" 또는 ISO
  const cleaned = iso.replace(' ', 'T');
  const date = new Date(cleaned);
  if (isNaN(date.getTime())) return iso;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = dayNames[date.getDay()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day}(${dow}) ${hh}:${mm}`;
}

// ============================================================
// 결과 카드 sub-component
// ============================================================

interface ResultCardProps {
  accent: keyof typeof ACCENT_TOKENS;
  icon: typeof Target;
  label: string;
  headline: string;
  subtitle: string;
  description?: string;
  index: number;
  extra?: React.ReactNode;       // ★ D165: 카드 본문 하단 풍부 인터랙션 슬롯 (3안 토글 / 차트 / breakdown 등)
  className?: string;            // ★ D165: 그리드 col-span 등 외부 제어
  truncateHeadline?: boolean;    // ★ D165: 메시지 카드처럼 긴 텍스트 truncate 끄기
}

function ResultCard({ accent, icon: Icon, label, headline, subtitle, description, index, extra, className, truncateHeadline = true }: ResultCardProps) {
  const tokens = ACCENT_TOKENS[accent];
  return (
    <div
      className={`group relative p-6 rounded-2xl bg-white/[0.04] backdrop-blur-xl border ${tokens.border} hover:bg-white/[0.07] hover:scale-[1.01] transition-all duration-300 shadow-lg ${tokens.glow} animate-in fade-in slide-in-from-bottom-3 fill-mode-both ${className || ''}`}
      style={{ animationDelay: `${index * 60}ms`, animationDuration: '500ms' }}
    >
      <div className="flex items-start gap-4 mb-4">
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${tokens.iconBg} flex items-center justify-center shadow-lg`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold tracking-[0.22em] uppercase mb-1 ${tokens.text}`}>{label}</p>
          <p className={`text-2xl font-bold text-white ${truncateHeadline ? 'truncate' : ''}`} title={headline}>{headline}</p>
          <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {description && (
        <p className="text-sm text-white/65 leading-relaxed line-clamp-3 mb-3">{description}</p>
      )}
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );
}

// ============================================================
// 메인 페이지
// ============================================================

export default function AiOperatorPage() {
  const navigate = useNavigate();
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);
  const { user } = useAuthStore();
  const companyName = (user as any)?.company?.name || '';
  // 종량제: AI 크레딧 잔여 (헤더 칩 — creditEnabled일 때만 표시)
  const [aiCredit, setAiCredit] = useState<any>(null);
  const [showCreditHistory, setShowCreditHistory] = useState(false); // 크레딧 사용 이력 모달
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) { const d = await res.json(); if (d && d.success !== false) setAiCredit(d); }
      } catch { /* 조회 실패 시 칩 숨김 */ }
    })();
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ★ D174 (2026-05-19): PerformancePage가 sessionStorage에 저장한 prefill objective 자동 로드
  const [objective, setObjective] = useState(() => {
    if (typeof window === 'undefined') return '';
    const prefill = sessionStorage.getItem('ai_operator_prefill_objective');
    if (prefill) {
      sessionStorage.removeItem('ai_operator_prefill_objective');
      return prefill;
    }
    return '';
  });
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ★ D165: 메시지 3안 토글 + 다듬기 모달 + 다듬기 결과 오버라이드
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinedOverrides, setRefinedOverrides] = useState<Record<number, string>>({});
  const [editingBody, setEditingBody] = useState(false); // ★ 2026-06-19: 생성 문안 직접 편집(타이핑) 모드
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  // ★ D166: 승인 → 발송 흐름 (preview-recipients + /direct-send 2-step)
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [sendResult, setSendResult] = useState<{
    campaignId: string;
    sentCount: number;
    failCount: number;
    unsubscribeCount?: number;
    message: string;
    suggestedName: string;
  } | null>(null);
  // ★ D170+ (Harold 명시 2026-05-19): 발송 시점 안전장치 구현
  //   'aiRecommended' = AI 추천 시점 그대로 예약 발송 (미래 시점이면)
  //   'immediate' = 지금 즉시 발송 (사용자 명시 선택)
  //   'custom' = 사용자가 직접 시점 선택 (datetime-local input)
  type SendMode = 'aiRecommended' | 'immediate' | 'custom';
  const [sendMode, setSendMode] = useState<SendMode>('aiRecommended');
  const [customScheduledAt, setCustomScheduledAt] = useState<string>(''); // YYYY-MM-DDTHH:mm 형식
  // ★ D210+ Phase 2-fix4 (Harold 명시 2026-05-23): 원본/적용 토글 + 상위 고객 샘플 데이터
  //   - sampleCustomer = displayName 키 매트릭스 ({ "고객명": "...", "등급": "...", ... })
  //   - showMergedPreview = false (변수 강조 원본 표시) / true (상위 고객 데이터 치환 적용 표시)
  const [sampleCustomer, setSampleCustomer] = useState<Record<string, string | number | null> | null>(null);
  // ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): Liquid 렌더링 영역 (field 키 매트릭스) — renderLiquid 호출 시 customer.X 매칭.
  const [sampleCustomerFields, setSampleCustomerFields] = useState<Record<string, any> | null>(null);
  const [showMergedPreview, setShowMergedPreview] = useState(false);
  // ★ 2026-06-29: AI 꾸미기 — 활용 가능 컬럼(data-profile 안전 변수) 다중 선택 + 재작성
  const [dataProfileVars, setDataProfileVars] = useState<Array<{ token: string; label: string }>>([]);
  const [selectedVars, setSelectedVars] = useState<Set<string>>(new Set());
  const [decorating, setDecorating] = useState(false);
  // ★ 2026-06-29: AI 제안 요약 모달 (장황한 분석 섹션 통합 — 탭 분리)
  const [showSummary, setShowSummary] = useState(false);

  // textarea 자동 높이 조절
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [objective]);

  // 로딩 시 sub-agent 단계 자동 진행
  useEffect(() => {
    if (!loading) return;
    if (progressStep >= SUB_AGENT_STEPS.length) return;
    const timer = setTimeout(() => {
      setProgressStep((s) => Math.min(s + 1, SUB_AGENT_STEPS.length));
    }, 1500);
    return () => clearTimeout(timer);
  }, [loading, progressStep]);

  // ★ 2026-06-29: 활용 가능 컬럼 — data-profile 안전 변수 fetch (AI 꾸미기 다중 선택용)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/ai/operator/data-profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.safeFields)) {
          setDataProfileVars(
            d.safeFields.map((f: any) => ({
              token: String(f.percentVar || f.label || '').trim(),
              label: String(f.label || f.percentVar || '').trim(),
            })).filter((v: { token: string }) => v.token),
          );
        }
      })
      .catch(() => {});
  }, []);

  // ★ 2026-06-30 (A7 정정): 변형 클릭마다 그 변형이 실제 쓴 %변수%만 자동 체크 (변형마다 다른 컬럼 정확 반영)
  useEffect(() => {
    if (!proposal) return;
    const variants = proposal.messages || [];
    if (variants.length === 0) return;
    const idx = Math.min(selectedVariantIdx, variants.length - 1);
    const body = refinedOverrides[idx] || variants[idx]?.body || '';
    const validTokens = new Set(dataProfileVars.map((v) => v.token));
    const used = new Set<string>();
    // 본문 %고객명% → 칩 토큰은 % 없는 bare('고객명')라 캡처그룹으로 비교
    for (const mt of Array.from(String(body).matchAll(/%([^%]+)%/g))) {
      if (validTokens.has(mt[1])) used.add(mt[1]);
    }
    setSelectedVars(used);
  }, [selectedVariantIdx, proposal, dataProfileVars, refinedOverrides]);

  // ★ D210+ Phase 2-fix5 (Harold 명시 2026-05-23): 옛 mount 시 fetch 제거.
  //   사고 = 회사 전체 고객 안 1건 fetch (filter X). 정정 = handleSubmit 안 proposal.target.filters 매칭 영역 안 1건 fetch.
  //   본 영역 = 옛 useEffect 폐기 정합 (handleSubmit 안 fetch 정합).

  const handleSubmit = async () => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (objective.trim().length < 5) {
      setError('마케팅 목표를 한 줄로 입력해주세요 (5자 이상).');
      return;
    }
    setError(null);
    setLoading(true);
    setProgressStep(0);
    setProposal(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/operator/propose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ objective: objective.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '제안서 생성에 실패했습니다.');
      }
      // ★ D210+ Phase 2-fix7 (Harold 명시 2026-05-23): AI 응답 후 진행 시각 확보 영역.
      //   옛 사고 = setTimeout 600ms 즉시 setLoading(false) → 진행 시각 효과 영역 X (즉시 사라짐).
      //   정정 = 1500ms 후 마지막 단계 완료 표시 + 2200ms 후 화면 전환 (사용자 자연 시각 흐름).
      setTimeout(() => {
        setProgressStep(SUB_AGENT_STEPS.length);
      }, 1500);
      setTimeout(() => {
        setProposal(data as ProposalResponse);
        setLoading(false);

        // ★ D210+ Phase 2-fix5 (Harold 명시 2026-05-23): 추출 타겟 안 상위 1건 고객 fetch (filters body 영역).
        //   본질 = proposal.target.filters 매칭 안 LTV/누적구매 상위 1건 → 원본/적용 토글 머지 정확.
        const filters = (data as ProposalResponse).target?.filters || {};
        fetch('/api/ai/operator/sample-customer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ filters }),
        })
          .then((sr) => sr.json())
          .then((sd) => {
            if (sd?.success && sd.sampleCustomer) {
              setSampleCustomer(sd.sampleCustomer);
              setSampleCustomerFields(sd.sampleCustomerFields || null);
            } else {
              setSampleCustomer(null);
              setSampleCustomerFields(null);
            }
          })
          .catch(() => {
            setSampleCustomer(null);
            setSampleCustomerFields(null);
          });
      }, 3700);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
      setLoading(false);
      setProgressStep(0);
    }
  };

  const handleReset = () => {
    setProposal(null);
    setObjective('');
    setError(null);
    setProgressStep(0);
    setSendResult(null);
    setSendError(null);
    setRefinedOverrides({});
    setEditingBody(false);
    setSelectedVariantIdx(0);
    // ★ D210+ Phase 2-fix5 (Harold 명시 2026-05-23): 새 입력 진입 시 옛 sample-customer 영역 초기화
    setSampleCustomer(null);
    setSampleCustomerFields(null);
    setShowMergedPreview(false);
    setSelectedVars(new Set());
    textareaRef.current?.focus();
  };

  // ★ 2026-06-30 (A7): AI 꾸미기 — 체크된 컬럼(%변수%)을 생성된 변형 전부에 일괄 적용 → 본문 오버라이드
  const handleDecorate = async () => {
    if (!proposal) return;
    if (selectedVars.size === 0) { setError('녹여 넣을 컬럼을 1개 이상 선택해주세요.'); return; }
    const variants = proposal.messages || [];
    if (variants.length === 0) return;
    const bodies = variants.map((m, i) => refinedOverrides[i] || m.body || '');
    const ch = (proposal.channel?.recommended || '').toLowerCase();
    const channel = ch.includes('mms') ? 'mms' : ch.includes('sms') ? 'sms' : 'lms';
    setDecorating(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/ai/operator/decorate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: bodies, selectedVars: Array.from(selectedVars), channel, isAd: !!proposal.channel?.isAd }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.messages)) {
        setRefinedOverrides((prev) => {
          const next = { ...prev };
          (data.messages as string[]).forEach((msg, i) => { if (typeof msg === 'string' && msg.trim()) next[i] = msg; });
          return next;
        });
      } else {
        setError(data.error || 'AI 꾸미기에 실패했습니다. 다시 시도해주세요.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 꾸미기 중 오류가 발생했습니다.');
    } finally {
      setDecorating(false);
    }
  };

  // 실제 발송 실행 — /direct-send 호출 + 결과 반영 (검증/확인 통과 후 진입)
  const performDirectSend = async (
    sendBody: Record<string, unknown>,
    suggestedName: string,
  ) => {
    setSending(true);
    setSendError(null);
    try {
      const token = localStorage.getItem('token');
      const sendRes = await fetch('/api/campaigns/direct-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(sendBody),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok || !sendData.success) {
        throw new Error(sendData.error || '발송 처리 실패');
      }
      setSendResult({
        campaignId: sendData.campaignId,
        sentCount: sendData.sentCount || 0,
        failCount: sendData.failCount || 0,
        unsubscribeCount: sendData.unsubscribeCount || 0,
        message: sendData.message || '',
        suggestedName,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '발송 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  // ★ D166: 승인 발송 — 2-step (preview-recipients → /direct-send)
  const handleApprove = async () => {
    if (!proposal || sending) return;
    setSending(true);
    setSendError(null);
    setSendResult(null);

    try {
      const token = localStorage.getItem('token');

      // 1. recipients 조회
      const previewRes = await fetch('/api/ai/operator/preview-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filters: proposal.target.filters }),
      });
      const previewData = await previewRes.json();
      if (!previewRes.ok || !previewData.success) {
        throw new Error(previewData.error || '수신자 조회 실패');
      }
      const recipients: Array<Record<string, unknown>> = previewData.recipients || [];
      if (recipients.length === 0) {
        throw new Error('발송 대상 고객이 없습니다. 타겟 조건을 조정해주세요.');
      }
      if (!previewData.defaultCallback) {
        throw new Error('기본 회신번호가 등록되지 않았습니다. 발신번호 관리에서 등록 후 다시 시도해주세요.');
      }

      // 2. 선택된 안 추출
      const idx = Math.min(selectedVariantIdx, Math.max(0, proposal.messages.length - 1));
      const variant = proposal.messages[idx];
      if (!variant) throw new Error('선택된 메시지가 없습니다.');
      const body = refinedOverrides[idx] || variant.body || '';
      if (!body || body.length < 5) throw new Error('메시지 본문이 비어있습니다. 다시 생성해주세요.');

      const channel = (proposal.channel.recommended || 'SMS').toUpperCase();
      const isLmsOrMms = channel === 'LMS' || channel === 'MMS';
      // LMS/MMS subject 필수 — AI가 안 줬으면 suggestedName 또는 회사명으로 fallback (17자 이내)
      const rawSubject = variant.subject || proposal.target.suggestedName || `${companyName || ''} AI 캠페인`.trim() || 'AI Operator';
      const subject = isLmsOrMms ? rawSubject.slice(0, 17) : '';

      // ★ D170+ (Harold 명시): 발송 시점 안전장치 구현 — AI 추천/즉시/사용자 직접 분기
      let scheduled = false;
      let scheduledAt: string | null = null;
      const now = Date.now();
      const MIN_FUTURE_MS = 60 * 1000; // 1분 이상 미래여야 예약 발송으로 처리

      if (sendMode === 'aiRecommended') {
        // AI 추천 시점이 미래면 예약, 과거/현재면 즉시 발송
        const recRaw = proposal.schedule.recommendedTime || '';
        if (recRaw) {
          const recDate = new Date(recRaw.replace(' ', 'T'));
          if (!isNaN(recDate.getTime()) && recDate.getTime() > now + MIN_FUTURE_MS) {
            scheduled = true;
            scheduledAt = recDate.toISOString();
          }
        }
      } else if (sendMode === 'immediate') {
        // 즉시 발송 — 사용자 명시 선택
        scheduled = false;
      } else if (sendMode === 'custom') {
        // 사용자가 직접 선택한 시점
        if (!customScheduledAt) {
          throw new Error('예약 발송 시점을 선택해주세요.');
        }
        const customDate = new Date(customScheduledAt);
        if (isNaN(customDate.getTime())) {
          throw new Error('예약 시점 형식이 올바르지 않습니다.');
        }
        if (customDate.getTime() <= now + MIN_FUTURE_MS) {
          throw new Error('예약 시점은 현재로부터 1분 이상 미래여야 합니다.');
        }
        // 발송 허용 시간대 (08:00 ~ 21:00 KST) — 한줄로 SEND_HOURS 정합
        const hour = customDate.getHours();
        if (hour < 8 || hour >= 21) {
          throw new Error('예약 시점은 08:00 ~ 21:00 사이여야 합니다.');
        }
        scheduled = true;
        scheduledAt = customDate.toISOString();
      }

      // 3. 발송 페이로드 구성 (기존 /direct-send 재사용 — 검증된 흐름 + 라인그룹/중복제거/회신번호 가드 자동)
      const sendBody: Record<string, unknown> = {
        msgType: channel,
        subject,
        message: body,
        callback: previewData.defaultCallback,
        recipients,
        adEnabled: !!proposal.channel.isAd,
        scheduled,
        scheduledAt,
        sendChannel: 'sms',
        dedupEnabled: true,
        unsubFilterEnabled: true,
      };
      const suggestedName = proposal.target.suggestedName || 'AI Operator 캠페인';

      // ★ D170+ (Harold 명시 안전장치): 즉시 발송 시 사용자 확인 — 회수 불가 안내
      if (!scheduled) {
        const isAiPast = sendMode === 'aiRecommended';
        const confirmMsg = isAiPast
          ? `AI 추천 시점이 과거이거나 임박해서 ${recipients.length.toLocaleString()}명에게 지금 즉시 발송됩니다.\n발송 후 회수 불가합니다. 진행하시겠습니까?`
          : `${recipients.length.toLocaleString()}명에게 지금 즉시 발송됩니다.\n발송 후 회수 불가합니다. 진행하시겠습니까?`;
        setConfirm({
          mode: 'warning',
          title: '즉시 발송 — 회수 불가',
          description: confirmMsg,
          confirmLabel: '지금 발송',
          onConfirm: () => performDirectSend(sendBody, suggestedName),
        });
        return;
      }

      await performDirectSend(sendBody, suggestedName);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '발송 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const showAbout = !loading && !proposal;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      {/* 배경 글로우 — D222+ Phase 1 톤 다운 정정 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-fuchsia-400/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-violet-400/15 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-purple-400/10 blur-3xl" />
      </div>

      {/* 헤더 — D222+ Phase 1: 보라 톤 다운 + 시인성 강화 */}
      <header className="relative border-b border-violet-400/30 backdrop-blur-md bg-violet-800/50 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => goBackOr(navigate, '/dashboard')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-all text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            대시보드로 돌아가기
          </button>

          <div className="flex items-center gap-3">
            {aiCredit?.creditEnabled && (aiCredit.planCredits > 0 || aiCredit.purchased > 0) && (
              <button
                type="button"
                onClick={() => setShowCreditHistory(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs transition-all hover:bg-white/15"
                title="AI 크레딧 사용 이력"
              >
                <Sparkles className="w-3.5 h-3.5 text-fuchsia-300" />
                <span className="font-semibold tabular-nums text-white/90">{Number(aiCredit.total).toLocaleString()}</span>
                <span className="text-white/40">크레딧</span>
                {Number(aiCredit.monthlyUsed) > 0 && (
                  <span className="text-white/40">· 이번달 {Number(aiCredit.monthlyUsed).toLocaleString()}</span>
                )}
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-300 to-fuchsia-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <Sparkles className="w-5 h-5 text-indigo-950" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
                AI Operator
              </span>
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950">
                BETA
              </span>
            </div>
          </div>
        </div>
      </header>

      {showCreditHistory && (
        <CreditHistoryModal
          onClose={() => setShowCreditHistory(false)}
          onGoPricing={() => { setShowCreditHistory(false); navigate('/pricing'); }}
        />
      )}

      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />

      {/* 메인 본문 */}
      <main className="relative max-w-5xl mx-auto px-6 py-10 md:py-14">
        {/* ============= Hero + 입력창 (항상 표시 — 결과 모드에서도 상단 유지) ============= */}
        {!proposal && (
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Enterprise Beta · Production 검증 중
            </div>
            <p className="text-xs font-semibold tracking-[0.32em] text-white/40 mb-3 uppercase">AI Marketing Operations</p>
            <h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight bg-gradient-to-r from-amber-200 via-fuchsia-200 to-indigo-200 bg-clip-text text-transparent">
              한 줄 명령으로 작동하는<br />차세대 마케팅 오퍼레이션
            </h1>
            <p className="text-white/60 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
              마케팅 목표를 한 줄로 입력하시면, AI가 타겟팅 · 메시지 · 채널 · 시점 · 비용 · 성과까지<br className="hidden md:block" />
              자동 설계한 제안서를 즉시 제공합니다.
            </p>
          </div>
        )}

        {customerGate.isEmpty && !proposal && <CustomerDataRequiredBanner className="mb-4 max-w-3xl mx-auto" />}
        {/* 입력 영역 (항상 노출 — 결과 모드에서는 축소된 형태로) */}
        <div className={`mb-${proposal ? '10' : '6'} ${proposal ? 'mt-2' : ''}`}>
          <div className="relative group">
            {/* 그라데이션 보더 */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-amber-400/40 via-fuchsia-400/40 to-indigo-400/40 opacity-60 group-focus-within:opacity-100 blur-sm transition-opacity" />
            <div className="relative flex items-end gap-3 p-2 rounded-2xl bg-indigo-950/80 backdrop-blur-xl border border-white/10">
              <div className="flex-shrink-0 ml-3 mb-3">
                <Sparkles className="w-5 h-5 text-amber-300" />
              </div>
              <textarea
                ref={textareaRef}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="예: 최근 30일 미구매 VIP에게 재구매 쿠폰 보내줘"
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-white placeholder-white/30 px-1 py-3 resize-none focus:outline-none text-base leading-relaxed min-h-[44px] max-h-[200px] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || objective.trim().length < 5}
                className="flex-shrink-0 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-400 text-indigo-950 font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-fuchsia-500/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                aria-label="AI 제안서 생성"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                <span className="hidden sm:inline">{loading ? '생성 중' : '생성'}</span>
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between px-2 text-[11px] text-white/35">
            <span>⌘ + Enter 단축키로 즉시 제출</span>
            <span>{objective.length} chars</span>
          </div>

          {error && (
            <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-200 text-sm">
              {error}
            </div>
          )}

          {/* 예시 프롬프트 칩 (입력 전만) */}
          {!loading && !proposal && objective.length === 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase mb-2.5">Suggested Prompts</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setObjective(p);
                      textareaRef.current?.focus();
                    }}
                    className="px-3.5 py-1.5 text-xs rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20 hover:text-white transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ============= Loading State — 6 sub-agent 시각화 ============= */}
        {loading && (
          <div className="mb-14 animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <p className="text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase mb-2">AI Operator · Multi-Agent Pipeline</p>
              <p className="text-white/70 text-sm">6개 sub-agent가 협업하여 제안서를 설계하고 있습니다</p>
            </div>
            {/* ★ D210+ Phase 2-fix8 (Harold 명시 2026-05-23): Stage 2 — 6단 모두 완료 후 둥근 스피너 + "마지막 다듬는 중" 안내 영역 */}
            {progressStep >= SUB_AGENT_STEPS.length && (
              <div className="mb-6 text-center animate-in fade-in duration-300">
                <Loader2 className="w-10 h-10 animate-spin text-fuchsia-400 mx-auto mb-3" />
                <p className="text-white/85 text-sm font-medium">AI Operator가 마지막 다듬는 중입니다</p>
                <p className="text-white/50 text-xs mt-1">제안서 화면 준비 중 — 잠시만 기다려주세요</p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SUB_AGENT_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const isDone = idx < progressStep;
                const isActive = idx === progressStep;
                const isPending = idx > progressStep;
                return (
                  <div
                    key={step.label}
                    className={`relative p-4 rounded-xl border backdrop-blur-xl transition-all duration-500 ${
                      isDone ? 'bg-emerald-500/10 border-emerald-400/30' :
                      isActive ? 'bg-white/10 border-fuchsia-400/40 scale-[1.02] shadow-lg shadow-fuchsia-500/20' :
                      'bg-white/[0.02] border-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                        isDone ? 'bg-gradient-to-br from-emerald-400 to-teal-500' :
                        isActive ? `bg-gradient-to-br ${step.gradient}` :
                        'bg-white/5'
                      }`}>
                        {isDone ? (
                          <Check className="w-5 h-5 text-white" strokeWidth={3} />
                        ) : isActive ? (
                          <>
                            <Icon className="w-5 h-5 text-white relative z-10" />
                            <span className="absolute inset-0 rounded-lg bg-white/20 animate-ping" />
                          </>
                        ) : (
                          <Icon className={`w-5 h-5 ${isPending ? 'text-white/25' : 'text-white'}`} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] font-bold tracking-wider uppercase ${
                          isDone ? 'text-emerald-300' :
                          isActive ? 'text-white' :
                          'text-white/30'
                        }`}>
                          {step.label}
                        </p>
                        <p className={`text-xs mt-0.5 truncate ${
                          isDone || isActive ? 'text-white/70' : 'text-white/25'
                        }`}>
                          {isActive ? '진행 중...' : isDone ? '완료' : step.hint}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============= 결과 영역 — 6 카드 그리드 ============= */}
        {proposal && !loading && (
          <div className="mb-14">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase mb-1">AI Proposal · Generated</p>
                <h2 className="text-xl font-bold text-white">{proposal.target.suggestedName || 'AI 마케팅 제안서'}</h2>
              </div>
              <span className="text-xs text-white/40">
                {new Date(proposal.meta.generatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 생성
              </span>
            </div>

            {/* ★ D170: Compliance Sub-agent 경고 표시 — high/medium만 노출, low는 ShieldCheck 작은 표시 */}
            {proposal.compliance && (
              <>
                {(proposal.compliance.riskLevel !== 'low' || !proposal.compliance.passed) && (
                  <div className={`mb-5 p-4 rounded-xl border backdrop-blur-xl ${
                    proposal.compliance.riskLevel === 'high'
                      ? 'bg-rose-500/10 border-rose-400/40'
                      : 'bg-amber-500/10 border-amber-400/40'
                  }`}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <AlertTriangle className={`w-4 h-4 ${proposal.compliance.riskLevel === 'high' ? 'text-rose-300' : 'text-amber-300'}`} />
                      <p className={`text-sm font-semibold ${proposal.compliance.riskLevel === 'high' ? 'text-rose-100' : 'text-amber-100'}`}>
                        Compliance Check · {proposal.compliance.riskLevel === 'high' ? '발송 차단 권장' : '검토 필요'}
                      </p>
                    </div>
                    {proposal.compliance.warnings.length > 0 && (
                      <ul className="text-xs text-white/75 space-y-1 mb-2">
                        {proposal.compliance.warnings.map((w, i) => (
                          <li key={i} className="flex gap-1.5"><span className="opacity-60">·</span><span>{w}</span></li>
                        ))}
                      </ul>
                    )}
                    {proposal.compliance.suggestions.length > 0 && (
                      <ul className="text-xs text-white/60 space-y-1 mt-2 pt-2 border-t border-white/10">
                        {proposal.compliance.suggestions.map((s, i) => (
                          <li key={i} className="flex gap-1.5"><span className="opacity-60">→</span><span>{s}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {proposal.compliance.riskLevel === 'low' && proposal.compliance.passed && (
                  <div className="mb-5 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="text-emerald-200">Compliance Check 통과</span>
                  </div>
                )}
              </>
            )}

            {(() => {
              // ★ D165: 메시지 3안 토글 — 다듬기 결과가 있으면 오버라이드 사용
              const variants = proposal.messages;
              const safeIdx = Math.min(selectedVariantIdx, Math.max(0, variants.length - 1));
              const activeVariant = variants[safeIdx];
              const isRecommended = (proposal.recommendation || '').includes(activeVariant?.variantId || '__none__')
                || (proposal.recommendation || '').includes(activeVariant?.variantName || '__none__');
              const activeChannel = (proposal.channel.recommended || 'SMS').toUpperCase();
              const overrideText = refinedOverrides[safeIdx];
              const baseBody = activeVariant?.body || '';
              const rawActiveBody = overrideText || baseBody;
              // ★ Harold 명시 (2026-05-19): 광고 메시지면 (광고) prefix + 무료거부 suffix 자동 합성 — 실제 발송 형태 미리보기
              //   원본(rawActiveBody)은 다듬기/발송 시 그대로 사용. 표시(activeBody)만 합성 — 실 발송은 /direct-send가 adEnabled=true로 자동 처리.
              const isAd = !!proposal.channel.isAd;
              const rawReject = proposal.channel.rejectNumber || '';
              const formattedReject = rawReject
                ? rawReject.replace(/[^0-9]/g, '').replace(/^(\d{3,4})(\d{3,4})(\d{4})$/, '$1-$2-$3')
                : '';
              const activeBody = (isAd && rawReject && rawActiveBody)
                ? `(광고)\n${rawActiveBody}\n무료거부 ${formattedReject || rawReject}`
                : rawActiveBody;
              const bytesLen = (s: string) => {
                let bytes = 0;
                for (let i = 0; i < s.length; i++) {
                  const code = s.charCodeAt(i);
                  bytes += code > 0x7F ? 2 : 1;
                }
                return bytes;
              };
              const activeBytes = bytesLen(activeBody);

              return (
                // ★ D210+ Phase 2-fix3 (Harold 명시 2026-05-23): lg:grid-cols-5 매트릭스
                //   메시지 = lg:col-span-2 (40% 좌측) / 4개 카드 wrapper = lg:col-span-3 (60% 우측 2×2)
                //   CompanyDataProfileCard + 예상 성과 = lg:col-span-5 (전체 폭)
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
                  {/* ============= 추천 메시지 (좌측 40% — lg:col-span-2) ============= */}
                  <ResultCard
                    index={0}
                    accent="amber"
                    icon={MessageSquare}
                    label="추천 메시지"
                    headline={activeVariant?.variantName || '문안'}
                    subtitle={`${variants.length}개 안 생성 · ${activeChannel} · ${activeBytes} bytes${overrideText ? ' · 다듬어진 안' : ''}`}
                    truncateHeadline={false}
                    className="lg:col-span-2"
                    extra={
                      <div className="mt-3">
                        {/* 3안 토글 탭 */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          {variants.map((v, idx) => {
                            const isActive = idx === safeIdx;
                            const isAnswerRecommended = (proposal.recommendation || '').includes(v.variantId)
                              || (proposal.recommendation || '').includes(v.variantName);
                            return (
                              <button
                                key={v.variantId}
                                type="button"
                                onClick={() => setSelectedVariantIdx(idx)}
                                className={`group/tab relative px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                  isActive
                                    ? 'bg-gradient-to-r from-amber-400/30 to-fuchsia-400/30 text-white border border-amber-300/40 shadow-md'
                                    : 'bg-white/[0.04] text-white/55 border border-white/10 hover:bg-white/[0.08] hover:text-white/80'
                                }`}
                              >
                                {isAnswerRecommended && (
                                  <Star className={`w-3 h-3 ${isActive ? 'text-amber-300 fill-amber-300' : 'text-amber-400/60 fill-amber-400/60'}`} />
                                )}
                                <span>{v.variantName || `${String.fromCharCode(65 + idx)}안`}</span>
                                {v.score > 0 && (
                                  <span className={`ml-0.5 text-[10px] tabular-nums ${isActive ? 'text-amber-200' : 'text-white/40'}`}>
                                    {v.score}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                          {isRecommended && (
                            <span className="ml-auto text-[10px] font-semibold tracking-[0.2em] uppercase text-amber-300/80">
                              AI Recommended
                            </span>
                          )}
                        </div>

                        {/* 콘셉트 */}
                        {activeVariant?.concept && (
                          <p className="text-xs text-white/45 mb-2">
                            <span className="font-semibold text-white/60">콘셉트:</span> {activeVariant.concept}
                          </p>
                        )}

                        {/* ★ D210+ Phase 2-fix4 (Harold 명시 2026-05-23): 원본/적용 토글 — sampleCustomer 영역 있을 때만 표시 */}
                        {sampleCustomer && (
                          <div className="flex items-center gap-1 mb-2">
                            <button
                              type="button"
                              onClick={() => setShowMergedPreview(false)}
                              className={`flex-1 text-[11px] py-1.5 rounded-lg transition-all ${
                                !showMergedPreview
                                  ? 'bg-amber-400/25 text-amber-100 font-semibold ring-1 ring-amber-300/40'
                                  : 'bg-white/5 text-white/40 hover:text-white/60'
                              }`}
                              title="개인화 변수 위치 강조 — %고객명% 형태 그대로 표시"
                            >
                              원본 (변수 강조)
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowMergedPreview(true)}
                              className={`flex-1 text-[11px] py-1.5 rounded-lg transition-all ${
                                showMergedPreview
                                  ? 'bg-emerald-400/25 text-emerald-100 font-semibold ring-1 ring-emerald-400/40'
                                  : 'bg-white/5 text-white/40 hover:text-white/60'
                              }`}
                              title="상위 고객 데이터로 치환된 결과 미리보기"
                            >
                              적용 (상위 고객 머지)
                            </button>
                          </div>
                        )}

                        {/* 본문 박스 — 보기(pre). 직접 편집 = 전용 편집기 모달(MessageEditorModal) */}
                        <div className="relative p-4 rounded-xl bg-indigo-950/60 border border-white/10 mb-3">
                          <pre className="whitespace-pre-wrap break-words text-sm text-white/85 leading-relaxed font-sans">
                            {activeBody
                              ? (showMergedPreview && sampleCustomer
                                  ? mergeAndHighlightVars(activeBody, sampleCustomer, 'dark', sampleCustomerFields || undefined)
                                  : highlightVars(activeBody, 'dark'))
                              : '메시지 본문이 비어있습니다.'}
                          </pre>
                          {overrideText && !editingBody && (
                            <button
                              type="button"
                              onClick={() => setRefinedOverrides((prev) => {
                                const next = { ...prev };
                                delete next[safeIdx];
                                return next;
                              })}
                              className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/30 transition-all"
                              title="원본 안으로 되돌리기"
                            >
                              다듬어짐 · 되돌리기
                            </button>
                          )}
                        </div>

                        {/* 메시지 액션 */}
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setEditingBody(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            직접 편집
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowRefineModal(true)}
                            disabled={!activeBody}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-amber-400/20 to-fuchsia-400/20 text-amber-100 border border-amber-300/30 hover:from-amber-400/30 hover:to-fuchsia-400/30 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            AI로 다듬기
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!activeBody) return;
                              navigator.clipboard.writeText(activeBody).then(() => {
                                setCopiedAt(Date.now());
                                setTimeout(() => setCopiedAt(null), 1500);
                              });
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white transition-all"
                          >
                            {copiedAt ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedAt ? '복사 완료' : '본문 복사'}
                          </button>
                        </div>

                        {/* ★ 2026-07-02 문안 전용 편집기 모달 — 큰 본문 + 우측 삽입 도구(변수·회사 표현·브랜드 링크·특수문자) */}
                        <MessageEditorModal
                          open={editingBody}
                          initialText={rawActiveBody}
                          originalText={baseBody}
                          channel={activeChannel}
                          isAd={isAd}
                          rejectNumber={formattedReject || rawReject}
                          variables={dataProfileVars}
                          sampleCustomer={sampleCustomer}
                          sampleCustomerFields={sampleCustomerFields}
                          onApply={(text) => {
                            setRefinedOverrides((prev) => ({ ...prev, [safeIdx]: text }));
                            setEditingBody(false);
                          }}
                          onClose={() => setEditingBody(false)}
                        />
                      </div>
                    }
                  />

                  {/* ============= ★ D210+ Phase 2-fix3 (Harold 명시 2026-05-23): 우측 60% wrapper — 4개 카드 (타겟/채널/시점/비용) 2×2 grid ============= */}
                  <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">

                  {/* ============= 추천 타겟 ============= */}
                  <ResultCard
                    index={1}
                    accent="rose"
                    icon={Target}
                    label="추천 타겟"
                    headline={`${proposal.target.count.toLocaleString()}명`}
                    subtitle={`전체 ${proposal.target.totalCount.toLocaleString()}명 중 ${proposal.target.totalCount > 0 ? ((proposal.target.count / proposal.target.totalCount) * 100).toFixed(1) : 0}%`}
                    description={proposal.target.criteria}
                  />

                  {/* ============= 추천 채널 ============= */}
                  <ResultCard
                    index={2}
                    accent="emerald"
                    icon={Send}
                    label="추천 채널"
                    headline={proposal.channel.recommended}
                    subtitle={proposal.channel.isAd ? '광고 메시지 (Ad)' : '정보 메시지 (Info)'}
                    description={proposal.channel.reason}
                  />

                  {/* ============= 발송 시점 — D170+ Harold 명시: 사용자 변경 가능 + 안전장치 (우측 wrapper 안 전체 폭) ============= */}
                  <ResultCard
                    index={3}
                    accent="cyan"
                    icon={Clock}
                    label="발송 시점"
                    headline={
                      sendMode === 'immediate'
                        ? '지금 즉시 발송'
                        : sendMode === 'custom' && customScheduledAt
                          ? formatScheduleTime(customScheduledAt)
                          : formatScheduleTime(proposal.schedule.recommendedTime)
                    }
                    subtitle={
                      sendMode === 'aiRecommended'
                        ? 'AI 추천 · KST'
                        : sendMode === 'immediate'
                          ? '사용자 선택 · 즉시'
                          : '사용자 선택 · 예약'
                    }
                    truncateHeadline={false}
                    extra={
                      <div className="mt-3 space-y-2">
                        {/* AI 추천 시점 — radio */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'aiRecommended'}
                            onChange={() => setSendMode('aiRecommended')}
                            className="mt-0.5 accent-cyan-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white">AI 추천 시점 사용</p>
                            <p className="text-[11px] text-white/55 mt-0.5">{formatScheduleTime(proposal.schedule.recommendedTime)} 자동 예약</p>
                          </div>
                        </label>

                        {/* 즉시 발송 — radio */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'immediate'}
                            onChange={() => setSendMode('immediate')}
                            className="mt-0.5 accent-amber-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white">지금 즉시 발송</p>
                            <p className="text-[11px] text-white/55 mt-0.5">승인 클릭 즉시 발송 큐 진입</p>
                          </div>
                        </label>

                        {/* 사용자 직접 선택 — radio + datetime input */}
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] cursor-pointer transition-all">
                          <input
                            type="radio"
                            name="sendMode"
                            checked={sendMode === 'custom'}
                            onChange={() => setSendMode('custom')}
                            className="mt-0.5 accent-fuchsia-400"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white mb-1.5">직접 시점 선택</p>
                            <input
                              type="datetime-local"
                              value={customScheduledAt}
                              onChange={(e) => {
                                setCustomScheduledAt(e.target.value);
                                if (e.target.value) setSendMode('custom');
                              }}
                              min={(() => {
                                const d = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 최소
                                const pad = (n: number) => String(n).padStart(2, '0');
                                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                              })()}
                              disabled={sendMode !== 'custom'}
                              className="w-full px-2 py-1 rounded-md bg-indigo-950/60 border border-white/15 text-white text-xs disabled:opacity-50 disabled:cursor-not-allowed [color-scheme:dark]"
                            />
                            <p className="text-[10px] text-white/40 mt-1">발송 허용 시간 · 08:00 ~ 21:00 KST</p>
                          </div>
                        </label>
                      </div>
                    }
                  />

                  {/* ============= 예상 비용 (breakdown 강화 — 우측 wrapper 안 전체 폭) ============= */}
                  <ResultCard
                    index={4}
                    accent="violet"
                    icon={DollarSign}
                    label="예상 비용"
                    headline={`${proposal.cost.estimated.toLocaleString()}원`}
                    subtitle={`${activeChannel} ${proposal.target.count.toLocaleString()}건`}
                    truncateHeadline={false}
                    extra={
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-white/60 px-2 py-1.5 rounded-md bg-white/5 border border-white/10">
                          <span>건당 단가</span>
                          <span className="font-mono font-semibold text-white">{proposal.cost.unitCost.toLocaleString()}원</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/60 px-2 py-1.5 rounded-md bg-white/5 border border-white/10">
                          <span>발송 건수</span>
                          <span className="font-mono font-semibold text-white">{proposal.target.count.toLocaleString()}건</span>
                        </div>
                        <div className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-gradient-to-r from-violet-500/15 to-purple-500/15 border border-violet-400/30">
                          <span className="font-semibold text-violet-200">총 예상 비용</span>
                          <span className="font-mono font-bold text-white">{proposal.cost.estimated.toLocaleString()}원</span>
                        </div>
                      </div>
                    }
                  />

                  {/* ★ 2026-06-29: 활용 가능 컬럼 다중 선택 + AI 꾸미기 (우측 전체폭) */}
                  <div className="sm:col-span-2 p-5 rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-violet-400/20 shadow-lg">
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shrink-0">
                          <Wand2 className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">활용 가능 컬럼</p>
                          <p className="text-[10px] text-white/45">넣고 싶은 데이터를 골라 AI가 메시지에 자연스럽게 녹입니다{selectedVars.size > 0 ? ` · ${selectedVars.size}개 선택` : ''}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDecorate}
                        disabled={decorating || selectedVars.size === 0}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
                      >
                        {decorating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        AI 꾸미기
                      </button>
                    </div>
                    {dataProfileVars.length === 0 ? (
                      <p className="text-[11px] text-white/40 mt-1">고객 데이터가 있어야 개인화 컬럼이 표시됩니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {dataProfileVars.map((v) => {
                          const on = selectedVars.has(v.token);
                          return (
                            <button
                              key={v.token}
                              type="button"
                              onClick={() => setSelectedVars((prev) => { const n = new Set(prev); if (n.has(v.token)) n.delete(v.token); else n.add(v.token); return n; })}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${on ? 'bg-violet-500/30 text-violet-100 border-violet-400/50' : 'bg-white/5 text-white/55 border-white/10 hover:bg-white/10 hover:text-white/80'}`}
                            >
                              %{v.label}%
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  </div>
                  {/* ★ 2026-06-29: 회사 데이터 프로필 + 예상 성과 + AI 진단 = AI 제안 요약 모달(탭)로 이동 — 메인 간소화 */}
                </div>
              );
            })()}

            {/* ★ D166: 승인 발송 활성화 — preview-recipients + /direct-send 2-step */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleApprove}
                disabled={sending}
                className="flex-1 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-400 text-indigo-950 font-semibold hover:brightness-110 hover:shadow-xl hover:shadow-fuchsia-500/40 disabled:opacity-50 disabled:cursor-wait transition-all flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? '발송 처리 중...' : '승인 후 발송 시작'}
              </button>
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                disabled={sending}
                className="px-5 py-3.5 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-violet-300" />
                AI 제안 요약
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={sending}
                className="px-6 py-3.5 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                다시 생성
              </button>
            </div>

            {/* 발송 에러 */}
            {sendError && (
              <div className="mt-3 p-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-200 text-sm">
                <span className="font-semibold">발송 오류 · </span>{sendError}
              </div>
            )}

            {/* ★ 2026-06-29: AI 종합 분석 + 추천 이유 = AI 제안 요약 모달(탭)로 이동 */}
            {showSummary && proposal && (
              <AiProposalSummaryModal proposal={proposal} onClose={() => setShowSummary(false)} />
            )}
          </div>
        )}

        {/* ============= About (입력 전만 표시) ============= */}
        {/* ★ D177-fix: 진행률 카드 영구 제거 (Harold 명시 — 업그레이드 노출 X / 방향성 이미 잡음) */}
        {showAbout && (
          <>
            {/* ★ D209+ (Harold 명시 2026-05-22): 좌우 분할 매트릭스 — 좌측 AI 자율 진단 세로 길게 / 우측 SUB_MODULE_CARDS 2열 세로. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-14">
              {/* 좌측 — AI 자율 진단 (세로 길게) */}
              <div>
                {/* ★ D205 (2026-05-22): AI 자율 진단 자동 추천 카드 — 회사 admin 첫 진입 시 자동 제안 */}
                <AiSelfDiagnosisCards
                  onApply={(objectiveText) => {
                    setObjective(objectiveText);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    setTimeout(() => textareaRef.current?.focus(), 200);
                  }}
                />
              </div>

              {/* 우측 — SUB_MODULE_CARDS 2열 세로 나열 */}
              {/* ★ D177-ux2: AI Operator 페이지 안 sub-module 배치 (Harold 명시 — 헤더 dropdown X / 페이지 안 메뉴) */}
              <div>
                <p className="text-[10px] font-semibold tracking-[0.28em] text-white/40 mb-1.5 uppercase">AI Operator Modules</p>
                <h2 className="text-xl font-bold mb-1.5 text-white">함께 사용하는 AI 영역</h2>
                <p className="text-sm text-white/50 mb-6">자연어 한 줄 진입 외에도 AI Operator 안에 내장된 영역 — 클릭 시 진입</p>
                {/* ★ D209+ (Harold 명시 2026-05-22): 우측 3열 세로 나열 매트릭스 + description \n 줄바꿈 정합 (whitespace-pre-line). */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {SUB_MODULE_CARDS
                    .filter((card) => !card.adminOnly || (user as any)?.userType === 'company_admin')
                    .map((card) => {
                      const Icon = card.icon;
                      return (
                        <button
                          key={card.label}
                          onClick={() => navigate(card.path)}
                          // ★ D209+ (Harold 명시 2026-05-22): 호버 효과 강화 — shadow + glow + scale + 색감 강화.
                          className="group relative p-4 rounded-2xl bg-white/[0.07] backdrop-blur-xl border border-white/15 hover:bg-white/[0.18] hover:border-violet-400/50 hover:scale-[1.04] hover:shadow-2xl hover:shadow-violet-500/30 hover:-translate-y-0.5 transition-all duration-300 text-left"
                        >
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                            <Icon className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <h3 className="text-white font-semibold text-sm">{card.label}</h3>
                            <span className="text-[8px] font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 text-white shadow-sm">BETA</span>
                          </div>
                          <p className="text-white/60 text-[11px] leading-relaxed">{card.description}</p>
                          <div className="absolute top-4 right-4 text-white/30 group-hover:text-white/70 group-hover:translate-x-0.5 transition-all text-base">
                            →
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* ★ D209+ (Harold 명시 2026-05-22): "7 코어 엔진 아키텍처" + "Enterprise Beta Program" section 영구 제거. */}
            {/* ★ D177-fix: 9 세션 로드맵 영구 제거 (Harold 명시 — 미래 로드맵 직원/외부 노출 X) */}
          </>
        )}
      </main>

      {/* ★ D166: 발송 결과 모달 — 발송 처리 완료 후 큰 체크 + 캠페인 정보 + dashboard 발송결과 진입 */}
      {sendResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
        >
          <div
            className="relative w-full max-w-md rounded-3xl border border-white/10 shadow-2xl bg-gradient-to-br from-emerald-950 via-teal-950 to-indigo-950 animate-in fade-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 배경 글로우 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
              <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl" />
              <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-teal-500/20 blur-3xl" />
            </div>

            <div className="relative p-8">
              <button
                type="button"
                onClick={() => setSendResult(null)}
                className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>

              {/* 큰 체크 아이콘 */}
              <div className="flex justify-center mb-5">
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-500/40">
                  <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
                  <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />
                </div>
              </div>

              <div className="text-center mb-6">
                <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-emerald-300 mb-2">Campaign Dispatched</p>
                <h3 className="text-2xl font-bold text-white mb-1.5">발송 처리 완료</h3>
                <p className="text-sm text-white/70 truncate" title={sendResult.suggestedName}>{sendResult.suggestedName}</p>
              </div>

              {/* 결과 숫자 */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-emerald-300 mb-1.5">발송 성공</p>
                  <p className="text-2xl font-bold text-white tabular-nums">{sendResult.sentCount.toLocaleString()}</p>
                  <p className="text-[11px] text-white/40 mt-0.5">건</p>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
                  <p className="text-[10px] font-semibold tracking-wider uppercase text-white/40 mb-1.5">발송 실패</p>
                  <p className={`text-2xl font-bold tabular-nums ${sendResult.failCount > 0 ? 'text-rose-300' : 'text-white/30'}`}>
                    {sendResult.failCount.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">건 {sendResult.failCount > 0 ? '· 자동 환불' : ''}</p>
                </div>
              </div>

              {sendResult.message && (
                <div className="mb-5 p-3 rounded-lg bg-white/[0.03] border border-white/10">
                  <p className="text-xs text-white/65 leading-relaxed">{sendResult.message}</p>
                </div>
              )}

              {/* CTA */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSendResult(null);
                    navigate('/dashboard');
                  }}
                  className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-emerald-950 font-semibold hover:brightness-110 hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
                >
                  발송 결과 보기
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSendResult(null);
                    handleReset();
                  }}
                  className="px-5 py-3 rounded-xl bg-white/10 text-white font-medium border border-white/20 hover:bg-white/20 transition-all"
                >
                  새 캠페인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ★ D165: 메시지 다듬기 모달 — AiRefineModal 재사용 (D152 emerald 톤). 선택된 안 → AI 풍성화 → onApply로 오버라이드 적용 */}
      <AiRefineModal
        isOpen={showRefineModal}
        originalMessage={(() => {
          if (!proposal) return '';
          const idx = Math.min(selectedVariantIdx, Math.max(0, proposal.messages.length - 1));
          const v = proposal.messages[idx];
          if (!v) return '';
          return refinedOverrides[idx] || v.body || '';
        })()}
        companyName={companyName}
        onClose={() => setShowRefineModal(false)}
        onApply={(text) => {
          setRefinedOverrides((prev) => ({ ...prev, [selectedVariantIdx]: text }));
          setShowRefineModal(false);
        }}
      />

      {/* ★ D193 (2026-05-22) Phase D-1 사용자 안내: 첫 진입 walkthrough 5단계 안내 (localStorage 1회 표시) */}
      <AiOperatorWalkthroughModal />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ★ D205 (2026-05-22): AI 자율 진단 자동 추천 카드 컴포넌트
//   회사 admin 진입 시 자동 호출 — 우선순위 1~3 추천 카드 표시
//   원클릭 진행 시 자연어 한 줄 prefill + AI Operator 진입
// ════════════════════════════════════════════════════════════════════

interface AutoRecommendation {
  id: string;
  priority: 1 | 2 | 3;
  type: string;
  title: string;
  reason: string;
  targetCount: number;
  expectedImpact: string;
  oneClickObjective: string;
}

interface CompanyHealthDiagnosis {
  overallScore: number;
  topConcerns: string[];
  recommendations: AutoRecommendation[];
}

// ★ 2026-07-02 1차 개편: 일일 브리핑(company_daily_briefs)이 있으면 그것이 추천의 단일 소스 —
//   룰 기반 추천은 브리핑이 아직 없는 회사의 폴백. 자동마케팅 현황 요약 동반.
interface DiagnosisBrief {
  brief_date: string;
  headline: string | null;
  recommendations: Array<{
    title: string;
    objective: string;
    reason: string;
    targetCount: number | null;
    opportunityType?: string | null;
    recommendedChannel?: 'sms' | 'email' | 'dm' | null;
  }>;
}

function AiSelfDiagnosisCards({ onApply }: { onApply: (objective: string) => void }) {
  const navigate = useNavigate();
  const [diagnosis, setDiagnosis] = useState<CompanyHealthDiagnosis | null>(null);
  const [brief, setBrief] = useState<DiagnosisBrief | null>(null);
  const [autoMarketing, setAutoMarketing] = useState<{ active: number; pendingProposals: number }>({ active: 0, pendingProposals: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('token');
        const r = await fetch('/api/ai/operator/self-diagnosis', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json();
        if (d.success) {
          setDiagnosis(d.diagnosis);
          setBrief(d.brief || null);
          if (d.autoMarketing) setAutoMarketing(d.autoMarketing);
        }
      } catch {
        // skip - 추천 없으면 빈 자리
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const briefRecs = Array.isArray(brief?.recommendations) ? brief!.recommendations : [];
  const useBrief = briefRecs.length > 0;

  if (loading || !diagnosis) return null;
  if (!useBrief && diagnosis.recommendations.length === 0 && diagnosis.topConcerns.length === 0) return null;

  // ★ D216+ 사고 영구 정정 (Harold 명시 2026-05-25):
  //   옛 사고 = sessionStorage 키 불일치 (하이픈 vs 언더스코어) + DOM .value 직접 조작 = React state 동기화 X 영역
  //   정정 = props onApply 영역 직접 호출 매트릭스 정합 (상위 setObjective 영역 직접 호출)
  const handleOneClick = (objective: string) => {
    onApply(objective);
  };

  // ★ 5차: 브리핑 추천 분기 — 정착 제안 = 여정 승격다리 / 채널 제안 = 해당 채널 화면 / 기본 = 자연어 prefill
  const handleBriefRec = (rec: DiagnosisBrief['recommendations'][number]) => {
    if (rec.opportunityType === 'journey_promotion') {
      sessionStorage.setItem('journeyObjectivePrefill', JSON.stringify({ objective: rec.objective, message: '' }));
      navigate('/ai-journeys');
      return;
    }
    if (rec.recommendedChannel === 'email') { navigate('/email-campaigns'); return; }
    if (rec.recommendedChannel === 'dm') { navigate('/dm-builder'); return; }
    onApply(rec.objective);
  };

  // ★ D209+ (Harold 명시 2026-05-22): 우선순위 카드 색감 명확 구분 + border-2 + shadow 강화.
  //   우선순위 3 violet 영역 → blue 영역 정정 (wrapper violet 톤과 시각 충돌 차단).
  const priorityColor: Record<number, string> = {
    1: 'from-rose-500/30 to-pink-500/20 border-rose-400/60 shadow-lg shadow-rose-500/20',
    2: 'from-emerald-500/30 to-teal-500/20 border-emerald-400/60 shadow-lg shadow-emerald-500/20',
    3: 'from-blue-500/30 to-cyan-500/20 border-blue-400/60 shadow-lg shadow-blue-500/20',
  };

  return (
    // ★ D209+ (Harold 명시 2026-05-22): 좌측 wrapper 색감 강화 + border-2 + shadow 명확 visual 구분.
    <div className="p-5 bg-gradient-to-br from-violet-900/50 via-purple-900/40 to-fuchsia-900/30 border-2 border-violet-400/40 rounded-2xl h-full shadow-2xl shadow-violet-500/20">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.28em] text-violet-300/70 mb-1 uppercase">AI Self-Diagnosis</p>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-violet-400" />
            AI가 분석한 오늘 추천 캠페인
          </h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-white/40">회사 건강 점수</div>
          <div className={`text-2xl font-bold font-mono ${diagnosis.overallScore >= 70 ? 'text-emerald-300' : diagnosis.overallScore >= 40 ? 'text-amber-300' : 'text-rose-300'}`}>
            {diagnosis.overallScore}
          </div>
        </div>
      </div>

      {diagnosis.topConcerns.length > 0 && (
        <div className="mb-4 p-3 bg-white/5 border border-white/10 rounded-lg">
          <div className="text-[10px] text-white/40 mb-1.5">AI 진단 우선 항목</div>
          <ul className="text-xs text-white/80 space-y-1">
            {diagnosis.topConcerns.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-300 mt-0.5">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ★ 2026-07-02 1차: 일일 브리핑 = 추천의 단일 소스 (있으면 룰 기반 추천 대체) */}
      {useBrief && brief?.headline && (
        <div className="mb-3 p-3 bg-white/5 border border-violet-400/25 rounded-lg">
          <div className="text-[10px] text-violet-300/70 mb-1">오늘의 브리핑</div>
          <div className="text-xs text-white/85 leading-relaxed">{brief.headline}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {useBrief
          ? briefRecs.map((rec, i) => (
              <div
                key={`brief-${i}`}
                className={`p-4 bg-gradient-to-br ${priorityColor[(Math.min(i, 2) + 1) as 1 | 2 | 3]} border-2 rounded-2xl`}
              >
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="px-1.5 py-0.5 bg-white/10 rounded text-[9px] font-medium text-white/70">우선순위 {i + 1}</span>
                  {rec.targetCount != null && rec.targetCount > 0 && (
                    <span className="text-[10px] text-white/50">{rec.targetCount.toLocaleString()}명</span>
                  )}
                  {rec.opportunityType === 'journey_promotion' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">성과 검증</span>}
                  {rec.recommendedChannel === 'email' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">이메일 추천</span>}
                  {rec.recommendedChannel === 'dm' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">모바일 DM 추천</span>}
                </div>
                <h4 className="text-sm font-semibold text-white mb-1.5">{rec.title}</h4>
                <p className="text-[11px] text-white/70 leading-relaxed mb-3">{rec.reason}</p>
                <button
                  onClick={() => handleBriefRec(rec)}
                  className="w-full px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-1"
                >
                  {rec.opportunityType === 'journey_promotion' ? '여정으로 굳히기 →' : rec.recommendedChannel === 'email' ? '이메일에서 진행 →' : rec.recommendedChannel === 'dm' ? '모바일 DM에서 진행 →' : '원클릭 진행 →'}
                </button>
              </div>
            ))
          : diagnosis.recommendations.map((rec) => (
              <div
                key={rec.id}
                className={`p-4 bg-gradient-to-br ${priorityColor[rec.priority]} border-2 rounded-2xl`}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="px-1.5 py-0.5 bg-white/10 rounded text-[9px] font-medium text-white/70">우선순위 {rec.priority}</span>
                  {rec.targetCount > 0 && (
                    <span className="text-[10px] text-white/50">{rec.targetCount.toLocaleString()}명</span>
                  )}
                </div>
                <h4 className="text-sm font-semibold text-white mb-1.5">{rec.title}</h4>
                <p className="text-[11px] text-white/70 leading-relaxed mb-2">{rec.reason}</p>
                <p className="text-[10px] text-white/40 mb-3">{rec.expectedImpact}</p>
                <button
                  onClick={() => handleOneClick(rec.oneClickObjective)}
                  className="w-full px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-1"
                >
                  원클릭 진행 →
                </button>
              </div>
            ))}
      </div>

      {/* ★ 2026-07-02 1차: 자동마케팅 현황 요약 — 승인 대기가 있으면 바로 가게 */}
      <button
        onClick={() => navigate('/continuous-operator')}
        className="mt-4 w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
      >
        <span className="text-xs text-white/70">
          실행 중인 자동마케팅 <span className="text-white font-semibold">{autoMarketing.active}</span>개
          {autoMarketing.pendingProposals > 0 && (
            <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] font-medium">승인 대기 {autoMarketing.pendingProposals}건</span>
          )}
        </span>
        <span className="text-xs text-violet-300">관리 →</span>
      </button>

      <div className="mt-3 text-[10px] text-white/30 italic">
        Data source — {useBrief ? '매일 오전 일일 분석 (고객 DB 실측 신호 · 누적 학습)' : '회사 실측 신호 (일일 분석 누적 전 기본 추천)'}
      </div>
    </div>
  );
}
