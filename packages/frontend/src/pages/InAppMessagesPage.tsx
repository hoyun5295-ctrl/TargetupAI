import ZoneFrame from '../components/zone/ZoneFrame';
import ZoneEmphasis from '../components/zone/ZoneEmphasis';
import ZoneStatStrip from '../components/zone/ZoneStatStrip';
import ZoneSection from '../components/zone/ZoneSection';
import ZoneSegmented from '../components/zone/ZoneSegmented';
import ZoneSelect from '../components/zone/ZoneSelect';
import { INAPP_CHANNEL_TABS } from '../components/zone/zone-tabs';
import { zoneModule } from '../constants/ai-operator-modules';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AlertCircle, AlertTriangle, AlignLeft, ArrowLeft, BarChart3, ChevronDown, ChevronUp,
  Clock, Copy, CreditCard, Crown, Download, Edit2, Eye, Globe, GripVertical, ImageIcon, Layers, Lightbulb, ListChecks, Loader2, Minus, MousePointer,
  FolderOpen, MousePointerClick, MoveVertical, Plus, RefreshCw, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Star,
  Tag, Target, Ticket, Timer, Trash2, TrendingDown, TrendingUp, Type, Upload, UserPlus, Users, Wand2, X, Send,
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
// ★ 2026-07-22 테스트저장 — 웹·앱 실물을 PNG로 저장(영업용). 정적 import 필수(난독화×동적 import 사고 회피 — LESSONS_FRONTEND 2026-07-18).
import { toPng } from 'html-to-image';
import { useAuthStore } from '../stores/authStore';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { AI_GENERATE_COSTS } from '../constants/credit';
import { useToast } from '../components/ToastProvider';
import TargetExtractModal from '../components/TargetExtractModal';
import {
  THEME_OPTIONS, CARD_STYLE_OPTIONS, SIGNATURE_THEME_OPTIONS, INAPP_TREATMENTS, INAPP_TREATMENT_OPTIONS,
  INAPP_FONT_CATALOG, type CardStyle,
} from '../components/inapp/blockTheme';
// ★ 2026-07-14 디자인 3.0 — 골든 템플릿 12종 (형태×카드×테마×블록 완성형 — 혜택 placeholder 준수)
// ★ 2026-07-14 Harold 지시 — 옛 골든 12종 노출 제거(정예 10종만). 타입만 유지(정예 적용 함수 공용).
import { type GoldenInAppTemplate } from '../components/inapp/goldenTemplates';
import { Icon as BlockIcon, isInAppBlockAllowed } from '../components/inapp/BlockPreview';
import { AppInAppContractModal } from '../components/inapp/AppIntegrationContract';
import { DateTimeField } from '../components/DateTimeField';
import { takeEventDraft, EVENT_INAPP_DRAFT_KEY } from '../components/EventCampaignModal';
import { STUDIO_INAPP_DRAFT_KEY } from '../lib/studio-draft';
import ImageToCopyButton from '../components/ImageToCopyButton';
import { MK_HEAD_BTN, MK_HEAD_BTN_ON, MK_HEAD_SEG, MK_HEAD_SEG_DISABLED, MK_HEAD_SEG_OFF, MK_HEAD_SEG_ON, MK_LINE_EXTRA_BTN } from '../utils/make-ui';
// ★ 2026-07-18 P2 — CTA 자동 연결: DM의 연동 몰 상품 픽커 재사용 (URL 수기 입력 사고 차단 — 0718 팝폰 m/xxx 무반응 근본)
import MallProductPickerModal, { type PickedMallProduct } from '../components/dm/MallProductPickerModal';
// ★ 2026-07-18 P3 — 에셋 라이브러리 픽커 (업로드 소재 재사용 — 전 채널 공용 컴포넌트)
import AssetLibraryPickerModal, { type PickedAsset } from '../components/assets/AssetLibraryPickerModal';
// ★ 2026-09-29 인앱 만들기 개편 — 전체 화면 편집기(EditShell) · 입구 갤러리 · 포스터 계열 장 편집(설계서 docs/2026-09-29-inapp-editor-redesign-design.md)
import EditShell, { type SaveTone } from '../components/make/EditShell';
// ★ 2026-10-05 한줄로 시그니처(설계서 docs/2026-10-05-hanjul-signature-design.md §5) — 한 줄 원문 · 완성도 줄 · 혜택 자리 0크레딧 채우기
import ZoneCompletion from '../components/zone/ZoneCompletion';
import { LineFacts, LineFactsSheet, typedBenefit, type LineFactsValues } from '../components/zone/LineFacts';
import { countSlots, fillSlots, fillSlotsDeep, stringsDeep, appendToOneLine } from '../utils/one-line';
import type { FixItem } from '../utils/make-flow';
import InAppEntryGallery from '../components/inapp/InAppEntryGallery';
import { PosterStage, SlideRail, SlidePanel, LayoutSwitcher, ImageSourceMenu, useImageSources, readField, writeField, FIELD_MAX } from '../components/inapp/PosterEditor';
import { resolvePosterLayout, type PosterLayout, type SheetEditKey } from '../components/inapp/PosterSheetPreview';
import {
  slidesFromMessage, messagePatchFromSlides, restyleSlides, duplicateSlide, publishDefectOf, layoutKeyOf, isPosterLayout,
  MAX_SLIDES, APP_SHEET_LAYOUTS_UNLOCKED, type WsSlide, type LayoutKey,
} from '../components/inapp/inappSlides';

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

type Template = 'top_banner' | 'bottom_banner' | 'center_modal' | 'full_screen' | 'slide_in' | 'inline_card' | 'toast' | 'floating_button' | 'full_image';
type Frequency = 'once_per_session' | 'once_per_day' | 'always';
type Status = 'active' | 'paused' | 'archived';
type TriggerEvent = 'page_load' | 'cart_add' | 'cart_view' | 'checkout_start' | 'scroll' | 'time_on_page' | 'exit_intent' | 'cart_value';
type Animation = 'fade' | 'slide' | 'bounce' | 'pulse' | 'spring' | 'celebrate';
// ★ 2026-07-18 재편 (Harold 확정) — 리텐션형(휴면·재구매) 제거: 인앱은 접속 중인 사람에게만 보이는 채널.
//   남은 5종은 백엔드 SCENARIO_CONDITIONS가 세그·트리거·빈도를 결정 주입 — 카드 문구 = 실조건 1:1.
type QuickStartScenario = 'cart_recovery' | 'new_welcome' | 'new_product' | 'vip_appreciation' | 'checkout_abandon';
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
  // ★ 2026-07-21 포스터 캐러셀 — 서버 저장 슬라이드 전체(첫 장 포함). list 응답 snake_case. 빈/미설정 = 단일 포스터
  poster_slides?: any[] | null;
  // ★ 2026-09-29 인앱 만들기 개편 — 포스터 계열 장 작업본(첫 장 포함 · 클라 전용). 저장 때 messagePatchFromSlides 로 flat + poster_slides 합성
  slides_ws?: WsSlide[];
  // ★ 2026-09-29 게시 과금 이력(GET /inapp 동봉) — 초안을 게시할 때 과금 확인 창을 띄울지(설계서 §1-4)
  publish_charged?: boolean;
  // ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체 클릭 시 이동 링크(선택). 캐러셀 첫 장 link_url도 이 값에서 합성
  image_link_url?: string | null;
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

// ★ 2026-07-18 재편 — 라벨·힌트 = 백엔드 listQuickStartCards·SCENARIO_CONDITIONS와 1:1 (카드 문구가 곧 저장 조건)
const SCENARIO_VISUAL: Record<QuickStartScenario, { icon: typeof ShoppingCart; gradient: string; label: string; hint: string }> = {
  cart_recovery:     { icon: ShoppingCart, gradient: 'from-amber-400 to-orange-500',   label: '장바구니 살리기', hint: '최근 3일 장바구니 담은 고객 · 장바구니 화면에서' },
  new_welcome:       { icon: UserPlus,     gradient: 'from-emerald-400 to-teal-500',   label: '신규 고객 환영',  hint: "등급 '신규' 고객 · 접속 시 · 세션당 1회" },
  new_product:       { icon: Sparkles,     gradient: 'from-fuchsia-400 to-purple-500', label: '신상품 알림',     hint: '전체 방문 고객 · 접속 시 · 하루 1회' },
  vip_appreciation:  { icon: Crown,        gradient: 'from-amber-400 to-yellow-500',   label: 'VIP 감사',        hint: "등급 'VIP' 고객 · 접속 시 · 세션당 1회" },
  checkout_abandon:  { icon: CreditCard,   gradient: 'from-sky-400 to-indigo-500',     label: '결제 완료 돕기',  hint: '결제 시작 고객 · 결제 화면 진입 시' },
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
  full_image: '포스터형',
};

// ★ 2026-07-18 정정 — 웹 기존 라벨(중앙 모달 등) 유지, 신설 포스터형만 라벨+힌트 부여
const WEB_PICKER_LABELS: Partial<Record<Template, { label: string; hint: string }>> = {
  full_image: { label: '포스터형', hint: '전면 이미지 1장' },
};

// ★ 2026-06-17 채널별 표시 형태 — 확실한 것만 (애매/충돌 형태 배제)
//   웹: 오버레이로 안전한 4종 (상단/하단 배너=헤더 충돌, 전체화면=과함, 인라인=협조 필요 → 배제)
//   ★ 2026-07-16 범용 보장 계약 — 앱: 실제 앱 렌더는 중앙 모달/바텀 시트 2형뿐 (그 외 값도 앱이 시트로 그림).
//   편집기가 6형을 약속하고 앱이 2형만 그리던 거짓 선택지 제거 — 확실히 렌더되는 것만 노출.
const CHANNEL_TEMPLATES: Record<'web' | 'app', Template[]> = {
  // ★ 2026-07-18 정정2 (Harold 지시) — 웹 = 기존 다양성 유지 + 포스터형 추가.
  //   앱 = 2종 구도: 기본형(중앙 모달/바텀 시트로 위치 분기) + 포스터형(전면 이미지 — 신규).
  web: ['center_modal', 'slide_in', 'toast', 'floating_button', 'full_image'],
  app: ['center_modal', 'bottom_banner', 'full_image'],
};

// 앱 채널 표시 형태 라벨 — 실렌더 기준 (bottom_banner 값 = 앱에서 바텀 시트로 렌더)
const APP_TEMPLATE_LABELS: Partial<Record<Template, string>> = {
  center_modal: '기본형 · 중앙 모달',
  bottom_banner: '기본형 · 바텀 시트',
  full_image: '포스터형',
};

// ★ 2026-07-18 정정 (Harold 지시) — 웹의 정예 템플릿·테마 다양성은 유지가 맞다 (단순화 2형 구도는 앱 채널 축). 원복.
const SHOW_ELITE_TEMPLATES = true;

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
  // ★ 2026-07-18 정정 — 웹 기존 기본색 원복 (흰 바닥 고정은 포스터형 렌더에만 내장된 규칙)
  background_color: '#4f46e5',
  text_color: '#ffffff',
  trigger_event: 'page_load',
  trigger_conditions: { event: 'page_load' },
  segment_conditions: {},
  personalization_vars: [],
  display_frequency: 'once_per_session',
  allowed_weekdays: [0, 1, 2, 3, 4, 5, 6],
  animation: 'fade',
  // ★ 2026-09-29 인앱 만들기 개편 — 새 작업본 = 초안(멈춤 · 자동 저장). 게시는 [발행]에서만(옛: active 로 시작 → 첫 저장 = 게시 · 15크레딧).
  status: 'paused',
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
  // ★ 2026-09-30 AI 존 대개편 — 첫 화면 한 줄 입력도 같은 채널 고르기 창을 거쳐 생성(채널을 추측하지 않는다)
  const [objectivePick, setObjectivePick] = useState<string | null>(null);
  const [previewMsg, setPreviewMsg] = useState<MessageRow | null>(null);
  // ★ 2026-07-19 P4: 라이브러리 소재로 시작(목록 헤더) — 소재 선택 → 포스터형 새 초안
  const [startLibOpen, setStartLibOpen] = useState(false);
  // ★ 2026-07-06 인앱 표시 가능성 — 연동 플랫폼별 지원 + SDK 신호. 표시할 곳 없으면 생성 차단(크레딧 낭비 방지).
  const [eligibility, setEligibility] = useState<DisplayEligibility | null>(null);
  const [showDisplayBlock, setShowDisplayBlock] = useState(false);

  // AI 생성 진행 상태
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgressStep, setAiProgressStep] = useState<number>(-1);
  const [aiObjective, setAiObjective] = useState('');
  // ★ 2026-10-05 한 줄로 만든 메시지(스위치 켠 회사) — 편집기에 완성도 줄 · 혜택 채우기 시트를 그린다
  const [inappLine, setInappLine] = useState<string | null>(null);

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
      status: 'paused',
      channel: 'web',
    });
    toast.success('행사 캠페인 인앱 초안을 불러왔습니다. 이미지만 올리고 다듬어주세요.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-07-19 P4: 이미지 스튜디오 소재 → 포스터형(full_image) 새 초안 (라이브러리 클릭 → 인앱 만들기)
  useEffect(() => {
    const d = takeEventDraft<{ imageUrl?: string }>(STUDIO_INAPP_DRAFT_KEY);
    if (!d?.imageUrl) return;
    setChannel('web');
    setEditing({ ...EMPTY_FORM, template: 'full_image', image_url: d.imageUrl, channel: 'web' });
    toast.success('스튜디오 소재로 포스터형 인앱을 시작했어요. 문구·타겟만 다듬어주세요.');
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
  // ★ 2026-09-26 한줄로 V2 R1-42 — AI 영향 요인 분석은 버튼으로(열 때마다 자동 호출 = 1크레딧씩 빠지던 결함)
  const [drillExplainLoading, setDrillExplainLoading] = useState(false);
  // ★ 2026-09-26 한줄로 V2 R1-45 — A/B 변형 검토 창(AI 다듬기 변형은 일시정지로 만들어지고 여기서 켠다)
  const [variantReview, setVariantReview] = useState<{ parentId: string; title: string } | null>(null);
  const drillIdRef = useRef<string | null>(null);

  const token = () => localStorage.getItem('token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // ────────────────────────────────────────────────────────────────
  // 데이터 로드
  // ────────────────────────────────────────────────────────────────

  const handle503 = (data: any): boolean => {
    if (data?.code === 'DB_MIGRATION_PENDING') {
      setError(data.error || 'DB 마이그레이션 필요. 운영자에게 문의해주세요.');
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
      showToast('진단할 메시지가 없습니다. 먼저 메시지를 생성해주세요.', { type: 'info' });
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

  const handleAIGenerate = async (objective: string, templateHint?: QuickStartScenario, channelOverride?: 'web' | 'app', oneLine = false) => {
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
        // ★ 2026-10-05 한 줄 입구 표시(서버가 스위치를 보고 한 줄을 사용자 원문으로 쓴다 · 스위치 밖이면 지금 그대로)
        body: JSON.stringify({ objective, templateHint, ...(oneLine ? { one_line: true } : {}) }),
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
      setInappLine(oneLine && data.one_line?.enabled ? objective.trim() : null);
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
        status: 'paused',
        channel: channelOverride || channel || 'web',
      });
      setAiProgressStep(5);
      setTimeout(() => {
        setAiGenerating(false);
        setAiObjective('');
        showToast('AI 메시지 생성 완료. 혜택 부분 직접 작성 후 저장해주세요.', { type: 'success' });
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
            // ★ 2026-09-26 R1-45 — 다듬기 변형은 일시정지로 만들어진다 → 바로 검토 창을 연다
            if (actionType === 'ai_refine') setVariantReview({ parentId: targetMsg.id, title: targetMsg.title });
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

  // ★ 2026-09-29 인앱 만들기 개편 — 저장 · 발행은 편집기(EditModal)가 소유한다(초안 자동 저장 · [발행] · [반영]).
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryGoldens, setEntryGoldens] = useState<Array<GoldenInAppTemplate & { difference?: string }>>([]);
  const inappOneLine = zoneModule('inapp').oneLine!;
  const selectChannelTab = (id: string) => {
    if (id === 'web') { if (webBlocked) { setShowDisplayBlock(true); return; } setChannel('web'); return; }
    if (id === 'app') setChannel('app');
  };

  const openEntry = () => {
    setEntryOpen(true);
    if (entryGoldens.length > 0) return;
    fetch('/api/design/golden-templates?channel=inapp', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d?.success && Array.isArray(d.templates)) setEntryGoldens(d.templates); })
      .catch(() => { /* 조회 실패 = 문구 스타일 줄만 숨김 */ });
  };

  // ────────────────────────────────────────────────────────────────
  // 메시지 삭제 / 상태 변경
  // ────────────────────────────────────────────────────────────────

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
    drillIdRef.current = m.id;
    setDrillMessageId(m.id);
    setDrillStats(null);
    setDrillExplain(null);
    setDrillExplainLoading(false);
    setDrillViewers(null);
    setDrillLoading(true);
    try {
      // ★ 2026-09-26 한줄로 V2 R1-42 — 통계·열람 목록만 불러온다. AI 분석(유료)은 사용자가 버튼을 누를 때만.
      const [funnelRes, viewersRes] = await Promise.all([
        fetch(`/api/cdp/inapp/funnel-stats/${m.id}`, { headers: authHeaders() }),
        // ★ 2026-07-06 식별 고객 열람 목록 + 익명 합산 (절충안)
        fetch(`/api/cdp/inapp/viewers/${m.id}`, { headers: authHeaders() }),
      ]);
      const funnelData = await funnelRes.json();
      const viewersData = await viewersRes.json();
      if (funnelData.success) {
        setDrillStats({
          funnel: funnelData.funnel,
          hourly: funnelData.hourly,
          heatmap: funnelData.heatmap,
          device: funnelData.device,
        });
      }
      if (viewersData.success) setDrillViewers({ viewers: viewersData.viewers || [], identifiedTotal: viewersData.identifiedTotal || 0, anonymous: viewersData.anonymous || { visitors: 0, impressions: 0, clicks: 0 } });
    } catch (e: any) {
      showToast(e?.message || '드릴다운 로드 실패', { type: 'error' });
    } finally {
      setDrillLoading(false);
    }
  };

  // ★ 2026-09-26 한줄로 V2 R1-42 — AI 영향 요인 분석 1클릭(누를 때만 차감 · 다른 메시지로 옮겨 가면 늦은 응답은 버린다)
  const requestDrillExplain = async () => {
    const id = drillIdRef.current;
    if (!id || drillExplainLoading) return;
    setDrillExplainLoading(true);
    try {
      const res = await fetch('/api/cdp/inapp/explain', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message_id: id }) });
      const data = await res.json().catch(() => ({}));
      if (drillIdRef.current !== id) return;
      if (res.ok && data?.success) setDrillExplain(data.result);
      else showToast(data?.error || 'AI 분석을 불러오지 못했습니다.', { type: 'error' });
    } catch (e: any) {
      if (drillIdRef.current === id) showToast(e?.message || 'AI 분석을 불러오지 못했습니다.', { type: 'error' });
    } finally {
      if (drillIdRef.current === id) setDrillExplainLoading(false);
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
              // 기존 미디어 블록의 명시 aspect는 보존, 없으면(아이콘/일러스트였던 블록) 전체보기 기본 — 크롭 방지
              nb[idx] = { ...nb[idx], variant: 'image', url: data.url, aspect: nb[idx].aspect || defaultMediaAspect(prev.template || prev.position) };
            } else {
              nb = [{ type: 'media', variant: 'image', url: data.url, aspect: defaultMediaAspect(prev.template || prev.position) }, ...blocks];
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
    if (messages.length === 0) issues.push('등록된 메시지 없음. 자연어 입력 또는 빠른 시작 카드로 시작해주세요.');
    if (overview && overview.totalImpressions30d < 100) issues.push(`최근 30일 impression ${overview.totalImpressions30d}건. 100건 이상 누적 후 정확한 분석 가능`);
    if (overview && overview.avgCTR > 0 && overview.avgCTR < 0.03) issues.push(`평균 CTR ${(overview.avgCTR * 100).toFixed(1)}% (3% 미만). AI 다듬기 1-click 액션 권장`);
    return issues;
  }, [messages, overview]);

  // ════════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════════

  // ★ 2026-06-17 채널 분리 — 진입 시 웹/앱 선택 (인앱메시지 안에서 채널 가름)
  if (!channel) {
    return (
      <ZoneFrame
        moduleId="inapp"
        command={{
          line: {
            value: aiObjective,
            onChange: setAiObjective,
            onSubmit: () => { if (customerGate.isEmpty) { setShowDataGate(true); return; } setObjectivePick(aiObjective.trim()); },
            placeholder: inappOneLine.placeholder,
            verb: inappOneLine.verb,
            icon: Sparkles,
            busy: aiGenerating,
            extra: <ImageToCopyButton label="이미지" onExtracted={(t) => setAiObjective((prev) => appendToOneLine(prev, t))} disabled={aiGenerating} className={MK_LINE_EXTRA_BTN} />,
          },
        }}
        emphasis={
          <ZoneEmphasis kind="ai" title="빠른 시작" meta="시나리오만 고르면 AI가 제목·본문·트리거까지">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {(Object.keys(SCENARIO_VISUAL) as QuickStartScenario[]).map((sc, i, all) => {
              const v = SCENARIO_VISUAL[sc];
              const Icon = v.icon;
              return (
                <button
                  key={sc}
                  onClick={() => { if (customerGate.isEmpty) { setShowDataGate(true); return; } setScenarioPick(sc); }}
                  className={`group text-left bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-2xl p-4 transition-all ${all.length % 2 === 1 && i === all.length - 1 ? 'col-span-2 lg:col-span-1' : ''}`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${v.gradient} flex items-center justify-center mb-3 shadow-md`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-sm font-bold text-slate-900">{v.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug break-keep">{v.hint}</div>
                </button>
              );
            })}
          </div>
          </ZoneEmphasis>
        }
      >
        <div className="space-y-7">
          {customerGate.isEmpty && <CustomerDataRequiredBanner />}

          {/* 2) 직접 만들기 — 채널 컴팩트 2카드 + 미니 미리보기 썸네일 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Layers className="w-4 h-4 text-violet-700" />
              <h2 className="text-sm font-bold text-slate-900">직접 만들기<span className="text-slate-400 font-normal">: 띄울 곳을 고르면 빈 편집기로</span></h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => { if (webBlocked) { setShowDisplayBlock(true); return; } setChannel('web'); }} className="group flex items-center gap-4 bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 hover:border-violet-300 rounded-2xl p-4 transition-all text-left">
                <div className="w-16 h-12 rounded-md bg-slate-100 border border-slate-200 relative shrink-0 overflow-hidden">
                  <div className="h-2.5 bg-slate-100 flex items-center gap-0.5 px-1.5"><span className="w-1 h-1 rounded-full bg-slate-300" /><span className="w-1 h-1 rounded-full bg-slate-300" /></div>
                  <div className="absolute inset-x-2.5 bottom-1.5 top-4 rounded bg-violet-100 border border-violet-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-violet-800" />웹 자사몰 팝업</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">모달 · 슬라이드 · 토스트 · 플로팅</div>
                  {webBlocked ? (
                    <div className="text-[10px] text-amber-700 mt-1">표시할 쇼핑몰 연동 필요. 눌러서 안내 보기</div>
                  ) : eligibility?.warnWeb ? (
                    <div className="text-[10px] text-amber-700 mt-1">연동됨. 쇼핑몰에 SDK 설치 후 표시</div>
                  ) : (
                    <div className="text-[10px] text-emerald-700 mt-1">즉시 사용 가능</div>
                  )}
                </div>
              </button>
              <button onClick={() => setChannel('app')} className="group flex items-center gap-4 bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-200 hover:border-sky-300 rounded-2xl p-4 transition-all text-left">
                <div className="w-9 h-12 rounded-lg bg-slate-100 border border-slate-200 relative shrink-0 overflow-hidden mx-[14px]">
                  <div className="absolute inset-x-1 top-1.5 h-3.5 rounded-sm bg-sky-100 border border-sky-300" />
                  <div className="absolute inset-x-1.5 bottom-1 h-1 rounded-full bg-slate-200" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 text-sky-800" />모바일 앱 인앱</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">모달 · 전면 · 배너 · 토스트</div>
                  <div className="text-[10px] text-amber-700 mt-1">웹뷰 앱 지원 (네이티브는 추후)</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3) 최근 인앱 메시지 — 데이터 있을 때만 (없으면 섹션 숨김) */}
          {recentMessages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-cyan-700" />
                <h2 className="text-sm font-bold text-slate-900">최근 인앱 메시지<span className="text-slate-400 font-normal">: 눌러서 미리보기·편집</span></h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recentMessages.map((m) => (
                  <button key={m.id} onClick={() => setPreviewMsg(m)} className="text-left bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-xl p-3 transition-all">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${m.channel === 'app' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>{m.channel === 'app' ? '앱' : '웹'}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{m.status === 'active' ? '활성' : m.status === 'paused' ? '일시중지' : m.status}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate">{m.title || '(제목 없음)'}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-tight">{m.body}</div>
                    {m.stats && (
                      <div className="mt-2 flex gap-2 text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                        <span>표시 {m.stats.impressions.toLocaleString()}</span>
                        <span>클릭 {m.stats.clicks.toLocaleString()}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 italic mt-2">Data source: cdp_inapp_messages (회사 격리)</div>
            </div>
          )}
        </div>

        {/* 채널 선택 모달 — 빠른 시작 클릭 시 웹/앱 선택 → AI 자동 생성 */}
        {(scenarioPick || objectivePick) && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-bold text-slate-900">어디에 띄울까요?</h3>
                <button onClick={() => { setScenarioPick(null); setObjectivePick(null); }} className="text-slate-500 hover:text-slate-900 p-1 rounded hover:bg-slate-100" aria-label="닫기"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-slate-500 mb-4 line-clamp-2">{scenarioPick ? SCENARIO_VISUAL[scenarioPick].label : `"${objectivePick}"`}: 채널을 고르면 AI가 바로 만들어요</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { if (webBlocked) { setScenarioPick(null); setObjectivePick(null); setShowDisplayBlock(true); return; } const sc = scenarioPick; const ob = objectivePick; setScenarioPick(null); setObjectivePick(null); setChannel('web'); if (sc) handleAIGenerate('', sc, 'web'); else if (ob) handleAIGenerate(ob, undefined, 'web', true); }}
                  className="flex flex-col items-center gap-2 bg-violet-100 hover:bg-violet-100 border border-violet-200 rounded-xl p-4 transition-colors"
                >
                  <Globe className="w-6 h-6 text-violet-800" />
                  <span className="text-sm font-bold text-slate-900">웹 자사몰</span>
                  <span className="text-[10px] text-slate-500">{webBlocked ? '쇼핑몰 연동 필요' : '팝업·슬라이드·토스트'}</span>
                </button>
                <button
                  onClick={() => { const sc = scenarioPick; const ob = objectivePick; setScenarioPick(null); setObjectivePick(null); setChannel('app'); if (sc) handleAIGenerate('', sc, 'app'); else if (ob) handleAIGenerate(ob, undefined, 'app', true); }}
                  className="flex flex-col items-center gap-2 bg-sky-100 hover:bg-sky-100 border border-sky-200 rounded-xl p-4 transition-colors"
                >
                  <Smartphone className="w-6 h-6 text-sky-800" />
                  <span className="text-sm font-bold text-slate-900">모바일 앱</span>
                  <span className="text-[10px] text-slate-500">중앙 모달·바텀 시트</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 최근 인앱 폰 미리보기 모달 */}
        {previewMsg && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
            <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${previewMsg.channel === 'app' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>{previewMsg.channel === 'app' ? '앱' : '웹'}</span>
                  <h3 className="text-sm font-bold text-slate-900 truncate">{previewMsg.title || '(제목 없음)'}</h3>
                </div>
                <button onClick={() => setPreviewMsg(null)} className="text-slate-500 hover:text-slate-900 p-1 rounded hover:bg-slate-100 shrink-0" aria-label="닫기"><X className="w-4 h-4" /></button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-100 p-3">
                {previewMsg.channel === 'app' ? (() => {
                  // ★ 2026-07-16 앱 메시지 = 앱 실렌더 미러 미리보기 (옛 블록 저장분은 flat 승계해 표시)
                  const flat = composeFlatFromBlocksFE(previewMsg.content_blocks || []);
                  return (
                    <AppInAppPreview
                      template={previewMsg.template === 'center_modal' || previewMsg.template === 'full_image' ? previewMsg.template : 'bottom_banner'}
                      title={previewMsg.title || flat.title || ''}
                      body={previewMsg.body || flat.body || ''}
                      imageUrl={previewMsg.image_url || flat.imageUrl}
                      badge={previewMsg.badge_text || flat.badgeText}
                      buttons={(previewMsg.buttons && previewMsg.buttons.length > 0 ? previewMsg.buttons : flat.buttons) || []}
                      backgroundColor={previewMsg.background_color || '#4f46e5'}
                      textColor={previewMsg.text_color || '#ffffff'}
                      design={previewMsg.design}
                      posterSlides={previewMsg.poster_slides || undefined}
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
                  posterSlides={previewMsg.poster_slides || undefined}
                />
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { const msg = previewMsg; const ch: 'web' | 'app' = msg.channel === 'app' ? 'app' : 'web'; setPreviewMsg(null); setChannel(ch); setEditing(msg); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  <Edit2 className="w-4 h-4" />수정
                </button>
                <button onClick={() => setPreviewMsg(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-white">닫기</button>
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
      </ZoneFrame>
    );
  }

  return (
    <ZoneFrame
      moduleId="inapp"
      tabs={INAPP_CHANNEL_TABS}
      activeTab={channel}
      onSelectTab={selectChannelTab}
      more={[{ label: '시작 화면으로', onClick: () => setChannel(null) }]}
      command={{
        line: {
          value: aiObjective,
          onChange: setAiObjective,
          onSubmit: () => handleAIGenerate(aiObjective, undefined, undefined, true),
          placeholder: inappOneLine.placeholder,
          verb: inappOneLine.verb,
          icon: Sparkles,
          busy: aiGenerating,
          extra: <ImageToCopyButton label="이미지" onExtracted={(t) => setAiObjective((prev) => appendToOneLine(prev, t))} disabled={aiGenerating} className={MK_LINE_EXTRA_BTN} />,
        },
      }}
      stamp={{ text: '다시 읽기', onRefresh: loadAll, loading }}
      start={{
        items: [
          { icon: Plus, title: '모양 골라 시작', desc: channel === 'app' ? '기본형(중앙 모달·바텀 시트) · 포스터형' : '모달·슬라이드·토스트·플로팅·포스터형', tint: 'from-rose-400 to-pink-500', featured: true, onClick: openEntry },
          { icon: FolderOpen, title: '라이브러리 소재로', desc: '저장 소재로 포스터형 인앱을 바로 시작', tint: 'from-amber-400 to-orange-500', onClick: () => setStartLibOpen(true) },
        ],
      }}
      blocks={[
        ...(error ? [{ text: error, tone: 'rose' as const }] : []),
        ...(channel === 'web' && eligibility && webBlocked ? [{ text: eligibility.blockReasonWeb || '표시할 쇼핑몰 연동이 필요합니다.', tone: 'rose' as const, actionLabel: '쇼핑몰 연동하러 가기', onAction: () => navigate('/cdp-settings') }] : []),
        ...(channel === 'web' && eligibility && !webBlocked && eligibility.warnWeb ? [{
          text: `${eligibility.platforms.filter((p) => p.support !== 'unsupported').map((p) => p.label).join(' · ')} 연동됨. 아직 쇼핑몰에서 SDK 신호가 감지되지 않았습니다. 쇼핑몰에 SDK 스크립트를 설치해야 만든 메시지가 실제로 표시됩니다.${eligibility.platforms.some((p) => p.support === 'unsupported') ? ' (네이버 스마트스토어는 인앱 표시 미지원, 데이터 연동만)' : ''}`,
          actionLabel: '설치 가이드 보기',
          onAction: () => navigate('/cdp-settings'),
        }] : []),
      ]}
      emphasis={
        <ZoneEmphasis kind="ai" title="빠른 시작" meta="카드에 적힌 대상·시점이 그대로 설정됩니다">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {quickStartCards.map((card) => {
              const visual = SCENARIO_VISUAL[card.scenario] || SCENARIO_VISUAL.cart_recovery;
              const Icon = visual.icon;
              return (
                <button
                  key={card.scenario}
                  onClick={() => handleAIGenerate('', card.scenario)}
                  disabled={aiGenerating}
                  className="group text-left bg-white hover:bg-slate-100 border border-slate-200 hover:border-violet-300 rounded-2xl p-3.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${visual.gradient} flex items-center justify-center mb-2.5 shadow-md group-hover:scale-105 transition-transform`}>
                    <Icon className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div className="text-xs font-bold text-slate-900">{card.label}</div>
                  <div className="text-[10px] text-slate-400 mt-1 leading-snug">{card.hint}</div>
                </button>
              );
            })}
          </div>
        </ZoneEmphasis>
      }
    >
        <AssetLibraryPickerModal
          open={startLibOpen}
          onClose={() => setStartLibOpen(false)}
          onPick={(a) => {
            setChannel('web');
            setEditing({ ...EMPTY_FORM, template: 'full_image', image_url: a.url, channel: 'web' });
            toast.success('라이브러리 소재로 포스터형 인앱을 시작했어요. 문구·타겟만 다듬어주세요.');
          }}
        />
      <div className="space-y-5">
        {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-4" />}

        {/* ★ 2026-07-06 인앱 표시 채널 상태 — 표시 불가·미설치는 위 차단 상자, 정상은 한 줄 */}
        {channel === 'web' && eligibility && !webBlocked && !eligibility.warnWeb && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-[11px] text-emerald-800 flex-wrap">
          <Activity className="w-3.5 h-3.5 shrink-0" />
          <span>SDK 신호 감지됨{eligibility.webSdkLastSeenAt ? `: 최근 ${new Date(eligibility.webSdkLastSeenAt).toLocaleString('ko-KR')}` : ''}</span>
          {eligibility.platforms.length > 0 && <span className="text-slate-400">· 연동: {eligibility.platforms.map((p) => p.label).join(', ')}</span>}
          {eligibility.platforms.some((p) => p.support === 'unsupported') && <span className="text-amber-700">· 네이버 스마트스토어는 인앱 표시 미지원(데이터 연동만)</span>}
        </div>
        )}
        {/* ▼ 영역 6: 6 sub-agent 진행 카드 (조건부 — 생성 중일 때만) */}
        {aiGenerating && (
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">AI 생성 진행 중...</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(SUB_AGENT_VISUAL).map(([key, visual], idx) => {
                const Icon = visual.icon;
                const isDone = idx <= aiProgressStep;
                return (
                  <div
                    key={key}
                    className={`p-3 rounded-lg border transition-all ${
                      isDone
                        ? `bg-gradient-to-br ${visual.gradient} border-slate-300 shadow-lg`
                        : 'bg-white border-slate-100 opacity-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {isDone ? <Icon className="w-4 h-4 text-slate-900" /> : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                      <span className="text-xs font-bold text-slate-900">{visual.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-600">{idx + 1}/6</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ▼ 영역 7: 요약 숫자 한 줄(★ 2026-09-30 AI 존 보정 · 메시지·게시 중 + 성과 3 · 증감은 숫자 아래) */}
        {overview && (() => {
          const withDelta = (v: string, d: number | null) => (
            <>
              {v}
              {d !== null && (
                <span className={`block text-[11px] font-semibold mt-0.5 ${d >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{d >= 0 ? '+' : ''}{d.toFixed(1)}% 이전 30일 대비</span>
              )}
            </>
          );
          return (
            <ZoneStatStrip
              title="요약"
              icon={BarChart3}
              source={overview.dataSource}
              cells={[
                { label: '메시지', value: overview.totalMessages.toLocaleString() },
                { label: '게시 중', value: overview.activeMessages.toLocaleString() },
                { label: '평균 CTR', value: withDelta(`${(overview.avgCTR * 100).toFixed(2)}%`, overview.delta.avgCTRPercent) },
                { label: '30일 impression', value: withDelta(overview.totalImpressions30d.toLocaleString(), overview.delta.impressionsPercent) },
                { label: '24h 매핑 구매', value: withDelta(overview.totalAttributedPurchases30d.toLocaleString(), overview.delta.purchasesPercent) },
              ]}
            />
          );
        })()}

        {/* ▼ AI 개선 — 진단 + 1-click 통합 (한 카드) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 flex items-center justify-center flex-shrink-0">
              <Lightbulb className="w-5 h-5 text-violet-800" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-sm font-bold text-slate-900">AI 개선</h3>
              <p className="text-xs text-slate-500 mt-0.5">{topInsight || (dataShortage.length > 0 ? dataShortage[0] : '성과를 분석해 개선점을 제안합니다. 아래 버튼으로 바로 적용하세요.')}</p>
            </div>
            <button
              onClick={handleDiagnose}
              disabled={diagnosing || messages.length === 0}
              className="text-xs border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed px-3.5 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors"
            >
              {diagnosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {diagnosing ? '진단 중...' : 'AI 진단'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
            {[
              { type: 'ai_refine' as const, icon: Wand2, title: '본문 다듬기', desc: '감성·실용·캐주얼 3안', iconBg: 'from-violet-50 to-purple-50', iconColor: 'text-violet-800' },
              { type: 'time_optimize' as const, icon: Clock, title: '시간대 최적화', desc: 'best CTR 시간 적용', iconBg: 'from-emerald-50 to-teal-50', iconColor: 'text-emerald-800' },
              { type: 'segment_refine' as const, icon: Target, title: '세그먼트 정밀화', desc: 'LTV 상위 + 활성', iconBg: 'from-amber-50 to-orange-50', iconColor: 'text-amber-800' },
            ].map((action) => (
              <button
                key={action.type}
                onClick={() => handleQuickAction(action.type)}
                disabled={messages.length === 0}
                className="bg-white hover:bg-slate-100 border border-slate-200 rounded-xl p-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${action.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <action.icon className={`w-4 h-4 ${action.iconColor}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">{action.title}</div>
                    <div className="text-[10px] text-slate-500 truncate">{action.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ▼ 영역 10: 메시지 목록 (filter + sort + 카드) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <ZoneSection
            title="메시지 목록"
            count={filteredMessages.length}
            filter={(
              <ZoneSegmented
                ariaLabel="메시지 상태 거르기"
                items={[{ id: 'all', label: '전체' }, { id: 'active', label: '게시 중' }, { id: 'paused', label: '멈춤' }, { id: 'archived', label: '보관함' }] as Array<{ id: Status | 'all'; label: string }>}
                value={statusFilter}
                onChange={(id) => setStatusFilter(id)}
              />
            )}
            right={(
              <>
                <ZoneSelect
                  ariaLabel="템플릿 거르기"
                  value={templateFilter}
                  onChange={(v) => setTemplateFilter(v)}
                  options={[{ value: 'all' as Template | 'all', label: '전체 템플릿' }, ...Object.entries(TEMPLATE_LABELS).map(([key, label]) => ({ value: key as Template | 'all', label }))]}
                />
                <ZoneSelect
                  ariaLabel="정렬"
                  value={sortMode}
                  onChange={(v) => setSortMode(v)}
                  options={[{ value: 'created_desc' as SortMode, label: '최신순' }, { value: 'ctr_desc' as SortMode, label: 'CTR 높은순' }, { value: 'impressions_desc' as SortMode, label: '노출 많은순' }]}
                />
                <button onClick={() => setShowDetails(true)} className="h-10 px-3.5 rounded-xl border border-slate-200 bg-white shadow-sm text-[13px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors">
                  <BarChart3 className="w-[15px] h-[15px] text-slate-500" /> 자세히 분석
                </button>
              </>
            )}
          />

          {loading ? (
            <div className="py-12 flex justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              조건에 일치하는 메시지가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMessages.map((m) => {
                const template = (m.template || m.position || 'top_banner') as Template;
                return (
                  <div key={m.id} className="bg-white border border-slate-200 rounded-lg p-4 hover:bg-slate-100 transition-colors">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <div className="text-sm font-bold text-slate-900">{m.title}</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            m.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                            m.status === 'paused' && m.publish_charged ? 'bg-amber-100 text-amber-700' :
                            m.status === 'paused' ? 'bg-slate-500/25 text-slate-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>{m.status === 'active' ? '게시 중' : m.status === 'paused' ? (m.publish_charged ? '멈춤' : '초안') : m.status}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full">
                            {template === 'full_image' ? ({ overlay: '포스터', event_card: '이벤트 카드', banner_sheet: '배너 시트' } as const)[resolvePosterLayout(m.design)] : TEMPLATE_LABELS[template]}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mb-2 line-clamp-2">{m.body}</div>
                        <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
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
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600 border-t border-slate-100 pt-2">
                            <span>표시 <strong className="text-indigo-700">{m.stats.impressions.toLocaleString()}</strong></span>
                            <span>클릭 <strong className="text-emerald-700">{m.stats.clicks.toLocaleString()}</strong></span>
                            <span>닫힘 <strong className="text-slate-500">{m.stats.dismisses.toLocaleString()}</strong></span>
                            <span>CTR <strong>{(m.stats.ctr * 100).toFixed(2)}%</strong></span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button onClick={() => openDrillDown(m)} className="text-[11px] text-cyan-700 hover:bg-cyan-50 px-2.5 py-1 rounded flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" /> 통계
                        </button>
                        <button onClick={() => setVariantReview({ parentId: m.id, title: m.title })} className="text-[11px] text-violet-700 hover:bg-violet-50 px-2.5 py-1 rounded flex items-center gap-1">
                          <Layers className="w-3 h-3" /> A/B 변형
                        </button>
                        <button onClick={() => setEditing(m)} className="text-[11px] text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 rounded flex items-center gap-1">
                          <Edit2 className="w-3 h-3" /> 수정
                        </button>
                        <button onClick={() => handleDelete(m)} className="text-[11px] text-rose-700 hover:bg-rose-50 px-2.5 py-1 rounded flex items-center gap-1">
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

      {/* ★ 2026-09-29 인앱 만들기 개편 — 입구(모양 고르기 · 용도로 바로 시작) → 전체 화면 편집기 */}
      {entryOpen && (
        <InAppEntryGallery
          channel={channel || 'web'}
          onChannel={(c) => setChannel(c)}
          goldens={entryGoldens}
          onClose={() => setEntryOpen(false)}
          onPick={(seed) => {
            setEntryOpen(false);
            setEditing({ ...EMPTY_FORM, ...seed, channel: channel || 'web', status: 'paused' });
          }}
        />
      )}
      {editing && (
        <EditModal
          editing={editing}
          setEditing={setEditing}
          availableVariables={availableVariables}
          fileInputRef={fileInputRef}
          onImageUpload={handleImageUpload}
          uploadImage={uploadImageReturnUrl}
          webBlocked={webBlocked}
          onDisplayBlocked={() => setShowDisplayBlock(true)}
          lineAssist={inappLine ? { text: inappLine } : null}
          onDone={() => { setEditing(null); setInappLine(null); void loadAll(); }}
        />
      )}

      {/* ★ 2026-09-26 R1-45 — A/B 변형 검토 */}
      {variantReview && (
        <VariantReviewModal
          parentId={variantReview.parentId}
          messageTitle={variantReview.title}
          authHeaders={authHeaders}
          onToast={(msg, type) => showToast(msg, { type })}
          onClose={() => setVariantReview(null)}
        />
      )}

      {/* ▼ 영역 12: 드릴다운 통계 모달 */}
      {drillMessageId && (
        <DrillDownModal
          loading={drillLoading}
          stats={drillStats}
          explain={drillExplain}
          explainLoading={drillExplainLoading}
          onRequestExplain={requestDrillExplain}
          viewers={drillViewers}
          messageTitle={messages.find((m) => m.id === drillMessageId)?.title || '인앱'}
          onClose={() => { drillIdRef.current = null; setDrillMessageId(null); setDrillStats(null); setDrillExplain(null); setDrillExplainLoading(false); setDrillViewers(null); }}
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
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white backdrop-blur-sm border-b border-slate-200 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-700" /> 자세히 분석: Top CTR 메시지</h3>
              <button onClick={() => setShowDetails(false)} className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              {topMessages.length === 0 ? (
                <div className="text-xs text-slate-400 py-8 text-center">데이터 누적 부족. impression 10건 이상 쌓이면 표시됩니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {topMessages.map((m) => (
                    <div key={m.messageId} className="flex items-center gap-3 text-xs bg-white rounded px-3 py-2.5">
                      <span className="text-slate-400 font-mono w-6">{m.rank}.</span>
                      <span className="flex-1 text-slate-700 truncate">{m.title}</span>
                      <span className="text-emerald-700 font-bold">{(m.ctr * 100).toFixed(2)}%</span>
                      <span className="text-slate-400">{m.impressions.toLocaleString()}건</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-slate-400 italic mt-3">Data source: 회사 30일 누적 impression ≥ 10건 메시지</div>
            </div>
          </div>
        </div>
      )}
    </ZoneFrame>
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
  // ★ 2026-07-21 함수형 업데이터 허용(useState dispatch 원형) — 업로드 완료 콜백의 널-세이프 병합에 필요
  setEditing: Dispatch<SetStateAction<Partial<MessageRow> | null>>;
  availableVariables: AvailableVariable[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  onImageUpload: (file: File) => void;
  uploadImage: (file: File) => Promise<string | null>;
  /** 웹 표시 가능성 게이트(표시할 곳 없으면 발행 차단 · 서버 게이트 이중 방어) */
  webBlocked: boolean;
  onDisplayBlocked: () => void;
  /** 편집기를 닫고 목록을 다시 읽는다 */
  onDone: () => void;
  /** ★ 2026-10-05 한 줄로 만든 메시지 — 완성도 줄 · 혜택 채우기 시트 */
  lineAssist?: { text: string } | null;
}

function EditModal({ editing, setEditing, availableVariables, fileInputRef, onImageUpload, uploadImage, webBlocked, onDisplayBlocked, onDone, lineAssist }: EditModalProps) {
  const [segmentCount, setSegmentCount] = useState<number | null>(null);
  const [segmentDesc, setSegmentDesc] = useState<string>('');
  const [extractOpen, setExtractOpen] = useState(false);
  // ★ 2026-07-07(2) 실고객 샘플 — 하드코딩 페르소나 영구 제거. 타겟 최상단 + 등급별 실고객을 백엔드에서 받아 치환.
  const [previewPeople, setPreviewPeople] = useState<Array<{ label: string; customer: Record<string, any>; is_sample?: boolean }>>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [brandAccent, setBrandAccent] = useState<string | null>(null);
  // ★ 2026-07-18 P2 — CTA 몰 상품 픽커: 대상 버튼 id (null = 닫힘). 인덱스 저장은 픽커 열린 사이
  //   버튼 삭제 시 다른 버튼을 덮어쓰는 이동 결함이 있어 id로 고정 (Codex C1)
  // ★ 2026-07-31 (Codex 1R ③) — 판별 가능한 상태로. 문자열 sentinel은 실제 버튼 id와 충돌할 수 있다.
  const [mallPickTarget, setMallPickTarget] = useState<{ kind: 'image' } | { kind: 'button'; id: string } | null>(null);
  // ★ 2026-07-18 P3 — 에셋 라이브러리 픽커 (이미지 재사용)
  const [assetPickOpen, setAssetPickOpen] = useState(false);
  const pickToast = useToast();
  const [activeTab, setActiveTab] = useState<'content' | 'design'>('content');
  // ★ 2026-07-22 테스트저장(영업용) — 담당 아이디에게만 노출. 웹·앱 실물을 실제 크기로 렌더해 PNG 저장(발송 아님·크레딧 무관).
  const testSaveUser = useAuthStore((s) => s.user);
  const canTestSave = ['hoyun', 'psy5868', 'mobile'].includes(testSaveUser?.loginId || '');
  const [captureOpen, setCaptureOpen] = useState(false);
  const webShotRef = useRef<HTMLDivElement>(null);
  const appShotRef = useRef<HTMLDivElement>(null);
  const [savingShot, setSavingShot] = useState<'web' | 'app' | null>(null);
  const saveShot = async (kind: 'web' | 'app') => {
    const node = kind === 'web' ? webShotRef.current : appShotRef.current;
    if (!node || savingShot) return;
    setSavingShot(kind);
    try {
      // cacheBust 미사용 — 이미 화면에 로드된 이미지를 재사용(외부 서명 URL에 쿼리 추가 시 403 회피). Codex M1.
      const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#0f172a' });
      const base = (editing.title || 'inapp').replace(/[^\w가-힣-]+/g, '_').slice(0, 40) || 'inapp';
      const a = document.createElement('a');
      a.download = `${base}_${kind === 'web' ? '웹' : '앱'}.png`;
      a.href = dataUrl;
      a.click();
      pickToast.success(`${kind === 'web' ? '웹' : '앱'} 이미지 저장 완료`);
    } catch {
      pickToast.error('이미지 저장 실패. 잠시 후 다시 시도해주세요');
    } finally {
      setSavingShot(null);
    }
  };
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

  // web 채널 허용 형태 밖(옛 배너 등)으로 저장된 메시지를 열면 모달로 자동 정규화 (서빙 WEB_OK 보정과 동일 기준)
  // ★ 2026-07-18 P1 — full_image 등재 필수: 빠지면 포스터형 메시지가 편집 진입만으로 center_modal로 바뀌어 저장된다 (Codex 지적)
  useEffect(() => {
    const WEB_OK = ['center_modal', 'slide_in', 'toast', 'floating_button', 'full_image'];
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
  // ★ 2026-07-17 앱(네이티브) 통합 계약 모달 — 단일 소스 = components/inapp/AppIntegrationContract
  const [showAppContract, setShowAppContract] = useState(false);
  // ★ 2026-09-29 인앱 만들기 개편 3차 — 정예 템플릿 = 기본 알림의 「문구 스타일」(재분류) · 적용은 비파괴(LESSONS_FRONTEND 67):
  //   블록이 있으면 블록은 두고 모양(형태·카드·테마·디자인)만 · 블록 없이 쓴 글이 있으면 글을 블록으로 옮긴 뒤(convertToBlocks · 글 보존) 모양 ·
  //   빈 메시지면 구성까지 채운다. 옛: 블록을 템플릿 블록으로 통교체(경고 창으로 넘김 = 설계 실패).
  const applyGolden = (g: GoldenInAppTemplate) => {
    const chTemplates = (editing.channel === 'app' ? CHANNEL_TEMPLATES.app : CHANNEL_TEMPLATES.web) as string[];
    const blocksNow = Array.isArray(editing.content_blocks) ? editing.content_blocks : [];
    const hasFlat = !!(String(editing.title || '').trim() || String(editing.body || '').trim() || editing.image_url || (editing.buttons || []).length > 0);
    const keep = blocksNow.length > 0 || hasFlat;
    const nextBlocks = blocksNow.length > 0
      ? blocksNow
      : hasFlat ? convertToBlocks(editing).content_blocks : JSON.parse(JSON.stringify(g.content_blocks));
    const d = { ...(editing.design || {}), ...(g.design || {}) };
    setEditing({
      ...editing,
      template: (chTemplates.includes(g.template) ? g.template : editing.template) as Template,
      card_style: g.card_style,
      theme: g.theme,
      design: Object.keys(d).length > 0 ? d : null,
      content_blocks: nextBlocks,
      ...(!keep && g.badge_text ? { badge_text: g.badge_text } : {}),
    });
    if (keep) pickToast.info('쓴 글은 그대로 두고 모양만 바꿨어요');
  };
  const pickGolden = (g: GoldenInAppTemplate) => applyGolden(g);

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

  // ════════════════════════════════════════════════════════════════════
  // ★ 2026-09-29 인앱 만들기 개편 — 전체 화면 편집기(설계서 §1-4 · §2)
  //   포스터 계열(이벤트 카드 · 배너 시트 · 포스터) = 왼쪽 장 목록 · 가운데 휴대폰 위 직접 편집 · 오른쪽 칸/장 패널.
  //   기본 알림 · 작게 알리기 = 지금의 내용·디자인 편집을 오른쪽 패널로 · 가운데 미리보기.
  //   저장 = 초안(멈춤) 자동 저장 · 요청 하나씩 순서대로 · 응답은 id 만 병합. 발행 = [발행] 확인 창 → 서버 게시 조건 CT · 과금.
  //   게시 중 메시지 = 자동 저장 없이 [반영](변형에 모양 전파는 서버 수정 CT 가 같은 트랜잭션에서).
  // ════════════════════════════════════════════════════════════════════
  const layoutKey: LayoutKey = layoutKeyOf(editing);
  const posterMode = isPosterLayout(layoutKey);
  const posterLayout: PosterLayout = posterMode ? (layoutKey as PosterLayout) : 'overlay';
  const slides: WsSlide[] = Array.isArray(editing.slides_ws) ? editing.slides_ws : [];
  const [active, setActive] = useState(0);
  const safeActive = Math.max(0, Math.min(active, Math.max(0, slides.length - 1)));
  const activeRef = useRef(safeActive);
  activeRef.current = safeActive;
  const [selField, setSelField] = useState<SheetEditKey | null>(null);
  const [pcView, setPcView] = useState(false);
  const [customerView, setCustomerView] = useState(false);
  const appLocked = isApp && posterMode && posterLayout !== 'overlay' && !APP_SHEET_LAYOUTS_UNLOCKED;
  // ★ 2026-09-29 (Harold 「이벤트 카드로 바꾸니 글자를 눌러도 편집 칸이 안 뜬다」) — 구버전 앱 모습은 버튼을 눌렀을 때만 켠다.
  //   옛: 앱 잠금(appLocked)이 켜지면 저절로 켜져, 새 모양을 고르자마자 휴대폰이 옛 포스터로 바뀌고 글자 편집이 막혔다. 모양을 바꾸면 다시 끈다.
  const [legacyApp, setLegacyApp] = useState(false);
  useEffect(() => { setLegacyApp(false); }, [posterLayout]);
  const [imgMenu, setImgMenu] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editorConfirm, setEditorConfirm] = useState<ConfirmState | null>(null);
  const isLive = editing.status === 'active' && !!editing.id;
  const wasPublished = !!editing.publish_charged;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // 열린 직후(작업본 만들기 · 채널 정규화)는 변경이 아니다 — 자동 저장·되돌리기 기준점
  const baselineRef = useRef(true);
  useEffect(() => { const t = window.setTimeout(() => { baselineRef.current = false; }, 700); return () => window.clearTimeout(t); }, []);
  // 포스터 계열 = 장 작업본으로 연다(첫 장 = flat · 저장된 장 · 기존 배지 = 장마다 라벨 · 장마다 색·크기 명시)
  useEffect(() => {
    if (posterMode && !Array.isArray(editing.slides_ws)) {
      baselineRef.current = true;
      setEditing((prev) => (prev ? { ...prev, slides_ws: slidesFromMessage(prev) } : prev));
      window.setTimeout(() => { baselineRef.current = false; }, 300);
    }
  }, [posterMode, editing.slides_ws]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 저장 요청 몸(편집 상태 → 서버 입력). 포스터 계열은 장 → flat 합성 · 상태·과금 표시는 넣지 않는다(호출부가 정한다). */
  const buildPayload = (m: Partial<MessageRow>): Record<string, any> => {
    const poster = m.template === 'full_image' && Array.isArray(m.slides_ws)
      ? messagePatchFromSlides(m.slides_ws as WsSlide[], resolvePosterLayout(m.design), m.design)
      : null;
    const base: Record<string, any> = { ...m, ...(poster || {}) };
    if (!poster) {
      // 블록 메시지 = 블록이 제목·본문 기준(DB title/body = headline/body 블록 · 옛 저장 규칙 그대로)
      const bl = Array.isArray(m.content_blocks) ? m.content_blocks : [];
      if (bl.length > 0) {
        const bt = (tp: string) => { const b = bl.find((x: any) => x?.type === tp); return b ? String(b.text || '').trim() : ''; };
        base.title = bt('headline') || String(m.title || '').trim();
        base.body = bt('body') || bt('headline') || String(m.body || '').trim();
      }
      delete base.poster_slides;
    }
    for (const k of ['slides_ws', 'stats', 'publish_charged', 'created_at', 'updated_at', 'draft', 'status', 'id', 'company_id', 'created_by']) delete base[k];
    return {
      ...base,
      position: m.template || m.position,
      backgroundColor: m.background_color,
      textColor: m.text_color,
      triggerEvent: m.trigger_event,
      displayFrequency: m.display_frequency,
      // ★ 2026-07-16 범용 보장 계약 — 앱 채널 = flat 이 진실(블록 저장 안 함)
      ...(m.channel === 'app' ? { content_blocks: [] } : {}),
    };
  };
  const keyOf = (m: Partial<MessageRow>) => JSON.stringify(buildPayload(m));
  const viewMsg: Partial<MessageRow> = posterMode && slides.length > 0
    ? { ...editing, ...(messagePatchFromSlides(slides, posterLayout, editing.design) as any) }
    : editing;

  // ───────── 되돌리기 · 다시(변경 묶음 = 0.5초) ─────────
  const pastRef = useRef<Partial<MessageRow>[]>([]);
  const futureRef = useRef<Partial<MessageRow>[]>([]);
  const burstBaseRef = useRef<Partial<MessageRow> | null>(null);
  const burstTimerRef = useRef<number | null>(null);
  const skipHistRef = useRef(false);
  const prevEditingRef = useRef(editing);
  const [, bumpHist] = useState(0);
  const commitBurst = () => {
    if (burstTimerRef.current) { window.clearTimeout(burstTimerRef.current); burstTimerRef.current = null; }
    const base = burstBaseRef.current;
    burstBaseRef.current = null;
    if (!base) return;
    pastRef.current.push(base);
    if (pastRef.current.length > 60) pastRef.current.shift();
    futureRef.current = [];
    bumpHist((n) => n + 1);
  };
  useEffect(() => {
    const prev = prevEditingRef.current;
    prevEditingRef.current = editing;
    if (prev === editing) return;
    if (skipHistRef.current || baselineRef.current) { skipHistRef.current = false; return; }
    if (!burstBaseRef.current) burstBaseRef.current = prev;
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(commitBurst, 500);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = (snap: Partial<MessageRow>) => {
    skipHistRef.current = true;
    const cur = editingRef.current;
    // id · 상태 · 과금 이력은 서버 사실 — 되돌리지 않는다
    setEditing({ ...snap, id: cur.id || snap.id, status: cur.status, publish_charged: cur.publish_charged });
    setSelField(null);
    bumpHist((n) => n + 1);
  };
  const undo = () => { commitBurst(); const p = pastRef.current.pop(); if (!p) return; futureRef.current.push(editingRef.current); restore(p); };
  const redo = () => { commitBurst(); const f = futureRef.current.pop(); if (!f) return; pastRef.current.push(editingRef.current); restore(f); };

  // ───────── 초안 자동 저장(요청 하나씩 순서대로 · 응답은 id 만 병합 · 설계서 §1-4) ─────────
  const idRef = useRef<string | null>(editing.id || null);
  useEffect(() => { if (editing.id) idRef.current = editing.id; }, [editing.id]);
  const savedKeyRef = useRef<string | null>(null);
  const savedAudienceRef = useRef<string>(JSON.stringify(editing.audience_filter ?? null));
  const [saveInfo, setSaveInfo] = useState<{ tone: SaveTone; text: string }>({ tone: 'saved', text: editing.id ? (editing.status === 'active' ? '게시 중' : '저장됨') : '새 초안 · 고치면 자동 저장' });
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const againRef = useRef(false);
  // 게시 요청을 보내는 동안 · 보낸 뒤에는 초안 저장을 새로 시작하지 않는다(늦은 초안 저장이 게시를 멈춤으로 되돌리지 않게 · 서버도 409 로 거절)
  const saveLockRef = useRef(false);
  const putAudience = async (id: string, snap: Partial<MessageRow>) => {
    const aud = JSON.stringify(snap.audience_filter ?? null);
    if (aud === savedAudienceRef.current) return;
    await fetch(`/api/cdp/inapp/${id}/audience-filter`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ filter: snap.audience_filter || null }) }).catch(() => {});
    savedAudienceRef.current = aud;
  };
  const saveDraftNow = async (): Promise<boolean> => {
    if (saveLockRef.current) return true;
    if (inflightRef.current) { againRef.current = true; return inflightRef.current; }
    const run = (async (): Promise<boolean> => {
      const snap = editingRef.current;
      const key = keyOf(snap);
      const id = snap.id || idRef.current;
      if (id && key === savedKeyRef.current) { await putAudience(id, snap); return true; }
      setSaveInfo({ tone: 'saving', text: '저장 중' });
      try {
        const res = await fetch(id ? `/api/cdp/inapp/${id}` : '/api/cdp/inapp', {
          method: id ? 'PUT' : 'POST', headers: authHeaders(),
          body: JSON.stringify({ ...buildPayload(snap), status: 'paused', draft: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          setSaveInfo({ tone: 'error', text: data?.code === 'DB_MIGRATION_PENDING' ? '기능 준비 중 · 잠시 후 다시' : (data?.error || '저장하지 못했어요') });
          return false;
        }
        const newId: string | null = id || data.message?.id || null;
        if (newId && !id) {
          idRef.current = newId;
          skipHistRef.current = true;
          setEditing((prev) => (prev ? { ...prev, id: newId } : prev));
        }
        if (newId) await putAudience(newId, snap);
        savedKeyRef.current = key;
        setSaveInfo({ tone: 'saved', text: '자동 저장됨' });
        return true;
      } catch {
        setSaveInfo({ tone: 'error', text: '저장하지 못했어요 · 연결 확인' });
        return false;
      }
    })();
    inflightRef.current = run;
    const ok = await run;
    inflightRef.current = null;
    if (againRef.current) { againRef.current = false; return saveDraftNow(); }
    return ok;
  };
  /** 게시 직전 — 진행 중 저장을 기다리고 마지막 변경까지 초안으로 저장해 둔다(id 확보 · 순서 보장). */
  const flushDraft = async (): Promise<boolean> => {
    for (let i = 0; i < 5; i += 1) {
      if (inflightRef.current) { await inflightRef.current; continue; }
      const id = editingRef.current.id || idRef.current;
      if (id && keyOf(editingRef.current) === savedKeyRef.current) return true;
      if (!(await saveDraftNow())) return false;
    }
    return !inflightRef.current && !!(editingRef.current.id || idRef.current);
  };
  useEffect(() => {
    const key = keyOf(editing);
    if (savedKeyRef.current === null || baselineRef.current) { savedKeyRef.current = key; return; }
    if (key === savedKeyRef.current) {
      if (isLive) setSaveInfo({ tone: 'saved', text: '게시 중' });
      return;
    }
    if (isLive) { setSaveInfo({ tone: 'manual', text: '게시 중 · [반영]을 눌러야 고객 화면이 바뀝니다' }); return; }
    setSaveInfo({ tone: 'dirty', text: '고치는 중' });
    const t = window.setTimeout(() => { void saveDraftNow(); }, 1200);
    return () => window.clearTimeout(t);
  }, [editing, isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────── 장 다루기(장마다 고정 키로 — 늦게 끝난 업로드가 다른 장에 들어가지 않게) ─────────
  const setSlides = (next: WsSlide[]) => setEditing((prev) => (prev ? { ...prev, slides_ws: next } : prev));
  const patchSlideKey = (k: string, patch: Partial<WsSlide>) => setEditing((prev) => (prev
    ? { ...prev, slides_ws: (prev.slides_ws || []).map((sl) => (sl._k === k ? { ...sl, ...patch } : sl)) }
    : prev));
  const curKey = slides[safeActive]?._k;
  const changeField = (key: SheetEditKey, v: string) => {
    if (!curKey) return;
    setEditing((prev) => (prev ? { ...prev, slides_ws: (prev.slides_ws || []).map((sl) => (sl._k === curKey ? writeField(sl, key, v) : sl)) } : prev));
  };
  const addSlide = () => {
    if (slides.length >= MAX_SLIDES) return;
    const ns = duplicateSlide(slides[safeActive], posterLayout, editing.design);
    setSlides([...slides.slice(0, safeActive + 1), ns, ...slides.slice(safeActive + 1)]);
    setActive(safeActive + 1);
    setSelField(null);
  };
  const removeSlide = () => {
    if (slides.length <= 1) return;
    setSlides(slides.filter((_, i) => i !== safeActive));
    setActive(Math.max(0, safeActive - 1));
    setSelField(null);
    pickToast.info('장을 뺐어요. 되돌리려면 Ctrl+Z');
  };
  // 사진이 들어오면: 첫 장 = 지금 장 · 나머지 = 지금 장 모양을 따라 뒤에 새 장(최대 5장 · 설계서 §2)
  const takeImages = (urls: string[], meta?: { linkUrl?: string | null }) => {
    let dropped = 0;
    setEditing((prev) => {
      if (!prev) return prev;
      const ss = [...(prev.slides_ws || [])];
      if (ss.length === 0) return prev;
      let at = Math.min(activeRef.current, ss.length - 1);
      const layoutNow = resolvePosterLayout(prev.design);
      urls.forEach((u, n) => {
        if (n === 0) {
          ss[at] = { ...ss[at], image_url: u, ...(meta?.linkUrl && !ss[at].link_url ? { link_url: meta.linkUrl } : {}) };
          return;
        }
        if (ss.length >= MAX_SLIDES) { dropped += 1; return; }
        ss.splice(at + 1, 0, { ...duplicateSlide(ss[at], layoutNow, prev.design), image_url: u });
        at += 1;
      });
      return { ...prev, slides_ws: ss };
    });
    if (urls.length > 1) {
      window.setTimeout(() => {
        pickToast.success(dropped > 0 ? `사진 ${urls.length - dropped}장을 넣었어요. 최대 ${MAX_SLIDES}장이라 ${dropped}장은 빠졌어요.` : `사진 ${urls.length}장으로 장을 만들었어요`);
      }, 0);
    }
  };
  const images = useImageSources({ uploadImage, onImages: takeImages });

  // ───────── 모양 바꾸기(글 · 사진은 두고 모양만 · 되돌리기 가능 · 설계서 §2 회의론자 7) ─────────
  const switchLayout = (k: LayoutKey, opts?: { addSlide?: boolean }) => {
    commitBurst();
    setEditing((prev) => {
      if (!prev) return prev;
      const fromKey = layoutKeyOf(prev);
      if (isPosterLayout(k)) {
        const d0: Record<string, any> = { ...(prev.design || {}) };
        if (k === 'overlay') delete d0.poster_layout; else d0.poster_layout = k;
        if (!d0.dismiss_mode) d0.dismiss_mode = 'snooze_day';
        let ss: WsSlide[];
        if (isPosterLayout(fromKey) && Array.isArray(prev.slides_ws)) {
          ss = restyleSlides(prev.slides_ws, k, d0);
        } else {
          // 기본 알림 → 크게 보여 주기: 글 · 사진 · 첫 버튼을 첫 장으로(블록이면 블록에서 꺼낸다)
          const bl = Array.isArray(prev.content_blocks) ? prev.content_blocks : [];
          const flat = bl.length > 0 ? composeFlatFromBlocksFE(bl) : null;
          const src: Partial<MessageRow> = {
            ...prev,
            ...(flat ? { title: flat.title || prev.title, body: flat.body || prev.body, image_url: flat.imageUrl || prev.image_url, buttons: flat.buttons.length > 0 ? flat.buttons : prev.buttons, badge_text: flat.badgeText || prev.badge_text } : {}),
            poster_slides: [],
            design: d0,
          };
          ss = restyleSlides(slidesFromMessage(src), k, d0);
        }
        if (opts?.addSlide && ss.length < MAX_SLIDES) ss = [...ss, duplicateSlide(ss[ss.length - 1], k, d0)];
        return { ...prev, template: 'full_image', design: d0, slides_ws: ss, content_blocks: [] };
      }
      if (isPosterLayout(fromKey) && Array.isArray(prev.slides_ws)) {
        // 크게 보여 주기 → 기본 알림 · 작게 알리기: 첫 장이 글 · 사진 · 버튼으로(나머지 장은 되돌리기로 복구)
        const pt = messagePatchFromSlides(prev.slides_ws, fromKey as PosterLayout, prev.design);
        const d1: Record<string, any> = { ...(pt.design || {}) };
        delete d1.poster_layout;
        return {
          ...prev,
          template: k as Template,
          title: pt.title,
          body: pt.body || pt.title,
          image_url: pt.image_url,
          buttons: pt.buttons,
          badge_text: pt.badge_text || prev.badge_text,
          image_link_url: pt.image_link_url,
          design: Object.keys(d1).length > 0 ? d1 : null,
          slides_ws: undefined,
          poster_slides: [],
        };
      }
      return { ...prev, template: k as Template };
    });
    setActive(opts?.addSlide ? 1 : 0);
    setSelField(null);
    pickToast.info('모양을 바꿨어요. 마음에 안 들면 되돌리기(Ctrl+Z)');
  };
  const askConvertToSlides = () => setEditorConfirm({
    mode: 'info',
    title: '크게 보여 주기로 바꿀까요?',
    description: '장을 더하려면 이벤트 카드 모양으로 바꿉니다. 지금 쓴 글 · 사진 · 첫 버튼이 첫 장으로 옮겨지고 둘째 장이 생깁니다. 되돌리기(Ctrl+Z)로 돌아올 수 있어요.',
    confirmLabel: '바꾸기',
    onConfirm: () => switchLayout('event_card', { addSlide: true }),
  });

  // ───────── ★ 2026-10-05 한줄로 시그니처 · 완성도 줄(한 줄로 만든 메시지만) ─────────
  //   보내기 전에 N곳 = 편집기 발행 검사(publishDefectOf · 서버가 다시 본다)와 같은 판정 + 혜택 자리.
  //   혜택 자리는 시트에서 값만 받아 그 자리에 넣는다(0크레딧 · 되돌리기 기록). 포스터 장은 장 편집에서 고친다.
  const [lineBarOn, setLineBarOn] = useState(true);
  const [lineSheet, setLineSheet] = useState(false);
  const [lineValues, setLineValues] = useState<LineFactsValues>({});
  const lineAutoOpened = useRef(false);
  const lineBenefitSlots = lineAssist ? countSlots(stringsDeep({ blocks: editing.content_blocks, title: editing.title, body: editing.body }), 'benefit') : 0;
  const lineDefect = lineAssist ? publishDefectOf(buildPayload(editing)) : null;
  const lineCanFill = lineBenefitSlots > 0 && !posterMode;
  const lineItems: FixItem[] = (() => {
    if (!lineAssist) return [];
    const out: FixItem[] = [];
    if (lineBenefitSlots > 0) out.push({ kind: 'must', title: `혜택 자리 ${lineBenefitSlots}곳이 비었어요`, sub: lineCanFill ? '적어 주시면 그 자리에 그대로 넣어요 · 무료' : '장 편집에서 그 자리를 고쳐 주세요', action: lineCanFill ? '채우기' : undefined });
    else if (lineDefect) out.push({ kind: 'must', title: lineDefect.message });
    if (!lineDefect && lineBenefitSlots === 0) out.push({ kind: 'ok', title: '보낼 준비가 됐어요' });
    return out;
  })();
  useEffect(() => {
    if (!lineAssist || lineAutoOpened.current) return;
    lineAutoOpened.current = true;
    if (lineCanFill) setLineSheet(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const applyLineBenefit = () => {
    const v = typedBenefit(lineValues);
    if (!v) return;
    setEditing((prev) => (prev ? {
      ...prev,
      content_blocks: fillSlotsDeep(prev.content_blocks, 'benefit', v),
      title: typeof prev.title === 'string' ? fillSlots(prev.title, 'benefit', v) : prev.title,
      body: typeof prev.body === 'string' ? fillSlots(prev.body, 'benefit', v) : prev.body,
    } : prev));
    setLineSheet(false);
    setLineValues({});
    pickToast.success('적어 주신 그대로 넣었어요');
  };

  // ───────── 발행 · 반영 ─────────
  const checkPublish = (): boolean => {
    const d = publishDefectOf(buildPayload(editingRef.current));
    if (!d) return true;
    pickToast.warning(d.message);
    if (posterMode && typeof d.slide === 'number') {
      setActive(d.slide);
      setSelField(d.field === 'title' ? 'title' : null);
    } else {
      setActiveTab('content');
    }
    setDrawerOpen(false);
    return false;
  };
  const handleServerError = (data: any) => {
    if (data?.code === 'INAPP_NOT_PUBLISHABLE' && data.defect) {
      pickToast.warning(String(data.defect.message || '발행 조건을 확인해 주세요'));
      if (posterMode && typeof data.defect.slide === 'number') setActive(data.defect.slide);
      setDrawerOpen(false);
      return;
    }
    if (data?.code === 'INAPP_DISPLAY_UNAVAILABLE') { onDisplayBlocked(); return; }
    if (data?.code === 'INSUFFICIENT_CREDIT') { pickToast.error(data.error || '크레딧이 부족합니다.'); return; }
    if (data?.code === 'DB_MIGRATION_PENDING') { pickToast.warning('기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    pickToast.error(data?.error || '저장하지 못했어요');
  };
  const doPublish = async () => {
    setPublishing(true);
    try {
      commitBurst();
      if (!(await flushDraft())) { pickToast.error('초안을 저장하지 못해 발행하지 않았어요. 잠시 후 다시 시도해 주세요.'); return; }
      const id = idRef.current || editingRef.current.id;
      if (!id) return;
      const snap = editingRef.current;
      saveLockRef.current = true;
      const res = await fetch(`/api/cdp/inapp/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...buildPayload(snap), status: 'active' }) }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : { error: '연결이 끊겨 발행 여부를 확인하지 못했어요. 목록에서 상태를 확인해 주세요.' };
      if (data?.success) {
        pickToast.success(wasPublished ? '다시 게시했어요' : '발행했어요. 고객 화면에 곧 보입니다');
        setDrawerOpen(false);
        onDone();
        return;
      }
      saveLockRef.current = false;
      handleServerError(data);
    } finally {
      setPublishing(false);
    }
  };
  const confirmPublish = () => {
    if (!checkPublish()) return;
    if ((editing.channel === 'app' ? 'app' : 'web') === 'web' && webBlocked) { onDisplayBlocked(); return; }
    if (!wasPublished) setCreditOpen(true);
    else void doPublish();
  };
  const applyLive = async () => {
    if (!checkPublish()) return;
    setPublishing(true);
    try {
      commitBurst();
      const snap = editingRef.current;
      if (!snap.id) return;
      const res = await fetch(`/api/cdp/inapp/${snap.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...buildPayload(snap), status: 'active' }) });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        await putAudience(snap.id, snap);
        savedKeyRef.current = keyOf(snap);
        setSaveInfo({ tone: 'saved', text: '게시 중 · 반영됨' });
        pickToast.success('게시 중인 메시지에 반영했어요');
        return;
      }
      handleServerError(data);
    } finally {
      setPublishing(false);
    }
  };
  const pauseLive = () => setEditorConfirm({
    mode: 'warning',
    title: '게시를 멈출까요?',
    description: '고객 화면에서 바로 내려갑니다. 멈춘 동안 고친 내용은 자동 저장되고, 다시 게시할 때는 크레딧이 들지 않습니다.',
    confirmLabel: '멈추기',
    onConfirm: async () => {
      if (!editing.id) return;
      const res = await fetch(`/api/cdp/inapp/${editing.id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status: 'paused' }) });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        skipHistRef.current = true;
        setEditing((prev) => (prev ? { ...prev, status: 'paused' } : prev));
        setSaveInfo({ tone: 'saved', text: '멈춤 · 고치면 자동 저장' });
        pickToast.success('게시를 멈췄어요');
      } else {
        handleServerError(data);
      }
    },
  });
  const leave = async () => {
    commitBurst();
    const dirty = keyOf(editingRef.current) !== savedKeyRef.current;
    if (isLive && dirty) {
      setEditorConfirm({ mode: 'warning', title: '반영하지 않은 변경이 있어요', description: '게시 중인 메시지는 [반영]을 눌러야 고객 화면이 바뀝니다. 나가면 이번 변경은 사라집니다.', confirmLabel: '나가기', onConfirm: () => onDone() });
      return;
    }
    if (!isLive && dirty) {
      const ok = await saveDraftNow();
      if (!ok) {
        setEditorConfirm({ mode: 'danger', title: '저장하지 못했어요', description: '지금 나가면 마지막 변경이 사라집니다.', confirmLabel: '그래도 나가기', onConfirm: () => onDone() });
        return;
      }
    }
    onDone();
  };

  // 키보드 — Ctrl+Z 되돌리기 · Ctrl+Shift+Z 다시 · ←/→ 장 넘기기(입력 중 · 확인 창 열림 = 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (typing || !posterMode || slides.length < 2 || drawerOpen || imgMenu || editorConfirm || creditOpen) return;
      if (e.key === 'ArrowRight') setActive((a) => (a + 1) % slides.length);
      if (e.key === 'ArrowLeft') setActive((a) => (a - 1 + slides.length) % slides.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const variableChips = availableVariables.map((v) => ({ key: v.key, label: v.label }));
  const sendLabel = isLive ? '반영' : wasPublished ? '다시 게시' : '발행';
  // 머리 제목 = 저장 제목의 기준 칸(포스터 = 첫 장 제목 · 블록 = 첫 헤드라인 블록 · 그 밖 = 제목)
  const headlineIdx = !posterMode ? blocks.findIndex((b: any) => b?.type === 'headline') : -1;
  const docTitle = (posterMode
    ? String(slides[0]?.title || '')
    : headlineIdx >= 0 ? String(blocks[headlineIdx]?.text || '') : String(editing.title || '')
  ).replace(/\n/g, ' ') || '제목 없는 인앱';
  const onTitleEdit = (v: string) => {
    if (posterMode && slides[0]) setSlides(slides.map((sl, i) => (i === 0 ? { ...sl, title: v } : sl)));
    else if (headlineIdx >= 0) updateField('content_blocks', blocks.map((b: any, i: number) => (i === headlineIdx ? { ...b, text: v } : b)));
    else updateField('title', v);
  };
  // ★ 2026-09-30 편집기 머리 = 남색 띠 → 머리 안 보조 버튼 값은 make-ui(MK_HEAD_*)가 소유
  const toggleBtn = (on: boolean) => `hidden md:!inline-flex ${on ? MK_HEAD_BTN_ON : MK_HEAD_BTN}`;

  const channelSwitch = (
    <div className={`hidden md:inline-flex ${MK_HEAD_SEG}`} role="tablist" aria-label="채널">
      {(['web', 'app'] as const).map((c) => {
        const on = (editing.channel === 'app' ? 'app' : 'web') === c;
        const can = on || !wasPublished;
        return (
          <button key={c} type="button" role="tab" aria-selected={on} disabled={!can}
            onClick={() => { if (!on && can) setEditing((prev) => (prev ? { ...prev, channel: c } : prev)); }}
            title={!can ? '게시한 메시지는 채널을 바꿀 수 없어요' : undefined}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold ${on ? MK_HEAD_SEG_ON : can ? MK_HEAD_SEG_OFF : MK_HEAD_SEG_DISABLED}`}>
            {c === 'web' ? <Globe className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}{c === 'web' ? '웹' : '앱'}
          </button>
        );
      })}
    </div>
  );

  const extraHeader = (
    <div className="flex items-center gap-1.5 shrink-0">
      {posterMode && (
        <button type="button" onClick={() => setCustomerView((v) => !v)} className={toggleBtn(customerView)} title="이름 같은 값을 실제 고객 값으로 바꿔 봅니다">고객으로 보기</button>
      )}
      {posterMode && isApp && posterLayout !== 'overlay' && (
        <button type="button" onClick={() => setLegacyApp((v) => !v)} className={toggleBtn(legacyApp)} title="새 모양을 모르는 이전 앱이 그리는 모습">구버전 앱 모습</button>
      )}
      {posterMode && !isApp && (
        <button type="button" onClick={() => setPcView((v) => !v)} className={toggleBtn(pcView)}>PC</button>
      )}
      <button type="button" onClick={() => setDrawerOpen(true)} className={MK_HEAD_BTN}>
        <Target className="w-3.5 h-3.5" /><span className="hidden sm:inline">타겟·시점</span>
      </button>
      {canTestSave && (
        <button type="button" onClick={() => setCaptureOpen(true)} className={toggleBtn(false)} title="영업 담당자에게 보낼 웹·앱 실물 이미지를 저장합니다 (발송 아님)"><Download className="w-3.5 h-3.5" />테스트저장</button>
      )}
      {isLive && (
        <button type="button" onClick={pauseLive} className={toggleBtn(false)}>게시 멈춤</button>
      )}
    </div>
  );

  // ★ 2026-09-29 (Harold 「화면이 너무 작다」) — 위 알림 두 줄을 치우고 짧은 알림으로 왼쪽 칸 아래에 둔다(가운데 휴대폰이 높이를 다 쓴다).
  //   게시 중은 제목 옆 표시가 이미 있고, 혜택 자리 알림은 기본 알림 오른쪽 칸 맨 위로 옮긴다.
  const railNotes = (isLive || isApp || appLocked || (posterMode && legacyApp)) ? (
    <div className="mt-4 space-y-2">
      {posterMode && legacyApp && (
        <div className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          <b>구버전 앱 모습을 보는 중</b> · 이때는 글자를 고칠 수 없어요. 편집하려면 위 「구버전 앱 모습」을 끄세요.
        </div>
      )}
      {isLive && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] leading-relaxed text-emerald-900">
          <b>게시 중</b> · 고친 내용은 오른쪽 위 [반영]으로 적용돼요. A/B 변형에는 모양 · 장이 함께 가고 문안은 변형 것 그대로예요.
        </div>
      )}
      {isApp && (
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11.5px] leading-relaxed text-cyan-900">
          <b>앱이 직접 그리는 채널</b> · 앱이 통합 계약을 구현해야 설정한 그대로 나와요.{' '}
          <button type="button" onClick={() => setShowAppContract(true)} className="underline underline-offset-2 font-semibold text-cyan-800 hover:text-slate-900">계약 보기</button>
        </div>
      )}
      {appLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
          <b>앱 업데이트 뒤에 보이는 모양</b> · 이전 앱은 같은 내용을 포스터 모양 · 「다시 보지 않기」로 보여요. 위 「구버전 앱 모습」으로 확인하세요.
        </div>
      )}
    </div>
  ) : null;
  const placeholderNote = !posterMode && hasPlaceholder ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span><b>혜택 안내 자리</b>가 남아 있어요. 회사 정책에 맞게 직접 작성해야 발행됩니다(AI는 구체 혜택을 임의로 쓰지 않습니다).</span>
    </div>
  ) : null;

  const left = posterMode ? (
    <SlideRail
      layout={posterLayout}
      slides={slides}
      active={safeActive}
      onActive={(i) => { setActive(i); setSelField(null); }}
      onReorder={(from, to) => { setSlides(arrayMove(slides, from, to)); setActive(to); }}
      onAdd={addSlide}
      onDropFiles={(f) => { void images.uploadFiles(f); }}
      busy={images.busy}
      top={<div className="mb-4"><LayoutSwitcher channel={isApp ? 'app' : 'web'} current={layoutKey} onPick={(k) => switchLayout(k)} /></div>}
      notes={railNotes}
    />
  ) : (
    <div className="space-y-4">
      <LayoutSwitcher channel={isApp ? 'app' : 'web'} current={layoutKey} onPick={(k) => switchLayout(k)} />
      <div>
        <div className="flex items-baseline gap-2 px-1 mb-3"><b className="text-[13.5px] text-slate-900">장 1/1</b><span className="text-[11px] text-slate-400">한 장짜리 모양</span></div>
        <div className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2.5">
          <b className="block text-[13px] text-slate-900 truncate">{String(editing.title || '제목 없음').replace(/%이름%/g, '(이름)')}</b>
          <span className="block text-[11.5px] text-slate-500 mt-0.5">{editing.image_url ? '사진 있음' : '사진 없음'}</span>
        </div>
        <button type="button" onClick={askConvertToSlides}
          className="mt-2.5 w-full h-11 rounded-xl border border-dashed border-slate-300 text-[13px] font-semibold text-slate-700 hover:text-slate-900 hover:border-violet-300 inline-flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />장 추가 → 크게 보여 주기로 바꾸기
        </button>
        <p className="text-[11.5px] text-slate-400 mt-2 px-1 leading-relaxed">좌우로 넘기는 여러 장이 필요하면 크게 보여 주기로 바꾸세요. 글 · 사진 · 첫 버튼이 첫 장으로 옮겨집니다.</p>
        {railNotes}
      </div>
    </div>
  );

  const renderSample = (t: string) => replaceVars(t, sampleCustomer);
  // 「고객으로 보기」가 꺼져 있으면 원문 — 넣을 수 있는 값은 ‹이름› 모양으로 보여 준다(칸 안 원문은 그대로 · 설계서 §2)
  const varLabel = new Map(availableVariables.map((v) => [v.key.replace(/\s+/g, ''), v.label]));
  const renderTokens = (t: string) => String(t || '')
    .replace(/\{\{\s*customer\.([a-zA-Z_]+)[^}]*\}\}/g, (m0, name) => `‹${varLabel.get(`{{customer.${name}}}`) || name}›`)
    .replace(/%([가-힣A-Za-z_]{1,12})%/g, '‹$1›');
  const center = posterMode ? (
    slides.length > 0 ? (
      <PosterStage
        layout={posterLayout}
        slides={slides}
        design={editing.design}
        badge={null}
        active={safeActive}
        onActive={(i) => { setActive(i); setSelField(null); }}
        channel={isApp ? 'app' : 'web'}
        pc={pcView}
        legacyApp={legacyApp}
        renderText={customerView ? renderSample : renderTokens}
        selected={selField}
        onSelect={setSelField}
        onChangeField={changeField}
        onImagePick={() => setImgMenu(true)}
        onImageDrop={(f) => { void images.uploadFiles(f); }}
        variables={variableChips}
        busyImage={images.busy}
      />
    ) : (
      <div className="flex-1 flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
    )
  ) : (
    <div className="flex-1 min-h-0 overflow-y-auto mk-scroll space-y-3 max-w-[520px] w-full mx-auto">
            {editing.channel === 'app' && (
              <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-[11px] text-sky-800 flex items-start gap-1.5">
                <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>아래 미리보기 = <strong>앱 실렌더와 동일 요소</strong>(이미지·배지·제목·본문·버튼)만 표시. 만든 그대로 앱에 뜹니다. (앱 SDK 연동 필요)</span>
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
                        ? 'bg-emerald-100 border border-emerald-300 text-slate-900'
                        : 'bg-violet-100 border border-violet-300 text-slate-900'
                      : 'bg-white border border-slate-200 text-slate-500'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-400">
              {samplePerson ? (
                <>
                  샘플: {String(sampleCustomer.name || '고객')} · {String(sampleCustomer.grade || '-')} · {Number(sampleCustomer.points || 0).toLocaleString()}P
                  {samplePerson.is_sample
                    ? <span className="text-amber-700"> · 가상 예시. 고객 DB에 데이터가 쌓이면 실제 고객으로 바뀝니다</span>
                    : <span className="text-emerald-700"> · 실제 고객 DB{samplePerson.label === '타겟' ? ' (타겟 조건 최상단 고객)' : ''}</span>}
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
                design={editing.design}
                posterSlides={assemblePosterSlides(editing)}
                replaceVars={(t) => replaceVars(t, sampleCustomer)}
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
              posterSlides={assemblePosterSlides(editing)}
              replaceVars={(t) => replaceVars(t, sampleCustomer)}
            />
            )}
    </div>
  );

  const right = posterMode ? (
    <SlidePanel
      layout={posterLayout}
      slides={slides}
      active={safeActive}
      design={editing.design}
      selected={selField}
      onSelect={setSelField}
      onPatchSlide={(patch) => { if (curKey) patchSlideKey(curKey, patch); }}
      onRemoveSlide={removeSlide}
      onDesign={setDesign}
      images={images}
      variables={variableChips}
      onInsertVar={(key, token) => changeField(key, (readField(slides[safeActive], key) + token).slice(0, FIELD_MAX[key]))}
    />
  ) : (
    <div className="space-y-5">
      {placeholderNote}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="편집 탭">
        {([['content', '내용', Edit2], ['design', '디자인', Wand2]] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold ${activeTab === key ? 'bg-violet-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>
            {/* 탭 내용: 제목 · 본문 · 뱃지 */}
            <div className={activeTab === 'content' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Edit2 className="w-3 h-3" /> 내용
              </h4>
              {!hasBlocks && (
                <input
                  type="text"
                  value={editing.title || ''}
                  onChange={(e) => updateField('title', e.target.value)}
                  placeholder="메시지 제목 (20자 안, 변수 X)"
                  className="w-full px-3 py-2 mb-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300"
                  maxLength={100}
                />
              )}
              {hasBlocks ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5"><Layers className="w-3 h-3" /> 블록 구성</span>
                    <button onClick={() => updateField('content_blocks', [])} className="text-[10px] text-slate-400 hover:text-slate-600">단순 폼으로</button>
                  </div>
                  <BlockComposer blocks={blocks} onChange={(b) => updateField('content_blocks', b)} uploadImage={uploadImage} template={(editing.template || '') as string} cardStyle={editing.card_style as string | undefined} />
                </div>
              ) : (
                <>
                  {/* ★ 2026-07-19 (Harold) — 포스터형 본문은 이미지 위 짧은 문구: 입력창 축소 + 스타일 인라인 */}
                  <textarea
                    value={editing.body || ''}
                    onChange={(e) => updateField('body', e.target.value)}
                    placeholder={editing.template === 'full_image' ? '이미지 위에 얹는 짧은 문구 1~3줄. 길면 이미지 밖으로 잘려 보일 수 있어요' : '짧고 강렬하게 한두 문장. 혜택 부분은 [혜택 안내: 직접 작성해주세요] placeholder 사용'}
                    className={`w-full px-3 py-2 mb-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 resize-y ${editing.template === 'full_image' ? 'h-16' : 'h-24'} focus:outline-none focus:border-violet-300`}
                    maxLength={300}
                  />
                  <input
                    type="text"
                    value={editing.badge_text || ''}
                    onChange={(e) => updateField('badge_text', e.target.value)}
                    placeholder="뱃지 (선택, 8자 안: NEW · VIP · 오랜만이에요)"
                    className="w-full px-3 py-2 mb-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300"
                    maxLength={20}
                  />
                  {/* ★ 2026-07-18 정정 — 웹 기존 UX 원복(신규에서도 블록 전환 가능). 포스터형만 flat 전용이라 숨김 유지 */}
                  {!isApp && editing.template !== 'full_image' && (
                    <button
                      onClick={() => { const c = convertToBlocks(editing); setEditing({ ...editing, ...c }); }}
                      className="w-full text-xs text-violet-900 bg-gradient-to-r from-violet-50 to-fuchsia-50 hover:from-violet-50 hover:to-fuchsia-50 border border-violet-200 rounded-lg py-2 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> 블록 에디터로 전환 (모던 메시지, 권장)
                    </button>
                  )}
                  {isApp && (
                    <div className="text-[10px] text-slate-400 bg-white border border-slate-200 rounded-lg px-3 py-2">
                      앱 인앱은 위 보장 요소(제목·본문·이미지·버튼·배지)가 그대로 앱에 표시됩니다. 미리보기와 실물이 1:1로 일치합니다.
                    </div>
                  )}
                </>
              )}
              {/* ★ 2026-07-17 텍스트 정렬 (좌/중/우) — 제목·본문. 웹·앱·블록·flat 전부 공통 노출 */}
              <div className="mt-3">
                <label className="text-[10px] text-slate-500 block mb-1.5">텍스트 정렬</label>
                <div className="flex gap-1.5">
                  {([['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] as const).map(([v, label]) => {
                    const cur = String(editing.design?.text_align || 'left');
                    return (
                      <button
                        key={v}
                        onClick={() => setDesign({ text_align: v === 'left' ? null : v })}
                        className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
                      >{label}</button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ★ 2026-07-14 디자인 4.0 — 정예 템플릿 10종 (목적×스토리 구조 — 서버 컴파일. 블록 기반 = 웹 전용)
                ★ 2026-07-18 P1 (Harold 확정) — 테마 축 정리로 신규 UI 비노출. 데이터·렌더는 무접촉(기존 발행물 회귀 0) */}
            {SHOW_ELITE_TEMPLATES && eliteTemplates.length > 0 && !isApp && (
              <div className={activeTab === 'design' ? 'mb-5' : 'hidden'}>
                <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-700" /> 문구 스타일: 목적으로 고르세요
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {eliteTemplates.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => pickGolden(g)}
                      className="rounded-xl border border-amber-200 bg-white hover:bg-white hover:border-amber-300 p-2 text-left transition-colors"
                      title={g.difference || ''}
                    >
                      <span className="flex h-7 rounded-lg overflow-hidden border border-slate-200">
                        {g.swatches.map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
                      </span>
                      <span className="block text-[11px] font-bold mt-1.5 text-slate-700">{g.label}</span>
                      <span className="block text-[9px] text-slate-400 mt-0.5">{g.hint}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1.5">쓴 글이 있으면 글은 두고 모양(형태·테마·서체)만 입힙니다. 빈 메시지면 구성까지 채웁니다. 혜택 문구는 직접 작성해야 발행됩니다.</div>
              </div>
            )}

            {/* ★ 2026-07-14 Harold 지시 — 옛 골든 12종 노출 제거(정예 10종만 유지, 위 그리드) */}

            {/* 탭 디자인: 형태(디자인) + 색상 + 강조색 (블록 모드) */}
            <div className={activeTab === 'design' && hasBlocks ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-fuchsia-700" /> 디자인 (형태 4종)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {CARD_STYLE_OPTIONS.map((cs) => {
                  const active = (editing.card_style || 'classic') === cs.key;
                  return (
                    <button
                      key={cs.key}
                      onClick={() => updateField('card_style', cs.key)}
                      className={`rounded-xl border p-2 text-left transition-colors ${active ? 'bg-violet-100 border-violet-300' : 'bg-white border-slate-200 hover:bg-white'}`}
                    >
                      <CardStyleThumb k={cs.key} active={active} />
                      <span className={`block text-[11px] font-bold mt-1.5 ${active ? 'text-slate-900' : 'text-slate-700'}`}>{cs.label}</span>
                      <span className="block text-[9px] text-slate-400 mt-0.5">{cs.hint}</span>
                    </button>
                  );
                })}
              </div>
              {['toast', 'floating_button', 'top_banner', 'bottom_banner'].includes(editing.template || '') && (
                <div className="text-[10px] text-slate-400 -mt-2 mb-3">토스트·배너·플로팅 버튼은 자체 형태라 형태 선택이 적용되지 않습니다 (모달·슬라이드에서 적용).</div>
              )}
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-700" /> 색상
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => updateField('theme', t.key)}
                    className={`px-2 py-2 rounded-lg border text-left transition-colors ${(editing.theme || 'auto') === t.key ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-white'}`}
                  >
                    <span className="block text-xs font-bold">{t.label}</span>
                    <span className="block text-[9px] text-slate-400 mt-0.5">{t.hint}</span>
                  </button>
                ))}
              </div>
              {/* ★ 2026-07-14 디자인 3.0 — 시그니처 테마 (서체·조판·모티프 내장 큐레이션. 1클릭 — 문안 무변) */}
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-700" /> 시그니처 테마 (아트디렉션 내장)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {SIGNATURE_THEME_OPTIONS.map((t) => {
                  const active = (editing.theme || 'auto') === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => updateField('theme', t.key)}
                      className={`rounded-xl border p-2 text-left transition-colors ${active ? 'bg-violet-100 border-violet-300' : 'bg-white border-slate-200 hover:bg-white'}`}
                    >
                      <span className="flex h-5 rounded-md overflow-hidden border border-slate-200">
                        {t.swatches.map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
                      </span>
                      <span className={`block text-[11px] font-bold mt-1.5 ${active ? 'text-slate-900' : 'text-slate-700'}`}>{t.label}</span>
                      <span className="block text-[9px] text-slate-400 mt-0.5">{t.hint}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-slate-500">강조색</label>
                <input
                  type="color"
                  value={editing.accent_color || brandAccent || '#6d5cf0'}
                  onChange={(e) => updateField('accent_color', e.target.value)}
                  className="h-9 w-16 bg-white border border-slate-200 rounded cursor-pointer"
                />
                {brandAccent && (
                  <button
                    onClick={() => updateField('accent_color', brandAccent)}
                    className="flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-white"
                    title="설정에 저장된 회사 브랜드 색으로 되돌리기"
                  >
                    <span className="w-3 h-3 rounded-full border border-slate-300" style={{ background: brandAccent }} />
                    브랜드 색
                  </button>
                )}
                <span className="text-[10px] text-slate-400">{brandAccent ? '브랜드 킷에 저장된 회사 색이 기본 적용됩니다' : '면·구조는 테마가, 강조색만 회사 색'}</span>
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
                        <label className="text-[10px] text-slate-500 block mb-1">구도 (지금 형태 조합에서 쓸 수 있는 조판)</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {INAPP_TREATMENT_OPTIONS.filter((o) => treatAllowed.includes(o.key)).map((o) => (
                            <button
                              key={o.key}
                              onClick={() => setDesign({ treatment: o.key === 'classic' ? null : o.key })}
                              className={`px-2 py-2 rounded-lg border text-left transition-colors ${currentTreatment === o.key ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-white'}`}
                            >
                              <span className="block text-[11px] font-bold">{o.label}</span>
                              <span className="block text-[9px] text-slate-400 mt-0.5">{o.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-4">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">모션 2.0 (CTA 맥동·쿠폰 샤인·초침 팝)</label>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setDesign({ motion: 'rich' })}
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${motionOn ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
                          >켬</button>
                          <button
                            onClick={() => setDesign({ motion: null })}
                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${!motionOn ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
                          >끔</button>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-1">수신자 기기의 모션 줄이기 설정이 켜져 있으면 자동으로 꺼집니다.</div>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">헤드라인 서체</label>
                        <select
                          value={currentFontId}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id === 'theme_default') { setDesign({ font_display: null }); return; }
                            const c = INAPP_FONT_CATALOG.find((x) => x.id === id);
                            setDesign({ font_display: c ? c.css : null });
                          }}
                          className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900"
                        >
                          <option value="theme_default">테마 기본</option>
                          {INAPP_FONT_CATALOG.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      {headlineBlockIdx >= 0 && (
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">헤드라인 강조</label>
                          <div className="flex gap-1.5">
                            {([['', '없음'], ['marker', '형광 마커'], ['underline', '밑줄']] as const).map(([v, label]) => (
                              <button
                                key={v || 'none'}
                                onClick={() => setHeadlineEmphasis(v)}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${currentEmphasis === v ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
                              >{label}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {editing.template === 'center_modal' && (
                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">배경 어둡기 (모달 뒤 딤)</label>
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
                                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
                                >{label}</button>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 block mb-1">배경 블러</label>
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
                                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${cur === v ? 'bg-violet-100 border-violet-300 text-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-white'}`}
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
            {/* ★ 2026-07-19 재구성 (Harold) — 포스터 서체·색·크기 컨트롤은 내용 탭의 입력 바로 옆으로 이동 (여기서 제거) */}
            {/* ★ 2026-07-18 정정2 — 포스터형은 카드 배경이 이미지+흰 바닥 고정이라 색 프리셋이 죽은 컨트롤 → 숨김 */}
            <div className={activeTab === 'design' && !hasBlocks && editing.template !== 'full_image' ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3 text-fuchsia-700" /> 디자인 (클릭해서 골라보세요)
              </h4>
              <div className="grid grid-cols-4 gap-2">
                {DESIGN_PRESETS.map((p) => {
                  const active = editing.background_color === p.background;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={`relative h-14 rounded-xl border overflow-hidden transition-all ${active ? 'border-fuchsia-400 ring-2 ring-fuchsia-300' : 'border-slate-200 hover:border-slate-300 hover:scale-[1.03]'}`}
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
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3" /> 이미지 (선택)
              </h4>
              {!['center_modal', 'slide_in', 'top_banner', 'bottom_banner', 'full_screen', 'inline_card', 'full_image'].includes(editing.template || '') ? (
                <div className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                  토스트·플로팅 버튼 형태는 이미지를 지원하지 않습니다. 이미지를 쓰려면 중앙 모달이나 슬라이드 인을 선택해주세요.
                </div>
              ) : (
              <div className="flex gap-2 items-center">
                {editing.image_url ? (
                  <div className="relative">
                    <img src={editing.image_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className="w-20 h-20 object-cover rounded-lg bg-white" />
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
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-2 bg-white border border-dashed border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-white flex items-center gap-2"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      이미지 업로드 (2MB 이하)
                    </button>
                    {/* ★ 2026-07-18 P3 — 업로드한 소재 재사용 (에셋 라이브러리) */}
                    <button
                      onClick={() => setAssetPickOpen(true)}
                      className="px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700 hover:bg-violet-100 flex items-center gap-2"
                    >
                      라이브러리에서 선택
                    </button>
                  </div>
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
              {/* ★ 2026-07-31 이미지 클릭 랜딩 — 이미지 자체 클릭 시 이동 링크(선택). 비우면 지금처럼 무동작.
                  ★ (Codex 1R ②) 블록 메시지는 이미지가 블록 소유(SDK 블록 렌더가 이 링크를 소비하지 않음) — 죽은 컨트롤 방지 위해 숨김 */}
              {!hasBlocks && ['center_modal', 'slide_in', 'top_banner', 'bottom_banner', 'full_screen', 'inline_card', 'full_image'].includes(editing.template || '') && (
                <div className="mt-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[11px] font-semibold text-slate-500">이미지 클릭 링크 (선택)</span>
                    <button
                      onClick={() => setMallPickTarget({ kind: 'image' })}
                      className="px-2 py-0.5 rounded bg-violet-100 border border-violet-200 text-[10px] text-violet-700 hover:bg-violet-100"
                    >
                      연동 몰에서
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editing.image_link_url || ''}
                    onChange={(e) => updateField('image_link_url', e.target.value || null)}
                    placeholder="이미지를 누르면 이동할 주소 (https://…). 비우면 이동 없음"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300"
                  />
                </div>
              )}
            </div>

            {/* 탭 내용: CTA 버튼 (블록 모드는 cta_group 블록 사용 — 레거시만) */}
            <div className={activeTab === 'content' && !hasBlocks ? '' : 'hidden'}>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <MousePointer className="w-3 h-3" /> CTA 버튼 (최대 3개)
              </h4>
              <div className="space-y-2">
                {(editing.buttons || []).map((btn, idx) => {
                  // ★ 2026-07-18 P2 — 열 수 없는 주소 정직 경고 (Codex D1·D2 정정: 서버 sanitize 실동작 기준):
                  //   · http/https 외 스킴(myapp:// 등) = 서버가 저장 시 제거 → 전 채널 무반응
                  //   · 앱 채널의 상대경로(m/xxx 등) = 앱이 열 수 없음 (0718 팝폰 실사고). 웹은 몰 기준 상대경로가 유효라 경고 안 함
                  const rawUrl = (btn.action_url || '').trim();
                  const isHttpish = /^https?:\/\//i.test(rawUrl) || rawUrl.startsWith('//');
                  const hasOtherScheme = !isHttpish && /^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
                  const domainLike = /^(www\.|[\w-]+(\.[\w-]+)+)/i.test(rawUrl);
                  const urlBad = !!rawUrl && !rawUrl.startsWith('[') && (
                    hasOtherScheme || (isApp && !isHttpish && !domainLike)
                  );
                  const urlBadMsg = hasOtherScheme
                    ? 'http/https 주소만 지원됩니다. 저장 시 이 값은 제거되어 버튼이 무반응이 됩니다.'
                    : '앱에서 열 수 없는 주소 형식입니다. https:// 포함 전체 주소 또는 "연동 몰" 선택을 사용해주세요.';
                  // ★ 2026-07-19 (Harold) — 포스터형은 버튼 색을 버튼 행 바로 옆에 (배경/글자)
                  const posterBtn = editing.template === 'full_image';
                  return (
                  <div key={idx}>
                  <div className={`grid grid-cols-1 ${
                    isApp
                      ? (posterBtn ? 'md:grid-cols-[1fr,1fr,72px,34px,34px,40px]' : 'md:grid-cols-[1fr,1fr,72px,40px]')
                      : (posterBtn ? 'md:grid-cols-[1fr,1fr,72px,34px,34px,80px,40px]' : 'md:grid-cols-[1fr,1fr,72px,80px,40px]')
                  } gap-2 items-center`}>
                    <input
                      type="text"
                      value={btn.label}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], label: e.target.value };
                        updateField('buttons', newButtons);
                      }}
                      placeholder="버튼 라벨"
                      className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
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
                      className={`px-2 py-1.5 bg-white border rounded text-xs text-slate-900 placeholder-slate-400 ${urlBad ? 'border-rose-300' : 'border-slate-200'}`}
                    />
                    {/* ★ 2026-07-18 P2 — 연동 몰 상품 선택 → URL 자동 주입 (수기 입력 사고 차단) */}
                    <button
                      onClick={() => setMallPickTarget({ kind: 'button', id: btn.id || `btn_${idx}` })}
                      className="px-2 py-1.5 rounded border border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                      title="연동 몰에서 상품을 골라 이동 URL을 자동으로 채웁니다"
                    >
                      연동 몰
                    </button>
                    {/* ★ 2026-07-19 — 포스터형: 버튼 배경/글자 색을 행 안에 (Harold "버튼 옆에 색") */}
                    {posterBtn && (
                      <input
                        type="color"
                        value={String(btn.background_color || brandAccent || '#4f46e5')}
                        onChange={(e) => {
                          const newButtons = [...(editing.buttons || [])];
                          newButtons[idx] = { ...newButtons[idx], background_color: e.target.value };
                          updateField('buttons', newButtons);
                        }}
                        className="h-8 w-full bg-white border border-slate-200 rounded cursor-pointer"
                        title="버튼 배경색"
                      />
                    )}
                    {posterBtn && (
                      <input
                        type="color"
                        value={String(btn.text_color || '#ffffff')}
                        onChange={(e) => {
                          const newButtons = [...(editing.buttons || [])];
                          newButtons[idx] = { ...newButtons[idx], text_color: e.target.value };
                          updateField('buttons', newButtons);
                        }}
                        className="h-8 w-full bg-white border border-slate-200 rounded cursor-pointer"
                        title="버튼 글자색"
                      />
                    )}
                    {/* ★ 2026-07-17 버튼 스타일은 웹 렌더(SDK renderLegacy)만 소비 — 앱(팝폰 시트·계약)은 색 데이터 축이라 앱 채널에서 숨김 (죽은 컨트롤 금지, auto_dismiss·애니메이션과 동일 원칙) */}
                    {!isApp && (
                    <select
                      value={btn.style}
                      onChange={(e) => {
                        const newButtons = [...(editing.buttons || [])];
                        newButtons[idx] = { ...newButtons[idx], style: e.target.value as any };
                        updateField('buttons', newButtons);
                      }}
                      className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900"
                    >
                      <option value="primary">강조</option>
                      <option value="secondary">보통</option>
                      <option value="tertiary">약함</option>
                    </select>
                    )}
                    <button
                      onClick={() => updateField('buttons', (editing.buttons || []).filter((_, i) => i !== idx))}
                      className="text-rose-700 hover:bg-rose-50 rounded p-1.5"
                      aria-label="버튼 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {urlBad && (
                    <div className="text-[10px] text-rose-700 mt-1">{urlBadMsg}</div>
                  )}
                  </div>
                  );
                })}
                {(editing.buttons || []).length < 3 && (
                  <button
                    onClick={() => updateField('buttons', [...(editing.buttons || []), {
                      id: `btn_${(editing.buttons || []).length}`,
                      label: '자세히 보기',
                      action_url: '[URL: 회사 admin 수정]',
                      style: 'primary',
                      // ★ 2026-07-18 P1 — 버튼색 기본 = 브랜드 킷 색 (버튼만 브랜드 컬러 정책)
                      background_color: brandAccent || '#4f46e5',
                      text_color: '#ffffff',
                    }])}
                    className="text-xs text-violet-700 hover:bg-violet-50 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> 버튼 추가
                  </button>
                )}
              </div>
            </div>

            {/* ★ 2026-09-29 색상 — 옛 타겟·시점 탭에서 디자인 탭으로(발행 확인 창에는 표시 조건만). 블록 메시지는 테마가 색을 정한다 */}
            {!hasBlocks && (
              <div className={activeTab === 'design' ? '' : 'hidden'}>
                <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Layers className="w-3 h-3" /> 색상
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">배경색</label>
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(String(editing.background_color || '')) ? String(editing.background_color) : '#4f46e5'} onChange={(e) => updateField('background_color', e.target.value)} className="w-full h-9 bg-white border border-slate-200 rounded cursor-pointer" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">글자색</label>
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(String(editing.text_color || '')) ? String(editing.text_color) : '#ffffff'} onChange={(e) => updateField('text_color', e.target.value)} className="w-full h-9 bg-white border border-slate-200 rounded cursor-pointer" />
                  </div>
                </div>
              </div>
            )}
    </div>
  );

  const defectNow = drawerOpen ? publishDefectOf(buildPayload(editing)) : null;
  const drawer = drawerOpen ? (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label={isLive ? '타겟 · 시점' : '발행 전 확인'}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[540px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 shrink-0">
          <b className="text-[16px] text-slate-900">{isLive ? '타겟 · 시점' : wasPublished ? '다시 게시 전 확인' : '발행 전 확인'}</b>
          <button type="button" onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto mk-scroll px-5 py-4 space-y-5">
          <div className={`rounded-xl border px-3.5 py-3 text-[12.5px] ${defectNow ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
            <b className="block mb-0.5">점검</b>
            {defectNow ? defectNow.message : posterMode ? `장 ${slides.length}개 모두 사진 있음 · 혜택 칸 채움` : '제목 · 본문 · 혜택 칸 확인됨'}
            {defectNow && <span className="block text-[11.5px] opacity-80 mt-1">빈 사진이나 채우지 않은 혜택 칸이 있으면 발행하지 않고 그 장으로 데려갑니다.</span>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[12.5px] text-slate-600">
            <b className="block text-slate-900 mb-0.5">아래쪽 버튼</b>
            {editing.design?.dismiss_mode === 'snooze_day'
              ? '오늘 하루 보지 않기 · 닫기: 누른 고객에게는 24시간 동안 뜨지 않습니다.'
              : '다시 보지 않기 · 닫기: 다시 보지 않기를 누른 고객에게는 더 뜨지 않습니다.'}
            {isApp && editing.design?.dismiss_mode === 'snooze_day' && ' 앱은 업데이트된 앱에서만 「오늘 하루 보지 않기」가 보이고, 이전 앱은 「다시 보지 않기 · 닫기」로 나옵니다.'}
          </div>
          {appLocked && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">이 모양은 앱 업데이트 뒤에 보입니다. 이전 앱에서는 같은 내용이 포스터 모양으로 보입니다.</div>
          )}
            {/* 탭 타겟·시점: 세그먼트 */}
            <div className="">
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Target className="w-3 h-3" /> 타겟 세그먼트
              </h4>
              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
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
                    className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
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
                    className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                  />
                </div>
                <div className="text-[11px] text-cyan-700 flex items-center gap-2 pt-1 border-t border-slate-100">
                  <Users className="w-3 h-3" />
                  {segmentCount === null ? '실시간 매칭 중...' : (
                    <span>매칭 회원: <strong className="text-slate-900">{segmentCount.toLocaleString()}명</strong> ({segmentDesc})</span>
                  )}
                </div>
              </div>
            </div>

            {/* AI 정밀 타겟 (표시 대상) — 자연어 추출 filter를 표시 대상으로 (단 1 오차 없는 타겟) */}
            <div className="mt-3">
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> AI 정밀 타겟 (표시 대상)
              </h4>
              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                {editing.audience_filter && Object.keys(editing.audience_filter).length > 0 ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-emerald-700">정밀 타겟 지정됨. 이 조건에 맞는 회원에게만 표시</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-700 hover:text-fuchsia-800">다시 추출</button>
                      <button onClick={() => updateField('audience_filter', null)} className="text-[11px] text-slate-400 hover:text-slate-600">해제</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setExtractOpen(true)} className="w-full py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 자연어로 표시 대상 추출
                  </button>
                )}
                <p className="text-[10px] text-slate-400">세그먼트와 함께 적용됩니다. 표시는 저장 후 반영됩니다.</p>
              </div>
            </div>
            <TargetExtractModal
              show={extractOpen}
              channel="inapp"
              onClose={() => setExtractOpen(false)}
              onApply={(t) => { updateField('audience_filter', t.filter); setExtractOpen(false); }}
            />

            {/* 탭 타겟·시점: 개인화 · 트리거 · 시간 · 색상 */}
            <div className="space-y-5">
            {/* 개인화 변수 — 기본 알림만(포스터 계열은 칸마다 「넣을 수 있는 값」) */}
            {!posterMode && (
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Wand2 className="w-3 h-3" /> 개인화 변수 (본문 안 활용)
              </h4>
              <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {availableVariables.slice(0, 9).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => {
                      const cursorBody = (editing.body || '') + ' ' + v.key;
                      updateField('body', cursorBody);
                    }}
                    className="text-[10px] bg-white hover:bg-violet-100 border border-slate-200 rounded px-2 py-1 text-left transition-colors"
                    title={v.hint}
                  >
                    <div className="text-violet-700 font-mono truncate">{v.key}</div>
                    <div className="text-slate-500">{v.label}</div>
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* 트리거 조건 */}
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> 트리거 조건
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {isApp ? (
                  // ★ 2026-07-16 앱 = 실행(접속) 시에만 조회 — 다른 트리거로 저장되면 영원히 미표시라 고정
                  <div className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-600 flex items-center">
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
                  className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900"
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
                  className="px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900"
                >
                  {/* ★ 2026-07-17 라벨 통일 — 웹/앱 전부 "세션당 1회" (세션 정의만 채널별 각주. 옛 "접속당 1회" 라벨 폐기) */}
                  <option value="once_per_session">세션당 1회</option>
                  <option value="once_per_day">하루 1회</option>
                  <option value="always">매번 표시</option>
                </select>
              </div>
              {/* ★ 2026-07-16 재노출 계약 안내 — 닫기 ≠ 영구 거부. ★ 2026-07-17 앱 채널 = 계약 구현 빌드 기준 단서(구 빌드 앱에선 빈도가 다르게 동작할 수 있음 — 팝폰 구 빌드 세션 영구화 실사례) */}
              <div className="text-[10px] text-slate-400 mt-1.5">
                세션 = {isApp ? '앱 실행 1회(완전 종료 후 재실행하면 다시 표시)' : '브라우저 방문 1회'} 기준. 닫기(X)는 이번만 닫히고 위 빈도 규칙에 따라 다시 표시됩니다. "다시 보지 않기"를 누른 고객에게는 더 이상 표시되지 않습니다.{isApp ? ' 빈도·닫기 동작은 앱이 통합 계약을 구현한 빌드에서 이 정의대로 동작합니다.' : ''}
              </div>
              {/* ★ P0-1 — 트리거 임계값 입력 (없으면 "스크롤 도달"을 골라도 % 지정 불가 = 트리거 정밀 표시 무동작이던 결함) */}
              {(editing.trigger_event === 'scroll' || editing.trigger_event === 'time_on_page' || editing.trigger_event === 'cart_value') && (
                <div className="mt-2 bg-white border border-slate-200 rounded-lg p-2.5">
                  {editing.trigger_event === 'scroll' && (
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">스크롤 도달 % (10~100, 비우면 50%)</label>
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
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                      />
                      <div className="text-[10px] text-slate-400 mt-1">방문자가 페이지를 이만큼 내렸을 때 표시됩니다.</div>
                    </div>
                  )}
                  {editing.trigger_event === 'time_on_page' && (
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">체류 초 (5~600, 비우면 10초)</label>
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
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                      />
                      <div className="text-[10px] text-slate-400 mt-1">체류 판정은 10·30·60초 시점에 확인됩니다 (예: 30 입력 시 30초 시점 표시).</div>
                    </div>
                  )}
                  {editing.trigger_event === 'cart_value' && (
                    <div>
                      <label className="text-[10px] text-slate-500 block mb-1">장바구니 금액 (원 이상)</label>
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
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                      />
                      <div className="text-[10px] text-slate-400 mt-1">자사몰이 SDK에 장바구니 금액을 전달할 때 비교됩니다.</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 시간대 / 요일 / 한도 */}
            <div>
              <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> 시간대 / 요일 / 한도
              </h4>
              <div className="space-y-3 pl-4 border-l-2 border-slate-200">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">시작 시간 (9~22 권장)</label>
                    <input
                      type="number"
                      min={0} max={23}
                      value={editing.send_start_hour ?? ''}
                      onChange={(e) => updateField('send_start_hour', e.target.value ? Number(e.target.value) : null)}
                      placeholder="9"
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">종료 시간</label>
                    <input
                      type="number"
                      min={0} max={23}
                      value={editing.send_end_hour ?? ''}
                      onChange={(e) => updateField('send_end_hour', e.target.value ? Number(e.target.value) : null)}
                      placeholder="22"
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
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
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                      <div className="text-[11px] text-amber-800 leading-relaxed">
                        새벽 시간대 노출 설정입니다. 인앱은 방문자에게만 표시돼 법적 제한은 없지만, 새벽 방문 고객 경험을 고려해주세요.
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">노출 요일</label>
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
                            allowed ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : 'bg-white border border-slate-200 text-slate-400'
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
                      <label className="text-[10px] text-slate-500 block mb-1">자동 닫힘 (초, 비우면 사용자 직접)</label>
                      <input
                        type="number"
                        min={1}
                        value={editing.auto_dismiss_seconds ?? ''}
                        onChange={(e) => updateField('auto_dismiss_seconds', e.target.value ? Number(e.target.value) : null)}
                        placeholder="비우면 수동"
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">사용자별 최대 노출 횟수</label>
                    <input
                      type="number"
                      min={1}
                      value={editing.max_displays_per_user ?? ''}
                      onChange={(e) => updateField('max_displays_per_user', e.target.value ? Number(e.target.value) : null)}
                      placeholder="비우면 무한"
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400"
                    />
                  </div>
                </div>
                {/* ★ 2026-07-16 — 애니메이션도 앱 미소비(네이티브 슬라이드업 고정)라 앱 채널에서 숨김 */}
                {!isApp && (
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">애니메이션</label>
                  <select
                    value={editing.animation || 'fade'}
                    onChange={(e) => updateField('animation', e.target.value as Animation)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900"
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

            </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex gap-2 shrink-0">
          <button type="button" onClick={() => setDrawerOpen(false)} className="flex-1 h-11 rounded-xl border border-slate-300 text-[14px] font-semibold text-slate-700 hover:bg-white">{isLive ? '닫기' : '계속 편집'}</button>
          {!isLive && (
            <button type="button" onClick={confirmPublish} disabled={publishing || !!defectNow}
              className="flex-[1.4] h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[14px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{wasPublished ? '다시 게시' : '지금 발행'}
            </button>
          )}
        </div>
        {isLive && <p className="px-5 pb-4 -mt-2 text-[11.5px] text-slate-400">바꾼 표시 조건은 오른쪽 위 [반영]으로 적용됩니다.</p>}
        <p className="px-5 pb-3 text-[10px] text-slate-400 italic">Data source: 게시 조건은 서버가 저장된 메시지로 다시 확인합니다 · 첫 게시만 크레딧이 듭니다</p>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-100 overflow-y-auto lg:overflow-hidden">
        <EditShell
          title={docTitle}
          onTitle={onTitleEdit}
          save={saveInfo}
          channel="dm"
          channelSwitch={channelSwitch}
          onBack={() => { void leave(); }}
          onUndo={undo}
          onRedo={redo}
          canUndo={pastRef.current.length > 0 || !!burstBaseRef.current}
          canRedo={futureRef.current.length > 0}
          onSend={() => {
            if (publishing) return;
            if (isLive) { void applyLive(); return; }
            if (checkPublish()) setDrawerOpen(true);
          }}
          sendLabel={publishing ? '처리 중' : sendLabel}
          extraHeader={extraHeader}
          banner={lineAssist && lineBarOn ? (
            <ZoneCompletion
              items={lineItems}
              onItem={(it) => { if (it.action === '채우기') setLineSheet(true); }}
              action={lineCanFill ? { label: '채우기', onClick: () => setLineSheet(true) } : null}
              onDismiss={() => setLineBarOn(false)}
            />
          ) : undefined}
          left={left}
          center={center}
          right={right}
        />
      </div>
      {drawer}
      <CreditConfirmModal
        open={creditOpen}
        source="inapp-publish"
        onConfirm={() => { setCreditOpen(false); void doPublish(); }}
        onCancel={() => setCreditOpen(false)}
      />
      <ImageSourceMenu open={imgMenu} onClose={() => setImgMenu(false)} images={images} />
      {images.node}
      <ConfirmModal state={editorConfirm} onClose={() => setEditorConfirm(null)} />
      {lineAssist && (
        <LineFactsSheet
          open={lineSheet && lineCanFill}
          onClose={() => setLineSheet(false)}
          title="한 가지만 더 알려 주시면 이렇게 좋아져요"
          reason="적어 주신 그대로만 씁니다 · 지금 메시지는 그대로 남아요"
          line={lineAssist.text}
          primary={{ label: '채우기 · 무료', tone: 'indigo', disabled: !typedBenefit(lineValues), onClick: applyLineBenefit }}
        >
          <LineFacts fields={['benefit']} values={lineValues} onChange={setLineValues} allowNone={false} />
        </LineFactsSheet>
      )}
      {/* ★ 2026-07-22 테스트저장 — 웹·앱 실물을 실제 크기로 렌더해 PNG 저장(영업용, 발송 아님). 백드롭 클릭 닫힘 없음(작업 손실 방지). */}
      {captureOpen && (
        <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/75 backdrop-blur-sm px-4 py-8 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-5xl w-full my-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Download className="w-4.5 h-4.5 text-violet-700" /> 테스트 이미지 저장: 웹·앱 실물</h3>
                <p className="text-[11px] text-slate-500 mt-1">담당자에게 보낼 이미지입니다. 각 [이미지 저장]으로 PNG를 내려받아 이메일에 첨부하세요. (실제 발송이 아닙니다)</p>
              </div>
              <button onClick={() => setCaptureOpen(false)} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100 shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> 웹 (자사몰 브라우저)</span>
                  <button onClick={() => saveShot('web')} disabled={savingShot !== null} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-200 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    {savingShot === 'web' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} 이미지 저장
                  </button>
                </div>
                <div ref={webShotRef} style={{ background: '#0f172a', padding: 16, borderRadius: 12 }}>
                  <InAppMessagePreview
                    template={(viewMsg.template || 'top_banner') as string}
                    title={replaceVars(viewMsg.title || '', sampleCustomer)}
                    body={replaceVars(viewMsg.body || '', sampleCustomer)}
                    imageUrl={viewMsg.image_url}
                    badge={viewMsg.badge_text}
                    buttons={(viewMsg.buttons || []).map((b) => ({ ...b, label: replaceVars(b.label, sampleCustomer) }))}
                    backgroundColor={editing.background_color || '#4f46e5'}
                    textColor={editing.text_color || '#ffffff'}
                    blocks={hasBlocks ? blocks : undefined}
                    theme={editing.theme}
                    accentColor={editing.accent_color}
                    cardStyle={editing.card_style}
                    design={viewMsg.design}
                    posterSlides={assemblePosterSlides(viewMsg)}
                    replaceVars={(t) => replaceVars(t, sampleCustomer)}
                    captureMode
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> 앱 (네이티브)</span>
                  <button onClick={() => saveShot('app')} disabled={savingShot !== null} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-200 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    {savingShot === 'app' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} 이미지 저장
                  </button>
                </div>
                <div ref={appShotRef} style={{ background: '#0f172a', padding: 16, borderRadius: 12 }}>
                  <AppInAppPreview
                    template={(viewMsg.template || 'bottom_banner') as string}
                    title={replaceVars(viewMsg.title || '', sampleCustomer)}
                    body={replaceVars(viewMsg.body || '', sampleCustomer)}
                    imageUrl={viewMsg.image_url}
                    badge={viewMsg.badge_text}
                    buttons={(viewMsg.buttons || []).map((b) => ({ ...b, label: replaceVars(b.label, sampleCustomer) }))}
                    backgroundColor={editing.background_color || '#4f46e5'}
                    textColor={editing.text_color || '#ffffff'}
                    design={viewMsg.design}
                    posterSlides={assemblePosterSlides(viewMsg)}
                    replaceVars={(t) => replaceVars(t, sampleCustomer)}
                    captureMode
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ★ 2026-07-18 P2 — CTA 몰 상품 픽커: 선택 상품 URL을 대상 버튼에 자동 주입 (+이미지 비어 있으면 상품 이미지 채움) */}
      <MallProductPickerModal
        open={mallPickTarget !== null}
        onClose={() => setMallPickTarget(null)}
        onPick={(products: PickedMallProduct[]) => {
          const target = mallPickTarget;
          setMallPickTarget(null);
          if (!target || products.length === 0) return;
          const p = products[0];
          if (!p.productUrl) {
            // ★ Codex C2 — 네이버 스마트스토어는 상품 API가 URL을 제공하지 않아 자동 연결 불가 (정직 안내)
            pickToast.warning(
              p.provider === 'naver'
                ? '네이버 스마트스토어는 상품 URL을 제공하지 않아 자동 연결할 수 없습니다. 이동 URL을 직접 입력해주세요.'
                : '선택한 상품에 상품 페이지 URL이 없습니다. 다른 상품을 선택해주세요.',
            );
            return;
          }
          // ★ 2026-07-31 이미지 클릭 링크 대상 — 버튼이 아니라 image_link_url에 주입 (+이미지 비어 있으면 상품 이미지 채움)
          if (target.kind === 'image') {
            const patch: Partial<MessageRow> = { image_link_url: p.productUrl };
            let filledImage = false;
            if (!editing.image_url && p.imageUrl) {
              (patch as any).image_url = p.imageUrl;
              filledImage = true;
            }
            setEditing({ ...editing, ...patch });
            pickToast.success(
              filledImage
                ? `"${p.name}" 연결 완료. 이미지 클릭 링크와 이미지가 채워졌습니다.`
                : `"${p.name}" 연결 완료. 이미지 클릭 링크가 채워졌습니다.`,
            );
            return;
          }
          // ★ Codex C1 — 픽커 열린 사이 버튼이 삭제/변경돼도 id로 정확 대상 판정
          const idx = (editing.buttons || []).findIndex((b) => b.id === target.id);
          if (idx < 0) {
            pickToast.warning('대상 버튼이 삭제되어 연결을 취소했습니다.');
            return;
          }
          const newButtons = [...(editing.buttons || [])];
          newButtons[idx] = { ...newButtons[idx], action_url: p.productUrl };
          const patch: Partial<MessageRow> = { buttons: newButtons };
          let filledImage = false;
          if (!editing.image_url && p.imageUrl) {
            (patch as any).image_url = p.imageUrl;
            filledImage = true;
          }
          setEditing({ ...editing, ...patch });
          pickToast.success(
            filledImage
              ? `"${p.name}" 연결 완료. 이동 URL과 이미지가 채워졌습니다.`
              : `"${p.name}" 연결 완료. 이동 URL이 채워졌습니다.${products.length > 1 ? ' (첫 상품만 적용)' : ''}`,
          );
        }}
      />
      {/* ★ 2026-07-18 P3 — 에셋 라이브러리 픽커: 선택 이미지를 메시지 이미지로 주입 */}
      <AssetLibraryPickerModal
        open={assetPickOpen}
        onClose={() => setAssetPickOpen(false)}
        onPick={(a: PickedAsset) => {
          setEditing({ ...editing, image_url: a.url });
          pickToast.success('라이브러리 소재를 이미지로 넣었습니다.');
        }}
      />
      {/* ★ 2026-07-17 앱(네이티브) 통합 계약 — CDP 설정 앱 탭과 동일 단일 소스 */}
      <AppInAppContractModal open={showAppContract} onClose={() => setShowAppContract(false)} />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// ★ 2026-09-26 한줄로 V2 R1-45 — A/B 변형 검토 창
//   AI 다듬기 변형은 일시정지로 만들어진다. 여기서 문안을 보고 켜야 방문자에게 노출되고,
//   켠 변형끼리 성과로 승자를 고른다(노출 선택은 켜진 변형만 본다). 켜기·끄기는 과금 없음.
// ════════════════════════════════════════════════════════════════════

interface VariantRow {
  messageId: string;
  parentMessageId: string | null;
  title: string;
  body: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

function VariantReviewModal({ parentId, messageTitle, authHeaders, onToast, onClose }: {
  parentId: string;
  messageTitle: string;
  authHeaders: () => Record<string, string>;
  onToast: (msg: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/cdp/inapp/variant', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action: 'list', parent_message_id: parentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) setRows((data.variants || []).filter((v: VariantRow) => v.parentMessageId));
      else { setRows([]); onToast(data?.error || '변형을 불러오지 못했습니다.', 'error'); }
    } catch (e: any) {
      setRows([]);
      onToast(e?.message || '변형을 불러오지 못했습니다.', 'error');
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [parentId]);

  const toggle = async (v: VariantRow) => {
    if (busyId) return;
    const next = v.status === 'active' ? 'paused' : 'active';
    setBusyId(v.messageId);
    try {
      const res = await fetch('/api/cdp/inapp/variant', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ action: 'set_status', parent_message_id: parentId, variant_id: v.messageId, status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        onToast(next === 'active' ? '변형을 켰습니다. 이제 방문자에게 번갈아 보입니다.' : '변형을 껐습니다.', 'success');
        await load();
      } else {
        onToast(data?.error || '변경하지 못했습니다.', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || '변경하지 못했습니다.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Layers className="w-4 h-4 text-violet-700" /> A/B 변형</h3>
            <p className="text-[11px] text-slate-500 truncate">{messageTitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">AI가 만든 변형은 꺼진 상태로 만들어집니다. 문안을 확인하고 켜면 방문자에게 원본과 번갈아 보이고, 성과가 좋은 쪽을 자동으로 고릅니다.</p>
          {rows === null ? (
            <div className="py-10 flex justify-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">아직 변형이 없습니다. AI 개선의 '본문 다듬기'로 만들 수 있어요.</p>
          ) : rows.map((v) => (
            <div key={v.messageId} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${v.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {v.status === 'active' ? '노출 중' : '꺼짐'}
                  </span>
                  <span className="text-[10px] text-slate-400">표시 {Number(v.impressions || 0).toLocaleString()} · 클릭 {Number(v.clicks || 0).toLocaleString()} · CTR {((Number(v.ctr) || 0) * 100).toFixed(2)}%</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 break-words">{v.title}</p>
                <p className="text-xs text-slate-600 whitespace-pre-wrap break-words mt-1">{v.body}</p>
              </div>
              <button
                onClick={() => toggle(v)}
                disabled={busyId === v.messageId}
                className={`shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 ${v.status === 'active' ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}
              >
                {busyId === v.messageId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : v.status === 'active' ? '끄기' : '노출 켜기'}
              </button>
            </div>
          ))}
          <p className="text-[10px] text-slate-400 italic">Data source: cdp_inapp_messages 변형 · cdp_inapp_impressions 표시·클릭</p>
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
  explainLoading: boolean;
  onRequestExplain: () => void;
  viewers: InAppViewersData | null;
  messageTitle: string;
  onClose: () => void;
}

function DrillDownModal({ loading, stats, explain, explainLoading, onRequestExplain, viewers, messageTitle, onClose }: DrillDownProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-700" />
            메시지 통계 + AI 영향 요인 분석
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-1.5 rounded hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loading && (
            <div className="py-12 flex justify-center text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}

          {!loading && stats && (
            <>
              {/* Funnel */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-900 mb-3">Funnel: impression → click → 24h 매핑 구매</h4>
                <div className="space-y-2">
                  {stats.funnel.steps.map((step, idx) => {
                    const colors = ['bg-indigo-200', 'bg-emerald-200', 'bg-rose-200', 'bg-amber-200'];
                    return (
                      <div key={idx}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-600">{step.name}</span>
                          <span className="text-slate-900 font-bold">{step.count.toLocaleString()} ({step.percentOfTotal.toFixed(1)}%)</span>
                        </div>
                        <div className="h-6 bg-white rounded overflow-hidden">
                          <div className={`h-full ${colors[idx]} transition-all`} style={{ width: `${Math.max(step.percentOfTotal, 2)}%` }} />
                        </div>
                        {step.dropoffReason && (
                          <div className="text-[10px] text-amber-800 mt-1">⚠ {step.dropoffReason}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {stats.funnel.attributedRevenueKrw > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-emerald-700">
                    24h 매핑 매출: <strong>{stats.funnel.attributedRevenueKrw.toLocaleString()}원</strong>
                  </div>
                )}
                <div className="text-[10px] text-slate-400 italic mt-3">Data source: {stats.funnel.dataSource}</div>
              </div>

              {/* ★ 2026-07-06 누가 봤는지 — 식별 고객 목록 + 익명 합산 (절충안: 익명 다수 구조라 전 명단은 불가, 가능한 범위만 정직 표시) */}
              {viewers && (
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900">누가 봤는지: 식별된 고객 {viewers.identifiedTotal.toLocaleString()}명</h4>
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
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200"
                      >
                        <Download className="w-3.5 h-3.5" /> CSV
                      </button>
                    )}
                  </div>
                  {viewers.viewers.length === 0 ? (
                    <p className="text-xs text-slate-400">아직 로그인 등으로 식별된 열람 고객이 없습니다.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 max-h-[240px] overflow-y-auto rounded-lg border border-slate-100">
                      {viewers.viewers.slice(0, 100).map((v) => (
                        <div key={v.customerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
                          <span className="text-slate-700 w-20 truncate">{v.name || '-'}</span>
                          <span className="text-slate-400 font-mono w-28 truncate">{v.phone || '-'}</span>
                          <span className="text-slate-500">표시 {v.impressions}</span>
                          <span className={v.clicks > 0 ? 'text-amber-700 font-semibold' : 'text-slate-400'}>클릭 {v.clicks}</span>
                          {v.purchaseCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 font-semibold">구매 {Math.round(Number(v.purchaseAmount)).toLocaleString()}원</span>}
                          <span className="ml-auto text-slate-400">{v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                      ))}
                      {viewers.viewers.length > 100 && <div className="px-3 py-2 text-[10px] text-slate-400 text-center">외 {(viewers.viewers.length - 100).toLocaleString()}명. CSV로 전체 확인</div>}
                    </div>
                  )}
                  <div className="mt-2.5 text-[11px] text-slate-500">
                    익명 방문자 <strong className="text-slate-700">{viewers.anonymous.visitors.toLocaleString()}명</strong>: 표시 {viewers.anonymous.impressions.toLocaleString()} · 클릭 {viewers.anonymous.clicks.toLocaleString()} <span className="text-slate-400">(비로그인 방문은 개인 식별이 불가해 합산으로만 표시)</span>
                  </div>
                  <div className="text-[10px] text-slate-400 italic mt-2">Data source: cdp_inapp_impressions × customers(식별분) + 익명 합산 · purchases 7일 실측</div>
                </div>
              )}

              {/* 24시간 분포 */}
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-900 mb-3">24시간 CTR 분포</h4>
                <div className="grid grid-cols-12 gap-0.5 h-24">
                  {stats.hourly.map((h) => {
                    const maxCtr = Math.max(...stats.hourly.map((x) => x.ctr), 0.01);
                    const height = (h.ctr / maxCtr) * 100;
                    return (
                      <div key={h.hour} className="flex flex-col justify-end" title={`${h.hour}시: CTR ${(h.ctr * 100).toFixed(1)}% / ${h.impressions}건`}>
                        <div className="bg-gradient-to-t from-violet-500 to-fuchsia-500 rounded-t" style={{ height: `${Math.max(height, 2)}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-12 gap-0.5 text-[9px] text-slate-400 text-center mt-1">
                  {stats.hourly.filter((_, idx) => idx % 3 === 0).map((h) => (
                    <div key={h.hour} className="col-span-3">{h.hour}시</div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 italic mt-2">Data source: cdp_inapp_impressions KST 시간대별 집계</div>
              </div>

              {/* 디바이스 — ★ 2026-09-27 한줄로 V2 R252: 실측이 있을 때만(노출 기록에 기기 정보가 아직 없다 · 옛 70·30 나눔 표시 제거) */}
              {stats.device.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-900 mb-3">디바이스 분포</h4>
                <div className="grid grid-cols-2 gap-3">
                  {stats.device.map((d) => (
                    <div key={d.device} className="bg-white rounded p-3">
                      <div className="text-xs text-slate-500">{d.device === 'mobile' ? '모바일' : 'PC'}</div>
                      <div className="text-lg font-bold text-slate-900">{d.impressions.toLocaleString()}</div>
                      <div className="text-xs text-emerald-700">CTR {(d.ctr * 100).toFixed(2)}%</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 italic mt-2">Data source: cdp_inapp_impressions 기기 정보</div>
              </div>
              )}
            </>
          )}

          {/* ★ 2026-09-26 한줄로 V2 R1-42 — AI 영향 요인 분석은 누를 때만(유료 · 창을 열 때마다 빠지지 않게) */}
          {!loading && !explain && (
            <div className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-700" />
                  AI 영향 요인 분석
                </h4>
                <p className="text-xs text-slate-500">이 메시지 성과에 영향을 준 요인 5가지와 개선 추천 3가지를 뽑아 드려요.</p>
              </div>
              <button
                onClick={onRequestExplain}
                disabled={explainLoading}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-60"
              >
                {explainLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {explainLoading ? '분석 중' : `AI로 분석하기 (${AI_GENERATE_COSTS['inapp-explainer']}크레딧)`}
              </button>
            </div>
          )}

          {/* AI 영향 요인 */}
          {!loading && explain && (
            <div className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-5">
              <h4 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-700" />
                AI 영향 요인 분석
              </h4>
              <div className="text-xs text-violet-900 mb-3 italic">{explain.topInsight}</div>
              <div className="space-y-2">
                {explain.factors.map((f, idx) => (
                  <div key={idx} className="bg-white rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-900">{f.factor}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        f.direction === 'positive' ? 'bg-emerald-100 text-emerald-700' :
                        f.direction === 'negative' ? 'bg-rose-100 text-rose-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {f.direction === 'positive' ? '긍정' : f.direction === 'negative' ? '개선 필요' : '중립'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mb-1">{f.description}</div>
                    <div className="h-1.5 bg-white rounded overflow-hidden mb-1">
                      <div
                        className={`h-full transition-all ${
                          f.direction === 'positive' ? 'bg-emerald-500' :
                          f.direction === 'negative' ? 'bg-rose-500' : 'bg-slate-300'
                        }`}
                        style={{ width: `${f.impact * 100}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 italic">Data source: {f.dataSource}</div>
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
    case 'benefit': return { type, text: '[혜택 안내: 직접 작성해주세요]' };
    case 'rating': return { type, value: 4.5, count: 0, label: '후기' };
    case 'product': return { type, name: '', meta: '' };
    case 'media': return { type, variant: 'icon', icon: 'gift' };
    case 'countdown': return { type, ends_at: '', label: '마감까지' };
    case 'cta_group': return { type, layout: 'stack', buttons: [{ id: 'btn_primary', label: '자세히 보기', action_url: '[URL: 회사 admin 수정]', style: 'primary' }] };
    case 'divider': return { type };
    case 'spacer': return { type, size: 'md' };
    case 'footer': return { type, text: '' };
    default: return { type };
  }
}

/** 사용자가 올린 이미지 블록 기본 표시 — 카드형은 전체보기(크롭 0), 배너(top/bottom)만 얇은 띠(16:9) 유지 */
const BANNER_INAPP_TEMPLATES = new Set(['top_banner', 'bottom_banner']);
function defaultMediaAspect(template?: string | null): 'natural' | '16:9' {
  return BANNER_INAPP_TEMPLATES.has(String(template || '')) ? '16:9' : 'natural';
}

/** 레거시(제목/본문/이미지/버튼/배경) → 블록 + 테마 1:1 변환 */
export function convertToBlocks(m: Partial<MessageRow>): { content_blocks: any[]; theme: string; accent_color: string } {
  const blocks: any[] = [];
  if (m.badge_text && String(m.badge_text).trim()) blocks.push({ type: 'eyebrow', text: String(m.badge_text).trim(), tone: 'accent' });
  if (m.image_url) blocks.push({ type: 'media', variant: 'image', url: m.image_url, aspect: defaultMediaAspect(m.template || m.position) });
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

const COMPOSER_INPUT = 'w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300';

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
    <div ref={setNodeRef} style={style} className={`bg-slate-100 border rounded-xl p-3 transition-all ${highlighted ? 'border-violet-300 ring-2 ring-violet-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span
            {...attributes}
            {...listeners}
            title="드래그하여 순서 변경"
            aria-label="드래그 핸들"
            className="shrink-0 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing touch-none px-0.5"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-violet-800 bg-violet-100 px-2 py-0.5 rounded-full">
            <Ic className="w-3 h-3" /> {BLOCK_LABELS[block.type] || block.type}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={onUp} disabled={isFirst} className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" aria-label="위로"><ChevronUp className="w-3.5 h-3.5" /></button>
          <button onClick={onDown} disabled={isLast} className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" aria-label="아래로"><ChevronDown className="w-3.5 h-3.5" /></button>
          <button onClick={onDuplicate} className="p-1 text-slate-400 hover:text-violet-700" aria-label="복제"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={onRemove} className="p-1 text-rose-700 hover:text-rose-700" aria-label="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {children}
    </div>
  );
}

/** ★ 2026-07-21 → ★ 2026-09-29 미리보기용 poster_slides — 포스터(full_image)만. 편집기는 장 작업본을 messagePatchFromSlides 로
 *  합성한 값(viewMsg.poster_slides)을 넘기고, 목록 미리보기는 저장된 값을 넘긴다. 반환: undefined(포스터 아님) / 장 배열. */
function assemblePosterSlides(m: Partial<MessageRow>): any[] | undefined {
  if (m.template !== 'full_image') return undefined;
  return Array.isArray(m.poster_slides) ? m.poster_slides : [];
}

// ★ 2026-07-17 template — SDK 실렌더가 템플릿 미허용 블록을 건너뛰므로(isBlockAllowed) 추가 메뉴 필터 + 기존 블록 경고에 사용
function BlockComposer({ blocks, onChange, uploadImage, template, cardStyle }: { blocks: any[]; onChange: (b: any[]) => void; uploadImage: (file: File) => Promise<string | null>; template?: string; cardStyle?: string }) {
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
                {/* ★ 2026-07-17 템플릿 미허용 블록 = 실물에서 조용히 사라짐(SDK 필터) → 정직 경고 (조용한 소실 차단) */}
                {b?.type && !isInAppBlockAllowed(template, String(b.type)) && (
                  <div className="mb-1.5 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-[10px] text-amber-900">
                    현재 표시 형태에서는 이 블록이 표시되지 않습니다. 형태를 바꾸거나 블록을 제거해주세요.
                  </div>
                )}
                <BlockEditor block={b} onChange={(patch) => update(i, patch)} uploadImage={uploadImage} cardStyle={cardStyle} />
              </SortableInAppBlock>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div ref={listEndRef} />

      <div className="relative">
        <button onClick={() => setShowAdd((v) => !v)} className="w-full text-xs text-violet-800 bg-violet-50 hover:bg-violet-100 border border-dashed border-violet-200 rounded-lg py-2 flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> 블록 추가
        </button>
        {showAdd && (
          <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3 space-y-3">
            {BLOCK_CATS.map((cat) => {
              // ★ 2026-07-17 템플릿 허용 블록만 노출 (SDK isBlockAllowed 미러) — 추가해도 실물에 안 나오는 항목 제거
              const items = BLOCK_ADD_MENU.filter((m) => m.cat === cat && isInAppBlockAllowed(template, m.type));
              if (items.length === 0) return null;
              return (
              <div key={cat}>
                <div className="text-[10px] font-bold text-slate-400 mb-1.5 tracking-wide">{cat}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  {items.map((m) => {
                    const Ic = m.icon;
                    return (
                      <button
                        key={m.type}
                        onClick={() => add(m.type)}
                        className="flex items-start gap-2 text-left bg-white hover:bg-violet-100 border border-slate-200 hover:border-violet-300 rounded-lg px-2.5 py-2 transition-colors"
                      >
                        <span className="w-6 h-6 rounded-md bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0 mt-0.5">
                          <Ic className="w-3.5 h-3.5 text-violet-800" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[11px] font-bold text-slate-700">{m.label}</span>
                          <span className="block text-[9px] text-slate-400 leading-tight mt-0.5">{m.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              );
            })}
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
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${value === o.v ? 'bg-violet-100 text-slate-900' : 'bg-white text-slate-500 hover:text-slate-700'}`}
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
          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${value === k ? 'bg-violet-100 border-violet-300' : 'bg-white border-slate-200 hover:bg-white'}`}
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
      <span className="text-xs text-slate-600 font-bold ml-1.5 tabular-nums">{Number(value || 0).toFixed(1)}</span>
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
  if (!isFinite(end)) return <span className="text-[10px] text-slate-400">마감 시각을 설정하면 남은 시간이 표시됩니다</span>;
  const remain = end - now;
  if (remain <= 0) return <span className="text-[10px] text-rose-700">이미 지난 시각. 자사몰에 표시되지 않습니다</span>;
  const s = Math.floor(remain / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return <span className="text-[10px] text-emerald-700 tabular-nums">지금 기준 {d > 0 ? `${d}일 ${h}시간` : `${h}시간 ${m}분`} 남음</span>;
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
        <div key={j} className="bg-white border border-slate-200 rounded-lg p-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIconOpenIdx(iconOpenIdx === j ? null : j)}
              className="w-8 h-8 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0"
              title="아이콘 선택"
            >
              <BlockIcon name={it.icon || 'check'} color="#e9d5ff" size={15} />
            </button>
            <input type="text" value={it.text || ''} onChange={(e) => setItem(j, { text: e.target.value })} placeholder="항목 텍스트" className={COMPOSER_INPUT} />
            <button onClick={() => onChange({ items: items.filter((_: any, x: number) => x !== j) })} className="text-rose-700 hover:text-rose-700 p-1 shrink-0" aria-label="항목 삭제"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
          {iconOpenIdx === j && (
            <IconGrid keys={ICON_KEYS} value={it.icon || 'check'} onChange={(k) => { setItem(j, { icon: k }); setIconOpenIdx(null); }} />
          )}
        </div>
      ))}
      {items.length < 4 && (
        <button onClick={() => onChange({ items: [...items, { icon: 'check', text: '' }] })} className="text-[11px] text-violet-700 hover:bg-violet-50 px-2 py-1 rounded flex items-center gap-1"><Plus className="w-3 h-3" /> 항목 추가</button>
      )}
    </div>
  );
}

// ★ 2026-09-04 cardStyle을 받는다 — 구도에 따라 **효과가 없는 컨트롤을 감추기 위해서다**(CTA 배치).
//   기본 카드는 SDK·미리보기 둘 다 layout으로 방향을 정하지만 말풍선은 칩을 가로로 고정한다.
function BlockEditor({ block, onChange, uploadImage, cardStyle }: { block: any; onChange: (patch: any) => void; uploadImage: (file: File) => Promise<string | null>; cardStyle?: string }) {
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
            <span className="text-[10px] text-slate-400">크기</span>
            <Seg options={[{ v: 'sm', label: '작게' }, { v: 'lg', label: '보통' }, { v: 'xl', label: '크게' }]} value={b.size || 'lg'} onChange={(v) => onChange({ size: v })} />
          </div>
        </div>
      );
    case 'body':
      return (
        <div className="space-y-1.5">
          <textarea value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="본문 (변수/Liquid 활용 가능)" className={`${COMPOSER_INPUT} resize-y h-16`} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">글자 크기</span>
            <Seg options={[{ v: 'sm', label: '작게' }, { v: 'md', label: '보통' }, { v: 'lg', label: '크게' }]} value={b.size || 'md'} onChange={(v) => onChange({ size: v })} />
          </div>
        </div>
      );
    case 'benefit':
      return (
        <div>
          <textarea value={b.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="[혜택 안내: 직접 작성해주세요]" className={`${COMPOSER_INPUT} resize-y h-14`} />
          <div className="text-[10px] text-amber-800 mt-1">혜택은 회사 정책에 맞게 직접 작성하세요. placeholder 그대로면 저장이 막힙니다.</div>
        </div>
      );
    case 'bullets':
      return <BulletsEditor b={b} onChange={onChange} />;
    case 'rating':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">별점 (클릭, 반쪽 = 0.5)</span>
            <StarInput value={Number(b.value ?? 0)} onChange={(v) => onChange({ value: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate-500">후기 수<input type="number" min={0} value={b.count ?? ''} onChange={(e) => onChange({ count: e.target.value === '' ? 0 : Number(e.target.value) })} className={COMPOSER_INPUT} /></label>
            <label className="text-[10px] text-slate-500">라벨<input type="text" value={b.label || ''} onChange={(e) => onChange({ label: e.target.value })} placeholder="후기" className={COMPOSER_INPUT} /></label>
          </div>
        </div>
      );
    case 'product':
      return (
        <div className="space-y-1.5">
          <div className="flex gap-2 items-start">
            {b.image ? (
              <div className="relative shrink-0">
                <img src={b.image} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className="w-14 h-14 object-cover rounded-lg border border-slate-200 bg-white" />
                <button onClick={() => onChange({ image: '' })} className="absolute -top-1.5 -right-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]" aria-label="이미지 제거">✕</button>
              </div>
            ) : (
              <label className="w-14 h-14 shrink-0 flex flex-col items-center justify-center text-[9px] text-slate-500 bg-white hover:bg-slate-100 border border-dashed border-slate-300 rounded-lg cursor-pointer transition-colors">
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
              <label className="text-[10px] text-slate-500 block mb-1">정가 (원)</label>
              <input type="number" min={0} value={b.price ?? ''} onChange={(e) => onChange({ price: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="예: 39000" className={COMPOSER_INPUT} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">할인가 (원)</label>
              <input type="number" min={0} value={b.discount_price ?? ''} onChange={(e) => onChange({ discount_price: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} placeholder="예: 29000" className={COMPOSER_INPUT} />
            </div>
          </div>
          <div className="text-[10px] text-slate-400">가격을 입력하면 카드에 가격이 표시되고(할인가는 강조 + 정가 취소선), 간단 설명은 가격이 없을 때만 표시됩니다.</div>
        </div>
      );
    case 'media':
      return (
        <div className="space-y-1.5">
          <Seg
            options={[{ v: 'icon', label: '아이콘' }, { v: 'illustration', label: '일러스트' }, { v: 'image', label: '이미지' }]}
            value={b.variant || 'icon'}
            onChange={(v) => onChange({ variant: v, ...(v !== 'image' ? { icon: v === 'illustration' ? 'welcome' : 'gift' } : { aspect: b.aspect || 'natural' }) })}
          />
          {b.variant === 'image' ? (
            <div className="space-y-1.5">
              {/* ★ 2026-07-21 전체보기(크롭 0)/채우기 토글 — 기본 전체보기. SDK·미리보기 aspect 미러 */}
              <Seg
                options={[{ v: 'full', label: '전체보기' }, { v: 'fill', label: '채우기' }]}
                value={String(b.aspect) === 'natural' ? 'full' : 'fill'}
                onChange={(v) => onChange({ aspect: v === 'full' ? 'natural' : '16:9' })}
              />
              {b.url && <img src={b.url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} className={`w-full rounded-lg border border-slate-200 ${String(b.aspect) === 'natural' ? 'max-h-56 object-contain' : 'max-h-28 object-cover'}`} />}
              <div className="flex gap-1.5 items-center">
                <label className="flex-1 text-center text-[11px] text-slate-600 bg-white hover:bg-slate-100 border border-dashed border-slate-300 rounded px-2 py-1.5 cursor-pointer transition-colors">
                  이미지 업로드 (2MB 이하)
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={async (e) => { const f = e.target.files?.[0]; const el = e.currentTarget; if (f) { const url = await uploadImage(f); if (url) onChange({ url }); } el.value = ''; }}
                  />
                </label>
                {b.url && <button onClick={() => onChange({ url: '' })} className="text-rose-700 hover:text-rose-700 px-2 py-1 text-[11px]">제거</button>}
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
          <div className="text-[10px] text-slate-500 mb-1">마감 시각: 날짜는 캘린더, 시간은 직접 입력</div>
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
      return <div className="text-[10px] text-slate-400">구분선 (옵션 없음)</div>;
    case 'cta_group':
      return (
        <div className="space-y-1.5">
          {/* ★ 2026-09-04 말풍선 카드는 SDK·미리보기 둘 다 칩을 가로로 고정해 그린다 —
              그 형태에서는 이 선택이 출력을 못 바꾸므로 컨트롤 자체를 감춘다(no_dead_controls). */}
          {cardStyle !== 'bubble' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400">정렬</span>
              <Seg options={[{ v: 'stack', label: '세로' }, { v: 'inline', label: '가로' }]} value={b.layout || 'stack'} onChange={(v) => onChange({ layout: v })} />
            </div>
          )}
          {(b.buttons || []).map((btn: any, j: number) => {
            const setBtn = (patch: any) => { const buttons = [...(b.buttons || [])]; buttons[j] = { ...buttons[j], ...patch }; onChange({ buttons }); };
            return (
              <div key={j} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input type="text" value={btn.label || ''} onChange={(e) => setBtn({ label: e.target.value })} placeholder="버튼 문구" className={COMPOSER_INPUT} />
                  <button onClick={() => onChange({ buttons: (b.buttons || []).filter((_: any, x: number) => x !== j) })} className="text-rose-700 hover:text-rose-700 p-1 shrink-0" aria-label="버튼 삭제"><Trash2 className="w-3.5 h-3.5" /></button>
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
            <button onClick={() => onChange({ buttons: [...(b.buttons || []), { id: `btn_${(b.buttons || []).length}`, label: '버튼', action_url: '[URL: 회사 admin 수정]', style: 'secondary' }] })} className="text-[11px] text-violet-700 hover:bg-violet-50 px-2 py-1 rounded flex items-center gap-1"><Plus className="w-3 h-3" /> 버튼 추가</button>
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
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">인앱 메시지를 표시할 곳이 없습니다</h3>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {reason || '인앱 메시지를 표시할 수 있는 쇼핑몰 연동이 없습니다. 카페24·고도몰·메이크샵·아임웹 연동 또는 자체 쇼핑몰에 SDK 설치 후 이용할 수 있습니다.'}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">표시할 곳이 없는 상태에서는 크레딧이 소모되는 생성·게시가 진행되지 않습니다.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onGoSettings} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-bold text-white">쇼핑몰 연동하러 가기</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-white">닫기</button>
        </div>
      </div>
    </div>
  );
}
