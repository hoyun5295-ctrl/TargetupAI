/**
 * DmBuilderPage — 모바일 DM 빌더 (D125 프로모델 v1)
 *
 * 목록 모드 ↔ 편집 모드 분기.
 * 편집 모드는 3분할 레이아웃 (좌측: 섹션 목록 / 중앙: 캔버스 / 우측: 속성 편집).
 *
 * 레거시(slides 모드) DM은 편집 불가 안내 + 새 에디터로 전환 버튼(15단계 구현 후 활성).
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { DmThumbnail, QuickStartThumbnail } from '../components/dm/DmThumbnails';
import axios from 'axios';
import { attachCreditInterceptor } from '../lib/credit-interceptor';
import { useDmBuilderStore } from '../stores/dmBuilderStore';
import { createSection } from '../utils/dm-section-defaults';
import { uploadOne } from '../components/dm/panels/FormControls';
import { useDmKeyboardShortcuts } from '../hooks/useDmKeyboardShortcuts';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { takeEventDraft, EVENT_DM_DRAFT_KEY } from '../components/EventCampaignModal';
import ImageToCopyButton from '../components/ImageToCopyButton';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import DmShortLinkModal from '../components/dm/DmShortLinkModal';
import DmSendAndTrackModal from '../components/DmSendAndTrackModal';
import DmTopBar from '../components/dm/DmTopBar';
import DmLeftPanel from '../components/dm/DmLeftPanel';
import DmCanvas from '../components/dm/DmCanvas';
import DmRightPanel from '../components/dm/DmRightPanel';
import AiPromptModal from '../components/dm/modals/AiPromptModal';
// 고객 데이터 없으면 AI 문안 생성 전 안내 (공용 게이트)
import { useCustomerDataGate, CustomerDataRequiredBanner, CustomerDataRequiredModal } from '../components/CustomerDataGate';
import AiImproveModal from '../components/dm/modals/AiImproveModal';
import ValidationModal from '../components/dm/modals/ValidationModal';
import VersionHistoryModal from '../components/dm/modals/VersionHistoryModal';
import BrandKitModal from '../components/dm/modals/BrandKitModal';
import DesignThemeModal from '../components/dm/modals/DesignThemeModal';
// ★ 2026-07-14 디자인 4.0 — 정예 템플릿(목적×스토리 구조, 서버 design-core 컴파일)
import EliteTemplateModal from '../components/dm/modals/EliteTemplateModal';
import AbTestModal from '../components/dm/modals/AbTestModal';
import ModalBase, { ModalButton } from '../components/dm/modals/ModalBase';
import '../styles/dm-builder.css';

const api = axios.create({ baseURL: '/api' });
attachCreditInterceptor(api);
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type DmSectionSummary = {
  types: string[];
  headline: string | null;
  accent: string | null;
  count: number;
};

type DmListItem = {
  id: string;
  title: string;
  store_name?: string;
  layout_mode?: string;
  approval_status?: string;
  short_code?: string | null;
  view_count?: number;
  page_count?: number;
  /** ★ 2026-07-02(3) 타겟 발송 이력 여부 — 카드 [발송 추적] 노출 */
  has_send_history?: boolean;
  section_summary?: DmSectionSummary;
  updated_at?: string;
};

// 빠른 시작 12 시나리오 — key = QuickStartThumbnail 시나리오 일러스트 매핑 (label은 backend scenario 전달용)
const QUICK_STARTS: Array<{ key: 'cart' | 'sale' | 'draw' | 'store' | 'survey' | 'welcome' | 'roulette' | 'lookbook' | 'reviews' | 'flashsale' | 'poll' | 'vip'; icon: string; label: string; hint: string; gradient: string; border: string; hover: string }> = [
  { key: 'cart',     icon: '🛍️', label: '신상품 출시', hint: '상품 슬라이드 + 구매 유도',  gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(168, 85, 247, 0.15))', border: 'rgba(168, 85, 247, 0.4)',  hover: 'rgba(168, 85, 247, 0.30)' },
  { key: 'sale',     icon: '🏷️', label: '시즌 세일',  hint: '카운트다운 + 쿠폰 + CTA',     gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.25), rgba(239, 68, 68, 0.15))',  border: 'rgba(244, 63, 94, 0.4)',  hover: 'rgba(244, 63, 94, 0.30)' },
  { key: 'draw',     icon: '🎁', label: '추첨 이벤트', hint: '응모 form + 자동 추첨',       gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(249, 115, 22, 0.15))', border: 'rgba(245, 158, 11, 0.4)', hover: 'rgba(245, 158, 11, 0.30)' },
  { key: 'store',    icon: '🗺️', label: '매장 안내',  hint: '지도 + 매장 위치',            gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(20, 184, 166, 0.15))', border: 'rgba(16, 185, 129, 0.4)', hover: 'rgba(16, 185, 129, 0.30)' },
  { key: 'survey',   icon: '📝', label: '설문 + 보상', hint: '설문 + 즉시 쿠폰 발급',       gradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.25), rgba(6, 182, 212, 0.15))',  border: 'rgba(14, 165, 233, 0.4)', hover: 'rgba(14, 165, 233, 0.30)' },
  { key: 'welcome',  icon: '✉️', label: '신규 환영',  hint: '이메일 수집 + 쿠폰',          gradient: 'linear-gradient(135deg, rgba(217, 70, 239, 0.25), rgba(236, 72, 153, 0.15))', border: 'rgba(217, 70, 239, 0.4)', hover: 'rgba(217, 70, 239, 0.30)' },
  { key: 'roulette', icon: '🎡', label: '룰렛 이벤트', hint: '8개 칸 회전 + 자동 당첨',     gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(139, 92, 246, 0.15))',  border: 'rgba(99, 102, 241, 0.4)', hover: 'rgba(99, 102, 241, 0.30)' },
  { key: 'lookbook',  icon: '🖼️', label: '갤러리 룩북',   hint: '화보 갤러리 + 상품',     gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.25), rgba(168, 85, 247, 0.15))', border: 'rgba(236, 72, 153, 0.4)', hover: 'rgba(236, 72, 153, 0.30)' },
  { key: 'reviews',   icon: '⭐', label: '리뷰 모음',     hint: '고객 후기 + 전환',       gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(234, 179, 8, 0.15))',  border: 'rgba(245, 158, 11, 0.4)', hover: 'rgba(245, 158, 11, 0.30)' },
  { key: 'flashsale', icon: '⏳', label: '선착순 한정특가', hint: '잔여 수량 + 카운트다운',  gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(249, 115, 22, 0.15))',  border: 'rgba(239, 68, 68, 0.4)',  hover: 'rgba(239, 68, 68, 0.30)' },
  { key: 'poll',      icon: '📊', label: '실시간 투표',   hint: '투표 + 실시간 결과',      gradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(59, 130, 246, 0.15))',  border: 'rgba(6, 182, 212, 0.4)',  hover: 'rgba(6, 182, 212, 0.30)' },
  { key: 'vip',       icon: '👑', label: 'VIP 초대',     hint: '프로모션 코드 + 고급 톤',  gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(129, 140, 248, 0.15))', border: 'rgba(99, 102, 241, 0.4)', hover: 'rgba(99, 102, 241, 0.30)' },
];

export default function DmBuilderPage() {
  const navigate = useNavigate();
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [list, setList] = useState<DmListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [legacyDmError, setLegacyDmError] = useState<string | null>(null);
  // ★ CT-17: 요금제 게이팅 (mobile_dm — PRO+)
  const [planLocked, setPlanLocked] = useState<{ msg: string } | null>(null);

  const dmId = useDmBuilderStore((s) => s.dmId);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const loadError = useDmBuilderStore((s) => s.loadError);
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const createNew = useDmBuilderStore((s) => s.createNew);
  const reset = useDmBuilderStore((s) => s.reset);
  const toast = useDmBuilderStore((s) => s.toast);
  const setToast = useDmBuilderStore((s) => s.setToast);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const [confirmBackOpen, setConfirmBackOpen] = useState(false);
  // ★ D216+ ConfirmModal generic (native confirm 영구 폐기)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ D216+ Journey 동급 디자인 — overview 5 metric + 자연어 입력
  const [overview, setOverview] = useState<{
    total_dm: number;
    published_dm: number;
    total_views_30d: number;
    unique_viewers_30d: number;
    total_responses_30d: number;
    avg_ctr_30d: number;
  } | null>(null);
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  // ★ D216+ 6 sub-agent 진행 시각 효과 (design_quality_minimum_journey_level 영구 룰 정합)
  const [generationStep, setGenerationStep] = useState<number>(-1); // -1 = 영역 X, 0~5 = 6 단계
  // ★ D216+ 자동 생성 직후 1-click floating bar (편집 모드 안 만족 영역 강화)
  const [showAiFloatingBar, setShowAiFloatingBar] = useState(false);
  const [floatingActionLoading, setFloatingActionLoading] = useState<string | null>(null);
  // ★ D216+ 목록 페이징 (Harold 명시 2026-05-25 — 가로 3개 × 2열 = 6개 영역)
  const DM_PAGE_SIZE = 6;
  const [currentPage, setCurrentPage] = useState(1);
  // 빠른시작·자연어 생성 전 5크레딧 차감 확인 (Harold 명시 — 즉시 차감 X)
  const [pendingGen, setPendingGen] = useState<{ prompt?: string; scenario?: string; desc: string } | null>(null);
  // ★ 2026-07-02(5) Harold 지시 — 빠른 시작 12 시나리오는 모달로 분리 (프롬프트 입력이 묻히지 않게)
  const [quickStartOpen, setQuickStartOpen] = useState(false);

  // ★ D216+ 키보드 단축키 활성 (편집 모드 한정)
  useDmKeyboardShortcuts({ enabled: mode === 'edit' });

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.get('/dm');
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      setList(items);
      setCurrentPage(1); // ★ D216+ 목록 refresh = 첫 페이지 진입 정합
      setPlanLocked(null);
    } catch (err: any) {
      // ★ CT-17: 403 PLAN_FEATURE_LOCKED → 요금제 가드 화면 표시
      if (err?.response?.status === 403 && err?.response?.data?.code === 'PLAN_FEATURE_LOCKED') {
        setPlanLocked({ msg: err.response.data.error || '모바일 DM은 프로 요금제 이상에서 이용 가능합니다.' });
      } else {
        setToast({ type: 'error', message: err?.response?.data?.error || '목록 로드 실패' });
      }
    } finally {
      setListLoading(false);
    }
  }, [setToast]);

  useEffect(() => {
    if (mode === 'list') refreshList();
  }, [mode, refreshList]);

  // ★ 2026-06-13: overview 로드 — 실패/지연해도 화면이 비지 않게 시도 완료 플래그로 구분
  const [overviewTried, setOverviewTried] = useState(false);
  // ★ 2026-07-10 고객사 자체 URL 단축(hlj.kr) 모달 — 박성용 신기능
  const [shortLinkOpen, setShortLinkOpen] = useState(false);
  useEffect(() => {
    if (mode !== 'list') return;
    setOverviewTried(false);
    (async () => {
      try {
        const res = await api.get('/dm/overview');
        if (res.data?.success) setOverview(res.data.data);
      } catch {
        // 실패 시 아래 렌더에서 목록 기반 폴백 값으로 표시 (빈 화면 차단)
      } finally {
        setOverviewTried(true);
      }
    })();
  }, [mode]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // ★ D216+ marketing_user_ux_priority 영구 룰 정합 — LayoutModePickerModal 영구 폐기
  //   "자유롭게 DM 생성" 클릭 = 즉시 scroll default + 편집 모드 진입 (마케팅 담당자 영역 옵션 차이 모름 영역 = 혼란 영역 영구 차단)
  //   layoutMode 변경 영역 = 편집 모드 안 DmTopBar 토글 영역 활용 정합
  // ★ 2026-06-19: 완성 이미지(디자인 시안) 업로드 → slideshow 섹션 자동 생성 진입
  const completedImagesInputRef = useRef<HTMLInputElement>(null);
  const uploadModeRef = useRef<'slides' | 'scroll'>('scroll'); // 완성 이미지 업로드: 좌우 슬라이드 / 세로 스크롤 선택
  const [uploadingImages, setUploadingImages] = useState(false);

  const handleCreateNew = () => {
    setLegacyDmError(null);
    createNew({ layoutMode: 'scroll' });
    setMode('edit');
  };

  // ★ D216+ 자동 생성 흐름 — 자연어 OR 시나리오 → AI 자동 sections + 카피 → 편집 모드 진입
  const applyAiGenerated = useDmBuilderStore((s) => s.applyAiGenerated);
  const save = useDmBuilderStore((s) => s.save);

  const handleAutoGenerate = useCallback(async (opts: { prompt?: string; scenario?: string }) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (generating) return;
    if (!opts.prompt && !opts.scenario) {
      setToast({ type: 'error', message: '만들 내용을 한 줄로 입력하거나 빠른 시작을 골라주세요.' });
      return;
    }
    setGenerating(true);
    setGenerationStep(0);
    setLegacyDmError(null);

    // ★ D216+ 6 sub-agent 진행 시각 효과 (700ms 간격)
    const stepTimer = setInterval(() => {
      setGenerationStep((s) => (s < 4 ? s + 1 : s));
    }, 700);

    try {
      const titleHint = opts.scenario || opts.prompt?.slice(0, 30) || '신규 DM';
      // 1. 신규 DM 생성 (모드는 AI 응답으로 applyAiGenerated에서 확정)
      createNew({ title: titleHint });
      // 2. AI 통합 생성 호출 (one-shot)
      const res = await api.post('/dm/ai/one-shot-generate', {
        prompt: opts.prompt || '',
        scenario: opts.scenario,
      });
      if (!res.data?.success) {
        throw new Error(res.data?.error || 'AI 생성 실패');
      }
      const { sections, brand_kit, pages, layout_mode } = res.data.data || {};
      // 3. 섹션 + brandKit + 레이아웃 모드/페이지 적용 (slides면 여러 페이지)
      applyAiGenerated(sections || [], brand_kit, opts.prompt || opts.scenario || '', { pages, layoutMode: layout_mode });
      // 4. 신규 dmId 저장
      await save({ silent: true });
      // 5. 6 단계 종결 표시
      clearInterval(stepTimer);
      setGenerationStep(5);
      await new Promise((r) => setTimeout(r, 400));
      // 6. 편집 모드 진입 + floating bar 표시 (자동 생성 직후만)
      setMode('edit');
      setShowAiFloatingBar(true);
      setToast({ type: 'success', message: `AI가 ${(sections || []).length}개 섹션 + 카피 자동 생성 종결 — 추가 1-click 액션 활용 가능` });
    } catch (err: any) {
      clearInterval(stepTimer);
      setToast({ type: 'error', message: err?.response?.data?.error || err?.message || 'AI 생성 실패' });
    } finally {
      clearInterval(stepTimer);
      setGenerating(false);
      setGenerationStep(-1);
      setNaturalLanguage('');
    }
  }, [generating, createNew, applyAiGenerated, save, setToast, customerGate.isEmpty]);

  // ★ 2026-07-07(4) 행사 캠페인 — EventCampaignModal이 생성해둔 DM 초안 자동 적용 (30분 TTL, 1회 소비)
  useEffect(() => {
    const d = takeEventDraft<{ prompt?: string; data?: any }>(EVENT_DM_DRAFT_KEY);
    if (!d?.data) return;
    try {
      const { sections, brand_kit, pages, layout_mode } = d.data;
      createNew({ title: String(d.prompt || '행사 캠페인').split('\n')[0].slice(0, 30) || '행사 캠페인' });
      applyAiGenerated(sections || [], brand_kit, String(d.prompt || ''), { pages, layoutMode: layout_mode });
      save({ silent: true }).catch(() => {});
      setMode('edit');
      setShowAiFloatingBar(true);
      setToast({ type: 'success', message: '행사 캠페인 DM 초안을 불러왔습니다 — 이미지만 올리고 다듬어주세요.' });
    } catch {
      // 초안 손상 = 조용히 무시 (일반 진입 흐름 무손상)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-06-19: 완성 이미지 업로드 → 슬라이드 DM 자동 생성 (외주 완성 시안 대응 — 신규 섹션 타입 불요, slideshow 재사용)
  const handleCompletedImagesSelected = useCallback(async (files: FileList | null, mode: 'slides' | 'scroll' = 'scroll') => {
    if (!files || files.length === 0) return;
    if (uploadingImages || generating) return;
    setUploadingImages(true);
    setLegacyDmError(null);
    try {
      const arr = Array.from(files);
      const urls: string[] = [];
      let failed = 0;
      for (const f of arr) {
        try { urls.push(await uploadOne(f)); } catch { failed += 1; }
      }
      if (urls.length === 0) {
        setToast({ type: 'error', message: '이미지 업로드에 실패했습니다. 다시 시도해주세요.' });
        return;
      }
      // 완성 이미지 N장 → 좌우 슬라이드(이미지당 1페이지 스와이프) 또는 세로 스크롤(1열 갤러리). 사용자 선택(mode).
      // ★ 슬라이드쇼 섹션은 16:9 크롭 + 발송 시 첫 장만 렌더 버그 → 페이지 스와이프(layoutMode 'slides')로 원본 비율·전 장 렌더.
      createNew({ title: '완성 이미지 DM' });
      if (mode === 'slides') {
        const pages = urls.map((u) => [createSection('gallery', 0, { images: [{ url: u }], layout: 'list_1xN' })]);
        applyAiGenerated(pages[0], undefined, '완성 이미지 업로드', { pages, layoutMode: 'slides' });
      } else {
        const gallery = createSection('gallery', 0, { images: urls.map((u) => ({ url: u })), layout: 'list_1xN' });
        applyAiGenerated([gallery], undefined, '완성 이미지 업로드', { layoutMode: 'scroll' });
      }
      await save({ silent: true });
      setMode('edit');
      setToast({
        type: 'success',
        message: `완성 이미지 ${urls.length}장으로 이미지 DM을 만들었어요${failed ? ` (${failed}장 실패)` : ''}. 편집에서 순서·캡션을 조정할 수 있어요.`,
      });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || err?.message || '이미지 DM 생성 실패' });
    } finally {
      setUploadingImages(false);
      if (completedImagesInputRef.current) completedImagesInputRef.current.value = '';
    }
  }, [uploadingImages, generating, createNew, applyAiGenerated, save, setToast]);

  // ★ D216+ 편집 모드 안 1-click floating action 영역 (자동 생성 직후 만족 강화)
  const handleFloatingAction = useCallback(async (action: 'ai_refine' | 'design_align' | 'variable_consistency') => {
    if (floatingActionLoading) return;
    setFloatingActionLoading(action);
    try {
      const dmId = useDmBuilderStore.getState().dmId;
      if (!dmId) {
        setToast({ type: 'error', message: 'DM 저장 후 활용 가능' });
        return;
      }
      const res = await api.post(`/dm/${dmId}/quick-action`, { action });
      if (!res.data?.success) {
        throw new Error(res.data?.error || '액션 실패');
      }
      // 변경 영역 재로드
      await useDmBuilderStore.getState().loadDm(dmId);
      const changes = res.data.data?.changes || [];
      const labelMap: Record<string, string> = {
        ai_refine: '카피 다듬기',
        design_align: '디자인 정합화',
        variable_consistency: '변수 일관성',
      };
      setToast({ type: 'success', message: `${labelMap[action]} 종결 — ${changes.length}개 섹션 정정` });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || err?.message || '액션 실패' });
    } finally {
      setFloatingActionLoading(null);
    }
  }, [floatingActionLoading, setToast]);

  // ★ D216+ 6 sub-agent 매트릭스 (Journey Builder 동급 디자인 영역 정합)
  const SUB_AGENTS = [
    { label: 'Brand Analysis',   desc: '회사 메모리 + 시즌 분석',      gradient: 'linear-gradient(135deg, #8b5cf6, #a855f7)' },
    { label: 'Layout Recommend', desc: '섹션 구조 자동 추천',           gradient: 'linear-gradient(135deg, #d946ef, #ec4899)' },
    { label: 'Copy Generate',    desc: '카피 자동 생성 (감성 + 실용)',  gradient: 'linear-gradient(135deg, #6366f1, #3b82f6)' },
    { label: 'Variable Bind',    desc: '변수 자동 추천 + fallback',     gradient: 'linear-gradient(135deg, #10b981, #14b8a6)' },
    { label: 'Validate',         desc: '검수 + 정합 확인',              gradient: 'linear-gradient(135deg, #0ea5e9, #06b6d4)' },
    { label: 'Ready',            desc: '편집 모드 진입 종결',           gradient: 'linear-gradient(135deg, #f59e0b, #f97316)' },
  ];

  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleEdit = async (id: string, itemLayoutMode?: string) => {
    setLegacyDmError(null);
    // ★ 2026-06-23: layout_mode='slides'는 새 섹션형 슬라이드(가로 스와이프)와 기존 D119 이미지 슬라이드 양쪽에 쓰인다.
    //   섹션 콘텐츠가 있으면 새 에디터에서 바로 편집 — 콘텐츠 없는 진짜 레거시(D119)만 변환 안내.
    const editItem = list.find((d) => d.id === id);
    const isTrueLegacy = itemLayoutMode === 'slides' && ((editItem?.section_summary?.types?.length ?? 0) === 0);
    if (isTrueLegacy) {
      // ★ D216+ ConfirmModal (옛 native confirm 영구 폐기)
      setConfirm({
        mode: 'warning',
        title: '레거시 슬라이드 모드 DM 변환',
        description: '이 DM은 옛 슬라이드 모드입니다. 새 에디터로 변환하면 섹션 기반 구조로 바뀝니다.\n변환 후에는 새 에디터에서 편집 가능하며, 필요 시 백업에서 되돌릴 수 있어요.',
        confirmLabel: '변환하고 진입',
        cancelLabel: '취소',
        onConfirm: async () => {
          setConvertingId(id);
          try {
            const res = await api.post(`/dm/${id}/convert-to-scroll`);
            setToast({ type: 'success', message: `변환 완료 (${res.data.converted_sections}개 섹션)` });
            await loadDm(id);
            setMode('edit');
          } catch (err: any) {
            setToast({ type: 'error', message: err?.response?.data?.error || '변환 실패' });
          } finally {
            setConvertingId(null);
          }
        },
      });
      return;
    }
    await loadDm(id);
    setMode('edit');
  };

  const handleDelete = async (id: string) => {
    // ★ D216+ ConfirmModal (옛 native confirm 영구 폐기)
    setConfirm({
      mode: 'danger',
      title: 'DM 삭제',
      description: '이 DM을 삭제할까요? 되돌릴 수 없어요.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          await api.delete(`/dm/${id}`);
          setToast({ type: 'success', message: '삭제했어요.' });
          refreshList();
        } catch (err: any) {
          setToast({ type: 'error', message: err?.response?.data?.error || '삭제 실패' });
        }
      },
    });
  };

  // ★ 2026-06-13: DM 복제 (AI 호출 0 = 크레딧 차감 없음)
  const [cloningId, setCloningId] = useState<string | null>(null);
  const handleClone = async (id: string) => {
    if (cloningId) return;
    setCloningId(id);
    try {
      await api.post(`/dm/${id}/clone`);
      setToast({ type: 'success', message: '복제했어요. "사본"으로 추가됐어요.' });
      await refreshList();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '복제 실패' });
    } finally {
      setCloningId(null);
    }
  };

  // ★ 2026-07-02(3) 발송 이력 카드 → 발송 추적 모달(track 직행) — 수신자별 열람·깊이·클릭·응모
  const [trackTarget, setTrackTarget] = useState<{ id: string; title?: string } | null>(null);

  // 발행 주소 복사 — 이미 발행된 DM은 발행 멱등(추가 과금 0)이라 그대로 short_url 재사용. 편집 재발행 불필요.
  const handleCopyUrl = async (id: string) => {
    try {
      const res = await api.post(`/dm/${id}/publish`);
      const url = res?.data?.short_url || '';
      if (!url) { setToast({ type: 'error', message: '발행 주소를 찾지 못했어요. 편집에서 발행 후 다시 시도해주세요.' }); return; }
      await navigator.clipboard.writeText(url);
      setToast({ type: 'success', message: '발행 주소를 복사했어요. (이미 발행 — 추가 과금 없음)' });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '주소 복사 실패' });
    }
  };

  const handleBackToList = () => {
    reset();
    setMode('list');
  };

  // ← 상단바 뒤로가기: 변경사항 있으면 경고 모달, 없으면 즉시 목록으로
  const handleBackRequest = () => {
    if (isDirty) {
      setConfirmBackOpen(true);
    } else {
      handleBackToList();
    }
  };

  // ── 편집 모드 ──
  if (mode === 'edit') {
    return (
      <div className="dm-builder" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBarWithBack onBack={handleBackRequest} onPublishDone={handleBackToList} />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <DmLeftPanel />
          <DmCanvas />
          <DmRightPanel />
        </div>
        <EditorModals />
        <ConfirmDiscardModal
          open={confirmBackOpen}
          onClose={() => setConfirmBackOpen(false)}
          onConfirm={() => {
            setConfirmBackOpen(false);
            handleBackToList();
          }}
        />
        <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

        {/* ★ D216+ 1-click floating action bar (자동 생성 직후 만족 강화) */}
        {showAiFloatingBar && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: 16,
            padding: '14px 18px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(168, 85, 247, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 100,
            maxWidth: '90vw',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ fontSize: 18 }}>✨</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>AI 추천 액션</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>1 클릭 즉시 정정</div>
              </div>
            </div>

            {[
              { action: 'ai_refine' as const,           label: '카피 다듬기',      icon: '✍️', accent: '#f43f5e' },
              { action: 'design_align' as const,        label: '디자인 정합화',    icon: '🎨', accent: '#10b981' },
              { action: 'variable_consistency' as const, label: '변수 일관성',     icon: '🔗', accent: '#f59e0b' },
            ].map((a) => (
              <button
                key={a.action}
                onClick={() => handleFloatingAction(a.action)}
                disabled={!!floatingActionLoading}
                style={{
                  padding: '8px 12px',
                  background: floatingActionLoading === a.action ? `${a.accent}33` : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${floatingActionLoading === a.action ? a.accent : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: floatingActionLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s',
                  opacity: floatingActionLoading && floatingActionLoading !== a.action ? 0.4 : 1,
                }}
                onMouseEnter={(e) => { if (!floatingActionLoading) { e.currentTarget.style.background = `${a.accent}22`; e.currentTarget.style.borderColor = `${a.accent}66`; } }}
                onMouseLeave={(e) => { if (floatingActionLoading !== a.action) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; } }}
              >
                <span style={{ fontSize: 14 }}>{a.icon}</span>
                <span>{floatingActionLoading === a.action ? '처리 중...' : a.label}</span>
              </button>
            ))}

            <button
              onClick={() => setShowAiFloatingBar(false)}
              style={{
                marginLeft: 4,
                width: 28, height: 28,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: 'rgba(255,255,255,0.6)',
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="닫기"
            >
              ✕
            </button>
          </div>
        )}

        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  // ── 요금제 게이팅 (CT-17, mobile_dm) ──
  if (planLocked) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#020617,#0f172a,#020617)', fontFamily: 'var(--dm-font-primary)', color: '#fff', display: 'flex', flexDirection: 'column' }}>
        <header style={{ background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => goBackOr(navigate, '/ai-operator')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: '#fff' }} title="AI Operator로">←</button>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>모바일 DM 빌더</h1>
          <span style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(139,92,246,0.2)', color: '#c4b5fd', borderRadius: 12, fontWeight: 700 }}>PRO</span>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{ maxWidth: 480, textAlign: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '40px 32px', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📱</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#fff' }}>프로 요금제 전용 기능</h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              {planLocked.msg}<br />
              업그레이드하시면 AI 구조·카피 자동 생성, 검수 10종, A/B 테스트까지 바로 이용하실 수 있어요.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => navigate('/pricing')}
                style={{ height: 44, padding: '0 24px', background: 'rgba(139,92,246,0.3)', color: '#ddd6fe', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                요금제 안내 보기
              </button>
              <button
                onClick={() => navigate('/ai-operator')}
                style={{ height: 44, padding: '0 20px', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                AI Operator로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 모드 ──
  // overview 폴백 — 실패/지연 시에도 화면이 비지 않게 목록 길이로 전체 DM 수만 채움
  const ov = overview ?? {
    total_dm: list.length,
    published_dm: 0,
    total_views_30d: 0,
    unique_viewers_30d: 0,
    total_responses_30d: 0,
    avg_ctr_30d: 0,
  };
  const metricsLoading = !overviewTried;
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#020617,#0f172a,#020617)', fontFamily: 'var(--dm-font-primary)', color: '#fff' }}>
      <header style={{ background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => goBackOr(navigate, '/ai-operator')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: '#fff' }} title="AI Operator로">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>모바일 DM 빌더</h1>
            <span style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(139,92,246,0.2)', color: '#c4b5fd', borderRadius: 12, fontWeight: 700 }}>PRO</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '2px 0 0 0' }}>카드형 모바일 DM 빌더 — 미디어 메세지 디자인 + 카드 단위 편집</p>
        </div>
        {/* ★ 2026-07-10 고객사 자체 URL 단축(hlj.kr) — 박성용 신기능(Harold 위치 확정: 새 DM 만들기 왼쪽) */}
        <button
          onClick={() => setShortLinkOpen(true)}
          style={{ height: 36, padding: '0 16px', background: 'rgba(255,255,255,0.06)', color: '#e9d5ff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          🔗 단축 URL
          <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(52,211,153,0.18)', color: '#6ee7b7', borderRadius: 10, fontWeight: 700 }}>NEW</span>
        </button>
        <button
          onClick={handleCreateNew}
          style={{ height: 36, padding: '0 16px', background: 'rgba(139,92,246,0.3)', color: '#ddd6fe', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + 새 DM 만들기
        </button>
      </header>

      <DmShortLinkModal open={shortLinkOpen} onClose={() => setShortLinkOpen(false)} />

      {legacyDmError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fde68a', fontSize: 13 }}>
          {legacyDmError}
        </div>
      )}
      {loadError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
        {/* ★ D216+ Journey 동급 디자인 — 자연어 입력 + 빠른 시작 7 카드 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(217,70,239,0.10), rgba(168,85,247,0.08), rgba(99,102,241,0.10))',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>자연어 한 줄로 DM 자동 생성</span>
          </div>
          {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-3" />}
          {/* ★ 2026-07-02(5) Harold 지시 재배치 — 좌: 프롬프트 단독(크게) / 우: 빠른 시작(위) + 자유 시작·완성 슬라이드(아래) */}
          <style>{`
            .dm-hub-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
            .dm-hub-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            @media (max-width: 767px) { .dm-hub-grid { grid-template-columns: 1fr; } }
          `}</style>
          <div className="dm-hub-grid">
            {/* 좌 — 프롬프트 입력 */}
            <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>만들 내용을 한 줄로 적어주세요</div>
              <textarea
                value={naturalLanguage}
                onChange={(e) => setNaturalLanguage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (naturalLanguage.trim() && !generating) setPendingGen({ prompt: naturalLanguage.trim(), desc: `"${naturalLanguage.trim()}" 내용으로 AI가 섹션과 카피를 자동 생성합니다.` });
                  }
                }}
                disabled={generating}
                placeholder={'예: "봄 신상 프로모션, 30대 여성, 추첨 이벤트"\nEnter = AI 자동 생성 · Shift+Enter = 줄바꿈'}
                style={{
                  flex: 1, minHeight: 128, padding: '12px 14px',
                  background: 'rgba(2,6,23,0.5)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10, fontSize: 14, lineHeight: 1.6, color: '#fff', outline: 'none',
                  resize: 'none', opacity: generating ? 0.6 : 1,
                }}
              />
              <ImageToCopyButton
                label="이미지로 불러오기"
                onExtracted={(t) => setNaturalLanguage((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-violet-400/40 bg-violet-500/10 text-violet-100 text-sm font-medium py-2.5 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
              />
              <button
                onClick={() => { if (naturalLanguage.trim() && !generating) { setPendingGen({ prompt: naturalLanguage.trim(), desc: `"${naturalLanguage.trim()}" 내용으로 AI가 섹션과 카피를 자동 생성합니다.` }); } }}
                disabled={!naturalLanguage.trim() || generating}
                style={{
                  height: 46,
                  background: naturalLanguage.trim() && !generating ? 'linear-gradient(135deg, #a855f7, #d946ef)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', border: 'none', borderRadius: 10,
                  fontSize: 14, fontWeight: 700,
                  cursor: naturalLanguage.trim() && !generating ? 'pointer' : 'not-allowed',
                  opacity: naturalLanguage.trim() && !generating ? 1 : 0.4,
                }}
              >
                {generating ? 'AI 생성 중...' : '✨ 자동 생성'}
              </button>
            </div>

            {/* 우 — 위: 빠른 시작 / 아래: 자유 시작 · 완성 슬라이드 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { if (!generating) setQuickStartOpen(true); }}
                disabled={generating}
                style={{
                  flex: 1, minHeight: 104, padding: '14px 16px', textAlign: 'center',
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(217,70,239,0.12))',
                  border: '1px solid rgba(168,85,247,0.45)', borderRadius: 14,
                  cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>빠른 시작</span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>12가지 시나리오 — 카드 클릭 즉시 AI가 섹션 + 카피를 만들고 편집 모드로 들어갑니다</div>
                <div style={{ fontSize: 13, marginTop: 8, letterSpacing: 2 }}>🛍️ 🏷️ 🎁 🗺️ 📝 ✉️ 🎡 🖼️ ⭐ ⏳ 📊 👑</div>
              </button>
              <div className="dm-hub-bottom">
                <button
                  onClick={handleCreateNew}
                  disabled={generating}
                  style={{
                    minHeight: 84, padding: '12px 14px', textAlign: 'center',
                    background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 12,
                    cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 15 }}>📄</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>자유 시작</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>빈 캔버스에서 직접 섹션 추가</div>
                </button>
                <button
                  onClick={() => { uploadModeRef.current = 'slides'; completedImagesInputRef.current?.click(); }}
                  disabled={generating || uploadingImages}
                  style={{
                    minHeight: 84, padding: '12px 14px', textAlign: 'center',
                    background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 12,
                    cursor: (generating || uploadingImages) ? 'not-allowed' : 'pointer', opacity: (generating || uploadingImages) ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 15 }}>🖼️</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{uploadingImages ? '업로드 중...' : '완성 슬라이드'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>완성 이미지 업로드 → 슬라이드 DM</div>
                </button>
              </div>
            </div>
          </div>

          {/* ★ D216+ 6 sub-agent 진행 시각 효과 (generating 활성 시점만 표시) */}
          {generating && generationStep >= 0 && (
            <div style={{ marginTop: 14, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'dm-spin 1s linear infinite' }} />
                AI 자동 생성 진행 중
              </div>
              <style>{`@keyframes dm-spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SUB_AGENTS.map((agent, i) => {
                  const isDone = i < generationStep;
                  const isActive = i === generationStep;
                  const isPending = i > generationStep;
                  return (
                    <div key={agent.label} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      background: isActive ? `rgba(168, 85, 247, 0.15)` : isDone ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? 'rgba(168, 85, 247, 0.5)' : isDone ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                      borderRadius: 8,
                      opacity: isPending ? 0.4 : 1,
                      transition: 'all 0.3s',
                    }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', background: agent.gradient, flexShrink: 0 }}>
                        {isDone ? '✓' : isActive ? '◐' : i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{agent.label}</div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{agent.desc}</div>
                      </div>
                      {isActive && (
                        <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'dm-spin 0.8s linear infinite', flexShrink: 0 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ★ 2026-06-19: 완성 이미지(디자인 시안) 업로드 → 슬라이드 DM 자동 생성 (외주 완성본 대응)
              2026-07-02(5): 진입 버튼은 우측 [완성 슬라이드] 타일로 통합 (가로/세로 선택지 폐지 — Harold 지시) */}
          <input
            ref={completedImagesInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleCompletedImagesSelected(e.target.files, uploadModeRef.current)}
          />
        </div>

        {/* ★ 2026-07-02(5) 빠른 시작 12 시나리오 — 모달 (시나리오 클릭 = 즉시 AI 생성 확인 → 편집 진입) */}
        {quickStartOpen && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 980, maxHeight: '88vh', overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', padding: 20 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>빠른 시작</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>시나리오 클릭 = 즉시 AI가 섹션 + 카피 생성</span>
                </div>
                <button onClick={() => setQuickStartOpen(false)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', padding: 6 }} aria-label="닫기">✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {QUICK_STARTS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => { setQuickStartOpen(false); if (!generating) setPendingGen({ scenario: s.label, desc: `${s.label} — ${s.hint}. AI가 어울리는 섹션과 카피를 자동 생성합니다.` }); }}
                    disabled={generating}
                    style={{
                      padding: '14px 10px 12px',
                      background: s.gradient,
                      border: `1px solid ${s.border}`,
                      borderRadius: 12,
                      cursor: generating ? 'not-allowed' : 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.25s ease',
                      opacity: generating ? 0.5 : 1,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                    onMouseEnter={(e) => {
                      if (!generating) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = `0 8px 20px ${s.hover}, 0 1px 3px rgba(0,0,0,0.3)`;
                        e.currentTarget.style.borderColor = s.hover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
                      e.currentTarget.style.borderColor = s.border;
                    }}
                  >
                    <div style={{ marginBottom: 8 }}><QuickStartThumbnail scenarioKey={s.key} /></div>
                    <div style={{ fontSize: 18, marginBottom: 2 }}>{s.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>{s.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 내 DM 현황 — 지표는 항상 표시 (로딩 중 스켈레톤, 실패해도 0으로) */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', margin: '4px 4px 10px' }}>내 DM 현황</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
          marginBottom: 20,
        }}>
          {[
            { label: '전체 DM', value: metricsLoading ? '—' : ov.total_dm.toLocaleString(), accent: '#a855f7' },
            { label: '발행', value: metricsLoading ? '—' : ov.published_dm.toLocaleString(), accent: '#10b981' },
            { label: '30일 열람', value: metricsLoading ? '—' : ov.total_views_30d.toLocaleString(), accent: '#06b6d4' },
            { label: '고유 시청자', value: metricsLoading ? '—' : ov.unique_viewers_30d.toLocaleString(), accent: '#f59e0b' },
            { label: '평균 클릭률', value: metricsLoading ? '—' : `${ov.avg_ctr_30d}%`, accent: '#ec4899' },
          ].map((m) => (
            <div key={m.label} style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: 14,
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: metricsLoading ? 'rgba(255,255,255,0.25)' : m.accent }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* AI 진단 카드 — 항상 표시 (자연 한국어) */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.10), rgba(217, 70, 239, 0.15))',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          borderRadius: 14,
          padding: 18,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>AI 진단</span>
            <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(168, 85, 247, 0.3)', color: '#e9d5ff', borderRadius: 10, fontWeight: 700 }}>실시간</span>
          </div>
          <div style={{ fontSize: 14, color: '#fff', lineHeight: 1.6, marginBottom: 6 }}>
            {(() => {
              if (metricsLoading) return '현황을 불러오는 중이에요.';
              if (ov.total_dm === 0) return '아직 만든 DM이 없어요. 위 빠른 시작 카드를 누르면 AI가 1분 만에 만들어 드려요.';
              if (ov.published_dm === 0) return `DM ${ov.total_dm}개를 작성 중이에요. 검수 후 발행하면 고객에게 보낼 수 있어요.`;
              if (ov.total_views_30d < 50) return `발행한 DM의 열람이 쌓이는 중이에요. 데이터가 더 모이면 정확히 분석해 드릴게요.`;
              if (ov.avg_ctr_30d >= 5) return `평균 클릭률 ${ov.avg_ctr_30d}% — 아주 좋아요. 성과 좋은 DM의 구성을 다른 캠페인에도 활용해 보세요.`;
              if (ov.avg_ctr_30d >= 2) return `평균 클릭률 ${ov.avg_ctr_30d}% — 무난해요. AI 카피 다듬기로 더 끌어올릴 수 있어요.`;
              return `평균 클릭률 ${ov.avg_ctr_30d}% — 개선 여지가 있어요. CTA 위치와 카피, 이미지를 점검해 보세요.`;
            })()}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginTop: 8 }}>
            집계 — 최근 30일 열람·이벤트 응답 데이터
          </div>
        </div>

        {/* 1-click 액션 3 카드 — DM이 1개 이상일 때 (로딩 중엔 숨김) */}
        {!metricsLoading && ov.total_dm > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { icon: '✍️', label: 'AI 카피 다듬기',   desc: '전체 섹션 카피 톤을 하나로', gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.2), rgba(239, 68, 68, 0.1))',  border: 'rgba(244, 63, 94, 0.4)',  action: 'ai_refine' },
              { icon: '🎨', label: '디자인 맞추기',    desc: '브랜드 색상 자동 적용',     gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(20, 184, 166, 0.1))', border: 'rgba(16, 185, 129, 0.4)', action: 'design_align' },
              { icon: '🔗', label: '변수 채우기',      desc: '빈 변수에 기본값 자동 보완', gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(249, 115, 22, 0.1))', border: 'rgba(245, 158, 11, 0.4)', action: 'variable_consistency' },
            ].map((a) => (
              <button
                key={a.action}
                onClick={() => setToast({ type: 'info', message: 'DM 편집 화면에서 바로 쓸 수 있어요. 먼저 DM을 선택해 주세요.' })}
                style={{
                  padding: 14,
                  background: a.gradient,
                  border: `1px solid ${a.border}`,
                  borderRadius: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.25s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 22 }}>{a.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{a.label}</span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{a.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* 자세히 보기 토글 — 항상 표시 */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setDetailExpanded(!detailExpanded)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.7)',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {detailExpanded ? '▲' : '▼'} 자세히 보기
          </button>
          {detailExpanded && (
            <div style={{
              marginTop: 12,
              padding: 14,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                30일 이벤트 응답: <strong style={{ color: '#fff' }}>{ov.total_responses_30d.toLocaleString()}건</strong>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                클릭률 = 이벤트 응답 ÷ 열람 × 100. 응답은 설문·응모·이메일 수집·추첨 등 고객 인터랙션을 합산해요.
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                집계 — 최근 30일 열람 + 이벤트 응답
              </div>
            </div>
          )}
        </div>

        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.5)' }}>불러오는 중...</div>
        ) : list.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '48px 20px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 14,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(168,85,247,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📱</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>아직 만든 DM이 없어요</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>위에서 한 줄만 입력하거나 빠른 시작 카드를 누르면<br />AI가 1분 만에 첫 DM을 만들어 드려요.</div>
            <button
              onClick={() => { if (!generating) setPendingGen({ scenario: QUICK_STARTS[0].label, desc: `${QUICK_STARTS[0].label} — ${QUICK_STARTS[0].hint}. AI가 어울리는 섹션과 카피를 자동 생성합니다.` }); }}
              disabled={generating}
              style={{
                marginTop: 4, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #a855f7, #d946ef)', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1,
              }}
            >
              AI로 첫 DM 만들기
            </button>
          </div>
        ) : (() => {
          // ★ D216+ 페이징 매트릭스 (Harold 명시 — 가로 3개 × 2열 = 6개)
          const totalPages = Math.max(1, Math.ceil(list.length / DM_PAGE_SIZE));
          const safePage = Math.min(currentPage, totalPages);
          const start = (safePage - 1) * DM_PAGE_SIZE;
          const paginatedList = list.slice(start, start + DM_PAGE_SIZE);
          const startIdx = list.length === 0 ? 0 : start + 1;
          const endIdx = Math.min(start + DM_PAGE_SIZE, list.length);

          return (
            <>
              {/* 목록 상단 영역 — 총 개수 + 현재 페이지 표시 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <span>총 <strong style={{ color: '#fff' }}>{list.length}</strong>개 DM</span>
                <span>{startIdx}–{endIdx} 표시 중</span>
              </div>

              {/* 카드 영역 — 고정 트랙 + 가운데 정렬(카드 1~2개여도 중앙). 모바일 1열 자동 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 264px))',
                justifyContent: 'center',
                gap: 16,
                marginBottom: 20,
              }}>
                {paginatedList.map((dm) => (
                  <DmCard
                    key={dm.id}
                    dm={dm}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onClone={handleClone}
                    onCopyUrl={handleCopyUrl}
                    onTrack={(id, title) => setTrackTarget({ id, title })}
                    cloning={cloningId === dm.id}
                  />
                ))}
                {/* 희소 상태 — 1~2개면 빈칸을 다음 추천 DM ghost 카드로 (첫 페이지만) */}
                {safePage === 1 && list.length > 0 && list.length < 3 && (() => {
                  const used = new Set(list.map((d) => (d.title || '').replace(/ 사본$/, '')));
                  const next = QUICK_STARTS.find((q) => !used.has(q.label)) || QUICK_STARTS[1];
                  return (
                    <button
                      onClick={() => { if (!generating) setPendingGen({ scenario: next.label, desc: `${next.label} — ${next.hint}. AI가 어울리는 섹션과 카피를 자동 생성합니다.` }); }}
                      disabled={generating}
                      style={{
                        border: '1px dashed rgba(255,255,255,0.2)',
                        borderRadius: 14,
                        background: 'rgba(255,255,255,0.02)',
                        cursor: generating ? 'not-allowed' : 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 10, padding: 16, minHeight: 240, textAlign: 'center',
                        opacity: generating ? 0.5 : 1, transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => { if (!generating) e.currentTarget.style.borderColor = 'rgba(168,85,247,0.5)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                    >
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(168,85,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{next.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>다음 추천 — {next.label}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>클릭하면 AI가 바로 만들어 드려요</div>
                    </button>
                  );
                })()}
              </div>

              {/* 페이징 컨트롤 (totalPages > 1 영역만 표시) */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    style={{
                      width: 36, height: 36,
                      background: safePage === 1 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: safePage === 1 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
                      borderRadius: 8,
                      cursor: safePage === 1 ? 'not-allowed' : 'pointer',
                      fontSize: 14, fontWeight: 700,
                      transition: 'all 0.2s',
                    }}
                    title="이전 페이지"
                  >
                    ‹
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                    const isActive = p === safePage;
                    return (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        style={{
                          minWidth: 36, height: 36, padding: '0 10px',
                          background: isActive ? 'linear-gradient(135deg, #8b5cf6, #a855f7)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isActive ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255,255,255,0.1)'}`,
                          color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: isActive ? 800 : 600,
                          transition: 'all 0.2s',
                          boxShadow: isActive ? '0 2px 8px rgba(168, 85, 247, 0.4)' : 'none',
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    style={{
                      width: 36, height: 36,
                      background: safePage === totalPages ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: safePage === totalPages ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)',
                      borderRadius: 8,
                      cursor: safePage === totalPages ? 'not-allowed' : 'pointer',
                      fontSize: 14, fontWeight: 700,
                      transition: 'all 0.2s',
                    }}
                    title="다음 페이지"
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </main>

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* 고객 데이터 없음 — 생성 차단 안내 */}
      <CustomerDataRequiredModal open={showDataGate} onClose={() => setShowDataGate(false)} />

      <CreditConfirmModal
        open={!!pendingGen}
        source="dm-ai-generate"
        description={pendingGen?.desc}
        onConfirm={() => {
          const g = pendingGen;
          setPendingGen(null);
          if (g) void handleAutoGenerate({ prompt: g.prompt, scenario: g.scenario });
        }}
        onCancel={() => setPendingGen(null)}
      />

      {/* ★ 2026-07-02(3) 카드 [발송 추적] — 추적 탭 직행 */}
      {trackTarget && (
        <DmSendAndTrackModal dmId={trackTarget.id} dmTitle={trackTarget.title} show initialView="track" onClose={() => setTrackTarget(null)} />
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function TopBarWithBack({ onBack, onPublishDone }: { onBack: () => void; onPublishDone: () => void }) {
  const saveStore = useDmBuilderStore((s) => s.save);
  const dmId = useDmBuilderStore((s) => s.dmId);
  const setToast = useDmBuilderStore((s) => s.setToast);
  // ★ 2026-07-02(3) 발행 여부 = 발행 축(status/short_code) isPublished — 구 approval_status(검수 축) 판정이
  //   이미 발행(100크레딧 차감)된 DM에도 크레딧 모달을 다시 띄우던 결함 수정
  const isPublished = useDmBuilderStore((s) => s.isPublished);
  const setPublished = useDmBuilderStore((s) => s.setPublished);
  // ★ 2026-07-02 (Harold 명시 크레딧 모달 기준): 인터랙션 DM(추첨·룰렛·설문 등)은 발행 120 차감인데
  //   모달이 항상 dm-builder(100)로 떠 표시≠실차감이던 결함 수정 — 백엔드 isInteractionCampaign과 동일 기준.
  const pages = useDmBuilderStore((s) => s.pages);
  const INTERACTION_TYPES = ['lucky_draw', 'roulette', 'poll', 'survey', 'email_capture', 'click_rewards'];
  const hasInteraction = pages.some((p: any) => (p?.sections || []).some((sec: any) => sec && INTERACTION_TYPES.includes(sec.type)));
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);

  const handleTestSend = async () => {
    if (!dmId) {
      setToast({ type: 'error', message: '먼저 저장 후 테스트 발송이 가능해요.' });
      return;
    }
    try {
      await api.post(`/dm/${dmId}/test-send`, { sample_key: 'vip' });
      setToast({ type: 'success', message: '테스트 발송 요청을 보냈어요.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '테스트 발송 실패' });
    }
  };

  const handlePublish = async () => {
    await saveStore();
    if (dmId) {
      try {
        const res = await api.post(`/dm/${dmId}/publish`);
        setPublished(true); // 발행 확정 — 버튼 [발송] 전환 + 이후 크레딧 모달 미노출
        const url = res?.data?.short_url || '';
        if (url) {
          // 발행 완료 → 단축 URL 확인·복사 모달. 목록 이동은 모달 확인 시.
          setPublishedUrl(url);
          return;
        }
        setToast({ type: 'success', message: '발행했어요.' });
      } catch (err: any) {
        setToast({ type: 'error', message: err?.response?.data?.error || '발행 실패' });
        return;
      }
    }
    onPublishDone();
  };

  return (
    <>
      <DmTopBar
        onBack={onBack}
        onTestSendClick={handleTestSend}
        // 발행 완료 = 크레딧 모달 없이 바로 타겟 발송 모달 / 미발행 = 크레딧 확인 후 발행
        onPublishClick={() => { if (isPublished) { setSendModalOpen(true); } else { setConfirmPublish(true); } }}
      />
      <CreditConfirmModal
        open={confirmPublish}
        source={hasInteraction ? 'dm-interaction-publish' : 'dm-builder'}
        onConfirm={() => { setConfirmPublish(false); handlePublish(); }}
        onCancel={() => setConfirmPublish(false)}
      />
      <ModalBase
        open={!!publishedUrl}
        onClose={() => { setPublishedUrl(null); onPublishDone(); }}
        title="발행 완료"
        subtitle="아래 단축 URL을 복사해 고객에게 발송하세요."
        size="sm"
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => { setPublishedUrl(null); onPublishDone(); }}>확인</ModalButton>
            <ModalButton variant="primary" onClick={() => { setPublishedUrl(null); setSendModalOpen(true); }}>타겟 고객에게 발송</ModalButton>
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px' }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#4f46e5', wordBreak: 'break-all', userSelect: 'all' }}>{publishedUrl}</span>
          <ModalButton
            variant="secondary"
            onClick={async () => {
              if (!publishedUrl) return;
              try { await navigator.clipboard.writeText(publishedUrl); setToast({ type: 'success', message: '링크를 복사했어요.' }); }
              catch { setToast({ type: 'error', message: '복사 실패 — 링크를 길게 눌러 복사해주세요.' }); }
            }}
          >복사</ModalButton>
        </div>
      </ModalBase>
      <DmSendAndTrackModal dmId={dmId || ''} show={sendModalOpen} onClose={() => setSendModalOpen(false)} />
    </>
  );
}

// ← 경고 모달: 편집 중 뒤로가기 시 확인
function ConfirmDiscardModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="편집을 취소하고 나가시겠어요?"
      subtitle="저장하지 않은 모든 변경사항이 사라집니다."
      size="sm"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onClose}>계속 편집</ModalButton>
          <ModalButton variant="danger" onClick={onConfirm}>나가기</ModalButton>
        </>
      }
    >
      <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
        지금 나가면 이번 편집 세션의 변경 내용이 모두 사라지고 되돌릴 수 없어요.
        계속 편집하려면 <strong>"계속 편집"</strong>을, 나가려면 <strong>"나가기"</strong>를 선택하세요.
      </div>
    </ModalBase>
  );
}

function EditorModals() {
  const openModal = useDmBuilderStore((s) => s.openModal);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const close = () => setOpenModal(null);

  return (
    <>
      <AiPromptModal open={openModal === 'ai-prompt'} onClose={close} />
      <AiImproveModal open={openModal === 'ai-improve'} onClose={close} />
      <ValidationModal open={openModal === 'validation'} onClose={close} />
      <VersionHistoryModal open={openModal === 'version-history'} onClose={close} />
      <BrandKitModal open={openModal === 'brand-kit'} onClose={close} />
      <DesignThemeModal open={openModal === 'design-theme'} onClose={close} />
      <EliteTemplateModal open={openModal === 'elite-template'} onClose={close} />
      <AbTestModal open={openModal === 'ab-test'} onClose={close} />
    </>
  );
}

// EmptyList 영역 영구 폐기 (D216+ 정합 — 자연어 입력 + 빠른 시작 + 자유롭게 DM 생성 영역 흐름 정합)

function DmCard({ dm, onEdit, onDelete, onClone, onCopyUrl, onTrack, cloning }: {
  dm: DmListItem;
  onEdit: (id: string, mode?: string) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onCopyUrl: (id: string) => void;
  /** ★ 2026-07-02(3) 발송 이력 카드 → 발송 추적(열람·깊이·클릭·응모) 바로 진입 */
  onTrack?: (id: string, title?: string) => void;
  cloning?: boolean;
}) {
  // ★ 2026-06-23: 섹션 콘텐츠가 있으면 새 섹션형 슬라이드(편집 가능) — 콘텐츠 없는 진짜 D119만 레거시 뱃지.
  const isLegacy = dm.layout_mode === 'slides' && ((dm.section_summary?.types?.length ?? 0) === 0);
  const summary = dm.section_summary;
  const statusLabel = (() => {
    switch (dm.approval_status) {
      case 'published': return { label: '발행됨',   bg: 'rgba(16, 185, 129, 0.2)',  border: 'rgba(16, 185, 129, 0.4)',  text: '#6ee7b7' };
      case 'approved':  return { label: '승인됨',   bg: 'rgba(59, 130, 246, 0.2)',  border: 'rgba(59, 130, 246, 0.4)',  text: '#93c5fd' };
      case 'review':    return { label: '검수중',   bg: 'rgba(245, 158, 11, 0.2)',  border: 'rgba(245, 158, 11, 0.4)',  text: '#fcd34d' };
      case 'rejected':  return { label: '반려됨',   bg: 'rgba(244, 63, 94, 0.18)',  border: 'rgba(244, 63, 94, 0.4)',   text: '#fda4af' };
      default:          return { label: '임시저장', bg: 'rgba(255,255,255,0.08)',   border: 'rgba(255,255,255,0.15)',   text: 'rgba(255,255,255,0.7)' };
    }
  })();

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.1)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        cursor: 'pointer',
        transition: 'all 0.25s ease',
      }}
      onClick={() => onEdit(dm.id, dm.layout_mode)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(168, 85, 247, 0.08)';
        e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.3)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(168, 85, 247, 0.15), 0 1px 3px rgba(0,0,0,0.3)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 폰목업 썸네일 */}
      <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 10, padding: '12px 0' }}>
        <DmThumbnail types={summary?.types} accent={summary?.accent} pageCount={dm.page_count} />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dm.title || '(제목 없음)'}
        </div>
        {isLegacy && (
          <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#fcd34d', borderRadius: 6, whiteSpace: 'nowrap', fontWeight: 700 }}>레거시</span>
        )}
      </div>
      {(dm.store_name || summary?.headline) && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: -4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dm.store_name || summary?.headline}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, padding: '3px 8px', background: statusLabel.bg, border: `1px solid ${statusLabel.border}`, color: statusLabel.text, borderRadius: 6, fontWeight: 700 }}>
          {statusLabel.label}
        </span>
        {typeof dm.view_count === 'number' && dm.view_count > 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>열람 {dm.view_count.toLocaleString()}</span>
        )}
        {summary && summary.count > 0 && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>섹션 {summary.count}개</span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {dm.short_code && (
        <button
          onClick={(e) => { e.stopPropagation(); onCopyUrl(dm.id); }}
          title="발행 주소 복사 (추가 과금 없음)"
          style={{ height: 32, width: '100%', background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.12)'; }}
        >
          발행 주소 복사
        </button>
      )}
      {dm.has_send_history && onTrack && (
        <button
          onClick={(e) => { e.stopPropagation(); onTrack(dm.id, dm.title); }}
          title="발송 추적 — 수신자별 열람·깊이·클릭·응모 현황"
          style={{ height: 32, width: '100%', background: 'rgba(139,92,246,0.12)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.12)'; }}
        >
          발송 추적
        </button>
      )}
      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onEdit(dm.id, dm.layout_mode)}
          style={{
            flex: 1, height: 32,
            background: 'linear-gradient(135deg, #8b5cf6, #a855f7)',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(168, 85, 247, 0.3)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(168, 85, 247, 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(168, 85, 247, 0.3)'; }}
        >
          편집
        </button>
        <button
          onClick={() => onClone(dm.id)}
          disabled={cloning}
          title="복제"
          style={{
            height: 32, padding: '0 10px',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)',
            border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: cloning ? 'wait' : 'pointer',
            transition: 'all 0.2s', opacity: cloning ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (!cloning) e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        >
          {cloning ? '복제 중' : '복제'}
        </button>
        <button
          onClick={() => onDelete(dm.id)}
          title="삭제"
          style={{
            height: 32, padding: '0 10px',
            background: 'rgba(244, 63, 94, 0.1)', color: '#fda4af',
            border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(244, 63, 94, 0.2)'; e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)'; e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.3)'; }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

function Toast({ toast }: { toast: NonNullable<ReturnType<typeof useDmBuilderStore.getState>['toast']> }) {
  const color = toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6';
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        background: color,
        color: '#fff',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: 'var(--dm-shadow-lg)',
        zIndex: 9999,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      {toast.message}
    </div>
  );
}
