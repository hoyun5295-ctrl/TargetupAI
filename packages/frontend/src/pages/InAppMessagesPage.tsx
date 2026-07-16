import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  Activity, AlertCircle, AlertTriangle, AlignLeft, ArrowLeft, BarChart3, ChevronDown, ChevronUp,
  Clock, Copy, Crown, Download, Edit2, Eye, Globe, GripVertical, ImageIcon, Layers, Lightbulb, ListChecks, Loader2, Minus, Moon, MousePointer,
  MousePointerClick, MoveVertical, Plus, RefreshCw, Repeat, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Star,
  Tag, Target, Ticket, Timer, Trash2, TrendingDown, TrendingUp, Type, Upload, UserPlus, Users, Wand2, X,
} from 'lucide-react';
// ★ P2-1 (2026-07-12) 블록 드래그앤드롭 — EmailVisualEditor SortableBlockRow 패턴 이식 (의존성 기존재, 라이브러리 추가 0)
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
// ★ 2026-07-06 식별 고객 목록 CSV 다운로드 — 공용 CT (BOM + 셀 이스케이프)
import { downloadCsv, safeCsvFilename } from '../utils/csv-download';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import { InAppMessagePreview, AppInAppPreview } from '../components/InAppMessagePreview';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
import TargetExtractModal from '../components/TargetExtractModal';
import {
  THEME_OPTIONS, CARD_STYLE_OPTIONS, SIGNATURE_THEME_OPTIONS, INAPP_TREATMENTS, INAPP_TREATMENT_OPTIONS,
  INAPP_FONT_CATALOG, type CardStyle,
} from '../components/inapp/blockTheme';
// ★ 2026-07-14 디자인 3.0 — 골든 템플릿 12종 (형태×카드×테마×블록 완성형 — 혜택 placeholder 준수)
// ★ 2026-07-14 Harold 지시 — 옛 골든 12종 노출 제거(정예 10종만). 타입만 유지(정예 적용 함수 공용).
import { type GoldenInAppTemplate } from '../components/inapp/goldenTemplates';
import { Icon as BlockIcon } from '../components/inapp/BlockPreview';
import { DateTimeField } from '../components/DateTimeField';
import { takeEventDraft, EVENT_INAPP_DRAFT_KEY } from '../components/EventCampaignModal';
import ImageToCopyButton from '../components/ImageToCopyButton';

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
type Animation = 'fade' | 'slide' | 'bounce' | 'pulse' | 'spring' | 'celebrate';
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
  audience_filter?: Record<string, any> | null;
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
  // ★ D230+ 블록 + 테마
  content_blocks?: any[] | null;
  theme?: string | null;
  accent_color?: string | null;
  // ★ 2026-07-07(2) 형태 축 — classic/bubble/ticket/poster
  card_style?: string | null;
  // ★ 2026-07-14 디자인 3.0 — 메시지 단위 디자인 (font_display/treatment/motion/backdrop. 미설정 = 현행 렌더)
  design?: Record<string, any> | null;
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

// ★ 2026-07-06 식별 고객 열람 목록 + 익명 합산 (GET /api/cdp/inapp/viewers/:id — 절충안)
interface InAppViewersData {
  viewers: Array<{
    customerId: string;
    name: string | null;
    phone: string | null;
    impressions: number;
    clicks: number;
    lastSeenAt: string | null;
    purchaseCount: number;
    purchaseAmount: number;
  }>;
  identifiedTotal: number;
  anonymous: { visitors: number; impressions: number; clicks: number };
}

// ★ 2026-07-06 인앱 표시 가능성 (GET /api/cdp/inapp/display-eligibility) — 지원 매트릭스는 백엔드 CT 단일 정의
interface DisplayEligibility {
  platforms: Array<{ provider: string; label: string; support: 'auto' | 'manual' | 'unsupported' }>;
  webSdkLastSeenAt: string | null;
  webSdkDetected: boolean;
  canCreateWeb: boolean;
  warnWeb: boolean;
  blockReasonWeb: string | null;
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
//   ★ 2026-07-16 범용 보장 계약 — 앱: 실제 앱 렌더는 중앙 모달/바텀 시트 2형뿐 (그 외 값도 앱이 시트로 그림).
//   편집기가 6형을 약속하고 앱이 2형만 그리던 거짓 선택지 제거 — 확실히 렌더되는 것만 노출.
const CHANNEL_TEMPLATES: Record<'web' | 'app', Template[]> = {
  web: ['center_modal', 'slide_in', 'toast', 'floating_button'],
  app: ['center_modal', 'bottom_banner'],
};

// 앱 채널 표시 형태 라벨 — 실렌더 기준 (bottom_banner 값 = 앱에서 바텀 시트로 렌더)
const APP_TEMPLATE_LABELS: Partial<Record<Template, string>> = {
  center_modal: '중앙 모달',
  bottom_banner: '바텀 시트',
};

// 빈도 한글 라벨 (목록 카드·편집기 공용)
const FREQ_LABELS: Record<string, string> = {
  once_per_session: '세션당 1회',
  once_per_day: '하루 1회',
  always: '매번 표시',
};

/** ★ 2026-07-16 범용 보장 계약 — blocks → flat 승계 (백엔드 composeFlatFromBlocks 미러, 앱 채널 편집 진입용).
 *  옛 블록 메시지의 이미지·버튼·배지를 flat 폼으로 비파괴 승계한다 (빈 곳만 채움). */
function composeFlatFromBlocksFE(blocks: any[]): { title: string | null; body: string | null; imageUrl: string | null; buttons: InAppButton[]; badgeText: string | null } {
  const list = Array.isArray(blocks) ? blocks.filter((b: any) => b && typeof b === 'object') : [];
  const text = (t: any) => String(t ?? '').trim();
  const media = list.find((b: any) => b.type === 'media' && text(b.url) && (b.variant === 'image' || !b.variant));
  const headline = list.find((b: any) => b.type === 'headline');
  const bodyBlock = list.find((b: any) => b.type === 'body');
  const eyebrow = list.find((b: any) => b.type === 'eyebrow');
  const buttons: InAppButton[] = [];
  for (const b of list) {
    if (b.type !== 'cta_group' || !Array.isArray(b.buttons)) continue;
    for (const btn of b.buttons) {
      if (buttons.length >= 3) break;
      if (!btn || typeof btn !== 'object' || !text(btn.label)) continue;
      buttons.push({
        id: String(btn.id || `btn_${buttons.length}`),
        label: String(btn.label),
        action_url: btn.action_url ?? btn.actionUrl ?? null,
        style: ['primary', 'secondary', 'tertiary'].includes(String(btn.style)) ? btn.style : (buttons.length === 0 ? 'primary' : 'secondary'),
        background_color: String(btn.background_color || '#4f46e5'),
        text_color: String(btn.text_color || '#ffffff'),
      });
    }
    if (buttons.length >= 3) break;
  }
  const headlineText = headline ? text(headline.text) : '';
  const bodyText = bodyBlock ? text(bodyBlock.text) : '';
  return {
    title: headlineText || null,
    body: bodyText || headlineText || null,
    imageUrl: media ? String(media.url) : null,
    buttons,
    badgeText: eyebrow ? text(eyebrow.text) || null : null,
  };
}

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
  card_style: 'classic',
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
  // ★ 2026-06-28 진입 화면 재설계 — 채널 무관 최근 인앱 + 빠른 시작 채널 선택 모달 + 폰 미리보기 모달
  const [recentMessages, setRecentMessages] = useState<MessageRow[]>([]);
  const [scenarioPick, setScenarioPick] = useState<QuickStartScenario | null>(null);
  const [previewMsg, setPreviewMsg] = useState<MessageRow | null>(null);
  // ★ 2026-07-06 인앱 표시 가능성 — 연동 플랫폼별 지원 + SDK 신호. 표시할 곳 없으면 생성 차단(크레딧 낭비 방지).
  const [eligibility, setEligibility] = useState<DisplayEligibility | null>(null);
  const [showDisplayBlock, setShowDisplayBlock] = useState(false);

  // AI 생성 진행 상태
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgressStep, setAiProgressStep] = useState<number>(-1);
  const [aiObjective, setAiObjective] = useState('');

  // ★ 2026-07-07(4) 행사 캠페인 — EventCampaignModal이 생성해둔 인앱 초안 자동 적용 (30분 TTL, 1회 소비)
  useEffect(() => {
    const d = takeEventDraft<{ pkg?: any }>(EVENT_INAPP_DRAFT_KEY);
    const msg = d?.pkg?.message;
    if (!msg) return;
    setChannel('web');
    setEditing({
      title: msg.title,
      body: msg.body,
      template: msg.template,
      image_url: msg.image_url,
      badge_text: msg.badge_text,
      buttons: msg.buttons || [],
      background_color: msg.background_color,
      text_color: msg.text_color,
      trigger_event: msg.trigger_conditions?.event || 'page_load',
      trigger_conditions: msg.trigger_conditions,
      segment_conditions: msg.segment_conditions,
      personalization_vars: msg.personalization_vars,
      display_frequency: msg.display_frequency,
      auto_dismiss_seconds: msg.auto_dismiss_seconds,
      max_displays_per_user: msg.max_displays_per_user,
      send_start_hour: msg.send_start_hour,
      send_end_hour: msg.send_end_hour,
      allowed_weekdays: msg.allowed_weekdays,
      animation: msg.animation,
      content_blocks: msg.content_blocks || [],
      theme: msg.theme || 'auto',
      accent_color: msg.accent_color || null,
      card_style: msg.card_style || 'classic',
      design: msg.design ?? null,
      status: 'active',
      channel: 'web',
    });
    toast.success('행사 캠페인 인앱 초안을 불러왔습니다 — 이미지만 올리고 다듬어주세요.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // ★ 2026-07-06 식별 고객 열람 목록 + 익명 합산 (절충안)
  const [drillViewers, setDrillViewers] = useState<InAppViewersData | null>(null);
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

  // ★ 2026-07-06 표시 가능성 조회 — 진입 즉시 1회. 조회 실패는 조용히(서버 게이트가 최종 방어).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/cdp/inapp/display-eligibility', { headers: authHeaders() });
        const data = await res.json();
        if (alive && data.success) setEligibility(data.eligibility);
      } catch { /* noop */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 웹 인앱 생성 차단 여부 — 판정 로드 전(null)엔 차단하지 않음(서버 게이트 이중 방어)
  const webBlocked = !!eligibility && !eligibility.canCreateWeb;

  // 진입 화면용 — 채널 무관 최근 인앱 목록 (GET /inapp = channel 없으면 전체). 데이터 적응(없으면 섹션 숨김).
  useEffect(() => {
    if (channel) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/cdp/inapp', { headers: authHeaders() });
        const data = await res.json();
        if (alive && data.success) setRecentMessages((data.messages || []).slice(0, 6));
      } catch { /* 진입 화면 최근 목록 실패는 조용히 무시 */ }
    })();
    return () => { alive = false; };
  }, [channel]);

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

  const handleAIGenerate = async (objective: string, templateHint?: QuickStartScenario, channelOverride?: 'web' | 'app') => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    // ★ 2026-07-06 표시 가능성 가드 — 웹에 표시할 곳이 없으면 AI 생성(크레딧) 진입 자체를 차단
    if ((channelOverride || channel || 'web') === 'web' && webBlocked) { setShowDisplayBlock(true); return; }
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
        if (data.code === 'INAPP_DISPLAY_UNAVAILABLE') { setAiGenerating(false); setShowDisplayBlock(true); return; }
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
        // ★ D230+ 블록 + 테마 + 형태
        content_blocks: pkg.message.content_blocks || [],
        theme: pkg.message.theme || 'auto',
        accent_color: pkg.message.accent_color || null,
        card_style: pkg.message.card_style || 'classic',
        // ★ 2026-07-14 디자인 3.0 — 결정적 디자인 추천 (모션 2.0 + 시나리오 구도)
        design: pkg.message.design ?? null,
        status: 'active',
        channel: channelOverride || channel || 'web',
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
    const blocks = Array.isArray(editing?.content_blocks) ? editing!.content_blocks! : [];
    const hasBlocks = blocks.length > 0;
    const blockText = (type: string) => {
      const b = blocks.find((x: any) => x?.type === type);
      return b ? String(b.text || '').trim() : '';
    };
    // 블록 메시지는 블록이 제목/본문의 기준 (DB title/body = headline/body 블록과 동일 텍스트 — 접근성·폴백)
    const effectiveTitle = hasBlocks ? (blockText('headline') || (editing?.title?.trim() || '')) : (editing?.title?.trim() || '');
    const effectiveBody = hasBlocks ? (blockText('body') || blockText('headline') || (editing?.body?.trim() || '')) : (editing?.body?.trim() || '');
    if (!effectiveTitle) {
      showToast(hasBlocks ? '헤드라인 블록 또는 제목을 입력해주세요.' : '제목은 필수입니다.', { type: 'warning' });
      return;
    }
    if (!effectiveBody) {
      showToast(hasBlocks ? '본문 블록 또는 본문을 입력해주세요.' : '본문은 필수입니다.', { type: 'warning' });
      return;
    }
    // 혜택 placeholder 검증 (본문 + 블록 — AI 임의 혜택 영구 룰)
    const hasPh = (s: string) => s.includes('[혜택 안내') || s.includes('[직접 작성') || s.includes('직접 작성해주세요');
    const benefitBad = blocks.some((b: any) => b?.type === 'benefit' && (!String(b.text || '').trim() || hasPh(String(b.text || ''))));
    const textBad = ['headline', 'body', 'eyebrow', 'footer'].some((tp) => hasPh(blockText(tp)));
    if (hasPh(editing?.body || '') || benefitBad || textBad) {
      showToast('혜택 안내 placeholder를 회사 정책에 맞게 직접 작성 후 저장해주세요.', { type: 'warning' });
      return;
    }
    // ★ 2026-07-06 표시 가능성 가드 — 웹 메시지를 active로 저장(게시)할 때 표시할 곳 없으면 차단 (paused 저장은 허용)
    if ((editing?.channel === 'app' ? 'app' : 'web') === 'web' && (editing?.status ?? 'active') === 'active' && webBlocked) {
      setShowDisplayBlock(true);
      return;
    }
    try {
      const isUpdate = !!editing!.id;
      const url = isUpdate ? `/api/cdp/inapp/${editing!.id}` : '/api/cdp/inapp';
      const method = isUpdate ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          ...editing,
          title: effectiveTitle,
          body: effectiveBody,
          // 기존 컬럼 호환 (position = template)
          position: editing!.template || editing!.position,
          backgroundColor: editing!.background_color,
          textColor: editing!.text_color,
          triggerEvent: editing!.trigger_event,
          displayFrequency: editing!.display_frequency,
          // ★ 2026-07-16 범용 보장 계약 — 앱 채널 = flat이 진실(블록 저장 안 함).
          //   블록이 남아 저장되면 서버 블록→flat 합성이 폼 수정을 덮는다 (편집 진입 효과가 이미 비움 — 이중 안전망)
          ...(editing!.channel === 'app' ? { content_blocks: [] } : {}),
        }),
      });
      const data = await res.json();
      if (handle503(data)) return;
      if (data.success) {
        // 타겟 추출 표시 대상(audience_filter) persist — 저장으로 확정된 message id 사용 (신규/수정 공통)
        const savedId = editing!.id || data.message?.id;
        if (savedId && editing!.audience_filter !== undefined) {
          await fetch(`/api/cdp/inapp/${savedId}/audience-filter`, {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify({ filter: editing!.audience_filter || null }),
          }).catch(() => {});
        }
        showToast(isUpdate ? '메시지 수정 완료' : '메시지 생성 완료', { type: 'success' });
        setEditing(null);
        await loadAll();
      } else if (data.code === 'INAPP_DISPLAY_UNAVAILABLE') {
        setShowDisplayBlock(true);
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
    setDrillViewers(null);
    setDrillLoading(true);
    try {
      const [funnelRes, explainRes, viewersRes] = await Promise.all([
        fetch(`/api/cdp/inapp/funnel-stats/${m.id}`, { headers: authHeaders() }),
        fetch('/api/cdp/inapp/explain', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message_id: m.id }) }),
        // ★ 2026-07-06 식별 고객 열람 목록 + 익명 합산 (절충안)
        fetch(`/api/cdp/inapp/viewers/${m.id}`, { headers: authHeaders() }),
      ]);
      const funnelData = await funnelRes.json();
      const explainData = await explainRes.json();
      const viewersData = await viewersRes.json();
      if (funnelData.success) {
        setDrillStats({
          funnel: funnelData.funnel,
          hourly: funnelData.hourly,
          heatmap: funnelData.heatmap,
          device: funnelData.device,
        });
      }
      if (explainData.success) setDrillExplain(explainData.result);
      if (viewersData.success) setDrillViewers({ viewers: viewersData.viewers || [], identifiedTotal: viewersData.identifiedTotal || 0, anonymous: viewersData.anonymous || { visitors: 0, impressions: 0, clicks: 0 } });
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
        // 블록 메시지면 media 이미지 블록을 자동 생성/갱신 (미리보기에 바로 반영)
        setEditing((prev) => {
          if (!prev) return prev;
          const blocks = Array.isArray(prev.content_blocks) ? prev.content_blocks : [];
          if (blocks.length > 0) {
            const idx = blocks.findIndex((b: any) => b?.type === 'media');
            let nb: any[];
            if (idx >= 0) {
              nb = [...blocks];
              nb[idx] = { ...nb[idx], variant: 'image', url: data.url };
            } else {
              nb = [{ type: 'media', variant: 'image', url: data.url, aspect: '16:9' }, ...blocks];
            }
            return { ...prev, image_url: data.url, content_blocks: nb };
          }
          return { ...prev, image_url: data.url };
        });
        showToast('이미지 업로드 완료', { type: 'success' });
      } else {
        showToast(data.error || '이미지 업로드 실패', { type: 'error' });
      }
    } catch (e: any) {
      showToast(e?.message || '이미지 업로드 중 오류', { type: 'error' });
    }
  };

  // 블록 안 media 업로드용 — url 반환(상태 직접 변경 X)
  const uploadImageReturnUrl = async (file: File): Promise<string | null> => {
    if (!file) return null;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch('/api/cdp/inapp/upload-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) { showToast('이미지 업로드 완료', { type: 'success' }); return data.url; }
      showToast(data.error || '이미지 업로드 실패', { type: 'error' });
      return null;
    } catch (e: any) {
      showToast(e?.message || '이미지 업로드 중 오류', { type: 'error' });
      return null;
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
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
        <div className="bg-slate-900/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
            <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-semibold text-white">인앱 메시지</h1>
              </div>
              <p className="text-xs md:text-sm text-white/50 mt-0.5">시나리오를 고르면 AI가 제목·본문·트리거까지 자동 — 웹·앱 어디든</p>
            </div>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-7">
          {customerGate.isEmpty && <CustomerDataRequiredBanner />}

          {/* 1) 빠른 시작 (채널 무관) — 클릭 한 번 = 채널 선택 → AI 자동 생성 → 편집 (1흐름) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-fuchsia-300" />
              <h2 className="text-sm font-bold text-white">빠른 시작<span className="text-white/40 font-normal"> — 시나리오만 고르면 AI가 제목·본문·트리거까지</span></h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(Object.keys(SCENARIO_VISUAL) as QuickStartScenario[]).map((sc) => {
                const v = SCENARIO_VISUAL[sc];
                const Icon = v.icon;
                return (
                  <button
                    key={sc}
                    onClick={() => { if (customerGate.isEmpty) { setShowDataGate(true); return; } setScenarioPick(sc); }}
                    className="group text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition-all"
                  >
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${v.gradient} flex items-center justify-center mb-3 shadow-md`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-sm font-bold text-white">{v.label}</div>
                    <div className="text-[11px] text-white/50 mt-0.5 leading-tight">{v.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2) 직접 만들기 — 채널 컴팩트 2카드 + 미니 미리보기 썸네일 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-bold text-white">직접 만들기<span className="text-white/40 font-normal"> — 띄울 곳을 고르면 빈 편집기로</span></h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => { if (webBlocked) { setShowDisplayBlock(true); return; } setChannel('web'); }} className="group flex items-center gap-4 bg-gradient-to-br from-violet-500/12 to-fuchsia-500/12 border border-violet-400/25 hover:border-violet-300/55 rounded-2xl p-4 transition-all text-left">
                <div className="w-16 h-12 rounded-md bg-slate-800/80 border border-white/10 relative shrink-0 overflow-hidden">
                  <div className="h-2.5 bg-white/10 flex items-center gap-0.5 px-1.5"><span className="w-1 h-1 rounded-full bg-white/30" /><span className="w-1 h-1 rounded-full bg-white/30" /></div>
                  <div className="absolute inset-x-2.5 bottom-1.5 top-4 rounded bg-violet-400/30 border border-violet-300/40" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-violet-200" />웹 자사몰 팝업</div>
                  <div className="text-[11px] text-white/55 mt-0.5 leading-tight">모달 · 슬라이드 · 토스트 · 플로팅</div>
                  {webBlocked ? (
                    <div className="text-[10px] text-amber-300/90 mt-1">표시할 쇼핑몰 연동 필요 — 눌러서 안내 보기</div>
                  ) : eligibility?.warnWeb ? (
                    <div className="text-[10px] text-amber-300/80 mt-1">연동됨 — 쇼핑몰에 SDK 설치 후 표시</div>
                  ) : (
                    <div className="text-[10px] text-emerald-300/80 mt-1">즉시 사용 가능</div>
                  )}
                </div>
              </button>
              <button onClick={() => setChannel('app')} className="group flex items-center gap-4 bg-gradient-to-br from-sky-500/12 to-indigo-500/12 border border-sky-400/25 hover:border-sky-300/55 rounded-2xl p-4 transition-all text-left">
                <div className="w-9 h-12 rounded-lg bg-slate-800/80 border border-white/10 relative shrink-0 overflow-hidden mx-[14px]">
                  <div className="absolute inset-x-1 top-1.5 h-3.5 rounded-sm bg-sky-400/30 border border-sky-300/40" />
                  <div className="absolute inset-x-1.5 bottom-1 h-1 rounded-full bg-white/15" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 text-sky-200" />모바일 앱 인앱</div>
                  <div className="text-[11px] text-white/55 mt-0.5 leading-tight">모달 · 전면 · 배너 · 토스트</div>
                  <div className="text-[10px] text-amber-300/80 mt-1">웹뷰 앱 지원 (네이티브는 추후)</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3) 최근 인앱 메시지 — 데이터 있을 때만 (없으면 섹션 숨김) */}
          {recentMessages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-cyan-300" />
                <h2 className="text-sm font-bold text-white">최근 인앱 메시지<span className="text-white/40 font-normal"> — 눌러서 미리보기·편집</span></h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentMessages.map((m) => (
                  <button key={m.id} onClick={() => setPreviewMsg(m)} className="text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 rounded-xl p-3 transition-all">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${m.channel === 'app' ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/20 text-violet-300'}`}>{m.channel === 'app' ? '앱' : '웹'}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${m.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'}`}>{m.status === 'active' ? '활성' : m.status === 'paused' ? '일시중지' : m.status}</span>
                    </div>
                    <div className="text-sm font-bold text-white truncate">{m.title || '(제목 없음)'}</div>
                    <div className="text-[11px] text-white/50 mt-0.5 line-clamp-2 leading-tight">{m.body}</div>
                    {m.stats && (
                      <div className="mt-2 flex gap-2 text-[10px] text-white/45 border-t border-white/5 pt-1.5">
                        <span>표시 {m.stats.impressions.toLocaleString()}</span>
                        <span>클릭 {m.stats.clicks.toLocaleString()}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-white/30 italic mt-2">Data source — cdp_inapp_messages (회사 격리)</div>
            </div>
          )}
        </div>

        {/* 채널 선택 모달 — 빠른 시작 클릭 시 웹/앱 선택 → AI 자동 생성 */}
        {scenarioPick && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-bold text-white">어디에 띄울까요?</h3>
                <button onClick={() => setScenarioPick(null)} className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10" aria-label="닫기"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-white/50 mb-4">{SCENARIO_VISUAL[scenarioPick].label} — 채널을 고르면 AI가 바로 만들어요</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { if (webBlocked) { setScenarioPick(null); setShowDisplayBlock(true); return; } const sc = scenarioPick; setScenarioPick(null); setChannel('web'); if (sc) handleAIGenerate('', sc, 'web'); }}
                  className="flex flex-col items-center gap-2 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 rounded-xl p-4 transition-colors"
                >
                  <Globe className="w-6 h-6 text-violet-200" />
                  <span className="text-sm font-bold text-white">웹 자사몰</span>
                  <span className="text-[10px] text-white/50">{webBlocked ? '쇼핑몰 연동 필요' : '팝업·슬라이드·토스트'}</span>
                </button>
                <button
                  onClick={() => { const sc = scenarioPick; setScenarioPick(null); setChannel('app'); if (sc) handleAIGenerate('', sc, 'app'); }}
                  className="flex flex-col items-center gap-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 rounded-xl p-4 transition-colors"
                >
                  <Smartphone className="w-6 h-6 text-sky-200" />
                  <span className="text-sm font-bold text-white">모바일 앱</span>
                  <span className="text-[10px] text-white/50">중앙 모달·바텀 시트</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 최근 인앱 폰 미리보기 모달 */}
        {previewMsg && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
            <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${previewMsg.channel === 'app' ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/20 text-violet-300'}`}>{previewMsg.channel === 'app' ? '앱' : '웹'}</span>
                  <h3 className="text-sm font-bold text-white truncate">{previewMsg.title || '(제목 없음)'}</h3>
                </div>
                <button onClick={() => setPreviewMsg(null)} className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10 shrink-0" aria-label="닫기"><X className="w-4 h-4" /></button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                {previewMsg.channel === 'app' ? (() => {
                  // ★ 2026-07-16 앱 메시지 = 앱 실렌더 미러 미리보기 (옛 블록 저장분은 flat 승계해 표시)
                  const flat = composeFlatFromBlocksFE(previewMsg.content_blocks || []);
                  return (
                    <AppInAppPreview
                      template={previewMsg.template === 'center_modal' ? 'center_modal' : 'bottom_banner'}
                      title={previewMsg.title || flat.title || ''}
                      body={previewMsg.body || flat.body || ''}
                      imageUrl={previewMsg.image_url || flat.imageUrl}
                      badge={previewMsg.badge_text || flat.badgeText}
                      buttons={(previewMsg.buttons && previewMsg.buttons.length > 0 ? previewMsg.buttons : flat.buttons) || []}
                      backgroundColor={previewMsg.background_color || '#4f46e5'}
                      textColor={previewMsg.text_color || '#ffffff'}
                      design={previewMsg.design}
                    />
                  );
                })() : (
                <InAppMessagePreview
                  template={(previewMsg.template || previewMsg.position || 'center_modal') as string}
                  title={previewMsg.title}
                  body={previewMsg.body}
                  imageUrl={previewMsg.image_url}
                  badge={previewMsg.badge_text}
                  buttons={previewMsg.buttons || []}
                  backgroundColor={previewMsg.background_color || '#4f46e5'}
                  textColor={previewMsg.text_color || '#ffffff'}
                  blocks={previewMsg.content_blocks && previewMsg.content_blocks.length ? previewMsg.content_blocks : undefined}
                  theme={previewMsg.theme}
                  accentColor={previewMsg.accent_color}
                  cardStyle={previewMsg.card_style}
                  design={previewMsg.design}
                />
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { const msg = previewMsg; const ch: 'web' | 'app' = msg.channel === 'app' ? 'app' : 'web'; setPreviewMsg(null); setChannel(ch); setEditing(msg); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  <Edit2 className="w-4 h-4" />수정
                </button>
                <button onClick={() => setPreviewMsg(null)} className="px-4 py-2 rounded-lg border border-white/15 text-sm text-white/70 hover:bg-white/5">닫기</button>
              </div>
            </div>
          </div>
        )}

        {/* 고객 데이터 없음 — 생성 차단 안내 (진입 화면 공용) */}
        <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
        {/* 표시 채널 없음 — 생성 차단 안내 */}
        {showDisplayBlock && (
          <InAppDisplayBlockModal
            reason={eligibility?.blockReasonWeb || null}
            onGoSettings={() => { setShowDisplayBlock(false); navigate('/cdp-settings'); }}
            onClose={() => setShowDisplayBlock(false)}
          />
        )}
      </div>
    );
  }

  return (
    // ★ D222+ Phase 3 (2026-05-27): 다크 → 보라 그라데이션 톤 다운
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* ▼ 1: 상단 헤더 (sticky + BETA badge) — D222+ Phase 3 보라 톤 다운 */}
      <div className="bg-slate-900/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="뒤로가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">인앱 메시지</h1>
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

        {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4" />}

        {/* ★ 2026-07-06 인앱 표시 채널 상태 — 표시 불가/미설치를 만들기 전에 인지시켜 크레딧 낭비 차단 */}
        {channel === 'web' && eligibility && (
          webBlocked ? (
            <div className="bg-rose-500/10 border border-rose-400/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0" />
              <div className="flex-1 text-xs text-rose-200 leading-relaxed">{eligibility.blockReasonWeb}</div>
              <button onClick={() => navigate('/cdp-settings')} className="shrink-0 px-3 py-2 bg-rose-500/30 hover:bg-rose-500/50 border border-rose-400/30 rounded-lg text-xs font-semibold text-white">쇼핑몰 연동하러 가기</button>
            </div>
          ) : eligibility.warnWeb ? (
            <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0" />
              <div className="flex-1 text-xs text-amber-200 leading-relaxed">
                {eligibility.platforms.filter((p) => p.support !== 'unsupported').map((p) => p.label).join(' · ')} 연동됨 — 아직 쇼핑몰에서 SDK 신호가 감지되지 않았습니다. 쇼핑몰에 SDK 스크립트를 설치해야 만든 메시지가 실제로 표시됩니다.
                {eligibility.platforms.some((p) => p.support === 'unsupported') && ' (네이버 스마트스토어는 인앱 표시 미지원 — 데이터 연동만)'}
              </div>
              <button onClick={() => navigate('/cdp-settings')} className="shrink-0 px-3 py-2 bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/30 rounded-lg text-xs font-semibold text-white">설치 가이드 보기</button>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-400/20 rounded-xl px-4 py-2.5 flex items-center gap-2 text-[11px] text-emerald-200/90 flex-wrap">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>SDK 신호 감지됨{eligibility.webSdkLastSeenAt ? ` — 최근 ${new Date(eligibility.webSdkLastSeenAt).toLocaleString('ko-KR')}` : ''}</span>
              {eligibility.platforms.length > 0 && <span className="text-white/40">· 연동: {eligibility.platforms.map((p) => p.label).join(', ')}</span>}
              {eligibility.platforms.some((p) => p.support === 'unsupported') && <span className="text-amber-300/70">· 네이버 스마트스토어는 인앱 표시 미지원(데이터 연동만)</span>}
            </div>
          )
        )}
        {/* ▼ HERO: 메시지 만들기 (자연어 입력 + 빠른 시작) */}
        <div className="bg-gradient-to-br from-violet-500/12 via-fuchsia-500/8 to-indigo-500/12 border border-violet-400/25 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-fuchsia-300" />
            <h3 className="text-sm font-bold text-white">메시지 만들기<span className="text-white/40 font-normal"> — 한 줄이면 AI가 제목·본문·트리거·세그먼트까지</span></h3>
          </div>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input
              type="text"
              value={aiObjective}
              onChange={(e) => setAiObjective(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAIGenerate(aiObjective); }}
              placeholder="예: 장바구니 24시간 후 회복 메시지 / 신규 가입자 환영 인사"
              className="flex-1 min-w-[240px] px-4 py-2.5 bg-slate-900/60 border border-fuchsia-400/30 rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-fuchsia-400/60"
              disabled={aiGenerating}
            />
            <ImageToCopyButton
              label="이미지"
              onExtracted={(t) => setAiObjective((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))}
              disabled={aiGenerating}
              className="h-11 px-3 inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/30 bg-slate-900/60 text-fuchsia-200 text-sm font-medium hover:bg-fuchsia-500/15 hover:border-fuchsia-400/50 disabled:opacity-40 transition-colors"
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
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-5">
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
                        : 'bg-slate-900/60 border-white/5 opacity-50'
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

        {/* ▼ AI 개선 — 진단 + 1-click 통합 (한 카드) */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center flex-shrink-0">
              <Lightbulb className="w-5 h-5 text-violet-200" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-sm font-bold text-white">AI 개선</h3>
              <p className="text-xs text-white/60 mt-0.5">{topInsight || (dataShortage.length > 0 ? dataShortage[0] : '성과를 분석해 개선점을 제안합니다. 아래 버튼으로 바로 적용하세요.')}</p>
            </div>
            <button
              onClick={handleDiagnose}
              disabled={diagnosing || messages.length === 0}
              className="text-xs bg-violet-500/25 hover:bg-violet-500/40 disabled:opacity-40 disabled:cursor-not-allowed text-violet-100 px-3.5 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors"
            >
              {diagnosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {diagnosing ? '진단 중...' : 'AI 진단'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
            {[
              { type: 'ai_refine' as const, icon: Wand2, title: '본문 다듬기', desc: '감성·실용·캐주얼 3안', iconBg: 'from-violet-500/40 to-purple-500/40', iconColor: 'text-violet-200' },
              { type: 'time_optimize' as const, icon: Clock, title: '시간대 최적화', desc: 'best CTR 시간 적용', iconBg: 'from-emerald-500/40 to-teal-500/40', iconColor: 'text-emerald-200' },
              { type: 'segment_refine' as const, icon: Target, title: '세그먼트 정밀화', desc: 'LTV 상위 + 활성', iconBg: 'from-amber-500/40 to-orange-500/40', iconColor: 'text-amber-200' },
            ].map((action) => (
              <button
                key={action.type}
                onClick={() => handleQuickAction(action.type)}
                disabled={messages.length === 0}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${action.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <action.icon className={`w-4 h-4 ${action.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">{action.title}</div>
                    <div className="text-[10px] text-white/50 truncate">{action.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ▼ 영역 10: 메시지 목록 (filter + sort + 카드) */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <h3 className="text-sm font-bold text-white">메시지 목록 ({filteredMessages.length}건)</h3>
            <div className="ml-auto flex gap-2 flex-wrap">
              <button onClick={() => setShowDetails(true)} className="text-xs text-white/70 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors">
                <BarChart3 className="w-3.5 h-3.5" /> 자세히 분석
              </button>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as Status | 'all')}
                className="text-xs bg-slate-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-white"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="paused">일시 중지</option>
                <option value="archived">보관함</option>
              </select>
              <select
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value as Template | 'all')}
                className="text-xs bg-slate-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-white"
              >
                <option value="all">전체 템플릿</option>
                {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="text-xs bg-slate-900/60 border border-white/10 rounded-lg px-2 py-1.5 text-white"
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
                          <span>빈도: {FREQ_LABELS[m.display_frequency || ''] || m.display_frequency}</span>
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
          uploadImage={uploadImageReturnUrl}
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
          viewers={drillViewers}
          messageTitle={messages.find((m) => m.id === drillMessageId)?.title || '인앱'}
          onClose={() => { setDrillMessageId(null); setDrillStats(null); setDrillExplain(null); setDrillViewers(null); }}
        />
      )}

      {/* ConfirmModal */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />
      {/* 표시 채널 없음 — 생성 차단 안내 */}
      {showDisplayBlock && (
        <InAppDisplayBlockModal
          reason={eligibility?.blockReasonWeb || null}
          onGoSettings={() => { setShowDisplayBlock(false); navigate('/cdp-settings'); }}
          onClose={() => setShowDisplayBlock(false)}
        />
      )}

      {/* 자세히 분석 모달 (Top CTR 메시지) */}
      {showDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-900/90 backdrop-blur-sm border-b border-white/10 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-300" /> 자세히 분석 — Top CTR 메시지</h3>
              <button onClick={() => setShowDetails(false)} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              {topMessages.length === 0 ? (
                <div className="text-xs text-white/40 py-8 text-center">데이터 누적 부족 — impression 10건 이상 쌓이면 표시됩니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {topMessages.map((m) => (
                    <div key={m.messageId} className="flex items-center gap-3 text-xs bg-white/5 rounded px-3 py-2.5">
                      <span className="text-white/40 font-mono w-6">{m.rank}.</span>
                      <span className="flex-1 text-white/80 truncate">{m.title}</span>
                      <span className="text-emerald-300 font-bold">{(m.ctr * 100).toFixed(2)}%</span>
                      <span className="text-white/40">{m.impressions.toLocaleString()}건</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-white/30 italic mt-3">Data source — 회사 30일 누적 impression ≥ 10건 메시지</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 편집 모달 (10 영역)
// ════════════════════════════════════════════════════════════════════

/** 형태 4종 미니 썸네일 — 실제 카드 해부도를 축소한 시각 표본 (글자 버튼 금지 — 눈으로 고르게) */
function CardStyleThumb({ k, active }: { k: CardStyle; active: boolean }) {
  const line = (w: string, h = 3) => <div style={{ width: w, height: h, borderRadius: 2, background: 'rgba(255,255,255,0.35)' }} />;
  const accent = active ? '#c4b5fd' : 'rgba(255,255,255,0.5)';
  const face = 'rgba(255,255,255,0.12)';
  const edge = '1px solid rgba(255,255,255,0.16)';
  const common: CSSProperties = { position: 'relative', width: '100%', height: 52, borderRadius: 8, background: face, border: edge, padding: 7, display: 'flex', flexDirection: 'column', gap: 4 };
  if (k === 'bubble') {
    // ★ 2026-07-07(5) 골격 미러 — 아바타 발신자 행 + 답장 칩 2개 + 꼬리
    return (
      <div style={{ ...common, borderRadius: '12px 12px 12px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: accent, flexShrink: 0 }} />
          {line('35%')}
        </div>
        {line('70%')}
        <div style={{ marginTop: 'auto', display: 'flex', gap: 3 }}>
          <div style={{ width: '36%', height: 9, borderRadius: 99, background: accent }} />
          <div style={{ width: '28%', height: 9, borderRadius: 99, border: '1px solid rgba(255,255,255,0.4)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ position: 'absolute', bottom: -4, left: 10, width: 8, height: 8, background: 'rgba(148,143,184,0.35)', borderRight: edge, borderBottom: edge, transform: 'rotate(45deg)' }} />
      </div>
    );
  }
  if (k === 'ticket') {
    // ★ 2026-07-07(5) 골격 미러 — 2톤(본권/스터브) + 가장자리 다이컷 절취선
    return (
      <div style={{ ...common, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {line('38%')}
          {line('68%', 5)}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: 'rgba(2,6,23,0.85)', marginLeft: -4, flexShrink: 0 }} />
          <div style={{ flex: 1, borderTop: '2px dashed rgba(255,255,255,0.35)', margin: '0 5px' }} />
          <span style={{ width: 9, height: 9, borderRadius: 99, background: 'rgba(2,6,23,0.85)', marginRight: -4, flexShrink: 0 }} />
        </div>
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.09)', padding: 6, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '100%', height: 9, borderRadius: 4, background: accent }} />
        </div>
      </div>
    );
  }
  if (k === 'poster') {
    // ★ 2026-07-07(5) 골격 미러 — 풀블리드 히어로(카드 절반+) + 겹침 헤드라인
    return (
      <div style={{ ...common, padding: 0, overflow: 'hidden' }}>
        <div style={{ height: 34, background: `linear-gradient(135deg, ${accent}, rgba(255,255,255,0.15))`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, padding: 5 }}>
          <div style={{ width: '28%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.7)' }} />
          <div style={{ width: '64%', height: 6, borderRadius: 2, background: 'rgba(255,255,255,0.95)' }} />
        </div>
        <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {line('80%')}
        </div>
      </div>
    );
  }
  return (
    <div style={common}>
      <div style={{ width: 26, height: 6, borderRadius: 99, background: accent }} />
      {line('75%')}
      {line('55%')}
    </div>
  );
}

interface EditModalProps {
  editing: Partial<MessageRow>;
  setEditing: (m: Partial<MessageRow> | null) => void;
  availableVariables: AvailableVariable[];
  onSave: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onImageUpload: (file: File) => void;
  uploadImage: (file: File) => Promise<string | null>;
}

function EditModal({ editing, setEditing, availableVariables, onSave, fileInputRef, onImageUpload, uploadImage }: EditModalProps) {
  const [segmentCount, setSegmentCount] = useState<number | null>(null);
  const [segmentDesc, setSegmentDesc] = useState<string>('');
  const [extractOpen, setExtractOpen] = useState(false);
  // ★ 2026-07-07(2) 실고객 샘플 — 하드코딩 페르소나 영구 제거. 타겟 최상단 + 등급별 실고객을 백엔드에서 받아 치환.
  const [previewPeople, setPreviewPeople] = useState<Array<{ label: string; customer: Record<string, any>; is_sample?: boolean }>>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [brandAccent, setBrandAccent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'content' | 'design' | 'target'>('content');
  // ★ 2026-07-14 디자인 4.0 — 정예 템플릿(서버 design-core 컴파일 — FE 복제 없음. 실패 = 그룹 미노출 폴백)
  const [eliteTemplates, setEliteTemplates] = useState<Array<GoldenInAppTemplate & { difference?: string }>>([]);

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/design/golden-templates?channel=inapp', { headers: authHeaders() });
        const data = await res.json();
        if (data?.success && Array.isArray(data.templates)) setEliteTemplates(data.templates);
      } catch { /* 조회 실패 = 기존 골든 12종만 노출 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 실고객 샘플 로드 — 편집 진입 시 + 타겟 조건 변경 시 (타겟 최상단 실고객 우선)
  useEffect(() => {
    const conds = editing.segment_conditions || {};
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/cdp/inapp/preview-customers', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ segment_conditions: conds }),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.customers) && data.customers.length > 0) {
          setPreviewPeople(data.customers.map((c: any) => ({ label: String(c.label || ''), customer: c.customer || {}, is_sample: !!c.is_sample })));
          setPreviewIdx(0);
          setBrandAccent(typeof data.brand_accent === 'string' ? data.brand_accent : null);
        }
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.segment_conditions]);

  // 신규 메시지 기본 강조색 = 회사 브랜드 킷 색 (brand_kit 설정 회사만 — 미설정은 기존 기본값 유지)
  useEffect(() => {
    if (brandAccent && !editing.id && !editing.accent_color) {
      setEditing({ ...editing, accent_color: brandAccent });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandAccent]);

  // web 채널은 4종(모달/슬라이드/토스트/플로팅)만 — 이전 배너 등 4종 밖 형태로 저장된 메시지를 열면 모달로 자동 정규화
  useEffect(() => {
    const WEB_OK = ['center_modal', 'slide_in', 'toast', 'floating_button'];
    if (editing.channel !== 'app' && editing.template && !WEB_OK.includes(editing.template)) {
      setEditing({ ...editing, template: 'center_modal' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.id]);

  // ★ 2026-07-16 범용 보장 계약 — 앱 채널 편집 = flat(보장 요소: 제목·본문·이미지·버튼·배지)만.
  //   ① 블록에만 있던 이미지·버튼·제목을 flat으로 비파괴 승계(빈 곳만 채움) 후 블록을 비운다
  //      (앱은 블록을 렌더하지 않음 — 블록 유지 시 flat 폼 수정이 서버 블록 합성에 덮여 "편집기 ≠ 앱" 재발).
  //   ② 형태 = 실렌더 2형(중앙 모달/바텀 시트)으로 정규화 (그 외 값은 앱이 시트로 그림).
  //   ③ 트리거 = page_load 고정 (앱은 실행 시에만 조회 — 다른 트리거로 저장되면 영원히 미표시).
  useEffect(() => {
    if (editing.channel !== 'app') return;
    const APP_OK = CHANNEL_TEMPLATES.app as string[];
    const appBlocks = Array.isArray(editing.content_blocks) ? editing.content_blocks : [];
    const badTemplate = !!editing.template && !APP_OK.includes(editing.template);
    const badTrigger = !!editing.trigger_event && editing.trigger_event !== 'page_load';
    if (appBlocks.length === 0 && !badTemplate && !badTrigger) return;
    const flat = composeFlatFromBlocksFE(appBlocks);
    setEditing({
      ...editing,
      template: badTemplate ? 'bottom_banner' : editing.template,
      trigger_event: 'page_load',
      trigger_conditions: { event: 'page_load' },
      title: (editing.title || '').trim() ? editing.title : (flat.title || editing.title || ''),
      body: (editing.body || '').trim() ? editing.body : (flat.body || editing.body || ''),
      image_url: editing.image_url || flat.imageUrl,
      badge_text: editing.badge_text || flat.badgeText,
      buttons: editing.buttons && editing.buttons.length > 0 ? editing.buttons : flat.buttons,
      content_blocks: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.id, editing.channel]);

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

  // ★ 2026-07-14 디자인 3.0 — design jsonb 부분 갱신 (null/undefined 값 키는 제거. 전 키 제거 = null = 현행 렌더)
  const setDesign = (patch: Record<string, any>) => {
    const next: Record<string, any> = { ...(editing.design || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    setEditing({ ...editing, design: Object.keys(next).length > 0 ? next : null });
  };

  // ★ 2026-07-14 디자인 3.0 — 골든 템플릿 1클릭 적용 (형태·카드·테마·블록·디자인 교체. 트리거/타겟/시간대 무접촉)
  const [goldenConfirm, setGoldenConfirm] = useState<ConfirmState | null>(null);
  const applyGolden = (g: GoldenInAppTemplate) => {
    const chTemplates = (editing.channel === 'app' ? CHANNEL_TEMPLATES.app : CHANNEL_TEMPLATES.web) as string[];
    setEditing({
      ...editing,
      template: (chTemplates.includes(g.template) ? g.template : editing.template) as Template,
      card_style: g.card_style,
      theme: g.theme,
      design: Object.keys(g.design).length > 0 ? { ...g.design } : null,
      content_blocks: JSON.parse(JSON.stringify(g.content_blocks)),
      ...(g.badge_text ? { badge_text: g.badge_text } : {}),
    });
  };
  const pickGolden = (g: GoldenInAppTemplate) => {
    const blocksNow = Array.isArray(editing.content_blocks) ? editing.content_blocks : [];
    if (blocksNow.length > 0) {
      setGoldenConfirm({
        mode: 'warning',
        title: `골든 템플릿 적용 — ${g.label}`,
        description: '현재 편집 중인 블록 구성이 템플릿 블록으로 교체됩니다. 트리거·표시 대상·시간대 설정은 유지됩니다.',
        confirmLabel: '적용',
        onConfirm: () => applyGolden(g),
      });
    } else {
      applyGolden(g);
    }
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

  // 실고객 샘플 (로딩 전 = 빈 객체 → 변수는 기본값으로 치환)
  const samplePerson = previewPeople[previewIdx] || null;
  const sampleCustomer: Record<string, any> = samplePerson?.customer || {};
  const renderedTitle = replaceVars(editing.title || '', sampleCustomer);
  const renderedBody = replaceVars(editing.body || '', sampleCustomer);
  // ★ D230+ 블록
  const blocks = Array.isArray(editing.content_blocks) ? editing.content_blocks : [];
  const hasBlocks = blocks.length > 0;
  // ★ 2026-07-16 범용 보장 계약 — 앱 채널 = flat 보장 요소만 (블록·테마·정예 템플릿 = 웹 전용)
  const isApp = editing.channel === 'app';
  const blockHasPlaceholder = blocks.some((b: any) => b?.type === 'benefit' && (!String(b.text || '').trim() || String(b.text || '').includes('[혜택') || String(b.text || '').includes('[직접')));
  const hasPlaceholder = (editing.body || '').includes('[혜택') || (editing.body || '').includes('[직접') || blockHasPlaceholder;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,480px] gap-0">
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
              {!hasBlocks && (
                <input
                  type="text"
                  value={editing.title || ''}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="메시지 제목 (20자 안, 변수 X)"
                  className="w-full px-3 py-2 mb-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                  maxLength={100}
                />
              )}
              {hasBlocks ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-white/70 flex items-center gap-1.5"><Layers className="w-3 h-3" /> 블록 구성</span>
                    <button onClick={() => updateField('content_blocks', [])} className="text-[10px] text-white/40 hover:text-white/70">단순 폼으로</button>
                  </div>
                  <BlockComposer blocks={blocks} onChange={(b) => updateField('content_blocks', b)} uploadImage={uploadImage} />
                </div>
              ) : (
                <>
                  <textarea
                    value={editing.body || ''}
                    onChange={(e) => updateField('body', e.target.value)}
                    placeholder="짧고 강렬하게 한두 문장. 혜택 부분은 [혜택 안내 — 직접 작성해주세요] placeholder 사용"
                    className="w-full px-3 py-2 mb-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-y h-24 focus:outline-none focus:border-violet-400/50"
                    maxLength={300}
                  />
                  <input
                    type="text"
                    value={editing.badge_text || ''}
                    onChange={(e) => updateField('badge_text', e.target.value)}
                    placeholder="뱃지 (선택, 8자 안 — NEW · VIP · 오랜만이에요)"
                    className="w-full px-3 py-2 mb-2 bg-slate-900/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                    maxLength={20}
                  />
                  {!isApp && (
                    <button
                      onClick={() => { const c = convertToBlocks(editing); setEditing({ ...editing, ...c }); }}
                      className="w-full text-xs text-violet-100 bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 hover:from-violet-500/50 hover:to-fuchsia-500/50 border border-violet-400/30 rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> 블록 에디터로 전환 (모던 메시지 — 권장)
                    </button>
                  )}
                  {isApp && (
                    <div className="text-[10px] text-white/40 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                      앱 인앱은 위 보장 요소(제목·본문·이미지·버튼·배지)가 그대로 앱에 표시됩니다 — 미리보기와 실물이 1:1로 일치합니다.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ★ 2026-07-14 디자인 4.0 — 정예 템플릿 10종 (목적×스토리 구조 — 서버 컴파일. 블록 기반 = 웹 전용) */}
            {eliteTemplates.length > 0 && !isApp && (
              <div className={activeTab === 'design' ? 'mb-5' : 'hidden'}>
                <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-300" /> 정예 템플릿 — 목적으로 고르세요
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {eliteTemplates.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => pickGolden(g)}
                      className="rounded-xl border border-amber-400/25 bg-slate-900/60 hover:bg-white/5 hover:border-amber-400/60 p-2 text-left transition-colors"
                      title={g.difference || ''}
                    >
                      <span className="flex h-7 rounded-lg overflow-hidden border border-white/10">
                        {g.swatches.map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
                      </span>
                      <span className="block text-[11px] font-bold mt-1.5 text-white/85">{g.label}</span>
                      <span className="block text-[9px] text-white/45 mt-0.5">{g.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-white/40 mt-1.5">브랜드 학습(AI 메모리)의 색·고객센터가 자동 반영됩니다. 혜택 문구는 직접 작성해야 저장됩니다.</div>
              </div>
            )}

            {/* ★ 2026-07-14 Harold 지시 — 옛 골든 12종 노출 제거(정예 10종만 유지, 위 그리드) */}

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
                        : 'bg-slate-900/60 border-white/10 text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {isApp ? (APP_TEMPLATE_LABELS[tpl] || TEMPLATE_LABELS[tpl]) : TEMPLATE_LABELS[tpl]}
                  </button>
                ))}
              </div>
              {isApp && (
                <div className="text-[10px] text-white/40 mt-1.5">앱 실렌더 기준 2형 — 중앙 모달 / 바텀 시트(하단에서 올라오는 카드).</div>
              )}
            </div>

            {/* 탭 디자인: 형태(디자인) + 색상 + 강조색 (블록 모드) */}
            <div className={activeTab === 'design' && hasBlocks ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-fuchsia-300" /> 디자인 (형태 4종)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {CARD_STYLE_OPTIONS.map((cs) => {
                  const active = (editing.card_style || 'classic') === cs.key;
                  return (
                    <button
                      key={cs.key}
                      onClick={() => updateField('card_style', cs.key)}
                      className={`rounded-xl border p-2 text-left transition-colors ${active ? 'bg-violet-500/25 border-violet-400/60' : 'bg-slate-900/60 border-white/10 hover:bg-white/5'}`}
                    >
                      <CardStyleThumb k={cs.key} active={active} />
                      <span className={`block text-[11px] font-bold mt-1.5 ${active ? 'text-white' : 'text-white/80'}`}>{cs.label}</span>
                      <span className="block text-[9px] text-white/45 mt-0.5">{cs.hint}</span>
                    </button>
                  );
                })}
              </div>
              {['toast', 'floating_button', 'top_banner', 'bottom_banner'].includes(editing.template || '') && (
                <div className="text-[10px] text-white/40 -mt-2 mb-3">토스트·배너·플로팅 버튼은 자체 형태라 형태 선택이 적용되지 않습니다 (모달·슬라이드에서 적용).</div>
              )}
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-300" /> 색상
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => updateField('theme', t.key)}
                    className={`px-2 py-2 rounded-lg border text-left transition-colors ${(editing.theme || 'auto') === t.key ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/70 hover:bg-white/5'}`}
                  >
                    <span className="block text-xs font-bold">{t.label}</span>
                    <span className="block text-[9px] text-white/45 mt-0.5">{t.hint}</span>
                  </button>
                ))}
              </div>
              {/* ★ 2026-07-14 디자인 3.0 — 시그니처 테마 (서체·조판·모티프 내장 큐레이션. 1클릭 — 문안 무변) */}
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-300" /> 시그니처 테마 (아트디렉션 내장)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {SIGNATURE_THEME_OPTIONS.map((t) => {
                  const active = (editing.theme || 'auto') === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => updateField('theme', t.key)}
                      className={`rounded-xl border p-2 text-left transition-colors ${active ? 'bg-violet-500/25 border-violet-400/60' : 'bg-slate-900/60 border-white/10 hover:bg-white/5'}`}
                    >
                      <span className="flex h-5 rounded-md overflow-hidden border border-white/10">
                        {t.swatches.map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
                      </span>
                      <span className={`block text-[11px] font-bold mt-1.5 ${active ? 'text-white' : 'text-white/80'}`}>{t.label}</span>
                      <span className="block text-[9px] text-white/45 mt-0.5">{t.hint}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-white/60">강조색</label>
                <input
                  type="color"
                  value={editing.accent_color || brandAccent || '#6d5cf0'}
                  onChange={(e) => updateField('accent_color', e.target.value)}
                  className="h-9 w-16 bg-slate-900/60 border border-white/10 rounded cursor-pointer"
                />
                {brandAccent && (
                  <button
                    onClick={() => updateField('accent_color', brandAccent)}
                    className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg border border-white/10 bg-slate-900/60 text-white/70 hover:bg-white/5"
                    title="설정에 저장된 회사 브랜드 색으로 되돌리기"
                  >
                    <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: brandAccent }} />
                    브랜드 색
                  </button>
                )}
                <span className="text-[10px] text-white/40">{brandAccent ? '브랜드 킷에 저장된 회사 색이 기본 적용됩니다' : '면·구조는 테마가, 강조색만 회사 색'}</span>
              </div>

              {/* ★ 2026-07-14 디자인 3.0 — 구도·모션·서체·배경 (소비하는 형태 조합에서만 노출 — 죽은 컨트롤 금지) */}
              {(() => {
                const treatKey = `${editing.template}|${editing.card_style || 'classic'}`;
                const treatAllowed = INAPP_TREATMENTS[treatKey];
                const currentTreatment = treatAllowed && treatAllowed.includes((editing.design?.treatment || 'classic') as any)
                  ? (editing.design?.treatment || 'classic') : 'classic';
                const motionOn = editing.design?.motion === 'rich';
                const currentFontId = (() => {
                  const fd = String(editing.design?.font_display || '');
                  if (!fd) return 'theme_default';
                  const hit = INAPP_FONT_CATALOG.find((c) => fd === c.css);
                  return hit ? hit.id : 'theme_default';
                })();
                const headlineBlockIdx = blocks.findIndex((b: any) => b?.type === 'headline');
                const currentEmphasis = headlineBlockIdx >= 0 ? String(blocks[headlineBlockIdx]?.emphasis || '') : '';
                const setHeadlineEmphasis = (v: 'marker' | 'underline' | '') => {
                  if (headlineBlockIdx < 0) return;
                  const nb = blocks.map((b: any, i: number) => {
                    if (i !== headlineBlockIdx) return b;
                    if (!v) { const { emphasis: _e, ...rest } = b; return rest; }
                    return { ...b, emphasis: v };
                  });
                  setEditing({ ...editing, content_blocks: nb });
                };
                return (
                  <div className="mt-4 space-y-3">
                    {treatAllowed && treatAllowed.length > 1 && (
                      <div>
                        <label className="text-[10px] text-white/50 block mb-1">구도 (지금 형태 조합에서 쓸 수 있는 조판)</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {INAPP_TREATMENT_OPTIONS.filter((o) => treatAllowed.includes(o.key)).map((o) => (
                            <button
                              key={o.key}
                              onClick={() => setDesign({ treatment: o.key === 'classic' ? null : o.key })}
                              className={`px-2 py-2 rounded-lg border text-left transition-colors ${currentTreatment === o.key ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/70 hover:bg-white/5'}`}
                            >
                              <span className="block text-[11px] font-bold">{o.label}</span>
                              <span className="block text-[9px] text-white/45 mt-0.5">{o.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="text-[10px] text-white/50 block mb-1">모션 2.0 (CTA 맥동·쿠폰 샤인·초침 팝)</label>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setDesign({ motion: 'rich' })}
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${motionOn ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                          >켬</button>
                          <button
                            onClick={() => setDesign({ motion: null })}
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${!motionOn ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                          >끔</button>
                        </div>
                        <div className="text-[9px] text-white/35 mt-1">수신자 기기의 모션 줄이기 설정이 켜져 있으면 자동으로 꺼집니다.</div>
                      </div>
                      <div>
                        <label className="text-[10px] text-white/50 block mb-1">헤드라인 서체</label>
                        <select
                          value={currentFontId}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id === 'theme_default') { setDesign({ font_display: null }); return; }
                            const c = INAPP_FONT_CATALOG.find((x) => x.id === id);
                            setDesign({ font_display: c ? c.css : null });
                          }}
                          className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
                        >
                          <option value="theme_default">테마 기본</option>
                          {INAPP_FONT_CATALOG.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      {headlineBlockIdx >= 0 && (
                        <div>
                          <label className="text-[10px] text-white/50 block mb-1">헤드라인 강조</label>
                          <div className="flex gap-1.5">
                            {([['', '없음'], ['marker', '형광 마커'], ['underline', '밑줄']] as const).map(([v, label]) => (
                              <button
                                key={v || 'none'}
                                onClick={() => setHeadlineEmphasis(v)}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${currentEmphasis === v ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                              >{label}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* ★ 2026-07-17 텍스트 정렬 (좌/중/우) — 제목·본문 정렬. 전 템플릿 공통. 미지정=왼쪽(기존) */}
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="text-[10px] text-white/50 block mb-1">텍스트 정렬</label>
                        <div className="flex gap-1.5">
                          {([['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as const).map(([v, label]) => {
                            const cur = String(editing.design?.text_align || 'left');
                            return (
                              <button
                                key={v}
                                onClick={() => setDesign({ text_align: v === 'left' ? null : v })}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                              >{label}</button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {editing.template === 'center_modal' && (
                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <label className="text-[10px] text-white/50 block mb-1">배경 어둡기 (모달 뒤 딤)</label>
                          <div className="flex gap-1.5">
                            {([['soft', '옅게'], ['standard', '기본'], ['deep', '깊게']] as const).map(([v, label]) => {
                              const cur = String(editing.design?.backdrop?.dim || 'standard');
                              return (
                                <button
                                  key={v}
                                  onClick={() => {
                                    const bd = { ...(editing.design?.backdrop || {}) };
                                    if (v === 'standard') delete bd.dim; else bd.dim = v;
                                    setDesign({ backdrop: Object.keys(bd).length > 0 ? bd : null });
                                  }}
                                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                                >{label}</button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-white/50 block mb-1">배경 블러</label>
                          <div className="flex gap-1.5">
                            {([[true, '켬'], [false, '끔']] as const).map(([v, label]) => {
                              const cur = editing.design?.backdrop?.blur !== false;
                              return (
                                <button
                                  key={String(v)}
                                  onClick={() => {
                                    const bd = { ...(editing.design?.backdrop || {}) };
                                    if (v) delete bd.blur; else bd.blur = false;
                                    setDesign({ backdrop: Object.keys(bd).length > 0 ? bd : null });
                                  }}
                                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-slate-900/60 border-white/10 text-white/60 hover:bg-white/5'}`}
                                >{label}</button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* 탭 디자인: 프리셋 갤러리 (레거시 단색 — 블록 없을 때만) */}
            <div className={activeTab === 'design' && !hasBlocks ? '' : 'hidden'}>
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
                      onClick={() => {
                        if (hasBlocks) setEditing({ ...editing, image_url: null, content_blocks: blocks.filter((bl: any) => bl?.type !== 'media') });
                        else updateField('image_url', null);
                      }}
                      className="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                      aria-label="이미지 제거"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 bg-slate-900/60 border border-dashed border-white/20 rounded-lg text-xs text-white/70 hover:bg-white/5 flex items-center gap-2"
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

            {/* 탭 내용: CTA 버튼 (블록 모드는 cta_group 블록 사용 — 레거시만) */}
            <div className={activeTab === 'content' && !hasBlocks ? '' : 'hidden'}>
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
                      className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
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
                      className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                    <select
                      value={btn.style}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], style: e.target.value as any };
                        updateField('buttons', newButtons);
                      }}
                      className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
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
              <div className="bg-slate-900/60 border border-white/10 rounded-lg p-3 space-y-2">
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
                    className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
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
                    className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
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

            {/* AI 정밀 타겟 (표시 대상) — 자연어 추출 filter를 표시 대상으로 (단 1 오차 없는 타겟) */}
            <div className={activeTab === 'target' ? 'mt-3' : 'hidden'}>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> AI 정밀 타겟 (표시 대상)
              </h4>
              <div className="bg-slate-900/60 border border-white/10 rounded-lg p-3 space-y-2">
                {editing.audience_filter && Object.keys(editing.audience_filter).length > 0 ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-emerald-300">정밀 타겟 지정됨 — 이 조건에 맞는 회원에게만 표시</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">다시 추출</button>
                      <button onClick={() => updateField('audience_filter', null)} className="text-[11px] text-white/40 hover:text-white/70">해제</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setExtractOpen(true)} className="w-full py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 자연어로 표시 대상 추출
                  </button>
                )}
                <p className="text-[10px] text-white/30">세그먼트와 함께 적용됩니다. 표시는 저장 후 반영됩니다.</p>
              </div>
            </div>
            <TargetExtractModal
              show={extractOpen}
              channel="inapp"
              onClose={() => setExtractOpen(false)}
              onApply={(t) => { updateField('audience_filter', t.filter); setExtractOpen(false); }}
            />

            {/* 탭 타겟·시점: 개인화 · 트리거 · 시간 · 색상 */}
            <div className={activeTab === 'target' ? 'space-y-5' : 'hidden'}>
            {/* 개인화 변수 */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3" /> 개인화 변수 (본문 안 활용)
              </h4>
              <div className="bg-slate-900/60 border border-white/10 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {availableVariables.slice(0, 9).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => {
                      const cursorBody = (editing.body || '') + ' ' + v.key;
                      updateField('body', cursorBody);
                    }}
                    className="text-[10px] bg-slate-900/60 hover:bg-violet-500/20 border border-white/10 rounded px-2 py-1 text-left transition-colors"
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
                {isApp ? (
                  // ★ 2026-07-16 앱 = 실행(접속) 시에만 조회 — 다른 트리거로 저장되면 영원히 미표시라 고정
                  <div className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white/70 flex items-center">
                    앱 실행(접속) 시 표시
                  </div>
                ) : (
                <select
                  value={editing.trigger_event || 'page_load'}
                  onChange={(e) => {
                    const event = e.target.value as TriggerEvent;
                    // ★ P0-1 — 한 번의 setEditing으로 event+conditions 동시 갱신(연속 updateField는 stale state로 앞 갱신 유실).
                    //   임계값 키는 해당 트리거의 것만 유지(다른 트리거 임계 잔존 저장 방지).
                    const prev: any = editing.trigger_conditions || {};
                    const conds: any = { event };
                    if (event === 'scroll' && typeof prev.scroll_percent === 'number') conds.scroll_percent = prev.scroll_percent;
                    if (event === 'time_on_page' && typeof prev.time_on_page_seconds === 'number') conds.time_on_page_seconds = prev.time_on_page_seconds;
                    if (event === 'cart_value' && typeof prev.cart_value_min === 'number') conds.cart_value_min = prev.cart_value_min;
                    setEditing({ ...editing, trigger_event: event, trigger_conditions: conds });
                  }}
                  className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
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
                )}
                <select
                  value={editing.display_frequency || 'once_per_session'}
                  onChange={(e) => updateField('display_frequency', e.target.value as Frequency)}
                  className="px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
                >
                  <option value="once_per_session">{isApp ? '접속당 1회' : '세션당 1회'}</option>
                  <option value="once_per_day">하루 1회</option>
                  <option value="always">매번 표시</option>
                </select>
              </div>
              {/* ★ 2026-07-16 재노출 계약 안내 — 닫기 ≠ 영구 거부 */}
              <div className="text-[10px] text-white/40 mt-1.5">
                닫기(X)는 이번만 닫히고 위 빈도 규칙에 따라 다시 표시됩니다. "다시 보지 않기"를 누른 고객에게는 더 이상 표시되지 않습니다.
              </div>
              {/* ★ P0-1 — 트리거 임계값 입력 (없으면 "스크롤 도달"을 골라도 % 지정 불가 = 트리거 정밀 표시 무동작이던 결함) */}
              {(editing.trigger_event === 'scroll' || editing.trigger_event === 'time_on_page' || editing.trigger_event === 'cart_value') && (
                <div className="mt-2 bg-slate-900/40 border border-white/10 rounded-lg p-2.5">
                  {editing.trigger_event === 'scroll' && (
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">스크롤 도달 % (10~100 — 비우면 50%)</label>
                      <input
                        type="number" min={10} max={100}
                        value={editing.trigger_conditions?.scroll_percent ?? ''}
                        onChange={(e) => {
                          const conds: any = { ...(editing.trigger_conditions || {}), event: 'scroll' };
                          if (e.target.value === '') delete conds.scroll_percent;
                          else conds.scroll_percent = Math.max(0, Math.floor(Number(e.target.value)));
                          updateField('trigger_conditions', conds);
                        }}
                        placeholder="50"
                        className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                      />
                      <div className="text-[10px] text-white/40 mt-1">방문자가 페이지를 이만큼 내렸을 때 표시됩니다.</div>
                    </div>
                  )}
                  {editing.trigger_event === 'time_on_page' && (
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">체류 초 (5~600 — 비우면 10초)</label>
                      <input
                        type="number" min={5} max={600}
                        value={editing.trigger_conditions?.time_on_page_seconds ?? ''}
                        onChange={(e) => {
                          const conds: any = { ...(editing.trigger_conditions || {}), event: 'time_on_page' };
                          if (e.target.value === '') delete conds.time_on_page_seconds;
                          else conds.time_on_page_seconds = Math.max(0, Math.floor(Number(e.target.value)));
                          updateField('trigger_conditions', conds);
                        }}
                        placeholder="10"
                        className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                      />
                      <div className="text-[10px] text-white/40 mt-1">체류 판정은 10·30·60초 시점에 확인됩니다 (예: 30 입력 시 30초 시점 표시).</div>
                    </div>
                  )}
                  {editing.trigger_event === 'cart_value' && (
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">장바구니 금액 (원 이상)</label>
                      <input
                        type="number" min={0}
                        value={editing.trigger_conditions?.cart_value_min ?? ''}
                        onChange={(e) => {
                          const conds: any = { ...(editing.trigger_conditions || {}), event: 'cart_value' };
                          if (e.target.value === '') delete conds.cart_value_min;
                          else conds.cart_value_min = Math.max(0, Math.floor(Number(e.target.value)));
                          updateField('trigger_conditions', conds);
                        }}
                        placeholder="50000"
                        className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                      />
                      <div className="text-[10px] text-white/40 mt-1">자사몰이 SDK에 장바구니 금액을 전달할 때 비교됩니다.</div>
                    </div>
                  )}
                </div>
              )}
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
                      className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
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
                      className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                </div>
                {/* ★ P1-2 (2026-07-12) — 새벽 시간대 경고 (차단 아님 — 인앱은 정보통신망법 §50 전송 규제 밖, 법 판정 SoT §0) */}
                {(() => {
                  const s = editing.send_start_hour;
                  const e2 = editing.send_end_hour;
                  const dawn = (typeof s === 'number' && s < 8) || (typeof e2 === 'number' && (e2 < 8 || e2 >= 23));
                  if (!dawn) return null;
                  return (
                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-400/30 rounded-lg px-2.5 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-amber-200/90 leading-relaxed">
                        새벽 시간대 노출 설정입니다. 인앱은 방문자에게만 표시돼 법적 제한은 없지만, 새벽 방문 고객 경험을 고려해주세요.
                      </div>
                    </div>
                  );
                })()}
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
                            allowed ? 'bg-emerald-500/30 text-emerald-100 border border-emerald-400/40' : 'bg-slate-900/60 border border-white/10 text-white/40'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* ★ 2026-07-16 — 자동 닫힘은 앱이 소비하지 않는 옵션이라 앱 채널에서 숨김 (죽은 컨트롤 금지) */}
                  {!isApp && (
                    <div>
                      <label className="text-[10px] text-white/50 block mb-1">자동 닫힘 (초, 비우면 사용자 직접)</label>
                      <input
                        type="number"
                        min={1}
                        value={editing.auto_dismiss_seconds ?? ''}
                        onChange={(e) => updateField('auto_dismiss_seconds', e.target.value ? Number(e.target.value) : null)}
                        placeholder="비우면 수동"
                        className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">사용자별 최대 노출 횟수</label>
                    <input
                      type="number"
                      min={1}
                      value={editing.max_displays_per_user ?? ''}
                      onChange={(e) => updateField('max_displays_per_user', e.target.value ? Number(e.target.value) : null)}
                      placeholder="비우면 무한"
                      className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30"
                    />
                  </div>
                </div>
                {/* ★ 2026-07-16 — 애니메이션도 앱 미소비(네이티브 슬라이드업 고정)라 앱 채널에서 숨김 */}
                {!isApp && (
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">애니메이션</label>
                  <select
                    value={editing.animation || 'fade'}
                    onChange={(e) => updateField('animation', e.target.value as Animation)}
                    className="w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
                  >
                    <option value="fade">기본 (Fade)</option>
                    <option value="slide">슬라이드</option>
                    <option value="bounce">바운스</option>
                    <option value="pulse">펄스</option>
                    <option value="spring">스프링 (부드러운 등장)</option>
                    <option value="celebrate">축하 효과</option>
                  </select>
                </div>
                )}
              </div>
            </div>

            {/* 색상 + 상태 (블록 모드는 테마가 색 결정 → 상태만) */}
            <div>
              <h4 className="text-xs font-bold text-white/80 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3" /> {hasBlocks ? '상태' : '색상 + 상태'}
              </h4>
              <div className={`grid ${hasBlocks ? 'grid-cols-1' : 'grid-cols-3'} gap-2`}>
                {!hasBlocks && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">배경색</label>
                    <input
                      type="color"
                      value={editing.background_color || '#4f46e5'}
                      onChange={(e) => updateField('background_color', e.target.value)}
                      className="w-full h-9 bg-slate-900/60 border border-white/10 rounded cursor-pointer"
                    />
                  </div>
                )}
                {!hasBlocks && (
                  <div>
                    <label className="text-[10px] text-white/50 block mb-1">글자색</label>
                    <input
                      type="color"
                      value={editing.text_color || '#ffffff'}
                      onChange={(e) => updateField('text_color', e.target.value)}
                      className="w-full h-9 bg-slate-900/60 border border-white/10 rounded cursor-pointer"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">상태</label>
                  <select
                    value={editing.status || 'active'}
                    onChange={(e) => updateField('status', e.target.value as Status)}
                    className="w-full h-9 px-2 bg-slate-900/60 border border-white/10 rounded text-xs text-white"
                  >
                    <option value="active">활성</option>
                    <option value="paused">일시 중지</option>
                  </select>
                </div>
              </div>
              {hasBlocks && <div className="text-[10px] text-white/40 mt-1.5">색상은 디자인 탭의 테마·강조색으로 정해집니다.</div>}
            </div>
            </div>
          </div>

          {/* 우측 — 실시간 미리보기 */}
          <div className="bg-slate-950/40 p-6 space-y-3 sticky top-[76px] h-fit max-h-[80vh] overflow-y-auto">
            <h4 className="text-xs font-bold text-white/80 mb-1 flex items-center gap-1.5">
              <Eye className="w-3 h-3" /> 실시간 미리보기
            </h4>
            {editing.channel === 'app' && (
              <div className="bg-sky-500/10 border border-sky-400/30 rounded-lg px-3 py-2 text-[11px] text-sky-200 flex items-start gap-1.5">
                <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>아래 미리보기 = <strong>앱 실렌더와 동일 요소</strong>(이미지·배지·제목·본문·버튼)만 표시 — 만든 그대로 앱에 뜹니다. (앱 SDK 연동 필요)</span>
              </div>
            )}
            <div className="flex gap-1 flex-wrap">
              {previewPeople.map((p, i) => (
                <button
                  key={`${p.label}-${i}`}
                  onClick={() => setPreviewIdx(i)}
                  className={`flex-1 px-2 py-1.5 text-xs rounded ${
                    previewIdx === i
                      ? p.label === '타겟'
                        ? 'bg-emerald-500/30 border border-emerald-400/40 text-white'
                        : 'bg-violet-500/30 border border-violet-400/40 text-white'
                      : 'bg-slate-900/60 border border-white/10 text-white/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-white/40">
              {samplePerson ? (
                <>
                  샘플: {String(sampleCustomer.name || '고객')} · {String(sampleCustomer.grade || '-')} · {Number(sampleCustomer.points || 0).toLocaleString()}P
                  {samplePerson.is_sample
                    ? <span className="text-amber-300/80"> · 가상 예시 — 고객 DB에 데이터가 쌓이면 실제 고객으로 바뀝니다</span>
                    : <span className="text-emerald-300/70"> · 실제 고객 DB{samplePerson.label === '타겟' ? ' (타겟 조건 최상단 고객)' : ''}</span>}
                </>
              ) : (
                '실제 고객 샘플 불러오는 중...'
              )}
            </div>

            {isApp ? (
              // ★ 2026-07-16 범용 보장 계약 — 앱 채널 미리보기 = 앱 실렌더(바텀시트/중앙 모달) 1:1 미러
              <AppInAppPreview
                template={(editing.template || 'bottom_banner') as string}
                title={renderedTitle}
                body={renderedBody}
                imageUrl={editing.image_url}
                badge={editing.badge_text}
                buttons={(editing.buttons || []).map((b) => ({ ...b, label: replaceVars(b.label, sampleCustomer) }))}
                backgroundColor={editing.background_color || '#4f46e5'}
                textColor={editing.text_color || '#ffffff'}
              />
            ) : (
            <InAppMessagePreview
              template={(editing.template || 'top_banner') as string}
              title={renderedTitle}
              body={renderedBody}
              imageUrl={editing.image_url}
              badge={editing.badge_text}
              buttons={(editing.buttons || []).map((b) => ({ ...b, label: replaceVars(b.label, sampleCustomer) }))}
              backgroundColor={editing.background_color || '#4f46e5'}
              textColor={editing.text_color || '#ffffff'}
              blocks={hasBlocks ? blocks : undefined}
              theme={editing.theme}
              accentColor={editing.accent_color}
              cardStyle={editing.card_style}
              design={editing.design}
              replaceVars={(t) => replaceVars(t, sampleCustomer)}
            />
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className="sticky bottom-0 bg-slate-900/60 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button onClick={onSave} className="px-5 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-bold rounded-lg">
            저장
          </button>
        </div>
      </div>
      {/* ★ 2026-07-14 디자인 3.0 — 골든 템플릿 덮어쓰기 확인 (기존 블록 있을 때만) */}
      <ConfirmModal state={goldenConfirm} onClose={() => setGoldenConfirm(null)} />
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
  viewers: InAppViewersData | null;
  messageTitle: string;
  onClose: () => void;
}

function DrillDownModal({ loading, stats, explain, viewers, messageTitle, onClose }: DrillDownProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900/60 border-b border-white/10 px-6 py-4 flex items-center justify-between">
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
                        <div className="h-6 bg-slate-900/60 rounded overflow-hidden">
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

              {/* ★ 2026-07-06 누가 봤는지 — 식별 고객 목록 + 익명 합산 (절충안: 익명 다수 구조라 전 명단은 불가, 가능한 범위만 정직 표시) */}
              {viewers && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <h4 className="text-sm font-bold text-white">누가 봤는지 — 식별된 고객 {viewers.identifiedTotal.toLocaleString()}명</h4>
                    {viewers.viewers.length > 0 && (
                      <button
                        onClick={() => {
                          downloadCsv(
                            safeCsvFilename(messageTitle, '인앱_열람고객'),
                            ['이름', '전화번호', '표시 횟수', '클릭 수', '구매 건수(7일)', '구매 금액(7일)', '마지막 열람'],
                            viewers.viewers.map((v) => [
                              v.name || '', v.phone || '', v.impressions, v.clicks,
                              v.purchaseCount || '', v.purchaseAmount ? Math.round(Number(v.purchaseAmount)) : '',
                              v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString('ko-KR') : '',
                            ]),
                          );
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                    )}
                  </div>
                  {viewers.viewers.length === 0 ? (
                    <p className="text-xs text-white/40">아직 로그인 등으로 식별된 열람 고객이 없습니다.</p>
                  ) : (
                    <div className="divide-y divide-white/5 max-h-[240px] overflow-y-auto rounded-lg border border-white/5">
                      {viewers.viewers.slice(0, 100).map((v) => (
                        <div key={v.customerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
                          <span className="text-white/80 w-20 truncate">{v.name || '-'}</span>
                          <span className="text-white/40 font-mono w-28 truncate">{v.phone || '-'}</span>
                          <span className="text-white/50">표시 {v.impressions}</span>
                          <span className={v.clicks > 0 ? 'text-amber-300 font-semibold' : 'text-white/30'}>클릭 {v.clicks}</span>
                          {v.purchaseCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-200 border border-rose-400/30 font-semibold">구매 {Math.round(Number(v.purchaseAmount)).toLocaleString()}원</span>}
                          <span className="ml-auto text-white/30">{v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                      ))}
                      {viewers.viewers.length > 100 && <div className="px-3 py-2 text-[10px] text-white/40 text-center">외 {(viewers.viewers.length - 100).toLocaleString()}명 — CSV로 전체 확인</div>}
                    </div>
                  )}
                  <div className="mt-2.5 text-[11px] text-white/50">
                    익명 방문자 <strong className="text-white/80">{viewers.anonymous.visitors.toLocaleString()}명</strong> — 표시 {viewers.anonymous.impressions.toLocaleString()} · 클릭 {viewers.anonymous.clicks.toLocaleString()} <span className="text-white/35">(비로그인 방문은 개인 식별이 불가해 합산으로만 표시)</span>
                  </div>
                  <div className="text-[10px] text-white/30 italic mt-2">Data source — cdp_inapp_impressions × customers(식별분) + 익명 합산 · purchases 7일 실측</div>
                </div>
              )}

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
                    <div key={d.device} className="bg-slate-900/60 rounded p-3">
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
                  <div key={idx} className="bg-slate-900/60 rounded p-3">
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
                    <div className="h-1.5 bg-slate-900/60 rounded overflow-hidden mb-1">
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

// ════════════════════════════════════════════════════════════════════
// ★ D230+ 블록 컴포저 (content_blocks 편집 — slate 톤)
// ════════════════════════════════════════════════════════════════════

const ICON_KEYS = ['gift', 'bell', 'heart', 'star', 'tag', 'sparkle', 'cart', 'user', 'check', 'clock'];
const ILLUS_KEYS = ['welcome', 'celebrate', 'empty_cart', 'gift', 'bell', 'heart'];

// 2026-07-07(2) 팔레트 업그레이드 — 글자 버튼 나열 폐기: 카테고리 + 아이콘 + 한 줄 설명
type BlockCat = '텍스트' | '시각 요소' | '전환 유도' | '구조';
const BLOCK_ADD_MENU: { type: string; label: string; desc: string; cat: BlockCat; icon: any }[] = [
  { type: 'eyebrow', label: '라벨', desc: '작은 강조 칩 (NEW · VIP)', cat: '텍스트', icon: Tag },
  { type: 'headline', label: '헤드라인', desc: '큰 제목 한 줄', cat: '텍스트', icon: Type },
  { type: 'body', label: '본문', desc: '설명 문단 · 변수 지원', cat: '텍스트', icon: AlignLeft },
  { type: 'footer', label: '잔글씨/광고', desc: '하단 안내 · (광고) 표기', cat: '텍스트', icon: AlertCircle },
  { type: 'bullets', label: '체크 리스트', desc: '아이콘 + 장점 2~4줄', cat: '시각 요소', icon: ListChecks },
  { type: 'rating', label: '별점', desc: '평점 + 후기 수', cat: '시각 요소', icon: Star },
  { type: 'product', label: '상품 카드', desc: '이미지 + 상품명 + 설명', cat: '시각 요소', icon: ShoppingBag },
  { type: 'media', label: '미디어', desc: '아이콘 · 일러스트 · 이미지', cat: '시각 요소', icon: ImageIcon },
  { type: 'benefit', label: '혜택(티켓)', desc: '점선 쿠폰 스타일 강조', cat: '전환 유도', icon: Ticket },
  { type: 'countdown', label: '카운트다운', desc: '마감까지 실시간 시계', cat: '전환 유도', icon: Timer },
  { type: 'cta_group', label: '버튼(CTA)', desc: '이동 버튼 1~3개', cat: '전환 유도', icon: MousePointerClick },
  { type: 'divider', label: '구분선', desc: '내용 사이 나누기', cat: '구조', icon: Minus },
  { type: 'spacer', label: '여백', desc: '간격 조절', cat: '구조', icon: MoveVertical },
];

const BLOCK_LABELS: Record<string, string> = Object.fromEntries(BLOCK_ADD_MENU.map((b) => [b.type, b.label]));
const BLOCK_ICONS: Record<string, any> = Object.fromEntries(BLOCK_ADD_MENU.map((b) => [b.type, b.icon]));
const BLOCK_CATS: BlockCat[] = ['텍스트', '시각 요소', '전환 유도', '구조'];

function newBlock(type: string): any {
  switch (type) {
    case 'eyebrow': return { type, text: '', tone: 'accent' };
    case 'headline': return { type, text: '', size: 'lg' };
    case 'body': return { type, text: '' };
    case 'bullets': return { type, items: [{ icon: 'check', text: '' }] };
    case 'benefit': return { type, text: '[혜택 안내 — 직접 작성해주세요]' };
    case 'rating': return { type, value: 4.5, count: 0, label: '후기' };
    case 'product': return { type, name: '', meta: '' };
    case 'media': return { type, variant: 'icon', icon: 'gift' };
    case 'countdown': return { type, ends_at: '', label: '마감까지' };
    case 'cta_group': return { type, layout: 'stack', buttons: [{ id: 'btn_primary', label: '자세히 보기', action_url: '[URL — 회사 admin 수정]', style: 'primary' }] };
    case 'divider': return { type };
    case 'spacer': return { type, size: 'md' };
    case 'footer': return { type, text: '' };
    default: return { type };
  }
}

/** 레거시(제목/본문/이미지/버튼/배경) → 블록 + 테마 1:1 변환 */
export function convertToBlocks(m: Partial<MessageRow>): { content_blocks: any[]; theme: string; accent_color: string } {
  const blocks: any[] = [];
  if (m.badge_text && String(m.badge_text).trim()) blocks.push({ type: 'eyebrow', text: String(m.badge_text).trim(), tone: 'accent' });
  if (m.image_url) blocks.push({ type: 'media', variant: 'image', url: m.image_url, aspect: '16:9' });
  if (m.title && m.title.trim()) blocks.push({ type: 'headline', text: m.title.trim(), size: 'lg' });
  if (m.body && m.body.trim()) blocks.push({ type: 'body', text: m.body.trim() });
  if ((m.buttons || []).length > 0) {
    blocks.push({
      type: 'cta_group', layout: 'stack',
      buttons: (m.buttons || []).map((b, i) => ({
        id: b.id || `btn_${i}`, label: b.label, action_url: b.action_url,
        style: b.style === 'tertiary' ? 'tertiary' : b.style === 'secondary' ? 'secondary' : 'primary',
      })),
    });
  }
  if (blocks.length === 0) { blocks.push({ type: 'headline', text: '', size: 'lg' }); blocks.push({ type: 'body', text: '' }); }
  const bg = String(m.background_color || '');
  const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bg);
  return { content_blocks: blocks, theme: isHex ? 'vibrant' : 'brand', accent_color: isHex ? bg : '#6d5cf0' };
}

const COMPOSER_INPUT = 'w-full px-2 py-1.5 bg-slate-900/60 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/40';

// ★ P2-1 — 드래그용 임시 uid 시퀀스 (블록 jsonb에 id 필드를 저장하지 않기 위해 배열과 나란히만 유지)
let inappBlockUidSeq = 0;

/** ★ P2-1 — 블록 카드 1장 (드래그 핸들 + 위/아래 + 복제 + 삭제). useSortable 훅은 조기 return 없는 전용 컴포넌트에만 (LESSONS 0706 백지 사고) */
function SortableInAppBlock({
  uid, block, highlighted, isFirst, isLast, onUp, onDown, onDuplicate, onRemove, children,
}: {
  uid: string;
  block: any;
  highlighted: boolean;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative',
  };
  const Ic = BLOCK_ICONS[block.type] || Layers;
  return (
    <div ref={setNodeRef} style={style} className={`bg-slate-800/50 border rounded-xl p-3 transition-all ${highlighted ? 'border-violet-400/70 ring-2 ring-violet-400/30' : 'border-white/10'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span
            {...attributes}
            {...listeners}
            title="드래그하여 순서 변경"
            aria-label="드래그 핸들"
            className="shrink-0 text-white/30 hover:text-white/70 cursor-grab active:cursor-grabbing touch-none px-0.5"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-violet-200 bg-violet-500/15 px-2 py-0.5 rounded-full">
            <Ic className="w-3 h-3" /> {BLOCK_LABELS[block.type] || block.type}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={onUp} disabled={isFirst} className="p-1 text-white/40 hover:text-white disabled:opacity-20" aria-label="위로"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={onDown} disabled={isLast} className="p-1 text-white/40 hover:text-white disabled:opacity-20" aria-label="아래로"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={onDuplicate} className="p-1 text-white/40 hover:text-violet-300" aria-label="복제"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={onRemove} className="p-1 text-rose-300/70 hover:text-rose-300" aria-label="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {children}
    </div>
  );
}

function BlockComposer({ blocks, onChange, uploadImage }: { blocks: any[]; onChange: (b: any[]) => void; uploadImage: (file: File) => Promise<string | null> }) {
  const [showAdd, setShowAdd] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  // ★ P2-1 — 저장 블록엔 id가 없어(불필요 필드 jsonb 저장 금지) 드래그용 uid를 블록 "객체 참조" 기준으로 유지.
  //   내부 핸들러는 commit()으로 blocks·uids를 함께 확정하고, 외부 변경(AI 생성 통째 교체·디자인 탭 media 앞삽입)은
  //   참조 매칭 reconcile로 기존 블록 uid 보존 + 새 객체만 새 uid (Codex 1R — 길이 동기화의 row identity 어긋남 정정).
  const uidsRef = useRef<string[]>([]);
  const prevBlocksRef = useRef<any[]>([]);
  if (prevBlocksRef.current !== blocks) {
    const uidByBlock = new Map<any, string>();
    prevBlocksRef.current.forEach((b, i) => {
      if (b && typeof b === 'object' && uidsRef.current[i]) uidByBlock.set(b, uidsRef.current[i]);
    });
    const used = new Set<string>();
    uidsRef.current = blocks.map((b) => {
      const known = b && typeof b === 'object' ? uidByBlock.get(b) : undefined;
      if (known && !used.has(known)) { used.add(known); return known; }
      const fresh = `blk-${++inappBlockUidSeq}`;
      used.add(fresh);
      return fresh;
    });
    prevBlocksRef.current = blocks;
  }
  const uids = uidsRef.current;

  // 내부 편집 확정 — uid를 함께 등록해 다음 렌더의 reconcile이 참조 그대로 스킵(편집 중 새 uid 재발급 = 포커스 유실 방지)
  const commit = (nextBlocks: any[], nextUids: string[]) => {
    uidsRef.current = nextUids;
    prevBlocksRef.current = nextBlocks;
    onChange(nextBlocks);
  };
  const update = (i: number, patch: any) => commit(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)), uids);
  const remove = (i: number) => commit(blocks.filter((_, idx) => idx !== i), uids.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    const nu = [...uids];
    [nu[i], nu[j]] = [nu[j], nu[i]];
    commit(next, nu);
  };
  const duplicate = (i: number) => {
    const copy = JSON.parse(JSON.stringify(blocks[i]));
    const next = [...blocks];
    next.splice(i + 1, 0, copy);
    const nu = [...uids];
    nu.splice(i + 1, 0, `blk-${++inappBlockUidSeq}`);
    commit(next, nu);
    setHighlight(i + 1);
  };
  const add = (type: string) => {
    commit([...blocks, newBlock(type)], [...uids, `blk-${++inappBlockUidSeq}`]);
    setShowAdd(false);
    setHighlight(blocks.length);
  };
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = uids.indexOf(String(active.id));
    const to = uids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    commit(arrayMove(blocks, from, to), arrayMove(uids, from, to));
  };
  // 추가된 블록으로 자동 스크롤 + 잠시 하이라이트 — "추가했는데 어디 갔지" 방지
  useEffect(() => {
    if (highlight === null) return;
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const t = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(t);
  }, [highlight]);

  return (
    <div className="space-y-2">
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={uids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <SortableInAppBlock
                key={uids[i]}
                uid={uids[i]}
                block={b}
                highlighted={highlight === i}
                isFirst={i === 0}
                isLast={i === blocks.length - 1}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onDuplicate={() => duplicate(i)}
                onRemove={() => remove(i)}
              >
                <BlockEditor block={b} onChange={(patch) => update(i, patch)} uploadImage={uploadImage} />
              </SortableInAppBlock>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div ref={listEndRef} />

      <div className="relative">
        <button onClick={() => setShowAdd((v) => !v)} className="w-full text-xs text-violet-200 bg-violet-500/10 hover:bg-violet-500/20 border border-dashed border-violet-400/30 rounded-lg py-2 flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> 블록 추가
        </button>
        {showAdd && (
          <div className="mt-2 bg-slate-900/80 border border-white/10 rounded-xl p-3 space-y-3">
            {BLOCK_CATS.map((cat) => (
              <div key={cat}>
                <div className="text-[10px] font-bold text-white/40 mb-1.5 tracking-wide">{cat}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {BLOCK_ADD_MENU.filter((m) => m.cat === cat).map((m) => {
                    const Ic = m.icon;
                    return (
                      <button
                        key={m.type}
                        onClick={() => add(m.type)}
                        className="flex items-start gap-2 text-left bg-white/5 hover:bg-violet-500/20 border border-white/10 hover:border-violet-400/40 rounded-lg px-2.5 py-2 transition-colors"
                      >
                        <span className="w-6 h-6 rounded-md bg-violet-500/15 border border-violet-400/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Ic className="w-3.5 h-3.5 text-violet-200" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[11px] font-bold text-white/85">{m.label}</span>
                          <span className="block text-[9px] text-white/45 leading-tight mt-0.5">{m.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 편집기 공용 소도구 (2026-07-07(2) 허접 요소 제거) ──

/** 세그먼트 버튼 — 드롭다운 대체 (한눈에 보고 즉시 클릭) */
function Seg({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${value === o.v ? 'bg-violet-500/30 text-white' : 'bg-slate-900/60 text-white/50 hover:text-white/80'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 일러스트 키 → 표시용 아이콘 (SDK illustrationSvg 매핑과 동일)
const ILLUS_DISPLAY: Record<string, string> = { welcome: 'user', empty_cart: 'cart', celebrate: 'sparkle' };

/** 아이콘 그리드 픽커 — 영문 드롭다운 대체 (SVG를 눈으로 보고 클릭) */
function IconGrid({ keys, value, onChange, illustration }: { keys: string[]; value: string; onChange: (k: string) => void; illustration?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          title={k}
          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${value === k ? 'bg-violet-500/30 border-violet-400/60' : 'bg-slate-900/60 border-white/10 hover:bg-white/5'}`}
        >
          <BlockIcon name={illustration ? (ILLUS_DISPLAY[k] || k) : k} color={value === k ? '#e9d5ff' : 'rgba(255,255,255,0.6)'} size={15} />
        </button>
      ))}
    </div>
  );
}

/** 별점 직접 클릭 (0.5 단위 — 별의 좌반/우반) */
function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="relative inline-flex">
          <BlockIcon name="star" color={value >= n - 0.5 ? '#fbbf24' : 'rgba(255,255,255,0.25)'} size={20} fill={value >= n} />
          <button type="button" aria-label={`${n - 0.5}점`} onClick={() => onChange(n - 0.5)} className="absolute inset-y-0 left-0 w-1/2" />
          <button type="button" aria-label={`${n}점`} onClick={() => onChange(n)} className="absolute inset-y-0 right-0 w-1/2" />
        </span>
      ))}
      <span className="text-xs text-white/70 font-bold ml-1.5 tabular-nums">{Number(value || 0).toFixed(1)}</span>
    </div>
  );
}

/** 마감까지 남은 시간 실시간 배지 — 편집 중 즉시 확인 */
function RemainBadge({ endsAt }: { endsAt: string }) {
  const end = Date.parse(endsAt || '');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isFinite(end) || end <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);
  if (!isFinite(end)) return <span className="text-[10px] text-white/40">마감 시각을 설정하면 남은 시간이 표시됩니다</span>;
  const remain = end - now;
  if (remain <= 0) return <span className="text-[10px] text-rose-300">이미 지난 시각 — 자사몰에 표시되지 않습니다</span>;
  const s = Math.floor(remain / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return <span className="text-[10px] text-emerald-300 tabular-nums">지금 기준 {d > 0 ? `${d}일 ${h}시간` : `${h}시간 ${m}분`} 남음</span>;
}

/** 체크 리스트 편집 — 항목별 아이콘 그리드 토글 */
function BulletsEditor({ b, onChange }: { b: any; onChange: (patch: any) => void }) {
  const [iconOpenIdx, setIconOpenIdx] = useState<number | null>(null);
  const items = Array.isArray(b.items) ? b.items : [];
  const setItem = (j: number, patch: any) => {
    const next = [...items];
    next[j] = { ...next[j], ...patch };
    onChange({ items: next });
  };
  return (
    <div className="space-y-1.5">
      {items.map((it: any, j: number) => (
        <div key={j} className="bg-slate-900/40 border border-white/10 rounded-lg p-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIconOpenIdx(iconOpenIdx === j ? null : j)}
              className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-400/30 flex items-center justify-center shrink-0"
              title="아이콘 선택"
            >
              <BlockIcon name={it.icon || 'check'} color="#e9d5ff" size={15} />
            </button>
            <input type="text" value={it.text || ''} onChange={(e) => setItem(j, { text: e.target.value })} placeholder="항목 텍스트" className={COMPOSER_INPUT} />
            <button onClick={() => onChange({ items: items.filter((_: any, x: number) => x !== j) })} className="text-rose-300/70 hover:text-rose-300 p-1 shrink-0" aria-label="항목 삭제"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          {iconOpenIdx === j && (
            <IconGrid keys={ICON_KEYS} value={it.icon || 'check'} onChange={(k) => { setItem(j, { icon: k }); setIconOpenIdx(null); }} />
          )}
        </div>
      ))}
      {items.length < 4 && (
        <button onClick={() => onChange({ items: [...items, { icon: 'check', text: '' }] })} className="text-[11px] text-violet-300 hover:bg-violet-500/10 px-2 py-1 rounded flex items-center gap-1"><Plus className="w-3 h-3" /> 항목 추가</button>
      )}
    </div>
  );
}

function BlockEditor({ block, onChange, uploadImage }: { block: any; onChange: (patch: any) => void; uploadImage: (file: File) => Promise<string | null> }) {
  const b = block;
  switch (b.type) {
    case 'eyebrow':
    case 'footer':
      return <input type="text" value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder={b.type === 'footer' ? '잔글씨 / (광고) 표기' : '짧은 라벨 (NEW · 오랜만이에요)'} className={COMPOSER_INPUT} />;
    case 'headline':
      return (
        <div className="space-y-1.5">
          <input type="text" value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="헤드라인 (변수 X)" className={COMPOSER_INPUT} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40">크기</span>
            <Seg options={[{ v: 'sm', label: '작게' }, { v: 'lg', label: '보통' }, { v: 'xl', label: '크게' }]} value={b.size || 'lg'} onChange={(v) => onChange({ size: v })} />
          </div>
        </div>
      );
    case 'body':
      return (
        <div className="space-y-1.5">
          <textarea value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="본문 (변수/Liquid 활용 가능)" className={`${COMPOSER_INPUT} resize-y h-16`} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40">글자 크기</span>
            <Seg options={[{ v: 'sm', label: '작게' }, { v: 'md', label: '보통' }, { v: 'lg', label: '크게' }]} value={b.size || 'md'} onChange={(v) => onChange({ size: v })} />
          </div>
        </div>
      );
    case 'benefit':
      return (
        <div>
          <textarea value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="[혜택 안내 — 직접 작성해주세요]" className={`${COMPOSER_INPUT} resize-y h-14`} />
          <div className="text-[10px] text-amber-200/70 mt-1">혜택은 회사 정책에 맞게 직접 작성하세요. placeholder 그대로면 저장이 막힙니다.</div>
        </div>
      );
    case 'bullets':
      return <BulletsEditor b={b} onChange={onChange} />;
    case 'rating':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40">별점 (클릭 — 반쪽 = 0.5)</span>
            <StarInput value={Number(b.value ?? 0)} onChange={(v) => onChange({ value: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-white/50">후기 수<input type="number" min={0} value={b.count ?? ''} onChange={(e) => onChange({ count: e.target.value === '' ? 0 : Number(e.target.value) })} className={COMPOSER_INPUT} /></label>
            <label className="text-[10px] text-white/50">라벨<input type="text" value={b.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="후기" className={COMPOSER_INPUT} /></label>
          </div>
        </div>
      );
    case 'product':
      return (
        <div className="space-y-1.5">
          <div className="flex gap-2 items-start">
            {b.image ? (
              <div className="relative shrink-0">
                <img src={b.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className="w-14 h-14 object-cover rounded-lg border border-white/10 bg-white/5" />
                <button onClick={() => onChange({ image: '' })} className="absolute -top-1.5 -right-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]" aria-label="이미지 제거">✕</button>
              </div>
            ) : (
              <label className="w-14 h-14 shrink-0 flex flex-col items-center justify-center text-[9px] text-white/50 bg-white/5 hover:bg-white/10 border border-dashed border-white/20 rounded-lg cursor-pointer transition-colors">
                <ImageIcon className="w-4 h-4 mb-0.5" />이미지
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
                  onChange={async (e) => { const f = e.target.files?.[0]; const el = e.currentTarget; if (f) { const url = await uploadImage(f); if (url) onChange({ image: url }); } el.value = ''; }} />
              </label>
            )}
            <div className="flex-1 space-y-1.5 min-w-0">
              <input type="text" value={b.name || ''} onChange={(e) => onChange({ name: e.target.value })} placeholder="상품명" className={COMPOSER_INPUT} />
              <input type="text" value={b.meta || ''} onChange={(e) => onChange({ meta: e.target.value })} placeholder="간단 설명" className={COMPOSER_INPUT} />
            </div>
          </div>
          {/* ★ P2-2 (2026-07-12) — 가격 구조화 (이메일 product_carousel과 동일 구조). 비우면 기존 meta 문자열 그대로 = 하위호환 */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">정가 (원)</label>
              <input type="number" min={0} value={b.price ?? ''} onChange={(e) => onChange({ price: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="예: 39000" className={COMPOSER_INPUT} />
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">할인가 (원)</label>
              <input type="number" min={0} value={b.discount_price ?? ''} onChange={(e) => onChange({ discount_price: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="예: 29000" className={COMPOSER_INPUT} />
            </div>
          </div>
          <div className="text-[10px] text-white/40">가격을 입력하면 카드에 가격이 표시되고(할인가는 강조 + 정가 취소선), 간단 설명은 가격이 없을 때만 표시됩니다.</div>
        </div>
      );
    case 'media':
      return (
        <div className="space-y-1.5">
          <Seg
            options={[{ v: 'icon', label: '아이콘' }, { v: 'illustration', label: '일러스트' }, { v: 'image', label: '이미지' }]}
            value={b.variant || 'icon'}
            onChange={(v) => onChange({ variant: v, ...(v !== 'image' ? { icon: v === 'illustration' ? 'welcome' : 'gift' } : {}) })}
          />
          {b.variant === 'image' ? (
            <div className="space-y-1.5">
              {b.url && <img src={b.url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className="w-full max-h-28 object-cover rounded-lg border border-white/10" />}
              <div className="flex gap-1.5 items-center">
                <label className="flex-1 text-center text-[11px] text-white/70 bg-white/5 hover:bg-white/10 border border-dashed border-white/20 rounded px-2 py-1.5 cursor-pointer transition-colors">
                  이미지 업로드 (2MB 이하)
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={async (e) => { const f = e.target.files?.[0]; const el = e.currentTarget; if (f) { const url = await uploadImage(f); if (url) onChange({ url }); } el.value = ''; }}
                  />
                </label>
                {b.url && <button onClick={() => onChange({ url: '' })} className="text-rose-300/70 hover:text-rose-300 px-2 py-1 text-[11px]">제거</button>}
              </div>
              <input type="text" value={b.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="또는 이미지 URL 직접 입력" className={COMPOSER_INPUT} />
            </div>
          ) : (
            <IconGrid
              keys={b.variant === 'illustration' ? ILLUS_KEYS : ICON_KEYS}
              value={b.icon || (b.variant === 'illustration' ? 'welcome' : 'gift')}
              onChange={(k) => onChange({ icon: k })}
              illustration={b.variant === 'illustration'}
            />
          )}
        </div>
      );
    case 'countdown':
      return (
        <div className="space-y-1.5">
          <div className="text-[10px] text-white/50 mb-1">마감 시각 — 날짜는 캘린더, 시간은 직접 입력</div>
          <DateTimeField value={b.ends_at || ''} onChange={(iso) => onChange({ ends_at: iso })} tone="dark" />
          <div className="flex items-center gap-2">
            <input type="text" value={b.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="라벨 (마감까지)" className={`${COMPOSER_INPUT} w-40`} />
            <RemainBadge endsAt={b.ends_at || ''} />
          </div>
        </div>
      );
    case 'spacer':
      return (
        <Seg options={[{ v: 'sm', label: '좁게' }, { v: 'md', label: '보통' }, { v: 'lg', label: '넓게' }]} value={b.size || 'md'} onChange={(v) => onChange({ size: v })} />
      );
    case 'divider':
      return <div className="text-[10px] text-white/40">구분선 (옵션 없음)</div>;
    case 'cta_group':
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40">정렬</span>
            <Seg options={[{ v: 'stack', label: '세로' }, { v: 'inline', label: '가로' }]} value={b.layout || 'stack'} onChange={(v) => onChange({ layout: v })} />
          </div>
          {(b.buttons || []).map((btn: any, j: number) => {
            const setBtn = (patch: any) => { const buttons = [...(b.buttons || [])]; buttons[j] = { ...buttons[j], ...patch }; onChange({ buttons }); };
            return (
              <div key={j} className="bg-slate-900/40 border border-white/10 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input type="text" value={btn.label || ''} onChange={(e) => setBtn({ label: e.target.value })} placeholder="버튼 문구" className={COMPOSER_INPUT} />
                  <button onClick={() => onChange({ buttons: (b.buttons || []).filter((_: any, x: number) => x !== j) })} className="text-rose-300/70 hover:text-rose-300 p-1 shrink-0" aria-label="버튼 삭제"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <input type="text" value={btn.action_url || ''} onChange={(e) => setBtn({ action_url: e.target.value })} placeholder="이동 URL (https://...)" className={COMPOSER_INPUT} />
                <Seg
                  options={[{ v: 'primary', label: '강조' }, { v: 'secondary', label: '보통' }, { v: 'tertiary', label: '외곽선' }, { v: 'ghost', label: '텍스트' }]}
                  value={btn.style || 'primary'}
                  onChange={(v) => setBtn({ style: v })}
                />
              </div>
            );
          })}
          {(b.buttons || []).length < 3 && (
            <button onClick={() => onChange({ buttons: [...(b.buttons || []), { id: `btn_${(b.buttons || []).length}`, label: '버튼', action_url: '[URL — 회사 admin 수정]', style: 'secondary' }] })} className="text-[11px] text-violet-300 hover:bg-violet-500/10 px-2 py-1 rounded flex items-center gap-1"><Plus className="w-3 h-3" /> 버튼 추가</button>
          )}
        </div>
      );
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-06 표시 채널 없음 차단 모달 — 표시할 곳 없는 인앱 생성(크레딧) 사전 차단
// ════════════════════════════════════════════════════════════════════

function InAppDisplayBlockModal({ reason, onGoSettings, onClose }: { reason: string | null; onGoSettings: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">인앱 메시지를 표시할 곳이 없습니다</h3>
            <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
              {reason || '인앱 메시지를 표시할 수 있는 쇼핑몰 연동이 없습니다. 카페24·고도몰·메이크샵·아임웹 연동 또는 자체 쇼핑몰에 SDK 설치 후 이용할 수 있습니다.'}
            </p>
            <p className="text-[11px] text-white/40 mt-2">표시할 곳이 없는 상태에서는 크레딧이 소모되는 생성·게시가 진행되지 않습니다.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onGoSettings} className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:opacity-90 rounded-lg text-sm font-bold text-white">쇼핑몰 연동하러 가기</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-white/15 text-sm text-white/70 hover:bg-white/5">닫기</button>
        </div>
      </div>
    </div>
  );
}
