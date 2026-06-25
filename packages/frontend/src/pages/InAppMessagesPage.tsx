import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertCircle, AlertTriangle, ArrowLeft, BarChart3, ChevronDown, ChevronUp,
  Clock, Crown, Edit2, Eye, Globe, ImageIcon, Layers, Lightbulb, Loader2, Moon, MousePointer,
  Plus, RefreshCw, Repeat, ShoppingCart, Smartphone, Sparkles, Target, Trash2, TrendingDown,
  TrendingUp, Upload, UserPlus, Users, Wand2, X,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import { InAppMessagePreview } from '../components/InAppMessagePreview';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';

// ════════════════════════════════════════════════════════════════════
// ★ D215+ (2026-05-25) 인앱 메시지 압도적 강화 — Journey Builder급 12 화면 영역
//   영구 룰 정합:
//   - AI 모델 명칭 사용자 노출 X (추상 표기 default — "AI 자율 진단" / "AI 모델")
//   - native dialog X (ConfirmModal + useToast 의무)
//   - AI 임의 혜택 X (placeholder 의무)
//   - 503 DB_MIGRATION_PENDING 응답 처리
//   - Source caption 모든 차트
//   - 모바일 반응형 default
// ════════════════════════════════════════════════════════════════════

type Template = 'top_banner' | 'bottom_banner' | 'center_modal' | 'full_screen' | 'slide_in' | 'inline_card' | 'toast' | 'floating_button';
type Frequency = 'once_per_session' | 'once_per_day' | 'always';
type Status = 'active' | 'paused' | 'archived';
type TriggerEvent = 'page_load' | 'cart_add' | 'cart_view' | 'checkout_start' | 'scroll' | 'time_on_page' | 'exit_intent' | 'cart_value';
type Animation = 'fade' | 'slide' | 'bounce' | 'pulse';
type QuickStartScenario = 'cart_recovery' | 'new_welcome' | 'dormant_recovery' | 'new_product' | 'vip_appreciation' | 'checkout_abandon' | 'repeat_purchase';
type SortMode = 'ctr_desc' | 'impressions_desc' | 'created_desc';

interface InAppButton {
  id: string;
  label: string;
  action_url: string | null;
  style: 'primary' | 'secondary' | 'tertiary';
  background_color: string;
  text_color: string;
}

interface MessageRow {
  id: string;
  title: string;
  body: string;
  template?: Template;
  position?: Template;
  image_url?: string | null;
  badge_text?: string | null;
  buttons?: InAppButton[];
  background_color?: string;
  text_color?: string;
  trigger_event?: string;
  trigger_conditions?: any;
  segment_conditions?: any;
  personalization_vars?: string[];
  display_frequency?: Frequency;
  auto_dismiss_seconds?: number | null;
  max_displays_per_user?: number | null;
  send_start_hour?: number | null;
  send_end_hour?: number | null;
  allowed_weekdays?: number[];
  animation?: Animation;
  parent_message_id?: string | null;
  variant_weight?: number;
  status: Status;
  channel?: 'web' | 'app';
  startAt?: string | null;
  endAt?: string | null;
  stats?: { impressions: number; clicks: number; dismisses: number; ctr: number };
}

interface QuickStartCard {
  scenario: QuickStartScenario;
  label: string;
  hint: string;
  defaultTemplate: Template;
}

interface AvailableVariable {
  key: string;
  label: string;
  hint: string;
  sampleValue: string;
}

interface SubAgentStep {
  name: string;
  status: 'completed';
  hint: string;
}

interface OverviewData {
  totalMessages: number;
  activeMessages: number;
  avgCTR: number;
  totalImpressions30d: number;
  totalAttributedPurchases30d: number;
  prev30d: { avgCTR: number; totalImpressions: number; totalAttributedPurchases: number };
  delta: { avgCTRPercent: number; impressionsPercent: number; purchasesPercent: number };
  dataSource: string;
}

interface ExplainResult {
  messageId: string;
  topInsight: string;
  factors: Array<{ factor: string; impact: number; direction: 'positive' | 'negative' | 'neutral'; description: string; dataSource: string }>;
  recommendations: Array<{ title: string; description: string; priority: 'high' | 'medium' | 'low'; actionType?: string }>;
  comparisonContext: { messageCTR: number; companyAvgCTR: number; deltaPercent: number; sampleSize: number };
  reasoning: string;
}

interface FunnelStats {
  funnel: { messageId: string; steps: Array<{ name: string; count: number; percentOfPrevious: number; percentOfTotal: number; dropoffReason?: string }>; attributedRevenueKrw: number; dataSource: string };
  hourly: Array<{ hour: number; impressions: number; clicks: number; ctr: number }>;
  heatmap: Array<{ hour: number; weekday: number; impressions: number; clicks: number; ctr: number }>;
  device: Array<{ device: string; impressions: number; clicks: number; ctr: number }>;
}

// ════════════════════════════════════════════════════════════════════
// 빠른 시작 7 시나리오 아이콘 + 그라데이션 매핑
// ════════════════════════════════════════════════════════════════════

const SCENARIO_VISUAL: Record<QuickStartScenario, { icon: typeof ShoppingCart; gradient: string; label: string; hint: string }> = {
  cart_recovery:     { icon: ShoppingCart,   gradient: 'from-amber-400 to-orange-500',   label: '장바구니 회복',     hint: '24h 이상 결제 X 회원 안내' },
  new_welcome:       { icon: UserPlus,       gradient: 'from-emerald-400 to-teal-500',   label: '신규 가입 환영',    hint: '첫 방문 환영 + 자사몰 안내' },
  dormant_recovery:  { icon: Moon,           gradient: 'from-violet-400 to-indigo-500',  label: '휴면 회수',         hint: '60일+ 미접속 안부 인사' },
  new_product:       { icon: Sparkles,       gradient: 'from-fuchsia-400 to-purple-500', label: '신상품 출시',       hint: '첫 주 전체 회원 알림' },
  vip_appreciation:  { icon: Crown,          gradient: 'from-amber-400 to-yellow-500',   label: 'VIP 감사',          hint: 'VIP 등급 진심 감사 인사' },
  checkout_abandon:  { icon: AlertTriangle,  gradient: 'from-rose-400 to-pink-500',      label: '결제 이탈 방지',    hint: '결제 페이지 30초+ 머무름' },
  repeat_purchase:   { icon: Repeat,         gradient: 'from-cyan-400 to-blue-500',      label: '재구매 유도',       hint: '직전 구매 14일 후 회복' },
};

const SUB_AGENT_VISUAL: Record<string, { icon: typeof Target; gradient: string; label: string }> = {
  trigger_detection:  { icon: Target,     gradient: 'from-rose-400 to-pink-500',    label: '트리거 감지' },
  audience_match:     { icon: Eye,        gradient: 'from-amber-400 to-orange-500', label: '대상 매칭' },
  template_selection: { icon: Layers,     gradient: 'from-emerald-400 to-teal-500', label: '템플릿 선택' },
  copy_design:        { icon: Wand2,      gradient: 'from-violet-400 to-purple-500',label: '본문 작성' },
  variant_generation: { icon: Sparkles,   gradient: 'from-fuchsia-400 to-pink-500', label: 'Variant 생성' },
  review_ready:       { icon: Activity,   gradient: 'from-cyan-400 to-blue-500',    label: '검토 진입' },
};

const TEMPLATE_LABELS: Record<Template, string> = {
  top_banner: '상단 배너',
  bottom_banner: '하단 배너',
  center_modal: '중앙 모달',
  full_screen: '전체 화면',
  slide_in: '슬라이드 인',
  inline_card: '인라인 카드',
  toast: '토스트',
  floating_button: '플로팅 버튼',
};

// ★ 2026-06-17 채널별 표시 형태 — 확실한 것만 (애매/충돌 형태 배제)
//   웹: 오버레이로 안전한 4종 (상단/하단 배너=헤더 충돌, 전체화면=과함, 인라인=협조 필요 → 배제)
//   앱: SDK가 직접 그려 통제 → 전면 인터스티셜·인앱 배너 포함
const CHANNEL_TEMPLATES: Record<'web' | 'app', Template[]> = {
  web: ['center_modal', 'slide_in', 'toast', 'floating_button'],
  app: ['center_modal', 'full_screen', 'top_banner', 'bottom_banner', 'toast', 'slide_in'],
};

const EMPTY_FORM: Partial<MessageRow> = {
  title: '',
  body: '',
  template: 'center_modal',
  background_color: '#4f46e5',
  text_color: '#ffffff',
  trigger_event: 'page_load',
  trigger_conditions: { event: 'page_load' },
  segment_conditions: {},
  personalization_vars: [],
  display_frequency: 'once_per_session',
  allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
  animation: 'fade',
  status: 'active',
  buttons: [],
  variant_weight: 100,
};

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function InAppMessagesPage() {
  const navigate = useNavigate();
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);
  const toast = useToast();
  // ToastProvider show(type, message) 시그니처 호환 helper
  const showToast = (message: string, opts: { type: 'success' | 'error' | 'info' | 'warning' }) => {
    toast[opts.type](message);
  };

  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [quickStartCards, setQuickStartCards] = useState<QuickStartCard[]>([]);
  const [availableVariables, setAvailableVariables] = useState<AvailableVariable[]>([]);
  const [topMessages, setTopMessages] = useState<Array<{ messageId: string; title: string; ctr: number; impressions: number; rank: number }>>([]);
  const [editing, setEditing] = useState<Partial<MessageRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  // ★ 2026-06-17 채널 분리 — 진입 시 웹/앱 선택 (null = 채널 선택 화면)
  const [channel, setChannel] = useState<'web' | 'app' | null>(null);

  // AI 생성 진행 상태
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgressStep, setAiProgressStep] = useState<number>(-1);
  const [aiObjective, setAiObjective] = useState('');

  // 자율 진단 상태
  const [diagnosing, setDiagnosing] = useState(false);
  const [topInsight, setTopInsight] = useState<string | null>(null);

  // 필터 / 정렬
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [templateFilter, setTemplateFilter] = useState<Template | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('created_desc');

  // 드릴다운 상태 (메시지별 통계)
  const [drillMessageId, setDrillMessageId] = useState<string | null>(null);
  const [drillStats, setDrillStats] = useState<FunnelStats | null>(null);
  const [drillExplain, setDrillExplain] = useState<ExplainResult | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // ────────────────────────────────────────────────────────────────
  // 데이터 로드
  // ────────────────────────────────────────────────────────────────

  const handle503 = (data: any): boolean => {
    if (data?.code === 'DB_MIGRATION_PENDING') {
      setError(data.error || 'DB 마이그레이션 필요 — 운영자에게 문의해주세요.');
      showToast('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', { type: 'warning' });
      return true;
    }
    return false;
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [msgRes, ovRes, qsRes, avRes, topRes] = await Promise.all([
        fetch(`/api/cdp/inapp?channel=${channel}`, { headers: authHeaders() }),
        fetch(`/api/cdp/inapp/overview?channel=${channel}`, { headers: authHeaders() }),
        fetch('/api/cdp/inapp/quick-start-cards', { headers: authHeaders() }),
        fetch('/api/cdp/inapp/available-variables', { headers: authHeaders() }),
        fetch(`/api/cdp/inapp/top-messages?limit=10&channel=${channel}`, { headers: authHeaders() }),
      ]);

      const [msgData, ovData, qsData, avData, topData] = await Promise.all([
        msgRes.json(), ovRes.json(), qsRes.json(), avRes.json(), topRes.json(),
      ]);

      if (handle503(msgData) || handle503(ovData)) return;
      if (msgData.success) setMessages(msgData.messages || []);
      if (ovData.success) setOverview(ovData.overview);
      if (qsData.success) setQuickStartCards(qsData.cards || []);
      if (avData.success) setAvailableVariables(avData.variables || []);
      if (topData.success) setTopMessages(topData.messages || []);
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
      showToast(e?.message || '조회 중 오류', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (channel) loadAll(); }, [channel]);

  // ────────────────────────────────────────────────────────────────
  // AI 자율 진단
  // ────────────────────────────────────────────────────────────────

  const handleDiagnose = async () => {
    if (messages.length === 0) {
      showToast('진단할 메시지가 없습니다 — 먼저 메시지를 생성해주세요.', { type: 'info' });
      return;
    }
    setDiagnosing(true);
    setTopInsight(null);
    try {
      // 가장 impression 많은 메시지 선정 후 explain 호출
      const targetMsg = [...messages].sort((a, b) => (b.stats?.impressions || 0) - (a.stats?.impressions || 0))[0];
      if (!targetMsg) return;
      const res = await fetch('/api/cdp/inapp/explain', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message_id: targetMsg.id }),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        setTopInsight(data.result.topInsight || '');
        showToast('AI 진단 완료', { type: 'success' });
      } else {
        showToast(data.error || 'AI 진단 실패', { type: 'error' });
      }
    } catch (e: any) {
      showToast(e?.message || 'AI 진단 중 오류', { type: 'error' });
    } finally {
      setDiagnosing(false);
    }
  };

  // ────────────────────────────────────────────────────────────────
  // AI 자동 생성 (자연어 + 빠른 시작)
  // ────────────────────────────────────────────────────────────────

  const handleAIGenerate = async (objective: string, templateHint?: QuickStartScenario) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (!objective.trim() && !templateHint) {
      showToast('자연어 목표 또는 빠른 시작 카드 선택 필수', { type: 'warning' });
      return;
    }
    setAiGenerating(true);
    setAiProgressStep(0);
    setError(null);

    // 6 sub-agent 진행 시각 효과 (700ms 간격)
    const stepInterval = setInterval(() => {
      setAiProgressStep((prev) => Math.min(prev + 1, 5));
    }, 700);

    try {
      const res = await fetch('/api/cdp/inapp/ai-generate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ objective, templateHint }),
      });
      const data = await res.json();
      clearInterval(stepInterval);
      if (handle503(data)) {
        setAiGenerating(false);
        return;
      }
      if (!data.success) {
        showToast(data.error || 'AI 생성 실패', { type: 'error' });
        setAiGenerating(false);
        return;
      }

      const pkg = data.package;
      // 편집 진입 — placeholder 직접 작성 의무
      setEditing({
        title: pkg.message.title,
        body: pkg.message.body,
        template: pkg.message.template,
        image_url: pkg.message.image_url,
        badge_text: pkg.message.badge_text,
        buttons: pkg.message.buttons || [],
        background_color: pkg.message.background_color,
        text_color: pkg.message.text_color,
        trigger_event: pkg.message.trigger_conditions?.event || 'page_load',
        trigger_conditions: pkg.message.trigger_conditions,
        segment_conditions: pkg.message.segment_conditions,
        personalization_vars: pkg.message.personalization_vars,
        display_frequency: pkg.message.display_frequency,
        auto_dismiss_seconds: pkg.message.auto_dismiss_seconds,
        max_displays_per_user: pkg.message.max_displays_per_user,
        send_start_hour: pkg.message.send_start_hour,
        send_end_hour: pkg.message.send_end_hour,
        allowed_weekdays: pkg.message.allowed_weekdays,
        animation: pkg.message.animation,
        status: 'active',
        channel: channel || 'web',
      });
      setAiProgressStep(5);
      setTimeout(() => {
        setAiGenerating(false);
        setAiObjective('');
        showToast('AI 메시지 생성 완료 — 혜택 부분 직접 작성 후 저장해주세요.', { type: 'success' });
      }, 400);
    } catch (e: any) {
      clearInterval(stepInterval);
      setAiGenerating(false);
      showToast(e?.message || 'AI 생성 중 오류', { type: 'error' });
    }
  };

  // ────────────────────────────────────────────────────────────────
  // 1-click 액션 (AI 다듬기 / 시간대 / 세그먼트)
  // ────────────────────────────────────────────────────────────────

  const handleQuickAction = async (actionType: 'ai_refine' | 'time_optimize' | 'segment_refine') => {
    if (messages.length === 0) {
      showToast('적용할 메시지가 없습니다.', { type: 'info' });
      return;
    }
    const targetMsg = [...messages].sort((a, b) => (b.stats?.impressions || 0) - (a.stats?.impressions || 0))[0];
    if (!targetMsg) return;

    const actionLabels: Record<typeof actionType, string> = {
      ai_refine: 'AI 본문 다듬기 (감성/실용/캐주얼 3안 자동 생성)',
      time_optimize: '시간대 최적화 (best CTR 시간대 자동 적용)',
      segment_refine: '세그먼트 정밀화 (LTV 상위 30% + 30일 활성)',
    };

    setConfirmState({
      mode: actionType === 'ai_refine' ? 'info' : 'warning',
      title: actionLabels[actionType],
      description: `"${targetMsg.title}" 메시지에 적용합니다. 진행하시겠습니까?`,
      confirmLabel: '적용',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/cdp/inapp/quick-action', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ message_id: targetMsg.id, action_type: actionType }),
          });
          const data = await res.json();
          if (handle503(data)) return;
          if (data.success && data.result.applied) {
            showToast(data.result.appliedDetails || '적용 완료', { type: 'success' });
            await loadAll();
          } else if (data.success) {
            showToast(data.result.appliedDetails || '적용 조건 미충족', { type: 'warning' });
          } else {
            showToast(data.error || '적용 실패', { type: 'error' });
          }
        } catch (e: any) {
          showToast(e?.message || '적용 중 오류', { type: 'error' });
        }
      },
    });
  };

  // ────────────────────────────────────────────────────────────────
  const [confirmPublish, setConfirmPublish] = useState(false);

  // 메시지 저장 / 삭제 / 상태 변경
  // ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editing?.title?.trim() || !editing?.body?.trim()) {
      showToast('제목과 본문은 필수입니다.', { type: 'warning' });
      return;
    }
    // 혜택 placeholder 검증 (AI 임의 혜택 영구 룰)
    if ((editing.body || '').includes('[혜택 안내') || (editing.body || '').includes('[직접 작성')) {
      showToast('혜택 안내 placeholder를 회사 정책에 맞게 직접 작성 후 저장해주세요.', { type: 'warning' });
      return;
    }
    try {
      const isUpdate = !!editing.id;
      const url = isUpdate ? `/api/cdp/inapp/${editing.id}` : '/api/cdp/inapp';
      const method = isUpdate ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          ...editing,
          // 기존 컬럼 호환 (position = template)
          position: editing.template || editing.position,
          backgroundColor: editing.background_color,
          textColor: editing.text_color,
          triggerEvent: editing.trigger_event,
          displayFrequency: editing.display_frequency,
        }),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        showToast(isUpdate ? '메시지 수정 완료' : '메시지 생성 완료', { type: 'success' });
        setEditing(null);
        await loadAll();
      } else {
        showToast(data.error || '저장 실패', { type: 'error' });
      }
    } catch (e: any) {
      showToast(e?.message || '저장 중 오류', { type: 'error' });
    }
  };

  const handleDelete = (m: MessageRow) => {
    setConfirmState({
      mode: 'danger',
      title: '메시지 삭제',
      description: `"${m.title}" 메시지를 archive 처리합니다. 사용자 노출 즉시 중단되며 통계는 보존됩니다.`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/cdp/inapp/${m.id}`, { method: 'DELETE', headers: authHeaders() });
          const data = await res.json();
          if (data.success) {
            showToast('메시지 삭제 완료', { type: 'success' });
            await loadAll();
          } else {
            showToast(data.error || '삭제 실패', { type: 'error' });
          }
        } catch (e: any) {
          showToast(e?.message || '삭제 중 오류', { type: 'error' });
        }
      },
    });
  };

  // ────────────────────────────────────────────────────────────────
  // 드릴다운 (메시지별 통계 + AI 진단)
  // ────────────────────────────────────────────────────────────────

  const openDrillDown = async (m: MessageRow) => {
    setDrillMessageId(m.id);
    setDrillStats(null);
    setDrillExplain(null);
    setDrillLoading(true);
    try {
      const [funnelRes, explainRes] = await Promise.all([
        fetch(`/api/cdp/inapp/funnel-stats/${m.id}`, { headers: authHeaders() }),
        fetch('/api/cdp/inapp/explain', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message_id: m.id }) }),
      ]);
      const funnelData = await funnelRes.json();
      const explainData = await explainRes.json();
      if (funnelData.success) {
        setDrillStats({
          funnel: funnelData.funnel,
          hourly: funnelData.hourly,
          heatmap: funnelData.heatmap,
          device: funnelData.device,
        });
      }
      if (explainData.success) setDrillExplain(explainData.result);
    } catch (e: any) {
      showToast(e?.message || '드릴다운 로드 실패', { type: 'error' });
    } finally {
      setDrillLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────────────
  // 이미지 업로드
  // ────────────────────────────────────────────────────────────────

  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImageUpload = async (file: File) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch('/api/cdp/inapp/upload-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setEditing((prev) => prev ? { ...prev, image_url: data.url } : prev);
        showToast('이미지 업로드 완료', { type: 'success' });
      } else {
        showToast(data.error || '이미지 업로드 실패', { type: 'error' });
      }
    } catch (e: any) {
      showToast(e?.message || '이미지 업로드 중 오류', { type: 'error' });
    }
  };

  // ────────────────────────────────────────────────────────────────
  // 필터 + 정렬
  // ────────────────────────────────────────────────────────────────

  const filteredMessages = useMemo(() => {
    let list = messages.filter((m) => !m.parent_message_id);
    if (statusFilter !== 'all') list = list.filter((m) => m.status === statusFilter);
    if (templateFilter !== 'all') {
      list = list.filter((m) => (m.template || m.position) === templateFilter);
    }
    if (sortMode === 'ctr_desc') {
      list.sort((a, b) => (b.stats?.ctr || 0) - (a.stats?.ctr || 0));
    } else if (sortMode === 'impressions_desc') {
      list.sort((a, b) => (b.stats?.impressions || 0) - (a.stats?.impressions || 0));
    }
    return list;
  }, [messages, statusFilter, templateFilter, sortMode]);

  // ────────────────────────────────────────────────────────────────
  // 데이터 부족 진단
  // ────────────────────────────────────────────────────────────────

  const dataShortage = useMemo(() => {
    const issues: string[] = [];
    if (messages.length === 0) issues.push('등록된 메시지 없음 — 자연어 입력 또는 빠른 시작 카드로 시작해주세요.');
    if (overview && overview.totalImpressions30d < 100) issues.push(`최근 30일 impression ${overview.totalImpressions30d}건 — 100건 이상 누적 후 정확한 분석 가능`);
    if (overview && overview.avgCTR > 0 && overview.avgCTR < 0.03) issues.push(`평균 CTR ${(overview.avgCTR * 100).toFixed(1)}% (3% 미만) — AI 다듬기 1-click 액션 권장`);
    return issues;
  }, [messages, overview]);

  // ════════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════════

  // ★ 2026-06-17 채널 분리 — 진입 시 웹/앱 선택 (인앱메시지 안에서 채널 가름)
  if (!channel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
        <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
            <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-semibold text-white">인앱 메시지</h1>
                <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
              </div>
              <p className="text-xs md:text-sm text-white/50 mt-0.5">먼저 메시지를 띄울 곳을 선택하세요 — 웹 자사몰 / 모바일 앱</p>
            </div>
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <button
              onClick={() => setChannel('web')}
              className="group text-left bg-gradient-to-br from-violet-500/15 via-purple-500/10 to-fuchsia-500/15 border border-violet-400/30 hover:border-violet-300/60 rounded-2xl p-6 transition-all hover:scale-[1.02]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center">
                  <Globe className="w-6 h-6 text-violet-100" />
                </div>
                <ArrowLeft className="w-5 h-5 text-white/30 rotate-180 group-hover:text-white/60 transition-colors" />
              </div>
              <h3 className="text-lg font-bold text-white">웹 자사몰 팝업</h3>
              <p className="text-xs text-white/60 mt-1.5 leading-relaxed">고객사 웹사이트에 뜨는 팝업. 모달 · 슬라이드 · 토스트 · 플로팅 버튼.</p>
              <div className="text-[11px] text-emerald-300/80 mt-3">즉시 사용 가능</div>
            </button>
            <button
              onClick={() => setChannel('app')}
              className="group text-left bg-gradient-to-br from-sky-500/15 via-blue-500/10 to-indigo-500/15 border border-sky-400/30 hover:border-sky-300/60 rounded-2xl p-6 transition-all hover:scale-[1.02]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500/40 to-indigo-500/40 flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-sky-100" />
                </div>
                <ArrowLeft className="w-5 h-5 text-white/30 rotate-180 group-hover:text-white/60 transition-colors" />
              </div>
              <h3 className="text-lg font-bold text-white">모바일 앱 인앱</h3>
              <p className="text-xs text-white/60 mt-1.5 leading-relaxed">모바일 앱 화면에 뜨는 인앱. 모달 · 전면 · 배너 · 토스트.</p>
              <div className="text-[11px] text-amber-300/80 mt-3">웹뷰 앱 지원 — 스니펫 한 줄 (순수 네이티브 앱은 추후)</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // ★ D222+ Phase 3 (2026-05-27): 다크 → 보라 그라데이션 톤 다운
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      {/* ▼ 1: 상단 헤더 (sticky + BETA badge) — D222+ Phase 3 보라 톤 다운 */}
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">인앱 메시지</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
              <button onClick={() => setChannel(null)} className="text-[11px] text-white/70 hover:text-white bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors">
                {channel === 'app' ? <><Smartphone className="w-3 h-3" /> 앱</> : <><Globe className="w-3 h-3" /> 웹</>}
                <span className="text-white/40">· 바꾸기</span>
              </button>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">
              {channel === 'app'
                ? '모바일 앱 인앱 — 모달 · 전면 · 배너 · 토스트 (앱 SDK 연동 후 표시)'
                : '웹 자사몰 팝업 — 모달 · 슬라이드 · 토스트 · 플로팅 버튼'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors" aria-label="새로고침">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">새로고침</span>
            </button>
            <button
              onClick={() => setEditing({ ...EMPTY_FORM, channel: channel || 'web' })}
              className="text-xs bg-gradient-to-r from-rose-500/40 to-pink-500/40 hover:from-rose-500/60 hover:to-pink-500/60 text-rose-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-rose-400/30"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 메시지
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ▼ 영역 2: 데이터 부족 안내 카드 (조건부) */}
        {dataShortage.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-amber-300" />
              <h3 className="text-sm font-bold text-amber-100">데이터 부족 진단</h3>
            </div>
            <ul className="space-y-1 text-xs text-amber-200/80">
              {dataShortage.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-amber-300 mt-0.5">·</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ▼ 영역 3: AI 자율 진단 카드 */}
        <div className="bg-gradient-to-br from-violet-500/15 via-purple-500/10 to-fuchsia-500/15 border border-violet-400/30 rounded-xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-violet-200" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white">AI 자율 진단</h3>
                <p className="text-xs text-white/60 mt-0.5">{topInsight || '회사 메시지 성과를 AI가 자동 분석 — 영향 요인 + 개선 추천 도출'}</p>
              </div>
            </div>
            <button
              onClick={handleDiagnose}
              disabled={diagnosing || messages.length === 0}
              className="text-xs bg-violet-500/30 hover:bg-violet-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-violet-100 px-4 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors"
            >
              {diagnosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {diagnosing ? '진단 중...' : 'AI 진단 시작'}
            </button>
          </div>
          <div className="text-[10px] text-white/30 italic mt-3">Data source — 회사 누적 30일 평균 + 본 메시지 통계</div>
        </div>

        {/* ▼ 영역 4: 1-click 액션 3 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { type: 'ai_refine' as const, icon: Wand2, title: 'AI 본문 다듬기', desc: '감성/실용/캐주얼 3안 자동 생성 → A/B 시작', gradient: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-400/30', iconBg: 'from-violet-500/40 to-purple-500/40', iconColor: 'text-violet-200' },
            { type: 'time_optimize' as const, icon: Clock, title: '시간대 최적화', desc: 'best CTR 시간대 자동 적용 (안전 시간대 한정)', gradient: 'from-emerald-500/20 to-teal-500/20', border: 'border-emerald-400/30', iconBg: 'from-emerald-500/40 to-teal-500/40', iconColor: 'text-emerald-200' },
            { type: 'segment_refine' as const, icon: Target, title: '세그먼트 정밀화', desc: 'LTV 상위 30% + 30일 활성 사용자 자동 한정', gradient: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-400/30', iconBg: 'from-amber-500/40 to-orange-500/40', iconColor: 'text-amber-200' },
          ].map((action) => (
            <button
              key={action.type}
              onClick={() => handleQuickAction(action.type)}
              disabled={messages.length === 0}
              className={`bg-gradient-to-br ${action.gradient} border ${action.border} rounded-xl p-4 text-left hover:scale-[1.02] transition-transform disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${action.iconBg} flex items-center justify-center flex-shrink-0`}>
                  <action.icon className={`w-4 h-4 ${action.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">{action.title}</div>
                  <div className="text-xs text-white/60 mt-1">{action.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4" />}
        {/* ▼ 영역 5: 자연어 입력 + 빠른 시작 7 카드 */}
        <div className="bg-gradient-to-br from-fuchsia-500/10 via-purple-500/8 to-indigo-500/10 border border-fuchsia-400/30 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-fuchsia-300" />
            <h3 className="text-sm font-bold text-white">자연어 한 줄로 메시지 자동 생성</h3>
          </div>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input
              type="text"
              value={aiObjective}
              onChange={(e) => setAiObjective(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAIGenerate(aiObjective); }}
              placeholder="예: 장바구니 24시간 후 회복 메시지 / 신규 가입자 환영 인사"
              className="flex-1 min-w-[240px] px-4 py-2.5 bg-violet-900/40 border border-fuchsia-400/30 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-fuchsia-400/60"
              disabled={aiGenerating}
            />
            <button
              onClick={() => handleAIGenerate(aiObjective)}
              disabled={aiGenerating || !aiObjective.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:from-fuchsia-600 hover:to-purple-600 text-white text-sm font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {aiGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiGenerating ? 'AI 생성 중...' : 'AI 자동 생성'}
            </button>
          </div>

          <div className="text-xs text-white/60 mb-3">또는 빠른 시작 시나리오 선택:</div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {quickStartCards.map((card) => {
              const visual = SCENARIO_VISUAL[card.scenario] || SCENARIO_VISUAL.cart_recovery;
              const Icon = visual.icon;
              return (
                <button
                  key={card.scenario}
                  onClick={() => handleAIGenerate('', card.scenario)}
                  disabled={aiGenerating}
                  className={`bg-gradient-to-br ${visual.gradient} hover:scale-[1.03] transition-transform p-3 rounded-lg text-left disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Icon className="w-5 h-5 text-white mb-2" />
                  <div className="text-xs font-bold text-white">{card.label}</div>
                  <div className="text-[10px] text-white/80 mt-0.5 line-clamp-2">{card.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ▼ 영역 6: 6 sub-agent 진행 카드 (조건부 — 생성 중일 때만) */}
        {aiGenerating && (
          <div className="bg-violet-900/40 border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-bold text-white mb-3">AI 생성 진행 중...</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(SUB_AGENT_VISUAL).map(([key, visual], idx) => {
                const Icon = visual.icon;
                const isDone = idx <= aiProgressStep;
                return (
                  <div
                    key={key}
                    className={`p-3 rounded-lg border transition-all ${
                      isDone
                        ? `bg-gradient-to-br ${visual.gradient} border-white/30 shadow-lg`
                        : 'bg-violet-900/40 border-white/5 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {isDone ? <Icon className="w-4 h-4 text-white" /> : <Loader2 className="w-4 h-4 animate-spin text-white/40" />}
                      <span className="text-xs font-bold text-white">{visual.label}</span>
                    </div>
                    <div className="text-[10px] text-white/70">{idx + 1}/6</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ▼ 영역 7: 요약 5 metric + 격차 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: '총 메시지', value: overview.totalMessages.toLocaleString(), delta: null, icon: Layers },
              { label: '활성', value: overview.activeMessages.toLocaleString(), delta: null, icon: Activity },
              { label: '평균 CTR', value: `${(overview.avgCTR * 100).toFixed(2)}%`, delta: overview.delta.avgCTRPercent, icon: MousePointer },
              { label: '30일 impression', value: overview.totalImpressions30d.toLocaleString(), delta: overview.delta.impressionsPercent, icon: Eye },
              { label: '24h 매핑 구매', value: overview.totalAttributedPurchases30d.toLocaleString(), delta: overview.delta.purchasesPercent, icon: TrendingUp },
            ].map((metric, idx) => (
              <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <metric.icon className="w-3.5 h-3.5 text-white/50" />
                  <span className="text-[11px] text-white/50">{metric.label}</span>
                </div>
                <div className="text-lg font-bold text-white">{metric.value}</div>
                {metric.delta !== null && (
                  <div className={`text-[10px] mt-1 flex items-center gap-1 ${metric.delta >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {metric.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {metric.delta >= 0 ? '+' : ''}{metric.delta.toFixed(1)}% 이전 30일 대비
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {overview && (
          <div className="text-[10px] text-white/30 italic">Data source — {overview.dataSource}</div>
        )}

        {/* ▼ 영역 8: 자세히 분석 토글 (6 차트) */}
        <div className="bg-white/5 border border-white/10 rounded-xl">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-5 py-3 flex items-center justify-between text-sm font-medium text-white/80 hover:bg-white/5 transition-colors"
          >
            <span className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              자세히 분석 (Top 메시지 + Explainability)
            </span>
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showDetails && (
            <div className="px-5 pb-5 space-y-4 border-t border-white/10 pt-4">
              {/* Top 메시지 */}
              <div>
                <h4 className="text-xs font-bold text-white/80 mb-2">Top CTR 메시지 (30일)</h4>
                {topMessages.length === 0 ? (
                  <div className="text-xs text-white/40 py-4 text-center">데이터 누적 부족</div>
                ) : (
                  <div className="space-y-1.5">
                    {topMessages.map((m) => (
                      <div key={m.messageId} className="flex items-center gap-3 text-xs bg-white/5 rounded px-3 py-2">
                        <span className="text-white/40 font-mono w-6">{m.rank}.</span>
                        <span className="flex-1 text-white/80 truncate">{m.title}</span>
                        <span className="text-emerald-300 font-bold">{(m.ctr * 100).toFixed(2)}%</span>
                        <span className="text-white/40">{m.impressions.toLocaleString()}건</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-white/30 italic mt-2">Data source — 회사 30일 누적 impression ≥ 10건 메시지</div>
              </div>
            </div>
          )}
        </div>

        {/* ▼ 영역 10: 메시지 목록 (filter + sort + 카드) */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <h3 className="text-sm font-bold text-white">메시지 목록 ({filteredMessages.length}건)</h3>
            <div className="ml-auto flex gap-2 flex-wrap">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as Status | 'all')}
                className="text-xs bg-violet-900/40 border border-white/10 rounded-lg px-2 py-1.5 text-white"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="paused">일시 중지</option>
                <option value="archived">보관함</option>
              </select>
              <select
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value as Template | 'all')}
                className="text-xs bg-violet-900/40 border border-white/10 rounded-lg px-2 py-1.5 text-white"
              >
                <option value="all">전체 템플릿</option>
                {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="text-xs bg-violet-900/40 border border-white/10 rounded-lg px-2 py-1.5 text-white"
              >
                <option value="created_desc">최신순</option>
                <option value="ctr_desc">CTR 높은순</option>
                <option value="impressions_desc">노출 많은순</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center text-white/50">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="py-12 text-center text-white/50 text-sm">
              조건에 일치하는 메시지가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMessages.map((m) => {
                const template = (m.template || m.position || 'top_banner') as Template;
                return (
                  <div key={m.id} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <div className="text-sm font-bold text-white">{m.title}</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            m.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                            m.status === 'paused' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-white/10 text-white/50'
                          }`}>{m.status}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded-full">
                            {TEMPLATE_LABELS[template]}
                          </span>
                        </div>
                        <div className="text-xs text-white/70 mb-2 line-clamp-2">{m.body}</div>
                        <div className="flex flex-wrap gap-2 text-[10px] text-white/50">
                          <span>트리거: {m.trigger_event}</span>
                          <span>·</span>
                          <span>빈도: {m.display_frequency}</span>
                          {(m.send_start_hour !== null && m.send_start_hour !== undefined) && (
                            <>
                              <span>·</span>
                              <span>{m.send_start_hour}~{m.send_end_hour}시</span>
                            </>
                          )}
                        </div>
                        {m.stats && (
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-white/70 border-t border-white/5 pt-2">
                            <span>표시 <strong className="text-indigo-300">{m.stats.impressions.toLocaleString()}</strong></span>
                            <span>클릭 <strong className="text-emerald-300">{m.stats.clicks.toLocaleString()}</strong></span>
                            <span>닫힘 <strong className="text-white/50">{m.stats.dismisses.toLocaleString()}</strong></span>
                            <span>CTR <strong>{(m.stats.ctr * 100).toFixed(2)}%</strong></span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button onClick={() => openDrillDown(m)} className="text-[11px] text-cyan-300 hover:bg-cyan-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" /> 통계
                        </button>
                        <button onClick={() => setEditing(m)} className="text-[11px] text-indigo-300 hover:bg-indigo-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                          <Edit2 className="w-3 h-3" /> 수정
                        </button>
                        <button onClick={() => handleDelete(m)} className="text-[11px] text-rose-300 hover:bg-rose-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> 삭제
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ▼ 영역 11: 편집 모달 전면 재작성 */}
      {editing && (
        <EditModal
          editing={editing}
          setEditing={setEditing}
          availableVariables={availableVariables}
          onSave={() => (!editing?.id && editing?.status === 'active' ? setConfirmPublish(true) : handleSave())}
          fileInputRef={fileInputRef}
          onImageUpload={handleImageUpload}
        />
      )}

      <CreditConfirmModal
        open={confirmPublish}
        source="inapp-publish"
        onConfirm={() => { setConfirmPublish(false); handleSave(); }}
        onCancel={() => setConfirmPublish(false)}
      />

      {/* ▼ 영역 12: 드릴다운 통계 모달 */}
      {drillMessageId && (
        <DrillDownModal
          loading={drillLoading}
          stats={drillStats}
          explain={drillExplain}
          onClose={() => { setDrillMessageId(null); setDrillStats(null); setDrillExplain(null); }}
        />
      )}

      {/* ConfirmModal */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 편집 모달 (10 영역)
// ════════════════════════════════════════════════════════════════════

interface EditModalProps {
  editing: Partial<MessageRow>;
  setEditing: (m: Partial<MessageRow> | null) => void;
  availableVariables: AvailableVariable[];
  onSave: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onImageUpload: (file: File) => void;
}

function EditModal({ editing, setEditing, availableVariables, onSave, fileInputRef, onImageUpload }: EditModalProps) {
  const [segmentCount, setSegmentCount] = useState<number | null>(null);
  const [segmentDesc, setSegmentDesc] = useState<string>('');
  const [previewCustomer, setPreviewCustomer] = useState<'VIP' | '일반' | '신규'>('일반');
  const [activeTab, setActiveTab] = useState<'content' | 'design' | 'target'>('content');

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // 세그먼트 매칭 customer 수 실시간 카운트
  useEffect(() => {
    const conds = editing.segment_conditions || {};
    if (Object.keys(conds.customer || {}).length === 0 && Object.keys(conds.events || {}).length === 0) {
      setSegmentCount(null);
      setSegmentDesc('전체 회원');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/cdp/inapp/segment-preview', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ segment_conditions: conds }),
        });
        const data = await res.json();
        if (data.success) {
          setSegmentCount(data.count);
          setSegmentDesc(data.description);
        }
      } catch {}
    }, 600);
    return () => clearTimeout(timer);
  }, [editing.segment_conditions]);

  // web 채널은 4종(모달/슬라이드/토스트/플로팅)만 — 옛 배너 등 4종 밖 형태로 저장된 메시지를 열면 모달로 자동 정규화
  useEffect(() => {
    const WEB_OK = ['center_modal', 'slide_in', 'toast', 'floating_button'];
    if (editing.channel !== 'app' && editing.template && !WEB_OK.includes(editing.template)) {
      setEditing({ ...editing, template: 'center_modal' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.id]);

  const updateField = (key: keyof MessageRow, value: any) => {
    setEditing({ ...editing, [key]: value });
  };

  // 고급 디자인 프리셋 — 클릭 시 배경(그라데이션)·글자색 일괄 적용. SDK/미리보기가 background를 그대로 렌더.
  const DESIGN_PRESETS: { key: string; label: string; background: string; textColor: string }[] = [
    { key: 'violet_hero', label: '바이올렛', background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)', textColor: '#ffffff' },
    { key: 'midnight', label: '미드나잇', background: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)', textColor: '#ffffff' },
    { key: 'sunset', label: '선셋', background: 'linear-gradient(135deg, #fb7185 0%, #f97316 100%)', textColor: '#ffffff' },
    { key: 'ocean', label: '오션', background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', textColor: '#ffffff' },
    { key: 'forest', label: '포레스트', background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)', textColor: '#ffffff' },
    { key: 'gold_lux', label: '골드 럭스', background: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)', textColor: '#fcd34d' },
    { key: 'candy', label: '캔디', background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #fb923c 100%)', textColor: '#ffffff' },
    { key: 'clean', label: '클린', background: '#ffffff', textColor: '#0f172a' },
  ];
  const applyPreset = (p: { background: string; textColor: string }) => {
    setEditing({ ...editing, background_color: p.background, text_color: p.textColor });
  };

  const previewSample: Record<string, Record<string, any>> = {
    VIP: { name: '김민수', grade: 'VIP', points: 12000, region: '서울', recent_product: '강남점', cart_count: 3, last_purchase_days_ago: 7, purchase_count: 24, total_purchase_amount: 1500000 },
    '일반': { name: '이서연', grade: '일반', points: 2300, region: '경기', recent_product: '판교점', cart_count: 1, last_purchase_days_ago: 45, purchase_count: 4, total_purchase_amount: 230000 },
    '신규': { name: '정지훈', grade: '신규', points: 0, region: '인천', recent_product: '', cart_count: 0, last_purchase_days_ago: 999, purchase_count: 0, total_purchase_amount: 0 },
  };

  const replaceVars = (text: string, customer: Record<string, any>): string => {
    if (!text) return '';
    let out = text;
    const legacyMap: Record<string, string> = {
      '%고객명%': String(customer.name || '고객'),
      '%이름%': String(customer.name || '고객'),
      '%등급%': String(customer.grade || ''),
      '%포인트%': String(customer.points ?? ''),
      '%지역%': String(customer.region || ''),
      '%최근구매매장%': String(customer.recent_product || ''),
    };
    for (const [pattern, value] of Object.entries(legacyMap)) {
      if (out.includes(pattern)) out = out.split(pattern).join(value);
    }
    out = out.replace(/\{\{\s*customer\.([a-zA-Z_]+)\s*(?:\|\s*default:\s*['"]([^'"]+)['"])?\s*\}\}/g,
      (_m, varName, def) => {
        const val = customer[varName];
        if (val === undefined || val === null || val === '') return def !== undefined ? String(def) : '';
        return String(val);
      });
    return out;
  };

  const sampleCustomer = previewSample[previewCustomer];
  const renderedTitle = replaceVars(editing.title || '', sampleCustomer);
  const renderedBody = replaceVars(editing.body || '', sampleCustomer);
  const hasPlaceholder = (editing.body || '').includes('[혜택') || (editing.body || '').includes('[직접');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
      <div className="bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white leading-tight">{editing.id ? '메시지 수정' : '신규 메시지'}</h3>
              <p className="text-[11px] text-white/50">자사몰에 뜨는 인앱 — 실시간 미리보기로 확인하며 편집</p>
            </div>
          </div>
          <button onClick={() => setEditing(null)} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-0">
          {/* 좌측 — 3탭 (내용 / 디자인 / 타겟·시점) */}
          <div className="p-6 space-y-5 border-r border-white/5">
            <div className="flex gap-1.5">
              {([['content', '내용', Edit2], ['design', '디자인', Wand2], ['target', '타겟·시점', Target]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg transition-colors ${activeTab === key ? 'bg-violet-500/30 border border-violet-400/50 text-white' : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/80'}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            {hasPlaceholder && activeTab === 'content' && (
              <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-100">
                  <strong>혜택 안내 placeholder 발견</strong> — 회사 정책에 맞게 직접 작성 후 저장해주세요. AI는 구체 혜택 임의 작성 X.
                </div>
              </div>
            )}

            {/* 탭 내용: 제목 · 본문 · 뱃지 */}
            <div className={activeTab === 'content' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Edit2 className="w-3 h-3" /> 내용
              </h4>
              <input
                type="text"
                value={editing.title || ''}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="메시지 제목 (20자 안, 변수 X)"
                className="w-full px-3 py-2 mb-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                maxLength={100}
              />
              <textarea
                value={editing.body || ''}
                onChange={(e) => updateField('body', e.target.value)}
                placeholder="짧고 강렬하게 한두 문장. 혜택 부분은 [혜택 안내 — 직접 작성해주세요] placeholder 사용"
                className="w-full px-3 py-2 mb-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-y h-24 focus:outline-none focus:border-violet-400/50"
                maxLength={300}
              />
              <input
                type="text"
                value={editing.badge_text || ''}
                onChange={(e) => updateField('badge_text', e.target.value)}
                placeholder="뱃지 (선택, 8자 안 — NEW · VIP · 오랜만이에요)"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                maxLength={20}
              />
            </div>

            {/* 탭 디자인: 표시 형태 */}
            <div className={activeTab === 'design' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3" /> 표시 형태 ({(editing.channel === 'app' ? CHANNEL_TEMPLATES.app : CHANNEL_TEMPLATES.web).length}종)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(editing.channel === 'app' ? CHANNEL_TEMPLATES.app : CHANNEL_TEMPLATES.web).map((tpl) => (
                  <button
                    key={tpl}
                    onClick={() => updateField('template', tpl)}
                    className={`text-xs px-2 py-2 rounded-lg border transition-colors ${
                      editing.template === tpl
                        ? 'bg-violet-500/30 border-violet-400/60 text-white'
                        : 'bg-violet-900/50 border-white/10 text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {TEMPLATE_LABELS[tpl]}
                  </button>
                ))}
              </div>
            </div>

            {/* 탭 디자인: 프리셋 갤러리 */}
            <div className={activeTab === 'design' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-300" /> 디자인 (클릭해서 골라보세요)
              </h4>
              <div className="grid grid-cols-4 gap-2">
                {DESIGN_PRESETS.map((p) => {
                  const active = editing.background_color === p.background;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={`relative h-14 rounded-xl border overflow-hidden transition-all ${active ? 'border-fuchsia-400 ring-2 ring-fuchsia-400/50' : 'border-white/10 hover:border-white/40 hover:scale-[1.03]'}`}
                      style={{ background: p.background }}
                      title={p.label}
                    >
                      <span className="absolute inset-x-0 bottom-0 text-[9px] font-bold py-0.5 bg-black/35 backdrop-blur-sm" style={{ color: p.textColor }}>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 탭 디자인: 이미지 업로드 */}
            <div className={activeTab === 'design' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3" /> 이미지 (선택)
              </h4>
              {!['center_modal', 'slide_in', 'top_banner', 'bottom_banner', 'full_screen', 'inline_card'].includes(editing.template || '') ? (
                <div className="text-[11px] text-white/50 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                  토스트·플로팅 버튼 형태는 이미지를 지원하지 않습니다. 이미지를 쓰려면 중앙 모달이나 슬라이드 인을 선택해주세요.
                </div>
              ) : (
              <div className="flex gap-2 items-center">
                {editing.image_url ? (
                  <div className="relative">
                    <img src={editing.image_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className="w-20 h-20 object-cover rounded-lg bg-white/5" />
                    <button
                      onClick={() => updateField('image_url', null)}
                      className="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                      aria-label="이미지 제거"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 bg-violet-900/50 border border-dashed border-white/20 rounded-lg text-xs text-white/70 hover:bg-white/5 flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    이미지 업로드 (2MB 이하)
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageUpload(f); }}
                />
              </div>
              )}
            </div>

            {/* 탭 내용: CTA 버튼 */}
            <div className={activeTab === 'content' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <MousePointer className="w-3 h-3" /> CTA 버튼 (최대 3개)
              </h4>
              <div className="space-y-2">
                {(editing.buttons || []).map((btn, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-[1fr,1fr,80px,40px] gap-2 items-center">
                    <input
                      type="text"
                      value={btn.label}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], label: e.target.value };
                        updateField('buttons', newButtons);
                      }}
                      placeholder="버튼 라벨"
                      className="px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                    <input
                      type="url"
                      value={btn.action_url || ''}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], action_url: e.target.value };
                        updateField('buttons', newButtons);
                      }}
                      placeholder="이동 URL"
                      className="px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                    <select
                      value={btn.style}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], style: e.target.value as any };
                        updateField('buttons', newButtons);
                      }}
                      className="px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white"
                    >
                      <option value="primary">강조</option>
                      <option value="secondary">보통</option>
                      <option value="tertiary">약함</option>
                    </select>
                    <button
                      onClick={() => updateField('buttons', (editing.buttons || []).filter((_, i) => i !== idx))}
                      className="text-rose-300 hover:bg-rose-500/10 rounded p-1.5"
                      aria-label="버튼 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {(editing.buttons || []).length < 3 && (
                  <button
                    onClick={() => updateField('buttons', [...(editing.buttons || []), {
                      id: `btn_${(editing.buttons || []).length}`,
                      label: '자세히 보기',
                      action_url: '[URL — 회사 admin 수정]',
                      style: 'primary',
                      background_color: '#4f46e5',
                      text_color: '#ffffff',
                    }])}
                    className="text-xs text-violet-300 hover:bg-violet-500/10 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> 버튼 추가
                  </button>
                )}
              </div>
            </div>

            {/* 탭 타겟·시점: 세그먼트 */}
            <div className={activeTab === 'target' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Target className="w-3 h-3" /> 타겟 세그먼트
              </h4>
              <div className="bg-violet-900/50 border border-white/10 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="등급 (콤마 분리: VIP,일반)"
                    value={(editing.segment_conditions?.customer?.grade || []).join(',')}
                    onChange={(e) => {
                      const grades = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                      updateField('segment_conditions', {
                        ...(editing.segment_conditions || {}),
                        customer: { ...(editing.segment_conditions?.customer || {}), grade: grades.length > 0 ? grades : undefined },
                      });
                    }}
                    className="px-2 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white placeholder-white/30"
                  />
                  <input
                    type="text"
                    placeholder="지역 (콤마: 서울,경기)"
                    value={(editing.segment_conditions?.customer?.region || []).join(',')}
                    onChange={(e) => {
                      const regions = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                      updateField('segment_conditions', {
                        ...(editing.segment_conditions || {}),
                        customer: { ...(editing.segment_conditions?.customer || {}), region: regions.length > 0 ? regions : undefined },
                      });
                    }}
                    className="px-2 py-1.5 bg-violet-900/40 border border-white/10 rounded text-xs text-white placeholder-white/30"
                  />
                </div>
                <div className="text-[11px] text-cyan-300 flex items-center gap-2 pt-1 border-t border-white/5">
                  <Users className="w-3 h-3" />
                  {segmentCount === null ? '실시간 매칭 중...' : (
                    <span>매칭 회원: <strong className="text-white">{segmentCount.toLocaleString()}명</strong> ({segmentDesc})</span>
                  )}
                </div>
              </div>
            </div>

            {/* 탭 타겟·시점: 개인화 · 트리거 · 시간 · 색상 */}
            <div className={activeTab === 'target' ? 'space-y-5' : 'hidden'}>
            {/* 개인화 변수 */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3" /> 개인화 변수 (본문 안 활용)
              </h4>
              <div className="bg-violet-900/50 border border-white/10 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {availableVariables.slice(0, 9).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => {
                      const cursorBody = (editing.body || '') + ' ' + v.key;
                      updateField('body', cursorBody);
                    }}
                    className="text-[10px] bg-violet-900/40 hover:bg-violet-500/20 border border-white/10 rounded px-2 py-1 text-left transition-colors"
                    title={v.hint}
                  >
                    <div className="text-violet-300 font-mono truncate">{v.key}</div>
                    <div className="text-white/50">{v.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 트리거 조건 */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> 트리거 조건
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={editing.trigger_event || 'page_load'}
                  onChange={(e) => {
                    const event = e.target.value as TriggerEvent;
                    updateField('trigger_event', event);
                    updateField('trigger_conditions', { ...(editing.trigger_conditions || {}), event });
                  }}
                  className="px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white"
                >
                  <option value="page_load">페이지 로드</option>
                  <option value="cart_add">장바구니 담음</option>
                  <option value="cart_view">장바구니 페이지</option>
                  <option value="checkout_start">결제 시작</option>
                  <option value="scroll">스크롤 도달</option>
                  <option value="time_on_page">페이지 체류</option>
                  <option value="exit_intent">이탈 의도</option>
                  <option value="cart_value">장바구니 금액</option>
                </select>
                <select
                  value={editing.display_frequency || 'once_per_session'}
                  onChange={(e) => updateField('display_frequency', e.target.value as Frequency)}
                  className="px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white"
                >
                  <option value="once_per_session">세션당 1회</option>
                  <option value="once_per_day">하루 1회</option>
                  <option value="always">항상</option>
                </select>
              </div>
            </div>

            {/* 시간대 / 요일 / 한도 */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> 시간대 / 요일 / 한도
              </h4>
              <div className="space-y-3 pl-4 border-l-2 border-white/10">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">시작 시간 (9~22 권장)</label>
                    <input
                      type="number"
                      min={0} max={23}
                      value={editing.send_start_hour ?? ''}
                      onChange={(e) => updateField('send_start_hour', e.target.value ? Number(e.target.value) : null)}
                      placeholder="9"
                      className="w-full px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">종료 시간</label>
                    <input
                      type="number"
                      min={0} max={23}
                      value={editing.send_end_hour ?? ''}
                      onChange={(e) => updateField('send_end_hour', e.target.value ? Number(e.target.value) : null)}
                      placeholder="22"
                      className="w-full px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">노출 요일</label>
                  <div className="flex gap-1">
                    {['일','월','화','수','목','금','토'].map((day, idx) => {
                      const allowed = (editing.allowed_weekdays || [0,1,2,3,4,5,6]).includes(idx);
                      return (
                        <button
                          key={day}
                          onClick={() => {
                            const current = editing.allowed_weekdays || [0,1,2,3,4,5,6];
                            const next = allowed ? current.filter((d) => d !== idx) : [...current, idx].sort();
                            updateField('allowed_weekdays', next);
                          }}
                          className={`flex-1 py-1.5 text-[11px] rounded ${
                            allowed ? 'bg-emerald-500/30 text-emerald-100 border border-emerald-400/40' : 'bg-violet-900/50 border border-white/10 text-white/40'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">자동 닫힘 (초, 비우면 사용자 직접)</label>
                    <input
                      type="number"
                      min={1}
                      value={editing.auto_dismiss_seconds ?? ''}
                      onChange={(e) => updateField('auto_dismiss_seconds', e.target.value ? Number(e.target.value) : null)}
                      placeholder="비우면 수동"
                      className="w-full px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">사용자별 최대 노출 횟수</label>
                    <input
                      type="number"
                      min={1}
                      value={editing.max_displays_per_user ?? ''}
                      onChange={(e) => updateField('max_displays_per_user', e.target.value ? Number(e.target.value) : null)}
                      placeholder="비우면 무한"
                      className="w-full px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">애니메이션</label>
                  <select
                    value={editing.animation || 'fade'}
                    onChange={(e) => updateField('animation', e.target.value as Animation)}
                    className="w-full px-2 py-1.5 bg-violet-900/50 border border-white/10 rounded text-xs text-white"
                  >
                    <option value="fade">Fade (default)</option>
                    <option value="slide">Slide</option>
                    <option value="bounce">Bounce</option>
                    <option value="pulse">Pulse</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 색상 + 상태 */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3" /> 색상 + 상태
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">배경색</label>
                  <input
                    type="color"
                    value={editing.background_color || '#4f46e5'}
                    onChange={(e) => updateField('background_color', e.target.value)}
                    className="w-full h-9 bg-violet-900/50 border border-white/10 rounded cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">글자색</label>
                  <input
                    type="color"
                    value={editing.text_color || '#ffffff'}
                    onChange={(e) => updateField('text_color', e.target.value)}
                    className="w-full h-9 bg-violet-900/50 border border-white/10 rounded cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">상태</label>
                  <select
                    value={editing.status || 'active'}
                    onChange={(e) => updateField('status', e.target.value as Status)}
                    className="w-full h-9 px-2 bg-violet-900/50 border border-white/10 rounded text-xs text-white"
                  >
                    <option value="active">활성</option>
                    <option value="paused">일시 중지</option>
                  </select>
                </div>
              </div>
            </div>
            </div>
          </div>

          {/* 우측 — 실시간 미리보기 */}
          <div className="bg-slate-950/40 p-6 space-y-3 sticky top-[76px] h-fit max-h-[80vh] overflow-y-auto">
            <h4 className="text-xs font-bold text-white/80 mb-1 flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> 실시간 미리보기
            </h4>
            {editing.channel === 'app' && (
              <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2 text-[11px] text-amber-200 flex items-start gap-1.5">
                <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>앱 인앱은 <strong>앱 SDK 연동 후</strong> 실제 표시됩니다. 아래는 내용·형태 미리보기입니다.</span>
              </div>
            )}
            <div className="flex gap-1">
              {(['VIP', '일반', '신규'] as const).map((pc) => (
                <button
                  key={pc}
                  onClick={() => setPreviewCustomer(pc)}
                  className={`flex-1 px-2 py-1.5 text-xs rounded ${
                    previewCustomer === pc
                      ? 'bg-violet-500/30 border border-violet-400/40 text-white'
                      : 'bg-violet-900/40 border border-white/10 text-white/50'
                  }`}
                >
                  {pc}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-white/40">
              샘플: {sampleCustomer.name} · {sampleCustomer.grade} · {sampleCustomer.points?.toLocaleString()}P
            </div>

            <InAppMessagePreview
              template={(editing.template || 'top_banner') as string}
              title={renderedTitle}
              body={renderedBody}
              imageUrl={editing.image_url}
              badge={editing.badge_text}
              buttons={(editing.buttons || []).map((b) => ({ ...b, label: replaceVars(b.label, sampleCustomer) }))}
              backgroundColor={editing.background_color || '#4f46e5'}
              textColor={editing.text_color || '#ffffff'}
            />
          </div>
        </div>

        {/* 푸터 */}
        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-bold rounded-lg">
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 드릴다운 모달 (통계 + AI 영향 요인)
// ════════════════════════════════════════════════════════════════════

interface DrillDownProps {
  loading: boolean;
  stats: FunnelStats | null;
  explain: ExplainResult | null;
  onClose: () => void;
}

function DrillDownModal({ loading, stats, explain, onClose }: DrillDownProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-300" />
            메시지 통계 + AI 영향 요인 분석
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading && (
            <div className="py-12 flex justify-center text-white/50">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}

          {!loading && stats && (
            <>
              {/* Funnel */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h4 className="text-sm font-bold text-white mb-3">Funnel — impression → click → 24h 매핑 구매</h4>
                <div className="space-y-2">
                  {stats.funnel.steps.map((step, idx) => {
                    const colors = ['bg-indigo-500/40', 'bg-emerald-500/40', 'bg-rose-500/40', 'bg-amber-500/40'];
                    return (
                      <div key={idx}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-white/70">{step.name}</span>
                          <span className="text-white font-bold">{step.count.toLocaleString()} ({step.percentOfTotal.toFixed(1)}%)</span>
                        </div>
                        <div className="h-6 bg-violet-900/50 rounded overflow-hidden">
                          <div className={`h-full ${colors[idx]} transition-all`} style={{ width: `${Math.max(step.percentOfTotal, 2)}%` }} />
                        </div>
                        {step.dropoffReason && (
                          <div className="text-[10px] text-amber-200/70 mt-1">⚠ {step.dropoffReason}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {stats.funnel.attributedRevenueKrw > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 text-xs text-emerald-300">
                    24h 매핑 매출: <strong>{stats.funnel.attributedRevenueKrw.toLocaleString()}원</strong>
                  </div>
                )}
                <div className="text-[10px] text-white/30 italic mt-3">Data source — {stats.funnel.dataSource}</div>
              </div>

              {/* 24시간 분포 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h4 className="text-sm font-bold text-white mb-3">24시간 CTR 분포</h4>
                <div className="grid grid-cols-12 gap-0.5 h-24">
                  {stats.hourly.map((h) => {
                    const maxCtr = Math.max(...stats.hourly.map((x) => x.ctr), 0.01);
                    const height = (h.ctr / maxCtr) * 100;
                    return (
                      <div key={h.hour} className="flex flex-col justify-end" title={`${h.hour}시 — CTR ${(h.ctr * 100).toFixed(1)}% / ${h.impressions}건`}>
                        <div className="bg-gradient-to-t from-violet-500 to-fuchsia-500 rounded-t" style={{ height: `${Math.max(height, 2)}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-12 gap-0.5 text-[9px] text-white/40 text-center mt-1">
                  {stats.hourly.filter((_, idx) => idx % 3 === 0).map((h) => (
                    <div key={h.hour} className="col-span-3">{h.hour}시</div>
                  ))}
                </div>
                <div className="text-[10px] text-white/30 italic mt-2">Data source — cdp_inapp_impressions KST 시간대별 집계</div>
              </div>

              {/* 디바이스 */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <h4 className="text-sm font-bold text-white mb-3">디바이스 분포</h4>
                <div className="grid grid-cols-2 gap-3">
                  {stats.device.map((d) => (
                    <div key={d.device} className="bg-violet-900/50 rounded p-3">
                      <div className="text-xs text-white/50">{d.device === 'mobile' ? '모바일' : 'PC'}</div>
                      <div className="text-lg font-bold text-white">{d.impressions.toLocaleString()}</div>
                      <div className="text-xs text-emerald-300">CTR {(d.ctr * 100).toFixed(2)}%</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-white/30 italic mt-2">Data source — 추정 분포 (D215+ 첫 단계 — 정확한 user_agent 매핑은 추후 강화)</div>
              </div>
            </>
          )}

          {/* AI 영향 요인 */}
          {!loading && explain && (
            <div className="bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-400/30 rounded-xl p-5">
              <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-300" />
                AI 영향 요인 분석
              </h4>
              <div className="text-xs text-violet-100 mb-3 italic">{explain.topInsight}</div>
              <div className="space-y-2">
                {explain.factors.map((f, idx) => (
                  <div key={idx} className="bg-violet-900/50 rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white">{f.factor}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        f.direction === 'positive' ? 'bg-emerald-500/20 text-emerald-300' :
                        f.direction === 'negative' ? 'bg-rose-500/20 text-rose-300' :
                        'bg-white/10 text-white/50'
                      }`}>
                        {f.direction === 'positive' ? '긍정' : f.direction === 'negative' ? '개선 필요' : '중립'}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/70 mb-1">{f.description}</div>
                    <div className="h-1.5 bg-violet-900/40 rounded overflow-hidden mb-1">
                      <div
                        className={`h-full transition-all ${
                          f.direction === 'positive' ? 'bg-emerald-500' :
                          f.direction === 'negative' ? 'bg-rose-500' : 'bg-white/30'
                        }`}
                        style={{ width: `${f.impact * 100}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-white/30 italic">Data source — {f.dataSource}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
