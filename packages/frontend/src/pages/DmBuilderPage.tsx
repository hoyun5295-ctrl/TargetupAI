/**
 * DmBuilderPage — 모바일 DM 빌더 (D125 프로모델 v1)
 *
 * 목록 모드 ↔ 편집 모드 분기.
 * 편집 모드는 3분할 레이아웃 (좌측: 섹션 목록 / 중앙: 캔버스 / 우측: 속성 편집).
 *
 * 레거시(slides 모드) DM은 편집 불가 안내 + 새 에디터로 전환 버튼(15단계 구현 후 활성).
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { DmMiniCover } from '../components/dm/DmThumbnails';
import DmBlockBuilder from '../components/dm/build/DmBlockBuilder';
import axios from 'axios';
import { attachCreditInterceptor } from '../lib/credit-interceptor';
import { useDmBuilderStore } from '../stores/dmBuilderStore';
import { createSection } from '../utils/dm-section-defaults';
import { formatDateTimeShort } from '../utils/formatDate';
import { uploadOne } from '../components/dm/panels/FormControls';
import { useDmKeyboardShortcuts } from '../hooks/useDmKeyboardShortcuts';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { takeEventDraft, EVENT_DM_DRAFT_KEY } from '../components/EventCampaignModal';
import { STUDIO_DM_DRAFT_KEY } from '../lib/studio-draft';
import AssetLibraryPickerModal, { type PickedAsset } from '../components/assets/AssetLibraryPickerModal';
import ImageToCopyButton from '../components/ImageToCopyButton';
// ★ 2026-09-06 S6 재료(이미지·행사 내용)로 초안 — 아웃리치 엔진 · 초안 id 로 이어서 편집
import MaterialQuickPanel from '../components/MaterialQuickPanel';
// ★ 2026-07-19: 기획전 스샷 구조화 판독 → DM 섹션 디터미니스틱 조립 (행사 N블록 = 70% 완성)
import { buildDmSectionsFromEvents, deriveDmTitleFromEvents, summarizeEvents } from '../utils/dm-event-assembly';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import DmShortLinkModal from '../components/dm/DmShortLinkModal';
import DmKoreanAliasModal from '../components/dm/DmKoreanAliasModal';
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
import DesignThemeModal from '../components/dm/modals/DesignThemeModal';
import FontApplyModal from '../components/dm/modals/FontApplyModal';
// ★ 2026-07-14 디자인 4.0 — 정예 템플릿(목적×스토리 구조, 서버 design-core 컴파일)
// ★ 2026-07-16 M4 — 정예 템플릿 진입 폐기 (Harold 명시 — 설계서 §1-2. EliteTemplateModal 미사용)
import { Wand2 } from 'lucide-react';
// ★ 2026-08-13 원스텝 AI 컨텐츠 생성 (설계서 = docs/2026-08-13-one-step-content-interview-design.md)
import OneStepInterviewModal from '../components/dm/OneStepInterviewModal';
import DmQuickBar from '../components/dm/DmQuickBar';
// ★ 2026-09-14 T5·T6 AI 자동제작 — 목록 카드띠(입구) · 편집 캔버스 위 결과 바 · 노출 스위치(신규 ENV)
import AiBuildEntryStrip from '../components/ai-build/AiBuildEntryStrip';
import BuildResultBar from '../components/ai-build/BuildResultBar';
import { peekBuildResult, clearBuildResult, useAiAutoBuildEnabled, type BuildResultHandoff } from '../utils/ai-build';
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
  /** ★ 2026-09-16 목록 리스트형 대표 이미지(서버 buildSectionSummary · 공개 서빙 경로). 없으면 null */
  cover?: string | null;
};

type DmListItem = {
  id: string;
  title: string;
  store_name?: string;
  layout_mode?: string;
  /** ★ 2026-09-15 카탈로그 DM(settings.catalog · 고른 DM만) — 목록 API getDmList 가 판정해 내려준다 */
  catalog?: boolean;
  approval_status?: string;
  /**
   * ★ 2026-08-06 발행 축(`dm_pages.status`) — `draft` / `published` / `stopped`.
   * 목록 API는 예전부터 내려주고 있었는데 이 타입이 안 받아 화면이 검수 축(`approval_status`)만 보고 있었다.
   * 뷰어가 여는 기준이 이 축이라, 중지 여부는 반드시 여기로 판정한다.
   */
  status?: string;
  short_code?: string | null;
  view_count?: number;
  page_count?: number;
  /** ★ 2026-07-02(3) 타겟 발송 이력 여부 — 카드 [발송 추적] 노출 */
  has_send_history?: boolean;
  section_summary?: DmSectionSummary;
  updated_at?: string;
};


export default function DmBuilderPage() {
  const navigate = useNavigate();
  const customerGate = useCustomerDataGate(localStorage.getItem('token'));
  const [showDataGate, setShowDataGate] = useState(false);
  const [mode, setMode] = useState<'list' | 'edit' | 'build'>('list');
  const [list, setList] = useState<DmListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  // ★ 2026-09-02 딥링크 진입(/dm-builder?id=<DM>&from=planner) — 마케팅 플래너 [DM 완성하기] 1클릭.
  //   진입 값은 마운트 때 한 번 읽어 두고 URL에서는 지운다(새로고침·뒤로가기가 같은 진입을 되풀이하지 않게).
  const [searchParams, setSearchParams] = useSearchParams();
  const [entry] = useState(() => ({
    id: String(searchParams.get('id') || '').trim() || null,
    fromPlanner: searchParams.get('from') === 'planner',
  }));
  const [listFetched, setListFetched] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const deepLinkHandled = useRef(false);
  // ★ 2026-09-14 T5 AI 자동제작 — 방금 만든 초안이면 결과 바(판정·미반영·다시 만들기) · 편집을 시작하면(isDirty) 접힘 · T6 목록 카드띠 노출 스위치
  const autoBuild = useAiAutoBuildEnabled();
  const isDirtyForBar = useDmBuilderStore((s) => s.isDirty);
  const [buildBar, setBuildBar] = useState<BuildResultHandoff | null>(null);
  const [legacyDmError, setLegacyDmError] = useState<string | null>(null);
  // ★ CT-17: 요금제 게이팅 (mobile_dm — PRO+)
  const [planLocked, setPlanLocked] = useState<{ msg: string } | null>(null);

  const dmId = useDmBuilderStore((s) => s.dmId);
  useEffect(() => { setBuildBar(mode === 'edit' && dmId ? peekBuildResult(dmId) : null); }, [mode, dmId]);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const loadError = useDmBuilderStore((s) => s.loadError);
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const createNew = useDmBuilderStore((s) => s.createNew);
  const reset = useDmBuilderStore((s) => s.reset);
  const toast = useDmBuilderStore((s) => s.toast);
  const setToast = useDmBuilderStore((s) => s.setToast);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const isSavingGlobal = useDmBuilderStore((s) => s.isSaving);
  const isPublishedGlobal = useDmBuilderStore((s) => s.isPublished);
  // ★ 2026-07-16 M4 — 전역 자동저장(초안 전용): 어떤 편집 경로든 dirty 2.5초 뒤 저장(수동 저장 버튼 제거의 안전망).
  //   신규 DM(dmId 없음)도 save()가 생성 처리. 발행 DM은 명시 저장만(라이브 URL 보호 — store가 silent 저장 차단).
  useEffect(() => {
    if (mode !== 'edit' || !isDirty || isSavingGlobal || isPublishedGlobal) return;
    const t = setTimeout(() => { void useDmBuilderStore.getState().save({ silent: true }); }, 2500);
    return () => clearTimeout(t);
  }, [mode, isDirty, isSavingGlobal, isPublishedGlobal]);
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
  // ★ 2026-09-16 리스트형(Harold A안) — 한 줄 높이가 작아 한 페이지 10개
  const DM_PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  // 빠른시작·자연어 생성 전 5크레딧 차감 확인 (Harold 명시 — 즉시 차감 X)
  const [pendingGen, setPendingGen] = useState<{ prompt?: string; scenario?: string; desc: string } | null>(null);
  // ★ 2026-08-13 원스텝 — 질문에 답하면 그 답이 마스터프롬프트가 되어 생성으로 이어진다.
  const [oneStepOpen, setOneStepOpen] = useState(false);

  // ★ D216+ 키보드 단축키 활성 (편집 모드 한정)
  useDmKeyboardShortcuts({ enabled: mode === 'edit' });

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.get('/dm');
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      setList(items);
      setListFailed(false);
      setCurrentPage(1); // ★ D216+ 목록 refresh = 첫 페이지 진입 정합
      setPlanLocked(null);
    } catch (err: any) {
      setListFailed(true);
      // ★ CT-17: 403 PLAN_FEATURE_LOCKED → 요금제 가드 화면 표시
      if (err?.response?.status === 403 && err?.response?.data?.code === 'PLAN_FEATURE_LOCKED') {
        setPlanLocked({ msg: err.response.data.error || '모바일 DM은 프로 요금제 이상에서 이용 가능합니다.' });
      } else {
        setToast({ type: 'error', message: err?.response?.data?.error || '목록 로드 실패' });
      }
    } finally {
      setListLoading(false);
      setListFetched(true);
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
  // 완성 이미지 업로드: 좌우 슬라이드 / 세로 스크롤 / ★ 2026-09-15 카탈로그(= 슬라이드 + settings.catalog · PC 책 펼침) 선택
  const uploadModeRef = useRef<'slides' | 'scroll' | 'catalog'>('scroll');
  const [uploadingImages, setUploadingImages] = useState(false);

  const handleCreateNew = () => {
    setLegacyDmError(null);
    createNew({ layoutMode: 'scroll' });
    setMode('edit');
  };

  // ★ 2026-09-16 블록 조립 시작 — 빈 DM 을 만들고 조립 화면으로 (저장 축·캔버스는 편집기와 같다)
  const handleStartBlockBuild = () => {
    if (generating) return;
    setLegacyDmError(null);
    createNew({ layoutMode: 'scroll' });
    setMode('build');
  };

  // ★ D216+ 자동 생성 흐름 — 자연어 OR 시나리오 → AI 자동 sections + 카피 → 편집 모드 진입
  const applyAiGenerated = useDmBuilderStore((s) => s.applyAiGenerated);
  const save = useDmBuilderStore((s) => s.save);

  const handleAutoGenerate = useCallback(async (opts: { prompt?: string; scenario?: string }) => {
    if (customerGate.isEmpty) { setShowDataGate(true); return; }
    if (generating) return;
    if (!opts.prompt && !opts.scenario) {
      setToast({ type: 'error', message: '만들 내용을 한 줄로 적어주세요.' });
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
      setToast({ type: 'success', message: `AI가 ${(sections || []).length}개 섹션 + 카피 자동 생성 종결. 추가 1-click 액션 활용 가능` });
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
    // ★ 2026-09-02 딥링크로 들어온 마운트에서는 초안 소비를 건너뛴다 — createNew가 편집 대상을 갈아엎어
    //   플래너 DM 대신 새 DM이 발행되는 경합을 막는다(초안은 스토리지에 남아 다음 일반 진입에서 소비된다).
    if (entry.id) return;
    const d = takeEventDraft<{ prompt?: string; data?: any }>(EVENT_DM_DRAFT_KEY);
    if (!d?.data) return;
    try {
      const { sections, brand_kit, pages, layout_mode } = d.data;
      createNew({ title: String(d.prompt || '행사 캠페인').split('\n')[0].slice(0, 30) || '행사 캠페인' });
      applyAiGenerated(sections || [], brand_kit, String(d.prompt || ''), { pages, layoutMode: layout_mode });
      save({ silent: true }).catch(() => {});
      setMode('edit');
      setShowAiFloatingBar(true);
      setToast({ type: 'success', message: '행사 캠페인 DM 초안을 불러왔습니다. 이미지만 올리고 다듬어주세요.' });
    } catch {
      // 초안 손상 = 조용히 무시 (일반 진입 흐름 무손상)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-07-19 P4: 이미지 스튜디오 소재 → 풀화면 이미지 DM 새 초안 (완성 이미지 업로드 흐름과 동일 섹션 — 검증된 선례 재사용)
  useEffect(() => {
    if (entry.id) return; // 딥링크 진입 — 위와 같은 이유로 건너뛴다
    const d = takeEventDraft<{ imageUrl?: string; name?: string | null }>(STUDIO_DM_DRAFT_KEY);
    if (!d?.imageUrl) return;
    try {
      createNew({ title: '스튜디오 소재 DM' });
      const gallery = createSection('gallery', 0, { images: [{ url: d.imageUrl }], layout: 'list_1xN', full_bleed: true });
      applyAiGenerated([gallery], undefined, '이미지 스튜디오 소재', { layoutMode: 'scroll' });
      save({ silent: true }).catch(() => {});
      setMode('edit');
      setToast({ type: 'success', message: '스튜디오 소재로 이미지 DM을 시작했어요. 문구·버튼만 더해주세요.' });
    } catch {
      // 초안 손상 = 조용히 무시
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-06-19: 완성 이미지 업로드 → 슬라이드 DM 자동 생성 (외주 완성 시안 대응 — 신규 섹션 타입 불요, slideshow 재사용)
  const handleCompletedImagesSelected = useCallback(async (files: FileList | null, mode: 'slides' | 'scroll' | 'catalog' = 'scroll') => {
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
      const isCatalog = mode === 'catalog';
      createNew({ title: isCatalog ? '카탈로그 DM' : '완성 이미지 DM' });
      // ★ 2026-07-15 완성 이미지 = 외주가 디자인 다 한 전체 이미지 → 풀화면(full_bleed) 자동 지정(카드 여백 X, 화면 꽉)
      // ★ 2026-09-15 카탈로그 = 같은 장 구조(장당 이미지 1장) + settings.catalog(뷰어가 PC 에서 책 펼침 · 휴대폰은 슬라이드)
      if (mode === 'slides' || isCatalog) {
        const pages = urls.map((u) => [createSection('gallery', 0, { images: [{ url: u }], layout: 'list_1xN', full_bleed: true })]);
        applyAiGenerated(pages[0], undefined, isCatalog ? '카탈로그 이미지 업로드' : '완성 이미지 업로드', { pages, layoutMode: 'slides', catalogView: isCatalog });
      } else {
        const gallery = createSection('gallery', 0, { images: urls.map((u) => ({ url: u })), layout: 'list_1xN', full_bleed: true });
        applyAiGenerated([gallery], undefined, '완성 이미지 업로드', { layoutMode: 'scroll' });
      }
      await save({ silent: true });
      setMode('edit');
      setToast({
        type: 'success',
        message: isCatalog
          ? `쪽 이미지 ${urls.length}장으로 카탈로그 DM을 만들었어요${failed ? ` (${failed}장 실패)` : ''}. 휴대폰은 슬라이드, PC는 책처럼 펼쳐 보여요. 순서는 편집에서 바꿀 수 있어요.`
          : `완성 이미지 ${urls.length}장으로 이미지 DM을 만들었어요${failed ? ` (${failed}장 실패)` : ''}. 편집에서 순서·캡션을 조정할 수 있어요.`,
      });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || err?.message || '이미지 DM 생성 실패' });
    } finally {
      setUploadingImages(false);
      if (completedImagesInputRef.current) completedImagesInputRef.current.value = '';
    }
  }, [uploadingImages, generating, createNew, applyAiGenerated, save, setToast]);

  // ★ 2026-07-19 P4: 라이브러리 다중 선택 → 이미지 DM (완성 이미지 업로드와 동일 gallery 흐름 — 업로드 없이 URL 직결)
  const [libPickerOpen, setLibPickerOpen] = useState(false);
  const handleLibraryImagesSelected = useCallback((assets: PickedAsset[]) => {
    const urls = assets.map((a) => a.url).filter(Boolean);
    if (urls.length === 0) return;
    try {
      createNew({ title: '라이브러리 이미지 DM' });
      const gallery = createSection('gallery', 0, { images: urls.map((u) => ({ url: u })), layout: 'list_1xN', full_bleed: true });
      applyAiGenerated([gallery], undefined, '라이브러리 소재', { layoutMode: 'scroll' });
      save({ silent: true }).catch(() => {});
      setMode('edit');
      setToast({ type: 'success', message: `라이브러리 소재 ${urls.length}장으로 이미지 DM을 시작했어요.` });
    } catch {
      setToast({ type: 'error', message: '이미지 DM 생성에 실패했습니다. 다시 시도해주세요.' });
    }
  }, [createNew, applyAiGenerated, save, setToast]);

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
      setToast({ type: 'success', message: `${labelMap[action]} 종결: ${changes.length}개 섹션 정정` });
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
    // ★ 2026-09-02 불러오기 실패(권한 없음·삭제됨)는 편집 모드로 들어가지 않는다 — 빈 편집기에서 자동저장이
    //   **다른 DM**을 새로 만들고, 플래너가 참조하는 DM은 미발행으로 남는다(딥링크 진입에서 특히 위험).
    const st = useDmBuilderStore.getState();
    if (st.loadError || st.dmId !== id) {
      setToast({ type: 'error', message: st.loadError || 'DM을 불러오지 못했습니다.' });
      return;
    }
    setMode('edit');
  };

  // ★ 2026-09-02 딥링크(?id=) — 목록이 한 번 로드된 뒤 그 항목을 연다. 목록에 없으면 열 권한이 없거나 지워진 것이다.
  useEffect(() => {
    if (!entry.id || deepLinkHandled.current || !listFetched || listLoading) return;
    deepLinkHandled.current = true;
    // 목록 조회 자체가 실패했으면 권한 문제가 아니다 — 파라미터를 남겨 새로고침으로 다시 시도할 수 있게 한다.
    if (listFailed) {
      setToast({ type: 'error', message: 'DM 목록을 불러오지 못했습니다. 새로고침해 주세요.' });
      return;
    }
    setSearchParams({}, { replace: true });
    const item = list.find((d) => d.id === entry.id);
    if (!item) {
      setToast({ type: 'error', message: '이 DM을 열 수 없습니다. DM을 만든 계정으로 로그인했는지 확인해 주세요.' });
      return;
    }
    void handleEdit(item.id, item.layout_mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, listFetched, listLoading, listFailed, list]);

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

  // ★ 2026-08-06 발행 중지 / 재개 (서수란 접수)
  //   업체 사정(행사 종료 등)으로 발행한 DM에 고객이 접속하지 못하게 막는다.
  //   삭제와 다른 점 = **이력이 남는다.** 삭제는 열람·발송 이력까지 함께 지운다(접수 그대로).
  //   중지 상태에서는 [발행 주소 복사]가 잠긴다 — 그 버튼이 발행 API를 부르기 때문에
  //   열어 두면 주소를 복사하는 순간 중지가 풀린다(서버도 409로 함께 막는다).
  const handleStop = async (id: string) => {
    setConfirm({
      mode: 'warning',
      title: 'DM 중지',
      // ★ 2026-08-06 보장하는 것과 보장하지 않는 것을 같은 폭으로 적는다.
      //   Codex 3R high — 첫 판에서 "언제든 재개"라고 썼는데 추첨이 끝난 행사는 서버가 409로 막는다.
      //   중지 직전에 이미 처리에 들어간 즉시·테스트 발송도 완료될 수 있다(예약 발송과 다른 경우다).
      //   **화면이 코드보다 넓게 약속하면 담당자가 그걸 믿고 손을 뗀다.**
      description:
        '이 DM을 중지할까요?\n\n'
        + '• 지금부터 고객이 이 주소로 들어올 수 없어요 (한글 주소·A/B 주소 포함)\n'
        + '• 중지 상태에서는 발송·테스트 발송·재발행이 막혀요\n'
        + '• 열람·발송·응모 이력은 그대로 남아요\n'
        + '• [재개]로 다시 열 수 있고 주소도 그대로예요 (추첨이 끝난 행사는 재개할 수 없어요)\n\n'
        + '다만 이미 나간 문자와 예약된 발송은 취소되지 않고,\n'
        + '중지 직전에 눌러 둔 발송 요청은 그대로 끝날 수 있어요.\n'
        // ★ Codex 4R medium — 중지해도 추첨 워커는 그 DM을 계속 후보로 본다(응모는 이미 받아 뒀으니
        //   당첨자는 뽑혀야 한다). 그런데 추첨이 끝나면 재개가 막힌다 — 되돌릴 수 없는 결과라 미리 알린다.
        + '\n추첨 예정 행사는 중지 중에도 예정 시각에 추첨되고,\n'
        + '추첨이 끝나면 다시 열 수 없어요.',
      confirmLabel: '중지',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          await api.post(`/dm/${id}/stop`);
          setToast({ type: 'success', message: '중지했어요. 이제 고객이 접속할 수 없어요.' });
          refreshList();
        } catch (err: any) {
          setToast({ type: 'error', message: err?.response?.data?.error || '중지 실패' });
        }
      },
    });
  };

  const handleResume = async (id: string) => {
    try {
      await api.post(`/dm/${id}/resume`);
      setToast({ type: 'success', message: '다시 열었어요. 주소는 그대로예요. (추가 과금 없음)' });
      refreshList();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '재개 실패' });
    }
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

  // ★ 2026-07-15 발행 DM 한글 주소 별칭 모달 (hlj.kr/반짝세일_07 — Harold 확정, 무료·DM당 1개)
  const [aliasTarget, setAliasTarget] = useState<{ id: string; title?: string } | null>(null);

  // 발행 주소 복사 — 이미 발행된 DM은 발행 멱등(추가 과금 0)이라 그대로 short_url 재사용. 편집 재발행 불필요.
  const handleCopyUrl = async (id: string) => {
    try {
      const res = await api.post(`/dm/${id}/publish`);
      const url = res?.data?.short_url || '';
      if (!url) { setToast({ type: 'error', message: '발행 주소를 찾지 못했어요. 편집에서 발행 후 다시 시도해주세요.' }); return; }
      await navigator.clipboard.writeText(url);
      setToast({ type: 'success', message: '발행 주소를 복사했어요. (이미 발행, 추가 과금 없음)' });
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
  if (mode === 'build') {
    return (
      <DmBlockBuilder
        onBack={() => setMode('list')}
        onBlankCanvas={() => setMode('edit')}
        onDone={() => { void save({ silent: true }); setMode('edit'); }}
      />
    );
  }

  if (mode === 'edit') {
    return (
      <div className="dm-builder" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBarWithBack onBack={handleBackRequest} onPublishDone={handleBackToList} fromPlanner={entry.fromPlanner} />
        {/* ★ 2026-07-16 M4 — 전역 퀵바(서체 일괄·브랜드 킷·테마) */}
        <DmQuickBar />
        {buildBar && (
          <BuildResultBar
            handoff={buildBar}
            collapsed={isDirtyForBar}
            onDismiss={() => { clearBuildResult(); setBuildBar(null); }}
            onRegenerate={() => { clearBuildResult(); setBuildBar(null); navigate('/quick-campaign?channel=dm&regen=1'); }}
          />
        )}
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
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '2px 0 0 0' }}>카드형 모바일 DM 빌더: 미디어 메세지 디자인 + 카드 단위 편집</p>
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
        {/* ★ 2026-09-14 T6 카드띠 [AI 자동제작 | 직접 제작] — 신규 ENV 미개방 회사는 그리지 않는다(설계서 §3-1 · §4-1) */}
        {/* ★ 2026-09-16 Harold — 오른쪽 카드 = 블록으로 만들기(옛 "직접 제작"과 같은 일이라 하나로). 빈 캔버스는 조립 화면 안 버튼이 소유한다 */}
        <AiBuildEntryStrip
          channel="dm"
          enabled={autoBuild === true}
          disabled={generating}
          onDirect={handleStartBlockBuild}
          directIcon={<span className="text-[15px]">🧱</span>}
          directLabel="블록으로 만들기"
          directSub="고르면 필요한 것만 물어봐요"
          directDesc="헤드라인·상품·쿠폰 같은 블록을 골라 쌓으면 DM이 됩니다."
        />
        {/* 자연어 한 줄 입력 + 블록으로 만들기 + 완성 이미지 (★ 2026-09-16 블록 조립 전환) */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(217,70,239,0.10), rgba(168,85,247,0.08), rgba(99,102,241,0.10))',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>어떻게 만들까요</span>
          </div>
          {customerGate.isEmpty && <CustomerDataRequiredBanner className="mb-3" />}
          {/* 좌: 한 줄 입력 + 자동 생성 · 우: 만드는 방법 스택 */}
          <style>{`
            .dm-hub-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
            /* ★ 2026-09-16(3) 오른쪽 = 만드는 방법 스택. 마지막 카드가 남는 높이를 먹어 빈칸이 남지 않는다 */
            .dm-hub-side { display: flex; flex-direction: column; gap: 10px; }
            /* ★ 2026-08-21 한글은 기본 줄바꿈이 글자 단위라 "추 가"·"슬라 이드"·"불러 오기"처럼 낱말이 잘렸다.
               keep-all = 띄어쓰기에서만 끊는다(줄 위치는 아래 타일이 <br/>로 직접 정한다). */
            .dm-hub-side button { word-break: keep-all; }
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
              {/* ★ 2026-08-13 원스텝 — 자유 입력이 어려운 담당자를 위한 별도 경로(설계서 §5).
                  기존 [자동 생성] 1클릭 흐름은 손대지 않는다 — 형제 버튼으로만 선다. */}
              {/* ★ 2026-09-14 T6 AI 자동제작이 열린 회사에서는 접힘 줄 [더 정확하게 만들기]로 강등(설계서 §3-2 · 제거 0) */}
              <button
                onClick={() => { if (!generating) setOneStepOpen(true); }}
                disabled={generating}
                className={autoBuild === true
                  ? 'w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] text-white/55 text-[12px] py-1.5 hover:text-white hover:bg-white/5 disabled:opacity-40 transition-colors'
                  : 'w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100 text-sm font-medium py-2.5 hover:bg-fuchsia-500/20 disabled:opacity-40 transition-colors'}
              >
                <Wand2 className="w-4 h-4" />
                {autoBuild === true ? '더 정확하게 만들기(질문 몇 개)' : '질문 몇 개로 정확하게 만들기'}
                <span className={autoBuild === true ? 'text-[11px] text-white/35' : 'text-[11px] text-fuchsia-200/70'}>생성 5 + 오토설계 50</span>
              </button>
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

            {/* 우 — 만드는 방법(블록·사진 읽기·재료·완성 이미지). 왼쪽 입력 높이에 맞춰 채운다 */}
            <div className="dm-hub-side">
              {/* ★ 2026-09-16(2) 상단 카드띠가 이미 [블록으로 만들기]다 — 카드띠가 안 보이는 회사(기능 미개방)에서만 여기 둔다 */}
              {autoBuild !== true && (
                <button
                  onClick={handleStartBlockBuild}
                  disabled={generating}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', textAlign: 'left',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(217,70,239,0.12))',
                    border: '1px solid rgba(168,85,247,0.45)', borderRadius: 12,
                    cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontSize: 20, lineHeight: 1 }}>🧱</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#fff' }}>블록으로 만들기</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>고르면 필요한 것만 물어봐요</span>
                  </span>
                </button>
              )}
              <ImageToCopyButton
                label="이미지로 불러오기"
                onExtracted={(t) => setNaturalLanguage((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))}
                onStructured={({ events, text }) => {
                  // ★ 기획전 스샷 → 행사별 [히어로+상품 카드] 즉시 조립 (AI 생성 없이 코드 매핑 — 크레딧 추가 0)
                  try {
                    const sections = buildDmSectionsFromEvents(events);
                    if (sections.length === 0) {
                      setNaturalLanguage((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
                      return;
                    }
                    createNew({ title: deriveDmTitleFromEvents(events) });
                    applyAiGenerated(sections, undefined, text || '이미지 행사 추출', { layoutMode: 'scroll' });
                    save({ silent: true }).catch(() => {});
                    setMode('edit');
                    const sum = summarizeEvents(events);
                    setToast({ type: 'success', message: `행사 ${sum.events}건·상품 ${sum.products}개로 DM 초안을 만들었어요. 상품 이미지와 문구만 다듬어주세요.` });
                  } catch {
                    // 조립 실패 = 산문 폴백(기존 흐름 무손상)
                    setNaturalLanguage((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
                  }
                }}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-violet-400/40 bg-violet-500/10 text-violet-100 text-sm font-medium py-2.5 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
              />
              {/* ★ 2026-09-06 S6 재료 입구 — 이미지 몇 장 + 행사 내용 → 서버가 초안 DM 을 만들고(아웃리치 엔진) 그 id 를 그대로 연다 · 기존 두 버튼은 무접촉 */}
              <MaterialQuickPanel
                channel="dm"
                disabled={generating}
                onToast={(message, type) => setToast({ type: type === 'error' ? 'error' : type === 'warning' ? 'info' : 'success', message })}
                onDone={async ({ draftId }) => {
                  if (!draftId) { setToast({ type: 'error', message: '초안이 만들어지지 않았습니다. 다시 시도해주세요.' }); return; }
                  await useDmBuilderStore.getState().loadDm(draftId);
                  setMode('edit');
                  setToast({ type: 'success', message: '재료로 초안을 만들었습니다. 이미지와 문구만 다듬어 주세요.' });
                }}
              />
              {/* ★ 2026-09-16(3) 완성 이미지 = 남는 높이를 채운다(빈칸 0). 라이브러리는 이 카드 안 보조 입구 */}
              <div
                onClick={() => { if (!generating && !uploadingImages) { uploadModeRef.current = 'catalog'; completedImagesInputRef.current?.click(); } }}
                title="완성된 이미지를 순서대로 올리면 휴대폰은 슬라이드, PC는 책처럼 두 쪽씩 펼쳐 보입니다. 편집기에서 끌 수 있어요"
                style={{
                  flex: 1, minHeight: 92, padding: '14px 16px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, textAlign: 'center',
                  background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.22)', borderRadius: 12,
                  cursor: (generating || uploadingImages) ? 'not-allowed' : 'pointer', opacity: (generating || uploadingImages) ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }}>🖼️</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{uploadingImages ? '업로드 중...' : '완성 이미지로 만들기'}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>이미지 그대로 슬라이드 · PC는 책 펼침</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (!generating && !uploadingImages) setLibPickerOpen(true); }}
                  disabled={generating || uploadingImages}
                  style={{
                    marginTop: 2, background: 'transparent', border: 0, color: 'rgba(255,255,255,0.5)',
                    fontSize: 11, cursor: (generating || uploadingImages) ? 'not-allowed' : 'pointer', textDecoration: 'underline',
                  }}
                >
                  저장 소재에서 고르기
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

          {/* ★ 2026-07-19 P4: 라이브러리 다중 선택 픽커 (시작 허브 타일) */}
          <AssetLibraryPickerModal
            open={libPickerOpen}
            onClose={() => setLibPickerOpen(false)}
            multiSelect
            onPick={(a) => handleLibraryImagesSelected([a])}
            onPickMany={handleLibraryImagesSelected}
          />
        </div>

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

        {/* ★ 2026-09-16 Harold — 목록 화면 "AI 진단"(고정 문장 분기) 카드와 1-click 액션 3카드(토스트 안내만)를 메뉴에서 숨김.
            실제 기능(편집 화면 AI 추천 액션 → POST /dm/:id/quick-action)은 그대로 둔다. */}

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
                집계: 최근 30일 열람 + 이벤트 응답
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
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>블록을 고르면 필요한 것만 물어봐요.<br />사진과 문구만 넣으면 첫 DM이 완성됩니다.</div>
            <button
              onClick={handleStartBlockBuild}
              disabled={generating}
              style={{
                marginTop: 4, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #a855f7, #d946ef)', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1,
              }}
            >
              블록으로 첫 DM 만들기
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

              {/* ★ 2026-09-16 Harold A안 — 폰목업 카드 3열 → 리스트형 줄(대표 이미지 · 상태 · 열람 · 섹션 · 수정 · 자주 쓰는 버튼 + ⋯ 메뉴) */}
              <style>{`
                .dm-list { border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: rgba(255,255,255,0.03); margin-bottom: 20px; }
                .dm-list-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 84px 64px 56px 92px 250px; align-items: center; gap: 14px; padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.06); }
                .dm-list-row:first-child { border-top: 0; }
                .dm-list-row.is-body { cursor: pointer; transition: background 0.15s; }
                .dm-list-row.is-body:hover { background: rgba(168,85,247,0.07); }
                .dm-list-head { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 600; }
                .dm-list-act { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
                .dm-menu-item:hover:not(:disabled) { background: rgba(255,255,255,0.08) !important; }
                .dm-col-narrow, .dm-menu-narrow { display: none; }
                .dm-list-ghost { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border: 0; border-top: 1px dashed rgba(255,255,255,0.14); background: transparent; color: #fff; text-align: left; transition: background 0.15s; }
                .dm-list-ghost:hover:not(:disabled) { background: rgba(168,85,247,0.07); }
                @media (max-width: 767px) {
                  .dm-list-row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 10px 12px; }
                  .dm-list-head, .dm-col-wide, .dm-act-wide { display: none; }
                  .dm-col-narrow { display: inline-block; }
                  .dm-menu-narrow { display: block; }
                }
              `}</style>
              <div className="dm-list">
                <div className="dm-list-row dm-list-head">
                  <span />
                  <span>DM</span>
                  <span className="dm-col-wide">상태</span>
                  <span className="dm-col-wide">열람</span>
                  <span className="dm-col-wide">섹션</span>
                  <span className="dm-col-wide">수정</span>
                  <span />
                </div>
                {paginatedList.map((dm) => (
                  <DmListRow
                    key={dm.id}
                    dm={dm}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onClone={handleClone}
                    onCopyUrl={handleCopyUrl}
                    onTrack={(id, title) => setTrackTarget({ id, title })}
                    onKoreanAlias={(id, title) => setAliasTarget({ id, title })}
                    onStop={handleStop}
                    onResume={handleResume}
                    cloning={cloningId === dm.id}
                  />
                ))}
                {/* 희소 상태 — 1~2개면 목록 끝에 블록으로 만들기 줄 (첫 페이지만) */}
                {safePage === 1 && list.length > 0 && list.length < 3 && (
                  <button
                    type="button"
                    className="dm-list-ghost"
                    onClick={handleStartBlockBuild}
                    disabled={generating}
                    style={{ borderRadius: '0 0 14px 14px', cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.5 : 1 }}
                  >
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(168,85,247,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🧱</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>블록으로 하나 더 만들기</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5, marginTop: 2 }}>블록을 고르면 필요한 것만 물어봐요</div>
                    </div>
                  </button>
                )}
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

      {/* ★ 2026-08-13 원스텝 — 결과는 기존 적용 경로를 그대로 탄다(신규 DM에만 적용 · 사용자 콘텐츠 비파괴) */}
      <OneStepInterviewModal
        open={oneStepOpen}
        onClose={() => setOneStepOpen(false)}
        onGenerated={(payload, _sessionId, sessionDetached) => {
          setOneStepOpen(false);
          const sections = (payload.sections || []) as any[];
          createNew({ title: '원스텝 생성 DM' });
          applyAiGenerated(sections, payload.brand_kit as any, '원스텝 생성', {
            pages: payload.pages as any,
            layoutMode: payload.layout_mode as any,
          });
          void save({ silent: true }).catch(() => {});
          setMode('edit');
          const missing = payload.coverage?.missing?.length || 0;
          setToast({
            type: 'success',
            // 결과물은 여기 그대로 들어왔다. 다만 질문 답이 저장된 자리와 끊겼으면 그 사실을 알린다 —
            // 안 알리면 사용자가 "다시 열면 이어서 나오겠지"라고 믿고 되돌아갔다가 빈 화면을 본다.
            message: sessionDetached
              ? `${sections.length}개 섹션으로 만들었어요. 이 결과는 지금 화면에서 이어서 편집해 주세요(질문 답으로는 다시 불러올 수 없습니다)`
              : missing > 0
                ? `${sections.length}개 섹션으로 만들었어요. 반영되지 않은 항목 ${missing}건은 편집기에서 확인해 주세요`
                : `${sections.length}개 섹션으로 만들었어요. 문구와 이미지만 다듬으면 됩니다`,
          });
        }}
      />

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
      {aliasTarget && (
        <DmKoreanAliasModal open dmId={aliasTarget.id} dmTitle={aliasTarget.title} onClose={() => setAliasTarget(null)} />
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function TopBarWithBack({ onBack, onPublishDone, fromPlanner = false }: { onBack: () => void; onPublishDone: () => void; fromPlanner?: boolean }) {
  const navigate = useNavigate();
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
  // ★ 2026-07-28 검수 치명을 확인하고 넘긴 발행 (서수란 접수). 검수 모달이 스토어에 채워 넣으면
  //   여기서 크레딧 확인 모달을 열고, 발행 시 서버로 함께 보내 기록으로 남긴다.
  //   null = 일반 발행(기존 경로 그대로).
  const validationOverride = useDmBuilderStore((s) => s.validationOverride);
  const setValidationOverride = useDmBuilderStore((s) => s.setValidationOverride);
  useEffect(() => {
    if (validationOverride) setConfirmPublish(true);
  }, [validationOverride]);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  // ★ 2026-09-02 플래너에서 온 DM — 발행 직후 "문자에 실릴 수 있는가"를 서버에 묻는다(빈 자리가 남았으면 그 사실을 말해야 담당자가 손을 떼지 않는다).
  const [carryCheck, setCarryCheck] = useState<{ ready: boolean; residue: string | null; checkError: boolean } | null>(null);

  // ★ 2026-07-14 발행 DM은 자동저장을 하지 않으므로(임은지 유실 방지), 미저장 편집분이 하드 새로고침/탭 닫기로
  //   조용히 사라지지 않게 브라우저 이탈 가드(beforeunload). 앱 내 뒤로가기 이탈은 기존 확인 모달이 담당.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useDmBuilderStore.getState().isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleTestSend = async () => {
    if (!dmId) {
      setToast({ type: 'error', message: '먼저 저장 후 테스트 발송이 가능해요.' });
      return;
    }
    // ★ 2026-07-24 발행 후에만 테스트 발송 — 미발행 자동발행(무과금 URL 발급) 결함 차단(서수란). 발행 전 확인은 캔버스 미리보기.
    if (!isPublished) {
      setToast({ type: 'error', message: '발행 후 테스트 발송이 가능해요. 발행 전에는 편집기 미리보기로 확인해주세요.' });
      return;
    }
    try {
      await api.post(`/dm/${dmId}/test-send`, { sample_key: 'vip' });
      setToast({ type: 'success', message: '테스트 발송 요청을 보냈어요.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '테스트 발송 실패' });
    }
  };

  const handlePublish = async (validationOverride?: { items: { area: string; message: string }[] }) => {
    await saveStore();
    if (dmId) {
      try {
        // ★ 2026-07-28 검수 치명을 확인하고 넘긴 경우 그 사실을 함께 보낸다 — 서버가 무시 항목·시각·사용자를
        //   validation_result에 기록한다. 넘기지 않은 일반 발행은 body 없이 그대로(기존 동작 무변경).
        const res = await api.post(
          `/dm/${dmId}/publish`,
          validationOverride ? { validation_override: validationOverride } : undefined,
        );
        setPublished(true); // 발행 확정 — 버튼 [발송] 전환 + 이후 크레딧 모달 미노출
        const url = res?.data?.short_url || '';
        if (url) {
          // 발행 완료 → 단축 URL 확인·복사 모달. 목록 이동은 모달 확인 시.
          if (fromPlanner) {
            setCarryCheck(null);
            try {
              const chk = await api.get(`/marketing-planner/dm/${dmId}/carry-check`);
              setCarryCheck({ ready: !!chk.data?.ready, residue: chk.data?.residue || null, checkError: !!chk.data?.checkError });
            } catch {
              setCarryCheck(null); // 확인 실패 = 플래너 화면이 다시 말해 준다
            }
          }
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
        // 발행 완료 = 크레딧 모달 없이 바로 타겟 발송 모달 / 미발행 = ★ M4 자동 검수 내장 → 통과 시 크레딧 확인 → 발행
        onPublishClick={async () => {
          if (isPublished) { setSendModalOpen(true); return; }
          // ★ Codex 1R — 저장 배리어: 진행 중 자동저장 완료를 기다린 뒤(save는 isSaving이면 즉시 반환)
          //   dirty/미생성분을 직접 저장 — 최신 상태로 검수·발행 보장. dmId 확보 실패 = 발행 중단(정직 안내).
          const st = () => useDmBuilderStore.getState();
          for (let i = 0; i < 40 && st().isSaving; i++) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 150));
          }
          if (st().isDirty || !st().dmId) await st().save({ silent: true });
          if (!st().dmId) {
            st().setToast({ type: 'error', message: '저장에 실패해 발행을 진행할 수 없어요. 잠시 후 다시 시도해주세요.' });
            return;
          }
          const result = await st().runValidation();
          if (!result) return; // 검수 호출 실패 — 토스트는 store가 띄움
          setValidationOverride(null); // 이전 무시 이력이 남아 다음 발행에 딸려가지 않게
          if (result.can_publish === false) {
            st().setOpenModal('validation'); // 문제 항목 + 바로 고치기 (넘길 수 있으면 모달이 그 버튼을 띄운다)
            return;
          }
          setConfirmPublish(true);
        }}
      />
      <CreditConfirmModal
        open={confirmPublish}
        source={hasInteraction ? 'dm-interaction-publish' : 'dm-builder'}
        onConfirm={() => {
          const ov = validationOverride;
          setConfirmPublish(false);
          setValidationOverride(null);
          handlePublish(ov || undefined);
        }}
        onCancel={() => { setConfirmPublish(false); setValidationOverride(null); }}
      />
      <ModalBase
        open={!!publishedUrl}
        onClose={() => { setPublishedUrl(null); onPublishDone(); }}
        title="발행 완료"
        // ★ 2026-09-02 플래너에서 온 DM은 플래너가 예정일 문자에 링크로 실어 보낸다 — 여기서 따로 보내면 같은 고객에게 두 통이다.
        subtitle={fromPlanner
          ? (carryCheck && !carryCheck.ready
            ? (carryCheck.residue
              ? `아직 채워지지 않은 자리가 있습니다: ${carryCheck.residue}. 채운 뒤 다시 발행해야 문자에 실립니다.`
              : '문자에 실을 수 있는지 확인하지 못했습니다. 플래너 화면에서 상태를 확인해 주세요.')
            : '마케팅 플래너가 예정일 문자 1통에 이 주소를 링크로 실어 보냅니다. 지금 따로 보내지 않아도 됩니다.')
          : '아래 단축 URL을 복사해 고객에게 발송하세요.'}
        size="sm"
        footer={
          fromPlanner ? (
            carryCheck && !carryCheck.ready && carryCheck.residue ? (
              <>
                <ModalButton variant="secondary" onClick={() => { setPublishedUrl(null); navigate('/marketing-planner'); }}>플래너로 돌아가기</ModalButton>
                <ModalButton variant="primary" onClick={() => { setPublishedUrl(null); }}>계속 채우기</ModalButton>
              </>
            ) : (
              <>
                <ModalButton variant="secondary" onClick={() => { setPublishedUrl(null); onPublishDone(); }}>확인</ModalButton>
                <ModalButton variant="primary" onClick={() => { setPublishedUrl(null); navigate('/marketing-planner'); }}>플래너로 돌아가기</ModalButton>
              </>
            )
          ) : (
            <>
              <ModalButton variant="secondary" onClick={() => { setPublishedUrl(null); onPublishDone(); }}>확인</ModalButton>
              <ModalButton variant="primary" onClick={() => { setPublishedUrl(null); setSendModalOpen(true); }}>타겟 고객에게 발송</ModalButton>
            </>
          )
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px' }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#4f46e5', wordBreak: 'break-all', userSelect: 'all' }}>{publishedUrl}</span>
          <ModalButton
            variant="secondary"
            onClick={async () => {
              if (!publishedUrl) return;
              try { await navigator.clipboard.writeText(publishedUrl); setToast({ type: 'success', message: '링크를 복사했어요.' }); }
              catch { setToast({ type: 'error', message: '복사 실패. 링크를 길게 눌러 복사해주세요.' }); }
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
  const setValidationOverride = useDmBuilderStore((s) => s.setValidationOverride);
  const close = () => setOpenModal(null);

  return (
    <>
      <AiPromptModal open={openModal === 'ai-prompt'} onClose={close} />
      <AiImproveModal open={openModal === 'ai-improve'} onClose={close} />
      {/* ★ 2026-07-28 넘길 수 있는 치명(required_info)만 남은 경우 확인 후 발행 — 크레딧 확인 모달을 그대로 거친다.
          넘긴 항목은 발행 시 서버가 validation_result에 기록한다. */}
      <ValidationModal
        open={openModal === 'validation'}
        onClose={close}
        onOverridePublish={(items) => {
          // 발행 바(TopBarWithBack)가 형제 컴포넌트라 스토어를 경유한다 — 이 값이 채워지면 그쪽이 크레딧 확인 모달을 연다.
          setValidationOverride({ items: items.map((i) => ({ area: i.area, message: i.message })) });
          close();
        }}
      />
      <VersionHistoryModal open={openModal === 'version-history'} onClose={close} />
      {/* ★ 2026-07-21 BrandKitModal 제거 — 브랜드 편집은 AI메모리 "브랜드 학습" 단일 창구로 일원화 */}
      <DesignThemeModal open={openModal === 'design-theme'} onClose={close} />
      <FontApplyModal open={openModal === 'font'} onClose={close} />
      <AbTestModal open={openModal === 'ab-test'} onClose={close} />
    </>
  );
}

// EmptyList 영역 영구 폐기 (목록 빈 상태는 위 안내 카드가 소유)

function DmListRow({ dm, onEdit, onDelete, onClone, onCopyUrl, onTrack, onKoreanAlias, onStop, onResume, cloning }: {
  dm: DmListItem;
  onEdit: (id: string, mode?: string) => void;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onCopyUrl: (id: string) => void;
  onKoreanAlias?: (id: string, title?: string) => void;
  /** ★ 2026-07-02(3) 발송 이력 카드 → 발송 추적(열람·깊이·클릭·응모) 바로 진입 */
  onTrack?: (id: string, title?: string) => void;
  /** ★ 2026-08-06 발행 중지 / 재개 (서수란 접수) */
  onStop?: (id: string) => void;
  onResume?: (id: string) => void;
  cloning?: boolean;
}) {
  // ★ 2026-06-23: 섹션 콘텐츠가 있으면 새 섹션형 슬라이드(편집 가능) — 콘텐츠 없는 진짜 D119만 레거시 뱃지.
  const isLegacy = dm.layout_mode === 'slides' && ((dm.section_summary?.types?.length ?? 0) === 0);
  const summary = dm.section_summary;
  // ★ 2026-08-06 중지는 **발행 축**(status)이다. 검수 축(approval_status) 라벨보다 먼저 본다 —
  //   고객이 못 들어오는 상태를 "발행됨"으로 보여주면 담당자가 중지된 줄 모른다.
  //   나머지 라벨 로직은 건드리지 않는다(기존 표시 무변경).
  const isStopped = dm.status === 'stopped';
  const statusLabel = isStopped
    ? { label: '중지됨', bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.45)', text: '#cbd5e1' }
    : (() => {
    switch (dm.approval_status) {
      case 'published': return { label: '발행됨',   bg: 'rgba(16, 185, 129, 0.2)',  border: 'rgba(16, 185, 129, 0.4)',  text: '#6ee7b7' };
      case 'approved':  return { label: '승인됨',   bg: 'rgba(59, 130, 246, 0.2)',  border: 'rgba(59, 130, 246, 0.4)',  text: '#93c5fd' };
      case 'review':    return { label: '검수중',   bg: 'rgba(245, 158, 11, 0.2)',  border: 'rgba(245, 158, 11, 0.4)',  text: '#fcd34d' };
      case 'rejected':  return { label: '반려됨',   bg: 'rgba(244, 63, 94, 0.18)',  border: 'rgba(244, 63, 94, 0.4)',   text: '#fda4af' };
      default:          return { label: '임시저장', bg: 'rgba(255,255,255,0.08)',   border: 'rgba(255,255,255,0.15)',   text: 'rgba(255,255,255,0.7)' };
    }
  })();

  // ★ 2026-09-16 Harold A안 — 리스트형 한 줄. 자주 쓰는 버튼(추적·주소 복사·편집)만 줄 끝에 두고 나머지(한글 주소·복제·중지/재개·삭제)는 ⋯ 메뉴로 접는다.
  //   버튼마다 부르는 핸들러·잠금 조건(중지 = 주소 버튼 잠금 · 발행만 중지 · 중지만 재개)은 옛 카드와 같다.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  const closeThen = (fn: () => void) => { setMenuOpen(false); fn(); };
  const hasUrl = !!dm.short_code;
  const views = typeof dm.view_count === 'number' ? dm.view_count : 0;
  const menuItemStyle = { width: '100%', textAlign: 'left', height: 32, padding: '0 10px', border: 0, background: 'transparent', borderRadius: 6, fontSize: 12, color: 'rgba(255,255,255,0.85)', cursor: 'pointer', whiteSpace: 'nowrap' } as const;
  const chipStyle = { fontSize: 10, padding: '3px 8px', background: statusLabel.bg, border: `1px solid ${statusLabel.border}`, color: statusLabel.text, borderRadius: 6, fontWeight: 700, whiteSpace: 'nowrap' } as const;

  return (
    <div className="dm-list-row is-body" onClick={() => onEdit(dm.id, dm.layout_mode)}>
      <DmMiniCover key={summary?.cover || 'none'} cover={summary?.cover} types={summary?.types} accent={summary?.accent} pageCount={dm.page_count} />

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dm.title || '(제목 없음)'}
          </span>
          {isLegacy && (
            <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#fcd34d', borderRadius: 6, whiteSpace: 'nowrap', fontWeight: 700, flexShrink: 0 }}>레거시</span>
          )}
          {dm.catalog && (
            // ★ 2026-09-15 카탈로그 DM 뱃지(settings.catalog · 목록 API 판정) — PC 책 펼침으로 발행되는 DM 표시
            <span title="휴대폰은 슬라이드, PC는 책처럼 펼쳐 보이는 카탈로그 DM" style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid rgba(139, 92, 246, 0.45)', color: '#c4b5fd', borderRadius: 6, whiteSpace: 'nowrap', fontWeight: 700, flexShrink: 0 }}>카탈로그</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
          {/* 휴대폰 폭에서는 상태 열이 숨으므로 제목 아래에 같은 칩을 둔다 */}
          <span className="dm-col-narrow" style={chipStyle}>{statusLabel.label}</span>
          {(dm.store_name || summary?.headline) && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dm.store_name || summary?.headline}
            </span>
          )}
        </div>
      </div>

      <div className="dm-col-wide"><span style={chipStyle}>{statusLabel.label}</span></div>
      <div className="dm-col-wide" style={{ fontSize: 13, color: views > 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums' }}>{views.toLocaleString()}</div>
      <div className="dm-col-wide" style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontVariantNumeric: 'tabular-nums' }}>{summary?.count ?? 0}</div>
      <div className="dm-col-wide" style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{formatDateTimeShort(dm.updated_at)}</div>

      <div className="dm-list-act" onClick={(e) => e.stopPropagation()}>
        {dm.has_send_history && onTrack && (
          <button
            type="button"
            className="dm-act-wide"
            onClick={() => onTrack(dm.id, dm.title)}
            title="발송 추적: 수신자별 열람·깊이·클릭·응모 현황"
            style={{ height: 30, padding: '0 10px', background: 'rgba(139,92,246,0.12)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            추적
          </button>
        )}
        {hasUrl && (
          // ★ 2026-08-06 중지 상태에서는 주소 버튼을 잠근다 — [발행 주소 복사]는 `POST /dm/:id/publish`를 부르므로 열어 두면 복사가 곧 재개가 된다.
          <button
            type="button"
            className="dm-act-wide"
            onClick={() => { if (!isStopped) onCopyUrl(dm.id); }}
            disabled={isStopped}
            title={isStopped ? '중지된 DM입니다. [재개] 후 복사할 수 있어요.' : '발행 주소 복사 (추가 과금 없음)'}
            style={{ height: 30, padding: '0 10px', background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: isStopped ? 'not-allowed' : 'pointer', opacity: isStopped ? 0.35 : 1, whiteSpace: 'nowrap' }}
          >
            주소 복사
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(dm.id, dm.layout_mode)}
          style={{ height: 30, padding: '0 14px', background: 'linear-gradient(135deg, #8b5cf6, #a855f7)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(168, 85, 247, 0.3)' }}
        >
          편집
        </button>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="더 보기"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: menuOpen ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div role="menu" style={{ position: 'absolute', right: 0, top: 36, zIndex: 30, width: 160, padding: 6, borderRadius: 10, background: '#0f172a', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              {/* 휴대폰 폭에서는 줄 끝 버튼(추적·주소 복사)이 숨으므로 메뉴에 같은 동작을 둔다(.dm-menu-narrow = 휴대폰 폭에서만 보임) */}
              {dm.has_send_history && onTrack && (
                <button type="button" role="menuitem" className="dm-menu-item dm-menu-narrow" style={menuItemStyle} onClick={() => closeThen(() => onTrack(dm.id, dm.title))}>발송 추적</button>
              )}
              {hasUrl && (
                <button type="button" role="menuitem" className="dm-menu-item dm-menu-narrow" style={{ ...menuItemStyle, opacity: isStopped ? 0.35 : 1, cursor: isStopped ? 'not-allowed' : 'pointer' }} disabled={isStopped} onClick={() => { if (!isStopped) closeThen(() => onCopyUrl(dm.id)); }}>발행 주소 복사</button>
              )}
              {hasUrl && onKoreanAlias && (
                <button
                  type="button"
                  role="menuitem"
                  className="dm-menu-item"
                  style={{ ...menuItemStyle, opacity: isStopped ? 0.35 : 1, cursor: isStopped ? 'not-allowed' : 'pointer' }}
                  disabled={isStopped}
                  title={isStopped ? '중지된 DM입니다. [재개] 후 사용할 수 있어요.' : '한글 주소: hlj.kr/반짝세일_07처럼 기억하기 쉬운 공용 주소 (무료)'}
                  onClick={() => { if (!isStopped) closeThen(() => onKoreanAlias(dm.id, dm.title)); }}
                >
                  한글 주소
                </button>
              )}
              <button type="button" role="menuitem" className="dm-menu-item" style={{ ...menuItemStyle, opacity: cloning ? 0.5 : 1, cursor: cloning ? 'wait' : 'pointer' }} disabled={cloning} onClick={() => closeThen(() => onClone(dm.id))}>
                {cloning ? '복제 중' : '복제'}
              </button>
              {/* ★ 2026-08-06 중지 / 재개 — 발행된 DM에만 [중지]가, 중지된 DM에만 [재개]가 보인다(임시저장에는 둘 다 없다 — 막을 주소가 없다). */}
              {isStopped && onResume && (
                <button type="button" role="menuitem" className="dm-menu-item" style={{ ...menuItemStyle, color: '#6ee7b7' }} title="재개: 같은 주소로 다시 열어요 (추가 과금 없음)" onClick={() => closeThen(() => onResume(dm.id))}>재개</button>
              )}
              {!isStopped && dm.status === 'published' && onStop && (
                <button type="button" role="menuitem" className="dm-menu-item" style={{ ...menuItemStyle, color: '#fcd34d' }} title="중지: 고객 접속을 막아요. 이력은 그대로 남아요." onClick={() => closeThen(() => onStop(dm.id))}>중지</button>
              )}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 2px' }} />
              <button type="button" role="menuitem" className="dm-menu-item" style={{ ...menuItemStyle, color: '#fda4af' }} onClick={() => closeThen(() => onDelete(dm.id))}>삭제</button>
            </div>
          )}
        </div>
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
